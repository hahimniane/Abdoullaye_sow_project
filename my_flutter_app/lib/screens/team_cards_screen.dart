import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/business_card.dart';
import '../services/business_card_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/business_card_face.dart';
import '../widgets/inventory_widgets.dart';
import 'my_card_phones_screen.dart';
import 'my_card_screen.dart' show MyCardActions;

/// The name of a card colour or accent in the reader's language.
String cardColorName(AppLocalizations l10n, String key) => switch (key) {
  'laawol' => l10n.ownCardColorLaawol,
  'teal' => l10n.ownCardColorTeal,
  'indigo' => l10n.ownCardColorIndigo,
  'forest' => l10n.ownCardColorForest,
  'burgundy' => l10n.ownCardColorBurgundy,
  'saffron' => l10n.ownCardColorSaffron,
  'charcoal' => l10n.ownCardColorCharcoal,
  'ocean' => l10n.ownCardColorOcean,
  'plum' => l10n.ownCardColorPlum,
  'navy' => l10n.ownCardColorNavy,
  'red' => l10n.ownCardAccentRed,
  'amber' => l10n.ownCardAccentAmber,
  'blue' => l10n.ownCardAccentBlue,
  _ => key,
};

/// What a refused card-look save says, in words.
String cardLookRefusalText(AppLocalizations l10n, BusinessCardFailure f) {
  if (f.offline) return l10n.myCardOffline;
  if (f.ownerOnly) return l10n.ownCardsOwnerOnly;
  if (f.hasReason('tagline_too_long')) return l10n.ownCardsTaglineTooLong;
  if (f.hasReason('services_too_many')) return l10n.ownCardsServicesTooMany;
  if (f.hasReason('service_too_long')) return l10n.ownCardsServiceTooLong;
  return l10n.ownCardsSaveFailed;
}

/// "Team cards" (docs/BUSINESS_CARDS.md): the business's own card and one for
/// each person on the team, to share, copy or open, the owner's "How your
/// cards look", and (where the server allows it) a colleague's extra numbers.
/// For the owner and anyone with the People permission; the server decides
/// which cards each person gets. The website's print sheet (ten to a page) is
/// not here: it is for a printer, not a phone.
class TeamCardsScreen extends StatefulWidget {
  const TeamCardsScreen({
    super.key,
    required this.businessId,
    this.service = const BusinessCardService(),
    this.actions = const MyCardActions(),
  });

  final String businessId;
  final BusinessCardService service;
  final MyCardActions actions;

  @override
  State<TeamCardsScreen> createState() => _TeamCardsScreenState();
}

