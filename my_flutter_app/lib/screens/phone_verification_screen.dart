import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart' hide AuthProvider;
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/country_phone_field.dart';

class PhoneVerificationArguments {
  const PhoneVerificationArguments({this.returnToSharedBarrels = false});

  final bool returnToSharedBarrels;
}

abstract interface class PhoneVerificationClient {
  String? get customerPhone;
  String? get linkedPhoneNumber;
  bool get phoneVerified;

  Future<void> startPhoneVerification({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onVerificationCompleted,
    required ValueChanged<Object> onVerificationFailed,
    required bool Function() shouldCompleteAutomaticVerification,
    int? resendToken,
  });

  Future<void> completePhoneVerification({
    required String verificationId,
    required String smsCode,
  });

  Future<void> syncLinkedPhoneVerification();
}

class _AuthPhoneVerificationClient implements PhoneVerificationClient {
  const _AuthPhoneVerificationClient(this.auth);

  final AuthProvider auth;

  @override
  String? get customerPhone => auth.customerPhone;

  @override
  String? get linkedPhoneNumber => auth.linkedPhoneNumber;

  @override
  bool get phoneVerified => auth.phoneVerified;

  @override
  Future<void> startPhoneVerification({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onVerificationCompleted,
    required ValueChanged<Object> onVerificationFailed,
    required bool Function() shouldCompleteAutomaticVerification,
    int? resendToken,
  }) {
    return auth.startPhoneVerification(
      phoneNumber: phoneNumber,
      languageCode: languageCode,
      onCodeSent: onCodeSent,
      onVerificationCompleted: onVerificationCompleted,
      onVerificationFailed: onVerificationFailed,
      shouldCompleteAutomaticVerification: shouldCompleteAutomaticVerification,
      resendToken: resendToken,
    );
  }

  @override
  Future<void> completePhoneVerification({
    required String verificationId,
    required String smsCode,
  }) {
    return auth.completePhoneVerification(
      verificationId: verificationId,
      smsCode: smsCode,
    );
  }

  @override
  Future<void> syncLinkedPhoneVerification() {
    return auth.syncLinkedPhoneVerification();
  }
}

enum PhoneVerificationErrorType {
  invalidPhone,
  incompleteCode,
  invalidCode,
  expiredCode,
  tooManyAttempts,
  network,
  phoneInUse,
  recentLogin,
  appCheck,
  generic,
}

// TEMP DEBUG: surfaces the raw Firebase error behind the generic
// "we couldn't verify your phone" message. Remove once the root cause is found.
void debugLogPhoneVerificationError(String stage, Object error) {
  if (!kDebugMode) return;
  final code = switch (error) {
    FirebaseAuthException() => error.code,
    FirebaseFunctionsException() => error.code,
    PlatformException() => error.code,
    _ => '(no code)',
  };
  debugPrint(
    '📱 PHONE-VERIFY FAIL [$stage] '
    'code=$code type=${error.runtimeType} '
    'classified=${classifyPhoneVerificationError(error)} '
    'message=$error',
  );
}

PhoneVerificationErrorType classifyPhoneVerificationError(Object error) {
  final code = switch (error) {
    FirebaseAuthException() => error.code,
    FirebaseFunctionsException() => error.code,
    PlatformException() => error.code,
    _ => null,
  };
  final message = error.toString().toLowerCase();
  if (message.contains('app attestation failed') ||
      message.contains('exchangeDebugToken'.toLowerCase()) ||
      message.contains('app check')) {
    return PhoneVerificationErrorType.appCheck;
  }
  return switch (code) {
    'invalid-phone-number' => PhoneVerificationErrorType.invalidPhone,
    'invalid-verification-code' => PhoneVerificationErrorType.invalidCode,
    'session-expired' => PhoneVerificationErrorType.expiredCode,
    'too-many-requests' ||
    'quota-exceeded' => PhoneVerificationErrorType.tooManyAttempts,
    'network-request-failed' ||
    'unavailable' ||
    'deadline-exceeded' => PhoneVerificationErrorType.network,
    'credential-already-in-use' ||
    'already-exists' => PhoneVerificationErrorType.phoneInUse,
    'requires-recent-login' => PhoneVerificationErrorType.recentLogin,
    'app-check-token-invalid' ||
    'app-check-token-expired' ||
    'app-check-token-missing' ||
    'unauthenticated' ||
    'permission-denied' => PhoneVerificationErrorType.appCheck,
    _ => PhoneVerificationErrorType.generic,
  };
}

