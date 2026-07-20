import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';
import '../providers/auth_provider.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';

class AddStaffScreen extends StatefulWidget {
  const AddStaffScreen({super.key});

  @override
  State<AddStaffScreen> createState() => _AddStaffScreenState();
}

class _AddStaffScreenState extends State<AddStaffScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  XFile? _profileImage;
  Uint8List? _profileImageBytes;
  String? _selectedBusinessId;
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _pickImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 900,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() {
      _profileImage = picked;
      _profileImageBytes = bytes;
    });
  }

  Future<_UploadedImage?> _uploadProfileImage(String businessId) async {
    final image = _profileImage;
    final bytes = _profileImageBytes;
    if (image == null || bytes == null) return null;
    final ext = image.name.split('.').last.toLowerCase();
    final safeExt = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'jpg';
    final path =
        'businesses/$businessId/staff_profiles/staff_${DateTime.now().millisecondsSinceEpoch}.$safeExt';
    final ref = firebase_storage.FirebaseStorage.instance.ref(path);
    await ref.putData(
      bytes,
      firebase_storage.SettableMetadata(
        contentType: safeExt == 'png'
            ? 'image/png'
            : safeExt == 'webp'
            ? 'image/webp'
            : 'image/jpeg',
      ),
    );
    return _UploadedImage(path: path, url: await ref.getDownloadURL());
  }

  String _businessName(QueryDocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>;
    final name = (data['name'] as String?)?.trim();
    return name == null || name.isEmpty ? doc.id : name;
  }

  Future<void> _addStaffMember() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }

    setState(() {
      _isLoading = true;
    });

    final authProvider = Provider.of<AuthProvider>(context, listen: false);
    final targetBusinessId = authProvider.isAdmin
        ? _selectedBusinessId
        : authProvider.businessId;

    if (targetBusinessId == null || targetBusinessId.isEmpty) {
      final l10n = AppLocalizations.of(context)!;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.chooseStaffBusinessMessage),
          backgroundColor: AppColors.errorRed,
        ),
      );
      setState(() => _isLoading = false);
      return;
    }

    try {
      final email = _emailController.text.trim();
      final password = _passwordController.text.trim();
      final uploaded = await _uploadProfileImage(targetBusinessId);

      await authProvider.addStaffUser(
        email: email,
        password: password,
        businessId: targetBusinessId,
        fullName: _nameController.text.trim(),
        phone: _phoneController.text.trim(),
        profileImageUrl: uploaded?.url,
        profileImagePath: uploaded?.path,
      );

      if (mounted) {
        showSuccessSnackBar(
          context,
          AppLocalizations.of(context)!.staffMemberAddedSuccessfully,
        );
        Navigator.pop(context);
      }
    } catch (e) {
      if (mounted) {
        showErrorSnackBar(
          context,
          AppLocalizations.of(context)!.failedToAddStaffMember(e.toString()),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final authProvider = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(
            AppLocalizations.of(context)!.addStaffMember,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.bold,
            ),
          ),
          backgroundColor: Colors.transparent,
          elevation: 0,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        body: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24.0),
            child: Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.1),
                    blurRadius: 20,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    if (authProvider.isAdmin) ...[
                      StreamBuilder<QuerySnapshot>(
                        stream: FirebaseFirestore.instance
                            .collection('businesses')
                            .orderBy('name')
                            .snapshots(),
                        builder: (context, snapshot) {
                          final businesses = snapshot.data?.docs ?? [];
                          return DropdownButtonFormField<String>(
                            initialValue: _selectedBusinessId,
                            decoration: InputDecoration(
                              labelText: l10n.business,
                              prefixIcon: const Icon(Icons.storefront_outlined),
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                              ),
                              filled: true,
                              fillColor: Colors.grey.shade50,
                            ),
                            items: [
                              for (final doc in businesses)
                                DropdownMenuItem<String>(
                                  value: doc.id,
                                  child: Text(
                                    _businessName(doc),
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                            ],
                            onChanged: (value) =>
                                setState(() => _selectedBusinessId = value),
                            validator: (value) => value == null || value.isEmpty
                                ? l10n.chooseStaffBusiness
                                : null,
                          );
                        },
                      ),
                      const SizedBox(height: 20),
                    ],
                    TextFormField(
                      controller: _nameController,
                      textCapitalization: TextCapitalization.words,
                      decoration: InputDecoration(
                        labelText: l10n.fullName,
                        prefixIcon: const Icon(Icons.badge_outlined),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        filled: true,
                        fillColor: Colors.grey.shade50,
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? l10n.fullNameRequired
                          : null,
                    ),
                    const SizedBox(height: 20),
                    CountryPhoneField(
                      controller: _phoneController,
                      labelText: l10n.phone,
                      decoration: InputDecoration(
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        filled: true,
                        fillColor: Colors.grey.shade50,
                      ),
                      validator: (value) => PhoneNumberValidator.validate(
                        value,
                        requiredMessage: l10n.phoneNumberRequired,
                      ),
                    ),
                    const SizedBox(height: 20),
                    InkWell(
                      onTap: _pickImage,
                      borderRadius: BorderRadius.circular(12),
                      child: Row(
                        children: [
                          CircleAvatar(
                            radius: 28,
                            backgroundImage: _profileImageBytes == null
                                ? null
                                : MemoryImage(_profileImageBytes!),
                            child: _profileImageBytes == null
                                ? const Icon(Icons.add_a_photo_outlined)
                                : null,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              AppLocalizations.of(context)!.addProfilePicture,
                              style: const TextStyle(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    TextFormField(
                      controller: _emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: InputDecoration(
                        labelText: AppLocalizations.of(context)!.email,
                        hintText: AppLocalizations.of(context)!.enterStaffEmail,
                        prefixIcon: const Icon(Icons.email_outlined),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: AppColors.brandRed,
                            width: 2,
                          ),
                        ),
                        filled: true,
                        fillColor: Colors.grey.shade50,
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Please enter an email';
                        }
                        if (!RegExp(
                          r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$',
                        ).hasMatch(value)) {
                          return 'Please enter a valid email';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 20),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: true,
                      decoration: InputDecoration(
                        labelText: AppLocalizations.of(context)!.password,
                        hintText: AppLocalizations.of(
                          context,
                        )!.enterTemporaryPassword,
                        prefixIcon: const Icon(Icons.lock_outlined),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: Colors.grey.shade300),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: const BorderSide(
                            color: AppColors.brandRed,
                            width: 2,
                          ),
                        ),
                        filled: true,
                        fillColor: Colors.grey.shade50,
                      ),
                      validator: (value) {
                        if (value == null || value.isEmpty) {
                          return 'Please enter a password';
                        }
                        if (value.length < 6) {
                          return 'Password must be at least 6 characters';
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 32),
                    SizedBox(
                      width: double.infinity,
                      height: 56,
                      child: ElevatedButton(
                        onPressed: _isLoading ? null : _addStaffMember,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.brandRed,
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          elevation: 0,
                        ),
                        child: _isLoading
                            ? const SizedBox(
                                width: 24,
                                height: 24,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    Colors.white,
                                  ),
                                ),
                              )
                            : Text(
                                AppLocalizations.of(context)!.addStaffMember,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _UploadedImage {
  const _UploadedImage({required this.path, required this.url});

  final String path;
  final String url;
}