class _TeamCardsScreenState extends State<TeamCardsScreen> {
  BusinessCardList? _list;
  BusinessCardFailure? _failure;
  bool _loading = true;
  int _generation = 0;
  String _copied = '';

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// Loading always resolves: with the cards, or with words and a retry.
  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final list = await widget.service.list(widget.businessId);
      if (!mounted || generation != _generation) return;
      setState(() {
        _list = list;
        _loading = false;
      });
    } on BusinessCardFailure catch (failure) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _failure = failure;
        _loading = false;
      });
    } catch (_) {
      if (!mounted || generation != _generation) return;
      setState(() {
        _failure = const BusinessCardFailure(code: 'unknown');
        _loading = false;
      });
    }
  }

  Future<void> _share(TeamCard row) async {
    final l10n = AppLocalizations.of(context)!;
    final name = cardTitle(row.card);
    try {
      await widget.actions.shareText(
        text: l10n.myCardShareMessage(name, row.card.link),
        subject: l10n.myCardShareSubject(name),
      );
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.myCardShareFailed);
    }
  }

  Future<void> _copy(TeamCard row) async {
    await Clipboard.setData(ClipboardData(text: row.card.link));
    if (!mounted) return;
    setState(() => _copied = row.card.code);
    unawaited(
      Future<void>.delayed(const Duration(seconds: 2), () {
        if (mounted && _copied == row.card.code) setState(() => _copied = '');
      }),
    );
  }

  Future<void> _open(TeamCard row) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      final opened = await widget.actions.open(Uri.parse(row.card.link));
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.ownCardsOpenFailed);
      }
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.ownCardsOpenFailed);
    }
  }

  Future<void> _editPhones(TeamCard row) async {
    final l10n = AppLocalizations.of(context)!;
    final person = row.card.person;
    if (person == null) return;
    final saved = await Navigator.of(context).push<List<CardPhone>>(
      MaterialPageRoute(
        builder: (_) => MyCardPhonesScreen(
          service: widget.service,
          ownPhone: person.phone,
          initial: person.phones,
          uid: row.mine ? null : row.uid,
          businessId: widget.businessId,
        ),
      ),
    );
    if (saved == null || !mounted) return;
    setState(() => _list = _list?.withPhones(row.card.code, saved));
    showSuccessSnackBar(
      context,
      row.mine ? l10n.myCardPhonesSaved : l10n.ownCardsNumbersSaved,
    );
  }

  String _failureText(AppLocalizations l10n, BusinessCardFailure f) {
    if (f.offline) return l10n.myCardOffline;
    if (f.code == 'permission-denied') return l10n.ownCardsNotAllowed;
    if (f.businessNotApproved) return l10n.myCardBusinessNotApproved;
    return l10n.ownCardsLoadFailed;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final list = _list;
    final failure = _failure;
    return Scaffold(
      key: const Key('team-cards-page'),
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.ownCardsTitle,
            subtitle: l10n.ownCardsSubtitle,
          ),
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
                if (_loading && list == null)
                  const Padding(
                    key: Key('team-cards-loading'),
                    padding: EdgeInsets.symmetric(vertical: 48),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (list == null)
                  InventoryNote(
                    key: const Key('team-cards-error'),
                    text: _failureText(
                      l10n,
                      failure ?? const BusinessCardFailure(code: 'unknown'),
                    ),
                    trailing: TextButton(
                      key: const Key('team-cards-retry'),
                      onPressed: _loading ? null : _load,
                      child: Text(l10n.retry),
                    ),
                  )
                else ...[
                  Text(
                    l10n.ownCardsIntro,
                    style: const TextStyle(
                      fontSize: 12.5,
                      height: 1.4,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.md),
                  if (list.canEdit && list.cards.isNotEmpty) ...[
                    CardLookEditor(
                      key: const Key('team-cards-look'),
                      businessId: widget.businessId,
                      service: widget.service,
                      settings: list.settings,
                      sample:
                          (list.cards.where((c) => c.mine).firstOrNull ??
                                  list.cards.first)
                              .card,
                      onSaved: (settings) =>
                          setState(() => _list = list.withSettings(settings)),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                  for (final row in list.cards) ...[
                    _TeamCardTile(
                      row: row,
                      copied: _copied == row.card.code,
                      onShare: () => _share(row),
                      onCopy: () => _copy(row),
                      onOpen: () => _open(row),
                      onEditPhones: () => _editPhones(row),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TeamCardTile extends StatelessWidget {
  const _TeamCardTile({
    required this.row,
    required this.copied,
    required this.onShare,
    required this.onCopy,
    required this.onOpen,
    required this.onEditPhones,
  });

  final TeamCard row;
  final bool copied;
  final VoidCallback onShare;
  final VoidCallback onCopy;
  final VoidCallback onOpen;
  final VoidCallback onEditPhones;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final card = row.card;
    final person = card.person;
    final code = card.code;
    final kind = person == null
        ? l10n.ownCardsBusinessCard
        : row.mine
        ? l10n.ownCardsYourCard
        : l10n.ownCardsTeamCard;
    final noNumber = person != null && cardPhoneDial(person.phone).isEmpty;
    return Container(
      key: Key('team-card-$code'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            cardTitle(card),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          Text(
            kind,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          BusinessCardFace(card: card),
          if (noNumber)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.sm),
              child: Text(
                l10n.ownCardsNoNumber,
                key: Key('team-card-no-number-$code'),
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
            ),
          const SizedBox(height: AppSpacing.md),
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.sm,
            children: [
              OutlinedButton.icon(
                key: Key('team-card-share-$code'),
                onPressed: onShare,
                icon: const Icon(Icons.ios_share, size: 18),
                label: Text(l10n.myCardShare),
              ),
              OutlinedButton.icon(
                key: Key('team-card-copy-$code'),
                onPressed: onCopy,
                icon: Icon(copied ? Icons.check : Icons.copy, size: 18),
                label: Text(
                  copied ? l10n.ownCardsLinkCopied : l10n.ownCardsCopyLink,
                ),
              ),
              OutlinedButton.icon(
                key: Key('team-card-open-$code'),
                onPressed: onOpen,
                icon: const Icon(Icons.open_in_new, size: 18),
                label: Text(l10n.ownCardsOpen),
              ),
              if (row.canEditPhones && person != null)
                OutlinedButton.icon(
                  key: Key('team-card-phones-$code'),
                  onPressed: onEditPhones,
                  icon: const Icon(Icons.phone_outlined, size: 18),
                  label: Text(
                    person.phones.isEmpty
                        ? l10n.ownCardsAddNumbers
                        : l10n.ownCardsEditNumbers,
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// "How your cards look": style, colours, picture, the line under the name and
/// the services on the back, with the card drawn live. Saved with
/// `saveSettings`; the owner's (or an admin's) choice.
class CardLookEditor extends StatefulWidget {
  const CardLookEditor({
    super.key,
    required this.businessId,
    required this.service,
    required this.settings,
    required this.sample,
    required this.onSaved,
  });

  final String businessId;
  final BusinessCardService service;
  final CardSettings settings;

  /// A card to draw the preview on.
  final BusinessCardData sample;
  final ValueChanged<CardSettings> onSaved;

  @override
  State<CardLookEditor> createState() => _CardLookEditorState();
}

class _CardLookEditorState extends State<CardLookEditor> {
  late CardSettings _draft = widget.settings;
  late final TextEditingController _tagline = TextEditingController(
    text: widget.settings.tagline,
  );
  late final TextEditingController _services = TextEditingController(
    text: widget.settings.services.join('\n'),
  );
  bool _saving = false;
  String _error = '';
  bool _saved = false;

  @override
  void dispose() {
    _tagline.dispose();
    _services.dispose();
    super.dispose();
  }

  void _set(CardSettings next) => setState(() {
    _draft = next;
    _error = '';
    _saved = false;
  });

  CardSettings get _now => _draft.copyWith(
    tagline: _tagline.text,
    services: cardServiceLines(_services.text).take(cardServicesMax).toList(),
  );

  String _problemText(AppLocalizations l10n, String problem) =>
      switch (problem) {
        'tagline_too_long' => l10n.ownCardsTaglineTooLong,
        'services_too_many' => l10n.ownCardsServicesTooMany,
        _ => l10n.ownCardsServiceTooLong,
      };

  Future<void> _save() async {
    if (_saving) return;
    final l10n = AppLocalizations.of(context)!;
    final problem = cardLookProblem(
      tagline: _tagline.text,
      servicesText: _services.text,
    );
    if (problem.isNotEmpty) {
      setState(() => _error = _problemText(l10n, problem));
      return;
    }
    setState(() {
      _saving = true;
      _error = '';
      _saved = false;
    });
    try {
      final saved = await widget.service.saveSettings(
        widget.businessId,
        _draft.copyWith(
          tagline: _tagline.text,
          services: cardServiceLines(_services.text),
        ),
      );
      if (!mounted) return;
      AppHaptics.commit();
      setState(() {
        _draft = saved;
        _tagline.text = saved.tagline;
        _services.text = saved.services.join('\n');
        _saved = true;
      });
      widget.onSaved(saved);
    } on BusinessCardFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = cardLookRefusalText(l10n, failure));
    } catch (_) {
      if (mounted) setState(() => _error = l10n.ownCardsSaveFailed);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Widget _swatches({
    required AppLocalizations l10n,
    required String label,
    required Map<String, int> palette,
    required String selected,
    required String keyPrefix,
    required ValueChanged<String> onPick,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final entry in palette.entries)
              Semantics(
                button: true,
                selected: selected == entry.key,
                label: cardColorName(l10n, entry.key),
                child: GestureDetector(
                  key: Key('$keyPrefix-${entry.key}'),
                  onTap: _saving ? null : () => onPick(entry.key),
                  child: Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Color(entry.value),
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: selected == entry.key
                            ? AppColors.ink
                            : AppColors.rule,
                        width: selected == entry.key ? 3 : 1,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final signature = _draft.isSignature;
    final preview = BusinessCardData(
      code: widget.sample.code,
      link: widget.sample.link,
      person: widget.sample.person,
      business: widget.sample.business,
      settings: _now,
    );
    return Container(
      key: const Key('card-look'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.ownCardsLookTitle,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          BusinessCardFace(card: preview),
          const SizedBox(height: AppSpacing.md),
          Text(
            l10n.ownCardsStyle,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: AppSpacing.sm,
            children: [
              for (final style in cardStyles)
                ChoiceChip(
                  key: Key('card-look-style-$style'),
                  label: Text(
                    style == 'classic'
                        ? l10n.ownCardsStylePlain
                        : l10n.ownCardsStyleFull,
                  ),
                  selected: _draft.style == style,
                  onSelected: _saving
                      ? null
                      : (_) => _set(_draft.copyWith(style: style)),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          _swatches(
            l10n: l10n,
            label: l10n.ownCardsColor,
            palette: cardColors,
            selected: _draft.color,
            keyPrefix: 'card-look-color',
            onPick: (c) => _set(_draft.copyWith(color: c)),
          ),
          if (signature) ...[
            const SizedBox(height: AppSpacing.md),
            _swatches(
              l10n: l10n,
              label: l10n.ownCardsAccent,
              palette: cardAccents,
              selected: _draft.accent,
              keyPrefix: 'card-look-accent',
              onPick: (c) => _set(_draft.copyWith(accent: c)),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              l10n.ownCardsPhoto,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.muted,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: AppSpacing.sm,
              children: [
                for (final photo in cardPhotos)
                  ChoiceChip(
                    key: Key('card-look-photo-$photo'),
                    label: Text(
                      photo == 'none'
                          ? l10n.ownCardsPhotoNone
                          : l10n.ownCardsPhotoCar,
                    ),
                    selected: _draft.photo == photo,
                    onSelected: _saving
                        ? null
                        : (_) => _set(_draft.copyWith(photo: photo)),
                  ),
              ],
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('card-look-tagline'),
            controller: _tagline,
            enabled: !_saving,
            maxLength: cardTaglineMax,
            onChanged: (_) => setState(() {
              _error = '';
              _saved = false;
            }),
            decoration: InputDecoration(
              labelText: l10n.ownCardsTagline,
              hintText: l10n.ownCardsTaglineHint,
              helperText: l10n.ownCardsTaglineNote,
              helperMaxLines: 2,
              counterText: '',
            ),
          ),
          if (signature) ...[
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('card-look-services'),
              controller: _services,
              enabled: !_saving,
              minLines: 4,
              maxLines: 7,
              onChanged: (_) => setState(() {
                _error = '';
                _saved = false;
              }),
              decoration: InputDecoration(
                labelText: l10n.ownCardsServices,
                helperText: l10n.ownCardsServicesNote,
                helperMaxLines: 2,
              ),
            ),
          ],
          const SizedBox(height: AppSpacing.md),
          if (_error.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                _error,
                key: const Key('card-look-error'),
                style: const TextStyle(
                  fontSize: 12.5,
                  color: AppColors.errorRed,
                ),
              ),
            ),
          if (_saved)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                l10n.ownCardsSaved,
                key: const Key('card-look-saved'),
                style: const TextStyle(fontSize: 12.5, color: AppColors.sage),
              ),
            ),
          AsyncActionButton.filled(
            key: const Key('card-look-save'),
            label: l10n.ownCardsSave,
            onPressed: _save,
          ),
        ],
      ),
    );
  }
}
