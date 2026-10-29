import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../screens/containers_screen.dart' show containerLineTitle;
import '../services/container_delivery.dart';
import '../services/container_delivery_service.dart';
import '../services/container_manifest.dart';
import '../services/line_pieces.dart' show LineGroupSummary;
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/package_photo_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';
import 'proof_refusal_text.dart';

/// The words and shared pieces of a package delivery (docs/WAITING_PACKAGES.md
/// "Delivered at destination"; docs/AIR_PACKAGES.md §1.6 and §4.7 for the
/// pickup code, the override and the money collected): the Mark delivered
/// sheet, the undo, the delivered card, the Delivered pill and "X of Y
/// delivered". The package page, the container page, the scan list and the
/// Deliveries home all use these, so a delivery reads and behaves the same
/// wherever it is done.

/// Takes one photo with the camera and answers its bytes, or null when the
/// person backed out. The sheet's default is `image_picker`; widget tests
/// hand in their own.
typedef DeliveryPhotoCapture = Future<Uint8List?> Function();

/// Puts a photo in the agent's own Storage folder and answers its path.
/// Mirrors `PackagePhotoService.upload`.
typedef DeliveryPhotoUploader =
    Future<String> Function({
      required String businessId,
      required List<int> bytes,
    });

/// A download URL for a photo path (`PackagePhotoService.url`).
typedef DeliveryPhotoUrl = Future<String> Function(String path);

Future<Uint8List?> _cameraPhoto() async {
  final picked = await ImagePicker().pickImage(
    source: ImageSource.camera,
    maxWidth: 1600,
    imageQuality: 82,
  );
  return picked?.readAsBytes();
}

Future<String> _uploadPhoto({
  required String businessId,
  required List<int> bytes,
}) => PackagePhotoService().upload(businessId: businessId, bytes: bytes);

Future<String> _photoUrl(String path) => PackagePhotoService().url(path);

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
  // The proof refusals (pickup code, override, money collected, photos...).
  final proof = proofRefusalText(l10n, failure.reason);
  if (proof != null) return proof;
  if (failure.notAllowed) return l10n.dlvErrNotAllowed;
  if (failure.offline) return l10n.dlvErrOffline;
  return l10n.dlvErrGeneric;
}

/// A photo that could not be taken or uploaded, in the app's words.
String deliveryPhotoFailureText(AppLocalizations l10n, Object error) {
  if (error is PackagePhotoFailure) {
    return switch (error.code) {
      'photo_invalid' => l10n.deliverRefusalPhotoInvalid,
      'photo_too_large' => l10n.prqPhotoTooLarge,
      'permission-denied' || 'unauthenticated' => l10n.dlvErrNotAllowed,
      'unavailable' => l10n.dlvErrOffline,
      _ => l10n.deliverPhotoFailed,
    };
  }
  return l10n.deliverPhotoFailed;
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

/// What the success snackbar says: "Marked delivered.", or with the money
/// collected when there was some.
String deliveryDoneText(AppLocalizations l10n, DeliveryResult result) {
  if (result.alreadyDelivered) return l10n.dlvAlreadyDelivered;
  if (result.collectedCents > 0) {
    return l10n.deliverDoneCollected(formatLotCents(result.collectedCents));
  }
  return l10n.dlvDone;
}

/// Opens the Mark delivered sheet for [line]. Answers the server's result
/// once it is delivered (and says so), null when the sheet was closed.
/// [askPickupCode] is true when the business asks for a pickup code and
/// this line has one (`deliveryAsksPickupCode`).
Future<DeliveryResult?> showMarkDeliveredSheet(
  BuildContext context, {
  required String businessId,
  required ContainerLine line,
  LineGroupSummary? group,
  required PackageAccess access,
  ContainerDeliveryService service = const ContainerDeliveryService(),
  bool askPickupCode = false,
  DeliveryPhotoCapture? photoCapture,
  DeliveryPhotoUploader? photoUploader,
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
      askPickupCode: askPickupCode,
      photoCapture: photoCapture,
      photoUploader: photoUploader,
    ),
  );
  if (result != null && context.mounted) {
    AppHaptics.commit();
    showSuccessSnackBar(context, deliveryDoneText(l10n, result));
  }
  return result;
}

