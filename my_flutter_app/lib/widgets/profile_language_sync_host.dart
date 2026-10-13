import 'package:flutter/widgets.dart';
import 'package:provider/provider.dart';

import '../providers/auth_provider.dart';
import '../providers/language_provider.dart';
import '../services/profile_language_sync.dart';

/// Runs [ProfileLanguageSync] for the whole app: placed under the providers
/// in `main.dart`, it saves the app language on the signed-in profile. It
/// renders [child] unchanged and never rebuilds it.
class ProfileLanguageSyncHost extends StatefulWidget {
  const ProfileLanguageSyncHost({super.key, required this.child});

  final Widget child;

  @override
  State<ProfileLanguageSyncHost> createState() =>
      _ProfileLanguageSyncHostState();
}

class _ProfileLanguageSyncHostState extends State<ProfileLanguageSyncHost> {
  late final ProfileLanguageSync _sync;

  @override
  void initState() {
    super.initState();
    final auth = context.read<AuthProvider>();
    _sync = ProfileLanguageSync(save: auth.saveProfileLanguage)
      ..bind(
        language: context.read<LanguageProvider>(),
        account: auth,
        uid: () => auth.loadedProfileUid,
        savedLanguage: () => auth.profileLanguage,
      );
  }

  @override
  void dispose() {
    _sync.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
