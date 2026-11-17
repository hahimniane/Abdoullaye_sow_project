import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/listing_filters.dart';
import '../theme/app_colors.dart';

/// The words for a listing's status, in the app's language.
String listingStatusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'draft':
      return l10n.extStatusDraft;
    case 'active':
      return l10n.active;
    case 'inactive':
      return l10n.inactive;
    case 'sold':
      return l10n.sold;
    case 'reserved':
      return l10n.reserved;
    default:
      return status;
  }
}

/// A search box and a status filter over the listings. Holds no list: the
/// screen filters once per change and passes what was typed and picked.
class ListingFilterBar extends StatelessWidget {
  const ListingFilterBar({
    super.key,
    required this.query,
    required this.status,
    required this.onQueryChanged,
    required this.onStatusChanged,
  });

  final String query;
  final String status;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<String> onStatusChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            key: const Key('listing-search'),
            initialValue: query,
            onChanged: onQueryChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: l10n.extCarSearchHint,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: const Key('listing-status-filter'),
            initialValue: status,
            isExpanded: true,
            decoration: InputDecoration(
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            items: [
              DropdownMenuItem(value: 'all', child: Text(l10n.extStatusAll)),
              for (final s in listingStatuses)
                DropdownMenuItem(
                  value: s,
                  child: Text(listingStatusLabel(l10n, s)),
                ),
            ],
            onChanged: (value) {
              if (value != null) onStatusChanged(value);
            },
          ),
        ],
      ),
    );
  }
}

/// "N selected - change status to ... - Apply", shown while listings are
/// ticked.
class ListingBulkBar extends StatelessWidget {
  const ListingBulkBar({
    super.key,
    required this.count,
    required this.status,
    required this.busy,
    required this.onStatusChanged,
    required this.onApply,
    required this.onClear,
  });

  final int count;
  final String status;
  final bool busy;
  final ValueChanged<String> onStatusChanged;
  final VoidCallback onApply;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('listing-bulk-bar'),
      margin: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.extBulkSelected(count),
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ),
              TextButton(
                key: const Key('listing-bulk-clear'),
                onPressed: busy ? null : onClear,
                child: Text(l10n.extBulkClear),
              ),
            ],
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            key: const Key('listing-bulk-status'),
            initialValue: status,
            isExpanded: true,
            decoration: InputDecoration(
              labelText: l10n.extBulkSetStatus,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            items: [
              for (final s in listingStatuses)
                DropdownMenuItem(
                  value: s,
                  child: Text(listingStatusLabel(l10n, s)),
                ),
            ],
            onChanged: busy
                ? null
                : (value) {
                    if (value != null) onStatusChanged(value);
                  },
          ),
          const SizedBox(height: 8),
          FilledButton(
            key: const Key('listing-bulk-apply'),
            onPressed: busy ? null : onApply,
            child: busy
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.extBulkApply),
          ),
        ],
      ),
    );
  }
}

/// A box for a photo's web address and an Add button. [onAdd] is called with
/// a link that passed [checkListingImageLink]; a refused link is explained
/// under the box in words.
class ImageLinkField extends StatefulWidget {
  const ImageLinkField({
    super.key,
    required this.count,
    required this.max,
    required this.onAdd,
  });

  /// Photos the listing already has, and the most it may hold.
  final int count;
  final int max;
  final ValueChanged<String> onAdd;

  @override
  State<ImageLinkField> createState() => _ImageLinkFieldState();
}

class _ImageLinkFieldState extends State<ImageLinkField> {
  final _controller = TextEditingController();
  ListingImageLinkProblem? _problem;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _add() {
    final problem = checkListingImageLink(
      _controller.text,
      count: widget.count,
      max: widget.max,
    );
    if (problem != null) {
      setState(() => _problem = problem);
      return;
    }
    widget.onAdd(_controller.text.trim());
    setState(() {
      _problem = null;
      _controller.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final full = widget.count >= widget.max;
    final problem = full ? ListingImageLinkProblem.full : _problem;
    final error = switch (problem) {
      ListingImageLinkProblem.full => l10n.extImageLinkFull(widget.max),
      ListingImageLinkProblem.notHttps ||
      ListingImageLinkProblem.empty => l10n.extImageLinkInvalid,
      null => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.extImageLinkTitle,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        const SizedBox(height: 8),
        TextField(
          key: const Key('image-link-input'),
          controller: _controller,
          enabled: !full,
          keyboardType: TextInputType.url,
          autocorrect: false,
          onSubmitted: (_) => _add(),
          decoration: InputDecoration(
            hintText: l10n.extImageLinkHint,
            errorText: error,
            errorMaxLines: 3,
            isDense: true,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
          ),
        ),
        const SizedBox(height: 8),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: OutlinedButton.icon(
            key: const Key('image-link-add'),
            onPressed: full ? null : _add,
            icon: const Icon(Icons.link),
            label: Text(l10n.extImageLinkAdd),
          ),
        ),
      ],
    );
  }
}
