(function () {
  var storageKey = "laawol:lang";
  var defaultLang = "fr";
  var enToFr = {
    "Track a shipment — Laawol Digital": "Suivi de commande — Laawol Digital",
    "Clear tracking, every step": "Un suivi clair, à chaque étape",
    "Track your order from departure to arrival": "Suivez votre commande du départ à l’arrivée",
    "As soon as your package, barrel, or car is on the way, Laawol gives you a tracking number and status updates, right alongside your order.": "Dès que votre colis, votre baril ou votre voiture est en route, Laawol vous donne un numéro de suivi et les mises à jour de statut, au même endroit que votre commande.",
    "Track my order": "Suivre ma commande",
    "From shipment to tracked delivery": "De l’expédition à la livraison suivie",
    "Get your tracking number": "Recevez votre numéro de suivi",
    "As soon as your order is confirmed, Laawol gives you a unique tracking number — for packages, barrels, or car transport.": "Dès que votre commande est confirmée, Laawol vous donne un numéro de suivi unique — pour les colis, les barils ou le transport de voiture.",
    "Follow every step": "Suivez chaque étape",
    "Status updates at each key step: picked up, in transit, arrived, ready for pickup, or delivered.": "Le statut se met à jour à chaque étape clé : pris en charge, en transit, arrivé, prêt pour retrait ou livré.",
    "Switch to carrier tracking if you need it": "Passez au suivi transporteur si besoin",
    "For sea containers, open carrier tracking in one click, right from your account.": "Pour les conteneurs par mer, ouvrez le suivi du transporteur en un clic, directement depuis votre compte.",
    "Laawol app Activity screen showing order tracking.": "Écran Activité de l’application Laawol présentant le suivi des commandes.",
    "Why it matters": "Pourquoi ça compte",
    "Clear tracking for every service": "Un suivi clair pour chaque service",
    "📦 Packages": "📦 Colis",
    "✈️ By air": "✈️ Par avion",
    "🚢 By sea": "🚢 Par mer",
    "🚗 Car transport": "🚗 Transport de voiture",
    "🅿️ Parking": "🅿️ Stationnement",
    "💳 Payments and refunds": "💳 Paiements et remboursements",
    "Never lose track of your order": "Ne perdez plus le fil de votre commande",
    "Enter your booking or tracking number to check the status without signing in. Sign in only for your receipts, payments, and complete history.": "Saisissez votre numéro de réservation ou de suivi pour voir le statut sans vous connecter. Connectez-vous seulement pour vos reçus, paiements et historique complet.",
    "Browse listings, photos, prices, and title information before preparing a viewing or purchase.": "Parcourez les annonces, photos, prix et informations de titre avant de préparer une visite ou un achat.",
    "Browse listings, photos, prices, and title information, then prepare a viewing, reservation, or purchase.": "Consultez les annonces, photos, prix et informations de titre, puis préparez une visite, une réservation ou un achat.",
    "Car transport": "Transport de véhicules",
    "Choose a city and dates, then prepare your vehicle to reserve a space.": "Choisissez une ville et des dates, puis préparez votre véhicule pour réserver une place.",
    "Choose a destination and prepare your vehicle details to request a quote.": "Choisissez une destination et préparez les informations de votre véhicule pour demander un devis.",
    "Compare destinations, businesses, and prices before preparing your request.": "Comparez les destinations, les entreprises et les prix avant de préparer votre demande.",
    "Compare approved businesses, destinations, and prices, then prepare your shipment online.": "Comparez les entreprises approuvées, les destinations et les prix, puis préparez votre expédition en ligne.",
    "Find parking": "Trouver un stationnement",
    "Open shares in a barrel or join a shared load heading to the same destination.": "Ouvrez des parts dans un baril ou rejoignez un chargement partagé vers la même destination.",
    "Parking": "Stationnement",
    "Post available shares or prepare a request to join a shared load.": "Publiez des parts disponibles ou préparez une demande pour rejoindre un chargement partagé.",
    "Prepare the vehicle and destination details to request a quote from an approved business.": "Préparez les détails du véhicule et de la destination pour demander un devis à une entreprise approuvée.",
    "Request car transport": "Demander un transport",
    "Search for a space with an approved business, compare dates, and prepare your reservation.": "Recherchez une place auprès d’une entreprise approuvée, comparez les dates et préparez votre réservation.",
    "Share a barrel": "Partager un baril",
    "Shared barrels": "Barils partagés",
    "Ship a barrel": "Expédier un baril",
    "Send a package": "Envoyer un colis",
    "Barrels, boxes, suitcases and parcels, by sea or air. Compare business prices and see your total right away.": "Barils, cartons, valises et colis, par mer ou par avion. Comparez les prix des entreprises et voyez votre total tout de suite.",
    "Privacy": "Confidentialité",
    "Terms of Service": "Conditions d’utilisation",
    "Privacy Policy": "Politique de confidentialité",
    "I accept the": "J’accepte les",
    "and the": "et la",
    "I understand that the selected business is the independent service provider responsible for fulfillment, timing, and performance.":
      "Je comprends que l’entreprise sélectionnée est le prestataire de service indépendant responsable de l’exécution, du délai et de la performance.",
    "A better way to find serious businesses": "Une meilleure façon de trouver des entreprises sérieuses",
    "A few ideas": "Quelques idées",
    "A global, two-way marketplace connecting the diaspora and home across many services": "Une marketplace mondiale à double sens qui relie la diaspora et le pays à travers de nombreux services",
    "A lawyer or professional": "Un avocat ou un professionnel",
    "A partner quotes and verifies": "Un partenaire vérifie et fait un devis",
    "About": "À propos",
    "About — Laawol Digital": "À propos — Laawol Digital",
    "Add your first destination": "Ajouter votre première destination",
    "African food & restaurants": "Cuisine africaine et restaurants",
    "All rights reserved.": "Tous droits réservés.",
    "Android — Google Play": "Android — Google Play",
    "Application submitted": "Demande envoyée",
    "Apply once, choose the services you offer, and prepare your operations. Customers see your business after platform approval.": "Postulez une fois, choisissez les services que vous proposez et préparez vos opérations. Les clients verront votre entreprise après approbation par la plateforme.",
    "Ask about yours →": "Demander pour votre pays →",
    "Ask for estimate": "Demander une estimation",
    "At least 6 characters.": "Au moins 6 caractères.",
    "Package shipping": "Expédition de colis",
    "Barrel shipping (full)": "Expédition de baril complet",
    "Barrels & shared loads": "Barils et chargements partagés",
    "Barrels · by sea · paid safely": "Barils · par mer · paiement sécurisé",
    "Built by the diaspora, for the diaspora": "Créé par la diaspora, pour la diaspora",
    "Business city": "Ville de l’entreprise",
    "Street address": "Adresse (rue)",
    "Default drop-off address for your customers.": "Adresse de dépôt par défaut pour vos clients.",
    "State or region": "Région ou état",
    "Postal code": "Code postal",
    "Business country": "Pays de l’entreprise",
    "Business email": "Email de l’entreprise",
    "Business name": "Nom de l’entreprise",
    "Business phone": "Téléphone de l’entreprise",
    "Business profile": "Profil de l’entreprise",
    "Businesses choose where they serve": "Les entreprises choisissent leurs zones de service",
    "Businesses register": "Les entreprises s’inscrivent",
    "Businesses register on Laawol to offer the services they are good at. You see their routes, pricing, service details, and status in one place, with platform support if something needs attention.": "Les entreprises s’inscrivent sur Laawol pour proposer les services qu’elles maîtrisent. Vous voyez leurs trajets, leurs prix, leurs détails de service et leurs statuts au même endroit, avec l’assistance de la plateforme si un point demande de l’attention.",
    "Built by the diaspora, for the diaspora. Laawol connects customers with registered businesses and keeps pricing, tracking, support, and accountability clear.": "Créé par la diaspora, pour la diaspora. Laawol relie les clients à des entreprises inscrites et clarifie les prix, le suivi, l’assistance et la responsabilité.",
    "Browse cars": "Voir les voitures",
    "Browse listings and vehicle services from registered businesses, then follow status, payments, and support in one place.": "Parcourez les annonces et services automobiles d’entreprises inscrites, puis suivez les statuts, paiements et l’assistance au même endroit.",
    "Browse vehicles and transport services from registered businesses, with listing status, photos, records, and support.": "Parcourez les véhicules et services de transport d’entreprises inscrites, avec statut des annonces, photos, dossiers et assistance.",
    "Carry trusted businesses in your pocket": "Gardez des entreprises de confiance dans votre poche",
    "Car parking": "Stationnement de voitures",
    "Car sales": "Vente de voitures",
    "Car transport": "Transport de voitures",
    "Cars": "Voitures",
    "Cars & transport": "Voitures et transport",
    "Cars, barrels, food, and professionals organized together.": "Voitures, barils, cuisine et professionnels réunis au même endroit.",
    "Choose a registered provider, compare the service details, or ask our team to help you find the right business.": "Choisissez un prestataire inscrit, comparez les détails du service ou demandez à notre équipe de vous orienter vers la bonne entreprise.",
    "Choose shipping businesses by destination, pricing, pickup options, and service details for barrels or partial loads.": "Choisissez des entreprises d’expédition selon la destination, le prix, les options de collecte et les détails de service pour les barils ou chargements partiels.",
    "Choose the provider": "Choisissez le prestataire",
    "City": "Ville",
    "Clear requests": "Des demandes claires",
    "Close menu": "Fermer le menu",
    "Clearer pricing": "Des prix plus clairs",
    "Company": "Entreprise",
    "Compare details": "Comparez les détails",
    "Compare services without chasing people around": "Comparez les services sans courir après les prestataires",
    "Confirm password": "Confirmer le mot de passe",
    "Contact — Laawol Digital": "Contact — Laawol Digital",
    "Conakry & beyond": "Conakry et au-delà",
    "Country": "Pays",
    "Create the login you'll use to manage your business.": "Créez l’identifiant que vous utiliserez pour gérer votre entreprise.",
    "Customers compare clearly": "Les clients comparent clairement",
    "Use Laawol online": "Utiliser Laawol en ligne",
    "Continue online": "Continuer en ligne",
    "Laawol access": "Accès Laawol",
    "Log in": "Se connecter",
    "Customers should know who is providing the service, what it costs, where it goes, and what happens next. Laawol helps businesses publish those details and keeps support records in one place.": "Les clients doivent savoir qui fournit le service, combien il coûte, où il va et quelle est la prochaine étape. Laawol aide les entreprises à publier ces informations et conserve les dossiers d’assistance au même endroit.",
    "Dakar & regions": "Dakar et régions",
    "Describe it or add a photo": "Décrivez-le ou ajoutez une photo",
    "Destinations": "Destinations",
    "Diaspora-first support": "Assistance pensée pour la diaspora",
    "Discover": "Découvrir",
    "Discover restaurants, food vendors, and home cooks who publish what they offer through a trusted marketplace.": "Découvrez des restaurants, vendeurs alimentaires et cuisiniers qui publient leurs offres via une marketplace de confiance.",
    "Discover restaurants, vendors, and professionals who register with the platform and keep their service details clear.": "Découvrez des restaurants, vendeurs et professionnels inscrits sur la plateforme qui gardent leurs informations de service claires.",
    "Email": "Email",
    "End-to-end tracking": "Suivi de bout en bout",
    "Enter a city": "Saisissez une ville",
    "Every order carries a code you can follow.": "Chaque commande possède un code que vous pouvez suivre.",
    "Explore": "Explorer",
    "Explore services": "Découvrir les services",
    "Featured business": "Entreprise mise en avant",
    "Featured businesses": "Entreprises mises en avant",
    "Find a pro": "Trouver un pro",
    "Find food": "Trouver à manger",
    "Find professionals who register their services, contact details, and availability so customers can request help clearly.": "Trouvez des professionnels qui indiquent leurs services, coordonnées et disponibilités pour que les clients demandent de l’aide clairement.",
    "Find registered businesses, compare services, make requests, pay securely, and track everything from the Laawol app.": "Trouvez des entreprises inscrites, comparez les services, faites des demandes, payez en sécurité et suivez tout depuis l’application Laawol.",
    "Find registered providers, compare service details, make a request, pay securely, and watch every step from your phone.": "Trouvez des prestataires inscrits, comparez les détails de service, faites une demande, payez en sécurité et suivez chaque étape depuis votre téléphone.",
    "Find shipping businesses by country, price, pickup options, delivery estimate, and destination requirements.": "Trouvez des entreprises d’expédition par pays, prix, options de collecte, délai estimé et exigences de destination.",
    "Find the right business for the road home.": "Trouvez la bonne entreprise pour la route vers le pays.",
    "Food": "Cuisine",
    "Food & professionals": "Cuisine et professionnels",
    "For businesses": "Pour les entreprises",
    "From a request to a tracked order": "De la demande à la commande suivie",
    "Full name": "Nom complet",
    "Get in touch": "Contactez-nous",
    "Get the app": "Télécharger l’application",
    "Get it on": "Disponible sur",
    "Get it on Google Play": "Disponible sur Google Play",
    "Gifts for loved ones": "Cadeaux pour les proches",
    "Good businesses should be easy to find": "Les bonnes entreprises doivent être faciles à trouver",
    "Hard-to-find items": "Articles difficiles à trouver",
    "Home": "Accueil",
    "Honest service starts with clear information": "Un service honnête commence par une information claire",
    "How it works": "Comment ça marche",
    "How Laawol works": "Comment Laawol fonctionne",
    "How trust works": "Comment la confiance fonctionne",
    "I need": "J’ai besoin de",
    "In review": "En cours d’examen",
    "In transit": "En transit",
    "Laawol — the road home.": "Laawol — la route vers le pays.",
    "Laawol Digital home": "Accueil Laawol Digital",
    "Laawol Digital — Trusted Services from Registered Businesses": "Laawol Digital — Services de confiance proposés par des entreprises inscrites",
    "Laawol connects customers with registered businesses on both sides of the route — so services are easier to compare, track, and support.": "Laawol relie les clients à des entreprises inscrites des deux côtés du trajet, afin que les services soient plus faciles à comparer, suivre et accompagner.",
    "Laawol app Shipping screen showing packages, barrels, and car transport.": "Écran Expédition de l’application Laawol présentant les colis, les barils et le transport de voitures.",
    "Lawyers & professionals": "Avocats et professionnels",
    "Learn more": "En savoir plus",
    "Let’s bring home closer": "Rapprochons le pays",
    "List your business": "Inscrire votre entreprise",
    "Ship packages, barrels and cars between the US and": "Expédiez des colis, des barils et des voitures entre les États-Unis et",
    "West Africa": "l’Afrique de l’Ouest",
    "Laawol is a marketplace of registered, verified businesses: compare prices for your packages and barrels, buy verified cars, request transport quotes, and track every order — with platform support at every step.": "Laawol est une marketplace d’entreprises inscrites et vérifiées : comparez les prix pour vos colis et vos barils, achetez des voitures vérifiées, demandez des devis de transport et suivez chaque commande — avec l’assistance de la plateforme à chaque étape.",
    "A trusted platform for the African diaspora: registered businesses offer package and barrel shipping, car sales, transport, and parking — with clear prices and real tracking.": "Une plateforme de confiance pour la diaspora africaine : des entreprises inscrites proposent l’expédition de colis et de barils, la vente, le transport et le stationnement de voitures — avec des prix clairs et un vrai suivi.",
    "“Laawol” means “the road” in Pular. Laawol — the road home.": "« Laawol » signifie « le chemin » en pular. Laawol — la route vers le pays.",
    "Package and barrel shipping, cars, transport, and parking from registered businesses.": "Expédition de colis et de barils, voitures, transport et stationnement proposés par des entreprises inscrites.",
    "Ship a package or a barrel, buy or move a car, or book parking with registered providers.": "Expédiez un colis ou un baril, achetez ou transportez une voiture, ou réservez un stationnement auprès des prestataires inscrits.",
    "Laawol exists to shorten the distance between you and home. From barrels to vehicles, the platform makes providers easier to find, compare, and hold accountable.": "Laawol existe pour réduire la distance entre vous et le pays. Du baril au véhicule, la plateforme rend les prestataires plus faciles à trouver, comparer et responsabiliser.",
    "Cars, packages, barrels, and parking organized together.": "Voitures, colis, barils et stationnement réunis au même endroit.",
    "Do you run a business?": "Vous avez une entreprise ?",
    "Join the registered businesses serving the diaspora: package and barrel shipping, cars, transport, and parking. Apply once, choose your services, and be visible after approval.": "Rejoignez les entreprises inscrites qui servent la diaspora : expédition de colis et de barils, voitures, transport et stationnement. Postulez une fois, choisissez vos services et soyez visible après approbation.",
    "List your business on Laawol": "Inscrivez votre entreprise sur Laawol",
    "Example route": "Exemple de trajet",
    "Logo or storefront image (optional)": "Logo ou photo de vitrine (facultatif)",
    "Marketplace of trusted services": "Marketplace de services de confiance",
    "Marketplace standard": "Standard de la marketplace",
    "Message": "Message",
    "More countries are added as approved businesses publish their routes.": "D’autres pays sont ajoutés lorsque les entreprises approuvées publient leurs trajets.",
    "New request": "Nouvelle demande",
    "One app, many providers": "Une application, plusieurs prestataires",
    "One platform for it all": "Une seule plateforme pour tout",
    "One platform, many trusted businesses": "Une plateforme, plusieurs entreprises de confiance",
    "Open menu": "Ouvrir le menu",
    "Open the admin console": "Ouvrir la console admin",
    "Optional": "Facultatif",
    "Our story": "Notre histoire",
    "Partner routes": "Trajets des partenaires",
    "Password": "Mot de passe",
    "Phone": "Téléphone",
    "Phone number": "Numéro de téléphone",
    "Phone support": "Assistance téléphonique",
    "Pick a service": "Choisissez un service",
    "Pick everything your business can provide. You can adjust these later.": "Sélectionnez tout ce que votre entreprise peut fournir. Vous pourrez modifier cela plus tard.",
    "Platform support can help customers and businesses resolve questions.": "L’assistance de la plateforme aide les clients et les entreprises à résoudre les questions.",
    "Platform support": "Assistance de la plateforme",
    "Pros": "Professionnels",
    "Primary": "Navigation principale",
    "Ready when you are": "Prêt quand vous l’êtes",
    "Reach us": "Nous joindre",
    "Registered businesses": "Entreprises inscrites",
    "Request space": "Demander une place",
    "Routes, pricing, experience, anything useful for approval (optional)": "Trajets, prix, expérience, tout élément utile à l’approbation (facultatif)",
    "Secure payments": "Paiements sécurisés",
    "See shipping": "Voir l’expédition",
    "Select a city": "Sélectionnez une ville",
    "Select a country": "Sélectionnez un pays",
    "Send request": "Envoyer la demande",
    "Sending…": "Envoi…",
    "Send request →": "Envoyer la demande →",
    "Send message": "Envoyer le message",
    "Share a barrel": "Partager un baril",
    "Shared barrels": "Barils partagés",
    "Services from partners you can compare": "Des services de partenaires que vous pouvez comparer",
    "Services you offer": "Services proposés",
    "Serving the USA ↔ West Africa corridor": "Service sur le corridor États-Unis ↔ Afrique de l’Ouest",
    "Shared / partial load": "Chargement partagé / partiel",
    "Shared & partial loads": "Chargements partagés et partiels",
    "Ship a barrel": "Expédier un baril",
    "Barrels, boxes, suitcases and parcels, by sea or air.": "Barils, cartons, valises et colis, par mer ou par avion.",
    "Shipping": "Expédition",
    "Simple by design": "Simple par conception",
    "Track a shipment": "Suivi de commande",
    "Order tracking": "Suivi de commande",
    "Standard marketplace": "Standard de la marketplace",
    "Submit application": "Envoyer la demande",
    "Support": "Assistance",
    "Download on the": "Télécharger sur",
    "Download on the App Store": "Télécharger sur App Store",
    "Talk to our team": "Parler à notre équipe",
    "Tell us about your service": "Parlez-nous de votre service",
    "Tell us what you need": "Dites-nous ce dont vous avez besoin",
    "Tell us what you need from home": "Dites-nous ce dont vous avez besoin du pays",
    "The Laawol App — Trusted Businesses in Your Pocket": "L’application Laawol — Des entreprises de confiance dans votre poche",
    "The Laawol app": "L’application Laawol",
    "Get the Laawol app — Laawol Digital": "Télécharger l’application Laawol — Laawol Digital",
    "Follow every shipment in the Laawol app": "Suivez chaque expédition dans l’application Laawol",
    "Get a notification at each step, keep all your orders in one place, and pay securely with registered businesses.": "Recevez une notification à chaque étape, retrouvez toutes vos commandes au même endroit et payez en sécurité auprès d’entreprises inscrites.",
    "Opening your app store…": "Ouverture de votre boutique d’applications…",
    "Choose your store below.": "Choisissez votre boutique ci-dessous.",
    "The app": "Application",
    "The platform supports both sides": "La plateforme accompagne les deux côtés",
    "Track to your door": "Suivez jusqu’à votre porte",
    "Tracking & secure pay": "Suivi et paiement sécurisé",
    "Trusted partners": "Partenaires de confiance",
    "Trusted service marketplace": "Marketplace de services de confiance",
    "Use partner shipping routes when you do not need a full barrel or container, with the cost and terms shown upfront.": "Utilisez les trajets des partenaires quand vous n’avez pas besoin d’un baril ou conteneur complet, avec le coût et les conditions affichés à l’avance.",
    "Open unused shares in a barrel or join a shared barrel managed by an approved business.": "Ouvrez des parts disponibles dans un baril ou rejoignez un baril partagé géré par une entreprise approuvée.",
    "Find a share": "Trouver une part",
    "Manage partial barrels, drop-offs, and customer consolidation.": "Gérer des barils partiels, des dépôts et des regroupements de clients.",
    "Verified & tracked": "Vérifié et suivi",
    "Website": "Site web",
    "WhatsApp support": "Assistance WhatsApp",
    "What would you like from home?": "Que souhaitez-vous recevoir du pays ?",
    "Why Laawol Digital": "Pourquoi Laawol Digital",
    "Your name": "Votre nom",
    "iOS — App Store": "iOS — App Store",
    "Admin console": "Console admin",
    "A curated group of approved partners with marketing-safe profiles.": "Une sélection de partenaires approuvés avec des profils publics validés.",
    "Authentic Guinea fabric (lepi), 6 yards, deep indigo — like the photo 👇": "Tissu guinéen authentique (lépi), 6 yards, indigo foncé — comme sur la photo 👇",
    "Banjul & regions": "Banjul et régions",
    "Abidjan → Brussels": "Abidjan → Bruxelles",
    "Boarding flight · arrives in 4 days · tracked": "Embarquement · arrivée dans 4 jours · suivi actif",
    "Brussels → Banjul": "Bruxelles → Banjul",
    "Car · by sea · escrow protected": "Voiture · par mer · paiement protégé",
    "Businesses": "Entreprises",
    "Clear": "Prix et trajets",
    "Consultation confirmed for Friday": "Consultation confirmée pour vendredi",
    "Deliver to": "Livrer à",
    "Delivered": "Livré",
    "Each shipping business controls its own countries, prices, delivery estimates, and destination details. Customers see those terms before booking.": "Chaque entreprise d’expédition gère ses pays, prix, délais estimés et détails de destination. Les clients voient ces conditions avant de réserver.",
    "Find a registered provider, compare service details, make a request, pay securely, and track every step from your phone.": "Trouvez un prestataire inscrit, comparez les détails du service, faites une demande, payez en sécurité et suivez chaque étape depuis votre téléphone.",
    "Find the right business for the road": "Trouvez la bonne entreprise pour la route vers le",
    "Follow every milestone until it safely reaches you.": "Suivez chaque étape jusqu’à l’arrivée en sécurité.",
    "Follow orders with clear receipts and platform support.": "Suivez les commandes avec des reçus clairs et l’assistance de la plateforme.",
    "Laawol app Activity screen showing shipment tracking, orders, and wallet.": "Écran Activité de l’application Laawol présentant le suivi des expéditions, les commandes et le portefeuille.",
    "Laawol Digital. All rights reserved.": "Laawol Digital. Tous droits réservés.",
    "Laawol exists to shrink the distance between you and home. From a barrel to a vehicle to a professional service, the platform makes providers easier to find, compare, and hold accountable.": "Laawol existe pour réduire la distance entre vous et le pays. Du baril au véhicule en passant par les services professionnels, la plateforme rend les prestataires plus faciles à trouver, comparer et responsabiliser.",
    "Laawol is built to help serious businesses stand out and help customers avoid guessing.": "Laawol aide les entreprises sérieuses à se démarquer et évite aux clients de deviner.",
    "Laawol is the platform layer. Businesses provide the services; we organize their pricing, destinations, listings, tracking, payments, and support so customers can choose with confidence.": "Laawol est la couche de plateforme. Les entreprises fournissent les services; nous organisons leurs prix, destinations, annonces, suivis, paiements et assistance afin que les clients choisissent en confiance.",
    "Laawol keeps it accountable": "Laawol garde le suivi et la responsabilité",
    "Laawol tracks orders, payments, refunds, messages, and history so good businesses build trust and customers can get help.": "Laawol suit les commandes, paiements, remboursements, messages et historiques pour aider les bonnes entreprises à inspirer confiance et les clients à obtenir de l’aide.",
    "List your business — Laawol Digital": "Inscrire votre entreprise — Laawol Digital",
    "In the air · arrives in 3 days · tracked": "En vol · arrivée dans 3 jours · suivi actif",
    "Licensed professional · supported": "Professionnel agréé · accompagné",
    "Loaded at port · arrives in 26 days · tracked": "Chargé au port · arrivée dans 26 jours · suivi actif",
    "London → Accra": "Londres → Accra",
    "Monrovia & regions": "Monrovia et régions",
    "On the vessel · arrives in 22 days · tracked": "Sur le navire · arrivée dans 22 jours · suivi actif",
    "Packages · by air · platform-backed": "Colis · par avion · couvert par la plateforme",
    "Partners apply, choose the services they offer, set destinations or listings, and keep their team under one business profile.": "Les partenaires postulent, choisissent les services proposés, configurent leurs destinations ou annonces et gèrent leur équipe dans un seul profil d’entreprise.",
    "Partners create profiles, choose services, and publish what they can actually provide.": "Les partenaires créent leurs profils, choisissent leurs services et publient ce qu’ils peuvent réellement fournir.",
    "Parcel · by air · protected": "Colis · par avion · protégé",
    "Payment · platform-protected": "Paiement · protégé par la plateforme",
    "Payments": "Paiements",
    "Pay online with confidence and clear receipts.": "Payez en ligne en confiance avec des reçus clairs.",
    "People source all kinds of things": "Les gens commandent toutes sortes de choses",
    "Powered by approved partners": "Propulsé par des partenaires approuvés",
    "Pricing, routes, photos, service details, status, and contact information are organized before a customer pays or requests help.": "Les prix, trajets, photos, détails de service, statuts et coordonnées sont organisés avant qu’un client paie ou demande de l’aide.",
    "Publish cars so customers can browse and buy them.": "Publier des voitures pour que les clients puissent les consulter et les acheter.",
    "Registered": "Entreprises",
    "Registered businesses, organized in one place": "Des entreprises inscrites, organisées au même endroit",
    "Review business service details, destination options, quotes, and next steps.": "Consultez les détails du service, les options de destination, les devis et les prochaines étapes.",
    "Released to the business · receipt sent": "Libéré à l’entreprise · reçu envoyé",
    "See service terms, fees, routes, and destination details before you commit.": "Consultez les conditions, frais, trajets et détails de destination avant de vous engager.",
    "Share a few details and our team can help route your request to the right registered business — or download the app to start instantly.": "Partagez quelques détails et notre équipe peut orienter votre demande vers la bonne entreprise inscrite, ou téléchargez l’application pour commencer tout de suite.",
    "Show exactly what you need and keep the quote, messages, and status together.": "Montrez exactement ce dont vous avez besoin et gardez le devis, les messages et le statut ensemble.",
    "Something else": "Autre chose",
    "Transport a car, ship, order food, or find a professional from registered providers.": "Transportez une voiture, expédiez, commandez à manger ou trouvez un professionnel parmi les prestataires inscrits.",
    "Thanks! Your business application is now pending platform approval. You can sign in to the admin console to set up destinations, listings, and staff right away — customers will see you once you're approved.": "Merci ! Votre demande d’entreprise attend maintenant l’approbation de la plateforme. Vous pouvez vous connecter à la console admin pour configurer destinations, annonces et personnel tout de suite; les clients vous verront après approbation.",
    "Tell us exactly what you want — a fabric, a spice, a craft, a document. A picture makes it precise.": "Dites exactement ce que vous voulez : tissu, épice, artisanat, document. Une photo rend la demande précise.",
    "The business provides the service while Laawol keeps payment, tracking, and support organized.": "L’entreprise fournit le service pendant que Laawol organise le paiement, le suivi et l’assistance.",
    "This is what the platform reviews. Customers only see approved businesses.": "Voici ce que la plateforme examine. Les clients ne voient que les entreprises approuvées.",
    "Track vehicle transport requests.": "Suivre les demandes de transport de véhicules.",
    "Inventory": "Inventaire",
    "Track stock and sell at the counter. You can register with Inventory alone. Switched on by our team after approval.": "Suivez votre stock et vendez au comptoir. Vous pouvez vous inscrire avec l’Inventaire seul. Activé par notre équipe après approbation.",
    "Use Laawol to find registered providers, compare service details, and stay connected.": "Utilisez Laawol pour trouver des prestataires inscrits, comparer les détails de service et rester connecté.",
    "By submitting, you create a Laawol business account and agree to platform review. You can set up your dashboard immediately; customers see you after approval.": "En envoyant, vous créez un compte entreprise Laawol et acceptez l’examen par la plateforme. Vous pouvez configurer votre tableau de bord immédiatement; les clients vous verront après approbation.",
    "We are very Happy with Laawol Digital": "Nous sommes très satisfaits de Laawol Digital",
    "We’ll reply by email and may connect your request with a registered provider. By sending, you agree to be contacted about your request.": "Nous répondrons par email et pourrons relier votre demande à un prestataire inscrit. En envoyant ce formulaire, vous acceptez d’être contacté au sujet de votre demande.",
    "You approve the quote, pay securely, follow updates, and contact platform support if the order needs attention.": "Vous approuvez le devis, payez en sécurité, suivez les mises à jour et contactez l’assistance si la commande demande de l’attention.",
    "Your business": "Votre entreprise",
    "businesses": "inscrites",
    "home": "pays",
    "pricing and routes": "clairs",
    "~21–28 days": "~21–28 jours",
    "~24–31 days": "~24–31 jours",
    "👤 Owner account": "👤 Compte propriétaire",
    "🧩 Services you offer": "🧩 Services proposés",
    "🏪 Business profile": "🏪 Profil de l’entreprise",
    "🧵 Traditional fabrics": "🧵 Tissus traditionnels",
    "🌶️ Spices & foodstuffs": "🌶️ Épices et produits alimentaires",
    "👗 Tailored clothing": "👗 Vêtements sur mesure",
    "🪘 Crafts & art": "🪘 Artisanat et art",
    "📄 Documents & errands": "📄 Documents et courses",
    "💊 Hard-to-find items": "💊 Articles difficiles à trouver",
    "🎁 Gifts for loved ones": "🎁 Cadeaux pour les proches",
    "barrel Shipping": "Expédition de colis",
    "barrelShipping": "Expédition de colis",
    "car Parking": "Stationnement de voitures",
    "car Sales": "Vente de voitures",
    "car Transport": "Transport de voitures",
    "https:// (optional)": "https:// (facultatif)",
    "Manage parked cars and parking receipts.": "Gérer les voitures stationnées et les reçus de stationnement.",
    "carParking": "Stationnement de voitures",
    "carSales": "Vente de voitures",
    "carTransport": "Transport de voitures",
    "United States": "États-Unis",
    "Guinea": "Guinée",
    "Gambia": "Gambie",
    "Liberia": "Libéria",
    "Senegal": "Sénégal",
    "Nigeria": "Nigéria",
    "Guinea-Bissau": "Guinée-Bissau",
    "Mauritania": "Mauritanie",
    "Cameroon": "Cameroun",
    "Cote d'Ivoire": "Côte d’Ivoire",
    "Ship packages, barrels and cars between the US and West Africa.": "Expédiez des colis, des barils et des voitures entre les États-Unis et l’Afrique de l’Ouest.",
    // Homepage (2026-11 redesign)
    // Homepage photos (2026-11-13)
    "See the routes": "Voir les trajets",
    "By sea · ~21–28 days": "Par mer · ~21–28 jours",
    "By sea · ~24–31 days": "Par mer · ~24–31 jours",
    "Laawol for businesses": "Laawol pour les entreprises",
    "Shipping, car and parking businesses run their whole operation on Laawol, in the browser and on their phone.": "Les entreprises d’expédition, de voitures et de stationnement gèrent tout leur travail sur Laawol, dans le navigateur et sur téléphone.",
    "Containers and QR labels": "Conteneurs et étiquettes QR",
    "Every package gets a label. Scan to load, ship and deliver.": "Chaque colis reçoit une étiquette. Scannez pour charger, expédier et livrer.",
    "Receipts and reminders on WhatsApp": "Reçus et rappels sur WhatsApp",
    "Your customers get a receipt and every step of their shipment, without a phone call.": "Vos clients reçoivent un reçu et chaque étape de leur envoi, sans appel.",
    "Several lots, monthly invoices and payments tracked car by car.": "Plusieurs parcs, factures mensuelles et paiements suivis voiture par voiture.",
    "Sales and stock": "Ventes et stock",
    "Sell in store by scanning items, with invoices and credit payments.": "Vendez en boutique en scannant les articles, avec factures et paiements à crédit.",
    "Verified payments": "Paiements vérifiés",
    "Card online, and Zelle confirmed straight from the business’s bank account.": "Carte en ligne, et Zelle confirmé directement sur le compte bancaire de l’entreprise.",
    "Your team": "Votre équipe",
    "Access per person, and the cash each employee holds, month by month.": "Accès par personne, et l’argent tenu par chaque employé, mois par mois.",
    "Frequently asked questions": "Questions fréquentes",
    "How do I track my shipment?": "Comment suivre mon envoi ?",
    "Enter your tracking number on the Order tracking page, no sign-in needed, or open the app. Every step also arrives on WhatsApp.": "Saisissez votre numéro de suivi sur la page Suivi de commande, sans vous connecter, ou ouvrez l’application. Chaque étape arrive aussi sur WhatsApp.",
    "How do I pay?": "Comment payer ?",
    "Depending on the business: by card online, by Zelle or in cash. You get a receipt for every payment.": "Selon l’entreprise : par carte en ligne, par Zelle ou en espèces. Vous recevez un reçu pour chaque paiement.",
    "How long does a shipment take?": "Combien de temps dure un envoi ?",
    "By sea, allow about 3 to 4 weeks to Guinea. Each business shows its timing before you book.": "Par mer, comptez environ 3 à 4 semaines vers la Guinée. Chaque entreprise affiche ses délais avant que vous réserviez.",
    "Can I ship by air?": "Puis-je envoyer par avion ?",
    "Yes. Some businesses offer air shipping, priced by weight. Their prices show when you choose your shipment.": "Oui. Certaines entreprises proposent l’envoi par avion, au poids. Leurs prix s’affichent quand vous choisissez votre envoi.",
    "Are the businesses verified?": "Les entreprises sont-elles vérifiées ?",
    "Yes. Laawol reviews every business before customers can see it.": "Oui. Laawol examine chaque entreprise avant qu’elle apparaisse aux clients.",
    "I run a business. How do I sign up?": "Je suis une entreprise. Comment m’inscrire ?",
    "Fill in the sign-up request. Once approved, your services and prices appear to customers.": "Remplissez la demande d’inscription. Après approbation, vos services et vos prix apparaissent aux clients.",
    "Ready to send?": "Prêt à envoyer ?",
    "Compare businesses and book in a few minutes.": "Comparez les entreprises et réservez en quelques minutes.",
    "Ship to West Africa with verified businesses": "Expédiez vers l’Afrique de l’Ouest avec des entreprises vérifiées",
    "Packages, barrels, cars and parking. Compare prices, book online and follow every step on WhatsApp.": "Colis, barils, voitures et stationnement. Comparez les prix, réservez en ligne et suivez chaque étape sur WhatsApp.",
    "Already booked?": "Déjà réservé ?",
    "Loaded in New York": "Chargé à New York",
    "Delivered in Conakry": "Livré à Conakry",
    "Do you run a shipping business?": "Vous êtes une entreprise d’expédition ?",
    "List your business so customers comparing prices on your routes can find you.": "Inscrivez votre entreprise pour être vue par les clients qui comparent les prix sur vos trajets.",
    "From the US to West Africa, your shipments": "Des États-Unis à l’Afrique de l’Ouest, vos envois",
    "in good hands.": "entre de bonnes mains.",
    "Compare verified shipping, car and parking businesses. Book online, then follow every step on WhatsApp.": "Comparez des entreprises vérifiées d’expédition, de voitures et de stationnement. Réservez en ligne, puis suivez chaque étape sur WhatsApp.",
    "Track an order": "Suivre une commande",
    "By sea or air, at the business’s own price.": "Par mer ou par avion, au prix de l’entreprise.",
    "Cars from verified businesses, with photos and prices.": "Des véhicules d’entreprises vérifiées, photos et prix à l’appui.",
    "Your car shipped by container, from quote to arrival.": "Votre voiture expédiée en conteneur, du devis à l’arrivée.",
    "A safe spot for your car, by the day or the month.": "Une place sûre pour votre voiture, à la journée ou au mois.",
    "Delivery in Conakry": "Livraison à Conakry",
    "What you send arrives.": "Ce que vous envoyez arrive.",
    "And you know it.": "Et vous le savez.",
    "Every barrel, every box, every car is tracked to the door.": "Chaque baril, chaque carton, chaque voiture est suivi jusqu’à la porte.",
    "Simple from start to finish": "Simple, du début à la fin",
    "Compare": "Comparez",
    "Book": "Réservez",
    "Track": "Suivez",
    "See prices, timing and reviews of registered businesses, side by side.": "Voyez les prix, les délais et les avis des entreprises inscrites, côte à côte.",
    "Pick a business and book online. You get a receipt for every payment.": "Choisissez une entreprise et réservez en ligne. Vous recevez un reçu pour chaque paiement.",
    "Laawol sends you every step on WhatsApp, from pickup to delivery.": "Laawol vous envoie chaque étape sur WhatsApp, de la prise en charge à la livraison.",
    "Ship barrels, boxes and cars to West Africa.": "Expédiez barils, colis et voitures vers l’Afrique de l’Ouest.",
    "Follow every step on WhatsApp.": "Suivez chaque étape sur WhatsApp.",
    "A worker loads a blue barrel into a shipping container in New York.": "Un employé charge un baril bleu dans un conteneur à New York.",
    "Labeled barrels and boxes, ready to go.": "Des barils et des cartons étiquetés, prêts à partir.",
    "Used cars for sale on a lot in New York.": "Des voitures d’occasion à vendre sur un parc à New York.",
    "An SUV drives into a container at the port.": "Un SUV monte dans un conteneur au port.",
    "A lot attendant checks parked cars in the evening.": "Un agent vérifie les voitures d’un parking le soir.",
    "A driver hands a blue barrel to a customer outside her home in Conakry.": "Un livreur remet un baril bleu à une cliente devant sa maison à Conakry.",
    "Compare.": "Comparez.",
    "Send.": "Envoyez.",
    "Track.": "Suivez.",
    "The marketplace of verified shipping, car and parking businesses. Compare prices side by side, choose one, and Laawol keeps you updated all the way to the door.": "La marketplace des entreprises vérifiées d’expédition, de voitures et de stationnement. Comparez les prix côte à côte, choisissez la vôtre, et Laawol vous tient informé jusqu’à la porte.",
    "What do you need?": "Que voulez-vous faire ?",
    "Send a package or barrel": "Envoyer un colis ou un baril",
    "Buy a car": "Acheter une voiture",
    "Ship a car": "Expédier une voiture",
    "Book parking": "Réserver un stationnement",
    "Get started": "Commencer",
    "Verified businesses": "Entreprises vérifiées",
    "Approved before they appear": "Approuvées avant d’être visibles",
    "Secure payment": "Paiement sécurisé",
    "A receipt for every order": "Un reçu pour chaque commande",
    "Updates on WhatsApp": "Mises à jour sur WhatsApp",
    "At every step": "À chaque étape",
    "Tracked by Laawol": "Suivi par Laawol",
    "In transit · by sea": "En transit · par mer",
    "Our services": "Nos services",
    "Everything you send, in one place": "Tout ce que vous envoyez, au même endroit",
    "From one box to a whole car, each service is offered by businesses you can compare.": "De la simple boîte à la voiture entière, chaque service est proposé par des entreprises que vous pouvez comparer.",
    "Explore all services": "Découvrir tous les services",
    "Packages & barrels": "Colis et barils",
    "Cars for sale": "Voitures à vendre",
    "After you book": "Après votre réservation",
    "The business ships it. Laawol keeps you informed.": "L’entreprise expédie. Laawol vous tient informé.",
    "No more chasing the shipper for news. Laawol tracks the order and sends you an update at every stage, in the app and on WhatsApp, from pickup to arrival.": "Plus besoin de relancer l’expéditeur pour avoir des nouvelles. Laawol suit la commande et vous envoie une mise à jour à chaque étape, dans l’application et sur WhatsApp, de la prise en charge à l’arrivée.",
    "Picked up": "Pris en charge",
    "Atlantic crossing": "Traversée de l’Atlantique",
    "Arriving": "Arrivée",
    "Automatic": "Automatique",
    "Your barrel was picked up in New York.": "Votre baril a été pris en charge à New York.",
    "Loaded on the ship. Expected in Conakry in about 4 weeks.": "Chargé sur le navire. Arrivée prévue à Conakry dans environ 4 semaines.",
    "Arrived in Conakry and ready for pickup.": "Arrivé à Conakry et prêt pour le retrait.",
    "Every status change reaches you": "Chaque changement de statut vous parvient",
    "Picked up, loaded, in transit, arrived, delivered.": "Pris en charge, chargé, en transit, arrivé, livré.",
    "On WhatsApp and in the app": "Sur WhatsApp et dans l’application",
    "Updates arrive where you already are.": "Les mises à jour arrivent là où vous êtes déjà.",
    "One record for everyone": "Un seul dossier pour tous",
    "You and the business see the same status.": "Vous et l’entreprise voyez le même statut.",
    "The Laawol app": "L’application Laawol",
    "Manage your shipments on the go": "Gérez vos envois où que vous soyez",
    "Compare, book and track from your phone, in French or English.": "Comparez, réservez et suivez depuis votre téléphone, en français ou en anglais.",
    "Every step tracked": "Chaque étape suivie",
    "Pay and message in one place": "Payer et échanger au même endroit",
    "Ready to get started?": "Prêt à commencer ?",
    "Send a package today, or list your business and be seen by customers comparing prices on your routes.": "Envoyez un colis aujourd’hui, ou inscrivez votre entreprise pour être vue par les clients qui comparent les prix sur vos trajets.",
    "Customer area": "Espace client"
  };

  var frToEn = {};
  Object.keys(enToFr).forEach(function (key) {
    frToEn[enToFr[key]] = key;
  });
  frToEn["Expédition de colis"] = "Package shipping";
  frToEn["Vente de voitures"] = "Car sales";
  frToEn["Stationnement de voitures"] = "Car parking";
  frToEn["Transport de voitures"] = "Car transport";
  frToEn["Transport de véhicules"] = "Car transport";
  frToEn["Barils partagés"] = "Shared barrels";

  function getLang() {
    try {
      return localStorage.getItem(storageKey) === "en" ? "en" : "fr";
    } catch (_) {
      return defaultLang;
    }
  }

  function setLang(lang) {
    var targetLang = lang === "en" ? "en" : "fr";
    try {
      localStorage.setItem(storageKey, targetLang);
    } catch (_) {}
    var page = location.pathname.split("/").pop();
    var legalTarget = {
      "privacy.html": targetLang === "en" ? "privacy-en.html" : "privacy.html",
      "privacy-en.html": targetLang === "fr" ? "privacy.html" : "privacy-en.html",
      "terms.html": targetLang === "en" ? "terms-en.html" : "terms.html",
      "terms-en.html": targetLang === "fr" ? "terms.html" : "terms-en.html",
    }[page];
    if (legalTarget && legalTarget !== page) {
      location.href = legalTarget;
      return;
    }
    location.reload();
  }

  function translate(value, lang) {
    var text = String(value || "");
    if (!text) return text;
    return lang === "en" ? (frToEn[text] || text) : (enToFr[text] || text);
  }

  function translateNode(node, lang) {
    var value = node.textContent;
    if (!value) return;
    var trimmed = value.trim();
    var translated = translate(trimmed, lang);
    if (translated !== trimmed) node.textContent = value.replace(trimmed, translated);
  }

  function translateAttrs(node, lang) {
    ["aria-label", "alt", "placeholder", "title", "content"].forEach(function (attr) {
      var value = node.getAttribute && node.getAttribute(attr);
      if (!value) return;
      var translated = translate(value, lang);
      if (translated !== value) node.setAttribute(attr, translated);
    });
  }

  function localizeImages(lang) {
    document.querySelectorAll("img[data-src-en][data-src-fr]").forEach(function (image) {
      var source = lang === "en" ? image.dataset.srcEn : image.dataset.srcFr;
      if (source && image.getAttribute("src") !== source) image.setAttribute("src", source);
    });
  }

  function translateTree(root) {
    var lang = getLang();
    document.documentElement.lang = lang;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var node = walker.nextNode();
    while (node) {
      translateNode(node, lang);
      node = walker.nextNode();
    }
    if (root instanceof Element) translateAttrs(root, lang);
    root.querySelectorAll && root.querySelectorAll("*").forEach(function (item) {
      translateAttrs(item, lang);
    });
    document.title = translate(document.title, lang);
  }

  function addToggle() {
    if (document.querySelector("[data-lang-toggle]")) return;
    var lang = getLang();
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-ghost lang-toggle";
    button.dataset.langToggle = "true";
    button.textContent = lang === "en" ? "Français" : "English";
    button.setAttribute("aria-label", lang === "en" ? "Passer au français" : "Switch to English");
    button.addEventListener("click", function () {
      setLang(getLang() === "en" ? "fr" : "en");
    });
    document.querySelectorAll(".nav-cta").forEach(function (nav) {
      nav.appendChild(button.cloneNode(true));
      nav.lastChild.addEventListener("click", function () {
        setLang(getLang() === "en" ? "fr" : "en");
      });
    });
    var mobile = document.getElementById("mobileMenu");
    if (mobile) {
      var mobileButton = button.cloneNode(true);
      mobileButton.className = "btn btn-primary lang-toggle";
      mobileButton.addEventListener("click", function () {
        setLang(getLang() === "en" ? "fr" : "en");
      });
      mobile.appendChild(mobileButton);
    }
  }

  window.LaawolI18n = {
    getLang: getLang,
    setLang: setLang,
    localize: function (value) {
      return translate(value, getLang());
    },
    refresh: function () {
      translateTree(document.body);
    },
  };

  document.addEventListener("DOMContentLoaded", function () {
    localizeImages(getLang());
    addToggle();
    translateTree(document.body);
    var observer = new MutationObserver(function (mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.TEXT_NODE) translateNode(node, getLang());
          if (node instanceof Element) translateTree(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
