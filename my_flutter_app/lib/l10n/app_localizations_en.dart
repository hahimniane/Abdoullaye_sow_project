// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get welcomeBack => 'Welcome Back';

  @override
  String get signInToAccount => 'Sign in to your account';

  @override
  String get email => 'Email';

  @override
  String get enterEmail => 'Enter your email';

  @override
  String get password => 'Password';

  @override
  String get enterPassword => 'Enter your password';

  @override
  String get signIn => 'Sign In';

  @override
  String get forgotPassword => 'Forgot Password?';

  @override
  String get pleaseEnterEmail => 'Please enter your email';

  @override
  String get pleaseEnterValidEmail => 'Please enter a valid email';

  @override
  String get pleaseEnterPassword => 'Please enter your password';

  @override
  String get passwordMinLength => 'Password must be at least 6 characters';

  @override
  String get forgotPasswordTitle => 'Forgot Password?';

  @override
  String get enterEmailToReset => 'Enter your email to reset your password';

  @override
  String get resetPassword => 'Reset Password';

  @override
  String get backToLogin => 'Back to Login';

  @override
  String get emailSent => 'Email Sent!';

  @override
  String get emailSentMessage => 'We\'ve sent a password reset link to your email address. Please check your inbox and follow the instructions.';

  @override
  String get language => 'Language';

  @override
  String get english => 'English';

  @override
  String get french => 'French';

  @override
  String get welcomeToBusinessServices => 'Welcome to Business Services';

  @override
  String get chooseServiceToStart => 'Choose a service to get started';

  @override
  String get parkACar => 'Park a Car';

  @override
  String get sendBarrelsToGuinea => 'Send Barrels to Guinea';

  @override
  String get transportCarsToGuinea => 'Transport Cars to Guinea';

  @override
  String get sellCars => 'Sell Cars';

  @override
  String get carParkingService => 'Car Parking Service';

  @override
  String get enterCarDetailsToGenerateReceipt => 'Enter car details to generate receipt';

  @override
  String get printReceipt => 'Print Receipt';

  @override
  String get name => 'Name';

  @override
  String get make => 'Make';

  @override
  String get model => 'Model';

  @override
  String get year => 'Year';

  @override
  String get vinNumber => 'VIN Number';

  @override
  String get parkingDate => 'Parking Date';

  @override
  String get parkingDateTime => 'Parking Date & Time';

  @override
  String get selectDateTime => 'Select Date & Time';

  @override
  String get receiptGenerated => 'Receipt generated and sent to printer successfully!';

  @override
  String errorGeneratingReceipt(Object error) {
    return 'Error generating receipt: $error';
  }

  @override
  String get pleaseEnterOwnerName => 'Please enter the owner name';

  @override
  String get pleaseEnterCarMake => 'Please enter the car make';

  @override
  String get pleaseEnterCarModel => 'Please enter the car model';

  @override
  String get pleaseEnterCarYear => 'Please enter the car year';

  @override
  String get pleaseEnterVinNumber => 'Please enter the VIN number';

  @override
  String get done => 'Done';

  @override
  String get account => 'Account';

  @override
  String get role => 'Role';

  @override
  String get logout => 'Logout';

  @override
  String get signOutOfAccount => 'Sign out of your account';

  @override
  String get customer => 'Customer';

  @override
  String get staff => 'Staff';

  @override
  String get barrelShippingService => 'Barrel Shipping Service';

  @override
  String get enterShippingDetailsForGuinea => 'Enter shipping details for Guinea';

  @override
  String get submit => 'Submit';

  @override
  String get senderName => 'Sender Name';

  @override
  String get address => 'Address';

  @override
  String get receiverName => 'Receiver Name';

  @override
  String get receiverPhone => 'Receiver Phone';

  @override
  String get price => 'Price';

  @override
  String get carTransportService => 'Car Transport Service';

  @override
  String get enterCarTransportDetailsForGuinea => 'Enter car transport details for Guinea';

  @override
  String get ownerName => 'Owner Name';

  @override
  String get carMake => 'Car Make';

  @override
  String get carModel => 'Car Model';

  @override
  String get carYear => 'Car Year';

  @override
  String get transportDate => 'Transport Date';

  @override
  String get carSalesService => 'Car Sales Service';

  @override
  String get browseAvailableCarsForSale => 'Browse available cars for sale';

  @override
  String get searchCars => 'Search cars...';

  @override
  String get chatWithSeller => 'Chat with Seller';

  @override
  String get toyotaCamry => 'Toyota Camry';

  @override
  String get hondaAccord => 'Honda Accord';

  @override
  String get fordEscape => 'Ford Escape';

  @override
  String yearLabel(Object year) {
    return 'Year: $year';
  }

  @override
  String mileageLabel(Object mileage) {
    return 'Mileage: $mileage';
  }

  @override
  String get mileage => 'mileage';

  @override
  String get carDetails => 'Car Details';

  @override
  String get contactSeller => 'Contact Seller';

  @override
  String get viewMorePhotos => 'View More Photos';

  @override
  String get carDescription => 'Car Description';

  @override
  String get features => 'Features';

  @override
  String get contactInfo => 'Contact Information';

  @override
  String get sendWhatsAppMessage => 'Send WhatsApp Message';

  @override
  String whatsAppMessage(Object carPrice, Object carTitle, Object carYear) {
    return 'Hi! I\'m interested in the $carTitle ($carYear) for $carPrice. Can you provide more details?';
  }

  @override
  String get noResultsFound => 'No results found';

  @override
  String get tryDifferentSearch => 'Try a different search term';

  @override
  String get home => 'Home';

  @override
  String get settings => 'Settings';

  @override
  String get appInformation => 'App Information';

  @override
  String get appVersion => 'App Version';

  @override
  String get companyName => 'Company Name';

  @override
  String get contactUs => 'Contact Us';

  @override
  String get phoneNumber => 'Phone Number';

  @override
  String get emailAddress => 'Email Address';

  @override
  String get about => 'About';

  @override
  String get privacyPolicy => 'Privacy Policy';

  @override
  String get termsOfService => 'Terms of Service';

  @override
  String get manageCars => 'Manage Cars';

  @override
  String get totalCars => 'Total Cars';

  @override
  String get activeCars => 'Active Cars';

  @override
  String get inactiveCars => 'Inactive Cars';

  @override
  String get active => 'Active';

  @override
  String get inactive => 'Inactive';

  @override
  String get addNewCar => 'Add New Car';

  @override
  String get carTitle => 'Car Title';

  @override
  String get cancel => 'Cancel';

  @override
  String get add => 'Add';

  @override
  String get staffAccess => 'Staff Access';

  @override
  String get staffLogin => 'Staff Login';

  @override
  String get accessStaffFeatures => 'Access staff features and management tools';

  @override
  String get invalidCredentials => 'Invalid email or password';

  @override
  String get backToCustomerHome => 'Back to Customer Home';

  @override
  String get trackShipment => 'Track Shipment';

  @override
  String get tracking => 'Tracking';

  @override
  String get userManagement => 'User Management';

  @override
  String get setAsCustomer => 'Set as Customer';

  @override
  String get setAsStaff => 'Set as Staff';

  @override
  String get setAsAdmin => 'Set as Admin';

  @override
  String get addStaffMember => 'Add Staff Member';

  @override
  String get users => 'Users';

  @override
  String get noUsersFound => 'No users found.';

  @override
  String get enterStaffEmail => 'Enter staff email';

  @override
  String get enterTemporaryPassword => 'Enter temporary password';

  @override
  String userRoleUpdated(String newRole) {
    return 'User role updated to $newRole';
  }

  @override
  String failedToUpdateUserRole(String error) {
    return 'Failed to update user role: $error';
  }

  @override
  String get staffMemberAddedSuccessfully => 'Staff member added successfully!';

  @override
  String failedToAddStaffMember(String error) {
    return 'Failed to add staff member: $error';
  }

  @override
  String get admin => 'Admin';
}
