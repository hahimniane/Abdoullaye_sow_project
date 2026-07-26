"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  CalendarDays,
  Car,
  ChevronLeft,
  ChevronRight,
  Fuel,
  Gauge,
  Heart,
  MapPin,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  X,
  ZoomIn,
} from "lucide-react";

import {
  bodyTypeOptions,
  conditionOptions,
  drivetrainOptions,
  fuelOptions,
  optionLabel,
  transmissionOptions,
} from "@/components/business/operations-panels";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { ServiceRequestForm } from "@/components/service-request-form";
import { marketplaceDisclosure } from "@/lib/disclosures";
import { db, functions } from "@/lib/firebase";
import { formatMoney, text } from "@/lib/format";
import { isValidPhone } from "@/lib/phone";
import { startCheckout } from "@/lib/use-checkout";
import type { FirestoreRow, UserProfile } from "@/types/admin";

type CustomerCarsProps = {
  firebaseUser?: User | null;
  authenticated?: boolean;
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
  state: {
    rows: FirestoreRow[];
    loading: boolean;
    error: string;
  };
};

type CarAction = "viewing" | "deposit" | "purchase";

type CarSort =
  | "newest"
  | "priceLow"
  | "priceHigh"
  | "yearNew"
  | "yearOld"
  | "mileageLow"
  | "mileageHigh";

type CarFilters = {
  make: string;
  condition: string;
  bodyType: string;
  transmission: string;
  fuelType: string;
  drivetrain: string;
  businessName: string;
  location: string;
  minYear: string;
  maxYear: string;
  minPrice: string;
  maxPrice: string;
  minMileage: string;
  maxMileage: string;
  sort: CarSort;
};

const emptyCarFilters: CarFilters = {
  make: "",
  condition: "",
  bodyType: "",
  transmission: "",
  fuelType: "",
  drivetrain: "",
  businessName: "",
  location: "",
  minYear: "",
  maxYear: "",
  minPrice: "",
  maxPrice: "",
  minMileage: "",
  maxMileage: "",
  sort: "newest",
};

// Same scalar fields used by _CarFilters in
// my_flutter_app/lib/screens/sell_cars_screen.dart, so the count matches
// what a customer would see as "active" on mobile.
function activeFilterCount(filters: CarFilters): number {
  return [
    filters.make,
    filters.condition,
    filters.bodyType,
    filters.transmission,
    filters.fuelType,
    filters.drivetrain,
    filters.businessName,
    filters.location,
    filters.minYear,
    filters.maxYear,
    filters.minPrice,
    filters.maxPrice,
    filters.minMileage,
    filters.maxMileage,
  ].filter((value) => value !== "").length + (filters.sort !== "newest" ? 1 : 0);
}

