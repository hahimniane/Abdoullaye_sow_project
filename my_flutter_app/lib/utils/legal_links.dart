import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';

Future<void> openLaawolLegalPage(
  BuildContext context, {
  required bool privacy,
}) async {
  final isFrench = Localizations.localeOf(context).languageCode == 'fr';
  final page = privacy
      ? (isFrench ? 'privacy.html' : 'privacy-en.html')
      : (isFrench ? 'terms.html' : 'terms-en.html');
  final opened = await launchUrl(
    Uri.parse('https://laawoldigital.com/$page'),
    mode: LaunchMode.inAppBrowserView,
  );
  if (!opened && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(AppLocalizations.of(context)!.openLegalLinkFailed),
      ),
    );
  }
}
