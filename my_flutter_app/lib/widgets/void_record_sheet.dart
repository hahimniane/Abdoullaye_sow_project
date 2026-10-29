/// Voiding, shared: the one confirmation every never-deleted record uses (a
/// lot activity, a purchase, an expense line, a parked car) and the one note
/// a voided record carries ("Voided · reason · by · date").
///
/// Records are never deleted here. A void keeps the row, strikes it through
/// and takes it out of every total; the server stamps `voided`,
/// `voidReason`, `voidedByStaffId` and `voidedAt`, and refuses a second void.
library;

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';

/// Sends the void, with the (optional, trimmed) reason staff typed.
typedef VoidRecordCall = Future<void> Function(String reason);

/// A [VoidRecordCall] that runs [callable] with [ids] plus the reason - the
/// shape every void callable takes (`voidLotActivity {activityId}`,
/// `voidLotExpenseEntry {entryId}` or `{lineId}`,
/// `updateBusinessParkingEntry {entryId, action: "void"}`).
VoidRecordCall voidThroughCallable(
  String callable,
  Map<String, Object?> ids, {
  FirebaseFunctions? functions,
}) {
  return (reason) async {
    await (functions ?? FirebaseFunctions.instance)
        .httpsCallable(callable)
        .call<Object?>(<String, Object?>{...ids, 'reason': reason});
  };
}

/// The `details.reason` a callable refusal carries, or ''.
String voidRefusalReason(Object? error) {
  if (error is! FirebaseFunctionsException) return '';
  final details = error.details;
  if (details is! Map) return '';
  return '${details['reason'] ?? ''}'.trim();
}

/// Voiding is the one destructive act on these records, so it asks - and
/// says exactly what happens, because "are you sure" teaches nothing.
///
/// The same confirm-then-call sheet serves the other record-ending acts
/// (an expense line's "Stop after this month" and its "Resume"), with
/// [askReason] off.
class VoidRecordSheet extends StatefulWidget {
  const VoidRecordSheet({
    super.key,
    required this.title,
    required this.explain,
    required this.onVoid,
    this.actionLabel,
    this.doneMessage,
    this.onDone,
    this.refusalText,
    this.askReason = true,
    this.tone = LotTone.warn,
  });

  /// Whether to ask for the optional reason. Off, [onVoid] gets ''.
  final bool askReason;

  /// The button's tone: a warning for a void or a stop.
  final LotTone tone;

  final String title;
  final String explain;
  final VoidRecordCall onVoid;

  /// The button; "Void" when null.
  final String? actionLabel;

  /// The snackbar after it worked; "Voided." when null.
  final String? doneMessage;
  final VoidCallback? onDone;

  /// Translated text for a server refusal reason (`details.reason`), or null
  /// to show the server's own message.
  final String? Function(String reason)? refusalText;

  @override
  State<VoidRecordSheet> createState() => _VoidRecordSheetState();
}

class _VoidRecordSheetState extends State<VoidRecordSheet> {
  final _reason = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = true);
    try {
      // The server keeps 300 characters; sending more only loses the end.
      final reason = _reason.text.trim();
      await widget.onVoid(
        reason.length > 300 ? reason.substring(0, 300) : reason,
      );
      if (!mounted) return;
      AppHaptics.commit();
      widget.onDone?.call();
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, widget.doneMessage ?? l10n.lotVoidDone);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      final reason = voidRefusalReason(error);
      final translated = reason.isEmpty
          ? null
          : widget.refusalText?.call(reason);
      final serverText = error is FirebaseFunctionsException
          ? (error.message ?? '').trim()
          : '';
      showErrorSnackBar(
        context,
        translated ??
            (serverText.isNotEmpty ? serverText : l10n.lotCouldNotSave),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LotSheetShell(
      title: widget.title,
      subtitle: widget.explain,
      body: widget.askReason
          ? TextField(
              key: const ValueKey<String>('void-reason'),
              controller: _reason,
              maxLength: 300,
              decoration: InputDecoration(labelText: l10n.lotVoidReason),
            )
          : const SizedBox.shrink(),
      footer: LotSheetButton(
        label: widget.actionLabel ?? l10n.lotVoid,
        tone: widget.tone,
        busy: _busy,
        busyLabel: l10n.lotSaving,
        onTap: _submit,
      ),
    );
  }
}

/// "Voided · reason · by Name · Oct 3, 2026": what happened to a voided
/// record, in one line. Empty parts drop out - a void with no reason, by
/// someone who has left the business, reads "Voided · Oct 3, 2026".
String voidedNoteText(
  AppLocalizations l10n,
  String locale, {
  required String status,
  String reason = '',
  String byName = '',
  DateTime? at,
}) {
  return [
    status,
    reason.trim(),
    if (byName.trim().isNotEmpty) l10n.voidedNoteBy(byName.trim()),
    if (at != null) displayDate(at, locale),
  ].where((part) => part.isNotEmpty).join(' · ');
}

/// [voidedNoteText] as a muted line, under a struck-through row.
class VoidedNote extends StatelessWidget {
  const VoidedNote({
    super.key,
    required this.status,
    this.reason = '',
    this.byName = '',
    this.at,
  });

  final String status;
  final String reason;
  final String byName;
  final DateTime? at;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Text(
      voidedNoteText(
        l10n,
        dateLocaleOf(context),
        status: status,
        reason: reason,
        byName: byName,
        at: at,
      ),
      key: const ValueKey<String>('voided-note'),
      maxLines: 2,
      overflow: TextOverflow.ellipsis,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: AppColors.errorRed,
      ),
    );
  }
}