/// Who collected the package (the receiver unless someone collects for
/// them), the pickup code when the business asks for one, the "deliver
/// without a code" override (a name and a photo) once a code failed, the
/// USD collected now, the unpaid-balance warning, and the confirm button.
///
/// A balance is a warning, never a block: once it shows, the button says
/// "Deliver anyway" and the call carries `acknowledgeBalance`. A balance the
/// phone could not see (a part read without its root) comes back from the
/// server as `delivery_balance_due` and is shown the same way before trying
/// again. A wrong code comes back as `pickup_code_invalid` and opens the
/// override section; the code itself is never shown here.
class MarkDeliveredSheet extends StatefulWidget {
  const MarkDeliveredSheet({
    super.key,
    required this.businessId,
    required this.line,
    required this.access,
    this.group,
    this.service = const ContainerDeliveryService(),
    this.askPickupCode = false,
    this.photoCapture,
    this.photoUploader,
  });

  final String businessId;
  final ContainerLine line;
  final LineGroupSummary? group;
  final PackageAccess access;
  final ContainerDeliveryService service;

  /// The business switch is on and the line has a code: ask for it.
  final bool askPickupCode;

  /// The camera and the upload; the real ones when null.
  final DeliveryPhotoCapture? photoCapture;
  final DeliveryPhotoUploader? photoUploader;

  @override
  State<MarkDeliveredSheet> createState() => _MarkDeliveredSheetState();
}

class _MarkDeliveredSheetState extends State<MarkDeliveredSheet> {
  late final TextEditingController _collectedBy = TextEditingController(
    text: collectedByDefault(widget.line),
  );
  final TextEditingController _pickupCode = TextEditingController();
  final TextEditingController _collectedNow = TextEditingController();

  /// Worked out once from the group the caller holds; replaced by the
  /// server's answer when it saw a balance the phone did not.
  late DeliveryBalanceNotice _notice = deliveryBalanceNotice(
    balanceCents: deliveryBalanceCents(widget.line, widget.group),
    canSeeMoney: widget.access.canSeeMoney,
  );

  /// The override section is open: the code failed (or was skipped) and
  /// the agent types who collected it and takes a photo instead.
  bool _withoutCode = false;

  /// The override photo: its bytes for the thumbnail, its path once
  /// uploaded.
  Uint8List? _photoBytes;
  String _photoPath = '';
  bool _uploading = false;

  bool _busy = false;
  String? _fieldError;
  String? _codeError;
  String? _photoError;
  String? _amountError;
  String? _error;

  @override
  void dispose() {
    _collectedBy.dispose();
    _pickupCode.dispose();
    _collectedNow.dispose();
    super.dispose();
  }

  bool get _asksCode => widget.askPickupCode && !_withoutCode;

