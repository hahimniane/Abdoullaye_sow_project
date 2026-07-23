(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce) root.classList.add("js-anim");

  if (!reduce) {
    var progress = document.createElement("div");
    progress.className = "scroll-progress";
    progress.setAttribute("aria-hidden", "true");
    document.body.appendChild(progress);
  }

  function attachMotionCards() {
    if (reduce) return;
    document.querySelectorAll(
      ".service-card, .trust-card, .partner-card, .dest-card, .step," +
      " .cta-band, .service-featured, .ex-chip"
    ).forEach(function (card) {
      if (card.dataset.motionReady === "true") return;
      card.dataset.motionReady = "true";
      card.addEventListener("pointermove", function (event) {
        var rect = card.getBoundingClientRect();
        card.style.setProperty("--mx", (event.clientX - rect.left) + "px");
        card.style.setProperty("--my", (event.clientY - rect.top) + "px");
      });
      card.addEventListener("pointerleave", function () {
        card.style.removeProperty("--mx");
        card.style.removeProperty("--my");
      });
    });
  }

  function localize(value) {
    return window.LaawolI18n && typeof window.LaawolI18n.localize === "function"
      ? window.LaawolI18n.localize(value)
      : value;
  }

  // Keep the customer web app one tap away on every public page. The shared
  // script owns this CTA so legal and future pages cannot accidentally omit it.
  function addCustomerWorkspaceLink(container, mobile) {
    if (!container) return;
    var existing = container.querySelector(
      '[data-customer-workspace="true"], a[href="https://customer.laawoldigital.com"]'
    );
    if (existing) {
      existing.dataset.customerWorkspace = "true";
      return;
    }
    var link = document.createElement("a");
    link.href = "https://customer.laawoldigital.com";
    link.textContent = document.documentElement.lang === "en"
      ? "Customer workspace"
      : "Espace client";
    link.dataset.customerWorkspace = "true";
    if (mobile) {
      link.className = "btn btn-primary";
    } else {
      link.className = "btn btn-customer";
    }
    container.appendChild(link);
  }

  addCustomerWorkspaceLink(document.querySelector(".nav-cta"), false);
  addCustomerWorkspaceLink(document.getElementById("mobileMenu"), true);

  // Mobile menu toggle
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("mobileMenu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", localize(open ? "Close menu" : "Open menu"));
    });
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        menu.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Current year in footer
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  // Header reacts to scroll
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () {
      header.classList.toggle("scrolled", window.scrollY > 12);
      var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      root.style.setProperty("--scroll-progress", Math.min(1, window.scrollY / max).toFixed(4));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  attachMotionCards();

  var destinationPays = document.getElementById("destinationCountry");
  var destinationVille = document.getElementById("destinationCity");
  var destinationCities = {
    "Guinea": ["Conakry", "Kankan", "Labe", "Nzerekore", "Kindia", "Mamou"],
    "Senegal": ["Dakar", "Touba", "Thiès", "Saint-Louis", "Kaolack", "Ziguinchor"],
    "Mali": ["Bamako", "Sikasso", "Mopti", "Ségou", "Kayes", "Koutiala"],
    "Côte d'Ivoire": ["Abidjan", "Bouaké", "Yamoussoukro", "Daloa", "San-Pedro", "Korhogo"],
    "Gambia": ["Banjul", "Serekunda", "Brikama", "Bakau", "Farafenni"],
    "Sierra Leone": ["Freetown", "Bo", "Kenema", "Makeni", "Koidu"],
    "Liberia": ["Monrovia", "Gbarnga", "Buchanan", "Ganta", "Kakata"],
    "United States": ["New York", "Bronx", "Brooklyn", "Manhattan", "Queens", "Newark", "Jersey City", "Philadelphia", "Atlanta"],
  };
  if (destinationPays && destinationVille) {
    var countryCatalog = window.LaawolCountryCatalog;
    if (countryCatalog && typeof countryCatalog.populateCountrySelect === "function") {
      countryCatalog.populateCountrySelect(destinationPays);
    }
    destinationPays.addEventListener("change", function () {
      var cities = destinationCities[destinationPays.value] || [];
      destinationVille.innerHTML = "";
      var placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = localize("Select a city");
      destinationVille.appendChild(placeholder);
      cities.forEach(function (city) {
        var option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        destinationVille.appendChild(option);
      });
      destinationVille.disabled = cities.length === 0;
    });
  }

  if (reduce || !("IntersectionObserver" in window)) return;

  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );

  function refreshReveals() {
    // Staggered scroll reveal — content is visible by default; we add the
    // hidden state via JS so a script failure can never blank the page.
    var groups = document.querySelectorAll(
      ".section-head, .service-grid, .service-featured, .partner-grid, .steps, .dest-grid," +
      " .why-inner, .app-show-inner, .cta-band, .chip-grid, .source-split, .contact-inner"
    );
    var revealed = [];
    groups.forEach(function (group) {
      var kids = group.children.length > 1 ? group.children : [group];
      Array.prototype.forEach.call(kids, function (el, i) {
        if (el.dataset.revealReady === "true") return;
        el.dataset.revealReady = "true";
        el.classList.add("reveal");
        el.style.transitionDelay = Math.min(i * 70, 280) + "ms";
        revealed.push(el);
      });
    });

    revealed.forEach(function (el) { io.observe(el); });

    attachMotionCards();

    // Safety net: never leave anything hidden.
    window.setTimeout(function () {
      revealed.forEach(function (el) { el.classList.add("in"); });
    }, 2600);
  }

  window.LaawolAnimations = {
    refresh: refreshReveals,
  };
  refreshReveals();
})();

