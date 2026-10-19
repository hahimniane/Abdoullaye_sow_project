import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/phone_accounts.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_back_button.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/phone_account_widgets.dart';
import 'phone_verification_screen.dart' show phoneVerificationErrorText;

/// Everything the sign-in screen asks of the account, behind one interface
/// so the screen is widget-tested with a fake (the real one is AuthProvider).
abstract interface class PhoneSignInClient {
  Future<PhoneLoginChallenge> requestCode(PhoneCodeRequest request);

  /// Signs in (a typed or tracking request), or proves a number for the
  /// signed-in account ([LinkPhoneCodeRequest]).
  Future<PhoneCodeVerified> verifyCode({
    required PhoneCodeRequest request,
    required String challengeId,
    required String code,
  });

  /// The SMS fallback: Firebase phone auth.
  Future<void> startSmsSignIn({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onSignedIn,
    required ValueChanged<Object> onFailed,
    required bool Function() shouldCompleteAutomaticSignIn,
    int? resendToken,
  });

  Future<void> completeSmsSignIn({
    required String verificationId,
    required String smsCode,
  });
}

class AuthPhoneSignInClient implements PhoneSignInClient {
  const AuthPhoneSignInClient(this.auth);

  final AuthProvider auth;

  @override
  Future<PhoneLoginChallenge> requestCode(PhoneCodeRequest request) =>
      auth.requestPhoneLoginCode(request);

  @override
  Future<PhoneCodeVerified> verifyCode({
    required PhoneCodeRequest request,
    required String challengeId,
    required String code,
  }) => request is LinkPhoneCodeRequest
      ? auth.linkPhoneWithLoginCode(challengeId: challengeId, code: code)
      : auth.signInWithPhoneLoginCode(challengeId: challengeId, code: code);

  @override
  Future<void> startSmsSignIn({
    required String phoneNumber,
    required String languageCode,
    required ValueChanged<PhoneVerificationSession> onCodeSent,
    required Future<void> Function() onSignedIn,
    required ValueChanged<Object> onFailed,
    required bool Function() shouldCompleteAutomaticSignIn,
    int? resendToken,
  }) => auth.startPhoneSmsSignIn(
    phoneNumber: phoneNumber,
    languageCode: languageCode,
    onCodeSent: onCodeSent,
    onSignedIn: onSignedIn,
    onFailed: onFailed,
    shouldCompleteAutomaticSignIn: shouldCompleteAutomaticSignIn,
    resendToken: resendToken,
  );

  @override
  Future<void> completeSmsSignIn({
    required String verificationId,
    required String smsCode,
  }) => auth.completePhoneSmsSignIn(
    verificationId: verificationId,
    smsCode: smsCode,
  );
}

/// How the screen closed: signed in, or (link) the number added.
class PhoneSignInOutcome {
  const PhoneSignInOutcome({
    this.signedIn = false,
    this.linked = false,
    this.merged = false,
  });

  final bool signedIn;
  final bool linked;
  final bool merged;
}

enum _Step { number, code }

enum _Channel { whatsapp, sms }

/// Phone sign-in (docs/PHONE_ACCOUNTS.md §5): a WhatsApp code first, "Send
/// it by text instead" as the fallback (and automatically when WhatsApp is
/// unavailable). Pops with a [PhoneSignInOutcome]; the caller decides where
/// to go next.
///
/// Without [request] the person types their number (the login screen's
/// "Sign in with your phone"). A [TrackingPhoneCodeRequest] (the tracking
/// page's "Sign in as the number ending in ••35") and a
/// [LinkPhoneCodeRequest] (phone verification's WhatsApp alternative) send
/// at once and open on the code.
class PhoneSignInScreen extends StatefulWidget {
  const PhoneSignInScreen({super.key, this.request, this.client});

  final PhoneCodeRequest? request;
  final PhoneSignInClient? client;

  @override
  State<PhoneSignInScreen> createState() => _PhoneSignInScreenState();
}

class _PhoneSignInScreenState extends State<PhoneSignInScreen> {
  final _phoneController = TextEditingController();
  final _codeController = TextEditingController();
  final _codeFocus = FocusNode();
  final _countdown = ResendCountdown();
  PhoneSignInClient? _providerClient;
  Timer? _ticker;
  Timer? _smsTimeout;

