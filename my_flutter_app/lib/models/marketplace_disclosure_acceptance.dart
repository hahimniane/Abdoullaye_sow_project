class MarketplaceDisclosureAcceptance {
  const MarketplaceDisclosureAcceptance({
    required this.locale,
    this.accepted = true,
    this.version = currentVersion,
  });

  static const currentVersion = 'marketplace-provider-responsibility-v1';

  final bool accepted;
  final String version;
  final String locale;

  Map<String, dynamic> toJson() => {
    'accepted': accepted,
    'version': version,
    'locale': locale,
  };
}

class AccountLegalAcceptance {
  const AccountLegalAcceptance({
    required this.locale,
    this.accepted = true,
    this.version = currentVersion,
  });

  static const currentVersion = 'terms-privacy-marketplace-v1';

  final bool accepted;
  final String version;
  final String locale;

  Map<String, dynamic> toJson() => {
    'accepted': accepted,
    'version': version,
    'locale': locale,
  };
}
