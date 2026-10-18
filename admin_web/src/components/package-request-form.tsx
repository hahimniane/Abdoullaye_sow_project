"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Box, Camera, CheckCircle2, CreditCard, MapPin, Plus, RefreshCw, Store, Trash2, Truck, X } from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { functions } from "@/lib/firebase";
import { phoneCountryForDestination } from "@/lib/container-manifest";
import { currentWebLanguage } from "@/lib/language";
import {
  PICKUP_WINDOWS,
  PICKUP_WINDOW_LABELS,
  PIECE_KINDS,
  pieceKindLabel,
  REQUEST_ERROR_MESSAGES,
  REQUEST_ERROR_STEP,
  REQUEST_LIMITS,
  chooseHandoff,
  countryName,
  dayIsOpen,
  detailsProblems,
  draftEstimate,
  emptyRequestDraft,
  hoursLines,
  moneyText,
  newIdempotencyKey,
  newPieceDraft,
  optionsForCountry,
  photosStillUploading,
  pickableDays,
  piecesProblems,
  plannedDayText,
  requestCountries,
  requestFailure,
  selectedLocation,
  selectedOption,
  submitRequestPayload,
  type Handoff,
  type PickupWindow,
  type PieceDraft,
  type PieceKind,
  type RequestBusinessHeader,
  type RequestDraft,
  type RequestOption,
} from "@/lib/package-requests";
import { ensureRequestSession, uploadRequestPhoto } from "@/lib/request-photo";

const LOAD_TIMEOUT_MS = 20_000;

type Step = "where" | "details" | "pieces" | "sent";

type SentRequest = { requestId: string; code: string; token: string; status: string; totalCents: number | null };

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

function FieldError({ codes, show }: { codes: string[]; show: string[] }) {
  const code = show.find((c) => codes.includes(c));
  if (!code) return null;
  return <small className="customer-field-error">{REQUEST_ERROR_MESSAGES[code]}</small>;
}

/**
 * The customer's package request (docs/PACKAGE_REQUESTS.md §2, §8.5): which
 * business (country first), how the goods get there, who sends and who
 * receives, the pieces (with photos), then the code. One language per page,
 * the one the language picker chose; nothing here is bilingual.
 */
