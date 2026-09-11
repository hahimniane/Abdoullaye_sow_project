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
  String get scanVin => 'Scanner le VIN';

  @override
  String get decodeVin => 'Décoder le VIN';

  @override
  String get scanVinText => 'Scanner le texte VIN';

  @override
  String get scanVinInstructions =>
      'Alignez le code-barres VIN dans le cadre. S’il n’y a pas de code-barres, utilisez le scan de texte.';

  @override
  String get useManualEntry => 'Saisie manuelle';

  @override
  String get vinScanNoResult =>
      'Aucun VIN trouvé. Réessayez ou saisissez-le manuellement.';

  @override
  String get vinScanFailed =>
      'Le scan du VIN a échoué. Réessayez ou saisissez-le manuellement.';

  @override
  String get vinCameraUnavailable =>
      'La caméra est indisponible. Vous pouvez toujours saisir le VIN manuellement.';

  @override
  String get invalidVinNumber =>
      'Saisissez un VIN valide de 17 caractères sans I, O ni Q.';

  @override
  String get vinDecodeFailed =>
      'Le VIN n’a pas pu être décodé. Vous pouvez toujours saisir les détails du véhicule manuellement.';

  @override
  String get vinDecoded => 'VIN décodé.';

  @override
  String vinDecodedVehicle(Object vehicle) {
    return 'VIN décodé : $vehicle';
  }

  @override
  String get vinMatchReview =>
      'Vérifiez les détails décodés et complétez les champs qui ne correspondent pas au catalogue.';

  @override
  String get decodedVinDetails => 'Détails VIN décodés';

  @override
  String get vehicle => 'Véhicule';

  @override
  String get bodyStyle => 'Carrosserie';

  @override
  String get engine => 'Moteur';

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
  String shipmentSavedReceiptUnavailable(Object trackingCode) {
    return 'Expédition enregistrée. Numéro de suivi : $trackingCode. Le reçu n’a pas pu être ouvert, mais votre paiement et votre expédition sont bien enregistrés.';
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
  String get shipmentStatusNotStarted => 'Non démarré';

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
  String get navHome => 'Accueil';

  @override
  String get navCars => 'Voitures';

  @override
  String get navBarrels => 'Barils';

  @override
  String get navPurchases => 'Achats';

  @override
  String get navTracking => 'Suivi';

  @override
  String get navBusiness => 'Entreprise';

  @override
  String get navUsers => 'Utilisateurs';

  @override
  String get navSettings => 'Réglages';

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
  String get legalAndPrivacy => 'Mentions légales et confidentialité';

  @override
  String get privacyPolicySubtitle => 'Comment Laawol traite vos informations';

  @override
  String get termsOfServiceSubtitle =>
      'Règles d’utilisation de la plateforme Laawol';

  @override
  String get openLegalLinkFailed =>
      'Impossible d’ouvrir cette page. Veuillez réessayer.';

  @override
  String get accountManagement => 'Gestion du compte';

  @override
  String get deleteAccount => 'Supprimer le compte';

  @override
  String get deleteAccountSubtitle =>
      'Supprimer définitivement votre compte et vos données personnelles';

  @override
  String get deleteAccountTitle => 'Supprimer votre compte Laawol ?';

  @override
  String get deleteAccountExplanation =>
      'Cette action lance la suppression définitive du compte. Vous serez déconnecté et l’accès à votre compte prendra fin.';

  @override
  String get deleteAccountRetentionNotice =>
      'Les dossiers de paiements et de services terminés peuvent être conservés lorsque la comptabilité, les remboursements, les litiges, la prévention de la fraude ou la loi l’exigent. Toutes les autres données personnelles associées seront supprimées ou anonymisées sous 30 jours.';

  @override
  String get enterPasswordToDelete =>
      'Saisissez votre mot de passe pour confirmer';

  @override
  String get confirmDeleteAccount => 'Demander la suppression';

  @override
  String get accountDeletionRequestedTitle => 'Suppression demandée';

  @override
  String get accountDeletionRequestedMessage =>
      'Votre demande a été reçue. Laawol supprimera ou anonymisera les données admissibles du compte sous 30 jours. Vous êtes maintenant déconnecté.';

  @override
  String get accountDeletionWrongPassword => 'Le mot de passe est incorrect.';

  @override
  String get accountDeletionRecentLoginRequired =>
      'Reconnectez-vous, puis réessayez de supprimer le compte.';

  @override
  String get accountDeletionAdminBlocked =>
      'Le compte d’un administrateur de la plateforme doit être supprimé par un autre super administrateur.';

  @override
  String get accountDeletionFailed =>
      'Impossible de lancer la suppression du compte. Réessayez ou contactez l’assistance.';

  @override
  String get manageCars => 'Gérer les Voitures';

  @override
  String get recentActivity => 'Activité récente';

  @override
  String get filterAll => 'Tous';

  @override
  String get trackSearchHint => 'Rechercher suivi, destinataire, pays';

  @override
  String get filterInProgress => 'En cours';

  @override
  String get filterDelivered => 'Livré';

  @override
  String get allDestinations => 'Toutes les destinations';

  @override
  String get noShipmentsMatchFilters =>
      'Aucune expédition ne correspond à vos filtres';

  @override
  String get ordersTitle => 'Mes commandes';

  @override
  String get ordersSearchHint => 'Rechercher commandes, entreprise, pays';

  @override
  String get ordersEmpty => 'Vos commandes payées apparaissent ici';

  @override
  String get ordersNoMatch => 'Aucune commande ne correspond à vos filtres';

  @override
  String get orderTypeCars => 'Voitures';

  @override
  String get orderTypeBarrels => 'Barils';

  @override
  String get orderTypeFreight => 'Fret';

  @override
  String get orderTypeTransport => 'Transport';

  @override
  String get orderTypeParking => 'Stationnement';

  @override
  String get orderStatusPending => 'En attente';

  @override
  String get orderStatusActive => 'Actif';

  @override
  String get orderStatusInTransit => 'En transit';

  @override
  String get orderStatusCompleted => 'Terminé';

  @override
  String get orderStatusCancelled => 'Annulé';

  @override
  String get orderStatusRefunded => 'Remboursé';

  @override
  String get orderLeaveReviewCta => 'Laisser un avis';

  @override
  String get orderReviewedBadge => 'Avis laissé';

  @override
  String get reviews => 'Avis';

  @override
  String get reviewComposerTitle => 'Laisser un avis';

  @override
  String get reviewRatingLabel => 'Comment évalueriez-vous ce service ?';

  @override
  String get reviewRatingRequired =>
      'Veuillez sélectionner une note en étoiles.';

  @override
  String get reviewCommentHint => 'Parlez-nous de votre expérience';

  @override
  String get reviewCommentRequired => 'Veuillez écrire un court commentaire.';

  @override
  String get reviewSubmitButton => 'Envoyer l\'avis';

  @override
  String get reviewSubmitSuccess => 'Merci pour votre avis !';

  @override
  String get reviewSubmitFailed =>
      'Impossible d\'envoyer votre avis. Veuillez réessayer.';

  @override
  String get reviewAlreadySubmitted =>
      'Vous avez déjà laissé un avis pour cette commande.';

  @override
  String get reviewOrderNotCompleted =>
      'Cette commande n\'est pas encore terminée.';

  @override
  String get reviewsSectionTitle => 'Avis des clients';

  @override
  String get reviewsEmpty => 'Aucun avis pour le moment.';

  @override
  String get reviewFlagButton => 'Signaler';

  @override
  String get reviewFlagDialogTitle => 'Signaler cet avis';

  @override
  String get reviewFlagReasonHint => 'Pourquoi signalez-vous cet avis ?';

  @override
  String get reviewFlagSubmit => 'Envoyer le signalement';

  @override
  String get reviewFlagSubmitted => 'Merci, nous allons examiner cela.';

  @override
  String get filterParking => 'Voitures garées';

  @override
  String get filterBarrels => 'Envois de barils';

  @override
  String get filterFreight => 'Fret';

  @override
  String get filterTransport => 'Transport de voitures';

  @override
  String get filterSales => 'Ventes de voitures';

  @override
  String get totalCars => 'Total des Voitures';

  @override
  String get activeCars => 'Voitures actives';

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
  String get setAsCustomer => 'Définir comme client';

  @override
  String get setAsStaff => 'Définir comme personnel';

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
  String get deleteUser => 'Supprimer l’utilisateur';

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
  String get rebuiltTitle => 'Titre reconstruit';

  @override
  String get rebuiltTitleQuestion => 'Titre reconstruit ?';

  @override
  String get rebuiltTitleYes => 'Oui — titre reconstruit';

  @override
  String get rebuiltTitleNo => 'Non — pas de titre reconstruit';

  @override
  String get rebuiltTitleUnknown => 'Non renseigné';

  @override
  String get rebuiltTitleDisclosureHelp =>
      'Obligatoire. Les acheteurs verront cette information.';

  @override
  String get sellingPrice => 'Prix affiché';

  @override
  String get carFeaturesHint => 'Caractéristiques (séparées par des virgules)';

  @override
  String get carImagesHint => 'URL d\'images (séparées par des virgules)';

  @override
  String get contactName => 'Nom du contact';

  @override
  String get contactPhone => 'Téléphone de contact';

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
  String get reserved => 'Réservé';

  @override
  String get reserveWithDeposit => 'Réserver avec acompte';

  @override
  String get reserveWithPaidHold => 'Réserver avec retenue payante';

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
  String get youHaveViewingReserved => 'Vous avez déjà réservé une visite';

  @override
  String get currentViewingTime => 'Heure de visite actuelle';

  @override
  String get changeOrCancelViewingToBookNew =>
      'Pour planifier une autre visite pour cette annonce, modifiez l’heure actuelle ou annulez d’abord cette visite.';

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
  String get carNoLongerAvailable => 'Cette voiture n’est plus disponible';

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
  String get hubViewingsSubtitle => 'Rendez-vous pour voir une voiture';

  @override
  String get myCarViewings => 'Visites de voitures';

  @override
  String get noCarViewingsYet =>
      'Aucune visite pour le moment. Demandez à voir une voiture depuis son annonce.';

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
  String get selectBusinessCountry =>
      'Sélectionnez le pays de votre entreprise';

  @override
  String get selectBusinessCity => 'Sélectionnez la ville de votre entreprise';

  @override
  String get selectBusinessState => 'Sélectionnez l’État de votre entreprise';

  @override
  String get selectCountryFirst => 'Sélectionnez d’abord un pays';

  @override
  String get enterBusinessStreet => 'Saisissez l’adresse de l’entreprise';

  @override
  String get enterValidHeadquartersAddress =>
      'Ajoutez une adresse de siège complète pour que les clients puissent déposer leurs articles.';

  @override
  String get seedDefaultCountries => 'Ajouter tous les pays';

  @override
  String get save => 'Enregistrer';

  @override
  String get signOutQuestion => 'Se déconnecter ?';

  @override
  String get signOutConfirmMessage =>
      'Vous devrez vous reconnecter avant de gérer les expéditions, le portefeuille, les achats ou les outils professionnels.';

  @override
  String get confirmSignOut => 'Se déconnecter';

  @override
  String get walletTitle => 'Portefeuille';

  @override
  String get walletSubtitle =>
      'Consulter les crédits et retourner l’argent sur la carte';

  @override
  String get businesses => 'Entreprises';

  @override
  String get businessesSubtitle =>
      'Approuver et gérer les entreprises de la plateforme';

  @override
  String get businessProfile => 'Profil de l’entreprise';

  @override
  String get businessProfileSubtitle =>
      'Gérer le profil, les services, les destinations et l’équipe';

  @override
  String get businessAdmin => 'Administrateur d’entreprise';

  @override
  String get chooseAtLeastOneService => 'Choisissez au moins un service.';

  @override
  String get businessProfileSaved => 'Profil de l’entreprise enregistré.';

  @override
  String get featureBlurbRequired =>
      'Entrez une courte description de moins de 140 caractères.';

  @override
  String get featureConsentRequired =>
      'Le consentement est requis avant la demande.';

  @override
  String get featureLogoRequired =>
      'Téléversez un logo avant de faire la demande.';

  @override
  String get featureRequestSent =>
      'Demande de mise en avant envoyée pour validation.';

  @override
  String get featuredOnWebsite => 'Mis en avant sur le site';

  @override
  String get featureApprovedMessage =>
      'Votre entreprise est approuvée pour une mise en avant publique.';

  @override
  String get featureRequestedMessage =>
      'Votre demande est en attente de validation par l’administration.';

  @override
  String get featureDefaultMessage =>
      'Demandez une carte marketing publique sur Laawol Digital.';

  @override
  String featureAdminNote(Object note) {
    return 'Note admin : $note';
  }

  @override
  String get uploadLogo => 'Téléverser le logo';

  @override
  String get changeLogo => 'Changer le logo';

  @override
  String get shortPublicBlurb => 'Courte description publique';

  @override
  String get shortPublicBlurbHelper =>
      'Une phrase que les clients peuvent voir.';

  @override
  String get featureConsentLabel =>
      'J’accepte que cette entreprise soit mise en avant publiquement.';

  @override
  String get sendingFeatureRequest => 'Envoi de la demande';

  @override
  String get requestFeaturing => 'Demander la mise en avant';

  @override
  String get noBusinessProfileAssigned =>
      'Aucun profil d’entreprise n’est attribué.';

  @override
  String get businessProfileNotFound => 'Profil de l’entreprise introuvable.';

  @override
  String get destinationsAndShippingFees => 'Destinations et services';

  @override
  String get team => 'Équipe';

  @override
  String get addStaffMemberButton => 'Ajouter un membre du personnel';

  @override
  String get noTeamMembersYet => 'Aucun membre du personnel pour le moment.';

  @override
  String get details => 'Détails';

  @override
  String get businessName => 'Nom de l’entreprise';

  @override
  String get businessPhone => 'Téléphone de l’entreprise';

  @override
  String get businessEmail => 'Email de l’entreprise';

  @override
  String get website => 'Site web';

  @override
  String get serviceNote => 'Note de service';

  @override
  String get noServicesEnabledYet =>
      'Aucun service n’est activé pour le moment.';

  @override
  String get requestReturnToCard => 'Demander le retour sur la carte';

  @override
  String get keepInWallet => 'Garder dans le portefeuille';

  @override
  String couldNotRequestRefund(Object error) {
    return 'Impossible de demander le remboursement : $error';
  }

  @override
  String get returnWalletBalance => 'Retourner le solde du portefeuille';

  @override
  String walletReturnMessage(Object amount) {
    return '$amount sera demandé vers la carte d’origine. Le solde de votre portefeuille passera en remboursement en attente.';
  }

  @override
  String returnToCardRequested(Object amount) {
    return 'Retour de $amount vers la carte demandé.';
  }

  @override
  String get walletBusinessBlocked =>
      'Les portefeuilles servent aux crédits de remboursement des clients. Les outils financiers d’entreprise sont disponibles dans le tableau de bord de la plateforme.';

  @override
  String get availableBalance => 'Solde disponible';

  @override
  String pendingReturnToCard(Object amount) {
    return '$amount en attente de retour vers la carte';
  }

  @override
  String get requestingReturn => 'Demande en cours';

  @override
  String get returnMoneyToCard => 'Retourner l’argent sur la carte';

  @override
  String get walletCreditsInfoWithBalance =>
      'Les crédits du portefeuille proviennent des différences de prix d’expédition. Vous pouvez garder le crédit ici ou demander son retour sur votre carte d’origine.';

  @override
  String get walletCreditsInfoEmpty =>
      'Les crédits de remboursement des prochains changements d’expédition apparaîtront ici.';

  @override
  String get activity => 'Activité';

  @override
  String get destinationRefund => 'Remboursement de destination';

  @override
  String destinationRefundWithCode(Object trackingCode) {
    return 'Remboursement de destination • $trackingCode';
  }

  @override
  String get returnToCardRequestedStatus => 'Retour vers la carte demandé';

  @override
  String get returnedToCard => 'Retourné vers la carte';

  @override
  String get noWalletActivityYet =>
      'Aucune activité de portefeuille pour le moment.';

  @override
  String get walletActivityUnavailable =>
      'Nous n\'avons pas pu charger l\'activité de votre portefeuille pour le moment. Veuillez réessayer dans un instant.';

  @override
  String get signInToViewWallet =>
      'Connectez-vous pour voir votre portefeuille.';

  @override
  String get decline => 'Refuser';

  @override
  String get accept => 'Accepter';

  @override
  String get saveShipmentChangesQuestion =>
      'Enregistrer les modifications de l’expédition ?';

  @override
  String get saveShipmentChangesMessage =>
      'Cela mettra à jour les détails de l’expédition. Les changements de destination peuvent ajuster le portefeuille du client ou les montants de paiement.';

  @override
  String get saveChanges => 'Enregistrer les modifications';

  @override
  String get sender => 'Expéditeur';

  @override
  String get senderQuestion => 'Qui envoie le baril ?';

  @override
  String get pickup => 'Ramassage';

  @override
  String get pickupAddress => 'Adresse de ramassage';

  @override
  String get receiver => 'Destinataire';

  @override
  String get receiverQuestion => 'Qui doit le recevoir à l’étranger ?';

  @override
  String get destination => 'Destination';

  @override
  String get staffControls => 'Contrôles du personnel';

  @override
  String get trackingUpdatesTitle => 'Suivi des mises à jour';

  @override
  String get trackingUpdatesEmpty => 'Aucune mise à jour pour le moment.';

  @override
  String get addTrackingUpdate => 'Ajouter une mise à jour';

  @override
  String get trackingUpdateAdded => 'Mise à jour de suivi ajoutée.';

  @override
  String get trackingUpdateLabel => 'Ce qui s\'est passé';

  @override
  String get trackingUpdateLabelHint => 'ex. Départ du port d\'origine';

  @override
  String get trackingUpdateLabelRequired =>
      'Veuillez décrire ce qui s\'est passé.';

  @override
  String get trackingUpdateLocation => 'Lieu (facultatif)';

  @override
  String get trackingUpdateNotes => 'Remarques (facultatif)';

  @override
  String get containerTrackingTitle => 'Suivi automatique du conteneur';

  @override
  String get containerTrackingDescription =>
      'Entrez le numéro de conteneur, de réservation ou de connaissement du transporteur pour obtenir des mises à jour de suivi automatiques.';

  @override
  String get containerNumberLabel =>
      'Numéro de conteneur / réservation / connaissement';

  @override
  String get containerNumberHint => 'ex. MSKU1234567';

  @override
  String get carrierCodeOptionalLabel =>
      'Code SCAC du transporteur (facultatif)';

  @override
  String get startTrackingButton => 'Démarrer le suivi';

  @override
  String get containerNumberRequired => 'Entrez un numéro de suivi valide.';

  @override
  String get containerTrackingStarted => 'Suivi automatique démarré.';

  @override
  String get automatedTrackingActive => 'Suivi automatique actif';

  @override
  String get automatedTrackingUpdatesPending =>
      'Les mises à jour automatiques ne sont pas encore actives pour ce compte transporteur. Ajoutez des mises à jour manuelles ci-dessous en attendant.';

  @override
  String get shippingBusiness => 'Entreprise d’expédition';

  @override
  String get currentBusiness => 'Entreprise actuelle';

  @override
  String get newRoute => 'Nouvel itinéraire';

  @override
  String get copyTrackingNumber => 'Copier le numéro de suivi';

  @override
  String get receipt => 'Reçu';

  @override
  String get dropOffOffice => 'Bureau de dépôt';

  @override
  String get requestBarrelShipmentQuestion =>
      'Demander l’expédition du baril ?';

  @override
  String get requestBarrelShipmentMessage =>
      'Cela créera l’expédition et lancera le paiement du total estimé.';

  @override
  String get payAndRequest => 'Payer et demander';

  @override
  String get pickUp => 'Ramassage';

  @override
  String get bringToOffice => 'Apporter au bureau';

  @override
  String get locationPermissionDenied =>
      'Autorisation de localisation refusée.';

  @override
  String get couldNotGetLocation =>
      'Impossible d’obtenir la position. Réessayez.';

  @override
  String get pickupAddressInNyc => 'Adresse de ramassage à New York';

  @override
  String get submitTransportRequestQuestion =>
      'Soumettre la demande de transport ?';

  @override
  String get submitTransportRequestMessage =>
      'Cela créera une demande de transport à gérer et suivre par le personnel.';

  @override
  String get submitRequest => 'Soumettre la demande';

  @override
  String get barrelShippingPrice => 'Prix d’expédition du baril';

  @override
  String get minDeliveryDays => 'Jours de livraison min.';

  @override
  String get maxDeliveryDays => 'Jours de livraison max.';

  @override
  String get officeAddress => 'Adresse du bureau';

  @override
  String get barrelPickupPricing => 'Tarifs de ramassage des barils';

  @override
  String get searchCountriesCodesFlags =>
      'Rechercher des pays, codes ou drapeaux';

  @override
  String get business => 'Entreprise';

  @override
  String migrationComplete(Object count) {
    return 'Migration terminée : $count écritures.';
  }

  @override
  String migrationFailed(Object error) {
    return 'Échec de la migration : $error';
  }

  @override
  String get status => 'Statut';

  @override
  String get pending => 'En attente';

  @override
  String get approved => 'Approuvé';

  @override
  String get suspended => 'Suspendu';

  @override
  String get saveBusiness => 'Enregistrer l’entreprise';

  @override
  String get migrateKerenData => 'Migrer les données Keren';

  @override
  String get addBusiness => 'Ajouter une entreprise';

  @override
  String get updatePurchaseStatusQuestion =>
      'Mettre à jour le statut de l’achat ?';

  @override
  String updatePurchaseStatusMessage(Object carTitle, Object status) {
    return 'Cela marquera $carTitle comme $status et mettra à jour la voiture liée.';
  }

  @override
  String get updateStatus => 'Mettre à jour le statut';

  @override
  String get accountProfile => 'Profil du compte';

  @override
  String get profileSaved => 'Profil enregistré.';

  @override
  String get phone => 'Téléphone';

  @override
  String get addPlatformManager => 'Ajouter un gestionnaire de plateforme';

  @override
  String get createAdminSubtitle =>
      'Créer un autre administrateur qui peut gérer la plateforme';

  @override
  String get addBusinessStaff => 'Ajouter du personnel d’entreprise';

  @override
  String get createStaffSubtitle =>
      'Créer un identifiant personnel sous une entreprise';

  @override
  String get noUsersMatch => 'Aucun utilisateur ne correspond à cette vue.';

  @override
  String get manager => 'Gestionnaire';

  @override
  String get managers => 'Gestionnaires';

  @override
  String get owners => 'Propriétaires';

  @override
  String get all => 'Tous';

  @override
  String get businessStaff => 'Personnel d’entreprise';

  @override
  String get searchUsersHint => 'Rechercher nom, email, téléphone, entreprise';

  @override
  String get userActions => 'Actions utilisateur';

  @override
  String get setAsPlatformManager => 'Définir comme responsable de plateforme';

  @override
  String get userId => 'ID utilisateur';

  @override
  String get chooseStaffBusiness => 'Choisissez une entreprise';

  @override
  String get ownerAccount => 'Compte propriétaire';

  @override
  String get ownerFullName => 'Nom complet du propriétaire';

  @override
  String get ownerPhone => 'Téléphone du propriétaire';

  @override
  String get ownerEmail => 'Email du propriétaire';

  @override
  String get servicesYouOffer => 'Services proposés';

  @override
  String get submitBusinessApplicationQuestion =>
      'Soumettre la demande d’entreprise ?';

  @override
  String get submitBusinessApplicationMessage =>
      'Cela créera votre demande de compte entreprise et ouvrira la configuration du tableau de bord pour les services sélectionnés.';

  @override
  String get submitApplication => 'Soumettre la demande';

  @override
  String get chooseAtLeastOneBusinessService =>
      'Choisissez au moins un service d’entreprise.';

  @override
  String get reserveViewingQuestion => 'Réserver une visite ?';

  @override
  String get reserveViewingConfirmMessage =>
      'Cela réservera l’heure de visite choisie pour cette voiture.';

  @override
  String get purchaseCarQuestion => 'Acheter cette voiture ?';

  @override
  String get purchaseCarConfirmMessage =>
      'Cela lancera le paiement et créera un dossier d’achat pour cette voiture.';

  @override
  String get continueToPayment => 'Continuer vers le paiement';

  @override
  String get signUpFailedTryAgain =>
      'L’inscription a échoué. Veuillez réessayer.';

  @override
  String get noApprovedDestinationsAvailable =>
      'Aucune destination active d’entreprise approuvée n’est disponible.';

  @override
  String get trackingNumberCopiedShort => 'Numéro de suivi copié.';

  @override
  String get copy => 'Copier';

  @override
  String get activeShort => 'Actifs';

  @override
  String get pickupShort => 'Ramassage';

  @override
  String get doneShort => 'Terminés';

  @override
  String get platformDashboard => 'Tableau de bord plateforme';

  @override
  String get platformDashboardSubtitle =>
      'Demandes, entreprises, opérations, remboursements et santé de la marketplace.';

  @override
  String get pendingBusinesses => 'Entreprises en attente';

  @override
  String get approvedBusinesses => 'Entreprises approuvées';

  @override
  String get customers => 'Clients';

  @override
  String get openShipments => 'Expéditions ouvertes';

  @override
  String get pendingPurchases => 'Achats en attente';

  @override
  String get refundRequests => 'Demandes de remboursement';

  @override
  String get refundRequest => 'Demande de remboursement';

  @override
  String amountLabel(Object amount) {
    return 'Montant : $amount';
  }

  @override
  String customerLabel(Object customer) {
    return 'Client : $customer';
  }

  @override
  String statusLabelValue(Object status) {
    return 'Statut : $status';
  }

  @override
  String businessLabel(Object business) {
    return 'Entreprise : $business';
  }

  @override
  String get close => 'Fermer';

  @override
  String get platformManagerCreated => 'Gestionnaire de plateforme créé.';

  @override
  String get temporaryPassword => 'Mot de passe temporaire';

  @override
  String get actionQueue => 'File d’actions';

  @override
  String get review => 'Examiner';

  @override
  String get businessManagement => 'Gestion des entreprises';

  @override
  String get openFullList => 'Ouvrir la liste complète';

  @override
  String get financeReadiness => 'Préparation financière';

  @override
  String get recentOperations => 'Opérations récentes';

  @override
  String get businessReviewSaved => 'Examen de l’entreprise enregistré.';

  @override
  String get reviewAction => 'Action d’examen';

  @override
  String get approve => 'Approuver';

  @override
  String get suspend => 'Suspendre';

  @override
  String get reject => 'Rejeter';

  @override
  String get sharedBarrelManageRequests => 'Gérer les demandes';

  @override
  String get sharedBarrelJoinRequests => 'Demandes d’adhésion';

  @override
  String get sharedBarrelJoinRequestsHelp =>
      'Approuvez ou refusez les clients qui souhaitent rejoindre ce baril partagé.';

  @override
  String get sharedBarrelNoPendingRequests =>
      'Aucune demande d’adhésion n’attend d’approbation.';

  @override
  String get sharedBarrelRequestApproved => 'Demande d’adhésion approuvée.';

  @override
  String get sharedBarrelRequestRejected =>
      'Demande d’adhésion refusée. Le remboursement de l’acompte sera lancé.';

  @override
  String get sharedBarrelRequestDecisionFailed =>
      'Impossible de mettre à jour cette demande. Veuillez réessayer.';

  @override
  String sharedBarrelRequestedShareCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count parts demandées',
      one: '1 part demandée',
    );
    return '$_temp0';
  }

  @override
  String sharedBarrelPaidDeposit(Object amount) {
    return 'Acompte payé : $amount';
  }

  @override
  String get sharedBarrelCancelPool => 'Annuler le baril';

  @override
  String get sharedBarrelCancelTitle => 'Annuler ce baril partagé ?';

  @override
  String sharedBarrelCancelForfeitureMessage(Object amount) {
    return 'Si vous annulez maintenant, votre acompte de $amount sera perdu. Cette action est irréversible.';
  }

  @override
  String get sharedBarrelKeepPool => 'Conserver le baril';

  @override
  String get sharedBarrelCancelAndForfeit => 'Annuler et perdre l’acompte';

  @override
  String get requestChanges => 'Demander des modifications';

  @override
  String get reviewNote => 'Note d’examen';

  @override
  String requestId(Object id) {
    return 'ID de demande : $id';
  }

  @override
  String get finalReceiptGenerated =>
      'Reçu final généré et statut défini comme terminé.';

  @override
  String get updateRecord => 'Mettre à jour le dossier';

  @override
  String get generateFinalReceipt => 'Générer le reçu final';

  @override
  String get parkingStartDate => 'Date de début du stationnement';

  @override
  String get parkingEndDate => 'Date de fin du stationnement';

  @override
  String get businessMoreTools => 'Autres outils';

  @override
  String get businessReviewsTitle => 'Avis';

  @override
  String get businessReviewsEmpty =>
      'Pas encore d’avis. Ils apparaissent ici dès que des clients notent une prestation.';

  @override
  String businessReviewsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count avis',
      one: '1 avis',
    );
    return '$_temp0';
  }

  @override
  String get businessPeopleTitle => 'Équipe';

  @override
  String get businessServicesCoverageTitle => 'Services et couverture';

  @override
  String get businessListingsTitle => 'Annonces de véhicules';

  @override
  String get businessPurchasesTitle => 'Achats et visites';

  @override
  String get businessRecordNotFound =>
      'Cette fiche n’est plus disponible ; voici la liste dont elle venait.';

  @override
  String get lotLedgerTitle => 'Registre du parc';

  @override
  String get businessOfficesTitle => 'Agences et points de retrait';

  @override
  String get lotSavedCustomers => 'Clients enregistrés';

  @override
  String get lotTheirCars => 'Leurs véhicules';

  @override
  String get lotOpenReceipt => 'Reçu';

  @override
  String get lotOpenInvoice => 'Facture';

  @override
  String get lotDocumentCouldNotBeOpened =>
      'Le reçu n’a pas pu être ouvert. Réessayez dans un instant.';

  @override
  String get lotUseThisCustomer => 'Utiliser ce client';

  @override
  String get parkingEndDateOptional =>
      'Date de fin du stationnement (facultative)';

  @override
  String get parkingOpenEnded => 'Sans date de fin';

  @override
  String get parkingOpenEndedHint =>
      'Laissez vide pour un séjour sans date de fin — facturez-le jusqu’à aujourd’hui quand vous voulez.';

  @override
  String get parkingClearEndDate => 'Effacer la date de fin';

  @override
  String get costPerDay => 'Coût par jour (\$)';

  @override
  String get selectCountriesAddFees =>
      'Choisissez les pays et sélectionnez ce que cette entreprise propose pour chaque destination.';

  @override
  String activeDestinationsHaveFees(Object priced, Object total) {
    return '$priced destination(s) active(s) sur $total ont des services configurés.';
  }

  @override
  String get selectDestinationCountries =>
      'Sélectionner les services de destination';

  @override
  String get manageDestinationsFees => 'Gérer les destinations et services';

  @override
  String get officeLocations => 'Lieux de dépôt';

  @override
  String get addOfficeLocation => 'Ajouter un lieu de dépôt';

  @override
  String get editOfficeLocation => 'Modifier le lieu de dépôt';

  @override
  String get manageOfficeLocations => 'Gérer les lieux de dépôt';

  @override
  String get officeLocationHelp =>
      'Où les clients peuvent-ils déposer leurs articles en personne ?';

  @override
  String get addOfficeLocationsHelp =>
      'Les bureaux supplémentaires sont facultatifs. Les clients déposent déjà à l’adresse du siège, sauf si vous ajoutez d’autres lieux.';

  @override
  String get locationName => 'Nom du lieu';

  @override
  String activeOfficeLocationsCount(num count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'lieux de dépôt actifs',
      one: 'lieu de dépôt actif',
    );
    return '$count $_temp0.';
  }

  @override
  String get chooseALocation => 'Choisissez un lieu';

  @override
  String locationsAvailableChooseOne(Object count) {
    return '$count lieux disponibles — choisissez-en un';
  }

  @override
  String get servicesForDestination => 'Services pour cette destination';

  @override
  String get servicesForDestinationHelp =>
      'Activez uniquement ce que cette entreprise propose pour ce pays.';

  @override
  String get enableBusinessServiceBeforeDestination =>
      'Activez l’expédition de barils, le fret ou le transport de véhicules dans le profil de l’entreprise avant de configurer la couverture des destinations.';

  @override
  String get destinationServiceCoverageTitle => 'Services de destination';

  @override
  String get destinationServiceCoverageSubtitle =>
      'Définissez les services disponibles pour ce pays et ajoutez les tarifs nécessaires.';

  @override
  String get offerBarrelShipping => 'Expédition de barils';

  @override
  String get barrelShippingDestinationHelper =>
      'Les clients peuvent envoyer des barils vers ce pays.';

  @override
  String get offerFreightAir => 'Fret aérien';

  @override
  String get freightAirDestinationHelper =>
      'Les clients peuvent envoyer des colis par avion vers ce pays.';

  @override
  String get offerFreightSea => 'Fret maritime';

  @override
  String get freightSeaDestinationHelper =>
      'Les clients peuvent envoyer des colis par mer vers ce pays.';

  @override
  String get offerCarTransportDestination =>
      'Expédier des voitures vers ce pays';

  @override
  String get carTransportDestinationHelper =>
      'Les clients peuvent demander un devis de transport de voiture pour ce pays.';

  @override
  String get freightAirRatePerKg => 'Tarif du fret aérien par kg';

  @override
  String get freightSeaRatePerKg => 'Tarif du fret maritime par kg';

  @override
  String get chooseAtLeastOneDestinationService =>
      'Choisissez au moins un service pour cette destination.';

  @override
  String destinationServiceRateRequired(Object service) {
    return 'Ajoutez un tarif pour $service.';
  }

  @override
  String destinationServiceRateGreaterThanZero(Object service) {
    return '$service nécessite un tarif supérieur à 0.';
  }

  @override
  String get destinationBarrelService => 'Baril';

  @override
  String get destinationFreightAir => 'Fret aérien';

  @override
  String get destinationFreightSea => 'Fret maritime';

  @override
  String get destinationCarTransport => 'Transport voiture';

  @override
  String destinationServicePriceSummary(Object service, Object price) {
    return '$service : $price';
  }

  @override
  String destinationServiceRateSummary(Object service, Object rate) {
    return '$service : $rate/kg';
  }

  @override
  String get noDestinationServicesConfigured => 'Aucun service configuré';

  @override
  String get businessNameRequired => 'Le nom de l’entreprise est requis';

  @override
  String get businessPhoneRequired => 'Le téléphone de l’entreprise est requis';

  @override
  String get validBusinessPhoneRequired =>
      'Veuillez entrer un téléphone d’entreprise valide';

  @override
  String get pickupCollectNyc =>
      'Nous le récupérerons à une adresse à New York.';

  @override
  String get pickupBringOffice => 'Vous l’apporterez au bureau.';

  @override
  String get pleaseEnterPickupAddress =>
      'Veuillez entrer l’adresse de ramassage';

  @override
  String get pleaseIncludeNycBoroughZip =>
      'Veuillez inclure l’arrondissement de New York ou le code postal';

  @override
  String get pleaseChoosePickupDateTime =>
      'Veuillez choisir la date et l’heure de ramassage';

  @override
  String get pickupTimeFuture => 'L’heure de ramassage doit être dans le futur';

  @override
  String get destinationSubtitleEstimateRoute =>
      'Choisissez le pays afin que nous puissions estimer l’itinéraire.';

  @override
  String get pickupAddressNycHint => 'ex. 3184 Webster Ave, Bronx, NY 10467';

  @override
  String get pleaseAskStaffSetBarrelPrice =>
      'Veuillez demander au personnel de définir un prix d’expédition de baril pour cette destination avant d’enregistrer.';

  @override
  String get staffControlsSubtitle =>
      'Mettre à jour le statut interne et le prix final.';

  @override
  String get officeDropOff => 'Dépôt au bureau';

  @override
  String deliveryWithLabel(Object label) {
    return 'Livraison $label';
  }

  @override
  String get addBarrelFeeBeforeActivating =>
      'Ajoutez des frais d’expédition de baril avant d’activer.';

  @override
  String get activeDestinationsNeedFee =>
      'Les destinations actives doivent avoir des frais d’expédition de baril supérieurs à 0.';

  @override
  String get addMinimumDeliveryDays =>
      'Ajoutez le nombre minimum de jours de livraison.';

  @override
  String get addMaximumDeliveryDays =>
      'Ajoutez le nombre maximum de jours de livraison.';

  @override
  String get useWholeCalendarDays => 'Utilisez des jours calendaires entiers.';

  @override
  String get deliveryDaysGreaterThanZero =>
      'Les jours de livraison doivent être supérieurs à 0.';

  @override
  String get maxDaysAtLeastMin =>
      'Le nombre maximum de jours doit être au moins égal au minimum.';

  @override
  String get firebaseDeniedDeployRules =>
      'Firebase a refusé l’accès. Déployez les règles Firestore et les fonctions locales, puis ajoutez le catalogue des pays.';

  @override
  String get optionalDeliveryEstimateNote =>
      'Estimation optionnelle en jours calendaires affichée aux clients.';

  @override
  String pickupPriceLabel(Object borough) {
    return 'Prix de ramassage - $borough';
  }

  @override
  String get editBusiness => 'Modifier l’entreprise';

  @override
  String get nameLabel => 'Nom';

  @override
  String get businessesEmpty => 'Aucune entreprise pour le moment.';

  @override
  String get chooseStaffBusinessMessage =>
      'Choisissez l’entreprise à laquelle ce membre du personnel appartient.';

  @override
  String get phoneNumberRequired => 'Veuillez saisir un numéro de téléphone';

  @override
  String get pleaseSelectCarMake =>
      'Veuillez sélectionner la marque de la voiture';

  @override
  String get pleaseSelectCarModel =>
      'Veuillez sélectionner le modèle de la voiture';

  @override
  String get pleaseSelectYear => 'Veuillez sélectionner l’année';

  @override
  String get ownerNameRequired => 'Veuillez saisir le nom du propriétaire';

  @override
  String get carIdentityRequired =>
      'Veuillez vérifier que la marque, le modèle et l’année de la voiture sont sélectionnés.';

  @override
  String get recordUpdated => 'Dossier mis à jour avec succès.';

  @override
  String failedToUpdateRecord(Object error) {
    return 'Échec de la mise à jour du dossier : $error';
  }

  @override
  String get addParkingEndAndDailyCost =>
      'Veuillez ajouter une date de fin et un coût journalier.';

  @override
  String get carIdentityReceiptRequired =>
      'La marque, le modèle et l’année doivent être définis avant de générer un reçu.';

  @override
  String get endDateBeforeStart =>
      'La date de fin ne peut pas être antérieure à la date de début.';

  @override
  String get finalReceiptGeneratedCompleted =>
      'Reçu final généré et statut défini comme terminé.';

  @override
  String failedToGenerateReceipt(Object error) {
    return 'Échec de la génération du reçu : $error';
  }

  @override
  String get costPerDayCurrency => 'Coût par jour (\$)';

  @override
  String get carParkingReceipt => 'REÇU DE STATIONNEMENT';

  @override
  String get businessServices => 'Services professionnels';

  @override
  String get receiptDetails => 'Détails du reçu';

  @override
  String get receiptNumber => 'Numéro du reçu :';

  @override
  String get trackingNumberPdf => 'Numéro de suivi :';

  @override
  String get generatedOn => 'Généré le :';

  @override
  String get carInformation => 'Informations sur la voiture';

  @override
  String get ownerNamePdf => 'Nom du propriétaire :';

  @override
  String get carMakePdf => 'Marque :';

  @override
  String get carModelPdf => 'Modèle :';

  @override
  String get yearPdf => 'Année :';

  @override
  String get vinNumberPdf => 'Numéro VIN :';

  @override
  String get parkingStartPdf => 'Début du stationnement :';

  @override
  String get parkingEndPdf => 'Fin du stationnement :';

  @override
  String get totalDaysPdf => 'Nombre total de jours :';

  @override
  String get billingSummary => 'Récapitulatif de facturation';

  @override
  String get costPerDayPdf => 'Coût par jour :';

  @override
  String get totalCostPdf => 'Coût total :';

  @override
  String get dateTimePdf => 'Date et heure :';

  @override
  String get parkingStatusActive => 'Statut du stationnement : ACTIF';

  @override
  String get vehicleSuccessfullyParked => 'Le véhicule a bien été stationné';

  @override
  String get termsAndConditions => 'Conditions générales';

  @override
  String get parkingReceiptTerms =>
      '• Ce reçu sert de preuve de stationnement\n• Le véhicule sera gardé en sécurité\n• Contactez-nous pour toute question\n• Valable jusqu’à la récupération du véhicule';

  @override
  String get peopleAndAccess => 'Personnes et accès';

  @override
  String get peopleAndAccessSubtitle =>
      'Gérez les identités, les invitations et la sécurité des comptes de la place de marché.';

  @override
  String get platformManagers => 'Responsables de plateforme';

  @override
  String platformManagersCount(Object count) {
    return '$count personnes avec un accès complet à la plateforme';
  }

  @override
  String get businessTeam => 'Équipe de l’entreprise';

  @override
  String businessTeamCount(Object count) {
    return '$count comptes propriétaire/personnel';
  }

  @override
  String customerAccountsCount(Object count) {
    return '$count comptes clients partagés du marketplace';
  }

  @override
  String get noEmail => 'Aucun e-mail';

  @override
  String get platformManager => 'Responsable de plateforme';

  @override
  String get businessOwner => 'Propriétaire de l’entreprise';

  @override
  String get unassignedBusiness => 'Entreprise non attribuée';

  @override
  String currentDestinationShipping(Object amount) {
    return 'Expédition actuelle vers la destination : $amount.';
  }

  @override
  String destinationChangeCollect(Object amount) {
    return '$amount sera encaissé pour le changement de destination.';
  }

  @override
  String destinationChangeCredit(Object amount) {
    return '$amount sera crédité dans votre portefeuille.';
  }

  @override
  String destinationChangePaid(Object amount) {
    return 'Expédition mise à jour. Différence de $amount payée.';
  }

  @override
  String destinationChangeCredited(Object amount) {
    return 'Expédition mise à jour. $amount est en cours de remboursement sur votre carte.';
  }

  @override
  String get shipmentDestinationUpdated =>
      'Destination de l’expédition mise à jour.';

  @override
  String get destinationPaymentInitializationFailed =>
      'Le paiement du changement de destination n’a pas pu être initialisé. Veuillez réessayer.';

  @override
  String get paidShipmentDestinationChangeRequiresSupport =>
      'Cette expédition a déjà été versée à l’entreprise. Contactez l’assistance Laawol pour modifier sa destination en toute sécurité.';

  @override
  String newRouteValue(Object business, Object country) {
    return '$business vers $country';
  }

  @override
  String get noMatchingBusinesses => 'Aucune entreprise correspondante.';

  @override
  String get noOpenShipments => 'Aucun envoi ouvert.';

  @override
  String get noPendingRefundRequests =>
      'Aucune demande de remboursement en attente.';

  @override
  String get refundCredits => 'Crédits de remboursement';

  @override
  String get cardReturnRequest => 'Demande de retour sur carte';

  @override
  String get customerRefundRequest => 'Demande de remboursement client';

  @override
  String get noBusinessApplicationsWaiting =>
      'Aucune demande d’entreprise en attente.';

  @override
  String get noPendingWalletCardReturns =>
      'Aucune demande de retour portefeuille vers carte en attente.';

  @override
  String get stripeConnectPlaceholders =>
      'Les emplacements Stripe Connect sont prêts pour les futurs comptes connectés, paiements et suivis des litiges.';

  @override
  String get creating => 'Création';

  @override
  String get createManager => 'Créer un responsable';

  @override
  String get fullNameRequired => 'Le nom complet est requis';

  @override
  String get emailRequired => 'L’e-mail est requis';

  @override
  String get validEmailRequired => 'Veuillez saisir une adresse e-mail valide';

  @override
  String get phoneRequired => 'Le téléphone est requis';

  @override
  String get passwordRequired => 'Le mot de passe est requis';

  @override
  String get services => 'Services';

  @override
  String get businessIdentitySubtitle =>
      'Comment les clients et l’équipe identifient cette entreprise.';

  @override
  String get businessProfileDetailsSectionError =>
      'Vérifiez les informations d’entreprise indiquées.';

  @override
  String get businessDefaultAddressSubtitle =>
      'C’est l’adresse de dépôt par défaut pour les clients. Les bureaux supplémentaires sont facultatifs.';

  @override
  String get paidHoldPricing => 'Tarif de retenue payante';

  @override
  String get paidHoldPricingSubtitle =>
      'Définissez la règle d’acompte par défaut pour retenir les voitures.';

  @override
  String get flatFee => 'Frais fixe';

  @override
  String get perDay => 'Par jour';

  @override
  String get flatHoldFee => 'Frais fixe de retenue';

  @override
  String get dailyHoldRate => 'Tarif journalier';

  @override
  String get maxDays => 'Jours max.';

  @override
  String get holdMaxDaysHelper => '1 à 30 jours';

  @override
  String get parkingCapacityTitle => 'Capacité de stationnement';

  @override
  String get parkingCapacitySubtitle =>
      'Définissez l’adresse, les places et les prix que les clients peuvent réserver.';

  @override
  String get parkingAddress => 'Adresse du stationnement';

  @override
  String get totalParkingSpaces => 'Places totales';

  @override
  String get blockedParkingSpaces => 'Places bloquées';

  @override
  String get dailyParkingRate => 'Tarif journalier';

  @override
  String get weeklyParkingRate => 'Tarif hebdomadaire';

  @override
  String get monthlyParkingRate => 'Tarif mensuel';

  @override
  String get minimumParkingDays => 'Jours minimum';

  @override
  String get pickupAvailable => 'Collecte disponible';

  @override
  String get pickupAvailableSubtitle =>
      'Les clients peuvent demander la collecte du véhicule avant le stationnement.';

  @override
  String get pickupFee => 'Frais de collecte';

  @override
  String get parkingInstructions => 'Instructions de stationnement';

  @override
  String get enterValidParkingCapacity =>
      'Ajoutez l’adresse, le lieu, les places et le tarif journalier avant d’enregistrer.';

  @override
  String get customerParkingTitle => 'Trouver un stationnement';

  @override
  String get customerParkingSubtitle =>
      'Choisissez où et quand vous voulez garer la voiture. Nous afficherons les entreprises avec des places libres.';

  @override
  String get enterCarDetailsToReserveParking =>
      'Entrez les détails de la voiture pour réserver un stationnement';

  @override
  String get parkingCity => 'Ville de stationnement';

  @override
  String get pleaseEnterParkingCity =>
      'Saisissez la ville où vous voulez garer la voiture.';

  @override
  String get parkingStart => 'Début du stationnement';

  @override
  String get parkingEnd => 'Fin du stationnement';

  @override
  String get searchParking => 'Rechercher un stationnement';

  @override
  String get searchingParking => 'Recherche...';

  @override
  String get availableParkingBusinesses => 'Stationnements disponibles';

  @override
  String get noParkingBusinesses =>
      'Aucune entreprise n’a de stationnement disponible pour ces dates.';

  @override
  String get parkingSearchFailed =>
      'La recherche de stationnement a échoué. Veuillez réessayer.';

  @override
  String availableSpacesCount(Object count) {
    return '$count place(s) disponible(s)';
  }

  @override
  String parkingPricePerDay(Object amount) {
    return '$amount/jour';
  }

  @override
  String parkingEstimatedTotal(Object amount) {
    return 'Total estimé : $amount';
  }

  @override
  String parkingDistanceMiles(Object miles) {
    return 'À $miles mi';
  }

  @override
  String get reserveParking => 'Réserver le stationnement';

  @override
  String get reservingParking => 'Réservation...';

  @override
  String parkingReservationSaved(Object trackingCode) {
    return 'Stationnement réservé. Numéro de suivi : $trackingCode';
  }

  @override
  String get parkingReservationFailed =>
      'Le stationnement n’a pas pu être réservé. Veuillez réessayer.';

  @override
  String get accountRequiredParking =>
      'Connectez-vous pour réserver un stationnement et suivre votre véhicule.';

  @override
  String get parkingDateRangeInvalid =>
      'Choisissez une date de fin après la date de début du stationnement.';

  @override
  String get chooseParkingBusiness =>
      'Choisissez une entreprise avec du stationnement disponible.';

  @override
  String get parkingPickupRequested => 'Collecte demandée';

  @override
  String get parkingPickupOptional =>
      'Demander la collecte si l’entreprise la propose';

  @override
  String get businessServicesSubtitle =>
      'Choisissez ce que cette entreprise peut offrir aux clients.';

  @override
  String businessServicesCount(Object count) {
    return '$count services';
  }

  @override
  String get businessProfileApprovalSubtitle =>
      'Les clients verront ces informations après l’approbation de la plateforme.';

  @override
  String get ownerSignedInSubtitle =>
      'Cette entreprise sera liée à votre compte connecté.';

  @override
  String get ownerCreateLoginSubtitle =>
      'Créez le compte propriétaire pour cette entreprise.';

  @override
  String get servicesOfferSubtitle =>
      'Votre tableau de bord affichera les pages de ces services.';

  @override
  String get ownerPhoneRequired => 'Le téléphone du propriétaire est requis';

  @override
  String get walletBalance => 'Solde du portefeuille';

  @override
  String toReceiverInCountry(Object receiver, Object country) {
    return 'À $receiver en $country';
  }

  @override
  String pickupRequestedWithDate(Object date) {
    return 'Collecte demandée • $date';
  }

  @override
  String get pickupRequested => 'Collecte demandée';

  @override
  String get customerDropOffAtOffice => 'Dépôt client au bureau';

  @override
  String get pendingPayment => 'Paiement en attente';

  @override
  String get requested => 'Demandé';

  @override
  String get inTransit => 'En transit';

  @override
  String get paid => 'Payé';

  @override
  String get paymentPending => 'Paiement en attente';

  @override
  String get paymentCancelled => 'Paiement annulé';

  @override
  String get signInToTrackShipments =>
      'Connectez-vous pour voir vos demandes d’envoi de barils, vos reçus et le statut de collecte.';

  @override
  String get guestTrackingIntro =>
      'Aucun compte n’est nécessaire. Saisissez le numéro figurant sur votre confirmation de réservation ou votre reçu.';

  @override
  String get guestTrackingIdentifierLabel =>
      'Numéro de réservation ou de suivi';

  @override
  String get guestTrackingIdentifierHint => 'Par exemple, BS-K7M4P2';

  @override
  String get guestTrackingRequired =>
      'Saisissez votre numéro de réservation ou de suivi.';

  @override
  String get guestTrackingInvalid =>
      'Saisissez un numéro de réservation ou de suivi valide.';

  @override
  String get guestTrackingSubmit => 'Suivre';

  @override
  String get guestTrackingLoading => 'Vérification du statut…';

  @override
  String get guestTrackingSuccessTitle => 'Suivi trouvé';

  @override
  String get guestTrackingNotFoundTitle => 'Nous n’avons pas trouvé ce numéro';

  @override
  String get guestTrackingNotFoundBody =>
      'Vérifiez le numéro sur votre confirmation ou votre reçu, puis réessayez.';

  @override
  String get guestTrackingRateLimited =>
      'Trop de vérifications ont été effectuées. Patientez quelques minutes, puis réessayez.';

  @override
  String get guestTrackingUnavailable =>
      'Le suivi est temporairement indisponible. Veuillez réessayer bientôt.';

  @override
  String get guestTrackingServiceLabel => 'Service';

  @override
  String get guestTrackingStatusLabel => 'Statut';

  @override
  String guestTrackingUpdatedLabel(Object date) {
    return 'Dernière mise à jour : $date';
  }

  @override
  String get guestTrackingPrivacyNote =>
      'Pour protéger votre vie privée, le suivi sans compte affiche uniquement le statut du service. Connectez-vous pour voir les détails privés et les actions de la réservation.';

  @override
  String get guestTrackingTrackAnother => 'Suivre un autre numéro';

  @override
  String get guestTrackingSignInUpsell => 'Se connecter pour tous les détails';

  @override
  String get guestTrackingServiceBarrel => 'Expédition de barils';

  @override
  String get guestTrackingServiceFreight => 'Fret';

  @override
  String get guestTrackingServiceTransport => 'Transport de voiture';

  @override
  String get guestTrackingServiceParking => 'Stationnement de voiture';

  @override
  String get guestTrackingServiceSharedBarrel => 'Baril partagé';

  @override
  String get guestTrackingServiceFreightQuote => 'Demande de devis de fret';

  @override
  String get guestTrackingStageBooked => 'Réservé';

  @override
  String get guestTrackingStageInTransit => 'En transit';

  @override
  String get guestTrackingStageArrived => 'Arrivé';

  @override
  String get guestTrackingStageDelivered => 'Livré';

  @override
  String get guestTrackingStageCancelled => 'Annulé';

  @override
  String get shipmentsLoadError =>
      'Nous ne pouvons pas charger vos demandes d’envoi pour le moment. Veuillez réessayer bientôt.';

  @override
  String get shipmentsAppearAfterPayment =>
      'Vos demandes d’envoi de barils apparaîtront ici une fois le paiement terminé.';

  @override
  String get registerYourBusiness => 'Enregistrer votre entreprise';

  @override
  String get submittingApplication => 'Envoi de la demande';

  @override
  String get submitBusinessApplication => 'Envoyer la demande d’entreprise';

  @override
  String get businessApplicationSubmittedSetup =>
      'Demande d’entreprise envoyée. Vous pouvez maintenant configurer votre tableau de bord.';

  @override
  String get ownerNameRequiredShort => 'Le nom du propriétaire est requis';

  @override
  String get chooseBusinessImageFirst =>
      'Veuillez d’abord choisir une image pour l’entreprise.';

  @override
  String get validWebsiteRequired => 'Veuillez saisir un site web valide';

  @override
  String get unknown => 'Inconnu';

  @override
  String get cardReturnsSimulatedNotice =>
      'Les retours sur carte sont simulés pour le moment. Gardez cette demande en attente jusqu’à la connexion des vrais remboursements Stripe.';

  @override
  String get noBusinessesYet => 'Aucune entreprise pour le moment.';

  @override
  String get saving => 'Enregistrement';

  @override
  String get saveReview => 'Enregistrer l’avis';

  @override
  String get open => 'Ouvert';

  @override
  String errorDetails(Object error) {
    return 'Erreur : $error';
  }

  @override
  String get carInventoryBasics => 'Bases';

  @override
  String get carInventoryPricing => 'Prix';

  @override
  String get carInventoryDetails => 'Détails';

  @override
  String get carInventoryFeatures => 'Caractéristiques';

  @override
  String get carInventoryMedia => 'Médias';

  @override
  String get carInventoryContact => 'Contact';

  @override
  String get carInventoryReview => 'Vérification';

  @override
  String get next => 'Suivant';

  @override
  String get back => 'Retour';

  @override
  String get publishCar => 'Publier la voiture';

  @override
  String get updateListing => 'Mettre à jour l’annonce';

  @override
  String stepCount(Object current, Object total) {
    return 'Étape $current sur $total';
  }

  @override
  String get condition => 'État';

  @override
  String get bodyType => 'Carrosserie';

  @override
  String get transmission => 'Transmission';

  @override
  String get fuelType => 'Carburant';

  @override
  String get drivetrain => 'Motricité';

  @override
  String get exteriorColor => 'Couleur extérieure';

  @override
  String get interiorColor => 'Couleur intérieure';

  @override
  String get vinOptional => 'VIN (facultatif)';

  @override
  String get stockNumberOptional => 'Référence/stock (facultatif)';

  @override
  String get negotiable => 'Négociable';

  @override
  String get locationCity => 'Ville';

  @override
  String get locationState => 'État';

  @override
  String get minPrice => 'Prix min.';

  @override
  String get minMileage => 'Kilométrage min.';

  @override
  String get maxMileage => 'Kilométrage max.';

  @override
  String get dealer => 'Vendeur';

  @override
  String get location => 'Lieu';

  @override
  String get structuredFeatures => 'Caractéristiques clés';

  @override
  String get customFeatures => 'Caractéristiques personnalisées';

  @override
  String get customFeaturesHint =>
      'Ajoutez des caractéristiques séparées par des virgules';

  @override
  String get conditionNew => 'Neuf';

  @override
  String get conditionUsed => 'Occasion';

  @override
  String get conditionCertified => 'Certifié';

  @override
  String get conditionSalvage => 'Accidenté';

  @override
  String get conditionExcellent => 'Excellent';

  @override
  String get conditionGood => 'Bon';

  @override
  String get conditionFair => 'Correct';

  @override
  String get conditionPoor => 'Mauvais';

  @override
  String get bodySedan => 'Berline';

  @override
  String get bodySuv => 'SUV';

  @override
  String get bodyTruck => 'Pick-up';

  @override
  String get bodyVan => 'Van';

  @override
  String get bodyCoupe => 'Coupé';

  @override
  String get bodyHatchback => 'Hatchback';

  @override
  String get bodyWagon => 'Break';

  @override
  String get bodyConvertible => 'Cabriolet';

  @override
  String get transmissionAutomatic => 'Automatique';

  @override
  String get transmissionManual => 'Manuelle';

  @override
  String get transmissionCvt => 'CVT';

  @override
  String get fuelGas => 'Essence';

  @override
  String get fuelDiesel => 'Diesel';

  @override
  String get fuelHybrid => 'Hybride';

  @override
  String get fuelElectric => 'Électrique';

  @override
  String get fuelPlugInHybrid => 'Hybride rechargeable';

  @override
  String get drivetrainFwd => 'Traction';

  @override
  String get drivetrainRwd => 'Propulsion';

  @override
  String get drivetrainAwd => 'AWD';

  @override
  String get drivetrainFourWd => '4x4';

  @override
  String get featureBackupCamera => 'Caméra de recul';

  @override
  String get featureBluetooth => 'Bluetooth';

  @override
  String get featureLeatherSeats => 'Sièges en cuir';

  @override
  String get featureSunroof => 'Toit ouvrant';

  @override
  String get featureNavigation => 'Navigation';

  @override
  String get featureHeatedSeats => 'Sièges chauffants';

  @override
  String get featureAppleCarPlay => 'Apple CarPlay';

  @override
  String get featureAndroidAuto => 'Android Auto';

  @override
  String get featureBlindSpot => 'Détection angle mort';

  @override
  String get featureThirdRow => 'Troisième rangée';

  @override
  String get featureRemoteStart => 'Démarrage à distance';

  @override
  String get featureKeylessEntry => 'Accès sans clé';

  @override
  String get featureLaneAssist => 'Aide au maintien de voie';

  @override
  String get featureAlloyWheels => 'Jantes alliage';

  @override
  String get featureParkingSensors => 'Capteurs de stationnement';

  @override
  String get featurePremiumAudio => 'Audio premium';

  @override
  String get positivePriceRequired => 'Le prix doit être supérieur à 0.';

  @override
  String get mileageWholeNumberRequired =>
      'Le kilométrage doit être un nombre entier positif ou zéro.';

  @override
  String get vinLengthRequired => 'Le VIN doit contenir 17 caractères.';

  @override
  String get addAtLeastOneImage =>
      'Ajoutez au moins une image de la voiture avant de publier.';

  @override
  String get coverImage => 'Image principale';

  @override
  String get makeCover => 'Définir comme principale';

  @override
  String get removeImage => 'Supprimer l’image';

  @override
  String get listingPreview => 'Aperçu de l’annonce';

  @override
  String get readyToPublish => 'Prêt à publier';

  @override
  String get missingRequiredInfo => 'Informations requises manquantes';

  @override
  String get reviewBeforePublishing =>
      'Vérifiez l’annonce avant sa mise en ligne pour les clients.';

  @override
  String get listingWillStayInactive =>
      'Cette annonce sera enregistrée comme inactive et masquée aux clients.';

  @override
  String get noFilterResults => 'Aucune voiture ne correspond à ces filtres.';

  @override
  String get clearFiltersToSeeCars =>
      'Effacez les filtres pour voir les voitures disponibles.';

  @override
  String get newestListings => 'Annonces récentes';

  @override
  String get mileageLowToHigh => 'Kilométrage : croissant';

  @override
  String get mileageHighToLow => 'Kilométrage : décroissant';

  @override
  String get priceNegotiable => 'Prix négociable';

  @override
  String get financingAvailable => 'Infos financement disponibles';

  @override
  String get any => 'Tous';

  @override
  String get uploadingCar => 'Téléversement de la voiture...';

  @override
  String get fixRequiredFields =>
      'Veuillez corriger les champs requis ci-dessous.';

  @override
  String get selectStateFirst => 'Sélectionnez d’abord un État';

  @override
  String get carColorBlack => 'Noir';

  @override
  String get carColorWhite => 'Blanc';

  @override
  String get carColorSilver => 'Argent';

  @override
  String get carColorGray => 'Gris';

  @override
  String get carColorRed => 'Rouge';

  @override
  String get carColorBlue => 'Bleu';

  @override
  String get carColorGreen => 'Vert';

  @override
  String get carColorYellow => 'Jaune';

  @override
  String get carColorBrown => 'Marron';

  @override
  String get carColorBeige => 'Beige';

  @override
  String get carColorGold => 'Or';

  @override
  String get carColorOrange => 'Orange';

  @override
  String get carColorPurple => 'Violet';

  @override
  String get carColorBurgundy => 'Bordeaux';

  @override
  String get carColorOther => 'Autre';

  @override
  String get otherOption => 'Autre';

  @override
  String get businessLocation => 'Adresse de l’entreprise';

  @override
  String get viewingLocation => 'Lieu de visite';

  @override
  String get reserveCarHoldTitle => 'Blocage payé après la visite';

  @override
  String get reserveCarHoldMessage =>
      'Utilisez cette option après avoir vu la voiture si vous voulez que l’entreprise la garde pendant que vous revenez finaliser le paiement. Si vous ne revenez pas, l’acompte peut être conservé.';

  @override
  String get reserveCarQuestion => 'Réserver cette voiture ?';

  @override
  String reserveCarConfirmMessage(Object amount) {
    return 'Vous paierez $amount maintenant pour retenir cette voiture. L’entreprise peut conserver l’acompte si vous ne revenez pas finaliser l’achat.';
  }

  @override
  String get businessAddressLine1 => 'Adresse de l’entreprise';

  @override
  String get postalCode => 'Code postal';

  @override
  String get useBusinessDefaultAddress =>
      'Utiliser l’adresse par défaut de l’entreprise';

  @override
  String get useCustomViewingAddress => 'Utiliser une autre adresse de visite';

  @override
  String get listingLocationSource => 'Lieu de l’annonce';

  @override
  String get businessAddressMissing =>
      'Ajoutez l’adresse par défaut dans le profil de l’entreprise, ou choisissez une autre adresse de visite.';

  @override
  String get editViewingReservation => 'Modifier la visite';

  @override
  String get changeViewingTime => 'Changer l’heure de visite';

  @override
  String get viewingEditCutoff =>
      'Les rendez-vous de visite peuvent être modifiés jusqu’à une heure avant l’heure prévue.';

  @override
  String get viewingReservationUpdated =>
      'L’heure de visite a été mise à jour.';

  @override
  String get cannotEditViewingReservation =>
      'Cette visite ne peut plus être modifiée.';

  @override
  String get cancelViewingReservation => 'Annuler la visite';

  @override
  String get cancelViewingQuestion => 'Annuler cette visite ?';

  @override
  String get cancelViewingConfirmMessage =>
      'Cela supprimera votre rendez-vous de visite et rendra la voiture disponible pour que vous puissiez recommencer.';

  @override
  String get viewingReservationCancelled => 'La visite a été annulée.';

  @override
  String get viewingScheduled => 'Visite prévue';

  @override
  String get requestHoldExtensionQuestion =>
      'Demander une prolongation du blocage ?';

  @override
  String get requestHoldExtensionMessage =>
      'L’entreprise examinera votre nouvelle date de retour. Si elle est approuvée, vous paierez tout montant supplémentaire avant le changement de date.';

  @override
  String get requestExtension => 'Demander une prolongation';

  @override
  String get extensionRequestSent => 'Demande de prolongation envoyée.';

  @override
  String holdUntilDate(Object date) {
    return 'Blocage jusqu’au : $date';
  }

  @override
  String get holdReviewRequiredMessage =>
      'La date de blocage est passée. L’entreprise vérifie si le véhicule a été vendu ou si le client n’est pas venu.';

  @override
  String get customerNoShowHoldMessage =>
      'Marqué comme client absent. L’acompte de blocage peut être conservé.';

  @override
  String get payExtensionQuestion => 'Payer la prolongation ?';

  @override
  String get payExtensionMessage =>
      'Votre date de blocage sera mise à jour une fois ce paiement de prolongation terminé.';

  @override
  String get payExtension => 'Payer la prolongation';

  @override
  String get extensionPaidHoldUpdated =>
      'Prolongation payée. La date de blocage a été mise à jour.';

  @override
  String get chooseBusinessWithShippingFee =>
      'Choisissez une entreprise avec des frais d’expédition actifs avant le paiement.';

  @override
  String get processingPayment => 'Traitement du paiement';

  @override
  String get payAndRequestShipment => 'Payer et demander l’expédition';

  @override
  String get checkingConnection => 'Vérification de la connexion';

  @override
  String get checkingConnectionMessage =>
      'Nous confirmons l’accès à Internet avant d’ouvrir l’application.';

  @override
  String get noInternetConnection => 'Pas de connexion Internet';

  @override
  String get noInternetMessage =>
      'Cette application a besoin d’une connexion Internet active pour charger votre compte, les services, les paiements et les derniers paramètres de sécurité.';

  @override
  String get retry => 'Réessayer';

  @override
  String get updateAvailable => 'Mise à jour disponible';

  @override
  String updateAvailableMessage(Object version) {
    return 'Une nouvelle version$version est disponible. Mettez à jour maintenant pour obtenir les derniers correctifs, ou continuez pour cette session.';
  }

  @override
  String get updateRequired => 'Mise à jour requise';

  @override
  String updateRequiredMessage(Object version) {
    return 'Cette version n’est plus prise en charge. Veuillez mettre à jour$version pour continuer.';
  }

  @override
  String get updateNow => 'Mettre à jour';

  @override
  String get continueLabel => 'Continuer';

  @override
  String get updateLinkUnavailable =>
      'Le lien de mise à jour n’est pas encore disponible. Veuillez réessayer plus tard.';

  @override
  String get emailOrPhone => 'Email ou téléphone';

  @override
  String get enterEmailOrPhone => 'Entrez votre email ou téléphone';

  @override
  String get pleaseEnterEmailOrPhone =>
      'Veuillez entrer votre email ou numéro de téléphone';

  @override
  String get pleaseEnterValidEmailOrPhone =>
      'Veuillez entrer un email ou numéro de téléphone valide';

  @override
  String get saveProfile => 'Enregistrer le profil';

  @override
  String get profilePhoto => 'Photo de profil';

  @override
  String get changePhoto => 'Changer la photo';

  @override
  String get notifications => 'Notifications';

  @override
  String get notificationPreferences => 'Préférences de notification';

  @override
  String get pushNotifications => 'Notifications push';

  @override
  String get emailNotifications => 'Notifications par email';

  @override
  String get smsNotifications => 'Notifications par SMS';

  @override
  String get carActivityNotifications =>
      'Mises à jour d’achat et de réservation de voitures';

  @override
  String get shipmentActivityNotifications =>
      'Mises à jour d’expédition de barils';

  @override
  String get walletActivityNotifications =>
      'Mises à jour de remboursement du portefeuille';

  @override
  String get businessActivityNotifications =>
      'Mises à jour de demande d’entreprise';

  @override
  String get reviewActivityNotifications => 'Demandes d\'avis';

  @override
  String get faceId => 'Face ID';

  @override
  String get faceIdUnlock =>
      'Utiliser Face ID pour déverrouiller l’application';

  @override
  String get faceIdUnavailable =>
      'Face ID n’est pas disponible sur cet appareil';

  @override
  String get unlockWithFaceId => 'Déverrouiller avec Face ID';

  @override
  String get appLocked => 'Application verrouillée';

  @override
  String get unlockWithFaceIdMessage => 'Utilisez Face ID pour continuer.';

  @override
  String get unlock => 'Déverrouiller';

  @override
  String get favoriteCars => 'Voitures favorites';

  @override
  String get favoriteCarsSubtitle =>
      'Voir les véhicules que vous avez enregistrés';

  @override
  String get noFavoriteCarsYet => 'Aucune voiture favorite pour le moment';

  @override
  String get favoriteRemoved => 'Favori supprimé';

  @override
  String get addToFavorites => 'Ajouter aux favoris';

  @override
  String get removeFromFavorites => 'Retirer des favoris';

  @override
  String get enterValidPaidHoldPricing =>
      'Entrez un tarif de blocage payant valide.';

  @override
  String get useBusinessPaidHoldPricing =>
      'Utiliser le tarif de blocage de l’entreprise';

  @override
  String get useBusinessPaidHoldPricingSubtitle =>
      'Désactivez cette option pour définir un tarif de blocage propre à cette voiture.';

  @override
  String get chooseReturnDate => 'Choisir la date de retour';

  @override
  String get customizeNavbar => 'Personnaliser la barre de navigation';

  @override
  String get change => 'Changer';

  @override
  String get sendFreight => 'Envoyer du fret';

  @override
  String freightBookedTracking(Object trackingCode) {
    return 'Fret réservé. Suivi : $trackingCode';
  }

  @override
  String freightEstimatePaidTracking(Object trackingCode) {
    return 'Estimation payée. Suivi : $trackingCode';
  }

  @override
  String get fillSenderReceiverPhone =>
      'Renseignez l’expéditeur, le destinataire et le téléphone.';

  @override
  String get enterParcelWeightKg => 'Entrez le poids du colis en kg.';

  @override
  String get noFreightBusinessesYet =>
      'Aucune entreprise de fret pour le moment';

  @override
  String get noFreightBusinessesSubtitle =>
      'Le fret de colis apparaîtra ici lorsqu’une entreprise aura défini ses tarifs air ou mer.';

  @override
  String get couldNotLoadFreightOptions =>
      'Impossible de charger les options de fret. Vérifiez votre connexion et réessayez.';

  @override
  String get freightBookingFailed =>
      'Impossible de créer cet envoi de fret. Veuillez réessayer.';

  @override
  String get approvedBusiness => 'Entreprise approuvée';

  @override
  String freightDeliveryEstimateDays(int minimum, int maximum) {
    return 'Livraison : $minimum-$maximum jours';
  }

  @override
  String freightAirDeliveryEstimateDays(int minimum, int maximum) {
    return 'Livraison aérienne : $minimum-$maximum jours';
  }

  @override
  String freightSeaDeliveryEstimateDays(int minimum, int maximum) {
    return 'Livraison maritime : $minimum-$maximum jours';
  }

  @override
  String get cancelOrderTitle => 'Annuler cette commande ?';

  @override
  String get cancelOrderHeldBody =>
      'Votre carte n’a jamais été débitée — la réservation est libérée et vous ne payez rien.';

  @override
  String get cancelOrderCapturedBody =>
      'Votre paiement est remboursé moins les frais bancaires, comme indiqué au moment du paiement.';

  @override
  String get cancelWholeOrderHeldBody =>
      'Cet envoi a été payé avec le reste de sa commande : toute la commande est annulée. Votre carte n’a jamais été débitée — vous ne payez rien.';

  @override
  String get cancelWholeOrderCapturedBody =>
      'Cet envoi a été payé avec le reste de sa commande : toute la commande est annulée. Votre paiement est remboursé moins les frais bancaires.';

  @override
  String get keepOrder => 'Garder la commande';

  @override
  String get cancelOrderConfirm => 'Annuler la commande';

  @override
  String get cancelOrderFreeAction => 'Annuler la commande (gratuit)';

  @override
  String get cancelOrderRefundAction =>
      'Annuler la commande (remboursement moins frais)';

  @override
  String get orderCancelledFree =>
      'Commande annulée. Votre carte n’a jamais été débitée.';

  @override
  String get orderRefunded =>
      'Commande annulée. Votre remboursement arrive, moins les frais bancaires.';

  @override
  String get genericError => 'Une erreur est survenue. Veuillez réessayer.';

  @override
  String get paymentHoldNotice =>
      'Aucun débit aujourd’hui — le montant est réservé sur votre carte et débité à la fin de la période de réservation (5 à 7 jours pour la plupart des cartes). Annulation gratuite avant le débit ; ensuite, les remboursements perdent les frais bancaires.';

  @override
  String get freightSortBestRated => 'Mieux noté';

  @override
  String get freightSortCheapest => 'Moins cher';

  @override
  String get freightSortBestCover => 'Meilleure couverture';

  @override
  String get freightSortFastest => 'Plus rapide';

  @override
  String get searchBusinessOrCountry => 'Rechercher une entreprise ou un pays';

  @override
  String noMatchFor(Object query) {
    return 'Aucun résultat pour « $query »';
  }

  @override
  String toDestination(Object destination) {
    return 'Vers $destination';
  }

  @override
  String airRatePerKg(Object rate) {
    return 'Air $rate/kg';
  }

  @override
  String seaRatePerKg(Object rate) {
    return 'Mer $rate/kg';
  }

  @override
  String get shippingMode => 'Mode d’expédition';

  @override
  String get invalidFreightMode => 'Choisissez le fret aérien ou maritime.';

  @override
  String get parcelWeightKg => 'Poids du colis (kg)';

  @override
  String get estimatedPrice => 'Prix estimé';

  @override
  String get estimatedWeight => 'Poids estimé';

  @override
  String get estimatedWeightKg => 'Poids estimé (kg)';

  @override
  String get estimatedTotal => 'Total estimé';

  @override
  String get freightEstimateExplanation =>
      'Vous payez une estimation basée sur le poids saisi. L’entreprise confirmera le poids après le dépôt.';

  @override
  String get payEstimate => 'Payer l’estimation';

  @override
  String get estimatePaid => 'Estimation payée';

  @override
  String get freightOrderDetails => 'Commande de fret';

  @override
  String get freightNextStep => 'Prochaine étape';

  @override
  String freightNextDropOffAtProvider(Object businessName) {
    return 'Déposez votre colis chez $businessName. L’entreprise confirmera le poids après le dépôt.';
  }

  @override
  String get freightNextDropOffAtBusiness =>
      'Déposez votre colis à l’adresse de l’entreprise. L’entreprise confirmera le poids après le dépôt.';

  @override
  String freightNextDropOffAtProviderSetPrice(Object businessName) {
    return 'Déposez votre colis chez $businessName. Le prix de cet article est fixé, il n’y a plus rien à payer.';
  }

  @override
  String get freightNextDropOffAtBusinessSetPrice =>
      'Déposez votre colis à l’adresse de l’entreprise. Le prix de cet article est fixé, il n’y a plus rien à payer.';

  @override
  String get freightNextWeightReview =>
      'L’entreprise confirme le poids final. Tout solde ou remboursement apparaîtra ici.';

  @override
  String get freightNextInTransit =>
      'Votre colis est en route. Gardez ce numéro de suivi pour les mises à jour.';

  @override
  String get freightNextReadyForPickup =>
      'Votre colis est prêt à être récupéré.';

  @override
  String get freightNextCompleted => 'Cette commande de fret est terminée.';

  @override
  String paidEstimateAmount(Object amount) {
    return 'Estimation payée : $amount';
  }

  @override
  String estimatedWeightValue(Object weight) {
    return 'Poids estimé : $weight';
  }

  @override
  String get freightNoActionUntilWeightConfirmed =>
      'Après le dépôt, aucune action n’est nécessaire avant la confirmation du poids par l’entreprise.';

  @override
  String get viewAllShipments => 'Voir toutes les expéditions';

  @override
  String get shipmentStillSyncing =>
      'Cette expédition est encore en synchronisation. Vous pouvez voir toutes les expéditions ou réessayer bientôt.';

  @override
  String get awaitingConfirmedWeight => 'En attente du poids confirmé';

  @override
  String get verifiedWeight => 'Poids confirmé';

  @override
  String get finalTotal => 'Total final';

  @override
  String get additionalPaymentRequired => 'Paiement supplémentaire requis';

  @override
  String payBalanceAmount(Object amount) {
    return 'Payer le solde de $amount';
  }

  @override
  String refundDueAmount(Object amount) {
    return 'Remboursement dû : $amount';
  }

  @override
  String get refundProcessing => 'Remboursement en cours';

  @override
  String get refundCompleted => 'Remboursement effectué';

  @override
  String get freightSettled => 'Paiement finalisé';

  @override
  String get shipmentHeldForBalance =>
      'Votre colis sera retenu jusqu’au paiement du solde.';

  @override
  String get settlementNeedsAttention =>
      'Le règlement nécessite une intervention';

  @override
  String get paymentProcessing => 'Paiement en cours…';

  @override
  String get couldNotPayBalance => 'Impossible de payer le solde. Réessayez.';

  @override
  String get enterWeightToSeePrice => 'Entrez un poids pour voir le prix';

  @override
  String get bookAndPay => 'Réserver et payer';

  @override
  String get freightDropOffNote =>
      'Déposez votre colis à l’adresse de l’entreprise.';

  @override
  String freightDropOffAddress(Object address) {
    return 'Dépôt : $address';
  }

  @override
  String freightBusinessPhone(Object phone) {
    return 'Téléphone de l’entreprise : $phone';
  }

  @override
  String get airFreight => 'Fret aérien';

  @override
  String get seaFreight => 'Fret maritime';

  @override
  String pricePerKg(Object price) {
    return '$price / kg';
  }

  @override
  String get fasterDelivery => 'Livraison plus rapide';

  @override
  String get lowerCost => 'Coût plus bas';

  @override
  String get requestCarTransport => 'Demander le transport de voiture';

  @override
  String get chooseTransportDestination =>
      'Choisissez une destination pour la voiture.';

  @override
  String get whereIsTheCarGoing => 'Où va la voiture ?';

  @override
  String get searchDestinationCountry => 'Rechercher le pays de destination';

  @override
  String get noDestinationCountriesMatch =>
      'Aucun pays de destination ne correspond à votre recherche.';

  @override
  String get transportBusinessesWillQuote =>
      'Les entreprises vérifiées admissibles qui desservent cette destination recevront les détails du véhicule et vous enverront des devis à comparer.';

  @override
  String get vehicleCondition => 'État du véhicule';

  @override
  String get vehicleRunsAndDrives => 'Roule et fonctionne';

  @override
  String get vehicleInoperable => 'Non roulant';

  @override
  String get preferredTransportMethod => 'Méthode de transport préférée';

  @override
  String get openTransport => 'Transporteur ouvert';

  @override
  String get enclosedTransport => 'Transporteur fermé';

  @override
  String get pickupArea => 'Ville, région ou code postal de ramassage';

  @override
  String get pickupAreaHint => 'Par exemple, Bronx, NY 10467';

  @override
  String get enterPickupArea =>
      'Indiquez la ville, la région ou le code postal de ramassage.';

  @override
  String get flexibleTransportDates => 'Mes dates sont flexibles';

  @override
  String get flexibleTransportDatesSubtitle =>
      'Les entreprises peuvent proposer la meilleure fenêtre de ramassage disponible.';

  @override
  String transportMarketplaceRequestSent(Object trackingCode) {
    return 'La demande $trackingCode a été envoyée aux entreprises admissibles. Vous pouvez comparer leurs devis dans vos commandes.';
  }

  @override
  String get transportQuotesTitle => 'Devis des entreprises';

  @override
  String get transportQuotesIntro =>
      'Comparez le prix total, les délais, la méthode et les conditions avant de choisir un transporteur.';

  @override
  String get waitingForTransportQuotes => 'En attente des devis';

  @override
  String get waitingForTransportQuotesSubtitle =>
      'Les entreprises vérifiées admissibles peuvent maintenant examiner le trajet et le véhicule. Cette commande sera mise à jour à mesure que les devis arrivent.';

  @override
  String get couldNotLoadTransportQuotes =>
      'Impossible de charger les devis des entreprises. Réessayez.';

  @override
  String get estimatedPickup => 'Ramassage estimé';

  @override
  String get estimatedDelivery => 'Livraison estimée';

  @override
  String get transportMethod => 'Méthode de transport';

  @override
  String get selectTransportQuote => 'Choisir ce devis';

  @override
  String get selectingTransportQuote => 'Sélection du devis...';

  @override
  String get confirmTransportQuoteTitle => 'Choisir ce transporteur ?';

  @override
  String confirmTransportQuoteMessage(Object businessName, Object price) {
    return 'Choisir $businessName pour $price ? Le montant est réservé sur votre carte, pas débité, et l’annulation pendant la réservation est gratuite. Cette action ferme la demande aux autres entreprises.';
  }

  @override
  String get transportPaymentTitle => 'Payez pour confirmer votre transporteur';

  @override
  String transportPaymentBody(Object price) {
    return '$price est réservé sur votre carte — pas débité — et le transporteur ne peut commencer qu’une fois le montant sécurisé. L’annulation pendant la réservation est gratuite.';
  }

  @override
  String get transportPayNow => 'Payer maintenant';

  @override
  String get transportPaymentFailed =>
      'Le paiement n’a pas pu être finalisé. Rien n’a été débité — réessayez.';

  @override
  String get keepComparing => 'Continuer à comparer';

  @override
  String get chooseThisBusiness => 'Choisir cette entreprise';

  @override
  String get couldNotSelectTransportQuote =>
      'Impossible de sélectionner ce devis. Vérifiez qu’il est encore disponible et réessayez.';

  @override
  String get transportQuoteSelectedTitle => 'Transporteur sélectionné';

  @override
  String transportQuoteSelectedMessage(Object businessName, Object price) {
    return '$businessName a été sélectionnée pour $price. Vos coordonnées privées et les détails du ramassage sont maintenant accessibles à cette entreprise.';
  }

  @override
  String get transportRequestCancelled => 'Demande de transport annulée';

  @override
  String get transportRequestCancelledSubtitle =>
      'Les entreprises ne peuvent plus envoyer ni modifier de devis pour cette demande.';

  @override
  String get cancelTransportRequest => 'Annuler la demande de transport';

  @override
  String get cancellingTransportRequest => 'Annulation de la demande...';

  @override
  String get confirmCancelTransportRequestTitle => 'Annuler cette demande ?';

  @override
  String get confirmCancelTransportRequestMessage =>
      'Les entreprises ne pourront plus envoyer ni modifier de devis.';

  @override
  String get keepRequestOpen => 'Garder la demande ouverte';

  @override
  String get couldNotCancelTransportRequest =>
      'Impossible d’annuler la demande de transport. Réessayez.';

  @override
  String get chooseBusinessAndDestination =>
      'Choisissez une entreprise et une destination.';

  @override
  String get selectCarMakeModelYear =>
      'Sélectionnez la marque, le modèle et l’année de la voiture.';

  @override
  String transportRequestSentToBusiness(
    Object businessName,
    Object trackingCode,
  ) {
    return 'Demande envoyée à $businessName. Suivi $trackingCode. L’entreprise vous enverra un devis.';
  }

  @override
  String couldNotSendRequest(Object error) {
    return 'Impossible d’envoyer la demande : $error';
  }

  @override
  String get pickPreferredDateOptional =>
      'Choisir une date préférée (facultatif)';

  @override
  String get whoShouldHandleTransport => 'Qui doit s’en occuper ?';

  @override
  String get theCar => 'La voiture';

  @override
  String get contactAndPickup => 'Contact et ramassage';

  @override
  String get businessDestination => 'Entreprise · destination';

  @override
  String get pickupAddressOptional => 'Adresse de ramassage (facultatif)';

  @override
  String get notesForBusinessOptional => 'Notes pour l’entreprise (facultatif)';

  @override
  String get enterOwnerName => 'Entrez le nom du propriétaire';

  @override
  String get enterContactPhone => 'Entrez un téléphone de contact';

  @override
  String get sending => 'Envoi...';

  @override
  String get sendRequest => 'Envoyer la demande';

  @override
  String get transportQuoteNoPaymentNote =>
      'Aucun paiement maintenant — les entreprises admissibles envoient des devis et vous choisissez celui à accepter.';

  @override
  String get noTransportBusinessesYet =>
      'Aucune entreprise ne propose encore le transport de voiture';

  @override
  String get noTransportBusinessesSubtitle =>
      'Revenez bientôt — les entreprises ajoutent leurs trajets de transport lorsqu’elles arrivent en ligne.';

  @override
  String get couldNotLoadTransportOptions =>
      'Impossible de charger les options de transport';

  @override
  String get receiverWhatsAppNumberTitle =>
      'Ce numéro de destinataire est utilisé sur WhatsApp';

  @override
  String get receiverWhatsAppNumberSubtitle =>
      'Utilisez ceci seulement si le destinataire utilise un numéro d’un autre pays sur WhatsApp.';

  @override
  String get invalidPhoneWithCountryCode =>
      'Entrez un numéro de téléphone valide avec l’indicatif du pays.';

  @override
  String get invalidInternationalPhone =>
      'Entrez un numéro de téléphone international valide.';

  @override
  String get whatsAppDifferentCountryRequiresCode =>
      'Pour un numéro WhatsApp d’un autre pays, indiquez + et l’indicatif du pays.';

  @override
  String receiverPhoneMustMatchDestination(
    Object destinationName,
    Object prefix,
  ) {
    return 'Le numéro du destinataire doit correspondre à $destinationName ($prefix) ou être indiqué comme numéro WhatsApp.';
  }

  @override
  String get readyForPickup => 'Prêt pour le retrait';

  @override
  String get samePickup => 'Même ramassage';

  @override
  String get differentPickups => 'Ramassages différents';

  @override
  String boroughPickupAddress(Object borough) {
    return 'Adresse de ramassage à $borough';
  }

  @override
  String get barrelsForThisDestination => 'Barils pour cette destination';

  @override
  String get decrease => 'Diminuer';

  @override
  String get increase => 'Augmenter';

  @override
  String get edit => 'Modifier';

  @override
  String get remove => 'Supprimer';

  @override
  String barrelCartLine(int quantity, Object receiverName) {
    String _temp0 = intl.Intl.pluralLogic(
      quantity,
      locale: localeName,
      other: '$quantity barils',
      one: '1 baril',
    );
    return '$_temp0 → $receiverName';
  }

  @override
  String holdPricingSummary(Object mode, Object days) {
    return 'Tarif de blocage : $mode$days';
  }

  @override
  String holdDaysSuffix(Object days) {
    return ' • $days jour(s)';
  }

  @override
  String get flat => 'Fixe';

  @override
  String forfeitureStatusLabel(Object status) {
    return 'Confiscation : $status';
  }

  @override
  String get holdDateReachedStaffAction =>
      'La date de blocage est atteinte. Marquez ce véhicule comme vendu ou marquez le client comme absent.';

  @override
  String extensionStatusLine(Object status, Object date, Object amount) {
    return 'Prolongation : $status$date$amount';
  }

  @override
  String dateSuffix(Object date) {
    return ' • $date';
  }

  @override
  String extraAmountSuffix(Object amount) {
    return ' • supplément $amount';
  }

  @override
  String buyerHistoryLine(
    Object completed,
    Object noShows,
    Object forfeitures,
  ) {
    return 'Historique acheteur : $completed terminé(s), $noShows absent(s), $forfeitures confisqué(s)';
  }

  @override
  String get customerDidNotCome => 'Le client n’est pas venu';

  @override
  String get approveExtension => 'Approuver la prolongation';

  @override
  String get rejectExtension => 'Rejeter la prolongation';

  @override
  String navbarPickerInstructions(int count) {
    return 'Choisissez jusqu’à $count services pour un accès rapide dans la barre du bas. Faites glisser pour réorganiser.';
  }

  @override
  String get inYourNavbar => 'Dans votre barre de navigation';

  @override
  String get nothingPinnedYet =>
      'Rien n’est épinglé — ajoutez des services ci-dessous.';

  @override
  String get addServices => 'Ajouter des services';

  @override
  String navbarFullMessage(int count) {
    return 'La barre est pleine ($count). Retirez un service pour en ajouter un autre.';
  }

  @override
  String get activeDestinationsRequireFee =>
      'Les destinations actives nécessitent au moins un service configuré.';

  @override
  String get seedCountriesEmptyInstruction =>
      'Ajoutez le catalogue complet des pays, puis recherchez et activez les destinations que vous servez.';

  @override
  String barrelPriceSummary(Object price) {
    return 'Baril : $price';
  }

  @override
  String deliveryEstimateSummary(Object estimate) {
    return 'Livraison : $estimate';
  }

  @override
  String get businessProfileTitle => 'Profil de l’entreprise';

  @override
  String get splashTagline => 'Voitures, barils et passage au même endroit.';

  @override
  String get splashMarketplace => 'MARCHÉ';

  @override
  String get splashOpening => 'OUVERTURE DE LAAWOL';

  @override
  String get accountProfileUnavailable =>
      'La connexion est lente. Nous n’avons pas pu charger votre rôle de compte en toute sécurité.';

  @override
  String get accountProfileMissing =>
      'Le profil de votre compte est introuvable. Contactez l’assistance Laawol.';

  @override
  String get accountProfileRetryHelp =>
      'Réessayez sans vous déconnecter ni perdre votre session.';

  @override
  String get addMoney => 'Ajouter de l’argent';

  @override
  String get myOrders => 'Mes commandes';

  @override
  String get goodMorning => 'Bonjour';

  @override
  String get goodAfternoon => 'Bon après-midi';

  @override
  String get goodEvening => 'Bonsoir';

  @override
  String get signInToYourAccount => 'Connectez-vous à votre compte';

  @override
  String get accountSignInSubtitle =>
      'Suivez vos commandes et vos expéditions.';

  @override
  String shippingBusinessUnavailable(Object businessName, Object countryName) {
    return '$businessName n’expédie pas vers $countryName, et aucune autre entreprise n’est encore disponible.';
  }

  @override
  String get shippingBusinessWillChange =>
      'L’entreprise d’expédition va changer';

  @override
  String shippingBusinessChangeMessage(
    Object businessName,
    Object countryName,
  ) {
    return '$businessName ne livre pas vers $countryName. Choisissez une autre entreprise approuvée pour continuer.';
  }

  @override
  String get availableBusinesses => 'Entreprises disponibles';

  @override
  String deliveryLabel(Object value) {
    return 'Livraison $value';
  }

  @override
  String get pickupDateAndTime => 'Date et heure de ramassage';

  @override
  String get shipmentEstimate => 'Estimation de l’expédition';

  @override
  String get addProfilePicture => 'Ajouter une photo de profil';

  @override
  String get registerBusinessInstead =>
      'Enregistrer votre entreprise à la place';

  @override
  String get businessApprovalSetupNote =>
      'Vous pouvez configurer les destinations, voitures et employés immédiatement. Les clients verront votre entreprise seulement après l’approbation de la plateforme.';

  @override
  String get businessProfilePicture => 'Photo de profil de l’entreprise';

  @override
  String get businessProfilePictureHelper =>
      'Téléversez un logo ou une image de vitrine que les clients peuvent reconnaître.';

  @override
  String get joinMarketplace => 'Rejoindre la marketplace';

  @override
  String get businessApplicationSubtitle =>
      'Postulez une fois, préparez vos opérations, puis passez en ligne après approbation.';

  @override
  String get businessOperations => 'Opérations de l’entreprise';

  @override
  String get businessOperationsWebNote =>
      'Ouvre la console entreprise sécurisée dans votre navigateur, où se trouvent le personnel, les versements et les destinations.';

  @override
  String get businessServiceOverviewUnpaid => 'Impayés';

  @override
  String get businessServiceOverviewOpen => 'En cours';

  @override
  String get businessServiceOverviewShowAll => 'Afficher toute l’activité';

  @override
  String get businessServiceOverviewEmpty =>
      'Aucun service n’est encore activé pour votre compte.';

  @override
  String get businessCarsMobileNote =>
      'Les annonces et achats de véhicules sont aussi disponibles dans les onglets mobiles ci-dessous.';

  @override
  String get openBusinessConsole => 'Ouvrir la console entreprise';

  @override
  String get openingBusinessConsole => 'Ouverture de la console entreprise...';

  @override
  String get businessConsoleOpenFailed =>
      'Impossible d’ouvrir la console entreprise. Visitez business.laawoldigital.com dans votre navigateur.';

  @override
  String get businessAssistantTitle => 'Assistant';

  @override
  String get businessAssistantOpen => 'Demander à l’assistant';

  @override
  String get businessAssistantEmptyTitle =>
      'Comment puis-je aider aujourd’hui ?';

  @override
  String get businessAssistantEmptyHint =>
      'Je peux répondre à vos questions sur vos opérations et enregistrer du travail pour vous. Essayez de me demander de :';

  @override
  String get businessAssistantCapabilityParkedCars =>
      'Vérifier quelles voitures sont stationnées en ce moment';

  @override
  String get businessAssistantCapabilityWalkUp =>
      'Enregistrer un stationnement sans réservation';

  @override
  String get businessAssistantCapabilityTracking =>
      'Ajouter une mise à jour de suivi d’expédition';

  @override
  String get businessAssistantInputHint => 'Écrire à l’assistant...';

  @override
  String get businessAssistantSend => 'Envoyer';

  @override
  String get businessAssistantConfirm => 'Confirmer';

  @override
  String get businessAssistantCancel => 'Annuler';

  @override
  String get businessAssistantConfirmed => 'Confirmée';

  @override
  String get businessAssistantDeclined => 'Refusée';

  @override
  String get businessAssistantError =>
      'Une erreur est survenue. Veuillez réessayer.';

  @override
  String get businessChangesRequestedBanner =>
      'Un administrateur de la plateforme a demandé des modifications. Vous pouvez continuer la configuration pendant que l’entreprise reste masquée aux clients.';

  @override
  String get businessPendingApprovalBanner =>
      'Votre entreprise attend l’approbation de la plateforme. Vous pouvez configurer les destinations, les voitures et le personnel maintenant ; les clients la verront après approbation.';

  @override
  String totalDaysLabel(Object days) {
    return 'Nombre total de jours : $days';
  }

  @override
  String totalCostLabel(Object cost) {
    return 'Coût total : $cost';
  }

  @override
  String get customerRequest => 'Demande client';

  @override
  String get awaitingQuote => 'En attente de devis';

  @override
  String get setPriceQuoteInstruction =>
      'Définissez un prix ci-dessous pour envoyer un devis à ce client.';

  @override
  String get barrelOrder => 'Commande de barils';

  @override
  String barrelOrderSummary(
    Object barrelCount,
    Object destinationCount,
    Object businessCount,
  ) {
    return '$barrelCount barils • $destinationCount destinations • $businessCount entreprises';
  }

  @override
  String get clear => 'Effacer';

  @override
  String get signInToSaveBarrelShipment =>
      'Connectez-vous ou créez un compte afin que nous puissions enregistrer cette expédition de barils en sécurité et l’afficher dans le suivi.';

  @override
  String get editDestinationPickupHelp =>
      'Utilisez Modifier sur chaque ligne de destination pour ajouter ou changer les détails de ramassage de cette destination.';

  @override
  String get businessesShippingToCountry =>
      'Entreprises expédiant vers ce pays';

  @override
  String get fixedPickupPriceForBorough =>
      'Prix de ramassage fixe pour cet arrondissement';

  @override
  String get barrelRateUnavailable => 'Tarif indisponible';

  @override
  String get finalPriceConfirmedByStaff =>
      'Le prix final sera confirmé par l’équipe.';

  @override
  String get useWalletCredit => 'Utiliser le crédit du portefeuille';

  @override
  String get whereAreBarrelsGoing => 'Où vont ces barils ?';

  @override
  String get addDestinationInstruction =>
      'Ajoutez une destination — pays, entreprise, destinataire et nombre de barils envoyés.';

  @override
  String get addDestination => 'Ajouter une destination';

  @override
  String get destinationsTitle => 'Destinations';

  @override
  String get barrelDestinationStartSummary =>
      'Commencez par indiquer la destination des barils et le nombre envoyé.';

  @override
  String barrelDestinationSummary(int barrelCount, int destinationCount) {
    String _temp0 = intl.Intl.pluralLogic(
      barrelCount,
      locale: localeName,
      other: '$barrelCount barils',
      one: '1 baril',
    );
    String _temp1 = intl.Intl.pluralLogic(
      destinationCount,
      locale: localeName,
      other: '$destinationCount destinations',
      one: '1 destination',
    );
    return '$_temp0 vers $_temp1.';
  }

  @override
  String get addAnotherDestination => 'Ajouter une autre destination';

  @override
  String get editDestination => 'Modifier la destination';

  @override
  String destinationNumber(int number) {
    return 'Destination $number';
  }

  @override
  String get saveDestination => 'Enregistrer la destination';

  @override
  String get addToOrder => 'Ajouter à la commande';

  @override
  String holdPerDayDescription(int days, Object amount) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: 'Maintien pendant $days jours',
      one: 'Maintien pendant 1 jour',
    );
    return '$_temp0 à $amount par jour';
  }

  @override
  String holdFlatFeeDescription(int days) {
    return 'Frais fixes de maintien jusqu’à $days jours';
  }

  @override
  String get pleaseChooseBusiness => 'Veuillez choisir une entreprise';

  @override
  String get originalEstimatedCost => 'Coût estimé initial';

  @override
  String get walletCredit => 'Crédit du portefeuille';

  @override
  String get cardPaymentDue => 'Paiement par carte dû';

  @override
  String get addAtLeastOneDestination =>
      'Ajoutez au moins une destination à cette commande.';

  @override
  String get noApprovedBusinessShippingDestination =>
      'Aucune entreprise approuvée n’expédie actuellement vers cette destination.';

  @override
  String get businessOptionsUnavailable =>
      'Les options d’entreprise ne sont pas disponibles pour le moment. Veuillez réessayer dans un instant.';

  @override
  String get gettingYourLocation => 'Récupération de votre position...';

  @override
  String get useMyCurrentLocation => 'Utiliser ma position actuelle';

  @override
  String get currentLocationAdded => 'Position actuelle ajoutée';

  @override
  String get choosePickupDateAndTime =>
      'Choisir la date et l’heure de ramassage';

  @override
  String get amountDueNow => 'Montant dû maintenant';

  @override
  String get estimatedCost => 'Coût estimé';

  @override
  String get supportCenter => 'Centre de support';

  @override
  String get supportCases => 'Dossiers de support';

  @override
  String get supportInbox => 'Boîte de support';

  @override
  String get supportInboxSubtitle =>
      'Problèmes clients, réponses des entreprises et escalades admin.';

  @override
  String get supportChat => 'Chat support';

  @override
  String get getHelp => 'Obtenir de l’aide';

  @override
  String get openSupport => 'Ouvrir le support';

  @override
  String get openingSupport => 'Ouverture du support...';

  @override
  String get writeSupportMessage => 'Écrire un message';

  @override
  String get sendMessage => 'Envoyer';

  @override
  String get sendingMessage => 'Envoi...';

  @override
  String get supportMessageRequired => 'Écrivez un message avant l’envoi.';

  @override
  String get supportNoCases => 'Aucun dossier de support';

  @override
  String get supportNoCasesSubtitle =>
      'Les dossiers apparaissent ici quand des clients demandent de l’aide à une entreprise.';

  @override
  String get supportSearch => 'Rechercher des dossiers';

  @override
  String get supportBusinessFirst => 'Entreprise d’abord';

  @override
  String get supportEscalated => 'Escaladé';

  @override
  String get supportResolved => 'Résolu';

  @override
  String get supportWaitingBusiness => 'En attente de l’entreprise';

  @override
  String get supportWaitingCustomer => 'En attente du client';

  @override
  String get supportAdminReviewing => 'Admin en examen';

  @override
  String get supportUrgent => 'Urgent';

  @override
  String get supportNormal => 'Normal';

  @override
  String get supportLinkedRecord => 'Dossier lié';

  @override
  String get supportCustomer => 'Client';

  @override
  String get supportBusiness => 'Entreprise';

  @override
  String get supportPlatformAdmin => 'Admin Laawol';

  @override
  String get supportAskPlatform => 'Demander l’aide d’un admin Laawol';

  @override
  String get businessSupportAskAdmin => 'Contacter un admin plateforme';

  @override
  String get businessSupportTitle => 'Demander l’aide d’un admin plateforme';

  @override
  String get businessSupportSubtitle =>
      'Envoyez une demande aux admins Laawol pour votre compte entreprise, vos opérations, vos paiements ou votre accès plateforme.';

  @override
  String get businessSupportSubject => 'Sujet du support';

  @override
  String get businessSupportSubjectRequired => 'Saisissez un sujet de support.';

  @override
  String get supportEscalating => 'Escalade...';

  @override
  String get supportEscalationTitle => 'Demander l’aide d’un admin Laawol';

  @override
  String get supportEscalationSubtitle =>
      'Utilisez ceci quand l’entreprise ne peut pas résoudre le problème ou si c’est urgent.';

  @override
  String get supportEscalationReason => 'Raison de l’escalade';

  @override
  String get supportEscalationNote => 'Ajoutez des détails pour l’admin';

  @override
  String get supportEscalationUnavailable =>
      'L’escalade vers un admin devient disponible après le délai de réponse de l’entreprise, sauf urgence.';

  @override
  String get supportEscalationUrgentOnly =>
      'L’escalade normale se déverrouille après le délai de réponse de l’entreprise. Les motifs urgents peuvent être envoyés maintenant.';

  @override
  String get supportAlreadyEscalatedTitle => 'Déjà escaladé à un admin Laawol';

  @override
  String get supportAlreadyEscalatedSubtitle =>
      'Ce dossier est déjà dans la file des admins Laawol.';

  @override
  String get supportReasonUnresolved =>
      'L’entreprise n’a pas résolu le problème';

  @override
  String get supportReasonFraud => 'Fraude ou activité suspecte';

  @override
  String get supportReasonSafety => 'Problème de sécurité';

  @override
  String get supportReasonAbuse => 'Comportement abusif';

  @override
  String get supportReasonPaymentNoService =>
      'Paiement reçu, service non fourni';

  @override
  String get supportReasonBusinessUnreachable => 'Entreprise injoignable';

  @override
  String get supportReasonTimeSensitive => 'Ramassage ou livraison urgent';

  @override
  String get supportEvidence => 'Preuves';

  @override
  String get supportAddImage => 'Ajouter une image';

  @override
  String get supportAddAttachment => 'Ajouter une pièce jointe';

  @override
  String get supportAttachmentSheetTitle => 'Ajouter une pièce jointe';

  @override
  String get supportPhoto => 'Photo';

  @override
  String get supportVideo => 'Vidéo';

  @override
  String get supportFile => 'Fichier';

  @override
  String get supportUploading => 'Téléversement...';

  @override
  String get supportReviewAttachmentTitle => 'Vérifier la pièce jointe';

  @override
  String get supportUploadAttachment => 'Téléverser';

  @override
  String get supportReplaceAttachment => 'Remplacer';

  @override
  String get supportAttachmentCaption => 'Légende (facultative)';

  @override
  String get supportPreviewUnavailable =>
      'Aperçu indisponible. Vous pouvez quand même téléverser ce fichier.';

  @override
  String get supportUploadFailed => 'Échec du téléversement. Réessayez.';

  @override
  String get supportUploadFailedNetwork =>
      'Échec du téléversement. Vérifiez votre connexion et réessayez.';

  @override
  String get supportUploadFailedAuth =>
      'Échec du téléversement, car votre session a expiré. Reconnectez-vous, puis réessayez.';

  @override
  String get supportUploadFailedPermission =>
      'Échec du téléversement, car votre compte ne peut pas ajouter de fichiers à ce dossier de support.';

  @override
  String get supportUploadFailedInvalidFile =>
      'Échec du téléversement, car ce type ou cette taille de fichier n’est pas autorisé.';

  @override
  String get supportUploadFailedAppVerification =>
      'Téléversement bloqué par la vérification de l’application. Mettez l’application à jour ou contactez le support.';

  @override
  String get supportUploadFailedDebugAppCheck =>
      'Téléversement bloqué par Firebase App Check. Enregistrez le jeton de débogage de cet appareil, puis réessayez.';

  @override
  String supportImagePreviewLabel(Object name) {
    return 'Aperçu de l’image : $name';
  }

  @override
  String get supportRequestEvidence => 'Demander des preuves';

  @override
  String get supportRequestingEvidence => 'Demande...';

  @override
  String get supportEvidenceNote => 'Que doit ajouter le client ?';

  @override
  String get supportResolve => 'Marquer résolu';

  @override
  String get supportResolving => 'Résolution...';

  @override
  String get supportReopen => 'Rouvrir';

  @override
  String get supportReopening => 'Réouverture...';

  @override
  String get supportInternalNotes => 'Notes internes';

  @override
  String get supportAddInternalNote => 'Ajouter une note interne';

  @override
  String get supportSavingNote => 'Enregistrement...';

  @override
  String get supportNote => 'Note';

  @override
  String get supportTimeline => 'Chronologie';

  @override
  String get supportActions => 'Actions';

  @override
  String get supportFilters => 'Filtres';

  @override
  String get supportAllCases => 'Tous les dossiers';

  @override
  String get supportSlaBreaches => 'Délais dépassés';

  @override
  String get supportFraudSafety => 'Fraude et sécurité';

  @override
  String get supportOpenFromTransaction =>
      'Ouvrez un dossier avec l’entreprise responsable. Si ce n’est pas résolu, un admin Laawol peut intervenir.';

  @override
  String get supportCaseOpened => 'Dossier de support ouvert';

  @override
  String get supportActionFailed => 'Action de support échouée';

  @override
  String get supportImageSource => 'Choisir une image';

  @override
  String get supportCamera => 'Caméra';

  @override
  String get supportGallery => 'Galerie';

  @override
  String supportReplyingTo(Object name) {
    return 'Réponse à $name';
  }

  @override
  String get supportEdited => 'modifié';

  @override
  String get supportReply => 'Répondre';

  @override
  String get supportDeleteForMe => 'Supprimer pour moi';

  @override
  String get supportEditMessage => 'Modifier le message';

  @override
  String get supportSaveEdit => 'Enregistrer';

  @override
  String get supportCancelReply => 'Annuler la réponse';

  @override
  String supportCaseStatusLabel(Object status) {
    return 'Statut : $status';
  }

  @override
  String get support => 'Support';

  @override
  String get supportTeam => 'Équipe support';

  @override
  String get supportCase => 'Dossier de support';

  @override
  String get supportBusinessInbox => 'Support entreprise';

  @override
  String get supportBusinessInboxSubtitle =>
      'Examinez les dossiers clients, demandez des preuves et coordonnez avec l’assistance Laawol.';

  @override
  String get supportAdminQueue => 'File de support';

  @override
  String get supportAdminQueueSubtitle =>
      'Assignez, escaladez, résolvez et documentez les dossiers de la marketplace.';

  @override
  String get supportNewCase => 'Nouveau dossier';

  @override
  String get supportUnavailable => 'Support indisponible';

  @override
  String get supportSignInRequired =>
      'Connectez-vous pour ouvrir et consulter les dossiers de support.';

  @override
  String get supportBusinessRequired =>
      'Un profil d’entreprise est requis pour utiliser le support entreprise.';

  @override
  String get supportUnableToLoad => 'Impossible de charger le support';

  @override
  String get supportSearchCases => 'Rechercher des dossiers';

  @override
  String get supportNoCasesDesc =>
      'Les conversations et mises à jour du support apparaîtront ici.';

  @override
  String get supportLastMessageFallback =>
      'Ouvrez le dossier pour continuer la conversation.';

  @override
  String get supportStatusOpen => 'Ouvert';

  @override
  String get supportStatusWaitingCustomer => 'En attente du client';

  @override
  String get supportStatusWaitingBusiness => 'En attente de l’entreprise';

  @override
  String get supportStatusResolved => 'Résolu';

  @override
  String get supportStatusClosed => 'Fermé';

  @override
  String get supportFilterWaiting => 'En attente';

  @override
  String get supportPriorityNormal => 'Normal';

  @override
  String get supportPriorityUrgent => 'Urgent';

  @override
  String get supportPriorityEscalated => 'Escaladé';

  @override
  String get supportCategory => 'Catégorie';

  @override
  String get supportCategoryGeneral => 'Général';

  @override
  String get supportCategoryPayment => 'Paiement';

  @override
  String get supportCategoryDelivery => 'Livraison';

  @override
  String get supportCategoryVehicle => 'Véhicule';

  @override
  String get supportCategoryBarrel => 'Baril';

  @override
  String get supportCategoryTransport => 'Transport';

  @override
  String get supportCategoryRefund => 'Remboursement';

  @override
  String get supportAdmin => 'Admin';

  @override
  String get supportSystem => 'Système';

  @override
  String get supportSubject => 'Sujet';

  @override
  String get supportInitialMessage => 'Message initial';

  @override
  String get supportCreateCase => 'Créer le dossier';

  @override
  String get supportCreatingCase => 'Création du dossier...';

  @override
  String get supportCaseActions => 'Actions du dossier';

  @override
  String get supportAssignToMe => 'M’assigner';

  @override
  String get supportResolveCase => 'Résoudre le dossier';

  @override
  String get supportReopenCase => 'Rouvrir le dossier';

  @override
  String get supportEvidenceRequested => 'Preuves demandées';

  @override
  String get supportEvidenceAttached => 'Preuve jointe';

  @override
  String get supportEvidenceUploaded => 'Preuve téléversée.';

  @override
  String get supportEscalateCase => 'Escalader le dossier';

  @override
  String get supportEscalate => 'Escalader';

  @override
  String get supportCaseEscalated => 'Dossier escaladé.';

  @override
  String get supportEvidenceRequest => 'Demande de preuves';

  @override
  String get supportSendRequest => 'Envoyer la demande';

  @override
  String get supportSendingRequest => 'Envoi de la demande...';

  @override
  String get supportEvidenceRequestSent => 'Demande de preuves envoyée.';

  @override
  String get supportResolutionNote => 'Note de résolution';

  @override
  String get supportCaseResolved => 'Dossier résolu.';

  @override
  String get supportReopenReason => 'Raison de réouverture';

  @override
  String get supportCaseReopened => 'Dossier rouvert.';

  @override
  String get supportCaseAssigned => 'Dossier assigné.';

  @override
  String get supportInternalNote => 'Note interne';

  @override
  String get supportSaveNote => 'Enregistrer la note';

  @override
  String get supportInternalNoteSaved => 'Note interne enregistrée.';

  @override
  String get supportMessage => 'Message';

  @override
  String get supportMessageHint => 'Écrire un message...';

  @override
  String get supportSendMessage => 'Envoyer le message';

  @override
  String get supportNoMessages => 'Aucun message';

  @override
  String get supportNoMessagesDesc =>
      'Envoyez le premier message pour démarrer ce fil de support.';

  @override
  String get supportNoInternalNotes => 'Aucune note interne';

  @override
  String get supportNoInternalNotesDesc =>
      'Les notes admin de ce dossier apparaîtront ici.';

  @override
  String get supportUnassigned => 'Non assigné';

  @override
  String get supportResolvedComposerDisabled =>
      'Ce dossier est résolu. Rouvrez-le pour envoyer un autre message.';

  @override
  String get supportSystemMessage => 'Mise à jour système';

  @override
  String get supportDeletedMessage => 'Ce message a été supprimé';

  @override
  String get supportAttachment => 'Pièce jointe';

  @override
  String get supportAddEvidence => 'Ajouter une preuve';

  @override
  String get supportUploadImageEvidence => 'Téléverser une image comme preuve';

  @override
  String get supportAddFileMetadata => 'Ajouter les détails du fichier';

  @override
  String get supportAddVoiceMetadata => 'Ajouter les détails vocaux';

  @override
  String get supportImageAttachment => 'Image jointe';

  @override
  String get supportVoiceAttachment => 'Message vocal';

  @override
  String get supportFileAttachment => 'Fichier joint';

  @override
  String get supportVideoAttachment => 'Vidéo jointe';

  @override
  String get supportOpenAttachment => 'Ouvrir la pièce jointe';

  @override
  String supportVoiceDuration(Object duration) {
    return 'Vocal $duration';
  }

  @override
  String supportAttachmentSize(Object size) {
    return '$size';
  }

  @override
  String get supportFileName => 'Nom du fichier';

  @override
  String get supportFileUrl => 'URL du fichier';

  @override
  String get supportDurationSeconds => 'Durée en secondes';

  @override
  String get supportSizeBytes => 'Taille en octets';

  @override
  String get supportFileReadFailed =>
      'Impossible de lire ce fichier. Réessayez.';

  @override
  String get supportUnsupportedAttachmentType =>
      'Choisissez un fichier PDF, texte, Word ou DOCX.';

  @override
  String get supportImageTooLarge => 'Choisissez une image de moins de 10 Mo.';

  @override
  String get supportVideoTooLarge => 'Choisissez une vidéo de moins de 50 Mo.';

  @override
  String get supportDocumentTooLarge =>
      'Choisissez un document de moins de 25 Mo.';

  @override
  String get supportVoiceTooLarge =>
      'Choisissez un fichier audio de moins de 10 Mo.';

  @override
  String get supportAttach => 'Joindre';

  @override
  String get supportAttaching => 'Ajout...';

  @override
  String supportPurchaseCaseSubject(Object carTitle) {
    return 'Support pour $carTitle';
  }

  @override
  String get supportSharedBarrelCaseSubject => 'Aide baril partagé';

  @override
  String get supportPlatformSenderName => 'Assistance Laawol';

  @override
  String get supportBusinessSenderName => 'Entreprise';

  @override
  String get parkingStepWhereWhen => 'Où et quand';

  @override
  String get parkingStepChooseSpot => 'Choisir un emplacement';

  @override
  String get parkingStepYourCar => 'Votre voiture';

  @override
  String get parkingStepReview => 'Vérification';

  @override
  String parkingStepIndicator(Object current, Object total) {
    return 'Étape $current sur $total';
  }

  @override
  String get parkingContinue => 'Continuer';

  @override
  String get parkingBack => 'Retour';

  @override
  String get parkingReviewHeading => 'Vérifier et réserver';

  @override
  String get parkingReviewVehicle => 'Véhicule';

  @override
  String get parkingReviewDates => 'Dates';

  @override
  String get parkingReviewPickupYes => 'Ramassage demandé';

  @override
  String get parkingReviewPickupNo => 'Pas de ramassage';

  @override
  String get hubGuestName => 'vous';

  @override
  String get hubQuickActions => 'Actions rapides';

  @override
  String get hubSendBarrel => 'Envoyer un baril';

  @override
  String get hubShipFullBarrel => 'Expédier un baril complet au pays';

  @override
  String get hubBrowseCars => 'Parcourir les voitures';

  @override
  String get hubBuyVerifiedCar => 'Acheter une voiture vérifiée';

  @override
  String get hubFollowShipments => 'Suivre vos expéditions';

  @override
  String get hubShipping => 'Expédition';

  @override
  String get hubShippingSubtitle =>
      'Envoyez des barils, du fret et des voitures au pays.';

  @override
  String get hubSharedBarrels => 'Barils partagés';

  @override
  String get hubSharedBarrelsSubtitle => 'Publier ou rejoindre un baril';

  @override
  String get hubFreightSubtitle => 'Au poids · par air ou par mer';

  @override
  String get hubTransportCar => 'Transporter une voiture';

  @override
  String get hubShipCarHome => 'Expédier une voiture au pays';

  @override
  String get hubCarsSubtitle =>
      'Achetez une voiture vérifiée ou stockez-la auprès d’une entreprise.';

  @override
  String get hubParkCarSubtitle => 'Stocker auprès d’une entreprise';

  @override
  String get hubActivitySubtitle =>
      'Vos commandes, expéditions et votre portefeuille.';

  @override
  String get hubOrdersSubtitle => 'Voitures, barils, fret et plus';

  @override
  String get hubWalletSubtitle => 'Solde et remboursements';

  @override
  String get destinationPickupDetailsRequired =>
      'Modifiez chaque destination et ajoutez son adresse, sa date et son heure de ramassage.';

  @override
  String get destinationPickupDetailsHelp =>
      'Modifiez chaque destination avec son lieu et sa date de ramassage.';

  @override
  String get noShowHistory => 'Historique des absences';

  @override
  String get noShowHistoryMessage =>
      'Si vous ne revenez pas avant la date de fin de réservation et que l’entreprise indique que vous ne vous êtes pas présenté, l’acompte peut être perdu et ce résultat peut être visible par les entreprises qui vendent des voitures.';

  @override
  String get holdUntil => 'Réserver jusqu’au';

  @override
  String get marketplaceResponsibilityTitle =>
      'Comprendre qui fournit ce service';

  @override
  String marketplaceProviderResponsibilityBody(Object providerNames) {
    return '$providerNames est une entreprise indépendante responsable du bien ou du service, notamment de son exécution, de son état, du délai de livraison et de la qualité de sa prestation.';
  }

  @override
  String get marketplacePaymentFlowBody =>
      'Laawol vous aide à trouver des entreprises, encaisse et traite votre paiement, peut déduire des frais de plateforme indiqués et peut transférer ultérieurement la rémunération de l’entreprise. Laawol peut aider au suivi, à l’assistance, aux remboursements et aux litiges.';

  @override
  String get marketplaceNoGuaranteeBody =>
      'Laawol n’est ni le vendeur, ni le transporteur, ni le prestataire et ne garantit ni la date de livraison ni la prestation de l’entreprise. Cela ne limite pas les droits auxquels la loi ne permet pas de renoncer.';

  @override
  String get freightAutoChargeDisclosureBody =>
      'Le poids que vous indiquez est une estimation. Si l’entreprise confirme un poids différent après la prise en charge, Laawol tentera de facturer automatiquement la carte utilisée aujourd’hui pour tout montant supplémentaire dû. Si cette charge échoue, vous devrez ouvrir l’application pour finaliser le paiement avant que votre expédition puisse continuer. Si votre expédition pèse moins, vous serez automatiquement remboursé.';

  @override
  String get marketplaceResponsibilityCheckbox =>
      'Je comprends la responsabilité de l’entreprise et je souhaite continuer.';

  @override
  String get selectedBusiness => 'L’entreprise sélectionnée';

  @override
  String get accountLegalAcceptance =>
      'J’accepte les Conditions d’utilisation et la Politique de confidentialité de Laawol, y compris son rôle de place de marché.';

  @override
  String get accountLegalAcceptanceRequired =>
      'Veuillez accepter les Conditions d’utilisation et la Politique de confidentialité pour continuer.';

  @override
  String get businessResponsibilityAcceptance =>
      'Je comprends que mon entreprise est indépendamment responsable de ses annonces, prix, biens, services, exécution, délais de livraison, autorisations et obligations envers les clients.';

  @override
  String get businessResponsibilityRequired =>
      'Confirmez la déclaration de responsabilité de l’entreprise pour envoyer votre demande.';

  @override
  String get verifyPhoneToContinueTitle =>
      'Vérifiez votre téléphone pour continuer';

  @override
  String get verifyPhoneToContinueBody =>
      'Les barils partagés sont réservés aux clients dont le numéro de téléphone est vérifié. Nous enverrons un code au numéro associé à votre compte.';

  @override
  String get verifyPhone => 'Vérifier le téléphone';

  @override
  String get notNow => 'Pas maintenant';

  @override
  String get phoneVerificationTitle => 'Vérification du téléphone';

  @override
  String get phoneVerificationExplanation =>
      'Confirmez ou modifiez le numéro de portable de votre compte. Nous vous enverrons un code de vérification à usage unique par SMS.';

  @override
  String get phoneVerificationCountryCodeHelp =>
      'Choisissez l’indicatif du pays, puis saisissez le numéro mobile.';

  @override
  String get phoneVerificationCodeSentTitle => 'Code envoyé';

  @override
  String phoneVerificationCodeSent(Object phone) {
    return 'Saisissez le code à 6 chiffres envoyé au $phone.';
  }

  @override
  String get phoneVerificationCode => 'Code de vérification';

  @override
  String get phoneVerificationSendCode => 'Envoyer le code de vérification';

  @override
  String get phoneVerificationSendingCode => 'Envoi du code...';

  @override
  String get phoneVerificationVerifying => 'Vérification...';

  @override
  String get phoneVerificationResending => 'Nouvel envoi...';

  @override
  String get phoneVerificationResent => 'Un nouveau code a été envoyé.';

  @override
  String get phoneVerificationResend => 'Renvoyer le code';

  @override
  String phoneVerificationResendIn(int seconds) {
    return 'Renvoyer le code dans $seconds s';
  }

  @override
  String get phoneVerificationChangeNumber => 'Changer de numéro';

  @override
  String get phoneVerificationSmsNotice =>
      'Les frais SMS et de données habituels peuvent s’appliquer. Le code sert uniquement à vérifier que ce téléphone vous appartient.';

  @override
  String get phoneVerificationInvalidPhone =>
      'Saisissez un numéro international valide commençant par + et l’indicatif du pays.';

  @override
  String get phoneVerificationEnterCode => 'Saisissez le code à 6 chiffres.';

  @override
  String get phoneVerificationInvalidCode =>
      'Ce code est incorrect. Vérifiez-le et réessayez.';

  @override
  String get phoneVerificationExpiredCode =>
      'Ce code a expiré. Demandez un nouveau code et réessayez.';

  @override
  String get phoneVerificationTooManyAttempts =>
      'Trop de tentatives de vérification. Attendez avant de réessayer.';

  @override
  String get phoneVerificationNetworkError =>
      'Vérifiez votre connexion et réessayez.';

  @override
  String get phoneVerificationRequestTimedOut =>
      'Nous n’avons reçu aucune réponse. Vérifiez votre connexion et réessayez.';

  @override
  String get phoneVerificationPhoneInUse =>
      'Ce numéro de téléphone est déjà associé à un autre compte.';

  @override
  String get phoneVerificationRecentLogin =>
      'Pour des raisons de sécurité, déconnectez-vous, reconnectez-vous, puis vérifiez à nouveau votre téléphone.';

  @override
  String get phoneVerificationAppCheck =>
      'Le contrôle de sécurité de l’app a échoué. Enregistrez cet appareil de débogage dans Firebase App Check, puis rouvrez l’app.';

  @override
  String get phoneVerificationGenericError =>
      'Nous n’avons pas pu vérifier votre téléphone. Réessayez.';

  @override
  String get phoneVerificationSyncPending =>
      'Votre code a été accepté, mais nous n’avons pas pu terminer la mise à jour de votre profil. Terminez à nouveau la vérification ; aucun autre SMS n’est nécessaire.';

  @override
  String get phoneVerificationFinish => 'Terminer la vérification';

  @override
  String get phoneVerificationFinishing => 'Finalisation de la vérification...';

  @override
  String get phoneVerificationSavePhoneFirst =>
      'Enregistrez ce numéro avant de le vérifier.';

  @override
  String get phoneVerificationSaveAndVerify => 'Enregistrer et vérifier';

  @override
  String get phoneVerificationSavingNumber => 'Enregistrement du numéro...';

  @override
  String get phoneVerificationEditedStatus =>
      'Ce numéro n’est ni enregistré ni vérifié.';

  @override
  String get phoneVerificationUnverifiedHelp =>
      'Vérifiez ce numéro pour utiliser les fonctions protégées du compte.';

  @override
  String get phoneVerificationVerifiedHelp =>
      'Ce numéro correspond au téléphone vérifié de manière sécurisée sur votre compte.';

  @override
  String get phoneVerificationSuccess =>
      'Votre numéro de téléphone est vérifié.';

  @override
  String get phoneVerificationSuccessTitle => 'Téléphone vérifié';

  @override
  String get phoneVerificationReturnToSharedBarrels =>
      'Retourner aux barils partagés';

  @override
  String get phoneVerificationVerified => 'Téléphone vérifié';

  @override
  String get phoneVerificationNotVerified => 'Téléphone non vérifié';

  @override
  String get phoneCountryCode => 'Indicatif du pays';

  @override
  String get selectCountryCode => 'Sélectionner l’indicatif du pays';

  @override
  String get phoneCountrySearchHint => 'Rechercher un pays ou un indicatif';

  @override
  String get noCountryCodesFound => 'Aucun indicatif trouvé';

  @override
  String get sharedBarrelActionFailed =>
      'Nous n’avons pas pu terminer cette action de baril partagé. Réessayez.';

  @override
  String get sharedBarrelsLoadFailed =>
      'Vérifiez votre connexion et réessayez. Vos informations sont en sécurité.';

  @override
  String get sharedBarrelFormLoadFailed =>
      'Nous n’avons pas pu ouvrir le formulaire de baril partagé. Vérifiez votre connexion et réessayez.';

  @override
  String get marketplaceBalancePaymentSummary => 'Paiement du solde';

  @override
  String get marketplaceDestinationChangeSummary =>
      'Modification payante de la destination';

  @override
  String get pickupBusinessUnavailable =>
      'Cette entreprise ne propose pas encore la collecte à domicile. Choisissez le dépôt au bureau ou un autre prestataire.';

  @override
  String get pickupAddressQuoteFailed =>
      'La collecte n\'est pas disponible pour cette adresse. Vérifiez l\'adresse ou choisissez le dépôt au bureau.';

  @override
  String get pickupPlanSectionTitle => 'Collecte à domicile';

  @override
  String get pickupPlanSectionSubtitle =>
      'Enlever les articles à l\'adresse du client au lieu qu\'il vous les apporte. Chaque service suit votre plan partagé ou définit le sien.';

  @override
  String get pickupPlanOfferToggle => 'Utiliser un plan partagé';

  @override
  String get pickupPlanDisabledHint =>
      'Les services réglés sur « suivre le plan partagé » ci-dessous sont tarifés selon ces réglages.';

  @override
  String get pickupPlanModeLabel => 'Mode de tarification';

  @override
  String get pickupPlanModeFlat => 'Frais fixe';

  @override
  String get pickupPlanModeDistance => 'Par distance';

  @override
  String get pickupPlanModeBorough => 'Par arrondissement (NYC)';

  @override
  String get pickupPlanMaxMiles => 'Distance max de collecte (miles)';

  @override
  String get pickupPlanFlatHint =>
      'Un prix unique pour toute collecte dans votre distance maximale. Les adresses au-delà sont refusées, jamais surfacturées.';

  @override
  String get pickupPlanFlatFee => 'Frais fixes de collecte (USD)';

  @override
  String get pickupPlanDistanceHint =>
      'Frais = frais de base + tarif au mile × distance routière, jamais en dessous de votre minimum. Les adresses au-delà de votre distance maximale sont refusées.';

  @override
  String get pickupPlanOriginAddress => 'Adresse de départ de la collecte';

  @override
  String get pickupPlanOriginHelper => 'Point de départ de vos collectes';

  @override
  String get pickupPlanBaseFee => 'Frais de base (USD)';

  @override
  String get pickupPlanPerMile => 'Par mile (USD)';

  @override
  String get pickupPlanMinFee => 'Frais minimum (USD)';

  @override
  String get pickupPlanBoroughHint =>
      'Un tarif fixe par arrondissement desservi. Laissez un arrondissement vide pour ne pas le desservir — l\'adresse du client détermine le tarif appliqué.';

  @override
  String get pickupPlanPerServiceHint => 'Chaque service, un par un';

  @override
  String get pickupPlanChoiceInherit => 'Suivre le plan partagé';

  @override
  String get pickupPlanChoiceCustom => 'Définir ses propres frais de collecte';

  @override
  String get pickupPlanChoiceOff => 'Pas de collecte pour ce service';

  @override
  String get pickupPlanSharedSectionLabel => 'le plan de collecte partagé';

  @override
  String get pickupPlanServiceBarrels => 'Expédition de barils';

  @override
  String get pickupPlanServiceFreight => 'Fret';

  @override
  String get pickupPlanServiceParking => 'Stationnement';

  @override
  String get pickupPlanServiceCarTransport => 'Transport de voitures';

  @override
  String pickupPlanErrorCapRequired(Object section) {
    return 'Saisissez la distance maximale de collecte en miles pour $section.';
  }

  @override
  String pickupPlanErrorFlatFee(Object section) {
    return 'Saisissez le tarif fixe de collecte pour $section.';
  }

  @override
  String pickupPlanErrorDistanceFees(Object section) {
    return 'Saisissez les frais de base, au mile et minimum pour $section.';
  }

  @override
  String pickupPlanErrorOrigin(Object section) {
    return 'Saisissez l\'adresse de départ de la collecte pour $section.';
  }

  @override
  String pickupPlanErrorBoroughPrice(Object section) {
    return 'Définissez un tarif de collecte pour au moins un arrondissement pour $section.';
  }

  @override
  String pickupPlanErrorBoroughRequiresNewYork(Object section) {
    return 'La collecte par arrondissement n\'est disponible que pour les entreprises de New York ($section).';
  }

  @override
  String get freightPickupSectionTitle => 'Enlèvement du fret';

  @override
  String get freightPickupSectionSubtitle =>
      'Proposez de récupérer les colis à l\'adresse de votre client et choisissez le mode de calcul des frais.';

  @override
  String get freightPickupOfferToggle => 'Proposer l\'enlèvement du fret';

  @override
  String get freightPickupModelDistance => 'Par distance';

  @override
  String get freightPickupModelBorough => 'Par arrondissement';

  @override
  String get freightPickupDistanceHint =>
      'Frais = frais de base + tarif au km × distance de conduite depuis votre adresse. Laissez les tarifs à 0 pour un enlèvement gratuit.';

  @override
  String get freightPickupOriginAddress => 'Adresse de départ de l\'enlèvement';

  @override
  String get freightPickupOriginAddressHelper =>
      'Point de départ de vos chauffeurs. Par défaut, l\'adresse de votre entreprise.';

  @override
  String get freightPickupBaseFee => 'Frais de base';

  @override
  String get freightPickupPerKm => 'Par km';

  @override
  String get freightPickupMinFee => 'Frais minimum';

  @override
  String get freightPickupMaxKm => 'Distance max (km)';

  @override
  String get freightPickupBoroughHint =>
      'Définissez un tarif d\'enlèvement fixe pour chaque arrondissement de New York que vous desservez. Laissez vide ceux que vous ne couvrez pas.';

  @override
  String get freightPickupBoroughPriceRequired =>
      'Définissez un tarif d\'enlèvement pour au moins un arrondissement, ou désactivez l\'enlèvement du fret.';

  @override
  String get freightPickupCustomerToggle => 'Enlèvement à mon adresse';

  @override
  String get freightPickupAddressLabel => 'Adresse d\'enlèvement';

  @override
  String get freightPickupBoroughLabel => 'Arrondissement';

  @override
  String get freightPickupDateTimeLabel => 'Date et heure d\'enlèvement';

  @override
  String get freightPickupChooseDateTime => 'Choisir la date et l\'heure';

  @override
  String get freightPickupFeeLabel => 'Frais d\'enlèvement';

  @override
  String get freightPickupCalculating => 'Calcul des frais d\'enlèvement…';

  @override
  String get freightPickupEnterDetailsForFee =>
      'Saisissez vos détails d\'enlèvement pour voir les frais.';

  @override
  String get freightPickupSelectDateTime =>
      'Veuillez choisir une date et une heure d\'enlèvement.';

  @override
  String get freightPickupUnavailableCustomer =>
      'Cette entreprise ne propose pas l\'enlèvement pour le moment.';

  @override
  String get freightPickupOutOfRangeCustomer =>
      'Votre adresse est en dehors de la zone d\'enlèvement de cette entreprise.';

  @override
  String get freightPickupQuoteFailed =>
      'Nous n\'avons pas pu calculer les frais d\'enlèvement. Vérifiez l\'adresse et réessayez.';

  @override
  String freightPickupDistanceAway(String distanceKm) {
    return 'à $distanceKm km';
  }

  @override
  String get freightPickupFreeLabel => 'Enlèvement gratuit';

  @override
  String get freightAirDepartureDays => 'Jours de départ du fret aérien';

  @override
  String get freightSeaDepartureDays => 'Jours de départ du fret maritime';

  @override
  String get freightDepartureDaysHelper =>
      'Facultatif. Choisissez les jours de départ habituels de ce service.';

  @override
  String get mondayShort => 'Lun';

  @override
  String get tuesdayShort => 'Mar';

  @override
  String get wednesdayShort => 'Mer';

  @override
  String get thursdayShort => 'Jeu';

  @override
  String get fridayShort => 'Ven';

  @override
  String get saturdayShort => 'Sam';

  @override
  String get sundayShort => 'Dim';

  @override
  String regularDepartureDays(String days) {
    return 'Départs habituels : $days';
  }

  @override
  String get allPeople => 'Toutes les personnes';

  @override
  String get platformAdministrators => 'Administrateurs de la plateforme';

  @override
  String get businessOwners => 'Propriétaires d’entreprise';

  @override
  String get pendingInvitations => 'Invitations en attente';

  @override
  String get missingProfiles => 'Profils manquants';

  @override
  String get suspendedAccounts => 'Comptes suspendus';

  @override
  String get people => 'Personnes';

  @override
  String get invitePerson => 'Inviter une personne';

  @override
  String get searchPeopleHint =>
      'Rechercher un e-mail, téléphone ou identifiant exact';

  @override
  String get clearSearch => 'Effacer la recherche';

  @override
  String get loadMorePeople => 'Afficher plus de personnes';

  @override
  String get peopleCouldNotLoad => 'Impossible de charger les personnes';

  @override
  String get tryAgain => 'Réessayer';

  @override
  String get notProvided => 'Non renseigné';

  @override
  String get noPeopleFound => 'Aucune personne trouvée';

  @override
  String get noPeopleFoundHelp =>
      'Essayez un autre filtre ou recherchez une adresse e-mail, un numéro de téléphone ou un identifiant exact.';

  @override
  String get peopleAccessRestricted => 'L’accès aux personnes est limité';

  @override
  String get peopleAccessRestrictedHelp =>
      'Votre rôle d’administrateur ne permet pas de consulter les personnes de la place de marché.';

  @override
  String get you => 'Vous';

  @override
  String get platformAdministrator => 'Administrateur de la plateforme';

  @override
  String get businessStaffMember => 'Membre du personnel de l’entreprise';

  @override
  String get pendingInvitation => 'Invitation en attente';

  @override
  String get missingProfile => 'Profil manquant';

  @override
  String get invitationPending => 'Invitation en attente';

  @override
  String get deletionPending => 'Suppression en attente';

  @override
  String get authenticationMissing => 'Authentification manquante';

  @override
  String get identityAndAccess => 'Identité et accès';

  @override
  String get emailVerification => 'Vérification de l’e-mail';

  @override
  String get verified => 'Vérifié';

  @override
  String get notVerified => 'Non vérifié';

  @override
  String get businessAccess => 'Accès à l’entreprise';

  @override
  String get businessPermissions => 'Autorisations de l’entreprise';

  @override
  String get businessPermissionsHelp =>
      'Accordez uniquement les outils nécessaires. Vous pourrez modifier l’accès ultérieurement.';

  @override
  String get noAssignedPermissions => 'Aucune autorisation attribuée';

  @override
  String get cannotChangeOwnAccess =>
      'Pour votre sécurité, vous ne pouvez pas modifier votre propre accès depuis cet écran.';

  @override
  String get accountActions => 'Actions sur le compte';

  @override
  String get suspendAccount => 'Suspendre le compte';

  @override
  String get suspendAccountConfirm =>
      'Cette personne perdra immédiatement l’accès et toutes ses sessions actives seront révoquées.';

  @override
  String get restoreAccount => 'Rétablir le compte';

  @override
  String get restoreAccountConfirm =>
      'Cette personne pourra de nouveau se connecter.';

  @override
  String get accountSuspended => 'Compte suspendu';

  @override
  String get accountRestored => 'Compte rétabli';

  @override
  String get revokeSessions => 'Révoquer les sessions actives';

  @override
  String get sessionsRevoked => 'Sessions actives révoquées';

  @override
  String get sendPasswordReset => 'Envoyer la réinitialisation du mot de passe';

  @override
  String get passwordResetSent => 'Réinitialisation du mot de passe demandée';

  @override
  String get sendVerificationEmail => 'Envoyer l’e-mail de vérification';

  @override
  String get verificationEmailSent => 'E-mail de vérification demandé';

  @override
  String get transferOwnership => 'Transférer la propriété de l’entreprise';

  @override
  String get transferOwnershipConfirm =>
      'Ce membre du personnel deviendra propriétaire et le propriétaire actuel deviendra membre du personnel.';

  @override
  String get ownershipTransferred => 'Propriété de l’entreprise transférée';

  @override
  String get resendInvitation => 'Renvoyer l’invitation';

  @override
  String get invitationResent => 'Invitation renvoyée';

  @override
  String get cancelInvitation => 'Annuler l’invitation';

  @override
  String get cancelInvitationConfirm =>
      'Cette invitation ne pourra plus être utilisée.';

  @override
  String get invitationCancelled => 'Invitation annulée';

  @override
  String get reviewDeletionRequest => 'Examiner la suppression du compte';

  @override
  String get deletionBlocked => 'La suppression est bloquée';

  @override
  String deletionBlockedByRecords(int count) {
    return '$count dossier(s) actif(s) ou conservé(s) légalement doivent être résolus avant la suppression de ce compte.';
  }

  @override
  String get finalizeAccountDeletion => 'Finaliser la suppression du compte';

  @override
  String get finalizeAccountDeletionConfirm =>
      'Cette action supprime définitivement l’accès après confirmation par le serveur qu’aucun dossier ne bloque la suppression. Elle est irréversible.';

  @override
  String get accountDeletionFinalized => 'Suppression du compte finalisée';

  @override
  String get adminApprovedDeletion =>
      'Suppression examinée et approuvée par un administrateur de la plateforme.';

  @override
  String get invitePlatformAdministrator =>
      'Inviter un administrateur de la plateforme';

  @override
  String get invitePlatformAdministratorHelp =>
      'Choisissez un rôle d’administrateur limité. L’accès super administrateur n’est jamais accordé par invitation.';

  @override
  String get inviteBusinessPersonnel => 'Inviter du personnel d’entreprise';

  @override
  String get inviteBusinessPersonnelHelp =>
      'Sélectionnez l’entreprise et les outils précis que cette personne peut utiliser.';

  @override
  String get sendInvitation => 'Envoyer l’invitation';

  @override
  String get invitationSent => 'Invitation envoyée';

  @override
  String get adminRole => 'Rôle d’administrateur';

  @override
  String get superAdministrator => 'Super administrateur';

  @override
  String get operationsManager => 'Responsable des opérations';

  @override
  String get financeManager => 'Responsable financier';

  @override
  String get supportAdministrator => 'Administrateur du support';

  @override
  String get contentManager => 'Responsable du contenu';

  @override
  String get profile => 'Profil';

  @override
  String get listings => 'Annonces';

  @override
  String get barrels => 'Barils';

  @override
  String get freight => 'Fret';

  @override
  String get transport => 'Transport';

  @override
  String get parking => 'Stationnement';

  @override
  String get destinations => 'Destinations';

  @override
  String get growth => 'Croissance';

  @override
  String get invitationProfileSetupTitle =>
      'Terminez la configuration de votre accès invité';

  @override
  String get invitationProfileSetupHelp =>
      'Vérifiez cette adresse e-mail, puis revenez ici pour activer le rôle auquel vous avez été invité.';

  @override
  String get verifyInvitedEmail => 'Envoyer l’e-mail de vérification';

  @override
  String get sendingVerificationEmail => 'Envoi de l’e-mail de vérification…';

  @override
  String get iVerifiedContinue => 'J’ai vérifié — continuer';

  @override
  String get invitationVerificationEmailSent =>
      'E-mail de vérification envoyé. Consultez votre boîte de réception, puis revenez ici.';

  @override
  String get invitationVerificationEmailFailed =>
      'Impossible d’envoyer l’e-mail de vérification. Veuillez réessayer.';

  @override
  String get editTransportRequest => 'Modifier la demande';

  @override
  String get editTransportRequestTitle => 'Modifier votre demande';

  @override
  String get editTransportRequestSubtitle =>
      'Vous pouvez modifier votre demande tant que vous n’avez pas choisi de devis.';

  @override
  String get transportEditContactSection => 'Contact et enlèvement';

  @override
  String get transportEditVehicleSection => 'Véhicule et destination';

  @override
  String get transportEditQuoteWarningTitle => 'Vos devis seront réinitialisés';

  @override
  String get transportEditQuoteWarningMessage =>
      'Les entreprises ont chiffré leurs devis selon vos informations actuelles. Modifier le véhicule, la zone d’enlèvement, le mode de transport ou la destination efface les devis reçus, et les entreprises devront chiffrer à nouveau.';

  @override
  String get transportEditKeepEditing => 'Continuer la modification';

  @override
  String get transportEditSaveAnyway => 'Enregistrer et réinitialiser';

  @override
  String get transportEditSaved => 'Demande mise à jour';

  @override
  String get transportEditSavedRequote =>
      'Demande mise à jour. Les entreprises enverront de nouveaux devis.';

  @override
  String get transportEditNoChanges => 'Aucune modification';

  @override
  String get couldNotUpdateTransportRequest =>
      'Impossible de mettre à jour cette demande. Veuillez réessayer.';

  @override
  String get transportEditDestinationMoved =>
      'Votre demande est désormais envoyée aux entreprises qui desservent la nouvelle destination.';

  @override
  String get notes => 'Remarques';

  @override
  String get vehicleOperable => 'Le véhicule roule';

  @override
  String get transportEditNeedsPickup =>
      'J’ai besoin d’un enlèvement à une adresse';

  @override
  String get addressApartmentLabel =>
      'Appartement, suite ou unité (facultatif)';

  @override
  String get addressApartmentHint => 'App. 4B';

  @override
  String get addressApartmentHelper =>
      'Les numéros d’appartement figurent rarement dans la suggestion — ajoutez le vôtre ici.';

  @override
  String get addressCityLabel => 'Ville';

  @override
  String get addressStateLabel => 'État ou région';

  @override
  String get addressPostalCodeLabel => 'Code postal ou ZIP';

  @override
  String get addressCountryLabel => 'Pays';

  @override
  String get recordAParkedCar => 'Enregistrer une voiture stationnée';

  @override
  String get recordTheCar => 'Enregistrer la voiture';

  @override
  String get recordingParkedCar => 'Enregistrement en cours...';

  @override
  String get parkedCarRecorded => 'Voiture stationnée enregistrée';

  @override
  String get printReceiptOnly => 'Imprimer un reçu seulement';

  @override
  String get howDoesThisParkingGetPaid =>
      'Comment ce stationnement est-il payé ?';

  @override
  String get customerPaysUsDirectly =>
      'Le client nous paie directement (Zelle/espèces)';

  @override
  String get sendTheCustomerAPaymentLink =>
      'Envoyer un lien de paiement au client';

  @override
  String get directPaymentExplainer =>
      'Nous enregistrons ce que le client vous doit et ne prenons aucune commission. Vous le marquez comme reçu à l’arrivée de l’argent.';

  @override
  String get paymentLinkExplainer =>
      'Nous facturons le client pour vous et vous versons le reste.';

  @override
  String get paymentLinkShareHint =>
      'Envoyez ce lien au client pour qu’il puisse payer. Il reste valide jusqu’à son utilisation.';

  @override
  String get directPaymentResultHint =>
      'Le client paie votre entreprise directement. Nous enregistrons le montant sans jamais le facturer. Marquez le paiement comme reçu à l’arrivée de l’argent.';

  @override
  String get paymentLinkLabel => 'Lien de paiement';

  @override
  String get copyPaymentLink => 'Copier le lien de paiement';

  @override
  String get sharePaymentLink => 'Partager le lien de paiement';

  @override
  String get paymentLinkShareFailed => 'Impossible d’ouvrir le partage';

  @override
  String paymentLinkShareMessage(
    String business,
    String car,
    String code,
    String amount,
    String link,
  ) {
    return '$business a garé votre $car. Suivi $code. Montant dû $amount. Payez ici : $link';
  }

  @override
  String get paymentLinkCopied => 'Lien de paiement copié';

  @override
  String get amountDue => 'Montant dû';

  @override
  String get amountRecorded => 'Montant enregistré';

  @override
  String get paymentStatusLabel => 'Statut du paiement';

  @override
  String get receivedVia => 'Reçu par';

  @override
  String get markPaymentReceived => 'Marquer le paiement comme reçu';

  @override
  String get markPaymentReceivedTitle => 'Enregistrer ce paiement ?';

  @override
  String get markPaymentReceivedMessage =>
      'Enregistrer ce stationnement comme payé à votre entreprise ? Cette action est irréversible ici.';

  @override
  String get paymentRecorded => 'Paiement enregistré.';

  @override
  String get parkingAlreadyMarkedPaid =>
      'Ce stationnement était déjà marqué comme payé.';

  @override
  String get paymentCouldNotBeRecorded =>
      'Le paiement n’a pas pu être enregistré.';

  @override
  String get carCouldNotBeRecorded => 'La voiture n’a pas pu être enregistrée.';

  @override
  String get paymentLinkCopyFailed =>
      'Le lien de paiement n’a pas pu être copié. Sélectionnez-le et copiez-le manuellement.';

  @override
  String get awaitingPaymentToTheBusiness =>
      'En attente du paiement à l’entreprise';

  @override
  String get paidToTheBusiness => 'Payé à l’entreprise';

  @override
  String get paymentLinkSent => 'Lien de paiement envoyé';

  @override
  String get paymentLinkPaid => 'Lien de paiement payé';

  @override
  String get nothingToCollect => 'Rien à encaisser';

  @override
  String get receivedViaZelle => 'Virement Zelle';

  @override
  String get receivedViaCash => 'Paiement en espèces';

  @override
  String get receivedViaCashApp => 'Cash App';

  @override
  String get receivedViaVenmo => 'Venmo';

  @override
  String get receivedViaCheck => 'Chèque papier';

  @override
  String get receivedViaCardInPerson => 'Carte en personne';

  @override
  String get receivedViaOther => 'Une autre méthode';

  @override
  String get parkingErrorBusinessRequired =>
      'Choisissez une entreprise avant d’enregistrer une voiture.';

  @override
  String get parkingErrorCustomerName => 'Saisissez le nom du client.';

  @override
  String get parkingErrorCustomerPhone =>
      'Saisissez le numéro de téléphone du client.';

  @override
  String get parkingErrorCustomerEmail => 'Saisissez une adresse email valide.';

  @override
  String get parkingErrorPaymentLinkContact =>
      'Un lien de paiement nécessite un numéro de téléphone ou une adresse email.';

  @override
  String get parkingErrorCarMake => 'Sélectionnez la marque de la voiture.';

  @override
  String get parkingErrorCarModel => 'Sélectionnez le modèle de la voiture.';

  @override
  String get parkingErrorCarYear => 'Sélectionnez l’année de la voiture.';

  @override
  String get parkingErrorCarYearInvalid =>
      'Sélectionnez une année de voiture valide.';

  @override
  String get parkingErrorStartDate =>
      'Choisissez le jour d’arrivée de la voiture.';

  @override
  String get parkingErrorEndDate =>
      'Choisissez le jour de départ de la voiture.';

  @override
  String get parkingErrorEndBeforeStart =>
      'La date de fin ne peut pas précéder la date de début.';

  @override
  String get notPaid => 'Non payé';

  @override
  String get parkingPaymentLinkAlreadyUsed =>
      'Ce lien a déjà servi au paiement. Plus rien n’est dû.';

  @override
  String get cancelPaymentLink => 'Annuler le lien de paiement';

  @override
  String get cancelPaymentLinkConfirm =>
      'Annuler ce lien de paiement ? Le client ne pourra plus payer avec.';

  @override
  String get paymentLinkCancelled => 'Lien de paiement annulé.';

  @override
  String get parkingPaymentLinkCancelled => 'Ce lien de paiement a été annulé.';

  @override
  String get paymentLinkCouldNotBeCancelled =>
      'Le lien de paiement n’a pas pu être annulé.';

  @override
  String get parkingPrintReceipt => 'Imprimer le reçu';

  @override
  String get parkingPrintInvoice => 'Imprimer la facture';

  @override
  String get parkingDocumentCouldNotBeOpened =>
      'Le document n’a pas pu être ouvert.';

  @override
  String get resendPaymentLink => 'Renvoyer le lien de paiement';

  @override
  String get parkingPaymentLinkEmailed =>
      'Lien de paiement envoyé au client par e-mail.';

  @override
  String get parkingPaymentLinkTexted =>
      'Lien de paiement envoyé au client par SMS.';

  @override
  String get parkingPaymentLinkEmailedAndTexted =>
      'Lien de paiement envoyé au client par e-mail et par SMS.';

  @override
  String get parkingPaymentLinkNotDelivered =>
      'Le lien n’a pas pu être envoyé par e-mail ni par SMS. Copiez-le et envoyez-le vous-même au client.';

  @override
  String get parkingPaymentLinkCouldNotBeResent =>
      'Le lien de paiement n’a pas pu être renvoyé.';

  @override
  String get parkingPaymentLinkReissued =>
      'Le montant a changé : un nouveau lien de paiement a été émis.';

  @override
  String get parkingPaidCannotBeEdited =>
      'Ce stationnement a été payé et ne peut plus être modifié.';

  @override
  String get parkingNothingChanged => 'Aucune modification n’a été faite.';

  @override
  String get parkingRecordCouldNotBeUpdated =>
      'Le stationnement n’a pas pu être mis à jour.';

  @override
  String get parkedBetween => 'Stationné entre';

  @override
  String get dateFrom => 'Du';

  @override
  String get dateTo => 'Au';

  @override
  String get anyDate => 'Toute date';

  @override
  String get clearDates => 'Effacer les dates';

  @override
  String get vinNumberOptional => 'VIN (facultatif)';

  @override
  String get checkPaymentStatus => 'Vérifier le statut du paiement';

  @override
  String get checkingPaymentStatus => 'Vérification…';

  @override
  String get parkingPaymentConfirmedWithStripe =>
      'Paiement confirmé auprès de Stripe et enregistré.';

  @override
  String get parkingPaymentAlreadyRecorded => 'Déjà enregistré comme payé.';

  @override
  String get parkingPaymentNotReceivedYet =>
      'Stripe n’a pas encore reçu ce paiement.';

  @override
  String get parkingPaymentStatusCouldNotBeChecked =>
      'Le statut du paiement n’a pas pu être vérifié.';

  @override
  String get parkingPaymentLinkAlreadyCancelled =>
      'Ce lien de paiement avait déjà été annulé.';

  @override
  String get parkingEnds => 'Fin prévue';

  @override
  String get parkingEnded => 'Terminé le';

  @override
  String get parkingStatusUpdated => 'Statut du stationnement mis à jour.';

  @override
  String get parkingStatusCouldNotBeUpdated =>
      'Le statut du stationnement n’a pas pu être mis à jour.';

  @override
  String get searchParkedCars =>
      'Rechercher un suivi, un propriétaire, une voiture, un VIN…';

  @override
  String get noParkingRecordsMatchFilter =>
      'Aucun stationnement ne correspond à ce filtre.';

  @override
  String parkedCarRecordedWithCode(Object trackingCode) {
    return 'Voiture stationnée enregistrée. Numéro de suivi : $trackingCode';
  }

  @override
  String get businessServiceOverviewNeedsYou => 'à traiter';

  @override
  String get businessTransportTitle => 'Devis et missions de transport';

  @override
  String get businessTransportSubtitle =>
      'Chiffrez les demandes reçues, puis faites avancer les missions gagnées.';

  @override
  String get businessTransportOpenToBid => 'À chiffrer';

  @override
  String get businessTransportQuoted => 'Vos devis';

  @override
  String get businessTransportWonJobs => 'Missions gagnées';

  @override
  String get businessTransportNoOpportunities =>
      'Aucune demande de transport n’attend un devis pour le moment.';

  @override
  String get businessTransportNoQuotes =>
      'Vous n’avez aucun devis en cours. Chiffrez une demande ouverte.';

  @override
  String get businessTransportNoJobs =>
      'Aucun client n’a encore choisi votre devis.';

  @override
  String get businessTransportQuoteDeadline => 'Date limite du devis';

  @override
  String get businessTransportWindowClosed =>
      'La période de devis est terminée.';

  @override
  String get businessTransportRoute => 'Trajet';

  @override
  String get businessTransportVehicleOperable => 'Roule et démarre';

  @override
  String get businessTransportVehicleNotOperable => 'Nécessite une assistance';

  @override
  String get businessTransportPreferredPickup => 'Enlèvement souhaité';

  @override
  String get businessTransportFlexibleDates => 'Flexible';

  @override
  String get businessTransportSendQuote => 'Envoyer le devis';

  @override
  String get businessTransportSendingQuote => 'Envoi du devis…';

  @override
  String get businessTransportReviseQuote => 'Réviser le devis';

  @override
  String get businessTransportRevisingQuote => 'Enregistrement de la révision…';

  @override
  String get businessTransportReviseNotice =>
      'Vous avez déjà un devis sur cette demande. Un nouvel envoi le remplace — une entreprise n’a qu’un seul devis par demande.';

  @override
  String get businessTransportCurrentQuote => 'Votre devis actuel';

  @override
  String businessTransportRevisionNumber(Object revision) {
    return 'Révision $revision';
  }

  @override
  String get businessTransportWithdrawQuote => 'Retirer le devis';

  @override
  String get businessTransportWithdrawingQuote => 'Retrait en cours…';

  @override
  String get businessTransportWithdrawTitle => 'Retirer ce devis ?';

  @override
  String get businessTransportWithdrawMessage =>
      'Le client ne pourra plus le choisir. La demande redevient ouverte : vous pourrez chiffrer à nouveau.';

  @override
  String get businessTransportQuoteWithdrawn =>
      'Devis retiré. La demande est de nouveau ouverte aux devis.';

  @override
  String get businessTransportWithdrawFailed =>
      'Le devis n’a pas pu être retiré. Réessayez.';

  @override
  String get businessTransportQuoteSent => 'Devis envoyé au client.';

  @override
  String businessTransportQuoteRevised(Object revision) {
    return 'Devis révisé. Le client voit maintenant la révision $revision.';
  }

  @override
  String get businessTransportQuoteFailed =>
      'Le devis n’a pas pu être envoyé. Réessayez.';

  @override
  String get businessTransportAmountLabel => 'Votre prix de transport (USD)';

  @override
  String get businessTransportAmountHint => 'Par exemple, 1250.00';

  @override
  String get businessTransportAmountHelp =>
      'Le transport seul. Laawol ajoute vos frais d’enlèvement par-dessus.';

  @override
  String get businessTransportPickupLeg => 'Frais d’enlèvement';

  @override
  String get businessTransportPickupPending =>
      'Calculés selon votre plan d’enlèvement au moment de l’envoi du devis.';

  @override
  String get businessTransportPickupNotCharged =>
      'Aucun frais d’enlèvement séparé — incluez la collecte dans votre prix.';

  @override
  String get businessTransportCustomerTotal => 'Le client paie';

  @override
  String get businessTransportCustomerTotalPending =>
      'Votre prix plus les frais d’enlèvement, une fois calculés.';

  @override
  String get businessTransportTermsLabel =>
      'Conditions et prestations incluses (facultatif)';

  @override
  String get businessTransportTermsHint =>
      'Ce qui est inclus, les délais estimés et les conditions.';

  @override
  String get businessTransportQuoteExpired => 'Expiré';

  @override
  String get transportQuoteAmountRequired =>
      'Saisissez votre prix de transport.';

  @override
  String get transportQuoteAmountInvalid =>
      'Saisissez le prix sous forme de nombre, par exemple 1250.00.';

  @override
  String get transportQuoteAmountFractional =>
      'Les prix sont en cents entiers — deux décimales au maximum.';

  @override
  String get transportQuoteAmountNotPositive =>
      'Un devis doit être supérieur à zéro.';

  @override
  String get transportQuoteAmountAboveCap =>
      'Un devis ne peut pas dépasser 1 000 000 USD.';

  @override
  String get transportQuoteCurrencyNotSupported =>
      'Les devis de transport doivent être en dollars américains.';

  @override
  String get transportQuoteMethodNotSupported =>
      'Choisissez un transport ouvert ou fermé.';

  @override
  String get transportQuoteDatesIncomplete =>
      'Indiquez les deux estimations ou aucune.';

  @override
  String get transportQuotePickupNotInFuture =>
      'La date d’enlèvement estimée doit être dans le futur.';

  @override
  String get transportQuoteDeliveryBeforePickup =>
      'La livraison ne peut pas précéder l’enlèvement.';

  @override
  String get transportQuoteTermsTooLong =>
      'Les conditions doivent contenir 1000 caractères ou moins.';

  @override
  String get transportStatusScheduled => 'Planifié';

  @override
  String get transportJobMoveTitle => 'Faire avancer cette mission';

  @override
  String transportJobStatusUnknown(Object status) {
    return 'Cette mission est au statut $status, qui ne vient pas du transport — aucune action de transport ne s’applique ici.';
  }

  @override
  String get transportJobNothingLeft =>
      'Cette mission est terminée. Il n’y a plus rien à faire avancer.';

  @override
  String get transportJobStatusUpdated => 'Transport mis à jour.';

  @override
  String transportJobStatusAlready(Object status) {
    return 'Cette mission était déjà au statut $status.';
  }

  @override
  String get transportJobStatusFailed =>
      'Le statut du transport n’a pas pu être mis à jour. Réessayez.';

  @override
  String get transportJobContainerRequired =>
      'Ajoutez le numéro de conteneur avant de mettre ce transport en transit.';

  @override
  String transportJobTransitionNotAllowed(Object from, Object to) {
    return 'Un transport ne peut pas passer de $from à $to.';
  }

  @override
  String transportJobContainerOnFile(Object number) {
    return 'Conteneur $number';
  }

  @override
  String get transportJobAcceptedQuote => 'Devis accepté';

  @override
  String get requestViewing => 'Demander une visite';

  @override
  String get manageViewing => 'Gérer la visite';

  @override
  String get requestViewingSummary =>
      'Proposez un horaire pour venir voir ce véhicule. Le vendeur le confirme ou propose d\'autres horaires.';

  @override
  String get requestViewingQuestion => 'Envoyer la demande de visite ?';

  @override
  String get requestViewingConfirmMessage =>
      'Le vendeur confirmera cet horaire ou en proposera d\'autres. Rien n\'est facturé.';

  @override
  String get viewingRequestSent =>
      'Demande de visite envoyée. Le vendeur la confirmera ou proposera d\'autres horaires.';

  @override
  String get viewingConversationTitle => 'Votre visite pour ce véhicule';

  @override
  String get viewingStatusRequested => 'Visite demandée';

  @override
  String get viewingStatusCountered => 'Autres horaires proposés';

  @override
  String get viewingStatusDeclined => 'Visite refusée';

  @override
  String get viewingStatusExpired => 'Proposition expirée';

  @override
  String get viewingStatusCancelled => 'Visite annulée';

  @override
  String get viewingYourTurn => 'À vous de répondre';

  @override
  String get viewingWaitingOnBuyer => 'En attente de l\'acheteur';

  @override
  String get viewingWaitingOnSeller => 'En attente du vendeur';

  @override
  String get viewingProposedByYou => 'Vous avez proposé';

  @override
  String get viewingProposedByBuyer => 'L\'acheteur a proposé';

  @override
  String get viewingProposedBySeller => 'Le vendeur a proposé';

  @override
  String get viewingTimesOnTable => 'Horaires proposés';

  @override
  String viewingConfirmedFor(Object time) {
    return 'Confirmé pour $time';
  }

  @override
  String viewingRespondBy(Object time) {
    return 'À répondre avant le $time';
  }

  @override
  String get viewingAcceptTime => 'Accepter cet horaire';

  @override
  String get viewingOfferOtherTimes => 'Proposer d\'autres horaires';

  @override
  String get viewingProposeAnotherTime => 'Proposer un autre horaire';

  @override
  String get viewingDeclineRequest => 'Refuser';

  @override
  String get viewingDeclineQuestion => 'Refuser cette visite ?';

  @override
  String get viewingDeclineConfirmMessage =>
      'L\'acheteur sera informé que vous ne pouvez pas montrer le véhicule à ces horaires.';

  @override
  String get viewingDeclinedMessage => 'Visite refusée.';

  @override
  String viewingConfirmedMessage(Object time) {
    return 'Visite confirmée pour $time.';
  }

  @override
  String get viewingTimesSent => 'Vos horaires ont été envoyés.';

  @override
  String get viewingActionFailed =>
      'Cette action n\'a pas pu aboutir. Réessayez.';

  @override
  String get viewingProposalExpiredNotice =>
      'Personne n\'a répondu à temps : cette proposition a expiré.';

  @override
  String get viewingNoMoreCounters =>
      'Les échanges ont assez duré - acceptez un horaire, refusez ou annulez.';

  @override
  String get viewingClosedNotice =>
      'Cette visite est close. Plus rien n\'y peut être modifié.';

  @override
  String get viewingHistoryTitle => 'Ce qui s\'est passé jusqu\'ici';

  @override
  String viewingHistoryEntryLine(Object who, Object action, Object when) {
    return '$who • $action • $when';
  }

  @override
  String get viewingActorYou => 'Vous';

  @override
  String get viewingActorBuyer => 'L\'acheteur';

  @override
  String get viewingActorSeller => 'Le vendeur';

  @override
  String get viewingHistoryActionProposed => 'proposition';

  @override
  String get viewingHistoryActionAccepted => 'acceptation';

  @override
  String get viewingHistoryActionDeclined => 'refus';

  @override
  String get viewingHistoryActionCancelled => 'annulation';

  @override
  String get viewingProposalSheetTitleCustomer =>
      'Proposer un horaire de visite';

  @override
  String get viewingProposalSheetTitleBusiness =>
      'Proposer des horaires de visite';

  @override
  String get viewingProposalSheetMessageCustomer =>
      'Choisissez l\'horaire qui vous convient. Le vendeur peut l\'accepter ou en proposer d\'autres.';

  @override
  String viewingProposalSheetMessageBusiness(Object count) {
    return 'Proposez jusqu\'à $count horaires. L\'acheteur en choisit un ou en propose un autre.';
  }

  @override
  String get viewingRescheduleNotice =>
      'Proposer un nouvel horaire rouvre la discussion : le rendez-vous convenu n\'est plus confirmé.';

  @override
  String get viewingChooseTime => 'Choisissez un horaire de visite.';

  @override
  String viewingSlotsChosen(Object count, Object max) {
    return '$count horaire(s) sur $max sélectionné(s)';
  }

  @override
  String get viewingSendProposal => 'Envoyer';

  @override
  String get whatIsTheItem => 'Quel est l’article ?';

  @override
  String get somethingElseInCategory => 'Autre chose dans cette catégorie';

  @override
  String get whenDoYouPay => 'Quand payez-vous ?';

  @override
  String get payNowOption => 'Payer maintenant';

  @override
  String get payOnArrivalOption => 'Payer à l\'arrivée';

  @override
  String payOnArrivalExplainer(Object business) {
    return 'Rien n\'est débité aujourd\'hui. Votre carte est enregistrée et vérifiée maintenant, puis débitée automatiquement lorsque $business marque votre colis comme arrivé. Si ce débit échoue, il vous sera demandé de finaliser le paiement dans l\'application.';
  }

  @override
  String get saveCardAndBook => 'Enregistrer la carte et réserver';

  @override
  String get freightCategoryQuestion => 'Que contient le colis ?';

  @override
  String get freightCategoryHelp =>
      'Les entreprises facturent plus cher ce qui coûte plus cher à remplacer.';

  @override
  String get freightCategoryGeneral => 'Marchandises générales';

  @override
  String get freightCategoryGeneralHint =>
      'Articles ménagers, cadeaux, tout ce qui n’est pas listé ci-dessous';

  @override
  String get freightCategoryClothing => 'Vêtements et tissus';

  @override
  String get freightCategoryClothingHint =>
      'Vêtements, chaussures, tissu, literie';

  @override
  String get freightCategoryFood => 'Alimentation';

  @override
  String get freightCategoryFoodHint => 'Aliments secs et emballés uniquement';

  @override
  String get freightCategoryDocuments => 'Documents';

  @override
  String get freightCategoryDocumentsHint => 'Papiers, certificats, imprimés';

  @override
  String get freightCategoryCosmetics => 'Cosmétiques et liquides';

  @override
  String get freightCategoryCosmeticsHint =>
      'Crèmes, parfums, produits capillaires';

  @override
  String get freightCategoryElectronics => 'Électronique';

  @override
  String get freightCategoryElectronicsHint =>
      'Téléphones, ordinateurs portables, tablettes, chargeurs';

  @override
  String get freightCategoryFragile => 'Objets fragiles';

  @override
  String get freightCategoryFragileHint =>
      'Verre, céramique, tout ce qui est cassable';

  @override
  String get freightCoverageNone => 'Aucune couverture';

  @override
  String get freightCoverageCoversLoss => 'Couvre la perte';

  @override
  String get freightCoverageSectionTitle => 'En cas de perte';

  @override
  String freightCoveragePaysForLoss(Object businessName) {
    return '$businessName vous rembourse si ce colis est perdu.';
  }

  @override
  String get freightCoverageNoExtraCharge =>
      'Compris dans le prix, sans frais supplémentaires.';

  @override
  String freightCoverageWhoPays(Object businessName) {
    return 'Laawol enregistre cet accord. C’est $businessName qui rembourse.';
  }

  @override
  String freightCoverageNotOffered(Object businessName) {
    return '$businessName ne couvre pas les colis perdus. En cas de perte, rien n’est remboursé.';
  }

  @override
  String get freightDestinationDeliveryTitle =>
      'Comment le destinataire le reçoit';

  @override
  String get freightDestinationDeliveryCollect =>
      'Le destinataire vient le chercher';

  @override
  String freightDestinationDeliveryCollectHelp(Object businessName) {
    return 'Il récupère le colis chez $businessName à destination.';
  }

  @override
  String freightDestinationDeliveryToAddress(Object amount) {
    return 'Livrer à son adresse · $amount';
  }

  @override
  String get freightSetPriceTitle => 'Prix pour cet article';

  @override
  String freightSetPriceLine(Object amount) {
    return 'Prix fixe de $amount';
  }

  @override
  String freightSetPriceCoversUpTo(String kilograms, String rate) {
    return 'Comprend jusqu\'à $kilograms kg, puis $rate par kg au-delà';
  }

  @override
  String get freightSetPriceCoversAnyWeight =>
      'Comprend cet article quel que soit son poids';

  @override
  String get freightSetPriceFinal => 'C\'est le prix complet pour cet article.';

  @override
  String get freightAgreedPriceFinal =>
      'C\'est le prix que vous avez accepté pour ce colis. Rien n\'est pesé et rien n\'est réglé ensuite : ce que vous payez aujourd\'hui est le prix total.';

  @override
  String get freightSetPriceOverAllowanceNote =>
      'L\'entreprise pèse le colis au dépôt et facture le poids qui dépasse ce que ce prix comprend.';

  @override
  String get freightDestinationDeliveryFeeLabel => 'Livraison à destination';

  @override
  String get freightReceiverAddressLabel => 'Adresse du destinataire';

  @override
  String get freightReceiverAddressHint => 'Quartier, point de repère, ville';

  @override
  String get freightReceiverAddressHelper =>
      'Indiquez le quartier et un point de repère proche, pour que le livreur trouve l’adresse.';

  @override
  String get freightReceiverAddressRequired =>
      'Indiquez l’adresse où le colis doit être livré.';

  @override
  String get freightReceiverAddressTooLong =>
      'Cette adresse est trop longue. Limitez-vous au quartier, à un point de repère et à la ville.';

  @override
  String get outForDelivery => 'En cours de livraison';

  @override
  String get freightNextOutForDelivery =>
      'Votre colis est arrivé et est en route vers l’adresse du destinataire.';

  @override
  String pickupPlanTakingPickups(String services) {
    return 'Collectes assurées : $services.';
  }

  @override
  String get pickupPlanNoPickups =>
      'Aucun service n\'assure de collecte. Les clients vous apportent tout sur place.';

  @override
  String pickupPlanBringToYou(String services) {
    return 'Les clients vous apportent ceux-ci : $services.';
  }

  @override
  String get pickupPlanSharedOffWarning =>
      'Pas de collecte : le plan partagé ci-dessus est désactivé. Activez-le ou donnez à ce service ses propres frais.';

  @override
  String get pickupPlanOwnFeesNote =>
      'Assure les collectes à ces frais, que le plan partagé soit activé ou non.';

  @override
  String get freightDestinationDeliveryToAddressByArea =>
      'Livrer à son adresse';

  @override
  String get freightDeliveryAreaLabel => 'Où doit-il être livré ?';

  @override
  String get freightNoPriceForItemTitle => 'Aucun prix fixé pour cela';

  @override
  String freightNoBusinessPricedItem(String country) {
    return 'Aucune entreprise expédiant vers $country n\'a fixé de prix pour cela. Décrivez-le et chacune pourra vous répondre avec le sien.';
  }

  @override
  String freightBusinessHasNotPricedItem(String business) {
    return '$business n\'a pas fixé de prix pour cet article. Demandez-le et elle vous en donnera un.';
  }

  @override
  String get freightAskForPriceCta => 'Demander un prix';

  @override
  String get freightAskForPriceTitle => 'Demander un prix';

  @override
  String freightAskForPriceIntro(String country) {
    return 'Décrivez ce que vous envoyez vers $country. Chaque entreprise sur cet itinéraire peut répondre avec son propre prix et indiquer si elle couvre le colis en cas de perte.';
  }

  @override
  String get freightAskForPriceNote =>
      'Vous ne vous engagez à rien. Vous choisissez le prix que vous acceptez, ou aucun.';

  @override
  String get freightWhatsInTheBox => 'Qu\'y a-t-il dans le colis ?';

  @override
  String get freightAddAnItem => 'Ajouter un article';

  @override
  String get freightItemNameLabel => 'Nommez l\'article';

  @override
  String get freightOtherGoodsLabel => 'Autres marchandises, au poids (kg)';

  @override
  String get freightOtherGoodsHelper =>
      'Tout ce qui n\'est pas listé ci-dessus, pesé ensemble.';

  @override
  String get freightBoxEstimate => 'Estimation du colis';

  @override
  String get freightAnythingElseLabel =>
      'Autre chose que les entreprises devraient savoir ?';

  @override
  String get freightWhatElseInBox => 'Quoi d\'autre dans le colis ?';

  @override
  String get freightAddAnotherPricedItem =>
      'Ajouter un autre article au prix fixé';

  @override
  String freightPriceEach(String price) {
    return '$price l\'unité';
  }

  @override
  String get trackWithCode => 'Suivre avec un code';

  @override
  String get freightWeighedAtRateHelper =>
      'Facturé au kilo une fois le colis pesé par l\'entreprise.';

  @override
  String get freightContentsTooMany =>
      'Indiquez au plus 10 types d\'articles par colis.';

  @override
  String get freightContentsLabelInvalid =>
      'Nommez chaque article en moins de 60 caractères.';

  @override
  String get freightContentsQuantityInvalid =>
      'Les quantités doivent être entre 1 et 99.';

  @override
  String get freightContentsCategoryInvalid =>
      'Choisissez la catégorie de chaque article dans la liste.';

  @override
  String freightItemWeighedByBusiness(String item) {
    return '$item est pesé par cette entreprise. Incluez-le plutôt dans les kilos pesés.';
  }

  @override
  String freightItemUnpricedByBusiness(String item) {
    return '$item n\'a pas de prix chez cette entreprise. Demandez plutôt un prix.';
  }

  @override
  String get guestQuoteOneAnswer => '1 entreprise a répondu avec un prix.';

  @override
  String guestQuoteManyAnswers(int count) {
    return '$count entreprises ont répondu avec un prix.';
  }

  @override
  String get guestQuoteSeeHint =>
      'Entrez l\'e-mail donné avec cette demande pour voir les prix et en choisir un.';

  @override
  String get guestQuoteNoAnswers =>
      'Pas encore de prix. Les entreprises ont été sollicitées ; les réponses arrivent généralement sous un jour. Entrez l\'e-mail donné pour ouvrir cette demande sur cet appareil.';

  @override
  String get guestQuoteEmailLabel => 'L\'e-mail donné avec la demande';

  @override
  String get guestQuoteSeePrices => 'Voir les prix et choisir';

  @override
  String get guestQuoteOpenRequest => 'Ouvrir ma demande';

  @override
  String get guestQuoteClaimFailed =>
      'Cela n\'a pas fonctionné. Vérifiez l\'e-mail et réessayez.';

  @override
  String get freightQuoteDescriptionLabel => 'Qu\'envoyez-vous ?';

  @override
  String get freightQuoteDescriptionHint =>
      'Deux valises de vêtements et un petit micro-ondes';

  @override
  String get freightQuoteDescriptionRequired => 'Décrivez ce que vous envoyez';

  @override
  String get freightQuoteWeightLabel => 'Poids en kg';

  @override
  String get freightQuoteWeightHelper =>
      'Facultatif. Un poids aide l\'entreprise à répondre plus vite.';

  @override
  String get freightQuoteSendRequest => 'Demander un prix';

  @override
  String get freightQuoteSending => 'Envoi…';

  @override
  String get freightQuoteRequestFailed =>
      'Votre demande n\'a pas pu être envoyée. Réessayez.';

  @override
  String get freightQuotesTitle => 'Prix pour votre colis';

  @override
  String get freightQuotesIntro =>
      'Chaque prix est celui d\'une entreprise. Choisissez celle avec qui vous voulez envoyer.';

  @override
  String freightQuoteRequestReference(String code) {
    return 'Demande $code';
  }

  @override
  String freightQuoteAskedBusinesses(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count entreprises peuvent répondre',
      one: '1 entreprise peut répondre',
    );
    return '$_temp0';
  }

  @override
  String get waitingForFreightQuotes => 'En attente des prix';

  @override
  String get waitingForFreightQuotesSubtitle =>
      'Les entreprises de cet itinéraire voient votre colis. Les prix s\'affichent ici dès qu\'elles répondent.';

  @override
  String freightQuoteCoversLoss(String business) {
    return '$business vous rembourse si ce colis est perdu';
  }

  @override
  String freightQuoteDoesNotCoverLoss(String business) {
    return '$business ne couvre pas les colis perdus';
  }

  @override
  String get selectFreightQuote => 'Choisir ce prix';

  @override
  String get selectingFreightQuote => 'Choix en cours…';

  @override
  String confirmFreightQuoteTitle(String business) {
    return 'Envoyer avec $business ?';
  }

  @override
  String confirmFreightQuoteMessage(String business, String price) {
    return '$business facture $price pour envoyer ce colis.';
  }

  @override
  String get couldNotSelectFreightQuote =>
      'Ce prix n\'a pas pu être choisi. Réessayez.';

  @override
  String get couldNotLoadFreightQuotes =>
      'Les prix ne se chargent pas pour le moment';

  @override
  String get freightQuoteChosenTitle => 'Prix choisi';

  @override
  String freightQuoteChosenMessage(String business, String price) {
    return '$business enverra votre colis pour $price.';
  }

  @override
  String get guestCheckoutTitle => 'Réserver sans compte';

  @override
  String get guestCheckoutIntro =>
      'Ces informations nous servent à vous envoyer votre reçu et votre numéro de suivi, et à vous joindre au sujet de cet envoi.';

  @override
  String get guestCheckoutFullName => 'Nom complet';

  @override
  String get guestCheckoutEmail => 'Adresse e-mail';

  @override
  String get guestCheckoutPhone => 'Numéro de téléphone';

  @override
  String get guestCheckoutNameError => 'Saisissez votre nom complet';

  @override
  String get guestCheckoutEmailError => 'Saisissez une adresse e-mail valide';

  @override
  String get guestCheckoutPhoneError =>
      'Saisissez un numéro de téléphone valide';

  @override
  String get guestCheckoutContinue => 'Continuer en tant qu\'invité';

  @override
  String get guestCheckoutUseAccount => 'Utiliser plutôt un compte Laawol';

  @override
  String get guestCheckoutFailed =>
      'Nous n\'avons pas pu continuer. Vérifiez votre connexion et réessayez.';

  @override
  String get guestCheckoutNote =>
      'Votre numéro de suivi arrive par e-mail. Conservez-le pour suivre cette réservation.';

  @override
  String get guestCheckoutChoiceTitle => 'Comment souhaitez-vous continuer ?';

  @override
  String get freightQuoteRequestSent => 'Demande envoyée';

  @override
  String freightQuoteRequestSentSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count entreprises sur cet itinéraire l\'ont reçue et peuvent répondre avec un prix.',
      one:
          '1 entreprise sur cet itinéraire l\'a reçue et peut répondre avec un prix.',
    );
    return '$_temp0';
  }

  @override
  String get couldNotLoadFreightQuotesSubtitle =>
      'Votre demande a bien été envoyée. Les prix apparaîtront ici dès le retour de la connexion.';

  @override
  String get continueToBooking => 'Continuer vers la réservation';

  @override
  String get freightQuoteChosenNext =>
      'Ajoutez le destinataire, l\'adresse et la façon dont le colis parvient à l\'entreprise. Vous payez à la fin, au prix que vous avez accepté.';

  @override
  String get orderTypePriceRequests => 'Demandes de prix';

  @override
  String get guestTrackingStageAwaitingPayment => 'En attente de paiement';

  @override
  String get openingSecurePayment => 'Ouverture du paiement sécurisé...';

  @override
  String get checkoutResumeFailed =>
      'Cela ne s’est pas ouvert. Réessayez dans un instant.';

  @override
  String get noNotificationsYet => 'Aucune notification pour le moment';

  @override
  String get markAllNotificationsRead => 'Tout marquer comme lu';

  @override
  String get lotTabActivity => 'Activité';

  @override
  String get lotTabExpenses => 'Dépenses';

  @override
  String get lotTabReports => 'Rapports';

  @override
  String get lotPreviousMonth => 'Mois précédent';

  @override
  String get lotNextMonth => 'Mois suivant';

  @override
  String get lotMoreActions => 'Plus';

  @override
  String get lotRevenue => 'Recettes';

  @override
  String get lotExpensesLabel => 'Dépenses';

  @override
  String get lotNet => 'Net';

  @override
  String lotAwaitingPaymentBanner(String amount) {
    return '$amount en attente de paiement';
  }

  @override
  String get lotAwaitingPaymentNote => 'Liens envoyés, pas encore réglés';

  @override
  String get lotSearchHint => 'NIV, client, téléphone';

  @override
  String get lotFilterAll => 'Tout';

  @override
  String get lotFilterOneOff => 'Ponctuel';

  @override
  String get lotRecordActivity => 'Enregistrer une activité';

  @override
  String get lotEditActivity => 'Modifier cette activité';

  @override
  String lotNoActivityForMonth(String month) {
    return 'Rien enregistré en $month.';
  }

  @override
  String get lotNoActivityHint =>
      'Enregistrez le premier travail facturé par le parc.';

  @override
  String get lotNoSearchMatch =>
      'Aucune entrée ne correspond à cette recherche.';

  @override
  String lotEntriesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count entrées',
      one: '1 entrée',
    );
    return '$_temp0';
  }

  @override
  String get lotPaidOnPlatform => 'Payé';

  @override
  String get lotPaidOutsideShort => 'Payé hors site';

  @override
  String get lotAwaitingShort => 'En attente';

  @override
  String get lotCancelledStatus => 'Annulé';

  @override
  String get lotVoidedStatus => 'Annulée';

  @override
  String get lotChasePayment => 'Relancer le paiement';

  @override
  String get lotSendLinkAgain => 'Renvoyer le lien';

  @override
  String get lotRecordAsPaid => 'Marquer comme payé';

  @override
  String get lotLinkResent => 'Le lien a été renvoyé.';

  @override
  String get lotVoid => 'Annuler l’entrée';

  @override
  String get lotVoidTitle => 'Annuler cette entrée';

  @override
  String get lotVoidExplain =>
      'Elle reste au registre, barrée, et sort des totaux. Elle n’est jamais supprimée.';

  @override
  String get lotVoidReason => 'Motif (facultatif)';

  @override
  String get lotVoidDone => 'Entrée annulée.';

  @override
  String get lotHistory => 'Historique des modifications';

  @override
  String get lotNoHistory => 'Aucune modification.';

  @override
  String get lotWhatWasDone => 'Ce qui a été fait';

  @override
  String get lotChooseActivity => 'Choisissez une activité';

  @override
  String get lotOneOffOption => 'Autre chose — ponctuel';

  @override
  String get lotSayWhatWasDone => 'Précisez ce qui a été fait';

  @override
  String get lotFee => 'Montant facturé';

  @override
  String get lotDate => 'Date';

  @override
  String get lotVin => 'NIV';

  @override
  String get lotVinHint => '17 caractères';

  @override
  String get lotCustomer => 'Client';

  @override
  String get lotPhone => 'Téléphone';

  @override
  String get lotEmail => 'E-mail';

  @override
  String get lotMake => 'Marque';

  @override
  String get lotModel => 'Modèle';

  @override
  String get lotYearField => 'Année';

  @override
  String get lotAuctionHouse => 'Maison de vente';

  @override
  String get lotHowItGetsPaid => 'Mode de paiement';

  @override
  String get lotChargeThroughWebsite => 'Encaisser via le site';

  @override
  String get lotChargeThroughWebsiteNote =>
      'Un lien de paiement part au client et l’argent arrive sur votre compte.';

  @override
  String get lotPaidOutsideWebsite => 'Payé en dehors du site';

  @override
  String get lotPaidOutsideWebsiteNote => 'Espèces, Zelle, chèque.';

  @override
  String get lotMarkNotReceived => 'Marquer comme non reçu';

  @override
  String get lotMarkNotReceivedTitle => 'Remettre en non reçu';

  @override
  String get lotMarkNotReceivedExplain =>
      'À utiliser si l’argent n’est pas réellement arrivé. L’activité redevient due, et le changement est enregistré à votre nom dans l’historique.';

  @override
  String get lotMarkNotReceivedNote => 'Note (facultatif)';

  @override
  String get lotMarkNotReceivedDone => 'Remis en non reçu.';

  @override
  String get lotMoneyReceived => 'L’argent a été reçu';

  @override
  String get lotMoneyReceivedNote =>
      'Indiquez le moyen de paiement et qui l’a reçu.';

  @override
  String get lotLoggedAsOwed =>
      'Pas encore payé — enregistré comme dû. Marquez-le reçu quand l’argent arrive.';

  @override
  String get lotLinkGoesByTextAndEmail => 'Le lien part par SMS et par e-mail.';

  @override
  String get lotHowItWasPaid => 'Moyen de paiement';

  @override
  String get lotReceivedBy => 'Reçu par';

  @override
  String get lotActivityRecorded => 'Activité enregistrée.';

  @override
  String get lotActivityUpdated => 'Activité mise à jour.';

  @override
  String get lotSave => 'Enregistrer';

  @override
  String get lotSaving => 'Enregistrement…';

  @override
  String get lotCancelAction => 'Annuler';

  @override
  String get lotDone => 'Terminé';

  @override
  String get lotViaCash => 'Espèces';

  @override
  String get lotViaZelle => 'Zelle';

  @override
  String get lotViaCashApp => 'Cash App';

  @override
  String get lotViaVenmo => 'Venmo';

  @override
  String get lotViaCheck => 'Chèque';

  @override
  String get lotViaCardInPerson => 'Carte sur place';

  @override
  String get lotViaOther => 'Autre';

  @override
  String get lotExpenseLinesTitle => 'Postes de dépense';

  @override
  String get lotAddExpenseLine => 'Ajouter un poste';

  @override
  String get lotAddPurchase => 'Ajouter un achat';

  @override
  String get lotPurchaseAdded => 'Achat ajouté.';

  @override
  String get lotExpenseLineSaved => 'Poste enregistré.';

  @override
  String get lotSameEveryMonth => 'Identique chaque mois';

  @override
  String get lotChangesEveryMonth => 'Variable chaque mois';

  @override
  String lotEveryMonth(String amount) {
    return '$amount chaque mois';
  }

  @override
  String get lotWaitingOnBill => 'En attente de la facture du mois';

  @override
  String lotPurchasesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count achats',
      one: '1 achat',
    );
    return '$_temp0';
  }

  @override
  String get lotNoExpenseLines => 'Aucun poste de dépense.';

  @override
  String get lotNoExpenseLinesHint =>
      'Ajoutez ce que le parc paie : loyer, eau, déplacement.';

  @override
  String lotProofRequiredFrom(String amount) {
    return 'Reçu exigé à partir de $amount.';
  }

  @override
  String get lotAmount => 'Montant';

  @override
  String get lotPaidBy => 'Payé par';

  @override
  String get lotNote => 'Note';

  @override
  String get lotReceipt => 'Reçu';

  @override
  String get lotAttachReceipt => 'Joindre un reçu';

  @override
  String get lotReceiptAttached => 'Reçu joint';

  @override
  String get lotUploadingReceipt => 'Envoi du reçu…';

  @override
  String lotNoPurchasesForMonth(String month) {
    return 'Aucun achat enregistré en $month.';
  }

  @override
  String get lotExpenseName => 'Nom';

  @override
  String get lotExpenseSupplier => 'Fournisseur ou détail';

  @override
  String get lotHowItBehaves => 'Comportement';

  @override
  String get lotMonthlyAmount => 'Montant mensuel';

  @override
  String lotRevenueForYear(String year) {
    return 'Recettes $year';
  }

  @override
  String lotExpensesForYear(String year) {
    return 'Dépenses $year';
  }

  @override
  String get lotNetProfit => 'Bénéfice net';

  @override
  String get lotMargin => 'Marge';

  @override
  String get lotMonthByMonth => 'Mois par mois';

  @override
  String get lotErrActivityType => 'Choisissez ce qui a été fait.';

  @override
  String get lotErrCustomLabel => 'Précisez ce qui a été fait.';

  @override
  String get lotErrFee => 'Saisissez le montant facturé.';

  @override
  String get lotErrCustomerName => 'Saisissez le nom du client.';

  @override
  String get lotErrVin => 'Saisissez le NIV.';

  @override
  String get lotErrLinkContact =>
      'Un lien de paiement exige un numéro de téléphone ou un e-mail.';

  @override
  String get lotErrReceivedBy => 'Indiquez quel employé a reçu le paiement.';

  @override
  String get lotErrExpenseAmount => 'Saisissez le montant dépensé.';

  @override
  String get lotErrExpensePaidBy => 'Indiquez qui a payé.';

  @override
  String lotErrExpenseProof(String amount) {
    return 'Joignez un reçu : cette entreprise l’exige à partir de $amount.';
  }

  @override
  String get lotCouldNotSave => 'Enregistrement impossible. Réessayez.';

  @override
  String get lotWhereTheMoneyGoes => 'Où va l’argent';

  @override
  String get lotOtherExpense => 'Autre';

  @override
  String lotNothingSpentYear(String year) {
    return 'Aucune dépense en $year.';
  }

  @override
  String get lotShareUnderOnePercent => '<1 %';

  @override
  String get lotVinMatchedExisting =>
      'Rempli à partir d’un véhicule déjà enregistré.';

  @override
  String get lotDecodingVin => 'Lecture du NIV…';

  @override
  String get lotLedgerSubtitle => 'Ce que le parc a gagné et dépensé.';

  @override
  String get businessTransportRowSubtitle =>
      'Demandes à chiffrer et missions à livrer.';

  @override
  String get parkingWalkInsOnly => 'Sans réservation';

  @override
  String get parkingWalkInsOnlyNote =>
      'Ce parc accepte seulement les arrivées sans réservation — contactez-le pour organiser le stationnement.';

  @override
  String get parkingAcceptReservations =>
      'Accepter les réservations en ligne des clients';

  @override
  String get parkingAcceptReservationsHelp =>
      'Désactivé, ce parc devient sans réservation : il reste visible dans la recherche pour être trouvé et contacté, mais les clients ne peuvent ni réserver ni payer en ligne — vous enregistrez chaque voiture vous-même.';

  @override
  String get parkingScoreInLot => 'Au parc';

  @override
  String get parkingKindReserved => 'Réservé';

  @override
  String get parkingKindPending => 'Paiement en attente';

  @override
  String get parkingKindCancelled => 'Annulé';

  @override
  String get parkingPayPart => 'Partiel';

  @override
  String get parkingFiltersClear => 'Effacer';

  @override
  String get parkingScoreLeft => 'Partis';

  @override
  String get parkingScoreCollected => 'Encaissé';

  @override
  String get parkingScoreOwed => 'Dû';

  @override
  String get parkingScoreSpaces => 'Places';

  @override
  String get parkingNotPaidYet => 'Ils n\'ont pas encore payé';

  @override
  String get parkingAlreadyPaid => 'Ils ont déjà payé';

  @override
  String get parkingPaidPartOfIt => 'Ils ont payé une partie';

  @override
  String get parkingAlreadyPaidInFull => 'Ils ont déjà tout payé';

  @override
  String get parkingHowMuchDidTheyPay => 'Combien ont-ils payé ?';

  @override
  String get parkingSayWhoReceived =>
      'Indiquez qui a reçu l\'argent pour le rapprochement.';

  @override
  String get parkingEnterDaysPaid => 'Saisissez le nombre de jours payés.';

  @override
  String get parkingEnterAmountPaid => 'Saisissez le montant payé.';

  @override
  String get parkingHowDidTheyPay => 'Comment ont-ils payé ?';

  @override
  String get directPaymentSettledExplainer =>
      'Nous ne prenons aucune commission. La voiture est enregistrée et réglée en une fois - action irréversible ici.';

  @override
  String get directPaymentPartPaidExplainer =>
      'Nous ne prenons aucune commission. La voiture est enregistrée, le paiement partiel est encaissé et le reste demeure dû.';

  @override
  String get parkingRecordedAndPaid => 'Enregistré et marqué comme payé.';

  @override
  String get parkingRecordedAndPartPaid =>
      'Enregistré, et le paiement partiel a été encaissé.';

  @override
  String get parkingRecordedNotSettled =>
      'La voiture a été enregistrée, mais le marquage du paiement a échoué. Marquez le paiement reçu sur la fiche.';

  @override
  String get parkingRecordedNotPartPaid =>
      'La voiture a été enregistrée, mais le paiement partiel a échoué. Enregistrez-le sur la fiche.';

  @override
  String get parkingPriceLabel => 'Tarif';

  @override
  String get parkingState => 'État';

  @override
  String parkingPlacesNearby(int count) {
    return '$count endroits pour se garer';
  }

  @override
  String get parkingRecordPartPayment => 'Enregistrer un paiement partiel';

  @override
  String parkingPaidSoFar(String amount) {
    return 'Payé à ce jour : $amount';
  }

  @override
  String get parkingDays => 'Jours';

  @override
  String get parkingAmount => 'Montant (\$)';

  @override
  String get parkingDaysPaid => 'Jours payés';

  @override
  String get parkingAmountPaid => 'Montant payé (\$)';

  @override
  String get parkingRecordPayment => 'Enregistrer le paiement';

  @override
  String get parkingPartPaymentRecorded => 'Paiement partiel enregistré.';

  @override
  String get parkingEnterDaysOrAmount =>
      'Saisissez les jours ou le montant payé.';

  @override
  String get parkingReceivedBy => 'Reçu par';

  @override
  String get parkingRegisteredBy => 'Enregistré par';
}
