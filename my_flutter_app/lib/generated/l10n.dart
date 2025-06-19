// GENERATED CODE - DO NOT MODIFY BY HAND
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'intl/messages_all.dart';

// **************************************************************************
// Generator: Flutter Intl IDE plugin
// Made by Localizely
// **************************************************************************

// ignore_for_file: non_constant_identifier_names, lines_longer_than_80_chars
// ignore_for_file: join_return_with_assignment, prefer_final_in_for_each
// ignore_for_file: avoid_redundant_argument_values, avoid_escaping_inner_quotes

class S {
  S();

  static S? _current;

  static S get current {
    assert(
      _current != null,
      'No instance of S was loaded. Try to initialize the S delegate before accessing S.current.',
    );
    return _current!;
  }

  static const AppLocalizationDelegate delegate = AppLocalizationDelegate();

  static Future<S> load(Locale locale) {
    final name = (locale.countryCode?.isEmpty ?? false)
        ? locale.languageCode
        : locale.toString();
    final localeName = Intl.canonicalizedLocale(name);
    return initializeMessages(localeName).then((_) {
      Intl.defaultLocale = localeName;
      final instance = S();
      S._current = instance;

      return instance;
    });
  }

  static S of(BuildContext context) {
    final instance = S.maybeOf(context);
    assert(
      instance != null,
      'No instance of S present in the widget tree. Did you add S.delegate in localizationsDelegates?',
    );
    return instance!;
  }

  static S? maybeOf(BuildContext context) {
    return Localizations.of<S>(context, S);
  }

  /// `Welcome Back`
  String get welcomeBack {
    return Intl.message(
      'Welcome Back',
      name: 'welcomeBack',
      desc: '',
      args: [],
    );
  }

  /// `Sign in to your account`
  String get signInToAccount {
    return Intl.message(
      'Sign in to your account',
      name: 'signInToAccount',
      desc: '',
      args: [],
    );
  }

  /// `Email`
  String get email {
    return Intl.message('Email', name: 'email', desc: '', args: []);
  }

  /// `Enter your email`
  String get enterEmail {
    return Intl.message(
      'Enter your email',
      name: 'enterEmail',
      desc: '',
      args: [],
    );
  }

  /// `Password`
  String get password {
    return Intl.message('Password', name: 'password', desc: '', args: []);
  }

  /// `Enter your password`
  String get enterPassword {
    return Intl.message(
      'Enter your password',
      name: 'enterPassword',
      desc: '',
      args: [],
    );
  }

  /// `Sign In`
  String get signIn {
    return Intl.message('Sign In', name: 'signIn', desc: '', args: []);
  }

  /// `Forgot Password?`
  String get forgotPassword {
    return Intl.message(
      'Forgot Password?',
      name: 'forgotPassword',
      desc: '',
      args: [],
    );
  }

  /// `Please enter your email`
  String get pleaseEnterEmail {
    return Intl.message(
      'Please enter your email',
      name: 'pleaseEnterEmail',
      desc: '',
      args: [],
    );
  }

  /// `Please enter a valid email`
  String get pleaseEnterValidEmail {
    return Intl.message(
      'Please enter a valid email',
      name: 'pleaseEnterValidEmail',
      desc: '',
      args: [],
    );
  }

  /// `Please enter your password`
  String get pleaseEnterPassword {
    return Intl.message(
      'Please enter your password',
      name: 'pleaseEnterPassword',
      desc: '',
      args: [],
    );
  }

  /// `Password must be at least 6 characters`
  String get passwordMinLength {
    return Intl.message(
      'Password must be at least 6 characters',
      name: 'passwordMinLength',
      desc: '',
      args: [],
    );
  }

  /// `Forgot Password?`
  String get forgotPasswordTitle {
    return Intl.message(
      'Forgot Password?',
      name: 'forgotPasswordTitle',
      desc: '',
      args: [],
    );
  }

  /// `Enter your email to reset your password`
  String get enterEmailToReset {
    return Intl.message(
      'Enter your email to reset your password',
      name: 'enterEmailToReset',
      desc: '',
      args: [],
    );
  }

  /// `Reset Password`
  String get resetPassword {
    return Intl.message(
      'Reset Password',
      name: 'resetPassword',
      desc: '',
      args: [],
    );
  }

  /// `Back to Login`
  String get backToLogin {
    return Intl.message(
      'Back to Login',
      name: 'backToLogin',
      desc: '',
      args: [],
    );
  }

  /// `Email Sent!`
  String get emailSent {
    return Intl.message('Email Sent!', name: 'emailSent', desc: '', args: []);
  }

  /// `We've sent a password reset link to your email address. Please check your inbox and follow the instructions.`
  String get emailSentMessage {
    return Intl.message(
      'We\'ve sent a password reset link to your email address. Please check your inbox and follow the instructions.',
      name: 'emailSentMessage',
      desc: '',
      args: [],
    );
  }

  /// `Language`
  String get language {
    return Intl.message('Language', name: 'language', desc: '', args: []);
  }

