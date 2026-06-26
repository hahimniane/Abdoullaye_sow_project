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

  // Mobile menu toggle
  var toggle = document.getElementById("navToggle");
  var menu = document.getElementById("mobileMenu");
  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
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

  var destinationCountry = document.getElementById("destinationCountry");
  var destinationCity = document.getElementById("destinationCity");
  var destinationCities = {
    "Guinea": ["Conakry", "Kankan", "Labe", "Nzerekore", "Kindia", "Mamou"],
    "Senegal": ["Dakar", "Touba", "Thies", "Saint-Louis", "Kaolack", "Ziguinchor"],
    "Mali": ["Bamako", "Sikasso", "Mopti", "Segou", "Kayes", "Koutiala"],
    "Côte d'Ivoire": ["Abidjan", "Bouake", "Yamoussoukro", "Daloa", "San-Pedro", "Korhogo"],
    "Gambia": ["Banjul", "Serekunda", "Brikama", "Bakau", "Farafenni"],
    "Sierra Leone": ["Freetown", "Bo", "Kenema", "Makeni", "Koidu"],
    "Liberia": ["Monrovia", "Gbarnga", "Buchanan", "Ganta", "Kakata"],
    "United States": ["New York", "Bronx", "Brooklyn", "Manhattan", "Queens", "Newark", "Jersey City", "Philadelphia", "Atlanta"],
  };
  if (destinationCountry && destinationCity) {
    destinationCountry.addEventListener("change", function () {
      var cities = destinationCities[destinationCountry.value] || [];
      destinationCity.innerHTML = '<option value="">Select a city</option>';
      cities.forEach(function (city) {
        var option = document.createElement("option");
        option.value = city;
        option.textContent = city;
        destinationCity.appendChild(option);
      });
      destinationCity.disabled = cities.length === 0;
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
