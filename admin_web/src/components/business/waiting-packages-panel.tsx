"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { Banknote, Pencil, Plus, Printer, RefreshCw, Tag, X } from "lucide-react";

import { ContactPhone } from "@/components/business/contact-phone";
import { ContainerLabelsDialog } from "@/components/business/container-labels-dialog";
import { PackagePaymentDialog } from "@/components/business/package-payment-dialog";
import { PiecesEditor } from "@/components/business/pieces-editor";
import { runPanelAction } from "@/components/business/operations-panels";
import { CopyValue } from "@/components/copy-value";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { canonicalMake, canonicalModel, getMakes, getModels, getYears } from "@/lib/car-catalog";
import {
  cleanVin,
  containerLineTitle,
  containerLineTitleIsCopy,
  containerLineWhatsApp,
  containerLineWhatsAppText,
  lineDraftHasPieces,
  phoneCountryForDestination,
} from "@/lib/container-manifest";
import { linePickupFeeCents, type LineGroupSummary } from "@/lib/line-pieces";
import { newPieceDraft, savePrintLabelsText } from "@/lib/piece-drafts";
import { destinationCountryName } from "@/lib/destination-countries";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDate, text } from "@/lib/format";
import { INVOICE_PAYMENT_METHODS, INVOICE_PAYMENT_METHOD_LABELS, moneyText, type InvoicePaymentMethod } from "@/lib/invoice-ledger";
import { matchLotCustomers, type LotCustomer } from "@/lib/lot-customers";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { statusPillClass } from "@/lib/status-pill";
import {
  PACKAGE_PAYMENT_LABELS,
  PACKAGE_PAYMENT_TONES,
  addWaitingPackagePayload,
  destinationPlace,
  editPriceRequest,
  emptyWaitingPackageDraft,
  filterWaitingPackages,
  firstInvalidWaitingPackageField,
  groupForLine,
  groupPayment,
  intakeMoneyAvailable,
  nextPackageForSameSender,
  partHintText,
  runPackageCall,
  savedPackageStub,
  sortWaitingNewestFirst,
  switchIntakeMoney,
  updateWaitingPackageRequest,
  validateWaitingPackage,
  volumeCubicFeet,
  parseInches,
  waitingCountText,
  waitingDraftLabelCount,
  waitingPackageDraftFromRow,
  waitingPackageFieldMessage,
  waitingPackageMessage,
  waitingPackageRow,
  type DestinationRef,
  type IntakeMoneyDraft,
  type WaitingPackageDraft,
  type WaitingPackageField,
} from "@/lib/waiting-packages";
import { revealField } from "@/lib/reveal-field";
import {
  VIN_LOOKING_UP,
  VIN_SERVICE_UNREACHABLE,
  decodeVinWithCatalog,
  vinDecodeHint,
} from "@/lib/vin-lookup";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

type DestinationOption = { id: string; name: string; label: string };

/**
 * A package's price, paid and balance as a chip and a sub-line; used by the
 * waiting list and the container's lines. With its `group` (a package split
 * across containers) the money is the whole group's: payments live on the
 * root and the balance is shown on every part.
 */
export function PackageMoney({ line, group, lang = "en" }: { line: Row; group?: LineGroupSummary; lang?: "en" | "fr" }) {
  const payment = group ? groupPayment(group) : waitingPackageRow(line).payment;
  const hint = group ? partHintText(group, line, lang) : "";
  // A package nobody priced shows nothing: most containers' lines predate prices.
  if (payment.status === "no_price") return hint ? <small className="wpk-part-hint" data-no-translate>{hint}</small> : null;
  return (
    <>
      <span className={statusPillClass(PACKAGE_PAYMENT_TONES[payment.status])}>{PACKAGE_PAYMENT_LABELS[payment.status]}</span>
      {payment.priceCents !== null && (
        <small data-no-translate>
          {moneyText(payment.paidCents)} / {moneyText(payment.priceCents)}
        </small>
      )}
      {hint && <small className="wpk-part-hint" data-no-translate>{hint}</small>}
    </>
  );
}

