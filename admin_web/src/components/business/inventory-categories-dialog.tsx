"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Archive, ArchiveRestore, Check, Pencil, Plus, RefreshCw, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { statusPillClass } from "@/lib/status-pill";
import {
  archiveInventoryCategoryRequest,
  createInventoryCategoryRequest,
  inventoryMessage,
  renameInventoryCategoryRequest,
  runInventoryCall,
  validateCategoryName,
  type InventoryCategory,
} from "@/lib/inventory";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/**
 * The business's product categories: add one, rename one, archive one. A
 * rename shows everywhere at once; an archived category leaves the product
 * form's list but the products keep it, and it can come back. Categories are
 * never deleted. The list is shared by every store.
 */
export function InventoryCategoriesDialog({
  businessId,
  categories,
  onClose,
  onFlash,
}: {
  businessId: string;
  /** Every category of the business, archived ones included, by name. */
  categories: readonly InventoryCategory[];
  onClose: () => void;
  onFlash: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = categories.filter((category) => !category.archived);
  const archived = categories.filter((category) => category.archived);

  async function add() {
    const problems = validateCategoryName(name, categories);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "createInventoryCategory")(createInventoryCategoryRequest(businessId, name));
      setName("");
      onFlash("Category added.");
    }, (failure) => setError(failure.message));
  }

  async function rename(category: InventoryCategory) {
    const problems = validateCategoryName(editName, categories, category.id);
    if (problems.length) {
      setError(inventoryMessage(problems));
      return;
    }
    setError("");
    // The same name (even re-typed in other case) is not a change worth a round trip.
    if (editName.trim() === category.name) {
      setEditingId("");
      return;
    }
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "renameInventoryCategory")(renameInventoryCategoryRequest(businessId, category.id, editName));
      setEditingId("");
      onFlash("Category renamed.");
    }, (failure) => setError(failure.message));
  }

  async function toggleArchive(category: InventoryCategory) {
    setError("");
    const next = !category.archived;
    await runInventoryCall(setBusy, async () => {
      await httpsCallable(functions, "archiveInventoryCategory")(archiveInventoryCategoryRequest(businessId, category.id, next));
      onFlash(next ? "Category archived. Its products keep it." : "Category restored.");
    }, (failure) => setError(failure.message));
  }

  function row(category: InventoryCategory) {
    const editing = editingId === category.id;
    return (
      <li key={category.id} className="ivt-manage-row">
        {editing ? (
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); void rename(category); }
              if (e.key === "Escape") setEditingId("");
            }}
            aria-label="Category name"
            autoFocus
            disabled={busy}
            data-no-translate
          />
        ) : (
          <strong data-no-translate>{category.name}</strong>
        )}
        {category.archived && <span className={statusPillClass("muted")}>Archived</span>}
        <span className="ivt-manage-actions">
          {editing ? (
            <>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void rename(category)} title="Save the name" aria-label="Save the name"><Check size={14} /></button>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => setEditingId("")} title="Cancel" aria-label="Cancel"><X size={14} /></button>
            </>
          ) : (
            <>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => { setEditingId(category.id); setEditName(category.name); setError(""); }} title="Rename" aria-label="Rename"><Pencil size={14} /></button>
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void toggleArchive(category)} title={category.archived ? "Restore" : "Archive"} aria-label={category.archived ? "Restore" : "Archive"}>
                {category.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
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
            <h3>Categories</h3>
            <p>Group your products. The same list is used in every store. A category is archived, never deleted: its products keep it.</p>
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
              placeholder="New category name"
              aria-label="New category name"
              disabled={busy}
            />
            <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void add()}>
              {busy ? <RefreshCw className="spin" size={16} /> : <Plus size={16} />} Add
            </button>
          </div>
          {categories.length === 0 ? (
            <div className="empty-state">No categories yet. Add the first one above, or add one while you create a product.</div>
          ) : (
            <>
              {active.length > 0 && <ul className="ivt-manage-list">{active.map(row)}</ul>}
              {archived.length > 0 && (
                <>
                  <h4 className="ivt-manage-sub">Archived categories</h4>
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
