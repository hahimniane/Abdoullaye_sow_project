"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Share2 } from "lucide-react";

import { BusinessCardFace } from "@/components/business-card-face";
import type { BusinessCardData, CardLang } from "@/lib/business-card";
import {
  BLANK_IMAGE,
  CARD_IMAGE,
  cardImageFileName,
  cardImageSize,
  cardLogoProxyUrl,
  cardShareText,
  shareCardImage,
} from "@/lib/card-image";
import { ACTIVE_FIREBASE_CONFIG } from "@/lib/project-config";

/**
 * Draws a card as a picture (lib/card-image.ts): both sides of the same
 * BusinessCardFace the page shows, at print size, off screen, only while a
 * picture is being made.
 *
 * `capture()` always settles: the picture, or an error after
 * SNAPSHOT_TIMEOUT_MS. A second call while one is running gets the same
 * answer.
 */

const SNAPSHOT_TIMEOUT_MS = 15_000;

export function useCardSnapshot(card: BusinessCardData | null, lang: CardLang) {
  const [active, setActive] = useState(false);
  const waiting = useRef<((el: HTMLElement) => void) | null>(null);
  const running = useRef<Promise<Blob> | null>(null);

  const mount = useCallback((el: HTMLDivElement | null) => {
    if (!el || !waiting.current) return;
    const resolve = waiting.current;
    waiting.current = null;
    resolve(el);
  }, []);

  const logo = card?.business.logoUrl ? new URL(card.business.logoUrl, "https://laawoldigital.com").href : "";
  const code = card?.code ?? "";
  const capture = useCallback((): Promise<Blob> => {
    if (running.current) return running.current;
    const job = (async () => {
      let timer = 0;
      try {
        return await Promise.race([
          (async () => {
            const el = await new Promise<HTMLElement>((resolve) => {
              waiting.current = resolve;
              setActive(true);
            });
            await imagesReady(el);
            const { domToBlob } = await import("modern-screenshot");
            const { width, height } = cardImageSize();
            return await domToBlob(el, {
              width,
              height,
              scale: CARD_IMAGE.scale,
              type: CARD_IMAGE.type,
              quality: CARD_IMAGE.quality,
              backgroundColor: CARD_IMAGE.background,
              // Drawn where it is, not off screen.
              style: { position: "static", left: "0", top: "0" },
              // The card uses the phone's own fonts: nothing to download.
              font: false,
              // The logo through our own server (storage will not let a page
              // draw it); anything else (the stock photo) is on this site.
              fetchFn: (url) => (logo && url === logo ? readLogo(code) : Promise.resolve(false)),
              timeout: SNAPSHOT_TIMEOUT_MS - 1000,
            });
          })(),
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(() => reject(new Error("card picture timed out")), SNAPSHOT_TIMEOUT_MS);
          }),
        ]);
      } finally {
        window.clearTimeout(timer);
        waiting.current = null;
        running.current = null;
        setActive(false);
      }
    })();
    running.current = job;
    return job;
  }, [code, logo]);

  const node: ReactNode =
    active && card && typeof document !== "undefined"
      ? createPortal(
          <div
            aria-hidden="true"
            className="bcard-snap"
            data-no-translate
            ref={mount}
            style={{
              background: CARD_IMAGE.background,
              gap: CARD_IMAGE.gap,
              padding: CARD_IMAGE.margin,
              width: cardImageSize().width,
            }}
          >
            <BusinessCardFace card={card} lang={lang} side={1} />
            <BusinessCardFace card={card} lang={lang} side={2} />
          </div>,
          document.body,
        )
      : null;

  return { node, capture };
}

/** The card's logo as a data URL, or a blank one: a missing logo never stops the picture. */
async function readLogo(code: string): Promise<string> {
  try {
    const response = await fetch(cardLogoProxyUrl(code, ACTIVE_FIREBASE_CONFIG.projectId), {
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return BLANK_IMAGE;
    const blob = await response.blob();
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : BLANK_IMAGE);
      reader.onerror = () => resolve(BLANK_IMAGE);
      reader.readAsDataURL(blob);
    });
  } catch {
    return BLANK_IMAGE;
  }
}

/** Every picture on the card (logo, photo) loaded or failed, so none is drawn blank. */
async function imagesReady(el: HTMLElement): Promise<void> {
  const images = Array.from(el.querySelectorAll("img"));
  await Promise.all(
    images.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }),
    ),
  );
}

/**
 * "Share card": the card as a picture with its link in the message, through
 * the phone's share sheet (WhatsApp, Messages...) or, on a computer, as a
 * downloaded picture. The button says what happened and never stays busy.
 */
export function ShareCardButton({
  card,
  lang,
  className = "secondary-button",
}: {
  card: BusinessCardData;
  lang: CardLang;
  className?: string;
}) {
  const { node, capture } = useCardSnapshot(card, lang);
  const [state, setState] = useState<"idle" | "busy" | "ready" | "saved" | "failed">("idle");
  // A picture the browser would not share without a second tap.
  const ready = useRef<Blob | null>(null);
  const share = async () => {
    if (state === "busy") return;
    setState("busy");
    try {
      const blob = ready.current ?? (await capture());
      ready.current = null;
      const result = await shareCardImage(blob, cardImageFileName(card), cardShareText(card, lang));
      if (result === "blocked") ready.current = blob;
      setState(result === "blocked" ? "ready" : result === "downloaded" ? "saved" : "idle");
    } catch {
      setState("failed");
    }
  };
  const label =
    state === "busy"
      ? "Making the picture…"
      : state === "ready"
        ? "Picture ready: tap to share"
        : state === "saved"
          ? "Picture saved"
          : state === "failed"
            ? "Could not make the picture. Try again"
            : "Share card";
  return (
    <>
      <button className={className} disabled={state === "busy"} onClick={() => void share()} type="button">
        <Share2 aria-hidden="true" size={16} /> {label}
      </button>
      {node}
    </>
  );
}
