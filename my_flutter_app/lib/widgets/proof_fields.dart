import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:image_picker/image_picker.dart';

import '../l10n/app_localizations.dart';
import '../services/package_photo_service.dart';
import '../services/package_proof.dart';
import '../services/package_requests.dart'
    show requestPhotoMaxWidth, requestPhotoQuality;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';

/// Proof on a package at drop-off (docs/AIR_PACKAGES.md §2): photos (up to
/// five, camera or gallery, uploaded as they are taken), what is inside
/// (item · quantity · optional serial), weight in pounds and declared value
/// in dollars. One editor, used by the container line form, the waiting
/// package form and the Received sheet; the draft it hands back goes
/// through `validateProofFields` and onto every line callable.
///
/// The camera, the upload and the download URLs are injectable, so the
/// editor is tested with fakes and without Firebase.

/// Picks one photo's bytes from [source], or null when the person backed out.
typedef ProofPhotoPicker = Future<Uint8List?> Function(ImageSource source);

/// Uploads one photo and answers its Storage path
/// (`PackagePhotoService.upload`). Throws [PackagePhotoFailure].
typedef ProofPhotoUploader = Future<String> Function(Uint8List bytes);

/// A download URL for a stored photo path (`PackagePhotoService.url`).
typedef ProofPhotoUrlResolver = Future<String> Function(String path);

/// The camera or the library through the picker's own compression (the
/// same as request photos: 1600 px, quality 70, well under 2 MB).
Future<Uint8List?> pickProofPhoto(ImageSource source) async {
  final picked = await ImagePicker().pickImage(
    source: source,
    maxWidth: requestPhotoMaxWidth,
    maxHeight: requestPhotoMaxWidth,
    imageQuality: requestPhotoQuality,
  );
  if (picked == null) return null;
  return picked.readAsBytes();
}

/// A refusal of the proof rules in the app's words, by code; null for a code
/// that is not one of theirs.
String? proofErrorText(AppLocalizations l10n, String code) => switch (code) {
      'photo_invalid' => l10n.proofErrPhotoInvalid,
      'photo_required' => l10n.proofErrPhotoRequired,
      'photo_too_large' => l10n.proofPhotoTooLarge,
      'contents_invalid' => l10n.proofErrContents,
      'weight_invalid' => l10n.proofErrWeight,
      'declared_value_invalid' => l10n.proofErrDeclaredValue,
      'pickup_code_invalid' => l10n.proofErrPickupCode,
      'override_incomplete' => l10n.proofErrOverride,
      'proof_settings_invalid' => l10n.proofErrSettings,
      'air_waybill_invalid' => l10n.airErrWaybill,
      _ => null,
    };

/// A photo on the editor: taken now (bytes, then a path once uploaded) or
/// already on the line (a path only, shown through its download URL).
class ProofPhotoDraft {
  ProofPhotoDraft.stored(this.path) : bytes = null;
  ProofPhotoDraft.taken(this.bytes) : path = '';

  final Uint8List? bytes;
  String path;
  bool get uploading => path.isEmpty;
}

/// One row of "what's inside".
class ProofItemRow {
  ProofItemRow({String label = '', int quantity = 1, String serial = ''})
      : label = TextEditingController(text: label),
        quantity = TextEditingController(text: quantity.toString()),
        serial = TextEditingController(text: serial);

  static int _next = 0;
  final int uid = _next++;
  final TextEditingController label;
  final TextEditingController quantity;
  final TextEditingController serial;

  /// As the validator reads it: the quantity text stays text, so a bad one
  /// is named ("contents_invalid") rather than silently made 1.
  Map<String, Object?> get draftMap => {
        'label': label.text,
        'quantity': quantity.text.trim().isEmpty ? 1 : quantity.text.trim(),
        'serial': serial.text,
      };

  void dispose() {
    label.dispose();
    quantity.dispose();
    serial.dispose();
  }
}

/// The editor's state: photos, items, weight and value, and the draft they
/// make. Owned by the sheet; the widget listens.
class ProofFieldsController extends ChangeNotifier {
  ProofFieldsController({
    required this.businessId,
    PackageProofDraft initial = PackageProofDraft.empty,
    ProofPhotoPicker? picker,
    ProofPhotoUploader? uploader,
    ProofPhotoUrlResolver? urlOf,
  })  : _picker = picker ?? pickProofPhoto,
        _uploader = uploader,
        _urlOf = urlOf,
        photos = [for (final p in initial.photoPaths) ProofPhotoDraft.stored(p)],
        items = [
          for (final c in initial.contents)
            ProofItemRow(label: c.label, quantity: c.quantity, serial: c.serial),
        ],
        weight = TextEditingController(
          text: initial.weightLb == null
              ? ''
              : weightText(normalizeWeightLb(initial.weightLb).value)
                  .replaceAll(' lb', ''),
        ),
        value = TextEditingController(
          text: declaredValueInput(
            normalizeDeclaredValueCents(initial.declaredValueCents).value,
          ),
        );

