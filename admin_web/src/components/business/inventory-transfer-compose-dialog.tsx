"use client";

import { useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { Minus, Plus, RefreshCw, Save, Send, Trash2, X } from "lucide-react";

import { functions } from "@/lib/firebase";
import { currentLanguage } from "@/lib/format";
import {
  filterInventoryItems,
  productDisplayName,
  type InventoryBrand,
  type InventoryCategory,
  type InventoryItem,
  type InventoryViewer,
  type StockIndex,
  type StoreAccess,
} from "@/lib/inventory";
import {
  addComposeLine,
  clampQuantity,
  composeFromDraft,
  composeItemsCount,
  composeProblemMessage,
  composeProblems,
  composeRequest,
  inStoreText,
  mergeComposeLines,
  newTransferRequestId,
  readSendAnswer,
  readTypedQuantity,
  seesAllStores,
  sendButtonText,
  sendableStores,
  sentNoticeText,
  sentToText,
  storeAvailable,
  transferCountsText,
  transferFailure,
  type ComposeLine,
  type InventoryTransfer,
} from "@/lib/inventory-transfers";
import { overlayDismiss } from "@/lib/overlay-dismiss";

/** How many search matches the picker lists at once. */
const SEARCH_RESULTS = 8;

/**
 * New transfer (or a draft continued): the store it leaves (fixed to their
 * store for a store's staff, a picker for whoever sees every store), the
 * store it goes to, and the products found by typing their name, each with
 * how many the source store holds. A line can never ask for more than that.
 * Save draft reserves nothing; Send takes the stock out of the source store
 * at once (`sendInventoryTransfer`) and shows what is on its way. The
 * request's key is made when the dialog opens (or is the draft's own), so a
 * retried Send never sends twice and saving a draft again updates it.
 */
export function InventoryTransferComposeDialog({
  businessId,
  viewer,
  access,
  productRows,
  items,
  categories,
  brands,
  stock,
  stockReady,
  draft,
  startItemId,
  startFromStoreId,
  onClose,
  onFlash,
  onOpenTransfer,
}: {
  businessId: string;
  viewer: InventoryViewer;
  access: StoreAccess;
  /** The on-sale products as read (what the search runs over). */
  productRows: readonly unknown[];
  /** The same products, read, with their current brand. */
  items: readonly InventoryItem[];
  categories: readonly InventoryCategory[];
  brands: readonly InventoryBrand[];
  stock: StockIndex;
  /** The per-store counts have arrived: until then a line's maximum is unknown and the server decides. */
  stockReady: boolean;
  /** A draft being continued; null for a new transfer. */
  draft: InventoryTransfer | null;
  /** "Send to another store" on a product starts with that product. */
  startItemId: string;
  startFromStoreId: string;
  onClose: () => void;
  onFlash: (message: string) => void;
  /** After a send, open the transfer in the list. */
  onOpenTransfer: (transferId: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const fromChoices = useMemo(() => sendableStores(viewer, access.stores), [viewer, access.stores]);
  const pickFrom = seesAllStores(viewer);
  const [initial] = useState(() => {
    if (draft) return composeFromDraft(draft);
    const from = fromChoices.some((store) => store.id === startFromStoreId)
      ? startFromStoreId
      : fromChoices.some((store) => store.id === access.defaultStoreId) ? access.defaultStoreId : fromChoices[0]?.id ?? "";
    return {
      clientRequestId: newTransferRequestId(),
      fromStoreId: from,
      toStoreId: access.stores.find((store) => store.id !== from)?.id ?? "",
      lines: startItemId ? [{ itemId: startItemId, quantity: 1 }] : [],
    };
  });
  const clientRequestId = initial.clientRequestId;
  const [fromStoreId, setFromStoreId] = useState(initial.fromStoreId);
  const [toStoreId, setToStoreId] = useState(initial.toStoreId);
  const [lines, setLines] = useState<ComposeLine[]>(initial.lines);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<"" | "draft" | "send">("");
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  // What the server said the store holds now (insufficient_stock), until the source store changes.
  const [serverAvailable, setServerAvailable] = useState<Record<string, number>>({});
  const [flagged, setFlagged] = useState<string[]>([]);
  const [sent, setSent] = useState<{ transferId: string; code: string; items: number; lines: ComposeLine[] } | null>(null);

  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  // A draft's lines keep their saved names, for a product archived or deleted since.
  const savedNames = useMemo(
    () => new Map((draft?.lines ?? []).map((line) => [line.itemId, productDisplayName(line)])),
    [draft],
  );
  const storeName = (id: string) => access.stores.find((store) => store.id === id)?.name ?? "";
  const fromName = storeName(fromStoreId) || draft?.fromStoreName || "";
  const toName = storeName(toStoreId) || draft?.toStoreName || "";
  const nameOf = (itemId: string) => {
    const item = itemById.get(itemId);
    return item ? productDisplayName(item) : savedNames.get(itemId) ?? itemId;
  };
  const available = (itemId: string): number | null =>
    serverAvailable[itemId] ?? storeAvailable(itemById.get(itemId), fromStoreId, access.stores, stock, stockReady);

  const merged = mergeComposeLines(lines);
  const itemsCount = composeItemsCount(lines);
  const check = composeProblems({ fromStoreId, toStoreId, lines }, available, true);
  const sendBlocked = check.problems.length > 0 || flagged.length > 0;
  const results = useMemo(() => {
    if (!search.trim()) return [];
    return filterInventoryItems(productRows, "all", search, { categories, brands }).slice(0, SEARCH_RESULTS);
  }, [productRows, search, categories, brands]);

  function changeFrom(id: string) {
    setFromStoreId(id);
    setServerAvailable({});
    if (id === toStoreId) setToStoreId(access.stores.find((store) => store.id !== id)?.id ?? "");
  }

  function addProduct(itemId: string) {
    const max = available(itemId);
    if (max !== null && max <= 0) return;
    setLines((current) => addComposeLine(current, itemId, 1, max));
    setSearch("");
    setError("");
  }

  function setQuantity(itemId: string, quantity: number) {
    const max = available(itemId);
    setLines((current) => current.map((line) => (line.itemId === itemId ? { ...line, quantity: clampQuantity(quantity, 1, max) } : line)));
    setTyped((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }

  function typeQuantity(itemId: string, value: string) {
    setTyped((current) => ({ ...current, [itemId]: value }));
    const n = readTypedQuantity(value, 1, available(itemId));
    if (n !== null) setLines((current) => current.map((line) => (line.itemId === itemId ? { ...line, quantity: n } : line)));
  }

  function removeLine(itemId: string) {
    setLines((current) => current.filter((line) => line.itemId !== itemId));
    setFlagged((current) => current.filter((id) => id !== itemId));
  }

  async function submit(kind: "draft" | "send") {
    if (inFlight.current) return;
    const problems = composeProblems({ fromStoreId, toStoreId, lines }, available, kind === "send").problems;
    if (problems.length) {
      setError(composeProblemMessage(problems));
      return;
    }
    inFlight.current = true;
    setBusy(kind);
    setError("");
    try {
      const request = composeRequest(businessId, clientRequestId, fromStoreId, toStoreId, lines);
      const result = await httpsCallable(functions, kind === "send" ? "sendInventoryTransfer" : "saveInventoryTransferDraft")(request);
      const answer = readSendAnswer(result.data);
      if (kind === "draft") {
        onFlash("Draft saved. Nothing is reserved until you send it.");
        onClose();
        return;
      }
      setSent({ transferId: answer.transferId, code: answer.code, items: answer.itemsCount || itemsCount, lines: merged });
      onFlash("Transfer sent.");
    } catch (failure) {
      const read = transferFailure(failure);
      setError(read.message);
      if (Object.keys(read.available).length) setServerAvailable((current) => ({ ...current, ...read.available }));
      if ((read.reason === "item_archived" || read.reason === "item_not_found") && read.itemIds.length) setFlagged(read.itemIds);
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  if (sent) {
    const notice = sentNoticeText(sent.items, toName, lang);
    return (
      <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(onClose)}>
        <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
          <header className="lst-modal-head">
            <div>
              <h3 data-no-translate>{sentToText(toName, lang)}</h3>
              {sent.code && <p><code className="ctn-code" data-no-translate>{sent.code}</code></p>}
            </div>
            <button className="lst-icon-btn" type="button" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </header>
          <div className="lst-modal-body">
            <p className="ivt-tr-lead" data-no-translate>{notice.lead}</p>
            <ul className="ivt-tr-sent-lines">
              {sent.lines.map((line) => (
                <li key={line.itemId}><span data-no-translate>{nameOf(line.itemId)}</span><b data-no-translate>{line.quantity}</b></li>
              ))}
            </ul>
            <p className="lst-hint" data-no-translate>{notice.hint}</p>
          </div>
          <footer className="lst-modal-foot">
            {sent.transferId && (
              <button className="lst-btn ghost" type="button" onClick={() => { onOpenTransfer(sent.transferId); onClose(); }}>Open transfer</button>
            )}
            <button className="lst-add" type="button" onClick={onClose}>Done</button>
          </footer>
        </div>
      </div>
    );
  }

  const working = busy !== "";
  return (
    <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(working ? () => undefined : onClose)}>
      <div className="lst-modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <header className="lst-modal-head">
          <div>
            <h3>{draft ? "Continue the draft" : "New transfer"}</h3>
            <p>The stock leaves the store when you send. The other store confirms what arrived.</p>
          </div>
          <button className="lst-icon-btn" type="button" onClick={onClose} disabled={working} aria-label="Close"><X size={18} /></button>
        </header>
        <div className="lst-modal-body">
          {error && <div className="lst-form-error" role="alert">{error}</div>}
          <div className="lst-form-grid">
            <label className="lst-field"><span>From store</span>
              {pickFrom ? (
                <select value={fromStoreId} onChange={(e) => changeFrom(e.target.value)} disabled={working} aria-label="From store">
                  <option value="">Choose a store</option>
                  {fromChoices.map((store) => (
                    <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
                  ))}
                </select>
              ) : (
                <strong className="ivt-tr-fixed" data-no-translate>{fromName}</strong>
              )}
            </label>
            <label className="lst-field"><span>To store</span>
              <select value={toStoreId} onChange={(e) => setToStoreId(e.target.value)} disabled={working} aria-label="To store">
                <option value="">Choose a store</option>
                {access.stores.filter((store) => store.id !== fromStoreId).map((store) => (
                  <option key={store.id} value={store.id} data-no-translate>{store.name}</option>
                ))}
              </select>
            </label>
            <label className="lst-field wide"><span>Add a product</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Type a brand, name or code"
                aria-label="Search products"
                disabled={working || !fromStoreId}
              />
            </label>
          </div>
          {results.length > 0 && (
            <ul className="ivt-tr-results" role="listbox" aria-label="Matching products">
              {results.map((item) => {
                const max = available(item.id);
                const none = max !== null && max <= 0;
                return (
                  <li key={item.id}>
                    <button type="button" className="ivt-tr-result" disabled={none || working} onClick={() => addProduct(item.id)}>
                      <span><strong data-no-translate>{productDisplayName(item)}</strong> <small><code className="ctn-code" data-no-translate>{item.code}</code></small></span>
                      {max !== null && <small data-no-translate>{inStoreText(max, fromName, lang)}</small>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {search.trim() && results.length === 0 && <p className="lst-hint">No product matches that search.</p>}

          {merged.length === 0 ? (
            <div className="empty-state">No products yet. Type a product's name above to add it.</div>
          ) : (
            <ul className="ivt-tr-lines">
              {merged.map((line) => {
                const max = available(line.itemId);
                const atMax = max !== null && line.quantity >= max;
                const over = max !== null && line.quantity > max;
                const bad = flagged.includes(line.itemId);
                return (
                  <li key={line.itemId} className={over || bad ? "ivt-tr-line-bad" : undefined}>
                    <div className="ivt-tr-line-main">
                      <strong data-no-translate>{nameOf(line.itemId)}</strong>
                      {max !== null && <small data-no-translate>{inStoreText(max, fromName, lang)}</small>}
                      {atMax && !over && <small className="ivt-tr-cap">That&apos;s all of them. You can&apos;t send more than the store has.</small>}
                      {over && <small className="ivt-overdue">More than the store has. Lower it to send.</small>}
                      {bad && <small className="ivt-overdue">Take this product out to send.</small>}
                    </div>
                    <div className="wpk-split-stepper">
                      <button className="ghost-button" type="button" disabled={working || line.quantity <= 1} onClick={() => setQuantity(line.itemId, line.quantity - 1)} aria-label="One less"><Minus size={14} /></button>
                      <input
                        className="ivt-tr-qty"
                        inputMode="numeric"
                        value={typed[line.itemId] ?? String(line.quantity)}
                        onChange={(e) => typeQuantity(line.itemId, e.target.value)}
                        onBlur={() => setQuantity(line.itemId, line.quantity)}
                        disabled={working}
                        aria-label="How many to send"
                      />
                      <button className="ghost-button" type="button" disabled={working || atMax} onClick={() => setQuantity(line.itemId, line.quantity + 1)} aria-label="One more"><Plus size={14} /></button>
                      <button className="ghost-button" type="button" disabled={working} onClick={() => removeLine(line.itemId)} title="Take it out" aria-label="Take it out"><Trash2 size={14} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {!stockReady && merged.length > 0 && <p className="lst-hint"><RefreshCw className="spin" size={12} /> Loading the store counts…</p>}
        </div>
        <footer className="lst-modal-foot">
          <span className="ivt-tr-foot-note">
            {merged.length > 0 && <b data-no-translate>{transferCountsText({ itemsCount, productsCount: merged.length }, lang)}</b>}
            <small>The destination team and the owner are notified when you send.</small>
          </span>
          <button className="lst-btn ghost" type="button" disabled={working} aria-busy={busy === "draft"} onClick={() => void submit("draft")}>
            {busy === "draft" ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
            {busy === "draft" ? "Saving..." : "Save draft"}
          </button>
          <button className="lst-add" type="button" disabled={working || sendBlocked} aria-busy={busy === "send"} onClick={() => void submit("send")}>
            {busy === "send" ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
            {busy === "send" ? <span>Sending...</span> : <span data-no-translate>{sendButtonText(itemsCount, lang)}</span>}
          </button>
        </footer>
      </div>
    </div>
  );
}