/* Hero corridor — rotating live shipment card */
(function () {
  var emoji = document.getElementById("ccEmoji");
  var title = document.getElementById("ccTitle");
  var meta = document.getElementById("ccMeta");
  var bar = document.getElementById("ccBar");
  var eta = document.getElementById("ccEta");
  var card = document.querySelector(".corridor-card");
  if (!emoji || !title || !meta || !bar || !eta || !card) return;

  function localize(value) {
    return window.LaawolI18n && typeof window.LaawolI18n.localize === "function"
      ? window.LaawolI18n.localize(value)
      : value;
  }

  // Goods AND services move both ways, by sea and by air, across many regions.
  var feed = [
    { e: "🚢", t: "New York → Conakry", m: "Barrels · by sea · paid safely", w: 60, x: "On the vessel · arrives in 22 days · tracked" },
    { e: "✈️", t: "Atlanta → Lagos", m: "Packages · by air · platform-backed", w: 86, x: "In the air · arrives in 3 days · tracked" },
    { e: "🚢", t: "London → Accra", m: "Car · by sea · escrow protected", w: 40, x: "Loaded at port · arrives in 26 days · tracked" },
    { e: "✈️", t: "Abidjan → Brussels", m: "Parcel · by air · protected", w: 72, x: "Boarding flight · arrives in 4 days · tracked" },
    { e: "⚖️", t: "Brussels → Banjul", m: "Licensed professional · supported", w: 55, x: "Consultation confirmed for Friday" },
    { e: "💳", t: "Paris → Bamako", m: "Payment · platform-protected", w: 96, x: "Released to the business · receipt sent" }
  ];
  var i = 0;
  function render(item) {
    emoji.textContent = item.e;
    title.textContent = localize(item.t);
    meta.textContent = localize(item.m);
    eta.textContent = localize(item.x);
    bar.style.width = item.w + "%";
    card.classList.remove("cc-swap");
    void card.offsetWidth; // restart animation
    card.classList.add("cc-swap");
  }
  setInterval(function () {
    i = (i + 1) % feed.length;
    render(feed[i]);
  }, 3200);
})();
