"use client";

import { deviceStorage, loadPackageOptions, readCachedPackageOptions } from "@/lib/package-request-options";
import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Box, CheckCircle2, CreditCard, MapPin, Plane, Plus, RefreshCw, Ship, Store, Trash2, Truck } from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { BoxLineCard } from "@/components/box-designer/box-line-card";
import { QuantityStepper } from "@/components/quantity-stepper";
import { RequestPhotoStrip } from "@/components/request-photo-strip";
import { functions } from "@/lib/firebase";
import { phoneCountryForDestination } from "@/lib/container-manifest";
import { currentWebLanguage } from "@/lib/language";
import {
  NO_FILTERS,
  SHIP_MODES,
  SORT_KEYS,
  addBoxLine,
  addOtherLine,
  addWeightLine,
  airOffered,
  applySizePreset,
  barrelQuantity,
  buildCatalog,
  businessesCountText,
  catalogWeightUnit,
  categoryLabel,
  chooseCountry,
  chooseHandoff,
  chooseMode,
  compareRows,
  dayChoices,
  departureText,
  emptySendDraft,
  handoffProblems,
  includedLbText,
  itemQuantity,
  itemsProblems,
  modeOptions,
  peopleProblems,
  pickupFeeText,
  pickupQuotePayloads,
  piecesCountText,
  pieceCount,
  ratingText,
  setBarrelQuantity,
  setItemQuantity,
  setWeightUnit,
  sentView,
  submitPayload,
  totalText,
  typeWeight,
  visibleRows,
  whenProblems,
  whenText,
  windowText,
  windowsForDay,
  type BasketLine,
  type CompareRow,
  type PickupQuote,
  type RowFilters,
  type SendDraft,
  type ShipMode,
  type SortKey,
} from "@/lib/package-compare";
import { BOX_PHOTO_LIMIT, boxPricesOf, lowestBoxPrices, type BoxLine } from "@/lib/package-box";
import { SIZE_PRESETS } from "@/lib/package-price-list";
import {
  REQUEST_ERROR_MESSAGES,
  REQUEST_ERROR_STEP,
  REQUEST_LIMITS,
  countryName,
  hoursLines,
  newIdempotencyKey,
  pieceKindLabel,
  requestCountries,
  requestFailure,
  selectedLocation,
  type Handoff,
  type RequestBusinessHeader,
  type RequestFieldStep,
  type RequestOption,
} from "@/lib/package-requests";
import { ensureRequestSession, uploadRequestPhoto } from "@/lib/request-photo";

const LOAD_TIMEOUT_MS = 20_000;

type Step = RequestFieldStep | "compare" | "sent";

type SentRequest = { requestId: string; code: string; token: string; status: string; totalCents: number | null };

type SentSnapshot = {
  result: SentRequest;
  handoff: Handoff;
  businessName: string;
  when: string;
  place: string;
  weighs: boolean;
};

type PackageRequestFormProps = {
  /** `/r/<slug>`: the business is chosen already. */
  slug?: string;
  /** A signed-in customer's name and phone fill the sender. */
  senderName?: string;
  senderPhone?: string;
  /** Chosen "pay barrels now by card" at a business that keeps card booking. */
  onPayByCard?: (option: RequestOption) => void;
};

