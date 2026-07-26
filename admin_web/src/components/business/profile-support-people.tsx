"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { httpsCallable } from "firebase/functions";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
  Car,
  Check,
  FileText,
  ImageUp,
  LifeBuoy,
  Package,
  ParkingCircle,
  Plane,
  RefreshCw,
  Save,
  Send,
  Ship,
  Truck,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";

import { SearchableSelect } from "@/components/searchable-select";
import {
  buildBusinessVerificationChecklist,
  businessServiceLabel,
  resolveBusinessStripeVerification,
  type BusinessVerificationItem,
  type BusinessVerificationSummary,
  type BusinessStripeVerification,
} from "@/lib/business-verification";
import type {
  ActionConfirmationOptions,
  ActionRunner,
} from "@/lib/action-confirmation";
import {
  buildBusinessServiceSettingsPayload,
  businessServiceSettingsFromRow,
  isNewYorkState,
  NYC_BOROUGHS,
  validateBusinessServiceSettings,
  type BusinessServiceSettingsDraft,
} from "@/lib/business-service-settings";
import { COUNTRY_CATALOG } from "@/lib/country-catalog";
import { useSharedBarrelsEnabled } from "@/lib/feature-flags";
import { db, functions, storage } from "@/lib/firebase";
import { formatDate, text } from "@/lib/format";
import { ensureBrowserDisplayableImage } from "@/lib/heic-convert";
import { currentWebLanguage } from "@/lib/language";
import { CITIES_BY_STATE, US_STATE_NAMES } from "@/lib/us-locations";
import type { FirestoreRow } from "@/types/admin";

type ToastCallback = (type: "success" | "error", message: string) => void;

export type BusinessProfilePanelProps = {
  businessId: string;
  business?: FirestoreRow | null;
  runAction?: ActionRunner;
  toast?: ToastCallback;
};

export type BusinessSupportPanelProps = {
  businessId: string;
  rows: FirestoreRow[];
  loading?: boolean;
  error?: string;
  runAction?: ActionRunner;
  toast?: ToastCallback;
};

export type BusinessPeoplePanelProps = {
  businessId: string;
  business?: FirestoreRow | null;
  rows: FirestoreRow[];
  loading?: boolean;
  error?: string;
  canManageStaff?: boolean;
  runAction?: ActionRunner;
  toast?: ToastCallback;
};

type ProfileDraft = {
  name: string;
  phone: string;
  email: string;
  website: string;
  serviceNote: string;
  enabledServices: string[];
  carHoldPricingMode: "flat" | "per_day";
  carHoldFlatFee: string;
  carHoldDailyRate: string;
  carHoldMaxDays: string;
  freightPickupAvailable: boolean;
  freightPickupModel: "distance" | "borough";
  freightPickupBaseFee: string;
  freightPickupPerKm: string;
  freightPickupMinFee: string;
  freightPickupMaxKm: string;
  freightPickupOriginAddress: string;
  freightPickupBoroughPrices: Record<string, string>;
  profileImageUrl: string;
  profileImagePath: string;
};

type SupportDraft = {
  priority: "normal" | "urgent" | "blocked";
  subject: string;
  message: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
};

type StaffDraft = {
  fullName: string;
  email: string;
  businessPermissions: string[];
};

const businessPermissionOptions = [
  {id: "profile", label: "Business"},
  {id: "listings", label: "Listings"},
  {id: "purchases", label: "Purchases"},
  {id: "barrels", label: "Barrels"},
  {id: "freight", label: "Freight"},
  {id: "transport", label: "Transport"},
  {id: "parking", label: "Parking"},
  {id: "destinations", label: "Services & coverage"},
  {id: "people", label: "People"},
  {id: "support", label: "Support"},
  {id: "growth", label: "Growth"},
];

const serviceOptions = [
  {
    id: "barrelShipping",
    label: "Barrel shipping",
    description: "Country routes, barrel prices, and delivery estimates.",
  },
  {
    id: "sharedBarrels",
    label: "Shared barrels",
    description: "Open shared loads on your active barrel routes.",
  },
  {
    id: "freight",
    label: "Freight",
    description: "Air and sea rates, departure days, and pickup.",
  },
  {
    id: "carSales",
    label: "Car sales",
    description: "Vehicle listings, customer holds, and purchases.",
  },
  {
    id: "carTransport",
    label: "Car transport",
    description: "Country coverage and customer quote requests.",
  },
  {
    id: "carParking",
    label: "Car parking",
    description: "Facility capacity, rates, and vehicle pickup.",
  },
];

const parkingStateOptions = Object.entries(US_STATE_NAMES).map(
  ([code, name]) => ({
    label: name,
    keywords: `${code} ${name}`,
    value: code,
  }),
);

const verificationUploadTypes = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/",
  "application/octet-stream",
];
const verificationAccept = "application/pdf,image/*,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const verificationMaxBytes = 20 * 1024 * 1024;

const emptySupportDraft: SupportDraft = {
  priority: "normal",
  subject: "",
  message: "",
  customerName: "",
  customerEmail: "",
  customerPhone: "",
};

const emptyStaffDraft: StaffDraft = {
  fullName: "",
  email: "",
  businessPermissions: ["profile", "people"],
};

