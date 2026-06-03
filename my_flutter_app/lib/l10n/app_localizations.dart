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
  /// **'Mark as Sold'**
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
  /// **'Contact Phone'**
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

  /// No description provided for @themeLabel.
  ///
  /// In en, this message translates to:
  /// **'Appearance'**
  String get themeLabel;

  /// No description provided for @darkMode.
  ///
  /// In en, this message translates to:
  /// **'Dark mode'**
  String get darkMode;

  /// No description provided for @lightMode.
  ///
  /// In en, this message translates to:
  /// **'Light mode'**
  String get lightMode;

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
  /// **'Destinations and shipping fees'**
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

  /// No description provided for @carrierTracking.
  ///
  /// In en, this message translates to:
  /// **'Carrier tracking'**
  String get carrierTracking;

  /// No description provided for @couldNotOpenCarrierTracking.
  ///
  /// In en, this message translates to:
  /// **'Could not open carrier tracking.'**
  String get couldNotOpenCarrierTracking;

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
  /// **'Select the countries this business ships to and add the shipping fee for each destination.'**
  String get selectCountriesAddFees;

  /// No description provided for @activeDestinationsHaveFees.
  ///
  /// In en, this message translates to:
  /// **'{priced} of {total} active destinations have shipping fees.'**
  String activeDestinationsHaveFees(Object priced, Object total);

  /// No description provided for @selectDestinationCountries.
  ///
  /// In en, this message translates to:
  /// **'Select destination countries'**
  String get selectDestinationCountries;

  /// No description provided for @manageDestinationsFees.
  ///
  /// In en, this message translates to:
  /// **'Manage destinations and fees'**
  String get manageDestinationsFees;

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

  /// No description provided for @peopleAndAccess.
  ///
  /// In en, this message translates to:
  /// **'People and access'**
  String get peopleAndAccess;

  /// No description provided for @peopleAndAccessSubtitle.
  ///
  /// In en, this message translates to:
  /// **'Manage platform managers, business teams, and customer accounts.'**
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

  /// No description provided for @ownerNameRequiredShort.
  ///
  /// In en, this message translates to:
  /// **'Owner name is required'**
  String get ownerNameRequiredShort;

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
