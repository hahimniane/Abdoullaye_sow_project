"use client";

import { useId, useMemo } from "react";

import {
  CARD_ACCENTS,
  CARD_COLORS,
  cardAddress,
  cardDial,
  cardInitials,
  cardPhotoSrc,
  cardQr,
  cardServiceIcon,
  cardServiceLines,
  cardTagline,
  websiteLabel,
  type BusinessCardData,
  type CardLang,
  type CardServiceIcon,
} from "@/lib/business-card";

/**
 * One side of a business card (docs/BUSINESS_CARDS.md), drawn the same way
 * wherever a card appears: the page a scan opens, the console's list and the
 * print sheet. Every size inside is a share of the card's own width (`cqw`
 * in globals.css, `.bcard`), so the card is whatever width its parent gives
 * it and a 3.5 in card on paper is the same drawing as the big one on screen.
 *
 * Side 1 is the person (also the digital card): name, own number, the
 * business's number and the QR. Side 2 is the business. Two styles:
 * `classic`, the plain white card, and `signature`, the fuller one with the
 * business's two colors, its services and an optional picture.
 *
 * Everything printed here is the business's own data, so it is never run
 * through the French dictionary (`data-no-translate`); the few fixed words
 * come in the page's language through `lang`.
 */

const WORDS: Record<CardLang, { direct: string; office: string; scan: string; scanLong: string; qr: string }> = {
  en: {
    direct: "Direct",
    office: "Office",
    scan: "Scan to save",
    scanLong: "Scan to save contact",
    qr: "QR code that opens this card",
  },
  fr: {
    direct: "Direct",
    office: "Bureau",
    scan: "Scannez pour enregistrer",
    scanLong: "Scannez pour enregistrer",
    qr: "Code QR qui ouvre cette carte",
  },
};

type FaceProps = {
  card: BusinessCardData;
  side: 1 | 2;
  lang: CardLang;
  /** The print sheet: square corners, no shadow, no outline. */
  print?: boolean;
};

export function BusinessCardFace({ card, side, lang, print = false }: FaceProps) {
  const style = {
    "--bcard-color": CARD_COLORS[card.settings.color],
    "--bcard-accent": CARD_ACCENTS[card.settings.accent],
  } as React.CSSProperties;
  const signature = card.settings.style === "signature";
  return (
    <div
      className={`bcard${print ? " bcard-print" : ""}`}
      data-no-translate
      data-side={side}
      data-style={card.settings.style}
      style={style}
    >
      {signature ? (
        side === 1 ? <SignatureFront card={card} lang={lang} /> : <SignatureBack card={card} lang={lang} />
      ) : side === 1 ? (
        <ClassicFront card={card} lang={lang} />
      ) : (
        <ClassicBack card={card} lang={lang} />
      )}
    </div>
  );
}

function Logo({ card, className }: { card: BusinessCardData; className: string }) {
  if (card.business.logoUrl) {
    // The logo is the business's own upload, at whatever size it was saved.
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt="" className={className} src={card.business.logoUrl} />;
  }
  return (
    <span aria-hidden="true" className={`${className} bcard-initials`}>
      {cardInitials(card.business.name)}
    </span>
  );
}

function Qr({ link, label }: { link: string; label: string }) {
  const qr = useMemo(() => cardQr(link), [link]);
  return (
    <svg aria-label={label} role="img" shapeRendering="crispEdges" viewBox={`0 0 ${qr.size} ${qr.size}`}>
      <rect fill="#ffffff" height={qr.size} width={qr.size} />
      <path d={qr.path} fill="#0f172a" />
    </svg>
  );
}

/** The two numbers, the person's own first. A business's own card has only its number. */
function phoneRows(card: BusinessCardData, lang: CardLang) {
  const rows: Array<{ label: string; number: string }> = [];
  const direct = card.person ? cardDial(card.person.phone).display : "";
  const office = cardDial(card.business.phone).display;
  if (direct) rows.push({ label: WORDS[lang].direct, number: direct });
  if (office && office !== direct) rows.push({ label: WORDS[lang].office, number: office });
  return rows;
}

