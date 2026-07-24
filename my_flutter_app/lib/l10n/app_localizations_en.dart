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
  String shipmentSavedReceiptUnavailable(Object trackingCode) {
    return 'Shipment saved. Tracking number: $trackingCode. The receipt could not be opened, but your payment and shipment are safe.';
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
  String get legalAndPrivacy => 'Legal & privacy';

  @override
  String get privacyPolicySubtitle => 'How Laawol handles your information';

  @override
  String get termsOfServiceSubtitle => 'Rules for using the Laawol platform';

  @override
  String get openLegalLinkFailed =>
      'This page could not be opened. Please try again.';

  @override
  String get accountManagement => 'Account management';

  @override
  String get deleteAccount => 'Delete account';

  @override
  String get deleteAccountSubtitle =>
      'Permanently delete your account and personal data';

  @override
  String get deleteAccountTitle => 'Delete your Laawol account?';

  @override
  String get deleteAccountExplanation =>
      'This starts permanent account deletion. You will be signed out, and access to your account will end.';

  @override
  String get deleteAccountRetentionNotice =>
      'Completed payment and service records may be retained when required for accounting, refunds, disputes, fraud prevention, or law. All other associated personal data will be deleted or anonymized within 30 days.';

  @override
  String get enterPasswordToDelete => 'Enter your password to confirm';

  @override
  String get confirmDeleteAccount => 'Request deletion';

  @override
  String get accountDeletionRequestedTitle => 'Deletion requested';

  @override
  String get accountDeletionRequestedMessage =>
      'Your request was received. Laawol will delete or anonymize eligible account data within 30 days. You are now signed out.';

  @override
  String get accountDeletionWrongPassword => 'The password is incorrect.';

  @override
  String get accountDeletionRecentLoginRequired =>
      'Please sign in again, then retry account deletion.';

  @override
  String get accountDeletionAdminBlocked =>
      'A platform administrator account must be removed by another super admin.';

  @override
  String get accountDeletionFailed =>
      'We could not start account deletion. Please try again or contact support.';

  @override
  String get manageCars => 'Manage Cars';

  @override
  String get recentActivity => 'Recent Activity';

  @override
  String get filterAll => 'All';

  @override
  String get trackSearchHint => 'Search tracking, receiver, country';

  @override
  String get filterInProgress => 'In progress';

  @override
  String get filterDelivered => 'Delivered';

  @override
  String get allDestinations => 'All destinations';

  @override
  String get noShipmentsMatchFilters => 'No shipments match your filters';

  @override
  String get ordersTitle => 'My orders';

  @override
  String get ordersSearchHint => 'Search orders, business, country';

  @override
  String get ordersEmpty => 'Your paid orders appear here';

  @override
  String get ordersNoMatch => 'No orders match your filters';

  @override
  String get orderTypeCars => 'Cars';

  @override
  String get orderTypeBarrels => 'Barrels';

  @override
  String get orderTypeFreight => 'Freight';

  @override
  String get orderTypeTransport => 'Transport';

  @override
  String get orderTypeParking => 'Parking';

  @override
  String get orderStatusPending => 'Pending';

  @override
  String get orderStatusActive => 'Active';

  @override
  String get orderStatusInTransit => 'In transit';

  @override
  String get orderStatusCompleted => 'Completed';

  @override
  String get orderStatusCancelled => 'Cancelled';

  @override
  String get orderStatusRefunded => 'Refunded';

  @override
  String get filterParking => 'Parked Cars';

  @override
  String get filterBarrels => 'Barrel Shipments';

  @override
  String get filterFreight => 'Freight';

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
  String get markAsSold => 'Mark as sold';

  @override
  String get sold => 'Sold';

  @override
  String get carMileage => 'Mileage';

  @override
  String get rebuiltTitle => 'Rebuilt title';

  @override
  String get rebuiltTitleQuestion => 'Rebuilt title?';

  @override
  String get rebuiltTitleYes => 'Yes — rebuilt title';

  @override
  String get rebuiltTitleNo => 'No — not a rebuilt title';

  @override
  String get rebuiltTitleUnknown => 'Not provided';

  @override
  String get rebuiltTitleDisclosureHelp =>
      'Required. Buyers will see this disclosure.';

  @override
  String get sellingPrice => 'Listing Price';

  @override
  String get carFeaturesHint => 'Features (comma separated)';

  @override
  String get carImagesHint => 'Image URLs (comma separated)';

  @override
  String get contactName => 'Contact Name';

  @override
  String get contactPhone => 'Contact phone';

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
  String get destinationsAndShippingFees => 'Destinations and services';

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
  String get walletActivityUnavailable =>
      'We could not load your wallet activity right now. Please try again in a moment.';

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
  String get sharedBarrelManageRequests => 'Manage requests';

  @override
  String get sharedBarrelJoinRequests => 'Join requests';

  @override
  String get sharedBarrelJoinRequestsHelp =>
      'Approve or reject customers waiting to join this shared barrel.';

  @override
  String get sharedBarrelNoPendingRequests =>
      'No join requests are waiting for approval.';

  @override
  String get sharedBarrelRequestApproved => 'Join request approved.';

  @override
  String get sharedBarrelRequestRejected =>
      'Join request rejected. The deposit will be sent for refund.';

  @override
  String get sharedBarrelRequestDecisionFailed =>
      'Could not update this request. Please try again.';

  @override
  String sharedBarrelRequestedShareCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count shares requested',
      one: '1 share requested',
    );
    return '$_temp0';
  }

  @override
  String sharedBarrelPaidDeposit(Object amount) {
    return 'Deposit paid: $amount';
  }

  @override
  String get sharedBarrelCancelPool => 'Cancel pool';

  @override
  String get sharedBarrelCancelTitle => 'Cancel this shared barrel?';

  @override
  String sharedBarrelCancelForfeitureMessage(Object amount) {
    return 'If you cancel now, your $amount deposit will be forfeited. This cannot be undone.';
  }

  @override
  String get sharedBarrelKeepPool => 'Keep pool';

  @override
  String get sharedBarrelCancelAndForfeit => 'Cancel and forfeit deposit';

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
      'Choose countries and select what this business offers for each destination.';

  @override
  String activeDestinationsHaveFees(Object priced, Object total) {
    return '$priced of $total active destinations have services configured.';
  }

  @override
  String get selectDestinationCountries => 'Select destination services';

  @override
  String get manageDestinationsFees => 'Manage destinations and services';

  @override
  String get servicesForDestination => 'Services for this destination';

  @override
  String get servicesForDestinationHelp =>
      'Turn on only what this business offers for this country.';

  @override
  String get enableBusinessServiceBeforeDestination =>
      'Enable barrel shipping, freight, or car transport on the business profile before configuring destination coverage.';

  @override
  String get destinationServiceCoverageTitle => 'Destination services';

  @override
  String get destinationServiceCoverageSubtitle =>
      'Set which services are available for this country and add rates where needed.';

  @override
  String get offerBarrelShipping => 'Barrel shipping';

  @override
  String get barrelShippingDestinationHelper =>
      'Customers can send barrels to this country.';

  @override
  String get offerFreightAir => 'Freight by air';

  @override
  String get freightAirDestinationHelper =>
      'Customers can ship parcels by air to this country.';

  @override
  String get offerFreightSea => 'Freight by sea';

  @override
  String get freightSeaDestinationHelper =>
      'Customers can ship parcels by sea to this country.';

  @override
  String get offerCarTransportDestination => 'Ship cars to this country';

  @override
  String get carTransportDestinationHelper =>
      'Customers can request a car transport quote for this country.';

  @override
  String get freightAirRatePerKg => 'Air freight rate per kg';

  @override
  String get freightSeaRatePerKg => 'Sea freight rate per kg';

  @override
  String get chooseAtLeastOneDestinationService =>
      'Choose at least one service for this destination.';

  @override
  String destinationServiceRateRequired(Object service) {
    return 'Add a rate for $service.';
  }

  @override
  String destinationServiceRateGreaterThanZero(Object service) {
    return '$service needs a rate greater than 0.';
  }

  @override
  String get destinationBarrelService => 'Barrel';

  @override
  String get destinationFreightAir => 'Air freight';

  @override
  String get destinationFreightSea => 'Sea freight';

  @override
  String get destinationCarTransport => 'Car transport';

  @override
  String destinationServicePriceSummary(Object service, Object price) {
    return '$service: $price';
  }

  @override
  String destinationServiceRateSummary(Object service, Object rate) {
    return '$service: $rate/kg';
  }

  @override
  String get noDestinationServicesConfigured => 'No services configured';

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
  String get dateTimePdf => 'Date & Time:';

  @override
  String get parkingStatusActive => 'Parking Status: ACTIVE';

  @override
  String get vehicleSuccessfullyParked =>
      'Vehicle has been successfully parked';

  @override
  String get termsAndConditions => 'Terms & Conditions';

  @override
  String get parkingReceiptTerms =>
      '• This receipt serves as proof of parking\n• Vehicle will be stored securely\n• Contact us for any inquiries\n• Valid until vehicle is retrieved';

  @override
  String get peopleAndAccess => 'People & access';

  @override
  String get peopleAndAccessSubtitle =>
      'Manage marketplace identities, invitations, and account security.';

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
  String destinationChangePaid(Object amount) {
    return 'Shipment updated. $amount difference paid.';
  }

  @override
  String destinationChangeCredited(Object amount) {
    return 'Shipment updated. $amount credited to your wallet.';
  }

  @override
  String get shipmentDestinationUpdated => 'Shipment destination updated.';

  @override
  String get destinationPaymentInitializationFailed =>
      'The destination payment could not be initialized. Please try again.';

  @override
  String get paidShipmentDestinationChangeRequiresSupport =>
      'This shipment has already been paid out to the business. Contact Laawol support to change its destination safely.';

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
  String get businessProfileDetailsSectionError =>
      'Check the highlighted business details.';

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
  String get parkingCapacityTitle => 'Parking capacity';

  @override
  String get parkingCapacitySubtitle =>
      'Set the address, spaces, and prices customers can reserve.';

  @override
  String get parkingAddress => 'Parking address';

  @override
  String get totalParkingSpaces => 'Total spaces';

  @override
  String get blockedParkingSpaces => 'Blocked spaces';

  @override
  String get dailyParkingRate => 'Daily parking rate';

  @override
  String get weeklyParkingRate => 'Weekly parking rate';

  @override
  String get monthlyParkingRate => 'Monthly parking rate';

  @override
  String get minimumParkingDays => 'Minimum days';

  @override
  String get pickupAvailable => 'Pickup available';

  @override
  String get pickupAvailableSubtitle =>
      'Customers can request vehicle pickup before parking.';

  @override
  String get pickupFee => 'Pickup fee';

  @override
  String get parkingInstructions => 'Parking instructions';

  @override
  String get enterValidParkingCapacity =>
      'Add the parking address, location, spaces, and daily rate before saving.';

  @override
  String get customerParkingTitle => 'Find parking';

  @override
  String get customerParkingSubtitle =>
      'Choose where and when you want to park. We will show businesses with open spaces.';

  @override
  String get enterCarDetailsToReserveParking =>
      'Enter car details to reserve parking';

  @override
  String get parkingCity => 'Parking city';

  @override
  String get pleaseEnterParkingCity => 'Enter the city where you want to park.';

  @override
  String get parkingStart => 'Parking start';

  @override
  String get parkingEnd => 'Parking end';

  @override
  String get searchParking => 'Search parking';

  @override
  String get searchingParking => 'Searching...';

  @override
  String get availableParkingBusinesses => 'Available parking';

  @override
  String get noParkingBusinesses =>
      'No businesses have parking available for those dates.';

  @override
  String get parkingSearchFailed => 'Parking search failed. Please try again.';

  @override
  String availableSpacesCount(Object count) {
    return '$count spaces available';
  }

  @override
  String parkingPricePerDay(Object amount) {
    return '$amount/day';
  }

  @override
  String parkingEstimatedTotal(Object amount) {
    return 'Estimated total: $amount';
  }

  @override
  String parkingDistanceMiles(Object miles) {
    return '$miles mi away';
  }

  @override
  String get reserveParking => 'Reserve parking';

  @override
  String get reservingParking => 'Reserving...';

  @override
  String parkingReservationSaved(Object trackingCode) {
    return 'Parking reserved. Tracking number: $trackingCode';
  }

  @override
  String get parkingReservationFailed =>
      'Parking could not be reserved. Please try again.';

  @override
  String get accountRequiredParking =>
      'Sign in to reserve parking and track your vehicle.';

  @override
  String get parkingDateRangeInvalid =>
      'Choose an end date after the parking start date.';

  @override
  String get chooseParkingBusiness =>
      'Choose a business with available parking.';

  @override
  String get parkingPickupRequested => 'Pickup requested';

  @override
  String get parkingPickupOptional =>
      'Request pickup if the business offers it';

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
  String get businessApplicationSubmittedSetup =>
      'Business application submitted. You can set up your dashboard now.';

  @override
  String get ownerNameRequiredShort => 'Owner name is required';

  @override
  String get chooseBusinessImageFirst =>
      'Please choose a business image first.';

  @override
  String get validWebsiteRequired => 'Please enter a valid website';

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
  String get pushNotifications => 'Push notifications';

  @override
  String get emailNotifications => 'Email notifications';

  @override
  String get smsNotifications => 'SMS notifications';

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

  @override
  String get addToFavorites => 'Add to favorites';

  @override
  String get removeFromFavorites => 'Remove from favorites';

  @override
  String get enterValidPaidHoldPricing => 'Enter valid paid hold pricing.';

  @override
  String get useBusinessPaidHoldPricing => 'Use business paid hold pricing';

  @override
  String get useBusinessPaidHoldPricingSubtitle =>
      'Turn off to override hold fee for this car.';

  @override
  String get chooseReturnDate => 'Choose return date';

  @override
  String get customizeNavbar => 'Customize navbar';

  @override
  String get change => 'Change';

  @override
  String get sendFreight => 'Send freight';

  @override
  String freightBookedTracking(Object trackingCode) {
    return 'Freight booked. Tracking: $trackingCode';
  }

  @override
  String freightEstimatePaidTracking(Object trackingCode) {
    return 'Estimate paid. Tracking: $trackingCode';
  }

  @override
  String get fillSenderReceiverPhone => 'Fill sender, receiver, and phone.';

  @override
  String get enterParcelWeightKg => 'Enter the parcel weight in kg.';

  @override
  String get noFreightBusinessesYet => 'No freight businesses yet';

  @override
  String get noFreightBusinessesSubtitle =>
      'Parcel freight will appear here once a business sets its air or sea rates.';

  @override
  String get couldNotLoadFreightOptions =>
      'Could not load freight options. Check your connection and try again.';

  @override
  String get freightBookingFailed =>
      'We couldn\'t create this freight shipment. Please try again.';

  @override
  String get approvedBusiness => 'Approved business';

  @override
  String freightDeliveryEstimateDays(int minimum, int maximum) {
    return 'Delivery: $minimum-$maximum days';
  }

  @override
  String get searchBusinessOrCountry => 'Search a business or country';

  @override
  String noMatchFor(Object query) {
    return 'No match for \"$query\"';
  }

  @override
  String toDestination(Object destination) {
    return 'To $destination';
  }

  @override
  String airRatePerKg(Object rate) {
    return 'Air $rate/kg';
  }

  @override
  String seaRatePerKg(Object rate) {
    return 'Sea $rate/kg';
  }

  @override
  String get shippingMode => 'Shipping mode';

  @override
  String get invalidFreightMode => 'Choose air or sea freight.';

  @override
  String get parcelWeightKg => 'Parcel weight (kg)';

  @override
  String get estimatedPrice => 'Estimated price';

  @override
  String get estimatedWeight => 'Estimated weight';

  @override
  String get estimatedWeightKg => 'Estimated weight (kg)';

  @override
  String get estimatedTotal => 'Estimated total';

  @override
  String get freightEstimateExplanation =>
      'You are paying an estimate based on the weight you entered. The business will confirm the weight after drop-off.';

  @override
  String get payEstimate => 'Pay estimate';

  @override
  String get estimatePaid => 'Estimate paid';

  @override
  String get freightOrderDetails => 'Freight order';

  @override
  String get freightNextStep => 'Next step';

  @override
  String freightNextDropOffAtProvider(Object businessName) {
    return 'Drop off your parcel at $businessName. The business will confirm the weight after drop-off.';
  }

  @override
  String get freightNextDropOffAtBusiness =>
      'Drop off your parcel at the business location. The business will confirm the weight after drop-off.';

  @override
  String get freightNextWeightReview =>
      'The business is confirming the final weight. We will show any balance or refund here.';

  @override
  String get freightNextInTransit =>
      'Your parcel is on the way. Keep this tracking code for updates.';

  @override
  String get freightNextReadyForPickup => 'Your parcel is ready for pickup.';

  @override
  String get freightNextCompleted => 'This freight order is complete.';

  @override
  String paidEstimateAmount(Object amount) {
    return 'Paid estimate: $amount';
  }

  @override
  String estimatedWeightValue(Object weight) {
    return 'Estimated weight: $weight';
  }

  @override
  String get freightNoActionUntilWeightConfirmed =>
      'After drop-off, no action is needed until the business confirms the weight.';

  @override
  String get viewAllShipments => 'View all shipments';

  @override
  String get shipmentStillSyncing =>
      'This shipment is still syncing. You can view all shipments or try again shortly.';

  @override
  String get awaitingConfirmedWeight => 'Awaiting confirmed weight';

  @override
  String get verifiedWeight => 'Confirmed weight';

  @override
  String get finalTotal => 'Final total';

  @override
  String get additionalPaymentRequired => 'Additional payment required';

  @override
  String payBalanceAmount(Object amount) {
    return 'Pay balance of $amount';
  }

  @override
  String refundDueAmount(Object amount) {
    return 'Refund due: $amount';
  }

  @override
  String get refundProcessing => 'Refund processing';

  @override
  String get refundCompleted => 'Refund completed';

  @override
  String get freightSettled => 'Settled';

  @override
  String get shipmentHeldForBalance =>
      'Your parcel will be held until the balance is paid.';

  @override
  String get settlementNeedsAttention => 'Settlement needs attention';

  @override
  String get paymentProcessing => 'Payment processing…';

  @override
  String get couldNotPayBalance => 'Could not pay the balance. Try again.';

  @override
  String get enterWeightToSeePrice => 'Enter a weight to see the price';

  @override
  String get bookAndPay => 'Book & pay';

  @override
  String get freightDropOffNote =>
      'Drop your parcel at the business location. Pickup coming soon.';

  @override
  String freightDropOffAddress(Object address) {
    return 'Drop-off: $address';
  }

  @override
  String freightBusinessPhone(Object phone) {
    return 'Business phone: $phone';
  }

  @override
  String get airFreight => 'Air freight';

  @override
  String get seaFreight => 'Sea freight';

  @override
  String pricePerKg(Object price) {
    return '$price / kg';
  }

  @override
  String get fasterDelivery => 'Faster delivery';

  @override
  String get lowerCost => 'Lower cost';

  @override
  String get requestCarTransport => 'Request car transport';

  @override
  String get chooseTransportDestination => 'Choose a destination for the car.';

  @override
  String get whereIsTheCarGoing => 'Where is the car going?';

  @override
  String get searchDestinationCountry => 'Search destination country';

  @override
  String get noDestinationCountriesMatch =>
      'No destination countries match your search.';

  @override
  String get transportBusinessesWillQuote =>
      'Eligible verified businesses serving this destination will receive the vehicle details and send you quotes to compare.';

  @override
  String get vehicleCondition => 'Vehicle condition';

  @override
  String get vehicleRunsAndDrives => 'Runs and drives';

  @override
  String get vehicleInoperable => 'Inoperable';

  @override
  String get preferredTransportMethod => 'Preferred transport method';

  @override
  String get openTransport => 'Open carrier';

  @override
  String get enclosedTransport => 'Enclosed carrier';

  @override
  String get pickupArea => 'Pickup city, region, or postal code';

  @override
  String get pickupAreaHint => 'For example, Bronx, NY 10467';

  @override
  String get enterPickupArea =>
      'Enter the pickup city, region, or postal code.';

  @override
  String get flexibleTransportDates => 'My dates are flexible';

  @override
  String get flexibleTransportDatesSubtitle =>
      'Businesses may quote the best available pickup window.';

  @override
  String transportMarketplaceRequestSent(Object trackingCode) {
    return 'Request $trackingCode sent to eligible businesses. You can compare their quotes in your orders.';
  }

  @override
  String get transportQuotesTitle => 'Business quotes';

  @override
  String get transportQuotesIntro =>
      'Compare the total price, timing, method, and terms before choosing a transporter.';

  @override
  String get waitingForTransportQuotes => 'Waiting for business quotes';

  @override
  String get waitingForTransportQuotesSubtitle =>
      'Eligible verified businesses can review the route and vehicle now. We will keep this order updated as quotes arrive.';

  @override
  String get couldNotLoadTransportQuotes =>
      'The business quotes could not be loaded. Try again.';

  @override
  String get estimatedPickup => 'Estimated pickup';

  @override
  String get estimatedDelivery => 'Estimated delivery';

  @override
  String get transportMethod => 'Transport method';

  @override
  String get selectTransportQuote => 'Choose this quote';

  @override
  String get selectingTransportQuote => 'Selecting quote...';

  @override
  String get confirmTransportQuoteTitle => 'Choose this transporter?';

  @override
  String confirmTransportQuoteMessage(Object businessName, Object price) {
    return 'Choose $businessName for $price? This closes the request to other businesses.';
  }

  @override
  String get keepComparing => 'Keep comparing';

  @override
  String get chooseThisBusiness => 'Choose this business';

  @override
  String get couldNotSelectTransportQuote =>
      'This quote could not be selected. Check that it is still available and try again.';

  @override
  String get transportQuoteSelectedTitle => 'Transporter selected';

  @override
  String transportQuoteSelectedMessage(Object businessName, Object price) {
    return '$businessName was selected for $price. Your private contact and pickup details are now available to this business.';
  }

  @override
  String get transportRequestCancelled => 'Transport request cancelled';

  @override
  String get transportRequestCancelledSubtitle =>
      'Businesses can no longer send or revise quotes for this request.';

  @override
  String get cancelTransportRequest => 'Cancel transport request';

  @override
  String get cancellingTransportRequest => 'Cancelling request...';

  @override
  String get confirmCancelTransportRequestTitle => 'Cancel this request?';

  @override
  String get confirmCancelTransportRequestMessage =>
      'Businesses will no longer be able to send or revise quotes.';

  @override
  String get keepRequestOpen => 'Keep request open';

  @override
  String get couldNotCancelTransportRequest =>
      'The transport request could not be cancelled. Try again.';

  @override
  String get chooseBusinessAndDestination =>
      'Choose a business and destination.';

  @override
  String get selectCarMakeModelYear => 'Select the car make, model, and year.';

  @override
  String transportRequestSentToBusiness(
    Object businessName,
    Object trackingCode,
  ) {
    return 'Request sent to $businessName. Tracking $trackingCode. They will send you a price quote.';
  }

  @override
  String couldNotSendRequest(Object error) {
    return 'Could not send request: $error';
  }

  @override
  String get pickPreferredDateOptional => 'Pick a preferred date (optional)';

  @override
  String get whoShouldHandleTransport => 'Who should handle it?';

  @override
  String get theCar => 'The car';

  @override
  String get contactAndPickup => 'Contact & pickup';

  @override
  String get businessDestination => 'Business · destination';

  @override
  String get pickupAddressOptional => 'Pickup address (optional)';

  @override
  String get notesForBusinessOptional => 'Notes for the business (optional)';

  @override
  String get enterOwnerName => 'Enter the owner name';

  @override
  String get enterContactPhone => 'Enter a contact phone';

  @override
  String get sending => 'Sending...';

  @override
  String get sendRequest => 'Send request';

  @override
  String get transportQuoteNoPaymentNote =>
      'No payment now — eligible businesses send quotes and you choose which one to accept.';

  @override
  String get noTransportBusinessesYet =>
      'No business is offering car transport yet';

  @override
  String get noTransportBusinessesSubtitle =>
      'Check back soon — businesses add transport routes as they come online.';

  @override
  String get couldNotLoadTransportOptions => 'Could not load transport options';

  @override
  String get receiverWhatsAppNumberTitle =>
      'This receiver number is used on WhatsApp';

  @override
  String get receiverWhatsAppNumberSubtitle =>
      'Use this only if the receiver uses a different country number on WhatsApp.';

  @override
  String get invalidPhoneWithCountryCode =>
      'Enter a valid phone number with country code.';

  @override
  String get invalidInternationalPhone =>
      'Enter a valid international phone number.';

  @override
  String get whatsAppDifferentCountryRequiresCode =>
      'For WhatsApp numbers from another country, include + and the country code.';

  @override
  String receiverPhoneMustMatchDestination(
    Object destinationName,
    Object prefix,
  ) {
    return 'Receiver number must match $destinationName ($prefix) or mark it as a WhatsApp number.';
  }

  @override
  String get readyForPickup => 'Ready for pickup';

  @override
  String get samePickup => 'Same pickup';

  @override
  String get differentPickups => 'Different pickups';

  @override
  String boroughPickupAddress(Object borough) {
    return '$borough pickup address';
  }

  @override
  String get barrelsForThisDestination => 'Barrels for this destination';

  @override
  String get decrease => 'Decrease';

  @override
  String get increase => 'Increase';

  @override
  String get edit => 'Edit';

  @override
  String get remove => 'Remove';

  @override
  String barrelCartLine(int quantity, Object receiverName) {
    String _temp0 = intl.Intl.pluralLogic(
      quantity,
      locale: localeName,
      other: '$quantity barrels',
      one: '1 barrel',
    );
    return '$_temp0 → $receiverName';
  }

  @override
  String holdPricingSummary(Object mode, Object days) {
    return 'Hold pricing: $mode$days';
  }

  @override
  String holdDaysSuffix(Object days) {
    return ' • $days day(s)';
  }

  @override
  String get flat => 'Flat';

  @override
  String forfeitureStatusLabel(Object status) {
    return 'Forfeiture: $status';
  }

  @override
  String get holdDateReachedStaffAction =>
      'Hold date reached. Mark this vehicle as sold or mark the customer as not shown.';

  @override
  String extensionStatusLine(Object status, Object date, Object amount) {
    return 'Extension: $status$date$amount';
  }

  @override
  String dateSuffix(Object date) {
    return ' • $date';
  }

  @override
  String extraAmountSuffix(Object amount) {
    return ' • extra $amount';
  }

  @override
  String buyerHistoryLine(
    Object completed,
    Object noShows,
    Object forfeitures,
  ) {
    return 'Buyer history: $completed completed, $noShows no-show, $forfeitures forfeited';
  }

  @override
  String get customerDidNotCome => 'Customer did not come';

  @override
  String get approveExtension => 'Approve extension';

  @override
  String get rejectExtension => 'Reject extension';

  @override
  String navbarPickerInstructions(int count) {
    return 'Pick up to $count services for quick access in your bottom bar. Drag to reorder.';
  }

  @override
  String get inYourNavbar => 'In your navbar';

  @override
  String get nothingPinnedYet => 'Nothing pinned yet — add services below.';

  @override
  String get addServices => 'Add services';

  @override
  String navbarFullMessage(int count) {
    return 'Navbar is full ($count). Remove one to add another.';
  }

  @override
  String get activeDestinationsRequireFee =>
      'Active destinations require at least one configured service.';

  @override
  String get seedCountriesEmptyInstruction =>
      'Seed the full country catalog, then search and activate the destinations you serve.';

  @override
  String barrelPriceSummary(Object price) {
    return 'Barrel: $price';
  }

  @override
  String deliveryEstimateSummary(Object estimate) {
    return 'Delivery: $estimate';
  }

  @override
  String get businessProfileTitle => 'Business profile';

  @override
  String get splashTagline => 'Motorcars, barrels & passage in one place.';

  @override
  String get splashMarketplace => 'MARKETPLACE';

  @override
  String get splashOpening => 'OPENING LAAWOL';

  @override
  String get accountProfileUnavailable =>
      'The connection is slow. We could not safely load your account role.';

  @override
  String get accountProfileMissing =>
      'Your account profile is missing. Contact Laawol support.';

  @override
  String get accountProfileRetryHelp =>
      'Retry without signing out or losing your session.';

  @override
  String get addMoney => 'Add money';

  @override
  String get myOrders => 'My orders';

  @override
  String get goodMorning => 'Good morning';

  @override
  String get goodAfternoon => 'Good afternoon';

  @override
  String get goodEvening => 'Good evening';

  @override
  String get signInToYourWallet => 'Sign in to your wallet';

  @override
  String get walletSignInSubtitle => 'Track orders, balances and refunds.';

  @override
  String shippingBusinessUnavailable(Object businessName, Object countryName) {
    return '$businessName is not shipping to $countryName, and no alternate business is available yet.';
  }

  @override
  String get shippingBusinessWillChange => 'Shipping business will change';

  @override
  String shippingBusinessChangeMessage(
    Object businessName,
    Object countryName,
  ) {
    return '$businessName does not deliver to $countryName. Choose another approved business to continue.';
  }

  @override
  String get availableBusinesses => 'Available businesses';

  @override
  String deliveryLabel(Object value) {
    return 'Delivery $value';
  }

  @override
  String get pickupDateAndTime => 'Pickup date and time';

  @override
  String get shipmentEstimate => 'Shipment estimate';

  @override
  String get addProfilePicture => 'Add profile picture';

  @override
  String get registerBusinessInstead => 'Register your business instead';

  @override
  String get businessApprovalSetupNote =>
      'You can set up destinations, cars, and staff immediately. Customers will only see your business after platform approval.';

  @override
  String get businessProfilePicture => 'Business profile picture';

  @override
  String get businessProfilePictureHelper =>
      'Upload a logo or storefront image customers can recognize.';

  @override
  String get joinMarketplace => 'Join the marketplace';

  @override
  String get businessApplicationSubtitle =>
      'Apply once, prepare your operations, then go live when approved.';

  @override
  String get businessOperations => 'Business operations';

  @override
  String get businessOperationsWebNote =>
      'Manage freight, barrels, transport, parking, destinations, staff, and payouts in the secure business console. This avoids entering a customer booking or payment flow by mistake.';

  @override
  String get businessCarsMobileNote =>
      'Vehicle listings and purchases are also available in the mobile tabs below.';

  @override
  String get openBusinessConsole => 'Open business console';

  @override
  String get openingBusinessConsole => 'Opening business console...';

  @override
  String get businessConsoleOpenFailed =>
      'Could not open the business console. Visit business.laawoldigital.com in your browser.';

  @override
  String get businessChangesRequestedBanner =>
      'A platform admin requested changes. You can keep editing your setup while the business stays hidden from customers.';

  @override
  String get businessPendingApprovalBanner =>
      'Your business is pending platform approval. You can set up destinations, cars, and staff now; customers will see it after approval.';

  @override
  String totalDaysLabel(Object days) {
    return 'Total Days: $days';
  }

  @override
  String totalCostLabel(Object cost) {
    return 'Total Cost: $cost';
  }

  @override
  String get customerRequest => 'Customer request';

  @override
  String get awaitingQuote => 'Awaiting quote';

  @override
  String get setPriceQuoteInstruction =>
      'Set a price below to send this customer a quote.';

  @override
  String get barrelOrder => 'Barrel order';

  @override
  String barrelOrderSummary(
    Object barrelCount,
    Object destinationCount,
    Object businessCount,
  ) {
    return '$barrelCount barrels • $destinationCount destinations • $businessCount businesses';
  }

  @override
  String get clear => 'Clear';

  @override
  String get signInToSaveBarrelShipment =>
      'Sign in or create an account so we can securely save this barrel shipment and show it in tracking.';

  @override
  String get editDestinationPickupHelp =>
      'Use Edit on each destination row to add or change that destination\'s pickup details.';

  @override
  String get businessesShippingToCountry =>
      'Businesses shipping to this country';

  @override
  String get fixedPickupPriceForBorough =>
      'Fixed pickup price for this borough';

  @override
  String get finalPriceConfirmedByStaff =>
      'Final price will be confirmed by staff.';

  @override
  String get useWalletCredit => 'Use wallet credit';

  @override
  String get whereAreBarrelsGoing => 'Where are these barrels going?';

  @override
  String get addDestinationInstruction =>
      'Add a destination — country, business, who receives it, and how many barrels are going there.';

  @override
  String get addDestination => 'Add a destination';

  @override
  String get destinationsTitle => 'Destinations';

  @override
  String get barrelDestinationStartSummary =>
      'Start with where the barrels are going and how many you are sending.';

  @override
  String barrelDestinationSummary(int barrelCount, int destinationCount) {
    String _temp0 = intl.Intl.pluralLogic(
      barrelCount,
      locale: localeName,
      other: '$barrelCount barrels',
      one: '1 barrel',
    );
    String _temp1 = intl.Intl.pluralLogic(
      destinationCount,
      locale: localeName,
      other: '$destinationCount destinations',
      one: '1 destination',
    );
    return '$_temp0 to $_temp1.';
  }

  @override
  String get addAnotherDestination => 'Add another destination';

  @override
  String get editDestination => 'Edit destination';

  @override
  String destinationNumber(int number) {
    return 'Destination $number';
  }

  @override
  String get saveDestination => 'Save destination';

  @override
  String get addToOrder => 'Add to order';

  @override
  String holdPerDayDescription(int days, Object amount) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days-day hold',
      one: '1-day hold',
    );
    return '$_temp0 at $amount per day';
  }

  @override
  String holdFlatFeeDescription(int days) {
    return 'Flat hold fee for up to $days days';
  }

  @override
  String get pleaseChooseBusiness => 'Please choose a business';

  @override
  String get originalEstimatedCost => 'Original estimated cost';

  @override
  String get walletCredit => 'Wallet credit';

  @override
  String get cardPaymentDue => 'Card payment due';

  @override
  String get addAtLeastOneDestination =>
      'Add at least one destination to this order.';

  @override
  String get noApprovedBusinessShippingDestination =>
      'No approved business is currently shipping to this destination.';

  @override
  String get businessOptionsUnavailable =>
      'Business options are not available right now. Please try again in a moment.';

  @override
  String get gettingYourLocation => 'Getting your location...';

  @override
  String get useMyCurrentLocation => 'Use my current location';

  @override
  String get currentLocationAdded => 'Current location added';

  @override
  String get choosePickupDateAndTime => 'Choose pickup date and time';

  @override
  String get amountDueNow => 'Amount due now';

  @override
  String get estimatedCost => 'Estimated cost';

  @override
  String get supportCenter => 'Support center';

  @override
  String get supportCases => 'Support cases';

  @override
  String get supportInbox => 'Support inbox';

  @override
  String get supportInboxSubtitle =>
      'Customer issues, business replies, and admin escalations.';

  @override
  String get supportChat => 'Support chat';

  @override
  String get getHelp => 'Get help';

  @override
  String get openSupport => 'Open support';

  @override
  String get openingSupport => 'Opening support...';

  @override
  String get writeSupportMessage => 'Write a message';

  @override
  String get sendMessage => 'Send';

  @override
  String get sendingMessage => 'Sending...';

  @override
  String get supportMessageRequired => 'Write a message before sending.';

  @override
  String get supportNoCases => 'No support cases yet';

  @override
  String get supportNoCasesSubtitle =>
      'Cases appear here when customers ask a business for help.';

  @override
  String get supportSearch => 'Search support cases';

  @override
  String get supportBusinessFirst => 'Business first';

  @override
  String get supportEscalated => 'Escalated';

  @override
  String get supportResolved => 'Resolved';

  @override
  String get supportWaitingBusiness => 'Waiting for business';

  @override
  String get supportWaitingCustomer => 'Waiting for customer';

  @override
  String get supportAdminReviewing => 'Admin reviewing';

  @override
  String get supportUrgent => 'Urgent';

  @override
  String get supportNormal => 'Normal';

  @override
  String get supportLinkedRecord => 'Linked record';

  @override
  String get supportCustomer => 'Customer';

  @override
  String get supportBusiness => 'Business';

  @override
  String get supportPlatformAdmin => 'Laawol admin';

  @override
  String get supportAskPlatform => 'Ask Laawol admin to help';

  @override
  String get businessSupportAskAdmin => 'Ask platform admin';

  @override
  String get businessSupportTitle => 'Ask platform admin for help';

  @override
  String get businessSupportSubtitle =>
      'Send a support request to Laawol admins about your business account, operations, payouts, or platform access.';

  @override
  String get businessSupportSubject => 'Support subject';

  @override
  String get businessSupportSubjectRequired => 'Enter a support subject.';

  @override
  String get supportEscalating => 'Escalating...';

  @override
  String get supportEscalationTitle => 'Ask Laawol admin to help';

  @override
  String get supportEscalationSubtitle =>
      'Use this when the business cannot resolve the issue or the issue is urgent.';

  @override
  String get supportEscalationReason => 'Escalation reason';

  @override
  String get supportEscalationNote => 'Add details for the admin';

  @override
  String get supportEscalationUnavailable =>
      'Admin escalation becomes available after the business response window unless the issue is urgent.';

  @override
  String get supportEscalationUrgentOnly =>
      'Normal escalation unlocks after the business response window. Urgent reasons can be sent now.';

  @override
  String get supportAlreadyEscalatedTitle =>
      'Already escalated to Laawol admin';

  @override
  String get supportAlreadyEscalatedSubtitle =>
      'This case is already in the Laawol admin queue.';

  @override
  String get supportReasonUnresolved => 'Business did not resolve it';

  @override
  String get supportReasonFraud => 'Fraud or suspicious activity';

  @override
  String get supportReasonSafety => 'Safety concern';

  @override
  String get supportReasonAbuse => 'Abusive behavior';

  @override
  String get supportReasonPaymentNoService =>
      'Payment taken, service not provided';

  @override
  String get supportReasonBusinessUnreachable => 'Business unreachable';

  @override
  String get supportReasonTimeSensitive =>
      'Pickup or delivery is time-sensitive';

  @override
  String get supportEvidence => 'Evidence';

  @override
  String get supportAddImage => 'Add image';

  @override
  String get supportAddAttachment => 'Add attachment';

  @override
  String get supportAttachmentSheetTitle => 'Add attachment';

  @override
  String get supportPhoto => 'Photo';

  @override
  String get supportVideo => 'Video';

  @override
  String get supportFile => 'File';

  @override
  String get supportUploading => 'Uploading...';

  @override
  String get supportReviewAttachmentTitle => 'Review attachment';

  @override
  String get supportUploadAttachment => 'Upload';

  @override
  String get supportReplaceAttachment => 'Replace';

  @override
  String get supportAttachmentCaption => 'Caption (optional)';

  @override
  String get supportPreviewUnavailable =>
      'Preview unavailable. You can still upload this file.';

  @override
  String get supportUploadFailed => 'Upload failed. Try again.';

  @override
  String get supportUploadFailedNetwork =>
      'Upload failed. Check your connection and try again.';

  @override
  String get supportUploadFailedAuth =>
      'Upload failed because your sign-in expired. Sign in again, then retry.';

  @override
  String get supportUploadFailedPermission =>
      'Upload failed because your account cannot add files to this support case.';

  @override
  String get supportUploadFailedInvalidFile =>
      'Upload failed because this file type or size is not allowed.';

  @override
  String get supportUploadFailedAppVerification =>
      'Upload blocked by app verification. Update the app or contact support.';

  @override
  String get supportUploadFailedDebugAppCheck =>
      'Upload blocked by Firebase App Check. Register this debug device token, then retry.';

  @override
  String supportImagePreviewLabel(Object name) {
    return 'Image preview: $name';
  }

  @override
  String get supportRequestEvidence => 'Request evidence';

  @override
  String get supportRequestingEvidence => 'Requesting...';

  @override
  String get supportEvidenceNote => 'What should the customer add?';

  @override
  String get supportResolve => 'Mark resolved';

  @override
  String get supportResolving => 'Resolving...';

  @override
  String get supportReopen => 'Reopen';

  @override
  String get supportReopening => 'Reopening...';

  @override
  String get supportInternalNotes => 'Internal notes';

  @override
  String get supportAddInternalNote => 'Add internal note';

  @override
  String get supportSavingNote => 'Saving note...';

  @override
  String get supportNote => 'Note';

  @override
  String get supportTimeline => 'Timeline';

  @override
  String get supportActions => 'Actions';

  @override
  String get supportFilters => 'Filters';

  @override
  String get supportAllCases => 'All cases';

  @override
  String get supportSlaBreaches => 'SLA breaches';

  @override
  String get supportFraudSafety => 'Fraud and safety';

  @override
  String get supportOpenFromTransaction =>
      'Open a case with the responsible business. If unresolved, a Laawol admin can mediate.';

  @override
  String get supportCaseOpened => 'Support case opened';

  @override
  String get supportActionFailed => 'Support action failed';

  @override
  String get supportImageSource => 'Choose an image';

  @override
  String get supportCamera => 'Camera';

  @override
  String get supportGallery => 'Gallery';

  @override
  String supportReplyingTo(Object name) {
    return 'Replying to $name';
  }

  @override
  String get supportEdited => 'edited';

  @override
  String get supportReply => 'Reply';

  @override
  String get supportDeleteForMe => 'Delete for me';

  @override
  String get supportEditMessage => 'Edit message';

  @override
  String get supportSaveEdit => 'Save edit';

  @override
  String get supportCancelReply => 'Cancel reply';

  @override
  String supportCaseStatusLabel(Object status) {
    return 'Status: $status';
  }

  @override
  String get support => 'Support';

  @override
  String get supportTeam => 'Support team';

  @override
  String get supportCase => 'Support case';

  @override
  String get supportBusinessInbox => 'Business support';

  @override
  String get supportBusinessInboxSubtitle =>
      'Review customer cases, request evidence, and coordinate with Laawol support.';

  @override
  String get supportAdminQueue => 'Support queue';

  @override
  String get supportAdminQueueSubtitle =>
      'Assign, escalate, resolve, and document marketplace cases.';

  @override
  String get supportNewCase => 'New case';

  @override
  String get supportUnavailable => 'Support is unavailable';

  @override
  String get supportSignInRequired =>
      'Sign in to open and review support cases.';

  @override
  String get supportBusinessRequired =>
      'A business profile is required to use business support.';

  @override
  String get supportUnableToLoad => 'Unable to load support';

  @override
  String get supportSearchCases => 'Search cases';

  @override
  String get supportNoCasesDesc =>
      'Support conversations and updates will appear here.';

  @override
  String get supportLastMessageFallback =>
      'Open the case to continue the conversation.';

  @override
  String get supportStatusOpen => 'Open';

  @override
  String get supportStatusWaitingCustomer => 'Waiting on customer';

  @override
  String get supportStatusWaitingBusiness => 'Waiting on business';

  @override
  String get supportStatusResolved => 'Resolved';

  @override
  String get supportStatusClosed => 'Closed';

  @override
  String get supportFilterWaiting => 'Waiting';

  @override
  String get supportPriorityNormal => 'Normal';

  @override
  String get supportPriorityUrgent => 'Urgent';

  @override
  String get supportPriorityEscalated => 'Escalated';

  @override
  String get supportCategory => 'Category';

  @override
  String get supportCategoryGeneral => 'General';

  @override
  String get supportCategoryPayment => 'Payment';

  @override
  String get supportCategoryDelivery => 'Delivery';

  @override
  String get supportCategoryVehicle => 'Vehicle';

  @override
  String get supportCategoryBarrel => 'Barrel';

  @override
  String get supportCategoryTransport => 'Transport';

  @override
  String get supportCategoryRefund => 'Refund';

  @override
  String get supportAdmin => 'Admin';

  @override
  String get supportSystem => 'System';

  @override
  String get supportSubject => 'Subject';

  @override
  String get supportInitialMessage => 'Initial message';

  @override
  String get supportCreateCase => 'Create case';

  @override
  String get supportCreatingCase => 'Creating case...';

  @override
  String get supportCaseActions => 'Case actions';

  @override
  String get supportAssignToMe => 'Assign to me';

  @override
  String get supportResolveCase => 'Resolve case';

  @override
  String get supportReopenCase => 'Reopen case';

  @override
  String get supportEvidenceRequested => 'Evidence requested';

  @override
  String get supportEvidenceAttached => 'Evidence attached';

  @override
  String get supportEvidenceUploaded => 'Evidence uploaded.';

  @override
  String get supportEscalateCase => 'Escalate case';

  @override
  String get supportEscalate => 'Escalate';

  @override
  String get supportCaseEscalated => 'Case escalated.';

  @override
  String get supportEvidenceRequest => 'Evidence request';

  @override
  String get supportSendRequest => 'Send request';

  @override
  String get supportSendingRequest => 'Sending request...';

  @override
  String get supportEvidenceRequestSent => 'Evidence request sent.';

  @override
  String get supportResolutionNote => 'Resolution note';

  @override
  String get supportCaseResolved => 'Case resolved.';

  @override
  String get supportReopenReason => 'Reopen reason';

  @override
  String get supportCaseReopened => 'Case reopened.';

  @override
  String get supportCaseAssigned => 'Case assigned.';

  @override
  String get supportInternalNote => 'Internal note';

  @override
  String get supportSaveNote => 'Save note';

  @override
  String get supportInternalNoteSaved => 'Internal note saved.';

  @override
  String get supportMessage => 'Message';

  @override
  String get supportMessageHint => 'Write a message...';

  @override
  String get supportSendMessage => 'Send message';

  @override
  String get supportNoMessages => 'No messages yet';

  @override
  String get supportNoMessagesDesc =>
      'Send the first message to start this support thread.';

  @override
  String get supportNoInternalNotes => 'No internal notes';

  @override
  String get supportNoInternalNotesDesc =>
      'Admin notes for this case will appear here.';

  @override
  String get supportUnassigned => 'Unassigned';

  @override
  String get supportResolvedComposerDisabled =>
      'This case is resolved. Reopen it to send another message.';

  @override
  String get supportSystemMessage => 'System update';

  @override
  String get supportDeletedMessage => 'This message was deleted';

  @override
  String get supportAttachment => 'Attachment';

  @override
  String get supportAddEvidence => 'Add evidence';

  @override
  String get supportUploadImageEvidence => 'Upload image evidence';

  @override
  String get supportAddFileMetadata => 'Add file metadata';

  @override
  String get supportAddVoiceMetadata => 'Add voice metadata';

  @override
  String get supportImageAttachment => 'Image attachment';

  @override
  String get supportVoiceAttachment => 'Voice message';

  @override
  String get supportFileAttachment => 'File attachment';

  @override
  String get supportVideoAttachment => 'Video attachment';

  @override
  String get supportOpenAttachment => 'Open attachment';

  @override
  String supportVoiceDuration(Object duration) {
    return 'Voice $duration';
  }

  @override
  String supportAttachmentSize(Object size) {
    return '$size';
  }

  @override
  String get supportFileName => 'File name';

  @override
  String get supportFileUrl => 'File URL';

  @override
  String get supportDurationSeconds => 'Duration in seconds';

  @override
  String get supportSizeBytes => 'Size in bytes';

  @override
  String get supportFileReadFailed =>
      'Could not read that file. Please try again.';

  @override
  String get supportUnsupportedAttachmentType =>
      'Choose a PDF, text, Word, or DOCX file.';

  @override
  String get supportImageTooLarge => 'Choose an image smaller than 10 MB.';

  @override
  String get supportVideoTooLarge => 'Choose a video smaller than 50 MB.';

  @override
  String get supportDocumentTooLarge => 'Choose a document smaller than 25 MB.';

  @override
  String get supportVoiceTooLarge => 'Choose an audio file smaller than 10 MB.';

  @override
  String get supportAttach => 'Attach';

  @override
  String get supportAttaching => 'Attaching...';

  @override
  String supportPurchaseCaseSubject(Object carTitle) {
    return 'Support for $carTitle';
  }

  @override
  String get supportSharedBarrelCaseSubject => 'Shared barrel support';

  @override
  String get supportPlatformSenderName => 'Laawol support';

  @override
  String get supportBusinessSenderName => 'Business';

  @override
  String get parkingStepWhereWhen => 'Where & when';

  @override
  String get parkingStepChooseSpot => 'Choose a spot';

  @override
  String get parkingStepYourCar => 'Your car';

  @override
  String get parkingStepReview => 'Review';

  @override
  String parkingStepIndicator(Object current, Object total) {
    return 'Step $current of $total';
  }

  @override
  String get parkingContinue => 'Continue';

  @override
  String get parkingBack => 'Back';

  @override
  String get parkingReviewHeading => 'Review & reserve';

  @override
  String get parkingReviewVehicle => 'Vehicle';

  @override
  String get parkingReviewDates => 'Dates';

  @override
  String get parkingReviewPickupYes => 'Pickup requested';

  @override
  String get parkingReviewPickupNo => 'No pickup';

  @override
  String get hubGuestName => 'there';

  @override
  String get hubQuickActions => 'Quick actions';

  @override
  String get hubSendBarrel => 'Send a barrel';

  @override
  String get hubShipFullBarrel => 'Ship a full barrel home';

  @override
  String get hubBrowseCars => 'Browse cars';

  @override
  String get hubBuyVerifiedCar => 'Buy a verified car';

  @override
  String get hubFollowShipments => 'Follow your shipments';

  @override
  String get hubShipping => 'Shipping';

  @override
  String get hubShippingSubtitle => 'Send barrels, freight, and cars home.';

  @override
  String get hubSharedBarrels => 'Shared barrels';

  @override
  String get hubSharedBarrelsSubtitle => 'Post or join a barrel';

  @override
  String get hubFreightSubtitle => 'By weight · air or sea';

  @override
  String get hubTransportCar => 'Transport a car';

  @override
  String get hubShipCarHome => 'Ship a car home';

  @override
  String get hubCarsSubtitle =>
      'Buy a verified car or store one with a business.';

  @override
  String get hubParkCarSubtitle => 'Store with a business';

  @override
  String get hubActivitySubtitle => 'Your orders, shipments, and wallet.';

  @override
  String get hubOrdersSubtitle => 'Cars, barrels, freight & more';

  @override
  String get hubWalletSubtitle => 'Balance & refunds';

  @override
  String get destinationPickupDetailsRequired =>
      'Edit each destination and add its pickup address, date, and time.';

  @override
  String get destinationPickupDetailsHelp =>
      'Edit each destination with its pickup place and date.';

  @override
  String get noShowHistory => 'No-show history';

  @override
  String get noShowHistoryMessage =>
      'If you do not return by the hold date and the business marks that you did not come, the deposit may be forfeited and this outcome may be visible to car-selling businesses.';

  @override
  String get holdUntil => 'Hold until';

  @override
  String get marketplaceResponsibilityTitle =>
      'Understand who provides this service';

  @override
  String marketplaceProviderResponsibilityBody(Object providerNames) {
    return '$providerNames is an independent business responsible for the item or service, including fulfillment, condition, delivery timing, and performance.';
  }

  @override
  String get marketplacePaymentFlowBody =>
      'Laawol helps you find businesses, collects and processes your payment, may deduct a disclosed platform fee, and may transfer the business payout later. Laawol can assist with tracking, support, refunds, and disputes.';

  @override
  String get marketplaceNoGuaranteeBody =>
      'Laawol is not the seller, carrier, or service provider and does not guarantee the business’s delivery date or performance. This does not limit rights that cannot legally be waived.';

  @override
  String get marketplaceResponsibilityCheckbox =>
      'I understand the business’s responsibility and want to continue.';

  @override
  String get selectedBusiness => 'The selected business';

  @override
  String get accountLegalAcceptance =>
      'I agree to Laawol’s Terms of Service and Privacy Policy, including its marketplace role.';

  @override
  String get accountLegalAcceptanceRequired =>
      'Please accept the Terms of Service and Privacy Policy to continue.';

  @override
  String get businessResponsibilityAcceptance =>
      'I understand that my business is independently responsible for its listings, prices, goods, services, fulfillment, delivery timing, permits, and customer obligations.';

  @override
  String get businessResponsibilityRequired =>
      'Confirm the business responsibility statement to submit your application.';

  @override
  String get verifyPhoneToContinueTitle => 'Verify your phone to continue';

  @override
  String get verifyPhoneToContinueBody =>
      'Shared barrels are available only to customers with a verified phone number. We’ll send a code to the number in your account.';

  @override
  String get verifyPhone => 'Verify phone';

  @override
  String get notNow => 'Not now';

  @override
  String get phoneVerificationTitle => 'Phone verification';

  @override
  String get phoneVerificationExplanation =>
      'Confirm or update the mobile number for your account. We’ll text you a one-time verification code.';

  @override
  String get phoneVerificationCountryCodeHelp =>
      'Choose the country code, then enter the mobile number.';

  @override
  String get phoneVerificationCodeSentTitle => 'Code sent';

  @override
  String phoneVerificationCodeSent(Object phone) {
    return 'Enter the 6-digit code sent to $phone.';
  }

  @override
  String get phoneVerificationCode => 'Verification code';

  @override
  String get phoneVerificationSendCode => 'Send verification code';

  @override
  String get phoneVerificationSendingCode => 'Sending code...';

  @override
  String get phoneVerificationVerifying => 'Verifying...';

  @override
  String get phoneVerificationResending => 'Resending...';

  @override
  String get phoneVerificationResent => 'A new code was sent.';

  @override
  String get phoneVerificationResend => 'Resend code';

  @override
  String phoneVerificationResendIn(int seconds) {
    return 'Resend code in ${seconds}s';
  }

  @override
  String get phoneVerificationChangeNumber => 'Change number';

  @override
  String get phoneVerificationSmsNotice =>
      'Standard SMS and data rates may apply. The code is used only to verify that this phone belongs to you.';

  @override
  String get phoneVerificationInvalidPhone =>
      'Enter a valid international phone number beginning with + and the country code.';

  @override
  String get phoneVerificationEnterCode => 'Enter the 6-digit code.';

  @override
  String get phoneVerificationInvalidCode =>
      'That code is incorrect. Check it and try again.';

  @override
  String get phoneVerificationExpiredCode =>
      'That code expired. Request a new code and try again.';

  @override
  String get phoneVerificationTooManyAttempts =>
      'Too many verification attempts. Please wait and try again later.';

  @override
  String get phoneVerificationNetworkError =>
      'Check your connection and try again.';

  @override
  String get phoneVerificationRequestTimedOut =>
      'We didn’t receive a response. Check your connection and try again.';

  @override
  String get phoneVerificationPhoneInUse =>
      'That phone number is already linked to another account.';

  @override
  String get phoneVerificationRecentLogin =>
      'For security, sign out, sign back in, and verify your phone again.';

  @override
  String get phoneVerificationAppCheck =>
      'App security check failed. Register this debug device in Firebase App Check, then reopen the app.';

  @override
  String get phoneVerificationGenericError =>
      'We couldn’t verify your phone. Please try again.';

  @override
  String get phoneVerificationSyncPending =>
      'Your code was accepted, but we couldn’t finish updating your profile. Try finishing verification again—another SMS is not required.';

  @override
  String get phoneVerificationFinish => 'Finish verification';

  @override
  String get phoneVerificationFinishing => 'Finishing verification...';

  @override
  String get phoneVerificationSavePhoneFirst =>
      'Save this phone number before verifying it.';

  @override
  String get phoneVerificationSaveAndVerify => 'Save and verify';

  @override
  String get phoneVerificationSavingNumber => 'Saving number...';

  @override
  String get phoneVerificationEditedStatus =>
      'This number has not been saved or verified.';

  @override
  String get phoneVerificationUnverifiedHelp =>
      'Verify this number to use protected account features.';

  @override
  String get phoneVerificationVerifiedHelp =>
      'This number matches the phone securely verified on your account.';

  @override
  String get phoneVerificationSuccess => 'Your phone number is verified.';

  @override
  String get phoneVerificationSuccessTitle => 'Phone verified';

  @override
  String get phoneVerificationReturnToSharedBarrels =>
      'Return to shared barrels';

  @override
  String get phoneVerificationVerified => 'Phone verified';

  @override
  String get phoneVerificationNotVerified => 'Phone not verified';

  @override
  String get phoneCountryCode => 'Country code';

  @override
  String get selectCountryCode => 'Select country code';

  @override
  String get phoneCountrySearchHint => 'Search country or code';

  @override
  String get noCountryCodesFound => 'No country codes found';

  @override
  String get sharedBarrelActionFailed =>
      'We couldn’t complete that shared-barrel action. Please try again.';

  @override
  String get sharedBarrelsLoadFailed =>
      'Check your connection and try again. Your information is safe.';

  @override
  String get sharedBarrelFormLoadFailed =>
      'We couldn’t open the shared-barrel form. Check your connection and try again.';

  @override
  String get marketplaceBalancePaymentSummary => 'Balance payment';

  @override
  String get marketplaceDestinationChangeSummary => 'Paid destination change';

  @override
  String get freightPickupSectionTitle => 'Freight pickup';

  @override
  String get freightPickupSectionSubtitle =>
      'Offer to collect parcels from your customer\'s address, and choose how the fee is calculated.';

  @override
  String get freightPickupOfferToggle => 'Offer freight pickup';

  @override
  String get freightPickupModelDistance => 'By distance';

  @override
  String get freightPickupModelBorough => 'By borough';

  @override
  String get freightPickupDistanceHint =>
      'Fee = base fee + per-km rate × driving distance from your address. Leave rates at 0 to offer free pickup.';

  @override
  String get freightPickupOriginAddress => 'Pickup origin address';

  @override
  String get freightPickupOriginAddressHelper =>
      'Where your drivers start from. Defaults to your business address.';

  @override
  String get freightPickupBaseFee => 'Base fee';

  @override
  String get freightPickupPerKm => 'Per km';

  @override
  String get freightPickupMinFee => 'Minimum fee';

  @override
  String get freightPickupMaxKm => 'Max distance (km)';

  @override
  String get freightPickupBoroughHint =>
      'Set a flat pickup fee for each New York City borough you serve. Leave blank for boroughs you don\'t cover.';

  @override
  String get freightPickupBoroughPriceRequired =>
      'Set a pickup fee for at least one borough, or turn off freight pickup.';

  @override
  String get freightPickupCustomerToggle => 'Pick up from my address';

  @override
  String get freightPickupAddressLabel => 'Pickup address';

  @override
  String get freightPickupBoroughLabel => 'Borough';

  @override
  String get freightPickupDateTimeLabel => 'Pickup date & time';

  @override
  String get freightPickupChooseDateTime => 'Choose date & time';

  @override
  String get freightPickupFeeLabel => 'Pickup fee';

  @override
  String get freightPickupCalculating => 'Calculating pickup fee…';

  @override
  String get freightPickupEnterDetailsForFee =>
      'Enter your pickup details to see the fee.';

  @override
  String get freightPickupSelectDateTime =>
      'Please choose a pickup date and time.';

  @override
  String get freightPickupUnavailableCustomer =>
      'This business doesn\'t offer pickup right now.';

  @override
  String get freightPickupOutOfRangeCustomer =>
      'Your address is outside this business\'s pickup area.';

  @override
  String get freightPickupQuoteFailed =>
      'We couldn\'t calculate the pickup fee. Check the address and try again.';

  @override
  String freightPickupDistanceAway(String distanceKm) {
    return '$distanceKm km away';
  }

  @override
  String get freightPickupFreeLabel => 'Free pickup';

  @override
  String get freightAirDepartureDays => 'Air freight departure days';

  @override
  String get freightSeaDepartureDays => 'Sea freight departure days';

  @override
  String get freightDepartureDaysHelper =>
      'Optional. Choose the regular days this service departs.';

  @override
  String get mondayShort => 'Mon';

  @override
  String get tuesdayShort => 'Tue';

  @override
  String get wednesdayShort => 'Wed';

  @override
  String get thursdayShort => 'Thu';

  @override
  String get fridayShort => 'Fri';

  @override
  String get saturdayShort => 'Sat';

  @override
  String get sundayShort => 'Sun';

  @override
  String regularDepartureDays(String days) {
    return 'Regular departures: $days';
  }

  @override
  String get allPeople => 'All people';

  @override
  String get platformAdministrators => 'Platform administrators';

  @override
  String get businessOwners => 'Business owners';

  @override
  String get pendingInvitations => 'Pending invitations';

  @override
  String get missingProfiles => 'Missing profiles';

  @override
  String get suspendedAccounts => 'Suspended accounts';

  @override
  String get people => 'People';

  @override
  String get invitePerson => 'Invite person';

  @override
  String get searchPeopleHint => 'Search exact email, phone, or user ID';

  @override
  String get clearSearch => 'Clear search';

  @override
  String get loadMorePeople => 'Load more people';

  @override
  String get peopleCouldNotLoad => 'People could not be loaded';

  @override
  String get tryAgain => 'Try again';

  @override
  String get notProvided => 'Not provided';

  @override
  String get noPeopleFound => 'No people found';

  @override
  String get noPeopleFoundHelp =>
      'Try another filter or search for an exact email, phone number, or user ID.';

  @override
  String get peopleAccessRestricted => 'People access is restricted';

  @override
  String get peopleAccessRestrictedHelp =>
      'Your administrator role does not include permission to view marketplace people.';

  @override
  String get you => 'You';

  @override
  String get platformAdministrator => 'Platform administrator';

  @override
  String get businessStaffMember => 'Business staff member';

  @override
  String get pendingInvitation => 'Pending invitation';

  @override
  String get missingProfile => 'Missing profile';

  @override
  String get invitationPending => 'Invitation pending';

  @override
  String get deletionPending => 'Deletion pending';

  @override
  String get authenticationMissing => 'Authentication missing';

  @override
  String get identityAndAccess => 'Identity & access';

  @override
  String get emailVerification => 'Email verification';

  @override
  String get verified => 'Verified';

  @override
  String get notVerified => 'Not verified';

  @override
  String get businessAccess => 'Business access';

  @override
  String get businessPermissions => 'Business permissions';

  @override
  String get businessPermissionsHelp =>
      'Grant only the tools this person needs. You can adjust access later.';

  @override
  String get noAssignedPermissions => 'No assigned permissions';

  @override
  String get cannotChangeOwnAccess =>
      'For safety, you cannot change your own access from this screen.';

  @override
  String get accountActions => 'Account actions';

  @override
  String get suspendAccount => 'Suspend account';

  @override
  String get suspendAccountConfirm =>
      'This person will immediately lose access and all active sessions will be revoked.';

  @override
  String get restoreAccount => 'Restore account';

  @override
  String get restoreAccountConfirm =>
      'This person will be allowed to sign in again.';

  @override
  String get accountSuspended => 'Account suspended';

  @override
  String get accountRestored => 'Account restored';

  @override
  String get revokeSessions => 'Revoke active sessions';

  @override
  String get sessionsRevoked => 'Active sessions revoked';

  @override
  String get sendPasswordReset => 'Send password reset';

  @override
  String get passwordResetSent => 'Password reset requested';

  @override
  String get sendVerificationEmail => 'Send verification email';

  @override
  String get verificationEmailSent => 'Verification email requested';

  @override
  String get transferOwnership => 'Transfer business ownership';

  @override
  String get transferOwnershipConfirm =>
      'This staff member will become the business owner and the current owner will become staff.';

  @override
  String get ownershipTransferred => 'Business ownership transferred';

  @override
  String get resendInvitation => 'Resend invitation';

  @override
  String get invitationResent => 'Invitation resent';

  @override
  String get cancelInvitation => 'Cancel invitation';

  @override
  String get cancelInvitationConfirm =>
      'This invitation will no longer be usable.';

  @override
  String get invitationCancelled => 'Invitation cancelled';

  @override
  String get reviewDeletionRequest => 'Review account deletion';

  @override
  String get deletionBlocked => 'Deletion is blocked';

  @override
  String deletionBlockedByRecords(int count) {
    return '$count active or legally retained record(s) must be resolved before this account can be deleted.';
  }

  @override
  String get finalizeAccountDeletion => 'Finalize account deletion';

  @override
  String get finalizeAccountDeletionConfirm =>
      'This permanently removes access after the server confirms there are no blocking records. This cannot be undone.';

  @override
  String get accountDeletionFinalized => 'Account deletion finalized';

  @override
  String get adminApprovedDeletion =>
      'Deletion reviewed and approved by a platform administrator.';

  @override
  String get invitePlatformAdministrator => 'Invite platform administrator';

  @override
  String get invitePlatformAdministratorHelp =>
      'Choose a limited administrator role. Super-admin access is never granted by invitation.';

  @override
  String get inviteBusinessPersonnel => 'Invite business personnel';

  @override
  String get inviteBusinessPersonnelHelp =>
      'Select the business and the exact tools this person can use.';

  @override
  String get sendInvitation => 'Send invitation';

  @override
  String get invitationSent => 'Invitation sent';

  @override
  String get adminRole => 'Administrator role';

  @override
  String get superAdministrator => 'Super administrator';

  @override
  String get operationsManager => 'Operations manager';

  @override
  String get financeManager => 'Finance manager';

  @override
  String get supportAdministrator => 'Support administrator';

  @override
  String get contentManager => 'Content manager';

  @override
  String get profile => 'Profile';

  @override
  String get listings => 'Listings';

  @override
  String get barrels => 'Barrels';

  @override
  String get freight => 'Freight';

  @override
  String get transport => 'Transport';

  @override
  String get parking => 'Parking';

  @override
  String get destinations => 'Destinations';

  @override
  String get growth => 'Growth';

  @override
  String get invitationProfileSetupTitle =>
      'Finish setting up your invited access';

  @override
  String get invitationProfileSetupHelp =>
      'Verify this email address, then return here to activate the role you were invited to.';

  @override
  String get verifyInvitedEmail => 'Send verification email';

  @override
  String get sendingVerificationEmail => 'Sending verification email…';

  @override
  String get iVerifiedContinue => 'I verified — continue';

  @override
  String get invitationVerificationEmailSent =>
      'Verification email sent. Check your inbox, then return here.';

  @override
  String get invitationVerificationEmailFailed =>
      'The verification email could not be sent. Please try again.';
}