class PhoneVerificationPromptDialog extends StatelessWidget {
  const PhoneVerificationPromptDialog({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      icon: const Icon(Icons.phone_iphone_outlined),
      title: Text(l10n.verifyPhoneToContinueTitle),
      content: Text(l10n.verifyPhoneToContinueBody),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child: Text(l10n.notNow),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, true),
          child: Text(l10n.verifyPhone),
        ),
      ],
    );
  }
}

class PhoneVerificationScreen extends StatefulWidget {
  const PhoneVerificationScreen({
    super.key,
    this.returnToSharedBarrels = false,
    this.client,
  });

  final bool returnToSharedBarrels;
  final PhoneVerificationClient? client;

  @override
  State<PhoneVerificationScreen> createState() =>
      _PhoneVerificationScreenState();
}

class _PhoneVerificationScreenState extends State<PhoneVerificationScreen> {
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _codeFocusNode = FocusNode();
  PhoneVerificationClient? _providerClient;
  PhoneVerificationSession? _session;
  Timer? _resendTimer;
  Timer? _requestTimer;
  int _resendSeconds = 0;
  int _attemptId = 0;
  bool _sending = false;
  bool _resending = false;
  bool _verifying = false;
  bool _syncing = false;
  bool _verified = false;
  bool _syncPending = false;
  String? _error;
  String? _announcement;
  bool _hydrated = false;

  PhoneVerificationClient get _client =>
      widget.client ??
      (_providerClient ??= _AuthPhoneVerificationClient(
        context.read<AuthProvider>(),
      ));

