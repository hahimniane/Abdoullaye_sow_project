"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCheck, ClipboardCheck, Pencil, Plus, RefreshCw, Tag, Trash2, XCircle } from "lucide-react";

import { LoadMoreButton } from "@/components/show-more";
import { InventoryStoreFilter } from "@/components/business/inventory-store-filter";
import { InventoryTransferCancelDialog } from "@/components/business/inventory-transfer-cancel-dialog";
import { InventoryTransferReceiveDialog } from "@/components/business/inventory-transfer-receive-dialog";
import { InventoryTransferReviewDialog } from "@/components/business/inventory-transfer-review-dialog";
import { useInventoryTransfers, useLiveDocRead } from "@/lib/business-data";
import { currentLanguage } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import { itemCountText, productDisplayName, storeNameIndex, type StoreAccess } from "@/lib/inventory";
import {
  TRANSFER_CHIPS,
  TRANSFER_CHIP_LABELS,
  canCancelTransfer,
  canContinueDraft,
  canDiscardDraft,
  canReceiveTransfer,
  canResolveTransfer,
  lineResultText,
  mergeTransferRows,
  missingText,
  monthStartMs,
  sendableStores,
  trackRecordLines,
  transferChipCounts,
  transferChipList,
  transferCountsText,
  transferStatusView,
  transferStoreName,
  transferTiles,
  transferVisibleToViewer,
  transfersCountText,
  withDifferencesText,
  type InventoryTransfer,
  type TransferChip,
  type TransferFocus,
  type TransferStatusView,
  type TransferViewer,
} from "@/lib/inventory-transfers";
import { statusPillClass } from "@/lib/status-pill";

/** A transfer opened from a notification waits this long to be read before it counts as not available. */
const FOCUS_READ_TIMEOUT_MS = 15_000;
/** The card ages ("In transit 3 days") are worked out again this often. */
const CLOCK_TICK_MS = 5 * 60_000;

type Dialog = "" | "receive" | "review" | "cancel";

function pillClass(status: TransferStatusView): string {
  return status.tone === "danger" ? "status-pill compact danger" : statusPillClass(status.tone);
}

/**
 * Inventory → Transfers: what is on the road between the stores, what did not
 * arrive, and what was received this month (tiles); a list filtered by All /
 * In transit / Needs review / Drafts (and by store, for whoever sees every
 * store); and the open transfer's detail: Sent vs Received per product with
 * the Result, the receive note, and the track record, with the actions the
 * person may take (Receive, Settle differences, Cancel, Continue, Discard).
 *
 * Reads (docs/INVENTORY.md "Rules and indexes"): the open transfers come from
 * the panel (it also counts the tab's badge); the recent ones and the month's
 * received ones are read here; the open transfer is read by id, so a
 * notification shows it even when no list holds it. A store's staff read
 * from-and-to their store (two queries merged), the only reads the rules
 * allow them.
 */
