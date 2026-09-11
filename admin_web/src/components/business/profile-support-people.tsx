"use client";

import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { nextParkingRateId } from "@/lib/parking-rates";
import { httpsCallable } from "firebase/functions";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Building2,
  Car,
  Check,
  Clock,
  FileText,
  ImageUp,
  LifeBuoy,
  Package,
  ParkingCircle,
  Plane,
  Plus,
  RefreshCw,
  Save,
  Send,
  Ship,
  Trash2,
  Truck,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";

import { FieldInfo } from "@/components/field-info";
import { SearchableSelect } from "@/components/searchable-select";
import {
  accessInvitationDeliveryNote,
  accessInvitationExpiryLine,
  accessInvitationRowsFrom,
  accessInvitationSentLine,
  accessInvitationStatusLabel,
  accessInvitationStatusTone,
  canActOnAccessInvitation,
  type AccessInvitationLine,
  type AccessInvitationRow,
} from "@/lib/access-invitations";
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
  PICKUP_PLAN_SERVICES,
  PICKUP_SERVICE_BY_BUSINESS_SERVICE,
  PICKUP_SERVICE_LABELS,
  pickupPlanFieldErrors,
  pickupPlanSummary,
  pickupServiceState,
  validateBusinessServiceSettings,
  type BusinessServiceId,
  type BusinessServiceSettingsDraft,
  type PickupConfigDraft,
  type PickupMode,
  type PickupPlanServiceId,
  type PickupServiceChoice,
} from "@/lib/business-service-settings";
import { COUNTRY_CATALOG } from "@/lib/country-catalog";
import {
  MAX_CUSTOM_FREIGHT_CATEGORIES,
  STANDARD_FREIGHT_CATEGORIES,
  type FreightPaybackCategoryDraft,
  type FreightPaybackItemDraft,
  type FreightPaybackPricingMode,
  resolvedFreightCategoryId,
  emptyFreightCustomCategory,
  emptyFreightPaybackCategory,
  emptyFreightPaybackItem,
  type FreightCustomCategoryDraft,
  type FreightSettingsDraft,
} from "@/lib/freight-categories";
import {
  MAX_INCLUDED_KG,
  MAX_ITEM_FLAT_PRICE,
  STANDARD_FREIGHT_ITEMS,
} from "@/lib/freight-payback";
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
  addressLine1: string;
  city: string;
  country: string;
  state: string;
  postalCode: string;
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
  {id: "ledger", label: "Lot ledger"},
  {id: "destinations", label: "Services & coverage"},
  {id: "people", label: "People"},
  {id: "reviews", label: "Reviews"},
  {id: "support", label: "Support"},
  {id: "growth", label: "Growth"},
];

// Which service must be active before a permission actually does anything.
// Not enforced server-side and not disabled here - a business can still grant
// this ahead of turning the service on, so staff already have access the
// moment it goes live instead of needing a second invite/edit round trip.
const businessPermissionRequiredService: Partial<Record<string, string>> = {
  barrels: "barrelShipping",
  freight: "freight",
  transport: "carTransport",
  parking: "carParking",
  ledger: "carParking",
  listings: "carSales",
  purchases: "carSales",
};

function businessOffersService(
  business: FirestoreRow | null | undefined,
  serviceId: string,
) {
  const services = Array.isArray(business?.enabledServices) ?
    business.enabledServices.map((item) => text(item, "")) :
    [];
  return services.includes(serviceId);
}

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
  const {busy, busyLabel, error, success, run} = useActionFeedback(runAction, toast);

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
        if (!draft.addressLine1.trim() || !draft.city.trim() || !draft.country.trim()) {
          throw new Error("A complete headquarters address is required (street, city, and country).");
        }
        if (draft.country.trim() === "United States" && !draft.state.trim()) {
          throw new Error("A US state is required for a United States headquarters address.");
        }

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
          addressLine1: draft.addressLine1.trim(),
          city: draft.city.trim(),
          country: draft.country.trim(),
          state: draft.country.trim() === "United States" ? draft.state.trim() : "",
          postalCode: draft.postalCode.trim(),
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
      {success && !error && <div className="success-box">{success}</div>}
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
        <HeadquartersAddressFields
          draft={draft}
          onCity={(city) => update("city", city)}
          onCountry={(country) =>
            setDraft((current) => ({
              ...current,
              country,
              state: "",
              city: "",
            }))
          }
          onPostalCode={(postalCode) => update("postalCode", postalCode)}
          onState={(state) =>
            setDraft((current) => ({
              ...current,
              state,
              city: "",
            }))
          }
          onStreet={(addressLine1) => update("addressLine1", addressLine1)}
        />
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

