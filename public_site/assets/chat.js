/* Laawol assistant: a floating helper that answers questions about the
   platform and walks visitors to the right page. Fully self-contained -
   the knowledge base lives here, nothing is sent anywhere, and it answers
   in the visitor's current language via LaawolI18n. The answer engine is
   one function (answerFor); swapping it for a backend call later changes
   nothing else. */
(function () {
  "use strict";

  var CUSTOMER = "https://customer.laawoldigital.com";

  // ---- Knowledge base ----------------------------------------------------
  // keywords are matched accent-insensitively in both languages.
  var INTENTS = [
    {
      id: "barrels",
      keywords: ["baril", "barrel", "tonneau", "drum", "fut", "ship a barrel",
        "expedier un baril", "envoyer un baril"],
      fr: "Avec l’expédition de barils, vous envoyez un baril complet vers un pays desservi. Chaque entreprise affiche son prix par baril et un délai estimé — vous comparez, puis préparez votre expédition en ligne.",
      en: "With barrel shipping you send a full barrel to a served country. Each business lists its price per barrel and an estimated delivery window — compare, then prepare your shipment online.",
      actions: [
        {fr: "Voir le service", en: "See the service", href: "services.html"},
        {fr: "Expédier un baril", en: "Ship a barrel", href: CUSTOMER + "/?service=barrels"},
      ],
    },
    {
      id: "freight",
      keywords: ["fret", "freight", "colis", "parcel", "carton", "box", "kilo",
        "kg", "air", "avion", "mer", "sea", "bateau", "cargo"],
      fr: "Le fret couvre les colis et cartons facturés au poids — par avion (plus rapide) ou par mer (plus économique). Les tarifs au kilo et les jours de départ sont affichés par entreprise et par destination.",
      en: "Freight covers parcels and boxes priced by weight — by air (faster) or by sea (cheaper). Per-kilo rates and departure days are shown per business and destination.",
      actions: [
        {fr: "Comparer les tarifs", en: "Compare rates", href: CUSTOMER + "/?service=freight"},
        {fr: "Voir le service", en: "See the service", href: "services.html"},
      ],
    },
    {
      id: "cars",
      keywords: ["acheter", "achat", "buy", "voiture", "car", "vehicule",
        "vehicle", "annonce", "listing", "occasion"],
      fr: "Les entreprises inscrites publient des voitures vérifiées : photos, prix et informations de titre. Vous pouvez réserver un véhicule avec une caution avant l’achat.",
      en: "Registered businesses publish verified cars: photos, prices, and title information. You can hold a vehicle with a deposit before you buy.",
      actions: [
        {fr: "Voir les voitures", en: "Browse cars", href: CUSTOMER + "/?service=cars"},
      ],
    },
    {
      id: "transport",
      keywords: ["transporter", "transport", "envoyer une voiture", "ship a car",
        "move a car", "devis", "quote", "vehicule vers"],
      fr: "Pour expédier un véhicule vers l’Afrique de l’Ouest, décrivez la voiture et la destination : les entreprises couvrant ce pays vous envoient un devis, et vous suivez le transport jusqu’à l’arrivée.",
      en: "To ship a vehicle to West Africa, describe the car and destination: businesses covering that country send you quotes, and you track the move to arrival.",
      actions: [
        {fr: "Demander un devis", en: "Request a quote", href: CUSTOMER + "/?service=transport"},
      ],
    },
    {
      id: "parking",
      keywords: ["stationnement", "parking", "garer", "park", "place"],
      fr: "Le stationnement vous permet de réserver une place pour votre véhicule auprès d’une entreprise approuvée : choisissez une ville et des dates, puis préparez la réservation.",
      en: "Parking lets you reserve a space for your vehicle with an approved business: pick a city and dates, then prepare the reservation.",
      actions: [
        {fr: "Trouver un stationnement", en: "Find parking", href: CUSTOMER + "/?service=parking"},
      ],
    },
    {
      id: "tracking",
      keywords: ["suivi", "suivre", "track", "tracking", "commande", "order",
        "statut", "status", "ou est", "where is", "numero"],
      fr: "Chaque commande reçoit un numéro de suivi et son statut se met à jour à chaque étape — pris en charge, en transit, arrivé, livré. Connectez-vous pour voir toutes vos commandes.",
      en: "Every order gets a tracking number and its status updates at each step — picked up, in transit, arrived, delivered. Sign in to see all your orders.",
      actions: [
        {fr: "Suivre ma commande", en: "Track my order", href: "tracking.html"},
        {fr: "Ouvrir mon espace", en: "Open my account", href: CUSTOMER},
      ],
    },
    {
      id: "pricing",
      keywords: ["prix", "price", "cout", "cost", "combien", "how much",
        "tarif", "rate", "cher"],
      fr: "Les prix sont fixés par chaque entreprise et affichés avant toute demande : par baril, au kilo pour le fret, sur devis pour le transport de véhicules. Vous comparez librement avant de choisir.",
      en: "Prices are set by each business and shown before you request anything: per barrel, per kilo for freight, by quote for vehicle transport. Compare freely before you choose.",
      actions: [
        {fr: "Comparer en ligne", en: "Compare online", href: CUSTOMER},
      ],
    },
    {
      id: "payment",
      keywords: ["payer", "payment", "paiement", "securise", "secure", "carte",
        "card", "rembours", "refund", "confiance", "trust", "arnaque", "scam"],
      fr: "Vous payez en ligne, de façon sécurisée, et l’argent est versé à l’entreprise via la plateforme. En cas de problème, l’assistance Laawol suit votre dossier — chaque commande garde son historique et ses reçus.",
      en: "You pay online, securely, and the money reaches the business through the platform. If something goes wrong, Laawol support follows your case — every order keeps its history and receipts.",
      actions: [
        {fr: "Nous contacter", en: "Contact us", href: "contact.html"},
      ],
    },
    {
      id: "partner",
      keywords: ["entreprise", "business", "inscrire", "register", "list",
        "partenaire", "partner", "vendre", "sell", "proposer", "offer",
        "rejoindre", "join"],
      fr: "Vous avez une entreprise ? Postulez une fois : créez le compte propriétaire, choisissez vos services, et passez la vérification (documents + Stripe). Les clients vous voient après approbation.",
      en: "Run a business? Apply once: create the owner account, pick your services, and complete verification (documents + Stripe). Customers see you after approval.",
      actions: [
        {fr: "Inscrire mon entreprise", en: "List my business", href: "partner.html"},
      ],
    },
    {
      id: "app",
      keywords: ["application", "app", "telecharger", "download", "android",
        "iphone", "ios", "mobile", "play store", "app store"],
      fr: "L’application Laawol regroupe tous les services : expédition, suivi, voitures et paiements, avec des notifications à chaque étape.",
      en: "The Laawol app brings every service together: shipping, tracking, cars, and payments, with notifications at each step.",
      actions: [
        {fr: "Télécharger l’application", en: "Get the app", href: "app.html"},
        {fr: "Continuer en ligne", en: "Continue online", href: CUSTOMER},
      ],
    },
    {
      id: "human",
      keywords: ["contact", "humain", "human", "aide", "help", "parler",
        "talk", "email", "equipe", "team", "question", "support"],
      fr: "Notre équipe répond par la page contact — et une fois connecté, chaque commande a son fil d’assistance directement dans votre espace.",
      en: "Our team answers through the contact page — and once signed in, every order has its own support thread right in your account.",
      actions: [
        {fr: "Parler à notre équipe", en: "Talk to our team", href: "contact.html"},
      ],
    },
    {
      id: "countries",
      keywords: ["pays", "country", "countries", "guinee", "guinea", "senegal",
        "mali", "gambie", "gambia", "destination", "desservi", "serve", "zone"],
      fr: "Les destinations dépendent des entreprises : chacune choisit les pays qu’elle dessert (Guinée, Sénégal, Mali, Gambie et d’autres). La liste complète, avec les prix, est visible en ligne.",
      en: "Destinations depend on the businesses: each chooses the countries it serves (Guinea, Senegal, Mali, Gambia, and more). The full list, with prices, is visible online.",
      actions: [
        {fr: "Voir les destinations", en: "See destinations", href: "services.html#destinations"},
      ],
    },
  ];

  var UI = {
    fr: {
      title: "Assistant Laawol",
      subtitle: "Réponses immédiates, 24h/24",
      hello: "Bonjour 👋 Je peux vous expliquer nos services et vous emmener au bon endroit. Que cherchez-vous ?",
      fallback: "Je n’ai pas bien saisi. Voici ce que je sais expliquer :",
      placeholder: "Écrivez votre question…",
      send: "Envoyer",
      open: "Ouvrir l’assistant",
      close: "Fermer l’assistant",
      chips: [
        ["Expédier un baril", "baril"],
        ["Fret au kilo", "fret"],
        ["Suivre ma commande", "suivi"],
        ["Acheter une voiture", "acheter voiture"],
        ["Inscrire mon entreprise", "inscrire entreprise"],
      ],
    },
    en: {
      title: "Laawol Assistant",
      subtitle: "Instant answers, 24/7",
      hello: "Hi 👋 I can explain our services and take you to the right place. What are you looking for?",
      fallback: "I didn’t quite catch that. Here’s what I can explain:",
      placeholder: "Type your question…",
      send: "Send",
      open: "Open the assistant",
      close: "Close the assistant",
      chips: [
        ["Ship a barrel", "barrel"],
        ["Freight by kilo", "freight"],
        ["Track my order", "track"],
        ["Buy a car", "buy car"],
        ["List my business", "register business"],
      ],
    },
  };

  function lang() {
    return (window.LaawolI18n && window.LaawolI18n.getLang &&
      window.LaawolI18n.getLang()) === "en" ? "en" : "fr";
  }
  function norm(s) {
    return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  }
  function answerFor(text) {
    var q = " " + norm(text) + " ";
    var best = null, bestScore = 0;
    INTENTS.forEach(function (intent) {
      var score = 0;
      intent.keywords.forEach(function (k) {
        if (q.indexOf(norm(k)) > -1) score += k.length > 5 ? 2 : 1;
      });
      if (score > bestScore) { bestScore = score; best = intent; }
    });
    return bestScore > 0 ? best : null;
  }

  // ---- UI ----------------------------------------------------------------
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  var API = "https://us-central1-car-selling-flutter-app.cloudfunctions.net/assistantChat";
  var history = []; // rolling {role, content} turns sent to the backend

  var root, panel, log, input, open = false;

  function pushBubble(kind, html) {
    var b = el("div", "lc-msg " + kind, html);
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  }
  function pushBot(intent) {
    var L = lang();
    var html = esc(intent[L]);
    if (intent.actions && intent.actions.length) {
      html += '<span class="lc-actions">' + intent.actions.map(function (a) {
        return '<a class="lc-action" href="' + a.href + '">' + esc(a[L]) + "</a>";
      }).join("") + "</span>";
    }
    pushBubble("bot", html);
  }
  function pushChips() {
    var L = lang();
    var wrap = el("div", "lc-chips");
    UI[L].chips.forEach(function (c) {
      var chip = el("button", "lc-chip", esc(c[0]));
      chip.type = "button";
      chip.addEventListener("click", function () { ask(c[1], c[0]); });
      wrap.appendChild(chip);
    });
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
  }
  function localFallback(query) {
    var L = lang();
    var intent = answerFor(query);
    if (intent) {
      pushBot(intent);
    } else {
      pushBubble("bot", esc(UI[L].fallback));
      pushChips();
    }
  }

  // Renders an AI reply: text stays text, any approved-domain URL becomes an
  // action pill instead of a raw link in the middle of a sentence.
  function pushAi(reply) {
    var urls = [];
    var text = reply.replace(/https?:\/\/[^\s)\]]+/g, function (u) {
      var clean = u.replace(/[.,;!?]+$/, "");
      if (/laawoldigital\.com/.test(clean) && urls.indexOf(clean) < 0 &&
          urls.length < 3) urls.push(clean);
      return "";
    }).replace(/[ \t]{2,}/g, " ").replace(/\(\s*\)/g, "").trim();
    // Emails must reach the visitor's mail app, so linkify them after
    // escaping (escaping first keeps the reply text untrusted-safe).
    var html = esc(text).replace(
        /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
        function (m) { return '<a href="mailto:' + m + '">' + m + "</a>"; });
    if (urls.length) {
      html += '<span class="lc-actions">' + urls.map(function (u) {
        var label = u.indexOf("customer.") > -1 ?
          (lang() === "en" ? "Open Laawol online" : "Ouvrir Laawol en ligne") :
          u.split("/").pop().replace(".html", "") || "laawoldigital.com";
        return '<a class="lc-action" href="' + u + '">' + esc(label) + "</a>";
      }).join("") + "</span>";
    }
    pushBubble("bot", html);
  }

  function ask(query, displayText) {
    pushBubble("me", esc(displayText || query));
    history.push({role: "user", content: query});
    if (history.length > 8) history = history.slice(-8);

    var typing = pushBubble("bot lc-typing", "<i></i><i></i><i></i>");
    var controller = ("AbortController" in window) ? new AbortController() : null;
    var timer = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 15000);

    fetch(API, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({messages: history, lang: lang()}),
      signal: controller && controller.signal,
    }).then(function (r) {
      return r.json().then(function (data) {
        return {ok: r.ok, data: data};
      });
    }).then(function (out) {
      window.clearTimeout(timer);
      typing.remove();
      if (out.ok && out.data && out.data.reply) {
        history.push({role: "assistant", content: out.data.reply});
        pushAi(out.data.reply);
      } else {
        localFallback(query);
      }
    }).catch(function () {
      window.clearTimeout(timer);
      typing.remove();
      localFallback(query);
    });
  }

  function build() {
    root = el("div", "lc-root");
    root.setAttribute("data-notranslate", "true");
    var L = lang();

    var fab = el("button", "lc-fab");
    fab.type = "button";
    fab.setAttribute("aria-label", UI[L].open);
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>' +
      '<path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"/></svg>';

    panel = el("div", "lc-panel");
    panel.innerHTML =
      '<div class="lc-head"><div><b>' + esc(UI[L].title) + "</b>" +
      "<small>" + esc(UI[L].subtitle) + "</small></div>" +
      '<button type="button" class="lc-x" aria-label="' + esc(UI[L].close) +
      '">×</button></div>' +
      '<div class="lc-log"></div>' +
      '<form class="lc-form"><input type="text" class="lc-in" placeholder="' +
      esc(UI[L].placeholder) + '" aria-label="' + esc(UI[L].placeholder) +
      '"/><button type="submit" class="lc-send">' + esc(UI[L].send) +
      "</button></form>";

    root.appendChild(panel);
    root.appendChild(fab);
    document.body.appendChild(root);

    log = panel.querySelector(".lc-log");
    input = panel.querySelector(".lc-in");

    function toggle(want) {
      open = want === undefined ? !open : want;
      panel.classList.toggle("open", open);
      fab.classList.toggle("open", open);
      if (open && !log.childElementCount) {
        pushBubble("bot", esc(UI[lang()].hello));
        pushChips();
      }
      if (open) input.focus();
    }
    fab.addEventListener("click", function () { toggle(); });
    panel.querySelector(".lc-x").addEventListener("click", function () { toggle(false); });
    panel.querySelector(".lc-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (!v) return;
      input.value = "";
      ask(v);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build, {once: true});
  } else {
    build();
  }
})();
