import '../l10n/app_localizations.dart';
import '../models/business_service.dart';
import '../models/customer_service_catalog.dart';
import 'transport_journey_stages.dart';

/// The words for the app's fixed catalogs, in the reader's language.
///
/// The catalogs (`businessServiceCatalog`, `customerServiceCatalog`,
/// `transportJourneyStages`) keep their English `label`s as stable,
/// web-mirrored reference data; every screen shows them through these.

String businessServiceLabel(AppLocalizations l10n, BusinessServiceKey key) =>
    switch (key) {
      BusinessServiceKey.barrelShipping => l10n.businessServiceBarrelShipping,
      BusinessServiceKey.sharedBarrels => l10n.businessServiceSharedBarrels,
      BusinessServiceKey.freight => l10n.businessServiceFreight,
      BusinessServiceKey.carSales => l10n.businessServiceCarSales,
      BusinessServiceKey.carParking => l10n.businessServiceCarParking,
      BusinessServiceKey.carTransport => l10n.businessServiceCarTransport,
    };

String businessServiceDescription(
  AppLocalizations l10n,
  BusinessServiceKey key,
) => switch (key) {
  BusinessServiceKey.barrelShipping => l10n.businessServiceBarrelShippingHint,
  BusinessServiceKey.sharedBarrels => l10n.businessServiceSharedBarrelsHint,
  BusinessServiceKey.freight => l10n.businessServiceFreightHint,
  BusinessServiceKey.carSales => l10n.businessServiceCarSalesHint,
  BusinessServiceKey.carParking => l10n.businessServiceCarParkingHint,
  BusinessServiceKey.carTransport => l10n.businessServiceCarTransportHint,
};

/// A customer service's name in the navbar picker. An id the catalog does
/// not know keeps its stored label.
String customerServiceLabel(AppLocalizations l10n, CustomerService service) =>
    switch (service.id) {
      'cars' => l10n.customerServiceCars,
      'barrel' => l10n.customerServiceBarrel,
      'shared' => l10n.customerServiceShared,
      'freight' => l10n.customerServiceFreight,
      'park' => l10n.customerServicePark,
      'transport' => l10n.customerServiceTransport,
      'purchases' => l10n.customerServicePurchases,
      'viewings' => l10n.customerServiceViewings,
      'tracking' => l10n.customerServiceTracking,
      _ => service.label,
    };

/// The name of stage [index] of [transportJourneyStages].
String transportJourneyStageLabel(AppLocalizations l10n, int index) =>
    switch (index) {
      0 => l10n.transportJourneyBooked,
      1 => l10n.transportJourneyScheduled,
      2 => l10n.transportJourneyOnItsWay,
      3 => l10n.transportJourneyDelivered,
      _ => index >= 0 && index < transportJourneyStages.length
          ? transportJourneyStages[index].label
          : '',
    };