  /// `English`
  String get english {
    return Intl.message('English', name: 'english', desc: '', args: []);
  }

  /// `French`
  String get french {
    return Intl.message('French', name: 'french', desc: '', args: []);
  }

  /// `Welcome to Business Services`
  String get welcomeToBusinessServices {
    return Intl.message(
      'Welcome to Business Services',
      name: 'welcomeToBusinessServices',
      desc: '',
      args: [],
    );
  }

  /// `Choose a service to get started`
  String get chooseServiceToStart {
    return Intl.message(
      'Choose a service to get started',
      name: 'chooseServiceToStart',
      desc: '',
      args: [],
    );
  }

  /// `Park a Car`
  String get parkACar {
    return Intl.message('Park a Car', name: 'parkACar', desc: '', args: []);
  }

  /// `Send Barrels to Guinea`
  String get sendBarrelsToGuinea {
    return Intl.message(
      'Send Barrels to Guinea',
      name: 'sendBarrelsToGuinea',
      desc: '',
      args: [],
    );
  }

  /// `Transport Cars to Guinea`
  String get transportCarsToGuinea {
    return Intl.message(
      'Transport Cars to Guinea',
      name: 'transportCarsToGuinea',
      desc: '',
      args: [],
    );
  }

  /// `Sell Cars`
  String get sellCars {
    return Intl.message('Sell Cars', name: 'sellCars', desc: '', args: []);
  }

  /// `Car Parking Service`
  String get carParkingService {
    return Intl.message(
      'Car Parking Service',
      name: 'carParkingService',
      desc: '',
      args: [],
    );
  }

  /// `Enter car details to generate receipt`
  String get enterCarDetailsToGenerateReceipt {
    return Intl.message(
      'Enter car details to generate receipt',
      name: 'enterCarDetailsToGenerateReceipt',
      desc: '',
      args: [],
    );
  }

  /// `Print Receipt`
  String get printReceipt {
    return Intl.message(
      'Print Receipt',
      name: 'printReceipt',
      desc: '',
      args: [],
    );
  }

  /// `Name`
  String get name {
    return Intl.message('Name', name: 'name', desc: '', args: []);
  }

  /// `Make`
  String get make {
    return Intl.message('Make', name: 'make', desc: '', args: []);
  }

  /// `Model`
  String get model {
    return Intl.message('Model', name: 'model', desc: '', args: []);
  }

  /// `Year`
  String get year {
    return Intl.message('Year', name: 'year', desc: '', args: []);
  }

  /// `VIN Number`
  String get vinNumber {
    return Intl.message('VIN Number', name: 'vinNumber', desc: '', args: []);
  }

  /// `Parking Date`
  String get parkingDate {
    return Intl.message(
      'Parking Date',
      name: 'parkingDate',
      desc: '',
      args: [],
    );
  }

  /// `Barrel Shipping Service`
  String get barrelShippingService {
    return Intl.message(
      'Barrel Shipping Service',
      name: 'barrelShippingService',
      desc: '',
      args: [],
    );
  }

  /// `Enter shipping details for Guinea`
  String get enterShippingDetailsForGuinea {
    return Intl.message(
      'Enter shipping details for Guinea',
      name: 'enterShippingDetailsForGuinea',
      desc: '',
      args: [],
    );
  }

  /// `Submit`
  String get submit {
    return Intl.message('Submit', name: 'submit', desc: '', args: []);
  }

  /// `Sender Name`
  String get senderName {
    return Intl.message('Sender Name', name: 'senderName', desc: '', args: []);
  }

  /// `Address`
  String get address {
    return Intl.message('Address', name: 'address', desc: '', args: []);
  }

  /// `Receiver Name`
  String get receiverName {
    return Intl.message(
      'Receiver Name',
      name: 'receiverName',
      desc: '',
      args: [],
    );
  }

  /// `Receiver Phone`
  String get receiverPhone {
    return Intl.message(
      'Receiver Phone',
      name: 'receiverPhone',
      desc: '',
      args: [],
    );
  }

  /// `Price`
  String get price {
    return Intl.message('Price', name: 'price', desc: '', args: []);
  }

  /// `Car Transport Service`
  String get carTransportService {
    return Intl.message(
      'Car Transport Service',
      name: 'carTransportService',
      desc: '',
      args: [],
    );
  }

  /// `Enter car transport details for Guinea`
  String get enterCarTransportDetailsForGuinea {
    return Intl.message(
      'Enter car transport details for Guinea',
      name: 'enterCarTransportDetailsForGuinea',
      desc: '',
      args: [],
    );
  }

  /// `Owner Name`
  String get ownerName {
    return Intl.message('Owner Name', name: 'ownerName', desc: '', args: []);
  }

  /// `Car Make`
  String get carMake {
    return Intl.message('Car Make', name: 'carMake', desc: '', args: []);
  }

  /// `Car Model`
  String get carModel {
    return Intl.message('Car Model', name: 'carModel', desc: '', args: []);
  }

