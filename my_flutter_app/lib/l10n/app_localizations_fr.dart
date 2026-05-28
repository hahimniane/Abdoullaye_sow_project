// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for French (`fr`).
class AppLocalizationsFr extends AppLocalizations {
  AppLocalizationsFr([String locale = 'fr']) : super(locale);

  @override
  String get welcomeBack => 'Bon Retour';

  @override
  String get signInToAccount => 'Connectez-vous à votre compte';

  @override
  String get accountLoginTitle => 'Connexion au compte';

  @override
  String get accountLoginSubtitle =>
      'Connectez-vous pour accéder à vos reçus enregistrés, suivre votre activité et gérer les outils du personnel.';

  @override
  String get email => 'Email';

  @override
  String get enterEmail => 'Entrez votre email';

  @override
  String get password => 'Mot de passe';

  @override
  String get enterPassword => 'Entrez votre mot de passe';

  @override
  String get signIn => 'Se Connecter';

  @override
  String get forgotPassword => 'Mot de passe oublié ?';

  @override
  String get pleaseEnterEmail => 'Veuillez entrer votre email';

  @override
  String get pleaseEnterValidEmail => 'Veuillez entrer un email valide';

  @override
  String get pleaseEnterPassword => 'Veuillez entrer votre mot de passe';

  @override
  String get passwordMinLength =>
      'Le mot de passe doit contenir au moins 6 caractères';

  @override
  String get forgotPasswordTitle => 'Mot de passe oublié ?';

  @override
  String get enterEmailToReset =>
      'Entrez votre email pour réinitialiser votre mot de passe';

  @override
  String get resetPassword => 'Réinitialiser le mot de passe';

  @override
  String get backToLogin => 'Retour à la connexion';

  @override
  String get emailSent => 'Email envoyé !';

  @override
  String get emailSentMessage =>
      'Nous avons envoyé un lien de réinitialisation à votre adresse email. Veuillez vérifier votre boîte de réception et suivre les instructions.';

  @override
  String get language => 'Langue';

  @override
  String get english => 'Anglais';

  @override
  String get french => 'Français';

  @override
  String get welcomeToBusinessServices =>
      'Bienvenue aux Services d\'Entreprise';

  @override
  String get chooseServiceToStart => 'Choisissez un service pour commencer';

  @override
  String get servicesTab => 'Services';

  @override
  String get activityTab => 'Activité';

  @override
  String get serviceOverview => 'Aperçu des services';

  @override
  String get parkACar => 'Garer une Voiture';

  @override
  String get sendBarrelsToGuinea => 'Envoyer des Barils en Guinée';

  @override
  String get transportCarsToGuinea => 'Transporter des Voitures en Guinée';

  @override
  String get sellCars => 'Vendre des Voitures';

  @override
  String get carParkingService => 'Service de Stationnement';

  @override
  String get enterCarDetailsToGenerateReceipt =>
      'Entrez les détails de la voiture pour générer un reçu';

  @override
  String get printReceipt => 'Imprimer le Reçu';

  @override
  String get name => 'Nom';

  @override
  String get make => 'Marque';

  @override
  String get model => 'Modèle';

  @override
  String get year => 'Année';

  @override
  String get vinNumber => 'Numéro VIN';

  @override
  String get parkingDate => 'Date de Stationnement';

  @override
  String get parkingDateTime => 'Date et Heure de Stationnement';

  @override
  String get selectDateTime => 'Sélectionner Date et Heure';

  @override
  String get receiptGenerated =>
      'Reçu généré et envoyé à l\'imprimante avec succès !';

  @override
  String errorGeneratingReceipt(Object error) {
    return 'Erreur lors de la génération du reçu : $error';
  }

  @override
  String get pleaseEnterOwnerName => 'Veuillez entrer le nom du propriétaire';

  @override
  String get pleaseEnterCarMake => 'Veuillez entrer la marque de la voiture';

  @override
  String get pleaseEnterCarModel => 'Veuillez entrer le modèle de la voiture';

  @override
  String get pleaseEnterCarYear => 'Veuillez entrer l\'année de la voiture';

  @override
  String get pleaseEnterVinNumber => 'Veuillez entrer le numéro VIN';

