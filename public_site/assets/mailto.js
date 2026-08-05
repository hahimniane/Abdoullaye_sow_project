/* Hands email off to the visitor's mail app.

   Two jobs:

   1. The contact form declared action="mailto:..." method="post". Browsers
      largely ignore that combination - Chrome does nothing at all - so the
      Send button looked broken. We intercept the submit, build a properly
      encoded mailto: URL with a subject and body, and navigate to it, which
      is what actually opens Mail / Outlook / Gmail-as-handler.

   2. "If available" is real: a machine with no mail handler registered stays
      exactly where it is and nothing happens. We watch for the page losing
      focus - the signal that a mail app took over - and if it never does,
      we surface the address with a copy button instead of failing silently.

   Progressive enhancement: without this file the form still carries its
   original action, and every mailto: link on the site keeps working. */
(function () {
  "use strict";

  function lang() {
    return (window.LaawolI18n && window.LaawolI18n.getLang &&
      window.LaawolI18n.getLang()) === "en" ? "en" : "fr";
  }

  var T = {
    fr: {
      opening: "Ouverture de votre application e-mail…",
      noApp: "Aucune application e-mail détectée. Écrivez-nous à :",
      copy: "Copier l’adresse",
      copied: "Adresse copiée",
      subject: "Demande depuis le site Laawol",
      labels: {name: "Nom", email: "Email", service: "Service",
        destination_country: "Pays", destination_city: "Ville",
        message: "Message"},
    },
    en: {
      opening: "Opening your email app…",
      noApp: "No email app detected. Write to us at:",
      copy: "Copy address",
      copied: "Address copied",
      subject: "Enquiry from the Laawol website",
      labels: {name: "Name", email: "Email", service: "Service",
        destination_country: "Country", destination_city: "City",
        message: "Message"},
    },
  };

  // The address lives in data-mailto, NOT in action. A form whose action is
  // "mailto:" is treated by Chrome as an insecure target, which disables
  // autofill for every field on it ("This form is not secure"). Reading the
  // address from a data attribute keeps the handoff and gets autofill back.
  // The action fallback stays for any form not yet migrated.
  function addressFrom(form) {
    var direct = (form.getAttribute("data-mailto") || "").trim();
    if (direct) return direct;
    var action = form.getAttribute("action") || "";
    return action.indexOf("mailto:") === 0 ?
      action.slice(7).split("?")[0] : "";
  }

  // Composes the email body from the form's own fields, so adding a field to
  // the markup later needs no change here.
  function bodyFrom(form, L) {
    var lines = [];
    Array.prototype.forEach.call(
        form.querySelectorAll("input[name], select[name], textarea[name]"),
        function (field) {
          var value = (field.value || "").trim();
          if (!value) return;
          var label = T[L].labels[field.name] || field.name;
          lines.push(label + ": " + value);
        });
    return lines.join("\n");
  }

  function notice(form, L, address, state) {
    var box = form.querySelector(".mailto-note");
    if (!box) {
      box = document.createElement("p");
      box.className = "mailto-note";
      box.setAttribute("role", "status");
      var note = form.querySelector(".form-note");
      form.insertBefore(box, note || null);
    }
    if (state === "opening") {
      box.className = "mailto-note";
      box.textContent = T[L].opening;
      return;
    }
    box.className = "mailto-note warn";
    box.textContent = T[L].noApp + " ";
    var link = document.createElement("a");
    link.href = "mailto:" + address;
    link.textContent = address;
    box.appendChild(link);
    if (navigator.clipboard) {
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "mailto-copy";
      copy.textContent = T[L].copy;
      copy.addEventListener("click", function () {
        navigator.clipboard.writeText(address).then(function () {
          copy.textContent = T[L].copied;
        });
      });
      box.appendChild(copy);
    }
  }

  function wireForm(form) {
    if (form.dataset.mailtoWired) return;
    form.dataset.mailtoWired = "true";
    form.addEventListener("submit", function (event) {
      var address = addressFrom(form);
      if (!address) return; // not a mailto form - leave it alone
      event.preventDefault();
      if (form.checkValidity && !form.checkValidity()) {
        form.reportValidity && form.reportValidity();
        return;
      }
      var L = lang();
      var url = "mailto:" + address +
        "?subject=" + encodeURIComponent(T[L].subject) +
        "&body=" + encodeURIComponent(bodyFrom(form, L));
      notice(form, L, address, "opening");

      // A mail app taking over blurs the page; that blur is the only
      // reliable "it worked" signal. Deliberately NOT gated on
      // document.hidden - backgrounded and prerendered contexts report
      // hidden:true permanently, which silently suppressed this notice.
      var handed = false;
      function onBlur() { handed = true; }
      window.addEventListener("blur", onBlur, {once: true});
      window.setTimeout(function () {
        window.removeEventListener("blur", onBlur);
        if (!handed) notice(form, L, address, "none");
      }, 1800);

      window.location.href = url;
    });
  }

  var SELECTOR = "form[data-mailto], form[action^='mailto:']";
  function boot() {
    document.querySelectorAll(SELECTOR).forEach(wireForm);
    // content.js fills the address from the CMS after load; re-scan so a form
    // that only gains its address later is still wired.
    window.setTimeout(function () {
      document.querySelectorAll(SELECTOR).forEach(wireForm);
    }, 1200);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, {once: true});
  } else {
    boot();
  }
})();
