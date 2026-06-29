"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
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
  ClipboardList,
  Clock3,
  Copy,
  Download,
  MapPinned,
  Package,
  ParkingCircle,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import { db, functions, storage } from "@/lib/firebase";
import { currentLanguage, formatDate, formatMoney, text } from "@/lib/format";
import { US_STATE_OPTIONS, citiesForState, withSelected } from "@/lib/us-locations";
import type { FirestoreRow } from "@/types/admin";

type PanelProps = {
  businessId: string;
  businessName?: string;
  businessStatus?: string;
  businessProfileImageUrl?: string;
  enabledServices?: string[];
};

type DestinationDraft = {
  countryId: string;
  price: string;
  minDays: string;
  maxDays: string;
  note: string;
  isActive: boolean;
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

type TransportDraft = {
  id: string;
  ownerName: string;
  carMake: string;
  carModel: string;
  carYear: string;
  vinNumber: string;
  countryId: string;
  transportDate: string;
  price: string;
  status: string;
};

type PoolDraft = {
  origin: "businessHeld" | "dropOff";
  destinationCountryId: string;
  totalShares: string;
  reservedShares: string;
  maxJoiners: string;
  approvalMode: "approval" | "auto";
  shipMode: "sea" | "air";
  joinDeadline: string;
  senderName: string;
  senderAddress: string;
  receiverName: string;
  receiverPhone: string;
  contentsDescription: string;
  attestedWeightKg: string;
  contentsAttested: boolean;
  prohibitedItemsAcknowledged: boolean;
  sharedLiabilityAccepted: boolean;
};

type PoolRolloverDraft = {
  joinDeadline: string;
  maxJoiners: string;
  note: string;
};

const countries = [
  { id: "guinea", name: "Guinea", nameFr: "Guinée", code: "GN" },
  { id: "senegal", name: "Senegal", nameFr: "Sénégal", code: "SN" },
  { id: "mali", name: "Mali", nameFr: "Mali", code: "ML" },
  { id: "c-te-d-ivoire", name: "Cote d'Ivoire", nameFr: "Côte d’Ivoire", code: "CI" },
  { id: "gambia", name: "Gambia", nameFr: "Gambie", code: "GM" },
  { id: "sierra_leone", name: "Sierra Leone", nameFr: "Sierra Leone", code: "SL" },
  { id: "liberia", name: "Liberia", nameFr: "Libéria", code: "LR" },
  { id: "ghana", name: "Ghana", nameFr: "Ghana", code: "GH" },
  { id: "nigeria", name: "Nigeria", nameFr: "Nigéria", code: "NG" },
  { id: "guinea_bissau", name: "Guinea-Bissau", nameFr: "Guinée-Bissau", code: "GW" },
  { id: "mauritania", name: "Mauritania", nameFr: "Mauritanie", code: "MR" },
  { id: "togo", name: "Togo", nameFr: "Togo", code: "TG" },
  { id: "benin", name: "Benin", nameFr: "Bénin", code: "BJ" },
  { id: "burkina_faso", name: "Burkina Faso", nameFr: "Burkina Faso", code: "BF" },
  { id: "niger", name: "Niger", nameFr: "Niger", code: "NE" },
  { id: "cameroon", name: "Cameroon", nameFr: "Cameroun", code: "CM" },
];
const sharedBarrelShareWeightCapKg = 20;

function countryFlag(code: string) {
  const cc = (code || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return "🏳️";
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

const listingStatuses = ["draft", "active", "reserved", "sold", "inactive"];

// Car attribute option lists — kept in sync with the mobile listing form
// (my_flutter_app/lib/screens/staff_car_management_screen.dart). These power the
// same customer-facing filters as the app.
const conditionOptions = ["new", "used", "certified", "salvage"];
const bodyTypeOptions = ["sedan", "suv", "truck", "van", "coupe", "hatchback", "wagon", "convertible"];
const transmissionOptions = ["automatic", "manual", "cvt"];
const fuelOptions = ["gas", "diesel", "hybrid", "electric", "plug_in_hybrid"];
const drivetrainOptions = ["fwd", "rwd", "awd", "4wd"];
const colorOptions = ["black", "white", "silver", "gray", "red", "blue", "green", "yellow", "brown", "beige", "gold", "orange", "purple", "burgundy", "other"];
const featureOptions = ["backup_camera", "bluetooth", "leather_seats", "sunroof", "navigation", "heated_seats", "apple_carplay", "android_auto", "blind_spot", "third_row", "remote_start", "keyless_entry"];

const ACRONYMS = new Set(["suv", "cvt", "vin", "fwd", "rwd", "awd", "4wd"]);
function optionLabel(value: string) {
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
  minDays: "",
  maxDays: "",
  note: "",
  isActive: true,
};

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

const emptyTransportDraft: TransportDraft = {
  id: "",
  ownerName: "",
  carMake: "",
  carModel: "",
  carYear: "",
  vinNumber: "",
  countryId: "guinea",
  transportDate: "",
  price: "",
  status: "pending",
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

export function DestinationsPanel({ businessId }: PanelProps) {
  const destinations = useBusinessSubcollectionRows(
    "destinationCountries",
    businessId,
    Boolean(businessId),
    100,
  );
  const [draft, setDraft] = useState<DestinationDraft>(emptyDestinationDraft);
  const [editingId, setEditingId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const rows = useMemo(
    () =>
      [...destinations.rows].sort((a, b) =>
        countryName(a.id).localeCompare(countryName(b.id)),
      ),
    [destinations.rows],
  );
  const filteredRows = useMemo(
    () => filterRows(rows, search, ["name", "destinationCountryName", "code", "countryCode", "barrelShippingPrice"]),
    [rows, search],
  );
  const activeCount = rows.filter((row) => row.isActive !== false).length;
  // Countries already configured can still be edited; new ones pick from the rest.
  const availableCountries = useMemo(
    () => countries.filter((country) => editingId === country.id || !rows.some((row) => row.id === country.id)),
    [rows, editingId],
  );

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
    setEditingId(row.id);
    setDraft({
      countryId: row.id,
      price: numberString(row.barrelShippingPrice),
      minDays: numberString(row.deliveryEstimateMinDays),
      maxDays: numberString(row.deliveryEstimateMaxDays),
      note: text(row.destinationNote, ""),
      isActive: row.isActive !== false,
    });
    setMessage("");
    setFormOpen(true);
  }

  async function saveDestination() {
    if (!businessId) throw new Error("Business ID is required.");
    const country = countries.find((item) => item.id === draft.countryId);
    if (!country) throw new Error("Select a supported country.");
    const price = Number(draft.price);
    const minDays = Number(draft.minDays);
    const maxDays = Number(draft.maxDays);
    if (!Number.isFinite(price) || price <= 0) {
      throw new Error("Enter a barrel shipping price greater than zero.");
    }
    if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays <= 0 || maxDays < minDays) {
      throw new Error("Enter a valid min/max delivery day range.");
    }
    await setDoc(
      doc(db, "businesses", businessId, "destinationCountries", country.id),
      {
        businessId,
        id: country.id,
        name: country.name,
        destinationCountryName: country.name,
        countryCode: country.code,
        code: country.code,
        barrelShippingPrice: price,
        deliveryEstimateMinDays: minDays,
        deliveryEstimateMaxDays: maxDays,
        destinationNote: draft.note.trim(),
        isActive: draft.isActive,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    setEditingId("");
    setDraft(emptyDestinationDraft);
    setFormOpen(false);
    setMessage("Destination saved.");
  }

  async function setActive(row: FirestoreRow, isActive: boolean) {
    if (isActive && !(Number(row.barrelShippingPrice) > 0)) {
      throw new Error("Add a shipping price greater than zero before activating.");
    }
    await setDoc(
      doc(db, "businesses", businessId, "destinationCountries", row.id),
      { businessId, isActive, updatedAt: serverTimestamp() },
      { merge: true },
    );
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Shipping destinations</h2>
          <p>{rows.length === 0 ? "Set a price per country so customers can ship barrels there." : `${rows.length} destination${rows.length === 1 ? "" : "s"} · ${activeCount} active`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy} message={message} />
          <button className="lst-add" type="button" onClick={openNew} disabled={availableCountries.length === 0}>
            <Plus size={17} /> New destination
          </button>
        </div>
      </header>

      {destinations.error && <div className="error-box">{destinations.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search destinations…" />
        </div>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("destinations.csv", filteredRows, ["name", "code", "barrelShippingPrice", "deliveryEstimateMinDays", "deliveryEstimateMaxDays", "isActive", "updatedAt"])}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {destinations.loading && <LoadingState />}
      {!destinations.loading && rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><MapPinned size={30} /></div>
          <h3>No destinations yet</h3>
          <p>Add the countries you ship barrels to and set a price for each.</p>
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> Add your first destination</button>
        </div>
      )}
      {!destinations.loading && rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No destinations match your search." />
      )}

      <div className="lst-grid">
        {filteredRows.map((row) => {
          const active = row.isActive !== false;
          const country = countries.find((item) => item.id === row.id);
          return (
            <article className={`dst-card ${active ? "" : "off"}`} key={row.id}>
              <div className="dst-head">
                <span className="dst-flag">{countryFlag(text(row.code ?? row.countryCode ?? country?.code, ""))}</span>
                <div className="dst-name">
                  <strong>{countryName(row.id)}</strong>
                  <span>{deliveryWindow(row) || "No delivery estimate"}</span>
                </div>
                <span className={`lst-badge ${active ? "ok" : "muted"}`}>{active ? "Active" : "Inactive"}</span>
              </div>
              <div className="dst-price">{formatMoney(row.barrelShippingPrice)} <small>/ barrel</small></div>
              {Boolean(text(row.destinationNote, "")) && <div className="dst-note">{text(row.destinationNote, "")}</div>}
              <div className="dst-foot">
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editDestination(row)}><Pencil size={14} /> Edit</button>
                {active ? (
                  <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "Destination deactivated.", () => setActive(row, false))}>Deactivate</button>
                ) : (
                  <button className="lst-btn" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "Destination activated.", () => setActive(row, true))}>Activate</button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeForm}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{editingId ? `Edit ${countryName(editingId)}` : "New destination"}</h3>
              <button className="lst-icon-btn" type="button" onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Country</span>
                  <select value={draft.countryId} disabled={Boolean(editingId)} onChange={(event) => setDraft((value) => ({ ...value, countryId: event.target.value }))}>
                    {(editingId ? countries : availableCountries).map((country) => (
                      <option key={country.id} value={country.id}>{countryFlag(country.code)} {countryName(country.id)}</option>
                    ))}
                  </select>
                </label>
                <label className="lst-field"><span>Price per barrel (USD)</span>
                  <input inputMode="decimal" value={draft.price} onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))} placeholder="250" />
                </label>
                <label className="lst-field"><span>&nbsp;</span>
                  <label className="lst-check" style={{ padding: "10px 0 0" }}>
                    <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((value) => ({ ...value, isActive: event.target.checked }))} />
                    <span>Active (visible to customers)</span>
                  </label>
                </label>
                <label className="lst-field"><span>Delivery min (days)</span>
                  <input inputMode="numeric" value={draft.minDays} onChange={(event) => setDraft((value) => ({ ...value, minDays: event.target.value }))} placeholder="14" />
                </label>
                <label className="lst-field"><span>Delivery max (days)</span>
                  <input inputMode="numeric" value={draft.maxDays} onChange={(event) => setDraft((value) => ({ ...value, maxDays: event.target.value }))} placeholder="30" />
                </label>
                <label className="lst-field wide"><span>Note for customers (optional)</span>
                  <textarea rows={2} value={draft.note} onChange={(event) => setDraft((value) => ({ ...value, note: event.target.value }))} placeholder="e.g. Door-to-door delivery in Conakry included" />
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "Destination saved.", saveDestination)}>
                <Save size={16} /> {editingId ? "Save changes" : "Create destination"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

export function ListingsPanel({
  businessId,
  businessName = "",
  businessStatus = "pending",
  businessProfileImageUrl = "",
  enabledServices = ["carSales"],
}: PanelProps) {
  const listings = useBusinessRows("cars", businessId, Boolean(businessId), null);
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
  function addImageFiles(files: FileList | null) {
    if (!files) return;
    setImages((prev) => {
      const room = MAX_LISTING_IMAGES - prev.length;
      const additions = Array.from(files)
        .slice(0, Math.max(0, room))
        .map((file) => ({ key: newKey(), file, preview: URL.createObjectURL(file) }));
      return [...prev, ...additions];
    });
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
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("listings.csv", filteredRows, ["title", "make", "model", "year", "price", "status", "locationCity", "locationState", "updatedAt"])}>
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
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeForm}>
          <div className="lst-modal" onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{editingId ? "Edit listing" : "New listing"}</h3>
              <button className="lst-icon-btn" type="button" onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <div className="lst-form-grid">
                <div className="lst-form-section">Vehicle</div>
                <label className="lst-field wide">
                  <span>Title</span>
                  <input value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} placeholder="e.g. 2019 Toyota Camry XLE" />
                </label>
                <label className="lst-field"><span>Make</span>
                  <input value={draft.make} onChange={(event) => setDraft((value) => ({ ...value, make: event.target.value }))} placeholder="Toyota" />
                </label>
                <label className="lst-field"><span>Model</span>
                  <input value={draft.model} onChange={(event) => setDraft((value) => ({ ...value, model: event.target.value }))} placeholder="Camry" />
                </label>
                <label className="lst-field"><span>Year</span>
                  <input inputMode="numeric" value={draft.year} onChange={(event) => setDraft((value) => ({ ...value, year: event.target.value }))} placeholder="2019" />
                </label>
                <label className="lst-field"><span>Condition</span>
                  <select value={draft.condition} onChange={(event) => setDraft((value) => ({ ...value, condition: event.target.value }))}>
                    <option value="">Select condition</option>
                    {conditionOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
                  </select>
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
                      <input type="file" accept="image/*" multiple hidden onChange={(event) => { addImageFiles(event.target.files); event.target.value = ""; }} />
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
              <button className="lst-btn ghost" type="button" onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, "Listing saved.", saveListing)}>
                <Save size={16} /> {editingId ? "Save changes" : "Create listing"}
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