  @override
  String get pleaseEnterSenderName => 'Veuillez entrer le nom de l\'expéditeur';

  @override
  String get pleaseEnterSenderAddress =>
      'Veuillez entrer l\'adresse de l\'expéditeur';

  @override
  String get pleaseEnterReceiverName =>
      'Veuillez entrer le nom du destinataire';

  @override
  String get pleaseEnterReceiverPhone =>
      'Veuillez entrer le téléphone du destinataire';

  @override
  String get pleaseEnterPrice => 'Veuillez entrer le prix';

  @override
  String get pleaseEnterValidNumber => 'Veuillez entrer un nombre valide';

  @override
  String shipmentSavedWithTracking(Object trackingCode) {
    return 'Expédition enregistrée. Numéro de suivi : $trackingCode';
  }

  @override
  String failedToSaveShipment(Object error) {
    return 'Échec de l\'enregistrement de l\'expédition : $error';
  }

  @override
  String parkingSavedWithTracking(Object trackingCode) {
    return 'Stationnement enregistré. Numéro de suivi : $trackingCode';
  }

  @override
  String get barrelShipmentDetails => 'Détails de l\'expédition de barils';

  @override
  String get senderInformation => 'Informations sur l\'expéditeur';

  @override
  String get receiverInformation => 'Informations sur le destinataire';

  @override
  String get shipmentSummary => 'Résumé de l\'expédition';

  @override
  String get createdOnLabel => 'Créé le';

  @override
  String get statusLabel => 'Statut';

  @override
  String get updateShipment => 'Mettre à jour l\'expédition';

  @override
  String get reprintReceipt => 'Réimprimer le reçu';

  @override
  String get shipmentUpdatedSuccessfully =>
      'Expédition mise à jour avec succès !';

  @override
  String failedToUpdateShipment(Object error) {
    return 'Échec de la mise à jour de l\'expédition : $error';
  }

  @override
  String get trackingNumber => 'Numéro de suivi';

  @override
  String get trackingNumberCopied =>
      'Numéro de suivi copié dans le presse-papiers';

  @override
  String get shipmentStatusPending => 'En attente';

  @override
  String get shipmentStatusInTransit => 'En transit';

  @override
  String get shipmentStatusCompleted => 'Terminé';

  @override
  String get shipmentStatusCompletedNotice =>
      'Cette expédition est marquée comme terminée et ne peut plus être modifiée.';

  @override
  String get done => 'Terminé';

  @override
  String get account => 'Compte';

  @override
  String get role => 'Rôle';

  @override
  String get logout => 'Déconnexion';

  @override
  String get signOutOfAccount => 'Se déconnecter de votre compte';

  @override
  String get accountOptionalMessage =>
      'Créez un compte (optionnel) pour enregistrer vos reçus et synchroniser votre activité sur tous vos appareils.';

  @override
  String get customer => 'Client';

  @override
  String get staff => 'Personnel';

  @override
  String get barrelShippingService => 'Service d\'Expédition de Barils';

  @override
  String get enterShippingDetailsForGuinea =>
      'Entrez les détails d\'expédition pour la Guinée';

  @override
  String get submit => 'Soumettre';

  @override
  String get senderName => 'Nom de l\'Expéditeur';

  @override
  String get address => 'Adresse';

  @override
  String get receiverName => 'Nom du Destinataire';

  @override
  String get receiverPhone => 'Téléphone du Destinataire';

  @override
  String get price => 'Prix';

  @override
  String get carTransportService => 'Service de Transport de Voitures';

  @override
  String get enterCarTransportDetailsForGuinea =>
      'Entrez les détails de transport de voiture pour la Guinée';

  @override
  String get ownerName => 'Nom du Propriétaire';

  @override
  String get carMake => 'Marque de Voiture';

  @override
  String get carModel => 'Modèle de Voiture';

  @override
  String get carYear => 'Année de la Voiture';

  @override
  String get transportDate => 'Date de Transport';

  @override
  String get carSalesService => 'Service de Vente de Voitures';

  @override
  String get availableCars => 'Voitures disponibles';

  @override
  String get browsePurchaseReserve =>
      'Parcourez l\'inventaire, réservez une visite ou achetez directement dans l\'application.';

