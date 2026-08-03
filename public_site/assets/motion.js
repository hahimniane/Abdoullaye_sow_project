/* Atmosphere layer: aurora light behind heroes, sea waves under the home
   hero, the animated US <-> West Africa corridor band, and floating glyphs on
   subpage heads.

   Everything here is DECORATIVE and injected at runtime: if this file fails
   to load, every page renders exactly as before. Scroll reveals and card
   hovers live in script.js/styles.css - this file deliberately doesn't touch
   them. All motion is disabled under prefers-reduced-motion. */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  function el(tag, className, html) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  /* --- Aurora: drifting light, one per hero/page-head --- */
  function injectAurora() {
    document.querySelectorAll(".hero, .page-head").forEach(function (host) {
      if (host.querySelector(".aurora")) return;
      var aurora = el("div", "aurora", "<i></i><i></i><i></i>");
      aurora.setAttribute("aria-hidden", "true");
      host.insertBefore(aurora, host.firstChild);
    });
  }

  /* --- Sea waves at the base of the home hero --- */
  var WAVE =
    '<svg viewBox="0 0 1200 60" preserveAspectRatio="none" aria-hidden="true">' +
    '<path d="M0 38 Q 75 18 150 38 T 300 38 T 450 38 T 600 38 T 750 38 T 900 38 T 1050 38 T 1200 38 V60 H0 Z" fill="rgba(13,148,136,.10)"/></svg>';
  function injectSea() {
    var hero = document.querySelector(".hero");
    if (!hero || hero.querySelector(".sea")) return;
    ["sea sea-1", "sea sea-2"].forEach(function (cls) {
      var wrap = el("div", cls, WAVE + WAVE);
      wrap.setAttribute("aria-hidden", "true");
      wrap.querySelectorAll("svg").forEach(function (svg, i) {
        if (i === 1) svg.style.display = "none";
      });
      // Two copies side by side so the loop is seamless at 200% width.
      wrap.innerHTML = "<div style=\"display:flex;width:200%\">" +
        "<div style=\"flex:0 0 50%\">" + WAVE + "</div>" +
        "<div style=\"flex:0 0 50%\">" + WAVE + "</div></div>";
      var inner = wrap.firstChild;
      inner.style.animation = (cls.indexOf("sea-2") > -1 ?
        "seaDrift 38s linear reverse infinite" : "seaDrift 24s linear infinite");
      hero.appendChild(wrap);
    });
  }

  /* --- The corridor: New York <-> Conakry · Dakar, goods moving both ways.
     SMIL animateMotion needs no per-frame JS; city names are proper nouns so
     the band needs no dictionary entries. --- */
  var JOURNEY =
    '<div class="container">' +
    '<svg class="journey-svg" viewBox="0 0 1100 240" role="img" ' +
    'aria-label="New York to Conakry and Dakar shipping corridor">' +
    '<path class="lane-glow" d="M110 150 C 360 30, 740 30, 990 150"/>' +
    '<path class="lane" id="laneNE" d="M110 150 C 360 30, 740 30, 990 150"/>' +
    '<path class="lane" id="laneSW" style="opacity:.35" ' +
    'd="M990 170 C 740 260, 360 260, 110 170" transform="translate(0,-16)"/>' +
    '<circle class="pulse" cx="110" cy="150" r="8"/>' +
    '<circle class="pulse p2" cx="990" cy="150" r="8"/>' +
    '<circle class="node" cx="110" cy="150" r="10"/>' +
    '<circle class="node-core" cx="110" cy="150" r="4"/>' +
    '<circle class="node" cx="990" cy="150" r="10"/>' +
    '<circle class="node-core" cx="990" cy="150" r="4"/>' +
    '<text class="port" x="110" y="192" text-anchor="middle">New York</text>' +
    '<text class="port-sub" x="110" y="212" text-anchor="middle">USA</text>' +
    '<text class="port" x="990" y="192" text-anchor="middle">Conakry · Dakar</text>' +
    '<text class="port-sub" x="990" y="212" text-anchor="middle">GN · SN · ML · GM</text>' +
    '<text class="mover">🛢️' +
    '<animateMotion dur="11s" repeatCount="indefinite" rotate="0">' +
    '<mpath href="#laneNE"/></animateMotion></text>' +
    '<text class="mover">📦' +
    '<animateMotion dur="11s" begin="3.6s" repeatCount="indefinite">' +
    '<mpath href="#laneNE"/></animateMotion></text>' +
    '<text class="mover">🚗' +
    '<animateMotion dur="11s" begin="7.3s" repeatCount="indefinite">' +
    '<mpath href="#laneNE"/></animateMotion></text>' +
    "</svg></div>";
  function injectJourney() {
    // Home page only - it hosts the globe, so anchor off that.
    if (!document.getElementById("globeCanvas")) return;
    if (document.querySelector(".journey")) return;
    var hero = document.querySelector(".hero");
    if (!hero || !hero.parentNode) return;
    var band = el("section", "journey", JOURNEY);
    band.setAttribute("aria-hidden", "false");
    hero.parentNode.insertBefore(band, hero.nextSibling);
  }

  /* --- Floating glyphs per subpage head --- */
  var GLYPHS = {
    "services": ["🛢️", "✈️", "🚗"],
    "tracking": ["📦", "🚢", "📍"],
    "app":      ["📱", "🛢️", "🚗"],
    "about":    ["🤝", "🌍", "📦"],
    "contact":  ["✉️", "💬", "🌍"],
    "partner":  ["🏪", "📦", "🚗"],
  };
  function injectGlyphs() {
    var head = document.querySelector(".page-head");
    if (!head || head.querySelector(".glyphs")) return;
    var page = (location.pathname.split("/").pop() || "").replace(".html", "");
    var set = GLYPHS[page];
    if (!set) return;
    var wrap = el("div", "glyphs",
      "<b style=\"left:8%;top:22%\">" + set[0] + "</b>" +
      "<b style=\"right:12%;top:14%\">" + set[1] + "</b>" +
      "<b style=\"right:26%;bottom:12%\">" + set[2] + "</b>");
    wrap.setAttribute("aria-hidden", "true");
    head.insertBefore(wrap, head.firstChild);
  }

  /* --- Pictorial scene on the home hero: a plane crossing the sky and a
     container ship sailing the wave line. Drawn flat in brand colors so it
     matches the globe illustration - photography would fight the UI. --- */
  var PLANE =
    '<svg viewBox="0 0 120 46" aria-hidden="true">' +
    '<line class="trail" x1="0" y1="30" x2="58" y2="30"/>' +
    '<g fill="#0b3b38">' +
    '<path d="M62 27c14-3 30-5 40-5l8 3-8 3c-10 0-26-2-40-5z"/>' +
    '<path d="M88 25l14-11 6 1-12 12z"/>' +
    '<path d="M88 29l14 11 6-1-12-12z"/>' +
    '<path d="M64 24l-9-7 5-1 9 7z"/>' +
    '</g><circle cx="106" cy="27" r="2.4" fill="#14b8a6"/></svg>';
  var SHIP =
    '<svg viewBox="0 0 190 74" aria-hidden="true">' +
    '<g>' +
    '<path d="M8 48h174l-16 22H20z" fill="#0b3b38"/>' +
    '<rect x="128" y="24" width="26" height="24" rx="2" fill="#e8f5f2"/>' +
    '<rect x="132" y="30" width="7" height="5" fill="#0b3b38"/>' +
    '<rect x="142" y="30" width="7" height="5" fill="#0b3b38"/>' +
    '<rect x="138" y="12" width="6" height="12" fill="#0b3b38"/>' +
    '<rect x="24" y="36" width="22" height="12" rx="1" fill="#0d9488"/>' +
    '<rect x="48" y="36" width="22" height="12" rx="1" fill="#f59e0b"/>' +
    '<rect x="72" y="36" width="22" height="12" rx="1" fill="#1e3a8a"/>' +
    '<rect x="96" y="36" width="22" height="12" rx="1" fill="#14b8a6"/>' +
    '<rect x="36" y="24" width="22" height="12" rx="1" fill="#b45309"/>' +
    '<rect x="60" y="24" width="22" height="12" rx="1" fill="#0d9488"/>' +
    '<rect x="84" y="24" width="22" height="12" rx="1" fill="#f59e0b"/>' +
    "</g></svg>";
  function injectScene() {
    var hero = document.querySelector(".hero");
    if (!hero || !document.getElementById("globeCanvas")) return;
    if (hero.querySelector(".sky-plane")) return;
    var plane = el("div", "sky-plane", PLANE);
    plane.setAttribute("aria-hidden", "true");
    var ship = el("div", "sea-ship", SHIP);
    ship.setAttribute("aria-hidden", "true");
    hero.appendChild(plane);
    hero.appendChild(ship);
  }

  function boot() {
    injectAurora();
    injectSea();
    injectJourney();
    injectGlyphs();
    injectScene();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once: true});
  } else {
    boot();
  }
})();