  final String businessId;
  final ProofPhotoPicker _picker;
  final ProofPhotoUploader? _uploader;
  final ProofPhotoUrlResolver? _urlOf;

  /// Download URLs for stored photos; Firebase Storage unless a test gave
  /// its own. Resolved lazily, so a form opens in a widget test without
  /// Firebase.
  ProofPhotoUrlResolver get urlOf => _urlOf ?? PackagePhotoService().url;

  final List<ProofPhotoDraft> photos;
  final List<ProofItemRow> items;
  final TextEditingController weight;
  final TextEditingController value;

  /// What went wrong with the last photo ('photo_invalid', 'photo_too_large',
  /// 'permission-denied', 'unavailable', 'unauthenticated'); '' when
  /// nothing did. Cleared by the next attempt.
  String photoError = '';

  bool get canAddPhoto => photos.length < proofMaxPhotos;
  bool get canAddItem => items.length < proofMaxContents;
  bool get uploading => photos.any((p) => p.uploading);

  /// The uploaded photo paths, in order (a photo still uploading is not a
  /// path yet).
  List<String> get photoPaths => [
        for (final p in photos)
          if (!p.uploading) p.path,
      ];

  /// The draft as the validator and the callables read it. Items without a
  /// name are dropped (as the server drops them); the weight and value stay
  /// text, so what cannot be read is refused by code.
  PackageProofDraft get draft {
    final contents = <PackageContent>[];
    final raw = [for (final r in items) r.draftMap];
    final checked = normalizeContents(raw);
    if (checked.error.isEmpty) {
      contents.addAll(checked.contents);
    }
    final cents = declaredValueCentsFromInput(value.text);
    return PackageProofDraft(
      photoPaths: photoPaths,
      // A bad list is handed over raw so validateProofFields names it.
      contents: checked.error.isEmpty ? contents : _rawContents(raw),
      weightLb: weight.text.trim().isEmpty ? null : weight.text.trim(),
      declaredValueCents: cents,
    );
  }

  /// A list that fails the rules, kept as typed (a 100-quantity or a long
  /// name) so the validator refuses it the same way the server will.
  List<PackageContent> _rawContents(List<Map<String, Object?>> raw) => [
        for (final m in raw)
          if ((m['label'] ?? '').toString().trim().isNotEmpty)
            PackageContent(
              label: (m['label'] ?? '').toString().trim(),
              quantity: int.tryParse(m['quantity'].toString()) ?? 0,
              serial: (m['serial'] ?? '').toString(),
            ),
      ];

  /// The item list fails its rules (a name too long, a quantity outside
  /// 1..99, more than ten).
  bool get contentsInvalid =>
      normalizeContents([for (final r in items) r.draftMap]).error.isNotEmpty;

  Future<String> _upload(Uint8List bytes) {
    final uploader = _uploader;
    if (uploader != null) return uploader(bytes);
    return PackagePhotoService().upload(businessId: businessId, bytes: bytes);
  }

  /// Takes or chooses a photo and uploads it. The thumbnail shows at once
  /// with a spinner; the path lands when the upload does. A refused or
  /// failed photo is taken off the strip and named in [photoError].
  Future<void> addPhoto(ImageSource source) async {
    if (!canAddPhoto) {
      photoError = 'photo_limit';
      notifyListeners();
      return;
    }
    photoError = '';
    notifyListeners();
    final Uint8List? bytes;
    try {
      bytes = await _picker(source);
    } catch (_) {
      photoError = 'unavailable';
      notifyListeners();
      return;
    }
    if (bytes == null) return;
    final problem = packagePhotoProblem(bytes);
    if (problem != null) {
      photoError = problem;
      notifyListeners();
      return;
    }
    final draft = ProofPhotoDraft.taken(bytes);
    photos.add(draft);
    notifyListeners();
    try {
      draft.path = await _upload(bytes);
    } on PackagePhotoFailure catch (failure) {
      photos.remove(draft);
      photoError = failure.code;
    } catch (_) {
      photos.remove(draft);
      photoError = 'unavailable';
    }
    notifyListeners();
  }

  void removePhoto(int index) {
    if (index < 0 || index >= photos.length) return;
    photos.removeAt(index);
    photoError = '';
    notifyListeners();
  }

