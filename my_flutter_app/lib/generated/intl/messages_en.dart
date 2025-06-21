// DO NOT EDIT. This is code generated via package:intl/generate_localized.dart
// This is a library that provides messages for a en locale. All the
// messages from the main program should be duplicated here with the same
// function name.

// Ignore issues from commonly used lints in this file.
// ignore_for_file:unnecessary_brace_in_string_interps, unnecessary_new
// ignore_for_file:prefer_single_quotes,comment_references, directives_ordering
// ignore_for_file:annotate_overrides,prefer_generic_function_type_aliases
// ignore_for_file:unused_import, file_names, avoid_escaping_inner_quotes
// ignore_for_file:unnecessary_string_interpolations, unnecessary_string_escapes

import 'package:intl/intl.dart';
import 'package:intl/message_lookup_by_library.dart';

final messages = new MessageLookup();

typedef String MessageIfAbsent(String messageStr, List<dynamic> args);

class MessageLookup extends MessageLookupByLibrary {
  String get localeName => 'en';

  static String m0(error) => "Error generating receipt: ${error}";

  static String m1(mileage) => "Mileage: ${mileage}";

  static String m2(carTitle, carYear, carPrice) =>
      "Hi! I\'m interested in the ${carTitle} (${carYear}) for ${carPrice}. Can you provide more details?";

  static String m3(year) => "Year: ${year}";

