"use client";

import { Plus, X } from "lucide-react";

import { CONTAINER_MESSAGES, containerMessage } from "@/lib/container-manifest";
import { MAX_PIECES, PIECE_KINDS } from "@/lib/line-pieces";
import {
  addPieceDraft,
  pieceDraftProblems,
  pieceHeading,
  pieceKindLabel,
  piecesDraftTotalCents,
  piecesTotalText,
  readPickupFeeInput,
  removePieceDraft,
  updatePieceDraft,
  type PieceDraft,
} from "@/lib/piece-drafts";

/**
 * The pieces of one package: each barrel, box or other thing handed over,
 * with what it is, an optional size and its price. The total is the sum of
 * the piece prices (docs/WAITING_PACKAGES.md "Pieces"). One editor for the
 * register form, the waiting-package edit and the containers panel's line
 * form; the rules live in `lib/piece-drafts.ts`.
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
}) {
  const problems = showErrors ? pieceDraftProblems(pieces) : { codes: [], byPiece: [] };
  const listProblems = problems.codes.filter((code) => code === "pieces_required" || code === "pieces_too_many");
  const fee = pickupFee === undefined ? null : readPickupFeeInput(pickupFee);
  const total = piecesDraftTotalCents(pieces, fee?.cents ?? 0);
  // A decimal comma in French; readMoneyInput reads "45,50" and "45.50" alike.
  const moneyPlaceholder = lang === "fr" ? "0,00" : "0.00";
  const set = (key: string, patch: Partial<Omit<PieceDraft, "key">>) => onChange(updatePieceDraft(pieces, key, patch));

  return (
    <div className="pcs-editor" id={id} tabIndex={-1}>
      <ol className="pcs-list">
        {pieces.map((piece, index) => {
          const own = problems.byPiece[index] ?? [];
          const errorId = `${id}-${index}-error`;
          const invalid = own.length > 0 ? { "aria-invalid": true, "aria-describedby": errorId } : {};
          return (
            <li className="pcs-piece" key={piece.key}>
              <div className="pcs-piece-head">
                <strong data-no-translate>{pieceHeading(index, lang)}</strong>
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
                  onClick={() => onChange(removePieceDraft(pieces, piece.key))}
                  title="Remove this piece"
                  aria-label="Remove this piece"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="lst-form-grid pcs-fields">
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
                <label className="lst-field pcs-price"><span>Price ($)</span><input inputMode="decimal" value={piece.price} disabled={disabled} onChange={(e) => set(piece.key, { price: e.target.value })} placeholder={moneyPlaceholder} /></label>
              </div>
              {own.length > 0 && <small className="lst-field-error" id={errorId}>{containerMessage(own)}</small>}
            </li>
          );
        })}
      </ol>
      <div className="pcs-foot">
        <button className="lst-btn ghost" type="button" disabled={disabled || pieces.length >= MAX_PIECES} onClick={() => onChange(addPieceDraft(pieces))}>
          <Plus size={14} /> Add another piece
        </button>
        {pickupFee === undefined && <strong className="pcs-total" data-no-translate>{piecesTotalText(total, lang)}</strong>}
      </div>
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
      {listProblems.length > 0 && <small className="lst-field-error">{listProblems.map((code) => CONTAINER_MESSAGES[code]).join(" ")}</small>}
    </div>
  );
}