  void addItem() {
    if (!canAddItem) return;
    items.add(ProofItemRow());
    notifyListeners();
  }

  void removeItem(int index) {
    if (index < 0 || index >= items.length) return;
    items.removeAt(index).dispose();
    notifyListeners();
  }

  /// Back to empty, for "save and another".
  void reset() {
    photos.clear();
    for (final r in items) {
      r.dispose();
    }
    items.clear();
    weight.clear();
    value.clear();
    photoError = '';
    notifyListeners();
  }

  @override
  void dispose() {
    for (final r in items) {
      r.dispose();
    }
    weight.dispose();
    value.dispose();
    super.dispose();
  }
}

/// The editor. [photosRequired] says so above the photos (the business's
/// switch, counter drop-offs only); the refusal itself comes back from the
/// validator as [photoError] / [contentsError] / [weightError] /
/// [valueError], in words.
class ProofFields extends StatelessWidget {
  const ProofFields({
    super.key,
    required this.controller,
    this.photosRequired = false,
    this.enabled = true,
    this.onEdited,
    this.photoError,
    this.contentsError,
    this.weightError,
    this.valueError,
  });

  final ProofFieldsController controller;
  final bool photosRequired;
  final bool enabled;

  /// A field was typed in: the sheet clears the refusals that belonged to it.
  final VoidCallback? onEdited;
  final String? photoError;
  final String? contentsError;
  final String? weightError;
  final String? valueError;

