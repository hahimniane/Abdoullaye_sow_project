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

  /// No description provided for @selectCountryFirst.
  ///
  /// In en, this message translates to:
  /// **'Select country first'**
  String get selectCountryFirst;

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

  /// No description provided for @migrationComplete.
  ///
  /// In en, this message translates to:
  /// **'Migration complete: {count} writes.'**
  String migrationComplete(Object count);

  /// No description provided for @migrationFailed.
  ///
  /// In en, this message translates to:
  /// **'Migration failed: {error}'**
  String migrationFailed(Object error);

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

  /// No description provided for @migrateKerenData.
  ///
  /// In en, this message translates to:
  /// **'Migrate Keren data'**
  String get migrateKerenData;

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
  /// **'Add at least one so customers can drop off items in person.'**
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
  /// **'Shipment updated. {amount} credited to your wallet.'**
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
  /// **'Used as the default address for vehicle listings.'**
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
  /// **'Drop your parcel at the business location. Pickup coming soon.'**
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
  /// **'Choose {businessName} for {price}? This closes the request to other businesses.'**
  String confirmTransportQuoteMessage(Object businessName, Object price);

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
  /// **'Manage freight, barrels, transport, parking, destinations, staff, and payouts in the secure business console. This avoids entering a customer booking or payment flow by mistake.'**
  String get businessOperationsWebNote;

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
  /// **'{barrelCount} barrels • {destinationCount} destinations • {businessCount} businesses'**
  String barrelOrderSummary(
    Object barrelCount,
    Object destinationCount,
    Object businessCount,
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
  /// **'Home pickup · all services'**
  String get pickupPlanSectionTitle;

  /// No description provided for @pickupPlanSectionSubtitle.
  ///
  /// In en, this message translates to:
  /// **'One pickup plan applies to every service you offer. Any service can use its own settings below.'**
  String get pickupPlanSectionSubtitle;

  /// No description provided for @pickupPlanOfferToggle.
  ///
  /// In en, this message translates to:
  /// **'Offer home pickup'**
  String get pickupPlanOfferToggle;

  /// No description provided for @pickupPlanDisabledHint.
  ///
  /// In en, this message translates to:
  /// **'Customers bring items to your business. Turn pickup on to offer collection from their address, priced by your own plan.'**
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
  /// **'Per-service pickup: each service uses the shared plan unless you give it custom settings or turn its pickup off.'**
  String get pickupPlanPerServiceHint;

  /// No description provided for @pickupPlanChoiceInherit.
  ///
  /// In en, this message translates to:
  /// **'Use shared plan'**
  String get pickupPlanChoiceInherit;

  /// No description provided for @pickupPlanChoiceCustom.
  ///
  /// In en, this message translates to:
  /// **'Custom settings'**
  String get pickupPlanChoiceCustom;

  /// No description provided for @pickupPlanChoiceOff.
  ///
  /// In en, this message translates to:
  /// **'No pickup'**
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