// ---------------------------------------------------------------------------
// Classic: the plain white card.
// ---------------------------------------------------------------------------

function ClassicFront({ card, lang }: { card: BusinessCardData; lang: CardLang }) {
  const tagline = cardTagline(card, lang);
  return (
    <div className="bcard-face bcard-front">
      <div className="bcard-left">
        <div className="bcard-brand">
          <Logo card={card} className="bcard-logo" />
          <div>
            <span className="bcard-biz">{card.business.name}</span>
            {tagline && <span className="bcard-tag">{tagline}</span>}
          </div>
        </div>
        <div>
          {card.person && <p className="bcard-name">{card.person.name}</p>}
          <dl className="bcard-phones">
            {phoneRows(card, lang).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.number}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="bcard-right">
        <span className="bcard-qr">
          <Qr label={WORDS[lang].qr} link={card.link} />
        </span>
        <span className="bcard-scan">{WORDS[lang].scan}</span>
      </div>
    </div>
  );
}

function ClassicBack({ card, lang }: { card: BusinessCardData; lang: CardLang }) {
  const tagline = cardTagline(card, lang);
  const website = websiteLabel(card.business.website);
  const address = cardAddress(card.business);
  return (
    <div className="bcard-face bcard-back">
      <Logo card={card} className="bcard-logo" />
      <div>
        <span className="bcard-biz">{card.business.name}</span>
        {tagline && <span className="bcard-tag">{tagline}</span>}
      </div>
      {website && <p className="bcard-web">{website}</p>}
      {address && <p className="bcard-addr">{address}</p>}
      <span aria-hidden="true" className="bcard-strip" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Signature: the business's two colors, its services, an optional picture.
// Drawn on a 1050 x 600 grid (1 unit = 0.0952cqw), after the layout the
// owner approved for Keren Auto Sales on 2026-11-06.
// ---------------------------------------------------------------------------

/** Text longer than its place was drawn for is set smaller, never cut. */
function fitStyle(value: string, fits: number, size: number): React.CSSProperties | undefined {
  return value.length > fits ? { fontSize: `${((size * fits) / value.length).toFixed(2)}cqw` } : undefined;
}

function SignatureFront({ card, lang }: { card: BusinessCardData; lang: CardLang }) {
  const gradient = `bcard-g-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tagline = cardTagline(card, lang);
  const photo = cardPhotoSrc(card.settings.photo);
  const ribbon = card.person?.name || websiteLabel(card.business.website) || card.business.name;
  return (
    <div className="bcard-face bcardx bcardx-front">
      <svg aria-hidden="true" className="bcardx-art" preserveAspectRatio="none" viewBox="0 0 1050 600">
        <defs>
          <linearGradient id={gradient} x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0.22" />
          </linearGradient>
        </defs>
        <path d="M738 0H1050V600H911Q1010 414 936 271Z" fill="var(--bcard-color)" />
        <path d="M738 0H1050V600H911Q1010 414 936 271Z" fill={`url(#${gradient})`} />
        <path d="M737 0H835Q933 76 1009 171" fill="none" stroke="var(--bcard-accent)" strokeWidth="22" />
        <path d="M1050 478Q953 540 854 600H1050Z" fill="var(--bcard-accent)" />
        <path d="M1050 452Q945 515 817 600" fill="none" stroke="#ffffff" strokeWidth="9" />
        <path d="M0 307H581Q600 307 590 327L562 373Q557 386 538 386H0Z" fill="var(--bcard-color)" />
        <path d="M580 310L599 310 566 390 546 390Z" fill="var(--bcard-accent)" />
        <path d="M292 32V254" stroke="var(--bcard-accent)" strokeWidth="3" />
        <path d="M40 420H550M40 506H550" stroke="#bac5d4" strokeWidth="2" />
      </svg>
      {photo && (
        // A stock picture from /public/card-art, sized by the card's own width.
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="" className="bcardx-photo" src={photo} />
      )}
      <Logo card={card} className="bcardx-logo" />
      <p className="bcardx-biz" style={fitStyle(card.business.name, 17, 5.05)}>
        {card.business.name}
      </p>
      {tagline && <p className="bcardx-tag">{tagline}</p>}
      <p className="bcardx-person" style={fitStyle(ribbon, 20, 3.71)}>
        {ribbon}
      </p>
      <dl className="bcardx-phones">
        {phoneRows(card, lang).map((row) => (
          <div key={row.label}>
            <dt>{row.label}:</dt>
            <dd>{row.number}</dd>
          </div>
        ))}
      </dl>
      <span className="bcardx-qr">
        <Qr label={WORDS[lang].qr} link={card.link} />
      </span>
      <p className="bcardx-scan">{WORDS[lang].scanLong}</p>
    </div>
  );
}

const ICONS: Record<CardServiceIcon, React.ReactNode> = {
  car: <path d="M7 34h50l-5-15H17z M8 34H4v13h56V34h-4 M18 47a6 6 0 1 0 12 0 M42 47a6 6 0 1 0 12 0" />,
  parking: (
    <>
      <rect height="54" rx="7" width="48" x="8" y="5" />
      <path d="M24 46V17h15q12 0 12 10t-12 10H24" />
    </>
  ),
  ship: <path d="M4 39h56L50 54H15z M19 39V22h27v17 M27 22V12h12v10 M4 58q7-7 14 0t14 0t14 0t14 0" />,
  package: <path d="M8 20L32 7l24 13v28L32 60 8 48z M8 20l24 14 24-14 M32 34v26 M20 13l25 14" />,
  plane: <path d="M6 31l50-19-13 20 12 7-4 7-18-4-12 16-7-2 5-19-14-1z" />,
  globe: (
    <>
      <circle cx="32" cy="32" r="25" />
      <path d="M7 32h50 M32 7c-20 17-20 33 0 50 M32 7c20 17 20 33 0 50 M32 7v50 M12 20h40 M12 44h40" />
    </>
  ),
};

function SignatureBack({ card, lang }: { card: BusinessCardData; lang: CardLang }) {
  const services = cardServiceLines(card, lang);
  const website = websiteLabel(card.business.website);
  const address = cardAddress(card.business);
  return (
    <div className="bcard-face bcardx bcardx-back">
      <svg aria-hidden="true" className="bcardx-art" preserveAspectRatio="none" viewBox="0 0 1050 600">
        <path d="M308 52V506" stroke="var(--bcard-accent)" strokeWidth="3" />
        <path d="M1050 0H764Q844 140 1050 192Z" fill="var(--bcard-color)" opacity="0.08" />
        <path d="M0 494Q460 560 1050 482V600H0Z" fill="var(--bcard-color)" />
        <path d="M0 486Q460 548 1050 470" fill="none" stroke="var(--bcard-accent)" strokeWidth="12" />
        <path d="M0 477Q460 536 1050 460" fill="none" stroke="#ffffff" strokeWidth="5" />
      </svg>
      <Logo card={card} className="bcardx-logo" />
      <ul className="bcardx-services">
        {services.map((line) => (
          <li key={line}>
            <span className="bcardx-tile">
              <svg
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3.4"
                viewBox="0 0 64 64"
              >
                {ICONS[cardServiceIcon(line)]}
              </svg>
            </span>
            <b>{line}</b>
          </li>
        ))}
      </ul>
      <p className="bcardx-foot">
        <span className="bcardx-web">{website}</span>
        <span className="bcardx-addr">{address}</span>
      </p>
    </div>
  );
}