export function BusinessProfilePanel({
  businessId,
  business,
  runAction,
  toast,
}: BusinessProfilePanelProps) {
  const [draft, setDraft] = useState<ProfileDraft>(() => profileDraftFromBusiness(business));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [documentFilesById, setDocumentFilesById] = useState<Record<string, File | null>>({});
  const {busy, busyLabel, error, run} = useActionFeedback(runAction, toast);

  useEffect(() => {
    setDraft(profileDraftFromBusiness(business));
    setImageFile(null);
    setDocumentFilesById({});
  }, [business]);

  function update(field: keyof ProfileDraft, value: string) {
    setDraft((current) => ({...current, [field]: value}));
  }

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setImageFile(null);
      return;
    }
    try {
      setImageFile(await ensureBrowserDisplayableImage(file));
    } catch {
      toast?.("error", "Could not process that image. Try a JPG or PNG instead.");
    }
  }

  function selectVerificationFile(documentId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setDocumentFilesById((current) => ({...current, [documentId]: file}));
  }

  async function uploadVerificationDocument(item: BusinessVerificationItem) {
    await run("Verification document uploaded", async () => {
      if (!businessId) throw new Error("Business account is not configured.");
      const file = documentFilesById[item.id];
      if (!file) throw new Error("Choose a document first.");
      if (!isAllowedVerificationFile(file)) {
        throw new Error("Documents must be PDF, Word, or image files under 20 MB.");
      }

      const uploaded = await uploadBusinessVerificationDocument(
        businessId,
        item.id,
        file,
      );
      if (!uploaded.success) throw new Error("Document upload failed.");
      setDocumentFilesById((current) => ({...current, [item.id]: null}));
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      "Business profile saved",
      async () => {
        if (!businessId) throw new Error("Business account is not configured.");
        if (!business) throw new Error("Business profile is still loading.");
        if (!draft.name.trim()) throw new Error("Business name is required.");

        let profileImageUrl = draft.profileImageUrl.trim();
        let profileImagePath = draft.profileImagePath.trim();
        if (imageFile) {
          const uploaded = await uploadBusinessProfileImage(businessId, imageFile);
          profileImageUrl = uploaded.url;
          profileImagePath = uploaded.path;
        }

        await httpsCallable(functions, "updateBusinessProfile")({
          businessId,
          ...buildBusinessServiceSettingsPayload(
            businessServiceSettingsFromRow(business),
            business,
          ),
          name: draft.name.trim(),
          phone: draft.phone.trim(),
          email: draft.email.trim().toLowerCase(),
          website: draft.website.trim(),
          serviceNote: draft.serviceNote.trim(),
          profileImageUrl,
          profileImagePath,
        });

        setDraft((current) => ({
          ...current,
          profileImageUrl,
          profileImagePath,
        }));
        setImageFile(null);
      },
      {
        confirm:
          "Save these public business profile changes?",
        confirmFr:
          "Enregistrer ces modifications du profil public de l’entreprise ?",
      },
    );
  }

  const logoPreview = imageFile ? URL.createObjectURL(imageFile) : draft.profileImageUrl;
  const verificationBusiness = {
    ...(business ?? {}),
    id: text(business?.id, businessId || "business"),
    enabledServices: draft.enabledServices,
  } as FirestoreRow;
  const verification = buildBusinessVerificationChecklist(verificationBusiness);
  const stripeVerification = resolveBusinessStripeVerification(verificationBusiness);
  const verifiedOrSkipped =
    verification.summary.verified + verification.summary.notApplicable;
  const reviewNote = businessVerificationReviewNote(verificationBusiness);

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Business profile</h2>
          <p>Identity, branding, customer-facing details, and verification.</p>
        </div>
        <div className="lst-head-actions">
          {busy && <span className="pur-kind">{busyLabel || "Saving..."}</span>}
          <button className="lst-add" disabled={busy || !businessId || !business} form="business-profile-form" type="submit">
            {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
            {busy ? "Saving..." : "Save changes"}
          </button>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {!businessId && <div className="error-box">Business account is not configured.</div>}

      <form className="bp-card" id="business-profile-form" onSubmit={submit}>
        <div className="bp-logo-row">
          <div className="bp-logo" aria-hidden="true">
            {logoPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoPreview} alt="Business logo" />
            ) : <Building2 size={26} />}
          </div>
          <div className="bp-logo-text">
            <strong>Logo / profile image</strong>
            <span>{imageFile ? `${imageFile.name} (${Math.ceil(imageFile.size / 1024)} KB)` : draft.profileImageUrl ? "Saved — choose a file to replace." : "Customers recognize you by this image."}</span>
            <div className="bp-logo-actions">
              <label className="lst-btn ghost" style={{ cursor: "pointer" }}>
                <ImageUp size={14} /> Choose image
                <input accept="image/*,.heic,.heif" type="file" hidden onChange={selectImage} />
              </label>
              {imageFile && <button className="lst-btn ghost" type="button" onClick={() => setImageFile(null)}>Clear</button>}
            </div>
          </div>
        </div>

        <div className="lst-form-grid">
          <div className="lst-form-section">Identity</div>
          <label className="lst-field"><span>Business name</span>
            <input autoComplete="organization" required value={draft.name} onChange={(event) => update("name", event.target.value)} />
          </label>
          <label className="lst-field"><span>Phone</span>
            <input autoComplete="tel" inputMode="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} />
          </label>
          <label className="lst-field"><span>Email</span>
            <input autoComplete="email" inputMode="email" type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} />
          </label>
          <label className="lst-field"><span>Website</span>
            <input autoComplete="url" inputMode="url" placeholder="https://example.com" value={draft.website} onChange={(event) => update("website", event.target.value)} />
          </label>
          <label className="lst-field wide"><span>Service note</span>
            <textarea rows={3} value={draft.serviceNote} onChange={(event) => update("serviceNote", event.target.value)} placeholder="What your business is known for…" />
          </label>
        </div>
        <BusinessVerificationUploadSection
          busy={busy}
          documentFilesById={documentFilesById}
          items={verification.items}
          reviewNote={reviewNote}
          stripe={stripeVerification}
          summary={verification.summary}
          uploadDocument={uploadVerificationDocument}
          selectFile={selectVerificationFile}
          verifiedOrSkipped={verifiedOrSkipped}
        />
      </form>
    </section>
  );
}

