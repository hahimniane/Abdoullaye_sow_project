"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  collection,
  deleteField,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
  Ban,
  History,
  Paperclip,
  FileText,
  Pencil,
  Plane,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Ship,
  Star,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import { AddressAutocomplete } from "@/components/address-autocomplete";
import { FieldInfo } from "@/components/field-info";
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
import { useBusinessStaff } from "@/lib/business-data";
import {
  formatCents as lotFormatCents,
  LOT_CUSTOM_ACTIVITY_ID,
  LOT_AUCTION_HOUSES,
  LOT_RECEIVED_VIA_OPTIONS,
  DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS,
  lotActivityPaymentLabel,
  lotActivityPaid,
  lotActivityAwaitingLink,
  canChaseLotActivity,
  dateInputValue as lotDateInputValue,
  lotExpenseEntryMonth,
  emptyLotActivityDraft,
  emptyLotActivityTypeDraft,
  emptyLotExpenseEntryDraft,
  validateLotActivityDraft,
  validateLotActivityTypeDraft,
  validateLotExpenseEntryDraft,
  lotActivityPayload,
  lotActivityTypePayload,
  lotExpenseEntryPayload,
  lotActivityMessage,
  expenseProofRequired,
  expenseProofMessage,
  lotMonthExpenseCents,
  lotExpenseByLine,
  type LotActivityDraft,
  type LotActivityTypeDraft,
  type LotExpenseEntryDraft,
} from "@/lib/lot-ledger";
import {
  lotCustomerCarLabel,
  lotCustomerFromRow,
  matchLotCustomers,
  type LotCustomer,
  type LotCustomerCar,
} from "@/lib/lot-customers";
import {
  contentsFromRecord,
  quoteLensForBusiness,
} from "@/lib/freight-contents";
import { type PaybackTable } from "@/lib/freight-payback";
import {
  barrelFulfillmentWriteErrorMessage,
  barrelInTransitBlockedReason,
  barrelManualContainerWriteFields,
  barrelStatusWriteFields,
} from "@/lib/barrel-fulfillment";
import {
  freightCanConfirmWeight,
  freightCanUpdateStatus,
  freightIsPayOnArrival,
  freightPaymentReadyForFulfillment,
  freightSettlementReadyForStatus,
  freightStatusChangeAllowed,
} from "@/lib/freight-fulfillment";
import {
  BUSINESS_PARKING_ENTRY_MESSAGES,
  BUSINESS_PARKING_RECEIVED_VIA_OPTIONS,
  businessParkingAmountDue,
  businessParkingEntryPayload,
  businessParkingEntryResult,
  businessParkingDocumentType,
  businessParkingEndLabel,
  businessParkingWithinRange,
  businessParkingPaymentBadge,
  businessParkingPaymentLabel,
  businessParkingPaymentTone,
  businessParkingResendMessage,
  businessParkingUpdateChanges,
  businessParkingUpdateResult,
  canMarkBusinessParkingPaid,
  canResendBusinessParkingLink,
  emptyBusinessParkingEntryDraft,
  isBusinessEnteredParking,
  validateBusinessParkingEntryDraft,
  type BusinessParkingEntryDraft,
  type BusinessParkingEntryError,
  type BusinessParkingEntryResult,
  type BusinessParkingPaymentMethod,
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
import {
  MAX_AREA_NAME_LENGTH,
  MAX_DELIVERY_AREAS,
  MAX_DESTINATION_DELIVERY_FEE,
  deliveryAreaDraftsFrom,
  deliveryAreasPayload,
  deliverySettingsError,
  emptyDeliveryArea,
  type DeliveryAreaDraft,
} from "@/lib/freight-delivery";
import {
  freightQuoteErrorMessage,
  validateFreightQuote,
} from "@/lib/freight-quote";
import {
  VIEWING_BLOCK_MESSAGES,
  VIEWING_SLOT_ERROR_MESSAGES,
  formatViewingSlot,
  validateViewingSlots,
  viewingActionAvailability,
  viewingActionPayload,
  viewingAwaitingParty,
  viewingHistoryFrom,
  viewingHistoryLabel,
  viewingRecordFrom,
  viewingSlotFromInput,
  viewingSlotInputMin,
  viewingWaitingLabel,
  type ViewingAction,
  type ViewingSlot,
} from "@/lib/car-viewing";
import {
  carPurchaseCanMarkCompleted,
  carPurchaseCanMarkSold,
} from "@/lib/car-purchase";
import { asDate, currentLanguage, formatDate, formatMoney, text } from "@/lib/format";
import {
  normalizeTransportContainerNumber,
  transportFulfillmentErrorMessage,
  transportFulfillmentNextStatuses,
  transportFulfillmentPayload,
  transportFulfillmentRequiresContainer,
  transportFulfillmentStatusIsKnown,
  transportJobCurrentStatus,
  validateTransportFulfillmentChange,
} from "@/lib/transport-fulfillment";
import { canonicalMake, canonicalModel, getMakes, getModels, getYears } from "@/lib/car-catalog";
import { ensureBrowserDisplayableImage } from "@/lib/heic-convert";
import { US_STATE_OPTIONS, citiesForState, withSelected } from "@/lib/us-locations";
import type { FirestoreRow } from "@/types/admin";

type PanelProps = {
  businessId: string;
  previewMode?: boolean;
  /** Request id from an opened notification, scrolled to and highlighted. */
  focusRequestId?: string;
  /** Record id from an opened notification, scrolled to and highlighted. */
  focusRecordId?: string;
  /** Which inner view a notification should open. */
  focusView?: string;
  businessName?: string;
  businessStatus?: string;
  businessProfileImageUrl?: string;
  enabledServices?: string[];
  onOpenDestinations?: () => void;
  onManageServices?: () => void;
  openNewToken?: number;
  /** The business document (settings like the expense proof threshold). */
  business?: Record<string, unknown> | null;
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
  // Crossing Dakar and crossing Conakry are different jobs at different
  // costs, and a business may do one and not the other - so the offer and
  // its prices belong to the route, next to that route's rates. The named
  // places are how this trade quotes it; the single fee is the answer for a
  // business that charges the same anywhere in the country.
  destinationDelivery: boolean;
  destinationDeliveryAreas: DeliveryAreaDraft[];
  destinationDeliveryFee: string;
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

// The parking edit form. Everything except `id` and `status` goes to
// `updateBusinessParkingEntry`; the amount is absent on purpose - the server
// recomputes it from the business's parking rates, so there is nothing here
// for a staff member to type a price into.
type ParkingDraft = {
  id: string;
  ownerName: string;
  customerPhone: string;
  customerEmail: string;
  carMake: string;
  carModel: string;
  carYear: string;
  vinNumber: string;
  startDate: string;
  endDate: string;
  paymentMethod: BusinessParkingPaymentMethod;
  status: string;
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
/**
 * What cancelling a paid booking does to the customer's money, in the words
 * the business needs before they press it.
 *
 * Only "pending" (paid, work not started) can be cancelled here. The outcome
 * is decided server-side by cancelSecuredBusinessOrder - this only has to
 * describe it honestly, and the two cases are very different for the
 * customer: a held payment was never charged, a captured one has to be
 * refunded.
 */
export function businessCancelAction(row: FirestoreRow, collection:
  "barrelShipments" | "freightShipments") {
  const status = text(row.status, "");
  const paymentStatus = text(row.paymentStatus, "");
  if (status !== "pending" || paymentStatus !== "succeeded") return null;

  const held = text(row.paymentHoldStatus, "") === "held";
  const amount = formatMoney(row.price);
  // A barrel shipment paid as part of a multi-destination order shares one
  // payment with its siblings, so the whole order is what gets cancelled.
  const orderId = collection === "barrelShipments" ?
    text(row.orderId, "") :
    "";
  const orderType = orderId ?
    "barrelOrder" :
    (collection === "barrelShipments" ? "barrelShipment" : "freightShipment");

  return {
    orderType,
    recordId: orderId || row.id,
    label: held ? "Cancel — customer keeps their money" : "Cancel & refund",
    confirmEn: held ?
      "Cancel this booking? The customer was never charged, so nothing is " +
      "refunded and it costs them nothing." :
      `Cancel this booking? ${amount} is refunded to the customer in full, ` +
      "and the platform commission is returned to you. You still pay the " +
      "card processing fee.",
    confirmFr: held ?
      "Annuler cette réservation ? Le client n’a jamais été débité." :
      `Annuler cette réservation ? ${amount} sera intégralement remboursé ` +
      "au client et la commission vous sera restituée.",
    wholeOrder: Boolean(orderId),
  };
}

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
  destinationDelivery: false,
  destinationDeliveryAreas: [],
  destinationDeliveryFee: "",
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
  customerPhone: "",
  customerEmail: "",
  carMake: "",
  carModel: "",
  carYear: "",
  vinNumber: "",
  startDate: "",
  endDate: "",
  paymentMethod: "direct",
  status: "active",
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
      destinationDelivery: row.freightDestinationDeliveryAvailable === true,
      destinationDeliveryAreas: deliveryAreaDraftsFrom(
        row.freightDestinationDeliveryAreas,
      ),
      destinationDeliveryFee: numberString(row.freightDestinationDeliveryFee),
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
    // Delivery is a freight offer, so a route that carries no freight cannot
    // publish one however the form was left before the switches moved.
    const carriesFreight = availability.freightAir || availability.freightSea;
    const deliveryAvailable = carriesFreight && draft.destinationDelivery;
    const deliveryFee = Number(draft.destinationDeliveryFee || 0);
    const deliveryError = deliverySettingsError({
      available: deliveryAvailable,
      areas: draft.destinationDeliveryAreas,
      fee: deliveryFee,
    });
    if (deliveryError) throw new Error(deliveryError);
    const deliveryAreas = deliveryAvailable
      ? deliveryAreasPayload(draft.destinationDeliveryAreas)
      : [];
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
        freightDestinationDeliveryAvailable: deliveryAvailable,
        freightDestinationDeliveryAreas: deliveryAreas,
        // A named list is what a booking is priced against, so the single
        // price is stored only while the list is empty.
        freightDestinationDeliveryFee:
          deliveryAvailable && deliveryAreas.length === 0
            ? Math.round(deliveryFee * 100) / 100
            : 0,
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

  const draftAvailability = canonicalDestinationServiceAvailability(
    enabledServices,
    destinationDraftAvailability(draft),
  );
  const visibleServiceCount =
    Object.values(draftAvailability).filter(Boolean).length;
  // Only a route that carries freight can be asked about delivering it.
  const draftCarriesFreight =
    draftAvailability.freightAir || draftAvailability.freightSea;
  const deliveryFeeError = deliverySettingsError({
    available: draftCarriesFreight && draft.destinationDelivery,
    areas: draft.destinationDeliveryAreas,
    fee: Number(draft.destinationDeliveryFee || 0),
  });
  const listedDeliveryAreas = draft.destinationDeliveryAreas.length;

  function patchDeliveryArea(index: number, patch: Partial<DeliveryAreaDraft>) {
    setDraft((value) => ({
      ...value,
      destinationDeliveryAreas: value.destinationDeliveryAreas.map(
        (area, position) =>
          position === index ? {...area, ...patch} : area,
      ),
    }));
  }

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
                {draftCarriesFreight && (
                  <>
                    <label className="lst-field wide">
                      <span className="label-with-info">
                        Do you deliver to the receiver at the destination?
                        <FieldInfo label="how destination delivery works">
                          <p>
                            By default the receiver collects the parcel from
                            you at the destination. If you deliver, customers
                            of yours can choose that at booking and give the
                            receiver&rsquo;s address.
                          </p>
                          <p>
                            Each fee is flat - the same wherever in that
                            place you take it - and is added to what the
                            customer pays at booking. It is not recalculated
                            when you confirm the weight.
                          </p>
                        </FieldInfo>
                      </span>
                      <select
                        onChange={(event) =>
                          setDraft((value) => ({
                            ...value,
                            destinationDelivery: event.target.value === "yes",
                          }))
                        }
                        value={draft.destinationDelivery ? "yes" : "no"}
                      >
                        <option value="no">The receiver collects it from us</option>
                        <option value="yes">We can deliver to their address</option>
                      </select>
                    </label>
                    {draft.destinationDelivery && (
                      <div className="lst-field wide">
                        <span className="label-with-info">
                          Places you deliver to, and what each costs
                          <FieldInfo label="how delivery places are priced">
                            <p>
                              List the quartiers you serve and the fee for
                              each: Cosa $20, Koloma $10. The customer picks
                              one at booking and pays that fee.
                            </p>
                            <p>
                              Leave the list empty to charge one price
                              anywhere in this country instead.
                            </p>
                          </FieldInfo>
                        </span>
                        {draft.destinationDeliveryAreas.map((area, index) => (
                          <div
                            className="destination-delivery-area"
                            key={`delivery-area-${index}`}
                          >
                            <input
                              aria-label="Place name"
                              maxLength={MAX_AREA_NAME_LENGTH}
                              onChange={(event) =>
                                patchDeliveryArea(index, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="e.g. Cosa"
                              value={area.name}
                            />
                            <input
                              aria-label="Delivery fee (USD)"
                              inputMode="decimal"
                              max={MAX_DESTINATION_DELIVERY_FEE}
                              min="0"
                              onChange={(event) =>
                                patchDeliveryArea(index, {
                                  fee: event.target.value,
                                })
                              }
                              placeholder="20"
                              step="1"
                              type="number"
                              value={area.fee}
                            />
                            <button
                              aria-label={`Remove ${area.name || "place"}`}
                              className="lst-icon-btn"
                              onClick={() =>
                                setDraft((value) => ({
                                  ...value,
                                  destinationDeliveryAreas:
                                    value.destinationDeliveryAreas.filter(
                                      (_, position) => position !== index,
                                    ),
                                }))
                              }
                              type="button"
                            >
                              <X size={15} />
                            </button>
                          </div>
                        ))}
                        <button
                          className="lst-btn ghost"
                          disabled={listedDeliveryAreas >= MAX_DELIVERY_AREAS}
                          onClick={() =>
                            setDraft((value) => ({
                              ...value,
                              destinationDeliveryAreas: [
                                ...value.destinationDeliveryAreas,
                                emptyDeliveryArea(),
                              ],
                            }))
                          }
                          type="button"
                        >
                          <Plus size={15} /> Add a place
                        </button>
                        {listedDeliveryAreas === 0 && (
                          <label className="lst-field">
                            <span>
                              Delivery fee anywhere in this country (USD)
                            </span>
                            <input
                              inputMode="decimal"
                              max={MAX_DESTINATION_DELIVERY_FEE}
                              min="0"
                              onChange={(event) =>
                                setDraft((value) => ({
                                  ...value,
                                  destinationDeliveryFee: event.target.value,
                                }))
                              }
                              step="1"
                              type="number"
                              value={draft.destinationDeliveryFee}
                            />
                          </label>
                        )}
                        {deliveryFeeError && (
                          <small className="field-error">{deliveryFeeError}</small>
                        )}
                      </div>
                    )}
                  </>
                )}
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
        Extra offices are optional. Customers already drop off at your
        headquarters address unless you add another location.
      </p>
      {message && <div className="lst-form-error" role="alert">{message}</div>}
      {locations.loading && <LoadingState />}
      {!locations.loading && rows.length === 0 && (
        <div className="lst-empty compact">
          <h3>No extra office locations yet</h3>
          <p>
            Headquarters is the default drop-off. Add another location only if
            customers can drop off at more than one place.
          </p>
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

export function BarrelsPanel({
  businessId,
  previewMode = false,
  onOpenDestinations,
  focusRecordId = "",
}: PanelProps) {
  const sharedBarrelsEnabled = useSharedBarrelsEnabled();
  const enabled = Boolean(businessId && !previewMode);
  const shipments = useBusinessRows("barrelShipments", businessId, enabled, 500);
  const pools = useBusinessRows("barrelPools", businessId, enabled, 500);
  const balanceRequests = useBusinessRows("barrelPoolBalanceRequests", businessId, enabled, 500);
  const destinations = useBusinessSubcollectionRows("destinationCountries", businessId, enabled, 100);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const focusedCardRef = useRef<HTMLElement | null>(null);
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
  const [messageTone, setMessageTone] = useState<"ok" | "error">("ok");
  const [alertRowId, setAlertRowId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [copied, setCopied] = useState("");
  const [containerDrafts, setContainerDrafts] = useState<Record<string, string>>({});

  const searched = useMemo(
    () => filterRows(shipments.rows, search, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "status", "paymentStatus"]),
    [shipments.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [searched, filter],
  );
  useEffect(() => {
    if (!focusRecordId) return;
    setSearch("");
    setFilter("all");
  }, [focusRecordId]);
  useEffect(() => {
    if (!focusRecordId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRecordId, filteredRows]);
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
    errorMessage?: (error: unknown) => string,
  ) {
    if (confirm && !(await confirmImportantAction(confirm, confirmFr))) return;
    setBusyId(id);
    setMessage("");
    try {
      await action();
      setMessageTone("ok");
      setAlertRowId("");
      setMessage(label);
    } catch (error) {
      setMessageTone("error");
      setAlertRowId(id);
      setMessage(
        errorMessage
          ? errorMessage(error)
          : error instanceof Error && error.message
            ? error.message
            : "Update failed.",
      );
    } finally {
      setBusyId("");
    }
  }

  function updateStatus(row: FirestoreRow, status: string) {
    const submitted = containerDrafts[row.id] ?? "";
    const blocked = barrelInTransitBlockedReason(
      status,
      row.containerNumber,
      submitted,
    );
    if (blocked) return Promise.reject(new Error(blocked));
    const fields = barrelStatusWriteFields(status, {
      submittedContainerNumber: submitted,
      existingContainerNumber: row.containerNumber,
    });
    return setDoc(
      doc(db, "barrelShipments", row.id),
      {
        businessId,
        ...fields,
        statusUpdatedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  async function saveManualContainer(row: FirestoreRow, number: string) {
    const fields = barrelManualContainerWriteFields(number);
    if (!fields) throw new Error("Enter a valid tracking number.");
    try {
      await setDoc(
        doc(db, "barrelShipments", row.id),
        { businessId, ...fields, updatedAt: serverTimestamp() },
        { merge: true },
      );
      setContainerDrafts((drafts) => {
        const next = { ...drafts };
        delete next[row.id];
        return next;
      });
      setMessageTone("ok");
      setAlertRowId("");
      setMessage("Container number saved. You can now mark this barrel in transit.");
    } catch (error) {
      const text = barrelFulfillmentWriteErrorMessage(error);
      setMessageTone("error");
      setAlertRowId(row.id);
      setMessage(text);
      throw new Error(text);
    }
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
        <div className="lst-head-actions"><StatusText busy={Boolean(busyId)} message={message} tone={messageTone} /></div>
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
            <article
              className={`pur-card${focusRecordId === row.id ? " focused" : ""}`}
              key={row.id}
              ref={focusRecordId === row.id ? focusedCardRef : undefined}
            >
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
                {text(row.containerNumber, "") && (
                  <div><span>Container on file</span><b>{text(row.containerNumber)}</b></div>
                )}
              </div>

              {row.pickupRequested === true && (
                <div className="pur-notice"><Truck size={15} /> Pickup: {[text(row.pickupAddress, ""), text(row.pickupBorough, ""), row.pickupDateTime ? formatDate(row.pickupDateTime) : ""].filter(Boolean).join(" · ") || "requested"}</div>
              )}
              {row.pricingPendingReview === true && (
                <div className="pur-notice warn"><AlertTriangle size={15} /> Pricing is pending review for this shipment.</div>
              )}

              {alertRowId === row.id && message && messageTone === "error" && (
                <div className="lst-form-error" role="alert">{message}</div>
              )}

              <div className="pur-actions">
                <label className="bar-field"><span>Update status</span>
	                  <select
	                    value={status}
	                    disabled={busy}
	                    onChange={(event) => {
	                      // Capture before the confirm dialog: this select is
	                      // controlled from Firestore, so it snaps back to
	                      // pending while the dialog is open. Reading
	                      // event.target.value after await wrote pending
	                      // again and toasted a false success.
	                      const nextStatus = event.target.value;
	                      const blocked = barrelInTransitBlockedReason(
	                        nextStatus,
	                        row.containerNumber,
	                        containerDrafts[row.id] ?? "",
	                      );
	                      if (blocked) {
	                        setMessageTone("error");
	                        setAlertRowId(row.id);
	                        setMessage(blocked);
	                        return;
	                      }
	                      void run(
	                        row.id,
	                        "Shipment updated.",
	                        () => updateStatus(row, nextStatus),
	                        `Change shipment status to ${statusLabel(nextStatus)}?`,
	                        `Changer le statut de l’expédition en ${statusLabel(nextStatus)} ?`,
	                        barrelFulfillmentWriteErrorMessage,
	                      );
	                    }}
	                  >
                    {barrelStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
                {(() => {
                  const cancel = businessCancelAction(row, "barrelShipments");
                  if (!cancel) return null;
                  return (
                    <button
                      className="lst-btn ghost danger"
                      type="button"
                      disabled={busy}
                      onClick={() => run(
                        row.id,
                        "Booking cancelled and the customer refunded.",
                        () => httpsCallable(
                            functions, "cancelSecuredBusinessOrder",
                        )({orderType: cancel.orderType,
                          recordId: cancel.recordId}),
                        cancel.confirmEn,
                        cancel.confirmFr,
                      )}
                      title={cancel.wholeOrder ?
                        "This shipment was paid with its order, so the whole " +
                        "order is cancelled" : undefined}
                    >
                      {cancel.label}
                    </button>
                  );
                })()}
              </div>

              <ContainerTrackingCard
                relatedCollection="barrelShipments"
                relatedId={row.id}
                containerNumber={text(row.containerNumber, "")}
                trackingProvider={text(row.trackingProvider, "")}
                allowManualSave
                containerDraft={containerDrafts[row.id] ?? ""}
                onContainerDraftChange={(value) =>
                  setContainerDrafts((drafts) => ({ ...drafts, [row.id]: value }))
                }
                onSaveManual={(number) => saveManualContainer(row, number)}
              />
              <TrackingUpdatesSection relatedCollection="barrelShipments" relatedId={row.id} />
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function FreightPanel({
  businessId,
  previewMode = false,
  focusRecordId = "",
  focusView = "",
}: PanelProps) {
  const enabled = Boolean(businessId && !previewMode);
  const freight = useBusinessRows("freightShipments", businessId, enabled, 500);
  const priceRequests = useFreightQuoteRequests(businessId, enabled);
  const quoteLens = useBusinessQuoteLens(businessId, enabled);
  const ownQuotes = useBusinessRows("freightQuotes", businessId, enabled, 500);
  const [view, setView] = useState<"shipments" | "requests">("shipments");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const focusedCardRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!focusRecordId) return;
    setView(focusView === "requests" ? "requests" : "shipments");
    setSearch("");
    setFilter("all");
  }, [focusRecordId, focusView]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [quoteDrafts, setQuoteDrafts] = useState<
    Record<string, FreightQuoteDraft>
  >({});

  // Only the requests still taking prices. A request whose customer has
  // chosen is finished business, and leaving it in the feed would invite a
  // price the callable refuses.
  const openPriceRequests = useMemo(
    () =>
      priceRequests.rows.filter(
        (row) =>
          text(row.quoteStatus, "collecting") === "collecting" ||
          (Boolean(focusRecordId) && row.id === focusRecordId),
      ),
    [priceRequests.rows, focusRecordId],
  );

  const quoteByRequestId = useMemo(
    () =>
      new Map(ownQuotes.rows.map((quote) => [text(quote.requestId, ""), quote])),
    [ownQuotes.rows],
  );

  const searched = useMemo(
    () => filterRows(freight.rows, search, ["trackingCode", "senderName", "receiverName", "receiverPhone", "destinationCountryName", "freightMode", "status", "paymentStatus"]),
    [freight.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [filter, searched],
  );

  useEffect(() => {
    if (!focusRecordId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRecordId, openPriceRequests, filteredRows, view]);

  async function updateStatus(row: FirestoreRow, status: string) {
    if (!freightStatusChangeAllowed(row, status)) {
      setMessage(
        freightIsPayOnArrival(row) && status === "completed"
          ? "Mark it arrived first - the customer's saved card is charged on arrival, and completion unlocks once it settles."
          : "Fulfillment is locked until the verified weight is settled.",
      );
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

  async function cancelBooking(
      row: FirestoreRow,
      cancel: NonNullable<ReturnType<typeof businessCancelAction>>,
  ) {
    if (!(await confirmImportantAction(cancel.confirmEn, cancel.confirmFr))) {
      return;
    }
    setBusyId(row.id);
    setMessage("");
    try {
      await httpsCallable(functions, "cancelSecuredBusinessOrder")({
        orderType: cancel.orderType,
        recordId: cancel.recordId,
      });
      setMessage("Booking cancelled and the customer refunded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Cancel failed.");
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
    // Everything the weight does not price rides through settlement
    // unchanged. Leaving any of it out of this preview quotes an adjustment
    // that refunds a fee the customer is still owed the service for, and the
    // owner reads that number before agreeing to the charge. Coverage is
    // read off the row rather than assumed: cover is free, so it is zero on
    // anything booked per item and non-zero only on older shipments.
    const coverage = Number(row.coverageFeeCents ?? 0) / 100;
    const destinationDelivery =
      Number(row.destinationDeliveryFeeCents ?? 0) / 100;
    // A set-price parcel is not repriced by the scale. Its price is what the
    // business published for that item; the scale only answers whether the
    // parcel outgrew the weight that price covers, and the excess is charged
    // at the route's rate for the extra mass and nothing else. Mirrors
    // calculateFreightSettlement, which is what actually moves the money.
    const pricingMode = text(row.pricingMode, "");
    const flatPrice =
      pricingMode === "flat" || pricingMode === "manifest"
        ? Number(row.itemFlatPrice ?? 0) || 0
        : 0;
    const includedKg = Number(row.itemIncludedKg ?? 0) || 0;
    const shippingFee =
      flatPrice > 0
        ? flatPrice + Math.max(0, verifiedWeightKg - includedKg) * rate
        : verifiedWeightKg * rate;
    const finalTotal =
      shippingFee + pickup + coverage + destinationDelivery;
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

  // What this business charges for a parcel it has never listed, and whether
  // it stands behind that one. Both belong to the quote rather than to the
  // catalogue: the catalogue has no row for this, which is the whole reason
  // the customer had to ask.
  async function sendQuote(request: FirestoreRow) {
    const draft = quoteDrafts[request.id] ?? emptyFreightQuoteDraft();
    const price = Number(draft.price);
    const validated = validateFreightQuote({
      amountCents: Number.isFinite(price) ? Math.round(price * 100) : Number.NaN,
      coversLoss: draft.coversLoss,
      terms: draft.terms,
    });
    if (!validated.ok) {
      setMessage(freightQuoteErrorMessage(validated.error));
      return;
    }
    setBusyId(`quote:${request.id}`);
    setMessage("");
    try {
      await httpsCallable(functions, "submitFreightQuote")({
        requestId: request.id,
        businessId,
        amountCents: validated.quote.amountCents,
        coversLoss: validated.quote.coversLoss,
        terms: validated.quote.terms,
      });
      setMessage("Your price was sent to the customer.");
    } catch (error) {
      // The callable names the reason - the request stopped taking prices,
      // this business was not asked. A generic line sends the owner hunting
      // through a form that is not the problem.
      setMessage(
        error instanceof Error && error.message
          ? error.message
          : "The price could not be sent. Try again.",
      );
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
      <div className="transport-marketplace-tabs" role="tablist">
        <button
          aria-selected={view === "shipments"}
          className={view === "shipments" ? "active" : ""}
          onClick={() => setView("shipments")}
          role="tab"
          type="button"
        >
          Booked shipments
          <span>{freight.rows.length}</span>
        </button>
        <button
          aria-selected={view === "requests"}
          className={view === "requests" ? "active" : ""}
          onClick={() => setView("requests")}
          role="tab"
          type="button"
        >
          Price requests
          {/* A count of 0 while the query is still open reads as "nobody is
              waiting" and sends the business away from work that is in fact
              queued. Say nothing until the answer is real. */}
          <span>
            {priceRequests.loading ? "\u2026" : openPriceRequests.length}
          </span>
        </button>
      </div>
      {freight.error && <div className="error-box">{freight.error}</div>}
      {view === "requests" && (
        <FreightPriceRequestsFeed
          busyId={busyId}
          drafts={quoteDrafts}
          lens={quoteLens}
          error={priceRequests.error || ownQuotes.error}
          focusRequestId={focusRecordId}
          focusedCardRef={focusedCardRef}
          loading={priceRequests.loading}
          onDraft={(requestId, patch) =>
            setQuoteDrafts((current) => ({
              ...current,
              [requestId]: {
                ...(current[requestId] ?? emptyFreightQuoteDraft()),
                ...patch,
              },
            }))
          }
          onSend={sendQuote}
          quoteByRequestId={quoteByRequestId}
          requests={openPriceRequests}
        />
      )}
      {view === "shipments" && (<>
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
          const paymentReady = freightPaymentReadyForFulfillment(row);
          const versionTwo = Number(row.freightPricingVersion ?? 0) >= 2;
          const settlementStatus = text(row.priceSettlementStatus, versionTwo ? "awaiting_weight" : "legacy_settled");
          const settlementReady = freightSettlementReadyForStatus(row);
          const canConfirmWeight = freightCanConfirmWeight(row);
          const canUpdateStatus = freightCanUpdateStatus(row);
          const dueOnArrival =
            freightIsPayOnArrival(row) && settlementStatus === "due_on_arrival";
          const estimatedWeight = Number(row.estimatedWeightKg ?? row.weightKg ?? 0);
          const verifiedWeight = Number(row.verifiedWeightKg ?? 0);
          // A set price with no weight allowance covers the parcel however
          // heavy it is, so there is nothing a scale could change and the
          // callable refuses one. Offering the action would be offering a
          // button that only produces an error.
          const weighs = row.weightVerificationRequired !== false;
          return (
            <article
              className={`pur-card${focusRecordId === row.id ? " focused" : ""}`}
              key={row.id}
              ref={focusRecordId === row.id ? focusedCardRef : undefined}
            >
              <div className="pur-head"><div className="pur-title"><strong>{text(row.trackingCode, row.id)}</strong><span className="pur-kind">{statusLabel(text(row.mode ?? row.freightMode, "freight"))}</span></div><span className={`lst-badge ${barrelTone(status)}`}>{statusLabel(status)}</span></div>
              <div className="pur-info">
                <div><span>Sender</span><b>{text(row.senderName, "—")}</b></div><div><span>Receiver</span><b>{text(row.receiverName, "—")}</b></div>
                <div><span>Receiver phone</span><b>{text(row.receiverPhone, "—")}</b></div><div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                {weighs
                  ? (<><div><span>Estimated weight</span><b>{estimatedWeight.toLocaleString()} kg</b></div><div><span>Verified weight</span><b>{verifiedWeight > 0 ? `${verifiedWeight.toLocaleString()} kg` : "—"}</b></div></>)
                  : (<><div><span>Pricing</span><b>Set price</b></div><div><span>Set price</span><b>{formatMoney(row.itemFlatPrice)}</b></div></>)}
                <div><span>Rate locked at booking</span><b>{formatMoney(row.pricePerKg ?? row.ratePerKg)} / kg</b></div><div><span>Estimated total</span><b>{formatMoney(row.estimatedTotal ?? row.price ?? row.total)}</b></div>
                <div><span>Final total</span><b>{row.finalTotal == null ? "—" : formatMoney(row.finalTotal)}</b></div><div><span>Settlement</span><b>{statusLabel(settlementStatus)}</b></div>
                <div><span>Payment</span><b>{statusLabel(paymentStatus)}</b></div><div><span>Created</span><b>{formatDate(row.createdAt)}</b></div>
                {text(row.contentsSummary, "") && (
                  <div className="pur-info-wide"><span>In the box</span><b>{text(row.contentsSummary, "")}</b></div>
                )}
              </div>
              {/* The customer paid for delivery at booking, so where it goes
                  is part of fulfillment, not a note buried in the total. */}
              {row.destinationDelivery === true && (
                <div className="pur-notice"><Truck size={15} /> <span>Deliver to the receiver</span> · {text(row.receiverAddress, "Address not provided")} · {formatMoney(row.destinationDeliveryFee)} <span>collected at booking</span></div>
              )}
              {!paymentReady && <div className="pur-notice warn"><AlertTriangle size={15} /> Fulfillment is locked until payment succeeds.</div>}
              {paymentReady && !settlementReady && <div className="pur-notice warn"><AlertTriangle size={15} /> {settlementStatus === "balance_due" || settlementStatus === "balance_payment_pending" ? "Waiting for customer payment. Fulfillment remains locked." : settlementStatus === "needs_attention" ? "Settlement needs attention. Contact support before fulfillment." : weighs ? "Confirm the parcel weight before fulfillment." : "This shipment has a set price. Fulfillment unlocks once payment settles."}</div>}
              {dueOnArrival && <div className="pur-notice"><AlertTriangle size={15} /> The customer's saved card is charged when you mark this shipment arrived.</div>}
              <div className="pur-actions">
                {versionTwo && weighs && verifiedWeight <= 0 && <label className="bar-field"><span>Enter verified weight</span><input aria-label="Enter verified weight" inputMode="decimal" value={weightDrafts[row.id] ?? ""} onChange={(event) => setWeightDrafts((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="0.0" /><button className="lst-btn primary" type="button" disabled={busy || !canConfirmWeight} onClick={() => confirmWeight(row)}>Confirm weight and final price</button></label>}
                <label className="bar-field"><span>Update status</span><select value={status} disabled={busy || !canUpdateStatus} onChange={(event) => updateStatus(row, event.target.value)}>{["pending_payment", "awaiting_weight_confirmation", "awaiting_balance_payment", "settlement_processing", "pending", "in_transit", "ready_for_pickup", "completed", "cancelled"].map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}</select></label>
                {(() => {
                  const cancel = businessCancelAction(row, "freightShipments");
                  if (!cancel) return null;
                  return (
                    <button
                      className="lst-btn ghost danger"
                      type="button"
                      disabled={busy}
                      onClick={() => cancelBooking(row, cancel)}
                    >
                      {cancel.label}
                    </button>
                  );
                })()}
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
      </>)}
    </section>
  );
}

/** What a business is offering for a parcel it has never listed. */
type FreightQuoteDraft = {
  price: string;
  coversLoss: boolean;
  terms: string;
};

function emptyFreightQuoteDraft(): FreightQuoteDraft {
  return { price: "", coversLoss: false, terms: "" };
}

/**
 * Customers asking this business what it charges.
 *
 * Everything here is a parcel with no row in this business's catalogue, so the
 * price and the promise both come from the answer rather than from settings.
 * A business that has already answered sees its own number and can change it:
 * one price per request, revised, never stacked.
 */
function FreightPriceRequestsFeed({
  busyId,
  drafts,
  lens,
  error,
  focusRequestId = "",
  focusedCardRef,
  loading,
  onDraft,
  onSend,
  quoteByRequestId,
  requests,
}: {
  busyId: string;
  drafts: Record<string, FreightQuoteDraft>;
  lens: ReturnType<typeof useBusinessQuoteLens>;
  error: string;
  focusRequestId?: string;
  focusedCardRef?: RefObject<HTMLElement | null>;
  loading: boolean;
  onDraft: (requestId: string, patch: Partial<FreightQuoteDraft>) => void;
  onSend: (request: FirestoreRow) => void;
  quoteByRequestId: Map<string, FirestoreRow>;
  requests: FirestoreRow[];
}) {
  if (error) {
    return <div className="error-box" role="alert">{error}</div>;
  }
  if (loading) return <LoadingState />;
  if (requests.length === 0) {
    return (
      <div className="lst-empty">
        <div className="lst-empty-icon"><Package size={30} /></div>
        <h3>No one is waiting on a price</h3>
        <p>
          When a customer asks what you charge for something you have not
          listed, it arrives here and you answer with a number.
        </p>
      </div>
    );
  }

  return (
    <div className="pur-grid">
      {requests.map((request) => {
        const existing = quoteByRequestId.get(request.id);
        const answered = Boolean(existing);
        const draft = drafts[request.id] ?? {
          price:
            Number(existing?.amountCents ?? 0) > 0
              ? String(Number(existing?.amountCents) / 100)
              : "",
          coversLoss: existing?.coversLoss === true,
          terms: text(existing?.terms, ""),
        };
        const weightKg = Number(request.weightKg ?? 0);
        const contents = contentsFromRecord(request.contents);
        const route = lens.routes.get(text(request.destinationCountryId, ""));
        const routeRate = Number(
          text(request.mode, "air") === "sea"
            ? route?.freightSeaPricePerKg
            : route?.freightAirPricePerKg,
        ) || 0;
        const view = contents
          ? quoteLensForBusiness({
              table: lens.table,
              ratePerKgCents: Math.round(routeRate * 100),
              multiplierFor: lens.multiplierFor,
              contents,
            })
          : null;
        const busy = busyId === `quote:${request.id}`;
        const focused = Boolean(focusRequestId) && focusRequestId === request.id;
        return (
          <article
            className={`pur-card${focused ? " focused" : ""}`}
            key={request.id}
            ref={focused ? focusedCardRef : undefined}
          >
            <div className="pur-head">
              <div className="pur-title">
                <strong>{text(request.trackingCode, request.id)}</strong>
                <span className="pur-kind">
                  {statusLabel(text(request.mode, "freight"))}
                </span>
              </div>
              <span className={`lst-badge ${answered ? "ok" : "warn"}`}>
                {answered ? "You answered" : "Waiting on you"}
              </span>
            </div>
            <div className="pur-info">
              <div><span>Destination</span><b>{text(request.destinationCountryName, "—")}</b></div>
              <div><span>Category</span><b>{text(request.itemLabel ?? request.itemCategoryId, "—")}</b></div>
              <div>
                <span>Weight given</span>
                <b>{weightKg > 0 ? `${weightKg.toLocaleString()} kg` : "Not given"}</b>
              </div>
              <div><span>Asked</span><b>{formatDate(request.createdAt)}</b></div>
            </div>
            {contents && view && (
              <div className="freight-request-contents">
                <table>
                  <tbody>
                    {view.lines.map((line, index) => (
                      <tr key={index}>
                        <td>{line.quantity} × {line.label}</td>
                        <td>
                          {line.lineCents != null
                            ? formatMoney(line.lineCents / 100)
                            : line.hint}
                        </td>
                      </tr>
                    ))}
                    {view.weighedNote && (
                      <tr>
                        <td>Other goods</td>
                        <td>{view.weighedNote}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {view.suggestionCents != null && (
                  <button
                    className="lst-btn"
                    onClick={() =>
                      onDraft(request.id, {
                        price: (view.suggestionCents! / 100).toFixed(2),
                      })
                    }
                    type="button"
                  >
                    Use suggested {formatMoney(view.suggestionCents / 100)}
                  </button>
                )}
              </div>
            )}
            {(text(request.description, "") || !contents) && (
              <div className="pur-notice">
                <ClipboardList size={15} />{" "}
                <span>{text(request.description, "No description given")}</span>
              </div>
            )}
            <div className="pur-actions">
              <label className="bar-field">
                <span>What you charge (USD)</span>
                <input
                  aria-label="What you charge (USD)"
                  inputMode="decimal"
                  onChange={(event) =>
                    onDraft(request.id, { price: event.target.value })
                  }
                  placeholder="0.00"
                  value={draft.price}
                />
              </label>
              <label className="bar-field">
                <span className="label-with-info">
                  Do you cover this parcel if it is lost?
                  <FieldInfo label="what cover on a quote means">
                    <p>
                      This parcel is not in your item list, so this price
                      carries its own promise. Say no and the customer is
                      told plainly that you do not cover it.
                    </p>
                    <p>
                      The customer is charged nothing for it, so price the
                      parcel for what it is worth to you to carry.
                    </p>
                  </FieldInfo>
                </span>
                <select
                  aria-label="Do you cover this parcel if it is lost?"
                  onChange={(event) =>
                    onDraft(request.id, {
                      coversLoss: event.target.value === "yes",
                    })
                  }
                  value={draft.coversLoss ? "yes" : "no"}
                >
                  <option value="no">No, I do not cover this parcel</option>
                  <option value="yes">Yes, I cover this parcel</option>
                </select>
              </label>
              <label className="bar-field">
                <span>Note for the customer (optional)</span>
                <input
                  aria-label="Note for the customer"
                  maxLength={1000}
                  onChange={(event) =>
                    onDraft(request.id, { terms: event.target.value })
                  }
                  placeholder="What is included, how long it takes"
                  value={draft.terms}
                />
              </label>
              <button
                className="lst-btn primary"
                disabled={busy}
                onClick={() => onSend(request)}
                type="button"
              >
                <Send size={15} />{" "}
                {busy
                  ? "Sending your price..."
                  : answered
                    ? "Change your price"
                    : "Send your price"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
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

export function TransportPanel({
  businessId,
  previewMode = false,
  focusRequestId = "",
  focusView = "",
}: PanelProps) {
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
  // Typed container numbers, per job. Asked for before `in_transit` rather
  // than letting the server's refusal be how an operator finds out it was
  // needed.
  const [containerDrafts, setContainerDrafts] = useState<Record<string, string>>({});
  const focusedCardRef = useRef<HTMLElement | null>(null);

  // A notification points at one request. Open Accepted jobs for a paid/won
  // job and Opportunities for a new or lost quote — never force Opportunities
  // for every transport notification.
  useEffect(() => {
    if (!focusRequestId) return;
    setView(focusView === "jobs" ? "jobs" : "opportunities");
    setSearch("");
  }, [focusRequestId, focusView]);

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
  // Only work a quote can still win. A won opportunity lives in Accepted
  // jobs - showing it here too made every job appear twice - and a closed or
  // cancelled one is finished business, not an opportunity. Split from the
  // search filter so the tab count and the empty states describe THIS list,
  // not the raw collection.
  const openOpportunities = useMemo(
    () =>
      opportunities.rows.filter((row) => {
        const status = text(row.status, "open");
        return status !== "selected" && status !== "closed" &&
          status !== "cancelled";
      }),
    [opportunities.rows],
  );
  const filteredOpportunities = useMemo(
    () =>
      filterRows(openOpportunities, search, [
        "trackingCode",
        "carMake",
        "carModel",
        "carYear",
        "pickupArea",
        "destinationCountryName",
        "status",
      ]),
    [openOpportunities, search],
  );

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

  // The rows stream in from Firestore, so the target card usually does not
  // exist on the render that handles the notification - scroll once it does.
  useEffect(() => {
    if (!focusRequestId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRequestId, filteredOpportunities, filteredJobs, view]);

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

  // One path for every transport job, marketplace or legacy. There used to be
  // a second: legacy records were written straight to `transportRequests`,
  // because the callable refused anything without a selected quote. That
  // fallback skipped the transition table AND the container-number gate, so a
  // legacy car could be marked delivered from pending, or in transit with
  // nothing to track it by. The callable now accepts legacy records on their
  // own `businessId`, so the direct write is gone and the state machine has
  // exactly one implementation.
  async function updateTransportStatus(row: FirestoreRow, status: string) {
    const currentStatus = transportJobCurrentStatus(row);
    const submittedContainerNumber = containerDrafts[row.id] ?? "";
    const errors = validateTransportFulfillmentChange({
      currentStatus,
      nextStatus: status,
      existingContainerNumber: row.containerNumber,
      submittedContainerNumber,
    });
    if (errors.length > 0) {
      setMessage(transportFulfillmentErrorMessage(errors));
      return;
    }
    setBusyId(`${row.id}:${status}`);
    setMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "updateTransportFulfillmentStatus",
      )(
        transportFulfillmentPayload({
          requestId: row.id,
          status,
          containerNumber: submittedContainerNumber,
          businessId,
        }),
      );
      setContainerDrafts((drafts) => {
        const next = { ...drafts };
        delete next[row.id];
        return next;
      });
      // Two people clicking the same status is a success, not a failure.
      const alreadyUpdated =
        (response.data as { alreadyUpdated?: boolean } | null)?.alreadyUpdated === true;
      setMessage(
        alreadyUpdated
          ? "This job was already on that status."
          : "Transport updated.",
      );
    } catch (error) {
      // The server's own sentence names the reason (wrong business, terminal
      // status, missing container number). Replacing it with a generic line
      // would throw away the only thing that says what to do next.
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
          <span>{openOpportunities.length}</span>
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
          {!opportunities.loading && openOpportunities.length === 0 && (
            <div className="lst-empty">
              <div className="lst-empty-icon"><ClipboardList size={30} /></div>
              <h3>No quote opportunities right now</h3>
              <p>Eligible customer requests will appear here when they match your service area.</p>
            </div>
          )}
          {!opportunities.loading &&
            openOpportunities.length > 0 &&
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
              // What the server compares against its table: `fulfillmentStatus`
              // when it has one, `status` otherwise. Reading `status` alone
              // showed a stale value on every job the callable had moved.
              const status = transportJobCurrentStatus(row);
              const known = transportFulfillmentStatusIsKnown(status);
              // A marketplace job is not workable until the customer's money
              // is secured - the server refuses everything but cancelling, so
              // offering more here would only manufacture refusals.
              const awaitingPayment =
                Number(row.flowVersion ?? 1) === 2 &&
                text(row.quoteStatus, "") === "selected" &&
                text(row.paymentStatus, "") !== "succeeded" &&
                status !== "cancelled";
              const nextStatuses = awaitingPayment
                ? transportFulfillmentNextStatuses(status).filter(
                    (next) => next === "cancelled",
                  )
                : transportFulfillmentNextStatuses(status);
              const container = normalizeTransportContainerNumber(row.containerNumber);
              const busyRow = busyId.startsWith(`${row.id}:`);
              const selectedAmountCents = Number(row.selectedAmountCents ?? 0);
              const focused = Boolean(focusRequestId) && focusRequestId === row.id;
              return (
                <article
                  className={`pur-card transport-job-card${focused ? " focused" : ""}`}
                  key={row.id}
                  ref={focused ? focusedCardRef : undefined}
                >
                  <div className="pur-head">
                    <div className="pur-title">
                      <strong>{transportTitle(row)}</strong>
                      <span className="pur-kind">{text(row.trackingCode, "Transport")}</span>
                    </div>
                    {/* An unrecognised status is SHOWN, not mapped onto the
                        nearest transport status: the admin record path can
                        write `active`, `in_progress`, `completed`, `sold`,
                        `reserved` or `inactive` onto this same document, and
                        labelling one of those "In transit" would be a claim
                        nobody made. */}
                    <span className={`lst-badge ${known ? transportTone(status) : "warn"}`}>
                      {known ? statusLabel(status) : text(status, "Not provided")}
                    </span>
                  </div>
                  <div className="pur-info">
                    <div><span>Owner</span><b>{text(row.ownerName ?? row.customerName, "—")}</b></div>
                    <div><span>Contact phone</span><b>{text(row.customerPhone, "—")}</b></div>
                    <div><span>Pickup</span><b>{text(row.pickupAddress, "—")}</b></div>
                    <div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                    <div><span>Accepted quote</span><b>{selectedAmountCents > 0 ? formatMoney(selectedAmountCents / 100) : formatMoney(row.price)}</b></div>
                    <div><span>Transport date</span><b>{formatDate(row.transportDate ?? row.estimatedPickupDate ?? row.createdAt)}</b></div>
                    {container && (<div><span>Container on file</span><b>{container}</b></div>)}
                  </div>
                  <div className="pur-actions transport-job-move">
                    <span className="transport-job-move-title">Update job status</span>
                    {awaitingPayment && (
                      <p className="transport-job-move-note">
                        The customer has accepted your quote and payment is
                        being secured. You can schedule the job as soon as it
                        is paid — you will get a notification.
                      </p>
                    )}
                    {!known ? (
                      <p className="transport-job-move-note">
                        This job is on a status the transport workflow did not set, so no transport action applies here.
                      </p>
                    ) : nextStatuses.length === 0 ? (
                      <p className="transport-job-move-note">
                        This job is finished. There is nothing left to move.
                      </p>
                    ) : (
                      <>
                        {/* Shown only while a move that needs it is on offer,
                            and only while the job does not already carry one. */}
                        {nextStatuses.some(transportFulfillmentRequiresContainer) && !container && (
                          <label className="bar-field">
                            <span>Container / booking / BOL number</span>
                            <input
                              onChange={(event) =>
                                setContainerDrafts((drafts) => ({ ...drafts, [row.id]: event.target.value }))
                              }
                              placeholder="e.g. MSKU1234567"
                              value={containerDrafts[row.id] ?? ""}
                            />
                          </label>
                        )}
                        <div className="transport-job-move-actions">
                          {nextStatuses.map((next) => (
                            <button
                              aria-busy={busyId === `${row.id}:${next}`}
                              className={`lst-btn${next === "cancelled" ? " danger" : ""}`}
                              disabled={busyRow}
                              key={next}
                              onClick={() => void updateTransportStatus(row, next)}
                              type="button"
                            >
                              {busyId === `${row.id}:${next}` ? <RefreshCw className="spin" size={15} /> : null}
                              {busyId === `${row.id}:${next}` ? "Updating..." : statusLabel(next)}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* A transported car gets the same milestone feed and
                      carrier subscription as a barrel - the customer's
                      journey card reads from exactly this. */}
                  <ContainerTrackingCard
                    relatedCollection="transportRequests"
                    relatedId={row.id}
                    containerNumber={container}
                    trackingProvider={text(row.trackingProvider, "")}
                  />
                  <TrackingUpdatesSection
                    relatedCollection="transportRequests"
                    relatedId={row.id}
                  />
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

/** How long a row-level result stays in the panel header. */
const ROW_MESSAGE_MS = 6000;

/**
 * A message setter for results that belong to one row rather than to the
 * panel. "Already recorded as paid." is an answer to a click, not a state of
 * the panel — left in the header it reads as a standing claim about a list the
 * owner has since scrolled away from. This clears it.
 *
 * Panel-level errors keep the plain `setMessage`: a refusal that stops work
 * must stay on screen until the work is done differently.
 *
 * @param setMessage The panel's own message setter.
 * @param ms How long the message survives.
 * @return A setter that clears itself, cancelling any message still pending.
 */
function useTransientMessage(setMessage: (value: string) => void, ms = ROW_MESSAGE_MS) {
  const timer = useRef<number | null>(null);
  // Without this, a click followed by a tab change fires setState on an
  // unmounted panel six seconds later.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    },
    [],
  );
  return (value: string) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setMessage(value);
    if (!value) return;
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setMessage("");
    }, ms);
  };
}

// `businessName` is no longer destructured: the panel used to stamp it onto
// the parkedCars document it wrote itself, and every write now goes through a
// callable that reads the business record server-side.
export function ParkingPanel({
  businessId,
  previewMode = false,
  focusRecordId = "",
}: PanelProps) {
  const parkedCars = useBusinessRows("parkedCars", businessId, Boolean(businessId && !previewMode), 500);
  const parkingStaff = useBusinessStaff(businessId, Boolean(businessId && !previewMode), 200);
  // The lot already remembers everyone it has taken a car from - walk-ups
  // write to lotCustomers through createBusinessParkingEntry. A regular is
  // therefore someone to pick, not someone to re-type.
  const parkingCustomers = useBusinessRows("lotCustomers", businessId, Boolean(businessId && !previewMode), 500);
  const [draft, setDraft] = useState<ParkingDraft>(emptyParkingDraft);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  // The edit form is validated by the same rules as the create form, so it
  // reports the same list of sentences.
  const [editErrors, setEditErrors] = useState<BusinessParkingEntryError[]>([]);
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
  const [entryCustomerMenuOpen, setEntryCustomerMenuOpen] = useState(false);
  const [entryCustomerPick, setEntryCustomerPick] = useState<LotCustomer | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [receivedVia, setReceivedVia] = useState<Record<string, string>>({});
  const [paidBusyId, setPaidBusyId] = useState("");
  // Set only when window.open was blocked, so the card can offer the document
  // as a plain link the browser will honour.
  const [blockedDocument, setBlockedDocument] = useState<{ id: string; url: string } | null>(null);
  const setRowMessage = useTransientMessage(setMessage);
  const focusedCardRef = useRef<HTMLElement | null>(null);
  const searched = useMemo(
    () => filterRows(parkedCars.rows, search, ["trackingCode", "ownerName", "customerName", "carMake", "carModel", "carYear", "vinNumber", "status"]),
    [parkedCars.rows, search],
  );
  // One control, two questions: where the car is in its stay, and whether it
  // has been paid for. A lot chasing money filters on the second and never
  // learns the first is a separate dropdown.
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");

  const filteredRows = useMemo(() => {
    // The date window narrows first: "what was in the lot that week" is the
    // question, and the status/payment filter refines it.
    const inRange = (rangeFrom || rangeTo)
      ? searched.filter((row) => businessParkingWithinRange(row, rangeFrom, rangeTo))
      : searched;
    if (filter === "all") return inRange;
    if (filter === "payment:paid") {
      return inRange.filter((row) => businessParkingPaymentTone(row) === "paid");
    }
    if (filter === "payment:unpaid") {
      // "Not paid" is money still owed — a cancelled car or one with nothing
      // to collect ("none") is not something to chase.
      return inRange.filter((row) => businessParkingPaymentTone(row) === "awaiting");
    }
    return inRange.filter((row) => text(row.status, "") === filter);
  }, [searched, filter, rangeFrom, rangeTo]);
  useEffect(() => {
    if (!focusRecordId) return;
    setSearch("");
    setFilter("all");
    setRangeFrom("");
    setRangeTo("");
  }, [focusRecordId]);
  useEffect(() => {
    if (!focusRecordId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRecordId, filteredRows]);
  const activeCount = parkedCars.rows.filter((row) => text(row.status, "active") === "active").length;

  function closeForm() {
    setDraft(emptyParkingDraft);
    setEditErrors([]);
    setFormOpen(false);
  }
  function editParking(row: FirestoreRow) {
    setDraft({
      id: row.id,
      ownerName: text(row.customerName ?? row.ownerName, ""),
      customerPhone: text(row.customerPhone, ""),
      customerEmail: text(row.customerEmail, ""),
      carMake: text(row.carMake, ""),
      carModel: text(row.carModel, ""),
      carYear: text(row.carYear, ""),
      vinNumber: text(row.vinNumber, ""),
      startDate: dateInputValue(row.parkingDate ?? row.createdAt),
      endDate: dateInputValue(row.parkingEndDate),
      paymentMethod:
        text(row.paymentMethod, "direct") === "payment_link" ? "payment_link" : "direct",
      status: text(row.status, "active"),
    });
    setEditErrors([]);
    setMessage("");
    setFormOpen(true);
  }

  /**
   * Everything the callable owns, as the callable's own draft shape. Keeping
   * one shape means the edit form is validated by the same rules the create
   * form is, rather than a second, drifting copy of them.
   */
  function editDraftAsEntry(): BusinessParkingEntryDraft {
    return {
      customerName: draft.ownerName,
      customerPhone: draft.customerPhone,
      customerEmail: draft.customerEmail,
      carMake: draft.carMake,
      carModel: draft.carModel,
      carYear: draft.carYear,
      vinNumber: draft.vinNumber,
      startDate: draft.startDate,
      endDate: draft.endDate,
      paymentMethod: draft.paymentMethod,
    };
  }

  // The edit no longer writes a parkedCars document from the browser. A
  // client-side setDoc could change the dates a stay is billed on without the
  // amount ever being recalculated - so the record's price and the days it
  // covers stopped agreeing. updateBusinessParkingEntry recomputes the amount
  // from the business's rates, reissues the customer's link when that amount
  // moves, and refuses records whose money has already settled.
  async function saveParking() {
    if (!businessId) {
      setMessage("Business ID is required.");
      return;
    }
    if (!draft.id) {
      setMessage("Open a parking record to edit it.");
      return;
    }
    // Hiding the Edit button is the affordance; this is the guard. A paid
    // record's amount has already been charged, split and paid out. The
    // server refuses it too - this only saves the round trip.
    const existing = parkedCars.rows.find((row) => row.id === draft.id);
    if (existing && businessParkingPaymentTone(existing) === "paid") {
      setMessage("This parking has been paid for and can no longer be edited.");
      return;
    }

    const entry = editDraftAsEntry();
    const errors = validateBusinessParkingEntryDraft(entry, businessId);
    setEditErrors(errors);
    if (errors.length > 0) {
      // The list under the form already names every one of these.
      setMessage("");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "updateBusinessParkingEntry",
      )({entryId: draft.id, changes: businessParkingUpdateChanges(entry)});
      const result = businessParkingUpdateResult(response.data);
      // Status is not the callable's business; it stays on the path that
      // already owned it, and only moves when the staff member changed it.
      if (existing && draft.status !== text(existing.status, "active")) {
        await updateParkingStatus(existing, draft.status);
      }
      closeForm();
      // A reissued link is the one outcome staff must not miss: the customer
      // is now holding a link for a different amount than the one quoted.
      setMessage(
        result.relinked
          ? "The amount changed, so a new payment link was issued and the customer was notified of the new amount."
          : "Parking record updated.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "The parking record could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateParkingStatus(row: FirestoreRow, status: string) {
    if (!businessId) throw new Error("Business ID is required.");
    await setDoc(
      doc(db, "parkedCars", row.id),
      {
        businessId,
        status,
        // Deliberately does NOT touch parkingEndDate. Marking a car completed
        // says it left the lot; it must not rewrite the window the server
        // priced. Stamping "now" here made an early departure silently
        // contradict the amount owed - and any invoice or payment link the
        // customer is already holding. Changing what is owed is the edit
        // flow's job, where the customer is re-quoted.
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

  const entryKnownCustomers = useMemo(
    () => parkingCustomers.rows.map((row) => lotCustomerFromRow(row as Record<string, unknown>)),
    [parkingCustomers.rows],
  );
  // Suggestions close once someone has been picked, so the list does not sit
  // over the fields it just filled.
  const entryCustomerMatches = useMemo(
    () => (entryCustomerMenuOpen && !entryCustomerPick
      ? matchLotCustomers(entryKnownCustomers, entryDraft.customerName)
      : []),
    [entryKnownCustomers, entryDraft.customerName, entryCustomerMenuOpen, entryCustomerPick],
  );

  function applyEntryCustomerCar(car: LotCustomerCar) {
    setEntryDraft((value) => ({
      ...value,
      vinNumber: car.vin || value.vinNumber,
      carMake: car.make || value.carMake,
      carModel: car.model || value.carModel,
      carYear: car.year || value.carYear,
    }));
  }

  // Picking a regular fills their contact details, and their car too when
  // there is only one. Everything stays editable: the lot's memory is a
  // suggestion, not a record that outranks the person at the desk.
  function pickEntryCustomer(customer: LotCustomer) {
    setEntryCustomerPick(customer);
    setEntryCustomerMenuOpen(false);
    setEntryDraft((value) => ({
      ...value,
      customerName: customer.name || value.customerName,
      customerPhone: customer.phone || value.customerPhone,
      customerEmail: customer.email || value.customerEmail,
    }));
    if (customer.cars.length === 1) applyEntryCustomerCar(customer.cars[0]);
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
    setRowMessage("");
    try {
      const response = await httpsCallable(functions, "markBusinessParkingPaid")({
        entryId: row.id,
        receivedVia: method,
      });
      const data = (response.data ?? {}) as {alreadyPaid?: boolean};
      setRowMessage(data.alreadyPaid ? "This parking was already marked paid." : "Payment recorded.");
    } catch (error) {
      setRowMessage(error instanceof Error ? error.message : "The payment could not be recorded.");
    } finally {
      setPaidBusyId("");
    }
  }

  async function cancelPaymentLink(row: FirestoreRow) {
    const confirmed = await confirmImportantAction(
      "Cancel this payment link? The customer will no longer be able to pay with it.",
      "Annuler ce lien de paiement ? Le client ne pourra plus payer avec.",
    );
    if (!confirmed) return;
    setPaidBusyId(row.id);
    setRowMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "cancelBusinessParkingPaymentLink",
      )({entryId: row.id});
      const data = (response.data ?? {}) as { alreadyCancelled?: boolean };
      setRowMessage(
        data.alreadyCancelled
          ? "This payment link was already cancelled."
          : "Payment link cancelled.",
      );
    } catch (error) {
      setRowMessage(
        error instanceof Error ? error.message : "The payment link could not be cancelled.",
      );
    } finally {
      setPaidBusyId("");
    }
  }

  // A link that was sent while the customer's phone was wrong, or that landed
  // in a spam folder, is a space the lot cannot bill for. Re-sending costs
  // nothing and does not change the amount.
  async function resendPaymentLink(row: FirestoreRow) {
    setPaidBusyId(row.id);
    setRowMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "resendBusinessParkingPaymentLink",
      )({entryId: row.id});
      const data = (response.data ?? {}) as {emailed?: boolean; texted?: boolean};
      setRowMessage(
        businessParkingResendMessage(data.emailed === true, data.texted === true),
      );
    } catch (error) {
      setRowMessage(
        error instanceof Error ? error.message : "The payment link could not be re-sent.",
      );
    } finally {
      setPaidBusyId("");
    }
  }

  async function checkLinkPayment(row: FirestoreRow) {
    setPaidBusyId(row.id);
    setRowMessage("");
    try {
      const response = await httpsCallable(
        functions,
        "refreshBusinessParkingPayment",
      )({entryId: row.id});
      const data = (response.data ?? {}) as {
        paid?: boolean;
        alreadyRecorded?: boolean;
      };
      setRowMessage(
        data.paid
          ? data.alreadyRecorded
            ? "Already recorded as paid."
            : "Payment confirmed with Stripe and recorded."
          : "Stripe has not received this payment yet.",
      );
    } catch (error) {
      setRowMessage(
        error instanceof Error
          ? error.message
          : "The payment status could not be checked.",
      );
    } finally {
      setPaidBusyId("");
    }
  }

  // A lot handing a car back needs paper: a receipt once the money is in, an
  // invoice while it is not. The server renders and brands the document; this
  // only has to get the owner to it.
  async function openParkingDocument(row: FirestoreRow) {
    setPaidBusyId(row.id);
    setRowMessage("");
    setBlockedDocument(null);
    try {
      const response = await httpsCallable(
        functions,
        "getParkingDocumentUrl",
      )({entryId: row.id});
      const data = (response.data ?? {}) as {documentType?: string; url?: string};
      const url = text(data.url, "");
      if (!url) throw new Error("The document is not ready yet. Try again in a moment.");
      // The callable is awaited, so this open is no longer inside the click's
      // user gesture and a blocker can refuse it silently. A refusal must
      // leave the owner a link, not a button that appears to do nothing.
      const opened = window.open(url, "_blank", "noopener");
      if (!opened) {
        setBlockedDocument({id: row.id, url});
        setRowMessage("Your browser blocked the document window. Allow pop-ups for this site, or use the link on the card.");
      }
    } catch (error) {
      setRowMessage(
        error instanceof Error ? error.message : "The document could not be prepared.",
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
          {/* "New parking" used to sit here. It wrote a parkedCars document
              straight from the browser: no server-issued tracking code, no
              amount due, no space check, no payment plan - a record the
              payment system could not settle. "Record a parked car" goes
              through createBusinessParkingEntry and does all of it. */}
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
          <optgroup label="Parking status">
            {parkingStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
          </optgroup>
          <optgroup label="Payment">
            <option value="payment:paid">Paid</option>
            <option value="payment:unpaid">Not paid</option>
          </optgroup>
        </select>
        {/* Which cars were in the lot during a window - overlapping, not
            only those entirely inside it, or a long stay disappears. */}
        <label className="bar-field" style={{ flex: "0 0 auto" }}><span>Parked between</span>
          <input type="date" value={rangeFrom} onChange={(event) => setRangeFrom(event.target.value)} aria-label="Parked between start date" />
        </label>
        <label className="bar-field" style={{ flex: "0 0 auto" }}><span>and</span>
          <input type="date" value={rangeTo} onChange={(event) => setRangeTo(event.target.value)} aria-label="Parked between end date" />
        </label>
        {(rangeFrom || rangeTo) && (
          <button className="lst-btn ghost" type="button" onClick={() => { setRangeFrom(""); setRangeTo(""); }}>Clear dates</button>
        )}
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
            <article
              className={`pur-card${focusRecordId === row.id ? " focused" : ""}`}
              key={row.id}
              ref={focusRecordId === row.id ? focusedCardRef : undefined}
            >
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
                {Boolean(row.parkingEndDate) && <div><span>{businessParkingEndLabel(row)}</span><b>{formatDate(row.parkingEndDate)}</b></div>}
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
                      // paymentLinkUrl is the durable Laawol link; a Stripe
                      // session URL dies within 24 hours, so it is only the
                      // fallback for records created before this existed.
                      <button className="lst-btn ghost" type="button" onClick={() => copyCheckoutUrl(text(row.paymentLinkUrl ?? row.checkoutUrl, ""))} title="Copy payment link">
                        <Copy size={14} /> Copy payment link
                      </button>
                    )}
                    {/* A webhook can be late or lost; the lot should never be
                        stuck guessing whether a car has been paid for. Once it
                        is paid there is nothing left to ask Stripe, so the
                        button goes — same rule as the cancel button below. */}
                    {businessParkingPaymentTone(row) !== "paid" && (
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
                    )}
                    {/* Same gate as Cancel below: a paid link has nothing
                        left to collect, and a cancelled one must not be
                        quietly brought back to life by a re-send. */}
                    {canResendBusinessParkingLink(row) && (
                      <button
                        className="lst-btn ghost"
                        type="button"
                        disabled={paidBusyId === row.id}
                        onClick={() => void resendPaymentLink(row)}
                        title="Resend link"
                      >
                        <Send size={14} /> Resend link
                      </button>
                    )}
                    {/* The other half of the rule: a link stays good until
                        the customer pays it or the lot kills it here. */}
                    {canResendBusinessParkingLink(row) && (
                      <button
                        className="lst-btn ghost"
                        type="button"
                        disabled={paidBusyId === row.id}
                        onClick={() => void cancelPaymentLink(row)}
                        title="Cancel payment link"
                      >
                        <X size={14} /> Cancel payment link
                      </button>
                    )}
                  </div>
                </div>
              )}
              <ParkingBillingActions row={row} staff={parkingStaff.rows} />
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
                {/* Paper for the owner: a receipt once the money is in, an
                    invoice while it is still owed. The document itself is
                    server-rendered and print-optimised. */}
                {businessEntered && (
                  <button
                    className="lst-btn ghost"
                    type="button"
                    disabled={rowBusy}
                    aria-busy={rowBusy}
                    onClick={() => void openParkingDocument(row)}
                    title={businessParkingDocumentType(row) === "receipt" ? "Print receipt" : "Print invoice"}
                  >
                    {rowBusy ? <RefreshCw className="spin" size={14} /> : <Printer size={14} />}
                    {rowBusy
                      ? "Preparing..."
                      : businessParkingDocumentType(row) === "receipt"
                        ? "Print receipt"
                        : "Print invoice"}
                  </button>
                )}
                {blockedDocument?.id === row.id && (
                  <a className="lst-btn ghost" href={blockedDocument.url} target="_blank" rel="noopener noreferrer">
                    <Printer size={14} /> Open the document
                  </a>
                )}
                {/* A paid record is settled money: the amount was charged,
                    the platform fee taken and the payout sent. Editing it
                    here would rewrite the price of a completed sale with no
                    server check and no audit trail, so it is not offered. */}
                {businessParkingPaymentTone(row) === "paid" ? (
                  <span className="lst-hint">Paid records cannot be edited</span>
                ) : (
                  <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editParking(row)}><Pencil size={14} /> Edit</button>
                )}
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
              <h3>Edit parking</h3>
              <button className="lst-icon-btn" type="button" disabled={busy} onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {message && <div className="lst-form-error" role="alert">{message}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Owner name</span>
                  <input value={draft.ownerName} onChange={(event) => setDraft((value) => ({ ...value, ownerName: event.target.value }))} placeholder="Customer name" />
                </label>
                <label className="lst-field"><span>Customer phone</span>
                  <input value={draft.customerPhone} onChange={(event) => setDraft((value) => ({ ...value, customerPhone: event.target.value }))} placeholder="Phone number" />
                </label>
                {/* Email is what a re-sent payment link travels on, so it is
                    editable here rather than frozen at the moment of intake. */}
                <label className="lst-field"><span>Customer email</span>
                  <input value={draft.customerEmail} onChange={(event) => setDraft((value) => ({ ...value, customerEmail: event.target.value }))} placeholder="Email address" />
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
                {/* Both ends of the stay: the server re-prices from these, so
                    a corrected pick-up day changes what is owed. */}
                <label className="lst-field"><span>Start date</span>
                  <input type="date" value={draft.startDate} onChange={(event) => setDraft((value) => ({ ...value, startDate: event.target.value }))} />
                </label>
                <label className="lst-field"><span>End date (optional)</span>
                  <input type="date" value={draft.endDate} onChange={(event) => setDraft((value) => ({ ...value, endDate: event.target.value }))} />
                  <small className="lst-hint">Leave blank if you don&apos;t know when the car leaves — the stay stays open and you bill it any time.</small>
                </label>
                <label className="lst-field"><span>Payment method</span>
                  <select value={draft.paymentMethod} onChange={(event) => setDraft((value) => ({ ...value, paymentMethod: event.target.value === "payment_link" ? "payment_link" : "direct" }))}>
                    <option value="direct">Direct payment (Zelle or cash)</option>
                    <option value="payment_link">Payment link</option>
                  </select>
                </label>
                <label className="lst-field"><span>Status</span>
                  <select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
                    {parkingStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
                  </select>
                </label>
              </div>
              {/* No amount input, deliberately: the server recalculates the
                  price from the business's parking rates every time, so a
                  typed total would only ever be overwritten - or believed. */}
              <p className="lst-hint">The amount is recalculated from your parking rates when you save. If it changes on a payment-link parking, we issue a new link and tell the customer.</p>
              {editErrors.length > 0 && (
                <ul className="lst-form-error" role="alert">
                  {editErrors.map((code) => (<li key={code}>{BUSINESS_PARKING_ENTRY_MESSAGES[code]}</li>))}
                </ul>
              )}
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" disabled={busy} onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} aria-busy={busy} onClick={() => void saveParking()}>
                {busy ? <RefreshCw className="spin" size={16} /> : <Save size={16} />}
                {busy ? "Saving..." : "Save changes"}
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
                  <label className="lst-field wide" style={{ position: "relative" }}><span>Customer name</span>
                    <input
                      value={entryDraft.customerName}
                      autoComplete="off"
                      placeholder="Customer name"
                      onFocus={() => setEntryCustomerMenuOpen(true)}
                      onBlur={() => window.setTimeout(() => setEntryCustomerMenuOpen(false), 150)}
                      onChange={(event) => {
                        setEntryCustomerPick(null);
                        setEntryCustomerMenuOpen(true);
                        setEntryDraft((value) => ({...value, customerName: event.target.value}));
                      }}
                    />
                    {entryCustomerMatches.length > 0 && (
                      <ul className="lst-suggest" role="listbox" aria-label="Saved customers">
                        {entryCustomerMatches.map((customer) => (
                          <li key={customer.id} role="option" aria-selected={false}>
                            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pickEntryCustomer(customer)}>
                              <strong>{customer.name}</strong>
                              <small>{[customer.phone, customer.email, customer.cars[0] ? lotCustomerCarLabel(customer.cars[0]) : ""].filter(Boolean).join(" · ")}{customer.cars.length > 1 ? ` · +${customer.cars.length - 1}` : ""}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {entryCustomerPick && entryCustomerPick.cars.length > 1 && (
                      <div className="lst-chiprow">
                        <small className="lst-hint">Their cars:</small>
                        {entryCustomerPick.cars.map((car) => (
                          <button key={`${car.vin}-${car.make}-${car.model}-${car.year}`} type="button" className="status-pill compact" onClick={() => applyEntryCustomerCar(car)}>{lotCustomerCarLabel(car)}</button>
                        ))}
                      </div>
                    )}
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
                  <label className="lst-field"><span>End date (optional)</span>
                    <input type="date" value={entryDraft.endDate} onChange={(event) => setEntryDraft((value) => ({...value, endDate: event.target.value}))} />
                    <small className="lst-hint">Leave blank for an open-ended stay — bill it through today whenever you like.</small>
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
  // A viewing request nobody has answered is the same kind of "somebody is
  // waiting on us" as a hold review, and it expires if it is left alone, so it
  // carries the same alert border and the same Needs action filter.
  return Boolean(row.holdReviewRequiredAt) ||
    row.extensionRequestStatus === "pending" ||
    viewingAwaitingParty(text(row.purchaseStatus, "")) === "business";
}
function purchaseTone(status: string) {
  switch (status) {
    case "completed": return "ok";
    case "reserved": case "hold_review_required": case "viewing_requested": return "warn";
    case "viewing_scheduled": return "ok";
    case "cancelled": case "refunded": case "no_show": case "forfeited":
    case "viewing_declined": case "viewing_expired": return "muted";
    default: return "navy";
  }
}

/**
 * The negotiation half of a viewing card.
 *
 * A viewing is an appointment two people have to agree on, so the card has to
 * show what is on the table, who owes the reply and by when — none of which a
 * hold or a purchase has. It sits inline rather than behind a modal because a
 * business working through ten of these should not have to open ten dialogs.
 *
 * Which buttons exist comes from `viewingActionAvailability`, the console's
 * copy of the server's own rules, so the panel never offers an action
 * `actOnCarViewing` would refuse.
 */
function ViewingNegotiation({
  row,
  carStatus,
  nowMs,
  busy,
  onAct,
  onComplete,
}: {
  row: FirestoreRow;
  carStatus: string;
  nowMs: number;
  busy: boolean;
  onAct: (
    action: ViewingAction,
    slots: ViewingSlot[],
    label: string,
    confirm: string,
    confirmFr: string,
  ) => void;
  onComplete: () => void;
}) {
  const record = viewingRecordFrom(row);
  const available = viewingActionAvailability({ record, actor: "business", nowMs, carStatus });
  const history = viewingHistoryFrom(row);
  const [chosenSlotMs, setChosenSlotMs] = useState(0);
  const [countering, setCountering] = useState(false);
  const [counterSlots, setCounterSlots] = useState<string[]>([""]);
  const [slotError, setSlotError] = useState("");

  const waiting = viewingWaitingLabel(record.purchaseStatus, "business");
  const selected =
    available.acceptableSlots.find((slot) => slot.startAtMs === chosenSlotMs) ??
    available.acceptableSlots[0];

  function sendCounter() {
    const slots = counterSlots
      .map(viewingSlotFromInput)
      .filter((slot): slot is ViewingSlot => slot !== null);
    const error = validateViewingSlots(slots, nowMs, available.maxSlots);
    if (error) {
      setSlotError(VIEWING_SLOT_ERROR_MESSAGES[error]);
      return;
    }
    setSlotError("");
    setCountering(false);
    setCounterSlots([""]);
    onAct(
      "propose",
      slots,
      "Times sent to the buyer.",
      "Offer these times to the buyer?",
      "Proposer ces horaires à l’acheteur ?",
    );
  }

  return (
    <>
      {(waiting || record.respondByAtMs != null) && (
        <div className="pur-info">
          {waiting && <div><span>Waiting on</span><b>{waiting}</b></div>}
          {record.respondByAtMs != null && (
            <div><span>Reply by</span><b>{formatViewingSlot(record.respondByAtMs)}</b></div>
          )}
        </div>
      )}

      {available.blockedReason !== "" && available.blockedReason !== "closed" && (
        <div className="pur-notice warn">
          <AlertTriangle size={15} /> {VIEWING_BLOCK_MESSAGES[available.blockedReason]}
        </div>
      )}
      {available.open && available.proposalsLeft === 0 && (
        <div className="pur-notice">
          <Clock3 size={15} /> This has gone back and forth enough - accept a time, decline, or cancel
        </div>
      )}

      {record.proposedSlots.length > 0 && available.blockedReason !== "closed" && (
        <div className="viewing-slots">
          <span className="pur-kind">{available.canAccept ? "Pick a time to accept" : "Times on the table"}</span>
          {record.proposedSlots.map((slot) => {
            const acceptable = available.acceptableSlots.some(
              (item) => item.startAtMs === slot.startAtMs,
            );
            return (
              <label className="viewing-slot" key={slot.startAtMs}>
                {available.canAccept ? (
                  <input
                    checked={selected?.startAtMs === slot.startAtMs}
                    disabled={busy || !acceptable}
                    name={`viewing-slot-${row.id}`}
                    onChange={() => setChosenSlotMs(slot.startAtMs)}
                    type="radio"
                  />
                ) : (
                  <Clock3 size={14} />
                )}
                <span>{formatViewingSlot(slot.startAtMs)}</span>
                {/* A slot inside the edit floor stays visible but cannot be
                    agreed — hiding it would make the buyer's offer look
                    smaller than it was. */}
                {!acceptable && <span className="lst-badge muted">Too soon</span>}
              </label>
            );
          })}
        </div>
      )}

      {countering && (
        <div className="viewing-counter-fields">
          {counterSlots.map((value, index) => (
            <input
              aria-label="Time to offer"
              key={index}
              min={viewingSlotInputMin(nowMs)}
              onChange={(event) =>
                setCounterSlots((values) =>
                  values.map((item, position) => (position === index ? event.target.value : item)),
                )
              }
              type="datetime-local"
              value={value}
            />
          ))}
          {counterSlots.length < available.maxSlots && (
            <button className="lst-btn ghost" type="button" onClick={() => setCounterSlots((values) => [...values, ""])}>
              <Plus size={14} /> Add another time
            </button>
          )}
          {slotError && <div className="lst-form-error" role="alert">{slotError}</div>}
        </div>
      )}

      {history.length > 0 && (
        <details className="viewing-history">
          <summary>Negotiation history</summary>
          <ol>
            {history.map((entry) => (
              <li key={`${entry.atMs}-${entry.actor}-${entry.action}`}>
                <b>{viewingHistoryLabel(entry)}</b>
                {entry.slots.length > 0 && (
                  <span>{entry.slots.map((slot) => formatViewingSlot(slot.startAtMs)).join(" · ")}</span>
                )}
                <small>{formatViewingSlot(entry.atMs)}</small>
              </li>
            ))}
          </ol>
        </details>
      )}

      {available.open && (
        <div className="pur-actions">
          {countering ? (
            <>
              <button className="lst-btn" type="button" disabled={busy} onClick={sendCounter}>
                <Send size={15} /> Send these times
              </button>
              <button
                className="lst-btn ghost"
                type="button"
                disabled={busy}
                onClick={() => {
                  setCountering(false);
                  setCounterSlots([""]);
                  setSlotError("");
                }}
              >
                Discard these times
              </button>
            </>
          ) : (
            <>
              {available.canAccept && (
                <button
                  className="lst-btn"
                  type="button"
                  disabled={busy || !selected}
                  onClick={() => selected && onAct(
                    "accept",
                    [selected],
                    "Viewing confirmed.",
                    "Confirm this viewing time?",
                    "Confirmer cet horaire de visite ?",
                  )}
                >
                  <CheckCircle2 size={15} /> Accept this time
                </button>
              )}
              {available.canPropose && (
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => setCountering(true)}>
                  <Clock3 size={14} />
                  {record.purchaseStatus === "viewing_scheduled" ? "Propose a new time" : "Offer other times"}
                </button>
              )}
              {available.canDecline && (
                <button
                  className="lst-btn ghost danger"
                  type="button"
                  disabled={busy}
                  onClick={() => onAct(
                    "decline",
                    [],
                    "Viewing declined.",
                    "Decline this viewing request?",
                    "Refuser cette demande de visite ?",
                  )}
                >
                  <XCircle size={15} /> Decline
                </button>
              )}
              {record.purchaseStatus === "viewing_scheduled" && (
                <button className="lst-btn" type="button" disabled={busy} onClick={onComplete}>
                  <CheckCircle2 size={15} /> Viewing done
                </button>
              )}
              {/* Last, and always present while the viewing is open — the one
                  action neither an inactive listing nor a used-up round cap
                  takes away. */}
              {available.canCancel && (
                <button
                  className="lst-btn ghost danger"
                  type="button"
                  disabled={busy}
                  onClick={() => onAct(
                    "cancel",
                    [],
                    "Viewing cancelled.",
                    "Cancel this viewing?",
                    "Annuler cette visite ?",
                  )}
                >
                  <RotateCcw size={14} /> Cancel viewing
                </button>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}

export function PurchasesPanel({
  businessId,
  previewMode = false,
  scope = "purchases",
  focusRecordId = "",
}: PanelProps & {scope?: "purchases" | "viewings"}) {
  const enabled = Boolean(businessId && !previewMode);
  const purchases = useBusinessRows("carPurchases", businessId, enabled, 250);
  // Read for one field: a viewing on a listing that is no longer active can
  // only be cancelled, and the purchase record does not carry the listing's
  // status. Knowing it here is what lets the panel say so instead of letting
  // the callable's refusal be how an operator finds out.
  const cars = useBusinessRows("cars", businessId, enabled, 250);
  const [noteById, setNoteById] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const focusedCardRef = useRef<HTMLElement | null>(null);
  // A filter picked on one queue must not survive into the other, where it
  // would match nothing and read as an empty queue rather than a stale filter.
  useEffect(() => {
    setFilter("all");
  }, [scope]);
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  // One clock for the whole panel. Every viewing window is measured against
  // the hour before an appointment, so a card left open has to stop offering
  // an action when that hour arrives rather than waiting for a refresh.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const carStatusById = useMemo(
    () => new Map(cars.rows.map((car) => [car.id, text(car.status, "")])),
    [cars.rows],
  );

  // A viewing is an appointment, not a sale. Splitting here rather than at
  // render keeps search, the filters and the needs-action count talking about
  // the queue in front of the operator instead of the whole collection.
  const scopedRows = useMemo(
    () => purchases.rows.filter((row) =>
      scope === "viewings" ?
        purchaseKind(row) === "viewing" :
        purchaseKind(row) !== "viewing",
    ),
    [purchases.rows, scope],
  );

  const searched = useMemo(
    () => filterRows(scopedRows, search, ["carTitle", "buyerName", "buyerEmail", "buyerPhone", "customerName", "purchaseStatus", "paymentStatus", "destinationCountryName"]),
    [scopedRows, search],
  );
  const filteredRows = useMemo(() => {
    if (filter === "all") return searched;
    if (filter === "needs_action") return searched.filter(purchaseNeedsAction);
    if (filter === "holds") return searched.filter((row) => purchaseKind(row) === "hold");
    if (filter === "viewings") return searched.filter((row) => purchaseKind(row) === "viewing");
    return searched.filter((row) => text(row.purchaseStatus, "") === filter);
  }, [searched, filter]);

  useEffect(() => {
    if (!focusRecordId) return;
    setSearch("");
    setFilter("all");
  }, [focusRecordId]);
  useEffect(() => {
    if (!focusRecordId || !focusedCardRef.current) return;
    focusedCardRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusRecordId, filteredRows]);

  const actionCount = useMemo(() => scopedRows.filter(purchaseNeedsAction).length, [scopedRows]);

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

  // Every viewing transition — accept, counter, decline, cancel — goes through
  // the one callable, which re-decides the move inside its own transaction. A
  // refusal from it is already a sentence for the operator, so it is shown as
  // it arrives rather than replaced with a generic failure line.
  function runViewing(
    purchaseId: string,
    action: ViewingAction,
    slots: ViewingSlot[],
    label: string,
    confirm: string,
    confirmFr: string,
  ) {
    void runHold(
      purchaseId,
      label,
      () => httpsCallable(functions, "actOnCarViewing")(
        viewingActionPayload({ purchaseId, action, slots }),
      ),
      confirm,
      confirmFr,
    );
  }

  // Each queue offers only filters that can actually match it. Leaving the
  // viewing statuses on the purchases tab - or the hold ones on viewings -
  // gives an operator options that silently return nothing.
  const statusFilters = scope === "viewings" ?
    ["all", "needs_action", "viewing_requested", "viewing_countered", "viewing_scheduled", "viewing_declined", "viewing_expired", "completed", "cancelled", "no_show"] :
    ["all", "needs_action", "holds", "reserved", "hold_review_required", "completed", "cancelled", "refunded", "no_show", "forfeited"];

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
          const holdActive = carPurchaseCanMarkSold(row);
          const canCompletePurchase = carPurchaseCanMarkCompleted(row);
          const reliability = (row.buyerReliabilitySnapshot && typeof row.buyerReliabilitySnapshot === "object")
            ? row.buyerReliabilitySnapshot as Record<string, unknown>
            : null;
          const note = noteById[row.id] ?? "";
          return (
            <article
              className={`pur-card${purchaseNeedsAction(row) ? " alert" : ""}${
                focusRecordId === row.id ? " focused" : ""
              }`}
              key={row.id}
              ref={focusRecordId === row.id ? focusedCardRef : undefined}
            >
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

              {/* A viewing is negotiated, not finalized: it brings its own
                  actions, so the completed / cancel-and-refund pair below —
                  which is about money that a viewing never took — stays out
                  of its way. */}
              {kind === "viewing" && (
                <ViewingNegotiation
                  busy={busy}
                  carStatus={carStatusById.get(text(row.carId, "")) ?? ""}
                  nowMs={nowMs}
                  onAct={(action, slots, label, confirm, confirmFr) =>
                    runViewing(row.id, action, slots, label, confirm, confirmFr)
                  }
                  onComplete={() => runHold(
                    row.id,
                    "Viewing marked completed.",
                    () => finalize(row.id, "completed", note),
                    "Mark this viewing as completed?",
                    "Marquer cette visite comme terminée ?",
                  )}
                  row={row}
                />
              )}

              {kind !== "viewing" && (
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
                    {canCompletePurchase && (
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
                    )}
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
              )}
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

/**
 * The price requests this business was asked to answer.
 *
 * Only the fan-out field is queried; whether a request is still taking prices
 * is decided in the panel. Pairing the two in one query would demand a
 * composite index for a list this small, and an index a deploy forgot is an
 * empty feed nobody can explain.
 */
/**
 * This business's own price list and routes, for reading a request through
 * its lens. The request stores facts; the card multiplies THEIR numbers.
 */
function useBusinessQuoteLens(businessId: string, enabled: boolean) {
  const [table, setTable] = useState<PaybackTable | undefined>(undefined);
  const [categories, setCategories] = useState<unknown>(null);
  const [routes, setRoutes] = useState<Map<string, FirestoreRow>>(new Map());
  useEffect(() => {
    if (!enabled || !businessId) return;
    return onSnapshot(doc(db, "businesses", businessId), (snap) => {
      const data = snap.data() || {};
      setTable(
        (data.freightPaybackTable as PaybackTable | undefined) ?? undefined,
      );
      setCategories(data.freightCategories ?? data.freightCategoryRates ?? null);
    });
  }, [businessId, enabled]);
  useEffect(() => {
    if (!enabled || !businessId) return;
    return onSnapshot(
      collection(db, "businesses", businessId, "destinationCountries"),
      (snap) => {
        const next = new Map<string, FirestoreRow>();
        snap.docs.forEach((row) =>
          next.set(row.id, {id: row.id, ...row.data()}),
        );
        setRoutes(next);
      },
    );
  }, [businessId, enabled]);
  // Multipliers are effectively retired - v2 bookings store 1 and the
  // priced-item model replaced factor pricing - so the lens does not
  // resurrect them. The suggestion is editable either way.
  const multiplierFor = useMemo(() => () => 1, []);
  void categories;
  return {table, routes, multiplierFor};
}

function useFreightQuoteRequests(businessId: string, enabled: boolean) {
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
      query(
        collection(db, "freightQuoteRequests"),
        where("eligibleBusinessIds", "array-contains", scopedBusinessId),
        limit(200),
      ),
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
  }, [businessId, enabled]);

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

function StatusText({
  busy,
  message,
  tone = "ok",
}: {
  busy: boolean;
  message: string;
  tone?: "ok" | "error";
}) {
  if (busy) {
    return (
      <span className="status-pill compact warning">
        <RefreshCw className="spin" size={14} /> Enregistrement
      </span>
    );
  }
  if (!message) return null;
  return (
    <span
      className={`status-pill compact${tone === "error" ? " danger" : ""}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {message}
    </span>
  );
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
      card_saved: "Card saved",
      closed: "Closed",
      due_on_arrival: "Due on arrival",
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
      viewing_countered: "Other times offered",
      viewing_declined: "Viewing declined",
      viewing_expired: "Viewing request expired",
      viewing_requested: "Viewing requested",
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
      card_saved: "Carte enregistrée",
      closed: "Fermé",
      due_on_arrival: "Dû à l’arrivée",
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
      viewing_countered: "Autres horaires proposés",
      viewing_declined: "Visite refusée",
      viewing_expired: "Demande de visite expirée",
      viewing_requested: "Visite demandée",
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

// ===========================================================================
// Lot ledger — activity log, expense ledger, and reports (design handoff).
//
// Read views derive from the business's own live collections
// (lotActivityTypes, lotActivities, lotExpenseLines, lotExpenseEntries): the
// metric cards, the type filter, the reports rows all read one source, never
// a hand-maintained parallel list (UI-CONVENTIONS §3). The write flows —
// record activity, activities & rates, chase payment, expense line, purchase
// log — call the server callables that are the authority.
// ===========================================================================

type LotSegment = "activity" | "expenses" | "reports";
type LotReportView = "month" | "year";
type LotModal =
  | ""
  | "activity"
  | "types"
  | "chase"
  | "expense-line"
  | "purchases"
  | "void"
  | "history";

function lotMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function lotRowMonth(row: Record<string, unknown>, field: string): string {
  const explicit = text((row as Record<string, unknown>)[`${field}Month`], "");
  if (explicit) return explicit;
  const date = asDate((row as Record<string, unknown>)[field]);
  return date ? lotMonthKey(date) : "";
}

function lotMonthOptions(year: number): { value: string; label: string }[] {
  const names = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return names.map((label, i) => ({
    value: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: `${label} ${year}`,
  }));
}

function lotMonthLabel(month: string): string {
  const [y] = month.split("-");
  return lotMonthOptions(Number(y)).find((o) => o.value === month)?.label ?? month;
}

const LOT_TAG_TINTS = ["#0d9488", "#f59e0b", "#6366f1", "#db2777", "#0891b2"];

export function LotLedgerPanel({ businessId, business, previewMode = false }: PanelProps) {
  const enabled = Boolean(businessId && !previewMode);
  const activityTypes = useBusinessRows("lotActivityTypes", businessId, enabled, 200);
  const activities = useBusinessRows("lotActivities", businessId, enabled, 1000);
  const expenseLines = useBusinessRows("lotExpenseLines", businessId, enabled, 200);
  const expenseEntries = useBusinessRows("lotExpenseEntries", businessId, enabled, 2000);
  const staff = useBusinessStaff(businessId, enabled, 200);
  // Parked cars are read so a VIN typed into the activity form can pull the
  // car and customer it already belongs to (reusing existing records rather
  // than re-typing) — the same reuse the handoff called for.
  const parkedCars = useBusinessRows("parkedCars", businessId, enabled, 500);
  // The lot's customer memory: everyone recorded on an activity or a walk-up,
  // with the cars seen against them, offered back as staff type.
  const lotCustomers = useBusinessRows("lotCustomers", businessId, enabled, 500);

  const [segment, setSegment] = useState<LotSegment>("activity");
  const [reportView, setReportView] = useState<LotReportView>("month");
  const [month, setMonth] = useState<string>(() => lotMonthKey(new Date()));
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [modal, setModal] = useState<LotModal>("");
  const [editId, setEditId] = useState("");
  const [chaseId, setChaseId] = useState("");
  const [purchaseLineId, setPurchaseLineId] = useState("");
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [draftError, setDraftError] = useState("");

  const [activityDraft, setActivityDraft] = useState<LotActivityDraft>(emptyLotActivityDraft);
  const [vinHint, setVinHint] = useState("");
  const [customerPick, setCustomerPick] = useState<LotCustomer | null>(null);
  const [customerMenuOpen, setCustomerMenuOpen] = useState(false);
  const [newType, setNewType] = useState<LotActivityTypeDraft>(emptyLotActivityTypeDraft);
  const [lineDraft, setLineDraft] = useState({ label: "", detail: "", kind: "metered", recurring: "" });
  const [purchase, setPurchase] = useState<LotExpenseEntryDraft>(emptyLotExpenseEntryDraft);
  const [purchaseFile, setPurchaseFile] = useState<File | null>(null);
  const [chaseVia, setChaseVia] = useState("cash");
  const [chaseStaff, setChaseStaff] = useState("");
  const [directStaff, setDirectStaff] = useState("");
  const [editingThreshold, setEditingThreshold] = useState(false);
  const [thresholdInput, setThresholdInput] = useState("");
  const [voidTarget, setVoidTarget] = useState<{ type: "activity" | "expense"; id: string; label: string } | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [historyRows, setHistoryRows] = useState<FirestoreRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const year = Number(month.split("-")[0]) || new Date().getUTCFullYear();
  const searching = search.trim().length > 0;
  const thresholdCents = Number(business?.expenseProofThresholdCents);
  const proofThreshold = Number.isFinite(thresholdCents) && thresholdCents >= 0
    ? thresholdCents
    : DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS;

  const staffName = (id: string) => {
    if (!id) return "";
    const row = staff.rows.find((s) => String((s as Record<string, unknown>).id) === id);
    return row
      ? text((row as Record<string, unknown>).fullName, "") ||
        text((row as Record<string, unknown>).name, "") ||
        text((row as Record<string, unknown>).email, id)
      : id;
  };


  const orderedTypes = useMemo(
    () =>
      [...activityTypes.rows]
        .filter((t) => (t as Record<string, unknown>).active !== false)
        .sort(
          (a, b) =>
            (Number((a as Record<string, unknown>).sortOrder) || 0) -
            (Number((b as Record<string, unknown>).sortOrder) || 0),
        ),
    [activityTypes.rows],
  );

  const typeById = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    for (const t of activityTypes.rows) {
      map.set(String((t as Record<string, unknown>).id ?? ""), t as Record<string, unknown>);
    }
    return map;
  }, [activityTypes.rows]);

  const tintForType = (typeId: string) => {
    if (typeId === LOT_CUSTOM_ACTIVITY_ID) return "#64748b";
    const i = orderedTypes.findIndex(
      (t) => String((t as Record<string, unknown>).id) === typeId,
    );
    return LOT_TAG_TINTS[i >= 0 ? i % LOT_TAG_TINTS.length : 0];
  };

  const knownTypeIds = orderedTypes.map((t) => String((t as Record<string, unknown>).id));

  const scopedActivities = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activities.rows.filter((row) => {
      const r = row as Record<string, unknown>;
      if (!searching && lotRowMonth(row, "activityDate") !== month) return false;
      if (typeFilter === "custom" && String(r.activityTypeId) !== LOT_CUSTOM_ACTIVITY_ID) return false;
      if (typeFilter !== "all" && typeFilter !== "custom" && String(r.activityTypeId) !== typeFilter) return false;
      if (q) {
        const hay = `${text(r.vinNumber, "")} ${text(r.customerName, "")} ${text(r.customerPhone, "")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [activities.rows, month, searching, search, typeFilter]);

  const monthActivities = useMemo(
    () => activities.rows.filter((row) => lotRowMonth(row, "activityDate") === month),
    [activities.rows, month],
  );

  const revenueByType = useMemo(() => {
    const totals = new Map<string, { cents: number; count: number }>();
    for (const row of monthActivities) {
      const r = row as Record<string, unknown>;
      if (String(r.paymentStatus) === "cancelled" || r.voided === true) continue;
      const key = String(r.activityTypeId) === LOT_CUSTOM_ACTIVITY_ID ? "custom" : String(r.activityTypeId);
      const prev = totals.get(key) ?? { cents: 0, count: 0 };
      totals.set(key, { cents: prev.cents + (Number(r.feeCents) || 0), count: prev.count + 1 });
    }
    return totals;
  }, [monthActivities]);

  const monthRevenueCents = useMemo(() => {
    let s = 0;
    for (const v of revenueByType.values()) s += v.cents;
    return s;
  }, [revenueByType]);

  const awaitingCents = useMemo(() => {
    let s = 0;
    for (const row of monthActivities) {
      const r = row as Record<string, unknown>;
      if (r.voided === true) continue;
      if (String(r.paymentStatus) === "awaiting_payment_link") {
        s += Number(r.feeCents) || 0;
      }
    }
    return s;
  }, [monthActivities]);

  // Every purchase counts in exactly one month (lotExpenseEntryMonth); a fixed
  // line's standing amount is replaced - not added to - when a live purchase
  // was logged against it that month, and is only owed for the months the line
  // has actually existed for. The rules live in lot-ledger.ts, tested there.
  const nowMonth = lotMonthKey(new Date());
  const monthExpenseFor = (m: string) =>
    lotMonthExpenseCents(expenseLines.rows, expenseEntries.rows, m, nowMonth);

  const monthExpenseCents = useMemo(() => monthExpenseFor(month), [expenseEntries.rows, expenseLines.rows, month]);
  const netCents = monthRevenueCents - monthExpenseCents;

  const topCards = useMemo(
    () =>
      [...revenueByType.entries()]
        .filter(([k]) => k !== "custom")
        .sort((a, b) => b[1].cents - a[1].cents)
        .slice(0, 3)
        .map(([k, v]) => ({
          label: text(typeById.get(k)?.label, "Activity"),
          cents: v.cents,
          note: `${v.count} ${v.count === 1 ? "job" : "jobs"}`,
        })),
    [revenueByType, typeById],
  );

  // Year series for the reports charts.
  const yearMonths = lotMonthOptions(year).map((o) => o.value);
  const yearRevenueByMonth = yearMonths.map((m) => {
    let s = 0;
    for (const row of activities.rows) {
      const r = row as Record<string, unknown>;
      if (String(r.paymentStatus) === "cancelled" || r.voided === true) continue;
      if (lotRowMonth(row, "activityDate") === m) s += Number(r.feeCents) || 0;
    }
    return s;
  });
  const yearExpenseByMonth = yearMonths.map((m) => monthExpenseFor(m));
  const yearRevenue = yearRevenueByMonth.reduce((a, b) => a + b, 0);
  const yearExpense = yearExpenseByMonth.reduce((a, b) => a + b, 0);
  const yearNet = yearRevenue - yearExpense;

  function closeModal() {
    if (busy) return;
    setModal("");
    setEditId("");
    setChaseId("");
    setPurchaseLineId("");
    setDraftError("");
    setPurchaseFile(null);
    setVinHint("");
    setVoidTarget(null);
    setVoidReason("");
  }

  function openRecord() {
    setCustomerPick(null);
    setCustomerMenuOpen(false);
    setActivityDraft({ ...emptyLotActivityDraft, activityDate: `${month}-01` });
    setEditId("");
    setDraftError("");
    setVinHint("");
    setModal("activity");
  }

  function openEdit(row: Record<string, unknown>) {
    setActivityDraft({
      activityTypeId: String(row.activityTypeId ?? ""),
      customLabel: text(row.customLabel, ""),
      fee: String((Number(row.feeCents) || 0) / 100),
      activityDate: lotDateInputValue(row.activityDate) || `${month}-01`,
      customerName: text(row.customerName, ""),
      customerPhone: text(row.customerPhone, ""),
      customerEmail: text(row.customerEmail, ""),
      carMake: text(row.carMake, ""),
      carModel: text(row.carModel, ""),
      carYear: text(row.carYear, ""),
      vinNumber: text(row.vinNumber, ""),
      auctionHouse: text(row.auctionHouse, ""),
      paymentMethod: String(row.paymentMethod) === "direct" ? "direct" : "payment_link",
      receivedVia: text(row.receivedVia, "cash") || "cash",
      receivedByStaffId: text(row.receivedByStaffId, ""),
    });
    setEditId(String(row.id));
    setDraftError("");
    setModal("activity");
  }

  const selectedType = typeById.get(activityDraft.activityTypeId);
  const editRow = editId ? (activities.rows.find((r) => String(r.id) === editId) as Record<string, unknown> | undefined) : undefined;
  const editingPaid = Boolean(editRow && lotActivityPaid(editRow));

  // Typing a VIN pulls the car and customer from an existing record for this
  // business (a parked car or a past activity), so staff don't re-key what the
  // lot already knows. Everything prefilled stays editable.
  const knownCustomers = useMemo(
    () => lotCustomers.rows.map((r) => lotCustomerFromRow(r as Record<string, unknown>)),
    [lotCustomers.rows],
  );
  const customerMatches = useMemo(
    () => (customerMenuOpen && !customerPick ? matchLotCustomers(knownCustomers, activityDraft.customerName) : []),
    [knownCustomers, activityDraft.customerName, customerMenuOpen, customerPick],
  );

  function applyCustomerCar(car: LotCustomerCar) {
    setActivityDraft((d) => ({
      ...d,
      vinNumber: car.vin || d.vinNumber,
      carMake: car.make || d.carMake,
      carModel: car.model || d.carModel,
      carYear: car.year || d.carYear,
    }));
    setVinHint("");
  }

  // Picking a saved customer fills their contact details; their car is filled
  // too when they only have one, otherwise the cars are offered as chips.
  function pickCustomer(c: LotCustomer) {
    setCustomerPick(c);
    setCustomerMenuOpen(false);
    setActivityDraft((d) => ({
      ...d,
      customerName: c.name || d.customerName,
      customerPhone: c.phone || d.customerPhone,
      customerEmail: c.email || d.customerEmail,
    }));
    if (c.cars.length === 1) applyCustomerCar(c.cars[0]);
  }

  async function openLotDocument(row: Record<string, unknown>) {
    await runPanelAction(setBusy, setFlash, "", async () => {
      const response = await httpsCallable(functions, "getLotActivityDocumentUrl")({ activityId: String(row.id) });
      const data = (response.data ?? {}) as { documentType?: string; url?: string };
      const url = text(data.url, "");
      if (!url) throw new Error("The document is not ready yet. Try again in a moment.");
      // Awaited call, so this open is outside the click gesture; a blocker can
      // refuse it. Leave the link on screen rather than a button that did nothing.
      const opened = window.open(url, "_blank", "noopener");
      if (!opened) setFlash(`Open it here: ${url}`);
    });
  }

  function applyVin(rawVin: string) {
    const clean = rawVin.toUpperCase().slice(0, 17);
    setActivityDraft((d) => ({ ...d, vinNumber: clean }));
    if (clean.length < 6) {
      setVinHint("");
      return;
    }
    const match = [...parkedCars.rows, ...activities.rows].find(
      (row) =>
        String((row as Record<string, unknown>).vinNumber || "")
          .toUpperCase() === clean,
    ) as Record<string, unknown> | undefined;
    if (!match) {
      setVinHint("");
      return;
    }
    setActivityDraft((d) => ({
      ...d,
      carMake: text(match.carMake, d.carMake),
      carModel: text(match.carModel, d.carModel),
      carYear: text(match.carYear, d.carYear),
      customerName: d.customerName || text(match.customerName ?? match.ownerName, ""),
      customerPhone: d.customerPhone || text(match.customerPhone, ""),
      customerEmail: d.customerEmail || text(match.customerEmail, ""),
    }));
    const car = [text(match.carYear, ""), text(match.carMake, ""), text(match.carModel, "")]
      .filter(Boolean)
      .join(" ");
    const who = text(match.customerName ?? match.ownerName, "");
    setVinHint(
      `Filled from an existing record${car ? `: ${car}` : ""}` +
        `${who ? ` for ${who}` : ""}. You can change anything below.`,
    );
  }

  async function saveActivity() {
    const errors = validateLotActivityDraft(activityDraft, [...knownTypeIds]);
    if (errors.length) {
      setDraftError(lotActivityMessage(errors));
      return;
    }
    const payload = lotActivityPayload(activityDraft, businessId);
    await runPanelAction(setBusy, setFlash, editId ? "Activity updated." : "Activity recorded.", async () => {
      if (editId) {
        await httpsCallable(functions, "updateLotActivity")({ activityId: editId, changes: payload });
      } else {
        await httpsCallable(functions, "createLotActivity")(payload);
      }
      setMonth(payload.activityDate.slice(0, 7) || month);
      closeModal();
    });
  }

  async function saveType(draft: LotActivityTypeDraft, typeId?: string) {
    const errors = validateLotActivityTypeDraft(draft);
    if (errors.length) {
      setDraftError(errors.map((c) => (c === "activity_type_label_required" ? "Name the activity." : "Give it a fee. Use 0 if you price it job by job.")).join(" "));
      return;
    }
    await runPanelAction(setBusy, setFlash, "Saved.", async () => {
      await httpsCallable(functions, "upsertLotActivityType")({
        businessId,
        ...lotActivityTypePayload(draft, { typeId }),
      });
      if (!typeId) setNewType(emptyLotActivityTypeDraft);
    });
  }

  async function removeType(typeId: string) {
    await runPanelAction(setBusy, setFlash, "Removed.", async () => {
      await httpsCallable(functions, "deleteLotActivityType")({ businessId, typeId });
    });
  }

  async function chaseResend(activityId: string) {
    await runPanelAction(setBusy, setFlash, "Link re-sent.", async () => {
      await httpsCallable(functions, "resendLotActivityLink")({ activityId });
      closeModal();
    });
  }

  async function chaseRecordDirect(activityId: string) {
    if (!chaseStaff) {
      setDraftError("Say which staff member took the payment.");
      return;
    }
    await runPanelAction(setBusy, setFlash, "Recorded as paid.", async () => {
      await httpsCallable(functions, "recordLotActivityDirectPayment")({
        activityId,
        receivedByStaffId: chaseStaff,
        receivedVia: chaseVia,
      });
      closeModal();
    });
  }

  async function saveThreshold() {
    const dollars = Number(thresholdInput.trim().replace(/[$,\s]/g, ""));
    if (!Number.isFinite(dollars) || dollars < 0) {
      setFlash("Enter an amount ($0 means never require a receipt).");
      return;
    }
    await runPanelAction(setBusy, setFlash, "Receipt threshold saved.", async () => {
      await httpsCallable(functions, "setExpenseProofThreshold")({
        businessId,
        thresholdCents: Math.round(dollars * 100),
      });
      setEditingThreshold(false);
    });
  }

  async function confirmVoid() {
    if (!voidTarget) return;
    const fn = voidTarget.type === "activity"
      ? "voidLotActivity" : "voidLotExpenseEntry";
    const payload = voidTarget.type === "activity"
      ? { activityId: voidTarget.id, reason: voidReason.trim() }
      : { entryId: voidTarget.id, reason: voidReason.trim() };
    await runPanelAction(setBusy, setFlash, "Voided.", async () => {
      await httpsCallable(functions, fn)(payload);
      closeModal();
    });
  }

  async function openHistory(entityId: string) {
    setHistoryRows([]);
    setHistoryLoading(true);
    setModal("history");
    try {
      // Filter by businessId too: the security rule authorizes by business,
      // and Firestore rejects a query it can't prove stays inside that scope.
      const snap = await getDocs(query(
        collection(db, "lotLedgerAudit"),
        where("businessId", "==", businessId),
        where("entityId", "==", entityId),
        orderBy("at", "desc"),
        limit(50),
      ));
      setHistoryRows(snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreRow)));
    } catch {
      setHistoryRows([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  async function addExpenseLine() {
    if (!lineDraft.label.trim()) {
      setDraftError("Name the expense line.");
      return;
    }
    await runPanelAction(setBusy, setFlash, "Expense line added.", async () => {
      await httpsCallable(functions, "upsertLotExpenseLine")({
        businessId,
        label: lineDraft.label,
        detail: lineDraft.detail,
        kind: lineDraft.kind,
        recurringCents: lineDraft.kind === "fixed" ? Math.round((Number(lineDraft.recurring) || 0) * 100) : 0,
      });
      setLineDraft({ label: "", detail: "", kind: "metered", recurring: "" });
      closeModal();
    });
  }

  async function addPurchase() {
    const errors = validateLotExpenseEntryDraft(
      { ...purchase, hasProof: Boolean(purchaseFile) },
      proofThreshold,
    );
    if (errors.length) {
      setDraftError(
        errors
          .map((c) =>
            c === "expense_proof_required"
              ? expenseProofMessage(proofThreshold)
              : c === "expense_amount_required"
                ? "Enter what was spent."
                : c === "expense_date_required"
                  ? "Choose the date of the purchase."
                  : "Say who paid for it.",
          )
          .join(" "),
      );
      return;
    }
    await runPanelAction(setBusy, setFlash, "Purchase added.", async () => {
      let proofUrl = "";
      let proofFileName = "";
      let proofContentType = "";
      if (purchaseFile) {
        const path = `lotExpenseProofs/${businessId}/${crypto.randomUUID()}-${purchaseFile.name}`;
        const uploaded = await uploadBytes(storageRef(storage, path), purchaseFile);
        proofUrl = await getDownloadURL(uploaded.ref);
        proofFileName = purchaseFile.name;
        proofContentType = purchaseFile.type;
      }
      await httpsCallable(functions, "createLotExpenseEntry")({
        ...lotExpenseEntryPayload(purchase, { businessId, lineId: purchaseLineId, month }),
        proofUrl,
        proofFileName,
        proofContentType,
      });
      setPurchase(emptyLotExpenseEntryDraft);
      setPurchaseFile(null);
      closeModal();
    });
  }

  const staffOptions = staff.rows.map((s) => ({
    id: String((s as Record<string, unknown>).id),
    name: text((s as Record<string, unknown>).fullName, "") || text((s as Record<string, unknown>).name, "") || text((s as Record<string, unknown>).email, ""),
  }));

  const purchaseLine = expenseLines.rows.find((l) => String((l as Record<string, unknown>).id) === purchaseLineId) as Record<string, unknown> | undefined;
  const purchaseCents = Math.round((Number(purchase.amount) || 0) * 100);

  return (
    <div className="lot-ledger">
      <div className="section-intro">
        <div>
          <h2>Lot ledger</h2>
          <p>Every job the lot billed for, what it costs to run, and the month-by-month picture — in one place.</p>
        </div>
        <div className="section-stats">
          <div className="metric money"><span>{lotMonthLabel(month)} revenue</span><b>{lotFormatCents(monthRevenueCents)}</b></div>
          <div className="metric"><span>{lotMonthLabel(month)} expenses</span><b>{lotFormatCents(monthExpenseCents)}</b></div>
          <div className={`metric ${netCents < 0 ? "attention" : "good"}`}><span>Net</span><b>{lotFormatCents(netCents)}</b></div>
        </div>
      </div>

      {flash && <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>{flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button></div>}

      <div className="service-segments" role="tablist" aria-label="Lot ledger sections">
        {([["activity", "Activity"], ["expenses", "Expenses"], ["reports", "Reports"]] as [LotSegment, string][]).map(([id, label]) => (
          <span key={id} role="button" tabIndex={0} className={`segment ${segment === id ? "active" : ""}`}
            onClick={() => setSegment(id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSegment(id); } }}>
            {label}
          </span>
        ))}
      </div>

      {segment === "activity" && (
        <>
          <div className="metric-grid">
            {topCards.map((c) => (
              <div className="metric money" key={c.label}><span>{c.label}</span><b>{lotFormatCents(c.cents)}</b><small>{c.note}</small></div>
            ))}
            <div className="metric attention"><span>Awaiting payment</span><b>{lotFormatCents(awaitingCents)}</b><small>Website links sent and not settled</small></div>
          </div>

          <div className="panel">
            <div className="panel-header"><h3>Activity log</h3><span className="panel-count">{scopedActivities.length}</span></div>
            <div className="panel-tools">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter by activity">
                <option value="all">All activities</option>
                {orderedTypes.map((t) => (
                  <option key={String((t as Record<string, unknown>).id)} value={String((t as Record<string, unknown>).id)}>{text((t as Record<string, unknown>).label, "")}</option>
                ))}
                <option value="custom">One-off jobs</option>
              </select>
              <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
                {lotMonthOptions(year).map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
              <input type="search" placeholder="VIN, customer, phone" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activity" />
              <button className="secondary-button" type="button" onClick={() => { setDraftError(""); setModal("types"); }}>Activities &amp; rates</button>
              <button className="primary-button" type="button" onClick={openRecord}>Record activity</button>
            </div>
            <p className="panel-lede">{searching ? "Searching every month for this term." : `Showing ${lotMonthLabel(month)}. The figures above cover the same month.`}</p>
            {scopedActivities.length === 0 ? (
              <EmptyState text="No activity recorded for this scope yet." />
            ) : (
              <div className="mini-table">
                <div className="lot-activity-table" style={{ minWidth: 820 }}>
                  <div className="mini-table-head"><span>Vehicle</span><span>Customer</span><span>Activity</span><span>Date</span><span>Fee</span></div>
                  {scopedActivities.map((row) => {
                    const r = row as Record<string, unknown>;
                    const voided = r.voided === true;
                    const label = text(r.activityTypeLabel, "") || (String(r.activityTypeId) === LOT_CUSTOM_ACTIVITY_ID ? text(r.customLabel, "One-off") : text(typeById.get(String(r.activityTypeId))?.label, "Activity"));
                    const vehicle = [text(r.carYear, ""), text(r.carMake, ""), text(r.carModel, "")].filter(Boolean).join(" ") || "Vehicle";
                    return (
                      <div className="mini-table-row" key={String(r.id)} style={voided ? { opacity: 0.6 } : undefined}>
                        <span><strong>{voided ? <s>{vehicle}</s> : vehicle}</strong><small>{text(r.vinNumber, "")}</small>{voided && <span className="status-pill danger compact">Voided</span>}</span>
                        <span><strong>{text(r.customerName, "")}</strong><small>{text(r.customerPhone, "")}</small></span>
                        <span><strong style={{ color: tintForType(String(r.activityTypeId)) }}>{label}</strong><small>{text(r.auctionHouse, "") ? `Auction: ${text(r.auctionHouse, "")}` : r.feeOverridden ? "Priced for this job" : "Standard rate"}</small></span>
                        <span>
                          <strong>{formatDate(r.activityDate)}</strong>
                          {text(r.editedByStaffId, "") && <small>Edited</small>}
                          <span className="lot-row-actions">
                            {!voided && <button className="ghost-button" type="button" onClick={() => openEdit(r)} title="Edit"><Pencil size={14} /></button>}
                            <button className="ghost-button" type="button" onClick={() => openHistory(String(r.id))} title="Change history"><History size={14} /></button>
                            {!voided && (lotActivityPaid(r) || lotActivityAwaitingLink(r)) && <button className="ghost-button" type="button" onClick={() => openLotDocument(r)} title={lotActivityPaid(r) ? "Receipt" : "Invoice"}><FileText size={14} /></button>}
                            {!voided && <button className="ghost-button" type="button" onClick={() => { setVoidTarget({ type: "activity", id: String(r.id), label: `${vehicle} · ${lotFormatCents(Number(r.feeCents) || 0)}` }); setVoidReason(""); setDraftError(""); setModal("void"); }} title="Void"><Ban size={14} /></button>}
                          </span>
                        </span>
                        <span>
                          <strong>{voided ? <s>{lotFormatCents(Number(r.feeCents) || 0)}</s> : lotFormatCents(Number(r.feeCents) || 0)}</strong>
                          <span className={`status-pill compact ${lotActivityPaid(r) ? "good" : lotActivityAwaitingLink(r) ? "warning" : ""}`}>{lotActivityPaymentLabel(r)}</span>
                          {!voided && String(r.paymentMethod) === "direct" && staffName(text(r.receivedByStaffId, "")) && <small>by {staffName(text(r.receivedByStaffId, ""))}</small>}
                          {canChaseLotActivity(r) && (<button className="ghost-button" type="button" onClick={() => { setChaseId(String(r.id)); setChaseStaff(""); setChaseVia("cash"); setDraftError(""); setModal("chase"); }}><Send size={13} /> Chase</button>)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {segment === "expenses" && (
        <div className="panel">
          <div className="panel-header"><h3>Expenses</h3><span className="panel-count">{expenseLines.rows.length}</span></div>
          <div className="panel-tools">
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
              {lotMonthOptions(year).map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <button className="primary-button" type="button" onClick={() => { setLineDraft({ label: "", detail: "", kind: "metered", recurring: "" }); setDraftError(""); setModal("expense-line"); }}>Add expense line</button>
          </div>
          <p className="panel-lede" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {editingThreshold ? (
              <>
                <span>Require a receipt from $</span>
                <input inputMode="decimal" type="number" min="0" step="0.01" value={thresholdInput} onChange={(e) => setThresholdInput(e.target.value)} style={{ width: 90 }} placeholder="75" />
                <button className="primary-button" type="button" disabled={busy} onClick={saveThreshold}>Save</button>
                <button className="ghost-button" type="button" disabled={busy} onClick={() => setEditingThreshold(false)}>Cancel</button>
                <small className="lst-hint">$0 means a receipt is never required.</small>
              </>
            ) : (
              <>
                <span>Proof required from <strong>{lotFormatCents(proofThreshold)}</strong> and above.</span>
                <button className="ghost-button" type="button" onClick={() => { setThresholdInput(String(proofThreshold / 100)); setEditingThreshold(true); }}><Pencil size={13} /> Change</button>
                <span>A line marked same every month fills itself in; a line that changes every month starts empty.</span>
              </>
            )}
          </p>
          {expenseLines.rows.length === 0 ? (
            <EmptyState text="No expense lines yet." />
          ) : (
            <div className="mini-table">
              <div style={{ minWidth: 680 }}>
                <div className="mini-table-head"><span>Expense</span><span>Supplier / detail</span><span>How it behaves</span><span>{lotMonthLabel(month)}</span></div>
                {expenseLines.rows.map((line) => {
                  const l = line as Record<string, unknown>;
                  const metered = l.kind === "metered";
                  const monthEntries = expenseEntries.rows.filter((e) => (e as Record<string, unknown>).voided !== true && String((e as Record<string, unknown>).lineId) === String(l.id) && lotExpenseEntryMonth(e as Record<string, unknown>) === month);
                  const entriesTotal = monthEntries.reduce((s, e) => s + (Number((e as Record<string, unknown>).amountCents) || 0), 0);
                  // A fixed line shows what the month actually cost: the purchase logged against it, else its standing amount - the same number the totals use.
                  const amount = metered || monthEntries.length > 0 ? entriesTotal : Number(l.recurringCents) || 0;
                  return (
                    <div className="mini-table-row" key={String(l.id)}>
                      <span>
                        {metered ? (<button className="ghost-button" type="button" onClick={() => { setPurchaseLineId(String(l.id)); setPurchase({ ...emptyLotExpenseEntryDraft, spentAt: `${month}-01` }); setPurchaseFile(null); setDraftError(""); setModal("purchases"); }}><strong>{text(l.label, "")}</strong></button>) : (<strong>{text(l.label, "")}</strong>)}
                        <small>{metered ? (monthEntries.length > 0 ? `${monthEntries.length} purchase${monthEntries.length === 1 ? "" : "s"}` : `Waiting on ${lotMonthLabel(month)}'s bill`) : `${lotFormatCents(Number(l.recurringCents) || 0)} every month`}</small>
                      </span>
                      <span>{text(l.detail, "")}</span>
                      <span>{metered ? "Changes every month" : "Same every month"}</span>
                      <span style={metered && monthEntries.length === 0 ? { borderLeft: "3px solid var(--warning)", paddingLeft: 8 } : undefined}><strong>{lotFormatCents(amount)}</strong>{metered && (<button className="ghost-button" type="button" onClick={() => { setPurchaseLineId(String(l.id)); setPurchase({ ...emptyLotExpenseEntryDraft, spentAt: `${month}-01` }); setPurchaseFile(null); setDraftError(""); setModal("purchases"); }}><Plus size={13} /> Add purchase</button>)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {segment === "reports" && (
        <div className="panel">
          <div className="panel-header"><h3>Reports</h3></div>
          <div className="service-segments" role="tablist" aria-label="Report view" style={{ marginTop: 4 }}>
            {([["month", "Month by month"], ["year", "Year in summary"]] as [LotReportView, string][]).map(([id, label]) => (
              <span key={id} role="button" tabIndex={0} className={`segment ${reportView === id ? "active" : ""}`} onClick={() => setReportView(id)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setReportView(id); } }}>{label}</span>
            ))}
          </div>
          <div className="metric-grid">
            <div className="metric money"><span>Revenue {year}</span><b>{lotFormatCents(yearRevenue)}</b></div>
            <div className="metric"><span>Expenses {year}</span><b>{lotFormatCents(yearExpense)}</b></div>
            <div className={`metric ${yearNet < 0 ? "attention" : "good"}`}><span>Net profit</span><b>{lotFormatCents(yearNet)}</b></div>
            <div className="metric"><span>Margin</span><b>{yearRevenue > 0 ? `${Math.round((yearNet / yearRevenue) * 100)}%` : "—"}</b></div>
          </div>
          {reportView === "month" ? (
            <LotMonthlyChart revenue={yearRevenueByMonth} expenses={yearExpenseByMonth} year={year} />
          ) : (
            <LotYearSummary revenue={yearRevenue} expense={yearExpense} net={yearNet} />
          )}
          <LotExpenseBreakdown
            spend={lotExpenseByLine(expenseLines.rows, expenseEntries.rows, yearMonths, nowMonth)}
            totalCents={yearExpense}
            year={year}
          />
        </div>
      )}

      {modal === "activity" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 660 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>{editId ? "Edit this activity" : "Record activity"}</h3><p>{editId ? "Changing the fee on an unpaid link re-issues it at the new amount." : "Log a job the lot billed for."}</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>What was done</span>
                  <select value={activityDraft.activityTypeId} onChange={(e) => { const id = e.target.value; const t = typeById.get(id); setActivityDraft((d) => ({ ...d, activityTypeId: id, fee: t ? String((Number(t.defaultFeeCents) || 0) / 100) : d.fee })); }}>
                    <option value="">Choose an activity</option>
                    {orderedTypes.map((t) => (<option key={String((t as Record<string, unknown>).id)} value={String((t as Record<string, unknown>).id)}>{text((t as Record<string, unknown>).label, "")} — {lotFormatCents(Number((t as Record<string, unknown>).defaultFeeCents) || 0)}</option>))}
                    <option value={LOT_CUSTOM_ACTIVITY_ID}>Something else — one-off</option>
                  </select>
                </label>
                {activityDraft.activityTypeId === LOT_CUSTOM_ACTIVITY_ID && (
                  <label className="lst-field wide"><span>Say what was done</span><input value={activityDraft.customLabel} onChange={(e) => setActivityDraft((d) => ({ ...d, customLabel: e.target.value }))} /></label>
                )}
                <label className="lst-field"><span>Fee</span><input inputMode="decimal" value={activityDraft.fee} disabled={editingPaid} onChange={(e) => setActivityDraft((d) => ({ ...d, fee: e.target.value }))} /><small className="lst-hint">{editingPaid ? "Paid, so the amount is locked. Void this entry and record a new one if the price was wrong." : "From your activity list; edit to price this job."}</small></label>
                <label className="lst-field"><span>Date</span><input type="date" value={activityDraft.activityDate} onChange={(e) => setActivityDraft((d) => ({ ...d, activityDate: e.target.value }))} /></label>
                <label className="lst-field wide"><span>VIN</span><input value={activityDraft.vinNumber} onChange={(e) => applyVin(e.target.value)} placeholder="17 characters" />{vinHint && <small className="lst-hint" style={{ color: "var(--money)" }}>{vinHint}</small>}</label>
                <label className="lst-field" style={{ position: "relative" }}><span>Customer</span>
                  <input value={activityDraft.customerName} autoComplete="off" onFocus={() => setCustomerMenuOpen(true)} onBlur={() => window.setTimeout(() => setCustomerMenuOpen(false), 150)} onChange={(e) => { setCustomerPick(null); setCustomerMenuOpen(true); setActivityDraft((d) => ({ ...d, customerName: e.target.value })); }} />
                  {customerMatches.length > 0 && (
                    <ul className="lst-suggest" role="listbox" aria-label="Saved customers">
                      {customerMatches.map((c) => (
                        <li key={c.id} role="option" aria-selected={false}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pickCustomer(c)}><strong>{c.name}</strong><small>{[c.phone, c.email, c.cars[0] ? lotCustomerCarLabel(c.cars[0]) : ""].filter(Boolean).join(" · ")}{c.cars.length > 1 ? ` · +${c.cars.length - 1}` : ""}</small></button></li>
                      ))}
                    </ul>
                  )}
                  {customerPick && customerPick.cars.length > 1 && (
                    <div className="lst-chiprow">
                      <small className="lst-hint">Their cars:</small>
                      {customerPick.cars.map((car) => (<button key={`${car.vin}-${car.make}-${car.model}-${car.year}`} type="button" className="status-pill compact" onClick={() => applyCustomerCar(car)}>{lotCustomerCarLabel(car)}</button>))}
                    </div>
                  )}
                </label>
                <label className="lst-field"><span>Phone</span><input value={activityDraft.customerPhone} onChange={(e) => setActivityDraft((d) => ({ ...d, customerPhone: e.target.value }))} /></label>
                <label className="lst-field"><span>Car make</span>
                  <select value={canonicalMake(activityDraft.carMake) || activityDraft.carMake} onChange={(e) => setActivityDraft((d) => ({ ...d, carMake: e.target.value, carModel: "", carYear: "" }))}>
                    <option value="">Select a make</option>
                    {getMakes().map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Car model</span>
                  <select disabled={!activityDraft.carMake} value={canonicalModel(activityDraft.carMake, activityDraft.carModel) || activityDraft.carModel} onChange={(e) => setActivityDraft((d) => ({ ...d, carModel: e.target.value, carYear: "" }))}>
                    <option value="">Select a model</option>
                    {getModels(activityDraft.carMake).map((m) => (<option key={m} value={m}>{m}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Car year</span>
                  <select disabled={!activityDraft.carModel} value={activityDraft.carYear} onChange={(e) => setActivityDraft((d) => ({ ...d, carYear: e.target.value }))}>
                    <option value="">Select a year</option>
                    {getYears(activityDraft.carMake, activityDraft.carModel).map((y) => (<option key={y} value={y}>{y}</option>))}
                  </select>
                </label>
                {Boolean(selectedType?.needsAuctionHouse) && (
                  <label className="lst-field"><span>Auction house</span><select value={activityDraft.auctionHouse} onChange={(e) => setActivityDraft((d) => ({ ...d, auctionHouse: e.target.value }))}><option value="">Choose</option>{LOT_AUCTION_HOUSES.map((h) => (<option key={h} value={h}>{h}</option>))}</select></label>
                )}
              </div>
              {editRow ? (
                <fieldset className="lst-fieldset">
                  <p className="lst-hint"><span>How it gets paid</span> <strong>{lotActivityPaymentLabel(editRow)}</strong></p>
                  <p className="lst-hint">Change that from Chase payment, not here: it closes the other path so the customer can't pay twice.</p>
                </fieldset>
              ) : (
              <fieldset className="lst-fieldset">
                <label className="lst-radio"><input type="radio" name="lotpay" checked={activityDraft.paymentMethod === "payment_link"} onChange={() => setActivityDraft((d) => ({ ...d, paymentMethod: "payment_link" }))} /><span>Charge through the website — a payment link goes to the customer and the money lands in your account</span></label>
                {activityDraft.paymentMethod === "payment_link" && (
                  <label className="lst-field wide"><span>Email</span><input value={activityDraft.customerEmail} onChange={(e) => setActivityDraft((d) => ({ ...d, customerEmail: e.target.value }))} /><small className="lst-hint">The link goes by text and email. Without one of the two there is nowhere to send it.</small></label>
                )}
                <label className="lst-radio"><input type="radio" name="lotpay" checked={activityDraft.paymentMethod === "direct"} onChange={() => setActivityDraft((d) => ({ ...d, paymentMethod: "direct" }))} /><span>Paid outside the website — cash, Zelle, a check. Record who took it.</span></label>
                {activityDraft.paymentMethod === "direct" && (
                  <div className="lst-form-grid">
                    <label className="lst-field"><span>How it was paid</span><select value={activityDraft.receivedVia} onChange={(e) => setActivityDraft((d) => ({ ...d, receivedVia: e.target.value }))}>{LOT_RECEIVED_VIA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></label>
                    <label className="lst-field"><span>Received by</span><select value={activityDraft.receivedByStaffId} onChange={(e) => setActivityDraft((d) => ({ ...d, receivedByStaffId: e.target.value }))}><option value="">Choose staff</option>{staffOptions.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></label>
                  </div>
                )}
              </fieldset>
              )}
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button><button className="lst-add" type="button" disabled={busy} onClick={saveActivity}>{busy ? "Saving..." : editId ? "Save changes" : "Record activity"}</button></footer>
          </div>
        </div>
      )}

      {modal === "types" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 700 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Activities &amp; rates</h3><p>What this lot charges for.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              {orderedTypes.map((t) => {
                const tr = t as Record<string, unknown>;
                const uses = activities.rows.filter((a) => String((a as Record<string, unknown>).activityTypeId) === String(tr.id)).length;
                return (<LotTypeRow key={String(tr.id)} row={tr} uses={uses} busy={busy} onSave={(d) => saveType(d, String(tr.id))} onRemove={() => removeType(String(tr.id))} />);
              })}
              <div style={{ borderTop: "2px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Add an activity</span><input placeholder="e.g. Key cutting" value={newType.label} onChange={(e) => setNewType((d) => ({ ...d, label: e.target.value }))} /></label>
                  <label className="lst-field"><span>Fee</span><input inputMode="decimal" placeholder="0" value={newType.defaultFee} onChange={(e) => setNewType((d) => ({ ...d, defaultFee: e.target.value }))} /></label>
                  <label className="lst-field"><span>Auction field</span><input type="checkbox" checked={newType.needsAuctionHouse} onChange={(e) => setNewType((d) => ({ ...d, needsAuctionHouse: e.target.checked }))} /></label>
                </div>
                <button className="lst-add" type="button" disabled={busy} onClick={() => saveType(newType)}>Add</button>
              </div>
              <p className="lst-hint">A fee of 0 means staff type the price on every job. An activity already used by a recorded entry can be renamed but not removed, so past months keep adding up the way they did.</p>
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" onClick={closeModal}>Done</button></footer>
          </div>
        </div>
      )}

      {modal === "chase" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Chase payment</h3><p>Send the link again, or record the money if it came in another way.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field"><span>How it was paid</span><select value={chaseVia} onChange={(e) => setChaseVia(e.target.value)}>{LOT_RECEIVED_VIA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></label>
                <label className="lst-field"><span>Received by</span><select value={chaseStaff} onChange={(e) => setChaseStaff(e.target.value)}><option value="">Choose staff</option>{staffOptions.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></label>
              </div>
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" disabled={busy} onClick={() => chaseRecordDirect(chaseId)}>Record as paid outside</button><button className="lst-add" type="button" disabled={busy} onClick={() => chaseResend(chaseId)}>Re-send the link</button></footer>
          </div>
        </div>
      )}

      {modal === "expense-line" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Add expense line</h3><p>A cost the lot carries.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Name</span><input value={lineDraft.label} onChange={(e) => setLineDraft((d) => ({ ...d, label: e.target.value }))} placeholder="e.g. Lot rent" /></label>
                <label className="lst-field wide"><span>Supplier / detail</span><input value={lineDraft.detail} onChange={(e) => setLineDraft((d) => ({ ...d, detail: e.target.value }))} /></label>
                <label className="lst-field"><span>How it behaves</span><select value={lineDraft.kind} onChange={(e) => setLineDraft((d) => ({ ...d, kind: e.target.value }))}><option value="metered">Changes every month</option><option value="fixed">Same every month</option></select></label>
                {lineDraft.kind === "fixed" && (<label className="lst-field"><span>Monthly amount</span><input inputMode="decimal" value={lineDraft.recurring} onChange={(e) => setLineDraft((d) => ({ ...d, recurring: e.target.value }))} /></label>)}
              </div>
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button><button className="lst-add" type="button" disabled={busy} onClick={addExpenseLine}>Add line</button></footer>
          </div>
        </div>
      )}

      {modal === "purchases" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>{text(purchaseLine?.label, "Purchases")} — {lotMonthLabel(month)}</h3><p>Every purchase for this line this month.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {expenseEntries.rows.filter((e) => String((e as Record<string, unknown>).lineId) === purchaseLineId && lotExpenseEntryMonth(e as Record<string, unknown>) === month).map((e) => {
                const er = e as Record<string, unknown>;
                const evoided = er.voided === true;
                return (<div key={String(er.id)} className="mini-table-row" style={evoided ? { opacity: 0.6 } : undefined}><span><strong>{evoided ? <s>{lotFormatCents(Number(er.amountCents) || 0)}</s> : lotFormatCents(Number(er.amountCents) || 0)}</strong><small>{formatDate(er.spentAt)}</small>{evoided && <span className="status-pill danger compact">Voided</span>}</span><span>{text(er.proofUrl, "") ? <a className="status-pill good compact" href={text(er.proofUrl, "")} target="_blank" rel="noopener" title="Open the receipt"><Paperclip size={12} /> {text(er.proofFileName, "View receipt")}</a> : er.proofRequired ? <span className="status-pill danger compact">Proof missing</span> : <span className="status-pill compact">No proof needed</span>}</span><span><small>Paid by {staffName(text(er.paidByStaffId, "")) || "—"}</small><small>Recorded by {staffName(text(er.recordedByStaffId, "")) || "—"}</small>{text(er.note, "") && <small>{text(er.note, "")}</small>}{evoided ? <small>Voided by {staffName(text(er.voidedByStaffId, ""))}{text(er.voidReason, "") ? ` — ${text(er.voidReason, "")}` : ""}</small> : <button className="ghost-button" type="button" onClick={() => { setVoidTarget({ type: "expense", id: String(er.id), label: `${lotFormatCents(Number(er.amountCents) || 0)} · ${text(purchaseLine?.label, "purchase")}` }); setVoidReason(""); setDraftError(""); setModal("void"); }}>Void</button>}</span></div>);
              })}
              {draftError && <div className="lst-form-error" role="alert">{draftError}</div>}
              <div style={{ borderTop: "2px solid var(--rule)", marginTop: 12, paddingTop: 12 }}>
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Amount</span><input inputMode="decimal" value={purchase.amount} onChange={(e) => setPurchase((d) => ({ ...d, amount: e.target.value }))} /></label>
                  <label className="lst-field"><span>Date</span><input type="date" value={purchase.spentAt} onChange={(e) => setPurchase((d) => ({ ...d, spentAt: e.target.value }))} /></label>
                  <label className="lst-field"><span>Paid by</span><select value={purchase.paidByStaffId} onChange={(e) => setPurchase((d) => ({ ...d, paidByStaffId: e.target.value }))}><option value="">Choose staff</option>{staffOptions.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}</select></label>
                  <label className="lst-field wide"><span>Note</span><input value={purchase.note} onChange={(e) => setPurchase((d) => ({ ...d, note: e.target.value }))} /></label>
                  <label className="lst-field wide"><span>Receipt</span><input type="file" accept="image/*,application/pdf" onChange={(e) => setPurchaseFile(e.target.files?.[0] ?? null)} /><small className="lst-hint">{expenseProofRequired(purchaseCents, proofThreshold) ? `This is at or above ${lotFormatCents(proofThreshold)}, so a receipt is required.` : `Below ${lotFormatCents(proofThreshold)} — a receipt is optional, attach one anyway if you have it.`}</small></label>
                </div>
              </div>
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Done</button><button className="lst-add" type="button" disabled={busy} onClick={addPurchase}>Add a purchase</button></footer>
          </div>
        </div>
      )}

      {modal === "void" && voidTarget && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Void this entry</h3><p>It stays on the record (struck through) and drops out of the totals — it is never deleted. Other staff see who voided it and why.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              <p className="panel-lede">{voidTarget.label}</p>
              <label className="lst-field wide"><span>Reason (optional)</span><input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="e.g. entered twice, wrong amount" /></label>
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" disabled={busy} onClick={closeModal}>Cancel</button><button className="lst-add" type="button" disabled={busy} onClick={confirmVoid}>Void entry</button></footer>
          </div>
        </div>
      )}

      {modal === "history" && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeModal}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head"><div><h3>Change history</h3><p>Every edit and void on this entry, most recent first.</p></div><button className="lst-icon-btn" type="button" onClick={closeModal} aria-label="Close"><X size={18} /></button></header>
            <div className="lst-modal-body">
              {historyLoading ? <p className="panel-lede">Loading…</p> : historyRows.length === 0 ? <EmptyState text="No changes recorded — nothing has been edited or voided." /> : historyRows.map((h) => {
                const hr = h as Record<string, unknown>;
                const rawAction = String(hr.action);
                const action = rawAction === "voided" ? "Voided" : rawAction === "paid" ? "Paid" : "Edited";
                const who = rawAction === "paid" ? "the customer, on the website" : staffName(text(hr.byStaffId, "")) || "an unknown user";
                return (
                  <div key={String(hr.id)} style={{ padding: "10px 0", borderBottom: "1px solid var(--rule)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                      <span><strong>{action}</strong> · {who}</span>
                      <small style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{formatDate(hr.at)}</small>
                    </div>
                    {text(hr.summary, "") && <div style={{ marginTop: 2 }}><small>{text(hr.summary, "")}</small></div>}
                  </div>
                );
              })}
            </div>
            <footer className="lst-modal-foot"><button className="lst-btn ghost" type="button" onClick={closeModal}>Done</button></footer>
          </div>
        </div>
      )}
    </div>
  );
}

function LotTypeRow({ row, uses, busy, onSave, onRemove }: { row: Record<string, unknown>; uses: number; busy: boolean; onSave: (d: LotActivityTypeDraft) => void; onRemove: () => void }) {
  const [label, setLabel] = useState(text(row.label, ""));
  const [fee, setFee] = useState(String((Number(row.defaultFeeCents) || 0) / 100));
  const [needsAuction, setNeedsAuction] = useState(Boolean(row.needsAuctionHouse));
  return (
    <div className="lst-form-grid" style={{ alignItems: "end", marginBottom: 8 }}>
      <label className="lst-field"><span>Name</span><input value={label} onChange={(e) => setLabel(e.target.value)} /></label>
      <label className="lst-field"><span>Fee</span><input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} /></label>
      <label className="lst-field"><span>Auction field</span><input type="checkbox" checked={needsAuction} onChange={(e) => setNeedsAuction(e.target.checked)} /></label>
      <div><small className="lst-hint">{uses > 0 ? `${uses} ${uses === 1 ? "entry uses" : "entries use"} this` : "Not used yet"}</small></div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => onSave({ label, defaultFee: fee, needsAuctionHouse: needsAuction })}>Save</button>
        <button className="ghost-button" type="button" disabled={busy} onClick={onRemove}>Remove</button>
      </div>
    </div>
  );
}

function LotMonthlyChart({ revenue, expenses, year }: { revenue: number[]; expenses: number[]; year: number }) {
  const w = 720; const h = 240; const pad = 34;
  const max = Math.max(1, ...revenue, ...expenses);
  const bw = (w - pad * 2) / 12;
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  let running = 0;
  const netPts = revenue.map((r, i) => { running += r - expenses[i]; return running; });
  const netMax = Math.max(1, ...netPts.map((n) => Math.abs(n)));
  const ny = (v: number) => h / 2 - (v / netMax) * (h / 2 - pad);
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
  return (
    <div className="mini-table"><div style={{ minWidth: w }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`Monthly revenue and expenses for ${year}`}>
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (<g key={g}><line x1={pad} x2={w - pad} y1={y(max * g)} y2={y(max * g)} stroke="#d7e7e5" /><text x={4} y={y(max * g) + 4} fontSize="9" fill="#64748b">{`$${Math.round((max * g) / 100)}`}</text></g>))}
        {revenue.map((r, i) => (<g key={i}><title>{`${months[i]}: rev $${(r / 100).toFixed(0)}, exp $${(expenses[i] / 100).toFixed(0)}`}</title><rect x={pad + i * bw + 4} y={y(r)} width={bw / 2 - 4} height={h - pad - y(r)} fill="#0d9488" /><rect x={pad + i * bw + bw / 2} y={y(expenses[i])} width={bw / 2 - 4} height={h - pad - y(expenses[i])} fill="#f59e0b" /><text x={pad + i * bw + bw / 2} y={h - pad + 12} fontSize="9" fill="#64748b" textAnchor="middle">{months[i]}</text></g>))}
        <line x1={pad} x2={w - pad} y1={ny(0)} y2={ny(0)} stroke="#94a3b8" strokeDasharray="3 3" />
        <polyline fill="none" stroke="#b42318" strokeWidth="2" points={netPts.map((n, i) => `${pad + i * bw + bw / 2},${ny(n)}`).join(" ")} />
      </svg>
      <p className="lst-hint">Revenue (teal), expenses (amber), running net (red).</p>
    </div></div>
  );
}

// Which line is eating the money, ranked, with each share drawn against the
// same total the tiles above show. One colour on purpose: the ranking is the
// information, a palette would only decorate it.
function LotExpenseBreakdown({ spend, totalCents, year }: { spend: { lineId: string; label: string; cents: number }[]; totalCents: number; year: number }) {
  if (spend.length === 0 || totalCents <= 0) {
    return (
      <>
        <div className="panel-header" style={{ marginTop: 20 }}><h3>Where the money goes</h3></div>
        <EmptyState text={`Nothing spent in ${year}.`} />
      </>
    );
  }
  return (
    <>
      <div className="panel-header" style={{ marginTop: 20 }}><h3>Where the money goes</h3></div>
      <div className="lot-spend-breakdown">
        {spend.map((row) => {
          const fraction = row.cents / totalCents;
          const percent = Math.round(fraction * 100);
          return (
            <div className="lot-spend-row" key={row.lineId}>
              <div className="lot-spend-head">
                <strong>{row.label || "Other"}</strong>
                <b>{lotFormatCents(row.cents)}</b>
              </div>
              <div className="lot-spend-track">
                <div className="lot-spend-fill" style={{ width: `${Math.max(fraction * 100, 1.2)}%` }} />
                <span>{percent < 1 ? "<1%" : `${percent}%`}</span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function LotYearSummary({ revenue, expense, net }: { revenue: number; expense: number; net: number }) {
  const max = Math.max(1, revenue, expense, Math.abs(net));
  const bar = (label: string, v: number, color: string) => (
    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 90px", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span>{label}</span>
      <div style={{ background: "var(--paper-soft)", borderRadius: 6 }}><div style={{ width: `${(Math.abs(v) / max) * 100}%`, background: color, height: 16, borderRadius: 6 }} /></div>
      <strong style={{ textAlign: "right" }}>{lotFormatCents(v)}</strong>
    </div>
  );
  return (<div>{bar("Revenue", revenue, "#0d9488")}{bar("Expenses", expense, "#f59e0b")}{bar("Net", net, net < 0 ? "#dc2626" : "#059669")}</div>);
}

// The open-ended parking actions: bill through today, record an off-platform
// payment, and close the stay. Rendered per parked car; the accrual is
// computed from billedThroughDate ?? parkingDate to today at the daily rate.
function ParkingBillingActions({ row, staff }: { row: FirestoreRow; staff: FirestoreRow[] }) {
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const r = row as Record<string, unknown>;
  const dayMs = 24 * 60 * 60 * 1000;
  const asMs = (v: unknown) => {
    const d = asDate(v);
    return d ? d.getTime() : null;
  };
  const dailyCents = Math.round((Number(r.dailyRate) || 0) * 100);
  const openEnded = !r.parkingEndDate;
  const fromMs = asMs(r.billedThroughDate) ?? asMs(r.parkingDate ?? r.createdAt);
  // Only an open-ended stay accrues: a stay with a leave date was priced for
  // its whole range when it was recorded.
  const days = openEnded && fromMs ? Math.max(0, Math.floor((Date.now() - fromMs) / dayMs)) : 0;
  const unbilledCents = days * dailyCents;
  const settled = ["succeeded", "paid"].includes(String(r.paymentStatus));
  const billedThrough = asDate(r.billedThroughDate);
  const staffOptions = staff.map((s) => ({
    id: String((s as Record<string, unknown>).id),
    name: text((s as Record<string, unknown>).fullName, "") || text((s as Record<string, unknown>).name, "") || text((s as Record<string, unknown>).email, ""),
  }));

  const note = !openEnded
    ? "Priced for its leave date when it was recorded; nothing accrues day by day."
    : unbilledCents > 0
      ? billedThrough
        ? `Accruing since ${formatDate(r.billedThroughDate)}. Bill it whenever you like — the car stays in place.`
        : "Nothing billed yet. Bill through today to send the first link."
      : "Everything up to today has been billed.";

  async function bill() {
    await runPanelAction(setBusy, setFlash, "Payment link sent.", async () => {
      await httpsCallable(functions, "billParkingThroughToday")({ parkedCarId: row.id });
    });
  }
  async function received() {
    if (!receivedBy) { setFlash("Say who took the money so it can be reconciled."); return; }
    await runPanelAction(setBusy, setFlash, "Recorded as received.", async () => {
      await httpsCallable(functions, "recordParkingPaymentReceived")({ parkedCarId: row.id, receivedByStaffId: receivedBy });
    });
  }
  async function close() {
    await runPanelAction(setBusy, setFlash, "Stay closed.", async () => {
      await httpsCallable(functions, "closeParkingStay")({ parkedCarId: row.id });
    });
  }

  return (
    <div className="pur-info" style={{ display: "block" }}>
      <div className="row-detail-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div><span>Leaves</span><b>{openEnded ? "Open-ended" : formatDate(r.parkingEndDate)}</b></div>
        <div><span>Billed through</span><b>{billedThrough ? formatDate(r.billedThroughDate) : "Nothing yet"}</b></div>
        <div><span>Unbilled</span><b>{days} {days === 1 ? "day" : "days"} · {lotFormatCents(unbilledCents)}</b></div>
      </div>
      <p className="lst-hint">{note}</p>
      {flash && <div className="lst-hint" role="status">{flash}</div>}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {openEnded && (
          <button className="primary-button" type="button" disabled={busy || unbilledCents <= 0} onClick={bill}>
            {unbilledCents > 0 ? `Bill ${lotFormatCents(unbilledCents)} through today` : "Nothing to bill"}
          </button>
        )}
        {!settled && billedThrough && (
          <>
            <select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} aria-label="Received by">
              <option value="">Received by…</option>
              {staffOptions.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
            </select>
            <button className="secondary-button" type="button" disabled={busy} onClick={received}>Payment received in person</button>
          </>
        )}
        {openEnded && (<button className="ghost-button" type="button" disabled={busy} onClick={close}>Car left today</button>)}
      </div>
    </div>
  );
}