export function InventoryTransfersView({
  businessId,
  enabled,
  viewer,
  access,
  zone,
  todayKey,
  storeFilter,
  onStoreFilter,
  openRows,
  openLoading,
  openError,
  focus,
  onCompose,
  onTags,
  onFlash,
}: {
  businessId: string;
  enabled: boolean;
  viewer: TransferViewer;
  access: StoreAccess;
  zone: string;
  todayKey: string;
  storeFilter: string;
  onStoreFilter: (storeId: string) => void;
  openRows: readonly unknown[];
  openLoading: boolean;
  openError: string;
  /** A transfer alert was opened: show that transfer. A new object per alert. */
  focus: TransferFocus | null;
  /** New transfer (null), or continue a draft. */
  onCompose: (draft: InventoryTransfer | null) => void;
  onTags: (item: { id: string; name: string; brand?: string; code: string }) => void;
  onFlash: (message: string) => void;
}) {
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const scoped = access.scopedStoreId;
  const scopeStore = access.canSeeAll ? storeFilter : scoped;
  const since = useMemo(() => monthStartMs(todayKey, zone), [todayKey, zone]);
  const recent = useInventoryTransfers("recent", businessId, enabled, scoped);
  const month = useInventoryTransfers("month", businessId, enabled, scoped, since);

  const [chip, setChip] = useState<TransferChip>("all");
  const [selectedId, setSelectedId] = useState(focus?.transferId ?? "");
  const [dialog, setDialog] = useState<Dialog>("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A transfer alert (a new one, or the same one tapped again) opens that transfer.
  const [prevFocus, setPrevFocus] = useState<TransferFocus | null>(focus);
  if (focus !== prevFocus) {
    setPrevFocus(focus);
    if (focus) {
      setSelectedId(focus.transferId);
      setChip("all");
    }
  }
  const detailRead = useLiveDocRead("inventoryTransfers", selectedId, enabled && Boolean(selectedId));
  const detailVisible = Boolean(detailRead.row) && transferVisibleToViewer(detailRead.row, businessId, viewer);
  const focusKey = focus?.key ?? -1;
  const focusPending = Boolean(focus) && selectedId === focus?.transferId && !detailRead.settled;
  const [timedOutKey, setTimedOutKey] = useState(-2);
  useEffect(() => {
    if (!focusPending) return undefined;
    const timer = window.setTimeout(() => setTimedOutKey(focusKey), FOCUS_READ_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [focusPending, focusKey]);
  const focusUnavailable = Boolean(focus) && selectedId === focus?.transferId && !detailVisible
    && (detailRead.settled || timedOutKey === focusKey);

  const transfers = useMemo(
    () => mergeTransferRows([openRows, recent.rows, detailVisible && detailRead.row ? [detailRead.row] : []], businessId, viewer),
    [openRows, recent.rows, detailVisible, detailRead.row, businessId, viewer],
  );
  const openTransfers = useMemo(() => mergeTransferRows([openRows], businessId, viewer), [openRows, businessId, viewer]);
  const monthTransfers = useMemo(() => mergeTransferRows([month.rows], businessId, viewer), [month.rows, businessId, viewer]);
  const tiles = useMemo(() => transferTiles(openTransfers, monthTransfers, scopeStore, since), [openTransfers, monthTransfers, scopeStore, since]);
  const counts = useMemo(() => transferChipCounts(transfers, scopeStore), [transfers, scopeStore]);
  const shown = useMemo(() => transferChipList(transfers, chip, scopeStore), [transfers, chip, scopeStore]);
  const storeNames = useMemo(() => storeNameIndex(access.stores), [access.stores]);
  const selected = useMemo(
    () => (selectedId ? transfers.find((t) => t.id === selectedId) ?? null : null),
    [transfers, selectedId],
  );
  const canSend = sendableStores(viewer, access.stores).length > 0;
  const resolver = viewer.isOwner || viewer.allStores;

  // The list scrolls the opened card into view once, when a notification opened it.
  const scrolledKey = useRef(-1);
  useEffect(() => {
    if (!focus || !selected || scrolledKey.current === focusKey) return;
    scrolledKey.current = focusKey;
    document.getElementById(`ivt-tr-${selected.id}`)?.scrollIntoView({ block: "nearest" });
  }, [focus, selected, focusKey]);

  const nameOf = (storeId: string, snapshot: string) => transferStoreName(storeId, snapshot, storeNames);
  const statusOf = (t: InventoryTransfer) => transferStatusView(t, { nowMs, lang, canResolve: canResolveTransfer(t, viewer), zone });
  const loading = (openLoading || recent.loading) && transfers.length === 0;
  const error = openError || recent.error || month.error;

  return (
    <div className="ivt-tr">
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {focusUnavailable && <div className="lst-form-error" role="status">That transfer is not available.</div>}

      <div className="pk-scoreboard ivt-tr-tiles" role="group" aria-label="Transfer totals">
        <div className="pk-stat"><span>In transit</span>
          <b data-no-translate>{transfersCountText(tiles.inTransit.transfers, lang)}</b>
          <small data-no-translate>{itemCountText(tiles.inTransit.items, lang)}</small>
          <small><span>Value at cost</span> <span data-no-translate>{moneyText(tiles.inTransit.valueCents, lang)}</span></small>
        </div>
        <div className={`pk-stat${tiles.disputed.items > 0 ? " ivt-tr-tile-alert" : ""}`}><span>Disputed</span>
          <b data-no-translate>{itemCountText(tiles.disputed.items, lang)}</b>
          <small><span>Value at cost</span> <span data-no-translate>{moneyText(tiles.disputed.valueCents, lang)}</span></small>
          {tiles.disputed.items > 0 && resolver && <small className="ivt-overdue">Needs your decision</small>}
        </div>
        <div className="pk-stat"><span>Received this month</span>
          <b data-no-translate>{transfersCountText(tiles.received.transfers, lang)}</b>
          <small data-no-translate>
            {itemCountText(tiles.received.items, lang)}
            {tiles.received.withDifferences > 0 ? ` · ${withDifferencesText(tiles.received.withDifferences, lang)}` : ""}
          </small>
        </div>
      </div>

      <div className="panel-tools ivt-tr-tools">
        <div className="service-segments" role="tablist" aria-label="Transfer filter">
          {TRANSFER_CHIPS.map((id) => (
            <span
              key={id}
              role="button"
              tabIndex={0}
              className={`segment ${chip === id ? "active" : ""}`}
              aria-pressed={chip === id}
              onClick={() => setChip(id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setChip(id); } }}
            >
              {TRANSFER_CHIP_LABELS[id]}{id !== "all" && counts[id] > 0 && <b data-no-translate>{counts[id]}</b>}
            </span>
          ))}
        </div>
        {access.multi && access.canSeeAll && (
          <InventoryStoreFilter stores={access.stores} value={storeFilter} onChange={onStoreFilter} />
        )}
        {canSend && (
          <button className="lst-add" type="button" disabled={!enabled} onClick={() => onCompose(null)}><Plus size={16} /> New transfer</button>
        )}
      </div>

      <div className="ivt-tr-layout">
        <div className="ivt-tr-list">
          {loading ? (
            <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
          ) : shown.length === 0 ? (
            <div className="empty-state">
              {transfers.length === 0 ? "No transfers yet. Send stock to another store with New transfer."
                : chip === "in_transit" ? "Nothing is in transit."
                : chip === "review" ? "Nothing is waiting for a decision."
                : chip === "drafts" ? "No drafts."
                : "No transfer for this store."}
            </div>
          ) : (
            <ul className="ivt-tr-cards">
              {shown.map((t) => {
                const status = statusOf(t);
                const active = t.id === selectedId;
                return (
                  <li key={t.id} id={`ivt-tr-${t.id}`}>
                    <button
                      type="button"
                      className={`ivt-tr-card${active ? " active" : ""}${status.tone === "danger" ? " ivt-tr-card-alert" : ""}`}
                      aria-pressed={active}
                      onClick={() => { setSelectedId(t.id); setDialog(""); }}
                    >
                      <span className="ivt-tr-card-head">
                        <code className="ctn-code" data-no-translate>{t.code || "—"}</code>
                        <span className={pillClass(status)} data-no-translate>{status.label}</span>
                      </span>
                      <span className="ivt-tr-route" data-no-translate>
                        {nameOf(t.fromStoreId, t.fromStoreName)} <ArrowRight size={12} aria-hidden="true" /> {nameOf(t.toStoreId, t.toStoreName)}
                      </span>
                      <small data-no-translate>
                        {t.stage === "review" ? `${itemCountText(t.itemsCount, lang)} · ${missingText(t.missingCount, lang)}` : transferCountsText(t, lang)}
                        {status.detail ? ` · ${status.detail}` : ""}
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <LoadMoreButton hasMore={recent.hasMore} loading={recent.loadingMore} onLoadMore={recent.loadMore} />
        </div>

        <div className="ivt-tr-detail">
          {selected ? (
            <TransferDetail
              transfer={selected}
              viewer={viewer}
              lang={lang}
              zone={zone}
              status={statusOf(selected)}
              fromName={nameOf(selected.fromStoreId, selected.fromStoreName)}
              toName={nameOf(selected.toStoreId, selected.toStoreName)}
              storeName={nameOf}
              onReceive={() => setDialog("receive")}
              onReview={() => setDialog("review")}
              onCancel={() => setDialog("cancel")}
              onContinue={() => onCompose(selected)}
              onTags={onTags}
            />
          ) : selectedId && !detailRead.settled ? (
            <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
          ) : (
            <div className="empty-state">Open a transfer to see what was sent, what arrived and who did what.</div>
          )}
        </div>
      </div>

      {dialog === "receive" && selected && canReceiveTransfer(selected, viewer) && (
        <InventoryTransferReceiveDialog
          businessId={businessId}
          transfer={selected}
          fromName={nameOf(selected.fromStoreId, selected.fromStoreName)}
          toName={nameOf(selected.toStoreId, selected.toStoreName)}
          zone={zone}
          onClose={() => setDialog("")}
          onFlash={onFlash}
        />
      )}
      {dialog === "review" && selected && canResolveTransfer(selected, viewer) && (
        <InventoryTransferReviewDialog
          businessId={businessId}
          transfer={selected}
          viewer={viewer}
          fromName={nameOf(selected.fromStoreId, selected.fromStoreName)}
          toName={nameOf(selected.toStoreId, selected.toStoreName)}
          onClose={() => setDialog("")}
          onFlash={onFlash}
        />
      )}
      {dialog === "cancel" && selected && (canCancelTransfer(selected, viewer) || canDiscardDraft(selected, viewer)) && (
        <InventoryTransferCancelDialog
          businessId={businessId}
          transfer={selected}
          fromName={nameOf(selected.fromStoreId, selected.fromStoreName)}
          toName={nameOf(selected.toStoreId, selected.toStoreName)}
          onClose={() => setDialog("")}
          onFlash={onFlash}
          onDone={() => { if (selected.status === "draft") setSelectedId(""); }}
        />
      )}
    </div>
  );
}

function TransferDetail({
  transfer,
  viewer,
  lang,
  zone,
  status,
  fromName,
  toName,
  storeName,
  onReceive,
  onReview,
  onCancel,
  onContinue,
  onTags,
}: {
  transfer: InventoryTransfer;
  viewer: TransferViewer;
  lang: "en" | "fr";
  zone: string;
  status: TransferStatusView;
  fromName: string;
  toName: string;
  storeName: (storeId: string, snapshot: string) => string;
  onReceive: () => void;
  onReview: () => void;
  onCancel: () => void;
  onContinue: () => void;
  onTags: (item: { id: string; name: string; brand?: string; code: string }) => void;
}) {
  const record = trackRecordLines(transfer, { lang, zone, storeName });
  const received = transfer.status === "received" || transfer.status === "received_with_differences";
  return (
    <article className="ivt-tr-pane">
      <div className="ivt-tr-pane-head">
        <div>
          <h3><code className="ctn-code" data-no-translate>{transfer.code || "—"}</code> <span className={pillClass(status)} data-no-translate>{status.label}</span></h3>
          <p className="ivt-tr-route" data-no-translate>{fromName} <ArrowRight size={12} aria-hidden="true" /> {toName}</p>
          <small data-no-translate>{transferCountsText(transfer, lang)}{status.detail ? ` · ${status.detail}` : ""}</small>
        </div>
        <div className="ctn-detail-actions">
          {canReceiveTransfer(transfer, viewer) && (
            <button className="lst-add" type="button" onClick={onReceive}><CheckCheck size={14} /> Receive</button>
          )}
          {canResolveTransfer(transfer, viewer) && (
            <button className="lst-add" type="button" onClick={onReview}><ClipboardCheck size={14} /> Settle differences</button>
          )}
          {canContinueDraft(transfer, viewer) && (
            <button className="lst-add" type="button" onClick={onContinue}><Pencil size={14} /> Continue</button>
          )}
          {canDiscardDraft(transfer, viewer) && (
            <button className="lst-btn ghost danger" type="button" onClick={onCancel}><Trash2 size={14} /> Discard draft</button>
          )}
          {canCancelTransfer(transfer, viewer) && (
            <button className="lst-btn ghost danger" type="button" onClick={onCancel}><XCircle size={14} /> Cancel transfer</button>
          )}
        </div>
      </div>

      <div className="mini-table">
        <div className="ctn-table ivt-tr-lines-table">
          <div className="mini-table-head"><span>Product</span><span>Sent</span><span>Arrived</span><span>Result</span></div>
          {transfer.lines.map((line) => {
            const result = lineResultText(line, fromName, lang);
            const disputed = line.missing > 0 && !line.resolution;
            return (
              <div className="mini-table-row" key={line.itemId}>
                <span>
                  <strong data-no-translate>{productDisplayName(line)}</strong>
                  {line.code && <small><code className="ctn-code" data-no-translate>{line.code}</code></small>}
                </span>
                <span><strong data-no-translate>{line.quantitySent}</strong></span>
                <span><strong data-no-translate>{line.quantityReceived === null ? "—" : line.quantityReceived}</strong></span>
                <span className="ivt-tr-result-cell">
                  {result ? <small className={disputed ? "ivt-overdue" : undefined} data-no-translate>{result}</small> : <small>—</small>}
                  {received && (line.quantityReceived ?? 0) > 0 && line.code && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => onTags({ id: line.itemId, name: line.name, brand: line.brand, code: line.code })}
                      title="Print tags"
                      aria-label="Print tags"
                    >
                      <Tag size={14} />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {transfer.receiveNote && (
        <p className="ctn-notes"><span>Note from the receiving store:</span> <span data-no-translate>{`“${transfer.receiveNote}”`}</span></p>
      )}

      <h4 className="ivt-tr-record-title">Track record</h4>
      {record.length === 0 ? (
        <p className="lst-hint">Nothing recorded yet.</p>
      ) : (
        <ol className="ivt-tr-record">
          {record.map((line) => (
            <li key={line.key}>
              <time data-no-translate>{line.at}</time>
              <span data-no-translate>{line.text}</span>
              {line.note && <small data-no-translate>{`“${line.note}”`}</small>}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
