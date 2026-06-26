(function () {
  var projectId = "car-selling-flutter-app";
  var firestoreRoot =
    "https://firestore.googleapis.com/v1/projects/" +
    projectId +
    "/databases/(default)/documents";
  var defaultFeatured = {
    enabled: true,
    heading: "Featured businesses",
    subheading: "A curated group of approved partners with marketing-safe profiles.",
    maxToShow: 6,
  };

  function valueOf(field) {
    if (!field || typeof field !== "object") return undefined;
    if ("stringValue" in field) return field.stringValue;
    if ("integerValue" in field) return Number(field.integerValue);
    if ("doubleValue" in field) return Number(field.doubleValue);
    if ("booleanValue" in field) return Boolean(field.booleanValue);
    if ("timestampValue" in field) return field.timestampValue;
    if ("arrayValue" in field) {
      return (field.arrayValue.values || []).map(valueOf);
    }
    if ("mapValue" in field) return mapFields(field.mapValue.fields || {});
    return undefined;
  }

  function mapFields(fields) {
    return Object.keys(fields || {}).reduce(function (result, key) {
      result[key] = valueOf(fields[key]);
      return result;
    }, {});
  }

  function getPath(source, path) {
    return path.split(".").reduce(function (current, key) {
      return current && current[key] !== undefined ? current[key] : undefined;
    }, source);
  }

  function setText(selector, value) {
    if (value === undefined || value === null || value === "") return;
    document.querySelectorAll(selector).forEach(function (node) {
      node.textContent = String(value);
    });
  }

  function setHref(selector, value) {
    if (!value) return;
    document.querySelectorAll(selector).forEach(function (node) {
      node.setAttribute("href", String(value));
    });
  }

  function setMailtoAction(selector, value) {
    if (!value) return;
    document.querySelectorAll(selector).forEach(function (node) {
      node.setAttribute("action", "mailto:" + String(value));
    });
  }

  function setGradientHeadline(node, value) {
    var text = String(value || "").trim();
    if (!text) return;

    var punctuation = "";
    var punctuationMatch = text.match(/([.!?]+)$/);
    if (punctuationMatch) {
      punctuation = punctuationMatch[1];
      text = text.slice(0, -punctuation.length).trimEnd();
    }

    var lower = text.toLowerCase();
    var accentStart = lower.lastIndexOf("home");
    var accentText = "";
    var before = "";
    if (accentStart >= 0) {
      before = text.slice(0, accentStart);
      accentText = text.slice(accentStart, accentStart + 4);
    } else {
      var lastSpace = text.lastIndexOf(" ");
      if (lastSpace < 0) {
        before = "";
        accentText = text;
      } else {
        before = text.slice(0, lastSpace + 1);
        accentText = text.slice(lastSpace + 1);
      }
    }

    node.textContent = "";
    if (before) node.appendChild(document.createTextNode(before));
    var accent = document.createElement("span");
    accent.className = "grad";
    accent.textContent = accentText;
    node.appendChild(accent);
    if (punctuation) node.appendChild(document.createTextNode(punctuation));
  }

  function refreshAnimations() {
    if (window.LaawolAnimations && typeof window.LaawolAnimations.refresh === "function") {
      window.LaawolAnimations.refresh();
    }
  }

  function docUrl(path) {
    return firestoreRoot + "/" + path;
  }

  function readDoc(path) {
    return fetch(docUrl(path), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Could not load " + path);
      return response.json();
    }).then(function (doc) {
      return mapFields(doc.fields || {});
    });
  }

  function readFeatured(maxToShow) {
    return fetch(firestoreRoot + ":runQuery", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "featuredBusinesses" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "active" },
              op: "EQUAL",
              value: { booleanValue: true },
            },
          },
        },
      }),
    }).then(function (response) {
      if (!response.ok) throw new Error("Could not load featured businesses");
      return response.json();
    }).then(function (rows) {
      return rows
        .map(function (row) { return row.document ? mapFields(row.document.fields || {}) : null; })
        .filter(Boolean)
        .sort(function (a, b) {
          return (Number(a.order) || 0) - (Number(b.order) || 0);
        })
        .slice(0, Math.max(1, Math.min(8, Number(maxToShow) || 6)));
    });
  }

  function applyHome(home) {
    document.querySelectorAll("[data-cms]").forEach(function (node) {
      var path = node.getAttribute("data-cms") || "";
      var value = getPath(home, path);
      if (value !== undefined && value !== null && value !== "") {
        if (path === "hero.headline") {
          setGradientHeadline(node, value);
        } else {
          node.textContent = String(value);
        }
      }
    });
    setHref("[data-cms-href='hero.primaryCtaHref']", home.hero && home.hero.primaryCtaHref);
    setHref("[data-cms-href='hero.secondaryCtaHref']", home.hero && home.hero.secondaryCtaHref);
  }

  function applyContact(contact) {
    setText("[data-cms-contact='supportEmail']", contact.supportEmail);
    setText("[data-cms-contact='supportPhone']", contact.supportPhone);
    setText("[data-cms-contact='whatsapp']", contact.whatsapp);
    setText("[data-cms-contact='address']", contact.address);
    setHref("[data-cms-contact-href='supportEmail']", contact.supportEmail ? "mailto:" + contact.supportEmail : "");
    setHref("[data-cms-contact-href='supportPhone']", contact.supportPhone ? "tel:" + contact.supportPhone : "");
    setHref("[data-cms-contact-href='whatsapp']", contact.whatsapp ? "https://wa.me/" + String(contact.whatsapp).replace(/[^0-9]/g, "") : "");
    setMailtoAction("[data-cms-contact-form='supportEmail']", contact.supportEmail);
  }

  function renderFeatured(home, businesses) {
    var section = document.getElementById("featuredBusinessesSection");
    var grid = document.getElementById("featuredBusinessesGrid");
    var featured = (home && home.featured) || defaultFeatured;
    if (!section || !grid || featured.enabled === false || !businesses.length) {
      if (section) section.hidden = true;
      return;
    }
    setText("[data-cms='featured.heading']", featured.heading);
    setText("[data-cms='featured.subheading']", featured.subheading);
    grid.innerHTML = "";
    businesses.forEach(function (business) {
      var card = document.createElement("article");
      card.className = "partner-card";

      var logo = document.createElement("img");
      logo.src = business.logoUrl || "";
      logo.alt = business.displayName ? business.displayName + " logo" : "";
      logo.loading = "lazy";

      var body = document.createElement("div");
      var title = document.createElement("h3");
      title.textContent = business.displayName || "Featured business";
      var blurb = document.createElement("p");
      blurb.textContent = business.blurb || "";
      var chips = document.createElement("div");
      chips.className = "partner-chips";
      (business.services || []).slice(0, 4).forEach(function (service) {
        var chip = document.createElement("span");
        chip.textContent = String(service).replace(/([A-Z])/g, " $1").trim();
        chips.appendChild(chip);
      });

      body.appendChild(title);
      body.appendChild(blurb);
      body.appendChild(chips);
      card.appendChild(logo);
      card.appendChild(body);
      grid.appendChild(card);
    });
    section.hidden = false;
    refreshAnimations();
  }

  Promise.all([
    readDoc("websiteContent/home").catch(function () { return {}; }),
    readDoc("websiteContent/contact").catch(function () { return {}; }),
  ]).then(function (results) {
    var home = results[0] || {};
    var contact = results[1] || {};
    applyHome(home);
    applyContact(contact);
    refreshAnimations();
    var featured = home.featured || defaultFeatured;
    return readFeatured(featured.maxToShow)
      .then(function (businesses) {
        renderFeatured(home, businesses);
      })
      .catch(function () {
        renderFeatured(home, []);
      });
  }).catch(function () {
    var section = document.getElementById("featuredBusinessesSection");
    if (section) section.hidden = true;
  });
})();
