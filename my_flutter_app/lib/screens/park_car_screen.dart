import 'package:flutter/material.dart';
import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'dart:io';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';
import 'package:intl/intl.dart';
import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:geolocator/geolocator.dart';
import 'package:provider/provider.dart';
import '../models/business_profile.dart';
import '../models/parking_availability.dart';
import '../models/parked_car.dart';
import '../providers/auth_provider.dart';
import '../screens/vin_scanner_screen.dart';
import '../services/vin_catalog_matcher.dart';
import '../services/lot_customers.dart';
import '../services/vin_decoder_service.dart';
import '../services/business_parking_entry.dart';
import '../services/parking_rates.dart';
import '../services/parking_service.dart';
import '../widgets/language_toggle.dart';
import '../l10n/app_localizations.dart';
import '../data/car_catalog.dart';
import '../utils/business_parking_localization.dart';
import '../utils/tracking_code_generator.dart';
import '../utils/vin_utils.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/async_action_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/marketplace_transaction_disclosure.dart';

class ParkCarScreen extends StatefulWidget {
  const ParkCarScreen({
    super.key,
    this.parkingRepository,
    this.businessParkingService,
  });

  final ParkingRepository? parkingRepository;

  /// Injectable so a widget test can drive the walk-up flow without Firebase,
  /// the same seam `parkingRepository` already provides.
  final BusinessParkingService? businessParkingService;

  @override
  State<ParkCarScreen> createState() => _ParkCarScreenState();
}