export function BusinessServicesPanel({
  businessId,
  business,
  canManage = false,
  runAction,
  toast,
}: BusinessProfilePanelProps & { canManage?: boolean }) {
  const [draft, setDraft] = useState<BusinessServiceSettingsDraft>(() =>
    businessServiceSettingsFromRow(business),
  );
  const {busy, busyLabel, error, run} = useActionFeedback(runAction, toast);
  const sharedBarrelsEnabled = useSharedBarrelsEnabled();
  const visibleServiceOptions = sharedBarrelsEnabled
    ? serviceOptions
    : serviceOptions.filter((service) => service.id !== "sharedBarrels");

  useEffect(() => {
    setDraft(businessServiceSettingsFromRow(business));
  }, [business]);

  function update<K extends keyof BusinessServiceSettingsDraft>(
    field: K,
    value: BusinessServiceSettingsDraft[K],
  ) {
    setDraft((current) => ({...current, [field]: value}));
  }

  function toggleService(service: string, enabled: boolean) {
    setDraft((current) => {
      let enabledServices = togglePermission(
        current.enabledServices,
        service,
        enabled,
      );
      if (service === "sharedBarrels" && enabled) {
        enabledServices = togglePermission(
          enabledServices,
          "barrelShipping",
          true,
        );
      }
      if (service === "barrelShipping" && !enabled) {
        enabledServices = togglePermission(
          enabledServices,
          "sharedBarrels",
          false,
        );
      }
      return {...current, enabledServices};
    });
  }

  function updateBoroughPrice(borough: string, value: string) {
    setDraft((current) => ({
      ...current,
      freightPickupBoroughPrices: {
        ...current.freightPickupBoroughPrices,
        [borough]: value,
      },
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      "Service settings saved",
      async () => {
        if (!businessId) throw new Error("Business account is not configured.");
        if (!business) throw new Error("Business profile is still loading.");
        if (!canManage) {
          throw new Error("Only the business owner can change service settings.");
        }
        const validationError = validateBusinessServiceSettings(draft, {
          isNewYorkBusiness: isNewYorkState(business.state),
        });
        if (validationError) throw new Error(validationError);
        await httpsCallable(functions, "updateBusinessProfile")({
          businessId,
          ...buildBusinessServiceSettingsPayload(draft, business),
        });
      },
      {
        confirm:
          "Save service availability, pricing, pickup, and facility changes?",
        confirmFr:
          "Enregistrer les changements de disponibilité, tarifs, collecte et installations ?",
      },
    );
  }

  const activeServiceCount = draft.enabledServices.length;
  const activeServiceSummary = `${activeServiceCount} of 6 services active`;
  const offersCarSales = draft.enabledServices.includes("carSales");
  const offersFreight = draft.enabledServices.includes("freight");
  const offersParking = draft.enabledServices.includes("carParking");
  const parkingIsUnitedStates =
    draft.parkingCountry.trim() === "United States";
  const language = currentWebLanguage() === "fr" ? "fr" : "en";
  const parkingCountryOptions = useMemo(() => {
    const displayNames = new Intl.DisplayNames([language], {type: "region"});
    return COUNTRY_CATALOG.map((country) => {
      const localizedName = displayNames.of(country.code) ?? country.name;
      return {
        label: localizedName,
        keywords: `${country.code} ${country.name} ${localizedName}`,
        value: country.name,
      };
    });
  }, [language]);
  const parkingCityOptions = [
    ...(CITIES_BY_STATE[draft.parkingState] ?? []),
    ...(
      draft.parkingCity &&
      !(CITIES_BY_STATE[draft.parkingState] ?? []).includes(draft.parkingCity)
        ? [draft.parkingCity]
        : []
    ),
  ].map((city) => ({label: city, value: city}));

  return (
    <section className="lst service-settings">
      <header className="lst-head service-settings-header">
        <div className="lst-head-text">
          <span className="service-settings-eyebrow">Business setup</span>
          <h2>Services &amp; coverage</h2>
          <p>
            Manage what you offer, how customers are served, and where each
            service is available.
          </p>
        </div>
        <div className="lst-head-actions">
          {busy && (
            <span className="pur-kind">{busyLabel || "Saving settings..."}</span>
          )}
          <button
            className="lst-add"
            disabled={busy || !businessId || !business || !canManage}
            form="business-service-settings-form"
            type="submit"
          >
            {busy ? (
              <RefreshCw className="spin" size={16} />
            ) : (
              <Save size={16} />
            )}
            {busy ? "Saving settings..." : "Save service settings"}
          </button>
        </div>
      </header>

      {error && <div className="error-box">{error}</div>}
      {!canManage && (
        <div className="customer-inline-note">
          You can review these settings. Only the business owner can change
          service availability and pricing.
        </div>
      )}

      <form
        className="service-settings-form"
        id="business-service-settings-form"
        onSubmit={submit}
      >
        <div className="service-settings-summary">
          <div>
            <strong>{activeServiceSummary}</strong>
            <span>
              Select a service to reveal only the settings it needs.
            </span>
          </div>
          <span className="service-settings-step">1 · Services</span>
        </div>

        <fieldset
          className="service-settings-fieldset"
          disabled={!canManage || busy}
        >
          <div className="service-selector-grid">
            {visibleServiceOptions.map((service) => {
              const active = draft.enabledServices.includes(service.id);
              return (
                <button
                  aria-pressed={active}
                  className={`service-selector-card ${active ? "active" : ""}`}
                  key={service.id}
                  onClick={() => toggleService(service.id, !active)}
                  type="button"
                >
                  <span className="service-selector-icon">
                    {businessServiceIcon(service.id)}
                  </span>
                  <span className="service-selector-copy">
                    <strong>{service.label}</strong>
                    <small>{service.description}</small>
                  </span>
                  <span className="service-selector-status">
                    {active && <Check size={13} />}
                    {active ? "Active" : "Not offered"}
                  </span>
                </button>
              );
            })}
          </div>

          {(offersCarSales || offersFreight || offersParking) && (
            <div className="service-settings-summary service-rules-summary">
              <div>
                <strong>Service rules</strong>
                <span>
                  Pricing, pickup, and facility details stay with the service
                  they control.
                </span>
              </div>
              <span className="service-settings-step">2 · Rules</span>
            </div>
          )}

          <div className="service-config-grid">
            {offersCarSales && (
              <article className="service-config-card">
                <header className="service-config-card-head">
                  <span className="service-config-icon"><Car size={21} /></span>
                  <div>
                    <strong>Car sales · paid holds</strong>
                    <span>
                      Set how customers pay to reserve a vehicle temporarily.
                    </span>
                  </div>
                </header>
                <div className="lst-form-grid service-config-fields">
                  <label className="lst-field">
                    <span>Pricing mode</span>
                    <select
                      value={draft.carHoldPricingMode}
                      onChange={(event) =>
                        update(
                          "carHoldPricingMode",
                          event.target.value === "per_day" ? "per_day" : "flat",
                        )
                      }
                    >
                      <option value="flat">Flat fee</option>
                      <option value="per_day">Per day</option>
                    </select>
                  </label>
                  <label className="lst-field">
                    <span>Maximum hold days</span>
                    <input
                      inputMode="numeric"
                      max="30"
                      min="1"
                      onChange={(event) =>
                        update("carHoldMaxDays", event.target.value)
                      }
                      type="number"
                      value={draft.carHoldMaxDays}
                    />
                  </label>
                  {draft.carHoldPricingMode === "flat" ? (
                    <label className="lst-field wide">
                      <span>Flat hold fee (USD)</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          update("carHoldFlatFee", event.target.value)
                        }
                        type="number"
                        value={draft.carHoldFlatFee}
                      />
                    </label>
                  ) : (
                    <label className="lst-field wide">
                      <span>Daily hold rate (USD)</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          update("carHoldDailyRate", event.target.value)
                        }
                        type="number"
                        value={draft.carHoldDailyRate}
                      />
                    </label>
                  )}
                </div>
              </article>
            )}

            {offersFreight && (
              <article className="service-config-card">
                <header className="service-config-card-head">
                  <span className="service-config-icon"><Plane size={21} /></span>
                  <div>
                    <strong>Freight · customer pickup</strong>
                    <span>
                      Offer collection from a customer address and calculate
                      the fee consistently.
                    </span>
                  </div>
                  <button
                    aria-pressed={draft.freightPickupAvailable}
                    className={`service-rule-toggle ${draft.freightPickupAvailable ? "active" : ""}`}
                    onClick={() =>
                      update(
                        "freightPickupAvailable",
                        !draft.freightPickupAvailable,
                      )
                    }
                    type="button"
                  >
                    {draft.freightPickupAvailable ? "Pickup on" : "Pickup off"}
                  </button>
                </header>
                {draft.freightPickupAvailable ? (
                  <div className="lst-form-grid service-config-fields">
                    {isNewYorkState(business?.state) && (
                      <label className="lst-field wide">
                        <span>Pickup pricing model</span>
                        <select
                          value={draft.freightPickupModel}
                          onChange={(event) =>
                            update(
                              "freightPickupModel",
                              event.target.value === "borough"
                                ? "borough"
                                : "distance",
                            )
                          }
                        >
                          <option value="distance">By distance</option>
                          <option value="borough">By borough</option>
                        </select>
                      </label>
                    )}
                    {draft.freightPickupModel === "borough" &&
                    isNewYorkState(business?.state) ? (
                      <>
                        <p className="service-config-note wide">
                          Set one flat pickup fee for every borough you serve.
                        </p>
                        {NYC_BOROUGHS.map((borough) => (
                          <label className="lst-field" key={borough}>
                            <span>{borough} (USD)</span>
                            <input
                              inputMode="decimal"
                              min="0"
                              onChange={(event) =>
                                updateBoroughPrice(
                                  borough,
                                  event.target.value,
                                )
                              }
                              placeholder="0"
                              type="number"
                              value={
                                draft.freightPickupBoroughPrices[borough] ?? ""
                              }
                            />
                          </label>
                        ))}
                      </>
                    ) : (
                      <>
                        <p className="service-config-note wide">
                          Fee = base fee + per-kilometre rate × driving
                          distance. Zero rates mean free pickup.
                        </p>
                        <label className="lst-field wide">
                          <span>Pickup origin address</span>
                          <input
                            onChange={(event) =>
                              update(
                                "freightPickupOriginAddress",
                                event.target.value,
                              )
                            }
                            placeholder="Defaults to your business address"
                            value={draft.freightPickupOriginAddress}
                          />
                        </label>
                        <label className="lst-field">
                          <span>Base fee (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              update(
                                "freightPickupBaseFee",
                                event.target.value,
                              )
                            }
                            type="number"
                            value={draft.freightPickupBaseFee}
                          />
                        </label>
                        <label className="lst-field">
                          <span>Per km (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              update(
                                "freightPickupPerKm",
                                event.target.value,
                              )
                            }
                            type="number"
                            value={draft.freightPickupPerKm}
                          />
                        </label>
                        <label className="lst-field">
                          <span>Minimum fee (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              update(
                                "freightPickupMinFee",
                                event.target.value,
                              )
                            }
                            type="number"
                            value={draft.freightPickupMinFee}
                          />
                        </label>
                        <label className="lst-field">
                          <span>Maximum distance (km)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            onChange={(event) =>
                              update(
                                "freightPickupMaxKm",
                                event.target.value,
                              )
                            }
                            placeholder="0 = no limit"
                            type="number"
                            value={draft.freightPickupMaxKm}
                          />
                        </label>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="service-config-empty">
                    Customers bring freight to your business. Turn pickup on to
                    configure collection pricing.
                  </p>
                )}
              </article>
            )}

            {offersParking && (
              <article className="service-config-card service-config-card-wide">
                <header className="service-config-card-head">
                  <span className="service-config-icon">
                    <ParkingCircle size={22} />
                  </span>
                  <div>
                    <strong>Car parking · facility</strong>
                    <span>
                      Keep capacity, customer rates, location, and pickup
                      together.
                    </span>
                  </div>
                  <button
                    aria-pressed={draft.parkingPickupAvailable}
                    className={`service-rule-toggle ${draft.parkingPickupAvailable ? "active" : ""}`}
                    onClick={() =>
                      update(
                        "parkingPickupAvailable",
                        !draft.parkingPickupAvailable,
                      )
                    }
                    type="button"
                  >
                    {draft.parkingPickupAvailable
                      ? "Vehicle pickup on"
                      : "Vehicle pickup off"}
                  </button>
                </header>
                <div className="lst-form-grid service-config-fields">
                  <label className="lst-field wide">
                    <span>Parking address</span>
                    <input
                      autoComplete="street-address"
                      onChange={(event) =>
                        update("parkingAddressLine1", event.target.value)
                      }
                      value={draft.parkingAddressLine1}
                    />
                  </label>
                  <SearchableSelect
                    className="lst-field"
                    emptyMessage="No countries match your search."
                    label="Parking country"
                    listLabel="Parking country options"
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        parkingCountry: value,
                        parkingState: "",
                        parkingCity: "",
                      }))
                    }
                    options={parkingCountryOptions}
                    placeholder="Search or choose a country"
                    value={draft.parkingCountry}
                  />
                  {parkingIsUnitedStates ? (
                    <SearchableSelect
                      className="lst-field"
                      emptyMessage="No states match your search."
                      label="Parking state"
                      listLabel="Parking state options"
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          parkingState: value,
                          parkingCity: "",
                        }))
                      }
                      options={parkingStateOptions}
                      placeholder="Search or choose a state"
                      value={draft.parkingState}
                    />
                  ) : (
                    <label className="lst-field">
                      <span>State or region</span>
                      <input
                        onChange={(event) =>
                          update("parkingState", event.target.value)
                        }
                        value={draft.parkingState}
                      />
                    </label>
                  )}
                  {parkingIsUnitedStates && draft.parkingState ? (
                    <SearchableSelect
                      className="lst-field"
                      emptyMessage="No cities match your search."
                      label="Parking city"
                      listLabel="Parking city options"
                      onChange={(value) => update("parkingCity", value)}
                      options={parkingCityOptions}
                      placeholder="Search or choose a city"
                      value={draft.parkingCity}
                    />
                  ) : (
                    <label className="lst-field">
                      <span>Parking city</span>
                      <input
                        onChange={(event) =>
                          update("parkingCity", event.target.value)
                        }
                        value={draft.parkingCity}
                      />
                    </label>
                  )}
                  <label className="lst-field">
                    <span>Total parking spaces</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        update("parkingTotalSpaces", event.target.value)
                      }
                      type="number"
                      value={draft.parkingTotalSpaces}
                    />
                  </label>
                  <label className="lst-field">
                    <span>Blocked spaces</span>
                    <input
                      inputMode="numeric"
                      min="0"
                      onChange={(event) =>
                        update("parkingBlockedSpaces", event.target.value)
                      }
                      type="number"
                      value={draft.parkingBlockedSpaces}
                    />
                  </label>
                  <label className="lst-field">
                    <span>Daily rate (USD)</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      onChange={(event) =>
                        update("parkingDailyRate", event.target.value)
                      }
                      type="number"
                      value={draft.parkingDailyRate}
                    />
                  </label>
                  <label className="lst-field">
                    <span>Minimum stay (days)</span>
                    <input
                      inputMode="numeric"
                      min="1"
                      onChange={(event) =>
                        update("parkingMinimumDays", event.target.value)
                      }
                      type="number"
                      value={draft.parkingMinimumDays}
                    />
                  </label>
                  <label className="lst-field">
                    <span>Weekly rate (USD, optional)</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      onChange={(event) =>
                        update("parkingWeeklyRate", event.target.value)
                      }
                      type="number"
                      value={draft.parkingWeeklyRate}
                    />
                  </label>
                  <label className="lst-field">
                    <span>Monthly rate (USD, optional)</span>
                    <input
                      inputMode="decimal"
                      min="0"
                      onChange={(event) =>
                        update("parkingMonthlyRate", event.target.value)
                      }
                      type="number"
                      value={draft.parkingMonthlyRate}
                    />
                  </label>
                  {draft.parkingPickupAvailable && (
                    <label className="lst-field">
                      <span>Vehicle pickup fee (USD)</span>
                      <input
                        inputMode="decimal"
                        min="0"
                        onChange={(event) =>
                          update("parkingPickupFee", event.target.value)
                        }
                        type="number"
                        value={draft.parkingPickupFee}
                      />
                    </label>
                  )}
                  <label className="lst-field wide">
                    <span>Parking instructions</span>
                    <textarea
                      onChange={(event) =>
                        update("parkingInstructions", event.target.value)
                      }
                      placeholder="Entry instructions, hours, or customer notes"
                      rows={3}
                      value={draft.parkingInstructions}
                    />
                  </label>
                </div>
              </article>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