export function PackageRequestForm({ slug = "", senderName = "", senderPhone = "", onPayByCard }: PackageRequestFormProps) {
  const lang = currentWebLanguage();
  const [options, setOptions] = useState<RequestOption[]>([]);
  const [business, setBusiness] = useState<RequestBusinessHeader | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState<Step>("where");
  const [draft, setDraft] = useState<RequestDraft>(() => ({ ...emptyRequestDraft(), senderName, senderPhone }));
  const [payByCard, setPayByCard] = useState(false);
  const [tried, setTried] = useState<Step | "">("");
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<SentRequest | null>(null);
  // One key per filled-in form: a double tap or a retry after a timeout is
  // the same request (the server answers the first one again).
  const idempotencyKey = useRef(newIdempotencyKey());
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    call<{ business: RequestBusinessHeader | null; options: RequestOption[] }>("listPackageRequestOptions", slug ? { slug } : {})
      .then((result) => {
        if (!active) return;
        const list = Array.isArray(result.options) ? result.options : [];
        setOptions(list);
        setBusiness(result.business ?? null);
        if (result.business) {
          const countries = [...new Set(list.map((o) => o.country.id))];
          setDraft((d) => ({ ...d, businessId: result.business?.businessId ?? "", countryId: countries.length === 1 ? countries[0] : d.countryId }));
        }
      })
      .catch((err) => {
        if (!active) return;
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

  const countries = useMemo(() => requestCountries(options, lang), [options, lang]);
  const businesses = useMemo(() => optionsForCountry(options, draft.countryId), [options, draft.countryId]);
  const option = selectedOption(options, draft);
  const location = selectedLocation(option, draft);
  const days = pickableDays(option?.timeZone || "America/New_York");
  const detailsErrors = option ? detailsProblems(draft, option) : ["handoff_invalid"];
  const pieceErrors = piecesProblems(draft);
  const estimate = draftEstimate(draft, option);
  const uploading = photosStillUploading(draft);
  const receiverCountry = phoneCountryForDestination(
    { destinationCountryId: draft.countryId, destinationCountryName: option?.country.name ?? "" },
    "US",
  );
  const shownDetails = tried === "details" || tried === "pieces" ? [...detailsErrors, ...serverErrors] : serverErrors;
  const shownPieces = tried === "pieces" ? [...pieceErrors, ...serverErrors] : serverErrors;

  function update(patch: Partial<RequestDraft>) {
    setServerErrors([]);
    setError("");
    setDraft((d) => ({ ...d, ...patch }));
  }

  function updatePiece(key: string, patch: Partial<PieceDraft>) {
    setServerErrors([]);
    setDraft((d) => ({ ...d, pieces: d.pieces.map((p) => (p.key === key ? { ...p, ...patch } : p)) }));
  }

  function setPieceKind(key: string, kind: PieceKind) {
    updatePiece(key, kind === "barrel" ? { kind, photos: [] } : { kind });
  }

  function pickBusiness(businessId: string) {
    setPayByCard(false);
    update({ businessId, handoff: "", locationId: "", plannedDate: "" });
  }

  function pickCountry(countryId: string) {
    setPayByCard(false);
    const next = optionsForCountry(options, countryId);
    update({
      countryId,
      businessId: business ? business.businessId : next.length === 1 ? next[0].businessId : "",
      handoff: "",
      locationId: "",
      plannedDate: "",
    });
  }

  function continueFromWhere() {
    if (!option) {
      setTried("where");
      return;
    }
    if (payByCard && onPayByCard) {
      onPayByCard(option);
      return;
    }
    // Only one way in: answer the question for them.
    const only: Handoff | "" = option.bringIn.available && !option.collect.available ? "bring_in" :
      option.collect.available && !option.bringIn.available ? "collect" : "";
    if (only && draft.handoff !== only) setDraft((d) => chooseHandoff(d, only, option));
    setTried("");
    setStep("details");
  }

  function continueFromDetails() {
    if (detailsErrors.length > 0) {
      setTried("details");
      return;
    }
    setTried("");
    setStep("pieces");
  }

  async function addPhotos(piece: PieceDraft, files: FileList | null) {
    if (!files || !option) return;
    const room = REQUEST_LIMITS.photosPerPiece - piece.photos.length;
    const chosen = Array.from(files).slice(0, Math.max(0, room));
    for (const file of chosen) {
      const key = `${piece.key}-photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      setDraft((d) => ({
        ...d,
        pieces: d.pieces.map((p) => (p.key === piece.key ? { ...p, photos: [...p.photos, { key, path: "", previewUrl, status: "uploading" }] } : p)),
      }));
      try {
        const path = await uploadRequestPhoto(option.businessId, file);
        setDraft((d) => ({
          ...d,
          pieces: d.pieces.map((p) => (p.key === piece.key ? { ...p, photos: p.photos.map((ph) => (ph.key === key ? { ...ph, path, status: "ready" } : ph)) } : p)),
        }));
      } catch {
        setDraft((d) => ({
          ...d,
          pieces: d.pieces.map((p) => (p.key === piece.key ? { ...p, photos: p.photos.map((ph) => (ph.key === key ? { ...ph, status: "error" } : ph)) } : p)),
        }));
      }
    }
  }

  function removePhoto(piece: PieceDraft, key: string) {
    updatePiece(piece.key, { photos: piece.photos.filter((ph) => ph.key !== key) });
  }

  async function send() {
    if (!option) return;
    if (pieceErrors.length > 0 || detailsErrors.length > 0) {
      setTried("pieces");
      if (detailsErrors.length > 0) setStep("details");
      return;
    }
    setSending(true);
    setError("");
    try {
      await ensureRequestSession();
      const result = await call<SentRequest>("submitPackageRequest", submitRequestPayload(draft, option, lang, idempotencyKey.current));
      setSent(result);
      setStep("sent");
    } catch (err) {
      const failure = requestFailure(err);
      setServerErrors(failure.reasons);
      setError(failure.message);
      const back = failure.reasons.map((r) => REQUEST_ERROR_STEP[r]).find(Boolean);
      if (back === "details") setStep("details");
    } finally {
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

  const header = option || business ? (
    <header className="pkr-business">
      <span className="pkr-business-badge" aria-hidden="true"><Store size={20} /></span>
      <div>
        <strong data-no-translate>{option?.businessName ?? business?.name}</strong>
        {option && <small data-no-translate>{countryName(option.country, lang)}</small>}
      </div>
    </header>
  ) : null;

  if (step === "sent" && sent) {
    return (
      <section className="pkr-card pkr-sent">
        <CheckCircle2 aria-hidden="true" className="pkr-sent-icon" size={40} />
        <h2>Request sent</h2>
        <p className="pkr-code"><span>Your request code</span> <strong data-no-translate>{sent.code}</strong></p>
        <h3>What happens next</h3>
        <ol className="pkr-steps">
          <li>
            <strong>{sent.status === "estimate_sent" ? "Your estimate is on its way" : "The business writes your estimate"}</strong>
            <span>You get it on WhatsApp, with a link to confirm it.</span>
          </li>
          <li>
            <strong>You confirm the estimate</strong>
            <span>Nothing is paid now. The final price is set when the business takes your goods.</span>
          </li>
          <li>
            <strong>{draft.handoff === "collect" ? "The business picks it up" : "You bring it in"}</strong>
            <span>You pay at drop-off or when the business collects, and get a tracking code.</span>
          </li>
        </ol>
        {sent.status === "estimate_sent" && (
          <a className="primary-button" href={`/e/${sent.token}`}>See your estimate</a>
        )}
      </section>
    );
  }

  if (step === "where") {
    const showWhereError = tried === "where" && !option;
    const notTaking = business && (!business.acceptRequests || options.length === 0);
    return (
      <section className="pkr-card">
        <h2>Send a package</h2>
        <p className="pkr-lede">Barrels, boxes or anything else. The business sends you an estimate on WhatsApp before you hand anything over.</p>
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
            {draft.countryId && !business && (
              <fieldset className="pkr-choices">
                <legend>Choose a business</legend>
                {businesses.map((item) => (
                  <label className={`pkr-choice ${draft.businessId === item.businessId ? "active" : ""}`} key={item.businessId}>
                    <input checked={draft.businessId === item.businessId} name="pkr-business" onChange={() => pickBusiness(item.businessId)} type="radio" />
                    <span className="pkr-choice-body">
                      <strong data-no-translate>{item.businessName}</strong>
                      <small>
                        {item.barrelPriceCents ? (
                          <><span>Barrel</span> <span data-no-translate>{moneyText(item.barrelPriceCents, lang)}</span></>
                        ) : (
                          <span>Barrel price on estimate</span>
                        )}
                      </small>
                      <span className="pkr-tags">
                        {item.bringIn.available && <span className="pkr-tag">Drop-off</span>}
                        {item.collect.available && <span className="pkr-tag">Pickup</span>}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {option?.cardBarrelBooking && onPayByCard && (
              <fieldset className="pkr-choices">
                <legend>How would you like to pay?</legend>
                <label className={`pkr-choice ${!payByCard ? "active" : ""}`}>
                  <input checked={!payByCard} name="pkr-pay" onChange={() => setPayByCard(false)} type="radio" />
                  <span className="pkr-choice-body">
                    <strong>Pay at drop-off or pickup</strong>
                    <small>Any goods. The business sends you an estimate first.</small>
                  </span>
                </label>
                <label className={`pkr-choice ${payByCard ? "active" : ""}`}>
                  <input checked={payByCard} name="pkr-pay" onChange={() => setPayByCard(true)} type="radio" />
                  <span className="pkr-choice-body">
                    <strong><CreditCard aria-hidden="true" size={16} /> Pay barrels now by card</strong>
                    <small>Barrels only, at the business&apos;s price.</small>
                  </span>
                </label>
              </fieldset>
            )}
            {showWhereError && <p className="customer-field-error" role="alert">Choose a country and a business.</p>}
            <div className="pkr-actions">
              <button className="primary-button" onClick={continueFromWhere} type="button">Continue</button>
            </div>
          </>
        )}
      </section>
    );
  }

  if (!option) {
    // The business stopped offering this destination while the form was open.
    return (
      <section className="pkr-card pkr-notice" role="alert">
        <p>{REQUEST_ERROR_MESSAGES.destination_unavailable}</p>
        <button className="secondary-button" onClick={() => setStep("where")} type="button">Back</button>
      </section>
    );
  }

  if (step === "details") {
    const spots = option.bringIn.locations;
    const closedDay = draft.handoff === "bring_in" && location && draft.plannedDate && !dayIsOpen(location.hours, draft.plannedDate);
    return (
      <section className="pkr-card">
        <button className="text-button pkr-back" onClick={() => setStep("where")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
        {header}
        <fieldset className="pkr-handoff">
          <legend>How will the business get it?</legend>
          {option.bringIn.available && (
            <label className={`pkr-handoff-card ${draft.handoff === "bring_in" ? "active" : ""}`}>
              <input checked={draft.handoff === "bring_in"} name="pkr-handoff" onChange={() => setDraft((d) => chooseHandoff(d, "bring_in", option))} type="radio" />
              <Store aria-hidden="true" size={22} />
              <strong>Bring it in</strong>
              <small>I drop it off at the business</small>
            </label>
          )}
          {option.collect.available && (
            <label className={`pkr-handoff-card ${draft.handoff === "collect" ? "active" : ""}`}>
              <input checked={draft.handoff === "collect"} name="pkr-handoff" onChange={() => setDraft((d) => chooseHandoff(d, "collect", option))} type="radio" />
              <Truck aria-hidden="true" size={22} />
              <strong>Collect from me</strong>
              <small>The business picks it up</small>
            </label>
          )}
        </fieldset>
        <FieldError codes={shownDetails} show={["handoff_invalid"]} />

        {draft.handoff === "bring_in" && (
          <div className="pkr-group">
            {spots.length > 1 && (
              <label className="pkr-field">
                <span>Drop-off location</span>
                <select onChange={(event) => update({ locationId: event.target.value })} value={draft.locationId}>
                  <option value="">Choose a location</option>
                  {spots.map((spot) => (
                    <option data-no-translate key={spot.id} value={spot.id}>{spot.label}</option>
                  ))}
                </select>
                <FieldError codes={shownDetails} show={["location_invalid"]} />
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
            <label className="pkr-field">
              <span>When do you plan to come?</span>
              <input max={days.max} min={days.min} onChange={(event) => update({ plannedDate: event.target.value })} type="date" value={draft.plannedDate} />
              {draft.plannedDate && !closedDay && <small data-no-translate>{plannedDayText(draft.plannedDate, lang)}</small>}
              <small className="pkr-hint">A plan, not an appointment: come any time during opening hours.</small>
              <FieldError codes={shownDetails} show={["planned_date_invalid", "planned_day_closed"]} />
              {closedDay && !shownDetails.includes("planned_day_closed") && <small className="customer-field-error">{REQUEST_ERROR_MESSAGES.planned_day_closed}</small>}
            </label>
          </div>
        )}

        {draft.handoff === "collect" && (
          <div className="pkr-group">
            {option.collect.areas && (
              <p className="pkr-hint"><span>Areas covered:</span> <span data-no-translate>{option.collect.areas}</span></p>
            )}
            <label className="pkr-field">
              <span>Pickup address</span>
              <input autoComplete="street-address" maxLength={REQUEST_LIMITS.address} onChange={(event) => update({ pickupAddress: event.target.value })} value={draft.pickupAddress} />
              <FieldError codes={shownDetails} show={["pickup_address_required"]} />
            </label>
            <label className="pkr-field">
              <span>Preferred day</span>
              <input max={days.max} min={days.min} onChange={(event) => update({ pickupDate: event.target.value })} type="date" value={draft.pickupDate} />
              {draft.pickupDate && <small data-no-translate>{plannedDayText(draft.pickupDate, lang)}</small>}
              <FieldError codes={shownDetails} show={["pickup_date_invalid"]} />
            </label>
            <fieldset className="pkr-segments">
              <legend>Time of day</legend>
              {PICKUP_WINDOWS.map((window) => (
                <label className={draft.pickupWindow === window ? "active" : ""} key={window}>
                  <input checked={draft.pickupWindow === window} name="pkr-window" onChange={() => update({ pickupWindow: window as PickupWindow })} type="radio" />
                  {PICKUP_WINDOW_LABELS[window]}
                </label>
              ))}
            </fieldset>
            <FieldError codes={shownDetails} show={["pickup_window_invalid"]} />
            <label className="pkr-field">
              <span>Note for the driver (optional)</span>
              <input maxLength={REQUEST_LIMITS.note} onChange={(event) => update({ pickupNote: event.target.value })} value={draft.pickupNote} />
            </label>
            <p className="pkr-hint">The business confirms the pickup time and any pickup fee in its estimate.</p>
          </div>
        )}

        <div className="pkr-group">
          <h3>Who is sending it?</h3>
          <label className="pkr-field">
            <span>Your name</span>
            <input autoComplete="name" maxLength={REQUEST_LIMITS.name} onChange={(event) => update({ senderName: event.target.value })} value={draft.senderName} />
            <FieldError codes={shownDetails} show={["sender_name_required"]} />
          </label>
          <CustomerPhoneField
            error={shownDetails.includes("sender_phone_invalid") ? REQUEST_ERROR_MESSAGES.sender_phone_invalid : undefined}
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
            <FieldError codes={shownDetails} show={["receiver_name_required"]} />
          </label>
          <CustomerPhoneField
            error={shownDetails.includes("receiver_phone_invalid") ? REQUEST_ERROR_MESSAGES.receiver_phone_invalid : undefined}
            id="pkr-receiver-phone"
            initialCountryCode={receiverCountry}
            key={receiverCountry}
            label="Receiver's phone"
            onChange={(value) => update({ receiverPhone: value })}
            value={draft.receiverPhone}
          />
        </div>
        {error && <p className="customer-field-error" role="alert">{error}</p>}
        <div className="pkr-actions">
          <button className="primary-button" onClick={continueFromDetails} type="button">Continue</button>
        </div>
      </section>
    );
  }

  // step === "pieces"
  return (
    <section className="pkr-card">
      <button className="text-button pkr-back" disabled={sending} onClick={() => setStep("details")} type="button"><ArrowLeft size={16} aria-hidden="true" /> Back</button>
      {header}
      <h2>What are you sending?</h2>
      <p className="pkr-lede">One line per thing you hand over. Several things packed in one box are one piece.</p>
      <div className="pkr-pieces">
        {draft.pieces.map((piece, index) => (
          <article className="pkr-piece" key={piece.key}>
            <header>
              <strong><span>Piece</span> <span data-no-translate>{index + 1}</span></strong>
              {draft.pieces.length > 1 && (
                <button aria-label="Remove this piece" className="icon-button" disabled={sending} onClick={() => setDraft((d) => ({ ...d, pieces: d.pieces.filter((p) => p.key !== piece.key) }))} type="button">
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              )}
            </header>
            <div className="pkr-segments" role="radiogroup" aria-label="What is it?">
              {PIECE_KINDS.map((kind) => (
                <label className={piece.kind === kind ? "active" : ""} key={kind}>
                  <input checked={piece.kind === kind} name={`pkr-kind-${piece.key}`} onChange={() => setPieceKind(piece.key, kind)} type="radio" />
                  {kind === "barrel" ? <span className="pkr-barrel-dot" aria-hidden="true" /> : <Box size={14} aria-hidden="true" />}
                  <span data-no-translate>{pieceKindLabel(kind, lang)}</span>
                </label>
              ))}
            </div>
            {piece.kind === "barrel" ? (
              <p className="pkr-price">
                {option.barrelPriceCents ? (
                  <><span>Price per barrel</span> <strong data-no-translate>{moneyText(option.barrelPriceCents, lang)}</strong></>
                ) : (
                  <span>The business will send you an estimate</span>
                )}
              </p>
            ) : (
              <>
                <label className="pkr-field">
                  <span>What is it?</span>
                  <input maxLength={REQUEST_LIMITS.description} onChange={(event) => updatePiece(piece.key, { description: event.target.value })} placeholder="e.g. clothes, a TV, a generator" value={piece.description} />
                </label>
                <div className="pkr-photos">
                  {piece.photos.map((photo) => (
                    <figure className={`pkr-photo ${photo.status}`} key={photo.key}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="Photo of the piece" src={photo.previewUrl} />
                      {photo.status === "uploading" && <span className="pkr-photo-state"><RefreshCw className="spin" size={14} aria-hidden="true" /></span>}
                      {photo.status === "error" && <span className="pkr-photo-state pkr-photo-error">Not uploaded</span>}
                      <button aria-label="Remove photo" className="pkr-photo-remove" disabled={sending} onClick={() => removePhoto(piece, photo.key)} type="button"><X size={12} aria-hidden="true" /></button>
                    </figure>
                  ))}
                  {piece.photos.length < REQUEST_LIMITS.photosPerPiece && (
                    <button className="pkr-photo-add" disabled={sending} onClick={() => fileInputs.current[piece.key]?.click()} type="button">
                      <Camera size={18} aria-hidden="true" />
                      <span>Add photos</span>
                    </button>
                  )}
                  <input
                    accept="image/*"
                    aria-label="Add photos"
                    className="sr-only"
                    multiple
                    onChange={(event) => {
                      void addPhotos(piece, event.target.files);
                      event.target.value = "";
                    }}
                    ref={(element) => {
                      fileInputs.current[piece.key] = element;
                    }}
                    tabIndex={-1}
                    type="file"
                  />
                </div>
                <small className="pkr-hint">Optional, up to 5 photos. Only the business sees them.</small>
                <p className="pkr-price"><span>The business will send you an estimate</span></p>
              </>
            )}
          </article>
        ))}
      </div>
      <FieldError codes={shownPieces} show={["piece_description_required", "pieces_required", "too_many_pieces", "too_many_photos", "photo_invalid", "text_too_long"]} />
      {draft.pieces.length < REQUEST_LIMITS.pieces && (
        <button className="secondary-button pkr-add" disabled={sending} onClick={() => setDraft((d) => ({ ...d, pieces: [...d.pieces, newPieceDraft("barrel")] }))} type="button">
          <Plus size={16} aria-hidden="true" /> Add another piece
        </button>
      )}
      <div className="pkr-summary">
        {estimate.pricedCents > 0 && (
          <p><span>Barrels</span> <strong data-no-translate>{moneyText(estimate.pricedCents, lang)}</strong></p>
        )}
        {estimate.unpriced > 0 && <p>The business will send you an estimate for the rest.</p>}
        <p className="pkr-hint">
          {draft.handoff === "collect"
            ? "This is an estimate. You pay when the business collects; the final price is set then."
            : "This is an estimate. You pay at drop-off; the final price is set then."}
        </p>
      </div>
      {error && <p className="customer-field-error" role="alert">{error}</p>}
      {uploading && <p className="pkr-hint" role="status">Photos are still uploading...</p>}
      <div className="pkr-actions">
        <button className="primary-button" data-loading={sending} disabled={sending || uploading} onClick={() => void send()} type="button">
          {sending ? "Sending request..." : "Send request"}
        </button>
      </div>
    </section>
  );
}
