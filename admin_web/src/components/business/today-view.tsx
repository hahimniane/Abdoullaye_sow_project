"use client";

// The business console's Today tab: this month's real work (Volume), what
// is waiting on the business, the containers in progress and - for owners -
// the money collected at the counter and online. Counted on the server
// (getBusinessOverview, my_flutter_app/functions/business_overview.js);
// turned into rows by lib/business-today.ts. This file only lays them out.

import { useMemo, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { AlertCircle, Banknote, ChevronRight, Container, ListChecks } from "lucide-react";

import { Panel } from "@/components/panel";
import { TotalsStatus } from "@/components/totals-status";
import {
  formatTodayMoney,
  todayAttention,
  todayMoneyBreakdown,
  todayMoneyComplete,
  todayOwedRows,
  todayTiles,
  type BusinessToday,
  type TodayAttentionItem,
  type TodayContainer,
  type TodayTile,
} from "@/lib/business-today";
import { CONTAINER_STATUS_LABELS, CONTAINER_STATUS_TONES, type ContainerStatus } from "@/lib/container-manifest";
import { destinationCountryName, destinationCountryOptionForRow } from "@/lib/destination-countries";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDate, text } from "@/lib/format";
import { ledgerEventTitle } from "@/lib/staff-expense-console";
import { statusPillClass } from "@/lib/status-pill";
import { formatVolumeChange, formatVolumeCount, formatVolumeMonth, volumeChangeTone } from "@/lib/volume";
import type { FirestoreRow } from "@/types/admin";

type Language = "en" | "fr";

export type TodayState = {
  computedAtMs: number | null;
  complete: boolean;
  loading: boolean;
  error: string;
  refresh: () => void;
};

function TodayTileCard({ tile, language }: { tile: TodayTile; language: Language }) {
  const figure = tile.kind === "money" ? formatTodayMoney(tile.value, language, true) : formatVolumeCount(tile.value, language);
  const change = tile.compares ? formatVolumeChange(tile.change, language) : "";
  const note = tile.note;
  return (
    <article className={`metric today-tile ${tile.tone}`}>
      <span>{tile.label}</span>
      <strong className={tile.kind === "money" ? "today-figure is-money" : "today-figure"} data-no-translate>
        {figure}
      </strong>
      <small className="today-tile-note">
        {tile.compares &&
          (change ? (
            <>
              <b className={`vol-change ${volumeChangeTone(tile.change)}`} data-no-translate>
                {change}
              </b>{" "}
              <span>vs last month</span>
            </>
          ) : (
            <span>No figure last month</span>
          ))}
        {note && (
          <span className="today-tile-extra">
            <span>{note.label}</span>{" "}
            <span className="today-note-figure" data-no-translate>
              {note.kind === "money" ? formatTodayMoney(note.value, language, true) : formatVolumeCount(note.value, language)}
            </span>
          </span>
        )}
      </small>
    </article>
  );
}

function AttentionRow({
  item,
  language,
  onOpen,
}: {
  item: TodayAttentionItem;
  language: Language;
  onOpen: (item: TodayAttentionItem) => void;
}) {
  return (
    <button className="today-attention-row" onClick={() => onOpen(item)} type="button">
      <span className="today-attention-label">{item.label}</span>
      <span className="today-attention-figures">
        {item.count !== null && item.count > 0 && (
          <b className="today-attention-count" data-no-translate>
            {formatVolumeCount(item.count, language)}
          </b>
        )}
        {item.amountCents !== null && item.amountCents > 0 && (
          <span className="today-attention-amount" data-no-translate>
            {formatTodayMoney(item.amountCents, language)}
          </span>
        )}
      </span>
      <ChevronRight aria-hidden="true" size={16} />
    </button>
  );
}

function containerDestination(container: TodayContainer, language: Language) {
  const id = container.destinationCountryId;
  if (!id && !container.destination) return "";
  const option = destinationCountryOptionForRow({ id, name: container.destination });
  return option.id ? destinationCountryName(option.id, language) : container.destination;
}

