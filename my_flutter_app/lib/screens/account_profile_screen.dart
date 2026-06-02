import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';

class AccountProfileScreen extends StatefulWidget {
  const AccountProfileScreen({super.key, this.onBack});

  final VoidCallback? onBack;

  @override
  State<AccountProfileScreen> createState() => _AccountProfileScreenState();
}

class _AccountProfileScreenState extends State<AccountProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  XFile? _image;
  Uint8List? _imageBytes;
  bool _saving = false;
  bool _hydrated = false;

  @override
  void dispose() {
    _nameController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_hydrated) return;
    final auth = context.read<AuthProvider>();
    _hydrated = true;
    _nameController.text = auth.customerName ?? auth.buyerName;
    _phoneController.text = auth.customerPhone ?? '';
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
      _image = picked;
      _imageBytes = bytes;
    });
  }

  Future<_UploadedImage?> _uploadImage(String uid) async {
    final image = _image;
    final bytes = _imageBytes;
    if (image == null || bytes == null) return null;
    final ext = image.name.split('.').last.toLowerCase();
    final safeExt = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'jpg';
    final path =
        'users/$uid/profile/profile_${DateTime.now().millisecondsSinceEpoch}.$safeExt';
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

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (!_formKey.currentState!.validate()) return;
    final auth = context.read<AuthProvider>();
    final uid = auth.user?.uid;
    if (uid == null) return;
    setState(() => _saving = true);
    try {
      final uploaded = await _uploadImage(uid);
      await auth.updateAccountProfile(
        fullName: _nameController.text,
        phone: _phoneController.text,
        profileImageUrl: uploaded?.url,
        profileImagePath: uploaded?.path,
      );
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.profileSaved);
      _close();
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, '$error');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _close() {
    final onBack = widget.onBack;
    if (onBack != null) {
      onBack();
      return;
    }
    Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        leading: widget.onBack == null
            ? null
            : IconButton(
                onPressed: _close,
                icon: const Icon(Icons.arrow_back_ios_new),
              ),
        title: Text(l10n.accountProfile),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Center(
              child: GestureDetector(
                onTap: _pickImage,
                child: CircleAvatar(
                  radius: 46,
                  backgroundImage: _imageBytes != null
                      ? MemoryImage(_imageBytes!)
                      : (auth.profileImageUrl ?? '').isEmpty
                      ? null
                      : NetworkImage(auth.profileImageUrl!),
                  child:
                      _imageBytes == null &&
                          (auth.profileImageUrl ?? '').isEmpty
                      ? const Icon(Icons.add_a_photo_outlined, size: 30)
                      : null,
                ),
              ),
            ),
            const SizedBox(height: 20),
            TextFormField(
              controller: _nameController,
              textCapitalization: TextCapitalization.words,
              decoration: InputDecoration(labelText: l10n.fullName),
              validator: (value) => value == null || value.trim().isEmpty
                  ? l10n.requiredField
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _phoneController,
              keyboardType: TextInputType.phone,
              inputFormatters: PhoneNumberValidator.allowedInputFormatters,
              decoration: InputDecoration(labelText: l10n.phone),
              validator: (value) => PhoneNumberValidator.validate(
                value,
                requiredMessage: l10n.requiredField,
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                onPressed: _saving ? null : _save,
                icon: _saving
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.save_outlined),
                label: Text(_saving ? 'Saving' : 'Save profile'),
              ),
            ),
          ],
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
