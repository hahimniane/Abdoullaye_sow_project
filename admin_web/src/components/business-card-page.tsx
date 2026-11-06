"use client";

import { useEffect, useState } from "react";
import { ChevronRight, MessageCircle, Phone, UserPlus } from "lucide-react";

import { BusinessCardFace } from "@/components/business-card-face";
import {
  cardCodeFromLocation,
  cardDial,
  cardTitle,
  vcardFileName,
  vcardText,
  websiteHref,
  websiteLabel,
  type BusinessCardData,
} from "@/lib/business-card";
import { fetchBusinessCard } from "@/lib/business-card-client";
import { currentWebLanguage } from "@/lib/language";
import { requestLink } from "@/lib/package-requests";

/**
 * Where a phone lands when it scans a business card
 * (`https://laawoldigital.com/c/<code>`, docs/BUSINESS_CARDS.md). No sign-in
 * and no app: the card, Save contact, a call and a WhatsApp button for each
 * number, and the ways to do business with the shop. The card is read fresh
 * on every visit, so it is right even on a card printed long ago; when the
 * person has left the business, the same code shows the business alone.
 */

type State =
  | { phase: "loading" }
  | { phase: "missing" }
  | { phase: "error" }
  | { phase: "ready"; card: BusinessCardData };

const SHIPPING = ["barrelShipping", "sharedBarrels", "freight"];

export function BusinessCardPage() {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [side, setSide] = useState<1 | 2>(1);
  const [lang] = useState(() => currentWebLanguage());

  useEffect(() => {
    let live = true;
    const code = cardCodeFromLocation(window.location.pathname, window.location.search);
    if (!code) {
      setState({ phase: "missing" });
      return;
    }
    fetchBusinessCard(code)
      .then((card) => {
        if (live) setState(card ? { phase: "ready", card } : { phase: "missing" });
      })
      .catch(() => {
        if (live) setState({ phase: "error" });
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="customer-entry-shell">
      {/* No header: on a phone the card itself is the top of the page. */}
      <main className="customer-entry-main">
        <div className="bcard-page">
          {state.phase === "loading" && (
            <section className="panel">
              <p className="bcard-list-label">Opening the card…</p>
            </section>
          )}
          {state.phase === "missing" && (
            <section aria-labelledby="bcard-missing" className="panel" style={{ padding: 16 }}>
              <h1 id="bcard-missing">This card is not in use</h1>
              <p>Check the code on the card, or ask the business for a new one.</p>
            </section>
          )}
          {state.phase === "error" && (
            <section aria-labelledby="bcard-error" className="panel" style={{ padding: 16 }}>
              <h1 id="bcard-error">The card did not open</h1>
              <p>Check your connection and try again.</p>
              <button className="primary-button" onClick={() => window.location.reload()} type="button">
                Try again
              </button>
            </section>
          )}
          {state.phase === "ready" && (
            <Card card={state.card} lang={lang} onFlip={() => setSide(side === 1 ? 2 : 1)} side={side} />
          )}
          <p className="bcard-foot">
            <a href="https://laawoldigital.com">Get your own card with Laawol</a>
          </p>
        </div>
      </main>
    </div>
  );
}

function saveContact(card: BusinessCardData) {
  const url = URL.createObjectURL(new Blob([vcardText(card)], { type: "text/vcard;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = vcardFileName(card);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // The phone reads the file after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function DialRow({ name, phone }: { name: string; phone: string }) {
  const dial = cardDial(phone);
  if (!dial.tel) return null;
  return (
    <div className="bcard-row">
      <div>
        <b data-no-translate>{name}</b>
        <small data-no-translate>{dial.display}</small>
      </div>
      <div className="bcard-acts">
        <a aria-label="Call" className="bcard-ic" href={dial.tel}>
          <Phone aria-hidden="true" size={20} />
        </a>
        {dial.whatsApp && (
          <a
            aria-label="Message on WhatsApp"
            className="bcard-ic"
            href={dial.whatsApp}
            rel="noopener noreferrer"
            target="_blank"
          >
            <MessageCircle aria-hidden="true" size={20} />
          </a>
        )}
      </div>
    </div>
  );
}

function LinkRow({ href, label, detail }: { href: string; label: string; detail?: string }) {
  return (
    <a className="bcard-row" href={href}>
      <div>
        <b>{label}</b>
        {detail && <small data-no-translate>{detail}</small>}
      </div>
      <ChevronRight aria-hidden="true" size={18} />
    </a>
  );
}

function Card({
  card,
  lang,
  side,
  onFlip,
}: {
  card: BusinessCardData;
  lang: "en" | "fr";
  side: 1 | 2;
  onFlip: () => void;
}) {
  const { person, business } = card;
  const ships = SHIPPING.some((id) => business.services.includes(id));
  const site = websiteHref(business.website);
  const sameNumber = person ? cardDial(person.phone).tel === cardDial(business.phone).tel : false;
  return (
    <>
      <h1 className="sr-only" data-no-translate>
        {cardTitle(card)}
      </h1>
      <BusinessCardFace card={card} lang={lang} side={side} />
      <button className="bcard-flip" onClick={onFlip} type="button">
        Turn the card over
      </button>
      <button className="primary-button" onClick={() => saveContact(card)} type="button">
        <UserPlus aria-hidden="true" size={20} /> Save contact
      </button>
      <section className="panel">
        <h2 className="bcard-list-label">Call or message</h2>
        {person && <DialRow name={person.name} phone={person.phone} />}
        {!sameNumber && <DialRow name={business.name} phone={business.phone} />}
      </section>
      {(business.requestSlug || ships || site) && (
        <section className="panel">
          <h2 className="bcard-list-label">Do business with us</h2>
          {business.requestSlug && (
            <LinkRow href={requestLink(business.requestSlug)} label="Send a package and see prices" />
          )}
          {ships && <LinkRow href="/?service=tracking" label="Track a package" />}
          {site && <LinkRow detail={websiteLabel(business.website)} href={site} label="Visit the website" />}
        </section>
      )}
    </>
  );
}
