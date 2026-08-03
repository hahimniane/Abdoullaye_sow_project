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

  /* --- Gradient-mesh canvas: the "video" background. Painted at a tiny
     internal resolution and scaled up by CSS, so the browser's own bilinear
     smoothing produces the soft, expensive-looking blur for free. Five color
     fields orbit slowly - dawn over the Atlantic in brand colors. Stripe
     ships its hero exactly this way (canvas + static fallback); our fallback
     is the .hero-bg CSS gradient that was already there. --- */
  var MESH_BLOBS = [
    // [color, alpha, radius-share, orbit-x, orbit-y, speed, phase]
    ["19,148,136", .62, .78, .34, .30, .00011, 0.0],
    ["103,232,249", .55, .62, .40, .34, .00009, 2.1],
    ["245,158,11", .45, .55, .36, .38, .00013, 4.2],
    ["5,150,105",  .40, .70, .42, .26, .00007, 1.1],
    ["153,246,228", .65, .60, .38, .36, .00010, 3.3],
  ];
  function attachMesh(host, strength) {
    if (host.querySelector(".mesh")) return;
    var wrap = el("div", "mesh");
    wrap.setAttribute("aria-hidden", "true");
    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    // The static .hero-bg is the no-JS fallback; the mesh must paint OVER it
    // or the fallback's near-opaque gradient hides the canvas entirely.
    var fallback = host.querySelector(".hero-bg");
    if (fallback) host.insertBefore(wrap, fallback.nextSibling);
    else host.insertBefore(wrap, host.firstChild);
    var ctx = canvas.getContext("2d");
    var W = 220, H = 130;
    canvas.width = W; canvas.height = H;
    var running = true, visible = true, last = 0;
    function frame(now) {
      if (!running) return;
      if (visible && now - last > 33) { // ~30fps is plenty for this
        last = now;
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < MESH_BLOBS.length; i++) {
          var b = MESH_BLOBS[i];
          var t = now * b[5] + b[6];
          var x = W * (0.5 + b[3] * Math.sin(t));
          var y = H * (0.42 + b[4] * Math.cos(t * 1.27));
          var r = Math.max(W, H) * b[2];
          var g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, "rgba(" + b[0] + "," + (b[1] * strength) + ")");
          g.addColorStop(1, "rgba(" + b[0] + ",0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.addEventListener("visibilitychange", function () {
      visible = !document.hidden;
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting && !document.hidden;
      }).observe(host);
    }
  }
  function injectMesh() {
    var hero = document.querySelector(".hero");
    if (hero) attachMesh(hero, 1);
    var head = document.querySelector(".page-head");
    if (head) attachMesh(head, .8);
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
    injectMesh();
    injectSea();
    injectGlyphs();
    injectScene();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once: true});
  } else {
    boot();
  }
})();
