import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_card.dart';
import '../services/tag_labels.dart' show QrMatrix;
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// One business card (docs/BUSINESS_CARDS.md) as the My card screen draws it:
/// the logo, the business's name and tagline, the person's name, their own
/// number ("Direct") and the business's ("Office"), and the address. No role
/// or title is ever printed. The QR is a separate, larger widget
/// ([BusinessCardQr]) so it can be scanned from the screen.
///
/// Two looks, as on the web: `classic` (plain white) and `signature` (the
/// business's own color as a band across the top with its accent beneath).
/// The words printed here are the business's own data; only the labels
/// ("Direct", "Office") and a missing tagline's service words follow the
/// app's language.
class BusinessCardFace extends StatelessWidget {
  const BusinessCardFace({super.key, required this.card});

  final BusinessCardData card;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = Localizations.localeOf(context).languageCode;
    final settings = card.settings;
    final color = Color(settings.colorValue);
    final accent = Color(settings.accentValue);
    final signature = settings.isSignature;
    final tagline = cardTagline(card, language);
    final address = cardAddress(card.business);
    final website = card.business.website.trim();
    final phones = cardPhoneRows(card);

    final header = Row(
      children: [
        _CardLogo(
          name: card.business.name,
          logoUrl: card.business.logoUrl,
          color: color,
          onBand: signature,
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                card.business.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  height: 1.15,
                  color: signature ? Colors.white : color,
                ),
              ),
              if (tagline.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  tagline,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: signature
                        ? Colors.white.withValues(alpha: 0.85)
                        : AppColors.muted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );

    return Semantics(
      container: true,
      child: Container(
        key: const Key('my-card-face'),
        clipBehavior: Clip.antiAlias,
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
          border: Border.all(color: AppColors.rule),
          boxShadow: const [
            BoxShadow(
              color: Color(0x14000000),
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (signature) ...[
              Container(
                key: const Key('my-card-band'),
                color: color,
                padding: const EdgeInsets.all(16),
                child: header,
              ),
              Container(height: 4, color: accent),
            ],
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (!signature) ...[header, const SizedBox(height: 18)],
                  if (card.person != null)
                    Text(
                      card.person!.name,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  if (phones.isNotEmpty) const SizedBox(height: 8),
                  for (final row in phones)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.baseline,
                        textBaseline: TextBaseline.alphabetic,
                        children: [
                          SizedBox(
                            width: 64,
                            child: Text(
                              row.label == 'direct'
                                  ? l10n.myCardDirect
                                  : l10n.myCardOffice,
                              style: const TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.muted,
                              ),
                            ),
                          ),
                          Expanded(
                            child: Text(
                              row.number,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.ink,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (website.isNotEmpty || address.isNotEmpty) ...[
                    const SizedBox(height: 12),
                    const Divider(height: 1, color: AppColors.rule),
                    const SizedBox(height: 10),
                  ],
                  if (website.isNotEmpty)
                    Text(
                      cardWebsiteLabel(website),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                  if (address.isNotEmpty)
                    Padding(
                      padding: EdgeInsets.only(top: website.isEmpty ? 0 : 2),
                      child: Text(
                        address,
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            // The classic card's colored strip along the bottom.
            if (!signature) Container(height: 5, color: color),
          ],
        ),
      ),
    );
  }
}

/// The business's logo, or its initials when it has none (or it will not
/// load): a card never shows a broken picture.
class _CardLogo extends StatelessWidget {
  const _CardLogo({
    required this.name,
    required this.logoUrl,
    required this.color,
    required this.onBand,
  });

  final String name;
  final String logoUrl;
  final Color color;
  final bool onBand;

  @override
  Widget build(BuildContext context) {
    const size = 52.0;
    final initials = Container(
      key: const Key('my-card-initials'),
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: onBand ? Colors.white : color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      ),
      child: Text(
        cardInitials(name),
        style: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w800,
          color: color,
        ),
      ),
    );
    final url = Uri.tryParse(logoUrl);
    if (url == null || !url.hasScheme || !url.scheme.startsWith('http')) {
      return initials;
    }
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: onBand ? null : Border.all(color: AppColors.rule),
      ),
      clipBehavior: Clip.antiAlias,
      padding: const EdgeInsets.all(3),
      child: Image.network(
        logoUrl,
        fit: BoxFit.contain,
        errorBuilder: (context, error, stack) => initials,
      ),
    );
  }
}

/// The card's QR, drawn from its modules with two modules of white around
/// it (the quiet zone a scanner needs), large enough to scan from a screen.
class BusinessCardQr extends StatefulWidget {
  const BusinessCardQr({super.key, required this.link, this.size = 240});

  final String link;
  final double size;

  @override
  State<BusinessCardQr> createState() => _BusinessCardQrState();
}

class _BusinessCardQrState extends State<BusinessCardQr> {
  // Built once per link, not on every rebuild.
  late QrMatrix _matrix = cardQrMatrix(widget.link);

  @override
  void didUpdateWidget(BusinessCardQr old) {
    super.didUpdateWidget(old);
    if (old.link != widget.link) _matrix = cardQrMatrix(widget.link);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      image: true,
      label: l10n.myCardQrLabel,
      child: Container(
        key: const Key('my-card-qr'),
        width: widget.size,
        height: widget.size,
        color: Colors.white,
        child: CustomPaint(painter: _QrPainter(_matrix)),
      ),
    );
  }
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.matrix);

  final QrMatrix matrix;

  static const int quiet = 2;

  @override
  void paint(Canvas canvas, Size size) {
    final n = matrix.size;
    final module = size.shortestSide / (n + 2 * quiet);
    final offset = quiet * module;
    final paint = Paint()
      ..color = AppColors.ink
      ..isAntiAlias = false;
    for (var row = 0; row < n; row++) {
      var col = 0;
      while (col < n) {
        if (!matrix.dark(row, col)) {
          col++;
          continue;
        }
        final start = col;
        while (col < n && matrix.dark(row, col)) {
          col++;
        }
        // One rectangle per run of dark modules, a hair taller than a module
        // so rows never show a seam.
        canvas.drawRect(
          Rect.fromLTWH(
            offset + start * module,
            offset + row * module,
            (col - start) * module,
            module + 0.5,
          ),
          paint,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter old) => old.matrix != matrix;
}
