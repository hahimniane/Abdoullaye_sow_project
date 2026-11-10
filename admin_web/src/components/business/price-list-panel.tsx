"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { CheckCircle2, History, Plane, Plus, RefreshCw, Save, Ship, Tag, Trash2 } from "lucide-react";

import { useBusinessDestinations, useLiveDocRead } from "@/lib/business-data";
import {
  categoryLabel,
  emptyRouteDraft,
  listDraftFrom,
  listPayload,
  listProblem,
  newItemDraft,
  perUnitText,
  priceListFailure,
  priceListHistory,
  priceListMessage,
  priceListView,
  routeSummary,
  unitChangedNotice,
  weekdayShort,
  weeksText,
  type CountryDraft,
  type ItemDraft,
  type Lang,
  type ListDraft,
  type RouteDraft,
} from "@/lib/business-price-list";
import { destinationCountryOptionForRow } from "@/lib/destination-countries";
import { functions } from "@/lib/firebase";
import { currentLanguage, formatDateTime } from "@/lib/format";
import { BOX_PRICED_IDS, boxPicture, boxPriceFieldLabel, boxSizeExample, boxSizeLimit, boxSizeName } from "@/lib/package-box";
import { CATEGORIES, LIMIT, WEEK_DAYS, type PriceMode, type WeekDayKey, type WeightUnit } from "@/lib/package-price-list";

type Props = {
  businessId: string;
  /** The owner (or admin) of the business, or a Laawol platform admin: the server is the judge. */
  canEdit: boolean;
  /** A Laawol admin editing another business's list: saved lists wait for the business to check them. */
  byLaawol?: boolean;
  previewMode?: boolean;
};

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

const MODE_LABEL: Record<PriceMode, string> = { sea: "Sea", air: "Air" };

function lang(): Lang {
  return currentLanguage() === "fr" ? "fr" : "en";
}

/**
 * Shipping > Price list: what a business charges to send a package, per
 * destination country, separately by Sea and by Air (docs/PACKAGE_PRICE_LIST.md
 * §6). Items with a fixed price (optionally "covers up to X lb"), a price per
 * pound per category, and the weekly departure days. The whole list is priced
 * in one unit, per lb or per kg (docs/SHIPPING_SIMPLE_HOME.md K1). Save sends
 * the WHOLE map. The same component is mounted in the Laawol admin console for any
 * business, where a save asks the business to check it.
 */
