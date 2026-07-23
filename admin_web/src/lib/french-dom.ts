"use client";

import { useEffect } from "react";

import { LANGUAGE_STORAGE_KEY, currentWebLanguage } from "./language.ts";

export { resolveLang } from "./language.ts";

const CUSTOMER_SHIPPING_TRANSLATIONS: Record<string, string> = {
  "Almost there": "Vous y êtes presque",
  "Calculate pickup & continue": "Calculer la collecte et continuer",
  "Close account access": "Fermer l’accès au compte",
  "Compare first. Create an account only when you continue.":
    "Comparez d’abord. Créez un compte seulement lorsque vous continuez.",
  "Enter a New York pickup address":
    "Saisissez une adresse de collecte à New York",
  "Explore services": "Découvrir les services",
  "No account needed to compare options and prepare your request.":
    "Aucun compte n’est nécessaire pour comparer les options et préparer votre demande.",
  "Open my workspace": "Ouvrir mon espace client",
  "Prepare your service request": "Préparez votre demande de service",
  "Access your Laawol account": "Accédez à votre compte Laawol",
  "Sign in to open your workspace, or create an account if you are new to Laawol.":
    "Connectez-vous pour ouvrir votre espace, ou créez un compte si vous découvrez Laawol.",
  "Save your barrel request": "Enregistrez votre demande de baril",
  "Save your car request": "Enregistrez votre demande de voiture",
  "Save your car transport request":
    "Enregistrez votre demande de transport de véhicule",
  "Save your freight request": "Enregistrez votre demande de fret",
  "Save your parking request": "Enregistrez votre demande de stationnement",
  "Save your shared-barrel request":
    "Enregistrez votre demande de baril partagé",
  "Securing your account and restoring the request...":
    "Sécurisation de votre compte et restauration de la demande...",
  "Sign in or create a free account only when you are ready to save and continue.":
    "Connectez-vous ou créez un compte gratuit seulement lorsque vous êtes prêt à enregistrer et continuer.",
  "Sign in or create a free account to save this request and continue. Your details will stay here.":
    "Connectez-vous ou créez un compte gratuit pour enregistrer cette demande et continuer. Vos informations resteront ici.",
  "Sign in to browse shares": "Se connecter pour voir les parts",
  "Sign in to save & continue": "Se connecter pour enregistrer et continuer",
  "Sign in to see available shared barrels":
    "Connectez-vous pour voir les barils partagés disponibles",
  "Sign in to see parking": "Se connecter pour voir le stationnement",
  "You can still prepare a new shared-barrel request before creating an account.":
    "Vous pouvez toujours préparer une nouvelle demande de baril partagé avant de créer un compte.",
  "Your request is ready to continue.":
    "Votre demande est prête à continuer.",
  "Shipping services": "Services d’expédition",
  "Move what matters, with a business you choose":
    "Transportez ce qui compte avec l’entreprise de votre choix",
  "Compare approved providers, review every detail, and pay securely when payment is required.":
    "Comparez les prestataires approuvés, vérifiez chaque détail et payez en toute sécurité lorsqu’un paiement est requis.",
  "Send one or more barrels": "Envoyez un ou plusieurs barils",
  "Air or sea by weight": "Par avion ou bateau, selon le poids",
  "Request a business quote": "Demandez un devis à une entreprise",
  "Shipping options could not be loaded. Try again.":
    "Les options d’expédition n’ont pas pu être chargées. Réessayez.",
  "We couldn't securely load barrel and freight destinations. Refresh and try again. Local previews must be registered with Firebase App Check.":
    "Nous n’avons pas pu charger les destinations de barils et de fret de manière sécurisée. Actualisez la page et réessayez. Les aperçus locaux doivent être enregistrés auprès de Firebase App Check.",
  "We couldn't securely load car transport providers. Refresh and try again. Local previews must be registered with Firebase App Check.":
    "Nous n’avons pas pu charger les prestataires de transport automobile de manière sécurisée. Actualisez la page et réessayez. Les aperçus locaux doivent être enregistrés auprès de Firebase App Check.",
  "Shipping destinations could not be loaded":
    "Les destinations d’expédition n’ont pas pu être chargées",
  "Car transport providers could not be loaded":
    "Les prestataires de transport automobile n’ont pas pu être chargés",
  "Retry": "Réessayer",
  "Loading shipping options...": "Chargement des options d’expédition...",
  "Barrel shipping is temporarily unavailable":
    "L’expédition de barils est temporairement indisponible",
  "No approved barrel destinations are available right now.":
    "Aucune destination approuvée pour les barils n’est disponible actuellement.",
  "Choose an approved business and destination. Your total is calculated securely by Laawol.":
    "Choisissez une entreprise approuvée et une destination. Votre total est calculé de manière sécurisée par Laawol.",
  "Send a barrel": "Envoyer un baril",
  "Sender name": "Nom de l’expéditeur",
  "Destination and business": "Destination et entreprise",
  "Choose a destination and business":
    "Choisissez une destination et une entreprise",
  "Number of barrels": "Nombre de barils",
  "Request pickup": "Demander la collecte",
  "Choose an address and appointment time.":
    "Choisissez une adresse et une heure de rendez-vous.",
  "Use my available wallet balance": "Utiliser le solde disponible du portefeuille",
  "Any remaining amount continues to secure payment.":
    "Tout montant restant sera réglé par paiement sécurisé.",
  "Continue to secure payment": "Continuer vers le paiement sécurisé",
  "Use available balance": "Utiliser le solde disponible",
  "Do not use": "Ne pas utiliser",
  "Drop off": "Dépôt sur place",
  "The barrel shipment could not be started. Check the details and try again.":
    "L’expédition du baril n’a pas pu être lancée. Vérifiez les détails et réessayez.",
  "Choose air or sea freight. The approved business verifies the final weight before settlement.":
    "Choisissez le fret aérien ou maritime. L’entreprise approuvée vérifie le poids final avant le règlement.",
  "Send freight": "Envoyer du fret",
  "Shipping method": "Mode d’expédition",
  "Air freight": "Fret aérien",
  "Sea freight": "Fret maritime",
  "Estimated weight (kg)": "Poids estimé (kg)",
  "Estimated weight": "Poids estimé",
  "Live pickup quote": "Devis de collecte en direct",
  "The fee comes directly from the selected business's pickup rules.":
    "Les frais proviennent directement des règles de collecte de l’entreprise sélectionnée.",
  "Get pickup quote": "Obtenir le devis de collecte",
  "Calculating...": "Calcul en cours...",
  "Pickup quote": "Devis de collecte",
  "Pickup is not available from this business. Choose drop off or another provider.":
    "La collecte n’est pas disponible auprès de cette entreprise. Choisissez le dépôt sur place ou un autre prestataire.",
  "This freight mode is temporarily unavailable":
    "Ce mode de fret est temporairement indisponible",
  "No approved businesses currently have a rate for this freight mode.":
    "Aucune entreprise approuvée ne propose actuellement de tarif pour ce mode de fret.",
  "The freight shipment could not be started. Check the details and try again.":
    "L’expédition de fret n’a pas pu être lancée. Vérifiez les détails et réessayez.",
  "The pickup quote could not be calculated. Check the address and try again.":
    "Le devis de collecte n’a pas pu être calculé. Vérifiez l’adresse et réessayez.",
  "Verified-weight balances": "Soldes après vérification du poids",
  "Complete a balance after the business confirms final weight.":
    "Réglez le solde après confirmation du poids final par l’entreprise.",
  "Opening payment...": "Ouverture du paiement...",
  "Pay balance": "Payer le solde",
  "The freight balance payment could not be started. Try again.":
    "Le paiement du solde de fret n’a pas pu être lancé. Réessayez.",
  "Request car transport": "Demander le transport d’une voiture",
  "Send the vehicle details to an approved business. They will review your request and provide the price.":
    "Envoyez les détails du véhicule à une entreprise approuvée. Elle examinera votre demande et fournira le prix.",
  "Vehicle owner": "Propriétaire du véhicule",
  "Contact phone": "Téléphone de contact",
  "Car make": "Marque de la voiture",
  "For example, Toyota": "Par exemple, Toyota",
  "Car model": "Modèle de la voiture",
  "For example, RAV4": "Par exemple, RAV4",
  "Car year": "Année de la voiture",
  "VIN number (optional)": "Numéro VIN (facultatif)",
  "Preferred transport date (optional)":
    "Date de transport souhaitée (facultatif)",
  "Pickup address (optional)": "Adresse de collecte (facultatif)",
  "Street, city, state, ZIP code": "Rue, ville, État, code postal",
  "Notes for the business (optional)": "Notes pour l’entreprise (facultatif)",
  "Share vehicle condition or pickup details":
    "Indiquez l’état du véhicule ou les détails de collecte",
  "Request business quote": "Demander un devis à l’entreprise",
  "Preferred date": "Date souhaitée",
  Flexible: "Flexible",
  "The transport request could not be submitted. Check the details and try again.":
    "La demande de transport n’a pas pu être envoyée. Vérifiez les détails et réessayez.",
  "Car transport is temporarily unavailable":
    "Le transport de voitures est temporairement indisponible",
  "No approved car transport businesses are available right now.":
    "Aucune entreprise approuvée de transport de voitures n’est disponible actuellement.",
  "Request received": "Demande reçue",
  "Your car transport quote is underway":
    "Votre devis de transport de voiture est en préparation",
  "The selected business will review the vehicle and destination before setting a price.":
    "L’entreprise sélectionnée examinera le véhicule et la destination avant de fixer un prix.",
  "Tracking code:": "Code de suivi :",
  "Start another request": "Commencer une autre demande",
  "Selected from the address": "Sélectionné à partir de l’adresse",
  "Pickup date and time": "Date et heure de collecte",
  "Start typing a New York pickup address":
    "Commencez à saisir une adresse de collecte à New York",
  "The request timed out. Try again.": "La demande a expiré. Réessayez.",
};

