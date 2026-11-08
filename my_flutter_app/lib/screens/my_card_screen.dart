import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/business_card.dart';
import '../services/business_card_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/business_card_face.dart';
import '../widgets/card_web_view.dart';
import '../widgets/embedded_business_card.dart';
import '../widgets/inventory_widgets.dart';
import 'my_card_phones_screen.dart';

/// What the My card buttons hand to the phone. Behind a class so a widget
/// test answers in place of the share sheet, the file system and the
/// browser.
class MyCardActions {
  const MyCardActions();

  /// The system share sheet with [text] (the card's link in a sentence).
  Future<void> shareText({
    required String text,
    required String subject,
    Rect? origin,
  }) async {
    await SharePlus.instance.share(
      ShareParams(text: text, subject: subject, sharePositionOrigin: origin),
    );
  }

  /// Share with the card itself: the picture of the real card (both sides)
  /// with [text] (the link) as its message, so a chat shows the card.
  Future<void> shareImage({
    required Uint8List bytes,
    required String fileName,
    required String text,
    required String subject,
    Rect? origin,
  }) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$fileName');
    await file.writeAsBytes(bytes, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: 'image/jpeg', name: fileName)],
        text: text,
        subject: subject,
        sharePositionOrigin: origin,
      ),
    );
  }

  /// "Save contact": the card as a `.vcf` file in the share sheet. Both the
  /// iOS and the Android sheets offer Contacts for a vCard.
  Future<void> shareContactFile({
    required String fileName,
    required String vcard,
    required String subject,
    Rect? origin,
  }) async {
    final dir = await getTemporaryDirectory();
    final file = File('${dir.path}/$fileName');
    await file.writeAsString(vcard, flush: true);
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(file.path, mimeType: 'text/vcard', name: fileName)],
        subject: subject,
        sharePositionOrigin: origin,
      ),
    );
  }

  /// Opens [uri] outside the app (Safari shows the Add to Wallet sheet for a
  /// pass; Google Pay opens for a save link). False when nothing opened.
  Future<bool> open(Uri uri) =>
      launchUrl(uri, mode: LaunchMode.externalApplication);
}

/// "My card": the signed-in business owner's or staff member's own digital
/// business card (docs/BUSINESS_CARDS.md). It shows the website's real card
/// (the card page in a WebView, the app's own [BusinessCardFace] when that
/// cannot load), a large QR of
/// its link (scannable from this screen), and Share, Save contact and, on
/// the phone's own wallet, Add to Apple Wallet (iOS) / Add to Google Wallet
/// (Android) when the server can make a pass.
///
/// The card is read fresh from the server (`businessCards` `mine`), so a
/// changed number is right here as it is on every printed card. Loading
/// always resolves: with the card, or with an error and a retry.
class MyCardScreen extends StatefulWidget {
  const MyCardScreen({
    super.key,
    this.service = const BusinessCardService(),
    this.actions = const MyCardActions(),
    this.platform,
    this.cardViewFactory,
  });

  final BusinessCardService service;
  final MyCardActions actions;

  /// Makes the WebView that shows the website's real card; null uses the
  /// platform's (and the app's own card where there is none). Tests pass a
  /// fake.
  final CardWebViewFactory? cardViewFactory;

  /// The platform the wallet button is for; null reads the device.
  final TargetPlatform? platform;

  @override
  State<MyCardScreen> createState() => _MyCardScreenState();
}

class _MyCardScreenState extends State<MyCardScreen> {
  MyCard? _card;
  BusinessCardFailure? _failure;
  bool _loading = true;

  /// Which wallet pass is being fetched ('apple' / 'google'); '' for none.
  String _walletBusy = '';

  final GlobalKey _buttonsKey = GlobalKey();

  /// The real card as a picture, for Share.
  final CardPictures _pictures = CardPictures();

  /// Bumped when the card changed on the server, so the page that shows it
  /// is loaded again ([EmbeddedBusinessCard.revision]).
  int _revision = 0;

