import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:intl/intl.dart' as intl;

import 'app_localizations_en.dart';
import 'app_localizations_fr.dart';

// ignore_for_file: type=lint

/// Callers can lookup localized strings with an instance of AppLocalizations
/// returned by `AppLocalizations.of(context)`.
///
/// Applications need to include `AppLocalizations.delegate()` in their app's
/// `localizationDelegates` list, and the locales they support in the app's
/// `supportedLocales` list. For example:
///
/// ```dart
/// import 'l10n/app_localizations.dart';
///
/// return MaterialApp(
///   localizationsDelegates: AppLocalizations.localizationsDelegates,
///   supportedLocales: AppLocalizations.supportedLocales,
///   home: MyApplicationHome(),
/// );
/// ```
///
/// ## Update pubspec.yaml
///
/// Please make sure to update your pubspec.yaml to include the following
/// packages:
///
/// ```yaml
/// dependencies:
///   # Internationalization support.
///   flutter_localizations:
///     sdk: flutter
///   intl: any # Use the pinned version from flutter_localizations
///
///   # Rest of dependencies
/// ```
///
/// ## iOS Applications
///
/// iOS applications define key application metadata, including supported
/// locales, in an Info.plist file that is built into the application bundle.
/// To configure the locales supported by your app, you’ll need to edit this
/// file.
///
/// First, open your project’s ios/Runner.xcworkspace Xcode workspace file.
/// Then, in the Project Navigator, open the Info.plist file under the Runner
/// project’s Runner folder.
///
/// Next, select the Information Property List item, select Add Item from the
/// Editor menu, then select Localizations from the pop-up menu.
///
/// Select and expand the newly-created Localizations item then, for each
/// locale your application supports, add a new item and select the locale
/// you wish to add from the pop-up menu in the Value field. This list should
/// be consistent with the languages listed in the AppLocalizations.supportedLocales
/// property.
abstract class AppLocalizations {
  AppLocalizations(String locale)
    : localeName = intl.Intl.canonicalizedLocale(locale.toString());

  final String localeName;

  static AppLocalizations? of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations);
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  /// A list of this localizations delegate along with the default localizations
  /// delegates.
  ///
  /// Returns a list of localizations delegates containing this delegate along with
  /// GlobalMaterialLocalizations.delegate, GlobalCupertinoLocalizations.delegate,
  /// and GlobalWidgetsLocalizations.delegate.
  ///
  /// Additional delegates can be added by appending to this list in
  /// MaterialApp. This list does not have to be used at all if a custom list
  /// of delegates is preferred or required.
  static const List<LocalizationsDelegate<dynamic>> localizationsDelegates =
      <LocalizationsDelegate<dynamic>>[
        delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ];

  /// A list of this localizations delegate's supported locales.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('fr'),
  ];

  /// No description provided for @welcomeBack.
  ///
  /// In en, this message translates to:
  /// **'Welcome Back'**
  String get welcomeBack;

  /// No description provided for @signInToAccount.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account'**
  String get signInToAccount;

  /// No description provided for @accountLoginTitle.
  ///
  /// In en, this message translates to:
  /// **'Account Login'**
  String get accountLoginTitle;

  /// No description provided for @accountLoginSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to access saved receipts, track activity, and manage staff tools.'**
  String get accountLoginSubtitle;

  /// No description provided for @email.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get email;

  /// No description provided for @enterEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter your email'**
  String get enterEmail;

  /// No description provided for @password.
  ///
  /// In en, this message translates to:
  /// **'Password'**
  String get password;

  /// No description provided for @enterPassword.
  ///
  /// In en, this message translates to:
  /// **'Enter your password'**
  String get enterPassword;

  /// No description provided for @signIn.
  ///
  /// In en, this message translates to:
  /// **'Sign In'**
  String get signIn;

  /// No description provided for @forgotPassword.
  ///
  /// In en, this message translates to:
  /// **'Forgot Password?'**
  String get forgotPassword;

  /// No description provided for @pleaseEnterEmail.
  ///
  /// In en, this message translates to:
  /// **'Please enter your email'**
  String get pleaseEnterEmail;

  /// No description provided for @pleaseEnterValidEmail.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid email'**
  String get pleaseEnterValidEmail;

  /// No description provided for @pleaseEnterPassword.
  ///
  /// In en, this message translates to:
  /// **'Please enter your password'**
  String get pleaseEnterPassword;

  /// No description provided for @passwordMinLength.
  ///
  /// In en, this message translates to:
  /// **'Password must be at least 6 characters'**
  String get passwordMinLength;

  /// No description provided for @forgotPasswordTitle.
  ///
  /// In en, this message translates to:
  /// **'Forgot Password?'**
  String get forgotPasswordTitle;

  /// No description provided for @enterEmailToReset.
  ///
  /// In en, this message translates to:
  /// **'Enter your email to reset your password'**
  String get enterEmailToReset;

  /// No description provided for @resetPassword.
  ///
  /// In en, this message translates to:
  /// **'Reset Password'**
  String get resetPassword;

  /// No description provided for @backToLogin.
  ///
  /// In en, this message translates to:
  /// **'Back to Login'**
  String get backToLogin;

  /// No description provided for @emailSent.
  ///
  /// In en, this message translates to:
  /// **'Email Sent!'**
  String get emailSent;

  /// No description provided for @emailSentMessage.
  ///
  /// In en, this message translates to:
  /// **'We\'ve sent a password reset link to your email address. Please check your inbox and follow the instructions.'**
  String get emailSentMessage;

  /// No description provided for @language.
  ///
  /// In en, this message translates to:
  /// **'Language'**
  String get language;

  /// No description provided for @english.
  ///
  /// In en, this message translates to:
  /// **'English'**
  String get english;

  /// No description provided for @french.
  ///
  /// In en, this message translates to:
  /// **'French'**
  String get french;

  /// No description provided for @welcomeToBusinessServices.
  ///
  /// In en, this message translates to:
  /// **'Welcome to Business Services'**
  String get welcomeToBusinessServices;

  /// No description provided for @chooseServiceToStart.
  ///
  /// In en, this message translates to:
  /// **'Choose a service to get started'**
  String get chooseServiceToStart;

  /// No description provided for @servicesTab.
  ///
  /// In en, this message translates to:
  /// **'Services'**
  String get servicesTab;

  /// No description provided for @activityTab.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get activityTab;

  /// No description provided for @serviceOverview.
  ///
  /// In en, this message translates to:
  /// **'Service Overview'**
  String get serviceOverview;

  /// No description provided for @parkACar.
  ///
  /// In en, this message translates to:
  /// **'Park a Car'**
  String get parkACar;

  /// No description provided for @sendBarrelsToGuinea.
  ///
  /// In en, this message translates to:
  /// **'Send Barrels to Guinea'**
  String get sendBarrelsToGuinea;

  /// No description provided for @transportCarsToGuinea.
  ///
  /// In en, this message translates to:
  /// **'Transport Cars to Guinea'**
  String get transportCarsToGuinea;

  /// No description provided for @sellCars.
  ///
  /// In en, this message translates to:
  /// **'Sell Cars'**
  String get sellCars;

  /// No description provided for @carParkingService.
  ///
  /// In en, this message translates to:
  /// **'Car Parking Service'**
  String get carParkingService;

  /// No description provided for @enterCarDetailsToGenerateReceipt.
  ///
  /// In en, this message translates to:
  /// **'Enter car details to generate receipt'**
  String get enterCarDetailsToGenerateReceipt;

  /// No description provided for @printReceipt.
  ///
  /// In en, this message translates to:
  /// **'Print Receipt'**
  String get printReceipt;

  /// No description provided for @name.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get name;

  /// No description provided for @make.
  ///
  /// In en, this message translates to:
  /// **'Make'**
  String get make;

  /// No description provided for @model.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get model;

  /// No description provided for @year.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get year;

  /// No description provided for @vinNumber.
  ///
  /// In en, this message translates to:
  /// **'VIN Number'**
  String get vinNumber;

  /// No description provided for @scanVin.
  ///
  /// In en, this message translates to:
  /// **'Scan VIN'**
  String get scanVin;

  /// No description provided for @decodeVin.
  ///
  /// In en, this message translates to:
  /// **'Decode VIN'**
  String get decodeVin;

  /// No description provided for @scanVinText.
  ///
  /// In en, this message translates to:
  /// **'Scan VIN text'**
  String get scanVinText;

  /// No description provided for @scanVinInstructions.
  ///
  /// In en, this message translates to:
  /// **'Align the VIN barcode inside the frame. If there is no barcode, use text scan.'**
  String get scanVinInstructions;

  /// No description provided for @useManualEntry.
  ///
  /// In en, this message translates to:
  /// **'Use manual entry'**
  String get useManualEntry;

  /// No description provided for @vinScanNoResult.
  ///
  /// In en, this message translates to:
  /// **'No VIN was found. Try again or enter it manually.'**
  String get vinScanNoResult;

  /// No description provided for @vinScanFailed.
  ///
  /// In en, this message translates to:
  /// **'VIN scan failed. Try again or enter it manually.'**
  String get vinScanFailed;

  /// No description provided for @vinCameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Camera is unavailable. You can still enter the VIN manually.'**
  String get vinCameraUnavailable;

  /// No description provided for @invalidVinNumber.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid 17-character VIN without I, O, or Q.'**
  String get invalidVinNumber;

  /// No description provided for @vinDecodeFailed.
  ///
  /// In en, this message translates to:
  /// **'VIN could not be decoded. You can still enter the vehicle details manually.'**
  String get vinDecodeFailed;

  /// No description provided for @vinDecoded.
  ///
  /// In en, this message translates to:
  /// **'VIN decoded.'**
  String get vinDecoded;

  /// No description provided for @vinDecodedVehicle.
  ///
  /// In en, this message translates to:
  /// **'VIN decoded: {vehicle}'**
  String vinDecodedVehicle(Object vehicle);

  /// No description provided for @vinMatchReview.
  ///
  /// In en, this message translates to:
  /// **'Review the decoded details and complete any fields that did not match the catalog.'**
  String get vinMatchReview;

  /// No description provided for @decodedVinDetails.
  ///
  /// In en, this message translates to:
  /// **'Decoded VIN details'**
  String get decodedVinDetails;

  /// No description provided for @vehicle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle'**
  String get vehicle;

  /// No description provided for @bodyStyle.
  ///
  /// In en, this message translates to:
  /// **'Body style'**
  String get bodyStyle;

  /// No description provided for @engine.
  ///
  /// In en, this message translates to:
  /// **'Engine'**
  String get engine;

  /// No description provided for @parkingDate.
  ///
  /// In en, this message translates to:
  /// **'Parking Date'**
  String get parkingDate;

  /// No description provided for @parkingDateTime.
  ///
  /// In en, this message translates to:
  /// **'Parking Date & Time'**
  String get parkingDateTime;

  /// No description provided for @selectDateTime.
  ///
  /// In en, this message translates to:
  /// **'Select Date & Time'**
  String get selectDateTime;

  /// No description provided for @receiptGenerated.
  ///
  /// In en, this message translates to:
  /// **'Receipt generated and sent to printer successfully!'**
  String get receiptGenerated;

  /// No description provided for @errorGeneratingReceipt.
  ///
  /// In en, this message translates to:
  /// **'Error generating receipt: {error}'**
  String errorGeneratingReceipt(Object error);

  /// No description provided for @pleaseEnterOwnerName.
  ///
  /// In en, this message translates to:
  /// **'Please enter the owner name'**
  String get pleaseEnterOwnerName;

  /// No description provided for @pleaseEnterCarMake.
  ///
  /// In en, this message translates to:
  /// **'Please enter the car make'**
  String get pleaseEnterCarMake;

  /// No description provided for @pleaseEnterCarModel.
  ///
  /// In en, this message translates to:
  /// **'Please enter the car model'**
  String get pleaseEnterCarModel;

  /// No description provided for @pleaseEnterCarYear.
  ///
  /// In en, this message translates to:
  /// **'Please enter the car year'**
  String get pleaseEnterCarYear;

  /// No description provided for @pleaseEnterVinNumber.
  ///
  /// In en, this message translates to:
  /// **'Please enter the VIN number'**
  String get pleaseEnterVinNumber;

  /// No description provided for @pleaseEnterSenderName.
  ///
  /// In en, this message translates to:
  /// **'Please enter the sender name'**
  String get pleaseEnterSenderName;

  /// No description provided for @pleaseEnterSenderAddress.
  ///
  /// In en, this message translates to:
  /// **'Please enter the sender address'**
  String get pleaseEnterSenderAddress;

  /// No description provided for @pleaseEnterReceiverName.
  ///
  /// In en, this message translates to:
  /// **'Please enter the receiver name'**
  String get pleaseEnterReceiverName;

  /// No description provided for @pleaseEnterReceiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Please enter the receiver phone number'**
  String get pleaseEnterReceiverPhone;

  /// No description provided for @pleaseEnterPrice.
  ///
  /// In en, this message translates to:
  /// **'Please enter the price'**
  String get pleaseEnterPrice;

  /// No description provided for @pleaseEnterValidNumber.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid number'**
  String get pleaseEnterValidNumber;

  /// No description provided for @shipmentSavedWithTracking.
  ///
  /// In en, this message translates to:
  /// **'Shipment saved. Tracking number: {trackingCode}'**
  String shipmentSavedWithTracking(Object trackingCode);

  /// No description provided for @shipmentSavedReceiptUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Shipment saved. Tracking number: {trackingCode}. The receipt could not be opened, but your payment and shipment are safe.'**
  String shipmentSavedReceiptUnavailable(Object trackingCode);

  /// No description provided for @failedToSaveShipment.
  ///
  /// In en, this message translates to:
  /// **'Failed to save shipment: {error}'**
  String failedToSaveShipment(Object error);

  /// No description provided for @parkingSavedWithTracking.
  ///
  /// In en, this message translates to:
  /// **'Parking record saved. Tracking number: {trackingCode}'**
  String parkingSavedWithTracking(Object trackingCode);

  /// No description provided for @barrelShipmentDetails.
  ///
  /// In en, this message translates to:
  /// **'Barrel Shipment Details'**
  String get barrelShipmentDetails;

  /// No description provided for @senderInformation.
  ///
  /// In en, this message translates to:
  /// **'Sender Information'**
  String get senderInformation;

  /// No description provided for @receiverInformation.
  ///
  /// In en, this message translates to:
  /// **'Receiver Information'**
  String get receiverInformation;

  /// No description provided for @shipmentSummary.
  ///
  /// In en, this message translates to:
  /// **'Shipment Summary'**
  String get shipmentSummary;

  /// No description provided for @createdOnLabel.
  ///
  /// In en, this message translates to:
  /// **'Created on'**
  String get createdOnLabel;

  /// No description provided for @statusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get statusLabel;

  /// No description provided for @updateShipment.
  ///
  /// In en, this message translates to:
  /// **'Update Shipment'**
  String get updateShipment;

  /// No description provided for @reprintReceipt.
  ///
  /// In en, this message translates to:
  /// **'Reprint Receipt'**
  String get reprintReceipt;

  /// No description provided for @shipmentUpdatedSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Shipment updated successfully!'**
  String get shipmentUpdatedSuccessfully;

  /// No description provided for @failedToUpdateShipment.
  ///
  /// In en, this message translates to:
  /// **'Failed to update shipment: {error}'**
  String failedToUpdateShipment(Object error);

  /// No description provided for @trackingNumber.
  ///
  /// In en, this message translates to:
  /// **'Tracking Number'**
  String get trackingNumber;

  /// No description provided for @trackingNumberCopied.
  ///
  /// In en, this message translates to:
  /// **'Tracking number copied to clipboard'**
  String get trackingNumberCopied;

  /// No description provided for @copyVin.
  ///
  /// In en, this message translates to:
  /// **'Copy VIN'**
  String get copyVin;

  /// No description provided for @copyName.
  ///
  /// In en, this message translates to:
  /// **'Copy name'**
  String get copyName;

  /// No description provided for @vinCopied.
  ///
  /// In en, this message translates to:
  /// **'VIN copied to clipboard'**
  String get vinCopied;

  /// No description provided for @nameCopied.
  ///
  /// In en, this message translates to:
  /// **'Name copied to clipboard'**
  String get nameCopied;

  /// No description provided for @shipmentStatusNotStarted.
  ///
  /// In en, this message translates to:
  /// **'Not started'**
  String get shipmentStatusNotStarted;

  /// No description provided for @shipmentStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get shipmentStatusPending;

  /// No description provided for @shipmentStatusInTransit.
  ///
  /// In en, this message translates to:
  /// **'In Transit'**
  String get shipmentStatusInTransit;

  /// No description provided for @shipmentStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get shipmentStatusCompleted;

  /// No description provided for @shipmentStatusCompletedNotice.
  ///
  /// In en, this message translates to:
  /// **'This shipment is marked as completed and can no longer be edited.'**
  String get shipmentStatusCompletedNotice;

  /// No description provided for @done.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get done;

  /// No description provided for @account.
  ///
  /// In en, this message translates to:
  /// **'Account'**
  String get account;

  /// No description provided for @role.
  ///
  /// In en, this message translates to:
  /// **'Role'**
  String get role;

  /// No description provided for @logout.
  ///
  /// In en, this message translates to:
  /// **'Logout'**
  String get logout;

  /// No description provided for @signOutOfAccount.
  ///
  /// In en, this message translates to:
  /// **'Sign out of your account'**
  String get signOutOfAccount;

  /// No description provided for @accountOptionalMessage.
  ///
  /// In en, this message translates to:
  /// **'Create an optional account to save receipts and sync your activity across devices.'**
  String get accountOptionalMessage;

  /// No description provided for @customer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get customer;

  /// No description provided for @staff.
  ///
  /// In en, this message translates to:
  /// **'Staff'**
  String get staff;

  /// No description provided for @barrelShippingService.
  ///
  /// In en, this message translates to:
  /// **'Barrel Shipping Service'**
  String get barrelShippingService;

  /// No description provided for @enterShippingDetailsForGuinea.
  ///
  /// In en, this message translates to:
  /// **'Enter shipping details for Guinea'**
  String get enterShippingDetailsForGuinea;

  /// No description provided for @submit.
  ///
  /// In en, this message translates to:
  /// **'Submit'**
  String get submit;

  /// No description provided for @senderName.
  ///
  /// In en, this message translates to:
  /// **'Sender Name'**
  String get senderName;

  /// No description provided for @address.
  ///
  /// In en, this message translates to:
  /// **'Address'**
  String get address;

  /// No description provided for @receiverName.
  ///
  /// In en, this message translates to:
  /// **'Receiver Name'**
  String get receiverName;

  /// No description provided for @receiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Receiver Phone'**
  String get receiverPhone;

  /// No description provided for @price.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get price;

  /// No description provided for @carTransportService.
  ///
  /// In en, this message translates to:
  /// **'Car Transport Service'**
  String get carTransportService;

  /// No description provided for @enterCarTransportDetailsForGuinea.
  ///
  /// In en, this message translates to:
  /// **'Enter car transport details for Guinea'**
  String get enterCarTransportDetailsForGuinea;

  /// No description provided for @ownerName.
  ///
  /// In en, this message translates to:
  /// **'Owner Name'**
  String get ownerName;

  /// No description provided for @carMake.
  ///
  /// In en, this message translates to:
  /// **'Car Make'**
  String get carMake;

  /// No description provided for @carModel.
  ///
  /// In en, this message translates to:
  /// **'Car Model'**
  String get carModel;

  /// No description provided for @carYear.
  ///
  /// In en, this message translates to:
  /// **'Car Year'**
  String get carYear;

  /// No description provided for @transportDate.
  ///
  /// In en, this message translates to:
  /// **'Transport Date'**
  String get transportDate;

  /// No description provided for @carSalesService.
  ///
  /// In en, this message translates to:
  /// **'Car Sales Service'**
  String get carSalesService;

  /// No description provided for @availableCars.
  ///
  /// In en, this message translates to:
  /// **'Available Cars'**
  String get availableCars;

  /// No description provided for @browsePurchaseReserve.
  ///
  /// In en, this message translates to:
  /// **'Browse inventory, reserve a viewing time, or buy directly from the app.'**
  String get browsePurchaseReserve;

  /// No description provided for @inStock.
  ///
  /// In en, this message translates to:
  /// **'In stock'**
  String get inStock;

  /// No description provided for @viewings.
  ///
  /// In en, this message translates to:
  /// **'Viewings'**
  String get viewings;

  /// No description provided for @byAppointment.
  ///
  /// In en, this message translates to:
  /// **'By appointment'**
  String get byAppointment;

  /// No description provided for @filters.
  ///
  /// In en, this message translates to:
  /// **'Filters'**
  String get filters;

  /// No description provided for @clearFilters.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get clearFilters;

  /// No description provided for @applyFilters.
  ///
  /// In en, this message translates to:
  /// **'Apply Filters'**
  String get applyFilters;

  /// No description provided for @filteredResults.
  ///
  /// In en, this message translates to:
  /// **'{count} filters active'**
  String filteredResults(Object count);

  /// No description provided for @yearRange.
  ///
  /// In en, this message translates to:
  /// **'Year range'**
  String get yearRange;

  /// No description provided for @minYear.
  ///
  /// In en, this message translates to:
  /// **'Min year'**
  String get minYear;

  /// No description provided for @maxYear.
  ///
  /// In en, this message translates to:
  /// **'Max year'**
  String get maxYear;

  /// No description provided for @maxPrice.
  ///
  /// In en, this message translates to:
  /// **'Max price'**
  String get maxPrice;

  /// No description provided for @sortBy.
  ///
  /// In en, this message translates to:
  /// **'Sort by'**
  String get sortBy;

  /// No description provided for @newestYear.
  ///
  /// In en, this message translates to:
  /// **'Newest year'**
  String get newestYear;

  /// No description provided for @oldestYear.
  ///
  /// In en, this message translates to:
  /// **'Oldest year'**
  String get oldestYear;

  /// No description provided for @priceLowToHigh.
  ///
  /// In en, this message translates to:
  /// **'Price: low to high'**
  String get priceLowToHigh;

  /// No description provided for @priceHighToLow.
  ///
  /// In en, this message translates to:
  /// **'Price: high to low'**
  String get priceHighToLow;

  /// No description provided for @browseAvailableCarsForSale.
  ///
  /// In en, this message translates to:
  /// **'Browse available cars for sale'**
  String get browseAvailableCarsForSale;

  /// No description provided for @searchCars.
  ///
  /// In en, this message translates to:
  /// **'Search cars...'**
  String get searchCars;

  /// No description provided for @chatWithSeller.
  ///
  /// In en, this message translates to:
  /// **'Chat with Seller'**
  String get chatWithSeller;

  /// No description provided for @toyotaCamry.
  ///
  /// In en, this message translates to:
  /// **'Toyota Camry'**
  String get toyotaCamry;

  /// No description provided for @hondaAccord.
  ///
  /// In en, this message translates to:
  /// **'Honda Accord'**
  String get hondaAccord;

  /// No description provided for @fordEscape.
  ///
  /// In en, this message translates to:
  /// **'Ford Escape'**
  String get fordEscape;

  /// No description provided for @yearLabel.
  ///
  /// In en, this message translates to:
  /// **'Year: {year}'**
  String yearLabel(Object year);

  /// No description provided for @mileageLabel.
  ///
  /// In en, this message translates to:
  /// **'Mileage: {mileage}'**
  String mileageLabel(Object mileage);

  /// No description provided for @mileage.
  ///
  /// In en, this message translates to:
  /// **'mileage'**
  String get mileage;

  /// No description provided for @carDetails.
  ///
  /// In en, this message translates to:
  /// **'Car Details'**
  String get carDetails;

  /// No description provided for @contactSeller.
  ///
  /// In en, this message translates to:
  /// **'Contact Seller'**
  String get contactSeller;

  /// No description provided for @viewMorePhotos.
  ///
  /// In en, this message translates to:
  /// **'View More Photos'**
  String get viewMorePhotos;

  /// No description provided for @carDescription.
  ///
  /// In en, this message translates to:
  /// **'Car Description'**
  String get carDescription;

  /// No description provided for @features.
  ///
  /// In en, this message translates to:
  /// **'Features'**
  String get features;

  /// No description provided for @contactInfo.
  ///
  /// In en, this message translates to:
  /// **'Contact Information'**
  String get contactInfo;

  /// No description provided for @sendWhatsAppMessage.
  ///
  /// In en, this message translates to:
  /// **'Send WhatsApp Message'**
  String get sendWhatsAppMessage;

  /// No description provided for @whatsAppMessage.
  ///
  /// In en, this message translates to:
  /// **'Hi! I\'m interested in the {carTitle} ({carYear}) for {carPrice}. Can you provide more details?'**
  String whatsAppMessage(Object carPrice, Object carTitle, Object carYear);

  /// No description provided for @noResultsFound.
  ///
  /// In en, this message translates to:
  /// **'No results found'**
  String get noResultsFound;

  /// No description provided for @tryDifferentSearch.
  ///
  /// In en, this message translates to:
  /// **'Try a different search term'**
  String get tryDifferentSearch;

  /// No description provided for @home.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get home;

  /// No description provided for @settings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get settings;

  /// No description provided for @navHome.
  ///
  /// In en, this message translates to:
  /// **'Home'**
  String get navHome;

  /// No description provided for @navCars.
  ///
  /// In en, this message translates to:
  /// **'Cars'**
  String get navCars;

  /// No description provided for @navBarrels.
  ///
  /// In en, this message translates to:
  /// **'Barrels'**
  String get navBarrels;

  /// No description provided for @navPurchases.
  ///
  /// In en, this message translates to:
  /// **'Purchases'**
  String get navPurchases;

  /// No description provided for @navTracking.
  ///
  /// In en, this message translates to:
  /// **'Tracking'**
  String get navTracking;

  /// No description provided for @navBusiness.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get navBusiness;

  /// No description provided for @navUsers.
  ///
  /// In en, this message translates to:
  /// **'Users'**
  String get navUsers;

  /// No description provided for @navSettings.
  ///
  /// In en, this message translates to:
  /// **'Settings'**
  String get navSettings;

  /// No description provided for @appInformation.
  ///
  /// In en, this message translates to:
  /// **'App Information'**
  String get appInformation;

  /// No description provided for @appVersion.
  ///
  /// In en, this message translates to:
  /// **'App Version'**
  String get appVersion;

  /// No description provided for @companyName.
  ///
  /// In en, this message translates to:
  /// **'Company Name'**
  String get companyName;

  /// No description provided for @contactUs.
  ///
  /// In en, this message translates to:
  /// **'Contact Us'**
  String get contactUs;

  /// No description provided for @phoneNumber.
  ///
  /// In en, this message translates to:
  /// **'Phone Number'**
  String get phoneNumber;

  /// No description provided for @emailAddress.
  ///
  /// In en, this message translates to:
  /// **'Email Address'**
  String get emailAddress;

  /// No description provided for @about.
  ///
  /// In en, this message translates to:
  /// **'About'**
  String get about;

  /// No description provided for @privacyPolicy.
  ///
  /// In en, this message translates to:
  /// **'Privacy Policy'**
  String get privacyPolicy;

  /// No description provided for @termsOfService.
  ///
  /// In en, this message translates to:
  /// **'Terms of Service'**
  String get termsOfService;

  /// No description provided for @legalAndPrivacy.
  ///
  /// In en, this message translates to:
  /// **'Legal & privacy'**
  String get legalAndPrivacy;

  /// No description provided for @privacyPolicySubtitle.
  ///
  /// In en, this message translates to:
  /// **'How Laawol handles your information'**
  String get privacyPolicySubtitle;

  /// No description provided for @termsOfServiceSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Rules for using the Laawol platform'**
  String get termsOfServiceSubtitle;

  /// No description provided for @openLegalLinkFailed.
  ///
  /// In en, this message translates to:
  /// **'This page could not be opened. Please try again.'**
  String get openLegalLinkFailed;

  /// No description provided for @accountManagement.
  ///
  /// In en, this message translates to:
  /// **'Account management'**
  String get accountManagement;

  /// No description provided for @deleteAccount.
  ///
  /// In en, this message translates to:
  /// **'Delete account'**
  String get deleteAccount;

  /// No description provided for @deleteAccountSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Permanently delete your account and personal data'**
  String get deleteAccountSubtitle;

  /// No description provided for @deleteAccountTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete your Laawol account?'**
  String get deleteAccountTitle;

  /// No description provided for @deleteAccountExplanation.
  ///
  /// In en, this message translates to:
  /// **'This starts permanent account deletion. You will be signed out, and access to your account will end.'**
  String get deleteAccountExplanation;

  /// No description provided for @deleteAccountRetentionNotice.
  ///
  /// In en, this message translates to:
  /// **'Completed payment and service records may be retained when required for accounting, refunds, disputes, fraud prevention, or law. All other associated personal data will be deleted or anonymized within 30 days.'**
  String get deleteAccountRetentionNotice;

  /// No description provided for @enterPasswordToDelete.
  ///
  /// In en, this message translates to:
  /// **'Enter your password to confirm'**
  String get enterPasswordToDelete;

  /// No description provided for @confirmDeleteAccount.
  ///
  /// In en, this message translates to:
  /// **'Request deletion'**
  String get confirmDeleteAccount;

  /// No description provided for @accountDeletionRequestedTitle.
  ///
  /// In en, this message translates to:
  /// **'Deletion requested'**
  String get accountDeletionRequestedTitle;

  /// No description provided for @accountDeletionRequestedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your request was received. Laawol will delete or anonymize eligible account data within 30 days. You are now signed out.'**
  String get accountDeletionRequestedMessage;

  /// No description provided for @accountDeletionWrongPassword.
  ///
  /// In en, this message translates to:
  /// **'The password is incorrect.'**
  String get accountDeletionWrongPassword;

  /// No description provided for @accountDeletionRecentLoginRequired.
  ///
  /// In en, this message translates to:
  /// **'Please sign in again, then retry account deletion.'**
  String get accountDeletionRecentLoginRequired;

  /// No description provided for @accountDeletionAdminBlocked.
  ///
  /// In en, this message translates to:
  /// **'A platform administrator account must be removed by another super admin.'**
  String get accountDeletionAdminBlocked;

  /// No description provided for @accountDeletionFailed.
  ///
  /// In en, this message translates to:
  /// **'We could not start account deletion. Please try again or contact support.'**
  String get accountDeletionFailed;

  /// No description provided for @manageCars.
  ///
  /// In en, this message translates to:
  /// **'Manage Cars'**
  String get manageCars;

  /// No description provided for @recentActivity.
  ///
  /// In en, this message translates to:
  /// **'Recent Activity'**
  String get recentActivity;

  /// No description provided for @filterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get filterAll;

  /// No description provided for @trackSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search tracking, receiver, country'**
  String get trackSearchHint;

  /// No description provided for @filterInProgress.
  ///
  /// In en, this message translates to:
  /// **'In progress'**
  String get filterInProgress;

  /// No description provided for @filterDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get filterDelivered;

  /// No description provided for @allDestinations.
  ///
  /// In en, this message translates to:
  /// **'All destinations'**
  String get allDestinations;

  /// No description provided for @noShipmentsMatchFilters.
  ///
  /// In en, this message translates to:
  /// **'No shipments match your filters'**
  String get noShipmentsMatchFilters;

  /// No description provided for @ordersTitle.
  ///
  /// In en, this message translates to:
  /// **'My orders'**
  String get ordersTitle;

  /// No description provided for @ordersSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search orders, business, country'**
  String get ordersSearchHint;

  /// No description provided for @ordersEmpty.
  ///
  /// In en, this message translates to:
  /// **'Your paid orders appear here'**
  String get ordersEmpty;

  /// No description provided for @ordersNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No orders match your filters'**
  String get ordersNoMatch;

  /// No description provided for @orderTypeCars.
  ///
  /// In en, this message translates to:
  /// **'Cars'**
  String get orderTypeCars;

  /// No description provided for @orderTypeBarrels.
  ///
  /// In en, this message translates to:
  /// **'Barrels'**
  String get orderTypeBarrels;

  /// No description provided for @orderTypeFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get orderTypeFreight;

  /// No description provided for @orderTypeTransport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get orderTypeTransport;

  /// No description provided for @orderTypeParking.
  ///
  /// In en, this message translates to:
  /// **'Parking'**
  String get orderTypeParking;

  /// No description provided for @orderStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get orderStatusPending;

  /// No description provided for @orderStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get orderStatusActive;

  /// No description provided for @orderStatusInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get orderStatusInTransit;

  /// No description provided for @orderStatusCompleted.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get orderStatusCompleted;

  /// No description provided for @orderStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get orderStatusCancelled;

  /// No description provided for @orderStatusRefunded.
  ///
  /// In en, this message translates to:
  /// **'Refunded'**
  String get orderStatusRefunded;

  /// No description provided for @orderLeaveReviewCta.
  ///
  /// In en, this message translates to:
  /// **'Leave a review'**
  String get orderLeaveReviewCta;

  /// No description provided for @orderReviewedBadge.
  ///
  /// In en, this message translates to:
  /// **'Reviewed'**
  String get orderReviewedBadge;

  /// No description provided for @reviews.
  ///
  /// In en, this message translates to:
  /// **'Reviews'**
  String get reviews;

  /// No description provided for @reviewComposerTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave a review'**
  String get reviewComposerTitle;

  /// No description provided for @reviewRatingLabel.
  ///
  /// In en, this message translates to:
  /// **'How would you rate this service?'**
  String get reviewRatingLabel;

  /// No description provided for @reviewRatingRequired.
  ///
  /// In en, this message translates to:
  /// **'Please select a star rating.'**
  String get reviewRatingRequired;

  /// No description provided for @reviewCommentHint.
  ///
  /// In en, this message translates to:
  /// **'Tell us about your experience'**
  String get reviewCommentHint;

  /// No description provided for @reviewCommentRequired.
  ///
  /// In en, this message translates to:
  /// **'Please write a short comment.'**
  String get reviewCommentRequired;

  /// No description provided for @reviewSubmitButton.
  ///
  /// In en, this message translates to:
  /// **'Submit review'**
  String get reviewSubmitButton;

  /// No description provided for @reviewSubmitSuccess.
  ///
  /// In en, this message translates to:
  /// **'Thanks for your review!'**
  String get reviewSubmitSuccess;

  /// No description provided for @reviewSubmitFailed.
  ///
  /// In en, this message translates to:
  /// **'We could not submit your review. Please try again.'**
  String get reviewSubmitFailed;

  /// No description provided for @reviewAlreadySubmitted.
  ///
  /// In en, this message translates to:
  /// **'You already reviewed this order.'**
  String get reviewAlreadySubmitted;

  /// No description provided for @reviewOrderNotCompleted.
  ///
  /// In en, this message translates to:
  /// **'This order is not completed yet.'**
  String get reviewOrderNotCompleted;

  /// No description provided for @reviewsSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Customer reviews'**
  String get reviewsSectionTitle;

  /// No description provided for @reviewsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No reviews yet.'**
  String get reviewsEmpty;

  /// No description provided for @reviewFlagButton.
  ///
  /// In en, this message translates to:
  /// **'Report'**
  String get reviewFlagButton;

  /// No description provided for @reviewFlagDialogTitle.
  ///
  /// In en, this message translates to:
  /// **'Report this review'**
  String get reviewFlagDialogTitle;

  /// No description provided for @reviewFlagReasonHint.
  ///
  /// In en, this message translates to:
  /// **'Why are you reporting this review?'**
  String get reviewFlagReasonHint;

  /// No description provided for @reviewFlagSubmit.
  ///
  /// In en, this message translates to:
  /// **'Submit report'**
  String get reviewFlagSubmit;

  /// No description provided for @reviewFlagSubmitted.
  ///
  /// In en, this message translates to:
  /// **'Thanks, we\'ll take a look.'**
  String get reviewFlagSubmitted;

  /// No description provided for @filterParking.
  ///
  /// In en, this message translates to:
  /// **'Parked Cars'**
  String get filterParking;

  /// No description provided for @filterBarrels.
  ///
  /// In en, this message translates to:
  /// **'Barrel Shipments'**
  String get filterBarrels;

  /// No description provided for @filterFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get filterFreight;

  /// No description provided for @filterTransport.
  ///
  /// In en, this message translates to:
  /// **'Car Transport'**
  String get filterTransport;

  /// No description provided for @filterSales.
  ///
  /// In en, this message translates to:
  /// **'Car Sales'**
  String get filterSales;

  /// No description provided for @totalCars.
  ///
  /// In en, this message translates to:
  /// **'Total Cars'**
  String get totalCars;

  /// No description provided for @activeCars.
  ///
  /// In en, this message translates to:
  /// **'Active cars'**
  String get activeCars;

  /// No description provided for @inactiveCars.
  ///
  /// In en, this message translates to:
  /// **'Inactive Cars'**
  String get inactiveCars;

  /// No description provided for @processing.
  ///
  /// In en, this message translates to:
  /// **'Processing'**
  String get processing;

  /// No description provided for @completed.
  ///
  /// In en, this message translates to:
  /// **'Completed'**
  String get completed;

  /// No description provided for @noRecordsYet.
  ///
  /// In en, this message translates to:
  /// **'No records yet. Start logging activities to see them here.'**
  String get noRecordsYet;

  /// No description provided for @noOpenRecords.
  ///
  /// In en, this message translates to:
  /// **'Nothing open right now. Completed and older records are below.'**
  String get noOpenRecords;

  /// No description provided for @activityShowHistory.
  ///
  /// In en, this message translates to:
  /// **'Show completed and older records'**
  String get activityShowHistory;

  /// No description provided for @activityLoadMoreHistory.
  ///
  /// In en, this message translates to:
  /// **'Load older records'**
  String get activityLoadMoreHistory;

  /// No description provided for @activityHistoryEnd.
  ///
  /// In en, this message translates to:
  /// **'No older records.'**
  String get activityHistoryEnd;

  /// No description provided for @activityHistoryLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load older records. Try again.'**
  String get activityHistoryLoadFailed;

  /// No description provided for @marketplaceLoadMoreCars.
  ///
  /// In en, this message translates to:
  /// **'Load more cars'**
  String get marketplaceLoadMoreCars;

  /// No description provided for @recordReference.
  ///
  /// In en, this message translates to:
  /// **'Reference'**
  String get recordReference;

  /// No description provided for @active.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get active;

  /// No description provided for @inactive.
  ///
  /// In en, this message translates to:
  /// **'Inactive'**
  String get inactive;

  /// No description provided for @addNewCar.
  ///
  /// In en, this message translates to:
  /// **'Add New Car'**
  String get addNewCar;

  /// No description provided for @carTitle.
  ///
  /// In en, this message translates to:
  /// **'Car Title'**
  String get carTitle;

  /// No description provided for @cancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get cancel;

  /// No description provided for @add.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get add;

  /// No description provided for @invalidCredentials.
  ///
  /// In en, this message translates to:
  /// **'Invalid email or password'**
  String get invalidCredentials;

  /// No description provided for @backToCustomerHome.
  ///
  /// In en, this message translates to:
  /// **'Back to Customer Home'**
  String get backToCustomerHome;

  /// No description provided for @trackShipment.
  ///
  /// In en, this message translates to:
  /// **'Track Shipment'**
  String get trackShipment;

  /// No description provided for @tracking.
  ///
  /// In en, this message translates to:
  /// **'Tracking'**
  String get tracking;

  /// No description provided for @userManagement.
  ///
  /// In en, this message translates to:
  /// **'User Management'**
  String get userManagement;

  /// No description provided for @setAsCustomer.
  ///
  /// In en, this message translates to:
  /// **'Set as customer'**
  String get setAsCustomer;

  /// No description provided for @setAsStaff.
  ///
  /// In en, this message translates to:
  /// **'Set as staff'**
  String get setAsStaff;

  /// No description provided for @setAsAdmin.
  ///
  /// In en, this message translates to:
  /// **'Set as Admin'**
  String get setAsAdmin;

  /// No description provided for @addStaffMember.
  ///
  /// In en, this message translates to:
  /// **'Add Staff Member'**
  String get addStaffMember;

  /// No description provided for @users.
  ///
  /// In en, this message translates to:
  /// **'Users'**
  String get users;

  /// No description provided for @noUsersFound.
  ///
  /// In en, this message translates to:
  /// **'No users found.'**
  String get noUsersFound;

  /// No description provided for @enterStaffEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter staff email'**
  String get enterStaffEmail;

  /// No description provided for @enterTemporaryPassword.
  ///
  /// In en, this message translates to:
  /// **'Enter temporary password'**
  String get enterTemporaryPassword;

  /// No description provided for @userRoleUpdated.
  ///
  /// In en, this message translates to:
  /// **'User role updated to {role}'**
  String userRoleUpdated(Object role);

  /// No description provided for @failedToUpdateUserRole.
  ///
  /// In en, this message translates to:
  /// **'Failed to update user role: {error}'**
  String failedToUpdateUserRole(Object error);

  /// No description provided for @deleteUser.
  ///
  /// In en, this message translates to:
  /// **'Delete user'**
  String get deleteUser;

  /// No description provided for @confirmDeletion.
  ///
  /// In en, this message translates to:
  /// **'Confirm Deletion'**
  String get confirmDeletion;

  /// No description provided for @confirmDeleteUser.
  ///
  /// In en, this message translates to:
  /// **'Are you sure you want to delete the user {email}?'**
  String confirmDeleteUser(Object email);

  /// No description provided for @delete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get delete;

  /// No description provided for @userDeleted.
  ///
  /// In en, this message translates to:
  /// **'User {email} deleted successfully'**
  String userDeleted(Object email);

  /// No description provided for @failedToDeleteUser.
  ///
  /// In en, this message translates to:
  /// **'Failed to delete user: {error}'**
  String failedToDeleteUser(Object error);

  /// No description provided for @staffMemberAddedSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Staff member added successfully!'**
  String get staffMemberAddedSuccessfully;

  /// No description provided for @failedToAddStaffMember.
  ///
  /// In en, this message translates to:
  /// **'Failed to add staff member: {error}'**
  String failedToAddStaffMember(String error);

  /// No description provided for @admin.
  ///
  /// In en, this message translates to:
  /// **'Admin'**
  String get admin;

  /// No description provided for @signUp.
  ///
  /// In en, this message translates to:
  /// **'Sign Up'**
  String get signUp;

  /// No description provided for @createAccount.
  ///
  /// In en, this message translates to:
  /// **'Create Account'**
  String get createAccount;

  /// No description provided for @signUpToGetStarted.
  ///
  /// In en, this message translates to:
  /// **'Create a free account with the details we need to reserve viewings and record purchases.'**
  String get signUpToGetStarted;

  /// No description provided for @fullName.
  ///
  /// In en, this message translates to:
  /// **'Full Name'**
  String get fullName;

  /// No description provided for @enterFullName.
  ///
  /// In en, this message translates to:
  /// **'Enter your full name'**
  String get enterFullName;

  /// No description provided for @pleaseEnterFullName.
  ///
  /// In en, this message translates to:
  /// **'Please enter your full name'**
  String get pleaseEnterFullName;

  /// No description provided for @enterPhoneNumber.
  ///
  /// In en, this message translates to:
  /// **'Enter your phone number'**
  String get enterPhoneNumber;

  /// No description provided for @pleaseEnterPhoneNumber.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid phone number'**
  String get pleaseEnterPhoneNumber;

  /// No description provided for @confirmPassword.
  ///
  /// In en, this message translates to:
  /// **'Confirm Password'**
  String get confirmPassword;

  /// No description provided for @reEnterPassword.
  ///
  /// In en, this message translates to:
  /// **'Re-enter your password'**
  String get reEnterPassword;

  /// No description provided for @pleaseConfirmPassword.
  ///
  /// In en, this message translates to:
  /// **'Please confirm your password'**
  String get pleaseConfirmPassword;

  /// No description provided for @passwordsDoNotMatch.
  ///
  /// In en, this message translates to:
  /// **'Passwords do not match'**
  String get passwordsDoNotMatch;

  /// No description provided for @alreadyHaveAccount.
  ///
  /// In en, this message translates to:
  /// **'Already have an account?'**
  String get alreadyHaveAccount;

  /// No description provided for @dontHaveAccount.
  ///
  /// In en, this message translates to:
  /// **'Don\'t have an account?'**
  String get dontHaveAccount;

  /// No description provided for @accountCreatedSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Account created successfully!'**
  String get accountCreatedSuccessfully;

  /// No description provided for @transportRequestSavedWithTracking.
  ///
  /// In en, this message translates to:
  /// **'Transport request saved with tracking code: {trackingCode}'**
  String transportRequestSavedWithTracking(Object trackingCode);

  /// No description provided for @failedToSaveTransport.
  ///
  /// In en, this message translates to:
  /// **'Failed to save transport request: {error}'**
  String failedToSaveTransport(Object error);

  /// No description provided for @transportUpdatedSuccessfully.
  ///
  /// In en, this message translates to:
  /// **'Transport request updated successfully!'**
  String get transportUpdatedSuccessfully;

  /// No description provided for @failedToUpdateTransport.
  ///
  /// In en, this message translates to:
  /// **'Failed to update transport request: {error}'**
  String failedToUpdateTransport(Object error);

  /// No description provided for @updateTransport.
  ///
  /// In en, this message translates to:
  /// **'Update Transport'**
  String get updateTransport;

  /// No description provided for @transportStatusCompletedNotice.
  ///
  /// In en, this message translates to:
  /// **'This transport request is marked as completed and can no longer be edited.'**
  String get transportStatusCompletedNotice;

  /// No description provided for @transportRequestDetails.
  ///
  /// In en, this message translates to:
  /// **'Car Transport Details'**
  String get transportRequestDetails;

  /// No description provided for @operationFailed.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong: {error}'**
  String operationFailed(Object error);

  /// No description provided for @activate.
  ///
  /// In en, this message translates to:
  /// **'Activate'**
  String get activate;

  /// No description provided for @deactivate.
  ///
  /// In en, this message translates to:
  /// **'Deactivate'**
  String get deactivate;

  /// No description provided for @activateSuccess.
  ///
  /// In en, this message translates to:
  /// **'Car status set to active.'**
  String get activateSuccess;

  /// No description provided for @deactivateSuccess.
  ///
  /// In en, this message translates to:
  /// **'Car status set to inactive.'**
  String get deactivateSuccess;

  /// No description provided for @carCreated.
  ///
  /// In en, this message translates to:
  /// **'Car added successfully!'**
  String get carCreated;

  /// No description provided for @carUpdated.
  ///
  /// In en, this message translates to:
  /// **'Car updated successfully!'**
  String get carUpdated;

  /// No description provided for @saleRecorded.
  ///
  /// In en, this message translates to:
  /// **'Sale information saved.'**
  String get saleRecorded;

  /// No description provided for @requiredField.
  ///
  /// In en, this message translates to:
  /// **'This field is required'**
  String get requiredField;

  /// No description provided for @soldCars.
  ///
  /// In en, this message translates to:
  /// **'Sold Cars'**
  String get soldCars;

  /// No description provided for @markAsSold.
  ///
  /// In en, this message translates to:
  /// **'Mark as sold'**
  String get markAsSold;

  /// No description provided for @sold.
  ///
  /// In en, this message translates to:
  /// **'Sold'**
  String get sold;

  /// No description provided for @carMileage.
  ///
  /// In en, this message translates to:
  /// **'Mileage'**
  String get carMileage;

  /// No description provided for @rebuiltTitle.
  ///
  /// In en, this message translates to:
  /// **'Rebuilt title'**
  String get rebuiltTitle;

  /// No description provided for @rebuiltTitleQuestion.
  ///
  /// In en, this message translates to:
  /// **'Rebuilt title?'**
  String get rebuiltTitleQuestion;

  /// No description provided for @rebuiltTitleYes.
  ///
  /// In en, this message translates to:
  /// **'Yes — rebuilt title'**
  String get rebuiltTitleYes;

  /// No description provided for @rebuiltTitleNo.
  ///
  /// In en, this message translates to:
  /// **'No — not a rebuilt title'**
  String get rebuiltTitleNo;

  /// No description provided for @rebuiltTitleUnknown.
  ///
  /// In en, this message translates to:
  /// **'Not provided'**
  String get rebuiltTitleUnknown;

  /// No description provided for @rebuiltTitleDisclosureHelp.
  ///
  /// In en, this message translates to:
  /// **'Required. Buyers will see this disclosure.'**
  String get rebuiltTitleDisclosureHelp;

  /// No description provided for @sellingPrice.
  ///
  /// In en, this message translates to:
  /// **'Listing Price'**
  String get sellingPrice;

  /// No description provided for @carFeaturesHint.
  ///
  /// In en, this message translates to:
  /// **'Features (comma separated)'**
  String get carFeaturesHint;

  /// No description provided for @carImagesHint.
  ///
  /// In en, this message translates to:
  /// **'Image URLs (comma separated)'**
  String get carImagesHint;

  /// No description provided for @contactName.
  ///
  /// In en, this message translates to:
  /// **'Contact Name'**
  String get contactName;

  /// No description provided for @contactPhone.
  ///
  /// In en, this message translates to:
  /// **'Contact phone'**
  String get contactPhone;

  /// No description provided for @contactEmail.
  ///
  /// In en, this message translates to:
  /// **'Contact Email'**
  String get contactEmail;

  /// No description provided for @saveCar.
  ///
  /// In en, this message translates to:
  /// **'Save Car'**
  String get saveCar;

  /// No description provided for @updateCar.
  ///
  /// In en, this message translates to:
  /// **'Update Car'**
  String get updateCar;

  /// No description provided for @editCar.
  ///
  /// In en, this message translates to:
  /// **'Edit Car'**
  String get editCar;

  /// No description provided for @addCar.
  ///
  /// In en, this message translates to:
  /// **'Add Car'**
  String get addCar;

  /// No description provided for @customerName.
  ///
  /// In en, this message translates to:
  /// **'Customer Name'**
  String get customerName;

  /// No description provided for @customerPhone.
  ///
  /// In en, this message translates to:
  /// **'Customer Phone'**
  String get customerPhone;

  /// No description provided for @customerEmail.
  ///
  /// In en, this message translates to:
  /// **'Customer Email'**
  String get customerEmail;

  /// No description provided for @customerEmailOptional.
  ///
  /// In en, this message translates to:
  /// **'Customer Email (optional)'**
  String get customerEmailOptional;

  /// No description provided for @customerAddressOptional.
  ///
  /// In en, this message translates to:
  /// **'Customer Address (optional)'**
  String get customerAddressOptional;

  /// No description provided for @salePrice.
  ///
  /// In en, this message translates to:
  /// **'Sale Price'**
  String get salePrice;

  /// No description provided for @saleDate.
  ///
  /// In en, this message translates to:
  /// **'Sale Date'**
  String get saleDate;

  /// No description provided for @additionalNotes.
  ///
  /// In en, this message translates to:
  /// **'Additional Notes'**
  String get additionalNotes;

  /// No description provided for @confirmSale.
  ///
  /// In en, this message translates to:
  /// **'Confirm Sale'**
  String get confirmSale;

  /// No description provided for @noCarsFound.
  ///
  /// In en, this message translates to:
  /// **'No cars yet'**
  String get noCarsFound;

  /// No description provided for @addYourFirstCar.
  ///
  /// In en, this message translates to:
  /// **'Add your first car to get started.'**
  String get addYourFirstCar;

  /// No description provided for @noCarsAvailable.
  ///
  /// In en, this message translates to:
  /// **'No cars are currently available.'**
  String get noCarsAvailable;

  /// No description provided for @checkBackSoon.
  ///
  /// In en, this message translates to:
  /// **'Check back soon for new inventory.'**
  String get checkBackSoon;

  /// No description provided for @contactUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Contact unavailable'**
  String get contactUnavailable;

  /// No description provided for @noDescriptionAvailable.
  ///
  /// In en, this message translates to:
  /// **'No description available.'**
  String get noDescriptionAvailable;

  /// No description provided for @noFeaturesAvailable.
  ///
  /// In en, this message translates to:
  /// **'No features listed.'**
  String get noFeaturesAvailable;

  /// No description provided for @soldInfo.
  ///
  /// In en, this message translates to:
  /// **'Sale Details'**
  String get soldInfo;

  /// No description provided for @soldTo.
  ///
  /// In en, this message translates to:
  /// **'Sold to {name}'**
  String soldTo(Object name);

  /// No description provided for @soldOn.
  ///
  /// In en, this message translates to:
  /// **'Sold on {date}'**
  String soldOn(Object date);

  /// No description provided for @soldPriceLabel.
  ///
  /// In en, this message translates to:
  /// **'Sale price: {price}'**
  String soldPriceLabel(Object price);

  /// No description provided for @imagesLabel.
  ///
  /// In en, this message translates to:
  /// **'Images'**
  String get imagesLabel;

  /// No description provided for @addImages.
  ///
  /// In en, this message translates to:
  /// **'Add Images'**
  String get addImages;

  /// No description provided for @noImagesSelected.
  ///
  /// In en, this message translates to:
  /// **'No images selected yet.'**
  String get noImagesSelected;

  /// No description provided for @addImagesPrompt.
  ///
  /// In en, this message translates to:
  /// **'Please add at least one image.'**
  String get addImagesPrompt;

  /// No description provided for @coverLabel.
  ///
  /// In en, this message translates to:
  /// **'Cover'**
  String get coverLabel;

  /// No description provided for @setAsCover.
  ///
  /// In en, this message translates to:
  /// **'Set as cover'**
  String get setAsCover;

  /// No description provided for @reserved.
  ///
  /// In en, this message translates to:
  /// **'Reserved'**
  String get reserved;

  /// No description provided for @reserveWithDeposit.
  ///
  /// In en, this message translates to:
  /// **'Reserve with deposit'**
  String get reserveWithDeposit;

  /// No description provided for @reserveWithPaidHold.
  ///
  /// In en, this message translates to:
  /// **'Reserve with paid hold'**
  String get reserveWithPaidHold;

  /// No description provided for @loginRequiredForDeposit.
  ///
  /// In en, this message translates to:
  /// **'Please sign in before paying a deposit.'**
  String get loginRequiredForDeposit;

  /// No description provided for @reserveThisCar.
  ///
  /// In en, this message translates to:
  /// **'Reserve this car'**
  String get reserveThisCar;

  /// No description provided for @depositSummary.
  ///
  /// In en, this message translates to:
  /// **'A refundable reservation deposit of {amount} is required to hold this vehicle.'**
  String depositSummary(Object amount);

  /// No description provided for @payDeposit.
  ///
  /// In en, this message translates to:
  /// **'Pay Deposit'**
  String get payDeposit;

  /// No description provided for @reservationComplete.
  ///
  /// In en, this message translates to:
  /// **'Deposit received. Your reservation is now active.'**
  String get reservationComplete;

  /// No description provided for @loginRequiredForPurchase.
  ///
  /// In en, this message translates to:
  /// **'Please sign in before purchasing this car.'**
  String get loginRequiredForPurchase;

  /// No description provided for @purchaseThisCar.
  ///
  /// In en, this message translates to:
  /// **'Purchase this car'**
  String get purchaseThisCar;

  /// No description provided for @reserveViewing.
  ///
  /// In en, this message translates to:
  /// **'Reserve a viewing'**
  String get reserveViewing;

  /// No description provided for @reserveViewingSummary.
  ///
  /// In en, this message translates to:
  /// **'Choose an available time to come view this vehicle. We will hold the car for your appointment.'**
  String get reserveViewingSummary;

  /// No description provided for @selectViewingTime.
  ///
  /// In en, this message translates to:
  /// **'Available viewing times'**
  String get selectViewingTime;

  /// No description provided for @selectViewingTimeRequired.
  ///
  /// In en, this message translates to:
  /// **'Please select a viewing time.'**
  String get selectViewingTimeRequired;

  /// No description provided for @confirmViewingReservation.
  ///
  /// In en, this message translates to:
  /// **'Confirm Viewing'**
  String get confirmViewingReservation;

  /// No description provided for @viewingReservationComplete.
  ///
  /// In en, this message translates to:
  /// **'Your viewing is reserved for {time}.'**
  String viewingReservationComplete(Object time);

  /// No description provided for @youHaveViewingReserved.
  ///
  /// In en, this message translates to:
  /// **'You already reserved a viewing'**
  String get youHaveViewingReserved;

  /// No description provided for @currentViewingTime.
  ///
  /// In en, this message translates to:
  /// **'Current viewing time'**
  String get currentViewingTime;

  /// No description provided for @changeOrCancelViewingToBookNew.
  ///
  /// In en, this message translates to:
  /// **'To schedule another viewing for this listing, change the current time or cancel this viewing first.'**
  String get changeOrCancelViewingToBookNew;

  /// No description provided for @accountRequiredTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to continue'**
  String get accountRequiredTitle;

  /// No description provided for @accountRequiredReserveMessage.
  ///
  /// In en, this message translates to:
  /// **'Create an account or sign in so we can save your viewing appointment and keep the car reserved for you.'**
  String get accountRequiredReserveMessage;

  /// No description provided for @accountRequiredPurchaseMessage.
  ///
  /// In en, this message translates to:
  /// **'Create an account or sign in so we can securely record your purchase and show it in My Purchases.'**
  String get accountRequiredPurchaseMessage;

  /// No description provided for @phoneRequiredForReservation.
  ///
  /// In en, this message translates to:
  /// **'Phone number required to continue'**
  String get phoneRequiredForReservation;

  /// No description provided for @purchaseSummary.
  ///
  /// In en, this message translates to:
  /// **'You will pay the full vehicle price of {amount} with secure checkout.'**
  String purchaseSummary(Object amount);

  /// No description provided for @secureStripeCheckout.
  ///
  /// In en, this message translates to:
  /// **'Secure Stripe checkout. Your purchase is recorded after payment succeeds.'**
  String get secureStripeCheckout;

  /// No description provided for @payNow.
  ///
  /// In en, this message translates to:
  /// **'Pay Now'**
  String get payNow;

  /// No description provided for @purchaseComplete.
  ///
  /// In en, this message translates to:
  /// **'Payment received. This car is now purchased.'**
  String get purchaseComplete;

  /// No description provided for @checkoutUnavailable.
  ///
  /// In en, this message translates to:
  /// **'We could not start checkout right now. Please try again in a moment.'**
  String get checkoutUnavailable;

  /// No description provided for @carAlreadyReserved.
  ///
  /// In en, this message translates to:
  /// **'This car already has an active reservation.'**
  String get carAlreadyReserved;

  /// No description provided for @carNoLongerAvailable.
  ///
  /// In en, this message translates to:
  /// **'This car is no longer available'**
  String get carNoLongerAvailable;

  /// No description provided for @destinationCountry.
  ///
  /// In en, this message translates to:
  /// **'Destination Country'**
  String get destinationCountry;

  /// No description provided for @destinationCountriesUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Destination options are not available right now. Please try again in a moment.'**
  String get destinationCountriesUnavailable;

  /// No description provided for @sendBarrels.
  ///
  /// In en, this message translates to:
  /// **'Send Barrels'**
  String get sendBarrels;

  /// No description provided for @enterShippingDetails.
  ///
  /// In en, this message translates to:
  /// **'Enter shipping details'**
  String get enterShippingDetails;

  /// No description provided for @transportCars.
  ///
  /// In en, this message translates to:
  /// **'Transport Cars'**
  String get transportCars;

  /// No description provided for @enterCarTransportDetails.
  ///
  /// In en, this message translates to:
  /// **'Enter car transport details'**
  String get enterCarTransportDetails;

  /// No description provided for @cars.
  ///
  /// In en, this message translates to:
  /// **'Cars'**
  String get cars;

  /// No description provided for @myPurchases.
  ///
  /// In en, this message translates to:
  /// **'My Purchases'**
  String get myPurchases;

  /// No description provided for @hubViewingsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Appointments to see a car'**
  String get hubViewingsSubtitle;

  /// No description provided for @myCarViewings.
  ///
  /// In en, this message translates to:
  /// **'Car viewings'**
  String get myCarViewings;

  /// No description provided for @noCarViewingsYet.
  ///
  /// In en, this message translates to:
  /// **'No car viewings yet. Ask to see a car from its listing.'**
  String get noCarViewingsYet;

  /// No description provided for @noPurchasesYet.
  ///
  /// In en, this message translates to:
  /// **'No car purchases yet.'**
  String get noPurchasesYet;

  /// No description provided for @purchaseHistoryUnavailable.
  ///
  /// In en, this message translates to:
  /// **'We could not load your purchase history right now. Please try again after your account finishes syncing.'**
  String get purchaseHistoryUnavailable;

  /// No description provided for @depositPaid.
  ///
  /// In en, this message translates to:
  /// **'Payment: {amount} ({status})'**
  String depositPaid(Object amount, Object status);

  /// No description provided for @purchases.
  ///
  /// In en, this message translates to:
  /// **'Purchases'**
  String get purchases;

  /// No description provided for @purchaseReservations.
  ///
  /// In en, this message translates to:
  /// **'Car Purchases'**
  String get purchaseReservations;

  /// No description provided for @purchaseUpdated.
  ///
  /// In en, this message translates to:
  /// **'Purchase updated.'**
  String get purchaseUpdated;

  /// No description provided for @cancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get cancelled;

  /// No description provided for @refunded.
  ///
  /// In en, this message translates to:
  /// **'Refunded'**
  String get refunded;

  /// No description provided for @staffTools.
  ///
  /// In en, this message translates to:
  /// **'Staff Tools'**
  String get staffTools;

  /// No description provided for @destinationCountries.
  ///
  /// In en, this message translates to:
  /// **'Destination Countries'**
  String get destinationCountries;

  /// No description provided for @manageDestinationCountries.
  ///
  /// In en, this message translates to:
  /// **'Manage countries available in customer forms.'**
  String get manageDestinationCountries;

  /// No description provided for @countriesSeeded.
  ///
  /// In en, this message translates to:
  /// **'Country catalog added.'**
  String get countriesSeeded;

  /// No description provided for @countryName.
  ///
  /// In en, this message translates to:
  /// **'Country Name'**
  String get countryName;

  /// No description provided for @countryCode.
  ///
  /// In en, this message translates to:
  /// **'Country Code'**
  String get countryCode;

  /// No description provided for @selectBusinessCountry.
  ///
  /// In en, this message translates to:
  /// **'Select your business country'**
  String get selectBusinessCountry;

  /// No description provided for @selectBusinessCity.
  ///
  /// In en, this message translates to:
  /// **'Select your business city'**
  String get selectBusinessCity;

  /// No description provided for @selectBusinessState.
  ///
  /// In en, this message translates to:
  /// **'Select your business state'**
  String get selectBusinessState;

  /// No description provided for @selectCountryFirst.
  ///
  /// In en, this message translates to:
  /// **'Select country first'**
  String get selectCountryFirst;

  /// No description provided for @enterBusinessStreet.
  ///
  /// In en, this message translates to:
  /// **'Enter the business street address'**
  String get enterBusinessStreet;

  /// No description provided for @enterValidHeadquartersAddress.
  ///
  /// In en, this message translates to:
  /// **'Add a complete headquarters address so customers can drop off items.'**
  String get enterValidHeadquartersAddress;

  /// No description provided for @seedDefaultCountries.
  ///
  /// In en, this message translates to:
  /// **'Seed All Countries'**
  String get seedDefaultCountries;

  /// No description provided for @save.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get save;

  /// No description provided for @signOutQuestion.
  ///
  /// In en, this message translates to:
  /// **'Sign out?'**
  String get signOutQuestion;

  /// No description provided for @signOutConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'You will need to sign in again before managing shipments, wallet money, purchases, or business tools.'**
  String get signOutConfirmMessage;

  /// No description provided for @confirmSignOut.
  ///
  /// In en, this message translates to:
  /// **'Sign out'**
  String get confirmSignOut;

  /// No description provided for @walletTitle.
  ///
  /// In en, this message translates to:
  /// **'Wallet'**
  String get walletTitle;

  /// No description provided for @walletSubtitle.
  ///
  /// In en, this message translates to:
  /// **'View credits and return money to card'**
  String get walletSubtitle;

  /// No description provided for @businesses.
  ///
  /// In en, this message translates to:
  /// **'Businesses'**
  String get businesses;

  /// No description provided for @businessesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Approve and manage marketplace businesses'**
  String get businessesSubtitle;

  /// No description provided for @businessProfile.
  ///
  /// In en, this message translates to:
  /// **'Business profile'**
  String get businessProfile;

  /// No description provided for @businessProfileSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Manage profile, services, destinations, and team'**
  String get businessProfileSubtitle;

  /// No description provided for @businessAdmin.
  ///
  /// In en, this message translates to:
  /// **'Business admin'**
  String get businessAdmin;

  /// No description provided for @chooseAtLeastOneService.
  ///
  /// In en, this message translates to:
  /// **'Choose at least one service.'**
  String get chooseAtLeastOneService;

  /// No description provided for @businessProfileSaved.
  ///
  /// In en, this message translates to:
  /// **'Business profile saved.'**
  String get businessProfileSaved;

  /// No description provided for @featureBlurbRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a short blurb under 140 characters.'**
  String get featureBlurbRequired;

  /// No description provided for @featureConsentRequired.
  ///
  /// In en, this message translates to:
  /// **'Consent is required before requesting.'**
  String get featureConsentRequired;

  /// No description provided for @featureLogoRequired.
  ///
  /// In en, this message translates to:
  /// **'Upload a logo before requesting.'**
  String get featureLogoRequired;

  /// No description provided for @featureRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Featuring request sent for admin review.'**
  String get featureRequestSent;

  /// No description provided for @featuredOnWebsite.
  ///
  /// In en, this message translates to:
  /// **'Featured on the website'**
  String get featuredOnWebsite;

  /// No description provided for @featureApprovedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your business is approved for public featuring.'**
  String get featureApprovedMessage;

  /// No description provided for @featureRequestedMessage.
  ///
  /// In en, this message translates to:
  /// **'Your request is waiting for admin review.'**
  String get featureRequestedMessage;

  /// No description provided for @featureDefaultMessage.
  ///
  /// In en, this message translates to:
  /// **'Request a public marketing card on Laawol Digital.'**
  String get featureDefaultMessage;

  /// No description provided for @featureAdminNote.
  ///
  /// In en, this message translates to:
  /// **'Admin note: {note}'**
  String featureAdminNote(Object note);

  /// No description provided for @uploadLogo.
  ///
  /// In en, this message translates to:
  /// **'Upload logo'**
  String get uploadLogo;

  /// No description provided for @changeLogo.
  ///
  /// In en, this message translates to:
  /// **'Change logo'**
  String get changeLogo;

  /// No description provided for @shortPublicBlurb.
  ///
  /// In en, this message translates to:
  /// **'Short public blurb'**
  String get shortPublicBlurb;

  /// No description provided for @shortPublicBlurbHelper.
  ///
  /// In en, this message translates to:
  /// **'One sentence customers can safely see.'**
  String get shortPublicBlurbHelper;

  /// No description provided for @featureConsentLabel.
  ///
  /// In en, this message translates to:
  /// **'I consent to this business being featured publicly.'**
  String get featureConsentLabel;

  /// No description provided for @sendingFeatureRequest.
  ///
  /// In en, this message translates to:
  /// **'Sending request'**
  String get sendingFeatureRequest;

  /// No description provided for @requestFeaturing.
  ///
  /// In en, this message translates to:
  /// **'Request featuring'**
  String get requestFeaturing;

  /// No description provided for @noBusinessProfileAssigned.
  ///
  /// In en, this message translates to:
  /// **'No business profile is assigned.'**
  String get noBusinessProfileAssigned;

  /// No description provided for @businessProfileNotFound.
  ///
  /// In en, this message translates to:
  /// **'Business profile not found.'**
  String get businessProfileNotFound;

  /// No description provided for @destinationsAndShippingFees.
  ///
  /// In en, this message translates to:
  /// **'Destinations and services'**
  String get destinationsAndShippingFees;

  /// No description provided for @team.
  ///
  /// In en, this message translates to:
  /// **'Team'**
  String get team;

  /// No description provided for @addStaffMemberButton.
  ///
  /// In en, this message translates to:
  /// **'Add staff member'**
  String get addStaffMemberButton;

  /// No description provided for @noTeamMembersYet.
  ///
  /// In en, this message translates to:
  /// **'No team members yet.'**
  String get noTeamMembersYet;

  /// No description provided for @details.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get details;

  /// No description provided for @businessName.
  ///
  /// In en, this message translates to:
  /// **'Business name'**
  String get businessName;

  /// No description provided for @businessPhone.
  ///
  /// In en, this message translates to:
  /// **'Business phone'**
  String get businessPhone;

  /// No description provided for @businessEmail.
  ///
  /// In en, this message translates to:
  /// **'Business email'**
  String get businessEmail;

  /// No description provided for @website.
  ///
  /// In en, this message translates to:
  /// **'Website'**
  String get website;

  /// No description provided for @serviceNote.
  ///
  /// In en, this message translates to:
  /// **'Service note'**
  String get serviceNote;

  /// No description provided for @noServicesEnabledYet.
  ///
  /// In en, this message translates to:
  /// **'No services are enabled yet.'**
  String get noServicesEnabledYet;

  /// No description provided for @requestReturnToCard.
  ///
  /// In en, this message translates to:
  /// **'Request return to card'**
  String get requestReturnToCard;

  /// No description provided for @keepInWallet.
  ///
  /// In en, this message translates to:
  /// **'Keep in wallet'**
  String get keepInWallet;

  /// No description provided for @couldNotRequestRefund.
  ///
  /// In en, this message translates to:
  /// **'Could not request refund: {error}'**
  String couldNotRequestRefund(Object error);

  /// No description provided for @returnWalletBalance.
  ///
  /// In en, this message translates to:
  /// **'Return wallet balance'**
  String get returnWalletBalance;

  /// No description provided for @walletReturnMessage.
  ///
  /// In en, this message translates to:
  /// **'{amount} will be requested back to the original card. Your wallet balance will move into pending refund.'**
  String walletReturnMessage(Object amount);

  /// No description provided for @returnToCardRequested.
  ///
  /// In en, this message translates to:
  /// **'{amount} return to card requested.'**
  String returnToCardRequested(Object amount);

  /// No description provided for @walletBusinessBlocked.
  ///
  /// In en, this message translates to:
  /// **'Wallets are for customer refund credits. Business finance tools are available in the platform dashboard.'**
  String get walletBusinessBlocked;

  /// No description provided for @availableBalance.
  ///
  /// In en, this message translates to:
  /// **'Available balance'**
  String get availableBalance;

  /// No description provided for @pendingReturnToCard.
  ///
  /// In en, this message translates to:
  /// **'{amount} pending return to card'**
  String pendingReturnToCard(Object amount);

  /// No description provided for @requestingReturn.
  ///
  /// In en, this message translates to:
  /// **'Requesting return'**
  String get requestingReturn;

  /// No description provided for @returnMoneyToCard.
  ///
  /// In en, this message translates to:
  /// **'Return money to card'**
  String get returnMoneyToCard;

  /// No description provided for @walletCreditsInfoWithBalance.
  ///
  /// In en, this message translates to:
  /// **'Wallet credits come from shipment price differences. You can keep the credit here or request it back to your original card.'**
  String get walletCreditsInfoWithBalance;

  /// No description provided for @walletCreditsInfoEmpty.
  ///
  /// In en, this message translates to:
  /// **'Refund credits from future shipment changes will appear here.'**
  String get walletCreditsInfoEmpty;

  /// No description provided for @activity.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get activity;

  /// No description provided for @destinationRefund.
  ///
  /// In en, this message translates to:
  /// **'Destination refund'**
  String get destinationRefund;

  /// No description provided for @destinationRefundWithCode.
  ///
  /// In en, this message translates to:
  /// **'Destination refund • {trackingCode}'**
  String destinationRefundWithCode(Object trackingCode);

  /// No description provided for @returnToCardRequestedStatus.
  ///
  /// In en, this message translates to:
  /// **'Return to card requested'**
  String get returnToCardRequestedStatus;

  /// No description provided for @returnedToCard.
  ///
  /// In en, this message translates to:
  /// **'Returned to card'**
  String get returnedToCard;

  /// No description provided for @noWalletActivityYet.
  ///
  /// In en, this message translates to:
  /// **'No wallet activity yet.'**
  String get noWalletActivityYet;

  /// No description provided for @walletActivityUnavailable.
  ///
  /// In en, this message translates to:
  /// **'We could not load your wallet activity right now. Please try again in a moment.'**
  String get walletActivityUnavailable;

  /// No description provided for @signInToViewWallet.
  ///
  /// In en, this message translates to:
  /// **'Sign in to view your wallet.'**
  String get signInToViewWallet;

  /// No description provided for @decline.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get decline;

  /// No description provided for @accept.
  ///
  /// In en, this message translates to:
  /// **'Accept'**
  String get accept;

  /// No description provided for @saveShipmentChangesQuestion.
  ///
  /// In en, this message translates to:
  /// **'Save shipment changes?'**
  String get saveShipmentChangesQuestion;

  /// No description provided for @saveShipmentChangesMessage.
  ///
  /// In en, this message translates to:
  /// **'This will update the shipment details. Destination changes may adjust the customer wallet or payment totals.'**
  String get saveShipmentChangesMessage;

  /// No description provided for @saveChanges.
  ///
  /// In en, this message translates to:
  /// **'Save changes'**
  String get saveChanges;

  /// No description provided for @sender.
  ///
  /// In en, this message translates to:
  /// **'Sender'**
  String get sender;

  /// No description provided for @senderQuestion.
  ///
  /// In en, this message translates to:
  /// **'Who is sending the barrel?'**
  String get senderQuestion;

  /// No description provided for @pickup.
  ///
  /// In en, this message translates to:
  /// **'Pickup'**
  String get pickup;

  /// No description provided for @pickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup address'**
  String get pickupAddress;

  /// No description provided for @receiver.
  ///
  /// In en, this message translates to:
  /// **'Receiver'**
  String get receiver;

  /// No description provided for @receiverQuestion.
  ///
  /// In en, this message translates to:
  /// **'Who should receive it overseas?'**
  String get receiverQuestion;

  /// No description provided for @destination.
  ///
  /// In en, this message translates to:
  /// **'Destination'**
  String get destination;

  /// No description provided for @staffControls.
  ///
  /// In en, this message translates to:
  /// **'Staff controls'**
  String get staffControls;

  /// No description provided for @trackingUpdatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Tracking updates'**
  String get trackingUpdatesTitle;

  /// No description provided for @trackingUpdatesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No updates yet.'**
  String get trackingUpdatesEmpty;

  /// No description provided for @addTrackingUpdate.
  ///
  /// In en, this message translates to:
  /// **'Add update'**
  String get addTrackingUpdate;

  /// No description provided for @trackingUpdateAdded.
  ///
  /// In en, this message translates to:
  /// **'Tracking update added.'**
  String get trackingUpdateAdded;

  /// No description provided for @trackingUpdateLabel.
  ///
  /// In en, this message translates to:
  /// **'What happened'**
  String get trackingUpdateLabel;

  /// No description provided for @trackingUpdateLabelHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Departed origin port'**
  String get trackingUpdateLabelHint;

  /// No description provided for @trackingUpdateLabelRequired.
  ///
  /// In en, this message translates to:
  /// **'Please describe what happened.'**
  String get trackingUpdateLabelRequired;

  /// No description provided for @trackingUpdateLocation.
  ///
  /// In en, this message translates to:
  /// **'Location (optional)'**
  String get trackingUpdateLocation;

  /// No description provided for @trackingUpdateNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes (optional)'**
  String get trackingUpdateNotes;

  /// No description provided for @containerTrackingTitle.
  ///
  /// In en, this message translates to:
  /// **'Automated container tracking'**
  String get containerTrackingTitle;

  /// No description provided for @containerTrackingDescription.
  ///
  /// In en, this message translates to:
  /// **'Enter the container, booking, or bill of lading number from the carrier to get automatic tracking updates.'**
  String get containerTrackingDescription;

  /// No description provided for @containerNumberLabel.
  ///
  /// In en, this message translates to:
  /// **'Container / booking / BOL number'**
  String get containerNumberLabel;

  /// No description provided for @containerNumberHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. MSKU1234567'**
  String get containerNumberHint;

  /// No description provided for @carrierCodeOptionalLabel.
  ///
  /// In en, this message translates to:
  /// **'Carrier SCAC code (optional)'**
  String get carrierCodeOptionalLabel;

  /// No description provided for @startTrackingButton.
  ///
  /// In en, this message translates to:
  /// **'Start tracking'**
  String get startTrackingButton;

  /// No description provided for @containerNumberRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid tracking number.'**
  String get containerNumberRequired;

  /// No description provided for @containerTrackingStarted.
  ///
  /// In en, this message translates to:
  /// **'Automated tracking started.'**
  String get containerTrackingStarted;

  /// No description provided for @automatedTrackingActive.
  ///
  /// In en, this message translates to:
  /// **'Automated tracking active'**
  String get automatedTrackingActive;

  /// No description provided for @automatedTrackingUpdatesPending.
  ///
  /// In en, this message translates to:
  /// **'Automated updates are not yet flowing for this carrier account. Add manual updates below in the meantime.'**
  String get automatedTrackingUpdatesPending;

  /// No description provided for @shippingBusiness.
  ///
  /// In en, this message translates to:
  /// **'Shipping business'**
  String get shippingBusiness;

  /// No description provided for @currentBusiness.
  ///
  /// In en, this message translates to:
  /// **'Current business'**
  String get currentBusiness;

  /// No description provided for @newRoute.
  ///
  /// In en, this message translates to:
  /// **'New route'**
  String get newRoute;

  /// No description provided for @copyTrackingNumber.
  ///
  /// In en, this message translates to:
  /// **'Copy tracking number'**
  String get copyTrackingNumber;

  /// No description provided for @receipt.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get receipt;

  /// No description provided for @dropOffOffice.
  ///
  /// In en, this message translates to:
  /// **'Drop-off office'**
  String get dropOffOffice;

  /// No description provided for @requestBarrelShipmentQuestion.
  ///
  /// In en, this message translates to:
  /// **'Request barrel shipment?'**
  String get requestBarrelShipmentQuestion;

  /// No description provided for @requestBarrelShipmentMessage.
  ///
  /// In en, this message translates to:
  /// **'This will create the shipment and start payment for the estimated total.'**
  String get requestBarrelShipmentMessage;

  /// No description provided for @payAndRequest.
  ///
  /// In en, this message translates to:
  /// **'Pay and request'**
  String get payAndRequest;

  /// No description provided for @pickUp.
  ///
  /// In en, this message translates to:
  /// **'Pick up'**
  String get pickUp;

  /// No description provided for @bringToOffice.
  ///
  /// In en, this message translates to:
  /// **'Bring to office'**
  String get bringToOffice;

  /// No description provided for @locationPermissionDenied.
  ///
  /// In en, this message translates to:
  /// **'Location permission denied.'**
  String get locationPermissionDenied;

  /// No description provided for @couldNotGetLocation.
  ///
  /// In en, this message translates to:
  /// **'Could not get location. Try again.'**
  String get couldNotGetLocation;

  /// No description provided for @pickupAddressInNyc.
  ///
  /// In en, this message translates to:
  /// **'Pickup address in NYC'**
  String get pickupAddressInNyc;

  /// No description provided for @submitTransportRequestQuestion.
  ///
  /// In en, this message translates to:
  /// **'Submit transport request?'**
  String get submitTransportRequestQuestion;

  /// No description provided for @submitTransportRequestMessage.
  ///
  /// In en, this message translates to:
  /// **'This will create a transport request for staff to manage and track.'**
  String get submitTransportRequestMessage;

  /// No description provided for @submitRequest.
  ///
  /// In en, this message translates to:
  /// **'Submit request'**
  String get submitRequest;

  /// No description provided for @barrelShippingPrice.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipping price'**
  String get barrelShippingPrice;

  /// No description provided for @minDeliveryDays.
  ///
  /// In en, this message translates to:
  /// **'Min delivery days'**
  String get minDeliveryDays;

  /// No description provided for @maxDeliveryDays.
  ///
  /// In en, this message translates to:
  /// **'Max delivery days'**
  String get maxDeliveryDays;

  /// No description provided for @officeAddress.
  ///
  /// In en, this message translates to:
  /// **'Office address'**
  String get officeAddress;

  /// No description provided for @barrelPickupPricing.
  ///
  /// In en, this message translates to:
  /// **'Barrel pickup pricing'**
  String get barrelPickupPricing;

  /// No description provided for @searchCountriesCodesFlags.
  ///
  /// In en, this message translates to:
  /// **'Search countries, codes, or flags'**
  String get searchCountriesCodesFlags;

  /// No description provided for @business.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get business;

  /// No description provided for @status.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get status;

  /// No description provided for @pending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get pending;

  /// No description provided for @approved.
  ///
  /// In en, this message translates to:
  /// **'Approved'**
  String get approved;

  /// No description provided for @suspended.
  ///
  /// In en, this message translates to:
  /// **'Suspended'**
  String get suspended;

  /// No description provided for @saveBusiness.
  ///
  /// In en, this message translates to:
  /// **'Save business'**
  String get saveBusiness;

  /// No description provided for @addBusiness.
  ///
  /// In en, this message translates to:
  /// **'Add business'**
  String get addBusiness;

  /// No description provided for @updatePurchaseStatusQuestion.
  ///
  /// In en, this message translates to:
  /// **'Update purchase status?'**
  String get updatePurchaseStatusQuestion;

  /// No description provided for @updatePurchaseStatusMessage.
  ///
  /// In en, this message translates to:
  /// **'This will mark {carTitle} as {status} and update the related car record.'**
  String updatePurchaseStatusMessage(Object carTitle, Object status);

  /// No description provided for @updateStatus.
  ///
  /// In en, this message translates to:
  /// **'Update status'**
  String get updateStatus;

  /// No description provided for @accountProfile.
  ///
  /// In en, this message translates to:
  /// **'Account profile'**
  String get accountProfile;

  /// No description provided for @profileSaved.
  ///
  /// In en, this message translates to:
  /// **'Profile saved.'**
  String get profileSaved;

  /// No description provided for @phone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get phone;

  /// No description provided for @addPlatformManager.
  ///
  /// In en, this message translates to:
  /// **'Add platform manager'**
  String get addPlatformManager;

  /// No description provided for @createAdminSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Create another admin who can manage the platform'**
  String get createAdminSubtitle;

  /// No description provided for @addBusinessStaff.
  ///
  /// In en, this message translates to:
  /// **'Add business staff'**
  String get addBusinessStaff;

  /// No description provided for @createStaffSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Create a staff login under a business'**
  String get createStaffSubtitle;

  /// No description provided for @noUsersMatch.
  ///
  /// In en, this message translates to:
  /// **'No users match this view.'**
  String get noUsersMatch;

  /// No description provided for @manager.
  ///
  /// In en, this message translates to:
  /// **'Manager'**
  String get manager;

  /// No description provided for @managers.
  ///
  /// In en, this message translates to:
  /// **'Managers'**
  String get managers;

  /// No description provided for @owners.
  ///
  /// In en, this message translates to:
  /// **'Owners'**
  String get owners;

  /// No description provided for @all.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get all;

  /// No description provided for @businessStaff.
  ///
  /// In en, this message translates to:
  /// **'Business staff'**
  String get businessStaff;

  /// No description provided for @searchUsersHint.
  ///
  /// In en, this message translates to:
  /// **'Search name, email, phone, business'**
  String get searchUsersHint;

  /// No description provided for @userActions.
  ///
  /// In en, this message translates to:
  /// **'User actions'**
  String get userActions;

  /// No description provided for @setAsPlatformManager.
  ///
  /// In en, this message translates to:
  /// **'Set as platform manager'**
  String get setAsPlatformManager;

  /// No description provided for @userId.
  ///
  /// In en, this message translates to:
  /// **'User ID'**
  String get userId;

  /// No description provided for @chooseStaffBusiness.
  ///
  /// In en, this message translates to:
  /// **'Choose a business'**
  String get chooseStaffBusiness;

  /// No description provided for @ownerAccount.
  ///
  /// In en, this message translates to:
  /// **'Owner account'**
  String get ownerAccount;

  /// No description provided for @ownerFullName.
  ///
  /// In en, this message translates to:
  /// **'Owner full name'**
  String get ownerFullName;

  /// No description provided for @ownerPhone.
  ///
  /// In en, this message translates to:
  /// **'Owner phone'**
  String get ownerPhone;

  /// No description provided for @ownerEmail.
  ///
  /// In en, this message translates to:
  /// **'Owner email'**
  String get ownerEmail;

  /// No description provided for @servicesYouOffer.
  ///
  /// In en, this message translates to:
  /// **'Services you offer'**
  String get servicesYouOffer;

  /// No description provided for @submitBusinessApplicationQuestion.
  ///
  /// In en, this message translates to:
  /// **'Submit business application?'**
  String get submitBusinessApplicationQuestion;

  /// No description provided for @submitBusinessApplicationMessage.
  ///
  /// In en, this message translates to:
  /// **'This will create your business account request and open dashboard setup for the selected services.'**
  String get submitBusinessApplicationMessage;

  /// No description provided for @submitApplication.
  ///
  /// In en, this message translates to:
  /// **'Submit application'**
  String get submitApplication;

  /// No description provided for @chooseAtLeastOneBusinessService.
  ///
  /// In en, this message translates to:
  /// **'Choose at least one business service.'**
  String get chooseAtLeastOneBusinessService;

  /// No description provided for @reserveViewingQuestion.
  ///
  /// In en, this message translates to:
  /// **'Reserve viewing?'**
  String get reserveViewingQuestion;

  /// No description provided for @reserveViewingConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'This will reserve your selected viewing time for this car.'**
  String get reserveViewingConfirmMessage;

  /// No description provided for @purchaseCarQuestion.
  ///
  /// In en, this message translates to:
  /// **'Purchase this car?'**
  String get purchaseCarQuestion;

  /// No description provided for @purchaseCarConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'This will start checkout and create a purchase record for this car.'**
  String get purchaseCarConfirmMessage;

  /// No description provided for @continueToPayment.
  ///
  /// In en, this message translates to:
  /// **'Continue to payment'**
  String get continueToPayment;

  /// No description provided for @signUpFailedTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Sign up failed. Please try again.'**
  String get signUpFailedTryAgain;

  /// No description provided for @noApprovedDestinationsAvailable.
  ///
  /// In en, this message translates to:
  /// **'No active approved business destinations are available.'**
  String get noApprovedDestinationsAvailable;

  /// No description provided for @trackingNumberCopiedShort.
  ///
  /// In en, this message translates to:
  /// **'Tracking number copied.'**
  String get trackingNumberCopiedShort;

  /// No description provided for @copy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get copy;

  /// No description provided for @activeShort.
  ///
  /// In en, this message translates to:
  /// **'Active'**
  String get activeShort;

  /// No description provided for @pickupShort.
  ///
  /// In en, this message translates to:
  /// **'Pickup'**
  String get pickupShort;

  /// No description provided for @doneShort.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get doneShort;

  /// No description provided for @platformDashboard.
  ///
  /// In en, this message translates to:
  /// **'Platform dashboard'**
  String get platformDashboard;

  /// No description provided for @platformDashboardSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Applications, businesses, operations, refunds, and marketplace health.'**
  String get platformDashboardSubtitle;

  /// No description provided for @pendingBusinesses.
  ///
  /// In en, this message translates to:
  /// **'Pending businesses'**
  String get pendingBusinesses;

  /// No description provided for @approvedBusinesses.
  ///
  /// In en, this message translates to:
  /// **'Approved businesses'**
  String get approvedBusinesses;

  /// No description provided for @customers.
  ///
  /// In en, this message translates to:
  /// **'Customers'**
  String get customers;

  /// No description provided for @openShipments.
  ///
  /// In en, this message translates to:
  /// **'Open shipments'**
  String get openShipments;

  /// No description provided for @pendingPurchases.
  ///
  /// In en, this message translates to:
  /// **'Pending purchases'**
  String get pendingPurchases;

  /// No description provided for @refundRequests.
  ///
  /// In en, this message translates to:
  /// **'Refund requests'**
  String get refundRequests;

  /// No description provided for @refundRequest.
  ///
  /// In en, this message translates to:
  /// **'Refund request'**
  String get refundRequest;

  /// No description provided for @amountLabel.
  ///
  /// In en, this message translates to:
  /// **'Amount: {amount}'**
  String amountLabel(Object amount);

  /// No description provided for @customerLabel.
  ///
  /// In en, this message translates to:
  /// **'Customer: {customer}'**
  String customerLabel(Object customer);

  /// No description provided for @statusLabelValue.
  ///
  /// In en, this message translates to:
  /// **'Status: {status}'**
  String statusLabelValue(Object status);

  /// No description provided for @businessLabel.
  ///
  /// In en, this message translates to:
  /// **'Business: {business}'**
  String businessLabel(Object business);

  /// No description provided for @close.
  ///
  /// In en, this message translates to:
  /// **'Close'**
  String get close;

  /// No description provided for @platformManagerCreated.
  ///
  /// In en, this message translates to:
  /// **'Platform manager created.'**
  String get platformManagerCreated;

  /// No description provided for @temporaryPassword.
  ///
  /// In en, this message translates to:
  /// **'Temporary password'**
  String get temporaryPassword;

  /// No description provided for @actionQueue.
  ///
  /// In en, this message translates to:
  /// **'Action queue'**
  String get actionQueue;

  /// No description provided for @review.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get review;

  /// No description provided for @businessManagement.
  ///
  /// In en, this message translates to:
  /// **'Business management'**
  String get businessManagement;

  /// No description provided for @openFullList.
  ///
  /// In en, this message translates to:
  /// **'Open full list'**
  String get openFullList;

  /// No description provided for @financeReadiness.
  ///
  /// In en, this message translates to:
  /// **'Finance readiness'**
  String get financeReadiness;

  /// No description provided for @recentOperations.
  ///
  /// In en, this message translates to:
  /// **'Recent operations'**
  String get recentOperations;

  /// No description provided for @businessReviewSaved.
  ///
  /// In en, this message translates to:
  /// **'Business review saved.'**
  String get businessReviewSaved;

  /// No description provided for @reviewAction.
  ///
  /// In en, this message translates to:
  /// **'Review action'**
  String get reviewAction;

  /// No description provided for @approve.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get approve;

  /// No description provided for @suspend.
  ///
  /// In en, this message translates to:
  /// **'Suspend'**
  String get suspend;

  /// No description provided for @reject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get reject;

  /// No description provided for @sharedBarrelManageRequests.
  ///
  /// In en, this message translates to:
  /// **'Manage requests'**
  String get sharedBarrelManageRequests;

  /// No description provided for @sharedBarrelJoinRequests.
  ///
  /// In en, this message translates to:
  /// **'Join requests'**
  String get sharedBarrelJoinRequests;

  /// No description provided for @sharedBarrelJoinRequestsHelp.
  ///
  /// In en, this message translates to:
  /// **'Approve or reject customers waiting to join this shared barrel.'**
  String get sharedBarrelJoinRequestsHelp;

  /// No description provided for @sharedBarrelNoPendingRequests.
  ///
  /// In en, this message translates to:
  /// **'No join requests are waiting for approval.'**
  String get sharedBarrelNoPendingRequests;

  /// No description provided for @sharedBarrelRequestApproved.
  ///
  /// In en, this message translates to:
  /// **'Join request approved.'**
  String get sharedBarrelRequestApproved;

  /// No description provided for @sharedBarrelRequestRejected.
  ///
  /// In en, this message translates to:
  /// **'Join request rejected. The deposit will be sent for refund.'**
  String get sharedBarrelRequestRejected;

  /// No description provided for @sharedBarrelRequestDecisionFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not update this request. Please try again.'**
  String get sharedBarrelRequestDecisionFailed;

  /// No description provided for @sharedBarrelRequestedShareCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 share requested} other{{count} shares requested}}'**
  String sharedBarrelRequestedShareCount(int count);

  /// No description provided for @sharedBarrelPaidDeposit.
  ///
  /// In en, this message translates to:
  /// **'Deposit paid: {amount}'**
  String sharedBarrelPaidDeposit(Object amount);

  /// No description provided for @sharedBarrelCancelPool.
  ///
  /// In en, this message translates to:
  /// **'Cancel pool'**
  String get sharedBarrelCancelPool;

  /// No description provided for @sharedBarrelCancelTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this shared barrel?'**
  String get sharedBarrelCancelTitle;

  /// No description provided for @sharedBarrelCancelForfeitureMessage.
  ///
  /// In en, this message translates to:
  /// **'If you cancel now, your {amount} deposit will be forfeited. This cannot be undone.'**
  String sharedBarrelCancelForfeitureMessage(Object amount);

  /// No description provided for @sharedBarrelKeepPool.
  ///
  /// In en, this message translates to:
  /// **'Keep pool'**
  String get sharedBarrelKeepPool;

  /// No description provided for @sharedBarrelCancelAndForfeit.
  ///
  /// In en, this message translates to:
  /// **'Cancel and forfeit deposit'**
  String get sharedBarrelCancelAndForfeit;

  /// No description provided for @requestChanges.
  ///
  /// In en, this message translates to:
  /// **'Request changes'**
  String get requestChanges;

  /// No description provided for @reviewNote.
  ///
  /// In en, this message translates to:
  /// **'Review note'**
  String get reviewNote;

  /// No description provided for @requestId.
  ///
  /// In en, this message translates to:
  /// **'Request ID: {id}'**
  String requestId(Object id);

  /// No description provided for @finalReceiptGenerated.
  ///
  /// In en, this message translates to:
  /// **'Final receipt generated and status set to completed.'**
  String get finalReceiptGenerated;

  /// No description provided for @updateRecord.
  ///
  /// In en, this message translates to:
  /// **'Update Record'**
  String get updateRecord;

  /// No description provided for @generateFinalReceipt.
  ///
  /// In en, this message translates to:
  /// **'Generate Final Receipt'**
  String get generateFinalReceipt;

  /// No description provided for @parkingStartDate.
  ///
  /// In en, this message translates to:
  /// **'Parking Start Date'**
  String get parkingStartDate;

  /// No description provided for @parkingEndDate.
  ///
  /// In en, this message translates to:
  /// **'Parking End Date'**
  String get parkingEndDate;

  /// No description provided for @businessMoreTools.
  ///
  /// In en, this message translates to:
  /// **'More tools'**
  String get businessMoreTools;

  /// No description provided for @businessReviewsTitle.
  ///
  /// In en, this message translates to:
  /// **'Reviews'**
  String get businessReviewsTitle;

  /// No description provided for @businessReviewsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No reviews yet. They appear here once customers rate a job.'**
  String get businessReviewsEmpty;

  /// No description provided for @businessReviewsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 review} other{{count} reviews}}'**
  String businessReviewsCount(int count);

  /// No description provided for @businessPeopleTitle.
  ///
  /// In en, this message translates to:
  /// **'People'**
  String get businessPeopleTitle;

  /// No description provided for @businessServicesCoverageTitle.
  ///
  /// In en, this message translates to:
  /// **'Services & coverage'**
  String get businessServicesCoverageTitle;

  /// No description provided for @businessListingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle listings'**
  String get businessListingsTitle;

  /// No description provided for @businessPurchasesTitle.
  ///
  /// In en, this message translates to:
  /// **'Purchases & viewings'**
  String get businessPurchasesTitle;

  /// No description provided for @businessRecordNotFound.
  ///
  /// In en, this message translates to:
  /// **'That record is no longer available, so here is the list it came from.'**
  String get businessRecordNotFound;

  /// No description provided for @lotLedgerTitle.
  ///
  /// In en, this message translates to:
  /// **'Lot ledger'**
  String get lotLedgerTitle;

  /// No description provided for @businessOfficesTitle.
  ///
  /// In en, this message translates to:
  /// **'Offices & pickup points'**
  String get businessOfficesTitle;

  /// No description provided for @lotSavedCustomers.
  ///
  /// In en, this message translates to:
  /// **'Saved customers'**
  String get lotSavedCustomers;

  /// No description provided for @lotTheirCars.
  ///
  /// In en, this message translates to:
  /// **'Their cars'**
  String get lotTheirCars;

  /// No description provided for @lotOpenReceipt.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get lotOpenReceipt;

  /// No description provided for @lotOpenInvoice.
  ///
  /// In en, this message translates to:
  /// **'Invoice'**
  String get lotOpenInvoice;

  /// No description provided for @lotDocumentCouldNotBeOpened.
  ///
  /// In en, this message translates to:
  /// **'The receipt could not be opened. Try again in a moment.'**
  String get lotDocumentCouldNotBeOpened;

  /// No description provided for @lotUseThisCustomer.
  ///
  /// In en, this message translates to:
  /// **'Use this customer'**
  String get lotUseThisCustomer;

  /// No description provided for @parkingEndDateOptional.
  ///
  /// In en, this message translates to:
  /// **'Parking end date (optional)'**
  String get parkingEndDateOptional;

  /// No description provided for @parkingOpenEnded.
  ///
  /// In en, this message translates to:
  /// **'Open-ended'**
  String get parkingOpenEnded;

  /// No description provided for @parkingOpenEndedHint.
  ///
  /// In en, this message translates to:
  /// **'Leave blank for an open-ended stay — bill it through today whenever you like.'**
  String get parkingOpenEndedHint;

  /// No description provided for @parkingClearEndDate.
  ///
  /// In en, this message translates to:
  /// **'Clear end date'**
  String get parkingClearEndDate;

  /// No description provided for @costPerDay.
  ///
  /// In en, this message translates to:
  /// **'Cost Per Day (\$)'**
  String get costPerDay;

  /// No description provided for @selectCountriesAddFees.
  ///
  /// In en, this message translates to:
  /// **'Choose countries and select what this business offers for each destination.'**
  String get selectCountriesAddFees;

  /// No description provided for @activeDestinationsHaveFees.
  ///
  /// In en, this message translates to:
  /// **'{priced} of {total} active destinations have services configured.'**
  String activeDestinationsHaveFees(Object priced, Object total);

  /// No description provided for @selectDestinationCountries.
  ///
  /// In en, this message translates to:
  /// **'Select destination services'**
  String get selectDestinationCountries;

  /// No description provided for @manageDestinationsFees.
  ///
  /// In en, this message translates to:
  /// **'Manage destinations and services'**
  String get manageDestinationsFees;

  /// No description provided for @officeLocations.
  ///
  /// In en, this message translates to:
  /// **'Office locations'**
  String get officeLocations;

  /// No description provided for @addOfficeLocation.
  ///
  /// In en, this message translates to:
  /// **'Add office location'**
  String get addOfficeLocation;

  /// No description provided for @editOfficeLocation.
  ///
  /// In en, this message translates to:
  /// **'Edit office location'**
  String get editOfficeLocation;

  /// No description provided for @manageOfficeLocations.
  ///
  /// In en, this message translates to:
  /// **'Manage office locations'**
  String get manageOfficeLocations;

  /// No description provided for @officeLocationHelp.
  ///
  /// In en, this message translates to:
  /// **'Where can customers physically drop off items?'**
  String get officeLocationHelp;

  /// No description provided for @addOfficeLocationsHelp.
  ///
  /// In en, this message translates to:
  /// **'Additional offices are optional. Customers already drop off at your headquarters address unless you add extra locations.'**
  String get addOfficeLocationsHelp;

  /// No description provided for @locationName.
  ///
  /// In en, this message translates to:
  /// **'Location name'**
  String get locationName;

  /// No description provided for @activeOfficeLocationsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} active office {count, plural, one{location} other{locations}}.'**
  String activeOfficeLocationsCount(num count);

  /// No description provided for @chooseALocation.
  ///
  /// In en, this message translates to:
  /// **'Choose a location'**
  String get chooseALocation;

  /// No description provided for @locationsAvailableChooseOne.
  ///
  /// In en, this message translates to:
  /// **'{count} locations available — choose one'**
  String locationsAvailableChooseOne(Object count);

  /// No description provided for @dropOffLocationsLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading drop-off locations…'**
  String get dropOffLocationsLoading;

  /// No description provided for @dropOffLocationsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Drop-off locations could not be loaded.'**
  String get dropOffLocationsLoadFailed;

  /// No description provided for @servicesForDestination.
  ///
  /// In en, this message translates to:
  /// **'Services for this destination'**
  String get servicesForDestination;

  /// No description provided for @servicesForDestinationHelp.
  ///
  /// In en, this message translates to:
  /// **'Turn on only what this business offers for this country.'**
  String get servicesForDestinationHelp;

  /// No description provided for @enableBusinessServiceBeforeDestination.
  ///
  /// In en, this message translates to:
  /// **'Enable barrel shipping, freight, or car transport on the business profile before configuring destination coverage.'**
  String get enableBusinessServiceBeforeDestination;

  /// No description provided for @destinationServiceCoverageTitle.
  ///
  /// In en, this message translates to:
  /// **'Destination services'**
  String get destinationServiceCoverageTitle;

  /// No description provided for @destinationServiceCoverageSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Set which services are available for this country and add rates where needed.'**
  String get destinationServiceCoverageSubtitle;

  /// No description provided for @offerBarrelShipping.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipping'**
  String get offerBarrelShipping;

  /// No description provided for @barrelShippingDestinationHelper.
  ///
  /// In en, this message translates to:
  /// **'Customers can send barrels to this country.'**
  String get barrelShippingDestinationHelper;

  /// No description provided for @offerFreightAir.
  ///
  /// In en, this message translates to:
  /// **'Freight by air'**
  String get offerFreightAir;

  /// No description provided for @freightAirDestinationHelper.
  ///
  /// In en, this message translates to:
  /// **'Customers can ship parcels by air to this country.'**
  String get freightAirDestinationHelper;

  /// No description provided for @offerFreightSea.
  ///
  /// In en, this message translates to:
  /// **'Freight by sea'**
  String get offerFreightSea;

  /// No description provided for @freightSeaDestinationHelper.
  ///
  /// In en, this message translates to:
  /// **'Customers can ship parcels by sea to this country.'**
  String get freightSeaDestinationHelper;

  /// No description provided for @offerCarTransportDestination.
  ///
  /// In en, this message translates to:
  /// **'Ship cars to this country'**
  String get offerCarTransportDestination;

  /// No description provided for @carTransportDestinationHelper.
  ///
  /// In en, this message translates to:
  /// **'Customers can request a car transport quote for this country.'**
  String get carTransportDestinationHelper;

  /// No description provided for @freightAirRatePerKg.
  ///
  /// In en, this message translates to:
  /// **'Air freight rate per kg'**
  String get freightAirRatePerKg;

  /// No description provided for @freightSeaRatePerKg.
  ///
  /// In en, this message translates to:
  /// **'Sea freight rate per kg'**
  String get freightSeaRatePerKg;

  /// No description provided for @chooseAtLeastOneDestinationService.
  ///
  /// In en, this message translates to:
  /// **'Choose at least one service for this destination.'**
  String get chooseAtLeastOneDestinationService;

  /// No description provided for @destinationServiceRateRequired.
  ///
  /// In en, this message translates to:
  /// **'Add a rate for {service}.'**
  String destinationServiceRateRequired(Object service);

  /// No description provided for @destinationServiceRateGreaterThanZero.
  ///
  /// In en, this message translates to:
  /// **'{service} needs a rate greater than 0.'**
  String destinationServiceRateGreaterThanZero(Object service);

  /// No description provided for @destinationBarrelService.
  ///
  /// In en, this message translates to:
  /// **'Barrel'**
  String get destinationBarrelService;

  /// No description provided for @destinationFreightAir.
  ///
  /// In en, this message translates to:
  /// **'Air freight'**
  String get destinationFreightAir;

  /// No description provided for @destinationFreightSea.
  ///
  /// In en, this message translates to:
  /// **'Sea freight'**
  String get destinationFreightSea;

  /// No description provided for @destinationCarTransport.
  ///
  /// In en, this message translates to:
  /// **'Car transport'**
  String get destinationCarTransport;

  /// No description provided for @destinationServicePriceSummary.
  ///
  /// In en, this message translates to:
  /// **'{service}: {price}'**
  String destinationServicePriceSummary(Object service, Object price);

  /// No description provided for @destinationServiceRateSummary.
  ///
  /// In en, this message translates to:
  /// **'{service}: {rate}/kg'**
  String destinationServiceRateSummary(Object service, Object rate);

  /// No description provided for @noDestinationServicesConfigured.
  ///
  /// In en, this message translates to:
  /// **'No services configured'**
  String get noDestinationServicesConfigured;

  /// No description provided for @businessNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Business name is required'**
  String get businessNameRequired;

  /// No description provided for @businessPhoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Business phone is required'**
  String get businessPhoneRequired;

  /// No description provided for @validBusinessPhoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid business phone'**
  String get validBusinessPhoneRequired;

  /// No description provided for @pickupCollectNyc.
  ///
  /// In en, this message translates to:
  /// **'We will collect it from a NYC address.'**
  String get pickupCollectNyc;

  /// No description provided for @pickupBringOffice.
  ///
  /// In en, this message translates to:
  /// **'You will bring it to the office.'**
  String get pickupBringOffice;

  /// No description provided for @pleaseEnterPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Please enter the pickup address'**
  String get pleaseEnterPickupAddress;

  /// No description provided for @pleaseIncludeNycBoroughZip.
  ///
  /// In en, this message translates to:
  /// **'Please include the NYC borough or ZIP code'**
  String get pleaseIncludeNycBoroughZip;

  /// No description provided for @pleaseChoosePickupDateTime.
  ///
  /// In en, this message translates to:
  /// **'Please choose pickup date and time'**
  String get pleaseChoosePickupDateTime;

  /// No description provided for @pickupTimeFuture.
  ///
  /// In en, this message translates to:
  /// **'Pickup time must be in the future'**
  String get pickupTimeFuture;

  /// No description provided for @destinationSubtitleEstimateRoute.
  ///
  /// In en, this message translates to:
  /// **'Choose the country so we can estimate the route.'**
  String get destinationSubtitleEstimateRoute;

  /// No description provided for @pickupAddressNycHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 3184 Webster Ave, Bronx, NY 10467'**
  String get pickupAddressNycHint;

  /// No description provided for @pleaseAskStaffSetBarrelPrice.
  ///
  /// In en, this message translates to:
  /// **'Please ask staff to set a barrel shipping price for this destination before saving.'**
  String get pleaseAskStaffSetBarrelPrice;

  /// No description provided for @staffControlsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Update internal status and final price.'**
  String get staffControlsSubtitle;

  /// No description provided for @officeDropOff.
  ///
  /// In en, this message translates to:
  /// **'Office drop-off'**
  String get officeDropOff;

  /// No description provided for @deliveryWithLabel.
  ///
  /// In en, this message translates to:
  /// **'Delivery {label}'**
  String deliveryWithLabel(Object label);

  /// No description provided for @addBarrelFeeBeforeActivating.
  ///
  /// In en, this message translates to:
  /// **'Add a barrel shipping fee before activating.'**
  String get addBarrelFeeBeforeActivating;

  /// No description provided for @activeDestinationsNeedFee.
  ///
  /// In en, this message translates to:
  /// **'Active destinations need a barrel shipping fee greater than 0.'**
  String get activeDestinationsNeedFee;

  /// No description provided for @addMinimumDeliveryDays.
  ///
  /// In en, this message translates to:
  /// **'Add minimum delivery days.'**
  String get addMinimumDeliveryDays;

  /// No description provided for @addMaximumDeliveryDays.
  ///
  /// In en, this message translates to:
  /// **'Add maximum delivery days.'**
  String get addMaximumDeliveryDays;

  /// No description provided for @useWholeCalendarDays.
  ///
  /// In en, this message translates to:
  /// **'Use whole calendar days.'**
  String get useWholeCalendarDays;

  /// No description provided for @deliveryDaysGreaterThanZero.
  ///
  /// In en, this message translates to:
  /// **'Delivery days must be greater than 0.'**
  String get deliveryDaysGreaterThanZero;

  /// No description provided for @maxDaysAtLeastMin.
  ///
  /// In en, this message translates to:
  /// **'Maximum days must be at least the minimum.'**
  String get maxDaysAtLeastMin;

  /// No description provided for @firebaseDeniedDeployRules.
  ///
  /// In en, this message translates to:
  /// **'Firebase denied access. Deploy the local Firestore rules and functions, then seed the country catalog.'**
  String get firebaseDeniedDeployRules;

  /// No description provided for @optionalDeliveryEstimateNote.
  ///
  /// In en, this message translates to:
  /// **'Optional calendar-day estimate shown to customers.'**
  String get optionalDeliveryEstimateNote;

  /// No description provided for @pickupPriceLabel.
  ///
  /// In en, this message translates to:
  /// **'{borough} pickup price'**
  String pickupPriceLabel(Object borough);

  /// No description provided for @editBusiness.
  ///
  /// In en, this message translates to:
  /// **'Edit business'**
  String get editBusiness;

  /// No description provided for @nameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get nameLabel;

  /// No description provided for @businessesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No businesses yet.'**
  String get businessesEmpty;

  /// No description provided for @chooseStaffBusinessMessage.
  ///
  /// In en, this message translates to:
  /// **'Choose the business this staff member belongs to.'**
  String get chooseStaffBusinessMessage;

  /// No description provided for @phoneNumberRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter a phone number'**
  String get phoneNumberRequired;

  /// No description provided for @pleaseSelectCarMake.
  ///
  /// In en, this message translates to:
  /// **'Please select car make'**
  String get pleaseSelectCarMake;

  /// No description provided for @pleaseSelectCarModel.
  ///
  /// In en, this message translates to:
  /// **'Please select car model'**
  String get pleaseSelectCarModel;

  /// No description provided for @pleaseSelectYear.
  ///
  /// In en, this message translates to:
  /// **'Please select year'**
  String get pleaseSelectYear;

  /// No description provided for @ownerNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter owner name'**
  String get ownerNameRequired;

  /// No description provided for @carIdentityRequired.
  ///
  /// In en, this message translates to:
  /// **'Please make sure car make, model, and year are selected.'**
  String get carIdentityRequired;

  /// No description provided for @recordUpdated.
  ///
  /// In en, this message translates to:
  /// **'Record updated successfully!'**
  String get recordUpdated;

  /// No description provided for @failedToUpdateRecord.
  ///
  /// In en, this message translates to:
  /// **'Failed to update record: {error}'**
  String failedToUpdateRecord(Object error);

  /// No description provided for @addParkingEndAndDailyCost.
  ///
  /// In en, this message translates to:
  /// **'Please add an end date and daily cost first.'**
  String get addParkingEndAndDailyCost;

  /// No description provided for @carIdentityReceiptRequired.
  ///
  /// In en, this message translates to:
  /// **'Car make, model, and year must be set before generating a receipt.'**
  String get carIdentityReceiptRequired;

  /// No description provided for @endDateBeforeStart.
  ///
  /// In en, this message translates to:
  /// **'End date cannot be before start date.'**
  String get endDateBeforeStart;

  /// No description provided for @finalReceiptGeneratedCompleted.
  ///
  /// In en, this message translates to:
  /// **'Final receipt generated and status set to completed.'**
  String get finalReceiptGeneratedCompleted;

  /// No description provided for @failedToGenerateReceipt.
  ///
  /// In en, this message translates to:
  /// **'Failed to generate receipt: {error}'**
  String failedToGenerateReceipt(Object error);

  /// No description provided for @costPerDayCurrency.
  ///
  /// In en, this message translates to:
  /// **'Cost Per Day (\$)'**
  String get costPerDayCurrency;

  /// No description provided for @carParkingReceipt.
  ///
  /// In en, this message translates to:
  /// **'CAR PARKING RECEIPT'**
  String get carParkingReceipt;

  /// No description provided for @businessServices.
  ///
  /// In en, this message translates to:
  /// **'Business Services'**
  String get businessServices;

  /// No description provided for @receiptDetails.
  ///
  /// In en, this message translates to:
  /// **'Receipt Details'**
  String get receiptDetails;

  /// No description provided for @receiptNumber.
  ///
  /// In en, this message translates to:
  /// **'Receipt Number:'**
  String get receiptNumber;

  /// No description provided for @trackingNumberPdf.
  ///
  /// In en, this message translates to:
  /// **'Tracking Number:'**
  String get trackingNumberPdf;

  /// No description provided for @generatedOn.
  ///
  /// In en, this message translates to:
  /// **'Generated On:'**
  String get generatedOn;

  /// No description provided for @carInformation.
  ///
  /// In en, this message translates to:
  /// **'Car Information'**
  String get carInformation;

  /// No description provided for @ownerNamePdf.
  ///
  /// In en, this message translates to:
  /// **'Owner Name:'**
  String get ownerNamePdf;

  /// No description provided for @carMakePdf.
  ///
  /// In en, this message translates to:
  /// **'Car Make:'**
  String get carMakePdf;

  /// No description provided for @carModelPdf.
  ///
  /// In en, this message translates to:
  /// **'Car Model:'**
  String get carModelPdf;

  /// No description provided for @yearPdf.
  ///
  /// In en, this message translates to:
  /// **'Year:'**
  String get yearPdf;

  /// No description provided for @vinNumberPdf.
  ///
  /// In en, this message translates to:
  /// **'VIN Number:'**
  String get vinNumberPdf;

  /// No description provided for @parkingStartPdf.
  ///
  /// In en, this message translates to:
  /// **'Parking Start:'**
  String get parkingStartPdf;

  /// No description provided for @parkingEndPdf.
  ///
  /// In en, this message translates to:
  /// **'Parking End:'**
  String get parkingEndPdf;

  /// No description provided for @totalDaysPdf.
  ///
  /// In en, this message translates to:
  /// **'Total Days:'**
  String get totalDaysPdf;

  /// No description provided for @billingSummary.
  ///
  /// In en, this message translates to:
  /// **'Billing Summary'**
  String get billingSummary;

  /// No description provided for @costPerDayPdf.
  ///
  /// In en, this message translates to:
  /// **'Cost per Day:'**
  String get costPerDayPdf;

  /// No description provided for @totalCostPdf.
  ///
  /// In en, this message translates to:
  /// **'Total Cost:'**
  String get totalCostPdf;

  /// No description provided for @dateTimePdf.
  ///
  /// In en, this message translates to:
  /// **'Date & Time:'**
  String get dateTimePdf;

  /// No description provided for @parkingStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Parking Status: ACTIVE'**
  String get parkingStatusActive;

  /// No description provided for @vehicleSuccessfullyParked.
  ///
  /// In en, this message translates to:
  /// **'Vehicle has been successfully parked'**
  String get vehicleSuccessfullyParked;

  /// No description provided for @termsAndConditions.
  ///
  /// In en, this message translates to:
  /// **'Terms & Conditions'**
  String get termsAndConditions;

  /// No description provided for @parkingReceiptTerms.
  ///
  /// In en, this message translates to:
  /// **'• This receipt serves as proof of parking\n• Vehicle will be stored securely\n• Contact us for any inquiries\n• Valid until vehicle is retrieved'**
  String get parkingReceiptTerms;

  /// No description provided for @peopleAndAccess.
  ///
  /// In en, this message translates to:
  /// **'People & access'**
  String get peopleAndAccess;

  /// No description provided for @peopleAndAccessSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Manage marketplace identities, invitations, and account security.'**
  String get peopleAndAccessSubtitle;

  /// No description provided for @platformManagers.
  ///
  /// In en, this message translates to:
  /// **'Platform managers'**
  String get platformManagers;

  /// No description provided for @platformManagersCount.
  ///
  /// In en, this message translates to:
  /// **'{count} people with full platform access'**
  String platformManagersCount(Object count);

  /// No description provided for @businessTeam.
  ///
  /// In en, this message translates to:
  /// **'Business team'**
  String get businessTeam;

  /// No description provided for @businessTeamCount.
  ///
  /// In en, this message translates to:
  /// **'{count} owner/staff accounts'**
  String businessTeamCount(Object count);

  /// No description provided for @customerAccountsCount.
  ///
  /// In en, this message translates to:
  /// **'{count} shared marketplace customer accounts'**
  String customerAccountsCount(Object count);

  /// No description provided for @noEmail.
  ///
  /// In en, this message translates to:
  /// **'No email'**
  String get noEmail;

  /// No description provided for @platformManager.
  ///
  /// In en, this message translates to:
  /// **'Platform manager'**
  String get platformManager;

  /// No description provided for @businessOwner.
  ///
  /// In en, this message translates to:
  /// **'Business owner'**
  String get businessOwner;

  /// No description provided for @unassignedBusiness.
  ///
  /// In en, this message translates to:
  /// **'Unassigned business'**
  String get unassignedBusiness;

  /// No description provided for @currentDestinationShipping.
  ///
  /// In en, this message translates to:
  /// **'Current destination shipping: {amount}.'**
  String currentDestinationShipping(Object amount);

  /// No description provided for @destinationChangeCollect.
  ///
  /// In en, this message translates to:
  /// **'{amount} will be collected for the destination change.'**
  String destinationChangeCollect(Object amount);

  /// No description provided for @destinationChangeCredit.
  ///
  /// In en, this message translates to:
  /// **'{amount} will be credited to your wallet.'**
  String destinationChangeCredit(Object amount);

  /// No description provided for @destinationChangePaid.
  ///
  /// In en, this message translates to:
  /// **'Shipment updated. {amount} difference paid.'**
  String destinationChangePaid(Object amount);

  /// No description provided for @destinationChangeCredited.
  ///
  /// In en, this message translates to:
  /// **'Shipment updated. {amount} is on its way back to your card.'**
  String destinationChangeCredited(Object amount);

  /// No description provided for @shipmentDestinationUpdated.
  ///
  /// In en, this message translates to:
  /// **'Shipment destination updated.'**
  String get shipmentDestinationUpdated;

  /// No description provided for @destinationPaymentInitializationFailed.
  ///
  /// In en, this message translates to:
  /// **'The destination payment could not be initialized. Please try again.'**
  String get destinationPaymentInitializationFailed;

  /// No description provided for @paidShipmentDestinationChangeRequiresSupport.
  ///
  /// In en, this message translates to:
  /// **'This shipment has already been paid out to the business. Contact Laawol support to change its destination safely.'**
  String get paidShipmentDestinationChangeRequiresSupport;

  /// No description provided for @newRouteValue.
  ///
  /// In en, this message translates to:
  /// **'{business} to {country}'**
  String newRouteValue(Object business, Object country);

  /// No description provided for @noMatchingBusinesses.
  ///
  /// In en, this message translates to:
  /// **'No matching businesses.'**
  String get noMatchingBusinesses;

  /// No description provided for @noOpenShipments.
  ///
  /// In en, this message translates to:
  /// **'No open shipments.'**
  String get noOpenShipments;

  /// No description provided for @adminShipmentsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Shipments could not be loaded.'**
  String get adminShipmentsLoadFailed;

  /// No description provided for @adminBusinessesLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Businesses could not be loaded.'**
  String get adminBusinessesLoadFailed;

  /// No description provided for @noPendingRefundRequests.
  ///
  /// In en, this message translates to:
  /// **'No pending refund requests.'**
  String get noPendingRefundRequests;

  /// No description provided for @refundCredits.
  ///
  /// In en, this message translates to:
  /// **'Refund credits'**
  String get refundCredits;

  /// No description provided for @cardReturnRequest.
  ///
  /// In en, this message translates to:
  /// **'Card return request'**
  String get cardReturnRequest;

  /// No description provided for @customerRefundRequest.
  ///
  /// In en, this message translates to:
  /// **'Customer refund request'**
  String get customerRefundRequest;

  /// No description provided for @noBusinessApplicationsWaiting.
  ///
  /// In en, this message translates to:
  /// **'No business applications waiting.'**
  String get noBusinessApplicationsWaiting;

  /// No description provided for @noPendingWalletCardReturns.
  ///
  /// In en, this message translates to:
  /// **'No pending wallet card-return requests.'**
  String get noPendingWalletCardReturns;

  /// No description provided for @stripeConnectPlaceholders.
  ///
  /// In en, this message translates to:
  /// **'Stripe Connect placeholders are ready for future connected account, payout, and dispute monitoring.'**
  String get stripeConnectPlaceholders;

  /// No description provided for @creating.
  ///
  /// In en, this message translates to:
  /// **'Creating'**
  String get creating;

  /// No description provided for @createManager.
  ///
  /// In en, this message translates to:
  /// **'Create manager'**
  String get createManager;

  /// No description provided for @fullNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Full name is required'**
  String get fullNameRequired;

  /// No description provided for @emailRequired.
  ///
  /// In en, this message translates to:
  /// **'Email is required'**
  String get emailRequired;

  /// No description provided for @validEmailRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid email'**
  String get validEmailRequired;

  /// No description provided for @phoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Phone is required'**
  String get phoneRequired;

  /// No description provided for @passwordRequired.
  ///
  /// In en, this message translates to:
  /// **'Password is required'**
  String get passwordRequired;

  /// No description provided for @services.
  ///
  /// In en, this message translates to:
  /// **'Services'**
  String get services;

  /// No description provided for @businessIdentitySubtitle.
  ///
  /// In en, this message translates to:
  /// **'How customers and staff identify this business.'**
  String get businessIdentitySubtitle;

  /// No description provided for @businessProfileDetailsSectionError.
  ///
  /// In en, this message translates to:
  /// **'Check the highlighted business details.'**
  String get businessProfileDetailsSectionError;

  /// No description provided for @businessDefaultAddressSubtitle.
  ///
  /// In en, this message translates to:
  /// **'This is the default drop-off address for customers. Extra offices are optional.'**
  String get businessDefaultAddressSubtitle;

  /// No description provided for @paidHoldPricing.
  ///
  /// In en, this message translates to:
  /// **'Paid hold pricing'**
  String get paidHoldPricing;

  /// No description provided for @paidHoldPricingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Set the default deposit rule for customers holding cars.'**
  String get paidHoldPricingSubtitle;

  /// No description provided for @flatFee.
  ///
  /// In en, this message translates to:
  /// **'Flat fee'**
  String get flatFee;

  /// No description provided for @perDay.
  ///
  /// In en, this message translates to:
  /// **'Per day'**
  String get perDay;

  /// No description provided for @flatHoldFee.
  ///
  /// In en, this message translates to:
  /// **'Flat hold fee'**
  String get flatHoldFee;

  /// No description provided for @dailyHoldRate.
  ///
  /// In en, this message translates to:
  /// **'Daily hold rate'**
  String get dailyHoldRate;

  /// No description provided for @maxDays.
  ///
  /// In en, this message translates to:
  /// **'Max days'**
  String get maxDays;

  /// No description provided for @holdMaxDaysHelper.
  ///
  /// In en, this message translates to:
  /// **'1 to 30 days'**
  String get holdMaxDaysHelper;

  /// No description provided for @parkingCapacityTitle.
  ///
  /// In en, this message translates to:
  /// **'Parking capacity'**
  String get parkingCapacityTitle;

  /// No description provided for @parkingCapacitySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Set the address, spaces, and prices customers can reserve.'**
  String get parkingCapacitySubtitle;

  /// No description provided for @parkingAddress.
  ///
  /// In en, this message translates to:
  /// **'Parking address'**
  String get parkingAddress;

  /// No description provided for @totalParkingSpaces.
  ///
  /// In en, this message translates to:
  /// **'Total spaces'**
  String get totalParkingSpaces;

  /// No description provided for @blockedParkingSpaces.
  ///
  /// In en, this message translates to:
  /// **'Blocked spaces'**
  String get blockedParkingSpaces;

  /// No description provided for @dailyParkingRate.
  ///
  /// In en, this message translates to:
  /// **'Daily parking rate'**
  String get dailyParkingRate;

  /// No description provided for @weeklyParkingRate.
  ///
  /// In en, this message translates to:
  /// **'Weekly parking rate'**
  String get weeklyParkingRate;

  /// No description provided for @monthlyParkingRate.
  ///
  /// In en, this message translates to:
  /// **'Monthly parking rate'**
  String get monthlyParkingRate;

  /// No description provided for @minimumParkingDays.
  ///
  /// In en, this message translates to:
  /// **'Minimum days'**
  String get minimumParkingDays;

  /// No description provided for @pickupAvailable.
  ///
  /// In en, this message translates to:
  /// **'Pickup available'**
  String get pickupAvailable;

  /// No description provided for @pickupAvailableSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Customers can request vehicle pickup before parking.'**
  String get pickupAvailableSubtitle;

  /// No description provided for @pickupFee.
  ///
  /// In en, this message translates to:
  /// **'Pickup fee'**
  String get pickupFee;

  /// No description provided for @parkingInstructions.
  ///
  /// In en, this message translates to:
  /// **'Parking instructions'**
  String get parkingInstructions;

  /// No description provided for @enterValidParkingCapacity.
  ///
  /// In en, this message translates to:
  /// **'Add the parking address, location, spaces, and daily rate before saving.'**
  String get enterValidParkingCapacity;

  /// No description provided for @customerParkingTitle.
  ///
  /// In en, this message translates to:
  /// **'Find parking'**
  String get customerParkingTitle;

  /// No description provided for @customerParkingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose where and when you want to park. We will show businesses with open spaces.'**
  String get customerParkingSubtitle;

  /// No description provided for @enterCarDetailsToReserveParking.
  ///
  /// In en, this message translates to:
  /// **'Enter car details to reserve parking'**
  String get enterCarDetailsToReserveParking;

  /// No description provided for @parkingCity.
  ///
  /// In en, this message translates to:
  /// **'Parking city'**
  String get parkingCity;

  /// No description provided for @pleaseEnterParkingCity.
  ///
  /// In en, this message translates to:
  /// **'Enter the city where you want to park.'**
  String get pleaseEnterParkingCity;

  /// No description provided for @parkingStart.
  ///
  /// In en, this message translates to:
  /// **'Parking start'**
  String get parkingStart;

  /// No description provided for @parkingEnd.
  ///
  /// In en, this message translates to:
  /// **'Parking end'**
  String get parkingEnd;

  /// No description provided for @searchParking.
  ///
  /// In en, this message translates to:
  /// **'Search parking'**
  String get searchParking;

  /// No description provided for @searchingParking.
  ///
  /// In en, this message translates to:
  /// **'Searching...'**
  String get searchingParking;

  /// No description provided for @availableParkingBusinesses.
  ///
  /// In en, this message translates to:
  /// **'Available parking'**
  String get availableParkingBusinesses;

  /// No description provided for @noParkingBusinesses.
  ///
  /// In en, this message translates to:
  /// **'No businesses have parking available for those dates.'**
  String get noParkingBusinesses;

  /// No description provided for @parkingSearchFailed.
  ///
  /// In en, this message translates to:
  /// **'Parking search failed. Please try again.'**
  String get parkingSearchFailed;

  /// No description provided for @availableSpacesCount.
  ///
  /// In en, this message translates to:
  /// **'{count} spaces available'**
  String availableSpacesCount(Object count);

  /// No description provided for @parkingPricePerDay.
  ///
  /// In en, this message translates to:
  /// **'{amount}/day'**
  String parkingPricePerDay(Object amount);

  /// No description provided for @parkingEstimatedTotal.
  ///
  /// In en, this message translates to:
  /// **'Estimated total: {amount}'**
  String parkingEstimatedTotal(Object amount);

  /// No description provided for @parkingDistanceMiles.
  ///
  /// In en, this message translates to:
  /// **'{miles} mi away'**
  String parkingDistanceMiles(Object miles);

  /// No description provided for @reserveParking.
  ///
  /// In en, this message translates to:
  /// **'Reserve parking'**
  String get reserveParking;

  /// No description provided for @reservingParking.
  ///
  /// In en, this message translates to:
  /// **'Reserving...'**
  String get reservingParking;

  /// No description provided for @parkingReservationSaved.
  ///
  /// In en, this message translates to:
  /// **'Parking reserved. Tracking number: {trackingCode}'**
  String parkingReservationSaved(Object trackingCode);

  /// No description provided for @parkingReservationFailed.
  ///
  /// In en, this message translates to:
  /// **'Parking could not be reserved. Please try again.'**
  String get parkingReservationFailed;

  /// No description provided for @accountRequiredParking.
  ///
  /// In en, this message translates to:
  /// **'Sign in to reserve parking and track your vehicle.'**
  String get accountRequiredParking;

  /// No description provided for @parkingDateRangeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose an end date after the parking start date.'**
  String get parkingDateRangeInvalid;

  /// No description provided for @chooseParkingBusiness.
  ///
  /// In en, this message translates to:
  /// **'Choose a business with available parking.'**
  String get chooseParkingBusiness;

  /// No description provided for @parkingPickupRequested.
  ///
  /// In en, this message translates to:
  /// **'Pickup requested'**
  String get parkingPickupRequested;

  /// No description provided for @parkingPickupOptional.
  ///
  /// In en, this message translates to:
  /// **'Request pickup if the business offers it'**
  String get parkingPickupOptional;

  /// No description provided for @businessServicesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Choose what this business can offer customers.'**
  String get businessServicesSubtitle;

  /// No description provided for @businessServicesCount.
  ///
  /// In en, this message translates to:
  /// **'{count} services'**
  String businessServicesCount(Object count);

  /// No description provided for @businessProfileApprovalSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Customers will see this after platform approval.'**
  String get businessProfileApprovalSubtitle;

  /// No description provided for @ownerSignedInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'This business will be linked to your signed-in account.'**
  String get ownerSignedInSubtitle;

  /// No description provided for @ownerCreateLoginSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Create the owner login for this business.'**
  String get ownerCreateLoginSubtitle;

  /// No description provided for @servicesOfferSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your dashboard will show pages for these services.'**
  String get servicesOfferSubtitle;

  /// No description provided for @ownerPhoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Owner phone is required'**
  String get ownerPhoneRequired;

  /// No description provided for @walletBalance.
  ///
  /// In en, this message translates to:
  /// **'Wallet balance'**
  String get walletBalance;

  /// No description provided for @toReceiverInCountry.
  ///
  /// In en, this message translates to:
  /// **'To {receiver} in {country}'**
  String toReceiverInCountry(Object receiver, Object country);

  /// No description provided for @pickupRequestedWithDate.
  ///
  /// In en, this message translates to:
  /// **'Pickup requested • {date}'**
  String pickupRequestedWithDate(Object date);

  /// No description provided for @pickupRequested.
  ///
  /// In en, this message translates to:
  /// **'Pickup requested'**
  String get pickupRequested;

  /// No description provided for @customerDropOffAtOffice.
  ///
  /// In en, this message translates to:
  /// **'Customer drop-off at office'**
  String get customerDropOffAtOffice;

  /// No description provided for @pendingPayment.
  ///
  /// In en, this message translates to:
  /// **'Pending payment'**
  String get pendingPayment;

  /// No description provided for @requested.
  ///
  /// In en, this message translates to:
  /// **'Requested'**
  String get requested;

  /// No description provided for @inTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get inTransit;

  /// No description provided for @paid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get paid;

  /// No description provided for @paymentPending.
  ///
  /// In en, this message translates to:
  /// **'Payment pending'**
  String get paymentPending;

  /// No description provided for @paymentCancelled.
  ///
  /// In en, this message translates to:
  /// **'Payment cancelled'**
  String get paymentCancelled;

  /// No description provided for @signInToTrackShipments.
  ///
  /// In en, this message translates to:
  /// **'Sign in to see your barrel shipment requests, receipts, and pickup status.'**
  String get signInToTrackShipments;

  /// No description provided for @guestTrackingIntro.
  ///
  /// In en, this message translates to:
  /// **'No account needed. Enter the number from your booking confirmation or receipt.'**
  String get guestTrackingIntro;

  /// No description provided for @guestTrackingIdentifierLabel.
  ///
  /// In en, this message translates to:
  /// **'Booking or tracking number'**
  String get guestTrackingIdentifierLabel;

  /// No description provided for @guestTrackingIdentifierHint.
  ///
  /// In en, this message translates to:
  /// **'For example, BS-K7M4P2'**
  String get guestTrackingIdentifierHint;

  /// No description provided for @guestTrackingRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your booking or tracking number.'**
  String get guestTrackingRequired;

  /// No description provided for @guestTrackingInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid booking or tracking number.'**
  String get guestTrackingInvalid;

  /// No description provided for @guestTrackingSubmit.
  ///
  /// In en, this message translates to:
  /// **'Track'**
  String get guestTrackingSubmit;

  /// No description provided for @guestTrackingLoading.
  ///
  /// In en, this message translates to:
  /// **'Checking status…'**
  String get guestTrackingLoading;

  /// No description provided for @guestTrackingSuccessTitle.
  ///
  /// In en, this message translates to:
  /// **'Tracking found'**
  String get guestTrackingSuccessTitle;

  /// No description provided for @guestTrackingNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'We could not find that number'**
  String get guestTrackingNotFoundTitle;

  /// No description provided for @guestTrackingNotFoundBody.
  ///
  /// In en, this message translates to:
  /// **'Check the number on your confirmation or receipt and try again.'**
  String get guestTrackingNotFoundBody;

  /// No description provided for @guestTrackingRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many checks were made. Please wait a few minutes and try again.'**
  String get guestTrackingRateLimited;

  /// No description provided for @guestTrackingUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Tracking is temporarily unavailable. Please try again shortly.'**
  String get guestTrackingUnavailable;

  /// No description provided for @guestTrackingServiceLabel.
  ///
  /// In en, this message translates to:
  /// **'Service'**
  String get guestTrackingServiceLabel;

  /// No description provided for @guestTrackingStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status'**
  String get guestTrackingStatusLabel;

  /// No description provided for @guestTrackingUpdatedLabel.
  ///
  /// In en, this message translates to:
  /// **'Last updated {date}'**
  String guestTrackingUpdatedLabel(Object date);

  /// No description provided for @guestTrackingPrivacyNote.
  ///
  /// In en, this message translates to:
  /// **'For privacy, guest tracking shows only the service status. Sign in to see private booking details and actions.'**
  String get guestTrackingPrivacyNote;

  /// No description provided for @guestTrackingShippingTitle.
  ///
  /// In en, this message translates to:
  /// **'Shipping details'**
  String get guestTrackingShippingTitle;

  /// No description provided for @guestTrackingShippingHint.
  ///
  /// In en, this message translates to:
  /// **'You can also follow it with these on the shipping line\'s website.'**
  String get guestTrackingShippingHint;

  /// No description provided for @guestTrackingShippingLine.
  ///
  /// In en, this message translates to:
  /// **'Shipping line'**
  String get guestTrackingShippingLine;

  /// No description provided for @guestTrackingContainerNumber.
  ///
  /// In en, this message translates to:
  /// **'Container number'**
  String get guestTrackingContainerNumber;

  /// No description provided for @guestTrackingBookingNumber.
  ///
  /// In en, this message translates to:
  /// **'Booking number'**
  String get guestTrackingBookingNumber;

  /// No description provided for @guestTrackingTrackAnother.
  ///
  /// In en, this message translates to:
  /// **'Track another number'**
  String get guestTrackingTrackAnother;

  /// No description provided for @guestTrackingSignInUpsell.
  ///
  /// In en, this message translates to:
  /// **'Sign in for full details'**
  String get guestTrackingSignInUpsell;

  /// No description provided for @guestTrackingServiceBarrel.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipping'**
  String get guestTrackingServiceBarrel;

  /// No description provided for @guestTrackingServiceFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get guestTrackingServiceFreight;

  /// No description provided for @guestTrackingServiceTransport.
  ///
  /// In en, this message translates to:
  /// **'Car transport'**
  String get guestTrackingServiceTransport;

  /// No description provided for @guestTrackingServiceParking.
  ///
  /// In en, this message translates to:
  /// **'Car parking'**
  String get guestTrackingServiceParking;

  /// No description provided for @guestTrackingServiceSharedBarrel.
  ///
  /// In en, this message translates to:
  /// **'Shared barrel'**
  String get guestTrackingServiceSharedBarrel;

  /// No description provided for @guestTrackingServiceFreightQuote.
  ///
  /// In en, this message translates to:
  /// **'Freight quote request'**
  String get guestTrackingServiceFreightQuote;

  /// No description provided for @guestTrackingServiceContainer.
  ///
  /// In en, this message translates to:
  /// **'Container shipment'**
  String get guestTrackingServiceContainer;

  /// No description provided for @guestTrackingStageBooked.
  ///
  /// In en, this message translates to:
  /// **'Booked'**
  String get guestTrackingStageBooked;

  /// No description provided for @guestTrackingStageInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get guestTrackingStageInTransit;

  /// No description provided for @guestTrackingStageArrived.
  ///
  /// In en, this message translates to:
  /// **'Arrived'**
  String get guestTrackingStageArrived;

  /// No description provided for @guestTrackingStageDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get guestTrackingStageDelivered;

  /// No description provided for @guestTrackingStageCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get guestTrackingStageCancelled;

  /// No description provided for @shipmentsLoadError.
  ///
  /// In en, this message translates to:
  /// **'We could not load your shipment requests right now. Please try again shortly.'**
  String get shipmentsLoadError;

  /// No description provided for @shipmentsAppearAfterPayment.
  ///
  /// In en, this message translates to:
  /// **'Your barrel shipment requests will appear here after payment is completed.'**
  String get shipmentsAppearAfterPayment;

  /// No description provided for @registerYourBusiness.
  ///
  /// In en, this message translates to:
  /// **'Register your business'**
  String get registerYourBusiness;

  /// No description provided for @submittingApplication.
  ///
  /// In en, this message translates to:
  /// **'Submitting application'**
  String get submittingApplication;

  /// No description provided for @submitBusinessApplication.
  ///
  /// In en, this message translates to:
  /// **'Submit business application'**
  String get submitBusinessApplication;

  /// No description provided for @businessApplicationSubmittedSetup.
  ///
  /// In en, this message translates to:
  /// **'Business application submitted. You can set up your dashboard now.'**
  String get businessApplicationSubmittedSetup;

  /// No description provided for @ownerNameRequiredShort.
  ///
  /// In en, this message translates to:
  /// **'Owner name is required'**
  String get ownerNameRequiredShort;

  /// No description provided for @chooseBusinessImageFirst.
  ///
  /// In en, this message translates to:
  /// **'Please choose a business image first.'**
  String get chooseBusinessImageFirst;

  /// No description provided for @validWebsiteRequired.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid website'**
  String get validWebsiteRequired;

  /// No description provided for @unknown.
  ///
  /// In en, this message translates to:
  /// **'Unknown'**
  String get unknown;

  /// No description provided for @cardReturnsSimulatedNotice.
  ///
  /// In en, this message translates to:
  /// **'Card returns are simulated for now. Keep this pending until real Stripe refunds are connected.'**
  String get cardReturnsSimulatedNotice;

  /// No description provided for @noBusinessesYet.
  ///
  /// In en, this message translates to:
  /// **'No businesses yet.'**
  String get noBusinessesYet;

  /// No description provided for @saving.
  ///
  /// In en, this message translates to:
  /// **'Saving'**
  String get saving;

  /// No description provided for @saveReview.
  ///
  /// In en, this message translates to:
  /// **'Save review'**
  String get saveReview;

  /// No description provided for @open.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get open;

  /// No description provided for @errorDetails.
  ///
  /// In en, this message translates to:
  /// **'Error: {error}'**
  String errorDetails(Object error);

  /// No description provided for @carInventoryBasics.
  ///
  /// In en, this message translates to:
  /// **'Basics'**
  String get carInventoryBasics;

  /// No description provided for @carInventoryPricing.
  ///
  /// In en, this message translates to:
  /// **'Pricing'**
  String get carInventoryPricing;

  /// No description provided for @carInventoryDetails.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get carInventoryDetails;

  /// No description provided for @carInventoryFeatures.
  ///
  /// In en, this message translates to:
  /// **'Features'**
  String get carInventoryFeatures;

  /// No description provided for @carInventoryMedia.
  ///
  /// In en, this message translates to:
  /// **'Media'**
  String get carInventoryMedia;

  /// No description provided for @carInventoryContact.
  ///
  /// In en, this message translates to:
  /// **'Contact'**
  String get carInventoryContact;

  /// No description provided for @carInventoryReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get carInventoryReview;

  /// No description provided for @next.
  ///
  /// In en, this message translates to:
  /// **'Next'**
  String get next;

  /// No description provided for @back.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get back;

  /// No description provided for @publishCar.
  ///
  /// In en, this message translates to:
  /// **'Publish car'**
  String get publishCar;

  /// No description provided for @updateListing.
  ///
  /// In en, this message translates to:
  /// **'Update listing'**
  String get updateListing;

  /// No description provided for @stepCount.
  ///
  /// In en, this message translates to:
  /// **'Step {current} of {total}'**
  String stepCount(Object current, Object total);

  /// No description provided for @condition.
  ///
  /// In en, this message translates to:
  /// **'Condition'**
  String get condition;

  /// No description provided for @bodyType.
  ///
  /// In en, this message translates to:
  /// **'Body type'**
  String get bodyType;

  /// No description provided for @transmission.
  ///
  /// In en, this message translates to:
  /// **'Transmission'**
  String get transmission;

  /// No description provided for @fuelType.
  ///
  /// In en, this message translates to:
  /// **'Fuel type'**
  String get fuelType;

  /// No description provided for @drivetrain.
  ///
  /// In en, this message translates to:
  /// **'Drivetrain'**
  String get drivetrain;

  /// No description provided for @exteriorColor.
  ///
  /// In en, this message translates to:
  /// **'Exterior color'**
  String get exteriorColor;

  /// No description provided for @interiorColor.
  ///
  /// In en, this message translates to:
  /// **'Interior color'**
  String get interiorColor;

  /// No description provided for @vinOptional.
  ///
  /// In en, this message translates to:
  /// **'VIN (optional)'**
  String get vinOptional;

  /// No description provided for @stockNumberOptional.
  ///
  /// In en, this message translates to:
  /// **'Stock/reference number (optional)'**
  String get stockNumberOptional;

  /// No description provided for @negotiable.
  ///
  /// In en, this message translates to:
  /// **'Negotiable'**
  String get negotiable;

  /// No description provided for @locationCity.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get locationCity;

  /// No description provided for @locationState.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get locationState;

  /// No description provided for @minPrice.
  ///
  /// In en, this message translates to:
  /// **'Min price'**
  String get minPrice;

  /// No description provided for @minMileage.
  ///
  /// In en, this message translates to:
  /// **'Min mileage'**
  String get minMileage;

  /// No description provided for @maxMileage.
  ///
  /// In en, this message translates to:
  /// **'Max mileage'**
  String get maxMileage;

  /// No description provided for @dealer.
  ///
  /// In en, this message translates to:
  /// **'Dealer'**
  String get dealer;

  /// No description provided for @location.
  ///
  /// In en, this message translates to:
  /// **'Location'**
  String get location;

  /// No description provided for @structuredFeatures.
  ///
  /// In en, this message translates to:
  /// **'Key features'**
  String get structuredFeatures;

  /// No description provided for @customFeatures.
  ///
  /// In en, this message translates to:
  /// **'Custom features'**
  String get customFeatures;

  /// No description provided for @customFeaturesHint.
  ///
  /// In en, this message translates to:
  /// **'Add custom features separated by commas'**
  String get customFeaturesHint;

  /// No description provided for @conditionNew.
  ///
  /// In en, this message translates to:
  /// **'New'**
  String get conditionNew;

  /// No description provided for @conditionUsed.
  ///
  /// In en, this message translates to:
  /// **'Used'**
  String get conditionUsed;

  /// No description provided for @conditionCertified.
  ///
  /// In en, this message translates to:
  /// **'Certified'**
  String get conditionCertified;

  /// No description provided for @conditionSalvage.
  ///
  /// In en, this message translates to:
  /// **'Salvage'**
  String get conditionSalvage;

  /// No description provided for @conditionExcellent.
  ///
  /// In en, this message translates to:
  /// **'Excellent'**
  String get conditionExcellent;

  /// No description provided for @conditionGood.
  ///
  /// In en, this message translates to:
  /// **'Good'**
  String get conditionGood;

  /// No description provided for @conditionFair.
  ///
  /// In en, this message translates to:
  /// **'Fair'**
  String get conditionFair;

  /// No description provided for @conditionPoor.
  ///
  /// In en, this message translates to:
  /// **'Poor'**
  String get conditionPoor;

  /// No description provided for @bodySedan.
  ///
  /// In en, this message translates to:
  /// **'Sedan'**
  String get bodySedan;

  /// No description provided for @bodySuv.
  ///
  /// In en, this message translates to:
  /// **'SUV'**
  String get bodySuv;

  /// No description provided for @bodyTruck.
  ///
  /// In en, this message translates to:
  /// **'Truck'**
  String get bodyTruck;

  /// No description provided for @bodyVan.
  ///
  /// In en, this message translates to:
  /// **'Van'**
  String get bodyVan;

  /// No description provided for @bodyCoupe.
  ///
  /// In en, this message translates to:
  /// **'Coupe'**
  String get bodyCoupe;

  /// No description provided for @bodyHatchback.
  ///
  /// In en, this message translates to:
  /// **'Hatchback'**
  String get bodyHatchback;

  /// No description provided for @bodyWagon.
  ///
  /// In en, this message translates to:
  /// **'Wagon'**
  String get bodyWagon;

  /// No description provided for @bodyConvertible.
  ///
  /// In en, this message translates to:
  /// **'Convertible'**
  String get bodyConvertible;

  /// No description provided for @transmissionAutomatic.
  ///
  /// In en, this message translates to:
  /// **'Automatic'**
  String get transmissionAutomatic;

  /// No description provided for @transmissionManual.
  ///
  /// In en, this message translates to:
  /// **'Manual'**
  String get transmissionManual;

  /// No description provided for @transmissionCvt.
  ///
  /// In en, this message translates to:
  /// **'CVT'**
  String get transmissionCvt;

  /// No description provided for @fuelGas.
  ///
  /// In en, this message translates to:
  /// **'Gas'**
  String get fuelGas;

  /// No description provided for @fuelDiesel.
  ///
  /// In en, this message translates to:
  /// **'Diesel'**
  String get fuelDiesel;

  /// No description provided for @fuelHybrid.
  ///
  /// In en, this message translates to:
  /// **'Hybrid'**
  String get fuelHybrid;

  /// No description provided for @fuelElectric.
  ///
  /// In en, this message translates to:
  /// **'Electric'**
  String get fuelElectric;

  /// No description provided for @fuelPlugInHybrid.
  ///
  /// In en, this message translates to:
  /// **'Plug-in hybrid'**
  String get fuelPlugInHybrid;

  /// No description provided for @drivetrainFwd.
  ///
  /// In en, this message translates to:
  /// **'FWD'**
  String get drivetrainFwd;

  /// No description provided for @drivetrainRwd.
  ///
  /// In en, this message translates to:
  /// **'RWD'**
  String get drivetrainRwd;

  /// No description provided for @drivetrainAwd.
  ///
  /// In en, this message translates to:
  /// **'AWD'**
  String get drivetrainAwd;

  /// No description provided for @drivetrainFourWd.
  ///
  /// In en, this message translates to:
  /// **'4WD'**
  String get drivetrainFourWd;

  /// No description provided for @featureBackupCamera.
  ///
  /// In en, this message translates to:
  /// **'Backup camera'**
  String get featureBackupCamera;

  /// No description provided for @featureBluetooth.
  ///
  /// In en, this message translates to:
  /// **'Bluetooth'**
  String get featureBluetooth;

  /// No description provided for @featureLeatherSeats.
  ///
  /// In en, this message translates to:
  /// **'Leather seats'**
  String get featureLeatherSeats;

  /// No description provided for @featureSunroof.
  ///
  /// In en, this message translates to:
  /// **'Sunroof'**
  String get featureSunroof;

  /// No description provided for @featureNavigation.
  ///
  /// In en, this message translates to:
  /// **'Navigation'**
  String get featureNavigation;

  /// No description provided for @featureHeatedSeats.
  ///
  /// In en, this message translates to:
  /// **'Heated seats'**
  String get featureHeatedSeats;

  /// No description provided for @featureAppleCarPlay.
  ///
  /// In en, this message translates to:
  /// **'Apple CarPlay'**
  String get featureAppleCarPlay;

  /// No description provided for @featureAndroidAuto.
  ///
  /// In en, this message translates to:
  /// **'Android Auto'**
  String get featureAndroidAuto;

  /// No description provided for @featureBlindSpot.
  ///
  /// In en, this message translates to:
  /// **'Blind spot monitor'**
  String get featureBlindSpot;

  /// No description provided for @featureThirdRow.
  ///
  /// In en, this message translates to:
  /// **'Third row seating'**
  String get featureThirdRow;

  /// No description provided for @featureRemoteStart.
  ///
  /// In en, this message translates to:
  /// **'Remote start'**
  String get featureRemoteStart;

  /// No description provided for @featureKeylessEntry.
  ///
  /// In en, this message translates to:
  /// **'Keyless entry'**
  String get featureKeylessEntry;

  /// No description provided for @featureLaneAssist.
  ///
  /// In en, this message translates to:
  /// **'Lane assist'**
  String get featureLaneAssist;

  /// No description provided for @featureAlloyWheels.
  ///
  /// In en, this message translates to:
  /// **'Alloy wheels'**
  String get featureAlloyWheels;

  /// No description provided for @featureParkingSensors.
  ///
  /// In en, this message translates to:
  /// **'Parking sensors'**
  String get featureParkingSensors;

  /// No description provided for @featurePremiumAudio.
  ///
  /// In en, this message translates to:
  /// **'Premium audio'**
  String get featurePremiumAudio;

  /// No description provided for @positivePriceRequired.
  ///
  /// In en, this message translates to:
  /// **'Price must be greater than 0.'**
  String get positivePriceRequired;

  /// No description provided for @mileageWholeNumberRequired.
  ///
  /// In en, this message translates to:
  /// **'Mileage must be a non-negative whole number.'**
  String get mileageWholeNumberRequired;

  /// No description provided for @vinLengthRequired.
  ///
  /// In en, this message translates to:
  /// **'VIN must be 17 characters.'**
  String get vinLengthRequired;

  /// No description provided for @addAtLeastOneImage.
  ///
  /// In en, this message translates to:
  /// **'Add at least one car image before publishing.'**
  String get addAtLeastOneImage;

  /// No description provided for @coverImage.
  ///
  /// In en, this message translates to:
  /// **'Cover image'**
  String get coverImage;

  /// No description provided for @makeCover.
  ///
  /// In en, this message translates to:
  /// **'Make cover'**
  String get makeCover;

  /// No description provided for @removeImage.
  ///
  /// In en, this message translates to:
  /// **'Remove image'**
  String get removeImage;

  /// No description provided for @listingPreview.
  ///
  /// In en, this message translates to:
  /// **'Listing preview'**
  String get listingPreview;

  /// No description provided for @readyToPublish.
  ///
  /// In en, this message translates to:
  /// **'Ready to publish'**
  String get readyToPublish;

  /// No description provided for @missingRequiredInfo.
  ///
  /// In en, this message translates to:
  /// **'Missing required information'**
  String get missingRequiredInfo;

  /// No description provided for @reviewBeforePublishing.
  ///
  /// In en, this message translates to:
  /// **'Review the listing before it goes live for customers.'**
  String get reviewBeforePublishing;

  /// No description provided for @listingWillStayInactive.
  ///
  /// In en, this message translates to:
  /// **'This listing will be saved as inactive and hidden from customers.'**
  String get listingWillStayInactive;

  /// No description provided for @noFilterResults.
  ///
  /// In en, this message translates to:
  /// **'No cars match these filters.'**
  String get noFilterResults;

  /// No description provided for @clearFiltersToSeeCars.
  ///
  /// In en, this message translates to:
  /// **'Clear filters to see available cars.'**
  String get clearFiltersToSeeCars;

  /// No description provided for @newestListings.
  ///
  /// In en, this message translates to:
  /// **'Newest listings'**
  String get newestListings;

  /// No description provided for @mileageLowToHigh.
  ///
  /// In en, this message translates to:
  /// **'Mileage: low to high'**
  String get mileageLowToHigh;

  /// No description provided for @mileageHighToLow.
  ///
  /// In en, this message translates to:
  /// **'Mileage: high to low'**
  String get mileageHighToLow;

  /// No description provided for @priceNegotiable.
  ///
  /// In en, this message translates to:
  /// **'Price negotiable'**
  String get priceNegotiable;

  /// No description provided for @financingAvailable.
  ///
  /// In en, this message translates to:
  /// **'Financing info available'**
  String get financingAvailable;

  /// No description provided for @any.
  ///
  /// In en, this message translates to:
  /// **'Any'**
  String get any;

  /// No description provided for @uploadingCar.
  ///
  /// In en, this message translates to:
  /// **'Uploading car...'**
  String get uploadingCar;

  /// No description provided for @fixRequiredFields.
  ///
  /// In en, this message translates to:
  /// **'Please fix the required fields below.'**
  String get fixRequiredFields;

  /// No description provided for @selectStateFirst.
  ///
  /// In en, this message translates to:
  /// **'Select a state first'**
  String get selectStateFirst;

  /// No description provided for @carColorBlack.
  ///
  /// In en, this message translates to:
  /// **'Black'**
  String get carColorBlack;

  /// No description provided for @carColorWhite.
  ///
  /// In en, this message translates to:
  /// **'White'**
  String get carColorWhite;

  /// No description provided for @carColorSilver.
  ///
  /// In en, this message translates to:
  /// **'Silver'**
  String get carColorSilver;

  /// No description provided for @carColorGray.
  ///
  /// In en, this message translates to:
  /// **'Gray'**
  String get carColorGray;

  /// No description provided for @carColorRed.
  ///
  /// In en, this message translates to:
  /// **'Red'**
  String get carColorRed;

  /// No description provided for @carColorBlue.
  ///
  /// In en, this message translates to:
  /// **'Blue'**
  String get carColorBlue;

  /// No description provided for @carColorGreen.
  ///
  /// In en, this message translates to:
  /// **'Green'**
  String get carColorGreen;

  /// No description provided for @carColorYellow.
  ///
  /// In en, this message translates to:
  /// **'Yellow'**
  String get carColorYellow;

  /// No description provided for @carColorBrown.
  ///
  /// In en, this message translates to:
  /// **'Brown'**
  String get carColorBrown;

  /// No description provided for @carColorBeige.
  ///
  /// In en, this message translates to:
  /// **'Beige'**
  String get carColorBeige;

  /// No description provided for @carColorGold.
  ///
  /// In en, this message translates to:
  /// **'Gold'**
  String get carColorGold;

  /// No description provided for @carColorOrange.
  ///
  /// In en, this message translates to:
  /// **'Orange'**
  String get carColorOrange;

  /// No description provided for @carColorPurple.
  ///
  /// In en, this message translates to:
  /// **'Purple'**
  String get carColorPurple;

  /// No description provided for @carColorBurgundy.
  ///
  /// In en, this message translates to:
  /// **'Burgundy'**
  String get carColorBurgundy;

  /// No description provided for @carColorOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get carColorOther;

  /// No description provided for @otherOption.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get otherOption;

  /// No description provided for @businessLocation.
  ///
  /// In en, this message translates to:
  /// **'Business location'**
  String get businessLocation;

  /// No description provided for @viewingLocation.
  ///
  /// In en, this message translates to:
  /// **'Viewing location'**
  String get viewingLocation;

  /// No description provided for @reserveCarHoldTitle.
  ///
  /// In en, this message translates to:
  /// **'Paid hold after viewing'**
  String get reserveCarHoldTitle;

  /// No description provided for @reserveCarHoldMessage.
  ///
  /// In en, this message translates to:
  /// **'Use this after you have viewed the car and want the business to hold it while you return to complete payment. If you do not come back, the deposit may be forfeited.'**
  String get reserveCarHoldMessage;

  /// No description provided for @reserveCarQuestion.
  ///
  /// In en, this message translates to:
  /// **'Reserve this car?'**
  String get reserveCarQuestion;

  /// No description provided for @reserveCarConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'You will pay {amount} now to hold this car. The business can keep the deposit if you do not return to complete the purchase.'**
  String reserveCarConfirmMessage(Object amount);

  /// No description provided for @businessAddressLine1.
  ///
  /// In en, this message translates to:
  /// **'Business street address'**
  String get businessAddressLine1;

  /// No description provided for @postalCode.
  ///
  /// In en, this message translates to:
  /// **'Postal code'**
  String get postalCode;

  /// No description provided for @useBusinessDefaultAddress.
  ///
  /// In en, this message translates to:
  /// **'Use business default address'**
  String get useBusinessDefaultAddress;

  /// No description provided for @useCustomViewingAddress.
  ///
  /// In en, this message translates to:
  /// **'Use a different viewing address'**
  String get useCustomViewingAddress;

  /// No description provided for @listingLocationSource.
  ///
  /// In en, this message translates to:
  /// **'Listing location'**
  String get listingLocationSource;

  /// No description provided for @businessAddressMissing.
  ///
  /// In en, this message translates to:
  /// **'Add the business default address in Business profile, or choose a different viewing address.'**
  String get businessAddressMissing;

  /// No description provided for @editViewingReservation.
  ///
  /// In en, this message translates to:
  /// **'Edit viewing reservation'**
  String get editViewingReservation;

  /// No description provided for @changeViewingTime.
  ///
  /// In en, this message translates to:
  /// **'Change viewing time'**
  String get changeViewingTime;

  /// No description provided for @viewingEditCutoff.
  ///
  /// In en, this message translates to:
  /// **'Viewing appointments can be changed until one hour before the scheduled time.'**
  String get viewingEditCutoff;

  /// No description provided for @viewingReservationUpdated.
  ///
  /// In en, this message translates to:
  /// **'Viewing time updated.'**
  String get viewingReservationUpdated;

  /// No description provided for @cannotEditViewingReservation.
  ///
  /// In en, this message translates to:
  /// **'This viewing reservation can no longer be changed.'**
  String get cannotEditViewingReservation;

  /// No description provided for @cancelViewingReservation.
  ///
  /// In en, this message translates to:
  /// **'Cancel viewing'**
  String get cancelViewingReservation;

  /// No description provided for @cancelViewingQuestion.
  ///
  /// In en, this message translates to:
  /// **'Cancel this viewing?'**
  String get cancelViewingQuestion;

  /// No description provided for @cancelViewingConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'This will remove your viewing appointment and make the car available for you to reserve again.'**
  String get cancelViewingConfirmMessage;

  /// No description provided for @viewingReservationCancelled.
  ///
  /// In en, this message translates to:
  /// **'Viewing reservation cancelled.'**
  String get viewingReservationCancelled;

  /// No description provided for @viewingScheduled.
  ///
  /// In en, this message translates to:
  /// **'Viewing scheduled'**
  String get viewingScheduled;

  /// No description provided for @requestHoldExtensionQuestion.
  ///
  /// In en, this message translates to:
  /// **'Request hold extension?'**
  String get requestHoldExtensionQuestion;

  /// No description provided for @requestHoldExtensionMessage.
  ///
  /// In en, this message translates to:
  /// **'The business will review your new return date. If approved, you will pay any extra hold amount before the date changes.'**
  String get requestHoldExtensionMessage;

  /// No description provided for @requestExtension.
  ///
  /// In en, this message translates to:
  /// **'Request extension'**
  String get requestExtension;

  /// No description provided for @extensionRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Extension request sent.'**
  String get extensionRequestSent;

  /// No description provided for @holdUntilDate.
  ///
  /// In en, this message translates to:
  /// **'Hold until: {date}'**
  String holdUntilDate(Object date);

  /// No description provided for @holdReviewRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'The hold date has passed. The business is reviewing whether the vehicle was sold or the customer did not come.'**
  String get holdReviewRequiredMessage;

  /// No description provided for @customerNoShowHoldMessage.
  ///
  /// In en, this message translates to:
  /// **'Marked as customer did not come. The hold deposit may be forfeited.'**
  String get customerNoShowHoldMessage;

  /// No description provided for @payExtensionQuestion.
  ///
  /// In en, this message translates to:
  /// **'Pay extension?'**
  String get payExtensionQuestion;

  /// No description provided for @payExtensionMessage.
  ///
  /// In en, this message translates to:
  /// **'Your hold date will update after this extension payment is complete.'**
  String get payExtensionMessage;

  /// No description provided for @payExtension.
  ///
  /// In en, this message translates to:
  /// **'Pay extension'**
  String get payExtension;

  /// No description provided for @extensionPaidHoldUpdated.
  ///
  /// In en, this message translates to:
  /// **'Extension paid. Hold date updated.'**
  String get extensionPaidHoldUpdated;

  /// No description provided for @chooseBusinessWithShippingFee.
  ///
  /// In en, this message translates to:
  /// **'Choose a business with an active shipping fee before payment.'**
  String get chooseBusinessWithShippingFee;

  /// No description provided for @processingPayment.
  ///
  /// In en, this message translates to:
  /// **'Processing payment'**
  String get processingPayment;

  /// No description provided for @payAndRequestShipment.
  ///
  /// In en, this message translates to:
  /// **'Pay and request shipment'**
  String get payAndRequestShipment;

  /// No description provided for @checkingConnection.
  ///
  /// In en, this message translates to:
  /// **'Checking connection'**
  String get checkingConnection;

  /// No description provided for @checkingConnectionMessage.
  ///
  /// In en, this message translates to:
  /// **'We are confirming internet access before opening the app.'**
  String get checkingConnectionMessage;

  /// No description provided for @noInternetConnection.
  ///
  /// In en, this message translates to:
  /// **'No internet connection'**
  String get noInternetConnection;

  /// No description provided for @noInternetMessage.
  ///
  /// In en, this message translates to:
  /// **'This app needs an active internet connection to load your account, services, payments, and latest safety settings.'**
  String get noInternetMessage;

  /// No description provided for @retry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get retry;

  /// No description provided for @updateAvailable.
  ///
  /// In en, this message translates to:
  /// **'Update available'**
  String get updateAvailable;

  /// No description provided for @updateAvailableMessage.
  ///
  /// In en, this message translates to:
  /// **'A newer version{version} is available. Update now for the latest fixes, or continue for this session.'**
  String updateAvailableMessage(Object version);

  /// No description provided for @updateRequired.
  ///
  /// In en, this message translates to:
  /// **'Update required'**
  String get updateRequired;

  /// No description provided for @updateRequiredMessage.
  ///
  /// In en, this message translates to:
  /// **'This version is no longer supported. Please update{version} to continue.'**
  String updateRequiredMessage(Object version);

  /// No description provided for @updateNow.
  ///
  /// In en, this message translates to:
  /// **'Update now'**
  String get updateNow;

  /// No description provided for @continueLabel.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get continueLabel;

  /// No description provided for @updateLinkUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The update link is not available yet. Please try again later.'**
  String get updateLinkUnavailable;

  /// No description provided for @emailOrPhone.
  ///
  /// In en, this message translates to:
  /// **'Email or phone'**
  String get emailOrPhone;

  /// No description provided for @enterEmailOrPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter your email or phone'**
  String get enterEmailOrPhone;

  /// No description provided for @pleaseEnterEmailOrPhone.
  ///
  /// In en, this message translates to:
  /// **'Please enter your email or phone number'**
  String get pleaseEnterEmailOrPhone;

  /// No description provided for @pleaseEnterValidEmailOrPhone.
  ///
  /// In en, this message translates to:
  /// **'Please enter a valid email or phone number'**
  String get pleaseEnterValidEmailOrPhone;

  /// No description provided for @saveProfile.
  ///
  /// In en, this message translates to:
  /// **'Save profile'**
  String get saveProfile;

  /// No description provided for @profilePhoto.
  ///
  /// In en, this message translates to:
  /// **'Profile photo'**
  String get profilePhoto;

  /// No description provided for @changePhoto.
  ///
  /// In en, this message translates to:
  /// **'Change photo'**
  String get changePhoto;

  /// No description provided for @notifications.
  ///
  /// In en, this message translates to:
  /// **'Notifications'**
  String get notifications;

  /// No description provided for @notificationPreferences.
  ///
  /// In en, this message translates to:
  /// **'Notification preferences'**
  String get notificationPreferences;

  /// No description provided for @pushNotifications.
  ///
  /// In en, this message translates to:
  /// **'Push notifications'**
  String get pushNotifications;

  /// No description provided for @emailNotifications.
  ///
  /// In en, this message translates to:
  /// **'Email notifications'**
  String get emailNotifications;

  /// No description provided for @smsNotifications.
  ///
  /// In en, this message translates to:
  /// **'SMS notifications'**
  String get smsNotifications;

  /// No description provided for @carActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Car purchase and reservation updates'**
  String get carActivityNotifications;

  /// No description provided for @shipmentActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipment updates'**
  String get shipmentActivityNotifications;

  /// No description provided for @walletActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Wallet refund updates'**
  String get walletActivityNotifications;

  /// No description provided for @businessActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Business application updates'**
  String get businessActivityNotifications;

  /// No description provided for @reviewActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Review requests'**
  String get reviewActivityNotifications;

  /// No description provided for @inventorySalesNotifications.
  ///
  /// In en, this message translates to:
  /// **'Sales at my store'**
  String get inventorySalesNotifications;

  /// No description provided for @parkedCarAlertsNotifications.
  ///
  /// In en, this message translates to:
  /// **'Cars parked by my team'**
  String get parkedCarAlertsNotifications;

  /// No description provided for @packageAlertsNotifications.
  ///
  /// In en, this message translates to:
  /// **'Packages saved by my team'**
  String get packageAlertsNotifications;

  /// No description provided for @platformActivityNotifications.
  ///
  /// In en, this message translates to:
  /// **'Platform activity (cars, packages, sales in every business)'**
  String get platformActivityNotifications;

  /// No description provided for @faceId.
  ///
  /// In en, this message translates to:
  /// **'Face ID'**
  String get faceId;

  /// No description provided for @faceIdUnlock.
  ///
  /// In en, this message translates to:
  /// **'Use Face ID to unlock this app'**
  String get faceIdUnlock;

  /// No description provided for @faceIdUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Face ID is not available on this device'**
  String get faceIdUnavailable;

  /// No description provided for @unlockWithFaceId.
  ///
  /// In en, this message translates to:
  /// **'Unlock with Face ID'**
  String get unlockWithFaceId;

  /// No description provided for @appLocked.
  ///
  /// In en, this message translates to:
  /// **'App locked'**
  String get appLocked;

  /// No description provided for @unlockWithFaceIdMessage.
  ///
  /// In en, this message translates to:
  /// **'Use Face ID to continue.'**
  String get unlockWithFaceIdMessage;

  /// No description provided for @unlock.
  ///
  /// In en, this message translates to:
  /// **'Unlock'**
  String get unlock;

  /// No description provided for @favoriteCars.
  ///
  /// In en, this message translates to:
  /// **'Favorite cars'**
  String get favoriteCars;

  /// No description provided for @favoriteCarsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'View vehicles you saved'**
  String get favoriteCarsSubtitle;

  /// No description provided for @noFavoriteCarsYet.
  ///
  /// In en, this message translates to:
  /// **'No favorite cars yet'**
  String get noFavoriteCarsYet;

  /// No description provided for @favoriteRemoved.
  ///
  /// In en, this message translates to:
  /// **'Favorite removed'**
  String get favoriteRemoved;

  /// No description provided for @addToFavorites.
  ///
  /// In en, this message translates to:
  /// **'Add to favorites'**
  String get addToFavorites;

  /// No description provided for @removeFromFavorites.
  ///
  /// In en, this message translates to:
  /// **'Remove from favorites'**
  String get removeFromFavorites;

  /// No description provided for @enterValidPaidHoldPricing.
  ///
  /// In en, this message translates to:
  /// **'Enter valid paid hold pricing.'**
  String get enterValidPaidHoldPricing;

  /// No description provided for @useBusinessPaidHoldPricing.
  ///
  /// In en, this message translates to:
  /// **'Use business paid hold pricing'**
  String get useBusinessPaidHoldPricing;

  /// No description provided for @useBusinessPaidHoldPricingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Turn off to override hold fee for this car.'**
  String get useBusinessPaidHoldPricingSubtitle;

  /// No description provided for @chooseReturnDate.
  ///
  /// In en, this message translates to:
  /// **'Choose return date'**
  String get chooseReturnDate;

  /// No description provided for @customizeNavbar.
  ///
  /// In en, this message translates to:
  /// **'Customize navbar'**
  String get customizeNavbar;

  /// No description provided for @change.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get change;

  /// No description provided for @sendFreight.
  ///
  /// In en, this message translates to:
  /// **'Send freight'**
  String get sendFreight;

  /// No description provided for @freightBookedTracking.
  ///
  /// In en, this message translates to:
  /// **'Freight booked. Tracking: {trackingCode}'**
  String freightBookedTracking(Object trackingCode);

  /// No description provided for @freightEstimatePaidTracking.
  ///
  /// In en, this message translates to:
  /// **'Estimate paid. Tracking: {trackingCode}'**
  String freightEstimatePaidTracking(Object trackingCode);

  /// No description provided for @fillSenderReceiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Fill sender, receiver, and phone.'**
  String get fillSenderReceiverPhone;

  /// No description provided for @enterParcelWeightKg.
  ///
  /// In en, this message translates to:
  /// **'Enter the parcel weight in kg.'**
  String get enterParcelWeightKg;

  /// No description provided for @noFreightBusinessesYet.
  ///
  /// In en, this message translates to:
  /// **'No freight businesses yet'**
  String get noFreightBusinessesYet;

  /// No description provided for @noFreightBusinessesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Parcel freight will appear here once a business sets its air or sea rates.'**
  String get noFreightBusinessesSubtitle;

  /// No description provided for @couldNotLoadFreightOptions.
  ///
  /// In en, this message translates to:
  /// **'Could not load freight options. Check your connection and try again.'**
  String get couldNotLoadFreightOptions;

  /// No description provided for @freightBookingFailed.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t create this freight shipment. Please try again.'**
  String get freightBookingFailed;

  /// No description provided for @approvedBusiness.
  ///
  /// In en, this message translates to:
  /// **'Approved business'**
  String get approvedBusiness;

  /// No description provided for @freightDeliveryEstimateDays.
  ///
  /// In en, this message translates to:
  /// **'Delivery: {minimum}-{maximum} days'**
  String freightDeliveryEstimateDays(int minimum, int maximum);

  /// No description provided for @freightAirDeliveryEstimateDays.
  ///
  /// In en, this message translates to:
  /// **'Air delivery: {minimum}-{maximum} days'**
  String freightAirDeliveryEstimateDays(int minimum, int maximum);

  /// No description provided for @freightSeaDeliveryEstimateDays.
  ///
  /// In en, this message translates to:
  /// **'Sea delivery: {minimum}-{maximum} days'**
  String freightSeaDeliveryEstimateDays(int minimum, int maximum);

  /// No description provided for @cancelOrderTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this order?'**
  String get cancelOrderTitle;

  /// No description provided for @cancelOrderHeldBody.
  ///
  /// In en, this message translates to:
  /// **'Your card was never charged — the hold is released and you pay nothing.'**
  String get cancelOrderHeldBody;

  /// No description provided for @cancelOrderCapturedBody.
  ///
  /// In en, this message translates to:
  /// **'Your payment is refunded minus the card processing fee, as stated at checkout.'**
  String get cancelOrderCapturedBody;

  /// No description provided for @cancelWholeOrderHeldBody.
  ///
  /// In en, this message translates to:
  /// **'This shipment was paid together with the rest of its order, so the whole order is cancelled. Your card was never charged — you pay nothing.'**
  String get cancelWholeOrderHeldBody;

  /// No description provided for @cancelWholeOrderCapturedBody.
  ///
  /// In en, this message translates to:
  /// **'This shipment was paid together with the rest of its order, so the whole order is cancelled. Your payment is refunded minus the card processing fee.'**
  String get cancelWholeOrderCapturedBody;

  /// No description provided for @keepOrder.
  ///
  /// In en, this message translates to:
  /// **'Keep order'**
  String get keepOrder;

  /// No description provided for @cancelOrderConfirm.
  ///
  /// In en, this message translates to:
  /// **'Cancel order'**
  String get cancelOrderConfirm;

  /// No description provided for @cancelOrderFreeAction.
  ///
  /// In en, this message translates to:
  /// **'Cancel order (free)'**
  String get cancelOrderFreeAction;

  /// No description provided for @cancelOrderRefundAction.
  ///
  /// In en, this message translates to:
  /// **'Cancel order (refund minus card fee)'**
  String get cancelOrderRefundAction;

  /// No description provided for @orderCancelledFree.
  ///
  /// In en, this message translates to:
  /// **'Order cancelled. Your card was never charged.'**
  String get orderCancelledFree;

  /// No description provided for @orderRefunded.
  ///
  /// In en, this message translates to:
  /// **'Order cancelled. Your refund is on its way, minus the card fee.'**
  String get orderRefunded;

  /// No description provided for @genericError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get genericError;

  /// No description provided for @paymentHoldNotice.
  ///
  /// In en, this message translates to:
  /// **'No charge today — the amount is reserved on your card and charged when the reservation window ends (5–7 days for most cards). Cancelling before then is free; after that, refunds lose the card processing fee.'**
  String get paymentHoldNotice;

  /// No description provided for @freightSortBestRated.
  ///
  /// In en, this message translates to:
  /// **'Best rated'**
  String get freightSortBestRated;

  /// No description provided for @freightSortCheapest.
  ///
  /// In en, this message translates to:
  /// **'Cheapest'**
  String get freightSortCheapest;

  /// No description provided for @freightSortBestCover.
  ///
  /// In en, this message translates to:
  /// **'Best cover'**
  String get freightSortBestCover;

  /// No description provided for @freightSortFastest.
  ///
  /// In en, this message translates to:
  /// **'Fastest'**
  String get freightSortFastest;

  /// No description provided for @searchBusinessOrCountry.
  ///
  /// In en, this message translates to:
  /// **'Search a business or country'**
  String get searchBusinessOrCountry;

  /// No description provided for @noMatchFor.
  ///
  /// In en, this message translates to:
  /// **'No match for \"{query}\"'**
  String noMatchFor(Object query);

  /// No description provided for @toDestination.
  ///
  /// In en, this message translates to:
  /// **'To {destination}'**
  String toDestination(Object destination);

  /// No description provided for @airRatePerKg.
  ///
  /// In en, this message translates to:
  /// **'Air {rate}/kg'**
  String airRatePerKg(Object rate);

  /// No description provided for @seaRatePerKg.
  ///
  /// In en, this message translates to:
  /// **'Sea {rate}/kg'**
  String seaRatePerKg(Object rate);

  /// No description provided for @shippingMode.
  ///
  /// In en, this message translates to:
  /// **'Shipping mode'**
  String get shippingMode;

  /// No description provided for @invalidFreightMode.
  ///
  /// In en, this message translates to:
  /// **'Choose air or sea freight.'**
  String get invalidFreightMode;

  /// No description provided for @parcelWeightKg.
  ///
  /// In en, this message translates to:
  /// **'Parcel weight (kg)'**
  String get parcelWeightKg;

  /// No description provided for @estimatedPrice.
  ///
  /// In en, this message translates to:
  /// **'Estimated price'**
  String get estimatedPrice;

  /// No description provided for @estimatedWeight.
  ///
  /// In en, this message translates to:
  /// **'Estimated weight'**
  String get estimatedWeight;

  /// No description provided for @estimatedWeightKg.
  ///
  /// In en, this message translates to:
  /// **'Estimated weight (kg)'**
  String get estimatedWeightKg;

  /// No description provided for @estimatedTotal.
  ///
  /// In en, this message translates to:
  /// **'Estimated total'**
  String get estimatedTotal;

  /// No description provided for @freightEstimateExplanation.
  ///
  /// In en, this message translates to:
  /// **'You are paying an estimate based on the weight you entered. The business will confirm the weight after drop-off.'**
  String get freightEstimateExplanation;

  /// No description provided for @payEstimate.
  ///
  /// In en, this message translates to:
  /// **'Pay estimate'**
  String get payEstimate;

  /// No description provided for @estimatePaid.
  ///
  /// In en, this message translates to:
  /// **'Estimate paid'**
  String get estimatePaid;

  /// No description provided for @freightOrderDetails.
  ///
  /// In en, this message translates to:
  /// **'Freight order'**
  String get freightOrderDetails;

  /// No description provided for @freightNextStep.
  ///
  /// In en, this message translates to:
  /// **'Next step'**
  String get freightNextStep;

  /// No description provided for @freightNextDropOffAtProvider.
  ///
  /// In en, this message translates to:
  /// **'Drop off your parcel at {businessName}. The business will confirm the weight after drop-off.'**
  String freightNextDropOffAtProvider(Object businessName);

  /// No description provided for @freightNextDropOffAtBusiness.
  ///
  /// In en, this message translates to:
  /// **'Drop off your parcel at the business location. The business will confirm the weight after drop-off.'**
  String get freightNextDropOffAtBusiness;

  /// No description provided for @freightNextDropOffAtProviderSetPrice.
  ///
  /// In en, this message translates to:
  /// **'Drop off your parcel at {businessName}. The price for this item is set, so there is nothing left to pay.'**
  String freightNextDropOffAtProviderSetPrice(Object businessName);

  /// No description provided for @freightNextDropOffAtBusinessSetPrice.
  ///
  /// In en, this message translates to:
  /// **'Drop off your parcel at the business location. The price for this item is set, so there is nothing left to pay.'**
  String get freightNextDropOffAtBusinessSetPrice;

  /// No description provided for @freightNextWeightReview.
  ///
  /// In en, this message translates to:
  /// **'The business is confirming the final weight. We will show any balance or refund here.'**
  String get freightNextWeightReview;

  /// No description provided for @freightNextInTransit.
  ///
  /// In en, this message translates to:
  /// **'Your parcel is on the way. Keep this tracking code for updates.'**
  String get freightNextInTransit;

  /// No description provided for @freightNextReadyForPickup.
  ///
  /// In en, this message translates to:
  /// **'Your parcel is ready for pickup.'**
  String get freightNextReadyForPickup;

  /// No description provided for @freightNextCompleted.
  ///
  /// In en, this message translates to:
  /// **'This freight order is complete.'**
  String get freightNextCompleted;

  /// No description provided for @paidEstimateAmount.
  ///
  /// In en, this message translates to:
  /// **'Paid estimate: {amount}'**
  String paidEstimateAmount(Object amount);

  /// No description provided for @estimatedWeightValue.
  ///
  /// In en, this message translates to:
  /// **'Estimated weight: {weight}'**
  String estimatedWeightValue(Object weight);

  /// No description provided for @freightNoActionUntilWeightConfirmed.
  ///
  /// In en, this message translates to:
  /// **'After drop-off, no action is needed until the business confirms the weight.'**
  String get freightNoActionUntilWeightConfirmed;

  /// No description provided for @viewAllShipments.
  ///
  /// In en, this message translates to:
  /// **'View all shipments'**
  String get viewAllShipments;

  /// No description provided for @shipmentStillSyncing.
  ///
  /// In en, this message translates to:
  /// **'This shipment is still syncing. You can view all shipments or try again shortly.'**
  String get shipmentStillSyncing;

  /// No description provided for @awaitingConfirmedWeight.
  ///
  /// In en, this message translates to:
  /// **'Awaiting confirmed weight'**
  String get awaitingConfirmedWeight;

  /// No description provided for @verifiedWeight.
  ///
  /// In en, this message translates to:
  /// **'Confirmed weight'**
  String get verifiedWeight;

  /// No description provided for @finalTotal.
  ///
  /// In en, this message translates to:
  /// **'Final total'**
  String get finalTotal;

  /// No description provided for @additionalPaymentRequired.
  ///
  /// In en, this message translates to:
  /// **'Additional payment required'**
  String get additionalPaymentRequired;

  /// No description provided for @payBalanceAmount.
  ///
  /// In en, this message translates to:
  /// **'Pay balance of {amount}'**
  String payBalanceAmount(Object amount);

  /// No description provided for @refundDueAmount.
  ///
  /// In en, this message translates to:
  /// **'Refund due: {amount}'**
  String refundDueAmount(Object amount);

  /// No description provided for @refundProcessing.
  ///
  /// In en, this message translates to:
  /// **'Refund processing'**
  String get refundProcessing;

  /// No description provided for @refundCompleted.
  ///
  /// In en, this message translates to:
  /// **'Refund completed'**
  String get refundCompleted;

  /// No description provided for @freightSettled.
  ///
  /// In en, this message translates to:
  /// **'Settled'**
  String get freightSettled;

  /// No description provided for @shipmentHeldForBalance.
  ///
  /// In en, this message translates to:
  /// **'Your parcel will be held until the balance is paid.'**
  String get shipmentHeldForBalance;

  /// No description provided for @settlementNeedsAttention.
  ///
  /// In en, this message translates to:
  /// **'Settlement needs attention'**
  String get settlementNeedsAttention;

  /// No description provided for @paymentProcessing.
  ///
  /// In en, this message translates to:
  /// **'Payment processing…'**
  String get paymentProcessing;

  /// No description provided for @couldNotPayBalance.
  ///
  /// In en, this message translates to:
  /// **'Could not pay the balance. Try again.'**
  String get couldNotPayBalance;

  /// No description provided for @enterWeightToSeePrice.
  ///
  /// In en, this message translates to:
  /// **'Enter a weight to see the price'**
  String get enterWeightToSeePrice;

  /// No description provided for @bookAndPay.
  ///
  /// In en, this message translates to:
  /// **'Book & pay'**
  String get bookAndPay;

  /// No description provided for @freightDropOffNote.
  ///
  /// In en, this message translates to:
  /// **'Drop your parcel at the business location.'**
  String get freightDropOffNote;

  /// No description provided for @freightDropOffAddress.
  ///
  /// In en, this message translates to:
  /// **'Drop-off: {address}'**
  String freightDropOffAddress(Object address);

  /// No description provided for @freightBusinessPhone.
  ///
  /// In en, this message translates to:
  /// **'Business phone: {phone}'**
  String freightBusinessPhone(Object phone);

  /// No description provided for @airFreight.
  ///
  /// In en, this message translates to:
  /// **'Air freight'**
  String get airFreight;

  /// No description provided for @seaFreight.
  ///
  /// In en, this message translates to:
  /// **'Sea freight'**
  String get seaFreight;

  /// No description provided for @pricePerKg.
  ///
  /// In en, this message translates to:
  /// **'{price} / kg'**
  String pricePerKg(Object price);

  /// No description provided for @fasterDelivery.
  ///
  /// In en, this message translates to:
  /// **'Faster delivery'**
  String get fasterDelivery;

  /// No description provided for @lowerCost.
  ///
  /// In en, this message translates to:
  /// **'Lower cost'**
  String get lowerCost;

  /// No description provided for @requestCarTransport.
  ///
  /// In en, this message translates to:
  /// **'Request car transport'**
  String get requestCarTransport;

  /// No description provided for @chooseTransportDestination.
  ///
  /// In en, this message translates to:
  /// **'Choose a destination for the car.'**
  String get chooseTransportDestination;

  /// No description provided for @whereIsTheCarGoing.
  ///
  /// In en, this message translates to:
  /// **'Where is the car going?'**
  String get whereIsTheCarGoing;

  /// No description provided for @searchDestinationCountry.
  ///
  /// In en, this message translates to:
  /// **'Search destination country'**
  String get searchDestinationCountry;

  /// No description provided for @noDestinationCountriesMatch.
  ///
  /// In en, this message translates to:
  /// **'No destination countries match your search.'**
  String get noDestinationCountriesMatch;

  /// No description provided for @transportBusinessesWillQuote.
  ///
  /// In en, this message translates to:
  /// **'Eligible verified businesses serving this destination will receive the vehicle details and send you quotes to compare.'**
  String get transportBusinessesWillQuote;

  /// No description provided for @vehicleCondition.
  ///
  /// In en, this message translates to:
  /// **'Vehicle condition'**
  String get vehicleCondition;

  /// No description provided for @vehicleRunsAndDrives.
  ///
  /// In en, this message translates to:
  /// **'Runs and drives'**
  String get vehicleRunsAndDrives;

  /// No description provided for @vehicleInoperable.
  ///
  /// In en, this message translates to:
  /// **'Inoperable'**
  String get vehicleInoperable;

  /// No description provided for @preferredTransportMethod.
  ///
  /// In en, this message translates to:
  /// **'Preferred transport method'**
  String get preferredTransportMethod;

  /// No description provided for @openTransport.
  ///
  /// In en, this message translates to:
  /// **'Open carrier'**
  String get openTransport;

  /// No description provided for @enclosedTransport.
  ///
  /// In en, this message translates to:
  /// **'Enclosed carrier'**
  String get enclosedTransport;

  /// No description provided for @pickupArea.
  ///
  /// In en, this message translates to:
  /// **'Pickup city, region, or postal code'**
  String get pickupArea;

  /// No description provided for @pickupAreaHint.
  ///
  /// In en, this message translates to:
  /// **'For example, Bronx, NY 10467'**
  String get pickupAreaHint;

  /// No description provided for @enterPickupArea.
  ///
  /// In en, this message translates to:
  /// **'Enter the pickup city, region, or postal code.'**
  String get enterPickupArea;

  /// No description provided for @flexibleTransportDates.
  ///
  /// In en, this message translates to:
  /// **'My dates are flexible'**
  String get flexibleTransportDates;

  /// No description provided for @flexibleTransportDatesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Businesses may quote the best available pickup window.'**
  String get flexibleTransportDatesSubtitle;

  /// No description provided for @transportMarketplaceRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Request {trackingCode} sent to eligible businesses. You can compare their quotes in your orders.'**
  String transportMarketplaceRequestSent(Object trackingCode);

  /// No description provided for @transportQuotesTitle.
  ///
  /// In en, this message translates to:
  /// **'Business quotes'**
  String get transportQuotesTitle;

  /// No description provided for @transportQuotesIntro.
  ///
  /// In en, this message translates to:
  /// **'Compare the total price, timing, method, and terms before choosing a transporter.'**
  String get transportQuotesIntro;

  /// No description provided for @waitingForTransportQuotes.
  ///
  /// In en, this message translates to:
  /// **'Waiting for business quotes'**
  String get waitingForTransportQuotes;

  /// No description provided for @waitingForTransportQuotesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Eligible verified businesses can review the route and vehicle now. We will keep this order updated as quotes arrive.'**
  String get waitingForTransportQuotesSubtitle;

  /// No description provided for @couldNotLoadTransportQuotes.
  ///
  /// In en, this message translates to:
  /// **'The business quotes could not be loaded. Try again.'**
  String get couldNotLoadTransportQuotes;

  /// No description provided for @estimatedPickup.
  ///
  /// In en, this message translates to:
  /// **'Estimated pickup'**
  String get estimatedPickup;

  /// No description provided for @estimatedDelivery.
  ///
  /// In en, this message translates to:
  /// **'Estimated delivery'**
  String get estimatedDelivery;

  /// No description provided for @transportMethod.
  ///
  /// In en, this message translates to:
  /// **'Transport method'**
  String get transportMethod;

  /// No description provided for @selectTransportQuote.
  ///
  /// In en, this message translates to:
  /// **'Choose this quote'**
  String get selectTransportQuote;

  /// No description provided for @selectingTransportQuote.
  ///
  /// In en, this message translates to:
  /// **'Selecting quote...'**
  String get selectingTransportQuote;

  /// No description provided for @confirmTransportQuoteTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose this transporter?'**
  String get confirmTransportQuoteTitle;

  /// No description provided for @confirmTransportQuoteMessage.
  ///
  /// In en, this message translates to:
  /// **'Choose {businessName} for {price}? The amount is held on your card, not charged, and cancelling while it is held is free. This closes the request to other businesses.'**
  String confirmTransportQuoteMessage(Object businessName, Object price);

  /// No description provided for @transportPaymentTitle.
  ///
  /// In en, this message translates to:
  /// **'Pay to confirm your carrier'**
  String get transportPaymentTitle;

  /// No description provided for @transportPaymentBody.
  ///
  /// In en, this message translates to:
  /// **'{price} is held on your card — not charged — and the carrier can only start once it is secured. Cancelling while held is free.'**
  String transportPaymentBody(Object price);

  /// No description provided for @transportPayNow.
  ///
  /// In en, this message translates to:
  /// **'Pay now'**
  String get transportPayNow;

  /// No description provided for @transportPaymentFailed.
  ///
  /// In en, this message translates to:
  /// **'The payment could not be completed. Nothing was charged — try again.'**
  String get transportPaymentFailed;

  /// No description provided for @keepComparing.
  ///
  /// In en, this message translates to:
  /// **'Keep comparing'**
  String get keepComparing;

  /// No description provided for @chooseThisBusiness.
  ///
  /// In en, this message translates to:
  /// **'Choose this business'**
  String get chooseThisBusiness;

  /// No description provided for @couldNotSelectTransportQuote.
  ///
  /// In en, this message translates to:
  /// **'This quote could not be selected. Check that it is still available and try again.'**
  String get couldNotSelectTransportQuote;

  /// No description provided for @transportQuoteSelectedTitle.
  ///
  /// In en, this message translates to:
  /// **'Transporter selected'**
  String get transportQuoteSelectedTitle;

  /// No description provided for @transportQuoteSelectedMessage.
  ///
  /// In en, this message translates to:
  /// **'{businessName} was selected for {price}. Your private contact and pickup details are now available to this business.'**
  String transportQuoteSelectedMessage(Object businessName, Object price);

  /// No description provided for @transportRequestCancelled.
  ///
  /// In en, this message translates to:
  /// **'Transport request cancelled'**
  String get transportRequestCancelled;

  /// No description provided for @transportRequestCancelledSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Businesses can no longer send or revise quotes for this request.'**
  String get transportRequestCancelledSubtitle;

  /// No description provided for @cancelTransportRequest.
  ///
  /// In en, this message translates to:
  /// **'Cancel transport request'**
  String get cancelTransportRequest;

  /// No description provided for @cancellingTransportRequest.
  ///
  /// In en, this message translates to:
  /// **'Cancelling request...'**
  String get cancellingTransportRequest;

  /// No description provided for @confirmCancelTransportRequestTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this request?'**
  String get confirmCancelTransportRequestTitle;

  /// No description provided for @confirmCancelTransportRequestMessage.
  ///
  /// In en, this message translates to:
  /// **'Businesses will no longer be able to send or revise quotes.'**
  String get confirmCancelTransportRequestMessage;

  /// No description provided for @keepRequestOpen.
  ///
  /// In en, this message translates to:
  /// **'Keep request open'**
  String get keepRequestOpen;

  /// No description provided for @couldNotCancelTransportRequest.
  ///
  /// In en, this message translates to:
  /// **'The transport request could not be cancelled. Try again.'**
  String get couldNotCancelTransportRequest;

  /// No description provided for @chooseBusinessAndDestination.
  ///
  /// In en, this message translates to:
  /// **'Choose a business and destination.'**
  String get chooseBusinessAndDestination;

  /// No description provided for @selectCarMakeModelYear.
  ///
  /// In en, this message translates to:
  /// **'Select the car make, model, and year.'**
  String get selectCarMakeModelYear;

  /// No description provided for @transportRequestSentToBusiness.
  ///
  /// In en, this message translates to:
  /// **'Request sent to {businessName}. Tracking {trackingCode}. They will send you a price quote.'**
  String transportRequestSentToBusiness(
    Object businessName,
    Object trackingCode,
  );

  /// No description provided for @couldNotSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Could not send request: {error}'**
  String couldNotSendRequest(Object error);

  /// No description provided for @pickPreferredDateOptional.
  ///
  /// In en, this message translates to:
  /// **'Pick a preferred date (optional)'**
  String get pickPreferredDateOptional;

  /// No description provided for @whoShouldHandleTransport.
  ///
  /// In en, this message translates to:
  /// **'Who should handle it?'**
  String get whoShouldHandleTransport;

  /// No description provided for @theCar.
  ///
  /// In en, this message translates to:
  /// **'The car'**
  String get theCar;

  /// No description provided for @contactAndPickup.
  ///
  /// In en, this message translates to:
  /// **'Contact & pickup'**
  String get contactAndPickup;

  /// No description provided for @businessDestination.
  ///
  /// In en, this message translates to:
  /// **'Business · destination'**
  String get businessDestination;

  /// No description provided for @pickupAddressOptional.
  ///
  /// In en, this message translates to:
  /// **'Pickup address (optional)'**
  String get pickupAddressOptional;

  /// No description provided for @notesForBusinessOptional.
  ///
  /// In en, this message translates to:
  /// **'Notes for the business (optional)'**
  String get notesForBusinessOptional;

  /// No description provided for @enterOwnerName.
  ///
  /// In en, this message translates to:
  /// **'Enter the owner name'**
  String get enterOwnerName;

  /// No description provided for @enterContactPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a contact phone'**
  String get enterContactPhone;

  /// No description provided for @sending.
  ///
  /// In en, this message translates to:
  /// **'Sending...'**
  String get sending;

  /// No description provided for @sendRequest.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get sendRequest;

  /// No description provided for @transportQuoteNoPaymentNote.
  ///
  /// In en, this message translates to:
  /// **'No payment now — eligible businesses send quotes and you choose which one to accept.'**
  String get transportQuoteNoPaymentNote;

  /// No description provided for @noTransportBusinessesYet.
  ///
  /// In en, this message translates to:
  /// **'No business is offering car transport yet'**
  String get noTransportBusinessesYet;

  /// No description provided for @noTransportBusinessesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Check back soon — businesses add transport routes as they come online.'**
  String get noTransportBusinessesSubtitle;

  /// No description provided for @couldNotLoadTransportOptions.
  ///
  /// In en, this message translates to:
  /// **'Could not load transport options'**
  String get couldNotLoadTransportOptions;

  /// No description provided for @receiverWhatsAppNumberTitle.
  ///
  /// In en, this message translates to:
  /// **'This receiver number is used on WhatsApp'**
  String get receiverWhatsAppNumberTitle;

  /// No description provided for @receiverWhatsAppNumberSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Use this only if the receiver uses a different country number on WhatsApp.'**
  String get receiverWhatsAppNumberSubtitle;

  /// No description provided for @invalidPhoneWithCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid phone number with country code.'**
  String get invalidPhoneWithCountryCode;

  /// No description provided for @invalidInternationalPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid international phone number.'**
  String get invalidInternationalPhone;

  /// No description provided for @whatsAppDifferentCountryRequiresCode.
  ///
  /// In en, this message translates to:
  /// **'For WhatsApp numbers from another country, include + and the country code.'**
  String get whatsAppDifferentCountryRequiresCode;

  /// No description provided for @receiverPhoneMustMatchDestination.
  ///
  /// In en, this message translates to:
  /// **'Receiver number must match {destinationName} ({prefix}) or mark it as a WhatsApp number.'**
  String receiverPhoneMustMatchDestination(
    Object destinationName,
    Object prefix,
  );

  /// No description provided for @readyForPickup.
  ///
  /// In en, this message translates to:
  /// **'Ready for pickup'**
  String get readyForPickup;

  /// No description provided for @samePickup.
  ///
  /// In en, this message translates to:
  /// **'Same pickup'**
  String get samePickup;

  /// No description provided for @differentPickups.
  ///
  /// In en, this message translates to:
  /// **'Different pickups'**
  String get differentPickups;

  /// No description provided for @boroughPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'{borough} pickup address'**
  String boroughPickupAddress(Object borough);

  /// No description provided for @barrelsForThisDestination.
  ///
  /// In en, this message translates to:
  /// **'Barrels for this destination'**
  String get barrelsForThisDestination;

  /// No description provided for @decrease.
  ///
  /// In en, this message translates to:
  /// **'Decrease'**
  String get decrease;

  /// No description provided for @increase.
  ///
  /// In en, this message translates to:
  /// **'Increase'**
  String get increase;

  /// No description provided for @edit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get edit;

  /// No description provided for @remove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get remove;

  /// No description provided for @barrelCartLine.
  ///
  /// In en, this message translates to:
  /// **'{quantity, plural, =1{1 barrel} other{{quantity} barrels}} → {receiverName}'**
  String barrelCartLine(int quantity, Object receiverName);

  /// No description provided for @holdPricingSummary.
  ///
  /// In en, this message translates to:
  /// **'Hold pricing: {mode}{days}'**
  String holdPricingSummary(Object mode, Object days);

  /// No description provided for @holdDaysSuffix.
  ///
  /// In en, this message translates to:
  /// **' • {days} day(s)'**
  String holdDaysSuffix(Object days);

  /// No description provided for @flat.
  ///
  /// In en, this message translates to:
  /// **'Flat'**
  String get flat;

  /// No description provided for @forfeitureStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Forfeiture: {status}'**
  String forfeitureStatusLabel(Object status);

  /// No description provided for @holdDateReachedStaffAction.
  ///
  /// In en, this message translates to:
  /// **'Hold date reached. Mark this vehicle as sold or mark the customer as not shown.'**
  String get holdDateReachedStaffAction;

  /// No description provided for @extensionStatusLine.
  ///
  /// In en, this message translates to:
  /// **'Extension: {status}{date}{amount}'**
  String extensionStatusLine(Object status, Object date, Object amount);

  /// No description provided for @dateSuffix.
  ///
  /// In en, this message translates to:
  /// **' • {date}'**
  String dateSuffix(Object date);

  /// No description provided for @extraAmountSuffix.
  ///
  /// In en, this message translates to:
  /// **' • extra {amount}'**
  String extraAmountSuffix(Object amount);

  /// No description provided for @buyerHistoryLine.
  ///
  /// In en, this message translates to:
  /// **'Buyer history: {completed} completed, {noShows} no-show, {forfeitures} forfeited'**
  String buyerHistoryLine(Object completed, Object noShows, Object forfeitures);

  /// No description provided for @customerDidNotCome.
  ///
  /// In en, this message translates to:
  /// **'Customer did not come'**
  String get customerDidNotCome;

  /// No description provided for @approveExtension.
  ///
  /// In en, this message translates to:
  /// **'Approve extension'**
  String get approveExtension;

  /// No description provided for @rejectExtension.
  ///
  /// In en, this message translates to:
  /// **'Reject extension'**
  String get rejectExtension;

  /// No description provided for @navbarPickerInstructions.
  ///
  /// In en, this message translates to:
  /// **'Pick up to {count} services for quick access in your bottom bar. Drag to reorder.'**
  String navbarPickerInstructions(int count);

  /// No description provided for @inYourNavbar.
  ///
  /// In en, this message translates to:
  /// **'In your navbar'**
  String get inYourNavbar;

  /// No description provided for @nothingPinnedYet.
  ///
  /// In en, this message translates to:
  /// **'Nothing pinned yet — add services below.'**
  String get nothingPinnedYet;

  /// No description provided for @addServices.
  ///
  /// In en, this message translates to:
  /// **'Add services'**
  String get addServices;

  /// No description provided for @navbarFullMessage.
  ///
  /// In en, this message translates to:
  /// **'Navbar is full ({count}). Remove one to add another.'**
  String navbarFullMessage(int count);

  /// No description provided for @activeDestinationsRequireFee.
  ///
  /// In en, this message translates to:
  /// **'Active destinations require at least one configured service.'**
  String get activeDestinationsRequireFee;

  /// No description provided for @seedCountriesEmptyInstruction.
  ///
  /// In en, this message translates to:
  /// **'Seed the full country catalog, then search and activate the destinations you serve.'**
  String get seedCountriesEmptyInstruction;

  /// No description provided for @barrelPriceSummary.
  ///
  /// In en, this message translates to:
  /// **'Barrel: {price}'**
  String barrelPriceSummary(Object price);

  /// No description provided for @deliveryEstimateSummary.
  ///
  /// In en, this message translates to:
  /// **'Delivery: {estimate}'**
  String deliveryEstimateSummary(Object estimate);

  /// No description provided for @businessProfileTitle.
  ///
  /// In en, this message translates to:
  /// **'Business profile'**
  String get businessProfileTitle;

  /// No description provided for @splashTagline.
  ///
  /// In en, this message translates to:
  /// **'Motorcars, barrels & passage in one place.'**
  String get splashTagline;

  /// No description provided for @splashMarketplace.
  ///
  /// In en, this message translates to:
  /// **'MARKETPLACE'**
  String get splashMarketplace;

  /// No description provided for @splashOpening.
  ///
  /// In en, this message translates to:
  /// **'OPENING LAAWOL'**
  String get splashOpening;

  /// No description provided for @accountProfileUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The connection is slow. We could not safely load your account role.'**
  String get accountProfileUnavailable;

  /// No description provided for @accountProfileMissing.
  ///
  /// In en, this message translates to:
  /// **'Your account profile is missing. Contact Laawol support.'**
  String get accountProfileMissing;

  /// No description provided for @accountProfileRetryHelp.
  ///
  /// In en, this message translates to:
  /// **'Retry without signing out or losing your session.'**
  String get accountProfileRetryHelp;

  /// No description provided for @addMoney.
  ///
  /// In en, this message translates to:
  /// **'Add money'**
  String get addMoney;

  /// No description provided for @myOrders.
  ///
  /// In en, this message translates to:
  /// **'My orders'**
  String get myOrders;

  /// No description provided for @goodMorning.
  ///
  /// In en, this message translates to:
  /// **'Good morning'**
  String get goodMorning;

  /// No description provided for @goodAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Good afternoon'**
  String get goodAfternoon;

  /// No description provided for @goodEvening.
  ///
  /// In en, this message translates to:
  /// **'Good evening'**
  String get goodEvening;

  /// No description provided for @signInToYourAccount.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account'**
  String get signInToYourAccount;

  /// No description provided for @accountSignInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Track your orders and shipments.'**
  String get accountSignInSubtitle;

  /// No description provided for @shippingBusinessUnavailable.
  ///
  /// In en, this message translates to:
  /// **'{businessName} is not shipping to {countryName}, and no alternate business is available yet.'**
  String shippingBusinessUnavailable(Object businessName, Object countryName);

  /// No description provided for @shippingBusinessWillChange.
  ///
  /// In en, this message translates to:
  /// **'Shipping business will change'**
  String get shippingBusinessWillChange;

  /// No description provided for @shippingBusinessChangeMessage.
  ///
  /// In en, this message translates to:
  /// **'{businessName} does not deliver to {countryName}. Choose another approved business to continue.'**
  String shippingBusinessChangeMessage(Object businessName, Object countryName);

  /// No description provided for @availableBusinesses.
  ///
  /// In en, this message translates to:
  /// **'Available businesses'**
  String get availableBusinesses;

  /// No description provided for @deliveryLabel.
  ///
  /// In en, this message translates to:
  /// **'Delivery {value}'**
  String deliveryLabel(Object value);

  /// No description provided for @pickupDateAndTime.
  ///
  /// In en, this message translates to:
  /// **'Pickup date and time'**
  String get pickupDateAndTime;

  /// No description provided for @shipmentEstimate.
  ///
  /// In en, this message translates to:
  /// **'Shipment estimate'**
  String get shipmentEstimate;

  /// No description provided for @addProfilePicture.
  ///
  /// In en, this message translates to:
  /// **'Add profile picture'**
  String get addProfilePicture;

  /// No description provided for @registerBusinessInstead.
  ///
  /// In en, this message translates to:
  /// **'Register your business instead'**
  String get registerBusinessInstead;

  /// No description provided for @businessApprovalSetupNote.
  ///
  /// In en, this message translates to:
  /// **'You can set up destinations, cars, and staff immediately. Customers will only see your business after platform approval.'**
  String get businessApprovalSetupNote;

  /// No description provided for @businessProfilePicture.
  ///
  /// In en, this message translates to:
  /// **'Business profile picture'**
  String get businessProfilePicture;

  /// No description provided for @businessProfilePictureHelper.
  ///
  /// In en, this message translates to:
  /// **'Upload a logo or storefront image customers can recognize.'**
  String get businessProfilePictureHelper;

  /// No description provided for @joinMarketplace.
  ///
  /// In en, this message translates to:
  /// **'Join the marketplace'**
  String get joinMarketplace;

  /// No description provided for @businessApplicationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Apply once, prepare your operations, then go live when approved.'**
  String get businessApplicationSubtitle;

  /// No description provided for @businessOperations.
  ///
  /// In en, this message translates to:
  /// **'Business operations'**
  String get businessOperations;

  /// No description provided for @businessOperationsWebNote.
  ///
  /// In en, this message translates to:
  /// **'Opens the secure business console in your browser, where staff, payouts and destinations live.'**
  String get businessOperationsWebNote;

  /// No description provided for @businessServiceOverviewUnpaid.
  ///
  /// In en, this message translates to:
  /// **'Unpaid'**
  String get businessServiceOverviewUnpaid;

  /// No description provided for @businessServiceOverviewOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get businessServiceOverviewOpen;

  /// No description provided for @businessServiceOverviewShowAll.
  ///
  /// In en, this message translates to:
  /// **'Show all activity'**
  String get businessServiceOverviewShowAll;

  /// No description provided for @businessServiceOverviewEmpty.
  ///
  /// In en, this message translates to:
  /// **'No services are switched on for your account yet.'**
  String get businessServiceOverviewEmpty;

  /// No description provided for @businessCarsMobileNote.
  ///
  /// In en, this message translates to:
  /// **'Vehicle listings and purchases are also available in the mobile tabs below.'**
  String get businessCarsMobileNote;

  /// No description provided for @openBusinessConsole.
  ///
  /// In en, this message translates to:
  /// **'Open business console'**
  String get openBusinessConsole;

  /// No description provided for @openingBusinessConsole.
  ///
  /// In en, this message translates to:
  /// **'Opening business console...'**
  String get openingBusinessConsole;

  /// No description provided for @businessConsoleOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open the business console. Visit business.laawoldigital.com in your browser.'**
  String get businessConsoleOpenFailed;

  /// No description provided for @businessAssistantTitle.
  ///
  /// In en, this message translates to:
  /// **'Assistant'**
  String get businessAssistantTitle;

  /// No description provided for @businessAssistantOpen.
  ///
  /// In en, this message translates to:
  /// **'Ask the assistant'**
  String get businessAssistantOpen;

  /// No description provided for @businessAssistantEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'How can I help today?'**
  String get businessAssistantEmptyTitle;

  /// No description provided for @businessAssistantEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'I can answer questions about your operations and record work for you. Try asking me to:'**
  String get businessAssistantEmptyHint;

  /// No description provided for @businessAssistantCapabilityParkedCars.
  ///
  /// In en, this message translates to:
  /// **'Check which cars are parked right now'**
  String get businessAssistantCapabilityParkedCars;

  /// No description provided for @businessAssistantCapabilityWalkUp.
  ///
  /// In en, this message translates to:
  /// **'Record a walk-up parking entry'**
  String get businessAssistantCapabilityWalkUp;

  /// No description provided for @businessAssistantCapabilityTracking.
  ///
  /// In en, this message translates to:
  /// **'Add a shipment tracking update'**
  String get businessAssistantCapabilityTracking;

  /// No description provided for @businessAssistantInputHint.
  ///
  /// In en, this message translates to:
  /// **'Message the assistant...'**
  String get businessAssistantInputHint;

  /// No description provided for @businessAssistantSend.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get businessAssistantSend;

  /// No description provided for @businessAssistantConfirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get businessAssistantConfirm;

  /// No description provided for @businessAssistantCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get businessAssistantCancel;

  /// No description provided for @businessAssistantConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get businessAssistantConfirmed;

  /// No description provided for @businessAssistantDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get businessAssistantDeclined;

  /// No description provided for @businessAssistantError.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get businessAssistantError;

  /// No description provided for @businessChangesRequestedBanner.
  ///
  /// In en, this message translates to:
  /// **'A platform admin requested changes. You can keep editing your setup while the business stays hidden from customers.'**
  String get businessChangesRequestedBanner;

  /// No description provided for @businessPendingApprovalBanner.
  ///
  /// In en, this message translates to:
  /// **'Your business is pending platform approval. You can set up destinations, cars, and staff now; customers will see it after approval.'**
  String get businessPendingApprovalBanner;

  /// No description provided for @totalDaysLabel.
  ///
  /// In en, this message translates to:
  /// **'Total Days: {days}'**
  String totalDaysLabel(Object days);

  /// No description provided for @totalCostLabel.
  ///
  /// In en, this message translates to:
  /// **'Total Cost: {cost}'**
  String totalCostLabel(Object cost);

  /// No description provided for @customerRequest.
  ///
  /// In en, this message translates to:
  /// **'Customer request'**
  String get customerRequest;

  /// No description provided for @awaitingQuote.
  ///
  /// In en, this message translates to:
  /// **'Awaiting quote'**
  String get awaitingQuote;

  /// No description provided for @setPriceQuoteInstruction.
  ///
  /// In en, this message translates to:
  /// **'Set a price below to send this customer a quote.'**
  String get setPriceQuoteInstruction;

  /// No description provided for @barrelOrder.
  ///
  /// In en, this message translates to:
  /// **'Barrel order'**
  String get barrelOrder;

  /// No description provided for @barrelOrderSummary.
  ///
  /// In en, this message translates to:
  /// **'{barrelCount, plural, =1{1 barrel} other{{barrelCount} barrels}} • {destinationCount, plural, =1{1 destination} other{{destinationCount} destinations}} • {businessCount, plural, =1{1 business} other{{businessCount} businesses}}'**
  String barrelOrderSummary(
    int barrelCount,
    int destinationCount,
    int businessCount,
  );

  /// No description provided for @clear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get clear;

  /// No description provided for @signInToSaveBarrelShipment.
  ///
  /// In en, this message translates to:
  /// **'Sign in or create an account so we can securely save this barrel shipment and show it in tracking.'**
  String get signInToSaveBarrelShipment;

  /// No description provided for @editDestinationPickupHelp.
  ///
  /// In en, this message translates to:
  /// **'Use Edit on each destination row to add or change that destination\'s pickup details.'**
  String get editDestinationPickupHelp;

  /// No description provided for @businessesShippingToCountry.
  ///
  /// In en, this message translates to:
  /// **'Businesses shipping to this country'**
  String get businessesShippingToCountry;

  /// No description provided for @fixedPickupPriceForBorough.
  ///
  /// In en, this message translates to:
  /// **'Fixed pickup price for this borough'**
  String get fixedPickupPriceForBorough;

  /// No description provided for @barrelRateUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Rate unavailable'**
  String get barrelRateUnavailable;

  /// No description provided for @finalPriceConfirmedByStaff.
  ///
  /// In en, this message translates to:
  /// **'Final price will be confirmed by staff.'**
  String get finalPriceConfirmedByStaff;

  /// No description provided for @useWalletCredit.
  ///
  /// In en, this message translates to:
  /// **'Use wallet credit'**
  String get useWalletCredit;

  /// No description provided for @whereAreBarrelsGoing.
  ///
  /// In en, this message translates to:
  /// **'Where are these barrels going?'**
  String get whereAreBarrelsGoing;

  /// No description provided for @addDestinationInstruction.
  ///
  /// In en, this message translates to:
  /// **'Add a destination — country, business, who receives it, and how many barrels are going there.'**
  String get addDestinationInstruction;

  /// No description provided for @addDestination.
  ///
  /// In en, this message translates to:
  /// **'Add a destination'**
  String get addDestination;

  /// No description provided for @destinationsTitle.
  ///
  /// In en, this message translates to:
  /// **'Destinations'**
  String get destinationsTitle;

  /// No description provided for @barrelDestinationStartSummary.
  ///
  /// In en, this message translates to:
  /// **'Start with where the barrels are going and how many you are sending.'**
  String get barrelDestinationStartSummary;

  /// No description provided for @barrelDestinationSummary.
  ///
  /// In en, this message translates to:
  /// **'{barrelCount, plural, =1{1 barrel} other{{barrelCount} barrels}} to {destinationCount, plural, =1{1 destination} other{{destinationCount} destinations}}.'**
  String barrelDestinationSummary(int barrelCount, int destinationCount);

  /// No description provided for @addAnotherDestination.
  ///
  /// In en, this message translates to:
  /// **'Add another destination'**
  String get addAnotherDestination;

  /// No description provided for @editDestination.
  ///
  /// In en, this message translates to:
  /// **'Edit destination'**
  String get editDestination;

  /// No description provided for @destinationNumber.
  ///
  /// In en, this message translates to:
  /// **'Destination {number}'**
  String destinationNumber(int number);

  /// No description provided for @saveDestination.
  ///
  /// In en, this message translates to:
  /// **'Save destination'**
  String get saveDestination;

  /// No description provided for @addToOrder.
  ///
  /// In en, this message translates to:
  /// **'Add to order'**
  String get addToOrder;

  /// No description provided for @holdPerDayDescription.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1-day hold} other{{days}-day hold}} at {amount} per day'**
  String holdPerDayDescription(int days, Object amount);

  /// No description provided for @holdFlatFeeDescription.
  ///
  /// In en, this message translates to:
  /// **'Flat hold fee for up to {days} days'**
  String holdFlatFeeDescription(int days);

  /// No description provided for @pleaseChooseBusiness.
  ///
  /// In en, this message translates to:
  /// **'Please choose a business'**
  String get pleaseChooseBusiness;

  /// No description provided for @originalEstimatedCost.
  ///
  /// In en, this message translates to:
  /// **'Original estimated cost'**
  String get originalEstimatedCost;

  /// No description provided for @walletCredit.
  ///
  /// In en, this message translates to:
  /// **'Wallet credit'**
  String get walletCredit;

  /// No description provided for @cardPaymentDue.
  ///
  /// In en, this message translates to:
  /// **'Card payment due'**
  String get cardPaymentDue;

  /// No description provided for @addAtLeastOneDestination.
  ///
  /// In en, this message translates to:
  /// **'Add at least one destination to this order.'**
  String get addAtLeastOneDestination;

  /// No description provided for @noApprovedBusinessShippingDestination.
  ///
  /// In en, this message translates to:
  /// **'No approved business is currently shipping to this destination.'**
  String get noApprovedBusinessShippingDestination;

  /// No description provided for @businessOptionsUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Business options are not available right now. Please try again in a moment.'**
  String get businessOptionsUnavailable;

  /// No description provided for @gettingYourLocation.
  ///
  /// In en, this message translates to:
  /// **'Getting your location...'**
  String get gettingYourLocation;

  /// No description provided for @useMyCurrentLocation.
  ///
  /// In en, this message translates to:
  /// **'Use my current location'**
  String get useMyCurrentLocation;

  /// No description provided for @currentLocationAdded.
  ///
  /// In en, this message translates to:
  /// **'Current location added'**
  String get currentLocationAdded;

  /// No description provided for @choosePickupDateAndTime.
  ///
  /// In en, this message translates to:
  /// **'Choose pickup date and time'**
  String get choosePickupDateAndTime;

  /// No description provided for @amountDueNow.
  ///
  /// In en, this message translates to:
  /// **'Amount due now'**
  String get amountDueNow;

  /// No description provided for @estimatedCost.
  ///
  /// In en, this message translates to:
  /// **'Estimated cost'**
  String get estimatedCost;

  /// No description provided for @supportCenter.
  ///
  /// In en, this message translates to:
  /// **'Support center'**
  String get supportCenter;

  /// No description provided for @supportCases.
  ///
  /// In en, this message translates to:
  /// **'Support cases'**
  String get supportCases;

  /// No description provided for @supportInbox.
  ///
  /// In en, this message translates to:
  /// **'Support inbox'**
  String get supportInbox;

  /// No description provided for @supportInboxSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Customer issues, business replies, and admin escalations.'**
  String get supportInboxSubtitle;

  /// No description provided for @supportChat.
  ///
  /// In en, this message translates to:
  /// **'Support chat'**
  String get supportChat;

  /// No description provided for @getHelp.
  ///
  /// In en, this message translates to:
  /// **'Get help'**
  String get getHelp;

  /// No description provided for @openSupport.
  ///
  /// In en, this message translates to:
  /// **'Open support'**
  String get openSupport;

  /// No description provided for @openingSupport.
  ///
  /// In en, this message translates to:
  /// **'Opening support...'**
  String get openingSupport;

  /// No description provided for @writeSupportMessage.
  ///
  /// In en, this message translates to:
  /// **'Write a message'**
  String get writeSupportMessage;

  /// No description provided for @sendMessage.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get sendMessage;

  /// No description provided for @sendingMessage.
  ///
  /// In en, this message translates to:
  /// **'Sending...'**
  String get sendingMessage;

  /// No description provided for @supportMessageRequired.
  ///
  /// In en, this message translates to:
  /// **'Write a message before sending.'**
  String get supportMessageRequired;

  /// No description provided for @supportNoCases.
  ///
  /// In en, this message translates to:
  /// **'No support cases yet'**
  String get supportNoCases;

  /// No description provided for @supportNoCasesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Cases appear here when customers ask a business for help.'**
  String get supportNoCasesSubtitle;

  /// No description provided for @supportSearch.
  ///
  /// In en, this message translates to:
  /// **'Search support cases'**
  String get supportSearch;

  /// No description provided for @supportBusinessFirst.
  ///
  /// In en, this message translates to:
  /// **'Business first'**
  String get supportBusinessFirst;

  /// No description provided for @supportEscalated.
  ///
  /// In en, this message translates to:
  /// **'Escalated'**
  String get supportEscalated;

  /// No description provided for @supportResolved.
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get supportResolved;

  /// No description provided for @supportWaitingBusiness.
  ///
  /// In en, this message translates to:
  /// **'Waiting for business'**
  String get supportWaitingBusiness;

  /// No description provided for @supportWaitingCustomer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for customer'**
  String get supportWaitingCustomer;

  /// No description provided for @supportAdminReviewing.
  ///
  /// In en, this message translates to:
  /// **'Admin reviewing'**
  String get supportAdminReviewing;

  /// No description provided for @supportUrgent.
  ///
  /// In en, this message translates to:
  /// **'Urgent'**
  String get supportUrgent;

  /// No description provided for @supportNormal.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get supportNormal;

  /// No description provided for @supportLinkedRecord.
  ///
  /// In en, this message translates to:
  /// **'Linked record'**
  String get supportLinkedRecord;

  /// No description provided for @supportCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get supportCustomer;

  /// No description provided for @supportBusiness.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get supportBusiness;

  /// No description provided for @supportPlatformAdmin.
  ///
  /// In en, this message translates to:
  /// **'Laawol admin'**
  String get supportPlatformAdmin;

  /// No description provided for @supportAskPlatform.
  ///
  /// In en, this message translates to:
  /// **'Ask Laawol admin to help'**
  String get supportAskPlatform;

  /// No description provided for @businessSupportAskAdmin.
  ///
  /// In en, this message translates to:
  /// **'Ask platform admin'**
  String get businessSupportAskAdmin;

  /// No description provided for @businessSupportTitle.
  ///
  /// In en, this message translates to:
  /// **'Ask platform admin for help'**
  String get businessSupportTitle;

  /// No description provided for @businessSupportSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Send a support request to Laawol admins about your business account, operations, payouts, or platform access.'**
  String get businessSupportSubtitle;

  /// No description provided for @businessSupportSubject.
  ///
  /// In en, this message translates to:
  /// **'Support subject'**
  String get businessSupportSubject;

  /// No description provided for @businessSupportSubjectRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a support subject.'**
  String get businessSupportSubjectRequired;

  /// No description provided for @supportEscalating.
  ///
  /// In en, this message translates to:
  /// **'Escalating...'**
  String get supportEscalating;

  /// No description provided for @supportEscalationTitle.
  ///
  /// In en, this message translates to:
  /// **'Ask Laawol admin to help'**
  String get supportEscalationTitle;

  /// No description provided for @supportEscalationSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Use this when the business cannot resolve the issue or the issue is urgent.'**
  String get supportEscalationSubtitle;

  /// No description provided for @supportEscalationReason.
  ///
  /// In en, this message translates to:
  /// **'Escalation reason'**
  String get supportEscalationReason;

  /// No description provided for @supportEscalationNote.
  ///
  /// In en, this message translates to:
  /// **'Add details for the admin'**
  String get supportEscalationNote;

  /// No description provided for @supportEscalationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Admin escalation becomes available after the business response window unless the issue is urgent.'**
  String get supportEscalationUnavailable;

  /// No description provided for @supportEscalationUrgentOnly.
  ///
  /// In en, this message translates to:
  /// **'Normal escalation unlocks after the business response window. Urgent reasons can be sent now.'**
  String get supportEscalationUrgentOnly;

  /// No description provided for @supportAlreadyEscalatedTitle.
  ///
  /// In en, this message translates to:
  /// **'Already escalated to Laawol admin'**
  String get supportAlreadyEscalatedTitle;

  /// No description provided for @supportAlreadyEscalatedSubtitle.
  ///
  /// In en, this message translates to:
  /// **'This case is already in the Laawol admin queue.'**
  String get supportAlreadyEscalatedSubtitle;

  /// No description provided for @supportReasonUnresolved.
  ///
  /// In en, this message translates to:
  /// **'Business did not resolve it'**
  String get supportReasonUnresolved;

  /// No description provided for @supportReasonFraud.
  ///
  /// In en, this message translates to:
  /// **'Fraud or suspicious activity'**
  String get supportReasonFraud;

  /// No description provided for @supportReasonSafety.
  ///
  /// In en, this message translates to:
  /// **'Safety concern'**
  String get supportReasonSafety;

  /// No description provided for @supportReasonAbuse.
  ///
  /// In en, this message translates to:
  /// **'Abusive behavior'**
  String get supportReasonAbuse;

  /// No description provided for @supportReasonPaymentNoService.
  ///
  /// In en, this message translates to:
  /// **'Payment taken, service not provided'**
  String get supportReasonPaymentNoService;

  /// No description provided for @supportReasonBusinessUnreachable.
  ///
  /// In en, this message translates to:
  /// **'Business unreachable'**
  String get supportReasonBusinessUnreachable;

  /// No description provided for @supportReasonTimeSensitive.
  ///
  /// In en, this message translates to:
  /// **'Pickup or delivery is time-sensitive'**
  String get supportReasonTimeSensitive;

  /// No description provided for @supportEvidence.
  ///
  /// In en, this message translates to:
  /// **'Evidence'**
  String get supportEvidence;

  /// No description provided for @supportAddImage.
  ///
  /// In en, this message translates to:
  /// **'Add image'**
  String get supportAddImage;

  /// No description provided for @supportAddAttachment.
  ///
  /// In en, this message translates to:
  /// **'Add attachment'**
  String get supportAddAttachment;

  /// No description provided for @supportAttachmentSheetTitle.
  ///
  /// In en, this message translates to:
  /// **'Add attachment'**
  String get supportAttachmentSheetTitle;

  /// No description provided for @supportPhoto.
  ///
  /// In en, this message translates to:
  /// **'Photo'**
  String get supportPhoto;

  /// No description provided for @supportVideo.
  ///
  /// In en, this message translates to:
  /// **'Video'**
  String get supportVideo;

  /// No description provided for @supportFile.
  ///
  /// In en, this message translates to:
  /// **'File'**
  String get supportFile;

  /// No description provided for @supportUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading...'**
  String get supportUploading;

  /// No description provided for @supportReviewAttachmentTitle.
  ///
  /// In en, this message translates to:
  /// **'Review attachment'**
  String get supportReviewAttachmentTitle;

  /// No description provided for @supportUploadAttachment.
  ///
  /// In en, this message translates to:
  /// **'Upload'**
  String get supportUploadAttachment;

  /// No description provided for @supportReplaceAttachment.
  ///
  /// In en, this message translates to:
  /// **'Replace'**
  String get supportReplaceAttachment;

  /// No description provided for @supportAttachmentCaption.
  ///
  /// In en, this message translates to:
  /// **'Caption (optional)'**
  String get supportAttachmentCaption;

  /// No description provided for @supportPreviewUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Preview unavailable. You can still upload this file.'**
  String get supportPreviewUnavailable;

  /// No description provided for @supportUploadFailed.
  ///
  /// In en, this message translates to:
  /// **'Upload failed. Try again.'**
  String get supportUploadFailed;

  /// No description provided for @supportUploadFailedNetwork.
  ///
  /// In en, this message translates to:
  /// **'Upload failed. Check your connection and try again.'**
  String get supportUploadFailedNetwork;

  /// No description provided for @supportUploadFailedAuth.
  ///
  /// In en, this message translates to:
  /// **'Upload failed because your sign-in expired. Sign in again, then retry.'**
  String get supportUploadFailedAuth;

  /// No description provided for @supportUploadFailedPermission.
  ///
  /// In en, this message translates to:
  /// **'Upload failed because your account cannot add files to this support case.'**
  String get supportUploadFailedPermission;

  /// No description provided for @supportUploadFailedInvalidFile.
  ///
  /// In en, this message translates to:
  /// **'Upload failed because this file type or size is not allowed.'**
  String get supportUploadFailedInvalidFile;

  /// No description provided for @supportUploadFailedAppVerification.
  ///
  /// In en, this message translates to:
  /// **'Upload blocked by app verification. Update the app or contact support.'**
  String get supportUploadFailedAppVerification;

  /// No description provided for @supportUploadFailedDebugAppCheck.
  ///
  /// In en, this message translates to:
  /// **'Upload blocked by Firebase App Check. Register this debug device token, then retry.'**
  String get supportUploadFailedDebugAppCheck;

  /// No description provided for @supportImagePreviewLabel.
  ///
  /// In en, this message translates to:
  /// **'Image preview: {name}'**
  String supportImagePreviewLabel(Object name);

  /// No description provided for @supportRequestEvidence.
  ///
  /// In en, this message translates to:
  /// **'Request evidence'**
  String get supportRequestEvidence;

  /// No description provided for @supportRequestingEvidence.
  ///
  /// In en, this message translates to:
  /// **'Requesting...'**
  String get supportRequestingEvidence;

  /// No description provided for @supportEvidenceNote.
  ///
  /// In en, this message translates to:
  /// **'What should the customer add?'**
  String get supportEvidenceNote;

  /// No description provided for @supportResolve.
  ///
  /// In en, this message translates to:
  /// **'Mark resolved'**
  String get supportResolve;

  /// No description provided for @supportResolving.
  ///
  /// In en, this message translates to:
  /// **'Resolving...'**
  String get supportResolving;

  /// No description provided for @supportReopen.
  ///
  /// In en, this message translates to:
  /// **'Reopen'**
  String get supportReopen;

  /// No description provided for @supportReopening.
  ///
  /// In en, this message translates to:
  /// **'Reopening...'**
  String get supportReopening;

  /// No description provided for @supportInternalNotes.
  ///
  /// In en, this message translates to:
  /// **'Internal notes'**
  String get supportInternalNotes;

  /// No description provided for @supportAddInternalNote.
  ///
  /// In en, this message translates to:
  /// **'Add internal note'**
  String get supportAddInternalNote;

  /// No description provided for @supportSavingNote.
  ///
  /// In en, this message translates to:
  /// **'Saving note...'**
  String get supportSavingNote;

  /// No description provided for @supportNote.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get supportNote;

  /// No description provided for @supportTimeline.
  ///
  /// In en, this message translates to:
  /// **'Timeline'**
  String get supportTimeline;

  /// No description provided for @supportActions.
  ///
  /// In en, this message translates to:
  /// **'Actions'**
  String get supportActions;

  /// No description provided for @supportFilters.
  ///
  /// In en, this message translates to:
  /// **'Filters'**
  String get supportFilters;

  /// No description provided for @supportAllCases.
  ///
  /// In en, this message translates to:
  /// **'All cases'**
  String get supportAllCases;

  /// No description provided for @supportSlaBreaches.
  ///
  /// In en, this message translates to:
  /// **'SLA breaches'**
  String get supportSlaBreaches;

  /// No description provided for @supportFraudSafety.
  ///
  /// In en, this message translates to:
  /// **'Fraud and safety'**
  String get supportFraudSafety;

  /// No description provided for @supportOpenFromTransaction.
  ///
  /// In en, this message translates to:
  /// **'Open a case with the responsible business. If unresolved, a Laawol admin can mediate.'**
  String get supportOpenFromTransaction;

  /// No description provided for @supportCaseOpened.
  ///
  /// In en, this message translates to:
  /// **'Support case opened'**
  String get supportCaseOpened;

  /// No description provided for @supportActionFailed.
  ///
  /// In en, this message translates to:
  /// **'Support action failed'**
  String get supportActionFailed;

  /// No description provided for @supportImageSource.
  ///
  /// In en, this message translates to:
  /// **'Choose an image'**
  String get supportImageSource;

  /// No description provided for @supportCamera.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get supportCamera;

  /// No description provided for @supportGallery.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get supportGallery;

  /// No description provided for @supportReplyingTo.
  ///
  /// In en, this message translates to:
  /// **'Replying to {name}'**
  String supportReplyingTo(Object name);

  /// No description provided for @supportEdited.
  ///
  /// In en, this message translates to:
  /// **'edited'**
  String get supportEdited;

  /// No description provided for @supportReply.
  ///
  /// In en, this message translates to:
  /// **'Reply'**
  String get supportReply;

  /// No description provided for @supportDeleteForMe.
  ///
  /// In en, this message translates to:
  /// **'Delete for me'**
  String get supportDeleteForMe;

  /// No description provided for @supportEditMessage.
  ///
  /// In en, this message translates to:
  /// **'Edit message'**
  String get supportEditMessage;

  /// No description provided for @supportSaveEdit.
  ///
  /// In en, this message translates to:
  /// **'Save edit'**
  String get supportSaveEdit;

  /// No description provided for @supportCancelReply.
  ///
  /// In en, this message translates to:
  /// **'Cancel reply'**
  String get supportCancelReply;

  /// No description provided for @supportCaseStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Status: {status}'**
  String supportCaseStatusLabel(Object status);

  /// No description provided for @support.
  ///
  /// In en, this message translates to:
  /// **'Support'**
  String get support;

  /// No description provided for @supportTeam.
  ///
  /// In en, this message translates to:
  /// **'Support team'**
  String get supportTeam;

  /// No description provided for @supportCase.
  ///
  /// In en, this message translates to:
  /// **'Support case'**
  String get supportCase;

  /// No description provided for @supportBusinessInbox.
  ///
  /// In en, this message translates to:
  /// **'Business support'**
  String get supportBusinessInbox;

  /// No description provided for @supportBusinessInboxSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Review customer cases, request evidence, and coordinate with Laawol support.'**
  String get supportBusinessInboxSubtitle;

  /// No description provided for @supportAdminQueue.
  ///
  /// In en, this message translates to:
  /// **'Support queue'**
  String get supportAdminQueue;

  /// No description provided for @supportAdminQueueSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Assign, escalate, resolve, and document marketplace cases.'**
  String get supportAdminQueueSubtitle;

  /// No description provided for @supportNewCase.
  ///
  /// In en, this message translates to:
  /// **'New case'**
  String get supportNewCase;

  /// No description provided for @supportUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Support is unavailable'**
  String get supportUnavailable;

  /// No description provided for @supportSignInRequired.
  ///
  /// In en, this message translates to:
  /// **'Sign in to open and review support cases.'**
  String get supportSignInRequired;

  /// No description provided for @supportBusinessRequired.
  ///
  /// In en, this message translates to:
  /// **'A business profile is required to use business support.'**
  String get supportBusinessRequired;

  /// No description provided for @supportUnableToLoad.
  ///
  /// In en, this message translates to:
  /// **'Unable to load support'**
  String get supportUnableToLoad;

  /// No description provided for @supportSearchCases.
  ///
  /// In en, this message translates to:
  /// **'Search cases'**
  String get supportSearchCases;

  /// No description provided for @supportNoCasesDesc.
  ///
  /// In en, this message translates to:
  /// **'Support conversations and updates will appear here.'**
  String get supportNoCasesDesc;

  /// No description provided for @supportLastMessageFallback.
  ///
  /// In en, this message translates to:
  /// **'Open the case to continue the conversation.'**
  String get supportLastMessageFallback;

  /// No description provided for @supportStatusOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get supportStatusOpen;

  /// No description provided for @supportStatusWaitingCustomer.
  ///
  /// In en, this message translates to:
  /// **'Waiting on customer'**
  String get supportStatusWaitingCustomer;

  /// No description provided for @supportStatusWaitingBusiness.
  ///
  /// In en, this message translates to:
  /// **'Waiting on business'**
  String get supportStatusWaitingBusiness;

  /// No description provided for @supportStatusResolved.
  ///
  /// In en, this message translates to:
  /// **'Resolved'**
  String get supportStatusResolved;

  /// No description provided for @supportStatusClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get supportStatusClosed;

  /// No description provided for @supportFilterWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get supportFilterWaiting;

  /// No description provided for @supportPriorityNormal.
  ///
  /// In en, this message translates to:
  /// **'Normal'**
  String get supportPriorityNormal;

  /// No description provided for @supportPriorityUrgent.
  ///
  /// In en, this message translates to:
  /// **'Urgent'**
  String get supportPriorityUrgent;

  /// No description provided for @supportPriorityEscalated.
  ///
  /// In en, this message translates to:
  /// **'Escalated'**
  String get supportPriorityEscalated;

  /// No description provided for @supportCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get supportCategory;

  /// No description provided for @supportCategoryGeneral.
  ///
  /// In en, this message translates to:
  /// **'General'**
  String get supportCategoryGeneral;

  /// No description provided for @supportCategoryPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get supportCategoryPayment;

  /// No description provided for @supportCategoryDelivery.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get supportCategoryDelivery;

  /// No description provided for @supportCategoryVehicle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle'**
  String get supportCategoryVehicle;

  /// No description provided for @supportCategoryBarrel.
  ///
  /// In en, this message translates to:
  /// **'Barrel'**
  String get supportCategoryBarrel;

  /// No description provided for @supportCategoryTransport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get supportCategoryTransport;

  /// No description provided for @supportCategoryRefund.
  ///
  /// In en, this message translates to:
  /// **'Refund'**
  String get supportCategoryRefund;

  /// No description provided for @supportAdmin.
  ///
  /// In en, this message translates to:
  /// **'Admin'**
  String get supportAdmin;

  /// No description provided for @supportSystem.
  ///
  /// In en, this message translates to:
  /// **'System'**
  String get supportSystem;

  /// No description provided for @supportSubject.
  ///
  /// In en, this message translates to:
  /// **'Subject'**
  String get supportSubject;

  /// No description provided for @supportInitialMessage.
  ///
  /// In en, this message translates to:
  /// **'Initial message'**
  String get supportInitialMessage;

  /// No description provided for @supportCreateCase.
  ///
  /// In en, this message translates to:
  /// **'Create case'**
  String get supportCreateCase;

  /// No description provided for @supportCreatingCase.
  ///
  /// In en, this message translates to:
  /// **'Creating case...'**
  String get supportCreatingCase;

  /// No description provided for @supportCaseActions.
  ///
  /// In en, this message translates to:
  /// **'Case actions'**
  String get supportCaseActions;

  /// No description provided for @supportAssignToMe.
  ///
  /// In en, this message translates to:
  /// **'Assign to me'**
  String get supportAssignToMe;

  /// No description provided for @supportResolveCase.
  ///
  /// In en, this message translates to:
  /// **'Resolve case'**
  String get supportResolveCase;

  /// No description provided for @supportReopenCase.
  ///
  /// In en, this message translates to:
  /// **'Reopen case'**
  String get supportReopenCase;

  /// No description provided for @supportEvidenceRequested.
  ///
  /// In en, this message translates to:
  /// **'Evidence requested'**
  String get supportEvidenceRequested;

  /// No description provided for @supportEvidenceAttached.
  ///
  /// In en, this message translates to:
  /// **'Evidence attached'**
  String get supportEvidenceAttached;

  /// No description provided for @supportEvidenceUploaded.
  ///
  /// In en, this message translates to:
  /// **'Evidence uploaded.'**
  String get supportEvidenceUploaded;

  /// No description provided for @supportEscalateCase.
  ///
  /// In en, this message translates to:
  /// **'Escalate case'**
  String get supportEscalateCase;

  /// No description provided for @supportEscalate.
  ///
  /// In en, this message translates to:
  /// **'Escalate'**
  String get supportEscalate;

  /// No description provided for @supportCaseEscalated.
  ///
  /// In en, this message translates to:
  /// **'Case escalated.'**
  String get supportCaseEscalated;

  /// No description provided for @supportEvidenceRequest.
  ///
  /// In en, this message translates to:
  /// **'Evidence request'**
  String get supportEvidenceRequest;

  /// No description provided for @supportSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get supportSendRequest;

  /// No description provided for @supportSendingRequest.
  ///
  /// In en, this message translates to:
  /// **'Sending request...'**
  String get supportSendingRequest;

  /// No description provided for @supportEvidenceRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Evidence request sent.'**
  String get supportEvidenceRequestSent;

  /// No description provided for @supportResolutionNote.
  ///
  /// In en, this message translates to:
  /// **'Resolution note'**
  String get supportResolutionNote;

  /// No description provided for @supportCaseResolved.
  ///
  /// In en, this message translates to:
  /// **'Case resolved.'**
  String get supportCaseResolved;

  /// No description provided for @supportReopenReason.
  ///
  /// In en, this message translates to:
  /// **'Reopen reason'**
  String get supportReopenReason;

  /// No description provided for @supportCaseReopened.
  ///
  /// In en, this message translates to:
  /// **'Case reopened.'**
  String get supportCaseReopened;

  /// No description provided for @supportCaseAssigned.
  ///
  /// In en, this message translates to:
  /// **'Case assigned.'**
  String get supportCaseAssigned;

  /// No description provided for @supportInternalNote.
  ///
  /// In en, this message translates to:
  /// **'Internal note'**
  String get supportInternalNote;

  /// No description provided for @supportSaveNote.
  ///
  /// In en, this message translates to:
  /// **'Save note'**
  String get supportSaveNote;

  /// No description provided for @supportInternalNoteSaved.
  ///
  /// In en, this message translates to:
  /// **'Internal note saved.'**
  String get supportInternalNoteSaved;

  /// No description provided for @supportMessage.
  ///
  /// In en, this message translates to:
  /// **'Message'**
  String get supportMessage;

  /// No description provided for @supportMessageHint.
  ///
  /// In en, this message translates to:
  /// **'Write a message...'**
  String get supportMessageHint;

  /// No description provided for @supportSendMessage.
  ///
  /// In en, this message translates to:
  /// **'Send message'**
  String get supportSendMessage;

  /// No description provided for @supportNoMessages.
  ///
  /// In en, this message translates to:
  /// **'No messages yet'**
  String get supportNoMessages;

  /// No description provided for @supportNoMessagesDesc.
  ///
  /// In en, this message translates to:
  /// **'Send the first message to start this support thread.'**
  String get supportNoMessagesDesc;

  /// No description provided for @supportNoInternalNotes.
  ///
  /// In en, this message translates to:
  /// **'No internal notes'**
  String get supportNoInternalNotes;

  /// No description provided for @supportNoInternalNotesDesc.
  ///
  /// In en, this message translates to:
  /// **'Admin notes for this case will appear here.'**
  String get supportNoInternalNotesDesc;

  /// No description provided for @supportUnassigned.
  ///
  /// In en, this message translates to:
  /// **'Unassigned'**
  String get supportUnassigned;

  /// No description provided for @supportResolvedComposerDisabled.
  ///
  /// In en, this message translates to:
  /// **'This case is resolved. Reopen it to send another message.'**
  String get supportResolvedComposerDisabled;

  /// No description provided for @supportSystemMessage.
  ///
  /// In en, this message translates to:
  /// **'System update'**
  String get supportSystemMessage;

  /// No description provided for @supportDeletedMessage.
  ///
  /// In en, this message translates to:
  /// **'This message was deleted'**
  String get supportDeletedMessage;

  /// No description provided for @supportAttachment.
  ///
  /// In en, this message translates to:
  /// **'Attachment'**
  String get supportAttachment;

  /// No description provided for @supportAddEvidence.
  ///
  /// In en, this message translates to:
  /// **'Add evidence'**
  String get supportAddEvidence;

  /// No description provided for @supportUploadImageEvidence.
  ///
  /// In en, this message translates to:
  /// **'Upload image evidence'**
  String get supportUploadImageEvidence;

  /// No description provided for @supportAddFileMetadata.
  ///
  /// In en, this message translates to:
  /// **'Add file metadata'**
  String get supportAddFileMetadata;

  /// No description provided for @supportAddVoiceMetadata.
  ///
  /// In en, this message translates to:
  /// **'Add voice metadata'**
  String get supportAddVoiceMetadata;

  /// No description provided for @supportImageAttachment.
  ///
  /// In en, this message translates to:
  /// **'Image attachment'**
  String get supportImageAttachment;

  /// No description provided for @supportVoiceAttachment.
  ///
  /// In en, this message translates to:
  /// **'Voice message'**
  String get supportVoiceAttachment;

  /// No description provided for @supportFileAttachment.
  ///
  /// In en, this message translates to:
  /// **'File attachment'**
  String get supportFileAttachment;

  /// No description provided for @supportVideoAttachment.
  ///
  /// In en, this message translates to:
  /// **'Video attachment'**
  String get supportVideoAttachment;

  /// No description provided for @supportOpenAttachment.
  ///
  /// In en, this message translates to:
  /// **'Open attachment'**
  String get supportOpenAttachment;

  /// No description provided for @supportVoiceDuration.
  ///
  /// In en, this message translates to:
  /// **'Voice {duration}'**
  String supportVoiceDuration(Object duration);

  /// No description provided for @supportAttachmentSize.
  ///
  /// In en, this message translates to:
  /// **'{size}'**
  String supportAttachmentSize(Object size);

  /// No description provided for @supportFileName.
  ///
  /// In en, this message translates to:
  /// **'File name'**
  String get supportFileName;

  /// No description provided for @supportFileUrl.
  ///
  /// In en, this message translates to:
  /// **'File URL'**
  String get supportFileUrl;

  /// No description provided for @supportDurationSeconds.
  ///
  /// In en, this message translates to:
  /// **'Duration in seconds'**
  String get supportDurationSeconds;

  /// No description provided for @supportSizeBytes.
  ///
  /// In en, this message translates to:
  /// **'Size in bytes'**
  String get supportSizeBytes;

  /// No description provided for @supportFileReadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not read that file. Please try again.'**
  String get supportFileReadFailed;

  /// No description provided for @supportUnsupportedAttachmentType.
  ///
  /// In en, this message translates to:
  /// **'Choose a PDF, text, Word, or DOCX file.'**
  String get supportUnsupportedAttachmentType;

  /// No description provided for @supportImageTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Choose an image smaller than 10 MB.'**
  String get supportImageTooLarge;

  /// No description provided for @supportVideoTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Choose a video smaller than 50 MB.'**
  String get supportVideoTooLarge;

  /// No description provided for @supportDocumentTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Choose a document smaller than 25 MB.'**
  String get supportDocumentTooLarge;

  /// No description provided for @supportVoiceTooLarge.
  ///
  /// In en, this message translates to:
  /// **'Choose an audio file smaller than 10 MB.'**
  String get supportVoiceTooLarge;

  /// No description provided for @supportAttach.
  ///
  /// In en, this message translates to:
  /// **'Attach'**
  String get supportAttach;

  /// No description provided for @supportAttaching.
  ///
  /// In en, this message translates to:
  /// **'Attaching...'**
  String get supportAttaching;

  /// No description provided for @supportPurchaseCaseSubject.
  ///
  /// In en, this message translates to:
  /// **'Support for {carTitle}'**
  String supportPurchaseCaseSubject(Object carTitle);

  /// No description provided for @supportSharedBarrelCaseSubject.
  ///
  /// In en, this message translates to:
  /// **'Shared barrel support'**
  String get supportSharedBarrelCaseSubject;

  /// No description provided for @supportPlatformSenderName.
  ///
  /// In en, this message translates to:
  /// **'Laawol support'**
  String get supportPlatformSenderName;

  /// No description provided for @supportBusinessSenderName.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get supportBusinessSenderName;

  /// No description provided for @parkingStepWhereWhen.
  ///
  /// In en, this message translates to:
  /// **'Where & when'**
  String get parkingStepWhereWhen;

  /// No description provided for @parkingStepChooseSpot.
  ///
  /// In en, this message translates to:
  /// **'Choose a spot'**
  String get parkingStepChooseSpot;

  /// No description provided for @parkingStepYourCar.
  ///
  /// In en, this message translates to:
  /// **'Your car'**
  String get parkingStepYourCar;

  /// No description provided for @parkingStepReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get parkingStepReview;

  /// No description provided for @parkingStepIndicator.
  ///
  /// In en, this message translates to:
  /// **'Step {current} of {total}'**
  String parkingStepIndicator(Object current, Object total);

  /// No description provided for @parkingContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get parkingContinue;

  /// No description provided for @parkingBack.
  ///
  /// In en, this message translates to:
  /// **'Back'**
  String get parkingBack;

  /// No description provided for @parkingReviewHeading.
  ///
  /// In en, this message translates to:
  /// **'Review & reserve'**
  String get parkingReviewHeading;

  /// No description provided for @parkingReviewVehicle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle'**
  String get parkingReviewVehicle;

  /// No description provided for @parkingReviewDates.
  ///
  /// In en, this message translates to:
  /// **'Dates'**
  String get parkingReviewDates;

  /// No description provided for @parkingReviewPickupYes.
  ///
  /// In en, this message translates to:
  /// **'Pickup requested'**
  String get parkingReviewPickupYes;

  /// No description provided for @parkingReviewPickupNo.
  ///
  /// In en, this message translates to:
  /// **'No pickup'**
  String get parkingReviewPickupNo;

  /// No description provided for @hubGuestName.
  ///
  /// In en, this message translates to:
  /// **'there'**
  String get hubGuestName;

  /// No description provided for @hubQuickActions.
  ///
  /// In en, this message translates to:
  /// **'Quick actions'**
  String get hubQuickActions;

  /// No description provided for @hubSendBarrel.
  ///
  /// In en, this message translates to:
  /// **'Send a barrel'**
  String get hubSendBarrel;

  /// No description provided for @hubShipFullBarrel.
  ///
  /// In en, this message translates to:
  /// **'Ship a full barrel home'**
  String get hubShipFullBarrel;

  /// No description provided for @hubBrowseCars.
  ///
  /// In en, this message translates to:
  /// **'Browse cars'**
  String get hubBrowseCars;

  /// No description provided for @hubBuyVerifiedCar.
  ///
  /// In en, this message translates to:
  /// **'Buy a verified car'**
  String get hubBuyVerifiedCar;

  /// No description provided for @hubFollowShipments.
  ///
  /// In en, this message translates to:
  /// **'Follow your shipments'**
  String get hubFollowShipments;

  /// No description provided for @navShip.
  ///
  /// In en, this message translates to:
  /// **'Ship'**
  String get navShip;

  /// No description provided for @shipSheetTitle.
  ///
  /// In en, this message translates to:
  /// **'What are you sending?'**
  String get shipSheetTitle;

  /// No description provided for @shipSheetSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Pick what’s going home and we’ll take it from there.'**
  String get shipSheetSubtitle;

  /// No description provided for @hubShipping.
  ///
  /// In en, this message translates to:
  /// **'Shipping'**
  String get hubShipping;

  /// No description provided for @hubShippingSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Send barrels, freight, and cars home.'**
  String get hubShippingSubtitle;

  /// No description provided for @hubSharedBarrels.
  ///
  /// In en, this message translates to:
  /// **'Shared barrels'**
  String get hubSharedBarrels;

  /// No description provided for @hubSharedBarrelsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Post or join a barrel'**
  String get hubSharedBarrelsSubtitle;

  /// No description provided for @hubFreightSubtitle.
  ///
  /// In en, this message translates to:
  /// **'By weight · air or sea'**
  String get hubFreightSubtitle;

  /// No description provided for @hubTransportCar.
  ///
  /// In en, this message translates to:
  /// **'Transport a car'**
  String get hubTransportCar;

  /// No description provided for @hubShipCarHome.
  ///
  /// In en, this message translates to:
  /// **'Ship a car home'**
  String get hubShipCarHome;

  /// No description provided for @hubCarsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Buy a verified car or store one with a business.'**
  String get hubCarsSubtitle;

  /// No description provided for @hubParkCarSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Store with a business'**
  String get hubParkCarSubtitle;

  /// No description provided for @homeHeroTitle.
  ///
  /// In en, this message translates to:
  /// **'Send something home'**
  String get homeHeroTitle;

  /// No description provided for @homeHeroSubtitle.
  ///
  /// In en, this message translates to:
  /// **'A barrel, freight, or a car. Pick what\'s going and we\'ll take it from there.'**
  String get homeHeroSubtitle;

  /// No description provided for @homeHeroCta.
  ///
  /// In en, this message translates to:
  /// **'Start a shipment'**
  String get homeHeroCta;

  /// No description provided for @homeHelpTitle.
  ///
  /// In en, this message translates to:
  /// **'Need a hand?'**
  String get homeHelpTitle;

  /// No description provided for @homeHelpSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Message the Laawol team'**
  String get homeHelpSubtitle;

  /// No description provided for @homeSignInSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Track your orders and shipments'**
  String get homeSignInSubtitle;

  /// No description provided for @hubActivitySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your orders, shipments, and wallet.'**
  String get hubActivitySubtitle;

  /// No description provided for @hubOrdersSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Cars, barrels, freight & more'**
  String get hubOrdersSubtitle;

  /// No description provided for @hubWalletSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Balance & refunds'**
  String get hubWalletSubtitle;

  /// No description provided for @destinationPickupDetailsRequired.
  ///
  /// In en, this message translates to:
  /// **'Edit each destination and add its pickup address, date, and time.'**
  String get destinationPickupDetailsRequired;

  /// No description provided for @destinationPickupDetailsHelp.
  ///
  /// In en, this message translates to:
  /// **'Edit each destination with its pickup place and date.'**
  String get destinationPickupDetailsHelp;

  /// No description provided for @noShowHistory.
  ///
  /// In en, this message translates to:
  /// **'No-show history'**
  String get noShowHistory;

  /// No description provided for @noShowHistoryMessage.
  ///
  /// In en, this message translates to:
  /// **'If you do not return by the hold date and the business marks that you did not come, the deposit may be forfeited and this outcome may be visible to car-selling businesses.'**
  String get noShowHistoryMessage;

  /// No description provided for @holdUntil.
  ///
  /// In en, this message translates to:
  /// **'Hold until'**
  String get holdUntil;

  /// No description provided for @marketplaceResponsibilityTitle.
  ///
  /// In en, this message translates to:
  /// **'Understand who provides this service'**
  String get marketplaceResponsibilityTitle;

  /// No description provided for @marketplaceProviderResponsibilityBody.
  ///
  /// In en, this message translates to:
  /// **'{providerNames} is an independent business responsible for the item or service, including fulfillment, condition, delivery timing, and performance.'**
  String marketplaceProviderResponsibilityBody(Object providerNames);

  /// No description provided for @marketplacePaymentFlowBody.
  ///
  /// In en, this message translates to:
  /// **'Laawol helps you find businesses, collects and processes your payment, may deduct a disclosed platform fee, and may transfer the business payout later. Laawol can assist with tracking, support, refunds, and disputes.'**
  String get marketplacePaymentFlowBody;

  /// No description provided for @marketplaceNoGuaranteeBody.
  ///
  /// In en, this message translates to:
  /// **'Laawol is not the seller, carrier, or service provider and does not guarantee the business’s delivery date or performance. This does not limit rights that cannot legally be waived.'**
  String get marketplaceNoGuaranteeBody;

  /// No description provided for @freightAutoChargeDisclosureBody.
  ///
  /// In en, this message translates to:
  /// **'The weight you enter is an estimate. If the business confirms a different weight after pickup, Laawol will try to automatically charge the card you use today for any additional amount due. If that charge doesn’t go through, you’ll need to open the app to complete payment before your shipment can continue. If your shipment weighs less, you’ll be refunded automatically.'**
  String get freightAutoChargeDisclosureBody;

  /// No description provided for @marketplaceResponsibilityCheckbox.
  ///
  /// In en, this message translates to:
  /// **'I understand the business’s responsibility and want to continue.'**
  String get marketplaceResponsibilityCheckbox;

  /// No description provided for @selectedBusiness.
  ///
  /// In en, this message translates to:
  /// **'The selected business'**
  String get selectedBusiness;

  /// No description provided for @accountLegalAcceptance.
  ///
  /// In en, this message translates to:
  /// **'I agree to Laawol’s Terms of Service and Privacy Policy, including its marketplace role.'**
  String get accountLegalAcceptance;

  /// No description provided for @accountLegalAcceptanceRequired.
  ///
  /// In en, this message translates to:
  /// **'Please accept the Terms of Service and Privacy Policy to continue.'**
  String get accountLegalAcceptanceRequired;

  /// No description provided for @businessResponsibilityAcceptance.
  ///
  /// In en, this message translates to:
  /// **'I understand that my business is independently responsible for its listings, prices, goods, services, fulfillment, delivery timing, permits, and customer obligations.'**
  String get businessResponsibilityAcceptance;

  /// No description provided for @businessResponsibilityRequired.
  ///
  /// In en, this message translates to:
  /// **'Confirm the business responsibility statement to submit your application.'**
  String get businessResponsibilityRequired;

  /// No description provided for @verifyPhoneToContinueTitle.
  ///
  /// In en, this message translates to:
  /// **'Verify your phone to continue'**
  String get verifyPhoneToContinueTitle;

  /// No description provided for @verifyPhoneToContinueBody.
  ///
  /// In en, this message translates to:
  /// **'Shared barrels are available only to customers with a verified phone number. We’ll send a code to the number in your account.'**
  String get verifyPhoneToContinueBody;

  /// No description provided for @verifyPhone.
  ///
  /// In en, this message translates to:
  /// **'Verify phone'**
  String get verifyPhone;

  /// No description provided for @notNow.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get notNow;

  /// No description provided for @phoneVerificationTitle.
  ///
  /// In en, this message translates to:
  /// **'Phone verification'**
  String get phoneVerificationTitle;

  /// No description provided for @phoneVerificationExplanation.
  ///
  /// In en, this message translates to:
  /// **'Confirm or update the mobile number for your account. We’ll text you a one-time verification code.'**
  String get phoneVerificationExplanation;

  /// No description provided for @phoneVerificationCountryCodeHelp.
  ///
  /// In en, this message translates to:
  /// **'Choose the country code, then enter the mobile number.'**
  String get phoneVerificationCountryCodeHelp;

  /// No description provided for @phoneVerificationCodeSentTitle.
  ///
  /// In en, this message translates to:
  /// **'Code sent'**
  String get phoneVerificationCodeSentTitle;

  /// No description provided for @phoneVerificationCodeSent.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code sent to {phone}.'**
  String phoneVerificationCodeSent(Object phone);

  /// No description provided for @phoneVerificationCode.
  ///
  /// In en, this message translates to:
  /// **'Verification code'**
  String get phoneVerificationCode;

  /// No description provided for @phoneVerificationSendCode.
  ///
  /// In en, this message translates to:
  /// **'Send verification code'**
  String get phoneVerificationSendCode;

  /// No description provided for @phoneVerificationSendingCode.
  ///
  /// In en, this message translates to:
  /// **'Sending code...'**
  String get phoneVerificationSendingCode;

  /// No description provided for @phoneVerificationVerifying.
  ///
  /// In en, this message translates to:
  /// **'Verifying...'**
  String get phoneVerificationVerifying;

  /// No description provided for @phoneVerificationResending.
  ///
  /// In en, this message translates to:
  /// **'Resending...'**
  String get phoneVerificationResending;

  /// No description provided for @phoneVerificationResent.
  ///
  /// In en, this message translates to:
  /// **'A new code was sent.'**
  String get phoneVerificationResent;

  /// No description provided for @phoneVerificationResend.
  ///
  /// In en, this message translates to:
  /// **'Resend code'**
  String get phoneVerificationResend;

  /// No description provided for @phoneVerificationResendIn.
  ///
  /// In en, this message translates to:
  /// **'Resend code in {seconds}s'**
  String phoneVerificationResendIn(int seconds);

  /// No description provided for @phoneVerificationChangeNumber.
  ///
  /// In en, this message translates to:
  /// **'Change number'**
  String get phoneVerificationChangeNumber;

  /// No description provided for @phoneVerificationSmsNotice.
  ///
  /// In en, this message translates to:
  /// **'Standard SMS and data rates may apply. The code is used only to verify that this phone belongs to you.'**
  String get phoneVerificationSmsNotice;

  /// No description provided for @phoneVerificationInvalidPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid international phone number beginning with + and the country code.'**
  String get phoneVerificationInvalidPhone;

  /// No description provided for @phoneVerificationEnterCode.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code.'**
  String get phoneVerificationEnterCode;

  /// No description provided for @phoneVerificationInvalidCode.
  ///
  /// In en, this message translates to:
  /// **'That code is incorrect. Check it and try again.'**
  String get phoneVerificationInvalidCode;

  /// No description provided for @phoneVerificationExpiredCode.
  ///
  /// In en, this message translates to:
  /// **'That code expired. Request a new code and try again.'**
  String get phoneVerificationExpiredCode;

  /// No description provided for @phoneVerificationTooManyAttempts.
  ///
  /// In en, this message translates to:
  /// **'Too many verification attempts. Please wait and try again later.'**
  String get phoneVerificationTooManyAttempts;

  /// No description provided for @phoneVerificationNetworkError.
  ///
  /// In en, this message translates to:
  /// **'Check your connection and try again.'**
  String get phoneVerificationNetworkError;

  /// No description provided for @phoneVerificationRequestTimedOut.
  ///
  /// In en, this message translates to:
  /// **'We didn’t receive a response. Check your connection and try again.'**
  String get phoneVerificationRequestTimedOut;

  /// No description provided for @phoneVerificationPhoneInUse.
  ///
  /// In en, this message translates to:
  /// **'That phone number is already linked to another account.'**
  String get phoneVerificationPhoneInUse;

  /// No description provided for @phoneVerificationRecentLogin.
  ///
  /// In en, this message translates to:
  /// **'For security, sign out, sign back in, and verify your phone again.'**
  String get phoneVerificationRecentLogin;

  /// No description provided for @phoneVerificationAppCheck.
  ///
  /// In en, this message translates to:
  /// **'App security check failed. Register this debug device in Firebase App Check, then reopen the app.'**
  String get phoneVerificationAppCheck;

  /// No description provided for @phoneVerificationGenericError.
  ///
  /// In en, this message translates to:
  /// **'We couldn’t verify your phone. Please try again.'**
  String get phoneVerificationGenericError;

  /// No description provided for @phoneVerificationSyncPending.
  ///
  /// In en, this message translates to:
  /// **'Your code was accepted, but we couldn’t finish updating your profile. Try finishing verification again—another SMS is not required.'**
  String get phoneVerificationSyncPending;

  /// No description provided for @phoneVerificationFinish.
  ///
  /// In en, this message translates to:
  /// **'Finish verification'**
  String get phoneVerificationFinish;

  /// No description provided for @phoneVerificationFinishing.
  ///
  /// In en, this message translates to:
  /// **'Finishing verification...'**
  String get phoneVerificationFinishing;

  /// No description provided for @phoneVerificationSavePhoneFirst.
  ///
  /// In en, this message translates to:
  /// **'Save this phone number before verifying it.'**
  String get phoneVerificationSavePhoneFirst;

  /// No description provided for @phoneVerificationSaveAndVerify.
  ///
  /// In en, this message translates to:
  /// **'Save and verify'**
  String get phoneVerificationSaveAndVerify;

  /// No description provided for @phoneVerificationSavingNumber.
  ///
  /// In en, this message translates to:
  /// **'Saving number...'**
  String get phoneVerificationSavingNumber;

  /// No description provided for @phoneVerificationEditedStatus.
  ///
  /// In en, this message translates to:
  /// **'This number has not been saved or verified.'**
  String get phoneVerificationEditedStatus;

  /// No description provided for @phoneVerificationUnverifiedHelp.
  ///
  /// In en, this message translates to:
  /// **'Verify this number to use protected account features.'**
  String get phoneVerificationUnverifiedHelp;

  /// No description provided for @phoneVerificationVerifiedHelp.
  ///
  /// In en, this message translates to:
  /// **'This number matches the phone securely verified on your account.'**
  String get phoneVerificationVerifiedHelp;

  /// No description provided for @phoneVerificationSuccess.
  ///
  /// In en, this message translates to:
  /// **'Your phone number is verified.'**
  String get phoneVerificationSuccess;

  /// No description provided for @phoneVerificationSuccessTitle.
  ///
  /// In en, this message translates to:
  /// **'Phone verified'**
  String get phoneVerificationSuccessTitle;

  /// No description provided for @phoneVerificationReturnToSharedBarrels.
  ///
  /// In en, this message translates to:
  /// **'Return to shared barrels'**
  String get phoneVerificationReturnToSharedBarrels;

  /// No description provided for @phoneVerificationVerified.
  ///
  /// In en, this message translates to:
  /// **'Phone verified'**
  String get phoneVerificationVerified;

  /// No description provided for @phoneVerificationNotVerified.
  ///
  /// In en, this message translates to:
  /// **'Phone not verified'**
  String get phoneVerificationNotVerified;

  /// No description provided for @phoneCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Country code'**
  String get phoneCountryCode;

  /// No description provided for @selectCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Select country code'**
  String get selectCountryCode;

  /// No description provided for @phoneCountrySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search country or code'**
  String get phoneCountrySearchHint;

  /// No description provided for @noCountryCodesFound.
  ///
  /// In en, this message translates to:
  /// **'No country codes found'**
  String get noCountryCodesFound;

  /// No description provided for @sharedBarrelActionFailed.
  ///
  /// In en, this message translates to:
  /// **'We couldn’t complete that shared-barrel action. Please try again.'**
  String get sharedBarrelActionFailed;

  /// No description provided for @sharedBarrelsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Check your connection and try again. Your information is safe.'**
  String get sharedBarrelsLoadFailed;

  /// No description provided for @sharedBarrelFormLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'We couldn’t open the shared-barrel form. Check your connection and try again.'**
  String get sharedBarrelFormLoadFailed;

  /// No description provided for @marketplaceBalancePaymentSummary.
  ///
  /// In en, this message translates to:
  /// **'Balance payment'**
  String get marketplaceBalancePaymentSummary;

  /// No description provided for @marketplaceDestinationChangeSummary.
  ///
  /// In en, this message translates to:
  /// **'Paid destination change'**
  String get marketplaceDestinationChangeSummary;

  /// No description provided for @pickupBusinessUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This business does not offer home pickup yet. Choose office drop-off or another provider.'**
  String get pickupBusinessUnavailable;

  /// No description provided for @pickupAddressQuoteFailed.
  ///
  /// In en, this message translates to:
  /// **'Pickup is not available for this address. Check the address or choose office drop-off.'**
  String get pickupAddressQuoteFailed;

  /// No description provided for @pickupPlanSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Home pickup'**
  String get pickupPlanSectionTitle;

  /// No description provided for @pickupPlanSectionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Collecting items from the customer\'s address instead of them bringing it to you. Each service either follows your shared plan or sets its own.'**
  String get pickupPlanSectionSubtitle;

  /// No description provided for @pickupPlanOfferToggle.
  ///
  /// In en, this message translates to:
  /// **'Use one shared plan'**
  String get pickupPlanOfferToggle;

  /// No description provided for @pickupPlanDisabledHint.
  ///
  /// In en, this message translates to:
  /// **'Services set to “follow the shared plan” below are priced by these settings.'**
  String get pickupPlanDisabledHint;

  /// No description provided for @pickupPlanModeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pricing mode'**
  String get pickupPlanModeLabel;

  /// No description provided for @pickupPlanModeFlat.
  ///
  /// In en, this message translates to:
  /// **'Flat fee'**
  String get pickupPlanModeFlat;

  /// No description provided for @pickupPlanModeDistance.
  ///
  /// In en, this message translates to:
  /// **'By distance'**
  String get pickupPlanModeDistance;

  /// No description provided for @pickupPlanModeBorough.
  ///
  /// In en, this message translates to:
  /// **'By borough (NYC)'**
  String get pickupPlanModeBorough;

  /// No description provided for @pickupPlanMaxMiles.
  ///
  /// In en, this message translates to:
  /// **'Max pickup distance (miles)'**
  String get pickupPlanMaxMiles;

  /// No description provided for @pickupPlanFlatHint.
  ///
  /// In en, this message translates to:
  /// **'One price for any pickup within your maximum distance. Addresses beyond it are refused, never surcharged.'**
  String get pickupPlanFlatHint;

  /// No description provided for @pickupPlanFlatFee.
  ///
  /// In en, this message translates to:
  /// **'Flat pickup fee (USD)'**
  String get pickupPlanFlatFee;

  /// No description provided for @pickupPlanDistanceHint.
  ///
  /// In en, this message translates to:
  /// **'Fee = base fee + per-mile rate × driving distance, never below your minimum. Addresses beyond your maximum distance are refused.'**
  String get pickupPlanDistanceHint;

  /// No description provided for @pickupPlanOriginAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup origin address'**
  String get pickupPlanOriginAddress;

  /// No description provided for @pickupPlanOriginHelper.
  ///
  /// In en, this message translates to:
  /// **'Where your pickups start from'**
  String get pickupPlanOriginHelper;

  /// No description provided for @pickupPlanBaseFee.
  ///
  /// In en, this message translates to:
  /// **'Base fee (USD)'**
  String get pickupPlanBaseFee;

  /// No description provided for @pickupPlanPerMile.
  ///
  /// In en, this message translates to:
  /// **'Per mile (USD)'**
  String get pickupPlanPerMile;

  /// No description provided for @pickupPlanMinFee.
  ///
  /// In en, this message translates to:
  /// **'Minimum fee (USD)'**
  String get pickupPlanMinFee;

  /// No description provided for @pickupPlanBoroughHint.
  ///
  /// In en, this message translates to:
  /// **'One flat fee per borough you serve. Leave a borough blank to not serve it — the customer\'s address decides which fee applies.'**
  String get pickupPlanBoroughHint;

  /// No description provided for @pickupPlanPerServiceHint.
  ///
  /// In en, this message translates to:
  /// **'Each service, one at a time'**
  String get pickupPlanPerServiceHint;

  /// No description provided for @pickupPlanChoiceInherit.
  ///
  /// In en, this message translates to:
  /// **'Follow the shared plan'**
  String get pickupPlanChoiceInherit;

  /// No description provided for @pickupPlanChoiceCustom.
  ///
  /// In en, this message translates to:
  /// **'Set its own pickup fees'**
  String get pickupPlanChoiceCustom;

  /// No description provided for @pickupPlanChoiceOff.
  ///
  /// In en, this message translates to:
  /// **'No pickup for this service'**
  String get pickupPlanChoiceOff;

  /// No description provided for @pickupPlanSharedSectionLabel.
  ///
  /// In en, this message translates to:
  /// **'the shared pickup plan'**
  String get pickupPlanSharedSectionLabel;

  /// No description provided for @pickupPlanServiceBarrels.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipping'**
  String get pickupPlanServiceBarrels;

  /// No description provided for @pickupPlanServiceFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get pickupPlanServiceFreight;

  /// No description provided for @pickupPlanServiceParking.
  ///
  /// In en, this message translates to:
  /// **'Car parking'**
  String get pickupPlanServiceParking;

  /// No description provided for @pickupPlanServiceCarTransport.
  ///
  /// In en, this message translates to:
  /// **'Car transport'**
  String get pickupPlanServiceCarTransport;

  /// No description provided for @pickupPlanErrorCapRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the maximum pickup distance in miles for {section}.'**
  String pickupPlanErrorCapRequired(Object section);

  /// No description provided for @pickupPlanErrorFlatFee.
  ///
  /// In en, this message translates to:
  /// **'Enter the flat pickup fee for {section}.'**
  String pickupPlanErrorFlatFee(Object section);

  /// No description provided for @pickupPlanErrorDistanceFees.
  ///
  /// In en, this message translates to:
  /// **'Enter the base, per-mile, and minimum fees for {section}.'**
  String pickupPlanErrorDistanceFees(Object section);

  /// No description provided for @pickupPlanErrorOrigin.
  ///
  /// In en, this message translates to:
  /// **'Enter the pickup origin address for {section}.'**
  String pickupPlanErrorOrigin(Object section);

  /// No description provided for @pickupPlanErrorBoroughPrice.
  ///
  /// In en, this message translates to:
  /// **'Set a pickup fee for at least one borough for {section}.'**
  String pickupPlanErrorBoroughPrice(Object section);

  /// No description provided for @pickupPlanErrorBoroughRequiresNewYork.
  ///
  /// In en, this message translates to:
  /// **'Pickup by borough is only available to New York businesses ({section}).'**
  String pickupPlanErrorBoroughRequiresNewYork(Object section);

  /// No description provided for @freightPickupSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Freight pickup'**
  String get freightPickupSectionTitle;

  /// No description provided for @freightPickupSectionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Offer to collect parcels from your customer\'s address, and choose how the fee is calculated.'**
  String get freightPickupSectionSubtitle;

  /// No description provided for @freightPickupOfferToggle.
  ///
  /// In en, this message translates to:
  /// **'Offer freight pickup'**
  String get freightPickupOfferToggle;

  /// No description provided for @freightPickupModelDistance.
  ///
  /// In en, this message translates to:
  /// **'By distance'**
  String get freightPickupModelDistance;

  /// No description provided for @freightPickupModelBorough.
  ///
  /// In en, this message translates to:
  /// **'By borough'**
  String get freightPickupModelBorough;

  /// No description provided for @freightPickupDistanceHint.
  ///
  /// In en, this message translates to:
  /// **'Fee = base fee + per-km rate × driving distance from your address. Leave rates at 0 to offer free pickup.'**
  String get freightPickupDistanceHint;

  /// No description provided for @freightPickupOriginAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup origin address'**
  String get freightPickupOriginAddress;

  /// No description provided for @freightPickupOriginAddressHelper.
  ///
  /// In en, this message translates to:
  /// **'Where your drivers start from. Defaults to your business address.'**
  String get freightPickupOriginAddressHelper;

  /// No description provided for @freightPickupBaseFee.
  ///
  /// In en, this message translates to:
  /// **'Base fee'**
  String get freightPickupBaseFee;

  /// No description provided for @freightPickupPerKm.
  ///
  /// In en, this message translates to:
  /// **'Per km'**
  String get freightPickupPerKm;

  /// No description provided for @freightPickupMinFee.
  ///
  /// In en, this message translates to:
  /// **'Minimum fee'**
  String get freightPickupMinFee;

  /// No description provided for @freightPickupMaxKm.
  ///
  /// In en, this message translates to:
  /// **'Max distance (km)'**
  String get freightPickupMaxKm;

  /// No description provided for @freightPickupBoroughHint.
  ///
  /// In en, this message translates to:
  /// **'Set a flat pickup fee for each New York City borough you serve. Leave blank for boroughs you don\'t cover.'**
  String get freightPickupBoroughHint;

  /// No description provided for @freightPickupBoroughPriceRequired.
  ///
  /// In en, this message translates to:
  /// **'Set a pickup fee for at least one borough, or turn off freight pickup.'**
  String get freightPickupBoroughPriceRequired;

  /// No description provided for @freightPickupCustomerToggle.
  ///
  /// In en, this message translates to:
  /// **'Pick up from my address'**
  String get freightPickupCustomerToggle;

  /// No description provided for @freightPickupAddressLabel.
  ///
  /// In en, this message translates to:
  /// **'Pickup address'**
  String get freightPickupAddressLabel;

  /// No description provided for @freightPickupBoroughLabel.
  ///
  /// In en, this message translates to:
  /// **'Borough'**
  String get freightPickupBoroughLabel;

  /// No description provided for @freightPickupDateTimeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pickup date & time'**
  String get freightPickupDateTimeLabel;

  /// No description provided for @freightPickupChooseDateTime.
  ///
  /// In en, this message translates to:
  /// **'Choose date & time'**
  String get freightPickupChooseDateTime;

  /// No description provided for @freightPickupFeeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pickup fee'**
  String get freightPickupFeeLabel;

  /// No description provided for @freightPickupCalculating.
  ///
  /// In en, this message translates to:
  /// **'Calculating pickup fee…'**
  String get freightPickupCalculating;

  /// No description provided for @freightPickupEnterDetailsForFee.
  ///
  /// In en, this message translates to:
  /// **'Enter your pickup details to see the fee.'**
  String get freightPickupEnterDetailsForFee;

  /// No description provided for @freightPickupSelectDateTime.
  ///
  /// In en, this message translates to:
  /// **'Please choose a pickup date and time.'**
  String get freightPickupSelectDateTime;

  /// No description provided for @freightPickupUnavailableCustomer.
  ///
  /// In en, this message translates to:
  /// **'This business doesn\'t offer pickup right now.'**
  String get freightPickupUnavailableCustomer;

  /// No description provided for @freightPickupOutOfRangeCustomer.
  ///
  /// In en, this message translates to:
  /// **'Your address is outside this business\'s pickup area.'**
  String get freightPickupOutOfRangeCustomer;

  /// No description provided for @freightPickupQuoteFailed.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t calculate the pickup fee. Check the address and try again.'**
  String get freightPickupQuoteFailed;

  /// No description provided for @freightPickupDistanceAway.
  ///
  /// In en, this message translates to:
  /// **'{distanceKm} km away'**
  String freightPickupDistanceAway(String distanceKm);

  /// No description provided for @freightPickupFreeLabel.
  ///
  /// In en, this message translates to:
  /// **'Free pickup'**
  String get freightPickupFreeLabel;

  /// No description provided for @freightAirDepartureDays.
  ///
  /// In en, this message translates to:
  /// **'Air freight departure days'**
  String get freightAirDepartureDays;

  /// No description provided for @freightSeaDepartureDays.
  ///
  /// In en, this message translates to:
  /// **'Sea freight departure days'**
  String get freightSeaDepartureDays;

  /// No description provided for @freightDepartureDaysHelper.
  ///
  /// In en, this message translates to:
  /// **'Optional. Choose the regular days this service departs.'**
  String get freightDepartureDaysHelper;

  /// No description provided for @mondayShort.
  ///
  /// In en, this message translates to:
  /// **'Mon'**
  String get mondayShort;

  /// No description provided for @tuesdayShort.
  ///
  /// In en, this message translates to:
  /// **'Tue'**
  String get tuesdayShort;

  /// No description provided for @wednesdayShort.
  ///
  /// In en, this message translates to:
  /// **'Wed'**
  String get wednesdayShort;

  /// No description provided for @thursdayShort.
  ///
  /// In en, this message translates to:
  /// **'Thu'**
  String get thursdayShort;

  /// No description provided for @fridayShort.
  ///
  /// In en, this message translates to:
  /// **'Fri'**
  String get fridayShort;

  /// No description provided for @saturdayShort.
  ///
  /// In en, this message translates to:
  /// **'Sat'**
  String get saturdayShort;

  /// No description provided for @sundayShort.
  ///
  /// In en, this message translates to:
  /// **'Sun'**
  String get sundayShort;

  /// No description provided for @regularDepartureDays.
  ///
  /// In en, this message translates to:
  /// **'Regular departures: {days}'**
  String regularDepartureDays(String days);

  /// No description provided for @allPeople.
  ///
  /// In en, this message translates to:
  /// **'All people'**
  String get allPeople;

  /// No description provided for @platformAdministrators.
  ///
  /// In en, this message translates to:
  /// **'Platform administrators'**
  String get platformAdministrators;

  /// No description provided for @businessOwners.
  ///
  /// In en, this message translates to:
  /// **'Business owners'**
  String get businessOwners;

  /// No description provided for @pendingInvitations.
  ///
  /// In en, this message translates to:
  /// **'Pending invitations'**
  String get pendingInvitations;

  /// No description provided for @missingProfiles.
  ///
  /// In en, this message translates to:
  /// **'Missing profiles'**
  String get missingProfiles;

  /// No description provided for @suspendedAccounts.
  ///
  /// In en, this message translates to:
  /// **'Suspended accounts'**
  String get suspendedAccounts;

  /// No description provided for @people.
  ///
  /// In en, this message translates to:
  /// **'People'**
  String get people;

  /// No description provided for @invitePerson.
  ///
  /// In en, this message translates to:
  /// **'Invite person'**
  String get invitePerson;

  /// No description provided for @searchPeopleHint.
  ///
  /// In en, this message translates to:
  /// **'Search exact email, phone, or user ID'**
  String get searchPeopleHint;

  /// No description provided for @clearSearch.
  ///
  /// In en, this message translates to:
  /// **'Clear search'**
  String get clearSearch;

  /// No description provided for @loadMorePeople.
  ///
  /// In en, this message translates to:
  /// **'Load more people'**
  String get loadMorePeople;

  /// No description provided for @peopleCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'People could not be loaded'**
  String get peopleCouldNotLoad;

  /// No description provided for @tryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get tryAgain;

  /// No description provided for @volumeThisMonth.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get volumeThisMonth;

  /// No description provided for @volumeThisMonthNamed.
  ///
  /// In en, this message translates to:
  /// **'This month · {month}'**
  String volumeThisMonthNamed(String month);

  /// No description provided for @volumePiecesReceived.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece received} other{{count} pieces received}}'**
  String volumePiecesReceived(int count);

  /// No description provided for @volumeContainersShipped.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 container shipped} other{{count} containers shipped}}'**
  String volumeContainersShipped(int count);

  /// No description provided for @volumeLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this month\'s volume.'**
  String get volumeLoadFailed;

  /// No description provided for @notProvided.
  ///
  /// In en, this message translates to:
  /// **'Not provided'**
  String get notProvided;

  /// No description provided for @noPeopleFound.
  ///
  /// In en, this message translates to:
  /// **'No people found'**
  String get noPeopleFound;

  /// No description provided for @noPeopleFoundHelp.
  ///
  /// In en, this message translates to:
  /// **'Try another filter or search for an exact email, phone number, or user ID.'**
  String get noPeopleFoundHelp;

  /// No description provided for @peopleAccessRestricted.
  ///
  /// In en, this message translates to:
  /// **'People access is restricted'**
  String get peopleAccessRestricted;

  /// No description provided for @peopleAccessRestrictedHelp.
  ///
  /// In en, this message translates to:
  /// **'Your administrator role does not include permission to view marketplace people.'**
  String get peopleAccessRestrictedHelp;

  /// No description provided for @you.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get you;

  /// No description provided for @platformAdministrator.
  ///
  /// In en, this message translates to:
  /// **'Platform administrator'**
  String get platformAdministrator;

  /// No description provided for @businessStaffMember.
  ///
  /// In en, this message translates to:
  /// **'Business staff member'**
  String get businessStaffMember;

  /// No description provided for @pendingInvitation.
  ///
  /// In en, this message translates to:
  /// **'Pending invitation'**
  String get pendingInvitation;

  /// No description provided for @missingProfile.
  ///
  /// In en, this message translates to:
  /// **'Missing profile'**
  String get missingProfile;

  /// No description provided for @invitationPending.
  ///
  /// In en, this message translates to:
  /// **'Invitation pending'**
  String get invitationPending;

  /// No description provided for @deletionPending.
  ///
  /// In en, this message translates to:
  /// **'Deletion pending'**
  String get deletionPending;

  /// No description provided for @authenticationMissing.
  ///
  /// In en, this message translates to:
  /// **'Authentication missing'**
  String get authenticationMissing;

  /// No description provided for @identityAndAccess.
  ///
  /// In en, this message translates to:
  /// **'Identity & access'**
  String get identityAndAccess;

  /// No description provided for @emailVerification.
  ///
  /// In en, this message translates to:
  /// **'Email verification'**
  String get emailVerification;

  /// No description provided for @verified.
  ///
  /// In en, this message translates to:
  /// **'Verified'**
  String get verified;

  /// No description provided for @notVerified.
  ///
  /// In en, this message translates to:
  /// **'Not verified'**
  String get notVerified;

  /// No description provided for @businessAccess.
  ///
  /// In en, this message translates to:
  /// **'Business access'**
  String get businessAccess;

  /// No description provided for @businessPermissions.
  ///
  /// In en, this message translates to:
  /// **'Business permissions'**
  String get businessPermissions;

  /// No description provided for @businessPermissionsHelp.
  ///
  /// In en, this message translates to:
  /// **'Grant only the tools this person needs. You can adjust access later.'**
  String get businessPermissionsHelp;

  /// No description provided for @noAssignedPermissions.
  ///
  /// In en, this message translates to:
  /// **'No assigned permissions'**
  String get noAssignedPermissions;

  /// No description provided for @cannotChangeOwnAccess.
  ///
  /// In en, this message translates to:
  /// **'For safety, you cannot change your own access from this screen.'**
  String get cannotChangeOwnAccess;

  /// No description provided for @accountActions.
  ///
  /// In en, this message translates to:
  /// **'Account actions'**
  String get accountActions;

  /// No description provided for @suspendAccount.
  ///
  /// In en, this message translates to:
  /// **'Suspend account'**
  String get suspendAccount;

  /// No description provided for @suspendAccountConfirm.
  ///
  /// In en, this message translates to:
  /// **'This person will immediately lose access and all active sessions will be revoked.'**
  String get suspendAccountConfirm;

  /// No description provided for @restoreAccount.
  ///
  /// In en, this message translates to:
  /// **'Restore account'**
  String get restoreAccount;

  /// No description provided for @restoreAccountConfirm.
  ///
  /// In en, this message translates to:
  /// **'This person will be allowed to sign in again.'**
  String get restoreAccountConfirm;

  /// No description provided for @accountSuspended.
  ///
  /// In en, this message translates to:
  /// **'Account suspended'**
  String get accountSuspended;

  /// No description provided for @accountRestored.
  ///
  /// In en, this message translates to:
  /// **'Account restored'**
  String get accountRestored;

  /// No description provided for @revokeSessions.
  ///
  /// In en, this message translates to:
  /// **'Revoke active sessions'**
  String get revokeSessions;

  /// No description provided for @sessionsRevoked.
  ///
  /// In en, this message translates to:
  /// **'Active sessions revoked'**
  String get sessionsRevoked;

  /// No description provided for @sendPasswordReset.
  ///
  /// In en, this message translates to:
  /// **'Send password reset'**
  String get sendPasswordReset;

  /// No description provided for @passwordResetSent.
  ///
  /// In en, this message translates to:
  /// **'Password reset requested'**
  String get passwordResetSent;

  /// No description provided for @sendVerificationEmail.
  ///
  /// In en, this message translates to:
  /// **'Send verification email'**
  String get sendVerificationEmail;

  /// No description provided for @verificationEmailSent.
  ///
  /// In en, this message translates to:
  /// **'Verification email requested'**
  String get verificationEmailSent;

  /// No description provided for @transferOwnership.
  ///
  /// In en, this message translates to:
  /// **'Transfer business ownership'**
  String get transferOwnership;

  /// No description provided for @transferOwnershipConfirm.
  ///
  /// In en, this message translates to:
  /// **'This staff member will become the business owner and the current owner will become staff.'**
  String get transferOwnershipConfirm;

  /// No description provided for @ownershipTransferred.
  ///
  /// In en, this message translates to:
  /// **'Business ownership transferred'**
  String get ownershipTransferred;

  /// No description provided for @resendInvitation.
  ///
  /// In en, this message translates to:
  /// **'Resend invitation'**
  String get resendInvitation;

  /// No description provided for @invitationResent.
  ///
  /// In en, this message translates to:
  /// **'Invitation resent'**
  String get invitationResent;

  /// No description provided for @cancelInvitation.
  ///
  /// In en, this message translates to:
  /// **'Cancel invitation'**
  String get cancelInvitation;

  /// No description provided for @cancelInvitationConfirm.
  ///
  /// In en, this message translates to:
  /// **'This invitation will no longer be usable.'**
  String get cancelInvitationConfirm;

  /// No description provided for @invitationCancelled.
  ///
  /// In en, this message translates to:
  /// **'Invitation cancelled'**
  String get invitationCancelled;

  /// No description provided for @reviewDeletionRequest.
  ///
  /// In en, this message translates to:
  /// **'Review account deletion'**
  String get reviewDeletionRequest;

  /// No description provided for @deletionBlocked.
  ///
  /// In en, this message translates to:
  /// **'Deletion is blocked'**
  String get deletionBlocked;

  /// No description provided for @deletionBlockedByRecords.
  ///
  /// In en, this message translates to:
  /// **'{count} active or legally retained record(s) must be resolved before this account can be deleted.'**
  String deletionBlockedByRecords(int count);

  /// No description provided for @finalizeAccountDeletion.
  ///
  /// In en, this message translates to:
  /// **'Finalize account deletion'**
  String get finalizeAccountDeletion;

  /// No description provided for @finalizeAccountDeletionConfirm.
  ///
  /// In en, this message translates to:
  /// **'This permanently removes access after the server confirms there are no blocking records. This cannot be undone.'**
  String get finalizeAccountDeletionConfirm;

  /// No description provided for @accountDeletionFinalized.
  ///
  /// In en, this message translates to:
  /// **'Account deletion finalized'**
  String get accountDeletionFinalized;

  /// No description provided for @adminApprovedDeletion.
  ///
  /// In en, this message translates to:
  /// **'Deletion reviewed and approved by a platform administrator.'**
  String get adminApprovedDeletion;

  /// No description provided for @invitePlatformAdministrator.
  ///
  /// In en, this message translates to:
  /// **'Invite platform administrator'**
  String get invitePlatformAdministrator;

  /// No description provided for @invitePlatformAdministratorHelp.
  ///
  /// In en, this message translates to:
  /// **'Choose a limited administrator role. Super-admin access is never granted by invitation.'**
  String get invitePlatformAdministratorHelp;

  /// No description provided for @inviteBusinessPersonnel.
  ///
  /// In en, this message translates to:
  /// **'Invite business personnel'**
  String get inviteBusinessPersonnel;

  /// No description provided for @inviteBusinessPersonnelHelp.
  ///
  /// In en, this message translates to:
  /// **'Select the business and the exact tools this person can use.'**
  String get inviteBusinessPersonnelHelp;

  /// No description provided for @sendInvitation.
  ///
  /// In en, this message translates to:
  /// **'Send invitation'**
  String get sendInvitation;

  /// No description provided for @invitationSent.
  ///
  /// In en, this message translates to:
  /// **'Invitation sent'**
  String get invitationSent;

  /// No description provided for @adminRole.
  ///
  /// In en, this message translates to:
  /// **'Administrator role'**
  String get adminRole;

  /// No description provided for @superAdministrator.
  ///
  /// In en, this message translates to:
  /// **'Super administrator'**
  String get superAdministrator;

  /// No description provided for @operationsManager.
  ///
  /// In en, this message translates to:
  /// **'Operations manager'**
  String get operationsManager;

  /// No description provided for @financeManager.
  ///
  /// In en, this message translates to:
  /// **'Finance manager'**
  String get financeManager;

  /// No description provided for @supportAdministrator.
  ///
  /// In en, this message translates to:
  /// **'Support administrator'**
  String get supportAdministrator;

  /// No description provided for @contentManager.
  ///
  /// In en, this message translates to:
  /// **'Content manager'**
  String get contentManager;

  /// No description provided for @profile.
  ///
  /// In en, this message translates to:
  /// **'Profile'**
  String get profile;

  /// No description provided for @listings.
  ///
  /// In en, this message translates to:
  /// **'Listings'**
  String get listings;

  /// No description provided for @barrels.
  ///
  /// In en, this message translates to:
  /// **'Barrels'**
  String get barrels;

  /// No description provided for @freight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get freight;

  /// No description provided for @transport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get transport;

  /// No description provided for @parking.
  ///
  /// In en, this message translates to:
  /// **'Parking'**
  String get parking;

  /// No description provided for @destinations.
  ///
  /// In en, this message translates to:
  /// **'Destinations'**
  String get destinations;

  /// No description provided for @growth.
  ///
  /// In en, this message translates to:
  /// **'Growth'**
  String get growth;

  /// No description provided for @invitationProfileSetupTitle.
  ///
  /// In en, this message translates to:
  /// **'Finish setting up your invited access'**
  String get invitationProfileSetupTitle;

  /// No description provided for @invitationProfileSetupHelp.
  ///
  /// In en, this message translates to:
  /// **'Verify this email address, then return here to activate the role you were invited to.'**
  String get invitationProfileSetupHelp;

  /// No description provided for @verifyInvitedEmail.
  ///
  /// In en, this message translates to:
  /// **'Send verification email'**
  String get verifyInvitedEmail;

  /// No description provided for @sendingVerificationEmail.
  ///
  /// In en, this message translates to:
  /// **'Sending verification email…'**
  String get sendingVerificationEmail;

  /// No description provided for @iVerifiedContinue.
  ///
  /// In en, this message translates to:
  /// **'I verified — continue'**
  String get iVerifiedContinue;

  /// No description provided for @invitationVerificationEmailSent.
  ///
  /// In en, this message translates to:
  /// **'Verification email sent. Check your inbox, then return here.'**
  String get invitationVerificationEmailSent;

  /// No description provided for @invitationVerificationEmailFailed.
  ///
  /// In en, this message translates to:
  /// **'The verification email could not be sent. Please try again.'**
  String get invitationVerificationEmailFailed;

  /// No description provided for @editTransportRequest.
  ///
  /// In en, this message translates to:
  /// **'Edit request'**
  String get editTransportRequest;

  /// No description provided for @editTransportRequestTitle.
  ///
  /// In en, this message translates to:
  /// **'Edit your request'**
  String get editTransportRequestTitle;

  /// No description provided for @editTransportRequestSubtitle.
  ///
  /// In en, this message translates to:
  /// **'You can change your request until you choose a quote.'**
  String get editTransportRequestSubtitle;

  /// No description provided for @transportEditContactSection.
  ///
  /// In en, this message translates to:
  /// **'Contact and pickup'**
  String get transportEditContactSection;

  /// No description provided for @transportEditVehicleSection.
  ///
  /// In en, this message translates to:
  /// **'Vehicle and destination'**
  String get transportEditVehicleSection;

  /// No description provided for @transportEditQuoteWarningTitle.
  ///
  /// In en, this message translates to:
  /// **'This will reset your quotes'**
  String get transportEditQuoteWarningTitle;

  /// No description provided for @transportEditQuoteWarningMessage.
  ///
  /// In en, this message translates to:
  /// **'Businesses priced their quotes on your current details. Changing the vehicle, pickup area, transport method or destination clears the quotes you already have, and businesses will be asked to quote again.'**
  String get transportEditQuoteWarningMessage;

  /// No description provided for @transportEditKeepEditing.
  ///
  /// In en, this message translates to:
  /// **'Keep editing'**
  String get transportEditKeepEditing;

  /// No description provided for @transportEditSaveAnyway.
  ///
  /// In en, this message translates to:
  /// **'Save and reset quotes'**
  String get transportEditSaveAnyway;

  /// No description provided for @transportEditSaved.
  ///
  /// In en, this message translates to:
  /// **'Request updated'**
  String get transportEditSaved;

  /// No description provided for @transportEditSavedRequote.
  ///
  /// In en, this message translates to:
  /// **'Request updated. Businesses will send new quotes.'**
  String get transportEditSavedRequote;

  /// No description provided for @transportEditNoChanges.
  ///
  /// In en, this message translates to:
  /// **'Nothing changed'**
  String get transportEditNoChanges;

  /// No description provided for @couldNotUpdateTransportRequest.
  ///
  /// In en, this message translates to:
  /// **'Could not update this request. Please try again.'**
  String get couldNotUpdateTransportRequest;

  /// No description provided for @transportEditDestinationMoved.
  ///
  /// In en, this message translates to:
  /// **'Your request now goes to businesses serving the new destination.'**
  String get transportEditDestinationMoved;

  /// No description provided for @notes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get notes;

  /// No description provided for @vehicleOperable.
  ///
  /// In en, this message translates to:
  /// **'Vehicle is drivable'**
  String get vehicleOperable;

  /// No description provided for @transportEditNeedsPickup.
  ///
  /// In en, this message translates to:
  /// **'I need pickup from an address'**
  String get transportEditNeedsPickup;

  /// No description provided for @addressApartmentLabel.
  ///
  /// In en, this message translates to:
  /// **'Apartment, suite, or unit (optional)'**
  String get addressApartmentLabel;

  /// No description provided for @addressApartmentHint.
  ///
  /// In en, this message translates to:
  /// **'Apt 4B'**
  String get addressApartmentHint;

  /// No description provided for @addressApartmentHelper.
  ///
  /// In en, this message translates to:
  /// **'Apartment numbers are rarely in the suggestion — add yours here.'**
  String get addressApartmentHelper;

  /// No description provided for @addressCityLabel.
  ///
  /// In en, this message translates to:
  /// **'City'**
  String get addressCityLabel;

  /// No description provided for @addressStateLabel.
  ///
  /// In en, this message translates to:
  /// **'State or region'**
  String get addressStateLabel;

  /// No description provided for @addressPostalCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'ZIP or postal code'**
  String get addressPostalCodeLabel;

  /// No description provided for @addressCountryLabel.
  ///
  /// In en, this message translates to:
  /// **'Country'**
  String get addressCountryLabel;

  /// No description provided for @recordAParkedCar.
  ///
  /// In en, this message translates to:
  /// **'Record a parked car'**
  String get recordAParkedCar;

  /// No description provided for @recordTheCar.
  ///
  /// In en, this message translates to:
  /// **'Record the car'**
  String get recordTheCar;

  /// No description provided for @recordingParkedCar.
  ///
  /// In en, this message translates to:
  /// **'Recording...'**
  String get recordingParkedCar;

  /// No description provided for @parkedCarRecorded.
  ///
  /// In en, this message translates to:
  /// **'Parked car recorded'**
  String get parkedCarRecorded;

  /// No description provided for @printReceiptOnly.
  ///
  /// In en, this message translates to:
  /// **'Print a receipt only'**
  String get printReceiptOnly;

  /// No description provided for @howDoesThisParkingGetPaid.
  ///
  /// In en, this message translates to:
  /// **'How does this parking get paid?'**
  String get howDoesThisParkingGetPaid;

  /// No description provided for @customerPaysUsDirectly.
  ///
  /// In en, this message translates to:
  /// **'Customer pays us directly (Zelle/cash)'**
  String get customerPaysUsDirectly;

  /// No description provided for @sendTheCustomerAPaymentLink.
  ///
  /// In en, this message translates to:
  /// **'Send the customer a payment link'**
  String get sendTheCustomerAPaymentLink;

  /// No description provided for @directPaymentExplainer.
  ///
  /// In en, this message translates to:
  /// **'We record what the customer owes you and take no cut. You mark it received when the money arrives.'**
  String get directPaymentExplainer;

  /// No description provided for @paymentLinkExplainer.
  ///
  /// In en, this message translates to:
  /// **'We bill the customer for you and send you the rest.'**
  String get paymentLinkExplainer;

  /// No description provided for @paymentLinkShareHint.
  ///
  /// In en, this message translates to:
  /// **'Send this link to the customer so they can pay. It stays valid until they use it.'**
  String get paymentLinkShareHint;

  /// No description provided for @directPaymentResultHint.
  ///
  /// In en, this message translates to:
  /// **'The customer pays your business directly. We record the amount and never bill it. Mark the payment received once the money arrives.'**
  String get directPaymentResultHint;

  /// No description provided for @paymentLinkLabel.
  ///
  /// In en, this message translates to:
  /// **'Payment link'**
  String get paymentLinkLabel;

  /// No description provided for @copyPaymentLink.
  ///
  /// In en, this message translates to:
  /// **'Copy payment link'**
  String get copyPaymentLink;

  /// No description provided for @sharePaymentLink.
  ///
  /// In en, this message translates to:
  /// **'Share payment link'**
  String get sharePaymentLink;

  /// No description provided for @paymentLinkShareFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not open the share sheet'**
  String get paymentLinkShareFailed;

  /// No description provided for @paymentLinkShareMessage.
  ///
  /// In en, this message translates to:
  /// **'{business} parked your {car}. Tracking {code}. Amount due {amount}. Pay here: {link}'**
  String paymentLinkShareMessage(
    String business,
    String car,
    String code,
    String amount,
    String link,
  );

  /// No description provided for @paymentLinkCopied.
  ///
  /// In en, this message translates to:
  /// **'Payment link copied'**
  String get paymentLinkCopied;

  /// No description provided for @amountDue.
  ///
  /// In en, this message translates to:
  /// **'Amount due'**
  String get amountDue;

  /// No description provided for @amountRecorded.
  ///
  /// In en, this message translates to:
  /// **'Amount recorded'**
  String get amountRecorded;

  /// No description provided for @paymentStatusLabel.
  ///
  /// In en, this message translates to:
  /// **'Payment status'**
  String get paymentStatusLabel;

  /// No description provided for @receivedVia.
  ///
  /// In en, this message translates to:
  /// **'Received via'**
  String get receivedVia;

  /// No description provided for @markPaymentReceived.
  ///
  /// In en, this message translates to:
  /// **'Mark payment received'**
  String get markPaymentReceived;

  /// No description provided for @markPaymentReceivedTitle.
  ///
  /// In en, this message translates to:
  /// **'Record this payment?'**
  String get markPaymentReceivedTitle;

  /// No description provided for @markPaymentReceivedMessage.
  ///
  /// In en, this message translates to:
  /// **'Record this parking as paid to your business? This cannot be undone here.'**
  String get markPaymentReceivedMessage;

  /// No description provided for @paymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'Payment recorded.'**
  String get paymentRecorded;

  /// No description provided for @parkingAlreadyMarkedPaid.
  ///
  /// In en, this message translates to:
  /// **'This parking was already marked paid.'**
  String get parkingAlreadyMarkedPaid;

  /// No description provided for @paymentCouldNotBeRecorded.
  ///
  /// In en, this message translates to:
  /// **'The payment could not be recorded.'**
  String get paymentCouldNotBeRecorded;

  /// No description provided for @carCouldNotBeRecorded.
  ///
  /// In en, this message translates to:
  /// **'The car could not be recorded.'**
  String get carCouldNotBeRecorded;

  /// No description provided for @paymentLinkCopyFailed.
  ///
  /// In en, this message translates to:
  /// **'The payment link could not be copied. Select and copy it manually.'**
  String get paymentLinkCopyFailed;

  /// No description provided for @awaitingPaymentToTheBusiness.
  ///
  /// In en, this message translates to:
  /// **'Awaiting payment to the business'**
  String get awaitingPaymentToTheBusiness;

  /// No description provided for @paidToTheBusiness.
  ///
  /// In en, this message translates to:
  /// **'Paid to the business'**
  String get paidToTheBusiness;

  /// No description provided for @paymentLinkSent.
  ///
  /// In en, this message translates to:
  /// **'Payment link sent'**
  String get paymentLinkSent;

  /// No description provided for @paymentLinkPaid.
  ///
  /// In en, this message translates to:
  /// **'Payment link paid'**
  String get paymentLinkPaid;

  /// No description provided for @nothingToCollect.
  ///
  /// In en, this message translates to:
  /// **'Nothing to collect'**
  String get nothingToCollect;

  /// No description provided for @receivedViaZelle.
  ///
  /// In en, this message translates to:
  /// **'Zelle transfer'**
  String get receivedViaZelle;

  /// No description provided for @receivedViaCash.
  ///
  /// In en, this message translates to:
  /// **'Cash payment'**
  String get receivedViaCash;

  /// No description provided for @receivedViaCashApp.
  ///
  /// In en, this message translates to:
  /// **'Cash App'**
  String get receivedViaCashApp;

  /// No description provided for @receivedViaVenmo.
  ///
  /// In en, this message translates to:
  /// **'Venmo'**
  String get receivedViaVenmo;

  /// No description provided for @receivedViaCheck.
  ///
  /// In en, this message translates to:
  /// **'Paper check'**
  String get receivedViaCheck;

  /// No description provided for @receivedViaCardInPerson.
  ///
  /// In en, this message translates to:
  /// **'Card in person'**
  String get receivedViaCardInPerson;

  /// No description provided for @receivedViaOther.
  ///
  /// In en, this message translates to:
  /// **'Another method'**
  String get receivedViaOther;

  /// No description provided for @parkingErrorBusinessRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose a business before recording a car.'**
  String get parkingErrorBusinessRequired;

  /// No description provided for @parkingErrorCustomerName.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer\'s name.'**
  String get parkingErrorCustomerName;

  /// No description provided for @parkingErrorCustomerPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer\'s phone number.'**
  String get parkingErrorCustomerPhone;

  /// No description provided for @parkingErrorCustomerEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address.'**
  String get parkingErrorCustomerEmail;

  /// No description provided for @parkingErrorPaymentLinkContact.
  ///
  /// In en, this message translates to:
  /// **'A payment link needs a phone number or an email address.'**
  String get parkingErrorPaymentLinkContact;

  /// No description provided for @parkingErrorCarMake.
  ///
  /// In en, this message translates to:
  /// **'Select the car make.'**
  String get parkingErrorCarMake;

  /// No description provided for @parkingErrorCarModel.
  ///
  /// In en, this message translates to:
  /// **'Select the car model.'**
  String get parkingErrorCarModel;

  /// No description provided for @parkingErrorCarYear.
  ///
  /// In en, this message translates to:
  /// **'Select the car year.'**
  String get parkingErrorCarYear;

  /// No description provided for @parkingErrorCarYearInvalid.
  ///
  /// In en, this message translates to:
  /// **'Select a valid car year.'**
  String get parkingErrorCarYearInvalid;

  /// No description provided for @parkingErrorStartDate.
  ///
  /// In en, this message translates to:
  /// **'Choose the day the car arrives.'**
  String get parkingErrorStartDate;

  /// No description provided for @parkingErrorEndDate.
  ///
  /// In en, this message translates to:
  /// **'Choose the day the car leaves.'**
  String get parkingErrorEndDate;

  /// No description provided for @parkingErrorEndBeforeStart.
  ///
  /// In en, this message translates to:
  /// **'The end date cannot be before the start date.'**
  String get parkingErrorEndBeforeStart;

  /// No description provided for @notPaid.
  ///
  /// In en, this message translates to:
  /// **'Not paid'**
  String get notPaid;

  /// No description provided for @parkingPaymentLinkAlreadyUsed.
  ///
  /// In en, this message translates to:
  /// **'This link was already used to pay. Nothing further is owed.'**
  String get parkingPaymentLinkAlreadyUsed;

  /// No description provided for @cancelPaymentLink.
  ///
  /// In en, this message translates to:
  /// **'Cancel payment link'**
  String get cancelPaymentLink;

  /// No description provided for @cancelPaymentLinkConfirm.
  ///
  /// In en, this message translates to:
  /// **'Cancel this payment link? The customer will no longer be able to pay with it.'**
  String get cancelPaymentLinkConfirm;

  /// No description provided for @paymentLinkCancelled.
  ///
  /// In en, this message translates to:
  /// **'Payment link cancelled.'**
  String get paymentLinkCancelled;

  /// No description provided for @parkingPaymentLinkCancelled.
  ///
  /// In en, this message translates to:
  /// **'This payment link was cancelled.'**
  String get parkingPaymentLinkCancelled;

  /// No description provided for @paymentLinkCouldNotBeCancelled.
  ///
  /// In en, this message translates to:
  /// **'The payment link could not be cancelled.'**
  String get paymentLinkCouldNotBeCancelled;

  /// No description provided for @parkingPrintReceipt.
  ///
  /// In en, this message translates to:
  /// **'Print receipt'**
  String get parkingPrintReceipt;

  /// No description provided for @parkingPrintInvoice.
  ///
  /// In en, this message translates to:
  /// **'Print invoice'**
  String get parkingPrintInvoice;

  /// No description provided for @parkingDocumentCouldNotBeOpened.
  ///
  /// In en, this message translates to:
  /// **'The document could not be opened.'**
  String get parkingDocumentCouldNotBeOpened;

  /// No description provided for @resendPaymentLink.
  ///
  /// In en, this message translates to:
  /// **'Resend payment link'**
  String get resendPaymentLink;

  /// No description provided for @parkingPaymentLinkEmailed.
  ///
  /// In en, this message translates to:
  /// **'Payment link emailed to the customer.'**
  String get parkingPaymentLinkEmailed;

  /// No description provided for @parkingPaymentLinkTexted.
  ///
  /// In en, this message translates to:
  /// **'Payment link texted to the customer.'**
  String get parkingPaymentLinkTexted;

  /// No description provided for @parkingPaymentLinkEmailedAndTexted.
  ///
  /// In en, this message translates to:
  /// **'Payment link emailed and texted to the customer.'**
  String get parkingPaymentLinkEmailedAndTexted;

  /// No description provided for @parkingPaymentLinkNotDelivered.
  ///
  /// In en, this message translates to:
  /// **'The link could not be emailed or texted. Copy it and send it to the customer yourself.'**
  String get parkingPaymentLinkNotDelivered;

  /// No description provided for @parkingPaymentLinkCouldNotBeResent.
  ///
  /// In en, this message translates to:
  /// **'The payment link could not be resent.'**
  String get parkingPaymentLinkCouldNotBeResent;

  /// No description provided for @parkingPaymentLinkReissued.
  ///
  /// In en, this message translates to:
  /// **'The amount changed, so a new payment link was issued.'**
  String get parkingPaymentLinkReissued;

  /// No description provided for @parkingPaidCannotBeEdited.
  ///
  /// In en, this message translates to:
  /// **'This parking has been paid for and can no longer be edited.'**
  String get parkingPaidCannotBeEdited;

  /// No description provided for @parkingNothingChanged.
  ///
  /// In en, this message translates to:
  /// **'Nothing was changed.'**
  String get parkingNothingChanged;

  /// No description provided for @parkingRecordCouldNotBeUpdated.
  ///
  /// In en, this message translates to:
  /// **'The parking record could not be updated.'**
  String get parkingRecordCouldNotBeUpdated;

  /// No description provided for @parkedBetween.
  ///
  /// In en, this message translates to:
  /// **'Parked between'**
  String get parkedBetween;

  /// No description provided for @dateFrom.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get dateFrom;

  /// No description provided for @dateTo.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get dateTo;

  /// No description provided for @anyDate.
  ///
  /// In en, this message translates to:
  /// **'Any date'**
  String get anyDate;

  /// No description provided for @clearDates.
  ///
  /// In en, this message translates to:
  /// **'Clear dates'**
  String get clearDates;

  /// No description provided for @vinNumberOptional.
  ///
  /// In en, this message translates to:
  /// **'VIN (optional)'**
  String get vinNumberOptional;

  /// No description provided for @checkPaymentStatus.
  ///
  /// In en, this message translates to:
  /// **'Check payment status'**
  String get checkPaymentStatus;

  /// No description provided for @checkingPaymentStatus.
  ///
  /// In en, this message translates to:
  /// **'Checking...'**
  String get checkingPaymentStatus;

  /// No description provided for @parkingPaymentConfirmedWithStripe.
  ///
  /// In en, this message translates to:
  /// **'Payment confirmed with Stripe and recorded.'**
  String get parkingPaymentConfirmedWithStripe;

  /// No description provided for @parkingPaymentAlreadyRecorded.
  ///
  /// In en, this message translates to:
  /// **'Already recorded as paid.'**
  String get parkingPaymentAlreadyRecorded;

  /// No description provided for @parkingPaymentNotReceivedYet.
  ///
  /// In en, this message translates to:
  /// **'Stripe has not received this payment yet.'**
  String get parkingPaymentNotReceivedYet;

  /// No description provided for @parkingPaymentStatusCouldNotBeChecked.
  ///
  /// In en, this message translates to:
  /// **'The payment status could not be checked.'**
  String get parkingPaymentStatusCouldNotBeChecked;

  /// No description provided for @parkingPaymentLinkAlreadyCancelled.
  ///
  /// In en, this message translates to:
  /// **'This payment link was already cancelled.'**
  String get parkingPaymentLinkAlreadyCancelled;

  /// No description provided for @parkingEnds.
  ///
  /// In en, this message translates to:
  /// **'Ends'**
  String get parkingEnds;

  /// No description provided for @parkingEnded.
  ///
  /// In en, this message translates to:
  /// **'Ended'**
  String get parkingEnded;

  /// No description provided for @parkingStatusUpdated.
  ///
  /// In en, this message translates to:
  /// **'Parking status updated.'**
  String get parkingStatusUpdated;

  /// No description provided for @parkingStatusCouldNotBeUpdated.
  ///
  /// In en, this message translates to:
  /// **'The parking status could not be updated.'**
  String get parkingStatusCouldNotBeUpdated;

  /// No description provided for @searchParkedCars.
  ///
  /// In en, this message translates to:
  /// **'Search tracking, owner, car, VIN…'**
  String get searchParkedCars;

  /// No description provided for @noParkingRecordsMatchFilter.
  ///
  /// In en, this message translates to:
  /// **'No parking records match this filter.'**
  String get noParkingRecordsMatchFilter;

  /// No description provided for @parkedCarRecordedWithCode.
  ///
  /// In en, this message translates to:
  /// **'Parked car recorded. Tracking number: {trackingCode}'**
  String parkedCarRecordedWithCode(Object trackingCode);

  /// No description provided for @businessServiceOverviewNeedsYou.
  ///
  /// In en, this message translates to:
  /// **'need you'**
  String get businessServiceOverviewNeedsYou;

  /// No description provided for @businessTransportTitle.
  ///
  /// In en, this message translates to:
  /// **'Transport bids & jobs'**
  String get businessTransportTitle;

  /// No description provided for @businessTransportSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Quote the requests you were invited to, then move the jobs you won.'**
  String get businessTransportSubtitle;

  /// No description provided for @businessTransportOpenToBid.
  ///
  /// In en, this message translates to:
  /// **'Open to bid'**
  String get businessTransportOpenToBid;

  /// No description provided for @businessTransportQuoted.
  ///
  /// In en, this message translates to:
  /// **'Your quotes'**
  String get businessTransportQuoted;

  /// No description provided for @businessTransportWonJobs.
  ///
  /// In en, this message translates to:
  /// **'Won jobs'**
  String get businessTransportWonJobs;

  /// No description provided for @businessTransportNoOpportunities.
  ///
  /// In en, this message translates to:
  /// **'No transport request is open for a bid right now.'**
  String get businessTransportNoOpportunities;

  /// No description provided for @businessTransportNoQuotes.
  ///
  /// In en, this message translates to:
  /// **'You have no live quotes. Bid on an open request to get one.'**
  String get businessTransportNoQuotes;

  /// No description provided for @businessTransportNoJobs.
  ///
  /// In en, this message translates to:
  /// **'No customer has chosen your quote yet.'**
  String get businessTransportNoJobs;

  /// No description provided for @businessTransportQuoteDeadline.
  ///
  /// In en, this message translates to:
  /// **'Quote deadline'**
  String get businessTransportQuoteDeadline;

  /// No description provided for @businessTransportWindowClosed.
  ///
  /// In en, this message translates to:
  /// **'The quote window has closed.'**
  String get businessTransportWindowClosed;

  /// No description provided for @businessTransportRoute.
  ///
  /// In en, this message translates to:
  /// **'Route'**
  String get businessTransportRoute;

  /// No description provided for @businessTransportVehicleOperable.
  ///
  /// In en, this message translates to:
  /// **'Runs and drives'**
  String get businessTransportVehicleOperable;

  /// No description provided for @businessTransportVehicleNotOperable.
  ///
  /// In en, this message translates to:
  /// **'Needs assistance'**
  String get businessTransportVehicleNotOperable;

  /// No description provided for @businessTransportPreferredPickup.
  ///
  /// In en, this message translates to:
  /// **'Preferred pickup'**
  String get businessTransportPreferredPickup;

  /// No description provided for @businessTransportFlexibleDates.
  ///
  /// In en, this message translates to:
  /// **'Flexible'**
  String get businessTransportFlexibleDates;

  /// No description provided for @businessTransportSendQuote.
  ///
  /// In en, this message translates to:
  /// **'Send quote'**
  String get businessTransportSendQuote;

  /// No description provided for @businessTransportSendingQuote.
  ///
  /// In en, this message translates to:
  /// **'Sending quote…'**
  String get businessTransportSendingQuote;

  /// No description provided for @businessTransportReviseQuote.
  ///
  /// In en, this message translates to:
  /// **'Revise quote'**
  String get businessTransportReviseQuote;

  /// No description provided for @businessTransportRevisingQuote.
  ///
  /// In en, this message translates to:
  /// **'Saving revision…'**
  String get businessTransportRevisingQuote;

  /// No description provided for @businessTransportReviseNotice.
  ///
  /// In en, this message translates to:
  /// **'You already have a quote on this request. Sending again replaces it — one business has one quote per request.'**
  String get businessTransportReviseNotice;

  /// No description provided for @businessTransportCurrentQuote.
  ///
  /// In en, this message translates to:
  /// **'Your current quote'**
  String get businessTransportCurrentQuote;

  /// No description provided for @businessTransportRevisionNumber.
  ///
  /// In en, this message translates to:
  /// **'Revision {revision}'**
  String businessTransportRevisionNumber(Object revision);

  /// No description provided for @businessTransportWithdrawQuote.
  ///
  /// In en, this message translates to:
  /// **'Withdraw quote'**
  String get businessTransportWithdrawQuote;

  /// No description provided for @businessTransportWithdrawingQuote.
  ///
  /// In en, this message translates to:
  /// **'Withdrawing…'**
  String get businessTransportWithdrawingQuote;

  /// No description provided for @businessTransportWithdrawTitle.
  ///
  /// In en, this message translates to:
  /// **'Withdraw this quote?'**
  String get businessTransportWithdrawTitle;

  /// No description provided for @businessTransportWithdrawMessage.
  ///
  /// In en, this message translates to:
  /// **'The customer will no longer be able to choose it. The request goes back to open, so you can bid again.'**
  String get businessTransportWithdrawMessage;

  /// No description provided for @businessTransportQuoteWithdrawn.
  ///
  /// In en, this message translates to:
  /// **'Quote withdrawn. The request is open for a new bid.'**
  String get businessTransportQuoteWithdrawn;

  /// No description provided for @businessTransportWithdrawFailed.
  ///
  /// In en, this message translates to:
  /// **'The quote could not be withdrawn. Try again.'**
  String get businessTransportWithdrawFailed;

  /// No description provided for @businessTransportQuoteSent.
  ///
  /// In en, this message translates to:
  /// **'Quote sent to the customer.'**
  String get businessTransportQuoteSent;

  /// No description provided for @businessTransportQuoteRevised.
  ///
  /// In en, this message translates to:
  /// **'Quote revised. The customer now sees revision {revision}.'**
  String businessTransportQuoteRevised(Object revision);

  /// No description provided for @businessTransportQuoteFailed.
  ///
  /// In en, this message translates to:
  /// **'The quote could not be sent. Try again.'**
  String get businessTransportQuoteFailed;

  /// No description provided for @businessTransportAmountLabel.
  ///
  /// In en, this message translates to:
  /// **'Your transport price (USD)'**
  String get businessTransportAmountLabel;

  /// No description provided for @businessTransportAmountHint.
  ///
  /// In en, this message translates to:
  /// **'For example, 1250.00'**
  String get businessTransportAmountHint;

  /// No description provided for @businessTransportAmountHelp.
  ///
  /// In en, this message translates to:
  /// **'The transport leg only. Laawol adds your pickup fee on top.'**
  String get businessTransportAmountHelp;

  /// No description provided for @businessTransportPickupLeg.
  ///
  /// In en, this message translates to:
  /// **'Pickup leg'**
  String get businessTransportPickupLeg;

  /// No description provided for @businessTransportPickupPending.
  ///
  /// In en, this message translates to:
  /// **'Priced from your pickup plan when this quote is sent.'**
  String get businessTransportPickupPending;

  /// No description provided for @businessTransportPickupNotCharged.
  ///
  /// In en, this message translates to:
  /// **'No separate pickup fee — include collection in your price.'**
  String get businessTransportPickupNotCharged;

  /// No description provided for @businessTransportCustomerTotal.
  ///
  /// In en, this message translates to:
  /// **'Customer pays'**
  String get businessTransportCustomerTotal;

  /// No description provided for @businessTransportCustomerTotalPending.
  ///
  /// In en, this message translates to:
  /// **'Your price plus the pickup fee, once it is priced.'**
  String get businessTransportCustomerTotalPending;

  /// No description provided for @businessTransportTermsLabel.
  ///
  /// In en, this message translates to:
  /// **'Terms and inclusions (optional)'**
  String get businessTransportTermsLabel;

  /// No description provided for @businessTransportTermsHint.
  ///
  /// In en, this message translates to:
  /// **'What is included, timing assumptions, and any conditions.'**
  String get businessTransportTermsHint;

  /// No description provided for @businessTransportQuoteExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get businessTransportQuoteExpired;

  /// No description provided for @transportQuoteAmountRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter your transport price.'**
  String get transportQuoteAmountRequired;

  /// No description provided for @transportQuoteAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the price as a number, for example 1250.00.'**
  String get transportQuoteAmountInvalid;

  /// No description provided for @transportQuoteAmountFractional.
  ///
  /// In en, this message translates to:
  /// **'Prices are in whole cents — two decimal places at most.'**
  String get transportQuoteAmountFractional;

  /// No description provided for @transportQuoteAmountNotPositive.
  ///
  /// In en, this message translates to:
  /// **'A quote has to be more than zero.'**
  String get transportQuoteAmountNotPositive;

  /// No description provided for @transportQuoteAmountAboveCap.
  ///
  /// In en, this message translates to:
  /// **'A quote cannot be more than 1,000,000 USD.'**
  String get transportQuoteAmountAboveCap;

  /// No description provided for @transportQuoteCurrencyNotSupported.
  ///
  /// In en, this message translates to:
  /// **'Transport quotes must be in US dollars.'**
  String get transportQuoteCurrencyNotSupported;

  /// No description provided for @transportQuoteMethodNotSupported.
  ///
  /// In en, this message translates to:
  /// **'Choose open or enclosed transport.'**
  String get transportQuoteMethodNotSupported;

  /// No description provided for @transportQuoteDatesIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Give both estimates or neither.'**
  String get transportQuoteDatesIncomplete;

  /// No description provided for @transportQuotePickupNotInFuture.
  ///
  /// In en, this message translates to:
  /// **'The estimated pickup date has to be in the future.'**
  String get transportQuotePickupNotInFuture;

  /// No description provided for @transportQuoteDeliveryBeforePickup.
  ///
  /// In en, this message translates to:
  /// **'Delivery cannot be before pickup.'**
  String get transportQuoteDeliveryBeforePickup;

  /// No description provided for @transportQuoteTermsTooLong.
  ///
  /// In en, this message translates to:
  /// **'Terms must be 1000 characters or fewer.'**
  String get transportQuoteTermsTooLong;

  /// No description provided for @transportStatusScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get transportStatusScheduled;

  /// No description provided for @transportJobMoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Move this job'**
  String get transportJobMoveTitle;

  /// No description provided for @transportJobStatusUnknown.
  ///
  /// In en, this message translates to:
  /// **'This job is on {status}, which the transport workflow did not set — no transport action applies here.'**
  String transportJobStatusUnknown(Object status);

  /// No description provided for @transportJobNothingLeft.
  ///
  /// In en, this message translates to:
  /// **'This job is finished. There is nothing left to move.'**
  String get transportJobNothingLeft;

  /// No description provided for @transportJobStatusUpdated.
  ///
  /// In en, this message translates to:
  /// **'Transport updated.'**
  String get transportJobStatusUpdated;

  /// No description provided for @transportJobStatusAlready.
  ///
  /// In en, this message translates to:
  /// **'This job was already {status}.'**
  String transportJobStatusAlready(Object status);

  /// No description provided for @transportJobStatusFailed.
  ///
  /// In en, this message translates to:
  /// **'The transport status could not be updated. Try again.'**
  String get transportJobStatusFailed;

  /// No description provided for @transportJobContainerRequired.
  ///
  /// In en, this message translates to:
  /// **'Add the container number before marking this transport in transit.'**
  String get transportJobContainerRequired;

  /// No description provided for @transportJobTransitionNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'A transport cannot move from {from} to {to}.'**
  String transportJobTransitionNotAllowed(Object from, Object to);

  /// No description provided for @transportJobContainerOnFile.
  ///
  /// In en, this message translates to:
  /// **'Container {number}'**
  String transportJobContainerOnFile(Object number);

  /// No description provided for @transportJobAcceptedQuote.
  ///
  /// In en, this message translates to:
  /// **'Accepted quote'**
  String get transportJobAcceptedQuote;

  /// No description provided for @requestViewing.
  ///
  /// In en, this message translates to:
  /// **'Request a viewing'**
  String get requestViewing;

  /// No description provided for @manageViewing.
  ///
  /// In en, this message translates to:
  /// **'Manage viewing'**
  String get manageViewing;

  /// No description provided for @requestViewingSummary.
  ///
  /// In en, this message translates to:
  /// **'Propose a time to come and see this vehicle. The seller confirms it or offers other times.'**
  String get requestViewingSummary;

  /// No description provided for @requestViewingQuestion.
  ///
  /// In en, this message translates to:
  /// **'Send viewing request?'**
  String get requestViewingQuestion;

  /// No description provided for @requestViewingConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'The seller will confirm this time or offer other times. Nothing is charged.'**
  String get requestViewingConfirmMessage;

  /// No description provided for @viewingRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Viewing request sent. The seller will confirm it or offer other times.'**
  String get viewingRequestSent;

  /// No description provided for @viewingConversationTitle.
  ///
  /// In en, this message translates to:
  /// **'Your viewing for this car'**
  String get viewingConversationTitle;

  /// No description provided for @viewingStatusRequested.
  ///
  /// In en, this message translates to:
  /// **'Viewing requested'**
  String get viewingStatusRequested;

  /// No description provided for @viewingStatusCountered.
  ///
  /// In en, this message translates to:
  /// **'Other times offered'**
  String get viewingStatusCountered;

  /// No description provided for @viewingStatusDeclined.
  ///
  /// In en, this message translates to:
  /// **'Viewing declined'**
  String get viewingStatusDeclined;

  /// No description provided for @viewingStatusExpired.
  ///
  /// In en, this message translates to:
  /// **'Proposal expired'**
  String get viewingStatusExpired;

  /// No description provided for @viewingStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Viewing cancelled'**
  String get viewingStatusCancelled;

  /// No description provided for @viewingYourTurn.
  ///
  /// In en, this message translates to:
  /// **'Your turn'**
  String get viewingYourTurn;

  /// No description provided for @viewingWaitingOnBuyer.
  ///
  /// In en, this message translates to:
  /// **'Waiting on the buyer'**
  String get viewingWaitingOnBuyer;

  /// No description provided for @viewingWaitingOnSeller.
  ///
  /// In en, this message translates to:
  /// **'Waiting on the seller'**
  String get viewingWaitingOnSeller;

  /// No description provided for @viewingProposedByYou.
  ///
  /// In en, this message translates to:
  /// **'You proposed'**
  String get viewingProposedByYou;

  /// No description provided for @viewingProposedByBuyer.
  ///
  /// In en, this message translates to:
  /// **'The buyer proposed'**
  String get viewingProposedByBuyer;

  /// No description provided for @viewingProposedBySeller.
  ///
  /// In en, this message translates to:
  /// **'The seller offered'**
  String get viewingProposedBySeller;

  /// No description provided for @viewingTimesOnTable.
  ///
  /// In en, this message translates to:
  /// **'Times on the table'**
  String get viewingTimesOnTable;

  /// No description provided for @viewingConfirmedFor.
  ///
  /// In en, this message translates to:
  /// **'Confirmed for {time}'**
  String viewingConfirmedFor(Object time);

  /// No description provided for @viewingRespondBy.
  ///
  /// In en, this message translates to:
  /// **'Reply by {time}'**
  String viewingRespondBy(Object time);

  /// No description provided for @viewingAcceptTime.
  ///
  /// In en, this message translates to:
  /// **'Accept this time'**
  String get viewingAcceptTime;

  /// No description provided for @viewingOfferOtherTimes.
  ///
  /// In en, this message translates to:
  /// **'Offer other times'**
  String get viewingOfferOtherTimes;

  /// No description provided for @viewingProposeAnotherTime.
  ///
  /// In en, this message translates to:
  /// **'Propose another time'**
  String get viewingProposeAnotherTime;

  /// No description provided for @viewingDeclineRequest.
  ///
  /// In en, this message translates to:
  /// **'Decline'**
  String get viewingDeclineRequest;

  /// No description provided for @viewingDeclineQuestion.
  ///
  /// In en, this message translates to:
  /// **'Decline this viewing?'**
  String get viewingDeclineQuestion;

  /// No description provided for @viewingDeclineConfirmMessage.
  ///
  /// In en, this message translates to:
  /// **'The buyer will be told you cannot show the car at these times.'**
  String get viewingDeclineConfirmMessage;

  /// No description provided for @viewingDeclinedMessage.
  ///
  /// In en, this message translates to:
  /// **'Viewing declined.'**
  String get viewingDeclinedMessage;

  /// No description provided for @viewingConfirmedMessage.
  ///
  /// In en, this message translates to:
  /// **'Viewing confirmed for {time}.'**
  String viewingConfirmedMessage(Object time);

  /// No description provided for @viewingTimesSent.
  ///
  /// In en, this message translates to:
  /// **'Your times were sent.'**
  String get viewingTimesSent;

  /// No description provided for @viewingActionFailed.
  ///
  /// In en, this message translates to:
  /// **'That could not be done right now. Try again.'**
  String get viewingActionFailed;

  /// No description provided for @viewingProposalExpiredNotice.
  ///
  /// In en, this message translates to:
  /// **'Nobody answered in time, so this proposal expired.'**
  String get viewingProposalExpiredNotice;

  /// No description provided for @viewingNoMoreCounters.
  ///
  /// In en, this message translates to:
  /// **'This has gone back and forth enough - accept a time, decline, or cancel.'**
  String get viewingNoMoreCounters;

  /// No description provided for @viewingClosedNotice.
  ///
  /// In en, this message translates to:
  /// **'This viewing is closed. Nothing on it can be changed.'**
  String get viewingClosedNotice;

  /// No description provided for @viewingHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'What has happened so far'**
  String get viewingHistoryTitle;

  /// No description provided for @viewingHistoryEntryLine.
  ///
  /// In en, this message translates to:
  /// **'{who} • {action} • {when}'**
  String viewingHistoryEntryLine(Object who, Object action, Object when);

  /// No description provided for @viewingActorYou.
  ///
  /// In en, this message translates to:
  /// **'You'**
  String get viewingActorYou;

  /// No description provided for @viewingActorBuyer.
  ///
  /// In en, this message translates to:
  /// **'The buyer'**
  String get viewingActorBuyer;

  /// No description provided for @viewingActorSeller.
  ///
  /// In en, this message translates to:
  /// **'The seller'**
  String get viewingActorSeller;

  /// No description provided for @viewingHistoryActionProposed.
  ///
  /// In en, this message translates to:
  /// **'proposal'**
  String get viewingHistoryActionProposed;

  /// No description provided for @viewingHistoryActionAccepted.
  ///
  /// In en, this message translates to:
  /// **'acceptance'**
  String get viewingHistoryActionAccepted;

  /// No description provided for @viewingHistoryActionDeclined.
  ///
  /// In en, this message translates to:
  /// **'decline'**
  String get viewingHistoryActionDeclined;

  /// No description provided for @viewingHistoryActionCancelled.
  ///
  /// In en, this message translates to:
  /// **'cancellation'**
  String get viewingHistoryActionCancelled;

  /// No description provided for @viewingProposalSheetTitleCustomer.
  ///
  /// In en, this message translates to:
  /// **'Propose a viewing time'**
  String get viewingProposalSheetTitleCustomer;

  /// No description provided for @viewingProposalSheetTitleBusiness.
  ///
  /// In en, this message translates to:
  /// **'Offer viewing times'**
  String get viewingProposalSheetTitleBusiness;

  /// No description provided for @viewingProposalSheetMessageCustomer.
  ///
  /// In en, this message translates to:
  /// **'Pick the time that suits you. The seller can accept it or offer other times.'**
  String get viewingProposalSheetMessageCustomer;

  /// No description provided for @viewingProposalSheetMessageBusiness.
  ///
  /// In en, this message translates to:
  /// **'Offer up to {count} times. The buyer picks one or comes back with another.'**
  String viewingProposalSheetMessageBusiness(Object count);

  /// No description provided for @viewingRescheduleNotice.
  ///
  /// In en, this message translates to:
  /// **'Proposing a new time reopens the conversation, so the agreed appointment stops being confirmed.'**
  String get viewingRescheduleNotice;

  /// No description provided for @viewingChooseTime.
  ///
  /// In en, this message translates to:
  /// **'Choose a viewing time.'**
  String get viewingChooseTime;

  /// No description provided for @viewingSlotsChosen.
  ///
  /// In en, this message translates to:
  /// **'{count} of {max} times chosen'**
  String viewingSlotsChosen(Object count, Object max);

  /// No description provided for @viewingSendProposal.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get viewingSendProposal;

  /// No description provided for @whatIsTheItem.
  ///
  /// In en, this message translates to:
  /// **'What is the item?'**
  String get whatIsTheItem;

  /// No description provided for @somethingElseInCategory.
  ///
  /// In en, this message translates to:
  /// **'Something else in this category'**
  String get somethingElseInCategory;

  /// No description provided for @whenDoYouPay.
  ///
  /// In en, this message translates to:
  /// **'When do you pay?'**
  String get whenDoYouPay;

  /// No description provided for @payNowOption.
  ///
  /// In en, this message translates to:
  /// **'Pay now'**
  String get payNowOption;

  /// No description provided for @payOnArrivalOption.
  ///
  /// In en, this message translates to:
  /// **'Pay when it arrives'**
  String get payOnArrivalOption;

  /// No description provided for @payOnArrivalExplainer.
  ///
  /// In en, this message translates to:
  /// **'Nothing is charged today. Your card is saved and verified now, and charged automatically when {business} marks your shipment arrived. If that charge doesn\'t go through, you\'ll be asked to complete payment in the app.'**
  String payOnArrivalExplainer(Object business);

  /// No description provided for @saveCardAndBook.
  ///
  /// In en, this message translates to:
  /// **'Save card & book'**
  String get saveCardAndBook;

  /// No description provided for @freightCategoryQuestion.
  ///
  /// In en, this message translates to:
  /// **'What\'s in the parcel?'**
  String get freightCategoryQuestion;

  /// No description provided for @freightCategoryHelp.
  ///
  /// In en, this message translates to:
  /// **'Businesses charge more for what costs more to replace.'**
  String get freightCategoryHelp;

  /// No description provided for @freightCategoryGeneral.
  ///
  /// In en, this message translates to:
  /// **'General goods'**
  String get freightCategoryGeneral;

  /// No description provided for @freightCategoryGeneralHint.
  ///
  /// In en, this message translates to:
  /// **'Household items, gifts, anything not listed below'**
  String get freightCategoryGeneralHint;

  /// No description provided for @freightCategoryClothing.
  ///
  /// In en, this message translates to:
  /// **'Clothes and fabric'**
  String get freightCategoryClothing;

  /// No description provided for @freightCategoryClothingHint.
  ///
  /// In en, this message translates to:
  /// **'Clothing, shoes, cloth, bedding'**
  String get freightCategoryClothingHint;

  /// No description provided for @freightCategoryFood.
  ///
  /// In en, this message translates to:
  /// **'Food'**
  String get freightCategoryFood;

  /// No description provided for @freightCategoryFoodHint.
  ///
  /// In en, this message translates to:
  /// **'Dry and packaged food only'**
  String get freightCategoryFoodHint;

  /// No description provided for @freightCategoryDocuments.
  ///
  /// In en, this message translates to:
  /// **'Documents'**
  String get freightCategoryDocuments;

  /// No description provided for @freightCategoryDocumentsHint.
  ///
  /// In en, this message translates to:
  /// **'Papers, certificates, printed matter'**
  String get freightCategoryDocumentsHint;

  /// No description provided for @freightCategoryCosmetics.
  ///
  /// In en, this message translates to:
  /// **'Cosmetics and liquids'**
  String get freightCategoryCosmetics;

  /// No description provided for @freightCategoryCosmeticsHint.
  ///
  /// In en, this message translates to:
  /// **'Creams, perfumes, hair products'**
  String get freightCategoryCosmeticsHint;

  /// No description provided for @freightCategoryElectronics.
  ///
  /// In en, this message translates to:
  /// **'Electronics'**
  String get freightCategoryElectronics;

  /// No description provided for @freightCategoryElectronicsHint.
  ///
  /// In en, this message translates to:
  /// **'Phones, laptops, tablets, chargers'**
  String get freightCategoryElectronicsHint;

  /// No description provided for @freightCategoryFragile.
  ///
  /// In en, this message translates to:
  /// **'Fragile items'**
  String get freightCategoryFragile;

  /// No description provided for @freightCategoryFragileHint.
  ///
  /// In en, this message translates to:
  /// **'Glass, ceramics, anything breakable'**
  String get freightCategoryFragileHint;

  /// No description provided for @freightCoverageNone.
  ///
  /// In en, this message translates to:
  /// **'No coverage'**
  String get freightCoverageNone;

  /// No description provided for @freightCoverageCoversLoss.
  ///
  /// In en, this message translates to:
  /// **'Covers loss'**
  String get freightCoverageCoversLoss;

  /// No description provided for @freightCoverageSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'If it goes missing'**
  String get freightCoverageSectionTitle;

  /// No description provided for @freightCoveragePaysForLoss.
  ///
  /// In en, this message translates to:
  /// **'{businessName} pays you back if this parcel is lost.'**
  String freightCoveragePaysForLoss(Object businessName);

  /// No description provided for @freightCoverageNoExtraCharge.
  ///
  /// In en, this message translates to:
  /// **'Included in the price, at no extra charge.'**
  String get freightCoverageNoExtraCharge;

  /// No description provided for @freightCoverageWhoPays.
  ///
  /// In en, this message translates to:
  /// **'Laawol records this agreement. {businessName} is the business that pays.'**
  String freightCoverageWhoPays(Object businessName);

  /// No description provided for @freightCoverageNotOffered.
  ///
  /// In en, this message translates to:
  /// **'{businessName} does not cover lost parcels. If this parcel goes missing, nothing is paid back.'**
  String freightCoverageNotOffered(Object businessName);

  /// No description provided for @freightDestinationDeliveryTitle.
  ///
  /// In en, this message translates to:
  /// **'How the receiver gets it'**
  String get freightDestinationDeliveryTitle;

  /// No description provided for @freightDestinationDeliveryCollect.
  ///
  /// In en, this message translates to:
  /// **'Receiver collects it'**
  String get freightDestinationDeliveryCollect;

  /// No description provided for @freightDestinationDeliveryCollectHelp.
  ///
  /// In en, this message translates to:
  /// **'They pick the parcel up from {businessName} at the destination.'**
  String freightDestinationDeliveryCollectHelp(Object businessName);

  /// No description provided for @freightDestinationDeliveryToAddress.
  ///
  /// In en, this message translates to:
  /// **'Deliver to their address · {amount}'**
  String freightDestinationDeliveryToAddress(Object amount);

  /// No description provided for @freightSetPriceTitle.
  ///
  /// In en, this message translates to:
  /// **'Price for this item'**
  String get freightSetPriceTitle;

  /// No description provided for @freightSetPriceLine.
  ///
  /// In en, this message translates to:
  /// **'{amount} set price'**
  String freightSetPriceLine(Object amount);

  /// No description provided for @freightSetPriceCoversUpTo.
  ///
  /// In en, this message translates to:
  /// **'Covers up to {kilograms} kg, then {rate} per kg over'**
  String freightSetPriceCoversUpTo(String kilograms, String rate);

  /// No description provided for @freightSetPriceCoversAnyWeight.
  ///
  /// In en, this message translates to:
  /// **'Covers this item whatever it weighs'**
  String get freightSetPriceCoversAnyWeight;

  /// No description provided for @freightSetPriceFinal.
  ///
  /// In en, this message translates to:
  /// **'This is the full price for this item.'**
  String get freightSetPriceFinal;

  /// No description provided for @freightAgreedPriceFinal.
  ///
  /// In en, this message translates to:
  /// **'This is the price you accepted for this parcel. Nothing is weighed and nothing is settled afterwards - what you pay today is the whole price.'**
  String get freightAgreedPriceFinal;

  /// No description provided for @freightSetPriceOverAllowanceNote.
  ///
  /// In en, this message translates to:
  /// **'The business weighs the parcel at drop-off and charges for any weight over what this price covers.'**
  String get freightSetPriceOverAllowanceNote;

  /// No description provided for @freightDestinationDeliveryFeeLabel.
  ///
  /// In en, this message translates to:
  /// **'Delivery at destination'**
  String get freightDestinationDeliveryFeeLabel;

  /// No description provided for @freightReceiverAddressLabel.
  ///
  /// In en, this message translates to:
  /// **'Receiver\'s address'**
  String get freightReceiverAddressLabel;

  /// No description provided for @freightReceiverAddressHint.
  ///
  /// In en, this message translates to:
  /// **'Neighbourhood, landmark, city'**
  String get freightReceiverAddressHint;

  /// No description provided for @freightReceiverAddressHelper.
  ///
  /// In en, this message translates to:
  /// **'Include the neighbourhood and a landmark nearby, so the driver can find it.'**
  String get freightReceiverAddressHelper;

  /// No description provided for @freightReceiverAddressRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the address where the parcel should be delivered.'**
  String get freightReceiverAddressRequired;

  /// No description provided for @freightReceiverAddressTooLong.
  ///
  /// In en, this message translates to:
  /// **'That address is too long. Keep it to the neighbourhood, a landmark and the city.'**
  String get freightReceiverAddressTooLong;

  /// No description provided for @outForDelivery.
  ///
  /// In en, this message translates to:
  /// **'Out for delivery'**
  String get outForDelivery;

  /// No description provided for @freightNextOutForDelivery.
  ///
  /// In en, this message translates to:
  /// **'Your parcel has arrived and is on its way to the receiver\'s address.'**
  String get freightNextOutForDelivery;

  /// No description provided for @pickupPlanTakingPickups.
  ///
  /// In en, this message translates to:
  /// **'Taking pickups: {services}.'**
  String pickupPlanTakingPickups(String services);

  /// No description provided for @pickupPlanNoPickups.
  ///
  /// In en, this message translates to:
  /// **'No service is taking pickups. Customers bring everything to you.'**
  String get pickupPlanNoPickups;

  /// No description provided for @pickupPlanBringToYou.
  ///
  /// In en, this message translates to:
  /// **'Customers bring these to you: {services}.'**
  String pickupPlanBringToYou(String services);

  /// No description provided for @pickupPlanSharedOffWarning.
  ///
  /// In en, this message translates to:
  /// **'No pickup: the shared plan above is off. Turn it on, or give this service its own fees.'**
  String get pickupPlanSharedOffWarning;

  /// No description provided for @pickupPlanOwnFeesNote.
  ///
  /// In en, this message translates to:
  /// **'Takes pickups on these fees, whether or not the shared plan is on.'**
  String get pickupPlanOwnFeesNote;

  /// No description provided for @freightDestinationDeliveryToAddressByArea.
  ///
  /// In en, this message translates to:
  /// **'Deliver to their address'**
  String get freightDestinationDeliveryToAddressByArea;

  /// No description provided for @freightDeliveryAreaLabel.
  ///
  /// In en, this message translates to:
  /// **'Where is it going?'**
  String get freightDeliveryAreaLabel;

  /// No description provided for @freightNoPriceForItemTitle.
  ///
  /// In en, this message translates to:
  /// **'No set price for this'**
  String get freightNoPriceForItemTitle;

  /// No description provided for @freightNoBusinessPricedItem.
  ///
  /// In en, this message translates to:
  /// **'No business shipping to {country} has set a price for this. Describe it and they can each answer with their own.'**
  String freightNoBusinessPricedItem(String country);

  /// No description provided for @freightBusinessHasNotPricedItem.
  ///
  /// In en, this message translates to:
  /// **'{business} has not set a price for this item. Ask, and it will answer with one.'**
  String freightBusinessHasNotPricedItem(String business);

  /// No description provided for @freightAskForPriceCta.
  ///
  /// In en, this message translates to:
  /// **'Ask for a price'**
  String get freightAskForPriceCta;

  /// No description provided for @freightAskForPriceTitle.
  ///
  /// In en, this message translates to:
  /// **'Ask for a price'**
  String get freightAskForPriceTitle;

  /// No description provided for @freightAskForPriceIntro.
  ///
  /// In en, this message translates to:
  /// **'Describe what you are sending to {country}. Every business on this route can answer with its own price and say whether it covers the parcel if it is lost.'**
  String freightAskForPriceIntro(String country);

  /// No description provided for @freightAskForPriceNote.
  ///
  /// In en, this message translates to:
  /// **'You are not committing to anything. You choose which price to take, or none of them.'**
  String get freightAskForPriceNote;

  /// No description provided for @freightWhatsInTheBox.
  ///
  /// In en, this message translates to:
  /// **'What\'s in the box?'**
  String get freightWhatsInTheBox;

  /// No description provided for @freightAddAnItem.
  ///
  /// In en, this message translates to:
  /// **'Add an item'**
  String get freightAddAnItem;

  /// No description provided for @freightItemNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Name the item'**
  String get freightItemNameLabel;

  /// No description provided for @freightOtherGoodsLabel.
  ///
  /// In en, this message translates to:
  /// **'Other goods, weighed (kg)'**
  String get freightOtherGoodsLabel;

  /// No description provided for @freightOtherGoodsHelper.
  ///
  /// In en, this message translates to:
  /// **'Everything not listed above, weighed together.'**
  String get freightOtherGoodsHelper;

  /// No description provided for @freightBoxEstimate.
  ///
  /// In en, this message translates to:
  /// **'Box estimate'**
  String get freightBoxEstimate;

  /// No description provided for @freightAnythingElseLabel.
  ///
  /// In en, this message translates to:
  /// **'Anything else the businesses should know?'**
  String get freightAnythingElseLabel;

  /// No description provided for @freightWhatElseInBox.
  ///
  /// In en, this message translates to:
  /// **'What else is in the box?'**
  String get freightWhatElseInBox;

  /// No description provided for @freightAddAnotherPricedItem.
  ///
  /// In en, this message translates to:
  /// **'Add another priced item'**
  String get freightAddAnotherPricedItem;

  /// No description provided for @freightPriceEach.
  ///
  /// In en, this message translates to:
  /// **'{price} each'**
  String freightPriceEach(String price);

  /// No description provided for @trackWithCode.
  ///
  /// In en, this message translates to:
  /// **'Track with a code'**
  String get trackWithCode;

  /// No description provided for @freightWeighedAtRateHelper.
  ///
  /// In en, this message translates to:
  /// **'Charged per kg once the business weighs the box.'**
  String get freightWeighedAtRateHelper;

  /// No description provided for @freightContentsTooMany.
  ///
  /// In en, this message translates to:
  /// **'List at most 10 kinds of item in one box.'**
  String get freightContentsTooMany;

  /// No description provided for @freightContentsLabelInvalid.
  ///
  /// In en, this message translates to:
  /// **'Name each item in under 60 characters.'**
  String get freightContentsLabelInvalid;

  /// No description provided for @freightContentsQuantityInvalid.
  ///
  /// In en, this message translates to:
  /// **'Item counts must be between 1 and 99.'**
  String get freightContentsQuantityInvalid;

  /// No description provided for @freightContentsCategoryInvalid.
  ///
  /// In en, this message translates to:
  /// **'Pick each item\'s category from the list.'**
  String get freightContentsCategoryInvalid;

  /// No description provided for @freightItemWeighedByBusiness.
  ///
  /// In en, this message translates to:
  /// **'{item} is weighed by this business. Include it in the weighed kilos instead.'**
  String freightItemWeighedByBusiness(String item);

  /// No description provided for @freightItemUnpricedByBusiness.
  ///
  /// In en, this message translates to:
  /// **'{item} has no price from this business. Ask for a price instead.'**
  String freightItemUnpricedByBusiness(String item);

  /// No description provided for @guestQuoteOneAnswer.
  ///
  /// In en, this message translates to:
  /// **'1 business has answered with a price.'**
  String get guestQuoteOneAnswer;

  /// No description provided for @guestQuoteManyAnswers.
  ///
  /// In en, this message translates to:
  /// **'{count} businesses have answered with a price.'**
  String guestQuoteManyAnswers(int count);

  /// No description provided for @guestQuoteSeeHint.
  ///
  /// In en, this message translates to:
  /// **'Enter the email you gave with this request to see the prices and choose one.'**
  String get guestQuoteSeeHint;

  /// No description provided for @guestQuoteNoAnswers.
  ///
  /// In en, this message translates to:
  /// **'No prices yet. Businesses have been asked, and answers usually arrive within a day. Enter the email you gave to open this request on this device.'**
  String get guestQuoteNoAnswers;

  /// No description provided for @guestQuoteEmailLabel.
  ///
  /// In en, this message translates to:
  /// **'The email you gave with the request'**
  String get guestQuoteEmailLabel;

  /// No description provided for @guestQuoteSeePrices.
  ///
  /// In en, this message translates to:
  /// **'See prices and choose'**
  String get guestQuoteSeePrices;

  /// No description provided for @guestQuoteOpenRequest.
  ///
  /// In en, this message translates to:
  /// **'Open my request'**
  String get guestQuoteOpenRequest;

  /// No description provided for @guestQuoteClaimFailed.
  ///
  /// In en, this message translates to:
  /// **'That did not work. Check the email and try again.'**
  String get guestQuoteClaimFailed;

  /// No description provided for @freightQuoteDescriptionLabel.
  ///
  /// In en, this message translates to:
  /// **'What are you sending?'**
  String get freightQuoteDescriptionLabel;

  /// No description provided for @freightQuoteDescriptionHint.
  ///
  /// In en, this message translates to:
  /// **'Two suitcases of clothes and a small microwave'**
  String get freightQuoteDescriptionHint;

  /// No description provided for @freightQuoteDescriptionRequired.
  ///
  /// In en, this message translates to:
  /// **'Describe what you are sending'**
  String get freightQuoteDescriptionRequired;

  /// No description provided for @freightQuoteWeightLabel.
  ///
  /// In en, this message translates to:
  /// **'Weight in kg'**
  String get freightQuoteWeightLabel;

  /// No description provided for @freightQuoteWeightHelper.
  ///
  /// In en, this message translates to:
  /// **'Optional. A weight helps a business answer faster.'**
  String get freightQuoteWeightHelper;

  /// No description provided for @freightQuoteSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Ask for a price'**
  String get freightQuoteSendRequest;

  /// No description provided for @freightQuoteSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get freightQuoteSending;

  /// No description provided for @freightQuoteRequestFailed.
  ///
  /// In en, this message translates to:
  /// **'Your request could not be sent. Try again.'**
  String get freightQuoteRequestFailed;

  /// No description provided for @freightQuotesTitle.
  ///
  /// In en, this message translates to:
  /// **'Prices for your parcel'**
  String get freightQuotesTitle;

  /// No description provided for @freightQuotesIntro.
  ///
  /// In en, this message translates to:
  /// **'Each price is one business\'s own. Choose the one you want to send with.'**
  String get freightQuotesIntro;

  /// No description provided for @freightQuoteRequestReference.
  ///
  /// In en, this message translates to:
  /// **'Request {code}'**
  String freightQuoteRequestReference(String code);

  /// No description provided for @freightQuoteAskedBusinesses.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 business can answer} other{{count} businesses can answer}}'**
  String freightQuoteAskedBusinesses(int count);

  /// No description provided for @waitingForFreightQuotes.
  ///
  /// In en, this message translates to:
  /// **'Waiting for prices'**
  String get waitingForFreightQuotes;

  /// No description provided for @waitingForFreightQuotesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'The businesses on this route can see your parcel now. Prices appear here as they answer.'**
  String get waitingForFreightQuotesSubtitle;

  /// No description provided for @freightQuoteCoversLoss.
  ///
  /// In en, this message translates to:
  /// **'{business} pays you back if this parcel is lost'**
  String freightQuoteCoversLoss(String business);

  /// No description provided for @freightQuoteDoesNotCoverLoss.
  ///
  /// In en, this message translates to:
  /// **'{business} does not cover lost parcels'**
  String freightQuoteDoesNotCoverLoss(String business);

  /// No description provided for @selectFreightQuote.
  ///
  /// In en, this message translates to:
  /// **'Choose this price'**
  String get selectFreightQuote;

  /// No description provided for @selectingFreightQuote.
  ///
  /// In en, this message translates to:
  /// **'Choosing…'**
  String get selectingFreightQuote;

  /// No description provided for @confirmFreightQuoteTitle.
  ///
  /// In en, this message translates to:
  /// **'Send with {business}?'**
  String confirmFreightQuoteTitle(String business);

  /// No description provided for @confirmFreightQuoteMessage.
  ///
  /// In en, this message translates to:
  /// **'{business} charges {price} to send this parcel.'**
  String confirmFreightQuoteMessage(String business, String price);

  /// No description provided for @couldNotSelectFreightQuote.
  ///
  /// In en, this message translates to:
  /// **'That price could not be chosen. Try again.'**
  String get couldNotSelectFreightQuote;

  /// No description provided for @couldNotLoadFreightQuotes.
  ///
  /// In en, this message translates to:
  /// **'Prices are not loading right now'**
  String get couldNotLoadFreightQuotes;

  /// No description provided for @freightQuoteChosenTitle.
  ///
  /// In en, this message translates to:
  /// **'Price chosen'**
  String get freightQuoteChosenTitle;

  /// No description provided for @freightQuoteChosenMessage.
  ///
  /// In en, this message translates to:
  /// **'{business} will send your parcel for {price}.'**
  String freightQuoteChosenMessage(String business, String price);

  /// No description provided for @guestCheckoutTitle.
  ///
  /// In en, this message translates to:
  /// **'Book without an account'**
  String get guestCheckoutTitle;

  /// No description provided for @guestCheckoutIntro.
  ///
  /// In en, this message translates to:
  /// **'We use these details to send your receipt and tracking number, and to reach you about this shipment.'**
  String get guestCheckoutIntro;

  /// No description provided for @guestCheckoutFullName.
  ///
  /// In en, this message translates to:
  /// **'Full name'**
  String get guestCheckoutFullName;

  /// No description provided for @guestCheckoutEmail.
  ///
  /// In en, this message translates to:
  /// **'Email address'**
  String get guestCheckoutEmail;

  /// No description provided for @guestCheckoutPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone number'**
  String get guestCheckoutPhone;

  /// No description provided for @guestCheckoutNameError.
  ///
  /// In en, this message translates to:
  /// **'Enter your full name'**
  String get guestCheckoutNameError;

  /// No description provided for @guestCheckoutEmailError.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address'**
  String get guestCheckoutEmailError;

  /// No description provided for @guestCheckoutPhoneError.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid phone number'**
  String get guestCheckoutPhoneError;

  /// No description provided for @guestCheckoutContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue as guest'**
  String get guestCheckoutContinue;

  /// No description provided for @guestCheckoutUseAccount.
  ///
  /// In en, this message translates to:
  /// **'Use a Laawol account instead'**
  String get guestCheckoutUseAccount;

  /// No description provided for @guestCheckoutFailed.
  ///
  /// In en, this message translates to:
  /// **'We could not continue. Check your connection and try again.'**
  String get guestCheckoutFailed;

  /// No description provided for @guestCheckoutNote.
  ///
  /// In en, this message translates to:
  /// **'Your tracking number arrives by email. Keep it to follow this booking.'**
  String get guestCheckoutNote;

  /// No description provided for @guestCheckoutChoiceTitle.
  ///
  /// In en, this message translates to:
  /// **'How would you like to continue?'**
  String get guestCheckoutChoiceTitle;

  /// No description provided for @freightQuoteRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Request sent'**
  String get freightQuoteRequestSent;

  /// No description provided for @freightQuoteRequestSentSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 business on this route has it and can answer with a price.} other{{count} businesses on this route have it and can answer with a price.}}'**
  String freightQuoteRequestSentSubtitle(int count);

  /// No description provided for @couldNotLoadFreightQuotesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Your request was sent and is safe. Prices will appear here as soon as the connection is back.'**
  String get couldNotLoadFreightQuotesSubtitle;

  /// No description provided for @continueToBooking.
  ///
  /// In en, this message translates to:
  /// **'Continue to booking'**
  String get continueToBooking;

  /// No description provided for @freightQuoteChosenNext.
  ///
  /// In en, this message translates to:
  /// **'Add the receiver, the address and how the parcel reaches the business. You pay at the end, at the price you accepted.'**
  String get freightQuoteChosenNext;

  /// No description provided for @orderTypePriceRequests.
  ///
  /// In en, this message translates to:
  /// **'Price requests'**
  String get orderTypePriceRequests;

  /// No description provided for @guestTrackingStageAwaitingPayment.
  ///
  /// In en, this message translates to:
  /// **'Waiting for payment'**
  String get guestTrackingStageAwaitingPayment;

  /// No description provided for @openingSecurePayment.
  ///
  /// In en, this message translates to:
  /// **'Opening secure payment...'**
  String get openingSecurePayment;

  /// No description provided for @checkoutResumeFailed.
  ///
  /// In en, this message translates to:
  /// **'That did not open. Try again in a moment.'**
  String get checkoutResumeFailed;

  /// No description provided for @noNotificationsYet.
  ///
  /// In en, this message translates to:
  /// **'No notifications yet'**
  String get noNotificationsYet;

  /// No description provided for @markAllNotificationsRead.
  ///
  /// In en, this message translates to:
  /// **'Mark all read'**
  String get markAllNotificationsRead;

  /// No description provided for @lotTabActivity.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get lotTabActivity;

  /// No description provided for @lotTabExpenses.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get lotTabExpenses;

  /// No description provided for @lotTabReports.
  ///
  /// In en, this message translates to:
  /// **'Reports'**
  String get lotTabReports;

  /// No description provided for @lotPreviousMonth.
  ///
  /// In en, this message translates to:
  /// **'Previous month'**
  String get lotPreviousMonth;

  /// No description provided for @lotNextMonth.
  ///
  /// In en, this message translates to:
  /// **'Next month'**
  String get lotNextMonth;

  /// No description provided for @lotMoreActions.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get lotMoreActions;

  /// No description provided for @lotRevenue.
  ///
  /// In en, this message translates to:
  /// **'Revenue'**
  String get lotRevenue;

  /// No description provided for @lotExpensesLabel.
  ///
  /// In en, this message translates to:
  /// **'Expenses'**
  String get lotExpensesLabel;

  /// No description provided for @lotNet.
  ///
  /// In en, this message translates to:
  /// **'Net'**
  String get lotNet;

  /// No description provided for @lotAwaitingPaymentBanner.
  ///
  /// In en, this message translates to:
  /// **'{amount} awaiting payment'**
  String lotAwaitingPaymentBanner(String amount);

  /// No description provided for @lotAwaitingPaymentNote.
  ///
  /// In en, this message translates to:
  /// **'Links sent that have not settled'**
  String get lotAwaitingPaymentNote;

  /// No description provided for @lotSearchHint.
  ///
  /// In en, this message translates to:
  /// **'VIN, customer, phone'**
  String get lotSearchHint;

  /// No description provided for @lotFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get lotFilterAll;

  /// No description provided for @lotFilterOneOff.
  ///
  /// In en, this message translates to:
  /// **'One-off'**
  String get lotFilterOneOff;

  /// No description provided for @lotRecordActivity.
  ///
  /// In en, this message translates to:
  /// **'Record activity'**
  String get lotRecordActivity;

  /// No description provided for @lotEditActivity.
  ///
  /// In en, this message translates to:
  /// **'Edit this activity'**
  String get lotEditActivity;

  /// No description provided for @lotNoActivityForMonth.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded in {month}.'**
  String lotNoActivityForMonth(String month);

  /// No description provided for @lotNoActivityHint.
  ///
  /// In en, this message translates to:
  /// **'Record the first job the lot billed for.'**
  String get lotNoActivityHint;

  /// No description provided for @lotNoSearchMatch.
  ///
  /// In en, this message translates to:
  /// **'No entry matches that search.'**
  String get lotNoSearchMatch;

  /// No description provided for @lotEntriesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 entry} other{{count} entries}}'**
  String lotEntriesCount(int count);

  /// No description provided for @lotPaidOnPlatform.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get lotPaidOnPlatform;

  /// No description provided for @lotPaidOutsideShort.
  ///
  /// In en, this message translates to:
  /// **'Paid outside'**
  String get lotPaidOutsideShort;

  /// No description provided for @lotAwaitingShort.
  ///
  /// In en, this message translates to:
  /// **'Awaiting'**
  String get lotAwaitingShort;

  /// No description provided for @lotCancelledStatus.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get lotCancelledStatus;

  /// No description provided for @lotVoidedStatus.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get lotVoidedStatus;

  /// No description provided for @lotChasePayment.
  ///
  /// In en, this message translates to:
  /// **'Chase payment'**
  String get lotChasePayment;

  /// No description provided for @lotSendLinkAgain.
  ///
  /// In en, this message translates to:
  /// **'Send the link again'**
  String get lotSendLinkAgain;

  /// No description provided for @lotRecordAsPaid.
  ///
  /// In en, this message translates to:
  /// **'Record as paid'**
  String get lotRecordAsPaid;

  /// No description provided for @lotLinkResent.
  ///
  /// In en, this message translates to:
  /// **'The link was sent again.'**
  String get lotLinkResent;

  /// No description provided for @lotVoid.
  ///
  /// In en, this message translates to:
  /// **'Void'**
  String get lotVoid;

  /// No description provided for @lotVoidTitle.
  ///
  /// In en, this message translates to:
  /// **'Void this entry'**
  String get lotVoidTitle;

  /// No description provided for @lotVoidExplain.
  ///
  /// In en, this message translates to:
  /// **'It stays on the record, struck through, and drops out of the totals. It is never deleted.'**
  String get lotVoidExplain;

  /// No description provided for @lotVoidReason.
  ///
  /// In en, this message translates to:
  /// **'Reason (optional)'**
  String get lotVoidReason;

  /// No description provided for @lotVoidDone.
  ///
  /// In en, this message translates to:
  /// **'Voided.'**
  String get lotVoidDone;

  /// No description provided for @lotHistory.
  ///
  /// In en, this message translates to:
  /// **'Change history'**
  String get lotHistory;

  /// No description provided for @lotNoHistory.
  ///
  /// In en, this message translates to:
  /// **'No changes yet.'**
  String get lotNoHistory;

  /// No description provided for @lotParkingMarkNotPaid.
  ///
  /// In en, this message translates to:
  /// **'Mark as not paid'**
  String get lotParkingMarkNotPaid;

  /// No description provided for @lotParkingMarkedNotPaid.
  ///
  /// In en, this message translates to:
  /// **'Set back to not paid.'**
  String get lotParkingMarkedNotPaid;

  /// No description provided for @lotParkingMarkNotPaidConfirm.
  ///
  /// In en, this message translates to:
  /// **'Set this car back to not paid? Every payment recorded on it is removed. The change is kept in its history.'**
  String get lotParkingMarkNotPaidConfirm;

  /// No description provided for @lotParkingHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Change history'**
  String get lotParkingHistoryTitle;

  /// No description provided for @lotWhatWasDone.
  ///
  /// In en, this message translates to:
  /// **'What was done'**
  String get lotWhatWasDone;

  /// No description provided for @lotChooseActivity.
  ///
  /// In en, this message translates to:
  /// **'Choose an activity'**
  String get lotChooseActivity;

  /// No description provided for @lotOneOffOption.
  ///
  /// In en, this message translates to:
  /// **'Something else — one-off'**
  String get lotOneOffOption;

  /// No description provided for @lotSayWhatWasDone.
  ///
  /// In en, this message translates to:
  /// **'Say what was done'**
  String get lotSayWhatWasDone;

  /// No description provided for @lotFee.
  ///
  /// In en, this message translates to:
  /// **'Fee'**
  String get lotFee;

  /// No description provided for @lotDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get lotDate;

  /// No description provided for @lotVin.
  ///
  /// In en, this message translates to:
  /// **'VIN'**
  String get lotVin;

  /// No description provided for @lotVinHint.
  ///
  /// In en, this message translates to:
  /// **'17 characters'**
  String get lotVinHint;

  /// No description provided for @lotCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get lotCustomer;

  /// No description provided for @lotPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone'**
  String get lotPhone;

  /// No description provided for @lotEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get lotEmail;

  /// No description provided for @lotMake.
  ///
  /// In en, this message translates to:
  /// **'Make'**
  String get lotMake;

  /// No description provided for @lotModel.
  ///
  /// In en, this message translates to:
  /// **'Model'**
  String get lotModel;

  /// No description provided for @lotYearField.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get lotYearField;

  /// No description provided for @lotAuctionHouse.
  ///
  /// In en, this message translates to:
  /// **'Auction house'**
  String get lotAuctionHouse;

  /// No description provided for @lotHowItGetsPaid.
  ///
  /// In en, this message translates to:
  /// **'How it gets paid'**
  String get lotHowItGetsPaid;

  /// No description provided for @lotChargeThroughWebsite.
  ///
  /// In en, this message translates to:
  /// **'Charge through the website'**
  String get lotChargeThroughWebsite;

  /// No description provided for @lotChargeThroughWebsiteNote.
  ///
  /// In en, this message translates to:
  /// **'A payment link goes to the customer and the money lands in your account.'**
  String get lotChargeThroughWebsiteNote;

  /// No description provided for @lotPaidOutsideWebsite.
  ///
  /// In en, this message translates to:
  /// **'Paid outside the website'**
  String get lotPaidOutsideWebsite;

  /// No description provided for @lotPaidOutsideWebsiteNote.
  ///
  /// In en, this message translates to:
  /// **'Cash, Zelle, a check.'**
  String get lotPaidOutsideWebsiteNote;

  /// No description provided for @lotMarkNotReceived.
  ///
  /// In en, this message translates to:
  /// **'Mark as not received'**
  String get lotMarkNotReceived;

  /// No description provided for @lotMarkNotReceivedTitle.
  ///
  /// In en, this message translates to:
  /// **'Set back to not received'**
  String get lotMarkNotReceivedTitle;

  /// No description provided for @lotMarkNotReceivedExplain.
  ///
  /// In en, this message translates to:
  /// **'Use this if the money did not actually come in. The activity goes back to owed, and the change is logged under your name in the history.'**
  String get lotMarkNotReceivedExplain;

  /// No description provided for @lotMarkNotReceivedNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get lotMarkNotReceivedNote;

  /// No description provided for @lotMarkNotReceivedDone.
  ///
  /// In en, this message translates to:
  /// **'Set back to not received.'**
  String get lotMarkNotReceivedDone;

  /// No description provided for @lotMoneyReceived.
  ///
  /// In en, this message translates to:
  /// **'The money has been received'**
  String get lotMoneyReceived;

  /// No description provided for @lotMoneyReceivedNote.
  ///
  /// In en, this message translates to:
  /// **'Record how it was paid and who took it.'**
  String get lotMoneyReceivedNote;

  /// No description provided for @lotLoggedAsOwed.
  ///
  /// In en, this message translates to:
  /// **'Not paid yet — logged as owed. Mark it received when the money comes in.'**
  String get lotLoggedAsOwed;

  /// No description provided for @lotLinkGoesByTextAndEmail.
  ///
  /// In en, this message translates to:
  /// **'The link goes by text and email.'**
  String get lotLinkGoesByTextAndEmail;

  /// No description provided for @lotHowItWasPaid.
  ///
  /// In en, this message translates to:
  /// **'How it was paid'**
  String get lotHowItWasPaid;

  /// No description provided for @lotReceivedBy.
  ///
  /// In en, this message translates to:
  /// **'Received by'**
  String get lotReceivedBy;

  /// No description provided for @lotActivityRecorded.
  ///
  /// In en, this message translates to:
  /// **'Activity recorded.'**
  String get lotActivityRecorded;

  /// No description provided for @lotActivityUpdated.
  ///
  /// In en, this message translates to:
  /// **'Activity updated.'**
  String get lotActivityUpdated;

  /// No description provided for @lotSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get lotSave;

  /// No description provided for @lotSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get lotSaving;

  /// No description provided for @lotCancelAction.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get lotCancelAction;

  /// No description provided for @lotDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get lotDone;

  /// No description provided for @lotViaCash.
  ///
  /// In en, this message translates to:
  /// **'Cash'**
  String get lotViaCash;

  /// No description provided for @lotViaZelle.
  ///
  /// In en, this message translates to:
  /// **'Zelle'**
  String get lotViaZelle;

  /// No description provided for @lotViaCashApp.
  ///
  /// In en, this message translates to:
  /// **'Cash App'**
  String get lotViaCashApp;

  /// No description provided for @lotViaVenmo.
  ///
  /// In en, this message translates to:
  /// **'Venmo'**
  String get lotViaVenmo;

  /// No description provided for @lotViaCheck.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get lotViaCheck;

  /// No description provided for @lotViaCardInPerson.
  ///
  /// In en, this message translates to:
  /// **'Card in person'**
  String get lotViaCardInPerson;

  /// No description provided for @lotViaOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get lotViaOther;

  /// No description provided for @lotExpenseLinesTitle.
  ///
  /// In en, this message translates to:
  /// **'Expense lines'**
  String get lotExpenseLinesTitle;

  /// No description provided for @lotAddExpenseLine.
  ///
  /// In en, this message translates to:
  /// **'Add expense line'**
  String get lotAddExpenseLine;

  /// No description provided for @lotAddPurchase.
  ///
  /// In en, this message translates to:
  /// **'Add purchase'**
  String get lotAddPurchase;

  /// No description provided for @lotPurchaseAdded.
  ///
  /// In en, this message translates to:
  /// **'Purchase added.'**
  String get lotPurchaseAdded;

  /// No description provided for @lotPurchaseUpdated.
  ///
  /// In en, this message translates to:
  /// **'Purchase updated.'**
  String get lotPurchaseUpdated;

  /// No description provided for @lotEditPurchase.
  ///
  /// In en, this message translates to:
  /// **'Edit purchase'**
  String get lotEditPurchase;

  /// No description provided for @lotSaveChanges.
  ///
  /// In en, this message translates to:
  /// **'Save changes'**
  String get lotSaveChanges;

  /// No description provided for @lotEditingPurchase.
  ///
  /// In en, this message translates to:
  /// **'Editing a purchase'**
  String get lotEditingPurchase;

  /// No description provided for @lotCancelEdit.
  ///
  /// In en, this message translates to:
  /// **'Cancel'**
  String get lotCancelEdit;

  /// No description provided for @lotEditExpenseLine.
  ///
  /// In en, this message translates to:
  /// **'Edit expense line'**
  String get lotEditExpenseLine;

  /// No description provided for @lotEditLine.
  ///
  /// In en, this message translates to:
  /// **'Edit line'**
  String get lotEditLine;

  /// No description provided for @lotExpenseLineSaved.
  ///
  /// In en, this message translates to:
  /// **'Expense line saved.'**
  String get lotExpenseLineSaved;

  /// No description provided for @lotSameEveryMonth.
  ///
  /// In en, this message translates to:
  /// **'Same every month'**
  String get lotSameEveryMonth;

  /// No description provided for @lotChangesEveryMonth.
  ///
  /// In en, this message translates to:
  /// **'Changes every month'**
  String get lotChangesEveryMonth;

  /// No description provided for @lotEveryMonth.
  ///
  /// In en, this message translates to:
  /// **'{amount} every month'**
  String lotEveryMonth(String amount);

  /// No description provided for @lotWaitingOnBill.
  ///
  /// In en, this message translates to:
  /// **'Waiting on this month\'s bill'**
  String get lotWaitingOnBill;

  /// No description provided for @lotPurchasesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 purchase} other{{count} purchases}}'**
  String lotPurchasesCount(int count);

  /// No description provided for @lotNoExpenseLines.
  ///
  /// In en, this message translates to:
  /// **'No expense lines yet.'**
  String get lotNoExpenseLines;

  /// No description provided for @lotNoExpenseLinesHint.
  ///
  /// In en, this message translates to:
  /// **'Add what the lot pays for — rent, water, moving.'**
  String get lotNoExpenseLinesHint;

  /// No description provided for @lotProofRequiredFrom.
  ///
  /// In en, this message translates to:
  /// **'Receipt required from {amount} and above.'**
  String lotProofRequiredFrom(String amount);

  /// No description provided for @lotAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get lotAmount;

  /// No description provided for @lotPaidBy.
  ///
  /// In en, this message translates to:
  /// **'Paid by'**
  String get lotPaidBy;

  /// No description provided for @lotNote.
  ///
  /// In en, this message translates to:
  /// **'Note'**
  String get lotNote;

  /// No description provided for @lotReceipt.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get lotReceipt;

  /// No description provided for @lotAttachReceipt.
  ///
  /// In en, this message translates to:
  /// **'Attach a receipt'**
  String get lotAttachReceipt;

  /// No description provided for @lotReceiptAttached.
  ///
  /// In en, this message translates to:
  /// **'Receipt attached'**
  String get lotReceiptAttached;

  /// No description provided for @lotUploadingReceipt.
  ///
  /// In en, this message translates to:
  /// **'Uploading the receipt…'**
  String get lotUploadingReceipt;

  /// No description provided for @lotNoPurchasesForMonth.
  ///
  /// In en, this message translates to:
  /// **'No purchases logged for {month}.'**
  String lotNoPurchasesForMonth(String month);

  /// No description provided for @lotExpenseName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get lotExpenseName;

  /// No description provided for @lotExpenseSupplier.
  ///
  /// In en, this message translates to:
  /// **'Supplier or detail'**
  String get lotExpenseSupplier;

  /// No description provided for @lotHowItBehaves.
  ///
  /// In en, this message translates to:
  /// **'How it behaves'**
  String get lotHowItBehaves;

  /// No description provided for @lotMonthlyAmount.
  ///
  /// In en, this message translates to:
  /// **'Monthly amount'**
  String get lotMonthlyAmount;

  /// No description provided for @lotRevenueForYear.
  ///
  /// In en, this message translates to:
  /// **'Revenue {year}'**
  String lotRevenueForYear(String year);

  /// No description provided for @lotExpensesForYear.
  ///
  /// In en, this message translates to:
  /// **'Expenses {year}'**
  String lotExpensesForYear(String year);

  /// No description provided for @lotNetProfit.
  ///
  /// In en, this message translates to:
  /// **'Net profit'**
  String get lotNetProfit;

  /// No description provided for @lotParkingIncomeForYear.
  ///
  /// In en, this message translates to:
  /// **'Parked-car income {year}'**
  String lotParkingIncomeForYear(String year);

  /// No description provided for @lotParkingCollectedInYear.
  ///
  /// In en, this message translates to:
  /// **'Collected in {year}'**
  String lotParkingCollectedInYear(String year);

  /// No description provided for @lotLegendParkedCars.
  ///
  /// In en, this message translates to:
  /// **'Parked cars'**
  String get lotLegendParkedCars;

  /// No description provided for @lotMargin.
  ///
  /// In en, this message translates to:
  /// **'Margin'**
  String get lotMargin;

  /// No description provided for @lotParkingIncome.
  ///
  /// In en, this message translates to:
  /// **'Parked-car income'**
  String get lotParkingIncome;

  /// No description provided for @lotParkingIncomeNote.
  ///
  /// In en, this message translates to:
  /// **'Paid, still to come, and past due. Current standing.'**
  String get lotParkingIncomeNote;

  /// No description provided for @lotParkingInLot.
  ///
  /// In en, this message translates to:
  /// **'In the lot'**
  String get lotParkingInLot;

  /// No description provided for @lotParkingGenerated.
  ///
  /// In en, this message translates to:
  /// **'Generated so far'**
  String get lotParkingGenerated;

  /// No description provided for @lotParkingCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get lotParkingCollected;

  /// No description provided for @lotParkingCollectedNote.
  ///
  /// In en, this message translates to:
  /// **'Already paid'**
  String get lotParkingCollectedNote;

  /// No description provided for @lotParkingOwed.
  ///
  /// In en, this message translates to:
  /// **'Still owed'**
  String get lotParkingOwed;

  /// No description provided for @lotParkingOwedNote.
  ///
  /// In en, this message translates to:
  /// **'Money yet to come'**
  String get lotParkingOwedNote;

  /// No description provided for @lotParkingOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get lotParkingOverdue;

  /// No description provided for @lotParkingOverdueCars.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 car past the end date, still owing} other{{count} cars past the end date, still owing}}'**
  String lotParkingOverdueCars(int count);

  /// No description provided for @lotActivityGenerated.
  ///
  /// In en, this message translates to:
  /// **'Generated so far'**
  String get lotActivityGenerated;

  /// No description provided for @lotActivityCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get lotActivityCollected;

  /// No description provided for @lotActivityAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Awaiting'**
  String get lotActivityAwaiting;

  /// No description provided for @lotActivityJobs.
  ///
  /// In en, this message translates to:
  /// **'Jobs'**
  String get lotActivityJobs;

  /// No description provided for @lotActivityOwed.
  ///
  /// In en, this message translates to:
  /// **'Owed'**
  String get lotActivityOwed;

  /// No description provided for @lotRangeThisMonth.
  ///
  /// In en, this message translates to:
  /// **'This month'**
  String get lotRangeThisMonth;

  /// No description provided for @lotRangeLast3Months.
  ///
  /// In en, this message translates to:
  /// **'Last 3 months'**
  String get lotRangeLast3Months;

  /// No description provided for @lotRangeCustom.
  ///
  /// In en, this message translates to:
  /// **'Custom'**
  String get lotRangeCustom;

  /// No description provided for @lotRangeFrom.
  ///
  /// In en, this message translates to:
  /// **'From month'**
  String get lotRangeFrom;

  /// No description provided for @lotRangeTo.
  ///
  /// In en, this message translates to:
  /// **'To month'**
  String get lotRangeTo;

  /// No description provided for @lotPayAll.
  ///
  /// In en, this message translates to:
  /// **'All money'**
  String get lotPayAll;

  /// No description provided for @lotPayOwed.
  ///
  /// In en, this message translates to:
  /// **'Owed'**
  String get lotPayOwed;

  /// No description provided for @lotPayCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get lotPayCollected;

  /// No description provided for @lotRevenueSources.
  ///
  /// In en, this message translates to:
  /// **'Where the revenue comes from'**
  String get lotRevenueSources;

  /// No description provided for @lotRevenueSourcesNote.
  ///
  /// In en, this message translates to:
  /// **'Activities this year, plus car parking generated to date.'**
  String get lotRevenueSourcesNote;

  /// No description provided for @lotRevenueCarParking.
  ///
  /// In en, this message translates to:
  /// **'Car parking'**
  String get lotRevenueCarParking;

  /// No description provided for @lotRevenueOneOff.
  ///
  /// In en, this message translates to:
  /// **'One-off jobs'**
  String get lotRevenueOneOff;

  /// No description provided for @lotRevenueTotal.
  ///
  /// In en, this message translates to:
  /// **'Total revenue'**
  String get lotRevenueTotal;

  /// No description provided for @lotNoRevenueYear.
  ///
  /// In en, this message translates to:
  /// **'No revenue recorded in {year} yet.'**
  String lotNoRevenueYear(String year);

  /// No description provided for @lotMonthByMonth.
  ///
  /// In en, this message translates to:
  /// **'Month by month'**
  String get lotMonthByMonth;

  /// No description provided for @lotErrActivityType.
  ///
  /// In en, this message translates to:
  /// **'Choose what was done.'**
  String get lotErrActivityType;

  /// No description provided for @lotErrCustomLabel.
  ///
  /// In en, this message translates to:
  /// **'Say what was done.'**
  String get lotErrCustomLabel;

  /// No description provided for @lotErrFee.
  ///
  /// In en, this message translates to:
  /// **'Enter the fee charged.'**
  String get lotErrFee;

  /// No description provided for @lotErrCustomerName.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer\'s name.'**
  String get lotErrCustomerName;

  /// No description provided for @lotErrVin.
  ///
  /// In en, this message translates to:
  /// **'Enter the VIN.'**
  String get lotErrVin;

  /// No description provided for @lotErrLinkContact.
  ///
  /// In en, this message translates to:
  /// **'A payment link needs a phone number or an email address.'**
  String get lotErrLinkContact;

  /// No description provided for @lotErrReceivedBy.
  ///
  /// In en, this message translates to:
  /// **'Say which staff member took the payment.'**
  String get lotErrReceivedBy;

  /// No description provided for @lotErrExpenseAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter what was spent.'**
  String get lotErrExpenseAmount;

  /// No description provided for @lotErrExpensePaidBy.
  ///
  /// In en, this message translates to:
  /// **'Say who paid for it.'**
  String get lotErrExpensePaidBy;

  /// No description provided for @lotErrExpenseProof.
  ///
  /// In en, this message translates to:
  /// **'Attach a receipt: this business asks for proof at {amount} and above.'**
  String lotErrExpenseProof(String amount);

  /// No description provided for @lotCouldNotSave.
  ///
  /// In en, this message translates to:
  /// **'Could not save it. Try again.'**
  String get lotCouldNotSave;

  /// No description provided for @lotWhereTheMoneyGoes.
  ///
  /// In en, this message translates to:
  /// **'Where the money goes'**
  String get lotWhereTheMoneyGoes;

  /// No description provided for @lotOtherExpense.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get lotOtherExpense;

  /// No description provided for @lotNothingSpentYear.
  ///
  /// In en, this message translates to:
  /// **'Nothing spent in {year}.'**
  String lotNothingSpentYear(String year);

  /// No description provided for @lotShareUnderOnePercent.
  ///
  /// In en, this message translates to:
  /// **'<1%'**
  String get lotShareUnderOnePercent;

  /// No description provided for @lotVinMatchedExisting.
  ///
  /// In en, this message translates to:
  /// **'Filled in from a vehicle you already have.'**
  String get lotVinMatchedExisting;

  /// No description provided for @lotDecodingVin.
  ///
  /// In en, this message translates to:
  /// **'Reading the VIN…'**
  String get lotDecodingVin;

  /// No description provided for @lotLedgerSubtitle.
  ///
  /// In en, this message translates to:
  /// **'What the lot earned and spent.'**
  String get lotLedgerSubtitle;

  /// No description provided for @businessTransportRowSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Requests to quote, and jobs to move.'**
  String get businessTransportRowSubtitle;

  /// No description provided for @parkingWalkInsOnly.
  ///
  /// In en, this message translates to:
  /// **'Walk-ins only'**
  String get parkingWalkInsOnly;

  /// No description provided for @parkingWalkInsOnlyNote.
  ///
  /// In en, this message translates to:
  /// **'This lot takes walk-ins only — contact them to arrange parking.'**
  String get parkingWalkInsOnlyNote;

  /// No description provided for @parkingAcceptReservations.
  ///
  /// In en, this message translates to:
  /// **'Accept online reservations from customers'**
  String get parkingAcceptReservations;

  /// No description provided for @parkingAcceptReservationsHelp.
  ///
  /// In en, this message translates to:
  /// **'Off makes this a walk-in-only lot: it still shows in customer search so people can find and contact you, but they can\'t book or pay online — you record every car yourself.'**
  String get parkingAcceptReservationsHelp;

  /// No description provided for @parkingScoreInLot.
  ///
  /// In en, this message translates to:
  /// **'In the lot'**
  String get parkingScoreInLot;

  /// No description provided for @parkingKindReserved.
  ///
  /// In en, this message translates to:
  /// **'Reserved'**
  String get parkingKindReserved;

  /// No description provided for @parkingKindPending.
  ///
  /// In en, this message translates to:
  /// **'Pending payment'**
  String get parkingKindPending;

  /// No description provided for @parkingKindCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get parkingKindCancelled;

  /// No description provided for @parkingPayPart.
  ///
  /// In en, this message translates to:
  /// **'Part paid'**
  String get parkingPayPart;

  /// No description provided for @parkingFiltersClear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get parkingFiltersClear;

  /// No description provided for @parkingScoreLeft.
  ///
  /// In en, this message translates to:
  /// **'Left'**
  String get parkingScoreLeft;

  /// No description provided for @parkingScoreCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get parkingScoreCollected;

  /// No description provided for @parkingScoreOwed.
  ///
  /// In en, this message translates to:
  /// **'Owed'**
  String get parkingScoreOwed;

  /// No description provided for @parkingScoreSpaces.
  ///
  /// In en, this message translates to:
  /// **'Spaces'**
  String get parkingScoreSpaces;

  /// No description provided for @parkingNotPaidYet.
  ///
  /// In en, this message translates to:
  /// **'They have not paid yet'**
  String get parkingNotPaidYet;

  /// No description provided for @parkingAlreadyPaid.
  ///
  /// In en, this message translates to:
  /// **'They have already paid'**
  String get parkingAlreadyPaid;

  /// No description provided for @parkingPaidPartOfIt.
  ///
  /// In en, this message translates to:
  /// **'They paid part of it'**
  String get parkingPaidPartOfIt;

  /// No description provided for @parkingAlreadyPaidInFull.
  ///
  /// In en, this message translates to:
  /// **'They have already paid in full'**
  String get parkingAlreadyPaidInFull;

  /// No description provided for @parkingHowMuchDidTheyPay.
  ///
  /// In en, this message translates to:
  /// **'How much did they pay?'**
  String get parkingHowMuchDidTheyPay;

  /// No description provided for @parkingSayWhoReceived.
  ///
  /// In en, this message translates to:
  /// **'Say who took the money so it can be reconciled.'**
  String get parkingSayWhoReceived;

  /// No description provided for @parkingEnterDaysPaid.
  ///
  /// In en, this message translates to:
  /// **'Enter how many days they paid for.'**
  String get parkingEnterDaysPaid;

  /// No description provided for @parkingEnterAmountPaid.
  ///
  /// In en, this message translates to:
  /// **'Enter how much they paid.'**
  String get parkingEnterAmountPaid;

  /// No description provided for @parkingHowDidTheyPay.
  ///
  /// In en, this message translates to:
  /// **'How did they pay?'**
  String get parkingHowDidTheyPay;

  /// No description provided for @directPaymentSettledExplainer.
  ///
  /// In en, this message translates to:
  /// **'We take no cut. The car is recorded and settled in one go - this cannot be undone here.'**
  String get directPaymentSettledExplainer;

  /// No description provided for @directPaymentPartPaidExplainer.
  ///
  /// In en, this message translates to:
  /// **'We take no cut. The car is recorded, the part payment is taken, and the rest stays owed.'**
  String get directPaymentPartPaidExplainer;

  /// No description provided for @parkingRecordedAndPaid.
  ///
  /// In en, this message translates to:
  /// **'Recorded, and marked as paid.'**
  String get parkingRecordedAndPaid;

  /// No description provided for @parkingRecordedAndPartPaid.
  ///
  /// In en, this message translates to:
  /// **'Recorded, and the part payment was taken.'**
  String get parkingRecordedAndPartPaid;

  /// No description provided for @parkingRecordedNotSettled.
  ///
  /// In en, this message translates to:
  /// **'The car was recorded, but marking it paid failed. Mark the payment received on the record.'**
  String get parkingRecordedNotSettled;

  /// No description provided for @parkingRecordedNotPartPaid.
  ///
  /// In en, this message translates to:
  /// **'The car was recorded, but the part payment failed. Record it on the car.'**
  String get parkingRecordedNotPartPaid;

  /// No description provided for @parkingPriceLabel.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get parkingPriceLabel;

  /// No description provided for @parkingState.
  ///
  /// In en, this message translates to:
  /// **'State'**
  String get parkingState;

  /// No description provided for @parkingPlacesNearby.
  ///
  /// In en, this message translates to:
  /// **'{count} places to park'**
  String parkingPlacesNearby(int count);

  /// No description provided for @parkingRecordPartPayment.
  ///
  /// In en, this message translates to:
  /// **'Record a part payment'**
  String get parkingRecordPartPayment;

  /// No description provided for @parkingPaidSoFar.
  ///
  /// In en, this message translates to:
  /// **'Paid so far: {amount}'**
  String parkingPaidSoFar(String amount);

  /// No description provided for @parkingDays.
  ///
  /// In en, this message translates to:
  /// **'Days'**
  String get parkingDays;

  /// No description provided for @parkingAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount (\$)'**
  String get parkingAmount;

  /// No description provided for @parkingDaysPaid.
  ///
  /// In en, this message translates to:
  /// **'Days paid'**
  String get parkingDaysPaid;

  /// No description provided for @parkingAmountPaid.
  ///
  /// In en, this message translates to:
  /// **'Amount paid (\$)'**
  String get parkingAmountPaid;

  /// No description provided for @parkingRecordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record payment'**
  String get parkingRecordPayment;

  /// No description provided for @parkingPartPaymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'Part payment recorded.'**
  String get parkingPartPaymentRecorded;

  /// No description provided for @parkingEnterDaysOrAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter the days or the amount paid.'**
  String get parkingEnterDaysOrAmount;

  /// No description provided for @parkingReceivedBy.
  ///
  /// In en, this message translates to:
  /// **'Received by'**
  String get parkingReceivedBy;

  /// No description provided for @parkingRegisteredBy.
  ///
  /// In en, this message translates to:
  /// **'Registered by'**
  String get parkingRegisteredBy;

  /// No description provided for @parkingLeaves.
  ///
  /// In en, this message translates to:
  /// **'Leaves'**
  String get parkingLeaves;

  /// No description provided for @parkingBilledThrough.
  ///
  /// In en, this message translates to:
  /// **'Billed through'**
  String get parkingBilledThrough;

  /// No description provided for @parkingNothingBilledYet.
  ///
  /// In en, this message translates to:
  /// **'Nothing yet'**
  String get parkingNothingBilledYet;

  /// No description provided for @parkingUnbilled.
  ///
  /// In en, this message translates to:
  /// **'Unbilled'**
  String get parkingUnbilled;

  /// No description provided for @parkingUnbilledDays.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}}'**
  String parkingUnbilledDays(int count);

  /// No description provided for @parkingAccrualPricedNote.
  ///
  /// In en, this message translates to:
  /// **'Priced for its leave date when it was recorded, so nothing accrues day by day.'**
  String get parkingAccrualPricedNote;

  /// No description provided for @parkingAccrualSinceNote.
  ///
  /// In en, this message translates to:
  /// **'Accruing since {date}. Bill it whenever you like — the car stays in place.'**
  String parkingAccrualSinceNote(String date);

  /// No description provided for @parkingAccrualFirstBillNote.
  ///
  /// In en, this message translates to:
  /// **'Nothing billed yet. Bill it through today to send the first link.'**
  String get parkingAccrualFirstBillNote;

  /// No description provided for @parkingAccrualCaughtUpNote.
  ///
  /// In en, this message translates to:
  /// **'Everything up to today has been billed.'**
  String get parkingAccrualCaughtUpNote;

  /// No description provided for @parkingBillThroughToday.
  ///
  /// In en, this message translates to:
  /// **'Bill {amount} through today'**
  String parkingBillThroughToday(String amount);

  /// No description provided for @parkingNothingToBill.
  ///
  /// In en, this message translates to:
  /// **'Nothing to bill'**
  String get parkingNothingToBill;

  /// No description provided for @parkingBillLinkSent.
  ///
  /// In en, this message translates to:
  /// **'Payment link sent.'**
  String get parkingBillLinkSent;

  /// No description provided for @parkingBillCouldNotBeSent.
  ///
  /// In en, this message translates to:
  /// **'The payment link could not be sent.'**
  String get parkingBillCouldNotBeSent;

  /// No description provided for @parkingPaymentReceivedInPerson.
  ///
  /// In en, this message translates to:
  /// **'Payment received in person'**
  String get parkingPaymentReceivedInPerson;

  /// No description provided for @parkingRecordedAsReceived.
  ///
  /// In en, this message translates to:
  /// **'Recorded as received.'**
  String get parkingRecordedAsReceived;

  /// No description provided for @parkingCarLeftToday.
  ///
  /// In en, this message translates to:
  /// **'Car left today'**
  String get parkingCarLeftToday;

  /// No description provided for @parkingCarLeftTodayExplain.
  ///
  /// In en, this message translates to:
  /// **'This stamps today as the leave date and stops the daily charge. Anything still owed stays owed.'**
  String get parkingCarLeftTodayExplain;

  /// No description provided for @parkingStayClosed.
  ///
  /// In en, this message translates to:
  /// **'Stay closed.'**
  String get parkingStayClosed;

  /// No description provided for @parkingStayCouldNotBeClosed.
  ///
  /// In en, this message translates to:
  /// **'The stay could not be closed.'**
  String get parkingStayCouldNotBeClosed;

  /// No description provided for @parkingMarkFullyPaid.
  ///
  /// In en, this message translates to:
  /// **'Mark as fully paid ({amount})'**
  String parkingMarkFullyPaid(String amount);

  /// No description provided for @parkingMarkedFullyPaid.
  ///
  /// In en, this message translates to:
  /// **'Marked as paid.'**
  String get parkingMarkedFullyPaid;

  /// No description provided for @parkingNothingOutstanding.
  ///
  /// In en, this message translates to:
  /// **'Nothing is outstanding on this car.'**
  String get parkingNothingOutstanding;

  /// No description provided for @parkingPaidSoFarOfTotal.
  ///
  /// In en, this message translates to:
  /// **'Paid so far: {paid} of {total} — {owed} still owed'**
  String parkingPaidSoFarOfTotal(String paid, String total, String owed);

  /// No description provided for @lotActivityTypesTitle.
  ///
  /// In en, this message translates to:
  /// **'Activities & rates'**
  String get lotActivityTypesTitle;

  /// No description provided for @lotActivityTypesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'What this lot charges for, and the price staff see when they record it.'**
  String get lotActivityTypesSubtitle;

  /// No description provided for @lotActivityTypeName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get lotActivityTypeName;

  /// No description provided for @lotActivityTypeFee.
  ///
  /// In en, this message translates to:
  /// **'Default fee (\$)'**
  String get lotActivityTypeFee;

  /// No description provided for @lotActivityTypeNeedsAuctionHouse.
  ///
  /// In en, this message translates to:
  /// **'Asks for an auction house'**
  String get lotActivityTypeNeedsAuctionHouse;

  /// No description provided for @lotActivityTypeShown.
  ///
  /// In en, this message translates to:
  /// **'Shown when recording'**
  String get lotActivityTypeShown;

  /// No description provided for @lotActivityTypeAdd.
  ///
  /// In en, this message translates to:
  /// **'Add an activity'**
  String get lotActivityTypeAdd;

  /// No description provided for @lotActivityTypeSaved.
  ///
  /// In en, this message translates to:
  /// **'Activity saved.'**
  String get lotActivityTypeSaved;

  /// No description provided for @lotActivityTypeRemoved.
  ///
  /// In en, this message translates to:
  /// **'Removed.'**
  String get lotActivityTypeRemoved;

  /// No description provided for @lotActivityTypeRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get lotActivityTypeRemove;

  /// No description provided for @lotActivityTypeRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this activity'**
  String get lotActivityTypeRemoveTitle;

  /// No description provided for @lotActivityTypeRemoveExplain.
  ///
  /// In en, this message translates to:
  /// **'It leaves the list staff pick from. Entries already recorded keep the name they were saved with.'**
  String get lotActivityTypeRemoveExplain;

  /// No description provided for @lotActivityTypeNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Give the activity a name.'**
  String get lotActivityTypeNameRequired;

  /// No description provided for @lotActivityTypesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No activities yet. Add the first one so staff have something to record.'**
  String get lotActivityTypesEmpty;

  /// No description provided for @lotActivityTypeCouldNotBeSaved.
  ///
  /// In en, this message translates to:
  /// **'The activity could not be saved.'**
  String get lotActivityTypeCouldNotBeSaved;

  /// No description provided for @lotProofThresholdTitle.
  ///
  /// In en, this message translates to:
  /// **'Require a receipt from'**
  String get lotProofThresholdTitle;

  /// No description provided for @lotProofThresholdHint.
  ///
  /// In en, this message translates to:
  /// **'Staff must attach a receipt at this amount and above. Zero never asks for one.'**
  String get lotProofThresholdHint;

  /// No description provided for @lotProofNeverRequired.
  ///
  /// In en, this message translates to:
  /// **'A receipt is never required.'**
  String get lotProofNeverRequired;

  /// No description provided for @lotProofThresholdSaved.
  ///
  /// In en, this message translates to:
  /// **'Receipt rule saved.'**
  String get lotProofThresholdSaved;

  /// No description provided for @lotProofThresholdCouldNotBeSaved.
  ///
  /// In en, this message translates to:
  /// **'The receipt rule could not be saved.'**
  String get lotProofThresholdCouldNotBeSaved;

  /// No description provided for @parkingRateCardsTitle.
  ///
  /// In en, this message translates to:
  /// **'Other prices (optional)'**
  String get parkingRateCardsTitle;

  /// No description provided for @parkingRateCardsHint.
  ///
  /// In en, this message translates to:
  /// **'A bigger space, a long-stay deal, a rate for a dealer who brings several cars. Give each one a name and a price per day; staff pick it when they record a car. A row without a name and a price is not saved.'**
  String get parkingRateCardsHint;

  /// No description provided for @parkingRateCardName.
  ///
  /// In en, this message translates to:
  /// **'Price name'**
  String get parkingRateCardName;

  /// No description provided for @parkingRateCardNameHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. SUV / oversize'**
  String get parkingRateCardNameHint;

  /// No description provided for @parkingRateCardDaily.
  ///
  /// In en, this message translates to:
  /// **'Price / day (\$)'**
  String get parkingRateCardDaily;

  /// No description provided for @parkingRateCardMinDays.
  ///
  /// In en, this message translates to:
  /// **'Min days'**
  String get parkingRateCardMinDays;

  /// No description provided for @parkingRateCardAdd.
  ///
  /// In en, this message translates to:
  /// **'Add a price'**
  String get parkingRateCardAdd;

  /// No description provided for @parkingRateCardRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove this price'**
  String get parkingRateCardRemove;

  /// No description provided for @lotLedgerSettings.
  ///
  /// In en, this message translates to:
  /// **'Ledger settings'**
  String get lotLedgerSettings;

  /// No description provided for @lotActivityTypeHidden.
  ///
  /// In en, this message translates to:
  /// **'Hidden'**
  String get lotActivityTypeHidden;

  /// No description provided for @parkingViewList.
  ///
  /// In en, this message translates to:
  /// **'List'**
  String get parkingViewList;

  /// No description provided for @parkingViewCards.
  ///
  /// In en, this message translates to:
  /// **'Cards'**
  String get parkingViewCards;

  /// No description provided for @parkingDaysAtRate.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 day} other{{count} days}} · {rate}/day'**
  String parkingDaysAtRate(int count, String rate);

  /// No description provided for @lotRecordedBy.
  ///
  /// In en, this message translates to:
  /// **'Recorded by'**
  String get lotRecordedBy;

  /// No description provided for @lotPartPaid.
  ///
  /// In en, this message translates to:
  /// **'Part paid'**
  String get lotPartPaid;

  /// No description provided for @lotPaidOfTotal.
  ///
  /// In en, this message translates to:
  /// **'{paid} of {total}'**
  String lotPaidOfTotal(String paid, String total);

  /// No description provided for @lotStillOwed.
  ///
  /// In en, this message translates to:
  /// **'{amount} still owed'**
  String lotStillOwed(String amount);

  /// No description provided for @lotBalance.
  ///
  /// In en, this message translates to:
  /// **'Balance'**
  String get lotBalance;

  /// No description provided for @lotPaidSoFar.
  ///
  /// In en, this message translates to:
  /// **'Paid so far'**
  String get lotPaidSoFar;

  /// No description provided for @lotNoVehicle.
  ///
  /// In en, this message translates to:
  /// **'No car'**
  String get lotNoVehicle;

  /// No description provided for @lotNoVehicleNote.
  ///
  /// In en, this message translates to:
  /// **'This activity is recorded without a vehicle.'**
  String get lotNoVehicleNote;

  /// No description provided for @lotActivityTypeNeedsVehicle.
  ///
  /// In en, this message translates to:
  /// **'Done to a car'**
  String get lotActivityTypeNeedsVehicle;

  /// No description provided for @lotActivityTypeNeedsVehicleNote.
  ///
  /// In en, this message translates to:
  /// **'Turn this off for work with no vehicle, such as lending an auction account. Staff are then not asked for a VIN.'**
  String get lotActivityTypeNeedsVehicleNote;

  /// No description provided for @lotRecordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record a payment'**
  String get lotRecordPayment;

  /// No description provided for @lotRecordPaymentNote.
  ///
  /// In en, this message translates to:
  /// **'Money taken in person. It comes off the balance now, and the customer\'s link asks for what is left.'**
  String get lotRecordPaymentNote;

  /// No description provided for @lotPaymentAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount taken (\$)'**
  String get lotPaymentAmount;

  /// No description provided for @lotPaymentMaxNote.
  ///
  /// In en, this message translates to:
  /// **'At most {amount} — what is still owed on this entry.'**
  String lotPaymentMaxNote(String amount);

  /// No description provided for @lotPaymentNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get lotPaymentNote;

  /// No description provided for @lotPaymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'{amount} recorded.'**
  String lotPaymentRecorded(String amount);

  /// No description provided for @lotPaymentSettled.
  ///
  /// In en, this message translates to:
  /// **'{amount} recorded — settled in full.'**
  String lotPaymentSettled(String amount);

  /// No description provided for @lotPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get lotPayments;

  /// No description provided for @lotPaymentsNote.
  ///
  /// In en, this message translates to:
  /// **'Every payment taken against this entry, whichever route it came in on.'**
  String get lotPaymentsNote;

  /// No description provided for @lotNoPaymentsYet.
  ///
  /// In en, this message translates to:
  /// **'No individual payments recorded on this entry.'**
  String get lotNoPaymentsYet;

  /// No description provided for @lotPaymentsCouldNotBeLoaded.
  ///
  /// In en, this message translates to:
  /// **'The payments could not be loaded.'**
  String get lotPaymentsCouldNotBeLoaded;

  /// No description provided for @lotPaymentInPerson.
  ///
  /// In en, this message translates to:
  /// **'In person'**
  String get lotPaymentInPerson;

  /// No description provided for @lotPaymentOnline.
  ///
  /// In en, this message translates to:
  /// **'Online'**
  String get lotPaymentOnline;

  /// No description provided for @lotPaymentOverpaid.
  ///
  /// In en, this message translates to:
  /// **'{amount} over the balance'**
  String lotPaymentOverpaid(String amount);

  /// No description provided for @lotErrActivityVoided.
  ///
  /// In en, this message translates to:
  /// **'This entry was voided — record a new one instead.'**
  String get lotErrActivityVoided;

  /// No description provided for @lotErrActivityCancelled.
  ///
  /// In en, this message translates to:
  /// **'This entry was cancelled, so no money can be taken against it.'**
  String get lotErrActivityCancelled;

  /// No description provided for @lotErrNothingToPay.
  ///
  /// In en, this message translates to:
  /// **'This entry has no fee to pay.'**
  String get lotErrNothingToPay;

  /// No description provided for @lotErrAlreadyPaid.
  ///
  /// In en, this message translates to:
  /// **'This entry is already paid in full.'**
  String get lotErrAlreadyPaid;

  /// No description provided for @lotErrNoAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount taken.'**
  String get lotErrNoAmount;

  /// No description provided for @lotErrBelowCardMinimum.
  ///
  /// In en, this message translates to:
  /// **'A card payment starts at {amount}.'**
  String lotErrBelowCardMinimum(String amount);

  /// No description provided for @lotErrBelowAmountPaid.
  ///
  /// In en, this message translates to:
  /// **'{amount} has already been taken on this entry. The fee cannot go below it.'**
  String lotErrBelowAmountPaid(String amount);

  /// No description provided for @ctrTitle.
  ///
  /// In en, this message translates to:
  /// **'Containers'**
  String get ctrTitle;

  /// No description provided for @ctrSubtitle.
  ///
  /// In en, this message translates to:
  /// **'What went into each box, recorded from the yard.'**
  String get ctrSubtitle;

  /// No description provided for @ctrStatusLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading'**
  String get ctrStatusLoading;

  /// No description provided for @ctrStatusShipped.
  ///
  /// In en, this message translates to:
  /// **'Shipped'**
  String get ctrStatusShipped;

  /// No description provided for @ctrStatusArrived.
  ///
  /// In en, this message translates to:
  /// **'Ready for pickup'**
  String get ctrStatusArrived;

  /// No description provided for @ctrNewContainer.
  ///
  /// In en, this message translates to:
  /// **'New container'**
  String get ctrNewContainer;

  /// No description provided for @ctrEditContainer.
  ///
  /// In en, this message translates to:
  /// **'Edit container'**
  String get ctrEditContainer;

  /// No description provided for @ctrCreate.
  ///
  /// In en, this message translates to:
  /// **'Create'**
  String get ctrCreate;

  /// No description provided for @ctrCreating.
  ///
  /// In en, this message translates to:
  /// **'Creating…'**
  String get ctrCreating;

  /// No description provided for @ctrLabel.
  ///
  /// In en, this message translates to:
  /// **'Working name'**
  String get ctrLabel;

  /// No description provided for @ctrLabelHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Sailing 3 Oct, box 2'**
  String get ctrLabelHint;

  /// No description provided for @ctrLabelOptionalNote.
  ///
  /// In en, this message translates to:
  /// **'Optional once there is a container or booking number.'**
  String get ctrLabelOptionalNote;

  /// No description provided for @ctrNumber.
  ///
  /// In en, this message translates to:
  /// **'Container number'**
  String get ctrNumber;

  /// No description provided for @ctrNumberHint.
  ///
  /// In en, this message translates to:
  /// **'Four letters and seven digits, once the line sends it'**
  String get ctrNumberHint;

  /// No description provided for @ctrBookingReference.
  ///
  /// In en, this message translates to:
  /// **'Booking / BL reference'**
  String get ctrBookingReference;

  /// No description provided for @ctrDestination.
  ///
  /// In en, this message translates to:
  /// **'Destination'**
  String get ctrDestination;

  /// No description provided for @ctrChooseDestination.
  ///
  /// In en, this message translates to:
  /// **'Choose a country'**
  String get ctrChooseDestination;

  /// No description provided for @ctrSearchCountries.
  ///
  /// In en, this message translates to:
  /// **'Search countries'**
  String get ctrSearchCountries;

  /// No description provided for @ctrYourDestinations.
  ///
  /// In en, this message translates to:
  /// **'Your destinations'**
  String get ctrYourDestinations;

  /// No description provided for @ctrEveryOtherCountry.
  ///
  /// In en, this message translates to:
  /// **'Every other country'**
  String get ctrEveryOtherCountry;

  /// No description provided for @ctrEveryCountry.
  ///
  /// In en, this message translates to:
  /// **'Every country'**
  String get ctrEveryCountry;

  /// No description provided for @ctrDestinationUnset.
  ///
  /// In en, this message translates to:
  /// **'No destination yet'**
  String get ctrDestinationUnset;

  /// No description provided for @ctrShippingLine.
  ///
  /// In en, this message translates to:
  /// **'Shipping line'**
  String get ctrShippingLine;

  /// No description provided for @ctrShippingLineGuess.
  ///
  /// In en, this message translates to:
  /// **'Not sure — guess from the container number'**
  String get ctrShippingLineGuess;

  /// No description provided for @ctrSearchShippingLines.
  ///
  /// In en, this message translates to:
  /// **'Search shipping lines'**
  String get ctrSearchShippingLines;

  /// No description provided for @ctrShippingLineNeeded.
  ///
  /// In en, this message translates to:
  /// **'Tracking couldn\'t find the shipping line — choose it to start tracking.'**
  String get ctrShippingLineNeeded;

  /// No description provided for @ctrNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get ctrNotes;

  /// No description provided for @ctrLockedNote.
  ///
  /// In en, this message translates to:
  /// **'Shipped. The list is the record of what went; only the notes and the shipping line stay open.'**
  String get ctrLockedNote;

  /// No description provided for @ctrNoContainers.
  ///
  /// In en, this message translates to:
  /// **'No containers yet.'**
  String get ctrNoContainers;

  /// No description provided for @ctrNoContainersHint.
  ///
  /// In en, this message translates to:
  /// **'Create one when you start loading a box.'**
  String get ctrNoContainersHint;

  /// No description provided for @ctrNoLoading.
  ///
  /// In en, this message translates to:
  /// **'No container is loading.'**
  String get ctrNoLoading;

  /// No description provided for @ctrNoShipped.
  ///
  /// In en, this message translates to:
  /// **'No container has shipped.'**
  String get ctrNoShipped;

  /// No description provided for @ctrNoArrived.
  ///
  /// In en, this message translates to:
  /// **'No container is ready for pickup yet.'**
  String get ctrNoArrived;

  /// No description provided for @ctrEmptyContainer.
  ///
  /// In en, this message translates to:
  /// **'Nothing loaded yet'**
  String get ctrEmptyContainer;

  /// No description provided for @ctrEmptyContainerHint.
  ///
  /// In en, this message translates to:
  /// **'Add the first car, barrels or anything else that went in.'**
  String get ctrEmptyContainerHint;

  /// No description provided for @ctrCarsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 car} other{{count} cars}}'**
  String ctrCarsCount(int count);

  /// No description provided for @ctrBarrelsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 barrel} other{{count} barrels}}'**
  String ctrBarrelsCount(int count);

  /// No description provided for @ctrOtherCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 other item} other{{count} other items}}'**
  String ctrOtherCount(int count);

  /// No description provided for @ctrSailed.
  ///
  /// In en, this message translates to:
  /// **'Sailed {date}'**
  String ctrSailed(String date);

  /// No description provided for @ctrArrivedOn.
  ///
  /// In en, this message translates to:
  /// **'Ready for pickup {date}'**
  String ctrArrivedOn(String date);

  /// No description provided for @ctrLoaded.
  ///
  /// In en, this message translates to:
  /// **'Loaded'**
  String get ctrLoaded;

  /// No description provided for @ctrAddLine.
  ///
  /// In en, this message translates to:
  /// **'Add to the container'**
  String get ctrAddLine;

  /// No description provided for @ctrAdd.
  ///
  /// In en, this message translates to:
  /// **'Add'**
  String get ctrAdd;

  /// No description provided for @ctrAdding.
  ///
  /// In en, this message translates to:
  /// **'Adding…'**
  String get ctrAdding;

  /// No description provided for @ctrKind.
  ///
  /// In en, this message translates to:
  /// **'What is it?'**
  String get ctrKind;

  /// No description provided for @ctrKindCar.
  ///
  /// In en, this message translates to:
  /// **'A car'**
  String get ctrKindCar;

  /// No description provided for @ctrKindBarrels.
  ///
  /// In en, this message translates to:
  /// **'Barrels'**
  String get ctrKindBarrels;

  /// No description provided for @ctrKindOther.
  ///
  /// In en, this message translates to:
  /// **'Something else'**
  String get ctrKindOther;

  /// No description provided for @ctrQuantity.
  ///
  /// In en, this message translates to:
  /// **'How many'**
  String get ctrQuantity;

  /// No description provided for @ctrDescription.
  ///
  /// In en, this message translates to:
  /// **'What it is'**
  String get ctrDescription;

  /// No description provided for @ctrOwner.
  ///
  /// In en, this message translates to:
  /// **'Whose is it?'**
  String get ctrOwner;

  /// No description provided for @ctrOwnerCustomer.
  ///
  /// In en, this message translates to:
  /// **'A customer\'s'**
  String get ctrOwnerCustomer;

  /// No description provided for @ctrOwnerCustomerNote.
  ///
  /// In en, this message translates to:
  /// **'Name the customer, so the list says whose it is.'**
  String get ctrOwnerCustomerNote;

  /// No description provided for @ctrOwnerStock.
  ///
  /// In en, this message translates to:
  /// **'Business stock'**
  String get ctrOwnerStock;

  /// No description provided for @ctrOwnerStockNote.
  ///
  /// In en, this message translates to:
  /// **'Bought to sell abroad. No customer to name.'**
  String get ctrOwnerStockNote;

  /// No description provided for @ctrReceiver.
  ///
  /// In en, this message translates to:
  /// **'Receiver at destination'**
  String get ctrReceiver;

  /// No description provided for @ctrReceiverHint.
  ///
  /// In en, this message translates to:
  /// **'The name written on it'**
  String get ctrReceiverHint;

  /// No description provided for @ctrReceiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Receiver\'s phone'**
  String get ctrReceiverPhone;

  /// No description provided for @ctrSplitHint.
  ///
  /// In en, this message translates to:
  /// **'Several customers\' barrels in one go? Save each customer\'s share and add the next.'**
  String get ctrSplitHint;

  /// No description provided for @ctrSaveAndAnother.
  ///
  /// In en, this message translates to:
  /// **'Save & add another'**
  String get ctrSaveAndAnother;

  /// No description provided for @ctrAddAndClose.
  ///
  /// In en, this message translates to:
  /// **'Add & close'**
  String get ctrAddAndClose;

  /// No description provided for @ctrAddedSoFar.
  ///
  /// In en, this message translates to:
  /// **'Added so far: {list}'**
  String ctrAddedSoFar(String list);

  /// No description provided for @ctrStock.
  ///
  /// In en, this message translates to:
  /// **'Stock'**
  String get ctrStock;

  /// No description provided for @ctrTimes.
  ///
  /// In en, this message translates to:
  /// **'× {count}'**
  String ctrTimes(int count);

  /// No description provided for @ctrRemoveLine.
  ///
  /// In en, this message translates to:
  /// **'Remove from the container'**
  String get ctrRemoveLine;

  /// No description provided for @ctrRemoveLineTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this line?'**
  String get ctrRemoveLineTitle;

  /// No description provided for @ctrRemoveLineMessage.
  ///
  /// In en, this message translates to:
  /// **'It comes off the loading list. You can add it again.'**
  String get ctrRemoveLineMessage;

  /// No description provided for @ctrRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get ctrRemove;

  /// No description provided for @ctrMoveLine.
  ///
  /// In en, this message translates to:
  /// **'Move to another container'**
  String get ctrMoveLine;

  /// No description provided for @ctrMoveTo.
  ///
  /// In en, this message translates to:
  /// **'Move to'**
  String get ctrMoveTo;

  /// No description provided for @ctrNoOtherLoading.
  ///
  /// In en, this message translates to:
  /// **'No other container is loading right now.'**
  String get ctrNoOtherLoading;

  /// No description provided for @ctrMoved.
  ///
  /// In en, this message translates to:
  /// **'Moved.'**
  String get ctrMoved;

  /// No description provided for @ctrShip.
  ///
  /// In en, this message translates to:
  /// **'Mark shipped'**
  String get ctrShip;

  /// No description provided for @ctrShipTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this container shipped?'**
  String get ctrShipTitle;

  /// No description provided for @ctrShipMessage.
  ///
  /// In en, this message translates to:
  /// **'The list becomes the record of what went. Only the notes stay open after this.'**
  String get ctrShipMessage;

  /// No description provided for @ctrShippedDone.
  ///
  /// In en, this message translates to:
  /// **'Marked shipped.'**
  String get ctrShippedDone;

  /// No description provided for @ctrArrive.
  ///
  /// In en, this message translates to:
  /// **'Mark ready for pickup'**
  String get ctrArrive;

  /// No description provided for @ctrArriveTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this container ready for pickup?'**
  String get ctrArriveTitle;

  /// No description provided for @ctrArriveMessage.
  ///
  /// In en, this message translates to:
  /// **'Customers are told on WhatsApp where to collect their goods. Its cars are free to go on a new container.'**
  String get ctrArriveMessage;

  /// No description provided for @ctrArrivedDone.
  ///
  /// In en, this message translates to:
  /// **'Marked ready for pickup.'**
  String get ctrArrivedDone;

  /// No description provided for @ctrDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete container'**
  String get ctrDelete;

  /// No description provided for @ctrDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this container?'**
  String get ctrDeleteTitle;

  /// No description provided for @ctrDeleteMessage.
  ///
  /// In en, this message translates to:
  /// **'Only an empty container that is still loading can be deleted.'**
  String get ctrDeleteMessage;

  /// No description provided for @ctrDeleted.
  ///
  /// In en, this message translates to:
  /// **'Deleted.'**
  String get ctrDeleted;

  /// No description provided for @ctrOpenDocument.
  ///
  /// In en, this message translates to:
  /// **'Loading list'**
  String get ctrOpenDocument;

  /// No description provided for @ctrSearchHint.
  ///
  /// In en, this message translates to:
  /// **'VIN, customer or phone'**
  String get ctrSearchHint;

  /// No description provided for @ctrNoSearchMatch.
  ///
  /// In en, this message translates to:
  /// **'Nothing matches.'**
  String get ctrNoSearchMatch;

  /// No description provided for @ctrHitsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 match} other{{count} matches}}'**
  String ctrHitsCount(int count);

  /// No description provided for @ctrLinkShipped.
  ///
  /// In en, this message translates to:
  /// **'In {container} · sailed {date}'**
  String ctrLinkShipped(String container, String date);

  /// No description provided for @ctrLinkShippedNoDate.
  ///
  /// In en, this message translates to:
  /// **'In {container}'**
  String ctrLinkShippedNoDate(String container);

  /// No description provided for @ctrLinkLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading in {name}'**
  String ctrLinkLoading(String name);

  /// No description provided for @ctrCreated.
  ///
  /// In en, this message translates to:
  /// **'Container created.'**
  String get ctrCreated;

  /// No description provided for @ctrUpdated.
  ///
  /// In en, this message translates to:
  /// **'Saved.'**
  String get ctrUpdated;

  /// No description provided for @ctrLineAdded.
  ///
  /// In en, this message translates to:
  /// **'Added.'**
  String get ctrLineAdded;

  /// No description provided for @ctrLineRemoved.
  ///
  /// In en, this message translates to:
  /// **'Removed.'**
  String get ctrLineRemoved;

  /// No description provided for @ctrCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'The containers could not be loaded.'**
  String get ctrCouldNotLoad;

  /// No description provided for @ctrLoadOlderContainers.
  ///
  /// In en, this message translates to:
  /// **'Load older containers'**
  String get ctrLoadOlderContainers;

  /// No description provided for @ctrErrLabelRequired.
  ///
  /// In en, this message translates to:
  /// **'Give the container a working name, or its container or booking number.'**
  String get ctrErrLabelRequired;

  /// No description provided for @ctrErrNumberInvalid.
  ///
  /// In en, this message translates to:
  /// **'A container number is four letters and seven digits, like MSKU1234567. Booking numbers and bills of lading go in the reference field.'**
  String get ctrErrNumberInvalid;

  /// No description provided for @ctrErrCarrierInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose the shipping line from the list.'**
  String get ctrErrCarrierInvalid;

  /// No description provided for @ctrErrStatusInvalid.
  ///
  /// In en, this message translates to:
  /// **'That is not a state a container can be in.'**
  String get ctrErrStatusInvalid;

  /// No description provided for @ctrErrTransitionInvalid.
  ///
  /// In en, this message translates to:
  /// **'A container only moves forward: loading, then shipped, then ready for pickup.'**
  String get ctrErrTransitionInvalid;

  /// No description provided for @ctrErrDestinationRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose where this container is going before it ships.'**
  String get ctrErrDestinationRequired;

  /// No description provided for @ctrErrEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing is on this container yet, so it can\'t ship.'**
  String get ctrErrEmpty;

  /// No description provided for @ctrErrLocked.
  ///
  /// In en, this message translates to:
  /// **'This container has shipped. Its list is the record of what went; add a note instead of changing it.'**
  String get ctrErrLocked;

  /// No description provided for @ctrErrHasLines.
  ///
  /// In en, this message translates to:
  /// **'This container has lines on it. Remove them first, or leave it.'**
  String get ctrErrHasLines;

  /// No description provided for @ctrErrNotFound.
  ///
  /// In en, this message translates to:
  /// **'Container not found.'**
  String get ctrErrNotFound;

  /// No description provided for @ctrErrLineNotFound.
  ///
  /// In en, this message translates to:
  /// **'That line is no longer on the container.'**
  String get ctrErrLineNotFound;

  /// No description provided for @ctrErrLineKind.
  ///
  /// In en, this message translates to:
  /// **'Say what this line is: a car, barrels, or something else.'**
  String get ctrErrLineKind;

  /// No description provided for @ctrErrQuantity.
  ///
  /// In en, this message translates to:
  /// **'Enter how many.'**
  String get ctrErrQuantity;

  /// No description provided for @ctrErrDescription.
  ///
  /// In en, this message translates to:
  /// **'Say what it is.'**
  String get ctrErrDescription;

  /// No description provided for @ctrErrOwnerKind.
  ///
  /// In en, this message translates to:
  /// **'Say whose this is: a customer, or your own stock.'**
  String get ctrErrOwnerKind;

  /// No description provided for @ctrErrVinAlreadyLoaded.
  ///
  /// In en, this message translates to:
  /// **'This car is already on another container that hasn\'t arrived.'**
  String get ctrErrVinAlreadyLoaded;

  /// No description provided for @ctrErrVinAlreadyLoadedIn.
  ///
  /// In en, this message translates to:
  /// **'This car is already on {container}, which hasn\'t arrived.'**
  String ctrErrVinAlreadyLoadedIn(String container);

  /// No description provided for @ctrErrMoveTarget.
  ///
  /// In en, this message translates to:
  /// **'You can only move a line to a container that is still loading.'**
  String get ctrErrMoveTarget;

  /// No description provided for @ctrErrCustomerPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'The customer\'s phone doesn\'t look like a phone number.'**
  String get ctrErrCustomerPhoneInvalid;

  /// No description provided for @ctrErrReceiverPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'The receiver\'s phone doesn\'t look like a phone number.'**
  String get ctrErrReceiverPhoneInvalid;

  /// No description provided for @ctrNotifyToggle.
  ///
  /// In en, this message translates to:
  /// **'Send this person WhatsApp updates about this shipment'**
  String get ctrNotifyToggle;

  /// No description provided for @ctrErrReceiverName.
  ///
  /// In en, this message translates to:
  /// **'Enter the receiver\'s name.'**
  String get ctrErrReceiverName;

  /// No description provided for @ctrSenderIsReceiver.
  ///
  /// In en, this message translates to:
  /// **'Sender is the receiver'**
  String get ctrSenderIsReceiver;

  /// No description provided for @ctrNotifyNeedsPhone.
  ///
  /// In en, this message translates to:
  /// **'Add a phone number to turn this on.'**
  String get ctrNotifyNeedsPhone;

  /// No description provided for @ctrPhoneNeedsCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Add the country code so WhatsApp updates can reach this number.'**
  String get ctrPhoneNeedsCountryCode;

  /// No description provided for @ctrLineTrackingCode.
  ///
  /// In en, this message translates to:
  /// **'Tracking code {code}'**
  String ctrLineTrackingCode(String code);

  /// No description provided for @ctrUpdatesTo.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp updates to {names}'**
  String ctrUpdatesTo(String names);

  /// No description provided for @ctrUpdatesOff.
  ///
  /// In en, this message translates to:
  /// **'No WhatsApp updates'**
  String get ctrUpdatesOff;

  /// No description provided for @ctrCustomerPhoneNoCountryCode.
  ///
  /// In en, this message translates to:
  /// **'The customer\'s phone has no country code, so WhatsApp updates can\'t reach it.'**
  String get ctrCustomerPhoneNoCountryCode;

  /// No description provided for @ctrReceiverPhoneNoCountryCode.
  ///
  /// In en, this message translates to:
  /// **'The receiver\'s phone has no country code, so WhatsApp updates can\'t reach it.'**
  String get ctrReceiverPhoneNoCountryCode;

  /// No description provided for @ctrReceiverShort.
  ///
  /// In en, this message translates to:
  /// **'Receiver'**
  String get ctrReceiverShort;

  /// No description provided for @ctrEditContacts.
  ///
  /// In en, this message translates to:
  /// **'Edit contacts'**
  String get ctrEditContacts;

  /// No description provided for @ctrEditContactsNote.
  ///
  /// In en, this message translates to:
  /// **'Names and phones can be corrected at any time, even after the container ships.'**
  String get ctrEditContactsNote;

  /// No description provided for @ctrContactsSaved.
  ///
  /// In en, this message translates to:
  /// **'Contacts updated'**
  String get ctrContactsSaved;

  /// No description provided for @ctrEditLine.
  ///
  /// In en, this message translates to:
  /// **'Edit line'**
  String get ctrEditLine;

  /// No description provided for @ctrLineUpdated.
  ///
  /// In en, this message translates to:
  /// **'Line updated.'**
  String get ctrLineUpdated;

  /// No description provided for @ctrEditLineNote.
  ///
  /// In en, this message translates to:
  /// **'What it is and whose it is can change until the container ships. After that, only the contacts.'**
  String get ctrEditLineNote;

  /// No description provided for @ctrLotQuestion.
  ///
  /// In en, this message translates to:
  /// **'Is this car parked in your lot?'**
  String get ctrLotQuestion;

  /// No description provided for @ctrLotYes.
  ///
  /// In en, this message translates to:
  /// **'Yes'**
  String get ctrLotYes;

  /// No description provided for @ctrLotYesNote.
  ///
  /// In en, this message translates to:
  /// **'Pick it from the cars in the lot.'**
  String get ctrLotYesNote;

  /// No description provided for @ctrLotNo.
  ///
  /// In en, this message translates to:
  /// **'No'**
  String get ctrLotNo;

  /// No description provided for @ctrLotNoNote.
  ///
  /// In en, this message translates to:
  /// **'Enter or scan the VIN.'**
  String get ctrLotNoNote;

  /// No description provided for @ctrLotChange.
  ///
  /// In en, this message translates to:
  /// **'Change'**
  String get ctrLotChange;

  /// No description provided for @ctrLotPickTitle.
  ///
  /// In en, this message translates to:
  /// **'Which car?'**
  String get ctrLotPickTitle;

  /// No description provided for @ctrLotFilterHint.
  ///
  /// In en, this message translates to:
  /// **'VIN, owner or make'**
  String get ctrLotFilterHint;

  /// No description provided for @ctrLotNoCars.
  ///
  /// In en, this message translates to:
  /// **'No cars are parked right now.'**
  String get ctrLotNoCars;

  /// No description provided for @ctrLotNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No parked car matches.'**
  String get ctrLotNoMatch;

  /// No description provided for @ctrLotEnterVinInstead.
  ///
  /// In en, this message translates to:
  /// **'Enter the VIN instead'**
  String get ctrLotEnterVinInstead;

  /// No description provided for @ctrLotCarUnknown.
  ///
  /// In en, this message translates to:
  /// **'Car'**
  String get ctrLotCarUnknown;

  /// No description provided for @ctrLotTaken.
  ///
  /// In en, this message translates to:
  /// **'Already on {container}'**
  String ctrLotTaken(String container);

  /// No description provided for @ctrLotPicked.
  ///
  /// In en, this message translates to:
  /// **'Filled in from the car in your lot.'**
  String get ctrLotPicked;

  /// No description provided for @ctrLotPickAnother.
  ///
  /// In en, this message translates to:
  /// **'Choose a different car'**
  String get ctrLotPickAnother;

  /// No description provided for @invMenuTitle.
  ///
  /// In en, this message translates to:
  /// **'Invoices & receipts'**
  String get invMenuTitle;

  /// No description provided for @invMenuSubtitle.
  ///
  /// In en, this message translates to:
  /// **'What you sold and what is owed, as PDFs to send.'**
  String get invMenuSubtitle;

  /// No description provided for @invPermissionLabel.
  ///
  /// In en, this message translates to:
  /// **'Invoices'**
  String get invPermissionLabel;

  /// No description provided for @invTitle.
  ///
  /// In en, this message translates to:
  /// **'Invoices & receipts'**
  String get invTitle;

  /// No description provided for @invNew.
  ///
  /// In en, this message translates to:
  /// **'New invoice'**
  String get invNew;

  /// No description provided for @invSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Number, title, customer or phone'**
  String get invSearchHint;

  /// No description provided for @invFilterOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get invFilterOpen;

  /// No description provided for @invFilterOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get invFilterOverdue;

  /// No description provided for @invFilterPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get invFilterPaid;

  /// No description provided for @invFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get invFilterAll;

  /// No description provided for @invStatOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get invStatOpen;

  /// No description provided for @invStatOwed.
  ///
  /// In en, this message translates to:
  /// **'Owed to you'**
  String get invStatOwed;

  /// No description provided for @invStatCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get invStatCollected;

  /// No description provided for @invEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No invoices yet'**
  String get invEmptyTitle;

  /// No description provided for @invEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Open one the next time you sell something.'**
  String get invEmptyHint;

  /// No description provided for @invNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No invoices match.'**
  String get invNoMatch;

  /// No description provided for @invStatusOpen.
  ///
  /// In en, this message translates to:
  /// **'Open'**
  String get invStatusOpen;

  /// No description provided for @invStatusOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue'**
  String get invStatusOverdue;

  /// No description provided for @invStatusPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get invStatusPaid;

  /// No description provided for @invKindInvoice.
  ///
  /// In en, this message translates to:
  /// **'Invoice'**
  String get invKindInvoice;

  /// No description provided for @invKindReceipt.
  ///
  /// In en, this message translates to:
  /// **'Receipt'**
  String get invKindReceipt;

  /// No description provided for @invFor.
  ///
  /// In en, this message translates to:
  /// **'For {name}'**
  String invFor(String name);

  /// No description provided for @invDue.
  ///
  /// In en, this message translates to:
  /// **'Due {day}'**
  String invDue(String day);

  /// No description provided for @invPaidOn.
  ///
  /// In en, this message translates to:
  /// **'Paid on {day}'**
  String invPaidOn(String day);

  /// No description provided for @invNoDueDate.
  ///
  /// In en, this message translates to:
  /// **'No due date'**
  String get invNoDueDate;

  /// No description provided for @invTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get invTotal;

  /// No description provided for @invPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get invPaid;

  /// No description provided for @invBalanceDue.
  ///
  /// In en, this message translates to:
  /// **'Balance due'**
  String get invBalanceDue;

  /// No description provided for @invLines.
  ///
  /// In en, this message translates to:
  /// **'Lines'**
  String get invLines;

  /// No description provided for @invPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get invPayments;

  /// No description provided for @invNoLines.
  ///
  /// In en, this message translates to:
  /// **'Nothing on this invoice yet. Add the first line.'**
  String get invNoLines;

  /// No description provided for @invNoPayments.
  ///
  /// In en, this message translates to:
  /// **'No payment recorded yet.'**
  String get invNoPayments;

  /// No description provided for @invAddLine.
  ///
  /// In en, this message translates to:
  /// **'Add line'**
  String get invAddLine;

  /// No description provided for @invEditLine.
  ///
  /// In en, this message translates to:
  /// **'Edit line'**
  String get invEditLine;

  /// No description provided for @invRemoveLine.
  ///
  /// In en, this message translates to:
  /// **'Remove line'**
  String get invRemoveLine;

  /// No description provided for @invRemoveLineMessage.
  ///
  /// In en, this message translates to:
  /// **'It comes off the invoice and the balance drops. The history keeps it.'**
  String get invRemoveLineMessage;

  /// No description provided for @invRecordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record a payment'**
  String get invRecordPayment;

  /// No description provided for @invRevertPayment.
  ///
  /// In en, this message translates to:
  /// **'Revert payment'**
  String get invRevertPayment;

  /// No description provided for @invRevertMessage.
  ///
  /// In en, this message translates to:
  /// **'The balance goes back up. The payment stays in the history, struck through.'**
  String get invRevertMessage;

  /// No description provided for @invReverted.
  ///
  /// In en, this message translates to:
  /// **'Reverted'**
  String get invReverted;

  /// No description provided for @invSavePdf.
  ///
  /// In en, this message translates to:
  /// **'View PDF'**
  String get invSavePdf;

  /// No description provided for @invShareText.
  ///
  /// In en, this message translates to:
  /// **'Send as text'**
  String get invShareText;

  /// No description provided for @invHistory.
  ///
  /// In en, this message translates to:
  /// **'History'**
  String get invHistory;

  /// No description provided for @invEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit'**
  String get invEdit;

  /// No description provided for @invDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete invoice'**
  String get invDelete;

  /// No description provided for @invDeleteMessage.
  ///
  /// In en, this message translates to:
  /// **'Its number will not be reused.'**
  String get invDeleteMessage;

  /// No description provided for @invFormTitle.
  ///
  /// In en, this message translates to:
  /// **'Title'**
  String get invFormTitle;

  /// No description provided for @invFormTitleHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 2014 Corolla, or Barrels to Conakry'**
  String get invFormTitleHint;

  /// No description provided for @invFormEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get invFormEmail;

  /// No description provided for @invFormIssuedOn.
  ///
  /// In en, this message translates to:
  /// **'Invoice date'**
  String get invFormIssuedOn;

  /// No description provided for @invFormDueOn.
  ///
  /// In en, this message translates to:
  /// **'Due date'**
  String get invFormDueOn;

  /// No description provided for @invFormDueHint.
  ///
  /// In en, this message translates to:
  /// **'Leave blank if there is no deadline'**
  String get invFormDueHint;

  /// No description provided for @invFormNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes on the paper'**
  String get invFormNotes;

  /// No description provided for @invOpen.
  ///
  /// In en, this message translates to:
  /// **'Open invoice'**
  String get invOpen;

  /// No description provided for @invOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening…'**
  String get invOpening;

  /// No description provided for @invSave.
  ///
  /// In en, this message translates to:
  /// **'Save'**
  String get invSave;

  /// No description provided for @invSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get invSaving;

  /// No description provided for @invLineWhat.
  ///
  /// In en, this message translates to:
  /// **'What it is'**
  String get invLineWhat;

  /// No description provided for @invLineWhatHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. 2014 Toyota Corolla, or Barrels'**
  String get invLineWhatHint;

  /// No description provided for @invLineQty.
  ///
  /// In en, this message translates to:
  /// **'How many'**
  String get invLineQty;

  /// No description provided for @invLineUnit.
  ///
  /// In en, this message translates to:
  /// **'Price for one (\$)'**
  String get invLineUnit;

  /// No description provided for @invLineVin.
  ///
  /// In en, this message translates to:
  /// **'VIN (cars only)'**
  String get invLineVin;

  /// No description provided for @invLineEach.
  ///
  /// In en, this message translates to:
  /// **'{qty} × {each}'**
  String invLineEach(int qty, String each);

  /// No description provided for @invSaveAndAnother.
  ///
  /// In en, this message translates to:
  /// **'Save & add another'**
  String get invSaveAndAnother;

  /// No description provided for @invAddAndClose.
  ///
  /// In en, this message translates to:
  /// **'Add & close'**
  String get invAddAndClose;

  /// No description provided for @invPayAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount received (\$)'**
  String get invPayAmount;

  /// No description provided for @invPayMethod.
  ///
  /// In en, this message translates to:
  /// **'How it arrived'**
  String get invPayMethod;

  /// No description provided for @invPayDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get invPayDate;

  /// No description provided for @invPayNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get invPayNote;

  /// No description provided for @invPayWhole.
  ///
  /// In en, this message translates to:
  /// **'Pay the whole balance'**
  String get invPayWhole;

  /// No description provided for @invPayStillOwed.
  ///
  /// In en, this message translates to:
  /// **'{amount} still owed'**
  String invPayStillOwed(String amount);

  /// No description provided for @invOpened.
  ///
  /// In en, this message translates to:
  /// **'Invoice opened. Add the first line.'**
  String get invOpened;

  /// No description provided for @invUpdated.
  ///
  /// In en, this message translates to:
  /// **'Saved.'**
  String get invUpdated;

  /// No description provided for @invDeleted.
  ///
  /// In en, this message translates to:
  /// **'Invoice deleted.'**
  String get invDeleted;

  /// No description provided for @invLineAdded.
  ///
  /// In en, this message translates to:
  /// **'Line added.'**
  String get invLineAdded;

  /// No description provided for @invLineUpdated.
  ///
  /// In en, this message translates to:
  /// **'Line updated.'**
  String get invLineUpdated;

  /// No description provided for @invLineRemoved.
  ///
  /// In en, this message translates to:
  /// **'Line removed.'**
  String get invLineRemoved;

  /// No description provided for @invPaymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'Payment recorded.'**
  String get invPaymentRecorded;

  /// No description provided for @invPaidInFull.
  ///
  /// In en, this message translates to:
  /// **'Paid in full — this is now a receipt.'**
  String get invPaidInFull;

  /// No description provided for @invPaymentReverted.
  ///
  /// In en, this message translates to:
  /// **'Payment reverted.'**
  String get invPaymentReverted;

  /// No description provided for @invNotFound.
  ///
  /// In en, this message translates to:
  /// **'That invoice no longer exists.'**
  String get invNotFound;

  /// No description provided for @invMethodCash.
  ///
  /// In en, this message translates to:
  /// **'Cash'**
  String get invMethodCash;

  /// No description provided for @invMethodZelle.
  ///
  /// In en, this message translates to:
  /// **'Zelle'**
  String get invMethodZelle;

  /// No description provided for @invMethodCashapp.
  ///
  /// In en, this message translates to:
  /// **'Cash App'**
  String get invMethodCashapp;

  /// No description provided for @invMethodVenmo.
  ///
  /// In en, this message translates to:
  /// **'Venmo'**
  String get invMethodVenmo;

  /// No description provided for @invMethodCheck.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get invMethodCheck;

  /// No description provided for @invMethodCardInPerson.
  ///
  /// In en, this message translates to:
  /// **'Card in person'**
  String get invMethodCardInPerson;

  /// No description provided for @invMethodOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get invMethodOther;

  /// No description provided for @invErrTitle.
  ///
  /// In en, this message translates to:
  /// **'Give the invoice a short title (what it is for).'**
  String get invErrTitle;

  /// No description provided for @invErrCustomer.
  ///
  /// In en, this message translates to:
  /// **'Say who the invoice is for.'**
  String get invErrCustomer;

  /// No description provided for @invErrIssuedOn.
  ///
  /// In en, this message translates to:
  /// **'The invoice date is not a real date.'**
  String get invErrIssuedOn;

  /// No description provided for @invErrDueOn.
  ///
  /// In en, this message translates to:
  /// **'The due date is not a real date.'**
  String get invErrDueOn;

  /// No description provided for @invErrDueOrder.
  ///
  /// In en, this message translates to:
  /// **'The due date is before the invoice date.'**
  String get invErrDueOrder;

  /// No description provided for @invErrDescription.
  ///
  /// In en, this message translates to:
  /// **'Say what the line is.'**
  String get invErrDescription;

  /// No description provided for @invErrQuantity.
  ///
  /// In en, this message translates to:
  /// **'Enter how many (at least one).'**
  String get invErrQuantity;

  /// No description provided for @invErrUnitPrice.
  ///
  /// In en, this message translates to:
  /// **'Enter the price for one.'**
  String get invErrUnitPrice;

  /// No description provided for @invErrTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That amount is larger than an invoice can carry.'**
  String get invErrTooLarge;

  /// No description provided for @invErrVin.
  ///
  /// In en, this message translates to:
  /// **'A VIN is 17 letters and digits.'**
  String get invErrVin;

  /// No description provided for @invErrAmount.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount received.'**
  String get invErrAmount;

  /// No description provided for @invErrMethod.
  ///
  /// In en, this message translates to:
  /// **'Say how the payment arrived.'**
  String get invErrMethod;

  /// No description provided for @invErrPaidOn.
  ///
  /// In en, this message translates to:
  /// **'The payment date is not a real date.'**
  String get invErrPaidOn;

  /// No description provided for @invErrExceeds.
  ///
  /// In en, this message translates to:
  /// **'That is more than what is still owed.'**
  String get invErrExceeds;

  /// No description provided for @invErrHasLines.
  ///
  /// In en, this message translates to:
  /// **'Remove the lines and payments before deleting.'**
  String get invErrHasLines;

  /// No description provided for @invPdfInvoice.
  ///
  /// In en, this message translates to:
  /// **'INVOICE'**
  String get invPdfInvoice;

  /// No description provided for @invPdfReceipt.
  ///
  /// In en, this message translates to:
  /// **'RECEIPT'**
  String get invPdfReceipt;

  /// No description provided for @invPdfBilledTo.
  ///
  /// In en, this message translates to:
  /// **'Billed to'**
  String get invPdfBilledTo;

  /// No description provided for @invPdfDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get invPdfDate;

  /// No description provided for @invPdfDue.
  ///
  /// In en, this message translates to:
  /// **'Due'**
  String get invPdfDue;

  /// No description provided for @invPdfPaidOn.
  ///
  /// In en, this message translates to:
  /// **'Paid on'**
  String get invPdfPaidOn;

  /// No description provided for @invPdfDescription.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get invPdfDescription;

  /// No description provided for @invPdfQty.
  ///
  /// In en, this message translates to:
  /// **'Qty'**
  String get invPdfQty;

  /// No description provided for @invPdfEach.
  ///
  /// In en, this message translates to:
  /// **'Each'**
  String get invPdfEach;

  /// No description provided for @invPdfAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get invPdfAmount;

  /// No description provided for @invPdfTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get invPdfTotal;

  /// No description provided for @invPdfPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get invPdfPaid;

  /// No description provided for @invPdfBalanceDue.
  ///
  /// In en, this message translates to:
  /// **'Balance due'**
  String get invPdfBalanceDue;

  /// No description provided for @invPdfPaidInFull.
  ///
  /// In en, this message translates to:
  /// **'Paid in full'**
  String get invPdfPaidInFull;

  /// No description provided for @invPdfNotes.
  ///
  /// In en, this message translates to:
  /// **'Notes'**
  String get invPdfNotes;

  /// No description provided for @invPdfPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments received'**
  String get invPdfPayments;

  /// No description provided for @invPdfIssuedBy.
  ///
  /// In en, this message translates to:
  /// **'Issued by'**
  String get invPdfIssuedBy;

  /// No description provided for @invPdfCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get invPdfCustomer;

  /// No description provided for @invPdfFooter.
  ///
  /// In en, this message translates to:
  /// **'Issued through Laawol Digital · laawoldigital.com'**
  String get invPdfFooter;

  /// No description provided for @invLineVinFirst.
  ///
  /// In en, this message translates to:
  /// **'VIN (selling a car? start here)'**
  String get invLineVinFirst;

  /// No description provided for @invLineVinFills.
  ///
  /// In en, this message translates to:
  /// **'17 characters — fills in the car below'**
  String get invLineVinFills;

  /// No description provided for @invPayFor.
  ///
  /// In en, this message translates to:
  /// **'What it is for'**
  String get invPayFor;

  /// No description provided for @invPayWholeInvoice.
  ///
  /// In en, this message translates to:
  /// **'The whole invoice'**
  String get invPayWholeInvoice;

  /// No description provided for @invPayForLine.
  ///
  /// In en, this message translates to:
  /// **'for {what}'**
  String invPayForLine(String what);

  /// No description provided for @invPdfFor.
  ///
  /// In en, this message translates to:
  /// **'for'**
  String get invPdfFor;

  /// No description provided for @pmeTitle.
  ///
  /// In en, this message translates to:
  /// **'Month end'**
  String get pmeTitle;

  /// No description provided for @pmeButton.
  ///
  /// In en, this message translates to:
  /// **'Month end'**
  String get pmeButton;

  /// No description provided for @pmeShareMonth.
  ///
  /// In en, this message translates to:
  /// **'View the month as PDF'**
  String get pmeShareMonth;

  /// No description provided for @pmePreviousMonth.
  ///
  /// In en, this message translates to:
  /// **'Previous month'**
  String get pmePreviousMonth;

  /// No description provided for @pmeNextMonth.
  ///
  /// In en, this message translates to:
  /// **'Next month'**
  String get pmeNextMonth;

  /// No description provided for @pmeCarsOnLot.
  ///
  /// In en, this message translates to:
  /// **'Cars on the lot'**
  String get pmeCarsOnLot;

  /// No description provided for @pmeBilled.
  ///
  /// In en, this message translates to:
  /// **'Billed'**
  String get pmeBilled;

  /// No description provided for @pmeCollected.
  ///
  /// In en, this message translates to:
  /// **'Collected'**
  String get pmeCollected;

  /// No description provided for @pmeStillOwed.
  ///
  /// In en, this message translates to:
  /// **'Still owed'**
  String get pmeStillOwed;

  /// No description provided for @pmeWhoOwesCount.
  ///
  /// In en, this message translates to:
  /// **'Who owes ({count})'**
  String pmeWhoOwesCount(int count);

  /// No description provided for @pmeEveryCarCount.
  ///
  /// In en, this message translates to:
  /// **'Every car ({count})'**
  String pmeEveryCarCount(int count);

  /// No description provided for @pmeNoCars.
  ///
  /// In en, this message translates to:
  /// **'No car was on the lot that month.'**
  String get pmeNoCars;

  /// No description provided for @pmeNobodyOwes.
  ///
  /// In en, this message translates to:
  /// **'Nobody owes anything for this month.'**
  String get pmeNobodyOwes;

  /// No description provided for @pmeStillParked.
  ///
  /// In en, this message translates to:
  /// **'Still parked'**
  String get pmeStillParked;

  /// No description provided for @pmeLeft.
  ///
  /// In en, this message translates to:
  /// **'Left'**
  String get pmeLeft;

  /// No description provided for @pmeSoFar.
  ///
  /// In en, this message translates to:
  /// **'so far'**
  String get pmeSoFar;

  /// No description provided for @pmeFromBefore.
  ///
  /// In en, this message translates to:
  /// **'Unpaid from before'**
  String get pmeFromBefore;

  /// No description provided for @pmeParkingLine.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1 day} other{{days} days}} × {rate}'**
  String pmeParkingLine(int days, String rate);

  /// No description provided for @pmeDays.
  ///
  /// In en, this message translates to:
  /// **'{days, plural, =1{1 day} other{{days} days}}'**
  String pmeDays(int days);

  /// No description provided for @pmeSharePdf.
  ///
  /// In en, this message translates to:
  /// **'View the bill as PDF'**
  String get pmeSharePdf;

  /// No description provided for @pmeSendText.
  ///
  /// In en, this message translates to:
  /// **'Send as text'**
  String get pmeSendText;

  /// No description provided for @pmeOpenCar.
  ///
  /// In en, this message translates to:
  /// **'Open the car to record a payment'**
  String get pmeOpenCar;

  /// No description provided for @pmePdfFailed.
  ///
  /// In en, this message translates to:
  /// **'The PDF could not be made. Try again.'**
  String get pmePdfFailed;

  /// No description provided for @pmePdfBill.
  ///
  /// In en, this message translates to:
  /// **'MONTHLY BILL'**
  String get pmePdfBill;

  /// No description provided for @pmePdfSummary.
  ///
  /// In en, this message translates to:
  /// **'MONTH END'**
  String get pmePdfSummary;

  /// No description provided for @pmePdfVehicle.
  ///
  /// In en, this message translates to:
  /// **'Vehicle'**
  String get pmePdfVehicle;

  /// No description provided for @pmePdfPeriod.
  ///
  /// In en, this message translates to:
  /// **'Period'**
  String get pmePdfPeriod;

  /// No description provided for @pmeWhoOwes.
  ///
  /// In en, this message translates to:
  /// **'Who still owes'**
  String get pmeWhoOwes;

  /// No description provided for @pmeCars.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 car} other{{count} cars}}'**
  String pmeCars(int count);

  /// No description provided for @pmeCar.
  ///
  /// In en, this message translates to:
  /// **'Car'**
  String get pmeCar;

  /// No description provided for @pmeAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount'**
  String get pmeAmount;

  /// No description provided for @pmeTo.
  ///
  /// In en, this message translates to:
  /// **'to'**
  String get pmeTo;

  /// No description provided for @pmeRegisteredTo.
  ///
  /// In en, this message translates to:
  /// **'registered to'**
  String get pmeRegisteredTo;

  /// No description provided for @pmeMonthTotal.
  ///
  /// In en, this message translates to:
  /// **'Total for the month'**
  String get pmeMonthTotal;

  /// No description provided for @pmeEveryoneCount.
  ///
  /// In en, this message translates to:
  /// **'Everyone ({count})'**
  String pmeEveryoneCount(int count);

  /// No description provided for @pmePaidCount.
  ///
  /// In en, this message translates to:
  /// **'Paid ({count})'**
  String pmePaidCount(int count);

  /// No description provided for @pmeNobodyPaid.
  ///
  /// In en, this message translates to:
  /// **'Nobody has paid for this month yet.'**
  String get pmeNobodyPaid;

  /// No description provided for @pmeCustomersOwe.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 customer owes} other{{count} customers owe}}'**
  String pmeCustomersOwe(int count);

  /// No description provided for @pmePickCar.
  ///
  /// In en, this message translates to:
  /// **'Which car?'**
  String get pmePickCar;

  /// No description provided for @pmeActivities.
  ///
  /// In en, this message translates to:
  /// **'Activities'**
  String get pmeActivities;

  /// No description provided for @pmeActivity.
  ///
  /// In en, this message translates to:
  /// **'Activity'**
  String get pmeActivity;

  /// No description provided for @pmeDate.
  ///
  /// In en, this message translates to:
  /// **'Date'**
  String get pmeDate;

  /// No description provided for @pmeParking.
  ///
  /// In en, this message translates to:
  /// **'Parking'**
  String get pmeParking;

  /// No description provided for @pmePaidToward.
  ///
  /// In en, this message translates to:
  /// **'Paid toward'**
  String get pmePaidToward;

  /// No description provided for @pmePaidWord.
  ///
  /// In en, this message translates to:
  /// **'paid'**
  String get pmePaidWord;

  /// No description provided for @pmeDueWord.
  ///
  /// In en, this message translates to:
  /// **'due'**
  String get pmeDueWord;

  /// No description provided for @pmeItems.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}}'**
  String pmeItems(int count);

  /// No description provided for @pmeActivitiesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 activity} other{{count} activities}}'**
  String pmeActivitiesCount(int count);

  /// No description provided for @pmePaidInFull.
  ///
  /// In en, this message translates to:
  /// **'paid in full'**
  String get pmePaidInFull;

  /// No description provided for @pmeMarkAllPaid.
  ///
  /// In en, this message translates to:
  /// **'Mark all paid'**
  String get pmeMarkAllPaid;

  /// No description provided for @pmeSettleHint.
  ///
  /// In en, this message translates to:
  /// **'Each line is recorded the same way a payment is recorded by hand, so it shows on the car or the activity, in its history, and in your reports.'**
  String get pmeSettleHint;

  /// No description provided for @pmeTotalToRecord.
  ///
  /// In en, this message translates to:
  /// **'Total to record'**
  String get pmeTotalToRecord;

  /// No description provided for @pmeWhoTookIt.
  ///
  /// In en, this message translates to:
  /// **'Who took the money?'**
  String get pmeWhoTookIt;

  /// No description provided for @pmeSayWhoReceived.
  ///
  /// In en, this message translates to:
  /// **'Say who received the money.'**
  String get pmeSayWhoReceived;

  /// No description provided for @pmeNotIncluded.
  ///
  /// In en, this message translates to:
  /// **'paid online, not included'**
  String get pmeNotIncluded;

  /// No description provided for @pmeRecordTotal.
  ///
  /// In en, this message translates to:
  /// **'Record {amount}'**
  String pmeRecordTotal(String amount);

  /// No description provided for @pmeTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try the {count} again'**
  String pmeTryAgain(int count);

  /// No description provided for @pmeRecordingProgress.
  ///
  /// In en, this message translates to:
  /// **'Recording {done} of {total}…'**
  String pmeRecordingProgress(int done, int total);

  /// No description provided for @pmeRecordedAll.
  ///
  /// In en, this message translates to:
  /// **'Recorded {amount} — {count, plural, =1{1 item} other{{count} items}}.'**
  String pmeRecordedAll(String amount, int count);

  /// No description provided for @pmeSomeFailed.
  ///
  /// In en, this message translates to:
  /// **'{done} of {total} recorded. These did not save:'**
  String pmeSomeFailed(int done, int total);

  /// No description provided for @pmeAlreadyPaid.
  ///
  /// In en, this message translates to:
  /// **'{count} already paid'**
  String pmeAlreadyPaid(int count);

  /// No description provided for @ctrPrintLabels.
  ///
  /// In en, this message translates to:
  /// **'Print labels'**
  String get ctrPrintLabels;

  /// No description provided for @ctrPrintLineLabels.
  ///
  /// In en, this message translates to:
  /// **'Print labels for this package'**
  String get ctrPrintLineLabels;

  /// No description provided for @ctrPrintLabelsAll.
  ///
  /// In en, this message translates to:
  /// **'Labels for every package on {name}'**
  String ctrPrintLabelsAll(String name);

  /// No description provided for @ctrPrintLabelsOne.
  ///
  /// In en, this message translates to:
  /// **'Labels for {item} only'**
  String ctrPrintLabelsOne(String item);

  /// No description provided for @ctrLabelPaper.
  ///
  /// In en, this message translates to:
  /// **'Paper'**
  String get ctrLabelPaper;

  /// No description provided for @ctrLabelSheet.
  ///
  /// In en, this message translates to:
  /// **'Letter sheet'**
  String get ctrLabelSheet;

  /// No description provided for @ctrLabelSheetNote.
  ///
  /// In en, this message translates to:
  /// **'Avery 5524 or any 2 × 3 letter label sheet, six labels a page.'**
  String get ctrLabelSheetNote;

  /// No description provided for @ctrLabelThermal.
  ///
  /// In en, this message translates to:
  /// **'4 × 6 thermal'**
  String get ctrLabelThermal;

  /// No description provided for @ctrLabelThermalNote.
  ///
  /// In en, this message translates to:
  /// **'One label per 4 × 6 in. roll label, for Zebra, Rollo and similar printers.'**
  String get ctrLabelThermalNote;

  /// No description provided for @ctrLabelCopies.
  ///
  /// In en, this message translates to:
  /// **'Labels per piece'**
  String get ctrLabelCopies;

  /// No description provided for @ctrLabelTwo.
  ///
  /// In en, this message translates to:
  /// **'Two'**
  String get ctrLabelTwo;

  /// No description provided for @ctrLabelTwoNote.
  ///
  /// In en, this message translates to:
  /// **'One for each side, so the package can still be read if one gets torn.'**
  String get ctrLabelTwoNote;

  /// No description provided for @ctrLabelOne.
  ///
  /// In en, this message translates to:
  /// **'One'**
  String get ctrLabelOne;

  /// No description provided for @ctrLabelOneNote.
  ///
  /// In en, this message translates to:
  /// **'To replace a single torn or lost label.'**
  String get ctrLabelOneNote;

  /// No description provided for @ctrLabelPrintButton.
  ///
  /// In en, this message translates to:
  /// **'Open labels to print'**
  String get ctrLabelPrintButton;

  /// No description provided for @ctrLabelOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening…'**
  String get ctrLabelOpening;

  /// No description provided for @ctrLabelsCouldNotOpen.
  ///
  /// In en, this message translates to:
  /// **'The labels could not be opened. Try again in a moment.'**
  String get ctrLabelsCouldNotOpen;

  /// No description provided for @ctrLabelTip.
  ///
  /// In en, this message translates to:
  /// **'Labels open in your browser, ready to print. On barrels, weatherproof labels or clear tape over the label keep the code readable through rain.'**
  String get ctrLabelTip;

  /// No description provided for @pkgScanAction.
  ///
  /// In en, this message translates to:
  /// **'Scan package'**
  String get pkgScanAction;

  /// No description provided for @pkgScanTitle.
  ///
  /// In en, this message translates to:
  /// **'Find a package'**
  String get pkgScanTitle;

  /// No description provided for @pkgScanHint.
  ///
  /// In en, this message translates to:
  /// **'Point at the QR code on the package label'**
  String get pkgScanHint;

  /// No description provided for @pkgNotAPackageQr.
  ///
  /// In en, this message translates to:
  /// **'That QR code is not a Laawol package label.'**
  String get pkgNotAPackageQr;

  /// No description provided for @pkgCameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is unavailable. Type the code printed on the label, or search by name or phone below.'**
  String get pkgCameraUnavailable;

  /// No description provided for @pkgTypeCode.
  ///
  /// In en, this message translates to:
  /// **'Type the code'**
  String get pkgTypeCode;

  /// No description provided for @pkgQueryHint.
  ///
  /// In en, this message translates to:
  /// **'CL-K7M4P2, a name or a phone'**
  String get pkgQueryHint;

  /// No description provided for @pkgQueryNote.
  ///
  /// In en, this message translates to:
  /// **'Label too damaged to scan? Type the code printed beside the QR, or search by the customer\'s or receiver\'s name or phone.'**
  String get pkgQueryNote;

  /// No description provided for @pkgClear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get pkgClear;

  /// No description provided for @pkgOpenCode.
  ///
  /// In en, this message translates to:
  /// **'Open {code}'**
  String pkgOpenCode(String code);

  /// No description provided for @pkgNoMatchHint.
  ///
  /// In en, this message translates to:
  /// **'Search covers customer and receiver names and phones, and VINs, on all your containers.'**
  String get pkgNoMatchHint;

  /// No description provided for @pkgTitle.
  ///
  /// In en, this message translates to:
  /// **'Package'**
  String get pkgTitle;

  /// No description provided for @pkgCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'This package could not be loaded. Check your connection and try again.'**
  String get pkgCouldNotLoad;

  /// No description provided for @pkgCouldNotOpenApp.
  ///
  /// In en, this message translates to:
  /// **'That could not be opened on this phone.'**
  String get pkgCouldNotOpenApp;

  /// No description provided for @pkgNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'{code} is not on any of your containers'**
  String pkgNotFoundTitle(String code);

  /// No description provided for @pkgNotFoundHint.
  ///
  /// In en, this message translates to:
  /// **'The code may be mistyped, or the package belongs to another business. Its public tracking page still shows where it is going.'**
  String get pkgNotFoundHint;

  /// No description provided for @pkgLineGone.
  ///
  /// In en, this message translates to:
  /// **'This package is no longer on any of your containers.'**
  String get pkgLineGone;

  /// No description provided for @pkgLookUpPublicly.
  ///
  /// In en, this message translates to:
  /// **'Open the public tracking page'**
  String get pkgLookUpPublicly;

  /// No description provided for @pkgWhatItIs.
  ///
  /// In en, this message translates to:
  /// **'What it is'**
  String get pkgWhatItIs;

  /// No description provided for @pkgQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity: {count}'**
  String pkgQuantity(int count);

  /// No description provided for @pkgVin.
  ///
  /// In en, this message translates to:
  /// **'VIN {vin}'**
  String pkgVin(String vin);

  /// No description provided for @pkgOwner.
  ///
  /// In en, this message translates to:
  /// **'Owner'**
  String get pkgOwner;

  /// No description provided for @pkgNoReceiver.
  ///
  /// In en, this message translates to:
  /// **'No receiver recorded.'**
  String get pkgNoReceiver;

  /// No description provided for @pkgContainer.
  ///
  /// In en, this message translates to:
  /// **'Container'**
  String get pkgContainer;

  /// No description provided for @pkgContainerUnknown.
  ///
  /// In en, this message translates to:
  /// **'Container not found.'**
  String get pkgContainerUnknown;

  /// No description provided for @pkgUpdates.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp updates'**
  String get pkgUpdates;

  /// No description provided for @pkgReprintLabels.
  ///
  /// In en, this message translates to:
  /// **'Reprint labels'**
  String get pkgReprintLabels;

  /// No description provided for @pkgOpenContainer.
  ///
  /// In en, this message translates to:
  /// **'Open container'**
  String get pkgOpenContainer;

  /// No description provided for @pkgNoCode.
  ///
  /// In en, this message translates to:
  /// **'No tracking code yet'**
  String get pkgNoCode;

  /// No description provided for @pkgNoName.
  ///
  /// In en, this message translates to:
  /// **'No name'**
  String get pkgNoName;

  /// No description provided for @pkgNoPhone.
  ///
  /// In en, this message translates to:
  /// **'No phone'**
  String get pkgNoPhone;

  /// No description provided for @pkgCall.
  ///
  /// In en, this message translates to:
  /// **'Call'**
  String get pkgCall;

  /// No description provided for @pkgWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp'**
  String get pkgWhatsApp;

  /// No description provided for @pkgNoUpdateYet.
  ///
  /// In en, this message translates to:
  /// **'No update has been sent yet. The first goes out when the container sails.'**
  String get pkgNoUpdateYet;

  /// No description provided for @pkgLastUpdate.
  ///
  /// In en, this message translates to:
  /// **'Last update: {moment}'**
  String pkgLastUpdate(String moment);

  /// No description provided for @pkgLastUpdateAt.
  ///
  /// In en, this message translates to:
  /// **'Last update: {moment}, {when}'**
  String pkgLastUpdateAt(String moment, String when);

  /// No description provided for @pkgUpdateResult.
  ///
  /// In en, this message translates to:
  /// **'{who}: {status}'**
  String pkgUpdateResult(String who, String status);

  /// No description provided for @pkgMomentShipped.
  ///
  /// In en, this message translates to:
  /// **'left port'**
  String get pkgMomentShipped;

  /// No description provided for @pkgMomentAtPort.
  ///
  /// In en, this message translates to:
  /// **'at the destination port'**
  String get pkgMomentAtPort;

  /// No description provided for @pkgMomentArrived.
  ///
  /// In en, this message translates to:
  /// **'ready for pickup'**
  String get pkgMomentArrived;

  /// No description provided for @pkgMomentReceived.
  ///
  /// In en, this message translates to:
  /// **'received'**
  String get pkgMomentReceived;

  /// No description provided for @pkgResultSent.
  ///
  /// In en, this message translates to:
  /// **'sent'**
  String get pkgResultSent;

  /// No description provided for @pkgResultFailed.
  ///
  /// In en, this message translates to:
  /// **'failed to send'**
  String get pkgResultFailed;

  /// No description provided for @pkgResultWaiting.
  ///
  /// In en, this message translates to:
  /// **'waiting for WhatsApp to be connected'**
  String get pkgResultWaiting;

  /// No description provided for @pkgResultWaitingTemplate.
  ///
  /// In en, this message translates to:
  /// **'waiting for WhatsApp to approve the message'**
  String get pkgResultWaitingTemplate;

  /// No description provided for @pkgResultNoPhone.
  ///
  /// In en, this message translates to:
  /// **'not sent, no phone'**
  String get pkgResultNoPhone;

  /// No description provided for @pkgResultSwitchedOff.
  ///
  /// In en, this message translates to:
  /// **'not sent, updates switched off'**
  String get pkgResultSwitchedOff;

  /// No description provided for @pkgResultNeedsCountryCode.
  ///
  /// In en, this message translates to:
  /// **'not sent, the phone has no country code'**
  String get pkgResultNeedsCountryCode;

  /// No description provided for @pkgResultNotSent.
  ///
  /// In en, this message translates to:
  /// **'not sent'**
  String get pkgResultNotSent;

  /// No description provided for @moneyAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount like 12.50 or 1,200.50.'**
  String get moneyAmountInvalid;

  /// No description provided for @authErrorUserDisabled.
  ///
  /// In en, this message translates to:
  /// **'This account has been disabled. Contact support if you think this is a mistake.'**
  String get authErrorUserDisabled;

  /// No description provided for @authErrorTooManyRequests.
  ///
  /// In en, this message translates to:
  /// **'Too many attempts. Wait a few minutes and try again.'**
  String get authErrorTooManyRequests;

  /// No description provided for @authErrorNetwork.
  ///
  /// In en, this message translates to:
  /// **'No connection. Check your internet and try again.'**
  String get authErrorNetwork;

  /// No description provided for @authErrorWeakPassword.
  ///
  /// In en, this message translates to:
  /// **'Choose a stronger password - at least 6 characters.'**
  String get authErrorWeakPassword;

  /// No description provided for @authErrorEmailInUse.
  ///
  /// In en, this message translates to:
  /// **'An account already exists with this email.'**
  String get authErrorEmailInUse;

  /// No description provided for @authErrorNoAccountForEmail.
  ///
  /// In en, this message translates to:
  /// **'No account uses this email.'**
  String get authErrorNoAccountForEmail;

  /// No description provided for @authErrorSignInUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Signing in with email is not available right now. Contact support.'**
  String get authErrorSignInUnavailable;

  /// No description provided for @authErrorSignInRequired.
  ///
  /// In en, this message translates to:
  /// **'Sign in first.'**
  String get authErrorSignInRequired;

  /// No description provided for @authErrorInvalidOwnerPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid owner phone number with country code.'**
  String get authErrorInvalidOwnerPhone;

  /// No description provided for @authErrorInvalidBusinessPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid business phone number with country code.'**
  String get authErrorInvalidBusinessPhone;

  /// No description provided for @authErrorUnknown.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get authErrorUnknown;

  /// No description provided for @supportLoadEarlierMessages.
  ///
  /// In en, this message translates to:
  /// **'Load earlier messages'**
  String get supportLoadEarlierMessages;

  /// No description provided for @recordSavedReceiptUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Saved. Tracking number: {trackingCode}. The receipt could not be printed, but the record is saved - do not save it again.'**
  String recordSavedReceiptUnavailable(String trackingCode);

  /// No description provided for @invStatCollectedThisMonth.
  ///
  /// In en, this message translates to:
  /// **'Collected this month'**
  String get invStatCollectedThisMonth;

  /// No description provided for @invLoadOlder.
  ///
  /// In en, this message translates to:
  /// **'Load older invoices'**
  String get invLoadOlder;

  /// No description provided for @invSearchLoadedHint.
  ///
  /// In en, this message translates to:
  /// **'Search covers every open invoice and the most recent paid ones. Load older invoices to search further back.'**
  String get invSearchLoadedHint;

  /// No description provided for @purchaseStatusAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get purchaseStatusAll;

  /// No description provided for @purchaseStatusReviewPending.
  ///
  /// In en, this message translates to:
  /// **'Review pending'**
  String get purchaseStatusReviewPending;

  /// No description provided for @purchaseStatusNoShow.
  ///
  /// In en, this message translates to:
  /// **'No-show'**
  String get purchaseStatusNoShow;

  /// No description provided for @purchaseStatusForfeited.
  ///
  /// In en, this message translates to:
  /// **'Deposit forfeited'**
  String get purchaseStatusForfeited;

  /// No description provided for @paymentStatusFailed.
  ///
  /// In en, this message translates to:
  /// **'Failed'**
  String get paymentStatusFailed;

  /// No description provided for @paymentStatusNotRequired.
  ///
  /// In en, this message translates to:
  /// **'Not required'**
  String get paymentStatusNotRequired;

  /// No description provided for @extensionStatusRejected.
  ///
  /// In en, this message translates to:
  /// **'Rejected'**
  String get extensionStatusRejected;

  /// No description provided for @extensionPaymentSuffix.
  ///
  /// In en, this message translates to:
  /// **' • payment {status}'**
  String extensionPaymentSuffix(String status);

  /// No description provided for @purchaseMarkSoldTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark car sold?'**
  String get purchaseMarkSoldTitle;

  /// No description provided for @purchaseMarkSoldMessage.
  ///
  /// In en, this message translates to:
  /// **'This will complete the paid hold for {carTitle}.'**
  String purchaseMarkSoldMessage(String carTitle);

  /// No description provided for @purchaseNoShowTitle.
  ///
  /// In en, this message translates to:
  /// **'Customer did not come?'**
  String get purchaseNoShowTitle;

  /// No description provided for @purchaseNoShowMessage.
  ///
  /// In en, this message translates to:
  /// **'This will release {carTitle}, forfeit the hold deposit, and add this outcome to the buyer history.'**
  String purchaseNoShowMessage(String carTitle);

  /// No description provided for @purchaseApproveExtensionTitle.
  ///
  /// In en, this message translates to:
  /// **'Approve extension?'**
  String get purchaseApproveExtensionTitle;

  /// No description provided for @purchaseRejectExtensionTitle.
  ///
  /// In en, this message translates to:
  /// **'Reject extension?'**
  String get purchaseRejectExtensionTitle;

  /// No description provided for @purchaseApproveExtensionMessage.
  ///
  /// In en, this message translates to:
  /// **'The customer will be allowed to pay the extra hold amount.'**
  String get purchaseApproveExtensionMessage;

  /// No description provided for @purchaseRejectExtensionMessage.
  ///
  /// In en, this message translates to:
  /// **'The current hold date will stay unchanged.'**
  String get purchaseRejectExtensionMessage;

  /// No description provided for @purchaseApprove.
  ///
  /// In en, this message translates to:
  /// **'Approve'**
  String get purchaseApprove;

  /// No description provided for @purchaseReject.
  ///
  /// In en, this message translates to:
  /// **'Reject'**
  String get purchaseReject;

  /// No description provided for @purchaseForfeitedCannotComplete.
  ///
  /// In en, this message translates to:
  /// **'A hold whose deposit was forfeited cannot be completed.'**
  String get purchaseForfeitedCannotComplete;

  /// No description provided for @purchaseFilterBusiness.
  ///
  /// In en, this message translates to:
  /// **'Business'**
  String get purchaseFilterBusiness;

  /// No description provided for @purchaseAllBusinesses.
  ///
  /// In en, this message translates to:
  /// **'All businesses'**
  String get purchaseAllBusinesses;

  /// No description provided for @purchaseLoadMore.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get purchaseLoadMore;

  /// No description provided for @holdMaxDaysOutOfRange.
  ///
  /// In en, this message translates to:
  /// **'Hold max days must be between 1 and 30.'**
  String get holdMaxDaysOutOfRange;

  /// No description provided for @holdAmountMustBePositive.
  ///
  /// In en, this message translates to:
  /// **'Enter a positive paid hold amount.'**
  String get holdAmountMustBePositive;

  /// No description provided for @holdMaxDaysLabel.
  ///
  /// In en, this message translates to:
  /// **'Maximum hold days (1-30)'**
  String get holdMaxDaysLabel;

  /// No description provided for @paidHoldReviewLabel.
  ///
  /// In en, this message translates to:
  /// **'Paid hold'**
  String get paidHoldReviewLabel;

  /// No description provided for @holdPricingBusinessDefault.
  ///
  /// In en, this message translates to:
  /// **'Business default'**
  String get holdPricingBusinessDefault;

  /// No description provided for @holdPricingFlatAmount.
  ///
  /// In en, this message translates to:
  /// **'Flat {amount}'**
  String holdPricingFlatAmount(String amount);

  /// No description provided for @holdPricingPerDayAmount.
  ///
  /// In en, this message translates to:
  /// **'{amount} per day'**
  String holdPricingPerDayAmount(String amount);

  /// No description provided for @openBarrelsJoinRequestSent.
  ///
  /// In en, this message translates to:
  /// **'Join request sent. Deposit: {deposit}'**
  String openBarrelsJoinRequestSent(String deposit);

  /// No description provided for @openBarrelsPosted.
  ///
  /// In en, this message translates to:
  /// **'Shared barrel posted. Deposit: {deposit}'**
  String openBarrelsPosted(String deposit);

  /// No description provided for @openBarrelsPickupFee.
  ///
  /// In en, this message translates to:
  /// **'Pickup fee: {amount}'**
  String openBarrelsPickupFee(String amount);

  /// No description provided for @openBarrelsDropOffAt.
  ///
  /// In en, this message translates to:
  /// **'Drop off at {address}'**
  String openBarrelsDropOffAt(String address);

  /// No description provided for @openBarrelsWalletApplied.
  ///
  /// In en, this message translates to:
  /// **'wallet applied {amount}'**
  String openBarrelsWalletApplied(String amount);

  /// No description provided for @openBarrelsCardAmount.
  ///
  /// In en, this message translates to:
  /// **'card {amount}'**
  String openBarrelsCardAmount(String amount);

  /// No description provided for @ctrSendStatus.
  ///
  /// In en, this message translates to:
  /// **'Send current status on WhatsApp'**
  String get ctrSendStatus;

  /// No description provided for @ctrSendStatusTitle.
  ///
  /// In en, this message translates to:
  /// **'Send the current status?'**
  String get ctrSendStatusTitle;

  /// No description provided for @ctrSendStatusMessage.
  ///
  /// In en, this message translates to:
  /// **'Everyone on this container who hasn’t heard its latest update gets it on WhatsApp now. People who already have it are not messaged again.'**
  String get ctrSendStatusMessage;

  /// No description provided for @ctrSendStatusConfirm.
  ///
  /// In en, this message translates to:
  /// **'Send'**
  String get ctrSendStatusConfirm;

  /// No description provided for @ctrSendStatusQueued.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Sending “{moment}” to 1 person on WhatsApp.} other{Sending “{moment}” to {count} people on WhatsApp.}}'**
  String ctrSendStatusQueued(int count, String moment);

  /// No description provided for @ctrSendStatusInFlight.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 message is already on its way.} other{{count} messages are already on their way.}}'**
  String ctrSendStatusInFlight(int count);

  /// No description provided for @ctrSendStatusNothingToSend.
  ///
  /// In en, this message translates to:
  /// **'Everyone who can be reached already has the latest update.'**
  String get ctrSendStatusNothingToSend;

  /// No description provided for @ctrSendStatusAlreadyHad.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 person already had it.} other{{count} people already had it.}}'**
  String ctrSendStatusAlreadyHad(int count);

  /// No description provided for @ctrSendStatusCantReach.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 person can’t be reached (no phone, updates off, or no country code).} other{{count} people can’t be reached (no phone, updates off, or no country code).}}'**
  String ctrSendStatusCantReach(int count);

  /// No description provided for @ctrSendStatusNoNews.
  ///
  /// In en, this message translates to:
  /// **'This container has no news for customers yet. They hear when it ships.'**
  String get ctrSendStatusNoNews;

  /// No description provided for @ctrWhatsAppNotConnectedTitle.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp isn’t connected yet'**
  String get ctrWhatsAppNotConnectedTitle;

  /// No description provided for @ctrWhatsAppNotConnectedMessage.
  ///
  /// In en, this message translates to:
  /// **'Nothing was sent. Updates are being recorded, and once the platform connects WhatsApp you can send everyone on this container its current status from here.'**
  String get ctrWhatsAppNotConnectedMessage;

  /// No description provided for @pkgResultQueued.
  ///
  /// In en, this message translates to:
  /// **'queued to send'**
  String get pkgResultQueued;

  /// No description provided for @pkgResultSending.
  ///
  /// In en, this message translates to:
  /// **'sending'**
  String get pkgResultSending;

  /// No description provided for @pkgResultRetrying.
  ///
  /// In en, this message translates to:
  /// **'retrying after a failed try'**
  String get pkgResultRetrying;

  /// No description provided for @businessServiceBarrelShipping.
  ///
  /// In en, this message translates to:
  /// **'Barrel shipping'**
  String get businessServiceBarrelShipping;

  /// No description provided for @businessServiceSharedBarrels.
  ///
  /// In en, this message translates to:
  /// **'Shared barrels'**
  String get businessServiceSharedBarrels;

  /// No description provided for @businessServiceFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight (parcels)'**
  String get businessServiceFreight;

  /// No description provided for @businessServiceCarSales.
  ///
  /// In en, this message translates to:
  /// **'Car sales'**
  String get businessServiceCarSales;

  /// No description provided for @businessServiceCarParking.
  ///
  /// In en, this message translates to:
  /// **'Car parking'**
  String get businessServiceCarParking;

  /// No description provided for @businessServiceCarTransport.
  ///
  /// In en, this message translates to:
  /// **'Car transport'**
  String get businessServiceCarTransport;

  /// No description provided for @businessServiceBarrelShippingHint.
  ///
  /// In en, this message translates to:
  /// **'Ship barrels to destination countries.'**
  String get businessServiceBarrelShippingHint;

  /// No description provided for @businessServiceSharedBarrelsHint.
  ///
  /// In en, this message translates to:
  /// **'Pool partial barrels and match customers by destination.'**
  String get businessServiceSharedBarrelsHint;

  /// No description provided for @businessServiceFreightHint.
  ///
  /// In en, this message translates to:
  /// **'Ship parcels and boxes by weight, by air or sea.'**
  String get businessServiceFreightHint;

  /// No description provided for @businessServiceCarSalesHint.
  ///
  /// In en, this message translates to:
  /// **'List cars for customers to browse and buy.'**
  String get businessServiceCarSalesHint;

  /// No description provided for @businessServiceCarParkingHint.
  ///
  /// In en, this message translates to:
  /// **'Manage parked cars and parking receipts.'**
  String get businessServiceCarParkingHint;

  /// No description provided for @businessServiceCarTransportHint.
  ///
  /// In en, this message translates to:
  /// **'Track car transport requests.'**
  String get businessServiceCarTransportHint;

  /// No description provided for @customerServiceCars.
  ///
  /// In en, this message translates to:
  /// **'Cars'**
  String get customerServiceCars;

  /// No description provided for @customerServiceBarrel.
  ///
  /// In en, this message translates to:
  /// **'Send barrels'**
  String get customerServiceBarrel;

  /// No description provided for @customerServiceShared.
  ///
  /// In en, this message translates to:
  /// **'Shared barrels'**
  String get customerServiceShared;

  /// No description provided for @customerServiceFreight.
  ///
  /// In en, this message translates to:
  /// **'Freight'**
  String get customerServiceFreight;

  /// No description provided for @customerServicePark.
  ///
  /// In en, this message translates to:
  /// **'Park a car'**
  String get customerServicePark;

  /// No description provided for @customerServiceTransport.
  ///
  /// In en, this message translates to:
  /// **'Transport'**
  String get customerServiceTransport;

  /// No description provided for @customerServicePurchases.
  ///
  /// In en, this message translates to:
  /// **'Purchases'**
  String get customerServicePurchases;

  /// No description provided for @customerServiceViewings.
  ///
  /// In en, this message translates to:
  /// **'Car viewings'**
  String get customerServiceViewings;

  /// No description provided for @customerServiceTracking.
  ///
  /// In en, this message translates to:
  /// **'Tracking'**
  String get customerServiceTracking;

  /// No description provided for @transportJourneyBooked.
  ///
  /// In en, this message translates to:
  /// **'Booked'**
  String get transportJourneyBooked;

  /// No description provided for @transportJourneyScheduled.
  ///
  /// In en, this message translates to:
  /// **'Scheduled'**
  String get transportJourneyScheduled;

  /// No description provided for @transportJourneyOnItsWay.
  ///
  /// In en, this message translates to:
  /// **'On its way'**
  String get transportJourneyOnItsWay;

  /// No description provided for @transportJourneyDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get transportJourneyDelivered;

  /// No description provided for @openBarrelsDeadline.
  ///
  /// In en, this message translates to:
  /// **'Deadline'**
  String get openBarrelsDeadline;

  /// No description provided for @openBarrelsMode.
  ///
  /// In en, this message translates to:
  /// **'Mode'**
  String get openBarrelsMode;

  /// No description provided for @openBarrelsDeposit.
  ///
  /// In en, this message translates to:
  /// **'Deposit'**
  String get openBarrelsDeposit;

  /// No description provided for @openBarrelsPerShare.
  ///
  /// In en, this message translates to:
  /// **'Per share'**
  String get openBarrelsPerShare;

  /// No description provided for @openBarrelsAckDelay.
  ///
  /// In en, this message translates to:
  /// **'I understand one bad item can delay the shared barrel.'**
  String get openBarrelsAckDelay;

  /// No description provided for @openBarrelsAckProhibited.
  ///
  /// In en, this message translates to:
  /// **'I confirm there are no prohibited or unsafe items.'**
  String get openBarrelsAckProhibited;

  /// No description provided for @openBarrelsAckContents.
  ///
  /// In en, this message translates to:
  /// **'I confirm the contents and estimated weight are accurate.'**
  String get openBarrelsAckContents;

  /// No description provided for @openBarrelsPickupBorough.
  ///
  /// In en, this message translates to:
  /// **'Pickup borough'**
  String get openBarrelsPickupBorough;

  /// No description provided for @openBarrelsPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup address'**
  String get openBarrelsPickupAddress;

  /// No description provided for @openBarrelsRequestPickup.
  ///
  /// In en, this message translates to:
  /// **'Request pickup'**
  String get openBarrelsRequestPickup;

  /// No description provided for @openBarrelsChoosePickupTime.
  ///
  /// In en, this message translates to:
  /// **'Choose pickup time'**
  String get openBarrelsChoosePickupTime;

  /// No description provided for @openBarrelsPostButton.
  ///
  /// In en, this message translates to:
  /// **'Post barrel'**
  String get openBarrelsPostButton;

  /// No description provided for @openBarrelsContentsLabel.
  ///
  /// In en, this message translates to:
  /// **'What are you sending?'**
  String get openBarrelsContentsLabel;

  /// No description provided for @openBarrelsReceiverName.
  ///
  /// In en, this message translates to:
  /// **'Receiver name'**
  String get openBarrelsReceiverName;

  /// No description provided for @openBarrelsSenderName.
  ///
  /// In en, this message translates to:
  /// **'Sender name'**
  String get openBarrelsSenderName;

  /// No description provided for @openBarrelsYourShares.
  ///
  /// In en, this message translates to:
  /// **'Your shares'**
  String get openBarrelsYourShares;

  /// No description provided for @openBarrelsTotalShares.
  ///
  /// In en, this message translates to:
  /// **'Total shares'**
  String get openBarrelsTotalShares;

  /// No description provided for @openBarrelsBusinessAndDestination.
  ///
  /// In en, this message translates to:
  /// **'Business and destination'**
  String get openBarrelsBusinessAndDestination;

  /// No description provided for @openBarrelsPostHint.
  ///
  /// In en, this message translates to:
  /// **'Share the open space so others can join and fill the barrel.'**
  String get openBarrelsPostHint;

  /// No description provided for @openBarrelsPostTitle.
  ///
  /// In en, this message translates to:
  /// **'Post a partial barrel'**
  String get openBarrelsPostTitle;

  /// No description provided for @openBarrelsConfirmAcknowledgements.
  ///
  /// In en, this message translates to:
  /// **'Confirm the shared-barrel acknowledgements.'**
  String get openBarrelsConfirmAcknowledgements;

  /// No description provided for @openBarrelsPickupPriceUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Pickup price is not available yet.'**
  String get openBarrelsPickupPriceUnavailable;

  /// No description provided for @openBarrelsPickupRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a pickup address and future pickup time.'**
  String get openBarrelsPickupRequired;

  /// No description provided for @openBarrelsFillRequired.
  ///
  /// In en, this message translates to:
  /// **'Fill sender, receiver, phone, and contents.'**
  String get openBarrelsFillRequired;

  /// No description provided for @openBarrelsNoBusinesses.
  ///
  /// In en, this message translates to:
  /// **'No business is accepting shared barrels yet.'**
  String get openBarrelsNoBusinesses;

  /// No description provided for @openBarrelsDestinationsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load destinations. Check your connection and try again.'**
  String get openBarrelsDestinationsLoadFailed;

  /// No description provided for @openBarrelsSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get openBarrelsSendRequest;

  /// No description provided for @openBarrelsRequestShareHint.
  ///
  /// In en, this message translates to:
  /// **'Reserve space in this open barrel.'**
  String get openBarrelsRequestShareHint;

  /// No description provided for @openBarrelsRequestShareTitle.
  ///
  /// In en, this message translates to:
  /// **'Request a share'**
  String get openBarrelsRequestShareTitle;

  /// No description provided for @openBarrelsLeftPool.
  ///
  /// In en, this message translates to:
  /// **'You left the pool.'**
  String get openBarrelsLeftPool;

  /// No description provided for @openBarrelsPoolCancelled.
  ///
  /// In en, this message translates to:
  /// **'Pool cancelled.'**
  String get openBarrelsPoolCancelled;

  /// No description provided for @openBarrelsBalancePaid.
  ///
  /// In en, this message translates to:
  /// **'Balance paid.'**
  String get openBarrelsBalancePaid;

  /// No description provided for @openBarrelsLeavePool.
  ///
  /// In en, this message translates to:
  /// **'Leave pool'**
  String get openBarrelsLeavePool;

  /// No description provided for @openBarrelsPayBalance.
  ///
  /// In en, this message translates to:
  /// **'Pay balance'**
  String get openBarrelsPayBalance;

  /// No description provided for @openBarrelsMineEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Post a partial barrel or request a share to see it here.'**
  String get openBarrelsMineEmptyHint;

  /// No description provided for @openBarrelsMineEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No shared barrel pools yet'**
  String get openBarrelsMineEmptyTitle;

  /// No description provided for @openBarrelsMineLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load your pools'**
  String get openBarrelsMineLoadFailed;

  /// No description provided for @openBarrelsSignInHint.
  ///
  /// In en, this message translates to:
  /// **'Your shared barrel posts will appear here after you sign in.'**
  String get openBarrelsSignInHint;

  /// No description provided for @openBarrelsSignInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to see your pools'**
  String get openBarrelsSignInTitle;

  /// No description provided for @openBarrelsRequestOneShare.
  ///
  /// In en, this message translates to:
  /// **'Request one share'**
  String get openBarrelsRequestOneShare;

  /// No description provided for @openBarrelsEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'When a customer or business opens unused shares, they will appear here.'**
  String get openBarrelsEmptyHint;

  /// No description provided for @openBarrelsEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No open shared barrels yet'**
  String get openBarrelsEmptyTitle;

  /// No description provided for @openBarrelsLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load open barrels'**
  String get openBarrelsLoadFailed;

  /// No description provided for @openBarrelsTabMine.
  ///
  /// In en, this message translates to:
  /// **'My pools'**
  String get openBarrelsTabMine;

  /// No description provided for @openBarrelsTabOpen.
  ///
  /// In en, this message translates to:
  /// **'Open pools'**
  String get openBarrelsTabOpen;

  /// No description provided for @openBarrelsShareTitle.
  ///
  /// In en, this message translates to:
  /// **'Share a barrel'**
  String get openBarrelsShareTitle;

  /// No description provided for @openBarrelsPostPartial.
  ///
  /// In en, this message translates to:
  /// **'Post partial barrel'**
  String get openBarrelsPostPartial;

  /// No description provided for @sendBarrelSharedPromoTitle.
  ///
  /// In en, this message translates to:
  /// **'Can’t fill a barrel?'**
  String get sendBarrelSharedPromoTitle;

  /// No description provided for @sendBarrelSharedPromoHint.
  ///
  /// In en, this message translates to:
  /// **'Join an open shared barrel or reserve a share.'**
  String get sendBarrelSharedPromoHint;

  /// No description provided for @transportJobCancelledNotice.
  ///
  /// In en, this message translates to:
  /// **'This transport job was cancelled.'**
  String get transportJobCancelledNotice;

  /// No description provided for @shipmentLockedNotice.
  ///
  /// In en, this message translates to:
  /// **'This shipment can no longer be edited because pickup has arrived or the request is already being processed.'**
  String get shipmentLockedNotice;

  /// No description provided for @ctrStatusWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting'**
  String get ctrStatusWaiting;

  /// No description provided for @wpkWaitingTitle.
  ///
  /// In en, this message translates to:
  /// **'Waiting for a container'**
  String get wpkWaitingTitle;

  /// No description provided for @wpkEntryCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No packages waiting} =1{1 package waiting} other{{count} packages waiting}}'**
  String wpkEntryCount(int count);

  /// No description provided for @wpkEntryHint.
  ///
  /// In en, this message translates to:
  /// **'Dropped off, no container yet'**
  String get wpkEntryHint;

  /// No description provided for @wpkRegister.
  ///
  /// In en, this message translates to:
  /// **'Register a package'**
  String get wpkRegister;

  /// No description provided for @wpkEditPackage.
  ///
  /// In en, this message translates to:
  /// **'Edit package'**
  String get wpkEditPackage;

  /// No description provided for @wpkRegisterSubtitle.
  ///
  /// In en, this message translates to:
  /// **'It waits here until a container takes it.'**
  String get wpkRegisterSubtitle;

  /// No description provided for @wpkUpdatesNotice.
  ///
  /// In en, this message translates to:
  /// **'The customer and the receiver get a WhatsApp message when the package is registered, when the container ships and when it arrives. Adding it to a container sends nothing.'**
  String get wpkUpdatesNotice;

  /// No description provided for @wpkEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No packages are waiting.'**
  String get wpkEmptyTitle;

  /// No description provided for @wpkEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Register one when a customer drops it off.'**
  String get wpkEmptyHint;

  /// No description provided for @wpkNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No waiting package matches that search.'**
  String get wpkNoMatch;

  /// No description provided for @wpkDroppedOff.
  ///
  /// In en, this message translates to:
  /// **'Dropped off {date}'**
  String wpkDroppedOff(String date);

  /// No description provided for @wpkSizeTitle.
  ///
  /// In en, this message translates to:
  /// **'Size in inches (optional)'**
  String get wpkSizeTitle;

  /// No description provided for @wpkLength.
  ///
  /// In en, this message translates to:
  /// **'Length'**
  String get wpkLength;

  /// No description provided for @wpkWidth.
  ///
  /// In en, this message translates to:
  /// **'Width'**
  String get wpkWidth;

  /// No description provided for @wpkHeight.
  ///
  /// In en, this message translates to:
  /// **'Height'**
  String get wpkHeight;

  /// No description provided for @wpkSizeHint.
  ///
  /// In en, this message translates to:
  /// **'Length × width × height. All three, or leave them empty.'**
  String get wpkSizeHint;

  /// No description provided for @wpkPrice.
  ///
  /// In en, this message translates to:
  /// **'Price (US dollars)'**
  String get wpkPrice;

  /// No description provided for @wpkPriceHint.
  ///
  /// In en, this message translates to:
  /// **'Leave empty if there is no price yet.'**
  String get wpkPriceHint;

  /// No description provided for @wpkPayOnArrival.
  ///
  /// In en, this message translates to:
  /// **'Pay on arrival'**
  String get wpkPayOnArrival;

  /// No description provided for @wpkPayOnArrivalNote.
  ///
  /// In en, this message translates to:
  /// **'The team at the destination will record the money.'**
  String get wpkPayOnArrivalNote;

  /// No description provided for @wpkSaveAndPrint.
  ///
  /// In en, this message translates to:
  /// **'Save & print label'**
  String get wpkSaveAndPrint;

  /// No description provided for @wpkSaveAndAnother.
  ///
  /// In en, this message translates to:
  /// **'Save & add another for the same customer'**
  String get wpkSaveAndAnother;

  /// No description provided for @wpkSaved.
  ///
  /// In en, this message translates to:
  /// **'Package saved: {code}'**
  String wpkSaved(String code);

  /// No description provided for @wpkSavedNoCode.
  ///
  /// In en, this message translates to:
  /// **'Package saved.'**
  String get wpkSavedNoCode;

  /// No description provided for @wpkUpdated.
  ///
  /// In en, this message translates to:
  /// **'Package updated.'**
  String get wpkUpdated;

  /// No description provided for @wpkRemove.
  ///
  /// In en, this message translates to:
  /// **'Remove package'**
  String get wpkRemove;

  /// No description provided for @wpkRemoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Remove this package?'**
  String get wpkRemoveTitle;

  /// No description provided for @wpkRemoveMessage.
  ///
  /// In en, this message translates to:
  /// **'It leaves the waiting list and its label stops working.'**
  String get wpkRemoveMessage;

  /// No description provided for @wpkRemoved.
  ///
  /// In en, this message translates to:
  /// **'Package removed.'**
  String get wpkRemoved;

  /// No description provided for @wpkMoney.
  ///
  /// In en, this message translates to:
  /// **'Price & payments'**
  String get wpkMoney;

  /// No description provided for @wpkSendBack.
  ///
  /// In en, this message translates to:
  /// **'Send back to waiting'**
  String get wpkSendBack;

  /// No description provided for @wpkSendBackTitle.
  ///
  /// In en, this message translates to:
  /// **'Send back to waiting?'**
  String get wpkSendBackTitle;

  /// No description provided for @wpkSendBackMessage.
  ///
  /// In en, this message translates to:
  /// **'{title} leaves {container}. Its label and code stay the same.'**
  String wpkSendBackMessage(String title, String container);

  /// No description provided for @wpkSentBack.
  ///
  /// In en, this message translates to:
  /// **'Package sent back to waiting.'**
  String get wpkSentBack;

  /// No description provided for @wpkPayNoPrice.
  ///
  /// In en, this message translates to:
  /// **'No price yet'**
  String get wpkPayNoPrice;

  /// No description provided for @wpkPayUnpaid.
  ///
  /// In en, this message translates to:
  /// **'Unpaid'**
  String get wpkPayUnpaid;

  /// No description provided for @wpkPayPartial.
  ///
  /// In en, this message translates to:
  /// **'Partial'**
  String get wpkPayPartial;

  /// No description provided for @wpkPayPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get wpkPayPaid;

  /// No description provided for @wpkPaidOfPrice.
  ///
  /// In en, this message translates to:
  /// **'{paid} of {price}'**
  String wpkPaidOfPrice(String paid, String price);

  /// No description provided for @wpkStillOwed.
  ///
  /// In en, this message translates to:
  /// **'{amount} still owed'**
  String wpkStillOwed(String amount);

  /// No description provided for @wpkRecordPayment.
  ///
  /// In en, this message translates to:
  /// **'Record a payment'**
  String get wpkRecordPayment;

  /// No description provided for @wpkAmountReceived.
  ///
  /// In en, this message translates to:
  /// **'Amount received (US dollars)'**
  String get wpkAmountReceived;

  /// No description provided for @wpkPayWholeBalance.
  ///
  /// In en, this message translates to:
  /// **'Pay the whole balance'**
  String get wpkPayWholeBalance;

  /// No description provided for @wpkMethod.
  ///
  /// In en, this message translates to:
  /// **'How it arrived'**
  String get wpkMethod;

  /// No description provided for @wpkNote.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get wpkNote;

  /// No description provided for @wpkSavePrice.
  ///
  /// In en, this message translates to:
  /// **'Save price'**
  String get wpkSavePrice;

  /// No description provided for @wpkPriceSaved.
  ///
  /// In en, this message translates to:
  /// **'Price saved.'**
  String get wpkPriceSaved;

  /// No description provided for @wpkPaymentRecorded.
  ///
  /// In en, this message translates to:
  /// **'Payment recorded.'**
  String get wpkPaymentRecorded;

  /// No description provided for @wpkPaymentsTitle.
  ///
  /// In en, this message translates to:
  /// **'Payments'**
  String get wpkPaymentsTitle;

  /// No description provided for @wpkNoPayments.
  ///
  /// In en, this message translates to:
  /// **'No payments recorded yet.'**
  String get wpkNoPayments;

  /// No description provided for @wpkRevert.
  ///
  /// In en, this message translates to:
  /// **'Revert'**
  String get wpkRevert;

  /// No description provided for @wpkRevertTitle.
  ///
  /// In en, this message translates to:
  /// **'Revert this payment?'**
  String get wpkRevertTitle;

  /// No description provided for @wpkRevertMessage.
  ///
  /// In en, this message translates to:
  /// **'The {amount} payment is struck through and the balance goes back up.'**
  String wpkRevertMessage(String amount);

  /// No description provided for @wpkReverted.
  ///
  /// In en, this message translates to:
  /// **'Payment reverted.'**
  String get wpkReverted;

  /// No description provided for @wpkRevertedMark.
  ///
  /// In en, this message translates to:
  /// **'Reverted'**
  String get wpkRevertedMark;

  /// No description provided for @wpkRevertedBy.
  ///
  /// In en, this message translates to:
  /// **'Reverted by {name}'**
  String wpkRevertedBy(String name);

  /// No description provided for @wpkReceivedByName.
  ///
  /// In en, this message translates to:
  /// **'received by {name}'**
  String wpkReceivedByName(String name);

  /// No description provided for @wpkEnteredBy.
  ///
  /// In en, this message translates to:
  /// **'entered by {name}'**
  String wpkEnteredBy(String name);

  /// No description provided for @wpkAddWaiting.
  ///
  /// In en, this message translates to:
  /// **'Add waiting packages'**
  String get wpkAddWaiting;

  /// No description provided for @wpkAddWaitingCount.
  ///
  /// In en, this message translates to:
  /// **'Add waiting packages · {count}'**
  String wpkAddWaitingCount(int count);

  /// No description provided for @wpkAddWaitingNote.
  ///
  /// In en, this message translates to:
  /// **'Tick the packages that go on {container}.'**
  String wpkAddWaitingNote(String container);

  /// No description provided for @wpkNoneWaiting.
  ///
  /// In en, this message translates to:
  /// **'No packages are waiting for a container.'**
  String get wpkNoneWaiting;

  /// No description provided for @wpkSelectAll.
  ///
  /// In en, this message translates to:
  /// **'Select all matching'**
  String get wpkSelectAll;

  /// No description provided for @wpkClear.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get wpkClear;

  /// No description provided for @wpkSelected.
  ///
  /// In en, this message translates to:
  /// **'{count} selected'**
  String wpkSelected(int count);

  /// No description provided for @wpkAddToContainer.
  ///
  /// In en, this message translates to:
  /// **'Add to container'**
  String get wpkAddToContainer;

  /// No description provided for @wpkAdded.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Added 1 package to {container}.} other{Added {count} packages to {container}.}}'**
  String wpkAdded(int count, String container);

  /// No description provided for @wpkTickOne.
  ///
  /// In en, this message translates to:
  /// **'Tick at least one package.'**
  String get wpkTickOne;

  /// No description provided for @wpkBlockedMismatch.
  ///
  /// In en, this message translates to:
  /// **'For {from}, this container goes to {to}.'**
  String wpkBlockedMismatch(String from, String to);

  /// No description provided for @wpkWaitingExplain.
  ///
  /// In en, this message translates to:
  /// **'Received at the counter. It goes on a container headed to {destination} when one is loading.'**
  String wpkWaitingExplain(String destination);

  /// No description provided for @wpkWaitingExplainAny.
  ///
  /// In en, this message translates to:
  /// **'Received at the counter. It goes on a container when one is loading.'**
  String get wpkWaitingExplainAny;

  /// No description provided for @wpkSizeFact.
  ///
  /// In en, this message translates to:
  /// **'Size: {dimensions} · {volume}'**
  String wpkSizeFact(String dimensions, String volume);

  /// No description provided for @wpkPriceFact.
  ///
  /// In en, this message translates to:
  /// **'Price & payments'**
  String get wpkPriceFact;

  /// No description provided for @wpkNoPriceYet.
  ///
  /// In en, this message translates to:
  /// **'No price set yet.'**
  String get wpkNoPriceYet;

  /// No description provided for @ctrErrVinAlreadyWaiting.
  ///
  /// In en, this message translates to:
  /// **'This car is already waiting for a container.'**
  String get ctrErrVinAlreadyWaiting;

  /// No description provided for @wpkErrDestinationRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose where this package is going.'**
  String get wpkErrDestinationRequired;

  /// No description provided for @wpkErrDestinationMismatch.
  ///
  /// In en, this message translates to:
  /// **'A package can only go on a container headed to the same country.'**
  String get wpkErrDestinationMismatch;

  /// No description provided for @wpkErrContainerDestinationRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose where this container is going before adding packages to it.'**
  String get wpkErrContainerDestinationRequired;

  /// No description provided for @wpkErrSizeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the length, width and height in inches, or leave all three empty.'**
  String get wpkErrSizeInvalid;

  /// No description provided for @wpkErrLineNotWaiting.
  ///
  /// In en, this message translates to:
  /// **'That package is already on a container.'**
  String get wpkErrLineNotWaiting;

  /// No description provided for @wpkErrLineIsWaiting.
  ///
  /// In en, this message translates to:
  /// **'This package is waiting for a container. Add it to one from the waiting list.'**
  String get wpkErrLineIsWaiting;

  /// No description provided for @wpkErrLineNotInContainer.
  ///
  /// In en, this message translates to:
  /// **'That package is not on a container.'**
  String get wpkErrLineNotInContainer;

  /// No description provided for @wpkErrLineIdsInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose between 1 and 100 packages.'**
  String get wpkErrLineIdsInvalid;

  /// No description provided for @wpkErrLineHasPayments.
  ///
  /// In en, this message translates to:
  /// **'Payments are recorded for this package. Revert them first.'**
  String get wpkErrLineHasPayments;

  /// No description provided for @wpkErrPriceInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the price in dollars, more than zero.'**
  String get wpkErrPriceInvalid;

  /// No description provided for @wpkErrPriceBelowPaid.
  ///
  /// In en, this message translates to:
  /// **'The price can\'t be less than what has been paid.'**
  String get wpkErrPriceBelowPaid;

  /// No description provided for @wpkErrPriceRequired.
  ///
  /// In en, this message translates to:
  /// **'Set a price before recording a payment.'**
  String get wpkErrPriceRequired;

  /// No description provided for @wpkErrAmountRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount received.'**
  String get wpkErrAmountRequired;

  /// No description provided for @wpkErrAmountTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That amount is larger than a package can carry.'**
  String get wpkErrAmountTooLarge;

  /// No description provided for @wpkErrMethodInvalid.
  ///
  /// In en, this message translates to:
  /// **'Say how the payment arrived.'**
  String get wpkErrMethodInvalid;

  /// No description provided for @wpkErrReceivedByRequired.
  ///
  /// In en, this message translates to:
  /// **'Say which staff member took the payment.'**
  String get wpkErrReceivedByRequired;

  /// No description provided for @wpkErrExceedsBalance.
  ///
  /// In en, this message translates to:
  /// **'That is more than what is still owed.'**
  String get wpkErrExceedsBalance;

  /// No description provided for @wpkErrPaymentNotFound.
  ///
  /// In en, this message translates to:
  /// **'That payment no longer exists.'**
  String get wpkErrPaymentNotFound;

  /// No description provided for @wpkErrPaymentReverted.
  ///
  /// In en, this message translates to:
  /// **'That payment was already reverted.'**
  String get wpkErrPaymentReverted;

  /// No description provided for @guestTrackingStageWaitingContainer.
  ///
  /// In en, this message translates to:
  /// **'Received, waiting for a container'**
  String get guestTrackingStageWaitingContainer;

  /// No description provided for @dstAddCountry.
  ///
  /// In en, this message translates to:
  /// **'Add country'**
  String get dstAddCountry;

  /// No description provided for @dstAddCountryTitle.
  ///
  /// In en, this message translates to:
  /// **'Add a country'**
  String get dstAddCountryTitle;

  /// No description provided for @dstAddCountrySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search countries'**
  String get dstAddCountrySearchHint;

  /// No description provided for @dstAddCountryNone.
  ///
  /// In en, this message translates to:
  /// **'Every country is already listed.'**
  String get dstAddCountryNone;

  /// No description provided for @dstListedCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No destinations in use} =1{1 destination in use} other{{count} destinations in use}}'**
  String dstListedCount(int count);

  /// No description provided for @dstEmptyInstruction.
  ///
  /// In en, this message translates to:
  /// **'You have no destinations yet. Tap Add country, pick where you ship to, and switch on the services you offer there.'**
  String get dstEmptyInstruction;

  /// No description provided for @dstMakeMain.
  ///
  /// In en, this message translates to:
  /// **'Make main'**
  String get dstMakeMain;

  /// No description provided for @dstMainDestination.
  ///
  /// In en, this message translates to:
  /// **'Main destination'**
  String get dstMainDestination;

  /// No description provided for @dstMainHelp.
  ///
  /// In en, this message translates to:
  /// **'New packages open on this country'**
  String get dstMainHelp;

  /// No description provided for @dstMainSaved.
  ///
  /// In en, this message translates to:
  /// **'Main destination saved.'**
  String get dstMainSaved;

  /// No description provided for @dstMainCleared.
  ///
  /// In en, this message translates to:
  /// **'Main destination cleared.'**
  String get dstMainCleared;

  /// No description provided for @guestTrackingStageReadyForPickup.
  ///
  /// In en, this message translates to:
  /// **'Ready for pickup'**
  String get guestTrackingStageReadyForPickup;

  /// No description provided for @dstPickupTitle.
  ///
  /// In en, this message translates to:
  /// **'Pickup in this country'**
  String get dstPickupTitle;

  /// No description provided for @dstPickupHelp.
  ///
  /// In en, this message translates to:
  /// **'Where customers collect their goods. The ready-for-pickup WhatsApp message gives these. Leave them blank to use your business address and phone.'**
  String get dstPickupHelp;

  /// No description provided for @dstPickupCity.
  ///
  /// In en, this message translates to:
  /// **'Pickup city (optional)'**
  String get dstPickupCity;

  /// No description provided for @dstPickupCityHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Conakry'**
  String get dstPickupCityHint;

  /// No description provided for @dstPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup address (optional)'**
  String get dstPickupAddress;

  /// No description provided for @dstPickupAddressHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Madina, near the market'**
  String get dstPickupAddressHint;

  /// No description provided for @dstPickupPhone.
  ///
  /// In en, this message translates to:
  /// **'Pickup phone (optional)'**
  String get dstPickupPhone;

  /// No description provided for @dstPickupCityTooLong.
  ///
  /// In en, this message translates to:
  /// **'The pickup city can be at most 80 characters.'**
  String get dstPickupCityTooLong;

  /// No description provided for @dstPickupAddressTooLong.
  ///
  /// In en, this message translates to:
  /// **'The pickup address can be at most 200 characters.'**
  String get dstPickupAddressTooLong;

  /// No description provided for @dstPickupPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'The pickup phone needs its country code, like +224 620 00 00 00.'**
  String get dstPickupPhoneInvalid;

  /// No description provided for @dstSeedConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Add every country?'**
  String get dstSeedConfirmTitle;

  /// No description provided for @dstSeedConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This adds a record for every country, about 250 in all. The ones you do not use stay hidden from this list, and you can still bring any of them in with Add country.'**
  String get dstSeedConfirmBody;

  /// No description provided for @dstSeedConfirmAction.
  ///
  /// In en, this message translates to:
  /// **'Add all countries'**
  String get dstSeedConfirmAction;

  /// No description provided for @businessServiceInventory.
  ///
  /// In en, this message translates to:
  /// **'Inventory'**
  String get businessServiceInventory;

  /// No description provided for @businessServiceInventoryHint.
  ///
  /// In en, this message translates to:
  /// **'Keep a product list, print tags, and sell by scanning.'**
  String get businessServiceInventoryHint;

  /// No description provided for @inventoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Inventory'**
  String get inventoryTitle;

  /// No description provided for @inventorySubtitle.
  ///
  /// In en, this message translates to:
  /// **'Products, tags and counter sales.'**
  String get inventorySubtitle;

  /// No description provided for @inventorySell.
  ///
  /// In en, this message translates to:
  /// **'Sell'**
  String get inventorySell;

  /// No description provided for @inventoryAddProduct.
  ///
  /// In en, this message translates to:
  /// **'Add product'**
  String get inventoryAddProduct;

  /// No description provided for @inventorySalesTitle.
  ///
  /// In en, this message translates to:
  /// **'Sales'**
  String get inventorySalesTitle;

  /// No description provided for @inventorySearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search by brand, name, category or code'**
  String get inventorySearchHint;

  /// No description provided for @inventoryShowArchived.
  ///
  /// In en, this message translates to:
  /// **'Show archived'**
  String get inventoryShowArchived;

  /// No description provided for @inventoryTodayTitle.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get inventoryTodayTitle;

  /// No description provided for @inventorySummaryUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Today\'s numbers are not available right now.'**
  String get inventorySummaryUnavailable;

  /// No description provided for @inventorySalesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No sales} =1{1 sale} other{{count} sales}}'**
  String inventorySalesCount(int count);

  /// No description provided for @inventoryItemsSoldCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item sold} other{{count} items sold}}'**
  String inventoryItemsSoldCount(int count);

  /// No description provided for @inventoryRevenue.
  ///
  /// In en, this message translates to:
  /// **'Revenue'**
  String get inventoryRevenue;

  /// No description provided for @inventoryProfit.
  ///
  /// In en, this message translates to:
  /// **'Profit'**
  String get inventoryProfit;

  /// No description provided for @inventoryDiscounts.
  ///
  /// In en, this message translates to:
  /// **'Discounts given'**
  String get inventoryDiscounts;

  /// No description provided for @inventoryLowStockTitle.
  ///
  /// In en, this message translates to:
  /// **'Running low'**
  String get inventoryLowStockTitle;

  /// No description provided for @inventoryCountOffTitle.
  ///
  /// In en, this message translates to:
  /// **'Count was off'**
  String get inventoryCountOffTitle;

  /// No description provided for @inventoryNoProducts.
  ///
  /// In en, this message translates to:
  /// **'No products yet'**
  String get inventoryNoProducts;

  /// No description provided for @inventoryNoProductsHint.
  ///
  /// In en, this message translates to:
  /// **'Add a product, print its tag, then scan the tag to sell it.'**
  String get inventoryNoProductsHint;

  /// No description provided for @inventoryNoMatch.
  ///
  /// In en, this message translates to:
  /// **'No product matches that.'**
  String get inventoryNoMatch;

  /// No description provided for @inventoryNoArchived.
  ///
  /// In en, this message translates to:
  /// **'Nothing is archived.'**
  String get inventoryNoArchived;

  /// No description provided for @inventoryLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the products. Check your connection.'**
  String get inventoryLoadFailed;

  /// No description provided for @inventoryInStock.
  ///
  /// In en, this message translates to:
  /// **'In stock'**
  String get inventoryInStock;

  /// No description provided for @inventoryLow.
  ///
  /// In en, this message translates to:
  /// **'Low'**
  String get inventoryLow;

  /// No description provided for @inventoryOut.
  ///
  /// In en, this message translates to:
  /// **'Out'**
  String get inventoryOut;

  /// No description provided for @inventoryArchivedChip.
  ///
  /// In en, this message translates to:
  /// **'Archived'**
  String get inventoryArchivedChip;

  /// No description provided for @inventoryCountWasOff.
  ///
  /// In en, this message translates to:
  /// **'Count was off'**
  String get inventoryCountWasOff;

  /// No description provided for @inventoryInStockCount.
  ///
  /// In en, this message translates to:
  /// **'{count} in stock'**
  String inventoryInStockCount(int count);

  /// No description provided for @inventoryNewProduct.
  ///
  /// In en, this message translates to:
  /// **'New product'**
  String get inventoryNewProduct;

  /// No description provided for @inventoryEditProduct.
  ///
  /// In en, this message translates to:
  /// **'Edit product'**
  String get inventoryEditProduct;

  /// No description provided for @inventoryFieldName.
  ///
  /// In en, this message translates to:
  /// **'Name'**
  String get inventoryFieldName;

  /// No description provided for @inventoryFieldPrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get inventoryFieldPrice;

  /// No description provided for @inventoryFieldCost.
  ///
  /// In en, this message translates to:
  /// **'Cost (optional)'**
  String get inventoryFieldCost;

  /// No description provided for @inventoryFieldQuantity.
  ///
  /// In en, this message translates to:
  /// **'Quantity on hand'**
  String get inventoryFieldQuantity;

  /// No description provided for @inventoryFieldLowStock.
  ///
  /// In en, this message translates to:
  /// **'Low stock at (optional)'**
  String get inventoryFieldLowStock;

  /// No description provided for @inventoryFieldCategory.
  ///
  /// In en, this message translates to:
  /// **'Category (optional)'**
  String get inventoryFieldCategory;

  /// No description provided for @inventoryFieldPhoto.
  ///
  /// In en, this message translates to:
  /// **'Photo link (optional)'**
  String get inventoryFieldPhoto;

  /// No description provided for @inventoryLowStockHelp.
  ///
  /// In en, this message translates to:
  /// **'Shown as low at or below this count. Always low at zero.'**
  String get inventoryLowStockHelp;

  /// No description provided for @inventoryQuantityHelpEdit.
  ///
  /// In en, this message translates to:
  /// **'Change the count from the product page: add stock or set the count.'**
  String get inventoryQuantityHelpEdit;

  /// No description provided for @inventorySaveProduct.
  ///
  /// In en, this message translates to:
  /// **'Save product'**
  String get inventorySaveProduct;

  /// No description provided for @inventorySaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get inventorySaving;

  /// No description provided for @inventoryProductAdded.
  ///
  /// In en, this message translates to:
  /// **'Product added.'**
  String get inventoryProductAdded;

  /// No description provided for @inventoryProductSaved.
  ///
  /// In en, this message translates to:
  /// **'Product saved.'**
  String get inventoryProductSaved;

  /// No description provided for @inventoryErrNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a name.'**
  String get inventoryErrNameRequired;

  /// No description provided for @inventoryErrNameTooLong.
  ///
  /// In en, this message translates to:
  /// **'That name is too long.'**
  String get inventoryErrNameTooLong;

  /// No description provided for @inventoryErrPrice.
  ///
  /// In en, this message translates to:
  /// **'Enter a price above zero, like 12.50.'**
  String get inventoryErrPrice;

  /// No description provided for @inventoryErrCost.
  ///
  /// In en, this message translates to:
  /// **'Enter a cost like 8.00, or leave it blank.'**
  String get inventoryErrCost;

  /// No description provided for @inventoryErrQuantity.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number, zero or more.'**
  String get inventoryErrQuantity;

  /// No description provided for @inventoryErrQuantityAdd.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number of at least 1.'**
  String get inventoryErrQuantityAdd;

  /// No description provided for @inventoryErrLowStock.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number, or leave it blank.'**
  String get inventoryErrLowStock;

  /// No description provided for @inventoryErrPhoto.
  ///
  /// In en, this message translates to:
  /// **'Enter a full link starting with https://.'**
  String get inventoryErrPhoto;

  /// No description provided for @inventoryProductTitle.
  ///
  /// In en, this message translates to:
  /// **'Product'**
  String get inventoryProductTitle;

  /// No description provided for @inventoryAddStock.
  ///
  /// In en, this message translates to:
  /// **'Add stock'**
  String get inventoryAddStock;

  /// No description provided for @inventorySetCount.
  ///
  /// In en, this message translates to:
  /// **'Set count'**
  String get inventorySetCount;

  /// No description provided for @inventoryAddStockHelp.
  ///
  /// In en, this message translates to:
  /// **'How many more arrived?'**
  String get inventoryAddStockHelp;

  /// No description provided for @inventorySetCountHelp.
  ///
  /// In en, this message translates to:
  /// **'Count what is on the shelf. This replaces the number and clears “count was off”.'**
  String get inventorySetCountHelp;

  /// No description provided for @inventoryNoteOptional.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get inventoryNoteOptional;

  /// No description provided for @inventoryStockAdded.
  ///
  /// In en, this message translates to:
  /// **'Stock added.'**
  String get inventoryStockAdded;

  /// No description provided for @inventoryCountSet.
  ///
  /// In en, this message translates to:
  /// **'Count updated.'**
  String get inventoryCountSet;

  /// No description provided for @inventoryPrintTags.
  ///
  /// In en, this message translates to:
  /// **'Print tags'**
  String get inventoryPrintTags;

  /// No description provided for @inventoryTagCopies.
  ///
  /// In en, this message translates to:
  /// **'How many tags?'**
  String get inventoryTagCopies;

  /// No description provided for @inventoryTagCopiesHelp.
  ///
  /// In en, this message translates to:
  /// **'Every tag carries the same code. From 1 to 500.'**
  String get inventoryTagCopiesHelp;

  /// No description provided for @inventoryTagCopiesError.
  ///
  /// In en, this message translates to:
  /// **'Enter a whole number from 1 to 500.'**
  String get inventoryTagCopiesError;

  /// No description provided for @inventoryTagsOpen.
  ///
  /// In en, this message translates to:
  /// **'Open tags'**
  String get inventoryTagsOpen;

  /// No description provided for @inventoryTagsOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening…'**
  String get inventoryTagsOpening;

  /// No description provided for @inventoryTagsCouldNotOpen.
  ///
  /// In en, this message translates to:
  /// **'The tags could not be opened. Try again in a moment.'**
  String get inventoryTagsCouldNotOpen;

  /// No description provided for @inventoryTagNote.
  ///
  /// In en, this message translates to:
  /// **'A 2 × 1 inch tag with the QR code only. Reprinting never changes the code.'**
  String get inventoryTagNote;

  /// No description provided for @inventoryArchive.
  ///
  /// In en, this message translates to:
  /// **'Archive'**
  String get inventoryArchive;

  /// No description provided for @inventoryRestore.
  ///
  /// In en, this message translates to:
  /// **'Restore'**
  String get inventoryRestore;

  /// No description provided for @inventoryArchiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive this product?'**
  String get inventoryArchiveTitle;

  /// No description provided for @inventoryArchiveMessage.
  ///
  /// In en, this message translates to:
  /// **'It disappears from selling and from the list. Its history stays, and you can restore it.'**
  String get inventoryArchiveMessage;

  /// No description provided for @inventoryArchivedDone.
  ///
  /// In en, this message translates to:
  /// **'Product archived.'**
  String get inventoryArchivedDone;

  /// No description provided for @inventoryRestoredDone.
  ///
  /// In en, this message translates to:
  /// **'Product restored.'**
  String get inventoryRestoredDone;

  /// No description provided for @inventoryDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete'**
  String get inventoryDelete;

  /// No description provided for @inventoryDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this product?'**
  String get inventoryDeleteTitle;

  /// No description provided for @inventoryDeleteMessage.
  ///
  /// In en, this message translates to:
  /// **'This removes the product for good. Past sales keep its name and price. To keep it out of sight and keep its history, archive it instead.'**
  String get inventoryDeleteMessage;

  /// No description provided for @inventoryDeletedDone.
  ///
  /// In en, this message translates to:
  /// **'Product deleted.'**
  String get inventoryDeletedDone;

  /// No description provided for @inventoryHistoryTitle.
  ///
  /// In en, this message translates to:
  /// **'Stock history'**
  String get inventoryHistoryTitle;

  /// No description provided for @inventoryNoHistory.
  ///
  /// In en, this message translates to:
  /// **'No stock changes yet.'**
  String get inventoryNoHistory;

  /// No description provided for @inventoryMoveInitial.
  ///
  /// In en, this message translates to:
  /// **'Starting count'**
  String get inventoryMoveInitial;

  /// No description provided for @inventoryMoveAdd.
  ///
  /// In en, this message translates to:
  /// **'Stock added'**
  String get inventoryMoveAdd;

  /// No description provided for @inventoryMoveSet.
  ///
  /// In en, this message translates to:
  /// **'Count set'**
  String get inventoryMoveSet;

  /// No description provided for @inventoryMoveSale.
  ///
  /// In en, this message translates to:
  /// **'Sold'**
  String get inventoryMoveSale;

  /// No description provided for @inventoryMoveVoid.
  ///
  /// In en, this message translates to:
  /// **'Sale voided'**
  String get inventoryMoveVoid;

  /// No description provided for @inventoryMoveNow.
  ///
  /// In en, this message translates to:
  /// **'Now {count}'**
  String inventoryMoveNow(int count);

  /// No description provided for @inventoryByName.
  ///
  /// In en, this message translates to:
  /// **'by {name}'**
  String inventoryByName(String name);

  /// No description provided for @inventoryTagCode.
  ///
  /// In en, this message translates to:
  /// **'Tag code'**
  String get inventoryTagCode;

  /// No description provided for @inventoryPrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get inventoryPrice;

  /// No description provided for @inventoryCost.
  ///
  /// In en, this message translates to:
  /// **'Cost'**
  String get inventoryCost;

  /// No description provided for @inventoryCategory.
  ///
  /// In en, this message translates to:
  /// **'Category'**
  String get inventoryCategory;

  /// No description provided for @inventoryCountOffNote.
  ///
  /// In en, this message translates to:
  /// **'A sale sold more than the count had. Count the shelf and set the count to clear this.'**
  String get inventoryCountOffNote;

  /// No description provided for @inventoryProductGone.
  ///
  /// In en, this message translates to:
  /// **'This product is no longer there.'**
  String get inventoryProductGone;

  /// No description provided for @inventorySellTitle.
  ///
  /// In en, this message translates to:
  /// **'Sell'**
  String get inventorySellTitle;

  /// No description provided for @inventoryScanAnother.
  ///
  /// In en, this message translates to:
  /// **'Scan another product'**
  String get inventoryScanAnother;

  /// No description provided for @inventoryScanHint.
  ///
  /// In en, this message translates to:
  /// **'Point at a product tag'**
  String get inventoryScanHint;

  /// No description provided for @inventoryNotATag.
  ///
  /// In en, this message translates to:
  /// **'That QR code is not a Laawol product tag.'**
  String get inventoryNotATag;

  /// No description provided for @inventoryCameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is unavailable. Type the tag code, or search by product name below.'**
  String get inventoryCameraUnavailable;

  /// No description provided for @inventoryFindHint.
  ///
  /// In en, this message translates to:
  /// **'Tag code or product name'**
  String get inventoryFindHint;

  /// No description provided for @inventoryAddCode.
  ///
  /// In en, this message translates to:
  /// **'Add {code}'**
  String inventoryAddCode(String code);

  /// No description provided for @inventoryItemNotYours.
  ///
  /// In en, this message translates to:
  /// **'That tag is not one of your products.'**
  String get inventoryItemNotYours;

  /// No description provided for @inventoryItemArchivedScan.
  ///
  /// In en, this message translates to:
  /// **'{name} is archived. Restore it to sell it.'**
  String inventoryItemArchivedScan(String name);

  /// No description provided for @inventoryLookupFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not look that tag up. Check your connection and scan again.'**
  String get inventoryLookupFailed;

  /// No description provided for @inventoryBasketEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing scanned yet'**
  String get inventoryBasketEmpty;

  /// No description provided for @inventoryBasketEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Scan a tag, or search for a product above. Scanning the same tag again adds one.'**
  String get inventoryBasketEmptyHint;

  /// No description provided for @inventoryAddedToBasket.
  ///
  /// In en, this message translates to:
  /// **'Added {name}'**
  String inventoryAddedToBasket(String name);

  /// No description provided for @inventoryListPrice.
  ///
  /// In en, this message translates to:
  /// **'List {price}'**
  String inventoryListPrice(String price);

  /// No description provided for @inventoryLinePrice.
  ///
  /// In en, this message translates to:
  /// **'Price each'**
  String get inventoryLinePrice;

  /// No description provided for @inventoryQty.
  ///
  /// In en, this message translates to:
  /// **'Qty'**
  String get inventoryQty;

  /// No description provided for @inventoryQuantityUp.
  ///
  /// In en, this message translates to:
  /// **'One more'**
  String get inventoryQuantityUp;

  /// No description provided for @inventoryQuantityDown.
  ///
  /// In en, this message translates to:
  /// **'One less'**
  String get inventoryQuantityDown;

  /// No description provided for @inventoryRemoveLine.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get inventoryRemoveLine;

  /// No description provided for @inventoryLineTotal.
  ///
  /// In en, this message translates to:
  /// **'Line total'**
  String get inventoryLineTotal;

  /// No description provided for @inventoryExceedsCount.
  ///
  /// In en, this message translates to:
  /// **'The count says {count}. You can still sell it; the count will be marked as off.'**
  String inventoryExceedsCount(int count);

  /// No description provided for @inventoryTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get inventoryTotal;

  /// No description provided for @inventoryDiscountOff.
  ///
  /// In en, this message translates to:
  /// **'{amount} off list prices'**
  String inventoryDiscountOff(String amount);

  /// No description provided for @inventoryPieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece} other{{count} pieces}}'**
  String inventoryPieces(int count);

  /// No description provided for @inventoryPayment.
  ///
  /// In en, this message translates to:
  /// **'Payment'**
  String get inventoryPayment;

  /// No description provided for @inventoryPaymentHow.
  ///
  /// In en, this message translates to:
  /// **'How they paid'**
  String get inventoryPaymentHow;

  /// No description provided for @inventorySold.
  ///
  /// In en, this message translates to:
  /// **'Sold'**
  String get inventorySold;

  /// No description provided for @inventorySelling.
  ///
  /// In en, this message translates to:
  /// **'Recording…'**
  String get inventorySelling;

  /// No description provided for @inventorySaleDone.
  ///
  /// In en, this message translates to:
  /// **'Sale recorded'**
  String get inventorySaleDone;

  /// No description provided for @inventorySaleDoneTotal.
  ///
  /// In en, this message translates to:
  /// **'{total} recorded.'**
  String inventorySaleDoneTotal(String total);

  /// No description provided for @inventoryNewSale.
  ///
  /// In en, this message translates to:
  /// **'New sale'**
  String get inventoryNewSale;

  /// No description provided for @inventoryCountWasOffWarn.
  ///
  /// In en, this message translates to:
  /// **'Count was off for {name}: it had less than you sold, so the count is now zero. Count the shelf and set the count.'**
  String inventoryCountWasOffWarn(String name);

  /// No description provided for @inventoryNetworkError.
  ///
  /// In en, this message translates to:
  /// **'No connection. Nothing was lost: your basket is kept. Try again.'**
  String get inventoryNetworkError;

  /// No description provided for @inventoryFailArchived.
  ///
  /// In en, this message translates to:
  /// **'A product in the basket is archived. Remove it and try again.'**
  String get inventoryFailArchived;

  /// No description provided for @inventoryFailNotFound.
  ///
  /// In en, this message translates to:
  /// **'A product in the basket was not found. Remove it and try again.'**
  String get inventoryFailNotFound;

  /// No description provided for @inventoryFailVoided.
  ///
  /// In en, this message translates to:
  /// **'This sale was already voided.'**
  String get inventoryFailVoided;

  /// No description provided for @inventoryFailNoPermission.
  ///
  /// In en, this message translates to:
  /// **'You are not allowed to do that for this shop.'**
  String get inventoryFailNoPermission;

  /// No description provided for @inventoryFailDeviceNotVerified.
  ///
  /// In en, this message translates to:
  /// **'We could not verify this device with the server. Check your connection and try again. If it keeps happening, update the app or sign in again.'**
  String get inventoryFailDeviceNotVerified;

  /// No description provided for @inventoryFailInvalid.
  ///
  /// In en, this message translates to:
  /// **'That could not be accepted. Check the details and try again.'**
  String get inventoryFailInvalid;

  /// No description provided for @inventoryFailUnknown.
  ///
  /// In en, this message translates to:
  /// **'That did not go through. Try again.'**
  String get inventoryFailUnknown;

  /// No description provided for @inventoryProblemArchived.
  ///
  /// In en, this message translates to:
  /// **'A product in the basket is archived. Remove it to continue.'**
  String get inventoryProblemArchived;

  /// No description provided for @inventoryProblemTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That total is too large to record.'**
  String get inventoryProblemTooLarge;

  /// No description provided for @inventoryPriceInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a price like 12.50.'**
  String get inventoryPriceInvalid;

  /// No description provided for @inventoryTryAgain.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get inventoryTryAgain;

  /// No description provided for @inventoryNoSales.
  ///
  /// In en, this message translates to:
  /// **'No sales yet'**
  String get inventoryNoSales;

  /// No description provided for @inventoryNoSalesHint.
  ///
  /// In en, this message translates to:
  /// **'Sales you record from the Sell screen appear here.'**
  String get inventoryNoSalesHint;

  /// No description provided for @inventorySalesLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Could not load the sales. Check your connection.'**
  String get inventorySalesLoadFailed;

  /// No description provided for @inventorySaleNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'That sale is not available.'**
  String get inventorySaleNotAvailable;

  /// No description provided for @inventoryLoadMoreSales.
  ///
  /// In en, this message translates to:
  /// **'Load more'**
  String get inventoryLoadMoreSales;

  /// No description provided for @inventoryVoidedMark.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get inventoryVoidedMark;

  /// No description provided for @inventoryVoidedBy.
  ///
  /// In en, this message translates to:
  /// **'Voided by {name} · {when}'**
  String inventoryVoidedBy(String name, String when);

  /// No description provided for @inventoryVoidedWhen.
  ///
  /// In en, this message translates to:
  /// **'Voided · {when}'**
  String inventoryVoidedWhen(String when);

  /// No description provided for @inventorySoldBy.
  ///
  /// In en, this message translates to:
  /// **'Sold by {name}'**
  String inventorySoldBy(String name);

  /// No description provided for @inventoryVoidSale.
  ///
  /// In en, this message translates to:
  /// **'Void sale'**
  String get inventoryVoidSale;

  /// No description provided for @inventoryVoidTitle.
  ///
  /// In en, this message translates to:
  /// **'Void this sale?'**
  String get inventoryVoidTitle;

  /// No description provided for @inventoryVoidMessage.
  ///
  /// In en, this message translates to:
  /// **'The stock goes back on the shelf and the sale stays in the list marked as voided. This cannot be undone.'**
  String get inventoryVoidMessage;

  /// No description provided for @inventoryVoidedDone.
  ///
  /// In en, this message translates to:
  /// **'Sale voided.'**
  String get inventoryVoidedDone;

  /// No description provided for @inventorySaleLine.
  ///
  /// In en, this message translates to:
  /// **'{quantity} × {name} at {price}'**
  String inventorySaleLine(int quantity, String name, String price);

  /// No description provided for @inventorySaleLineChanged.
  ///
  /// In en, this message translates to:
  /// **'{quantity} × {name} at {price} (list {list})'**
  String inventorySaleLineChanged(
    int quantity,
    String name,
    String price,
    String list,
  );

  /// No description provided for @inventorySaleCountOff.
  ///
  /// In en, this message translates to:
  /// **'count was off'**
  String get inventorySaleCountOff;

  /// No description provided for @inventoryLowStockAtLabel.
  ///
  /// In en, this message translates to:
  /// **'Low stock at'**
  String get inventoryLowStockAtLabel;

  /// No description provided for @inventorySellDiscardTitle.
  ///
  /// In en, this message translates to:
  /// **'Leave without selling?'**
  String get inventorySellDiscardTitle;

  /// No description provided for @inventorySellDiscardBody.
  ///
  /// In en, this message translates to:
  /// **'The items in the basket have not been sold. If you leave, the basket is emptied.'**
  String get inventorySellDiscardBody;

  /// No description provided for @inventorySellDiscardKeep.
  ///
  /// In en, this message translates to:
  /// **'Stay'**
  String get inventorySellDiscardKeep;

  /// No description provided for @inventorySellDiscardLeave.
  ///
  /// In en, this message translates to:
  /// **'Empty the basket and leave'**
  String get inventorySellDiscardLeave;

  /// No description provided for @inventoryCategoryNone.
  ///
  /// In en, this message translates to:
  /// **'No category'**
  String get inventoryCategoryNone;

  /// No description provided for @inventoryCategoryAddNew.
  ///
  /// In en, this message translates to:
  /// **'Add a new category'**
  String get inventoryCategoryAddNew;

  /// No description provided for @inventoryCategoryNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Category name'**
  String get inventoryCategoryNameLabel;

  /// No description provided for @inventoryCategoryCreate.
  ///
  /// In en, this message translates to:
  /// **'Add category'**
  String get inventoryCategoryCreate;

  /// No description provided for @inventoryCategoryAddedDone.
  ///
  /// In en, this message translates to:
  /// **'Category added.'**
  String get inventoryCategoryAddedDone;

  /// No description provided for @inventoryCategoryPickTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a category'**
  String get inventoryCategoryPickTitle;

  /// No description provided for @inventoryCategoryAll.
  ///
  /// In en, this message translates to:
  /// **'All categories'**
  String get inventoryCategoryAll;

  /// No description provided for @inventoryCategoriesTitle.
  ///
  /// In en, this message translates to:
  /// **'Categories'**
  String get inventoryCategoriesTitle;

  /// No description provided for @inventoryCategoriesEmpty.
  ///
  /// In en, this message translates to:
  /// **'No categories yet. Add one to group your products.'**
  String get inventoryCategoriesEmpty;

  /// No description provided for @inventoryCategoryRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get inventoryCategoryRename;

  /// No description provided for @inventoryCategoryRenameTitle.
  ///
  /// In en, this message translates to:
  /// **'Rename category'**
  String get inventoryCategoryRenameTitle;

  /// No description provided for @inventoryCategoryRenamedDone.
  ///
  /// In en, this message translates to:
  /// **'Category renamed.'**
  String get inventoryCategoryRenamedDone;

  /// No description provided for @inventoryCategoryArchivedDone.
  ///
  /// In en, this message translates to:
  /// **'Category archived.'**
  String get inventoryCategoryArchivedDone;

  /// No description provided for @inventoryCategoryRestoredDone.
  ///
  /// In en, this message translates to:
  /// **'Category restored.'**
  String get inventoryCategoryRestoredDone;

  /// No description provided for @inventoryCategoryUncategorized.
  ///
  /// In en, this message translates to:
  /// **'Uncategorized'**
  String get inventoryCategoryUncategorized;

  /// No description provided for @inventoryByCategoryTitle.
  ///
  /// In en, this message translates to:
  /// **'By category'**
  String get inventoryByCategoryTitle;

  /// No description provided for @inventoryErrCategoryName.
  ///
  /// In en, this message translates to:
  /// **'Enter a category name.'**
  String get inventoryErrCategoryName;

  /// No description provided for @inventoryManageCategories.
  ///
  /// In en, this message translates to:
  /// **'Manage categories'**
  String get inventoryManageCategories;

  /// No description provided for @inventoryBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand'**
  String get inventoryBrand;

  /// No description provided for @inventoryFieldBrand.
  ///
  /// In en, this message translates to:
  /// **'Brand (optional)'**
  String get inventoryFieldBrand;

  /// No description provided for @inventoryBrandNone.
  ///
  /// In en, this message translates to:
  /// **'No brand'**
  String get inventoryBrandNone;

  /// No description provided for @inventoryBrandAddNew.
  ///
  /// In en, this message translates to:
  /// **'Add a new brand'**
  String get inventoryBrandAddNew;

  /// No description provided for @inventoryBrandNameLabel.
  ///
  /// In en, this message translates to:
  /// **'Brand name'**
  String get inventoryBrandNameLabel;

  /// No description provided for @inventoryBrandCreate.
  ///
  /// In en, this message translates to:
  /// **'Add brand'**
  String get inventoryBrandCreate;

  /// No description provided for @inventoryBrandAddedDone.
  ///
  /// In en, this message translates to:
  /// **'Brand added.'**
  String get inventoryBrandAddedDone;

  /// No description provided for @inventoryBrandPickTitle.
  ///
  /// In en, this message translates to:
  /// **'Choose a brand'**
  String get inventoryBrandPickTitle;

  /// No description provided for @inventoryBrandAll.
  ///
  /// In en, this message translates to:
  /// **'All brands'**
  String get inventoryBrandAll;

  /// No description provided for @inventoryBrandsTitle.
  ///
  /// In en, this message translates to:
  /// **'Brands'**
  String get inventoryBrandsTitle;

  /// No description provided for @inventoryBrandsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No brands yet. Add one for the makers you stock, like Jordan or Nike.'**
  String get inventoryBrandsEmpty;

  /// No description provided for @inventoryBrandRename.
  ///
  /// In en, this message translates to:
  /// **'Rename'**
  String get inventoryBrandRename;

  /// No description provided for @inventoryBrandRenameTitle.
  ///
  /// In en, this message translates to:
  /// **'Rename brand'**
  String get inventoryBrandRenameTitle;

  /// No description provided for @inventoryBrandRenamedDone.
  ///
  /// In en, this message translates to:
  /// **'Brand renamed.'**
  String get inventoryBrandRenamedDone;

  /// No description provided for @inventoryBrandArchivedDone.
  ///
  /// In en, this message translates to:
  /// **'Brand archived.'**
  String get inventoryBrandArchivedDone;

  /// No description provided for @inventoryBrandRestoredDone.
  ///
  /// In en, this message translates to:
  /// **'Brand restored.'**
  String get inventoryBrandRestoredDone;

  /// No description provided for @inventoryByBrandTitle.
  ///
  /// In en, this message translates to:
  /// **'By brand'**
  String get inventoryByBrandTitle;

  /// No description provided for @inventoryErrBrandName.
  ///
  /// In en, this message translates to:
  /// **'Enter a brand name.'**
  String get inventoryErrBrandName;

  /// No description provided for @inventoryManageBrands.
  ///
  /// In en, this message translates to:
  /// **'Manage brands'**
  String get inventoryManageBrands;

  /// No description provided for @inventoryFailBrandNameTaken.
  ///
  /// In en, this message translates to:
  /// **'You already have a brand with that name.'**
  String get inventoryFailBrandNameTaken;

  /// No description provided for @inventoryFailBrandNotFound.
  ///
  /// In en, this message translates to:
  /// **'That brand no longer exists. Pick another one.'**
  String get inventoryFailBrandNotFound;

  /// No description provided for @inventoryFailBrandTooLong.
  ///
  /// In en, this message translates to:
  /// **'That brand name is too long. Use 60 characters or fewer.'**
  String get inventoryFailBrandTooLong;

  /// No description provided for @inventorySaveAndAddAnother.
  ///
  /// In en, this message translates to:
  /// **'Save and add another like it'**
  String get inventorySaveAndAddAnother;

  /// No description provided for @inventoryProductAddedNext.
  ///
  /// In en, this message translates to:
  /// **'Added {name}. Ready for the next one.'**
  String inventoryProductAddedNext(String name);

  /// No description provided for @inventoryStoreFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All stores'**
  String get inventoryStoreFilterAll;

  /// No description provided for @inventoryStoreLabel.
  ///
  /// In en, this message translates to:
  /// **'Store'**
  String get inventoryStoreLabel;

  /// No description provided for @inventoryStoresTitle.
  ///
  /// In en, this message translates to:
  /// **'Stores'**
  String get inventoryStoresTitle;

  /// No description provided for @inventoryStoresIntro.
  ///
  /// In en, this message translates to:
  /// **'Your shop works as one store. Add a second store to count stock separately in each one.'**
  String get inventoryStoresIntro;

  /// No description provided for @inventoryStoreAdd.
  ///
  /// In en, this message translates to:
  /// **'Add a store'**
  String get inventoryStoreAdd;

  /// No description provided for @inventoryStoreEdit.
  ///
  /// In en, this message translates to:
  /// **'Edit store'**
  String get inventoryStoreEdit;

  /// No description provided for @inventoryStoreName.
  ///
  /// In en, this message translates to:
  /// **'Store name'**
  String get inventoryStoreName;

  /// No description provided for @inventoryStoreAddress.
  ///
  /// In en, this message translates to:
  /// **'Address (optional)'**
  String get inventoryStoreAddress;

  /// No description provided for @inventoryStorePhone.
  ///
  /// In en, this message translates to:
  /// **'Phone (optional)'**
  String get inventoryStorePhone;

  /// No description provided for @inventoryStoreSave.
  ///
  /// In en, this message translates to:
  /// **'Save store'**
  String get inventoryStoreSave;

  /// No description provided for @inventoryStoreSavedDone.
  ///
  /// In en, this message translates to:
  /// **'Store saved.'**
  String get inventoryStoreSavedDone;

  /// No description provided for @inventoryStoreArchiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Archive this store?'**
  String get inventoryStoreArchiveTitle;

  /// No description provided for @inventoryStoreArchiveMessage.
  ///
  /// In en, this message translates to:
  /// **'It is no longer offered for selling or stock. A store that still holds stock cannot be archived: move its stock to another store first.'**
  String get inventoryStoreArchiveMessage;

  /// No description provided for @inventoryStoreArchivedDone.
  ///
  /// In en, this message translates to:
  /// **'Store archived.'**
  String get inventoryStoreArchivedDone;

  /// No description provided for @inventoryStoreRestoredDone.
  ///
  /// In en, this message translates to:
  /// **'Store restored.'**
  String get inventoryStoreRestoredDone;

  /// No description provided for @inventoryErrStoreName.
  ///
  /// In en, this message translates to:
  /// **'Enter a store name.'**
  String get inventoryErrStoreName;

  /// No description provided for @inventoryErrStoreRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose a store.'**
  String get inventoryErrStoreRequired;

  /// No description provided for @inventoryStoreShowing.
  ///
  /// In en, this message translates to:
  /// **'Showing {store}'**
  String inventoryStoreShowing(String store);

  /// No description provided for @inventoryStoreSellingFrom.
  ///
  /// In en, this message translates to:
  /// **'Selling from {store}'**
  String inventoryStoreSellingFrom(String store);

  /// No description provided for @inventoryStoreSellPick.
  ///
  /// In en, this message translates to:
  /// **'Sell from'**
  String get inventoryStoreSellPick;

  /// No description provided for @inventoryStoreHomeRequired.
  ///
  /// In en, this message translates to:
  /// **'Ask the owner to assign your store before you sell.'**
  String get inventoryStoreHomeRequired;

  /// No description provided for @inventoryStoreHomeRequiredView.
  ///
  /// In en, this message translates to:
  /// **'Ask the owner to assign your store to see its stock.'**
  String get inventoryStoreHomeRequiredView;

  /// No description provided for @inventoryStoreLowAt.
  ///
  /// In en, this message translates to:
  /// **'Low at {store}'**
  String inventoryStoreLowAt(String store);

  /// No description provided for @inventoryStockTotalLabel.
  ///
  /// In en, this message translates to:
  /// **'Total across stores'**
  String get inventoryStockTotalLabel;

  /// No description provided for @inventoryStockByStoreTitle.
  ///
  /// In en, this message translates to:
  /// **'Stock by store'**
  String get inventoryStockByStoreTitle;

  /// No description provided for @inventoryByStoreTitle.
  ///
  /// In en, this message translates to:
  /// **'By store'**
  String get inventoryByStoreTitle;

  /// No description provided for @inventoryYourStore.
  ///
  /// In en, this message translates to:
  /// **'Your store: {store}'**
  String inventoryYourStore(String store);

  /// No description provided for @inventoryStoreOf.
  ///
  /// In en, this message translates to:
  /// **'Store: {store}'**
  String inventoryStoreOf(String store);

  /// No description provided for @inventoryFieldQuantityAt.
  ///
  /// In en, this message translates to:
  /// **'Starting count in {store}'**
  String inventoryFieldQuantityAt(String store);

  /// No description provided for @inventoryMoveAtStore.
  ///
  /// In en, this message translates to:
  /// **'at {store}'**
  String inventoryMoveAtStore(String store);

  /// No description provided for @inventoryStockForStore.
  ///
  /// In en, this message translates to:
  /// **'Counting in {store}'**
  String inventoryStockForStore(String store);

  /// No description provided for @inventoryTransferFrom.
  ///
  /// In en, this message translates to:
  /// **'From'**
  String get inventoryTransferFrom;

  /// No description provided for @inventoryTransferTo.
  ///
  /// In en, this message translates to:
  /// **'To'**
  String get inventoryTransferTo;

  /// No description provided for @inventoryStaffAccessTitle.
  ///
  /// In en, this message translates to:
  /// **'Inventory stores'**
  String get inventoryStaffAccessTitle;

  /// No description provided for @inventoryStaffAccessHelp.
  ///
  /// In en, this message translates to:
  /// **'Choose where this person sells and counts stock.'**
  String get inventoryStaffAccessHelp;

  /// No description provided for @inventoryHomeStore.
  ///
  /// In en, this message translates to:
  /// **'Home store'**
  String get inventoryHomeStore;

  /// No description provided for @inventoryHomeStoreNone.
  ///
  /// In en, this message translates to:
  /// **'No home store'**
  String get inventoryHomeStoreNone;

  /// No description provided for @inventoryAllStoresSwitch.
  ///
  /// In en, this message translates to:
  /// **'Works in all stores'**
  String get inventoryAllStoresSwitch;

  /// No description provided for @inventoryAllStoresHelp.
  ///
  /// In en, this message translates to:
  /// **'They see every store, choose the store when selling and can move stock between stores.'**
  String get inventoryAllStoresHelp;

  /// No description provided for @inventoryStaffAccessSave.
  ///
  /// In en, this message translates to:
  /// **'Save access'**
  String get inventoryStaffAccessSave;

  /// No description provided for @inventoryStaffAccessSaved.
  ///
  /// In en, this message translates to:
  /// **'Store access saved.'**
  String get inventoryStaffAccessSaved;

  /// No description provided for @inventoryStaffAccessHome.
  ///
  /// In en, this message translates to:
  /// **'Home: {store}'**
  String inventoryStaffAccessHome(String store);

  /// No description provided for @inventoryStaffAccessUnset.
  ///
  /// In en, this message translates to:
  /// **'No home store yet'**
  String get inventoryStaffAccessUnset;

  /// No description provided for @inventoryFailCategoryNameTaken.
  ///
  /// In en, this message translates to:
  /// **'You already have a category with that name.'**
  String get inventoryFailCategoryNameTaken;

  /// No description provided for @inventoryFailCategoryNotFound.
  ///
  /// In en, this message translates to:
  /// **'That category no longer exists. Pick another one.'**
  String get inventoryFailCategoryNotFound;

  /// No description provided for @inventoryFailStoreNotFound.
  ///
  /// In en, this message translates to:
  /// **'That store was not found. Go back and try again.'**
  String get inventoryFailStoreNotFound;

  /// No description provided for @inventoryFailStoreArchived.
  ///
  /// In en, this message translates to:
  /// **'That store is archived. Pick another store.'**
  String get inventoryFailStoreArchived;

  /// No description provided for @inventoryFailStoreHasStock.
  ///
  /// In en, this message translates to:
  /// **'This store still holds stock. Move it to another store first, then archive it.'**
  String get inventoryFailStoreHasStock;

  /// No description provided for @inventoryFailStoreNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You cannot use that store. Your sales and counts go to your own store.'**
  String get inventoryFailStoreNotAllowed;

  /// No description provided for @inventoryFailSameStore.
  ///
  /// In en, this message translates to:
  /// **'Choose two different stores.'**
  String get inventoryFailSameStore;

  /// No description provided for @inventoryFailInsufficientStock.
  ///
  /// In en, this message translates to:
  /// **'The store you are moving from does not have that many. Lower the number, or add stock first.'**
  String get inventoryFailInsufficientStock;

  /// No description provided for @inventoryFailOwnerOnly.
  ///
  /// In en, this message translates to:
  /// **'Only the owner can do that.'**
  String get inventoryFailOwnerOnly;

  /// No description provided for @shopHomeSellSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Scan a product tag'**
  String get shopHomeSellSubtitle;

  /// No description provided for @shopHomeEnterCode.
  ///
  /// In en, this message translates to:
  /// **'Enter code or search'**
  String get shopHomeEnterCode;

  /// No description provided for @shopHomeSalesLabel.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Sale} other{Sales}}'**
  String shopHomeSalesLabel(int count);

  /// No description provided for @shopHomeProducts.
  ///
  /// In en, this message translates to:
  /// **'Products'**
  String get shopHomeProducts;

  /// No description provided for @shopHomeProductsHint.
  ///
  /// In en, this message translates to:
  /// **'Stock, prices and tags'**
  String get shopHomeProductsHint;

  /// No description provided for @shopHomeSalesHint.
  ///
  /// In en, this message translates to:
  /// **'History and voids'**
  String get shopHomeSalesHint;

  /// No description provided for @shopHomeLowCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Nothing low} =1{1 product} other{{count} products}}'**
  String shopHomeLowCount(int count);

  /// No description provided for @shopHomeAddHint.
  ///
  /// In en, this message translates to:
  /// **'A new item and its tag'**
  String get shopHomeAddHint;

  /// No description provided for @shopHomeRecentTitle.
  ///
  /// In en, this message translates to:
  /// **'Today\'s sales'**
  String get shopHomeRecentTitle;

  /// No description provided for @shopHomeSeeAll.
  ///
  /// In en, this message translates to:
  /// **'See all'**
  String get shopHomeSeeAll;

  /// No description provided for @shopHomeNoSalesToday.
  ///
  /// In en, this message translates to:
  /// **'No sales yet today. Scan a tag to make the first one.'**
  String get shopHomeNoSalesToday;

  /// No description provided for @shopHomeSaleItems.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{{name}} =1{{name} and 1 more} other{{name} and {count} more}}'**
  String shopHomeSaleItems(int count, String name);

  /// No description provided for @shopHomeLowNone.
  ///
  /// In en, this message translates to:
  /// **'Nothing is running low.'**
  String get shopHomeLowNone;

  /// No description provided for @shopHomeMoreTitle.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get shopHomeMoreTitle;

  /// No description provided for @shopHomePendingNote.
  ///
  /// In en, this message translates to:
  /// **'Pending approval · You can already sell'**
  String get shopHomePendingNote;

  /// No description provided for @shopHomeChangesNote.
  ///
  /// In en, this message translates to:
  /// **'Changes requested · You can still sell'**
  String get shopHomeChangesNote;

  /// No description provided for @shopHomeNoInventoryAccess.
  ///
  /// In en, this message translates to:
  /// **'This business sells with Inventory. Ask the owner to give you the Inventory permission.'**
  String get shopHomeNoInventoryAccess;

  /// No description provided for @printTagsSizeLabel.
  ///
  /// In en, this message translates to:
  /// **'Label size'**
  String get printTagsSizeLabel;

  /// No description provided for @printTagsSize2x1.
  ///
  /// In en, this message translates to:
  /// **'2 × 1 in'**
  String get printTagsSize2x1;

  /// No description provided for @printTagsSize40x30.
  ///
  /// In en, this message translates to:
  /// **'40 × 30 mm'**
  String get printTagsSize40x30;

  /// No description provided for @printTagsSize50x30.
  ///
  /// In en, this message translates to:
  /// **'50 × 30 mm'**
  String get printTagsSize50x30;

  /// No description provided for @printTagsSizeCustom.
  ///
  /// In en, this message translates to:
  /// **'Custom'**
  String get printTagsSizeCustom;

  /// No description provided for @printTagsCustomWidth.
  ///
  /// In en, this message translates to:
  /// **'Width (mm)'**
  String get printTagsCustomWidth;

  /// No description provided for @printTagsCustomHeight.
  ///
  /// In en, this message translates to:
  /// **'Height (mm)'**
  String get printTagsCustomHeight;

  /// No description provided for @printTagsCustomError.
  ///
  /// In en, this message translates to:
  /// **'Enter a width from 15 to 72 mm and a height from 15 to 100 mm.'**
  String get printTagsCustomError;

  /// No description provided for @printTagsNote.
  ///
  /// In en, this message translates to:
  /// **'The QR code only. Every copy carries the same code; reprinting never changes it.'**
  String get printTagsNote;

  /// No description provided for @printTagsToPrinter.
  ///
  /// In en, this message translates to:
  /// **'Print to printer'**
  String get printTagsToPrinter;

  /// No description provided for @printTagsConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting to the printer…'**
  String get printTagsConnecting;

  /// No description provided for @printTagsProgress.
  ///
  /// In en, this message translates to:
  /// **'Printing {done} of {total}…'**
  String printTagsProgress(int done, int total);

  /// No description provided for @printTagsStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get printTagsStop;

  /// No description provided for @printTagsStopping.
  ///
  /// In en, this message translates to:
  /// **'Stopping after this tag…'**
  String get printTagsStopping;

  /// No description provided for @printTagsDone.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 tag printed.} other{{count} tags printed.}}'**
  String printTagsDone(int count);

  /// No description provided for @printTagsStopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped after {printed} of {total}.'**
  String printTagsStopped(int printed, int total);

  /// No description provided for @printTagsPartial.
  ///
  /// In en, this message translates to:
  /// **'{printed} of {total} printed before the problem.'**
  String printTagsPartial(int printed, int total);

  /// No description provided for @printTagsSharePdf.
  ///
  /// In en, this message translates to:
  /// **'Share as PDF'**
  String get printTagsSharePdf;

  /// No description provided for @printTagsSharing.
  ///
  /// In en, this message translates to:
  /// **'Preparing the PDF…'**
  String get printTagsSharing;

  /// No description provided for @printTagsShareHint.
  ///
  /// In en, this message translates to:
  /// **'The PDF page is exactly the label. In your printer app, print it at 100 % (actual size).'**
  String get printTagsShareHint;

  /// No description provided for @printTagsPdfFailed.
  ///
  /// In en, this message translates to:
  /// **'The PDF could not be made. Try again.'**
  String get printTagsPdfFailed;

  /// No description provided for @printTagsOpenPage.
  ///
  /// In en, this message translates to:
  /// **'Open tag page'**
  String get printTagsOpenPage;

  /// No description provided for @printTagsPrinterLine.
  ///
  /// In en, this message translates to:
  /// **'Printer: {name}'**
  String printTagsPrinterLine(String name);

  /// No description provided for @printTagsNoPrinter.
  ///
  /// In en, this message translates to:
  /// **'No printer chosen yet.'**
  String get printTagsNoPrinter;

  /// No description provided for @printTagsPrinterSettings.
  ///
  /// In en, this message translates to:
  /// **'Printer settings'**
  String get printTagsPrinterSettings;

  /// No description provided for @inventoryPrintTagAction.
  ///
  /// In en, this message translates to:
  /// **'Print tag'**
  String get inventoryPrintTagAction;

  /// No description provided for @labelPrinterTitle.
  ///
  /// In en, this message translates to:
  /// **'Label printer'**
  String get labelPrinterTitle;

  /// No description provided for @labelPrinterSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Phomemo M221 over Bluetooth'**
  String get labelPrinterSubtitle;

  /// No description provided for @labelPrinterSectionPrinter.
  ///
  /// In en, this message translates to:
  /// **'Printer'**
  String get labelPrinterSectionPrinter;

  /// No description provided for @labelPrinterNone.
  ///
  /// In en, this message translates to:
  /// **'No printer chosen yet. Find it below.'**
  String get labelPrinterNone;

  /// No description provided for @labelPrinterScan.
  ///
  /// In en, this message translates to:
  /// **'Find printers'**
  String get labelPrinterScan;

  /// No description provided for @labelPrinterScanning.
  ///
  /// In en, this message translates to:
  /// **'Looking for printers…'**
  String get labelPrinterScanning;

  /// No description provided for @labelPrinterScanHint.
  ///
  /// In en, this message translates to:
  /// **'Turn the printer on and close the Print Master app first. The printer shows up with a name such as Q2… at the top of the list; other nearby devices are listed below it.'**
  String get labelPrinterScanHint;

  /// No description provided for @labelPrinterNoneFound.
  ///
  /// In en, this message translates to:
  /// **'No printer found nearby.'**
  String get labelPrinterNoneFound;

  /// No description provided for @labelPrinterSignal.
  ///
  /// In en, this message translates to:
  /// **'Signal {rssi} dBm'**
  String labelPrinterSignal(int rssi);

  /// No description provided for @labelPrinterUse.
  ///
  /// In en, this message translates to:
  /// **'Use'**
  String get labelPrinterUse;

  /// No description provided for @labelPrinterInUse.
  ///
  /// In en, this message translates to:
  /// **'In use'**
  String get labelPrinterInUse;

  /// No description provided for @labelPrinterForget.
  ///
  /// In en, this message translates to:
  /// **'Forget'**
  String get labelPrinterForget;

  /// No description provided for @labelPrinterConnected.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get labelPrinterConnected;

  /// No description provided for @labelPrinterDisconnect.
  ///
  /// In en, this message translates to:
  /// **'Disconnect'**
  String get labelPrinterDisconnect;

  /// No description provided for @labelPrinterBattery.
  ///
  /// In en, this message translates to:
  /// **'Battery {percent}%'**
  String labelPrinterBattery(int percent);

  /// No description provided for @labelPrinterSectionLabel.
  ///
  /// In en, this message translates to:
  /// **'Label'**
  String get labelPrinterSectionLabel;

  /// No description provided for @labelPrinterDensity.
  ///
  /// In en, this message translates to:
  /// **'Darkness'**
  String get labelPrinterDensity;

  /// No description provided for @labelPrinterDensityHelp.
  ///
  /// In en, this message translates to:
  /// **'1 is the lightest, 8 the darkest.'**
  String get labelPrinterDensityHelp;

  /// No description provided for @labelPrinterSpeed.
  ///
  /// In en, this message translates to:
  /// **'Speed'**
  String get labelPrinterSpeed;

  /// No description provided for @labelPrinterSpeedHelp.
  ///
  /// In en, this message translates to:
  /// **'1 is the slowest and crispest, 5 the fastest.'**
  String get labelPrinterSpeedHelp;

  /// No description provided for @labelPrinterSectionPosition.
  ///
  /// In en, this message translates to:
  /// **'Position on the label'**
  String get labelPrinterSectionPosition;

  /// No description provided for @labelPrinterPositionHelp.
  ///
  /// In en, this message translates to:
  /// **'Print the test frame, then move it until the border sits on the label’s edges. 8 dots = 1 mm.'**
  String get labelPrinterPositionHelp;

  /// No description provided for @labelPrinterXOffset.
  ///
  /// In en, this message translates to:
  /// **'Left / right'**
  String get labelPrinterXOffset;

  /// No description provided for @labelPrinterYOffset.
  ///
  /// In en, this message translates to:
  /// **'Up / down'**
  String get labelPrinterYOffset;

  /// No description provided for @labelPrinterDots.
  ///
  /// In en, this message translates to:
  /// **'{dots} dots'**
  String labelPrinterDots(int dots);

  /// No description provided for @labelPrinterLess.
  ///
  /// In en, this message translates to:
  /// **'Less'**
  String get labelPrinterLess;

  /// No description provided for @labelPrinterMore.
  ///
  /// In en, this message translates to:
  /// **'More'**
  String get labelPrinterMore;

  /// No description provided for @labelPrinterTestFrame.
  ///
  /// In en, this message translates to:
  /// **'Print test frame'**
  String get labelPrinterTestFrame;

  /// No description provided for @labelPrinterTestTag.
  ///
  /// In en, this message translates to:
  /// **'Print test tag'**
  String get labelPrinterTestTag;

  /// No description provided for @labelPrinterCheckStatus.
  ///
  /// In en, this message translates to:
  /// **'Check the printer'**
  String get labelPrinterCheckStatus;

  /// No description provided for @labelPrinterChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking…'**
  String get labelPrinterChecking;

  /// No description provided for @labelPrinterSent.
  ///
  /// In en, this message translates to:
  /// **'Printed.'**
  String get labelPrinterSent;

  /// No description provided for @labelPrinterStatusDone.
  ///
  /// In en, this message translates to:
  /// **'Printer checked. The replies are in the print log.'**
  String get labelPrinterStatusDone;

  /// No description provided for @labelPrinterSectionLog.
  ///
  /// In en, this message translates to:
  /// **'Print log'**
  String get labelPrinterSectionLog;

  /// No description provided for @labelPrinterLogHelp.
  ///
  /// In en, this message translates to:
  /// **'If something goes wrong, copy the log and send it to the developer.'**
  String get labelPrinterLogHelp;

  /// No description provided for @labelPrinterCopyLog.
  ///
  /// In en, this message translates to:
  /// **'Copy log'**
  String get labelPrinterCopyLog;

  /// No description provided for @labelPrinterLogCopied.
  ///
  /// In en, this message translates to:
  /// **'Print log copied.'**
  String get labelPrinterLogCopied;

  /// No description provided for @labelPrinterClearLog.
  ///
  /// In en, this message translates to:
  /// **'Clear'**
  String get labelPrinterClearLog;

  /// No description provided for @labelPrinterLogEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing yet.'**
  String get labelPrinterLogEmpty;

  /// No description provided for @labelPrinterPermissionTitle.
  ///
  /// In en, this message translates to:
  /// **'Bluetooth'**
  String get labelPrinterPermissionTitle;

  /// No description provided for @labelPrinterPermissionBody.
  ///
  /// In en, this message translates to:
  /// **'Laawol uses Bluetooth only to find your label printer and print tags on it. Your phone will ask for permission next.'**
  String get labelPrinterPermissionBody;

  /// No description provided for @labelPrinterPermissionContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get labelPrinterPermissionContinue;

  /// No description provided for @labelPrinterErrorBluetoothOff.
  ///
  /// In en, this message translates to:
  /// **'Bluetooth is off. Turn it on in the phone’s settings, then try again.'**
  String get labelPrinterErrorBluetoothOff;

  /// No description provided for @labelPrinterErrorUnsupported.
  ///
  /// In en, this message translates to:
  /// **'This phone cannot use Bluetooth printers.'**
  String get labelPrinterErrorUnsupported;

  /// No description provided for @labelPrinterErrorPermission.
  ///
  /// In en, this message translates to:
  /// **'Laawol is not allowed to use Bluetooth. Allow it in the phone’s Settings for Laawol, then try again.'**
  String get labelPrinterErrorPermission;

  /// No description provided for @labelPrinterErrorLocation.
  ///
  /// In en, this message translates to:
  /// **'Turn on Location: this Android phone needs it to find Bluetooth printers.'**
  String get labelPrinterErrorLocation;

  /// No description provided for @labelPrinterErrorNoPrinter.
  ///
  /// In en, this message translates to:
  /// **'Choose your printer first in the label printer settings.'**
  String get labelPrinterErrorNoPrinter;

  /// No description provided for @labelPrinterErrorNotFound.
  ///
  /// In en, this message translates to:
  /// **'Printer not found. Is it on and close by? Close the Print Master app: the printer takes only one connection.'**
  String get labelPrinterErrorNotFound;

  /// No description provided for @labelPrinterErrorConnect.
  ///
  /// In en, this message translates to:
  /// **'Could not connect to the printer. Close Print Master, turn the printer off and on, then try again.'**
  String get labelPrinterErrorConnect;

  /// No description provided for @labelPrinterErrorNotAPrinter.
  ///
  /// In en, this message translates to:
  /// **'That device is not a label printer this app can use.'**
  String get labelPrinterErrorNotAPrinter;

  /// No description provided for @labelPrinterErrorLost.
  ///
  /// In en, this message translates to:
  /// **'The connection to the printer was lost. Keep the phone close to it and try again.'**
  String get labelPrinterErrorLost;

  /// No description provided for @labelPrinterErrorNoCompletion.
  ///
  /// In en, this message translates to:
  /// **'The printer did not confirm the tag. Check the labels and that the cover is closed, then try again. If it keeps happening, copy the print log and send it to the developer.'**
  String get labelPrinterErrorNoCompletion;

  /// No description provided for @labelPrinterErrorOutOfPaper.
  ///
  /// In en, this message translates to:
  /// **'The printer is out of labels. Load a roll and try again.'**
  String get labelPrinterErrorOutOfPaper;

  /// No description provided for @labelPrinterErrorWrite.
  ///
  /// In en, this message translates to:
  /// **'Sending to the printer failed. Try again.'**
  String get labelPrinterErrorWrite;

  /// No description provided for @labelPrinterErrorBusy.
  ///
  /// In en, this message translates to:
  /// **'The printer is busy with another job.'**
  String get labelPrinterErrorBusy;

  /// No description provided for @wpkMoneyReceivedNow.
  ///
  /// In en, this message translates to:
  /// **'Money received now?'**
  String get wpkMoneyReceivedNow;

  /// No description provided for @wpkMoneyReceivedNote.
  ///
  /// In en, this message translates to:
  /// **'Record what the customer paid at the counter as they drop it off.'**
  String get wpkMoneyReceivedNote;

  /// No description provided for @wpkMoneyReceivedNeedsPrice.
  ///
  /// In en, this message translates to:
  /// **'Enter a price first: a payment is always against one.'**
  String get wpkMoneyReceivedNeedsPrice;

  /// No description provided for @wpkErrReceivedByInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose someone on your team as the person who took the payment.'**
  String get wpkErrReceivedByInvalid;

  /// No description provided for @wpkSavedWithPayment.
  ///
  /// In en, this message translates to:
  /// **'Package saved: {code} · {amount} received'**
  String wpkSavedWithPayment(String code, String amount);

  /// No description provided for @pkgLabelSizeLabel.
  ///
  /// In en, this message translates to:
  /// **'Package label size'**
  String get pkgLabelSizeLabel;

  /// No description provided for @pkgLabelsHow.
  ///
  /// In en, this message translates to:
  /// **'How to print'**
  String get pkgLabelsHow;

  /// No description provided for @pkgLabelsMethodPrinter.
  ///
  /// In en, this message translates to:
  /// **'Label printer (Bluetooth)'**
  String get pkgLabelsMethodPrinter;

  /// No description provided for @pkgLabelsMethodPrinterNote.
  ///
  /// In en, this message translates to:
  /// **'Straight to the Phomemo label printer from this phone. Choose the printer in Printer settings.'**
  String get pkgLabelsMethodPrinterNote;

  /// No description provided for @pkgLabelsMethodPrinterNoteNamed.
  ///
  /// In en, this message translates to:
  /// **'Straight to {name} from this phone, on {size} labels.'**
  String pkgLabelsMethodPrinterNoteNamed(String name, String size);

  /// No description provided for @pkgLabelsMethodSystem.
  ///
  /// In en, this message translates to:
  /// **'Print 4 × 6 (any printer)'**
  String get pkgLabelsMethodSystem;

  /// No description provided for @pkgLabelsMethodSystemNote.
  ///
  /// In en, this message translates to:
  /// **'Opens the print dialog: AirPrint on iPhone, the print service on Android, including a 4 × 6 printer shared from your computer.'**
  String get pkgLabelsMethodSystemNote;

  /// No description provided for @pkgLabelsPrintButton.
  ///
  /// In en, this message translates to:
  /// **'Print'**
  String get pkgLabelsPrintButton;

  /// No description provided for @pkgLabelsPreparing.
  ///
  /// In en, this message translates to:
  /// **'Preparing labels…'**
  String get pkgLabelsPreparing;

  /// No description provided for @pkgLabelsStopping.
  ///
  /// In en, this message translates to:
  /// **'Stopping after this label…'**
  String get pkgLabelsStopping;

  /// No description provided for @pkgLabelsPrinted.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 label printed.} other{{count} labels printed.}}'**
  String pkgLabelsPrinted(int count);

  /// No description provided for @pkgLabelsCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'The labels could not be loaded. Try again in a moment.'**
  String get pkgLabelsCouldNotLoad;

  /// No description provided for @pkgLabelsNone.
  ///
  /// In en, this message translates to:
  /// **'No packages to print.'**
  String get pkgLabelsNone;

  /// No description provided for @pkgLabelsPrintFailed.
  ///
  /// In en, this message translates to:
  /// **'The labels could not be printed. Try again.'**
  String get pkgLabelsPrintFailed;

  /// No description provided for @pkgLabelsOneNotePrinter.
  ///
  /// In en, this message translates to:
  /// **'One label per piece: enough for a pickup or a torn label.'**
  String get pkgLabelsOneNotePrinter;

  /// No description provided for @pkgLabelsTipPrinter.
  ///
  /// In en, this message translates to:
  /// **'Each label carries the QR code, the tracking code, and both names and phone numbers. Set the label size to the roll loaded in the printer.'**
  String get pkgLabelsTipPrinter;

  /// No description provided for @pkgLabelsTipSystem.
  ///
  /// In en, this message translates to:
  /// **'Choose the 4 × 6 printer in the dialog and print at actual size (100 %). Two labels per package, one for each side.'**
  String get pkgLabelsTipSystem;

  /// No description provided for @invCreditMe.
  ///
  /// In en, this message translates to:
  /// **'{name} (me)'**
  String invCreditMe(String name);

  /// No description provided for @invCreditOnCredit.
  ///
  /// In en, this message translates to:
  /// **'On credit'**
  String get invCreditOnCredit;

  /// No description provided for @invCreditOnCreditNote.
  ///
  /// In en, this message translates to:
  /// **'The customer pays part now (or nothing) and owes the rest.'**
  String get invCreditOnCreditNote;

  /// No description provided for @invCreditPaidNow.
  ///
  /// In en, this message translates to:
  /// **'Paid now (US dollars)'**
  String get invCreditPaidNow;

  /// Credit sale: picker for the person who took the part paid now.
  ///
  /// In en, this message translates to:
  /// **'Who received the {amount} paid now'**
  String invCreditPaidNowReceivedBy(String amount);

  /// No description provided for @invCreditCustomerName.
  ///
  /// In en, this message translates to:
  /// **'Customer name'**
  String get invCreditCustomerName;

  /// No description provided for @invCreditCustomerPhone.
  ///
  /// In en, this message translates to:
  /// **'Customer phone (optional)'**
  String get invCreditCustomerPhone;

  /// No description provided for @invCreditCollector.
  ///
  /// In en, this message translates to:
  /// **'Who collects the rest'**
  String get invCreditCollector;

  /// No description provided for @invCreditCollectorPick.
  ///
  /// In en, this message translates to:
  /// **'Choose who collects'**
  String get invCreditCollectorPick;

  /// No description provided for @invCreditDueDate.
  ///
  /// In en, this message translates to:
  /// **'Due date (optional)'**
  String get invCreditDueDate;

  /// No description provided for @invCreditNoDueDate.
  ///
  /// In en, this message translates to:
  /// **'No due date'**
  String get invCreditNoDueDate;

  /// No description provided for @invCreditClearDueDate.
  ///
  /// In en, this message translates to:
  /// **'Clear the due date'**
  String get invCreditClearDueDate;

  /// No description provided for @invCreditSplit.
  ///
  /// In en, this message translates to:
  /// **'Paid now {paid} · On credit {owed}'**
  String invCreditSplit(String paid, String owed);

  /// No description provided for @invCreditErrPaidNowInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount paid now, or leave it empty for nothing.'**
  String get invCreditErrPaidNowInvalid;

  /// No description provided for @invCreditErrPaidNowTooLarge.
  ///
  /// In en, this message translates to:
  /// **'On credit, the amount paid now must be less than the total.'**
  String get invCreditErrPaidNowTooLarge;

  /// No description provided for @invCreditErrPhoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer\'s phone number.'**
  String get invCreditErrPhoneRequired;

  /// No description provided for @invCreditErrCollectorRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose who collects the rest.'**
  String get invCreditErrCollectorRequired;

  /// No description provided for @invCreditErrCollectorInvalid.
  ///
  /// In en, this message translates to:
  /// **'That person is not in this business.'**
  String get invCreditErrCollectorInvalid;

  /// No description provided for @invCreditErrDueDate.
  ///
  /// In en, this message translates to:
  /// **'Pick a due date from today on.'**
  String get invCreditErrDueDate;

  /// No description provided for @invCreditFixCheckout.
  ///
  /// In en, this message translates to:
  /// **'Check the payment details above.'**
  String get invCreditFixCheckout;

  /// No description provided for @invCreditOwes.
  ///
  /// In en, this message translates to:
  /// **'{name} owes {amount}'**
  String invCreditOwes(String name, String amount);

  /// No description provided for @invCreditFailCustomer.
  ///
  /// In en, this message translates to:
  /// **'A credit sale needs the customer\'s name and phone.'**
  String get invCreditFailCustomer;

  /// No description provided for @invCreditFailNoCredit.
  ///
  /// In en, this message translates to:
  /// **'This sale has nothing on credit.'**
  String get invCreditFailNoCredit;

  /// No description provided for @invCreditFailHasPayments.
  ///
  /// In en, this message translates to:
  /// **'This sale has credit payments. Revert them before voiding it.'**
  String get invCreditFailHasPayments;

  /// No description provided for @invCreditFailInvalid.
  ///
  /// In en, this message translates to:
  /// **'These credit details are not valid. Check them and try again.'**
  String get invCreditFailInvalid;

  /// No description provided for @invCreditFailAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount above zero, to the cent.'**
  String get invCreditFailAmountInvalid;

  /// No description provided for @invCreditFailPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer\'s phone with its country code.'**
  String get invCreditFailPhoneInvalid;

  /// No description provided for @invCreditPaymentOnCredit.
  ///
  /// In en, this message translates to:
  /// **'On credit'**
  String get invCreditPaymentOnCredit;

  /// No description provided for @invSummaryOnCredit.
  ///
  /// In en, this message translates to:
  /// **'Of which on credit {credit} ({owed} still owed)'**
  String invSummaryOnCredit(String credit, String owed);

  /// No description provided for @invCreditChipOpen.
  ///
  /// In en, this message translates to:
  /// **'Owed {amount}'**
  String invCreditChipOpen(String amount);

  /// No description provided for @invCreditChipOverdue.
  ///
  /// In en, this message translates to:
  /// **'Overdue {amount}'**
  String invCreditChipOverdue(String amount);

  /// No description provided for @invCreditChipPaid.
  ///
  /// In en, this message translates to:
  /// **'Credit paid'**
  String get invCreditChipPaid;

  /// No description provided for @invCreditFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All sales'**
  String get invCreditFilterAll;

  /// No description provided for @invCreditOwedTitle.
  ///
  /// In en, this message translates to:
  /// **'Credit owed'**
  String get invCreditOwedTitle;

  /// No description provided for @invCreditOwedHint.
  ///
  /// In en, this message translates to:
  /// **'Customers who still owe'**
  String get invCreditOwedHint;

  /// No description provided for @invCreditReceivedByName.
  ///
  /// In en, this message translates to:
  /// **'Received by {name}'**
  String invCreditReceivedByName(String name);

  /// No description provided for @invCreditDetails.
  ///
  /// In en, this message translates to:
  /// **'Credit details'**
  String get invCreditDetails;

  /// No description provided for @invCreditOwedOf.
  ///
  /// In en, this message translates to:
  /// **'{owed} owed of {credit}'**
  String invCreditOwedOf(String owed, String credit);

  /// No description provided for @invCreditPaidOff.
  ///
  /// In en, this message translates to:
  /// **'Paid in full'**
  String get invCreditPaidOff;

  /// No description provided for @invCreditCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get invCreditCustomer;

  /// No description provided for @invCreditCall.
  ///
  /// In en, this message translates to:
  /// **'Call {name}'**
  String invCreditCall(String name);

  /// No description provided for @invCreditCallFailed.
  ///
  /// In en, this message translates to:
  /// **'The phone could not start the call.'**
  String get invCreditCallFailed;

  /// No description provided for @invCreditCollectedBy.
  ///
  /// In en, this message translates to:
  /// **'Collected by {name}'**
  String invCreditCollectedBy(String name);

  /// No description provided for @invCreditNoCollector.
  ///
  /// In en, this message translates to:
  /// **'No one is collecting it yet'**
  String get invCreditNoCollector;

  /// No description provided for @invCreditDueOn.
  ///
  /// In en, this message translates to:
  /// **'Due {date}'**
  String invCreditDueOn(String date);

  /// No description provided for @invCreditOverdueSince.
  ///
  /// In en, this message translates to:
  /// **'Overdue since {date}'**
  String invCreditOverdueSince(String date);

  /// No description provided for @invCreditChange.
  ///
  /// In en, this message translates to:
  /// **'Change collector or due date'**
  String get invCreditChange;

  /// No description provided for @invCreditChanged.
  ///
  /// In en, this message translates to:
  /// **'Credit updated.'**
  String get invCreditChanged;

  /// No description provided for @invCreditPaidAtSale.
  ///
  /// In en, this message translates to:
  /// **'{amount} paid at the counter'**
  String invCreditPaidAtSale(String amount);

  /// No description provided for @invCreditVoidedNote.
  ///
  /// In en, this message translates to:
  /// **'This sale was voided: nothing is owed.'**
  String get invCreditVoidedNote;

  /// No description provided for @invCreditFilterMine.
  ///
  /// In en, this message translates to:
  /// **'Mine'**
  String get invCreditFilterMine;

  /// No description provided for @invCreditFilterEveryone.
  ///
  /// In en, this message translates to:
  /// **'Everyone'**
  String get invCreditFilterEveryone;

  /// No description provided for @invCreditTotals.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 open credit} other{{count} open credits}} · {amount} owed'**
  String invCreditTotals(int count, String amount);

  /// No description provided for @invCreditOverdueTotals.
  ///
  /// In en, this message translates to:
  /// **'{count} overdue · {amount}'**
  String invCreditOverdueTotals(int count, String amount);

  /// No description provided for @invCreditNoneOpen.
  ///
  /// In en, this message translates to:
  /// **'Nothing is owed.'**
  String get invCreditNoneOpen;

  /// No description provided for @invCreditNoneOpenHint.
  ///
  /// In en, this message translates to:
  /// **'Credit sales still owed show here until they are paid.'**
  String get invCreditNoneOpenHint;

  /// No description provided for @invCreditLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'The credits could not be loaded.'**
  String get invCreditLoadFailed;

  /// No description provided for @invCreditSoldOn.
  ///
  /// In en, this message translates to:
  /// **'Sold {date}'**
  String invCreditSoldOn(String date);

  /// No description provided for @invCreditNotifications.
  ///
  /// In en, this message translates to:
  /// **'Credit to collect'**
  String get invCreditNotifications;

  /// No description provided for @salesHistTitle.
  ///
  /// In en, this message translates to:
  /// **'Sales history'**
  String get salesHistTitle;

  /// No description provided for @salesHistHint.
  ///
  /// In en, this message translates to:
  /// **'Day, week, month, year'**
  String get salesHistHint;

  /// No description provided for @salesHistDay.
  ///
  /// In en, this message translates to:
  /// **'Day'**
  String get salesHistDay;

  /// No description provided for @salesHistWeek.
  ///
  /// In en, this message translates to:
  /// **'Week'**
  String get salesHistWeek;

  /// No description provided for @salesHistMonth.
  ///
  /// In en, this message translates to:
  /// **'Month'**
  String get salesHistMonth;

  /// No description provided for @salesHistYear.
  ///
  /// In en, this message translates to:
  /// **'Year'**
  String get salesHistYear;

  /// No description provided for @salesHistPrevious.
  ///
  /// In en, this message translates to:
  /// **'Previous period'**
  String get salesHistPrevious;

  /// No description provided for @salesHistNext.
  ///
  /// In en, this message translates to:
  /// **'Next period'**
  String get salesHistNext;

  /// No description provided for @salesHistPickDate.
  ///
  /// In en, this message translates to:
  /// **'Pick a date'**
  String get salesHistPickDate;

  /// No description provided for @salesHistRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get salesHistRefresh;

  /// No description provided for @salesHistCurrent.
  ///
  /// In en, this message translates to:
  /// **'{kind, select, day{Today} week{This week} month{This month} other{This year}}'**
  String salesHistCurrent(String kind);

  /// No description provided for @salesHistRange.
  ///
  /// In en, this message translates to:
  /// **'{start} – {end}'**
  String salesHistRange(String start, String end);

  /// No description provided for @salesHistTotalSold.
  ///
  /// In en, this message translates to:
  /// **'Total sold'**
  String get salesHistTotalSold;

  /// No description provided for @salesHistVsPrevious.
  ///
  /// In en, this message translates to:
  /// **'{change} {kind, select, day{vs the day before} week{vs the week before} month{vs the month before} other{vs the year before}}'**
  String salesHistVsPrevious(String change, String kind);

  /// No description provided for @salesHistNoComparison.
  ///
  /// In en, this message translates to:
  /// **'{kind, select, day{No sales the day before} week{No sales the week before} month{No sales the month before} other{No sales the year before}}'**
  String salesHistNoComparison(String kind);

  /// No description provided for @salesHistSalesLabel.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{sale} other{sales}}'**
  String salesHistSalesLabel(int count);

  /// No description provided for @salesHistAverage.
  ///
  /// In en, this message translates to:
  /// **'Average sale'**
  String get salesHistAverage;

  /// No description provided for @salesHistItemsLabel.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{item sold} other{items sold}}'**
  String salesHistItemsLabel(int count);

  /// No description provided for @salesHistProfitPartial.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 line has no cost and is left out} other{{count} lines have no cost and are left out}}'**
  String salesHistProfitPartial(int count);

  /// No description provided for @salesHistCollected.
  ///
  /// In en, this message translates to:
  /// **'Credit collected {amount}'**
  String salesHistCollected(String amount);

  /// No description provided for @salesHistVoidedCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 voided sale, not counted} other{{count} voided sales, not counted}}'**
  String salesHistVoidedCount(int count);

  /// No description provided for @salesHistChartTitle.
  ///
  /// In en, this message translates to:
  /// **'{kind, select, day{By hour} week{By day} month{By day} other{By month}}'**
  String salesHistChartTitle(String kind);

  /// No description provided for @salesHistChartHint.
  ///
  /// In en, this message translates to:
  /// **'Tap a bar to see its amount.'**
  String get salesHistChartHint;

  /// No description provided for @salesHistBarValue.
  ///
  /// In en, this message translates to:
  /// **'{label}: {amount}'**
  String salesHistBarValue(String label, String amount);

  /// No description provided for @salesHistOpenDay.
  ///
  /// In en, this message translates to:
  /// **'See this day'**
  String get salesHistOpenDay;

  /// No description provided for @salesHistOpenMonth.
  ///
  /// In en, this message translates to:
  /// **'See this month'**
  String get salesHistOpenMonth;

  /// No description provided for @salesHistByStore.
  ///
  /// In en, this message translates to:
  /// **'By store'**
  String get salesHistByStore;

  /// No description provided for @salesHistBySeller.
  ///
  /// In en, this message translates to:
  /// **'By seller'**
  String get salesHistBySeller;

  /// No description provided for @salesHistByPayment.
  ///
  /// In en, this message translates to:
  /// **'By payment'**
  String get salesHistByPayment;

  /// No description provided for @salesHistTopProducts.
  ///
  /// In en, this message translates to:
  /// **'Top products'**
  String get salesHistTopProducts;

  /// No description provided for @salesHistTopBrands.
  ///
  /// In en, this message translates to:
  /// **'Top brands'**
  String get salesHistTopBrands;

  /// No description provided for @salesHistTopCategories.
  ///
  /// In en, this message translates to:
  /// **'Top categories'**
  String get salesHistTopCategories;

  /// No description provided for @salesHistSalesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 sale} other{{count} sales}}'**
  String salesHistSalesCount(int count);

  /// No description provided for @salesHistPieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 sold} other{{count} sold}}'**
  String salesHistPieces(int count);

  /// No description provided for @salesHistNoStore.
  ///
  /// In en, this message translates to:
  /// **'No store'**
  String get salesHistNoStore;

  /// No description provided for @salesHistUnknownPerson.
  ///
  /// In en, this message translates to:
  /// **'Unknown person'**
  String get salesHistUnknownPerson;

  /// No description provided for @salesHistTimelineTitle.
  ///
  /// In en, this message translates to:
  /// **'What happened'**
  String get salesHistTimelineTitle;

  /// No description provided for @salesHistMoreLines.
  ///
  /// In en, this message translates to:
  /// **'{name} + {count} more'**
  String salesHistMoreLines(String name, int count);

  /// No description provided for @salesHistEventSaleFallback.
  ///
  /// In en, this message translates to:
  /// **'Sale'**
  String get salesHistEventSaleFallback;

  /// No description provided for @salesHistEventVoided.
  ///
  /// In en, this message translates to:
  /// **'Sale voided'**
  String get salesHistEventVoided;

  /// No description provided for @salesHistEventPayment.
  ///
  /// In en, this message translates to:
  /// **'Credit payment'**
  String get salesHistEventPayment;

  /// No description provided for @salesHistEventReverted.
  ///
  /// In en, this message translates to:
  /// **'Credit payment reverted'**
  String get salesHistEventReverted;

  /// No description provided for @salesHistEventAdded.
  ///
  /// In en, this message translates to:
  /// **'Stock added: {item}'**
  String salesHistEventAdded(String item);

  /// No description provided for @salesHistEventSet.
  ///
  /// In en, this message translates to:
  /// **'Count set: {item}'**
  String salesHistEventSet(String item);

  /// No description provided for @salesHistEventMoved.
  ///
  /// In en, this message translates to:
  /// **'Stock moved: {item}'**
  String salesHistEventMoved(String item);

  /// No description provided for @salesHistUnknownItem.
  ///
  /// In en, this message translates to:
  /// **'A product'**
  String get salesHistUnknownItem;

  /// No description provided for @salesHistVoidedTag.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get salesHistVoidedTag;

  /// No description provided for @salesHistByPerson.
  ///
  /// In en, this message translates to:
  /// **'by {name}'**
  String salesHistByPerson(String name);

  /// No description provided for @salesHistCountNow.
  ///
  /// In en, this message translates to:
  /// **'now {count}'**
  String salesHistCountNow(int count);

  /// No description provided for @salesHistEmpty.
  ///
  /// In en, this message translates to:
  /// **'No sales in this period'**
  String get salesHistEmpty;

  /// No description provided for @salesHistEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Pick another day, week, month or year.'**
  String get salesHistEmptyHint;

  /// No description provided for @salesHistTruncated.
  ///
  /// In en, this message translates to:
  /// **'Showing the first {count} records of this period (the newest). Pick a shorter period to see them all.'**
  String salesHistTruncated(String count);

  /// No description provided for @salesHistPartial.
  ///
  /// In en, this message translates to:
  /// **'Some activity could not be loaded, so stock changes, credit payments or older voids may be missing.'**
  String get salesHistPartial;

  /// No description provided for @salesHistLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load this period. Check the connection and try again.'**
  String get salesHistLoadFailed;

  /// No description provided for @salesHistNothingHappened.
  ///
  /// In en, this message translates to:
  /// **'Nothing happened in this period.'**
  String get salesHistNothingHappened;

  /// No description provided for @zelleCheckButton.
  ///
  /// In en, this message translates to:
  /// **'Check Zelle'**
  String get zelleCheckButton;

  /// No description provided for @zelleCheckTitle.
  ///
  /// In en, this message translates to:
  /// **'Zelle check'**
  String get zelleCheckTitle;

  /// No description provided for @zelleCheckSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Looking for exactly {amount} in the business bank'**
  String zelleCheckSubtitle(String amount);

  /// No description provided for @zelleChecking.
  ///
  /// In en, this message translates to:
  /// **'Checking the bank…'**
  String get zelleChecking;

  /// No description provided for @zelleReceivedAmount.
  ///
  /// In en, this message translates to:
  /// **'Received ✓ {amount}'**
  String zelleReceivedAmount(String amount);

  /// No description provided for @zelleDepositedIn.
  ///
  /// In en, this message translates to:
  /// **'Deposited in {bank}'**
  String zelleDepositedIn(String bank);

  /// No description provided for @zelleAlreadyConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Already confirmed against the bank.'**
  String get zelleAlreadyConfirmed;

  /// No description provided for @zelleNotFoundTitle.
  ///
  /// In en, this message translates to:
  /// **'Not in the bank yet'**
  String get zelleNotFoundTitle;

  /// No description provided for @zelleNotFoundHint.
  ///
  /// In en, this message translates to:
  /// **'No deposit of exactly {amount} yet. A Zelle can take a few minutes to arrive.'**
  String zelleNotFoundHint(String amount);

  /// No description provided for @zelleRetryIn.
  ///
  /// In en, this message translates to:
  /// **'Checking again in {seconds} s'**
  String zelleRetryIn(int seconds);

  /// No description provided for @zelleRetryStop.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get zelleRetryStop;

  /// No description provided for @zelleRetryStopped.
  ///
  /// In en, this message translates to:
  /// **'Automatic checks stopped.'**
  String get zelleRetryStopped;

  /// No description provided for @zelleRetryExhausted.
  ///
  /// In en, this message translates to:
  /// **'Still not there after 3 minutes. Ask the customer to confirm it was sent, then check again.'**
  String get zelleRetryExhausted;

  /// No description provided for @zelleCheckAgain.
  ///
  /// In en, this message translates to:
  /// **'Check again'**
  String get zelleCheckAgain;

  /// No description provided for @zelleChooseTitle.
  ///
  /// In en, this message translates to:
  /// **'Several deposits of {amount}'**
  String zelleChooseTitle(String amount);

  /// No description provided for @zelleChooseHint.
  ///
  /// In en, this message translates to:
  /// **'Pick the one from this customer, by the sender\'s name.'**
  String get zelleChooseHint;

  /// No description provided for @zelleUnknownSender.
  ///
  /// In en, this message translates to:
  /// **'Sender not shown'**
  String get zelleUnknownSender;

  /// No description provided for @zelleNotConnectedTitle.
  ///
  /// In en, this message translates to:
  /// **'Bank not connected'**
  String get zelleNotConnectedTitle;

  /// No description provided for @zelleNotConnectedStaff.
  ///
  /// In en, this message translates to:
  /// **'Ask the owner to connect the business bank, then check again.'**
  String get zelleNotConnectedStaff;

  /// No description provided for @zelleNotConnectedOwner.
  ///
  /// In en, this message translates to:
  /// **'Connect the bank that receives Zelle so your team can check payments.'**
  String get zelleNotConnectedOwner;

  /// No description provided for @zelleConnectBank.
  ///
  /// In en, this message translates to:
  /// **'Connect bank'**
  String get zelleConnectBank;

  /// No description provided for @zelleNeedsReauthTitle.
  ///
  /// In en, this message translates to:
  /// **'Bank sign-in needed'**
  String get zelleNeedsReauthTitle;

  /// No description provided for @zelleNeedsReauthStaff.
  ///
  /// In en, this message translates to:
  /// **'The bank asks the owner to sign in again. Ask the owner, then check again.'**
  String get zelleNeedsReauthStaff;

  /// No description provided for @zelleNeedsReauthOwner.
  ///
  /// In en, this message translates to:
  /// **'Your bank asks you to sign in again before payments can be checked.'**
  String get zelleNeedsReauthOwner;

  /// No description provided for @zelleReconnect.
  ///
  /// In en, this message translates to:
  /// **'Reconnect'**
  String get zelleReconnect;

  /// No description provided for @zelleChipConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Bank ✓'**
  String get zelleChipConfirmed;

  /// No description provided for @zelleFailNotZelle.
  ///
  /// In en, this message translates to:
  /// **'This payment was not recorded as Zelle.'**
  String get zelleFailNotZelle;

  /// No description provided for @zelleFailRecordNotFound.
  ///
  /// In en, this message translates to:
  /// **'This payment could not be found.'**
  String get zelleFailRecordNotFound;

  /// No description provided for @zelleFailRecordVoided.
  ///
  /// In en, this message translates to:
  /// **'This payment was voided or reverted, so there is nothing to check.'**
  String get zelleFailRecordVoided;

  /// No description provided for @zelleFailOwnerRequired.
  ///
  /// In en, this message translates to:
  /// **'Only the business owner can connect or change the bank.'**
  String get zelleFailOwnerRequired;

  /// No description provided for @zelleFailWindowInvalid.
  ///
  /// In en, this message translates to:
  /// **'Pick between 2 and 60 minutes.'**
  String get zelleFailWindowInvalid;

  /// No description provided for @zelleFailNetwork.
  ///
  /// In en, this message translates to:
  /// **'No connection. Check the connection and try again.'**
  String get zelleFailNetwork;

  /// No description provided for @zelleFailUnreadable.
  ///
  /// In en, this message translates to:
  /// **'The bank check did not answer clearly. Try again.'**
  String get zelleFailUnreadable;

  /// No description provided for @bankZelleTitle.
  ///
  /// In en, this message translates to:
  /// **'Bank for Zelle checks'**
  String get bankZelleTitle;

  /// No description provided for @bankZelleSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Let your team confirm Zelle payments arrived'**
  String get bankZelleSubtitle;

  /// No description provided for @bankZelleIntro.
  ///
  /// In en, this message translates to:
  /// **'Connect the account that receives Zelle. Your team can then confirm a payment arrived. They never see your balance or other transactions.'**
  String get bankZelleIntro;

  /// No description provided for @bankStatusActive.
  ///
  /// In en, this message translates to:
  /// **'Connected'**
  String get bankStatusActive;

  /// No description provided for @bankStatusNeedsReauth.
  ///
  /// In en, this message translates to:
  /// **'Sign-in needed'**
  String get bankStatusNeedsReauth;

  /// No description provided for @bankStatusDisconnected.
  ///
  /// In en, this message translates to:
  /// **'Not connected'**
  String get bankStatusDisconnected;

  /// No description provided for @bankUnnamed.
  ///
  /// In en, this message translates to:
  /// **'Your bank'**
  String get bankUnnamed;

  /// No description provided for @bankLastSync.
  ///
  /// In en, this message translates to:
  /// **'Last synced {when}'**
  String bankLastSync(String when);

  /// No description provided for @bankNeverSynced.
  ///
  /// In en, this message translates to:
  /// **'Not synced yet'**
  String get bankNeverSynced;

  /// No description provided for @bankNeedsReauthNote.
  ///
  /// In en, this message translates to:
  /// **'Your bank needs you to sign in again. Until then, Zelle checks will not work.'**
  String get bankNeedsReauthNote;

  /// No description provided for @bankWindowLabel.
  ///
  /// In en, this message translates to:
  /// **'Look for deposits within'**
  String get bankWindowLabel;

  /// No description provided for @bankWindowMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes} min'**
  String bankWindowMinutes(int minutes);

  /// No description provided for @bankWindowHint.
  ///
  /// In en, this message translates to:
  /// **'How long before a check a Zelle may have arrived.'**
  String get bankWindowHint;

  /// No description provided for @bankWindowSaved.
  ///
  /// In en, this message translates to:
  /// **'Window saved'**
  String get bankWindowSaved;

  /// No description provided for @bankDisconnect.
  ///
  /// In en, this message translates to:
  /// **'Disconnect bank'**
  String get bankDisconnect;

  /// No description provided for @bankDisconnectTitle.
  ///
  /// In en, this message translates to:
  /// **'Disconnect the bank?'**
  String get bankDisconnectTitle;

  /// No description provided for @bankDisconnectMessage.
  ///
  /// In en, this message translates to:
  /// **'Your team will not be able to check Zelle payments until you connect again. Payments already confirmed stay confirmed.'**
  String get bankDisconnectMessage;

  /// No description provided for @bankDisconnectedDone.
  ///
  /// In en, this message translates to:
  /// **'Bank disconnected'**
  String get bankDisconnectedDone;

  /// No description provided for @bankConnectedDone.
  ///
  /// In en, this message translates to:
  /// **'Bank connected'**
  String get bankConnectedDone;

  /// No description provided for @bankLinkFailed.
  ///
  /// In en, this message translates to:
  /// **'The bank connection did not finish. Try again.'**
  String get bankLinkFailed;

  /// No description provided for @bankLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the bank connection. Check the connection and try again.'**
  String get bankLoadFailed;

  /// No description provided for @bankConnecting.
  ///
  /// In en, this message translates to:
  /// **'Connecting…'**
  String get bankConnecting;

  /// No description provided for @zelleFailBankAccessDenied.
  ///
  /// In en, this message translates to:
  /// **'The bank refused access. The owner needs to connect the bank again.'**
  String get zelleFailBankAccessDenied;

  /// No description provided for @zelleFailKindInvalid.
  ///
  /// In en, this message translates to:
  /// **'This kind of payment can\'t be checked against the bank.'**
  String get zelleFailKindInvalid;

  /// No description provided for @zelleFailPlatformInvalid.
  ///
  /// In en, this message translates to:
  /// **'A bank can\'t be connected from this device.'**
  String get zelleFailPlatformInvalid;

  /// No description provided for @zelleFailNoDepositoryAccount.
  ///
  /// In en, this message translates to:
  /// **'Pick a checking or savings account: that is where Zelle arrives.'**
  String get zelleFailNoDepositoryAccount;

  /// No description provided for @zelleFailCandidateInvalid.
  ///
  /// In en, this message translates to:
  /// **'That deposit can\'t be used for this payment. Check again.'**
  String get zelleFailCandidateInvalid;

  /// No description provided for @zelleFailCandidateTaken.
  ///
  /// In en, this message translates to:
  /// **'Someone just matched that deposit to another payment. The list was checked again.'**
  String get zelleFailCandidateTaken;

  /// No description provided for @zelleFailBankError.
  ///
  /// In en, this message translates to:
  /// **'The bank didn\'t answer. Try again.'**
  String get zelleFailBankError;

  /// No description provided for @pcsKindPieces.
  ///
  /// In en, this message translates to:
  /// **'Barrels & boxes'**
  String get pcsKindPieces;

  /// No description provided for @pcsPiecesTitle.
  ///
  /// In en, this message translates to:
  /// **'Pieces ({count})'**
  String pcsPiecesTitle(int count);

  /// No description provided for @pcsKindBarrel.
  ///
  /// In en, this message translates to:
  /// **'Barrel'**
  String get pcsKindBarrel;

  /// No description provided for @pcsKindBox.
  ///
  /// In en, this message translates to:
  /// **'Box'**
  String get pcsKindBox;

  /// No description provided for @pcsKindOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get pcsKindOther;

  /// No description provided for @pcsKindLabel.
  ///
  /// In en, this message translates to:
  /// **'What piece {number} is'**
  String pcsKindLabel(int number);

  /// No description provided for @pcsDescriptionOptional.
  ///
  /// In en, this message translates to:
  /// **'Description (optional)'**
  String get pcsDescriptionOptional;

  /// No description provided for @pcsDescriptionWhat.
  ///
  /// In en, this message translates to:
  /// **'What is it?'**
  String get pcsDescriptionWhat;

  /// No description provided for @pcsPrice.
  ///
  /// In en, this message translates to:
  /// **'Price'**
  String get pcsPrice;

  /// No description provided for @pcsAddSize.
  ///
  /// In en, this message translates to:
  /// **'Add size (inches)'**
  String get pcsAddSize;

  /// No description provided for @pcsRemovePiece.
  ///
  /// In en, this message translates to:
  /// **'Remove piece {number}'**
  String pcsRemovePiece(int number);

  /// No description provided for @pcsAddPiece.
  ///
  /// In en, this message translates to:
  /// **'Add another piece'**
  String get pcsAddPiece;

  /// No description provided for @pcsTotalLabel.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece · Total} other{{count} pieces · Total}}'**
  String pcsTotalLabel(int count);

  /// No description provided for @pcsNoPriceYet.
  ///
  /// In en, this message translates to:
  /// **'No price yet'**
  String get pcsNoPriceYet;

  /// No description provided for @pcsSaveAndPrint.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Save and print 1 label} other{Save and print {count} labels}}'**
  String pcsSaveAndPrint(int count);

  /// No description provided for @pcsSaveAndAnother.
  ///
  /// In en, this message translates to:
  /// **'Save & register another for this sender'**
  String get pcsSaveAndAnother;

  /// No description provided for @pcsSaveOnly.
  ///
  /// In en, this message translates to:
  /// **'Save without printing'**
  String get pcsSaveOnly;

  /// No description provided for @pcsAnotherHint.
  ///
  /// In en, this message translates to:
  /// **'“Register another” keeps only the sender, for a different receiver or country.'**
  String get pcsAnotherHint;

  /// No description provided for @pcsBoxesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 box} other{{count} boxes}}'**
  String pcsBoxesCount(int count);

  /// No description provided for @pcsItemsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}}'**
  String pcsItemsCount(int count);

  /// No description provided for @pcsPieceCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece} other{{count} pieces}}'**
  String pcsPieceCount(int count);

  /// No description provided for @pcsErrPiecesRequired.
  ///
  /// In en, this message translates to:
  /// **'Add at least one piece.'**
  String get pcsErrPiecesRequired;

  /// No description provided for @pcsErrPiecesTooMany.
  ///
  /// In en, this message translates to:
  /// **'A package can have at most 60 pieces.'**
  String get pcsErrPiecesTooMany;

  /// No description provided for @pcsErrKindInvalid.
  ///
  /// In en, this message translates to:
  /// **'Say what each piece is: a barrel, a box, or something else.'**
  String get pcsErrKindInvalid;

  /// No description provided for @pcsErrDescriptionRequired.
  ///
  /// In en, this message translates to:
  /// **'Say what each box or item is.'**
  String get pcsErrDescriptionRequired;

  /// No description provided for @pcsErrDescriptionTooLong.
  ///
  /// In en, this message translates to:
  /// **'Keep each piece\'s description to 120 characters.'**
  String get pcsErrDescriptionTooLong;

  /// No description provided for @pcsErrSizeInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a piece\'s length, width and height in inches, or leave all three empty.'**
  String get pcsErrSizeInvalid;

  /// No description provided for @pcsErrPriceInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter each piece\'s price in dollars, zero or more.'**
  String get pcsErrPriceInvalid;

  /// No description provided for @pcsErrCountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose how many pieces go in: from 1 to the number the package has.'**
  String get pcsErrCountInvalid;

  /// No description provided for @pcsErrLineHasParts.
  ///
  /// In en, this message translates to:
  /// **'Other parts of this package are still listed. Remove them first.'**
  String get pcsErrLineHasParts;

  /// No description provided for @pcsGoingIn.
  ///
  /// In en, this message translates to:
  /// **'Pieces going in'**
  String get pcsGoingIn;

  /// No description provided for @pcsGoingOf.
  ///
  /// In en, this message translates to:
  /// **'{going} of {total}'**
  String pcsGoingOf(int going, int total);

  /// No description provided for @pcsFewer.
  ///
  /// In en, this message translates to:
  /// **'Fewer pieces'**
  String get pcsFewer;

  /// No description provided for @pcsMore.
  ///
  /// In en, this message translates to:
  /// **'More pieces'**
  String get pcsMore;

  /// No description provided for @pcsPreviewGoing.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece → this container} other{{count} pieces → this container}}'**
  String pcsPreviewGoing(int count);

  /// No description provided for @pcsPreviewStaying.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece stays waiting} other{{count} pieces stay waiting}}'**
  String pcsPreviewStaying(int count);

  /// No description provided for @pcsSplitNote.
  ///
  /// In en, this message translates to:
  /// **'No message is sent now. Each part gets its own departed and ready-for-pickup messages. Print new labels for the pieces that stay.'**
  String get pcsSplitNote;

  /// No description provided for @pcsPrintPartsTitle.
  ///
  /// In en, this message translates to:
  /// **'Print labels for the pieces that stay?'**
  String get pcsPrintPartsTitle;

  /// No description provided for @pcsPrintPartsMessage.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{{codes} stays on the waiting list under a new code, so its old labels are wrong. Print new ones now.} other{{codes} stay on the waiting list under new codes, so their old labels are wrong. Print new ones now.}}'**
  String pcsPrintPartsMessage(int count, String codes);

  /// No description provided for @pcsPrintPartsConfirm.
  ///
  /// In en, this message translates to:
  /// **'Print labels'**
  String get pcsPrintPartsConfirm;

  /// No description provided for @pcsPartLabelsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Labels for the part that stays waiting} other{Labels for the {count} parts that stay waiting}}'**
  String pcsPartLabelsSubtitle(int count);

  /// No description provided for @pcsGroupNote.
  ///
  /// In en, this message translates to:
  /// **'Paid and owed are for the whole package ({parts} parts). Payments are kept on {code}.'**
  String pcsGroupNote(int parts, String code);

  /// No description provided for @pcsPartPriceHint.
  ///
  /// In en, this message translates to:
  /// **'This part\'s own price. A changed total is spread evenly over its pieces.'**
  String get pcsPartPriceHint;

  /// No description provided for @pcsPartOf.
  ///
  /// In en, this message translates to:
  /// **'Part {index} of {code}'**
  String pcsPartOf(int index, String code);

  /// No description provided for @pcsTrackingPieces.
  ///
  /// In en, this message translates to:
  /// **'Pieces'**
  String get pcsTrackingPieces;

  /// No description provided for @pcsTrackingParts.
  ///
  /// In en, this message translates to:
  /// **'Parts of this package'**
  String get pcsTrackingParts;

  /// No description provided for @pcsTrackingPartsHint.
  ///
  /// In en, this message translates to:
  /// **'Some pieces may travel on a later container.'**
  String get pcsTrackingPartsHint;

  /// No description provided for @pcsTrackingMoney.
  ///
  /// In en, this message translates to:
  /// **'Price and payments'**
  String get pcsTrackingMoney;

  /// No description provided for @pcsTrackingPrice.
  ///
  /// In en, this message translates to:
  /// **'Final price'**
  String get pcsTrackingPrice;

  /// No description provided for @pcsTrackingPaid.
  ///
  /// In en, this message translates to:
  /// **'Paid'**
  String get pcsTrackingPaid;

  /// No description provided for @pcsTrackingBalance.
  ///
  /// In en, this message translates to:
  /// **'Still owed'**
  String get pcsTrackingBalance;

  /// No description provided for @prqSendPackage.
  ///
  /// In en, this message translates to:
  /// **'Send a package'**
  String get prqSendPackage;

  /// No description provided for @prqSendPackageSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Ask a business to take it and get an estimate'**
  String get prqSendPackageSubtitle;

  /// No description provided for @prqMyRequests.
  ///
  /// In en, this message translates to:
  /// **'My requests'**
  String get prqMyRequests;

  /// No description provided for @prqMyRequestsSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Estimates and answers from businesses'**
  String get prqMyRequestsSubtitle;

  /// No description provided for @prqSignInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in to send a request'**
  String get prqSignInTitle;

  /// No description provided for @prqSignInHint.
  ///
  /// In en, this message translates to:
  /// **'Your requests and estimates are kept in your account.'**
  String get prqSignInHint;

  /// No description provided for @prqSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign in'**
  String get prqSignIn;

  /// No description provided for @prqRetry.
  ///
  /// In en, this message translates to:
  /// **'Try again'**
  String get prqRetry;

  /// No description provided for @prqCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load. Check your connection and try again.'**
  String get prqCouldNotLoad;

  /// No description provided for @prqStepCountry.
  ///
  /// In en, this message translates to:
  /// **'Where is it going?'**
  String get prqStepCountry;

  /// No description provided for @prqPickCountry.
  ///
  /// In en, this message translates to:
  /// **'Choose a country'**
  String get prqPickCountry;

  /// No description provided for @prqSearchCountry.
  ///
  /// In en, this message translates to:
  /// **'Search a country'**
  String get prqSearchCountry;

  /// No description provided for @prqStepBusiness.
  ///
  /// In en, this message translates to:
  /// **'Who takes it?'**
  String get prqStepBusiness;

  /// No description provided for @prqNoBusinesses.
  ///
  /// In en, this message translates to:
  /// **'No business takes requests for this country yet.'**
  String get prqNoBusinesses;

  /// No description provided for @prqNoOptions.
  ///
  /// In en, this message translates to:
  /// **'No business takes package requests right now.'**
  String get prqNoOptions;

  /// No description provided for @prqBusinessStopped.
  ///
  /// In en, this message translates to:
  /// **'{name} is not taking requests right now.'**
  String prqBusinessStopped(String name);

  /// No description provided for @prqBarrelPrice.
  ///
  /// In en, this message translates to:
  /// **'{price} per barrel'**
  String prqBarrelPrice(String price);

  /// No description provided for @prqBarrelOnEstimate.
  ///
  /// In en, this message translates to:
  /// **'Barrels priced on estimate'**
  String get prqBarrelOnEstimate;

  /// No description provided for @prqStepHandoff.
  ///
  /// In en, this message translates to:
  /// **'How does it get to them?'**
  String get prqStepHandoff;

  /// No description provided for @prqBringIn.
  ///
  /// In en, this message translates to:
  /// **'Bring it in'**
  String get prqBringIn;

  /// No description provided for @prqBringInNote.
  ///
  /// In en, this message translates to:
  /// **'I drop it off at the business'**
  String get prqBringInNote;

  /// No description provided for @prqCollect.
  ///
  /// In en, this message translates to:
  /// **'Collect from me'**
  String get prqCollect;

  /// No description provided for @prqCollectNote.
  ///
  /// In en, this message translates to:
  /// **'The business picks it up'**
  String get prqCollectNote;

  /// No description provided for @prqUnavailableNote.
  ///
  /// In en, this message translates to:
  /// **'Not offered by this business'**
  String get prqUnavailableNote;

  /// No description provided for @prqDropOffAt.
  ///
  /// In en, this message translates to:
  /// **'Drop-off location'**
  String get prqDropOffAt;

  /// No description provided for @prqPlannedDay.
  ///
  /// In en, this message translates to:
  /// **'Day you plan to come'**
  String get prqPlannedDay;

  /// No description provided for @prqPickDay.
  ///
  /// In en, this message translates to:
  /// **'Choose a day'**
  String get prqPickDay;

  /// No description provided for @prqHoursOn.
  ///
  /// In en, this message translates to:
  /// **'Open {from} – {to} that day. Come any time in those hours.'**
  String prqHoursOn(String from, String to);

  /// No description provided for @prqClosedThatDay.
  ///
  /// In en, this message translates to:
  /// **'Closed that day. Pick another day.'**
  String get prqClosedThatDay;

  /// No description provided for @prqPlanNote.
  ///
  /// In en, this message translates to:
  /// **'This is a plan, not an appointment.'**
  String get prqPlanNote;

  /// No description provided for @prqPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Pickup address'**
  String get prqPickupAddress;

  /// No description provided for @prqPickupDay.
  ///
  /// In en, this message translates to:
  /// **'Preferred day'**
  String get prqPickupDay;

  /// No description provided for @prqPickupWindow.
  ///
  /// In en, this message translates to:
  /// **'Time of day'**
  String get prqPickupWindow;

  /// No description provided for @prqWindowMorning.
  ///
  /// In en, this message translates to:
  /// **'Morning'**
  String get prqWindowMorning;

  /// No description provided for @prqWindowAfternoon.
  ///
  /// In en, this message translates to:
  /// **'Afternoon'**
  String get prqWindowAfternoon;

  /// No description provided for @prqWindowEvening.
  ///
  /// In en, this message translates to:
  /// **'Evening'**
  String get prqWindowEvening;

  /// No description provided for @prqPickupNote.
  ///
  /// In en, this message translates to:
  /// **'Note for the driver (optional)'**
  String get prqPickupNote;

  /// No description provided for @prqCollectAreas.
  ///
  /// In en, this message translates to:
  /// **'Picks up in: {areas}'**
  String prqCollectAreas(String areas);

  /// No description provided for @prqCollectTimeNote.
  ///
  /// In en, this message translates to:
  /// **'The business sets the real time and any pickup fee in its estimate.'**
  String get prqCollectTimeNote;

  /// No description provided for @prqSender.
  ///
  /// In en, this message translates to:
  /// **'You (sender)'**
  String get prqSender;

  /// No description provided for @prqSenderName.
  ///
  /// In en, this message translates to:
  /// **'Your name'**
  String get prqSenderName;

  /// No description provided for @prqSenderPhone.
  ///
  /// In en, this message translates to:
  /// **'Your WhatsApp number'**
  String get prqSenderPhone;

  /// No description provided for @prqSenderPhoneHint.
  ///
  /// In en, this message translates to:
  /// **'The estimate comes on WhatsApp.'**
  String get prqSenderPhoneHint;

  /// No description provided for @prqReceiver.
  ///
  /// In en, this message translates to:
  /// **'Receiver'**
  String get prqReceiver;

  /// No description provided for @prqReceiverName.
  ///
  /// In en, this message translates to:
  /// **'Receiver’s name'**
  String get prqReceiverName;

  /// No description provided for @prqReceiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Receiver’s phone'**
  String get prqReceiverPhone;

  /// No description provided for @prqPieces.
  ///
  /// In en, this message translates to:
  /// **'What are you sending?'**
  String get prqPieces;

  /// No description provided for @prqPieceN.
  ///
  /// In en, this message translates to:
  /// **'Piece {n}'**
  String prqPieceN(int n);

  /// No description provided for @prqKindBarrel.
  ///
  /// In en, this message translates to:
  /// **'Barrel'**
  String get prqKindBarrel;

  /// No description provided for @prqKindBox.
  ///
  /// In en, this message translates to:
  /// **'Box'**
  String get prqKindBox;

  /// No description provided for @prqKindOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get prqKindOther;

  /// No description provided for @prqWhatIsIt.
  ///
  /// In en, this message translates to:
  /// **'What is it?'**
  String get prqWhatIsIt;

  /// No description provided for @prqWhatIsItHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. TV, suitcase, box of clothes'**
  String get prqWhatIsItHint;

  /// No description provided for @prqBarrelInside.
  ///
  /// In en, this message translates to:
  /// **'What’s inside (optional)'**
  String get prqBarrelInside;

  /// No description provided for @prqAddPhoto.
  ///
  /// In en, this message translates to:
  /// **'Add photo'**
  String get prqAddPhoto;

  /// No description provided for @prqPhotosCount.
  ///
  /// In en, this message translates to:
  /// **'Photos: {count} of {max}'**
  String prqPhotosCount(int count, int max);

  /// No description provided for @prqTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get prqTakePhoto;

  /// No description provided for @prqChoosePhoto.
  ///
  /// In en, this message translates to:
  /// **'Choose from photos'**
  String get prqChoosePhoto;

  /// No description provided for @prqPhotoFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t upload. Tap to retry.'**
  String get prqPhotoFailed;

  /// No description provided for @prqPhotoTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That photo is too large. Try another one.'**
  String get prqPhotoTooLarge;

  /// No description provided for @prqPhotoNotImage.
  ///
  /// In en, this message translates to:
  /// **'Only photos can be added (JPEG, PNG or WebP).'**
  String get prqPhotoNotImage;

  /// No description provided for @prqRemovePhoto.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get prqRemovePhoto;

  /// No description provided for @prqRemovePiece.
  ///
  /// In en, this message translates to:
  /// **'Remove piece'**
  String get prqRemovePiece;

  /// No description provided for @prqAddPiece.
  ///
  /// In en, this message translates to:
  /// **'+ Add another piece'**
  String get prqAddPiece;

  /// No description provided for @prqEstimateNoteBring.
  ///
  /// In en, this message translates to:
  /// **'The business sends you an estimate on WhatsApp before anything is decided. You pay when you drop it off.'**
  String get prqEstimateNoteBring;

  /// No description provided for @prqEstimateNoteCollect.
  ///
  /// In en, this message translates to:
  /// **'The business sends you an estimate on WhatsApp before anything is decided. You pay when it is collected.'**
  String get prqEstimateNoteCollect;

  /// No description provided for @prqSendRequest.
  ///
  /// In en, this message translates to:
  /// **'Send request'**
  String get prqSendRequest;

  /// No description provided for @prqSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get prqSending;

  /// No description provided for @prqWaitPhotos.
  ///
  /// In en, this message translates to:
  /// **'Wait for the photos to finish uploading.'**
  String get prqWaitPhotos;

  /// No description provided for @prqFixErrors.
  ///
  /// In en, this message translates to:
  /// **'Check the highlighted fields.'**
  String get prqFixErrors;

  /// No description provided for @prqSentTitle.
  ///
  /// In en, this message translates to:
  /// **'Request sent'**
  String get prqSentTitle;

  /// No description provided for @prqSentCode.
  ///
  /// In en, this message translates to:
  /// **'Your request code'**
  String get prqSentCode;

  /// No description provided for @prqSentTo.
  ///
  /// In en, this message translates to:
  /// **'Sent to {business}'**
  String prqSentTo(String business);

  /// No description provided for @prqNextSteps.
  ///
  /// In en, this message translates to:
  /// **'What happens next'**
  String get prqNextSteps;

  /// No description provided for @prqNext1.
  ///
  /// In en, this message translates to:
  /// **'{business} looks at your pieces and sends an estimate on WhatsApp.'**
  String prqNext1(String business);

  /// No description provided for @prqNext1Ready.
  ///
  /// In en, this message translates to:
  /// **'Your estimate is ready already: open it to see the prices.'**
  String get prqNext1Ready;

  /// No description provided for @prqNext2.
  ///
  /// In en, this message translates to:
  /// **'Open the estimate and tap Confirm if it suits you.'**
  String get prqNext2;

  /// No description provided for @prqNext3Bring.
  ///
  /// In en, this message translates to:
  /// **'Bring your pieces on the day you planned and pay there.'**
  String get prqNext3Bring;

  /// No description provided for @prqNext3Collect.
  ///
  /// In en, this message translates to:
  /// **'The business collects your pieces and you pay then.'**
  String get prqNext3Collect;

  /// No description provided for @prqSeeRequest.
  ///
  /// In en, this message translates to:
  /// **'See my request'**
  String get prqSeeRequest;

  /// No description provided for @prqMineEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No requests yet'**
  String get prqMineEmptyTitle;

  /// No description provided for @prqMineEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Send a package to get an estimate from a business.'**
  String get prqMineEmptyHint;

  /// No description provided for @prqNewRequest.
  ///
  /// In en, this message translates to:
  /// **'New request'**
  String get prqNewRequest;

  /// No description provided for @prqStatusNew.
  ///
  /// In en, this message translates to:
  /// **'Waiting for estimate'**
  String get prqStatusNew;

  /// No description provided for @prqStatusEstimateSent.
  ///
  /// In en, this message translates to:
  /// **'Estimate ready'**
  String get prqStatusEstimateSent;

  /// No description provided for @prqStatusConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed'**
  String get prqStatusConfirmed;

  /// No description provided for @prqStatusReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get prqStatusReceived;

  /// No description provided for @prqStatusDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get prqStatusDeclined;

  /// No description provided for @prqStatusYouDeclined.
  ///
  /// In en, this message translates to:
  /// **'You said no'**
  String get prqStatusYouDeclined;

  /// No description provided for @prqStatusCustomerDeclined.
  ///
  /// In en, this message translates to:
  /// **'Customer said no'**
  String get prqStatusCustomerDeclined;

  /// No description provided for @prqStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get prqStatusCancelled;

  /// No description provided for @prqStatusExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get prqStatusExpired;

  /// No description provided for @prqDetailTitle.
  ///
  /// In en, this message translates to:
  /// **'Request {code}'**
  String prqDetailTitle(String code);

  /// No description provided for @prqStateWaiting.
  ///
  /// In en, this message translates to:
  /// **'{business} is preparing your estimate.'**
  String prqStateWaiting(String business);

  /// No description provided for @prqStateWaitingHint.
  ///
  /// In en, this message translates to:
  /// **'You will get it on WhatsApp and here.'**
  String get prqStateWaitingHint;

  /// No description provided for @prqStateAwaiting.
  ///
  /// In en, this message translates to:
  /// **'Your estimate is ready'**
  String get prqStateAwaiting;

  /// No description provided for @prqStateAwaitingHint.
  ///
  /// In en, this message translates to:
  /// **'Confirm it if it suits you. Nothing is paid now.'**
  String get prqStateAwaitingHint;

  /// No description provided for @prqStateConfirmed.
  ///
  /// In en, this message translates to:
  /// **'You confirmed this estimate'**
  String get prqStateConfirmed;

  /// No description provided for @prqStateConfirmedByPhone.
  ///
  /// In en, this message translates to:
  /// **'Confirmed by phone with {business}'**
  String prqStateConfirmedByPhone(String business);

  /// No description provided for @prqPriceDropped.
  ///
  /// In en, this message translates to:
  /// **'The price went down since you confirmed. Nothing else to do.'**
  String get prqPriceDropped;

  /// No description provided for @prqStateReceived.
  ///
  /// In en, this message translates to:
  /// **'{business} received your pieces'**
  String prqStateReceived(String business);

  /// No description provided for @prqTrackingCode.
  ///
  /// In en, this message translates to:
  /// **'Tracking code {code}'**
  String prqTrackingCode(String code);

  /// No description provided for @prqTrack.
  ///
  /// In en, this message translates to:
  /// **'Track it'**
  String get prqTrack;

  /// No description provided for @prqStateDeclined.
  ///
  /// In en, this message translates to:
  /// **'{business} declined this request'**
  String prqStateDeclined(String business);

  /// No description provided for @prqStateCancelled.
  ///
  /// In en, this message translates to:
  /// **'{business} cancelled this request'**
  String prqStateCancelled(String business);

  /// No description provided for @prqReason.
  ///
  /// In en, this message translates to:
  /// **'Reason: {reason}'**
  String prqReason(String reason);

  /// No description provided for @prqStateCustomerDeclined.
  ///
  /// In en, this message translates to:
  /// **'You said no to this estimate'**
  String get prqStateCustomerDeclined;

  /// No description provided for @prqStateExpired.
  ///
  /// In en, this message translates to:
  /// **'This request expired'**
  String get prqStateExpired;

  /// No description provided for @prqStateExpiredHint.
  ///
  /// In en, this message translates to:
  /// **'Send a new request if you still need to ship.'**
  String get prqStateExpiredHint;

  /// No description provided for @prqChangedBanner.
  ///
  /// In en, this message translates to:
  /// **'This estimate changed — see the new one below.'**
  String get prqChangedBanner;

  /// No description provided for @prqAnswerBy.
  ///
  /// In en, this message translates to:
  /// **'Answer by {date}'**
  String prqAnswerBy(String date);

  /// No description provided for @prqConfirm.
  ///
  /// In en, this message translates to:
  /// **'Confirm'**
  String get prqConfirm;

  /// No description provided for @prqNoThanks.
  ///
  /// In en, this message translates to:
  /// **'No thanks'**
  String get prqNoThanks;

  /// No description provided for @prqNoThanksTitle.
  ///
  /// In en, this message translates to:
  /// **'Say no to this estimate?'**
  String get prqNoThanksTitle;

  /// No description provided for @prqNoThanksMessage.
  ///
  /// In en, this message translates to:
  /// **'The business is told. You can say why (optional).'**
  String get prqNoThanksMessage;

  /// No description provided for @prqReasonOptional.
  ///
  /// In en, this message translates to:
  /// **'Reason (optional)'**
  String get prqReasonOptional;

  /// No description provided for @prqConfirmedDone.
  ///
  /// In en, this message translates to:
  /// **'Estimate confirmed.'**
  String get prqConfirmedDone;

  /// No description provided for @prqAlreadyConfirmed.
  ///
  /// In en, this message translates to:
  /// **'You had already confirmed this estimate.'**
  String get prqAlreadyConfirmed;

  /// No description provided for @prqDeclinedDone.
  ///
  /// In en, this message translates to:
  /// **'Done. The business is told.'**
  String get prqDeclinedDone;

  /// No description provided for @prqTotal.
  ///
  /// In en, this message translates to:
  /// **'Total'**
  String get prqTotal;

  /// No description provided for @prqPickupFee.
  ///
  /// In en, this message translates to:
  /// **'Pickup fee'**
  String get prqPickupFee;

  /// No description provided for @prqPriceToCome.
  ///
  /// In en, this message translates to:
  /// **'Price to come'**
  String get prqPriceToCome;

  /// No description provided for @prqWhereWhen.
  ///
  /// In en, this message translates to:
  /// **'Where and when'**
  String get prqWhereWhen;

  /// No description provided for @prqBringTo.
  ///
  /// In en, this message translates to:
  /// **'Bring it to'**
  String get prqBringTo;

  /// No description provided for @prqPlannedFor.
  ///
  /// In en, this message translates to:
  /// **'Planned for {day}'**
  String prqPlannedFor(String day);

  /// No description provided for @prqPickupAt.
  ///
  /// In en, this message translates to:
  /// **'Pickup at'**
  String get prqPickupAt;

  /// No description provided for @prqDayWindow.
  ///
  /// In en, this message translates to:
  /// **'{day}, {window}'**
  String prqDayWindow(String day, String window);

  /// No description provided for @prqCallBusiness.
  ///
  /// In en, this message translates to:
  /// **'Call {business}'**
  String prqCallBusiness(String business);

  /// No description provided for @prqBusinessNote.
  ///
  /// In en, this message translates to:
  /// **'Note from the business'**
  String get prqBusinessNote;

  /// No description provided for @prqPayAtDropOff.
  ///
  /// In en, this message translates to:
  /// **'You pay at drop-off.'**
  String get prqPayAtDropOff;

  /// No description provided for @prqPayAtPickup.
  ///
  /// In en, this message translates to:
  /// **'You pay when it is collected.'**
  String get prqPayAtPickup;

  /// No description provided for @prqNotBinding.
  ///
  /// In en, this message translates to:
  /// **'The final price is set when the business sees your pieces.'**
  String get prqNotBinding;

  /// No description provided for @prqToReceiver.
  ///
  /// In en, this message translates to:
  /// **'To {name} · {country}'**
  String prqToReceiver(String name, String country);

  /// No description provided for @prqBarrelsCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 barrel} other{{count} barrels}}'**
  String prqBarrelsCount(int count);

  /// No description provided for @prqBoxesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 box} other{{count} boxes}}'**
  String prqBoxesCount(int count);

  /// No description provided for @prqOthersCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 other item} other{{count} other items}}'**
  String prqOthersCount(int count);

  /// No description provided for @prqPiecesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece} other{{count} pieces}}'**
  String prqPiecesCount(int count);

  /// No description provided for @prqRequestsTitle.
  ///
  /// In en, this message translates to:
  /// **'Requests'**
  String get prqRequestsTitle;

  /// No description provided for @prqEntryCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{No open requests} =1{1 open request} other{{count} open requests}}'**
  String prqEntryCount(int count);

  /// No description provided for @prqEntryHint.
  ///
  /// In en, this message translates to:
  /// **'Customers ask, you send the estimate'**
  String get prqEntryHint;

  /// No description provided for @prqChipNeedsEstimate.
  ///
  /// In en, this message translates to:
  /// **'Needs estimate · {count}'**
  String prqChipNeedsEstimate(int count);

  /// No description provided for @prqChipWaitingCustomer.
  ///
  /// In en, this message translates to:
  /// **'Waiting for customer · {count}'**
  String prqChipWaitingCustomer(int count);

  /// No description provided for @prqEmptyNeedsEstimate.
  ///
  /// In en, this message translates to:
  /// **'Nothing to estimate'**
  String get prqEmptyNeedsEstimate;

  /// No description provided for @prqEmptyWaiting.
  ///
  /// In en, this message translates to:
  /// **'No estimate waiting for an answer'**
  String get prqEmptyWaiting;

  /// No description provided for @prqEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Requests customers send you appear here.'**
  String get prqEmptyHint;

  /// No description provided for @prqBringsItOn.
  ///
  /// In en, this message translates to:
  /// **'Brings it {day}'**
  String prqBringsItOn(String day);

  /// No description provided for @prqCollectOn.
  ///
  /// In en, this message translates to:
  /// **'Collect {day}, {window}'**
  String prqCollectOn(String day, String window);

  /// No description provided for @prqNoDay.
  ///
  /// In en, this message translates to:
  /// **'No day given'**
  String get prqNoDay;

  /// No description provided for @prqLockedBy.
  ///
  /// In en, this message translates to:
  /// **'{name} is writing the estimate'**
  String prqLockedBy(String name);

  /// No description provided for @prqAgreedByPhone.
  ///
  /// In en, this message translates to:
  /// **'Customer agreed by phone'**
  String get prqAgreedByPhone;

  /// No description provided for @prqAgreedByPhoneTitle.
  ///
  /// In en, this message translates to:
  /// **'Customer agreed by phone?'**
  String get prqAgreedByPhoneTitle;

  /// No description provided for @prqAgreedByPhoneMessage.
  ///
  /// In en, this message translates to:
  /// **'This confirms estimate version {version} ({total}) for the customer. History records that you did it.'**
  String prqAgreedByPhoneMessage(int version, String total);

  /// No description provided for @prqAgreedDone.
  ///
  /// In en, this message translates to:
  /// **'Confirmed for the customer.'**
  String get prqAgreedDone;

  /// No description provided for @prqNotReachable.
  ///
  /// In en, this message translates to:
  /// **'Customer not reachable on WhatsApp'**
  String get prqNotReachable;

  /// No description provided for @prqSentOn.
  ///
  /// In en, this message translates to:
  /// **'Sent {date}'**
  String prqSentOn(String date);

  /// No description provided for @prqEstimateTotal.
  ///
  /// In en, this message translates to:
  /// **'Estimate {total}'**
  String prqEstimateTotal(String total);

  /// No description provided for @prqSettings.
  ///
  /// In en, this message translates to:
  /// **'Request settings'**
  String get prqSettings;

  /// No description provided for @prqCustomer.
  ///
  /// In en, this message translates to:
  /// **'Customer'**
  String get prqCustomer;

  /// No description provided for @prqEstimateTitle.
  ///
  /// In en, this message translates to:
  /// **'Estimate'**
  String get prqEstimateTitle;

  /// No description provided for @prqLockMine.
  ///
  /// In en, this message translates to:
  /// **'You are writing this estimate. Others see it as locked.'**
  String get prqLockMine;

  /// No description provided for @prqLockOther.
  ///
  /// In en, this message translates to:
  /// **'{name} is writing the estimate until {time}. You can read it.'**
  String prqLockOther(String name, String time);

  /// No description provided for @prqLockLapsed.
  ///
  /// In en, this message translates to:
  /// **'{name} stopped writing. You can take over.'**
  String prqLockLapsed(String name);

  /// No description provided for @prqTakeOver.
  ///
  /// In en, this message translates to:
  /// **'Take over'**
  String get prqTakeOver;

  /// No description provided for @prqLockLost.
  ///
  /// In en, this message translates to:
  /// **'Someone else took over this estimate.'**
  String get prqLockLost;

  /// No description provided for @prqStaleBanner.
  ///
  /// In en, this message translates to:
  /// **'This request changed while you were editing.'**
  String get prqStaleBanner;

  /// No description provided for @prqRefresh.
  ///
  /// In en, this message translates to:
  /// **'Refresh'**
  String get prqRefresh;

  /// No description provided for @prqPriceField.
  ///
  /// In en, this message translates to:
  /// **'Price (\$)'**
  String get prqPriceField;

  /// No description provided for @prqPriceRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a price.'**
  String get prqPriceRequired;

  /// No description provided for @prqPriceInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount like 45 or 45.50.'**
  String get prqPriceInvalid;

  /// No description provided for @prqPickupFeeField.
  ///
  /// In en, this message translates to:
  /// **'Pickup fee (\$, optional)'**
  String get prqPickupFeeField;

  /// No description provided for @prqPickupScheduleDay.
  ///
  /// In en, this message translates to:
  /// **'Pickup day you will come'**
  String get prqPickupScheduleDay;

  /// No description provided for @prqNoteToCustomer.
  ///
  /// In en, this message translates to:
  /// **'Note to the customer (optional)'**
  String get prqNoteToCustomer;

  /// No description provided for @prqSendEstimate.
  ///
  /// In en, this message translates to:
  /// **'Send estimate on WhatsApp'**
  String get prqSendEstimate;

  /// No description provided for @prqEstimateSentDone.
  ///
  /// In en, this message translates to:
  /// **'Estimate sent.'**
  String get prqEstimateSentDone;

  /// No description provided for @prqEstimateReconfirm.
  ///
  /// In en, this message translates to:
  /// **'Estimate sent. The total went up, so the customer must confirm again.'**
  String get prqEstimateReconfirm;

  /// No description provided for @prqEstimatePriceDropped.
  ///
  /// In en, this message translates to:
  /// **'Estimate sent. The total went down; the request stays confirmed.'**
  String get prqEstimatePriceDropped;

  /// No description provided for @prqDecline.
  ///
  /// In en, this message translates to:
  /// **'Decline request'**
  String get prqDecline;

  /// No description provided for @prqDeclineTitle.
  ///
  /// In en, this message translates to:
  /// **'Decline this request?'**
  String get prqDeclineTitle;

  /// No description provided for @prqDeclineMessage.
  ///
  /// In en, this message translates to:
  /// **'The customer sees your reason on their request.'**
  String get prqDeclineMessage;

  /// No description provided for @prqReasonLabel.
  ///
  /// In en, this message translates to:
  /// **'Reason'**
  String get prqReasonLabel;

  /// No description provided for @prqDeclined.
  ///
  /// In en, this message translates to:
  /// **'Request declined.'**
  String get prqDeclined;

  /// No description provided for @prqPhotoOf.
  ///
  /// In en, this message translates to:
  /// **'Photo {n} of {count}'**
  String prqPhotoOf(int n, int count);

  /// No description provided for @prqAutoEstimate.
  ///
  /// In en, this message translates to:
  /// **'Barrel price sent automatically'**
  String get prqAutoEstimate;

  /// No description provided for @prqVersionBy.
  ///
  /// In en, this message translates to:
  /// **'Version {version} · {name}'**
  String prqVersionBy(int version, String name);

  /// No description provided for @prqClosed.
  ///
  /// In en, this message translates to:
  /// **'This request is closed.'**
  String get prqClosed;

  /// No description provided for @prqActSubmitted.
  ///
  /// In en, this message translates to:
  /// **'Sent by the customer'**
  String get prqActSubmitted;

  /// No description provided for @prqActEstimateSent.
  ///
  /// In en, this message translates to:
  /// **'Estimate v{version} sent · {total}'**
  String prqActEstimateSent(int version, String total);

  /// No description provided for @prqActConfirmedLink.
  ///
  /// In en, this message translates to:
  /// **'Customer confirmed'**
  String get prqActConfirmedLink;

  /// No description provided for @prqActConfirmedPhone.
  ///
  /// In en, this message translates to:
  /// **'Confirmed by phone'**
  String get prqActConfirmedPhone;

  /// No description provided for @prqActConfirmedCard.
  ///
  /// In en, this message translates to:
  /// **'Paid online by card'**
  String get prqActConfirmedCard;

  /// No description provided for @prqActCustomerDeclined.
  ///
  /// In en, this message translates to:
  /// **'Customer said no'**
  String get prqActCustomerDeclined;

  /// No description provided for @prqActDeclined.
  ///
  /// In en, this message translates to:
  /// **'Declined'**
  String get prqActDeclined;

  /// No description provided for @prqActCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get prqActCancelled;

  /// No description provided for @prqActExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get prqActExpired;

  /// No description provided for @prqActReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get prqActReceived;

  /// No description provided for @prqActLockTakenOver.
  ///
  /// In en, this message translates to:
  /// **'Took over the estimate'**
  String get prqActLockTakenOver;

  /// No description provided for @prqActReminderSent.
  ///
  /// In en, this message translates to:
  /// **'Reminder sent'**
  String get prqActReminderSent;

  /// No description provided for @prqActOther.
  ///
  /// In en, this message translates to:
  /// **'Updated'**
  String get prqActOther;

  /// No description provided for @prqExpectedTitle.
  ///
  /// In en, this message translates to:
  /// **'Expected · {count}'**
  String prqExpectedTitle(int count);

  /// No description provided for @prqInShopTitle.
  ///
  /// In en, this message translates to:
  /// **'In the shop · {count}'**
  String prqInShopTitle(int count);

  /// No description provided for @prqReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get prqReceived;

  /// No description provided for @prqPickedUpReceived.
  ///
  /// In en, this message translates to:
  /// **'Picked up · Received'**
  String get prqPickedUpReceived;

  /// No description provided for @prqCancelRequest.
  ///
  /// In en, this message translates to:
  /// **'Cancel request'**
  String get prqCancelRequest;

  /// No description provided for @prqCancelTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this request?'**
  String get prqCancelTitle;

  /// No description provided for @prqCancelMessage.
  ///
  /// In en, this message translates to:
  /// **'The customer sees your reason on their request.'**
  String get prqCancelMessage;

  /// No description provided for @prqCancelledDone.
  ///
  /// In en, this message translates to:
  /// **'Request cancelled.'**
  String get prqCancelledDone;

  /// No description provided for @prqPaidOnline.
  ///
  /// In en, this message translates to:
  /// **'Paid online'**
  String get prqPaidOnline;

  /// No description provided for @prqPlannedDayShort.
  ///
  /// In en, this message translates to:
  /// **'Planned {day}'**
  String prqPlannedDayShort(String day);

  /// No description provided for @prqReceiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Pieces received'**
  String get prqReceiveTitle;

  /// No description provided for @prqReceiveSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{code} · confirm the final price of each piece'**
  String prqReceiveSubtitle(String code);

  /// No description provided for @prqFinalPrice.
  ///
  /// In en, this message translates to:
  /// **'Final price (\$)'**
  String get prqFinalPrice;

  /// No description provided for @prqPriceAllOrNone.
  ///
  /// In en, this message translates to:
  /// **'Price every piece, or none.'**
  String get prqPriceAllOrNone;

  /// No description provided for @prqLineTotal.
  ///
  /// In en, this message translates to:
  /// **'Total {total}'**
  String prqLineTotal(String total);

  /// No description provided for @prqReceiveAndPrint.
  ///
  /// In en, this message translates to:
  /// **'Received · print labels'**
  String get prqReceiveAndPrint;

  /// No description provided for @prqSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving…'**
  String get prqSaving;

  /// No description provided for @prqReceivedDone.
  ///
  /// In en, this message translates to:
  /// **'Received. Tracking code {code}.'**
  String prqReceivedDone(String code);

  /// No description provided for @prqAlreadyReceived.
  ///
  /// In en, this message translates to:
  /// **'Already received as {code}.'**
  String prqAlreadyReceived(String code);

  /// No description provided for @prqPaidOnlineNote.
  ///
  /// In en, this message translates to:
  /// **'Paid online by card: {amount}. No payment to take.'**
  String prqPaidOnlineNote(String amount);

  /// No description provided for @prqDescriptionField.
  ///
  /// In en, this message translates to:
  /// **'Description'**
  String get prqDescriptionField;

  /// No description provided for @prqPayOnArrivalSwitch.
  ///
  /// In en, this message translates to:
  /// **'Receiver pays on arrival'**
  String get prqPayOnArrivalSwitch;

  /// No description provided for @prqSettingsTitle.
  ///
  /// In en, this message translates to:
  /// **'Package requests'**
  String get prqSettingsTitle;

  /// No description provided for @prqAccept.
  ///
  /// In en, this message translates to:
  /// **'Accept package requests'**
  String get prqAccept;

  /// No description provided for @prqAcceptNote.
  ///
  /// In en, this message translates to:
  /// **'Customers can send you requests from the website and the app.'**
  String get prqAcceptNote;

  /// No description provided for @prqLinkTitle.
  ///
  /// In en, this message translates to:
  /// **'Your request link'**
  String get prqLinkTitle;

  /// No description provided for @prqLinkNone.
  ///
  /// In en, this message translates to:
  /// **'Save once to get your link.'**
  String get prqLinkNone;

  /// No description provided for @prqCopy.
  ///
  /// In en, this message translates to:
  /// **'Copy'**
  String get prqCopy;

  /// No description provided for @prqCopied.
  ///
  /// In en, this message translates to:
  /// **'Link copied.'**
  String get prqCopied;

  /// No description provided for @prqShare.
  ///
  /// In en, this message translates to:
  /// **'Share'**
  String get prqShare;

  /// No description provided for @prqShowQr.
  ///
  /// In en, this message translates to:
  /// **'QR code'**
  String get prqShowQr;

  /// No description provided for @prqQrHint.
  ///
  /// In en, this message translates to:
  /// **'Print it for your counter. It opens your request form.'**
  String get prqQrHint;

  /// No description provided for @prqSlugField.
  ///
  /// In en, this message translates to:
  /// **'Link name'**
  String get prqSlugField;

  /// No description provided for @prqSlugHint.
  ///
  /// In en, this message translates to:
  /// **'Lowercase letters, numbers and dashes. You can change it once.'**
  String get prqSlugHint;

  /// No description provided for @prqSlugLocked.
  ///
  /// In en, this message translates to:
  /// **'The link name was already changed once.'**
  String get prqSlugLocked;

  /// No description provided for @prqHoursTitle.
  ///
  /// In en, this message translates to:
  /// **'Opening hours'**
  String get prqHoursTitle;

  /// No description provided for @prqHoursHint.
  ///
  /// In en, this message translates to:
  /// **'Customers bring pieces in these hours. A location with no open day is not offered for drop-off.'**
  String get prqHoursHint;

  /// No description provided for @prqHeadquarters.
  ///
  /// In en, this message translates to:
  /// **'Main address'**
  String get prqHeadquarters;

  /// No description provided for @prqDayClosed.
  ///
  /// In en, this message translates to:
  /// **'Closed'**
  String get prqDayClosed;

  /// No description provided for @prqHoursRange.
  ///
  /// In en, this message translates to:
  /// **'{from} – {to}'**
  String prqHoursRange(String from, String to);

  /// No description provided for @prqPickupSettingsTitle.
  ///
  /// In en, this message translates to:
  /// **'We pick up'**
  String get prqPickupSettingsTitle;

  /// No description provided for @prqPickupSettingsNote.
  ///
  /// In en, this message translates to:
  /// **'Offer “Collect from me” to customers in the areas you cover.'**
  String get prqPickupSettingsNote;

  /// No description provided for @prqAreas.
  ///
  /// In en, this message translates to:
  /// **'Areas you cover'**
  String get prqAreas;

  /// No description provided for @prqAreasHint.
  ///
  /// In en, this message translates to:
  /// **'e.g. Bronx, Harlem, Newark'**
  String get prqAreasHint;

  /// No description provided for @prqCardBarrels.
  ///
  /// In en, this message translates to:
  /// **'Card payment for barrels'**
  String get prqCardBarrels;

  /// No description provided for @prqCardBarrelsNote.
  ///
  /// In en, this message translates to:
  /// **'Customers can pay barrels online; those orders show as Expected and paid online.'**
  String get prqCardBarrelsNote;

  /// No description provided for @prqSaved.
  ///
  /// In en, this message translates to:
  /// **'Settings saved.'**
  String get prqSaved;

  /// No description provided for @prqOwnerOnly.
  ///
  /// In en, this message translates to:
  /// **'Only the owner can change these settings.'**
  String get prqOwnerOnly;

  /// No description provided for @prqErrBusinessNotFound.
  ///
  /// In en, this message translates to:
  /// **'This request link doesn’t match any business.'**
  String get prqErrBusinessNotFound;

  /// No description provided for @prqErrBusinessUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This business can’t take requests right now.'**
  String get prqErrBusinessUnavailable;

  /// No description provided for @prqErrRequestsOff.
  ///
  /// In en, this message translates to:
  /// **'This business stopped taking requests.'**
  String get prqErrRequestsOff;

  /// No description provided for @prqErrDestinationUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This business no longer ships to that country.'**
  String get prqErrDestinationUnavailable;

  /// No description provided for @prqErrBringInUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This business no longer offers drop-off.'**
  String get prqErrBringInUnavailable;

  /// No description provided for @prqErrCollectUnavailable.
  ///
  /// In en, this message translates to:
  /// **'This business no longer offers pickup.'**
  String get prqErrCollectUnavailable;

  /// No description provided for @prqErrHandoff.
  ///
  /// In en, this message translates to:
  /// **'Choose Bring it in or Collect from me.'**
  String get prqErrHandoff;

  /// No description provided for @prqErrLocation.
  ///
  /// In en, this message translates to:
  /// **'Choose a drop-off location.'**
  String get prqErrLocation;

  /// No description provided for @prqErrPlannedDate.
  ///
  /// In en, this message translates to:
  /// **'Choose a day between today and 60 days from now.'**
  String get prqErrPlannedDate;

  /// No description provided for @prqErrPlannedDayClosed.
  ///
  /// In en, this message translates to:
  /// **'The business is closed that day.'**
  String get prqErrPlannedDayClosed;

  /// No description provided for @prqErrPickupAddress.
  ///
  /// In en, this message translates to:
  /// **'Enter the pickup address.'**
  String get prqErrPickupAddress;

  /// No description provided for @prqErrPickupDate.
  ///
  /// In en, this message translates to:
  /// **'Choose a pickup day between today and 60 days from now.'**
  String get prqErrPickupDate;

  /// No description provided for @prqErrPickupWindow.
  ///
  /// In en, this message translates to:
  /// **'Choose morning, afternoon or evening.'**
  String get prqErrPickupWindow;

  /// No description provided for @prqErrSenderName.
  ///
  /// In en, this message translates to:
  /// **'Enter your name.'**
  String get prqErrSenderName;

  /// No description provided for @prqErrSenderPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter your WhatsApp number with its country code.'**
  String get prqErrSenderPhone;

  /// No description provided for @prqErrReceiverName.
  ///
  /// In en, this message translates to:
  /// **'Enter the receiver’s name.'**
  String get prqErrReceiverName;

  /// No description provided for @prqErrReceiverPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter the receiver’s phone with its country code.'**
  String get prqErrReceiverPhone;

  /// No description provided for @prqErrPiecesRequired.
  ///
  /// In en, this message translates to:
  /// **'Add at least one piece.'**
  String get prqErrPiecesRequired;

  /// No description provided for @prqErrTooManyPieces.
  ///
  /// In en, this message translates to:
  /// **'20 pieces at most per request.'**
  String get prqErrTooManyPieces;

  /// No description provided for @prqErrPieceKind.
  ///
  /// In en, this message translates to:
  /// **'Choose barrel, box or other for each piece.'**
  String get prqErrPieceKind;

  /// No description provided for @prqErrPieceDescription.
  ///
  /// In en, this message translates to:
  /// **'Say what it is.'**
  String get prqErrPieceDescription;

  /// No description provided for @prqErrTextTooLong.
  ///
  /// In en, this message translates to:
  /// **'Some text is too long. Shorten it.'**
  String get prqErrTextTooLong;

  /// No description provided for @prqErrTooManyPhotos.
  ///
  /// In en, this message translates to:
  /// **'5 photos at most per piece.'**
  String get prqErrTooManyPhotos;

  /// No description provided for @prqErrPhotoInvalid.
  ///
  /// In en, this message translates to:
  /// **'A photo couldn’t be used. Remove it and add it again.'**
  String get prqErrPhotoInvalid;

  /// No description provided for @prqErrRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many requests in a short time. Try again in an hour.'**
  String get prqErrRateLimited;

  /// No description provided for @prqErrNotFound.
  ///
  /// In en, this message translates to:
  /// **'This request can’t be found.'**
  String get prqErrNotFound;

  /// No description provided for @prqErrEstimateMissing.
  ///
  /// In en, this message translates to:
  /// **'There is no estimate to confirm yet.'**
  String get prqErrEstimateMissing;

  /// No description provided for @prqErrCardOrder.
  ///
  /// In en, this message translates to:
  /// **'This order was paid by card. Cancel or refund it from its barrel order.'**
  String get prqErrCardOrder;

  /// No description provided for @prqErrSlugInvalid.
  ///
  /// In en, this message translates to:
  /// **'Use 3 to 40 lowercase letters, numbers or dashes.'**
  String get prqErrSlugInvalid;

  /// No description provided for @prqErrSlugTaken.
  ///
  /// In en, this message translates to:
  /// **'That link name is taken. Try another one.'**
  String get prqErrSlugTaken;

  /// No description provided for @prqErrHoursInvalid.
  ///
  /// In en, this message translates to:
  /// **'Each open day needs a start time before its end time.'**
  String get prqErrHoursInvalid;

  /// No description provided for @prqErrLocationUnknown.
  ///
  /// In en, this message translates to:
  /// **'One of the locations no longer exists. Reload and try again.'**
  String get prqErrLocationUnknown;

  /// No description provided for @prqErrPickupAreas.
  ///
  /// In en, this message translates to:
  /// **'Say which areas you cover.'**
  String get prqErrPickupAreas;

  /// No description provided for @prqErrLocked.
  ///
  /// In en, this message translates to:
  /// **'Someone else is writing this estimate.'**
  String get prqErrLocked;

  /// No description provided for @prqErrPieceMissing.
  ///
  /// In en, this message translates to:
  /// **'Every piece needs a price.'**
  String get prqErrPieceMissing;

  /// No description provided for @prqErrPieceUnknown.
  ///
  /// In en, this message translates to:
  /// **'The pieces changed. Refresh and try again.'**
  String get prqErrPieceUnknown;

  /// No description provided for @prqErrPickupFee.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid pickup fee.'**
  String get prqErrPickupFee;

  /// No description provided for @prqErrPickupSchedule.
  ///
  /// In en, this message translates to:
  /// **'Choose a valid pickup day.'**
  String get prqErrPickupSchedule;

  /// No description provided for @prqErrReasonRequired.
  ///
  /// In en, this message translates to:
  /// **'Give a reason.'**
  String get prqErrReasonRequired;

  /// No description provided for @prqErrOffline.
  ///
  /// In en, this message translates to:
  /// **'You’re offline. Check your connection and try again.'**
  String get prqErrOffline;

  /// No description provided for @prqErrAppCheck.
  ///
  /// In en, this message translates to:
  /// **'This app couldn’t be verified. Try again in a moment.'**
  String get prqErrAppCheck;

  /// No description provided for @prqErrPermission.
  ///
  /// In en, this message translates to:
  /// **'You don’t have access to this.'**
  String get prqErrPermission;

  /// No description provided for @prqErrGeneric.
  ///
  /// In en, this message translates to:
  /// **'That didn’t work. Try again.'**
  String get prqErrGeneric;

  /// setContainerLinePrice refusal: a collected request's line total may not go below its own pickup fee.
  ///
  /// In en, this message translates to:
  /// **'The price can\'t be less than the pickup fee.'**
  String get wpkErrPriceBelowPickupFee;

  /// Payment sheet: the price of a collected request's line includes its own pickup fee (shown as its own amount, never spread into the piece prices).
  ///
  /// In en, this message translates to:
  /// **'Includes the pickup fee: {amount}'**
  String wpkIncludesPickupFee(String amount);

  /// No description provided for @wpkGroupLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading the whole package\'s balance…'**
  String get wpkGroupLoading;

  /// No description provided for @lotBusinessOwner.
  ///
  /// In en, this message translates to:
  /// **'Business owner'**
  String get lotBusinessOwner;

  /// No description provided for @lotUnnamedPerson.
  ///
  /// In en, this message translates to:
  /// **'Team member'**
  String get lotUnnamedPerson;

  /// No description provided for @prqPickupNoteLine.
  ///
  /// In en, this message translates to:
  /// **'Note: {note}'**
  String prqPickupNoteLine(String note);

  /// No description provided for @invTrTitle.
  ///
  /// In en, this message translates to:
  /// **'Transfers'**
  String get invTrTitle;

  /// No description provided for @invTrNew.
  ///
  /// In en, this message translates to:
  /// **'New transfer'**
  String get invTrNew;

  /// No description provided for @invTrNotifications.
  ///
  /// In en, this message translates to:
  /// **'Store transfers'**
  String get invTrNotifications;

  /// No description provided for @invTrSendToStore.
  ///
  /// In en, this message translates to:
  /// **'Send to another store'**
  String get invTrSendToStore;

  /// No description provided for @invTrNeedsStores.
  ///
  /// In en, this message translates to:
  /// **'Transfers need two or more stores.'**
  String get invTrNeedsStores;

  /// No description provided for @invTrEntryHint.
  ///
  /// In en, this message translates to:
  /// **'Send stock to another store'**
  String get invTrEntryHint;

  /// No description provided for @invTrEntryCounts.
  ///
  /// In en, this message translates to:
  /// **'Incoming {incoming} · Review {review}'**
  String invTrEntryCounts(int incoming, int review);

  /// No description provided for @invTrTabOutgoing.
  ///
  /// In en, this message translates to:
  /// **'Outgoing'**
  String get invTrTabOutgoing;

  /// No description provided for @invTrTabIncoming.
  ///
  /// In en, this message translates to:
  /// **'Incoming'**
  String get invTrTabIncoming;

  /// No description provided for @invTrTabInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get invTrTabInTransit;

  /// No description provided for @invTrTabReview.
  ///
  /// In en, this message translates to:
  /// **'Review'**
  String get invTrTabReview;

  /// No description provided for @invTrEmptyOutgoing.
  ///
  /// In en, this message translates to:
  /// **'Nothing sent from here yet.'**
  String get invTrEmptyOutgoing;

  /// No description provided for @invTrEmptyIncoming.
  ///
  /// In en, this message translates to:
  /// **'Nothing on its way here.'**
  String get invTrEmptyIncoming;

  /// No description provided for @invTrEmptyInTransit.
  ///
  /// In en, this message translates to:
  /// **'Nothing in transit.'**
  String get invTrEmptyInTransit;

  /// No description provided for @invTrEmptyReview.
  ///
  /// In en, this message translates to:
  /// **'Nothing to review.'**
  String get invTrEmptyReview;

  /// No description provided for @invTrEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Send stock to another store with New transfer.'**
  String get invTrEmptyHint;

  /// No description provided for @invTrIncomingHint.
  ///
  /// In en, this message translates to:
  /// **'Something arriving? It\'s under Incoming. Open it and tap Confirm received.'**
  String get invTrIncomingHint;

  /// No description provided for @invTrLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Transfers could not be loaded.'**
  String get invTrLoadFailed;

  /// No description provided for @invTrNotAvailable.
  ///
  /// In en, this message translates to:
  /// **'That transfer is not available.'**
  String get invTrNotAvailable;

  /// No description provided for @invTrItems.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item} other{{count} items}}'**
  String invTrItems(int count);

  /// No description provided for @invTrProducts.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 product} other{{count} products}}'**
  String invTrProducts(int count);

  /// No description provided for @invTrNotSent.
  ///
  /// In en, this message translates to:
  /// **'not sent · nothing reserved yet'**
  String get invTrNotSent;

  /// No description provided for @invTrSentOnBy.
  ///
  /// In en, this message translates to:
  /// **'sent {date} by {name}'**
  String invTrSentOnBy(String date, String name);

  /// No description provided for @invTrReceivedOf.
  ///
  /// In en, this message translates to:
  /// **'{received} of {sent} received'**
  String invTrReceivedOf(int received, int sent);

  /// No description provided for @invTrMissingN.
  ///
  /// In en, this message translates to:
  /// **'{count} missing'**
  String invTrMissingN(int count);

  /// No description provided for @invTrOnBy.
  ///
  /// In en, this message translates to:
  /// **'{date} by {name}'**
  String invTrOnBy(String date, String name);

  /// No description provided for @invTrCancelledOnBy.
  ///
  /// In en, this message translates to:
  /// **'cancelled {date} by {name}'**
  String invTrCancelledOnBy(String date, String name);

  /// No description provided for @invTrStateDraft.
  ///
  /// In en, this message translates to:
  /// **'Draft'**
  String get invTrStateDraft;

  /// No description provided for @invTrStateInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit'**
  String get invTrStateInTransit;

  /// No description provided for @invTrStateLate.
  ///
  /// In en, this message translates to:
  /// **'In transit {days} days'**
  String invTrStateLate(int days);

  /// No description provided for @invTrStateReview.
  ///
  /// In en, this message translates to:
  /// **'Needs review'**
  String get invTrStateReview;

  /// No description provided for @invTrStateReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get invTrStateReceived;

  /// No description provided for @invTrStateSettled.
  ///
  /// In en, this message translates to:
  /// **'Settled'**
  String get invTrStateSettled;

  /// No description provided for @invTrStateCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get invTrStateCancelled;

  /// No description provided for @invTrResultComplete.
  ///
  /// In en, this message translates to:
  /// **'Complete'**
  String get invTrResultComplete;

  /// No description provided for @invTrResultDisputed.
  ///
  /// In en, this message translates to:
  /// **'{count} missing · disputed'**
  String invTrResultDisputed(int count);

  /// No description provided for @invTrResultReturned.
  ///
  /// In en, this message translates to:
  /// **'{count} returned to {store}'**
  String invTrResultReturned(int count, String store);

  /// No description provided for @invTrResultWrittenOff.
  ///
  /// In en, this message translates to:
  /// **'{count} written off · {reason}'**
  String invTrResultWrittenOff(int count, String reason);

  /// No description provided for @invTrReasonLost.
  ///
  /// In en, this message translates to:
  /// **'Lost in transit'**
  String get invTrReasonLost;

  /// No description provided for @invTrReasonDamaged.
  ///
  /// In en, this message translates to:
  /// **'Damaged'**
  String get invTrReasonDamaged;

  /// No description provided for @invTrReasonStolen.
  ///
  /// In en, this message translates to:
  /// **'Stolen'**
  String get invTrReasonStolen;

  /// No description provided for @invTrReasonOther.
  ///
  /// In en, this message translates to:
  /// **'Other'**
  String get invTrReasonOther;

  /// No description provided for @invTrEvDraftCreated.
  ///
  /// In en, this message translates to:
  /// **'Draft started by {name}'**
  String invTrEvDraftCreated(String name);

  /// No description provided for @invTrEvSent.
  ///
  /// In en, this message translates to:
  /// **'Sent by {name} ({items})'**
  String invTrEvSent(String name, String items);

  /// No description provided for @invTrEvCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled by {name}: {items} back in {store}'**
  String invTrEvCancelled(String name, String items, String store);

  /// No description provided for @invTrEvDiscarded.
  ///
  /// In en, this message translates to:
  /// **'Draft discarded by {name}'**
  String invTrEvDiscarded(String name);

  /// No description provided for @invTrEvReceivedAll.
  ///
  /// In en, this message translates to:
  /// **'{name} confirmed all {count} received'**
  String invTrEvReceivedAll(String name, int count);

  /// No description provided for @invTrEvReceivedShort.
  ///
  /// In en, this message translates to:
  /// **'{name} confirmed {received} received, {missing} missing'**
  String invTrEvReceivedShort(String name, int received, int missing);

  /// No description provided for @invTrEvReturned.
  ///
  /// In en, this message translates to:
  /// **'{name} returned {count} of {product} to {store}'**
  String invTrEvReturned(String name, int count, String product, String store);

  /// No description provided for @invTrEvWrittenOff.
  ///
  /// In en, this message translates to:
  /// **'{name} wrote off {count} of {product}: {reason}'**
  String invTrEvWrittenOff(
    String name,
    int count,
    String product,
    String reason,
  );

  /// No description provided for @invTrNoTimeline.
  ///
  /// In en, this message translates to:
  /// **'Nothing recorded yet.'**
  String get invTrNoTimeline;

  /// No description provided for @invTrTrackRecord.
  ///
  /// In en, this message translates to:
  /// **'Track record'**
  String get invTrTrackRecord;

  /// No description provided for @invTrSummaryInTransit.
  ///
  /// In en, this message translates to:
  /// **'In transit {amount}'**
  String invTrSummaryInTransit(String amount);

  /// No description provided for @invTrSummaryDisputed.
  ///
  /// In en, this message translates to:
  /// **'Disputed {amount}'**
  String invTrSummaryDisputed(String amount);

  /// No description provided for @invTrMoveInstant.
  ///
  /// In en, this message translates to:
  /// **'Instant transfer'**
  String get invTrMoveInstant;

  /// No description provided for @invTrMoveSent.
  ///
  /// In en, this message translates to:
  /// **'Sent in a transfer'**
  String get invTrMoveSent;

  /// No description provided for @invTrMoveReceived.
  ///
  /// In en, this message translates to:
  /// **'Received from a transfer'**
  String get invTrMoveReceived;

  /// No description provided for @invTrMoveCancelled.
  ///
  /// In en, this message translates to:
  /// **'Transfer cancelled'**
  String get invTrMoveCancelled;

  /// No description provided for @invTrMoveReturned.
  ///
  /// In en, this message translates to:
  /// **'Returned from a transfer'**
  String get invTrMoveReturned;

  /// No description provided for @invTrMoveWrittenOff.
  ///
  /// In en, this message translates to:
  /// **'Written off in a transfer'**
  String get invTrMoveWrittenOff;

  /// No description provided for @invTrChooseStore.
  ///
  /// In en, this message translates to:
  /// **'Choose a store'**
  String get invTrChooseStore;

  /// No description provided for @invTrAddProductHint.
  ///
  /// In en, this message translates to:
  /// **'Add a product by name'**
  String get invTrAddProductHint;

  /// No description provided for @invTrScanTooltip.
  ///
  /// In en, this message translates to:
  /// **'Scan a tag'**
  String get invTrScanTooltip;

  /// No description provided for @invTrScanTitle.
  ///
  /// In en, this message translates to:
  /// **'Scan a product tag'**
  String get invTrScanTitle;

  /// No description provided for @invTrInStore.
  ///
  /// In en, this message translates to:
  /// **'{count} in {store}'**
  String invTrInStore(int count, String store);

  /// No description provided for @invTrOnlyInStore.
  ///
  /// In en, this message translates to:
  /// **'Only {count} in {store}'**
  String invTrOnlyInStore(int count, String store);

  /// No description provided for @invTrNoneInStore.
  ///
  /// In en, this message translates to:
  /// **'{product}: none in {store}.'**
  String invTrNoneInStore(String product, String store);

  /// No description provided for @invTrAllOfThem.
  ///
  /// In en, this message translates to:
  /// **'That\'s all of them. You can\'t send more than the store has.'**
  String get invTrAllOfThem;

  /// No description provided for @invTrNoProductsYet.
  ///
  /// In en, this message translates to:
  /// **'No products yet. Add them by name, or scan their tag.'**
  String get invTrNoProductsYet;

  /// No description provided for @invTrRemoveLine.
  ///
  /// In en, this message translates to:
  /// **'Remove'**
  String get invTrRemoveLine;

  /// No description provided for @invTrLess.
  ///
  /// In en, this message translates to:
  /// **'One less'**
  String get invTrLess;

  /// No description provided for @invTrMore.
  ///
  /// In en, this message translates to:
  /// **'One more'**
  String get invTrMore;

  /// No description provided for @invTrOwnerNotified.
  ///
  /// In en, this message translates to:
  /// **'The owner is notified when you send.'**
  String get invTrOwnerNotified;

  /// No description provided for @invTrSaveDraft.
  ///
  /// In en, this message translates to:
  /// **'Save draft'**
  String get invTrSaveDraft;

  /// No description provided for @invTrSend.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =0{Send} =1{Send 1 item} other{Send {count} items}}'**
  String invTrSend(int count);

  /// No description provided for @invTrSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get invTrSending;

  /// No description provided for @invTrDraftSaved.
  ///
  /// In en, this message translates to:
  /// **'Draft saved. Nothing is reserved until you send.'**
  String get invTrDraftSaved;

  /// No description provided for @invTrErrTo.
  ///
  /// In en, this message translates to:
  /// **'Choose the store to send to.'**
  String get invTrErrTo;

  /// No description provided for @invTrErrOverMax.
  ///
  /// In en, this message translates to:
  /// **'A product is above what the store holds. Lower it to send.'**
  String get invTrErrOverMax;

  /// No description provided for @invTrContinue.
  ///
  /// In en, this message translates to:
  /// **'Continue'**
  String get invTrContinue;

  /// No description provided for @invTrSentTitle.
  ///
  /// In en, this message translates to:
  /// **'Transfer sent'**
  String get invTrSentTitle;

  /// No description provided for @invTrSentTo.
  ///
  /// In en, this message translates to:
  /// **'Sent to {store}'**
  String invTrSentTo(String store);

  /// No description provided for @invTrSentBody.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item is on its way. {store}\'s team got a notification and will confirm when it arrives.} other{{count} items are on their way. {store}\'s team got a notification and will confirm when they arrive.}}'**
  String invTrSentBody(int count, String store);

  /// No description provided for @invTrSentNote.
  ///
  /// In en, this message translates to:
  /// **'Until {store} confirms, these items can\'t be sold in either store. Made a mistake? You can cancel until {store} confirms.'**
  String invTrSentNote(String store);

  /// No description provided for @invTrDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get invTrDone;

  /// No description provided for @invTrReceiveTitle.
  ///
  /// In en, this message translates to:
  /// **'Receive transfer'**
  String get invTrReceiveTitle;

  /// No description provided for @invTrIncomingAt.
  ///
  /// In en, this message translates to:
  /// **'{store} · incoming'**
  String invTrIncomingAt(String store);

  /// No description provided for @invTrItemsFrom.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item from {store}} other{{count} items from {store}}}'**
  String invTrItemsFrom(int count, String store);

  /// No description provided for @invTrReceiveHelp.
  ///
  /// In en, this message translates to:
  /// **'Check the box against this list. If a number is different, change it before you confirm.'**
  String get invTrReceiveHelp;

  /// No description provided for @invTrSentQty.
  ///
  /// In en, this message translates to:
  /// **'Sent {count}'**
  String invTrSentQty(int count);

  /// No description provided for @invTrFewer.
  ///
  /// In en, this message translates to:
  /// **'{count} fewer than sent'**
  String invTrFewer(int count);

  /// No description provided for @invTrReceiveFooter.
  ///
  /// In en, this message translates to:
  /// **'Once confirmed, these items can be sold in {store}. Need tags? Print them from the product when you put it on the shelf.'**
  String invTrReceiveFooter(String store);

  /// No description provided for @invTrArrivedOf.
  ///
  /// In en, this message translates to:
  /// **'{arrived} of {sent} arrived'**
  String invTrArrivedOf(int arrived, int sent);

  /// No description provided for @invTrConfirmReceived.
  ///
  /// In en, this message translates to:
  /// **'Confirm received'**
  String get invTrConfirmReceived;

  /// No description provided for @invTrConfirming.
  ///
  /// In en, this message translates to:
  /// **'Confirming…'**
  String get invTrConfirming;

  /// No description provided for @invTrReceivedDone.
  ///
  /// In en, this message translates to:
  /// **'Received. These items can be sold in {store} now.'**
  String invTrReceivedDone(String store);

  /// No description provided for @invTrReceivedDoneMissing.
  ///
  /// In en, this message translates to:
  /// **'Received. The owner was told about the missing items.'**
  String get invTrReceivedDoneMissing;

  /// No description provided for @invTrMissingTitle.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item didn\'t arrive} other{{count} items didn\'t arrive}}'**
  String invTrMissingTitle(int count);

  /// No description provided for @invTrMissingBody.
  ///
  /// In en, this message translates to:
  /// **'{arrived} of {sent} arrived. The owner will be told about the missing ones.'**
  String invTrMissingBody(int arrived, int sent);

  /// No description provided for @invTrMissingLine.
  ///
  /// In en, this message translates to:
  /// **'{product}: sent {sent}, counted {counted}'**
  String invTrMissingLine(String product, int sent, int counted);

  /// No description provided for @invTrWhatHappened.
  ///
  /// In en, this message translates to:
  /// **'What happened? (optional)'**
  String get invTrWhatHappened;

  /// No description provided for @invTrMissingStayOff.
  ///
  /// In en, this message translates to:
  /// **'They stay off the shelves until the owner decides what happened.'**
  String get invTrMissingStayOff;

  /// No description provided for @invTrArrivedCanSell.
  ///
  /// In en, this message translates to:
  /// **'Everything else arrived and can be sold in {store} now.'**
  String invTrArrivedCanSell(String store);

  /// No description provided for @invTrGoBack.
  ///
  /// In en, this message translates to:
  /// **'Go back'**
  String get invTrGoBack;

  /// No description provided for @invTrConfirmCount.
  ///
  /// In en, this message translates to:
  /// **'Confirm {count} received'**
  String invTrConfirmCount(int count);

  /// No description provided for @invTrConfirmedOnBy.
  ///
  /// In en, this message translates to:
  /// **'confirmed {date} by {name}'**
  String invTrConfirmedOnBy(String date, String name);

  /// No description provided for @invTrStoreNote.
  ///
  /// In en, this message translates to:
  /// **'{store}\'s note: \"{note}\"'**
  String invTrStoreNote(String store, String note);

  /// No description provided for @invTrCantSell.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{This item can\'t be sold anywhere until you decide.} other{These {count} can\'t be sold anywhere until you decide.}}'**
  String invTrCantSell(int count);

  /// No description provided for @invTrReturnTo.
  ///
  /// In en, this message translates to:
  /// **'Return to {store}'**
  String invTrReturnTo(String store);

  /// No description provided for @invTrWriteOff.
  ///
  /// In en, this message translates to:
  /// **'Write off'**
  String get invTrWriteOff;

  /// No description provided for @invTrReasonTitle.
  ///
  /// In en, this message translates to:
  /// **'Reason for write-off'**
  String get invTrReasonTitle;

  /// No description provided for @invTrNoteOptional.
  ///
  /// In en, this message translates to:
  /// **'Note (optional)'**
  String get invTrNoteOptional;

  /// No description provided for @invTrWriteOffCount.
  ///
  /// In en, this message translates to:
  /// **'Write off {count}'**
  String invTrWriteOffCount(int count);

  /// No description provided for @invTrReturnedDone.
  ///
  /// In en, this message translates to:
  /// **'Returned to {store}.'**
  String invTrReturnedDone(String store);

  /// No description provided for @invTrWrittenOffDone.
  ///
  /// In en, this message translates to:
  /// **'Written off.'**
  String get invTrWrittenOffDone;

  /// No description provided for @invTrAllSettled.
  ///
  /// In en, this message translates to:
  /// **'Every missing item is decided. This transfer is settled.'**
  String get invTrAllSettled;

  /// No description provided for @invTrReviewFooter.
  ///
  /// In en, this message translates to:
  /// **'Only the owner and all-stores staff can settle differences. Reminders every 2 days until settled.'**
  String get invTrReviewFooter;

  /// No description provided for @invTrReviewAction.
  ///
  /// In en, this message translates to:
  /// **'Review missing items'**
  String get invTrReviewAction;

  /// No description provided for @invTrColProduct.
  ///
  /// In en, this message translates to:
  /// **'Product'**
  String get invTrColProduct;

  /// No description provided for @invTrColSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get invTrColSent;

  /// No description provided for @invTrColReceived.
  ///
  /// In en, this message translates to:
  /// **'Received'**
  String get invTrColReceived;

  /// No description provided for @invTrValueAtCost.
  ///
  /// In en, this message translates to:
  /// **'Value at cost: {amount}'**
  String invTrValueAtCost(String amount);

  /// No description provided for @invTrCancel.
  ///
  /// In en, this message translates to:
  /// **'Cancel transfer'**
  String get invTrCancel;

  /// No description provided for @invTrCancelTitle.
  ///
  /// In en, this message translates to:
  /// **'Cancel this transfer?'**
  String get invTrCancelTitle;

  /// No description provided for @invTrCancelMessage.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 item goes back to {store}.} other{{count} items go back to {store}.}}'**
  String invTrCancelMessage(int count, String store);

  /// No description provided for @invTrCancelDone.
  ///
  /// In en, this message translates to:
  /// **'Transfer cancelled. The items are back in the store.'**
  String get invTrCancelDone;

  /// No description provided for @invTrDiscard.
  ///
  /// In en, this message translates to:
  /// **'Discard draft'**
  String get invTrDiscard;

  /// No description provided for @invTrDiscardTitle.
  ///
  /// In en, this message translates to:
  /// **'Discard this draft?'**
  String get invTrDiscardTitle;

  /// No description provided for @invTrDiscardMessage.
  ///
  /// In en, this message translates to:
  /// **'Nothing was reserved, so nothing changes in the stores.'**
  String get invTrDiscardMessage;

  /// No description provided for @invTrDiscardDone.
  ///
  /// In en, this message translates to:
  /// **'Draft discarded.'**
  String get invTrDiscardDone;

  /// No description provided for @invTrPrintPick.
  ///
  /// In en, this message translates to:
  /// **'Print tags for which product?'**
  String get invTrPrintPick;

  /// No description provided for @invTrReceivedQty.
  ///
  /// In en, this message translates to:
  /// **'{count} received'**
  String invTrReceivedQty(int count);

  /// No description provided for @invTrGoneReceived.
  ///
  /// In en, this message translates to:
  /// **'Someone already confirmed this transfer.'**
  String get invTrGoneReceived;

  /// No description provided for @invTrGoneCancelled.
  ///
  /// In en, this message translates to:
  /// **'This transfer was cancelled.'**
  String get invTrGoneCancelled;

  /// No description provided for @inventoryFailTransferNotFound.
  ///
  /// In en, this message translates to:
  /// **'This transfer no longer exists.'**
  String get inventoryFailTransferNotFound;

  /// No description provided for @inventoryFailTransferNotDraft.
  ///
  /// In en, this message translates to:
  /// **'This draft was already sent or cancelled.'**
  String get inventoryFailTransferNotDraft;

  /// No description provided for @inventoryFailTransferNotInTransit.
  ///
  /// In en, this message translates to:
  /// **'This transfer is no longer in transit.'**
  String get inventoryFailTransferNotInTransit;

  /// No description provided for @inventoryFailLineNotDisputed.
  ///
  /// In en, this message translates to:
  /// **'Nothing is missing for this product.'**
  String get inventoryFailLineNotDisputed;

  /// No description provided for @inventoryFailLineAlreadyResolved.
  ///
  /// In en, this message translates to:
  /// **'Someone already decided on this product.'**
  String get inventoryFailLineAlreadyResolved;

  /// No description provided for @inventoryFailStoreHasTransfers.
  ///
  /// In en, this message translates to:
  /// **'Transfers from or to this store are not finished yet. Finish them first.'**
  String get inventoryFailStoreHasTransfers;

  /// No description provided for @inventoryFailItemInTransfer.
  ///
  /// In en, this message translates to:
  /// **'This product is in a transfer that is not finished yet.'**
  String get inventoryFailItemInTransfer;

  /// No description provided for @inventoryFailItemNotInTransfer.
  ///
  /// In en, this message translates to:
  /// **'That product is not in this transfer.'**
  String get inventoryFailItemNotInTransfer;

  /// No description provided for @inventoryFailReceivedTooMany.
  ///
  /// In en, this message translates to:
  /// **'You can\'t receive more than was sent.'**
  String get inventoryFailReceivedTooMany;

  /// No description provided for @inventoryFailWriteOffReasonInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose why the items are written off.'**
  String get inventoryFailWriteOffReasonInvalid;

  /// No description provided for @inventoryFailResolutionInvalid.
  ///
  /// In en, this message translates to:
  /// **'Choose Return or Write off.'**
  String get inventoryFailResolutionInvalid;

  /// No description provided for @inventoryFailNoteTooLong.
  ///
  /// In en, this message translates to:
  /// **'The note is too long (300 characters at most).'**
  String get inventoryFailNoteTooLong;

  /// No description provided for @inventoryFailTransferLinesRequired.
  ///
  /// In en, this message translates to:
  /// **'Add at least one product.'**
  String get inventoryFailTransferLinesRequired;

  /// No description provided for @inventoryFailTransferLinesTooMany.
  ///
  /// In en, this message translates to:
  /// **'A transfer holds at most 100 products.'**
  String get inventoryFailTransferLinesTooMany;

  /// No description provided for @phaSignInWithPhone.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your phone'**
  String get phaSignInWithPhone;

  /// No description provided for @phaSignInTitle.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your phone'**
  String get phaSignInTitle;

  /// No description provided for @phaSignInIntro.
  ///
  /// In en, this message translates to:
  /// **'We\'ll send a 6-digit code to this number on WhatsApp.'**
  String get phaSignInIntro;

  /// No description provided for @phaSendWhatsAppCode.
  ///
  /// In en, this message translates to:
  /// **'Send the code on WhatsApp'**
  String get phaSendWhatsAppCode;

  /// No description provided for @phaSendByText.
  ///
  /// In en, this message translates to:
  /// **'Send it by text instead'**
  String get phaSendByText;

  /// No description provided for @phaSendTextCode.
  ///
  /// In en, this message translates to:
  /// **'Send the code by text'**
  String get phaSendTextCode;

  /// No description provided for @phaCodeSentWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code we sent on WhatsApp to the number ending in ••{lastTwo}.'**
  String phaCodeSentWhatsApp(String lastTwo);

  /// No description provided for @phaCodeSentWhatsAppPlain.
  ///
  /// In en, this message translates to:
  /// **'Enter the 6-digit code we sent you on WhatsApp.'**
  String get phaCodeSentWhatsAppPlain;

  /// No description provided for @phaTextFullNumberIntro.
  ///
  /// In en, this message translates to:
  /// **'To get the code by text, enter your full phone number with its country code.'**
  String get phaTextFullNumberIntro;

  /// No description provided for @phaWhatsAppUnavailableNote.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp codes aren\'t available right now, so we\'ll send it by text.'**
  String get phaWhatsAppUnavailableNote;

  /// No description provided for @phaErrPhoneInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid phone number.'**
  String get phaErrPhoneInvalid;

  /// No description provided for @phaErrNeedsCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Add your country code to the number (for example +1 or +224).'**
  String get phaErrNeedsCountryCode;

  /// No description provided for @phaErrTrackingNotFound.
  ///
  /// In en, this message translates to:
  /// **'We couldn\'t find that tracking code.'**
  String get phaErrTrackingNotFound;

  /// No description provided for @phaErrNoPhoneOnRecord.
  ///
  /// In en, this message translates to:
  /// **'This package has no number we can send a code to.'**
  String get phaErrNoPhoneOnRecord;

  /// No description provided for @phaErrRateLimited.
  ///
  /// In en, this message translates to:
  /// **'Too many codes were sent. Please wait and try again.'**
  String get phaErrRateLimited;

  /// No description provided for @phaErrRateLimitedSeconds.
  ///
  /// In en, this message translates to:
  /// **'Too many codes were sent. Try again in {seconds} s.'**
  String phaErrRateLimitedSeconds(int seconds);

  /// No description provided for @phaErrRateLimitedMinutes.
  ///
  /// In en, this message translates to:
  /// **'{minutes, plural, =1{Too many codes were sent. Try again in 1 minute.} other{Too many codes were sent. Try again in {minutes} minutes.}}'**
  String phaErrRateLimitedMinutes(int minutes);

  /// No description provided for @phaErrWhatsAppUnavailable.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp codes aren\'t available right now. Send it by text instead.'**
  String get phaErrWhatsAppUnavailable;

  /// No description provided for @phaErrSignInRequired.
  ///
  /// In en, this message translates to:
  /// **'Sign in to your account first.'**
  String get phaErrSignInRequired;

  /// No description provided for @phaErrCodeWrong.
  ///
  /// In en, this message translates to:
  /// **'That code isn\'t right.'**
  String get phaErrCodeWrong;

  /// No description provided for @phaErrCodeWrongTries.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{That code isn\'t right. 1 try left.} other{That code isn\'t right. {count} tries left.}}'**
  String phaErrCodeWrongTries(int count);

  /// No description provided for @phaErrCodeExpired.
  ///
  /// In en, this message translates to:
  /// **'That code has expired. Ask for a new one.'**
  String get phaErrCodeExpired;

  /// No description provided for @phaErrTooManyAttempts.
  ///
  /// In en, this message translates to:
  /// **'Too many wrong codes. Ask for a new one.'**
  String get phaErrTooManyAttempts;

  /// No description provided for @phaErrChallengeNotFound.
  ///
  /// In en, this message translates to:
  /// **'Ask for a new code.'**
  String get phaErrChallengeNotFound;

  /// No description provided for @phaErrPhoneInUse.
  ///
  /// In en, this message translates to:
  /// **'This number already belongs to another Laawol account that has been used. Sign in with that number instead, or verify a different number.'**
  String get phaErrPhoneInUse;

  /// No description provided for @phaErrWrongAccount.
  ///
  /// In en, this message translates to:
  /// **'Another account asked for this code. Ask for a new one.'**
  String get phaErrWrongAccount;

  /// No description provided for @phaErrProofInvalid.
  ///
  /// In en, this message translates to:
  /// **'Verify the number again.'**
  String get phaErrProofInvalid;

  /// No description provided for @phaErrNoVerifiedPhone.
  ///
  /// In en, this message translates to:
  /// **'Add and verify your phone number in your profile to see your packages.'**
  String get phaErrNoVerifiedPhone;

  /// No description provided for @phaErrRecordInvalid.
  ///
  /// In en, this message translates to:
  /// **'That package could not be found.'**
  String get phaErrRecordInvalid;

  /// No description provided for @phaErrPhoneSignInUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Use your email and password to sign in to this account.'**
  String get phaErrPhoneSignInUnavailable;

  /// No description provided for @phaErrOffline.
  ///
  /// In en, this message translates to:
  /// **'Check your connection and try again.'**
  String get phaErrOffline;

  /// No description provided for @phaErrAppCheck.
  ///
  /// In en, this message translates to:
  /// **'This device couldn\'t be verified. Update the app and try again.'**
  String get phaErrAppCheck;

  /// No description provided for @phaErrGeneric.
  ///
  /// In en, this message translates to:
  /// **'Something went wrong. Please try again.'**
  String get phaErrGeneric;

  /// No description provided for @phaHintTitle.
  ///
  /// In en, this message translates to:
  /// **'Is this package yours?'**
  String get phaHintTitle;

  /// No description provided for @phaHintBody.
  ///
  /// In en, this message translates to:
  /// **'Sign in with the number on it to see all your packages, from every business.'**
  String get phaHintBody;

  /// No description provided for @phaHintSignInAs.
  ///
  /// In en, this message translates to:
  /// **'Sign in as the number ending in ••{lastTwo}'**
  String phaHintSignInAs(String lastTwo);

  /// No description provided for @phaHintSignInAsSender.
  ///
  /// In en, this message translates to:
  /// **'Sign in as the sender (••{lastTwo})'**
  String phaHintSignInAsSender(String lastTwo);

  /// No description provided for @phaHintSignInAsReceiver.
  ///
  /// In en, this message translates to:
  /// **'Sign in as the receiver (••{lastTwo})'**
  String phaHintSignInAsReceiver(String lastTwo);

  /// No description provided for @phaMyPackagesTitle.
  ///
  /// In en, this message translates to:
  /// **'My packages'**
  String get phaMyPackagesTitle;

  /// No description provided for @phaMyPackagesSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Every package recorded with your phone number'**
  String get phaMyPackagesSubtitle;

  /// No description provided for @phaSectionMine.
  ///
  /// In en, this message translates to:
  /// **'My packages'**
  String get phaSectionMine;

  /// No description provided for @phaSectionComingToYou.
  ///
  /// In en, this message translates to:
  /// **'Coming to you'**
  String get phaSectionComingToYou;

  /// No description provided for @phaEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No packages yet'**
  String get phaEmptyTitle;

  /// No description provided for @phaEmptyBody.
  ///
  /// In en, this message translates to:
  /// **'Packages a business records with your number ending in ••{lastTwo} will show up here.'**
  String phaEmptyBody(String lastTwo);

  /// No description provided for @phaEmptyBodyPlain.
  ///
  /// In en, this message translates to:
  /// **'Packages a business records with your phone number will show up here.'**
  String get phaEmptyBodyPlain;

  /// No description provided for @phaLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Your packages couldn\'t be loaded.'**
  String get phaLoadFailed;

  /// No description provided for @phaSignInToSee.
  ///
  /// In en, this message translates to:
  /// **'Sign in with your phone to see every package recorded with your number.'**
  String get phaSignInToSee;

  /// No description provided for @phaShowMore.
  ///
  /// In en, this message translates to:
  /// **'Show more'**
  String get phaShowMore;

  /// No description provided for @phaLoadingMore.
  ///
  /// In en, this message translates to:
  /// **'Loading...'**
  String get phaLoadingMore;

  /// No description provided for @phaBusinessUnknown.
  ///
  /// In en, this message translates to:
  /// **'A business'**
  String get phaBusinessUnknown;

  /// No description provided for @phaServicePackageRequest.
  ///
  /// In en, this message translates to:
  /// **'Package request'**
  String get phaServicePackageRequest;

  /// No description provided for @phaSentToSelf.
  ///
  /// In en, this message translates to:
  /// **'You\'re the sender and the receiver'**
  String get phaSentToSelf;

  /// No description provided for @phaRecordedOn.
  ///
  /// In en, this message translates to:
  /// **'Recorded {date}'**
  String phaRecordedOn(String date);

  /// No description provided for @phaUpdatedOn.
  ///
  /// In en, this message translates to:
  /// **'Updated {date}'**
  String phaUpdatedOn(String date);

  /// No description provided for @phaNotMine.
  ///
  /// In en, this message translates to:
  /// **'This isn\'t mine'**
  String get phaNotMine;

  /// No description provided for @phaNotMineTitle.
  ///
  /// In en, this message translates to:
  /// **'Not your package?'**
  String get phaNotMineTitle;

  /// No description provided for @phaNotMineBody.
  ///
  /// In en, this message translates to:
  /// **'It will be removed from your list, and {business} will be asked to check the number.'**
  String phaNotMineBody(String business);

  /// No description provided for @phaNotMineBodyPlain.
  ///
  /// In en, this message translates to:
  /// **'It will be removed from your list, and the business will be asked to check the number.'**
  String get phaNotMineBodyPlain;

  /// No description provided for @phaNotMineConfirm.
  ///
  /// In en, this message translates to:
  /// **'Remove it'**
  String get phaNotMineConfirm;

  /// No description provided for @phaNotMineDone.
  ///
  /// In en, this message translates to:
  /// **'Removed. The business will check the number.'**
  String get phaNotMineDone;

  /// No description provided for @phaFlagAddCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Add the country code'**
  String get phaFlagAddCountryCode;

  /// No description provided for @phaFlagReportedNotMine.
  ///
  /// In en, this message translates to:
  /// **'The person says this number isn\'t theirs - check it'**
  String get phaFlagReportedNotMine;

  /// No description provided for @phaNotSignedInYet.
  ///
  /// In en, this message translates to:
  /// **'Not signed in yet'**
  String get phaNotSignedInYet;

  /// No description provided for @phaSignInFilterSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Signed in'**
  String get phaSignInFilterSignedIn;

  /// No description provided for @phaSignInFilterNotSignedIn.
  ///
  /// In en, this message translates to:
  /// **'Not signed in yet'**
  String get phaSignInFilterNotSignedIn;

  /// No description provided for @phaSignInFilterAll.
  ///
  /// In en, this message translates to:
  /// **'Everyone'**
  String get phaSignInFilterAll;

  /// No description provided for @phaNoEmailActions.
  ///
  /// In en, this message translates to:
  /// **'This account has no email address: it signs in with its phone number, so email actions are not available.'**
  String get phaNoEmailActions;

  /// No description provided for @phaAccountOrigin.
  ///
  /// In en, this message translates to:
  /// **'Account made from'**
  String get phaAccountOrigin;

  /// No description provided for @phaAccountOriginShipment.
  ///
  /// In en, this message translates to:
  /// **'A shipment\'s phone number'**
  String get phaAccountOriginShipment;

  /// No description provided for @phaAccountOriginPhoneSignIn.
  ///
  /// In en, this message translates to:
  /// **'A phone sign-in'**
  String get phaAccountOriginPhoneSignIn;

  /// No description provided for @phaVerifyWithWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Get the code on WhatsApp instead'**
  String get phaVerifyWithWhatsApp;

  /// No description provided for @phaLinkMerged.
  ///
  /// In en, this message translates to:
  /// **'Your number is verified. Packages recorded with it now show in your account.'**
  String get phaLinkMerged;

  /// No description provided for @phaDeletePhoneOnlyNote.
  ///
  /// In en, this message translates to:
  /// **'To confirm, you must have signed in within the last 15 minutes. If it doesn\'t work, sign out and sign in again with your phone.'**
  String get phaDeletePhoneOnlyNote;

  /// No description provided for @phaDeleteRecentSignIn.
  ///
  /// In en, this message translates to:
  /// **'Sign out, sign in again with your phone, then delete your account within 15 minutes.'**
  String get phaDeleteRecentSignIn;

  /// No description provided for @phaPhoneOnlyNoPassword.
  ///
  /// In en, this message translates to:
  /// **'No email on your account? Go back and choose “Sign in with your phone” - there is no password to reset.'**
  String get phaPhoneOnlyNoPassword;

  /// No description provided for @invSwitchToCredit.
  ///
  /// In en, this message translates to:
  /// **'Switch to credit'**
  String get invSwitchToCredit;

  /// No description provided for @invSwitchToPaid.
  ///
  /// In en, this message translates to:
  /// **'Switch to paid'**
  String get invSwitchToPaid;

  /// No description provided for @invSwitchToCreditTitle.
  ///
  /// In en, this message translates to:
  /// **'Put this sale on credit'**
  String get invSwitchToCreditTitle;

  /// No description provided for @invSwitchToCreditNote.
  ///
  /// In en, this message translates to:
  /// **'The customer did not pay it all. Say who owes the rest. What was paid at the time keeps how it was paid and who received it.'**
  String get invSwitchToCreditNote;

  /// No description provided for @invSwitchPaidAtTime.
  ///
  /// In en, this message translates to:
  /// **'How much did they pay at the time? (US dollars)'**
  String get invSwitchPaidAtTime;

  /// No description provided for @invSwitchToPaidTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this sale as paid'**
  String get invSwitchToPaidTitle;

  /// No description provided for @invSwitchToPaidNote.
  ///
  /// In en, this message translates to:
  /// **'It was never credit: the whole {total} was paid at the time of the sale.'**
  String invSwitchToPaidNote(Object total);

  /// No description provided for @invSwitchHowPaid.
  ///
  /// In en, this message translates to:
  /// **'How it was paid'**
  String get invSwitchHowPaid;

  /// No description provided for @invSwitchConfirmCreditTitle.
  ///
  /// In en, this message translates to:
  /// **'Put this sale on credit?'**
  String get invSwitchConfirmCreditTitle;

  /// No description provided for @invSwitchConfirmCreditMessage.
  ///
  /// In en, this message translates to:
  /// **'{name} will owe {owed}. {paid} stays paid at the time. The collector is told.'**
  String invSwitchConfirmCreditMessage(String name, String owed, String paid);

  /// No description provided for @invSwitchConfirmPaidTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this sale as paid?'**
  String get invSwitchConfirmPaidTitle;

  /// No description provided for @invSwitchConfirmPaidMessage.
  ///
  /// In en, this message translates to:
  /// **'The whole {total} was paid at the time of the sale. Nobody owes anything on it any more.'**
  String invSwitchConfirmPaidMessage(Object total);

  /// No description provided for @invSwitchedToCredit.
  ///
  /// In en, this message translates to:
  /// **'Switched to credit: {owed} owed'**
  String invSwitchedToCredit(Object owed);

  /// No description provided for @invSwitchedToPaid.
  ///
  /// In en, this message translates to:
  /// **'Switched to paid'**
  String get invSwitchedToPaid;

  /// No description provided for @invSwitchLineCredit.
  ///
  /// In en, this message translates to:
  /// **'Switched to credit by {who} · {when} · {paid} paid, {owed} owed'**
  String invSwitchLineCredit(String who, String when, String paid, String owed);

  /// No description provided for @invSwitchLinePaid.
  ///
  /// In en, this message translates to:
  /// **'Switched to paid by {who} · {when} · {total} paid ({method})'**
  String invSwitchLinePaid(
    String who,
    String when,
    String total,
    String method,
  );

  /// No description provided for @invSwitchFailAlreadyCredit.
  ///
  /// In en, this message translates to:
  /// **'This sale is already on credit.'**
  String get invSwitchFailAlreadyCredit;

  /// No description provided for @invSwitchFailAlreadyPaid.
  ///
  /// In en, this message translates to:
  /// **'This sale is already paid in full.'**
  String get invSwitchFailAlreadyPaid;

  /// No description provided for @invSwitchFailPaymentsRecorded.
  ///
  /// In en, this message translates to:
  /// **'Money was already collected on this credit, so it can\'t become a paid sale. Use Record a payment for what is still owed.'**
  String get invSwitchFailPaymentsRecorded;

  /// No description provided for @invSwitchFailTooMany.
  ///
  /// In en, this message translates to:
  /// **'This sale was switched too many times.'**
  String get invSwitchFailTooMany;

  /// No description provided for @bankCheckEntryTitle.
  ///
  /// In en, this message translates to:
  /// **'Check bank'**
  String get bankCheckEntryTitle;

  /// No description provided for @bankCheckEntryHint.
  ///
  /// In en, this message translates to:
  /// **'Did a Zelle arrive? Check the amount.'**
  String get bankCheckEntryHint;

  /// No description provided for @bankCheckConnectHint.
  ///
  /// In en, this message translates to:
  /// **'Connect your bank to check Zelle payments from here.'**
  String get bankCheckConnectHint;

  /// No description provided for @bankCheckReconnectHint.
  ///
  /// In en, this message translates to:
  /// **'Your bank asks you to sign in again before Zelle can be checked.'**
  String get bankCheckReconnectHint;

  /// No description provided for @bankCheckSubtitle.
  ///
  /// In en, this message translates to:
  /// **'See if a Zelle of exactly this amount reached the business bank. Nothing is recorded.'**
  String get bankCheckSubtitle;

  /// No description provided for @bankCheckAmountLabel.
  ///
  /// In en, this message translates to:
  /// **'Exact amount'**
  String get bankCheckAmountLabel;

  /// No description provided for @bankCheckAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Type the amount, like 60 or 60.50.'**
  String get bankCheckAmountInvalid;

  /// No description provided for @bankCheckAmountTooLarge.
  ///
  /// In en, this message translates to:
  /// **'That amount is too large to check.'**
  String get bankCheckAmountTooLarge;

  /// No description provided for @bankCheckSinceLabel.
  ///
  /// In en, this message translates to:
  /// **'When was it sent?'**
  String get bankCheckSinceLabel;

  /// No description provided for @bankCheckSince15m.
  ///
  /// In en, this message translates to:
  /// **'Last 15 minutes'**
  String get bankCheckSince15m;

  /// No description provided for @bankCheckSince1h.
  ///
  /// In en, this message translates to:
  /// **'Last hour'**
  String get bankCheckSince1h;

  /// No description provided for @bankCheckSinceToday.
  ///
  /// In en, this message translates to:
  /// **'Today'**
  String get bankCheckSinceToday;

  /// No description provided for @bankCheckButton.
  ///
  /// In en, this message translates to:
  /// **'Check'**
  String get bankCheckButton;

  /// No description provided for @bankCheckSeveralHint.
  ///
  /// In en, this message translates to:
  /// **'Find the customer\'s by the sender\'s name.'**
  String get bankCheckSeveralHint;

  /// No description provided for @bankCheckPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get bankCheckPending;

  /// No description provided for @bankCheckLimitNote.
  ///
  /// In en, this message translates to:
  /// **'This month\'s bank refresh limit is reached, so new deposits can take longer to show.'**
  String get bankCheckLimitNote;

  /// No description provided for @bankCheckUseForSale.
  ///
  /// In en, this message translates to:
  /// **'Use for a sale'**
  String get bankCheckUseForSale;

  /// No description provided for @bankCheckUsed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed for a sale'**
  String get bankCheckUsed;

  /// No description provided for @bankUseSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Pick the Zelle payment of {amount} this deposit pays.'**
  String bankUseSubtitle(String amount);

  /// No description provided for @bankUseRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent Zelle payments of this amount'**
  String get bankUseRecent;

  /// No description provided for @bankUseResults.
  ///
  /// In en, this message translates to:
  /// **'Payments that match'**
  String get bankUseResults;

  /// No description provided for @bankUseSearchLabel.
  ///
  /// In en, this message translates to:
  /// **'Customer, items or tracking code'**
  String get bankUseSearchLabel;

  /// No description provided for @bankUseSearchButton.
  ///
  /// In en, this message translates to:
  /// **'Search'**
  String get bankUseSearchButton;

  /// No description provided for @bankUseEmptyRecent.
  ///
  /// In en, this message translates to:
  /// **'No recent Zelle payment of {amount} is waiting for the bank. Search older ones above.'**
  String bankUseEmptyRecent(String amount);

  /// No description provided for @bankUseEmptySearch.
  ///
  /// In en, this message translates to:
  /// **'Nothing matches “{query}”.'**
  String bankUseEmptySearch(String query);

  /// No description provided for @bankUseLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn\'t load the payments. Check the connection and try again.'**
  String get bankUseLoadFailed;

  /// No description provided for @bankUseKindSale.
  ///
  /// In en, this message translates to:
  /// **'Sale'**
  String get bankUseKindSale;

  /// No description provided for @bankUseKindCreditPayment.
  ///
  /// In en, this message translates to:
  /// **'Credit payment'**
  String get bankUseKindCreditPayment;

  /// No description provided for @bankUseKindPackagePayment.
  ///
  /// In en, this message translates to:
  /// **'Package payment'**
  String get bankUseKindPackagePayment;

  /// No description provided for @bankUseNoName.
  ///
  /// In en, this message translates to:
  /// **'No customer name'**
  String get bankUseNoName;

  /// No description provided for @bankUseConfirmButton.
  ///
  /// In en, this message translates to:
  /// **'Use for this sale'**
  String get bankUseConfirmButton;

  /// No description provided for @bankUseConfirming.
  ///
  /// In en, this message translates to:
  /// **'Confirming…'**
  String get bankUseConfirming;

  /// No description provided for @bankUseConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Confirmed for this sale'**
  String get bankUseConfirmed;

  /// No description provided for @zelleFailAmountMismatch.
  ///
  /// In en, this message translates to:
  /// **'That payment is not for the same amount as the deposit.'**
  String get zelleFailAmountMismatch;

  /// No description provided for @zelleFailCheckAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Type an amount above zero, with at most two decimals.'**
  String get zelleFailCheckAmountInvalid;

  /// No description provided for @zelleFailSinceInvalid.
  ///
  /// In en, this message translates to:
  /// **'Pick when it was sent.'**
  String get zelleFailSinceInvalid;

  /// No description provided for @zelleFailModeInvalid.
  ///
  /// In en, this message translates to:
  /// **'This check needs an update of the app.'**
  String get zelleFailModeInvalid;

  /// No description provided for @zelleFailLimitInvalid.
  ///
  /// In en, this message translates to:
  /// **'Pick a limit from 0 to 1000.'**
  String get zelleFailLimitInvalid;

  /// No description provided for @bankUsageTitle.
  ///
  /// In en, this message translates to:
  /// **'This month · {month}'**
  String bankUsageTitle(String month);

  /// No description provided for @bankUsageChecks.
  ///
  /// In en, this message translates to:
  /// **'Checks'**
  String get bankUsageChecks;

  /// No description provided for @bankUsageRefreshes.
  ///
  /// In en, this message translates to:
  /// **'Paid refreshes'**
  String get bankUsageRefreshes;

  /// No description provided for @bankUsageRefreshesOf.
  ///
  /// In en, this message translates to:
  /// **'{used} of {limit}'**
  String bankUsageRefreshesOf(int used, int limit);

  /// No description provided for @bankUsageCost.
  ///
  /// In en, this message translates to:
  /// **'Estimated cost'**
  String get bankUsageCost;

  /// No description provided for @bankUsageByStaff.
  ///
  /// In en, this message translates to:
  /// **'By team member'**
  String get bankUsageByStaff;

  /// No description provided for @bankUsageStaffLine.
  ///
  /// In en, this message translates to:
  /// **'Checks: {checks} · Refreshes: {refreshes}'**
  String bankUsageStaffLine(int checks, int refreshes);

  /// No description provided for @bankUsageNone.
  ///
  /// In en, this message translates to:
  /// **'No checks yet this month.'**
  String get bankUsageNone;

  /// No description provided for @bankUsageLimitReached.
  ///
  /// In en, this message translates to:
  /// **'Limit reached: checks still work, but new deposits can take longer to show.'**
  String get bankUsageLimitReached;

  /// No description provided for @bankLimitLabel.
  ///
  /// In en, this message translates to:
  /// **'Monthly limit of paid refreshes'**
  String get bankLimitLabel;

  /// No description provided for @bankLimitHint.
  ///
  /// In en, this message translates to:
  /// **'Each refresh asks the bank for new deposits and costs about {cost}. When the limit is reached, checks still work but stop asking the bank to refresh until next month.'**
  String bankLimitHint(String cost);

  /// No description provided for @bankLimitInvalid.
  ///
  /// In en, this message translates to:
  /// **'Type a whole number from 0 to 1000.'**
  String get bankLimitInvalid;

  /// No description provided for @bankLimitSaved.
  ///
  /// In en, this message translates to:
  /// **'Limit saved'**
  String get bankLimitSaved;

  /// No description provided for @phaErrInviteNotFound.
  ///
  /// In en, this message translates to:
  /// **'This invitation is no longer active. Ask the business for a new invitation.'**
  String get phaErrInviteNotFound;

  /// No description provided for @stiMethodLabel.
  ///
  /// In en, this message translates to:
  /// **'Invite by'**
  String get stiMethodLabel;

  /// No description provided for @stiMethodPhone.
  ///
  /// In en, this message translates to:
  /// **'Phone (WhatsApp)'**
  String get stiMethodPhone;

  /// No description provided for @stiMethodEmail.
  ///
  /// In en, this message translates to:
  /// **'Email'**
  String get stiMethodEmail;

  /// No description provided for @stiPhoneLabel.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp number'**
  String get stiPhoneLabel;

  /// No description provided for @stiPhoneHelp.
  ///
  /// In en, this message translates to:
  /// **'They get a WhatsApp message with a link to join. They sign in with a code, no password.'**
  String get stiPhoneHelp;

  /// No description provided for @stiNameRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter the person’s name.'**
  String get stiNameRequired;

  /// No description provided for @stiPhoneRequired.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid number with the country code.'**
  String get stiPhoneRequired;

  /// No description provided for @stiStoreLabel.
  ///
  /// In en, this message translates to:
  /// **'Which store?'**
  String get stiStoreLabel;

  /// No description provided for @stiStoreHelp.
  ///
  /// In en, this message translates to:
  /// **'Where this person works in Inventory.'**
  String get stiStoreHelp;

  /// No description provided for @stiStoreAll.
  ///
  /// In en, this message translates to:
  /// **'All stores'**
  String get stiStoreAll;

  /// No description provided for @stiStoreRequired.
  ///
  /// In en, this message translates to:
  /// **'Choose a store, or All stores.'**
  String get stiStoreRequired;

  /// No description provided for @stiSentOnWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'Invitation sent on WhatsApp'**
  String get stiSentOnWhatsApp;

  /// No description provided for @stiNotSentTitle.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp message not sent yet - share this link'**
  String get stiNotSentTitle;

  /// No description provided for @stiNotSentHelp.
  ///
  /// In en, this message translates to:
  /// **'The invitation is ready. Send this link to the person yourself. It works for 7 days.'**
  String get stiNotSentHelp;

  /// No description provided for @stiCopyLink.
  ///
  /// In en, this message translates to:
  /// **'Copy link'**
  String get stiCopyLink;

  /// No description provided for @stiLinkCopied.
  ///
  /// In en, this message translates to:
  /// **'Link copied'**
  String get stiLinkCopied;

  /// No description provided for @stiStatusPending.
  ///
  /// In en, this message translates to:
  /// **'Pending'**
  String get stiStatusPending;

  /// No description provided for @stiStatusExpired.
  ///
  /// In en, this message translates to:
  /// **'Expired'**
  String get stiStatusExpired;

  /// No description provided for @stiStatusCancelled.
  ///
  /// In en, this message translates to:
  /// **'Cancelled'**
  String get stiStatusCancelled;

  /// No description provided for @stiStatusAccepted.
  ///
  /// In en, this message translates to:
  /// **'Accepted'**
  String get stiStatusAccepted;

  /// No description provided for @stiExpiresOn.
  ///
  /// In en, this message translates to:
  /// **'Expires {date}'**
  String stiExpiresOn(Object date);

  /// No description provided for @stiInvitationsEmpty.
  ///
  /// In en, this message translates to:
  /// **'No pending invitations.'**
  String get stiInvitationsEmpty;

  /// No description provided for @stiInvitationsFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t load the invitations.'**
  String get stiInvitationsFailed;

  /// No description provided for @stiScreenTitle.
  ///
  /// In en, this message translates to:
  /// **'Staff invitation'**
  String get stiScreenTitle;

  /// No description provided for @stiInvitedYou.
  ///
  /// In en, this message translates to:
  /// **'{inviter} invited you to join {business} on Laawol as staff.'**
  String stiInvitedYou(String inviter, String business);

  /// No description provided for @stiInvitedYouNoInviter.
  ///
  /// In en, this message translates to:
  /// **'You are invited to join {business} on Laawol as staff.'**
  String stiInvitedYouNoInviter(Object business);

  /// No description provided for @stiAcceptWithNumber.
  ///
  /// In en, this message translates to:
  /// **'Accept with the number ending in ••{lastTwo}'**
  String stiAcceptWithNumber(Object lastTwo);

  /// No description provided for @stiAcceptWithNumberHelp.
  ///
  /// In en, this message translates to:
  /// **'We send a code to that number on WhatsApp.'**
  String get stiAcceptWithNumberHelp;

  /// No description provided for @stiAccept.
  ///
  /// In en, this message translates to:
  /// **'Accept invitation'**
  String get stiAccept;

  /// No description provided for @stiAccepting.
  ///
  /// In en, this message translates to:
  /// **'Accepting…'**
  String get stiAccepting;

  /// No description provided for @stiOtherAccount.
  ///
  /// In en, this message translates to:
  /// **'You’re signed in with another account. This invitation is for the number ending in ••{lastTwo}: sign out, then accept with that number.'**
  String stiOtherAccount(Object lastTwo);

  /// No description provided for @stiSignOutToContinue.
  ///
  /// In en, this message translates to:
  /// **'Sign out to continue'**
  String get stiSignOutToContinue;

  /// No description provided for @stiSigningOut.
  ///
  /// In en, this message translates to:
  /// **'Signing out…'**
  String get stiSigningOut;

  /// No description provided for @stiClosedExpired.
  ///
  /// In en, this message translates to:
  /// **'This invitation has expired. Ask the business for a new invitation.'**
  String get stiClosedExpired;

  /// No description provided for @stiClosedCancelled.
  ///
  /// In en, this message translates to:
  /// **'This invitation was cancelled. Ask the business for a new invitation.'**
  String get stiClosedCancelled;

  /// No description provided for @stiClosedAccepted.
  ///
  /// In en, this message translates to:
  /// **'This invitation was already accepted. If you need access, ask the business for a new invitation.'**
  String get stiClosedAccepted;

  /// No description provided for @stiLoadFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t open this invitation.'**
  String get stiLoadFailed;

  /// No description provided for @stiWelcome.
  ///
  /// In en, this message translates to:
  /// **'Welcome to {business}'**
  String stiWelcome(Object business);

  /// No description provided for @stiErrFullName.
  ///
  /// In en, this message translates to:
  /// **'Enter the person’s full name.'**
  String get stiErrFullName;

  /// No description provided for @stiErrPhone.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid phone number.'**
  String get stiErrPhone;

  /// No description provided for @stiErrCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Add the country code to the number.'**
  String get stiErrCountryCode;

  /// No description provided for @stiErrEmail.
  ///
  /// In en, this message translates to:
  /// **'Enter a valid email address.'**
  String get stiErrEmail;

  /// No description provided for @stiErrStoreAccess.
  ///
  /// In en, this message translates to:
  /// **'Choose a store, or All stores.'**
  String get stiErrStoreAccess;

  /// No description provided for @stiErrStoreNotFound.
  ///
  /// In en, this message translates to:
  /// **'That store no longer exists. Choose another one.'**
  String get stiErrStoreNotFound;

  /// No description provided for @stiErrExistingAuthority.
  ///
  /// In en, this message translates to:
  /// **'That account already has business or admin access, so it can’t join as staff.'**
  String get stiErrExistingAuthority;

  /// No description provided for @stiErrAlreadyPending.
  ///
  /// In en, this message translates to:
  /// **'An invitation to this person is already pending. Resend it from the list.'**
  String get stiErrAlreadyPending;

  /// No description provided for @stiErrOwnerRequired.
  ///
  /// In en, this message translates to:
  /// **'Only the business owner can invite staff.'**
  String get stiErrOwnerRequired;

  /// No description provided for @stiErrBusiness.
  ///
  /// In en, this message translates to:
  /// **'Choose the business first.'**
  String get stiErrBusiness;

  /// No description provided for @stiErrNotActive.
  ///
  /// In en, this message translates to:
  /// **'This invitation is no longer active. Ask the business for a new invitation.'**
  String get stiErrNotActive;

  /// No description provided for @stiErrSelection.
  ///
  /// In en, this message translates to:
  /// **'More than one invitation is waiting. Open the link from the message you received.'**
  String get stiErrSelection;

  /// No description provided for @stiErrExpired.
  ///
  /// In en, this message translates to:
  /// **'This invitation has expired. Ask the business for a new invitation.'**
  String get stiErrExpired;

  /// No description provided for @stiErrNotPending.
  ///
  /// In en, this message translates to:
  /// **'This invitation was already used or cancelled.'**
  String get stiErrNotPending;

  /// No description provided for @stiErrIdentity.
  ///
  /// In en, this message translates to:
  /// **'This invitation is for another number. Sign in with the number it was sent to.'**
  String get stiErrIdentity;

  /// No description provided for @stiErrVerifiedContact.
  ///
  /// In en, this message translates to:
  /// **'Sign in with the number the invitation was sent to.'**
  String get stiErrVerifiedContact;

  /// No description provided for @stiErrNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You don’t have access to do that.'**
  String get stiErrNotAllowed;

  /// No description provided for @stiPendingTitle.
  ///
  /// In en, this message translates to:
  /// **'You have an invitation'**
  String get stiPendingTitle;

  /// No description provided for @stiPendingInvited.
  ///
  /// In en, this message translates to:
  /// **'{inviter} invited you to join {business} as staff.'**
  String stiPendingInvited(String inviter, String business);

  /// No description provided for @stiPendingInvitedNoInviter.
  ///
  /// In en, this message translates to:
  /// **'You are invited to join {business} as staff.'**
  String stiPendingInvitedNoInviter(Object business);

  /// No description provided for @stiPlatformName.
  ///
  /// In en, this message translates to:
  /// **'Laawol Digital administration'**
  String get stiPlatformName;

  /// No description provided for @stiJoin.
  ///
  /// In en, this message translates to:
  /// **'Join {business}'**
  String stiJoin(Object business);

  /// No description provided for @stiNotNow.
  ///
  /// In en, this message translates to:
  /// **'Not now'**
  String get stiNotNow;

  /// No description provided for @continueWithGoogle.
  ///
  /// In en, this message translates to:
  /// **'Continue with Google'**
  String get continueWithGoogle;

  /// No description provided for @continueWithApple.
  ///
  /// In en, this message translates to:
  /// **'Continue with Apple'**
  String get continueWithApple;

  /// No description provided for @socialSignInDivider.
  ///
  /// In en, this message translates to:
  /// **'or'**
  String get socialSignInDivider;

  /// No description provided for @authErrorAccountExistsOtherSignIn.
  ///
  /// In en, this message translates to:
  /// **'This email already has a Laawol account. Sign in with your email and password once, and Google will be linked to it.'**
  String get authErrorAccountExistsOtherSignIn;

  /// No description provided for @authErrorSocialSignInFailed.
  ///
  /// In en, this message translates to:
  /// **'We couldn’t sign you in with that account. Try again, or sign in another way.'**
  String get authErrorSocialSignInFailed;

  /// No description provided for @authErrorInvitationWaiting.
  ///
  /// In en, this message translates to:
  /// **'An invitation is waiting for this account. Open the invitation link you received to join.'**
  String get authErrorInvitationWaiting;

  /// No description provided for @dlvTitle.
  ///
  /// In en, this message translates to:
  /// **'Deliveries'**
  String get dlvTitle;

  /// No description provided for @dlvSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Scan a package label and hand it over.'**
  String get dlvSubtitle;

  /// No description provided for @dlvSection.
  ///
  /// In en, this message translates to:
  /// **'Delivery'**
  String get dlvSection;

  /// No description provided for @dlvReadyNote.
  ///
  /// In en, this message translates to:
  /// **'Its container is ready for pickup. Hand it over and mark it delivered.'**
  String get dlvReadyNote;

  /// No description provided for @dlvMarkDelivered.
  ///
  /// In en, this message translates to:
  /// **'Mark delivered'**
  String get dlvMarkDelivered;

  /// No description provided for @dlvMarking.
  ///
  /// In en, this message translates to:
  /// **'Marking delivered…'**
  String get dlvMarking;

  /// No description provided for @dlvSheetSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{what} for {receiver}'**
  String dlvSheetSubtitle(String what, String receiver);

  /// No description provided for @dlvCollectedByLabel.
  ///
  /// In en, this message translates to:
  /// **'Collected by'**
  String get dlvCollectedByLabel;

  /// No description provided for @dlvCollectedByHelper.
  ///
  /// In en, this message translates to:
  /// **'The receiver, or whoever collects it for them.'**
  String get dlvCollectedByHelper;

  /// No description provided for @dlvCollectedByTooLong.
  ///
  /// In en, this message translates to:
  /// **'Keep the name of who collected it to 120 characters.'**
  String get dlvCollectedByTooLong;

  /// No description provided for @dlvBalanceOwed.
  ///
  /// In en, this message translates to:
  /// **'This package still owes {amount}.'**
  String dlvBalanceOwed(Object amount);

  /// No description provided for @dlvBalanceUnpaid.
  ///
  /// In en, this message translates to:
  /// **'This package still has an unpaid balance — check with the office.'**
  String get dlvBalanceUnpaid;

  /// No description provided for @dlvBalanceConfirm.
  ///
  /// In en, this message translates to:
  /// **'You can still hand it over: confirm below.'**
  String get dlvBalanceConfirm;

  /// No description provided for @dlvDeliverAnyway.
  ///
  /// In en, this message translates to:
  /// **'Deliver anyway'**
  String get dlvDeliverAnyway;

  /// No description provided for @dlvDone.
  ///
  /// In en, this message translates to:
  /// **'Marked delivered.'**
  String get dlvDone;

  /// No description provided for @dlvAlreadyDelivered.
  ///
  /// In en, this message translates to:
  /// **'This package was already marked delivered.'**
  String get dlvAlreadyDelivered;

  /// No description provided for @dlvDeliveredPill.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get dlvDeliveredPill;

  /// No description provided for @dlvDeliveredOn.
  ///
  /// In en, this message translates to:
  /// **'Delivered {when}'**
  String dlvDeliveredOn(Object when);

  /// No description provided for @dlvHandedOverBy.
  ///
  /// In en, this message translates to:
  /// **'Handed over by {name}'**
  String dlvHandedOverBy(Object name);

  /// No description provided for @dlvCollectedBy.
  ///
  /// In en, this message translates to:
  /// **'Collected by {name}'**
  String dlvCollectedBy(Object name);

  /// No description provided for @dlvOwedAtDelivery.
  ///
  /// In en, this message translates to:
  /// **'{amount} was still owed when it was handed over'**
  String dlvOwedAtDelivery(Object amount);

  /// No description provided for @dlvUndo.
  ///
  /// In en, this message translates to:
  /// **'Undo delivery'**
  String get dlvUndo;

  /// No description provided for @dlvUndoTitle.
  ///
  /// In en, this message translates to:
  /// **'Undo this delivery?'**
  String get dlvUndoTitle;

  /// No description provided for @dlvUndoMessage.
  ///
  /// In en, this message translates to:
  /// **'The package goes back to ready for pickup. Nobody is messaged.'**
  String get dlvUndoMessage;

  /// No description provided for @dlvUndone.
  ///
  /// In en, this message translates to:
  /// **'Delivery undone.'**
  String get dlvUndone;

  /// No description provided for @dlvNotUndone.
  ///
  /// In en, this message translates to:
  /// **'This package was not marked delivered.'**
  String get dlvNotUndone;

  /// No description provided for @dlvProgress.
  ///
  /// In en, this message translates to:
  /// **'{delivered} of {total} delivered'**
  String dlvProgress(int delivered, int total);

  /// No description provided for @dlvErrAction.
  ///
  /// In en, this message translates to:
  /// **'That is not something a package delivery can do.'**
  String get dlvErrAction;

  /// No description provided for @dlvErrNotArrived.
  ///
  /// In en, this message translates to:
  /// **'A package can be marked delivered once its container is ready for pickup.'**
  String get dlvErrNotArrived;

  /// No description provided for @dlvErrBalanceDue.
  ///
  /// In en, this message translates to:
  /// **'This package still has an unpaid balance. Confirm to mark it delivered anyway.'**
  String get dlvErrBalanceDue;

  /// No description provided for @dlvErrLineNotFound.
  ///
  /// In en, this message translates to:
  /// **'That package no longer exists.'**
  String get dlvErrLineNotFound;

  /// No description provided for @dlvErrNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You don’t have access to do that.'**
  String get dlvErrNotAllowed;

  /// No description provided for @dlvErrOffline.
  ///
  /// In en, this message translates to:
  /// **'No connection. Check your internet and try again.'**
  String get dlvErrOffline;

  /// No description provided for @dlvErrGeneric.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t save the delivery. Try again.'**
  String get dlvErrGeneric;

  /// No description provided for @pkgMomentDelivered.
  ///
  /// In en, this message translates to:
  /// **'delivered'**
  String get pkgMomentDelivered;

  /// No description provided for @ldgStart.
  ///
  /// In en, this message translates to:
  /// **'Start loading'**
  String get ldgStart;

  /// No description provided for @ldgHeaderTo.
  ///
  /// In en, this message translates to:
  /// **'To {destination}'**
  String ldgHeaderTo(String destination);

  /// No description provided for @ldgTotalPackages.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 package} other{{count} packages}}'**
  String ldgTotalPackages(int count);

  /// No description provided for @ldgTotalPieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece scanned} other{{count} pieces scanned}}'**
  String ldgTotalPieces(int count);

  /// No description provided for @ldgCameraUnavailable.
  ///
  /// In en, this message translates to:
  /// **'The camera is unavailable. Type the code printed on each label below.'**
  String get ldgCameraUnavailable;

  /// No description provided for @ldgTypeCode.
  ///
  /// In en, this message translates to:
  /// **'Type a code'**
  String get ldgTypeCode;

  /// No description provided for @ldgTypeHint.
  ///
  /// In en, this message translates to:
  /// **'CL-K7M4P2'**
  String get ldgTypeHint;

  /// No description provided for @ldgTypeSend.
  ///
  /// In en, this message translates to:
  /// **'Load'**
  String get ldgTypeSend;

  /// No description provided for @ldgRecent.
  ///
  /// In en, this message translates to:
  /// **'Recent scans'**
  String get ldgRecent;

  /// No description provided for @ldgNoScans.
  ///
  /// In en, this message translates to:
  /// **'Each label you scan shows here.'**
  String get ldgNoScans;

  /// No description provided for @ldgSending.
  ///
  /// In en, this message translates to:
  /// **'Sending…'**
  String get ldgSending;

  /// No description provided for @ldgLoaded.
  ///
  /// In en, this message translates to:
  /// **'Loaded'**
  String get ldgLoaded;

  /// No description provided for @ldgLoadedOf.
  ///
  /// In en, this message translates to:
  /// **'Loaded · {scanned} of {total}'**
  String ldgLoadedOf(int scanned, int total);

  /// No description provided for @ldgMovedHere.
  ///
  /// In en, this message translates to:
  /// **'Moved here'**
  String get ldgMovedHere;

  /// No description provided for @ldgCountedOf.
  ///
  /// In en, this message translates to:
  /// **'{scanned} of {total}'**
  String ldgCountedOf(int scanned, int total);

  /// No description provided for @ldgAllIn.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Already in} other{All {count} already in}}'**
  String ldgAllIn(int count);

  /// No description provided for @ldgUndo.
  ///
  /// In en, this message translates to:
  /// **'Undo'**
  String get ldgUndo;

  /// No description provided for @ldgUndoneBack.
  ///
  /// In en, this message translates to:
  /// **'Undone · back to waiting'**
  String get ldgUndoneBack;

  /// No description provided for @ldgUndoneOf.
  ///
  /// In en, this message translates to:
  /// **'Undone · {scanned} of {total}'**
  String ldgUndoneOf(int scanned, int total);

  /// No description provided for @ldgUndoFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t undo. Try again.'**
  String get ldgUndoFailed;

  /// No description provided for @ldgErrOffline.
  ///
  /// In en, this message translates to:
  /// **'No connection - scan again'**
  String get ldgErrOffline;

  /// No description provided for @ldgErrNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You don’t have access to load containers.'**
  String get ldgErrNotAllowed;

  /// No description provided for @ldgErrNotFound.
  ///
  /// In en, this message translates to:
  /// **'No package has this code.'**
  String get ldgErrNotFound;

  /// No description provided for @ldgErrLocked.
  ///
  /// In en, this message translates to:
  /// **'This container is no longer loading.'**
  String get ldgErrLocked;

  /// No description provided for @ldgErrDestinationRequired.
  ///
  /// In en, this message translates to:
  /// **'Give this container a destination first.'**
  String get ldgErrDestinationRequired;

  /// No description provided for @ldgErrDestinationMismatch.
  ///
  /// In en, this message translates to:
  /// **'This package goes to another country.'**
  String get ldgErrDestinationMismatch;

  /// No description provided for @ldgErrDelivered.
  ///
  /// In en, this message translates to:
  /// **'This package was already delivered.'**
  String get ldgErrDelivered;

  /// No description provided for @ldgErrOtherContainer.
  ///
  /// In en, this message translates to:
  /// **'This package is on {container}.'**
  String ldgErrOtherContainer(String container);

  /// No description provided for @ldgErrShippedContainer.
  ///
  /// In en, this message translates to:
  /// **'This package already left on {container}.'**
  String ldgErrShippedContainer(String container);

  /// No description provided for @ldgErrCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'That is not a package code.'**
  String get ldgErrCodeInvalid;

  /// No description provided for @ldgErrScanId.
  ///
  /// In en, this message translates to:
  /// **'The scan didn’t go through. Scan again.'**
  String get ldgErrScanId;

  /// No description provided for @ldgErrPieceCount.
  ///
  /// In en, this message translates to:
  /// **'Only a package with some of its pieces scanned can be left waiting.'**
  String get ldgErrPieceCount;

  /// No description provided for @ldgErrGeneric.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t scan this label. Scan again.'**
  String get ldgErrGeneric;

  /// No description provided for @ldgMoveTitle.
  ///
  /// In en, this message translates to:
  /// **'Move it here?'**
  String get ldgMoveTitle;

  /// No description provided for @ldgMoveMessage.
  ///
  /// In en, this message translates to:
  /// **'This package is on {container}. Move it here?'**
  String ldgMoveMessage(String container);

  /// No description provided for @ldgMoveConfirm.
  ///
  /// In en, this message translates to:
  /// **'Move here'**
  String get ldgMoveConfirm;

  /// No description provided for @ldgDone.
  ///
  /// In en, this message translates to:
  /// **'Done loading'**
  String get ldgDone;

  /// No description provided for @ldgSummaryTitle.
  ///
  /// In en, this message translates to:
  /// **'Before you finish'**
  String get ldgSummaryTitle;

  /// No description provided for @ldgSummaryFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t get the summary.'**
  String get ldgSummaryFailed;

  /// No description provided for @ldgIncompleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Not every piece was scanned'**
  String get ldgIncompleteTitle;

  /// No description provided for @ldgIncompleteOf.
  ///
  /// In en, this message translates to:
  /// **'{scanned} of {total} pieces scanned'**
  String ldgIncompleteOf(int scanned, int total);

  /// No description provided for @ldgLoadAll.
  ///
  /// In en, this message translates to:
  /// **'Load all'**
  String get ldgLoadAll;

  /// No description provided for @ldgLeaveWaiting.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{Leave 1 waiting} other{Leave {count} waiting}}'**
  String ldgLeaveWaiting(int count);

  /// No description provided for @ldgGoesWhole.
  ///
  /// In en, this message translates to:
  /// **'All of it goes'**
  String get ldgGoesWhole;

  /// No description provided for @ldgLeftWaiting.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 left waiting as {code}} other{{count} left waiting as {code}}}'**
  String ldgLeftWaiting(int count, String code);

  /// No description provided for @ldgUnscanned.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 package on the container was never scanned} other{{count} packages on the container were never scanned}}'**
  String ldgUnscanned(int count);

  /// No description provided for @ldgUnscannedNote.
  ///
  /// In en, this message translates to:
  /// **'Put on by hand, or before scanning started.'**
  String get ldgUnscannedNote;

  /// No description provided for @ldgWaitingNotScanned.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 waiting package for {destination} was not scanned} other{{count} waiting packages for {destination} were not scanned}}'**
  String ldgWaitingNotScanned(int count, String destination);

  /// No description provided for @ldgThisDestination.
  ///
  /// In en, this message translates to:
  /// **'this destination'**
  String get ldgThisDestination;

  /// No description provided for @ldgWaitingMore.
  ///
  /// In en, this message translates to:
  /// **'and {count} more'**
  String ldgWaitingMore(int count);

  /// No description provided for @ldgAllClear.
  ///
  /// In en, this message translates to:
  /// **'Every package on the container was scanned in full.'**
  String get ldgAllClear;

  /// No description provided for @ldgKeepScanning.
  ///
  /// In en, this message translates to:
  /// **'Keep scanning'**
  String get ldgKeepScanning;

  /// No description provided for @ldgErrAction.
  ///
  /// In en, this message translates to:
  /// **'That is not something loading can do.'**
  String get ldgErrAction;

  /// No description provided for @ldgErrInAnotherContainer.
  ///
  /// In en, this message translates to:
  /// **'This package is on another container.'**
  String get ldgErrInAnotherContainer;

  /// No description provided for @ldgOnContainer.
  ///
  /// In en, this message translates to:
  /// **'On the container: {packages} · {pieces}'**
  String ldgOnContainer(String packages, String pieces);

  /// No description provided for @ldgPieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece} other{{count} pieces}}'**
  String ldgPieces(int count);

  /// No description provided for @ldgErrNotOnContainer.
  ///
  /// In en, this message translates to:
  /// **'This package is no longer on this container.'**
  String get ldgErrNotOnContainer;

  /// No description provided for @ldgUndoneMovedBack.
  ///
  /// In en, this message translates to:
  /// **'Moved back to {container}'**
  String ldgUndoneMovedBack(String container);

  /// No description provided for @ldgAlreadyUndone.
  ///
  /// In en, this message translates to:
  /// **'Already undone'**
  String get ldgAlreadyUndone;

  /// No description provided for @ldgMoveScannedWarning.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 of its pieces was already scanned into {container}.} other{{count} of its pieces were already scanned into {container}.}}'**
  String ldgMoveScannedWarning(int count, String container);

  /// No description provided for @ldgRestWaiting.
  ///
  /// In en, this message translates to:
  /// **'The rest stays waiting.'**
  String get ldgRestWaiting;

  /// No description provided for @lotDuplicatesTitle.
  ///
  /// In en, this message translates to:
  /// **'Possible duplicates'**
  String get lotDuplicatesTitle;

  /// No description provided for @lotDuplicatesBanner.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 car has the same job twice} other{{count} cars have the same job twice}}'**
  String lotDuplicatesBanner(int count);

  /// No description provided for @lotDuplicatesBannerNote.
  ///
  /// In en, this message translates to:
  /// **'Tap to review and void the one entered by mistake.'**
  String get lotDuplicatesBannerNote;

  /// No description provided for @lotDuplicatesExplain.
  ///
  /// In en, this message translates to:
  /// **'The same car with the same job more than once. Void the one entered by mistake — it stays on the record, struck through.'**
  String get lotDuplicatesExplain;

  /// No description provided for @lotDuplicateSameCustomer.
  ///
  /// In en, this message translates to:
  /// **'Same customer — likely entered twice'**
  String get lotDuplicateSameCustomer;

  /// No description provided for @lotDuplicateDifferentCustomers.
  ///
  /// In en, this message translates to:
  /// **'Different customers — may be a resale; void only if entered by mistake'**
  String get lotDuplicateDifferentCustomers;

  /// No description provided for @lotDuplicatesNone.
  ///
  /// In en, this message translates to:
  /// **'No possible duplicates.'**
  String get lotDuplicatesNone;

  /// No description provided for @lotVinTail.
  ///
  /// In en, this message translates to:
  /// **'VIN {tail}'**
  String lotVinTail(String tail);

  /// No description provided for @lotVinDuplicateNotice.
  ///
  /// In en, this message translates to:
  /// **'This car already has {article, select, an{an} other{a}} {job} for this customer: {code} ({date})'**
  String lotVinDuplicateNotice(
    String article,
    String job,
    String code,
    String date,
  );

  /// No description provided for @lotOpenIt.
  ///
  /// In en, this message translates to:
  /// **'Open it'**
  String get lotOpenIt;

  /// No description provided for @lotRepeatConfirmTitle.
  ///
  /// In en, this message translates to:
  /// **'Record it again?'**
  String get lotRepeatConfirmTitle;

  /// No description provided for @lotRepeatConfirmItem.
  ///
  /// In en, this message translates to:
  /// **'on {date} for {customer} ({code})'**
  String lotRepeatConfirmItem(String date, String customer, String code);

  /// No description provided for @lotRepeatConfirmBody.
  ///
  /// In en, this message translates to:
  /// **'This car already had {article, select, an{an} other{a}} {job} {items}. Record another for this customer?'**
  String lotRepeatConfirmBody(String article, String job, String items);

  /// No description provided for @lotRecordAnother.
  ///
  /// In en, this message translates to:
  /// **'Record another'**
  String get lotRecordAnother;

  /// No description provided for @lotEntryNotFound.
  ///
  /// In en, this message translates to:
  /// **'That entry could not be opened.'**
  String get lotEntryNotFound;

  /// No description provided for @ldgAlreadyOnContainer.
  ///
  /// In en, this message translates to:
  /// **'{scanned, plural, one{Already on this container · {scanned} of {total} scanned} other{Already on this container · {scanned} of {total} scanned}}'**
  String ldgAlreadyOnContainer(int scanned, int total);

  /// No description provided for @ldgTabOnContainer.
  ///
  /// In en, this message translates to:
  /// **'On this container'**
  String get ldgTabOnContainer;

  /// No description provided for @ldgTabStillToLoad.
  ///
  /// In en, this message translates to:
  /// **'Still to load'**
  String get ldgTabStillToLoad;

  /// No description provided for @ldgFilterRecent.
  ///
  /// In en, this message translates to:
  /// **'Recently added'**
  String get ldgFilterRecent;

  /// No description provided for @ldgFilterByCustomer.
  ///
  /// In en, this message translates to:
  /// **'By customer'**
  String get ldgFilterByCustomer;

  /// No description provided for @ldgFilterNotScanned.
  ///
  /// In en, this message translates to:
  /// **'Not scanned yet'**
  String get ldgFilterNotScanned;

  /// No description provided for @ldgSearchHint.
  ///
  /// In en, this message translates to:
  /// **'Search code, name or phone'**
  String get ldgSearchHint;

  /// No description provided for @ldgScannedOfPieces.
  ///
  /// In en, this message translates to:
  /// **'{scanned} of {total} {total, plural, one{piece} other{pieces}} scanned'**
  String ldgScannedOfPieces(int scanned, int total);

  /// No description provided for @ldgNoCustomerName.
  ///
  /// In en, this message translates to:
  /// **'No name'**
  String get ldgNoCustomerName;

  /// No description provided for @ldgPackagesWaiting.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, one{{count} package waiting} other{{count} packages waiting}}'**
  String ldgPackagesWaiting(int count);

  /// No description provided for @ldgAddedBy.
  ///
  /// In en, this message translates to:
  /// **'Added by {name}'**
  String ldgAddedBy(String name);

  /// No description provided for @ldgViaScan.
  ///
  /// In en, this message translates to:
  /// **'By scan'**
  String get ldgViaScan;

  /// No description provided for @ldgViaHand.
  ///
  /// In en, this message translates to:
  /// **'By hand'**
  String get ldgViaHand;

  /// No description provided for @ldgViaMove.
  ///
  /// In en, this message translates to:
  /// **'Moved'**
  String get ldgViaMove;

  /// No description provided for @ldgAddedEarlier.
  ///
  /// In en, this message translates to:
  /// **'Added earlier'**
  String get ldgAddedEarlier;

  /// No description provided for @ldgTakeOff.
  ///
  /// In en, this message translates to:
  /// **'Take off'**
  String get ldgTakeOff;

  /// No description provided for @ldgTakeOffTitle.
  ///
  /// In en, this message translates to:
  /// **'Take it off?'**
  String get ldgTakeOffTitle;

  /// No description provided for @ldgTakeOffMessage.
  ///
  /// In en, this message translates to:
  /// **'Take {code} off {container}? It goes back to waiting.'**
  String ldgTakeOffMessage(String code, String container);

  /// No description provided for @ldgLoadIt.
  ///
  /// In en, this message translates to:
  /// **'Load'**
  String get ldgLoadIt;

  /// No description provided for @ldgStillWaitingFor.
  ///
  /// In en, this message translates to:
  /// **'{count} still waiting for {destination}'**
  String ldgStillWaitingFor(int count, String destination);

  /// No description provided for @ldgNothingOnContainer.
  ///
  /// In en, this message translates to:
  /// **'Nothing on this container yet.'**
  String get ldgNothingOnContainer;

  /// No description provided for @ldgNoMatches.
  ///
  /// In en, this message translates to:
  /// **'No package matches.'**
  String get ldgNoMatches;

  /// No description provided for @ldgAllScannedHere.
  ///
  /// In en, this message translates to:
  /// **'Every package here has been scanned.'**
  String get ldgAllScannedHere;

  /// No description provided for @ldgNothingToLoad.
  ///
  /// In en, this message translates to:
  /// **'No package is waiting for {destination}.'**
  String ldgNothingToLoad(String destination);

  /// No description provided for @waWhatsApp.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp'**
  String get waWhatsApp;

  /// No description provided for @waListSupport.
  ///
  /// In en, this message translates to:
  /// **'Support cases'**
  String get waListSupport;

  /// No description provided for @waFilterAll.
  ///
  /// In en, this message translates to:
  /// **'All'**
  String get waFilterAll;

  /// No description provided for @waFilterNeedsReply.
  ///
  /// In en, this message translates to:
  /// **'Needs reply'**
  String get waFilterNeedsReply;

  /// No description provided for @waFilterWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for customer'**
  String get waFilterWaiting;

  /// No description provided for @waFilterDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get waFilterDone;

  /// No description provided for @waStateNeedsReply.
  ///
  /// In en, this message translates to:
  /// **'Needs reply'**
  String get waStateNeedsReply;

  /// No description provided for @waStateWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting for customer'**
  String get waStateWaiting;

  /// No description provided for @waStateChoosing.
  ///
  /// In en, this message translates to:
  /// **'Asked which business'**
  String get waStateChoosing;

  /// No description provided for @waStateDone.
  ///
  /// In en, this message translates to:
  /// **'Done'**
  String get waStateDone;

  /// No description provided for @waStoppedUpdates.
  ///
  /// In en, this message translates to:
  /// **'Stopped updates'**
  String get waStoppedUpdates;

  /// No description provided for @waSuggestedFor.
  ///
  /// In en, this message translates to:
  /// **'For {business}'**
  String waSuggestedFor(String business);

  /// No description provided for @waHandedOverPill.
  ///
  /// In en, this message translates to:
  /// **'Handed over'**
  String get waHandedOverPill;

  /// No description provided for @waEmptyTitle.
  ///
  /// In en, this message translates to:
  /// **'No WhatsApp conversations'**
  String get waEmptyTitle;

  /// No description provided for @waEmptySubtitle.
  ///
  /// In en, this message translates to:
  /// **'When a customer writes to Laawol’s WhatsApp number about a package, the conversation appears here.'**
  String get waEmptySubtitle;

  /// No description provided for @waSearch.
  ///
  /// In en, this message translates to:
  /// **'Search name, number or message'**
  String get waSearch;

  /// No description provided for @waLaawol.
  ///
  /// In en, this message translates to:
  /// **'Laawol'**
  String get waLaawol;

  /// No description provided for @waCustomerPackages.
  ///
  /// In en, this message translates to:
  /// **'Packages'**
  String get waCustomerPackages;

  /// No description provided for @waPackagesLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading packages…'**
  String get waPackagesLoading;

  /// No description provided for @waPackagesFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t load the packages.'**
  String get waPackagesFailed;

  /// No description provided for @waNoPackages.
  ///
  /// In en, this message translates to:
  /// **'No package with your business for this number.'**
  String get waNoPackages;

  /// No description provided for @waPackageSender.
  ///
  /// In en, this message translates to:
  /// **'Sender'**
  String get waPackageSender;

  /// No description provided for @waPackageReceiver.
  ///
  /// In en, this message translates to:
  /// **'Receiver'**
  String get waPackageReceiver;

  /// No description provided for @waMarkDone.
  ///
  /// In en, this message translates to:
  /// **'Mark done'**
  String get waMarkDone;

  /// No description provided for @waMarkingDone.
  ///
  /// In en, this message translates to:
  /// **'Marking done…'**
  String get waMarkingDone;

  /// No description provided for @waReopen.
  ///
  /// In en, this message translates to:
  /// **'Reopen'**
  String get waReopen;

  /// No description provided for @waReopening.
  ///
  /// In en, this message translates to:
  /// **'Reopening…'**
  String get waReopening;

  /// No description provided for @waPrivateNote.
  ///
  /// In en, this message translates to:
  /// **'Private note'**
  String get waPrivateNote;

  /// No description provided for @waOnlyYourTeam.
  ///
  /// In en, this message translates to:
  /// **'Only your team sees this'**
  String get waOnlyYourTeam;

  /// No description provided for @waNoteSaving.
  ///
  /// In en, this message translates to:
  /// **'Saving note…'**
  String get waNoteSaving;

  /// No description provided for @waNoteSaved.
  ///
  /// In en, this message translates to:
  /// **'Note saved.'**
  String get waNoteSaved;

  /// No description provided for @waHandOver.
  ///
  /// In en, this message translates to:
  /// **'Hand over'**
  String get waHandOver;

  /// No description provided for @waHandOverTitle.
  ///
  /// In en, this message translates to:
  /// **'Hand over this conversation'**
  String get waHandOverTitle;

  /// No description provided for @waHandOverSubtitle.
  ///
  /// In en, this message translates to:
  /// **'It moves to the other inbox with its messages. The customer isn’t told.'**
  String get waHandOverSubtitle;

  /// No description provided for @waHandOverToLaawol.
  ///
  /// In en, this message translates to:
  /// **'Laawol support'**
  String get waHandOverToLaawol;

  /// No description provided for @waHandOverToBusiness.
  ///
  /// In en, this message translates to:
  /// **'Another business'**
  String get waHandOverToBusiness;

  /// No description provided for @waHandOverStaffHint.
  ///
  /// In en, this message translates to:
  /// **'Laawol can pass it on to another business that ships for this customer.'**
  String get waHandOverStaffHint;

  /// No description provided for @waHandOverNote.
  ///
  /// In en, this message translates to:
  /// **'Note for them (optional)'**
  String get waHandOverNote;

  /// No description provided for @waHandingOver.
  ///
  /// In en, this message translates to:
  /// **'Handing over…'**
  String get waHandingOver;

  /// No description provided for @waHandedOverTo.
  ///
  /// In en, this message translates to:
  /// **'Handed over to {name}.'**
  String waHandedOverTo(String name);

  /// No description provided for @waPickBusiness.
  ///
  /// In en, this message translates to:
  /// **'Pick a business'**
  String get waPickBusiness;

  /// No description provided for @waRefusalNotThisCustomer.
  ///
  /// In en, this message translates to:
  /// **'That business has no shipment for this customer.'**
  String get waRefusalNotThisCustomer;

  /// No description provided for @waRefusalPickAnother.
  ///
  /// In en, this message translates to:
  /// **'It’s already in that inbox. Pick another one.'**
  String get waRefusalPickAnother;

  /// No description provided for @waRefusalBusinessNotFound.
  ///
  /// In en, this message translates to:
  /// **'That business no longer exists.'**
  String get waRefusalBusinessNotFound;

  /// No description provided for @waRefusalNotAllowed.
  ///
  /// In en, this message translates to:
  /// **'You can’t do this on this conversation.'**
  String get waRefusalNotAllowed;

  /// No description provided for @waRefusalPhone.
  ///
  /// In en, this message translates to:
  /// **'This number needs its country code first.'**
  String get waRefusalPhone;

  /// No description provided for @waRefusalOffline.
  ///
  /// In en, this message translates to:
  /// **'No connection. Try again.'**
  String get waRefusalOffline;

  /// No description provided for @waRefusalUnknown.
  ///
  /// In en, this message translates to:
  /// **'That didn’t work. Try again.'**
  String get waRefusalUnknown;

  /// No description provided for @waAutoReply.
  ///
  /// In en, this message translates to:
  /// **'Automatic reply'**
  String get waAutoReply;

  /// No description provided for @waNoteBadge.
  ///
  /// In en, this message translates to:
  /// **'Private note · Only your team sees this'**
  String get waNoteBadge;

  /// No description provided for @waMediaDeleted.
  ///
  /// In en, this message translates to:
  /// **'File deleted after 12 months'**
  String get waMediaDeleted;

  /// No description provided for @waTickSent.
  ///
  /// In en, this message translates to:
  /// **'Sent'**
  String get waTickSent;

  /// No description provided for @waTickDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get waTickDelivered;

  /// No description provided for @waTickRead.
  ///
  /// In en, this message translates to:
  /// **'Read'**
  String get waTickRead;

  /// No description provided for @waTickFailed.
  ///
  /// In en, this message translates to:
  /// **'Not delivered'**
  String get waTickFailed;

  /// No description provided for @waTickFailedReason.
  ///
  /// In en, this message translates to:
  /// **'Not delivered: {reason}'**
  String waTickFailedReason(String reason);

  /// No description provided for @waTickWaiting.
  ///
  /// In en, this message translates to:
  /// **'Waiting: goes out when the customer replies'**
  String get waTickWaiting;

  /// No description provided for @waTickStopped.
  ///
  /// In en, this message translates to:
  /// **'Waiting: the customer stopped updates'**
  String get waTickStopped;

  /// No description provided for @waPlay.
  ///
  /// In en, this message translates to:
  /// **'Play'**
  String get waPlay;

  /// No description provided for @waPause.
  ///
  /// In en, this message translates to:
  /// **'Pause'**
  String get waPause;

  /// No description provided for @waAudioFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t play this voice note.'**
  String get waAudioFailed;

  /// No description provided for @waDeliveryWaiting.
  ///
  /// In en, this message translates to:
  /// **'Outside WhatsApp’s 24-hour window: the customer was asked to reply, and your message goes out when they do.'**
  String get waDeliveryWaiting;

  /// No description provided for @waDeliveryStopped.
  ///
  /// In en, this message translates to:
  /// **'The customer stopped updates. Your message goes out if they write again.'**
  String get waDeliveryStopped;

  /// No description provided for @waDeliveryFailed.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp didn’t accept this message. The reason is under it.'**
  String get waDeliveryFailed;

  /// No description provided for @waWindowClosed.
  ///
  /// In en, this message translates to:
  /// **'The customer last wrote over 24 hours ago. What you send waits until they reply.'**
  String get waWindowClosed;

  /// No description provided for @waWriteMessage.
  ///
  /// In en, this message translates to:
  /// **'Message on WhatsApp'**
  String get waWriteMessage;

  /// No description provided for @waRecordVoice.
  ///
  /// In en, this message translates to:
  /// **'Record a voice note'**
  String get waRecordVoice;

  /// No description provided for @waRecording.
  ///
  /// In en, this message translates to:
  /// **'Recording {time}'**
  String waRecording(String time);

  /// No description provided for @waSendVoice.
  ///
  /// In en, this message translates to:
  /// **'Send voice note'**
  String get waSendVoice;

  /// No description provided for @waDiscardVoice.
  ///
  /// In en, this message translates to:
  /// **'Discard voice note'**
  String get waDiscardVoice;

  /// No description provided for @waMicDenied.
  ///
  /// In en, this message translates to:
  /// **'Allow the microphone in Settings to record voice notes.'**
  String get waMicDenied;

  /// No description provided for @waRecordFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t record. Try again.'**
  String get waRecordFailed;

  /// No description provided for @waVoiceTooShort.
  ///
  /// In en, this message translates to:
  /// **'That recording was too short.'**
  String get waVoiceTooShort;

  /// No description provided for @waMessageCustomer.
  ///
  /// In en, this message translates to:
  /// **'Message customer'**
  String get waMessageCustomer;

  /// No description provided for @waMessageWho.
  ///
  /// In en, this message translates to:
  /// **'Who do you want to message?'**
  String get waMessageWho;

  /// No description provided for @waOpening.
  ///
  /// In en, this message translates to:
  /// **'Opening the conversation…'**
  String get waOpening;

  /// No description provided for @waNeedsCountryCode.
  ///
  /// In en, this message translates to:
  /// **'Add the country code to message this number'**
  String get waNeedsCountryCode;

  /// No description provided for @waNoPhone.
  ///
  /// In en, this message translates to:
  /// **'No phone number on this package.'**
  String get waNoPhone;

  /// No description provided for @waNotifTitle.
  ///
  /// In en, this message translates to:
  /// **'WhatsApp messages'**
  String get waNotifTitle;

  /// No description provided for @waNotifOwner.
  ///
  /// In en, this message translates to:
  /// **'When a customer writes on WhatsApp. On for owners unless you switch it off.'**
  String get waNotifOwner;

  /// No description provided for @waNotifStaff.
  ///
  /// In en, this message translates to:
  /// **'When a customer writes on WhatsApp. Off for staff until you switch it on.'**
  String get waNotifStaff;

  /// No description provided for @waDisplayNameTitle.
  ///
  /// In en, this message translates to:
  /// **'Name customers see on WhatsApp'**
  String get waDisplayNameTitle;

  /// No description provided for @waDisplayNameHelp.
  ///
  /// In en, this message translates to:
  /// **'Your replies are signed {example}. Leave it empty to use your first name.'**
  String waDisplayNameHelp(String example);

  /// No description provided for @waDisplayNameSave.
  ///
  /// In en, this message translates to:
  /// **'Save name'**
  String get waDisplayNameSave;

  /// No description provided for @waDisplayNameSaved.
  ///
  /// In en, this message translates to:
  /// **'Name saved.'**
  String get waDisplayNameSaved;

  /// No description provided for @waNotifAdmin.
  ///
  /// In en, this message translates to:
  /// **'When a customer writes to Laawol on WhatsApp. On unless you switch it off.'**
  String get waNotifAdmin;

  /// No description provided for @waPackageTick.
  ///
  /// In en, this message translates to:
  /// **'{who} {mark} {status}'**
  String waPackageTick(String who, String mark, String status);

  /// No description provided for @waPackageTickFailed.
  ///
  /// In en, this message translates to:
  /// **'{who} {mark} Not delivered: {reason}'**
  String waPackageTickFailed(String who, String mark, String reason);

  /// No description provided for @waHandOverLoading.
  ///
  /// In en, this message translates to:
  /// **'Loading where it can go…'**
  String get waHandOverLoading;

  /// No description provided for @waHandOverNoOptions.
  ///
  /// In en, this message translates to:
  /// **'There is nowhere else to hand it.'**
  String get waHandOverNoOptions;

  /// No description provided for @proofSectionTitle.
  ///
  /// In en, this message translates to:
  /// **'Proof'**
  String get proofSectionTitle;

  /// No description provided for @proofPhotosOfMax.
  ///
  /// In en, this message translates to:
  /// **'Photos · {count} of {max}'**
  String proofPhotosOfMax(int count, int max);

  /// No description provided for @proofTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Camera'**
  String get proofTakePhoto;

  /// No description provided for @proofChoosePhoto.
  ///
  /// In en, this message translates to:
  /// **'Gallery'**
  String get proofChoosePhoto;

  /// No description provided for @proofRemovePhoto.
  ///
  /// In en, this message translates to:
  /// **'Remove photo'**
  String get proofRemovePhoto;

  /// No description provided for @proofPhotoUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading…'**
  String get proofPhotoUploading;

  /// No description provided for @proofPhotoRequiredNote.
  ///
  /// In en, this message translates to:
  /// **'A photo of the package is required at drop-off.'**
  String get proofPhotoRequiredNote;

  /// No description provided for @proofPhotoOptionalNote.
  ///
  /// In en, this message translates to:
  /// **'Up to {max} photos of the package.'**
  String proofPhotoOptionalNote(int max);

  /// No description provided for @proofPhotoFailed.
  ///
  /// In en, this message translates to:
  /// **'The photo could not be uploaded. Try again.'**
  String get proofPhotoFailed;

  /// No description provided for @proofPhotoTooLarge.
  ///
  /// In en, this message translates to:
  /// **'The photo is too large (2 MB at most).'**
  String get proofPhotoTooLarge;

  /// No description provided for @proofPhotoNotImage.
  ///
  /// In en, this message translates to:
  /// **'That file is not a photo (JPEG, PNG or WebP).'**
  String get proofPhotoNotImage;

  /// No description provided for @proofPhotoNoPermission.
  ///
  /// In en, this message translates to:
  /// **'You can’t add photos here.'**
  String get proofPhotoNoPermission;

  /// No description provided for @proofPhotoLimit.
  ///
  /// In en, this message translates to:
  /// **'At most {max} photos.'**
  String proofPhotoLimit(int max);

  /// No description provided for @proofPhotoOpenFailed.
  ///
  /// In en, this message translates to:
  /// **'The photo could not be opened.'**
  String get proofPhotoOpenFailed;

  /// No description provided for @proofContentsTitle.
  ///
  /// In en, this message translates to:
  /// **'What’s inside'**
  String get proofContentsTitle;

  /// No description provided for @proofContentsNote.
  ///
  /// In en, this message translates to:
  /// **'Optional. The sender confirms this list and customs reads it.'**
  String get proofContentsNote;

  /// No description provided for @proofItemLabel.
  ///
  /// In en, this message translates to:
  /// **'Item'**
  String get proofItemLabel;

  /// No description provided for @proofItemQuantity.
  ///
  /// In en, this message translates to:
  /// **'Qty'**
  String get proofItemQuantity;

  /// No description provided for @proofItemSerial.
  ///
  /// In en, this message translates to:
  /// **'Serial / IMEI (optional)'**
  String get proofItemSerial;

  /// No description provided for @proofAddItem.
  ///
  /// In en, this message translates to:
  /// **'Add an item'**
  String get proofAddItem;

  /// No description provided for @proofRemoveItem.
  ///
  /// In en, this message translates to:
  /// **'Remove item'**
  String get proofRemoveItem;

  /// No description provided for @proofWeight.
  ///
  /// In en, this message translates to:
  /// **'Weight'**
  String get proofWeight;

  /// No description provided for @proofDeclaredValue.
  ///
  /// In en, this message translates to:
  /// **'Declared value'**
  String get proofDeclaredValue;

  /// No description provided for @proofDeclaredValueNote.
  ///
  /// In en, this message translates to:
  /// **'Never printed on the label.'**
  String get proofDeclaredValueNote;

  /// No description provided for @proofErrPhotoInvalid.
  ///
  /// In en, this message translates to:
  /// **'One of the photos could not be used. Add it again.'**
  String get proofErrPhotoInvalid;

  /// No description provided for @proofErrPhotoRequired.
  ///
  /// In en, this message translates to:
  /// **'Add at least one photo of the package.'**
  String get proofErrPhotoRequired;

  /// No description provided for @proofErrContents.
  ///
  /// In en, this message translates to:
  /// **'Check the item list: a name up to 60 characters, a quantity from 1 to 99, and an optional serial number.'**
  String get proofErrContents;

  /// No description provided for @proofErrWeight.
  ///
  /// In en, this message translates to:
  /// **'Enter a weight between 0.1 and 2000 lb.'**
  String get proofErrWeight;

  /// No description provided for @proofErrDeclaredValue.
  ///
  /// In en, this message translates to:
  /// **'Enter a declared value of \$0 or more.'**
  String get proofErrDeclaredValue;

  /// No description provided for @proofErrPickupCode.
  ///
  /// In en, this message translates to:
  /// **'The pickup code does not match. Ask the receiver for the code in their message, or deliver without a code.'**
  String get proofErrPickupCode;

  /// No description provided for @proofErrOverride.
  ///
  /// In en, this message translates to:
  /// **'Delivering without a code needs the name of the person collecting and a photo.'**
  String get proofErrOverride;

  /// No description provided for @proofErrSettings.
  ///
  /// In en, this message translates to:
  /// **'The proof settings could not be saved.'**
  String get proofErrSettings;

  /// No description provided for @proofTickPhoto.
  ///
  /// In en, this message translates to:
  /// **'Drop-off photo'**
  String get proofTickPhoto;

  /// No description provided for @proofTickPhotoNone.
  ///
  /// In en, this message translates to:
  /// **'No drop-off photo'**
  String get proofTickPhotoNone;

  /// No description provided for @proofTickSenderNone.
  ///
  /// In en, this message translates to:
  /// **'Sender not asked'**
  String get proofTickSenderNone;

  /// No description provided for @proofTickSenderAsked.
  ///
  /// In en, this message translates to:
  /// **'Sender asked, no answer yet'**
  String get proofTickSenderAsked;

  /// No description provided for @proofTickSenderConfirmed.
  ///
  /// In en, this message translates to:
  /// **'Sender confirmed'**
  String get proofTickSenderConfirmed;

  /// No description provided for @proofTickSenderProblem.
  ///
  /// In en, this message translates to:
  /// **'Sender reported a problem'**
  String get proofTickSenderProblem;

  /// No description provided for @proofTickDelivered.
  ///
  /// In en, this message translates to:
  /// **'Delivered'**
  String get proofTickDelivered;

  /// No description provided for @proofTickDeliveredWithoutCode.
  ///
  /// In en, this message translates to:
  /// **'Delivered without code'**
  String get proofTickDeliveredWithoutCode;

  /// No description provided for @proofTickNotDelivered.
  ///
  /// In en, this message translates to:
  /// **'Not delivered yet'**
  String get proofTickNotDelivered;

  /// No description provided for @proofMissingFilter.
  ///
  /// In en, this message translates to:
  /// **'Missing proof'**
  String get proofMissingFilter;

  /// No description provided for @proofNoneMissing.
  ///
  /// In en, this message translates to:
  /// **'Every package here has its photo and the sender’s OK.'**
  String get proofNoneMissing;

  /// No description provided for @proofProblemBanner.
  ///
  /// In en, this message translates to:
  /// **'Sender reported a problem'**
  String get proofProblemBanner;

  /// No description provided for @proofOpenConversation.
  ///
  /// In en, this message translates to:
  /// **'Open conversation'**
  String get proofOpenConversation;

  /// No description provided for @proofLoadAnywayTitle.
  ///
  /// In en, this message translates to:
  /// **'Load anyway?'**
  String get proofLoadAnywayTitle;

  /// No description provided for @proofLoadAnywayMessage.
  ///
  /// In en, this message translates to:
  /// **'Sender reported a problem with {codes}. Load anyway?'**
  String proofLoadAnywayMessage(String codes);

  /// No description provided for @proofLoadAnyway.
  ///
  /// In en, this message translates to:
  /// **'Load anyway'**
  String get proofLoadAnyway;

  /// No description provided for @proofWeightFact.
  ///
  /// In en, this message translates to:
  /// **'Weight: {weight}'**
  String proofWeightFact(String weight);

  /// No description provided for @proofValueFact.
  ///
  /// In en, this message translates to:
  /// **'Declared value: {value}'**
  String proofValueFact(String value);

  /// No description provided for @proofCustomerPhotos.
  ///
  /// In en, this message translates to:
  /// **'Photos from the customer'**
  String get proofCustomerPhotos;

  /// No description provided for @proofDeliveredPhoto.
  ///
  /// In en, this message translates to:
  /// **'Handover photo'**
  String get proofDeliveredPhoto;

  /// No description provided for @proofPickupCodeFact.
  ///
  /// In en, this message translates to:
  /// **'Pickup code: {code}'**
  String proofPickupCodeFact(String code);

  /// No description provided for @airModeTitle.
  ///
  /// In en, this message translates to:
  /// **'Sea or air'**
  String get airModeTitle;

  /// No description provided for @airModeSea.
  ///
  /// In en, this message translates to:
  /// **'Sea'**
  String get airModeSea;

  /// No description provided for @airModeAir.
  ///
  /// In en, this message translates to:
  /// **'Air'**
  String get airModeAir;

  /// No description provided for @airWaybill.
  ///
  /// In en, this message translates to:
  /// **'Air waybill'**
  String get airWaybill;

  /// No description provided for @airWaybillHint.
  ///
  /// In en, this message translates to:
  /// **'Letters, digits and dashes, like 176-12345678'**
  String get airWaybillHint;

  /// No description provided for @airAirline.
  ///
  /// In en, this message translates to:
  /// **'Airline (optional)'**
  String get airAirline;

  /// No description provided for @airLabelOptionalNote.
  ///
  /// In en, this message translates to:
  /// **'Optional once there is an air waybill.'**
  String get airLabelOptionalNote;

  /// No description provided for @airErrWaybill.
  ///
  /// In en, this message translates to:
  /// **'An air waybill is 6 to 20 letters, digits or dashes, like 176-12345678.'**
  String get airErrWaybill;

  /// No description provided for @airNewShipment.
  ///
  /// In en, this message translates to:
  /// **'New shipment'**
  String get airNewShipment;

  /// No description provided for @airEditShipment.
  ///
  /// In en, this message translates to:
  /// **'Edit shipment'**
  String get airEditShipment;

  /// No description provided for @airCreated.
  ///
  /// In en, this message translates to:
  /// **'Shipment created.'**
  String get airCreated;

  /// No description provided for @airShipTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this shipment departed?'**
  String get airShipTitle;

  /// No description provided for @airArriveTitle.
  ///
  /// In en, this message translates to:
  /// **'Mark this shipment ready for pickup?'**
  String get airArriveTitle;

  /// No description provided for @airArriveMessage.
  ///
  /// In en, this message translates to:
  /// **'Customers are told on WhatsApp where to collect their goods.'**
  String get airArriveMessage;

  /// No description provided for @airDeleteTitle.
  ///
  /// In en, this message translates to:
  /// **'Delete this shipment?'**
  String get airDeleteTitle;

  /// No description provided for @airDelete.
  ///
  /// In en, this message translates to:
  /// **'Delete shipment'**
  String get airDelete;

  /// No description provided for @airDeleteMessage.
  ///
  /// In en, this message translates to:
  /// **'Only an empty shipment that is still loading can be deleted.'**
  String get airDeleteMessage;

  /// No description provided for @airAddLine.
  ///
  /// In en, this message translates to:
  /// **'Add to the shipment'**
  String get airAddLine;

  /// No description provided for @airPkgSection.
  ///
  /// In en, this message translates to:
  /// **'Shipment'**
  String get airPkgSection;

  /// No description provided for @airOpenShipment.
  ///
  /// In en, this message translates to:
  /// **'Open shipment'**
  String get airOpenShipment;

  /// No description provided for @airChip.
  ///
  /// In en, this message translates to:
  /// **'Air'**
  String get airChip;

  /// No description provided for @airLockedNote.
  ///
  /// In en, this message translates to:
  /// **'Departed. The list is the record of what went; only the notes stay open.'**
  String get airLockedNote;

  /// No description provided for @airCustomsList.
  ///
  /// In en, this message translates to:
  /// **'Customs list'**
  String get airCustomsList;

  /// No description provided for @deliverRefusalAirWaybillInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an air waybill of 6 to 20 letters, digits or dashes.'**
  String get deliverRefusalAirWaybillInvalid;

  /// No description provided for @deliverRefusalPhotoInvalid.
  ///
  /// In en, this message translates to:
  /// **'One of the photos could not be used. Add it again.'**
  String get deliverRefusalPhotoInvalid;

  /// No description provided for @deliverRefusalPhotoRequired.
  ///
  /// In en, this message translates to:
  /// **'Add at least one photo of the package.'**
  String get deliverRefusalPhotoRequired;

  /// No description provided for @deliverRefusalContentsInvalid.
  ///
  /// In en, this message translates to:
  /// **'Check the item list: a name up to 60 characters, a quantity from 1 to 99, and an optional serial number.'**
  String get deliverRefusalContentsInvalid;

  /// No description provided for @deliverRefusalWeightInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a weight between 0.1 and 2000 lb.'**
  String get deliverRefusalWeightInvalid;

  /// No description provided for @deliverRefusalDeclaredValueInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter a declared value of \$0 or more.'**
  String get deliverRefusalDeclaredValueInvalid;

  /// No description provided for @deliverRefusalPickupCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'The pickup code does not match. Ask the receiver for the code in their message, or deliver without a code.'**
  String get deliverRefusalPickupCodeInvalid;

  /// No description provided for @deliverRefusalOverrideIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Delivering without a code needs the name of the person collecting and a photo.'**
  String get deliverRefusalOverrideIncomplete;

  /// No description provided for @deliverRefusalCollectedCentsInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter the amount collected in dollars, zero or more.'**
  String get deliverRefusalCollectedCentsInvalid;

  /// No description provided for @deliverRefusalProofSettingsInvalid.
  ///
  /// In en, this message translates to:
  /// **'Check the proof settings: each switch is on or off.'**
  String get deliverRefusalProofSettingsInvalid;

  /// No description provided for @deliverRefusalSenderProblem.
  ///
  /// In en, this message translates to:
  /// **'The sender reported a problem with this package. Check with them before it goes on.'**
  String get deliverRefusalSenderProblem;

  /// No description provided for @deliverPickupCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Pickup code'**
  String get deliverPickupCodeLabel;

  /// No description provided for @deliverPickupCodeHelper.
  ///
  /// In en, this message translates to:
  /// **'The 4 digits in the receiver’s message.'**
  String get deliverPickupCodeHelper;

  /// No description provided for @deliverPickupCodeIncomplete.
  ///
  /// In en, this message translates to:
  /// **'Enter the 4-digit code.'**
  String get deliverPickupCodeIncomplete;

  /// No description provided for @deliverWithoutCodeTitle.
  ///
  /// In en, this message translates to:
  /// **'Deliver without a code'**
  String get deliverWithoutCodeTitle;

  /// No description provided for @deliverWithoutCodeNote.
  ///
  /// In en, this message translates to:
  /// **'Type who is collecting it and take their photo. The package will show “Delivered without code”.'**
  String get deliverWithoutCodeNote;

  /// No description provided for @deliverCollectorLabel.
  ///
  /// In en, this message translates to:
  /// **'Who collected it'**
  String get deliverCollectorLabel;

  /// No description provided for @deliverPhotoLabel.
  ///
  /// In en, this message translates to:
  /// **'Photo of the person collecting'**
  String get deliverPhotoLabel;

  /// No description provided for @deliverTakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Take a photo'**
  String get deliverTakePhoto;

  /// No description provided for @deliverRetakePhoto.
  ///
  /// In en, this message translates to:
  /// **'Retake'**
  String get deliverRetakePhoto;

  /// No description provided for @deliverPhotoUploading.
  ///
  /// In en, this message translates to:
  /// **'Uploading the photo…'**
  String get deliverPhotoUploading;

  /// No description provided for @deliverPhotoAdded.
  ///
  /// In en, this message translates to:
  /// **'Photo added'**
  String get deliverPhotoAdded;

  /// No description provided for @deliverPhotoFailed.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t add the photo. Try again.'**
  String get deliverPhotoFailed;

  /// No description provided for @deliverCollectedNowLabel.
  ///
  /// In en, this message translates to:
  /// **'Collected now (USD)'**
  String get deliverCollectedNowLabel;

  /// No description provided for @deliverCollectedNowHelper.
  ///
  /// In en, this message translates to:
  /// **'Optional. Whole dollars collected at handover.'**
  String get deliverCollectedNowHelper;

  /// No description provided for @deliverOwes.
  ///
  /// In en, this message translates to:
  /// **'Owes {amount}'**
  String deliverOwes(String amount);

  /// No description provided for @deliverCollectedNowInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter whole dollars, zero or more.'**
  String get deliverCollectedNowInvalid;

  /// No description provided for @deliverDoneCollected.
  ///
  /// In en, this message translates to:
  /// **'Delivered · {amount} collected'**
  String deliverDoneCollected(String amount);

  /// No description provided for @deliverWithoutCodePill.
  ///
  /// In en, this message translates to:
  /// **'Delivered without code'**
  String get deliverWithoutCodePill;

  /// No description provided for @deliverPhotoOfCollector.
  ///
  /// In en, this message translates to:
  /// **'Photo of the person who collected it'**
  String get deliverPhotoOfCollector;

  /// No description provided for @deliverHomeTitle.
  ///
  /// In en, this message translates to:
  /// **'Deliveries'**
  String get deliverHomeTitle;

  /// No description provided for @deliverHomeSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Hand packages over to the people collecting them.'**
  String get deliverHomeSubtitle;

  /// No description provided for @deliverToHandOver.
  ///
  /// In en, this message translates to:
  /// **'To hand over'**
  String get deliverToHandOver;

  /// No description provided for @deliverToHandOverEmpty.
  ///
  /// In en, this message translates to:
  /// **'Nothing to hand over right now.'**
  String get deliverToHandOverEmpty;

  /// No description provided for @deliverToHandOverEmptyHint.
  ///
  /// In en, this message translates to:
  /// **'Packages appear here once their shipment or container is ready for pickup.'**
  String get deliverToHandOverEmptyHint;

  /// No description provided for @deliverScan.
  ///
  /// In en, this message translates to:
  /// **'Scan a label'**
  String get deliverScan;

  /// No description provided for @deliverEnterCode.
  ///
  /// In en, this message translates to:
  /// **'Enter a code'**
  String get deliverEnterCode;

  /// No description provided for @deliverEnterCodeHint.
  ///
  /// In en, this message translates to:
  /// **'CL-XXXXXX'**
  String get deliverEnterCodeHint;

  /// No description provided for @deliverCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'That is not a package code.'**
  String get deliverCodeInvalid;

  /// No description provided for @deliverFind.
  ///
  /// In en, this message translates to:
  /// **'Find'**
  String get deliverFind;

  /// No description provided for @deliverShipment.
  ///
  /// In en, this message translates to:
  /// **'Shipment'**
  String get deliverShipment;

  /// No description provided for @deliverContainer.
  ///
  /// In en, this message translates to:
  /// **'Container'**
  String get deliverContainer;

  /// No description provided for @deliverPieces.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 piece} other{{count} pieces}}'**
  String deliverPieces(int count);

  /// No description provided for @deliverCouldNotLoad.
  ///
  /// In en, this message translates to:
  /// **'Couldn’t load the deliveries. Check your connection and try again.'**
  String get deliverCouldNotLoad;

  /// No description provided for @deliverRetry.
  ///
  /// In en, this message translates to:
  /// **'Retry'**
  String get deliverRetry;

  /// No description provided for @deliverDetails.
  ///
  /// In en, this message translates to:
  /// **'Details'**
  String get deliverDetails;

  /// No description provided for @proofSettingTitle.
  ///
  /// In en, this message translates to:
  /// **'Proof'**
  String get proofSettingTitle;

  /// No description provided for @proofSettingPhotosRequired.
  ///
  /// In en, this message translates to:
  /// **'Photos required at drop-off'**
  String get proofSettingPhotosRequired;

  /// No description provided for @proofSettingPhotosRequiredNote.
  ///
  /// In en, this message translates to:
  /// **'Staff must add at least one photo before a counter package is saved.'**
  String get proofSettingPhotosRequiredNote;

  /// No description provided for @proofSettingSenderConfirm.
  ///
  /// In en, this message translates to:
  /// **'Ask the sender to confirm by WhatsApp'**
  String get proofSettingSenderConfirm;

  /// No description provided for @proofSettingSenderConfirmNote.
  ///
  /// In en, this message translates to:
  /// **'Right after drop-off, the sender gets the first photo and the item list with OK / Something’s wrong.'**
  String get proofSettingSenderConfirmNote;

  /// No description provided for @proofSettingPickupCode.
  ///
  /// In en, this message translates to:
  /// **'Pickup code at delivery'**
  String get proofSettingPickupCode;

  /// No description provided for @proofSettingPickupCodeNote.
  ///
  /// In en, this message translates to:
  /// **'Each package gets a 4-digit code sent to the receiver; your agent asks for it at handover.'**
  String get proofSettingPickupCodeNote;

  /// No description provided for @lookupTitle.
  ///
  /// In en, this message translates to:
  /// **'Enter the customer’s code'**
  String get lookupTitle;

  /// No description provided for @lookupHint.
  ///
  /// In en, this message translates to:
  /// **'Type the code on the customer’s request, like R-K7M4P.'**
  String get lookupHint;

  /// No description provided for @lookupCodeLabel.
  ///
  /// In en, this message translates to:
  /// **'Request code'**
  String get lookupCodeLabel;

  /// No description provided for @lookupCodeInvalid.
  ///
  /// In en, this message translates to:
  /// **'A request code has 5 letters or digits, like R-K7M4P.'**
  String get lookupCodeInvalid;

  /// No description provided for @lookupFind.
  ///
  /// In en, this message translates to:
  /// **'Find the request'**
  String get lookupFind;

  /// No description provided for @lookupFinding.
  ///
  /// In en, this message translates to:
  /// **'Looking up…'**
  String get lookupFinding;

  /// No description provided for @lookupNotFound.
  ///
  /// In en, this message translates to:
  /// **'No request with that code for this business.'**
  String get lookupNotFound;

  /// No description provided for @pmeModeSoFar.
  ///
  /// In en, this message translates to:
  /// **'So far'**
  String get pmeModeSoFar;

  /// No description provided for @pmeModeWholeMonth.
  ///
  /// In en, this message translates to:
  /// **'Whole month (estimate)'**
  String get pmeModeWholeMonth;

  /// No description provided for @pmeEstimateNote.
  ///
  /// In en, this message translates to:
  /// **'Estimate: cars still parked are counted to {lastDay}. Nothing is saved.'**
  String pmeEstimateNote(String lastDay);

  /// No description provided for @pmeEstimateHeader.
  ///
  /// In en, this message translates to:
  /// **'ESTIMATE — whole month, cars still parked counted to {lastDay}'**
  String pmeEstimateHeader(String lastDay);

  /// No description provided for @pmeExpensesTitle.
  ///
  /// In en, this message translates to:
  /// **'Expenses you paid for the lot'**
  String get pmeExpensesTitle;

  /// No description provided for @pmeLessExpenses.
  ///
  /// In en, this message translates to:
  /// **'Less expenses'**
  String get pmeLessExpenses;

  /// No description provided for @pmeLessExpensesAmount.
  ///
  /// In en, this message translates to:
  /// **'Less expenses −{amount}'**
  String pmeLessExpensesAmount(String amount);

  /// No description provided for @pmeLessStaffExpenses.
  ///
  /// In en, this message translates to:
  /// **'Less staff expenses'**
  String get pmeLessStaffExpenses;

  /// No description provided for @pmeLotExpense.
  ///
  /// In en, this message translates to:
  /// **'Lot expense'**
  String get pmeLotExpense;

  /// No description provided for @pmeExpenseLinesCount.
  ///
  /// In en, this message translates to:
  /// **'{count, plural, =1{1 expense this month} other{{count} expenses this month}}'**
  String pmeExpenseLinesCount(int count);

  /// No description provided for @pmeExpensesUnavailable.
  ///
  /// In en, this message translates to:
  /// **'Staff expenses could not be loaded, so bills are shown before expenses.'**
  String get pmeExpensesUnavailable;

  /// No description provided for @pmeBusinessOwes.
  ///
  /// In en, this message translates to:
  /// **'Business owes'**
  String get pmeBusinessOwes;

  /// No description provided for @pmeBusinessOwesHint.
  ///
  /// In en, this message translates to:
  /// **'Expenses staff paid out of their own pocket, after what they owe on parking.'**
  String get pmeBusinessOwesHint;

  /// No description provided for @pmeBusinessOwesNone.
  ///
  /// In en, this message translates to:
  /// **'The business owes its staff nothing.'**
  String get pmeBusinessOwesNone;

  /// No description provided for @pmeNoParkingBill.
  ///
  /// In en, this message translates to:
  /// **'No parking bill'**
  String get pmeNoParkingBill;

  /// No description provided for @pmePaidBack.
  ///
  /// In en, this message translates to:
  /// **'Paid back'**
  String get pmePaidBack;

  /// No description provided for @pmePaidBackSubtitle.
  ///
  /// In en, this message translates to:
  /// **'{name} · owed {amount}'**
  String pmePaidBackSubtitle(String name, String amount);

  /// No description provided for @pmePaidBackHint.
  ///
  /// In en, this message translates to:
  /// **'Record the money given back to them. It comes off what the business owes.'**
  String get pmePaidBackHint;

  /// No description provided for @pmePaidBackAmount.
  ///
  /// In en, this message translates to:
  /// **'Amount given'**
  String get pmePaidBackAmount;

  /// No description provided for @pmePaidBackGivenBy.
  ///
  /// In en, this message translates to:
  /// **'Given by'**
  String get pmePaidBackGivenBy;

  /// No description provided for @pmePaidBackWho.
  ///
  /// In en, this message translates to:
  /// **'Who gave the money'**
  String get pmePaidBackWho;

  /// No description provided for @pmePaidBackSayWho.
  ///
  /// In en, this message translates to:
  /// **'Say who gave the money.'**
  String get pmePaidBackSayWho;

  /// No description provided for @pmePaidBackAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount above \$0.00, up to {amount}.'**
  String pmePaidBackAmountInvalid(String amount);

  /// No description provided for @pmePaidBackDone.
  ///
  /// In en, this message translates to:
  /// **'Paid back {amount} recorded.'**
  String pmePaidBackDone(String amount);

  /// No description provided for @pmeRepaymentsThisMonth.
  ///
  /// In en, this message translates to:
  /// **'Paid back this month'**
  String get pmeRepaymentsThisMonth;

  /// No description provided for @pmeGivenByName.
  ///
  /// In en, this message translates to:
  /// **'by {name}'**
  String pmeGivenByName(String name);

  /// No description provided for @pmeVoidRepaymentTitle.
  ///
  /// In en, this message translates to:
  /// **'Void this payment?'**
  String get pmeVoidRepaymentTitle;

  /// No description provided for @pmeVoidRepaymentBody.
  ///
  /// In en, this message translates to:
  /// **'{amount} given to {name} will count as not paid back. Nothing is deleted.'**
  String pmeVoidRepaymentBody(String amount, String name);

  /// No description provided for @pmeRepaymentVoided.
  ///
  /// In en, this message translates to:
  /// **'Payment voided.'**
  String get pmeRepaymentVoided;

  /// No description provided for @pmeRefusalRepaymentAmountInvalid.
  ///
  /// In en, this message translates to:
  /// **'Enter an amount above \$0.00.'**
  String get pmeRefusalRepaymentAmountInvalid;

  /// No description provided for @pmeRefusalRepaymentExceedsCredit.
  ///
  /// In en, this message translates to:
  /// **'That is more than the business owes them for expenses.'**
  String get pmeRefusalRepaymentExceedsCredit;

  /// No description provided for @pmeRefusalRepaymentNotFound.
  ///
  /// In en, this message translates to:
  /// **'That payment could not be found.'**
  String get pmeRefusalRepaymentNotFound;

  /// No description provided for @pmeRefusalRepaymentVoided.
  ///
  /// In en, this message translates to:
  /// **'That payment was already voided.'**
  String get pmeRefusalRepaymentVoided;

  /// No description provided for @pmeRefusalRepaymentMethodInvalid.
  ///
  /// In en, this message translates to:
  /// **'Pick how the money was given.'**
  String get pmeRefusalRepaymentMethodInvalid;

  /// No description provided for @pmeRefusalRepaymentDateInvalid.
  ///
  /// In en, this message translates to:
  /// **'That date is not valid, or it is after today.'**
  String get pmeRefusalRepaymentDateInvalid;

  /// No description provided for @pmeRefusalLinkCustomerInvalid.
  ///
  /// In en, this message translates to:
  /// **'That parking customer could not be found.'**
  String get pmeRefusalLinkCustomerInvalid;

  /// No description provided for @pmeRefusalStaffActionInvalid.
  ///
  /// In en, this message translates to:
  /// **'That action is not available. Update the app and try again.'**
  String get pmeRefusalStaffActionInvalid;

  /// No description provided for @pmeRefusalStaffNotMember.
  ///
  /// In en, this message translates to:
  /// **'That person is not on this business\'s team.'**
  String get pmeRefusalStaffNotMember;

  /// Who voided a record, in the 'Voided · reason · by · date' note.
  ///
  /// In en, this message translates to:
  /// **'by {name}'**
  String voidedNoteBy(String name);

  /// Button on an expense line card that voids the line.
  ///
  /// In en, this message translates to:
  /// **'Void line'**
  String get lotVoidLine;

  /// Title of the sheet confirming an expense line void.
  ///
  /// In en, this message translates to:
  /// **'Void this line'**
  String get lotVoidLineTitle;

  /// Explains what voiding an expense line does.
  ///
  /// In en, this message translates to:
  /// **'Void this line — it stays on the record (struck through) and drops out of every month\'s totals. It is never deleted.'**
  String get lotVoidLineExplain;

  /// Status word on a voided expense line.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get lotLineVoidedStatus;

  /// Confirmation after an expense line is voided.
  ///
  /// In en, this message translates to:
  /// **'Line voided.'**
  String get lotVoidLineDone;

  /// Refusal: an expense line with live purchases cannot be voided.
  ///
  /// In en, this message translates to:
  /// **'Void this line\'s purchases first.'**
  String get lotErrLineHasPurchases;

  /// Refusal: the expense line is already voided.
  ///
  /// In en, this message translates to:
  /// **'This line was already voided.'**
  String get lotErrLineVoided;

  /// Refusal: the expense line was not found.
  ///
  /// In en, this message translates to:
  /// **'This line no longer exists.'**
  String get lotErrLineNotFound;

  /// Button that voids a parked car record.
  ///
  /// In en, this message translates to:
  /// **'Void'**
  String get parkingVoid;

  /// Title of the sheet confirming a parked car void.
  ///
  /// In en, this message translates to:
  /// **'Void this car'**
  String get parkingVoidTitle;

  /// Explains what voiding a parked car does.
  ///
  /// In en, this message translates to:
  /// **'Void this car — it stays on the record (struck through) and drops out of the totals; it is never deleted. Other staff see who voided it and why.'**
  String get parkingVoidExplain;

  /// Status word on a voided parked car.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get parkingVoidedStatus;

  /// Confirmation after a parked car is voided.
  ///
  /// In en, this message translates to:
  /// **'Car voided.'**
  String get parkingVoidDone;

  /// Banner on a voided parked car's details.
  ///
  /// In en, this message translates to:
  /// **'This car was voided. It stays on the record but no longer counts anywhere, and it can no longer be changed.'**
  String get parkingVoidedLocked;

  /// Refusal: the parked car is voided.
  ///
  /// In en, this message translates to:
  /// **'This car was voided and can no longer be changed.'**
  String get parkingErrCarVoided;

  /// Refusal: the parked car was not found.
  ///
  /// In en, this message translates to:
  /// **'This car could not be found.'**
  String get parkingErrCarNotFound;

  /// Parking list filter chip for voided cars.
  ///
  /// In en, this message translates to:
  /// **'Voided'**
  String get parkingKindVoided;

  /// Button on an expense line card: the line stops counting after the month on screen.
  ///
  /// In en, this message translates to:
  /// **'Stop after this month'**
  String get lotStopAfterMonth;

  /// Title of the sheet confirming an expense line stop.
  ///
  /// In en, this message translates to:
  /// **'Stop this line'**
  String get lotStopLineTitle;

  /// Explains stopping an expense line after a month.
  ///
  /// In en, this message translates to:
  /// **'{line} stops after {month}. Earlier months stay as they are.'**
  String lotStopLineExplain(String line, String month);

  /// Confirm button that stops an expense line.
  ///
  /// In en, this message translates to:
  /// **'Stop'**
  String get lotStopLineConfirm;

  /// Confirmation after an expense line is stopped.
  ///
  /// In en, this message translates to:
  /// **'Line stopped.'**
  String get lotStopLineDone;

  /// Badge on an expense line that stops after a month.
  ///
  /// In en, this message translates to:
  /// **'Stopped after {month}'**
  String lotStoppedAfter(String month);

  /// State of an expense line in a month after it stopped.
  ///
  /// In en, this message translates to:
  /// **'Stopped'**
  String get lotLineStoppedStatus;

  /// Button that removes an expense line's stop month.
  ///
  /// In en, this message translates to:
  /// **'Resume'**
  String get lotResumeLine;

  /// Title of the sheet confirming an expense line resume.
  ///
  /// In en, this message translates to:
  /// **'Resume this line'**
  String get lotResumeLineTitle;

  /// Explains resuming a stopped expense line.
  ///
  /// In en, this message translates to:
  /// **'{line} counts again every month, with no end.'**
  String lotResumeLineExplain(String line);

  /// Confirmation after an expense line is resumed.
  ///
  /// In en, this message translates to:
  /// **'Line resumed.'**
  String get lotResumeLineDone;

  /// Refusal: the stop month is not a valid month.
  ///
  /// In en, this message translates to:
  /// **'Pick a valid month.'**
  String get lotErrEndMonthInvalid;

  /// Refusal: the line has purchases after the stop month.
  ///
  /// In en, this message translates to:
  /// **'This line has purchases after that month.'**
  String get lotErrEndMonthBeforePurchases;

  /// Label above the Sea / Air choice on a package form (docs/AIR_PACKAGES.md §7).
  ///
  /// In en, this message translates to:
  /// **'Ships by'**
  String get shipsByLabel;

  /// Small badge on a waiting package marked to fly.
  ///
  /// In en, this message translates to:
  /// **'Air'**
  String get shipsByAirBadge;

  /// Refusal: a package marked sea put on an air shipment.
  ///
  /// In en, this message translates to:
  /// **'This package is marked to go by sea; this is a flight. Change the package\'s Ships by first.'**
  String get wpkErrShipModeMismatch;

  /// Refusal: a package marked air put on a sea container.
  ///
  /// In en, this message translates to:
  /// **'This package is marked to go by air; this is a sea container. Change the package\'s Ships by first.'**
  String get wpkErrShipModeMismatchAir;

  /// Refusal: Ships by changed on a package already on a container.
  ///
  /// In en, this message translates to:
  /// **'This package is on a container already, so it goes the way that one goes. Take it off first to change Ships by.'**
  String get wpkErrShipModeLocked;

  /// Refusal: the ship mode sent is neither sea nor air.
  ///
  /// In en, this message translates to:
  /// **'Choose how the package ships: sea or air.'**
  String get wpkErrShipModeInvalid;

  /// Why a waiting package cannot go on this air shipment (row note).
  ///
  /// In en, this message translates to:
  /// **'Ships by sea; this is a flight'**
  String get wpkBlockedShipsBySea;

  /// Why a waiting package cannot go on this sea container (row note).
  ///
  /// In en, this message translates to:
  /// **'Ships by air; this is a sea container'**
  String get wpkBlockedShipsByAir;
}

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  Future<AppLocalizations> load(Locale locale) {
    return SynchronousFuture<AppLocalizations>(lookupAppLocalizations(locale));
  }

  @override
  bool isSupported(Locale locale) =>
      <String>['en', 'fr'].contains(locale.languageCode);

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

AppLocalizations lookupAppLocalizations(Locale locale) {
  // Lookup logic when only language code is specified.
  switch (locale.languageCode) {
    case 'en':
      return AppLocalizationsEn();
    case 'fr':
      return AppLocalizationsFr();
  }

  throw FlutterError(
    'AppLocalizations.delegate failed to load unsupported locale "$locale". This is likely '
    'an issue with the localizations generation tool. Please file an issue '
    'on GitHub with a reproducible sample app and the gen-l10n configuration '
    'that was used.',
  );
}