export const TEXT_TRANSLATIONS: Record<string, string> = {
  ...CUSTOMER_SHIPPING_TRANSLATIONS,
  "Return wallet balance": "Rembourser le solde du portefeuille",
  "Return to card": "Retour vers la carte",
  "Move your available balance back to your payment card.":
    "Renvoyez votre solde disponible vers votre carte de paiement.",
  "The full available balance is reserved for refund. Laawol confirms the final amount securely on the server.":
    "La totalité du solde disponible est réservée au remboursement. Laawol confirme le montant final de façon sécurisée sur le serveur.",
  " is already being returned.": " est déjà en cours de remboursement.",
  "Your return to card was requested. We will send an update when it is processed.":
    "Votre retour vers la carte a été demandé. Nous vous informerons lorsqu’il sera traité.",
  "The return to card could not be requested. Try again.":
    "Le retour vers la carte n’a pas pu être demandé. Réessayez.",
  "Request return to card": "Demander le retour vers la carte",
  "Return ": "Renvoyer ",
  " to the original card?": " vers la carte d’origine ?",
  "Requesting return...": "Demande de retour...",
  "Confirm card return": "Confirmer le retour vers la carte",
  "Keep in wallet": "Conserver dans le portefeuille",
  "Copy tracking number": "Copier le numéro de suivi",
  "Tracking number copied": "Numéro de suivi copié",
  "Open carrier tracking": "Ouvrir le suivi du transporteur",
  "The tracking number could not be copied. Select and copy it manually.":
    "Le numéro de suivi n’a pas pu être copié. Sélectionnez-le et copiez-le manuellement.",
  "Shipment tracking": "Suivi des expéditions",
  "Follow your Laawol status or continue on the carrier’s secure site.":
    "Suivez le statut Laawol ou continuez sur le site sécurisé du transporteur.",
  "Search tracking": "Rechercher un suivi",
  "Tracking number, destination, or business":
    "Numéro de suivi, destination ou entreprise",
  "No tracked shipments match your search.":
    "Aucune expédition suivie ne correspond à votre recherche.",
  "Tracking number": "Numéro de suivi",
  "Destination not set": "Destination non définie",
  "Real people, one secure conversation.":
    "De vraies personnes, une conversation sécurisée.",
  "Ask about one of your Laawol orders and see replies here in real time. Text messages are available on web.":
    "Posez une question sur l’une de vos commandes Laawol et consultez les réponses ici en temps réel. Les messages texte sont disponibles sur le web.",
  "Start a support request": "Démarrer une demande d’assistance",
  "Support is taking longer to load. Try again.":
    "Le chargement de l’assistance prend plus de temps. Réessayez.",
  "Your support conversations could not be loaded.":
    "Vos conversations d’assistance n’ont pas pu être chargées.",
  "The support request could not be opened. Try again.":
    "La demande d’assistance n’a pas pu être ouverte. Réessayez.",
  "Loading support conversations...":
    "Chargement des conversations d’assistance...",
  "No support conversations yet.":
    "Aucune conversation d’assistance pour le moment.",
  "Open an order and choose support when you need help.":
    "Ouvrez une commande et choisissez l’assistance lorsque vous avez besoin d’aide.",
  "Laawol order": "Commande Laawol",
  "Open conversation": "Ouvrir la conversation",
  "Get help with an order": "Obtenir de l’aide pour une commande",
  "The selected provider and Laawol support can reply here.":
    "Le prestataire sélectionné et l’assistance Laawol peuvent répondre ici.",
  "Related order": "Commande concernée",
  "Normal": "Normale",
  "Urgent": "Urgente",
  "Service blocked": "Service bloqué",
  "What do you need help with?": "Pour quoi avez-vous besoin d’aide ?",
  "Share the details that will help us answer.":
    "Partagez les détails qui nous aideront à répondre.",
  "Opening conversation...": "Ouverture de la conversation...",
  "Open support conversation": "Ouvrir une conversation d’assistance",
  "Back to support conversations": "Retour aux conversations d’assistance",
  "Secure support": "Assistance sécurisée",
  "Support conversation": "Conversation d’assistance",
  "This conversation is taking longer to load. Try again.":
    "Le chargement de cette conversation prend plus de temps. Réessayez.",
  "This support conversation could not be loaded.":
    "Cette conversation d’assistance n’a pas pu être chargée.",
  "Your message could not be sent. Try again.":
    "Votre message n’a pas pu être envoyé. Réessayez.",
  "Loading conversation...": "Chargement de la conversation...",
  "Send a message to start this conversation.":
    "Envoyez un message pour démarrer cette conversation.",
  "Write a message...": "Écrivez un message...",
  "Send message": "Envoyer le message",
  "Sending message...": "Envoi du message...",
  "Text chat is available on web. For files or photos, use the mobile app.":
    "Le chat texte est disponible sur le web. Pour les fichiers ou les photos, utilisez l’application mobile.",
  "Welcome, ": "Bienvenue, ",
  "Create account": "Créer un compte",
  "Create your customer account": "Créez votre compte client",
  "Reset your password": "Réinitialisez votre mot de passe",
  "Full name": "Nom complet",
  "Phone number": "Numéro de téléphone",
  "Phone country": "Pays du téléphone",
  "International number: ": "Numéro international : ",
  "I accept the ": "J’accepte les ",
  "Terms of Service": "Conditions d’utilisation",
  " and ": " et la ",
  "Privacy Policy": "Politique de confidentialité",
  "Please wait...": "Veuillez patienter...",
  "Send reset email": "Envoyer l’email de réinitialisation",
  "Forgot password?": "Mot de passe oublié ?",
  "Back to sign in": "Retour à la connexion",
  "Password reset email sent. Check your inbox.":
    "Email de réinitialisation envoyé. Consultez votre boîte de réception.",
  "Enter a valid phone number with 7 to 15 digits.":
    "Saisissez un numéro de téléphone valide de 7 à 15 chiffres.",
  "Accept the terms and privacy policy to continue.":
    "Acceptez les conditions et la politique de confidentialité pour continuer.",
  "An account already exists with this email. Sign in instead.":
    "Un compte existe déjà avec cet email. Connectez-vous plutôt.",
  "Check the information you entered and try again.":
    "Vérifiez les renseignements saisis et réessayez.",
  "We could not complete this request. Try again.":
    "Nous n’avons pas pu terminer cette demande. Réessayez.",
  "Verify your email to keep your account secure.":
    "Vérifiez votre email pour sécuriser votre compte.",
  "Send verification email": "Envoyer l’email de vérification",
  "Verification email sent. Check your inbox.":
    "Email de vérification envoyé. Consultez votre boîte de réception.",
  "The verification email could not be sent. Try again.":
    "L’email de vérification n’a pas pu être envoyé. Réessayez.",
  "Search car listings": "Rechercher des voitures",
  "Make, model, year, business, or location":
    "Marque, modèle, année, entreprise ou emplacement",
  "No cars match your search.": "Aucune voiture ne correspond à votre recherche.",
  "Favorites could not be loaded.":
    "Les favoris n’ont pas pu être chargés.",
  "The favorite could not be updated. Try again.":
    "Le favori n’a pas pu être mis à jour. Réessayez.",
  "Remove car from favorites": "Retirer la voiture des favoris",
  "Add car to favorites": "Ajouter la voiture aux favoris",
  "Approved business": "Entreprise approuvée",
  "View details": "Voir les détails",
  "Close car details": "Fermer les détails de la voiture",
  "Buy this car": "Acheter cette voiture",
  "Reserve with a deposit": "Réserver avec un acompte",
  "Reserve a viewing": "Réserver une visite",
  "Choose a time to visit the approved business.":
    "Choisissez une heure pour visiter l’entreprise approuvée.",
  "Review your contact details before secure payment.":
    "Vérifiez vos coordonnées avant le paiement sécurisé.",
  "Appointment time": "Heure du rendez-vous",
  "Review & pay": "Vérifier et payer",
  "Request progress": "Progression de la demande",
  "Review request": "Vérifier la demande",
  "Opening secure payment...": "Ouverture du paiement sécurisé...",
  "Back": "Retour",
  "Reserve viewing": "Réserver la visite",
  "Continue to deposit": "Continuer vers l’acompte",
  "Continue to purchase": "Continuer vers l’achat",
  "Car": "Voiture",
  "The request could not be completed. Check the details and try again.":
    "La demande n’a pas pu être terminée. Vérifiez les détails et réessayez.",
  "I understand that the selected business is the independent service provider responsible for fulfillment, timing, and performance.":
    "Je comprends que l’entreprise sélectionnée est le prestataire indépendant responsable de l’exécution, des délais et de la qualité du service.",
  "The secure payment page could not be opened.":
    "La page de paiement sécurisé n’a pas pu être ouverte.",
  "The payment request timed out. Try again.":
    "La demande de paiement a expiré. Réessayez.",
  "Profile saved.": "Profil enregistré.",
  "Your profile could not be saved. Try again.":
    "Votre profil n’a pas pu être enregistré. Réessayez.",
  "Save profile": "Enregistrer le profil",
  "Phone verified": "Téléphone vérifié",
  "Phone not verified": "Téléphone non vérifié",
  "Not verified": "Non vérifié",
  "Verify your phone number": "Vérifiez votre numéro de téléphone",
  "We will text a 6-digit code to":
    "Nous enverrons un code à 6 chiffres par SMS au",
  "your phone": "votre téléphone",
  "Standard messaging rates may apply.":
    "Les frais de messagerie standard peuvent s’appliquer.",
  "Send verification code": "Envoyer le code de vérification",
  "Sending verification code...": "Envoi du code de vérification...",
  "Verification code sent. Enter the 6-digit code below.":
    "Code de vérification envoyé. Saisissez le code à 6 chiffres ci-dessous.",
  "6-digit verification code": "Code de vérification à 6 chiffres",
  "Verify phone": "Vérifier le téléphone",
  "Verifying phone...": "Vérification du téléphone...",
  "Resend code": "Renvoyer le code",
  "The phone number changed. Send a new verification code.":
    "Le numéro de téléphone a changé. Envoyez un nouveau code de vérification.",
  "Enter a valid international phone number and try again.":
    "Saisissez un numéro international valide et réessayez.",
  "Phone verification is not configured for this local address. Add it to Firebase Authorized domains.":
    "La vérification du téléphone n’est pas configurée pour cette adresse locale. Ajoutez-la aux domaines autorisés Firebase.",
  "Phone verification is not configured for this website. Contact Laawol support.":
    "La vérification du téléphone n’est pas configurée pour ce site. Contactez l’assistance Laawol.",
  "The phone security check could not start. Refresh the page and try again.":
    "Le contrôle de sécurité du téléphone n’a pas pu démarrer. Actualisez la page et réessayez.",
  "Phone verification is not enabled. Contact Laawol support.":
    "La vérification du téléphone n’est pas activée. Contactez l’assistance Laawol.",
  "Too many verification attempts. Wait a few minutes and try again.":
    "Trop de tentatives de vérification. Attendez quelques minutes puis réessayez.",
  "SMS verification is temporarily unavailable. Try again later.":
    "La vérification par SMS est temporairement indisponible. Réessayez plus tard.",
  "This phone number is already linked to another Laawol account.":
    "Ce numéro de téléphone est déjà lié à un autre compte Laawol.",
  "Phone verification is taking longer than expected. Try again.":
    "La vérification du téléphone prend plus de temps que prévu. Réessayez.",
  "The verification code could not be sent. Check the phone number and try again.":
    "Le code de vérification n’a pas pu être envoyé. Vérifiez le numéro puis réessayez.",
  "Use an international phone number beginning with +.":
    "Utilisez un numéro international commençant par +.",
  "Verification code sent.": "Code de vérification envoyé.",
  "The verification code could not be sent. Try again.":
    "Le code de vérification n’a pas pu être envoyé. Réessayez.",
  "Save and verify": "Enregistrer et vérifier",
  "Verification code": "Code de vérification",
  "Verifying...": "Vérification...",
  "Verify": "Vérifier",
  "Phone number verified.": "Numéro de téléphone vérifié.",
  "The code is invalid or expired. Request a new code.":
    "Le code est invalide ou expiré. Demandez un nouveau code.",
  "Delete account": "Supprimer le compte",
  "Current password": "Mot de passe actuel",
  "Request account deletion": "Demander la suppression du compte",
  "Requesting...": "Envoi de la demande...",
  "Enter your password to request deletion. Required transaction records may be retained for legal and accounting obligations.":
    "Saisissez votre mot de passe pour demander la suppression. Les dossiers de transaction requis peuvent être conservés pour des obligations légales et comptables.",
  "Account deletion requested. Laawol will complete it within 30 days.":
    "Suppression du compte demandée. Laawol la terminera sous 30 jours.",
  "The deletion request could not be submitted. Check your password.":
    "La demande de suppression n’a pas pu être envoyée. Vérifiez votre mot de passe.",
  "Payment confirmed": "Paiement confirmé",
  "Your payment was confirmed and your order is up to date.":
    "Votre paiement a été confirmé et votre commande est à jour.",
  "Payment was not completed": "Le paiement n’a pas été effectué",
  "The payment failed or expired. You can safely try again.":
    "Le paiement a échoué ou expiré. Vous pouvez réessayer en toute sécurité.",
  "Payment cancelled": "Paiement annulé",
  "You left the secure payment page before completing payment.":
    "Vous avez quitté la page de paiement sécurisé avant de terminer.",
  "Payment link is invalid": "Le lien de paiement est invalide",
  "Open your customer workspace to review your orders.":
    "Ouvrez votre espace client pour consulter vos commandes.",
  "Sign in to check payment": "Connectez-vous pour vérifier le paiement",
  "Use the same Laawol account that started this payment.":
    "Utilisez le même compte Laawol qui a lancé ce paiement.",
  "Payment confirmation is taking longer":
    "La confirmation du paiement prend plus de temps",
  "Your order is safe. Check it again from your customer workspace.":
    "Votre commande est sécurisée. Vérifiez-la depuis votre espace client.",
  "Confirming your payment": "Confirmation de votre paiement",
  "Stripe is securely confirming the payment with Laawol.":
    "Stripe confirme le paiement de manière sécurisée auprès de Laawol.",
  "Return to customer workspace": "Retourner à l’espace client",
  "Contact support": "Contacter l’assistance",
  "Reference: ": "Référence : ",
  Reference: "Référence",
  "Open order details": "Ouvrir les détails de la commande",
  "Service provider": "Prestataire de services",
  "Close order details": "Fermer les détails de la commande",
  "Cancel request": "Annuler la demande",
  "Cancelling...": "Annulation...",
  "The request could not be cancelled. Try again.":
    "La demande n’a pas pu être annulée. Réessayez.",
  "Customer workspace": "Espace client",
  "Shop, track, and manage your Laawol services from any device.":
    "Achetez, suivez et gérez vos services Laawol depuis n’importe quel appareil.",
  "Customer sections": "Sections client",
  "Home": "Accueil",
  "Your activity at a glance": "Votre activité en un coup d’œil",
  "Browse cars": "Parcourir les voitures",
  "Listings from approved businesses": "Annonces d’entreprises approuvées",
  "Orders & tracking": "Commandes et suivi",
  "Shipping and vehicle services": "Expédition et services automobiles",
  "Wallet": "Portefeuille",
  "Balance and transactions": "Solde et transactions",
  "Profile": "Profil",
  "Account and security": "Compte et sécurité",
  "Customer account": "Compte client",
  "Your mobile and web activity stays together in the same Laawol account.":
    "Votre activité mobile et web reste réunie dans le même compte Laawol.",
  "View orders": "Voir les commandes",
  "Open orders": "Commandes en cours",
  "All activity": "Toute l’activité",
  "Account access": "Accès au compte",
  "Web + mobile": "Web + mobile",
  "New service requests and web payments are being added service by service. Your existing orders, purchases, tracking, wallet, and account remain shared with the mobile app.":
    "Les nouvelles demandes de service et les paiements web sont ajoutés service par service. Vos commandes, achats, suivis, portefeuille et compte existants restent partagés avec l’application mobile.",
  "Loading car listings...": "Chargement des annonces de voitures...",
  "Car listings could not be loaded.": "Les annonces de voitures n’ont pas pu être chargées.",
  "No active car listings are available right now.":
    "Aucune annonce de voiture active n’est disponible pour le moment.",
  "Location not provided": "Emplacement non fourni",
  "Loading your activity...": "Chargement de votre activité...",
  "You do not have any activity here yet.": "Vous n’avez encore aucune activité ici.",
  "Freight shipment": "Expédition de fret",
  "Wallet activity": "Activité du portefeuille",
  "Loading wallet...": "Chargement du portefeuille...",
  "Wallet could not be loaded.": "Le portefeuille n’a pas pu être chargé.",
  "No wallet transactions yet.": "Aucune transaction de portefeuille pour le moment.",
  "Available balance": "Solde disponible",
  "Transactions": "Transactions",
  "Account": "Compte",
  "Profile editing and account security controls are coming to the web workspace next.":
    "La modification du profil et les contrôles de sécurité du compte arrivent prochainement dans l’espace web.",
  "We could not load all of your activity.":
    "Nous n’avons pas pu charger toute votre activité.",
  "This account role is not supported. Contact Laawol support.":
    "Ce rôle de compte n’est pas pris en charge. Contactez l’assistance Laawol.",
  "Sign in to open your customer, business, or platform workspace.":
    "Connectez-vous pour ouvrir votre espace client, entreprise ou plateforme.",
  "Expand navigation": "Développer la navigation",
  "Collapse navigation": "Réduire la navigation",
  "Administration Laawol Digital": "Administration Laawol Digital",
  "Action failed.": "L’action a échoué.",
  "A Stripe payment could not be reconciled safely.":
    "Un paiement Stripe n’a pas pu être rapproché de manière sûre.",
  Active: "Actif",
  "Active listings:": "Annonces actives :",
  "active of": "actives sur",
  Available: "Disponible",
  "Active on public site": "Actif sur le site public",
  Add: "Ajouter",
  "Add featured business": "Ajouter une entreprise mise en avant",
  "Add your first destination": "Ajouter votre première destination",
  "Add your first listing": "Ajouter votre première annonce",
  Address: "Adresse",
  "Admin console": "Console admin",
  "All records": "Tous les dossiers",
  "Barrel records:": "Dossiers de barils :",
  "barrel ·": "baril(s) ·",
  "freight records": "dossier(s) de fret",
  "Freight records:": "Dossiers de fret :",
  "item is waiting across approvals, logistics, and finance.":
    "élément attend une action parmi les approbations, la logistique et les finances.",
  "items are waiting across approvals, logistics, and finance.":
    "éléments attendent une action parmi les approbations, la logistique et les finances.",
  listings: "annonces",
  "open of": "ouverts sur",
  "Open records:": "Dossiers ouverts :",
  purchase: "achat",
  "purchase records": "dossier(s) d’achat",
  "Purchase records:": "Dossiers d’achat :",
  Queues: "Files",
  records: "dossiers",
  "by status": "par statut",
  business: "entreprise",
  refund: "remboursement",
  shipment: "expédition",
  "All statuses": "Tous les statuts",
  "All title disclosures": "Toutes les déclarations de titre",
  Analytics: "Analyses",
  Apply: "Appliquer",
  "Approve extension": "Approuver la prolongation",
  "Approve this business? Customers will be able to see and use this business after approval.":
    "Approuver cette entreprise ? Les clients pourront voir et utiliser cette entreprise après approbation.",
  "Approve this hold extension request?":
    "Approuver cette demande de prolongation de réservation ?",
  "Approve this shared-barrel join request?":
    "Approuver cette demande de participation au baril partagé ?",
  Approved: "Approuvé",
  "Awaiting Balance Payment": "En attente du paiement du solde",
  "Approved featured businesses": "Entreprises mises en avant approuvées",
  "Available on the Pro plan — spots pricing, listing, and response issues and how to fix them.":
    "Disponible avec le forfait Pro : repère les problèmes de prix, d’annonces et de réponse, puis indique comment les corriger.",
  "Barrel shipments": "Expéditions de barils",
  "Barrel shipping": "Expédition de barils",
  Barrels: "Barils",
  Shares: "Parts",
  Accepted: "Acceptées",
  "Per share": "Par part",
  Origin: "Origine",
  Deadline: "Date limite",
  "Roll to business-held": "Confier à l’entreprise",
  Business: "Entreprise",
  Businesses: "Entreprises",
  "Businesses by status": "Entreprises par statut",
  "Business account is not configured.":
    "Le compte entreprise n’est pas configuré.",
  "Business dashboard": "Tableau de bord entreprise",
  "Business commission overrides": "Commissions spécifiques par entreprise",
  "Business commissions reset": "Commissions des entreprises réinitialisées",
  "Business commissions saved": "Commissions des entreprises enregistrées",
  "Business has consented to being featured":
    "L’entreprise a accepté d’être mise en avant",
  "Bypass Laawol documents and approve this business? Stripe is complete, and this override will be saved on the verification review.":
    "Contourner les documents Laawol et approuver cette entreprise ? Stripe est terminé, et cette exception sera enregistrée dans l’examen de vérification.",
  "Business name": "Nom de l’entreprise",
  "Business profile": "Profil de l’entreprise",
  Buyer: "Acheteur",
  Cancel: "Annuler",
  "Cancel & refund": "Annuler et rembourser",
  "Cancel this purchase and queue the deposit refund?":
    "Annuler cet achat et mettre le remboursement de l’acompte en file ?",
  "Cancel this shared barrel pool?": "Annuler ce baril partagé ?",
  "Car parking": "Stationnement de voitures",
  "Car sales": "Vente de voitures",
  "Car transport": "Transport de voitures",
  "Choose a business": "Choisir une entreprise",
  City: "Ville",
  "Changes Requested": "Modifications demandées",
  Clear: "Effacer",
  Close: "Fermer",
  Completed: "Terminé",
  Contact: "Contact",
  "Contact email": "Email du contact",
  "Contact name": "Nom du contact",
  "Contact phone": "Téléphone du contact",
  Country: "Pays",
  "Country pricing": "Prix par pays",
  "Create destination": "Créer la destination",
  "Create this platform manager account?":
    "Créer ce compte gestionnaire de plateforme ?",
  "Create this staff account with the selected permissions?":
    "Créer ce compte employé avec les autorisations sélectionnées ?",
  "Create listing": "Créer l’annonce",
  "Create parking": "Créer le stationnement",
  "Create transport": "Créer le transport",
  Created: "Créé",
  "Current default": "Valeur par défaut actuelle",
  "Current plan": "Forfait actuel",
  "Customer purchases": "Achats clients",
  Purchase: "Achat",
  Destination: "Destination",
  Destinations: "Destinations",
  "Document upload failed.": "Le téléversement du document a échoué.",
  "Document upload payload is required.":
    "Le contenu du document à téléverser est requis.",
  "Escalate this case to the admin team?":
    "Transférer ce dossier à l’équipe admin ?",
  "Display name": "Nom public",
  "Download CSV": "Télécharger CSV",
  Default: "Par défaut",
  Edit: "Modifier",
  "Edit featured business": "Modifier l’entreprise mise en avant",
  "Edit listing": "Modifier l’annonce",
  "Edit parking": "Modifier le stationnement",
  "Edit transport": "Modifier le transport",
  Email: "Email",
  "Enabled services": "Services activés",
  "Export CSV": "Exporter CSV",
  "Export receipts": "Exporter les reçus",
  Featured: "Mises en avant",
  "Featured max": "Maximum affiché",
  "Featured heading": "Titre des mises en avant",
  "Featured subheading": "Sous-titre des mises en avant",
  "Featuring requests": "Demandes de mise en avant",
  Finance: "Finances",
  "Financing note": "Note de financement",
  Free: "Gratuit",
  "Generate insights": "Générer les recommandations",
  Growth: "Croissance",
  Gross: "Brut",
  Headline: "Titre",
  "Homepage cap": "Limite accueil",
  "Homepage content": "Contenu de l’accueil",
  Hidden: "Masqué",
  Hide: "Masquer",
  "Hold deposits": "Acomptes de blocage",
  "Hold until": "Blocage jusqu’au",
  Inactive: "Inactif",
  "In transit": "En transit",
  Listings: "Annonces",
  "Loading insights…": "Chargement des recommandations…",
  "Loading website content...": "Chargement du contenu du site...",
  "Logo URL": "URL du logo",
  Make: "Marque",
  "Mark collected": "Marquer encaissé",
  "Mark this paid hold as sold?":
    "Marquer cette réservation payée comme vendue ?",
  "Mark this purchase as completed?": "Marquer cet achat comme terminé ?",
  "Mark this refund request completed?":
    "Marquer cette demande de remboursement comme terminée ?",
  "Mark this shared barrel balance as collected?":
    "Marquer ce solde de baril partagé comme encaissé ?",
  "Mark sold": "Marquer vendu",
  Message: "Message",
  Model: "Modèle",
  Mode: "Mode",
  Name: "Nom",
  "Needs action": "Action requise",
  "Not set": "Non défini",
  "New destination": "Nouvelle destination",
  "New listing": "Nouvelle annonce",
  "New parking": "Nouveau stationnement",
  "New transport": "Nouveau transport",
  No: "Non",
  "No AI insights yet": "Aucune recommandation IA pour le moment",
  "No destinations yet": "Aucune destination pour le moment",
  "No destinations match your search.":
    "Aucune destination ne correspond à votre recherche.",
  "No enabled services found.": "Aucun service activé trouvé.",
  "No featuring requests yet.":
    "Aucune demande de mise en avant pour le moment.",
  "No listings yet": "Aucune annonce pour le moment",
  "No listings match your search.":
    "Aucune annonce ne correspond à votre recherche.",
  "No parking records match this filter.":
    "Aucun dossier de stationnement ne correspond à ce filtre.",
  "No parked cars yet": "Aucune voiture stationnée pour le moment",
  "No purchases match this filter.": "Aucun achat ne correspond à ce filtre.",
  "No purchases yet": "Aucun achat pour le moment",
  "No rows loaded yet.": "Aucune ligne chargée pour le moment.",
  "No services are enabled yet.": "Aucun service n’est encore activé.",
  "No shipments match this filter.":
    "Aucune expédition ne correspond à ce filtre.",
  "No transport requests match this filter.":
    "Aucune demande de transport ne correspond à ce filtre.",
  "No transport requests yet": "Aucune demande de transport pour le moment",
  Operations: "Opérations",
  "Operations mix": "Répartition des opérations",
  Order: "Ordre",
  Owner: "Propriétaire",
  Parking: "Stationnement",
  "Page not found": "Page introuvable",
  "This page does not exist or has moved.":
    "Cette page n’existe pas ou a été déplacée.",
  "Back to console": "Retour à la console",
  "Parked cars": "Voitures stationnées",
  Password: "Mot de passe",
  Pending: "En attente",
  Payment: "Paiement",
  Payout: "Versement",
  "Payment reconciliation needs attention":
    "Le rapprochement d’un paiement nécessite une intervention",
  People: "Équipe",
  Phone: "Téléphone",
  Price: "Prix",
  "Price (USD)": "Prix (USD)",
  "Price settlement": "Règlement du prix",
  "Profile and services": "Profil et services",
  "Public website contact": "Contact du site public",
  Publish: "Publier",
  Purchases: "Achats",
  "Ready to publish.": "Prêt à publier.",
  "Rebuilt title?": "Titre reconstruit ?",
  "Rebuilt title": "Titre reconstruit",
  "Rebuilt title:": "Titre reconstruit :",
  "Rebuilt title: Yes": "Titre reconstruit : Oui",
  "Rebuilt title: No": "Titre reconstruit : Non",
  "Rebuilt title: Not provided": "Titre reconstruit : Non renseigné",
  "Rebuilt title yes": "Titre reconstruit oui",
  "Rebuilt title no": "Titre reconstruit non",
  "Rebuilt title Not provided": "Titre reconstruit non renseigné",
  Reject: "Rejeter",
  "Reject this hold extension request?":
    "Rejeter cette demande de prolongation de réservation ?",
  "Reject this shared-barrel join request?":
    "Rejeter cette demande de participation au baril partagé ?",
  "Reopen this support case?": "Rouvrir ce dossier de support ?",
  "Request changes from this business? They will need to respond before approval.":
    "Demander des modifications à cette entreprise ? Elle devra répondre avant l’approbation.",
  "Request more information on this support case?":
    "Demander plus d’informations sur ce dossier de support ?",
  "Resolve this support case?": "Résoudre ce dossier de support ?",
  Remove: "Supprimer",
  "Refund due": "Remboursement dû",
  "Refund processing": "Remboursement en cours",
  Requests: "Demandes",
  Review: "Vérifier",
  Retry: "Réessayer",
  Save: "Enregistrer",
  "Save business application rule changes?":
    "Enregistrer les changements des règles de candidature entreprise ?",
  "Save default barrel pricing and destination changes?":
    "Enregistrer les changements des tarifs et destinations par défaut des barils ?",
  "Save homepage content changes to the public website?":
    "Enregistrer les changements de la page d’accueil sur le site public ?",
  "Save internal platform branding changes?":
    "Enregistrer les changements d’image de marque interne ?",
  "Save platform notification settings? Email and SMS routing may change.":
    "Enregistrer les paramètres de notification plateforme ? L’acheminement email et SMS peut changer.",
  "Save public website contact changes?":
    "Enregistrer les changements des contacts publics du site ?",
  "Save role and permission changes? Admin access may change immediately.":
    "Enregistrer les changements de rôles et d’autorisations ? L’accès admin peut changer immédiatement.",
  "Save these business profile changes? Public details, services, or paid hold pricing may change.":
    "Enregistrer ces modifications du profil entreprise ? Les informations publiques, les services ou les tarifs de réservation peuvent changer.",
  "Save this shared-barrel capacity adjustment?":
    "Enregistrer cet ajustement de capacité du baril partagé ?",
  "Save your admin profile changes?":
    "Enregistrer les changements de votre profil admin ?",
  "Seal this shared barrel pool into a shipment?":
    "Sceller ce baril partagé en expédition ?",
  "Seal this underfilled pool into a shipment?":
    "Sceller ce baril incomplet en expédition ?",
  "Save changes": "Enregistrer les modifications",
  "Save content": "Enregistrer le contenu",
  "Save featured": "Enregistrer la mise en avant",
  Search: "Rechercher",
  "Select city": "Sélectionnez une ville",
  "Select color": "Sélectionnez une couleur",
  "Select condition": "Sélectionnez l’état",
  "Select whether this vehicle has a rebuilt title.":
    "Indiquez si ce véhicule a un titre reconstruit.",
  "Select country": "Sélectionnez un pays",
  "Select state": "Sélectionnez un État",
  "Select state first": "Sélectionnez d’abord un État",
  Send: "Envoyer",
  Services: "Services",
  "Services intro": "Introduction des services",
  Settings: "Paramètres",
  Show: "Afficher",
  "Show featured businesses": "Afficher les entreprises mises en avant",
  "Sign out": "Déconnexion",
  Staff: "Personnel",
  State: "État",
  Status: "Statut",
  Subheadline: "Sous-titre",
  Support: "Assistance",
  "Support email": "Email d’assistance",
  "Support phone": "Téléphone d’assistance",
  Sold: "Vendu",
  Settled: "Réglé",
  "Settlement processing": "Règlement en cours",
  Tools: "Outils",
  Today: "Aujourd’hui",
  Transport: "Transport",
  "Transport & shipping": "Transport et expédition",
  "Transport date": "Date de transport",
  "Upgrade to Pro": "Passer à Pro",
  "Upload logo": "Téléverser le logo",
  "View site": "Voir le site",
  Website: "Site web",
  "The connection is slow. We could not safely load your account role.":
    "La connexion est lente. Nous n’avons pas pu charger votre rôle de compte en toute sécurité.",
  "We could not open your console": "Nous n’avons pas pu ouvrir votre console",
  "Retry without signing out or losing your session.":
    "Réessayez sans vous déconnecter ni perdre votre session.",
  "Weight confirmed": "Poids confirmé",
  "Weight confirmed by": "Poids confirmé par",
  "Weight verification": "Vérification du poids",
  "Website URL": "URL du site web",
  Year: "Année",
  Yes: "Oui",
  You: "Vous",
  "Not provided": "Non renseigné",
  "Required. Buyers will see this disclosure.":
    "Obligatoire. Les acheteurs verront cette information.",
  Unknown: "Inconnu",
  "Opening console...": "Ouverture de la console...",
  "Console Laawol Digital": "Console Laawol Digital",
  "Sign in to manage the platform or your business workspace.":
    "Connectez-vous pour gérer la plateforme ou l’espace de votre entreprise.",
  "Sign in": "Connexion",
  "Sign out? You will need to sign in again to continue.":
    "Se déconnecter ? Vous devrez vous reconnecter pour continuer.",
  "Log in": "Se connecter",
  "Signing in...": "Connexion...",
  "Email or password is incorrect.":
    "L’email ou le mot de passe est incorrect.",
  "Too many attempts. Try again later.":
    "Trop de tentatives. Réessayez plus tard.",
  "Network error. Check your connection and try again.":
    "Erreur réseau. Vérifiez votre connexion et réessayez.",
  "Your account profile is missing. Contact Laawol support.":
    "Votre profil de compte est introuvable. Contactez l’assistance Laawol.",
  "This console is restricted to platform administrators, business owners, and business staff.":
    "Cette console est réservée aux administrateurs de la plateforme, aux propriétaires d’entreprise et au personnel d’entreprise.",
  "Access management": "Gestion des accès",
  "Access role": "Rôle d’accès",
  "Admin access role": "Rôle d’accès admin",
  "Account settings": "Paramètres du compte",
  "Accounts by role": "Comptes par rôle",
  Activate: "Activer",
  "Active listings": "Annonces actives",
  "Active destinations need a barrel shipping fee greater than 0.":
    "Les destinations actives doivent avoir un tarif d’expédition de baril supérieur à 0.",
  "Active (visible to customers)": "Actif (visible par les clients)",
  "Activity & requests": "Activité et demandes",
  "Add a car you're storing to start a parking record.":
    "Ajoutez une voiture que vous gardez pour créer un dossier de stationnement.",
  "Add a shipping price greater than zero before activating.":
    "Ajoutez un prix d’expédition supérieur à zéro avant d’activer.",
  "Add at least one photo.": "Ajoutez au moins une photo.",
  "Add country list": "Ajouter la liste des pays",
  "Add destination": "Ajouter une destination",
  "Add people": "Ajouter des personnes",
  "Add photos": "Ajouter des photos",
  "Add role": "Ajouter un rôle",
  "Add the countries you ship barrels to and set a price for each.":
    "Ajoutez les pays vers lesquels vous expédiez des barils et définissez un prix pour chacun.",
  "Add your first vehicle to start selling on the marketplace.":
    "Ajoutez votre premier véhicule pour commencer à vendre sur la marketplace.",
  "Admin profile": "Profil admin",
  "Admin access removed": "Accès administrateur retiré",
  "Admin role updated": "Rôle admin mis à jour",
  "Admin sections": "Sections admin",
  Administrator: "Administrateur",
  Admins: "Administrateurs",
  "Admins & customers": "Administrateurs et clients",
  "Admins assigned to it keep dashboard-only access until you reassign them.":
    "Les admins qui y sont affectés conservent un accès tableau de bord uniquement jusqu’à leur réaffectation.",
  "All business transactions": "Toutes les transactions d’entreprise",
  "All businesses": "Toutes les entreprises",
  "All service records": "Tous les dossiers de service",
  "All services": "Tous les services",
  "All sources": "Toutes les sources",
  "Allow reassignment of explicit IDs that already have a wrong/default businessId":
    "Autoriser la réaffectation des IDs explicites qui ont déjà un businessId incorrect ou par défaut",
  Amount: "Montant",
  "Applicants must upload verification documents":
    "Les candidats doivent téléverser des documents de vérification",
  "Application rules saved": "Règles de candidature enregistrées",
  Applications: "Candidatures",
  "Apply reviewed car IDs": "Appliquer les IDs de voitures vérifiés",
  Appointment: "Rendez-vous",
  "Approved partners": "Partenaires approuvés",
  Assign: "Attribuer",
  "Assign existing account…": "Attribuer un compte existant…",
  "Assign one owner for accountability.":
    "Attribuez un propriétaire responsable.",
  "Auto-approve new businesses":
    "Approuver automatiquement les nouvelles entreprises",
  "Awaiting partner approval": "En attente d’approbation du partenaire",
  "Awaiting estimate payment": "En attente du paiement estimé",
  "Awaiting weight": "En attente du poids",
  "Awaiting weight confirmation": "En attente de confirmation du poids",
  "Awaiting balance payment": "En attente du paiement du solde",
  "Balance payment pending": "Paiement du solde en cours",
  "Balance due": "Solde dû",
  "Barrel and shared-load shipping with clear destination pricing.":
    "Expédition de barils et chargements partagés avec prix clairs par destination.",
  "Barrel shipment": "Expédition de baril",
  "Barrel shipment status emails": "Emails de statut d’expédition de baril",
  "Barrel shipping price must be zero or more.":
    "Le prix d’expédition de baril doit être égal ou supérieur à zéro.",
  "Barrels customers send through your business appear here.":
    "Les barils envoyés par les clients via votre entreprise apparaissent ici.",
  "Barrels, transport, parking": "Barils, transport, stationnement",
  "Barrels, freight, transport, parking": "Barils, fret, transport, stationnement",
  "Shared barrel pool": "Baril partagé",
  "Shared barrel pools": "Barils partagés",
  "Shared pools need one active priced destination before you can start one.":
    "Les barils partagés nécessitent une destination active avec tarif avant de pouvoir commencer.",
  "Shared barrel refund": "Remboursement de baril partagé",
  "Shared barrel refund due": "Remboursement de baril partagé à traiter",
  "Shared barrel balance": "Solde de baril partagé",
  "Shared barrel balance collected": "Solde de baril partagé encaissé",
  "Shared barrel balance collected.": "Solde de baril partagé encaissé.",
  "Shared barrel balance due": "Solde de baril partagé à encaisser",
  "Shared balances due": "Soldes partagés à encaisser",
  "Balance due amount": "Montant des soldes dus",
  "Blocked pending settlement": "Bloqué en attente du règlement",
  Blocked: "Bloqué",
  Body: "Carrosserie",
  "Body type": "Type de carrosserie",
  "Branding saved": "Image de marque enregistrée",
  "Built-in": "Intégré",
  "Business application": "Candidature d’entreprise",
  "Business application requirements": "Exigences de candidature d’entreprise",
  "Business application waiting for review":
    "Candidature d’entreprise en attente d’examen",
  "Business approved with document bypass":
    "Entreprise approuvée avec contournement des documents",
  "Business destination list seeded":
    "Liste des destinations de l’entreprise initialisée",
  "Business for destination seed":
    "Entreprise pour l’initialisation des destinations",
  "Business head": "Responsable d’entreprise",
  "Business ID is required.": "L’ID de l’entreprise est requis.",
  "Business inventory": "Inventaire des entreprises",
  "Business lifecycle emails": "Emails du cycle de vie entreprise",
  "Business listings": "Annonces de l’entreprise",
  "Business membership updated": "Adhésion à l’entreprise mise à jour",
  "Business network": "Réseau d’entreprises",
  "Business notification": "Notification d’entreprise",
  "Business people": "Équipe de l’entreprise",
  "Business profile created": "Profil d’entreprise créé",
  "Business profile saved": "Profil d’entreprise enregistré",
  "Business profile was not found.":
    "Le profil de l’entreprise est introuvable.",
  "Business saved": "Entreprise enregistrée",
  "Business sections": "Sections de l’entreprise",
  "Business services": "Services de l’entreprise",
  "Business staff created": "Personnel d’entreprise créé",
  "Business status": "Statut de l’entreprise",
  "Business status updated": "Statut de l’entreprise mis à jour",
  "Business support request": "Demande d’assistance entreprise",
  "Business setup": "Configuration entreprise",
  "Business user": "Utilisateur entreprise",
  "Business logo": "Logo de l’entreprise",
  "Business name is required.": "Le nom de l’entreprise est requis.",
  "How your business appears to customers, and your car-hold pricing.":
    "Comment votre entreprise apparaît aux clients et vos tarifs de blocage de voiture.",
  "Logo / profile image": "Logo / image de profil",
  "Saved — choose a file to replace.":
    "Enregistré — choisissez un fichier pour le remplacer.",
  "Customers recognize you by this image.":
    "Les clients vous reconnaissent grâce à cette image.",
  "Choose image": "Choisir une image",
  Identity: "Identité",
  "Service note": "Note de service",
  "Services you offer": "Services proposés",
  "Select at least one service.": "Sélectionnez au moins un service.",
  "Car-hold pricing": "Tarif de blocage de voiture",
  "Pricing mode": "Mode de tarification",
  "Flat fee": "Frais fixe",
  "Flat hold fee (USD)": "Frais fixe de blocage (USD)",
  "Daily hold rate (USD)": "Tarif quotidien de blocage (USD)",
  "Max hold days": "Jours de blocage max.",
  "Enter valid paid hold pricing.":
    "Saisissez un tarif de blocage payant valide.",
  "Freight pickup": "Enlèvement du fret",
  "Offer to collect parcels from your customer's address, and choose how the fee is calculated.":
    "Proposez de récupérer les colis à l’adresse de votre client et choisissez le mode de calcul des frais.",
  "Offer freight pickup": "Proposer l’enlèvement du fret",
  "Pickup pricing model": "Modèle de tarification de l’enlèvement",
  "By distance": "Par distance",
  "By borough": "Par arrondissement",
  "Fee = base fee + per-km rate × driving distance from your address. Leave rates at 0 to offer free pickup.":
    "Frais = frais de base + tarif au km × distance de conduite depuis votre adresse. Laissez les tarifs à 0 pour un enlèvement gratuit.",
  "Pickup origin address": "Adresse de départ de l’enlèvement",
  "Defaults to your business address": "Par défaut, l’adresse de votre entreprise",
  "Base fee (USD)": "Frais de base (USD)",
  "Per km (USD)": "Par km (USD)",
  "Minimum fee (USD)": "Frais minimum (USD)",
  "Max distance (km)": "Distance max (km)",
  "0 = no limit": "0 = aucune limite",
  "Set a flat pickup fee for each New York City borough you serve. Leave blank for boroughs you don't cover.":
    "Définissez un tarif d’enlèvement fixe pour chaque arrondissement de New York que vous desservez. Laissez vide ceux que vous ne couvrez pas.",
  "Set a pickup fee for at least one borough, or turn off freight pickup.":
    "Définissez un tarif d’enlèvement pour au moins un arrondissement, ou désactivez l’enlèvement du fret.",
  "Business approved": "Entreprise approuvée",
  "Business changes requested": "Modifications demandées à l’entreprise",
  "Business verification saved": "Vérification de l’entreprise enregistrée",
  "Bypass platform docs and approve":
    "Contourner les documents plateforme et approuver",
  "(preview only)": "(aperçu uniquement)",
  "Stripe status refreshed": "Statut Stripe actualisé",
  "Complete Stripe verification and required platform documents before approval.":
    "Terminez la vérification Stripe et les documents plateforme requis avant l’approbation.",
  Verification: "Vérification",
  "Verification document emails": "Emails de documents de vérification",
  "Verification document uploaded": "Document de vérification téléversé",
  "Verification documents": "Documents de vérification",
  "Everything required has been verified by Laawol.":
    "Tous les éléments requis ont été vérifiés par Laawol.",
  "Required Laawol service documents are complete.":
    "Les documents de service requis par Laawol sont terminés.",
  "Upload the documents Laawol admins need before approving your business.":
    "Téléversez les documents dont les admins Laawol ont besoin avant d’approuver votre entreprise.",
  "Upload only the service documents Laawol admins need. Stripe collects identity, tax, legal, and bank details.":
    "Téléversez uniquement les documents de service nécessaires aux admins Laawol. Stripe collecte l’identité, les informations fiscales et légales, ainsi que les coordonnées bancaires.",
  "Choose a document first.": "Choisissez d’abord un document.",
  "Documents must be PDF, Word, or image files under 20 MB.":
    "Les documents doivent être des fichiers PDF, Word ou image de moins de 20 Mo.",
  "Admin note:": "Note admin :",
  "Admin request:": "Demande admin :",
  "Choose document": "Choisir un document",
  "Upload document": "Téléverser le document",
  "Ready to approve": "Prêt à approuver",
  "Request changes": "Demander des modifications",
  "Documents still need review": "Des documents doivent encore être vérifiés",
  "Stripe setup or platform documents still need review":
    "La configuration Stripe ou les documents plateforme doivent encore être vérifiés",
  "Every required document is verified or marked not applicable.":
    "Chaque document requis est vérifié ou marqué sans objet.",
  "Stripe and required Laawol service documents are complete.":
    "Stripe et les documents de service requis par Laawol sont terminés.",
  "approval item must be completed before approval.":
    "élément d’approbation doit être terminé avant l’approbation.",
  "approval items must be completed before approval.":
    "éléments d’approbation doivent être terminés avant l’approbation.",
  "document must be verified before approval.":
    "document doit être vérifié avant l’approbation.",
  "documents must be verified before approval.":
    "documents doivent être vérifiés avant l’approbation.",
  "Stripe complete": "Stripe terminé",
  "Stripe blocked": "Stripe bloqué",
  "docs verified": "documents vérifiés",
  "service docs": "documents de service",
  complete: "terminés",
  Required: "Requis",
  "Platform docs": "Documents plateforme",
  "Missing or insufficient permissions.":
    "Autorisations manquantes ou insuffisantes.",
  Missing: "Manquant",
  "Needs review": "À vérifier",
  Verified: "Vérifié",
  Submitted: "Envoyé",
  "Needs Changes": "Modifications requises",
  "Needs changes": "Modifications requises",
  "Not applicable": "Sans objet",
  "Stripe verification": "Vérification Stripe",
  "Identity, legal, tax, and bank details":
    "Identité, informations légales et fiscales, coordonnées bancaires",
  "Action required": "Action requise",
  "Not started": "Non commencé",
  "Stripe setup required": "Configuration Stripe requise",
  "Stripe verification complete": "Vérification Stripe terminée",
  "Stripe action required": "Action Stripe requise",
  "Stripe review pending": "Vérification Stripe en attente",
  "Stripe collects owner identity, business legal/tax information, and bank details so Laawol does not ask for those documents here.":
    "Stripe collecte l’identité du propriétaire, les informations légales/fiscales de l’entreprise et les coordonnées bancaires afin que Laawol ne demande pas ces documents ici.",
  "Stripe has enabled this business for payouts. Laawol only needs to review service-specific documents.":
    "Stripe a activé les versements pour cette entreprise. Laawol doit seulement vérifier les documents propres aux services.",
  "Send the business back to Stripe for identity, tax, legal, or bank updates instead of collecting those files in Laawol.":
    "Renvoyez l’entreprise vers Stripe pour les mises à jour d’identité, fiscales, légales ou bancaires au lieu de collecter ces fichiers dans Laawol.",
  "Stripe is still reviewing this business. Refresh the Stripe status before approving the business.":
    "Stripe vérifie encore cette entreprise. Actualisez le statut Stripe avant d’approuver l’entreprise.",
  "No Stripe account connected yet":
    "Aucun compte Stripe connecté pour le moment",
  "Account:": "Compte :",
  "Stripe requirement due": "exigence Stripe requise",
  "Stripe requirements due": "exigences Stripe requises",
  "pending with Stripe": "en attente chez Stripe",
  "Refresh Stripe status": "Actualiser le statut Stripe",
  "No Laawol service documents required":
    "Aucun document de service Laawol requis",
  "Stripe still handles identity, tax, legal, and bank checks.":
    "Stripe gère toujours les vérifications d’identité, fiscales, légales et bancaires.",
  "The selected services do not require extra Laawol licenses or authority documents.":
    "Les services sélectionnés n’exigent pas de licences ou documents d’autorisation supplémentaires pour Laawol.",
  "The services selected for this business do not require extra Laawol licenses or authority documents.":
    "Les services sélectionnés pour cette entreprise n’exigent pas de licences ou documents d’autorisation supplémentaires pour Laawol.",
  "Send Stripe updates through Stripe. Laawol only needs the current warehouse proof before approval.":
    "Envoyez les mises à jour Stripe via Stripe. Laawol a seulement besoin de la preuve d’entrepôt actuelle avant l’approbation.",
  "Complete Stripe updates in Stripe. Laawol only needs current freight or warehouse authority here.":
    "Terminez les mises à jour Stripe dans Stripe. Ici, Laawol a seulement besoin d’une autorisation de fret ou d’entrepôt actuelle.",
  "Upload a current agreement or freight-forwarder authority.":
    "Téléversez un accord actuel ou une autorisation de transitaire.",
  "Agreement must show current year.":
    "L’accord doit indiquer l’année en cours.",
  "Open document": "Ouvrir le document",
  "Open this shared barrel pool?": "Ouvrir ce baril partagé ?",
  "Roll this pool into business-held matching?":
    "Basculer ce baril vers la mise en relation gérée par l’entreprise ?",
  "Uploaded:": "Téléversé :",
  "No file uploaded yet": "Aucun fichier téléversé pour le moment",
  "Review status": "Statut de vérification",
  "Verify submitted": "Vérifier les documents envoyés",
  "Save checklist": "Enregistrer la liste",
  "Approve business": "Approuver l’entreprise",
  "Verify every required document before approval.":
    "Vérifiez chaque document requis avant l’approbation.",
  "Freight (parcels)": "Fret (colis)",
  "Freight status and settlement are controlled by the verified business workflow. Admins can review and escalate exceptions here.":
    "Le statut et le règlement du fret sont gérés par le processus vérifié de l’entreprise. Les administrateurs peuvent examiner et escalader les exceptions ici.",
  Freight: "Fret",
  "Freight shipments": "Expéditions de fret",
  "Freight shipment updated.": "Expédition de fret mise à jour.",
  "Estimated weight": "Poids estimé",
  "Verified weight": "Poids confirmé",
  "Rate locked at booking": "Tarif fixé lors de la réservation",
  "Final total": "Total final",
  Settlement: "Règlement",
  "Enter verified weight": "Saisir le poids confirmé",
  "Confirm weight and final price": "Confirmer le poids et le prix final",
  "Confirm the parcel weight before fulfillment.": "Confirmez le poids du colis avant l’expédition.",
  "Waiting for customer payment. Fulfillment remains locked.": "En attente du paiement du client. L’expédition reste bloquée.",
  "Settlement needs attention. Contact support before fulfillment.": "Le règlement nécessite une intervention. Contactez l’assistance avant l’expédition.",
  "Fulfillment is locked until the verified weight is settled.": "L’expédition est bloquée jusqu’au règlement du poids confirmé.",
  "Enter a verified weight greater than zero.": "Saisissez un poids confirmé supérieur à zéro.",
  "Verified weight and final price saved.": "Poids confirmé et prix final enregistrés.",
  "Could not confirm the weight. Try again.": "Impossible de confirmer le poids. Réessayez.",
  "No price change": "Aucun changement de prix",
  "Parcel shipping queue": "File d’expédition des colis",
  "Paid parcel shipments will appear here for fulfillment.":
    "Les expéditions de colis payées apparaîtront ici pour traitement.",
  "Search freight tracking, sender, receiver…":
    "Rechercher par suivi, expéditeur ou destinataire…",
  "No freight shipments yet": "Aucune expédition de fret pour le moment",
  "Configure air or sea rates under Destinations so customers can book freight.":
    "Configurez les tarifs aériens ou maritimes dans Destinations afin que les clients puissent réserver du fret.",
  "No freight shipments match this filter.":
    "Aucune expédition de fret ne correspond à ce filtre.",
  "Air freight": "Fret aérien",
  "Sea freight": "Fret maritime",
  Reserved: "Réservé",
  Succeeded: "Réussi",
  "Air freight per kg (USD)": "Fret aérien par kg (USD)",
  "Sea freight per kg (USD)": "Fret maritime par kg (USD)",
  Weight: "Poids",
  Rate: "Tarif",
  "Set barrel and freight prices for each country you serve.":
    "Définissez les tarifs de barils et de fret pour chaque pays desservi.",
  "Add the countries you ship to and set barrel or freight prices.":
    "Ajoutez les pays desservis et définissez les tarifs de barils ou de fret.",
  "Enter an air or sea freight price per kilogram greater than zero.":
    "Saisissez un tarif de fret aérien ou maritime par kilogramme supérieur à zéro.",
  "Add an air or sea freight price before activating.":
    "Ajoutez un tarif de fret aérien ou maritime avant l’activation.",
  "Government-issued owner ID": "Pièce d’identité officielle du propriétaire",
  "Passport, driver license, state ID, or national ID matching the business owner.":
    "Passeport, permis de conduire, pièce d’identité d’État ou carte nationale correspondant au propriétaire de l’entreprise.",
  "Business registration": "Enregistrement de l’entreprise",
  "State registration, DBA, articles of organization, or equivalent legal registration.":
    "Enregistrement d’État, DBA, statuts de société ou enregistrement légal équivalent.",
  "Tax ID confirmation": "Confirmation d’identifiant fiscal",
  "EIN letter, resale certificate, tax registration, or local equivalent.":
    "Lettre EIN, certificat de revente, enregistrement fiscal ou équivalent local.",
  "Business address proof": "Preuve d’adresse de l’entreprise",
  "Lease, utility bill, bank statement, or official mail for the operating address.":
    "Bail, facture de service public, relevé bancaire ou courrier officiel pour l’adresse d’exploitation.",
  "Payout bank proof": "Preuve du compte bancaire de versement",
  "Voided check, bank letter, or Stripe account ownership proof for payouts.":
    "Chèque annulé, lettre bancaire ou preuve de propriété du compte Stripe pour les versements.",
  "Freight or shipping authority": "Autorisation de fret ou d’expédition",
  "Freight-forwarder license, warehouse agreement, customs broker agreement, or receiving-partner proof.":
    "Licence de transitaire, accord d’entrepôt, accord de courtier en douane ou preuve de partenaire de réception.",
  "Dealer license or sales authorization":
    "Licence de concessionnaire ou autorisation de vente",
  "Dealer license, reseller authorization, auction access proof, or local vehicle sales permit.":
    "Licence de concessionnaire, autorisation de revendeur, preuve d’accès aux enchères ou permis local de vente de véhicules.",
  "Parking facility proof": "Preuve du site de stationnement",
  "Lot lease, property ownership, facility insurance, or written parking authorization.":
    "Bail du terrain, titre de propriété, assurance du site ou autorisation écrite de stationnement.",
  "Transport insurance and authority": "Assurance et autorisation de transport",
  "Commercial auto policy, transporter authority, USDOT/MC registration, or carrier agreement.":
    "Police auto commerciale, autorisation de transporteur, enregistrement USDOT/MC ou accord de transporteur.",
  "Invalid verification document ID": "ID de document de vérification invalide",
  "Invalid verification document status":
    "Statut de document de vérification invalide",
  "Verification documents must be a list":
    "Les documents de vérification doivent être une liste",
  "At least one verification document is required":
    "Au moins un document de vérification est requis",
  "Document storage path does not match the business":
    "Le chemin de stockage du document ne correspond pas à l’entreprise",
  "Document download URL is required":
    "L’URL de téléchargement du document est requise",
  "Document file size is required":
    "La taille du fichier du document est requise",
  "Only operations admins can review business verification documents":
    "Seuls les admins opérations peuvent vérifier les documents d’entreprise",
  "Active inventory value": "Valeur du stock actif",
  "AI advisor + lower fees": "Conseiller IA + frais réduits",
  "Business AI advisor": "Conseiller IA entreprise",
  "Business contact not set": "Coordonnées non définies",
  "Could not generate recommendations.":
    "Impossible de générer les recommandations.",
  "Could not start payment.": "Impossible de démarrer le paiement.",
  Critical: "Critique",
  "Finding:": "Constat :",
  "Generate new recommendations from your latest business data.":
    "Générez de nouvelles recommandations à partir des dernières données de votre entreprise.",
  "Generate recommendations": "Générer les recommandations",
  "Generate your first set of recommendations.":
    "Générez votre première série de recommandations.",
  "Get the AI advisor, deeper analytics, and reduced platform fees as you grow.":
    "Obtenez le conseiller IA, des analyses plus poussées et des frais de plateforme réduits pendant votre croissance.",
  High: "Élevé",
  "Holds and buyers": "Blocages et acheteurs",
  "Included tools": "Outils inclus",
  "Laawol Digital Console": "Console Laawol Digital",
  "Listings, destinations, barrels, purchases, parking, transport, people, and support.":
    "Annonces, destinations, barils, achats, stationnement, transport, personnel et assistance.",
  Low: "Faible",
  Medium: "Moyen",
  "Needs attention": "À traiter",
  "No urgent operational items right now.":
    "Aucun point opérationnel urgent pour le moment.",
  "Open shipments": "Expéditions ouvertes",
  "Operational statuses": "Statuts opérationnels",
  "Owners and staff": "Propriétaires et personnel",
  "Payment session started.": "Session de paiement démarrée.",
  "Plan and AI advisor": "Forfait et conseiller IA",
  "Plan and advisor": "Forfait et conseiller",
  Pinned: "Épinglés",
  "Recommendations generated.": "Recommandations générées.",
  Recommendation: "Recommandation",
  "Recommended action:": "Action recommandée :",
  "Requests and replies": "Demandes et réponses",
  "Routes and pricing": "Trajets et tarifs",
  "Shipping queue": "File d’expédition",
  "Stored cars": "Voitures stationnées",
  "Support requests": "Demandes d’assistance",
  "This account is not linked to a business.":
    "Ce compte n’est lié à aucune entreprise.",
  "This business is currently": "Cette entreprise est actuellement",
  "This business is currently changes requested. Complete Stripe setup and any requested profile details while it waits for platform approval.":
    "Des modifications ont été demandées pour cette entreprise. Terminez la configuration Stripe et complétez les informations de profil demandées pendant l’attente de l’approbation de la plateforme.",
  "This business is currently pending. Complete Stripe setup and any requested profile details while it waits for platform approval.":
    "Cette entreprise est en attente. Terminez la configuration Stripe et complétez les informations de profil demandées pendant l’attente de l’approbation de la plateforme.",
  "This business is currently rejected. Complete Stripe setup and any requested profile details while it waits for platform approval.":
    "Cette entreprise a été refusée. Consultez les informations demandées et contactez l’assistance Laawol si vous avez besoin d’aide.",
  "Upgrade to Pro to unlock the advisor.":
    "Passez à Pro pour débloquer le conseiller.",
  "Vehicle moves": "Déplacements de véhicules",
  "Vehicles for sale": "Voitures à vendre",
  Workspace: "Espace de travail",
  "You can review setup data here while it waits for platform approval.":
    "Vous pouvez vérifier les données de configuration ici pendant l’attente d’approbation par la plateforme.",
  "Your included tools": "Vos outils inclus",
  "Your plan, benefits, and AI recommendations for your business.":
    "Votre forfait, vos avantages et les recommandations IA pour votre entreprise.",
  active: "actif",
  approved: "approuvé",
  cancelled: "annulé",
  "changes requested": "modifications demandées",
  closed: "fermé",
  collected_by_business: "encaissé par l’entreprise",
  completed: "terminé",
  inactive: "inactif",
  in_transit: "en transit",
  pending: "en attente",
  refund_pending: "remboursement en attente",
  rejected: "rejeté",
  reserved: "réservé",
  resolved: "résolu",
  sold: "vendu",
  "Businesses & applications": "Entreprises et candidatures",
  "Buyer phone": "Téléphone de l’acheteur",
  "Cancel &amp; refund": "Annuler et rembourser",
  Cancelled: "Annulé",
  "Cancelled — deposit refund queued with the platform.":
    "Annulé : remboursement de l’acompte mis en file côté plateforme.",
  "Car make, model, and year are required.":
    "La marque, le modèle et l’année du véhicule sont requis.",
  "Car purchase": "Achat de voiture",
  "Car purchase status emails": "Emails de statut d’achat de voiture",
  "Car purchases": "Achats de voitures",
  "Card return": "Retour de carte",
  "Card return request": "Demande de retour de carte",
  "Card return requests": "Demandes de retour de carte",
  "Card returns": "Retours de carte",
  "Cars you list appear in the marketplace once approved.":
    "Les voitures que vous publiez apparaissent dans la marketplace après approbation.",
  "Cars, parking, transport, and shipping support for customers moving between the U.S. and West Africa.":
    "Voitures, stationnement, transport et expédition pour les clients entre les États-Unis et l’Afrique de l’Ouest.",
  "Cars, parking, transport, and shipping support for the road home.":
    "Voitures, stationnement, transport et expédition pour la route vers le pays.",
  "Cars, parking, transport, barrel shipping":
    "Voitures, stationnement, transport, expédition de barils",
  "Changes requested": "Modifications demandées",
  "Choose a business before sending.":
    "Choisissez une entreprise avant d’envoyer.",
  "Choose a business before uploading a logo.":
    "Choisissez une entreprise avant de téléverser un logo.",
  "Choose a business.": "Choisissez une entreprise.",
  "Choose at least one service for this business.":
    "Choisissez au moins un service pour cette entreprise.",
  "Choose business": "Choisir une entreprise",
  "City, state, ZIP": "Ville, État, code postal",
  "Clear filters": "Effacer les filtres",
  "Close account settings": "Fermer les paramètres du compte",
  Closed: "Fermé",
  Code: "Code",
  "Collection note (optional)": "Note d’encaissement (facultatif)",
  Complete: "Terminé",
  "Completing refund request...":
    "Finalisation de la demande de remboursement...",
  Condition: "État",
  "Configure how the console works. Create roles, decide what each one can see and do, and limit them to specific services.":
    "Configurez le fonctionnement de la console. Créez des rôles, décidez ce que chacun peut voir et faire, puis limitez-les à des services précis.",
  Confirm: "Confirmer",
  "Confirm card return for RF-17": "Confirmer le retour de carte pour RF-17",
  Confirmed: "Confirmé",
  "Confirming phone...": "Confirmation du téléphone...",
  "Contact only": "Contact uniquement",
  "Customer no-show": "Client absent",
  "Contact-only support references":
    "Références d’assistance contact uniquement",
  Contacts: "Contacts",
  "Content manager": "Responsable du contenu",
  "Copied!": "Copié !",
  Create: "Créer",
  "Create business": "Créer une entreprise",
  "Create business profile": "Créer le profil d’entreprise",
  "Create profile": "Créer le profil",
  "Create staff": "Créer le personnel",
  "Created from existing marketplace or operations records.":
    "Créé à partir des dossiers existants de marketplace ou d’opérations.",
  "Creating...": "Création...",
  "Customer accounts": "Comptes clients",
  "Customer email": "Email du client",
  "Customer name": "Nom du client",
  "Customer phone": "Téléphone du client",
  "Customer wallet balance": "Solde du portefeuille client",
  Customers: "Clients",
  "Customers and help": "Clients et aide",
  Days: "Jours",
  Deactivate: "Désactiver",
  "Default barrel price (USD)": "Prix de baril par défaut (USD)",
  "Default barrel pricing & destinations":
    "Prix de baril et destinations par défaut",
  "Default business migration complete":
    "Migration de l’entreprise par défaut terminée",
  Delete: "Supprimer",
  "Delete role": "Supprimer le rôle",
  "Deleting...": "Suppression...",
  Delivery: "Livraison",
  "Delivery days must be positive whole numbers, with max greater than or equal to min.":
    "Les jours de livraison doivent être des nombres entiers positifs, avec un maximum supérieur ou égal au minimum.",
  "Delivery estimate": "Estimation de livraison",
  "Delivery max (days)": "Livraison max (jours)",
  "Delivery min (days)": "Livraison min (jours)",
  Delivered: "Livré",
  Deposit: "Acompte",
  "Describe the request, what the customer needs, and any deadline.":
    "Décrivez la demande, le besoin du client et toute échéance.",
  "Describe the vehicle, history, condition, extras…":
    "Décrivez le véhicule, l’historique, l’état, les options…",
  Description: "Description",
  "Destination activated.": "Destination activée.",
  "Destination business or country ID is missing.":
    "L’ID de l’entreprise ou du pays de destination est manquant.",
  "Destination countries": "Pays de destination",
  "Destination country seed complete":
    "Initialisation des pays de destination terminée",
  "Destination deactivated.": "Destination désactivée.",
  "Destination details": "Détails de destination",
  "Destination setup needed": "Configuration de destination requise",
  "Destination saved.": "Destination enregistrée.",
  "Destination updated": "Destination mise à jour",
  Details: "Détails",
  Disabled: "Désactivé",
  "Dismiss account settings": "Fermer les paramètres du compte",
  Down: "Descendre",
  Drivetrain: "Transmission motrice",
  Draft: "Brouillon",
  "Drop-off": "Dépôt",
  "Dry run": "Simulation",
  "Edit public site copy and curate the small approved set of businesses shown on the marketing homepage.":
    "Modifiez le contenu du site public et sélectionnez le petit groupe d’entreprises approuvées affichées sur l’accueil marketing.",
  "Email not verified": "Email non vérifié",
  Ended: "Terminé",
  "Enter a barrel shipping price greater than zero.":
    "Saisissez un prix d’expédition de baril supérieur à zéro.",
  "Enter a phone number first.": "Saisissez d’abord un numéro de téléphone.",
  "Enter a request message.": "Saisissez un message de demande.",
  "Enter a request subject.": "Saisissez un sujet de demande.",
  "Enter a title or make and model.":
    "Saisissez un titre ou une marque et un modèle.",
  "Enter a valid min/max delivery day range.":
    "Saisissez une plage de jours de livraison min/max valide.",
  "Enter a valid price.": "Saisissez un prix valide.",
  "Enter both min and max delivery days, or leave both empty.":
    "Saisissez les jours minimum et maximum, ou laissez les deux champs vides.",
  "Every queue is clear. Browse a business workspace to review activity.":
    "Toutes les files sont vides. Ouvrez un espace entreprise pour examiner l’activité.",
  "Every service request across all businesses, in one place. Pick a service to focus, or browse them all.":
    "Toutes les demandes de service de toutes les entreprises, au même endroit. Choisissez un service à examiner ou parcourez-les tous.",
  Expired: "Expiré",
  "Explicit car IDs": "IDs de voitures explicites",
  "Extension approved.": "Prolongation approuvée.",
  "Extension rejected.": "Prolongation rejetée.",
  Exterior: "Extérieur",
  "Exterior color": "Couleur extérieure",
  "Featured business published": "Entreprise mise en avant publiée",
  "Featured business removed": "Entreprise mise en avant supprimée",
  "Featured business updated": "Entreprise mise en avant mise à jour",
  "Featured order updated": "Ordre de mise en avant mis à jour",
  Features: "Équipements",
  Fee: "Frais",
  Filtered: "Filtré",
  "Finance manager": "Responsable finance",
  "Finance queue": "File finance",
  "Find country": "Trouver un pays",
  "Find destination": "Trouver une destination",
  "Firebase Auth user listing is unavailable. Showing profile and activity records.":
    "La liste des utilisateurs Firebase Auth est indisponible. Affichage des profils et dossiers d’activité.",
  "Firebase SMS confirms this phone on the signed-in admin account.":
    "Firebase SMS confirme ce téléphone sur le compte admin connecté.",
  Forfeited: "Confisqué",
  Forfeiture: "Confiscation",
  Fuel: "Carburant",
  "Fuel type": "Type de carburant",
  Full: "Complet",
  "Global contacts": "Contacts globaux",
  Halted: "Arrêté",
  "Hero eyebrow": "Surtitre du héros",
  "Hide details": "Masquer les détails",
  "Hold date reached — mark this vehicle sold, or mark the customer as a no-show.":
    "Date de blocage atteinte : marquez ce véhicule vendu ou marquez le client absent.",
  "Hold marked sold.": "Blocage marqué vendu.",
  "Hold pricing": "Prix de blocage",
  "Hold review required": "Vérification du blocage requise",
  "Holds, viewings, and buyers appear here as customers reserve your cars.":
    "Les blocages, visites et acheteurs apparaissent ici lorsque les clients réservent vos voitures.",
  "In progress": "En cours",
  "In review": "En examen",
  "Inferred from operational records": "Déduit des dossiers opérationnels",
  Interior: "Intérieur",
  "Interior color": "Couleur intérieure",
  "Internal platform branding": "Image de marque interne de la plateforme",
  "Invalid email or password.": "Email ou mot de passe invalide.",
  "Ledger rows": "Lignes du registre",
  "Legacy business name": "Ancien nom d’entreprise",
  "Legacy car backfill applied": "Rattrapage des anciennes voitures appliqué",
  "Legacy car backfill dry run complete":
    "Simulation du rattrapage des anciennes voitures terminée",
  "Legacy car listing backfill":
    "Rattrapage des anciennes annonces de voitures",
  "Limited to services": "Limité aux services",
  "Listing sale state": "État de vente de l’annonce",
  "Listings by business": "Annonces par entreprise",
  "Loading...": "Chargement...",
  "Make and model": "Marque et modèle",
  Manage: "Gérer",
  "Manage platform administrators and global customer support. Business-linked people and records live under Businesses.":
    "Gérez les administrateurs de la plateforme et l’assistance client globale. Les personnes et dossiers liés à une entreprise se trouvent sous Entreprises.",
  "Manage destinations": "Gérer les destinations",
  "Marketplace filters": "Filtres marketplace",
  "Marketplace listing": "Annonce marketplace",
  "Marketplace manager": "Responsable marketplace",
  "Mark customer no-show": "Marquer le client absent",
  "Mark hold sold": "Marquer le blocage vendu",
  "Marked no-show.": "Marqué absent.",
  "Message sent": "Message envoyé",
  Mileage: "Kilométrage",
  "Monitor wallet balance return requests and finance readiness.":
    "Surveillez les demandes de retour de solde portefeuille et la préparation finance.",
  "Needs your attention": "Requiert votre attention",
  Network: "Réseau",
  "Network health": "Santé du réseau",
  "New business application emails":
    "Emails de nouvelle candidature d’entreprise",
  "New role": "Nouveau rôle",
  "No barrel shipments yet": "Aucune expédition de baril pour le moment",
  "No shared barrel pools yet": "Aucun baril partagé pour le moment",
  "No shared barrel pools match this filter.":
    "Aucun baril partagé ne correspond à ce filtre.",
  "No business destination rows are loaded. Use Production tools to seed destinations for a business.":
    "Aucune ligne de destination d’entreprise n’est chargée. Utilisez les outils de production pour initialiser les destinations d’une entreprise.",
  "No business people assigned yet.":
    "Aucune personne d’entreprise affectée pour le moment.",
  "No business profiles are currently loaded.":
    "Aucun profil d’entreprise n’est actuellement chargé.",
  "No business support requests have been sent yet.":
    "Aucune demande d’assistance entreprise n’a encore été envoyée.",
  "No businesses loaded": "Aucune entreprise chargée",
  "No businesses match this search.":
    "Aucune entreprise ne correspond à cette recherche.",
  "No car listings are currently loaded.":
    "Aucune annonce de voiture n’est actuellement chargée.",
  "No card return requests for this business.":
    "Aucune demande de retour de carte pour cette entreprise.",
  "No refund requests for this business.":
    "Aucune demande de remboursement pour cette entreprise.",
  "No contact-only references match this search.":
    "Aucune référence contact uniquement ne correspond à cette recherche.",
  "No customer accounts match this search.":
    "Aucun compte client ne correspond à cette recherche.",
  "No customer contact": "Aucun contact client",
  "No default destinations yet.":
    "Aucune destination par défaut pour le moment.",
  "No delivery estimate": "Aucune estimation de livraison",
  "No destinations match this search.":
    "Aucune destination ne correspond à cette recherche.",
  "No email": "Aucun email",
  "No finance records are loaded yet.":
    "Aucun dossier financier n’est encore chargé.",
  "No finance rows match the current filters.":
    "Aucune ligne finance ne correspond aux filtres actuels.",
  "No legacy shipment pricing rows are loaded. Destination country coverage is shown on the right.":
    "Aucune ancienne ligne de prix d’expédition n’est chargée. La couverture des pays de destination est affichée à droite.",
  "No listings from this business match the current filters.":
    "Aucune annonce de cette entreprise ne correspond aux filtres actuels.",
  "No listings match the current marketplace filters.":
    "Aucune annonce ne correspond aux filtres marketplace actuels.",
  "No open approvals, shipments, purchases, or refunds are currently loaded.":
    "Aucune approbation, expédition, achat ou remboursement ouvert n’est actuellement chargé.",
  "No owner assigned": "Aucun propriétaire affecté",
  "No phone": "Aucun téléphone",
  "No photo": "Aucune photo",
  "No platform administrators match this search.":
    "Aucun administrateur de plateforme ne correspond à cette recherche.",
  "No public featured businesses have been approved yet.":
    "Aucune entreprise publique mise en avant n’a encore été approuvée.",
  "No records": "Aucun dossier",
  "No records match the current filters.":
    "Aucun dossier ne correspond aux filtres actuels.",
  "No records yet": "Aucun dossier pour le moment",
  "No related business records are currently loaded.":
    "Aucun dossier d’entreprise associé n’est actuellement chargé.",
  "No sections match this filter.": "Aucune section ne correspond à ce filtre.",
  "No service records are currently loaded.":
    "Aucun dossier de service n’est actuellement chargé.",
  "No show": "Absent",
  "No staff assigned.": "Aucun membre du personnel affecté.",
  "No wallet account loaded": "Aucun compte portefeuille chargé",
  "No wallet card return requests are loaded.":
    "Aucune demande de retour de carte portefeuille n’est chargée.",
  "No-show": "Absence",
  None: "Aucun",
  "Not confirmed": "Non confirmé",
  "Not required": "Non requis",
  "Not requested": "Non demandé",
  "Note for customers (optional)": "Note pour les clients (facultatif)",
  "Notification preferences saved": "Préférences de notification enregistrées",
  "Notifications & email preferences": "Notifications et préférences email",
  "Notification delivery audit": "Audit des notifications envoyées",
  "Track queued, sent, failed, and provider setup states for email and SMS notifications. Retry only after the matching provider is connected.":
    "Suivez les notifications email et SMS en file, envoyées, échouées et en attente de configuration fournisseur. Réessayez seulement après avoir connecté le fournisseur correspondant.",
  "Delivery audit could not load":
    "Impossible de charger l’audit des notifications",
  "Search deliveries": "Rechercher les envois",
  "Action needed": "Action requise",
  Queued: "En file",
  Processing: "En cours",
  Sent: "Envoyé",
  Failed: "Échec",
  "Provider setup": "Configuration fournisseur",
  "No recipient": "Aucun destinataire",
  "Opted out": "Désabonné",
  Channel: "Canal",
  Provider: "Fournisseur",
  Recipient: "Destinataire",
  "Provider status": "Statut fournisseur",
  Event: "Événement",
  General: "Général",
  "Retry delivery": "Réessayer l’envoi",
  "Delivery retry queued": "Nouvelle tentative mise en file",
  "No delivery records yet": "Aucun envoi enregistré pour le moment",
  "No delivery records match this search.":
    "Aucun envoi ne correspond à cette recherche.",
  "Loading delivery records…": "Chargement des envois…",
  Notification: "Notification",
  "Support case update": "Mise à jour du dossier d’assistance",
  "A support case needs attention.":
    "Un dossier d’assistance nécessite une action.",
  "Support case needs more information":
    "Le dossier d’assistance nécessite plus d’informations",
  "Support case resolved": "Dossier d’assistance résolu",
  "Support case reopened": "Dossier d’assistance rouvert",
  "Your support case was resolved.": "Votre dossier d’assistance a été résolu.",
  "A support case was reopened.": "Un dossier d’assistance a été rouvert.",
  "SMTP authentication failed": "Échec de l’authentification SMTP",
  "Shipment update": "Mise à jour d’expédition",
  "Your barrel shipment changed status.":
    "Le statut de votre expédition de baril a changé.",
  "SMS sender provider is not connected.":
    "Le fournisseur d’envoi SMS n’est pas connecté.",
  "Account approved": "Compte approuvé",
  "Your business is approved.": "Votre entreprise est approuvée.",
  "Notify admins of new applications":
    "Notifier les admins des nouvelles candidatures",
  "Email sender provider": "Fournisseur d’envoi email",
  "No email sender connected": "Aucun expéditeur email connecté",
  "Firebase Trigger Email extension": "Extension Firebase Trigger Email",
  "Use the Firebase provider only after the extension is installed and configured.":
    "Utilisez le fournisseur Firebase seulement après l’installation et la configuration de l’extension.",
  "Ready to test": "Prêt à tester",
  "Setup needed": "Configuration requise",
  "Email provider": "Fournisseur email",
  "Firebase Trigger Email must be installed with the Firestore collection set to mail and valid SMTP credentials.":
    "Firebase Trigger Email doit être installé avec la collection Firestore définie sur mail et des identifiants SMTP valides.",
  "Open Firebase Extensions": "Ouvrir Firebase Extensions",
  "Setup guide": "Guide de configuration",
  "Email test queued": "Test email mis en file",
  "Send email test": "Envoyer un test email",
  "SMS provider": "Fournisseur SMS",
  "A Firestore SMS worker must process smsMessages records and write delivery status back to each record.":
    "Un worker SMS Firestore doit traiter les enregistrements smsMessages et écrire le statut de livraison sur chaque enregistrement.",
  "SMS test queued": "Test SMS mis en file",
  "Send SMS test": "Envoyer un test SMS",
  "Laawol Digital test notification": "Notification de test Laawol Digital",
  "This confirms your notification provider is connected.":
    "Cela confirme que votre fournisseur de notifications est connecté.",
  "Connect the Firebase Trigger Email provider before testing.":
    "Connectez le fournisseur Firebase Trigger Email avant de tester.",
  "Connect the Firestore SMS queue provider before testing.":
    "Connectez le fournisseur de file SMS Firestore avant de tester.",
  "Choose email or SMS for the notification test":
    "Choisissez email ou SMS pour le test de notification",
  "Choose email or SMS for the notification test.":
    "Choisissez email ou SMS pour le test de notification.",
  "Your admin account needs a valid email before testing email.":
    "Votre compte admin doit avoir un email valide avant de tester l’email.",
  "Your admin account needs a phone number before testing SMS.":
    "Votre compte admin doit avoir un numéro de téléphone avant de tester le SMS.",
  "The notification test could not be queued.":
    "Le test de notification n’a pas pu être mis en file.",
  "Email delivery queue": "File d’envoi email",
  "Queues email through the Firebase mail collection.":
    "Met en file les emails via la collection Firebase mail.",
  "Email notifications": "Notifications par email",
  "Records email deliveries; provider selection controls actual sending.":
    "Enregistre les livraisons email; le choix du fournisseur contrôle l’envoi réel.",
  Open: "Ouvert",
  "Open pooled barrels, approve joiners, and seal full barrels into tracked shipments.":
    "Ouvrez des barils groupés, approuvez les participants et scellez les barils complets en expéditions suivies.",
  "Open account settings": "Ouvrir les paramètres du compte",
  "Open application": "Ouvrir la candidature",
  "Open by status": "Ouverts par statut",
  "Open console": "Ouvrir la console",
  "Open purchase": "Ouvrir l’achat",
  "Open shipment": "Ouvrir l’expédition",
  "Opening admin console...": "Ouverture de la console admin...",
  "Operations manager": "Responsable opérations",
  Optional: "Facultatif",
  "Optional old display name": "Ancien nom public facultatif",
  Overview: "Vue d’ensemble",
  "Owner email": "Email du propriétaire",
  "Owner name": "Nom du propriétaire",
  "Owner name is required.": "Le nom du propriétaire est requis.",
  "Owner phone": "Téléphone du propriétaire",
  Owners: "Propriétaires",
  "Paid hold": "Blocage payé",
  "Paid holds": "Blocages payés",
  Paid: "Payé",
  Parked: "Stationné",
  "Parked car": "Voiture stationnée",
  "Parking date": "Date de stationnement",
  "Parking record created.": "Dossier de stationnement créé.",
  "Parking record updated.": "Dossier de stationnement mis à jour.",
  "Parking status updated.": "Statut de stationnement mis à jour.",
  "Partner workspaces": "Espaces partenaires",
  Payments: "Paiements",
  "Pending amount": "Montant en attente",
  "Pending document review": "Vérification des documents en attente",
  "Pending in wallets": "En attente dans les portefeuilles",
  "Pending payment": "Paiement en attente",
  "Pending purchases": "Achats en attente",
  "Pending refund amount": "Montant de remboursement en attente",
  "Pending refunds": "Remboursements en attente",
  "Pending return": "Retour en attente",
  "Wallet available": "Portefeuille disponible",
  "awaiting payout": "en attente de versement",
  "card return": "retour de carte",
  "Pending seal": "En attente de scellement",
  "People & access": "Équipe et accès",
  "Per day": "Par jour",
  "Partially filled": "Partiellement rempli",
  "Phone confirmation": "Confirmation du téléphone",
  "Phone confirmed": "Téléphone confirmé",
  "Phone verification code sent": "Code de vérification téléphone envoyé",
  "Photo URL": "URL de la photo",
  "Pick a partner to manage its people, listings, services, payments, and support history in one place.":
    "Choisissez un partenaire pour gérer son équipe, ses annonces, ses services, ses paiements et son historique d’assistance au même endroit.",
  "Pick-up": "Collecte",
  "Pickup address": "Adresse de collecte",
  "Pickup borough": "Arrondissement de collecte",
  "Pickup fee": "Frais de collecte",
  "Pickup time": "Heure de collecte",
  "Platform Administrator": "Administrateur de plateforme",
  "Platform admins": "Administrateurs plateforme",
  "Platform manager": "Responsable plateforme",
  "Platform manager created": "Responsable plateforme créé",
  "Platform name": "Nom de la plateforme",
  "Push notifications": "Notifications push",
  "Preview Administrator": "Aperçu administrateur",
  "Preview data": "Données d’aperçu",
  "Price is negotiable": "Prix négociable",
  "Price per barrel (USD)": "Prix par baril (USD)",
  "Pricing &amp; status": "Prix et statut",
  "Pricing is pending review for this shipment.":
    "Le prix de cette expédition est en attente d’examen.",
  "Pricing rows": "Lignes de prix",
  "Primary CTA href": "Lien du CTA principal",
  "Primary CTA label": "Libellé du CTA principal",
  Priority: "Priorité",
  "Production console for platform administrators.":
    "Console de production pour les administrateurs de plateforme.",
  "Production setup tools": "Outils de configuration production",
  "Production tools": "Outils production",
  "Profile only": "Profil uniquement",
  "Profile photo": "Photo de profil",
  "Profile photo uploaded": "Photo de profil téléversée",
  "Profile updated": "Profil mis à jour",
  "Ready to review": "Prêt à examiner",
  "Ready for pickup": "Prêt pour collecte",
  Receiver: "Destinataire",
  "Receiver name": "Nom du destinataire",
  "Receiver phone": "Téléphone du destinataire",
  "Recent activity": "Activité récente",
  "Recent business support requests":
    "Demandes récentes d’assistance entreprise",
  Record: "Dossier",
  Records: "Dossiers",
  Refresh: "Actualiser",
  "Refresh Auth": "Actualiser Auth",
  "Refund decision emails": "Emails de décision de remboursement",
  "Refund queue": "File de remboursements",
  "Refund request": "Demande de remboursement",
  "Refund request completed": "Demande de remboursement terminée",
  "Refund request rejected": "Demande de remboursement rejetée",
  "Refund requests": "Demandes de remboursement",
  "Refund pending": "Remboursement en attente",
  Refunded: "Remboursé",
  Refunds: "Remboursements",
  "Refunds to pay": "Remboursements à payer",
  "Rejecting refund request...": "Rejet de la demande de remboursement...",
  "Related:": "Associé :",
  "Remove to customer": "Retourner au client",
  "Reply to support requests": "Répondre aux demandes d’assistance",
  "Request amount": "Montant demandé",
  Requested: "Demandé",
  "All pool statuses": "Tous les statuts de baril partagé",
  "Add an active barrel destination with a price before starting a shared pool.":
    "Ajoutez une destination de baril active avec un prix avant d’ouvrir un baril partagé.",
  "Adjusted total shares cannot be below reserved shares.":
    "Le total ajusté ne peut pas être inférieur aux parts réservées.",
  "Adjusted total shares must be between 2 and 4.":
    "Le total ajusté des parts doit être entre 2 et 4.",
  "Adjust inspected shares": "Ajuster les parts inspectées",
  "Adjust shares": "Ajuster les parts",
  Air: "Aérien",
  Approve: "Approuver",
  "Approval mode": "Mode d’approbation",
  "Auto approve": "Approbation automatique",
  "Business-held": "Géré par l’entreprise",
  "Business earnings": "Revenus entreprise",
  "Business payout": "Versement entreprise",
  "A Stripe payout account is connected. Stripe may still be checking the bank account or requesting more details before payouts can start.":
    "Un compte de versement Stripe est connecté. Stripe peut encore vérifier le compte bancaire ou demander plus de détails avant d’activer les versements.",
  "Checking status...": "Vérification du statut...",
  "Charges not verified": "Paiements non vérifiés",
  "Charges verified": "Paiements vérifiés",
  "Choose a shared barrel pool.": "Choisissez un baril partagé.",
  "Choose a future matching deadline.":
    "Choisissez une date limite de mise en relation future.",
  "Choose a destination.": "Choisissez une destination.",
  "Contents note": "Note sur le contenu",
  "Current shares": "Parts actuelles",
  "Customer drop-off": "Dépôt client",
  "Customer-posted, drop-off, and business-held consolidation pools will appear here.":
    "Les regroupements publiés par les clients, déposés ou gérés par l’entreprise apparaîtront ici.",
  "Drop-off pools need 1 reserved share and at least 1 open share.":
    "Les barils déposés nécessitent 1 part réservée et au moins 1 part ouverte.",
  "Enter at least 1 max joiner.": "Saisissez au moins 1 participant maximum.",
  "Explain measured capacity or packing mismatch":
    "Expliquez la capacité mesurée ou l’écart de chargement",
  "Inspected total shares": "Total des parts inspectées",
  "Inspection note": "Note d’inspection",
  "Inspection note is required.": "La note d’inspection est requise.",
  "Inspection note:": "Note d’inspection :",
  "Joiner accepted.": "Participant accepté.",
  "Joiner rejected.": "Participant rejeté.",
  "Join deadline": "Date limite d’inscription",
  "Last inspection": "Dernière inspection",
  "Manual approval": "Approbation manuelle",
  "Max joiners": "Participants max.",
  "Open pool": "Ouvrir le baril",
  "Optional packing note": "Note de colis facultative",
  "Only active shared barrel pools can be adjusted.":
    "Seuls les barils partagés actifs peuvent être ajustés.",
  "Pool capacity adjusted.": "Capacité du baril ajustée.",
  "Pool cancelled.": "Baril partagé annulé.",
  "Pool is required.": "Le baril partagé est requis.",
  "Pool origin": "Origine du baril",
  "Register with Stripe so Laawol can verify the business and send payouts securely.":
    "Inscrivez-vous avec Stripe afin que Laawol puisse vérifier l’entreprise et envoyer les versements en toute sécurité.",
  "Start Stripe registration": "Démarrer l’inscription Stripe",
  "Connected, pending verification": "Connecté, vérification en attente",
  "Continue in Stripe": "Continuer dans Stripe",
  "Continue Stripe setup": "Continuer la configuration Stripe",
  "Set up Stripe to continue": "Configurer Stripe pour continuer",
  "Finish Stripe setup to continue":
    "Terminer la configuration Stripe pour continuer",
  "Before your business can be approved for paid services, create your secure Stripe account for identity, tax, legal, and bank verification.":
    "Avant que votre entreprise puisse être approuvée pour les services payants, créez votre compte Stripe sécurisé pour la vérification d’identité, fiscale, légale et bancaire.",
  "Your Stripe account exists, but Stripe still needs verification details before Laawol can approve payouts or send customer payments to your business.":
    "Votre compte Stripe existe, mais Stripe a encore besoin d’informations de vérification avant que Laawol puisse approuver les versements ou envoyer les paiements clients à votre entreprise.",
  "Required first step": "Première étape obligatoire",
  "Opening Stripe...": "Ouverture de Stripe...",
  "Stripe setup help": "Aide à la configuration Stripe",
  "Complete Stripe setup and any requested profile details while it waits for platform approval.":
    "Terminez la configuration Stripe et les détails de profil demandés pendant l’attente de l’approbation de la plateforme.",
  "Stuck with Stripe setup?": "Bloqué dans la configuration Stripe ?",
  "Use Continue in Stripe to finish identity, tax, legal, and bank questions. Return here and refresh the status after submitting.":
    "Utilisez Continuer dans Stripe pour terminer les questions d’identité, fiscales, légales et bancaires. Revenez ici et actualisez le statut après l’envoi.",
  "Stripe help center": "Centre d’aide Stripe",
  "Contact Laawol support": "Contacter l’assistance Laawol",
  "Do not upload identity, tax, legal, or bank files to Laawol. Stripe must collect those details in its secure onboarding flow.":
    "Ne téléversez pas de fichiers d’identité, fiscaux, légaux ou bancaires dans Laawol. Stripe doit collecter ces informations dans son parcours d’inscription sécurisé.",
  "Could not refresh payout status.":
    "Impossible d’actualiser le statut des versements.",
  "Could not refresh Stripe payout status. Open Stripe setup again or contact Laawol support.":
    "Impossible d’actualiser le statut de versement Stripe. Ouvrez à nouveau la configuration Stripe ou contactez l’assistance Laawol.",
  "Could not start Stripe onboarding.":
    "Impossible de démarrer l’inscription Stripe.",
  "All business commissions saved":
    "Commissions de toutes les entreprises enregistrées",
  "Business overrides are used before the default platform transaction fee.":
    "Les réglages par entreprise sont appliqués avant les frais de transaction plateforme par défaut.",
  "Commission (%)": "Commission (%)",
  "Enter a platform fee greater than 0 and less than 100.":
    "Saisissez des frais de plateforme supérieurs à 0 et inférieurs à 100.",
  "Gross received": "Montant brut reçu",
  "Recipient name": "Nom du destinataire",
  "Refresh status": "Actualiser le statut",
  "Reserved shares": "Parts réservées",
  "Reserved shares must leave at least 1 share open.":
    "Les parts réservées doivent laisser au moins 1 part ouverte.",
  "Pool sealed into a shipment.": "Baril scellé en expédition.",
  "Platform fee": "Frais plateforme",
  "Platform fee (%)": "Frais plateforme (%)",
  "Platform fee saved": "Frais plateforme enregistrés",
  "Platform fees": "Frais plateforme",
  "Platform transaction fee": "Frais de transaction plateforme",
  "Use default for selected": "Utiliser la valeur par défaut pour la sélection",
  "Paid transactions": "Transactions payées",
  "Payout setup required": "Configuration des versements requise",
  Payouts: "Versements",
  "Payouts enabled": "Versements activés",
  "Pending payments": "Paiements en attente",
  "Pending transactions": "Transactions en attente",
  "Sender, receiver, and receiver phone are required for drop-off pools.":
    "L’expéditeur, le destinataire et le téléphone du destinataire sont requis pour les dépôts client.",
  Service: "Service",
  "Sender name": "Nom de l’expéditeur",
  "Save adjustment": "Enregistrer l’ajustement",
  "Seal pool": "Sceller le baril",
  "Seal underfilled": "Sceller partiellement",
  Sealed: "Scellé",
  Sea: "Maritime",
  "Ship mode": "Mode d’expédition",
  "Shared barrel pool opened.": "Baril partagé ouvert.",
  "Start pool": "Ouvrir un baril",
  "Start shared barrel pool": "Ouvrir un baril partagé",
  "Total shares": "Nombre total de parts",
  "Total shares must be between 2 and 4.":
    "Le nombre total de parts doit être entre 2 et 4.",
  Underfilled: "Partiellement rempli",
  "Underfilled pool sealed into a shipment.":
    "Baril partiellement rempli scellé en expédition.",
  "Update total shares only after physical inspection. The total cannot be lower than already reserved shares.":
    "Ajustez le nombre total de parts seulement après inspection physique. Le total ne peut pas être inférieur aux parts déjà réservées.",
  "Stripe did not return an onboarding link.":
    "Stripe n’a pas renvoyé de lien d’inscription.",
  "Working...": "Traitement...",
  "2 halves": "2 moitiés",
  "3 shares": "3 parts",
  "4 quarters": "4 quarts",
  "Require at least one service": "Exiger au moins un service",
  "Require business address": "Exiger l’adresse de l’entreprise",
  "Require business documents": "Exiger les documents de l’entreprise",
  "Require phone number": "Exiger le numéro de téléphone",
  "Resolve refund": "Résoudre le remboursement",
  "Return this pending amount to the customer's wallet?":
    "Retourner ce montant en attente dans le portefeuille du client ?",
  "Review business": "Examiner l’entreprise",
  "Review each business first, then inspect and control the listings that business published.":
    "Examinez d’abord chaque entreprise, puis inspectez et contrôlez les annonces qu’elle a publiées.",
  "Review note": "Note d’examen",
  "Review the customer account and wallet balance before action. Complete after the external card return is done. Reject moves the pending amount back to the customer's wallet.":
    "Examinez le compte client et le solde du portefeuille avant d’agir. Terminez après le retour externe de la carte. Le rejet remet le montant en attente dans le portefeuille du client.",
  Reviewed: "Examiné",
  "Role name": "Nom du rôle",
  Roles: "Rôles",
  "Roles & configuration": "Rôles et configuration",
  "Roles & permissions": "Rôles et permissions",
  "Roles & permissions saved": "Rôles et permissions enregistrés",
  "Run a dry run or enter explicit car IDs before applying.":
    "Lancez une simulation ou saisissez des IDs de voitures explicites avant d’appliquer.",
  "Run setup utilities that already exist in the Firebase backend.":
    "Lancez les utilitaires de configuration déjà présents dans le backend Firebase.",
  "Running...": "Exécution...",
  "Sales contact": "Contact vente",
  Saved: "Enregistré",
  "Saving profile...": "Enregistrement du profil...",
  "Saving...": "Enregistrement...",
  "Schedule a vehicle transport to get started.":
    "Planifiez un transport de véhicule pour commencer.",
  "Schedule and track car transport for your customers.":
    "Planifiez et suivez le transport de voitures pour vos clients.",
  Scheduled: "Planifié",
  "Search businesses": "Rechercher des entreprises",
  "Search to narrow the list.": "Recherchez pour réduire la liste.",
  "Search customer, business, phone, tracking, status":
    "Rechercher client, entreprise, téléphone, suivi, statut",
  "Search records": "Rechercher des dossiers",
  "Search title, VIN, stock, make, contact":
    "Rechercher titre, VIN, stock, marque, contact",
  "Search users": "Rechercher des utilisateurs",
  "Secondary CTA href": "Lien du CTA secondaire",
  "Secondary CTA label": "Libellé du CTA secondaire",
  "Seed selected business destinations":
    "Initialiser les destinations de l’entreprise sélectionnée",
  "Set up destinations": "Configurer les destinations",
  "Select a business first.": "Sélectionnez d’abord une entreprise.",
  "Select a business to open its workspace.":
    "Sélectionnez une entreprise pour ouvrir son espace.",
  "Select a destination country.": "Sélectionnez un pays de destination.",
  "Select a supported country.": "Sélectionnez un pays pris en charge.",
  "Select at least one business.": "Sélectionnez au moins une entreprise.",
  "Select at least one listing.": "Sélectionnez au moins une annonce.",
  "Select body type": "Sélectionner le type de carrosserie",
  "Select drivetrain": "Sélectionner la transmission motrice",
  "Select fuel type": "Sélectionner le carburant",
  "Select transmission": "Sélectionner la transmission",
  "Send a code and enter it before confirming.":
    "Envoyez un code et saisissez-le avant de confirmer.",
  "Send code": "Envoyer le code",
  Sender: "Expéditeur",
  "Sender address": "Adresse de l’expéditeur",
  "Sender email": "Email de l’expéditeur",
  "Sender phone": "Téléphone de l’expéditeur",
  "Sending phone code...": "Envoi du code téléphone...",
  "Service load": "Charge de service",
  "Service operations": "Opérations de service",
  "Service types": "Types de service",
  "Set a price per country so customers can ship barrels there.":
    "Définissez un prix par pays afin que les clients puissent y envoyer des barils.",
  "Select results": "Sélectionner les résultats",
  "Set as cover": "Définir comme couverture",
  "Set all businesses": "Appliquer à toutes les entreprises",
  "Set selected": "Appliquer aux entreprises sélectionnées",
  "Setup utilities": "Utilitaires de configuration",
  "Shipment pricing": "Prix d’expédition",
  "Shipment updated.": "Expédition mise à jour.",
  Shipments: "Expéditions",
  "Shipping defaults saved": "Paramètres d’expédition par défaut enregistrés",
  "Shipping destinations": "Destinations d’expédition",
  "Shipping fee": "Frais d’expédition",
  Showing: "Affichage",
  of: "sur",
  "finance rows": "lignes financières",
  "visible amount": "montant visible",
  "Sign in before confirming your phone.":
    "Connectez-vous avant de confirmer votre téléphone.",
  "Sign in before uploading a profile photo.":
    "Connectez-vous avant de téléverser une photo de profil.",
  "Sign in failed. Try again or contact support.":
    "Connexion échouée. Réessayez ou contactez l’assistance.",
  "Signed in": "Connecté",
  "Site content": "Contenu du site",
  "Skip manual review (not recommended)":
    "Ignorer l’examen manuel (non recommandé)",
  "SMS code": "Code SMS",
  "SMS sender provider": "Fournisseur d’envoi SMS",
  "No SMS sender connected": "Aucun expéditeur SMS connecté",
  "Firestore SMS queue": "File SMS Firestore",
  "Use the queue provider only after an SMS worker or extension is connected.":
    "Utilisez le fournisseur de file seulement après la connexion d’un worker ou d’une extension SMS.",
  "SMS delivery queue": "File d’envoi SMS",
  "Queues phone notifications only for users who opt in.":
    "Met en file les notifications téléphone uniquement pour les utilisateurs inscrits.",
  "SMS notifications": "Notifications SMS",
  "Records phone deliveries only for users who opt in; provider selection controls actual sending.":
    "Enregistre les livraisons téléphone uniquement pour les utilisateurs inscrits; le choix du fournisseur contrôle l’envoi réel.",
  "Sold amount": "Montant vendu",
  "Sold date": "Date de vente",
  "Sold email": "Email de vente",
  "Sold notes": "Notes de vente",
  "Sold phone": "Téléphone de vente",
  "Sold to": "Vendu à",
  Specifications: "Caractéristiques",
  "Status updated.": "Statut mis à jour.",
  Stock: "Stock",
  "Stock number": "Numéro de stock",
  "Stripe is complete. If the remaining Laawol documents are not needed for this business, use the bypass approval action so the override is recorded on the verification review.":
    "Stripe est terminé. Si les documents Laawol restants ne sont pas nécessaires pour cette entreprise, utilisez l’approbation avec contournement afin que l’exception soit enregistrée dans l’examen de vérification.",
  "Street address (optional)": "Adresse (facultatif)",
  Subject: "Sujet",
  "Super admin": "Super admin",
  "Access not configured": "Accès non configuré",
  "Remove admin access": "Retirer l’accès admin",
  "Support admin": "Admin assistance",
  "Support case status emails": "Emails de statut des dossiers d’assistance",
  "Support contacts": "Contacts d’assistance",
  "Support escalation emails": "Emails d’escalade d’assistance",
  "Support message emails": "Emails de messages d’assistance",
  "Support request": "Demande d’assistance",
  "Support request sent": "Demande d’assistance envoyée",
  Suspended: "Suspendu",
  System: "Système",
  Tagline: "Slogan",
  Team: "Équipe",
  "These fields are public. Keep private platform settings in Settings; only marketing-safe contact details belong here.":
    "Ces champs sont publics. Gardez les paramètres privés de plateforme dans Paramètres; seuls les contacts adaptés au marketing doivent figurer ici.",
  "These people were found on shipments, purchases, refunds, or service records. They are not editable accounts unless Firebase Auth has a matching user.":
    "Ces personnes ont été trouvées dans des expéditions, achats, remboursements ou dossiers de service. Ce ne sont pas des comptes modifiables sauf si Firebase Auth possède un utilisateur correspondant.",
  "These settings stay in the admin and app configuration. Public website copy and marketing contact details are managed from Website.":
    "Ces paramètres restent dans la configuration admin et app. Le contenu du site public et les contacts marketing sont gérés dans Site web.",
  "This business has no destination list yet. Add the country list, then activate only the countries this business ships to.":
    "Cette entreprise n’a pas encore de liste de destinations. Ajoutez la liste des pays, puis activez uniquement ceux desservis par cette entreprise.",
  "This business has no marketplace listings loaded.":
    "Aucune annonce marketplace n’est chargée pour cette entreprise.",
  "This business was inferred from existing marketplace or operations records. Create a profile document before assigning people or editing status.":
    "Cette entreprise a été déduite de dossiers marketplace ou opérationnels existants. Créez un document de profil avant d’affecter des personnes ou de modifier le statut.",
  "This console is restricted to platform administrators.":
    "Cette console est réservée aux administrateurs de la plateforme.",
  "This role can view finance records but cannot send business support requests.":
    "Ce rôle peut voir les dossiers financiers mais ne peut pas envoyer de demandes d’assistance entreprise.",
  "This percentage is kept by the platform from each paid customer transaction before calculating the business payout. It is saved to the live payment pricing record used by backend checkout functions.":
    "Ce pourcentage est conservé par la plateforme sur chaque transaction client payée avant de calculer le versement de l’entreprise. Il est enregistré dans le tarif de paiement actif utilisé par les fonctions de paiement backend.",
  "No paid business transactions are loaded yet.":
    "Aucune transaction entreprise payée n’est chargée pour le moment.",
  Title: "Titre",
  "Too many failed attempts. Try again later.":
    "Trop de tentatives échouées. Réessayez plus tard.",
  Total: "Total",
  "Total cost": "Coût total",
  "Total cost (USD)": "Coût total (USD)",
  "Total records": "Total des dossiers",
  "Tracking code": "Code de suivi",
  Transmission: "Transmission",
  "Transport created.": "Transport créé.",
  "Transport request": "Demande de transport",
  "Transport requests": "Demandes de transport",
  "Transport updated.": "Transport mis à jour.",
  "Trusted services from registered businesses":
    "Services de confiance proposés par des entreprises inscrites",
  "Unassigned business": "Entreprise non affectée",
  "Unassigned listings": "Annonces non affectées",
  Unsaved: "Non enregistré",
  "Untitled role": "Rôle sans titre",
  Upload: "Téléverser",
  Up: "Monter",
  "Update failed.": "Échec de la mise à jour.",
  "Update status": "Mettre à jour le statut",
  Updated: "Mis à jour",
  "Updated by": "Mis à jour par",
  "Updating destination...": "Mise à jour de la destination...",
  "Updating...": "Mise à jour...",
  "Upload photo": "Téléverser une photo",
  "Uploading photo...": "Téléversement de la photo...",
  "Uploading...": "Téléversement...",
  "Used in the admin header and audit/account context.":
    "Utilisé dans l’en-tête admin et le contexte audit/compte.",
  "User deleted": "Utilisateur supprimé",
  "User profile created": "Profil utilisateur créé",
  "User role updated": "Rôle utilisateur mis à jour",
  Vehicle: "Véhicule",
  "Vehicle sales": "Vente de véhicules",
  "Vehicle transport": "Transport de véhicule",
  View: "Voir",
  "View only": "Lecture seule",
  Viewing: "Visite",
  "Viewing scheduled": "Visite planifiée",
  Viewings: "Visites",
  "Wallet balance": "Solde portefeuille",
  "Wallet card return requests": "Demandes de retour de carte portefeuille",
  "Wallet transaction": "Transaction portefeuille",
  "Website contact saved": "Contact du site enregistré",
  "Website content saved": "Contenu du site enregistré",
  "What needs you now": "Ce qui vous attend maintenant",
  "What should the business handle?": "Que doit gérer l’entreprise ?",
  WhatsApp: "WhatsApp",
  "When customers book barrels to your destinations, they show up here to manage.":
    "Lorsque les clients réservent des barils vers vos destinations, ils apparaissent ici pour gestion.",
  "When customers reserve a viewing or pay a hold deposit, they show up here.":
    "Lorsque les clients réservent une visite ou paient un acompte de blocage, ils apparaissent ici.",
  "Wrong/default ownership fixes require explicit car IDs.":
    "Les corrections de propriété incorrecte/par défaut exigent des IDs de voitures explicites.",
  "You have view access to people. Managing administrators, roles, and accounts requires the Super admin or User-management privilege.":
    "Vous avez un accès en lecture à l’équipe. La gestion des administrateurs, rôles et comptes exige le privilège Super admin ou Gestion utilisateurs.",
  "Your listings": "Vos annonces",
  "ZIP / postal code": "Code postal",
  "/ barrel": "/ baril",
  Senegal: "Sénégal",
  "Confirm contents, prohibited items, and shared liability before starting the pool.":
    "Confirmez le contenu, les articles interdits et la responsabilité partagée avant d’ouvrir le baril.",
  "Contents note is required for drop-off pools.":
    "La note de contenu est requise pour les barils déposés.",
  "Choose a future join deadline.":
    "Choisissez une date limite d’inscription future.",
  "Could not open the pool. Check your connection and try again.":
    "Impossible d’ouvrir le baril. Vérifiez votre connexion et réessayez.",
  "Business-held pools must start with 0 reserved shares.":
    "Les barils détenus par l’entreprise doivent commencer avec 0 part réservée.",
  "Contents and weight were reviewed with the customer.":
    "Le contenu et le poids ont été vérifiés avec le client.",
  "Describe packed contents": "Décrivez le contenu emballé",
  "Drop-off weight must fit the reserved shares.":
    "Le poids du dépôt doit correspondre aux parts réservées.",
  "Inspected weight (kg)": "Poids inspecté (kg)",
  "No prohibited or unsafe items were accepted.":
    "Aucun article interdit ou dangereux n’a été accepté.",
  "Max joiners must fit the open shares.":
    "Le nombre maximal de participants doit correspondre aux parts ouvertes.",
  "Opening pool...": "Ouverture du baril...",
  "Required for customer drop-off pools.":
    "Obligatoire pour les barils déposés par un client.",
  "Security check failed. Refresh the page and try again.":
    "La vérification de sécurité a échoué. Actualisez la page et réessayez.",
  "You do not have permission to open shared barrel pools for this business.":
    "Vous n’avez pas l’autorisation d’ouvrir des barils partagés pour cette entreprise.",
  "Your session expired. Sign in again and retry.":
    "Votre session a expiré. Reconnectez-vous et réessayez.",
  "The customer accepted shared-barrel liability and inspection rules.":
    "Le client a accepté la responsabilité du baril partagé et les règles d’inspection.",
  "20 kg per share max": "20 kg maximum par part",
  // ---- Marketplace support cases (business + admin consoles) ----
  "Customer support": "Assistance client",
  "Admin help": "Aide admin",
  "Customers and admin help": "Clients et aide admin",
  "Manage customer order conversations and reach the admin team from one support inbox.":
    "Gérez les conversations de commandes clients et contactez l’équipe admin depuis une seule boîte de support.",
  "New admin request": "Nouvelle demande admin",
  "Customer order cases and admin help requests will appear here.":
    "Les dossiers de commandes clients et les demandes d’aide admin apparaîtront ici.",
  "Admin support case opened": "Dossier d’assistance admin ouvert",
  "What do you need from the admin team?":
    "De quoi avez-vous besoin de la part de l’équipe admin ?",
  "Add the details, order reference, payout issue, or policy question.":
    "Ajoutez les détails, la référence de commande, le problème de versement ou la question de politique.",
  "Business context": "Contexte entreprise",
  "Case type": "Type de dossier",
  "business admin support": "assistance admin entreprise",
  "Write a reply...": "Écrire une réponse...",
  "Order conversations": "Conversations de commande",
  "Escalated support": "Assistance escaladée",
  "Escalated cases": "Dossiers escaladés",
  "Cases customers or businesses escalated to the admin team.":
    "Dossiers que les clients ou les entreprises ont escaladés vers l’équipe admin.",
  "Conversations with customers about their orders. You are first-line support.":
    "Conversations avec les clients à propos de leurs commandes. Vous êtes le premier niveau d’assistance.",
  "Show resolved": "Afficher les résolus",
  "Search cases…": "Rechercher des dossiers…",
  "No support cases": "Aucun dossier d’assistance",
  "Escalated cases will appear here.":
    "Les dossiers escaladés apparaîtront ici.",
  "When a customer opens a case for one of your orders, it shows up here.":
    "Lorsqu’un client ouvre un dossier pour l’une de vos commandes, il apparaît ici.",
  "No messages yet": "Aucun message pour l’instant",
  "Loading…": "Chargement…",
  "Select a case to read the conversation and reply.":
    "Sélectionnez un dossier pour lire la conversation et répondre.",
  "Loading conversation…": "Chargement de la conversation…",
  "No messages in this case yet.":
    "Aucun message dans ce dossier pour l’instant.",
  "Internal notes (admin only)": "Notes internes (admin uniquement)",
  "No internal notes yet.": "Aucune note interne pour l’instant.",
  "Add a private note for the admin team...":
    "Ajouter une note privée pour l’équipe admin...",
  "Add note": "Ajouter une note",
  "Write a reply to the customer…": "Rédigez une réponse au client…",
  "Send reply": "Envoyer la réponse",
  "Request more info": "Demander plus d’informations",
  "Mark resolved": "Marquer comme résolu",
  Reopen: "Rouvrir",
  "Claim case": "Prendre en charge",
  "Escalate to admin": "Escalader vers un admin",
  "Confirm escalation": "Confirmer l’escalade",
  Reason: "Motif",
  "You have read-only access to support cases.":
    "Vous avez un accès en lecture seule aux dossiers d’assistance.",
  "Support case": "Dossier d’assistance",
  Customer: "Client",
  Platform: "Plateforme",
  Attachment: "Pièce jointe",
  "Customer unresponsive": "Client injoignable",
  "Payment dispute": "Litige de paiement",
  "Need admin decision": "Décision d’un admin requise",
  "Suspected fraud": "Fraude présumée",
  "Safety concern": "Problème de sécurité",
  "Other / cannot resolve": "Autre / impossible à résoudre",
  // ---- Support activity timeline + claim/ownership ----
  Activity: "Activité",
  "No recorded activity yet.": "Aucune activité enregistrée pour l’instant.",
  "Claimed by you": "Pris en charge par vous",
  "Claimed by": "Pris en charge par",
  Claimed: "Pris en charge",
  "another admin": "un autre admin",
  "Take over": "Reprendre",
  "You can still reply.": "Vous pouvez tout de même répondre.",
  Someone: "Quelqu’un",
  "opened the case": "a ouvert le dossier",
  "reopened the case": "a rouvert le dossier",
  replied: "a répondu",
  "shared an attachment": "a partagé une pièce jointe",
  "claimed the case": "a pris en charge le dossier",
  "escalated to admin": "a escaladé vers un admin",
  "requested more info": "a demandé plus d’informations",
  "resolved the case": "a résolu le dossier",
  "added an internal note": "a ajouté une note interne",
  "Order context": "Contexte de la commande",
  "Laawol support": "Assistance Laawol",
  "Loading order…": "Chargement de la commande…",
  Tracking: "Suivi",
  Quantity: "Quantité",
  Photo: "Photo",
  File: "Fichier",
  "Sending…": "Envoi…",
  "Vehicle & shipping services": "Services automobiles et d’expédition",
  "Plan the next step with confidence": "Planifiez la prochaine étape en toute confiance",
  "Compare live availability, review the provider, and pay securely without leaving your Laawol account.":
    "Comparez les disponibilités en direct, vérifiez le prestataire et payez en toute sécurité depuis votre compte Laawol.",
  "Choose a service": "Choisir un service",
  "Shared barrels": "Barils partagés",
  "Find secure parking": "Trouver un stationnement sécurisé",
  "Search approved providers for your exact parking dates.":
    "Recherchez des prestataires approuvés pour vos dates exactes de stationnement.",
  "Enter a city": "Saisissez une ville",
  "Start date": "Date de début",
  "End date": "Date de fin",
  "I need vehicle pickup": "J’ai besoin de la collecte du véhicule",
  "Searching parking...": "Recherche de stationnement...",
  "Search parking": "Rechercher un stationnement",
  "Parking options could not be loaded. Try again.":
    "Les options de stationnement n’ont pas pu être chargées. Réessayez.",
  "No parking is available for these dates.":
    "Aucun stationnement n’est disponible à ces dates.",
  "Try another city or adjust your dates.":
    "Essayez une autre ville ou modifiez vos dates.",
  "Available parking": "Stationnements disponibles",
  spaces: "places",
  "Estimated total": "Total estimé",
  "miles away": "miles de distance",
  "Daily rate": "Tarif journalier",
  Pickup: "Collecte",
  "Not available": "Indisponible",
  "Reserve this space": "Réserver cette place",
  "The parking reservation could not be started. Check the details and try again.":
    "La réservation de stationnement n’a pas pu démarrer. Vérifiez les renseignements et réessayez.",
  "Add your vehicle details, then review the provider and dates.":
    "Ajoutez les renseignements du véhicule, puis vérifiez le prestataire et les dates.",
  "Parking dates": "Dates de stationnement",
  "Continue to secure payment": "Continuer vers le paiement sécurisé",
  "Reserve parking": "Réserver le stationnement",
  "Car make": "Marque du véhicule",
  "Car model": "Modèle du véhicule",
  "Car year": "Année du véhicule",
  "VIN number": "Numéro VIN",
  "17-character VIN": "VIN à 17 caractères",
  "Open shared barrels": "Barils partagés ouverts",
  "Reserve one or more available shares with an approved provider.":
    "Réservez une ou plusieurs parts disponibles auprès d’un prestataire approuvé.",
  "Post a shared barrel": "Publier un baril partagé",
  "Search open shared barrels": "Rechercher des barils partagés ouverts",
  "Destination, business, or tracking code":
    "Destination, entreprise ou code de suivi",
  "Open shared barrels are taking too long to load.":
    "Le chargement des barils partagés ouverts prend trop de temps.",
  "Open shared barrels could not be loaded.":
    "Les barils partagés ouverts n’ont pas pu être chargés.",
  "Loading open shared barrels...": "Chargement des barils partagés ouverts...",
  "No shared barrels are open right now.":
    "Aucun baril partagé n’est ouvert pour le moment.",
  "Post one and invite others to share the space.":
    "Publiez-en un et invitez d’autres personnes à partager l’espace.",
  "No shared barrels match your search.":
    "Aucun baril partagé ne correspond à votre recherche.",
  "Already joined": "Déjà rejoint",
  "Request a share": "Demander une part",
  "My shared barrels": "Mes barils partagés",
  "Follow your requests, balances, and next available actions.":
    "Suivez vos demandes, soldes et prochaines actions disponibles.",
  "Your shared barrels are taking too long to load.":
    "Le chargement de vos barils partagés prend trop de temps.",
  "Your shared barrels could not be loaded.":
    "Vos barils partagés n’ont pas pu être chargés.",
  "Loading your shared barrels...": "Chargement de vos barils partagés...",
  "You have not joined a shared barrel yet.":
    "Vous n’avez pas encore rejoint de baril partagé.",
  "Pay balance": "Payer le solde",
  "Cancel this shared barrel?": "Annuler ce baril partagé ?",
  "Leave this shared barrel?": "Quitter ce baril partagé ?",
  "Keep it": "Le conserver",
  "Yes, cancel": "Oui, annuler",
  "Yes, leave": "Oui, quitter",
  "Cancel pool": "Annuler le baril",
  "Leave pool": "Quitter le baril",
  "The shared barrel could not be cancelled. Try again.":
    "Le baril partagé n’a pas pu être annulé. Réessayez.",
  "You could not leave this shared barrel. Try again.":
    "Vous n’avez pas pu quitter ce baril partagé. Réessayez.",
  "Shared barrel": "Baril partagé",
  "Shared barrel availability": "Disponibilité du baril partagé",
  "open shares": "parts ouvertes",
  "Deposit per share": "Acompte par part",
  "Full price per share": "Prix total par part",
  "Your request": "Votre demande",
  "Shared-barrel destinations could not be loaded. Try again.":
    "Les destinations de barils partagés n’ont pas pu être chargées. Réessayez.",
  "The shared barrel could not be posted. Check the details and try again.":
    "Le baril partagé n’a pas pu être publié. Vérifiez les renseignements et réessayez.",
  "The share request could not be started. Check the details and try again.":
    "La demande de part n’a pas pu démarrer. Vérifiez les renseignements et réessayez.",
  "Select a destination": "Sélectionner une destination",
  "Open part of your barrel to other customers traveling to the same destination.":
    "Ouvrez une partie de votre baril à d’autres clients allant vers la même destination.",
  "Reserve available space and send your deposit securely.":
    "Réservez l’espace disponible et envoyez votre acompte en toute sécurité.",
  "Your shares": "Vos parts",
  "Shares requested": "Parts demandées",
  "Use wallet first, then card": "Utiliser d’abord le portefeuille, puis la carte",
  "Secure card payment": "Paiement sécurisé par carte",
  "All content and shared-liability acknowledgements confirmed":
    "Tous les engagements relatifs au contenu et à la responsabilité partagée sont confirmés",
  "Continue to share deposit": "Continuer vers l’acompte de partage",
  "Loading destinations...": "Chargement des destinations...",
  "Destination & provider": "Destination et prestataire",
  "Street, city, state, postal code": "Rue, ville, État, code postal",
  "Contents description": "Description du contenu",
  "Describe what will be placed in your share":
    "Décrivez ce qui sera placé dans votre part",
  "Shares you keep": "Parts que vous conservez",
  "Use my available wallet balance first":
    "Utiliser d’abord le solde disponible de mon portefeuille",
  "Required acknowledgements": "Engagements obligatoires",
  "My contents description is complete and accurate.":
    "Ma description du contenu est complète et exacte.",
  "I will not include prohibited or dangerous items.":
    "Je n’inclurai aucun article interdit ou dangereux.",
  "I accept the limits and responsibilities of shared-barrel service.":
    "J’accepte les limites et responsabilités du service de baril partagé.",
  "The balance payment could not be started. Try again.":
    "Le paiement du solde n’a pas pu démarrer. Réessayez.",
  "Review the verified balance before opening secure payment.":
    "Vérifiez le solde confirmé avant d’ouvrir le paiement sécurisé.",
  "Continue to balance payment": "Continuer vers le paiement du solde",
  "Pay shared-barrel balance": "Payer le solde du baril partagé",
  "Verified balance due": "Solde confirmé dû",
  "This amount was calculated by the provider after the barrel was sealed.":
    "Ce montant a été calculé par le prestataire après la fermeture du baril.",
};

