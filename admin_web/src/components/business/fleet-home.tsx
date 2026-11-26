"use client";

// The Fleet page's own parts (docs/FLEET.md section 15): the header (search,
// New, settings), the tab row, and Needs you. Every action opens the form the
// Fleet pages already have; nothing here writes on its own except the
// WhatsApp reminder, which is the drivers page's own button.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Banknote,
  CarFront,
  ChevronRight,
  FileWarning,
  Image as ImageIcon,
  Landmark,
  Plus,
  Search,
  Settings,
  X,
} from "lucide-react";

import { formatDayKey } from "@/lib/format";
import type { DriverRow } from "@/lib/fleet";
import type { FleetSettingsView } from "@/lib/fleet";
import type { FleetView, NeedsItem, PlateOnDay, SearchHit } from "@/lib/fleet-home";
import { moneyText } from "@/lib/invoice-ledger";

import { fleetLang, FleetModal, Money } from "./fleet-ui";
import { FleetRemindButton } from "./fleet-whatsapp";

// ---------------------------------------------------------------------------
// Header: search, New, settings.
// ---------------------------------------------------------------------------

export type NewAction = "driver" | "plate" | "payment" | "charge" | "import";

export function FleetHeader({
  query,
  onQuery,
  hits,
  answer,
  onOpenDriver,
  onOpenPlate,
  onChargeTicket,
  onNew,
  isAdmin,
  onSettings,
  settingsOpen,
}: {
  query: string;
  onQuery: (value: string) => void;
  hits: readonly SearchHit[];
  answer: PlateOnDay | null;
  onOpenDriver: (id: string) => void;
  onOpenPlate: (id: string) => void;
  onChargeTicket: (driverId: string, label: string) => void;
  onNew: (action: NewAction) => void;
  isAdmin: boolean;
  onSettings: () => void;
  settingsOpen: boolean;
}) {
  const lang = fleetLang();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  // A click anywhere else closes the menu and the results; Escape too.
  useEffect(() => {
    if (!menuOpen && !searchOpen) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false);
      if (searchOpen && searchRef.current && !searchRef.current.contains(target)) setSearchOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      setSearchOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, searchOpen]);

  const pick = (action: NewAction) => {
    setMenuOpen(false);
    onNew(action);
  };
  const go = (fn: () => void) => {
    setSearchOpen(false);
    onQuery("");
    fn();
  };
  const showResults = searchOpen && query.trim() !== "";
  const friendLine = answer && answer.friendName ? answer.friendName : "";

  return (
    <div className="fleet-home-head">
      <h1 className="fleet-home-title">Fleet</h1>
      <div className="fleet-home-search" ref={searchRef}>
        <label className="fleet-home-search-box">
          <Search aria-hidden="true" size={17} />
          <span className="sr-only">Search drivers and plates</span>
          <input
            type="search"
            value={query}
            placeholder="A name, a phone, a plate, or a plate and a day: T712 Oct 3"
            onChange={(event) => {
              onQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
          />
          {query && (
            <button type="button" className="fleet-home-clear press" aria-label="Clear search" onClick={() => onQuery("")}>
              <X size={15} />
            </button>
          )}
        </label>
        {showResults && (
          <div className="fleet-home-results" role="listbox" aria-label="Search results">
            {answer && (
              <div className="fleet-home-answer">
                <small>
                  <span data-no-translate>{answer.plate}</span> · <span data-no-translate>{formatDayKey(answer.dayKey, lang)}</span>
                </small>
                {answer.future ? (
                  <strong>That day has not come yet.</strong>
                ) : answer.driverName ? (
                  <strong>
                    <span data-no-translate>{answer.driverName}</span> <span>had this plate.</span>
                  </strong>
                ) : (
                  <strong>Nobody had this plate that day.</strong>
                )}
                {!answer.future && answer.driverName && (
                  <small>
                    {answer.toDayKey ? (
                      <>
                        <span>Had it:</span>{" "}
                        <span data-no-translate>{formatDayKey(answer.fromDayKey, lang)} – {formatDayKey(answer.toDayKey, lang)}</span>
                      </>
                    ) : (
                      <>
                        <span>Had it since</span> <span data-no-translate>{formatDayKey(answer.fromDayKey, lang)}</span>
                      </>
                    )}
                    {friendLine && (
                      <>
                        {" · "}
                        <span>A friend drove it that day:</span> <span data-no-translate>{friendLine}</span>
                      </>
                    )}
                  </small>
                )}
                <div className="fleet-home-answer-actions">
                  {answer.driverId && !answer.future && (
                    <>
                      <button
                        type="button"
                        className="lst-btn press"
                        onClick={() => go(() => onChargeTicket(answer.driverId, `Ticket · ${answer.plate} · ${formatDayKey(answer.dayKey, "en")}`))}
                      >
                        Charge this ticket
                      </button>
                      <button type="button" className="lst-btn ghost press" onClick={() => go(() => onOpenDriver(answer.driverId))}>
                        Open driver
                      </button>
                    </>
                  )}
                  <button type="button" className="lst-btn ghost press" onClick={() => go(() => onOpenPlate(answer.carId))}>
                    Open plate
                  </button>
                </div>
              </div>
            )}
            {hits.map((hit) => (
              <button
                key={`${hit.kind}-${hit.id}`}
                type="button"
                role="option"
                aria-selected="false"
                className="fleet-home-hit press"
                onClick={() => go(() => (hit.kind === "driver" ? onOpenDriver(hit.id) : onOpenPlate(hit.id)))}
              >
                {hit.kind === "driver" ? (
                  <>
                    <strong data-no-translate>{hit.name}</strong>
                    <small>
                      <span>Driver</span> · {hit.plate ? <span data-no-translate>{hit.plate}</span> : <span>No plate</span>}
                      {hit.owedCents > 0 && (
                        <>
                          {" · "}
                          <span>Owed now:</span> <span data-no-translate>{moneyText(hit.owedCents, lang)}</span>
                        </>
                      )}
                      {hit.status === "left" && <> · <span>Left the company</span></>}
                    </small>
                  </>
                ) : (
                  <>
                    <strong data-no-translate>{hit.plate}</strong>
                    <small>
                      <span>Plate</span>
                      {hit.company && <> · <span data-no-translate>{hit.company}</span></>} ·{" "}
                      {hit.driverName ? <span data-no-translate>{hit.driverName}</span> : <span>No driver</span>}
                    </small>
                  </>
                )}
              </button>
            ))}
            {!answer && hits.length === 0 && <p className="fleet-home-empty">Nothing matches. Try a name, a phone number or a plate.</p>}
          </div>
        )}
      </div>
      <div className="fleet-home-new" ref={menuRef}>
        <button
          type="button"
          className="fleet-home-new-btn press"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Plus size={17} aria-hidden="true" /> New
        </button>
        <div className={`fleet-home-menu${menuOpen ? " open" : ""}`} role="menu" aria-label="New" aria-hidden={!menuOpen}>
          <MenuItem title="Add driver" sub="Name, phone, licence" onClick={() => pick("driver")} hidden={!menuOpen} />
          <MenuItem title="Add plate" sub="Plate, car and paperwork dates" onClick={() => pick("plate")} hidden={!menuOpen} />
          <span className="fleet-home-menu-rule" />
          <MenuItem title="Record a payment" sub="Cash, Zelle or other" onClick={() => pick("payment")} hidden={!menuOpen} />
          <MenuItem title="Add a charge" sub="A ticket, a repair, a fee" onClick={() => pick("charge")} hidden={!menuOpen} />
          {isAdmin && (
            <>
              <span className="fleet-home-menu-rule" />
              <MenuItem title="Import from spreadsheet" sub="Drivers and payments from Excel" onClick={() => pick("import")} hidden={!menuOpen} />
            </>
          )}
        </div>
      </div>
      {isAdmin && (
        <button
          type="button"
          className={`fleet-home-gear press${settingsOpen ? " on" : ""}`}
          aria-label="Fleet settings"
          aria-pressed={settingsOpen}
          title="Fleet settings"
          onClick={onSettings}
        >
          <Settings size={19} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function MenuItem({ title, sub, onClick, hidden }: { title: string; sub: string; onClick: () => void; hidden: boolean }) {
  return (
    <button type="button" role="menuitem" className="fleet-home-menu-item press" tabIndex={hidden ? -1 : 0} onClick={onClick}>
      <strong>{title}</strong>
      <small>{sub}</small>
    </button>
  );
}

// ---------------------------------------------------------------------------
// The tab row.
// ---------------------------------------------------------------------------

export type FleetTabSpec = { id: Exclude<FleetView, "settings">; label: string; count: number | null; alert?: boolean };

export function FleetTabBar({ tabs, view, onView }: { tabs: readonly FleetTabSpec[]; view: FleetView; onView: (view: FleetView) => void }) {
  return (
    <nav className="fleet-home-tabs" aria-label="Fleet sections">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`fleet-home-tab press${view === tab.id ? " on" : ""}`}
          aria-current={view === tab.id ? "page" : undefined}
          onClick={() => onView(tab.id)}
        >
          <span>{tab.label}</span>
          {tab.count !== null && tab.count > 0 && (
            <b className={tab.alert ? "alert" : ""} data-no-translate>
              {tab.count}
            </b>
          )}
        </button>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Needs you.
// ---------------------------------------------------------------------------

const FIRST_SHOWN = 25;

/** Whole sentences, so each is translated as one (never "on" or "to" alone). */
const PAPER_TITLES = {
  diamond: ["Diamond runs out", "Diamond ran out"],
  registration: ["Registration runs out", "Registration ran out"],
} as const;

export type NeedsActions = {
  openDriver: (id: string) => void;
  openPlate: (id: string) => void;
  recordPayment: (driverId: string) => void;
  giveToDriver: (carId: string) => void;
  goPayments: (anchor: "fleet-claims" | "fleet-deposits") => void;
  goPaperwork: () => void;
};

export function NeedsYou({
  items,
  loading,
  bankError,
  businessId,
  settings,
  actions,
  drivers,
}: {
  items: readonly NeedsItem[];
  loading: boolean;
  bankError: string;
  businessId: string;
  settings: FleetSettingsView;
  actions: NeedsActions;
  drivers: ReadonlyMap<string, DriverRow>;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? items : items.slice(0, FIRST_SHOWN);
  return (
    <section className="fleet-needs" aria-label="Needs you">
      <header className="fleet-needs-head">
        <h2>
          <span>Needs you</span> {items.length > 0 && <b data-no-translate>{items.length}</b>}
        </h2>
        <small>Most money first</small>
      </header>
      {bankError && <p className="fleet-needs-note">The bank could not be read just now, so deposits are not in this list. They are on the Payments tab once it loads.</p>}
      {loading && items.length === 0 ? (
        <p className="fleet-needs-empty">Loading…</p>
      ) : items.length === 0 ? (
        <div className="fleet-needs-done">
          <strong>All caught up</strong>
          <span>Nothing needs you right now.</span>
        </div>
      ) : (
        <ul className="fleet-needs-list">
          {shown.map((item) => (
            <NeedsRow key={item.key} item={item} actions={actions} businessId={businessId} settings={settings} drivers={drivers} />
          ))}
        </ul>
      )}
      {!showAll && items.length > FIRST_SHOWN && (
        <button type="button" className="ghost-button compact fleet-needs-more press" onClick={() => setShowAll(true)}>
          <span>Show all</span> <span data-no-translate>{items.length}</span>
        </button>
      )}
    </section>
  );
}

function NeedsRow({
  item,
  actions,
  businessId,
  settings,
  drivers,
}: {
  item: NeedsItem;
  actions: NeedsActions;
  businessId: string;
  settings: FleetSettingsView;
  drivers: ReadonlyMap<string, DriverRow>;
}) {
  const lang = fleetLang();
  const day = (key: string) => <span data-no-translate>{formatDayKey(key, lang)}</span>;
  const name = (text: string) => <span data-no-translate>{text || "—"}</span>;
  let icon = <AlertCircle size={19} aria-hidden="true" />;
  let tone = "bad";
  let title: ReactNode = null;
  let sub: ReactNode = null;
  let main: ReactNode = null;
  let open: (() => void) | null = null;

  switch (item.kind) {
    case "removed":
      icon = <Landmark size={19} aria-hidden="true" />;
      title = <><span>The bank took back</span> <Money cents={item.amountCents} /> <span>that had paid</span> {name(item.name)}</>;
      sub = <><span>Paid on</span> {day(item.dayKey)} · <span>keep the payment or undo it.</span></>;
      main = <button type="button" className="lst-btn press" onClick={() => actions.goPayments("fleet-deposits")}>Decide</button>;
      if (item.driverId) open = () => actions.openDriver(item.driverId);
      break;
    case "claim":
      icon = <ImageIcon size={19} aria-hidden="true" />;
      tone = "warn";
      title = <>{name(item.name)} <span>sent a payment screenshot</span>{item.amountCents !== null && <> · <Money cents={item.amountCents} /></>}</>;
      sub = item.match ? <span>A deposit of the same amount came in. Give it to them.</span> : <span>Laawol needs you to look at it.</span>;
      main = <button type="button" className="lst-btn press" onClick={() => actions.goPayments("fleet-claims")}>Look at it</button>;
      if (item.driverId) open = () => actions.openDriver(item.driverId);
      break;
    case "deposit":
      icon = <Banknote size={19} aria-hidden="true" />;
      tone = "warn";
      title = <><Money cents={item.amountCents} /> <span>came in from</span> {name(item.senderName)}</>;
      sub = <>{item.dayKey ? <>{day(item.dayKey)} · </> : null}<span>No driver pays from this name yet.</span></>;
      main = <button type="button" className="lst-btn ghost press" onClick={() => actions.goPayments("fleet-deposits")}>Pay a driver</button>;
      break;
    case "late": {
      const row = drivers.get(item.driverId);
      title = <>{name(item.name)} · <span>Owed now:</span> <Money cents={item.owedCents} /></>;
      sub = (
        <>
          <span>Late:</span> <span data-no-translate>{moneyText(item.lateCents, lang)}</span> ·{" "}
          {item.plate ? <span data-no-translate>{item.plate}</span> : <span>No plate now</span>}
          {!item.active && <> · <span>Left the company</span></>}
        </>
      );
      main = (
        <>
          <FleetRemindButton businessId={businessId} settings={settings} driverId={item.driverId} active={item.active} owedCents={row?.owedCents ?? item.owedCents} />
          <button type="button" className="lst-btn ghost press" onClick={() => actions.recordPayment(item.driverId)}>Record a payment</button>
        </>
      );
      open = () => actions.openDriver(item.driverId);
      break;
    }
    case "idle":
      icon = <CarFront size={19} aria-hidden="true" />;
      tone = "muted";
      title = <><span>Plate</span> <span data-no-translate>{item.plate}</span> <span>has no driver</span></>;
      sub =
        item.idleDays === null ? (
          <span>No driver has had it yet.</span>
        ) : (
          <>
            <span>Days idle:</span> <span data-no-translate>{item.idleDays}</span>
            {item.missedCents > 0 && (
              <>
                {" · "}
                <span>Plate fees missed, about:</span> <span data-no-translate>{moneyText(item.missedCents, lang)}</span>
              </>
            )}
          </>
        );
      main = <button type="button" className="lst-btn press" onClick={() => actions.giveToDriver(item.carId)}>Give to a driver</button>;
      open = () => actions.openPlate(item.carId);
      break;
    case "paper":
      icon = <FileWarning size={19} aria-hidden="true" />;
      tone = item.daysLeft < 0 ? "bad" : "warn";
      title = (
        <>
          <span>{PAPER_TITLES[item.paper][item.daysLeft < 0 ? 1 : 0]}</span> · <span data-no-translate>{item.plate}</span> · {day(item.dayKey)}
        </>
      );
      sub = (
        <>
          {item.daysLeft < 0 ? (
            <><span>Days since it ran out:</span> <span data-no-translate>{-item.daysLeft}</span></>
          ) : (
            <><span>Days left:</span> <span data-no-translate>{item.daysLeft}</span></>
          )}
          {" · "}
          {item.driverName ? <><span>Driver:</span> {name(item.driverName)}</> : <span>No driver</span>}
        </>
      );
      main = <button type="button" className="lst-btn ghost press" onClick={() => actions.openPlate(item.carId)}>Update the date</button>;
      break;
    case "missingPaper":
      icon = <FileWarning size={19} aria-hidden="true" />;
      tone = "muted";
      title = <><span data-no-translate>{item.count}</span> <span>{item.count === 1 ? "paperwork date is missing" : "paperwork dates are missing"}</span></>;
      sub = <span>Add the diamond and registration dates so Laawol can warn you in time.</span>;
      main = <button type="button" className="lst-btn ghost press" onClick={actions.goPaperwork}>See which</button>;
      break;
  }

  return (
    <li className="fleet-needs-row">
      <span className={`fleet-needs-icon ${tone}`}>{icon}</span>
      <div className="fleet-needs-text">
        <strong>{title}</strong>
        <small>{sub}</small>
      </div>
      <div className="fleet-needs-actions">
        {main}
        {open && (
          <button type="button" className="fleet-needs-open press" onClick={open}>
            <span>See details</span> <ChevronRight size={15} aria-hidden="true" />
          </button>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// "Which driver?" for Record a payment, Add a charge, Give to a driver.
// ---------------------------------------------------------------------------

export type PickPurpose = { kind: "payment" } | { kind: "charge" } | { kind: "give"; carId: string; plate: string };

export function DriverPickDialog({
  purpose,
  rows,
  onPick,
  onClose,
}: {
  purpose: PickPurpose;
  rows: readonly DriverRow[];
  onPick: (driverId: string) => void;
  onClose: () => void;
}) {
  const lang = fleetLang();
  const [query, setQuery] = useState("");
  // Give a plate: drivers still with the company and no plate now. Otherwise everyone still here first.
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    return rows
      .filter((r) => (purpose.kind === "give" ? r.status === "active" && !r.carId : true))
      .filter((r) => words.every((w) => r.search.includes(w)))
      .slice(0, 60);
  }, [rows, purpose.kind, query]);
  const title = purpose.kind === "payment" ? "Record a payment" : purpose.kind === "charge" ? "Add a charge" : "Give to a driver";
  return (
    <FleetModal
      title={title}
      subtitle={purpose.kind === "give" ? <><span>Plate</span> <span data-no-translate>{purpose.plate}</span> · <span>Drivers with no plate now</span></> : "Which driver?"}
      onClose={onClose}
      footer={<button className="lst-btn ghost" type="button" onClick={onClose}>Cancel</button>}
    >
      <label className="fleet-search fleet-pick-search">
        <Search aria-hidden="true" size={15} />
        <input autoFocus aria-label="Search drivers" placeholder="Search name, phone or plate" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <div className="fleet-pick-list" role="listbox" aria-label="Drivers">
        {list.map((r) => (
          <button key={r.id} type="button" role="option" aria-selected="false" className="fleet-pick-row press" onClick={() => onPick(r.id)}>
            <strong data-no-translate>{r.name}</strong>
            <small>
              {r.plate ? <span data-no-translate>{r.plate}</span> : <span>No plate</span>}
              {r.owedCents > 0 && <> · <span>Owed now:</span> <span data-no-translate>{moneyText(r.owedCents, lang)}</span></>}
              {r.status === "left" && <> · <span>Left the company</span></>}
            </small>
          </button>
        ))}
        {list.length === 0 && (
          <p className="fleet-needs-empty">
            {purpose.kind === "give" ? "Every driver already has a plate. Add a driver first." : "No driver matches."}
          </p>
        )}
      </div>
    </FleetModal>
  );
}

// ---------------------------------------------------------------------------
// "Fleet is one page now", once per person and browser, until staff know it.
// ---------------------------------------------------------------------------

const MOVED_KEY = "laawol:notice:fleet-one-page-2026-11";
const MOVED_UNTIL_MS = Date.UTC(2027, 1, 1);

function readMovedDismissed(): boolean {
  try {
    return window.localStorage.getItem(MOVED_KEY) === "1";
  } catch {
    return false;
  }
}

export function FleetMovedNote() {
  // Decided after mount: storage is read in the browser only.
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(Date.now() < MOVED_UNTIL_MS && !readMovedDismissed());
  }, []);
  if (!open) return null;
  const close = () => {
    try {
      window.localStorage.setItem(MOVED_KEY, "1");
    } catch {
      // Private window or blocked storage: it may show again next visit.
    }
    setOpen(false);
  };
  return (
    <div className="fleet-moved" role="status">
      <p>Fleet payments, Drivers, Plates and Paperwork are now tabs of this one page. The gear opens Fleet settings, and New adds a driver, a plate, a payment or a charge.</p>
      <button type="button" className="lst-btn ghost press" onClick={close}>Got it</button>
    </div>
  );
}

