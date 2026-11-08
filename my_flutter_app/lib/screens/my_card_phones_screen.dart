import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/business_card.dart';
import '../services/business_card_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/inventory_widgets.dart';

/// "Edit my numbers" (docs/BUSINESS_CARDS.md): the page where a team member
/// adds up to [cardPhonesMax] extra numbers to their own card, each with a
/// short label ("WhatsApp", "Guinea"). Their sign-in number is always on the
/// card and is shown here, read-only.
///
/// Save sends the whole list (`businessCards` `savePhones`); the server's
/// per-row refusals are shown under the number they belong to. On success the
/// page closes with the list the server saved ([Navigator.pop]), so My card
/// can say so and load the card again. A save always resolves: with the
/// saved list or with a message (the service times out), and the button never
/// stays busy.
class MyCardPhonesScreen extends StatefulWidget {
  const MyCardPhonesScreen({
    super.key,
    required this.service,
    required this.ownPhone,
    this.initial = const [],
  });

  final BusinessCardService service;

  /// The person's sign-in number, as the card has it.
  final String ownPhone;

  /// The extra numbers the card has now.
  final List<CardPhone> initial;

  @override
  State<MyCardPhonesScreen> createState() => _MyCardPhonesScreenState();
}

/// The words a quick-pick chip puts in the label field.
typedef _QuickLabel = ({String id, String text});

class _PhoneRow {
  _PhoneRow({String label = '', String phone = ''})
    : label = TextEditingController(text: label),
      phone = TextEditingController(text: phone);

  final TextEditingController label;
  final TextEditingController phone;

  /// [cardPhoneInvalid] / [cardPhoneNeedsCountryCode] from the last save.
  String? error;

  void dispose() {
    label.dispose();
    phone.dispose();
  }
}

class _MyCardPhonesScreenState extends State<MyCardPhonesScreen> {
  late final List<_PhoneRow> _rows = [
    for (final phone in widget.initial.take(cardPhonesMax))
      _PhoneRow(label: phone.label, phone: phone.phone),
  ];

  @override
  void initState() {
    super.initState();
    // Someone with no extra number yet starts with one empty row.
    if (_rows.isEmpty) _rows.add(_PhoneRow());
  }

  @override
  void dispose() {
    for (final row in _rows) {
      row.dispose();
    }
    super.dispose();
  }

  void _add() {
    if (_rows.length >= cardPhonesMax) return;
    setState(() => _rows.add(_PhoneRow()));
  }

  void _remove(int index) {
    setState(() => _rows.removeAt(index).dispose());
  }

