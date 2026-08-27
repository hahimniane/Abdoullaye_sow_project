import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/notification_preferences.dart';
import '../models/platform_access.dart';
import '../services/push_notification_service.dart';
import '../utils/phone_number_validator.dart';
import '../utils/business_permissions.dart';
import '../models/marketplace_disclosure_acceptance.dart';

enum AuthInitializationIssue { profileUnavailable, profileMissing }

enum SignUpFailureKind {
  phoneAlreadyInUse,
  emailAlreadyInUse,
  invalidInput,
  rateLimited,
  serviceUnavailable,
  unknown,
}

class SignUpFailure implements Exception {
  const SignUpFailure(this.kind);

  final SignUpFailureKind kind;

  @override
  String toString() => 'SignUpFailure(${kind.name})';
}

SignUpFailureKind classifySignUpFunctionsFailure({
  required String code,
  String? message,
}) {
  final normalizedCode = code.trim().toLowerCase();
  if (normalizedCode == 'already-exists') {
    final normalizedMessage = message?.toLowerCase() ?? '';
    return normalizedMessage.contains('phone')
        ? SignUpFailureKind.phoneAlreadyInUse
        : SignUpFailureKind.emailAlreadyInUse;
  }

  return switch (normalizedCode) {
    'invalid-argument' ||
    'failed-precondition' => SignUpFailureKind.invalidInput,
    'resource-exhausted' => SignUpFailureKind.rateLimited,
    'unavailable' ||
    'deadline-exceeded' ||
    'internal' => SignUpFailureKind.serviceUnavailable,
    _ => SignUpFailureKind.unknown,
  };
}

class PhoneVerificationSession {
  const PhoneVerificationSession({
    required this.verificationId,
    this.resendToken,
  });

  final String verificationId;
  final int? resendToken;
}

