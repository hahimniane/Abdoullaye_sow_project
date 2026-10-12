"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Archive, ArchiveRestore, Check, Pencil, Plus, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { statusPillClass } from "@/lib/status-pill";
import {
  archiveInventoryBrandRequest,
  createInventoryBrandRequest,
  inventoryMessage,
  renameInventoryBrandRequest,
  runInventoryCall,
  validateBrandName,
  type InventoryBrand,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * The business's product brands: add one, rename one, archive one. A
 * rename shows everywhere at once; an archived brand leaves the product
 * form's list but the products keep it, and it can come back. Brands are
 * never deleted. The list is shared by every store.
 */
export function InventoryBrandsDialog({
  businessId,
  brands,
  onClose,
  onFlash,
}: {
  businessId: string;
  /** Every brand of the business, archived ones included, by name. */
  brands: readonly InventoryBrand[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = brands.filter((brand) => !brand.archived);
  const archived = brands.filter((brand) => brand.archived);

  async function add() {
    const problems = validateBrandName(name, brands);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "createInventoryBrand")(createInventoryBrandRequest(businessId, name));
      setName("");
      onFlash("Brand added.");
    }, (failure) => setError(failure.message));
  }

  async function rename(brand: InventoryBrand) {
    const problems = validateBrandName(editName, brands, brand.id);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    // The same name (even re-typed in other case) is not a change worth a round trip.
    if (editName.trim() === brand.name) {
      setEditingId("");
      return;
    }
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "renameInventoryBrand")(renameInventoryBrandRequest(businessId, brand.id, editName));
      setEditingId("");
      onFlash("Brand renamed.");
    }, (failure) => setError(failure.message));
  }

  async function toggleArchive(brand: InventoryBrand) {
    setError("");
    const next = !brand.archived;
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "archiveInventoryBrand")(archiveInventoryBrandRequest(businessId, brand.id, next));
      onFlash(next ? "Brand archived. Its products keep it." : "Brand restored.");
    }, (failure) => setError(failure.message));
  }

  function row(brand: InventoryBrand) {
    const editing = editingId === brand.id;
    return (
      <li key={brand.id} className="ivt-manage-row">
        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void rename(brand); }
              if (e.key === "Escape") setEditingId("");
            }}
            aria-label="Brand name"
            autoFocus
            disabled={busy}
            data-no-translate
          />
        ) : (
          <strong data-no-translate>{brand.name}</strong>
        )}
        {brand.archived && <span className={statusPillClass("muted")}>Archived</span>}
        <span className="ivt-manage-actions">
          {editing ? (
            <>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void rename(brand)} title="Save the name" aria-label="Save the name"><Check size={14} /></button>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => setEditingId("")} title="Cancel" aria-label="Cancel"><X size={14} /></button>
            </>
          ) : (
            <>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => { setEditingId(brand.id); setEditName(brand.name); setError(""); }} title="Rename" aria-label="Rename"><Pencil size={14} /></button>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleArchive(brand)} title={brand.archived ? "Restore" : "Archive"} aria-label={brand.archived ? "Restore" : "Archive"}>
                {brand.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
              </button>
            </>
          )}
        </span>
      </li>
    );
  }

  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
      <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>Brands</h3>
            <p>A brand goes in front of a product's name, like “Jordan 11”. The same list is used in every store. A brand is archived, never deleted: its products keep it.</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="ivt-inline-add">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void add(); } }}
              placeholder="New brand name"
              aria-label="New brand name"
              disabled={busy}
            />
            <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void add()}>
              {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />} Add
            </button>
          </div>
          {brands.length === 0 ? (
            <div className="empty-state">No brands yet. Add the first one above, or add one while you create a product.</div>
          ) : (
            <>
              {active.length > 0 && <ul className="ivt-manage-list">{active.map(row)}</ul>}
              {archived.length > 0 && (
                <>
                  <h4 className="ivt-manage-sub">Archived brands</h4>
                  <ul className="ivt-manage-list">{archived.map(row)}</ul>
                </>
              )}
            </>
          )}
        </div>
        <footer className="lst-modal-foot">
          <button className="lst-btn ghost" type="button" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