  @override
  String get inStock => 'En stock';

  @override
  String get viewings => 'Visites';

  @override
  String get byAppointment => 'Sur rendez-vous';

  @override
  String get filters => 'Filtres';

  @override
  String get clearFilters => 'Effacer';

  @override
  String get applyFilters => 'Appliquer';

  @override
  String filteredResults(Object count) {
    return '$count filtres actifs';
  }

  @override
  String get yearRange => 'Années';

  @override
  String get minYear => 'Année min.';

  @override
  String get maxYear => 'Année max.';

  @override
  String get maxPrice => 'Prix max.';

  @override
  String get sortBy => 'Trier par';

  @override
  String get newestYear => 'Année récente';

  @override
  String get oldestYear => 'Année ancienne';

  @override
  String get priceLowToHigh => 'Prix : croissant';

  @override
  String get priceHighToLow => 'Prix : décroissant';

  @override
  String get browseAvailableCarsForSale =>
      'Parcourir les voitures disponibles à la vente';

  @override
  String get searchCars => 'Rechercher des voitures...';

  @override
  String get chatWithSeller => 'Discuter avec le Vendeur';

  @override
  String get toyotaCamry => 'Toyota Camry';

  @override
  String get hondaAccord => 'Honda Accord';

  @override
  String get fordEscape => 'Ford Escape';

  @override
  String yearLabel(Object year) {
    return 'Année : $year';
  }

  @override
  String mileageLabel(Object mileage) {
    return 'Kilométrage : $mileage';
  }

  @override
  String get mileage => 'kilométrage';

  @override
  String get carDetails => 'Détails de la Voiture';

  @override
  String get contactSeller => 'Contacter le Vendeur';

  @override
  String get viewMorePhotos => 'Voir Plus de Photos';

  @override
  String get carDescription => 'Description de la Voiture';

  @override
  String get features => 'Caractéristiques';

  @override
  String get contactInfo => 'Informations de Contact';

  @override
  String get sendWhatsAppMessage => 'Envoyer un Message WhatsApp';

  @override
  String whatsAppMessage(Object carPrice, Object carTitle, Object carYear) {
    return 'Salut ! Je suis intéressé par la $carTitle ($carYear) pour $carPrice. Pouvez-vous fournir plus de détails ?';
  }

  @override
  String get noResultsFound => 'Aucun résultat trouvé';

  @override
  String get tryDifferentSearch => 'Essayez un terme de recherche différent';

  @override
  String get home => 'Accueil';

  @override
  String get settings => 'Paramètres';

  @override
  String get appInformation => 'Informations sur l\'Application';

  @override
  String get appVersion => 'Version de l\'Application';

  @override
  String get companyName => 'Nom de l\'Entreprise';

  @override
  String get contactUs => 'Nous Contacter';

  @override
  String get phoneNumber => 'Numéro de Téléphone';

  @override
  String get emailAddress => 'Adresse Email';

  @override
  String get about => 'À Propos';

  @override
  String get privacyPolicy => 'Politique de Confidentialité';

  @override
  String get termsOfService => 'Conditions d\'Utilisation';

  @override
  String get manageCars => 'Gérer les Voitures';

  @override
  String get recentActivity => 'Activité récente';

  @override
  String get filterAll => 'Tous';

  @override
  String get filterParking => 'Voitures garées';

  @override
  String get filterBarrels => 'Envois de barils';

  @override
  String get filterTransport => 'Transport de voitures';

  @override
  String get filterSales => 'Ventes de voitures';

  @override
  String get totalCars => 'Total des Voitures';

  @override
  String get activeCars => 'Voitures Actives';

  @override
  String get inactiveCars => 'Voitures Inactives';

  @override
  String get processing => 'En cours';

  @override
  String get completed => 'Terminé';

  @override
  String get noRecordsYet =>
      'Aucun enregistrement pour le moment. Commencez à enregistrer vos activités ici.';

  @override
  String get recordReference => 'Référence';

  @override
  String get active => 'Actif';

  @override
  String get inactive => 'Inactif';

  @override
  String get addNewCar => 'Ajouter une Nouvelle Voiture';

  @override
  String get carTitle => 'Titre de la Voiture';

  @override
  String get cancel => 'Annuler';

