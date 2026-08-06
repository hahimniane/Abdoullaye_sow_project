"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  deleteField,
  doc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  MapPinned,
  Package,
  ParkingCircle,
  Pencil,
  Plane,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Ship,
  Star,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import { AddressAutocomplete } from "@/components/address-autocomplete";
import { ContainerTrackingCard } from "@/components/business/container-tracking-card";
import { TrackingUpdatesSection } from "@/components/business/tracking-updates-section";
import { SearchableSelect } from "@/components/searchable-select";
import { db, functions, storage } from "@/lib/firebase";
import {
  DESTINATION_COUNTRIES,
  destinationCountryById,
  destinationCountryName,
  destinationCountryOptionForRow,
  withSelectedDestinationCountry,
} from "@/lib/destination-countries";
import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  BUSINESS_PARKING_ENTRY_MESSAGES,
  BUSINESS_PARKING_RECEIVED_VIA_OPTIONS,
  businessParkingAmountDue,
  businessParkingEntryPayload,
  businessParkingEntryResult,
  businessParkingPaymentBadge,
  businessParkingPaymentLabel,
  businessParkingPaymentTone,
  canMarkBusinessParkingPaid,
  emptyBusinessParkingEntryDraft,
  isBusinessEnteredParking,
  validateBusinessParkingEntryDraft,
  type BusinessParkingEntryDraft,
  type BusinessParkingEntryError,
  type BusinessParkingEntryResult,
} from "@/lib/business-parking-entry";
import { useSharedBarrelsEnabled } from "@/lib/feature-flags";
import {
  sharedBarrelDeadlineIso,
  sharedBarrelPoolErrorMessage,
  type SharedBarrelPoolDraft,
  type SharedBarrelPoolField,
  validateSharedBarrelPoolDraft,
} from "@/lib/shared-barrel-pool";
import {
  canonicalDestinationServiceAvailability,
  DESTINATION_DEPARTURE_DAYS,
  DESTINATION_DEPARTURE_DAY_LABELS,
  destinationDepartureDays,
  destinationRateError,
  destinationServiceAvailability,
  globallyAvailableDestinationServices,
  type DestinationDepartureDay,
  type DestinationServiceAvailability,
} from "@/lib/destination-pricing";
import { currentLanguage, formatDate, formatMoney, text } from "@/lib/format";
import { canonicalMake, canonicalModel, getMakes, getModels, getYears } from "@/lib/car-catalog";
import { ensureBrowserDisplayableImage } from "@/lib/heic-convert";
import { US_STATE_OPTIONS, citiesForState, withSelected } from "@/lib/us-locations";
import type { FirestoreRow } from "@/types/admin";

type PanelProps = {
  businessId: string;
  previewMode?: boolean;
  /** Request id from an opened notification, scrolled to and highlighted. */
  focusRequestId?: string;
  businessName?: string;
  businessStatus?: string;
  businessProfileImageUrl?: string;
  enabledServices?: string[];
  onOpenDestinations?: () => void;
  onManageServices?: () => void;
  openNewToken?: number;
};

type DestinationDraft = {
  countryId: string;
  price: string;
  freightAirPrice: string;
  freightSeaPrice: string;
  // Each service has its own real-world transit time, so delivery estimates
  // are tracked per service rather than one shared pair for the country.
  barrelMinDays: string;
  barrelMaxDays: string;
  freightAirMinDays: string;
  freightAirMaxDays: string;
  freightSeaMinDays: string;
  freightSeaMaxDays: string;
  freightAirDepartureDays: DestinationDepartureDay[];
  freightSeaDepartureDays: DestinationDepartureDay[];
  note: string;
  barrelShipping: boolean;
  freightAir: boolean;
  freightSea: boolean;
  carTransport: boolean;
};

type ListingDraft = {
  id: string;
  title: string;
  make: string;
  model: string;
  year: string;
  price: string;
  mileage: string;
  status: string;
  condition: string;
  isRebuiltTitle: boolean | null;
  bodyType: string;
  transmission: string;
  fuelType: string;
  drivetrain: string;
  exteriorColor: string;
  interiorColor: string;
  vin: string;
  stockNumber: string;
  isNegotiable: boolean;
  financingNote: string;
  description: string;
  features: string[];
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  locationAddressLine1: string;
  locationCity: string;
  locationState: string;
  locationPostalCode: string;
};

// Editable image slot — either an already-uploaded URL or a not-yet-uploaded file.
// The first item in the list is the cover photo (matches the mobile app).
const MAX_LISTING_IMAGES = 12;
type EditImage = { key: string; url?: string; file?: File; preview: string };

type ParkingDraft = {
  id: string;
  ownerName: string;
  carMake: string;
  carModel: string;
  carYear: string;
  vinNumber: string;
  parkingDate: string;
  status: string;
  totalCost: string;
};

type TransportQuoteDraft = {
  requestId: string;
  amount: string;
  estimatedPickupDate: string;
  estimatedDeliveryDate: string;
  transportMethod: "open" | "enclosed";
  terms: string;
};

type PoolDraft = SharedBarrelPoolDraft;

type PoolRolloverDraft = {
  joinDeadline: string;
  maxJoiners: string;
  note: string;
};

