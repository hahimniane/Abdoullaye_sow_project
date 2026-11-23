import 'dart:async';

import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart' show ContainerLine;
import '../services/package_receipt.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'business_card_face.dart' show BusinessCardQr;

/// Opens a link in another app (Messages, Mail); false when nothing could.
typedef ReceiptLaunch = Future<bool> Function(Uri uri);

/// Hands the receipt link to the system share sheet.
typedef ReceiptShare = Future<void> Function(String link, String subject);

Future<bool> _launchExternal(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

Future<void> _shareLink(String link, String subject) =>
    SharePlus.instance.share(ShareParams(text: link, subject: subject));

/// Why the receipt was not sent, in words staff can act on.
String receiptRefusalText(AppLocalizations l10n, ReceiptRefusal refusal) =>
    switch (refusal) {
      ReceiptRefusal.noSenderPhone => l10n.prcRefNoPhone,
      ReceiptRefusal.smsNotSetUp => l10n.prcRefSmsOff,
      ReceiptRefusal.tooSoon => l10n.prcRefTooSoon,
      ReceiptRefusal.lineGone => l10n.prcRefGone,
      ReceiptRefusal.whatsAppOff => l10n.prcRefWhatsAppOff,
      ReceiptRefusal.other => l10n.prcRefOther,
    };

/// "Receipt sent on WhatsApp Nov 23, 2026 2:10 AM", or what went wrong.
String receiptStatusText(
  AppLocalizations l10n,
  ReceiptStatus status,
  String locale,
) {
  final channel = status.channel == ReceiptChannel.sms
      ? l10n.prcChannelText
      : l10n.prcChannelWhatsApp;
  return switch (status.kind) {
    ReceiptStatusKind.notOnWhatsApp => l10n.prcStatusNotOnWhatsApp,
    ReceiptStatusKind.failed => l10n.prcStatusFailed(channel),
    ReceiptStatusKind.pending => l10n.prcStatusPending(channel),
    ReceiptStatusKind.sent =>
      l10n
          .prcStatusSent(
            channel,
            status.at == null ? '' : displayDateTime(status.at!, locale),
          )
          .trim(),
  };
}

/// "Send receipt" under a package: opens the sheet that sends the receipt to
/// the sender by WhatsApp, text, email, QR or share
/// (docs/PACKAGE_RECEIPT_SEND.md). Nothing is drawn for a line with no id.
class ReceiptSendButton extends StatelessWidget {
  const ReceiptSendButton({
    super.key,
    required this.line,
    this.indent = 0,
    this.service,
    this.launch = _launchExternal,
    this.share = _shareLink,
  });

  final ContainerLine line;
  final double indent;

  /// The server; the real callables when null.
  final PackageReceiptService? service;
  final ReceiptLaunch launch;
  final ReceiptShare share;

  @override
  Widget build(BuildContext context) {
    if (line.id.isEmpty || line.businessId.isEmpty) {
      return const SizedBox.shrink();
    }
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: EdgeInsets.only(left: indent),
      child: Align(
        alignment: AlignmentDirectional.centerStart,
        child: TextButton.icon(
          key: Key('receipt-send:${line.id}'),
          onPressed: () => showPackageReceiptSheet(
            context,
            businessId: line.businessId,
            lineId: line.id,
            senderName: line.customerName,
            senderPhone: line.customerPhone,
            service: service,
            launch: launch,
            share: share,
          ),
          icon: const Icon(Icons.receipt_long_outlined, size: 16),
          label: Text(l10n.prcSendReceipt),
          style: TextButton.styleFrom(
            visualDensity: VisualDensity.compact,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            minimumSize: const Size(0, 36),
            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          ),
        ),
      ),
    );
  }
}

Future<void> showPackageReceiptSheet(
  BuildContext context, {
  required String businessId,
  required String lineId,
  String senderName = '',
  String senderPhone = '',
  PackageReceiptService? service,
  ReceiptLaunch launch = _launchExternal,
  ReceiptShare share = _shareLink,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: AppColors.paper,
    builder: (_) => PackageReceiptSheet(
      businessId: businessId,
      lineId: lineId,
      senderName: senderName,
      senderPhone: senderPhone,
      service: service ?? const FirebasePackageReceiptService(),
      launch: launch,
      share: share,
    ),
  );
}

