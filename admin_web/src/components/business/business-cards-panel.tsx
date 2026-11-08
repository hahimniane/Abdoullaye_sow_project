"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, ExternalLink, Printer, RefreshCw, X } from "lucide-react";

import { BusinessCardFace } from "@/components/business-card-face";
import { ShareCardButton } from "@/components/business-card-snapshot";
import {
  CARD_ACCENTS,
  CARD_COLORS,
  CARD_PHOTOS,
  CARD_SERVICE_MAX,
  CARD_SERVICES_MAX,
  CARD_STYLES,
  CARD_TAGLINE_MAX,
  SHEET_CARDS,
  cardDial,
  cardTitle,
  type BusinessCardRow,
  type CardAccent,
  type CardColor,
  type CardPhoto,
  type CardSettings,
  type CardStyle,
} from "@/lib/business-card";
import {
  cardSaveReasons,
  listBusinessCards,
  saveBusinessCardSettings,
  type BusinessCardList,
} from "@/lib/business-card-client";
import { currentWebLanguage } from "@/lib/language";

/**
 * Business cards in the business console (docs/BUSINESS_CARDS.md): a card
 * for the business and one for each person on the team, to share as a link
 * or print ten to a sheet, and (for the owner) how the cards look. Staff who
 * may not see People get the business's card and their own.
 */

type Props = {
  businessId: string;
  previewMode?: boolean;
};

type Load =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; list: BusinessCardList };

const STYLE_NAMES: Record<CardStyle, string> = { classic: "Plain white", signature: "Full color" };
const PHOTO_NAMES: Record<CardPhoto, string> = { none: "No picture", car: "A car" };
const SAVE_ERRORS: Record<string, string> = {
  tagline_too_long: "The line under the name is too long.",
  services_too_many: "List six services at most.",
  service_too_long: "One of the services is too long.",
};

export function BusinessCardsPanel({ businessId, previewMode = false }: Props) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [printing, setPrinting] = useState<BusinessCardRow | null>(null);
  const [lang] = useState(() => currentWebLanguage());

  const refresh = useCallback(() => {
    if (!businessId || previewMode) return;
    setLoad({ phase: "loading" });
    listBusinessCards(businessId)
      .then((list) => setLoad({ phase: "ready", list }))
      .catch(() => setLoad({ phase: "error" }));
  }, [businessId, previewMode]);

  useEffect(refresh, [refresh]);

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Business cards</h2>
          <p>A card for the business and each person. Share the link, or print ten to a sheet.</p>
        </div>
      </header>
      {previewMode && <div className="empty-state">Cards are not shown in preview.</div>}
      {!previewMode && load.phase === "loading" && (
        <div className="empty-state">
          <RefreshCw className="spin" size={16} /> Loading…
        </div>
      )}
      {!previewMode && load.phase === "error" && (
        <div className="error-box">
          <span>The cards did not load.</span>{" "}
          <button className="secondary-button" onClick={refresh} type="button">
            Try again
          </button>
        </div>
      )}
      {!previewMode && load.phase === "ready" && (
        <>
          {load.list.canEdit && load.list.cards[0] && (
            <CardLook
              businessId={businessId}
              lang={lang}
              onSaved={(settings) =>
                setLoad({
                  phase: "ready",
                  list: {
                    ...load.list,
                    settings,
                    cards: load.list.cards.map((card) => ({ ...card, settings })),
                  },
                })
              }
              sample={load.list.cards.find((card) => card.mine) ?? load.list.cards[0]}
              settings={load.list.settings}
            />
          )}
          <div className="bcard-grid">
            {load.list.cards.map((card) => (
              <CardItem card={card} key={card.code} lang={lang} onPrint={() => setPrinting(card)} />
            ))}
          </div>
        </>
      )}
      {printing && <CardSheet card={printing} lang={lang} onClose={() => setPrinting(null)} />}
    </section>
  );
}

