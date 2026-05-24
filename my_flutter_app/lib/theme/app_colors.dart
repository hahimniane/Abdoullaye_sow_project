import 'package:flutter/material.dart';

/// Brand and semantic colors for Keren Auto Sales.
abstract final class AppColors {
  // Keren Atelier foundations from the handoff.
  static const Color ink = Color(0xFF15110C);
  static const Color cream = Color(0xFFF4EDDF);
  static const Color paper = Color(0xFFFAF6EC);
  static const Color parchment = Color(0xFFEDE3CE);
  static const Color mist = Color(0xFFE6DECE);
  static const Color rule = Color(0xFFD8CFBC);
  static const Color muted = Color(0xFF7A6E5C);
  static const Color cobalt = Color(0xFF293C7E);
  static const Color cobaltDeep = Color(0xFF1D2858);
  static const Color saffron = Color(0xFFD89A2F);
  static const Color sage = Color(0xFF4F6B4A);
  static const Color warn = Color(0xFFA66A00);

  // The handoff called this accent "oxblood"; map it to cobalt so no brand
  // surface reads red while preserving existing component references.
  static const Color oxblood = cobalt;
  static const Color oxdeep = cobaltDeep;

  // Compatibility aliases used by existing screens.
  static const Color brandRed = cobalt;
  static const Color brandRedDark = cobaltDeep;
  static const Color chrome = mist;
  static const Color brandBlack = ink;
  static const Color brandCharcoal = oxdeep;
  static const Color brandCoral = saffron;
  static const Color errorRed = Color(0xFFDC2626);

  // Dark theme semantic
  static const Color darkBg = ink;
  static const Color darkSurface = Color(0xFF211A12);
  static const Color darkSurfaceVariant = Color(0xFF2B2218);
  static const Color darkOutline = Color(0xFF4B3E2F);
  static const Color darkOnSurface = cream;
  static const Color darkMuted = Color(0xFFC5B89E);

  // Light theme semantic
  static const Color lightBg = cream;
  static const Color lightSurface = paper;
  static const Color lightSurfaceVariant = parchment;
  static const Color lightOutline = rule;
  static const Color lightOnSurface = ink;
  static const Color lightMuted = muted;

  /// Existing screens still expect a header fill; use cobalt, not red.
  static const LinearGradient headerGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [cobalt, cobaltDeep],
  );

  /// Service category accent colors.
  static const Color categoryParking = sage;
  static const Color categoryBarrels = cobalt;
  static const Color categoryTransport = sage;
  static const Color categorySales = saffron;

  static Color categoryColor(String category) {
    switch (category) {
      case 'parking':
        return categoryParking;
      case 'barrels':
        return categoryBarrels;
      case 'transport':
        return categoryTransport;
      case 'sales':
        return categorySales;
      default:
        return cobalt;
    }
  }
}