function uniqueValues(rows: FirestoreRow[], selector: (row: FirestoreRow) => string): string[] {
  const values = new Set<string>();
  for (const row of rows) {
    const value = selector(row).trim();
    if (value) values.add(value);
  }
  return Array.from(values).sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function carYear(car: FirestoreRow): number | null {
  return numberOrNull(text(car.year, ""));
}

function carMileage(car: FirestoreRow): number | null {
  return numberOrNull(text(car.mileage, ""));
}

function carCreatedAtMillis(car: FirestoreRow): number {
  const value = car.createdAt as { toMillis?: () => number } | undefined;
  return typeof value?.toMillis === "function" ? value.toMillis() : 0;
}

export function CustomerCars({
  firebaseUser,
  authenticated = true,
  onAuthenticationRequired,
  profile,
  state,
}: CustomerCarsProps) {
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<CarFilters>(emptyCarFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedCar, setSelectedCar] = useState<FirestoreRow | null>(null);
  const [action, setAction] = useState<CarAction | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favoritePending, setFavoritePending] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseUser) {
      setFavorites(new Set());
      return undefined;
    }
    return onSnapshot(
        collection(db, "users", firebaseUser.uid, "favoriteCars"),
        (snapshot) => setFavorites(new Set(snapshot.docs.map((item) => item.id))),
        () => setError("Favorites could not be loaded."),
      );
  }, [firebaseUser]);

  const makeOptions = useMemo(() => uniqueValues(state.rows, (car) => text(car.make, "")), [state.rows]);
  const businessOptions = useMemo(
    () => uniqueValues(state.rows, (car) => text(car.businessName, "")),
    [state.rows],
  );
  const locationOptions = useMemo(() => uniqueValues(state.rows, carLocation), [state.rows]);

  const filteredCars = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const minYear = numberOrNull(filters.minYear);
    const maxYear = numberOrNull(filters.maxYear);
    const minPrice = numberOrNull(filters.minPrice);
    const maxPrice = numberOrNull(filters.maxPrice);
    const minMileage = numberOrNull(filters.minMileage);
    const maxMileage = numberOrNull(filters.maxMileage);

    const rows = state.rows.filter((car) => {
      const matchesSearch =
        !needle ||
        [
          car.title,
          car.make,
          car.model,
          car.year,
          car.businessName,
          car.location,
          car.locationCity,
          car.locationState,
        ].some((value) => text(value, "").toLowerCase().includes(needle));
      if (!matchesSearch) return false;

      if (filters.make && text(car.make, "") !== filters.make) return false;
      if (filters.condition && text(car.condition, "") !== filters.condition) return false;
      if (filters.bodyType && text(car.bodyType, "") !== filters.bodyType) return false;
      if (filters.transmission && text(car.transmission, "") !== filters.transmission) return false;
      if (filters.fuelType && text(car.fuelType, "") !== filters.fuelType) return false;
      if (filters.drivetrain && text(car.drivetrain, "") !== filters.drivetrain) return false;
      if (filters.businessName && text(car.businessName, "") !== filters.businessName) return false;
      if (filters.location && carLocation(car) !== filters.location) return false;

      const year = carYear(car);
      if (minYear !== null && (year === null || year < minYear)) return false;
      if (maxYear !== null && (year === null || year > maxYear)) return false;

      const price = numberOrNull(String(car.price ?? "")) ?? 0;
      if (minPrice !== null && price < minPrice) return false;
      if (maxPrice !== null && price > maxPrice) return false;

      const mileage = carMileage(car);
      if (minMileage !== null && (mileage === null || mileage < minMileage)) return false;
      if (maxMileage !== null && (mileage === null || mileage > maxMileage)) return false;

      return true;
    });

    const sorted = [...rows].sort((a, b) => {
      switch (filters.sort) {
        case "priceLow":
          return (numberOrNull(String(a.price ?? "")) ?? 0) - (numberOrNull(String(b.price ?? "")) ?? 0);
        case "priceHigh":
          return (numberOrNull(String(b.price ?? "")) ?? 0) - (numberOrNull(String(a.price ?? "")) ?? 0);
        case "mileageLow":
          return (carMileage(a) ?? Number.MAX_SAFE_INTEGER) - (carMileage(b) ?? Number.MAX_SAFE_INTEGER);
        case "mileageHigh":
          return (carMileage(b) ?? -1) - (carMileage(a) ?? -1);
        case "yearNew":
          return (carYear(b) ?? 0) - (carYear(a) ?? 0);
        case "yearOld":
          return (carYear(a) ?? 0) - (carYear(b) ?? 0);
        case "newest":
        default:
          return carCreatedAtMillis(b) - carCreatedAtMillis(a);
      }
    });
    return sorted;
  }, [search, state.rows, filters]);

  useEffect(() => {
    if (
      selectedCar &&
      !state.rows.some((car) => car.id === selectedCar.id)
    ) {
      setSelectedCar(null);
      setAction(null);
      setError(
        "That car listing is no longer available. Choose another listing.",
      );
    }
  }, [selectedCar, state.rows]);

  async function toggleFavorite(car: FirestoreRow) {
    if (favoritePending) return;
    if (!firebaseUser || !authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setFavoritePending(car.id);
    setError("");
    const favoriteRef = doc(
      db,
      "users",
      firebaseUser.uid,
      "favoriteCars",
      car.id,
    );
    try {
      if (favorites.has(car.id)) {
        await deleteDoc(favoriteRef);
      } else {
        await setDoc(favoriteRef, {
          carId: car.id,
          createdAt: serverTimestamp(),
        });
      }
    } catch {
      setError("The favorite could not be updated. Try again.");
    } finally {
      setFavoritePending("");
    }
  }

  const filterCount = activeFilterCount(filters);
  const filtersActive = filterCount > 0;

  if (selectedCar) {
    return (
      <CarDetailPage
        action={action}
        authenticated={authenticated}
        car={selectedCar}
        onAction={setAction}
        onAuthenticationRequired={onAuthenticationRequired}
        onBack={() => {
          setSelectedCar(null);
          setAction(null);
        }}
        profile={profile}
      />
    );
  }

  return (
    <section className="panel">
      <div className="panel-header customer-cars-header">
        <div>
          <Car size={18} />
          <h2>Browse cars</h2>
        </div>
        <span className="status-pill compact">{filteredCars.length} listings</span>
      </div>
      <div className="customer-car-toolbar">
        <label className="customer-car-search">
          <span>Search car listings</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Make, model, year, business, or location"
            type="search"
            value={search}
          />
        </label>
        <label className="customer-car-sort">
          <span>Sort by</span>
          <select
            value={filters.sort}
            onChange={(event) =>
              setFilters((current) => ({ ...current, sort: event.target.value as CarSort }))
            }
          >
            <option value="newest">Newest</option>
            <option value="priceLow">Price: low to high</option>
            <option value="priceHigh">Price: high to low</option>
            <option value="yearNew">Year: newest first</option>
            <option value="yearOld">Year: oldest first</option>
            <option value="mileageLow">Mileage: low to high</option>
            <option value="mileageHigh">Mileage: high to low</option>
          </select>
        </label>
        <button
          className={`secondary-button customer-filter-toggle ${filtersActive ? "active" : ""}`}
          onClick={() => setShowFilters((value) => !value)}
          type="button"
        >
          <SlidersHorizontal size={16} />
          {filtersActive ? `Filters (${filterCount})` : "Filters"}
        </button>
      </div>
      {showFilters && (
        <div className="customer-car-filters">
          <div className="customer-car-filters-grid">
            <label>
              <span>Make</span>
              <select
                value={filters.make}
                onChange={(event) => setFilters((current) => ({ ...current, make: event.target.value }))}
              >
                <option value="">Any make</option>
                {makeOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
              </select>
            </label>
            <label>
              <span>Condition</span>
              <select
                value={filters.condition}
                onChange={(event) => setFilters((current) => ({ ...current, condition: event.target.value }))}
              >
                <option value="">Any condition</option>
                {conditionOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
              </select>
            </label>
            <label>
              <span>Body type</span>
              <select
                value={filters.bodyType}
                onChange={(event) => setFilters((current) => ({ ...current, bodyType: event.target.value }))}
              >
                <option value="">Any body type</option>
                {bodyTypeOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
              </select>
            </label>
            <label>
              <span>Transmission</span>
              <select
                value={filters.transmission}
                onChange={(event) => setFilters((current) => ({ ...current, transmission: event.target.value }))}
              >
                <option value="">Any transmission</option>
                {transmissionOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
              </select>
            </label>
            <label>
              <span>Fuel type</span>
              <select
                value={filters.fuelType}
                onChange={(event) => setFilters((current) => ({ ...current, fuelType: event.target.value }))}
              >
                <option value="">Any fuel type</option>
                {fuelOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
              </select>
            </label>
            <label>
              <span>Drivetrain</span>
              <select
                value={filters.drivetrain}
                onChange={(event) => setFilters((current) => ({ ...current, drivetrain: event.target.value }))}
              >
                <option value="">Any drivetrain</option>
                {drivetrainOptions.map((option) => (<option key={option} value={option}>{optionLabel(option)}</option>))}
              </select>
            </label>
            <label>
              <span>Business</span>
              <select
                value={filters.businessName}
                onChange={(event) => setFilters((current) => ({ ...current, businessName: event.target.value }))}
              >
                <option value="">Any business</option>
                {businessOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
              </select>
            </label>
            <label>
              <span>Location</span>
              <select
                value={filters.location}
                onChange={(event) => setFilters((current) => ({ ...current, location: event.target.value }))}
              >
                <option value="">Any location</option>
                {locationOptions.map((option) => (<option key={option} value={option}>{option}</option>))}
              </select>
            </label>
            <label className="customer-car-filter-range">
              <span>Year</span>
              <div>
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, minYear: event.target.value }))}
                  placeholder="Min"
                  value={filters.minYear}
                />
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, maxYear: event.target.value }))}
                  placeholder="Max"
                  value={filters.maxYear}
                />
              </div>
            </label>
            <label className="customer-car-filter-range">
              <span>Price</span>
              <div>
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
                  placeholder="Min $"
                  value={filters.minPrice}
                />
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
                  placeholder="Max $"
                  value={filters.maxPrice}
                />
              </div>
            </label>
            <label className="customer-car-filter-range">
              <span>Mileage</span>
              <div>
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, minMileage: event.target.value }))}
                  placeholder="Min"
                  value={filters.minMileage}
                />
                <input
                  inputMode="numeric"
                  onChange={(event) => setFilters((current) => ({ ...current, maxMileage: event.target.value }))}
                  placeholder="Max"
                  value={filters.maxMileage}
                />
              </div>
            </label>
          </div>
          {filtersActive && (
            <button
              className="link-button"
              onClick={() => setFilters(emptyCarFilters)}
              type="button"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}
      {(state.error || error) && (
        <div className="error-box">
          {state.error ? "Car listings could not be loaded." : error}
        </div>
      )}
      {state.loading && <div className="empty-state">Loading car listings...</div>}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <div className="empty-state">
          No active car listings are available right now.
        </div>
      )}
      {!state.loading && state.rows.length > 0 && filteredCars.length === 0 && (
        <div className="empty-state">No cars match your search and filters.</div>
      )}
      <div className="customer-car-grid">
        {filteredCars.map((car) => {
          const imageUrl = carImage(car);
          const favorite = favorites.has(car.id);
          const mileage = text(car.mileage, "");
          const transmission = text(car.transmission, "");
          const fuelType = text(car.fuelType, "");
          return (
            <article className="customer-car-card" key={car.id}>
              <div className="customer-car-photo">
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt={carTitle(car)} src={imageUrl} />
                ) : (
                  <div className="listing-photo-placeholder">
                    <Car size={28} />
                  </div>
                )}
                {car.condition ? (
                  <span className="customer-car-badge">{optionLabel(text(car.condition, ""))}</span>
                ) : null}
                <button
                  aria-label={
                    favorite ? "Remove car from favorites" : "Add car to favorites"
                  }
                  aria-pressed={favorite}
                  className={`customer-favorite ${favorite ? "active" : ""}`}
                  data-loading={favoritePending === car.id}
                  disabled={Boolean(favoritePending)}
                  onClick={() => void toggleFavorite(car)}
                  type="button"
                >
                  <Heart fill={favorite ? "currentColor" : "none"} size={18} />
                </button>
                <div className="customer-car-photo-price">{formatMoney(car.price)}</div>
              </div>
              <div className="customer-car-card-body">
                <div>
                  <h3>{carTitle(car)}</h3>
                  <p>
                    <MapPin size={14} />
                    {carLocation(car)}
                  </p>
                </div>
                <div className="customer-car-chip-row">
                  {mileage && (
                    <span className="customer-car-chip">
                      <Gauge size={13} /> {mileage} mi
                    </span>
                  )}
                  {transmission && (
                    <span className="customer-car-chip">
                      <Settings2 size={13} /> {optionLabel(transmission)}
                    </span>
                  )}
                  {fuelType && (
                    <span className="customer-car-chip">
                      <Fuel size={13} /> {optionLabel(fuelType)}
                    </span>
                  )}
                </div>
                <p className="customer-car-business">{text(car.businessName, "Approved business")}</p>
                <button
                  className="secondary-button"
                  onClick={() => {
                    setSelectedCar(car);
                    setAction(null);
                  }}
                  type="button"
                >
                  View details
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

// Full-page layout (gallery + specs on the left, a sticky price/action card
// on the right) instead of a side drawer - this is the layout every major
// vehicle marketplace (AutoTrader, Cars.com, Turo, Facebook Marketplace) uses
// for listings, because a photo-heavy detail view needs real width to avoid
// feeling cramped or, if forced wider, ending up as an edge-to-edge overlay.
function CarDetailPage({
  action,
  authenticated,
  car,
  onAction,
  onAuthenticationRequired,
  onBack,
  profile,
}: {
  action: CarAction | null;
  authenticated: boolean;
  car: FirestoreRow;
  onAction: (action: CarAction | null) => void;
  onAuthenticationRequired?: () => void;
  onBack: () => void;
  profile: UserProfile;
}) {
  const images = useMemo(() => carImages(car), [car]);
  const [activeImage, setActiveImage] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => setActiveImage(0), [car.id]);

  return (
    <section className="panel customer-car-detail-page">
      <button className="link-button customer-car-back" onClick={onBack} type="button">
        <ChevronLeft size={16} /> Back to listings
      </button>
      {action ? (
        <div className="customer-car-detail-form">
          <h2>{carTitle(car)}</h2>
          <CarActionForm
            action={action}
            authenticated={authenticated}
            car={car}
            onCancel={() => onAction(null)}
            onComplete={onBack}
            onAuthenticationRequired={onAuthenticationRequired}
            profile={profile}
          />
        </div>
      ) : (
        <div className="customer-car-detail-grid">
          <div className="customer-car-detail-main">
            <div className="customer-car-gallery">
              {images.length > 0 ? (
                <button
                  aria-label="Zoom in on photo"
                  className="customer-car-photo-frame"
                  onClick={() => setZoomed(true)}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={carTitle(car)}
                    className="customer-car-detail-image"
                    src={images[activeImage]}
                  />
                  <span className="customer-car-zoom-hint">
                    <ZoomIn size={13} /> Zoom in
                  </span>
                </button>
              ) : (
                <div className="listing-photo-placeholder customer-car-detail-image">
                  <Car size={36} />
                </div>
              )}
              {images.length > 1 && (
                <div className="customer-car-gallery-thumbs">
                  {images.map((url, index) => (
                    <button
                      aria-label={`Show photo ${index + 1}`}
                      className={`customer-car-thumb ${index === activeImage ? "active" : ""}`}
                      key={url}
                      onClick={() => setActiveImage(index)}
                      type="button"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="" src={url} />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="customer-car-fact-grid">
              <FactTile icon={MapPin} label="Location" value={carLocation(car)} />
              <FactTile icon={CalendarDays} label="Year" value={text(car.year, "Not provided")} />
              <FactTile icon={Gauge} label="Mileage" value={text(car.mileage, "Not provided")} />
              <FactTile icon={Car} label="Body type" value={optionLabelOrFallback(car.bodyType)} />
              <FactTile icon={Fuel} label="Fuel" value={optionLabelOrFallback(car.fuelType)} />
              <FactTile icon={Settings2} label="Transmission" value={optionLabelOrFallback(car.transmission)} />
              <FactTile icon={ShieldCheck} label="Condition" value={optionLabelOrFallback(car.condition)} />
              <FactTile icon={ShieldCheck} label="Rebuilt title" value={rebuiltTitle(car.isRebuiltTitle)} />
            </div>
            {text(car.description, "") && (
              <p className="customer-car-description">{text(car.description)}</p>
            )}
          </div>
          <aside className="customer-car-detail-side">
            <h2>{carTitle(car)}</h2>
            <p className="customer-car-business-line">
              Sold by <strong>{text(car.businessName, "Approved business")}</strong>
            </p>
            <div className="customer-car-detail-price-row">
              <strong className="customer-car-detail-price">{formatMoney(car.price)}</strong>
              {car.isRebuiltTitle === false && (
                <span className="customer-car-chip good">
                  <ShieldCheck size={13} /> Clean title
                </span>
              )}
            </div>
            <div className="customer-car-actions">
              <button
                className="primary-button"
                onClick={() => onAction("purchase")}
                type="button"
              >
                Buy this car
              </button>
              <button
                className="secondary-button"
                onClick={() => onAction("deposit")}
                type="button"
              >
                Reserve with a deposit
              </button>
              <button
                className="secondary-button"
                onClick={() => onAction("viewing")}
                type="button"
              >
                <CalendarDays size={16} /> Reserve a viewing
              </button>
            </div>
          </aside>
        </div>
      )}
      {zoomed && images.length > 0 && (
        <CarPhotoLightbox
          images={images}
          index={activeImage}
          onClose={() => setZoomed(false)}
          onIndexChange={setActiveImage}
        />
      )}
    </section>
  );
}

function CarPhotoLightbox({
  images,
  index,
  onClose,
  onIndexChange,
}: {
  images: string[];
  index: number;
  onClose: () => void;
  onIndexChange: (index: number) => void;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onIndexChange((index - 1 + images.length) % images.length);
      if (event.key === "ArrowRight") onIndexChange((index + 1) % images.length);
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [images.length, index, onClose, onIndexChange]);

  return (
    <div
      className="customer-car-lightbox"
      onClick={onClose}
      role="presentation"
    >
      {images.length > 1 && (
        <button
          aria-label="Previous photo"
          className="customer-car-lightbox-nav prev"
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange((index - 1 + images.length) % images.length);
          }}
          type="button"
        >
          <ChevronLeft size={26} />
        </button>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        className="customer-car-lightbox-image"
        onClick={(event) => event.stopPropagation()}
        src={images[index]}
      />
      {images.length > 1 && (
        <button
          aria-label="Next photo"
          className="customer-car-lightbox-nav next"
          onClick={(event) => {
            event.stopPropagation();
            onIndexChange((index + 1) % images.length);
          }}
          type="button"
        >
          <ChevronRight size={26} />
        </button>
      )}
      <button
        aria-label="Close zoomed photo"
        className="customer-car-lightbox-close"
        onClick={onClose}
        type="button"
      >
        <X size={20} />
      </button>
    </div>
  );
}

function CarActionForm({
  action,
  authenticated,
  car,
  onCancel,
  onComplete,
  onAuthenticationRequired,
  profile,
}: {
  action: CarAction;
  authenticated: boolean;
  car: FirestoreRow;
  onCancel: () => void;
  onComplete: () => void;
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
}) {
  const [buyerName, setBuyerName] = useState(text(profile.fullName, ""));
  const [buyerPhone, setBuyerPhone] = useState(text(profile.phone, ""));
  const [appointmentStart, setAppointmentStart] = useState("");
  const [holdUntilDate, setHoldUntilDate] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const paid = action !== "viewing";
  const valid =
    buyerName.trim().length > 0 &&
    isValidPhone(buyerPhone) &&
    (action !== "viewing" || Boolean(appointmentStart)) &&
    (action !== "deposit" || Boolean(holdUntilDate)) &&
    (!paid || accepted);

  async function submit() {
    if (!valid || submitting) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (action === "viewing") {
        await httpsCallable(functions, "createCarViewingReservation")({
          carId: car.id,
          buyerName: buyerName.trim(),
          buyerPhone: buyerPhone.trim(),
          appointmentStart: new Date(appointmentStart).toISOString(),
          appointmentLabel: new Date(appointmentStart).toLocaleString(),
        });
        onComplete();
        return;
      }
      const payload = {
        carId: car.id,
        buyerName: buyerName.trim(),
        buyerPhone: buyerPhone.trim(),
        marketplaceDisclosure: marketplaceDisclosure(accepted),
        ...(action === "deposit" && {
          holdUntilDate: new Date(`${holdUntilDate}T12:00:00`).toISOString(),
        }),
      };
      await startCheckout(
        action === "deposit" ? "carDeposit" : "carPurchase",
        payload,
      );
    } catch {
      setError("The request could not be completed. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ServiceRequestForm
      canReview={valid}
      error={error}
      intro={
        action === "viewing"
          ? "Choose a time to visit the approved business."
          : "Review your contact details before secure payment."
      }
      onCancel={onCancel}
      onSubmit={submit}
      review={
        <div className="stack">
          <Detail label="Car" value={carTitle(car)} />
          <Detail label="Name" value={buyerName} />
          <Detail label="Phone" value={buyerPhone} />
          {action === "viewing" && (
            <Detail
              label="Appointment"
              value={new Date(appointmentStart).toLocaleString()}
            />
          )}
          {action === "deposit" && (
            <Detail label="Hold until" value={holdUntilDate} />
          )}
          {paid && (
            <DisclosureCheckbox
              accepted={accepted}
              onChange={setAccepted}
            />
          )}
        </div>
      }
      submitLabel={
        !authenticated
          ? "Sign in to save & continue"
          : action === "viewing"
            ? "Reserve viewing"
            : action === "deposit"
              ? "Continue to deposit"
              : "Continue to purchase"
      }
      submitting={submitting}
      title={
        action === "viewing"
          ? "Reserve a viewing"
          : action === "deposit"
            ? "Reserve with a deposit"
            : "Buy this car"
      }
    >
      <div className="customer-form-grid">
        <label>
          Full name
          <input
            autoComplete="name"
            onChange={(event) => setBuyerName(event.target.value)}
            required
            value={buyerName}
          />
        </label>
        <CustomerPhoneField
          label="Phone number"
          onChange={setBuyerPhone}
          required
          value={buyerPhone}
        />
        {action === "viewing" && (
          <label>
            Appointment time
            <input
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) => setAppointmentStart(event.target.value)}
              required
              type="datetime-local"
              value={appointmentStart}
            />
          </label>
        )}
        {action === "deposit" && (
          <label>
            Hold until
            <input
              min={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setHoldUntilDate(event.target.value)}
              required
              type="date"
              value={holdUntilDate}
            />
          </label>
        )}
        {paid && (
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        )}
      </div>
    </ServiceRequestForm>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FactTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
}) {
  return (
    <div className="customer-car-fact-tile">
      <Icon size={16} />
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </div>
  );
}

function optionLabelOrFallback(value: unknown) {
  const label = optionLabel(text(value, ""));
  return label || "Not provided";
}

function carImage(car: FirestoreRow) {
  const images = Array.isArray(car.imageUrls) ? car.imageUrls : [];
  return text(car.imageUrl ?? images[0], "");
}

function carImages(car: FirestoreRow): string[] {
  const images = Array.isArray(car.imageUrls) ? car.imageUrls : [];
  const urls = new Set<string>();
  const primary = text(car.imageUrl, "");
  if (primary) urls.add(primary);
  for (const value of images) {
    const url = text(value, "");
    if (url) urls.add(url);
  }
  return Array.from(urls);
}

function carTitle(car: FirestoreRow) {
  return text(
    car.title ??
      `${text(car.year, "")} ${text(car.make, "Car")} ${text(car.model, "")}`,
  ).trim();
}

function carLocation(car: FirestoreRow) {
  return (
    [
      car.locationCity,
      car.locationState,
      car.locationCountry,
    ].map((value) => text(value, "")).filter(Boolean).join(", ") ||
    text(car.location, "Location not provided")
  );
}

function rebuiltTitle(value: unknown) {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "Not provided";
}
