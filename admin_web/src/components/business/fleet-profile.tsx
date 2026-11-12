"use client";

// A driver's profile, below the facts the page already shows: the track
// record (built from the driver's own records), the office notes and files,
// and the friends who drove the car. Office-only: drivers never see any of
// it. Every sentence has its French in lib/french-dom.ts; names, plates,
// dates and amounts are data and stay as they are (data-no-translate).

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { CarFront, Plus } from "lucide-react";

import { Panel } from "@/components/panel";
import { db, storage } from "@/lib/firebase";
import { asDate, formatDayKey } from "@/lib/format";
import {
  driverTenure,
  driverTimeline,
  monthLabel,
  newYorkDayKey,
  tenureText,
  type ProfileAudit,
  type ProfileEntry,
  type ProfileFile,
} from "@/lib/fleet";
import { moneyText } from "@/lib/invoice-ledger";

import type { FleetState } from "./fleet-data";
import { fleetLang, FleetModal, SaveButton, useFleetRun } from "./fleet-ui";

type Row = Record<string, unknown> & { id: string };
const s = (v: unknown) => String(v ?? "").trim();

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const FILE_OK = /^(image\/.+|application\/pdf)$/i;

// ---------------------------------------------------------------------------
// The two facts at the top of the page.
// ---------------------------------------------------------------------------

