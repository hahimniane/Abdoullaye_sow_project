import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../models/marketplace_disclosure_acceptance.dart';
import '../utils/legal_links.dart';
import '../utils/business_registration_navigation.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';

class SignUpScreen extends StatefulWidget {
  const SignUpScreen({super.key});

  @override
  State<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends State<SignUpScreen>
    with TickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();
  bool _isPasswordVisible = false;
  bool _isConfirmPasswordVisible = false;
  bool _legalAccepted = false;
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 1500),
      vsync: this,
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeInOut),
    );
    _slideAnimation =
        Tween<Offset>(begin: const Offset(0, 0.3), end: Offset.zero).animate(
          CurvedAnimation(
            parent: _animationController,
            curve: Curves.easeOutCubic,
          ),
        );
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    _fullNameController.dispose();
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  void _handleSignUp() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_legalAccepted) {
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.accountLegalAcceptanceRequired,
      );
      return;
    }

    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    try {
      final email = _emailController.text.trim();
      final password = _passwordController.text.trim();
      final fullName = _fullNameController.text.trim();
      final phone = _phoneController.text.trim();

      debugPrint('🔵 SignUpScreen: Starting sign up for: $email');
      final success = await authProvider.signUp(
        email: email,
        password: password,
        fullName: fullName,
        phone: phone,
        legalAcceptance: AccountLegalAcceptance(
          locale: Localizations.localeOf(context).languageCode,
        ),
      );
      debugPrint('🔵 SignUpScreen: Sign up returned: $success');

      if (success && mounted) {
        // Show success message
        showSuccessSnackBar(
          context,
          AppLocalizations.of(context)!.accountCreatedSuccessfully,
        );

        final routeArgs = ModalRoute.of(context)?.settings.arguments;
        final shouldReturn =
            routeArgs is Map && routeArgs['returnToPrevious'] == true;
        if (shouldReturn) {
          Navigator.pop(context, true);
          return;
        }

        // Navigate to customer home
        Navigator.pushNamedAndRemoveUntil(context, '/', (route) => false);
      } else if (!success && mounted) {
        // If success is false, show error
        showErrorSnackBar(
          context,
          AppLocalizations.of(context)!.signUpFailedTryAgain,
        );
      }
    } catch (error) {
      debugPrint('🔴 SignUpScreen: Error caught: $error');
      if (mounted) {
        showErrorSnackBar(context, error.toString());
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              // Language Toggle at the top
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Align(
                  alignment: Alignment.topRight,
                  child: const LanguageToggle(),
                ),
              ),
              // Main content
              Expanded(
                child: Center(
                  child: SingleChildScrollView(
                    padding: const EdgeInsets.all(24.0),
                    child: FadeTransition(
                      opacity: _fadeAnimation,
                      child: SlideTransition(
                        position: _slideAnimation,
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            // Logo/Icon
                            Container(
                              width: 120,
                              height: 120,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(60),
                              ),
                              child: const Icon(
                                Icons.person_add,
                                size: 60,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 32),

                            // Welcome Text
                            Text(
                              AppLocalizations.of(context)!.createAccount,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              AppLocalizations.of(context)!.signUpToGetStarted,
                              style: const TextStyle(
                                fontSize: 14,
                                color: Colors.white70,
                              ),
                            ),
                            const SizedBox(height: 12),
                            Padding(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 8,
                              ),
                              child: Text(
                                AppLocalizations.of(
                                  context,
                                )!.accountOptionalMessage,
                                style: const TextStyle(
                                  fontSize: 14,
                                  color: Colors.white70,
                                ),
                                textAlign: TextAlign.center,
                              ),
                            ),
                            const SizedBox(height: 36),

                            // Sign Up Form
                            Container(
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
                                  children: [
                                    // Email Field
                                    TextFormField(
                                      controller: _fullNameController,
                                      textCapitalization:
                                          TextCapitalization.words,
                                      decoration: InputDecoration(
                                        labelText: AppLocalizations.of(
                                          context,
                                        )!.fullName,
                                        hintText: AppLocalizations.of(
                                          context,
                                        )!.enterFullName,
                                        prefixIcon: const Icon(
                                          Icons.person_outline,
                                        ),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: BorderSide(
                                            color: Colors.grey.shade300,
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: const BorderSide(
                                            color: AppColors.brandRed,
                                            width: 2,
                                          ),
                                        ),
                                        filled: true,
                                        fillColor: Colors.grey.shade50,
                                      ),
                                      validator: (value) {
                                        if (value == null ||
                                            value.trim().isEmpty) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterFullName;
                                        }
                                        if (value.trim().length < 2) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterFullName;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 20),
                                    CountryPhoneField(
                                      controller: _phoneController,
                                      labelText: AppLocalizations.of(
                                        context,
                                      )!.phoneNumber,
                                      hintText: AppLocalizations.of(
                                        context,
                                      )!.enterPhoneNumber,
                                      decoration: InputDecoration(
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: BorderSide(
                                            color: Colors.grey.shade300,
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: const BorderSide(
                                            color: AppColors.brandRed,
                                            width: 2,
                                          ),
                                        ),
                                        filled: true,
                                        fillColor: Colors.grey.shade50,
                                      ),
                                      validator: (value) {
                                        return PhoneNumberValidator.validate(
                                          value,
                                          requiredMessage: AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterPhoneNumber,
                                          invalidMessage: AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterPhoneNumber,
                                        );
                                      },
                                    ),
                                    const SizedBox(height: 20),
                                    TextFormField(
                                      controller: _emailController,
                                      keyboardType: TextInputType.emailAddress,
                                      decoration: InputDecoration(
                                        labelText: AppLocalizations.of(
                                          context,
                                        )!.email,
                                        hintText: AppLocalizations.of(
                                          context,
                                        )!.enterEmail,
                                        prefixIcon: const Icon(
                                          Icons.email_outlined,
                                        ),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: BorderSide(
                                            color: Colors.grey.shade300,
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: const BorderSide(
                                            color: AppColors.brandRed,
                                            width: 2,
                                          ),
                                        ),
                                        filled: true,
                                        fillColor: Colors.grey.shade50,
                                      ),
                                      validator: (value) {
                                        if (value == null ||
                                            value.trim().isEmpty) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterEmail;
                                        }
                                        if (!RegExp(
                                          r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$',
                                        ).hasMatch(value)) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterValidEmail;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 20),

                                    // Password Field
                                    TextFormField(
                                      controller: _passwordController,
                                      obscureText: !_isPasswordVisible,
                                      decoration: InputDecoration(
                                        labelText: AppLocalizations.of(
                                          context,
                                        )!.password,
                                        hintText: AppLocalizations.of(
                                          context,
                                        )!.enterPassword,
                                        prefixIcon: const Icon(
                                          Icons.lock_outlined,
                                        ),
                                        suffixIcon: IconButton(
                                          icon: Icon(
                                            _isPasswordVisible
                                                ? Icons.visibility_off
                                                : Icons.visibility,
                                          ),
                                          onPressed: () {
                                            setState(() {
                                              _isPasswordVisible =
                                                  !_isPasswordVisible;
                                            });
                                          },
                                        ),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: BorderSide(
                                            color: Colors.grey.shade300,
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
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
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterPassword;
                                        }
                                        if (value.length < 6) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.passwordMinLength;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 20),

                                    // Confirm Password Field
                                    TextFormField(
                                      controller: _confirmPasswordController,
                                      obscureText: !_isConfirmPasswordVisible,
                                      decoration: InputDecoration(
                                        labelText: AppLocalizations.of(
                                          context,
                                        )!.confirmPassword,
                                        hintText: AppLocalizations.of(
                                          context,
                                        )!.reEnterPassword,
                                        prefixIcon: const Icon(
                                          Icons.lock_outlined,
                                        ),
                                        suffixIcon: IconButton(
                                          icon: Icon(
                                            _isConfirmPasswordVisible
                                                ? Icons.visibility_off
                                                : Icons.visibility,
                                          ),
                                          onPressed: () {
                                            setState(() {
                                              _isConfirmPasswordVisible =
                                                  !_isConfirmPasswordVisible;
                                            });
                                          },
                                        ),
                                        border: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                        ),
                                        enabledBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
                                          borderSide: BorderSide(
                                            color: Colors.grey.shade300,
                                          ),
                                        ),
                                        focusedBorder: OutlineInputBorder(
                                          borderRadius: BorderRadius.circular(
                                            12,
                                          ),
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
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseConfirmPassword;
                                        }
                                        if (value != _passwordController.text) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.passwordsDoNotMatch;
                                        }
                                        return null;
                                      },
                                    ),
                                    const SizedBox(height: 18),
                                    CheckboxListTile(
                                      contentPadding: EdgeInsets.zero,
                                      controlAffinity:
                                          ListTileControlAffinity.leading,
                                      value: _legalAccepted,
                                      onChanged: (value) => setState(
                                        () => _legalAccepted = value ?? false,
                                      ),
                                      title: Text(
                                        AppLocalizations.of(
                                          context,
                                        )!.accountLegalAcceptance,
                                      ),
                                    ),
                                    Wrap(
                                      alignment: WrapAlignment.center,
                                      children: [
                                        TextButton(
                                          onPressed: () => openLaawolLegalPage(
                                            context,
                                            privacy: false,
                                          ),
                                          child: Text(
                                            AppLocalizations.of(
                                              context,
                                            )!.termsOfService,
                                          ),
                                        ),
                                        TextButton(
                                          onPressed: () => openLaawolLegalPage(
                                            context,
                                            privacy: true,
                                          ),
                                          child: Text(
                                            AppLocalizations.of(
                                              context,
                                            )!.privacyPolicy,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 20),

                                    // Sign Up Button
                                    Consumer<AuthProvider>(
                                      builder: (context, authProvider, child) {
                                        return SizedBox(
                                          width: double.infinity,
                                          height: 56,
                                          child: ElevatedButton(
                                            onPressed: authProvider.isLoading
                                                ? null
                                                : _handleSignUp,
                                            style: ElevatedButton.styleFrom(
                                              backgroundColor:
                                                  AppColors.brandRed,
                                              foregroundColor: Colors.white,
                                              shape: RoundedRectangleBorder(
                                                borderRadius:
                                                    BorderRadius.circular(12),
                                              ),
                                              elevation: 0,
                                            ),
                                            child: authProvider.isLoading
                                                ? const SizedBox(
                                                    width: 24,
                                                    height: 24,
                                                    child: CircularProgressIndicator(
                                                      strokeWidth: 2,
                                                      valueColor:
                                                          AlwaysStoppedAnimation<
                                                            Color
                                                          >(Colors.white),
                                                    ),
                                                  )
                                                : Text(
                                                    AppLocalizations.of(
                                                      context,
                                                    )!.signUp,
                                                    style: const TextStyle(
                                                      fontSize: 16,
                                                      fontWeight:
                                                          FontWeight.w600,
                                                    ),
                                                  ),
                                          ),
                                        );
                                      },
                                    ),
                                    const SizedBox(height: 24),

                                    // Already have account - Sign In
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Text(
                                          AppLocalizations.of(
                                            context,
                                          )!.alreadyHaveAccount,
                                          style: TextStyle(
                                            color: Colors.grey.shade600,
                                            fontSize: 14,
                                          ),
                                        ),
                                        TextButton(
                                          onPressed: () {
                                            final routeArgs = ModalRoute.of(
                                              context,
                                            )?.settings.arguments;
                                            final shouldReturn =
                                                routeArgs is Map &&
                                                routeArgs['returnToPrevious'] ==
                                                    true;
                                            if (shouldReturn) {
                                              Navigator.pushReplacementNamed(
                                                context,
                                                '/login',
                                                arguments: const {
                                                  'returnToPrevious': true,
                                                },
                                              );
                                              return;
                                            }
                                            Navigator.pushNamed(
                                              context,
                                              '/login',
                                            );
                                          },
                                          style: TextButton.styleFrom(
                                            splashFactory:
                                                NoSplash.splashFactory,
                                          ),
                                          child: Text(
                                            AppLocalizations.of(
                                              context,
                                            )!.signIn,
                                            style: const TextStyle(
                                              color: AppColors.brandRed,
                                              fontSize: 14,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 8),
                                    OutlinedButton.icon(
                                      onPressed: () {
                                        openBusinessRegistration(context);
                                      },
                                      icon: const Icon(
                                        Icons.storefront_outlined,
                                      ),
                                      label: Text(
                                        AppLocalizations.of(
                                          context,
                                        )!.registerBusinessInstead,
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.cobaltDeep,
                                        side: const BorderSide(
                                          color: AppColors.cobaltDeep,
                                        ),
                                        minimumSize: const Size.fromHeight(48),
                                      ),
                                    ),
                                  ],
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
            ],
          ),
        ),
      ),
    );
  }
}
