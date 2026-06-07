import 'package:firebase_storage/firebase_storage.dart' as firebase_storage;
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/business_service.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';

class BusinessRegistrationScreen extends StatefulWidget {
  const BusinessRegistrationScreen({super.key});

  @override
  State<BusinessRegistrationScreen> createState() =>
      _BusinessRegistrationScreenState();
}

class _BusinessRegistrationScreenState
    extends State<BusinessRegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _ownerNameController = TextEditingController();
  final _ownerPhoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  final _businessNameController = TextEditingController();
  final _businessPhoneController = TextEditingController();
  final _businessEmailController = TextEditingController();
  final _businessWebsiteController = TextEditingController();
  final _serviceNoteController = TextEditingController();
  final _selectedServices = <String>{...defaultBusinessServiceValues};
  XFile? _profileImage;
  Uint8List? _profileImageBytes;
  bool _isSubmitting = false;
  bool _passwordVisible = false;
  bool _prefilledSignedInAccount = false;

  @override
  void dispose() {
    _ownerNameController.dispose();
    _ownerPhoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    _businessNameController.dispose();
    _businessPhoneController.dispose();
    _businessEmailController.dispose();
    _businessWebsiteController.dispose();
    _serviceNoteController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    if (!_formKey.currentState!.validate()) return;
    if (_selectedServices.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(l10n.chooseAtLeastOneBusinessService),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.submitBusinessApplicationQuestion,
      message: l10n.submitBusinessApplicationMessage,
      confirmLabel: l10n.submitApplication,
      icon: Icons.storefront_outlined,
    );
    if (!confirmed || !mounted) return;

    final auth = context.read<AuthProvider>();
    setState(() => _isSubmitting = true);

    try {
      if (!auth.isAuthenticated) {
        await auth.signUp(
          email: _emailController.text.trim(),
          password: _passwordController.text.trim(),
          fullName: _ownerNameController.text.trim(),
          phone: _ownerPhoneController.text.trim(),
        );
      }

      final application = await auth.submitBusinessApplication(
        ownerName: _ownerNameController.text.trim().isNotEmpty
            ? _ownerNameController.text.trim()
            : auth.buyerName,
        ownerPhone: _ownerPhoneController.text.trim().isNotEmpty
            ? _ownerPhoneController.text.trim()
            : auth.customerPhone ?? '',
        businessName: _businessNameController.text.trim(),
        businessPhone: _businessPhoneController.text.trim(),
        businessEmail: _businessEmailController.text.trim().isNotEmpty
            ? _businessEmailController.text.trim()
            : auth.userEmail ?? _emailController.text.trim(),
        businessWebsite: _businessWebsiteController.text.trim(),
        enabledServices: _selectedServices.toList(),
        serviceNote: _serviceNoteController.text.trim(),
        addressLine1: '',
        city: '',
        state: '',
        postalCode: '',
      );
      final businessId = application['businessId'] as String?;
      if (businessId != null &&
          businessId.isNotEmpty &&
          _profileImageBytes != null) {
        final upload = await _uploadBusinessProfileImage(businessId);
        await auth.updateBusinessProfile(
          businessId: businessId,
          name: _businessNameController.text.trim(),
          phone: _businessPhoneController.text.trim(),
          email: _businessEmailController.text.trim().isNotEmpty
              ? _businessEmailController.text.trim()
              : auth.userEmail ?? _emailController.text.trim(),
          website: _businessWebsiteController.text.trim(),
          enabledServices: _selectedServices.toList(),
          profileImageUrl: upload.url,
          profileImagePath: upload.path,
          serviceNote: _serviceNoteController.text.trim(),
          addressLine1: '',
          city: '',
          state: '',
          postalCode: '',
          carHoldPricingMode: 'flat',
          carHoldFlatFee: 500,
          carHoldDailyRate: 100,
          carHoldMaxDays: 14,
        );
      }

      if (!mounted) return;
      showSuccessSnackBar(
        context,
        'Business application submitted. You can set up your dashboard now.',
      );
      Navigator.pushNamedAndRemoveUntil(
        context,
        '/staff-home',
        (route) => false,
      );
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(context, '$error');
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  Future<void> _pickProfileImage() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 82,
      maxWidth: 1200,
    );
    if (picked == null) return;
    final bytes = await picked.readAsBytes();
    if (!mounted) return;
    setState(() {
      _profileImage = picked;
      _profileImageBytes = bytes;
    });
  }

  Future<_UploadedImage> _uploadBusinessProfileImage(String businessId) async {
    final image = _profileImage;
    final bytes = _profileImageBytes;
    if (image == null || bytes == null) {
      throw 'Please choose a business image first.';
    }
    final ext = (image.name.split('.').last).toLowerCase();
    final safeExt = ['jpg', 'jpeg', 'png', 'webp'].contains(ext) ? ext : 'jpg';
    final path =
        'businesses/$businessId/profile/profile_${DateTime.now().millisecondsSinceEpoch}.$safeExt';
    final contentType = safeExt == 'png'
        ? 'image/png'
        : safeExt == 'webp'
        ? 'image/webp'
        : 'image/jpeg';
    final ref = firebase_storage.FirebaseStorage.instance.ref(path);
    await ref.putData(
      bytes,
      firebase_storage.SettableMetadata(contentType: contentType),
    );
    return _UploadedImage(path: path, url: await ref.getDownloadURL());
  }

  String? _required(String? value, String message) {
    return value == null || value.trim().isEmpty ? message : null;
  }

  String? _emailValidator(String? value, {bool required = true}) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return required ? 'Email is required' : null;
    if (!RegExp(r'^[\w\-.]+@([\w-]+\.)+[\w-]{2,4}$').hasMatch(trimmed)) {
      return 'Please enter a valid email';
    }
    return null;
  }

  String? _websiteValidator(String? value) {
    final trimmed = value?.trim() ?? '';
    if (trimmed.isEmpty) return null;
    final normalized = trimmed.startsWith(RegExp(r'https?://'))
        ? trimmed
        : 'https://$trimmed';
    final uri = Uri.tryParse(normalized);
    if (uri == null ||
        !uri.hasScheme ||
        uri.host.isEmpty ||
        !uri.host.contains('.')) {
      return 'Please enter a valid website';
    }
    return null;
  }

  void _scheduleSignedInPrefill(AuthProvider auth) {
    if (_prefilledSignedInAccount || !auth.isAuthenticated) return;
    _prefilledSignedInAccount = true;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      if (_ownerNameController.text.trim().isEmpty &&
          auth.buyerName != 'Customer') {
        _ownerNameController.text = auth.buyerName;
      }
      if (_ownerPhoneController.text.trim().isEmpty &&
          (auth.customerPhone ?? '').isNotEmpty) {
        _ownerPhoneController.text = auth.customerPhone!;
      }
      if (_businessEmailController.text.trim().isEmpty &&
          (auth.userEmail ?? '').isNotEmpty) {
        _businessEmailController.text = auth.userEmail!;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final isSignedIn = auth.isAuthenticated;
    _scheduleSignedInPrefill(auth);

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [AppColors.cobaltDeep, AppColors.cobalt, AppColors.lightBg],
            stops: [0, 0.32, 0.32],
          ),
        ),
        child: SafeArea(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 16, 4),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        l10n.registerYourBusiness,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w900,
                          fontSize: 18,
                        ),
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(20, 18, 20, 28),
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 820),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            const _BusinessRegistrationHero(),
                            const SizedBox(height: 16),
                            _ProfileImagePicker(
                              imageBytes: _profileImageBytes,
                              onPick: _pickProfileImage,
                            ),
                            const SizedBox(height: 14),
                            _Section(
                              icon: Icons.person_outline,
                              title: l10n.ownerAccount,
                              subtitle: isSignedIn
                                  ? l10n.ownerSignedInSubtitle
                                  : l10n.ownerCreateLoginSubtitle,
                              children: [
                                _TextField(
                                  controller: _ownerNameController,
                                  label: l10n.ownerFullName,
                                  icon: Icons.badge_outlined,
                                  validator: (value) => _required(
                                    value,
                                    l10n.ownerNameRequiredShort,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                _TextField(
                                  controller: _ownerPhoneController,
                                  label: l10n.ownerPhone,
                                  icon: Icons.phone_outlined,
                                  keyboardType: TextInputType.phone,
                                  inputFormatters: PhoneNumberValidator
                                      .allowedInputFormatters,
                                  validator: (value) =>
                                      PhoneNumberValidator.validate(
                                        value,
                                        requiredMessage:
                                            l10n.ownerPhoneRequired,
                                      ),
                                ),
                                if (!isSignedIn) ...[
                                  const SizedBox(height: 12),
                                  _TextField(
                                    controller: _emailController,
                                    label: l10n.ownerEmail,
                                    icon: Icons.email_outlined,
                                    keyboardType: TextInputType.emailAddress,
                                    validator: _emailValidator,
                                  ),
                                  const SizedBox(height: 12),
                                  _TextField(
                                    controller: _passwordController,
                                    label: l10n.password,
                                    icon: Icons.lock_outline,
                                    obscureText: !_passwordVisible,
                                    suffixIcon: IconButton(
                                      onPressed: () => setState(
                                        () => _passwordVisible =
                                            !_passwordVisible,
                                      ),
                                      icon: Icon(
                                        _passwordVisible
                                            ? Icons.visibility_off
                                            : Icons.visibility,
                                      ),
                                    ),
                                    validator: (value) {
                                      if (value == null || value.isEmpty) {
                                        return l10n.passwordRequired;
                                      }
                                      if (value.length < 6) {
                                        return l10n.passwordMinLength;
                                      }
                                      return null;
                                    },
                                  ),
                                  const SizedBox(height: 12),
                                  _TextField(
                                    controller: _confirmPasswordController,
                                    label: l10n.confirmPassword,
                                    icon: Icons.lock_outline,
                                    obscureText: true,
                                    validator: (value) {
                                      if (value != _passwordController.text) {
                                        return l10n.passwordsDoNotMatch;
                                      }
                                      return null;
                                    },
                                  ),
                                ],
                              ],
                            ),
                            const SizedBox(height: 14),
                            _Section(
                              icon: Icons.dashboard_customize_outlined,
                              title: l10n.servicesYouOffer,
                              subtitle: l10n.servicesOfferSubtitle,
                              children: [
                                for (final service in businessServiceCatalog)
                                  Padding(
                                    padding: const EdgeInsets.only(bottom: 10),
                                    child: _ServiceChoiceTile(
                                      service: service,
                                      selected: _selectedServices.contains(
                                        service.key.value,
                                      ),
                                      onChanged: (selected) {
                                        setState(() {
                                          if (selected) {
                                            _selectedServices.add(
                                              service.key.value,
                                            );
                                          } else {
                                            _selectedServices.remove(
                                              service.key.value,
                                            );
                                          }
                                        });
                                      },
                                    ),
                                  ),
                              ],
                            ),
                            const SizedBox(height: 14),
                            _Section(
                              icon: Icons.storefront_outlined,
                              title: l10n.businessProfile,
                              subtitle: l10n.businessProfileApprovalSubtitle,
                              children: [
                                _TextField(
                                  controller: _businessNameController,
                                  label: l10n.businessName,
                                  icon: Icons.apartment_outlined,
                                  validator: (value) => _required(
                                    value,
                                    l10n.businessNameRequired,
                                  ),
                                ),
                                const SizedBox(height: 12),
                                _TextField(
                                  controller: _businessPhoneController,
                                  label: l10n.businessPhone,
                                  icon: Icons.call_outlined,
                                  keyboardType: TextInputType.phone,
                                  inputFormatters: PhoneNumberValidator
                                      .allowedInputFormatters,
                                  validator: (value) {
                                    final trimmed = value?.trim() ?? '';
                                    if (trimmed.isEmpty) return null;
                                    return PhoneNumberValidator.validate(
                                      value,
                                      requiredMessage:
                                          l10n.businessPhoneRequired,
                                      invalidMessage:
                                          l10n.validBusinessPhoneRequired,
                                    );
                                  },
                                ),
                                const SizedBox(height: 12),
                                _TextField(
                                  controller: _businessEmailController,
                                  label: l10n.businessEmail,
                                  icon: Icons.alternate_email,
                                  keyboardType: TextInputType.emailAddress,
                                  validator: (value) =>
                                      _emailValidator(value, required: false),
                                ),
                                const SizedBox(height: 12),
                                _TextField(
                                  controller: _businessWebsiteController,
                                  label: l10n.website,
                                  icon: Icons.language_outlined,
                                  keyboardType: TextInputType.url,
                                  validator: _websiteValidator,
                                ),
                                const SizedBox(height: 12),
                                _TextField(
                                  controller: _serviceNoteController,
                                  label: l10n.serviceNote,
                                  icon: Icons.notes_outlined,
                                  minLines: 3,
                                  maxLines: 5,
                                ),
                              ],
                            ),
                            const SizedBox(height: 18),
                            SizedBox(
                              height: 58,
                              child: FilledButton.icon(
                                onPressed: _isSubmitting ? null : _submit,
                                icon: _isSubmitting
                                    ? const SizedBox(
                                        width: 20,
                                        height: 20,
                                        child: CircularProgressIndicator(
                                          strokeWidth: 2,
                                        ),
                                      )
                                    : const Icon(Icons.send_outlined),
                                label: Text(
                                  _isSubmitting
                                      ? l10n.submittingApplication
                                      : l10n.submitBusinessApplication,
                                ),
                              ),
                            ),
                            const SizedBox(height: 12),
                            const Text(
                              'You can set up destinations, cars, and staff immediately. Customers will only see your business after platform approval.',
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                color: AppColors.muted,
                                fontWeight: FontWeight.w600,
                                height: 1.35,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
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

class _ProfileImagePicker extends StatelessWidget {
  const _ProfileImagePicker({required this.imageBytes, required this.onPick});

  final Uint8List? imageBytes;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onPick,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            CircleAvatar(
              radius: 30,
              backgroundColor: AppColors.cobalt.withValues(alpha: 0.12),
              backgroundImage: imageBytes == null
                  ? null
                  : MemoryImage(imageBytes!),
              child: imageBytes == null
                  ? const Icon(Icons.add_a_photo_outlined)
                  : null,
            ),
            const SizedBox(width: 14),
            const Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Business profile picture',
                    style: TextStyle(fontWeight: FontWeight.w900),
                  ),
                  SizedBox(height: 3),
                  Text(
                    'Upload a logo or storefront image customers can recognize.',
                    style: TextStyle(
                      color: AppColors.muted,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}

class _ServiceChoiceTile extends StatelessWidget {
  const _ServiceChoiceTile({
    required this.service,
    required this.selected,
    required this.onChanged,
  });

  final BusinessServiceDefinition service;
  final bool selected;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected
          ? AppColors.cobalt.withValues(alpha: 0.08)
          : AppColors.lightSurface,
      borderRadius: BorderRadius.circular(8),
      child: CheckboxListTile(
        value: selected,
        onChanged: (value) => onChanged(value ?? false),
        controlAffinity: ListTileControlAffinity.trailing,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: BorderSide(color: selected ? AppColors.cobalt : AppColors.rule),
        ),
        secondary: Icon(service.icon, color: AppColors.cobaltDeep),
        title: Text(
          service.label,
          style: const TextStyle(fontWeight: FontWeight.w900),
        ),
        subtitle: Text(service.description),
      ),
    );
  }
}

class _BusinessRegistrationHero extends StatelessWidget {
  const _BusinessRegistrationHero();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
      ),
      child: const Row(
        children: [
          Icon(Icons.business_center_outlined, color: Colors.white, size: 42),
          SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Join the marketplace',
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 18,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                SizedBox(height: 4),
                Text(
                  'Apply once, prepare your operations, then go live when approved.',
                  style: TextStyle(color: Colors.white70, height: 1.3),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.children,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.cobaltDeep),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }
}

class _TextField extends StatelessWidget {
  const _TextField({
    required this.controller,
    required this.label,
    required this.icon,
    this.validator,
    this.keyboardType,
    this.inputFormatters,
    this.obscureText = false,
    this.suffixIcon,
    this.minLines,
    this.maxLines,
  });

  final TextEditingController controller;
  final String label;
  final IconData icon;
  final String? Function(String?)? validator;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final bool obscureText;
  final Widget? suffixIcon;
  final int? minLines;
  final int? maxLines;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      keyboardType: keyboardType,
      inputFormatters: inputFormatters,
      obscureText: obscureText,
      minLines: obscureText ? 1 : minLines,
      maxLines: obscureText ? 1 : maxLines ?? 1,
      decoration: InputDecoration(
        labelText: label,
        prefixIcon: Icon(icon),
        suffixIcon: suffixIcon,
      ),
      validator: validator,
    );
  }
}