/** Joined (start of the first car) and With the company (assigned days added up). */
export function ProfileTenureFacts({ driver, state }: { driver: Row; state: FleetState }) {
  const lang = fleetLang();
  const tenure = useMemo(
    () => driverTenure(state.index.assignmentsByDriver.get(driver.id) ?? [], state.todayKey),
    [state, driver.id],
  );
  return (
    <>
      <div>
        <small>Joined</small>
        <b data-no-translate>{tenure.joinedDayKey ? formatDayKey(tenure.joinedDayKey, lang) : "—"}</b>
      </div>
      <div>
        <small>With the company</small>
        <b data-no-translate>{tenure.joinedDayKey ? tenureText(tenure.days, lang) : "—"}</b>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Track record.
// ---------------------------------------------------------------------------

function useDriverAudit(businessId: string, driverId: string, refresh: number) {
  const [audit, setAudit] = useState<ProfileAudit[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(
          query(
            collection(db, "lotLedgerAudit"),
            where("businessId", "==", businessId),
            where("entityId", "==", driverId),
            orderBy("at", "desc"),
            limit(100),
          ),
        );
        if (cancelled) return;
        setAudit(
          snap.docs.map((d) => ({
            id: d.id,
            action: s(d.get("action")),
            atMs: asDate(d.get("at"))?.getTime() ?? 0,
          })),
        );
      } catch {
        // The edit lines are a bonus: the record is complete without them.
        if (!cancelled) setAudit([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, driverId, refresh]);
  return audit;
}

function EntryLine({ entry, lang }: { entry: ProfileEntry; lang: "en" | "fr" }) {
  const money = (cents?: number) => moneyText(cents ?? 0, lang);
  const day = (key?: string) => (key ? formatDayKey(key, lang) : "");
  const plate = entry.plate ? <b data-no-translate>{entry.plate}</b> : null;
  switch (entry.kind) {
    case "joined":
      return (
        <>
          <b>Joined</b>
          <span>First car</span> {plate}
        </>
      );
    case "car_given":
      return (
        <>
          <b>Car given</b>
          {plate}{" "}
          <span data-no-translate>
            {money(entry.rentCents)}
          </span>{" "}
          <span>{entry.period === "weekly" ? "a week" : "a month"}</span>
        </>
      );
    case "car_returned":
      return (
        <>
          <b>Car returned</b>
          {plate}
        </>
      );
    case "rent_change":
      return (
        <>
          <b>Rent changed</b>
          <span data-no-translate>
            {money(entry.fromRentCents)} → {money(entry.rentCents)}
          </span>
        </>
      );
    case "left_back":
      return (
        <>
          <b>Left</b>
          <span data-no-translate>{monthLabel(String(entry.leftDayKey).slice(0, 7), lang)}</span>
          {" · "}
          <b>Back</b>
          <span data-no-translate>{monthLabel(entry.dayKey.slice(0, 7), lang)}</span>
        </>
      );
    case "license":
      return (
        <>
          <b>TLC licence changed</b>
          <span>Old licence</span> <span data-no-translate>{entry.license}</span>
          {" · "}
          <span data-no-translate>
            {entry.fromDayKey ? `${day(entry.fromDayKey)} → ` : "→ "}
            {day(entry.toDayKey)}
          </span>
        </>
      );
    case "friend":
      return (
        <>
          <b>Friend drove the car</b>
          <span data-no-translate>{entry.name}</span> {plate}{" "}
          <span data-no-translate>
            {day(entry.fromDayKey)} → {day(entry.toDayKey)}
          </span>
        </>
      );
    case "late_fee":
      return (
        <>
          <b>Late fee</b>
          <span data-no-translate>{money(entry.amountCents)}</span>
        </>
      );
    case "charge":
      return (
        <>
          <b>Charge</b>
          <span data-no-translate>
            {entry.label} · {money(entry.amountCents)}
          </span>
        </>
      );
    case "waived":
      return (
        <>
          <b>Bill waived</b>
          <span data-no-translate>
            {entry.label} · {money(entry.amountCents)}
            {entry.text ? ` · ${entry.text}` : ""}
          </span>
        </>
      );
    case "note":
      return <NoteLine entry={entry} />;
    default:
      return <b>{entry.action === "fleet_driver_added" ? "Driver added" : "Driver details edited"}</b>;
  }
}

function NoteLine({ entry }: { entry: ProfileEntry }) {
  return (
    <span className={entry.voided ? "voided" : undefined}>
      <b>Office note</b>
      {entry.voided && <span className="fleet-chip muted">Removed</span>}{" "}
      {entry.text && (
        <span className="text" data-no-translate>
          {entry.text}
        </span>
      )}
      {entry.by && (
        <small className="fleet-note" data-no-translate>
          {entry.by}
        </small>
      )}
      {(entry.files?.length ?? 0) > 0 && <FileButtons files={entry.files ?? []} />}
    </span>
  );
}

/** Opens a stored file in a new tab (the download link is fetched on click, never in bulk). */
function FileButtons({ files }: { files: ProfileFile[] }) {
  const [error, setError] = useState("");
  const [opening, setOpening] = useState("");
  async function open(file: ProfileFile) {
    setError("");
    setOpening(file.path);
    try {
      const url = await getDownloadURL(storageRef(storage, file.path));
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      setError("The file could not be opened.");
    } finally {
      setOpening("");
    }
  }
  return (
    <>
      <span className="fleet-files">
        {files.map((f) => (
          <button className="ghost-button compact" disabled={opening === f.path} key={f.path} type="button" onClick={() => void open(f)}>
            <span data-no-translate>{f.name}</span>
          </button>
        ))}
      </span>
      {error && (
        <small className="fleet-note" role="alert">
          {error}
        </small>
      )}
    </>
  );
}

export function TrackRecordPanel({ businessId, driver, state, refresh }: { businessId: string; driver: Row; state: FleetState; refresh: number }) {
  const lang = fleetLang();
  const audit = useDriverAudit(businessId, driver.id, refresh);
  const entries = useMemo(() => driverTimeline(driver, state.index, audit), [driver, state, audit]);
  return (
    <Panel title="Track record" icon={<CarFront size={18} />}>
      {entries.length === 0 ? (
        <div className="empty-state">Nothing in the record yet.</div>
      ) : (
        <ol className="fleet-track">
          {entries.map((e) => (
            <li key={e.key}>
              <span className="when" data-no-translate>
                {e.dayKey ? formatDayKey(e.dayKey, lang) : "—"}
              </span>
              <span className="what">
                <EntryLine entry={e} lang={lang} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Office notes and files.
// ---------------------------------------------------------------------------

export function NotesPanel({ businessId, driver, state, isAdmin }: { businessId: string; driver: Row; state: FleetState; isAdmin: boolean }) {
  const [adding, setAdding] = useState(false);
  const { busy, error, run } = useFleetRun(businessId);
  const notes = useMemo(
    () => [...(state.index.notesByDriver.get(driver.id) ?? [])].sort((a, b) => Number(b.atMs || 0) - Number(a.atMs || 0)),
    [state, driver.id],
  );
  const lang = fleetLang();
  return (
    <Panel
      title="Office notes and files"
      icon={<CarFront size={18} />}
      action={
        <button className="ghost-button compact" type="button" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add a note
        </button>
      }
    >
      <p className="lst-hint">Only the office sees notes and files. Drivers never do.</p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {notes.length === 0 ? (
        <div className="empty-state">No notes yet.</div>
      ) : (
        <ol className="fleet-track">
          {notes.map((n) => {
            const voided = Boolean(n.voided);
            const ms = Number(n.atMs) || 0;
            return (
              <li key={n.id}>
                <span className="when" data-no-translate>
                  {ms ? formatDayKey(newYorkDayKey(new Date(ms)), lang) : "—"}
                </span>
                <span className="what">
                  <NoteLine
                    entry={{
                      key: n.id,
                      kind: "note",
                      dayKey: "",
                      text: s(n.text),
                      by: s(n.byName),
                      voided,
                      files: Array.isArray(n.files) ? (n.files as ProfileFile[]) : [],
                    }}
                  />
                  {isAdmin && !voided && (
                    <button
                      className="ghost-button compact"
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(
                          "note_void",
                          { noteId: n.id },
                          { en: "Remove this note? It stays on the list, greyed out.", fr: "Retirer cette note ? Elle reste dans la liste, en grisé." },
                        )
                      }
                    >
                      Remove
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {adding && <NoteDialog businessId={businessId} driver={driver} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function safeName(name: string): string {
  return name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "file";
}

function NoteDialog({ businessId, driver, onClose }: { businessId: string; driver: Row; onClose: () => void }) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const { busy, error, setError, run } = useFleetRun(businessId);
  const working = busy || uploading;

  function pick(list: FileList | null) {
    setError("");
    const files = Array.from(list ?? []);
    if (files.some((f) => !FILE_OK.test(f.type) || f.size >= MAX_FILE_BYTES)) {
      setError("A file is not allowed (images or PDF, up to 10 MB).");
      return;
    }
    if (files.length > 10) {
      setError("A file is not allowed (images or PDF, up to 10 MB).");
      return;
    }
    setPicked(files);
  }

  async function save() {
    setError("");
    if (!text.trim() && picked.length === 0) {
      setError("Write a note or attach a file.");
      return;
    }
    // Files go to Storage first; the server checks the paths and writes the note.
    const files: ProfileFile[] = [];
    setUploading(true);
    try {
      for (const f of picked) {
        const path = `fleetDocs/${businessId}/${driver.id}/${crypto.randomUUID()}-${safeName(f.name)}`;
        await uploadBytes(storageRef(storage, path), f, { contentType: f.type });
        files.push({ path, name: f.name, contentType: f.type, size: f.size });
      }
    } catch {
      setError("The file could not be uploaded. Try again.");
      return;
    } finally {
      setUploading(false);
    }
    const result = await run("note_add", { driverId: driver.id, text, files });
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Add a note"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={working}
      width={520}
      footer={
        <>
          <button className="lst-btn ghost" type="button" disabled={working} onClick={onClose}>Cancel</button>
          <SaveButton busy={working} label="Save note" busyLabel={uploading ? "Uploading..." : "Saving..."} onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      <div className="lst-form-grid">
        <label className="lst-field wide">
          <span>Note</span>
          <textarea data-no-translate disabled={working} maxLength={2000} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <label className="lst-field wide">
          <span>Files (images or PDF, up to 10 MB each)</span>
          <input accept="image/*,application/pdf" disabled={working} multiple type="file" onChange={(e) => pick(e.target.files)} />
        </label>
      </div>
    </FleetModal>
  );
}

// ---------------------------------------------------------------------------
// Friends who drove the car.
// ---------------------------------------------------------------------------

export function FriendsPanel({ businessId, driver, state, isAdmin }: { businessId: string; driver: Row; state: FleetState; isAdmin: boolean }) {
  const [adding, setAdding] = useState(false);
  const { busy, error, run } = useFleetRun(businessId);
  const lang = fleetLang();
  const friends = useMemo(
    () => [...(state.index.substitutesByDriver.get(driver.id) ?? [])].sort((a, b) => s(b.fromDayKey).localeCompare(s(a.fromDayKey))),
    [state, driver.id],
  );
  return (
    <Panel
      title="Friends who drove"
      icon={<CarFront size={18} />}
      action={
        <button className="ghost-button compact" type="button" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add a friend
        </button>
      }
    >
      <p className="lst-hint">Your driver stays responsible for the rent and for any ticket charged to them.</p>
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {friends.length === 0 ? (
        <div className="empty-state">No friend has driven this car yet.</div>
      ) : (
        <ul className="fleet-friend-list">
          {friends.map((f) => {
            const voided = f.voided === true;
            const plate = s(state.index.carById.get(s(f.carId))?.plate);
            return (
              <li className={voided ? "voided" : undefined} key={f.id}>
                <span>
                  <b data-no-translate>{s(f.name)}</b>{" "}
                  <span data-no-translate>
                    {[s(f.phone), s(f.tlcLicense) && `TLC ${s(f.tlcLicense)}`, plate].filter(Boolean).join(" · ")}
                  </span>
                  <small className="fleet-note" data-no-translate>
                    {formatDayKey(f.fromDayKey, lang)} → {formatDayKey(f.toDayKey, lang)}
                  </small>
                </span>
                {voided ? (
                  <span className="fleet-chip muted">Removed</span>
                ) : (
                  isAdmin && (
                    <button
                      className="ghost-button compact"
                      disabled={busy}
                      type="button"
                      onClick={() =>
                        void run(
                          "substitute_void",
                          { substituteId: f.id },
                          { en: "Remove this friend period?", fr: "Retirer cette période d’ami ?" },
                        )
                      }
                    >
                      Remove
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {adding && <FriendDialog businessId={businessId} driver={driver} state={state} onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function FriendDialog({ businessId, driver, state, onClose }: { businessId: string; driver: Row; state: FleetState; onClose: () => void }) {
  // The cars this driver has had; the current one (or the latest) is the default.
  const cars = useMemo(() => {
    const mine = [...(state.index.assignmentsByDriver.get(driver.id) ?? [])].sort((a, b) => s(b.startDayKey).localeCompare(s(a.startDayKey)));
    const seen = new Set<string>();
    const out: Row[] = [];
    for (const a of mine) {
      const car = state.index.carById.get(s(a.carId));
      if (car && !seen.has(car.id)) {
        seen.add(car.id);
        out.push(car);
      }
    }
    return out;
  }, [state, driver.id]);
  const [draft, setDraft] = useState({
    carId: cars[0]?.id ?? "",
    name: "",
    phone: "",
    tlcLicense: "",
    line1: "",
    city: "",
    state: "",
    zip: "",
    from: state.todayKey,
    to: state.todayKey,
  });
  const { busy, error, setError, run } = useFleetRun(businessId);
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));

  async function save() {
    if (!draft.name.trim() || !draft.carId || !draft.from || !draft.to || draft.to < draft.from) {
      setError("Some details are missing or not valid.");
      return;
    }
    const result = await run("substitute_save", {
      driverId: driver.id,
      carId: draft.carId,
      friend: {
        name: draft.name,
        phone: draft.phone,
        tlcLicense: draft.tlcLicense,
        address: { line1: draft.line1, city: draft.city, state: draft.state, zip: draft.zip },
      },
      fromDayKey: draft.from,
      toDayKey: draft.to,
    });
    if (result) onClose();
  }

  return (
    <FleetModal
      title="Add a friend"
      subtitle={<span data-no-translate>{s(driver.name)}</span>}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button className="lst-btn ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <SaveButton busy={busy} disabled={cars.length === 0} label="Save friend" busyLabel="Saving..." onClick={() => void save()} />
        </>
      }
    >
      {error && <div className="lst-form-error" role="alert">{error}</div>}
      {cars.length === 0 && <p className="lst-hint">This driver has not had a car yet.</p>}
      <div className="lst-form-grid">
        <label className="lst-field wide">
          <span>Car</span>
          <select disabled={busy} value={draft.carId} onChange={set("carId")}>
            {cars.map((c) => (
              <option data-no-translate key={c.id} value={c.id}>
                {s(c.plate)}
              </option>
            ))}
          </select>
        </label>
        <label className="lst-field wide">
          <span>Friend&apos;s full name</span>
          <input autoFocus data-no-translate disabled={busy} maxLength={120} value={draft.name} onChange={set("name")} />
        </label>
        <label className="lst-field">
          <span>Phone</span>
          <input data-no-translate disabled={busy} inputMode="tel" value={draft.phone} onChange={set("phone")} />
        </label>
        <label className="lst-field">
          <span>TLC licence</span>
          <input data-no-translate disabled={busy} maxLength={20} value={draft.tlcLicense} onChange={set("tlcLicense")} />
        </label>
        <label className="lst-field wide">
          <span>Street address</span>
          <input data-no-translate disabled={busy} maxLength={160} value={draft.line1} onChange={set("line1")} />
        </label>
        <label className="lst-field">
          <span>City</span>
          <input data-no-translate disabled={busy} maxLength={80} value={draft.city} onChange={set("city")} />
        </label>
        <label className="lst-field">
          <span>State</span>
          <input data-no-translate disabled={busy} maxLength={40} value={draft.state} onChange={set("state")} />
        </label>
        <label className="lst-field">
          <span>ZIP code</span>
          <input data-no-translate disabled={busy} maxLength={12} value={draft.zip} onChange={set("zip")} />
        </label>
        <label className="lst-field">
          <span>First day</span>
          <input disabled={busy} type="date" value={draft.from} onChange={set("from")} />
        </label>
        <label className="lst-field">
          <span>Last day</span>
          <input disabled={busy} type="date" value={draft.to} onChange={set("to")} />
        </label>
      </div>
    </FleetModal>
  );
}