  _Step _step = _Step.number;
  _Channel _channel = _Channel.whatsapp;

  /// The masked flow fell back to text: the person types their own number
  /// (the app never had the record's).
  bool _textOnly = false;
  PhoneLoginChallenge? _challenge;
  PhoneVerificationSession? _smsSession;
  int _attempt = 0;
  bool _sending = false;
  bool _verifying = false;
  bool _done = false;
  String? _error;
  String? _note;

  PhoneSignInClient get _client =>
      widget.client ??
      (_providerClient ??= AuthPhoneSignInClient(context.read<AuthProvider>()));

  bool get _busy => _sending || _verifying || _done;
  bool get _isLink => widget.request is LinkPhoneCodeRequest;
  bool get _isTracking => widget.request is TrackingPhoneCodeRequest;

  /// The number the person typed (or the link's), for the SMS fallback.
  String get _typedPhone => switch (widget.request) {
    LinkPhoneCodeRequest(:final phone) => phone,
    TypedPhoneCodeRequest(:final phone) => phone,
    _ => PhoneNumberValidator.normalized(_phoneController.text),
  };

  @override
  void initState() {
    super.initState();
    final request = widget.request;
    if (request is TypedPhoneCodeRequest) _phoneController.text = request.phone;
    if (request is TrackingPhoneCodeRequest ||
        request is LinkPhoneCodeRequest) {
      _step = _Step.code;
      _sending = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _sendWhatsApp(request!, initial: true);
      });
    }
  }

  @override
  void dispose() {
    _attempt += 1;
    _ticker?.cancel();
    _smsTimeout?.cancel();
    _phoneController.dispose();
    _codeController.dispose();
    _codeFocus.dispose();
    super.dispose();
  }

  // ---- countdown ---------------------------------------------------------

  void _startCountdown(int seconds) {
    _ticker?.cancel();
    _countdown.start(seconds);
    if (!_countdown.waiting) return;
    _ticker = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final ended = _countdown.tick();
      setState(() {});
      if (ended || !_countdown.waiting) timer.cancel();
    });
  }

  void _stopCountdown() {
    _ticker?.cancel();
    _countdown.clear();
  }

  // ---- WhatsApp ----------------------------------------------------------

  PhoneCodeRequest? _whatsAppRequest() {
    final request = widget.request;
    if (request != null) return request;
    final phone = PhoneNumberValidator.normalized(_phoneController.text);
    if (!PhoneNumberValidator.isValidE164(phone)) return null;
    return TypedPhoneCodeRequest(phone);
  }

  Future<void> _sendWhatsApp(
    PhoneCodeRequest request, {
    bool initial = false,
  }) async {
    if (!initial && _busy) return;
    final attempt = ++_attempt;
    setState(() {
      _sending = true;
      _error = null;
      _note = null;
    });
    try {
      final challenge = await _client.requestCode(request);
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _challenge = challenge;
        _channel = _Channel.whatsapp;
        _step = _Step.code;
        _sending = false;
        _codeController.clear();
      });
      _startCountdown(challenge.resendAfterSeconds);
      _focusCode();
    } on PhoneAccountFailure catch (failure) {
      if (!mounted || attempt != _attempt) return;
      final l10n = AppLocalizations.of(context)!;
      if (failure.reason == PhoneRefusalReason.whatsappUnavailable &&
          !_isLink) {
        // No WhatsApp code today: the text message is the way in.
        setState(() {
          _sending = false;
          _note = l10n.phaWhatsAppUnavailableNote;
        });
        _switchToText(keepNote: true);
        return;
      }
      setState(() {
        _sending = false;
        _error = phoneAccountRefusalText(l10n, failure.refusal);
        // Nothing was sent on a refused first request: a typed number goes
        // back to its field; a tracking or link request stays on the code
        // step, where Resend (or the text message) can try again.
        if (_challenge == null && widget.request == null) _step = _Step.number;
      });
      if (failure.reason == PhoneRefusalReason.rateLimited) {
        _startCountdown(failure.refusal.retryAfterSeconds);
      }
    } catch (error) {
      if (!mounted || attempt != _attempt) return;
      setState(() {
        _sending = false;
        _error = phoneAccountErrorText(AppLocalizations.of(context)!, error);
        if (_challenge == null && widget.request == null) _step = _Step.number;
      });
    }
  }

  Future<void> _submitNumber() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (_textOnly) {
      await _sendSms();
      return;
    }
    final request = _whatsAppRequest();
    if (request == null) {
      setState(() => _error = l10n.phaErrPhoneInvalid);
      return;
    }
    await _sendWhatsApp(request);
  }

  // ---- SMS ---------------------------------------------------------------

  /// "Send it by text instead". A typed number is texted at once; the masked
  /// flow first asks for the person's full number.
  void _switchToText({bool keepNote = false}) {
    if (_isTracking && !_textOnly) {
      _attempt += 1;
      _stopCountdown();
      setState(() {
        _textOnly = true;
        _step = _Step.number;
        _challenge = null;
        _codeController.clear();
        _error = null;
        if (!keepNote) _note = null;
      });
      return;
    }
    if (_isTracking) {
      setState(() => _step = _Step.number);
      return;
    }
    unawaited(_sendSms(keepNote: keepNote));
  }

  Future<void> _sendSms({bool resend = false, bool keepNote = false}) async {
    if (_sending || _verifying || _done) return;
    final l10n = AppLocalizations.of(context)!;
    final phone = _typedPhone;
    if (!PhoneNumberValidator.isValidE164(phone)) {
      setState(() {
        _step = _Step.number;
        _error = l10n.phaErrPhoneInvalid;
      });
      return;
    }
    final attempt = ++_attempt;
    _textOnly = _isTracking ? true : _textOnly;
    setState(() {
      _sending = true;
      _error = null;
      if (!keepNote) _note = null;
    });
    _smsTimeout?.cancel();
    _smsTimeout = Timer(const Duration(seconds: 90), () {
      if (!mounted || attempt != _attempt || !_sending) return;
      setState(() {
        _sending = false;
        _error = l10n.phoneVerificationRequestTimedOut;
      });
    });
    try {
      await _client.startSmsSignIn(
        phoneNumber: phone,
        languageCode: Localizations.localeOf(context).languageCode,
        resendToken: resend ? _smsSession?.resendToken : null,
        shouldCompleteAutomaticSignIn: () =>
            mounted && attempt == _attempt && !_done,
        onCodeSent: (session) {
          if (!mounted || attempt != _attempt) return;
          _smsTimeout?.cancel();
          setState(() {
            _smsSession = session;
            _channel = _Channel.sms;
            _step = _Step.code;
            _sending = false;
            _codeController.clear();
          });
          _startCountdown(defaultResendAfterMs ~/ 1000);
          _focusCode();
        },
        onSignedIn: () async {
          if (!mounted || attempt != _attempt) return;
          _finish(const PhoneSignInOutcome(signedIn: true));
        },
        onFailed: (error) {
          if (!mounted || attempt != _attempt) return;
          _smsTimeout?.cancel();
          setState(() {
            _sending = false;
            _verifying = false;
            _error = _errorText(error);
          });
        },
      );
    } catch (error) {
      if (!mounted || attempt != _attempt) return;
      _smsTimeout?.cancel();
      setState(() {
        _sending = false;
        _error = _errorText(error);
      });
    }
  }

  // ---- the code ----------------------------------------------------------

  Future<void> _verify() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final code = _codeController.text.trim();
    if (!isCompleteLoginCode(code)) {
      setState(() => _error = l10n.phoneVerificationEnterCode);
      return;
    }
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      if (_channel == _Channel.sms) {
        final session = _smsSession;
        if (session == null) throw StateError('No SMS session');
        await _client.completeSmsSignIn(
          verificationId: session.verificationId,
          smsCode: code,
        );
        if (!mounted) return;
        _finish(const PhoneSignInOutcome(signedIn: true));
        return;
      }
      final challenge = _challenge;
      final request = _whatsAppRequest();
      if (challenge == null || request == null) {
        throw const PhoneAccountFailure(
          PhoneAccountRefusal(
            code: 'failed-precondition',
            reason: PhoneRefusalReason.challengeNotFound,
          ),
        );
      }
      final verified = await _client.verifyCode(
        request: request,
        challengeId: challenge.challengeId,
        code: code,
      );
      if (!mounted) return;
      _finish(
        PhoneSignInOutcome(
          signedIn: !_isLink,
          linked: _isLink && verified.linked,
          merged: verified.merged,
        ),
      );
    } on PhoneAccountFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _error = phoneAccountRefusalText(l10n, failure.refusal);
        if (failure.refusal.needsNewCode) {
          _codeController.clear();
          _stopCountdown();
        }
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _verifying = false;
        _error = _errorText(error);
      });
    }
  }

  void _resend() {
    if (_busy || _countdown.waiting) return;
    if (_channel == _Channel.sms) {
      unawaited(_sendSms(resend: true));
      return;
    }
    final request = _whatsAppRequest();
    if (request != null) unawaited(_sendWhatsApp(request));
  }

  void _changeNumber() {
    _attempt += 1;
    _stopCountdown();
    _smsTimeout?.cancel();
    setState(() {
      _step = _Step.number;
      _challenge = null;
      _smsSession = null;
      _sending = false;
      _verifying = false;
      _codeController.clear();
      _error = null;
    });
  }

  void _finish(PhoneSignInOutcome outcome) {
    if (_done) return;
    _attempt += 1;
    _stopCountdown();
    _smsTimeout?.cancel();
    FocusManager.instance.primaryFocus?.unfocus();
    setState(() {
      _done = true;
      _verifying = false;
      _sending = false;
    });
    Navigator.of(context).pop(outcome);
  }

  void _focusCode() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _codeFocus.requestFocus();
    });
  }

  String _errorText(Object error) {
    final l10n = AppLocalizations.of(context)!;
    if (error is PhoneAccountFailure || error is AuthFailure) {
      return phoneAccountErrorText(l10n, error);
    }
    return phoneVerificationErrorText(l10n, error);
  }

  // ---- UI ----------------------------------------------------------------

  String _codeSentText(AppLocalizations l10n) {
    if (_channel == _Channel.sms) {
      return l10n.phoneVerificationCodeSent(_typedPhone);
    }
    final lastTwo = _challenge?.lastTwo.isNotEmpty == true
        ? _challenge!.lastTwo
        : switch (widget.request) {
            TrackingPhoneCodeRequest(:final lastTwo) => lastTwo,
            _ => '',
          };
    return lastTwo.isEmpty
        ? l10n.phaCodeSentWhatsAppPlain
        : l10n.phaCodeSentWhatsApp(lastTwo);
  }

  Widget _progressLabel(String label, {required bool loading, Color? color}) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        if (loading) ...[
          SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2, color: color),
          ),
          const SizedBox(width: 10),
        ],
        Flexible(child: Text(label, textAlign: TextAlign.center)),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final onPrimary = Theme.of(context).colorScheme.onPrimary;
    final codeStep = _step == _Step.code;
    final typedFlow = widget.request == null || _textOnly;
    return PopScope(
      canPop: !_verifying,
      child: Scaffold(
        backgroundColor: AppColors.lightBg,
        appBar: AppBar(
          leading: _verifying
              ? const IconButton(
                  onPressed: null,
                  icon: Icon(Icons.arrow_back_ios_new, size: 22),
                )
              : const AppBackButton(),
          title: Text(
            _isLink ? l10n.phoneVerificationTitle : l10n.phaSignInTitle,
          ),
        ),
        body: SafeArea(
          child: ListView(
            keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
            padding: const EdgeInsets.all(20),
            children: [
              Center(
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxWidth: 480),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Icon(
                        codeStep && _channel == _Channel.whatsapp
                            ? Icons.chat_outlined
                            : Icons.phone_iphone_rounded,
                        size: 48,
                        color: AppColors.cobalt,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (!codeStep) ...[
                        Text(
                          _textOnly
                              ? l10n.phaTextFullNumberIntro
                              : l10n.phaSignInIntro,
                          key: const Key('phone-sign-in-intro'),
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodyMedium,
                        ),
                        const SizedBox(height: AppSpacing.lg),
                        CountryPhoneField(
                          fieldKey: const Key('phone-sign-in-number'),
                          controller: _phoneController,
                          enabled: !_busy,
                          labelText: l10n.phoneNumber,
                          helperText: l10n.phoneVerificationCountryCodeHelp,
                          showClearButton: true,
                          textInputAction: TextInputAction.done,
                          onChanged: (_) {
                            if (_error != null) setState(() => _error = null);
                          },
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
                          child: Text(
                            _sending &&
                                    _challenge == null &&
                                    _smsSession == null
                                ? l10n.phoneVerificationSendingCode
                                : _codeSentText(l10n),
                            key: const Key('phone-sign-in-code-sent'),
                            style: const TextStyle(fontWeight: FontWeight.w600),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          key: const Key('phone-sign-in-code'),
                          controller: _codeController,
                          focusNode: _codeFocus,
                          enabled: !_busy,
                          keyboardType: TextInputType.number,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.oneTimeCode],
                          scrollPadding: const EdgeInsets.only(bottom: 160),
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                            LengthLimitingTextInputFormatter(6),
                          ],
                          onChanged: (_) {
                            if (_error != null) setState(() => _error = null);
                          },
                          onSubmitted: (_) => _busy ? null : _verify(),
                          decoration: InputDecoration(
                            labelText: l10n.phoneVerificationCode,
                            prefixIcon: const Icon(Icons.password_outlined),
                          ),
                        ),
                      ],
                      if (_note != null) ...[
                        const SizedBox(height: 12),
                        Semantics(
                          liveRegion: true,
                          child: Text(
                            _note!,
                            key: const Key('phone-sign-in-note'),
                            style: const TextStyle(
                              color: AppColors.cobaltDeep,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                      ],
                      if (_error != null) ...[
                        const SizedBox(height: 12),
                        Semantics(
                          liveRegion: true,
                          child: Container(
                            key: const Key('phone-sign-in-error'),
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
                          key: const Key('phone-sign-in-primary'),
                          onPressed: _busy || (codeStep && _sending)
                              ? null
                              : codeStep
                              ? _verify
                              : _submitNumber,
                          child: _progressLabel(
                            codeStep
                                ? (_verifying
                                      ? l10n.phoneVerificationVerifying
                                      : _isLink
                                      ? l10n.verifyPhone
                                      : l10n.signIn)
                                : (_sending
                                      ? l10n.phoneVerificationSendingCode
                                      : _textOnly
                                      ? l10n.phaSendTextCode
                                      : l10n.phaSendWhatsAppCode),
                            loading: _verifying || (!codeStep && _sending),
                            color: onPrimary,
                          ),
                        ),
                      ),
                      if (!codeStep && !_textOnly && !_isLink) ...[
                        const SizedBox(height: 8),
                        TextButton(
                          key: const Key('phone-sign-in-text-instead'),
                          onPressed: _busy ? null : () => _switchToText(),
                          child: Text(l10n.phaSendByText),
                        ),
                      ],
                      if (codeStep) ...[
                        const SizedBox(height: 8),
                        TextButton(
                          key: const Key('phone-sign-in-resend'),
                          onPressed: _busy || _sending || _countdown.waiting
                              ? null
                              : _resend,
                          child: _progressLabel(
                            _sending &&
                                    (_challenge != null || _smsSession != null)
                                ? l10n.phoneVerificationResending
                                : _countdown.waiting
                                ? l10n.phoneVerificationResendIn(
                                    _countdown.secondsLeft,
                                  )
                                : l10n.phoneVerificationResend,
                            loading:
                                _sending &&
                                (_challenge != null || _smsSession != null),
                          ),
                        ),
                        if (_channel == _Channel.whatsapp && !_isLink)
                          TextButton(
                            key: const Key('phone-sign-in-text-instead'),
                            onPressed: _busy ? null : () => _switchToText(),
                            child: Text(l10n.phaSendByText),
                          ),
                        if (typedFlow)
                          TextButton(
                            key: const Key('phone-sign-in-change-number'),
                            onPressed: _busy ? null : _changeNumber,
                            child: Text(l10n.phoneVerificationChangeNumber),
                          ),
                      ],
                      if (_channel == _Channel.sms || _textOnly) ...[
                        const SizedBox(height: 8),
                        Text(
                          l10n.phoneVerificationSmsNotice,
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                      ],
                    ],
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
