import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';

class AppBackButton extends StatelessWidget {
  const AppBackButton({
    super.key,
    this.onPressed,
    this.onDarkBackground = false,
  });

  final VoidCallback? onPressed;
  final bool onDarkBackground;

  @override
  Widget build(BuildContext context) {
    final color = onDarkBackground ? Colors.white : null;
    return IconButton(
      tooltip: AppLocalizations.of(context)!.back,
      onPressed: onPressed ?? () => Navigator.maybePop(context),
      style: IconButton.styleFrom(splashFactory: NoSplash.splashFactory),
      icon: Icon(Icons.arrow_back_ios_new, color: color, size: 22),
    );
  }
}
