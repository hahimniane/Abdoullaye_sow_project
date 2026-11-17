import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../utils/business_transport_localization.dart';

/// A search box and a status filter over the accepted transport jobs.
/// [statuses] are the ones jobs are actually in.
class TransportJobFilterBar extends StatelessWidget {
  const TransportJobFilterBar({
    super.key,
    required this.query,
    required this.status,
    required this.statuses,
    required this.onQueryChanged,
    required this.onStatusChanged,
  });

  final String query;
  final String status;
  final List<String> statuses;
  final ValueChanged<String> onQueryChanged;
  final ValueChanged<String> onStatusChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // A chosen status no job is in any more stays selectable.
    final options = <String>[
      ...statuses,
      if (status != 'all' && !statuses.contains(status)) status,
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextFormField(
            key: const Key('transport-job-search'),
            initialValue: query,
            onChanged: onQueryChanged,
            textInputAction: TextInputAction.search,
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: l10n.extTransportSearchHint,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          if (options.isNotEmpty) ...[
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              key: const Key('transport-job-status-filter'),
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
                for (final s in options)
                  DropdownMenuItem(
                    value: s,
                    child: Text(
                      transportFulfillmentStatusLabel(l10n, s),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (value) {
                if (value != null) onStatusChanged(value);
              },
            ),
          ],
        ],
      ),
    );
  }
}
