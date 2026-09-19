/// The sheet and list primitives the yard-side screens share: the lot
/// ledger and the container manifest open the same sheets, pick from the
/// same option lists, and read the same change history. One pattern, so a
/// picker feels the same whichever screen it is on.
library;

import 'dart:ui' show ImageFilter;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart' hide TextDirection;

import '../l10n/app_localizations.dart';
import '../services/lot_ledger.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';

/// How a figure or a button reads: neutral, good news, or a warning.
enum LotTone { neutral, good, warn }

// ---------------------------------------------------------------------------
// Shared pieces.
// ---------------------------------------------------------------------------

/// The one action a panel exists for, parked where the thumb is, on a
/// translucent layer the list scrolls under rather than an opaque strip that
/// eats the bottom of the screen.
class LotPrimaryBar extends StatelessWidget {
  const LotPrimaryBar({super.key, required this.label, required this.icon, required this.onTap});

  final String label;
  final IconData icon;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ClipRect(
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.paper.withValues(alpha: 0.78),
            border: Border(
              top: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
            ),
          ),
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.md),
          child: SafeArea(
            top: false,
            child: PressableScale(
              onTap: onTap,
              child: Container(
                height: 50,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.cobalt,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(icon, size: 18, color: Colors.white),
                    const SizedBox(width: AppSpacing.sm),
                    Text(
                      label,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.1,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class LotEmptyState extends StatelessWidget {
  const LotEmptyState({super.key, required this.icon, required this.title, this.hint});

  final IconData icon;
  final String title;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xl, vertical: 48),
      child: Column(
        children: [
          Icon(icon, size: 30, color: AppColors.muted.withValues(alpha: 0.55)),
          const SizedBox(height: AppSpacing.md),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          if (hint != null) ...[
            const SizedBox(height: 6),
            Text(
              hint!,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}


/// Sheets arrive from the bottom and leave the same way, over a scrim that
/// dims what they interrupt.
Future<T?> showLotSheet<T>(BuildContext context, Widget child) {
  return showModalBottomSheet<T>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    backgroundColor: AppColors.paper,
    barrierColor: AppColors.ink.withValues(alpha: 0.32),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
    ),
    builder: (sheetContext) => Padding(
      padding:
          EdgeInsets.only(bottom: MediaQuery.of(sheetContext).viewInsets.bottom),
      child: child,
    ),
  );
}

class LotSheetShell extends StatelessWidget {
  const LotSheetShell({
    super.key,
    required this.title,
    this.subtitle,
    required this.body,
    this.footer,
  });

  final String title;
  final String? subtitle;
  final Widget body;
  final Widget? footer;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: BoxConstraints(
        maxHeight: MediaQuery.sizeOf(context).height * 0.9,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.md),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 19,
                    fontWeight: FontWeight.w700,
                    height: 1.15,
                    letterSpacing: -0.4,
                    color: AppColors.ink,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    subtitle!,
                    style: const TextStyle(
                      fontSize: 13,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ],
            ),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, 0, AppSpacing.lg, AppSpacing.lg),
              child: body,
            ),
          ),
          if (footer != null)
            Container(
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.lg),
              decoration: BoxDecoration(
                color: AppColors.paper,
                border: Border(
                  top: BorderSide(color: AppColors.rule.withValues(alpha: 0.7)),
                ),
              ),
              child: SafeArea(top: false, child: footer!),
            ),
        ],
      ),
    );
  }
}

class LotSheetButton extends StatelessWidget {
  const LotSheetButton({
    super.key,
    required this.label,
    required this.onTap,
    this.busy = false,
    this.busyLabel,
    this.tone = LotTone.neutral,
  });

  final String label;
  final VoidCallback? onTap;
  final bool busy;
  final String? busyLabel;
  final LotTone tone;

