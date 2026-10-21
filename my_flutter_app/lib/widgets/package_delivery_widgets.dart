import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../screens/containers_screen.dart' show containerLineTitle;
import '../services/container_delivery.dart';
import '../services/container_delivery_service.dart';
import '../services/container_manifest.dart';
import '../services/line_pieces.dart' show LineGroupSummary;
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';

/// The words and shared pieces of a package delivery (docs/WAITING_PACKAGES.md
/// "Delivered at destination"): the Mark delivered sheet, the undo, the
/// delivered card, the Delivered pill and "X of Y delivered". The package
/// page, the container page and the scan list all use these, so a delivery
/// reads and behaves the same wherever it is done.

/// What the signed-in person may see and do on a package: from the
/// provider's permissions. A widget test without an [AuthProvider] above it
/// passes its own access, or gets the full view the screens always had.
PackageAccess packageAccessOf(BuildContext context) {
  final auth = Provider.of<AuthProvider?>(context, listen: false);
  return auth?.packageAccess ?? PackageAccess.full;
}

/// A refused delivery in the app's words, by `details.reason` - never the
/// server's English message.
String deliveryRefusalText(AppLocalizations l10n, DeliveryFailure failure) {
  switch (failure.reason) {
    case DeliveryReason.actionInvalid:
      return l10n.dlvErrAction;
    case DeliveryReason.notArrived:
      return l10n.dlvErrNotArrived;
    case DeliveryReason.balanceDue:
      return l10n.dlvErrBalanceDue;
    case DeliveryReason.collectedByTooLong:
      return l10n.dlvCollectedByTooLong;
    case DeliveryReason.lineNotFound:
      return l10n.dlvErrLineNotFound;
  }
  if (failure.notAllowed) return l10n.dlvErrNotAllowed;
  if (failure.offline) return l10n.dlvErrOffline;
  return l10n.dlvErrGeneric;
}

/// The balance warning in words, with the amount only when [notice] carries
/// one (a person who may see money).
String deliveryBalanceText(
  AppLocalizations l10n,
  DeliveryBalanceNotice notice,
) => notice.kind == DeliveryBalanceNoticeKind.amount
    ? l10n.dlvBalanceOwed(formatLotCents(notice.balanceCents ?? 0))
    : l10n.dlvBalanceUnpaid;

/// "Delivered" as a small pill, beside (or instead of) the container's state.
class DeliveredPill extends StatelessWidget {
  const DeliveredPill({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    const color = AppColors.cobaltDeep;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.check, size: 12, color: color),
          const SizedBox(width: 3),
          Text(
            l10n.dlvDeliveredPill,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.3,
              color: color,
            ),
          ),
        ],
      ),
    );
  }
}

/// "3 of 12 delivered" for a container that is ready for pickup (or has
/// anything delivered); nothing otherwise.
class ContainerDeliveryProgressLabel extends StatelessWidget {
  const ContainerDeliveryProgressLabel({
    super.key,
    required this.container,
    this.fontSize = 12,
  });

  final ShippingContainer container;
  final double fontSize;

  @override
  Widget build(BuildContext context) {
    if (!showsDeliveryProgress(container)) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final progress = containerDeliveryProgress(container);
    final color = progress.complete ? AppColors.sage : AppColors.cobaltDeep;
    return Row(
      key: ValueKey('container-delivery-progress:${container.id}'),
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(
          progress.complete ? Icons.task_alt : Icons.how_to_reg_outlined,
          size: fontSize + 3,
          color: color,
        ),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            l10n.dlvProgress(progress.delivered, progress.total),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: fontSize,
              fontWeight: FontWeight.w700,
              color: color,
            ),
          ),
        ),
      ],
    );
  }
}

/// Opens the Mark delivered sheet for [line]. Answers the server's result
/// once it is delivered (and says so), null when the sheet was closed.
Future<DeliveryResult?> showMarkDeliveredSheet(
  BuildContext context, {
  required String businessId,
  required ContainerLine line,
  LineGroupSummary? group,
  required PackageAccess access,
  ContainerDeliveryService service = const ContainerDeliveryService(),
}) async {
  final l10n = AppLocalizations.of(context)!;
  final result = await showLotSheet<DeliveryResult>(
    context,
    MarkDeliveredSheet(
      businessId: businessId,
      line: line,
      group: group,
      access: access,
      service: service,
    ),
  );
  if (result != null && context.mounted) {
    AppHaptics.commit();
    showSuccessSnackBar(
      context,
      result.alreadyDelivered ? l10n.dlvAlreadyDelivered : l10n.dlvDone,
    );
  }
  return result;
}