  bool get _busy => _sending || _resending || _verifying || _syncing;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_hydrated) return;
    _hydrated = true;
    final savedPhone = _client.customerPhone?.trim() ?? '';
    _verified = _client.phoneVerified;
    if (!_verified &&
        PhoneNumberValidator.matches(_client.linkedPhoneNumber, savedPhone)) {
      _phoneController.text = savedPhone;
    }
    _syncPending =
        !_verified &&
        PhoneNumberValidator.matches(
          _client.linkedPhoneNumber,
          _phoneController.text,
        );
  }

  @override
  void dispose() {
    _attemptId += 1;
    _resendTimer?.cancel();
    _requestTimer?.cancel();
    _phoneController.dispose();
    _codeController.dispose();
    _codeFocusNode.dispose();
    super.dispose();
  }

  String _messageFor(Object error) {
    final l10n = AppLocalizations.of(context)!;
    return switch (classifyPhoneVerificationError(error)) {
      PhoneVerificationErrorType.invalidPhone =>
        l10n.phoneVerificationInvalidPhone,
      PhoneVerificationErrorType.incompleteCode =>
        l10n.phoneVerificationEnterCode,
      PhoneVerificationErrorType.invalidCode =>
        l10n.phoneVerificationInvalidCode,
      PhoneVerificationErrorType.expiredCode =>
        l10n.phoneVerificationExpiredCode,
      PhoneVerificationErrorType.tooManyAttempts =>
        l10n.phoneVerificationTooManyAttempts,
      PhoneVerificationErrorType.network => l10n.phoneVerificationNetworkError,
      PhoneVerificationErrorType.phoneInUse => l10n.phoneVerificationPhoneInUse,
      PhoneVerificationErrorType.recentLogin =>
        l10n.phoneVerificationRecentLogin,
      PhoneVerificationErrorType.appCheck => l10n.phoneVerificationAppCheck,
      PhoneVerificationErrorType.generic => l10n.phoneVerificationGenericError,
    };
  }

  // TEMP DEBUG: append the raw Firebase/Functions code to the on-screen error
  // in debug builds so the exact cause is visible without reading logs.
  // Remove once the phone-verification failure is diagnosed.
  String _decorate(String message, Object error) {
    if (!kDebugMode) return message;
    final code = switch (error) {
      FirebaseAuthException() => error.code,
      FirebaseFunctionsException() => error.code,
      PlatformException() => error.code,
      _ => error.runtimeType.toString(),
    };
    return '$message\n\n[debug: $code]';
  }

  // A sync failure after the phone was already linked is only worth retrying
  // when it's transient. Permanent causes (App Check not registered, phone in
  // use, needs recent login, wrong role) get their real message instead of the
  // misleading "try finishing again" prompt.
  bool _isTransientSyncError(Object error) {
    return switch (classifyPhoneVerificationError(error)) {
      PhoneVerificationErrorType.network ||
      PhoneVerificationErrorType.generic => true,
      _ => false,
    };
  }

  void _startCooldown() {
    _resendTimer?.cancel();
    setState(() => _resendSeconds = 30);
    _resendTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) return;
      if (_resendSeconds <= 1) {
        timer.cancel();
        setState(() => _resendSeconds = 0);
      } else {
        setState(() => _resendSeconds -= 1);
      }
    });
  }

  void _startRequestTimeout(int attemptId) {
    _requestTimer?.cancel();
    _requestTimer = Timer(const Duration(seconds: 90), () {
      if (!mounted || attemptId != _attemptId || (!_sending && !_resending)) {
        return;
      }
      setState(() {
        _sending = false;
        _resending = false;
        _error = AppLocalizations.of(context)!.phoneVerificationRequestTimedOut;
      });
    });
  }

  void _clearRequestBusy() {
    _requestTimer?.cancel();
    _sending = false;
    _resending = false;
  }

  void _completeFlow() {
    _requestTimer?.cancel();
    _resendTimer?.cancel();
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _verified = true;
      _syncPending = false;
      _sending = false;
      _resending = false;
      _verifying = false;
      _syncing = false;
      _error = null;
      _announcement = null;
    });
  }

  Future<void> _syncLinkedPhone() async {
    if (_syncing) return;
    setState(() {
      _syncing = true;
      _error = null;
      _announcement = null;
    });
    try {
      await _client.syncLinkedPhoneVerification();
      if (!mounted) return;
      _completeFlow();
    } catch (error) {
      debugLogPhoneVerificationError('sync', error);
      if (!mounted) return;
      final retryable = _isTransientSyncError(error);
      setState(() {
        _syncing = false;
        _syncPending = retryable;
        _error = _decorate(
          retryable
              ? AppLocalizations.of(context)!.phoneVerificationSyncPending
              : _messageFor(error),
          error,
        );
      });
    }
  }

  Future<void> _sendCode({bool resend = false}) async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final phone = PhoneNumberValidator.normalized(_phoneController.text);
    if (!PhoneNumberValidator.isValidE164(phone)) {
      setState(() => _error = l10n.phoneVerificationInvalidPhone);
      return;
    }
    if (!resend &&
        PhoneNumberValidator.matches(_client.linkedPhoneNumber, phone)) {
      setState(() => _syncPending = true);
      await _syncLinkedPhone();
      return;
    }

    final attemptId = ++_attemptId;
    setState(() {
      _sending = !resend;
      _resending = resend;
      _error = null;
      _announcement = null;
    });
    _startRequestTimeout(attemptId);
    try {
      await _client.startPhoneVerification(
        phoneNumber: phone,
        languageCode: Localizations.localeOf(context).languageCode,
        resendToken: resend ? _session?.resendToken : null,
        shouldCompleteAutomaticVerification: () =>
            mounted && attemptId == _attemptId,
        onCodeSent: (session) {
          if (!mounted || attemptId != _attemptId) return;
          setState(() {
            _session = session;
            _clearRequestBusy();
            if (resend) {
              _announcement = l10n.phoneVerificationResent;
            }
          });
          _startCooldown();
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) _codeFocusNode.requestFocus();
          });
        },
        onVerificationCompleted: () async {
          if (!mounted || attemptId != _attemptId) return;
          _completeFlow();
        },
        onVerificationFailed: (error) {
          debugLogPhoneVerificationError('sendCode/verificationFailed', error);
          if (!mounted || attemptId != _attemptId) return;
          setState(() {
            _clearRequestBusy();
            _verifying = false;
            _error = _messageFor(error);
          });
        },
      );
    } catch (error) {
      debugLogPhoneVerificationError('sendCode/catch', error);
      if (!mounted || attemptId != _attemptId) return;
      setState(() {
        _clearRequestBusy();
        _error = _messageFor(error);
      });
    }
  }

  Future<void> _verifyCode() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final session = _session;
    if (session == null || _codeController.text.trim().length != 6) {
      setState(() => _error = l10n.phoneVerificationEnterCode);
      return;
    }
    setState(() {
      _verifying = true;
      _error = null;
      _announcement = null;
    });
    try {
      await _client.completePhoneVerification(
        verificationId: session.verificationId,
        smsCode: _codeController.text.trim(),
      );
      if (!mounted) return;
      _completeFlow();
    } catch (error) {
      debugLogPhoneVerificationError('verifyCode', error);
      if (!mounted) return;
      final linkedPhoneMatches = PhoneNumberValidator.matches(
        _client.linkedPhoneNumber,
        _phoneController.text,
      );
      // The phone linked, but the profile-sync callable failed. Only invite a
      // retry for transient failures; otherwise show the real reason so the
      // user isn't stuck retrying a permanent error.
      final retryable = linkedPhoneMatches && _isTransientSyncError(error);
      setState(() {
        _verifying = false;
        _syncPending = retryable;
        _error = _decorate(
          retryable ? l10n.phoneVerificationSyncPending : _messageFor(error),
          error,
        );
      });
    }
  }

  void _changeNumber() {
    _attemptId += 1;
    _requestTimer?.cancel();
    _resendTimer?.cancel();
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _session = null;
      _codeController.clear();
      _error = null;
      _announcement = null;
      _sending = false;
      _resending = false;
      _verifying = false;
      _syncing = false;
      _resendSeconds = 0;
      _syncPending = PhoneNumberValidator.matches(
        _client.linkedPhoneNumber,
        _phoneController.text,
      );
    });
  }

  Widget _buildProgressLabel({required String label, required bool loading}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (loading) ...[
          SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: Theme.of(context).colorScheme.onPrimary,
            ),
          ),
          const SizedBox(width: 10),
        ],
        Flexible(child: Text(label)),
      ],
    );
  }

  Widget _buildSuccess(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListView(
      padding: const EdgeInsets.all(24),
      children: [
        const SizedBox(height: 48),
        Align(
          child: Container(
            width: 88,
            height: 88,
            decoration: BoxDecoration(
              color: AppColors.sage.withValues(alpha: 0.12),
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.verified_rounded,
              size: 48,
              color: AppColors.sage,
            ),
          ),
        ),
        const SizedBox(height: 24),
        Text(
          l10n.phoneVerificationSuccessTitle,
          textAlign: TextAlign.center,
          style: Theme.of(
            context,
          ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 10),
        Text(
          l10n.phoneVerificationSuccess,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.bodyLarge,
        ),
        const SizedBox(height: 32),
        SizedBox(
          height: 50,
          child: FilledButton(
            key: const Key('phone-verification-done'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text(
              widget.returnToSharedBarrels
                  ? l10n.phoneVerificationReturnToSharedBarrels
                  : l10n.done,
            ),
          ),
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final codeSent = _session != null;
    return PopScope(
      canPop: !_busy,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          leading: _busy
              ? const IconButton(
                  onPressed: null,
                  icon: Icon(Icons.arrow_back_ios_new, size: 22),
                )
              : const AppBackButton(),
          title: Text(l10n.phoneVerificationTitle),
        ),
        body: SafeArea(
          child: _verified
              ? _buildSuccess(context)
              : ListView(
                  keyboardDismissBehavior:
                      ScrollViewKeyboardDismissBehavior.onDrag,
                  padding: const EdgeInsets.all(20),
                  children: [
                    if (!codeSent) ...[
                      const Icon(
                        Icons.phone_iphone_rounded,
                        size: 54,
                        color: AppColors.brandRed,
                      ),
                      const SizedBox(height: 16),
                      Text(
                        l10n.verifyPhoneToContinueTitle,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall
                            ?.copyWith(fontWeight: FontWeight.w800),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        l10n.phoneVerificationExplanation,
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                      const SizedBox(height: 24),
                      CountryPhoneField(
                        fieldKey: const Key('phone-verification-number'),
                        controller: _phoneController,
                        enabled: !_busy,
                        labelText: l10n.phoneNumber,
                        helperText: l10n.phoneVerificationCountryCodeHelp,
                        showClearButton: true,
                        onChanged: (value) => setState(() {
                          _error = null;
                          _syncPending = PhoneNumberValidator.matches(
                            _client.linkedPhoneNumber,
                            value,
                          );
                        }),
                      ),
                    ] else ...[
                      Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: AppColors.sage.withValues(alpha: 0.10),
                          borderRadius: BorderRadius.circular(
                            AppSpacing.radiusMd,
                          ),
                        ),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(
                              Icons.mark_email_read_outlined,
                              color: AppColors.sage,
                            ),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    l10n.phoneVerificationCodeSentTitle,
                                    style: const TextStyle(
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  const SizedBox(height: 3),
                                  Text(
                                    l10n.phoneVerificationCodeSent(
                                      PhoneNumberValidator.normalized(
                                        _phoneController.text,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(height: 14),
                      TextField(
                        key: const Key('phone-verification-code'),
                        controller: _codeController,
                        focusNode: _codeFocusNode,
                        enabled: !_busy,
                        keyboardType: TextInputType.number,
                        textInputAction: TextInputAction.done,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        scrollPadding: const EdgeInsets.only(bottom: 160),
                        inputFormatters: [
                          FilteringTextInputFormatter.digitsOnly,
                          LengthLimitingTextInputFormatter(6),
                        ],
                        onSubmitted: (_) => _busy ? null : _verifyCode(),
                        decoration: InputDecoration(
                          labelText: l10n.phoneVerificationCode,
                          prefixIcon: const Icon(Icons.password_outlined),
                        ),
                      ),
                    ],
                    if (_announcement != null) ...[
                      const SizedBox(height: 12),
                      Semantics(
                        liveRegion: true,
                        child: Text(
                          _announcement!,
                          style: const TextStyle(
                            color: AppColors.sage,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Semantics(
                        liveRegion: true,
                        child: Container(
                          padding: const EdgeInsets.all(12),
                          decoration: BoxDecoration(
                            color: AppColors.errorRed.withValues(alpha: 0.08),
                            borderRadius: BorderRadius.circular(
                              AppSpacing.radiusMd,
                            ),
                          ),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Icon(
                                Icons.error_outline,
                                color: AppColors.errorRed,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  _error!,
                                  style: const TextStyle(
                                    color: AppColors.errorRed,
                                    fontWeight: FontWeight.w600,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                    const SizedBox(height: 20),
                    SizedBox(
                      height: 50,
                      child: FilledButton(
                        key: const Key('phone-verification-primary'),
                        onPressed: _busy
                            ? null
                            : _syncPending
                            ? _syncLinkedPhone
                            : codeSent
                            ? _verifyCode
                            : _sendCode,
                        child: _buildProgressLabel(
                          loading: _sending || _verifying || _syncing,
                          label: _syncing
                              ? l10n.phoneVerificationFinishing
                              : _sending
                              ? l10n.phoneVerificationSendingCode
                              : _verifying
                              ? l10n.phoneVerificationVerifying
                              : _syncPending
                              ? l10n.phoneVerificationFinish
                              : codeSent
                              ? l10n.verifyPhone
                              : l10n.phoneVerificationSendCode,
                        ),
                      ),
                    ),
                    if (codeSent) ...[
                      const SizedBox(height: 8),
                      TextButton(
                        key: const Key('phone-verification-resend'),
                        onPressed: _busy || _resendSeconds > 0 || _syncPending
                            ? null
                            : () => _sendCode(resend: true),
                        child: _buildProgressLabel(
                          loading: _resending,
                          label: _resending
                              ? l10n.phoneVerificationResending
                              : _resendSeconds > 0
                              ? l10n.phoneVerificationResendIn(_resendSeconds)
                              : l10n.phoneVerificationResend,
                        ),
                      ),
                      TextButton(
                        key: const Key('phone-verification-change-number'),
                        onPressed: _busy ? null : _changeNumber,
                        child: Text(l10n.phoneVerificationChangeNumber),
                      ),
                    ],
                    const SizedBox(height: 8),
                    Text(
                      l10n.phoneVerificationSmsNotice,
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ),
        ),
      ),
    );
  }
}