  /// The row typed in: its own error is gone.
  void _edited(_PhoneRow row) {
    setState(() => row.error = null);
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    // Only rows with something typed are sent; [sentFrom] maps each sent
    // row back to its place on the page for the server's per-row errors.
    final sent = <CardPhone>[];
    final sentFrom = <int>[];
    var incomplete = false;
    setState(() {
      for (var i = 0; i < _rows.length; i++) {
        final row = _rows[i];
        row.error = null;
        final label = row.label.text.trim();
        final phone = row.phone.text.trim();
        if (label.isEmpty && phone.isEmpty) continue;
        if (phone.isEmpty) {
          // A label with no number: nothing to save.
          row.error = cardPhoneInvalid;
          incomplete = true;
          continue;
        }
        sent.add(CardPhone(label: label, phone: phone));
        sentFrom.add(i);
      }
    });
    if (incomplete) return;
    try {
      final saved = await widget.service.savePhones(sent);
      if (!mounted) return;
      Navigator.of(context).pop(saved);
    } on BusinessCardFailure catch (failure) {
      if (!mounted) return;
      _showFailure(l10n, failure, sentFrom);
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.myCardPhonesSaveFailed);
    }
  }

  void _showFailure(
    AppLocalizations l10n,
    BusinessCardFailure failure,
    List<int> sentFrom,
  ) {
    if (failure.phonesInvalid) {
      var shown = false;
      setState(() {
        failure.phoneErrors.forEach((sentIndex, error) {
          if (sentIndex < 0 || sentIndex >= sentFrom.length) return;
          final at = sentFrom[sentIndex];
          if (at >= _rows.length) return;
          _rows[at].error = error;
          shown = true;
        });
      });
      if (shown) return;
      showErrorSnackBar(
        context,
        failure.tooManyPhones
            ? l10n.myCardPhonesTooMany
            : l10n.myCardPhonesSaveFailed,
      );
      return;
    }
    showErrorSnackBar(
      context,
      failure.notTeamMember
          ? l10n.myCardNotTeamMember
          : failure.offline
          ? l10n.myCardOffline
          : l10n.myCardPhonesSaveFailed,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final own = cardPhoneDisplay(widget.ownPhone);
    final quick = <_QuickLabel>[
      (id: 'whatsapp', text: l10n.myCardPhoneChipWhatsApp),
      (id: 'mobile', text: l10n.myCardPhoneChipMobile),
      (id: 'home', text: l10n.myCardPhoneChipHome),
      (id: 'work', text: l10n.myCardPhoneChipWork),
    ];
    return Scaffold(
      key: const Key('my-card-phones-page'),
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.myCardPhonesTitle),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              children: [
                if (own.isNotEmpty) ...[
                  _OwnNumber(key: const Key('my-card-phones-own'), number: own),
                  const SizedBox(height: AppSpacing.md),
                ],
                Text(
                  l10n.myCardPhonesIntro,
                  style: const TextStyle(
                    fontSize: 13,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                for (var i = 0; i < _rows.length; i++) ...[
                  _PhoneRowCard(
                    key: ObjectKey(_rows[i]),
                    index: i,
                    row: _rows[i],
                    quick: quick,
                    onEdited: () => _edited(_rows[i]),
                    onRemove: () => _remove(i),
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (_rows.length < cardPhonesMax)
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton.icon(
                      key: const Key('my-card-phone-add'),
                      onPressed: _add,
                      icon: const Icon(Icons.add),
                      label: Text(l10n.myCardPhoneAdd),
                    ),
                  ),
                const SizedBox(height: AppSpacing.lg),
                AsyncActionButton.filled(
                  key: const Key('my-card-phones-save'),
                  label: l10n.myCardPhonesSave,
                  onPressed: _save,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The sign-in number, read-only, with the reason it cannot be changed here.
class _OwnNumber extends StatelessWidget {
  const _OwnNumber({super.key, required this.number});

  final String number;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Icon(Icons.lock_outline, size: 18, color: AppColors.muted),
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${l10n.myCardDirect}: $number',
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  l10n.myCardPhonesOwnNote,
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
    );
  }
}

/// One extra number: its label (with quick picks), the number, and a remove
/// button. The keys carry the row's place on the page.
class _PhoneRowCard extends StatelessWidget {
  const _PhoneRowCard({
    super.key,
    required this.index,
    required this.row,
    required this.quick,
    required this.onEdited,
    required this.onRemove,
  });

  final int index;
  final _PhoneRow row;
  final List<_QuickLabel> quick;
  final VoidCallback onEdited;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final error = switch (row.error) {
      cardPhoneInvalid => l10n.myCardPhoneInvalid,
      cardPhoneNeedsCountryCode => l10n.myCardPhoneNeedsCountryCode,
      _ => null,
    };
    return Container(
      key: Key('my-card-phone-row-$index'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            key: Key('my-card-phone-label-$index'),
            controller: row.label,
            textCapitalization: TextCapitalization.sentences,
            textInputAction: TextInputAction.next,
            inputFormatters: [
              LengthLimitingTextInputFormatter(cardPhoneLabelMax),
            ],
            onChanged: (_) => onEdited(),
            decoration: InputDecoration(
              labelText: l10n.myCardPhoneLabelField,
              hintText: l10n.myCardPhoneLabelHint,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.xs,
            children: [
              for (final label in quick)
                ChoiceChip(
                  key: Key('my-card-phone-chip-$index-${label.id}'),
                  label: Text(label.text),
                  selected:
                      row.label.text.trim().toLowerCase() ==
                      label.text.toLowerCase(),
                  onSelected: (_) {
                    row.label.text = label.text;
                    onEdited();
                  },
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  key: Key('my-card-phone-number-$index'),
                  controller: row.phone,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.done,
                  inputFormatters: [LengthLimitingTextInputFormatter(40)],
                  onChanged: (_) => onEdited(),
                  decoration: InputDecoration(
                    labelText: l10n.myCardPhoneNumberField,
                    errorText: error,
                    errorMaxLines: 2,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.xs),
              IconButton(
                key: Key('my-card-phone-remove-$index'),
                tooltip: l10n.myCardPhoneRemove,
                onPressed: onRemove,
                icon: const Icon(Icons.delete_outline),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
