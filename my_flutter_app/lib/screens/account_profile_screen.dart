import 'dart:typed_data';

import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/notification_preferences.dart';
import '../providers/auth_provider.dart';
import '../services/biometric_lock_service.dart';
import '../services/push_notification_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/phone_number_validator.dart';
import '../utils/phone_verification_status.dart';
import '../utils/root_navigation.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import 'phone_verification_screen.dart';

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
  NotificationPreferences _preferences = NotificationPreferences.defaults;
  final _biometricLock = BiometricLockService();
  bool _biometricAvailable = false;
  bool _biometricEnabled = false;
  bool _saving = false;
  bool _preparingVerification = false;
  bool _hydrated = false;

  @override
  void initState() {
    super.initState();
    _loadBiometricState();
  }

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
    _preferences = auth.notificationPreferences;
  }

  Future<void> _loadBiometricState() async {
    final results = await Future.wait([
      _biometricLock.canAuthenticate(),
      _biometricLock.isEnabled(),
    ]);
    if (!mounted) return;
    setState(() {
      _biometricAvailable = results.first;
      _biometricEnabled = results.last;
    });
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
        notificationPreferences: _preferences,
      );
      if (_preferences.carActivity ||
          _preferences.shipmentActivity ||
          _preferences.walletActivity ||
          _preferences.businessActivity) {
        try {
          await PushNotificationService().requestPermissionAndRegister();
        } catch (error) {
          debugPrint('Push registration skipped after profile save: $error');
        }
      }
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
    Navigator.maybePop(context);
  }

  Future<void> _setBiometricEnabled(bool value) async {
    final l10n = AppLocalizations.of(context)!;
    if (value && _biometricAvailable) {
      final allowed = await _biometricLock.authenticate(
        reason: l10n.unlockWithFaceId,
      );
      if (!allowed) return;
    }
    await _biometricLock.setEnabled(value);
    if (!mounted) return;
    setState(() => _biometricEnabled = value);
  }

  void _updatePreferences(NotificationPreferences preferences) {
    setState(() => _preferences = preferences);
  }

  Future<void> _verifyPhone() async {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.read<AuthProvider>();
    final status = phoneDraftVerificationState(
      savedPhone: auth.customerPhone,
      draftPhone: _phoneController.text,
      savedPhoneVerified: auth.phoneVerified,
    );
    if (status == PhoneDraftVerificationState.edited) {
      if (!PhoneNumberValidator.isValidE164(_phoneController.text)) {
        showErrorSnackBar(context, l10n.phoneVerificationInvalidPhone);
        return;
      }
      setState(() => _preparingVerification = true);
      try {
        await auth.updateCustomerPhone(_phoneController.text);
      } catch (error) {
        debugPrint('Could not save phone before verification: $error');
        if (!mounted) return;
        showErrorSnackBar(context, l10n.phoneVerificationGenericError);
        return;
      } finally {
        if (mounted) setState(() => _preparingVerification = false);
      }
    }
    if (!mounted) return;
    final verified = await pushRootNamed<bool>(
      context,
      '/verify-phone',
      arguments: const PhoneVerificationArguments(),
    );
    if (!mounted || verified != true) return;
    setState(() {
      _phoneController.text = auth.customerPhone ?? _phoneController.text;
    });
    showSuccessSnackBar(context, l10n.phoneVerificationSuccess);
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    final phoneStatus = phoneDraftVerificationState(
      savedPhone: auth.customerPhone,
      draftPhone: _phoneController.text,
      savedPhoneVerified: auth.phoneVerified,
    );
    final displayedPhoneVerified =
        phoneStatus == PhoneDraftVerificationState.verified;
    final profileBusy = _saving || _preparingVerification;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      appBar: AppBar(
        leading: AppBackButton(onPressed: _close),
        title: Text(l10n.accountProfile),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _ProfileSection(
              child: Column(
                children: [
                  GestureDetector(
                    onTap: _pickImage,
                    child: Stack(
                      alignment: Alignment.bottomRight,
                      children: [
                        CircleAvatar(
                          radius: 52,
                          backgroundColor: AppColors.brandRed.withValues(
                            alpha: 0.12,
                          ),
                          backgroundImage: _imageBytes != null
                              ? MemoryImage(_imageBytes!)
                              : (auth.profileImageUrl ?? '').isEmpty
                              ? null
                              : NetworkImage(auth.profileImageUrl!),
                          child:
                              _imageBytes == null &&
                                  (auth.profileImageUrl ?? '').isEmpty
                              ? const Icon(
                                  Icons.person_outline,
                                  size: 44,
                                  color: AppColors.brandRed,
                                )
                              : null,
                        ),
                        Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            color: AppColors.brandRed,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(color: Colors.white, width: 3),
                          ),
                          child: const Icon(
                            Icons.photo_camera_outlined,
                            color: Colors.white,
                            size: 20,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: _pickImage,
                    child: Text(l10n.changePhoto),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _ProfileSection(
              title: l10n.accountProfile,
              child: Column(
                children: [
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
                    initialValue: auth.userEmail ?? '',
                    readOnly: true,
                    decoration: InputDecoration(labelText: l10n.email),
                  ),
                  const SizedBox(height: 12),
                  CountryPhoneField(
                    controller: _phoneController,
                    enabled: !profileBusy,
                    labelText: l10n.phone,
                    helperText: auth.role == 'customer'
                        ? l10n.phoneVerificationCountryCodeHelp
                        : null,
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return l10n.requiredField;
                      }
                      if (auth.role == 'customer' &&
                          !PhoneNumberValidator.isValidE164(value)) {
                        return l10n.invalidPhoneWithCountryCode;
                      }
                      return PhoneNumberValidator.validate(
                        value,
                        requiredMessage: l10n.requiredField,
                      );
                    },
                    onChanged: (_) => setState(() {}),
                  ),
                  if (auth.role == 'customer') ...[
                    const SizedBox(height: 12),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: displayedPhoneVerified
                            ? AppColors.sage.withValues(alpha: 0.10)
                            : AppColors.warn.withValues(alpha: 0.10),
                        borderRadius: BorderRadius.circular(
                          AppSpacing.radiusMd,
                        ),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Icon(
                                displayedPhoneVerified
                                    ? Icons.verified_outlined
                                    : Icons.info_outline,
                                color: displayedPhoneVerified
                                    ? AppColors.sage
                                    : AppColors.warn,
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      displayedPhoneVerified
                                          ? l10n.phoneVerificationVerified
                                          : l10n.phoneVerificationNotVerified,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                    const SizedBox(height: 3),
                                    Text(
                                      switch (phoneStatus) {
                                        PhoneDraftVerificationState.verified =>
                                          l10n.phoneVerificationVerifiedHelp,
                                        PhoneDraftVerificationState
                                            .unverified =>
                                          l10n.phoneVerificationUnverifiedHelp,
                                        PhoneDraftVerificationState.edited =>
                                          l10n.phoneVerificationEditedStatus,
                                      },
                                      style: Theme.of(
                                        context,
                                      ).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          if (!displayedPhoneVerified) ...[
                            const SizedBox(height: 10),
                            SizedBox(
                              height: 46,
                              child: FilledButton.icon(
                                key: const Key(
                                  'account-phone-verification-action',
                                ),
                                onPressed: profileBusy ? null : _verifyPhone,
                                icon: _preparingVerification
                                    ? SizedBox.square(
                                        dimension: 18,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                          color: Theme.of(
                                            context,
                                          ).colorScheme.onPrimary,
                                        ),
                                      )
                                    : const Icon(Icons.sms_outlined),
                                label: Text(
                                  _preparingVerification
                                      ? l10n.phoneVerificationSavingNumber
                                      : phoneStatus ==
                                            PhoneDraftVerificationState.edited
                                      ? l10n.phoneVerificationSaveAndVerify
                                      : l10n.verifyPhone,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
            const SizedBox(height: 14),
            _ProfileSection(
              title: l10n.notificationPreferences,
              child: Column(
                children: [
                  _PreferenceSwitch(
                    title: l10n.pushNotifications,
                    value: _preferences.pushNotifications,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(pushNotifications: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.emailNotifications,
                    value: _preferences.emailNotifications,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(emailNotifications: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.smsNotifications,
                    value: _preferences.smsNotifications,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(smsNotifications: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.carActivityNotifications,
                    value: _preferences.carActivity,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(carActivity: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.shipmentActivityNotifications,
                    value: _preferences.shipmentActivity,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(shipmentActivity: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.walletActivityNotifications,
                    value: _preferences.walletActivity,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(walletActivity: value),
                    ),
                  ),
                  _PreferenceSwitch(
                    title: l10n.businessActivityNotifications,
                    value: _preferences.businessActivity,
                    onChanged: (value) => _updatePreferences(
                      _preferences.copyWith(businessActivity: value),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 14),
            _ProfileSection(
              title: l10n.faceId,
              child: SwitchListTile.adaptive(
                value: _biometricAvailable && _biometricEnabled,
                onChanged: _biometricAvailable ? _setBiometricEnabled : null,
                contentPadding: EdgeInsets.zero,
                title: Text(l10n.faceIdUnlock),
                subtitle: _biometricAvailable
                    ? null
                    : Text(l10n.faceIdUnavailable),
                secondary: const Icon(Icons.face_outlined),
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                onPressed: profileBusy ? null : _save,
                icon: _saving
                    ? SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: Theme.of(context).colorScheme.onPrimary,
                        ),
                      )
                    : const Icon(Icons.save_outlined),
                label: Text(_saving ? l10n.saving : l10n.saveProfile),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ProfileSection extends StatelessWidget {
  const _ProfileSection({this.title, required this.child});

  final String? title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.lightOutline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Text(
              title!,
              style: Theme.of(
                context,
              ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800),
            ),
            const SizedBox(height: 14),
          ],
          child,
        ],
      ),
    );
  }
}

class _PreferenceSwitch extends StatelessWidget {
  const _PreferenceSwitch({
    required this.title,
    required this.value,
    required this.onChanged,
  });

  final String title;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return SwitchListTile.adaptive(
      value: value,
      onChanged: onChanged,
      contentPadding: EdgeInsets.zero,
      title: Text(title),
    );
  }
}

class _UploadedImage {
  const _UploadedImage({required this.path, required this.url});

  final String path;
  final String url;
}