const ATTRIBUTE_TRANSLATIONS: Record<string, string> = {
  "Add a photo by URL": "Ajouter une photo par URL",
  "Collapse navigation": "Réduire la navigation",
  "Copy tracking code": "Copier le code de suivi",
  "Delivery status": "Statut de livraison",
  "Explain missing documents, expiry issues, or why a document is not applicable.":
    "Expliquez les documents manquants, les problèmes d’expiration ou pourquoi un document est sans objet.",
  "Expand navigation": "Développer la navigation",
  "Filter business sections": "Filtrer les sections entreprise",
  "Filter services...": "Filtrer les services...",
  "No-show note (optional)": "Note d’absence (facultatif)",
  Pin: "Épingler",
  "Search car, buyer, phone, status…":
    "Rechercher voiture, acheteur, téléphone, statut…",
  "Search destinations…": "Rechercher des destinations…",
  "Search make, model, status…": "Rechercher marque, modèle, statut…",
  "Search tracking, owner, car, VIN…":
    "Rechercher suivi, propriétaire, voiture, VIN…",
  "Search tracking, sender, receiver, phone…":
    "Rechercher suivi, expéditeur, destinataire, téléphone…",
  "Signed-in account": "Compte connecté",
  Unpin: "Désépingler",
  "Verification document summary": "Résumé des documents de vérification",
  "What your business is known for…":
    "Ce pour quoi votre entreprise est connue…",
};

