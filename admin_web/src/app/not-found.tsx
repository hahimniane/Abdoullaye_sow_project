"use client";

import Link from "next/link";

import { useFrenchDomTranslation } from "@/lib/french-dom";

export default function NotFound() {
  useFrenchDomTranslation();

  return (
    <main className="app-shell">
      <section className="center-panel">
        <p className="eyebrow">Console Laawol Digital</p>
        <h1>Page introuvable</h1>
        <p>Cette page n’existe pas ou a été déplacée.</p>
        <Link className="primary-button" href="/">
          Retour à la console
        </Link>
      </section>
    </main>
  );
}
