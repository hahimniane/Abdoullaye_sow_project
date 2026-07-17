import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/notification_preferences.dart';
import '../services/push_notification_service.dart';
import '../utils/phone_number_validator.dart';
import '../models/marketplace_disclosure_acceptance.dart';

enum AuthInitializationIssue { profileUnavailable, profileMissing }

class AuthProvider extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;
  final PushNotificationService _pushNotifications = PushNotificationService();

  User? _user;
  bool _isStaff = false;
  bool _isAdmin = false;
  bool _isBusinessOwner = false;
  String? _role;
  String? _businessId;
  String? _businessName;
  List<String> _businessServices = const [];
  String? _userEmail;
  String? _customerName;
  String? _customerPhone;
  String? _normalizedPhone;
  String? _profileImageUrl;
  NotificationPreferences _notificationPreferences =
      NotificationPreferences.defaults;
  bool _isLoading = false;
  bool _isInitializing = true;
  AuthInitializationIssue? _initializationIssue;

  User? get user => _user;
  bool get isStaff => _isStaff;
  bool get isAdmin => _isAdmin;
  bool get isBusinessOwner => _isBusinessOwner;
  bool get hasBusinessDashboardAccess =>
      _isStaff || _isBusinessOwner || _isAdmin;
  String? get role => _role;
  String? get businessId => _businessId;
  String? get businessName => _businessName;
  List<String> get businessServices => List.unmodifiable(_businessServices);
  String? get userEmail => _userEmail;
  String? get customerName => _customerName;
  String? get customerPhone => _customerPhone;
  String? get normalizedPhone => _normalizedPhone;
  String? get profileImageUrl => _profileImageUrl;
  NotificationPreferences get notificationPreferences =>
      _notificationPreferences;
  bool get isLoading => _isLoading;
  bool get isInitializing => _isInitializing;
  AuthInitializationIssue? get initializationIssue => _initializationIssue;
  bool get isAuthenticated => _user != null;

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
    } else {
      _clearProfileState();
      _userEmail = null;
    }

    if (_isInitializing) {
      _isInitializing = false;
    }
    notifyListeners();
  }

  Future<void> _checkUserRole() async {
    if (_user != null) {
      try {
        debugPrint('🔍 Fetching user document from Firestore...');
        final userDoc = await _firestore
            .collection('users')
            .doc(_user!.uid)
            .get()
            .timeout(const Duration(seconds: 15));
        if (userDoc.exists) {
          final data = userDoc.data();
          final role = data?['role'] as String?;
          _role = role;
          _isBusinessOwner = role == 'businessOwner';
          _isStaff = role == 'staff';
          _isAdmin = role == 'admin';
          _businessId = data?['businessId'] as String?;
          _businessName = data?['businessName'] as String?;
          _businessServices = _stringList(data?['businessServices']);
          _customerName = data?['fullName'] as String?;
          _customerPhone = data?['phone'] as String?;
          _normalizedPhone = data?['normalizedPhone'] as String?;
          _profileImageUrl = data?['profileImageUrl'] as String?;
          _notificationPreferences = NotificationPreferences.fromMap(
            data?['notificationPreferences'] is Map<String, dynamic>
                ? data!['notificationPreferences'] as Map<String, dynamic>
                : null,
          );
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

  void _clearProfileState() {
    _isStaff = false;
    _isAdmin = false;
    _isBusinessOwner = false;
    _role = null;
    _businessId = null;
    _businessName = null;
    _businessServices = const [];
    _customerName = null;
    _customerPhone = null;
    _normalizedPhone = null;
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
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
      _normalizedPhone = null;
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
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
      _normalizedPhone = null;
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
    _notificationPreferences = prefs;
    if (profileImageUrl != null) _profileImageUrl = profileImageUrl;
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

  // Method to promote a user to staff (for admin use)
  Future<void> promoteToStaff(String userId) async {
    try {
      await _firestore.collection('users').doc(userId).update({
        'role': 'staff',
        'updatedAt': FieldValue.serverTimestamp(),
      });

      // If it's the current user, update the local state
      if (_user?.uid == userId) {
        _isStaff = true;
        _isAdmin = false; // A user promoted to staff is not an admin by default
        _isBusinessOwner = false;
        _role = 'staff';
        notifyListeners();
      }
    } catch (e) {
      debugPrint('Error promoting user to staff: $e');
      throw 'Failed to promote user to staff';
    }
  }

  // Method to update any user's role (for admin use)
  Future<void> updateUserRole(String userId, String newRole) async {
    // Ensure the new role is valid
    if (!['customer', 'staff', 'businessOwner', 'admin'].contains(newRole)) {
      throw 'Invalid role specified';
    }

    try {
      debugPrint('📡 Calling Cloud Function to update user role...');

      // Call the Cloud Function to update the user role
      final HttpsCallable callable = _functions.httpsCallable('updateUserRole');
      final result = await callable.call({
        'userId': userId,
        'newRole': newRole,
      });

      // Log the result
      debugPrint('✅ Cloud Function response: ${result.data}');

      if (result.data['success'] == true) {
        debugPrint(
          '🎉 User role updated successfully to: ${result.data['newRole']}',
        );

        // If it's the current user, update the local state
        if (_user?.uid == userId) {
          final role = newRole;
          _role = role;
          _isBusinessOwner = role == 'businessOwner';
          _isStaff = role == 'staff';
          _isAdmin = role == 'admin';
          notifyListeners();
        }
      } else {
        throw 'Failed to update user role: ${result.data['message'] ?? 'Unknown error'}';
      }
    } on FirebaseFunctionsException catch (e) {
      debugPrint('❌ Firebase Functions Exception: ${e.code} - ${e.message}');

      // Handle specific Firebase Functions errors
      switch (e.code) {
        case 'unauthenticated':
          throw 'You must be authenticated to update user roles.';
        case 'permission-denied':
          throw 'Only admins can update user roles.';
        case 'invalid-argument':
          throw e.message ?? 'Invalid input provided.';
        case 'not-found':
          throw 'User not found.';
        case 'internal':
          throw 'An internal error occurred. Please try again.';
        default:
          throw e.message ?? 'Failed to update user role: ${e.code}';
      }
    } catch (e) {
      debugPrint('❌ Unexpected error calling Cloud Function: $e');
      throw 'Failed to update user role';
    }
  }

  // Method to add a new staff user under a business.
  Future<void> addStaffUser({
    required String email,
    required String password,
    String fullName = '',
    String phone = '',
    String? businessId,
    String? profileImageUrl,
    String? profileImagePath,
  }) async {
    try {
      debugPrint('📡 Calling Cloud Function to create staff user...');

      // Call the Cloud Function to create the user
      final HttpsCallable callable = _functions.httpsCallable(
        'createStaffUser',
      );
      final result = await callable.call({
        'email': email,
        'password': password,
        'fullName': fullName.trim(),
        'phone': phone.trim(),
        if (businessId != null && businessId.trim().isNotEmpty)
          'businessId': businessId.trim(),
        'profileImageUrl': ?profileImageUrl,
        'profileImagePath': ?profileImagePath,
      });

      // Log the result
      debugPrint('✅ Cloud Function response: ${result.data}');

      if (result.data['success'] == true) {
        debugPrint(
          '🎉 Staff user created successfully: ${result.data['email']}',
        );
      } else {
        throw 'Failed to create staff user: ${result.data['message'] ?? 'Unknown error'}';
      }
    } on FirebaseFunctionsException catch (e) {
      debugPrint('❌ Firebase Functions Exception: ${e.code} - ${e.message}');

      // Handle specific Firebase Functions errors
      switch (e.code) {
        case 'unauthenticated':
          throw 'You must be authenticated to create users.';
        case 'permission-denied':
          throw 'Only platform admins or business admins can create staff users.';
        case 'invalid-argument':
          throw e.message ?? 'Invalid input provided.';
        case 'already-exists':
          throw 'A user with this email already exists.';
        case 'not-found':
          throw 'The requested resource was not found.';
        case 'internal':
          throw 'An internal error occurred. Please try again.';
        default:
          throw e.message ?? 'Failed to create user: ${e.code}';
      }
    } catch (e) {
      debugPrint('❌ Unexpected error calling Cloud Function: $e');
      throw 'An unexpected error occurred while adding the staff user.';
    }
  }

  // Method to delete a user (for admin use)
  Future<void> addPlatformManager({
    required String email,
    required String password,
    required String fullName,
    String phone = '',
  }) async {
    try {
      debugPrint('📡 Calling Cloud Function to create platform manager...');
      final callable = _functions.httpsCallable('createPlatformManager');
      final result = await callable.call({
        'email': email.trim(),
        'password': password.trim(),
        'fullName': fullName.trim(),
        'phone': phone.trim(),
      });
      if (result.data['success'] != true) {
        throw 'Failed to create platform manager.';
      }
    } on FirebaseFunctionsException catch (e) {
      debugPrint('❌ Firebase Functions Exception: ${e.code} - ${e.message}');
      switch (e.code) {
        case 'unauthenticated':
          throw 'You must be authenticated to create platform managers.';
        case 'permission-denied':
          throw 'Only platform admins can create platform managers.';
        case 'already-exists':
          throw 'A user with this email already exists.';
        case 'invalid-argument':
          throw e.message ?? 'Invalid input provided.';
        default:
          throw e.message ?? 'Failed to create platform manager: ${e.code}';
      }
    } catch (e) {
      debugPrint('❌ Unexpected error creating platform manager: $e');
      throw 'An unexpected error occurred while creating the platform manager.';
    }
  }

  // Method to delete a user (for admin use)
  Future<void> deleteUser(String userId) async {
    try {
      debugPrint('📡 Calling Cloud Function to delete user...');

      // Call the Cloud Function to delete the user
      final HttpsCallable callable = _functions.httpsCallable('deleteUser');
      final result = await callable.call({'userId': userId});

      // Log the result
      debugPrint('✅ Cloud Function response: ${result.data}');

      if (result.data['success'] == true) {
        debugPrint('🎉 User deleted successfully: ${result.data['userId']}');
      } else {
        throw 'Failed to delete user: ${result.data['message'] ?? 'Unknown error'}';
      }
    } on FirebaseFunctionsException catch (e) {
      debugPrint('❌ Firebase Functions Exception: ${e.code} - ${e.message}');

      // Handle specific Firebase Functions errors
      switch (e.code) {
        case 'unauthenticated':
          throw 'You must be authenticated to delete users.';
        case 'permission-denied':
          throw 'Only admins can delete users.';
        case 'invalid-argument':
          throw e.message ?? 'Invalid input provided.';
        case 'not-found':
          throw 'User not found.';
        case 'internal':
          throw 'An internal error occurred. Please try again.';
        default:
          throw e.message ?? 'Failed to delete user: ${e.code}';
      }
    } catch (e) {
      debugPrint('❌ Unexpected error calling Cloud Function: $e');
      throw 'An unexpected error occurred while deleting the user.';
    }
  }
}