function CardItem({
  card,
  lang,
  onPrint,
}: {
  card: BusinessCardRow;
  lang: "en" | "fr";
  onPrint: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(card.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this link", card.link);
    }
  };
  const missingNumber = card.person && !cardDial(card.person.phone).tel;
  return (
    <article className="bcard-item">
      <div className="bcard-item-head">
        <b data-no-translate>{cardTitle(card)}</b>
        <small>{card.person ? (card.mine ? "Your card" : "Team card") : "The business's card"}</small>
      </div>
      <BusinessCardFace card={card} lang={lang} side={1} />
      {missingNumber && <small>No phone number on this account yet, so the card shows the office number only.</small>}
      <div className="bcard-item-acts">
        <ShareCardButton card={card} lang={lang} />
        <button className="secondary-button" onClick={copy} type="button">
          {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
          {copied ? "Link copied" : "Copy link"}
        </button>
        <a className="secondary-button" href={card.link} rel="noopener noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" size={16} /> Open card
        </a>
        <button className="secondary-button" onClick={onPrint} type="button">
          <Printer aria-hidden="true" size={16} /> Print cards
        </button>
      </div>
    </article>
  );
}

/** How the business's cards look: the owner's choices, with a live preview of both sides. */
function CardLook({
  businessId,
  settings,
  sample,
  lang,
  onSaved,
}: {
  businessId: string;
  settings: CardSettings;
  sample: BusinessCardRow;
  lang: "en" | "fr";
  onSaved: (settings: CardSettings) => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [services, setServices] = useState(settings.services.join("\n"));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const lines = services.split("\n").map((line) => line.trim()).filter(Boolean);
  const next: CardSettings = { ...draft, services: lines.slice(0, CARD_SERVICES_MAX) };
  const preview = { ...sample, settings: next };
  const signature = draft.style === "signature";
  const set = (patch: Partial<CardSettings>) => {
    setDraft({ ...draft, ...patch });
    setMessage(null);
  };

  const save = async () => {
    if (lines.length > CARD_SERVICES_MAX) {
      setMessage({ ok: false, text: SAVE_ERRORS.services_too_many });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const saved = await saveBusinessCardSettings(businessId, { ...draft, services: lines });
      setDraft(saved);
      setServices(saved.services.join("\n"));
      onSaved(saved);
      setMessage({ ok: true, text: "Card saved." });
    } catch (error) {
      const reason = cardSaveReasons(error).find((code) => SAVE_ERRORS[code]);
      setMessage({ ok: false, text: reason ? SAVE_ERRORS[reason] : "The card was not saved." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bcard-settings">
      <h3>How your cards look</h3>
      <div className="bcard-preview">
        <BusinessCardFace card={preview} lang={lang} side={1} />
        <BusinessCardFace card={preview} lang={lang} side={2} />
      </div>
      <div className="bcard-settings-grid">
        <label className="bcard-field">
          <span>Style</span>
          <select onChange={(event) => set({ style: event.target.value as CardStyle })} value={draft.style}>
            {CARD_STYLES.map((style) => (
              <option key={style} value={style}>
                {STYLE_NAMES[style]}
              </option>
            ))}
          </select>
        </label>
        <div className="bcard-field">
          <span>Main color</span>
          <div className="bcard-swatches">
            {(Object.keys(CARD_COLORS) as CardColor[]).map((color) => (
              <button
                aria-label={color}
                aria-pressed={draft.color === color}
                className="bcard-swatch"
                data-no-translate
                key={color}
                onClick={() => set({ color })}
                style={{ background: CARD_COLORS[color] }}
                type="button"
              />
            ))}
          </div>
        </div>
        {signature && (
          <div className="bcard-field">
            <span>Second color</span>
            <div className="bcard-swatches">
              {(Object.keys(CARD_ACCENTS) as CardAccent[]).map((accent) => (
                <button
                  aria-label={accent}
                  aria-pressed={draft.accent === accent}
                  className="bcard-swatch"
                  data-no-translate
                  key={accent}
                  onClick={() => set({ accent })}
                  style={{ background: CARD_ACCENTS[accent] }}
                  type="button"
                />
              ))}
            </div>
          </div>
        )}
        {signature && (
          <label className="bcard-field">
            <span>Picture</span>
            <select onChange={(event) => set({ photo: event.target.value as CardPhoto })} value={draft.photo}>
              {CARD_PHOTOS.map((photo) => (
                <option key={photo} value={photo}>
                  {PHOTO_NAMES[photo]}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="bcard-field">
          <span>Line under the name</span>
          <input
            maxLength={CARD_TAGLINE_MAX}
            onChange={(event) => set({ tagline: event.target.value })}
            placeholder="Car sales · Parking · Shipping"
            type="text"
            value={draft.tagline}
          />
          <small>Leave empty to use your services.</small>
        </label>
        {signature && (
          <label className="bcard-field">
            <span>Services on the back</span>
            <textarea
              maxLength={(CARD_SERVICE_MAX + 1) * (CARD_SERVICES_MAX + 2)}
              onChange={(event) => {
                setServices(event.target.value);
                setMessage(null);
              }}
              rows={6}
              value={services}
            />
            <small>One per line, six at most.</small>
          </label>
        )}
      </div>
      <div className="bcard-item-acts">
        <button className="primary-button" disabled={saving} onClick={save} type="button">
          {saving ? "Saving…" : "Save card"}
        </button>
        {message && (
          <span className={message.ok ? "bcard-saved" : "error-box"} role="status">
            {message.text}
          </span>
        )}
      </div>
    </div>
  );
}

/** Cut marks for a sheet: a short line in the margin at every cutting line. */
function CutMarks() {
  const xs = [0.75, 4.25, 7.75];
  const ys = [0.5, 2.5, 4.5, 6.5, 8.5, 10.5];
  return (
    <>
      {xs.flatMap((x) =>
        [0.3, 10.58].map((y) => (
          <span
            aria-hidden="true"
            className="bcard-cut"
            key={`v${x}-${y}`}
            style={{ height: "0.12in", left: `${x}in`, top: `${y}in`, width: 1 }}
          />
        )),
      )}
      {ys.flatMap((y) =>
        [0.55, 7.83].map((x) => (
          <span
            aria-hidden="true"
            className="bcard-cut"
            key={`h${x}-${y}`}
            style={{ height: 1, left: `${x}in`, top: `${y}in`, width: "0.12in" }}
          />
        )),
      )}
    </>
  );
}

/**
 * The print sheet: ten of one card on US Letter, side 1 on the first page
 * and side 2 on the second, each card in the same place so a sheet printed
 * on both sides lines up. Shown over the console; while it is open, printing
 * the page prints only the sheet (globals.css `body.bcard-printing`).
 */
function CardSheet({
  card,
  lang,
  onClose,
}: {
  card: BusinessCardRow;
  lang: "en" | "fr";
  onClose: () => void;
}) {
  useEffect(() => {
    document.body.classList.add("bcard-printing");
    return () => document.body.classList.remove("bcard-printing");
  }, []);
  const slots = Array.from({ length: SHEET_CARDS }, (_, index) => index);
  return createPortal(
    <div aria-label="Print sheet" aria-modal="true" className="bcard-sheet-root" role="dialog">
      {/* The paper size applies only while the sheet is open. */}
      <style>{"@page { size: letter; margin: 0; }"}</style>
      <div className="bcard-sheet-bar">
        <p>Print at 100% on Letter paper, both sides, then cut along the marks.</p>
        <div>
          <button className="primary-button" onClick={() => window.print()} type="button">
            <Printer aria-hidden="true" size={16} /> Print
          </button>
          <button className="secondary-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={16} /> Close
          </button>
        </div>
      </div>
      {([1, 2] as const).map((side) => (
        <div className="bcard-sheet-page" key={side}>
          <CutMarks />
          <div className="bcard-sheet-grid">
            {slots.map((slot) => (
              <BusinessCardFace card={card} key={slot} lang={lang} print side={side} />
            ))}
          </div>
        </div>
      ))}
    </div>,
    document.body,
  );
}