  @override
  String get add => 'Ajouter';

  @override
  String get invalidCredentials => 'Email ou mot de passe invalide';

  @override
  String get backToCustomerHome => 'Retour à l\'Accueil Client';

  @override
  String get trackShipment => 'Suivre l\'Expédition';

  @override
  String get tracking => 'Suivi';

  @override
  String get userManagement => 'Gestion des Utilisateurs';

  @override
  String get setAsCustomer => 'Définir comme Client';

  @override
  String get setAsStaff => 'Définir comme Personnel';

  @override
  String get setAsAdmin => 'Définir comme Administrateur';

  @override
  String get addStaffMember => 'Ajouter un Membre du Personnel';

  @override
  String get users => 'Utilisateurs';

  @override
  String get noUsersFound => 'Aucun utilisateur trouvé.';

  @override
  String get enterStaffEmail => 'Entrez l\'email du personnel';

  @override
  String get enterTemporaryPassword => 'Entrez le mot de passe temporaire';

  @override
  String userRoleUpdated(Object role) {
    return 'Rôle utilisateur mis à jour vers $role';
  }

  @override
  String failedToUpdateUserRole(Object error) {
    return 'Échec de la mise à jour du rôle de l\'utilisateur : $error';
  }

  @override
  String get deleteUser => 'Supprimer l\'utilisateur';

  @override
  String get confirmDeletion => 'Confirmer la suppression';

  @override
  String confirmDeleteUser(Object email) {
    return 'Êtes-vous sûr de vouloir supprimer l\'utilisateur $email ?';
  }

  @override
  String get delete => 'Supprimer';

  @override
  String userDeleted(Object email) {
    return 'Utilisateur $email supprimé avec succès';
  }

  @override
  String failedToDeleteUser(Object error) {
    return 'Échec de la suppression de l\'utilisateur : $error';
  }

  @override
  String get staffMemberAddedSuccessfully =>
      'Membre du personnel ajouté avec succès !';

  @override
  String failedToAddStaffMember(String error) {
    return 'Échec de l\'ajout du membre du personnel : $error';
  }

  @override
  String get admin => 'Administrateur';

  @override
  String get signUp => 'S\'inscrire';

  @override
  String get createAccount => 'Créer un Compte';

  @override
  String get signUpToGetStarted =>
      'Créez un compte gratuit avec les détails nécessaires pour réserver une visite et enregistrer vos achats.';

  @override
  String get fullName => 'Nom complet';

  @override
  String get enterFullName => 'Entrez votre nom complet';

  @override
  String get pleaseEnterFullName => 'Veuillez entrer votre nom complet';

  @override
  String get enterPhoneNumber => 'Entrez votre numéro de téléphone';

  @override
  String get pleaseEnterPhoneNumber =>
      'Veuillez entrer un numéro de téléphone valide';

  @override
  String get confirmPassword => 'Confirmer le Mot de Passe';

  @override
  String get reEnterPassword => 'Entrez à nouveau votre mot de passe';

  @override
  String get pleaseConfirmPassword => 'Veuillez confirmer votre mot de passe';

  @override
  String get passwordsDoNotMatch => 'Les mots de passe ne correspondent pas';

  @override
  String get alreadyHaveAccount => 'Vous avez déjà un compte ?';

  @override
  String get dontHaveAccount => 'Vous n\'avez pas de compte ?';

  @override
  String get accountCreatedSuccessfully => 'Compte créé avec succès !';

  @override
  String transportRequestSavedWithTracking(Object trackingCode) {
    return 'Demande de transport enregistrée avec le code de suivi : $trackingCode';
  }

  @override
  String failedToSaveTransport(Object error) {
    return 'Échec de l\'enregistrement de la demande de transport : $error';
  }

  @override
  String get transportUpdatedSuccessfully =>
      'Demande de transport mise à jour avec succès !';

  @override
  String failedToUpdateTransport(Object error) {
    return 'Échec de la mise à jour de la demande de transport : $error';
  }

  @override
  String get updateTransport => 'Mettre à jour le Transport';

  @override
  String get transportStatusCompletedNotice =>
      'Cette demande de transport est marquée comme terminée et ne peut plus être modifiée.';

