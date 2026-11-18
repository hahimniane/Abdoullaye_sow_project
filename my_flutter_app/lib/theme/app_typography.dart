import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// One typeface with the website and the web consoles: Plus Jakarta Sans.
/// Weights stay on 400 / 500 / 600 / 700, headings sit slightly tight, and
/// nothing is smaller than 12.
abstract final class AppTypography {
  static TextTheme textTheme(Brightness brightness) {
    final Color onSurface = brightness == Brightness.dark
        ? const Color(0xFFF7F7F7)
        : const Color(0xFF222222);
    final Color muted = brightness == Brightness.dark
        ? const Color(0xFFB0B0B0)
        : const Color(0xFF6A6A6A);

    final base = ThemeData(brightness: brightness).textTheme;

    TextStyle face({
      required double size,
      FontWeight weight = FontWeight.w400,
      double? height,
      double spacing = 0,
      Color? color,
    }) {
      return GoogleFonts.plusJakartaSans(
        fontSize: size,
        fontWeight: weight,
        height: height,
        letterSpacing: spacing,
        color: color ?? onSurface,
      );
    }

    return GoogleFonts.plusJakartaSansTextTheme(base).copyWith(
      displayLarge: face(
        size: 28,
        weight: FontWeight.w700,
        height: 1.12,
        spacing: -0.6,
      ),
      displayMedium: face(
        size: 24,
        weight: FontWeight.w700,
        height: 1.15,
        spacing: -0.5,
      ),
      displaySmall: face(
        size: 21,
        weight: FontWeight.w700,
        height: 1.18,
        spacing: -0.4,
      ),
      headlineMedium: face(
        size: 18,
        weight: FontWeight.w700,
        height: 1.22,
        spacing: -0.3,
      ),
      titleLarge: face(
        size: 17,
        weight: FontWeight.w600,
        height: 1.25,
        spacing: -0.2,
      ),
      titleMedium: face(size: 15, weight: FontWeight.w600, height: 1.28),
      titleSmall: face(size: 14, weight: FontWeight.w600, height: 1.3),
      bodyLarge: face(size: 15, height: 1.45),
      bodyMedium: face(size: 14, height: 1.42),
      bodySmall: face(size: 12, height: 1.35, color: muted),
      labelLarge: face(size: 13, weight: FontWeight.w600, height: 1.2),
      labelMedium: face(
        size: 12,
        weight: FontWeight.w500,
        height: 1.2,
        color: muted,
      ),
      labelSmall: face(
        size: 12,
        weight: FontWeight.w500,
        height: 1.2,
        color: muted,
      ),
    );
  }
}