  Future<void> _takePhoto() async {
    if (_busy || _uploading) return;
    final l10n = AppLocalizations.of(context)!;
    final capture = widget.photoCapture ?? _cameraPhoto;
    final upload = widget.photoUploader ?? _uploadPhoto;
    Uint8List? bytes;
    try {
      bytes = await capture();
    } catch (error) {
      if (!mounted) return;
      setState(() => _photoError = deliveryPhotoFailureText(l10n, error));
      return;
    }
    if (bytes == null || !mounted) return;
    setState(() {
      _uploading = true;
      _photoError = null;
      _photoBytes = bytes;
      _photoPath = '';
    });
    try {
      final path = await upload(businessId: widget.businessId, bytes: bytes);
      if (!mounted) return;
      setState(() {
        _photoPath = path;
        _error = null;
      });
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _photoBytes = null;
        _photoError = deliveryPhotoFailureText(l10n, error);
      });
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _submit() async {
    if (_busy || _uploading) return;
    final l10n = AppLocalizations.of(context)!;
    final typed = _collectedBy.text;
    if (collectedByErrors(typed).isNotEmpty) {
      setState(() => _fieldError = l10n.dlvCollectedByTooLong);
      return;
    }
    // The checks the server would make, before the call.
    if (_asksCode && !pickupCodeComplete(_pickupCode.text)) {
      AppHaptics.refuse();
      setState(() => _codeError = l10n.deliverPickupCodeIncomplete);
      return;
    }
    if (_withoutCode &&
        deliveryOverrideErrors(
          collectedBy: typed,
          photoPath: _photoPath,
        ).isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _error = l10n.deliverRefusalOverrideIncomplete);
      return;
    }
    final collectedCents = collectedCentsFromInput(_collectedNow.text);
    if (collectedCents == null) {
      AppHaptics.refuse();
      setState(() => _amountError = l10n.deliverCollectedNowInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _fieldError = null;
      _codeError = null;
      _amountError = null;
      _error = null;
    });
    try {
      final result = await widget.service.deliver(
        widget.businessId,
        widget.line.id,
        collectedBy: typed,
        // The warning is on screen: pressing the button is the confirm.
        acknowledgeBalance: _notice.warns,
        pickupCode: _asksCode ? _pickupCode.text : '',
        overrideCollectedBy: _withoutCode ? typed : '',
        overridePhotoPath: _withoutCode ? _photoPath : '',
        collectedCents: collectedCents,
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
        } else if (failure.reason == DeliveryReason.pickupCodeInvalid) {
          // The code did not match: say so at the field, and offer the
          // way without one.
          _codeError = l10n.deliverRefusalPickupCodeInvalid;
          _withoutCode = true;
        } else if (failure.reason == DeliveryReason.collectedCentsInvalid) {
          _amountError = l10n.deliverRefusalCollectedCentsInvalid;
        } else {
          _error = deliveryRefusalText(l10n, failure);
        }
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _openWithoutCode() {
    if (_busy) return;
    setState(() {
      _withoutCode = true;
      _codeError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final line = widget.line;
    final what = containerLineTitle(l10n, line);
    final receiver = collectedByDefault(line);
    final owes = _notice.kind == DeliveryBalanceNoticeKind.amount
        ? l10n.deliverOwes(formatLotCents(_notice.balanceCents ?? 0))
        : null;
    return LotSheetShell(
      title: l10n.dlvMarkDelivered,
      subtitle: receiver.isEmpty ? what : l10n.dlvSheetSubtitle(what, receiver),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_asksCode) ...[
            TextField(
              key: const Key('delivery-pickup-code'),
              controller: _pickupCode,
              enabled: !_busy,
              autofocus: true,
              keyboardType: TextInputType.number,
              textInputAction: TextInputAction.next,
              maxLength: 4,
              inputFormatters: [
                FilteringTextInputFormatter.digitsOnly,
                LengthLimitingTextInputFormatter(4),
              ],
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w700,
                letterSpacing: 6,
              ),
              onChanged: (_) {
                if (_codeError != null) setState(() => _codeError = null);
              },
              decoration: InputDecoration(
                labelText: l10n.deliverPickupCodeLabel,
                helperText: l10n.deliverPickupCodeHelper,
                helperMaxLines: 2,
                counterText: '',
                errorText: _codeError,
                errorMaxLines: 3,
                prefixIcon: const Icon(
                  Icons.pin_outlined,
                  size: 20,
                  color: AppColors.muted,
                ),
              ),
            ),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const Key('delivery-without-code'),
                onPressed: _busy ? null : _openWithoutCode,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                ),
                child: Text(l10n.deliverWithoutCodeTitle),
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (_withoutCode) ...[
            _WithoutCodeHeader(error: _codeError),
            const SizedBox(height: AppSpacing.md),
          ],
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
              labelText: _withoutCode
                  ? l10n.deliverCollectorLabel
                  : l10n.dlvCollectedByLabel,
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
          if (_withoutCode) ...[
            const SizedBox(height: AppSpacing.md),
            _OverridePhoto(
              bytes: _photoBytes,
              uploaded: _photoPath.isNotEmpty,
              uploading: _uploading,
              error: _photoError,
              onTake: _busy ? null : _takePhoto,
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('delivery-collected-now'),
            controller: _collectedNow,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: false),
            textInputAction: TextInputAction.done,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9$,\s]')),
            ],
            onChanged: (_) {
              if (_amountError != null) setState(() => _amountError = null);
            },
            decoration: InputDecoration(
              labelText: l10n.deliverCollectedNowLabel,
              helperText: owes ?? l10n.deliverCollectedNowHelper,
              helperMaxLines: 2,
              errorText: _amountError,
              prefixIcon: const Icon(
                Icons.payments_outlined,
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
        onTap: _uploading ? null : _submit,
      ),
    );
  }
}

/// "Deliver without a code" - what it means, and the code refusal that led
/// here when there was one.
class _WithoutCodeHeader extends StatelessWidget {
  const _WithoutCodeHeader({this.error});

  final String? error;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('delivery-override'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.warn.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.warn.withValues(alpha: 0.35)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (error != null) ...[
            Text(
              error!,
              key: const Key('delivery-code-error'),
              style: const TextStyle(
                fontSize: 13,
                height: 1.35,
                color: AppColors.errorRed,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          Text(
            l10n.deliverWithoutCodeTitle,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            l10n.deliverWithoutCodeNote,
            style: const TextStyle(
              fontSize: 12.5,
              height: 1.35,
              color: AppColors.muted,
            ),
          ),
        ],
      ),
    );
  }
}

/// The override photo: a camera button, then the thumbnail with Retake.
class _OverridePhoto extends StatelessWidget {
  const _OverridePhoto({
    required this.bytes,
    required this.uploaded,
    required this.uploading,
    required this.error,
    required this.onTake,
  });

