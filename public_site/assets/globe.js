/* Laawol hero globe — interactive, draggable orthographic globe with Africa
   highlighted and animated connection arcs to the USA & Europe.
   Enhances progressively: if D3 / the atlas fail to load, the static SVG
   fallback in the markup is kept. */
(function () {
  var canvas = document.getElementById("globeCanvas");
  if (!canvas) return;
  var fallback = document.querySelector(".globe-fallback");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.async = true; s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  Promise.all([
    load("https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"),
    load("https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js")
  ])
    .then(function () {
      return fetch("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json")
        .then(function (r) { if (!r.ok) throw new Error("atlas"); return r.json(); });
    })
    .then(build)
    .catch(function () { /* keep the SVG fallback */ });

  function build(world) {
    var d3 = window.d3, topojson = window.topojson;
    if (!d3 || !topojson) return;
    if (fallback) fallback.style.display = "none";
    canvas.style.display = "block";

    var ctx = canvas.getContext("2d");
    var land = topojson.feature(world, world.objects.countries);
    // Highlight African countries by centroid bounding box (no name list needed).
    var africa = { type: "FeatureCollection", features: land.features.filter(function (f) {
      var c = d3.geoCentroid(f);
      return c[0] > -20 && c[0] < 52 && c[1] > -36 && c[1] < 38;
    }) };
    var graticule = d3.geoGraticule10();

    // Barrels & cars ship by SEA; packages fly by AIR. Routes go both ways.
    var routes = [
      { a: [-74.0, 40.7], b: [-13.7, 9.6], cargo: "🚢" },         // New York -> Conakry: barrels by sea
      { a: [-84.4, 33.7], b: [6.45, 3.4], air: true },            // Atlanta -> Lagos: packages by air
      { a: [-0.13, 51.5], b: [-0.19, 5.6], cargo: "🚢" },         // London -> Accra: cars by sea
      { a: [-4.02, 5.35], b: [4.35, 50.85], air: true }           // Abidjan -> Brussels: packages by air
    ];
    routes.forEach(function (r, i) {
      r.t = i / routes.length;
      r.line = { type: "LineString", coordinates: [r.a, r.b] };
      r.toHome = r.b[0] < -5; // arriving in West Africa
      r.color = r.toHome ? "#14b8a6" : "#f59e0b";
      r.glow = r.toHome ? "rgba(20,184,166,.85)" : "rgba(245,158,11,.9)";
      r.interp = d3.geoInterpolate(r.a, r.b);
    });

    var projection = d3.geoOrthographic().clipAngle(90).rotate([-16, -6, 0]);
    var path = d3.geoPath(projection, ctx);
    var width = 0, height = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      var rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height || rect.width;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      projection.fitExtent([[6, 6], [width - 6, height - 6]], { type: "Sphere" });
    }
    resize();
    window.addEventListener("resize", resize);

    function oceanGradient() {
      var c = [width / 2, height / 2], r = projection.scale();
      var g = ctx.createRadialGradient(c[0] - r * 0.35, c[1] - r * 0.4, r * 0.1, c[0], c[1], r * 1.15);
      g.addColorStop(0, "#2bd6c1"); g.addColorStop(0.5, "#0d9488"); g.addColorStop(1, "#06302c");
      return g;
    }

    var center = function () { var rt = projection.rotate(); return [-rt[0], -rt[1]]; };

    function planeShape(c) {
      c.beginPath();
      c.moveTo(10, 0); c.lineTo(1, 2); c.lineTo(-2, 2); c.lineTo(-3, 7); c.lineTo(-5, 7);
      c.lineTo(-5, 2); c.lineTo(-9, 2); c.lineTo(-10, 4); c.lineTo(-11, 4); c.lineTo(-10.5, 0);
      c.lineTo(-11, -4); c.lineTo(-10, -4); c.lineTo(-9, -2); c.lineTo(-5, -2); c.lineTo(-5, -7);
      c.lineTo(-3, -7); c.lineTo(-2, -2); c.lineTo(1, -2); c.closePath();
    }

    function drawFlight(r) {
      // dashed contrail
      ctx.beginPath(); path(r.line);
      ctx.strokeStyle = "rgba(255,255,255,.32)"; ctx.lineWidth = 1.1;
      ctx.setLineDash([2, 5]); ctx.lineDashOffset = -(Date.now() / 40 % 7); ctx.stroke(); ctx.setLineDash([]);
      var p = r.interp(r.t);
      if (d3.geoDistance(p, center()) > Math.PI / 2) return;
      var xy = projection(p);
      var ahead = projection(r.interp(Math.min(1, r.t + 0.03)));
      var ang = Math.atan2(ahead[1] - xy[1], ahead[0] - xy[0]);
      // lift the plane slightly off the surface so it reads as flying
      var cx = width / 2, cy = height / 2, dx = xy[0] - cx, dy = xy[1] - cy, d = Math.hypot(dx, dy) || 1, lift = 10;
      ctx.save(); ctx.translate(xy[0] + dx / d * lift, xy[1] + dy / d * lift); ctx.rotate(ang);
      ctx.fillStyle = "#0b3b38"; ctx.shadowColor = "rgba(11,59,56,.45)"; ctx.shadowBlur = 9;
      planeShape(ctx); ctx.fill(); ctx.shadowBlur = 0;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 0.9; planeShape(ctx); ctx.stroke();
      ctx.restore();
    }

    function drawArc(r) {
      if (r.air) { drawFlight(r); return; }
      // faint full route
      ctx.beginPath(); path(r.line);
      ctx.strokeStyle = "rgba(255,255,255,.22)"; ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 5]); ctx.lineDashOffset = -(Date.now() / 55 % 8);
      ctx.stroke(); ctx.setLineDash([]);

      // bright trail from origin up to the package's current position
      var n = 26, coords = [];
      for (var i = 0; i <= n; i++) coords.push(r.interp((r.t * i) / n));
      ctx.beginPath(); path({ type: "LineString", coordinates: coords });
      ctx.strokeStyle = r.color; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.stroke();

      // the package itself (only when on the visible side)
      var p = r.interp(r.t);
      if (d3.geoDistance(p, center()) > Math.PI / 2) return;
      var xy = projection(p);
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 11, 0, 2 * Math.PI);
      ctx.fillStyle = "#fff"; ctx.shadowColor = r.glow; ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
      ctx.beginPath(); ctx.arc(xy[0], xy[1], 11, 0, 2 * Math.PI);
      ctx.strokeStyle = r.color; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.font = "13px 'Segoe UI Emoji','Apple Color Emoji',serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(r.cargo, xy[0], xy[1] + 0.5);
    }

    function render() {
      ctx.clearRect(0, 0, width, height);
      // sphere
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = oceanGradient(); ctx.fill();
      // graticule
      ctx.beginPath(); path(graticule); ctx.strokeStyle = "rgba(211,255,245,.18)"; ctx.lineWidth = 0.6; ctx.stroke();
      // land
      ctx.beginPath(); path(land); ctx.fillStyle = "rgba(8,49,45,.55)"; ctx.fill();
      // africa highlight
      ctx.beginPath(); path(africa);
      ctx.fillStyle = "rgba(245,158,11,.92)"; ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 0.4; ctx.stroke();
      // specular highlight
      var c = [width / 2, height / 2], rr = projection.scale();
      var hl = ctx.createRadialGradient(c[0] - rr * 0.4, c[1] - rr * 0.45, 0, c[0] - rr * 0.4, c[1] - rr * 0.45, rr * 0.9);
      hl.addColorStop(0, "rgba(255,255,255,.18)"); hl.addColorStop(1, "rgba(255,255,255,0)");
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = hl; ctx.fill();
      // rim
      ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = "rgba(6,48,44,.5)"; ctx.lineWidth = 1.4; ctx.stroke();
      // routes
      routes.forEach(drawArc);
    }

    // ---- rotation: gentle auto-sway that keeps Africa in view, plus drag ----
    var BASE_LON = -16, BASE_LAT = -6, AMP = 16; // sway keeps all of Africa visible
    var mode = "auto", phase = 0, dragging = false, last = null;
    function toEvt(e) { return e.touches ? e.touches[0] : e; }
    function down(e) { dragging = true; mode = "drag"; last = toEvt(e); canvas.style.cursor = "grabbing"; e.preventDefault(); }
    function move(e) {
      if (!dragging) return;
      var p = toEvt(e), k = 0.34;
      var rot = projection.rotate();
      rot[0] += (p.clientX - last.clientX) * k;
      rot[1] -= (p.clientY - last.clientY) * k;
      rot[1] = Math.max(-90, Math.min(90, rot[1]));
      projection.rotate(rot);
      last = p; render(); e.preventDefault();
    }
    function up() { if (!dragging) return; dragging = false; mode = "return"; canvas.style.cursor = "grab"; }
    canvas.style.cursor = "grab";
    canvas.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    canvas.addEventListener("touchstart", down, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);

    var lastT = Date.now();
    function tick() {
      var now = Date.now(), dt = now - lastT; lastT = now;
      if (mode === "auto" && !reduce) {
        phase += dt * 0.00034;
        projection.rotate([BASE_LON + AMP * Math.sin(phase), BASE_LAT + 3 * Math.sin(phase * 0.6)]);
      } else if (mode === "return") {
        // ease the globe back until Africa is centered, then resume the sway
        var rot = projection.rotate();
        var tlon = BASE_LON + AMP * Math.sin(phase), tlat = BASE_LAT + 3 * Math.sin(phase * 0.6);
        rot[0] += (tlon - rot[0]) * 0.08; rot[1] += (tlat - rot[1]) * 0.08;
        projection.rotate(rot);
        if (Math.abs(tlon - rot[0]) < 0.4 && Math.abs(tlat - rot[1]) < 0.4) mode = "auto";
      }
      routes.forEach(function (r) { r.t += dt * 0.00018; if (r.t > 1) r.t = 0; });
      render();
      requestAnimationFrame(tick);
    }
    render();
    requestAnimationFrame(tick);
  }
})();
