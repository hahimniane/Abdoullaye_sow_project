"use client";

import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { CONTAINER_MESSAGES, containerMessage } from "@/lib/container-manifest";
import { MAX_PIECES, PIECE_KINDS } from "@/lib/line-pieces";
import {
  COUNT_CONFIRM_ABOVE,
  addPieceDraft,
  countConfirmText,
  onePriceChangeNote,
  onePriceCountText,
  onePriceLabel,
  pieceDraftCount,
  pieceDraftPricedTogether,
  pieceDraftProblems,
  pieceHeading,
  pieceKindLabel,
  pieceRowSumText,
  piecesDraftCount,
  piecesDraftTotalCents,
  piecesEditorText,
  piecesTotalText,
  priceForAllLabel,
  priceTogetherText,
  readPickupFeeInput,
  removePieceDraft,
  reprintLabelsText,
  setPieceDraftCount,
  setPieceDraftPriceFor,
  updatePieceDraft,
  type PieceDraft,
  type PiecePricing,
  type PriceFor,
  onePriceCents,
} from "@/lib/piece-drafts";
import { PRICE_MODE, type PriceMode } from "@/lib/package-price-mode";

/**
 * The pieces of one package: each barrel, box or other thing handed over,
 * with what it is, an optional size and its price. Identical pieces are one
 * row with "How many", priced each or all of that row together (shared
 * among the row's own pieces when saved, never with another row's). The
 * total is the sum of the piece prices (docs/WAITING_PACKAGES.md "Pieces"). One editor for the
 * register form, the waiting-package edit, the containers panel's line form
 * and Received; the rules live in `lib/piece-drafts.ts`.
 */
