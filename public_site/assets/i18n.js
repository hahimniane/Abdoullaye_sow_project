(function () {
  var storageKey = "laawol:lang";
  var defaultLang = "fr";
  var enToFr = {
    "Air or sea freight": "Fret aérien ou maritime",
    "Track a shipment — Laawol Digital": "Suivi de commande — Laawol Digital",
    "Clear tracking, every step": "Un suivi clair, à chaque étape",
    "Track your order from departure to arrival": "Suivez votre commande du départ à l’arrivée",
    "As soon as your barrel, freight, or car is on the way, Laawol gives you a tracking number and status updates, right alongside your order.": "Dès que votre baril, votre fret ou votre voiture est en route, Laawol vous donne un numéro de suivi et les mises à jour de statut, au même endroit que votre commande.",
    "Track my order": "Suivre ma commande",
    "From shipment to tracked delivery": "De l’expédition à la livraison suivie",
    "Get your tracking number": "Recevez votre numéro de suivi",
    "As soon as your order is confirmed, Laawol gives you a unique tracking number — for barrels, freight, or car transport.": "Dès que votre commande est confirmée, Laawol vous donne un numéro de suivi unique — pour les barils, le fret ou le transport de voiture.",
    "Follow every step": "Suivez chaque étape",
    "Status updates at each key step: picked up, in transit, arrived, ready for pickup, or delivered.": "Le statut se met à jour à chaque étape clé : pris en charge, en transit, arrivé, prêt pour retrait ou livré.",
    "Switch to carrier tracking if you need it": "Passez au suivi transporteur si besoin",
    "For ocean freight, open carrier tracking in one click, right from your account.": "Pour le fret maritime, ouvrez le suivi du transporteur en un clic, directement depuis votre compte.",
    "Laawol app Activity screen showing order tracking.": "Écran Activité de l’application Laawol présentant le suivi des commandes.",
    "Why it matters": "Pourquoi ça compte",
    "Clear tracking for every service": "Un suivi clair pour chaque service",
    "📦 Barrels": "📦 Barils",
    "✈️ Air freight": "✈️ Fret aérien",
    "🚢 Ocean freight": "🚢 Fret maritime",
    "🚗 Car transport": "🚗 Transport de voiture",
    "🅿️ Parking": "🅿️ Stationnement",
    "💳 Payments and refunds": "💳 Paiements et remboursements",
    "Never lose track of your order": "Ne perdez plus le fil de votre commande",
    "Sign in to see the status, tracking number, and history of every service you've requested.": "Connectez-vous pour voir le statut, le numéro de suivi et l’historique de chaque service que vous avez demandé.",
    "Barrel shipping": "Expédition de barils",
    "Browse listings, photos, prices, and title information before preparing a viewing or purchase.": "Parcourez les annonces, photos, prix et informations de titre avant de préparer une visite ou un achat.",
    "Browse listings, photos, prices, and title information, then prepare a viewing, reservation, or purchase.": "Consultez les annonces, photos, prix et informations de titre, puis préparez une visite, une réservation ou un achat.",
    "Car transport": "Transport de véhicules",
    "Choose a city and dates, then prepare your vehicle to reserve a space.": "Choisissez une ville et des dates, puis préparez votre véhicule pour réserver une place.",
    "Choose a destination and prepare your vehicle details to request a quote.": "Choisissez une destination et préparez les informations de votre véhicule pour demander un devis.",
    "Compare approved businesses and per-kilogram rates, then prepare your shipment online.": "Comparez les entreprises approuvées et les tarifs au kilo, puis préparez votre expédition en ligne.",
    "Compare destinations, businesses, and prices before preparing your request.": "Comparez les destinations, les entreprises et les prix avant de préparer votre demande.",
    "Compare per-kilogram rates and prepare your shipment online before creating an account.": "Comparez les tarifs au kilo et préparez votre expédition en ligne avant de créer un compte.",
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
    "Start a freight request": "Commencer une demande de fret",
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
    "A trusted platform for the African diaspora — registered businesses offer shipping, cars, freight, food, and professional services with clearer support.": "Une plateforme de confiance pour la diaspora africaine : des entreprises inscrites proposent l’expédition, les voitures, le fret, la restauration et des services professionnels avec un accompagnement plus clair.",
    "A trusted platform where registered businesses offer shipping, cars, freight, food, and professional services with clearer pricing, tracking, and support.": "Une plateforme de confiance où des entreprises inscrites proposent expédition, voitures, fret, restauration et services professionnels avec des prix, un suivi et une assistance plus clairs.",
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
    "Barrel shipping": "Expédition de barils",
    "Barrel shipping (full)": "Expédition de baril complet",
    "Barrels & shared loads": "Barils et chargements partagés",
    "Barrels · by sea · paid safely": "Barils · par mer · paiement sécurisé",
    "Built by the diaspora, for the diaspora": "Créé par la diaspora, pour la diaspora",
    "Business city": "Ville de l’entreprise",
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
    "Laawol Digital is a platform where registered businesses offer diaspora services — shipping, cars, freight, food, and professional help. We bring the pricing, tracking, support, and accountability into one place so customers can choose with confidence.": "Laawol Digital est une plateforme où des entreprises inscrites proposent des services pour la diaspora : expédition, voitures, fret, restauration et aide professionnelle. Nous rassemblons les prix, le suivi, l’assistance et la responsabilité au même endroit pour que les clients choisissent en confiance.",
    "Laawol connects customers with registered businesses on both sides of the route — so services are easier to compare, track, and support.": "Laawol relie les clients à des entreprises inscrites des deux côtés du trajet, afin que les services soient plus faciles à comparer, suivre et accompagner.",
    "Laawol app Shipping screen showing barrels, freight, and car transport.": "Écran Expédition de l’application Laawol présentant les barils, le fret et le transport de voitures.",
    "Lawyers & professionals": "Avocats et professionnels",
    "Learn more": "En savoir plus",
    "Let’s bring home closer": "Rapprochons le pays",
    "List your business": "Inscrire votre entreprise",
    "Ship barrels, freight, and cars between the US and West Africa.": "Expédiez des barils, du fret et des voitures entre les États-Unis et l’Afrique de l’Ouest.",
    "Ship barrels, freight, and cars between the US and": "Expédiez des barils, du fret et des voitures entre les États-Unis et",
    "West Africa": "l’Afrique de l’Ouest",
    "Laawol is a marketplace of registered, verified businesses: compare per-barrel and per-kilo prices, buy verified cars, request transport quotes, and track every order — with platform support at every step.": "Laawol est une marketplace d’entreprises inscrites et vérifiées : comparez les prix par baril et par kilo, achetez des voitures vérifiées, demandez des devis de transport et suivez chaque commande — avec l’assistance de la plateforme à chaque étape.",
    "A trusted platform for the African diaspora: registered businesses offer barrel and freight shipping, car sales, transport, and parking — with clear prices and real tracking.": "Une plateforme de confiance pour la diaspora africaine : des entreprises inscrites proposent l’expédition de barils et de fret, la vente, le transport et le stationnement de voitures — avec des prix clairs et un vrai suivi.",
    "“Laawol” means “the road” in Pular. Laawol — the road home.": "« Laawol » signifie « le chemin » en pular. Laawol — la route vers le pays.",
    "Barrel and freight shipping, cars, transport, and parking from registered businesses.": "Expédition de barils et de fret, voitures, transport et stationnement proposés par des entreprises inscrites.",
    "Ship a barrel or freight, buy or move a car, or book parking with registered providers.": "Expédiez un baril ou du fret, achetez ou transportez une voiture, ou réservez un stationnement auprès des prestataires inscrits.",
    "Laawol exists to shorten the distance between you and home. From barrels to vehicles, the platform makes providers easier to find, compare, and hold accountable.": "Laawol existe pour réduire la distance entre vous et le pays. Du baril au véhicule, la plateforme rend les prestataires plus faciles à trouver, comparer et responsabiliser.",
    "Cars, barrels, freight, and parking organized together.": "Voitures, barils, fret et stationnement réunis au même endroit.",
    "Do you run a business?": "Vous avez une entreprise ?",
    "Join the registered businesses serving the diaspora: barrel shipping, freight, cars, transport, and parking. Apply once, choose your services, and be visible after approval.": "Rejoignez les entreprises inscrites qui servent la diaspora : expédition de barils, fret, voitures, transport et stationnement. Postulez une fois, choisissez vos services et soyez visible après approbation.",
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
    "Ship barrels to destination countries.": "Expédier des barils vers les pays de destination.",
    "Freight (parcels)": "Fret (colis)",
    "Ship parcels and boxes by weight, by air or sea.": "Expédier des colis et des cartons au poids, par avion ou par bateau.",
    "Shipping": "Expédition",
    "Shipping, cars, freight, food, and professional services from registered businesses.": "Expédition, voitures, fret, restauration et services professionnels proposés par des entreprises inscrites.",
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
    "barrel Shipping": "Expédition de barils",
    "barrelShipping": "Expédition de barils",
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
    "Cote d'Ivoire": "Côte d’Ivoire"
  };

  var frToEn = {};
  Object.keys(enToFr).forEach(function (key) {
    frToEn[enToFr[key]] = key;
  });
  frToEn["Expédition de barils"] = "Barrel shipping";
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
