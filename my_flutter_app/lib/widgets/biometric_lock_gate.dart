import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/biometric_lock_service.dart';
import '../theme/app_colors.dart';

class BiometricLockGate extends StatefulWidget {
  const BiometricLockGate({super.key, required this.child, this.service});

  final Widget child;
  final BiometricLockService? service;

  @override
  State<BiometricLockGate> createState() => _BiometricLockGateState();
}

class _BiometricLockGateState extends State<BiometricLockGate>
    with WidgetsBindingObserver {
  late final BiometricLockService _service =
      widget.service ?? BiometricLockService();
  bool _locked = false;
  bool _checking = true;
  bool _authenticating = false;
  // The biometric prompt itself backgrounds/resumes the app; this window
  // swallows the resume that fires right after a successful unlock.
  DateTime _suppressLockUntil = DateTime.fromMillisecondsSinceEpoch(0);

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refreshLockState();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Ignore lifecycle churn caused by the biometric prompt itself, otherwise
    // the resume that follows a successful unlock immediately re-locks the app.
    if (_authenticating) return;
    if (state == AppLifecycleState.resumed) {
      if (DateTime.now().isBefore(_suppressLockUntil)) return;
      _refreshLockState(forceLock: true);
    }
  }

  Future<void> _refreshLockState({bool forceLock = false}) async {
    final auth = context.read<AuthProvider>();
    final shouldLock =
        auth.isAuthenticated &&
        await _service.isEnabled() &&
        await _service.canAuthenticate();
    if (!mounted) return;
    setState(() {
      _locked = shouldLock && (forceLock || _locked || _checking);
      _checking = false;
    });
  }

  Future<void> _unlock() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _authenticating = true);
    final ok = await _service.authenticate(reason: l10n.unlockWithFaceId);
    if (!mounted) return;
    // Swallow the resume event fired when the biometric sheet dismisses so a
    // successful unlock is not immediately re-locked.
    _suppressLockUntil = DateTime.now().add(const Duration(seconds: 2));
    setState(() {
      _authenticating = false;
      if (ok) _locked = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.isAuthenticated) {
      if (_locked || _checking) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) return;
          setState(() {
            _locked = false;
            _checking = false;
          });
        });
      }
      return widget.child;
    }
    if (_checking) return widget.child;
    if (!_locked) return widget.child;

    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(
                  Icons.face_retouching_natural,
                  size: 64,
                  color: AppColors.cobalt,
                ),
                const SizedBox(height: 18),
                Text(
                  l10n.appLocked,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 8),
                Text(
                  l10n.unlockWithFaceIdMessage,
                  style: const TextStyle(color: AppColors.muted, height: 1.4),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _authenticating ? null : _unlock,
                  icon: _authenticating
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.lock_open),
                  label: Text(l10n.unlock),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