  final Uint8List? bytes;
  final bool uploaded;
  final bool uploading;
  final String? error;
  final VoidCallback? onTake;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final photo = bytes;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.deliverPhotoLabel,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            if (photo != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                child: Image.memory(
                  photo,
                  key: const Key('delivery-photo-thumb'),
                  width: 72,
                  height: 72,
                  fit: BoxFit.cover,
                ),
              ),
            if (photo != null) const SizedBox(width: AppSpacing.md),
            Expanded(
              child: OutlinedButton.icon(
                key: const Key('delivery-take-photo'),
                onPressed: uploading ? null : onTake,
                icon: uploading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.photo_camera_outlined, size: 18),
                label: Text(
                  uploading
                      ? l10n.deliverPhotoUploading
                      : photo == null
                      ? l10n.deliverTakePhoto
                      : l10n.deliverRetakePhoto,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ),
          ],
        ),
        if (uploaded && !uploading)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Row(
              children: [
                const Icon(Icons.check, size: 14, color: AppColors.sage),
                const SizedBox(width: 4),
                Text(
                  l10n.deliverPhotoAdded,
                  key: const Key('delivery-photo-added'),
                  style: const TextStyle(fontSize: 12, color: AppColors.sage),
                ),
              ],
            ),
          ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              error!,
              key: const Key('delivery-photo-error'),
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
      ],
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
/// for someone who may see money, what it still owed then), "Delivered
/// without code" with the photo of the person collecting when the override
/// was used, with Undo for a manager.
class PackageDeliveredCard extends StatelessWidget {
  const PackageDeliveredCard({
    super.key,
    required this.line,
    required this.canSeeMoney,
    this.onUndo,
    this.undoing = false,
    this.deliveredWithoutCode = false,
    this.deliveredPhotoPath = '',
    this.photoUrl,
  });

  final ContainerLine line;
  final bool canSeeMoney;

  /// Null hides Undo (only a manager may undo).
  final VoidCallback? onUndo;
  final bool undoing;

  /// The override (docs/AIR_PACKAGES.md §4.7): `deliveredWithoutCode` and
  /// `deliveredPhotoPath` on the line, handed in by the caller that read
  /// them.
  final bool deliveredWithoutCode;
  final String deliveredPhotoPath;

  /// Turns the photo path into a URL; `PackagePhotoService.url` when null.
  final DeliveryPhotoUrl? photoUrl;

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
      if (deliveredWithoutCode)
        (
          Icons.pin_outlined,
          l10n.deliverWithoutCodePill,
          const Key('delivered-without-code'),
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
        if (deliveredPhotoPath.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          _DeliveredPhoto(
            path: deliveredPhotoPath,
            photoUrl: photoUrl ?? _photoUrl,
          ),
        ],
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

/// The override photo on a delivered package, loaded once per path.
class _DeliveredPhoto extends StatefulWidget {
  const _DeliveredPhoto({required this.path, required this.photoUrl});

  final String path;
  final DeliveryPhotoUrl photoUrl;

  @override
  State<_DeliveredPhoto> createState() => _DeliveredPhotoState();
}

class _DeliveredPhotoState extends State<_DeliveredPhoto> {
  late Future<String> _url = widget.photoUrl(widget.path);

  @override
  void didUpdateWidget(covariant _DeliveredPhoto old) {
    super.didUpdateWidget(old);
    if (old.path != widget.path) _url = widget.photoUrl(widget.path);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FutureBuilder<String>(
      future: _url,
      builder: (context, snap) {
        final url = snap.data ?? '';
        return Semantics(
          label: l10n.deliverPhotoOfCollector,
          image: true,
          child: ClipRRect(
            key: const Key('delivered-photo'),
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: Container(
              height: 160,
              color: AppColors.rule.withValues(alpha: 0.4),
              alignment: Alignment.center,
              child: url.isEmpty
                  ? Icon(
                      snap.hasError
                          ? Icons.broken_image_outlined
                          : Icons.photo_outlined,
                      size: 32,
                      color: AppColors.muted,
                    )
                  : Image.network(
                      url,
                      fit: BoxFit.cover,
                      width: double.infinity,
                      height: 160,
                      errorBuilder: (_, _, _) => const Icon(
                        Icons.broken_image_outlined,
                        size: 32,
                        color: AppColors.muted,
                      ),
                    ),
            ),
          ),
        );
      },
    );
  }
}
