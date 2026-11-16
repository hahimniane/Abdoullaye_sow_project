"use client";

import { useState } from "react";
import { Minus, Plus, X } from "lucide-react";

import { CONTAINER_MESSAGES, containerMessage } from "@/lib/container-manifest";
import { MAX_PIECES, PIECE_KINDS, PRICE_MODE, type PriceMode } from "@/lib/line-pieces";
import {
  COUNT_CONFIRM_ABOVE,
  addPieceDraft,
  countConfirmText,
  eachPricing,
  pieceDraftCount,
  pieceDraftProblems,
  pieceHeading,
  pieceKindLabel,
  pieceRowSumText,
  piecesDraftCount,
  piecesDraftTotalCents,
  piecesEditorText,
  piecesTotalText,
  readPickupFeeInput,
  removePieceDraft,
  reprintLabelsText,
  setPieceDraftCount,
  switchPricingMode,
  totalSplitText,
  totalStaysText,
  updatePieceDraft,
  type PieceDraft,
  type PiecesPricing,
} from "@/lib/piece-drafts";

/**
 * The pieces of one package: each barrel, box or other thing handed over,
 * with what it is, an optional size and its price. Identical pieces are one
 * row with "How many". The price is typed on each piece, or once for all of
 * them ("One price for all": spread evenly when saved). The total is the sum
 * of the piece prices (docs/WAITING_PACKAGES.md "Pieces"). One editor for the
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
  pricing,
  onPricingChange,
  storedCount,
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
  /**
   * How the package is priced, and its setter: with both, the form offers
   * "One price for all" once there are two pieces. Flipping the switch may
   * rewrite the rows (their shares of the total), so the setter takes both.
   */
  pricing?: PiecesPricing;
  onPricingChange?: (next: { pieces: PieceDraft[]; pricing: PiecesPricing }) => void;
  /** Editing a saved package: how many pieces it holds now, so a change says to print the labels again. */
  storedCount?: number;
}) {
  const mode: PiecesPricing = pricing ?? eachPricing();
  const totalMode = mode.mode === PRICE_MODE.TOTAL;
  // A "How many" being typed: blank while the number is being replaced, or a
  // large number waiting for its yes. The row keeps its last count meanwhile.
  const [typedCounts, setTypedCounts] = useState<Record<string, string>>({});
  const problems = showErrors ? pieceDraftProblems(pieces, { priceRequired, pricing: mode }) : { codes: [], byPiece: [] };
  const listProblems = problems.codes.filter((code) => code === "pieces_required" || code === "pieces_too_many" || code === "package_price_required");
  // Pieces that all come to $0 (or a total not typed): the package's problem, shown by every price field.
  const packagePriceMissing = problems.codes.includes("package_price_required");
  const listErrorId = `${id}-list-error`;
  const fee = pickupFee === undefined ? null : readPickupFeeInput(pickupFee);
  const total = piecesDraftTotalCents(pieces, fee?.cents ?? 0, mode);
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
  const setMode = (next: PriceMode) => {
    if (!pricing || !onPricingChange || next === mode.mode) return;
    onPricingChange(switchPricingMode(pieces, mode, next));
  };
  const showSwitch = Boolean(pricing && onPricingChange) && (count >= 2 || totalMode);
  const splitText = totalMode ? totalSplitText(mode, count, lang) : "";
  const countChanged = storedCount !== undefined && storedCount > 0 && storedCount !== count;

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
          const rowSum = totalMode ? "" : pieceRowSumText(piece, lang);
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
              <div className={`lst-form-grid pcs-fields${totalMode ? " pcs-fields-total" : ""}`}>
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
                {!totalMode && (
                  <label className="lst-field pcs-price">
                    <span>Price ($){priceRequired && <i className="lst-required" aria-hidden="true"> *</i>}</span>
                    <input inputMode="decimal" value={piece.price} disabled={disabled} onChange={(e) => set(piece.key, { price: e.target.value })} placeholder={moneyPlaceholder} aria-required={priceRequired || undefined} {...priceProps} />
                  </label>
                )}
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
              {rowSum && <small className="pcs-row-sum" data-no-translate>{rowSum}</small>}
              {own.length > 0 && <small className="lst-field-error" id={errorId}>{containerMessage(own)}</small>}
            </li>
          );
        })}
      </ol>
      <div className="pcs-foot">
        <button className="lst-btn ghost" type="button" disabled={disabled || full} onClick={() => onChange(addPieceDraft(pieces))}>
          <Plus size={14} /> Add another piece
        </button>
        {pickupFee === undefined && !showSwitch && <strong className="pcs-total" data-no-translate>{piecesTotalText(total, lang)}</strong>}
      </div>
      {showSwitch && (
        <div className="pcs-pricing">
          <div className="pcs-pricing-switch">
            <strong data-no-translate>{t("priceSwitch")}</strong>
            <div className="service-segments pcs-kinds" role="radiogroup" aria-label={t("priceSwitchAria")}>
              {([PRICE_MODE.EACH, PRICE_MODE.TOTAL] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={mode.mode === value}
                  className={`segment${mode.mode === value ? " active" : ""}`}
                  disabled={disabled}
                  onClick={() => setMode(value)}
                >
                  <span data-no-translate>{t(value === PRICE_MODE.TOTAL ? "total" : "each")}</span>
                </button>
              ))}
            </div>
            {/* The total beside the switch; with a pickup fee it comes after the fee instead. */}
            {pickupFee === undefined && <strong className="pcs-total pcs-total-end" data-no-translate>{piecesTotalText(total, lang)}</strong>}
          </div>
          {totalMode && (
            <label className="lst-field pcs-price pcs-total-field">
              <span><span data-no-translate>{t("totalField")}</span>{priceRequired && <i className="lst-required" aria-hidden="true"> *</i>}</span>
              <input
                id={`${id}-total`}
                inputMode="decimal"
                value={mode.total}
                disabled={disabled}
                onChange={(e) => onPricingChange?.({ pieces: [...pieces], pricing: { mode: PRICE_MODE.TOTAL, total: e.target.value } })}
                placeholder={moneyPlaceholder}
                aria-required={priceRequired || undefined}
                {...(packagePriceMissing ? { "aria-invalid": true, "aria-describedby": listErrorId } : {})}
              />
              {splitText && <small className="pcs-row-sum" data-no-translate>{splitText}</small>}
            </label>
          )}
          {totalMode && countChanged && totalStaysText(mode, lang) && <small className="pcs-note" data-no-translate>{totalStaysText(mode, lang)}</small>}
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