/// The choice: WhatsApp first and the default, then text, email, QR, share.
class PackageReceiptSheet extends StatefulWidget {
  const PackageReceiptSheet({
    super.key,
    required this.businessId,
    required this.lineId,
    required this.service,
    this.senderName = '',
    this.senderPhone = '',
    this.launch = _launchExternal,
    this.share = _shareLink,
    this.now = DateTime.now,
  });

  final String businessId;
  final String lineId;
  final String senderName;
  final String senderPhone;
  final PackageReceiptService service;
  final ReceiptLaunch launch;
  final ReceiptShare share;
  final DateTime Function() now;

  @override
  State<PackageReceiptSheet> createState() => _PackageReceiptSheetState();
}

class _PackageReceiptSheetState extends State<PackageReceiptSheet> {
  /// The option working now ('' = none): a second tap is ignored.
  String _busy = '';
  String _message = '';
  bool _messageIsError = false;
  ReceiptLink? _link;
  late final Stream<List<ReceiptRow>> _rows = widget.service.watchRows(
    widget.businessId,
    widget.lineId,
  );

  void _say(String text, {bool error = false}) {
    if (!mounted) return;
    setState(() {
      _message = text;
      _messageIsError = error;
    });
  }

  /// Runs one option: guarded against a double tap, always released.
  Future<void> _run(String option, Future<void> Function() body) async {
    if (_busy.isNotEmpty) return;
    setState(() {
      _busy = option;
      _message = '';
    });
    try {
      await body();
    } on ReceiptFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      _say(
        receiptRefusalText(AppLocalizations.of(context)!, failure.refusal),
        error: true,
      );
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      _say(
        receiptRefusalText(AppLocalizations.of(context)!, ReceiptRefusal.other),
        error: true,
      );
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  Future<ReceiptLink> _freshLink() async {
    final have = _link;
    if (have != null && have.freshAt(widget.now().millisecondsSinceEpoch)) {
      return have;
    }
    final link = await widget.service.link(widget.businessId, widget.lineId);
    _link = link;
    return link;
  }

  Future<void> _sendServer(ReceiptChannel channel) async {
    final l10n = AppLocalizations.of(context)!;
    await widget.service.send(widget.businessId, widget.lineId, channel);
    if (!mounted) return;
    AppHaptics.commit();
    _say(
      channel == ReceiptChannel.sms ? l10n.prcSentText : l10n.prcSentWhatsApp,
    );
  }

  Future<void> _text() async {
    final l10n = AppLocalizations.of(context)!;
    final link = await _freshLink();
    if (link.smsReady) {
      await _sendServer(ReceiptChannel.sms);
      return;
    }
    final phone = link.sender.phone.isNotEmpty
        ? link.sender.phone
        : widget.senderPhone;
    if (phone.trim().isEmpty) {
      throw const ReceiptFailure(ReceiptRefusal.noSenderPhone);
    }
    final name = link.sender.name.isNotEmpty
        ? link.sender.name
        : widget.senderName;
    final opened = await widget.launch(
      receiptSmsUri(phone, receiptMessageBody(link.link, name: name)),
    );
    if (!opened) _say(l10n.prcCouldNotOpenText, error: true);
  }

  Future<void> _email() async {
    final l10n = AppLocalizations.of(context)!;
    final link = await _freshLink();
    var address = link.sender.email;
    if (!receiptEmailValid(address)) {
      if (!mounted) return;
      // The question is on screen: the option stops spinning.
      setState(() => _busy = '');
      final asked = await showDialog<String>(
        context: context,
        builder: (_) => _EmailAsk(initial: address),
      );
      if (asked == null || !receiptEmailValid(asked)) return;
      address = asked;
    }
    final name = link.sender.name.isNotEmpty
        ? link.sender.name
        : widget.senderName;
    final opened = await widget.launch(
      receiptMailUri(
        address,
        receiptEmailSubject,
        receiptMessageBody(link.link, name: name),
      ),
    );
    if (!opened) _say(l10n.prcCouldNotOpenMail, error: true);
  }

  Future<void> _qr() async {
    final link = await _freshLink();
    if (!mounted) return;
    setState(() => _busy = '');
    await showDialog<void>(
      context: context,
      builder: (_) => _QrDialog(link: link.link),
    );
  }

  Future<void> _shareIt() async {
    final link = await _freshLink();
    await widget.share(link.link, receiptEmailSubject);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final who = [
      widget.senderName,
      widget.senderPhone,
    ].where((p) => p.trim().isNotEmpty).join(' · ');
    return SingleChildScrollView(
      key: const Key('receipt-sheet'),
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        0,
        AppSpacing.lg,
        AppSpacing.lg + MediaQuery.of(context).viewInsets.bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            l10n.prcSheetTitle,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            who.isEmpty ? l10n.prcSenderOnly : l10n.prcSenderLine(who),
            key: const Key('receipt-sender'),
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          ),
          if (who.isNotEmpty)
            Text(
              l10n.prcSenderOnly,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          StreamBuilder<List<ReceiptRow>>(
            stream: _rows,
            builder: (context, snapshot) {
              final status = lastReceiptStatus(snapshot.data ?? const []);
              if (status == null) return const SizedBox.shrink();
              return Padding(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                child: Text(
                  receiptStatusText(l10n, status, locale),
                  key: const Key('receipt-status'),
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    fontWeight: FontWeight.w600,
                    color: status.failed ? AppColors.errorRed : AppColors.sage,
                  ),
                ),
              );
            },
          ),
          const SizedBox(height: AppSpacing.md),
          _Option(
            optionKey: 'receipt-whatsapp',
            icon: Icons.chat_outlined,
            title: l10n.prcWhatsApp,
            note: l10n.prcWhatsAppNote,
            primary: true,
            busy: _busy == 'whatsapp',
            enabled: _busy.isEmpty,
            onTap: () =>
                _run('whatsapp', () => _sendServer(ReceiptChannel.whatsapp)),
          ),
          _Option(
            optionKey: 'receipt-text',
            icon: Icons.sms_outlined,
            title: l10n.prcText,
            note: l10n.prcTextNote,
            busy: _busy == 'text',
            enabled: _busy.isEmpty,
            onTap: () => _run('text', _text),
          ),
          _Option(
            optionKey: 'receipt-email',
            icon: Icons.mail_outline,
            title: l10n.prcEmail,
            note: l10n.prcEmailNote,
            busy: _busy == 'email',
            enabled: _busy.isEmpty,
            onTap: () => _run('email', _email),
          ),
          _Option(
            optionKey: 'receipt-qr',
            icon: Icons.qr_code_2,
            title: l10n.prcQr,
            note: l10n.prcQrNote,
            busy: _busy == 'qr',
            enabled: _busy.isEmpty,
            onTap: () => _run('qr', _qr),
          ),
          _Option(
            optionKey: 'receipt-share',
            icon: Icons.ios_share,
            title: l10n.prcShare,
            note: l10n.prcShareNote,
            busy: _busy == 'share',
            enabled: _busy.isEmpty,
            onTap: () => _run('share', _shareIt),
          ),
          if (_message.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Text(
                _message,
                key: Key(_messageIsError ? 'receipt-error' : 'receipt-done'),
                style: TextStyle(
                  fontSize: 13,
                  height: 1.35,
                  fontWeight: FontWeight.w600,
                  color: _messageIsError ? AppColors.errorRed : AppColors.sage,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Option extends StatelessWidget {
  const _Option({
    required this.optionKey,
    required this.icon,
    required this.title,
    required this.note,
    required this.busy,
    required this.enabled,
    required this.onTap,
    this.primary = false,
  });

  final String optionKey;
  final IconData icon;
  final String title;
  final String note;
  final bool busy;
  final bool enabled;
  final bool primary;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Material(
        color: primary
            ? AppColors.cobalt.withValues(alpha: 0.07)
            : AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          side: BorderSide(color: primary ? AppColors.cobalt : AppColors.rule),
        ),
        child: InkWell(
          key: Key(optionKey),
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          onTap: enabled ? onTap : null,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.md),
            child: Row(
              children: [
                busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : Icon(icon, size: 22, color: AppColors.cobaltDeep),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        busy ? l10n.prcWorking : title,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        note,
                        style: const TextStyle(
                          fontSize: 12.5,
                          height: 1.3,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _EmailAsk extends StatefulWidget {
  const _EmailAsk({this.initial = ''});

  final String initial;

  @override
  State<_EmailAsk> createState() => _EmailAskState();
}

class _EmailAskState extends State<_EmailAsk> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.initial,
  );
  bool _invalid = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text.trim();
    if (!receiptEmailValid(value)) {
      setState(() => _invalid = true);
      return;
    }
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(l10n.prcEmailAskTitle),
      content: TextField(
        key: const Key('receipt-email-field'),
        controller: _controller,
        autofocus: true,
        keyboardType: TextInputType.emailAddress,
        autocorrect: false,
        textInputAction: TextInputAction.done,
        onSubmitted: (_) => _submit(),
        decoration: InputDecoration(
          hintText: l10n.prcEmailAskHint,
          errorText: _invalid ? l10n.prcEmailInvalid : null,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: const Key('receipt-email-continue'),
          onPressed: _submit,
          child: Text(l10n.prcContinue),
        ),
      ],
    );
  }
}

class _QrDialog extends StatelessWidget {
  const _QrDialog({required this.link});

  final String link;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(l10n.prcQrTitle),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Semantics(
              image: true,
              label: l10n.prcQrLabel,
              excludeSemantics: true,
              child: BusinessCardQr(link: link, size: 240),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.prcQrHint,
              key: const Key('receipt-qr-hint'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(l10n.close),
        ),
      ],
    );
  }
}

/// Settings: how this business sends package receipts. Owner or admin
/// changes it; others see it read only. Always resolves: a safety timeout
/// turns a read that never answers into a "could not load" line.
class PackageReceiptModeCard extends StatefulWidget {
  const PackageReceiptModeCard({
    super.key,
    required this.businessId,
    required this.canEdit,
    required this.source,
    this.timeout = const Duration(seconds: 15),
  });

  final String businessId;
  final bool canEdit;
  final PackageReceiptModeSource source;
  final Duration timeout;

  @override
  State<PackageReceiptModeCard> createState() => _PackageReceiptModeCardState();
}

class _PackageReceiptModeCardState extends State<PackageReceiptModeCard> {
  StreamSubscription<String>? _sub;
  Timer? _safety;
  String? _mode;
  bool _failed = false;
  bool _saving = false;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(widget.timeout, () {
      if (mounted && _mode == null) setState(() => _failed = true);
    });
    _sub = widget.source
        .watch(widget.businessId)
        .listen(
          (mode) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _mode = mode;
              _failed = false;
            });
          },
          onError: (Object _) {
            _safety?.cancel();
            if (mounted && _mode == null) setState(() => _failed = true);
          },
        );
  }

