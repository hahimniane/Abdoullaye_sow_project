// AUTO-PORTED from my_flutter_app/functions/address_components.js — the server
// module that splits a Google Places result into named parts and composes them
// back into one line. Keep the composition rules identical on all three
// surfaces (functions, admin_web, my_flutter_app/lib): the composed line is
// what the pricing and checkout callables receive, so a client that composes
// differently prices differently.
//
// Web twin: admin_web/src/lib/address-fields.ts

/// A customer address as separate, editable parts
/// (docs/PLAN-2026-08-backlog.md item 1).
///
/// Address autocomplete used to hand the form one opaque string, so the
/// customer could not correct a single part of it and the apartment/unit was
/// dropped whenever Google returned no `subpremise` — which is nearly always,
/// because Places autocompletes buildings, not units. [apartment] is therefore
/// the customer's own field: always optional, and never overwritten by a
/// suggestion.
class StructuredAddress {
  const StructuredAddress({
    this.streetLine = '',
    this.apartment = '',
    this.city = '',
    this.state = '',
    this.postalCode = '',
    this.country = '',
  });

  static const empty = StructuredAddress();

  final String streetLine;

  /// Apartment / unit / suite. Always optional, never dropped.
  final String apartment;
  final String city;
  final String state;
  final String postalCode;
  final String country;

  /// Trims and collapses inner whitespace so composed lines carry no padding.
  static String cleanPart(Object? value) {
    if (value == null) return '';
    return value.toString().replaceAll(RegExp(r'\s+'), ' ').trim();
  }

  /// Wraps a free-typed line as an address. The customer is never forced to
  /// accept a suggestion, so whatever they typed becomes the street line
  /// untouched and the other fields stay theirs to fill in.
  StructuredAddress withStreetLine(String value) =>
      copyWith(streetLine: value);

  StructuredAddress copyWith({
    String? streetLine,
    String? apartment,
    String? city,
    String? state,
    String? postalCode,
    String? country,
  }) {
    return StructuredAddress(
      streetLine: streetLine ?? this.streetLine,
      apartment: apartment ?? this.apartment,
      city: city ?? this.city,
      state: state ?? this.state,
      postalCode: postalCode ?? this.postalCode,
      country: country ?? this.country,
    );
  }

  /// Composes the parts into the single line the pricing and checkout
  /// callables accept.
  ///
  /// The apartment sits directly after the street line, which is where a
  /// courier expects it and where Google's geocoder ignores it rather than
  /// failing on it. Missing parts are skipped instead of leaving empty ", ,"
  /// gaps, so a customer who typed only a street still gets a usable line.
  String composeLine() {
    // State and postal code are one segment ("NY 11201"); they read as a
    // single field on an envelope and splitting them gives "NY, 11201".
    final region = [
      cleanPart(state),
      cleanPart(postalCode),
    ].where((part) => part.isNotEmpty).join(' ');
    return [
      cleanPart(streetLine),
      cleanPart(apartment),
      cleanPart(city),
      region,
      cleanPart(country),
    ].where((part) => part.isNotEmpty).join(', ');
  }

  /// An address is usable once it has a street line plus something that
  /// locates it. The apartment is never part of this test — it is optional by
  /// design, and requiring it is how the field would start getting faked.
  bool get isComplete {
    if (cleanPart(streetLine).isEmpty) return false;
    return cleanPart(city).isNotEmpty ||
        cleanPart(postalCode).isNotEmpty ||
        cleanPart(state).isNotEmpty;
  }

  bool get isEmpty => composeLine().isEmpty;

  @override
  bool operator ==(Object other) =>
      other is StructuredAddress &&
      other.streetLine == streetLine &&
      other.apartment == apartment &&
      other.city == city &&
      other.state == state &&
      other.postalCode == postalCode &&
      other.country == country;

  @override
  int get hashCode =>
      Object.hash(streetLine, apartment, city, state, postalCode, country);

  @override
  String toString() => 'StructuredAddress(${composeLine()})';
}