class _ParkCarScreenState extends State<ParkCarScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _phoneController = TextEditingController();
  final _parkingCityController = TextEditingController();
  final _vinController = TextEditingController();
  final _emailController = TextEditingController();

  String? _selectedMake;
  String? _selectedModel;
  String? _selectedYear;

  DateTime _selectedDateTime = DateTime.now();
  DateTime _selectedEndDateTime = DateTime.now().add(const Duration(days: 7));
  // Walk-up leave date. null = OPEN-ENDED: the car stays until the business
  // closes the stay and is billed day by day ("bill through today"). Same
  // rule as the console; the customer reservation flow keeps its own end.
  DateTime? _walkUpEndDate;
  // The lot's customer memory, and what it offers for what has been typed.
  // Only ever loaded for the business intake: a customer parking their own
  // car must never be shown the lot's other customers.
  List<LotCustomer> _lotCustomers = const [];
  List<LotCustomer> _staffCustomers = const [];
  final _nameFocus = FocusNode();
  List<LotCustomer> _customerSuggestions = const [];
  bool _isLoading = false;
  bool _isSearchingParking = false;
  // Every lot the customer could use, loaded without them naming anywhere.
  // The state and town pickers are built from this, so they only ever offer
  // places that actually have a lot in them.
  List<ParkingBusinessOption> _allParkingPlaces = const [];
  String _browseState = '';
  String _browseCity = '';
  bool _isCatalogLoading = true;
  bool _isVinDecoding = false;
  bool _isLocating = false;
  bool _pickupRequested = false;
  double? _customerLatitude;
  double? _customerLongitude;
  List<String> _makeOptions = [];
  List<String> _modelOptions = [];
  List<String> _yearOptions = [];
  List<ParkingBusinessOption> _parkingOptions = const [];
  ParkingBusinessOption? _selectedParkingOption;
  int _customerStep = 0; // 0 where/when · 1 choose · 2 car · 3 review
  late final ParkingRepository _parkingRepository;
  late final BusinessParkingService _businessParkingService;
  BusinessParkingPaymentMethod _paymentMethod =
      BusinessParkingPaymentMethod.direct;
  // "Pays us directly" answers how, not whether. A lot takes the cash at the
  // desk as often as it waits for it, and recording both as awaiting left
  // money already in the till showing as outstanding.
  bool _alreadyPaid = false;
  // The prices this lot can quote. With only its standard rate there is
  // nothing to choose, and the picker stays out of the way entirely.
  List<ParkingRateChoice> _rateChoices = const [];
  String _rateId = '';
  String _receivedVia = businessParkingReceivedViaValues.first;
  bool _isRecordingEntry = false;
  BusinessParkingEntryResult? _entryResult;
  final VinDecoderService _vinDecoderService = NhtsaVinDecoderService();
  DecodedVehicleInfo? _decodedVehicleInfo;

  @override
  void initState() {
    super.initState();
    _parkingRepository = widget.parkingRepository ?? FirebaseParkingService();
    _businessParkingService =
        widget.businessParkingService ?? BusinessParkingService();
    _loadCatalog();
    _loadLotCustomers();
    _loadParkingRates();
    _loadAllParkingPlaces();
    // An empty field opens on the people most recently seen rather than
    // nothing: this is a list to look through, not a search box that only
    // rewards someone who already knows the name.
    _nameFocus.addListener(() {
      if (!mounted) return;
      setState(() => _customerSuggestions = _suggestFor(_nameController.text));
    });
  }

  List<LotCustomer> _suggestFor(String value) {
    if (!_nameFocus.hasFocus) return const [];
    final typed = value.trim();
    if (typed.length < 2) return _lotCustomers.take(6).toList();
    return matchLotCustomers(_lotCustomers, typed).toList();
  }

  /// The lot's own price cards. Silent on failure: with none loaded the
  /// standard rate applies, which is what the server does anyway.
  Future<void> _loadParkingRates() async {
    final auth = context.read<AuthProvider>();
    if (!auth.hasBusinessDashboardAccess) return;
    final businessId = auth.businessId ?? '';
    if (businessId.isEmpty) return;
    try {
      final snap = await FirebaseFirestore.instance
          .collection('businesses')
          .doc(businessId)
          .get();
      if (!mounted) return;
      setState(() => _rateChoices = parkingRateChoices(snap.data()));
    } catch (_) {
      // The standard rate still applies.
    }
  }

  /// A one-shot read of who this lot has taken cars from before. Silent on
  /// failure: every field still works by hand, so a business with no memory
  /// yet - or no permission to read it - simply gets no suggestions.
  Future<void> _loadLotCustomers() async {
    final auth = context.read<AuthProvider>();
    if (!auth.hasBusinessDashboardAccess) return;
    final businessId = auth.businessId ?? '';
    if (businessId.isEmpty) return;
    try {
      final snap = await FirebaseFirestore.instance
          .collection('lotCustomers')
          .where('businessId', isEqualTo: businessId)
          .orderBy('lastSeenAt', descending: true)
          .limit(500)
          .get();
      if (!mounted) return;
      final saved = [
        for (final d in snap.docs) LotCustomer.fromMap(d.id, d.data()),
      ];
      setState(() => _lotCustomers = lotCustomerSources(saved, _staffCustomers));
    } catch (_) {
      // Nothing to offer; the form is unaffected.
    }
    await _loadStaffAsCustomers(businessId);
  }

  /// The lot's own people, offered as customers too. Reading the team needs
  /// the 'people' permission, so this is best-effort: a parking-only staff
  /// member simply gets the remembered customers and types the rest.
  Future<void> _loadStaffAsCustomers(String businessId) async {
    try {
      final snap = await FirebaseFirestore.instance
          .collection('users')
          .where('businessId', isEqualTo: businessId)
          .limit(200)
          .get();
      if (!mounted) return;
      final staff = <LotCustomer>[];
      for (final d in snap.docs) {
        final entry = LotCustomer.fromStaff(d.id, d.data());
        if (entry != null) staff.add(entry);
      }
      setState(() {
        _staffCustomers = staff;
        _lotCustomers = lotCustomerSources(
          [for (final c in _lotCustomers) if (!c.staff) c],
          staff,
        );
      });
    } catch (_) {
      // No permission to see the team: the memory alone still works.
    }
  }

  /// Picking a regular fills their contact details, and their car too when
  /// they only have one. Everything stays editable - the memory is a
  /// suggestion, never a record that outranks the person at the desk.
  void _applyLotCustomer(LotCustomer customer) {
    setState(() {
      _nameController.text = customer.name;
      if (customer.phone.isNotEmpty) _phoneController.text = customer.phone;
      if (customer.email.isNotEmpty) _emailController.text = customer.email;
      _customerSuggestions = const [];
    });
    if (customer.cars.length == 1) _applyLotCustomerCar(customer.cars.first);
  }

  void _applyLotCustomerCar(LotCustomerCar car) {
    // Make, model and year are catalog pickers, so a remembered car goes
    // through the same matcher a VIN decode uses rather than being forced
    // into options that may not exist. Unlike a decode this says nothing when
    // it cannot match: the staff member chose this car, they can see the
    // fields, and an alert here would be scolding them for their own lot's
    // memory.
    final match = matchDecodedVehicleToCatalog(
      decoded: DecodedVehicleInfo(
        vin: car.vin,
        make: car.make.isEmpty ? null : car.make,
        model: car.model.isEmpty ? null : car.model,
        year: car.year.isEmpty ? null : car.year,
      ),
      makeOptions: _makeOptions,
      modelsForMake: CarCatalog.instance.getModels,
      yearsForModel: CarCatalog.instance.getYears,
    );
    setState(() {
      if (car.vin.isNotEmpty) _vinController.text = car.vin;
      if (match.make != null) {
        _selectedMake = match.make;
        _modelOptions = match.modelOptions;
        _selectedModel = match.model;
        _yearOptions = match.yearOptions;
        _selectedYear = match.year;
      }
    });
  }

  Future<void> _loadCatalog() async {
    final catalog = CarCatalog.instance;
    await catalog.load();
    final makes = catalog.getMakes();
    setState(() {
      _makeOptions = makes;
      if (_selectedMake != null) {
        _modelOptions = catalog.getModels(_selectedMake!);
        if (_selectedModel != null) {
          _yearOptions = catalog.getYears(_selectedMake!, _selectedModel!);
        }
      }
      _isCatalogLoading = false;
    });
  }

  @override
  void dispose() {
    _nameFocus.dispose();
    _nameController.dispose();
    _phoneController.dispose();
    _parkingCityController.dispose();
    _vinController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _selectDateTime() async {
    if (Platform.isIOS) {
      // Use iOS-style date picker
      await _showIOSDatePicker();
    } else {
      // Use Android-style date picker
      await _showAndroidDatePicker();
    }
  }

  Future<void> _selectCustomerParkingDate({required bool isStart}) async {
    final current = isStart ? _selectedDateTime : _selectedEndDateTime;
    final pickedDate = await showDatePicker(
      context: context,
      initialDate: current,
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (pickedDate == null || !mounted) return;
    setState(() {
      if (isStart) {
        _selectedDateTime = DateTime(
          pickedDate.year,
          pickedDate.month,
          pickedDate.day,
          9,
        );
        if (_selectedEndDateTime.isBefore(_selectedDateTime)) {
          _selectedEndDateTime = _selectedDateTime.add(const Duration(days: 7));
        }
      } else {
        _selectedEndDateTime = DateTime(
          pickedDate.year,
          pickedDate.month,
          pickedDate.day,
          17,
        );
      }
      _parkingOptions = const [];
      _selectedParkingOption = null;
    });
  }

  Future<void> _showIOSDatePicker() async {
    DateTime tempDateTime = _selectedDateTime;

    await showCupertinoModalPopup<void>(
      context: context,
      builder: (BuildContext context) {
        return Container(
          height: 300,
          padding: const EdgeInsets.only(top: 6.0),
          margin: EdgeInsets.only(
            bottom: MediaQuery.of(context).viewInsets.bottom,
          ),
          color: CupertinoColors.systemBackground.resolveFrom(context),
          child: SafeArea(
            top: false,
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    CupertinoButton(
                      child: Text(AppLocalizations.of(context)!.cancel),
                      onPressed: () => Navigator.pop(context),
                    ),
                    CupertinoButton(
                      child: Text(AppLocalizations.of(context)!.done),
                      onPressed: () {
                        setState(() {
                          _selectedDateTime = tempDateTime;
                        });
                        Navigator.pop(context);
                      },
                    ),
                  ],
                ),
                Expanded(
                  child: CupertinoDatePicker(
                    mode: CupertinoDatePickerMode.dateAndTime,
                    initialDateTime: _selectedDateTime,
                    onDateTimeChanged: (DateTime newDateTime) {
                      tempDateTime = newDateTime;
                    },
                    use24hFormat: false,
                    minuteInterval: 1,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  Future<void> _showAndroidDatePicker() async {
    final DateTime? pickedDate = await showDatePicker(
      context: context,
      initialDate: _selectedDateTime,
      firstDate: DateTime(2020),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.light(
              primary: AppColors.brandRed,
              onPrimary: Colors.white,
              surface: Colors.white,
              onSurface: Colors.black,
            ),
          ),
          child: child!,
        );
      },
    );

    if (pickedDate != null && mounted) {
      final TimeOfDay? pickedTime = await showTimePicker(
        context: context,
        initialTime: TimeOfDay.fromDateTime(_selectedDateTime),
        builder: (context, child) {
          return Theme(
            data: Theme.of(context).copyWith(
              colorScheme: const ColorScheme.light(
                primary: AppColors.brandRed,
                onPrimary: Colors.white,
                surface: Colors.white,
                onSurface: Colors.black,
              ),
            ),
            child: child!,
          );
        },
      );

      if (pickedTime != null && mounted) {
        setState(() {
          _selectedDateTime = DateTime(
            pickedDate.year,
            pickedDate.month,
            pickedDate.day,
            pickedTime.hour,
            pickedTime.minute,
          );
        });
      }
    }
  }

  Future<void> _scanVin() async {
    final vin = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (context) => const VinScannerScreen()),
    );
    if (vin == null || !mounted) return;
    _vinController.text = vin;
    await _decodeCurrentVin();
  }

  Future<void> _decodeCurrentVin() async {
    final l10n = AppLocalizations.of(context)!;
    final vin = normalizeVin(_vinController.text);
    if (!isValidVin(vin)) {
      showErrorSnackBar(context, l10n.invalidVinNumber);
      return;
    }

    setState(() {
      _isVinDecoding = true;
    });
    try {
      final decoded = await _vinDecoderService.decode(vin);
      if (!mounted) return;
      _applyDecodedVehicleInfo(decoded);
      final message = decoded.summary.isEmpty
          ? l10n.vinDecoded
          : l10n.vinDecodedVehicle(decoded.summary);
      showSuccessSnackBar(context, message);
    } catch (_) {
      if (mounted) {
        showErrorSnackBar(context, l10n.vinDecodeFailed);
      }
    } finally {
      if (mounted) {
        setState(() {
          _isVinDecoding = false;
        });
      }
    }
  }

  void _applyDecodedVehicleInfo(DecodedVehicleInfo decoded) {
    final match = matchDecodedVehicleToCatalog(
      decoded: decoded,
      makeOptions: _makeOptions,
      modelsForMake: CarCatalog.instance.getModels,
      yearsForModel: CarCatalog.instance.getYears,
    );

    setState(() {
      _decodedVehicleInfo = decoded;
      if (match.make != null) {
        _selectedMake = match.make;
        _modelOptions = match.modelOptions;
        _selectedModel = match.model;
        _yearOptions = match.yearOptions;
        _selectedYear = match.year;
      }
    });

    if (!match.isComplete) {
      showErrorSnackBar(context, AppLocalizations.of(context)!.vinMatchReview);
    }
  }

  /// Every lot, with no city and no dates - which is what someone who does
  /// not already know the name of a town needs. Silent on failure: the
  /// search still works by hand.
  Future<void> _loadAllParkingPlaces() async {
    try {
      final places = await _parkingRepository.searchParking(
        customerLatitude: _customerLatitude,
        customerLongitude: _customerLongitude,
      );
      if (!mounted) return;
      setState(() => _allParkingPlaces = places);
    } catch (_) {
      // Nothing to browse; the city box still searches.
    }
  }

  /// The states that actually have a lot in them, in alphabetical order.
  List<String> get _browseStates {
    final states = <String>{
      for (final place in _allParkingPlaces)
        if (place.state.trim().isNotEmpty) place.state.trim(),
    }.toList()
      ..sort();
    return states;
  }

  /// The towns with a lot in them, narrowed to the chosen state.
  List<String> get _browseCities {
    final cities = <String>{
      for (final place in _allParkingPlaces)
        if (place.city.trim().isNotEmpty &&
            (_browseState.isEmpty || place.state.trim() == _browseState))
          place.city.trim(),
    }.toList()
      ..sort();
    return cities;
  }

  /// What the browse list shows right now.
  List<ParkingBusinessOption> get _browsedPlaces => [
        for (final place in _allParkingPlaces)
          if ((_browseState.isEmpty || place.state.trim() == _browseState) &&
              (_browseCity.isEmpty || place.city.trim() == _browseCity))
            place,
      ];

  Future<void> _searchParkingOptions() async {
    final l10n = AppLocalizations.of(context)!;
    // No city required: with nothing chosen this is every lot with room for
    // the dates, which is what someone who knows no town name needs.
    final city = _parkingCityController.text.trim();
    if (_selectedEndDateTime.isBefore(_selectedDateTime)) {
      showErrorSnackBar(context, l10n.parkingDateRangeInvalid);
      return;
    }
    setState(() {
      _isSearchingParking = true;
      _selectedParkingOption = null;
    });
    try {
      final options = await _parkingRepository.searchParking(
        city: city,
        state: _browseState,
        startDate: _selectedDateTime,
        endDate: _selectedEndDateTime,
        customerLatitude: _customerLatitude,
        customerLongitude: _customerLongitude,
        pickupRequested: _pickupRequested,
      );
      if (!mounted) return;
      setState(() => _parkingOptions = options);
    } catch (_) {
      if (mounted) {
        showErrorSnackBar(context, l10n.parkingSearchFailed);
      }
    } finally {
      if (mounted) {
        setState(() => _isSearchingParking = false);
      }
    }
  }

  // Wizard step 1 -> validate the search inputs, run the search, and advance to
  // the "choose a spot" step (which shows results or an empty-state notice).
  Future<void> _findParkingAndAdvance() async {
    final l10n = AppLocalizations.of(context)!;
    if (_selectedEndDateTime.isBefore(_selectedDateTime)) {
      showErrorSnackBar(context, l10n.parkingDateRangeInvalid);
      return;
    }
    await _searchParkingOptions();
    if (mounted) setState(() => _customerStep = 1);
  }

  /// Tapping a lot in the list picks that lot. It is priced for the dates on
  /// the form first - a browsing row only knows one day at the lot's rate,
  /// and the reservation must be quoted on the real window. If the lot has
  /// no room for those dates, the customer lands on that town's results
  /// rather than in a booking that cannot happen.
  Future<void> _chooseBrowsedPlace(ParkingBusinessOption place) async {
    setState(() {
      _browseState = place.state.trim();
      _browseCity = place.city.trim();
      _parkingCityController.text = place.city.trim();
      _selectedParkingOption = null;
    });
    await _searchParkingOptions();
    if (!mounted) return;
    ParkingBusinessOption? match;
    for (final option in _parkingOptions) {
      if (option.businessId == place.businessId) {
        match = option;
        break;
      }
    }
    setState(() {
      _selectedParkingOption = match;
      _customerStep = 1;
    });
  }

  void _goToParkingStep(int step) {
    setState(() => _customerStep = step.clamp(0, 3));
  }

  void _parkingBack() {
    if (_customerStep > 0) {
      setState(() => _customerStep -= 1);
    } else {
      Navigator.of(context).maybePop();
    }
  }

  Future<void> _locateCustomerForParking() async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _isLocating = true);
    try {
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        if (mounted) await Geolocator.openAppSettings();
        return;
      }
      if (permission == LocationPermission.denied) {
        if (mounted) showErrorSnackBar(context, l10n.locationPermissionDenied);
        return;
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
        ),
      );
      if (!mounted) return;
      setState(() {
        _customerLatitude = position.latitude;
        _customerLongitude = position.longitude;
        _parkingOptions = const [];
        _selectedParkingOption = null;
      });
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.locationPermissionDenied);
    } finally {
      if (mounted) setState(() => _isLocating = false);
    }
  }

  Future<void> _reserveCustomerParking() async {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.read<AuthProvider>();
    if (auth.user == null) {
      showErrorSnackBar(context, l10n.accountRequiredParking);
      return;
    }
    final option = _selectedParkingOption;
    if (option == null) {
      showErrorSnackBar(context, l10n.chooseParkingBusiness);
      return;
    }
    if (!_formKey.currentState!.validate()) {
      return;
    }
    if (_selectedEndDateTime.isBefore(_selectedDateTime)) {
      showErrorSnackBar(context, l10n.parkingDateRangeInvalid);
      return;
    }

    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: option.businessName,
      transactionSummary: l10n.parkingReviewHeading,
      showHoldNotice: true,
    );
    if (marketplaceAcceptance == null || !mounted) return;

    setState(() => _isLoading = true);
    try {
      final result = await _parkingRepository.reserveParking(
        option: option,
        customerName: _nameController.text,
        customerPhone: _phoneController.text.trim().isNotEmpty
            ? _phoneController.text
            : auth.customerPhone ?? '',
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        vinNumber: normalizeVin(_vinController.text),
        startDate: _selectedDateTime,
        endDate: _selectedEndDateTime,
        pickupRequested: _pickupRequested,
        marketplaceAcceptance: marketplaceAcceptance,
      );
      if (!mounted) return;
      showSuccessSnackBar(
        context,
        l10n.parkingReservationSaved(result.trackingCode),
      );
      Navigator.of(context).pop();
    } catch (_) {
      if (mounted) {
        showErrorSnackBar(context, l10n.parkingReservationFailed);
      }
    } finally {
      if (mounted) {
        setState(() => _isLoading = false);
      }
    }
  }

  Future<void> _saveAndPrintReceipt() async {
    if (!_formKey.currentState!.validate()) {
      return;
    }
    // The VIN is optional for a recorded walk-up - the console does not
    // require it and neither does the callable - but a printed receipt is a
    // document identifying a specific car, so this path still asks for one.
    if (_vinController.text.trim().isEmpty) {
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.pleaseEnterVinNumber,
      );
      return;
    }

    setState(() {
      _isLoading = true;
    });

    try {
      final auth = context.read<AuthProvider>();
      final trackingCode = await TrackingCodeGenerator.generateUniqueCode(
        prefix: 'PC',
        collectionPath: 'parkedCars',
      );

      final newRecord = ParkedCar(
        id: '',
        trackingCode: trackingCode,
        ownerName: _nameController.text,
        carMake: _selectedMake!,
        carModel: _selectedModel!,
        carYear: _selectedYear!,
        vinNumber: normalizeVin(_vinController.text),
        parkingDate: _selectedDateTime,
      );

      final docRef = await FirebaseFirestore.instance
          .collection('parkedCars')
          .add({
            ...newRecord.toFirestore(),
            'businessId': auth.isAdmin
                ? BusinessProfile.defaultBusinessId
                : auth.businessId ?? BusinessProfile.defaultBusinessId,
            'businessName': auth.isAdmin
                ? BusinessProfile.defaultBusinessName
                : auth.businessName ?? BusinessProfile.defaultBusinessName,
          });

      final savedRecord = newRecord.copyWith(id: docRef.id);

      await _generateAndPrintReceipt(savedRecord);

      if (mounted) {
        showSuccessSnackBar(
          context,
          AppLocalizations.of(
            context,
          )!.parkingSavedWithTracking(savedRecord.trackingCode),
        );
        Navigator.of(context).pop();
      }
    } catch (e) {
      if (mounted) {
        showErrorSnackBar(
          context,
          AppLocalizations.of(context)!.errorGeneratingReceipt(e.toString()),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _generateAndPrintReceipt(ParkedCar record) async {
    final l10n = AppLocalizations.of(context)!;
    final pdf = pw.Document();

    pdf.addPage(
      pw.Page(
        pageFormat: PdfPageFormat.a4,
        build: (pw.Context context) {
          return pw.Column(
            crossAxisAlignment: pw.CrossAxisAlignment.start,
            children: [
              // Header
              pw.Container(
                width: double.infinity,
                padding: const pw.EdgeInsets.all(20),
                decoration: pw.BoxDecoration(
                  color: PdfColors.blue,
                  borderRadius: const pw.BorderRadius.all(
                    pw.Radius.circular(10),
                  ),
                ),
                child: pw.Column(
                  children: [
                    pw.Text(
                      l10n.carParkingReceipt,
                      style: pw.TextStyle(
                        fontSize: 24,
                        fontWeight: pw.FontWeight.bold,
                        color: PdfColors.white,
                      ),
                      textAlign: pw.TextAlign.center,
                    ),
                    pw.SizedBox(height: 10),
                    pw.Text(
                      l10n.businessServices,
                      style: pw.TextStyle(fontSize: 16, color: PdfColors.white),
                      textAlign: pw.TextAlign.center,
                    ),
                  ],
                ),
              ),

              pw.SizedBox(height: 20),

              // Receipt Details
              pw.Container(
                padding: const pw.EdgeInsets.all(20),
                decoration: pw.BoxDecoration(
                  border: pw.Border.all(color: PdfColors.grey),
                  borderRadius: const pw.BorderRadius.all(
                    pw.Radius.circular(10),
                  ),
                ),
                child: pw.Column(
                  crossAxisAlignment: pw.CrossAxisAlignment.start,
                  children: [
                    pw.Text(
                      l10n.receiptDetails,
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),

                    _buildReceiptRow(
                      l10n.receiptNumber,
                      record.id.isEmpty ? record.trackingCode : record.id,
                    ),
                    _buildReceiptRow(
                      l10n.trackingNumberPdf,
                      record.trackingCode,
                    ),
                    _buildReceiptRow(
                      l10n.dateTimePdf,
                      DateFormat(
                        'MMM dd, yyyy - HH:mm',
                      ).format(record.parkingDate),
                    ),
                    _buildReceiptRow(
                      l10n.generatedOn,
                      DateFormat('MMM dd, yyyy - HH:mm').format(DateTime.now()),
                    ),

                    pw.SizedBox(height: 20),

                    pw.Text(
                      l10n.carInformation,
                      style: pw.TextStyle(
                        fontSize: 18,
                        fontWeight: pw.FontWeight.bold,
                      ),
                    ),
                    pw.SizedBox(height: 15),

                    _buildReceiptRow(l10n.ownerNamePdf, _nameController.text),
                    _buildReceiptRow(l10n.carMakePdf, _selectedMake ?? ''),
                    _buildReceiptRow(l10n.carModelPdf, _selectedModel ?? ''),
                    _buildReceiptRow(l10n.yearPdf, _selectedYear ?? ''),
                    _buildReceiptRow(l10n.vinNumberPdf, _vinController.text),

                    pw.SizedBox(height: 20),

                    pw.Container(
                      width: double.infinity,
                      padding: const pw.EdgeInsets.all(15),
                      decoration: pw.BoxDecoration(
                        color: PdfColors.grey100,
                        borderRadius: const pw.BorderRadius.all(
                          pw.Radius.circular(8),
                        ),
                      ),
                      child: pw.Column(
                        children: [
                          pw.Text(
                            l10n.parkingStatusActive,
                            style: pw.TextStyle(
                              fontSize: 16,
                              fontWeight: pw.FontWeight.bold,
                              color: PdfColors.green,
                            ),
                          ),
                          pw.SizedBox(height: 5),
                          pw.Text(
                            l10n.vehicleSuccessfullyParked,
                            style: pw.TextStyle(
                              fontSize: 12,
                              color: PdfColors.grey700,
                            ),
                          ),
                        ],
                      ),
                    ),

                    pw.SizedBox(height: 30),

                    // Footer
                    pw.Container(
                      width: double.infinity,
                      padding: const pw.EdgeInsets.all(15),
                      decoration: pw.BoxDecoration(
                        color: PdfColors.grey200,
                        borderRadius: const pw.BorderRadius.all(
                          pw.Radius.circular(8),
                        ),
                      ),
                      child: pw.Column(
                        children: [
                          pw.Text(
                            l10n.termsAndConditions,
                            style: pw.TextStyle(
                              fontSize: 14,
                              fontWeight: pw.FontWeight.bold,
                            ),
                          ),
                          pw.SizedBox(height: 10),
                          pw.Text(
                            l10n.parkingReceiptTerms,
                            style: pw.TextStyle(
                              fontSize: 10,
                              color: PdfColors.grey700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );

    // Print the PDF
    await Printing.layoutPdf(
      onLayout: (PdfPageFormat format) async => pdf.save(),
      name: 'Car_Parking_Receipt_${DateTime.now().millisecondsSinceEpoch}',
    );
  }

  pw.Widget _buildReceiptRow(String label, String value) {
    return pw.Padding(
      padding: const pw.EdgeInsets.symmetric(vertical: 5),
      child: pw.Row(
        crossAxisAlignment: pw.CrossAxisAlignment.start,
        children: [
          pw.SizedBox(
            width: 120,
            child: pw.Text(
              label,
              style: pw.TextStyle(fontSize: 12, fontWeight: pw.FontWeight.bold),
            ),
          ),
          pw.Expanded(child: pw.Text(value, style: pw.TextStyle(fontSize: 12))),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    if (!auth.hasBusinessDashboardAccess) {
      return _buildCustomerParkingReservation(context);
    }
    return _buildBusinessParkingIntake(context);
  }


  /// The day the car leaves. Separate from the arrival picker because the
  /// window is what the server prices - a parking entry with no end date has
  /// no amount, and the lot would be recording nothing.
  Future<void> _selectBusinessEndDate() async {
    final current = _walkUpEndDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: current == null || current.isBefore(_selectedDateTime)
          ? _selectedDateTime
          : current,
      firstDate: DateTime(_selectedDateTime.year, _selectedDateTime.month,
          _selectedDateTime.day),
      lastDate: DateTime.now().add(const Duration(days: 730)),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _walkUpEndDate = DateTime(picked.year, picked.month, picked.day, 17);
    });
  }

  void _clearWalkUpEndDate() {
    setState(() => _walkUpEndDate = null);
  }

  BusinessParkingEntryDraft _walkUpDraft(AuthProvider auth) {
    return BusinessParkingEntryDraft(
      businessId: auth.isAdmin
          ? BusinessProfile.defaultBusinessId
          : auth.businessId ?? BusinessProfile.defaultBusinessId,
      customerName: _nameController.text,
      customerPhone: _phoneController.text,
      customerEmail: _emailController.text,
      carMake: _selectedMake ?? '',
      carModel: _selectedModel ?? '',
      carYear: _selectedYear ?? '',
      vinNumber: _vinController.text,
      startDate: _selectedDateTime,
      endDate: _walkUpEndDate,
      paymentMethod: _paymentMethod,
      parkingRateId: _rateId,
    );
  }

  /// Records a walk-up through `createBusinessParkingEntry`.
  ///
  /// Deliberately not a direct Firestore write like the receipt-only path
  /// below: the callable is what prices the window from the business's own
  /// rates, checks a space is actually free, issues the PK tracking code and -
  /// on the payment-link path only - applies the platform's cut from the
  /// existing commission machinery.
  Future<void> _recordWalkUpParking() async {
    final l10n = AppLocalizations.of(context)!;
    if (!_formKey.currentState!.validate()) return;

    final draft = _walkUpDraft(context.read<AuthProvider>());
    final errors = validateBusinessParkingEntry(draft);
    if (errors.isNotEmpty) {
      showErrorSnackBar(context, businessParkingErrorSummary(l10n, errors));
      return;
    }

    setState(() => _isRecordingEntry = true);
    try {
      final result = await _businessParkingService.createEntry(draft);
      if (!mounted) return;
      setState(() => _entryResult = result);
      // Settling goes through the same callable the "payment received" button
      // uses, so a walk-up paid at the desk lands in exactly the state it
      // would have reached a minute later. If this second step fails the car
      // is still recorded and still owed - the safe way round - and staff can
      // settle it from the record.
      if (_paymentMethod == BusinessParkingPaymentMethod.direct &&
          _alreadyPaid &&
          result.entryId.isNotEmpty) {
        try {
          await _businessParkingService.markPaid(
            entryId: result.entryId,
            receivedVia: _receivedVia,
          );
          if (!mounted) return;
          showSuccessSnackBar(context, l10n.parkingRecordedAndPaid);
        } catch (_) {
          if (!mounted) return;
          showErrorSnackBar(context, l10n.parkingRecordedNotSettled);
        }
        return;
      }
      showSuccessSnackBar(
        context,
        l10n.parkedCarRecordedWithCode(result.trackingCode),
      );
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        error is FirebaseFunctionsException && (error.message ?? '').isNotEmpty
            ? error.message!
            : l10n.carCouldNotBeRecorded,
      );
    } finally {
      if (mounted) setState(() => _isRecordingEntry = false);
    }
  }

  /// Hands the payment link to the OS share sheet, so the lot can send it
  /// through whatever the customer actually uses - iMessage, WhatsApp, email.
  ///
  /// Shares `checkoutUrl`, which is the Laawol-hosted link that stays valid
  /// until the entry is paid or cancelled - never `stripeCheckoutUrl`, which
  /// is a single Stripe session and dies with it.
  Future<void> _sharePaymentLink(BusinessParkingEntryResult result) async {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency(
      locale: Localizations.localeOf(context).toString(),
      name: 'USD',
    );
    final auth = context.read<AuthProvider>();
    final message = l10n.paymentLinkShareMessage(
      auth.businessName ?? BusinessProfile.defaultBusinessName,
      [
        _selectedYear,
        _selectedMake,
        _selectedModel,
      ].where((part) => part != null && part.toString().isNotEmpty).join(' '),
      result.trackingCode,
      currency.format(result.amountDue),
      result.checkoutUrl,
    );
    try {
      await SharePlus.instance.share(ShareParams(text: message));
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.paymentLinkShareFailed);
    }
  }

  Future<void> _copyCheckoutUrl(String url) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await Clipboard.setData(ClipboardData(text: url));
      if (mounted) showSuccessSnackBar(context, l10n.paymentLinkCopied);
    } catch (_) {
      if (mounted) showErrorSnackBar(context, l10n.paymentLinkCopyFailed);
    }
  }

  /// The payment question, asked in plain words rather than in the wire
  /// values the server uses.
  Widget _buildPaymentMethodChoice(AppLocalizations l10n) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        border: Border.all(color: Colors.grey.shade300),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: 6),
          Text(
            l10n.howDoesThisParkingGetPaid,
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: Colors.grey.shade800,
            ),
          ),
          if (_rateChoices.length > 1) ...[
            _RoundedDropdownField(
              label: AppLocalizations.of(context)!.parkingPriceLabel,
              value: _rateId,
              items: [for (final choice in _rateChoices) choice.id],
              itemLabel: (id) => _rateChoices
                  .firstWhere((choice) => choice.id == id)
                  .optionLabel,
              onChanged: (value) => setState(() => _rateId = value ?? ''),
            ),
            const SizedBox(height: 16),
          ],
          RadioGroup<BusinessParkingPaymentMethod>(
            groupValue: _paymentMethod,
            onChanged: (value) {
              if (value == null) return;
              setState(() => _paymentMethod = value);
            },
            child: Column(
              children: [
                RadioListTile<BusinessParkingPaymentMethod>(
                  value: BusinessParkingPaymentMethod.direct,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    l10n.customerPaysUsDirectly,
                    style: const TextStyle(fontSize: 15),
                  ),
                ),
                RadioListTile<BusinessParkingPaymentMethod>(
                  value: BusinessParkingPaymentMethod.paymentLink,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    l10n.sendTheCustomerAPaymentLink,
                    style: const TextStyle(fontSize: 15),
                  ),
                ),
              ],
            ),
          ),
          if (_paymentMethod == BusinessParkingPaymentMethod.direct)
            Padding(
              padding: const EdgeInsets.only(left: 8, bottom: 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  RadioGroup<bool>(
                    groupValue: _alreadyPaid,
                    onChanged: (value) {
                      if (value == null) return;
                      setState(() => _alreadyPaid = value);
                    },
                    child: Column(
                      children: [
                        RadioListTile<bool>(
                          value: false,
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          title: Text(
                            l10n.parkingNotPaidYet,
                            style: const TextStyle(fontSize: 14),
                          ),
                        ),
                        RadioListTile<bool>(
                          value: true,
                          contentPadding: EdgeInsets.zero,
                          dense: true,
                          title: Text(
                            l10n.parkingAlreadyPaid,
                            style: const TextStyle(fontSize: 14),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (_alreadyPaid)
                    Padding(
                      padding: const EdgeInsets.only(top: 4, bottom: 4),
                      child: _RoundedDropdownField(
                        label: l10n.parkingHowDidTheyPay,
                        value: _receivedVia,
                        items: businessParkingReceivedViaValues,
                        itemLabel: (value) =>
                            businessParkingReceivedViaLabel(l10n, value),
                        onChanged: (value) {
                          if (value == null) return;
                          setState(() => _receivedVia = value);
                        },
                      ),
                    ),
                ],
              ),
            ),
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Text(
              _paymentMethod == BusinessParkingPaymentMethod.direct
                  ? (_alreadyPaid
                      ? l10n.directPaymentSettledExplainer
                      : l10n.directPaymentExplainer)
                  : l10n.paymentLinkExplainer,
              style: TextStyle(fontSize: 12.5, color: Colors.grey.shade600),
            ),
          ),
        ],
      ),
    );
  }

  /// What the lot needs after the entry exists: the code to write on the
  /// windscreen, the amount, and - on the link path - something to send.
  Widget _buildEntryResultPanel(AppLocalizations l10n) {
    final result = _entryResult!;
    final currency = NumberFormat.simpleCurrency(
      locale: Localizations.localeOf(context).toString(),
      name: 'USD',
    );
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 20),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFFE8F5E9),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: const Color(0xFF28A745)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.parkedCarRecorded,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 10),
          Text('${l10n.trackingNumber}: ${result.trackingCode}'),
          const SizedBox(height: 4),
          Text('${l10n.amountDue}: ${currency.format(result.amountDue)}'),
          const SizedBox(height: 10),
          if (result.isPaymentLink) ...[
            Text(
              l10n.paymentLinkShareHint,
              style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700),
            ),
            const SizedBox(height: 8),
            SelectableText(
              result.checkoutUrl,
              style: const TextStyle(fontSize: 12.5),
            ),
            const SizedBox(height: 8),
            // Share first: sending the link is what the lot actually needs to
            // do next, and copying is only useful if they then paste it
            // somewhere themselves.
            AsyncActionButton.filled(
              onPressed: result.checkoutUrl.isEmpty
                  ? null
                  : () => _sharePaymentLink(result),
              icon: Icons.ios_share,
              label: l10n.sharePaymentLink,
            ),
            const SizedBox(height: 8),
            AsyncActionButton.outlined(
              onPressed: result.checkoutUrl.isEmpty
                  ? null
                  : () => _copyCheckoutUrl(result.checkoutUrl),
              icon: Icons.copy,
              label: l10n.copyPaymentLink,
            ),
          ] else
            Text(
              l10n.directPaymentResultHint,
              style: TextStyle(fontSize: 12.5, color: Colors.grey.shade700),
            ),
        ],
      ),
    );
  }

  Widget _buildBusinessParkingIntake(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.headerGradient),
        child: SafeArea(
          child: Column(
            children: [
              // Header with back button and language toggle
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    const AppBackButton(onDarkBackground: true),
                    Expanded(
                      child: Text(
                        AppLocalizations.of(context)!.recordAParkedCar,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                        textAlign: TextAlign.center,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const LanguageToggle(),
                  ],
                ),
              ),
              // Main content
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.all(
                    MediaQuery.of(context).size.width * 0.06,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // Header Section
                      Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.06,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.2),
                          borderRadius: BorderRadius.circular(20),
                          border: Border.all(
                            color: Colors.white.withValues(alpha: 0.3),
                            width: 1,
                          ),
                        ),
                        child: Column(
                          children: [
                            Container(
                              width: 80,
                              height: 80,
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.2),
                                borderRadius: BorderRadius.circular(40),
                              ),
                              child: const Icon(
                                Icons.local_parking,
                                size: 40,
                                color: Colors.white,
                              ),
                            ),
                            const SizedBox(height: 16),
                            Text(
                              AppLocalizations.of(context)!.carParkingService,
                              style: const TextStyle(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 2,
                            ),
                            const SizedBox(height: 8),
                            Text(
                              AppLocalizations.of(
                                context,
                              )!.enterCarDetailsToGenerateReceipt,
                              style: const TextStyle(
                                fontSize: 16,
                                color: Colors.white70,
                              ),
                              textAlign: TextAlign.center,
                              overflow: TextOverflow.ellipsis,
                              maxLines: 3,
                            ),
                          ],
                        ),
                      ),

                      const SizedBox(height: 32),

                      // Form Section
                      Container(
                        padding: EdgeInsets.all(
                          MediaQuery.of(context).size.width * 0.06,
                        ),
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(20),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.1),
                              blurRadius: 20,
                              offset: const Offset(0, 10),
                            ),
                          ],
                        ),
                        child: Form(
                          key: _formKey,
                          child: Column(
                            children: [
                              if (_entryResult != null)
                                _buildEntryResultPanel(
                                  AppLocalizations.of(context)!,
                                ),
                              _RoundedTextField(
                                controller: _nameController,
                                label: AppLocalizations.of(context)!.name,
                                focusNode: _nameFocus,
                                onChanged: (value) {
                                  setState(() =>
                                      _customerSuggestions = _suggestFor(value));
                                },
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.pleaseEnterOwnerName;
                                  }
                                  return null;
                                },
                              ),
                              // The lot's memory, offered inline rather than
                              // in a menu that floats over the field being
                              // typed into. Typing a name nobody recognises
                              // is still how a new customer is added.
                              if (_customerSuggestions.isNotEmpty) ...[
                                const SizedBox(height: 8),
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: Text(
                                    AppLocalizations.of(
                                      context,
                                    )!.lotSavedCustomers,
                                    style: const TextStyle(
                                      fontSize: 11,
                                      fontWeight: FontWeight.w600,
                                      color: Color(0xFF6B7280),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Align(
                                  alignment: Alignment.centerLeft,
                                  child: Wrap(
                                    spacing: 6,
                                    runSpacing: 6,
                                    children: [
                                      for (final customer
                                          in _customerSuggestions.take(4))
                                        _CustomerSuggestionChip(
                                          key: Key(
                                            'parking-customer-${customer.id}',
                                          ),
                                          customer: customer,
                                          onTap: () =>
                                              _applyLotCustomer(customer),
                                        ),
                                    ],
                                  ),
                                ),
                              ],
                              const SizedBox(height: 16),
                              CountryPhoneField(
                                controller: _phoneController,
                                labelText: AppLocalizations.of(
                                  context,
                                )!.phoneNumber,
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.parkingErrorCustomerPhone;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 16),
                              // Optional - until a payment link has to reach
                              // someone; the shared validator enforces that.
                              _RoundedTextField(
                                controller: _emailController,
                                label: AppLocalizations.of(
                                  context,
                                )!.customerEmailOptional,
                              ),
                              const SizedBox(height: 16),
                              if (_isCatalogLoading)
                                const Padding(
                                  padding: EdgeInsets.symmetric(vertical: 24.0),
                                  child: Center(
                                    child: CircularProgressIndicator(),
                                  ),
                                )
                              else ...[
                                _RoundedDropdownField(
                                  label: AppLocalizations.of(context)!.make,
                                  value: _selectedMake,
                                  items: _makeOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedMake = value;
                                      _selectedModel = null;
                                      _selectedYear = null;
                                      _modelOptions = [];
                                      _yearOptions = [];
                                    });
                                    if (value != null) {
                                      final models = CarCatalog.instance
                                          .getModels(value);
                                      setState(() {
                                        _modelOptions = models;
                                      });
                                    }
                                  },
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarMake;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: AppLocalizations.of(context)!.model,
                                  value: _selectedModel,
                                  items: _modelOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedModel = value;
                                      _selectedYear = null;
                                      _yearOptions = [];
                                    });
                                    if (_selectedMake != null &&
                                        value != null) {
                                      final years = CarCatalog.instance
                                          .getYears(_selectedMake!, value);
                                      setState(() {
                                        _yearOptions = years;
                                      });
                                    }
                                  },
                                  enabled: _selectedMake != null,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarModel;
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: 16),
                                _RoundedDropdownField(
                                  label: AppLocalizations.of(context)!.year,
                                  value: _selectedYear,
                                  items: _yearOptions,
                                  onChanged: (value) {
                                    setState(() {
                                      _selectedYear = value;
                                    });
                                  },
                                  enabled: _selectedModel != null,
                                  validator: (value) {
                                    if (value == null || value.isEmpty) {
                                      return AppLocalizations.of(
                                        context,
                                      )!.pleaseEnterCarYear;
                                    }
                                    return null;
                                  },
                                ),
                              ],
                              const SizedBox(height: 16),
                              _RoundedTextField(
                                controller: _vinController,
                                label: AppLocalizations.of(
                                  context,
                                )!.vinNumberOptional,
                                textCapitalization:
                                    TextCapitalization.characters,
                                suffixIcon: IconButton(
                                  tooltip: AppLocalizations.of(
                                    context,
                                  )!.scanVin,
                                  onPressed: _isVinDecoding ? null : _scanVin,
                                  icon: const Icon(Icons.qr_code_scanner),
                                ),
                                // Optional, the way the console has it: a car
                                // dropped off at night with the plate out of
                                // reach still has to be recordable. A VIN that
                                // IS typed still has to be a real one.
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return null;
                                  }
                                  if (!isValidVin(value)) {
                                    return AppLocalizations.of(
                                      context,
                                    )!.invalidVinNumber;
                                  }
                                  return null;
                                },
                              ),
                              const SizedBox(height: 10),
                              Row(
                                children: [
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _isVinDecoding
                                          ? null
                                          : _decodeCurrentVin,
                                      icon: _isVinDecoding
                                          ? const SizedBox(
                                              width: 18,
                                              height: 18,
                                              child: CircularProgressIndicator(
                                                strokeWidth: 2,
                                              ),
                                            )
                                          : const Icon(Icons.manage_search),
                                      label: Text(
                                        AppLocalizations.of(context)!.decodeVin,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                                  const SizedBox(width: 10),
                                  Expanded(
                                    child: OutlinedButton.icon(
                                      onPressed: _isVinDecoding
                                          ? null
                                          : _scanVin,
                                      icon: const Icon(Icons.document_scanner),
                                      label: Text(
                                        AppLocalizations.of(context)!.scanVin,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              if (_decodedVehicleInfo != null) ...[
                                const SizedBox(height: 12),
                                _DecodedVinPanel(info: _decodedVehicleInfo!),
                              ],
                              const SizedBox(height: 16),

                              // Date & Time Selector
                              GestureDetector(
                                onTap: _selectDateTime,
                                child: Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 16,
                                  ),
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: Colors.grey.shade300,
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    color: Colors.grey.shade50,
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.calendar_today,
                                        color: Colors.grey.shade600,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.parkingDateTime,
                                              style: TextStyle(
                                                fontSize: 12,
                                                color: Colors.grey.shade600,
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              DateFormat(
                                                'MMM dd, yyyy - HH:mm',
                                              ).format(_selectedDateTime),
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Icon(
                                        Icons.arrow_drop_down,
                                        color: Colors.grey.shade600,
                                      ),
                                    ],
                                  ),
                                ),
                              ),

                              const SizedBox(height: 16),

                              // Leave date - optional. Blank means an
                              // open-ended stay billed day by day; a date
                              // prices the whole window up front.
                              GestureDetector(
                                onTap: _selectBusinessEndDate,
                                child: Container(
                                  width: double.infinity,
                                  padding: const EdgeInsets.symmetric(
                                    horizontal: 16,
                                    vertical: 16,
                                  ),
                                  decoration: BoxDecoration(
                                    border: Border.all(
                                      color: Colors.grey.shade300,
                                    ),
                                    borderRadius: BorderRadius.circular(12),
                                    color: Colors.grey.shade50,
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.event_available,
                                        color: Colors.grey.shade600,
                                        size: 20,
                                      ),
                                      const SizedBox(width: 12),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.parkingEndDateOptional,
                                              style: TextStyle(
                                                fontSize: 12,
                                                color: Colors.grey.shade600,
                                              ),
                                            ),
                                            const SizedBox(height: 4),
                                            Text(
                                              _walkUpEndDate == null
                                                  ? AppLocalizations.of(
                                                      context,
                                                    )!.parkingOpenEnded
                                                  : DateFormat.yMMMd(
                                                      Localizations.localeOf(
                                                        context,
                                                      ).toLanguageTag(),
                                                    ).format(_walkUpEndDate!),
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      if (_walkUpEndDate != null)
                                        IconButton(
                                          tooltip: AppLocalizations.of(
                                            context,
                                          )!.parkingClearEndDate,
                                          icon: Icon(
                                            Icons.close,
                                            color: Colors.grey.shade600,
                                            size: 20,
                                          ),
                                          onPressed: _clearWalkUpEndDate,
                                        )
                                      else
                                        Icon(
                                          Icons.arrow_drop_down,
                                          color: Colors.grey.shade600,
                                        ),
                                    ],
                                  ),
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                AppLocalizations.of(
                                  context,
                                )!.parkingOpenEndedHint,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: Colors.grey.shade600,
                                ),
                              ),

                              const SizedBox(height: 16),
                              _buildPaymentMethodChoice(
                                AppLocalizations.of(context)!,
                              ),

                              const SizedBox(height: 24),
                              SizedBox(
                                width: double.infinity,
                                height: 56,
                                child: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: AppColors.brandRed,
                                    foregroundColor: Colors.white,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12),
                                    ),
                                    elevation: 0,
                                    splashFactory: NoSplash.splashFactory,
                                  ),
                                  onPressed: _isRecordingEntry
                                      ? null
                                      : _recordWalkUpParking,
                                  child: _isRecordingEntry
                                      ? Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            const SizedBox(
                                              width: 20,
                                              height: 20,
                                              child:
                                                  CircularProgressIndicator(
                                                    strokeWidth: 2,
                                                    valueColor:
                                                        AlwaysStoppedAnimation<
                                                          Color
                                                        >(Colors.white),
                                                  ),
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.recordingParkedCar,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w600,
                                              ),
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ],
                                        )
                                      : Row(
                                          mainAxisAlignment:
                                              MainAxisAlignment.center,
                                          children: [
                                            const Icon(
                                              Icons.local_parking,
                                              size: 20,
                                            ),
                                            const SizedBox(width: 8),
                                            Text(
                                              AppLocalizations.of(
                                                context,
                                              )!.recordTheCar,
                                              style: const TextStyle(
                                                fontSize: 16,
                                                fontWeight: FontWeight.w600,
                                              ),
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ],
                                        ),
                                ),
                              ),
                              const SizedBox(height: 12),
                              // The paper-only path a lot already had. Kept
                              // because it works when the business has no
                              // parking rates configured yet, which the
                              // callable correctly refuses to price.
                              SizedBox(
                                width: double.infinity,
                                child: AsyncActionButton.outlined(
                                  onPressed: (_isLoading || _isRecordingEntry)
                                      ? null
                                      : _saveAndPrintReceipt,
                                  icon: Icons.print,
                                  label: AppLocalizations.of(
                                    context,
                                  )!.printReceiptOnly,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildCustomerParkingReservation(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final currency = NumberFormat.simpleCurrency(
      locale: Localizations.localeOf(context).toString(),
      name: 'USD',
    );
    final dateFormat = DateFormat.yMMMd(
      Localizations.localeOf(context).toLanguageTag(),
    );

    if (_nameController.text.isEmpty && auth.buyerName != 'Customer') {
      _nameController.text = auth.buyerName;
    }
    if (_phoneController.text.isEmpty &&
        (auth.customerPhone ?? '').isNotEmpty) {
      _phoneController.text = auth.customerPhone!;
    }

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: Column(
            children: [
              _buildParkingWizardHeader(context, l10n),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 20),
                  children: [
                    _buildParkingStepBody(context, l10n, currency, dateFormat),
                  ],
                ),
              ),
              _buildParkingWizardFooter(context, l10n),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildParkingWizardHeader(
    BuildContext context,
    AppLocalizations l10n,
  ) {
    final titles = [
      l10n.parkingStepWhereWhen,
      l10n.parkingStepChooseSpot,
      l10n.parkingStepYourCar,
      l10n.parkingStepReview,
    ];
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AppBackButton(onPressed: _parkingBack),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.customerParkingTitle,
                  style: Theme.of(
                    context,
                  ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
                ),
              ),
              const LanguageToggle(),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              for (int i = 0; i < titles.length; i++) ...[
                Expanded(
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    height: 6,
                    decoration: BoxDecoration(
                      color: i <= _customerStep
                          ? AppColors.cobalt
                          : AppColors.rule,
                      borderRadius: BorderRadius.circular(3),
                    ),
                  ),
                ),
                if (i < titles.length - 1) const SizedBox(width: 6),
              ],
            ],
          ),
          const SizedBox(height: 10),
          Text(
            '${l10n.parkingStepIndicator(_customerStep + 1, titles.length)} · ${titles[_customerStep]}',
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w800,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildParkingStepBody(
    BuildContext context,
    AppLocalizations l10n,
    NumberFormat currency,
    DateFormat dateFormat,
  ) {
    switch (_customerStep) {
      case 0:
        return _buildParkingWhereWhenStep(context, l10n, dateFormat);
      case 1:
        return _buildParkingChooseSpotStep(context, l10n, currency);
      case 2:
        return _buildParkingCarStep(context, l10n);
      default:
        return _buildParkingReviewStep(context, l10n, currency, dateFormat);
    }
  }

  Widget _buildParkingWhereWhenStep(
    BuildContext context,
    AppLocalizations l10n,
    DateFormat dateFormat,
  ) {
    return _CustomerParkingPanel(
      title: l10n.parkingStepWhereWhen,
      subtitle: l10n.customerParkingSubtitle,
      child: Column(
        children: [
          // The old picker offered every city in the country, so almost every
          // choice led nowhere. These two are built from the lots that
          // actually exist, and the list underneath means a customer who
          // knows no town at all can still just look.
          if (_browseStates.isNotEmpty) ...[
            _RoundedDropdownField(
              label: l10n.parkingState,
              value: _browseState.isEmpty ? null : _browseState,
              items: _browseStates,
              onChanged: (value) {
                setState(() {
                  _browseState = value ?? '';
                  _browseCity = '';
                  _parkingCityController.text = '';
                  _parkingOptions = const [];
                  _selectedParkingOption = null;
                });
              },
            ),
            const SizedBox(height: 12),
          ],
          _RoundedDropdownField(
            label: l10n.parkingCity,
            value: _browseCity.isEmpty ? null : _browseCity,
            items: _browseCities,
            onChanged: (value) {
              setState(() {
                _browseCity = value ?? '';
                _parkingCityController.text = _browseCity;
                _parkingOptions = const [];
                _selectedParkingOption = null;
              });
            },
          ),
          if (_browsedPlaces.isNotEmpty) ...[
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: Text(
                l10n.parkingPlacesNearby(_browsedPlaces.length),
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: Colors.grey.shade700,
                ),
              ),
            ),
            const SizedBox(height: 6),
            ..._browsedPlaces.take(8).map(
                  (place) => _ParkingPlaceTile(
                    place: place,
                    selected: _selectedParkingOption?.businessId ==
                        place.businessId,
                    onTap: _isSearchingParking
                        ? () {}
                        : () => _chooseBrowsedPlace(place),
                  ),
                ),
          ],
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _ParkingDateTile(
                  label: l10n.parkingStart,
                  value: dateFormat.format(_selectedDateTime),
                  onTap: () => _selectCustomerParkingDate(isStart: true),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _ParkingDateTile(
                  label: l10n.parkingEnd,
                  value: dateFormat.format(_selectedEndDateTime),
                  onTap: () => _selectCustomerParkingDate(isStart: false),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          CheckboxListTile(
            contentPadding: EdgeInsets.zero,
            value: _pickupRequested,
            onChanged: (value) {
              setState(() {
                _pickupRequested = value ?? false;
                _parkingOptions = const [];
                _selectedParkingOption = null;
              });
            },
            title: Text(l10n.parkingPickupOptional),
          ),
          SizedBox(
            width: double.infinity,
            child: AsyncActionButton.outlined(
              onPressed: _isLocating ? null : _locateCustomerForParking,
              icon: Icons.my_location_outlined,
              label: _customerLatitude == null
                  ? l10n.useMyCurrentLocation
                  : l10n.currentLocationAdded,
              loadingLabel: l10n.gettingYourLocation,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildParkingChooseSpotStep(
    BuildContext context,
    AppLocalizations l10n,
    NumberFormat currency,
  ) {
    if (_isSearchingParking) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(40),
          child: CircularProgressIndicator(),
        ),
      );
    }
    if (_parkingOptions.isEmpty) {
      return Column(
        children: [
          const SizedBox(height: 8),
          _InlineParkingNotice(message: l10n.noParkingBusinesses),
        ],
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.availableParkingBusinesses,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
        ),
        const SizedBox(height: 10),
        for (final option in _parkingOptions) ...[
          _ParkingOptionCard(
            option: option,
            selected: option.businessId == _selectedParkingOption?.businessId,
            currency: currency,
            l10n: l10n,
            onTap: () => setState(() => _selectedParkingOption = option),
          ),
          const SizedBox(height: 10),
        ],
      ],
    );
  }

  Widget _buildParkingCarStep(BuildContext context, AppLocalizations l10n) {
    return _CustomerParkingPanel(
      title: l10n.carInformation,
      subtitle: l10n.enterCarDetailsToReserveParking,
      child: Column(
        children: [
          _RoundedTextField(
            controller: _nameController,
            label: l10n.name,
            textCapitalization: TextCapitalization.words,
            validator: (value) => value == null || value.isEmpty
                ? l10n.pleaseEnterOwnerName
                : null,
          ),
          const SizedBox(height: 12),
          CountryPhoneField(
            controller: _phoneController,
            labelText: l10n.phoneNumber,
            decoration: InputDecoration(
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: BorderSide(color: Colors.grey.shade300),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(
                  color: AppColors.brandRed,
                  width: 2,
                ),
              ),
              errorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(12),
                borderSide: const BorderSide(color: Colors.red, width: 2),
              ),
              filled: true,
              fillColor: Colors.grey.shade50,
            ),
            validator: (value) => value == null || value.trim().isEmpty
                ? l10n.phoneNumberRequired
                : null,
          ),
          const SizedBox(height: 12),
          if (_isCatalogLoading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(child: CircularProgressIndicator()),
            )
          else ...[
            _RoundedDropdownField(
              label: l10n.make,
              value: _selectedMake,
              items: _makeOptions,
              onChanged: (value) {
                setState(() {
                  _selectedMake = value;
                  _selectedModel = null;
                  _selectedYear = null;
                  _modelOptions = value == null
                      ? []
                      : CarCatalog.instance.getModels(value);
                  _yearOptions = [];
                });
              },
              validator: (value) => value == null || value.isEmpty
                  ? l10n.pleaseEnterCarMake
                  : null,
            ),
            const SizedBox(height: 12),
            _RoundedDropdownField(
              label: l10n.model,
              value: _selectedModel,
              items: _modelOptions,
              enabled: _selectedMake != null,
              onChanged: (value) {
                setState(() {
                  _selectedModel = value;
                  _selectedYear = null;
                  _yearOptions = _selectedMake == null || value == null
                      ? []
                      : CarCatalog.instance.getYears(_selectedMake!, value);
                });
              },
              validator: (value) => value == null || value.isEmpty
                  ? l10n.pleaseEnterCarModel
                  : null,
            ),
            const SizedBox(height: 12),
            _RoundedDropdownField(
              label: l10n.year,
              value: _selectedYear,
              items: _yearOptions,
              enabled: _selectedModel != null,
              onChanged: (value) => setState(() => _selectedYear = value),
              validator: (value) => value == null || value.isEmpty
                  ? l10n.pleaseEnterCarYear
                  : null,
            ),
          ],
          const SizedBox(height: 12),
          _RoundedTextField(
            controller: _vinController,
            label: l10n.vinNumber,
            textCapitalization: TextCapitalization.characters,
            suffixIcon: IconButton(
              tooltip: l10n.scanVin,
              onPressed: _isVinDecoding ? null : _scanVin,
              icon: const Icon(Icons.qr_code_scanner),
            ),
            validator: (value) {
              if (value == null || value.trim().isEmpty) {
                return l10n.pleaseEnterVinNumber;
              }
              if (!isValidVin(value)) {
                return l10n.invalidVinNumber;
              }
              return null;
            },
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _isVinDecoding ? null : _decodeCurrentVin,
                  icon: _isVinDecoding
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.manage_search),
                  label: Text(l10n.decodeVin, overflow: TextOverflow.ellipsis),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _isVinDecoding ? null : _scanVin,
                  icon: const Icon(Icons.document_scanner),
                  label: Text(l10n.scanVin, overflow: TextOverflow.ellipsis),
                ),
              ),
            ],
          ),
          if (_decodedVehicleInfo != null) ...[
            const SizedBox(height: 12),
            _DecodedVinPanel(info: _decodedVehicleInfo!),
          ],
        ],
      ),
    );
  }

  Widget _buildParkingReviewStep(
    BuildContext context,
    AppLocalizations l10n,
    NumberFormat currency,
    DateFormat dateFormat,
  ) {
    final option = _selectedParkingOption;
    final vehicle = [
      _selectedYear,
      _selectedMake,
      _selectedModel,
    ].whereType<String>().where((part) => part.isNotEmpty).join(' ');
    return _CustomerParkingPanel(
      title: l10n.parkingReviewHeading,
      subtitle: l10n.customerParkingSubtitle,
      child: Column(
        children: [
          if (option != null) ...[
            _ParkingReviewRow(
              icon: Icons.local_parking_outlined,
              label: option.businessName,
              value: l10n.parkingPricePerDay(
                currency.format(option.pricing.dailyRate),
              ),
            ),
            const _ParkingReviewDivider(),
          ],
          _ParkingReviewRow(
            icon: Icons.place_outlined,
            label: l10n.parkingCity,
            value: _parkingCityController.text.trim(),
          ),
          const _ParkingReviewDivider(),
          _ParkingReviewRow(
            icon: Icons.event_outlined,
            label: l10n.parkingReviewDates,
            value:
                '${dateFormat.format(_selectedDateTime)} → ${dateFormat.format(_selectedEndDateTime)}',
          ),
          const _ParkingReviewDivider(),
          _ParkingReviewRow(
            icon: Icons.directions_car_outlined,
            label: l10n.parkingReviewVehicle,
            value: vehicle.isEmpty ? '—' : vehicle,
          ),
          const _ParkingReviewDivider(),
          _ParkingReviewRow(
            icon: Icons.badge_outlined,
            label: l10n.vinNumber,
            value: normalizeVin(_vinController.text),
          ),
          const _ParkingReviewDivider(),
          _ParkingReviewRow(
            icon: Icons.local_shipping_outlined,
            label: l10n.parkingPickupOptional,
            value: _pickupRequested
                ? l10n.parkingReviewPickupYes
                : l10n.parkingReviewPickupNo,
          ),
          if (option != null) ...[
            const SizedBox(height: 14),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: AppColors.mist.withValues(alpha: 0.42),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Text(
                l10n.parkingEstimatedTotal(
                  currency.format(option.estimatedTotal),
                ),
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.cobaltDeep,
                  fontSize: 15,
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildParkingWizardFooter(
    BuildContext context,
    AppLocalizations l10n,
  ) {
    Widget primary;
    switch (_customerStep) {
      case 0:
        primary = AsyncActionButton.filled(
          onPressed: _isSearchingParking ? null : _findParkingAndAdvance,
          icon: Icons.search,
          label: l10n.searchParking,
          loadingLabel: l10n.searchingParking,
        );
        break;
      case 1:
        primary = FilledButton.icon(
          onPressed: _selectedParkingOption == null
              ? null
              : () => _goToParkingStep(2),
          icon: const Icon(Icons.arrow_forward),
          label: Text(l10n.parkingContinue),
        );
        break;
      case 2:
        primary = FilledButton.icon(
          onPressed: () {
            if (_formKey.currentState?.validate() ?? false) {
              _goToParkingStep(3);
            }
          },
          icon: const Icon(Icons.arrow_forward),
          label: Text(l10n.parkingContinue),
        );
        break;
      default:
        primary = AsyncActionButton.filled(
          onPressed: _isLoading ? null : _reserveCustomerParking,
          icon: Icons.local_parking_outlined,
          label: l10n.reserveParking,
          loadingLabel: l10n.reservingParking,
        );
    }
    return Container(
      padding: EdgeInsets.fromLTRB(
        20,
        12,
        20,
        12 + MediaQuery.of(context).padding.bottom,
      ),
      decoration: const BoxDecoration(
        color: AppColors.paper,
        border: Border(top: BorderSide(color: AppColors.rule)),
      ),
      child: Row(
        children: [
          if (_customerStep > 0) ...[
            OutlinedButton(
              onPressed: _parkingBack,
              child: Text(l10n.parkingBack),
            ),
            const SizedBox(width: 12),
          ],
          Expanded(child: primary),
        ],
      ),
    );
  }
}

/// One place to park, as a customer browsing sees it: who it is, where it is,
/// how far away, and what a day costs. Distance only appears when the
/// customer has shared their location - an invented number is worse than none.
class _ParkingPlaceTile extends StatelessWidget {
  const _ParkingPlaceTile({
    required this.place,
    required this.selected,
    required this.onTap,
  });

  final ParkingBusinessOption place;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final where = [place.city, place.state]
        .map((part) => part.trim())
        .where((part) => part.isNotEmpty)
        .join(', ');
    final miles = place.distanceMiles;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: selected ? const Color(0xFFF1F5F9) : Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: selected
                  ? const Color(0xFF1D4ED8).withValues(alpha: 0.45)
                  : Colors.grey.shade300,
            ),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      place.businessName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 13.5,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    if (where.isNotEmpty)
                      Text(
                        where,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11.5,
                          color: Colors.grey.shade600,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    '\$${place.pricing.dailyRate.toStringAsFixed(0)}/day',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  if (miles != null)
                    Text(
                      '${miles.toStringAsFixed(miles < 10 ? 1 : 0)} mi away',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade600,
                      ),
                    )
                  else if (place.availableSpaces > 0)
                    Text(
                      '${place.availableSpaces} free',
                      style: TextStyle(
                        fontSize: 11,
                        color: Colors.grey.shade600,
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// One remembered customer, offered as something to tap. It shows the phone
/// under the name because two people share a name more often than a number.
class _CustomerSuggestionChip extends StatelessWidget {
  const _CustomerSuggestionChip({
    super.key,
    required this.customer,
    required this.onTap,
  });

  final LotCustomer customer;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final detail = customer.phone.isNotEmpty
        ? customer.phone
        : (customer.cars.isNotEmpty ? customer.cars.first.label : '');
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(10),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
        decoration: BoxDecoration(
          color: const Color(0xFFF1F5F9),
          borderRadius: BorderRadius.circular(10),
          border: Border.all(color: const Color(0xFF1D4ED8).withValues(alpha: 0.3)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              customer.staff ? '${customer.name} · Staff' : customer.name,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Color(0xFF1E3A8A),
              ),
            ),
            if (detail.isNotEmpty)
              Text(
                detail,
                style: const TextStyle(fontSize: 10.5, color: Color(0xFF6B7280)),
              ),
          ],
        ),
      ),
    );
  }
}

class _RoundedTextField extends StatelessWidget {
  final String label;
  final TextEditingController? controller;
  final String? Function(String?)? validator;
  final Widget? suffixIcon;
  final TextCapitalization textCapitalization;
  final ValueChanged<String>? onChanged;
  final FocusNode? focusNode;

  const _RoundedTextField({
    required this.label,
    this.controller,
    this.validator,
    this.suffixIcon,
    this.textCapitalization = TextCapitalization.none,
    this.onChanged,
    this.focusNode,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      focusNode: focusNode,
      validator: validator,
      onChanged: onChanged,
      textCapitalization: textCapitalization,
      decoration: InputDecoration(
        labelText: label,
        suffixIcon: suffixIcon,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        filled: true,
        fillColor: Colors.grey.shade50,
      ),
    );
  }
}

class _DecodedVinPanel extends StatelessWidget {
  const _DecodedVinPanel({required this.info});

  final DecodedVehicleInfo info;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final rows = <MapEntry<String, String>>[
      if (info.summary.isNotEmpty) MapEntry(l10n.vehicle, info.summary),
      if (info.bodyClass?.isNotEmpty == true)
        MapEntry(l10n.bodyStyle, info.bodyClass!),
      if (info.engine?.isNotEmpty == true) MapEntry(l10n.engine, info.engine!),
      if (info.fuelType?.isNotEmpty == true)
        MapEntry(l10n.fuelType, info.fuelType!),
    ];

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.brandRed.withValues(alpha: 0.06),
        border: Border.all(color: AppColors.brandRed.withValues(alpha: 0.22)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.fact_check_outlined, color: AppColors.brandRed),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  l10n.decodedVinDetails,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          for (final row in rows)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('${row.key}: ${row.value}'),
            ),
        ],
      ),
    );
  }
}