async function call<T>(name: string, data: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      httpsCallable<Record<string, unknown>, T>(functions, name)(data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "functions/deadline-exceeded" })), LOAD_TIMEOUT_MS);
      }),
    ]);
    return response.data;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The businesses behind the form (shared with the router's early request). */
function fetchPackageOptions(data: Record<string, unknown>) {
  return call<{ business: unknown; options: unknown[] }>("listPackageRequestOptions", data);
}

function FieldError({ codes, show }: { codes: string[]; show: string[] }) {
  const code = show.find((c) => codes.includes(c));
  if (!code) return null;
  return <small className="customer-field-error">{REQUEST_ERROR_MESSAGES[code]}</small>;
}

const CHOOSE_BUSINESS = "Choose a business.";

const SORT_LABELS: Record<SortKey, string> = {
  best: "Best match",
  price: "Lowest price",
  rating: "Highest rated",
  soonest: "Soonest departure",
};

/**
 * The customer's "Send a package" (docs/PACKAGE_PRICE_LIST.md §6): country and
 * Sea or Air, the items (from the price lists of the businesses that ship
 * there), how the goods reach the business, a comparison with each business's
 * total, the drop-off or pickup time, then who sends and who receives. One
 * language per page, the one the language picker chose.
 *
 * Opened on a business's own link (`slug`) it skips the comparison. No card
 * is asked: the price is shown, paid at drop-off or pickup.
 */
export function PackageRequestForm({ slug = "", senderName = "", senderPhone = "", onPayByCard }: PackageRequestFormProps) {
  const lang = currentWebLanguage();
  const [options, setOptions] = useState<RequestOption[]>([]);
  const [business, setBusiness] = useState<RequestBusinessHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState<Step>("where");
  const [draft, setDraft] = useState<SendDraft>(() => emptySendDraft({ name: senderName, phone: senderPhone }));
  const [quotes, setQuotes] = useState<PickupQuote[]>([]);
  const [quotedKey, setQuotedKey] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [sort, setSort] = useState<SortKey>("best");
  const [filters, setFilters] = useState<RowFilters>(NO_FILTERS);
  const [tried, setTried] = useState<Step | "">("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [error, setError] = useState("");
  // The server's refusal, shown on the step it sent the customer back to.
  const errorFor = (where: string) => (error && serverErrors.some((r) => REQUEST_ERROR_STEP[r] === where) ? error : "");
  const [sending, setSending] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [sent, setSent] = useState<SentSnapshot | null>(null);
  // One key per filled-in form: a double tap or a retry after a timeout is
  // the same request (the server answers the first one again).
  const idempotencyKey = useRef(newIdempotencyKey());
  // A chosen photo stays on the device until Send: its folder is the chosen
  // business's, which is not known while the items are being added.
  const photoFiles = useRef<Record<string, File>>({});
  const uploadedFor = useRef<Record<string, string>>({});
  const cardRef = useRef<HTMLElement | null>(null);

  const viaBusiness = business !== null;

  useEffect(() => {
    let active = true;
    setLoadError("");
    type Answer = { business: RequestBusinessHeader | null; options: RequestOption[] };
    const apply = (result: Answer) => {
      const list = Array.isArray(result.options) ? result.options : [];
      setOptions(list);
      setBusiness(result.business ?? null);
      if (result.business) {
        const countries = [...new Set(list.map((o) => o.country.id))];
        setDraft((d) => ({ ...d, businessId: result.business?.businessId ?? "", countryId: countries.length === 1 ? countries[0] : d.countryId }));
      }
    };
    // The last answer on this device shows at once; the fresh one replaces it
    // (lib/package-request-options.ts). Without one the spinner shows as before.
    const kept = readCachedPackageOptions(deviceStorage(), slug ?? "", Date.now()) as Answer | null;
    if (kept) {
      apply(kept);
      setLoading(false);
    } else {
      setLoading(true);
    }
    loadPackageOptions(slug ?? "", fetchPackageOptions)
      .then((result) => {
        if (active) apply(result as Answer);
      })
      .catch((err) => {
        // With a kept answer on screen, a failed refresh changes nothing.
        if (!active || kept) return;
        const failure = requestFailure(err);
        setLoadError(failure.reason === "business_not_found" ? REQUEST_ERROR_MESSAGES.business_not_found : "We could not load the businesses. Check your connection and try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, reload]);

  // A new screen opens at its top (the card is taller than a phone).
  useEffect(() => {
    try {
      cardRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    } catch {
      // Older browsers: the page just stays where it is.
    }
  }, [step]);

  const onlyBusinessId = business?.businessId ?? "";
  const countries = useMemo(() => requestCountries(options, lang), [options, lang]);
  const airOk = useMemo(() => airOffered(options, draft.countryId), [options, draft.countryId]);
  const modeOpts = useMemo(() => modeOptions(options, draft.countryId, draft.shipMode), [options, draft.countryId, draft.shipMode]);
  // The unit the weights are asked in: the business's own on its own link, pounds when comparing
  // (each business then prices the customer's number in its own unit).
  const weightUnit = useMemo(() => catalogWeightUnit(modeOpts, viaBusiness ? onlyBusinessId : ""), [modeOpts, viaBusiness, onlyBusinessId]);
  const catalog = useMemo(() => buildCatalog(modeOpts, draft.shipMode, weightUnit), [modeOpts, draft.shipMode, weightUnit]);
  const canBring = modeOpts.some((o) => o.bringIn.available);
  const canCollect = modeOpts.some((o) => o.collect.available);
  const rows = useMemo(
    () => (draft.handoff ? compareRows(options, { countryId: draft.countryId, mode: draft.shipMode, lines: draft.lines, handoff: draft.handoff, quotes }) : []),
    [options, draft.countryId, draft.shipMode, draft.lines, draft.handoff, quotes],
  );
  const shown = useMemo(() => visibleRows(rows, sort, filters), [rows, sort, filters]);
  // On a business's own link the business is the only one in the list.
  const chosenId = draft.businessId || (viaBusiness ? onlyBusinessId : "");
  const chosen: CompareRow | null = rows.find((row) => row.businessId === chosenId && !row.blocked) ?? null;
  const option = chosen?.option ?? null;
  const location = selectedLocation(option, draft);
  const zone = option?.timeZone || "America/New_York";
  const bringDays = useMemo(() => dayChoices(location?.hours, zone, lang), [location, zone, lang]);
  const pickupDays = useMemo(() => dayChoices(null, zone, lang, Date.now(), true), [zone, lang]);
  const handoff = draft.handoff;
  const dateKey = handoff === "collect" ? draft.pickupDate : draft.plannedDate;
  const windows = useMemo(
    () => (handoff ? windowsForDay({ handoff, hours: location?.hours, dateKey, zone }) : []),
    [handoff, location, dateKey, zone],
  );
  const itemErrors = itemsProblems(draft.lines);
  const handoffErrors = handoffProblems(draft);
  const whenErrors = whenProblems(draft, option);
  const peopleErrors = peopleProblems(draft);
  const receiverCountry = phoneCountryForDestination(
    { destinationCountryId: draft.countryId, destinationCountryName: option?.country.name ?? modeOpts[0]?.country.name ?? "" },
    "US",
  );
  const allBarrels = draft.lines.length > 0 && draft.lines.every((line) => line.type === "barrel");
  const addressKey = `${draft.countryId}|${draft.shipMode}|${draft.pickupAddress.trim()}`;
  const shownItems = tried === "items" ? [...itemErrors, ...serverErrors] : serverErrors;
  const shownHandoff = tried === "handoff" ? [...handoffErrors, ...serverErrors] : serverErrors;
  const shownWhen = tried === "when" ? [...whenErrors, ...serverErrors] : serverErrors;
  const shownPeople = tried === "people" ? [...peopleErrors, ...serverErrors] : serverErrors;

  function update(patch: Partial<SendDraft>) {
    setServerErrors([]);
    setError("");
    setDraft((d) => ({ ...d, ...patch }));
  }

  function setLines(next: (lines: BasketLine[]) => BasketLine[]) {
    setServerErrors([]);
    setError("");
    setDraft((d) => ({ ...d, lines: next(d.lines), businessId: viaBusiness ? d.businessId : "" }));
  }

  function updateLine(key: string, patch: (line: BasketLine) => BasketLine) {
    setLines((lines) => lines.map((line) => (line.key === key ? patch(line) : line)));
  }

  function pickCountry(countryId: string) {
    setServerErrors([]);
    setError("");
    setQuotes([]);
    setQuotedKey("");
    setDraft((d) => chooseCountry(d, countryId, onlyBusinessId));
  }

  function pickMode(mode: ShipMode) {
    setServerErrors([]);
    setQuotes([]);
    setQuotedKey("");
    setDraft((d) => chooseMode(d, mode, onlyBusinessId));
  }

  function go(next: Step) {
    setTried("");
    setError("");
    setStep(next);
  }

  function continueFromWhere() {
    if (!draft.countryId || modeOpts.length === 0) {
      setTried("where");
      return;
    }
    go("items");
  }

  function continueFromItems() {
    if (itemErrors.length > 0) {
      setTried("items");
      return;
    }
    // Only one way in: answer the question for them.
    const only: Handoff | "" = canBring && !canCollect ? "bring_in" : canCollect && !canBring ? "collect" : "";
    if (only && draft.handoff !== only) setDraft((d) => chooseHandoff(d, only, onlyBusinessId));
    go("handoff");
  }

  async function continueFromHandoff() {
    if (handoffErrors.length > 0) {
      setTried("handoff");
      return;
    }
    setError("");
    if (draft.handoff === "collect" && quotedKey !== addressKey) {
      setQuoting(true);
      setQuoteError("");
      try {
        const results = await Promise.all(pickupQuotePayloads(draft.pickupAddress, options, draft.countryId, draft.shipMode)
          .map(function quote(payload) { return call<{ quotes: PickupQuote[] }>("listPackageRequestOptions", payload); }));
        setQuotes(results.flatMap((result) => (Array.isArray(result.quotes) ? result.quotes : [])));
        setQuotedKey(addressKey);
      } catch (err) {
        setQuoteError(requestFailure(err).message);
        return;
      } finally {
        setQuoting(false);
      }
    }
    go(viaBusiness ? "when" : "compare");
  }

  function continueFromCompare() {
    if (!chosen) {
      setError(CHOOSE_BUSINESS);
      return;
    }
    go("when");
  }

  function continueFromWhen() {
    if (whenErrors.length > 0) {
      setTried("when");
      return;
    }
    go("people");
  }

  function addPhotos(line: Extract<BasketLine, { type: "other" | "box" }>, files: FileList | null) {
    if (!files) return;
    const room = (line.type === "box" ? BOX_PHOTO_LIMIT : REQUEST_LIMITS.photosPerPiece) - line.photos.length;
    const added = Array.from(files).slice(0, Math.max(0, room)).map((file) => {
      const key = `${line.key}-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      photoFiles.current[key] = file;
      return { key, path: "", previewUrl: URL.createObjectURL(file), status: "ready" as const };
    });
    updateLine(line.key, (current) => (current.type === "other" || current.type === "box" ? { ...current, photos: [...current.photos, ...added] } : current));
  }

  function removePhoto(lineKey: string, photoKey: string) {
    updateLine(lineKey, (row) => (row.type === "other" || row.type === "box" ? { ...row, photos: row.photos.filter((p) => p.key !== photoKey) } : row));
  }

  /** Uploads the photos not yet in the chosen business's folder; the lines, with their paths. */
  async function uploadPhotos(lines: BasketLine[], businessId: string): Promise<{ lines: BasketLine[]; failed: boolean }> {
    let next = lines;
    let failed = false;
    for (const line of lines) {
      if (line.type !== "other" && line.type !== "box") continue;
      for (const photo of line.photos) {
        if (photo.status !== "ready" || (photo.path && uploadedFor.current[photo.key] === businessId)) continue;
        const file = photoFiles.current[photo.key];
        let outcome: { path: string; status: "ready" | "error" } = { path: "", status: "error" };
        if (file) {
          try {
            outcome = { path: await uploadRequestPhoto(businessId, file), status: "ready" };
            uploadedFor.current[photo.key] = businessId;
          } catch {
            failed = true;
          }
        } else {
          failed = true;
        }
        next = next.map((row) =>
          row.key === line.key && (row.type === "other" || row.type === "box")
            ? { ...row, photos: row.photos.map((p) => (p.key === photo.key ? { ...p, ...outcome } : p)) }
            : row,
        );
      }
    }
    return { lines: next, failed };
  }

  async function send() {
    if (!option || !chosen) return;
    if (peopleErrors.length > 0 || whenErrors.length > 0 || itemErrors.length > 0) {
      setTried("people");
      if (whenErrors.length > 0) setStep("when");
      return;
    }
    setSending(true);
    setError("");
    try {
      await ensureRequestSession();
      let lines = draft.lines;
      if (lines.some((line) => (line.type === "other" || line.type === "box") && line.photos.length > 0)) {
        setUploadingPhotos(true);
        const uploaded = await uploadPhotos(lines, option.businessId);
        setUploadingPhotos(false);
        lines = uploaded.lines;
        setDraft((d) => ({ ...d, lines }));
        if (uploaded.failed) {
          setServerErrors(["photo_invalid"]);
          setError(REQUEST_ERROR_MESSAGES.photo_invalid);
          setStep("items");
          return;
        }
      }
      const result = await call<SentRequest>(
        "submitPackageRequest",
        submitPayload({ ...draft, lines }, option, { lang, idempotencyKey: idempotencyKey.current, viaBusiness }),
      );
      setSent({
        result,
        handoff: draft.handoff === "collect" ? "collect" : "bring_in",
        businessName: option.businessName,
        when: draft.handoff === "collect" ? whenText(draft.pickupDate, draft.pickupWindow, lang) : whenText(draft.plannedDate, draft.plannedWindow, lang),
        place: draft.handoff === "collect" ? draft.pickupAddress.trim() : location?.address ?? "",
        weighs: chosen.weighsAtCounter,
      });
      setStep("sent");
    } catch (err) {
      const failure = requestFailure(err);
      setServerErrors(failure.reasons);
      setError(failure.message);
      const back = failure.reasons.map((r) => REQUEST_ERROR_STEP[r]).find(Boolean);
      if (back && back !== "people") setStep(back);
    } finally {
      setUploadingPhotos(false);
      setSending(false);
    }
  }

  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="customer-service-loading" role="status">
        <span className="loading-spinner" />
        Loading businesses...
      </div>
    );
  }

  if (loadError) {
    return (
      <section className="pkr-card pkr-notice" role="alert">
        <p>{loadError}</p>
        <button className="secondary-button" onClick={() => setReload((n) => n + 1)} type="button">
          <RefreshCw size={16} aria-hidden="true" /> Retry
        </button>
      </section>
    );
  }

  const header = business || option ? (
    <header className="pkr-business">
      <span className="pkr-business-badge" aria-hidden="true"><Store size={20} /></span>
      <div>
        <strong data-no-translate>{option?.businessName ?? business?.name}</strong>
        {draft.countryId && modeOpts[0] && <small data-no-translate>{countryName(modeOpts[0].country, lang)}</small>}
      </div>
    </header>
  ) : null;

  if (step === "sent" && sent) {
    const view = sentView(
      {
        status: sent.result.status,
        handoff: sent.handoff,
        businessName: sent.businessName,
        when: sent.when,
        place: sent.place,
        totalCents: sent.result.totalCents,
        weighs: sent.weighs,
      },
      lang,
    );
    const confirmed = sent.result.status === "confirmed";
    return (
      <section className="pkr-card pkr-sent" ref={cardRef}>
        <CheckCircle2 aria-hidden="true" className="pkr-sent-icon" size={40} />
        <h2>Request sent</h2>
        <p className="pkr-sent-title" data-no-translate>{view.title}</p>
        {view.plan && <p className="pkr-hint" data-no-translate>{view.plan}</p>}
        {view.totalLine && <p className="pkr-sent-total" data-no-translate>{view.totalLine}</p>}
        <p className="pkr-hint" data-no-translate>{view.payNote}</p>
        <p className="pkr-code"><span>Your request code</span> <strong data-no-translate>{sent.result.code}</strong></p>
        <h3>What happens next</h3>
        <ol className="pkr-steps">
          {!confirmed && (
            <li>
              <strong>The business sends you the price</strong>
              <span>You get it on WhatsApp, with a link to confirm it.</span>
            </li>
          )}
          <li>
            <strong>{sent.handoff === "collect" ? "The business picks it up" : "You bring it in"}</strong>
            <span>You get a tracking code once the business has your goods.</span>
          </li>
        </ol>
        <a className="primary-button" href={`/e/${sent.result.token}`}>See your request</a>
      </section>
    );
  }

  if (step === "where") {
    const showWhereError = tried === "where" && (!draft.countryId || modeOpts.length === 0);
    const notTaking = business && (!business.acceptRequests || options.length === 0);
    return (
      <section className="pkr-card" ref={cardRef}>
        <h2>Send a package</h2>
        <p className="pkr-lede">See the price from each business that ships there, pick one, and say when you will bring it. Nothing is paid now.</p>
        {header}
        {notTaking ? (
          <p className="pkr-notice" role="status">This business is not taking requests right now.</p>
        ) : options.length === 0 ? (
          <p className="pkr-notice" role="status">No business is taking requests right now. Please check again soon.</p>
        ) : (
          <>
            <label className="pkr-field">
              <span>Where is it going?</span>
              <select onChange={(event) => pickCountry(event.target.value)} value={draft.countryId}>
                <option value="">Choose a country</option>
                {countries.map((country) => (
                  <option key={country.id} value={country.id}>{country.name}</option>
                ))}
              </select>
            </label>
            {draft.countryId && airOk && (
              <fieldset className="pkr-segments">
                <legend>How should it travel?</legend>
                {SHIP_MODES.map((mode) => (
                  <label className={draft.shipMode === mode ? "active" : ""} key={mode}>
                    <input checked={draft.shipMode === mode} name="pkr-mode" onChange={() => pickMode(mode)} type="radio" />
                    {mode === "air" ? <Plane aria-hidden="true" size={14} /> : <Ship aria-hidden="true" size={14} />}
                    <span>{mode === "air" ? "Air" : "Sea"}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {showWhereError && <p className="customer-field-error" role="alert">Choose a country.</p>}
            {errorFor("where") && <p className="customer-field-error" role="alert">{errorFor("where")}</p>}
            <div className="pkr-actions">
              <button className="primary-button" onClick={continueFromWhere} type="button">Continue</button>
            </div>
          </>
        )}
      </section>
    );
  }

  if (modeOpts.length === 0) {
    // The business stopped offering this destination while the form was open.
    return (
      <section className="pkr-card pkr-notice" role="alert">
        <p>{REQUEST_ERROR_MESSAGES.destination_unavailable}</p>
        <button className="secondary-button" onClick={() => go("where")} type="button">Back</button>
      </section>
    );
  }

  if (step === "items") {
    const count = pieceCount(draft.lines);
    const weightLines = draft.lines.filter((line): line is Extract<BasketLine, { type: "weight" }> => line.type === "weight");
    const otherLines = draft.lines.filter((line): line is Extract<BasketLine, { type: "other" }> => line.type === "other");
    const boxLines = draft.lines.filter((line): line is BoxLine => line.type === "box");
    const sea = draft.shipMode === "sea";
    // One business (its own link): its prices. Several: the lowest per size, "from $X".
    const boxComparing = modeOpts.length > 1;
    const boxPrices = sea ? (boxComparing ? lowestBoxPrices(modeOpts.map((o) => o.routes?.sea)) : boxPricesOf(modeOpts[0]?.routes?.sea)) : null;
    return (
      <section className="pkr-card" ref={cardRef}>
        <button className="text-button pkr-back" onClick={() => go("where")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        {header}
        <h2>What are you sending?</h2>
        <p className="pkr-lede">Add each thing you will hand over. You see every business&apos;s price for them next.</p>

        {(catalog.barrel || catalog.items.length > 0) && (
          <div className="pkr-catalog">
            {catalog.barrel && (
              <div className="pkr-item">
                <span className="pkr-item-name">
                  <strong>Barrel</strong>
                  <small>At each business&apos;s barrel price</small>
                </span>
                <QuantityStepper
                  label="Barrel"
                  onChange={(n) => setLines((lines) => setBarrelQuantity(lines, n))}
                  value={barrelQuantity(draft.lines)}
                />
              </div>
            )}
            {catalog.items.map((entry) => {
              const limit = includedLbText(entry, lang, weightUnit);
              return (
                <div className="pkr-item" key={entry.key}>
                  <span className="pkr-item-name">
                    <strong data-no-translate>{entry.label}</strong>
                    <small data-no-translate>{[categoryLabel(entry.categoryId, lang), limit].filter(Boolean).join(" · ")}</small>
                  </span>
                  <QuantityStepper
                    label={entry.label}
                    onChange={(n) => setLines((lines) => setItemQuantity(lines, entry, n))}
                    value={itemQuantity(draft.lines, entry.key)}
                  />
                </div>
              );
            })}
          </div>
        )}

        {sea && (
          <div className="pkr-group">
            <h3>Boxes</h3>
            <p className="pkr-hint">Priced by size, not weight. Staff confirm the size when you drop it off.</p>
            {boxLines.map((line) => (
              <BoxLineCard
                comparing={boxComparing}
                disabled={sending}
                key={line.key}
                lang={lang}
                line={line}
                onAddPhotos={(files) => addPhotos(line, files)}
                onChange={(next) => updateLine(line.key, () => next)}
                onRemove={() => setLines((lines) => lines.filter((row) => row.key !== line.key))}
                onRemovePhoto={(photoKey) => removePhoto(line.key, photoKey)}
                prices={boxPrices}
              />
            ))}
            <button className="secondary-button pkr-add" disabled={sending} onClick={() => setLines((lines) => addBoxLine(lines))} type="button">
              <Plus size={16} aria-hidden="true" /> Add a box
            </button>
          </div>
        )}

        {catalog.categories.length > 0 && (
          <div className="pkr-group">
            <h3>{weightUnit === "kg" ? "Priced by the kilo" : "Priced by the pound"}</h3>
            <div className="pkr-catalog">
              {catalog.categories.map((categoryId) => (
                <div className="pkr-item" key={categoryId}>
                  <span className="pkr-item-name">
                    <strong data-no-translate>{categoryLabel(categoryId, lang)}</strong>
                    <small>Weighed at drop-off</small>
                  </span>
                  <button className="secondary-button" onClick={() => setLines((lines) => addWeightLine(lines, categoryId, weightUnit))} type="button">
                    <Plus size={16} aria-hidden="true" /> Add
                  </button>
                </div>
              ))}
            </div>
            {weightLines.map((line) => (
              <article className="pkr-piece" key={line.key}>
                <header>
                  <span className="pkr-item-name">
                    <strong data-no-translate>{categoryLabel(line.categoryId, lang)}</strong>
                    <small>{weightUnit === "kg" ? "Priced by the kilo" : "Priced by the pound"}</small>
                  </span>
                  <button aria-label="Remove this piece" className="icon-button" onClick={() => setLines((lines) => lines.filter((row) => row.key !== line.key))} type="button">
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </header>
                <fieldset className="pkr-segments">
                  <legend>Size</legend>
                  {SIZE_PRESETS.map((preset) => (
                    <label className={line.sizePreset === preset.id ? "active" : ""} key={preset.id}>
                      <input checked={line.sizePreset === preset.id} name={`pkr-size-${line.key}`} onChange={() => updateLine(line.key, (row) => (row.type === "weight" ? applySizePreset(row, preset.id) : row))} type="radio" />
                      <span data-no-translate>{lang === "fr" ? preset.fr : preset.en} · {lang === "fr" ? String(preset[line.weightUnit]).replace(".", ",") : preset[line.weightUnit]} {line.weightUnit}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="pkr-segments">
                  <legend>Weight unit</legend>
                  {(["lb", "kg"] as const).map((unit) => (
                    <label className={line.weightUnit === unit ? "active" : ""} key={unit}>
                      <input checked={line.weightUnit === unit} name={`pkr-unit-${line.key}`} onChange={() => updateLine(line.key, (row) => (row.type === "weight" ? setWeightUnit(row, unit) : row))} type="radio" />
                      <span>{unit === "kg" ? "Kilos (kg)" : "Pounds (lb)"}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="pkr-field">
                  <span>{line.weightUnit === "kg" ? "Weight in kilos" : "Weight in pounds"}</span>
                  <input inputMode="decimal" maxLength={7} onChange={(event) => updateLine(line.key, (row) => (row.type === "weight" ? typeWeight(row, event.target.value) : row))} value={line.weightLb} />
                </label>
              </article>
            ))}
          </div>
        )}

        <div className="pkr-group">
          <h3>Something else</h3>
          <p className="pkr-hint">Anything not listed. The business sends you its price on WhatsApp.</p>
          {otherLines.map((line) => (
            <article className="pkr-piece" key={line.key}>
              <header>
                <strong>Something else</strong>
                <button aria-label="Remove this piece" className="icon-button" disabled={sending} onClick={() => setLines((lines) => lines.filter((row) => row.key !== line.key))} type="button">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </header>
              {!sea && (
              <div className="pkr-segments" role="radiogroup" aria-label="What is it?">
                {(["box", "other"] as const).map((kind) => (
                  <label className={line.kind === kind ? "active" : ""} key={kind}>
                    <input checked={line.kind === kind} name={`pkr-kind-${line.key}`} onChange={() => updateLine(line.key, (row) => (row.type === "other" ? { ...row, kind } : row))} type="radio" />
                    <Box size={14} aria-hidden="true" />
                    <span data-no-translate>{pieceKindLabel(kind, lang)}</span>
                  </label>
                ))}
              </div>
              )}
              <label className="pkr-field">
                <span>What is it?</span>
                <input maxLength={REQUEST_LIMITS.description} onChange={(event) => updateLine(line.key, (row) => (row.type === "other" ? { ...row, description: event.target.value } : row))} placeholder="e.g. clothes, a TV, a generator" value={line.description} />
              </label>
              <RequestPhotoStrip
                disabled={sending}
                hint="Optional, up to 5 photos. Only the business sees them."
                limit={REQUEST_LIMITS.photosPerPiece}
                onAdd={(files) => addPhotos(line, files)}
                onRemove={(photoKey) => removePhoto(line.key, photoKey)}
                photos={line.photos}
              />
            </article>
          ))}
          <button className="secondary-button pkr-add" disabled={sending} onClick={() => setLines((lines) => addOtherLine(lines, sea ? "other" : "box"))} type="button">
            <Plus size={16} aria-hidden="true" /> Add something else
          </button>
        </div>

        <FieldError codes={shownItems} show={["pieces_required", "too_many_pieces", "weight_invalid", "weight_kg_invalid", "unit_invalid", "quantity_invalid", "piece_description_required", "too_many_photos", "photo_invalid", "text_too_long", "category_invalid", "box_size_invalid", "dims_invalid"]} />
        {count > 0 && <p className="pkr-hint" data-no-translate>{piecesCountText(count, lang)}</p>}
        {error && <p className="customer-field-error" role="alert">{error}</p>}
        <div className="pkr-actions">
          <button className="primary-button" onClick={continueFromItems} type="button">Continue</button>
        </div>
      </section>
    );
  }

  if (step === "handoff") {
    return (
      <section className="pkr-card" ref={cardRef}>
        <button className="text-button pkr-back" disabled={quoting} onClick={() => go("items")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        {header}
        <fieldset className="pkr-handoff">
          <legend>How will the business get it?</legend>
          {canBring && (
            <label className={`pkr-handoff-card ${draft.handoff === "bring_in" ? "active" : ""}`}>
              <input checked={draft.handoff === "bring_in"} name="pkr-handoff" onChange={() => { setQuoteError(""); setDraft((d) => chooseHandoff(d, "bring_in", onlyBusinessId)); }} type="radio" />
              <Store aria-hidden="true" size={22} />
              <strong>Bring it in</strong>
              <small>I drop it off at the business</small>
            </label>
          )}
          {canCollect && (
            <label className={`pkr-handoff-card ${draft.handoff === "collect" ? "active" : ""}`}>
              <input checked={draft.handoff === "collect"} name="pkr-handoff" onChange={() => { setQuoteError(""); setDraft((d) => chooseHandoff(d, "collect", onlyBusinessId)); }} type="radio" />
              <Truck aria-hidden="true" size={22} />
              <strong>Collect from me</strong>
              <small>The business picks it up</small>
            </label>
          )}
        </fieldset>
        <FieldError codes={shownHandoff} show={["handoff_invalid"]} />
        {draft.handoff === "collect" && (
          <div className="pkr-group">
            {viaBusiness && modeOpts[0]?.collect.areas && (
              <p className="pkr-hint"><span>Areas covered:</span> <span data-no-translate>{modeOpts[0].collect.areas}</span></p>
            )}
            <label className="pkr-field">
              <span>Pickup address</span>
              <input autoComplete="street-address" maxLength={REQUEST_LIMITS.address} onChange={(event) => { setQuoteError(""); update({ pickupAddress: event.target.value }); }} value={draft.pickupAddress} />
              <FieldError codes={shownHandoff} show={["pickup_address_required", "text_too_long"]} />
            </label>
            <p className="pkr-hint">The pickup fee depends on the address. You see each business&apos;s fee next.</p>
          </div>
        )}
        {quoteError && <p className="customer-field-error" role="alert">{quoteError}</p>}
        {!quoteError && errorFor("handoff") && <p className="customer-field-error" role="alert">{errorFor("handoff")}</p>}
        <div className="pkr-actions">
          <button className="primary-button" data-loading={quoting} disabled={quoting} onClick={() => void continueFromHandoff()} type="button">
            {quoting ? "Getting pickup prices..." : "Continue"}
          </button>
        </div>
      </section>
    );
  }

  if (step === "compare") {
    const none = rows.length === 0;
    const filtered = shown.shown.length === 0 && shown.blocked.length === 0;
    const filtering = filters.picksUp || filters.coversLoss || filters.rated;
    const filterDefs: { key: keyof RowFilters; label: string; hidden?: boolean }[] = [
      { key: "picksUp", label: "Picks up", hidden: draft.handoff === "collect" },
      { key: "coversLoss", label: "Pays back if lost" },
      { key: "rated", label: "Has a rating" },
    ];
    const renderRow = (row: CompareRow) => {
      const rating = ratingText(row.rating, row.reviewCount);
      const departure = departureText(row.departure, draft.shipMode, lang);
      const selected = draft.businessId === row.businessId;
      return (
        <label className={`pkr-compare-row ${selected ? "active" : ""} ${row.blocked ? "blocked" : ""}`} key={row.businessId}>
          <input checked={selected} disabled={row.blocked} name="pkr-business" onChange={() => update({ businessId: row.businessId, locationId: "", plannedDate: "", plannedWindow: "" })} type="radio" />
          <span className="pkr-compare-logo" aria-hidden="true">
            {row.option.profileImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="" src={row.option.profileImageUrl} />
            ) : (
              <Store size={18} />
            )}
          </span>
          <span className="pkr-compare-body">
            <strong data-no-translate>{row.businessName}</strong>
            {rating && <small data-no-translate>{rating}</small>}
            {departure && <small data-no-translate>{departure}</small>}
            <span className="pkr-tags">
              {row.coversLoss && <span className="pkr-tag">Pays back if lost</span>}
              {row.picksUp && draft.handoff === "bring_in" && <span className="pkr-tag">Picks up</span>}
            </span>
          </span>
          <span className="pkr-compare-total">
            {row.blocked ? (
              <small>Doesn&apos;t pick up there</small>
            ) : (
              <>
                <strong data-no-translate>{totalText(row, lang)}</strong>
                {draft.handoff === "collect" && (
                  <small><span>Pickup fee</span> <span data-no-translate>{pickupFeeText(row, lang)}</span></small>
                )}
              </>
            )}
          </span>
        </label>
      );
    };
    return (
      <section className="pkr-card" ref={cardRef}>
        <button className="text-button pkr-back" onClick={() => go("handoff")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        <h2>Compare businesses</h2>
        {none ? (
          <p className="pkr-notice" role="status">No business takes it that way. Go back and change how it gets there.</p>
        ) : (
          <>
            <p className="pkr-lede" data-no-translate>{businessesCountText(rows.length, lang)}</p>
            <div className="pkr-compare-tools">
              <label className="pkr-field">
                <span>Sort by</span>
                <select onChange={(event) => setSort(event.target.value as SortKey)} value={sort}>
                  {SORT_KEYS.map((key) => (
                    <option key={key} value={key}>{SORT_LABELS[key]}</option>
                  ))}
                </select>
              </label>
              <fieldset className="pkr-segments">
                <legend>Show only</legend>
                {filterDefs.filter((def) => !def.hidden).map((def) => (
                  <label className={filters[def.key] ? "active" : ""} key={def.key}>
                    <input checked={filters[def.key]} onChange={(event) => setFilters((f) => ({ ...f, [def.key]: event.target.checked }))} type="checkbox" />
                    <span>{def.label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <div className="pkr-compare" role="radiogroup" aria-label="Businesses">
              {shown.shown.map(renderRow)}
              {shown.blocked.map(renderRow)}
            </div>
            {filtered && filtering && (
              <p className="pkr-notice" role="status">
                No business matches these filters.{" "}
                <button className="text-button" onClick={() => setFilters(NO_FILTERS)} type="button">Clear filters</button>
              </p>
            )}
            <p className="pkr-hint">These are today&apos;s prices. Items that are weighed get their final price at the counter.</p>
            {chosen?.option.cardBarrelBooking && onPayByCard && allBarrels && (
              <button className="text-button pkr-card-pay" onClick={() => onPayByCard(chosen.option)} type="button">
                <CreditCard aria-hidden="true" size={16} /> Pay barrels now by card
              </button>
            )}
          </>
        )}
        {error && <p className="customer-field-error" role="alert">{error}</p>}
        {!none && (
          <div className="pkr-actions">
            <button className="primary-button" onClick={continueFromCompare} type="button">Continue</button>
          </div>
        )}
      </section>
    );
  }

  if (!option || !chosen) {
    // The chosen business no longer fits (its prices or hours changed).
    return (
      <section className="pkr-card pkr-notice" role="alert">
        <p>{CHOOSE_BUSINESS}</p>
        <button className="secondary-button" onClick={() => go(viaBusiness ? "handoff" : "compare")} type="button">Back</button>
      </section>
    );
  }

  const summary = (
    <div className="pkr-summary">
      <p><span>Total</span> <strong data-no-translate>{totalText(chosen, lang)}</strong></p>
      {handoff === "collect" && chosen.pickupFeeCents !== null && (
        <p className="pkr-hint"><span>Includes a pickup fee of</span> <span data-no-translate>{pickupFeeText(chosen, lang)}</span></p>
      )}
      {chosen.piecesToQuote > 0 && <p className="pkr-hint">The business will send you the price for the items to quote on WhatsApp.</p>}
    </div>
  );

  if (step === "when") {
    const spots = option.bringIn.locations;
    const emptyToday = dateKey && windows.length === 0;
    const days = handoff === "collect" ? pickupDays : bringDays;
    return (
      <section className="pkr-card" ref={cardRef}>
        <button className="text-button pkr-back" onClick={() => go(viaBusiness ? "handoff" : "compare")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        {header}
        {summary}
        <h2>{handoff === "collect" ? "When should they come?" : "When will you bring it?"}</h2>
        {handoff === "bring_in" && (
          <div className="pkr-group">
            {spots.length > 1 && (
              <label className="pkr-field">
                <span>Drop-off location</span>
                <select onChange={(event) => update({ locationId: event.target.value, plannedDate: "", plannedWindow: "" })} value={draft.locationId}>
                  <option value="">Choose a location</option>
                  {spots.map((spot) => (
                    <option data-no-translate key={spot.id} value={spot.id}>{spot.label}</option>
                  ))}
                </select>
                <FieldError codes={shownWhen} show={["location_invalid"]} />
              </label>
            )}
            {location && (
              <div className="pkr-place">
                <MapPin aria-hidden="true" size={18} />
                <div>
                  <strong data-no-translate>{location.label}</strong>
                  <span data-no-translate>{location.address}</span>
                  <span className="pkr-hours" data-no-translate>{hoursLines(location.hours, lang).join(" · ")}</span>
                </div>
              </div>
            )}
          </div>
        )}
        {handoff === "collect" && (
          <div className="pkr-place">
            <Truck aria-hidden="true" size={18} />
            <div>
              <small>Pickup address</small>
              <span data-no-translate>{draft.pickupAddress.trim()}</span>
            </div>
          </div>
        )}
        {(handoff === "collect" || location) && (
          <div className="pkr-group">
            <label className="pkr-field">
              <span>Day</span>
              <select
                onChange={(event) => update(handoff === "collect" ? { pickupDate: event.target.value, pickupWindow: "" } : { plannedDate: event.target.value, plannedWindow: "" })}
                value={dateKey}
              >
                <option value="">Choose a day</option>
                {days.map((day) => (
                  <option data-no-translate disabled={!day.open} key={day.key} value={day.key}>{day.label}</option>
                ))}
              </select>
              <FieldError codes={shownWhen} show={["planned_date_invalid", "planned_day_closed", "pickup_date_invalid"]} />
            </label>
            {dateKey && (
              <fieldset className="pkr-segments">
                <legend>Time window</legend>
                {windows.map((slot) => {
                  const value = handoff === "collect" ? draft.pickupWindow : draft.plannedWindow;
                  return (
                    <label className={value === slot.value ? "active" : ""} key={slot.value}>
                      <input
                        checked={value === slot.value}
                        name="pkr-window"
                        onChange={() => update(handoff === "collect" ? { pickupWindow: slot.value } : { plannedWindow: slot.value })}
                        type="radio"
                      />
                      <span data-no-translate>{windowText(slot.value, lang)}</span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {emptyToday && <p className="pkr-hint" role="status">No time left that day. Pick another day.</p>}
            <FieldError codes={shownWhen} show={["window_invalid", "pickup_window_invalid"]} />
            {handoff === "collect" && (
              <label className="pkr-field">
                <span>Note for the driver (optional)</span>
                <input maxLength={REQUEST_LIMITS.note} onChange={(event) => update({ pickupNote: event.target.value })} value={draft.pickupNote} />
              </label>
            )}
            <p className="pkr-hint">
              {handoff === "collect"
                ? "You pay when the business collects. The final price is set then, once items are weighed."
                : "You pay at drop-off. The final price is set at the counter, once items are weighed."}
            </p>
          </div>
        )}
        {error && <p className="customer-field-error" role="alert">{error}</p>}
        <div className="pkr-actions">
          <button className="primary-button" onClick={continueFromWhen} type="button">Continue</button>
        </div>
      </section>
    );
  }

  // step === "people"
  return (
    <section className="pkr-card" ref={cardRef}>
      <button className="text-button pkr-back" disabled={sending} onClick={() => go("when")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
      {header}
      {summary}
      <p className="pkr-hint" data-no-translate>
        {handoff === "collect"
          ? whenText(draft.pickupDate, draft.pickupWindow, lang)
          : whenText(draft.plannedDate, draft.plannedWindow, lang)}
      </p>
      <div className="pkr-group">
        <h3>Who is sending it?</h3>
        <label className="pkr-field">
          <span>Your name</span>
          <input autoComplete="name" maxLength={REQUEST_LIMITS.name} onChange={(event) => update({ senderName: event.target.value })} value={draft.senderName} />
          <FieldError codes={shownPeople} show={["sender_name_required"]} />
        </label>
        <CustomerPhoneField
          error={shownPeople.includes("sender_phone_invalid") ? REQUEST_ERROR_MESSAGES.sender_phone_invalid : undefined}
          id="pkr-sender-phone"
          initialCountryCode="US"
          label="Your WhatsApp number"
          onChange={(value) => update({ senderPhone: value })}
          value={draft.senderPhone}
        />
      </div>
      <div className="pkr-group">
        <h3>Who receives it?</h3>
        <label className="pkr-field">
          <span>Receiver&apos;s name</span>
          <input maxLength={REQUEST_LIMITS.name} onChange={(event) => update({ receiverName: event.target.value })} value={draft.receiverName} />
          <FieldError codes={shownPeople} show={["receiver_name_required"]} />
        </label>
        <CustomerPhoneField
          error={shownPeople.includes("receiver_phone_invalid") ? REQUEST_ERROR_MESSAGES.receiver_phone_invalid : undefined}
          id="pkr-receiver-phone"
          initialCountryCode={receiverCountry}
          key={receiverCountry}
          label="Receiver's phone"
          onChange={(value) => update({ receiverPhone: value })}
          value={draft.receiverPhone}
        />
      </div>
      <FieldError codes={shownPeople} show={["text_too_long"]} />
      {error && <p className="customer-field-error" role="alert">{error}</p>}
      <div className="pkr-actions">
        <button className="primary-button" data-loading={sending} disabled={sending} onClick={() => void send()} type="button">
          {uploadingPhotos ? "Uploading photos..." : sending ? "Sending request..." : "Send request"}
        </button>
      </div>
    </section>
  );
}
