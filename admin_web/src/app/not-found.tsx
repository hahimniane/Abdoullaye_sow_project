"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { useFrenchDomTranslation } from "@/lib/french-dom-runtime";
import { requestPathRedirect } from "@/lib/package-requests";
import { staffInvitePathRedirect } from "@/lib/staff-phone-invite";

export default function NotFound() {
  useFrenchDomTranslation();
  // A package request link (/r/<slug>) or the WhatsApp estimate button
  // (/e/<token>) on a host that answers unknown paths with this page: carry
  // on to the same page in its query form instead of a dead end. A staff
  // invitation's Accept button (/j/<token>) is forwarded the same way.
  const [forwarding, setForwarding] = useState(false);
  useEffect(() => {
    const target =
      requestPathRedirect(window.location.pathname) ||
      staffInvitePathRedirect(window.location.pathname);
    if (!target) return;
    setForwarding(true);
    window.location.replace(target);
  }, []);

  if (forwarding) {
    return (
      <main className="app-shell">
        <section className="center-panel">
          <span className="loading-spinner" />
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <section className="center-panel">
        <p className="eyebrow">Laawol Digital Console</p>
        <h1>Page not found</h1>
        <p>This page does not exist or has moved.</p>
        <Link className="primary-button" href="/">
          Back to console
        </Link>
      </section>
    </main>
  );
}