const frToEn = Object.entries(TEXT_TRANSLATIONS).reduce<Record<string, string>>(
  (result, [english, french]) => {
    result[french] = english;
    return result;
  },
  {},
);
const attrFrToEn = Object.entries(ATTRIBUTE_TRANSLATIONS).reduce<
  Record<string, string>
>((result, [english, french]) => {
    result[french] = english;
    return result;
}, {});
const englishDictionary = { ...TEXT_TRANSLATIONS, ...ATTRIBUTE_TRANSLATIONS };
const frenchDictionary = { ...frToEn, ...attrFrToEn };
const englishTextKeys = Object.keys(englishDictionary).sort(
  (a, b) => b.length - a.length,
);
const frenchTextKeys = Object.keys(frenchDictionary).sort(
  (a, b) => b.length - a.length,
);

// Precompile a single alternation regex per direction instead of running a
// ~600-key `replaceAll` reduce on every text node. Keys are sorted
// longest-first, and regex alternation takes the first matching branch at each
// position, so longer phrases win — preserving longest-match behaviour in one
// pass. Without this, translating the full admin DOM pegs the main thread.
function buildTranslationRegex(keys: string[]) {
  if (keys.length === 0) return null;
  const escaped = keys.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"), "g");
}
const englishRegex = buildTranslationRegex(englishTextKeys);
const frenchRegex = buildTranslationRegex(frenchTextKeys);

