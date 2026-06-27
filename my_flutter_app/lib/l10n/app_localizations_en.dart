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
  String get accountLoginTitle => 'Account Login';

  @override
  String get accountLoginSubtitle =>
      'Sign in to access saved receipts, track activity, and manage staff tools.';

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
  String get emailSentMessage =>
      'We\'ve sent a password reset link to your email address. Please check your inbox and follow the instructions.';

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
  String get servicesTab => 'Services';

  @override
  String get activityTab => 'Activity';

  @override
  String get serviceOverview => 'Service Overview';

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
  String get enterCarDetailsToGenerateReceipt =>
      'Enter car details to generate receipt';

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
  String get scanVin => 'Scan VIN';

  @override
  String get decodeVin => 'Decode VIN';

  @override
  String get scanVinText => 'Scan VIN text';

  @override
  String get scanVinInstructions =>
      'Align the VIN barcode inside the frame. If there is no barcode, use text scan.';

  @override
  String get useManualEntry => 'Use manual entry';

  @override
  String get vinScanNoResult =>
      'No VIN was found. Try again or enter it manually.';

  @override
  String get vinScanFailed =>
      'VIN scan failed. Try again or enter it manually.';

  @override
  String get vinCameraUnavailable =>
      'Camera is unavailable. You can still enter the VIN manually.';

  @override
  String get invalidVinNumber =>
      'Enter a valid 17-character VIN without I, O, or Q.';

  @override
  String get vinDecodeFailed =>
      'VIN could not be decoded. You can still enter the vehicle details manually.';

  @override
  String get vinDecoded => 'VIN decoded.';

  @override
  String vinDecodedVehicle(Object vehicle) {
    return 'VIN decoded: $vehicle';
  }

  @override
  String get vinMatchReview =>
      'Review the decoded details and complete any fields that did not match the catalog.';

  @override
  String get decodedVinDetails => 'Decoded VIN details';

  @override
  String get vehicle => 'Vehicle';

  @override
  String get bodyStyle => 'Body style';

  @override
  String get engine => 'Engine';

  @override
  String get parkingDate => 'Parking Date';

  @override
  String get parkingDateTime => 'Parking Date & Time';

  @override
  String get selectDateTime => 'Select Date & Time';

  @override
  String get receiptGenerated =>
      'Receipt generated and sent to printer successfully!';

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
  String get pleaseEnterSenderName => 'Please enter the sender name';

  @override
  String get pleaseEnterSenderAddress => 'Please enter the sender address';

  @override
  String get pleaseEnterReceiverName => 'Please enter the receiver name';

  @override
  String get pleaseEnterReceiverPhone =>
      'Please enter the receiver phone number';

  @override
  String get pleaseEnterPrice => 'Please enter the price';

  @override
  String get pleaseEnterValidNumber => 'Please enter a valid number';

  @override
  String shipmentSavedWithTracking(Object trackingCode) {
    return 'Shipment saved. Tracking number: $trackingCode';
  }

  @override
  String failedToSaveShipment(Object error) {
    return 'Failed to save shipment: $error';
  }

  @override
  String parkingSavedWithTracking(Object trackingCode) {
    return 'Parking record saved. Tracking number: $trackingCode';
  }

  @override
  String get barrelShipmentDetails => 'Barrel Shipment Details';

  @override
  String get senderInformation => 'Sender Information';

  @override
  String get receiverInformation => 'Receiver Information';

  @override
  String get shipmentSummary => 'Shipment Summary';

  @override
  String get createdOnLabel => 'Created on';

  @override
  String get statusLabel => 'Status';

  @override
  String get updateShipment => 'Update Shipment';

  @override
  String get reprintReceipt => 'Reprint Receipt';

  @override
  String get shipmentUpdatedSuccessfully => 'Shipment updated successfully!';

  @override
  String failedToUpdateShipment(Object error) {
    return 'Failed to update shipment: $error';
  }

  @override
  String get trackingNumber => 'Tracking Number';

  @override
  String get trackingNumberCopied => 'Tracking number copied to clipboard';

  @override
  String get shipmentStatusPending => 'Pending';

  @override
  String get shipmentStatusInTransit => 'In Transit';

  @override
  String get shipmentStatusCompleted => 'Completed';

  @override
  String get shipmentStatusCompletedNotice =>
      'This shipment is marked as completed and can no longer be edited.';

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
  String get accountOptionalMessage =>
      'Create an optional account to save receipts and sync your activity across devices.';

  @override
  String get customer => 'Customer';

  @override
  String get staff => 'Staff';

  @override
  String get barrelShippingService => 'Barrel Shipping Service';

  @override
  String get enterShippingDetailsForGuinea =>
      'Enter shipping details for Guinea';

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
  String get enterCarTransportDetailsForGuinea =>
      'Enter car transport details for Guinea';

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
  String get availableCars => 'Available Cars';

  @override
  String get browsePurchaseReserve =>
      'Browse inventory, reserve a viewing time, or buy directly from the app.';

  @override
  String get inStock => 'In stock';

  @override
  String get viewings => 'Viewings';

  @override
  String get byAppointment => 'By appointment';

  @override
  String get filters => 'Filters';

  @override
  String get clearFilters => 'Clear';

  @override
  String get applyFilters => 'Apply Filters';

  @override
  String filteredResults(Object count) {
    return '$count filters active';
  }

  @override
  String get yearRange => 'Year range';

  @override
  String get minYear => 'Min year';

  @override
  String get maxYear => 'Max year';

  @override
  String get maxPrice => 'Max price';

  @override
  String get sortBy => 'Sort by';

  @override
  String get newestYear => 'Newest year';

  @override
  String get oldestYear => 'Oldest year';

  @override
  String get priceLowToHigh => 'Price: low to high';

  @override
  String get priceHighToLow => 'Price: high to low';

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
  String get navHome => 'Home';

  @override
  String get navCars => 'Cars';

  @override
  String get navBarrels => 'Barrels';

  @override
  String get navPurchases => 'Purchases';

  @override
  String get navTracking => 'Tracking';

  @override
  String get navBusiness => 'Business';

  @override
  String get navUsers => 'Users';

  @override
  String get navSettings => 'Settings';

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
  String get recentActivity => 'Recent Activity';

  @override
  String get filterAll => 'All';

  @override
  String get filterParking => 'Parked Cars';

  @override
  String get filterBarrels => 'Barrel Shipments';

  @override
  String get filterTransport => 'Car Transport';

  @override
  String get filterSales => 'Car Sales';

  @override
  String get totalCars => 'Total Cars';

  @override
  String get activeCars => 'Active cars';

  @override
  String get inactiveCars => 'Inactive Cars';

  @override
  String get processing => 'Processing';

  @override
  String get completed => 'Completed';

  @override
  String get noRecordsYet =>
      'No records yet. Start logging activities to see them here.';

  @override
  String get recordReference => 'Reference';

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
  String get setAsCustomer => 'Set as customer';

  @override
  String get setAsStaff => 'Set as staff';

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
  String userRoleUpdated(Object role) {
    return 'User role updated to $role';
  }

  @override
  String failedToUpdateUserRole(Object error) {
    return 'Failed to update user role: $error';
  }

  @override
  String get deleteUser => 'Delete user';

  @override
  String get confirmDeletion => 'Confirm Deletion';

  @override
  String confirmDeleteUser(Object email) {
    return 'Are you sure you want to delete the user $email?';
  }

  @override
  String get delete => 'Delete';

  @override
  String userDeleted(Object email) {
    return 'User $email deleted successfully';
  }

  @override
  String failedToDeleteUser(Object error) {
    return 'Failed to delete user: $error';
  }

  @override
  String get staffMemberAddedSuccessfully => 'Staff member added successfully!';

  @override
  String failedToAddStaffMember(String error) {
    return 'Failed to add staff member: $error';
  }

  @override
  String get admin => 'Admin';

  @override
  String get signUp => 'Sign Up';

  @override
  String get createAccount => 'Create Account';

  @override
  String get signUpToGetStarted =>
      'Create a free account with the details we need to reserve viewings and record purchases.';

  @override
  String get fullName => 'Full Name';

  @override
  String get enterFullName => 'Enter your full name';

  @override
  String get pleaseEnterFullName => 'Please enter your full name';

  @override
  String get enterPhoneNumber => 'Enter your phone number';

  @override
  String get pleaseEnterPhoneNumber => 'Please enter a valid phone number';

  @override
  String get confirmPassword => 'Confirm Password';

  @override
  String get reEnterPassword => 'Re-enter your password';

  @override
  String get pleaseConfirmPassword => 'Please confirm your password';

  @override
  String get passwordsDoNotMatch => 'Passwords do not match';

  @override
  String get alreadyHaveAccount => 'Already have an account?';

  @override
  String get dontHaveAccount => 'Don\'t have an account?';

  @override
  String get accountCreatedSuccessfully => 'Account created successfully!';

  @override
  String transportRequestSavedWithTracking(Object trackingCode) {
    return 'Transport request saved with tracking code: $trackingCode';
  }

  @override
  String failedToSaveTransport(Object error) {
    return 'Failed to save transport request: $error';
  }

  @override
  String get transportUpdatedSuccessfully =>
      'Transport request updated successfully!';

  @override
  String failedToUpdateTransport(Object error) {
    return 'Failed to update transport request: $error';
  }

  @override
  String get updateTransport => 'Update Transport';

  @override
  String get transportStatusCompletedNotice =>
      'This transport request is marked as completed and can no longer be edited.';

  @override
  String get transportRequestDetails => 'Car Transport Details';

  @override
  String operationFailed(Object error) {
    return 'Something went wrong: $error';
  }

  @override
  String get activate => 'Activate';

  @override
  String get deactivate => 'Deactivate';

  @override
  String get activateSuccess => 'Car status set to active.';

  @override
  String get deactivateSuccess => 'Car status set to inactive.';

  @override
  String get carCreated => 'Car added successfully!';

  @override
  String get carUpdated => 'Car updated successfully!';

  @override
  String get saleRecorded => 'Sale information saved.';

  @override
  String get requiredField => 'This field is required';

  @override
  String get soldCars => 'Sold Cars';

  @override
  String get markAsSold => 'Mark as Sold';

  @override
  String get sold => 'Sold';

  @override
  String get carMileage => 'Mileage';

  @override
  String get sellingPrice => 'Listing Price';

  @override
  String get carFeaturesHint => 'Features (comma separated)';

  @override
  String get carImagesHint => 'Image URLs (comma separated)';

  @override
  String get contactName => 'Contact Name';

  @override
  String get contactPhone => 'Contact Phone';

  @override
  String get contactEmail => 'Contact Email';

  @override
  String get saveCar => 'Save Car';

  @override
  String get updateCar => 'Update Car';

  @override
  String get editCar => 'Edit Car';

  @override
  String get addCar => 'Add Car';

  @override
  String get customerName => 'Customer Name';

  @override
  String get customerPhone => 'Customer Phone';

  @override
  String get customerEmail => 'Customer Email';

  @override
  String get customerEmailOptional => 'Customer Email (optional)';

  @override
  String get customerAddressOptional => 'Customer Address (optional)';

  @override
  String get salePrice => 'Sale Price';

  @override
  String get saleDate => 'Sale Date';

  @override
  String get additionalNotes => 'Additional Notes';

  @override
  String get confirmSale => 'Confirm Sale';

  @override
  String get noCarsFound => 'No cars yet';

  @override
  String get addYourFirstCar => 'Add your first car to get started.';

  @override
  String get noCarsAvailable => 'No cars are currently available.';

  @override
  String get checkBackSoon => 'Check back soon for new inventory.';

  @override
  String get contactUnavailable => 'Contact unavailable';

  @override
  String get noDescriptionAvailable => 'No description available.';

  @override
  String get noFeaturesAvailable => 'No features listed.';

  @override
  String get soldInfo => 'Sale Details';

  @override
  String soldTo(Object name) {
    return 'Sold to $name';
  }

  @override
  String soldOn(Object date) {
    return 'Sold on $date';
  }

  @override
  String soldPriceLabel(Object price) {
    return 'Sale price: $price';
  }

  @override
  String get imagesLabel => 'Images';

  @override
  String get addImages => 'Add Images';

  @override
  String get noImagesSelected => 'No images selected yet.';

  @override
  String get addImagesPrompt => 'Please add at least one image.';

  @override
  String get coverLabel => 'Cover';

  @override
  String get setAsCover => 'Set as cover';

  @override
  String get themeLabel => 'Appearance';

  @override
  String get darkMode => 'Dark mode';

  @override
  String get lightMode => 'Light mode';

  @override
  String get reserved => 'Reserved';

  @override
  String get reserveWithDeposit => 'Reserve with deposit';

  @override
  String get reserveWithPaidHold => 'Reserve with paid hold';

  @override
  String get loginRequiredForDeposit =>
      'Please sign in before paying a deposit.';

  @override
  String get reserveThisCar => 'Reserve this car';

  @override
  String depositSummary(Object amount) {
    return 'A refundable reservation deposit of $amount is required to hold this vehicle.';
  }

  @override
  String get payDeposit => 'Pay Deposit';

  @override
  String get reservationComplete =>
      'Deposit received. Your reservation is now active.';

  @override
  String get loginRequiredForPurchase =>
      'Please sign in before purchasing this car.';

  @override
  String get purchaseThisCar => 'Purchase this car';

  @override
  String get reserveViewing => 'Reserve a viewing';

  @override
  String get reserveViewingSummary =>
      'Choose an available time to come view this vehicle. We will hold the car for your appointment.';

  @override
  String get selectViewingTime => 'Available viewing times';

  @override
  String get selectViewingTimeRequired => 'Please select a viewing time.';

  @override
  String get confirmViewingReservation => 'Confirm Viewing';

  @override
  String viewingReservationComplete(Object time) {
    return 'Your viewing is reserved for $time.';
  }

  @override
  String get youHaveViewingReserved => 'You already reserved a viewing';

  @override
  String get currentViewingTime => 'Current viewing time';

  @override
  String get changeOrCancelViewingToBookNew =>
      'To schedule another viewing for this listing, change the current time or cancel this viewing first.';

  @override
  String get accountRequiredTitle => 'Sign in to continue';

  @override
  String get accountRequiredReserveMessage =>
      'Create an account or sign in so we can save your viewing appointment and keep the car reserved for you.';

  @override
  String get accountRequiredPurchaseMessage =>
      'Create an account or sign in so we can securely record your purchase and show it in My Purchases.';

  @override
  String get phoneRequiredForReservation => 'Phone number required to continue';

  @override
  String purchaseSummary(Object amount) {
    return 'You will pay the full vehicle price of $amount with secure checkout.';
  }

  @override
  String get secureStripeCheckout =>
      'Secure Stripe checkout. Your purchase is recorded after payment succeeds.';

  @override
  String get payNow => 'Pay Now';

  @override
  String get purchaseComplete => 'Payment received. This car is now purchased.';

  @override
  String get checkoutUnavailable =>
      'We could not start checkout right now. Please try again in a moment.';

  @override
  String get carAlreadyReserved =>
      'This car already has an active reservation.';

  @override
  String get carNoLongerAvailable => 'This car is no longer available';

  @override
  String get destinationCountry => 'Destination Country';

  @override
  String get destinationCountriesUnavailable =>
      'Destination options are not available right now. Please try again in a moment.';

  @override
  String get sendBarrels => 'Send Barrels';

  @override
  String get enterShippingDetails => 'Enter shipping details';

  @override
  String get transportCars => 'Transport Cars';

  @override
  String get enterCarTransportDetails => 'Enter car transport details';

  @override
  String get cars => 'Cars';

  @override
  String get myPurchases => 'My Purchases';

  @override
  String get noPurchasesYet => 'No car purchases yet.';

  @override
  String get purchaseHistoryUnavailable =>
      'We could not load your purchase history right now. Please try again after your account finishes syncing.';

  @override
  String depositPaid(Object amount, Object status) {
    return 'Payment: $amount ($status)';
  }

  @override
  String get purchases => 'Purchases';

  @override
  String get purchaseReservations => 'Car Purchases';

  @override
  String get purchaseUpdated => 'Purchase updated.';

  @override
  String get cancelled => 'Cancelled';

  @override
  String get refunded => 'Refunded';

  @override
  String get staffTools => 'Staff Tools';

  @override
  String get destinationCountries => 'Destination Countries';

  @override
  String get manageDestinationCountries =>
      'Manage countries available in customer forms.';

  @override
  String get countriesSeeded => 'Country catalog added.';

  @override
  String get countryName => 'Country Name';

  @override
  String get countryCode => 'Country Code';

  @override
  String get selectBusinessCountry => 'Select your business country';

  @override
  String get selectBusinessCity => 'Select your business city';

  @override
  String get selectCountryFirst => 'Select country first';

  @override
  String get seedDefaultCountries => 'Seed All Countries';

  @override
  String get save => 'Save';

  @override
  String get signOutQuestion => 'Sign out?';

  @override
  String get signOutConfirmMessage =>
      'You will need to sign in again before managing shipments, wallet money, purchases, or business tools.';

  @override
  String get confirmSignOut => 'Sign out';

  @override
  String get walletTitle => 'Wallet';

  @override
  String get walletSubtitle => 'View credits and return money to card';

  @override
  String get businesses => 'Businesses';

  @override
  String get businessesSubtitle => 'Approve and manage marketplace businesses';

  @override
  String get businessProfile => 'Business profile';

  @override
  String get businessProfileSubtitle =>
      'Manage profile, services, destinations, and team';

  @override
  String get businessAdmin => 'Business admin';

  @override
  String get chooseAtLeastOneService => 'Choose at least one service.';

  @override
  String get businessProfileSaved => 'Business profile saved.';

  @override
  String get featureBlurbRequired =>
      'Enter a short blurb under 140 characters.';

  @override
  String get featureConsentRequired => 'Consent is required before requesting.';

  @override
  String get featureLogoRequired => 'Upload a logo before requesting.';

  @override
  String get featureRequestSent => 'Featuring request sent for admin review.';

  @override
  String get featuredOnWebsite => 'Featured on the website';

  @override
  String get featureApprovedMessage =>
      'Your business is approved for public featuring.';

  @override
  String get featureRequestedMessage =>
      'Your request is waiting for admin review.';

  @override
  String get featureDefaultMessage =>
      'Request a public marketing card on Laawol Digital.';

  @override
  String featureAdminNote(Object note) {
    return 'Admin note: $note';
  }

  @override
  String get uploadLogo => 'Upload logo';

  @override
  String get changeLogo => 'Change logo';

  @override
  String get shortPublicBlurb => 'Short public blurb';

  @override
  String get shortPublicBlurbHelper => 'One sentence customers can safely see.';

  @override
  String get featureConsentLabel =>
      'I consent to this business being featured publicly.';

  @override
  String get sendingFeatureRequest => 'Sending request';

  @override
  String get requestFeaturing => 'Request featuring';

  @override
  String get noBusinessProfileAssigned => 'No business profile is assigned.';

  @override
  String get businessProfileNotFound => 'Business profile not found.';

  @override
  String get destinationsAndShippingFees => 'Destinations and shipping fees';

  @override
  String get team => 'Team';

  @override
  String get addStaffMemberButton => 'Add staff member';

  @override
  String get noTeamMembersYet => 'No team members yet.';

  @override
  String get details => 'Details';

  @override
  String get businessName => 'Business name';

  @override
  String get businessPhone => 'Business phone';

  @override
  String get businessEmail => 'Business email';

  @override
  String get website => 'Website';

  @override
  String get serviceNote => 'Service note';

  @override
  String get noServicesEnabledYet => 'No services are enabled yet.';

  @override
  String get requestReturnToCard => 'Request return to card';

  @override
  String get keepInWallet => 'Keep in wallet';

  @override
  String couldNotRequestRefund(Object error) {
    return 'Could not request refund: $error';
  }

  @override
  String get returnWalletBalance => 'Return wallet balance';

  @override
  String walletReturnMessage(Object amount) {
    return '$amount will be requested back to the original card. Your wallet balance will move into pending refund.';
  }

  @override
  String returnToCardRequested(Object amount) {
    return '$amount return to card requested.';
  }

  @override
  String get walletBusinessBlocked =>
      'Wallets are for customer refund credits. Business finance tools are available in the platform dashboard.';

  @override
  String get availableBalance => 'Available balance';

  @override
  String pendingReturnToCard(Object amount) {
    return '$amount pending return to card';
  }

  @override
  String get requestingReturn => 'Requesting return';

  @override
  String get returnMoneyToCard => 'Return money to card';

  @override
  String get walletCreditsInfoWithBalance =>
      'Wallet credits come from shipment price differences. You can keep the credit here or request it back to your original card.';

  @override
  String get walletCreditsInfoEmpty =>
      'Refund credits from future shipment changes will appear here.';

  @override
  String get activity => 'Activity';

  @override
  String get destinationRefund => 'Destination refund';

  @override
  String destinationRefundWithCode(Object trackingCode) {
    return 'Destination refund • $trackingCode';
  }

  @override
  String get returnToCardRequestedStatus => 'Return to card requested';

  @override
  String get returnedToCard => 'Returned to card';

  @override
  String get noWalletActivityYet => 'No wallet activity yet.';

  @override
  String get signInToViewWallet => 'Sign in to view your wallet.';

  @override
  String get decline => 'Decline';

  @override
  String get accept => 'Accept';

  @override
  String get saveShipmentChangesQuestion => 'Save shipment changes?';

  @override
  String get saveShipmentChangesMessage =>
      'This will update the shipment details. Destination changes may adjust the customer wallet or payment totals.';

  @override
  String get saveChanges => 'Save changes';

  @override
  String get sender => 'Sender';

  @override
  String get senderQuestion => 'Who is sending the barrel?';

  @override
  String get pickup => 'Pickup';

  @override
  String get pickupAddress => 'Pickup address';

  @override
  String get receiver => 'Receiver';

  @override
  String get receiverQuestion => 'Who should receive it overseas?';

  @override
  String get destination => 'Destination';

  @override
  String get staffControls => 'Staff controls';

  @override
  String get shippingBusiness => 'Shipping business';

  @override
  String get currentBusiness => 'Current business';

  @override
  String get newRoute => 'New route';

  @override
  String get copyTrackingNumber => 'Copy tracking number';

  @override
  String get receipt => 'Receipt';

  @override
  String get dropOffOffice => 'Drop-off office';

  @override
  String get requestBarrelShipmentQuestion => 'Request barrel shipment?';

  @override
  String get requestBarrelShipmentMessage =>
      'This will create the shipment and start payment for the estimated total.';

  @override
  String get payAndRequest => 'Pay and request';

  @override
  String get pickUp => 'Pick up';

  @override
  String get bringToOffice => 'Bring to office';

  @override
  String get locationPermissionDenied => 'Location permission denied.';

  @override
  String get couldNotGetLocation => 'Could not get location. Try again.';

  @override
  String get pickupAddressInNyc => 'Pickup address in NYC';

  @override
  String get submitTransportRequestQuestion => 'Submit transport request?';

  @override
  String get submitTransportRequestMessage =>
      'This will create a transport request for staff to manage and track.';

  @override
  String get submitRequest => 'Submit request';

  @override
  String get barrelShippingPrice => 'Barrel shipping price';

  @override
  String get minDeliveryDays => 'Min delivery days';

  @override
  String get maxDeliveryDays => 'Max delivery days';

  @override
  String get officeAddress => 'Office address';

  @override
  String get barrelPickupPricing => 'Barrel pickup pricing';

  @override
  String get searchCountriesCodesFlags => 'Search countries, codes, or flags';

  @override
  String get business => 'Business';

  @override
  String migrationComplete(Object count) {
    return 'Migration complete: $count writes.';
  }

  @override
  String migrationFailed(Object error) {
    return 'Migration failed: $error';
  }

  @override
  String get status => 'Status';

  @override
  String get pending => 'Pending';

  @override
  String get approved => 'Approved';

  @override
  String get suspended => 'Suspended';

  @override
  String get saveBusiness => 'Save business';

  @override
  String get migrateKerenData => 'Migrate Keren data';

  @override
  String get addBusiness => 'Add business';

  @override
  String get updatePurchaseStatusQuestion => 'Update purchase status?';

  @override
  String updatePurchaseStatusMessage(Object carTitle, Object status) {
    return 'This will mark $carTitle as $status and update the related car record.';
  }

  @override
  String get updateStatus => 'Update status';

  @override
  String get accountProfile => 'Account profile';

  @override
  String get profileSaved => 'Profile saved.';

  @override
  String get phone => 'Phone';

  @override
  String get addPlatformManager => 'Add platform manager';

  @override
  String get createAdminSubtitle =>
      'Create another admin who can manage the platform';

  @override
  String get addBusinessStaff => 'Add business staff';

  @override
  String get createStaffSubtitle => 'Create a staff login under a business';

  @override
  String get noUsersMatch => 'No users match this view.';

  @override
  String get manager => 'Manager';

  @override
  String get managers => 'Managers';

  @override
  String get owners => 'Owners';

  @override
  String get all => 'All';

  @override
  String get businessStaff => 'Business staff';

  @override
  String get searchUsersHint => 'Search name, email, phone, business';

  @override
  String get userActions => 'User actions';

  @override
  String get setAsPlatformManager => 'Set as platform manager';

  @override
  String get userId => 'User ID';

  @override
  String get chooseStaffBusiness => 'Choose a business';

  @override
  String get ownerAccount => 'Owner account';

  @override
  String get ownerFullName => 'Owner full name';

  @override
  String get ownerPhone => 'Owner phone';

  @override
  String get ownerEmail => 'Owner email';

  @override
  String get servicesYouOffer => 'Services you offer';

  @override
  String get submitBusinessApplicationQuestion =>
      'Submit business application?';

  @override
  String get submitBusinessApplicationMessage =>
      'This will create your business account request and open dashboard setup for the selected services.';

  @override
  String get submitApplication => 'Submit application';

  @override
  String get chooseAtLeastOneBusinessService =>
      'Choose at least one business service.';

  @override
  String get reserveViewingQuestion => 'Reserve viewing?';

  @override
  String get reserveViewingConfirmMessage =>
      'This will reserve your selected viewing time for this car.';

  @override
  String get purchaseCarQuestion => 'Purchase this car?';

  @override
  String get purchaseCarConfirmMessage =>
      'This will start checkout and create a purchase record for this car.';

  @override
  String get continueToPayment => 'Continue to payment';

  @override
  String get signUpFailedTryAgain => 'Sign up failed. Please try again.';

  @override
  String get noApprovedDestinationsAvailable =>
      'No active approved business destinations are available.';

  @override
  String get carrierTracking => 'Carrier tracking';

  @override
  String get couldNotOpenCarrierTracking => 'Could not open carrier tracking.';

  @override
  String get trackingNumberCopiedShort => 'Tracking number copied.';

  @override
  String get copy => 'Copy';

  @override
  String get activeShort => 'Active';

  @override
  String get pickupShort => 'Pickup';

  @override
  String get doneShort => 'Done';

  @override
  String get platformDashboard => 'Platform dashboard';

  @override
  String get platformDashboardSubtitle =>
      'Applications, businesses, operations, refunds, and marketplace health.';

  @override
  String get pendingBusinesses => 'Pending businesses';

  @override
  String get approvedBusinesses => 'Approved businesses';

  @override
  String get customers => 'Customers';

  @override
  String get openShipments => 'Open shipments';

  @override
  String get pendingPurchases => 'Pending purchases';

  @override
  String get refundRequests => 'Refund requests';

  @override
  String get refundRequest => 'Refund request';

  @override
  String amountLabel(Object amount) {
    return 'Amount: $amount';
  }

  @override
  String customerLabel(Object customer) {
    return 'Customer: $customer';
  }

  @override
  String statusLabelValue(Object status) {
    return 'Status: $status';
  }

  @override
  String businessLabel(Object business) {
    return 'Business: $business';
  }

  @override
  String get close => 'Close';

  @override
  String get platformManagerCreated => 'Platform manager created.';

  @override
  String get temporaryPassword => 'Temporary password';

  @override
  String get actionQueue => 'Action queue';

  @override
  String get review => 'Review';

  @override
  String get businessManagement => 'Business management';

  @override
  String get openFullList => 'Open full list';

  @override
  String get financeReadiness => 'Finance readiness';

  @override
  String get recentOperations => 'Recent operations';

  @override
  String get businessReviewSaved => 'Business review saved.';

  @override
  String get reviewAction => 'Review action';

  @override
  String get approve => 'Approve';

  @override
  String get suspend => 'Suspend';

  @override
  String get reject => 'Reject';

  @override
  String get requestChanges => 'Request changes';

  @override
  String get reviewNote => 'Review note';

  @override
  String requestId(Object id) {
    return 'Request ID: $id';
  }

  @override
  String get finalReceiptGenerated =>
      'Final receipt generated and status set to completed.';

  @override
  String get updateRecord => 'Update Record';

  @override
  String get generateFinalReceipt => 'Generate Final Receipt';

  @override
  String get parkingStartDate => 'Parking Start Date';

  @override
  String get parkingEndDate => 'Parking End Date';

  @override
  String get costPerDay => 'Cost Per Day (\$)';

  @override
  String get selectCountriesAddFees =>
      'Select the countries this business ships to and add the shipping fee for each destination.';

  @override
  String activeDestinationsHaveFees(Object priced, Object total) {
    return '$priced of $total active destinations have shipping fees.';
  }

  @override
  String get selectDestinationCountries => 'Select destination countries';

  @override
  String get manageDestinationsFees => 'Manage destinations and fees';

  @override
  String get businessNameRequired => 'Business name is required';

  @override
  String get businessPhoneRequired => 'Business phone is required';

  @override
  String get validBusinessPhoneRequired =>
      'Please enter a valid business phone';

  @override
  String get pickupCollectNyc => 'We will collect it from a NYC address.';

  @override
  String get pickupBringOffice => 'You will bring it to the office.';

  @override
  String get pleaseEnterPickupAddress => 'Please enter the pickup address';

  @override
  String get pleaseIncludeNycBoroughZip =>
      'Please include the NYC borough or ZIP code';

  @override
  String get pleaseChoosePickupDateTime => 'Please choose pickup date and time';

  @override
  String get pickupTimeFuture => 'Pickup time must be in the future';

  @override
  String get destinationSubtitleEstimateRoute =>
      'Choose the country so we can estimate the route.';

  @override
  String get pickupAddressNycHint => 'e.g. 3184 Webster Ave, Bronx, NY 10467';

  @override
  String get pleaseAskStaffSetBarrelPrice =>
      'Please ask staff to set a barrel shipping price for this destination before saving.';

  @override
  String get staffControlsSubtitle => 'Update internal status and final price.';

  @override
  String get officeDropOff => 'Office drop-off';

  @override
  String deliveryWithLabel(Object label) {
    return 'Delivery $label';
  }

  @override
  String get addBarrelFeeBeforeActivating =>
      'Add a barrel shipping fee before activating.';

  @override
  String get activeDestinationsNeedFee =>
      'Active destinations need a barrel shipping fee greater than 0.';

  @override
  String get addMinimumDeliveryDays => 'Add minimum delivery days.';

  @override
  String get addMaximumDeliveryDays => 'Add maximum delivery days.';

  @override
  String get useWholeCalendarDays => 'Use whole calendar days.';

  @override
  String get deliveryDaysGreaterThanZero =>
      'Delivery days must be greater than 0.';

  @override
  String get maxDaysAtLeastMin => 'Maximum days must be at least the minimum.';

  @override
  String get firebaseDeniedDeployRules =>
      'Firebase denied access. Deploy the local Firestore rules and functions, then seed the country catalog.';

  @override
  String get optionalDeliveryEstimateNote =>
      'Optional calendar-day estimate shown to customers.';

  @override
  String pickupPriceLabel(Object borough) {
    return '$borough pickup price';
  }

  @override
  String get editBusiness => 'Edit business';

  @override
  String get nameLabel => 'Name';

  @override
  String get businessesEmpty => 'No businesses yet.';

  @override
  String get chooseStaffBusinessMessage =>
      'Choose the business this staff member belongs to.';

  @override
  String get phoneNumberRequired => 'Please enter a phone number';

  @override
  String get pleaseSelectCarMake => 'Please select car make';

  @override
  String get pleaseSelectCarModel => 'Please select car model';

  @override
  String get pleaseSelectYear => 'Please select year';

  @override
  String get ownerNameRequired => 'Please enter owner name';

  @override
  String get carIdentityRequired =>
      'Please make sure car make, model, and year are selected.';

  @override
  String get recordUpdated => 'Record updated successfully!';

  @override
  String failedToUpdateRecord(Object error) {
    return 'Failed to update record: $error';
  }

  @override
  String get addParkingEndAndDailyCost =>
      'Please add an end date and daily cost first.';

  @override
  String get carIdentityReceiptRequired =>
      'Car make, model, and year must be set before generating a receipt.';

  @override
  String get endDateBeforeStart => 'End date cannot be before start date.';

  @override
  String get finalReceiptGeneratedCompleted =>
      'Final receipt generated and status set to completed.';

  @override
  String failedToGenerateReceipt(Object error) {
    return 'Failed to generate receipt: $error';
  }

  @override
  String get costPerDayCurrency => 'Cost Per Day (\$)';

  @override
  String get carParkingReceipt => 'CAR PARKING RECEIPT';

  @override
  String get businessServices => 'Business Services';

  @override
  String get receiptDetails => 'Receipt Details';

  @override
  String get receiptNumber => 'Receipt Number:';

  @override
  String get trackingNumberPdf => 'Tracking Number:';

  @override
  String get generatedOn => 'Generated On:';

  @override
  String get carInformation => 'Car Information';

  @override
  String get ownerNamePdf => 'Owner Name:';

  @override
  String get carMakePdf => 'Car Make:';

  @override
  String get carModelPdf => 'Car Model:';

  @override
  String get yearPdf => 'Year:';

  @override
  String get vinNumberPdf => 'VIN Number:';

  @override
  String get parkingStartPdf => 'Parking Start:';

  @override
  String get parkingEndPdf => 'Parking End:';

  @override
  String get totalDaysPdf => 'Total Days:';

  @override
  String get billingSummary => 'Billing Summary';

  @override
  String get costPerDayPdf => 'Cost per Day:';

  @override
  String get totalCostPdf => 'Total Cost:';

  @override
  String get peopleAndAccess => 'People and access';

  @override
  String get peopleAndAccessSubtitle =>
      'Manage platform managers, business teams, and customer accounts.';

  @override
  String get platformManagers => 'Platform managers';

  @override
  String platformManagersCount(Object count) {
    return '$count people with full platform access';
  }

  @override
  String get businessTeam => 'Business team';

  @override
  String businessTeamCount(Object count) {
    return '$count owner/staff accounts';
  }

  @override
  String customerAccountsCount(Object count) {
    return '$count shared marketplace customer accounts';
  }

  @override
  String get noEmail => 'No email';

  @override
  String get platformManager => 'Platform manager';

  @override
  String get businessOwner => 'Business owner';

  @override
  String get unassignedBusiness => 'Unassigned business';

  @override
  String currentDestinationShipping(Object amount) {
    return 'Current destination shipping: $amount.';
  }

  @override
  String destinationChangeCollect(Object amount) {
    return '$amount will be collected for the destination change.';
  }

  @override
  String destinationChangeCredit(Object amount) {
    return '$amount will be credited to your wallet.';
  }

  @override
  String newRouteValue(Object business, Object country) {
    return '$business to $country';
  }

  @override
  String get noMatchingBusinesses => 'No matching businesses.';

  @override
  String get noOpenShipments => 'No open shipments.';

  @override
  String get noPendingRefundRequests => 'No pending refund requests.';

  @override
  String get refundCredits => 'Refund credits';

  @override
  String get cardReturnRequest => 'Card return request';

  @override
  String get customerRefundRequest => 'Customer refund request';

  @override
  String get noBusinessApplicationsWaiting =>
      'No business applications waiting.';

  @override
  String get noPendingWalletCardReturns =>
      'No pending wallet card-return requests.';

  @override
  String get stripeConnectPlaceholders =>
      'Stripe Connect placeholders are ready for future connected account, payout, and dispute monitoring.';

  @override
  String get creating => 'Creating';

  @override
  String get createManager => 'Create manager';

  @override
  String get fullNameRequired => 'Full name is required';

  @override
  String get emailRequired => 'Email is required';

  @override
  String get validEmailRequired => 'Please enter a valid email';

  @override
  String get phoneRequired => 'Phone is required';

  @override
  String get passwordRequired => 'Password is required';

  @override
  String get services => 'Services';

  @override
  String get businessIdentitySubtitle =>
      'How customers and staff identify this business.';

  @override
  String get businessDefaultAddressSubtitle =>
      'Used as the default address for vehicle listings.';

  @override
  String get paidHoldPricing => 'Paid hold pricing';

  @override
  String get paidHoldPricingSubtitle =>
      'Set the default deposit rule for customers holding cars.';

  @override
  String get flatFee => 'Flat fee';

  @override
  String get perDay => 'Per day';

  @override
  String get flatHoldFee => 'Flat hold fee';

  @override
  String get dailyHoldRate => 'Daily hold rate';

  @override
  String get maxDays => 'Max days';

  @override
  String get holdMaxDaysHelper => '1 to 30 days';

  @override
  String get businessServicesSubtitle =>
      'Choose what this business can offer customers.';

  @override
  String businessServicesCount(Object count) {
    return '$count services';
  }

  @override
  String get businessProfileApprovalSubtitle =>
      'Customers will see this after platform approval.';

  @override
  String get ownerSignedInSubtitle =>
      'This business will be linked to your signed-in account.';

  @override
  String get ownerCreateLoginSubtitle =>
      'Create the owner login for this business.';

  @override
  String get servicesOfferSubtitle =>
      'Your dashboard will show pages for these services.';

  @override
  String get ownerPhoneRequired => 'Owner phone is required';

  @override
  String get walletBalance => 'Wallet balance';

  @override
  String toReceiverInCountry(Object receiver, Object country) {
    return 'To $receiver in $country';
  }

  @override
  String pickupRequestedWithDate(Object date) {
    return 'Pickup requested • $date';
  }

  @override
  String get pickupRequested => 'Pickup requested';

  @override
  String get customerDropOffAtOffice => 'Customer drop-off at office';

  @override
  String get pendingPayment => 'Pending payment';

  @override
  String get requested => 'Requested';

  @override
  String get inTransit => 'In transit';

  @override
  String get paid => 'Paid';

  @override
  String get paymentPending => 'Payment pending';

  @override
  String get paymentCancelled => 'Payment cancelled';

  @override
  String get signInToTrackShipments =>
      'Sign in to see your barrel shipment requests, receipts, and pickup status.';

  @override
  String get shipmentsLoadError =>
      'We could not load your shipment requests right now. Please try again shortly.';

  @override
  String get shipmentsAppearAfterPayment =>
      'Your barrel shipment requests will appear here after payment is completed.';

  @override
  String get registerYourBusiness => 'Register your business';

  @override
  String get submittingApplication => 'Submitting application';

  @override
  String get submitBusinessApplication => 'Submit business application';

  @override
  String get ownerNameRequiredShort => 'Owner name is required';

  @override
  String get unknown => 'Unknown';

  @override
  String get cardReturnsSimulatedNotice =>
      'Card returns are simulated for now. Keep this pending until real Stripe refunds are connected.';

  @override
  String get noBusinessesYet => 'No businesses yet.';

  @override
  String get saving => 'Saving';

  @override
  String get saveReview => 'Save review';

  @override
  String get open => 'Open';

  @override
  String errorDetails(Object error) {
    return 'Error: $error';
  }

  @override
  String get carInventoryBasics => 'Basics';

  @override
  String get carInventoryPricing => 'Pricing';

  @override
  String get carInventoryDetails => 'Details';

  @override
  String get carInventoryFeatures => 'Features';

  @override
  String get carInventoryMedia => 'Media';

  @override
  String get carInventoryContact => 'Contact';

  @override
  String get carInventoryReview => 'Review';

  @override
  String get next => 'Next';

  @override
  String get back => 'Back';

  @override
  String get publishCar => 'Publish car';

  @override
  String get updateListing => 'Update listing';

  @override
  String stepCount(Object current, Object total) {
    return 'Step $current of $total';
  }

  @override
  String get condition => 'Condition';

  @override
  String get bodyType => 'Body type';

  @override
  String get transmission => 'Transmission';

  @override
  String get fuelType => 'Fuel type';

  @override
  String get drivetrain => 'Drivetrain';

  @override
  String get exteriorColor => 'Exterior color';

  @override
  String get interiorColor => 'Interior color';

  @override
  String get vinOptional => 'VIN (optional)';

  @override
  String get stockNumberOptional => 'Stock/reference number (optional)';

  @override
  String get negotiable => 'Negotiable';

  @override
  String get locationCity => 'City';

  @override
  String get locationState => 'State';

  @override
  String get minPrice => 'Min price';

  @override
  String get minMileage => 'Min mileage';

  @override
  String get maxMileage => 'Max mileage';

  @override
  String get dealer => 'Dealer';

  @override
  String get location => 'Location';

  @override
  String get structuredFeatures => 'Key features';

  @override
  String get customFeatures => 'Custom features';

  @override
  String get customFeaturesHint => 'Add custom features separated by commas';

  @override
  String get conditionNew => 'New';

  @override
  String get conditionUsed => 'Used';

  @override
  String get conditionCertified => 'Certified';

  @override
  String get conditionSalvage => 'Salvage';

  @override
  String get conditionExcellent => 'Excellent';

  @override
  String get conditionGood => 'Good';

  @override
  String get conditionFair => 'Fair';

  @override
  String get conditionPoor => 'Poor';

  @override
  String get bodySedan => 'Sedan';

  @override
  String get bodySuv => 'SUV';

  @override
  String get bodyTruck => 'Truck';

  @override
  String get bodyVan => 'Van';

  @override
  String get bodyCoupe => 'Coupe';

  @override
  String get bodyHatchback => 'Hatchback';

  @override
  String get bodyWagon => 'Wagon';

  @override
  String get bodyConvertible => 'Convertible';

  @override
  String get transmissionAutomatic => 'Automatic';

  @override
  String get transmissionManual => 'Manual';

  @override
  String get transmissionCvt => 'CVT';

  @override
  String get fuelGas => 'Gas';

  @override
  String get fuelDiesel => 'Diesel';

  @override
  String get fuelHybrid => 'Hybrid';

  @override
  String get fuelElectric => 'Electric';

  @override
  String get fuelPlugInHybrid => 'Plug-in hybrid';

  @override
  String get drivetrainFwd => 'FWD';

  @override
  String get drivetrainRwd => 'RWD';

  @override
  String get drivetrainAwd => 'AWD';

  @override
  String get drivetrainFourWd => '4WD';

  @override
  String get featureBackupCamera => 'Backup camera';

  @override
  String get featureBluetooth => 'Bluetooth';

  @override
  String get featureLeatherSeats => 'Leather seats';

  @override
  String get featureSunroof => 'Sunroof';

  @override
  String get featureNavigation => 'Navigation';

  @override
  String get featureHeatedSeats => 'Heated seats';

  @override
  String get featureAppleCarPlay => 'Apple CarPlay';

  @override
  String get featureAndroidAuto => 'Android Auto';

  @override
  String get featureBlindSpot => 'Blind spot monitor';

  @override
  String get featureThirdRow => 'Third row seating';

  @override
  String get featureRemoteStart => 'Remote start';

  @override
  String get featureKeylessEntry => 'Keyless entry';

  @override
  String get featureLaneAssist => 'Lane assist';

  @override
  String get featureAlloyWheels => 'Alloy wheels';

  @override
  String get featureParkingSensors => 'Parking sensors';

  @override
  String get featurePremiumAudio => 'Premium audio';

  @override
  String get positivePriceRequired => 'Price must be greater than 0.';

  @override
  String get mileageWholeNumberRequired =>
      'Mileage must be a non-negative whole number.';

  @override
  String get vinLengthRequired => 'VIN must be 17 characters.';

  @override
  String get addAtLeastOneImage =>
      'Add at least one car image before publishing.';

  @override
  String get coverImage => 'Cover image';

  @override
  String get makeCover => 'Make cover';

  @override
  String get removeImage => 'Remove image';

  @override
  String get listingPreview => 'Listing preview';

  @override
  String get readyToPublish => 'Ready to publish';

  @override
  String get missingRequiredInfo => 'Missing required information';

  @override
  String get reviewBeforePublishing =>
      'Review the listing before it goes live for customers.';

  @override
  String get listingWillStayInactive =>
      'This listing will be saved as inactive and hidden from customers.';

  @override
  String get noFilterResults => 'No cars match these filters.';

  @override
  String get clearFiltersToSeeCars => 'Clear filters to see available cars.';

  @override
  String get newestListings => 'Newest listings';

  @override
  String get mileageLowToHigh => 'Mileage: low to high';

  @override
  String get mileageHighToLow => 'Mileage: high to low';

  @override
  String get priceNegotiable => 'Price negotiable';

  @override
  String get financingAvailable => 'Financing info available';

  @override
  String get any => 'Any';

  @override
  String get uploadingCar => 'Uploading car...';

  @override
  String get fixRequiredFields => 'Please fix the required fields below.';

  @override
  String get selectStateFirst => 'Select a state first';

  @override
  String get carColorBlack => 'Black';

  @override
  String get carColorWhite => 'White';

  @override
  String get carColorSilver => 'Silver';

  @override
  String get carColorGray => 'Gray';

  @override
  String get carColorRed => 'Red';

  @override
  String get carColorBlue => 'Blue';

  @override
  String get carColorGreen => 'Green';

  @override
  String get carColorYellow => 'Yellow';

  @override
  String get carColorBrown => 'Brown';

  @override
  String get carColorBeige => 'Beige';

  @override
  String get carColorGold => 'Gold';

  @override
  String get carColorOrange => 'Orange';

  @override
  String get carColorPurple => 'Purple';

  @override
  String get carColorBurgundy => 'Burgundy';

  @override
  String get carColorOther => 'Other';

  @override
  String get otherOption => 'Other';

  @override
  String get businessLocation => 'Business location';

  @override
  String get viewingLocation => 'Viewing location';

  @override
  String get reserveCarHoldTitle => 'Paid hold after viewing';

  @override
  String get reserveCarHoldMessage =>
      'Use this after you have viewed the car and want the business to hold it while you return to complete payment. If you do not come back, the deposit may be forfeited.';

  @override
  String get reserveCarQuestion => 'Reserve this car?';

  @override
  String reserveCarConfirmMessage(Object amount) {
    return 'You will pay $amount now to hold this car. The business can keep the deposit if you do not return to complete the purchase.';
  }

  @override
  String get businessAddressLine1 => 'Business street address';

  @override
  String get postalCode => 'Postal code';

  @override
  String get useBusinessDefaultAddress => 'Use business default address';

  @override
  String get useCustomViewingAddress => 'Use a different viewing address';

  @override
  String get listingLocationSource => 'Listing location';

  @override
  String get businessAddressMissing =>
      'Add the business default address in Business profile, or choose a different viewing address.';

  @override
  String get editViewingReservation => 'Edit viewing reservation';

  @override
  String get changeViewingTime => 'Change viewing time';

  @override
  String get viewingEditCutoff =>
      'Viewing appointments can be changed until one hour before the scheduled time.';

  @override
  String get viewingReservationUpdated => 'Viewing time updated.';

  @override
  String get cannotEditViewingReservation =>
      'This viewing reservation can no longer be changed.';

  @override
  String get cancelViewingReservation => 'Cancel viewing';

  @override
  String get cancelViewingQuestion => 'Cancel this viewing?';

  @override
  String get cancelViewingConfirmMessage =>
      'This will remove your viewing appointment and make the car available for you to reserve again.';

  @override
  String get viewingReservationCancelled => 'Viewing reservation cancelled.';

  @override
  String get viewingScheduled => 'Viewing scheduled';

  @override
  String get requestHoldExtensionQuestion => 'Request hold extension?';

  @override
  String get requestHoldExtensionMessage =>
      'The business will review your new return date. If approved, you will pay any extra hold amount before the date changes.';

  @override
  String get requestExtension => 'Request extension';

  @override
  String get extensionRequestSent => 'Extension request sent.';

  @override
  String holdUntilDate(Object date) {
    return 'Hold until: $date';
  }

  @override
  String get holdReviewRequiredMessage =>
      'The hold date has passed. The business is reviewing whether the vehicle was sold or the customer did not come.';

  @override
  String get customerNoShowHoldMessage =>
      'Marked as customer did not come. The hold deposit may be forfeited.';

  @override
  String get payExtensionQuestion => 'Pay extension?';

  @override
  String get payExtensionMessage =>
      'Your hold date will update after this extension payment is complete.';

  @override
  String get payExtension => 'Pay extension';

  @override
  String get extensionPaidHoldUpdated => 'Extension paid. Hold date updated.';

  @override
  String get chooseBusinessWithShippingFee =>
      'Choose a business with an active shipping fee before payment.';

  @override
  String get processingPayment => 'Processing payment';

  @override
  String get payAndRequestShipment => 'Pay and request shipment';

  @override
  String get checkingConnection => 'Checking connection';

  @override
  String get checkingConnectionMessage =>
      'We are confirming internet access before opening the app.';

  @override
  String get noInternetConnection => 'No internet connection';

  @override
  String get noInternetMessage =>
      'This app needs an active internet connection to load your account, services, payments, and latest safety settings.';

  @override
  String get retry => 'Retry';

  @override
  String get updateAvailable => 'Update available';

  @override
  String updateAvailableMessage(Object version) {
    return 'A newer version$version is available. Update now for the latest fixes, or continue for this session.';
  }

  @override
  String get updateRequired => 'Update required';

  @override
  String updateRequiredMessage(Object version) {
    return 'This version is no longer supported. Please update$version to continue.';
  }

  @override
  String get updateNow => 'Update now';

  @override
  String get continueLabel => 'Continue';

  @override
  String get updateLinkUnavailable =>
      'The update link is not available yet. Please try again later.';

  @override
  String get emailOrPhone => 'Email or phone';

  @override
  String get enterEmailOrPhone => 'Enter your email or phone';

  @override
  String get pleaseEnterEmailOrPhone =>
      'Please enter your email or phone number';

  @override
  String get pleaseEnterValidEmailOrPhone =>
      'Please enter a valid email or phone number';

  @override
  String get saveProfile => 'Save profile';

  @override
  String get profilePhoto => 'Profile photo';

  @override
  String get changePhoto => 'Change photo';

  @override
  String get notifications => 'Notifications';

  @override
  String get notificationPreferences => 'Notification preferences';

  @override
  String get carActivityNotifications => 'Car purchase and reservation updates';

  @override
  String get shipmentActivityNotifications => 'Barrel shipment updates';

  @override
  String get walletActivityNotifications => 'Wallet refund updates';

  @override
  String get businessActivityNotifications => 'Business application updates';

  @override
  String get faceId => 'Face ID';

  @override
  String get faceIdUnlock => 'Use Face ID to unlock this app';

  @override
  String get faceIdUnavailable => 'Face ID is not available on this device';

  @override
  String get unlockWithFaceId => 'Unlock with Face ID';

  @override
  String get appLocked => 'App locked';

  @override
  String get unlockWithFaceIdMessage => 'Use Face ID to continue.';

  @override
  String get unlock => 'Unlock';

  @override
  String get favoriteCars => 'Favorite cars';

  @override
  String get favoriteCarsSubtitle => 'View vehicles you saved';

  @override
  String get noFavoriteCarsYet => 'No favorite cars yet';

  @override
  String get favoriteRemoved => 'Favorite removed';
}
