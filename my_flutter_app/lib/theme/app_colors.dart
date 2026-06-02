import 'package:flutter/material.dart';

/// Brand and semantic colors for the marketplace.
///
/// This palette uses deep teal foundations,
/// warm amber highlights, and clean slate/white surfaces.
abstract final class AppColors {
  static const Color ink = Color(0xFF0F172A);
  static const Color cream = Color(0xFFF8FAFC);
  static const Color paper = Color(0xFFFFFFFF);
  static const Color parchment = Color(0xFFF1F5F9);
  static const Color mist = Color(0xFFCCFBF1);
  static const Color rule = Color(0xFFE2E8F0);
  static const Color muted = Color(0xFF64748B);
  static const Color cobalt = Color(0xFF0D9488);
  static const Color cobaltDeep = Color(0xFF0B3B38);
  static const Color cobaltMid = Color(0xFF14B8A6);
  static const Color saffron = Color(0xFFF59E0B);
  static const Color sage = Color(0xFF059669);
  static const Color warn = Color(0xFFD97706);

  // Compatibility aliases used by existing screens.
  static const Color oxblood = cobalt;
  static const Color oxdeep = cobaltDeep;

  static const Color brandRed = cobalt;
  static const Color brandRedDark = cobaltDeep;
  static const Color chrome = mist;
  static const Color brandBlack = ink;
  static const Color brandCharcoal = oxdeep;
  static const Color brandCoral = saffron;
  static const Color errorRed = Color(0xFFDC2626);

  // Dark theme semantic
  static const Color darkBg = ink;
  static const Color darkSurface = Color(0xFF1E293B);
  static const Color darkSurfaceVariant = Color(0xFF25344A);
  static const Color darkOutline = Color(0xFF334155);
  static const Color darkOnSurface = Color(0xFFF8FAFC);
  static const Color darkMuted = Color(0xFF94A3B8);

  // Light theme semantic
  static const Color lightBg = cream;
  static const Color lightSurface = paper;
  static const Color lightSurfaceVariant = parchment;
  static const Color lightOutline = rule;
  static const Color lightOnSurface = ink;
  static const Color lightMuted = muted;

  /// Existing screens still expect a header fill; use the teal gradient.
  static const LinearGradient headerGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [cobaltDeep, cobalt, cobaltMid],
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