  @override
  void dispose() {
    _sub?.cancel();
    _safety?.cancel();
    super.dispose();
  }

  Future<void> _choose(String mode) async {
    if (_saving || !widget.canEdit || mode == _mode) return;
    final l10n = AppLocalizations.of(context)!;
    final before = _mode;
    setState(() {
      _saving = true;
      _error = '';
      _mode = mode;
    });
    try {
      final kept = await widget.source.save(widget.businessId, mode);
      if (!mounted) return;
      AppHaptics.commit();
      setState(() => _mode = kept);
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _mode = before;
        _error = l10n.prcSettingsFailed;
      });
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final mode = _mode;
    final enabled = widget.canEdit && !_saving;
    return Container(
      key: const Key('receipt-mode-card'),
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.prcSettingsTitle,
            style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
          ),
          const SizedBox(height: 4),
          Text(
            l10n.prcSettingsNote,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (mode == null && !_failed)
            const Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            )
          else if (mode == null)
            Text(
              l10n.prcSettingsLoadFailed,
              key: const Key('receipt-mode-load-failed'),
              style: const TextStyle(fontSize: 13, color: AppColors.errorRed),
            )
          else ...[
            PackageModeTile(
              tileKey: 'receipt-mode-button',
              label: l10n.prcModeButton,
              selected: mode == receiptModeButton,
              onTap: enabled ? () => _choose(receiptModeButton) : null,
            ),
            PackageModeTile(
              tileKey: 'receipt-mode-auto',
              label: l10n.prcModeAuto,
              selected: mode == receiptModeAuto,
              onTap: enabled ? () => _choose(receiptModeAuto) : null,
            ),
          ],
          if (!widget.canEdit)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                l10n.prcSettingsOwnerOnly,
                key: const Key('receipt-mode-owner-only'),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                _error,
                key: const Key('receipt-mode-error'),
                style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
              ),
            ),
        ],
      ),
    );
  }
}

/// One choice of a setting card: a radio row (also the package price card's).
class PackageModeTile extends StatelessWidget {
  const PackageModeTile({
    super.key,
    required this.tileKey,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String tileKey;
  final String label;
  final bool selected;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      inMutuallyExclusiveGroup: true,
      checked: selected,
      child: InkWell(
        key: Key(tileKey),
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            children: [
              Icon(
                selected ? Icons.radio_button_checked : Icons.radio_button_off,
                size: 22,
                color: selected ? AppColors.cobalt : AppColors.muted,
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(label, style: const TextStyle(fontSize: 14)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
