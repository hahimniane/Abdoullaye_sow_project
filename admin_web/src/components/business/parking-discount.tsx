"use client";

// The discount on a parked car (docs/PARKING_DISCOUNT.md): "Settle for a
// lower amount" and "Give a discount", the car's discounts with Undo. Shown
// inside the car's payment actions, for anyone with the parking permission.

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { BadgePercent, RotateCcw } from "lucide-react";
import { functions } from "@/lib/firebase";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { BUSINESS_PARKING_RECEIVED_VIA_OPTIONS } from "@/lib/business-parking-entry";
import { formatCents } from "@/lib/lot-ledger";
import { formatDateTime } from "@/lib/format";
import { DISCOUNT_MESSAGES, discountableCar, discountPreview, owedNowCents, parkingDiscountsOf } from "@/lib/parking-discount";
import { ReceivedByOptions } from "@/components/business/received-by-options";

type Row = Record<string, unknown>;

/** The refusal in words: the server's reason code, else its message. */
function errorText(error: unknown): string {
  const details = (error as { details?: { reason?: unknown } })?.details;
  const reason = typeof details?.reason === "string" ? details.reason : "";
  if (reason && DISCOUNT_MESSAGES[reason]) return DISCOUNT_MESSAGES[reason];
  return String((error as { message?: unknown })?.message || "Something went wrong.");
}