function isIdentifierChar(value: string | undefined) {
  return value ? /[A-Za-z0-9_]/.test(value) : false;
}

function isInsideIdentifier(value: string, offset: number, match: string) {
  return (
    isIdentifierChar(value[offset - 1]) ||
    isIdentifierChar(value[offset + match.length])
  );
}

function currentLang() {
  return currentWebLanguage();
}

export function translateValue(value: string, lang: string) {
  const sourceDict = lang === "en" ? frenchDictionary : englishDictionary;
  const exact = sourceDict[value];
  if (exact) return exact;

  // Already in the target language? A known translated value (e.g. "Finances")
  // must be returned untouched — otherwise the substring regex re-translates a
  // fragment of it ("Finance" -> "Finances" -> "Financess" -> …) and never
  // converges. This keeps translation idempotent by construction.
  const targetDict = lang === "en" ? englishDictionary : frenchDictionary;
  if (value in targetDict) return value;

  const regex = lang === "en" ? frenchRegex : englishRegex;
  if (!regex) return value;
  regex.lastIndex = 0;
  return value.replace(regex, (match, offset: number) => {
    if (isInsideIdentifier(value, offset, match)) return match;
    return sourceDict[match] ?? match;
  });
}

function translateTextNode(node: Node) {
  const value = node.textContent;
  if (!value) return;
  const trimmed = value.trim();
  const translated = translateValue(trimmed, currentLang());
  if (translated === trimmed) return;
  node.textContent = value.replace(trimmed, translated);
}

