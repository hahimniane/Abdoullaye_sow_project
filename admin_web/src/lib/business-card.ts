/**
 * Business cards (docs/BUSINESS_CARDS.md): everything about a card that is
 * not a drawing. Every business and each person on its team has one card,
 * known by a short code; the printed QR carries `laawoldigital.com/c/<code>`
 * and the page it opens reads the card fresh from the server, so a changed
 * number is right on every card already printed.
 *
 * The server's half is `my_flutter_app/functions/business_cards.js`; the
 * choices a business may make (styles, colors, accents, pictures, limits)
 * are mirrored here and `business-card.test.ts` fails when the two drift.
 *
 * Pure: no React, no Firebase, so the tests run it directly.
 */

import qrcode from "qrcode-generator";

// ---------------------------------------------------------------------------
// What a business may choose (mirrors business_cards.js).
// ---------------------------------------------------------------------------

export const CARD_STYLES = ["classic", "signature"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

/**
 * The business's main color. Fixed, not free-form: each one passes 4.5:1 as
 * text on white and under white text, so no business can pick a card nobody
 * can read.
 */
export const CARD_COLORS = {
  laawol: "#0b3b38",
  teal: "#0f766e",
  indigo: "#3730a3",
  forest: "#166534",
  burgundy: "#881337",
  saffron: "#b45309",
  charcoal: "#1f2937",
  ocean: "#075985",
  plum: "#6b21a8",
  navy: "#0a214a",
} as const;
export type CardColor = keyof typeof CARD_COLORS;

/** The second color of the signature card (its curves and icon tiles). */
export const CARD_ACCENTS = {
  red: "#cf1026",
  amber: "#b45309",
  teal: "#0d9488",
  blue: "#1d4ed8",
} as const;
export type CardAccent = keyof typeof CARD_ACCENTS;

/** A stock picture on the signature card; the files are in `public/card-art`. */
export const CARD_PHOTOS = ["none", "car"] as const;
export type CardPhoto = (typeof CARD_PHOTOS)[number];

export const CARD_TAGLINE_MAX = 60;
export const CARD_SERVICE_MAX = 40;
export const CARD_SERVICES_MAX = 6;

export type CardSettings = {
  style: CardStyle;
  color: CardColor;
  accent: CardAccent;
  photo: CardPhoto;
  tagline: string;
  services: string[];
};

export const DEFAULT_CARD_SETTINGS: CardSettings = {
  style: "classic",
  color: "laawol",
  accent: "red",
  photo: "none",
  tagline: "",
  services: [],
};

export type CardBusiness = {
  businessId: string;
  name: string;
  phone: string;
  website: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  logoUrl: string;
  requestSlug: string;
  services: string[];
};

/** One of a person's extra numbers (docs/BUSINESS_CARDS.md §7): a label as typed ("" for none) and the number. */
export type CardPhone = { label: string; phone: string };

/** At most this many extra numbers, each label at most this long (business_cards.js). */
export const CARD_EXTRA_PHONES_MAX = 3;
export const CARD_PHONE_LABEL_MAX = 20;

export type CardPerson = { name: string; phone: string; phones: CardPhone[] };

/** One card as the server answers a scan (business_cards.js publicCard). */
export type BusinessCardData = {
  code: string;
  link: string;
  person: CardPerson | null;
  business: CardBusiness;
  settings: CardSettings;
};

/** A card in the console's list: whose it is, and whether it is the viewer's. */
export type BusinessCardRow = BusinessCardData & {
  uid: string;
  mine: boolean;
  /** Whether the viewer may change this person's extra numbers (theirs, or they manage the team). */
  canEditPhones: boolean;
};

const text = (value: unknown, max: number) =>
  String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/**
 * A name as a card prints it. Many accounts were typed all in capitals or
 * all in small letters ("SAHEL AUTO SALES", "awa camara"); a card
 * gives each word its capital. A name typed with its own mix of cases
 * ("DHL Express", "McDonald") is the owner's choice and is left alone.
 */
export function cardName(value: unknown): string {
  const name = text(value, 120);
  const letters = name.replace(/[^\p{L}]/gu, "");
  if (!letters || (letters !== letters.toLowerCase() && letters !== letters.toUpperCase())) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-'’.&/])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

/** Settings from the server, with a default for anything missing: a card always draws. */
export function readCardSettings(raw: unknown): CardSettings {
  const source = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    style: oneOf(source.style, CARD_STYLES, DEFAULT_CARD_SETTINGS.style),
    color: oneOf(source.color, Object.keys(CARD_COLORS) as CardColor[], DEFAULT_CARD_SETTINGS.color),
    accent: oneOf(source.accent, Object.keys(CARD_ACCENTS) as CardAccent[], DEFAULT_CARD_SETTINGS.accent),
    photo: oneOf(source.photo, CARD_PHOTOS, DEFAULT_CARD_SETTINGS.photo),
    tagline: text(source.tagline, CARD_TAGLINE_MAX),
    services: (Array.isArray(source.services) ? source.services : [])
      .map((line) => text(line, CARD_SERVICE_MAX))
      .filter(Boolean)
      .slice(0, CARD_SERVICES_MAX),
  };
}

/** A person's extra numbers from the server; anything that is not one is left out. */
export function readCardPhones(raw: unknown): CardPhone[] {
  return (Array.isArray(raw) ? raw : [])
    .map((row) => {
      const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
      return { label: text(r.label, CARD_PHONE_LABEL_MAX), phone: text(r.phone, 40) };
    })
    .filter((row) => row.phone)
    .slice(0, CARD_EXTRA_PHONES_MAX);
}

/** A card from the server, or null when the answer is not one. */
export function readBusinessCard(raw: unknown): BusinessCardData | null {
  const source = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  const code = normalizeCardCode(source?.code);
  const b = (source?.business && typeof source.business === "object" ? source.business : null) as
    | Record<string, unknown>
    | null;
  if (!source || !code || !b) return null;
  const p = (source.person && typeof source.person === "object" ? source.person : null) as
    | Record<string, unknown>
    | null;
  const name = cardName(p?.name);
  return {
    code,
    link: cardLink(code),
    person: name ? { name, phone: text(p?.phone, 40), phones: readCardPhones(p?.phones) } : null,
    business: {
      businessId: text(b.businessId, 120),
      name: cardName(b.name),
      phone: text(b.phone, 40),
      website: text(b.website, 120),
      // An address typed in small letters ("1739 washington ave") gets its
      // capitals too; the state and the postal code are left as typed.
      addressLine1: cardName(b.addressLine1),
      city: cardName(b.city),
      state: text(b.state, 40),
      postalCode: text(b.postalCode, 20),
      logoUrl: text(b.logoUrl, 600),
      requestSlug: text(b.requestSlug, 60),
      services: (Array.isArray(b.services) ? b.services : []).map((s) => text(s, 40)).filter(Boolean),
    },
    settings: readCardSettings(source.settings),
  };
}

// ---------------------------------------------------------------------------
// Codes and links.
// ---------------------------------------------------------------------------

/** What a printed QR opens. Never change it: printed cards are forever. */
export const CARD_LINK_BASE = "https://laawoldigital.com/c/";

const CODE = /^[23456789BCDFGHJKMNPQRSTVWXYZ]{8}$/;
const CODE_PATH = /^\/c\/([A-Za-z0-9]{8})\/?$/;

/** A code as typed or scanned, in the stored form; "" when it is not one. */
export function normalizeCardCode(input: unknown): string {
  const code = String(input ?? "").trim().toUpperCase();
  return CODE.test(code) ? code : "";
}

export function cardLink(code: string): string {
  return `${CARD_LINK_BASE}${normalizeCardCode(code)}`;
}

/** The code of `/c/<code>` (or `?c=`), or "". */
export function cardCodeFromLocation(pathname: string, search: string): string {
  const match = CODE_PATH.exec(String(pathname ?? ""));
  if (match) return normalizeCardCode(match[1]);
  return normalizeCardCode(new URLSearchParams(search).get("c"));
}

/**
 * The embed form of the card page (`&embed=1`): only the card, for the
 * Laawol app's "My card" screen to show in a WebView. `lang` is the app's
 * language (`&lang=fr|en`), or null when the link names none (the page then
 * follows its usual language choice).
 */
export type CardEmbed = { embed: boolean; lang: "en" | "fr" | null };

export function cardEmbedFromSearch(search: string): CardEmbed {
  const query = new URLSearchParams(search);
  const embed = query.get("embed") === "1";
  const lang = String(query.get("lang") ?? "").trim().toLowerCase();
  return { embed, lang: embed && (lang === "en" || lang === "fr") ? lang : null };
}

/** The app's WebView channel the embed tells "ready" or "error" on (`LaawolCard.postMessage`). */
export const CARD_EMBED_CHANNEL = "LaawolCard";

/**
 * What the embed tells the app: the card is painted ("ready") or missing
 * ("error"); and, when the app asks for the card as a picture by calling
 * `window[CARD_EMBED_IMAGE_FN]()`, `image:<base64 JPEG>` or "image-error".
 */
export type CardEmbedMessage = "ready" | "error" | "image-error" | `image:${string}`;

/** The function the embed puts on `window` for the app's Share button. */
export const CARD_EMBED_IMAGE_FN = "laawolCardImage";

/** Tells the app the embed's state; a no-op in a normal browser. */
export function tellCardEmbedHost(message: CardEmbedMessage): void {
  try {
    const host = (window as unknown as Record<string, { postMessage?: (m: string) => void } | undefined>)[
      CARD_EMBED_CHANNEL
    ];
    host?.postMessage?.(message);
  } catch {
    // No app around the page: nothing to tell.
  }
}

/** The "Turn the card over" button's words, for the embed (which names its own language). */
export function cardFlipLabel(lang: "en" | "fr"): string {
  return lang === "fr" ? "Retourner la carte" : "Turn the card over";
}

/** `/c/<code>` on a host that did not rewrite it: the same page in its query form, or "". */
export function cardPathRedirect(pathname: string): string {
  const match = CODE_PATH.exec(String(pathname ?? ""));
  const code = match ? normalizeCardCode(match[1]) : "";
  return code ? `/?service=business-card&c=${code}` : "";
}

// ---------------------------------------------------------------------------
// Phones.
// ---------------------------------------------------------------------------

export type CardDial = {
  /** As printed: `(347) 555-0142` for a US number, the number as typed otherwise. */
  display: string;
  /** `tel:` link, or null when there is nothing to dial. */
  tel: string | null;
  /** `https://wa.me/...`, or null when the country is not known. */
  whatsApp: string | null;
};

/**
 * A phone number for a card. Most Laawol businesses are in the United States
 * and many numbers were typed without a country code, so ten bare digits are
 * read as a US number; anything else needs its "+" to get a WhatsApp link,
 * because a chat opened on a guessed country reaches a stranger.
 */
export function cardDial(phone: unknown): CardDial {
  const typed = text(phone, 40);
  const digits = typed.replace(/\D/g, "");
  if (digits.length < 5) return { display: "", tel: null, whatsApp: null };
  const plus = typed.startsWith("+");
  // "+1 1347..." is a US number whose country code was typed twice: no US
  // area code starts with 1, so it can be nothing else.
  const doubled = plus && digits.length === 12 && digits.startsWith("11");
  const us =
    (!plus && digits.length === 10) || (digits.length === 11 && digits.startsWith("1")) || doubled
      ? digits.slice(-10)
      : "";
  if (us) {
    return {
      display: `(${us.slice(0, 3)}) ${us.slice(3, 6)}-${us.slice(6)}`,
      tel: `tel:+1${us}`,
      whatsApp: `https://wa.me/1${us}`,
    };
  }
  const international = plus && /^[1-9]\d{7,14}$/.test(digits);
  return {
    display: typed,
    tel: `tel:${plus ? "+" : ""}${digits}`,
    whatsApp: international ? `https://wa.me/${digits}` : null,
  };
}

// ---------------------------------------------------------------------------
// What the card says.
// ---------------------------------------------------------------------------

export type CardLang = "en" | "fr";

/** The words a business's switched-on services put on its card, in the order a card lists them. */
const SERVICE_WORDS: Array<{ services: string[]; tag: Record<CardLang, string>; line: Record<CardLang, string> }> = [
  {
    services: ["carSales"],
    tag: { en: "Car sales", fr: "Vente de voitures" },
    line: { en: "Buy and sell cars", fr: "Achat et vente de voitures" },
  },
  {
    services: ["carParking"],
    tag: { en: "Parking", fr: "Stationnement" },
    line: { en: "Car parking", fr: "Stationnement de voitures" },
  },
  {
    services: ["barrelShipping", "sharedBarrels", "freight"],
    tag: { en: "Shipping", fr: "Expédition" },
    line: { en: "Package and barrel shipping", fr: "Expédition de colis et de barils" },
  },
  {
    services: ["carTransport"],
    tag: { en: "Car transport", fr: "Transport de voitures" },
    line: { en: "Car transport", fr: "Transport de voitures" },
  },
  {
    services: ["inventory"],
    tag: { en: "Shop", fr: "Boutique" },
    line: { en: "Shop", fr: "Boutique" },
  },
];

const wordsFor = (services: string[], kind: "tag" | "line", lang: CardLang) =>
  SERVICE_WORDS.filter((entry) => entry.services.some((id) => services.includes(id))).map(
    (entry) => entry[kind][lang],
  );

/** The line under the business's name: what the owner wrote, else its services in a few words. */
export function cardTagline(card: BusinessCardData, lang: CardLang): string {
  return card.settings.tagline || wordsFor(card.business.services, "tag", lang).slice(0, 3).join(" · ");
}

/** The services listed on the signature card: what the owner wrote, else what is switched on. */
export function cardServiceLines(card: BusinessCardData, lang: CardLang): string[] {
  const written = card.settings.services;
  return (written.length ? written : wordsFor(card.business.services, "line", lang)).slice(
    0,
    CARD_SERVICES_MAX,
  );
}

export type CardServiceIcon = "car" | "parking" | "ship" | "package" | "plane" | "globe";

/**
 * The little picture beside a service line on the signature card, read from
 * the line's own words (English or French) since the owner may write
 * anything. The order matters: "Car parking" is parking, "Package shipping by
 * container" a package, "Vehicle shipping by container" a ship.
 */
export function cardServiceIcon(line: string): CardServiceIcon {
  const words = line.toLowerCase();
  if (/\b(air|plane|flight|avion|a[eé]rien)/.test(words)) return "plane";
  if (/(package|parcel|box|barrel|colis|carton|baril)/.test(words)) return "package";
  if (/(ship|container|freight|exp[eé]di|conteneur|fret|maritime)/.test(words)) return "ship";
  if (/(park|stationnement)/.test(words)) return "parking";
  if (/(car|auto|vehicle|voiture|v[eé]hicule)/.test(words)) return "car";
  return "globe";
}

/** `sahelauto.example` from whatever was typed as the website. */
export function websiteLabel(website: string): string {
  return text(website, 120)
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

/** A link for the website, or null when it is not a web address. */
export function websiteHref(website: string): string | null {
  const label = websiteLabel(website);
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(label) ? `https://${label}` : null;
}

/** `12 Example Ave, Bronx, NY 10457`, from the parts the business filled in. */
export function cardAddress(business: CardBusiness): string {
  const region = [business.state, business.postalCode].filter(Boolean).join(" ");
  return [business.addressLine1, business.city, region].filter(Boolean).join(", ");
}

/** Whose card this is, in a few words: the person, else the business. */
export function cardTitle(card: BusinessCardData): string {
  return card.person?.name || card.business.name;
}

/** Up to two letters for a business with no logo. */
export function cardInitials(name: string): string {
  return text(name, 80)
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

/** The picture a signature card shows, or null. */
export function cardPhotoSrc(photo: CardPhoto): string | null {
  return photo === "car" ? "/card-art/car.png" : null;
}

// ---------------------------------------------------------------------------
// Save contact (vCard 3.0).
// ---------------------------------------------------------------------------

const vEscape = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");

/**
 * The contact file "Save contact" hands to the phone. The person's own
 * number is the mobile, the business's is work; a business's own card is
 * saved as a company.
 */
export function vcardText(card: BusinessCardData): string {
  const { person, business } = card;
  const lines = ["BEGIN:VCARD", "VERSION:3.0"];
  if (person) {
    const parts = person.name.split(" ").filter(Boolean);
    const family = parts.length > 1 ? parts[parts.length - 1] : "";
    const given = parts.length > 1 ? parts.slice(0, -1).join(" ") : person.name;
    lines.push(`N:${vEscape(family)};${vEscape(given)};;;`, `FN:${vEscape(person.name)}`);
  } else {
    lines.push("N:;;;;", `FN:${vEscape(business.name)}`, "X-ABShowAs:COMPANY");
  }
  if (business.name) lines.push(`ORG:${vEscape(business.name)}`);
  const direct = person ? cardDial(person.phone).tel : null;
  const office = cardDial(business.phone).tel;
  if (direct) lines.push(`TEL;TYPE=CELL:${direct.slice(4)}`);
  const seen = new Set([direct, office]);
  for (const row of person?.phones ?? []) {
    const tel = cardDial(row.phone).tel;
    if (!tel || seen.has(tel)) continue;
    seen.add(tel);
    // The label rides as the number's type, so Contacts shows "WhatsApp".
    const type = row.label.replace(/[\\;:,"\r\n]+/g, " ").replace(/\s+/g, " ").trim();
    lines.push(`TEL;TYPE=${type ? `"${type}"` : "VOICE"}:${tel.slice(4)}`);
  }
  if (office && office !== direct) lines.push(`TEL;TYPE=WORK:${office.slice(4)}`);
  const site = websiteHref(business.website);
  if (site) lines.push(`URL:${site}`);
  if (business.addressLine1 || business.city) {
    lines.push(
      `ADR;TYPE=WORK:;;${vEscape(business.addressLine1)};${vEscape(business.city)};` +
        `${vEscape(business.state)};${vEscape(business.postalCode)};`,
    );
  }
  lines.push(`NOTE:${vEscape(card.link)}`, "END:VCARD");
  return `${lines.join("\r\n")}\r\n`;
}

/** `awa-camara.vcf`. */
export function vcardFileName(card: BusinessCardData): string {
  const slug = cardTitle(card)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "contact"}.vcf`;
}

// ---------------------------------------------------------------------------
// The QR code.
// ---------------------------------------------------------------------------

export type CardQr = { size: number; path: string };

/**
 * The card's QR as one SVG path on a `size` x `size` grid, each run of dark
 * squares one rectangle. Level M: a card link is short, so the code stays
 * coarse enough to scan at card size, with room to survive a scuff.
 */
export function cardQr(link: string): CardQr {
  const code = qrcode(0, "M");
  code.addData(link, "Byte");
  code.make();
  const size = code.getModuleCount();
  let path = "";
  for (let row = 0; row < size; row++) {
    let col = 0;
    while (col < size) {
      if (!code.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < size && code.isDark(row, col)) col++;
      path += `M${start} ${row}h${col - start}v1h-${col - start}z`;
    }
  }
  return { size, path };
}

// ---------------------------------------------------------------------------
// The print sheet.
// ---------------------------------------------------------------------------

/** Ten 3.5 x 2 in cards on a US Letter sheet: two across, five down. */
export const SHEET_CARDS = 10;
