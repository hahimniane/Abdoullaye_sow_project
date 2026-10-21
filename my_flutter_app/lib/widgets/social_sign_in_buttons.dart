import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/social_sign_in.dart';
import '../utils/auth_error_text.dart';
import 'app_snackbars.dart';

/// The Google/Apple buttons of a sign-in screen, wired to [AuthProvider]:
/// closing the Google/Apple sheet shows nothing, any other failure a
/// localized snackbar, and a successful sign-in hands over to [onSignedIn]
/// (the screen routes by role, as after an email sign-in).
class SocialSignInSection extends StatelessWidget {
  const SocialSignInSection({super.key, required this.onSignedIn});

  final Future<void> Function(AuthProvider authProvider) onSignedIn;

  Future<void> _signIn(BuildContext context, SocialProvider provider) async {
    final authProvider = context.read<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    try {
      final outcome = await authProvider.signInWithSocial(provider);
      if (!context.mounted || outcome != SocialSignInOutcome.signedIn) return;
      await onSignedIn(authProvider);
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, authFailureMessage(l10n, error));
    }
  }

  @override
  Widget build(BuildContext context) {
    final providers = socialProvidersForThisDevice;
    if (providers.isEmpty) return const SizedBox.shrink();
    return Consumer<AuthProvider>(
      builder: (context, authProvider, _) => SocialSignInButtons(
        providers: providers,
        busyProvider: authProvider.socialSignInInFlight,
        enabled: !authProvider.isSigningIn,
        onPressed: (provider) => _signIn(context, provider),
      ),
    );
  }
}

/// "Continue with Google" (Google's standard look: white, the four-colour
/// "G", dark label) and, on iOS, "Continue with Apple" (Apple's black
/// button). Shown under the email/password and phone sign-in, never in
/// place of them.
///
/// The busy state belongs to the caller (AuthProvider.socialSignInInFlight):
/// the tapped button shows a spinner and every button is disabled while any
/// sign-in runs, so a second tap starts nothing.
class SocialSignInButtons extends StatelessWidget {
  const SocialSignInButtons({
    super.key,
    required this.providers,
    required this.onPressed,
    this.busyProvider,
    this.enabled = true,
    this.showDivider = true,
  });

  /// From [socialProvidersFor] / [socialProvidersForThisDevice].
  final List<SocialProvider> providers;
  final ValueChanged<SocialProvider> onPressed;

  /// The provider whose sign-in is running, if any.
  final SocialProvider? busyProvider;

  /// False while any sign-in (email, phone, Google, Apple) runs.
  final bool enabled;

  /// The "or" rule above the buttons.
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    if (providers.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final canTap = enabled && busyProvider == null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (showDivider) ...[
          Row(
            children: [
              Expanded(child: Divider(color: Colors.grey.shade300)),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                child: Text(
                  l10n.socialSignInDivider,
                  style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
                ),
              ),
              Expanded(child: Divider(color: Colors.grey.shade300)),
            ],
          ),
          const SizedBox(height: 12),
        ],
        for (final (index, provider) in providers.indexed) ...[
          if (index > 0) const SizedBox(height: 10),
          _SocialButton(
            provider: provider,
            label: switch (provider) {
              SocialProvider.google => l10n.continueWithGoogle,
              SocialProvider.apple => l10n.continueWithApple,
            },
            busy: busyProvider == provider,
            onPressed: canTap ? () => onPressed(provider) : null,
          ),
        ],
      ],
    );
  }
}

class _SocialButton extends StatelessWidget {
  const _SocialButton({
    required this.provider,
    required this.label,
    required this.busy,
    required this.onPressed,
  });

  final SocialProvider provider;
  final String label;
  final bool busy;
  final VoidCallback? onPressed;

  // Google's sign-in button colours (light theme).
  static const _googleText = Color(0xFF1F1F1F);
  static const _googleBorder = Color(0xFF747775);