class _RoundedDropdownField extends StatelessWidget {
  final String label;
  final String? value;
  final List<String> items;
  final ValueChanged<String?>? onChanged;
  final String? Function(String?)? validator;
  final bool enabled;

  /// How an item reads to a person. Makes, models and years are already the
  /// words on the screen; a stored value like "card_in_person" is not.
  final String Function(String value)? itemLabel;

  const _RoundedDropdownField({
    required this.label,
    required this.items,
    this.value,
    this.onChanged,
    this.validator,
    this.enabled = true,
    this.itemLabel,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<String>(
      key: ValueKey<String?>(enabled ? value : null),
      initialValue: enabled ? value : null,
      onChanged: enabled ? onChanged : null,
      validator: validator,
      isExpanded: true,
      items: items
          .map(
            (item) => DropdownMenuItem<String>(
              value: item,
              child: Text(itemLabel != null ? itemLabel!(item) : item),
            ),
          )
          .toList(),
      decoration: InputDecoration(
        labelText: label,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Colors.red, width: 2),
        ),
        filled: true,
        fillColor: Colors.grey.shade50,
      ),
      icon: const Icon(Icons.arrow_drop_down),
      dropdownColor: Colors.white,
    );
  }
}

class _CustomerParkingPanel extends StatelessWidget {
  const _CustomerParkingPanel({
    required this.title,
    required this.subtitle,
    required this.child,
  });

