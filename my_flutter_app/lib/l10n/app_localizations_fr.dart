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
  String get copyVin => 'Copier le NIV';

  @override
  String get copyName => 'Copier le nom';

  @override
  String get vinCopied => 'NIV copié dans le presse-papiers';

  @override
  String get nameCopied => 'Nom copié dans le presse-papiers';

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
  String get noOpenRecords =>
      'Rien en cours pour le moment. Les dossiers terminés et plus anciens sont plus bas.';

  @override
  String get activityShowHistory =>
      'Afficher les dossiers terminés et plus anciens';

  @override
  String get activityLoadMoreHistory => 'Charger des dossiers plus anciens';

  @override
  String get activityHistoryEnd => 'Aucun dossier plus ancien.';

  @override
  String get activityHistoryLoadFailed =>
      'Impossible de charger les dossiers plus anciens. Réessayez.';

  @override
  String get marketplaceLoadMoreCars => 'Charger plus de voitures';

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
  String get dropOffLocationsLoading => 'Chargement des points de dépôt…';

  @override
  String get dropOffLocationsLoadFailed =>
      'Les points de dépôt n’ont pas pu être chargés.';

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
  String get adminShipmentsLoadFailed =>
      'Les envois n\'ont pas pu être chargés.';

  @override
  String get adminBusinessesLoadFailed =>
      'Les entreprises n\'ont pas pu être chargées.';

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
  String get guestTrackingShippingTitle => 'Informations d\'expédition';

  @override
  String get guestTrackingShippingHint =>
      'Vous pouvez aussi le suivre avec ces informations sur le site de la compagnie maritime.';

  @override
  String get guestTrackingShippingLine => 'Compagnie maritime';

  @override
  String get guestTrackingContainerNumber => 'Numéro de conteneur';

  @override
  String get guestTrackingBookingNumber => 'Numéro de réservation';

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
  String get guestTrackingServiceContainer => 'Envoi en conteneur';

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
  String get inventorySalesNotifications => 'Ventes de mon magasin';

  @override
  String get parkedCarAlertsNotifications => 'Voitures garées par mon équipe';

  @override
  String get packageAlertsNotifications => 'Colis enregistrés par mon équipe';

  @override
  String get platformActivityNotifications =>
      'Activité de la plateforme (voitures, colis, ventes de toutes les entreprises)';

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
    int barrelCount,
    int destinationCount,
    int businessCount,
  ) {
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
    String _temp2 = intl.Intl.pluralLogic(
      businessCount,
      locale: localeName,
      other: '$businessCount entreprises',
      one: '1 entreprise',
    );
    return '$_temp0 • $_temp1 • $_temp2';
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
  String get navShip => 'Envoyer';

  @override
  String get shipSheetTitle => 'Qu’envoyez-vous ?';

  @override
  String get shipSheetSubtitle =>
      'Choisissez ce qui part, on s’occupe du reste.';

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
  String get homeHeroTitle => 'Envoyer quelque chose au pays';

  @override
  String get homeHeroSubtitle =>
      'Un baril, du fret ou une voiture. Choisissez ce qui part, on s\'occupe du reste.';

  @override
  String get homeHeroCta => 'Commencer un envoi';

  @override
  String get homeHelpTitle => 'Besoin d\'aide ?';

  @override
  String get homeHelpSubtitle => 'Écrivez à l\'équipe Laawol';

  @override
  String get homeSignInSubtitle => 'Suivez vos commandes et vos envois';

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
  String get volumeThisMonth => 'Ce mois-ci';

  @override
  String volumeThisMonthNamed(String month) {
    return 'Ce mois-ci · $month';
  }

  @override
  String volumePiecesReceived(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString colis reçus',
      one: '1 colis reçu',
      zero: '0 colis reçu',
    );
    return '$_temp0';
  }

  @override
  String volumeContainersShipped(int count) {
    final intl.NumberFormat countNumberFormat =
        intl.NumberFormat.decimalPattern(localeName);
    final String countString = countNumberFormat.format(count);

    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$countString conteneurs expédiés',
      one: '1 conteneur expédié',
      zero: '0 conteneur expédié',
    );
    return '$_temp0';
  }

  @override
  String get volumeLoadFailed => 'Impossible de charger le volume du mois.';

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
  String get lotParkingMarkNotPaid => 'Marquer comme non payé';

  @override
  String get lotParkingMarkedNotPaid => 'Remis en attente de paiement.';

  @override
  String get lotParkingMarkNotPaidConfirm =>
      'Remettre cette voiture à non payée ? Tous les paiements enregistrés sont retirés. La modification reste dans son historique.';

  @override
  String get lotParkingHistoryTitle => 'Historique des modifications';

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
  String get lotPurchaseUpdated => 'Achat mis à jour.';

  @override
  String get lotEditPurchase => 'Modifier l\'achat';

  @override
  String get lotSaveChanges => 'Enregistrer';

  @override
  String get lotEditingPurchase => 'Modification d\'un achat';

  @override
  String get lotCancelEdit => 'Annuler';

  @override
  String get lotEditExpenseLine => 'Modifier la ligne de dépense';

  @override
  String get lotEditLine => 'Modifier la ligne';

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
  String lotParkingIncomeForYear(String year) {
    return 'Revenus du stationnement $year';
  }

  @override
  String lotParkingCollectedInYear(String year) {
    return 'Encaissé en $year';
  }

  @override
  String get lotLegendParkedCars => 'Voitures stationnées';

  @override
  String get lotMargin => 'Marge';

  @override
  String get lotParkingIncome => 'Revenus du stationnement';

  @override
  String get lotParkingIncomeNote => 'Payé, à venir et en retard. État actuel.';

  @override
  String get lotParkingInLot => 'Au parc';

  @override
  String get lotParkingGenerated => 'Généré à ce jour';

  @override
  String get lotParkingCollected => 'Encaissé';

  @override
  String get lotParkingCollectedNote => 'Déjà payé';

  @override
  String get lotParkingOwed => 'Restant dû';

  @override
  String get lotParkingOwedNote => 'Argent à venir';

  @override
  String get lotParkingOverdue => 'En retard';

  @override
  String lotParkingOverdueCars(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count voitures après la date de fin, non réglées',
      one: '1 voiture après la date de fin, non réglée',
    );
    return '$_temp0';
  }

  @override
  String get lotActivityGenerated => 'Généré à ce jour';

  @override
  String get lotActivityCollected => 'Encaissé';

  @override
  String get lotActivityAwaiting => 'En attente';

  @override
  String get lotActivityJobs => 'Tâches';

  @override
  String get lotActivityOwed => 'Dû';

  @override
  String get lotRangeThisMonth => 'Ce mois-ci';

  @override
  String get lotRangeLast3Months => '3 derniers mois';

  @override
  String get lotRangeCustom => 'Personnalisé';

  @override
  String get lotRangeFrom => 'Mois de début';

  @override
  String get lotRangeTo => 'Mois de fin';

  @override
  String get lotPayAll => 'Tout';

  @override
  String get lotPayOwed => 'Dû';

  @override
  String get lotPayCollected => 'Encaissé';

  @override
  String get lotRevenueSources => 'D\'où viennent les revenus';

  @override
  String get lotRevenueSourcesNote =>
      'Activités de cette année, plus le stationnement généré à ce jour.';

  @override
  String get lotRevenueCarParking => 'Stationnement';

  @override
  String get lotRevenueOneOff => 'Tâches ponctuelles';

  @override
  String get lotRevenueTotal => 'Revenu total';

  @override
  String lotNoRevenueYear(String year) {
    return 'Aucun revenu enregistré en $year pour l\'instant.';
  }

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

  @override
  String get parkingLeaves => 'Départ';

  @override
  String get parkingBilledThrough => 'Facturé jusqu\'au';

  @override
  String get parkingNothingBilledYet => 'Rien pour l\'instant';

  @override
  String get parkingUnbilled => 'Non facturé';

  @override
  String parkingUnbilledDays(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count jours',
      one: '1 jour',
    );
    return '$_temp0';
  }

  @override
  String get parkingAccrualPricedNote =>
      'Le prix a été fixé pour la date de départ à l\'enregistrement : rien ne s\'accumule jour après jour.';

  @override
  String parkingAccrualSinceNote(String date) {
    return 'S\'accumule depuis le $date. Facturez quand vous voulez — la voiture reste en place.';
  }

  @override
  String get parkingAccrualFirstBillNote =>
      'Rien n\'a encore été facturé. Facturez jusqu\'à aujourd\'hui pour envoyer le premier lien.';

  @override
  String get parkingAccrualCaughtUpNote =>
      'Tout est facturé jusqu\'à aujourd\'hui.';

  @override
  String parkingBillThroughToday(String amount) {
    return 'Facturer $amount jusqu\'à aujourd\'hui';
  }

  @override
  String get parkingNothingToBill => 'Rien à facturer';

  @override
  String get parkingBillLinkSent => 'Lien de paiement envoyé.';

  @override
  String get parkingBillCouldNotBeSent =>
      'Le lien de paiement n\'a pas pu être envoyé.';

  @override
  String get parkingPaymentReceivedInPerson => 'Paiement reçu en personne';

  @override
  String get parkingRecordedAsReceived => 'Enregistré comme reçu.';

  @override
  String get parkingCarLeftToday => 'La voiture est partie aujourd\'hui';

  @override
  String get parkingCarLeftTodayExplain =>
      'La date du jour devient la date de départ et l\'accumulation s\'arrête. Ce qui est dû reste dû.';

  @override
  String get parkingStayClosed => 'Séjour clôturé.';

  @override
  String get parkingStayCouldNotBeClosed =>
      'Le séjour n\'a pas pu être clôturé.';

  @override
  String parkingMarkFullyPaid(String amount) {
    return 'Marquer comme entièrement payé ($amount)';
  }

  @override
  String get parkingMarkedFullyPaid => 'Marqué comme payé.';

  @override
  String get parkingNothingOutstanding => 'Rien n\'est dû sur cette voiture.';

  @override
  String parkingPaidSoFarOfTotal(String paid, String total, String owed) {
    return 'Payé à ce jour : $paid sur $total — $owed restant dû';
  }

  @override
  String get lotActivityTypesTitle => 'Prestations et tarifs';

  @override
  String get lotActivityTypesSubtitle =>
      'Ce que le parc facture, et le prix que le personnel voit à l\'enregistrement.';

  @override
  String get lotActivityTypeName => 'Nom';

  @override
  String get lotActivityTypeFee => 'Tarif par défaut (\$)';

  @override
  String get lotActivityTypeNeedsAuctionHouse => 'Demande la maison de vente';

  @override
  String get lotActivityTypeShown => 'Proposé à l\'enregistrement';

  @override
  String get lotActivityTypeAdd => 'Ajouter une prestation';

  @override
  String get lotActivityTypeSaved => 'Prestation enregistrée.';

  @override
  String get lotActivityTypeRemoved => 'Supprimée.';

  @override
  String get lotActivityTypeRemove => 'Supprimer';

  @override
  String get lotActivityTypeRemoveTitle => 'Supprimer cette prestation';

  @override
  String get lotActivityTypeRemoveExplain =>
      'Elle disparaît de la liste proposée. Les entrées déjà enregistrées gardent le nom sous lequel elles ont été saisies.';

  @override
  String get lotActivityTypeNameRequired => 'Donnez un nom à la prestation.';

  @override
  String get lotActivityTypesEmpty =>
      'Aucune prestation pour l\'instant. Ajoutez la première pour que le personnel ait quelque chose à enregistrer.';

  @override
  String get lotActivityTypeCouldNotBeSaved =>
      'La prestation n\'a pas pu être enregistrée.';

  @override
  String get lotProofThresholdTitle => 'Exiger un reçu à partir de';

  @override
  String get lotProofThresholdHint =>
      'Le personnel doit joindre un reçu à partir de ce montant. Zéro n\'en demande jamais.';

  @override
  String get lotProofNeverRequired => 'Aucun reçu n\'est exigé.';

  @override
  String get lotProofThresholdSaved => 'Règle de reçu enregistrée.';

  @override
  String get lotProofThresholdCouldNotBeSaved =>
      'La règle de reçu n\'a pas pu être enregistrée.';

  @override
  String get parkingRateCardsTitle => 'Autres tarifs (facultatif)';

  @override
  String get parkingRateCardsHint =>
      'Une place plus grande, un tarif longue durée, un prix pour le concessionnaire qui amène plusieurs voitures. Donnez un nom et un prix par jour à chacun ; le personnel le choisit à l\'enregistrement. Une ligne sans nom ni prix n\'est pas enregistrée.';

  @override
  String get parkingRateCardName => 'Nom du tarif';

  @override
  String get parkingRateCardNameHint => 'ex. SUV / grand gabarit';

  @override
  String get parkingRateCardDaily => 'Prix / jour (\$)';

  @override
  String get parkingRateCardMinDays => 'Jours min.';

  @override
  String get parkingRateCardAdd => 'Ajouter un tarif';

  @override
  String get parkingRateCardRemove => 'Supprimer ce tarif';

  @override
  String get lotLedgerSettings => 'Réglages du registre';

  @override
  String get lotActivityTypeHidden => 'Masquée';

  @override
  String get parkingViewList => 'Liste';

  @override
  String get parkingViewCards => 'Cartes';

  @override
  String parkingDaysAtRate(int count, String rate) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count jours',
      one: '1 jour',
    );
    return '$_temp0 · $rate/jour';
  }

  @override
  String get lotRecordedBy => 'Enregistré par';

  @override
  String get lotPartPaid => 'Partiellement payé';

  @override
  String lotPaidOfTotal(String paid, String total) {
    return '$paid sur $total';
  }

  @override
  String lotStillOwed(String amount) {
    return '$amount restant dû';
  }

  @override
  String get lotBalance => 'Solde';

  @override
  String get lotPaidSoFar => 'Payé à ce jour';

  @override
  String get lotNoVehicle => 'Sans véhicule';

  @override
  String get lotNoVehicleNote =>
      'Cette activité est enregistrée sans véhicule.';

  @override
  String get lotActivityTypeNeedsVehicle => 'Concerne un véhicule';

  @override
  String get lotActivityTypeNeedsVehicleNote =>
      'Désactivez pour un travail sans véhicule, comme le prêt d\'un compte de vente aux enchères. Le NIV n\'est alors pas demandé.';

  @override
  String get lotRecordPayment => 'Enregistrer un paiement';

  @override
  String get lotRecordPaymentNote =>
      'Argent reçu en personne. Il est déduit du solde immédiatement, et le lien du client demande le reste.';

  @override
  String get lotPaymentAmount => 'Montant reçu (\$)';

  @override
  String lotPaymentMaxNote(String amount) {
    return '$amount au maximum — le montant restant dû sur cette entrée.';
  }

  @override
  String get lotPaymentNote => 'Note (facultatif)';

  @override
  String lotPaymentRecorded(String amount) {
    return '$amount enregistré.';
  }

  @override
  String lotPaymentSettled(String amount) {
    return '$amount enregistré — soldé intégralement.';
  }

  @override
  String get lotPayments => 'Paiements';

  @override
  String get lotPaymentsNote =>
      'Chaque paiement reçu sur cette entrée, quel qu\'en soit le moyen.';

  @override
  String get lotNoPaymentsYet =>
      'Aucun paiement individuel enregistré sur cette entrée.';

  @override
  String get lotPaymentsCouldNotBeLoaded =>
      'Les paiements n\'ont pas pu être chargés.';

  @override
  String get lotPaymentInPerson => 'En personne';

  @override
  String get lotPaymentOnline => 'En ligne';

  @override
  String lotPaymentOverpaid(String amount) {
    return '$amount au-delà du solde';
  }

  @override
  String get lotErrActivityVoided =>
      'Cette entrée a été annulée — enregistrez-en une nouvelle.';

  @override
  String get lotErrActivityCancelled =>
      'Cette entrée a été annulée ; aucun montant ne peut y être encaissé.';

  @override
  String get lotErrNothingToPay => 'Cette entrée n\'a aucun montant à payer.';

  @override
  String get lotErrAlreadyPaid => 'Cette entrée est déjà intégralement payée.';

  @override
  String get lotErrNoAmount => 'Saisissez le montant reçu.';

  @override
  String lotErrBelowCardMinimum(String amount) {
    return 'Un paiement par carte commence à $amount.';
  }

  @override
  String lotErrBelowAmountPaid(String amount) {
    return '$amount a déjà été encaissé sur cette entrée. Le montant facturé ne peut pas descendre en dessous.';
  }

  @override
  String get ctrTitle => 'Conteneurs';

  @override
  String get ctrSubtitle =>
      'Ce qui est entré dans chaque conteneur, enregistré depuis le parc.';

  @override
  String get ctrStatusLoading => 'En chargement';

  @override
  String get ctrStatusShipped => 'Expédié';

  @override
  String get ctrStatusArrived => 'Prêt à récupérer';

  @override
  String get ctrNewContainer => 'Nouveau conteneur';

  @override
  String get ctrEditContainer => 'Modifier le conteneur';

  @override
  String get ctrCreate => 'Créer';

  @override
  String get ctrCreating => 'Création…';

  @override
  String get ctrLabel => 'Nom de travail';

  @override
  String get ctrLabelHint => 'ex. Départ 3 oct., boîte 2';

  @override
  String get ctrLabelOptionalNote =>
      'Facultatif dès qu\'il y a un numéro de conteneur ou de réservation.';

  @override
  String get ctrNumber => 'Numéro de conteneur';

  @override
  String get ctrNumberHint =>
      'Quatre lettres et sept chiffres, dès que la compagnie l\'envoie';

  @override
  String get ctrBookingReference => 'Référence booking / connaissement';

  @override
  String get ctrDestination => 'Destination';

  @override
  String get ctrChooseDestination => 'Choisir un pays';

  @override
  String get ctrSearchCountries => 'Rechercher un pays';

  @override
  String get ctrYourDestinations => 'Vos destinations';

  @override
  String get ctrEveryOtherCountry => 'Tous les autres pays';

  @override
  String get ctrEveryCountry => 'Tous les pays';

  @override
  String get ctrDestinationUnset => 'Pas encore de destination';

  @override
  String get ctrShippingLine => 'Compagnie maritime';

  @override
  String get ctrShippingLineGuess =>
      'Pas sûr — la deviner à partir du numéro de conteneur';

  @override
  String get ctrSearchShippingLines => 'Rechercher une compagnie maritime';

  @override
  String get ctrShippingLineNeeded =>
      'Le suivi n\'a pas trouvé la compagnie maritime — choisissez-la pour lancer le suivi.';

  @override
  String get ctrNotes => 'Notes';

  @override
  String get ctrLockedNote =>
      'Expédié. La liste est le relevé de ce qui est parti ; seules les notes et la compagnie maritime restent modifiables.';

  @override
  String get ctrNoContainers => 'Aucun conteneur pour le moment.';

  @override
  String get ctrNoContainersHint =>
      'Créez-en un quand vous commencez à charger une boîte.';

  @override
  String get ctrNoLoading => 'Aucun conteneur en chargement.';

  @override
  String get ctrNoShipped => 'Aucun conteneur expédié.';

  @override
  String get ctrNoArrived => 'Aucun conteneur prêt à récupérer pour le moment.';

  @override
  String get ctrEmptyContainer => 'Rien de chargé pour l\'instant';

  @override
  String get ctrEmptyContainerHint =>
      'Ajoutez la première voiture, les barils ou tout autre chose entré dedans.';

  @override
  String ctrCarsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count voitures',
      one: '1 voiture',
    );
    return '$_temp0';
  }

  @override
  String ctrBarrelsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count barils',
      one: '1 baril',
    );
    return '$_temp0';
  }

  @override
  String ctrOtherCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count autres articles',
      one: '1 autre article',
    );
    return '$_temp0';
  }

  @override
  String ctrSailed(String date) {
    return 'Parti le $date';
  }

  @override
  String ctrArrivedOn(String date) {
    return 'Prêt à récupérer le $date';
  }

  @override
  String get ctrLoaded => 'Chargé';

  @override
  String get ctrAddLine => 'Ajouter au conteneur';

  @override
  String get ctrAdd => 'Ajouter';

  @override
  String get ctrAdding => 'Ajout…';

  @override
  String get ctrKind => 'Qu\'est-ce que c\'est ?';

  @override
  String get ctrKindCar => 'Une voiture';

  @override
  String get ctrKindBarrels => 'Des barils';

  @override
  String get ctrKindOther => 'Autre chose';

  @override
  String get ctrQuantity => 'Combien';

  @override
  String get ctrDescription => 'De quoi il s\'agit';

  @override
  String get ctrOwner => 'À qui est-ce ?';

  @override
  String get ctrOwnerCustomer => 'À un client';

  @override
  String get ctrOwnerCustomerNote =>
      'Nommez le client, pour que la liste dise à qui c\'est.';

  @override
  String get ctrOwnerStock => 'Stock de l\'entreprise';

  @override
  String get ctrOwnerStockNote =>
      'Acheté pour être vendu à l\'étranger. Aucun client à nommer.';

  @override
  String get ctrReceiver => 'Destinataire à l\'arrivée';

  @override
  String get ctrReceiverHint => 'Le nom écrit dessus';

  @override
  String get ctrReceiverPhone => 'Téléphone du destinataire';

  @override
  String get ctrSplitHint =>
      'Des barils de plusieurs clients d\'un coup ? Enregistrez la part de chaque client, puis ajoutez le suivant.';

  @override
  String get ctrSaveAndAnother => 'Enregistrer et ajouter un autre';

  @override
  String get ctrAddAndClose => 'Ajouter et fermer';

  @override
  String ctrAddedSoFar(String list) {
    return 'Ajouté jusqu\'ici : $list';
  }

  @override
  String get ctrStock => 'Stock';

  @override
  String ctrTimes(int count) {
    return '× $count';
  }

  @override
  String get ctrRemoveLine => 'Retirer du conteneur';

  @override
  String get ctrRemoveLineTitle => 'Retirer cette ligne ?';

  @override
  String get ctrRemoveLineMessage =>
      'Elle sort de la liste de chargement. Vous pourrez l\'ajouter à nouveau.';

  @override
  String get ctrRemove => 'Retirer';

  @override
  String get ctrMoveLine => 'Déplacer vers un autre conteneur';

  @override
  String get ctrMoveTo => 'Déplacer vers';

  @override
  String get ctrNoOtherLoading =>
      'Aucun autre conteneur n\'est en chargement en ce moment.';

  @override
  String get ctrMoved => 'Déplacé.';

  @override
  String get ctrShip => 'Marquer expédié';

  @override
  String get ctrShipTitle => 'Marquer ce conteneur comme expédié ?';

  @override
  String get ctrShipMessage =>
      'La liste devient le relevé de ce qui est parti. Seules les notes resteront modifiables.';

  @override
  String get ctrShippedDone => 'Marqué expédié.';

  @override
  String get ctrArrive => 'Marquer prêt à récupérer';

  @override
  String get ctrArriveTitle => 'Marquer ce conteneur prêt à récupérer ?';

  @override
  String get ctrArriveMessage =>
      'Les clients sont prévenus sur WhatsApp de l\'endroit où récupérer leurs marchandises. Ses voitures pourront aller dans un nouveau conteneur.';

  @override
  String get ctrArrivedDone => 'Marqué prêt à récupérer.';

  @override
  String get ctrDelete => 'Supprimer le conteneur';

  @override
  String get ctrDeleteTitle => 'Supprimer ce conteneur ?';

  @override
  String get ctrDeleteMessage =>
      'Seul un conteneur vide encore en chargement peut être supprimé.';

  @override
  String get ctrDeleted => 'Supprimé.';

  @override
  String get ctrOpenDocument => 'Liste de chargement';

  @override
  String get ctrSearchHint => 'NIV, client ou téléphone';

  @override
  String get ctrNoSearchMatch => 'Aucun résultat.';

  @override
  String ctrHitsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count résultats',
      one: '1 résultat',
    );
    return '$_temp0';
  }

  @override
  String ctrLinkShipped(String container, String date) {
    return 'Dans $container · parti le $date';
  }

  @override
  String ctrLinkShippedNoDate(String container) {
    return 'Dans $container';
  }

  @override
  String ctrLinkLoading(String name) {
    return 'En chargement dans $name';
  }

  @override
  String get ctrCreated => 'Conteneur créé.';

  @override
  String get ctrUpdated => 'Enregistré.';

  @override
  String get ctrLineAdded => 'Ajouté.';

  @override
  String get ctrLineRemoved => 'Retiré.';

  @override
  String get ctrCouldNotLoad => 'Les conteneurs n\'ont pas pu être chargés.';

  @override
  String get ctrLoadOlderContainers => 'Charger des conteneurs plus anciens';

  @override
  String get ctrErrLabelRequired =>
      'Donnez au conteneur un nom de travail, ou son numéro de conteneur ou de réservation.';

  @override
  String get ctrErrNumberInvalid =>
      'Un numéro de conteneur, c\'est quatre lettres et sept chiffres, comme MSKU1234567. Les numéros de booking et les connaissements vont dans le champ référence.';

  @override
  String get ctrErrCarrierInvalid =>
      'Choisissez la compagnie maritime dans la liste.';

  @override
  String get ctrErrStatusInvalid =>
      'Ce n\'est pas un état possible pour un conteneur.';

  @override
  String get ctrErrTransitionInvalid =>
      'Un conteneur ne fait qu\'avancer : chargement, puis expédié, puis prêt à récupérer.';

  @override
  String get ctrErrDestinationRequired =>
      'Choisissez où va ce conteneur avant de l\'expédier.';

  @override
  String get ctrErrEmpty =>
      'Rien n\'est encore dans ce conteneur, il ne peut pas partir.';

  @override
  String get ctrErrLocked =>
      'Ce conteneur est expédié. Sa liste est le relevé de ce qui est parti ; ajoutez une note plutôt que de la modifier.';

  @override
  String get ctrErrHasLines =>
      'Ce conteneur contient des lignes. Retirez-les d\'abord, ou laissez-le.';

  @override
  String get ctrErrNotFound => 'Conteneur introuvable.';

  @override
  String get ctrErrLineNotFound => 'Cette ligne n\'est plus sur le conteneur.';

  @override
  String get ctrErrLineKind =>
      'Dites ce qu\'est cette ligne : une voiture, des barils ou autre chose.';

  @override
  String get ctrErrQuantity => 'Indiquez combien.';

  @override
  String get ctrErrDescription => 'Dites de quoi il s\'agit.';

  @override
  String get ctrErrOwnerKind =>
      'Dites à qui c\'est : un client, ou votre propre stock.';

  @override
  String get ctrErrVinAlreadyLoaded =>
      'Cette voiture est déjà dans un autre conteneur qui n\'est pas arrivé.';

  @override
  String ctrErrVinAlreadyLoadedIn(String container) {
    return 'Cette voiture est déjà dans $container, qui n\'est pas arrivé.';
  }

  @override
  String get ctrErrMoveTarget =>
      'Une ligne ne peut être déplacée que vers un conteneur encore en chargement.';

  @override
  String get ctrErrCustomerPhoneInvalid =>
      'Le téléphone du client ne ressemble pas à un numéro de téléphone.';

  @override
  String get ctrErrReceiverPhoneInvalid =>
      'Le téléphone du destinataire ne ressemble pas à un numéro de téléphone.';

  @override
  String get ctrNotifyToggle =>
      'Envoyer à cette personne les mises à jour WhatsApp de cet envoi';

  @override
  String get ctrErrReceiverName => 'Saisissez le nom du destinataire.';

  @override
  String get ctrSenderIsReceiver => 'L’expéditeur est le destinataire';

  @override
  String get ctrNotifyNeedsPhone =>
      'Ajoutez un numéro de téléphone pour activer cette option.';

  @override
  String get ctrPhoneNeedsCountryCode =>
      'Ajoutez l\'indicatif pays pour que les mises à jour WhatsApp puissent joindre ce numéro.';

  @override
  String ctrLineTrackingCode(String code) {
    return 'Code de suivi $code';
  }

  @override
  String ctrUpdatesTo(String names) {
    return 'Mises à jour WhatsApp pour $names';
  }

  @override
  String get ctrUpdatesOff => 'Aucune mise à jour WhatsApp';

  @override
  String get ctrCustomerPhoneNoCountryCode =>
      'Le téléphone du client n\'a pas d\'indicatif pays : les mises à jour WhatsApp ne peuvent pas le joindre.';

  @override
  String get ctrReceiverPhoneNoCountryCode =>
      'Le téléphone du destinataire n\'a pas d\'indicatif pays : les mises à jour WhatsApp ne peuvent pas le joindre.';

  @override
  String get ctrReceiverShort => 'Destinataire';

  @override
  String get ctrEditContacts => 'Modifier les contacts';

  @override
  String get ctrEditContactsNote =>
      'Les noms et les numéros peuvent être corrigés à tout moment, même après le départ du conteneur.';

  @override
  String get ctrContactsSaved => 'Contacts mis à jour';

  @override
  String get ctrEditLine => 'Modifier la ligne';

  @override
  String get ctrLineUpdated => 'Ligne mise à jour.';

  @override
  String get ctrEditLineNote =>
      'Le contenu et le propriétaire peuvent changer jusqu\'au départ du conteneur. Ensuite, seuls les contacts.';

  @override
  String get ctrLotQuestion => 'Cette voiture est-elle garée dans votre parc ?';

  @override
  String get ctrLotYes => 'Oui';

  @override
  String get ctrLotYesNote => 'Choisissez-la parmi les voitures du parc.';

  @override
  String get ctrLotNo => 'Non';

  @override
  String get ctrLotNoNote => 'Saisissez ou scannez le VIN.';

  @override
  String get ctrLotChange => 'Modifier';

  @override
  String get ctrLotPickTitle => 'Quelle voiture ?';

  @override
  String get ctrLotFilterHint => 'VIN, propriétaire ou marque';

  @override
  String get ctrLotNoCars => 'Aucune voiture n\'est garée pour le moment.';

  @override
  String get ctrLotNoMatch => 'Aucune voiture garée ne correspond.';

  @override
  String get ctrLotEnterVinInstead => 'Saisir le VIN à la place';

  @override
  String get ctrLotCarUnknown => 'Voiture';

  @override
  String ctrLotTaken(String container) {
    return 'Déjà dans $container';
  }

  @override
  String get ctrLotPicked => 'Rempli à partir de la voiture de votre parc.';

  @override
  String get ctrLotPickAnother => 'Choisir une autre voiture';

  @override
  String get invMenuTitle => 'Factures et reçus';

  @override
  String get invMenuSubtitle =>
      'Ce que vous avez vendu et ce qui est dû, en PDF à envoyer.';

  @override
  String get invPermissionLabel => 'Factures';

  @override
  String get invTitle => 'Factures et reçus';

  @override
  String get invNew => 'Nouvelle facture';

  @override
  String get invSearchHint => 'Numéro, titre, client ou téléphone';

  @override
  String get invFilterOpen => 'Ouvertes';

  @override
  String get invFilterOverdue => 'En retard';

  @override
  String get invFilterPaid => 'Payées';

  @override
  String get invFilterAll => 'Toutes';

  @override
  String get invStatOpen => 'Ouvertes';

  @override
  String get invStatOwed => 'Ce qu\'on vous doit';

  @override
  String get invStatCollected => 'Encaissé';

  @override
  String get invEmptyTitle => 'Aucune facture pour l\'instant';

  @override
  String get invEmptyHint => 'Ouvrez-en une à votre prochaine vente.';

  @override
  String get invNoMatch => 'Aucune facture ne correspond.';

  @override
  String get invStatusOpen => 'Ouverte';

  @override
  String get invStatusOverdue => 'En retard';

  @override
  String get invStatusPaid => 'Payée';

  @override
  String get invKindInvoice => 'Facture';

  @override
  String get invKindReceipt => 'Reçu';

  @override
  String invFor(String name) {
    return 'Pour $name';
  }

  @override
  String invDue(String day) {
    return 'Échéance $day';
  }

  @override
  String invPaidOn(String day) {
    return 'Payée le $day';
  }

  @override
  String get invNoDueDate => 'Pas d\'échéance';

  @override
  String get invTotal => 'Total';

  @override
  String get invPaid => 'Payé';

  @override
  String get invBalanceDue => 'Solde dû';

  @override
  String get invLines => 'Lignes';

  @override
  String get invPayments => 'Paiements';

  @override
  String get invNoLines =>
      'Rien sur cette facture pour l\'instant. Ajoutez la première ligne.';

  @override
  String get invNoPayments => 'Aucun paiement enregistré pour l\'instant.';

  @override
  String get invAddLine => 'Ajouter une ligne';

  @override
  String get invEditLine => 'Modifier la ligne';

  @override
  String get invRemoveLine => 'Retirer la ligne';

  @override
  String get invRemoveLineMessage =>
      'Elle sort de la facture et le solde baisse. L\'historique la garde.';

  @override
  String get invRecordPayment => 'Enregistrer un paiement';

  @override
  String get invRevertPayment => 'Annuler le paiement';

  @override
  String get invRevertMessage =>
      'Le solde remonte. Le paiement reste dans l\'historique, barré.';

  @override
  String get invReverted => 'Annulé';

  @override
  String get invSavePdf => 'Voir le PDF';

  @override
  String get invShareText => 'Envoyer en texte';

  @override
  String get invHistory => 'Historique';

  @override
  String get invEdit => 'Modifier';

  @override
  String get invDelete => 'Supprimer la facture';

  @override
  String get invDeleteMessage => 'Son numéro ne sera pas réutilisé.';

  @override
  String get invFormTitle => 'Titre';

  @override
  String get invFormTitleHint => 'ex. Corolla 2014, ou Barils pour Conakry';

  @override
  String get invFormEmail => 'E-mail';

  @override
  String get invFormIssuedOn => 'Date de la facture';

  @override
  String get invFormDueOn => 'Date d\'échéance';

  @override
  String get invFormDueHint => 'Laissez vide s\'il n\'y a pas d\'échéance';

  @override
  String get invFormNotes => 'Notes sur le document';

  @override
  String get invOpen => 'Ouvrir la facture';

  @override
  String get invOpening => 'Ouverture…';

  @override
  String get invSave => 'Enregistrer';

  @override
  String get invSaving => 'Enregistrement…';

  @override
  String get invLineWhat => 'Ce que c\'est';

  @override
  String get invLineWhatHint => 'ex. Toyota Corolla 2014, ou Barils';

  @override
  String get invLineQty => 'Combien';

  @override
  String get invLineUnit => 'Prix unitaire (\$)';

  @override
  String get invLineVin => 'VIN (voitures uniquement)';

  @override
  String invLineEach(int qty, String each) {
    return '$qty × $each';
  }

  @override
  String get invSaveAndAnother => 'Enregistrer et ajouter une autre';

  @override
  String get invAddAndClose => 'Ajouter et fermer';

  @override
  String get invPayAmount => 'Montant reçu (\$)';

  @override
  String get invPayMethod => 'Comment il est arrivé';

  @override
  String get invPayDate => 'Date';

  @override
  String get invPayNote => 'Note (facultatif)';

  @override
  String get invPayWhole => 'Régler tout le solde';

  @override
  String invPayStillOwed(String amount) {
    return '$amount encore dû';
  }

  @override
  String get invOpened => 'Facture ouverte. Ajoutez la première ligne.';

  @override
  String get invUpdated => 'Enregistré.';

  @override
  String get invDeleted => 'Facture supprimée.';

  @override
  String get invLineAdded => 'Ligne ajoutée.';

  @override
  String get invLineUpdated => 'Ligne mise à jour.';

  @override
  String get invLineRemoved => 'Ligne retirée.';

  @override
  String get invPaymentRecorded => 'Paiement enregistré.';

  @override
  String get invPaidInFull => 'Payée en totalité — c\'est maintenant un reçu.';

  @override
  String get invPaymentReverted => 'Paiement annulé.';

  @override
  String get invNotFound => 'Cette facture n\'existe plus.';

  @override
  String get invMethodCash => 'Espèces';

  @override
  String get invMethodZelle => 'Zelle';

  @override
  String get invMethodCashapp => 'Cash App';

  @override
  String get invMethodVenmo => 'Venmo';

  @override
  String get invMethodCheck => 'Chèque';

  @override
  String get invMethodCardInPerson => 'Carte en personne';

  @override
  String get invMethodOther => 'Autre';

  @override
  String get invErrTitle =>
      'Donnez un titre court à la facture (à quoi elle sert).';

  @override
  String get invErrCustomer => 'Dites pour qui est la facture.';

  @override
  String get invErrIssuedOn =>
      'La date de la facture n\'est pas une vraie date.';

  @override
  String get invErrDueOn => 'La date d\'échéance n\'est pas une vraie date.';

  @override
  String get invErrDueOrder =>
      'La date d\'échéance précède la date de la facture.';

  @override
  String get invErrDescription => 'Dites ce qu\'est la ligne.';

  @override
  String get invErrQuantity => 'Indiquez combien (au moins un).';

  @override
  String get invErrUnitPrice => 'Indiquez le prix unitaire.';

  @override
  String get invErrTooLarge =>
      'Ce montant dépasse ce qu\'une facture peut porter.';

  @override
  String get invErrVin => 'Un VIN compte 17 lettres et chiffres.';

  @override
  String get invErrAmount => 'Indiquez le montant reçu.';

  @override
  String get invErrMethod => 'Dites comment le paiement est arrivé.';

  @override
  String get invErrPaidOn => 'La date du paiement n\'est pas une vraie date.';

  @override
  String get invErrExceeds => 'C\'est plus que ce qui reste dû.';

  @override
  String get invErrHasLines =>
      'Retirez les lignes et paiements avant de supprimer.';

  @override
  String get invPdfInvoice => 'FACTURE';

  @override
  String get invPdfReceipt => 'REÇU';

  @override
  String get invPdfBilledTo => 'Facturé à';

  @override
  String get invPdfDate => 'Date';

  @override
  String get invPdfDue => 'Échéance';

  @override
  String get invPdfPaidOn => 'Payé le';

  @override
  String get invPdfDescription => 'Description';

  @override
  String get invPdfQty => 'Qté';

  @override
  String get invPdfEach => 'Unité';

  @override
  String get invPdfAmount => 'Montant';

  @override
  String get invPdfTotal => 'Total';

  @override
  String get invPdfPaid => 'Payé';

  @override
  String get invPdfBalanceDue => 'Solde dû';

  @override
  String get invPdfPaidInFull => 'Payé en totalité';

  @override
  String get invPdfNotes => 'Notes';

  @override
  String get invPdfPayments => 'Paiements reçus';

  @override
  String get invPdfIssuedBy => 'Émis par';

  @override
  String get invPdfCustomer => 'Client';

  @override
  String get invPdfFooter => 'Émis via Laawol Digital · laawoldigital.com';

  @override
  String get invLineVinFirst => 'VIN (vous vendez une voiture ? commencez ici)';

  @override
  String get invLineVinFills => '17 caractères — remplit la voiture ci-dessous';

  @override
  String get invPayFor => 'Pour quoi';

  @override
  String get invPayWholeInvoice => 'Toute la facture';

  @override
  String invPayForLine(String what) {
    return 'pour $what';
  }

  @override
  String get invPdfFor => 'pour';

  @override
  String get pmeTitle => 'Fin de mois';

  @override
  String get pmeButton => 'Fin de mois';

  @override
  String get pmeShareMonth => 'Voir le mois en PDF';

  @override
  String get pmePreviousMonth => 'Mois précédent';

  @override
  String get pmeNextMonth => 'Mois suivant';

  @override
  String get pmeCarsOnLot => 'Voitures au parking';

  @override
  String get pmeBilled => 'Facturé';

  @override
  String get pmeCollected => 'Encaissé';

  @override
  String get pmeStillOwed => 'Encore dû';

  @override
  String pmeWhoOwesCount(int count) {
    return 'Qui doit ($count)';
  }

  @override
  String pmeEveryCarCount(int count) {
    return 'Toutes les voitures ($count)';
  }

  @override
  String get pmeNoCars => 'Aucune voiture n\'était au parking ce mois-là.';

  @override
  String get pmeNobodyOwes => 'Personne ne doit rien pour ce mois.';

  @override
  String get pmeStillParked => 'Toujours garée';

  @override
  String get pmeLeft => 'Partie';

  @override
  String get pmeSoFar => 'à ce jour';

  @override
  String get pmeFromBefore => 'Impayé des mois précédents';

  @override
  String pmeParkingLine(int days, String rate) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days jours',
      one: '1 jour',
    );
    return '$_temp0 × $rate';
  }

  @override
  String pmeDays(int days) {
    String _temp0 = intl.Intl.pluralLogic(
      days,
      locale: localeName,
      other: '$days jours',
      one: '1 jour',
    );
    return '$_temp0';
  }

  @override
  String get pmeSharePdf => 'Voir la facture en PDF';

  @override
  String get pmeSendText => 'Envoyer en texte';

  @override
  String get pmeOpenCar => 'Ouvrir la voiture pour enregistrer un paiement';

  @override
  String get pmePdfFailed => 'Le PDF n\'a pas pu être créé. Réessayez.';

  @override
  String get pmePdfBill => 'FACTURE MENSUELLE';

  @override
  String get pmePdfSummary => 'FIN DE MOIS';

  @override
  String get pmePdfVehicle => 'Véhicule';

  @override
  String get pmePdfPeriod => 'Période';

  @override
  String get pmeWhoOwes => 'Qui doit encore';

  @override
  String pmeCars(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count voitures',
      one: '1 voiture',
    );
    return '$_temp0';
  }

  @override
  String get pmeCar => 'Voiture';

  @override
  String get pmeAmount => 'Montant';

  @override
  String get pmeTo => 'au';

  @override
  String get pmeRegisteredTo => 'enregistrée au nom de';

  @override
  String get pmeMonthTotal => 'Total du mois';

  @override
  String pmeEveryoneCount(int count) {
    return 'Tout le monde ($count)';
  }

  @override
  String pmePaidCount(int count) {
    return 'Payés ($count)';
  }

  @override
  String get pmeNobodyPaid => 'Personne n’a encore payé pour ce mois.';

  @override
  String pmeCustomersOwe(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count clients doivent',
      one: '1 client doit',
    );
    return '$_temp0';
  }

  @override
  String get pmePickCar => 'Quelle voiture ?';

  @override
  String get pmeActivities => 'Activités';

  @override
  String get pmeActivity => 'Activité';

  @override
  String get pmeDate => 'Date';

  @override
  String get pmeParking => 'Parking';

  @override
  String get pmePaidToward => 'Payé pour';

  @override
  String get pmePaidWord => 'payé';

  @override
  String get pmeDueWord => 'dû';

  @override
  String pmeItems(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count éléments',
      one: '1 élément',
    );
    return '$_temp0';
  }

  @override
  String pmeActivitiesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count activités',
      one: '1 activité',
    );
    return '$_temp0';
  }

  @override
  String get pmePaidInFull => 'payé en totalité';

  @override
  String get pmeMarkAllPaid => 'Tout marquer payé';

  @override
  String get pmeSettleHint =>
      'Chaque ligne est enregistrée comme un paiement saisi à la main : elle apparaît sur la voiture ou l\'activité, dans son historique et dans vos rapports.';

  @override
  String get pmeTotalToRecord => 'Total à enregistrer';

  @override
  String get pmeWhoTookIt => 'Qui a reçu l\'argent ?';

  @override
  String get pmeSayWhoReceived => 'Indiquez qui a reçu l\'argent.';

  @override
  String get pmeNotIncluded => 'payé en ligne, non inclus';

  @override
  String pmeRecordTotal(String amount) {
    return 'Enregistrer $amount';
  }

  @override
  String pmeTryAgain(int count) {
    return 'Réessayer les $count';
  }

  @override
  String pmeRecordingProgress(int done, int total) {
    return 'Enregistrement $done sur $total…';
  }

  @override
  String pmeRecordedAll(String amount, int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count éléments',
      one: '1 élément',
    );
    return '$amount enregistrés — $_temp0.';
  }

  @override
  String pmeSomeFailed(int done, int total) {
    return '$done sur $total enregistrés. Ceux-ci n\'ont pas été enregistrés :';
  }

  @override
  String pmeAlreadyPaid(int count) {
    return '$count déjà payés';
  }

  @override
  String get ctrPrintLabels => 'Imprimer les étiquettes';

  @override
  String get ctrPrintLineLabels => 'Imprimer les étiquettes de ce colis';

  @override
  String ctrPrintLabelsAll(String name) {
    return 'Étiquettes pour chaque colis de $name';
  }

  @override
  String ctrPrintLabelsOne(String item) {
    return 'Étiquettes pour $item uniquement';
  }

  @override
  String get ctrLabelPaper => 'Papier';

  @override
  String get ctrLabelSheet => 'Feuille Letter';

  @override
  String get ctrLabelSheetNote =>
      'Avery 5524 ou toute planche Letter de 2 × 3, six étiquettes par page.';

  @override
  String get ctrLabelThermal => 'Thermique 4 × 6';

  @override
  String get ctrLabelThermalNote =>
      'Une étiquette par étiquette 4 × 6 po en rouleau, pour les imprimantes Zebra, Rollo et similaires.';

  @override
  String get ctrLabelCopies => 'Étiquettes par colis';

  @override
  String get ctrLabelTwo => 'Deux';

  @override
  String get ctrLabelTwoNote =>
      'Une de chaque côté, pour que le colis reste identifiable si l’une se déchire.';

  @override
  String get ctrLabelOne => 'Une';

  @override
  String get ctrLabelOneNote =>
      'Pour remplacer une seule étiquette déchirée ou perdue.';

  @override
  String get ctrLabelPrintButton => 'Ouvrir les étiquettes à imprimer';

  @override
  String get ctrLabelOpening => 'Ouverture…';

  @override
  String get ctrLabelsCouldNotOpen =>
      'Les étiquettes n’ont pas pu être ouvertes. Réessayez dans un instant.';

  @override
  String get ctrLabelTip =>
      'Les étiquettes s’ouvrent dans votre navigateur, prêtes à imprimer. Sur les barils, des étiquettes résistantes à l’eau ou du ruban adhésif transparent gardent le code lisible sous la pluie.';

  @override
  String get pkgScanAction => 'Scanner un colis';

  @override
  String get pkgScanTitle => 'Trouver un colis';

  @override
  String get pkgScanHint => 'Visez le code QR de l’étiquette du colis';

  @override
  String get pkgNotAPackageQr =>
      'Ce code QR n’est pas une étiquette de colis Laawol.';

  @override
  String get pkgCameraUnavailable =>
      'L’appareil photo n’est pas disponible. Saisissez le code imprimé sur l’étiquette, ou cherchez par nom ou téléphone ci-dessous.';

  @override
  String get pkgTypeCode => 'Saisir le code';

  @override
  String get pkgQueryHint => 'CL-K7M4P2, un nom ou un téléphone';

  @override
  String get pkgQueryNote =>
      'Étiquette trop abîmée pour être scannée ? Saisissez le code imprimé à côté du QR, ou cherchez par le nom ou le téléphone du client ou du destinataire.';

  @override
  String get pkgClear => 'Effacer';

  @override
  String pkgOpenCode(String code) {
    return 'Ouvrir $code';
  }

  @override
  String get pkgNoMatchHint =>
      'La recherche porte sur les noms et téléphones des clients et des destinataires, et sur les VIN, dans tous vos conteneurs.';

  @override
  String get pkgTitle => 'Colis';

  @override
  String get pkgCouldNotLoad =>
      'Ce colis n’a pas pu être chargé. Vérifiez votre connexion et réessayez.';

  @override
  String get pkgCouldNotOpenApp => 'Impossible d’ouvrir cela sur ce téléphone.';

  @override
  String pkgNotFoundTitle(String code) {
    return '$code ne figure dans aucun de vos conteneurs';
  }

  @override
  String get pkgNotFoundHint =>
      'Le code est peut-être mal saisi, ou le colis appartient à une autre entreprise. Sa page de suivi publique indique toujours sa destination.';

  @override
  String get pkgLineGone =>
      'Ce colis ne figure plus dans aucun de vos conteneurs.';

  @override
  String get pkgLookUpPublicly => 'Ouvrir la page de suivi publique';

  @override
  String get pkgWhatItIs => 'De quoi il s’agit';

  @override
  String pkgQuantity(int count) {
    return 'Quantité : $count';
  }

  @override
  String pkgVin(String vin) {
    return 'VIN $vin';
  }

  @override
  String get pkgOwner => 'Propriétaire';

  @override
  String get pkgNoReceiver => 'Aucun destinataire enregistré.';

  @override
  String get pkgContainer => 'Conteneur';

  @override
  String get pkgContainerUnknown => 'Conteneur introuvable.';

  @override
  String get pkgUpdates => 'Mises à jour WhatsApp';

  @override
  String get pkgReprintLabels => 'Réimprimer les étiquettes';

  @override
  String get pkgOpenContainer => 'Ouvrir le conteneur';

  @override
  String get pkgNoCode => 'Pas encore de code de suivi';

  @override
  String get pkgNoName => 'Sans nom';

  @override
  String get pkgNoPhone => 'Pas de téléphone';

  @override
  String get pkgCall => 'Appeler';

  @override
  String get pkgWhatsApp => 'WhatsApp';

  @override
  String get pkgNoUpdateYet =>
      'Aucune mise à jour envoyée pour l’instant. La première part quand le conteneur prend la mer.';

  @override
  String pkgLastUpdate(String moment) {
    return 'Dernière mise à jour : $moment';
  }

  @override
  String pkgLastUpdateAt(String moment, String when) {
    return 'Dernière mise à jour : $moment, $when';
  }

  @override
  String pkgUpdateResult(String who, String status) {
    return '$who : $status';
  }

  @override
  String get pkgMomentShipped => 'parti du port';

  @override
  String get pkgMomentAtPort => 'au port de destination';

  @override
  String get pkgMomentArrived => 'prêt à récupérer';

  @override
  String get pkgMomentReceived => 'reçu';

  @override
  String get pkgResultSent => 'envoyée';

  @override
  String get pkgResultFailed => 'échec de l’envoi';

  @override
  String get pkgResultWaiting => 'en attente de la connexion WhatsApp';

  @override
  String get pkgResultWaitingTemplate =>
      'en attente de l’approbation du message par WhatsApp';

  @override
  String get pkgResultNoPhone => 'non envoyée, pas de téléphone';

  @override
  String get pkgResultSwitchedOff => 'non envoyée, mises à jour désactivées';

  @override
  String get pkgResultNeedsCountryCode =>
      'non envoyée, le téléphone n’a pas d’indicatif pays';

  @override
  String get pkgResultNotSent => 'non envoyée';

  @override
  String get moneyAmountInvalid =>
      'Saisissez un montant comme 12,50 ou 1 200,50.';

  @override
  String get authErrorUserDisabled =>
      'Ce compte a été désactivé. Contactez l’assistance si vous pensez qu’il s’agit d’une erreur.';

  @override
  String get authErrorTooManyRequests =>
      'Trop de tentatives. Patientez quelques minutes et réessayez.';

  @override
  String get authErrorNetwork =>
      'Pas de connexion. Vérifiez votre accès à Internet et réessayez.';

  @override
  String get authErrorWeakPassword =>
      'Choisissez un mot de passe plus robuste - au moins 6 caractères.';

  @override
  String get authErrorEmailInUse => 'Un compte existe déjà avec cet e-mail.';

  @override
  String get authErrorNoAccountForEmail => 'Aucun compte n’utilise cet e-mail.';

  @override
  String get authErrorSignInUnavailable =>
      'La connexion par e-mail n’est pas disponible pour le moment. Contactez l’assistance.';

  @override
  String get authErrorSignInRequired => 'Connectez-vous d’abord.';

  @override
  String get authErrorInvalidOwnerPhone =>
      'Saisissez un numéro de téléphone du propriétaire valide avec l’indicatif pays.';

  @override
  String get authErrorInvalidBusinessPhone =>
      'Saisissez un numéro de téléphone de l’entreprise valide avec l’indicatif pays.';

  @override
  String get authErrorUnknown =>
      'Une erreur s’est produite. Veuillez réessayer.';

  @override
  String get supportLoadEarlierMessages => 'Charger les messages précédents';

  @override
  String recordSavedReceiptUnavailable(String trackingCode) {
    return 'Enregistré. Numéro de suivi : $trackingCode. Le reçu n’a pas pu être imprimé, mais la fiche est enregistrée - ne l’enregistrez pas une seconde fois.';
  }

  @override
  String get invStatCollectedThisMonth => 'Encaissé ce mois-ci';

  @override
  String get invLoadOlder => 'Charger des factures plus anciennes';

  @override
  String get invSearchLoadedHint =>
      'La recherche couvre toutes les factures ouvertes et les plus récentes payées. Chargez des factures plus anciennes pour chercher plus loin.';

  @override
  String get purchaseStatusAll => 'Tous';

  @override
  String get purchaseStatusReviewPending => 'Examen en attente';

  @override
  String get purchaseStatusNoShow => 'Client absent';

  @override
  String get purchaseStatusForfeited => 'Acompte conservé';

  @override
  String get paymentStatusFailed => 'Échoué';

  @override
  String get paymentStatusNotRequired => 'Non requis';

  @override
  String get extensionStatusRejected => 'Refusée';

  @override
  String extensionPaymentSuffix(String status) {
    return ' • paiement $status';
  }

  @override
  String get purchaseMarkSoldTitle => 'Marquer la voiture comme vendue ?';

  @override
  String purchaseMarkSoldMessage(String carTitle) {
    return 'Le blocage payé de $carTitle sera finalisé.';
  }

  @override
  String get purchaseNoShowTitle => 'Le client n’est pas venu ?';

  @override
  String purchaseNoShowMessage(String carTitle) {
    return '$carTitle sera libérée, l’acompte de blocage sera conservé et ce résultat sera ajouté à l’historique de l’acheteur.';
  }

  @override
  String get purchaseApproveExtensionTitle => 'Approuver la prolongation ?';

  @override
  String get purchaseRejectExtensionTitle => 'Rejeter la prolongation ?';

  @override
  String get purchaseApproveExtensionMessage =>
      'Le client pourra payer le montant supplémentaire du blocage.';

  @override
  String get purchaseRejectExtensionMessage =>
      'La date de blocage actuelle restera inchangée.';

  @override
  String get purchaseApprove => 'Approuver';

  @override
  String get purchaseReject => 'Rejeter';

  @override
  String get purchaseForfeitedCannotComplete =>
      'Un blocage dont l’acompte a été conservé ne peut pas être terminé.';

  @override
  String get purchaseFilterBusiness => 'Entreprise';

  @override
  String get purchaseAllBusinesses => 'Toutes les entreprises';

  @override
  String get purchaseLoadMore => 'Charger plus';

  @override
  String get holdMaxDaysOutOfRange =>
      'Le nombre maximal de jours de blocage doit être compris entre 1 et 30.';

  @override
  String get holdAmountMustBePositive =>
      'Saisissez un montant de blocage payé positif.';

  @override
  String get holdMaxDaysLabel => 'Jours de blocage maximum (1-30)';

  @override
  String get paidHoldReviewLabel => 'Blocage payé';

  @override
  String get holdPricingBusinessDefault => 'Tarif par défaut de l’entreprise';

  @override
  String holdPricingFlatAmount(String amount) {
    return 'Forfait $amount';
  }

  @override
  String holdPricingPerDayAmount(String amount) {
    return '$amount par jour';
  }

  @override
  String openBarrelsJoinRequestSent(String deposit) {
    return 'Demande envoyée. Acompte : $deposit';
  }

  @override
  String openBarrelsPosted(String deposit) {
    return 'Baril partagé publié. Acompte : $deposit';
  }

  @override
  String openBarrelsPickupFee(String amount) {
    return 'Frais de collecte : $amount';
  }

  @override
  String openBarrelsDropOffAt(String address) {
    return 'Dépôt à $address';
  }

  @override
  String openBarrelsWalletApplied(String amount) {
    return 'portefeuille utilisé $amount';
  }

  @override
  String openBarrelsCardAmount(String amount) {
    return 'carte $amount';
  }

  @override
  String get ctrSendStatus => 'Envoyer le statut actuel sur WhatsApp';

  @override
  String get ctrSendStatusTitle => 'Envoyer le statut actuel ?';

  @override
  String get ctrSendStatusMessage =>
      'Toutes les personnes de ce conteneur qui n’ont pas reçu la dernière mise à jour la reçoivent maintenant sur WhatsApp. Celles qui l’ont déjà ne reçoivent rien de plus.';

  @override
  String get ctrSendStatusConfirm => 'Envoyer';

  @override
  String ctrSendStatusQueued(int count, String moment) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Envoi de « $moment » à $count personnes sur WhatsApp.',
      one: 'Envoi de « $moment » à 1 personne sur WhatsApp.',
    );
    return '$_temp0';
  }

  @override
  String ctrSendStatusInFlight(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count messages sont déjà en cours d’envoi.',
      one: '1 message est déjà en cours d’envoi.',
    );
    return '$_temp0';
  }

  @override
  String get ctrSendStatusNothingToSend =>
      'Toutes les personnes joignables ont déjà la dernière mise à jour.';

  @override
  String ctrSendStatusAlreadyHad(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count personnes l’avaient déjà.',
      one: '1 personne l’avait déjà.',
    );
    return '$_temp0';
  }

  @override
  String ctrSendStatusCantReach(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count personnes sont injoignables (pas de téléphone, mises à jour désactivées ou pas d’indicatif pays).',
      one:
          '1 personne est injoignable (pas de téléphone, mises à jour désactivées ou pas d’indicatif pays).',
    );
    return '$_temp0';
  }

  @override
  String get ctrSendStatusNoNews =>
      'Ce conteneur n’a pas encore de nouvelles pour les clients. Ils sont prévenus à l’expédition.';

  @override
  String get ctrWhatsAppNotConnectedTitle =>
      'WhatsApp n’est pas encore connecté';

  @override
  String get ctrWhatsAppNotConnectedMessage =>
      'Rien n’a été envoyé. Les mises à jour sont enregistrées et, dès que la plateforme aura connecté WhatsApp, vous pourrez envoyer le statut actuel à tout le monde depuis ici.';

  @override
  String get pkgResultQueued => 'en file d’attente';

  @override
  String get pkgResultSending => 'envoi en cours';

  @override
  String get pkgResultRetrying => 'nouvel essai après un échec';

  @override
  String get businessServiceBarrelShipping => 'Envoi de barils';

  @override
  String get businessServiceSharedBarrels => 'Barils partagés';

  @override
  String get businessServiceFreight => 'Fret (colis)';

  @override
  String get businessServiceCarSales => 'Vente de voitures';

  @override
  String get businessServiceCarParking => 'Stationnement de voitures';

  @override
  String get businessServiceCarTransport => 'Transport de voitures';

  @override
  String get businessServiceBarrelShippingHint =>
      'Expédiez des barils vers les pays de destination.';

  @override
  String get businessServiceSharedBarrelsHint =>
      'Regroupez des barils partiels et associez les clients par destination.';

  @override
  String get businessServiceFreightHint =>
      'Expédiez colis et cartons au poids, par avion ou par bateau.';

  @override
  String get businessServiceCarSalesHint =>
      'Publiez des voitures que les clients peuvent consulter et acheter.';

  @override
  String get businessServiceCarParkingHint =>
      'Gérez les voitures stationnées et les reçus de stationnement.';

  @override
  String get businessServiceCarTransportHint =>
      'Suivez les demandes de transport de voitures.';

  @override
  String get customerServiceCars => 'Voitures';

  @override
  String get customerServiceBarrel => 'Envoyer des barils';

  @override
  String get customerServiceShared => 'Barils partagés';

  @override
  String get customerServiceFreight => 'Fret';

  @override
  String get customerServicePark => 'Garer une voiture';

  @override
  String get customerServiceTransport => 'Transport';

  @override
  String get customerServicePurchases => 'Achats';

  @override
  String get customerServiceViewings => 'Visites de voitures';

  @override
  String get customerServiceTracking => 'Suivi';

  @override
  String get transportJourneyBooked => 'Réservé';

  @override
  String get transportJourneyScheduled => 'Planifié';

  @override
  String get transportJourneyOnItsWay => 'En route';

  @override
  String get transportJourneyDelivered => 'Livré';

  @override
  String get openBarrelsDeadline => 'Limite';

  @override
  String get openBarrelsMode => 'Mode';

  @override
  String get openBarrelsDeposit => 'Acompte';

  @override
  String get openBarrelsPerShare => 'Par part';

  @override
  String get openBarrelsAckDelay =>
      'Je comprends qu’un mauvais article peut retarder le baril partagé.';

  @override
  String get openBarrelsAckProhibited =>
      'Je confirme qu’il n’y a aucun article interdit ou dangereux.';

  @override
  String get openBarrelsAckContents =>
      'Je confirme que le contenu et le poids estimé sont exacts.';

  @override
  String get openBarrelsPickupBorough => 'Arrondissement';

  @override
  String get openBarrelsPickupAddress => 'Adresse de collecte';

  @override
  String get openBarrelsRequestPickup => 'Demander une collecte';

  @override
  String get openBarrelsChoosePickupTime => 'Choisir l’heure de collecte';

  @override
  String get openBarrelsPostButton => 'Publier le baril';

  @override
  String get openBarrelsContentsLabel => 'Qu’envoyez-vous ?';

  @override
  String get openBarrelsReceiverName => 'Nom du destinataire';

  @override
  String get openBarrelsSenderName => 'Nom de l’expéditeur';

  @override
  String get openBarrelsYourShares => 'Vos parts';

  @override
  String get openBarrelsTotalShares => 'Parts totales';

  @override
  String get openBarrelsBusinessAndDestination => 'Entreprise et destination';

  @override
  String get openBarrelsPostHint =>
      'Partagez l’espace libre pour que d’autres complètent le baril.';

  @override
  String get openBarrelsPostTitle => 'Publier un baril partiel';

  @override
  String get openBarrelsConfirmAcknowledgements =>
      'Confirmez les engagements du baril partagé.';

  @override
  String get openBarrelsPickupPriceUnavailable =>
      'Le prix de collecte n’est pas encore disponible.';

  @override
  String get openBarrelsPickupRequired =>
      'Indiquez une adresse et une heure de collecte future.';

  @override
  String get openBarrelsFillRequired =>
      'Renseignez expéditeur, destinataire, téléphone et contenu.';

  @override
  String get openBarrelsNoBusinesses =>
      'Aucune entreprise n’accepte encore les barils partagés.';

  @override
  String get openBarrelsDestinationsLoadFailed =>
      'Impossible de charger les destinations. Vérifiez votre connexion et réessayez.';

  @override
  String get openBarrelsSendRequest => 'Envoyer la demande';

  @override
  String get openBarrelsRequestShareHint =>
      'Réservez de l’espace dans ce baril ouvert.';

  @override
  String get openBarrelsRequestShareTitle => 'Demander une part';

  @override
  String get openBarrelsLeftPool => 'Vous avez quitté le baril.';

  @override
  String get openBarrelsPoolCancelled => 'Baril partagé annulé.';

  @override
  String get openBarrelsBalancePaid => 'Solde payé.';

  @override
  String get openBarrelsLeavePool => 'Quitter le baril';

  @override
  String get openBarrelsPayBalance => 'Payer le solde';

  @override
  String get openBarrelsMineEmptyHint =>
      'Publiez un baril partiel ou demandez une part pour le voir ici.';

  @override
  String get openBarrelsMineEmptyTitle => 'Aucun baril partagé pour le moment';

  @override
  String get openBarrelsMineLoadFailed => 'Impossible de charger vos barils';

  @override
  String get openBarrelsSignInHint =>
      'Vos publications de barils partagés apparaîtront ici après connexion.';

  @override
  String get openBarrelsSignInTitle => 'Connectez-vous';

  @override
  String get openBarrelsRequestOneShare => 'Demander une part';

  @override
  String get openBarrelsEmptyHint =>
      'Quand un client ou une entreprise ouvre des parts disponibles, elles apparaîtront ici.';

  @override
  String get openBarrelsEmptyTitle =>
      'Aucun baril partagé ouvert pour le moment';

  @override
  String get openBarrelsLoadFailed =>
      'Impossible de charger les barils ouverts';

  @override
  String get openBarrelsTabMine => 'Mes barils';

  @override
  String get openBarrelsTabOpen => 'Barils ouverts';

  @override
  String get openBarrelsShareTitle => 'Partager un baril';

  @override
  String get openBarrelsPostPartial => 'Publier un baril partiel';

  @override
  String get sendBarrelSharedPromoTitle => 'Vous ne remplissez pas un baril ?';

  @override
  String get sendBarrelSharedPromoHint =>
      'Rejoignez un baril partagé ouvert ou réservez une part.';

  @override
  String get transportJobCancelledNotice => 'Ce transport a été annulé.';

  @override
  String get shipmentLockedNotice =>
      'Cet envoi ne peut plus être modifié : l’enlèvement a eu lieu ou la demande est déjà en cours de traitement.';

  @override
  String get ctrStatusWaiting => 'En attente';

  @override
  String get wpkWaitingTitle => 'En attente d\'un conteneur';

  @override
  String wpkEntryCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis en attente',
      one: '1 colis en attente',
      zero: 'Aucun colis en attente',
    );
    return '$_temp0';
  }

  @override
  String get wpkEntryHint => 'Déposés, pas encore de conteneur';

  @override
  String get wpkRegister => 'Enregistrer un colis';

  @override
  String get wpkEditPackage => 'Modifier le colis';

  @override
  String get wpkRegisterSubtitle => 'Il attend ici qu\'un conteneur le prenne.';

  @override
  String get wpkUpdatesNotice =>
      'Le client et le destinataire reçoivent un message WhatsApp à l\'enregistrement du colis, au départ du conteneur et à son arrivée. L\'ajouter à un conteneur n\'envoie rien.';

  @override
  String get wpkEmptyTitle => 'Aucun colis en attente.';

  @override
  String get wpkEmptyHint => 'Enregistrez-en un quand un client le dépose.';

  @override
  String get wpkNoMatch =>
      'Aucun colis en attente ne correspond à cette recherche.';

  @override
  String wpkDroppedOff(String date) {
    return 'Déposé le $date';
  }

  @override
  String get wpkSizeTitle => 'Dimensions en pouces (facultatif)';

  @override
  String get wpkLength => 'Longueur';

  @override
  String get wpkWidth => 'Largeur';

  @override
  String get wpkHeight => 'Hauteur';

  @override
  String get wpkSizeHint =>
      'Longueur × largeur × hauteur. Les trois, ou laissez vide.';

  @override
  String get wpkPrice => 'Prix (dollars US)';

  @override
  String get wpkPriceHint => 'Laissez vide s\'il n\'y a pas encore de prix.';

  @override
  String get wpkPayOnArrival => 'Paiement à l\'arrivée';

  @override
  String get wpkPayOnArrivalNote =>
      'L\'équipe à destination enregistrera le paiement.';

  @override
  String get wpkSaveAndPrint => 'Enregistrer et imprimer l\'étiquette';

  @override
  String get wpkSaveAndAnother =>
      'Enregistrer et en ajouter un pour le même client';

  @override
  String wpkSaved(String code) {
    return 'Colis enregistré : $code';
  }

  @override
  String get wpkSavedNoCode => 'Colis enregistré.';

  @override
  String get wpkUpdated => 'Colis mis à jour.';

  @override
  String get wpkRemove => 'Retirer le colis';

  @override
  String get wpkRemoveTitle => 'Retirer ce colis ?';

  @override
  String get wpkRemoveMessage =>
      'Il quitte la liste d\'attente et son étiquette ne fonctionnera plus.';

  @override
  String get wpkRemoved => 'Colis retiré.';

  @override
  String get wpkMoney => 'Prix et paiements';

  @override
  String get wpkSendBack => 'Remettre en attente';

  @override
  String get wpkSendBackTitle => 'Remettre en attente ?';

  @override
  String wpkSendBackMessage(String title, String container) {
    return '$title quitte $container. Son étiquette et son code restent les mêmes.';
  }

  @override
  String get wpkSentBack => 'Colis remis en attente.';

  @override
  String get wpkPayNoPrice => 'Pas encore de prix';

  @override
  String get wpkPayUnpaid => 'Impayé';

  @override
  String get wpkPayPartial => 'Partiel';

  @override
  String get wpkPayPaid => 'Payé';

  @override
  String wpkPaidOfPrice(String paid, String price) {
    return '$paid sur $price';
  }

  @override
  String wpkStillOwed(String amount) {
    return '$amount restant dû';
  }

  @override
  String get wpkRecordPayment => 'Enregistrer un paiement';

  @override
  String get wpkAmountReceived => 'Montant reçu (dollars US)';

  @override
  String get wpkPayWholeBalance => 'Payer tout le solde';

  @override
  String get wpkMethod => 'Mode de paiement';

  @override
  String get wpkNote => 'Note (facultatif)';

  @override
  String get wpkSavePrice => 'Enregistrer le prix';

  @override
  String get wpkPriceSaved => 'Prix enregistré.';

  @override
  String get wpkPaymentRecorded => 'Paiement enregistré.';

  @override
  String get wpkPaymentsTitle => 'Paiements';

  @override
  String get wpkNoPayments => 'Aucun paiement enregistré.';

  @override
  String get wpkRevert => 'Annuler';

  @override
  String get wpkRevertTitle => 'Annuler ce paiement ?';

  @override
  String wpkRevertMessage(String amount) {
    return 'Le paiement de $amount est barré et le solde remonte.';
  }

  @override
  String get wpkReverted => 'Paiement annulé.';

  @override
  String get wpkRevertedMark => 'Annulé';

  @override
  String wpkRevertedBy(String name) {
    return 'Annulé par $name';
  }

  @override
  String wpkReceivedByName(String name) {
    return 'reçu par $name';
  }

  @override
  String wpkEnteredBy(String name) {
    return 'saisi par $name';
  }

  @override
  String get wpkAddWaiting => 'Ajouter des colis en attente';

  @override
  String wpkAddWaitingCount(int count) {
    return 'Ajouter des colis en attente · $count';
  }

  @override
  String wpkAddWaitingNote(String container) {
    return 'Cochez les colis qui vont sur $container.';
  }

  @override
  String get wpkNoneWaiting => 'Aucun colis n\'attend de conteneur.';

  @override
  String get wpkSelectAll => 'Tout sélectionner';

  @override
  String get wpkClear => 'Effacer';

  @override
  String wpkSelected(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count sélectionnés',
      one: '1 sélectionné',
    );
    return '$_temp0';
  }

  @override
  String get wpkAddToContainer => 'Ajouter au conteneur';

  @override
  String wpkAdded(int count, String container) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis ajoutés à $container.',
      one: '1 colis ajouté à $container.',
    );
    return '$_temp0';
  }

  @override
  String get wpkTickOne => 'Cochez au moins un colis.';

  @override
  String wpkBlockedMismatch(String from, String to) {
    return 'Pour $from ; ce conteneur va vers $to.';
  }

  @override
  String wpkWaitingExplain(String destination) {
    return 'Reçu au comptoir. Il partira sur un conteneur à destination de $destination dès qu\'un sera en chargement.';
  }

  @override
  String get wpkWaitingExplainAny =>
      'Reçu au comptoir. Il partira sur un conteneur dès qu\'un sera en chargement.';

  @override
  String wpkSizeFact(String dimensions, String volume) {
    return 'Taille : $dimensions · $volume';
  }

  @override
  String get wpkPriceFact => 'Prix et paiements';

  @override
  String get wpkNoPriceYet => 'Aucun prix défini pour l\'instant.';

  @override
  String get ctrErrVinAlreadyWaiting =>
      'Cette voiture attend déjà un conteneur.';

  @override
  String get wpkErrDestinationRequired =>
      'Choisissez la destination de ce colis.';

  @override
  String get wpkErrDestinationMismatch =>
      'Un colis ne peut aller que sur un conteneur à destination du même pays.';

  @override
  String get wpkErrContainerDestinationRequired =>
      'Choisissez la destination de ce conteneur avant d\'y ajouter des colis.';

  @override
  String get wpkErrSizeInvalid =>
      'Saisissez la longueur, la largeur et la hauteur en pouces, ou laissez les trois vides.';

  @override
  String get wpkErrLineNotWaiting => 'Ce colis est déjà sur un conteneur.';

  @override
  String get wpkErrLineIsWaiting =>
      'Ce colis attend un conteneur. Ajoutez-le à un conteneur depuis la liste d\'attente.';

  @override
  String get wpkErrLineNotInContainer =>
      'Ce colis n\'est pas sur un conteneur.';

  @override
  String get wpkErrLineIdsInvalid => 'Choisissez entre 1 et 100 colis.';

  @override
  String get wpkErrLineHasPayments =>
      'Des paiements sont enregistrés pour ce colis. Annulez-les d\'abord.';

  @override
  String get wpkErrPriceInvalid =>
      'Saisissez le prix en dollars, supérieur à zéro.';

  @override
  String get wpkErrPriceBelowPaid =>
      'Le prix ne peut pas être inférieur à ce qui a été payé.';

  @override
  String get wpkErrPriceRequired =>
      'Définissez un prix avant d\'enregistrer un paiement.';

  @override
  String get wpkErrAmountRequired => 'Saisissez le montant reçu.';

  @override
  String get wpkErrAmountTooLarge =>
      'Ce montant dépasse ce qu\'un colis peut porter.';

  @override
  String get wpkErrMethodInvalid => 'Indiquez comment le paiement est arrivé.';

  @override
  String get wpkErrReceivedByRequired =>
      'Indiquez quel employé a reçu le paiement.';

  @override
  String get wpkErrExceedsBalance => 'C\'est plus que ce qui reste dû.';

  @override
  String get wpkErrPaymentNotFound => 'Ce paiement n\'existe plus.';

  @override
  String get wpkErrPaymentReverted => 'Ce paiement a déjà été annulé.';

  @override
  String get guestTrackingStageWaitingContainer =>
      'Reçu, en attente d\'un conteneur';

  @override
  String get dstAddCountry => 'Ajouter un pays';

  @override
  String get dstAddCountryTitle => 'Ajouter un pays';

  @override
  String get dstAddCountrySearchHint => 'Rechercher un pays';

  @override
  String get dstAddCountryNone => 'Tous les pays sont déjà dans la liste.';

  @override
  String dstListedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count destinations utilisées',
      one: '1 destination utilisée',
      zero: 'Aucune destination utilisée',
    );
    return '$_temp0';
  }

  @override
  String get dstEmptyInstruction =>
      'Vous n\'avez encore aucune destination. Touchez Ajouter un pays, choisissez où vous expédiez et activez les services que vous y proposez.';

  @override
  String get dstMakeMain => 'Définir comme principale';

  @override
  String get dstMainDestination => 'Destination principale';

  @override
  String get dstMainHelp => 'Les nouveaux colis s\'ouvrent sur ce pays';

  @override
  String get dstMainSaved => 'Destination principale enregistrée.';

  @override
  String get dstMainCleared => 'Destination principale retirée.';

  @override
  String get guestTrackingStageReadyForPickup => 'Prêt à récupérer';

  @override
  String get dstPickupTitle => 'Retrait dans ce pays';

  @override
  String get dstPickupHelp =>
      'Où les clients récupèrent leurs marchandises. Le message WhatsApp « prêt à récupérer » les indique. Laissez vide pour utiliser l\'adresse et le téléphone de votre entreprise.';

  @override
  String get dstPickupCity => 'Ville de collecte (facultatif)';

  @override
  String get dstPickupCityHint => 'p. ex. Conakry';

  @override
  String get dstPickupAddress => 'Adresse de collecte (facultatif)';

  @override
  String get dstPickupAddressHint => 'p. ex. Madina, près du marché';

  @override
  String get dstPickupPhone => 'Téléphone de collecte (facultatif)';

  @override
  String get dstPickupCityTooLong =>
      'La ville de collecte peut compter au plus 80 caractères.';

  @override
  String get dstPickupAddressTooLong =>
      'L\'adresse de collecte peut compter au plus 200 caractères.';

  @override
  String get dstPickupPhoneInvalid =>
      'Le téléphone de collecte doit comporter l\'indicatif du pays, comme +224 620 00 00 00.';

  @override
  String get dstSeedConfirmTitle => 'Ajouter tous les pays ?';

  @override
  String get dstSeedConfirmBody =>
      'Cela ajoute une fiche pour chaque pays, environ 250 au total. Ceux que vous n\'utilisez pas restent masqués dans cette liste, et vous pouvez toujours en ajouter un avec Ajouter un pays.';

  @override
  String get dstSeedConfirmAction => 'Ajouter tous les pays';

  @override
  String get businessServiceInventory => 'Inventaire';

  @override
  String get businessServiceInventoryHint =>
      'Tenez une liste de produits, imprimez des étiquettes et vendez en les scannant.';

  @override
  String get inventoryTitle => 'Inventaire';

  @override
  String get inventorySubtitle => 'Produits, étiquettes et ventes au comptoir.';

  @override
  String get inventorySell => 'Vendre';

  @override
  String get inventoryAddProduct => 'Ajouter un produit';

  @override
  String get inventorySalesTitle => 'Ventes';

  @override
  String get inventorySearchHint =>
      'Rechercher par marque, nom, catégorie ou code';

  @override
  String get inventoryShowArchived => 'Voir les archivés';

  @override
  String get inventoryTodayTitle => 'Aujourd\'hui';

  @override
  String get inventorySummaryUnavailable =>
      'Les chiffres du jour ne sont pas disponibles pour le moment.';

  @override
  String inventorySalesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ventes',
      one: '1 vente',
      zero: 'Aucune vente',
    );
    return '$_temp0';
  }

  @override
  String inventoryItemsSoldCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles vendus',
      one: '1 article vendu',
    );
    return '$_temp0';
  }

  @override
  String get inventoryRevenue => 'Recettes';

  @override
  String get inventoryProfit => 'Bénéfice';

  @override
  String get inventoryDiscounts => 'Remises accordées';

  @override
  String get inventoryLowStockTitle => 'Stock bas';

  @override
  String get inventoryCountOffTitle => 'Comptage erroné';

  @override
  String get inventoryNoProducts => 'Aucun produit pour le moment';

  @override
  String get inventoryNoProductsHint =>
      'Ajoutez un produit, imprimez son étiquette, puis scannez-la pour le vendre.';

  @override
  String get inventoryNoMatch => 'Aucun produit ne correspond.';

  @override
  String get inventoryNoArchived => 'Aucun produit archivé.';

  @override
  String get inventoryLoadFailed =>
      'Impossible de charger les produits. Vérifiez votre connexion.';

  @override
  String get inventoryInStock => 'En stock';

  @override
  String get inventoryLow => 'Bas';

  @override
  String get inventoryOut => 'Épuisé';

  @override
  String get inventoryArchivedChip => 'Archivé';

  @override
  String get inventoryCountWasOff => 'Comptage erroné';

  @override
  String inventoryInStockCount(int count) {
    return '$count en stock';
  }

  @override
  String get inventoryNewProduct => 'Nouveau produit';

  @override
  String get inventoryEditProduct => 'Modifier le produit';

  @override
  String get inventoryFieldName => 'Nom';

  @override
  String get inventoryFieldPrice => 'Prix';

  @override
  String get inventoryFieldCost => 'Coût (facultatif)';

  @override
  String get inventoryFieldQuantity => 'Quantité en stock';

  @override
  String get inventoryFieldLowStock => 'Stock bas à partir de (facultatif)';

  @override
  String get inventoryFieldCategory => 'Catégorie (facultatif)';

  @override
  String get inventoryFieldPhoto => 'Lien de la photo (facultatif)';

  @override
  String get inventoryLowStockHelp =>
      'Signalé comme bas à ce nombre ou en dessous. Toujours bas à zéro.';

  @override
  String get inventoryQuantityHelpEdit =>
      'Modifiez le comptage depuis la fiche du produit : ajoutez du stock ou fixez le comptage.';

  @override
  String get inventorySaveProduct => 'Enregistrer le produit';

  @override
  String get inventorySaving => 'Enregistrement…';

  @override
  String get inventoryProductAdded => 'Produit ajouté.';

  @override
  String get inventoryProductSaved => 'Produit enregistré.';

  @override
  String get inventoryErrNameRequired => 'Saisissez un nom.';

  @override
  String get inventoryErrNameTooLong => 'Ce nom est trop long.';

  @override
  String get inventoryErrPrice =>
      'Saisissez un prix supérieur à zéro, par exemple 12,50.';

  @override
  String get inventoryErrCost =>
      'Saisissez un coût comme 8,00, ou laissez vide.';

  @override
  String get inventoryErrQuantity =>
      'Saisissez un nombre entier, zéro ou plus.';

  @override
  String get inventoryErrQuantityAdd =>
      'Saisissez un nombre entier d\'au moins 1.';

  @override
  String get inventoryErrLowStock =>
      'Saisissez un nombre entier, ou laissez vide.';

  @override
  String get inventoryErrPhoto =>
      'Saisissez un lien complet commençant par https://.';

  @override
  String get inventoryProductTitle => 'Produit';

  @override
  String get inventoryAddStock => 'Ajouter du stock';

  @override
  String get inventorySetCount => 'Fixer le comptage';

  @override
  String get inventoryAddStockHelp =>
      'Combien d\'unités de plus sont arrivées ?';

  @override
  String get inventorySetCountHelp =>
      'Comptez ce qui est en rayon. Cela remplace le nombre et efface « comptage erroné ».';

  @override
  String get inventoryNoteOptional => 'Note (facultatif)';

  @override
  String get inventoryStockAdded => 'Stock ajouté.';

  @override
  String get inventoryCountSet => 'Comptage mis à jour.';

  @override
  String get inventoryPrintTags => 'Imprimer les étiquettes';

  @override
  String get inventoryTagCopies => 'Combien d\'étiquettes ?';

  @override
  String get inventoryTagCopiesHelp =>
      'Chaque étiquette porte le même code. De 1 à 500.';

  @override
  String get inventoryTagCopiesError =>
      'Saisissez un nombre entier de 1 à 500.';

  @override
  String get inventoryTagsOpen => 'Ouvrir les étiquettes';

  @override
  String get inventoryTagsOpening => 'Ouverture…';

  @override
  String get inventoryTagsCouldNotOpen =>
      'Impossible d\'ouvrir les étiquettes. Réessayez dans un instant.';

  @override
  String get inventoryTagNote =>
      'Une étiquette de 2 × 1 pouce avec le code QR seul. Réimprimer ne change jamais le code.';

  @override
  String get inventoryArchive => 'Archiver';

  @override
  String get inventoryRestore => 'Restaurer';

  @override
  String get inventoryArchiveTitle => 'Archiver ce produit ?';

  @override
  String get inventoryArchiveMessage =>
      'Il disparaît de la vente et de la liste. Son historique reste, et vous pouvez le restaurer.';

  @override
  String get inventoryArchivedDone => 'Produit archivé.';

  @override
  String get inventoryRestoredDone => 'Produit restauré.';

  @override
  String get inventoryDelete => 'Supprimer';

  @override
  String get inventoryDeleteTitle => 'Supprimer ce produit ?';

  @override
  String get inventoryDeleteMessage =>
      'Cela supprime le produit définitivement. Les ventes passées gardent son nom et son prix. Pour le masquer en gardant son historique, archivez-le plutôt.';

  @override
  String get inventoryDeletedDone => 'Produit supprimé.';

  @override
  String get inventoryHistoryTitle => 'Historique du stock';

  @override
  String get inventoryNoHistory => 'Aucun mouvement de stock pour le moment.';

  @override
  String get inventoryMoveInitial => 'Comptage de départ';

  @override
  String get inventoryMoveAdd => 'Stock ajouté';

  @override
  String get inventoryMoveSet => 'Comptage fixé';

  @override
  String get inventoryMoveSale => 'Vendu';

  @override
  String get inventoryMoveVoid => 'Vente annulée';

  @override
  String inventoryMoveNow(int count) {
    return 'Maintenant $count';
  }

  @override
  String inventoryByName(String name) {
    return 'par $name';
  }

  @override
  String get inventoryTagCode => 'Code de l\'étiquette';

  @override
  String get inventoryPrice => 'Prix';

  @override
  String get inventoryCost => 'Coût';

  @override
  String get inventoryCategory => 'Catégorie';

  @override
  String get inventoryCountOffNote =>
      'Une vente a dépassé le comptage. Comptez le rayon et fixez le comptage pour effacer ceci.';

  @override
  String get inventoryProductGone => 'Ce produit n\'existe plus.';

  @override
  String get inventorySellTitle => 'Vendre';

  @override
  String get inventoryScanAnother => 'Scanner un autre produit';

  @override
  String get inventoryScanHint => 'Visez une étiquette de produit';

  @override
  String get inventoryNotATag =>
      'Ce code QR n\'est pas une étiquette de produit Laawol.';

  @override
  String get inventoryCameraUnavailable =>
      'La caméra est indisponible. Saisissez le code de l\'étiquette, ou recherchez le nom du produit ci-dessous.';

  @override
  String get inventoryFindHint => 'Code de l\'étiquette ou nom du produit';

  @override
  String inventoryAddCode(String code) {
    return 'Ajouter $code';
  }

  @override
  String get inventoryItemNotYours =>
      'Cette étiquette n\'est pas l\'un de vos produits.';

  @override
  String inventoryItemArchivedScan(String name) {
    return '$name est archivé. Restaurez-le pour le vendre.';
  }

  @override
  String get inventoryLookupFailed =>
      'Impossible de chercher cette étiquette. Vérifiez votre connexion et scannez à nouveau.';

  @override
  String get inventoryBasketEmpty => 'Rien de scanné pour le moment';

  @override
  String get inventoryBasketEmptyHint =>
      'Scannez une étiquette ou recherchez un produit ci-dessus. Scanner la même étiquette ajoute une unité.';

  @override
  String inventoryAddedToBasket(String name) {
    return '$name ajouté';
  }

  @override
  String inventoryListPrice(String price) {
    return 'Prix affiché $price';
  }

  @override
  String get inventoryLinePrice => 'Prix unitaire';

  @override
  String get inventoryQty => 'Qté';

  @override
  String get inventoryQuantityUp => 'Une de plus';

  @override
  String get inventoryQuantityDown => 'Une de moins';

  @override
  String get inventoryRemoveLine => 'Retirer';

  @override
  String get inventoryLineTotal => 'Total de la ligne';

  @override
  String inventoryExceedsCount(int count) {
    return 'Le comptage indique $count. Vous pouvez quand même le vendre ; le comptage sera marqué comme erroné.';
  }

  @override
  String get inventoryTotal => 'Total';

  @override
  String inventoryDiscountOff(String amount) {
    return '$amount de remise sur les prix affichés';
  }

  @override
  String inventoryPieces(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count pièces',
      one: '1 pièce',
    );
    return '$_temp0';
  }

  @override
  String get inventoryPayment => 'Paiement';

  @override
  String get inventoryPaymentHow => 'Mode de paiement';

  @override
  String get inventorySold => 'Vendu';

  @override
  String get inventorySelling => 'Enregistrement…';

  @override
  String get inventorySaleDone => 'Vente enregistrée';

  @override
  String inventorySaleDoneTotal(String total) {
    return '$total enregistré.';
  }

  @override
  String get inventoryNewSale => 'Nouvelle vente';

  @override
  String inventoryCountWasOffWarn(String name) {
    return 'Comptage erroné pour $name : il y en avait moins que ce que vous avez vendu, le comptage est donc à zéro. Comptez le rayon et fixez le comptage.';
  }

  @override
  String get inventoryNetworkError =>
      'Pas de connexion. Rien n\'est perdu : votre panier est conservé. Réessayez.';

  @override
  String get inventoryFailArchived =>
      'Un produit du panier est archivé. Retirez-le et réessayez.';

  @override
  String get inventoryFailNotFound =>
      'Un produit du panier est introuvable. Retirez-le et réessayez.';

  @override
  String get inventoryFailVoided => 'Cette vente a déjà été annulée.';

  @override
  String get inventoryFailNoPermission =>
      'Vous n\'avez pas le droit de faire cela pour cette boutique.';

  @override
  String get inventoryFailDeviceNotVerified =>
      'Impossible de vérifier cet appareil auprès du serveur. Vérifiez votre connexion et réessayez. Si cela continue, mettez à jour l\'application ou reconnectez-vous.';

  @override
  String get inventoryFailInvalid =>
      'Cela n\'a pas pu être accepté. Vérifiez les détails et réessayez.';

  @override
  String get inventoryFailUnknown => 'Cela n\'a pas abouti. Réessayez.';

  @override
  String get inventoryProblemArchived =>
      'Un produit du panier est archivé. Retirez-le pour continuer.';

  @override
  String get inventoryProblemTooLarge =>
      'Ce total est trop élevé pour être enregistré.';

  @override
  String get inventoryPriceInvalid => 'Saisissez un prix comme 12,50.';

  @override
  String get inventoryTryAgain => 'Réessayer';

  @override
  String get inventoryNoSales => 'Aucune vente pour le moment';

  @override
  String get inventoryNoSalesHint =>
      'Les ventes enregistrées depuis l\'écran Vendre apparaissent ici.';

  @override
  String get inventorySalesLoadFailed =>
      'Impossible de charger les ventes. Vérifiez votre connexion.';

  @override
  String get inventorySaleNotAvailable => 'Cette vente n\'est pas disponible.';

  @override
  String get inventoryLoadMoreSales => 'Voir plus';

  @override
  String get inventoryVoidedMark => 'Annulée';

  @override
  String inventoryVoidedBy(String name, String when) {
    return 'Annulée par $name · $when';
  }

  @override
  String inventoryVoidedWhen(String when) {
    return 'Annulée · $when';
  }

  @override
  String inventorySoldBy(String name) {
    return 'Vendu par $name';
  }

  @override
  String get inventoryVoidSale => 'Annuler la vente';

  @override
  String get inventoryVoidTitle => 'Annuler cette vente ?';

  @override
  String get inventoryVoidMessage =>
      'Le stock retourne en rayon et la vente reste dans la liste, marquée comme annulée. Cette action est irréversible.';

  @override
  String get inventoryVoidedDone => 'Vente annulée.';

  @override
  String inventorySaleLine(int quantity, String name, String price) {
    return '$quantity × $name à $price';
  }

  @override
  String inventorySaleLineChanged(
    int quantity,
    String name,
    String price,
    String list,
  ) {
    return '$quantity × $name à $price (affiché $list)';
  }

  @override
  String get inventorySaleCountOff => 'comptage erroné';

  @override
  String get inventoryLowStockAtLabel => 'Stock bas à partir de';

  @override
  String get inventorySellDiscardTitle => 'Quitter sans vendre ?';

  @override
  String get inventorySellDiscardBody =>
      'Les articles du panier n\'ont pas été vendus. Si vous quittez, le panier est vidé.';

  @override
  String get inventorySellDiscardKeep => 'Rester';

  @override
  String get inventorySellDiscardLeave => 'Vider le panier et quitter';

  @override
  String get inventoryCategoryNone => 'Aucune catégorie';

  @override
  String get inventoryCategoryAddNew => 'Ajouter une catégorie';

  @override
  String get inventoryCategoryNameLabel => 'Nom de la catégorie';

  @override
  String get inventoryCategoryCreate => 'Ajouter la catégorie';

  @override
  String get inventoryCategoryAddedDone => 'Catégorie ajoutée.';

  @override
  String get inventoryCategoryPickTitle => 'Choisissez une catégorie';

  @override
  String get inventoryCategoryAll => 'Toutes les catégories';

  @override
  String get inventoryCategoriesTitle => 'Catégories';

  @override
  String get inventoryCategoriesEmpty =>
      'Aucune catégorie pour le moment. Ajoutez-en une pour regrouper vos produits.';

  @override
  String get inventoryCategoryRename => 'Renommer';

  @override
  String get inventoryCategoryRenameTitle => 'Renommer la catégorie';

  @override
  String get inventoryCategoryRenamedDone => 'Catégorie renommée.';

  @override
  String get inventoryCategoryArchivedDone => 'Catégorie archivée.';

  @override
  String get inventoryCategoryRestoredDone => 'Catégorie restaurée.';

  @override
  String get inventoryCategoryUncategorized => 'Sans catégorie';

  @override
  String get inventoryByCategoryTitle => 'Par catégorie';

  @override
  String get inventoryErrCategoryName => 'Saisissez un nom de catégorie.';

  @override
  String get inventoryManageCategories => 'Gérer les catégories';

  @override
  String get inventoryBrand => 'Marque';

  @override
  String get inventoryFieldBrand => 'Marque (facultatif)';

  @override
  String get inventoryBrandNone => 'Sans marque';

  @override
  String get inventoryBrandAddNew => 'Ajouter une marque';

  @override
  String get inventoryBrandNameLabel => 'Nom de la marque';

  @override
  String get inventoryBrandCreate => 'Ajouter la marque';

  @override
  String get inventoryBrandAddedDone => 'Marque ajoutée.';

  @override
  String get inventoryBrandPickTitle => 'Choisissez une marque';

  @override
  String get inventoryBrandAll => 'Toutes les marques';

  @override
  String get inventoryBrandsTitle => 'Marques';

  @override
  String get inventoryBrandsEmpty =>
      'Aucune marque pour le moment. Ajoutez-en une pour les fabricants que vous vendez, comme Jordan ou Nike.';

  @override
  String get inventoryBrandRename => 'Renommer';

  @override
  String get inventoryBrandRenameTitle => 'Renommer la marque';

  @override
  String get inventoryBrandRenamedDone => 'Marque renommée.';

  @override
  String get inventoryBrandArchivedDone => 'Marque archivée.';

  @override
  String get inventoryBrandRestoredDone => 'Marque restaurée.';

  @override
  String get inventoryByBrandTitle => 'Par marque';

  @override
  String get inventoryErrBrandName => 'Saisissez un nom de marque.';

  @override
  String get inventoryManageBrands => 'Gérer les marques';

  @override
  String get inventoryFailBrandNameTaken =>
      'Vous avez déjà une marque portant ce nom.';

  @override
  String get inventoryFailBrandNotFound =>
      'Cette marque n’existe plus. Choisissez-en une autre.';

  @override
  String get inventoryFailBrandTooLong =>
      'Ce nom de marque est trop long. Utilisez 60 caractères ou moins.';

  @override
  String get inventorySaveAndAddAnother =>
      'Enregistrer et en ajouter un autre du même genre';

  @override
  String inventoryProductAddedNext(String name) {
    return '$name ajouté. Prêt pour le suivant.';
  }

  @override
  String get inventoryStoreFilterAll => 'Tous les magasins';

  @override
  String get inventoryStoreLabel => 'Magasin';

  @override
  String get inventoryStoresTitle => 'Magasins';

  @override
  String get inventoryStoresIntro =>
      'Votre boutique fonctionne comme un seul magasin. Ajoutez un deuxième magasin pour compter le stock séparément dans chacun.';

  @override
  String get inventoryStoreAdd => 'Ajouter un magasin';

  @override
  String get inventoryStoreEdit => 'Modifier le magasin';

  @override
  String get inventoryStoreName => 'Nom du magasin';

  @override
  String get inventoryStoreAddress => 'Adresse (facultatif)';

  @override
  String get inventoryStorePhone => 'Téléphone (facultatif)';

  @override
  String get inventoryStoreSave => 'Enregistrer le magasin';

  @override
  String get inventoryStoreSavedDone => 'Magasin enregistré.';

  @override
  String get inventoryStoreArchiveTitle => 'Archiver ce magasin ?';

  @override
  String get inventoryStoreArchiveMessage =>
      'Il n\'est plus proposé pour la vente ni le stock. Un magasin qui contient encore du stock ne peut pas être archivé : déplacez d\'abord son stock vers un autre magasin.';

  @override
  String get inventoryStoreArchivedDone => 'Magasin archivé.';

  @override
  String get inventoryStoreRestoredDone => 'Magasin restauré.';

  @override
  String get inventoryErrStoreName => 'Saisissez un nom de magasin.';

  @override
  String get inventoryErrStoreRequired => 'Choisissez un magasin.';

  @override
  String inventoryStoreShowing(String store) {
    return 'Affichage de $store';
  }

  @override
  String inventoryStoreSellingFrom(String store) {
    return 'Vente depuis $store';
  }

  @override
  String get inventoryStoreSellPick => 'Vendre depuis';

  @override
  String get inventoryStoreHomeRequired =>
      'Demandez au propriétaire de vous attribuer un magasin avant de vendre.';

  @override
  String get inventoryStoreHomeRequiredView =>
      'Demandez au propriétaire de vous attribuer un magasin pour voir son stock.';

  @override
  String inventoryStoreLowAt(String store) {
    return 'Bas à $store';
  }

  @override
  String get inventoryStockTotalLabel => 'Total tous magasins';

  @override
  String get inventoryStockByStoreTitle => 'Stock par magasin';

  @override
  String get inventoryByStoreTitle => 'Par magasin';

  @override
  String inventoryYourStore(String store) {
    return 'Votre magasin : $store';
  }

  @override
  String inventoryStoreOf(String store) {
    return 'Magasin : $store';
  }

  @override
  String inventoryFieldQuantityAt(String store) {
    return 'Quantité de départ à $store';
  }

  @override
  String inventoryMoveAtStore(String store) {
    return 'à $store';
  }

  @override
  String inventoryStockForStore(String store) {
    return 'Comptage à $store';
  }

  @override
  String get inventoryTransferFrom => 'De';

  @override
  String get inventoryTransferTo => 'Vers';

  @override
  String get inventoryStaffAccessTitle => 'Magasins de l’inventaire';

  @override
  String get inventoryStaffAccessHelp =>
      'Choisissez où cette personne vend et compte le stock.';

  @override
  String get inventoryHomeStore => 'Magasin d’attache';

  @override
  String get inventoryHomeStoreNone => 'Aucun magasin d’attache';

  @override
  String get inventoryAllStoresSwitch => 'Travaille dans tous les magasins';

  @override
  String get inventoryAllStoresHelp =>
      'Elle voit tous les magasins, choisit le magasin lors d’une vente et peut déplacer du stock entre magasins.';

  @override
  String get inventoryStaffAccessSave => 'Enregistrer l’accès';

  @override
  String get inventoryStaffAccessSaved => 'Accès aux magasins enregistré.';

  @override
  String inventoryStaffAccessHome(String store) {
    return 'Magasin : $store';
  }

  @override
  String get inventoryStaffAccessUnset => 'Pas encore de magasin d’attache';

  @override
  String get inventoryFailCategoryNameTaken =>
      'Vous avez déjà une catégorie portant ce nom.';

  @override
  String get inventoryFailCategoryNotFound =>
      'Cette catégorie n’existe plus. Choisissez-en une autre.';

  @override
  String get inventoryFailStoreNotFound =>
      'Ce magasin est introuvable. Revenez en arrière et réessayez.';

  @override
  String get inventoryFailStoreArchived =>
      'Ce magasin est archivé. Choisissez un autre magasin.';

  @override
  String get inventoryFailStoreHasStock =>
      'Ce magasin contient encore du stock. Déplacez-le d’abord vers un autre magasin, puis archivez-le.';

  @override
  String get inventoryFailStoreNotAllowed =>
      'Vous ne pouvez pas utiliser ce magasin. Vos ventes et comptages vont dans votre propre magasin.';

  @override
  String get inventoryFailSameStore => 'Choisissez deux magasins différents.';

  @override
  String get inventoryFailInsufficientStock =>
      'Le magasin d’origine n’en a pas autant. Réduisez le nombre ou ajoutez d’abord du stock.';

  @override
  String get inventoryFailOwnerOnly => 'Seul le propriétaire peut faire cela.';

  @override
  String get shopHomeSellSubtitle => 'Scannez l’étiquette d’un produit';

  @override
  String get shopHomeEnterCode => 'Saisir un code ou rechercher';

  @override
  String shopHomeSalesLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Ventes',
      one: 'Vente',
    );
    return '$_temp0';
  }

  @override
  String get shopHomeProducts => 'Produits';

  @override
  String get shopHomeProductsHint => 'Stock, prix et étiquettes';

  @override
  String get shopHomeSalesHint => 'Historique et annulations';

  @override
  String shopHomeLowCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count produits',
      one: '1 produit',
      zero: 'Rien en stock bas',
    );
    return '$_temp0';
  }

  @override
  String get shopHomeAddHint => 'Un nouvel article et son étiquette';

  @override
  String get shopHomeRecentTitle => 'Ventes du jour';

  @override
  String get shopHomeSeeAll => 'Tout voir';

  @override
  String get shopHomeNoSalesToday =>
      'Aucune vente aujourd’hui. Scannez une étiquette pour faire la première.';

  @override
  String shopHomeSaleItems(int count, String name) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$name et $count autres',
      one: '$name et 1 autre',
      zero: '$name',
    );
    return '$_temp0';
  }

  @override
  String get shopHomeLowNone => 'Aucun produit en stock bas.';

  @override
  String get shopHomeMoreTitle => 'Plus';

  @override
  String get shopHomePendingNote =>
      'En attente d’approbation · Vous pouvez déjà vendre';

  @override
  String get shopHomeChangesNote =>
      'Modifications demandées · Vous pouvez toujours vendre';

  @override
  String get shopHomeNoInventoryAccess =>
      'Cette entreprise vend avec l’Inventaire. Demandez au propriétaire l’autorisation Inventaire.';

  @override
  String get printTagsSizeLabel => 'Taille de l’étiquette';

  @override
  String get printTagsSize2x1 => '2 × 1 po';

  @override
  String get printTagsSize40x30 => '40 × 30 mm';

  @override
  String get printTagsSize50x30 => '50 × 30 mm';

  @override
  String get printTagsSizeCustom => 'Personnalisée';

  @override
  String get printTagsCustomWidth => 'Largeur (mm)';

  @override
  String get printTagsCustomHeight => 'Hauteur (mm)';

  @override
  String get printTagsCustomError =>
      'Saisissez une largeur de 15 à 72 mm et une hauteur de 15 à 100 mm.';

  @override
  String get printTagsNote =>
      'Le code QR uniquement. Chaque copie porte le même code ; une réimpression ne le change jamais.';

  @override
  String get printTagsToPrinter => 'Imprimer sur l’imprimante';

  @override
  String get printTagsConnecting => 'Connexion à l’imprimante…';

  @override
  String printTagsProgress(int done, int total) {
    return 'Impression $done sur $total…';
  }

  @override
  String get printTagsStop => 'Arrêter';

  @override
  String get printTagsStopping => 'Arrêt après cette étiquette…';

  @override
  String printTagsDone(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count étiquettes imprimées.',
      one: '1 étiquette imprimée.',
    );
    return '$_temp0';
  }

  @override
  String printTagsStopped(int printed, int total) {
    return 'Arrêté après $printed sur $total.';
  }

  @override
  String printTagsPartial(int printed, int total) {
    return '$printed sur $total imprimées avant le problème.';
  }

  @override
  String get printTagsSharePdf => 'Partager en PDF';

  @override
  String get printTagsSharing => 'Préparation du PDF…';

  @override
  String get printTagsShareHint =>
      'La page du PDF fait exactement la taille de l’étiquette. Dans l’app de votre imprimante, imprimez-la à 100 % (taille réelle).';

  @override
  String get printTagsPdfFailed => 'Le PDF n’a pas pu être créé. Réessayez.';

  @override
  String get printTagsOpenPage => 'Ouvrir la page des étiquettes';

  @override
  String printTagsPrinterLine(String name) {
    return 'Imprimante : $name';
  }

  @override
  String get printTagsNoPrinter => 'Aucune imprimante choisie pour l’instant.';

  @override
  String get printTagsPrinterSettings => 'Réglages de l’imprimante';

  @override
  String get inventoryPrintTagAction => 'Imprimer l’étiquette';

  @override
  String get labelPrinterTitle => 'Imprimante d’étiquettes';

  @override
  String get labelPrinterSubtitle => 'Phomemo M221 en Bluetooth';

  @override
  String get labelPrinterSectionPrinter => 'Imprimante';

  @override
  String get labelPrinterNone =>
      'Aucune imprimante choisie. Recherchez-la ci-dessous.';

  @override
  String get labelPrinterScan => 'Rechercher les imprimantes';

  @override
  String get labelPrinterScanning => 'Recherche des imprimantes…';

  @override
  String get labelPrinterScanHint =>
      'Allumez l’imprimante et fermez d’abord l’app Print Master. L’imprimante apparaît avec un nom comme Q2… en haut de la liste ; les autres appareils à proximité sont listés en dessous.';

  @override
  String get labelPrinterNoneFound => 'Aucune imprimante trouvée à proximité.';

  @override
  String labelPrinterSignal(int rssi) {
    return 'Signal $rssi dBm';
  }

  @override
  String get labelPrinterUse => 'Utiliser';

  @override
  String get labelPrinterInUse => 'Utilisée';

  @override
  String get labelPrinterForget => 'Oublier';

  @override
  String get labelPrinterConnected => 'Connectée';

  @override
  String get labelPrinterDisconnect => 'Déconnecter';

  @override
  String labelPrinterBattery(int percent) {
    return 'Batterie $percent %';
  }

  @override
  String get labelPrinterSectionLabel => 'Étiquette';

  @override
  String get labelPrinterDensity => 'Noirceur';

  @override
  String get labelPrinterDensityHelp => '1 est le plus clair, 8 le plus foncé.';

  @override
  String get labelPrinterSpeed => 'Vitesse';

  @override
  String get labelPrinterSpeedHelp =>
      '1 est le plus lent et le plus net, 5 le plus rapide.';

  @override
  String get labelPrinterSectionPosition => 'Position sur l’étiquette';

  @override
  String get labelPrinterPositionHelp =>
      'Imprimez le cadre de test, puis déplacez-le jusqu’à ce que la bordure tombe sur les bords de l’étiquette. 8 points = 1 mm.';

  @override
  String get labelPrinterXOffset => 'Gauche / droite';

  @override
  String get labelPrinterYOffset => 'Haut / bas';

  @override
  String labelPrinterDots(int dots) {
    return '$dots points';
  }

  @override
  String get labelPrinterLess => 'Moins';

  @override
  String get labelPrinterMore => 'Plus';

  @override
  String get labelPrinterTestFrame => 'Imprimer le cadre de test';

  @override
  String get labelPrinterTestTag => 'Imprimer une étiquette de test';

  @override
  String get labelPrinterCheckStatus => 'Vérifier l’imprimante';

  @override
  String get labelPrinterChecking => 'Vérification…';

  @override
  String get labelPrinterSent => 'Imprimé.';

  @override
  String get labelPrinterStatusDone =>
      'Imprimante vérifiée. Les réponses sont dans le journal d’impression.';

  @override
  String get labelPrinterSectionLog => 'Journal d’impression';

  @override
  String get labelPrinterLogHelp =>
      'En cas de problème, copiez le journal et envoyez-le au développeur.';

  @override
  String get labelPrinterCopyLog => 'Copier le journal';

  @override
  String get labelPrinterLogCopied => 'Journal d’impression copié.';

  @override
  String get labelPrinterClearLog => 'Effacer';

  @override
  String get labelPrinterLogEmpty => 'Rien pour l’instant.';

  @override
  String get labelPrinterPermissionTitle => 'Bluetooth';

  @override
  String get labelPrinterPermissionBody =>
      'Laawol utilise le Bluetooth uniquement pour trouver votre imprimante d’étiquettes et y imprimer. Votre téléphone va vous demander l’autorisation.';

  @override
  String get labelPrinterPermissionContinue => 'Continuer';

  @override
  String get labelPrinterErrorBluetoothOff =>
      'Le Bluetooth est désactivé. Activez-le dans les réglages du téléphone, puis réessayez.';

  @override
  String get labelPrinterErrorUnsupported =>
      'Ce téléphone ne peut pas utiliser d’imprimante Bluetooth.';

  @override
  String get labelPrinterErrorPermission =>
      'Laawol n’est pas autorisé à utiliser le Bluetooth. Autorisez-le dans les Réglages du téléphone pour Laawol, puis réessayez.';

  @override
  String get labelPrinterErrorLocation =>
      'Activez la localisation : ce téléphone Android en a besoin pour trouver les imprimantes Bluetooth.';

  @override
  String get labelPrinterErrorNoPrinter =>
      'Choisissez d’abord votre imprimante dans les réglages de l’imprimante d’étiquettes.';

  @override
  String get labelPrinterErrorNotFound =>
      'Imprimante introuvable. Est-elle allumée et à proximité ? Fermez l’app Print Master : l’imprimante n’accepte qu’une connexion.';

  @override
  String get labelPrinterErrorConnect =>
      'Connexion à l’imprimante impossible. Fermez Print Master, éteignez puis rallumez l’imprimante, et réessayez.';

  @override
  String get labelPrinterErrorNotAPrinter =>
      'Cet appareil n’est pas une imprimante d’étiquettes utilisable par l’app.';

  @override
  String get labelPrinterErrorLost =>
      'La connexion à l’imprimante a été perdue. Gardez le téléphone près d’elle et réessayez.';

  @override
  String get labelPrinterErrorNoCompletion =>
      'L’imprimante n’a pas confirmé l’étiquette. Vérifiez les étiquettes et que le capot est fermé, puis réessayez. Si cela continue, copiez le journal d’impression et envoyez-le au développeur.';

  @override
  String get labelPrinterErrorOutOfPaper =>
      'L’imprimante n’a plus d’étiquettes. Chargez un rouleau et réessayez.';

  @override
  String get labelPrinterErrorWrite =>
      'L’envoi vers l’imprimante a échoué. Réessayez.';

  @override
  String get labelPrinterErrorBusy =>
      'L’imprimante est occupée par une autre tâche.';

  @override
  String get wpkMoneyReceivedNow => 'Argent reçu maintenant ?';

  @override
  String get wpkMoneyReceivedNote =>
      'Enregistrez ce que le client a payé au comptoir, au moment du dépôt.';

  @override
  String get wpkMoneyReceivedNeedsPrice =>
      'Saisissez d’abord un prix : un paiement se fait toujours sur un prix.';

  @override
  String get wpkErrReceivedByInvalid =>
      'Choisissez un membre de votre équipe comme personne ayant reçu le paiement.';

  @override
  String wpkSavedWithPayment(String code, String amount) {
    return 'Colis enregistré : $code · $amount reçus';
  }

  @override
  String get pkgLabelSizeLabel => 'Taille des étiquettes de colis';

  @override
  String get pkgLabelsHow => 'Comment imprimer';

  @override
  String get pkgLabelsMethodPrinter => 'Imprimante d’étiquettes (Bluetooth)';

  @override
  String get pkgLabelsMethodPrinterNote =>
      'Directement vers l’imprimante d’étiquettes Phomemo depuis ce téléphone. Choisissez l’imprimante dans Réglages de l’imprimante.';

  @override
  String pkgLabelsMethodPrinterNoteNamed(String name, String size) {
    return 'Directement vers $name depuis ce téléphone, sur des étiquettes de $size.';
  }

  @override
  String get pkgLabelsMethodSystem => 'Imprimer en 4 × 6 (toute imprimante)';

  @override
  String get pkgLabelsMethodSystemNote =>
      'Ouvre la fenêtre d’impression : AirPrint sur iPhone, le service d’impression sur Android, y compris une imprimante 4 × 6 partagée depuis votre ordinateur.';

  @override
  String get pkgLabelsPrintButton => 'Imprimer';

  @override
  String get pkgLabelsPreparing => 'Préparation des étiquettes…';

  @override
  String get pkgLabelsStopping => 'Arrêt après cette étiquette…';

  @override
  String pkgLabelsPrinted(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count étiquettes imprimées.',
      one: '1 étiquette imprimée.',
    );
    return '$_temp0';
  }

  @override
  String get pkgLabelsCouldNotLoad =>
      'Impossible de charger les étiquettes. Réessayez dans un instant.';

  @override
  String get pkgLabelsNone => 'Aucun colis à imprimer.';

  @override
  String get pkgLabelsPrintFailed =>
      'Impossible d’imprimer les étiquettes. Réessayez.';

  @override
  String get pkgLabelsOneNotePrinter =>
      'Une étiquette par colis : suffisant pour un retrait ou une étiquette déchirée.';

  @override
  String get pkgLabelsTipPrinter =>
      'Chaque étiquette porte le code QR, le code de suivi, ainsi que les deux noms et numéros de téléphone. Réglez la taille sur le rouleau chargé dans l’imprimante.';

  @override
  String get pkgLabelsTipSystem =>
      'Choisissez l’imprimante 4 × 6 dans la fenêtre et imprimez en taille réelle (100 %). Deux étiquettes par colis, une pour chaque côté.';

  @override
  String invCreditMe(String name) {
    return '$name (moi)';
  }

  @override
  String get invCreditOnCredit => 'À crédit';

  @override
  String get invCreditOnCreditNote =>
      'Le client paie une partie maintenant (ou rien) et doit le reste.';

  @override
  String get invCreditPaidNow => 'Payé maintenant (dollars US)';

  @override
  String invCreditPaidNowReceivedBy(String amount) {
    return 'Qui a reçu les $amount payés maintenant';
  }

  @override
  String get invCreditCustomerName => 'Nom du client';

  @override
  String get invCreditCustomerPhone => 'Téléphone du client (facultatif)';

  @override
  String get invCreditCollector => 'Qui encaisse le reste';

  @override
  String get invCreditCollectorPick => 'Choisir qui encaisse';

  @override
  String get invCreditDueDate => 'Échéance (facultatif)';

  @override
  String get invCreditNoDueDate => 'Sans échéance';

  @override
  String get invCreditClearDueDate => 'Effacer l\'échéance';

  @override
  String invCreditSplit(String paid, String owed) {
    return 'Payé maintenant $paid · À crédit $owed';
  }

  @override
  String get invCreditErrPaidNowInvalid =>
      'Saisissez le montant payé maintenant, ou laissez vide pour rien.';

  @override
  String get invCreditErrPaidNowTooLarge =>
      'À crédit, le montant payé maintenant doit être inférieur au total.';

  @override
  String get invCreditErrPhoneRequired =>
      'Saisissez le numéro de téléphone du client.';

  @override
  String get invCreditErrCollectorRequired =>
      'Choisissez qui encaisse le reste.';

  @override
  String get invCreditErrCollectorInvalid =>
      'Cette personne ne fait pas partie de cette entreprise.';

  @override
  String get invCreditErrDueDate =>
      'Choisissez une échéance à partir d\'aujourd\'hui.';

  @override
  String get invCreditFixCheckout =>
      'Vérifiez les détails du paiement ci-dessus.';

  @override
  String invCreditOwes(String name, String amount) {
    return '$name doit $amount';
  }

  @override
  String get invCreditFailCustomer =>
      'Une vente à crédit demande le nom et le téléphone du client.';

  @override
  String get invCreditFailNoCredit => 'Cette vente n\'a rien à crédit.';

  @override
  String get invCreditFailHasPayments =>
      'Cette vente a des paiements de crédit. Annulez-les avant d\'annuler la vente.';

  @override
  String get invCreditFailInvalid =>
      'Ces informations de crédit ne sont pas valides. Vérifiez-les et réessayez.';

  @override
  String get invCreditFailAmountInvalid =>
      'Saisissez un montant supérieur à zéro, au centime près.';

  @override
  String get invCreditFailPhoneInvalid =>
      'Saisissez le téléphone du client avec son indicatif pays.';

  @override
  String get invCreditPaymentOnCredit => 'À crédit';

  @override
  String invSummaryOnCredit(String credit, String owed) {
    return 'Dont à crédit $credit ($owed encore dû)';
  }

  @override
  String invCreditChipOpen(String amount) {
    return 'Dû $amount';
  }

  @override
  String invCreditChipOverdue(String amount) {
    return 'En retard $amount';
  }

  @override
  String get invCreditChipPaid => 'Crédit payé';

  @override
  String get invCreditFilterAll => 'Toutes les ventes';

  @override
  String get invCreditOwedTitle => 'Crédit dû';

  @override
  String get invCreditOwedHint => 'Clients qui doivent encore';

  @override
  String invCreditReceivedByName(String name) {
    return 'Reçu par $name';
  }

  @override
  String get invCreditDetails => 'Détails du crédit';

  @override
  String invCreditOwedOf(String owed, String credit) {
    return '$owed dû sur $credit';
  }

  @override
  String get invCreditPaidOff => 'Entièrement payé';

  @override
  String get invCreditCustomer => 'Client';

  @override
  String invCreditCall(String name) {
    return 'Appeler $name';
  }

  @override
  String get invCreditCallFailed => 'Le téléphone n\'a pas pu lancer l\'appel.';

  @override
  String invCreditCollectedBy(String name) {
    return 'Encaissé par $name';
  }

  @override
  String get invCreditNoCollector => 'Personne ne l\'encaisse encore';

  @override
  String invCreditDueOn(String date) {
    return 'À payer le $date';
  }

  @override
  String invCreditOverdueSince(String date) {
    return 'En retard depuis le $date';
  }

  @override
  String get invCreditChange => 'Changer l\'encaisseur ou l\'échéance';

  @override
  String get invCreditChanged => 'Crédit mis à jour.';

  @override
  String invCreditPaidAtSale(String amount) {
    return '$amount payé au comptoir';
  }

  @override
  String get invCreditVoidedNote =>
      'Cette vente a été annulée : rien n\'est dû.';

  @override
  String get invCreditFilterMine => 'Les miens';

  @override
  String get invCreditFilterEveryone => 'Tout le monde';

  @override
  String invCreditTotals(int count, String amount) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count crédits ouverts',
      one: '1 crédit ouvert',
    );
    return '$_temp0 · $amount dû';
  }

  @override
  String invCreditOverdueTotals(int count, String amount) {
    return '$count en retard · $amount';
  }

  @override
  String get invCreditNoneOpen => 'Rien n\'est dû.';

  @override
  String get invCreditNoneOpenHint =>
      'Les ventes à crédit encore dues s\'affichent ici jusqu\'à leur paiement.';

  @override
  String get invCreditLoadFailed => 'Les crédits n\'ont pas pu être chargés.';

  @override
  String invCreditSoldOn(String date) {
    return 'Vendu le $date';
  }

  @override
  String get invCreditNotifications => 'Crédits à encaisser';

  @override
  String get salesHistTitle => 'Historique des ventes';

  @override
  String get salesHistHint => 'Jour, semaine, mois, année';

  @override
  String get salesHistDay => 'Jour';

  @override
  String get salesHistWeek => 'Semaine';

  @override
  String get salesHistMonth => 'Mois';

  @override
  String get salesHistYear => 'Année';

  @override
  String get salesHistPrevious => 'Période précédente';

  @override
  String get salesHistNext => 'Période suivante';

  @override
  String get salesHistPickDate => 'Choisir une date';

  @override
  String get salesHistRefresh => 'Actualiser';

  @override
  String salesHistCurrent(String kind) {
    String _temp0 = intl.Intl.selectLogic(kind, {
      'day': 'Aujourd\'hui',
      'week': 'Cette semaine',
      'month': 'Ce mois-ci',
      'other': 'Cette année',
    });
    return '$_temp0';
  }

  @override
  String salesHistRange(String start, String end) {
    return '$start – $end';
  }

  @override
  String get salesHistTotalSold => 'Total vendu';

  @override
  String salesHistVsPrevious(String change, String kind) {
    String _temp0 = intl.Intl.selectLogic(kind, {
      'day': 'par rapport à la veille',
      'week': 'par rapport à la semaine précédente',
      'month': 'par rapport au mois précédent',
      'other': 'par rapport à l\'année précédente',
    });
    return '$change $_temp0';
  }

  @override
  String salesHistNoComparison(String kind) {
    String _temp0 = intl.Intl.selectLogic(kind, {
      'day': 'Aucune vente la veille',
      'week': 'Aucune vente la semaine précédente',
      'month': 'Aucune vente le mois précédent',
      'other': 'Aucune vente l\'année précédente',
    });
    return '$_temp0';
  }

  @override
  String salesHistSalesLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'ventes',
      one: 'vente',
      zero: 'vente',
    );
    return '$_temp0';
  }

  @override
  String get salesHistAverage => 'Vente moyenne';

  @override
  String salesHistItemsLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'articles vendus',
      one: 'article vendu',
      zero: 'article vendu',
    );
    return '$_temp0';
  }

  @override
  String salesHistProfitPartial(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count lignes sans coût sont exclues',
      one: '1 ligne sans coût est exclue',
    );
    return '$_temp0';
  }

  @override
  String salesHistCollected(String amount) {
    return 'Crédit encaissé $amount';
  }

  @override
  String salesHistVoidedCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ventes annulées, non comptées',
      one: '1 vente annulée, non comptée',
    );
    return '$_temp0';
  }

  @override
  String salesHistChartTitle(String kind) {
    String _temp0 = intl.Intl.selectLogic(kind, {
      'day': 'Par heure',
      'week': 'Par jour',
      'month': 'Par jour',
      'other': 'Par mois',
    });
    return '$_temp0';
  }

  @override
  String get salesHistChartHint => 'Touchez une barre pour voir son montant.';

  @override
  String salesHistBarValue(String label, String amount) {
    return '$label : $amount';
  }

  @override
  String get salesHistOpenDay => 'Voir ce jour';

  @override
  String get salesHistOpenMonth => 'Voir ce mois';

  @override
  String get salesHistByStore => 'Par magasin';

  @override
  String get salesHistBySeller => 'Par vendeur';

  @override
  String get salesHistByPayment => 'Par paiement';

  @override
  String get salesHistTopProducts => 'Meilleurs produits';

  @override
  String get salesHistTopBrands => 'Meilleures marques';

  @override
  String get salesHistTopCategories => 'Meilleures catégories';

  @override
  String salesHistSalesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count ventes',
      one: '1 vente',
    );
    return '$_temp0';
  }

  @override
  String salesHistPieces(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count vendus',
      one: '1 vendu',
    );
    return '$_temp0';
  }

  @override
  String get salesHistNoStore => 'Sans magasin';

  @override
  String get salesHistUnknownPerson => 'Personne inconnue';

  @override
  String get salesHistTimelineTitle => 'Ce qui s\'est passé';

  @override
  String salesHistMoreLines(String name, int count) {
    return '$name + $count autres';
  }

  @override
  String get salesHistEventSaleFallback => 'Vente';

  @override
  String get salesHistEventVoided => 'Vente annulée';

  @override
  String get salesHistEventPayment => 'Paiement de crédit';

  @override
  String get salesHistEventReverted => 'Paiement de crédit annulé';

  @override
  String salesHistEventAdded(String item) {
    return 'Stock ajouté : $item';
  }

  @override
  String salesHistEventSet(String item) {
    return 'Comptage : $item';
  }

  @override
  String salesHistEventMoved(String item) {
    return 'Stock déplacé : $item';
  }

  @override
  String get salesHistUnknownItem => 'Un produit';

  @override
  String get salesHistVoidedTag => 'Annulée';

  @override
  String salesHistByPerson(String name) {
    return 'par $name';
  }

  @override
  String salesHistCountNow(int count) {
    return 'maintenant $count';
  }

  @override
  String get salesHistEmpty => 'Aucune vente sur cette période';

  @override
  String get salesHistEmptyHint =>
      'Choisissez un autre jour, une autre semaine, un autre mois ou une autre année.';

  @override
  String salesHistTruncated(String count) {
    return 'Affichage des $count premiers enregistrements de cette période (les plus récents). Choisissez une période plus courte pour tout voir.';
  }

  @override
  String get salesHistPartial =>
      'Une partie de l\'activité n\'a pas pu être chargée : des mouvements de stock, des paiements de crédit ou des annulations plus anciennes peuvent manquer.';

  @override
  String get salesHistLoadFailed =>
      'Impossible de charger cette période. Vérifiez la connexion et réessayez.';

  @override
  String get salesHistNothingHappened =>
      'Rien ne s\'est passé sur cette période.';

  @override
  String get zelleCheckButton => 'Vérifier Zelle';

  @override
  String get zelleCheckTitle => 'Vérification Zelle';

  @override
  String zelleCheckSubtitle(String amount) {
    return 'Recherche d\'exactement $amount sur le compte de l\'entreprise';
  }

  @override
  String get zelleChecking => 'Vérification auprès de la banque…';

  @override
  String zelleReceivedAmount(String amount) {
    return 'Reçu ✓ $amount';
  }

  @override
  String zelleDepositedIn(String bank) {
    return 'Déposé sur $bank';
  }

  @override
  String get zelleAlreadyConfirmed => 'Déjà confirmé auprès de la banque.';

  @override
  String get zelleNotFoundTitle => 'Pas encore arrivé sur le compte';

  @override
  String zelleNotFoundHint(String amount) {
    return 'Aucun dépôt d\'exactement $amount pour l\'instant. Un Zelle peut mettre quelques minutes à arriver.';
  }

  @override
  String zelleRetryIn(int seconds) {
    return 'Nouvelle vérification dans $seconds s';
  }

  @override
  String get zelleRetryStop => 'Arrêter';

  @override
  String get zelleRetryStopped => 'Vérifications automatiques arrêtées.';

  @override
  String get zelleRetryExhausted =>
      'Toujours rien après 3 minutes. Demandez au client de confirmer l\'envoi, puis vérifiez à nouveau.';

  @override
  String get zelleCheckAgain => 'Vérifier à nouveau';

  @override
  String zelleChooseTitle(String amount) {
    return 'Plusieurs dépôts de $amount';
  }

  @override
  String get zelleChooseHint =>
      'Choisissez celui de ce client, d\'après le nom de l\'expéditeur.';

  @override
  String get zelleUnknownSender => 'Expéditeur non indiqué';

  @override
  String get zelleNotConnectedTitle => 'Banque non connectée';

  @override
  String get zelleNotConnectedStaff =>
      'Demandez au propriétaire de connecter la banque de l\'entreprise, puis vérifiez à nouveau.';

  @override
  String get zelleNotConnectedOwner =>
      'Connectez la banque qui reçoit les Zelle pour que votre équipe puisse vérifier les paiements.';

  @override
  String get zelleConnectBank => 'Connecter la banque';

  @override
  String get zelleNeedsReauthTitle => 'Reconnexion bancaire requise';

  @override
  String get zelleNeedsReauthStaff =>
      'La banque demande au propriétaire de se reconnecter. Prévenez-le, puis vérifiez à nouveau.';

  @override
  String get zelleNeedsReauthOwner =>
      'Votre banque vous demande de vous reconnecter avant de pouvoir vérifier les paiements.';

  @override
  String get zelleReconnect => 'Reconnecter';

  @override
  String get zelleChipConfirmed => 'Banque ✓';

  @override
  String get zelleFailNotZelle =>
      'Ce paiement n\'a pas été enregistré comme Zelle.';

  @override
  String get zelleFailRecordNotFound => 'Ce paiement est introuvable.';

  @override
  String get zelleFailRecordVoided =>
      'Ce paiement a été annulé : il n\'y a rien à vérifier.';

  @override
  String get zelleFailOwnerRequired =>
      'Seul le propriétaire de l\'entreprise peut connecter ou modifier la banque.';

  @override
  String get zelleFailWindowInvalid => 'Choisissez entre 2 et 60 minutes.';

  @override
  String get zelleFailNetwork =>
      'Pas de connexion. Vérifiez la connexion et réessayez.';

  @override
  String get zelleFailUnreadable =>
      'La vérification n\'a pas donné de réponse claire. Réessayez.';

  @override
  String get bankZelleTitle => 'Banque pour vérifier les Zelle';

  @override
  String get bankZelleSubtitle =>
      'Permettre à votre équipe de confirmer les Zelle reçus';

  @override
  String get bankZelleIntro =>
      'Connectez le compte qui reçoit les Zelle. Votre équipe pourra confirmer qu\'un paiement est arrivé, sans jamais voir votre solde ni vos autres opérations.';

  @override
  String get bankStatusActive => 'Connectée';

  @override
  String get bankStatusNeedsReauth => 'Reconnexion requise';

  @override
  String get bankStatusDisconnected => 'Non connectée';

  @override
  String get bankUnnamed => 'Votre banque';

  @override
  String bankLastSync(String when) {
    return 'Dernière synchronisation : $when';
  }

  @override
  String get bankNeverSynced => 'Pas encore synchronisée';

  @override
  String get bankNeedsReauthNote =>
      'Votre banque vous demande de vous reconnecter. D\'ici là, les vérifications Zelle ne fonctionneront pas.';

  @override
  String get bankWindowLabel => 'Chercher les dépôts sur';

  @override
  String bankWindowMinutes(int minutes) {
    return '$minutes min';
  }

  @override
  String get bankWindowHint =>
      'Délai maximal entre l\'arrivée d\'un Zelle et sa vérification.';

  @override
  String get bankWindowSaved => 'Durée enregistrée';

  @override
  String get bankDisconnect => 'Déconnecter la banque';

  @override
  String get bankDisconnectTitle => 'Déconnecter la banque ?';

  @override
  String get bankDisconnectMessage =>
      'Votre équipe ne pourra plus vérifier les paiements Zelle tant que vous ne reconnectez pas la banque. Les paiements déjà confirmés le restent.';

  @override
  String get bankDisconnectedDone => 'Banque déconnectée';

  @override
  String get bankConnectedDone => 'Banque connectée';

  @override
  String get bankLinkFailed =>
      'La connexion bancaire n\'a pas abouti. Réessayez.';

  @override
  String get bankLoadFailed =>
      'Impossible de charger la connexion bancaire. Vérifiez la connexion et réessayez.';

  @override
  String get bankConnecting => 'Connexion…';

  @override
  String get zelleFailBankAccessDenied =>
      'La banque a refusé l\'accès. Le propriétaire doit reconnecter la banque.';

  @override
  String get zelleFailKindInvalid =>
      'Ce type de paiement ne peut pas être vérifié auprès de la banque.';

  @override
  String get zelleFailPlatformInvalid =>
      'Impossible de connecter une banque depuis cet appareil.';

  @override
  String get zelleFailNoDepositoryAccount =>
      'Choisissez un compte courant ou d\'épargne : c\'est là qu\'arrivent les Zelle.';

  @override
  String get zelleFailCandidateInvalid =>
      'Ce dépôt ne peut pas servir pour ce paiement. Vérifiez à nouveau.';

  @override
  String get zelleFailCandidateTaken =>
      'Quelqu\'un vient d\'associer ce dépôt à un autre paiement. La liste a été revérifiée.';

  @override
  String get zelleFailBankError => 'La banque n\'a pas répondu. Réessayez.';

  @override
  String get pcsKindPieces => 'Barils et cartons';

  @override
  String pcsPiecesTitle(int count) {
    return 'Colis ($count)';
  }

  @override
  String get pcsKindBarrel => 'Baril';

  @override
  String get pcsKindBox => 'Carton';

  @override
  String get pcsKindOther => 'Autre';

  @override
  String pcsKindLabel(int number) {
    return 'Ce qu\'est le colis $number';
  }

  @override
  String get pcsDescriptionOptional => 'Description (facultative)';

  @override
  String get pcsDescriptionWhat => 'Qu\'est-ce que c\'est ?';

  @override
  String get pcsPrice => 'Prix';

  @override
  String get pcsAddSize => 'Ajouter les dimensions (pouces)';

  @override
  String pcsRemovePiece(int number) {
    return 'Retirer le colis $number';
  }

  @override
  String get pcsAddPiece => 'Ajouter un autre colis';

  @override
  String pcsTotalLabel(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis · Total',
      one: '1 colis · Total',
    );
    return '$_temp0';
  }

  @override
  String get pcsNoPriceYet => 'Pas encore de prix';

  @override
  String pcsSaveAndPrint(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Enregistrer et imprimer $count étiquettes',
      one: 'Enregistrer et imprimer 1 étiquette',
    );
    return '$_temp0';
  }

  @override
  String get pcsSaveAndAnother =>
      'Enregistrer et en enregistrer un autre pour cet expéditeur';

  @override
  String get pcsSaveOnly => 'Enregistrer sans imprimer';

  @override
  String get pcsAnotherHint =>
      '« En enregistrer un autre » ne garde que l\'expéditeur, pour un autre destinataire ou pays.';

  @override
  String pcsBoxesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cartons',
      one: '1 carton',
    );
    return '$_temp0';
  }

  @override
  String pcsItemsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles',
      one: '1 article',
    );
    return '$_temp0';
  }

  @override
  String pcsPieceCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis',
      one: '1 colis',
    );
    return '$_temp0';
  }

  @override
  String get pcsErrPiecesRequired => 'Ajoutez au moins un colis.';

  @override
  String get pcsErrPiecesTooMany => 'Un envoi peut compter au plus 60 colis.';

  @override
  String get pcsErrKindInvalid =>
      'Indiquez ce qu\'est chaque colis : un baril, un carton ou autre chose.';

  @override
  String get pcsErrDescriptionRequired =>
      'Indiquez ce qu\'est chaque carton ou article.';

  @override
  String get pcsErrDescriptionTooLong =>
      'Limitez la description de chaque colis à 120 caractères.';

  @override
  String get pcsErrSizeInvalid =>
      'Saisissez la longueur, la largeur et la hauteur du colis en pouces, ou laissez les trois vides.';

  @override
  String get pcsErrPriceInvalid =>
      'Saisissez le prix de chaque colis en dollars, zéro ou plus.';

  @override
  String get pcsErrCountInvalid =>
      'Choisissez combien de colis partent : de 1 au nombre de colis de l\'envoi.';

  @override
  String get pcsErrLineHasParts =>
      'D\'autres parties de ce colis sont encore enregistrées. Retirez-les d\'abord.';

  @override
  String get pcsGoingIn => 'Colis qui partent';

  @override
  String pcsGoingOf(int going, int total) {
    return '$going sur $total';
  }

  @override
  String get pcsFewer => 'Moins de colis';

  @override
  String get pcsMore => 'Plus de colis';

  @override
  String pcsPreviewGoing(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis → ce conteneur',
      one: '1 colis → ce conteneur',
    );
    return '$_temp0';
  }

  @override
  String pcsPreviewStaying(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis restent en attente',
      one: '1 colis reste en attente',
    );
    return '$_temp0';
  }

  @override
  String get pcsSplitNote =>
      'Aucun message n\'est envoyé maintenant. Chaque partie reçoit ses propres messages de départ et de retrait. Imprimez de nouvelles étiquettes pour les colis qui restent.';

  @override
  String get pcsPrintPartsTitle =>
      'Imprimer les étiquettes des colis qui restent ?';

  @override
  String pcsPrintPartsMessage(int count, String codes) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$codes restent en attente avec de nouveaux codes : leurs anciennes étiquettes ne sont plus bonnes. Imprimez-en de nouvelles maintenant.',
      one:
          '$codes reste en attente avec un nouveau code : ses anciennes étiquettes ne sont plus bonnes. Imprimez-en de nouvelles maintenant.',
    );
    return '$_temp0';
  }

  @override
  String get pcsPrintPartsConfirm => 'Imprimer les étiquettes';

  @override
  String pcsPartLabelsSubtitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Étiquettes des $count parties qui restent en attente',
      one: 'Étiquettes de la partie qui reste en attente',
    );
    return '$_temp0';
  }

  @override
  String pcsGroupNote(int parts, String code) {
    return 'Le payé et le reste dû portent sur tout le colis ($parts parties). Les paiements sont enregistrés sur $code.';
  }

  @override
  String get pcsPartPriceHint =>
      'Le prix de cette partie seule. Un total modifié est réparti également sur ses colis.';

  @override
  String pcsPartOf(int index, String code) {
    return 'Partie $index de $code';
  }

  @override
  String get pcsTrackingPieces => 'Colis';

  @override
  String get pcsTrackingParts => 'Parties de ce colis';

  @override
  String get pcsTrackingPartsHint =>
      'Certains colis peuvent partir dans un conteneur suivant.';

  @override
  String get pcsTrackingMoney => 'Prix et paiements';

  @override
  String get pcsTrackingPrice => 'Prix final';

  @override
  String get pcsTrackingPaid => 'Payé';

  @override
  String get pcsTrackingBalance => 'Reste dû';

  @override
  String get prqSendPackage => 'Envoyer un colis';

  @override
  String get prqSendPackageSubtitle =>
      'Demandez à une entreprise et recevez une estimation';

  @override
  String get prqMyRequests => 'Mes demandes';

  @override
  String get prqMyRequestsSubtitle => 'Estimations et réponses des entreprises';

  @override
  String get prqSignInTitle => 'Connectez-vous pour envoyer une demande';

  @override
  String get prqSignInHint =>
      'Vos demandes et estimations sont gardées dans votre compte.';

  @override
  String get prqSignIn => 'Se connecter';

  @override
  String get prqRetry => 'Réessayer';

  @override
  String get prqCouldNotLoad =>
      'Chargement impossible. Vérifiez votre connexion et réessayez.';

  @override
  String get prqStepCountry => 'Où va-t-il ?';

  @override
  String get prqPickCountry => 'Choisissez un pays';

  @override
  String get prqSearchCountry => 'Rechercher un pays';

  @override
  String get prqStepBusiness => 'Qui s’en charge ?';

  @override
  String get prqNoBusinesses =>
      'Aucune entreprise ne prend encore de demandes pour ce pays.';

  @override
  String get prqNoOptions =>
      'Aucune entreprise ne prend de demandes d’envoi pour le moment.';

  @override
  String prqBusinessStopped(String name) {
    return '$name ne prend pas de demandes pour le moment.';
  }

  @override
  String prqBarrelPrice(String price) {
    return '$price par baril';
  }

  @override
  String get prqBarrelOnEstimate => 'Barils sur estimation';

  @override
  String get prqStepHandoff => 'Comment le leur remettre ?';

  @override
  String get prqBringIn => 'Je l’apporte';

  @override
  String get prqBringInNote => 'Je le dépose chez l’entreprise';

  @override
  String get prqCollect => 'Venez le chercher';

  @override
  String get prqCollectNote => 'L’entreprise vient le récupérer';

  @override
  String get prqUnavailableNote => 'Non proposé par cette entreprise';

  @override
  String get prqDropOffAt => 'Lieu de dépôt';

  @override
  String get prqPlannedDay => 'Jour où vous prévoyez de venir';

  @override
  String get prqPickDay => 'Choisissez un jour';

  @override
  String prqHoursOn(String from, String to) {
    return 'Ouvert de $from à $to ce jour-là. Venez à tout moment pendant ces heures.';
  }

  @override
  String get prqClosedThatDay => 'Fermé ce jour-là. Choisissez un autre jour.';

  @override
  String get prqPlanNote => 'C’est un projet, pas un rendez-vous.';

  @override
  String get prqPickupAddress => 'Adresse de ramassage';

  @override
  String get prqPickupDay => 'Jour souhaité';

  @override
  String get prqPickupWindow => 'Moment de la journée';

  @override
  String get prqWindowMorning => 'Matin';

  @override
  String get prqWindowAfternoon => 'Après-midi';

  @override
  String get prqWindowEvening => 'Soir';

  @override
  String get prqPickupNote => 'Note pour le chauffeur (facultatif)';

  @override
  String prqCollectAreas(String areas) {
    return 'Ramasse à : $areas';
  }

  @override
  String get prqCollectTimeNote =>
      'L’entreprise fixe l’heure exacte et les frais de ramassage éventuels dans son estimation.';

  @override
  String get prqSender => 'Vous (expéditeur)';

  @override
  String get prqSenderName => 'Votre nom';

  @override
  String get prqSenderPhone => 'Votre numéro WhatsApp';

  @override
  String get prqSenderPhoneHint => 'L’estimation arrive sur WhatsApp.';

  @override
  String get prqReceiver => 'Destinataire';

  @override
  String get prqReceiverName => 'Nom du destinataire';

  @override
  String get prqReceiverPhone => 'Téléphone du destinataire';

  @override
  String get prqPieces => 'Qu’envoyez-vous ?';

  @override
  String prqPieceN(int n) {
    return 'Colis $n';
  }

  @override
  String get prqKindBarrel => 'Baril';

  @override
  String get prqKindBox => 'Carton';

  @override
  String get prqKindOther => 'Autre';

  @override
  String get prqWhatIsIt => 'Qu’est-ce que c’est ?';

  @override
  String get prqWhatIsItHint => 'ex. télé, valise, carton de vêtements';

  @override
  String get prqBarrelInside => 'Contenu (facultatif)';

  @override
  String get prqAddPhoto => 'Ajouter une photo';

  @override
  String prqPhotosCount(int count, int max) {
    return 'Photos : $count sur $max';
  }

  @override
  String get prqTakePhoto => 'Prendre une photo';

  @override
  String get prqChoosePhoto => 'Choisir dans les photos';

  @override
  String get prqPhotoFailed => 'Échec de l’envoi. Touchez pour réessayer.';

  @override
  String get prqPhotoTooLarge =>
      'Cette photo est trop lourde. Essayez-en une autre.';

  @override
  String get prqPhotoNotImage =>
      'Seules les photos peuvent être ajoutées (JPEG, PNG ou WebP).';

  @override
  String get prqRemovePhoto => 'Retirer la photo';

  @override
  String get prqRemovePiece => 'Retirer ce colis';

  @override
  String get prqAddPiece => '+ Ajouter un autre colis';

  @override
  String get prqEstimateNoteBring =>
      'L’entreprise vous envoie une estimation sur WhatsApp avant toute décision. Vous payez au dépôt.';

  @override
  String get prqEstimateNoteCollect =>
      'L’entreprise vous envoie une estimation sur WhatsApp avant toute décision. Vous payez au ramassage.';

  @override
  String get prqSendRequest => 'Envoyer la demande';

  @override
  String get prqSending => 'Envoi…';

  @override
  String get prqWaitPhotos => 'Attendez la fin de l’envoi des photos.';

  @override
  String get prqFixErrors => 'Vérifiez les champs signalés.';

  @override
  String get prqSentTitle => 'Demande envoyée';

  @override
  String get prqSentCode => 'Votre code de demande';

  @override
  String prqSentTo(String business) {
    return 'Envoyée à $business';
  }

  @override
  String get prqNextSteps => 'La suite';

  @override
  String prqNext1(String business) {
    return '$business examine vos colis et vous envoie une estimation sur WhatsApp.';
  }

  @override
  String get prqNext1Ready =>
      'Votre estimation est déjà prête : ouvrez-la pour voir les prix.';

  @override
  String get prqNext2 =>
      'Ouvrez l’estimation et touchez Confirmer si elle vous convient.';

  @override
  String get prqNext3Bring =>
      'Apportez vos colis le jour prévu et payez sur place.';

  @override
  String get prqNext3Collect =>
      'L’entreprise récupère vos colis et vous payez à ce moment-là.';

  @override
  String get prqSeeRequest => 'Voir ma demande';

  @override
  String get prqMineEmptyTitle => 'Aucune demande pour l’instant';

  @override
  String get prqMineEmptyHint =>
      'Envoyez un colis pour obtenir une estimation d’une entreprise.';

  @override
  String get prqNewRequest => 'Nouvelle demande';

  @override
  String get prqStatusNew => 'Estimation en attente';

  @override
  String get prqStatusEstimateSent => 'Estimation prête';

  @override
  String get prqStatusConfirmed => 'Confirmée';

  @override
  String get prqStatusReceived => 'Reçue';

  @override
  String get prqStatusDeclined => 'Refusée';

  @override
  String get prqStatusYouDeclined => 'Vous avez refusé';

  @override
  String get prqStatusCustomerDeclined => 'Le client a refusé';

  @override
  String get prqStatusCancelled => 'Annulée';

  @override
  String get prqStatusExpired => 'Expirée';

  @override
  String prqDetailTitle(String code) {
    return 'Demande $code';
  }

  @override
  String prqStateWaiting(String business) {
    return '$business prépare votre estimation.';
  }

  @override
  String get prqStateWaitingHint => 'Vous la recevrez sur WhatsApp et ici.';

  @override
  String get prqStateAwaiting => 'Votre estimation est prête';

  @override
  String get prqStateAwaitingHint =>
      'Confirmez-la si elle vous convient. Rien n’est payé maintenant.';

  @override
  String get prqStateConfirmed => 'Vous avez confirmé cette estimation';

  @override
  String prqStateConfirmedByPhone(String business) {
    return 'Confirmée par téléphone avec $business';
  }

  @override
  String get prqPriceDropped =>
      'Le prix a baissé depuis votre confirmation. Rien d’autre à faire.';

  @override
  String prqStateReceived(String business) {
    return '$business a reçu vos colis';
  }

  @override
  String prqTrackingCode(String code) {
    return 'Code de suivi $code';
  }

  @override
  String get prqTrack => 'Suivre';

  @override
  String prqStateDeclined(String business) {
    return '$business a refusé cette demande';
  }

  @override
  String prqStateCancelled(String business) {
    return '$business a annulé cette demande';
  }

  @override
  String prqReason(String reason) {
    return 'Motif : $reason';
  }

  @override
  String get prqStateCustomerDeclined => 'Vous avez refusé cette estimation';

  @override
  String get prqStateExpired => 'Cette demande a expiré';

  @override
  String get prqStateExpiredHint =>
      'Envoyez une nouvelle demande si vous avez encore besoin d’expédier.';

  @override
  String get prqChangedBanner =>
      'Cette estimation a changé — voyez la nouvelle ci-dessous.';

  @override
  String prqAnswerBy(String date) {
    return 'Répondez avant le $date';
  }

  @override
  String get prqConfirm => 'Confirmer';

  @override
  String get prqNoThanks => 'Non merci';

  @override
  String get prqNoThanksTitle => 'Refuser cette estimation ?';

  @override
  String get prqNoThanksMessage =>
      'L’entreprise en est informée. Vous pouvez dire pourquoi (facultatif).';

  @override
  String get prqReasonOptional => 'Motif (facultatif)';

  @override
  String get prqConfirmedDone => 'Estimation confirmée.';

  @override
  String get prqAlreadyConfirmed =>
      'Vous aviez déjà confirmé cette estimation.';

  @override
  String get prqDeclinedDone => 'C’est fait. L’entreprise est informée.';

  @override
  String get prqTotal => 'Total';

  @override
  String get prqPickupFee => 'Frais de ramassage';

  @override
  String get prqPriceToCome => 'Prix à venir';

  @override
  String get prqWhereWhen => 'Où et quand';

  @override
  String get prqBringTo => 'À déposer à';

  @override
  String prqPlannedFor(String day) {
    return 'Prévu le $day';
  }

  @override
  String get prqPickupAt => 'Ramassage à';

  @override
  String prqDayWindow(String day, String window) {
    return '$day, $window';
  }

  @override
  String prqCallBusiness(String business) {
    return 'Appeler $business';
  }

  @override
  String get prqBusinessNote => 'Note de l’entreprise';

  @override
  String get prqPayAtDropOff => 'Vous payez au dépôt.';

  @override
  String get prqPayAtPickup => 'Vous payez au ramassage.';

  @override
  String get prqNotBinding =>
      'Le prix final est fixé quand l’entreprise voit vos colis.';

  @override
  String prqToReceiver(String name, String country) {
    return 'Pour $name · $country';
  }

  @override
  String prqBarrelsCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count barils',
      one: '1 baril',
    );
    return '$_temp0';
  }

  @override
  String prqBoxesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count cartons',
      one: '1 carton',
    );
    return '$_temp0';
  }

  @override
  String prqOthersCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count autres articles',
      one: '1 autre article',
    );
    return '$_temp0';
  }

  @override
  String prqPiecesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis',
      one: '1 colis',
    );
    return '$_temp0';
  }

  @override
  String get prqRequestsTitle => 'Demandes';

  @override
  String prqEntryCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count demandes ouvertes',
      one: '1 demande ouverte',
      zero: 'Aucune demande ouverte',
    );
    return '$_temp0';
  }

  @override
  String get prqEntryHint => 'Les clients demandent, vous envoyez l’estimation';

  @override
  String prqChipNeedsEstimate(int count) {
    return 'À estimer · $count';
  }

  @override
  String prqChipWaitingCustomer(int count) {
    return 'En attente du client · $count';
  }

  @override
  String get prqEmptyNeedsEstimate => 'Rien à estimer';

  @override
  String get prqEmptyWaiting => 'Aucune estimation en attente de réponse';

  @override
  String get prqEmptyHint => 'Les demandes de vos clients apparaissent ici.';

  @override
  String prqBringsItOn(String day) {
    return 'L’apporte le $day';
  }

  @override
  String prqCollectOn(String day, String window) {
    return 'Ramassage $day, $window';
  }

  @override
  String get prqNoDay => 'Aucun jour indiqué';

  @override
  String prqLockedBy(String name) {
    return '$name rédige l’estimation';
  }

  @override
  String get prqAgreedByPhone => 'Le client a accepté par téléphone';

  @override
  String get prqAgreedByPhoneTitle => 'Le client a accepté par téléphone ?';

  @override
  String prqAgreedByPhoneMessage(int version, String total) {
    return 'Cela confirme la version $version de l’estimation ($total) pour le client. L’historique indique que c’est vous.';
  }

  @override
  String get prqAgreedDone => 'Confirmée pour le client.';

  @override
  String get prqNotReachable => 'Client injoignable sur WhatsApp';

  @override
  String prqSentOn(String date) {
    return 'Envoyée le $date';
  }

  @override
  String prqEstimateTotal(String total) {
    return 'Estimation $total';
  }

  @override
  String get prqSettings => 'Réglages des demandes';

  @override
  String get prqCustomer => 'Client';

  @override
  String get prqEstimateTitle => 'Estimation';

  @override
  String get prqLockMine =>
      'Vous rédigez cette estimation. Les autres la voient verrouillée.';

  @override
  String prqLockOther(String name, String time) {
    return '$name rédige l’estimation jusqu’à $time. Vous pouvez la lire.';
  }

  @override
  String prqLockLapsed(String name) {
    return '$name a cessé d’écrire. Vous pouvez reprendre.';
  }

  @override
  String get prqTakeOver => 'Reprendre';

  @override
  String get prqLockLost => 'Quelqu’un d’autre a repris cette estimation.';

  @override
  String get prqStaleBanner => 'Cette demande a changé pendant votre saisie.';

  @override
  String get prqRefresh => 'Actualiser';

  @override
  String get prqPriceField => 'Prix (\$)';

  @override
  String get prqPriceRequired => 'Indiquez un prix.';

  @override
  String get prqPriceInvalid => 'Indiquez un montant comme 45 ou 45,50.';

  @override
  String get prqPickupFeeField => 'Frais de ramassage (\$, facultatif)';

  @override
  String get prqPickupScheduleDay => 'Jour de ramassage prévu';

  @override
  String get prqNoteToCustomer => 'Note au client (facultatif)';

  @override
  String get prqSendEstimate => 'Envoyer l’estimation sur WhatsApp';

  @override
  String get prqEstimateSentDone => 'Estimation envoyée.';

  @override
  String get prqEstimateReconfirm =>
      'Estimation envoyée. Le total a augmenté : le client doit confirmer à nouveau.';

  @override
  String get prqEstimatePriceDropped =>
      'Estimation envoyée. Le total a baissé ; la demande reste confirmée.';

  @override
  String get prqDecline => 'Refuser la demande';

  @override
  String get prqDeclineTitle => 'Refuser cette demande ?';

  @override
  String get prqDeclineMessage => 'Le client voit votre motif sur sa demande.';

  @override
  String get prqReasonLabel => 'Motif';

  @override
  String get prqDeclined => 'Demande refusée.';

  @override
  String prqPhotoOf(int n, int count) {
    return 'Photo $n sur $count';
  }

  @override
  String get prqAutoEstimate => 'Prix des barils envoyé automatiquement';

  @override
  String prqVersionBy(int version, String name) {
    return 'Version $version · $name';
  }

  @override
  String get prqClosed => 'Cette demande est close.';

  @override
  String get prqActSubmitted => 'Envoyée par le client';

  @override
  String prqActEstimateSent(int version, String total) {
    return 'Estimation v$version envoyée · $total';
  }

  @override
  String get prqActConfirmedLink => 'Le client a confirmé';

  @override
  String get prqActConfirmedPhone => 'Confirmée par téléphone';

  @override
  String get prqActConfirmedCard => 'Payée en ligne par carte';

  @override
  String get prqActCustomerDeclined => 'Le client a refusé';

  @override
  String get prqActDeclined => 'Refusée';

  @override
  String get prqActCancelled => 'Annulée';

  @override
  String get prqActExpired => 'Expirée';

  @override
  String get prqActReceived => 'Reçue';

  @override
  String get prqActLockTakenOver => 'A repris l’estimation';

  @override
  String get prqActReminderSent => 'Rappel envoyé';

  @override
  String get prqActOther => 'Mise à jour';

  @override
  String prqExpectedTitle(int count) {
    return 'Attendus · $count';
  }

  @override
  String prqInShopTitle(int count) {
    return 'En boutique · $count';
  }

  @override
  String get prqReceived => 'Reçu';

  @override
  String get prqPickedUpReceived => 'Ramassé · Reçu';

  @override
  String get prqCancelRequest => 'Annuler la demande';

  @override
  String get prqCancelTitle => 'Annuler cette demande ?';

  @override
  String get prqCancelMessage => 'Le client voit votre motif sur sa demande.';

  @override
  String get prqCancelledDone => 'Demande annulée.';

  @override
  String get prqPaidOnline => 'Payé en ligne';

  @override
  String prqPlannedDayShort(String day) {
    return 'Prévu le $day';
  }

  @override
  String get prqReceiveTitle => 'Colis reçus';

  @override
  String prqReceiveSubtitle(String code) {
    return '$code · confirmez le prix final de chaque colis';
  }

  @override
  String get prqFinalPrice => 'Prix final (\$)';

  @override
  String get prqPriceAllOrNone =>
      'Indiquez le prix de chaque colis, ou d’aucun.';

  @override
  String prqLineTotal(String total) {
    return 'Total $total';
  }

  @override
  String get prqReceiveAndPrint => 'Reçu · imprimer les étiquettes';

  @override
  String get prqSaving => 'Enregistrement…';

  @override
  String prqReceivedDone(String code) {
    return 'Reçu. Code de suivi $code.';
  }

  @override
  String prqAlreadyReceived(String code) {
    return 'Déjà reçu sous $code.';
  }

  @override
  String prqPaidOnlineNote(String amount) {
    return 'Payé en ligne par carte : $amount. Aucun paiement à encaisser.';
  }

  @override
  String get prqDescriptionField => 'Description';

  @override
  String get prqPayOnArrivalSwitch => 'Le destinataire paie à l’arrivée';

  @override
  String get prqSettingsTitle => 'Demandes d’envoi';

  @override
  String get prqAccept => 'Accepter les demandes d’envoi';

  @override
  String get prqAcceptNote =>
      'Les clients peuvent vous envoyer des demandes depuis le site et l’appli.';

  @override
  String get prqLinkTitle => 'Votre lien de demande';

  @override
  String get prqLinkNone => 'Enregistrez une fois pour obtenir votre lien.';

  @override
  String get prqCopy => 'Copier';

  @override
  String get prqCopied => 'Lien copié.';

  @override
  String get prqShare => 'Partager';

  @override
  String get prqShowQr => 'Code QR';

  @override
  String get prqQrHint =>
      'Imprimez-le pour votre comptoir. Il ouvre votre formulaire de demande.';

  @override
  String get prqSlugField => 'Nom du lien';

  @override
  String get prqSlugHint =>
      'Lettres minuscules, chiffres et tirets. Modifiable une seule fois.';

  @override
  String get prqSlugLocked => 'Le nom du lien a déjà été modifié une fois.';

  @override
  String get prqHoursTitle => 'Heures d’ouverture';

  @override
  String get prqHoursHint =>
      'Les clients apportent leurs colis pendant ces heures. Un lieu sans jour ouvert n’est pas proposé pour le dépôt.';

  @override
  String get prqHeadquarters => 'Adresse principale';

  @override
  String get prqDayClosed => 'Fermé';

  @override
  String prqHoursRange(String from, String to) {
    return '$from – $to';
  }

  @override
  String get prqPickupSettingsTitle => 'Nous ramassons';

  @override
  String get prqPickupSettingsNote =>
      'Proposez « Venez le chercher » aux clients des zones que vous couvrez.';

  @override
  String get prqAreas => 'Zones couvertes';

  @override
  String get prqAreasHint => 'ex. Bronx, Harlem, Newark';

  @override
  String get prqCardBarrels => 'Paiement par carte pour les barils';

  @override
  String get prqCardBarrelsNote =>
      'Les clients peuvent payer les barils en ligne ; ces commandes apparaissent comme attendues et payées en ligne.';

  @override
  String get prqSaved => 'Réglages enregistrés.';

  @override
  String get prqOwnerOnly => 'Seul le propriétaire peut modifier ces réglages.';

  @override
  String get prqErrBusinessNotFound =>
      'Ce lien de demande ne correspond à aucune entreprise.';

  @override
  String get prqErrBusinessUnavailable =>
      'Cette entreprise ne peut pas prendre de demandes pour le moment.';

  @override
  String get prqErrRequestsOff => 'Cette entreprise ne prend plus de demandes.';

  @override
  String get prqErrDestinationUnavailable =>
      'Cette entreprise n’expédie plus vers ce pays.';

  @override
  String get prqErrBringInUnavailable =>
      'Cette entreprise ne propose plus le dépôt.';

  @override
  String get prqErrCollectUnavailable =>
      'Cette entreprise ne propose plus le ramassage.';

  @override
  String get prqErrHandoff => 'Choisissez Je l’apporte ou Venez le chercher.';

  @override
  String get prqErrLocation => 'Choisissez un lieu de dépôt.';

  @override
  String get prqErrPlannedDate =>
      'Choisissez un jour entre aujourd’hui et dans 60 jours.';

  @override
  String get prqErrPlannedDayClosed => 'L’entreprise est fermée ce jour-là.';

  @override
  String get prqErrPickupAddress => 'Indiquez l’adresse de ramassage.';

  @override
  String get prqErrPickupDate =>
      'Choisissez un jour de ramassage entre aujourd’hui et dans 60 jours.';

  @override
  String get prqErrPickupWindow => 'Choisissez matin, après-midi ou soir.';

  @override
  String get prqErrSenderName => 'Indiquez votre nom.';

  @override
  String get prqErrSenderPhone =>
      'Indiquez votre numéro WhatsApp avec l’indicatif du pays.';

  @override
  String get prqErrReceiverName => 'Indiquez le nom du destinataire.';

  @override
  String get prqErrReceiverPhone =>
      'Indiquez le téléphone du destinataire avec l’indicatif du pays.';

  @override
  String get prqErrPiecesRequired => 'Ajoutez au moins un colis.';

  @override
  String get prqErrTooManyPieces => '20 colis au maximum par demande.';

  @override
  String get prqErrPieceKind =>
      'Choisissez baril, carton ou autre pour chaque colis.';

  @override
  String get prqErrPieceDescription => 'Dites ce que c’est.';

  @override
  String get prqErrTextTooLong => 'Un texte est trop long. Raccourcissez-le.';

  @override
  String get prqErrTooManyPhotos => '5 photos au maximum par colis.';

  @override
  String get prqErrPhotoInvalid =>
      'Une photo n’a pas pu être utilisée. Retirez-la et ajoutez-la de nouveau.';

  @override
  String get prqErrRateLimited =>
      'Trop de demandes en peu de temps. Réessayez dans une heure.';

  @override
  String get prqErrNotFound => 'Cette demande est introuvable.';

  @override
  String get prqErrEstimateMissing =>
      'Il n’y a pas encore d’estimation à confirmer.';

  @override
  String get prqErrCardOrder =>
      'Cette commande a été payée par carte. Annulez-la ou remboursez-la depuis sa commande de baril.';

  @override
  String get prqErrSlugInvalid =>
      'Utilisez 3 à 40 lettres minuscules, chiffres ou tirets.';

  @override
  String get prqErrSlugTaken =>
      'Ce nom de lien est déjà pris. Essayez-en un autre.';

  @override
  String get prqErrHoursInvalid =>
      'Chaque jour ouvert doit avoir une heure de début avant l’heure de fin.';

  @override
  String get prqErrLocationUnknown =>
      'Un des lieux n’existe plus. Rechargez et réessayez.';

  @override
  String get prqErrPickupAreas => 'Indiquez les zones que vous couvrez.';

  @override
  String get prqErrLocked => 'Quelqu’un d’autre rédige cette estimation.';

  @override
  String get prqErrPieceMissing => 'Chaque colis doit avoir un prix.';

  @override
  String get prqErrPieceUnknown =>
      'Les colis ont changé. Actualisez et réessayez.';

  @override
  String get prqErrPickupFee => 'Indiquez des frais de ramassage valides.';

  @override
  String get prqErrPickupSchedule => 'Choisissez un jour de ramassage valide.';

  @override
  String get prqErrReasonRequired => 'Indiquez un motif.';

  @override
  String get prqErrOffline =>
      'Vous êtes hors ligne. Vérifiez votre connexion et réessayez.';

  @override
  String get prqErrAppCheck =>
      'L’appli n’a pas pu être vérifiée. Réessayez dans un instant.';

  @override
  String get prqErrPermission => 'Vous n’avez pas accès à cela.';

  @override
  String get prqErrGeneric => 'Cela n’a pas fonctionné. Réessayez.';

  @override
  String get wpkErrPriceBelowPickupFee =>
      'Le prix ne peut pas être inférieur aux frais de ramassage.';

  @override
  String wpkIncludesPickupFee(String amount) {
    return 'Comprend les frais de ramassage : $amount';
  }

  @override
  String get wpkGroupLoading => 'Chargement du solde du colis complet…';

  @override
  String get lotBusinessOwner => 'Propriétaire de l’entreprise';

  @override
  String get lotUnnamedPerson => 'Membre de l’équipe';

  @override
  String prqPickupNoteLine(String note) {
    return 'Note : $note';
  }

  @override
  String get invTrTitle => 'Transferts';

  @override
  String get invTrNew => 'Nouveau transfert';

  @override
  String get invTrNotifications => 'Transferts entre magasins';

  @override
  String get invTrSendToStore => 'Envoyer à un autre magasin';

  @override
  String get invTrNeedsStores =>
      'Les transferts demandent au moins deux magasins.';

  @override
  String get invTrEntryHint => 'Envoyer du stock à un autre magasin';

  @override
  String invTrEntryCounts(int incoming, int review) {
    return 'Entrants $incoming · À revoir $review';
  }

  @override
  String get invTrTabOutgoing => 'Sortants';

  @override
  String get invTrTabIncoming => 'Entrants';

  @override
  String get invTrTabInTransit => 'En route';

  @override
  String get invTrTabReview => 'À revoir';

  @override
  String get invTrEmptyOutgoing => 'Rien n’est encore parti d’ici.';

  @override
  String get invTrEmptyIncoming => 'Rien n’est en route vers ici.';

  @override
  String get invTrEmptyInTransit => 'Rien en route.';

  @override
  String get invTrEmptyReview => 'Rien à revoir.';

  @override
  String get invTrEmptyHint =>
      'Envoyez du stock à un autre magasin avec Nouveau transfert.';

  @override
  String get invTrIncomingHint =>
      'Quelque chose arrive ? C’est dans Entrants. Ouvrez-le et touchez Confirmer la réception.';

  @override
  String get invTrLoadFailed => 'Impossible de charger les transferts.';

  @override
  String get invTrNotAvailable => 'Ce transfert n’est pas disponible.';

  @override
  String invTrItems(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles',
      one: '1 article',
    );
    return '$_temp0';
  }

  @override
  String invTrProducts(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count produits',
      one: '1 produit',
    );
    return '$_temp0';
  }

  @override
  String get invTrNotSent => 'pas envoyé · rien n’est réservé';

  @override
  String invTrSentOnBy(String date, String name) {
    return 'envoyé le $date par $name';
  }

  @override
  String invTrReceivedOf(int received, int sent) {
    return '$received sur $sent reçus';
  }

  @override
  String invTrMissingN(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count manquants',
      one: '1 manquant',
    );
    return '$_temp0';
  }

  @override
  String invTrOnBy(String date, String name) {
    return 'le $date par $name';
  }

  @override
  String invTrCancelledOnBy(String date, String name) {
    return 'annulé le $date par $name';
  }

  @override
  String get invTrStateDraft => 'Brouillon';

  @override
  String get invTrStateInTransit => 'En route';

  @override
  String invTrStateLate(int days) {
    return 'En route depuis $days jours';
  }

  @override
  String get invTrStateReview => 'À revoir';

  @override
  String get invTrStateReceived => 'Reçu';

  @override
  String get invTrStateSettled => 'Réglé';

  @override
  String get invTrStateCancelled => 'Annulé';

  @override
  String get invTrResultComplete => 'Complet';

  @override
  String invTrResultDisputed(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count manquants · en litige',
      one: '1 manquant · en litige',
    );
    return '$_temp0';
  }

  @override
  String invTrResultReturned(int count, String store) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count rendus à $store',
      one: '1 rendu à $store',
    );
    return '$_temp0';
  }

  @override
  String invTrResultWrittenOff(int count, String reason) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count passés en perte · $reason',
      one: '1 passé en perte · $reason',
    );
    return '$_temp0';
  }

  @override
  String get invTrReasonLost => 'Perdu en route';

  @override
  String get invTrReasonDamaged => 'Abîmé';

  @override
  String get invTrReasonStolen => 'Volé';

  @override
  String get invTrReasonOther => 'Autre';

  @override
  String invTrEvDraftCreated(String name) {
    return 'Brouillon commencé par $name';
  }

  @override
  String invTrEvSent(String name, String items) {
    return 'Envoyé par $name ($items)';
  }

  @override
  String invTrEvCancelled(String name, String items, String store) {
    return 'Annulé par $name : $items de retour à $store';
  }

  @override
  String invTrEvDiscarded(String name) {
    return 'Brouillon supprimé par $name';
  }

  @override
  String invTrEvReceivedAll(String name, int count) {
    return '$name a confirmé la réception des $count';
  }

  @override
  String invTrEvReceivedShort(String name, int received, int missing) {
    return '$name a confirmé $received reçus, $missing manquants';
  }

  @override
  String invTrEvReturned(String name, int count, String product, String store) {
    return '$name a rendu $count de $product à $store';
  }

  @override
  String invTrEvWrittenOff(
    String name,
    int count,
    String product,
    String reason,
  ) {
    return '$name a passé en perte $count de $product : $reason';
  }

  @override
  String get invTrNoTimeline => 'Rien d’enregistré pour l’instant.';

  @override
  String get invTrTrackRecord => 'Historique';

  @override
  String invTrSummaryInTransit(String amount) {
    return 'En route $amount';
  }

  @override
  String invTrSummaryDisputed(String amount) {
    return 'En litige $amount';
  }

  @override
  String get invTrMoveInstant => 'Transfert immédiat';

  @override
  String get invTrMoveSent => 'Envoyé par transfert';

  @override
  String get invTrMoveReceived => 'Reçu par transfert';

  @override
  String get invTrMoveCancelled => 'Transfert annulé';

  @override
  String get invTrMoveReturned => 'Rendu après un transfert';

  @override
  String get invTrMoveWrittenOff => 'Passé en perte (transfert)';

  @override
  String get invTrChooseStore => 'Choisir un magasin';

  @override
  String get invTrAddProductHint => 'Ajouter un produit par son nom';

  @override
  String get invTrScanTooltip => 'Scanner une étiquette';

  @override
  String get invTrScanTitle => 'Scanner l’étiquette d’un produit';

  @override
  String invTrInStore(int count, String store) {
    return '$count à $store';
  }

  @override
  String invTrOnlyInStore(int count, String store) {
    return 'Seulement $count à $store';
  }

  @override
  String invTrNoneInStore(String product, String store) {
    return '$product : aucun à $store.';
  }

  @override
  String get invTrAllOfThem =>
      'C’est tout le stock. Vous ne pouvez pas envoyer plus que ce que le magasin a.';

  @override
  String get invTrNoProductsYet =>
      'Aucun produit pour l’instant. Ajoutez-les par leur nom ou scannez leur étiquette.';

  @override
  String get invTrRemoveLine => 'Retirer';

  @override
  String get invTrLess => 'Un de moins';

  @override
  String get invTrMore => 'Un de plus';

  @override
  String get invTrOwnerNotified => 'Le propriétaire est prévenu à l’envoi.';

  @override
  String get invTrSaveDraft => 'Enregistrer le brouillon';

  @override
  String invTrSend(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Envoyer $count articles',
      one: 'Envoyer 1 article',
      zero: 'Envoyer',
    );
    return '$_temp0';
  }

  @override
  String get invTrSending => 'Envoi…';

  @override
  String get invTrDraftSaved =>
      'Brouillon enregistré. Rien n’est réservé avant l’envoi.';

  @override
  String get invTrErrTo => 'Choisissez le magasin de destination.';

  @override
  String get invTrErrOverMax =>
      'Un produit dépasse ce que le magasin possède. Baissez-le pour envoyer.';

  @override
  String get invTrContinue => 'Continuer';

  @override
  String get invTrSentTitle => 'Transfert envoyé';

  @override
  String invTrSentTo(String store) {
    return 'Envoyé à $store';
  }

  @override
  String invTrSentBody(int count, String store) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          '$count articles sont en route. L’équipe de $store a reçu une notification et confirmera leur arrivée.',
      one:
          '1 article est en route. L’équipe de $store a reçu une notification et confirmera son arrivée.',
    );
    return '$_temp0';
  }

  @override
  String invTrSentNote(String store) {
    return 'Tant que $store n’a pas confirmé, ces articles ne peuvent être vendus dans aucun des deux magasins. Une erreur ? Vous pouvez annuler jusqu’à la confirmation de $store.';
  }

  @override
  String get invTrDone => 'Terminé';

  @override
  String get invTrReceiveTitle => 'Recevoir le transfert';

  @override
  String invTrIncomingAt(String store) {
    return '$store · entrant';
  }

  @override
  String invTrItemsFrom(int count, String store) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles de $store',
      one: '1 article de $store',
    );
    return '$_temp0';
  }

  @override
  String get invTrReceiveHelp =>
      'Vérifiez le carton avec cette liste. Si un nombre est différent, changez-le avant de confirmer.';

  @override
  String invTrSentQty(int count) {
    return 'Envoyés $count';
  }

  @override
  String invTrFewer(int count) {
    return '$count de moins qu’envoyé';
  }

  @override
  String invTrReceiveFooter(String store) {
    return 'Une fois confirmés, ces articles peuvent être vendus à $store. Besoin d’étiquettes ? Imprimez-les depuis le produit quand vous le mettez en rayon.';
  }

  @override
  String invTrArrivedOf(int arrived, int sent) {
    return '$arrived sur $sent arrivés';
  }

  @override
  String get invTrConfirmReceived => 'Confirmer la réception';

  @override
  String get invTrConfirming => 'Confirmation…';

  @override
  String invTrReceivedDone(String store) {
    return 'Reçu. Ces articles peuvent maintenant être vendus à $store.';
  }

  @override
  String get invTrReceivedDoneMissing =>
      'Reçu. Le propriétaire a été prévenu des articles manquants.';

  @override
  String invTrMissingTitle(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles ne sont pas arrivés',
      one: '1 article n’est pas arrivé',
    );
    return '$_temp0';
  }

  @override
  String invTrMissingBody(int arrived, int sent) {
    return '$arrived sur $sent sont arrivés. Le propriétaire sera prévenu des manquants.';
  }

  @override
  String invTrMissingLine(String product, int sent, int counted) {
    return '$product : envoyés $sent, comptés $counted';
  }

  @override
  String get invTrWhatHappened => 'Que s’est-il passé ? (facultatif)';

  @override
  String get invTrMissingStayOff =>
      'Ils restent hors des rayons jusqu’à la décision du propriétaire.';

  @override
  String invTrArrivedCanSell(String store) {
    return 'Tout le reste est arrivé et peut être vendu à $store dès maintenant.';
  }

  @override
  String get invTrGoBack => 'Retour';

  @override
  String invTrConfirmCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Confirmer $count reçus',
      one: 'Confirmer 1 reçu',
    );
    return '$_temp0';
  }

  @override
  String invTrConfirmedOnBy(String date, String name) {
    return 'confirmé le $date par $name';
  }

  @override
  String invTrStoreNote(String store, String note) {
    return 'Note de $store : « $note »';
  }

  @override
  String invTrCantSell(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other:
          'Ces $count articles ne peuvent être vendus nulle part avant votre décision.',
      one: 'Cet article ne peut être vendu nulle part avant votre décision.',
    );
    return '$_temp0';
  }

  @override
  String invTrReturnTo(String store) {
    return 'Rendre à $store';
  }

  @override
  String get invTrWriteOff => 'Passer en perte';

  @override
  String get invTrReasonTitle => 'Raison de la perte';

  @override
  String get invTrNoteOptional => 'Note (facultatif)';

  @override
  String invTrWriteOffCount(int count) {
    return 'Passer $count en perte';
  }

  @override
  String invTrReturnedDone(String store) {
    return 'Rendu à $store.';
  }

  @override
  String get invTrWrittenOffDone => 'Passé en perte.';

  @override
  String get invTrAllSettled =>
      'Chaque article manquant est réglé. Ce transfert est clos.';

  @override
  String get invTrReviewFooter =>
      'Seuls le propriétaire et le personnel de tous les magasins peuvent régler les écarts. Rappels tous les 2 jours jusqu’au règlement.';

  @override
  String get invTrReviewAction => 'Revoir les manquants';

  @override
  String get invTrColProduct => 'Produit';

  @override
  String get invTrColSent => 'Envoyés';

  @override
  String get invTrColReceived => 'Reçus';

  @override
  String invTrValueAtCost(String amount) {
    return 'Valeur au coût : $amount';
  }

  @override
  String get invTrCancel => 'Annuler le transfert';

  @override
  String get invTrCancelTitle => 'Annuler ce transfert ?';

  @override
  String invTrCancelMessage(int count, String store) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count articles retournent à $store.',
      one: '1 article retourne à $store.',
    );
    return '$_temp0';
  }

  @override
  String get invTrCancelDone =>
      'Transfert annulé. Les articles sont de retour au magasin.';

  @override
  String get invTrDiscard => 'Supprimer le brouillon';

  @override
  String get invTrDiscardTitle => 'Supprimer ce brouillon ?';

  @override
  String get invTrDiscardMessage =>
      'Rien n’était réservé : rien ne change dans les magasins.';

  @override
  String get invTrDiscardDone => 'Brouillon supprimé.';

  @override
  String get invTrPrintPick => 'Imprimer les étiquettes de quel produit ?';

  @override
  String invTrReceivedQty(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count reçus',
      one: '1 reçu',
    );
    return '$_temp0';
  }

  @override
  String get invTrGoneReceived => 'Quelqu’un a déjà confirmé ce transfert.';

  @override
  String get invTrGoneCancelled => 'Ce transfert a été annulé.';

  @override
  String get inventoryFailTransferNotFound => 'Ce transfert n’existe plus.';

  @override
  String get inventoryFailTransferNotDraft =>
      'Ce brouillon a déjà été envoyé ou annulé.';

  @override
  String get inventoryFailTransferNotInTransit =>
      'Ce transfert n’est plus en route.';

  @override
  String get inventoryFailLineNotDisputed => 'Rien ne manque pour ce produit.';

  @override
  String get inventoryFailLineAlreadyResolved =>
      'Quelqu’un a déjà décidé pour ce produit.';

  @override
  String get inventoryFailStoreHasTransfers =>
      'Des transferts depuis ou vers ce magasin ne sont pas terminés. Terminez-les d’abord.';

  @override
  String get inventoryFailItemInTransfer =>
      'Ce produit fait partie d’un transfert pas encore terminé.';

  @override
  String get inventoryFailItemNotInTransfer =>
      'Ce produit ne fait pas partie de ce transfert.';

  @override
  String get inventoryFailReceivedTooMany =>
      'Vous ne pouvez pas recevoir plus que ce qui a été envoyé.';

  @override
  String get inventoryFailWriteOffReasonInvalid =>
      'Choisissez pourquoi les articles sont passés en perte.';

  @override
  String get inventoryFailResolutionInvalid =>
      'Choisissez Rendre ou Passer en perte.';

  @override
  String get inventoryFailNoteTooLong =>
      'La note est trop longue (300 caractères au plus).';

  @override
  String get inventoryFailTransferLinesRequired =>
      'Ajoutez au moins un produit.';

  @override
  String get inventoryFailTransferLinesTooMany =>
      'Un transfert contient au plus 100 produits.';

  @override
  String get phaSignInWithPhone => 'Se connecter avec son téléphone';

  @override
  String get phaSignInTitle => 'Connexion par téléphone';

  @override
  String get phaSignInIntro =>
      'Nous enverrons un code à 6 chiffres à ce numéro sur WhatsApp.';

  @override
  String get phaSendWhatsAppCode => 'Envoyer le code sur WhatsApp';

  @override
  String get phaSendByText => 'Recevoir le code par SMS';

  @override
  String get phaSendTextCode => 'Envoyer le code par SMS';

  @override
  String phaCodeSentWhatsApp(String lastTwo) {
    return 'Saisissez le code à 6 chiffres envoyé sur WhatsApp au numéro se terminant par ••$lastTwo.';
  }

  @override
  String get phaCodeSentWhatsAppPlain =>
      'Saisissez le code à 6 chiffres envoyé sur WhatsApp.';

  @override
  String get phaTextFullNumberIntro =>
      'Pour recevoir le code par SMS, saisissez votre numéro complet avec l\'indicatif pays.';

  @override
  String get phaWhatsAppUnavailableNote =>
      'Les codes WhatsApp ne sont pas disponibles pour le moment : nous l\'enverrons par SMS.';

  @override
  String get phaErrPhoneInvalid => 'Saisissez un numéro de téléphone valide.';

  @override
  String get phaErrNeedsCountryCode =>
      'Ajoutez l\'indicatif pays au numéro (par exemple +1 ou +224).';

  @override
  String get phaErrTrackingNotFound =>
      'Nous n\'avons pas trouvé ce code de suivi.';

  @override
  String get phaErrNoPhoneOnRecord =>
      'Ce colis n\'a pas de numéro auquel envoyer un code.';

  @override
  String get phaErrRateLimited =>
      'Trop de codes ont été envoyés. Patientez puis réessayez.';

  @override
  String phaErrRateLimitedSeconds(int seconds) {
    return 'Trop de codes ont été envoyés. Réessayez dans $seconds s.';
  }

  @override
  String phaErrRateLimitedMinutes(int minutes) {
    String _temp0 = intl.Intl.pluralLogic(
      minutes,
      locale: localeName,
      other: 'Trop de codes ont été envoyés. Réessayez dans $minutes minutes.',
      one: 'Trop de codes ont été envoyés. Réessayez dans 1 minute.',
    );
    return '$_temp0';
  }

  @override
  String get phaErrWhatsAppUnavailable =>
      'Les codes WhatsApp ne sont pas disponibles pour le moment. Recevez-le par SMS.';

  @override
  String get phaErrSignInRequired => 'Connectez-vous d\'abord à votre compte.';

  @override
  String get phaErrCodeWrong => 'Ce code n\'est pas le bon.';

  @override
  String phaErrCodeWrongTries(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Ce code n\'est pas le bon. Encore $count essais.',
      one: 'Ce code n\'est pas le bon. Encore 1 essai.',
    );
    return '$_temp0';
  }

  @override
  String get phaErrCodeExpired => 'Ce code a expiré. Demandez-en un nouveau.';

  @override
  String get phaErrTooManyAttempts =>
      'Trop de codes erronés. Demandez-en un nouveau.';

  @override
  String get phaErrChallengeNotFound => 'Demandez un nouveau code.';

  @override
  String get phaErrPhoneInUse =>
      'Ce numéro appartient déjà à un autre compte Laawol déjà utilisé. Connectez-vous avec ce numéro, ou vérifiez un autre numéro.';

  @override
  String get phaErrWrongAccount =>
      'Ce code a été demandé par un autre compte. Demandez-en un nouveau.';

  @override
  String get phaErrProofInvalid => 'Vérifiez le numéro à nouveau.';

  @override
  String get phaErrNoVerifiedPhone =>
      'Ajoutez et vérifiez votre numéro dans votre profil pour voir vos colis.';

  @override
  String get phaErrRecordInvalid => 'Ce colis est introuvable.';

  @override
  String get phaErrPhoneSignInUnavailable =>
      'Utilisez votre e-mail et votre mot de passe pour vous connecter à ce compte.';

  @override
  String get phaErrOffline => 'Vérifiez votre connexion et réessayez.';

  @override
  String get phaErrAppCheck =>
      'Cet appareil n\'a pas pu être vérifié. Mettez l\'application à jour et réessayez.';

  @override
  String get phaErrGeneric => 'Une erreur est survenue. Veuillez réessayer.';

  @override
  String get phaHintTitle => 'Ce colis est à vous ?';

  @override
  String get phaHintBody =>
      'Connectez-vous avec le numéro indiqué pour voir tous vos colis, de toutes les entreprises.';

  @override
  String phaHintSignInAs(String lastTwo) {
    return 'Se connecter avec le numéro se terminant par ••$lastTwo';
  }

  @override
  String phaHintSignInAsSender(String lastTwo) {
    return 'Se connecter en tant qu\'expéditeur (••$lastTwo)';
  }

  @override
  String phaHintSignInAsReceiver(String lastTwo) {
    return 'Se connecter en tant que destinataire (••$lastTwo)';
  }

  @override
  String get phaMyPackagesTitle => 'Mes colis';

  @override
  String get phaMyPackagesSubtitle =>
      'Tous les colis enregistrés avec votre numéro';

  @override
  String get phaSectionMine => 'Mes colis';

  @override
  String get phaSectionComingToYou => 'En route vers vous';

  @override
  String get phaEmptyTitle => 'Aucun colis pour le moment';

  @override
  String phaEmptyBody(String lastTwo) {
    return 'Les colis qu\'une entreprise enregistre avec votre numéro se terminant par ••$lastTwo apparaîtront ici.';
  }

  @override
  String get phaEmptyBodyPlain =>
      'Les colis qu\'une entreprise enregistre avec votre numéro apparaîtront ici.';

  @override
  String get phaLoadFailed => 'Vos colis n\'ont pas pu être chargés.';

  @override
  String get phaSignInToSee =>
      'Connectez-vous avec votre téléphone pour voir tous les colis enregistrés avec votre numéro.';

  @override
  String get phaShowMore => 'Afficher plus';

  @override
  String get phaLoadingMore => 'Chargement...';

  @override
  String get phaBusinessUnknown => 'Une entreprise';

  @override
  String get phaServicePackageRequest => 'Demande d\'envoi de colis';

  @override
  String get phaSentToSelf => 'Vous êtes l\'expéditeur et le destinataire';

  @override
  String phaRecordedOn(String date) {
    return 'Enregistré le $date';
  }

  @override
  String phaUpdatedOn(String date) {
    return 'Mis à jour le $date';
  }

  @override
  String get phaNotMine => 'Ce n\'est pas à moi';

  @override
  String get phaNotMineTitle => 'Ce n\'est pas votre colis ?';

  @override
  String phaNotMineBody(String business) {
    return 'Il sera retiré de votre liste, et $business sera invitée à vérifier le numéro.';
  }

  @override
  String get phaNotMineBodyPlain =>
      'Il sera retiré de votre liste, et l\'entreprise sera invitée à vérifier le numéro.';

  @override
  String get phaNotMineConfirm => 'Le retirer';

  @override
  String get phaNotMineDone => 'Retiré. L\'entreprise va vérifier le numéro.';

  @override
  String get phaFlagAddCountryCode => 'Ajoutez l\'indicatif pays';

  @override
  String get phaFlagReportedNotMine =>
      'La personne dit que ce numéro n\'est pas le sien - vérifiez-le';

  @override
  String get phaNotSignedInYet => 'Pas encore connecté';

  @override
  String get phaSignInFilterSignedIn => 'Connectés';

  @override
  String get phaSignInFilterNotSignedIn => 'Pas encore connectés';

  @override
  String get phaSignInFilterAll => 'Tout le monde';

  @override
  String get phaNoEmailActions =>
      'Ce compte n\'a pas d\'adresse e-mail : il se connecte avec son numéro de téléphone, les actions par e-mail ne sont donc pas disponibles.';

  @override
  String get phaAccountOrigin => 'Compte créé depuis';

  @override
  String get phaAccountOriginShipment => 'Le numéro d\'un envoi';

  @override
  String get phaAccountOriginPhoneSignIn => 'Une connexion par téléphone';

  @override
  String get phaVerifyWithWhatsApp => 'Recevoir le code sur WhatsApp';

  @override
  String get phaLinkMerged =>
      'Votre numéro est vérifié. Les colis enregistrés avec ce numéro apparaissent maintenant dans votre compte.';

  @override
  String get phaDeletePhoneOnlyNote =>
      'Pour confirmer, vous devez vous être connecté au cours des 15 dernières minutes. Si cela ne fonctionne pas, déconnectez-vous puis reconnectez-vous avec votre téléphone.';

  @override
  String get phaDeleteRecentSignIn =>
      'Déconnectez-vous, reconnectez-vous avec votre téléphone, puis supprimez votre compte dans les 15 minutes.';

  @override
  String get phaPhoneOnlyNoPassword =>
      'Pas d\'e-mail sur votre compte ? Revenez en arrière et choisissez « Se connecter avec son téléphone » : il n\'y a pas de mot de passe à réinitialiser.';

  @override
  String get invSwitchToCredit => 'Passer à crédit';

  @override
  String get invSwitchToPaid => 'Passer en payée';

  @override
  String get invSwitchToCreditTitle => 'Passer cette vente à crédit';

  @override
  String get invSwitchToCreditNote =>
      'Le client n’a pas tout payé. Indiquez qui doit le reste. Ce qui a été payé au moment de la vente garde son mode de paiement et la personne qui l’a reçu.';

  @override
  String get invSwitchPaidAtTime =>
      'Combien a-t-il payé au moment de la vente ? (dollars US)';

  @override
  String get invSwitchToPaidTitle => 'Marquer cette vente comme payée';

  @override
  String invSwitchToPaidNote(Object total) {
    return 'Ce n’était pas un crédit : la totalité de $total a été payée au moment de la vente.';
  }

  @override
  String get invSwitchHowPaid => 'Mode de paiement';

  @override
  String get invSwitchConfirmCreditTitle => 'Passer cette vente à crédit ?';

  @override
  String invSwitchConfirmCreditMessage(String name, String owed, String paid) {
    return '$name devra $owed. $paid reste payé au moment de la vente. La personne qui encaisse est prévenue.';
  }

  @override
  String get invSwitchConfirmPaidTitle => 'Marquer cette vente comme payée ?';

  @override
  String invSwitchConfirmPaidMessage(Object total) {
    return 'La totalité de $total a été payée au moment de la vente. Plus personne ne doit rien dessus.';
  }

  @override
  String invSwitchedToCredit(Object owed) {
    return 'Passée à crédit : $owed dus';
  }

  @override
  String get invSwitchedToPaid => 'Passée en payée';

  @override
  String invSwitchLineCredit(
    String who,
    String when,
    String paid,
    String owed,
  ) {
    return 'Passée à crédit par $who · $when · $paid payés, $owed dus';
  }

  @override
  String invSwitchLinePaid(
    String who,
    String when,
    String total,
    String method,
  ) {
    return 'Passée en payée par $who · $when · $total payés ($method)';
  }

  @override
  String get invSwitchFailAlreadyCredit => 'Cette vente est déjà à crédit.';

  @override
  String get invSwitchFailAlreadyPaid =>
      'Cette vente est déjà entièrement payée.';

  @override
  String get invSwitchFailPaymentsRecorded =>
      'De l’argent a déjà été encaissé sur ce crédit, elle ne peut donc pas devenir une vente payée. Utilisez Enregistrer un paiement pour ce qui reste dû.';

  @override
  String get invSwitchFailTooMany => 'Cette vente a été modifiée trop de fois.';

  @override
  String get bankCheckEntryTitle => 'Vérifier la banque';

  @override
  String get bankCheckEntryHint =>
      'Un Zelle est-il arrivé ? Vérifiez le montant.';

  @override
  String get bankCheckConnectHint =>
      'Connectez votre banque pour vérifier les paiements Zelle d\'ici.';

  @override
  String get bankCheckReconnectHint =>
      'Votre banque vous demande de vous reconnecter avant de pouvoir vérifier les Zelle.';

  @override
  String get bankCheckSubtitle =>
      'Voyez si un Zelle de ce montant exact est arrivé sur le compte de l\'entreprise. Rien n\'est enregistré.';

  @override
  String get bankCheckAmountLabel => 'Montant exact';

  @override
  String get bankCheckAmountInvalid =>
      'Saisissez le montant, par exemple 60 ou 60,50.';

  @override
  String get bankCheckAmountTooLarge =>
      'Ce montant est trop élevé pour être vérifié.';

  @override
  String get bankCheckSinceLabel => 'Quand a-t-il été envoyé ?';

  @override
  String get bankCheckSince15m => '15 dernières minutes';

  @override
  String get bankCheckSince1h => 'Dernière heure';

  @override
  String get bankCheckSinceToday => 'Aujourd\'hui';

  @override
  String get bankCheckButton => 'Vérifier';

  @override
  String get bankCheckSeveralHint =>
      'Trouvez celui du client grâce au nom de l\'expéditeur.';

  @override
  String get bankCheckPending => 'En attente';

  @override
  String get bankCheckLimitNote =>
      'La limite mensuelle d\'actualisations bancaires est atteinte : les nouveaux dépôts peuvent mettre plus de temps à apparaître.';

  @override
  String get bankCheckUseForSale => 'Utiliser pour une vente';

  @override
  String get bankCheckUsed => 'Confirmé pour une vente';

  @override
  String bankUseSubtitle(String amount) {
    return 'Choisissez le paiement Zelle de $amount que ce dépôt règle.';
  }

  @override
  String get bankUseRecent => 'Paiements Zelle récents de ce montant';

  @override
  String get bankUseResults => 'Paiements correspondants';

  @override
  String get bankUseSearchLabel => 'Client, articles ou code de suivi';

  @override
  String get bankUseSearchButton => 'Rechercher';

  @override
  String bankUseEmptyRecent(String amount) {
    return 'Aucun paiement Zelle récent de $amount n\'attend la banque. Recherchez les plus anciens ci-dessus.';
  }

  @override
  String bankUseEmptySearch(String query) {
    return 'Aucun résultat pour « $query ».';
  }

  @override
  String get bankUseLoadFailed =>
      'Impossible de charger les paiements. Vérifiez la connexion et réessayez.';

  @override
  String get bankUseKindSale => 'Vente';

  @override
  String get bankUseKindCreditPayment => 'Paiement de crédit';

  @override
  String get bankUseKindPackagePayment => 'Paiement de colis';

  @override
  String get bankUseNoName => 'Client sans nom';

  @override
  String get bankUseConfirmButton => 'Utiliser pour cette vente';

  @override
  String get bankUseConfirming => 'Confirmation…';

  @override
  String get bankUseConfirmed => 'Confirmé pour cette vente';

  @override
  String get zelleFailAmountMismatch =>
      'Ce paiement n\'a pas le même montant que le dépôt.';

  @override
  String get zelleFailCheckAmountInvalid =>
      'Saisissez un montant supérieur à zéro, avec deux décimales au plus.';

  @override
  String get zelleFailSinceInvalid => 'Choisissez quand il a été envoyé.';

  @override
  String get zelleFailModeInvalid =>
      'Cette vérification demande une mise à jour de l\'application.';

  @override
  String get zelleFailLimitInvalid => 'Choisissez une limite de 0 à 1000.';

  @override
  String bankUsageTitle(String month) {
    return 'Ce mois-ci · $month';
  }

  @override
  String get bankUsageChecks => 'Vérifications';

  @override
  String get bankUsageRefreshes => 'Actualisations payantes';

  @override
  String bankUsageRefreshesOf(int used, int limit) {
    return '$used sur $limit';
  }

  @override
  String get bankUsageCost => 'Coût estimé';

  @override
  String get bankUsageByStaff => 'Par membre de l\'équipe';

  @override
  String bankUsageStaffLine(int checks, int refreshes) {
    return 'Vérifications : $checks · Actualisations : $refreshes';
  }

  @override
  String get bankUsageNone => 'Aucune vérification ce mois-ci.';

  @override
  String get bankUsageLimitReached =>
      'Limite atteinte : les vérifications fonctionnent toujours, mais les nouveaux dépôts peuvent mettre plus de temps à apparaître.';

  @override
  String get bankLimitLabel => 'Limite mensuelle d\'actualisations payantes';

  @override
  String bankLimitHint(String cost) {
    return 'Chaque actualisation demande les nouveaux dépôts à la banque et coûte environ $cost. Une fois la limite atteinte, les vérifications fonctionnent toujours mais ne demandent plus d\'actualisation à la banque jusqu\'au mois prochain.';
  }

  @override
  String get bankLimitInvalid => 'Saisissez un nombre entier de 0 à 1000.';

  @override
  String get bankLimitSaved => 'Limite enregistrée';

  @override
  String get phaErrInviteNotFound =>
      'Cette invitation n’est plus active. Demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiMethodLabel => 'Inviter par';

  @override
  String get stiMethodPhone => 'Téléphone (WhatsApp)';

  @override
  String get stiMethodEmail => 'E-mail';

  @override
  String get stiPhoneLabel => 'Numéro WhatsApp';

  @override
  String get stiPhoneHelp =>
      'La personne reçoit un message WhatsApp avec un lien pour rejoindre l’équipe. Elle se connecte avec un code, sans mot de passe.';

  @override
  String get stiNameRequired => 'Saisissez le nom de la personne.';

  @override
  String get stiPhoneRequired =>
      'Saisissez un numéro valide avec l’indicatif du pays.';

  @override
  String get stiStoreLabel => 'Quel magasin ?';

  @override
  String get stiStoreHelp => 'Où cette personne travaille dans l’inventaire.';

  @override
  String get stiStoreAll => 'Tous les magasins';

  @override
  String get stiStoreRequired => 'Choisissez un magasin, ou Tous les magasins.';

  @override
  String get stiSentOnWhatsApp => 'Invitation envoyée sur WhatsApp';

  @override
  String get stiNotSentTitle =>
      'Message WhatsApp pas encore envoyé - partagez ce lien';

  @override
  String get stiNotSentHelp =>
      'L’invitation est prête. Envoyez vous-même ce lien à la personne. Il est valable 7 jours.';

  @override
  String get stiCopyLink => 'Copier le lien';

  @override
  String get stiLinkCopied => 'Lien copié';

  @override
  String get stiStatusPending => 'En attente';

  @override
  String get stiStatusExpired => 'Expirée';

  @override
  String get stiStatusCancelled => 'Annulée';

  @override
  String get stiStatusAccepted => 'Acceptée';

  @override
  String stiExpiresOn(Object date) {
    return 'Expire le $date';
  }

  @override
  String get stiInvitationsEmpty => 'Aucune invitation en attente.';

  @override
  String get stiInvitationsFailed => 'Impossible de charger les invitations.';

  @override
  String get stiScreenTitle => 'Invitation d’équipe';

  @override
  String stiInvitedYou(String inviter, String business) {
    return '$inviter vous invite à rejoindre $business sur Laawol en tant que membre de l’équipe.';
  }

  @override
  String stiInvitedYouNoInviter(Object business) {
    return 'Vous êtes invité à rejoindre $business sur Laawol en tant que membre de l’équipe.';
  }

  @override
  String stiAcceptWithNumber(Object lastTwo) {
    return 'Accepter avec le numéro se terminant par ••$lastTwo';
  }

  @override
  String get stiAcceptWithNumberHelp =>
      'Nous envoyons un code à ce numéro sur WhatsApp.';

  @override
  String get stiAccept => 'Accepter l’invitation';

  @override
  String get stiAccepting => 'Acceptation…';

  @override
  String stiOtherAccount(Object lastTwo) {
    return 'Vous êtes connecté avec un autre compte. Cette invitation est pour le numéro se terminant par ••$lastTwo : déconnectez-vous, puis acceptez avec ce numéro.';
  }

  @override
  String get stiSignOutToContinue => 'Se déconnecter pour continuer';

  @override
  String get stiSigningOut => 'Déconnexion…';

  @override
  String get stiClosedExpired =>
      'Cette invitation a expiré. Demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiClosedCancelled =>
      'Cette invitation a été annulée. Demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiClosedAccepted =>
      'Cette invitation a déjà été acceptée. Si vous avez besoin d’un accès, demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiLoadFailed => 'Impossible d’ouvrir cette invitation.';

  @override
  String stiWelcome(Object business) {
    return 'Bienvenue chez $business';
  }

  @override
  String get stiErrFullName => 'Saisissez le nom complet de la personne.';

  @override
  String get stiErrPhone => 'Saisissez un numéro de téléphone valide.';

  @override
  String get stiErrCountryCode => 'Ajoutez l’indicatif du pays au numéro.';

  @override
  String get stiErrEmail => 'Saisissez une adresse e-mail valide.';

  @override
  String get stiErrStoreAccess =>
      'Choisissez un magasin, ou Tous les magasins.';

  @override
  String get stiErrStoreNotFound =>
      'Ce magasin n’existe plus. Choisissez-en un autre.';

  @override
  String get stiErrExistingAuthority =>
      'Ce compte a déjà un accès entreprise ou administrateur : il ne peut pas rejoindre l’équipe.';

  @override
  String get stiErrAlreadyPending =>
      'Une invitation pour cette personne est déjà en attente. Renvoyez-la depuis la liste.';

  @override
  String get stiErrOwnerRequired =>
      'Seul le propriétaire de l’entreprise peut inviter des membres de l’équipe.';

  @override
  String get stiErrBusiness => 'Choisissez d’abord l’entreprise.';

  @override
  String get stiErrNotActive =>
      'Cette invitation n’est plus active. Demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiErrSelection =>
      'Plusieurs invitations sont en attente. Ouvrez le lien du message reçu.';

  @override
  String get stiErrExpired =>
      'Cette invitation a expiré. Demandez une nouvelle invitation à l’entreprise.';

  @override
  String get stiErrNotPending =>
      'Cette invitation a déjà été utilisée ou annulée.';

  @override
  String get stiErrIdentity =>
      'Cette invitation est pour un autre numéro. Connectez-vous avec le numéro auquel elle a été envoyée.';

  @override
  String get stiErrVerifiedContact =>
      'Connectez-vous avec le numéro auquel l’invitation a été envoyée.';

  @override
  String get stiErrNotAllowed =>
      'Vous n’avez pas l’accès nécessaire pour faire cela.';

  @override
  String get stiPendingTitle => 'Vous avez une invitation';

  @override
  String stiPendingInvited(String inviter, String business) {
    return '$inviter vous invite à rejoindre $business en tant que membre de l’équipe.';
  }

  @override
  String stiPendingInvitedNoInviter(Object business) {
    return 'Vous êtes invité à rejoindre $business en tant que membre de l’équipe.';
  }

  @override
  String get stiPlatformName => 'l’administration de Laawol Digital';

  @override
  String stiJoin(Object business) {
    return 'Rejoindre $business';
  }

  @override
  String get stiNotNow => 'Plus tard';

  @override
  String get continueWithGoogle => 'Continuer avec Google';

  @override
  String get continueWithApple => 'Continuer avec Apple';

  @override
  String get socialSignInDivider => 'ou';

  @override
  String get authErrorAccountExistsOtherSignIn =>
      'Cet e-mail a déjà un compte Laawol. Connectez-vous une fois avec votre e-mail et votre mot de passe, et Google y sera associé.';

  @override
  String get authErrorSocialSignInFailed =>
      'Nous n’avons pas pu vous connecter avec ce compte. Réessayez ou connectez-vous autrement.';

  @override
  String get authErrorInvitationWaiting =>
      'Une invitation attend ce compte. Ouvrez le lien d’invitation reçu pour la rejoindre.';

  @override
  String get dlvTitle => 'Livraisons';

  @override
  String get dlvSubtitle => 'Scannez l’étiquette d’un colis et remettez-le.';

  @override
  String get dlvSection => 'Livraison';

  @override
  String get dlvReadyNote =>
      'Son conteneur est prêt à récupérer. Remettez le colis et marquez-le comme livré.';

  @override
  String get dlvMarkDelivered => 'Marquer comme livré';

  @override
  String get dlvMarking => 'Enregistrement de la livraison…';

  @override
  String dlvSheetSubtitle(String what, String receiver) {
    return '$what pour $receiver';
  }

  @override
  String get dlvCollectedByLabel => 'Récupéré par';

  @override
  String get dlvCollectedByHelper =>
      'Le destinataire, ou la personne qui le récupère pour lui.';

  @override
  String get dlvCollectedByTooLong =>
      'Le nom de la personne qui l’a récupéré doit faire 120 caractères au plus.';

  @override
  String dlvBalanceOwed(Object amount) {
    return 'Ce colis doit encore $amount.';
  }

  @override
  String get dlvBalanceUnpaid =>
      'Ce colis a encore un solde impayé — vérifiez auprès du bureau.';

  @override
  String get dlvBalanceConfirm =>
      'Vous pouvez quand même le remettre : confirmez ci-dessous.';

  @override
  String get dlvDeliverAnyway => 'Livrer quand même';

  @override
  String get dlvDone => 'Marqué comme livré.';

  @override
  String get dlvAlreadyDelivered => 'Ce colis était déjà marqué comme livré.';

  @override
  String get dlvDeliveredPill => 'Livré';

  @override
  String dlvDeliveredOn(Object when) {
    return 'Livré le $when';
  }

  @override
  String dlvHandedOverBy(Object name) {
    return 'Remis par $name';
  }

  @override
  String dlvCollectedBy(Object name) {
    return 'Récupéré par $name';
  }

  @override
  String dlvOwedAtDelivery(Object amount) {
    return '$amount restait dû à la remise';
  }

  @override
  String get dlvUndo => 'Annuler la livraison';

  @override
  String get dlvUndoTitle => 'Annuler cette livraison ?';

  @override
  String get dlvUndoMessage =>
      'Le colis redevient prêt à récupérer. Personne n’est prévenu.';

  @override
  String get dlvUndone => 'Livraison annulée.';

  @override
  String get dlvNotUndone => 'Ce colis n’était pas marqué comme livré.';

  @override
  String dlvProgress(int delivered, int total) {
    return '$delivered sur $total livrés';
  }

  @override
  String get dlvErrAction =>
      'Cette action n’est pas possible pour une livraison.';

  @override
  String get dlvErrNotArrived =>
      'Un colis peut être marqué comme livré une fois son conteneur prêt à récupérer.';

  @override
  String get dlvErrBalanceDue =>
      'Ce colis a encore un solde impayé. Confirmez pour le marquer comme livré quand même.';

  @override
  String get dlvErrLineNotFound => 'Ce colis n’existe plus.';

  @override
  String get dlvErrNotAllowed => 'Vous n’avez pas accès à cette action.';

  @override
  String get dlvErrOffline =>
      'Pas de connexion. Vérifiez votre internet et réessayez.';

  @override
  String get dlvErrGeneric =>
      'Impossible d’enregistrer la livraison. Réessayez.';

  @override
  String get pkgMomentDelivered => 'livré';

  @override
  String get ldgStart => 'Commencer le chargement';

  @override
  String ldgHeaderTo(String destination) {
    return 'Vers $destination';
  }

  @override
  String ldgTotalPackages(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis',
      one: '$count colis',
    );
    return '$_temp0';
  }

  @override
  String ldgTotalPieces(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count pièces scannées',
      one: '$count pièce scannée',
    );
    return '$_temp0';
  }

  @override
  String get ldgCameraUnavailable =>
      'L’appareil photo n’est pas disponible. Saisissez ci-dessous le code imprimé sur chaque étiquette.';

  @override
  String get ldgTypeCode => 'Saisir un code';

  @override
  String get ldgTypeHint => 'CL-K7M4P2';

  @override
  String get ldgTypeSend => 'Charger';

  @override
  String get ldgRecent => 'Derniers scans';

  @override
  String get ldgNoScans => 'Chaque étiquette scannée s’affiche ici.';

  @override
  String get ldgSending => 'Envoi…';

  @override
  String get ldgLoaded => 'Chargé';

  @override
  String ldgLoadedOf(int scanned, int total) {
    return 'Chargé · $scanned sur $total';
  }

  @override
  String get ldgMovedHere => 'Déplacé ici';

  @override
  String ldgCountedOf(int scanned, int total) {
    return '$scanned sur $total';
  }

  @override
  String ldgAllIn(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Les $count sont déjà chargés',
      one: 'Déjà chargé',
    );
    return '$_temp0';
  }

  @override
  String get ldgUndo => 'Annuler';

  @override
  String get ldgUndoneBack => 'Annulé · remis en attente';

  @override
  String ldgUndoneOf(int scanned, int total) {
    return 'Annulé · $scanned sur $total';
  }

  @override
  String get ldgUndoFailed => 'Impossible d’annuler. Réessayez.';

  @override
  String get ldgErrOffline => 'Pas de connexion - scannez à nouveau';

  @override
  String get ldgErrNotAllowed =>
      'Vous n’avez pas accès au chargement des conteneurs.';

  @override
  String get ldgErrNotFound => 'Aucun colis n’a ce code.';

  @override
  String get ldgErrLocked => 'Ce conteneur n’est plus en chargement.';

  @override
  String get ldgErrDestinationRequired =>
      'Indiquez d’abord la destination de ce conteneur.';

  @override
  String get ldgErrDestinationMismatch => 'Ce colis va dans un autre pays.';

  @override
  String get ldgErrDelivered => 'Ce colis a déjà été livré.';

  @override
  String ldgErrOtherContainer(String container) {
    return 'Ce colis est sur $container.';
  }

  @override
  String ldgErrShippedContainer(String container) {
    return 'Ce colis est déjà parti sur $container.';
  }

  @override
  String get ldgErrCodeInvalid => 'Ce n’est pas un code de colis.';

  @override
  String get ldgErrScanId => 'Le scan n’est pas passé. Scannez à nouveau.';

  @override
  String get ldgErrPieceCount =>
      'Seul un colis dont une partie des pièces a été scannée peut rester en attente.';

  @override
  String get ldgErrGeneric =>
      'Impossible de scanner cette étiquette. Scannez à nouveau.';

  @override
  String get ldgMoveTitle => 'Le déplacer ici ?';

  @override
  String ldgMoveMessage(String container) {
    return 'Ce colis est sur $container. Le déplacer ici ?';
  }

  @override
  String get ldgMoveConfirm => 'Déplacer ici';

  @override
  String get ldgDone => 'Chargement terminé';

  @override
  String get ldgSummaryTitle => 'Avant de terminer';

  @override
  String get ldgSummaryFailed => 'Impossible d’obtenir le récapitulatif.';

  @override
  String get ldgIncompleteTitle => 'Toutes les pièces n’ont pas été scannées';

  @override
  String ldgIncompleteOf(int scanned, int total) {
    return '$scanned pièces scannées sur $total';
  }

  @override
  String get ldgLoadAll => 'Tout charger';

  @override
  String ldgLeaveWaiting(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'En laisser $count en attente',
      one: 'En laisser $count en attente',
    );
    return '$_temp0';
  }

  @override
  String get ldgGoesWhole => 'Tout part';

  @override
  String ldgLeftWaiting(int count, String code) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count laissées en attente sous $code',
      one: '$count laissée en attente sous $code',
    );
    return '$_temp0';
  }

  @override
  String ldgUnscanned(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis du conteneur n’ont jamais été scannés',
      one: '$count colis du conteneur n’a jamais été scanné',
    );
    return '$_temp0';
  }

  @override
  String get ldgUnscannedNote =>
      'Ajoutés à la main, ou avant le début du scan.';

  @override
  String ldgWaitingNotScanned(int count, String destination) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis en attente pour $destination n’ont pas été scannés',
      one: '$count colis en attente pour $destination n’a pas été scanné',
    );
    return '$_temp0';
  }

  @override
  String get ldgThisDestination => 'cette destination';

  @override
  String ldgWaitingMore(int count) {
    return 'et $count de plus';
  }

  @override
  String get ldgAllClear =>
      'Tous les colis du conteneur ont été scannés en entier.';

  @override
  String get ldgKeepScanning => 'Continuer à scanner';

  @override
  String get ldgErrAction => 'Ce n’est pas une action de chargement.';

  @override
  String get ldgErrInAnotherContainer => 'Ce colis est sur un autre conteneur.';

  @override
  String ldgOnContainer(String packages, String pieces) {
    return 'Sur le conteneur : $packages · $pieces';
  }

  @override
  String ldgPieces(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count pièces',
      one: '$count pièce',
    );
    return '$_temp0';
  }

  @override
  String get ldgErrNotOnContainer => 'Ce colis n’est plus sur ce conteneur.';

  @override
  String ldgUndoneMovedBack(String container) {
    return 'Remis sur $container';
  }

  @override
  String get ldgAlreadyUndone => 'Déjà annulé';

  @override
  String ldgMoveScannedWarning(int count, String container) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count de ses pièces ont déjà été scannées dans $container.',
      one: '$count de ses pièces a déjà été scannée dans $container.',
    );
    return '$_temp0';
  }

  @override
  String get ldgRestWaiting => 'Le reste reste en attente.';

  @override
  String get lotDuplicatesTitle => 'Doublons possibles';

  @override
  String lotDuplicatesBanner(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count voitures ont deux fois le même travail',
      one: '1 voiture a deux fois le même travail',
    );
    return '$_temp0';
  }

  @override
  String get lotDuplicatesBannerNote =>
      'Touchez pour vérifier et invalider celle saisie par erreur.';

  @override
  String get lotDuplicatesExplain =>
      'La même voiture avec le même travail plus d’une fois. Invalidez celle saisie par erreur — elle reste dans le registre, barrée.';

  @override
  String get lotDuplicateSameCustomer =>
      'Même client — probablement saisi deux fois';

  @override
  String get lotDuplicateDifferentCustomers =>
      'Clients différents — peut-être une revente ; n’invalidez que si c’est une erreur de saisie';

  @override
  String get lotDuplicatesNone => 'Aucun doublon possible.';

  @override
  String lotVinTail(String tail) {
    return 'VIN $tail';
  }

  @override
  String lotVinDuplicateNotice(
    String article,
    String job,
    String code,
    String date,
  ) {
    return 'Cette voiture a déjà « $job » pour ce client : $code ($date)';
  }

  @override
  String get lotOpenIt => 'L’ouvrir';

  @override
  String get lotRepeatConfirmTitle => 'L’enregistrer à nouveau ?';

  @override
  String lotRepeatConfirmItem(String date, String customer, String code) {
    return 'le $date pour $customer ($code)';
  }

  @override
  String lotRepeatConfirmBody(String article, String job, String items) {
    return 'Cette voiture a déjà eu « $job » $items. En enregistrer un autre pour ce client ?';
  }

  @override
  String get lotRecordAnother => 'En enregistrer un autre';

  @override
  String get lotEntryNotFound => 'Impossible d’ouvrir cette entrée.';

  @override
  String ldgAlreadyOnContainer(int scanned, int total) {
    String _temp0 = intl.Intl.pluralLogic(
      scanned,
      locale: localeName,
      other: 'Déjà sur ce conteneur · $scanned sur $total scannées',
      one: 'Déjà sur ce conteneur · $scanned sur $total scannée',
    );
    return '$_temp0';
  }

  @override
  String get ldgTabOnContainer => 'Sur ce conteneur';

  @override
  String get ldgTabStillToLoad => 'À charger';

  @override
  String get ldgFilterRecent => 'Ajoutés récemment';

  @override
  String get ldgFilterByCustomer => 'Par client';

  @override
  String get ldgFilterNotScanned => 'Pas encore scannés';

  @override
  String get ldgSearchHint => 'Chercher un code, un nom ou un téléphone';

  @override
  String ldgScannedOfPieces(int scanned, int total) {
    String _temp0 = intl.Intl.pluralLogic(
      scanned,
      locale: localeName,
      other: 'pièces scannées',
      one: 'pièce scannée',
    );
    return '$scanned $_temp0 sur $total';
  }

  @override
  String get ldgNoCustomerName => 'Sans nom';

  @override
  String ldgPackagesWaiting(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count colis en attente',
      one: '$count colis en attente',
    );
    return '$_temp0';
  }

  @override
  String ldgAddedBy(String name) {
    return 'Ajouté par $name';
  }

  @override
  String get ldgViaScan => 'Par scan';

  @override
  String get ldgViaHand => 'À la main';

  @override
  String get ldgViaMove => 'Déplacé';

  @override
  String get ldgAddedEarlier => 'Ajouté plus tôt';

  @override
  String get ldgTakeOff => 'Retirer';

  @override
  String get ldgTakeOffTitle => 'Le retirer ?';

  @override
  String ldgTakeOffMessage(String code, String container) {
    return 'Retirer $code de $container ? Le colis repasse en attente.';
  }

  @override
  String get ldgLoadIt => 'Charger';

  @override
  String ldgStillWaitingFor(int count, String destination) {
    return '$count encore en attente pour $destination';
  }

  @override
  String get ldgNothingOnContainer => 'Rien sur ce conteneur pour l’instant.';

  @override
  String get ldgNoMatches => 'Aucun colis ne correspond.';

  @override
  String get ldgAllScannedHere => 'Tous les colis ont été scannés.';

  @override
  String ldgNothingToLoad(String destination) {
    return 'Aucun colis n’attend pour $destination.';
  }

  @override
  String get waWhatsApp => 'WhatsApp';

  @override
  String get waListSupport => 'Demandes d’assistance';

  @override
  String get waFilterAll => 'Toutes';

  @override
  String get waFilterNeedsReply => 'À répondre';

  @override
  String get waFilterWaiting => 'En attente du client';

  @override
  String get waFilterDone => 'Terminées';

  @override
  String get waStateNeedsReply => 'À répondre';

  @override
  String get waStateWaiting => 'En attente du client';

  @override
  String get waStateChoosing => 'Choix de l’entreprise demandé';

  @override
  String get waStateDone => 'Terminée';

  @override
  String get waStoppedUpdates => 'Mises à jour arrêtées';

  @override
  String waSuggestedFor(String business) {
    return 'Pour $business';
  }

  @override
  String get waHandedOverPill => 'Transférée';

  @override
  String get waEmptyTitle => 'Aucune conversation WhatsApp';

  @override
  String get waEmptySubtitle =>
      'Quand un client écrit au numéro WhatsApp de Laawol au sujet d’un colis, la conversation apparaît ici.';

  @override
  String get waSearch => 'Rechercher un nom, un numéro ou un message';

  @override
  String get waLaawol => 'Laawol';

  @override
  String get waCustomerPackages => 'Colis';

  @override
  String get waPackagesLoading => 'Chargement des colis…';

  @override
  String get waPackagesFailed => 'Impossible de charger les colis.';

  @override
  String get waNoPackages =>
      'Aucun colis chez votre entreprise pour ce numéro.';

  @override
  String get waPackageSender => 'Expéditeur';

  @override
  String get waPackageReceiver => 'Destinataire';

  @override
  String get waMarkDone => 'Marquer terminée';

  @override
  String get waMarkingDone => 'Mise à jour…';

  @override
  String get waReopen => 'Rouvrir';

  @override
  String get waReopening => 'Réouverture…';

  @override
  String get waPrivateNote => 'Note privée';

  @override
  String get waOnlyYourTeam => 'Seule votre équipe la voit';

  @override
  String get waNoteSaving => 'Enregistrement de la note…';

  @override
  String get waNoteSaved => 'Note enregistrée.';

  @override
  String get waHandOver => 'Transférer';

  @override
  String get waHandOverTitle => 'Transférer cette conversation';

  @override
  String get waHandOverSubtitle =>
      'Elle passe dans l’autre boîte avec ses messages. Le client n’est pas prévenu.';

  @override
  String get waHandOverToLaawol => 'Assistance Laawol';

  @override
  String get waHandOverToBusiness => 'Une autre entreprise';

  @override
  String get waHandOverStaffHint =>
      'Laawol peut la confier à une autre entreprise qui expédie pour ce client.';

  @override
  String get waHandOverNote => 'Note pour eux (facultatif)';

  @override
  String get waHandingOver => 'Transfert…';

  @override
  String waHandedOverTo(String name) {
    return 'Transférée à $name.';
  }

  @override
  String get waPickBusiness => 'Choisissez une entreprise';

  @override
  String get waRefusalNotThisCustomer =>
      'Cette entreprise n’a aucun envoi pour ce client.';

  @override
  String get waRefusalPickAnother =>
      'Elle est déjà dans cette boîte. Choisissez-en une autre.';

  @override
  String get waRefusalBusinessNotFound => 'Cette entreprise n’existe plus.';

  @override
  String get waRefusalNotAllowed =>
      'Vous ne pouvez pas faire cela sur cette conversation.';

  @override
  String get waRefusalPhone =>
      'Ce numéro doit d’abord avoir son indicatif pays.';

  @override
  String get waRefusalOffline => 'Pas de connexion. Réessayez.';

  @override
  String get waRefusalUnknown => 'Cela n’a pas fonctionné. Réessayez.';

  @override
  String get waAutoReply => 'Réponse automatique';

  @override
  String get waNoteBadge => 'Note privée · Seule votre équipe la voit';

  @override
  String get waMediaDeleted => 'Fichier supprimé après 12 mois';

  @override
  String get waTickSent => 'Envoyé';

  @override
  String get waTickDelivered => 'Distribué';

  @override
  String get waTickRead => 'Lu';

  @override
  String get waTickFailed => 'Non distribué';

  @override
  String waTickFailedReason(String reason) {
    return 'Non distribué : $reason';
  }

  @override
  String get waTickWaiting => 'En attente : part quand le client répond';

  @override
  String get waTickStopped =>
      'En attente : le client a arrêté les mises à jour';

  @override
  String get waPlay => 'Lire';

  @override
  String get waPause => 'Pause';

  @override
  String get waAudioFailed => 'Impossible de lire ce message vocal.';

  @override
  String get waDeliveryWaiting =>
      'Hors de la fenêtre de 24 h de WhatsApp : le client a été invité à répondre, et votre message partira à ce moment-là.';

  @override
  String get waDeliveryStopped =>
      'Le client a arrêté les mises à jour. Votre message partira s’il écrit de nouveau.';

  @override
  String get waDeliveryFailed =>
      'WhatsApp n’a pas accepté ce message. La raison est indiquée en dessous.';

  @override
  String get waWindowClosed =>
      'Le client a écrit il y a plus de 24 h. Ce que vous envoyez attend sa réponse.';

  @override
  String get waWriteMessage => 'Message sur WhatsApp';

  @override
  String get waRecordVoice => 'Enregistrer un message vocal';

  @override
  String waRecording(String time) {
    return 'Enregistrement $time';
  }

  @override
  String get waSendVoice => 'Envoyer le message vocal';

  @override
  String get waDiscardVoice => 'Supprimer le message vocal';

  @override
  String get waMicDenied =>
      'Autorisez le micro dans Réglages pour enregistrer des messages vocaux.';

  @override
  String get waRecordFailed => 'Impossible d’enregistrer. Réessayez.';

  @override
  String get waVoiceTooShort => 'Cet enregistrement était trop court.';

  @override
  String get waMessageCustomer => 'Écrire au client';

  @override
  String get waMessageWho => 'À qui voulez-vous écrire ?';

  @override
  String get waOpening => 'Ouverture de la conversation…';

  @override
  String get waNeedsCountryCode =>
      'Ajoutez l’indicatif pays pour écrire à ce numéro';

  @override
  String get waNoPhone => 'Aucun numéro sur ce colis.';

  @override
  String get waNotifTitle => 'Messages WhatsApp';

  @override
  String get waNotifOwner =>
      'Quand un client écrit sur WhatsApp. Activé pour les propriétaires sauf si vous le désactivez.';

  @override
  String get waNotifStaff =>
      'Quand un client écrit sur WhatsApp. Désactivé pour le personnel tant que vous ne l’activez pas.';

  @override
  String get waDisplayNameTitle => 'Nom que les clients voient sur WhatsApp';

  @override
  String waDisplayNameHelp(String example) {
    return 'Vos réponses sont signées $example. Laissez vide pour utiliser votre prénom.';
  }

  @override
  String get waDisplayNameSave => 'Enregistrer le nom';

  @override
  String get waDisplayNameSaved => 'Nom enregistré.';

  @override
  String get waNotifAdmin =>
      'Quand un client écrit à Laawol sur WhatsApp. Activé sauf si vous le désactivez.';

  @override
  String waPackageTick(String who, String mark, String status) {
    return '$who $mark $status';
  }

  @override
  String waPackageTickFailed(String who, String mark, String reason) {
    return '$who $mark Non distribué : $reason';
  }

  @override
  String get waHandOverLoading => 'Chargement des destinations possibles…';

  @override
  String get waHandOverNoOptions => 'Il n’y a nulle part où la transférer.';

  @override
  String get proofSectionTitle => 'Preuves';

  @override
  String proofPhotosOfMax(int count, int max) {
    return 'Photos · $count sur $max';
  }

  @override
  String get proofTakePhoto => 'Appareil photo';

  @override
  String get proofChoosePhoto => 'Galerie';

  @override
  String get proofRemovePhoto => 'Retirer la photo';

  @override
  String get proofPhotoUploading => 'Envoi…';

  @override
  String get proofPhotoRequiredNote =>
      'Une photo du colis est obligatoire au dépôt.';

  @override
  String proofPhotoOptionalNote(int max) {
    return 'Jusqu’à $max photos du colis.';
  }

  @override
  String get proofPhotoFailed => 'La photo n’a pas pu être envoyée. Réessayez.';

  @override
  String get proofPhotoTooLarge => 'La photo est trop lourde (2 Mo au plus).';

  @override
  String get proofPhotoNotImage =>
      'Ce fichier n’est pas une photo (JPEG, PNG ou WebP).';

  @override
  String get proofPhotoNoPermission =>
      'Vous ne pouvez pas ajouter de photos ici.';

  @override
  String proofPhotoLimit(int max) {
    return '$max photos au plus.';
  }

  @override
  String get proofPhotoOpenFailed => 'La photo n’a pas pu être ouverte.';

  @override
  String get proofContentsTitle => 'Contenu';

  @override
  String get proofContentsNote =>
      'Facultatif. L’expéditeur confirme cette liste et la douane la lit.';

  @override
  String get proofItemLabel => 'Article';

  @override
  String get proofItemQuantity => 'Qté';

  @override
  String get proofItemSerial => 'N° de série / IMEI (facultatif)';

  @override
  String get proofAddItem => 'Ajouter un article';

  @override
  String get proofRemoveItem => 'Retirer l’article';

  @override
  String get proofWeight => 'Poids';

  @override
  String get proofDeclaredValue => 'Valeur déclarée';

  @override
  String get proofDeclaredValueNote => 'Jamais imprimée sur l’étiquette.';

  @override
  String get proofErrPhotoInvalid =>
      'Une des photos n’a pas pu être utilisée. Ajoutez-la à nouveau.';

  @override
  String get proofErrPhotoRequired => 'Ajoutez au moins une photo du colis.';

  @override
  String get proofErrContents =>
      'Vérifiez la liste : un nom de 60 caractères au plus, une quantité de 1 à 99 et un numéro de série facultatif.';

  @override
  String get proofErrWeight => 'Entrez un poids entre 0,1 et 2000 lb.';

  @override
  String get proofErrDeclaredValue =>
      'Entrez une valeur déclarée de 0 \$ ou plus.';

  @override
  String get proofErrPickupCode =>
      'Le code de retrait ne correspond pas. Demandez au destinataire le code reçu dans son message, ou livrez sans code.';

  @override
  String get proofErrOverride =>
      'Livrer sans code demande le nom de la personne qui retire et une photo.';

  @override
  String get proofErrSettings =>
      'Les réglages de preuve n’ont pas pu être enregistrés.';

  @override
  String get proofTickPhoto => 'Photo au dépôt';

  @override
  String get proofTickPhotoNone => 'Pas de photo au dépôt';

  @override
  String get proofTickSenderNone => 'Expéditeur non sollicité';

  @override
  String get proofTickSenderAsked => 'Expéditeur sollicité, sans réponse';

  @override
  String get proofTickSenderConfirmed => 'Expéditeur : confirmé';

  @override
  String get proofTickSenderProblem => 'L’expéditeur a signalé un problème';

  @override
  String get proofTickDelivered => 'Livré';

  @override
  String get proofTickDeliveredWithoutCode => 'Livré sans code';

  @override
  String get proofTickNotDelivered => 'Pas encore livré';

  @override
  String get proofMissingFilter => 'Preuve manquante';

  @override
  String get proofNoneMissing =>
      'Chaque colis ici a sa photo et l’accord de l’expéditeur.';

  @override
  String get proofProblemBanner => 'L’expéditeur a signalé un problème';

  @override
  String get proofOpenConversation => 'Ouvrir la conversation';

  @override
  String get proofLoadAnywayTitle => 'Charger quand même ?';

  @override
  String proofLoadAnywayMessage(String codes) {
    return 'L’expéditeur a signalé un problème avec $codes. Charger quand même ?';
  }

  @override
  String get proofLoadAnyway => 'Charger quand même';

  @override
  String proofWeightFact(String weight) {
    return 'Poids : $weight';
  }

  @override
  String proofValueFact(String value) {
    return 'Valeur déclarée : $value';
  }

  @override
  String get proofCustomerPhotos => 'Photos du client';

  @override
  String get proofDeliveredPhoto => 'Photo de remise';

  @override
  String proofPickupCodeFact(String code) {
    return 'Code de retrait : $code';
  }

  @override
  String get airModeTitle => 'Mer ou air';

  @override
  String get airModeSea => 'Mer';

  @override
  String get airModeAir => 'Air';

  @override
  String get airWaybill => 'Lettre de transport aérien (AWB)';

  @override
  String get airWaybillHint =>
      'Lettres, chiffres et tirets, comme 176-12345678';

  @override
  String get airAirline => 'Compagnie aérienne (facultatif)';

  @override
  String get airLabelOptionalNote =>
      'Facultatif dès qu’il y a une lettre de transport aérien.';

  @override
  String get airErrWaybill =>
      'Une lettre de transport aérien compte 6 à 20 lettres, chiffres ou tirets, comme 176-12345678.';

  @override
  String get airNewShipment => 'Nouvel envoi';

  @override
  String get airEditShipment => 'Modifier l’envoi';

  @override
  String get airCreated => 'Envoi créé.';

  @override
  String get airShipTitle => 'Marquer cet envoi comme parti ?';

  @override
  String get airArriveTitle => 'Marquer cet envoi prêt à récupérer ?';

  @override
  String get airArriveMessage =>
      'Les clients sont prévenus sur WhatsApp de l’endroit où récupérer leurs marchandises.';

  @override
  String get airDeleteTitle => 'Supprimer cet envoi ?';

  @override
  String get airDelete => 'Supprimer l’envoi';

  @override
  String get airDeleteMessage =>
      'Seul un envoi vide encore en chargement peut être supprimé.';

  @override
  String get airAddLine => 'Ajouter à l’envoi';

  @override
  String get airPkgSection => 'Envoi';

  @override
  String get airOpenShipment => 'Ouvrir l’envoi';

  @override
  String get airChip => 'Aérien';

  @override
  String get airLockedNote =>
      'Parti. La liste est le relevé de ce qui est parti ; seules les notes restent modifiables.';

  @override
  String get airCustomsList => 'Liste douane';

  @override
  String get deliverRefusalAirWaybillInvalid =>
      'Entrez une lettre de transport aérien de 6 à 20 lettres, chiffres ou tirets.';

  @override
  String get deliverRefusalPhotoInvalid =>
      'Une des photos n’a pas pu être utilisée. Ajoutez-la de nouveau.';

  @override
  String get deliverRefusalPhotoRequired =>
      'Ajoutez au moins une photo du colis.';

  @override
  String get deliverRefusalContentsInvalid =>
      'Vérifiez la liste des articles : un nom de 60 caractères au plus, une quantité de 1 à 99 et un numéro de série facultatif.';

  @override
  String get deliverRefusalWeightInvalid =>
      'Entrez un poids entre 0,1 et 2000 lb.';

  @override
  String get deliverRefusalDeclaredValueInvalid =>
      'Entrez une valeur déclarée de 0 \$ ou plus.';

  @override
  String get deliverRefusalPickupCodeInvalid =>
      'Le code de retrait ne correspond pas. Demandez au destinataire le code reçu dans son message, ou livrez sans code.';

  @override
  String get deliverRefusalOverrideIncomplete =>
      'Livrer sans code demande le nom de la personne qui récupère et une photo.';

  @override
  String get deliverRefusalCollectedCentsInvalid =>
      'Entrez le montant encaissé en dollars, zéro ou plus.';

  @override
  String get deliverRefusalProofSettingsInvalid =>
      'Vérifiez les réglages de preuve : chaque interrupteur est activé ou non.';

  @override
  String get deliverRefusalSenderProblem =>
      'L’expéditeur a signalé un problème sur ce colis. Vérifiez avec lui avant qu’il parte.';

  @override
  String get deliverPickupCodeLabel => 'Code de retrait';

  @override
  String get deliverPickupCodeHelper =>
      'Les 4 chiffres dans le message du destinataire.';

  @override
  String get deliverPickupCodeIncomplete => 'Entrez le code à 4 chiffres.';

  @override
  String get deliverWithoutCodeTitle => 'Livrer sans code';

  @override
  String get deliverWithoutCodeNote =>
      'Indiquez qui récupère le colis et prenez sa photo. Le colis affichera « Livré sans code ».';

  @override
  String get deliverCollectorLabel => 'Qui l’a récupéré';

  @override
  String get deliverPhotoLabel => 'Photo de la personne qui récupère';

  @override
  String get deliverTakePhoto => 'Prendre une photo';

  @override
  String get deliverRetakePhoto => 'Reprendre';

  @override
  String get deliverPhotoUploading => 'Envoi de la photo…';

  @override
  String get deliverPhotoAdded => 'Photo ajoutée';

  @override
  String get deliverPhotoFailed => 'Impossible d’ajouter la photo. Réessayez.';

  @override
  String get deliverCollectedNowLabel => 'Encaissé maintenant (USD)';

  @override
  String get deliverCollectedNowHelper =>
      'Facultatif. Dollars entiers encaissés à la remise.';

  @override
  String deliverOwes(String amount) {
    return 'Doit $amount';
  }

  @override
  String get deliverCollectedNowInvalid =>
      'Entrez des dollars entiers, zéro ou plus.';

  @override
  String deliverDoneCollected(String amount) {
    return 'Livré · $amount encaissés';
  }

  @override
  String get deliverWithoutCodePill => 'Livré sans code';

  @override
  String get deliverPhotoOfCollector => 'Photo de la personne qui l’a récupéré';

  @override
  String get deliverHomeTitle => 'Livraisons';

  @override
  String get deliverHomeSubtitle =>
      'Remettez les colis aux personnes qui les récupèrent.';

  @override
  String get deliverToHandOver => 'À remettre';

  @override
  String get deliverToHandOverEmpty => 'Rien à remettre pour le moment.';

  @override
  String get deliverToHandOverEmptyHint =>
      'Les colis apparaissent ici une fois leur envoi ou conteneur prêt à récupérer.';

  @override
  String get deliverScan => 'Scanner une étiquette';

  @override
  String get deliverEnterCode => 'Entrer un code';

  @override
  String get deliverEnterCodeHint => 'CL-XXXXXX';

  @override
  String get deliverCodeInvalid => 'Ce n’est pas un code de colis.';

  @override
  String get deliverFind => 'Chercher';

  @override
  String get deliverShipment => 'Envoi';

  @override
  String get deliverContainer => 'Conteneur';

  @override
  String deliverPieces(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count pièces',
      one: '1 pièce',
    );
    return '$_temp0';
  }

  @override
  String get deliverCouldNotLoad =>
      'Impossible de charger les livraisons. Vérifiez votre connexion et réessayez.';

  @override
  String get deliverRetry => 'Réessayer';

  @override
  String get deliverDetails => 'Détails';

  @override
  String get proofSettingTitle => 'Preuve';

  @override
  String get proofSettingPhotosRequired => 'Photos obligatoires au dépôt';

  @override
  String get proofSettingPhotosRequiredNote =>
      'Le personnel doit ajouter au moins une photo avant d’enregistrer un colis au comptoir.';

  @override
  String get proofSettingSenderConfirm =>
      'Demander à l’expéditeur de confirmer par WhatsApp';

  @override
  String get proofSettingSenderConfirmNote =>
      'Juste après le dépôt, l’expéditeur reçoit la première photo et la liste des articles avec OK / Something’s wrong.';

  @override
  String get proofSettingPickupCode => 'Code de retrait à la livraison';

  @override
  String get proofSettingPickupCodeNote =>
      'Chaque colis reçoit un code à 4 chiffres envoyé au destinataire ; votre agent le demande à la remise.';

  @override
  String get lookupTitle => 'Entrer le code du client';

  @override
  String get lookupHint =>
      'Tapez le code de la demande du client, par exemple R-K7M4P.';

  @override
  String get lookupCodeLabel => 'Code de la demande';

  @override
  String get lookupCodeInvalid =>
      'Un code de demande a 5 lettres ou chiffres, par exemple R-K7M4P.';

  @override
  String get lookupFind => 'Trouver la demande';

  @override
  String get lookupFinding => 'Recherche…';

  @override
  String get lookupNotFound =>
      'Aucune demande avec ce code pour cette entreprise.';

  @override
  String get pmeModeSoFar => 'Jusqu\'à aujourd\'hui';

  @override
  String get pmeModeWholeMonth => 'Mois entier (estimation)';

  @override
  String pmeEstimateNote(String lastDay) {
    return 'Estimation : les voitures encore garées sont comptées jusqu\'au $lastDay. Rien n\'est enregistré.';
  }

  @override
  String pmeEstimateHeader(String lastDay) {
    return 'ESTIMATION — mois entier, voitures encore garées comptées jusqu\'au $lastDay';
  }

  @override
  String get pmeExpensesTitle => 'Dépenses que vous avez payées pour le parc';

  @override
  String get pmeLessExpenses => 'Moins les dépenses';

  @override
  String pmeLessExpensesAmount(String amount) {
    return 'Moins les dépenses −$amount';
  }

  @override
  String get pmeLessStaffExpenses => 'Moins les dépenses du personnel';

  @override
  String get pmeLotExpense => 'Dépense du parc';

  @override
  String get pmeEarlierExpenses => 'Dépenses des mois précédents';

  @override
  String pmeExpenseLinesCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count dépenses ce mois-ci',
      one: '1 dépense ce mois-ci',
    );
    return '$_temp0';
  }

  @override
  String get pmeExpensesUnavailable =>
      'Les dépenses du personnel n\'ont pas pu être chargées : les factures sont affichées avant dépenses.';

  @override
  String get pmeBusinessOwes => 'L\'entreprise doit';

  @override
  String get pmeBusinessOwesHint =>
      'Dépenses payées par le personnel de sa poche, après ce qu\'il doit pour le stationnement.';

  @override
  String get pmeBusinessOwesNone =>
      'L\'entreprise ne doit rien à son personnel.';

  @override
  String get pmeNoParkingBill => 'Pas de facture de stationnement';

  @override
  String get pmePaidBack => 'Remboursé';

  @override
  String pmePaidBackSubtitle(String name, String amount) {
    return '$name · dû $amount';
  }

  @override
  String get pmePaidBackHint =>
      'Enregistrez l\'argent qui lui a été rendu. Il est déduit de ce que l\'entreprise doit.';

  @override
  String get pmePaidBackAmount => 'Montant remis';

  @override
  String get pmePaidBackGivenBy => 'Remis par';

  @override
  String get pmePaidBackWho => 'Qui a remis l\'argent';

  @override
  String get pmePaidBackSayWho => 'Indiquez qui a remis l\'argent.';

  @override
  String pmePaidBackAmountInvalid(String amount) {
    return 'Saisissez un montant supérieur à 0,00 \$, jusqu\'à $amount.';
  }

  @override
  String pmePaidBackDone(String amount) {
    return 'Remboursement de $amount enregistré.';
  }

  @override
  String get pmeRepaymentsThisMonth => 'Remboursé ce mois-ci';

  @override
  String pmeGivenByName(String name) {
    return 'par $name';
  }

  @override
  String get pmeVoidRepaymentTitle => 'Annuler ce remboursement ?';

  @override
  String pmeVoidRepaymentBody(String amount, String name) {
    return '$amount remis à $name sera compté comme non remboursé. Rien n\'est supprimé.';
  }

  @override
  String get pmeRepaymentVoided => 'Remboursement annulé.';

  @override
  String get pmeRefusalRepaymentAmountInvalid =>
      'Saisissez un montant supérieur à 0,00 \$.';

  @override
  String get pmeRefusalRepaymentExceedsCredit =>
      'C\'est plus que ce que l\'entreprise lui doit pour les dépenses.';

  @override
  String get pmeRefusalRepaymentNotFound => 'Ce remboursement est introuvable.';

  @override
  String get pmeRefusalRepaymentVoided => 'Ce remboursement a déjà été annulé.';

  @override
  String get pmeRefusalRepaymentMethodInvalid =>
      'Choisissez comment l\'argent a été remis.';

  @override
  String get pmeRefusalRepaymentDateInvalid =>
      'Cette date n\'est pas valide, ou elle est après aujourd\'hui.';

  @override
  String get pmeRefusalLinkCustomerInvalid =>
      'Ce client du stationnement est introuvable.';

  @override
  String get pmeRefusalStaffActionInvalid =>
      'Cette action n\'est pas disponible. Mettez l\'application à jour et réessayez.';

  @override
  String get pmeRefusalStaffNotMember =>
      'Cette personne ne fait pas partie de l\'équipe de cette entreprise.';

  @override
  String voidedNoteBy(String name) {
    return 'par $name';
  }

  @override
  String get lotVoidLine => 'Annuler le poste';

  @override
  String get lotVoidLineTitle => 'Annuler ce poste';

  @override
  String get lotVoidLineExplain =>
      'Annuler ce poste — il reste au registre (barré) et sort des totaux de chaque mois. Il n’est jamais supprimé.';

  @override
  String get lotLineVoidedStatus => 'Annulé';

  @override
  String get lotVoidLineDone => 'Poste annulé.';

  @override
  String get lotErrLineHasPurchases =>
      'Annulez d’abord les achats de ce poste.';

  @override
  String get lotErrLineVoided => 'Ce poste a déjà été annulé.';

  @override
  String get lotErrLineNotFound => 'Ce poste n’existe plus.';

  @override
  String get parkingVoid => 'Invalider';

  @override
  String get parkingVoidTitle => 'Invalider cette voiture';

  @override
  String get parkingVoidExplain =>
      'Invalider cette voiture — elle reste au registre (barrée) et sort des totaux ; elle n’est jamais supprimée. Les autres membres de l’équipe voient qui l’a invalidée et pourquoi.';

  @override
  String get parkingVoidedStatus => 'Invalidée';

  @override
  String get parkingVoidDone => 'Voiture invalidée.';

  @override
  String get parkingVoidedLocked =>
      'Cette voiture a été invalidée. Elle reste au registre mais ne compte plus nulle part et ne peut plus être modifiée.';

  @override
  String get parkingErrCarVoided =>
      'Cette voiture a été invalidée et ne peut plus être modifiée.';

  @override
  String get parkingErrCarNotFound => 'Cette voiture est introuvable.';

  @override
  String get parkingKindVoided => 'Invalidé';

  @override
  String get lotStopAfterMonth => 'Arrêter après ce mois';

  @override
  String get lotStopLineTitle => 'Arrêter ce poste';

  @override
  String lotStopLineExplain(String line, String month) {
    return '$line s’arrête après $month. Les mois précédents restent tels quels.';
  }

  @override
  String get lotStopLineConfirm => 'Arrêter';

  @override
  String get lotStopLineDone => 'Poste arrêté.';

  @override
  String lotStoppedAfter(String month) {
    return 'Arrêté après $month';
  }

  @override
  String get lotLineStoppedStatus => 'Arrêté';

  @override
  String get lotResumeLine => 'Reprendre';

  @override
  String get lotResumeLineTitle => 'Reprendre ce poste';

  @override
  String lotResumeLineExplain(String line) {
    return '$line compte de nouveau chaque mois, sans fin.';
  }

  @override
  String get lotResumeLineDone => 'Poste repris.';

  @override
  String get lotErrEndMonthInvalid => 'Choisissez un mois valide.';

  @override
  String get lotErrEndMonthBeforePurchases =>
      'Ce poste a des achats après ce mois.';

  @override
  String get parkingWaSwitchTitle =>
      'Envoyer des messages WhatsApp aux clients du parking';

  @override
  String get parkingWaSwitchHelp =>
      'Les clients reçoivent un message quand leur voiture est garée et un reçu à chaque paiement. Rien n\'est envoyé tant que ce réglage est désactivé.';

  @override
  String get parkingWaSwitchFailed =>
      'Impossible de modifier ce réglage. Réessayez.';

  @override
  String get parkingWaErrOwnerOnly =>
      'Seul le propriétaire de l\'entreprise peut modifier ceci.';

  @override
  String get parkingWaWelcomeButton =>
      'Envoyer un message de bienvenue aux clients actuels';

  @override
  String get parkingWaWelcomeTitle =>
      'Souhaiter la bienvenue aux clients actuels';

  @override
  String get parkingWaWelcomeIntro =>
      'Un message WhatsApp par numéro de téléphone, avec la liste des voitures de ce numéro. Il part une seule fois, jamais automatiquement.';

  @override
  String get parkingWaWelcomeLoading => 'Recherche de vos clients…';

  @override
  String get parkingWaWelcomeEmpty =>
      'Aucun client n\'a de voiture dans le parking en ce moment.';

  @override
  String get parkingWaWelcomeLoadFailed =>
      'Impossible de charger vos clients. Réessayez.';

  @override
  String get parkingWaWelcomeSendFailed =>
      'Le message de bienvenue n\'a pas pu être envoyé. Réessayez.';

  @override
  String get parkingWaWelcomeAlready => 'Déjà accueilli';

  @override
  String get parkingWaWelcomeSelectAll => 'Tout sélectionner';

  @override
  String get parkingWaWelcomeSelectNone => 'Tout désélectionner';

  @override
  String parkingWaWelcomeSendCount(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: 'Envoyer à $count clients',
      one: 'Envoyer à 1 client',
    );
    return '$_temp0';
  }

  @override
  String get parkingWaWelcomeSending => 'Envoi en cours…';

  @override
  String get parkingWaWelcomeResultTitle => 'Bienvenue envoyé';

  @override
  String parkingWaWelcomeResult(int sent, int skipped, int failed) {
    return 'Envoyés $sent · Ignorés $skipped · Échecs $failed';
  }

  @override
  String get parkingWaErrSwitchOff =>
      'Les messages WhatsApp sont désactivés pour cette entreprise.';

  @override
  String get parkingWaErrWelcomeOwnerOnly =>
      'Seul le propriétaire de l\'entreprise peut envoyer le message de bienvenue.';

  @override
  String get parkingWaMessagesTitle => 'Messages WhatsApp';

  @override
  String get parkingWaKindParked => 'Voiture garée';

  @override
  String get parkingWaKindReceipt => 'Reçu de paiement';

  @override
  String get parkingWaKindWelcome => 'Bienvenue';

  @override
  String get parkingWaStatusQueued => 'En attente';

  @override
  String get parkingWaStatusSent => 'Envoyé';

  @override
  String get parkingWaStatusDelivered => 'Remis';

  @override
  String get parkingWaStatusRead => 'Lu';

  @override
  String get parkingWaStatusFailed => 'Échec';

  @override
  String get parkingWaStatusStopped => 'Arrêté par le client';

  @override
  String get parkingWaStatusSkipped => 'Ignoré';

  @override
  String get parkingTrackMoneyTitle => 'Solde du parking';

  @override
  String get parkingTrackDailyRate => 'Tarif par jour';

  @override
  String get parkingTrackSince => 'Garée depuis le';

  @override
  String get parkingTrackLeft => 'Partie le';

  @override
  String get parkingTrackDaysSoFar => 'Jours jusqu\'ici';

  @override
  String get parkingTrackDays => 'Jours de parking';

  @override
  String get parkingTrackAmountSoFar => 'Montant jusqu\'ici';

  @override
  String get parkingTrackAmount => 'Montant total';

  @override
  String get parkingTrackPaid => 'Payé';

  @override
  String get parkingTrackBalanceNow => 'Solde dû maintenant';

  @override
  String get parkingTrackBalance => 'Solde dû';

  @override
  String get parkingTrackPaidInFull => 'Payé en totalité';

  @override
  String get shipsByLabel => 'Expédié par';

  @override
  String get shipsByAirBadge => 'Avion';

  @override
  String get wpkErrShipModeMismatch =>
      'Ce colis est prévu par mer ; ceci est un envoi aérien. Changez d\'abord « Expédié par » du colis.';

  @override
  String get wpkErrShipModeMismatchAir =>
      'Ce colis est prévu par avion ; ceci est un conteneur maritime. Changez d\'abord « Expédié par » du colis.';

  @override
  String get wpkErrShipModeLocked =>
      'Ce colis est déjà sur un conteneur : il part comme lui. Retirez-le d\'abord pour changer « Expédié par ».';

  @override
  String get wpkErrShipModeInvalid =>
      'Choisissez comment le colis est expédié : mer ou avion.';

  @override
  String get wpkBlockedShipsBySea => 'Par mer ; ceci est un envoi aérien';

  @override
  String get wpkBlockedShipsByAir =>
      'Par avion ; ceci est un conteneur maritime';

  @override
  String get sbalTitle => 'Soldes du personnel';

  @override
  String get sbalMenuSubtitle =>
      'Qui détient de l\'argent, qui doit, à qui on doit';

  @override
  String get sbalBusinessAccount => 'Compte de l\'entreprise';

  @override
  String sbalWaitingBadge(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count en attente de vous',
      one: '1 en attente de vous',
    );
    return '$_temp0';
  }

  @override
  String get sbalIntro =>
      'Ce que chaque personne détient de l\'argent de l\'entreprise, ce qu\'elle doit pour le parking et ce que l\'entreprise lui doit pour ses dépenses.';

  @override
  String get sbalHolds => 'Détient';

  @override
  String get sbalParking => 'Parking';

  @override
  String get sbalExpensesOwed => 'Dépenses dues';

  @override
  String get sbalNet => 'Solde';

  @override
  String sbalOwes(Object amount) {
    return 'doit $amount';
  }

  @override
  String sbalIsOwed(Object amount) {
    return 'on lui doit $amount';
  }

  @override
  String get sbalSettled => 'à jour';

  @override
  String get sbalLoadFailed =>
      'Impossible de charger les soldes. Vérifiez votre connexion et réessayez.';

  @override
  String get sbalTryAgain => 'Réessayer';

  @override
  String get sbalEmpty => 'Personne dans l\'équipe pour l\'instant.';

  @override
  String sbalAsOf(Object time) {
    return 'Au $time';
  }

  @override
  String get sbalWaitingOnYou => 'En attente de vous';

  @override
  String get sbalOtherPending => 'Autres remises en attente';

  @override
  String get sbalHandOver => 'Remettre de l\'argent';

  @override
  String get sbalOpening => 'Montant d\'ouverture';

  @override
  String get sbalConfirm => 'Confirmer la réception';

  @override
  String get sbalDecline => 'Refuser';

  @override
  String get sbalVoid => 'Annuler';

  @override
  String sbalHandedLine(Object from, Object amount, Object to) {
    return '$from a remis $amount à $to';
  }

  @override
  String sbalOpeningLine(Object name, Object amount) {
    return '$name · montant d\'ouverture $amount';
  }

  @override
  String get sbalStatusPending => 'En attente de confirmation';

  @override
  String get sbalStatusConfirmed => 'Confirmé';

  @override
  String get sbalStatusDeclined => 'Refusé';

  @override
  String get sbalStatusVoided => 'Annulé';

  @override
  String get sbalMethodCash => 'Espèces';

  @override
  String get sbalMethodZelle => 'Zelle';

  @override
  String get sbalMethodCheck => 'Chèque';

  @override
  String get sbalMethodDeposit => 'Dépôt';

  @override
  String get sbalMethodOther => 'Autre';

  @override
  String get sbalViewPhoto => 'Voir la photo';

  @override
  String get sbalPhotoOpenFailed => 'La photo n\'a pas pu être ouverte.';

  @override
  String get sbalDetailCollected => 'Encaissé auprès des clients';

  @override
  String get sbalDetailHandedOut => 'Remis';

  @override
  String get sbalDetailReceived => 'Reçu d\'autres personnes';

  @override
  String get sbalDetailPendingOut => 'Remis, pas encore confirmé';

  @override
  String get sbalDetailPendingIn => 'À recevoir, pas encore confirmé';

  @override
  String get sbalDetailHolds => 'Détient maintenant';

  @override
  String get sbalDetailParking => 'Facture de parking (après dépenses)';

  @override
  String get sbalDetailExpensesApplied =>
      'Dépenses déduites de la facture de parking';

  @override
  String get sbalDetailExpensesOwed => 'Dépenses que l\'entreprise leur doit';

  @override
  String get sbalHistory => 'Historique';

  @override
  String get sbalHistoryEmpty => 'Rien d\'enregistré pour l\'instant.';

  @override
  String sbalBusinessAccountReceived(Object amount) {
    return 'Reçu jusqu\'ici : $amount';
  }

  @override
  String sbalBusinessAccountComing(Object amount) {
    return 'En route : $amount';
  }

  @override
  String get sbalTo => 'Remis à';

  @override
  String get sbalChoosePerson => 'Choisir qui';

  @override
  String get sbalAmount => 'Montant (dollars US)';

  @override
  String get sbalMethod => 'Comment vous l\'avez remis';

  @override
  String get sbalNote => 'Note (facultatif)';

  @override
  String get sbalAddPhoto => 'Ajouter une photo du reçu';

  @override
  String get sbalRetakePhoto => 'Reprendre la photo';

  @override
  String get sbalPhotoAdded => 'Photo ajoutée';

  @override
  String get sbalPhotoFailed => 'La photo n\'a pas pu être ajoutée. Réessayez.';

  @override
  String get sbalSendForConfirmation => 'Envoyer pour confirmation';

  @override
  String get sbalHandOverHint =>
      'Reste en attente jusqu\'à ce que la personne qui la reçoit confirme.';

  @override
  String sbalHandOverDone(Object amount, Object to) {
    return 'Remise de $amount envoyée à $to. Elle doit être confirmée.';
  }

  @override
  String get sbalAmountInvalid => 'Saisissez un montant supérieur à 0,00 \$.';

  @override
  String get sbalSayWho => 'Choisissez à qui vous l\'avez remis.';

  @override
  String get sbalOpeningHint =>
      'Ce que cette personne avait déjà remis avant les soldes du personnel. Enregistré et confirmé en une étape.';

  @override
  String get sbalOpeningPerson => 'Personne';

  @override
  String get sbalOpeningSave => 'Enregistrer le montant d\'ouverture';

  @override
  String sbalOpeningDone(Object amount, Object name) {
    return 'Montant d\'ouverture de $amount enregistré pour $name.';
  }

  @override
  String get sbalConfirmDone => 'Marqué comme reçu.';

  @override
  String get sbalDeclineTitle => 'Refuser cette remise ?';

  @override
  String sbalDeclineBody(Object from, Object amount) {
    return '$from verra que vous n\'avez pas reçu $amount.';
  }

  @override
  String get sbalDeclineNote => 'Pourquoi (facultatif)';

  @override
  String get sbalDeclineDone => 'Remise refusée.';

  @override
  String get sbalVoidTitle => 'Annuler cette remise ?';

  @override
  String sbalVoidBody(Object amount) {
    return 'La remise de $amount comptera comme jamais effectuée. Rien n\'est supprimé.';
  }

  @override
  String get sbalVoidReason => 'Motif (facultatif)';

  @override
  String get sbalVoidDone => 'Remise annulée.';

  @override
  String get sbalRefusalToSelf =>
      'Vous ne pouvez pas vous remettre de l\'argent à vous-même.';

  @override
  String get sbalRefusalAmountInvalid =>
      'Ce montant n\'est pas valide. Saisissez un montant supérieur à 0,00 \$.';

  @override
  String get sbalRefusalMethodInvalid =>
      'Choisissez comment l\'argent a été remis.';

  @override
  String get sbalRefusalReceiverInvalid =>
      'Cette personne ne fait pas partie de l\'équipe de cette entreprise.';

  @override
  String get sbalRefusalNotReceiver =>
      'Seule la personne qui reçoit cette remise (ou le propriétaire, pour le compte de l\'entreprise) peut y répondre.';

  @override
  String get sbalRefusalNotPending =>
      'Cette remise a déjà reçu une réponse. Actualisez pour voir où elle en est.';

  @override
  String get sbalRefusalOpeningOwnerOnly =>
      'Seul le propriétaire peut enregistrer un montant d\'ouverture.';
}
