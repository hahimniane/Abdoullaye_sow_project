import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory_credit.dart';
import '../services/lot_ledger.dart' show LotStaff;
import '../utils/date_display.dart';
import '../theme/app_spacing.dart';
import 'country_phone_field.dart';
import 'day_picker.dart';
import 'lot_sheets.dart';

/// The credit terms of a sale - what is paid now, who owes the rest (name,
/// optional phone), who collects it and by when - as the Sell screen's
/// checkout asks them. Shared with "Switch to credit" on a recorded sale, so
/// both ask the same questions with the same pickers and the same errors.
///
/// The parent owns the draft and the text controllers; every change comes
/// back through [onEdit] as an edit of the current draft.
class InventoryCreditTermsFields extends StatelessWidget {
  const InventoryCreditTermsFields({
    super.key,
    required this.draft,
    required this.paidNow,
    required this.customerName,
    required this.customerPhone,
    required this.paidNowLabel,
    required this.busy,
    required this.errorFor,
    required this.collectorLabel,
    required this.onEdit,
    required this.onPickCollector,
    required this.onPickDueDate,
    this.underPaidNow,
  });

  final InventoryCheckoutDraft draft;
  final TextEditingController paidNow;
  final TextEditingController customerName;
  final TextEditingController customerPhone;

  /// "Paid now" at the counter; "How much did they pay at the time?" when a
  /// recorded sale is switched.
  final String paidNowLabel;
  final bool busy;

  /// The words of the first of these codes that is wrong, or null.
  final String? Function(List<String> codes) errorFor;

  /// The collector as shown ("Ama (me)"), or null when none is chosen.
  final String? collectorLabel;
  final void Function(
    InventoryCheckoutDraft Function(InventoryCheckoutDraft) edit,
  )
  onEdit;
  final VoidCallback onPickCollector;
  final VoidCallback onPickDueDate;

  /// Shown under the amount paid now (the Sell screen asks who received it).
  final Widget? underPaidNow;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final due = parseDayKey(draft.dueDate);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        TextField(
          key: const Key('inv-credit-paid-now'),
          controller: paidNow,
          enabled: !busy,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (v) => onEdit((d) => d.copyWith(paidNow: v)),
          decoration: InputDecoration(
            labelText: paidNowLabel,
            hintText: '0.00',
            prefixText: r'$ ',
            errorText: errorFor(['paid_now_invalid', 'paid_now_too_large']),
            errorMaxLines: 3,
          ),
        ),
        if (underPaidNow != null) ...[
          const SizedBox(height: AppSpacing.md),
          underPaidNow!,
        ],
        const SizedBox(height: AppSpacing.md),
        TextField(
          key: const Key('inv-credit-name'),
          controller: customerName,
          enabled: !busy,
          textCapitalization: TextCapitalization.words,
          onChanged: (v) => onEdit((d) => d.copyWith(customerName: v)),
          decoration: InputDecoration(
            labelText: l10n.invCreditCustomerName,
            errorText: errorFor(['customer_name_required']),
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        CountryPhoneField(
          fieldKey: const Key('inv-credit-phone'),
          controller: customerPhone,
          labelText: l10n.invCreditCustomerPhone,
          enabled: !busy,
          errorText: errorFor([
            'customer_phone_required',
            'customer_phone_invalid',
          ]),
          onChanged: (v) => onEdit((d) => d.copyWith(customerPhone: v)),
        ),
        const SizedBox(height: AppSpacing.md),
        LotPickerField(
          key: const Key('inv-credit-collector'),
          label: l10n.invCreditCollector,
          value: collectorLabel,
          placeholder: l10n.invCreditCollectorPick,
          onTap: busy ? () {} : onPickCollector,
          error: errorFor(['collector_required', 'collector_invalid']),
        ),
        const SizedBox(height: AppSpacing.md),
        Row(
          children: [
            Expanded(
              child: LotPickerField(
                key: const Key('inv-credit-due'),
                label: l10n.invCreditDueDate,
                value: due == null ? null : displayDate(due, locale),
                placeholder: l10n.invCreditNoDueDate,
                onTap: busy ? () {} : onPickDueDate,
                error: errorFor(['due_date_invalid']),
              ),
            ),
            if (due != null)
              IconButton(
                key: const Key('inv-credit-due-clear'),
                tooltip: l10n.invCreditClearDueDate,
                onPressed: busy
                    ? null
                    : () => onEdit((d) => d.copyWith(dueDate: '')),
                icon: const Icon(Icons.close, size: 20),
              ),
          ],
        ),
      ],
    );
  }
}

/// "Ama (me)" for the signed-in person, else their name.
String inventoryPersonOptionLabel(
  AppLocalizations l10n,
  String id,
  String name,
  String me,
) => id == me ? l10n.invCreditMe(name) : name;

/// Picks one of the business's people (the collector, who received the
/// money); null when dismissed.
Future<String?> pickInventoryPerson(
  BuildContext context, {
  required String title,
  required List<LotStaff> people,
  required String me,
  String? selected,
}) {
  final l10n = AppLocalizations.of(context)!;
  return pickLotOption<String>(
    context,
    title: title,
    selected: selected,
    options: [
      for (final p in people)
        LotOption(p.id, inventoryPersonOptionLabel(l10n, p.id, p.name, me)),
    ],
  );
}

/// Picks a due date from [today] on (two years ahead at most), starting on
/// [current] or a week from today; the day key, or null when dismissed.
Future<String?> pickInventoryDueDay(
  BuildContext context, {
  required DateTime today,
  String current = '',
}) async {
  final picked = await pickCalendarDay(
    context,
    initial: parseDayKey(current) ?? today.add(const Duration(days: 7)),
    first: today,
    last: today.add(const Duration(days: 730)),
  );
  return picked == null ? null : inventoryDayKey(picked);
}