function businessServiceIcon(serviceId: string) {
  switch (serviceId) {
    case "barrelShipping":
      return <Package size={21} />;
    case "sharedBarrels":
      return <Ship size={21} />;
    case "freight":
      return <Plane size={21} />;
    case "carSales":
      return <Car size={21} />;
    case "carTransport":
      return <Truck size={21} />;
    case "carParking":
      return <ParkingCircle size={21} />;
    default:
      return <Building2 size={21} />;
  }
}

function BusinessVerificationUploadSection({
  busy,
  documentFilesById,
  items,
  reviewNote,
  stripe,
  summary,
  selectFile,
  uploadDocument,
  verifiedOrSkipped,
}: {
  busy: boolean;
  documentFilesById: Record<string, File | null>;
  items: BusinessVerificationItem[];
  reviewNote: string;
  stripe: BusinessStripeVerification;
  summary: BusinessVerificationSummary;
  selectFile: (documentId: string, event: ChangeEvent<HTMLInputElement>) => void;
  uploadDocument: (item: BusinessVerificationItem) => Promise<void>;
  verifiedOrSkipped: number;
}) {
  const stripeDueCount = stripe.currentlyDue.length + stripe.pastDue.length;

  return (
    <div className="bp-verification">
      <div className="bp-verification-head">
        <div>
          <strong>Verification documents</strong>
          <span>
            {summary.approvalReady
              ? "Required Laawol service documents are complete."
              : "Upload only the service documents Laawol admins need. Stripe collects identity, tax, legal, and bank details."}
          </span>
        </div>
        <span className={`lst-badge ${summary.approvalReady ? "ok" : "warn"}`}>
          {verifiedOrSkipped}/{summary.total} complete
        </span>
      </div>

      <div className={`bp-stripe-note ${stripe.ready ? "ready" : "pending"}`}>
        <div>
          <strong>Stripe verification</strong>
          <span>{stripe.primaryLabel}</span>
        </div>
        <p>{stripe.helperText}</p>
        <div className="bp-stripe-meta">
          <span>{stripe.stripeAccountId ? `Account: ${stripe.stripeAccountId}` : "No Stripe account connected yet"}</span>
          {stripeDueCount > 0 && (
            <span>
              <strong>{stripeDueCount}</strong> {stripeDueCount === 1 ? "Stripe requirement due" : "Stripe requirements due"}
            </span>
          )}
          {stripe.pendingVerification.length > 0 && (
            <span><strong>{stripe.pendingVerification.length}</strong> pending with Stripe</span>
          )}
        </div>
      </div>

      <div className="bp-verification-summary" aria-label="Verification document summary">
        <div><b>{summary.total}</b><span>Platform docs</span></div>
        <div><b>{summary.submitted}</b><span>Submitted</span></div>
        <div><b>{summary.verified}</b><span>Verified</span></div>
        <div><b>{summary.needsChanges + summary.missing}</b><span>Needs review</span></div>
      </div>

      {reviewNote && (
        <div className="info-band bp-admin-note">
          <strong>Admin note:</strong> {reviewNote}
        </div>
      )}

      <div className="bp-doc-list">
        {items.length === 0 && (
          <div className="bp-doc-row status-verified">
            <div className="bp-doc-main">
              <div className="bp-doc-title">
                <FileText size={18} />
                <div>
                  <strong>No Laawol service documents required</strong>
                  <small>Stripe still handles identity, tax, legal, and bank checks.</small>
                </div>
              </div>
              <span className="lst-badge ok">Complete</span>
            </div>
            <p>The services selected for this business do not require extra Laawol licenses or authority documents.</p>
          </div>
        )}
        {items.map((item) => {
          const selected = documentFilesById[item.id] ?? null;
          const statusClass = statusBadgeClass(item.status);
          return (
            <div className={`bp-doc-row status-${item.status}`} key={item.id}>
              <div className="bp-doc-main">
                <div className="bp-doc-title">
                  <FileText size={18} />
                  <div>
                    <strong>{item.label}</strong>
                    <small>
                      {item.services.length
                        ? item.services.map(businessServiceLabel).join(", ")
                        : "All businesses"}
                    </small>
                  </div>
                </div>
                <span className={`lst-badge ${statusClass}`}>{statusLabel(item.status)}</span>
              </div>
              <p>{item.description}</p>
              {item.reviewNote && (
                <div className="bp-doc-note">
                  <strong>Admin request:</strong> {item.reviewNote}
                </div>
              )}
              <div className="bp-doc-evidence">
                {item.evidence.present ? (
                  item.evidence.url ? (
                    <a className="lst-btn ghost" href={item.evidence.url} target="_blank" rel="noreferrer">
                      Open document
                    </a>
                  ) : (
                    <span className="bp-file-name">Uploaded: {item.evidence.label}</span>
                  )
                ) : (
                  <span className="bp-doc-missing">No file uploaded yet</span>
                )}
                <label className="lst-btn ghost">
                  <FileText size={14} /> Choose document
                  <input
                    accept={verificationAccept}
                    hidden
                    type="file"
                    onChange={(event) => selectFile(item.id, event)}
                  />
                </label>
                {selected && (
                  <span className="bp-file-name">
                    {selected.name} ({Math.ceil(selected.size / 1024)} KB)
                  </span>
                )}
                <button
                  className="lst-add"
                  disabled={busy || !selected}
                  type="button"
                  onClick={() => uploadDocument(item)}
                >
                  {busy ? <RefreshCw className="spin" size={16} /> : <Upload size={16} />}
                  {busy ? "Uploading..." : "Upload document"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BusinessSupportPanel({
  businessId,
  rows,
  loading = false,
  error: rowsError = "",
  runAction,
  toast,
}: BusinessSupportPanelProps) {
  const [draft, setDraft] = useState<SupportDraft>(emptySupportDraft);
  const [responseById, setResponseById] = useState<Record<string, string>>({});
  const [statusById, setStatusById] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const {busy, busyLabel, error, run} = useActionFeedback(runAction, toast);

  function update(patch: Partial<SupportDraft>) {
    setDraft((current) => ({...current, ...patch}));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run("Support request sent", async () => {
      if (!businessId) throw new Error("Business account is not configured.");
      if (!draft.subject.trim()) throw new Error("Enter a request subject.");
      if (!draft.message.trim()) throw new Error("Enter a request message.");

      await httpsCallable(functions, "requestBusinessSupport")({
        businessId,
        priority: draft.priority,
        subject: draft.subject.trim(),
        message: draft.message.trim(),
        customerName: draft.customerName.trim(),
        customerEmail: draft.customerEmail.trim().toLowerCase(),
        customerPhone: draft.customerPhone.trim(),
      });
      setDraft(emptySupportDraft);
      setFormOpen(false);
    });
  }

  async function updateSupport(row: FirestoreRow) {
    await run("Support request updated", async () => {
      const response = text(responseById[row.id] ?? row.businessResponse, "").trim();
      const status = text(statusById[row.id] ?? row.status, "open");
      await setDoc(
        doc(db, "businessSupportRequests", row.id),
        {
          status,
          businessResponse: response,
          businessRespondedAt: response ? serverTimestamp() : row.businessRespondedAt ?? null,
          businessRespondedBy: response ? businessId : row.businessRespondedBy ?? null,
          businessReadAt: serverTimestamp(),
          businessReadBy: businessId,
          updatedAt: serverTimestamp(),
        },
        {merge: true},
      );
    });
  }

  const openCount = rows.filter((row) => isOpenStatus(text(row.status, "open"))).length;

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Support</h2>
          <p>{rows.length === 0 ? "Ask the admin team for help, or track your requests." : `${rows.length} request${rows.length === 1 ? "" : "s"}${openCount ? ` · ${openCount} open` : ""}`}</p>
        </div>
        <div className="lst-head-actions">
          {busy && <span className="pur-kind">{busyLabel || "Working..."}</span>}
          <button className="lst-add" type="button" disabled={!businessId} onClick={() => { setDraft(emptySupportDraft); setFormOpen(true); }}>
            <Send size={16} /> New request
          </button>
        </div>
      </header>

      {(error || rowsError) && <div className="error-box">{error || rowsError}</div>}

      {loading && <div className="lst-empty"><p>Loading…</p></div>}
      {!loading && rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><LifeBuoy size={30} /></div>
          <h3>No support requests yet</h3>
          <p>Reach the admin team when you need a hand.</p>
          <button className="lst-add" type="button" disabled={!businessId} onClick={() => setFormOpen(true)}><Send size={16} /> New request</button>
        </div>
      )}

      <div className="pur-grid">
        {rows.map((row) => {
          const status = text(statusById[row.id] ?? row.status, "open");
          const response = text(responseById[row.id] ?? row.businessResponse, "");
          return (
            <article className="pur-card" key={`${row._path ?? row.id}`}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{text(row.subject ?? row.category, "Request")}</strong>
                  <span className="pur-kind">{statusLabel(row.priority)} priority · {formatDate(row.updatedAt ?? row.createdAt)}</span>
                </div>
                <span className={`lst-badge ${isOpenStatus(status) ? "warn" : "ok"}`}>{statusLabel(status)}</span>
              </div>
              <div className="sup-message">{text(row.message, "No message")}</div>
              <label className="bar-field"><span>Status</span>
                <select value={status} onChange={(event) => setStatusById((current) => ({ ...current, [row.id]: event.target.value }))}>
                  <option value="open">Open</option>
                  <option value="in_review">In review</option>
                  <option value="waiting_on_platform">Waiting on platform</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="lst-field"><span>Your response</span>
                <textarea rows={2} value={response} onChange={(event) => setResponseById((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Reply to this request…" />
              </label>
              <div className="pur-actions">
                <button className="lst-btn" type="button" disabled={busy} onClick={() => updateSupport(row)}>
                  {busy ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
                  {busy ? "Saving..." : "Save"}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => setFormOpen(false)}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>New support request</h3>
              <button className="lst-icon-btn" type="button" onClick={() => setFormOpen(false)} aria-label="Close">✕</button>
            </header>
            <form id="business-support-form" onSubmit={submit}>
              <div className="lst-modal-body">
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Priority</span>
                    <select value={draft.priority} onChange={(event) => update({ priority: event.target.value as SupportDraft["priority"] })}>
                      <option value="normal">Normal</option>
                      <option value="urgent">Urgent</option>
                      <option value="blocked">Blocked</option>
                    </select>
                  </label>
                  <label className="lst-field"><span>Customer name (optional)</span>
                    <input value={draft.customerName} onChange={(event) => update({ customerName: event.target.value })} />
                  </label>
                  <label className="lst-field"><span>Customer email (optional)</span>
                    <input inputMode="email" type="email" value={draft.customerEmail} onChange={(event) => update({ customerEmail: event.target.value })} />
                  </label>
                  <label className="lst-field"><span>Customer phone (optional)</span>
                    <input inputMode="tel" value={draft.customerPhone} onChange={(event) => update({ customerPhone: event.target.value })} />
                  </label>
                  <label className="lst-field wide"><span>Subject</span>
                    <input required value={draft.subject} onChange={(event) => update({ subject: event.target.value })} placeholder="What do you need help with?" />
                  </label>
                  <label className="lst-field wide"><span>Message</span>
                    <textarea required rows={4} value={draft.message} onChange={(event) => update({ message: event.target.value })} />
                  </label>
                </div>
              </div>
              <footer className="lst-modal-foot">
                <button className="lst-btn ghost" type="button" onClick={() => setFormOpen(false)}>Cancel</button>
                <button className="lst-add" type="submit" disabled={busy || !businessId}>
                  {busy ? <RefreshCw className="spin" size={16} /> : <Send size={16} />}
                  {busy ? "Sending..." : "Send request"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

export function BusinessPeoplePanel({
  businessId,
  business,
  rows,
  loading = false,
  error: rowsError = "",
  canManageStaff = true,
  runAction,
  toast,
}: BusinessPeoplePanelProps) {
  const [draft, setDraft] = useState<StaffDraft>(emptyStaffDraft);
  const [formOpen, setFormOpen] = useState(false);
  const {busy, busyLabel, error, run} = useActionFeedback(runAction, toast);
  const businessName = text(business?.name, businessId || "this business");

  function update(patch: Partial<StaffDraft>) {
    setDraft((current) => ({...current, ...patch}));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(
      "Business staff invitation sent",
      async () => {
        if (!businessId) throw new Error("Business account is not configured.");
        if (!draft.fullName.trim()) throw new Error("Enter a staff name.");
        if (!draft.email.trim()) throw new Error("Enter a staff email.");

        try {
          await httpsCallable(functions, "inviteBusinessMember")({
            businessId,
            fullName: draft.fullName.trim(),
            email: draft.email.trim().toLowerCase(),
            businessPermissions: draft.businessPermissions,
            locale: document.documentElement.lang.startsWith("fr") ? "fr" : "en",
          });
        } catch (submitError) {
          throw new Error(inviteStaffErrorMessage(submitError));
        }
        setDraft(emptyStaffDraft);
        setFormOpen(false);
      },
      {
        confirm:
          "Send this staff invitation with the selected permissions?",
        confirmFr:
          "Envoyer cette invitation d’employé avec les autorisations sélectionnées ?",
      },
    );
  }

  async function saveStaffPermissions(row: FirestoreRow) {
    await run(
      "Staff permissions saved",
      async () => {
        await httpsCallable(functions, "updateBusinessStaffPermissions")({
          businessId,
          staffUid: row.id,
          businessPermissions: rowPermissions(row),
        });
      },
      {
        confirm:
          `Save permission changes for ${text(row.fullName ?? row.email, row.id)}?`,
        confirmFr:
          `Enregistrer les changements d’autorisations pour ${text(row.fullName ?? row.email, row.id)} ?`,
      },
    );
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>People</h2>
          <p>{rows.length === 0 ? `Owners and staff linked to ${businessName}.` : `${rows.length} team member${rows.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="lst-head-actions">
          {busy && <span className="pur-kind">{busyLabel || "Working..."}</span>}
          {canManageStaff && (
            <button className="lst-add" type="button" disabled={!businessId} onClick={() => { setDraft(emptyStaffDraft); setFormOpen(true); }}>
              <UserPlus size={16} /> Invite staff
            </button>
          )}
        </div>
      </header>

      {(error || rowsError) && <div className="error-box">{error || rowsError}</div>}

      {loading && <div className="lst-empty"><p>Loading…</p></div>}
      {!loading && rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Users size={30} /></div>
          <h3>No team members yet</h3>
          <p>Invite staff and choose what each person can manage.</p>
          {canManageStaff && <button className="lst-add" type="button" disabled={!businessId} onClick={() => setFormOpen(true)}><UserPlus size={16} /> Invite staff</button>}
        </div>
      )}

      <div className="pur-grid">
        {rows.map((row) => (
          <StaffRow
            key={`${row._path ?? row.id}`}
            canManageStaff={canManageStaff}
            row={row}
            saving={busy}
            savePermissions={saveStaffPermissions}
            setPermissions={(permissions) => { row.businessPermissions = permissions; }}
          />
        ))}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => setFormOpen(false)}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Invite staff</h3>
              <button className="lst-icon-btn" type="button" onClick={() => setFormOpen(false)} aria-label="Close">✕</button>
            </header>
            <form id="business-people-form" onSubmit={submit}>
              <div className="lst-modal-body">
                {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}
                <div className="info-band" style={{ marginBottom: 14 }}>This person will set their own password from an expiring email invitation for {businessName}.</div>
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Full name</span>
                    <input autoComplete="name" required value={draft.fullName} onChange={(event) => update({ fullName: event.target.value })} />
                  </label>
                  <label className="lst-field"><span>Email</span>
                    <input autoComplete="username" inputMode="email" required type="email" value={draft.email} onChange={(event) => update({ email: event.target.value })} />
                  </label>
                  <div className="lst-form-section">Permissions — what this staff member can manage</div>
                  <div className="lst-chips wide">
                    {businessPermissionOptions.map((permission) => {
                      const on = draft.businessPermissions.includes(permission.id);
                      return (
                        <button key={permission.id} type="button" className={`lst-chip ${on ? "on" : ""}`} onClick={() => update({ businessPermissions: togglePermission(draft.businessPermissions, permission.id, !on) })}>
                          {permission.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <footer className="lst-modal-foot">
                <button className="lst-btn ghost" type="button" onClick={() => setFormOpen(false)}>Cancel</button>
                <button className="lst-add" type="submit" disabled={busy || !businessId}>
                  {busy ? <RefreshCw className="spin" size={16} /> : <UserPlus size={16} />}
                  {busy ? "Sending..." : "Send invitation"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function StaffRow({
  row,
  canManageStaff,
  saving,
  setPermissions,
  savePermissions,
}: {
  row: FirestoreRow;
  canManageStaff: boolean;
  saving: boolean;
  setPermissions: (permissions: string[]) => void;
  savePermissions: (row: FirestoreRow) => Promise<void>;
}) {
  const [permissions, setLocalPermissions] = useState<string[]>(() =>
    rowPermissions(row),
  );

  useEffect(() => {
    setLocalPermissions(rowPermissions(row));
  }, [row]);

  function toggle(id: string, checked: boolean) {
    const next = togglePermission(permissions, id, checked);
    setLocalPermissions(next);
    setPermissions(next);
  }

  const role = text(row.role, "staff");
  const isOwner = role === "businessOwner";
  return (
    <article className="pur-card">
      <div className="pur-head">
        <div className="pur-title">
          <strong>{text(row.fullName ?? row.email, "Team member")}</strong>
          <span className="pur-kind">{staffContact(row)}</span>
        </div>
        <span className={`lst-badge ${isOwner ? "navy" : "ok"}`}>{isOwner ? "Owner" : "Staff"}</span>
      </div>
      {role === "staff" ? (
        <>
          <div className="lst-form-section" style={{ marginTop: 0 }}>Can manage</div>
          <div className="lst-chips">
            {businessPermissionOptions.map((permission) => {
              const on = permissions.includes(permission.id);
              return (
                <button
                  key={permission.id}
                  type="button"
                  className={`lst-chip ${on ? "on" : ""}`}
                  disabled={!canManageStaff}
                  onClick={() => toggle(permission.id, !on)}
                >
                  {permission.label}
                </button>
              );
            })}
          </div>
          {canManageStaff && (
            <div className="pur-actions">
              <button className="lst-btn" type="button" disabled={saving} onClick={() => savePermissions(row)}>
                {saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}
                {saving ? "Saving..." : "Save permissions"}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="pur-reliability">Full access to this business workspace.</div>
      )}
    </article>
  );
}

function inviteStaffErrorMessage(error: unknown) {
  const reason =
    error && typeof error === "object" && "details" in error ?
      String(
          (error as {details?: {reason?: unknown}}).details?.reason ?? "",
      ) :
      "";
  if (reason === "existing-authority-conflict") {
    return "This person already has staff or admin access somewhere in " +
      "the system. Remove their existing access first, then invite them " +
      "again.";
  }
  if (reason === "invitation-already-pending") {
    return "There's already a pending invitation for this person. " +
      "Resend or cancel it instead of sending a new one.";
  }
  return error instanceof Error && error.message ?
    error.message :
    "The invitation could not be sent. Try again.";
}

function useActionFeedback(runAction?: ActionRunner, toast?: ToastCallback) {
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState("");

  async function run(
    label: string,
    action: () => Promise<unknown>,
    options?: ActionConfirmationOptions,
  ) {
    if (busy) return;
    setBusy(true);
    setBusyLabel(label);
    setError("");
    try {
      if (runAction) {
        await runAction(label, action, options);
      } else {
        await action();
        toast?.("success", label);
      }
    } catch (rawError) {
      const message = rawError instanceof Error ? rawError.message : String(rawError);
      setError(message);
      toast?.("error", message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return {busy, busyLabel, error, run};
}

function optionalBusinessText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function profileDraftFromBusiness(business?: FirestoreRow | null): ProfileDraft {
  const services = Array.isArray(business?.enabledServices)
    ? business?.enabledServices.map((item) => text(item, "")).filter(Boolean)
    : serviceOptions.map((option) => option.id);
  return {
    name: optionalBusinessText(business?.name),
    phone: optionalBusinessText(business?.phone),
    email: optionalBusinessText(business?.email),
    website: optionalBusinessText(business?.website),
    serviceNote: optionalBusinessText(business?.serviceNote),
    enabledServices: services.length ? services : serviceOptions.map((option) => option.id),
    carHoldPricingMode: business?.carHoldPricingMode === "per_day" ? "per_day" : "flat",
    carHoldFlatFee: numberText(business?.carHoldFlatFee, "500"),
    carHoldDailyRate: numberText(business?.carHoldDailyRate, "100"),
    carHoldMaxDays: numberText(business?.carHoldMaxDays, "14"),
    freightPickupAvailable: business?.freightPickupAvailable === true,
    freightPickupModel:
      business?.freightPickupModel === "borough" && isNewYorkState(business?.state)
        ? "borough"
        : "distance",
    freightPickupBaseFee: numberText(business?.freightPickupBaseFee, ""),
    freightPickupPerKm: numberText(business?.freightPickupPerKm, ""),
    freightPickupMinFee: numberText(business?.freightPickupMinFee, ""),
    freightPickupMaxKm: numberText(business?.freightPickupMaxKm, ""),
    freightPickupOriginAddress: optionalBusinessText(business?.freightPickupOriginAddress),
    freightPickupBoroughPrices: boroughPricesToText(business?.freightPickupBoroughPrices),
    profileImageUrl: optionalBusinessText(business?.profileImageUrl),
    profileImagePath: optionalBusinessText(business?.profileImagePath),
  };
}

function boroughPricesToText(value: unknown): Record<string, string> {
  const prices: Record<string, string> = {};
  if (value && typeof value === "object") {
    for (const borough of NYC_BOROUGHS) {
      const raw = (value as Record<string, unknown>)[borough];
      if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
        prices[borough] = String(raw);
      }
    }
  }
  return prices;
}

function numberText(value: unknown, fallback: string) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

async function uploadBusinessProfileImage(businessId: string, file: File) {
  const path = `businesses/${businessId}/profile/${Date.now()}-${safeFileName(file.name, "profile-image.jpg")}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, file, {contentType: file.type || "image/jpeg"});
  const url = await getDownloadURL(target);
  return {path, url};
}

async function uploadBusinessVerificationDocument(
  businessId: string,
  documentId: string,
  file: File,
) {
  const base64 = await fileToBase64(file);
  const result = await httpsCallable(functions, "uploadBusinessVerificationDocument")({
    businessId,
    documentId,
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    base64,
  });
  const data = result.data as { success?: boolean; path?: string; url?: string };
  return {
    success: data.success === true,
    path: text(data.path, ""),
    url: text(data.url, ""),
  };
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const [, base64 = ""] = result.split(",", 2);
      if (!base64) {
        reject(new Error("Document upload payload is required."));
        return;
      }
      resolve(base64);
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Document upload failed."));
    });
    reader.readAsDataURL(file);
  });
}

function isAllowedVerificationFile(file: File) {
  if (file.size <= 0 || file.size >= verificationMaxBytes) return false;
  const type = file.type || "application/octet-stream";
  return verificationUploadTypes.some((allowed) => {
    if (allowed.endsWith("/")) return type.startsWith(allowed);
    return type === allowed;
  });
}

function safeFileName(name: string, fallback: string) {
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  return normalized || fallback;
}

function businessVerificationReviewNote(business: FirestoreRow) {
  const review = business.verificationReview;
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    return optionalBusinessText(business.reviewNote);
  }
  return (
    optionalBusinessText((review as Record<string, unknown>).note) ||
    optionalBusinessText(business.reviewNote)
  );
}

function statusBadgeClass(status: unknown) {
  const value = text(status, "").toLowerCase();
  if (value === "verified" || value === "not_applicable") return "ok";
  if (value === "submitted") return "navy";
  if (value === "missing" || value === "needs_changes") return "warn";
  return "muted";
}

function rowPermissions(row: FirestoreRow) {
  return Array.isArray(row.businessPermissions)
    ? row.businessPermissions.map((item) => text(item, "")).filter(Boolean)
    : businessPermissionOptions.map((option) => option.id);
}

function togglePermission(values: string[], permission: string, enabled: boolean) {
  if (enabled) return Array.from(new Set([...values, permission]));
  return values.filter((value) => value !== permission);
}

function staffContact(row: FirestoreRow) {
  const email = text(row.email, "");
  const phone = text(row.phone, "");
  if (email && phone) return `${email} - ${phone}`;
  return email || phone || "Contact not set";
}

function statusLabel(value: unknown) {
  return text(value, "unknown")
      .split(/[_-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function isOpenStatus(value: unknown) {
  const status = text(value, "").toLowerCase();
  return !["", "completed", "cancelled", "sold", "inactive", "refunded", "rejected", "resolved", "closed"].includes(status);
}
