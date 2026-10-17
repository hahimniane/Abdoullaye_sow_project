"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, Undo2, UserCheck } from "lucide-react";

import { InventoryCollectorDialog } from "@/components/business/inventory-collector-dialog";
import { InventoryCreditPaymentDialog } from "@/components/business/inventory-credit-payment-dialog";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { useInventoryCreditPayments } from "@/lib/business-data";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { runInventoryCall, type InventorySale, type StoreAccess } from "@/lib/inventory";
import {
  CREDIT_CHIP_LABELS,
  CREDIT_CHIP_TONES,
  collectorText,
  creditChip,
  creditChipText,
  creditPaymentEntries,
  dueDateText,
  overdueDaysText,
  daysBetween,
  paidOfText,
  revertInventoryCreditPaymentRequest,
} from "@/lib/inventory-credit";
import { statusPillClass } from "@/lib/status-pill";

/**
 * The credit part of an opened sale: who owes it, who collects it, by when,
 * how much is left, and every payment since (who received it, who entered it,
 * reverted ones struck through). Record payment / Change collector / Revert
 * are the credit callables; the sale row itself updates live as they land.
 */
export function InventoryCreditBlock({
  businessId,
  sale,
  enabled,
  access,
  viewerUid,
  staffName,
  staffOptions,
  todayKey,
  onFlash,
  onError,
}: {
  businessId: string;
  sale: InventorySale;
  enabled: boolean;
  access: StoreAccess;
  viewerUid: string;
  staffName: (id: string) => string;
  staffOptions: readonly { id: string; name: string }[];
  todayKey: string;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const [modal, setModal] = useState<"" | "pay" | "collector">("");
  const [busy, setBusy] = useState(false);
  // Staff of one store read their store's rows only (the rules want the filter).
  const history = useInventoryCreditPayments(businessId, sale.id, enabled && !access.needsHomeStore, access.scopedStoreId);
  const entries = useMemo(() => creditPaymentEntries(history.rows), [history.rows]);
  const credit = sale.credit;
  if (!credit) return null;
  const chip = creditChip(sale, todayKey);
  const late = chip?.status === "overdue" ? daysBetween(credit.dueDate, todayKey) : 0;
  const open = !sale.voided && sale.creditRemainingCents > 0;

  async function revert(entryId: string, amountCents: number) {
    const ok = await confirmImportantAction(
      `Revert the ${moneyText(amountCents)} payment? The customer owes it again.`,
      `Annuler le paiement de ${moneyText(amountCents)} ? Le client le doit à nouveau.`,
    );
    if (!ok) return;
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "revertInventoryCreditPayment")(revertInventoryCreditPaymentRequest(businessId, entryId));
      onFlash("Payment reverted.");
    }, (failure) => onError(failure.message));
  }

  return (
    <section className="ivt-credit" aria-label="Credit details">
      <div className="ivt-credit-head">
        <h4>On credit</h4>
        {chip && <span className={statusPillClass(CREDIT_CHIP_TONES[chip.status])} title={CREDIT_CHIP_LABELS[chip.status]} data-no-translate>{creditChipText(chip, lang)}</span>}
      </div>
      <div className="ivt-credit-grid">
        <div>
          <span>Customer</span>
          <strong data-no-translate>{credit.customerName || "—"}</strong>
          {credit.customerPhone && <small data-no-translate><a href={`tel:${credit.customerPhone}`}>{credit.customerPhone}</a></small>}
        </div>
        <div>
          <span>Collected by</span>
          <strong data-no-translate>{staffName(credit.collectorStaffId) || collectorText("", lang)}</strong>
          <small data-no-translate className={late > 0 ? "ivt-overdue" : undefined}>
            {dueDateText(credit.dueDate, lang)}{late > 0 ? ` · ${overdueDaysText(late, lang)}` : ""}
          </small>
        </div>
        <div>
          <span>Still owed</span>
          <strong data-no-translate>{moneyText(sale.creditRemainingCents)}</strong>
          <small data-no-translate>{paidOfText(sale.creditPaidCents, sale.creditCents, lang)}</small>
        </div>
      </div>
      {!sale.voided && (
        <div className="wpk-inline-actions">
          {open && (
            <button className="lst-btn ghost" type="button" disabled={busy || !enabled} onClick={() => setModal("pay")}><Banknote size={16} /> Record payment</button>
          )}
          <button className="lst-btn ghost" type="button" disabled={busy || !enabled} onClick={() => setModal("collector")}><UserCheck size={16} /> Change collector</button>
        </div>
      )}
      <h4 className="wpk-history-title">Payments</h4>
      {history.error && <div className="lst-form-error" role="alert">{history.error}</div>}
      {history.loading && entries.length === 0 ? (
        <p className="panel-lede">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="empty-state">No payments since the sale.</div>
      ) : (
        <ul className="wpk-history">
          {entries.map((entry) => {
            const received = staffName(entry.receivedByStaffId);
            const entered = entry.recordedByStaffId && entry.recordedByStaffId !== entry.receivedByStaffId ? staffName(entry.recordedByStaffId) : "";
            const revertedBy = staffName(entry.revertedByStaffId);
            return (
              <li className={entry.reverted ? "wpk-reverted" : undefined} key={entry.id}>
                <div>
                  <strong data-no-translate>{moneyText(entry.amountCents)}</strong>
                  {" "}<span>{entry.methodLabel}</span>
                  {entry.note && <small data-no-translate>{entry.note}</small>}
                  <small>
                    <time data-no-translate>{formatDateTime(entry.at)}</time>
                    {received && <> · <span>Received by</span> <span data-no-translate>{received}</span></>}
                    {entered && <> · <span>entered by</span> <span data-no-translate>{entered}</span></>}
                  </small>
                  {entry.reverted && (
                    <small className="wpk-reverted-note">
                      <span>Reverted</span>
                      {revertedBy && <> · <span data-no-translate>{revertedBy}</span></>}
                    </small>
                  )}
                </div>
                {!entry.reverted && (
                  <button className="ghost-button" type="button" disabled={busy || !enabled} onClick={() => void revert(entry.id, entry.amountCents)} title="Revert payment" aria-label="Revert payment">
                    <Undo2 size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {modal === "pay" && (
        <InventoryCreditPaymentDialog
          businessId={businessId}
          sale={sale}
          viewerUid={viewerUid}
          staffOptions={staffOptions}
          onClose={() => setModal("")}
          onFlash={onFlash}
        />
      )}
      {modal === "collector" && (
        <InventoryCollectorDialog
          businessId={businessId}
          sale={sale}
          staffOptions={staffOptions}
          todayKey={todayKey}
          onClose={() => setModal("")}
          onFlash={onFlash}
        />
      )}
    </section>
  );
}