function HeadquartersAddressFields({
  draft,
  onCity,
  onCountry,
  onPostalCode,
  onState,
  onStreet,
}: {
  draft: ProfileDraft;
  onCity: (city: string) => void;
  onCountry: (country: string) => void;
  onPostalCode: (postalCode: string) => void;
  onState: (state: string) => void;
  onStreet: (addressLine1: string) => void;
}) {
  const isUnitedStates = draft.country.trim() === "United States";
  const language = currentWebLanguage() === "fr" ? "fr" : "en";
  const countryOptions = useMemo(() => {
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
  const cityOptions = [
    ...(CITIES_BY_STATE[draft.state] ?? []),
    ...(
      draft.city &&
      !(CITIES_BY_STATE[draft.state] ?? []).includes(draft.city)
        ? [draft.city]
        : []
    ),
  ].map((city) => ({label: city, value: city}));

  return (
    <div className="lst-form-grid">
      <div className="lst-form-section">Headquarters address</div>
      <p className="card-sub" style={{gridColumn: "1 / -1", margin: 0}}>
        This is the default drop-off address for customers. Extra office
        locations are optional.
      </p>
      <label className="lst-field wide">
        <span>Business street address</span>
        <input
          autoComplete="street-address"
          onChange={(event) => onStreet(event.target.value)}
          required
          value={draft.addressLine1}
        />
      </label>
      <SearchableSelect
        className="lst-field"
        emptyMessage="No countries match your search."
        label="Country"
        listLabel="Headquarters country options"
        onChange={onCountry}
        options={countryOptions}
        placeholder="Search or choose a country"
        value={draft.country}
      />
      {isUnitedStates ? (
        <SearchableSelect
          className="lst-field"
          emptyMessage="No states match your search."
          label="State"
          listLabel="Headquarters state options"
          onChange={onState}
          options={parkingStateOptions}
          placeholder="Search or choose a state"
          value={draft.state}
        />
      ) : (
        <label className="lst-field">
          <span>State or region</span>
          <input
            onChange={(event) => onState(event.target.value)}
            value={draft.state}
          />
        </label>
      )}
      {isUnitedStates && draft.state ? (
        <SearchableSelect
          className="lst-field"
          emptyMessage="No cities match your search."
          label="City"
          listLabel="Headquarters city options"
          onChange={onCity}
          options={cityOptions}
          placeholder="Search or choose a city"
          value={draft.city}
        />
      ) : (
        <label className="lst-field">
          <span>City</span>
          <input
            onChange={(event) => onCity(event.target.value)}
            required
            value={draft.city}
          />
        </label>
      )}
      <label className="lst-field">
        <span>Postal code</span>
        <input
          autoComplete="postal-code"
          onChange={(event) => onPostalCode(event.target.value)}
          required={isUnitedStates}
          value={draft.postalCode}
        />
      </label>
    </div>
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
  const {busy, busyLabel, error, success, run} = useActionFeedback(runAction, toast);
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

  function updatePickupShared(patch: Partial<PickupConfigDraft>) {
    setDraft((current) => ({
      ...current,
      pickupShared: {...current.pickupShared, ...patch},
    }));
  }

  function updatePickupSharedBorough(borough: string, value: string) {
    setDraft((current) => ({
      ...current,
      pickupShared: {
        ...current.pickupShared,
        boroughPrices: {
          ...current.pickupShared.boroughPrices,
          [borough]: value,
        },
      },
    }));
  }

  function updatePickupServiceChoice(
    service: PickupPlanServiceId,
    choice: PickupServiceChoice,
  ) {
    setDraft((current) => ({
      ...current,
      pickupServices: {
        ...current.pickupServices,
        [service]: {...current.pickupServices[service], choice},
      },
    }));
  }

  function updatePickupServiceConfig(
    service: PickupPlanServiceId,
    patch: Partial<PickupConfigDraft>,
  ) {
    setDraft((current) => ({
      ...current,
      pickupServices: {
        ...current.pickupServices,
        [service]: {
          ...current.pickupServices[service],
          config: {...current.pickupServices[service].config, ...patch},
        },
      },
    }));
  }

  function updatePickupServiceBorough(
    service: PickupPlanServiceId,
    borough: string,
    value: string,
  ) {
    setDraft((current) => {
      const entry = current.pickupServices[service];
      return {
        ...current,
        pickupServices: {
          ...current.pickupServices,
          [service]: {
            ...entry,
            config: {
              ...entry.config,
              boroughPrices: {
                ...entry.config.boroughPrices,
                [borough]: value,
              },
            },
          },
        },
      };
    });
  }

  function updateFreight(patch: Partial<FreightSettingsDraft>) {
    setDraft((current) => ({...current, freight: {...current.freight, ...patch}}));
  }

  function updateCustomCategory(
    index: number,
    patch: Partial<FreightCustomCategoryDraft>,
  ) {
    setDraft((current) => ({
      ...current,
      freight: {
        ...current.freight,
        customCategories: current.freight.customCategories.map((row, position) =>
          position === index ? {...row, ...patch} : row,
        ),
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
  const offersParking = draft.enabledServices.includes("carParking");
  const offersFreight = draft.enabledServices.includes("freight");
  const businessIsNewYork = isNewYorkState(business?.state);
  const enabledPickupServices = PICKUP_PLAN_SERVICES.filter((service) =>
    draft.enabledServices.some(
      (id) =>
        PICKUP_SERVICE_BY_BUSINESS_SERVICE[id as BusinessServiceId] ===
        service,
    ),
  );
  const offersPickup = enabledPickupServices.length > 0;
  const pickupSummary = pickupPlanSummary(draft, enabledPickupServices);
  const pickupErrors = pickupPlanFieldErrors(draft, {
    isNewYorkBusiness: businessIsNewYork,
  });

  // Built from what the business offers, so a tab never appears for a service
  // that is switched off, and turning one on makes its rules reachable without
  // anything else changing.
  const ruleTabs = useMemo(() => {
    const tabs: Array<{id: string; label: string; hint: string}> = [];
    if (offersCarSales) {
      tabs.push({id: "carSales", label: "Car sales", hint: "Paid holds"});
    }
    if (offersFreight) {
      tabs.push({id: "freight", label: "Freight", hint: "What you carry"});
    }
    if (offersParking) {
      tabs.push({id: "parking", label: "Car parking", hint: "Facility"});
    }
    if (offersPickup) {
      tabs.push({id: "pickup", label: "Home pickup", hint: "All services"});
    }
    return tabs;
  }, [offersCarSales, offersFreight, offersParking, offersPickup]);

  const [activeRuleTab, setActiveRuleTab] = useState("");
  // Keep the selection valid: a business that turns off the service it was
  // looking at would otherwise be left staring at an empty panel.
  useEffect(() => {
    if (ruleTabs.length === 0) return;
    if (!ruleTabs.some((tab) => tab.id === activeRuleTab)) {
      setActiveRuleTab(ruleTabs[0].id);
    }
  }, [ruleTabs, activeRuleTab]);

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
      {success && !error && <div className="success-box">{success}</div>}
      {!canManage && (
        <div className="customer-inline-note">
          You can review these settings. Only the business owner can change
          service availability and pricing.
        </div>
      )}

      {/* noValidate: native browser validation on hidden/other sections
          (e.g. parking min=1) blocks submit with only a transient bubble;
          validateBusinessServiceSettings surfaces real, visible errors. */}
      <form
        className="service-settings-form"
        id="business-service-settings-form"
        noValidate
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

          {(offersCarSales || offersPickup || offersParking || offersFreight) && (
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

          {/* One group at a time. These four cards used to stack into a single
              scroll, so a business changing its freight prices scrolled past
              hold fees, pickup rules and parking capacity to reach them - and
              the card it wanted was the one furthest down. Tabs are built from
              what the business actually offers, so a service that is switched
              off never shows one. */}
          <div
            aria-label="Service rules"
            className="service-segments service-rule-tabs"
            role="tablist"
          >
            {/* Spans rather than buttons, for the same reason FieldInfo uses
                one: this panel wraps its form in a disabled fieldset for
                read-only viewers, and a disabled fieldset disables every
                descendant form control. As buttons these tabs stopped working
                for exactly the people who can only read - leaving them worse
                off than the single scroll this replaced. Choosing what to look
                at is navigation, not editing. */}
            {ruleTabs.map((tab) => (
              <span
                aria-selected={activeRuleTab === tab.id}
                className={`segment ${activeRuleTab === tab.id ? "active" : ""}`}
                key={tab.id}
                onClick={() => setActiveRuleTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setActiveRuleTab(tab.id);
                }}
                role="tab"
                tabIndex={0}
              >
                <span>{tab.label}</span>
                <small>{tab.hint}</small>
              </span>
            ))}
          </div>

          <div className="service-config-grid">
            {offersCarSales && activeRuleTab === "carSales" && (
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

            {offersPickup && activeRuleTab === "pickup" && (
              <article className="service-config-card service-config-card-wide">
                <header className="service-config-card-head">
                  <span className="service-config-icon"><Truck size={21} /></span>
                  <div>
                    <strong>Home pickup</strong>
                    <span>
                      Collecting items from the customer&rsquo;s address
                      instead of them bringing it to you. Each service either
                      follows your shared plan or sets its own.
                    </span>
                  </div>
                </header>

                {/* What the server will actually do, stated once. Working it
                    out otherwise means cross-referencing the shared toggle
                    against four dropdowns - and getting it wrong in the one
                    direction that matters, since a service with its own
                    settings keeps taking pickups whatever the shared plan
                    says. */}
                <div className="lst-form-grid service-config-fields">
                  <p className="customer-inline-note wide">
                    {pickupSummary.taking.length > 0 ? (
                      <>
                        <strong>Taking pickups:</strong>{" "}
                        {pickupSummary.taking.join(", ")}.{" "}
                      </>
                    ) : (
                      <>
                        <strong>No service is taking pickups.</strong>{" "}
                        Customers bring everything to you.{" "}
                      </>
                    )}
                    {pickupSummary.notTaking.length > 0 && (
                      <>
                        Customers bring these to you:{" "}
                        {pickupSummary.notTaking.join(", ")}.
                      </>
                    )}
                  </p>
                </div>

                <div className="lst-form-grid service-config-fields">
                  <div className="wide">
                    <label className="customer-choice-row">
                      <input
                        checked={draft.pickupEnabled}
                        onChange={() =>
                          update("pickupEnabled", !draft.pickupEnabled)
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Use one shared plan</strong>
                        <small>
                          Services set to &ldquo;follow the shared
                          plan&rdquo; below are priced by these settings.
                        </small>
                      </span>
                    </label>
                  </div>
                  {draft.pickupEnabled && (
                    <>
                      <PickupConfigEditor
                        config={draft.pickupShared}
                        isNewYork={businessIsNewYork}
                        onBorough={updatePickupSharedBorough}
                        onChange={updatePickupShared}
                      />
                      {pickupErrors.shared && (
                        <p className="customer-inline-note error wide">
                          {pickupErrors.shared}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="lst-form-grid service-config-fields">
                  <p className="service-config-note wide">
                    Each service, one at a time
                  </p>
                  {enabledPickupServices.map((service) => {
                    const entry = draft.pickupServices[service];
                    const state = pickupServiceState(draft, service);
                    return (
                      <div
                        className="lst-form-grid wide pickup-service-block"
                        key={service}
                      >
                        <label className="lst-field">
                          <span>{PICKUP_SERVICE_LABELS[service]}</span>
                          <select
                            onChange={(event) =>
                              updatePickupServiceChoice(
                                service,
                                event.target.value === "custom"
                                  ? "custom"
                                  : event.target.value === "off"
                                    ? "off"
                                    : "inherit",
                              )
                            }
                            value={entry.choice}
                          >
                            <option value="inherit">
                              Follow the shared plan
                            </option>
                            <option value="custom">
                              Set its own pickup fees
                            </option>
                            <option value="off">
                              No pickup for this service
                            </option>
                          </select>
                          {/* Following a plan that is switched off reads as
                              "configured" but means no pickup at all. */}
                          {state.reason === "shared-plan-off" && (
                            <small className="field-error">
                              No pickup: the shared plan above is off. Turn
                              it on, or give this service its own fees.
                            </small>
                          )}
                          {state.reason === "own-settings" &&
                            !draft.pickupEnabled && (
                            <small>
                              Takes pickups on these fees, whether or not the
                              shared plan is on.
                            </small>
                          )}
                        </label>
                        {entry.choice === "custom" && (
                          <>
                            <PickupConfigEditor
                              config={entry.config}
                              isNewYork={businessIsNewYork}
                              onBorough={(borough, value) =>
                                updatePickupServiceBorough(
                                  service,
                                  borough,
                                  value,
                                )
                              }
                              onChange={(patch) =>
                                updatePickupServiceConfig(service, patch)
                              }
                            />
                            {pickupErrors.services[service] && (
                              <p className="customer-inline-note error wide">
                                {pickupErrors.services[service]}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

            {offersFreight && activeRuleTab === "freight" && (
              <FreightGoodsEditor
                draft={draft.freight}
                onAddCategory={() =>
                  updateFreight({
                    customCategories: [
                      ...draft.freight.customCategories,
                      emptyFreightCustomCategory(),
                    ],
                  })
                }
                onChange={updateFreight}
                onCustomCategory={updateCustomCategory}
                onRemoveCategory={(index) =>
                  updateFreight({
                    customCategories: draft.freight.customCategories.filter(
                      (_, position) => position !== index,
                    ),
                  })
                }
              />
            )}

            {offersParking && activeRuleTab === "parking" && (
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
                  <div className="lst-field wide pk-rates">
                    <span>Other prices (optional)</span>
                    <p className="lst-hint" style={{ margin: "0 0 6px" }}>
                      A bigger space, a long-stay deal, a rate for a dealer who
                      brings several cars. Give each one a name and a price per
                      day; staff pick it when they record a car. A row without a
                      name and a price is not saved.
                    </p>
                    {draft.parkingRates.length > 0 && (
                      <div className="pk-rate-head">
                        <span>Name</span>
                        <span>Price / day ($)</span>
                        <span>Min days</span>
                        <span />
                      </div>
                    )}
                    {draft.parkingRates.map((rate, index) => (
                      <div className="pk-rate-row" key={rate.id}>
                        <input
                          aria-label="Price name"
                          placeholder="e.g. SUV / oversize"
                          value={rate.label}
                          onChange={(event) => update(
                            "parkingRates",
                            draft.parkingRates.map((row, i) => i === index
                              ? { ...row, label: event.target.value }
                              : row),
                          )}
                        />
                        <input
                          aria-label="Daily rate"
                          inputMode="decimal"
                          min="0"
                          placeholder="e.g. 30"
                          type="number"
                          value={rate.dailyRate || ""}
                          onChange={(event) => update(
                            "parkingRates",
                            draft.parkingRates.map((row, i) => i === index
                              ? { ...row, dailyRate: Number(event.target.value) || 0 }
                              : row),
                          )}
                        />
                        <input
                          aria-label="Minimum days"
                          inputMode="numeric"
                          min="1"
                          placeholder="1"
                          type="number"
                          value={rate.minimumDays || ""}
                          onChange={(event) => update(
                            "parkingRates",
                            draft.parkingRates.map((row, i) => i === index
                              ? { ...row, minimumDays: Math.max(1, Math.trunc(Number(event.target.value) || 1)) }
                              : row),
                          )}
                        />
                        <button
                          className="lst-btn ghost"
                          type="button"
                          title="Remove this price"
                          aria-label={`Remove ${rate.label || "this price"}`}
                          onClick={() => update(
                            "parkingRates",
                            draft.parkingRates.filter((_, i) => i !== index),
                          )}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      className="lst-btn ghost"
                      type="button"
                      onClick={() => update("parkingRates", [
                        ...draft.parkingRates,
                        {
                          id: nextParkingRateId(draft.parkingRates),
                          label: "",
                          dailyRate: 0,
                          weeklyRate: 0,
                          monthlyRate: 0,
                          minimumDays: 0,
                        },
                      ])}
                    >
                      <Plus size={14} /> Add a price
                    </button>
                  </div>
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
                  <div className="wide">
                    <label className="customer-choice-row">
                      <input
                        checked={draft.parkingAcceptsReservations}
                        onChange={() =>
                          update(
                            "parkingAcceptsReservations",
                            !draft.parkingAcceptsReservations,
                          )
                        }
                        type="checkbox"
                      />
                      <span>
                        <strong>Accept online reservations from customers</strong>
                        <small>
                          Off makes this a walk-in-only lot: it still shows in
                          customer search so people can find and contact you,
                          but they can&rsquo;t book or pay online — you record
                          every car yourself.
                        </small>
                      </span>
                    </label>
                  </div>
                </div>
              </article>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  );
}

/**
 * What a business charges for each kind of goods, and whether it pays for a
 * parcel it loses.
 *
 * Two settings, one card, because they answer the same question for the owner:
 * "what am I willing to carry, and at what price." They stay separate for the
 * customer - the category says what is in the box, cover says whether this
 * business stands behind it - but an owner sets them in one sitting.
 */
function FreightGoodsEditor({
  draft,
  onAddCategory,
  onChange,
  onCustomCategory,
  onRemoveCategory,
}: {
  draft: FreightSettingsDraft;
  onAddCategory: () => void;
  onChange: (patch: Partial<FreightSettingsDraft>) => void;
  onCustomCategory: (
    index: number,
    patch: Partial<FreightCustomCategoryDraft>,
  ) => void;
  onRemoveCategory: (index: number) => void;
}) {
  const roomForMore =
    draft.customCategories.length < MAX_CUSTOM_FREIGHT_CATEGORIES;

  return (
    <article className="service-config-card service-config-card-wide">
      <header className="service-config-card-head">
        <span className="service-config-icon"><Package size={21} /></span>
        <div>
          <strong>Freight · what you carry</strong>
          <span>
            Price each kind of goods, and say whether you pay for a parcel you
            lose.
          </span>
        </div>
      </header>
      <div className="lst-form-grid service-config-fields">
        <p className="service-config-note wide">
          <span className="label-with-info">
            Item categories
            <FieldInfo label="how item categories work">
              <p>
                Categories are how a customer finds the thing they are
                sending. The list is the platform&rsquo;s, so a customer can
                compare you with another business on the same words.
              </p>
              <p>
                What each thing costs is set on the item itself, under
                &ldquo;What you carry, and what it costs&rdquo; below.
              </p>
            </FieldInfo>
          </span>
        </p>
        <p className="service-config-note wide">
          <span className="label-with-info">
            Your own categories
            <FieldInfo label="when to add a category of your own">
              <p>
                Add one only for goods the standard list genuinely misses -
                auto parts, building materials, live plants.
              </p>
              <p>
                Customers see your extra rows after the standard ones. Up to 6.
              </p>
            </FieldInfo>
          </span>
        </p>
        {draft.customCategories.map((row, index) => (
          <div className="lst-form-grid wide" key={`custom-${index}`}>
            <label className="lst-field">
              <span>Category name</span>
              <input
                maxLength={60}
                onChange={(event) =>
                  onCustomCategory(index, {label: event.target.value})
                }
                placeholder="e.g. Auto parts"
                type="text"
                value={row.label}
              />
            </label>
            <label className="lst-field wide">
              <span>What it covers</span>
              <input
                maxLength={120}
                onChange={(event) =>
                  onCustomCategory(index, {hint: event.target.value})
                }
                placeholder="Shown to the customer under the name"
                type="text"
                value={row.hint}
              />
            </label>
            <div className="lst-field wide">
              <button
                className="ghost-button"
                onClick={() => onRemoveCategory(index)}
                type="button"
              >
                Remove this category
              </button>
            </div>
          </div>
        ))}
        <div className="lst-field wide">
          <button
            className="secondary-button"
            disabled={!roomForMore}
            onClick={onAddCategory}
            type="button"
          >
            <Plus size={15} /> Add a category
          </button>
          {!roomForMore && (
            <small>You can add up to 6 categories of your own.</small>
          )}
        </div>

        <p className="service-config-note wide">
          <span className="label-with-info">
            If a parcel is lost
            <FieldInfo label="how cover for a lost parcel works">
              <p>
                Nothing extra is charged for this. You price each item above
                according to what it is worth to carry, so the risk is
                already in your rate.
              </p>
              <p>
                If you cover parcels and one goes missing, you make good on
                it with the customer. If you do not cover them, the customer
                gets nothing back, and they are told so before they book.
              </p>
            </FieldInfo>
          </span>
        </p>
        {draft.coversLoss && (
          <div className="customer-inline-note wide">
            You make good on the parcel, not Laawol, and the policy in force
            on the day the customer booked is the one that is judged.
          </div>
        )}
        <label className="lst-field">
          <span>Do you pay for a lost parcel?</span>
          <select
            onChange={(event) =>
              onChange({coversLoss: event.target.value === "yes"})
            }
            value={draft.coversLoss ? "yes" : "no"}
          >
            <option value="no">No, parcels are not covered</option>
            <option value="yes">Yes, I cover a parcel I lose</option>
          </select>
        </label>
        <label className="lst-field wide">
          <span className="label-with-info">
            Do customers pay you before shipping, or after arrival?
            <FieldInfo label="how pay-on-arrival works">
              <p>
                If you accept payment on arrival, customers of yours can
                choose it at booking. Their card is saved and verified up
                front - nothing is charged that day.
              </p>
              <p>
                When you mark the shipment arrived, Laawol charges that card
                automatically for the confirmed price. If the charge does
                not go through, the customer is told to pay in the app, and
                you decide whether to hand over the parcel before they do.
              </p>
            </FieldInfo>
          </span>
          <select
            onChange={(event) =>
              onChange({payOnArrival: event.target.value === "yes"})
            }
            value={draft.payOnArrival ? "yes" : "no"}
          >
            <option value="no">Before shipping only</option>
            <option value="yes">They may also pay on arrival</option>
          </select>
        </label>
        <div className="wide">
          <p className="service-config-note">
            <span className="label-with-info">
              What you carry, and what it costs
              <FieldInfo label="how the item list works">
                <p>
                  Each row says what you charge to carry that thing. An item
                  you have not listed cannot be booked instantly; the
                  customer asks you for a quote instead.
                </p>
                <p>
                  A known object can have a set price - &ldquo;iPhone 16,
                  $50&rdquo; - and the customer is never asked what it
                  weighs. Goods that vary every time are priced by weight at
                  your rate for the destination.
                </p>
                <p>
                  A row you list but never price behaves the same way as one
                  you never listed: the customer asks you for a price, and
                  you answer it under Price requests.
                </p>
                <p>
                  Cover is a separate question, answered once above for every
                  parcel you carry. The customer is charged nothing for it,
                  so price each row for what it is worth to you to carry.
                </p>
              </FieldInfo>
            </span>
          </p>
          <FreightPaybackEditor draft={draft} onChange={onChange} />
        </div>
      </div>
    </article>
  );
}

/**
 * How this business charges for one row.
 *
 * Two ways to charge, and the business picks per row because only it knows
 * which of its goods are which. A known object gets one price and never sees
 * a scale; goods that vary are weighed, and the weigh-and-confirm settlement
 * runs exactly as it does for every other parcel.
 *
 * `unpricedLabel` adds a third answer for a row that may legitimately have
 * none - the category catch-all, which exists only once someone prices it.
 * An item row is not offered it: the business added that row on purpose.
 */
function FreightRowPricingFields({
  onPatch,
  row,
  unpricedLabel,
}: {
  onPatch: (patch: {
    pricingMode?: FreightPaybackPricingMode;
    flatPrice?: string;
    includedKg?: string;
  }) => void;
  row: {
    pricingMode: FreightPaybackPricingMode;
    flatPrice: string;
    includedKg: string;
  };
  unpricedLabel?: string;
}) {
  // By weight is the business's own per-kg rate for the route, so choosing it
  // leaves nothing else to fill in.
  const flat = row.pricingMode === "flat";
  const selected = unpricedLabel
    ? row.pricingMode
    : flat
      ? "flat"
      : "per_kg";
  return (
    <div className="payback-pricing-row">
      <label className="lst-field">
        <span>How is this priced?</span>
        <select
          onChange={(event) => {
            const value = event.target.value;
            onPatch({
              pricingMode:
                value === "flat"
                  ? "flat"
                  : value === "per_kg"
                    ? "per_kg"
                    : "",
            });
          }}
          value={selected}
        >
          {unpricedLabel && <option value="">{unpricedLabel}</option>}
          <option value="flat">A set price</option>
          <option value="per_kg">By weight</option>
        </select>
      </label>
      {flat ? (
        <>
          <label className="lst-field">
            <span>Price (USD)</span>
            <input
              inputMode="decimal"
              max={MAX_ITEM_FLAT_PRICE}
              min="0"
              onChange={(event) => onPatch({flatPrice: event.target.value})}
              placeholder="e.g. 50"
              step="0.01"
              type="number"
              value={row.flatPrice}
            />
          </label>
          <label className="lst-field">
            <span className="label-with-info">
              Covers up to (kg)
              <FieldInfo label="what the included weight does">
                <p>
                  Leave this blank and your price covers the parcel however
                  heavy it is.
                </p>
                <p>
                  Give a weight and you weigh it at drop-off: anything over
                  that is charged at your per-kg rate for the destination, on
                  top of the price.
                </p>
              </FieldInfo>
            </span>
            <input
              inputMode="decimal"
              max={MAX_INCLUDED_KG}
              min="0"
              onChange={(event) => onPatch({includedKg: event.target.value})}
              placeholder="Any weight"
              step="0.1"
              type="number"
              value={row.includedKg}
            />
          </label>
        </>
      ) : null}
    </div>
  );
}

/**
 * The item list: per category, the things this business carries and what each
 * costs. The same rows double as the customer's item picker, so an empty list
 * here is an item nobody can instant-book.
 */
function FreightPaybackEditor({
  draft,
  onChange,
}: {
  draft: FreightSettingsDraft;
  onChange: (patch: Partial<FreightSettingsDraft>) => void;
}) {
  const categories = [
    ...STANDARD_FREIGHT_CATEGORIES.map((category) => ({
      id: category.id,
      label: category.label,
    })),
    ...draft.customCategories
      .filter((row) => row.label.trim())
      .map((row) => ({
        id: resolvedFreightCategoryId(row),
        label: row.label.trim(),
      })),
  ];

  function patchCategory(
    categoryId: string,
    patch: Partial<FreightPaybackCategoryDraft>,
  ) {
    const current =
      draft.payback[categoryId] ?? emptyFreightPaybackCategory();
    onChange({
      payback: {
        ...draft.payback,
        [categoryId]: {...current, ...patch},
      },
    });
  }

  return (
    <div className="payback-editor">
      {categories.map((category) => {
        const entry =
          draft.payback[category.id] ?? emptyFreightPaybackCategory();
        const suggestions = (STANDARD_FREIGHT_ITEMS[category.id] ?? []).filter(
          (suggestion) =>
            !entry.items.some((item) => item.id === suggestion.id),
        );
        return (
          <details className="payback-category" key={category.id}>
            <summary>
              {category.label}
              <span>
                {entry.items.length > 0
                  ? `${entry.items.length} item${entry.items.length === 1 ? "" : "s"}`
                  : "No items yet"}
              </span>
            </summary>
            {entry.items.map((item, index) => {
              function patchItem(patch: Partial<FreightPaybackItemDraft>) {
                const items = [...entry.items];
                items[index] = {...item, ...patch};
                patchCategory(category.id, {items});
              }
              return (
                <div className="payback-item" key={`${category.id}-${index}`}>
                  <div className="payback-item-row">
                    <label className="payback-item-field">
                      <span>What it is</span>
                      <input
                        onChange={(event) =>
                          patchItem({label: event.target.value})
                        }
                        placeholder="e.g. iPhone"
                        value={item.label}
                      />
                    </label>
                    <button
                      aria-label={`Remove ${item.label || "item"}`}
                      className="lst-icon-btn"
                      onClick={() =>
                        patchCategory(category.id, {
                          items: entry.items.filter((_, i) => i !== index),
                        })
                      }
                      type="button"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <FreightRowPricingFields onPatch={patchItem} row={item} />
                </div>
              );
            })}
            <div className="payback-category-actions">
              <button
                className="lst-btn ghost"
                onClick={() =>
                  patchCategory(category.id, {
                    items: [...entry.items, emptyFreightPaybackItem()],
                  })
                }
                type="button"
              >
                Add an item
              </button>
              {suggestions.map((suggestion) => (
                <button
                  className="lst-btn ghost"
                  key={suggestion.id}
                  onClick={() =>
                    patchCategory(category.id, {
                      items: [
                        ...entry.items,
                        emptyFreightPaybackItem(
                          suggestion.id,
                          suggestion.label,
                        ),
                      ],
                    })
                  }
                  type="button"
                >
                  + {suggestion.label}
                </button>
              ))}
            </div>
            <div className="payback-other">
              <p className="service-config-note">
                <span className="label-with-info">
                  Anything else in this category
                  <FieldInfo label="what the catch-all row does">
                    <p>
                      Price it and everything in this category you did not
                      name is bookable at that price.
                    </p>
                    <p>
                      Leave it unpriced and a customer sending something you
                      did not list asks you for a price instead, and you
                      answer it under Price requests.
                    </p>
                  </FieldInfo>
                </span>
              </p>
              <FreightRowPricingFields
                onPatch={(patch) =>
                  patchCategory(category.id, {
                    ...(patch.pricingMode !== undefined && {
                      otherPricingMode: patch.pricingMode,
                    }),
                    ...(patch.flatPrice !== undefined && {
                      otherFlatPrice: patch.flatPrice,
                    }),
                    ...(patch.includedKg !== undefined && {
                      otherIncludedKg: patch.includedKg,
                    }),
                  })
                }
                row={{
                  pricingMode: entry.otherPricingMode,
                  flatPrice: entry.otherFlatPrice,
                  includedKg: entry.otherIncludedKg,
                }}
                unpricedLabel="Ask me for a price"
              />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PickupConfigEditor({
  config,
  isNewYork,
  onBorough,
  onChange,
}: {
  config: PickupConfigDraft;
  isNewYork: boolean;
  onBorough: (borough: string, value: string) => void;
  onChange: (patch: Partial<PickupConfigDraft>) => void;
}) {
  return (
    <>
      <label className="lst-field">
        <span>Pricing mode</span>
        <select
          onChange={(event) =>
            onChange({mode: event.target.value as PickupMode})
          }
          value={config.mode}
        >
          <option value="flat">Flat fee</option>
          <option value="distance">By distance</option>
          {isNewYork && <option value="borough">By borough (NYC)</option>}
        </select>
      </label>
      {config.mode !== "borough" && (
        <label className="lst-field">
          <span>Maximum pickup distance (miles) — required</span>
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) =>
              onChange({maxPickupMiles: event.target.value})
            }
            placeholder="e.g. 25"
            type="number"
            value={config.maxPickupMiles}
          />
        </label>
      )}
      {config.mode === "flat" && (
        <>
          <p className="service-config-note wide">
            One price for any pickup within your maximum distance. Addresses
            beyond it are refused, never surcharged.
          </p>
          <label className="lst-field">
            <span>Flat pickup fee (USD)</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => onChange({flatFee: event.target.value})}
              type="number"
              value={config.flatFee}
            />
          </label>
        </>
      )}
      {config.mode === "distance" && (
        <>
          <p className="service-config-note wide">
            Fee = base fee + per-mile rate × driving distance, never below
            your minimum. Addresses beyond your maximum distance are refused.
          </p>
          <label className="lst-field wide">
            <span>Pickup origin address</span>
            <input
              onChange={(event) =>
                onChange({originAddress: event.target.value})
              }
              placeholder="Where your pickups start from"
              value={config.originAddress}
            />
          </label>
          <label className="lst-field">
            <span>Base fee (USD)</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => onChange({baseFee: event.target.value})}
              type="number"
              value={config.baseFee}
            />
          </label>
          <label className="lst-field">
            <span>Per mile (USD)</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => onChange({perMileFee: event.target.value})}
              type="number"
              value={config.perMileFee}
            />
          </label>
          <label className="lst-field">
            <span>Minimum fee (USD)</span>
            <input
              inputMode="decimal"
              min="0"
              onChange={(event) => onChange({minimumFee: event.target.value})}
              type="number"
              value={config.minimumFee}
            />
          </label>
        </>
      )}
      {config.mode === "borough" && (
        <>
          <p className="service-config-note wide">
            One flat fee per borough you serve. Leave a borough blank to not
            serve it — the customer&apos;s address decides which fee applies.
          </p>
          {NYC_BOROUGHS.map((borough) => (
            <label className="lst-field" key={borough}>
              <span>{borough} (USD)</span>
              <input
                inputMode="decimal"
                min="0"
                onChange={(event) => onBorough(borough, event.target.value)}
                placeholder="Not served"
                type="number"
                value={config.boroughPrices[borough] ?? ""}
              />
            </label>
          ))}
        </>
      )}
    </>
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
  const {busy, busyLabel, error, success, run} = useActionFeedback(runAction, toast);

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
  const {busy, busyLabel, error, success, run} = useActionFeedback(runAction, toast);
  const businessName = text(business?.name, businessId || "this business");
  const invitations = useBusinessInvitations(businessId);

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
    // Whether it went out or not, the pending list is now stale: a sent
    // invitation must appear, and a refused one must not linger.
    invitations.refresh();
  }

  async function resendInvitation(row: AccessInvitationRow) {
    await run(
      "Invitation resent",
      async () => {
        await httpsCallable(functions, "resendAccessInvitation")({
          invitationId: row.invitationId,
        });
      },
      {
        confirm: `Send ${row.email} a new invitation link?`,
        confirmFr: `Envoyer à ${row.email} un nouveau lien d’invitation ?`,
      },
    );
    invitations.refresh();
  }

  async function cancelInvitation(row: AccessInvitationRow) {
    await run(
      "Invitation cancelled",
      async () => {
        await httpsCallable(functions, "cancelAccessInvitation")({
          invitationId: row.invitationId,
        });
      },
      {
        confirm: `Cancel the invitation for ${row.email}? Their link stops working.`,
        confirmFr: `Annuler l’invitation de ${row.email} ? Son lien cessera de fonctionner.`,
      },
    );
    invitations.refresh();
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
      {invitations.error && <div className="error-box">{invitations.error}</div>}

      {loading && <div className="lst-empty"><p>Loading…</p></div>}
      {!loading && rows.length === 0 && invitations.rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Users size={30} /></div>
          <h3>No team members yet</h3>
          <p>Invite staff and choose what each person can manage.</p>
          {canManageStaff && <button className="lst-add" type="button" disabled={!businessId} onClick={() => setFormOpen(true)}><UserPlus size={16} /> Invite staff</button>}
        </div>
      )}

      {invitations.rows.length > 0 && (
        <>
          <div className="lst-form-section">
            Invitations sent — waiting for the person to set a password
          </div>
          <div className="pur-grid">
            {invitations.rows.map((invitation) => (
              <PendingInvitationRow
                key={invitation.invitationId}
                busy={busy}
                canManageStaff={canManageStaff}
                cancelInvitation={cancelInvitation}
                resendInvitation={resendInvitation}
                row={invitation}
              />
            ))}
          </div>
          <div className="lst-form-section">Team members</div>
        </>
      )}

      <div className="pur-grid">
        {rows.map((row) => (
          <StaffRow
            key={`${row._path ?? row.id}`}
            business={business}
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
                      const requiredService =
                        businessPermissionRequiredService[permission.id];
                      const notYetOffered = Boolean(
                        requiredService &&
                          !businessOffersService(business, requiredService),
                      );
                      return (
                        <button key={permission.id} type="button" className={`lst-chip ${on ? "on" : ""}`} onClick={() => update({ businessPermissions: togglePermission(draft.businessPermissions, permission.id, !on) })}>
                          {permission.label}
                          {notYetOffered && (
                            <small className="lst-chip-note"> · not yet offered</small>
                          )}
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

// An invitation lives in `accessInvitations`, which the security rules close
// to every client - it carries the pending authority of an account that does
// not exist yet. So the pending list arrives through a callable scoped to
// this business rather than a Firestore listener, and is re-read after every
// action instead of streaming.
function useBusinessInvitations(businessId: string) {
  const [rows, setRows] = useState<AccessInvitationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [token, setToken] = useState(0);

  useEffect(() => {
    const scopedBusinessId = businessId.trim();
    if (!scopedBusinessId) {
      setRows([]);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    httpsCallable(functions, "listBusinessInvitations")({businessId: scopedBusinessId})
      .then((result) => {
        if (!active) return;
        const payload = result.data as {invitations?: unknown};
        setRows(accessInvitationRowsFrom(payload?.invitations));
        setError("");
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setRows([]);
        // A staff member without the People permission is refused by the
        // callable; that is not an error worth shouting about in a panel
        // they can still read.
        const message =
          loadError instanceof Error ? loadError.message : String(loadError);
        setError(
          /permission-denied|not allowed/i.test(message)
            ? ""
            : "Pending invitations could not be loaded.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [businessId, token]);

  const refresh = useCallback(() => setToken((value) => value + 1), []);
  return {rows, loading, error, refresh};
}

function PendingInvitationRow({
  row,
  busy,
  canManageStaff,
  resendInvitation,
  cancelInvitation,
}: {
  row: AccessInvitationRow;
  busy: boolean;
  canManageStaff: boolean;
  resendInvitation: (row: AccessInvitationRow) => Promise<void>;
  cancelInvitation: (row: AccessInvitationRow) => Promise<void>;
}) {
  const deliveryNote = accessInvitationDeliveryNote(row);
  return (
    <article className="pur-card">
      <div className="pur-head">
        <div className="pur-title">
          <strong>{row.fullName || row.email}</strong>
          <span className="pur-kind">{row.email}</span>
        </div>
        <span className={`lst-badge ${accessInvitationStatusTone(row)}`}>
          {accessInvitationStatusLabel(row)}
        </span>
      </div>
      <div className="pur-reliability">
        <InvitationLine line={accessInvitationSentLine(row, formatDate)} />
      </div>
      <div className="pur-reliability">
        <Clock size={13} />{" "}
        <InvitationLine line={accessInvitationExpiryLine(row, formatDate)} />
      </div>
      {deliveryNote && <div className="pur-reliability">{deliveryNote}</div>}
      <div className="lst-form-section" style={{ marginTop: 0 }}>Invited to manage</div>
      <div className="lst-chips">
        {row.businessPermissions.length === 0 ? (
          <span className="pur-kind">No sections selected</span>
        ) : (
          row.businessPermissions.map((permission) => (
            <span className="lst-chip on" key={permission}>
              {businessPermissionLabel(permission)}
            </span>
          ))
        )}
      </div>
      {canManageStaff && canActOnAccessInvitation(row) && (
        <div className="pur-actions">
          <button
            className="lst-btn"
            disabled={busy}
            onClick={() => resendInvitation(row)}
            type="button"
          >
            <Send size={14} /> Resend invitation
          </button>
          <button
            className="lst-btn ghost danger"
            disabled={busy}
            onClick={() => cancelInvitation(row)}
            type="button"
          >
            Cancel invitation
          </button>
        </div>
      )}
    </article>
  );
}

// The label and its value stay in separate text nodes so the runtime French
// dictionary, which matches whole nodes, can translate the label without the
// date or the sender's name defeating the match.
function InvitationLine({line}: {line: AccessInvitationLine}) {
  return (
    <>
      <span>{line.label}</span>
      {line.detail ? <span> · {line.detail}</span> : null}
    </>
  );
}

function businessPermissionLabel(id: string) {
  return (
    businessPermissionOptions.find((option) => option.id === id)?.label ?? id
  );
}

function StaffRow({
  row,
  business,
  canManageStaff,
  saving,
  setPermissions,
  savePermissions,
}: {
  row: FirestoreRow;
  business?: FirestoreRow | null;
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
              const requiredService =
                businessPermissionRequiredService[permission.id];
              const notYetOffered = Boolean(
                requiredService &&
                  !businessOffersService(business, requiredService),
              );
              return (
                <button
                  key={permission.id}
                  type="button"
                  className={`lst-chip ${on ? "on" : ""}`}
                  disabled={!canManageStaff}
                  onClick={() => toggle(permission.id, !on)}
                >
                  {permission.label}
                  {notYetOffered && (
                    <small className="lst-chip-note"> · not yet offered</small>
                  )}
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
  const [success, setSuccess] = useState("");

  async function run(
    label: string,
    action: () => Promise<unknown>,
    options?: ActionConfirmationOptions,
  ) {
    if (busy) return;
    setBusy(true);
    setBusyLabel(label);
    setError("");
    setSuccess("");
    try {
      if (runAction) {
        // runAction owns confirmation and feedback (and returns silently on
        // a cancelled confirm), so no local success banner here.
        await runAction(label, action, options);
      } else {
        // Deliberately NOT window.confirm here: a native modal blocks the
        // main thread on submit (it froze the tab under automation and
        // reads as a hang). The options-provided confirm text is unused in
        // this path until a non-blocking dialog exists.
        await action();
        toast?.("success", label);
        // A panel without a toast host still owes the user visible proof
        // the save happened - silent success looks identical to a hang.
        setSuccess(label);
      }
    } catch (rawError) {
      let message = rawError instanceof Error ? rawError.message : String(rawError);
      if (/unauthenticated/i.test(message)) {
        // Raw callable text; the usual cause is a failed App Check token
        // (e.g. reCAPTCHA blocked at load), which a reload repairs.
        message =
          "Your session could not be verified. Reload the page and try again.";
      }
      setError(message);
      toast?.("error", message);
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }

  return {busy, busyLabel, error, success, run};
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
    addressLine1: optionalBusinessText(business?.addressLine1),
    city: optionalBusinessText(business?.city),
    country: optionalBusinessText(business?.country),
    state: optionalBusinessText(business?.state),
    postalCode: optionalBusinessText(business?.postalCode),
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
