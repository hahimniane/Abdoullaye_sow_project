import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/app_feedback.dart';
import '../utils/auth_navigation.dart';
import '../utils/business_registration_navigation.dart';
import '../widgets/app_snackbars.dart';

@visibleForTesting
bool isValidLoginEmail(String value) {
  return RegExp(r'^[\w-\.]+@([\w-]+\.)+[\w-]{2,}$').hasMatch(value.trim());
}

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen>
    with TickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _isPasswordVisible = false;
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
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  void _handleLogin() async {
    if (!_formKey.currentState!.validate()) return;

    final authProvider = Provider.of<AuthProvider>(context, listen: false);

    try {
      final email = _emailController.text.trim();
      final password = _passwordController.text.trim();

      debugPrint('🔵 LoginScreen: Attempting email login');
      debugPrint('🔵 LoginScreen: Calling authProvider.authenticate()...');

      final success = await authProvider.authenticate(email, password);

      debugPrint('🔵 LoginScreen: Authentication result: $success');
      debugPrint('🔵 LoginScreen: isStaff: ${authProvider.isStaff}');
      debugPrint(
        '🔵 LoginScreen: isBusinessOwner: ${authProvider.isBusinessOwner}',
      );
      debugPrint('🔵 LoginScreen: isAdmin: ${authProvider.isAdmin}');

      if (success && mounted) {
        await AppFeedback.success();
        if (!mounted) return;
        final routeArgs = ModalRoute.of(context)?.settings.arguments;
        final shouldReturn =
            routeArgs is Map && routeArgs['returnToPrevious'] == true;
        if (shouldReturn) {
          Navigator.pop(context, true);
          return;
        }

        if (authProvider.hasBusinessDashboardAccess) {
          debugPrint('🔵 LoginScreen: Navigating to business dashboard');
          navigateAfterLogin(context, hasBusinessDashboardAccess: true);
        } else {
          debugPrint('🔵 LoginScreen: Navigating to customer home');
          // Regular customer - go to customer home
          navigateAfterLogin(context, hasBusinessDashboardAccess: false);
        }
      }
    } catch (error) {
      debugPrint('🔴 LoginScreen: Login error: $error');
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
                            Container(
                              width: 112,
                              height: 112,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.14),
                                borderRadius: BorderRadius.circular(24),
                                border: Border.all(
                                  color: Colors.white.withValues(alpha: 0.22),
                                ),
                              ),
                              child: const Icon(
                                Icons.storefront,
                                size: 58,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 32),

                            // Welcome Text
                            Text(
                              AppLocalizations.of(context)!.accountLoginTitle,
                              style: const TextStyle(
                                fontSize: 22,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 8),
                            Text(
                              AppLocalizations.of(
                                context,
                              )!.accountLoginSubtitle,
                              style: const TextStyle(
                                fontSize: 14,
                                color: Colors.white70,
                              ),
                              textAlign: TextAlign.center,
                            ),
                            const SizedBox(height: 48),

                            // Login Form
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
                                    TextFormField(
                                      controller: _emailController,
                                      keyboardType: TextInputType.emailAddress,
                                      decoration: InputDecoration(
                                        labelText: AppLocalizations.of(
                                          context,
                                        )!.email,
                                        hintText: AppLocalizations.of(
                                          context,
                                        )!.pleaseEnterEmail,
                                        prefixIcon: const Icon(
                                          Icons.alternate_email_outlined,
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
                                        final trimmed = value?.trim() ?? '';
                                        if (trimmed.isEmpty) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.pleaseEnterEmail;
                                        }
                                        if (!isValidLoginEmail(trimmed)) {
                                          return AppLocalizations.of(
                                            context,
                                          )!.validEmailRequired;
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
                                    const SizedBox(height: 32),

                                    // Login Button
                                    Consumer<AuthProvider>(
                                      builder: (context, authProvider, child) {
                                        return SizedBox(
                                          width: double.infinity,
                                          height: 56,
                                          child: ElevatedButton(
                                            onPressed: authProvider.isLoading
                                                ? null
                                                : _handleLogin,
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
                                                    )!.signIn,
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
                                    const SizedBox(height: 16),

                                    // Forgot Password
                                    TextButton(
                                      onPressed: () {
                                        openForgotPassword(context);
                                      },
                                      style: TextButton.styleFrom(
                                        splashFactory: NoSplash.splashFactory,
                                      ),
                                      child: Text(
                                        AppLocalizations.of(
                                          context,
                                        )!.forgotPassword,
                                        style: const TextStyle(
                                          color: AppColors.brandRed,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                    const SizedBox(height: 8),

                                    // Divider
                                    Divider(
                                      color: Colors.grey.shade300,
                                      thickness: 1,
                                    ),
                                    const SizedBox(height: 8),

                                    // Don't have account - Sign Up (for customers)
                                    Row(
                                      mainAxisAlignment:
                                          MainAxisAlignment.center,
                                      children: [
                                        Text(
                                          AppLocalizations.of(
                                            context,
                                          )!.dontHaveAccount,
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
                                                '/signup',
                                                arguments: const {
                                                  'returnToPrevious': true,
                                                },
                                              );
                                              return;
                                            }
                                            Navigator.pushNamed(
                                              context,
                                              '/signup',
                                            );
                                          },
                                          style: TextButton.styleFrom(
                                            splashFactory:
                                                NoSplash.splashFactory,
                                          ),
                                          child: Text(
                                            AppLocalizations.of(
                                              context,
                                            )!.signUp,
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
                                        )!.registerYourBusiness,
                                      ),
                                      style: OutlinedButton.styleFrom(
                                        foregroundColor: AppColors.cobaltDeep,
                                        side: const BorderSide(
                                          color: AppColors.cobaltDeep,
                                        ),
                                        minimumSize: const Size.fromHeight(48),
                                      ),
                                    ),
                                    const SizedBox(height: 8),

                                    // Back to Customer Home
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
                                          Navigator.pop(context, false);
                                          return;
                                        }
                                        Navigator.pushNamedAndRemoveUntil(
                                          context,
                                          '/',
                                          (route) => false,
                                        );
                                      },
                                      style: TextButton.styleFrom(
                                        splashFactory: NoSplash.splashFactory,
                                      ),
                                      child: Text(
                                        AppLocalizations.of(
                                          context,
                                        )!.backToCustomerHome,
                                        style: const TextStyle(
                                          color: AppColors.brandRed,
                                          fontSize: 14,
                                        ),
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