  final messages = _notInlinedMessages(_notInlinedMessages);
  static Map<String, Function> _notInlinedMessages(_) => <String, Function>{
    "about": MessageLookupByLibrary.simpleMessage("About"),
    "accessStaffFeatures": MessageLookupByLibrary.simpleMessage(
      "Access staff features and management tools",
    ),
    "account": MessageLookupByLibrary.simpleMessage("Account"),
    "active": MessageLookupByLibrary.simpleMessage("Active"),
    "activeCars": MessageLookupByLibrary.simpleMessage("Active Cars"),
    "add": MessageLookupByLibrary.simpleMessage("Add"),
    "addNewCar": MessageLookupByLibrary.simpleMessage("Add New Car"),
    "address": MessageLookupByLibrary.simpleMessage("Address"),
    "appInformation": MessageLookupByLibrary.simpleMessage("App Information"),
    "appVersion": MessageLookupByLibrary.simpleMessage("App Version"),
    "backToCustomerHome": MessageLookupByLibrary.simpleMessage(
      "Back to Customer Home",
    ),
    "backToLogin": MessageLookupByLibrary.simpleMessage("Back to Login"),
    "barrelShippingService": MessageLookupByLibrary.simpleMessage(
      "Barrel Shipping Service",
    ),
    "browseAvailableCarsForSale": MessageLookupByLibrary.simpleMessage(
      "Browse available cars for sale",
    ),
    "cancel": MessageLookupByLibrary.simpleMessage("Cancel"),
    "carDescription": MessageLookupByLibrary.simpleMessage("Car Description"),
    "carDetails": MessageLookupByLibrary.simpleMessage("Car Details"),
    "carMake": MessageLookupByLibrary.simpleMessage("Car Make"),
    "carModel": MessageLookupByLibrary.simpleMessage("Car Model"),
    "carParkingService": MessageLookupByLibrary.simpleMessage(
      "Car Parking Service",
    ),
    "carSalesService": MessageLookupByLibrary.simpleMessage(
      "Car Sales Service",
    ),
    "carTitle": MessageLookupByLibrary.simpleMessage("Car Title"),
    "carTransportService": MessageLookupByLibrary.simpleMessage(
      "Car Transport Service",
    ),
    "carYear": MessageLookupByLibrary.simpleMessage("Car Year"),
    "chatWithSeller": MessageLookupByLibrary.simpleMessage("Chat with Seller"),
    "chooseServiceToStart": MessageLookupByLibrary.simpleMessage(
      "Choose a service to get started",
    ),
    "companyName": MessageLookupByLibrary.simpleMessage("Company Name"),
    "contactInfo": MessageLookupByLibrary.simpleMessage("Contact Information"),
    "contactSeller": MessageLookupByLibrary.simpleMessage("Contact Seller"),
    "contactUs": MessageLookupByLibrary.simpleMessage("Contact Us"),
    "customer": MessageLookupByLibrary.simpleMessage("Customer"),
    "done": MessageLookupByLibrary.simpleMessage("Done"),
    "email": MessageLookupByLibrary.simpleMessage("Email"),
    "emailAddress": MessageLookupByLibrary.simpleMessage("Email Address"),
    "emailSent": MessageLookupByLibrary.simpleMessage("Email Sent!"),
    "emailSentMessage": MessageLookupByLibrary.simpleMessage(
      "We\'ve sent a password reset link to your email address. Please check your inbox and follow the instructions.",
    ),
    "english": MessageLookupByLibrary.simpleMessage("English"),
    "enterCarDetailsToGenerateReceipt": MessageLookupByLibrary.simpleMessage(
      "Enter car details to generate receipt",
    ),
    "enterCarTransportDetailsForGuinea": MessageLookupByLibrary.simpleMessage(
      "Enter car transport details for Guinea",
    ),
    "enterEmail": MessageLookupByLibrary.simpleMessage("Enter your email"),
    "enterEmailToReset": MessageLookupByLibrary.simpleMessage(
      "Enter your email to reset your password",
    ),
    "enterPassword": MessageLookupByLibrary.simpleMessage(
      "Enter your password",
    ),
    "enterShippingDetailsForGuinea": MessageLookupByLibrary.simpleMessage(
      "Enter shipping details for Guinea",
    ),
    "errorGeneratingReceipt": m0,
    "features": MessageLookupByLibrary.simpleMessage("Features"),
    "fordEscape": MessageLookupByLibrary.simpleMessage("Ford Escape"),
    "forgotPassword": MessageLookupByLibrary.simpleMessage("Forgot Password?"),
    "forgotPasswordTitle": MessageLookupByLibrary.simpleMessage(
      "Forgot Password?",
    ),
    "french": MessageLookupByLibrary.simpleMessage("French"),
    "home": MessageLookupByLibrary.simpleMessage("Home"),
    "hondaAccord": MessageLookupByLibrary.simpleMessage("Honda Accord"),
    "inactive": MessageLookupByLibrary.simpleMessage("Inactive"),
    "inactiveCars": MessageLookupByLibrary.simpleMessage("Inactive Cars"),
    "invalidCredentials": MessageLookupByLibrary.simpleMessage(
      "Invalid email or password",
    ),
    "language": MessageLookupByLibrary.simpleMessage("Language"),
    "logout": MessageLookupByLibrary.simpleMessage("Logout"),
    "make": MessageLookupByLibrary.simpleMessage("Make"),
    "manageCars": MessageLookupByLibrary.simpleMessage("Manage Cars"),
    "mileage": MessageLookupByLibrary.simpleMessage("mileage"),
    "mileageLabel": m1,
    "model": MessageLookupByLibrary.simpleMessage("Model"),
    "name": MessageLookupByLibrary.simpleMessage("Name"),
    "noResultsFound": MessageLookupByLibrary.simpleMessage("No results found"),
    "ownerName": MessageLookupByLibrary.simpleMessage("Owner Name"),
    "parkACar": MessageLookupByLibrary.simpleMessage("Park a Car"),
    "parkingDate": MessageLookupByLibrary.simpleMessage("Parking Date"),
    "parkingDateTime": MessageLookupByLibrary.simpleMessage(
      "Parking Date & Time",
    ),
    "password": MessageLookupByLibrary.simpleMessage("Password"),
    "passwordMinLength": MessageLookupByLibrary.simpleMessage(
      "Password must be at least 6 characters",
    ),
    "phoneNumber": MessageLookupByLibrary.simpleMessage("Phone Number"),
    "pleaseEnterCarMake": MessageLookupByLibrary.simpleMessage(
      "Please enter the car make",
    ),
    "pleaseEnterCarModel": MessageLookupByLibrary.simpleMessage(
      "Please enter the car model",
    ),
    "pleaseEnterCarYear": MessageLookupByLibrary.simpleMessage(
      "Please enter the car year",
    ),
    "pleaseEnterEmail": MessageLookupByLibrary.simpleMessage(
      "Please enter your email",
    ),
    "pleaseEnterOwnerName": MessageLookupByLibrary.simpleMessage(
      "Please enter the owner name",
    ),
    "pleaseEnterPassword": MessageLookupByLibrary.simpleMessage(
      "Please enter your password",
    ),
    "pleaseEnterValidEmail": MessageLookupByLibrary.simpleMessage(
      "Please enter a valid email",
    ),
    "pleaseEnterVinNumber": MessageLookupByLibrary.simpleMessage(
      "Please enter the VIN number",
    ),
    "price": MessageLookupByLibrary.simpleMessage("Price"),
    "printReceipt": MessageLookupByLibrary.simpleMessage("Print Receipt"),
    "privacyPolicy": MessageLookupByLibrary.simpleMessage("Privacy Policy"),
    "receiptGenerated": MessageLookupByLibrary.simpleMessage(
      "Receipt generated and sent to printer successfully!",
    ),
    "receiverName": MessageLookupByLibrary.simpleMessage("Receiver Name"),
    "receiverPhone": MessageLookupByLibrary.simpleMessage("Receiver Phone"),
    "resetPassword": MessageLookupByLibrary.simpleMessage("Reset Password"),
    "role": MessageLookupByLibrary.simpleMessage("Role"),
    "searchCars": MessageLookupByLibrary.simpleMessage("Search cars..."),
    "selectDateTime": MessageLookupByLibrary.simpleMessage(
      "Select Date & Time",
    ),
    "sellCars": MessageLookupByLibrary.simpleMessage("Sell Cars"),
    "sendBarrelsToGuinea": MessageLookupByLibrary.simpleMessage(
      "Send Barrels to Guinea",
    ),
    "sendWhatsAppMessage": MessageLookupByLibrary.simpleMessage(
      "Send WhatsApp Message",
    ),
    "senderName": MessageLookupByLibrary.simpleMessage("Sender Name"),
    "settings": MessageLookupByLibrary.simpleMessage("Settings"),
    "signIn": MessageLookupByLibrary.simpleMessage("Sign In"),
    "signInToAccount": MessageLookupByLibrary.simpleMessage(
      "Sign in to your account",
    ),
    "signOutOfAccount": MessageLookupByLibrary.simpleMessage(
      "Sign out of your account",
    ),
    "staff": MessageLookupByLibrary.simpleMessage("Staff"),
    "staffAccess": MessageLookupByLibrary.simpleMessage("Staff Access"),
    "staffLogin": MessageLookupByLibrary.simpleMessage("Staff Login"),
    "submit": MessageLookupByLibrary.simpleMessage("Submit"),
    "termsOfService": MessageLookupByLibrary.simpleMessage("Terms of Service"),
    "totalCars": MessageLookupByLibrary.simpleMessage("Total Cars"),
    "toyotaCamry": MessageLookupByLibrary.simpleMessage("Toyota Camry"),
    "trackShipment": MessageLookupByLibrary.simpleMessage("Track Shipment"),
    "tracking": MessageLookupByLibrary.simpleMessage("Tracking"),
    "transportCarsToGuinea": MessageLookupByLibrary.simpleMessage(
      "Transport Cars to Guinea",
    ),
    "transportDate": MessageLookupByLibrary.simpleMessage("Transport Date"),
    "tryDifferentSearch": MessageLookupByLibrary.simpleMessage(
      "Try a different search term",
    ),
    "viewMorePhotos": MessageLookupByLibrary.simpleMessage("View More Photos"),
    "vinNumber": MessageLookupByLibrary.simpleMessage("VIN Number"),
    "welcomeBack": MessageLookupByLibrary.simpleMessage("Welcome Back"),
    "welcomeToBusinessServices": MessageLookupByLibrary.simpleMessage(
      "Welcome to Business Services",
    ),
    "whatsAppMessage": m2,
    "year": MessageLookupByLibrary.simpleMessage("Year"),
    "yearLabel": m3,
  };
}