/// Who collected the package (the receiver unless someone collects for
/// them), the unpaid-balance warning, and the confirm button. A balance is a
/// warning, never a block: once it shows, the button says "Deliver anyway"
/// and the call carries `acknowledgeBalance`. A balance the phone could not
/// see (a part read without its root) comes back from the server as
/// `delivery_balance_due` and is shown the same way before trying again.
class MarkDeliveredSheet extends StatefulWidget {
  const MarkDeliveredSheet({
    super.key,
    required this.businessId,
    required this.line,
    required this.access,
    this.group,
    this.service = const ContainerDeliveryService(),
  });

  final String businessId;
  final ContainerLine line;
  final LineGroupSummary? group;
  final PackageAccess access;
  final ContainerDeliveryService service;

  @override
  State<MarkDeliveredSheet> createState() => _MarkDeliveredSheetState();
}

class _MarkDeliveredSheetState extends State<MarkDeliveredSheet> {
  late final TextEditingController _collectedBy = TextEditingController(
    text: collectedByDefault(widget.line),
  );

  /// Worked out once from the group the caller holds; replaced by the
  /// server's answer when it saw a balance the phone did not.
  late DeliveryBalanceNotice _notice = deliveryBalanceNotice(
    balanceCents: deliveryBalanceCents(widget.line, widget.group),
    canSeeMoney: widget.access.canSeeMoney,
  );

  bool _busy = false;
  String? _fieldError;
  String? _error;

  @override
  void dispose() {
    _collectedBy.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final typed = _collectedBy.text;
    if (collectedByErrors(typed).isNotEmpty) {
      setState(() => _fieldError = l10n.dlvCollectedByTooLong);
      return;
    }
    setState(() {
      _busy = true;
      _fieldError = null;
      _error = null;
    });
    try {
      final result = await widget.service.deliver(
        widget.businessId,
        widget.line.id,
        collectedBy: typed,
        // The warning is on screen: pressing the button is the confirm.
        acknowledgeBalance: _notice.warns,
      );
      if (!mounted) return;
      Navigator.of(context).pop(result);
    } on DeliveryFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        if (failure.balanceDue) {
          // Show the warning, and let the next press confirm it.
          _notice = deliveryBalanceNotice(
            balanceCents: failure.balanceCents ?? 1,
            canSeeMoney:
                widget.access.canSeeMoney && failure.balanceCents != null,
          );
        } else if (failure.reason == DeliveryReason.collectedByTooLong) {
          _fieldError = l10n.dlvCollectedByTooLong;
        } else {
          _error = deliveryRefusalText(l10n, failure);
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = widget.line;
    final what = containerLineTitle(l10n, line);
    final receiver = collectedByDefault(line);
    return LotSheetShell(
      title: l10n.dlvMarkDelivered,
      subtitle: receiver.isEmpty ? what : l10n.dlvSheetSubtitle(what, receiver),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('delivery-collected-by'),
            controller: _collectedBy,
            enabled: !_busy,
            textCapitalization: TextCapitalization.words,
            textInputAction: TextInputAction.done,
            onChanged: (_) {
              if (_fieldError != null) setState(() => _fieldError = null);
            },
            decoration: InputDecoration(
              labelText: l10n.dlvCollectedByLabel,
              helperText: l10n.dlvCollectedByHelper,
              helperMaxLines: 2,
              errorText: _fieldError,
              prefixIcon: const Icon(
                Icons.person_outline,
                size: 20,
                color: AppColors.muted,
              ),
            ),
          ),
          if (_notice.warns) ...[
            const SizedBox(height: AppSpacing.md),
            _BalanceWarning(notice: _notice),
          ],
          if (_error != null) ...[
            const SizedBox(height: AppSpacing.md),
            Text(
              _error!,
              key: const Key('delivery-error'),
              style: const TextStyle(
                fontSize: 13,
                height: 1.35,
                color: AppColors.errorRed,
              ),
            ),
          ],
        ],
      ),
      footer: LotSheetButton(
        key: const Key('delivery-confirm'),
        label: _notice.warns ? l10n.dlvDeliverAnyway : l10n.dlvMarkDelivered,
        busy: _busy,
        busyLabel: l10n.dlvMarking,
        tone: LotTone.good,
        onTap: _submit,
      ),
    );
  }
}