  @override
  String get transportRequestDetails =>
      'Détails de la Demande de Transport de Voiture';

  @override
  String operationFailed(Object error) {
    return 'Une erreur s\'est produite : $error';
  }

  @override
  String get activate => 'Activer';

  @override
  String get deactivate => 'Désactiver';

  @override
  String get activateSuccess => 'Statut de la voiture défini sur actif.';

  @override
  String get deactivateSuccess => 'Statut de la voiture défini sur inactif.';

  @override
  String get carCreated => 'Voiture ajoutée avec succès !';

  @override
  String get carUpdated => 'Voiture mise à jour avec succès !';

  @override
  String get saleRecorded => 'Informations de vente enregistrées.';

  @override
  String get requiredField => 'Ce champ est obligatoire';

  @override
  String get soldCars => 'Voitures vendues';

  @override
  String get markAsSold => 'Marquer comme vendu';

  @override
  String get sold => 'Vendu';

  @override
  String get carMileage => 'Kilométrage';

  @override
  String get sellingPrice => 'Prix affiché';

  @override
  String get carFeaturesHint => 'Caractéristiques (séparées par des virgules)';

  @override
  String get carImagesHint => 'URL d\'images (séparées par des virgules)';

  @override
  String get contactName => 'Nom du contact';

  @override
  String get contactPhone => 'Téléphone du contact';

  @override
  String get contactEmail => 'Email du contact';

  @override
  String get saveCar => 'Enregistrer la voiture';

  @override
  String get updateCar => 'Mettre à jour la voiture';

  @override
  String get editCar => 'Modifier la voiture';

  @override
  String get addCar => 'Ajouter une voiture';

  @override
  String get customerName => 'Nom du client';

  @override
  String get customerPhone => 'Téléphone du client';

  @override
  String get customerEmail => 'Email du client';

  @override
  String get customerEmailOptional => 'Email du client (optionnel)';

  @override
  String get customerAddressOptional => 'Adresse du client (optionnelle)';

  @override
  String get salePrice => 'Montant de la vente';

  @override
  String get saleDate => 'Date de vente';

  @override
  String get additionalNotes => 'Notes supplémentaires';

  @override
  String get confirmSale => 'Confirmer la vente';

  @override
  String get noCarsFound => 'Aucune voiture pour le moment';

  @override
  String get addYourFirstCar =>
      'Ajoutez votre première voiture pour commencer.';

  @override
  String get noCarsAvailable =>
      'Aucune voiture n\'est disponible pour le moment.';

  @override
  String get checkBackSoon =>
      'Revenez bientôt pour découvrir notre inventaire.';

  @override
  String get contactUnavailable => 'Contact non disponible';

  @override
  String get noDescriptionAvailable => 'Aucune description disponible.';

  @override
  String get noFeaturesAvailable => 'Aucune caractéristique listée.';

  @override
  String get soldInfo => 'Détails de la vente';

  @override
  String soldTo(Object name) {
    return 'Vendu à $name';
  }

  @override
  String soldOn(Object date) {
    return 'Vendu le $date';
  }

  @override
  String soldPriceLabel(Object price) {
    return 'Prix de vente : $price';
  }

  @override
  String get imagesLabel => 'Images';

  @override
  String get addImages => 'Ajouter des images';

  @override
  String get noImagesSelected => 'Aucune image sélectionnée pour le moment.';

  @override
  String get addImagesPrompt => 'Veuillez ajouter au moins une image.';

  @override
  String get coverLabel => 'Couverture';

  @override
  String get setAsCover => 'Définir comme couverture';

  @override
  String get themeLabel => 'Apparence';

  @override
  String get darkMode => 'Mode sombre';

  @override
  String get lightMode => 'Mode clair';

  @override
  String get reserved => 'Réservé';

  @override
  String get reserveWithDeposit => 'Réserver avec un acompte de 500 \$';

  @override
  String get loginRequiredForDeposit =>
      'Veuillez vous connecter avant de payer un acompte.';

  @override
  String get reserveThisCar => 'Réserver cette voiture';

  @override
  String depositSummary(Object amount) {
    return 'Un acompte de réservation remboursable de $amount est requis pour retenir ce véhicule.';
  }

