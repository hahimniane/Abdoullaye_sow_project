/**
 * A business card as a picture (docs/BUSINESS_CARDS.md, "Share as a
 * picture"): both sides of the real card, one above the other on a soft
 * background, so a chat (WhatsApp) shows the card itself, with the link in
 * the message under it.
 *
 * Pure: sizes, names and words. The drawing itself is in
 * components/business-card-snapshot.tsx, from the same BusinessCardFace the
 * page shows, so the picture can never drift from the card.
 */

import { cardTitle, type BusinessCardData, type CardLang } from "./business-card.ts";

/** The picture's layout in CSS pixels (a card is 1050 x 600, as printed at 300 dpi). */
export const CARD_IMAGE = {
  cardWidth: 1050,
  cardHeight: 600,
  /** Around the cards and between them. */
  margin: 50,
  gap: 40,
  /** Pixels per CSS pixel in the file: sharp on a phone, small enough for a chat. */
  scale: 1.5,
  background: "#eef2f5",
  type: "image/jpeg",
  quality: 0.92,
} as const;

/** The picture's size in CSS pixels: both sides stacked. */
export function cardImageSize(): { width: number; height: number } {
  const { cardWidth, cardHeight, margin, gap } = CARD_IMAGE;
  return { width: cardWidth + margin * 2, height: cardHeight * 2 + gap + margin * 2 };
}

/** `keren-auto-sales-card.jpg`: the person's (or business's) name, plain letters. */
export function cardImageFileName(card: BusinessCardData): string {
  const slug = cardTitle(card)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "business"}-card.jpg`;
}

/** The message under the picture: who it is, and the card's link (one tap saves the contact). */
export function cardShareText(card: BusinessCardData, lang: CardLang): string {
  const name = cardTitle(card);
  return lang === "fr"
    ? `Carte de visite de ${name} : ${card.link}`
    : `${name}'s business card: ${card.link}`;
}

/**
 * Where the picture reads the card's logo: the parkingDocument function,
 * which passes the business's logo through with a header that lets a page
 * draw it (storage itself does not). Straight at the function, since the
 * laawoldigital.com/d redirect carries no such header.
 */
export function cardLogoProxyUrl(code: string, projectId: string): string {
  const query = new URLSearchParams({ view: "card-logo", c: code });
  return `https://us-central1-${projectId}.cloudfunctions.net/parkingDocument?${query}`;
}

/** A see-through dot: a logo that cannot be read is left blank, never waited on. */
export const BLANK_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The base64 of a picture, without the `data:` prefix (the app's channel carries text only). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * How a share ended: the share sheet, a saved file, nothing (the person
 * closed the sheet), or "blocked": the browser wants a fresh tap because
 * making the picture took a moment, so the button asks for one more.
 */
export type CardShareResult = "shared" | "downloaded" | "cancelled" | "blocked";

/**
 * The phone's share sheet with the picture and the message where the
 * browser can share files (phones); a downloaded picture elsewhere (a
 * computer), where a chat takes the file by drag and drop.
 */
export async function shareCardImage(blob: Blob, fileName: string, text: string): Promise<CardShareResult> {
  const file = new File([blob], fileName, { type: blob.type || CARD_IMAGE.type });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === "AbortError") return "cancelled";
      if (name === "NotAllowedError") return "blocked";
      // Some browsers refuse files with text after all: fall through to the file.
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}