class _BalanceWarning extends StatelessWidget {
  const _BalanceWarning({required this.notice});

  final DeliveryBalanceNotice notice;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('delivery-balance-warning'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.warn.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.warn.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.warning_amber_rounded,
            size: 20,
            color: AppColors.warn,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  deliveryBalanceText(l10n, notice),
                  style: const TextStyle(
                    fontSize: 14,
                    height: 1.35,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  l10n.dlvBalanceConfirm,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// "Undo this delivery?" - the package goes back to ready for pickup and
/// nobody is messaged.
Future<bool> confirmUndoDelivery(BuildContext context) {
  final l10n = AppLocalizations.of(context)!;
  return confirmMajorAction(
    context,
    title: l10n.dlvUndoTitle,
    message: l10n.dlvUndoMessage,
    confirmLabel: l10n.dlvUndo,
    icon: Icons.undo,
    destructive: true,
  );
}

/// Undoes the delivery of [lineId] and says how it went. The caller shows
/// progress on its own button around this (after the confirm dialog has
/// closed). Answers whether a delivery was undone.
Future<bool> runUndoDelivery(
  BuildContext context, {
  required String businessId,
  required String lineId,
  ContainerDeliveryService service = const ContainerDeliveryService(),
}) async {
  final l10n = AppLocalizations.of(context)!;
  try {
    final undone = await service.undo(businessId, lineId);
    if (!context.mounted) return undone;
    AppHaptics.commit();
    showSuccessSnackBar(context, undone ? l10n.dlvUndone : l10n.dlvNotUndone);
    return undone;
  } on DeliveryFailure catch (failure) {
    if (context.mounted) {
      AppHaptics.refuse();
      showErrorSnackBar(context, deliveryRefusalText(l10n, failure));
    }
    return false;
  }
}

/// A delivered package: when, who handed it over, who collected it (and,
/// for someone who may see money, what it still owed then), with Undo for a
/// manager.
class PackageDeliveredCard extends StatelessWidget {
  const PackageDeliveredCard({
    super.key,
    required this.line,
    required this.canSeeMoney,
    this.onUndo,
    this.undoing = false,
  });

  final ContainerLine line;
  final bool canSeeMoney;

  /// Null hides Undo (only a manager may undo).
  final VoidCallback? onUndo;
  final bool undoing;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final at = line.deliveredAt;
    final facts = <(IconData, String, Key)>[
      if (line.deliveredByName.isNotEmpty)
        (
          Icons.badge_outlined,
          l10n.dlvHandedOverBy(line.deliveredByName),
          const Key('delivered-by'),
        ),
      if (line.collectedBy.isNotEmpty)
        (
          Icons.person_outline,
          l10n.dlvCollectedBy(line.collectedBy),
          const Key('delivered-collected-by'),
        ),
      if (canSeeMoney && line.deliveredBalanceCents > 0)
        (
          Icons.payments_outlined,
          l10n.dlvOwedAtDelivery(formatLotCents(line.deliveredBalanceCents)),
          const Key('delivered-owed'),
        ),
    ];
    return Column(
      key: const Key('pkg-delivered'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const Icon(Icons.task_alt, size: 20, color: AppColors.sage),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                at == null
                    ? l10n.dlvDeliveredPill
                    : l10n.dlvDeliveredOn(displayDateTime(at, locale)),
                key: const Key('delivered-when'),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
            ),
          ],
        ),
        for (final (icon, text, key) in facts)
          Padding(
            key: key,
            padding: const EdgeInsets.only(top: 6, left: 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, size: 16, color: AppColors.muted),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    text,
                    style: const TextStyle(
                      fontSize: 13.5,
                      height: 1.35,
                      color: AppColors.ink,
                    ),
                  ),
                ),
              ],
            ),
          ),
        if (onUndo != null) ...[
          const SizedBox(height: AppSpacing.md),
          Align(
            alignment: Alignment.centerLeft,
            child: OutlinedButton.icon(
              key: const Key('pkg-undo-delivery'),
              onPressed: undoing ? null : onUndo,
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.errorRed,
                side: BorderSide(
                  color: AppColors.errorRed.withValues(alpha: 0.5),
                ),
                minimumSize: const Size(0, 40),
              ),
              icon: undoing
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.errorRed,
                      ),
                    )
                  : const Icon(Icons.undo, size: 18),
              label: Text(l10n.dlvUndo),
            ),
          ),
        ],
      ],
    );
  }
}