  @override
  Widget build(BuildContext context) {
    final isApple = provider == SocialProvider.apple;
    final foreground = isApple ? Colors.white : _googleText;
    final style = OutlinedButton.styleFrom(
      backgroundColor: isApple ? Colors.black : Colors.white,
      foregroundColor: foreground,
      disabledBackgroundColor: isApple ? Colors.black54 : Colors.white,
      disabledForegroundColor: foreground.withValues(alpha: 0.6),
      side: BorderSide(color: isApple ? Colors.black : _googleBorder),
      minimumSize: const Size.fromHeight(48),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
    );
    final Widget leading = busy
        ? SizedBox(
            width: 18,
            height: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              valueColor: AlwaysStoppedAnimation<Color>(foreground),
            ),
          )
        : isApple
        ? const Icon(Icons.apple, size: 22, color: Colors.white)
        : const SizedBox(width: 18, height: 18, child: GoogleGLogo());
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      enabled: onPressed != null,
      child: OutlinedButton(
        key: Key('social-sign-in-${provider.name}'),
        onPressed: onPressed,
        style: style,
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            leading,
            const SizedBox(width: 12),
            Flexible(
              child: Text(
                label,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: foreground),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Google's four-colour "G", drawn from Google's sign-in branding artwork
/// (48 x 48 design grid) so it stays sharp at any size.
class GoogleGLogo extends StatelessWidget {
  const GoogleGLogo({super.key});

  @override
  Widget build(BuildContext context) =>
      const CustomPaint(painter: _GoogleGPainter(), size: Size.square(18));
}

class _GoogleGPainter extends CustomPainter {
  const _GoogleGPainter();

  static final List<(Color, Path)> _parts = [
    (
      const Color(0xFFEA4335),
      Path()
        ..moveTo(24.0, 9.5)
        ..cubicTo(27.54, 9.5, 30.71, 10.72, 33.21, 13.1)
        ..lineTo(40.06, 6.25)
        ..cubicTo(35.9, 2.38, 30.47, 0.0, 24.0, 0.0)
        ..cubicTo(14.62, 0.0, 6.51, 5.38, 2.56, 13.22)
        ..lineTo(10.54, 19.41)
        ..cubicTo(12.43, 13.72, 17.74, 9.5, 24.0, 9.5)
        ..close(),
    ),
    (
      const Color(0xFF4285F4),
      Path()
        ..moveTo(46.98, 24.55)
        ..cubicTo(46.98, 22.98, 46.83, 21.46, 46.6, 20.0)
        ..lineTo(24.0, 20.0)
        ..lineTo(24.0, 29.02)
        ..lineTo(36.94, 29.02)
        ..cubicTo(36.36, 31.98, 34.68, 34.5, 32.16, 36.2)
        ..lineTo(39.89, 42.2)
        ..cubicTo(44.4, 38.02, 46.98, 31.84, 46.98, 24.55)
        ..close(),
    ),
    (
      const Color(0xFFFBBC05),
      Path()
        ..moveTo(10.53, 28.59)
        ..cubicTo(10.05, 27.14, 9.77, 25.6, 9.77, 24.0)
        ..cubicTo(9.77, 22.4, 10.04, 20.86, 10.53, 19.41)
        ..lineTo(2.55, 13.22)
        ..cubicTo(0.92, 16.46, 0.0, 20.12, 0.0, 24.0)
        ..cubicTo(0.0, 27.88, 0.92, 31.54, 2.56, 34.78)
        ..lineTo(10.53, 28.59)
        ..close(),
    ),
    (
      const Color(0xFF34A853),
      Path()
        ..moveTo(24.0, 48.0)
        ..cubicTo(30.48, 48.0, 35.93, 45.87, 39.89, 42.19)
        ..lineTo(32.16, 36.19)
        ..cubicTo(30.01, 37.64, 27.24, 38.49, 24.0, 38.49)
        ..cubicTo(17.74, 38.49, 12.43, 34.27, 10.53, 28.58)
        ..lineTo(2.55, 34.77)
        ..cubicTo(6.51, 42.62, 14.62, 48.0, 24.0, 48.0)
        ..close(),
    ),
  ];

  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 48, size.height / 48);
    final paint = Paint()..isAntiAlias = true;
    for (final (color, path) in _parts) {
      canvas.drawPath(path, paint..color = color);
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_GoogleGPainter oldDelegate) => false;
}
