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
  /// **'Active Cars'**
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

  /// No description provided for @staffAccess.
  ///
  /// In en, this message translates to:
  /// **'Staff Access'**
  String get staffAccess;

  /// No description provided for @staffLogin.
  ///
  /// In en, this message translates to:
  /// **'Staff Login'**
  String get staffLogin;

  /// No description provided for @accessStaffFeatures.
  ///
  /// In en, this message translates to:
  /// **'Access staff features and management tools'**
  String get accessStaffFeatures;

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
  /// **'Set as Customer'**
  String get setAsCustomer;

  /// No description provided for @setAsStaff.
  ///
  /// In en, this message translates to:
  /// **'Set as Staff'**
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
  /// **'Delete User'**
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
  /// **'Sign up to get started'**
  String get signUpToGetStarted;

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