/** A package's size under its title: "40 × 30 × 20 in · 13.89 ft³". */
export function PackageSize({ line }: { line: Row }) {
  const { size } = waitingPackageRow(line);
  if (!size) return null;
  return <small data-no-translate>{size.dimensionsText} · {size.volumeText}</small>;
}

type WaitingPackagesPanelProps = {
  businessId: string;
  /** The live waiting lines. */
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
  /** The tab strip the containers panel puts above its two lists. */
  tabs: ReactNode;
  destinationOptions: { own: DestinationOption[]; rest: DestinationOption[]; all: DestinationOption[] };
  /** The main destination, or the first one the business lists; null asks. */
  defaultDestination: DestinationRef | null;
  /** The business's own destination rows, to open a receiver's phone on their country. */
  destinationRows: readonly unknown[];
  customerPhoneCountry: string;
  knownCustomers: readonly LotCustomer[];
  staffName: (id: string) => string;
  /** Who can be named as having taken a payment's money. */
  staffOptions: readonly { id: string; name: string }[];
  /**
   * The split groups among every line the containers panel holds (waiting
   * and on containers), built once there: a part's money is its group's.
   */
  groups: ReadonlyMap<string, LineGroupSummary>;
  onFlash: (message: string) => void;
  /** Counters stay off while the business is a preview. */
  enabled: boolean;
  /** Confirmed package requests, shown as Expected above the packages in the shop. */
  expected?: ReactNode;
};

type Modal = "" | "form" | "payment" | "labels";
type SaveMode = "save" | "print" | "another";

/**
 * The packages that have been dropped off and have no container yet: the
 * counter's list. Register one (or several for the same customer in a row),
 * print its label, take a payment, and leave it for a container to claim -
 * the container's own "Add waiting packages" does the claiming.
 */
