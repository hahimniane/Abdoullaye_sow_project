// DO NOT EDIT. This is code generated via package:intl/generate_localized.dart
// This is a library that provides messages for a fr locale. All the
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
  String get localeName => 'fr';

  static String m0(mileage) => "Kilométrage: ${mileage}";

  static String m1(carTitle, carYear, carPrice) =>
      "Bonjour ! Je suis intéressé par la ${carTitle} (${carYear}) pour ${carPrice}. Pouvez-vous me donner plus de détails ?";

  static String m2(year) => "Année: ${year}";

  final messages = _notInlinedMessages(_notInlinedMessages);
  static Map<String, Function> _notInlinedMessages(_) => <String, Function>{
    "address": MessageLookupByLibrary.simpleMessage("Adresse"),
    "backToLogin": MessageLookupByLibrary.simpleMessage(
      "Retour à la connexion",
    ),
    "barrelShippingService": MessageLookupByLibrary.simpleMessage(
      "Service d\'Expédition de Barils",
    ),
    "browseAvailableCarsForSale": MessageLookupByLibrary.simpleMessage(
      "Parcourir les voitures disponibles à vendre",
    ),
    "carDescription": MessageLookupByLibrary.simpleMessage(
      "Description de la Voiture",
    ),
    "carDetails": MessageLookupByLibrary.simpleMessage("Détails de la Voiture"),
    "carMake": MessageLookupByLibrary.simpleMessage("Marque de la Voiture"),
    "carModel": MessageLookupByLibrary.simpleMessage("Modèle de la Voiture"),
    "carParkingService": MessageLookupByLibrary.simpleMessage(
      "Service de Stationnement",
    ),
    "carSalesService": MessageLookupByLibrary.simpleMessage(
      "Service de Vente de Voitures",
    ),
    "carTransportService": MessageLookupByLibrary.simpleMessage(
      "Service de Transport de Voitures",
    ),
    "carYear": MessageLookupByLibrary.simpleMessage("Année de la Voiture"),
    "chatWithSeller": MessageLookupByLibrary.simpleMessage(
      "Discuter avec le Vendeur",
    ),
    "chooseServiceToStart": MessageLookupByLibrary.simpleMessage(
      "Choisissez un service pour commencer",
    ),
    "contactInfo": MessageLookupByLibrary.simpleMessage(
      "Informations de Contact",
    ),
    "contactSeller": MessageLookupByLibrary.simpleMessage(
      "Contacter le Vendeur",
    ),
    "email": MessageLookupByLibrary.simpleMessage("Email"),
    "emailSent": MessageLookupByLibrary.simpleMessage("Email envoyé !"),
    "emailSentMessage": MessageLookupByLibrary.simpleMessage(
      "Nous avons envoyé un lien de réinitialisation à votre adresse email. Veuillez vérifier votre boîte de réception et suivre les instructions.",
    ),
    "english": MessageLookupByLibrary.simpleMessage("Anglais"),
    "enterCarDetailsToGenerateReceipt": MessageLookupByLibrary.simpleMessage(
      "Entrez les détails de la voiture pour générer un reçu",
    ),
    "enterCarTransportDetailsForGuinea": MessageLookupByLibrary.simpleMessage(
      "Entrez les détails de transport pour la Guinée",
    ),
    "enterEmail": MessageLookupByLibrary.simpleMessage("Entrez votre email"),
    "enterEmailToReset": MessageLookupByLibrary.simpleMessage(
      "Entrez votre email pour réinitialiser votre mot de passe",
    ),
    "enterPassword": MessageLookupByLibrary.simpleMessage(
      "Entrez votre mot de passe",
    ),
    "enterShippingDetailsForGuinea": MessageLookupByLibrary.simpleMessage(
      "Entrez les détails d\'expédition pour la Guinée",
    ),
    "features": MessageLookupByLibrary.simpleMessage("Caractéristiques"),
    "fordEscape": MessageLookupByLibrary.simpleMessage("Ford Escape"),
    "forgotPassword": MessageLookupByLibrary.simpleMessage(
      "Mot de passe oublié ?",
    ),
    "forgotPasswordTitle": MessageLookupByLibrary.simpleMessage(
      "Mot de passe oublié ?",
    ),
    "french": MessageLookupByLibrary.simpleMessage("Français"),
    "hondaAccord": MessageLookupByLibrary.simpleMessage("Honda Accord"),
    "language": MessageLookupByLibrary.simpleMessage("Langue"),
    "make": MessageLookupByLibrary.simpleMessage("Marque"),
    "mileage": MessageLookupByLibrary.simpleMessage("kilométrage"),
    "mileageLabel": m0,
    "model": MessageLookupByLibrary.simpleMessage("Modèle"),
    "name": MessageLookupByLibrary.simpleMessage("Nom"),
    "noResultsFound": MessageLookupByLibrary.simpleMessage(
      "Aucun résultat trouvé",
    ),
    "ownerName": MessageLookupByLibrary.simpleMessage("Nom du Propriétaire"),
    "parkACar": MessageLookupByLibrary.simpleMessage("Garer une Voiture"),
    "parkingDate": MessageLookupByLibrary.simpleMessage(
      "Date de Stationnement",
    ),
    "password": MessageLookupByLibrary.simpleMessage("Mot de passe"),
    "passwordMinLength": MessageLookupByLibrary.simpleMessage(
      "Le mot de passe doit contenir au moins 6 caractères",
    ),
    "pleaseEnterEmail": MessageLookupByLibrary.simpleMessage(
      "Veuillez entrer votre email",
    ),
    "pleaseEnterPassword": MessageLookupByLibrary.simpleMessage(
      "Veuillez entrer votre mot de passe",
    ),
    "pleaseEnterValidEmail": MessageLookupByLibrary.simpleMessage(
      "Veuillez entrer un email valide",
    ),
    "price": MessageLookupByLibrary.simpleMessage("Prix"),
    "printReceipt": MessageLookupByLibrary.simpleMessage("Imprimer le Reçu"),
    "receiverName": MessageLookupByLibrary.simpleMessage("Nom du Destinataire"),
    "receiverPhone": MessageLookupByLibrary.simpleMessage(
      "Téléphone du Destinataire",
    ),
    "resetPassword": MessageLookupByLibrary.simpleMessage(
      "Réinitialiser le mot de passe",
    ),
    "searchCars": MessageLookupByLibrary.simpleMessage(
      "Rechercher des voitures...",
    ),
    "sellCars": MessageLookupByLibrary.simpleMessage("Vendre des Voitures"),
    "sendBarrelsToGuinea": MessageLookupByLibrary.simpleMessage(
      "Envoyer des Barils en Guinée",
    ),
    "sendWhatsAppMessage": MessageLookupByLibrary.simpleMessage(
      "Envoyer un Message WhatsApp",
    ),
    "senderName": MessageLookupByLibrary.simpleMessage("Nom de l\'Expéditeur"),
    "signIn": MessageLookupByLibrary.simpleMessage("Se Connecter"),
    "signInToAccount": MessageLookupByLibrary.simpleMessage(
      "Connectez-vous à votre compte",
    ),
    "submit": MessageLookupByLibrary.simpleMessage("Soumettre"),
    "toyotaCamry": MessageLookupByLibrary.simpleMessage("Toyota Camry"),
    "transportCarsToGuinea": MessageLookupByLibrary.simpleMessage(
      "Transporter des Voitures en Guinée",
    ),
    "transportDate": MessageLookupByLibrary.simpleMessage("Date de Transport"),
    "tryDifferentSearch": MessageLookupByLibrary.simpleMessage(
      "Essayez un autre terme de recherche",
    ),
    "viewMorePhotos": MessageLookupByLibrary.simpleMessage(
      "Voir Plus de Photos",
    ),
    "vinNumber": MessageLookupByLibrary.simpleMessage("Numéro VIN"),
    "welcomeBack": MessageLookupByLibrary.simpleMessage("Bon Retour"),
    "welcomeToBusinessServices": MessageLookupByLibrary.simpleMessage(
      "Bienvenue aux Services Commerciaux",
    ),
    "whatsAppMessage": m1,
    "year": MessageLookupByLibrary.simpleMessage("Année"),
    "yearLabel": m2,
  };
}