function translateAttributes(element: Element) {
  ["placeholder", "title", "aria-label", "alt"].forEach((name) => {
    const value = element.getAttribute(name);
    if (!value) return;
    const translated = translateValue(value, currentLang());
    if (translated !== value) element.setAttribute(name, translated);
  });
}

function translateTree(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    translateTextNode(current);
    current = walker.nextNode();
  }
  if (root instanceof Element) translateAttributes(root);
  root.querySelectorAll?.("*").forEach(translateAttributes);
  document.documentElement.lang = currentLang();
  document.title = translateValue(document.title, currentLang());
}

function installToggle() {
  if (document.querySelector("[data-console-lang-toggle]")) return;
  const button = document.createElement("button");
  const nextLang = currentLang() === "en" ? "fr" : "en";
  button.type = "button";
  button.className = "secondary-button compact console-lang-toggle";
  button.dataset.consoleLangToggle = "true";
  button.textContent = nextLang.toUpperCase();
  button.title =
    nextLang === "fr"
      ? "Switch language to French"
      : "Passer la langue en anglais";
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLang);
    window.location.reload();
  });
  document.body.appendChild(button);
}

export function useFrenchDomTranslation() {
  useEffect(() => {
    installToggle();

    let observer: MutationObserver | null = null;
    // Guard against the observer reacting to its own DOM writes. Writing
    // `textContent`/attributes triggers more mutations; without this the
    // observer feeds itself in an endless loop and freezes the console.
    let translating = false;
    const runGuarded = (work: () => void) => {
      if (translating) return;
      translating = true;
      try {
        work();
      } finally {
        // Discard the mutation records our own writes just generated so they
        // are not reprocessed when the next callback fires.
        observer?.takeRecords();
        translating = false;
      }
    };

    runGuarded(() => translateTree(document.body));

    observer = new MutationObserver((mutations) => {
      runGuarded(() => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE) {
              translateTextNode(node);
            } else if (node instanceof Element) {
              translateTree(node);
            }
          });
          if (mutation.type === "characterData")
            translateTextNode(mutation.target);
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => observer?.disconnect();
  }, []);
}