  /// Bumped by every load, so an answer that arrives after a newer load
  /// started is ignored.
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  TargetPlatform get _platform => widget.platform ?? defaultTargetPlatform;

  Future<void> _load() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final card = await widget.service.mine();
      if (!mounted || generation != _generation) return;
      setState(() {
        _card = card;
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

  /// Where the iPad's share popover points: the buttons.
  Rect? _shareOrigin() {
    final box = _buttonsKey.currentContext?.findRenderObject();
    if (box is! RenderBox || !box.hasSize) return null;
    return box.localToGlobal(Offset.zero) & box.size;
  }

  Future<void> _share(MyCard card) async {
    final l10n = AppLocalizations.of(context)!;
    final name = cardTitle(card.card);
    final text = l10n.myCardShareMessage(name, card.url);
    final subject = l10n.myCardShareSubject(name);
    try {
      // The real card as a picture when it is on screen; the link alone
      // otherwise (still loading, offline, or the page could not draw it).
      final picture = await _pictures.capture().catchError((Object _) => null);
      if (!mounted) return;
      final origin = _shareOrigin();
      if (picture != null) {
        await widget.actions.shareImage(
          bytes: picture,
          fileName: cardImageFileName(card.card),
          text: text,
          subject: subject,
          origin: origin,
        );
      } else {
        await widget.actions.shareText(
          text: text,
          subject: subject,
          origin: origin,
        );
      }
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.myCardShareFailed);
    }
  }

  Future<void> _saveContact(MyCard card) async {
    final l10n = AppLocalizations.of(context)!;
    final subject = l10n.myCardShareSubject(cardTitle(card.card));
    final origin = _shareOrigin();
    try {
      await widget.actions.shareContactFile(
        fileName: cardVcardFileName(card.card),
        vcard: cardVcard(card.card),
        subject: subject,
        origin: origin,
      );
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.myCardSaveFailed);
    }
  }