const countries = DESTINATION_COUNTRIES;
function countryFlag(code: string) {
  const cc = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const listingStatuses = ["draft", "active", "reserved", "sold", "inactive"];

// Car attribute option lists — kept in sync with the mobile listing form
// (my_flutter_app/lib/screens/staff_car_management_screen.dart). These power the
// same customer-facing filters as the app.
export const conditionOptions = ["new", "used", "certified", "salvage"];
export const bodyTypeOptions = ["sedan", "suv", "truck", "van", "coupe", "hatchback", "wagon", "convertible"];
export const transmissionOptions = ["automatic", "manual", "cvt"];
export const fuelOptions = ["gas", "diesel", "hybrid", "electric", "plug_in_hybrid"];
export const drivetrainOptions = ["fwd", "rwd", "awd", "4wd"];
const colorOptions = ["black", "white", "silver", "gray", "red", "blue", "green", "yellow", "brown", "beige", "gold", "orange", "purple", "burgundy", "other"];
const featureOptions = ["backup_camera", "bluetooth", "leather_seats", "sunroof", "navigation", "heated_seats", "apple_carplay", "android_auto", "blind_spot", "third_row", "remote_start", "keyless_entry"];

const ACRONYMS = new Set(["suv", "cvt", "vin", "fwd", "rwd", "awd", "4wd"]);
export function optionLabel(value: string) {
  const labels: Record<"en" | "fr", Record<string, string>> = {
    en: {
      automatic: "Automatic",
      backup_camera: "Backup camera",
      beige: "Beige",
      black: "Black",
      blind_spot: "Blind spot",
      bluetooth: "Bluetooth",
      brown: "Brown",
      certified: "Certified",
      convertible: "Convertible",
      coupe: "Coupe",
      diesel: "Diesel",
      electric: "Electric",
      gas: "Gas",
      gold: "Gold",
      gray: "Gray",
      green: "Green",
      hatchback: "Hatchback",
      heated_seats: "Heated seats",
      hybrid: "Hybrid",
      keyless_entry: "Keyless entry",
      leather_seats: "Leather seats",
      manual: "Manual",
      navigation: "Navigation",
      new: "New",
      orange: "Orange",
      other: "Other",
      plug_in_hybrid: "Plug-in hybrid",
      purple: "Purple",
      red: "Red",
      remote_start: "Remote start",
      salvage: "Salvage",
      sedan: "Sedan",
      silver: "Silver",
      sunroof: "Sunroof",
      third_row: "Third row",
      truck: "Truck",
      used: "Used",
      van: "Van",
      wagon: "Wagon",
      white: "White",
      yellow: "Yellow",
    },
    fr: {
      automatic: "Automatique",
      backup_camera: "Caméra de recul",
      beige: "Beige",
      black: "Noir",
      blind_spot: "Détection angle mort",
      bluetooth: "Bluetooth",
      brown: "Marron",
      certified: "Certifié",
      convertible: "Cabriolet",
      coupe: "Coupé",
      diesel: "Diesel",
      electric: "Électrique",
      gas: "Essence",
      gold: "Or",
      gray: "Gris",
      green: "Vert",
      hatchback: "Hatchback",
      heated_seats: "Sièges chauffants",
      hybrid: "Hybride",
      keyless_entry: "Accès sans clé",
      leather_seats: "Sièges en cuir",
      manual: "Manuelle",
      navigation: "Navigation",
      new: "Neuf",
      orange: "Orange",
      other: "Autre",
      plug_in_hybrid: "Hybride rechargeable",
      purple: "Violet",
      red: "Rouge",
      remote_start: "Démarrage à distance",
      salvage: "Accidenté",
      sedan: "Berline",
      silver: "Argent",
      sunroof: "Toit ouvrant",
      third_row: "Troisième rangée",
      truck: "Pick-up",
      used: "Occasion",
      van: "Van",
      wagon: "Break",
      white: "Blanc",
      yellow: "Jaune",
    },
  };
  const language = currentLanguage();
  if (labels[language][value]) return labels[language][value];
  if (!value) return "";
  if (ACRONYMS.has(value.toLowerCase())) return value.toUpperCase();
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
const transportStatuses = ["pending", "scheduled", "in_transit", "delivered", "cancelled"];
const parkingStatuses = ["active", "completed", "cancelled"];

const emptyDestinationDraft: DestinationDraft = {
  countryId: countries[0].id,
  price: "",
  freightAirPrice: "",
  freightSeaPrice: "",
  barrelMinDays: "",
  barrelMaxDays: "",
  freightAirMinDays: "",
  freightAirMaxDays: "",
  freightSeaMinDays: "",
  freightSeaMaxDays: "",
  freightAirDepartureDays: [],
  freightSeaDepartureDays: [],
  note: "",
  barrelShipping: false,
  freightAir: false,
  freightSea: false,
  carTransport: false,
};

function destinationDraftAvailability(
  draft: DestinationDraft,
): DestinationServiceAvailability {
  return {
    barrelShipping: draft.barrelShipping,
    freightAir: draft.freightAir,
    freightSea: draft.freightSea,
    carTransport: draft.carTransport,
  };
}

function parseDeliveryEstimate(
  minText: string,
  maxText: string,
): { minDays: number; maxDays: number } | null {
  const min = minText.trim();
  const max = maxText.trim();
  if (min === "" && max === "") return null;
  const minDays = Number(min);
  const maxDays = Number(max);
  if (
    min === "" ||
    max === "" ||
    !Number.isInteger(minDays) ||
    !Number.isInteger(maxDays) ||
    minDays <= 0 ||
    maxDays < minDays
  ) {
    throw new Error("Enter a valid min/max delivery day range.");
  }
  return { minDays, maxDays };
}

const emptyListingDraft: ListingDraft = {
  id: "",
  title: "",
  make: "",
  model: "",
  year: "",
  price: "",
  mileage: "",
  status: "draft",
  condition: "",
  isRebuiltTitle: null,
  bodyType: "",
  transmission: "",
  fuelType: "",
  drivetrain: "",
  exteriorColor: "",
  interiorColor: "",
  vin: "",
  stockNumber: "",
  isNegotiable: false,
  financingNote: "",
  description: "",
  features: [],
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  locationAddressLine1: "",
  locationCity: "",
  locationState: "",
  locationPostalCode: "",
};

const emptyParkingDraft: ParkingDraft = {
  id: "",
  ownerName: "",
  carMake: "",
  carModel: "",
  carYear: "",
  vinNumber: "",
  parkingDate: "",
  status: "active",
  totalCost: "",
};

const emptyTransportQuoteDraft: TransportQuoteDraft = {
  requestId: "",
  amount: "",
  estimatedPickupDate: "",
  estimatedDeliveryDate: "",
  transportMethod: "open",
  terms: "",
};

function futureDateInput(days = 14) {
  const date = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function defaultPoolDraft(destinationCountryId = ""): PoolDraft {
  return {
    origin: "businessHeld",
    destinationCountryId,
    totalShares: "2",
    reservedShares: "0",
    maxJoiners: "2",
    approvalMode: "approval",
    shipMode: "sea",
    joinDeadline: futureDateInput(),
    senderName: "",
    senderAddress: "",
    receiverName: "",
    receiverPhone: "",
    contentsDescription: "",
    attestedWeightKg: "",
    contentsAttested: false,
    prohibitedItemsAcknowledged: false,
    sharedLiabilityAccepted: false,
  };
}

function defaultPoolRolloverDraft(row?: FirestoreRow | null): PoolRolloverDraft {
  const activeJoiners = publicParticipantRows(row?.publicParticipants)
    .filter((participant) => ["requested", "accepted"].includes(participant.joinStatus) && participant.role === "joiner")
    .length;
  const openShares = Math.max(1, Number(row?.openShares ?? 1));
  return {
    joinDeadline: futureDateInput(),
    maxJoiners: String(Math.max(activeJoiners + 1, activeJoiners + openShares)),
    note: "",
  };
}

export function DestinationsPanel({
  businessId,
  previewMode = false,
  enabledServices = [],
  onManageServices,
  openNewToken = 0,
}: PanelProps) {
  const destinations = useBusinessSubcollectionRows(
    "destinationCountries",
    businessId,
    Boolean(businessId && !previewMode),
    countries.length,
  );
  const [draft, setDraft] = useState<DestinationDraft>(emptyDestinationDraft);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [handledOpenToken, setHandledOpenToken] = useState(0);

  const rows = useMemo(
    () =>
      [...destinations.rows].sort((a, b) =>
        destinationRowCountryName(a).localeCompare(destinationRowCountryName(b)),
      ),
    [destinations.rows],
  );
  const filteredRows = useMemo(
    () => filterRows(rows, search, ["name", "destinationCountryName", "code", "countryCode", "barrelShippingPrice", "freightAirPricePerKg", "freightSeaPricePerKg"]),
    [rows, search],
  );
  const globalAvailability = useMemo(
    () => globallyAvailableDestinationServices(enabledServices),
    [enabledServices],
  );
  const hasDestinationServices =
    Object.values(globalAvailability).some(Boolean);
  const activeCount = rows.filter((row) => {
    const availability = canonicalDestinationServiceAvailability(
      enabledServices,
      destinationServiceAvailability(row),
    );
    return row.isActive === true && Object.values(availability).some(Boolean);
  }).length;
  // Countries already configured can still be edited; new ones pick from the rest.
  const availableCountries = useMemo(
    () => countries.filter((country) => editingId === country.id || !rows.some((row) => row.id === country.id)),
    [rows, editingId],
  );
  const editingRow = useMemo(
    () => rows.find((row) => row.id === editingId),
    [rows, editingId],
  );
  const selectedCountry = editingId
    ? destinationCountryOptionForRow(editingRow ?? { id: editingId })
    : undefined;
  const destinationCountryOptions = editingId && selectedCountry
    ? withSelectedDestinationCountry(countries, selectedCountry)
    : availableCountries;

  function openNew() {
    setEditingId("");
    setDraft({ ...emptyDestinationDraft, countryId: (availableCountries[0] ?? countries[0]).id });
    setMessage("");
    setFormOpen(true);
  }
  function closeForm() {
    setEditingId("");
    setDraft(emptyDestinationDraft);
    setMessage("");
    setFormOpen(false);
  }
  function editDestination(row: FirestoreRow) {
    const availability = destinationServiceAvailability(row);
    setEditingId(row.id);
    setDraft({
      countryId: row.id,
      price: numberString(row.barrelShippingPrice),
      freightAirPrice: numberString(row.freightAirPricePerKg),
      freightSeaPrice: numberString(row.freightSeaPricePerKg),
      barrelMinDays: numberString(row.barrelShippingDeliveryEstimateMinDays),
      barrelMaxDays: numberString(row.barrelShippingDeliveryEstimateMaxDays),
      freightAirMinDays: numberString(row.freightAirDeliveryEstimateMinDays),
      freightAirMaxDays: numberString(row.freightAirDeliveryEstimateMaxDays),
      freightSeaMinDays: numberString(row.freightSeaDeliveryEstimateMinDays),
      freightSeaMaxDays: numberString(row.freightSeaDeliveryEstimateMaxDays),
      freightAirDepartureDays: destinationDepartureDays(
        row.freightAirDepartureDays,
      ),
      freightSeaDepartureDays: destinationDepartureDays(
        row.freightSeaDepartureDays,
      ),
      note: text(row.destinationNote, ""),
      barrelShipping: availability.barrelShipping,
      freightAir: availability.freightAir,
      freightSea: availability.freightSea,
      carTransport: availability.carTransport,
    });
    setMessage("");
    setFormOpen(true);
  }

  useEffect(() => {
    const token = Number(openNewToken);
    if (token <= 0 || token === handledOpenToken || destinations.loading) return;
    setEditingId("");
    setDraft({ ...emptyDestinationDraft, countryId: (availableCountries[0] ?? countries[0]).id });
    setMessage("");
    setFormOpen(true);
    setHandledOpenToken(token);
  }, [availableCountries, destinations.loading, handledOpenToken, openNewToken]);

  async function saveDestination() {
    if (!businessId) throw new Error("Business ID is required.");
    const country =
      destinationCountryById(draft.countryId) ??
      destinationCountryOptionForRow(editingRow ?? { id: draft.countryId });
    if (!country) throw new Error("Select a supported country.");
    const price = Number(draft.price);
    const freightAirPrice = Number(draft.freightAirPrice || 0);
    const freightSeaPrice = Number(draft.freightSeaPrice || 0);
    const availability = canonicalDestinationServiceAvailability(
      enabledServices,
      destinationDraftAvailability(draft),
    );
    const rates = {
      barrelShippingPrice:
        availability.barrelShipping && Number.isFinite(price) ? price : 0,
      freightAirPricePerKg:
        availability.freightAir && Number.isFinite(freightAirPrice)
          ? freightAirPrice
          : 0,
      freightSeaPricePerKg:
        availability.freightSea && Number.isFinite(freightSeaPrice)
          ? freightSeaPrice
          : 0,
    };
    const barrelEstimate = parseDeliveryEstimate(
      draft.barrelMinDays,
      draft.barrelMaxDays,
    );
    const freightAirEstimate = parseDeliveryEstimate(
      draft.freightAirMinDays,
      draft.freightAirMaxDays,
    );
    const freightSeaEstimate = parseDeliveryEstimate(
      draft.freightSeaMinDays,
      draft.freightSeaMaxDays,
    );
    const rateError = destinationRateError(
      enabledServices,
      availability,
      rates,
    );
    if (rateError) throw new Error(rateError);
    await setDoc(
      doc(db, "businesses", businessId, "destinationCountries", country.id),
      {
        businessId,
        id: country.id,
        countryId: country.id,
        name: country.name,
        destinationCountryName: country.name,
        countryCode: country.code,
        code: country.code,
        destinationCoverageVersion: 2,
        serviceAvailability: availability,
        barrelShippingPrice: rates.barrelShippingPrice,
        freightAirPricePerKg: rates.freightAirPricePerKg,
        freightSeaPricePerKg: rates.freightSeaPricePerKg,
        freightAirDepartureDays: availability.freightAir
          ? draft.freightAirDepartureDays
          : [],
        freightSeaDepartureDays: availability.freightSea
          ? draft.freightSeaDepartureDays
          : [],
        carTransportAvailable: availability.carTransport,
        barrelShippingDeliveryEstimateMinDays: barrelEstimate
          ? barrelEstimate.minDays
          : deleteField(),
        barrelShippingDeliveryEstimateMaxDays: barrelEstimate
          ? barrelEstimate.maxDays
          : deleteField(),
        freightAirDeliveryEstimateMinDays: freightAirEstimate
          ? freightAirEstimate.minDays
          : deleteField(),
        freightAirDeliveryEstimateMaxDays: freightAirEstimate
          ? freightAirEstimate.maxDays
          : deleteField(),
        freightSeaDeliveryEstimateMinDays: freightSeaEstimate
          ? freightSeaEstimate.minDays
          : deleteField(),
        freightSeaDeliveryEstimateMaxDays: freightSeaEstimate
          ? freightSeaEstimate.maxDays
          : deleteField(),
        destinationNote: draft.note.trim(),
        isActive: Object.values(availability).some(Boolean),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setEditingId("");
    setDraft(emptyDestinationDraft);
    setFormOpen(false);
    setMessage(`${country.name} configuration saved.`);
  }

  async function pauseAllServices(row: FirestoreRow) {
    await setDoc(
      doc(db, "businesses", businessId, "destinationCountries", row.id),
      {
        businessId,
        destinationCoverageVersion: 2,
        serviceAvailability: {
          barrelShipping: false,
          freightAir: false,
          freightSea: false,
          carTransport: false,
        },
        carTransportAvailable: false,
        isActive: false,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  const visibleServiceCount = Object.values(
    canonicalDestinationServiceAvailability(
      enabledServices,
      destinationDraftAvailability(draft),
    ),
  ).filter(Boolean).length;

  return (
    <section className="lst destination-coverage">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Service coverage by country</h2>
          <p>
            {rows.length === 0
              ? "Choose which services customers can request in each country."
              : `${rows.length} destination${rows.length === 1 ? "" : "s"} · ${activeCount} serving customers`}
          </p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy} message={message} />
          <button
            className="lst-add"
            type="button"
            onClick={openNew}
            disabled={!hasDestinationServices || availableCountries.length === 0}
          >
            <Plus size={17} /> Add country
          </button>
        </div>
      </header>

      {destinations.error && <div className="error-box">{destinations.error}</div>}

      <div className="destination-capabilities">
        <div>
          <strong>Services your business offers</strong>
          <span>Country coverage is configured separately below.</span>
        </div>
        <div className="destination-capability-chips">
          {globalAvailability.barrelShipping && <span><Package size={14} /> Barrel shipping</span>}
          {globalAvailability.freightAir && <span><Plane size={14} /> Freight — Air</span>}
          {globalAvailability.freightSea && <span><Ship size={14} /> Freight — Sea</span>}
          {globalAvailability.carTransport && <span><Truck size={14} /> Car transport</span>}
          {!hasDestinationServices && <span className="muted">No shipping or transport services enabled</span>}
        </div>
        {onManageServices && (
          <button className="lst-btn ghost" type="button" onClick={onManageServices}>
            Manage services
          </button>
        )}
      </div>

      {hasDestinationServices && (
        <div className="lst-toolbar">
          <div className="lst-search">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search countries or services…"
              aria-label="Search countries or services"
            />
          </div>
          <button
            className="lst-btn ghost"
            type="button"
            disabled={filteredRows.length === 0}
            onClick={() =>
              downloadCsv(
                "destination-service-coverage.csv",
                filteredRows,
                [
                  "name",
                  "code",
                  "serviceAvailability",
                  "barrelShippingPrice",
                  "freightAirPricePerKg",
                  "freightSeaPricePerKg",
                  "barrelShippingDeliveryEstimateMinDays",
                  "barrelShippingDeliveryEstimateMaxDays",
                  "freightAirDeliveryEstimateMinDays",
                  "freightAirDeliveryEstimateMaxDays",
                  "freightSeaDeliveryEstimateMinDays",
                  "freightSeaDeliveryEstimateMaxDays",
                  "isActive",
                  "updatedAt",
                ],
              )
            }
          >
            <Download size={15} /> Export CSV
          </button>
        </div>
      )}

      {destinations.loading && <LoadingState />}
      {!destinations.loading && !hasDestinationServices && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Package size={30} /></div>
          <h3>Choose your business services first</h3>
          <p>Enable barrel shipping, freight, or car transport before configuring country coverage.</p>
          {onManageServices && (
            <button className="lst-add" type="button" onClick={onManageServices}>
              Manage business services
            </button>
          )}
        </div>
      )}
      {!destinations.loading && hasDestinationServices && rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><MapPinned size={30} /></div>
          <h3>No country coverage yet</h3>
          <p>Add a country, then choose exactly which services customers can request there.</p>
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> Add your first country</button>
        </div>
      )}
      {!destinations.loading && hasDestinationServices && rows.length > 0 && filteredRows.length === 0 && (
        <div className="lst-empty compact">
          <h3>No countries match your search</h3>
          <p>Try another country or service name.</p>
          <button className="lst-btn ghost" type="button" onClick={() => setSearch("")}>Clear search</button>
        </div>
      )}

      {hasDestinationServices && filteredRows.length > 0 && (
        <div className="destination-coverage-list">
          <div className="destination-coverage-columns" aria-hidden="true">
            <span>Country</span>
            <span>Coverage and customer rates</span>
            <span>Delivery</span>
            <span>Status</span>
            <span>Action</span>
          </div>
        {filteredRows.map((row) => {
          const availability = canonicalDestinationServiceAvailability(
            enabledServices,
            destinationServiceAvailability(row),
          );
          const active = row.isActive === true && Object.values(availability).some(Boolean);
          const country = destinationCountryOptionForRow(row);
          const serviceCount = Object.values(availability).filter(Boolean).length;
          return (
            <article className={`destination-coverage-row ${active ? "" : "off"}`} key={row.id}>
              <div className="destination-country-cell">
                <span className="dst-flag">{countryFlag(text(row.code ?? row.countryCode ?? country?.code, ""))}</span>
                <div className="dst-name">
                  <strong>{destinationRowCountryName(row)}</strong>
                  <span>{text(row.code ?? row.countryCode, "")}</span>
                </div>
              </div>
              <div className="destination-service-cell">
                {serviceCount === 0 && <span className="destination-service-empty">No services configured</span>}
                {availability.barrelShipping && (
                  <span className="destination-service-chip"><Package size={14} /> Barrel <b>{formatMoney(row.barrelShippingPrice)}/barrel</b></span>
                )}
                {availability.freightAir && (
                  <span className="destination-service-chip"><Plane size={14} /> Air <b>{formatMoney(row.freightAirPricePerKg)}/kg</b></span>
                )}
                {availability.freightSea && (
                  <span className="destination-service-chip"><Ship size={14} /> Sea <b>{formatMoney(row.freightSeaPricePerKg)}/kg</b></span>
                )}
                {availability.carTransport && (
                  <span className="destination-service-chip"><Truck size={14} /> Car transport <b>Quotes</b></span>
                )}
                {Boolean(text(row.destinationNote, "")) && <small>{text(row.destinationNote, "")}</small>}
              </div>
              <div className="destination-delivery-cell">
                {availability.barrelShipping && (
                  <div className="destination-delivery-row">
                    <span>Barrel</span>
                    <strong>{serviceDeliveryWindow(row, "barrelShipping") || "Not set"}</strong>
                  </div>
                )}
                {availability.freightAir && (
                  <div className="destination-delivery-row">
                    <span>Air</span>
                    <strong>{serviceDeliveryWindow(row, "freightAir") || "Not set"}</strong>
                  </div>
                )}
                {availability.freightSea && (
                  <div className="destination-delivery-row">
                    <span>Sea</span>
                    <strong>{serviceDeliveryWindow(row, "freightSea") || "Not set"}</strong>
                  </div>
                )}
                {!availability.barrelShipping && !availability.freightAir && !availability.freightSea && (
                  <span className="destination-service-empty">No estimate needed</span>
                )}
              </div>
              <div>
                <span className={`destination-status ${active ? "active" : "paused"}`}>
                  {active ? `${serviceCount} active` : "Paused"}
                </span>
              </div>
              <div className="destination-row-actions">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editDestination(row)}><Pencil size={14} /> Configure</button>
                {active ? (
                  <button className="destination-pause" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "All services paused for this country.", () => pauseAllServices(row))}>Pause all</button>
                ) : null}
              </div>
            </article>
          );
        })}
        </div>
      )}

      {formOpen && (
        <div className="lst-modal-overlay destination-drawer-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (!busy) closeForm();
        }}>
          <div className="lst-modal destination-drawer" onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <h3>{editingId ? "Configure country" : "Add country coverage"}</h3>
                <p>{editingId ? selectedCountry ? countryName(selectedCountry.id) : countryName(editingId) : "Choose a country and the services available there."}</p>
              </div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <SearchableSelect
                  className="lst-field wide"
                  disabled={Boolean(editingId)}
                  emptyMessage="No countries match your search."
                  label="Country"
                  listLabel="Country options"
                  onChange={(countryId) =>
                    setDraft((value) => ({ ...value, countryId }))
                  }
                  options={destinationCountryOptions.map((country) => ({
                    label: `${countryFlag(country.code)} ${countryName(country.id)}`,
                    keywords: `${country.code} ${country.name}`,
                    value: country.id,
                  }))}
                  placeholder="Search or choose a country"
                  value={draft.countryId}
                />
                <div className="destination-form-intro wide">
                  <strong>Available in this country</strong>
                  <span>Turn on only the services customers can request for this route.</span>
                </div>
                <div className="destination-service-controls wide">
                  {globalAvailability.barrelShipping && (
                    <DestinationServiceControl
                      icon={<Package size={20} />}
                      title="Barrel shipping"
                      subtitle="Set the customer price for each barrel."
                      checked={draft.barrelShipping}
                      onChange={(checked) => setDraft((value) => ({ ...value, barrelShipping: checked }))}
                    >
                      <>
                        <label className="lst-field">
                          <span>Price per barrel (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            type="number"
                            value={draft.price}
                            onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))}
                            placeholder="250"
                          />
                        </label>
                        <DeliveryEstimateFields
                          minDays={draft.barrelMinDays}
                          maxDays={draft.barrelMaxDays}
                          onMinChange={(barrelMinDays) => setDraft((value) => ({ ...value, barrelMinDays }))}
                          onMaxChange={(barrelMaxDays) => setDraft((value) => ({ ...value, barrelMaxDays }))}
                        />
                      </>
                    </DestinationServiceControl>
                  )}
                  {globalAvailability.freightAir && (
                    <DestinationServiceControl
                      icon={<Plane size={20} />}
                      title="Freight — Air"
                      subtitle="Set the customer rate per kilogram for air freight."
                      checked={draft.freightAir}
                      onChange={(checked) => setDraft((value) => ({ ...value, freightAir: checked }))}
                    >
                      <>
                        <label className="lst-field">
                          <span>Air freight per kg (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            type="number"
                            value={draft.freightAirPrice}
                            onChange={(event) => setDraft((value) => ({ ...value, freightAirPrice: event.target.value }))}
                            placeholder="8"
                          />
                        </label>
                        <DepartureDayPicker
                          label="Air freight departure days"
                          value={draft.freightAirDepartureDays}
                          onChange={(freightAirDepartureDays) =>
                            setDraft((current) => ({
                              ...current,
                              freightAirDepartureDays,
                            }))
                          }
                        />
                        <DeliveryEstimateFields
                          minDays={draft.freightAirMinDays}
                          maxDays={draft.freightAirMaxDays}
                          onMinChange={(freightAirMinDays) => setDraft((value) => ({ ...value, freightAirMinDays }))}
                          onMaxChange={(freightAirMaxDays) => setDraft((value) => ({ ...value, freightAirMaxDays }))}
                        />
                      </>
                    </DestinationServiceControl>
                  )}
                  {globalAvailability.freightSea && (
                    <DestinationServiceControl
                      icon={<Ship size={20} />}
                      title="Freight — Sea"
                      subtitle="Set the customer rate per kilogram for sea freight."
                      checked={draft.freightSea}
                      onChange={(checked) => setDraft((value) => ({ ...value, freightSea: checked }))}
                    >
                      <>
                        <label className="lst-field">
                          <span>Sea freight per kg (USD)</span>
                          <input
                            inputMode="decimal"
                            min="0"
                            type="number"
                            value={draft.freightSeaPrice}
                            onChange={(event) => setDraft((value) => ({ ...value, freightSeaPrice: event.target.value }))}
                            placeholder="4"
                          />
                        </label>
                        <DepartureDayPicker
                          label="Sea freight departure days"
                          value={draft.freightSeaDepartureDays}
                          onChange={(freightSeaDepartureDays) =>
                            setDraft((current) => ({
                              ...current,
                              freightSeaDepartureDays,
                            }))
                          }
                        />
                        <DeliveryEstimateFields
                          minDays={draft.freightSeaMinDays}
                          maxDays={draft.freightSeaMaxDays}
                          onMinChange={(freightSeaMinDays) => setDraft((value) => ({ ...value, freightSeaMinDays }))}
                          onMaxChange={(freightSeaMaxDays) => setDraft((value) => ({ ...value, freightSeaMaxDays }))}
                        />
                      </>
                    </DestinationServiceControl>
                  )}
                  {globalAvailability.carTransport && (
                    <DestinationServiceControl
                      icon={<Truck size={20} />}
                      title="Car transport quotes"
                      subtitle="Customers can request a quote. You set the route price when responding."
                      checked={draft.carTransport}
                      onChange={(checked) => setDraft((value) => ({ ...value, carTransport: checked }))}
                    />
                  )}
                </div>
                <label className="lst-field wide"><span>Customer route note (optional)</span>
                  <textarea rows={2} value={draft.note} onChange={(event) => setDraft((value) => ({ ...value, note: event.target.value }))} placeholder="e.g. Door-to-door delivery in Conakry included" />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <span className="destination-save-summary">
                {visibleServiceCount} {visibleServiceCount === 1
                  ? "service visible to customers"
                  : "services visible to customers"}
              </span>
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => runPanelAction(setBusy, setMessage, "Configuration saved.", saveDestination)}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busy ? "Saving configuration..." : "Save configuration"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

type OfficeLocationDraft = {
  label: string;
  address: string;
};

const emptyOfficeLocationDraft: OfficeLocationDraft = {
  label: "",
  address: "",
};

// Customers "bringing an item to office" need to pick which of a business's
// physical locations to go to, so a business can register more than one
// (separate branches) instead of a single implicit address.
export function OfficeLocationsPanel({
  businessId,
  previewMode = false,
}: PanelProps) {
  const locations = useBusinessSubcollectionRows(
    "officeLocations",
    businessId,
    Boolean(businessId && !previewMode),
    50,
  );
  const [draft, setDraft] = useState<OfficeLocationDraft>(
    emptyOfficeLocationDraft,
  );
  const [editingId, setEditingId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const rows = useMemo(
    () =>
      [...locations.rows].sort((a, b) => {
        const order = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        return order !== 0 ? order : text(a.label, "").localeCompare(text(b.label, ""));
      }),
    [locations.rows],
  );

  function openNew() {
    setEditingId("");
    setDraft(emptyOfficeLocationDraft);
    setMessage("");
    setFormOpen(true);
  }
  function closeForm() {
    setEditingId("");
    setDraft(emptyOfficeLocationDraft);
    setMessage("");
    setFormOpen(false);
  }
  function editLocation(row: FirestoreRow) {
    setEditingId(row.id);
    setDraft({
      label: text(row.label, ""),
      address: text(row.address, ""),
    });
    setMessage("");
    setFormOpen(true);
  }

  async function saveLocation() {
    if (!businessId) throw new Error("Business ID is required.");
    const label = draft.label.trim();
    const address = draft.address.trim();
    if (!label) throw new Error("Enter a name for this location.");
    if (!address) throw new Error("Enter an address.");
    const ref = editingId
      ? doc(db, "businesses", businessId, "officeLocations", editingId)
      : doc(collection(db, "businesses", businessId, "officeLocations"));
    const existing = rows.find((row) => row.id === editingId);
    await setDoc(
      ref,
      {
        businessId,
        label,
        address,
        isActive: true,
        sortOrder: Number(existing?.sortOrder ?? rows.length),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setEditingId("");
    setDraft(emptyOfficeLocationDraft);
    setFormOpen(false);
    setMessage(`${label} saved.`);
  }

  async function toggleActive(row: FirestoreRow) {
    await setDoc(
      doc(db, "businesses", businessId, "officeLocations", row.id),
      { isActive: !(row.isActive === true), updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  return (
    <Panel
      title="Office locations"
      icon={<MapPinned size={18} />}
      action={
        <button className="lst-btn ghost" type="button" onClick={openNew}>
          <Plus size={15} /> Add location
        </button>
      }
    >
      <p className="card-sub">
        Customers choosing “bring to office” pick from these locations. Add
        every branch customers can physically drop items off at.
      </p>
      {message && <div className="lst-form-error" role="alert">{message}</div>}
      {locations.loading && <LoadingState />}
      {!locations.loading && rows.length === 0 && (
        <div className="lst-empty compact">
          <h3>No office locations yet</h3>
          <p>Add at least one so customers can drop off items in person.</p>
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> Add your first location</button>
        </div>
      )}
      {rows.length > 0 && (
        <div className="row-list compact">
          {rows.map((row) => (
            <article className="data-row" key={row.id}>
              <div>
                <strong>{text(row.label, "Office")}</strong>
                <small>{text(row.address, "") || "No address on file"}</small>
              </div>
              <span className={`status-pill compact ${row.isActive === true ? "" : "warning"}`}>
                {row.isActive === true ? "Active" : "Paused"}
              </span>
              <div className="destination-row-actions">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editLocation(row)}><Pencil size={14} /> Edit</button>
                <button
                  className={row.isActive === true ? "destination-pause" : "lst-btn ghost"}
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    runPanelAction(
                      setBusy,
                      setMessage,
                      row.isActive === true ? "Location paused." : "Location reactivated.",
                      () => toggleActive(row),
                    )
                  }
                >
                  {row.isActive === true ? "Pause" : "Reactivate"}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => { if (!busy) closeForm(); }}>
          <div className="lst-modal" onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <h3>{editingId ? "Edit location" : "Add office location"}</h3>
                <p>Where can customers drop off items in person?</p>
              </div>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Location name</span>
                  <input value={draft.label} onChange={(event) => setDraft((value) => ({ ...value, label: event.target.value }))} placeholder="e.g. Bronx Warehouse" />
                </label>
                <AddressAutocomplete
                  id={`office-location-address-${editingId || "new"}`}
                  label="Address"
                  onChange={(address) => setDraft((value) => ({ ...value, address }))}
                  onSelect={(suggestion) =>
                    setDraft((value) => ({
                      ...value,
                      address: suggestion.formattedAddress || suggestion.description,
                    }))
                  }
                  suggestionsEnabled
                  value={draft.address}
                />
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => runPanelAction(setBusy, setMessage, "Location saved.", saveLocation)}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busy ? "Saving..." : "Save location"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </Panel>
  );
}

function DepartureDayPicker({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (days: DestinationDepartureDay[]) => void;
  value: DestinationDepartureDay[];
}) {
  return (
    <fieldset className="destination-departure-days">
      <legend>{label}</legend>
      <p>Optional. Choose the regular days this service departs.</p>
      <div>
        {DESTINATION_DEPARTURE_DAYS.map((day) => {
          const selected = value.includes(day);
          const dayLabel = DESTINATION_DEPARTURE_DAY_LABELS[day];
          return (
            <label className={selected ? "selected" : ""} key={day}>
              <input
                checked={selected}
                onChange={(event) =>
                  onChange(
                    event.target.checked
                      ? destinationDepartureDays([...value, day])
                      : value.filter((item) => item !== day),
                  )
                }
                type="checkbox"
              />
              <span aria-label={dayLabel}>{dayLabel.slice(0, 3)}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function DestinationServiceControl({
  icon,
  title,
  subtitle,
  checked,
  onChange,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <section className={`destination-service-control ${checked ? "selected" : ""}`}>
      <div className="destination-service-control-head">
        <span className="destination-service-control-icon">{icon}</span>
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <label className="destination-switch">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            aria-label={`${title} available in this country`}
          />
          <span aria-hidden="true" />
        </label>
      </div>
      {checked && children && <div className="destination-service-control-body">{children}</div>}
    </section>
  );
}

function DeliveryEstimateFields({
  minDays,
  maxDays,
  onMinChange,
  onMaxChange,
}: {
  minDays: string;
  maxDays: string;
  onMinChange: (value: string) => void;
  onMaxChange: (value: string) => void;
}) {
  return (
    <fieldset className="destination-delivery-estimate">
      <legend>Estimated delivery (optional)</legend>
      <div className="destination-delivery-estimate-fields">
        <label className="lst-field"><span>Minimum days</span>
          <input inputMode="numeric" min="1" type="number" value={minDays} onChange={(event) => onMinChange(event.target.value)} placeholder="14" />
        </label>
        <label className="lst-field"><span>Maximum days</span>
          <input inputMode="numeric" min="1" type="number" value={maxDays} onChange={(event) => onMaxChange(event.target.value)} placeholder="30" />
        </label>
      </div>
    </fieldset>
  );
}

export function ListingsPanel({
  businessId,
  previewMode = false,
  businessName = "",
  businessStatus = "pending",
  businessProfileImageUrl = "",
  enabledServices = ["carSales"],
}: PanelProps) {
  const listings = useBusinessRows("cars", businessId, Boolean(businessId && !previewMode), null);
  const [draft, setDraft] = useState<ListingDraft>(emptyListingDraft);
  const [editingId, setEditingId] = useState("");
  const [images, setImages] = useState<EditImage[]>([]);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("active");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const cityOptions = useMemo(
    () => withSelected(citiesForState(draft.locationState), draft.locationCity),
    [draft.locationCity, draft.locationState],
  );
  const makeOptions = useMemo(() => withSelected(getMakes(), draft.make), [draft.make]);
  const modelOptions = useMemo(
    () => (draft.make ? withSelected(getModels(draft.make), draft.model) : []),
    [draft.make, draft.model],
  );
  const yearOptions = useMemo(
    () => (draft.make && draft.model ? withSelected(getYears(draft.make, draft.model), draft.year) : []),
    [draft.make, draft.model, draft.year],
  );
  function toggleFeature(feature: string) {
    setDraft((value) => ({
      ...value,
      features: value.features.includes(feature)
        ? value.features.filter((item) => item !== feature)
        : [...value.features, feature],
    }));
  }

  function newKey() {
    return Math.random().toString(36).slice(2);
  }
  async function addImageFiles(files: FileList | null) {
    if (!files) return;
    const room = MAX_LISTING_IMAGES - images.length;
    const selected = Array.from(files).slice(0, Math.max(0, room));
    let additions: EditImage[];
    try {
      additions = await Promise.all(
        selected.map(async (file) => {
          const displayable = await ensureBrowserDisplayableImage(file);
          return { key: newKey(), file: displayable, preview: URL.createObjectURL(displayable) };
        }),
      );
    } catch {
      setMessage("Could not process one of those images. Try a JPG or PNG instead.");
      return;
    }
    setImages((prev) => [...prev, ...additions]);
  }
  function addImageUrl() {
    const url = imageUrlInput.trim();
    if (!url) return;
    setImages((prev) => (prev.length >= MAX_LISTING_IMAGES ? prev : [...prev, { key: newKey(), url, preview: url }]));
    setImageUrlInput("");
  }
  function makeCover(index: number) {
    setImages((prev) => {
      if (index <= 0 || index >= prev.length) return prev;
      const copy = [...prev];
      const [picked] = copy.splice(index, 1);
      return [picked, ...copy];
    });
  }
  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, idx) => idx !== index));
  }

  function openNewListing() {
    setEditingId("");
    setImages([]);
    setImageUrlInput("");
    setDraft(emptyListingDraft);
    setMessage("");
    setFormOpen(true);
  }

  function closeForm() {
    setEditingId("");
    setImages([]);
    setImageUrlInput("");
    setDraft(emptyListingDraft);
    setMessage("");
    setFormOpen(false);
  }

  function editListing(row: FirestoreRow) {
    setEditingId(row.id);
    const existing = Array.isArray(row.imageUrls)
      ? row.imageUrls.filter((url): url is string => typeof url === "string" && url.length > 0)
      : [];
    setImages(existing.map((url) => ({ key: newKey(), url, preview: url })));
    setImageUrlInput("");
    const featuresRaw = Array.isArray(row.structuredFeatures)
      ? row.structuredFeatures
      : Array.isArray(row.features)
        ? row.features
        : [];
    setDraft({
      id: row.id,
      title: text(row.title, ""),
      make: text(row.make, ""),
      model: text(row.model, ""),
      year: text(row.year, ""),
      price: numberString(row.price),
      mileage: text(row.mileage, ""),
      status: text(row.status, "draft"),
      condition: text(row.condition, ""),
      isRebuiltTitle: typeof row.isRebuiltTitle === "boolean" ? row.isRebuiltTitle : null,
      bodyType: text(row.bodyType, ""),
      transmission: text(row.transmission, ""),
      fuelType: text(row.fuelType, ""),
      drivetrain: text(row.drivetrain, ""),
      exteriorColor: text(row.exteriorColor, ""),
      interiorColor: text(row.interiorColor, ""),
      vin: text(row.vin, ""),
      stockNumber: text(row.stockNumber, ""),
      isNegotiable: row.isNegotiable === true,
      financingNote: text(row.financingNote, ""),
      description: text(row.description, ""),
      features: featuresRaw.map((item) => text(item, "")).filter(Boolean),
      contactName: text(row.contactName, ""),
      contactPhone: text(row.contactPhone ?? row.sellerPhone, ""),
      contactEmail: text(row.contactEmail, ""),
      locationAddressLine1: text(row.locationAddressLine1, ""),
      locationCity: text(row.locationCity, ""),
      locationState: text(row.locationState, ""),
      locationPostalCode: text(row.locationPostalCode, ""),
    });
    setMessage("");
    setFormOpen(true);
  }

  const filteredRows = useMemo(
    () => filterRows(listings.rows, search, ["title", "make", "model", "year", "price", "status", "locationCity", "locationState", "stockNumber", "vin"]),
    [listings.rows, search],
  );

  async function saveListing() {
    if (!businessId) throw new Error("Business ID is required.");
    const price = Number(draft.price);
    if (!draft.title.trim() && (!draft.make.trim() || !draft.model.trim())) {
      throw new Error("Enter a title or make and model.");
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new Error("Enter a valid price.");
    }
    if (draft.isRebuiltTitle === null) {
      throw new Error("Select whether this vehicle has a rebuilt title.");
    }

    if (images.length === 0) {
      throw new Error("Add at least one photo.");
    }

    const listingRef = editingId ? doc(db, "cars", editingId) : doc(collection(db, "cars"));
    // Upload any new files; keep already-hosted URLs. Order is preserved, so the
    // first image stays the cover (matches the mobile app).
    const imageUrls: string[] = [];
    for (const image of images) {
      if (image.url) {
        imageUrls.push(image.url);
      } else if (image.file) {
        imageUrls.push(await uploadCarImage(businessId, listingRef.id, image.file));
      }
    }
    const nowFields = editingId
      ? { updatedAt: serverTimestamp() }
      : { createdAt: serverTimestamp(), updatedAt: serverTimestamp() };

    await setDoc(
      listingRef,
      {
        id: listingRef.id,
        businessId,
        businessName,
        businessStatus,
        businessProfileImageUrl,
        enabledServices,
        title: draft.title.trim() || `${draft.year} ${draft.make} ${draft.model}`.trim(),
        make: draft.make.trim(),
        model: draft.model.trim(),
        year: draft.year.trim(),
        price,
        mileage: draft.mileage.trim(),
        status: draft.status,
        condition: draft.condition,
        isRebuiltTitle: draft.isRebuiltTitle,
        bodyType: draft.bodyType,
        transmission: draft.transmission,
        fuelType: draft.fuelType,
        drivetrain: draft.drivetrain,
        exteriorColor: draft.exteriorColor,
        interiorColor: draft.interiorColor,
        vin: draft.vin.trim(),
        stockNumber: draft.stockNumber.trim(),
        isNegotiable: draft.isNegotiable,
        financingNote: draft.financingNote.trim(),
        description: draft.description.trim(),
        features: draft.features,
        structuredFeatures: draft.features,
        contactName: draft.contactName.trim(),
        contactPhone: draft.contactPhone.trim(),
        contactEmail: draft.contactEmail.trim(),
        locationAddressLine1: draft.locationAddressLine1.trim(),
        locationCity: draft.locationCity.trim(),
        locationState: draft.locationState.trim(),
        locationPostalCode: draft.locationPostalCode.trim(),
        imageUrls,
        ...nowFields,
      },
      { merge: true },
    );

    setEditingId("");
    setImages([]);
    setImageUrlInput("");
    setDraft(emptyListingDraft);
    setFormOpen(false);
    setMessage("Listing saved.");
  }

  async function updateListingStatus(row: FirestoreRow, status: string) {
    if (!businessId) throw new Error("Business ID is required.");
    await setDoc(
      doc(db, "cars", row.id),
      {
        businessId,
        status,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function bulkUpdateStatus() {
    if (!businessId) throw new Error("Business ID is required.");
    if (selectedIds.length === 0) throw new Error("Select at least one listing.");
    await Promise.all(selectedIds.map((id) =>
      setDoc(
        doc(db, "cars", id),
        {businessId, status: bulkStatus, updatedAt: serverTimestamp()},
        {merge: true},
      ),
    ));
    setSelectedIds([]);
  }

  const totalCount = listings.rows.length;
  const activeCount = listings.rows.filter((row) => text(row.status, "") === "active").length;

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Your listings</h2>
          <p>{totalCount === 0 ? "Cars you list appear in the marketplace once approved." : `${totalCount} listing${totalCount === 1 ? "" : "s"} · ${activeCount} active`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy} message={message} />
          <button className="lst-add" type="button" onClick={openNewListing}>
            <Plus size={17} /> New listing
          </button>
        </div>
      </header>

      {listings.error && <div className="error-box">{listings.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search make, model, status…" />
        </div>
        {selectedIds.length > 0 && (
          <div className="lst-bulk">
            <span>{selectedIds.length} selected</span>
            <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
              {listingStatuses.map((status) => (
                <option key={status} value={status}>{statusLabel(status)}</option>
              ))}
            </select>
            <button className="lst-btn" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "Listings updated.", bulkUpdateStatus)}>
              Apply
            </button>
          </div>
        )}
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("listings.csv", filteredRows, ["title", "make", "model", "year", "price", "status", "isRebuiltTitle", "locationCity", "locationState", "updatedAt"])}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {listings.loading && <LoadingState />}
      {!listings.loading && totalCount === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Car size={30} /></div>
          <h3>No listings yet</h3>
          <p>Add your first vehicle to start selling on the marketplace.</p>
          <button className="lst-add" type="button" onClick={openNewListing}><Plus size={17} /> Add your first listing</button>
        </div>
      )}
      {!listings.loading && totalCount > 0 && filteredRows.length === 0 && (
        <EmptyState text="No listings match your search." />
      )}

      <div className="lst-grid">
        {filteredRows.map((row) => {
          const image = firstImageUrl(row);
          const status = text(row.status, "draft");
          const selected = selectedIds.includes(row.id);
          const rebuiltTitle = typeof row.isRebuiltTitle === "boolean" ? row.isRebuiltTitle : null;
          return (
            <article className={`lst-card ${selected ? "selected" : ""}`} key={row.id}>
              <div className="lst-card-media">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt={listingTitle(row)} loading="lazy" />
                ) : (
                  <div className="lst-card-noimg"><Car size={28} /><span>No photo</span></div>
                )}
                <span className={`lst-badge ${statusTone(status)}`}>{statusLabel(status)}</span>
                <label className="lst-select" title="Select">
                  <input
                    checked={selected}
                    type="checkbox"
                    onChange={(event) => setSelectedIds((ids) => toggleId(ids, row.id, event.target.checked))}
                  />
                </label>
              </div>
              <div className="lst-card-body">
                <strong className="lst-card-title">{listingTitle(row)}</strong>
                <div className="lst-card-price">{formatMoney(row.price)}</div>
                <div className="lst-card-meta">
                  {[text(row.mileage, "") ? `${text(row.mileage, "")} mi` : "", listingLocation(row), formatDate(row.updatedAt ?? row.createdAt)].filter(Boolean).join(" · ")}
                </div>
                <div className="lst-card-meta">
                  <strong>Rebuilt title:</strong> {rebuiltTitle === null ? "Not provided" : rebuiltTitle ? "Yes" : "No"}
                </div>
              </div>
              <div className="lst-card-foot">
                <select className="lst-status-select" value={status} disabled={busy} onChange={(event) => runPanelAction(setBusy, setMessage, "Status updated.", () => updateListingStatus(row, event.target.value))}>
                  {listingStatuses.map((option) => (
                    <option key={option} value={option}>{statusLabel(option)}</option>
                  ))}
                </select>
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editListing(row)}>
                  <Pencil size={14} /> Edit
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (!busy) closeForm();
        }}>
          <div className="lst-modal" onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{editingId ? "Edit listing" : "New listing"}</h3>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <div className="lst-form-section">Vehicle</div>
                <label className="lst-field wide">
                  <span>Title</span>
                  <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="e.g. 2019 Toyota Camry XLE" />
                </label>
                <label className="lst-field"><span>Make</span>
                  <select
                    value={draft.make}
                    onChange={(event) => setDraft((value) => ({ ...value, make: event.target.value, model: "", year: "" }))}
                  >
                    <option value="">Select make</option>
                    {makeOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Model</span>
                  <select
                    disabled={!draft.make}
                    value={draft.model}
                    onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value, year: "" }))}
                  >
                    <option value="">{draft.make ? "Select model" : "Select make first"}</option>
                    {modelOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Year</span>
                  <select
                    disabled={!draft.model}
                    value={draft.year}
                    onChange={(event) => setDraft((value) => ({ ...value, year: event.target.value }))}
                  >
                    <option value="">{draft.model ? "Select year" : "Select model first"}</option>
                    {yearOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Condition</span>
                  <select value={draft.condition} onChange={(event) => setDraft((value) => ({ ...value, condition: event.target.value }))}>
                    <option value="">Select condition</option>
                    {conditionOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Rebuilt title?</span>
                  <select
                    required
                    value={draft.isRebuiltTitle === null ? "" : String(draft.isRebuiltTitle)}
                    onChange={(event) => setDraft((value) => ({
                      ...value,
                      isRebuiltTitle: event.target.value === "" ? null : event.target.value === "true",
                    }))}
                  >
                    <option value="">Not provided</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                  <small>Required. Buyers will see this disclosure.</small>
                </label>
                <label className="lst-field"><span>Body type</span>
                  <select value={draft.bodyType} onChange={(event) => setDraft((value) => ({ ...value, bodyType: event.target.value }))}>
                    <option value="">Select body type</option>
                    {bodyTypeOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>

                <div className="lst-form-section">Specifications</div>
                <label className="lst-field"><span>Mileage</span>
                  <input inputMode="numeric" value={draft.mileage} onChange={(event) => setDraft((value) => ({ ...value, mileage: event.target.value }))} placeholder="45000" />
                </label>
                <label className="lst-field"><span>Transmission</span>
                  <select value={draft.transmission} onChange={(event) => setDraft((value) => ({ ...value, transmission: event.target.value }))}>
                    <option value="">Select transmission</option>
                    {transmissionOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Fuel type</span>
                  <select value={draft.fuelType} onChange={(event) => setDraft((value) => ({ ...value, fuelType: event.target.value }))}>
                    <option value="">Select fuel type</option>
                    {fuelOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Drivetrain</span>
                  <select value={draft.drivetrain} onChange={(event) => setDraft((value) => ({ ...value, drivetrain: event.target.value }))}>
                    <option value="">Select drivetrain</option>
                    {drivetrainOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Exterior color</span>
                  <select value={draft.exteriorColor} onChange={(event) => setDraft((value) => ({ ...value, exteriorColor: event.target.value }))}>
                    <option value="">Select color</option>
                    {colorOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Interior color</span>
                  <select value={draft.interiorColor} onChange={(event) => setDraft((value) => ({ ...value, interiorColor: event.target.value }))}>
                    <option value="">Select color</option>
                    {colorOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>VIN</span>
                  <input value={draft.vin} onChange={(event) => setDraft((value) => ({ ...value, vin: event.target.value }))} placeholder="17-character VIN" />
                </label>
                <label className="lst-field"><span>Stock number</span>
                  <input value={draft.stockNumber} onChange={(event) => setDraft((value) => ({ ...value, stockNumber: event.target.value }))} placeholder="Optional" />
                </label>

                <div className="lst-form-section">Pricing &amp; status</div>
                <label className="lst-field"><span>Price (USD)</span>
                  <input inputMode="decimal" value={draft.price} onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))} placeholder="15000" />
                </label>
                <label className="lst-field"><span>Status</span>
                  <select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
                    {listingStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Financing note</span>
                  <input value={draft.financingNote} onChange={(event) => setDraft((value) => ({ ...value, financingNote: event.target.value }))} placeholder="e.g. Financing available" />
                </label>
                <label className="lst-check wide">
                  <input type="checkbox" checked={draft.isNegotiable} onChange={(event) => setDraft((value) => ({ ...value, isNegotiable: event.target.checked }))} />
                  <span>Price is negotiable</span>
                </label>

                <div className="lst-form-section">Location</div>
                <label className="lst-field wide"><span>Address</span>
                  <input value={draft.locationAddressLine1} onChange={(event) => setDraft((value) => ({ ...value, locationAddressLine1: event.target.value }))} placeholder="Street address (optional)" />
                </label>
                <label className="lst-field"><span>State</span>
                  <select value={draft.locationState} onChange={(event) => setDraft((value) => ({ ...value, locationState: event.target.value, locationCity: "" }))}>
                    <option value="">Select state</option>
                    {selectableStateOptions(draft.locationState).map((state) => (
                      <option key={state.code} value={state.code}>{state.name}</option>
                    ))}
                  </select>
                </label>
                <label className="lst-field"><span>City</span>
                  <select value={draft.locationCity} onChange={(event) => setDraft((value) => ({ ...value, locationCity: event.target.value }))} disabled={!draft.locationState}>
                    <option value="">{draft.locationState ? "Select city" : "Select state first"}</option>
                    {cityOptions.map((city) => (<option key={city} value={city}>{city}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>ZIP / postal code</span>
                  <input value={draft.locationPostalCode} onChange={(event) => setDraft((value) => ({ ...value, locationPostalCode: event.target.value }))} placeholder="30301" />
                </label>

                <div className="lst-form-section">Contact</div>
                <label className="lst-field"><span>Contact name</span>
                  <input value={draft.contactName} onChange={(event) => setDraft((value) => ({ ...value, contactName: event.target.value }))} placeholder="Sales contact" />
                </label>
                <label className="lst-field"><span>Contact phone</span>
                  <input value={draft.contactPhone} onChange={(event) => setDraft((value) => ({ ...value, contactPhone: event.target.value }))} placeholder="+1 555 123 4567" />
                </label>
                <label className="lst-field wide"><span>Contact email</span>
                  <input value={draft.contactEmail} onChange={(event) => setDraft((value) => ({ ...value, contactEmail: event.target.value }))} placeholder="sales@business.com" />
                </label>

                <div className="lst-form-section">Features</div>
                <div className="lst-chips wide">
                  {featureOptions.map((feature) => (
                    <button
                      key={feature}
                      type="button"
                      className={`lst-chip ${draft.features.includes(feature) ? "on" : ""}`}
                      onClick={() => toggleFeature(feature)}
                    >
                      {optionLabel(feature)}
                    </button>
                  ))}
                </div>

                <div className="lst-form-section">Photos ({images.length}/{MAX_LISTING_IMAGES}) — first photo is the cover</div>
                <div className="lst-photos wide">
                  {images.map((image, index) => (
                    <div className={`lst-photo ${index === 0 ? "cover" : ""}`} key={image.key}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.preview} alt={`Photo ${index + 1}`} />
                      {index === 0 && <span className="lst-photo-badge">Cover</span>}
                      <div className="lst-photo-actions">
                        {index !== 0 && (
                          <button type="button" title="Set as cover" onClick={() => makeCover(index)}><Star size={14} /></button>
                        )}
                        <button type="button" title="Remove" onClick={() => removeImage(index)}><X size={14} /></button>
                      </div>
                    </div>
                  ))}
                  {images.length < MAX_LISTING_IMAGES && (
                    <label className="lst-photo-add">
                      <input type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(event) => { addImageFiles(event.target.files); event.target.value = ""; }} />
                      <Plus size={20} />
                      <span>Add photos</span>
                    </label>
                  )}
                </div>
                <div className="lst-field wide"><span>Add a photo by URL</span>
                  <div className="lst-url-row">
                    <input value={imageUrlInput} onChange={(event) => setImageUrlInput(event.target.value)} placeholder="https://…" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addImageUrl(); } }} />
                    <button type="button" className="lst-btn ghost" onClick={addImageUrl} disabled={!imageUrlInput.trim() || images.length >= MAX_LISTING_IMAGES}>Add</button>
                  </div>
                </div>

                <div className="lst-form-section">Description</div>
                <label className="lst-field wide"><span>Description</span>
                  <textarea rows={4} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} placeholder="Describe the vehicle, history, condition, extras…" />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => runPanelAction(setBusy, setMessage, "Listing saved.", saveListing)}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busy ? "Saving..." : editingId ? "Save changes" : "Create listing"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

function statusTone(status: string) {
  switch (status) {
    case "active": return "ok";
    case "reserved": return "warn";
    case "sold": return "navy";
    case "inactive": return "muted";
    default: return "muted";
  }
}

const barrelStatuses = ["pending_payment", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"];
const poolStatuses = ["open", "partially_filled", "full", "pending_seal", "sealed", "cancelled", "expired"];

function barrelTone(status: string) {
  switch (status) {
    case "completed": return "ok";
    case "in_transit": case "ready_for_pickup": return "navy";
    case "cancelled": return "muted";
    default: return "warn";
  }
}

function publicParticipantRows(value: unknown) {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, Record<string, unknown>>).map(([uid, item]) => ({
    uid,
    role: text(item.role, "joiner"),
    sharesClaimed: Number(item.sharesClaimed ?? 0),
    joinStatus: text(item.joinStatus, "requested"),
    paymentStatus: text(item.paymentStatus, "pending"),
  }));
}

function shareSummary(openShares: unknown, totalShares: unknown) {
  const open = Number(openShares ?? 0);
  const total = Number(totalShares ?? 0);
  return currentLanguage() === "fr"
    ? `${open} ouvertes / ${total} totales`
    : `${open} open / ${total} total`;
}

function shareRequestSummary(shares: unknown) {
  const count = Number(shares ?? 0);
  return currentLanguage() === "fr"
    ? `${count} part${count === 1 ? "" : "s"} demandée${count === 1 ? "" : "s"}`
    : `${count} share${count === 1 ? "" : "s"} requested`;
}

function deadlineHasPassed(value: unknown) {
  if (!value) return false;
  if (typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return ((value as { toMillis: () => number }).toMillis()) <= Date.now();
  }
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return ((value as { toDate: () => Date }).toDate()).getTime() <= Date.now();
  }
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) && parsed <= Date.now();
}

export function BarrelsPanel({ businessId, previewMode = false, onOpenDestinations }: PanelProps) {
  const sharedBarrelsEnabled = useSharedBarrelsEnabled();
  const enabled = Boolean(businessId && !previewMode);
  const shipments = useBusinessRows("barrelShipments", businessId, enabled, 500);
  const pools = useBusinessRows("barrelPools", businessId, enabled, 500);
  const balanceRequests = useBusinessRows("barrelPoolBalanceRequests", businessId, enabled, 500);
  const destinations = useBusinessSubcollectionRows("destinationCountries", businessId, enabled, 100);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [poolFilter, setPoolFilter] = useState("all");
  const [poolFormOpen, setPoolFormOpen] = useState(false);
  const [poolDraft, setPoolDraft] = useState<PoolDraft>(() => defaultPoolDraft());
  const [poolFormError, setPoolFormError] = useState("");
  const [poolFormErrorField, setPoolFormErrorField] =
    useState<SharedBarrelPoolField | null>(null);
  const [poolCreationId, setPoolCreationId] = useState("");
  const poolCreateInFlight = useRef(false);
  const [adjustingPool, setAdjustingPool] = useState<FirestoreRow | null>(null);
  const [adjustDraft, setAdjustDraft] = useState({ totalShares: "2", inspectionNote: "" });
  const [rollingPool, setRollingPool] = useState<FirestoreRow | null>(null);
  const [rollDraft, setRollDraft] = useState<PoolRolloverDraft>(() => defaultPoolRolloverDraft());
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [copied, setCopied] = useState("");

  const searched = useMemo(
    () => filterRows(shipments.rows, search, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "status", "paymentStatus"]),
    [shipments.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [searched, filter],
  );
  const searchedPools = useMemo(
    () => filterRows(pools.rows, search, ["trackingCode", "businessName", "destinationCountryName", "status", "origin", "shipMode"]),
    [pools.rows, search],
  );
  const filteredPools = useMemo(
    () => (poolFilter === "all" ? searchedPools : searchedPools.filter((row) => text(row.status, "") === poolFilter)),
    [poolFilter, searchedPools],
  );
  const activeDestinations = useMemo(
    () =>
      destinations.rows
        .filter((row) => row.isActive !== false && Number(row.barrelShippingPrice) > 0)
        .sort((a, b) => countryName(a.id).localeCompare(countryName(b.id))),
    [destinations.rows],
  );

  useEffect(() => {
    if (!poolFormOpen || !poolFormErrorField) return;
    const nextError = validateSharedBarrelPoolDraft(businessId, poolDraft);
    if (!nextError || nextError.field !== poolFormErrorField) {
      setPoolFormError("");
      setPoolFormErrorField(null);
    }
  }, [
    businessId,
    poolDraft,
    poolFormErrorField,
    poolFormOpen,
  ]);

  async function run(
    id: string,
    label: string,
    action: () => Promise<unknown>,
    confirm?: string,
    confirmFr?: string,
  ) {
    if (confirm && !(await confirmImportantAction(confirm, confirmFr))) return;
    setBusyId(id);
    setMessage("");
    try {
      await action();
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  function updateStatus(row: FirestoreRow, status: string) {
    return setDoc(doc(db, "barrelShipments", row.id), { businessId, status, updatedAt: serverTimestamp() }, { merge: true });
  }
  function sealPool(row: FirestoreRow, shipUnderfilled = false) {
    return httpsCallable(functions, "sealBarrelPool")({ poolId: row.id, shipUnderfilled });
  }
  function cancelPool(row: FirestoreRow) {
    return httpsCallable(functions, "cancelBarrelPool")({ poolId: row.id });
  }
  function decideJoin(row: FirestoreRow, participantUid: string, decision: "accept" | "reject") {
    return httpsCallable(functions, "decideBarrelPoolJoin")({ poolId: row.id, participantUid, decision });
  }
  function markBalanceCollected(requestId: string, note: string) {
    return httpsCallable(functions, "markBarrelPoolBalanceCollected")({
      requestId,
      note,
    });
  }
  function openAdjustPool(row: FirestoreRow) {
    setAdjustingPool(row);
    setAdjustDraft({
      totalShares: numberString(row.totalShares) || "2",
      inspectionNote: "",
    });
    setMessage("");
  }
  function closeAdjustPool() {
    setAdjustingPool(null);
    setAdjustDraft({ totalShares: "2", inspectionNote: "" });
  }
  function openRollPool(row: FirestoreRow) {
    setRollingPool(row);
    setRollDraft(defaultPoolRolloverDraft(row));
    setMessage("");
  }
  function closeRollPool() {
    setRollingPool(null);
    setRollDraft(defaultPoolRolloverDraft());
  }
  async function savePoolAdjustment() {
    if (!adjustingPool) throw new Error("Choose a shared barrel pool.");
    const totalShares = Number(adjustDraft.totalShares);
    const takenShares = Number(adjustingPool.takenShares ?? 0);
    if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > 4) {
      throw new Error("Adjusted total shares must be between 2 and 4.");
    }
    if (totalShares < takenShares) {
      throw new Error("Adjusted total shares cannot be below reserved shares.");
    }
    if (!adjustDraft.inspectionNote.trim()) {
      throw new Error("Inspection note is required.");
    }
    await httpsCallable(functions, "adjustBarrelPoolCapacity")({
      poolId: adjustingPool.id,
      totalShares,
      inspectionNote: adjustDraft.inspectionNote.trim(),
    });
    closeAdjustPool();
  }
  async function submitPoolAdjustment() {
    try {
      if (!adjustingPool) throw new Error("Choose a shared barrel pool.");
      const totalShares = Number(adjustDraft.totalShares);
      const takenShares = Number(adjustingPool.takenShares ?? 0);
      if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > 4) {
        throw new Error("Adjusted total shares must be between 2 and 4.");
      }
      if (totalShares < takenShares) {
        throw new Error("Adjusted total shares cannot be below reserved shares.");
      }
      if (!adjustDraft.inspectionNote.trim()) {
        throw new Error("Inspection note is required.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
      return;
    }
    if (!(await confirmImportantAction(
      "Save this shared-barrel capacity adjustment?",
      "Enregistrer cet ajustement de capacité du baril partagé ?",
    ))) return;
    void run(
      `pool-adjust-${adjustingPool.id}`,
      "Pool capacity adjusted.",
      savePoolAdjustment,
    );
  }
  async function savePoolRollover() {
    if (!rollingPool) throw new Error("Choose a shared barrel pool.");
    const maxJoiners = Number(rollDraft.maxJoiners);
    const deadlineMillis = new Date(rollDraft.joinDeadline).getTime();
    if (!Number.isFinite(deadlineMillis) || deadlineMillis <= Date.now()) {
      throw new Error("Choose a future matching deadline.");
    }
    if (!Number.isInteger(maxJoiners) || maxJoiners < 1) {
      throw new Error("Enter at least 1 max joiner.");
    }
    await httpsCallable(functions, "rollBarrelPoolToBusinessHeld")({
      poolId: rollingPool.id,
      joinDeadline: rollDraft.joinDeadline,
      maxJoiners,
      note: rollDraft.note.trim(),
    });
    closeRollPool();
  }
  async function submitPoolRollover() {
    try {
      if (!rollingPool) throw new Error("Choose a shared barrel pool.");
      const maxJoiners = Number(rollDraft.maxJoiners);
      const deadlineMillis = new Date(rollDraft.joinDeadline).getTime();
      if (!Number.isFinite(deadlineMillis) || deadlineMillis <= Date.now()) {
        throw new Error("Choose a future matching deadline.");
      }
      if (!Number.isInteger(maxJoiners) || maxJoiners < 1) {
        throw new Error("Enter at least 1 max joiner.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
      return;
    }
    if (!(await confirmImportantAction(
      "Roll this pool into business-held matching?",
      "Basculer ce baril vers la mise en relation gérée par l’entreprise ?",
    ))) return;
    void run(
      `pool-roll-${rollingPool.id}`,
      "Pool rolled into business-held matching.",
      savePoolRollover,
    );
  }
  function openPoolForm() {
    setPoolDraft(defaultPoolDraft(activeDestinations[0]?.id ?? ""));
    setPoolCreationId(
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pool-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    setMessage("");
    setPoolFormError("");
    setPoolFormErrorField(null);
    setPoolFormOpen(true);
  }
  function closePoolForm(force = false) {
    if (poolCreateInFlight.current && !force) return;
    setPoolFormOpen(false);
    setPoolDraft(defaultPoolDraft(activeDestinations[0]?.id ?? ""));
    setPoolCreationId("");
    setPoolFormError("");
    setPoolFormErrorField(null);
  }
  async function savePool() {
    const validationError = validateSharedBarrelPoolDraft(
      businessId,
      poolDraft,
    );
    if (validationError) throw new Error(validationError.message);
    const totalShares = Number(poolDraft.totalShares);
    const reservedShares = Number(poolDraft.reservedShares);
    const maxJoiners = Number(poolDraft.maxJoiners);
    await httpsCallable(functions, "createBusinessBarrelPool")({
      businessId,
      creationId: poolCreationId,
      destinationCountryId: poolDraft.destinationCountryId,
      origin: poolDraft.origin,
      totalShares,
      reservedShares,
      maxJoiners,
      approvalMode: poolDraft.approvalMode,
      shipMode: poolDraft.shipMode,
      joinDeadline: sharedBarrelDeadlineIso(poolDraft.joinDeadline),
      senderName: poolDraft.senderName,
      senderAddress: poolDraft.senderAddress,
      receiverName: poolDraft.receiverName,
      receiverPhone: poolDraft.receiverPhone,
      contentsDescription: poolDraft.contentsDescription,
      attestedWeightKg: Number(poolDraft.attestedWeightKg || 0),
      contentsAttested: poolDraft.contentsAttested,
      prohibitedItemsAcknowledged: poolDraft.prohibitedItemsAcknowledged,
      sharedLiabilityAccepted: poolDraft.sharedLiabilityAccepted,
    });
    closePoolForm(true);
  }
  function focusPoolField(field: SharedBarrelPoolField) {
    if (field === "businessId") return;
    window.requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>(
        `[data-pool-field="${field}"]`,
      );
      target?.focus();
    });
  }
  async function createPool() {
    const validationError = validateSharedBarrelPoolDraft(
      businessId,
      poolDraft,
    );
    if (validationError) {
      setPoolFormError(validationError.message);
      setPoolFormErrorField(validationError.field);
      focusPoolField(validationError.field);
      return;
    }
    if (poolCreateInFlight.current) return;
    poolCreateInFlight.current = true;
    if (
      !(await confirmImportantAction(
        "Open this shared barrel pool?",
        "Ouvrir ce baril partagé ?",
      ))
    ) {
      poolCreateInFlight.current = false;
      return;
    }

    setBusyId("pool-create");
    setMessage("");
    setPoolFormError("");
    setPoolFormErrorField(null);
    try {
      await savePool();
      setMessage("Shared barrel pool opened.");
    } catch (error) {
      setPoolFormError(sharedBarrelPoolErrorMessage(error));
    } finally {
      poolCreateInFlight.current = false;
      setBusyId("");
    }
  }
  async function copyTracking(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      window.setTimeout(() => setCopied(""), 1500);
    } catch { /* clipboard blocked */ }
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Barrel shipments</h2>
          <p>{shipments.rows.length === 0
            ? "Barrels customers send through your business appear here."
            : currentLanguage() === "fr"
              ? `${shipments.rows.length} expédition${shipments.rows.length === 1 ? "" : "s"}`
              : `${shipments.rows.length} shipment${shipments.rows.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="lst-head-actions"><StatusText busy={Boolean(busyId)} message={message} /></div>
      </header>

      {shipments.error && <div className="error-box">{shipments.error}</div>}
      {pools.error && <div className="error-box">{pools.error}</div>}
      {balanceRequests.error && <div className="error-box">{balanceRequests.error}</div>}
      {destinations.error && <div className="error-box">{destinations.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tracking, sender, receiver, phone…" />
        </div>
        <select className="lst-status-select" style={{ flex: "0 0 auto", minWidth: 150 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {barrelStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
        </select>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("barrel-shipments.csv", filteredRows, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "price", "status", "paymentStatus", "updatedAt"])}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {sharedBarrelsEnabled && (
      <>
      <div className="lst-subsection">
        <div className="lst-subhead">
          <div>
            <h3>Shared barrel pools</h3>
            <p>{pools.rows.length === 0
              ? "Open pooled barrels, approve joiners, and seal full barrels into tracked shipments."
              : currentLanguage() === "fr"
                ? `${pools.rows.length} baril partagé${pools.rows.length === 1 ? "" : "s"}`
                : `${pools.rows.length} pool${pools.rows.length === 1 ? "" : "s"}`}</p>
          </div>
          <div className="pool-head-actions">
            <button className="lst-add" type="button" disabled={activeDestinations.length === 0 || Boolean(busyId)} onClick={openPoolForm}>
              <Plus size={16} /> Start pool
            </button>
            <select className="lst-status-select" value={poolFilter} onChange={(event) => setPoolFilter(event.target.value)}>
              <option value="all">All pool statuses</option>
              {poolStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
            </select>
          </div>
        </div>
        {activeDestinations.length === 0 && (
          <div className="pool-config-note actionable">
            <div>
              <strong>Destination setup needed</strong>
              <span>Shared pools need one active priced destination before you can start one.</span>
            </div>
            {onOpenDestinations && (
              <button className="lst-btn" type="button" onClick={onOpenDestinations}>
                <MapPinned size={15} /> Set up destinations
              </button>
            )}
          </div>
        )}
        {pools.loading && <LoadingState />}
        {!pools.loading && pools.rows.length === 0 && (
          <div className="lst-empty compact">
            <div className="lst-empty-icon"><Package size={26} /></div>
            <h3>No shared barrel pools yet</h3>
            <p>Customer-posted, drop-off, and business-held consolidation pools will appear here.</p>
          </div>
        )}
        {!pools.loading && pools.rows.length > 0 && filteredPools.length === 0 && (
          <EmptyState text="No shared barrel pools match this filter." />
        )}
        <div className="pur-grid">
          {filteredPools.map((row) => {
            const status = text(row.status, "open");
            const tracking = text(row.trackingCode, row.id);
            const participants = publicParticipantRows(row.publicParticipants);
            const requested = participants.filter((item) => item.joinStatus === "requested");
            const canSeal = ["full", "pending_seal"].includes(status);
            const canSealUnderfilled = ["open", "partially_filled"].includes(status) && Number(row.acceptedShares ?? 0) > 0 && Number(row.openShares ?? 0) > 0 && deadlineHasPassed(row.joinDeadline);
            const canRollToBusinessHeld = ["open", "partially_filled"].includes(status) && text(row.origin, "") !== "businessHeld" && Number(row.openShares ?? 0) > 0 && deadlineHasPassed(row.joinDeadline);
            const canAdjust = ["open", "partially_filled", "full", "pending_seal"].includes(status);
            const pendingBalances = balanceRequests.rows.filter((request) =>
              text(request.barrelPoolId, "") === row.id &&
              text(request.status, "pending") === "pending",
            );
            const lastAdjustment = row.lastShareAdjustment && typeof row.lastShareAdjustment === "object"
              ? row.lastShareAdjustment as Record<string, unknown>
              : null;
            const busy = busyId === `pool-${row.id}`;
            return (
              <article className="pur-card" key={`pool-${row.id}`}>
                <div className="pur-head">
                  <div className="pur-title">
                    <button className="bar-track" type="button" title="Copy tracking code" onClick={() => copyTracking(tracking)}>
                      {tracking} <Copy size={13} />
                    </button>
                    <span className="pur-kind">Shared barrel pool</span>
                  </div>
                  <span className={`lst-badge ${barrelTone(status)}`}>{statusLabel(status)}</span>
                </div>
                <div className="pur-info">
                  <div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                  <div><span>Shares</span><b>{shareSummary(row.openShares, row.totalShares)}</b></div>
                  <div><span>Accepted</span><b>{Number(row.acceptedShares ?? 0)}</b></div>
                  <div><span>Requested</span><b>{Number(row.requestedShares ?? 0)}</b></div>
                  <div><span>Per share</span><b>{formatMoney(row.pricePerShare)}</b></div>
                  <div><span>Deposit</span><b>{formatMoney(row.depositPerShare)}</b></div>
                  <div><span>Origin</span><b>{statusLabel(text(row.origin, "customerPosted"))}</b></div>
                  <div><span>Deadline</span><b>{formatDate(row.joinDeadline)}</b></div>
                  {lastAdjustment && <div><span>Last inspection</span><b>{shareSummary(lastAdjustment.openShares, lastAdjustment.totalShares)}</b></div>}
                  {Number(row.grossAmount ?? 0) > 0 && <div><span>Gross</span><b>{formatMoney(row.grossAmount)}</b></div>}
                  {Number(row.businessPayoutAmount ?? 0) > 0 && <div><span>Business payout</span><b>{formatMoney(row.businessPayoutAmount)}</b></div>}
                  {Number(row.platformCommissionAmount ?? 0) > 0 && <div><span>Platform fee</span><b>{formatMoney(row.platformCommissionAmount)}</b></div>}
                </div>
                {lastAdjustment && text(lastAdjustment.inspectionNote, "") && (
                  <div className="pur-notice">
                    <Pencil size={15} /> Inspection note: {text(lastAdjustment.inspectionNote, "")}
                  </div>
                )}
                {requested.length > 0 && (
                  <div className="pool-requests">
                    {requested.map((participant) => (
                      <div className="pool-request" key={participant.uid}>
                        <span>{shareRequestSummary(participant.sharesClaimed)}</span>
                        <div className="row-actions">
                          <button
                            className="lst-btn"
                            disabled={busy}
                            type="button"
                            onClick={() => run(
                              `pool-${row.id}`,
                              "Joiner accepted.",
                              () => decideJoin(row, participant.uid, "accept"),
                              "Approve this shared-barrel join request?",
                              "Approuver cette demande de participation au baril partagé ?",
                            )}
                          >
                            Approve
                          </button>
                          <button
                            className="lst-btn ghost"
                            disabled={busy}
                            type="button"
                            onClick={() => run(
                              `pool-${row.id}`,
                              "Joiner rejected.",
                              () => decideJoin(row, participant.uid, "reject"),
                              "Reject this shared-barrel join request?",
                              "Rejeter cette demande de participation au baril partagé ?",
                            )}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {pendingBalances.length > 0 && (
                  <div className="pool-requests">
                    {pendingBalances.map((request) => (
                      <div className="pool-request" key={request.id}>
                        <span>
                          {text(request.customerName ?? request.customerEmail ?? request.participantUid, "Customer")} · {formatMoney(request.amount, text(request.currency, "USD"))} · {statusLabel(request.status)}
                          {Number(request.underfilledAmount ?? 0) > 0 && (
                            <> · <span>Underfilled</span> {formatMoney(request.underfilledAmount, text(request.currency, "USD"))}</>
                          )}
                        </span>
                        <div className="row-actions">
                          <button
                            className="lst-btn"
                            disabled={busy}
                            type="button"
	                            onClick={() => {
	                              const note = window.prompt("Collection note (optional)") || "";
	                              run(
	                                `pool-${row.id}`,
	                                "Shared barrel balance collected.",
	                                () => markBalanceCollected(request.id, note),
	                                "Mark this shared barrel balance as collected?",
	                                "Marquer ce solde de baril partagé comme encaissé ?",
	                              );
	                            }}
                          >
                            <CheckCircle2 size={15} /> Mark collected
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="pur-actions">
                  <button
                    className="lst-btn"
                    disabled={!canSeal || busy}
                    type="button"
                    onClick={() => run(
                      `pool-${row.id}`,
                      "Pool sealed into a shipment.",
                      () => sealPool(row),
                      "Seal this shared barrel pool into a shipment?",
                      "Sceller ce baril partagé en expédition ?",
                    )}
                  >
                    <CheckCircle2 size={15} /> Seal pool
                  </button>
                  <button
                    className="lst-btn ghost"
                    disabled={!canSealUnderfilled || busy}
                    title={canSealUnderfilled ? "Seal after deadline" : "Underfilled pools can only ship after the join deadline"}
                    type="button"
                    onClick={() => run(
                      `pool-${row.id}`,
                      "Underfilled pool sealed into a shipment.",
                      () => sealPool(row, true),
                      "Seal this underfilled pool into a shipment?",
                      "Sceller ce baril incomplet en expédition ?",
                    )}
                  >
                    <CheckCircle2 size={15} /> Seal underfilled
                  </button>
                  <button className="lst-btn ghost" disabled={!canRollToBusinessHeld || busy} title={canRollToBusinessHeld ? "Continue matching at the business" : "Only underfilled pools past the join deadline can roll over"} type="button" onClick={() => openRollPool(row)}>
                    <RotateCcw size={15} /> Roll to business-held
                  </button>
                  <button className="lst-btn ghost" disabled={!canAdjust || busy} type="button" onClick={() => openAdjustPool(row)}>
                    <Pencil size={15} /> Adjust shares
                  </button>
                  <button
                    className="lst-btn ghost"
                    disabled={status === "sealed" || status === "cancelled" || busy}
                    type="button"
                    onClick={() => run(
                      `pool-${row.id}`,
                      "Pool cancelled.",
                      () => cancelPool(row),
                      "Cancel this shared barrel pool?",
                      "Annuler ce baril partagé ?",
                    )}
                  >
                    <XCircle size={15} /> Cancel pool
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {adjustingPool && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (busyId !== `pool-adjust-${adjustingPool.id}`) closeAdjustPool();
        }}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Adjust inspected shares</h3>
              <button className="lst-icon-btn" type="button" disabled={busyId === `pool-adjust-${adjustingPool.id}`} onClick={closeAdjustPool} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="pool-config-note">
                Update total shares only after physical inspection. The total cannot be lower than already reserved shares.
              </div>
              <div className="lst-form-grid">
                <label className="lst-field"><span>Current shares</span>
                  <input readOnly value={shareSummary(adjustingPool.openShares, adjustingPool.totalShares)} />
                </label>
                <label className="lst-field"><span>Reserved shares</span>
                  <input readOnly value={Number(adjustingPool.takenShares ?? 0)} />
                </label>
                <label className="lst-field"><span>Inspected total shares</span>
                  <select value={adjustDraft.totalShares} onChange={(event) => setAdjustDraft((value) => ({ ...value, totalShares: event.target.value }))}>
                    <option value="2">2 halves</option>
                    <option value="3">3 shares</option>
                    <option value="4">4 quarters</option>
                  </select>
                </label>
                <label className="lst-field wide"><span>Inspection note</span>
                  <textarea rows={3} value={adjustDraft.inspectionNote} onChange={(event) => setAdjustDraft((value) => ({ ...value, inspectionNote: event.target.value }))} placeholder="Explain measured capacity or packing mismatch" />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busyId === `pool-adjust-${adjustingPool.id}`} onClick={closeAdjustPool}>Cancel</button>
	              <button
	                className="lst-add"
	                type="button"
	                disabled={busyId === `pool-adjust-${adjustingPool.id}`}
	                aria-busy={busyId === `pool-adjust-${adjustingPool.id}`}
	                onClick={submitPoolAdjustment}
	              >
                {busyId === `pool-adjust-${adjustingPool.id}` ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busyId === `pool-adjust-${adjustingPool.id}` ? "Saving..." : "Save adjustment"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {rollingPool && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (busyId !== `pool-roll-${rollingPool.id}`) closeRollPool();
        }}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Roll to business-held</h3>
              <button className="lst-icon-btn" type="button" disabled={busyId === `pool-roll-${rollingPool.id}`} onClick={closeRollPool} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="pool-config-note">
                Use this when an underfilled customer or drop-off pool reached its deadline and the business will keep matching the open shares.
              </div>
              <div className="lst-form-grid">
                <label className="lst-field"><span>Open shares</span>
                  <input readOnly value={shareSummary(rollingPool.openShares, rollingPool.totalShares)} />
                </label>
                <label className="lst-field"><span>Current origin</span>
                  <input readOnly value={statusLabel(rollingPool.origin)} />
                </label>
                <label className="lst-field"><span>New matching deadline</span>
                  <input type="date" value={rollDraft.joinDeadline} onChange={(event) => setRollDraft((value) => ({ ...value, joinDeadline: event.target.value }))} />
                </label>
                <label className="lst-field"><span>Max joiners</span>
                  <input inputMode="numeric" value={rollDraft.maxJoiners} onChange={(event) => setRollDraft((value) => ({ ...value, maxJoiners: event.target.value }))} />
                </label>
                <label className="lst-field wide"><span>Rollover note</span>
                  <textarea rows={3} value={rollDraft.note} onChange={(event) => setRollDraft((value) => ({ ...value, note: event.target.value }))} placeholder="Example: customer dropped the barrel at the hub for continued matching" />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busyId === `pool-roll-${rollingPool.id}`} onClick={closeRollPool}>Cancel</button>
	              <button
	                className="lst-add"
	                type="button"
	                disabled={busyId === `pool-roll-${rollingPool.id}`}
	                aria-busy={busyId === `pool-roll-${rollingPool.id}`}
	                onClick={submitPoolRollover}
	              >
                {busyId === `pool-roll-${rollingPool.id}` ? <RefreshCw className="spin" size={16} /> : <RotateCcw size={16} />}
                {busyId === `pool-roll-${rollingPool.id}` ? "Saving..." : "Roll pool"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {poolFormOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="shared-pool-title" onClick={() => closePoolForm()}>
          <div className="lst-modal" style={{ maxWidth: 640 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3 id="shared-pool-title">Start shared barrel pool</h3>
              <button className="lst-icon-btn" type="button" disabled={busyId === "pool-create"} onClick={() => closePoolForm()} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {poolFormError && (
                <div
                  className="lst-form-error"
                  role="alert"
                  aria-live="assertive"
                >
                  {poolFormError}
                </div>
              )}
              <div className="lst-form-grid">
                <label className="lst-field"><span>Pool origin</span>
                  <select data-pool-field="origin" value={poolDraft.origin} onChange={(event) => setPoolDraft((value) => ({
                    ...value,
                    origin: event.target.value as PoolDraft["origin"],
                    reservedShares: event.target.value === "dropOff" ? "1" : "0",
                  }))}>
                    <option value="businessHeld">Business-held</option>
                    <option value="dropOff">Customer drop-off</option>
                  </select>
                </label>
                <SearchableSelect
                  className="lst-field"
                  dataField="destinationCountryId"
                  emptyMessage="No destinations match your search."
                  invalid={poolFormErrorField === "destinationCountryId"}
                  label="Destination"
                  listLabel="Destination country options"
                  onChange={(destinationCountryId) =>
                    setPoolDraft((value) => ({
                      ...value,
                      destinationCountryId,
                    }))
                  }
                  options={activeDestinations.map((row) => {
                    const country = countries.find(
                      (item) => item.id === row.id,
                    );
                    const code = text(
                      row.code ?? row.countryCode ?? country?.code,
                      "",
                    );
                    return {
                      label: `${countryFlag(code)} ${countryName(row.id)} · ${formatMoney(row.barrelShippingPrice)}`,
                      keywords: code,
                      value: row.id,
                    };
                  })}
                  placeholder="Search or choose a destination"
                  value={poolDraft.destinationCountryId}
                />
                <label className="lst-field"><span>Total shares</span>
                  <select data-pool-field="totalShares" aria-invalid={poolFormErrorField === "totalShares"} value={poolDraft.totalShares} onChange={(event) => setPoolDraft((value) => ({ ...value, totalShares: event.target.value }))}>
                    <option value="2">2 halves</option>
                    <option value="3">3 shares</option>
                    <option value="4">4 quarters</option>
                  </select>
                </label>
                <label className="lst-field"><span>Reserved shares</span>
                  <input data-pool-field="reservedShares" aria-invalid={poolFormErrorField === "reservedShares"} inputMode="numeric" value={poolDraft.reservedShares} onChange={(event) => setPoolDraft((value) => ({ ...value, reservedShares: event.target.value }))} placeholder={poolDraft.origin === "dropOff" ? "1" : "0"} />
                </label>
                <label className="lst-field"><span>Max joiners</span>
                  <input data-pool-field="maxJoiners" aria-invalid={poolFormErrorField === "maxJoiners"} inputMode="numeric" value={poolDraft.maxJoiners} onChange={(event) => setPoolDraft((value) => ({ ...value, maxJoiners: event.target.value }))} placeholder="2" />
                </label>
                <label className="lst-field"><span>Approval mode</span>
                  <select value={poolDraft.approvalMode} onChange={(event) => setPoolDraft((value) => ({ ...value, approvalMode: event.target.value as PoolDraft["approvalMode"] }))}>
                    <option value="approval">Manual approval</option>
                    <option value="auto">Auto approve</option>
                  </select>
                </label>
                <label className="lst-field"><span>Ship mode</span>
                  <select value={poolDraft.shipMode} onChange={(event) => setPoolDraft((value) => ({ ...value, shipMode: event.target.value as PoolDraft["shipMode"] }))}>
                    <option value="sea">Sea</option>
                    <option value="air">Air</option>
                  </select>
                </label>
                <label className="lst-field"><span>Join deadline</span>
                  <input data-pool-field="joinDeadline" aria-invalid={poolFormErrorField === "joinDeadline"} type="date" value={poolDraft.joinDeadline} onChange={(event) => setPoolDraft((value) => ({ ...value, joinDeadline: event.target.value }))} />
                </label>
                {poolDraft.origin === "dropOff" && (
                  <>
                    <label className="lst-field"><span>Sender name</span>
                      <input data-pool-field="senderName" aria-invalid={poolFormErrorField === "senderName"} value={poolDraft.senderName} onChange={(event) => setPoolDraft((value) => ({ ...value, senderName: event.target.value }))} placeholder="Customer name" />
                    </label>
                    <label className="lst-field"><span>Sender address</span>
                      <input value={poolDraft.senderAddress} onChange={(event) => setPoolDraft((value) => ({ ...value, senderAddress: event.target.value }))} placeholder="Optional" />
                    </label>
                    <label className="lst-field"><span>Receiver name</span>
                      <input data-pool-field="receiverName" aria-invalid={poolFormErrorField === "receiverName"} value={poolDraft.receiverName} onChange={(event) => setPoolDraft((value) => ({ ...value, receiverName: event.target.value }))} placeholder="Recipient name" />
                    </label>
                    <label className="lst-field"><span>Receiver phone</span>
                      <input data-pool-field="receiverPhone" aria-invalid={poolFormErrorField === "receiverPhone"} value={poolDraft.receiverPhone} onChange={(event) => setPoolDraft((value) => ({ ...value, receiverPhone: event.target.value }))} placeholder="+224…" />
                    </label>
                    <label className="lst-field wide"><span>Contents note</span>
                      <textarea data-pool-field="contentsDescription" aria-invalid={poolFormErrorField === "contentsDescription"} rows={2} value={poolDraft.contentsDescription} onChange={(event) => setPoolDraft((value) => ({ ...value, contentsDescription: event.target.value }))} placeholder="Describe packed contents" />
                      <small>Required for customer drop-off pools.</small>
                    </label>
                    <label className="lst-field"><span>Inspected weight (kg)</span>
                      <input data-pool-field="attestedWeightKg" aria-invalid={poolFormErrorField === "attestedWeightKg"} type="number" min="0" step="0.1" value={poolDraft.attestedWeightKg} onChange={(event) => setPoolDraft((value) => ({ ...value, attestedWeightKg: event.target.value }))} placeholder="20 kg per share max" />
                    </label>
                    <label className="lst-check wide">
                      <input data-pool-field="contentsAttested" aria-invalid={poolFormErrorField === "contentsAttested"} type="checkbox" checked={poolDraft.contentsAttested} onChange={(event) => setPoolDraft((value) => ({ ...value, contentsAttested: event.target.checked }))} />
                      <span>Contents and weight were reviewed with the customer.</span>
                    </label>
                    <label className="lst-check wide">
                      <input data-pool-field="prohibitedItemsAcknowledged" aria-invalid={poolFormErrorField === "prohibitedItemsAcknowledged"} type="checkbox" checked={poolDraft.prohibitedItemsAcknowledged} onChange={(event) => setPoolDraft((value) => ({ ...value, prohibitedItemsAcknowledged: event.target.checked }))} />
                      <span>No prohibited or unsafe items were accepted.</span>
                    </label>
                    <label className="lst-check wide">
                      <input data-pool-field="sharedLiabilityAccepted" aria-invalid={poolFormErrorField === "sharedLiabilityAccepted"} type="checkbox" checked={poolDraft.sharedLiabilityAccepted} onChange={(event) => setPoolDraft((value) => ({ ...value, sharedLiabilityAccepted: event.target.checked }))} />
                      <span>The customer accepted shared-barrel liability and inspection rules.</span>
                    </label>
                  </>
                )}
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busyId === "pool-create"} onClick={() => closePoolForm()}>Cancel</button>
	              <button
	                className="lst-add"
	                type="button"
	                disabled={busyId === "pool-create"}
	                aria-busy={busyId === "pool-create"}
	                onClick={createPool}
	              >
                {busyId === "pool-create" ? (
                  <><RefreshCw className="spin" size={16} /> Opening pool...</>
                ) : (
                  <><Save size={16} /> Open pool</>
                )}
              </button>
            </footer>
          </div>
        </div>
      )}
      </>
      )}

      {shipments.loading && <LoadingState />}
      {!shipments.loading && shipments.rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Package size={30} /></div>
          <h3>No barrel shipments yet</h3>
          <p>When customers book barrels to your destinations, they show up here to manage.</p>
        </div>
      )}
      {!shipments.loading && shipments.rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No shipments match this filter." />
      )}

      <div className="pur-grid">
        {filteredRows.map((row) => {
          const status = text(row.status, "pending");
          const paid = text(row.paymentStatus, "") === "paid";
          const busy = busyId === row.id;
          const tracking = text(row.trackingCode, row.id);
          return (
            <article className="pur-card" key={row.id}>
              <div className="pur-head">
                <div className="pur-title">
                  <button className="bar-track" type="button" title="Copy tracking code" onClick={() => copyTracking(tracking)}>
                    {tracking} <Copy size={13} />
                  </button>
                  <span className="pur-kind">{copied === tracking ? "Copied!" : "Tracking code"}</span>
                </div>
                <span className={`lst-badge ${barrelTone(status)}`}>{statusLabel(status)}</span>
              </div>

              <div className="pur-info">
                <div><span>Sender</span><b>{text(row.senderName, "—")}</b></div>
                <div><span>Receiver</span><b>{text(row.receiverName, "—")}</b></div>
                <div><span>Receiver phone</span><b>{text(row.receiverPhone, "—")}</b></div>
                <div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                <div><span>Payment</span><b>{statusLabel(text(row.paymentStatus, "not_required"))}</b></div>
                <div><span>Total</span><b>{formatMoney(row.price)}</b></div>
                {Number(row.shippingFee) > 0 && <div><span>Shipping fee</span><b>{formatMoney(row.shippingFee)}</b></div>}
                {row.pickupRequested === true && <div><span>Pickup fee</span><b>{formatMoney(row.pickupFee)}</b></div>}
                {(deliveryWindow(row) || text(row.deliveryEstimateLabel, "")) && <div><span>Delivery</span><b>{text(row.deliveryEstimateLabel, "") || deliveryWindow(row)}</b></div>}
                <div><span>Created</span><b>{formatDate(row.createdAt)}</b></div>
              </div>

              {row.pickupRequested === true && (
                <div className="pur-notice"><Truck size={15} /> Pickup: {[text(row.pickupAddress, ""), text(row.pickupBorough, ""), row.pickupDateTime ? formatDate(row.pickupDateTime) : ""].filter(Boolean).join(" · ") || "requested"}</div>
              )}
              {row.pricingPendingReview === true && (
                <div className="pur-notice warn"><AlertTriangle size={15} /> Pricing is pending review for this shipment.</div>
              )}

              <div className="pur-actions">
                <label className="bar-field"><span>Update status</span>
	                  <select
	                    value={status}
	                    disabled={busy}
	                    onChange={(event) => run(
	                      row.id,
	                      "Shipment updated.",
	                      () => updateStatus(row, event.target.value),
	                      `Change shipment status to ${statusLabel(event.target.value)}?`,
	                      `Changer le statut de l’expédition en ${statusLabel(event.target.value)} ?`,
	                    )}
	                  >
                    {barrelStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
              </div>

              <ContainerTrackingCard
                relatedCollection="barrelShipments"
                relatedId={row.id}
                containerNumber={text(row.containerNumber, "")}
                trackingProvider={text(row.trackingProvider, "")}
              />
              <TrackingUpdatesSection relatedCollection="barrelShipments" relatedId={row.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FreightPanel({ businessId, previewMode = false }: PanelProps) {
  const freight = useBusinessRows("freightShipments", businessId, Boolean(businessId && !previewMode), 500);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});

  const searched = useMemo(
    () => filterRows(freight.rows, search, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "freightMode", "status", "paymentStatus"]),
    [freight.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [filter, searched],
  );

  async function updateStatus(row: FirestoreRow, status: string) {
    const versionTwo = Number(row.freightPricingVersion ?? 0) >= 2;
    const settlementReady = !versionTwo || text(row.priceSettlementStatus, "") === "settled";
    if (["in_transit", "ready_for_pickup", "completed"].includes(status) && !settlementReady) {
      setMessage("Fulfillment is locked until the verified weight is settled.");
      return;
    }
    if (["completed", "cancelled"].includes(status) && !(await confirmImportantAction(
      `Change this freight shipment to ${statusLabel(status)}?`,
      `Passer cette expédition de fret au statut ${statusLabel(status)} ?`,
    ))) return;
    setBusyId(row.id);
    setMessage("");
    try {
      await setDoc(
        doc(db, "freightShipments", row.id),
        { businessId, status, statusUpdatedAt: serverTimestamp(), updatedAt: serverTimestamp() },
        { merge: true },
      );
      setMessage("Freight shipment updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  async function confirmWeight(row: FirestoreRow) {
    const verifiedWeightKg = Number(weightDrafts[row.id] ?? "");
    if (!Number.isFinite(verifiedWeightKg) || verifiedWeightKg <= 0) {
      setMessage("Enter a verified weight greater than zero.");
      return;
    }
    const rate = Number(row.pricePerKg ?? row.ratePerKg ?? 0);
    const pickup = Number(row.pickupFee ?? 0);
    const finalTotal = verifiedWeightKg * rate + pickup;
    const estimatedTotal = Number(row.estimatedTotal ?? row.price ?? 0);
    const difference = finalTotal - estimatedTotal;
    const adjustment = Math.abs(difference) < 0.005
      ? "No price change"
      : difference > 0
        ? `Customer owes ${formatMoney(difference)}`
        : `Refund customer ${formatMoney(-difference)}`;
    if (!(await confirmImportantAction(
      `Confirm ${verifiedWeightKg.toLocaleString()} kg as the final weight? ${adjustment}. Financial adjustments may begin immediately.`,
      `Confirmer ${verifiedWeightKg.toLocaleString()} kg comme poids final ? ${difference > 0 ? `Le client doit payer ${formatMoney(difference)}` : difference < 0 ? `Rembourser ${formatMoney(-difference)} au client` : "Aucun changement de prix"}. Les ajustements financiers peuvent commencer immédiatement.`,
    ))) return;
    setBusyId(row.id);
    setMessage("");
    try {
      await httpsCallable(functions, "confirmFreightShipmentWeight")({
        shipmentId: row.id,
        verifiedWeightKg,
      });
      setMessage("Verified weight and final price saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not confirm the weight. Try again.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Freight shipments</h2>
          <p>{freight.rows.length === 0
            ? "Paid parcel shipments will appear here for fulfillment."
            : currentLanguage() === "fr"
              ? `${freight.rows.length} expédition${freight.rows.length === 1 ? "" : "s"}`
              : `${freight.rows.length} shipment${freight.rows.length === 1 ? "" : "s"}`}</p>
        </div>
        <StatusText busy={Boolean(busyId)} message={message} />
      </header>
      {freight.error && <div className="error-box">{freight.error}</div>}
      <div className="lst-toolbar">
        <div className="lst-search"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search freight tracking, sender, receiver…" /></div>
        <select className="lst-status-select" style={{ flex: "0 0 auto", minWidth: 150 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {["pending_payment", "awaiting_weight_confirmation", "awaiting_balance_payment", "settlement_processing", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"].map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
        </select>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("freight-shipments.csv", filteredRows, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "freightMode", "estimatedWeightKg", "verifiedWeightKg", "pricePerKg", "estimatedTotal", "finalTotal", "priceSettlementStatus", "paymentStatus", "status", "updatedAt"])}><Download size={15} /> Export CSV</button>
      </div>
      {freight.loading && <LoadingState />}
      {!freight.loading && freight.rows.length === 0 && (
        <div className="lst-empty"><div className="lst-empty-icon"><Package size={30} /></div><h3>No freight shipments yet</h3><p>Configure air or sea rates under Destinations so customers can book freight.</p></div>
      )}
      {!freight.loading && freight.rows.length > 0 && filteredRows.length === 0 && <EmptyState text="No freight shipments match this filter." />}
      <div className="pur-grid">
        {filteredRows.map((row) => {
          const status = text(row.status, "pending");
          const paymentStatus = text(row.paymentStatus, "pending");
          const busy = busyId === row.id;
          const paymentReady = ["paid", "succeeded", "completed"].includes(paymentStatus);
          const versionTwo = Number(row.freightPricingVersion ?? 0) >= 2;
          const settlementStatus = text(row.priceSettlementStatus, versionTwo ? "awaiting_weight" : "legacy_settled");
          const settlementReady = !versionTwo || settlementStatus === "settled";
          const estimatedWeight = Number(row.estimatedWeightKg ?? row.weightKg ?? 0);
          const verifiedWeight = Number(row.verifiedWeightKg ?? 0);
          return (
            <article className="pur-card" key={row.id}>
              <div className="pur-head"><div className="pur-title"><strong>{text(row.trackingCode, row.id)}</strong><span className="pur-kind">{statusLabel(text(row.mode ?? row.freightMode, "freight"))}</span></div><span className={`lst-badge ${barrelTone(status)}`}>{statusLabel(status)}</span></div>
              <div className="pur-info">
                <div><span>Sender</span><b>{text(row.senderName, "—")}</b></div><div><span>Receiver</span><b>{text(row.receiverName, "—")}</b></div>
                <div><span>Receiver phone</span><b>{text(row.receiverPhone, "—")}</b></div><div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                <div><span>Estimated weight</span><b>{estimatedWeight.toLocaleString()} kg</b></div><div><span>Verified weight</span><b>{verifiedWeight > 0 ? `${verifiedWeight.toLocaleString()} kg` : "—"}</b></div>
                <div><span>Rate locked at booking</span><b>{formatMoney(row.pricePerKg ?? row.ratePerKg)} / kg</b></div><div><span>Estimated total</span><b>{formatMoney(row.estimatedTotal ?? row.price ?? row.total)}</b></div>
                <div><span>Final total</span><b>{row.finalTotal == null ? "—" : formatMoney(row.finalTotal)}</b></div><div><span>Settlement</span><b>{statusLabel(settlementStatus)}</b></div>
                <div><span>Payment</span><b>{statusLabel(paymentStatus)}</b></div><div><span>Created</span><b>{formatDate(row.createdAt)}</b></div>
              </div>
              {!paymentReady && <div className="pur-notice warn"><AlertTriangle size={15} /> Fulfillment is locked until payment succeeds.</div>}
              {paymentReady && !settlementReady && <div className="pur-notice warn"><AlertTriangle size={15} /> {settlementStatus === "balance_due" || settlementStatus === "balance_payment_pending" ? "Waiting for customer payment. Fulfillment remains locked." : settlementStatus === "needs_attention" ? "Settlement needs attention. Contact support before fulfillment." : "Confirm the parcel weight before fulfillment."}</div>}
              <div className="pur-actions">
                {versionTwo && verifiedWeight <= 0 && <label className="bar-field"><span>Enter verified weight</span><input aria-label="Enter verified weight" inputMode="decimal" value={weightDrafts[row.id] ?? ""} onChange={(event) => setWeightDrafts((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="0.0" /><button className="lst-btn primary" type="button" disabled={busy || !paymentReady} onClick={() => confirmWeight(row)}>Confirm weight and final price</button></label>}
                <label className="bar-field"><span>Update status</span><select value={status} disabled={busy || !paymentReady || !settlementReady} onChange={(event) => updateStatus(row, event.target.value)}>{["pending_payment", "awaiting_weight_confirmation", "awaiting_balance_payment", "settlement_processing", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"].map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}</select></label>
              </div>

              {text(row.mode ?? row.freightMode, "") === "sea" && (
                <ContainerTrackingCard
                  relatedCollection="freightShipments"
                  relatedId={row.id}
                  containerNumber={text(row.containerNumber, "")}
                  trackingProvider={text(row.trackingProvider, "")}
                />
              )}
              <TrackingUpdatesSection relatedCollection="freightShipments" relatedId={row.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

function transportTone(status: string) {
  switch (status) {
    case "delivered": return "ok";
    case "in_transit": case "scheduled": return "navy";
    case "cancelled": return "muted";
    default: return "warn";
  }
}

export function TransportPanel({ businessId, previewMode = false, focusRequestId = "" }: PanelProps) {
  const enabled = Boolean(businessId && !previewMode);
  const opportunities = useBusinessRows("transportOpportunities", businessId, enabled, 500);
  const businessQuotes = useBusinessRows("transportQuotes", businessId, enabled, 500);
  const transports = useBusinessRows("transportRequests", businessId, enabled, 500);
  const [view, setView] = useState<"opportunities" | "jobs">("opportunities");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [draft, setDraft] = useState<TransportQuoteDraft>(emptyTransportQuoteDraft);
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const focusedCardRef = useRef<HTMLElement | null>(null);

  // A notification points at one request. Show the view that contains it and
  // clear any search that would filter it out, otherwise the deep link lands
  // on a list where the request is not visible.
  useEffect(() => {
    if (!focusRequestId) return;
    setView("opportunities");
    setSearch("");
  }, [focusRequestId]);

  const quoteByRequest = useMemo(
    () =>
      new Map(
        businessQuotes.rows.map((quote) => [
          text(quote.requestId, ""),
          quote,
        ]),
      ),
    [businessQuotes.rows],
  );
  const filteredOpportunities = useMemo(
    () =>
      filterRows(opportunities.rows, search, [
        "trackingCode",
        "carMake",
        "carModel",
        "carYear",
        "pickupArea",
        "destinationCountryName",
        "status",
      ]),
    [opportunities.rows, search],
  );

  // The rows stream in from Firestore, so the target card usually does not
  // exist on the render that handles the notification - scroll once it does.
  useEffect(() => {
    if (!focusRequestId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequestId, filteredOpportunities]);

  const filteredJobs = useMemo(
    () =>
      filterRows(transports.rows, search, [
        "trackingCode",
        "ownerName",
        "customerName",
        "carMake",
        "carModel",
        "carYear",
        "vinNumber",
        "destinationCountryName",
        "status",
      ]),
    [transports.rows, search],
  );

  function openQuote(opportunity: FirestoreRow) {
    const requestId = text(opportunity.requestId, opportunity.id);
    const quote = quoteByRequest.get(requestId);
    setDraft({
      requestId,
      amount:
        Number(quote?.amountCents ?? 0) > 0
          ? String(Number(quote?.amountCents) / 100)
          : "",
      estimatedPickupDate: dateInputValue(quote?.estimatedPickupDate),
      estimatedDeliveryDate: dateInputValue(quote?.estimatedDeliveryDate),
      transportMethod:
        text(
          quote?.transportMethod ?? opportunity.requestedTransportMethod,
          "open",
        ) ===
        "enclosed"
          ? "enclosed"
          : "open",
      terms: text(quote?.terms, ""),
    });
    setMessage("");
    setQuoteFormOpen(true);
  }

  async function updateTransportStatus(row: FirestoreRow, status: string) {
    setBusyId(row.id);
    setMessage("");
    try {
      // flowVersion is the field the server actually writes and reads
      // (functions/index.js). transportMarketplaceVersion was never written by
      // anything, so this arm was dead and marketplace jobs could fall through
      // to the legacy direct write below.
      const isMarketplaceJob =
        Boolean(row.selectedQuoteId) ||
        text(row.quoteStatus, "") === "selected" ||
        Number(row.flowVersion ?? 0) >= 2;
      if (isMarketplaceJob) {
        await httpsCallable(functions, "updateTransportFulfillmentStatus")({
          requestId: row.id,
          status,
        });
      } else {
        // The mobile app reads `fulfillmentStatus ?? status`, so writing only
        // `status` here left it showing the stale fulfillmentStatus forever.
        await setDoc(doc(db, "transportRequests", row.id), { businessId, status, fulfillmentStatus: status, updatedAt: serverTimestamp() }, { merge: true });
      }
      setMessage("Transport updated.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "The transport status could not be updated. Try again.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function saveQuote() {
    if (!draft.requestId || busyId) return;
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage("Enter a valid quote amount.");
      return;
    }
    if (!draft.estimatedPickupDate || !draft.estimatedDeliveryDate) {
      setMessage("Pickup and delivery dates are required.");
      return;
    }
    if (
      new Date(draft.estimatedDeliveryDate).getTime() <
      new Date(draft.estimatedPickupDate).getTime()
    ) {
      setMessage("Estimated delivery must be after pickup.");
      return;
    }
    setBusyId(`quote:${draft.requestId}`);
    setMessage("");
    try {
      await httpsCallable(functions, "submitTransportQuote")({
        requestId: draft.requestId,
        amountCents: Math.round(amount * 100),
        currency: "usd",
        estimatedPickupDate: new Date(
          `${draft.estimatedPickupDate}T12:00:00`,
        ).toISOString(),
        estimatedDeliveryDate: new Date(
          `${draft.estimatedDeliveryDate}T12:00:00`,
        ).toISOString(),
        transportMethod: draft.transportMethod,
        terms: draft.terms.trim(),
      });
      setQuoteFormOpen(false);
      setDraft(emptyTransportQuoteDraft);
      setMessage("Quote sent to the customer.");
    } catch (error) {
      // The callable rejects with a specific reason - the request stopped
      // collecting quotes, the business is not approved, it no longer serves
      // the destination. Swallowing that and saying "check the details" sends
      // the business hunting through a form that is not the problem.
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "The quote could not be sent. Check the details and try again.",
      );
    } finally {
      setBusyId("");
    }
  }

  async function withdrawQuote(opportunity: FirestoreRow) {
    const requestId = text(opportunity.requestId, opportunity.id);
    const confirmed = await confirmImportantAction(
      "Withdraw this quote? The customer will no longer be able to select it.",
      "Retirer ce devis ? Le client ne pourra plus le sélectionner.",
    );
    if (!confirmed) return;
    setBusyId(`withdraw:${requestId}`);
    setMessage("");
    try {
      await httpsCallable(functions, "withdrawTransportQuote")({ requestId });
      setMessage("Quote withdrawn.");
    } catch (error) {
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "The quote could not be withdrawn. Try again.",
      );
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="lst transport-marketplace-panel">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Vehicle transport</h2>
          <p>Quote on eligible customer requests, then manage accepted jobs separately.</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={Boolean(busyId)} message={message} />
        </div>
      </header>

      <div className="transport-marketplace-tabs" role="tablist">
        <button
          aria-selected={view === "opportunities"}
          className={view === "opportunities" ? "active" : ""}
          onClick={() => setView("opportunities")}
          role="tab"
          type="button"
        >
          Quote opportunities
          <span>{opportunities.rows.length}</span>
        </button>
        <button
          aria-selected={view === "jobs"}
          className={view === "jobs" ? "active" : ""}
          onClick={() => setView("jobs")}
          role="tab"
          type="button"
        >
          Accepted jobs
          <span>{transports.rows.length}</span>
        </button>
      </div>

      {(opportunities.error || businessQuotes.error || transports.error) && (
        <div className="error-box" role="alert">
          Transport marketplace data could not be loaded. Refresh and try again.
        </div>
      )}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input
            aria-label="Search vehicle transport"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              view === "opportunities"
                ? "Search route, vehicle, or reference"
                : "Search customer, vehicle, or reference"
            }
            value={search}
          />
        </div>
        {view === "jobs" && (
          <button className="lst-btn ghost" type="button" disabled={filteredJobs.length === 0} onClick={() => downloadCsv("accepted-transport-jobs.csv", filteredJobs, ["trackingCode", "ownerName", "carMake", "carModel", "carYear", "vinNumber", "destinationCountryName", "selectedAmountCents", "transportDate", "status", "updatedAt"])}>
            <Download size={15} /> Export CSV
          </button>
        )}
      </div>

      {view === "opportunities" && (
        <>
          {(opportunities.loading || businessQuotes.loading) && <LoadingState />}
          {!opportunities.loading && opportunities.rows.length === 0 && (
            <div className="lst-empty">
              <div className="lst-empty-icon"><ClipboardList size={30} /></div>
              <h3>No quote opportunities right now</h3>
              <p>Eligible customer requests will appear here when they match your service area.</p>
            </div>
          )}
          {!opportunities.loading &&
            opportunities.rows.length > 0 &&
            filteredOpportunities.length === 0 && (
              <EmptyState text="No quote opportunities match this search." />
            )}
          <div className="transport-opportunity-list">
            {filteredOpportunities.map((opportunity) => {
              const requestId = text(opportunity.requestId, opportunity.id);
              const quote = quoteByRequest.get(requestId);
              const quoteStatus = text(quote?.status, "");
              const selected = quoteStatus === "selected";
              const withdrawn = quoteStatus === "withdrawn";
              const busyRow =
                busyId === `quote:${requestId}` ||
                busyId === `withdraw:${requestId}`;
              const focused = Boolean(focusRequestId) && focusRequestId === requestId;
              return (
                <article
                  className={`transport-opportunity-card${focused ? " focused" : ""}`}
                  key={opportunity.id}
                  ref={focused ? focusedCardRef : undefined}
                >
                  <header>
                    <div>
                      <span className="pur-kind">{text(opportunity.trackingCode, "New request")}</span>
                      <h3>{transportTitle(opportunity)}</h3>
                    </div>
                    <span className={`lst-badge ${selected ? "ok" : quoteStatus === "submitted" ? "navy" : withdrawn ? "muted" : "warn"}`}>
                      {selected
                        ? "Quote selected"
                        : quoteStatus === "submitted"
                          ? "Quote submitted"
                          : withdrawn
                            ? "Quote withdrawn"
                            : "Needs quote"}
                    </span>
                  </header>
                  <div className="transport-opportunity-route">
                    <MapPinned aria-hidden="true" size={20} />
                    <div>
                      <small>Route</small>
                      <strong>
                        {text(opportunity.pickupArea, "Pickup area not provided")} →{" "}
                        {text(opportunity.destinationCountryName, "Destination not provided")}
                      </strong>
                    </div>
                  </div>
                  <dl>
                    <div><dt>Vehicle condition</dt><dd>{opportunity.vehicleOperable === false ? "Needs assistance" : "Runs and drives"}</dd></div>
                    <div><dt>Requested method</dt><dd>{text(opportunity.requestedTransportMethod, "open") === "enclosed" ? "Enclosed transport" : "Open transport"}</dd></div>
                    <div><dt>Preferred pickup</dt><dd>{opportunity.preferredDate ? formatDate(opportunity.preferredDate) : "Flexible"}</dd></div>
                    <div><dt>Quote deadline</dt><dd>{opportunity.expiresAt ? formatDate(opportunity.expiresAt) : "Not provided"}</dd></div>
                  </dl>
                  {quote && !withdrawn && (
                    <div className="transport-business-quote-summary">
                      <div><small>Your quote</small><strong>{formatMoney(Number(quote.amountCents ?? 0) / 100, text(quote.currency, "USD"))}</strong></div>
                      <span>Pickup {quote.estimatedPickupDate ? formatDate(quote.estimatedPickupDate) : "not provided"} · Delivery {quote.estimatedDeliveryDate ? formatDate(quote.estimatedDeliveryDate) : "not provided"}</span>
                    </div>
                  )}
                  <footer>
                    {!selected && (
                      <button
                        className="lst-add"
                        disabled={busyRow}
                        onClick={() => openQuote(opportunity)}
                        type="button"
                      >
                        <CircleDollarSign size={16} />
                        {quoteStatus === "submitted" ? "Revise quote" : withdrawn ? "Submit new quote" : "Send quote"}
                      </button>
                    )}
                    {quoteStatus === "submitted" && (
                      <button
                        aria-busy={busyId === `withdraw:${requestId}`}
                        className="lst-btn danger"
                        disabled={busyRow}
                        onClick={() => void withdrawQuote(opportunity)}
                        type="button"
                      >
                        {busyId === `withdraw:${requestId}` ? <RefreshCw className="spin" size={15} /> : <XCircle size={15} />}
                        {busyId === `withdraw:${requestId}` ? "Withdrawing..." : "Withdraw quote"}
                      </button>
                    )}
                    {selected && <span className="transport-selected-note"><CheckCircle2 size={16} /> This customer chose your quote. The job is now under Accepted jobs.</span>}
                  </footer>
                </article>
              );
            })}
          </div>
        </>
      )}

      {view === "jobs" && (
        <>
          {transports.loading && <LoadingState />}
          {!transports.loading && transports.rows.length === 0 && (
            <div className="lst-empty">
              <div className="lst-empty-icon"><Truck size={30} /></div>
              <h3>No accepted transport jobs yet</h3>
              <p>When a customer chooses your quote, the complete job will appear here.</p>
            </div>
          )}
          {!transports.loading &&
            transports.rows.length > 0 &&
            filteredJobs.length === 0 && (
              <EmptyState text="No accepted jobs match this search." />
            )}
          <div className="pur-grid">
            {filteredJobs.map((row) => {
              const status = text(row.status, "pending");
              const busyRow = busyId === row.id;
              const selectedAmountCents = Number(row.selectedAmountCents ?? 0);
              return (
                <article className="pur-card transport-job-card" key={row.id}>
                  <div className="pur-head">
                    <div className="pur-title">
                      <strong>{transportTitle(row)}</strong>
                      <span className="pur-kind">{text(row.trackingCode, "Transport")}</span>
                    </div>
                    <span className={`lst-badge ${transportTone(status)}`}>{statusLabel(status)}</span>
                  </div>
                  <div className="pur-info">
                    <div><span>Owner</span><b>{text(row.ownerName ?? row.customerName, "—")}</b></div>
                    <div><span>Contact phone</span><b>{text(row.customerPhone, "—")}</b></div>
                    <div><span>Pickup</span><b>{text(row.pickupAddress, "—")}</b></div>
                    <div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                    <div><span>Accepted quote</span><b>{selectedAmountCents > 0 ? formatMoney(selectedAmountCents / 100) : formatMoney(row.price)}</b></div>
                    <div><span>Transport date</span><b>{formatDate(row.transportDate ?? row.estimatedPickupDate ?? row.createdAt)}</b></div>
                  </div>
                  <div className="pur-actions">
                    <label className="bar-field"><span>Update job status</span>
                      <select value={status} disabled={busyRow} onChange={(event) => updateTransportStatus(row, event.target.value)}>
                        {transportStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                      </select>
                    </label>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      {quoteFormOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (!busyId) setQuoteFormOpen(false);
        }}>
          <div className="lst-modal transport-quote-modal" onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <div>
                <span className="pur-kind">Structured quote</span>
                <h3>{quoteByRequest.get(draft.requestId)?.status === "submitted" ? "Revise transport quote" : "Send transport quote"}</h3>
              </div>
              <button className="lst-icon-btn" type="button" disabled={Boolean(busyId)} onClick={() => setQuoteFormOpen(false)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Total quote (USD)</span>
                  <input autoFocus inputMode="decimal" min="1" onChange={(event) => setDraft((value) => ({ ...value, amount: event.target.value }))} placeholder="For example, 1250" value={draft.amount} />
                  <small>Enter the complete customer price, including your known fees.</small>
                </label>
                <label className="lst-field"><span>Estimated pickup date</span>
                  <input min={new Date().toISOString().slice(0, 10)} onChange={(event) => setDraft((value) => ({ ...value, estimatedPickupDate: event.target.value }))} type="date" value={draft.estimatedPickupDate} />
                </label>
                <label className="lst-field"><span>Estimated delivery date</span>
                  <input min={draft.estimatedPickupDate || new Date().toISOString().slice(0, 10)} onChange={(event) => setDraft((value) => ({ ...value, estimatedDeliveryDate: event.target.value }))} type="date" value={draft.estimatedDeliveryDate} />
                </label>
                <label className="lst-field"><span>Transport method</span>
                  <select onChange={(event) => setDraft((value) => ({ ...value, transportMethod: event.target.value === "enclosed" ? "enclosed" : "open" }))} value={draft.transportMethod}>
                    <option value="open">Open transport</option>
                    <option value="enclosed">Enclosed transport</option>
                  </select>
                </label>
                <label className="lst-field wide"><span>Terms and inclusions</span>
                  <textarea maxLength={1000} onChange={(event) => setDraft((value) => ({ ...value, terms: event.target.value }))} placeholder="Explain what is included, timing assumptions, and any conditions." rows={4} value={draft.terms} />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={Boolean(busyId)} onClick={() => setQuoteFormOpen(false)}>Cancel</button>
              <button className="lst-add" type="button" disabled={Boolean(busyId)} aria-busy={Boolean(busyId)} onClick={() => void saveQuote()}>
                {busyId ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busyId ? "Sending quote..." : quoteByRequest.get(draft.requestId)?.status === "submitted" ? "Save revised quote" : "Send quote"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

export function ParkingPanel({
  businessId,
  previewMode = false,
  businessName = "",
}: PanelProps) {
  const parkedCars = useBusinessRows("parkedCars", businessId, Boolean(businessId && !previewMode), 500);
  const [draft, setDraft] = useState<ParkingDraft>(emptyParkingDraft);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // "Record a parked car" — the walk-up flow. Unlike the manual record above
  // it goes through createBusinessParkingEntry, so the price, the tracking
  // code, the space availability check and the platform's cut all come from
  // the same server path a customer booking uses.
  const [entryOpen, setEntryOpen] = useState(false);
  const [entryDraft, setEntryDraft] = useState<BusinessParkingEntryDraft>(emptyBusinessParkingEntryDraft);
  const [entryErrors, setEntryErrors] = useState<BusinessParkingEntryError[]>([]);
  const [entryBusy, setEntryBusy] = useState(false);
  const [entryMessage, setEntryMessage] = useState("");
  const [entryResult, setEntryResult] = useState<BusinessParkingEntryResult | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [receivedVia, setReceivedVia] = useState<Record<string, string>>({});
  const [paidBusyId, setPaidBusyId] = useState("");
  const searched = useMemo(
    () => filterRows(parkedCars.rows, search, ["trackingCode", "ownerName", "customerName", "carMake", "carModel", "carYear", "vinNumber", "status"]),
    [parkedCars.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [searched, filter],
  );
  const activeCount = parkedCars.rows.filter((row) => text(row.status, "active") === "active").length;

  function openNew() {
    setDraft(emptyParkingDraft);
    setMessage("");
    setFormOpen(true);
  }
  function closeForm() {
    setDraft(emptyParkingDraft);
    setFormOpen(false);
  }
  function editParking(row: FirestoreRow) {
    setDraft({
      id: row.id,
      ownerName: text(row.ownerName, ""),
      carMake: text(row.carMake, ""),
      carModel: text(row.carModel, ""),
      carYear: text(row.carYear, ""),
      vinNumber: text(row.vinNumber, ""),
      parkingDate: dateInputValue(row.parkingDate ?? row.createdAt),
      status: text(row.status, "active"),
      totalCost: numberString(row.totalCost),
    });
    setMessage("");
    setFormOpen(true);
  }

  async function saveParking() {
    if (!businessId) throw new Error("Business ID is required.");
    if (!draft.ownerName.trim()) throw new Error("Owner name is required.");
    if (!draft.carMake.trim() || !draft.carModel.trim() || !draft.carYear.trim()) {
      throw new Error("Car make, model, and year are required.");
    }

    const targetRef = draft.id ? doc(db, "parkedCars", draft.id) : doc(collection(db, "parkedCars"));
    const totalCost = Number(draft.totalCost);
    const parkingDate = draft.parkingDate ? new Date(`${draft.parkingDate}T12:00:00`) : new Date();
    const payload = {
        businessId,
        businessName,
        ownerName: draft.ownerName.trim(),
        carMake: draft.carMake.trim(),
        carModel: draft.carModel.trim(),
        carYear: draft.carYear.trim(),
        vinNumber: draft.vinNumber.trim().toUpperCase(),
        parkingDate: Timestamp.fromDate(parkingDate),
        status: draft.status,
        ...(Number.isFinite(totalCost) && totalCost >= 0 ? {totalCost} : {}),
        ...(draft.status === "completed" ? {parkingEndDate: serverTimestamp()} : {}),
        updatedAt: serverTimestamp(),
        ...(draft.id ? {} : {createdAt: serverTimestamp()}),
    };
    await setDoc(
      targetRef,
      {
        ...payload,
        ...(draft.id ? {} : {trackingCode: `PC-${targetRef.id.slice(0, 6).toUpperCase()}`}),
      },
      {merge: true},
    );
    closeForm();
    setMessage(draft.id ? "Parking record updated." : "Parking record created.");
  }

  async function updateParkingStatus(row: FirestoreRow, status: string) {
    if (!businessId) throw new Error("Business ID is required.");
    await setDoc(
      doc(db, "parkedCars", row.id),
      {
        businessId,
        status,
        ...(status === "completed" ? {parkingEndDate: serverTimestamp()} : {}),
        updatedAt: serverTimestamp(),
      },
      {merge: true},
    );
  }

  function openEntry() {
    setEntryDraft(emptyBusinessParkingEntryDraft);
    setEntryErrors([]);
    setEntryMessage("");
    setEntryResult(null);
    setLinkCopied(false);
    setEntryOpen(true);
  }

  function closeEntry() {
    setEntryOpen(false);
    setEntryDraft(emptyBusinessParkingEntryDraft);
    setEntryErrors([]);
    setEntryMessage("");
    setEntryResult(null);
    setLinkCopied(false);
  }

  async function submitEntry() {
    const errors = validateBusinessParkingEntryDraft(entryDraft, businessId);
    setEntryErrors(errors);
    if (errors.length > 0) {
      // The list below the form already names every one of these; repeating
      // them in the banner just doubles the same paragraph.
      setEntryMessage("");
      return;
    }
    setEntryBusy(true);
    setEntryMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "createBusinessParkingEntry",
      )(businessParkingEntryPayload(entryDraft, businessId));
      setEntryResult(businessParkingEntryResult(response.data));
    } catch (error) {
      setEntryMessage(error instanceof Error ? error.message : "The car could not be recorded.");
    } finally {
      setEntryBusy(false);
    }
  }

  async function copyCheckoutUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setEntryMessage("The payment link could not be copied. Select and copy it manually.");
    }
  }

  // Money that has changed hands off-platform cannot be un-marked from here,
  // so it goes through the shared confirmation like every other irreversible
  // action — and it is awaited, which several older call sites in this file
  // are not.
  async function markPaid(row: FirestoreRow) {
    const method = receivedVia[row.id] || "zelle";
    const confirmed = await confirmImportantAction(
      "Record this parking as paid to the business? This cannot be undone here.",
      "Enregistrer ce stationnement comme payé à l’entreprise ? Cette action est irréversible ici.",
    );
    if (!confirmed) return;
    setPaidBusyId(row.id);
    setMessage("");
    try {
      const response = await httpsCallable(functions, "markBusinessParkingPaid")({
        entryId: row.id,
        receivedVia: method,
      });
      const data = (response.data ?? {}) as {alreadyPaid?: boolean};
      setMessage(data.alreadyPaid ? "This parking was already marked paid." : "Payment recorded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The payment could not be recorded.");
    } finally {
      setPaidBusyId("");
    }
  }

  async function checkLinkPayment(row: FirestoreRow) {
    setPaidBusyId(row.id);
    setMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "refreshBusinessParkingPayment",
      )({entryId: row.id});
      const data = (response.data ?? {}) as {
        paid?: boolean;
        alreadyRecorded?: boolean;
      };
      setMessage(
        data.paid
          ? data.alreadyRecorded
            ? "Already recorded as paid."
            : "Payment confirmed with Stripe and recorded."
          : "Stripe has not received this payment yet.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The payment status could not be checked.",
      );
    } finally {
      setPaidBusyId("");
    }
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Parked cars</h2>
          <p>{parkedCars.rows.length === 0 ? "Log cars you're storing and issue receipts to owners." : `${parkedCars.rows.length} record${parkedCars.rows.length === 1 ? "" : "s"} · ${activeCount} active`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy} message={message} />
          <button className="lst-btn ghost" type="button" onClick={openNew}><Pencil size={15} /> New parking</button>
          <button className="lst-add" type="button" onClick={openEntry}><Plus size={17} /> Record a parked car</button>
        </div>
      </header>

      {parkedCars.error && <div className="error-box">{parkedCars.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tracking, owner, car, VIN…" />
        </div>
        <select className="lst-status-select" style={{ flex: "0 0 auto", minWidth: 150 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {parkingStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
        </select>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("parking-receipts.csv", filteredRows, ["trackingCode", "ownerName", "carMake", "carModel", "carYear", "vinNumber", "parkingDate", "parkingEndDate", "totalCost", "status", "updatedAt"])}>
          <Download size={15} /> Export receipts
        </button>
      </div>

      {parkedCars.loading && <LoadingState />}
      {!parkedCars.loading && parkedCars.rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><ParkingCircle size={30} /></div>
          <h3>No parked cars yet</h3>
          <p>Add a car you're storing to start a parking record.</p>
          <button className="lst-add" type="button" onClick={openEntry}><Plus size={17} /> Record a parked car</button>
        </div>
      )}
      {!parkedCars.loading && parkedCars.rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No parking records match this filter." />
      )}

      <div className="pur-grid">
        {filteredRows.map((row) => {
          const status = text(row.status, "active");
          const businessEntered = isBusinessEnteredParking(row);
          const awaitingDirect = canMarkBusinessParkingPaid(row);
          const rowBusy = paidBusyId === row.id;
          return (
            <article className="pur-card" key={row.id}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{parkingTitle(row)}</strong>
                  <span className="pur-kind">{text(row.trackingCode, "Parking")}</span>
                </div>
                <span className="pur-badges">
                  {businessEntered && businessParkingPaymentBadge(row) && (
                    <span className={`lst-badge ${businessParkingPaymentTone(row) === "paid" ? "ok" : "warn"}`}>
                      {businessParkingPaymentBadge(row)}
                    </span>
                  )}
                  <span className={`lst-badge ${status === "active" ? "warn" : status === "completed" ? "ok" : "muted"}`}>{statusLabel(status)}</span>
                </span>
              </div>
              <div className="pur-info">
                <div><span>Owner</span><b>{text(row.customerName ?? row.ownerName, "—")}</b></div>
                <div><span>VIN</span><b>{text(row.vinNumber, "—")}</b></div>
                <div><span>Parked</span><b>{formatDate(row.parkingDate ?? row.createdAt)}</b></div>
                {/* The platform records what a direct entry owes; it never
                    bills it, so the amount is labelled as recorded, not paid. */}
                <div><span>{businessEntered ? "Amount recorded" : "Total cost"}</span><b>{formatMoney(businessEntered ? businessParkingAmountDue(row) : row.totalCost)}</b></div>
                {businessEntered && <div><span>Payment status</span><b>{businessParkingPaymentLabel(row)}</b></div>}
                {Boolean(row.parkingEndDate) && <div><span>Ended</span><b>{formatDate(row.parkingEndDate)}</b></div>}
              </div>
              {businessEntered && text(row.paymentMethod, "") === "payment_link" && Boolean(text(row.checkoutUrl, "")) && (
                <div className="pur-info">
                  <div style={{gridColumn: "1 / -1", minWidth: 0}}>
                    <span>Payment link</span>
                    {/* Once the customer has paid, the link leads to Stripe's
                        "already completed" page. Offering to copy it there
                        reads as a broken link rather than a finished sale. */}
                    {businessParkingPaymentTone(row) === "paid" ? (
                      <em className="lst-hint">This link was already used to pay. Nothing further is owed.</em>
                    ) : (
                      <button className="lst-btn ghost" type="button" onClick={() => copyCheckoutUrl(text(row.checkoutUrl, ""))} title="Copy payment link">
                        <Copy size={14} /> Copy payment link
                      </button>
                    )}
                    {/* A webhook can be late or lost; the lot should never be
                        stuck guessing whether a car has been paid for. */}
                    <button
                      className="lst-btn ghost"
                      type="button"
                      disabled={paidBusyId === row.id}
                      onClick={() => void checkLinkPayment(row)}
                      title="Check payment status"
                    >
                      <RefreshCw size={14} />
                      {paidBusyId === row.id ? "Checking..." : "Check payment status"}
                    </button>
                  </div>
                </div>
              )}
              <div className="pur-actions">
                <label className="bar-field"><span>Update status</span>
                  <select value={status} disabled={busy} onChange={(event) => runPanelAction(setBusy, setMessage, "Parking status updated.", () => updateParkingStatus(row, event.target.value))}>
                    {parkingStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
                {awaitingDirect && (
                  <label className="bar-field"><span>Received via</span>
                    <select value={receivedVia[row.id] || "zelle"} disabled={rowBusy} onChange={(event) => setReceivedVia((current) => ({...current, [row.id]: event.target.value}))}>
                      {BUSINESS_PARKING_RECEIVED_VIA_OPTIONS.map((option) => (<option key={option.value} value={option.value}>{option.label}</option>))}
                    </select>
                  </label>
                )}
                {awaitingDirect && (
                  <button className="lst-btn" type="button" disabled={rowBusy} aria-busy={rowBusy} onClick={() => markPaid(row)}>
                    {rowBusy ? <RefreshCw className="spin" size={14} /> : <CircleDollarSign size={14} />}
                    {rowBusy ? "Recording..." : "Mark payment received"}
                  </button>
                )}
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editParking(row)}><Pencil size={14} /> Edit</button>
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (!busy) closeForm();
        }}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{draft.id ? "Edit parking" : "New parking"}</h3>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Owner name</span>
                  <input value={draft.ownerName} onChange={(event) => setDraft((value) => ({ ...value, ownerName: event.target.value }))} placeholder="Customer name" />
                </label>
                {/* Catalog pickers, not free text - this file already uses
                    them for listings; the parking form was the last holdout. */}
                <label className="lst-field"><span>Make</span>
                  <select value={canonicalMake(draft.carMake) || draft.carMake} onChange={(event) => setDraft((value) => ({ ...value, carMake: event.target.value, carModel: "", carYear: "" }))}>
                    <option value="">Select a make</option>
                    {getMakes().map((make) => (<option key={make} value={make}>{make}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Model</span>
                  <select disabled={!draft.carMake} value={canonicalModel(draft.carMake, draft.carModel) || draft.carModel} onChange={(event) => setDraft((value) => ({ ...value, carModel: event.target.value, carYear: "" }))}>
                    <option value="">Select a model</option>
                    {getModels(draft.carMake).map((model) => (<option key={model} value={model}>{model}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Year</span>
                  <select disabled={!draft.carModel} value={draft.carYear} onChange={(event) => setDraft((value) => ({ ...value, carYear: event.target.value }))}>
                    <option value="">Select a year</option>
                    {getYears(draft.carMake, draft.carModel).map((year) => (<option key={year} value={year}>{year}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>VIN</span>
                  <input value={draft.vinNumber} onChange={(event) => setDraft((value) => ({ ...value, vinNumber: event.target.value }))} placeholder="17 characters" />
                </label>
                <label className="lst-field"><span>Parking date</span>
                  <input type="date" value={draft.parkingDate} onChange={(event) => setDraft((value) => ({ ...value, parkingDate: event.target.value }))} />
                </label>
                <label className="lst-field"><span>Total cost (USD)</span>
                  <input inputMode="decimal" value={draft.totalCost} onChange={(event) => setDraft((value) => ({ ...value, totalCost: event.target.value }))} placeholder="0.00" />
                </label>
                <label className="lst-field"><span>Status</span>
                  <select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
                    {parkingStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
                  </select>
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => runPanelAction(setBusy, setMessage, draft.id ? "Parking record updated." : "Parking record created.", saveParking)}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busy ? "Saving..." : draft.id ? "Save changes" : "Create parking"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {entryOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={() => {
          if (!entryBusy) closeEntry();
        }}>
          <div className="lst-modal" style={{ maxWidth: 640 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{entryResult ? "Parked car recorded" : "Record a parked car"}</h3>
              <button className="lst-icon-btn" type="button" disabled={entryBusy} onClick={closeEntry} aria-label="Close"><X size={18} /></button>
            </header>

            {entryResult ? (
              <div className="lst-modal-body">
                <div className="pur-info">
                  <div><span>Tracking code</span><b>{entryResult.trackingCode || "—"}</b></div>
                  <div><span>Amount due</span><b>{formatMoney(entryResult.amountDue)}</b></div>
                </div>
                {entryResult.paymentMethod === "payment_link" ? (
                  <>
                    <p className="lst-hint">Send this link to the customer so they can pay. It stays valid until they use it.</p>
                    <div className="lst-form-grid">
                      <label className="lst-field wide"><span>Payment link</span>
                        <input readOnly value={entryResult.checkoutUrl} onFocus={(event) => event.currentTarget.select()} />
                      </label>
                    </div>
                    <button className="lst-btn ghost" type="button" disabled={!entryResult.checkoutUrl} onClick={() => copyCheckoutUrl(entryResult.checkoutUrl)}>
                      <Copy size={15} /> {linkCopied ? "Link copied" : "Copy payment link"}
                    </button>
                  </>
                ) : (
                  <p className="lst-hint">The customer pays your business directly. We record the amount and never bill it. Use Mark payment received once the money arrives.</p>
                )}
                {entryMessage && <div className="lst-form-error" role="alert">{entryMessage}</div>}
              </div>
            ) : (
              <div className="lst-modal-body">
                {entryMessage && <div className="lst-form-error" role="alert">{entryMessage}</div>}
                <div className="lst-form-grid">
                  <label className="lst-field wide"><span>Customer name</span>
                    <input value={entryDraft.customerName} onChange={(event) => setEntryDraft((value) => ({...value, customerName: event.target.value}))} placeholder="Customer name" />
                  </label>
                  <label className="lst-field"><span>Customer phone</span>
                    <input value={entryDraft.customerPhone} onChange={(event) => setEntryDraft((value) => ({...value, customerPhone: event.target.value}))} placeholder="Phone number" />
                  </label>
                  <label className="lst-field"><span>Customer email (optional)</span>
                    <input value={entryDraft.customerEmail} onChange={(event) => setEntryDraft((value) => ({...value, customerEmail: event.target.value}))} placeholder="Email address" />
                  </label>
                  {/* Catalog pickers, never free text — a typed make breaks
                      search, filters and every later match on this record. */}
                  <label className="lst-field"><span>Make</span>
                    <select value={canonicalMake(entryDraft.carMake) || entryDraft.carMake} onChange={(event) => setEntryDraft((value) => ({...value, carMake: event.target.value, carModel: "", carYear: ""}))}>
                      <option value="">Select a make</option>
                      {getMakes().map((make) => (<option key={make} value={make}>{make}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>Model</span>
                    <select disabled={!entryDraft.carMake} value={canonicalModel(entryDraft.carMake, entryDraft.carModel) || entryDraft.carModel} onChange={(event) => setEntryDraft((value) => ({...value, carModel: event.target.value, carYear: ""}))}>
                      <option value="">Select a model</option>
                      {getModels(entryDraft.carMake).map((model) => (<option key={model} value={model}>{model}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>Year</span>
                    <select disabled={!entryDraft.carModel} value={entryDraft.carYear} onChange={(event) => setEntryDraft((value) => ({...value, carYear: event.target.value}))}>
                      <option value="">Select a year</option>
                      {getYears(entryDraft.carMake, entryDraft.carModel).map((year) => (<option key={year} value={year}>{year}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>VIN (optional)</span>
                    <input value={entryDraft.vinNumber} onChange={(event) => setEntryDraft((value) => ({...value, vinNumber: event.target.value}))} placeholder="17 characters" />
                  </label>
                  <label className="lst-field"><span>Start date</span>
                    <input type="date" value={entryDraft.startDate} onChange={(event) => setEntryDraft((value) => ({...value, startDate: event.target.value}))} />
                  </label>
                  <label className="lst-field"><span>End date</span>
                    <input type="date" value={entryDraft.endDate} onChange={(event) => setEntryDraft((value) => ({...value, endDate: event.target.value}))} />
                  </label>
                </div>

                <fieldset className="lst-fieldset">
                  <legend>How does this parking get paid?</legend>
                  <label className="lst-radio">
                    <input type="radio" name="parking-payment-method" value="direct" checked={entryDraft.paymentMethod === "direct"} onChange={() => setEntryDraft((value) => ({...value, paymentMethod: "direct"}))} />
                    <span>Customer pays us directly (Zelle/cash)</span>
                  </label>
                  <label className="lst-radio">
                    <input type="radio" name="parking-payment-method" value="payment_link" checked={entryDraft.paymentMethod === "payment_link"} onChange={() => setEntryDraft((value) => ({...value, paymentMethod: "payment_link"}))} />
                    <span>Send the customer a payment link</span>
                  </label>
                  <p className="lst-hint">
                    {entryDraft.paymentMethod === "direct"
                      ? "We record what the customer owes you and take no cut. You mark it received when the money arrives."
                      : "We bill the customer for you and send you the rest."}
                  </p>
                </fieldset>

                {entryErrors.length > 0 && (
                  <ul className="lst-form-error" role="alert">
                    {entryErrors.map((code) => (<li key={code}>{BUSINESS_PARKING_ENTRY_MESSAGES[code]}</li>))}
                  </ul>
                )}
              </div>
            )}

            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={entryBusy} onClick={closeEntry}>{entryResult ? "Done" : "Cancel"}</button>
              {!entryResult && (
                <button className="lst-add" type="button" disabled={entryBusy} aria-busy={entryBusy} onClick={submitEntry}>
                  {entryBusy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                  {entryBusy ? "Recording..." : "Record the car"}
                </button>
              )}
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

// What kind of record this is — mirrors CarPurchase getters in the mobile app.
function purchaseKind(row: FirestoreRow): "hold" | "viewing" | "purchase" {
  if (row.paymentType === "reservation_deposit") return "hold";
  if (row.paymentType === "viewing_reservation") return "viewing";
  if (row.appointmentStart && Number(row.depositAmount ?? 0) === 0) return "viewing";
  return "purchase";
}
function purchaseKindLabel(kind: ReturnType<typeof purchaseKind>) {
  return kind === "hold" ? "Paid hold" : kind === "viewing" ? "Viewing" : "Purchase";
}
function purchaseNeedsAction(row: FirestoreRow) {
  return Boolean(row.holdReviewRequiredAt) || row.extensionRequestStatus === "pending";
}
function purchaseTone(status: string) {
  switch (status) {
    case "completed": return "ok";
    case "reserved": case "hold_review_required": case "viewing_scheduled": return "warn";
    case "cancelled": case "refunded": case "no_show": case "forfeited": return "muted";
    default: return "navy";
  }
}

export function PurchasesPanel({ businessId, previewMode = false }: PanelProps) {
  const purchases = useBusinessRows("carPurchases", businessId, Boolean(businessId && !previewMode), 250);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");

  const searched = useMemo(
    () => filterRows(purchases.rows, search, ["carTitle", "buyerName", "buyerEmail", "buyerPhone", "customerName", "purchaseStatus", "paymentStatus", "destinationCountryName"]),
    [purchases.rows, search],
  );
  const filteredRows = useMemo(() => {
    if (filter === "all") return searched;
    if (filter === "needs_action") return searched.filter(purchaseNeedsAction);
    if (filter === "holds") return searched.filter((row) => purchaseKind(row) === "hold");
    if (filter === "viewings") return searched.filter((row) => purchaseKind(row) === "viewing");
    return searched.filter((row) => text(row.purchaseStatus, "") === filter);
  }, [searched, filter]);

  const actionCount = useMemo(() => purchases.rows.filter(purchaseNeedsAction).length, [purchases.rows]);

  async function runHold(
    purchaseId: string,
    label: string,
    action: () => Promise<unknown>,
    confirm?: string,
    confirmFr?: string,
  ) {
    if (confirm && !(await confirmImportantAction(confirm, confirmFr))) return;
    setBusyId(purchaseId);
    setMessage("");
    try {
      await action();
      setMessage(label);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setBusyId("");
    }
  }

  // Completed / cancelled go through a guarded Cloud Function that enforces the
  // state machine, updates the car, and (on cancel of a paid deposit) queues the
  // customer's refund with the platform — never a raw client write.
  async function finalize(purchaseId: string, outcome: "completed" | "cancelled", note: string) {
    const res = await httpsCallable(functions, "businessFinalizeCarPurchase")({ purchaseId, outcome, note });
    return (res.data as { refundQueued?: boolean })?.refundQueued ?? false;
  }

  const statusFilters = ["all", "needs_action", "holds", "viewings", "reserved", "hold_review_required", "viewing_scheduled", "completed", "cancelled", "refunded", "no_show", "forfeited"];

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Customer purchases</h2>
          <p>{purchases.rows.length === 0 ? "Holds, viewings, and buyers appear here as customers reserve your cars." : `${purchases.rows.length} record${purchases.rows.length === 1 ? "" : "s"}${actionCount ? ` · ${actionCount} need${actionCount === 1 ? "s" : ""} action` : ""}`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={Boolean(busyId)} message={message} />
        </div>
      </header>

      {purchases.error && <div className="error-box">{purchases.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search car, buyer, phone, status…" />
        </div>
        <select className="lst-status-select" style={{ flex: "0 0 auto", minWidth: 160 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          {statusFilters.map((option) => (
            <option key={option} value={option}>
              {option === "all" ? "All records" : option === "needs_action" ? "Needs action" : option === "holds" ? "Paid holds" : option === "viewings" ? "Viewings" : statusLabel(option)}
            </option>
          ))}
        </select>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("purchases.csv", filteredRows, ["carTitle", "buyerName", "buyerPhone", "buyerEmail", "destinationCountryName", "purchaseStatus", "paymentStatus", "depositAmount", "holdUntilDate", "updatedAt"])}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {purchases.loading && <LoadingState />}
      {!purchases.loading && purchases.rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><ClipboardList size={30} /></div>
          <h3>No purchases yet</h3>
          <p>When customers reserve a viewing or pay a hold deposit, they show up here.</p>
        </div>
      )}
      {!purchases.loading && purchases.rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No purchases match this filter." />
      )}

      <div className="pur-grid">
        {filteredRows.map((row) => {
          const kind = purchaseKind(row);
          const status = text(row.purchaseStatus, "pending");
          const busy = busyId === row.id;
          const holdActive = kind === "hold" && (status === "reserved" || status === "hold_review_required");
          const reliability = (row.buyerReliabilitySnapshot && typeof row.buyerReliabilitySnapshot === "object")
            ? row.buyerReliabilitySnapshot as Record<string, unknown>
            : null;
          const note = noteById[row.id] ?? "";
          return (
            <article className={`pur-card ${purchaseNeedsAction(row) ? "alert" : ""}`} key={row.id}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{text(row.carTitle ?? row.title, "Vehicle")}</strong>
                  <span className="pur-kind">{purchaseKindLabel(kind)}</span>
                </div>
                <span className={`lst-badge ${purchaseTone(status)}`}>{statusLabel(status)}</span>
              </div>

              <div className="pur-info">
                <div><span>Buyer</span><b>{text(row.buyerName ?? row.customerName, "—")}</b></div>
                <div><span>Phone</span><b>{text(row.buyerPhone, "—")}</b></div>
                <div><span>Email</span><b>{text(row.buyerEmail, "—")}</b></div>
                {text(row.destinationCountryName, "") && <div><span>Destination</span><b>{text(row.destinationCountryName, "")}</b></div>}
                <div><span>Deposit</span><b>{formatMoney(row.depositAmount)} · {statusLabel(text(row.paymentStatus, "—"))}</b></div>
                {Boolean(row.appointmentStart) && <div><span>Viewing</span><b>{text(row.appointmentLabel, "") || formatDate(row.appointmentStart)}</b></div>}
                {Boolean(row.holdUntilDate) && <div><span>Hold until</span><b>{formatDate(row.holdUntilDate)}</b></div>}
                {Boolean(row.holdPricingMode) && <div><span>Hold pricing</span><b>{row.holdPricingMode === "per_day" ? "Per day" : "Flat"}{row.holdDays ? ` · ${row.holdDays}d` : ""}</b></div>}
                {Boolean(row.depositForfeitureStatus) && <div><span>Forfeiture</span><b>{statusLabel(text(row.depositForfeitureStatus, ""))}</b></div>}
              </div>

              {Boolean(row.holdReviewRequiredAt) && (
                <div className="pur-notice warn"><AlertTriangle size={15} /> Hold date reached — mark this vehicle sold, or mark the customer as a no-show.</div>
              )}
              {Boolean(row.extensionRequestStatus) && (
                <div className="pur-notice"><Clock3 size={15} /> Extension {statusLabel(text(row.extensionRequestStatus, ""))}
                  {row.extensionRequestedHoldUntilDate ? ` · until ${formatDate(row.extensionRequestedHoldUntilDate)}` : ""}
                  {row.extensionExtraAmount != null ? ` · extra ${formatMoney(row.extensionExtraAmount)}` : ""}
                </div>
              )}
              {reliability && (
                <div className="pur-reliability">
                  Buyer history: {String(reliability.completedHolds ?? 0)} completed · {String(reliability.noShows ?? 0)} no-show · {String(reliability.forfeitures ?? 0)} forfeited
                </div>
              )}

              <div className="pur-actions">
                {holdActive ? (
                  <>
                    <button
                      className="lst-btn"
                      type="button"
                      disabled={busy}
                      onClick={() => runHold(
                        row.id,
                        "Hold marked sold.",
                        () => httpsCallable(functions, "markPaidHoldSold")({ purchaseId: row.id }),
                        "Mark this paid hold as sold?",
                        "Marquer cette réservation payée comme vendue ?",
                      )}
                    >
                      <CheckCircle2 size={15} /> Mark sold
                    </button>
                    {status === "hold_review_required" && (
                      <>
                        <input className="pur-note" value={note} disabled={busy} placeholder="No-show note (optional)" onChange={(event) => setNoteById((values) => ({ ...values, [row.id]: event.target.value }))} />
                        <button
                          className="lst-btn ghost danger"
                          type="button"
                          disabled={busy}
                          onClick={() => runHold(
                            row.id,
                            "Marked no-show.",
                            () => httpsCallable(functions, "markPaidHoldNoShow")({ purchaseId: row.id, note }),
                            "Mark this customer as a no-show?",
                            "Marquer ce client comme absent ?",
                          )}
                        >
                          <XCircle size={15} /> No-show
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      className="lst-btn"
                      type="button"
                      disabled={busy}
                      onClick={() => runHold(
                        row.id,
                        "Marked completed.",
                        () => finalize(row.id, "completed", note),
                        "Mark this purchase as completed?",
                        "Marquer cet achat comme terminé ?",
                      )}
                    >
                      <CheckCircle2 size={15} /> Completed
                    </button>
                    <button
                      className="lst-btn ghost danger"
                      type="button"
                      disabled={busy}
                      onClick={() => runHold(
                        row.id,
                        "Cancelled — deposit refund queued with the platform.",
                        async () => { await finalize(row.id, "cancelled", note); },
                        "Cancel this purchase and queue the deposit refund?",
                        "Annuler cet achat et mettre le remboursement de l’acompte en file ?",
                      )}
                    >
                      <RotateCcw size={14} /> Cancel &amp; refund
                    </button>
                  </>
                )}
                {row.extensionRequestStatus === "pending" && (
                  <>
                    <button
                      className="lst-btn ghost"
                      type="button"
                      disabled={busy}
                      onClick={() => runHold(
                        row.id,
                        "Extension approved.",
                        () => httpsCallable(functions, "decidePaidHoldExtension")({ purchaseId: row.id, decision: "approved" }),
                        "Approve this hold extension request?",
                        "Approuver cette demande de prolongation de réservation ?",
                      )}
                    >
                      <Clock3 size={14} /> Approve extension
                    </button>
                    <button
                      className="lst-btn ghost danger"
                      type="button"
                      disabled={busy}
                      onClick={() => runHold(
                        row.id,
                        "Extension rejected.",
                        () => httpsCallable(functions, "decidePaidHoldExtension")({ purchaseId: row.id, decision: "rejected" }),
                        "Reject this hold extension request?",
                        "Rejeter cette demande de prolongation de réservation ?",
                      )}
                    >
                      Reject
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function useBusinessRows(
  collectionName: string,
  businessId: string,
  enabled: boolean,
  maxRows: number | null,
) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const scopedBusinessId = businessId.trim();
    if (!enabled || !scopedBusinessId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    const constraints: QueryConstraint[] = [
      where("businessId", "==", scopedBusinessId),
    ];
    if (maxRows != null) {
      constraints.push(limit(maxRows));
    }

    setLoading(true);
    return onSnapshot(
      query(collection(db, collectionName), ...constraints),
      (snapshot) => {
        setRows(sortByUpdated(snapshot.docs.map((item) => rowFromSnapshot(item))));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setLoading(false);
        setError(snapshotError.message);
      },
    );
  }, [businessId, collectionName, enabled, maxRows]);

  return { rows, loading, error };
}

function useBusinessSubcollectionRows(
  collectionName: string,
  businessId: string,
  enabled: boolean,
  maxRows: number,
) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const scopedBusinessId = businessId.trim();
    if (!enabled || !scopedBusinessId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    return onSnapshot(
      query(collection(db, "businesses", scopedBusinessId, collectionName), limit(maxRows)),
      (snapshot) => {
        setRows(sortByUpdated(snapshot.docs.map((item) => rowFromSnapshot(item, { businessId: scopedBusinessId }))));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setLoading(false);
        setError(snapshotError.message);
      },
    );
  }, [businessId, collectionName, enabled, maxRows]);

  return { rows, loading, error };
}

function rowFromSnapshot(
  snapshot: QueryDocumentSnapshot<DocumentData>,
  extra: Record<string, unknown> = {},
): FirestoreRow {
  return {
    id: snapshot.id,
    _path: snapshot.ref.path,
    ...extra,
    ...snapshot.data(),
  };
}

function sortByUpdated(rows: FirestoreRow[]) {
  return [...rows].sort((a, b) => timestampMs(b.updatedAt ?? b.createdAt) - timestampMs(a.updatedAt ?? a.createdAt));
}

function filterRows(rows: FirestoreRow[], search: string, fields: string[]) {
  const needle = search.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    fields
      .map((field) => String(row[field] ?? "").toLowerCase())
      .join(" ")
      .includes(needle),
  );
}

function toggleId(values: string[], id: string, enabled: boolean) {
  if (enabled) return Array.from(new Set([...values, id]));
  return values.filter((value) => value !== id);
}

function timestampMs(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === "object") {
    const candidate = value as { toDate?: unknown; toMillis?: unknown; seconds?: unknown };
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis() as unknown;
      return typeof millis === "number" ? millis : 0;
    }
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate() as unknown;
      return date instanceof Date ? date.getTime() : 0;
    }
    if (typeof candidate.seconds === "number") return candidate.seconds * 1000;
  }
  return 0;
}

async function uploadCarImage(businessId: string, carId: string, file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const path = `cars/${businessId}/${carId}/car_${carId}_${unique}.${extension}`;
  const target = storageRef(storage, path);
  await uploadBytes(target, file, { contentType: file.type || "image/jpeg" });
  return getDownloadURL(target);
}

async function runPanelAction(
  setBusy: (value: boolean) => void,
  setMessage: (value: string) => void,
  successMessage: string,
  action: () => Promise<unknown>,
) {
  setBusy(true);
  setMessage("");
  try {
    await action();
    setMessage(successMessage);
  } catch (error) {
    setMessage(error instanceof Error ? error.message : "L’action a échoué.");
  } finally {
    setBusy(false);
  }
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </article>
  );
}

function StatusText({ busy, message }: { busy: boolean; message: string }) {
  if (busy) {
    return (
      <span className="status-pill compact warning">
        <RefreshCw className="spin" size={14} /> Enregistrement
      </span>
    );
  }
  if (!message) return null;
  return <span className="status-pill compact">{message}</span>;
}

function LoadingState() {
  return (
    <div className="empty-state">
      <RefreshCw className="spin" size={16} /> Chargement...
    </div>
  );
}

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

function countryName(countryId: string) {
  return destinationCountryName(countryId, currentLanguage());
}

function destinationRowCountryName(row: FirestoreRow) {
  const country = destinationCountryOptionForRow(row);
  if (country.id) return countryName(country.id);
  return text(row.destinationCountryName ?? row.name, statusLabel(row.id));
}

function selectableStateOptions(current: string) {
  const currentCode = current.trim().toUpperCase();
  if (!currentCode || US_STATE_OPTIONS.some((state) => state.code === currentCode)) return US_STATE_OPTIONS;
  return [{ code: current, name: current }, ...US_STATE_OPTIONS];
}

function deliveryWindow(row: FirestoreRow) {
  const minDays = Number(row.deliveryEstimateMinDays);
  const maxDays = Number(row.deliveryEstimateMaxDays);
  if (!Number.isFinite(minDays) || !Number.isFinite(maxDays) || minDays <= 0 || maxDays <= 0) return "";
  return `${minDays}-${maxDays} jours`;
}

// Country coverage rows can enable barrel shipping, air freight, and sea
// freight at once, each with its own transit time, so the estimate is read
// per service rather than one shared value for the whole row.
function serviceDeliveryWindow(row: FirestoreRow, service: string) {
  const minDays = Number(row[`${service}DeliveryEstimateMinDays`]);
  const maxDays = Number(row[`${service}DeliveryEstimateMaxDays`]);
  if (!Number.isFinite(minDays) || !Number.isFinite(maxDays) || minDays <= 0 || maxDays <= 0) return "";
  return `${minDays}-${maxDays} jours`;
}

function downloadCsv(filename: string, rows: FirestoreRow[], columns: string[]) {
  const csv = [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
  const blob = new Blob([csv], {type: "text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: unknown) {
  const raw = value && typeof value === "object" && "toDate" in value
    ? formatDate(value)
    : String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function listingTitle(row: FirestoreRow) {
  return text(row.title ?? [row.year, row.make, row.model].filter(Boolean).join(" "), row.id);
}

function listingLocation(row: FirestoreRow) {
  return [row.locationCity, row.locationState].map((value) => text(value, "")).filter(Boolean).join(", ");
}

function transportTitle(row: FirestoreRow) {
  return text(
    row.vehicleTitle ??
      row.carTitle ??
      [row.carYear, row.carMake, row.carModel].filter(Boolean).join(" "),
    text(row.trackingCode, row.id),
  );
}

function parkingTitle(row: FirestoreRow) {
  return text(
    row.vehicleTitle ??
      row.carTitle ??
      [row.carYear, row.carMake, row.carModel].filter(Boolean).join(" "),
    "Véhicule stationné",
  );
}

function dateInputValue(value: unknown) {
  const millis = timestampMs(value);
  if (!millis) return "";
  return new Date(millis).toISOString().slice(0, 10);
}

function firstImageUrl(row: FirestoreRow) {
  if (typeof row.imageUrl === "string") return row.imageUrl;
  if (Array.isArray(row.imageUrls) && typeof row.imageUrls[0] === "string") return row.imageUrls[0];
  return "";
}

function numberString(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  return "";
}

function statusLabel(value: unknown) {
  const normalized = text(value, "unknown").toLowerCase();
  const labels: Record<"en" | "fr", Record<string, string>> = {
    en: {
      active: "Active",
      air: "Air freight",
      all: "All",
      approved: "Approved",
      awaiting_balance_payment: "Awaiting balance payment",
      awaiting_weight: "Awaiting confirmed weight",
      awaiting_weight_confirmation: "Awaiting confirmed weight",
      balance_due: "Balance due",
      balance_payment_pending: "Balance payment pending",
      businessheld: "Business-held",
      cancelled: "Cancelled",
      closed: "Closed",
      collected_by_business: "Collected by business",
      completed: "Completed",
      customerposted: "Customer-posted",
      delivered: "Delivered",
      draft: "Draft",
      dropoff: "Drop-off",
      expired: "Expired",
      forfeited: "Forfeited",
      full: "Full",
      hold_review_required: "Hold review required",
      inactive: "Inactive",
      in_review: "In review",
      in_transit: "In transit",
      no_show: "Customer no-show",
      not_required: "Not required",
      open: "Open",
      paid: "Paid",
      partially_filled: "Partially filled",
      pending: "Pending",
      pending_payment: "Pending payment",
      pending_seal: "Pending seal",
      ready_for_pickup: "Ready for pickup",
      refund_processing: "Refund processing",
      refund_pending: "Refund pending",
      refunded: "Refunded",
      rejected: "Rejected",
      reserved: "Reserved",
      resolved: "Resolved",
      scheduled: "Scheduled",
      settlement_processing: "Settlement processing",
      settled: "Settled",
      sea: "Sea freight",
      succeeded: "Succeeded",
      freight: "Freight",
      needs_attention: "Needs attention",
      sealed: "Sealed",
      sold: "Sold",
      unknown: "Unknown",
      viewing_scheduled: "Viewing scheduled",
      waiting_on_platform: "Waiting on platform",
    },
    fr: {
      active: "Actif",
      air: "Fret aérien",
      all: "Tous",
      approved: "Approuvé",
      awaiting_balance_payment: "En attente du paiement du solde",
      awaiting_weight: "En attente du poids confirmé",
      awaiting_weight_confirmation: "En attente du poids confirmé",
      balance_due: "Solde dû",
      balance_payment_pending: "Paiement du solde en attente",
      businessheld: "Géré par l’entreprise",
      cancelled: "Annulé",
      closed: "Fermé",
      collected_by_business: "Encaissé par l’entreprise",
      completed: "Terminé",
      customerposted: "Publié par un client",
      delivered: "Livré",
      draft: "Brouillon",
      dropoff: "Dépôt client",
      expired: "Expiré",
      forfeited: "Conservé",
      full: "Complet",
      hold_review_required: "Vérification du blocage requise",
      inactive: "Inactif",
      in_review: "En examen",
      in_transit: "En transit",
      no_show: "Client absent",
      not_required: "Non requis",
      open: "Ouvert",
      paid: "Payé",
      partially_filled: "Partiellement rempli",
      pending: "En attente",
      pending_payment: "Paiement en attente",
      pending_seal: "En attente de scellement",
      ready_for_pickup: "Prêt pour collecte",
      refund_processing: "Remboursement en cours",
      refund_pending: "Remboursement en attente",
      refunded: "Remboursé",
      rejected: "Rejeté",
      reserved: "Réservé",
      resolved: "Résolu",
      scheduled: "Planifié",
      settlement_processing: "Règlement en cours",
      settled: "Finalisé",
      sea: "Fret maritime",
      succeeded: "Réussi",
      freight: "Fret",
      needs_attention: "Intervention requise",
      sealed: "Scellé",
      sold: "Vendu",
      unknown: "Inconnu",
      viewing_scheduled: "Visite planifiée",
      waiting_on_platform: "En attente de la plateforme",
    },
  };
  const language = currentLanguage();
  if (labels[language][normalized]) return labels[language][normalized];
  return normalized
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