export function PriceListPanel({ businessId, canEdit, byLaawol = false, previewMode = false }: Props) {
  const live = !previewMode;
  const destinations = useBusinessDestinations(businessId, live);
  const listRead = useLiveDocRead("packagePriceLists", businessId, live);
  const l = lang();

  const stored = useMemo(() => priceListView(listRead.row), [listRead.row]);
  const history = useMemo(() => priceListHistory(listRead.row), [listRead.row]);

  // The countries the editor offers: the ones the business ships to, plus any
  // that already carry a price (so a paused country keeps its prices on save).
  const countries = useMemo(() => {
    const byId = new Map<string, { id: string; name: string }>();
    for (const row of destinations.rows) {
      const id = String(row.id ?? "");
      if (!id) continue;
      if (row.isActive !== true && !stored.routes[id]) continue;
      const option = destinationCountryOptionForRow(row);
      byId.set(id, { id, name: l === "fr" ? option.nameFr ?? option.name : option.name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, l));
  }, [destinations.rows, stored.routes, l]);
  const countryIds = useMemo(() => countries.map((c) => c.id), [countries]);
  const countryName = (id: string) => countries.find((c) => c.id === id)?.name ?? id;

  const serverDraft = useMemo(() => listDraftFrom(stored.routes, countryIds, l), [stored.routes, countryIds, l]);
  const [edits, setEdits] = useState<ListDraft | null>(null);
  // After a save, the edits stay on screen until the live list shows the
  // save (so the old prices never flash back), at most 8 seconds.
  const [savedFrom, setSavedFrom] = useState<number | null>(null);
  useEffect(() => {
    if (savedFrom === null) return undefined;
    if (stored.updatedAtMs !== savedFrom) {
      setEdits(null);
      setUnitEdit(null);
      setSavedFrom(null);
      return undefined;
    }
    const timer = setTimeout(() => { setEdits(null); setUnitEdit(null); setSavedFrom(null); }, 8000);
    return () => clearTimeout(timer);
  }, [savedFrom, stored.updatedAtMs]);
  const draft: ListDraft = useMemo(() => ({ ...serverDraft, ...(edits ?? {}) }), [serverDraft, edits]);
  // The list's one unit: what is saved, until the owner picks the other. The
  // amounts stay as typed; only what they mean changes (so they are told once).
  const [unitEdit, setUnitEdit] = useState<WeightUnit | null>(null);
  const unit: WeightUnit = unitEdit ?? stored.weightUnit;
  const unitChanged = unit !== stored.weightUnit;
  const dirty = edits !== null || unitChanged;

  const [picked, setPicked] = useState("");
  const [mode, setMode] = useState<PriceMode>("sea");
  const countryId = countryIds.includes(picked) ? picked : countryIds[0] ?? "";
  const country: CountryDraft = draft[countryId] ?? { sea: emptyRouteDraft(), air: emptyRouteDraft() };
  const route = country[mode];

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  function editRoute(change: (route: RouteDraft) => RouteDraft) {
    if (!countryId) return;
    setFlash("");
    setError("");
    setEdits((current) => {
      const base = { ...serverDraft, ...(current ?? {}) };
      const pair = base[countryId] ?? { sea: emptyRouteDraft(), air: emptyRouteDraft() };
      return { ...base, [countryId]: { ...pair, [mode]: change(pair[mode]) } };
    });
  }
  const setItem = (key: string, patch: Partial<ItemDraft>) =>
    editRoute((r) => ({ ...r, items: r.items.map((item) => (item.key === key ? { ...item, ...patch } : item)) }));

  async function call(data: Record<string, unknown>) {
    return httpsCallable<Record<string, unknown>, unknown>(functions, "setPackageRequestSettings")({ businessId, ...data });
  }

  async function save() {
    const problem = listProblem(draft);
    if (problem) {
      setError(priceListMessage(problem, unit));
      return;
    }
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await call({ action: "price_list", ...listPayload(draft), weightUnit: unit });
      setSavedFrom(stored.updatedAtMs);
      setFlash(byLaawol ? "Price list saved. The business is asked to check it." : "Price list saved.");
    } catch (err) {
      setError(priceListFailure(err, unit).message);
    } finally {
      setBusy(false);
    }
  }

  async function looksRight() {
    setBusy(true);
    setError("");
    setFlash("");
    try {
      await call({ action: "price_list_checked" });
      setFlash("Thanks. Your price list is confirmed.");
    } catch (err) {
      setError(priceListFailure(err).message);
    } finally {
      setBusy(false);
    }
  }

  const loading = live && (destinations.loading || !listRead.settled);
  // A list that failed to load is never edited: saving would replace every
  // country's prices with what this screen wrongly thinks is empty.
  const readFailed = live && listRead.failed;
  const readOnly = !canEdit || previewMode || readFailed;
  const modeRoutes = (m: PriceMode) => (countryId ? stored.routes[countryId]?.[m] : undefined);

  return (
    <article className="panel plist">
      <div className="panel-header">
        <div>
          <Tag size={18} aria-hidden="true" />
          <h2>Price list</h2>
        </div>
      </div>
      <p className="panel-lede">What you charge to send a package, by country, for sea and for air. Customers see these prices when they compare businesses.</p>

      {stored.needsCheck && (
        <div className="pkq-banner warn" role="status">
          <strong>{byLaawol ? "Laawol set up these prices. The business has not checked them yet." : "Laawol set up your prices. Please check them."}</strong>
          {!byLaawol && canEdit && !previewMode && (
            <button className="lst-add" data-loading={busy} disabled={busy || dirty} onClick={() => void looksRight()} type="button">
              <CheckCircle2 size={14} aria-hidden="true" /> Looks right
            </button>
          )}
          {!byLaawol && dirty && <small className="pkq-muted">Save or discard your changes first.</small>}
        </div>
      )}
      {readOnly && !previewMode && <p className="pkq-banner" role="status">Only the business owner can change the price list.</p>}
      {flash && <p className="pkq-banner" role="status">{flash}</p>}
      {readFailed && (
        <div className="pkq-banner warn" role="alert">
          <span>The price list could not be loaded, so it cannot be changed right now.</span>
          <button className="lst-btn ghost" onClick={() => window.location.reload()} type="button">
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><RefreshCw className="spin" size={16} aria-hidden="true" /> Loading…</div>
      ) : countries.length === 0 ? (
        <EmptyState text="No destination countries yet. Add the countries you ship to under Services & coverage, then price them here." />
      ) : (
        <>
          <div className="plist-pick">
            <label className="lst-field">
              <span>Destination country</span>
              <select onChange={(event) => setPicked(event.target.value)} value={countryId}>
                {countries.map((c) => (
                  <option data-no-translate key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </label>
            <div className="service-segments pcs-kinds" role="tablist" aria-label="How it travels">
              {(["sea", "air"] as PriceMode[]).map((m) => (
                <button
                  aria-selected={mode === m}
                  className={`segment${mode === m ? " active" : ""}`}
                  key={m}
                  onClick={() => setMode(m)}
                  role="tab"
                  type="button"
                >
                  {m === "sea" ? <Ship size={14} aria-hidden="true" /> : <Plane size={14} aria-hidden="true" />}
                  {MODE_LABEL[m]}
                  {modeRoutes(m) && <b aria-hidden="true">•</b>}
                </button>
              ))}
            </div>
          </div>
          {modeRoutes(mode) ? (
            <p className="plist-summary" data-no-translate>{routeSummary(modeRoutes(mode), l)}</p>
          ) : (
            <p className="plist-summary">Nothing priced yet for this route. Customers see it as “ask me”.</p>
          )}

          <section className="pkq-settings-block">
            <h4>Items and prices</h4>
            <small className="lst-hint">
              {unit === "kg"
                ? "A fixed price for each item. “Covers up to” is optional: leave it empty when the price is the same at any weight. The extra kilos are charged at the item's category rate per kilo below, else the General goods rate. With neither, you type the price at the counter."
                : "A fixed price for each item. “Covers up to” is optional: leave it empty when the price is the same at any weight. The extra pounds are charged at the item's category rate per pound below, else the General goods rate. With neither, you type the price at the counter."}
            </small>
            {route.items.length > 0 && (
              <div className="plist-items">
                <div className="plist-row plist-head" aria-hidden="true">
                  <span>Item</span>
                  <span>Category</span>
                  <span>Price ($)</span>
                  <span>{unit === "kg" ? "Covers up to (kg)" : "Covers up to (lb)"}</span>
                  <span />
                </div>
                {route.items.map((item) => (
                  <div className="plist-row" key={item.key}>
                    <label className="lst-field">
                      <span className="plist-label">Item</span>
                      <input
                        disabled={readOnly}
                        maxLength={LIMIT.LABEL}
                        onChange={(event) => setItem(item.key, { label: event.target.value })}
                        placeholder="e.g. Phone"
                        value={item.label}
                      />
                    </label>
                    <label className="lst-field">
                      <span className="plist-label">Category</span>
                      <select disabled={readOnly} onChange={(event) => setItem(item.key, { categoryId: event.target.value })} value={item.categoryId}>
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>{categoryLabel(c.id, l)}</option>
                        ))}
                      </select>
                    </label>
                    <label className="lst-field">
                      <span className="plist-label">Price ($)</span>
                      <input
                        disabled={readOnly}
                        inputMode="decimal"
                        onChange={(event) => setItem(item.key, { price: event.target.value })}
                        placeholder={l === "fr" ? "40,00" : "40.00"}
                        value={item.price}
                      />
                    </label>
                    <label className="lst-field">
                      <span className="plist-label">{unit === "kg" ? "Covers up to (kg)" : "Covers up to (lb)"}</span>
                      <input
                        disabled={readOnly}
                        inputMode="decimal"
                        onChange={(event) => setItem(item.key, { includedLb: event.target.value })}
                        placeholder="Any weight"
                        value={item.includedLb}
                      />
                    </label>
                    {!readOnly && (
                      <button
                        aria-label="Remove item"
                        className="ghost-button"
                        onClick={() => editRoute((r) => ({ ...r, items: r.items.filter((i) => i.key !== item.key) }))}
                        title="Remove item"
                        type="button"
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!readOnly && (
              <div>
                <button
                  className="lst-btn ghost"
                  disabled={route.items.length >= LIMIT.ITEMS_PER_ROUTE}
                  onClick={() => editRoute((r) => ({ ...r, items: [...r.items, newItemDraft()] }))}
                  type="button"
                >
                  <Plus size={14} aria-hidden="true" /> Add an item
                </button>
              </div>
            )}
            {readOnly && route.items.length === 0 && <p className="pkq-muted">No items priced.</p>}
          </section>

          {mode === "sea" && (
            <section className="pkq-settings-block plist-boxes">
              <h4>Box sizes</h4>
              <small className="lst-hint">
                Laawol sets the sizes for every business; you set the price of each. Customers pick a size (or type the inches) and see your price. Staff confirm the size at the counter, at today&apos;s price. Leave a size empty to quote it by hand.
              </small>
              <div className="plist-box-grid">
                {BOX_PRICED_IDS.map((id) => (
                  <label className="plist-box" key={id}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" height={72} src={boxPicture(id)} width={72} />
                    <strong data-no-translate>{boxSizeName(id, l)}</strong>
                    <small data-no-translate>{boxSizeExample(id, l)}</small>
                    <small data-no-translate>{boxSizeLimit(id, l)}</small>
                    <span className="lst-field">
                      <span className="plist-label">Price ($)</span>
                      <input
                        aria-label={boxPriceFieldLabel(id, l)}
                        disabled={readOnly}
                        inputMode="decimal"
                        onChange={(event) => editRoute((r) => ({ ...r, boxPrices: { ...r.boxPrices, [id]: event.target.value } }))}
                        placeholder={l === "fr" ? "35,00" : "35.00"}
                        value={route.boxPrices[id] ?? ""}
                      />
                    </span>
                  </label>
                ))}
                <div className="plist-box quote">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" height={72} src={boxPicture("xl")} width={72} />
                  <strong data-no-translate>{boxSizeName("xl", l)}</strong>
                  <small data-no-translate>{boxSizeExample("xl", l)}</small>
                  <small>Extra large: you quote it</small>
                </div>
              </div>
            </section>
          )}

          <section className="pkq-settings-block">
            <h4>{unit === "kg" ? "Price per kilo" : "Price per pound"}</h4>
            <small className="lst-hint">For goods sold by weight, such as clothes or food. Leave a category empty to quote it by hand.</small>
            <div className="plist-unit-row">
              <span id="plist-unit-label">Price list unit</span>
              <div className="plist-unit" role="radiogroup" aria-labelledby="plist-unit-label">
                {(["lb", "kg"] as WeightUnit[]).map((choice) => (
                  <button
                    aria-checked={unit === choice}
                    className={unit === choice ? "active" : ""}
                    data-no-translate
                    disabled={readOnly}
                    key={choice}
                    onClick={() => { setFlash(""); setError(""); setUnitEdit(choice === stored.weightUnit ? null : choice); }}
                    role="radio"
                    type="button"
                  >
                    {perUnitText(choice, l)}
                  </button>
                ))}
              </div>
            </div>
            {unitChanged && <p className="pkq-banner warn" role="status">{unitChangedNotice(unit)}</p>}
            <div className="plist-rates">
              {CATEGORIES.map((c) => (
                <label className="lst-field" key={c.id}>
                  <span>{categoryLabel(c.id, l)}</span>
                  <input
                    aria-label={unit === "kg" ? `${categoryLabel(c.id, l)}, $ per kilo` : `${categoryLabel(c.id, l)}, $ per pound`}
                    disabled={readOnly}
                    inputMode="decimal"
                    onChange={(event) => editRoute((r) => ({ ...r, rates: { ...r.rates, [c.id]: event.target.value } }))}
                    placeholder={unit === "kg" ? "$ per kg" : "$ per lb"}
                    value={route.rates[c.id] ?? ""}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className="pkq-settings-block">
            <h4>Departure days</h4>
            <small className="lst-hint">
              {mode === "air"
                ? "The regular days a flight leaves. Customers see the next one. A planned date on a flight takes over."
                : "The regular days a container leaves. Customers see the next one. A planned date on a container takes over."}
            </small>
            <fieldset className="destination-departure-days">
              <legend className="sr-only">Departure days</legend>
              <div>
                {WEEK_DAYS.map((day: WeekDayKey) => {
                  const on = route.departure.days.includes(day);
                  return (
                    <label className={on ? "selected" : ""} key={day}>
                      <input
                        checked={on}
                        disabled={readOnly}
                        onChange={(event) =>
                          editRoute((r) => ({
                            ...r,
                            departure: {
                              ...r.departure,
                              days: WEEK_DAYS.filter((d) => (d === day ? event.target.checked : r.departure.days.includes(d))),
                            },
                          }))
                        }
                        type="checkbox"
                      />
                      <span data-no-translate>{weekdayShort(day, l)}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {route.departure.days.length > 0 && (
              <div className="plist-cadence">
                <label className="lst-field">
                  <span>How often</span>
                  <select
                    disabled={readOnly}
                    onChange={(event) => editRoute((r) => ({ ...r, departure: { ...r.departure, everyWeeks: event.target.value } }))}
                    value={route.departure.everyWeeks}
                  >
                    {Array.from({ length: LIMIT.EVERY_WEEKS }, (_, i) => String(i + 1)).map((n) => (
                      <option key={n} value={n}>
                        {weeksText(Number(n), l)}
                      </option>
                    ))}
                  </select>
                </label>
                {Number(route.departure.everyWeeks) > 1 && (
                  <label className="lst-field">
                    <span>Counting from the week of</span>
                    <input
                      disabled={readOnly}
                      onChange={(event) => editRoute((r) => ({ ...r, departure: { ...r.departure, anchorDate: event.target.value } }))}
                      type="date"
                      value={route.departure.anchorDate}
                    />
                  </label>
                )}
              </div>
            )}
          </section>

          {error && <div className="lst-form-error" role="alert">{error}</div>}
          {!readOnly && (
            <div className="plist-actions">
              <button className="lst-add" data-loading={busy} disabled={busy || !dirty || savedFrom !== null} onClick={() => void save()} type="button">
                {busy ? <RefreshCw className="spin" size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} {busy ? "Saving..." : "Save price list"}
              </button>
              {dirty && (
                <button className="lst-btn ghost" disabled={busy} onClick={() => { setEdits(null); setUnitEdit(null); setError(""); }} type="button">Discard changes</button>
              )}
              <small className="pkq-muted">Saving sends every country at once. Open requests that use a changed price get a new estimate.</small>
            </div>
          )}

          {history.length > 0 && (
            <details className="pkq-history plist-history">
              <summary><History size={14} aria-hidden="true" /> <span>History</span></summary>
              <ul>
                {history.map((h) => (
                  <li key={`${h.atMs}-${h.action}`}>
                    <span>
                      <strong data-no-translate>{formatDateTime(h.atMs)}</strong>{" "}
                      <span data-no-translate>{h.action === "checked" ? (l === "fr" ? "Vérifiée : c’est bon" : "Checked: looks right") : (l === "fr" ? "Enregistrée" : "Saved")}</span>
                    </span>
                    <small data-no-translate>
                      {h.byLaawol ? `${h.byName || "Laawol"} (Laawol)` : h.byName}
                      {h.countries.length > 0 ? ` · ${h.countries.map(countryName).join(", ")}` : ""}
                    </small>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </article>
  );
}