export function PiecesEditor({
  id,
  pieces,
  onChange,
  showErrors,
  disabled = false,
  lang,
  pickupFee,
  onPickupFeeChange,
  priceRequired = false,
  storedCount,
  priceMode = PRICE_MODE.PIECE,
  onePrice = "",
  onOnePriceChange,
  storedPriceCents,
}: {
  /** The wrapper's element id: a refused save scrolls here. */
  id: string;
  pieces: readonly PieceDraft[];
  onChange: (next: PieceDraft[]) => void;
  /** After a refused save, each piece shows its own problem, live, until fixed. */
  showErrors: boolean;
  disabled?: boolean;
  lang: "en" | "fr";
  /**
   * A collected request's pickup fee in US dollars as typed, when the line
   * has one: its own field beside the pieces, inside the total, never spread
   * into the piece prices (owner decision 2026-10-18). Undefined: no field.
   */
  pickupFee?: string;
  onPickupFeeChange?: (value: string) => void;
  /**
   * A customer's package: every piece needs a price typed (zero is one) and
   * the pieces must come to more than $0 (docs/PACKAGE_PRICE_REQUIRED.md).
   * False for the business's own stock.
   */
  priceRequired?: boolean;
  /** Editing a saved package: how many pieces it holds now, so a change says to print the labels again. */
  storedCount?: number;
  /**
   * How the business prices a package (docs/PACKAGE_ONE_PRICE.md). `piece`
   * (the default) is a price on each row; `package` is one price for the whole
   * package: rows carry no price and no Each / All switch, and the field
   * below the rows is the only price.
   */
  priceMode?: PriceMode;
  /** The one price in US dollars as typed (`package` mode), owned by the parent form like `pickupFee`. */
  onePrice?: string;
  onOnePriceChange?: (value: string) => void;
  /** Editing a saved package in `package` mode: its price as saved, so the "you added a piece" question goes once another price is typed. */
  storedPriceCents?: number | null;
}) {
  // A "How many" being typed: blank while the number is being replaced, or a
  // large number waiting for its yes. The row keeps its last count meanwhile.
  const [typedCounts, setTypedCounts] = useState<Record<string, string>>({});
  const onePriceMode = priceMode === PRICE_MODE.PACKAGE;
  const pricing: PiecePricing | undefined = onePriceMode ? { onePrice, stored: null } : undefined;
  const problems = showErrors ? pieceDraftProblems(pieces, { priceRequired, pricing }) : { codes: [], byPiece: [] };
  const listProblems = problems.codes.filter((code) => code === "pieces_required" || code === "pieces_too_many" || (!onePriceMode && code === "package_price_required"));
  // One price for the whole package: its problems sit at its own field.
  const onePriceProblems = problems.codes.filter((code) => code === "piece_price_invalid" || code === "package_price_required");
  const onePriceErrorId = `${id}-one-price-error`;
  // Pieces that all come to $0: the package's problem, shown by every price field.
  const packagePriceMissing = !onePriceMode && problems.codes.includes("package_price_required");
  const listErrorId = `${id}-list-error`;
  const fee = pickupFee === undefined ? null : readPickupFeeInput(pickupFee);
  const total = piecesDraftTotalCents(pieces, fee?.cents ?? 0, pricing);
  const count = piecesDraftCount(pieces);
  const full = count >= MAX_PIECES;
  // A decimal comma in French; readMoneyInput reads "45,50" and "45.50" alike.
  const moneyPlaceholder = lang === "fr" ? "0,00" : "0.00";
  const t = (key: Parameters<typeof piecesEditorText>[0]) => piecesEditorText(key, lang);
  const set = (key: string, patch: Partial<Omit<PieceDraft, "key">>) => onChange(updatePieceDraft(pieces, key, patch));
  const forget = (key: string) =>
    setTypedCounts((typed) => {
      const next = { ...typed };
      delete next[key];
      return next;
    });
  const setCount = (key: string, value: number) => {
    forget(key);
    onChange(setPieceDraftCount(pieces, key, value));
  };
  // A typed number is taken when the field is left (or on Enter), never
  // digit by digit: "30" must not pass through 3. Up to 10 is taken as typed;
  // more waits for its yes (30 typed for 3 prints 30 labels); blank, zero or
  // the count it already has changes nothing.
  const typeCount = (piece: PieceDraft, raw: string) =>
    setTypedCounts((all) => ({ ...all, [piece.key]: raw.replace(/\D/g, "").slice(0, 2) }));
  const takeTypedCount = (piece: PieceDraft) => {
    const typed = typedCounts[piece.key];
    if (typed === undefined) return;
    const value = typed === "" ? 0 : Number(typed);
    if (value >= 1 && value <= COUNT_CONFIRM_ABOVE) setCount(piece.key, value);
    else if (value === 0 || value === pieceDraftCount(piece)) forget(piece.key);
  };
  // Flipping a row's price switch keeps the money: it may cut the row in two.
  const setPriceFor = (key: string, priceFor: PriceFor) => onChange(setPieceDraftPriceFor(pieces, key, priceFor));
  const countChanged = storedCount !== undefined && storedCount > 0 && storedCount !== count;
  const onePriceNote = onePriceMode ? onePriceChangeNote(storedCount, count, onePriceCents({ onePrice }), lang, storedPriceCents) : "";

  let firstNumber = 0;
  return (
    <div className="pcs-editor" id={id} tabIndex={-1}>
      <ol className="pcs-list">
        {pieces.map((piece, index) => {
          const own = problems.byPiece[index] ?? [];
          const errorId = `${id}-${index}-error`;
          const invalid = own.length > 0 ? { "aria-invalid": true, "aria-describedby": errorId } : {};
          const priceInvalid = own.some((code) => code === "piece_price_invalid" || code === "piece_price_required");
          const priceProps = priceInvalid
            ? { "aria-invalid": true, "aria-describedby": errorId }
            : packagePriceMissing
              ? { "aria-invalid": true, "aria-describedby": listErrorId }
              : {};
          const many = pieceDraftCount(piece);
          const startsAt = firstNumber;
          firstNumber += many;
          const typed = typedCounts[piece.key];
          const waiting = typed !== undefined && typed !== "" && Number(typed) !== many ? Number(typed) : 0;
          const together = pieceDraftPricedTogether(piece);
          const rowSum = pieceRowSumText(piece, lang);
          return (
            <li className="pcs-piece" key={piece.key}>
              <div className="pcs-piece-head">
                <strong data-no-translate>{pieceHeading(startsAt, lang, many)}</strong>
                <div className="service-segments pcs-kinds" role="radiogroup" aria-label="What this piece is">
                  {PIECE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      role="radio"
                      aria-checked={piece.kind === kind}
                      className={`segment${piece.kind === kind ? " active" : ""}`}
                      disabled={disabled}
                      onClick={() => set(piece.key, { kind })}
                    >
                      <span data-no-translate>{pieceKindLabel(kind, lang)}</span>
                    </button>
                  ))}
                </div>
                <button
                  className="ghost-button pcs-remove"
                  type="button"
                  disabled={disabled || pieces.length <= 1}
                  onClick={() => {
                    forget(piece.key);
                    onChange(removePieceDraft(pieces, piece.key));
                  }}
                  title="Remove this piece"
                  aria-label="Remove this piece"
                >
                  <X size={14} />
                </button>
              </div>
              <div className={`lst-form-grid pcs-fields${onePriceMode ? " pcs-fields-one" : ""}`}>
                <label className="lst-field wide">
                  <span>{piece.kind === "barrel" ? "What is in it (optional)" : piece.kind === "box" ? "What is in it" : "What it is"}</span>
                  <input
                    // Remounted when the kind changes: the French page
                    // translates new nodes, not a placeholder edited in place.
                    key={`description-${piece.kind}`}
                    {...invalid}
                    value={piece.description}
                    disabled={disabled}
                    onChange={(e) => set(piece.key, { description: e.target.value })}
                    placeholder={piece.kind === "other" ? "e.g. a TV, a generator" : "e.g. clothes, shoes"}
                  />
                </label>
                <label className="lst-field pcs-side"><span>Length (in)</span><input inputMode="decimal" value={piece.lengthIn} disabled={disabled} onChange={(e) => set(piece.key, { lengthIn: e.target.value })} placeholder="optional" /></label>
                <label className="lst-field pcs-side"><span>Width (in)</span><input inputMode="decimal" value={piece.widthIn} disabled={disabled} onChange={(e) => set(piece.key, { widthIn: e.target.value })} placeholder="optional" /></label>
                <label className="lst-field pcs-side"><span>Height (in)</span><input inputMode="decimal" value={piece.heightIn} disabled={disabled} onChange={(e) => set(piece.key, { heightIn: e.target.value })} placeholder="optional" /></label>
                <div className="lst-field pcs-count">
                  <span id={`${id}-${index}-count`} data-no-translate>{t("howMany")}</span>
                  <div className="pcs-stepper" role="group" aria-labelledby={`${id}-${index}-count`}>
                    <button type="button" className="pcs-step" disabled={disabled || many <= 1} onClick={() => setCount(piece.key, many - 1)} aria-label={t("fewer")} title={t("fewer")}>
                      <Minus size={14} />
                    </button>
                    <input
                      inputMode="numeric"
                      value={typed ?? String(many)}
                      disabled={disabled}
                      aria-labelledby={`${id}-${index}-count`}
                      onChange={(e) => typeCount(piece, e.target.value)}
                      onFocus={(e) => e.target.select()}
                      onBlur={() => takeTypedCount(piece)}
                      onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        takeTypedCount(piece);
                      }}
                    />
                    <button type="button" className="pcs-step" disabled={disabled || full} onClick={() => setCount(piece.key, many + 1)} aria-label={t("more")} title={t("more")}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                {!onePriceMode && <label className="lst-field pcs-price">
                  <span>
                    {many > 1 ? <span data-no-translate>{together ? priceForAllLabel(many, lang) : t("priceEach")}</span> : "Price ($)"}
                    {priceRequired && <i className="lst-required" aria-hidden="true"> *</i>}
                  </span>
                  <input inputMode="decimal" value={piece.price} disabled={disabled} onChange={(e) => set(piece.key, { price: e.target.value })} placeholder={moneyPlaceholder} aria-required={priceRequired || undefined} {...priceProps} />
                </label>}
              </div>
              {waiting > COUNT_CONFIRM_ABOVE && (
                <div className="pcs-confirm" role="alert">
                  <span data-no-translate>{countConfirmText(Math.min(waiting, MAX_PIECES), lang)}</span>
                  <span className="pcs-confirm-actions">
                    <button type="button" className="lst-btn" disabled={disabled} onClick={() => setCount(piece.key, waiting)}><span data-no-translate>{t("yes")}</span></button>
                    <button type="button" className="lst-btn ghost" disabled={disabled} onClick={() => forget(piece.key)}><span data-no-translate>{t("no")}</span></button>
                  </span>
                </div>
              )}
              {many > 1 && !onePriceMode && (
                <div className="pcs-price-for">
                  <div className="service-segments pcs-kinds" role="radiogroup" aria-label={t("priceForAria")}>
                    {(["each", "all"] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={together === (value === "all")}
                        className={`segment${together === (value === "all") ? " active" : ""}`}
                        disabled={disabled}
                        onClick={() => setPriceFor(piece.key, value)}
                      >
                        <span data-no-translate>{value === "all" ? priceTogetherText(many, lang) : t("each")}</span>
                      </button>
                    ))}
                  </div>
                  {rowSum && <small className="pcs-row-sum" data-no-translate>{rowSum}</small>}
                </div>
              )}
              {own.length > 0 && <small className="lst-field-error" id={errorId}>{containerMessage(own)}</small>}
            </li>
          );
        })}
      </ol>
      <div className="pcs-foot">
        <button className="lst-btn ghost" type="button" disabled={disabled || full} onClick={() => onChange(addPieceDraft(pieces))}>
          <Plus size={14} /> Add another piece
        </button>
        {/* One price: the field below is the total; a "Total" beside it would say it twice. */}
        {pickupFee === undefined && !onePriceMode && <strong className="pcs-total" data-no-translate>{piecesTotalText(total, lang)}</strong>}
      </div>
      {onePriceMode && (
        <div className="pcs-one">
          <label className="lst-field pcs-one-field" htmlFor={`${id}-one-price`}>
            <span className="pcs-one-label">
              <span data-no-translate>{onePriceLabel(lang)}</span>
              {priceRequired && <i className="lst-required" aria-hidden="true"> *</i>}
            </span>
            <small className="pcs-one-count" data-no-translate>{onePriceCountText(count, lang)}</small>
            <input
              id={`${id}-one-price`}
              inputMode="decimal"
              value={onePrice}
              disabled={disabled}
              onChange={(e) => onOnePriceChange?.(e.target.value)}
              placeholder={moneyPlaceholder}
              aria-required={priceRequired || undefined}
              {...(onePriceProblems.length > 0 ? { "aria-invalid": true, "aria-describedby": onePriceErrorId } : {})}
            />
          </label>
          {onePriceNote && <small className="pcs-one-note" role="status" data-no-translate>{onePriceNote}</small>}
          {onePriceProblems.length > 0 && <small className="lst-field-error" id={onePriceErrorId}>{containerMessage(onePriceProblems)}</small>}
        </div>
      )}
      {countChanged && <small className="pcs-note" data-no-translate>{reprintLabelsText(storedCount, count, lang)}</small>}
      {pickupFee !== undefined && (
        <div className="pcs-fee">
          <label className="lst-field pcs-price">
            <span>Pickup fee ($)</span>
            <input
              id={`${id}-pickup-fee`}
              inputMode="decimal"
              value={pickupFee}
              disabled={disabled}
              onChange={(e) => onPickupFeeChange?.(e.target.value)}
              placeholder={moneyPlaceholder}
              {...(fee?.error ? { "aria-invalid": true } : {})}
            />
          </label>
          {fee?.error && <small className="lst-field-error">{CONTAINER_MESSAGES.pickup_fee_invalid}</small>}
        </div>
      )}
      {pickupFee !== undefined && <strong className="pcs-total pcs-total-row" data-no-translate>{piecesTotalText(total, lang)}</strong>}
      {listProblems.length > 0 && <small className="lst-field-error" id={listErrorId}>{containerMessage(listProblems)}</small>}
    </div>
  );
}
