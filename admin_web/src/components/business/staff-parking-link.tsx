"use client";

import { useMemo, useState } from "react";
import { Link2, RefreshCw, Search, Unlink, X } from "lucide-react";

import { useParkingLinkCars } from "@/lib/business-data";
import { overlayDismiss } from "@/lib/overlay-dismiss";
import { parkingLinkChoices, parkingLinkCustomers, type ParkingLinkCustomer } from "@/lib/staff-expense-console";
import type { StaffParkingLink } from "@/lib/staff-expense-credit";

/**
 * A staff member's "Parking bill" on the People page
 * (docs/STAFF_EXPENSE_CREDIT.md §1.2): the parking customer whose month-end
 * bill their lot expenses come off, or "Not linked". The owner (or a
 * platform admin) links it once; everyone else only reads it.
 */
export function StaffParkingBillField({
  link,
  canLink,
  busy,
  onLink,
  onUnlink,
}: {
  link: StaffParkingLink | null | undefined;
  canLink: boolean;
  busy: boolean;
  onLink: () => void;
  onUnlink: () => void;
}) {
  const linked = Boolean(link?.customerKey);
  return (
    <div className="pk-link-field">
      <div className="pk-link-value">
        <span className="lst-form-section" style={{ margin: 0 }}>Parking bill</span>
        {linked ? (
          <span>
            <strong data-no-translate>{link?.customerName || link?.customerPhone || link?.customerKey}</strong>
            {link?.customerPhone && link.customerName ? <small data-no-translate> · {link.customerPhone}</small> : null}
          </span>
        ) : (
          <span className="pk-link-none">Not linked</span>
        )}
        <small className="pk-link-hint">Lot expenses this person pays come off this bill at month end.</small>
      </div>
      {canLink && (
        <div className="pk-link-actions">
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onLink}>
            <Link2 size={14} /> {linked ? "Change" : "Link"}
          </button>
          {linked && (
            <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={onUnlink}>
              <Unlink size={14} /> Unlink
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The picker: the business's parking customers (cars of the last twelve
 * months, grouped the way month-end bills group them), the likely match
 * first - the same phone, or a shared word in the name.
 */
export function StaffParkingLinkPicker({
  businessId,
  staff,
  currentKey,
  busy,
  error,
  onPick,
  onClose,
}: {
  businessId: string;
  staff: { name: string; phone: string };
  currentKey: string;
  busy: boolean;
  error: string;
  onPick: (customer: ParkingLinkCustomer) => void;
  onClose: () => void;
}) {
  const cars = useParkingLinkCars(businessId, true);
  const [search, setSearch] = useState("");
  const customers = useMemo(() => parkingLinkCustomers(cars.rows), [cars.rows]);
  const choices = useMemo(() => parkingLinkChoices(staff, customers, search), [staff, customers, search]);
  const suggestedCount = choices.filter((c) => c.suggested).length;
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!busy) onClose(); })}>
      <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div><h3>Link a parking bill</h3><p data-no-translate>{staff.name}</p></div>
          <button className="lst-icon-btn" type="button" disabled={busy} onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <p className="lst-hint" style={{ marginTop: 0 }}>Choose the parking customer whose monthly bill this person pays. Their lot expenses come off that bill; whatever is left, the business owes them.</p>
          <label className="lst-field wide pk-link-search">
            <span><Search size={13} /> Find a customer</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or phone" aria-label="Find a parking customer" />
          </label>
          {cars.error && <div className="error-box" role="alert">The parked cars could not be loaded.</div>}
          {cars.loading && customers.length === 0 ? (
            <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
          ) : choices.length === 0 ? (
            <div className="empty-state">{search ? "No parking customer matches." : "No car was parked in the last twelve months."}</div>
          ) : (
            <ul className="pk-link-list">
              {choices.map((c, i) => (
                <li key={c.key}>
                  {i === 0 && suggestedCount > 0 && <div className="lst-form-section pk-link-group">Suggested</div>}
                  {i === suggestedCount && suggestedCount > 0 && <div className="lst-form-section pk-link-group">Everyone else</div>}
                  <button type="button" className={`pk-link-choice${c.key === currentKey ? " on" : ""}`} disabled={busy} onClick={() => onPick(c)}>
                    <span>
                      <strong data-no-translate>{c.name || c.phone || "—"}</strong>
                      <small><span data-no-translate>{c.phone}</span>{c.phone ? " · " : ""}{`${c.cars} ${c.cars === 1 ? "parked car" : "parked cars"}`}</small>
                    </span>
                    {c.key === currentKey ? <span className="lst-badge ok">Linked</span> : c.suggested ? <span className="lst-badge navy">Likely match</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="lst-modal-foot">
          {busy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}
