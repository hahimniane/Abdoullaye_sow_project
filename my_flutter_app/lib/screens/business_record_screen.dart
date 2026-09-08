import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/barrel_shipment.dart';
import '../models/parked_car.dart';
import '../models/transport_request.dart';
import '../providers/auth_provider.dart';
import '../services/business_service_overview.dart';
import '../services/notification_routing.dart';
import 'barrel_shipment_details_screen.dart';
import 'home_menu.dart';
import 'parked_car_details_screen.dart';
import 'transport_request_details_screen.dart';

/// Opens a business record from nothing but its collection and id - what a
/// notification carries. The detail screens want a loaded model, so this
/// loads it, then replaces itself with the right screen. A record that is
/// gone, or that this business cannot read, lands on the business home
/// filtered to that service instead of a blank page.
class BusinessRecordScreen extends StatefulWidget {
  const BusinessRecordScreen({super.key, required this.arguments});

  final BusinessRecordArguments arguments;

  @override
  State<BusinessRecordScreen> createState() => _BusinessRecordScreenState();
}

class _BusinessRecordScreenState extends State<BusinessRecordScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _open());
  }

  Future<void> _open() async {
    final args = widget.arguments;
    final auth = context.read<AuthProvider>();
    final myBusiness = auth.businessId ?? '';
    Widget? destination;
    try {
      final doc = await FirebaseFirestore.instance
          .collection(args.collection)
          .doc(args.id)
          .get();
      final data = doc.data();
      final owned = data != null &&
          (myBusiness.isEmpty || (data['businessId'] ?? '') == myBusiness);
      if (doc.exists && owned) {
        switch (args.collection) {
          case 'parkedCars':
            destination = ParkedCarDetailsScreen(
              parkedCar: ParkedCar.fromFirestore(doc),
            );
            break;
          case 'barrelShipments':
            destination = BarrelShipmentDetailsScreen(
              shipment: BarrelShipment.fromFirestore(doc),
            );
            break;
          case 'transportRequests':
            destination = TransportRequestDetailsScreen(
              request: TransportRequest.fromFirestore(doc),
            );
            break;
          default:
            destination = null;
        }
      }
    } catch (_) {
      destination = null;
    }
    if (!mounted) return;
    final l10n = AppLocalizations.of(context)!;
    if (destination != null) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(builder: (_) => destination!),
      );
      return;
    }
    // Fall back to the business home on that service's list, and say why.
    Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(
        builder: (_) => HomeMenu(
          initialCategory: serviceCategoryFromKey(args.fallbackCategory),
          showBackButton: true,
        ),
      ),
    );
    ScaffoldMessenger.maybeOf(context)?.showSnackBar(
      SnackBar(content: Text(l10n.businessRecordNotFound)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(),
      body: const Center(child: CircularProgressIndicator()),
    );
  }
}