  static final _decimal = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));
  static final _digits = FilteringTextInputFormatter.digitsOnly;

  String? _photoProblemText(AppLocalizations l10n, String code) =>
      switch (code) {
        '' => null,
        'photo_limit' => l10n.proofPhotoLimit(proofMaxPhotos),
        'photo_too_large' => l10n.proofPhotoTooLarge,
        'photo_invalid' => l10n.proofPhotoNotImage,
        'permission-denied' => l10n.proofPhotoNoPermission,
        _ => l10n.proofPhotoFailed,
      };

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final photoProblem =
            photoError ?? _photoProblemText(l10n, controller.photoError);
        return Column(
          key: const Key('proof-fields'),
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _Title(
              text: l10n.proofPhotosOfMax(
                controller.photos.length,
                proofMaxPhotos,
              ),
              key: const Key('proof-photos-title'),
            ),
            const SizedBox(height: 4),
            Text(
              photosRequired
                  ? l10n.proofPhotoRequiredNote
                  : l10n.proofPhotoOptionalNote(proofMaxPhotos),
              key: Key(photosRequired
                  ? 'proof-photos-required'
                  : 'proof-photos-optional'),
              style: TextStyle(
                fontSize: 12,
                height: 1.35,
                fontWeight: photosRequired ? FontWeight.w600 : FontWeight.w400,
                color: photosRequired ? AppColors.warn : AppColors.muted,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Expanded(
                  child: _PhotoButton(
                    key: const Key('proof-photo-camera'),
                    icon: Icons.photo_camera_outlined,
                    label: l10n.proofTakePhoto,
                    enabled: enabled && controller.canAddPhoto,
                    onTap: () {
                      AppHaptics.selection();
                      onEdited?.call();
                      unawaited(controller.addPhoto(ImageSource.camera));
                    },
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: _PhotoButton(
                    key: const Key('proof-photo-gallery'),
                    icon: Icons.photo_library_outlined,
                    label: l10n.proofChoosePhoto,
                    enabled: enabled && controller.canAddPhoto,
                    onTap: () {
                      AppHaptics.selection();
                      onEdited?.call();
                      unawaited(controller.addPhoto(ImageSource.gallery));
                    },
                  ),
                ),
              ],
            ),
            if (controller.photos.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  for (var i = 0; i < controller.photos.length; i++)
                    _PhotoThumb(
                      key: ValueKey('proof-photo:$i'),
                      photo: controller.photos[i],
                      urlOf: controller.urlOf,
                      onRemove: enabled
                          ? () {
                              AppHaptics.selection();
                              onEdited?.call();
                              controller.removePhoto(i);
                            }
                          : null,
                    ),
                ],
              ),
            ],
            if (photoProblem != null) ...[
              const SizedBox(height: 6),
              _ErrorText(photoProblem, key: const Key('proof-photo-error')),
            ],
            const SizedBox(height: AppSpacing.lg),
            _Title(
              text: l10n.proofContentsTitle,
              key: const Key('proof-contents-title'),
            ),
            const SizedBox(height: 4),
            Text(
              l10n.proofContentsNote,
              style: const TextStyle(
                fontSize: 12,
                height: 1.35,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            for (var i = 0; i < controller.items.length; i++)
              _ItemRow(
                key: ValueKey('proof-item:${controller.items[i].uid}'),
                index: i,
                row: controller.items[i],
                enabled: enabled,
                onEdited: onEdited,
                onRemove: () {
                  AppHaptics.selection();
                  onEdited?.call();
                  controller.removeItem(i);
                },
              ),
            _AddItemButton(
              enabled: enabled && controller.canAddItem,
              onTap: () {
                AppHaptics.selection();
                controller.addItem();
              },
            ),
            if (contentsError != null) ...[
              const SizedBox(height: 6),
              _ErrorText(contentsError!, key: const Key('proof-contents-error')),
            ],
            const SizedBox(height: AppSpacing.lg),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('proof-weight'),
                    controller: controller.weight,
                    enabled: enabled,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [_decimal],
                    onChanged: (_) => onEdited?.call(),
                    decoration: InputDecoration(
                      labelText: l10n.proofWeight,
                      suffixText: 'lb',
                      errorText: weightError,
                      errorMaxLines: 3,
                    ),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: TextField(
                    key: const Key('proof-declared-value'),
                    controller: controller.value,
                    enabled: enabled,
                    keyboardType:
                        const TextInputType.numberWithOptions(decimal: true),
                    inputFormatters: [_decimal],
                    onChanged: (_) => onEdited?.call(),
                    decoration: InputDecoration(
                      labelText: l10n.proofDeclaredValue,
                      prefixText: r'$ ',
                      helperText: l10n.proofDeclaredValueNote,
                      helperMaxLines: 2,
                      errorText: valueError,
                      errorMaxLines: 3,
                    ),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }

  /// Digits only, for the quantity field.
  static List<TextInputFormatter> get quantityFormatters => [_digits];
}

class _Title extends StatelessWidget {
  const _Title({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: AppColors.ink,
        ),
      );
}

class _ErrorText extends StatelessWidget {
  const _ErrorText(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Text(
        text,
        style: const TextStyle(
          fontSize: 12,
          height: 1.35,
          fontWeight: FontWeight.w600,
          color: AppColors.errorRed,
        ),
      );
}

class _PhotoButton extends StatelessWidget {
  const _PhotoButton({
    super.key,
    required this.icon,
    required this.label,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = enabled ? AppColors.cobaltDeep : AppColors.muted;
    return Semantics(
      button: true,
      enabled: enabled,
      child: PressableScale(
        scale: 0.98,
        onTap: enabled ? onTap : null,
        child: Container(
          height: 44,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(
              color: enabled ? AppColors.cobalt : AppColors.rule,
              width: 1.5,
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 18, color: color),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                    color: color,
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

class _PhotoThumb extends StatelessWidget {
  const _PhotoThumb({
    super.key,
    required this.photo,
    required this.urlOf,
    this.onRemove,
  });

  final ProofPhotoDraft photo;
  final ProofPhotoUrlResolver urlOf;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      width: 76,
      height: 76,
      child: Stack(
        fit: StackFit.expand,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            child: photo.bytes != null
                ? Image.memory(photo.bytes!, fit: BoxFit.cover)
                : PackagePhotoImage(path: photo.path, urlOf: urlOf),
          ),
          if (photo.uploading)
            Container(
              key: const Key('proof-photo-uploading'),
              color: Colors.black.withValues(alpha: 0.35),
              alignment: Alignment.center,
              child: const SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: Colors.white,
                ),
              ),
            ),
          if (onRemove != null)
            Positioned(
              top: 2,
              right: 2,
              child: Semantics(
                button: true,
                label: l10n.proofRemovePhoto,
                child: GestureDetector(
                  key: const Key('proof-photo-remove'),
                  onTap: onRemove,
                  child: Container(
                    width: 24,
                    height: 24,
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.55),
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(Icons.close, size: 15, color: Colors.white),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A stored package photo by path, through its download URL; a grey frame
/// while the URL loads and a broken-image mark when it cannot be shown.
class PackagePhotoImage extends StatelessWidget {
  const PackagePhotoImage({
    super.key,
    required this.path,
    required this.urlOf,
    this.fit = BoxFit.cover,
  });

  final String path;
  final ProofPhotoUrlResolver urlOf;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<String>(
      future: urlOf(path),
      builder: (context, snap) {
        final url = snap.data ?? '';
        if (snap.hasError || (snap.hasData && url.isEmpty)) {
          return const _BrokenPhoto();
        }
        if (url.isEmpty) {
          return Container(color: AppColors.mist);
        }
        return Image.network(
          url,
          fit: fit,
          errorBuilder: (_, _, _) => const _BrokenPhoto(),
          loadingBuilder: (context, child, progress) => progress == null
              ? child
              : Container(
                  color: AppColors.mist,
                  alignment: Alignment.center,
                  child: const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
        );
      },
    );
  }
}

class _BrokenPhoto extends StatelessWidget {
  const _BrokenPhoto();

  @override
  Widget build(BuildContext context) => Container(
        key: const Key('proof-photo-broken'),
        color: AppColors.mist,
        alignment: Alignment.center,
        child: const Icon(Icons.broken_image_outlined,
            size: 22, color: AppColors.muted),
      );
}

/// Stored photos, read-only (the package page): thumbnails that open
/// full-size on tap.
class PackagePhotoStrip extends StatelessWidget {
  const PackagePhotoStrip({
    super.key,
    required this.paths,
    this.urlOf,
    this.size = 76,
  });

  final List<String> paths;
  final ProofPhotoUrlResolver? urlOf;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (paths.isEmpty) return const SizedBox.shrink();
    final resolve = urlOf ?? PackagePhotoService().url;
    return Wrap(
      key: const Key('proof-photo-strip'),
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (var i = 0; i < paths.length; i++)
          GestureDetector(
            key: ValueKey('proof-photo-open:$i'),
            onTap: () => _open(context, paths[i], resolve),
            child: SizedBox(
              width: size,
              height: size,
              child: ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                child: PackagePhotoImage(path: paths[i], urlOf: resolve),
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _open(
    BuildContext context,
    String path,
    ProofPhotoUrlResolver resolve,
  ) async {
    await showDialog<void>(
      context: context,
      builder: (context) => Dialog(
        insetPadding: const EdgeInsets.all(AppSpacing.md),
        backgroundColor: Colors.black,
        child: GestureDetector(
          onTap: () => Navigator.of(context).pop(),
          child: InteractiveViewer(
            child: AspectRatio(
              aspectRatio: 3 / 4,
              child: PackagePhotoImage(
                path: path,
                urlOf: resolve,
                fit: BoxFit.contain,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    super.key,
    required this.index,
    required this.row,
    required this.enabled,
    required this.onRemove,
    this.onEdited,
  });

  final int index;
  final ProofItemRow row;
  final bool enabled;
  final VoidCallback onRemove;
  final VoidCallback? onEdited;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  key: Key('proof-item-label:$index'),
                  controller: row.label,
                  enabled: enabled,
                  textCapitalization: TextCapitalization.sentences,
                  maxLength: proofMaxContentLabel,
                  onChanged: (_) => onEdited?.call(),
                  decoration: InputDecoration(
                    labelText: l10n.proofItemLabel,
                    isDense: true,
                    counterText: '',
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              SizedBox(
                width: 64,
                child: TextField(
                  key: Key('proof-item-quantity:$index'),
                  controller: row.quantity,
                  enabled: enabled,
                  keyboardType: TextInputType.number,
                  inputFormatters: ProofFields.quantityFormatters,
                  maxLength: 2,
                  textAlign: TextAlign.center,
                  onChanged: (_) => onEdited?.call(),
                  decoration: InputDecoration(
                    labelText: l10n.proofItemQuantity,
                    isDense: true,
                    counterText: '',
                  ),
                ),
              ),
              IconButton(
                key: Key('proof-item-remove:$index'),
                onPressed: enabled ? onRemove : null,
                icon: const Icon(Icons.close, size: 18),
                color: AppColors.muted,
                tooltip: l10n.proofRemoveItem,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 40),
            child: TextField(
              key: Key('proof-item-serial:$index'),
              controller: row.serial,
              enabled: enabled,
              textCapitalization: TextCapitalization.characters,
              maxLength: proofMaxSerial,
              onChanged: (_) => onEdited?.call(),
              decoration: InputDecoration(
                labelText: l10n.proofItemSerial,
                isDense: true,
                counterText: '',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _AddItemButton extends StatelessWidget {
  const _AddItemButton({required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final color = enabled ? AppColors.cobaltDeep : AppColors.muted;
    return Align(
      alignment: Alignment.centerLeft,
      child: TextButton.icon(
        key: const Key('proof-item-add'),
        onPressed: enabled ? onTap : null,
        style: TextButton.styleFrom(
          padding: const EdgeInsets.symmetric(horizontal: 4),
          minimumSize: const Size(0, 36),
          foregroundColor: color,
        ),
        icon: const Icon(Icons.add, size: 18),
        label: Text(
          l10n.proofAddItem,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
        ),
      ),
    );
  }
}