  @override
  String get payDeposit => 'Payer l\'acompte';

  @override
  String get reservationComplete =>
      'Acompte reçu. Votre réservation est maintenant active.';

  @override
  String get loginRequiredForPurchase =>
      'Veuillez vous connecter avant d\'acheter cette voiture.';

  @override
  String get purchaseThisCar => 'Acheter cette voiture';

  @override
  String get reserveViewing => 'Réserver une visite';

  @override
  String get reserveViewingSummary =>
      'Choisissez une heure disponible pour venir voir ce véhicule. Nous garderons la voiture pour votre rendez-vous.';

  @override
  String get selectViewingTime => 'Heures de visite disponibles';

  @override
  String get selectViewingTimeRequired =>
      'Veuillez sélectionner une heure de visite.';

  @override
  String get confirmViewingReservation => 'Confirmer la visite';

  @override
  String viewingReservationComplete(Object time) {
    return 'Votre visite est réservée pour $time.';
  }

  @override
  String get accountRequiredTitle => 'Connectez-vous pour continuer';

  @override
  String get accountRequiredReserveMessage =>
      'Créez un compte ou connectez-vous afin que nous puissions enregistrer votre rendez-vous et garder la voiture pour vous.';

  @override
  String get accountRequiredPurchaseMessage =>
      'Créez un compte ou connectez-vous afin que nous puissions enregistrer votre achat en toute sécurité et l\'afficher dans Mes achats.';

  @override
  String get phoneRequiredForReservation =>
      'Numéro de téléphone requis pour continuer';

  @override
  String purchaseSummary(Object amount) {
    return 'Vous paierez le prix total du véhicule, soit $amount, avec un paiement sécurisé.';
  }

  @override
  String get secureStripeCheckout =>
      'Paiement sécurisé avec Stripe. Votre achat est enregistré une fois le paiement réussi.';

  @override
  String get payNow => 'Payer maintenant';

  @override
  String get purchaseComplete =>
      'Paiement reçu. Cette voiture est maintenant achetée.';

  @override
  String get checkoutUnavailable =>
      'Nous n\'avons pas pu lancer le paiement pour le moment. Veuillez réessayer dans un instant.';

  @override
  String get carAlreadyReserved =>
      'Cette voiture a déjà une réservation active.';

  @override
  String get carNoLongerAvailable => 'Cette voiture n\'est plus disponible.';

  @override
  String get destinationCountry => 'Pays de destination';

  @override
  String get destinationCountriesUnavailable =>
      'Les options de destination ne sont pas disponibles pour le moment. Veuillez réessayer dans un instant.';

  @override
  String get sendBarrels => 'Envoyer des barils';

  @override
  String get enterShippingDetails => 'Entrez les détails d\'expédition';

  @override
  String get transportCars => 'Transporter des voitures';

  @override
  String get enterCarTransportDetails =>
      'Entrez les détails du transport de voiture';

  @override
  String get cars => 'Voitures';

  @override
  String get myPurchases => 'Mes achats';

  @override
  String get noPurchasesYet => 'Aucun achat de voiture pour le moment.';

  @override
  String get purchaseHistoryUnavailable =>
      'Nous n\'avons pas pu charger votre historique d\'achats pour le moment. Veuillez réessayer après la synchronisation de votre compte.';

  @override
  String depositPaid(Object amount, Object status) {
    return 'Paiement : $amount ($status)';
  }

  @override
  String get purchases => 'Achats';

  @override
  String get purchaseReservations => 'Achats de voitures';

  @override
  String get purchaseUpdated => 'Achat mis à jour.';

  @override
  String get cancelled => 'Annulé';

  @override
  String get refunded => 'Remboursé';

  @override
  String get staffTools => 'Outils du personnel';

  @override
  String get destinationCountries => 'Pays de destination';

  @override
  String get manageDestinationCountries =>
      'Gérer les pays disponibles dans les formulaires client.';

  @override
  String get countriesSeeded => 'Catalogue des pays ajouté.';

  @override
  String get countryName => 'Nom du pays';

  @override
  String get countryCode => 'Code du pays';

  @override
  String get seedDefaultCountries => 'Ajouter tous les pays';

  @override
  String get save => 'Enregistrer';
}