  @override
  Widget build(BuildContext context) {
    final background = switch (tone) {
      LotTone.warn => AppColors.errorRed,
      LotTone.good => AppColors.cobalt,
      LotTone.neutral => AppColors.cobalt,
    };
    return PressableScale(
      onTap: busy ? null : onTap,
      child: Container(
        height: 50,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: busy ? background.withValues(alpha: 0.5) : background,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              busy ? (busyLabel ?? label) : label,
              style: const TextStyle(
                color: Colors.white,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A field that opens a list instead of dropping a menu over the content.
/// The list is a sheet like every other choice in the app, so one pattern
/// covers picking an activity, a payment method, and a staff member.
class LotPickerField extends StatelessWidget {
  const LotPickerField({
    super.key,
    required this.label,
    required this.value,
    required this.placeholder,
    required this.onTap,
    this.error,
  });

  final String label;
  final String? value;
  final String placeholder;
  final VoidCallback onTap;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final filled = value != null && value!.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        PressableScale(
          onTap: onTap,
          scale: 0.99,
          child: Container(
            padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg, vertical: AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.parchment,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              border: Border.all(
                color: error != null ? AppColors.errorRed : AppColors.rule,
              ),
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          letterSpacing: 0.2,
                          color: AppColors.muted,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        filled ? value! : placeholder,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: filled ? FontWeight.w600 : FontWeight.w400,
                          color: filled ? AppColors.ink : AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.unfold_more,
                    size: 18, color: AppColors.muted),
              ],
            ),
          ),
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(left: 4, top: 5),
            child: Text(
              error!,
              style: const TextStyle(fontSize: 12, color: AppColors.errorRed),
            ),
          ),
      ],
    );
  }
}

class LotOption<T> {
  const LotOption(this.value, this.label, {this.detail});

  final T value;
  final String label;
  final String? detail;
}

/// A titled run of options in [pickLotSearchableOption].
class LotOptionSection<T> {
  const LotOptionSection(this.title, this.options);

  final String title;
  final List<LotOption<T>> options;
}

/// [pickLotOption] for lists too long to scroll - every country, say. A
/// search box at the top narrows every section at once, matching the label
/// or the detail; sections keep their order so the caller's "yours first"
/// still reads as such.
Future<T?> pickLotSearchableOption<T>(
  BuildContext context, {
  required String title,
  required List<LotOptionSection<T>> sections,
  required String searchHint,
  T? selected,
}) {
  var query = '';
  return showLotSheet<T>(
    context,
    StatefulBuilder(
      builder: (context, setSheetState) {
        final q = query.trim().toLowerCase();
        bool matches(LotOption<T> o) =>
            q.isEmpty ||
            o.label.toLowerCase().contains(q) ||
            (o.detail ?? '').toLowerCase().contains(q);
        return LotSheetShell(
          title: title,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                key: const Key('lot-option-search'),
                autofocus: false,
                onChanged: (v) => setSheetState(() => query = v),
                decoration: InputDecoration(
                  hintText: searchHint,
                  prefixIcon: const Icon(Icons.search_rounded),
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              for (final section in sections)
                if (section.options.any(matches)) ...[
                  Padding(
                    padding: const EdgeInsets.only(
                        top: AppSpacing.sm, bottom: AppSpacing.sm),
                    child: Text(
                      section.title,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.4,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                  for (final option in section.options.where(matches))
                    PressableScale(
                      onTap: () => Navigator.of(context).pop(option.value),
                      child: Container(
                        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                        padding: const EdgeInsets.symmetric(
                            horizontal: AppSpacing.lg,
                            vertical: AppSpacing.md),
                        decoration: BoxDecoration(
                          color: option.value == selected
                              ? AppColors.mist
                              : AppColors.parchment,
                          borderRadius:
                              BorderRadius.circular(AppSpacing.radiusSm),
                          border: Border.all(
                            color: option.value == selected
                                ? AppColors.cobalt.withValues(alpha: 0.4)
                                : AppColors.ink.withValues(alpha: 0.06),
                          ),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                option.label,
                                style: const TextStyle(
                                  fontSize: 15,
                                  fontWeight: FontWeight.w600,
                                  color: AppColors.ink,
                                ),
                              ),
                            ),
                            if (option.detail != null)
                              Text(
                                option.detail!,
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: AppColors.muted,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                ],
            ],
          ),
        );
      },
    ),
  );
}

Future<T?> pickLotOption<T>(
  BuildContext context, {
  required String title,
  required List<LotOption<T>> options,
  T? selected,
}) {
  return showLotSheet<T>(
    context,
    LotSheetShell(
      title: title,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          for (final option in options)
            PressableScale(
              onTap: () => Navigator.of(context).pop(option.value),
              child: Container(
                margin: const EdgeInsets.only(bottom: AppSpacing.sm),
                padding: const EdgeInsets.symmetric(
                    horizontal: AppSpacing.lg, vertical: AppSpacing.md),
                decoration: BoxDecoration(
                  color: option.value == selected
                      ? AppColors.mist
                      : AppColors.parchment,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  border: Border.all(
                    color: option.value == selected
                        ? AppColors.cobalt
                        : AppColors.rule,
                  ),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            option.label,
                            style: const TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                              color: AppColors.ink,
                            ),
                          ),
                          if (option.detail != null)
                            Text(
                              option.detail!,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.muted,
                              ),
                            ),
                        ],
                      ),
                    ),
                    if (option.value == selected)
                      const Icon(Icons.check, size: 18, color: AppColors.cobalt),
                  ],
                ),
              ),
            ),
        ],
      ),
    ),
  );
}

