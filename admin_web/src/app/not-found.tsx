"use client";

import Link from "next/link";

import { useFrenchDomTranslation } from "@/lib/french-dom-runtime";

export default function NotFound() {
  useFrenchDomTranslation();

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
