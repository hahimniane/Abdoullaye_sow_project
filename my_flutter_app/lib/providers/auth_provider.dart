import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

class AuthProvider extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final FirebaseFunctions _functions = FirebaseFunctions.instance;

  User? _user;
  bool _isStaff = false;
  bool _isAdmin = false;
  String? _userEmail;
  String? _customerName;
  String? _customerPhone;
  bool _isLoading = false;
  bool _isInitializing = true;

  User? get user => _user;
  bool get isStaff => _isStaff;
  bool get isAdmin => _isAdmin;
  String? get userEmail => _userEmail;
  String? get customerName => _customerName;
  String? get customerPhone => _customerPhone;
  bool get isLoading => _isLoading;
  bool get isInitializing => _isInitializing;
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
    if (user != null) {
      _userEmail = user.email;
      await _checkUserRole();
    } else {
      _isStaff = false;
      _isAdmin = false;
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
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
            .get();
        if (userDoc.exists) {
          final data = userDoc.data();
          final role = data?['role'];
          _isStaff = role == 'staff' || role == 'admin';
          _isAdmin = role == 'admin';
          _customerName = data?['fullName'] as String?;
          _customerPhone = data?['phone'] as String?;
          debugPrint(
            '👥 User role: ${_isStaff
                ? 'staff'
                : _isAdmin
                ? 'admin'
                : 'customer'}',
          );
        } else {
          debugPrint('📄 User document not found.');
          _isStaff = false;
          _isAdmin = false;
          _customerName = null;
          _customerPhone = null;
        }
        // No longer need to notify here, _onAuthStateChanged will do it.
      } catch (e) {
        debugPrint('❌ Error checking user role: $e');
        _isStaff = false;
        _isAdmin = false;
      }
    }
  }

  Future<bool> authenticate(String email, String password) async {
    debugPrint('🔐 Starting authentication for email: $email');
    _isLoading = true;
    notifyListeners();

    try {
      debugPrint('📡 Attempting Firebase authentication...');
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
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
      await _auth.signOut();
      _user = null;
      _isStaff = false;
      _isAdmin = false;
      _userEmail = null;
      _customerName = null;
      _customerPhone = null;
      notifyListeners();
    } catch (e) {
      debugPrint('Error during logout: $e');
    }
  }

  Future<void> updateCustomerPhone(String phone) async {
    final trimmed = phone.trim();
    if (_user == null || trimmed.isEmpty) return;
    await _firestore.collection('users').doc(_user!.uid).update({
      'phone': trimmed,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    _customerPhone = trimmed;
    notifyListeners();
  }

  Future<bool> signUp({
    required String email,
    required String password,
    required String fullName,
    required String phone,
  }) async {
    debugPrint('📝 Starting sign up for email: $email');
    _isLoading = true;
    notifyListeners();

    User? createdUser;

    try {
      debugPrint('📡 Creating new user with Firebase Auth...');
      final userCredential = await _auth.createUserWithEmailAndPassword(
        email: email,
        password: password,
      );

      createdUser = userCredential.user;

      if (createdUser == null) {
        throw 'User creation returned null. Please check Firebase configuration.';
      }

      debugPrint('✅ Firebase Auth user created successfully!');
      debugPrint('👤 User ID: ${createdUser.uid}');
      debugPrint('📧 User Email: ${createdUser.email}');

      _user = createdUser;
      _userEmail = createdUser.email;
      _customerName = fullName.trim();
      _customerPhone = phone.trim();
      await createdUser.updateDisplayName(_customerName);

      // Create user profile in Firestore with customer role
      debugPrint('📝 Creating user profile in Firestore...');
      try {
        final userRef = _firestore.collection('users').doc(createdUser.uid);
        await userRef.set({
          'email': createdUser.email,
          'fullName': _customerName,
          'phone': _customerPhone,
          'role': 'customer', // Default role
          'createdAt': FieldValue.serverTimestamp(),
        });
        _isStaff = false;
        _isAdmin = false;
        debugPrint(
          '✅ Firestore user profile created successfully with customer role',
        );
      } catch (firestoreError) {
        debugPrint('❌ Firestore Error: $firestoreError');
        // If Firestore fails, delete the auth user to keep things consistent
        debugPrint(
          '⚠️ Rolling back Firebase Auth user due to Firestore error...',
        );
        await createdUser.delete();
        throw 'Failed to create user profile in database: $firestoreError';
      }

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

      // If we created a user but hit an error, try to clean up
      if (createdUser != null) {
        try {
          debugPrint('⚠️ Cleaning up created user due to error...');
          await createdUser.delete();
        } catch (deleteError) {
          debugPrint('❌ Failed to clean up user: $deleteError');
        }
      }

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
    if (!['customer', 'staff', 'admin'].contains(newRole)) {
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
          _isStaff = role == 'staff' || role == 'admin';
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

  // Method to add a new staff user (for admin use)
  Future<void> addStaffUser(String email, String password) async {
    try {
      debugPrint('📡 Calling Cloud Function to create staff user...');

      // Call the Cloud Function to create the user
      final HttpsCallable callable = _functions.httpsCallable(
        'createStaffUser',
      );
      final result = await callable.call({
        'email': email,
        'password': password,
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
          throw 'Only admins can create new staff users.';
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
