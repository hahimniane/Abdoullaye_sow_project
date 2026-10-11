"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Archive, ArchiveRestore, Pencil, Plus, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { statusPillClass } from "@/lib/status-pill";
import {
  archiveInventoryStoreRequest,
  createInventoryStoreRequest,
  emptyStoreDraft,
  inventoryMessage,
  runInventoryCall,
  storeDraftChanges,
  storeDraftFromStore,
  updateInventoryStoreRequest,
  validateStoreDraft,
  type InventoryStore,
  type StoreDraft,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * The owner's stores: add one, edit its name, address and phone, archive one.
 * Until a business has two stores nothing about stores shows anywhere else;
 * adding the second one is what turns it on (the server makes the first
 * store out of the business's existing products and counts). A store that
 * still holds stock cannot be archived: move its stock first.
 */
export function InventoryStoresDialog({
  businessId,
  stores,
  onClose,
  onFlash,
}: {
  businessId: string;
  /** Every store of the business, archived ones included, oldest first. */
  stores: readonly InventoryStore[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  // null: the list; a store: editing it; "new": adding one.
  const [form, setForm] = useState<InventoryStore | "new" | null>(null);
  const [draft, setDraft] = useState<StoreDraft>(emptyStoreDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = stores.filter((store) => !store.archived);
  const archived = stores.filter((store) => store.archived);

  function openForm(target: InventoryStore | "new") {
    setError("");
    setDraft(target === "new" ? emptyStoreDraft : storeDraftFromStore(target));
    setForm(target);
  }

  async function save() {
    const problems = validateStoreDraft(draft);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    if (form === "new") {
      await runInventoryCall(setBusy, async () => {
        await httpsCallable(functions, "createInventoryStore")(createInventoryStoreRequest(businessId, draft));
        onFlash("Store added.");
        setForm(null);
      }, (failure) => setError(failure.message));
      return;
    }
    if (!form) return;
    // Nothing changed: nothing to send.
    if (Object.keys(storeDraftChanges(form, draft)).length === 0) {
      setForm(null);
      return;
    }
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "updateInventoryStore")(updateInventoryStoreRequest(businessId, form, draft));
      onFlash("Store updated.");
      setForm(null);
    }, (failure) => setError(failure.message));
  }

  async function toggleArchive(store: InventoryStore) {
    setError("");
    const next = !store.archived;
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "archiveInventoryStore")(archiveInventoryStoreRequest(businessId, store.id, next));
      onFlash(next ? "Store archived." : "Store restored.");
    }, (failure) => setError(failure.message));
  }

  function row(store: InventoryStore) {
    return (
      <li key={store.id} className="ivt-manage-row">
        <span className="ivt-manage-main">
          <strong data-no-translate>{store.name}</strong>
          {(store.address || store.phone) && <small data-no-translate>{[store.address, store.phone].filter(Boolean).join(" · ")}</small>}
        </span>
        {store.archived && <span className={statusPillClass("muted")}>Archived</span>}
        <span className="ivt-manage-actions">
          <button className="ghost-button" type="button" disabled={busy} onClick={() => openForm(store)} title="Edit store" aria-label="Edit store"><Pencil size={14} /></button>
          <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleArchive(store)} title={store.archived ? "Restore" : "Archive"} aria-label={store.archived ? "Restore" : "Archive"}>
            {store.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
        </span>
      </li>
    );
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{form === "new" ? "New store" : form ? "Edit store" : "Stores"}</h3>
            <p>
              {active.length < 2
                ? "Your products and counts are in one store today. Add another store to count the stock of each one separately."
                : "Stock is counted in each store. Staff work in their home store; you can let someone work in all of them from People."}
            </p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {form ? (
            <div className="lst-form-grid">
              <label className="lst-field wide"><span>Store name</span>
                <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus disabled={busy} />
              </label>
              <label className="lst-field wide"><span>Address</span>
                <input value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="optional" disabled={busy} />
              </label>
              <label className="lst-field"><span>Phone</span>
                <input inputMode="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="optional" disabled={busy} />
              </label>
            </div>
          ) : (
            <>
              {stores.length === 0 ? (
                <div className="empty-state">No store added yet. Your products stay in your main store until you add one.</div>
              ) : (
                <>
                  {active.length > 0 && <ul className="ivt-manage-list">{active.map(row)}</ul>}
                  {archived.length > 0 && (
                    <>
                      <h4 className="ivt-manage-sub">Archived stores</h4>
                      <ul className="ivt-manage-list">{archived.map(row)}</ul>
                    </>
                  )}
                </>
              )}
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          {form ? (
            <>
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => { setForm(null); setError(""); }}>Back</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void save()}>
                {busy ? <RefreshCw className="spin" size={16} /> : form === "new" ? <Plus size={16} /> : null}
                {busy ? "Saving..." : form === "new" ? "Add store" : "Save changes"}
              </button>
            </>
          ) : (
            <>
              <button className="lst-btn ghost" type="button" onClick={onClose}>Close</button>
              <button className="lst-add" type="button" disabled={busy} onClick={() => openForm("new")}><Plus size={16} /> Add a store</button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
