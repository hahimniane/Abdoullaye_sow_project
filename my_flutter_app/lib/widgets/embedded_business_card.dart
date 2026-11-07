import 'dart:async';

import 'package:flutter/material.dart';

import '../services/business_card.dart';
import '../services/business_card_embed.dart';
import '../theme/app_colors.dart';
import 'business_card_face.dart';
import 'card_web_view.dart';

/// The real business card: the website's own card page (classic white or the
/// full-colour signature design, front and back) in a WebView, so the phone
/// shows exactly the card people are handed (docs/BUSINESS_CARDS.md).
///
/// Loading always resolves: the real card once the page says it is painted,
/// or the app's own [BusinessCardFace] when the page errors, says the card
/// is missing, takes longer than [timeout], or the platform has no WebView.
/// A late answer after the fallback is ignored.
class EmbeddedBusinessCard extends StatefulWidget {
  const EmbeddedBusinessCard({
    super.key,
    required this.card,
    this.factory,
    this.baseUrl = cardEmbedBaseUrl,
    this.timeout = cardEmbedReadyTimeout,
  });

  final BusinessCardData card;

  /// Makes the WebView; null uses the platform's. Tests pass a fake.
  final CardWebViewFactory? factory;

  /// The page's address; tests pass their own.
  final String baseUrl;

  final Duration timeout;

  @override
  State<EmbeddedBusinessCard> createState() => _EmbeddedBusinessCardState();
}

class _EmbeddedBusinessCardState extends State<EmbeddedBusinessCard> {
  CardEmbedPhase _phase = CardEmbedPhase.loading;
  CardWebViewHandle? _handle;
  Timer? _timer;
  String _language = '';

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final language = cardEmbedLang(
      Localizations.localeOf(context).languageCode,
    );
    if (language != _language) {
      _language = language;
      _start();
    }
  }

  @override
  void didUpdateWidget(EmbeddedBusinessCard old) {
    super.didUpdateWidget(old);
    if (old.card.code != widget.card.code) _start();
  }

  /// (Re)loads the page for the current card and language.
  void _start() {
    _timer?.cancel();
    _handle?.dispose();
    _handle = null;
    _phase = CardEmbedPhase.loading;
    final uri = cardEmbedUri(
      code: widget.card.code,
      languageCode: _language,
      base: widget.baseUrl,
    );
    if (uri == null) {
      _phase = CardEmbedPhase.fallback;
      return;
    }
    try {
      _handle = (widget.factory ?? PlatformCardWebView.new)(
        CardWebViewRequest(
          url: uri,
          baseUrl: widget.baseUrl,
          onMessage: (message) => _advance(message: message),
          onPageError: () => _advance(pageError: true),
        ),
      );
      _timer = Timer(widget.timeout, () => _advance(timedOut: true));
    } catch (_) {
      // No WebView on this platform: the app's own card.
      _phase = CardEmbedPhase.fallback;
    }
  }

  void _advance({
    String? message,
    bool timedOut = false,
    bool pageError = false,
  }) {
    if (!mounted) return;
    final next = cardEmbedNextPhase(
      _phase,
      message: message,
      timedOut: timedOut,
      pageError: pageError,
    );
    if (next == _phase) return;
    _timer?.cancel();
    setState(() {
      _phase = next;
      if (next == CardEmbedPhase.fallback) {
        _handle?.dispose();
        _handle = null;
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _handle?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_phase == CardEmbedPhase.fallback || _handle == null) {
      return BusinessCardFace(
        key: const Key('my-card-fallback'),
        card: widget.card,
      );
    }
    final handle = _handle!;
    return LayoutBuilder(
      builder: (context, box) {
        final width = box.maxWidth;
        final height = width / cardEmbedAspect + cardEmbedFlipHeight;
        return SizedBox(
          key: const Key('my-card-embed'),
          width: width,
          height: height,
          child: Stack(
            children: [
              Positioned.fill(child: handle.build(context)),
              if (_phase == CardEmbedPhase.loading)
                Positioned.fill(
                  child: Padding(
                    key: const Key('my-card-embed-loading'),
                    // The card's own area; the page's flip row stays clear.
                    padding: const EdgeInsets.only(bottom: cardEmbedFlipHeight),
                    child: const _CardPlaceholder(),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// A card-shaped blank with a spinner, over the page while it loads.
class _CardPlaceholder extends StatelessWidget {
  const _CardPlaceholder();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.cream,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppColors.rule),
      ),
      child: const Center(child: CircularProgressIndicator()),
    );
  }
}
