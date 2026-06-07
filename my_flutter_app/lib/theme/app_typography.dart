import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Compact business typography: readable body text, restrained headings.
abstract final class AppTypography {
  static TextTheme textTheme(Brightness brightness) {
    final Color onSurface = brightness == Brightness.dark
        ? const Color(0xFFF4EDDF)
        : const Color(0xFF15110C);
    final Color muted = brightness == Brightness.dark
        ? const Color(0xFFC5B89E)
        : const Color(0xFF7A6E5C);

    final base = ThemeData(brightness: brightness).textTheme;

    return base.copyWith(
      displayLarge: GoogleFonts.instrumentSerif(
        fontSize: 28,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        height: 1.12,
        color: onSurface,
      ),
      displayMedium: GoogleFonts.instrumentSerif(
        fontSize: 24,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        height: 1.14,
        color: onSurface,
      ),
      displaySmall: GoogleFonts.instrumentSerif(
        fontSize: 21,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        height: 1.18,
        color: onSurface,
      ),
      headlineMedium: GoogleFonts.instrumentSerif(
        fontSize: 18,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        height: 1.22,
        color: onSurface,
      ),
      titleLarge: GoogleFonts.hankenGrotesk(
        fontSize: 17,
        fontWeight: FontWeight.w600,
        height: 1.25,
        color: onSurface,
      ),
      titleMedium: GoogleFonts.hankenGrotesk(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        height: 1.28,
        color: onSurface,
      ),
      bodyLarge: GoogleFonts.hankenGrotesk(
        fontSize: 15,
        height: 1.45,
        color: onSurface,
      ),
      bodyMedium: GoogleFonts.hankenGrotesk(
        fontSize: 14,
        height: 1.42,
        color: onSurface,
      ),
      bodySmall: GoogleFonts.jetBrainsMono(
        fontSize: 11,
        height: 1.35,
        color: muted,
      ),
      labelLarge: GoogleFonts.hankenGrotesk(
        fontSize: 13,
        fontWeight: FontWeight.w600,
        height: 1.2,
        color: onSurface,
      ),
      labelMedium: GoogleFonts.jetBrainsMono(
        fontSize: 10.5,
        height: 1.2,
        color: muted,
      ),
    );
  }
}