  /// "Edit my numbers": the page for the person's extra numbers. When it
  /// saves, the card shows the saved numbers at once, the real card page is
  /// loaded again and the card is read from the server again.
  Future<void> _editPhones(MyCard card) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await Navigator.of(context).push<List<CardPhone>>(
      MaterialPageRoute(
        builder: (_) => MyCardPhonesScreen(
          service: widget.service,
          ownPhone: card.card.person?.phone ?? '',
          initial: card.card.person?.phones ?? const [],
        ),
      ),
    );
    if (saved == null || !mounted) return;
    setState(() {
      _card = _card?.withPhones(saved);
      _revision++;
    });
    showSuccessSnackBar(context, l10n.myCardPhonesSaved);
    unawaited(_load());
  }

  Future<void> _addToWallet(String platform) async {
    if (_walletBusy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _walletBusy = platform);
    try {
      final link = await widget.service.walletLink(platform);
      final opened = await widget.actions.open(link);
      if (!opened && mounted) {
        showErrorSnackBar(context, l10n.myCardWalletFailed);
      }
    } on BusinessCardFailure catch (failure) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        failure.walletNotReady
            ? l10n.myCardWalletNotReady
            : failure.offline
            ? l10n.myCardOffline
            : l10n.myCardWalletFailed,
      );
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.myCardWalletFailed);
    } finally {
      if (mounted) setState(() => _walletBusy = '');
    }
  }

  String _failureText(AppLocalizations l10n, BusinessCardFailure failure) {
    if (failure.notTeamMember) return l10n.myCardNotTeamMember;
    if (failure.businessNotApproved) return l10n.myCardBusinessNotApproved;
    if (failure.offline) return l10n.myCardOffline;
    return l10n.myCardLoadFailed;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final card = _card;
    final failure = _failure;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.myCardTitle),
          Expanded(
            child: ListView(
              key: const Key('my-card-body'),
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                if (_loading && card == null)
                  const Padding(
                    key: Key('my-card-loading'),
                    padding: EdgeInsets.symmetric(vertical: 48),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (card == null)
                  InventoryNote(
                    key: const Key('my-card-error'),
                    text: _failureText(
                      l10n,
                      failure ?? const BusinessCardFailure(code: 'unknown'),
                    ),
                    trailing: (failure?.noCard ?? false)
                        ? null
                        : TextButton(
                            key: const Key('my-card-retry'),
                            onPressed: _loading ? null : _load,
                            child: Text(l10n.retry),
                          ),
                  )
                else
                  ..._ready(l10n, card),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _ready(AppLocalizations l10n, MyCard card) {
    final ios = _platform == TargetPlatform.iOS;
    final android = _platform == TargetPlatform.android;
    return [
      EmbeddedBusinessCard(
        card: card.card,
        factory: widget.cardViewFactory,
        pictures: _pictures,
        revision: _revision,
      ),
      const SizedBox(height: AppSpacing.xl),
      Center(
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              BusinessCardQr(link: card.url),
              const SizedBox(height: AppSpacing.sm),
              Text(
                l10n.myCardScanHint,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ),
      const SizedBox(height: AppSpacing.xl),
      Column(
        key: _buttonsKey,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          AsyncActionButton.filled(
            key: const Key('my-card-share'),
            icon: Icons.ios_share,
            label: l10n.myCardShare,
            onPressed: () => _share(card),
          ),
          const SizedBox(height: AppSpacing.sm),
          AsyncActionButton.outlined(
            key: const Key('my-card-save-contact'),
            icon: Icons.person_add_alt_1_outlined,
            label: l10n.myCardSaveContact,
            onPressed: () => _saveContact(card),
          ),
          // Only a person has numbers of their own; a business's own card
          // (no person) has none to edit.
          if (card.card.person != null) ...[
            const SizedBox(height: AppSpacing.sm),
            OutlinedButton.icon(
              key: const Key('my-card-edit-phones'),
              onPressed: () => _editPhones(card),
              icon: const Icon(Icons.phone_outlined),
              label: Text(l10n.myCardEditPhones),
            ),
          ],
          if (ios && card.appleWallet) ...[
            const SizedBox(height: AppSpacing.sm),
            _WalletButton(
              key: const Key('my-card-apple-wallet'),
              label: l10n.myCardAddAppleWallet,
              dark: true,
              busy: _walletBusy == 'apple',
              enabled: _walletBusy.isEmpty,
              onPressed: () => _addToWallet('apple'),
            ),
          ],
          if (android && card.googleWallet) ...[
            const SizedBox(height: AppSpacing.sm),
            _WalletButton(
              key: const Key('my-card-google-wallet'),
              label: l10n.myCardAddGoogleWallet,
              dark: false,
              busy: _walletBusy == 'google',
              enabled: _walletBusy.isEmpty,
              onPressed: () => _addToWallet('google'),
            ),
          ],
        ],
      ),
    ];
  }
}

/// "Add to Apple Wallet" (black) / "Add to Google Wallet" (white with a
/// border), after each platform's badge guidance. The label is the
/// platform's own wording ("Ajouter à ..." in French).
class _WalletButton extends StatelessWidget {
  const _WalletButton({
    super.key,
    required this.label,
    required this.dark,
    required this.busy,
    required this.enabled,
    required this.onPressed,
  });

  final String label;
  final bool dark;
  final bool busy;
  final bool enabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final foreground = dark ? Colors.white : AppColors.ink;
    return Semantics(
      button: true,
      label: label,
      child: Material(
        color: dark ? Colors.black : Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        child: InkWell(
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          onTap: enabled ? onPressed : null,
          child: Container(
            constraints: const BoxConstraints(minHeight: 48),
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
              border: dark ? null : Border.all(color: AppColors.muted),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (busy)
                  SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: foreground,
                    ),
                  )
                else
                  Icon(
                    Icons.account_balance_wallet_outlined,
                    size: 20,
                    color: foreground,
                  ),
                const SizedBox(width: 10),
                Flexible(
                  child: Text(
                    label,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: foreground,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