export function ParkingDiscountActions({
  row,
  staffOptions,
  nameOf,
}: {
  row: Row;
  staffOptions: readonly { id: string; name: string }[];
  nameOf: (uid: string) => string;
}) {
  const [mode, setMode] = useState<"" | "discount" | "settle">("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [via, setVia] = useState("cash");
  const [receivedBy, setReceivedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const discounts = parkingDiscountsOf(row);
  const canGive = discountableCar(row) && row.voided !== true && String(row.status) !== "cancelled";
  const owed = canGive ? owedNowCents(row) : 0;
  if (!canGive && discounts.length === 0) return null;

  const cents = amount.trim() === "" ? NaN : Math.round(Number(amount) * 100);
  const preview = mode ? discountPreview(row, mode, cents, reason, receivedBy) : null;

  function close() {
    setMode(""); setAmount(""); setReason(""); setReceivedBy("");
  }

  async function save() {
    if (!mode || !preview) return;
    if (!preview.ok) { setFlash(preview.message); return; }
    const ok = await confirmImportantAction(
      mode === "settle"
        ? `Settle this car for ${formatCents(preview.paidCents)}? ${formatCents(preview.discountCents)} is recorded as a discount.`
        : `Give a ${formatCents(preview.discountCents)} discount on this car?`,
      mode === "settle"
        ? `Régler cette voiture pour ${formatCents(preview.paidCents)} ? ${formatCents(preview.discountCents)} est enregistré comme remise.`
        : `Accorder une remise de ${formatCents(preview.discountCents)} sur cette voiture ?`,
    );
    if (!ok) return;
    setBusy(true); setFlash("");
    try {
      const call = httpsCallable(functions, "updateBusinessParkingEntry");
      if (mode === "settle") {
        await call({
          action: "discount_settle",
          entryId: row.id,
          paidCents: preview.paidCents,
          receivedVia: via,
          receivedByStaffId: receivedBy,
          reason,
          expectedOwedCents: preview.owedCents,
        });
        setFlash("Settled. The discount is on the bill.");
      } else {
        await call({ action: "discount_give", entryId: row.id, amountCents: preview.discountCents, reason });
        setFlash("Discount given.");
      }
      close();
    } catch (error) {
      setFlash(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function undo(id: string, cents: number) {
    const ok = await confirmImportantAction(
      `Undo this ${formatCents(cents)} discount? The car owes it again. It stays in the history as undone.`,
      `Annuler cette remise de ${formatCents(cents)} ? La voiture la doit à nouveau. Elle reste dans l'historique comme annulée.`,
    );
    if (!ok) return;
    setBusy(true); setFlash("");
    try {
      await httpsCallable(functions, "updateBusinessParkingEntry")({ action: "discount_undo", entryId: row.id, discountId: id });
      setFlash("Discount undone.");
    } catch (error) {
      setFlash(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pk-discount">
      {discounts.length > 0 && (
        <ul className="pk-discount-list">
          {discounts.map((d) => (
            <li key={d.id} className={d.undone ? "pk-discount-undone" : ""}>
              <span>
                <b>Discount −{formatCents(d.amountCents)}</b>
                {" · "}<span data-no-translate>{d.reason}</span>
                {" · "}{nameOf(d.givenByUid) || "Staff"}
                {d.atMs > 0 && <>{" · "}{formatDateTime(new Date(d.atMs))}</>}
                {d.undone && <>{" · "}Undone{d.undoneAtMs > 0 && <> {formatDateTime(new Date(d.undoneAtMs))}</>}</>}
              </span>
              {!d.undone && (
                <button className="ghost-button" type="button" disabled={busy} onClick={() => void undo(d.id, d.amountCents)}>
                  <RotateCcw size={13} /> Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canGive && owed > 0 && !mode && (
        <div className="pk-partpay-row">
          <button className="ghost-button" type="button" disabled={busy} onClick={() => setMode("settle")}>
            <BadgePercent size={13} /> Settle for a lower amount
          </button>
          <button className="ghost-button" type="button" disabled={busy} onClick={() => setMode("discount")}>
            Give a discount
          </button>
        </div>
      )}
      {mode && (
        <div className="pk-partpay">
          <p className="lst-hint">
            Owed today: <b>{formatCents(owed)}</b>
            {!row.parkingEndDate && " · the days keep adding up from tomorrow."}
          </p>
          <div className="pk-partpay-row">
            <label className="bar-field">
              <span>{mode === "settle" ? "Amount paid now ($)" : "Discount ($)"}</span>
              <input type="number" min="0" step="0.01" inputMode="decimal" value={amount}
                placeholder={mode === "settle" ? "e.g. 1500" : "e.g. 500"}
                onChange={(e) => setAmount(e.target.value)}
                aria-label={mode === "settle" ? "Amount paid now" : "Discount amount"} />
            </label>
            {mode === "settle" && (
              <>
                <label className="bar-field"><span>Received via</span>
                  <select value={via} onChange={(e) => setVia(e.target.value)} aria-label="Received via">
                    {BUSINESS_PARKING_RECEIVED_VIA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                  </select>
                </label>
                <label className="bar-field"><span>Received by</span>
                  <select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} aria-label="Received by">
                    <ReceivedByOptions staffOptions={staffOptions} placeholder="Received by…" />
                  </select>
                </label>
              </>
            )}
          </div>
          <label className="bar-field pk-discount-reason">
            <span>Why (required)</span>
            <input type="text" maxLength={300} value={reason} placeholder="e.g. Agreed with the owner, long stay"
              onChange={(e) => setReason(e.target.value)} aria-label="Why the discount was agreed" />
          </label>
          {preview && preview.ok && (
            <p className="lst-hint" role="status">
              {mode === "settle"
                ? <>Paid {formatCents(preview.paidCents)} · Discount −{formatCents(preview.discountCents)} · Left {formatCents(0)}</>
                : <>Discount −{formatCents(preview.discountCents)} · Left to pay {formatCents(preview.leftCents)}</>}
            </p>
          )}
          {preview && !preview.ok && amount.trim() !== "" && <p className="lst-hint">{preview.message}</p>}
          <div className="pk-partpay-row">
            <button className="primary-button" type="button" disabled={busy || !preview?.ok} onClick={() => void save()}>
              {mode === "settle" ? "Settle" : "Give discount"}
            </button>
            <button className="ghost-button" type="button" disabled={busy} onClick={close}>Cancel</button>
          </div>
        </div>
      )}
      {flash && <div className="lst-hint" role="status">{flash}</div>}
    </div>
  );
}