/// A choice with two long explanations reads better as two cards than as two
/// radio dots: the whole card is the target, and the reasoning sits with it.
class LotChoiceCard extends StatelessWidget {
  const LotChoiceCard({
    super.key,
    required this.title,
    required this.note,
    required this.selected,
    required this.onTap,
    this.enabled = true,
  });

  final String title;
  final String note;
  final bool selected;
  final VoidCallback onTap;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: enabled ? onTap : null,
      scale: 0.99,
      child: AnimatedContainer(
        duration: AppMotion.press,
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: selected ? AppColors.mist : AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              selected ? Icons.radio_button_checked : Icons.radio_button_off,
              size: 18,
              color: selected ? AppColors.cobalt : AppColors.muted,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    note,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class LotHistorySheet extends StatelessWidget {
  const LotHistorySheet({
    super.key,
    required this.businessId,
    required this.entityId,
    required this.staff,
  });

  final String businessId;
  final String entityId;
  final List<LotStaff> staff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // Scoped by business as well as entity: the rule authorizes by business,
    // and Firestore refuses a query it cannot prove stays inside that scope.
    final query = FirebaseFirestore.instance
        .collection('lotLedgerAudit')
        .where('businessId', isEqualTo: businessId)
        .where('entityId', isEqualTo: entityId)
        .orderBy('at', descending: true)
        .limit(50)
        .get();

    return LotSheetShell(
      title: l10n.lotHistory,
      body: FutureBuilder<QuerySnapshot<Map<String, dynamic>>>(
        future: query,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.waiting) {
            return const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          final events = [
            for (final d in snapshot.data?.docs ?? [])
              LotAuditEvent.fromMap(d.id, d.data()),
          ];
          if (events.isEmpty) {
            return LotEmptyState(
              icon: Icons.history,
              title: l10n.lotNoHistory,
            );
          }
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final event in events)
                Padding(
                  padding: const EdgeInsets.only(bottom: AppSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        event.summary,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        [
                          staff
                                  .where((s) => s.id == event.byStaffId)
                                  .firstOrNull
                                  ?.name ??
                              '',
                          if (event.at != null)
                            DateFormat.yMMMd(Localizations.localeOf(context)
                                    .toLanguageTag())
                                .add_jm()
                                .format(event.at!),
                        ].where((p) => p.isNotEmpty).join(' · '),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

