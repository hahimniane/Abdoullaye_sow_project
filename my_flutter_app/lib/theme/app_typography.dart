import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Saira for display, Inter for body — wired through TextTheme.
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
        fontSize: 32,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        color: onSurface,
      ),
      displayMedium: GoogleFonts.instrumentSerif(
        fontSize: 28,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        color: onSurface,
      ),
      displaySmall: GoogleFonts.instrumentSerif(
        fontSize: 24,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        color: onSurface,
      ),
      headlineMedium: GoogleFonts.instrumentSerif(
        fontSize: 20,
        fontStyle: FontStyle.italic,
        fontWeight: FontWeight.w400,
        color: onSurface,
      ),
      titleLarge: GoogleFonts.hankenGrotesk(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      titleMedium: GoogleFonts.hankenGrotesk(
        fontSize: 16,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      bodyLarge: GoogleFonts.hankenGrotesk(fontSize: 16, color: onSurface),
      bodyMedium: GoogleFonts.hankenGrotesk(fontSize: 14, color: onSurface),
      bodySmall: GoogleFonts.jetBrainsMono(fontSize: 12, color: muted),
      labelLarge: GoogleFonts.hankenGrotesk(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: onSurface,
      ),
      labelMedium: GoogleFonts.jetBrainsMono(fontSize: 11, color: muted),
    );
  }
}
