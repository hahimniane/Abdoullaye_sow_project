"use client";

import { useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  ArrowLeft,
  Banknote,
  Copy,
  FileDown,
  History,
  Pencil,
  Plus,
  Receipt,
  RefreshCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { runPanelAction } from "@/components/business/operations-panels";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { useBusinessCollection, useBusinessStaff } from "@/lib/business-data";
import { db, functions } from "@/lib/firebase";
import { currentLanguage, formatDate, text } from "@/lib/format";
import {
  INVOICE_MESSAGES,
  INVOICE_PAYMENT_METHODS,
  INVOICE_PAYMENT_METHOD_LABELS,
  emptyInvoiceDraft,
  emptyInvoiceLineDraft,
  emptyInvoicePaymentDraft,
  filterInvoices,
  invoiceCallableFailure,
  invoiceDayKey,
  invoiceDraftFromRow,
  invoiceIsOverdue,
  invoiceKind,
  invoiceLineDraftFromRow,
  invoiceLinePayload,
  invoiceMessage,
  invoicePayload,
  invoicePaymentLabel,
  invoicePaymentPayload,
  invoiceStatus,
  invoiceTextSummary,
  invoiceTitle,
  invoiceTotals,
  moneyText,
  sortInvoices,
  todayKey,
  validateInvoiceDraft,
  validateInvoiceLineDraft,
  validateInvoicePaymentDraft,
  type InvoiceDraft,
  type InvoiceFilter,
  type InvoiceLineDraft,
  type InvoicePaymentDraft,
  type InvoicePaymentMethod,
} from "@/lib/invoice-ledger";
import { buildInvoicePdf, deliverPdf, invoiceFileName } from "@/lib/invoice-pdf";
import {
  lotCustomerFromRow,
  lotCustomerFromStaffRow,
  lotCustomerSources,
  matchLotCustomers,
  type LotCustomer,
} from "@/lib/lot-customers";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import {
  VIN_LOOKING_UP,
  VIN_SERVICE_UNREACHABLE,
  decodeVinWithCatalog,
  findVehicleRecordByVin,
  vinDecodeHint,
} from "@/lib/vin-lookup";
import { CopyValue } from "@/components/copy-value";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

type InvoicesPanelProps = {
  businessId: string;
  businessName?: string;
  business?: Row | null;
  previewMode?: boolean;
};

type InvoiceModal = "" | "invoice" | "line" | "payment" | "history" | "text";

function StatusBadge({ row }: { row: Row }) {
  if (invoiceStatus(row) === "paid") return <span className="lst-badge ok">Paid</span>;
  if (invoiceIsOverdue(row)) return <span className="lst-badge warn">Overdue</span>;
  return <span className="lst-badge navy">Open</span>;
}

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

/**
 * Invoices and receipts the business writes by hand: what it sold to
 * someone - a car, barrels, tyres, anything, whether or not it exists
 * anywhere else on the platform - and what has been paid against it. One
 * invoice is one open tab; the paper is a PDF built here and sent by the
 * business over WhatsApp. Customers never see this screen.
 */
export function InvoicesPanel({ businessId, businessName = "", business = null, previewMode = false }: InvoicesPanelProps) {
  const enabled = Boolean(businessId && !previewMode);
  const invoices = useBusinessCollection("invoices", businessId, enabled, 1000);
  const lines = useBusinessCollection("invoiceLines", businessId, enabled, 5000);
  const payments = useBusinessCollection("invoicePayments", businessId, enabled, 5000);
  const staff = useBusinessStaff(businessId, enabled, 200);
  // The lot's customer memory, offered back as staff type a name.
  const lotCustomers = useBusinessCollection("lotCustomers", businessId, enabled, 500);
  // The same records the ledger's form scans when a VIN is typed: a parked
  // car or a past activity already says what the car is.
  const parkedCars = useBusinessCollection("parkedCars", businessId, enabled, 500);
  const activities = useBusinessCollection("lotActivities", businessId, enabled, 1000);

  const [filter, setFilter] = useState<InvoiceFilter>("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const [modal, setModal] = useState<InvoiceModal>("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [draftError, setDraftError] = useState("");

  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft>(emptyInvoiceDraft);
  const [editingInvoiceId, setEditingInvoiceId] = useState("");
  const [lineDraft, setLineDraft] = useState<InvoiceLineDraft>(emptyInvoiceLineDraft);
  const [editingLineId, setEditingLineId] = useState("");
  const [paymentDraft, setPaymentDraft] = useState<InvoicePaymentDraft>(emptyInvoicePaymentDraft);
  const [customerPick, setCustomerPick] = useState<LotCustomer | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [vinHint, setVinHint] = useState("");
  const lastVinRef = useRef("");
  const [historyRows, setHistoryRows] = useState<FirestoreRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [textPreview, setTextPreview] = useState("");

  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const orgName = text(business?.name, "") || businessName;

  const linesByInvoice = useMemo(() => {
    const map = new Map<string, FirestoreRow[]>();
    lines.rows.forEach((row) => {
      const key = text(row.invoiceId, "");
      if (!key) return;
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    });
    map.forEach((bucket) => bucket.sort((a, b) => millis(a.createdAt) - millis(b.createdAt)));
    return map;
  }, [lines.rows]);

  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, FirestoreRow[]>();
    payments.rows.forEach((row) => {
      const key = text(row.invoiceId, "");
      if (!key) return;
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    });
    map.forEach((bucket) => bucket.sort((a, b) => millis(a.createdAt) - millis(b.createdAt)));
    return map;
  }, [payments.rows]);

  const staffName = (id: string) => {
    if (!id) return "";
    const row = staff.rows.find((s) => String(s.id) === id);
    if (!row) return "";
    return text(row.fullName, "") || text(row.name, "") || text(row.email, "");
  };

  const knownCustomers = useMemo(
    () =>
      lotCustomerSources(
        lotCustomers.rows.map((row) => lotCustomerFromRow(row)),
        staff.rows.map((row) => lotCustomerFromStaffRow(row)).filter((c): c is LotCustomer => c !== null),
      ),
    [lotCustomers.rows, staff.rows],
  );
  const customerMatches = useMemo(() => {
    if (!customerMenuOpen || customerPick) return [];
    const typed = invoiceDraft.customerName.trim();
    if (typed.length < 2) return knownCustomers.slice(0, 6);
    return matchLotCustomers(knownCustomers, typed);
  }, [knownCustomers, invoiceDraft.customerName, customerMenuOpen, customerPick]);

  const sorted = useMemo(() => sortInvoices(invoices.rows), [invoices.rows]);
  const visible = useMemo(() => filterInvoices(sorted, filter, search), [sorted, filter, search]);

  // The scoreboard reads the rows, so it cannot disagree with the list.
  const board = useMemo(() => {
    const today = todayKey();
    let open = 0;
    let overdue = 0;
    let owedCents = 0;
    let collectedCents = 0;
    invoices.rows.forEach((row) => {
      collectedCents += Math.max(0, Number(row.paidCents) || 0);
      if (invoiceStatus(row) !== "open") return;
      open += 1;
      owedCents += Math.max(0, Number(row.balanceCents) || 0);
      if (invoiceIsOverdue(row, today)) overdue += 1;
    });
    return { open, overdue, owedCents, collectedCents };
  }, [invoices.rows]);

  const selected = selectedId ? invoices.rows.find((row) => String(row.id) === selectedId) : undefined;
  const selectedLines = selected ? linesByInvoice.get(selectedId) ?? [] : [];
  const selectedPayments = selected ? paymentsByInvoice.get(selectedId) ?? [] : [];
  const selectedTotals = invoiceTotals(selectedLines, selectedPayments);

  function closeModal() {
    setModal("");
    setDraftError("");
    setCustomerMenuOpen(false);
  }

  function failInModal(error: unknown) {
    setDraftError(invoiceCallableFailure(error));
  }

  // -------------------------------------------------------------------------
  // The invoice.
  // -------------------------------------------------------------------------

  function openNew() {
    setInvoiceDraft({ ...emptyInvoiceDraft, issuedOn: todayKey() });
    setEditingInvoiceId("");
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setDraftError("");
    setModal("invoice");
  }

  function openEdit(row: Row) {
    setInvoiceDraft(invoiceDraftFromRow(row));
    setEditingInvoiceId(String(row.id));
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setDraftError("");
    setModal("invoice");
  }

  function pickCustomer(c: LotCustomer) {
    setCustomerPick(c);
    setCustomerMenuOpen(false);
    setInvoiceDraft((d) => ({
      ...d,
      customerName: c.name,
      customerPhone: c.phone || d.customerPhone,
      customerEmail: c.email || d.customerEmail,
    }));
  }

  async function saveInvoice() {
    const errors = validateInvoiceDraft(invoiceDraft);
    if (errors.length) {
      setDraftError(invoiceMessage(errors));
      return;
    }
    const payload = invoicePayload(invoiceDraft);
    if (editingInvoiceId) {
      await runPanelAction(setBusy, setFlash, "Invoice updated.", async () => {
        await httpsCallable(functions, "updateInvoice")({ businessId, invoiceId: editingInvoiceId, changes: payload });
        closeModal();
      }, failInModal);
      return;
    }
    await runPanelAction(setBusy, setFlash, "Invoice opened. Add the first line.", async () => {
      const response = await httpsCallable(functions, "createInvoice")({ businessId, ...payload });
      const data = (response.data ?? {}) as Row;
      closeModal();
      const id = text(data.invoiceId, "");
      if (id) {
        setSearch("");
        setSelectedId(id);
      }
    }, failInModal);
  }

  async function deleteInvoice(row: Row) {
    const ok = await confirmImportantAction(
      `Delete ${invoiceTitle(row)}? Its number will not be reused.`,
      `Supprimer ${invoiceTitle(row)} ? Son numéro ne sera pas réutilisé.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Invoice deleted.", async () => {
      await httpsCallable(functions, "deleteInvoice")({ businessId, invoiceId: String(row.id) });
      setSelectedId("");
    });
  }

  async function openHistory(invoiceId: string) {
    setHistoryRows([]);
    setHistoryLoading(true);
    setModal("history");
    try {
      // Filter by businessId too: the security rule authorizes by business,
      // and Firestore rejects a query it can't prove stays inside that scope.
      const snap = await getDocs(query(
        collection(db, "lotLedgerAudit"),
        where("businessId", "==", businessId),
        where("entityId", "==", invoiceId),
        orderBy("at", "desc"),
        limit(50),
      ));
      setHistoryRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreRow)));
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Lines.
  // -------------------------------------------------------------------------

  function openAddLine() {
    setLineDraft(emptyInvoiceLineDraft);
    setEditingLineId("");
    setVinHint("");
    lastVinRef.current = "";
    setDraftError("");
    setModal("line");
  }

  function openEditLine(row: Row) {
    setLineDraft(invoiceLineDraftFromRow(row));
    setEditingLineId(String(row.id));
    setVinHint("");
    lastVinRef.current = "";
    setDraftError("");
    setModal("line");
  }

  // The VIN is the vehicle's identity, so typing one should end the typing:
  // the business's own records first (a parked car, a past job), then the
  // decoder. The description is filled only while it is empty, so a name
  // the person already chose is never overwritten.
  function applyLineVin(rawVin: string) {
    const clean = rawVin.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17);
    setLineDraft((d) => ({ ...d, vinNumber: clean }));
    if (clean.length < 6) {
      setVinHint("");
      lastVinRef.current = "";
      return;
    }
    const match = findVehicleRecordByVin([...parkedCars.rows, ...activities.rows], clean);
    if (match) {
      lastVinRef.current = clean;
      const car = [text(match.carYear, ""), text(match.carMake, ""), text(match.carModel, "")].filter(Boolean).join(" ");
      if (car) {
        setLineDraft((d) => ({ ...d, description: d.description.trim() ? d.description : car }));
        setVinHint(`Filled from an existing record: ${car}. You can change anything below.`);
      }
      return;
    }
    setVinHint("");
    if (clean.length === 17 && clean !== lastVinRef.current) {
      lastVinRef.current = clean;
      void decodeLineVin(clean);
    }
  }

  async function decodeLineVin(vin: string) {
    setVinHint(VIN_LOOKING_UP);
    try {
      const result = await decodeVinWithCatalog(vin);
      if (lastVinRef.current !== vin) return;
      const car = [result.year, result.make, result.model].filter(Boolean).join(" ") || result.seen;
      if (car) setLineDraft((d) => ({ ...d, description: d.description.trim() ? d.description : car }));
      setVinHint(vinDecodeHint(result));
    } catch {
      if (lastVinRef.current === vin) setVinHint(VIN_SERVICE_UNREACHABLE);
    }
  }

  async function saveLine(andAnother = false) {
    if (!selected) return;
    const errors = validateInvoiceLineDraft(lineDraft);
    if (errors.length) {
      setDraftError(invoiceMessage(errors));
      return;
    }
    const line = invoiceLinePayload(lineDraft);
    if (editingLineId) {
      await runPanelAction(setBusy, setFlash, "Line updated.", async () => {
        await httpsCallable(functions, "updateInvoiceLine")({ businessId, invoiceId: selectedId, lineId: editingLineId, line });
        closeModal();
      }, failInModal);
      return;
    }
    await runPanelAction(setBusy, setFlash, andAnother ? "" : "Line added.", async () => {
      await httpsCallable(functions, "addInvoiceLine")({ businessId, invoiceId: selectedId, line });
      if (andAnother) {
        setLineDraft(emptyInvoiceLineDraft);
        setDraftError("");
        return;
      }
      closeModal();
    }, failInModal);
  }

  async function removeLine(row: Row) {
    if (!selected) return;
    const ok = await confirmImportantAction(
      `Remove "${text(row.description, "")}" (${moneyText(row.amountCents)}) from ${invoiceTitle(selected)}?`,
      `Retirer « ${text(row.description, "")} » (${moneyText(row.amountCents)}) de ${invoiceTitle(selected)} ?`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Line removed.", async () => {
      await httpsCallable(functions, "removeInvoiceLine")({ businessId, invoiceId: selectedId, lineId: String(row.id) });
    });
  }

  // -------------------------------------------------------------------------
  // Payments.
  // -------------------------------------------------------------------------

  function openPayment() {
    setPaymentDraft({ ...emptyInvoicePaymentDraft, paidOn: todayKey() });
    setDraftError("");
    setModal("payment");
  }

  async function savePayment() {
    if (!selected) return;
    const errors = validateInvoicePaymentDraft(paymentDraft, selectedTotals.balanceCents);
    if (errors.length) {
      setDraftError(invoiceMessage(errors));
      return;
    }
    const payment = invoicePaymentPayload(paymentDraft);
    await runPanelAction(setBusy, setFlash, "Payment recorded.", async () => {
      const response = await httpsCallable(functions, "recordInvoicePayment")({ businessId, invoiceId: selectedId, payment });
      const data = (response.data ?? {}) as Row;
      closeModal();
      if (text(data.status, "") === "paid") setFlash("Payment recorded — paid in full. This is now a receipt.");
    }, failInModal);
  }

  async function revertPayment(row: Row) {
    if (!selected) return;
    const ok = await confirmImportantAction(
      `Revert the ${moneyText(row.amountCents)} payment of ${invoiceDayKey(row.paidOn)}? The balance goes back up.`,
      `Annuler le paiement de ${moneyText(row.amountCents)} du ${invoiceDayKey(row.paidOn)} ? Le solde remonte.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, setFlash, "Payment reverted.", async () => {
      await httpsCallable(functions, "revertInvoicePayment")({ businessId, invoiceId: selectedId, paymentId: String(row.id) });
    });
  }

  // -------------------------------------------------------------------------
  // The paper.
  // -------------------------------------------------------------------------

  async function savePdf() {
    if (!selected) return;
    await runPanelAction(setBusy, setFlash, "", async () => {
      const blob = await buildInvoicePdf({
        business: { ...(business ?? {}), name: orgName },
        invoice: selected,
        lines: selectedLines,
        payments: selectedPayments,
        language: lang,
      });
      const outcome = await deliverPdf(blob, invoiceFileName(selected, { name: orgName }));
      setFlash(outcome === "shared" ? "PDF handed to the share sheet." : "PDF saved to your downloads.");
    });
  }

  function openText() {
    if (!selected) return;
    setTextPreview(invoiceTextSummary({ invoice: selected, lines: selectedLines, payments: selectedPayments, businessName: orgName }));
    setDraftError("");
    setModal("text");
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(textPreview);
      setFlash("Copied — paste it into WhatsApp.");
      closeModal();
    } catch {
      setDraftError("Copy is blocked here. Select the text and copy it yourself.");
    }
  }

  // -------------------------------------------------------------------------
  // Render.
  // -------------------------------------------------------------------------

  const loading = invoices.loading || lines.loading;
  const loadError = invoices.error || lines.error || payments.error;
  const selectedOpen = selected ? invoiceStatus(selected) === "open" : false;

  return (
    <div className="ctn-panel inv-panel">
      {flash && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          {flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button>
        </div>
      )}
      {loadError && <div className="lst-form-error" role="alert">{loadError}</div>}

      {selected ? (
        <article className="panel">
          <div className="panel-header">
            <div>
              <button className="ghost-button" type="button" onClick={() => setSelectedId("")}><ArrowLeft size={14} /> All invoices</button>
            </div>
            <span className="panel-action"><StatusBadge row={selected} /></span>
          </div>
          <div className="ctn-detail">
            <div className="ctn-detail-head">
              <div>
                <h2>{invoiceTitle(selected)}</h2>
                <p className="panel-lede">
                  {invoiceKind(selected)} for <strong>{text(selected.customerName, "")}</strong>
                  {text(selected.customerPhone, "") && <> · {text(selected.customerPhone, "")}<CopyValue value={text(selected.customerPhone, "")} label="Copy phone" /></>}
                  {" · "}{formatDate(invoiceDayKey(selected.issuedOn))}
                  {invoiceDayKey(selected.dueOn) && selectedOpen && <> · due {formatDate(invoiceDayKey(selected.dueOn))}</>}
                </p>
              </div>
              <div className="ctn-detail-actions">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => openEdit(selected)}><Pencil size={14} /> Edit</button>
                <button className="lst-btn ghost" type="button" disabled={busy} aria-busy={busy} onClick={() => void savePdf()}>
                  {busy ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} Save as PDF
                </button>
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={openText}><Copy size={14} /> Copy as text</button>
                <button className="lst-btn ghost" type="button" onClick={() => void openHistory(selectedId)}><History size={14} /> History</button>
                {selectedOpen && selectedTotals.balanceCents > 0 && (
                  <button className="lst-btn" type="button" disabled={busy} onClick={openPayment}><Banknote size={14} /> Record a payment</button>
                )}
                {selectedLines.length === 0 && selectedPayments.length === 0 && (
                  <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={() => void deleteInvoice(selected)}><Trash2 size={14} /> Delete</button>
                )}
              </div>
            </div>

            <div className="pk-scoreboard" role="group" aria-label="Invoice totals">
              <div className="pk-stat"><span>Total</span><b>{moneyText(selectedTotals.totalCents)}</b><small>{selectedLines.length} line{selectedLines.length === 1 ? "" : "s"}</small></div>
              <div className="pk-stat"><span>Paid</span><b>{moneyText(selectedTotals.paidCents)}</b><small>{selectedTotals.paymentCount} payment{selectedTotals.paymentCount === 1 ? "" : "s"}</small></div>
              <div className="pk-stat"><span>Balance due</span><b className={selectedTotals.balanceCents > 0 ? "owed" : ""}>{moneyText(selectedTotals.balanceCents)}</b>
                <small>{selectedTotals.status === "paid" ? `Paid in full${invoiceDayKey(selected.paidOn) ? ` on ${formatDate(invoiceDayKey(selected.paidOn))}` : ""}` : invoiceDayKey(selected.dueOn) ? `Due ${formatDate(invoiceDayKey(selected.dueOn))}` : "No due date"}</small>
              </div>
            </div>
            {text(selected.notes, "") && <p className="ctn-notes">{text(selected.notes, "")}</p>}
          </div>

          <div className="panel-header">
            <div><h3>Lines</h3><span className="panel-count">{selectedLines.length}</span></div>
            <span className="panel-action">
              <button className="lst-add" type="button" disabled={busy} onClick={openAddLine}><Plus size={16} /> Add line</button>
            </span>
          </div>
          {selectedLines.length === 0 ? (
            <EmptyState text="Nothing on this invoice yet. Add the first line." />
          ) : (
            <div className="mini-table">
              <div className="ctn-table inv-table">
                <div className="mini-table-head"><span>Description</span><span>Qty × each</span><span>Amount</span><span aria-hidden="true"></span></div>
                {selectedLines.map((row) => {
                  const vin = text(row.vinNumber, "");
                  const qty = Math.max(1, Math.trunc(Number(row.quantity) || 1));
                  return (
                    <div className="mini-table-row" key={String(row.id)}>
                      <span><strong>{text(row.description, "")}</strong>{vin && <small>VIN {vin}</small>}{vin && <CopyValue value={vin} label="Copy VIN" />}</span>
                      <span><strong>{qty} × {moneyText(row.unitPriceCents)}</strong><small>{staffName(text(row.addedByStaffId, ""))}</small></span>
                      <span><strong>{moneyText(row.amountCents)}</strong></span>
                      <span className="ctn-row-actions">
                        <button className="ghost-button" type="button" disabled={busy} onClick={() => openEditLine(row)} title="Edit line"><Pencil size={14} /></button>
                        <button className="ghost-button" type="button" disabled={busy} onClick={() => void removeLine(row)} title="Remove line"><X size={14} /></button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="panel-header">
            <div><h3>Payments</h3><span className="panel-count">{selectedTotals.paymentCount}</span></div>
          </div>
          {selectedPayments.length === 0 ? (
            <EmptyState text="No payment recorded yet." />
          ) : (
            <div className="mini-table">
              <div className="ctn-table inv-table">
                <div className="mini-table-head"><span>Received</span><span>How</span><span>Amount</span><span aria-hidden="true"></span></div>
                {selectedPayments.map((row) => {
                  const reverted = row.reverted === true;
                  const method = INVOICE_PAYMENT_METHOD_LABELS[text(row.method, "") as InvoicePaymentMethod] ?? text(row.method, "");
                  return (
                    <div className={`mini-table-row${reverted ? " inv-reverted" : ""}`} key={String(row.id)}>
                      <span><strong>{formatDate(invoiceDayKey(row.paidOn))}</strong><small>{staffName(text(row.receivedByStaffId, ""))}</small></span>
                      <span><strong>{method}</strong>{text(row.forDescription, "") && <small>for {text(row.forDescription, "")}</small>}{text(row.note, "") && <small>{text(row.note, "")}</small>}{reverted && <small>Reverted</small>}</span>
                      <span><strong>{moneyText(row.amountCents)}</strong></span>
                      <span className="ctn-row-actions">
                        {!reverted && (
                          <button className="ghost-button" type="button" disabled={busy} onClick={() => void revertPayment(row)} title="Revert payment"><Undo2 size={14} /></button>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      ) : (
        <article className="panel">
          <div className="panel-header">
            <div><Receipt size={18} /><h2>Invoices &amp; receipts</h2><span className="panel-count">{invoices.rows.length}</span></div>
            <span className="panel-action">
              <button className="lst-add" type="button" disabled={busy || !enabled} onClick={openNew}><Plus size={16} /> New invoice</button>
            </span>
          </div>
          <div className="pk-scoreboard" role="group" aria-label="Invoice summary">
            <div className="pk-stat"><span>Open</span><b>{board.open}</b><small>{board.overdue} overdue</small></div>
            <div className="pk-stat"><span>Owed to you</span><b className={board.owedCents > 0 ? "owed" : ""}>{moneyText(board.owedCents)}</b><small>across open invoices</small></div>
            <div className="pk-stat"><span>Collected</span><b>{moneyText(board.collectedCents)}</b><small>on all invoices</small></div>
          </div>
          <div className="panel-tools">
            <select value={filter} onChange={(e) => setFilter(e.target.value as InvoiceFilter)} aria-label="Filter by state">
              <option value="">Every state</option>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
              <option value="paid">Paid</option>
            </select>
            <input type="search" placeholder="Number, title, customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search invoices" />
          </div>
          <p className="panel-lede">What you sold and what has been paid, typed by you. Send the PDF over WhatsApp; the balance updates here as payments come in.</p>

          {loading && invoices.rows.length === 0 ? (
            <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
          ) : invoices.rows.length === 0 ? (
            <EmptyState text="No invoices yet. Open one the next time you sell something." />
          ) : visible.length === 0 ? (
            <EmptyState text="No invoices match this filter." />
          ) : (
            <div className="mini-table">
              <div className="ctn-table ctn-list-table inv-list-table">
                <div className="mini-table-head"><span>Invoice</span><span>Customer</span><span>Balance</span><span>State</span></div>
                {visible.map((row) => {
                  const id = String(row.id);
                  return (
                    <div
                      className="mini-table-row ctn-clickable"
                      key={id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(id); } }}
                    >
                      <span><strong>{invoiceTitle(row)}</strong><small>{formatDate(invoiceDayKey(row.issuedOn))}</small></span>
                      <span><strong>{text(row.customerName, "")}</strong>{text(row.customerPhone, "") && <small>{text(row.customerPhone, "")}</small>}</span>
                      <span><strong>{moneyText(row.balanceCents)}</strong><small>of {moneyText(row.totalCents)}</small></span>
                      <span>
                        <StatusBadge row={row} />
                        {invoiceStatus(row) === "open" && invoiceDayKey(row.dueOn) && <small>due {formatDate(invoiceDayKey(row.dueOn))}</small>}
                        {invoiceStatus(row) === "paid" && invoiceDayKey(row.paidOn) && <small>{formatDate(invoiceDayKey(row.paidOn))}</small>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      )}

      {modal === "invoice" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <h3>{editingInvoiceId ? "Edit invoice" : "New invoice"}</h3>
                <p>{editingInvoiceId ? "Who it is for and when it is due. Lines and payments are edited on the invoice itself." : "One invoice per deal. Give it a short title and say who it is for; the lines come next."}</p>
              </div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Title</span><input value={invoiceDraft.title} onChange={(e) => setInvoiceDraft((d) => ({ ...d, title: e.target.value }))} placeholder="e.g. 2014 Corolla, or Barrels to Conakry" autoFocus /></label>
                <label className="lst-field" style={{ position: "relative" }}><span>Customer</span>
                  <input value={invoiceDraft.customerName} autoComplete="off" onFocus={() => setCustomerMenuOpen(true)} onBlur={() => window.setTimeout(() => setCustomerMenuOpen(false), 150)} onChange={(e) => { setCustomerPick(null); setCustomerMenuOpen(true); setInvoiceDraft((d) => ({ ...d, customerName: e.target.value })); }} />
                  {customerMatches.length > 0 && (
                    <ul className="lst-suggest" role="listbox" aria-label="Saved customers">
                      {customerMatches.map((c) => (
                        <li key={c.id} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{c.phone}</small></button></li>
                      ))}
                    </ul>
                  )}
                </label>
                <label className="lst-field"><span>Phone</span><input value={invoiceDraft.customerPhone} onChange={(e) => setInvoiceDraft((d) => ({ ...d, customerPhone: e.target.value }))} /></label>
                <label className="lst-field"><span>Email</span><input type="email" value={invoiceDraft.customerEmail} onChange={(e) => setInvoiceDraft((d) => ({ ...d, customerEmail: e.target.value }))} /></label>
                <label className="lst-field"><span>Invoice date</span><input type="date" value={invoiceDraft.issuedOn} onChange={(e) => setInvoiceDraft((d) => ({ ...d, issuedOn: e.target.value }))} /></label>
                <label className="lst-field"><span>Due date</span><input type="date" value={invoiceDraft.dueOn} onChange={(e) => setInvoiceDraft((d) => ({ ...d, dueOn: e.target.value }))} /><small className="lst-hint">Leave blank if there is no deadline.</small></label>
                <label className="lst-field wide"><span>Notes on the paper</span><textarea rows={3} value={invoiceDraft.notes} onChange={(e) => setInvoiceDraft((d) => ({ ...d, notes: e.target.value }))} placeholder="e.g. Sold as is. Title handed over on full payment." /></label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void saveInvoice()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
                {busy ? "Saving..." : editingInvoiceId ? "Save changes" : "Open invoice"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "line" && selected && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>{editingLineId ? "Edit line" : "Add a line"}</h3><p>{invoiceTitle(selected)} — anything you sold: a car, barrels, tyres, a service.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>VIN (selling a car? start here)</span><input value={lineDraft.vinNumber} onChange={(e) => applyLineVin(e.target.value)} placeholder="17 characters — fills in the car below" autoFocus={!editingLineId} />{vinHint && <small className="lst-hint" style={{ color: "var(--money)" }}>{vinHint}</small>}</label>
                <label className="lst-field wide"><span>What it is</span><input value={lineDraft.description} onChange={(e) => setLineDraft((d) => ({ ...d, description: e.target.value }))} placeholder="e.g. 2014 Toyota Corolla, or Barrels to Conakry" /></label>
                <label className="lst-field"><span>How many</span><input inputMode="numeric" value={lineDraft.quantity} onChange={(e) => setLineDraft((d) => ({ ...d, quantity: e.target.value }))} /></label>
                <label className="lst-field"><span>Price for one ($)</span><input inputMode="decimal" value={lineDraft.unitPrice} onChange={(e) => setLineDraft((d) => ({ ...d, unitPrice: e.target.value }))} placeholder="0.00" /></label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              {!editingLineId && (
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void saveLine(true)}>Save & add another</button>
              )}
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void saveLine()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />}
                {busy ? "Saving..." : editingLineId ? "Save changes" : "Add line"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "payment" && selected && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Record a payment</h3><p>{invoiceTitle(selected)} — {moneyText(selectedTotals.balanceCents)} still owed.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field"><span>Amount received ($)</span><input inputMode="decimal" value={paymentDraft.amount} onChange={(e) => setPaymentDraft((d) => ({ ...d, amount: e.target.value }))} placeholder="0.00" autoFocus /></label>
                <label className="lst-field"><span>How it arrived</span>
                  <select value={paymentDraft.method} onChange={(e) => setPaymentDraft((d) => ({ ...d, method: e.target.value as InvoicePaymentMethod }))}>
                    {INVOICE_PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{INVOICE_PAYMENT_METHOD_LABELS[m]}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Date</span><input type="date" value={paymentDraft.paidOn} onChange={(e) => setPaymentDraft((d) => ({ ...d, paidOn: e.target.value }))} /></label>
                <label className="lst-field"><span>What it is for</span>
                  <select value={paymentDraft.forLineId} onChange={(e) => setPaymentDraft((d) => ({ ...d, forLineId: e.target.value }))}>
                    <option value="">The whole invoice</option>
                    {selectedLines.map((row) => (<option key={String(row.id)} value={String(row.id)}>{text(row.description, "")} — {moneyText(row.amountCents)}</option>))}
                  </select>
                </label>
                <label className="lst-field wide"><span>Note</span><input value={paymentDraft.note} onChange={(e) => setPaymentDraft((d) => ({ ...d, note: e.target.value }))} placeholder="optional" /></label>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <button className="lst-btn ghost" type="button" onClick={() => setPaymentDraft((d) => ({ ...d, amount: (selectedTotals.balanceCents / 100).toFixed(2).replace(/\.00$/, "") }))}>Pay the whole balance</button>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void savePayment()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Banknote size={16} />}
                {busy ? "Saving..." : "Record payment"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {modal === "text" && selected && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Copy as text</h3><p>Reads inside WhatsApp without opening anything. Send the PDF too for the paper.</p></div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <textarea className="inv-text" readOnly rows={12} value={textPreview} onFocus={(e) => e.target.select()} />
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" onClick={closeModal}>Done</button>
              <button className="lst-add" type="button" onClick={() => void copyText()}><Copy size={16} /> Copy</button>
            </footer>
          </div>
        </div>
      )}

      {modal === "history" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Change history</h3><p>Every change on this invoice, most recent first.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {historyLoading ? <p className="panel-lede">Loading…</p> : historyRows.length === 0 ? <EmptyState text="No changes recorded yet." /> : historyRows.map((h) => {
                const who = staffName(text(h.byStaffId, "")) || (text(h.byStaffId, "") ? "someone not on your team" : "an unknown user");
                return (
                  <div key={String(h.id)} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span><strong>{auditActionLabel(text(h.action, ""))}</strong> · {who}</span>
                      <small style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(h.at)}</small>
                    </div>
                    {text(h.summary, "") && <div style={{ marginTop: 2 }}><small>{text(h.summary, "")}</small></div>}
                  </div>
                );
              })}
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" onClick={closeModal}>Done</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}

function millis(value: unknown): number {
  const v = value as { toMillis?: () => number } | undefined;
  return v && typeof v.toMillis === "function" ? v.toMillis() : 0;
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    created: "Opened",
    updated: "Edited",
    line_added: "Line added",
    line_changed: "Line changed",
    line_removed: "Line removed",
    payment: "Payment",
    payment_reverted: "Payment reverted",
    deleted: "Deleted",
  };
  return labels[action] ?? "Changed";
}

// Keep the refusal texts reachable for the contract test, which reads them
// against the server module.
export const invoiceRefusalTexts = INVOICE_MESSAGES;