  final String title;
  final String subtitle;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: Theme.of(
              context,
            ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            style: const TextStyle(
              color: AppColors.muted,
              height: 1.25,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 16),
          child,
        ],
      ),
    );
  }
}

class _ParkingDateTile extends StatelessWidget {
  const _ParkingDateTile({
    required this.label,
    required this.value,
    required this.onTap,
  });

  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: AppColors.lightSurfaceVariant,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            const Icon(Icons.event_outlined, size: 20, color: AppColors.cobalt),
            const SizedBox(width: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    value,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ParkingOptionCard extends StatelessWidget {
  const _ParkingOptionCard({
    required this.option,
    required this.selected,
    required this.currency,
    required this.l10n,
    required this.onTap,
  });

  final ParkingBusinessOption option;
  final bool selected;
  final NumberFormat currency;
  final AppLocalizations l10n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(8),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected
              ? AppColors.mist.withValues(alpha: 0.42)
              : AppColors.paper,
          borderRadius: BorderRadius.circular(8),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.4 : 1,
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.cobalt.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(
                    Icons.local_parking_outlined,
                    color: AppColors.cobaltDeep,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        option.businessName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w900,
                          color: AppColors.ink,
                        ),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        [
                          option.address,
                          option.city,
                        ].where((part) => part.isNotEmpty).join(', '),
                        style: const TextStyle(
                          color: AppColors.muted,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
                Icon(
                  selected
                      ? Icons.radio_button_checked
                      : Icons.radio_button_off,
                  color: selected ? AppColors.cobalt : AppColors.muted,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _ParkingChip(
                  icon: Icons.directions_car_outlined,
                  label: l10n.availableSpacesCount(option.availableSpaces),
                ),
                _ParkingChip(
                  icon: Icons.attach_money,
                  label: l10n.parkingPricePerDay(
                    currency.format(option.pricing.dailyRate),
                  ),
                ),
                if (option.distanceMiles != null)
                  _ParkingChip(
                    icon: Icons.near_me_outlined,
                    label: l10n.parkingDistanceMiles(
                      option.distanceMiles!.toStringAsFixed(1),
                    ),
                  ),
                if (option.pickupAvailable)
                  _ParkingChip(
                    icon: Icons.local_shipping_outlined,
                    label: l10n.pickupAvailable,
                  ),
              ],
            ),
            const SizedBox(height: 10),
            Text(
              l10n.parkingEstimatedTotal(
                currency.format(option.estimatedTotal),
              ),
              style: const TextStyle(
                color: AppColors.cobaltDeep,
                fontWeight: FontWeight.w900,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ParkingChip extends StatelessWidget {
  const _ParkingChip({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
      decoration: BoxDecoration(
        color: AppColors.lightSurfaceVariant,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 16, color: AppColors.cobalt),
          const SizedBox(width: 6),
          Text(
            label,
            style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800),
          ),
        ],
      ),
    );
  }
}

class _InlineParkingNotice extends StatelessWidget {
  const _InlineParkingNotice({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.saffron.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.saffron.withValues(alpha: 0.35)),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: AppColors.ink,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _ParkingReviewRow extends StatelessWidget {
  const _ParkingReviewRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 20, color: AppColors.cobalt),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 12),
          Flexible(
            child: Text(
              value.isEmpty ? '—' : value,
              textAlign: TextAlign.right,
              style: const TextStyle(
                color: AppColors.ink,
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ParkingReviewDivider extends StatelessWidget {
  const _ParkingReviewDivider();

  @override
  Widget build(BuildContext context) {
    return const Divider(height: 1, color: AppColors.rule);
  }
}