class AuthProvider extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;
  final PushNotificationService _pushNotifications =
      PushNotificationService.instance;

  User? _user;
  bool _isStaff = false;
  bool _isAdmin = false;
  bool _isBusinessOwner = false;
  String? _role;
  String? _adminRole;
  PlatformAccess _platformAccess = const PlatformAccess.none();
  String? _businessId;
  String? _businessName;
  List<String> _businessServices = const [];
  List<String> _businessPermissions = const [];
  String? _userEmail;
  String? _customerName;
  String? _customerPhone;
  String? _normalizedPhone;
  bool _phoneVerified = false;
  String? _profileImageUrl;
  NotificationPreferences _notificationPreferences =
      NotificationPreferences.defaults;
  bool _isLoading = false;
  bool _isInitializing = true;
  bool _isEmailVerificationSending = false;
  AuthInitializationIssue? _initializationIssue;
  Future<void>? _roleCheckInFlight;

  User? get user => _user;
  bool get isStaff => _isStaff;
  bool get isAdmin => _isAdmin;
  bool get isBusinessOwner => _isBusinessOwner;
  bool get hasBusinessDashboardAccess =>
      _isStaff || _isBusinessOwner || _isAdmin;
  String? get role => _role;
  String? get adminRole => _adminRole;
  PlatformAccess get platformAccess => _platformAccess;
  bool canViewPlatformSection(String section) =>
      _isAdmin && _platformAccess.canView(section);
  bool canManagePlatformSection(String section) =>
      _isAdmin && _platformAccess.canManage(section);
  String? get businessId => _businessId;
  String? get businessName => _businessName;
  List<String> get businessServices => List.unmodifiable(_businessServices);
  List<String> get businessPermissions =>
      List.unmodifiable(_businessPermissions);
  bool hasBusinessPermission(String permission) => canAccessBusinessPermission(
    isStaff: _isStaff,
    permissions: _businessPermissions,
    permission: permission,
  );
  String? get userEmail => _userEmail;
  String? get customerName => _customerName;
  String? get customerPhone => _customerPhone;
  String? get normalizedPhone => _normalizedPhone;
  String? get linkedPhoneNumber => _auth.currentUser?.phoneNumber;
  bool get phoneVerified =>
      _phoneVerified &&
      PhoneNumberValidator.matches(
        _user?.phoneNumber,
        _customerPhone ?? _normalizedPhone,
      );
  bool linkedPhoneMatches(String phoneNumber) =>
      PhoneNumberValidator.matches(linkedPhoneNumber, phoneNumber);
  String? get profileImageUrl => _profileImageUrl;
  NotificationPreferences get notificationPreferences =>
      _notificationPreferences;
  bool get isLoading => _isLoading;
  bool get isInitializing => _isInitializing;
  bool get isEmailVerificationSending => _isEmailVerificationSending;
  AuthInitializationIssue? get initializationIssue => _initializationIssue;
  bool get isAuthenticated => _user != null;
  bool get emailVerified => _user?.emailVerified == true;

  String get buyerName {
    final profileName = _customerName?.trim();
    if (profileName != null && profileName.isNotEmpty) return profileName;
    final displayName = _user?.displayName?.trim();
    if (displayName != null && displayName.isNotEmpty) return displayName;
    final email = _userEmail?.trim();
    if (email != null && email.isNotEmpty) return email.split('@').first;
    return 'Customer';
  }

  AuthProvider() {
    _auth.authStateChanges().listen(_onAuthStateChanged);
  }

  Future<void> _onAuthStateChanged(User? user) async {
    _user = user;
    _initializationIssue = null;
    if (user != null) {
      _clearProfileState();
      _userEmail = user.email;
      await _checkUserRole();
      // Covers the restored-session cold start, which never runs authenticate()
      // and so never re-registered a rotated FCM token. Does not prompt.
      unawaited(_refreshPushRegistrationIfPossible());
    } else {
      _clearProfileState();
      _userEmail = null;
    }

    if (_isInitializing) {
      _isInitializing = false;
    }
    notifyListeners();
  }

  Future<void> _checkUserRole() {
    final inFlight = _roleCheckInFlight;
    if (inFlight != null) return inFlight;

    late final Future<void> check;
    check = _checkUserRoleOnce().whenComplete(() {
      if (identical(_roleCheckInFlight, check)) {
        _roleCheckInFlight = null;
      }
    });
    _roleCheckInFlight = check;
    return check;
  }

  Future<void> _checkUserRoleOnce() async {
    final signedInUser = _auth.currentUser;
    if (signedInUser != null) {
      try {
        // Storage rules read role/businessId/etc. from the ID token's custom
        // claims, which sync from Firestore server-side (syncUserCustomClaims)
        // whenever the profile changes. A cached token doesn't pick that up
        // until it naturally expires (~1hr), so force a refresh on every
        // session load to avoid stale-claims storage/unauthorized errors.
        await signedInUser.getIdToken(true);
        debugPrint('🔍 Fetching user document from Firestore...');
        var userDoc = await _firestore
            .collection('users')
            .doc(signedInUser.uid)
            .get()
            .timeout(const Duration(seconds: 15));
        if (!userDoc.exists) {
          await signedInUser.reload();
          final refreshedUser = _auth.currentUser;
          if (refreshedUser == null || refreshedUser.uid != signedInUser.uid) {
            return;
          }
          _user = refreshedUser;
          _userEmail = refreshedUser.email;

          if (refreshedUser.emailVerified) {
            try {
              await refreshedUser.getIdToken(true);
              await _functions
                  .httpsCallable('acceptAccessInvitation')
                  .call(<String, dynamic>{});
            } on FirebaseFunctionsException catch (error) {
              // Re-read the profile even when the callable response is lost:
              // the invitation may already have been activated server-side.
              debugPrint(
                'ℹ️ Access invitation activation returned ${error.code}.',
              );
            }

            userDoc = await _firestore
                .collection('users')
                .doc(refreshedUser.uid)
                .get()
                .timeout(const Duration(seconds: 15));
          }
        }
        if (userDoc.exists) {
          final data = userDoc.data();
          final role = data?['role'] as String?;
          _role = role;
          _isBusinessOwner = role == 'businessOwner';
          _isStaff = role == 'staff';
          _isAdmin = role == 'admin';
          _adminRole = data?['adminRole'] as String?;
          _businessId = data?['businessId'] as String?;
          _businessName = data?['businessName'] as String?;
          _businessServices = _stringList(data?['businessServices']);
          _businessPermissions = _stringList(data?['businessPermissions']);
          _customerName = data?['fullName'] as String?;
          _customerPhone = data?['phone'] as String?;
          _normalizedPhone = data?['normalizedPhone'] as String?;
          _phoneVerified = data?['phoneVerified'] == true;
          _profileImageUrl = data?['profileImageUrl'] as String?;
          _notificationPreferences = NotificationPreferences.fromMap(
            data?['notificationPreferences'] is Map<String, dynamic>
                ? data!['notificationPreferences'] as Map<String, dynamic>
                : null,
          );
          if (_isAdmin) {
            Map<String, dynamic>? permissionsConfig;
            try {
              final permissions = await _firestore
                  .collection('platformConfig')
                  .doc('permissions')
                  .get()
                  .timeout(const Duration(seconds: 10));
              permissionsConfig = permissions.data();
            } catch (error) {
              // Built-in roles remain available when the optional override
              // document is temporarily unavailable. Unknown roles fail closed.
              debugPrint('⚠️ Platform permissions config unavailable: $error');
            }
            _platformAccess = PlatformAccess.resolve(
              role: _adminRole,
              permissionsConfig: permissionsConfig,
            );
          }
          _initializationIssue = null;
          debugPrint(
            '👥 User role: ${_isAdmin
                ? 'admin'
                : _isBusinessOwner
                ? 'businessOwner'
                : _isStaff
                ? 'staff'
                : 'customer'}',
          );
        } else {
          debugPrint('📄 User document not found.');
          _clearProfileState();
          _initializationIssue = AuthInitializationIssue.profileMissing;
        }
        // No longer need to notify here, _onAuthStateChanged will do it.
      } catch (e) {
        debugPrint('❌ Error checking user role: $e');
        _clearProfileState();
        _initializationIssue = AuthInitializationIssue.profileUnavailable;
      }
    }
  }

  Future<void> sendCurrentUserEmailVerification() async {
    if (_isEmailVerificationSending) return;
    final currentUser = _auth.currentUser;
    if (currentUser == null || currentUser.emailVerified) return;

    _isEmailVerificationSending = true;
    notifyListeners();
    try {
      await currentUser.sendEmailVerification();
    } finally {
      _isEmailVerificationSending = false;
      notifyListeners();
    }
  }

  void _clearProfileState() {
    _isStaff = false;
    _isAdmin = false;
    _isBusinessOwner = false;
    _role = null;
    _adminRole = null;
    _platformAccess = const PlatformAccess.none();
    _businessId = null;
    _businessName = null;
    _businessServices = const [];
    _businessPermissions = const [];
    _customerName = null;
    _customerPhone = null;
    _normalizedPhone = null;
    _phoneVerified = false;
    _profileImageUrl = null;
    _notificationPreferences = NotificationPreferences.defaults;
  }

  List<String> _stringList(dynamic raw) {
    if (raw is Iterable) {
      return raw.map((item) => item.toString()).toList();
    }
    return const [];
  }

  Future<void> refreshUserProfile() async {
    await _checkUserRole();
    notifyListeners();
  }

  Future<void> requestOwnAccountDeletion({required String password}) async {
    final currentUser = _auth.currentUser;
    final email = currentUser?.email?.trim();
    if (currentUser == null || email == null || email.isEmpty) {
      throw FirebaseAuthException(
        code: 'user-not-found',
        message: 'No signed-in email account is available.',
      );
    }

    final credential = EmailAuthProvider.credential(
      email: email,
      password: password,
    );
    await currentUser.reauthenticateWithCredential(credential);
    await currentUser.getIdToken(true);

    final callable = _functions.httpsCallable('requestOwnAccountDeletion');
    final result = await callable.call<Map<String, dynamic>>({});
    if (result.data['success'] != true) {
      throw FirebaseFunctionsException(
        code: 'internal',
        message: 'Account deletion request was not accepted.',
      );
    }
  }

  Future<void> retryInitialization() async {
    if (_isInitializing) return;
    _isInitializing = true;
    _initializationIssue = null;
    notifyListeners();
    await _checkUserRole();
    _isInitializing = false;
    notifyListeners();
  }

  Future<void> _registerPushNotificationsIfPossible() async {
    try {
      await _pushNotifications.requestPermissionAndRegister();
    } catch (error) {
      debugPrint('Push registration skipped: $error');
    }
  }

  Future<void> _refreshPushRegistrationIfPossible() async {
    try {
      await _pushNotifications.refreshRegistrationIfPermitted();
    } catch (error) {
      debugPrint('Push token refresh skipped: $error');
    }
  }

  Future<bool> authenticate(String email, String password) async {
    debugPrint('🔐 Starting email authentication');
    _isLoading = true;
    notifyListeners();

    try {
      final normalizedEmail = email.trim().toLowerCase();
      debugPrint('📡 Attempting Firebase authentication...');
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: normalizedEmail,
        password: password,
      );

      debugPrint('✅ Firebase authentication successful!');
      debugPrint('👤 User ID: ${userCredential.user?.uid}');
      debugPrint('📧 User Email: ${userCredential.user?.email}');

      _user = userCredential.user;
      _userEmail = userCredential.user?.email;

      // Check if user profile exists, if not create one
      if (_user != null) {
        debugPrint('🔍 Checking user role in Firestore...');
        await _checkUserRole();
        // Notification registration can wait on OS permission/token services.
        // A successful login must never remain blocked behind that optional
        // setup work.
        unawaited(_registerPushNotificationsIfPossible());
      }

      _isLoading = false;
      notifyListeners();
      debugPrint('🎉 Authentication completed successfully!');
      return true;
    } on FirebaseAuthException catch (e) {
      debugPrint('❌ Firebase Auth Exception: ${e.code} - ${e.message}');
      _isLoading = false;
      notifyListeners();

      String errorMessage;
      switch (e.code) {
        case 'user-not-found':
          errorMessage = 'No user found with this email.';
          break;
        case 'wrong-password':
          errorMessage = 'Wrong password provided.';
          break;
        case 'invalid-email':
          errorMessage = 'Invalid email address.';
          break;
        case 'user-disabled':
          errorMessage = 'This user account has been disabled.';
          break;
        case 'too-many-requests':
          errorMessage = 'Too many failed attempts. Please try again later.';
          break;
        default:
          errorMessage = 'Authentication failed: ${e.message}';
      }

      debugPrint('🚨 Throwing error: $errorMessage');
      throw errorMessage;
    } catch (e) {
      debugPrint('💥 Unexpected error during authentication: $e');
      _isLoading = false;
      notifyListeners();
      throw 'An unexpected error occurred: $e';
    }
  }

  Future<void> logout() async {
    try {
      try {
        await _pushNotifications.disableCurrentToken();
      } catch (e) {
        debugPrint('Error disabling push token during logout: $e');
      }
      await _auth.signOut();
      _user = null;
      _isStaff = false;
      _isAdmin = false;
      _isBusinessOwner = false;
      _role = null;
      _businessId = null;
      _businessName = null;
      _businessServices = const [];
      _businessPermissions = const [];
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
      _normalizedPhone = null;
      _phoneVerified = false;
      _profileImageUrl = null;
      _notificationPreferences = NotificationPreferences.defaults;
      notifyListeners();
    } catch (e) {
      debugPrint('Error during logout: $e');
      await _auth.signOut();
      _user = null;
      _isStaff = false;
      _isAdmin = false;
      _isBusinessOwner = false;
      _role = null;
      _businessId = null;
      _businessName = null;
      _businessServices = const [];
      _businessPermissions = const [];
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
      _normalizedPhone = null;
      _phoneVerified = false;
      _profileImageUrl = null;
      _notificationPreferences = NotificationPreferences.defaults;
      notifyListeners();
    }
  }

  Future<void> updateCustomerPhone(String phone) async {
    final trimmed = phone.trim();
    if (_user == null || trimmed.isEmpty) return;
    if (!PhoneNumberValidator.isValid(trimmed)) {
      throw 'Please enter a valid phone number.';
    }
    await updateAccountProfile(
      fullName: _customerName ?? buyerName,
      phone: trimmed,
      notificationPreferences: _notificationPreferences,
    );
  }

  Future<void> updateAccountProfile({
    required String fullName,
    required String phone,
    String? profileImageUrl,
    String? profileImagePath,
    NotificationPreferences? notificationPreferences,
  }) async {
    final trimmedPhone = phone.trim();
    if (_user == null) return;
    if (!PhoneNumberValidator.isValid(trimmedPhone)) {
      throw 'Please enter a valid phone number.';
    }
    final prefs = notificationPreferences ?? _notificationPreferences;
    final callable = _functions.httpsCallable('updateCustomerProfile');
    final response = await callable.call<Map<String, dynamic>>({
      'fullName': fullName.trim(),
      'phone': trimmedPhone,
      'notificationPreferences': prefs.toMap(),
      'profileImageUrl': ?profileImageUrl,
      'profileImagePath': ?profileImagePath,
    });
    await _user!.updateDisplayName(fullName.trim());
    _customerName = fullName.trim();
    _customerPhone = trimmedPhone;
    _normalizedPhone =
        (response.data['normalizedPhone'] ??
                PhoneNumberValidator.aliasKey(trimmedPhone))
            .toString();
    _phoneVerified = response.data['phoneVerified'] == true;
    _notificationPreferences = prefs;
    if (profileImageUrl != null) _profileImageUrl = profileImageUrl;
    notifyListeners();
  }

  Future<void> startPhoneVerification({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onVerificationCompleted,
    required ValueChanged<Object> onVerificationFailed,
    bool Function()? shouldCompleteAutomaticVerification,
    int? resendToken,
  }) async {
    if (_auth.currentUser == null) {
      throw FirebaseAuthException(
        code: 'user-not-found',
        message: 'No signed-in account is available.',
      );
    }
    if (!PhoneNumberValidator.isValidE164(phoneNumber)) {
      throw FirebaseAuthException(
        code: 'invalid-phone-number',
        message: 'Use an international phone number beginning with +.',
      );
    }

    await _auth.setLanguageCode(languageCode);
    await _auth.verifyPhoneNumber(
      phoneNumber: PhoneNumberValidator.normalized(phoneNumber),
      forceResendingToken: resendToken,
      timeout: const Duration(seconds: 60),
      verificationCompleted: (credential) async {
        if (shouldCompleteAutomaticVerification?.call() == false) return;
        try {
          await _finishPhoneVerification(credential);
          if (shouldCompleteAutomaticVerification?.call() == false) return;
          await onVerificationCompleted();
        } catch (error) {
          if (shouldCompleteAutomaticVerification?.call() == false) return;
          onVerificationFailed(error);
        }
      },
      verificationFailed: onVerificationFailed,
      codeSent: (verificationId, forceResendingToken) {
        onCodeSent(
          PhoneVerificationSession(
            verificationId: verificationId,
            resendToken: forceResendingToken,
          ),
        );
      },
      codeAutoRetrievalTimeout: (verificationId) {},
    );
  }

  Future<void> completePhoneVerification({
    required String verificationId,
    required String smsCode,
  }) async {
    final credential = PhoneAuthProvider.credential(
      verificationId: verificationId,
      smsCode: smsCode,
    );
    await _finishPhoneVerification(credential);
  }

  Future<void> _finishPhoneVerification(PhoneAuthCredential credential) async {
    final currentUser = _auth.currentUser;
    if (currentUser == null) {
      throw FirebaseAuthException(
        code: 'user-not-found',
        message: 'No signed-in account is available.',
      );
    }

    if ((currentUser.phoneNumber ?? '').isEmpty) {
      await currentUser.linkWithCredential(credential);
    } else {
      await currentUser.updatePhoneNumber(credential);
    }
    await syncLinkedPhoneVerification();
  }

  Future<void> syncLinkedPhoneVerification() async {
    final currentUser = _auth.currentUser;
    if (currentUser == null) {
      throw FirebaseAuthException(
        code: 'user-not-found',
        message: 'No signed-in account is available.',
      );
    }

    await currentUser.reload();
    final refreshedUser = _auth.currentUser;
    if (!PhoneNumberValidator.isValidE164(refreshedUser?.phoneNumber)) {
      throw FirebaseAuthException(
        code: 'invalid-phone-number',
        message: 'Complete phone verification before syncing your profile.',
      );
    }
    _user = refreshedUser;
    await refreshedUser!.getIdToken(true);
    await _functions.httpsCallable('syncVerifiedCustomerPhone').call<void>({});
    await refreshedUser.reload();
    _user = _auth.currentUser;
    await _checkUserRole();
    notifyListeners();
  }

  Future<Map<String, dynamic>> submitBusinessApplication({
    required String ownerName,
    required String ownerPhone,
    required String businessName,
    required String businessPhone,
    required String businessEmail,
    required String businessWebsite,
    required List<String> enabledServices,
    String? profileImageUrl,
    String? profileImagePath,
    required String serviceNote,
    required String addressLine1,
    required String city,
    required String country,
    required String state,
    required String postalCode,
    required MarketplaceDisclosureAcceptance marketplaceAcceptance,
  }) async {
    if (_user == null) {
      throw 'Please create an account or sign in first.';
    }
    if (!PhoneNumberValidator.isValid(ownerPhone)) {
      throw 'Please enter a valid owner phone number.';
    }
    if (businessPhone.trim().isNotEmpty &&
        !PhoneNumberValidator.isValid(businessPhone)) {
      throw 'Please enter a valid business phone number.';
    }

    final callable = _functions.httpsCallable('submitBusinessApplication');
    final response = await callable.call<Map<String, dynamic>>({
      'ownerName': ownerName.trim(),
      'ownerPhone': ownerPhone.trim(),
      'businessName': businessName.trim(),
      'businessPhone': businessPhone.trim(),
      'businessEmail': businessEmail.trim(),
      'businessWebsite': businessWebsite.trim(),
      'enabledServices': enabledServices,
      'profileImageUrl': ?profileImageUrl,
      'profileImagePath': ?profileImagePath,
      'serviceNote': serviceNote.trim(),
      'addressLine1': addressLine1.trim(),
      'city': city.trim(),
      'country': country.trim(),
      'state': state.trim(),
      'postalCode': postalCode.trim(),
      'marketplaceDisclosure': marketplaceAcceptance.toJson(),
    });
    await refreshUserProfile();
    return Map<String, dynamic>.from(response.data);
  }

  Future<void> updateBusinessProfile({
    required String businessId,
    required String name,
    required String phone,
    required String email,
    required String website,
    required List<String> enabledServices,
    String? profileImageUrl,
    String? profileImagePath,
    required String serviceNote,
    required String addressLine1,
    required String city,
    required String country,
    required String state,
    required String postalCode,
    required String carHoldPricingMode,
    required double carHoldFlatFee,
    required double carHoldDailyRate,
    required int carHoldMaxDays,
    required String parkingAddressLine1,
    required String parkingCity,
    required String parkingCountry,
    required String parkingState,
    required int parkingTotalSpaces,
    required int parkingBlockedSpaces,
    required double parkingDailyRate,
    required double parkingWeeklyRate,
    required double parkingMonthlyRate,
    required int parkingMinimumDays,
    required bool parkingPickupAvailable,
    required double parkingPickupFee,
    required String parkingInstructions,
    double? parkingLatitude,
    double? parkingLongitude,
    bool? freightPickupAvailable,
    String? freightPickupModel,
    double? freightPickupBaseFee,
    double? freightPickupPerKm,
    double? freightPickupMinFee,
    double? freightPickupMaxKm,
    String? freightPickupOriginAddress,
    double? freightPickupOriginLat,
    double? freightPickupOriginLng,
    Map<String, double>? freightPickupBoroughPrices,
    Map<String, dynamic>? pickupPlan,
  }) async {
    if (_user == null) {
      throw 'Please sign in first.';
    }
    if (phone.trim().isNotEmpty && !PhoneNumberValidator.isValid(phone)) {
      throw 'Please enter a valid business phone number.';
    }
    final callable = _functions.httpsCallable('updateBusinessProfile');
    await callable.call({
      'businessId': businessId,
      'name': name.trim(),
      'phone': phone.trim(),
      'email': email.trim(),
      'website': website.trim(),
      'enabledServices': enabledServices,
      'profileImageUrl': ?profileImageUrl,
      'profileImagePath': ?profileImagePath,
      'serviceNote': serviceNote.trim(),
      'addressLine1': addressLine1.trim(),
      'city': city.trim(),
      'country': country.trim(),
      'state': state.trim(),
      'postalCode': postalCode.trim(),
      'carHoldPricingMode': carHoldPricingMode,
      'carHoldFlatFee': carHoldFlatFee,
      'carHoldDailyRate': carHoldDailyRate,
      'carHoldMaxDays': carHoldMaxDays,
      'parkingAddressLine1': parkingAddressLine1.trim(),
      'parkingCity': parkingCity.trim(),
      'parkingCountry': parkingCountry.trim(),
      'parkingState': parkingState.trim(),
      'parkingTotalSpaces': parkingTotalSpaces,
      'parkingBlockedSpaces': parkingBlockedSpaces,
      'parkingDailyRate': parkingDailyRate,
      'parkingWeeklyRate': parkingWeeklyRate,
      'parkingMonthlyRate': parkingMonthlyRate,
      'parkingMinimumDays': parkingMinimumDays,
      'parkingPickupAvailable': parkingPickupAvailable,
      'parkingPickupFee': parkingPickupFee,
      'parkingInstructions': parkingInstructions.trim(),
      'parkingLatitude': parkingLatitude,
      'parkingLongitude': parkingLongitude,
      'freightPickupAvailable': ?freightPickupAvailable,
      'freightPickupModel': ?freightPickupModel,
      'freightPickupBaseFee': ?freightPickupBaseFee,
      'freightPickupPerKm': ?freightPickupPerKm,
      'freightPickupMinFee': ?freightPickupMinFee,
      'freightPickupMaxKm': ?freightPickupMaxKm,
      'freightPickupOriginAddress': ?freightPickupOriginAddress,
      'freightPickupOriginLat': ?freightPickupOriginLat,
      'freightPickupOriginLng': ?freightPickupOriginLng,
      'freightPickupBoroughPrices': ?freightPickupBoroughPrices,
      'pickupPlan': ?pickupPlan,
    });
    await refreshUserProfile();
  }

  Future<bool> signUp({
    required String email,
    required String password,
    required String fullName,
    required String phone,
    required AccountLegalAcceptance legalAcceptance,
  }) async {
    debugPrint('📝 Starting sign up for email: $email');
    _isLoading = true;
    notifyListeners();

    try {
      if (!PhoneNumberValidator.isValid(phone)) {
        throw 'Please enter a valid phone number.';
      }

      debugPrint('📡 Creating new user through Cloud Functions...');
      final callable = _functions.httpsCallable('createCustomerUser');
      final response = await callable.call<Map<String, dynamic>>({
        'email': email,
        'password': password,
        'fullName': fullName,
        'phone': phone,
        'legalAcceptance': legalAcceptance.toJson(),
      });

      final signInEmail = (response.data['email'] ?? email).toString().trim();
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: signInEmail,
        password: password,
      );

      _user = userCredential.user;
      _userEmail = userCredential.user?.email;
      _customerName = fullName.trim();
      _customerPhone = phone.trim();
      _normalizedPhone = response.data['normalizedPhone']?.toString();
      _notificationPreferences = NotificationPreferences.defaults;
      await _checkUserRole();
      unawaited(_registerPushNotificationsIfPossible());

      _isLoading = false;
      notifyListeners();
      debugPrint('🎉 Sign up completed successfully!');
      return true;
    } on FirebaseFunctionsException catch (e) {
      debugPrint('Firebase Functions sign-up failed with code: ${e.code}');
      _isLoading = false;
      notifyListeners();

      throw SignUpFailure(
        classifySignUpFunctionsFailure(code: e.code, message: e.message),
      );
    } on FirebaseAuthException catch (e) {
      debugPrint('❌ Firebase Auth Exception: ${e.code} - ${e.message}');
      _isLoading = false;
      notifyListeners();

      String errorMessage;
      switch (e.code) {
        case 'weak-password':
          errorMessage = 'The password provided is too weak.';
          break;
        case 'email-already-in-use':
          errorMessage = 'An account already exists with this email.';
          break;
        case 'invalid-email':
          errorMessage = 'Invalid email address.';
          break;
        case 'operation-not-allowed':
          errorMessage =
              'Email/password accounts are not enabled. Please contact support.';
          break;
        case 'network-request-failed':
          errorMessage =
              'Network error. Please check your internet connection.';
          break;
        default:
          errorMessage = 'Sign up failed: ${e.message}';
      }

      debugPrint('🚨 Throwing error: $errorMessage');
      throw errorMessage;
    } catch (e) {
      debugPrint('💥 Unexpected error during sign up: $e');
      _isLoading = false;
      notifyListeners();

      throw 'An unexpected error occurred: $e';
    }
  }

  Future<void> resetPassword(String email) async {
    try {
      await _auth.sendPasswordResetEmail(email: email);
    } on FirebaseAuthException catch (e) {
      String errorMessage;
      switch (e.code) {
        case 'user-not-found':
          errorMessage = 'No user found with this email.';
          break;
        case 'invalid-email':
          errorMessage = 'Invalid email address.';
          break;
        default:
          errorMessage = 'Password reset failed: ${e.message}';
      }
      throw errorMessage;
    }
  }

  Future<Map<String, dynamic>> listMarketplacePeople({
    String search = '',
    int pageSize = 100,
    String pageToken = '',
    bool includeInvitations = true,
  }) {
    return _callMarketplacePeople('listMarketplacePeople', {
      if (search.trim().isNotEmpty) 'search': search.trim(),
      'pageSize': pageSize,
      if (pageToken.isNotEmpty) 'pageToken': pageToken,
      'includeInvitations': includeInvitations,
    });
  }

  Future<Map<String, dynamic>> getMarketplacePerson(String userId) {
    return _callMarketplacePeople('getMarketplacePerson', {'userId': userId});
  }

  Future<Map<String, dynamic>> setMarketplaceUserStatus({
    required String userId,
    required String action,
    String reason = '',
  }) {
    return _callMarketplacePeople('setMarketplaceUserStatus', {
      'userId': userId,
      'action': action,
      if (reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<Map<String, dynamic>> revokeUserSessions({
    required String userId,
    String reason = '',
  }) {
    return _callMarketplacePeople('revokeUserSessions', {
      'userId': userId,
      if (reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<Map<String, dynamic>> sendUserRecoveryEmail({
    required String userId,
    required String action,
    required String locale,
  }) {
    return _callMarketplacePeople('sendUserRecoveryEmail', {
      'userId': userId,
      'action': action,
      'locale': locale,
    });
  }

  Future<Map<String, dynamic>> invitePlatformAdmin({
    required String email,
    required String fullName,
    required String adminRole,
    required String locale,
  }) {
    return _callMarketplacePeople('invitePlatformAdmin', {
      'email': email.trim(),
      'fullName': fullName.trim(),
      'adminRole': adminRole,
      'locale': locale,
    });
  }

  Future<Map<String, dynamic>> inviteBusinessMember({
    required String email,
    required String fullName,
    required String businessId,
    required List<String> businessPermissions,
    required String locale,
  }) {
    return _callMarketplacePeople('inviteBusinessMember', {
      'email': email.trim(),
      'fullName': fullName.trim(),
      'businessId': businessId,
      'businessPermissions': businessPermissions,
      'locale': locale,
    });
  }

  Future<Map<String, dynamic>> resendAccessInvitation(String invitationId) {
    return _callMarketplacePeople('resendAccessInvitation', {
      'invitationId': invitationId,
    });
  }

  Future<Map<String, dynamic>> cancelAccessInvitation(String invitationId) {
    return _callMarketplacePeople('cancelAccessInvitation', {
      'invitationId': invitationId,
    });
  }

  Future<Map<String, dynamic>> acceptAccessInvitation({
    String invitationId = '',
  }) {
    return _callMarketplacePeople('acceptAccessInvitation', {
      if (invitationId.isNotEmpty) 'invitationId': invitationId,
    });
  }

  Future<Map<String, dynamic>> transferBusinessOwnership({
    required String userId,
    required String businessId,
  }) {
    return _callMarketplacePeople('transferBusinessOwnership', {
      'userId': userId,
      'businessId': businessId,
    });
  }

  Future<Map<String, dynamic>> reviewAccountDeletion(String userId) {
    return _callMarketplacePeople('reviewAccountDeletion', {'userId': userId});
  }

  Future<Map<String, dynamic>> finalizeAccountDeletion({
    required String userId,
    required String reason,
  }) {
    return _callMarketplacePeople('finalizeAccountDeletion', {
      'userId': userId,
      'confirmation': userId,
      if (reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  Future<Map<String, dynamic>> _callMarketplacePeople(
    String callableName,
    Map<String, dynamic> payload,
  ) async {
    final response = await _functions.httpsCallable(callableName).call(payload);
    final data = response.data;
    if (data is Map) {
      return Map<String, dynamic>.from(data);
    }
    throw StateError('Invalid marketplace people response.');
  }
}
