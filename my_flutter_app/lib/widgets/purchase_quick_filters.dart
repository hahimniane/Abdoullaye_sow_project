import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/purchase_filters.dart';

/// A search box and the "Needs action" / "Paid holds" quick filters for the
/// purchases and viewings list. [showPaidHolds] is false on the viewings
/// queue, where a paid hold can never match. A count on a chip is passed only
/// when it is the whole list's, never a page's.
class PurchaseQuickFilterBar extends StatelessWidget {
  const PurchaseQuickFilterBar({
    super.key,
    required this.query,
    required this.quick,
    required this.showPaidHolds,
    required this.onQueryChanged,
    required this.onQuickChanged,
    this.needsActionCount,
  });

  final String query;
  final PurchaseQuickFilter quick;
  final bool showPaidHolds;
  final int? needsActionCount;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<PurchaseQuickFilter> onQuickChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final needs = needsActionCount == null || needsActionCount == 0
        ? l10n.extQuickNeedsAction
        : '${l10n.extQuickNeedsAction} ($needsActionCount)';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            key: const Key('purchase-search'),
            initialValue: query,
            onChanged: onQueryChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: l10n.extPurchaseSearchHint,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            children: [
              FilterChip(
                key: const Key('purchase-quick:needsAction'),
                label: Text(needs),
                selected: quick == PurchaseQuickFilter.needsAction,
                onSelected: (on) => onQuickChanged(
                  on
                      ? PurchaseQuickFilter.needsAction
                      : PurchaseQuickFilter.all,
                ),
              ),
              if (showPaidHolds)
                FilterChip(
                  key: const Key('purchase-quick:paidHolds'),
                  label: Text(l10n.extQuickPaidHolds),
                  selected: quick == PurchaseQuickFilter.paidHolds,
                  onSelected: (on) => onQuickChanged(
                    on
                        ? PurchaseQuickFilter.paidHolds
                        : PurchaseQuickFilter.all,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