function ContainerRow({
  container,
  language,
  onOpen,
}: {
  container: TodayContainer;
  language: Language;
  onOpen: (containerId: string) => void;
}) {
  const status = (container.status in CONTAINER_STATUS_LABELS ? container.status : "loading") as ContainerStatus;
  const destination = containerDestination(container, language);
  return (
    <button className="today-container-row" onClick={() => onOpen(container.id)} type="button">
      <span className="today-container-main">
        <strong data-no-translate>{container.name || "—"}</strong>
        <small>
          {destination && (
            <>
              <span data-no-translate>{destination}</span>
              <span aria-hidden="true"> · </span>
            </>
          )}
          <span>Pieces</span>{" "}
          <span data-no-translate>{formatVolumeCount(container.pieces, language)}</span>
          {status === "shipped" && container.sailedAtMs ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>Sailed</span> <span data-no-translate>{formatDate(container.sailedAtMs)}</span>
            </>
          ) : null}
        </small>
      </span>
      <span className={statusPillClass(CONTAINER_STATUS_TONES[status])}>{CONTAINER_STATUS_LABELS[status]}</span>
    </button>
  );
}

function MoneyBars({ title, rows, language }: { title: string; rows: ReturnType<typeof todayMoneyBreakdown>["services"]; language: Language }) {
  return (
    <section className="today-money-block">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div className="today-bar-row" key={row.key}>
          <div className="today-bar-label">
            <span>{row.label}</span>
            <b data-no-translate>{formatTodayMoney(row.cents, language)}</b>
          </div>
          <div aria-hidden="true" className="analytics-bar-track">
            <div className="analytics-bar-fill" style={{ width: `${row.percent}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

function MoneyPanel({ today, language }: { today: BusinessToday; language: Language }) {
  const money = today.money;
  const current = useMemo(() => todayMoneyBreakdown(money?.current), [money]);
  if (!money) return null;
  const complete = todayMoneyComplete(today);
  const owed = todayOwedRows(today);
  return (
    <Panel
      action={
        <span className="today-money-total">
          <span>Total</span>{" "}
          <strong data-no-translate>{formatTodayMoney(current.totalCents, language)}</strong>
        </span>
      }
      className="today-money-panel"
      icon={<Banknote size={18} />}
      title="Money collected this month"
    >
      {current.totalCents > 0 ? (
        <div className="today-money">
          <MoneyBars language={language} rows={current.services} title="By service" />
          <MoneyBars language={language} rows={current.methods} title="By method" />
        </div>
      ) : (
        <div className="empty-state">No payments recorded this month yet.</div>
      )}
      <div className="today-money-foot">
        <span>
          <span>Last month</span>{" "}
          <b data-no-translate>{formatTodayMoney(money.previous.totalCents, language)}</b>
        </span>
        {today.owed.totalCents !== null && (
          <span className="today-owed">
            <span>Still owed by customers</span>{" "}
            <b data-no-translate>{formatTodayMoney(today.owed.totalCents, language)}</b>
            {owed.length > 0 && (
              <span className="today-owed-parts">
                {owed.map((row) => (
                  <span key={row.key}>
                    <span>{row.label}</span> <span data-no-translate>{formatTodayMoney(row.cents, language)}</span>
                  </span>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      <p className="today-money-hint">
        Counter payments (cash, Zelle, card in person and the rest) and online card payments, by the day they were
        received.
      </p>
      {!complete && (
        <div className="info-band">Some payments could not be counted, so these totals may be low. Refresh in a moment.</div>
      )}
    </Panel>
  );
}

function LedgerAlerts({
  events,
  previewMode,
  onOpenLedger,
}: {
  events: FirestoreRow[];
  previewMode: boolean;
  onOpenLedger: () => void;
}) {
  async function dismiss(id: string) {
    if (previewMode) return;
    try {
      await httpsCallable(functions, "acknowledgeLotLedgerEvent")({ eventId: id });
    } catch {
      // A failed dismiss is non-fatal; the event simply stays listed.
    }
  }
  return (
    <>
      {events.map((ev) => (
        <article className="data-row" key={String(ev.id)} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            className="clickable"
            onClick={onOpenLedger}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenLedger();
              }
            }}
            role="button"
            style={{ flex: 1, cursor: "pointer" }}
            tabIndex={0}
          >
            <strong>
              {ledgerEventTitle(ev)}
            </strong>
            <div>
              <small>
                <span data-audit-summary>{text(ev.summary, "")}</span>
                {text(ev.byStaffId, "") ? " · by staff" : ""} · {formatDate(ev.at)}
              </small>
            </div>
          </div>
          <button className="ghost-button" onClick={() => dismiss(String(ev.id))} type="button">
            Dismiss
          </button>
        </article>
      ))}
    </>
  );
}

function eventMs(row: FirestoreRow) {
  const at = row.at as { toMillis?: () => number; seconds?: number } | undefined;
  if (at?.toMillis) return at.toMillis();
  if (at?.seconds) return at.seconds * 1000;
  return 0;
}

export function TodayView({
  today,
  state,
  previewMode,
  ledgerEvents,
  onOpenAttention,
  onOpenContainer,
  onOpenLedger,
  children,
}: {
  today: BusinessToday | null;
  state: TodayState;
  previewMode: boolean;
  ledgerEvents: FirestoreRow[];
  onOpenAttention: (item: TodayAttentionItem) => void;
  onOpenContainer: (containerId: string) => void;
  onOpenLedger: () => void;
  /** What follows the month (the payouts panel). */
  children?: ReactNode;
}) {
  const language: Language = currentLanguage() === "fr" ? "fr" : "en";
  // Worked out once per answer, never per render of a row.
  const tiles = useMemo(() => todayTiles(today), [today]);
  const attention = useMemo(() => todayAttention(today), [today]);
  const ledgerAlerts = useMemo(
    () =>
      ledgerEvents
        .filter((e) => e.acknowledged !== true)
        .sort((a, b) => eventMs(b) - eventMs(a))
        .slice(0, 6),
    [ledgerEvents],
  );
  const containers = today?.containers ?? null;

  return (
    <div className="stack today-page">
      <header className="today-head">
        <div className="today-head-title">
          <span className="today-eyebrow">This month</span>
          <h2 data-no-translate>{today ? formatVolumeMonth(today.month, language) : "—"}</h2>
          {today && (
            <p>
              <span>Compared with</span>{" "}
              <span data-no-translate>{formatVolumeMonth(today.previousMonth, language)}</span>
              <span aria-hidden="true"> · </span>
              <span>New York time</span>
            </p>
          )}
        </div>
        {!previewMode && (
          <TotalsStatus
            complete={state.complete}
            computedAtMs={state.computedAtMs}
            error={state.error}
            loading={state.loading}
            onRefresh={state.refresh}
          />
        )}
      </header>

      {tiles.length > 0 && (
        <div className="today-tiles">
          {tiles.map((tile) => (
            <TodayTileCard key={tile.key} language={language} tile={tile} />
          ))}
        </div>
      )}

      <div className={containers ? "today-grid" : "stack"}>
        <Panel icon={<ListChecks size={18} />} title="Needs attention">
          <div className="today-attention">
            {attention.map((item) => (
              <AttentionRow item={item} key={item.key} language={language} onOpen={onOpenAttention} />
            ))}
            {today && attention.length === 0 && ledgerAlerts.length === 0 && (
              <div className="empty-state">Nothing is waiting on you right now.</div>
            )}
            {!today && ledgerAlerts.length === 0 && (
              <div className="empty-state">
                {state.error ? "This list could not be loaded." : "Counting what is waiting…"}
              </div>
            )}
            <LedgerAlerts events={ledgerAlerts} onOpenLedger={onOpenLedger} previewMode={previewMode} />
          </div>
        </Panel>

        {containers && (
          <Panel
            action={
              <button className="ghost-button compact" onClick={() => onOpenContainer("")} type="button">
                Open containers
              </button>
            }
            icon={<Container size={18} />}
            title="Containers in progress"
          >
            <div className="today-containers">
              {containers.list.map((container) => (
                <ContainerRow container={container} key={container.id} language={language} onOpen={onOpenContainer} />
              ))}
              {containers.list.length === 0 && (
                <div className="empty-state">No container is loading or at sea.</div>
              )}
              {containers.more && (
                <button className="today-more" onClick={() => onOpenContainer("")} type="button">
                  <span>See every open container</span> <ChevronRight aria-hidden="true" size={14} />
                </button>
              )}
            </div>
          </Panel>
        )}
      </div>

      {today?.money && <MoneyPanel language={language} today={today} />}

      {today && today.unavailable.length > 0 && !today.money && (
        <div className="info-band today-partial">
          <AlertCircle aria-hidden="true" size={16} /> Some figures could not be loaded. Refresh in a moment.
        </div>
      )}

      {children}
    </div>
  );
}
