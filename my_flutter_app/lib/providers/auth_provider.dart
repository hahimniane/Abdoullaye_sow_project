import 'package:flutter/foundation.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:cloud_firestore/cloud_firestore.dart';

class AuthProvider extends ChangeNotifier {
  final FirebaseAuth _auth = FirebaseAuth.instance;
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;

  User? _user;
  bool _isStaff = false;
  bool _isAdmin = false;
  String? _userEmail;
  bool _isLoading = false;

  User? get user => _user;
  bool get isStaff => _isStaff;
  bool get isAdmin => _isAdmin;
  String? get userEmail => _userEmail;
  bool get isLoading => _isLoading;
  bool get isAuthenticated => _user != null;

  AuthProvider() {
    _auth.authStateChanges().listen((User? user) {
      _user = user;
      if (user != null) {
        _userEmail = user.email;
        _checkUserRole();
      } else {
        _isStaff = false;
        _isAdmin = false;
        _userEmail = null;
      }
      notifyListeners();
    });
  }

  Future<void> _checkUserRole() async {
    if (_user != null) {
      try {
        print('🔍 Fetching user document from Firestore...');
        final userDoc =
            await _firestore.collection('users').doc(_user!.uid).get();
        if (userDoc.exists) {
          final role = userDoc.data()?['role'];
          _isStaff = role == 'staff' || role == 'admin';
          _isAdmin = role == 'admin';
          print(
            '👥 User role: ${_isStaff
                ? 'staff'
                : _isAdmin
                ? 'admin'
                : 'customer'}',
          );
        } else {
          print('📄 User document not found, creating new profile...');
          // Create user profile if it doesn't exist
          await _createUserProfile();
        }
        notifyListeners();
      } catch (e) {
        print('❌ Error checking user role: $e');
      }
    }
  }

  Future<void> _createUserProfile() async {
    if (_user != null) {
      try {
        print('📝 Creating new user profile in Firestore...');
        await _firestore.collection('users').doc(_user!.uid).set({
          'email': _user!.email,
          'role': 'customer', // Default role
          'createdAt': FieldValue.serverTimestamp(),
        });
        _isStaff = false;
        _isAdmin = false;
        print('✅ User profile created successfully with customer role');
      } catch (e) {
        print('❌ Error creating user profile: $e');
      }
    }
  }

  Future<bool> authenticate(String email, String password) async {
    print('🔐 Starting authentication for email: $email');
    _isLoading = true;
    notifyListeners();

    try {
      print('📡 Attempting Firebase authentication...');
      final userCredential = await _auth.signInWithEmailAndPassword(
        email: email,
        password: password,
      );

      print('✅ Firebase authentication successful!');
      print('👤 User ID: ${userCredential.user?.uid}');
      print('📧 User Email: ${userCredential.user?.email}');

      _user = userCredential.user;
      _userEmail = userCredential.user?.email;

      // Check if user profile exists, if not create one
      if (_user != null) {
        print('🔍 Checking user role in Firestore...');
        await _checkUserRole();
      }

      _isLoading = false;
      notifyListeners();
      print('🎉 Authentication completed successfully!');
      return true;
    } on FirebaseAuthException catch (e) {
      print('❌ Firebase Auth Exception: ${e.code} - ${e.message}');
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

      print('🚨 Throwing error: $errorMessage');
      throw errorMessage;
    } catch (e) {
      print('💥 Unexpected error during authentication: $e');
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
      notifyListeners();
    } catch (e) {
      print('Error during logout: $e');
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
        _isAdmin = false;
        notifyListeners();
      }
    } catch (e) {
      print('Error promoting user to staff: $e');
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
      await _firestore.collection('users').doc(userId).update({
        'role': newRole,
        'updatedAt': FieldValue.serverTimestamp(),
      });

      // If it's the current user, update the local state
      if (_user?.uid == userId) {
        final role = newRole;
        _isStaff = role == 'staff' || role == 'admin';
        _isAdmin = role == 'admin';
        notifyListeners();
      }
    } catch (e) {
      print('Error updating user role: $e');
      throw 'Failed to update user role';
    }
  }
}