export function WaitingPackagesPanel({
  businessId,
  rows,
  loading,
  error,
  tabs,
  destinationOptions,
  defaultDestination,
  destinationRows,
  customerPhoneCountry,
  knownCustomers,
  staffName,
  staffOptions,
  groups,
  onFlash,
  enabled,
  expected = null,
}: WaitingPackagesPanelProps) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  // A decimal comma in French; readMoneyInput reads "45,50" and "45.50" alike.
  const moneyPlaceholder = lang === "fr" ? "0,00" : "0.00";
  const [filter, setFilter] = useState("");
  const [modal, setModal] = useState<Modal>("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<WaitingPackageDraft>(() => emptyWaitingPackageDraft(defaultDestination));
  const [editingId, setEditingId] = useState("");
  const [draftError, setDraftError] = useState("");
  // After a refused save, each field shows its own problem, live, until fixed.
  const [triedSave, setTriedSave] = useState(false);
  const [addedThisSitting, setAddedThisSitting] = useState<string[]>([]);
  const [vinHint, setVinHint] = useState("");
  const lastVinRef = useRef("");
  const [customerPick, setCustomerPick] = useState<LotCustomer | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [paymentLineId, setPaymentLineId] = useState("");
  // The packages the labels dialog prints: one from a row, or the one just saved.
  const [labelLines, setLabelLines] = useState<Row[]>([]);

  const sorted = useMemo(() => sortWaitingNewestFirst(rows), [rows]);
  const shown = useMemo(() => filterWaitingPackages(sorted, filter), [sorted, filter]);
  const searching = text(filter, "").length >= 2;
  const paymentLine = paymentLineId ? sorted.find((row) => text(row.id, "") === paymentLineId) : undefined;
  const paymentGroup = paymentLine ? groupForLine(groups, paymentLine) : undefined;

  const customerMatches = useMemo(() => {
    if (!customerMenuOpen || customerPick) return [];
    const typed = draft.customerName.trim();
    if (typed.length < 2) return knownCustomers.slice(0, 6);
    return matchLotCustomers([...knownCustomers], typed);
  }, [knownCustomers, draft.customerName, customerMenuOpen, customerPick]);

  const receiverPhoneCountry = phoneCountryForDestination(
    { destinationCountryId: draft.destinationCountryId, destinationCountryName: draft.destinationCountryName },
    customerPhoneCountry,
    [...destinationRows],
  );
  const volume = volumeCubicFeet(parseInches(draft.lengthIn), parseInches(draft.widthIn), parseInches(draft.heightIn));
  // "Money received now?" opens once a price is entered; who took it is one of these people.
  const moneyAvailable = intakeMoneyAvailable(draft);
  const staffIds = useMemo(() => staffOptions.map((s) => s.id), [staffOptions]);
  const setMoney = (patch: Partial<IntakeMoneyDraft>) => setDraft((d) => ({ ...d, money: { ...d.money, ...patch } }));
  const fieldErrors = triedSave ? validateWaitingPackage(draft, staffIds) : [];
  const fieldError = (field: WaitingPackageField) => waitingPackageFieldMessage(fieldErrors, field);
  // aria-invalid + aria-describedby for a field that shows its own message.
  const invalidProps = (field: WaitingPackageField) => {
    const message = fieldError(field);
    return message ? { "aria-invalid": true, "aria-describedby": `${field}-error` } : {};
  };
  const fieldErrorNote = (field: WaitingPackageField) => {
    const message = fieldError(field);
    return message ? <small className="lst-field-error" id={`${field}-error`}>{message}</small> : null;
  };

  function closeModal() {
    setModal("");
    setDraftError("");
    setEditingId("");
    setPaymentLineId("");
    setLabelLines([]);
  }

  function resetFormState() {
    setDraftError("");
    setTriedSave(false);
    setVinHint("");
    lastVinRef.current = "";
    setCustomerPick(null);
    setCustomerMenuOpen(false);
  }

  function openRegister() {
    setDraft(emptyWaitingPackageDraft(defaultDestination));
    setEditingId("");
    setAddedThisSitting([]);
    resetFormState();
    setModal("form");
  }

  function openEdit(row: Row) {
    const next = waitingPackageDraftFromRow(row);
    setDraft(next);
    setEditingId(text(row.id, ""));
    setAddedThisSitting([]);
    resetFormState();
    // The VIN is the package's own, so the decoder must not fire on render.
    lastVinRef.current = next.vinNumber;
    setModal("form");
  }

  function setKind(kind: WaitingPackageDraft["kind"]) {
    setVinHint("");
    lastVinRef.current = "";
    setDraft((d) => ({
      ...d,
      kind,
      vinNumber: "",
      carMake: "",
      carModel: "",
      carYear: "",
      // A car has no pieces of its own; switching back starts on one barrel.
      pieces: d.pieces.length ? d.pieces : [newPieceDraft()],
      lengthIn: "",
      widthIn: "",
      heightIn: "",
      price: "",
      money: switchIntakeMoney(d, false).money,
    }));
  }

  function pickDestination(id: string) {
    const option = destinationOptions.all.find((o) => o.id === id);
    setDraft((d) => ({ ...d, destinationCountryId: id, destinationCountryName: option ? option.name : "" }));
  }

  function pickCustomer(c: LotCustomer) {
    setCustomerPick(c);
    setCustomerMenuOpen(false);
    setDraft((d) => ({ ...d, customerName: c.name || d.customerName, customerPhone: c.phone || d.customerPhone }));
  }

  // A full VIN is decoded once for the car's make, model and year; what is
  // typed in the selects afterwards is the person's.
  function applyVin(rawVin: string) {
    const clean = cleanVin(rawVin);
    setDraft((d) => ({ ...d, vinNumber: clean }));
    if (clean.length < 17) {
      setVinHint("");
      lastVinRef.current = "";
      return;
    }
    if (clean === lastVinRef.current) return;
    lastVinRef.current = clean;
    void decodeVin(clean);
  }

  async function decodeVin(vin: string) {
    setVinHint(VIN_LOOKING_UP);
    try {
      const result = await decodeVinWithCatalog(vin);
      if (lastVinRef.current !== vin) return;
      if (result.make) {
        setDraft((d) => ({
          ...d,
          carMake: result.make,
          carModel: result.model || d.carModel,
          carYear: result.year || d.carYear,
        }));
      }
      setVinHint(vinDecodeHint(result));
    } catch {
      if (lastVinRef.current === vin) setVinHint(VIN_SERVICE_UNREACHABLE);
    }
  }

  async function save(mode: SaveMode) {
    const errors = validateWaitingPackage(draft, staffIds);
    if (errors.length) {
      setDraftError(waitingPackageMessage(errors));
      setTriedSave(true);
      // The modal scrolls: take the person to the first field to fix.
      const field = firstInvalidWaitingPackageField(errors);
      if (field) window.requestAnimationFrame(() => revealField(document.getElementById(field)));
      return;
    }
    const fail = (failure: { message: string }) => setDraftError(failure.message);

    if (editingId) {
      const line = sorted.find((row) => text(row.id, "") === editingId);
      await runPackageCall(setBusy, async () => {
        // Piece prices travel with the pieces; setContainerLinePrice only
        // for a car's price or the pay-on-arrival switch.
        await httpsCallable(functions, "updateContainerLine")(updateWaitingPackageRequest(businessId, editingId, draft, line));
        const priceRequest = line ? editPriceRequest(businessId, editingId, line, draft) : null;
        if (priceRequest) await httpsCallable(functions, "setContainerLinePrice")(priceRequest);
        onFlash("Package updated.");
        closeModal();
      }, fail);
      return;
    }

    await runPackageCall(setBusy, async () => {
      const response = await httpsCallable(functions, "addWaitingPackage")(addWaitingPackagePayload(businessId, draft));
      const stub = savedPackageStub(response.data, draft);
      const code = text(stub.trackingCode, "");
      if (mode === "print") {
        onFlash(code ? `Package saved: ${code}` : "Package saved.");
        setModal("labels");
        setLabelLines([stub]);
        return;
      }
      if (mode === "save") {
        onFlash(code ? `Package saved: ${code}` : "Package saved.");
        closeModal();
        return;
      }
      // The same sender again, for another receiver or country: only the
      // sender's name, phone and WhatsApp switch stay.
      const whom = draft.receiverName || draft.customerName || "—";
      setAddedThisSitting((list) => [...list, `${containerLineTitle(stub, lang)} → ${whom}${code ? ` (${code})` : ""}`]);
      setDraft(nextPackageForSameSender(draft, defaultDestination));
      resetFormState();
    }, fail);
  }

  async function remove(row: Row) {
    const ok = await confirmImportantAction(
      `Remove ${containerLineTitle(row, "en")} from the waiting list? Its label stops working.`,
      `Retirer ${containerLineTitle(row, "fr")} de la liste d’attente ? Son étiquette ne fonctionnera plus.`,
    );
    if (!ok) return;
    await runPanelAction(setBusy, onFlash, "Package removed.", async () => {
      await httpsCallable(functions, "removeContainerLine")({ businessId, containerId: "", lineId: text(row.id, "") });
    });
  }

  const carFieldsVisible = draft.kind === "car";
  const piecesMode = lineDraftHasPieces(draft);
  const labelCount = waitingDraftLabelCount(draft);

  return (
    <article className="panel">
      <div className="panel-header">
        <div><h2>Containers</h2><span className="panel-count">{shown.length}</span></div>
        <span className="panel-action">
          <button className="lst-add" type="button" disabled={busy || !enabled} onClick={openRegister}><Plus size={16} /> Register a package</button>
        </span>
      </div>
      {tabs}
      <div className="panel-tools">
        <input type="search" placeholder="VIN, customer, phone" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Search waiting packages" />
      </div>
      <p className="panel-lede">Packages customers dropped off before a container was chosen. Print the label now; add them to a container that goes to the same country when it is loading.</p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {expected}

      {loading && rows.length === 0 ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No packages are waiting. Register one when a customer drops it off.</div>
      ) : shown.length === 0 ? (
        <div className="empty-state">{searching ? "No waiting package matches that search." : "No packages are waiting."}</div>
      ) : (
        <div className="mini-table">
          <div className="ctn-table wpk-table">
            <div className="mini-table-head"><span>Package</span><span>Whose</span><span>Destination</span><span>Payment</span><span aria-hidden="true"></span></div>
            {shown.map((row) => {
              const { line, vin } = waitingPackageRow(row);
              // The group's money: a part shows what the whole package owes.
              const group = groupForLine(groups, row);
              const payment = groupPayment(group);
              const partHint = partHintText(group, row, lang);
              const pickupFee = linePickupFeeCents(row);
              const id = text(row.id, "");
              const title = containerLineTitle(row, lang);
              const { summary, warnings } = containerLineWhatsAppText(containerLineWhatsApp(row));
              return (
                <div className="mini-table-row" id={`wpk-line-${id}`} key={id}>
                  <span>
                    {/* "2 barrels" is copy and reads in French; a make, VIN or description is typed. */}
                    <strong data-no-translate={containerLineTitleIsCopy(row) ? undefined : true}>{title}</strong>
                    {vin && vin !== title && <small data-no-translate>{vin}</small>}
                    <PackageSize line={row} />
                    {line.trackingCode && (
                      <small className="ctn-code-row">
                        <code className="ctn-code" data-no-translate>{line.trackingCode}</code>
                        <CopyValue value={line.trackingCode} label="Copy tracking code" />
                      </small>
                    )}
                  </span>
                  <span>
                    <strong data-no-translate>{line.customerName}</strong>
                    <small data-no-translate>{line.customerPhone}</small>
                    {line.receiverName && <small data-no-translate>→ {line.receiverName}{line.receiverPhone ? ` · ${line.receiverPhone}` : ""}</small>}
                    <small className="ctn-wa">{summary}</small>
                    {warnings.map((warning) => (<small className="ctn-wa-warn" key={warning}>{warning}</small>))}
                  </span>
                  <span>
                    <strong>{destinationPlace(line.destinationCountryId, line.destinationCountryName, lang) || "—"}</strong>
                    <small>{formatDate(row.createdAt)}</small>
                    {staffName(text(row.addedByStaffId, "")) && <small data-no-translate>{staffName(text(row.addedByStaffId, ""))}</small>}
                  </span>
                  <span>
                    <span className={statusPillClass(PACKAGE_PAYMENT_TONES[payment.status])}>{PACKAGE_PAYMENT_LABELS[payment.status]}</span>
                    {payment.priceCents !== null && (
                      <small data-no-translate>{moneyText(payment.paidCents)} / {moneyText(payment.priceCents)}</small>
                    )}
                    {payment.balanceCents !== null && payment.balanceCents > 0 && (
                      <small><span data-no-translate>{moneyText(payment.balanceCents)}</span> <span>still owed</span></small>
                    )}
                    {pickupFee > 0 && (
                      <small className="wpk-fee-line"><span>Pickup fee</span> <span data-no-translate>{moneyText(pickupFee)}</span></small>
                    )}
                    {partHint && <small className="wpk-part-hint" data-no-translate>{partHint}</small>}
                  </span>
                  <span className="ctn-row-actions">
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => { setLabelLines([row]); setModal("labels"); }} title="Print labels" aria-label="Print labels"><Tag size={14} /></button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => openEdit(row)} title="Edit package" aria-label="Edit package"><Pencil size={14} /></button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => { setPaymentLineId(id); setModal("payment"); }} title="Record a payment" aria-label="Record a payment"><Banknote size={14} /></button>
                    <button className="ghost-button" type="button" disabled={busy} onClick={() => void remove(row)} title="Remove package" aria-label="Remove package"><X size={14} /></button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {rows.length > 0 && <p className="lst-hint wpk-total" data-no-translate>{waitingCountText(rows.length, lang)}</p>}

      {modal === "form" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(closeModal)}>
          <div className="lst-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <h3>{editingId ? "Edit package" : "Register a package"}</h3>
                <p>{editingId ? "Correct what was written on it." : "What the customer dropped off. It waits here until a container takes it."}</p>
              </div>
              <button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <fieldset className="lst-fieldset">
                <label className="lst-radio"><input type="radio" name="wpkkind" checked={piecesMode} onChange={() => setKind("barrels")} /><span>Barrels, boxes or other things</span></label>
                <label className="lst-radio"><input type="radio" name="wpkkind" checked={draft.kind === "car"} onChange={() => setKind("car")} /><span>A car</span></label>
              </fieldset>
              {piecesMode && (
                <PiecesEditor
                  id="wpk-pieces"
                  pieces={draft.pieces}
                  onChange={(pieces) => setDraft((d) => ({ ...d, pieces }))}
                  showErrors={triedSave}
                  disabled={busy}
                  lang={lang}
                  pickupFee={draft.pickupFee ?? undefined}
                  onPickupFeeChange={(pickupFee) => setDraft((d) => ({ ...d, pickupFee }))}
                />
              )}
              <div className="lst-form-grid">
                {carFieldsVisible && (
                  <>
                    <label className="lst-field wide"><span>VIN</span><input id="wpk-vin" {...invalidProps("wpk-vin")} value={draft.vinNumber} onChange={(e) => applyVin(e.target.value)} placeholder="17 characters" autoFocus />{vinHint && <small className="lst-hint" style={{ color: "var(--money)" }}>{vinHint}</small>}{fieldErrorNote("wpk-vin")}</label>
                    <label className="lst-field"><span>Car make</span>
                      <select value={canonicalMake(draft.carMake) || draft.carMake} onChange={(e) => setDraft((d) => ({ ...d, carMake: e.target.value, carModel: "", carYear: "" }))}>
                        <option value="">Select a make</option>
                        {getMakes().map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    </label>
                    <label className="lst-field"><span>Car model</span>
                      <select disabled={!draft.carMake} value={canonicalModel(draft.carMake, draft.carModel) || draft.carModel} onChange={(e) => setDraft((d) => ({ ...d, carModel: e.target.value, carYear: "" }))}>
                        <option value="">Select a model</option>
                        {getModels(draft.carMake).map((m) => (<option key={m} value={m}>{m}</option>))}
                      </select>
                    </label>
                    <label className="lst-field"><span>Car year</span>
                      <select disabled={!draft.carModel} value={draft.carYear} onChange={(e) => setDraft((d) => ({ ...d, carYear: e.target.value }))}>
                        <option value="">Select a year</option>
                        {getYears(draft.carMake, draft.carModel).map((y) => (<option key={y} value={y}>{y}</option>))}
                      </select>
                    </label>
                  </>
                )}
              </div>

              {carFieldsVisible && (
              <div className="lst-form-grid wpk-size-grid">
                <label className="lst-field"><span>Length (in)</span><input id="wpk-length" {...invalidProps("wpk-length")} inputMode="decimal" value={draft.lengthIn} onChange={(e) => setDraft((d) => ({ ...d, lengthIn: e.target.value }))} placeholder="0" /></label>
                <label className="lst-field"><span>Width (in)</span><input inputMode="decimal" value={draft.widthIn} onChange={(e) => setDraft((d) => ({ ...d, widthIn: e.target.value }))} placeholder="0" /></label>
                <label className="lst-field"><span>Height (in)</span><input inputMode="decimal" value={draft.heightIn} onChange={(e) => setDraft((d) => ({ ...d, heightIn: e.target.value }))} placeholder="0" /></label>
                <p className="lst-hint wpk-volume" data-no-translate>{volume === null ? "" : `${volume} ft³`}</p>
                {fieldErrorNote("wpk-length")}
              </div>
              )}

              <div className="lst-form-grid">
                <label className="lst-field"><span>Destination</span>
                  <select id="wpk-destination" {...invalidProps("wpk-destination")} value={draft.destinationCountryId} onChange={(e) => pickDestination(e.target.value)}>
                    <option value="">Not chosen yet</option>
                    {draft.destinationCountryId && !destinationOptions.all.some((o) => o.id === draft.destinationCountryId) && (
                      <option value={draft.destinationCountryId}>{draft.destinationCountryName ? destinationCountryName(draft.destinationCountryId, lang) : draft.destinationCountryId}</option>
                    )}
                    {destinationOptions.own.length > 0 ? (
                      <>
                        <optgroup label="Your destinations">
                          {destinationOptions.own.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
                        </optgroup>
                        <optgroup label="Every other country">
                          {destinationOptions.rest.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))}
                        </optgroup>
                      </>
                    ) : (
                      destinationOptions.rest.map((option) => (<option key={option.id} value={option.id}>{option.label}</option>))
                    )}
                  </select>
                  {fieldErrorNote("wpk-destination")}
                </label>
                <div className="wpk-price-cell">
                  {/* A car has one price; pieces are priced one by one above, and add up. */}
                  {carFieldsVisible && (
                    <label className="lst-field"><span>Price ($)</span><input id="wpk-price" {...invalidProps("wpk-price")} inputMode="decimal" value={draft.price} onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))} placeholder={moneyPlaceholder} />{fieldErrorNote("wpk-price")}</label>
                  )}
                  <label className="ctn-notify wpk-pay-arrival">
                    <input type="checkbox" checked={draft.payOnArrival} onChange={(e) => setDraft((d) => ({ ...d, payOnArrival: e.target.checked }))} />
                    <span>Pay on arrival</span>
                  </label>
                </div>
              </div>

              {!editingId && (
                <div className="wpk-intake-money">
                  <label className="ctn-notify wpk-pay-arrival">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-checked={draft.money.received}
                      checked={draft.money.received}
                      disabled={busy || (!draft.money.received && !moneyAvailable)}
                      onChange={(e) => setDraft((d) => switchIntakeMoney(d, e.target.checked))}
                    />
                    <span>Money received now?</span>
                  </label>
                  {!draft.money.received && !moneyAvailable && <small className="lst-hint">Enter a price first to record money received now.</small>}
                  {draft.money.received && (
                    <div className="lst-form-grid wpk-payment-form">
                      <label className="lst-field"><span>Amount ($)</span>
                        <input id="wpk-money-amount" {...invalidProps("wpk-money-amount")} inputMode="decimal" value={draft.money.amount} onChange={(e) => setMoney({ amount: e.target.value })} placeholder={moneyPlaceholder} disabled={busy} />
                        {fieldErrorNote("wpk-money-amount")}
                      </label>
                      <label className="lst-field"><span>How it arrived</span>
                        <select id="wpk-money-method" {...invalidProps("wpk-money-method")} value={draft.money.method} disabled={busy} onChange={(e) => setMoney({ method: e.target.value as InvoicePaymentMethod })}>
                          {INVOICE_PAYMENT_METHODS.map((m) => (<option key={m} value={m}>{INVOICE_PAYMENT_METHOD_LABELS[m]}</option>))}
                        </select>
                        {fieldErrorNote("wpk-money-method")}
                      </label>
                      <label className="lst-field"><span>Received by</span>
                        <select id="wpk-received-by" {...invalidProps("wpk-received-by")} value={draft.money.receivedByStaffId} disabled={busy} onChange={(e) => setMoney({ receivedByStaffId: e.target.value })}>
                          <option value="">Choose staff</option>
                          {staffOptions.map((s) => (<option key={s.id} value={s.id} data-no-translate>{s.name}</option>))}
                        </select>
                        {fieldErrorNote("wpk-received-by")}
                      </label>
                      <label className="lst-field wide"><span>Note</span>
                        <input value={draft.money.note} onChange={(e) => setMoney({ note: e.target.value })} placeholder="optional" disabled={busy} />
                      </label>
                    </div>
                  )}
                </div>
              )}

              <div className="lst-form-grid">
                <label className="lst-field" style={{ position: "relative" }}><span>Customer</span>
                  <input id="wpk-customer-name" {...invalidProps("wpk-customer-name")} value={draft.customerName} autoComplete="off" onFocus={() => setCustomerMenuOpen(true)} onBlur={() => window.setTimeout(() => setCustomerMenuOpen(false), 150)} onChange={(e) => { setCustomerPick(null); setCustomerMenuOpen(true); setDraft((d) => ({ ...d, customerName: e.target.value })); }} />
                  {customerMatches.length > 0 && (
                    <ul className="lst-suggest" role="listbox" aria-label="Saved customers">
                      {customerMatches.map((c) => (
                        <li key={c.id} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{c.phone}</small></button></li>
                      ))}
                    </ul>
                  )}
                  {fieldErrorNote("wpk-customer-name")}
                </label>
                <ContactPhone
                  id="wpk-customer-phone"
                  label="Phone"
                  value={draft.customerPhone}
                  onChange={(value) => setDraft((d) => ({ ...d, customerPhone: value }))}
                  notify={draft.notifyCustomer}
                  onNotify={(value) => setDraft((d) => ({ ...d, notifyCustomer: value }))}
                  initialCountryCode={customerPhoneCountry}
                />
              </div>
              <div className="lst-form-grid">
                <label className="lst-field"><span>Receiver at destination</span><input value={draft.receiverName} placeholder="The name written on it" onChange={(e) => setDraft((d) => ({ ...d, receiverName: e.target.value }))} /></label>
                <ContactPhone
                  id="wpk-receiver-phone"
                  label="Receiver's phone"
                  value={draft.receiverPhone}
                  onChange={(value) => setDraft((d) => ({ ...d, receiverPhone: value }))}
                  notify={draft.notifyReceiver}
                  onNotify={(value) => setDraft((d) => ({ ...d, notifyReceiver: value }))}
                  initialCountryCode={receiverPhoneCountry}
                />
              </div>
              {!editingId && <p className="lst-hint">The customer and the receiver get a WhatsApp message when the package is registered, when the container ships and when it arrives. Adding it to a container sends nothing.</p>}
              {!editingId && <p className="lst-hint">All the pieces for one receiver are one package. Save &amp; add another keeps the sender, for a different receiver or country.</p>}
            </div>
            <footer className="lst-modal-foot wpk-foot">
              {/* Beside the buttons, not at the top of a scrolled body: a refusal or a confirmation is always in view. */}
              {draftError && <div className="lst-form-error wpk-foot-note" role="alert">{draftError}</div>}
              {addedThisSitting.length > 0 && (
                <p className="lst-hint wpk-foot-note" role="status" aria-live="polite">Added so far: <span data-no-translate>{addedThisSitting.join("; ")}</span>.</p>
              )}
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button>
              {editingId ? (
                <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save("save")}>
                  {busy ? <RefreshCw className="spin" size={16} /> : null}
                  {busy ? "Saving..." : "Save changes"}
                </button>
              ) : (
                <>
                  <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void save("another")}>Save &amp; add another</button>
                  <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => void save("save")}>Save without printing</button>
                  {/* The primary action: one label per piece. */}
                  <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save("print")}>
                    {busy ? <RefreshCw className="spin" size={16} /> : <Printer size={16} />}
                    {busy ? "Saving..." : <span data-no-translate>{savePrintLabelsText(labelCount, lang)}</span>}
                  </button>
                </>
              )}
            </footer>
          </div>
        </div>
      )}

      {modal === "payment" && paymentLine && (
        <PackagePaymentDialog
          businessId={businessId}
          line={paymentLine}
          group={paymentGroup}
          staffName={staffName}
          staffOptions={staffOptions}
          onClose={closeModal}
          onFlash={onFlash}
        />
      )}

      {modal === "labels" && labelLines.length > 0 && (
        <ContainerLabelsDialog
          businessId={businessId}
          lines={labelLines}
          line={labelLines.length === 1 ? labelLines[0] : undefined}
          onClose={closeModal}
        />
      )}
    </article>
  );
}