  /// `Car Year`
  String get carYear {
    return Intl.message('Car Year', name: 'carYear', desc: '', args: []);
  }

  /// `Transport Date`
  String get transportDate {
    return Intl.message(
      'Transport Date',
      name: 'transportDate',
      desc: '',
      args: [],
    );
  }

  /// `Car Sales Service`
  String get carSalesService {
    return Intl.message(
      'Car Sales Service',
      name: 'carSalesService',
      desc: '',
      args: [],
    );
  }

  /// `Browse available cars for sale`
  String get browseAvailableCarsForSale {
    return Intl.message(
      'Browse available cars for sale',
      name: 'browseAvailableCarsForSale',
      desc: '',
      args: [],
    );
  }

  /// `Search cars...`
  String get searchCars {
    return Intl.message(
      'Search cars...',
      name: 'searchCars',
      desc: '',
      args: [],
    );
  }

  /// `Chat with Seller`
  String get chatWithSeller {
    return Intl.message(
      'Chat with Seller',
      name: 'chatWithSeller',
      desc: '',
      args: [],
    );
  }

  /// `Toyota Camry`
  String get toyotaCamry {
    return Intl.message(
      'Toyota Camry',
      name: 'toyotaCamry',
      desc: '',
      args: [],
    );
  }

  /// `Honda Accord`
  String get hondaAccord {
    return Intl.message(
      'Honda Accord',
      name: 'hondaAccord',
      desc: '',
      args: [],
    );
  }

  /// `Ford Escape`
  String get fordEscape {
    return Intl.message('Ford Escape', name: 'fordEscape', desc: '', args: []);
  }

  /// `Year: {year}`
  String yearLabel(Object year) {
    return Intl.message(
      'Year: $year',
      name: 'yearLabel',
      desc: '',
      args: [year],
    );
  }

  /// `Mileage: {mileage}`
  String mileageLabel(Object mileage) {
    return Intl.message(
      'Mileage: $mileage',
      name: 'mileageLabel',
      desc: '',
      args: [mileage],
    );
  }

  /// `mileage`
  String get mileage {
    return Intl.message('mileage', name: 'mileage', desc: '', args: []);
  }

  /// `Car Details`
  String get carDetails {
    return Intl.message('Car Details', name: 'carDetails', desc: '', args: []);
  }

  /// `Contact Seller`
  String get contactSeller {
    return Intl.message(
      'Contact Seller',
      name: 'contactSeller',
      desc: '',
      args: [],
    );
  }

  /// `View More Photos`
  String get viewMorePhotos {
    return Intl.message(
      'View More Photos',
      name: 'viewMorePhotos',
      desc: '',
      args: [],
    );
  }

  /// `Car Description`
  String get carDescription {
    return Intl.message(
      'Car Description',
      name: 'carDescription',
      desc: '',
      args: [],
    );
  }

  /// `Features`
  String get features {
    return Intl.message('Features', name: 'features', desc: '', args: []);
  }

  /// `Contact Information`
  String get contactInfo {
    return Intl.message(
      'Contact Information',
      name: 'contactInfo',
      desc: '',
      args: [],
    );
  }

  /// `Send WhatsApp Message`
  String get sendWhatsAppMessage {
    return Intl.message(
      'Send WhatsApp Message',
      name: 'sendWhatsAppMessage',
      desc: '',
      args: [],
    );
  }

  /// `Hi! I'm interested in the {carTitle} ({carYear}) for {carPrice}. Can you provide more details?`
  String whatsAppMessage(Object carTitle, Object carYear, Object carPrice) {
    return Intl.message(
      'Hi! I\'m interested in the $carTitle ($carYear) for $carPrice. Can you provide more details?',
      name: 'whatsAppMessage',
      desc: '',
      args: [carTitle, carYear, carPrice],
    );
  }

  /// `No results found`
  String get noResultsFound {
    return Intl.message(
      'No results found',
      name: 'noResultsFound',
      desc: '',
      args: [],
    );
  }

  /// `Try a different search term`
  String get tryDifferentSearch {
    return Intl.message(
      'Try a different search term',
      name: 'tryDifferentSearch',
      desc: '',
      args: [],
    );
  }
}

class AppLocalizationDelegate extends LocalizationsDelegate<S> {
  const AppLocalizationDelegate();

  List<Locale> get supportedLocales {
    return const <Locale>[
      Locale.fromSubtags(languageCode: 'en'),
      Locale.fromSubtags(languageCode: 'fr'),
    ];
  }

  @override
  bool isSupported(Locale locale) => _isSupported(locale);
  @override
  Future<S> load(Locale locale) => S.load(locale);
  @override
  bool shouldReload(AppLocalizationDelegate old) => false;

  bool _isSupported(Locale locale) {
    for (var supportedLocale in supportedLocales) {
      if (supportedLocale.languageCode == locale.languageCode) {
        return true;
      }
    }
    return false;
  }
}