export function BarrelsPanel({ businessId }: PanelProps) {
  const shipments = useBusinessRows("barrelShipments", businessId, Boolean(businessId), 500);
  const pools = useBusinessRows("barrelPools", businessId, Boolean(businessId), 500);
  const balanceRequests = useBusinessRows("barrelPoolBalanceRequests", businessId, Boolean(businessId), 500);
  const destinations = useBusinessSubcollectionRows("destinationCountries", businessId, Boolean(businessId), 100);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [poolFilter, setPoolFilter] = useState("all");
  const [poolFormOpen, setPoolFormOpen] = useState(false);
  const [poolDraft, setPoolDraft] = useState<PoolDraft>(() => defaultPoolDraft());
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

  async function run(id: string, label: string, action: () => Promise<unknown>) {
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
  function openPoolForm() {
    setPoolDraft(defaultPoolDraft(activeDestinations[0]?.id ?? ""));
    setMessage("");
    setPoolFormOpen(true);
  }
  function closePoolForm() {
    setPoolFormOpen(false);
    setPoolDraft(defaultPoolDraft(activeDestinations[0]?.id ?? ""));
  }
  async function savePool() {
    if (!businessId) throw new Error("Business ID is required.");
    if (!poolDraft.destinationCountryId) throw new Error("Choose a destination.");
    const totalShares = Number(poolDraft.totalShares);
    const reservedShares = Number(poolDraft.reservedShares);
    const maxJoiners = Number(poolDraft.maxJoiners);
    const minimumReserved = poolDraft.origin === "dropOff" ? 1 : 0;
    if (!Number.isInteger(totalShares) || totalShares < 2 || totalShares > 4) {
      throw new Error("Total shares must be between 2 and 4.");
    }
    if (!Number.isInteger(reservedShares) || reservedShares < minimumReserved || reservedShares >= totalShares) {
      throw new Error(poolDraft.origin === "dropOff" ? "Drop-off pools need 1 reserved share and at least 1 open share." : "Reserved shares must leave at least 1 share open.");
    }
    if (!Number.isInteger(maxJoiners) || maxJoiners < 1) {
      throw new Error("Enter at least 1 max joiner.");
    }
    if (poolDraft.origin === "dropOff" && (!poolDraft.senderName.trim() || !poolDraft.receiverName.trim() || !poolDraft.receiverPhone.trim())) {
      throw new Error("Sender, receiver, and receiver phone are required for drop-off pools.");
    }
    if (poolDraft.origin === "dropOff") {
      const weightKg = Number(poolDraft.attestedWeightKg || 0);
      if (!poolDraft.contentsDescription.trim()) {
        throw new Error("Contents note is required for drop-off pools.");
      }
      if (!Number.isFinite(weightKg) || weightKg <= 0 || weightKg > reservedShares * sharedBarrelShareWeightCapKg) {
        throw new Error("Drop-off weight must fit the reserved shares.");
      }
      if (!poolDraft.contentsAttested || !poolDraft.prohibitedItemsAcknowledged || !poolDraft.sharedLiabilityAccepted) {
        throw new Error("Confirm contents, prohibited items, and shared liability before starting the pool.");
      }
    }
    await httpsCallable(functions, "createBusinessBarrelPool")({
      businessId,
      destinationCountryId: poolDraft.destinationCountryId,
      origin: poolDraft.origin,
      totalShares,
      reservedShares,
      maxJoiners,
      approvalMode: poolDraft.approvalMode,
      shipMode: poolDraft.shipMode,
      joinDeadline: poolDraft.joinDeadline,
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
    closePoolForm();
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
          <p>{shipments.rows.length === 0 ? "Barrels customers send through your business appear here." : `${shipments.rows.length} shipment${shipments.rows.length === 1 ? "" : "s"}`}</p>
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

      <div className="lst-subsection">
        <div className="lst-subhead">
          <div>
            <h3>Shared barrel pools</h3>
            <p>{pools.rows.length === 0 ? "Open pooled barrels, approve joiners, and seal full barrels into tracked shipments." : `${pools.rows.length} pool${pools.rows.length === 1 ? "" : "s"}`}</p>
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
          <div className="pool-config-note">Add an active barrel destination with a price before starting a shared pool.</div>
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
                          <button className="lst-btn" disabled={busy} type="button" onClick={() => run(`pool-${row.id}`, "Joiner accepted.", () => decideJoin(row, participant.uid, "accept"))}>Approve</button>
                          <button className="lst-btn ghost" disabled={busy} type="button" onClick={() => run(`pool-${row.id}`, "Joiner rejected.", () => decideJoin(row, participant.uid, "reject"))}>Reject</button>
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
                              run(`pool-${row.id}`, "Shared barrel balance collected.", () => markBalanceCollected(request.id, note));
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
                  <button className="lst-btn" disabled={!canSeal || busy} type="button" onClick={() => run(`pool-${row.id}`, "Pool sealed into a shipment.", () => sealPool(row))}>
                    <CheckCircle2 size={15} /> Seal pool
                  </button>
                  <button className="lst-btn ghost" disabled={!canSealUnderfilled || busy} title={canSealUnderfilled ? "Seal after deadline" : "Underfilled pools can only ship after the join deadline"} type="button" onClick={() => run(`pool-${row.id}`, "Underfilled pool sealed into a shipment.", () => sealPool(row, true))}>
                    <CheckCircle2 size={15} /> Seal underfilled
                  </button>
                  <button className="lst-btn ghost" disabled={!canRollToBusinessHeld || busy} title={canRollToBusinessHeld ? "Continue matching at the business" : "Only underfilled pools past the join deadline can roll over"} type="button" onClick={() => openRollPool(row)}>
                    <RotateCcw size={15} /> Roll to business-held
                  </button>
                  <button className="lst-btn ghost" disabled={!canAdjust || busy} type="button" onClick={() => openAdjustPool(row)}>
                    <Pencil size={15} /> Adjust shares
                  </button>
                  <button className="lst-btn ghost" disabled={status === "sealed" || status === "cancelled" || busy} type="button" onClick={() => run(`pool-${row.id}`, "Pool cancelled.", () => cancelPool(row))}>
                    <XCircle size={15} /> Cancel pool
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {adjustingPool && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeAdjustPool}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Adjust inspected shares</h3>
              <button className="lst-icon-btn" type="button" onClick={closeAdjustPool} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
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
              <button className="lst-btn ghost" type="button" onClick={closeAdjustPool}>Cancel</button>
              <button className="lst-add" type="button" disabled={busyId === `pool-adjust-${adjustingPool.id}`} onClick={() => run(`pool-adjust-${adjustingPool.id}`, "Pool capacity adjusted.", savePoolAdjustment)}>
                <Save size={16} /> Save adjustment
              </button>
            </footer>
          </div>
        </div>
      )}

      {rollingPool && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeRollPool}>
          <div className="lst-modal" style={{ maxWidth: 520 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Roll to business-held</h3>
              <button className="lst-icon-btn" type="button" onClick={closeRollPool} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
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
              <button className="lst-btn ghost" type="button" onClick={closeRollPool}>Cancel</button>
              <button className="lst-add" type="button" disabled={busyId === `pool-roll-${rollingPool.id}`} onClick={() => run(`pool-roll-${rollingPool.id}`, "Pool rolled into business-held matching.", savePoolRollover)}>
                <RotateCcw size={16} /> Roll pool
              </button>
            </footer>
          </div>
        </div>
      )}

      {poolFormOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closePoolForm}>
          <div className="lst-modal" style={{ maxWidth: 640 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>Start shared barrel pool</h3>
              <button className="lst-icon-btn" type="button" onClick={closePoolForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <div className="lst-form-grid">
                <label className="lst-field"><span>Pool origin</span>
                  <select value={poolDraft.origin} onChange={(event) => setPoolDraft((value) => ({
                    ...value,
                    origin: event.target.value as PoolDraft["origin"],
                    reservedShares: event.target.value === "dropOff" ? "1" : "0",
                  }))}>
                    <option value="businessHeld">Business-held</option>
                    <option value="dropOff">Customer drop-off</option>
                  </select>
                </label>
                <label className="lst-field"><span>Destination</span>
                  <select value={poolDraft.destinationCountryId} onChange={(event) => setPoolDraft((value) => ({ ...value, destinationCountryId: event.target.value }))}>
                    {activeDestinations.map((row) => {
                      const country = countries.find((item) => item.id === row.id);
                      return (
                        <option key={row.id} value={row.id}>
                          {countryFlag(text(row.code ?? row.countryCode ?? country?.code, ""))} {countryName(row.id)} · {formatMoney(row.barrelShippingPrice)}
                        </option>
                      );
                    })}
                  </select>
                </label>
                <label className="lst-field"><span>Total shares</span>
                  <select value={poolDraft.totalShares} onChange={(event) => setPoolDraft((value) => ({ ...value, totalShares: event.target.value }))}>
                    <option value="2">2 halves</option>
                    <option value="3">3 shares</option>
                    <option value="4">4 quarters</option>
                  </select>
                </label>
                <label className="lst-field"><span>Reserved shares</span>
                  <input inputMode="numeric" value={poolDraft.reservedShares} onChange={(event) => setPoolDraft((value) => ({ ...value, reservedShares: event.target.value }))} placeholder={poolDraft.origin === "dropOff" ? "1" : "0"} />
                </label>
                <label className="lst-field"><span>Max joiners</span>
                  <input inputMode="numeric" value={poolDraft.maxJoiners} onChange={(event) => setPoolDraft((value) => ({ ...value, maxJoiners: event.target.value }))} placeholder="2" />
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
                  <input type="date" value={poolDraft.joinDeadline} onChange={(event) => setPoolDraft((value) => ({ ...value, joinDeadline: event.target.value }))} />
                </label>
                {poolDraft.origin === "dropOff" && (
                  <>
                    <label className="lst-field"><span>Sender name</span>
                      <input value={poolDraft.senderName} onChange={(event) => setPoolDraft((value) => ({ ...value, senderName: event.target.value }))} placeholder="Customer name" />
                    </label>
                    <label className="lst-field"><span>Sender address</span>
                      <input value={poolDraft.senderAddress} onChange={(event) => setPoolDraft((value) => ({ ...value, senderAddress: event.target.value }))} placeholder="Optional" />
                    </label>
                    <label className="lst-field"><span>Receiver name</span>
                      <input value={poolDraft.receiverName} onChange={(event) => setPoolDraft((value) => ({ ...value, receiverName: event.target.value }))} placeholder="Recipient name" />
                    </label>
                    <label className="lst-field"><span>Receiver phone</span>
                      <input value={poolDraft.receiverPhone} onChange={(event) => setPoolDraft((value) => ({ ...value, receiverPhone: event.target.value }))} placeholder="+224…" />
                    </label>
                    <label className="lst-field wide"><span>Contents note</span>
                      <textarea rows={2} value={poolDraft.contentsDescription} onChange={(event) => setPoolDraft((value) => ({ ...value, contentsDescription: event.target.value }))} placeholder="Describe packed contents" />
                    </label>
                    <label className="lst-field"><span>Inspected weight (kg)</span>
                      <input type="number" min="0" step="0.1" value={poolDraft.attestedWeightKg} onChange={(event) => setPoolDraft((value) => ({ ...value, attestedWeightKg: event.target.value }))} placeholder="20 kg per share max" />
                    </label>
                    <label className="lst-check wide">
                      <input type="checkbox" checked={poolDraft.contentsAttested} onChange={(event) => setPoolDraft((value) => ({ ...value, contentsAttested: event.target.checked }))} />
                      <span>Contents and weight were reviewed with the customer.</span>
                    </label>
                    <label className="lst-check wide">
                      <input type="checkbox" checked={poolDraft.prohibitedItemsAcknowledged} onChange={(event) => setPoolDraft((value) => ({ ...value, prohibitedItemsAcknowledged: event.target.checked }))} />
                      <span>No prohibited or unsafe items were accepted.</span>
                    </label>
                    <label className="lst-check wide">
                      <input type="checkbox" checked={poolDraft.sharedLiabilityAccepted} onChange={(event) => setPoolDraft((value) => ({ ...value, sharedLiabilityAccepted: event.target.checked }))} />
                      <span>The customer accepted shared-barrel liability and inspection rules.</span>
                    </label>
                  </>
                )}
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" onClick={closePoolForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busyId === "pool-create"} onClick={() => run("pool-create", "Shared barrel pool opened.", savePool)}>
                <Save size={16} /> Open pool
              </button>
            </footer>
          </div>
        </div>
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
                  <select value={status} disabled={busy} onChange={(event) => run(row.id, "Shipment updated.", () => updateStatus(row, event.target.value))}>
                    {barrelStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
              </div>
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

export function TransportPanel({ businessId, businessName = "" }: PanelProps) {
  const transports = useBusinessRows("transportRequests", businessId, Boolean(businessId), 500);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState("");
  const [draft, setDraft] = useState<TransportDraft>(emptyTransportDraft);
  const [editingId, setEditingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const searched = useMemo(
    () => filterRows(transports.rows, search, ["trackingCode", "ownerName", "customerName", "carMake", "carModel", "carYear", "vinNumber", "destinationCountryName", "status"]),
    [transports.rows, search],
  );
  const filteredRows = useMemo(
    () => (filter === "all" ? searched : searched.filter((row) => text(row.status, "") === filter)),
    [searched, filter],
  );

  function openNew() {
    setEditingId("");
    setDraft(emptyTransportDraft);
    setMessage("");
    setFormOpen(true);
  }
  function closeForm() {
    setEditingId("");
    setDraft(emptyTransportDraft);
    setFormOpen(false);
  }
  function editTransport(row: FirestoreRow) {
    setEditingId(row.id);
    setDraft({
      id: row.id,
      ownerName: text(row.ownerName ?? row.customerName, ""),
      carMake: text(row.carMake, ""),
      carModel: text(row.carModel, ""),
      carYear: text(row.carYear, ""),
      vinNumber: text(row.vinNumber, ""),
      countryId: text(row.destinationCountryId, "guinea"),
      transportDate: dateInputValue(row.transportDate ?? row.createdAt),
      price: numberString(row.price),
      status: text(row.status, "pending"),
    });
    setMessage("");
    setFormOpen(true);
  }

  async function updateTransportStatus(row: FirestoreRow, status: string) {
    setBusyId(row.id);
    setMessage("");
    try {
      await setDoc(doc(db, "transportRequests", row.id), { businessId, status, updatedAt: serverTimestamp() }, { merge: true });
      setMessage("Transport updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Update failed.");
    } finally {
      setBusyId("");
    }
  }

  async function saveTransport() {
    if (!businessId) throw new Error("Business ID is required.");
    if (!draft.ownerName.trim()) throw new Error("Owner name is required.");
    if (!draft.carMake.trim() || !draft.carModel.trim() || !draft.carYear.trim()) {
      throw new Error("Car make, model, and year are required.");
    }
    const country = countries.find((item) => item.id === draft.countryId);
    if (!country) throw new Error("Select a destination country.");
    const price = Number(draft.price);
    if (!Number.isFinite(price) || price < 0) throw new Error("Enter a valid price.");
    const ref = draft.id ? doc(db, "transportRequests", draft.id) : doc(collection(db, "transportRequests"));
    const transportDate = draft.transportDate ? new Date(`${draft.transportDate}T12:00:00`) : new Date();
    await setDoc(ref, {
      businessId,
      businessName,
      ownerName: draft.ownerName.trim(),
      carMake: draft.carMake.trim(),
      carModel: draft.carModel.trim(),
      carYear: draft.carYear.trim(),
      vinNumber: draft.vinNumber.trim().toUpperCase(),
      destinationCountryId: country.id,
      destinationCountryName: country.name,
      transportDate: Timestamp.fromDate(transportDate),
      price,
      status: draft.status,
      updatedAt: serverTimestamp(),
      ...(draft.id ? {} : { createdAt: serverTimestamp(), trackingCode: `TR-${ref.id.slice(0, 6).toUpperCase()}` }),
    }, { merge: true });
    closeForm();
    setMessage(draft.id ? "Transport updated." : "Transport created.");
  }

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Vehicle transport</h2>
          <p>{transports.rows.length === 0 ? "Schedule and track car transport for your customers." : `${transports.rows.length} request${transports.rows.length === 1 ? "" : "s"}`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy || Boolean(busyId)} message={message} />
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> New transport</button>
        </div>
      </header>

      {transports.error && <div className="error-box">{transports.error}</div>}

      <div className="lst-toolbar">
        <div className="lst-search">
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tracking, owner, car, VIN…" />
        </div>
        <select className="lst-status-select" style={{ flex: "0 0 auto", minWidth: 150 }} value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {transportStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
        </select>
        <button className="lst-btn ghost" type="button" disabled={filteredRows.length === 0} onClick={() => downloadCsv("transport-requests.csv", filteredRows, ["trackingCode", "ownerName", "carMake", "carModel", "carYear", "vinNumber", "destinationCountryName", "price", "transportDate", "status", "updatedAt"])}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {transports.loading && <LoadingState />}
      {!transports.loading && transports.rows.length === 0 && (
        <div className="lst-empty">
          <div className="lst-empty-icon"><Truck size={30} /></div>
          <h3>No transport requests yet</h3>
          <p>Schedule a vehicle transport to get started.</p>
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> New transport</button>
        </div>
      )}
      {!transports.loading && transports.rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No transport requests match this filter." />
      )}

      <div className="pur-grid">
        {filteredRows.map((row) => {
          const status = text(row.status, "pending");
          const busyRow = busyId === row.id;
          return (
            <article className="pur-card" key={row.id}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{transportTitle(row)}</strong>
                  <span className="pur-kind">{text(row.trackingCode, "Transport")}</span>
                </div>
                <span className={`lst-badge ${transportTone(status)}`}>{statusLabel(status)}</span>
              </div>
              <div className="pur-info">
                <div><span>Owner</span><b>{text(row.ownerName ?? row.customerName, "—")}</b></div>
                <div><span>VIN</span><b>{text(row.vinNumber, "—")}</b></div>
                <div><span>Destination</span><b>{text(row.destinationCountryName, "—")}</b></div>
                <div><span>Price</span><b>{formatMoney(row.price)}</b></div>
                <div><span>Transport date</span><b>{formatDate(row.transportDate ?? row.createdAt)}</b></div>
              </div>
              <div className="pur-actions">
                <label className="bar-field"><span>Update status</span>
                  <select value={status} disabled={busyRow} onChange={(event) => updateTransportStatus(row, event.target.value)}>
                    {transportStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
                <button className="lst-btn ghost" type="button" disabled={busyRow} onClick={() => editTransport(row)}><Pencil size={14} /> Edit</button>
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeForm}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{editingId ? "Edit transport" : "New transport"}</h3>
              <button className="lst-icon-btn" type="button" onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Owner name</span>
                  <input value={draft.ownerName} onChange={(event) => setDraft((value) => ({ ...value, ownerName: event.target.value }))} placeholder="Customer name" />
                </label>
                <label className="lst-field"><span>Make</span>
                  <input value={draft.carMake} onChange={(event) => setDraft((value) => ({ ...value, carMake: event.target.value }))} placeholder="Toyota" />
                </label>
                <label className="lst-field"><span>Model</span>
                  <input value={draft.carModel} onChange={(event) => setDraft((value) => ({ ...value, carModel: event.target.value }))} placeholder="Land Cruiser" />
                </label>
                <label className="lst-field"><span>Year</span>
                  <input inputMode="numeric" value={draft.carYear} onChange={(event) => setDraft((value) => ({ ...value, carYear: event.target.value }))} placeholder="2018" />
                </label>
                <label className="lst-field"><span>VIN</span>
                  <input value={draft.vinNumber} onChange={(event) => setDraft((value) => ({ ...value, vinNumber: event.target.value }))} placeholder="17 characters" />
                </label>
                <label className="lst-field"><span>Destination</span>
                  <select value={draft.countryId} onChange={(event) => setDraft((value) => ({ ...value, countryId: event.target.value }))}>
                    {countries.map((country) => (<option key={country.id} value={country.id}>{countryFlag(country.code)} {country.name}</option>))}
                  </select>
                </label>
                <label className="lst-field"><span>Transport date</span>
                  <input type="date" value={draft.transportDate} onChange={(event) => setDraft((value) => ({ ...value, transportDate: event.target.value }))} />
                </label>
                <label className="lst-field"><span>Price (USD)</span>
                  <input inputMode="decimal" value={draft.price} onChange={(event) => setDraft((value) => ({ ...value, price: event.target.value }))} placeholder="1200" />
                </label>
                <label className="lst-field"><span>Status</span>
                  <select value={draft.status} onChange={(event) => setDraft((value) => ({ ...value, status: event.target.value }))}>
                    {transportStatuses.map((status) => (<option key={status} value={status}>{statusLabel(status)}</option>))}
                  </select>
                </label>
              </div>
            </div>
            <footer className="lst-modal-foot">
              <button className="lst-btn ghost" type="button" onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, draft.id ? "Transport updated." : "Transport created.", saveTransport)}>
                <Save size={16} /> {editingId ? "Save changes" : "Create transport"}
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
  businessName = "",
}: PanelProps) {
  const parkedCars = useBusinessRows("parkedCars", businessId, Boolean(businessId), 500);
  const [draft, setDraft] = useState<ParkingDraft>(emptyParkingDraft);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const searched = useMemo(
    () => filterRows(parkedCars.rows, search, ["trackingCode", "ownerName", "carMake", "carModel", "carYear", "vinNumber", "status"]),
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

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Parked cars</h2>
          <p>{parkedCars.rows.length === 0 ? "Log cars you're storing and issue receipts to owners." : `${parkedCars.rows.length} record${parkedCars.rows.length === 1 ? "" : "s"} · ${activeCount} active`}</p>
        </div>
        <div className="lst-head-actions">
          <StatusText busy={busy} message={message} />
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> New parking</button>
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
          <button className="lst-add" type="button" onClick={openNew}><Plus size={17} /> New parking</button>
        </div>
      )}
      {!parkedCars.loading && parkedCars.rows.length > 0 && filteredRows.length === 0 && (
        <EmptyState text="No parking records match this filter." />
      )}

      <div className="pur-grid">
        {filteredRows.map((row) => {
          const status = text(row.status, "active");
          return (
            <article className="pur-card" key={row.id}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{parkingTitle(row)}</strong>
                  <span className="pur-kind">{text(row.trackingCode, "Parking")}</span>
                </div>
                <span className={`lst-badge ${status === "active" ? "warn" : status === "completed" ? "ok" : "muted"}`}>{statusLabel(status)}</span>
              </div>
              <div className="pur-info">
                <div><span>Owner</span><b>{text(row.ownerName, "—")}</b></div>
                <div><span>VIN</span><b>{text(row.vinNumber, "—")}</b></div>
                <div><span>Parked</span><b>{formatDate(row.parkingDate ?? row.createdAt)}</b></div>
                <div><span>Total cost</span><b>{formatMoney(row.totalCost)}</b></div>
                {Boolean(row.parkingEndDate) && <div><span>Ended</span><b>{formatDate(row.parkingEndDate)}</b></div>}
              </div>
              <div className="pur-actions">
                <label className="bar-field"><span>Update status</span>
                  <select value={status} disabled={busy} onChange={(event) => runPanelAction(setBusy, setMessage, "Parking status updated.", () => updateParkingStatus(row, event.target.value))}>
                    {parkingStatuses.map((option) => (<option key={option} value={option}>{statusLabel(option)}</option>))}
                  </select>
                </label>
                <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => editParking(row)}><Pencil size={14} /> Edit</button>
              </div>
            </article>
          );
        })}
      </div>

      {formOpen && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" onClick={closeForm}>
          <div className="lst-modal" style={{ maxWidth: 560 }} onClick={(event) => event.stopPropagation()}>
            <header className="lst-modal-head">
              <h3>{draft.id ? "Edit parking" : "New parking"}</h3>
              <button className="lst-icon-btn" type="button" onClick={closeForm} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              <div className="lst-form-grid">
                <label className="lst-field wide"><span>Owner name</span>
                  <input value={draft.ownerName} onChange={(event) => setDraft((value) => ({ ...value, ownerName: event.target.value }))} placeholder="Customer name" />
                </label>
                <label className="lst-field"><span>Make</span>
                  <input value={draft.carMake} onChange={(event) => setDraft((value) => ({ ...value, carMake: event.target.value }))} placeholder="Toyota" />
                </label>
                <label className="lst-field"><span>Model</span>
                  <input value={draft.carModel} onChange={(event) => setDraft((value) => ({ ...value, carModel: event.target.value }))} placeholder="Camry" />
                </label>
                <label className="lst-field"><span>Year</span>
                  <input inputMode="numeric" value={draft.carYear} onChange={(event) => setDraft((value) => ({ ...value, carYear: event.target.value }))} placeholder="2019" />
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
              <button className="lst-btn ghost" type="button" onClick={closeForm}>Cancel</button>
              <button className="lst-add" type="button" disabled={busy} onClick={() => runPanelAction(setBusy, setMessage, draft.id ? "Parking record updated." : "Parking record created.", saveParking)}>
                <Save size={16} /> {draft.id ? "Save changes" : "Create parking"}
              </button>
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

export function PurchasesPanel({ businessId }: PanelProps) {
  const purchases = useBusinessRows("carPurchases", businessId, Boolean(businessId), 250);
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

  async function runHold(purchaseId: string, label: string, action: () => Promise<unknown>) {
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
                    <button className="lst-btn" type="button" disabled={busy} onClick={() => runHold(row.id, "Hold marked sold.", () => httpsCallable(functions, "markPaidHoldSold")({ purchaseId: row.id }))}>
                      <CheckCircle2 size={15} /> Mark sold
                    </button>
                    {status === "hold_review_required" && (
                      <>
                        <input className="pur-note" value={note} disabled={busy} placeholder="No-show note (optional)" onChange={(event) => setNoteById((values) => ({ ...values, [row.id]: event.target.value }))} />
                        <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={() => runHold(row.id, "Marked no-show.", () => httpsCallable(functions, "markPaidHoldNoShow")({ purchaseId: row.id, note }))}>
                          <XCircle size={15} /> No-show
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <button className="lst-btn" type="button" disabled={busy} onClick={() => runHold(row.id, "Marked completed.", () => finalize(row.id, "completed", note))}>
                      <CheckCircle2 size={15} /> Completed
                    </button>
                    <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={() => runHold(row.id, "Cancelled — deposit refund queued with the platform.", async () => { await finalize(row.id, "cancelled", note); })}>
                      <RotateCcw size={14} /> Cancel &amp; refund
                    </button>
                  </>
                )}
                {row.extensionRequestStatus === "pending" && (
                  <>
                    <button className="lst-btn ghost" type="button" disabled={busy} onClick={() => runHold(row.id, "Extension approved.", () => httpsCallable(functions, "decidePaidHoldExtension")({ purchaseId: row.id, decision: "approved" }))}>
                      <Clock3 size={14} /> Approve extension
                    </button>
                    <button className="lst-btn ghost danger" type="button" disabled={busy} onClick={() => runHold(row.id, "Extension rejected.", () => httpsCallable(functions, "decidePaidHoldExtension")({ purchaseId: row.id, decision: "rejected" }))}>
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
  const country = countries.find((item) => item.id === countryId);
  if (!country) return statusLabel(countryId);
  return currentLanguage() === "fr" ? country.nameFr : country.name;
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
      all: "All",
      approved: "Approved",
      balance_due: "Balance due",
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
      refund_pending: "Refund pending",
      refunded: "Refunded",
      rejected: "Rejected",
      reserved: "Reserved",
      resolved: "Resolved",
      scheduled: "Scheduled",
      sealed: "Sealed",
      sold: "Sold",
      unknown: "Unknown",
      viewing_scheduled: "Viewing scheduled",
      waiting_on_platform: "Waiting on platform",
    },
    fr: {
      active: "Actif",
      all: "Tous",
      approved: "Approuvé",
      balance_due: "Solde dû",
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
      refund_pending: "Remboursement en attente",
      refunded: "Remboursé",
      rejected: "Rejeté",
      reserved: "Réservé",
      resolved: "Résolu",
      scheduled: "Planifié",
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
