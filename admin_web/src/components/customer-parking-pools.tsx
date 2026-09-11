"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  CalendarDays,
  CarFront,
  CheckCircle2,
  MapPin,
  PackageOpen,
  Search,
  ShieldCheck,
  Users,
} from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { PaymentHoldNotice } from "@/components/payment-hold-notice";
import { SearchableSelect } from "@/components/searchable-select";
import { ServiceRequestForm } from "@/components/service-request-form";
import { marketplaceDisclosure } from "@/lib/disclosures";
import { useSharedBarrelsEnabled } from "@/lib/feature-flags";
import { db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import { isValidPhone } from "@/lib/phone";
import {
  SERVICE_SORT_LABELS,
  defaultSortForService,
  shouldOfferServiceSort,
  sortServiceOptions,
  sortsForService,
  type ServiceSort,
} from "@/lib/service-ranking.ts";
import { startCheckout } from "@/lib/use-checkout";
import type { FirestoreRow, UserProfile } from "@/types/admin";

const ACTION_TIMEOUT_MS = 30_000;
const SNAPSHOT_TIMEOUT_MS = 15_000;

// Firebase callable failures carry the exact reason the backend rejected the
// request (e.g. "Verify your phone number before using shared barrels").
// Falling back to a generic string here would hide that from the user.
function checkoutErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message || fallback;
}

type CustomerParkingPoolsProps = {
  firebaseUser?: User | null;
  authenticated?: boolean;
  initialArea?: "parking" | "pools";
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
};

type ParkingOption = {
  businessId: string;
  businessName: string;
  city: string;
  /** So a customer can pick a state, then a town that is actually in it. */
  state: string;
  address: string;
  /** False while browsing: the total is one day at the lot's rate, not a
   *  quote for dates the customer chose. */
  quotedForDates: boolean;
  availableSpaces: number;
  estimatedTotal: number;
  reviewWeightedScore: number;
  dailyRate: number;
  weeklyRate: number;
  monthlyRate: number;
  pickupAvailable: boolean;
  pickupFee: number;
  distanceMiles: number | null;
  instructions: string;
  /** A walk-in-only lot: listed and contactable, but no online reservation. */
  acceptsReservations: boolean;
};

type DestinationOption = {
  id: string;
  businessId: string;
  businessName: string;
  businessAddress: string;
  enabledServices: string[];
  country: {
    id: string;
    name: string;
    code: string;
    barrelShippingPrice: number;
    serviceAvailability?: {
      barrelShipping?: boolean;
    };
  };
};

type PoolAction =
  | { kind: "create" }
  | { kind: "join"; pool: FirestoreRow }
  | { kind: "balance"; pool: FirestoreRow };

export function CustomerParkingPools({
  firebaseUser,
  authenticated = true,
  initialArea = "parking",
  onAuthenticationRequired,
  profile,
}: CustomerParkingPoolsProps) {
  const sharedBarrelsEnabled = useSharedBarrelsEnabled();
  const [area, setArea] = useState<"parking" | "pools">(initialArea);
  const effectiveArea = sharedBarrelsEnabled ? area : "parking";

  return (
    <section className="customer-service-hub">
      <div className="customer-service-hero">
        <div>
          <span className="customer-eyebrow">Vehicle & shipping services</span>
          <h2>Plan the next step with confidence</h2>
          <p>
            Compare live availability, review the provider, and pay securely
            without leaving your Laawol account.
          </p>
        </div>
        <ShieldCheck aria-hidden="true" size={32} />
      </div>
      {sharedBarrelsEnabled && (
        <div className="customer-service-tabs" aria-label="Choose a service">
          <button
            aria-pressed={effectiveArea === "parking"}
            className={effectiveArea === "parking" ? "active" : ""}
            onClick={() => setArea("parking")}
            type="button"
          >
            <CarFront size={17} /> Parking
          </button>
          <button
            aria-pressed={effectiveArea === "pools"}
            className={effectiveArea === "pools" ? "active" : ""}
            onClick={() => setArea("pools")}
            type="button"
          >
            <PackageOpen size={17} /> Shared barrels
          </button>
        </div>
      )}
      {effectiveArea === "parking" ? (
        <ParkingWorkspace
          authenticated={authenticated}
          onAuthenticationRequired={onAuthenticationRequired}
          profile={profile}
        />
      ) : (
        <PoolWorkspace
          authenticated={authenticated}
          firebaseUser={firebaseUser}
          onAuthenticationRequired={onAuthenticationRequired}
          profile={profile}
        />
      )}
    </section>
  );
}

function ParkingWorkspace({
  authenticated,
  onAuthenticationRequired,
  profile,
}: {
  authenticated: boolean;
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  // Every lot there is, loaded before the customer names anywhere. The state
  // and town pickers are built from it, so they only ever offer places that
  // actually have a lot - the free-text box let someone type "Bronx" and get
  // nothing while a lot in New York City sat a mile away.
  const [allPlaces, setAllPlaces] = useState<ParkingOption[]>([]);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(tomorrow);
  const [pickupRequested, setPickupRequested] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [options, setOptions] = useState<ParkingOption[]>([]);
  const [selected, setSelected] = useState<ParkingOption | null>(null);
  const [sort, setSort] = useState<ServiceSort>(
    defaultSortForService("carParking") as ServiceSort,
  );
  // Ranked on the total the search already priced for these dates, which
  // accounts for the minimum stay and whichever rate applies.
  const sortedOptions = useMemo(
    () => sortServiceOptions(options, { service: "carParking", sort }),
    [options, sort],
  );

  const validSearch =
    Boolean(startDate) &&
    Boolean(endDate) &&
    new Date(endDate).getTime() >= new Date(startDate).getTime();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await withTimeout(
          httpsCallable<Record<string, never>, { options?: unknown[] }>(
            functions,
            authenticated ? "listParkingOptions" : "listPublicParkingOptions",
          )({}),
        );
        if (cancelled) return;
        setAllPlaces(
          (Array.isArray(response.data.options) ? response.data.options : [])
            .map(parkingOptionFromData),
        );
      } catch {
        // Nothing to browse; the search still works.
      }
    })();
    return () => { cancelled = true; };
  }, [authenticated]);

  const browseStates = useMemo(
    () => [...new Set(allPlaces.map((p) => p.state.trim()).filter(Boolean))].sort(),
    [allPlaces],
  );
  const browseCities = useMemo(
    () => [...new Set(allPlaces
      .filter((p) => !state || p.state.trim() === state)
      .map((p) => p.city.trim())
      .filter(Boolean))].sort(),
    [allPlaces, state],
  );
  const browsedPlaces = useMemo(
    () => allPlaces.filter((p) =>
      (!state || p.state.trim() === state) && (!city || p.city.trim() === city)),
    [allPlaces, state, city],
  );

  async function searchParking(
    narrow?: { city: string; state: string },
  ): Promise<ParkingOption[]> {
    if (!validSearch || loading) return [];
    const searchCity = narrow ? narrow.city : city;
    const searchState = narrow ? narrow.state : state;
    setLoading(true);
    setError("");
    setSearched(true);
    setSelected(null);
    try {
      const response = await withTimeout(
        httpsCallable<
          {
            city?: string;
            state?: string;
            startDate: string;
            endDate: string;
            pickupRequested: boolean;
          },
          { options?: unknown[] }
        >(
          functions,
          authenticated
            ? "listParkingOptions"
            : "listPublicParkingOptions",
        )({
          // Each only narrows when it was chosen. Nothing chosen is "every
          // lot with room for these dates".
          ...(searchCity.trim() ? {city: searchCity.trim()} : {}),
          ...(searchState.trim() ? {state: searchState.trim()} : {}),
          startDate: localDateToIso(startDate, 9),
          endDate: localDateToIso(endDate, 17),
          pickupRequested,
        }),
      );
      const found = (Array.isArray(response.data.options) ? response.data.options : [])
        .map(parkingOptionFromData)
        .filter((option) => option.availableSpaces > 0);
      setOptions(found);
      return found;
    } catch {
      setOptions([]);
      setError("Parking options could not be loaded. Try again.");
      return [];
    } finally {
      setLoading(false);
    }
  }

  // Tapping a lot in the list picks that lot. It is priced for the dates on
  // the form first - a browsing row only knows one day at the lot's rate, and
  // the reservation must be quoted on the real window. If the lot has no room
  // for those dates, the customer sees the results for that town instead of
  // being dropped into a booking that cannot happen.
  async function chooseBrowsedPlace(place: ParkingOption) {
    const placeCity = place.city.trim();
    const placeState = place.state.trim();
    setState(placeState);
    setCity(placeCity);
    const found = await searchParking({ city: placeCity, state: placeState });
    const match = found.find((option) => option.businessId === place.businessId);
    if (match) setSelected(match);
  }

  return (
    <div className="customer-service-stack">
      <section className="panel customer-service-search">
        <div className="panel-header">
          <div>
            <h2>Find secure parking</h2>
            <p>Search approved providers for your exact parking dates.</p>
          </div>
          <CalendarDays aria-hidden="true" size={20} />
        </div>
        <div className="customer-parking-search-grid">
          {browseStates.length > 0 && (
            <label>
              State
              <select
                onChange={(event) => { setState(event.target.value); setCity(""); setSearched(false); }}
                value={state}
              >
                <option value="">Any state</option>
                {browseStates.map((name) => (<option key={name} value={name}>{name}</option>))}
              </select>
            </label>
          )}
          <label>
            City
            <select
              onChange={(event) => { setCity(event.target.value); setSearched(false); }}
              value={city}
            >
              <option value="">Any city</option>
              {browseCities.map((name) => (<option key={name} value={name}>{name}</option>))}
            </select>
          </label>
          <label>
            Start date
            <input
              min={today}
              onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                if (endDate < value) setEndDate(value);
              }}
              type="date"
              value={startDate}
            />
          </label>
          <label>
            End date
            <input
              min={startDate || today}
              onChange={(event) => setEndDate(event.target.value)}
              type="date"
              value={endDate}
            />
          </label>
          <label className="customer-choice-row">
            <input
              checked={pickupRequested}
              onChange={(event) => setPickupRequested(event.target.checked)}
              type="checkbox"
            />
            I need vehicle pickup
          </label>
          <button
            aria-busy={loading}
            className="primary-button customer-search-button"
            data-loading={loading}
            disabled={!validSearch || loading}
            onClick={() => void searchParking()}
            type="button"
          >
            <Search size={16} />
            {loading ? "Searching parking..." : "Search parking"}
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
      </section>

      {!searched && browsedPlaces.length > 0 && (
        <section aria-label="Places to park" className="customer-browse-list">
          <h3>{browsedPlaces.length} {browsedPlaces.length === 1 ? "place" : "places"} to park</h3>
          {browsedPlaces.map((place) => (
            <button
              className="customer-browse-row"
              key={place.businessId}
              aria-label={`Choose ${place.businessName}`}
              disabled={loading}
              onClick={() => void chooseBrowsedPlace(place)}
              type="button"
            >
              <span>
                <strong>{place.businessName}</strong>
                <small>{[place.city, place.state].map((part) => part.trim()).filter(Boolean).join(", ")}</small>
              </span>
              <span className="customer-browse-meta">
                <strong>{formatMoney(place.dailyRate)}/day</strong>
                {/* Distance only when the customer shared where they are;
                    an invented number is worse than none. */}
                {place.distanceMiles !== null
                  ? <small>{place.distanceMiles.toFixed(place.distanceMiles < 10 ? 1 : 0)} mi away</small>
                  : place.availableSpaces > 0 ? <small>{place.availableSpaces} free today</small> : <small>Full today</small>}
              </span>
            </button>
          ))}
        </section>
      )}

      {!loading && searched && !error && options.length === 0 && (
        <div className="empty-state customer-service-empty">
          <MapPin aria-hidden="true" size={23} />
          <strong>No parking is available for these dates.</strong>
          <span>Try other dates, or clear the city to see every lot.</span>
        </div>
      )}

      {options.length > 0 && shouldOfferServiceSort(options, "carParking") && (
        <div
          aria-label="Order businesses by"
          className="service-segments service-sort-segments"
          role="tablist"
        >
          {/* Spans rather than buttons: choosing an order changes what you are
              looking at, not what gets saved. */}
          {sortsForService("carParking").map((option) => (
            <span
              aria-selected={sort === option}
              className={`segment ${sort === option ? "active" : ""}`}
              key={option}
              onClick={() => setSort(option)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setSort(option);
              }}
              role="tab"
              tabIndex={0}
            >
              {SERVICE_SORT_LABELS[option]}
            </span>
          ))}
        </div>
      )}

      {options.length > 0 && (
        <section aria-label="Available parking" className="customer-option-grid">
          {sortedOptions.map((option) => (
            <article className="customer-option-card" key={option.businessId}>
              <div className="customer-option-card-head">
                <div className="customer-option-icon">
                  <CarFront aria-hidden="true" size={20} />
                </div>
                <div>
                  <h3>{option.businessName}</h3>
                  <p>
                    <MapPin size={13} />
                    {[option.address || option.city, option.state].map((part) => part.trim()).filter(Boolean).join(", ")}
                  </p>
                </div>
                <span className="status-pill compact">
                  {option.availableSpaces} spaces
                </span>
              </div>
              <div className="customer-price-line">
                <div>
                  <span>Estimated total</span>
                  <strong>{formatMoney(option.estimatedTotal)}</strong>
                </div>
                {option.distanceMiles !== null && (
                  <span>{option.distanceMiles.toFixed(1)} miles away</span>
                )}
              </div>
              <dl className="customer-option-facts">
                <Detail
                  label="Daily rate"
                  value={formatMoney(option.dailyRate)}
                />
                <Detail
                  label="Pickup"
                  value={
                    option.pickupAvailable
                      ? `Available · ${formatMoney(option.pickupFee)}`
                      : "Not available"
                  }
                />
              </dl>
              {option.instructions && (
                <p className="customer-service-note">{option.instructions}</p>
              )}
              {option.acceptsReservations ? (
                <button
                  className="primary-button"
                  onClick={() => setSelected(option)}
                  type="button"
                >
                  Reserve this space
                </button>
              ) : (
                // A walk-in-only lot: no online booking. The listing still
                // carries the lot's own instructions/phone so the customer can
                // arrange it directly.
                <p className="customer-service-note">
                  This lot takes walk-ins only — contact them to arrange parking.
                </p>
              )}
            </article>
          ))}
        </section>
      )}

      {selected && (
        <ParkingReservationForm
          authenticated={authenticated}
          endDate={endDate}
          onAuthenticationRequired={onAuthenticationRequired}
          onCancel={() => setSelected(null)}
          option={selected}
          pickupRequested={pickupRequested}
          profile={profile}
          startDate={startDate}
        />
      )}
    </div>
  );
}

function ParkingReservationForm({
  authenticated,
  endDate,
  onCancel,
  onAuthenticationRequired,
  option,
  pickupRequested,
  profile,
  startDate,
}: {
  authenticated: boolean;
  endDate: string;
  onCancel: () => void;
  onAuthenticationRequired?: () => void;
  option: ParkingOption;
  pickupRequested: boolean;
  profile: UserProfile;
  startDate: string;
}) {
  const [customerName, setCustomerName] = useState(text(profile.fullName, ""));
  const [customerPhone, setCustomerPhone] = useState(text(profile.phone, ""));
  const [carMake, setCarMake] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [vinNumber, setVinNumber] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const valid =
    customerName.trim().length > 1 &&
    isValidPhone(customerPhone) &&
    carMake.trim().length > 0 &&
    carModel.trim().length > 0 &&
    /^\d{4}$/.test(carYear) &&
    accepted;

  async function submit() {
    if (!valid || submitting) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await startCheckout("parking", {
        businessId: option.businessId,
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        carMake: carMake.trim(),
        carModel: carModel.trim(),
        carYear,
        vinNumber: vinNumber.trim(),
        startDate: localDateToIso(startDate, 9),
        endDate: localDateToIso(endDate, 17),
        pickupRequested,
        marketplaceDisclosure: marketplaceDisclosure(accepted),
      });
    } catch (submitError) {
      setError(
        checkoutErrorMessage(
          submitError,
          "The parking reservation could not be started. Check the details and try again.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ServiceRequestForm
      canReview={valid}
      error={error}
      intro="Add your vehicle details, then review the provider and dates."
      onCancel={onCancel}
      onSubmit={submit}
      review={
        <dl className="row-detail-grid customer-review-grid">
          <Detail label="Provider" value={option.businessName} />
          <Detail
            label="Parking dates"
            value={`${formatLocalDate(startDate)} – ${formatLocalDate(endDate)}`}
          />
          <Detail
            label="Vehicle"
            value={`${carYear} ${carMake.trim()} ${carModel.trim()}`}
          />
          <Detail label="Customer" value={customerName.trim()} />
          <Detail label="Phone" value={customerPhone} />
          <Detail
            label="Estimated total"
            value={formatMoney(option.estimatedTotal)}
          />
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
          <PaymentHoldNotice />
        </dl>
      }
      submitLabel={
        authenticated
          ? "Continue to secure payment"
          : "Sign in to save & continue"
      }
      submitting={submitting}
      title="Reserve parking"
    >
      <div className="customer-form-grid customer-form-grid-two">
        <label>
          Customer name
          <input
            autoComplete="name"
            onChange={(event) => setCustomerName(event.target.value)}
            required
            value={customerName}
          />
        </label>
        <CustomerPhoneField
          label="Customer phone"
          onChange={setCustomerPhone}
          required
          value={customerPhone}
        />
        <label>
          Car make
          <input
            onChange={(event) => setCarMake(event.target.value)}
            placeholder="Toyota"
            required
            value={carMake}
          />
        </label>
        <label>
          Car model
          <input
            onChange={(event) => setCarModel(event.target.value)}
            placeholder="Camry"
            required
            value={carModel}
          />
        </label>
        <label>
          Car year
          <input
            inputMode="numeric"
            max={new Date().getFullYear() + 1}
            min="1900"
            onChange={(event) => setCarYear(event.target.value)}
            placeholder="2022"
            required
            type="number"
            value={carYear}
          />
        </label>
        <label>
          VIN number <span className="optional-label">Optional</span>
          <input
            autoCapitalize="characters"
            maxLength={17}
            onChange={(event) => setVinNumber(event.target.value.toUpperCase())}
            placeholder="17-character VIN"
            value={vinNumber}
          />
        </label>
        <div className="customer-form-span">
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </div>
      </div>
    </ServiceRequestForm>
  );
}

function PoolWorkspace({
  authenticated,
  firebaseUser,
  onAuthenticationRequired,
  profile,
}: {
  authenticated: boolean;
  firebaseUser?: User | null;
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
}) {
  const [openPools, setOpenPools] = useState<FirestoreRow[]>([]);
  const [myPools, setMyPools] = useState<FirestoreRow[]>([]);
  const [openLoading, setOpenLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(true);
  const [openError, setOpenError] = useState("");
  const [myError, setMyError] = useState("");
  const [search, setSearch] = useState("");
  const [action, setAction] = useState<PoolAction | null>(null);
  const [pendingPoolId, setPendingPoolId] = useState("");
  const [confirmingPoolId, setConfirmingPoolId] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    if (!authenticated) {
      let active = true;
      setOpenPools([]);
      setOpenLoading(true);
      setOpenError("");
      void withTimeout(
        httpsCallable<Record<string, never>, { options?: unknown[] }>(
          functions,
          "listOpenBarrelPoolOptions",
        )({}),
      )
        .then((response) => {
          if (!active) return;
          setOpenPools(
            (Array.isArray(response.data.options)
              ? response.data.options
              : []
            ).filter(
              (option): option is FirestoreRow =>
                Boolean(option) &&
                typeof option === "object" &&
                typeof (option as { id?: unknown }).id === "string",
            ),
          );
          setOpenError("");
        })
        .catch(() => {
          if (active) {
            setOpenError("Open shared barrels could not be loaded.");
          }
        })
        .finally(() => {
          if (active) setOpenLoading(false);
        });
      return () => {
        active = false;
      };
    }
    setOpenLoading(true);
    setOpenError("");
    const timeoutId = setTimeout(() => {
      setOpenLoading(false);
      setOpenError("Open shared barrels are taking too long to load.");
    }, SNAPSHOT_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      query(collection(db, "openBarrels"), where("status", "==", "open")),
      (snapshot) => {
        clearTimeout(timeoutId);
        setOpenPools(
          snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        );
        setOpenLoading(false);
        setOpenError("");
      },
      () => {
        clearTimeout(timeoutId);
        setOpenLoading(false);
        setOpenError("Open shared barrels could not be loaded.");
      },
    );
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !firebaseUser) {
      setMyPools([]);
      setMyLoading(false);
      setMyError("");
      return undefined;
    }
    setMyLoading(true);
    setMyError("");
    const timeoutId = setTimeout(() => {
      setMyLoading(false);
      setMyError("Your shared barrels are taking too long to load.");
    }, SNAPSHOT_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      collection(db, "users", firebaseUser.uid, "barrelPools"),
      (snapshot) => {
        clearTimeout(timeoutId);
        setMyPools(
          snapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
        );
        setMyLoading(false);
        setMyError("");
      },
      () => {
        clearTimeout(timeoutId);
        setMyLoading(false);
        setMyError("Your shared barrels could not be loaded.");
      },
    );
    return () => {
      clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [authenticated, firebaseUser]);

  const joinedIds = useMemo(
    () => new Set(myPools.map((pool) => pool.id)),
    [myPools],
  );
  const visibleOpenPools = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return openPools;
    return openPools.filter((pool) =>
      [pool.businessName, pool.destinationCountryName, pool.trackingCode].some(
        (value) => text(value, "").toLowerCase().includes(needle),
      ),
    );
  }, [openPools, search]);

  async function runPoolExit(pool: FirestoreRow) {
    if (pendingPoolId) return;
    if (!firebaseUser || !authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    const owner =
      text(pool.participantRole, "") === "owner" ||
      text(pool.createdByUid, "") === firebaseUser.uid;
    setPendingPoolId(pool.id);
    setActionError("");
    try {
      await withTimeout(
        httpsCallable(functions, owner ? "cancelBarrelPool" : "leaveBarrelPool")(
          { poolId: pool.id },
        ),
      );
      setConfirmingPoolId("");
    } catch {
      setActionError(
        owner
          ? "The shared barrel could not be cancelled. Try again."
          : "You could not leave this shared barrel. Try again.",
      );
    } finally {
      setPendingPoolId("");
    }
  }

  return (
    <div className="customer-service-stack">
      <section className="panel">
        <div className="panel-header customer-pool-heading">
          <div>
            <h2>Open shared barrels</h2>
            <p>Reserve one or more available shares with an approved provider.</p>
          </div>
          <button
            className="primary-button"
            onClick={() => setAction({ kind: "create" })}
            type="button"
          >
            <PackageOpen size={16} /> Post a shared barrel
          </button>
        </div>
        <label className="customer-car-search">
          <span>Search open shared barrels</span>
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Destination, business, or tracking code"
            type="search"
            value={search}
          />
        </label>
        {openError && <div className="error-box">{openError}</div>}
        {openLoading && (
          <div className="empty-state">Loading open shared barrels...</div>
        )}
        {!openLoading && !openError && openPools.length === 0 && (
          <div className="empty-state customer-service-empty">
            <PackageOpen aria-hidden="true" size={23} />
            <strong>No shared barrels are open right now.</strong>
            <span>Post one and invite others to share the space.</span>
          </div>
        )}
        {!openLoading &&
          openPools.length > 0 &&
          visibleOpenPools.length === 0 && (
            <div className="empty-state">
              No shared barrels match your search.
            </div>
          )}
        <div className="customer-option-grid">
          {visibleOpenPools.map((pool) => (
            <PoolCard
              action={
                joinedIds.has(pool.id) ? (
                  <span className="customer-joined-label">
                    <CheckCircle2 size={15} /> Already joined
                  </span>
                ) : (
                  <button
                    className="primary-button"
                    onClick={() => setAction({ kind: "join", pool })}
                    type="button"
                  >
                    Request a share
                  </button>
                )
              }
              key={pool.id}
              pool={pool}
            />
          ))}
        </div>
      </section>

      {authenticated && <section className="panel">
        <div className="panel-header">
          <div>
            <h2>My shared barrels</h2>
            <p>Follow your requests, balances, and next available actions.</p>
          </div>
          <Users aria-hidden="true" size={20} />
        </div>
        {(myError || actionError) && (
          <div className="error-box">{myError || actionError}</div>
        )}
        {myLoading && (
          <div className="empty-state">Loading your shared barrels...</div>
        )}
        {!myLoading && !myError && myPools.length === 0 && (
          <div className="empty-state">
            You have not joined a shared barrel yet.
          </div>
        )}
        <div className="customer-option-grid">
          {myPools.map((pool) => {
            const owner =
              text(pool.participantRole, "") === "owner" ||
              text(pool.createdByUid, "") === firebaseUser?.uid;
            const active = [
              "open",
              "partially_filled",
              "full",
              "pending_seal",
            ].includes(text(pool.status, ""));
            const balanceDue =
              text(pool.balancePaymentStatus, "") === "balance_due" ||
              text(pool.participantPaymentStatus, "") === "balance_due";
            return (
              <PoolCard
                action={
                  <div className="customer-pool-actions">
                    {balanceDue && (
                      <button
                        className="primary-button"
                        onClick={() => setAction({ kind: "balance", pool })}
                        type="button"
                      >
                        Pay balance
                      </button>
                    )}
                    {active &&
                      (confirmingPoolId === pool.id ? (
                        <div className="customer-inline-confirm">
                          <span>
                            {owner
                              ? "Cancel this shared barrel?"
                              : "Leave this shared barrel?"}
                          </span>
                          <button
                            className="secondary-button"
                            disabled={pendingPoolId === pool.id}
                            onClick={() => setConfirmingPoolId("")}
                            type="button"
                          >
                            Keep it
                          </button>
                          <button
                            aria-busy={pendingPoolId === pool.id}
                            className="danger-button"
                            data-loading={pendingPoolId === pool.id}
                            disabled={pendingPoolId === pool.id}
                            onClick={() => void runPoolExit(pool)}
                            type="button"
                          >
                            {pendingPoolId === pool.id
                              ? "Updating..."
                              : owner
                                ? "Yes, cancel"
                                : "Yes, leave"}
                          </button>
                        </div>
                      ) : (
                        <button
                          className="secondary-button"
                          disabled={Boolean(pendingPoolId)}
                          onClick={() => setConfirmingPoolId(pool.id)}
                          type="button"
                        >
                          {owner ? "Cancel pool" : "Leave pool"}
                        </button>
                      ))}
                  </div>
                }
                key={pool.id}
                pool={pool}
                showParticipant
              />
            );
          })}
        </div>
      </section>}

      {action?.kind === "create" && (
        <PoolRequestForm
          action={action}
          authenticated={authenticated}
          onCancel={() => setAction(null)}
          onAuthenticationRequired={onAuthenticationRequired}
          profile={profile}
        />
      )}
      {action?.kind === "join" && (
        <PoolRequestForm
          action={action}
          authenticated={authenticated}
          onCancel={() => setAction(null)}
          onAuthenticationRequired={onAuthenticationRequired}
          profile={profile}
        />
      )}
      {action?.kind === "balance" && (
        <PoolBalanceForm
          onCancel={() => setAction(null)}
          pool={action.pool}
        />
      )}
    </div>
  );
}

function PoolCard({
  action,
  pool,
  showParticipant = false,
}: {
  action: React.ReactNode;
  pool: FirestoreRow;
  showParticipant?: boolean;
}) {
  const openShares = numberValue(pool.sharesAvailable ?? pool.openShares);
  const totalShares = numberValue(pool.totalShares);
  const currency = text(pool.currency, "USD");
  return (
    <article className="customer-option-card customer-pool-card">
      <div className="customer-option-card-head">
        <div className="customer-option-icon">
          <PackageOpen aria-hidden="true" size={20} />
        </div>
        <div>
          <h3>{text(pool.destinationCountryName, "Shared barrel")}</h3>
          <p>{text(pool.businessName, "Approved business")}</p>
        </div>
        <span className="status-pill compact">
          {humanStatus(pool.status)}
        </span>
      </div>
      <div className="customer-pool-share-meter">
        <div>
          <strong>{openShares}</strong>
          <span>open shares</span>
        </div>
        <div
          aria-label="Shared barrel availability"
          className="customer-pool-meter"
          role="img"
        >
          <span
            style={{
              width: `${Math.max(
                0,
                Math.min(
                  100,
                  totalShares > 0
                    ? ((totalShares - openShares) / totalShares) * 100
                    : 0,
                ),
              )}%`,
            }}
          />
        </div>
      </div>
      <dl className="customer-option-facts">
        <Detail
          label="Deposit per share"
          value={formatMoney(pool.depositPerShare, currency)}
        />
        <Detail
          label="Full price per share"
          value={formatMoney(pool.pricePerShare, currency)}
        />
        <Detail
          label="Join deadline"
          value={formatDate(pool.joinDeadline)}
        />
        {showParticipant && (
          <Detail
            label="Your request"
            value={humanStatus(
              pool.participantJoinStatus ?? pool.participantPaymentStatus,
            )}
          />
        )}
        {showParticipant && numberValue(pool.balanceDueAmount) > 0 && (
          <Detail
            label="Balance due"
            value={formatMoney(pool.balanceDueAmount, currency)}
          />
        )}
      </dl>
      {action}
    </article>
  );
}

function PoolRequestForm({
  action,
  authenticated,
  onCancel,
  onAuthenticationRequired,
  profile,
}: {
  action: Extract<PoolAction, { kind: "create" | "join" }>;
  authenticated: boolean;
  onCancel: () => void;
  onAuthenticationRequired?: () => void;
  profile: UserProfile;
}) {
  const creating = action.kind === "create";
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [destinationLoading, setDestinationLoading] = useState(creating);
  const [destinationError, setDestinationError] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [senderName, setSenderName] = useState(text(profile.fullName, ""));
  const [senderAddress, setSenderAddress] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [contentsDescription, setContentsDescription] = useState("");
  const [totalShares, setTotalShares] = useState("2");
  const [sharesClaimed, setSharesClaimed] = useState("1");
  const [joinDeadline, setJoinDeadline] = useState("");
  const [contentsAttested, setContentsAttested] = useState(false);
  const [prohibitedItemsAcknowledged, setProhibitedItemsAcknowledged] =
    useState(false);
  const [sharedLiabilityAccepted, setSharedLiabilityAccepted] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!creating) return;
    let active = true;
    setDestinationLoading(true);
    void withTimeout(
      httpsCallable<Record<string, never>, { options?: unknown[] }>(
        functions,
        "listActiveBarrelDestinationOptions",
      )({}),
    )
      .then((response) => {
        if (!active) return;
        const options = (
          Array.isArray(response.data.options) ? response.data.options : []
        )
          .map(destinationOptionFromData)
          .filter(
            (option) =>
              option.enabledServices.includes("barrelShipping") &&
              option.enabledServices.includes("sharedBarrels") &&
              option.country.barrelShippingPrice > 0 &&
              option.country.serviceAvailability?.barrelShipping !== false,
          );
        setDestinations(options);
        setDestinationId(options[0]?.id ?? "");
        setDestinationError("");
      })
      .catch(() => {
        if (!active) return;
        setDestinationError(
          "Shared-barrel destinations could not be loaded. Try again.",
        );
      })
      .finally(() => {
        if (active) setDestinationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [creating]);

  const selectedDestination = destinations.find(
    (option) => option.id === destinationId,
  );
  const selectedPool = action.kind === "join" ? action.pool : null;
  const claimed = Number(sharesClaimed);
  const total = Number(totalShares);
  const maxClaimable = creating
    ? Math.max(1, total - 1)
    : Math.max(
        1,
        numberValue(selectedPool?.sharesAvailable ?? selectedPool?.openShares),
      );
  const valid =
    (!creating || Boolean(selectedDestination)) &&
    senderName.trim().length > 1 &&
    senderAddress.trim().length > 4 &&
    receiverName.trim().length > 1 &&
    isValidPhone(receiverPhone) &&
    contentsDescription.trim().length > 2 &&
    Number.isInteger(claimed) &&
    claimed >= 1 &&
    claimed <= Math.min(4, maxClaimable) &&
    (!creating ||
      (Number.isInteger(total) &&
        total >= 2 &&
        total <= 4 &&
        claimed < total &&
        Boolean(joinDeadline) &&
        new Date(`${joinDeadline}T23:59:00`).getTime() > Date.now())) &&
    contentsAttested &&
    prohibitedItemsAcknowledged &&
    sharedLiabilityAccepted &&
    accepted;

  async function submit() {
    if (!valid || submitting) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const participantPayload = {
        senderName: senderName.trim(),
        senderAddress: senderAddress.trim(),
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        contentsDescription: contentsDescription.trim(),
        attestedWeightKg: 0,
        contentsAttested,
        prohibitedItemsAcknowledged,
        sharedLiabilityAccepted,
        pickupRequested: false,
        pickupAddress: "",
        pickupBorough: "",
        sharesClaimed: claimed,
        marketplaceDisclosure: marketplaceDisclosure(accepted),
      };
      if (creating && selectedDestination) {
        await startCheckout("barrelPoolDeposit", {
          ...participantPayload,
          businessId: selectedDestination.businessId,
          destinationCountryId: selectedDestination.country.id,
          totalShares: total,
          maxJoiners: total - claimed,
          origin: "customerPosted",
          approvalMode: "approval",
          shipMode: "sea",
          joinDeadline: localDateToIso(joinDeadline, 23),
        });
      } else if (selectedPool) {
        await startCheckout("barrelPoolJoin", {
          ...participantPayload,
          poolId: selectedPool.id,
          destinationCountryId: text(
            selectedPool.destinationCountryId,
            "",
          ),
        });
      }
    } catch (submitError) {
      setError(
        checkoutErrorMessage(
          submitError,
          creating
            ? "The shared barrel could not be posted. Check the details and try again."
            : "The share request could not be started. Check the details and try again.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const provider = creating
    ? selectedDestination?.businessName ?? "Select a destination"
    : text(selectedPool?.businessName, "Approved business");
  const destination = creating
    ? selectedDestination?.country.name ?? "Select a destination"
    : text(selectedPool?.destinationCountryName, "Shared barrel");

  return (
    <ServiceRequestForm
      canReview={valid}
      error={error || destinationError}
      intro={
        creating
          ? "Open part of your barrel to other customers traveling to the same destination."
          : "Reserve available space and send your deposit securely."
      }
      onCancel={onCancel}
      onSubmit={submit}
      review={
        <div className="stack">
          <dl className="row-detail-grid customer-review-grid">
            <Detail label="Destination" value={destination} />
            <Detail label="Provider" value={provider} />
            <Detail label="Sender" value={senderName.trim()} />
            <Detail
              label={creating ? "Receiver (for your shares only)" : "Receiver"}
              value={receiverName.trim()}
            />
            <Detail
              label={creating ? "Your shares" : "Shares requested"}
              value={sharesClaimed}
            />
            <Detail
              label="Payment"
              value="Secure card payment"
            />
          </dl>
          <div className="customer-attestation-summary">
            <CheckCircle2 size={16} />
            All content and shared-liability acknowledgements confirmed
          </div>
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </div>
      }
      submitLabel={
        !authenticated
          ? "Sign in to save & continue"
          : creating
            ? "Continue to deposit"
            : "Continue to share deposit"
      }
      submitting={submitting}
      title={creating ? "Post a shared barrel" : "Request a share"}
    >
      <div className="customer-form-grid customer-form-grid-two">
        {creating &&
          !destinationLoading &&
          !destinationError &&
          destinations.length === 0 && (
            <div
              aria-live="polite"
              className="empty-state customer-form-span"
            >
              No approved shared-barrel destinations are available right now.
            </div>
          )}
        {creating && (
          <SearchableSelect
            className="customer-form-span"
            disabled={destinationLoading || destinations.length === 0}
            emptyMessage="No destinations match your search."
            label="Destination & provider"
            listLabel="Destination & provider options"
            onChange={setDestinationId}
            options={destinations.map((option) => ({
              label: `${option.country.name} · ${option.businessName}`,
              keywords: `${option.country.code} ${option.businessName}`,
              value: option.id,
            }))}
            placeholder={
              destinationLoading
                ? "Loading destinations..."
                : "Search destination or provider"
            }
            required
            value={destinationId}
          />
        )}
        {!creating && (
          <div className="customer-provider-banner customer-form-span">
            <PackageOpen size={19} />
            <div>
              <strong>{destination}</strong>
              <span>{provider}</span>
            </div>
          </div>
        )}
        <label>
          Sender name
          <input
            autoComplete="name"
            onChange={(event) => setSenderName(event.target.value)}
            required
            value={senderName}
          />
        </label>
        <label>
          Sender address
          <input
            autoComplete="street-address"
            onChange={(event) => setSenderAddress(event.target.value)}
            placeholder="Street, city, state, postal code"
            required
            value={senderAddress}
          />
        </label>
        <label>
          Receiver name
          <input
            onChange={(event) => setReceiverName(event.target.value)}
            required
            value={receiverName}
          />
        </label>
        <CustomerPhoneField
          label="Receiver phone"
          onChange={setReceiverPhone}
          required
          value={receiverPhone}
        />
        <label className="customer-form-span">
          Contents description
          <textarea
            maxLength={500}
            onChange={(event) => setContentsDescription(event.target.value)}
            placeholder="Describe what will be placed in your share"
            required
            rows={3}
            value={contentsDescription}
          />
        </label>
        {creating && (
          <>
            <label>
              Total shares
              <select
                onChange={(event) => {
                  setTotalShares(event.target.value);
                  if (Number(sharesClaimed) >= Number(event.target.value)) {
                    setSharesClaimed("1");
                  }
                }}
                value={totalShares}
              >
                <option value="2">2 shares</option>
                <option value="3">3 shares</option>
                <option value="4">4 shares</option>
              </select>
            </label>
            <label>
              Shares you keep
              <select
                onChange={(event) => setSharesClaimed(event.target.value)}
                value={sharesClaimed}
              >
                {Array.from({ length: Math.max(1, total - 1) }, (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>
            <label className="customer-form-span">
              Join deadline
              <input
                min={new Date(Date.now() + 24 * 60 * 60 * 1000)
                  .toISOString()
                  .slice(0, 10)}
                onChange={(event) => setJoinDeadline(event.target.value)}
                required
                type="date"
                value={joinDeadline}
              />
            </label>
          </>
        )}
        {!creating && (
          <label className="customer-form-span">
            Shares requested
            <select
              onChange={(event) => setSharesClaimed(event.target.value)}
              value={sharesClaimed}
            >
              {Array.from(
                { length: Math.min(4, maxClaimable) },
                (_, index) => (
                  <option key={index + 1} value={index + 1}>
                    {index + 1}
                  </option>
                ),
              )}
            </select>
          </label>
        )}
        <div className="customer-attestation-group customer-form-span">
          <strong>Required acknowledgements</strong>
          <label className="customer-choice-row">
            <input
              checked={contentsAttested}
              onChange={(event) => setContentsAttested(event.target.checked)}
              type="checkbox"
            />
            My contents description is complete and accurate.
          </label>
          <label className="customer-choice-row">
            <input
              checked={prohibitedItemsAcknowledged}
              onChange={(event) =>
                setProhibitedItemsAcknowledged(event.target.checked)
              }
              type="checkbox"
            />
            I will not include prohibited or dangerous items.
          </label>
          <label className="customer-choice-row">
            <input
              checked={sharedLiabilityAccepted}
              onChange={(event) =>
                setSharedLiabilityAccepted(event.target.checked)
              }
              type="checkbox"
            />
            I accept the limits and responsibilities of shared-barrel service.
          </label>
        </div>
        <div className="customer-form-span">
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </div>
      </div>
    </ServiceRequestForm>
  );
}

function PoolBalanceForm({
  onCancel,
  pool,
}: {
  onCancel: () => void;
  pool: FirestoreRow;
}) {
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!accepted || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await startCheckout("barrelPoolBalance", {
        poolId: pool.id,
        ...(text(pool.balancePaymentRequestId, "") && {
          requestId: text(pool.balancePaymentRequestId),
        }),
        marketplaceDisclosure: marketplaceDisclosure(accepted),
      });
    } catch (submitError) {
      setError(
        checkoutErrorMessage(
          submitError,
          "The balance payment could not be started. Try again.",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ServiceRequestForm
      canReview={accepted}
      error={error}
      intro="Review the verified balance before opening secure payment."
      onCancel={onCancel}
      onSubmit={submit}
      review={
        <div className="stack">
          <dl className="row-detail-grid">
            <Detail
              label="Shared barrel"
              value={text(pool.destinationCountryName, pool.id)}
            />
            <Detail
              label="Provider"
              value={text(pool.businessName, "Approved business")}
            />
            <Detail
              label="Balance due"
              value={formatMoney(
                pool.balanceDueAmount,
                text(pool.currency, "USD"),
              )}
            />
          </dl>
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </div>
      }
      submitLabel="Continue to balance payment"
      submitting={submitting}
      title="Pay shared-barrel balance"
    >
      <div className="customer-balance-callout">
        <span>Verified balance due</span>
        <strong>
          {formatMoney(pool.balanceDueAmount, text(pool.currency, "USD"))}
        </strong>
        <p>
          This amount was calculated by the provider after the barrel was
          sealed.
        </p>
      </div>
      <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
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

function parkingOptionFromData(value: unknown): ParkingOption {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    businessId: text(data.businessId, ""),
    businessName: text(data.businessName, "Approved business"),
    city: text(data.city, ""),
    state: text(data.state, ""),
    address: text(data.address, ""),
    quotedForDates: data.quotedForDates === true,
    availableSpaces: numberValue(data.availableSpaces),
    estimatedTotal: numberValue(data.estimatedTotal),
    reviewWeightedScore: numberValue(data.reviewWeightedScore),
    dailyRate: numberValue(data.dailyRate),
    weeklyRate: numberValue(data.weeklyRate),
    monthlyRate: numberValue(data.monthlyRate),
    pickupAvailable: data.pickupAvailable === true,
    pickupFee: numberValue(data.pickupFee),
    distanceMiles:
      data.distanceMiles === null || data.distanceMiles === undefined
        ? null
        : numberValue(data.distanceMiles),
    instructions: text(data.instructions, ""),
    acceptsReservations: data.acceptsReservations !== false,
  };
}

function destinationOptionFromData(value: unknown): DestinationOption {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const country =
    data.country && typeof data.country === "object"
      ? (data.country as Record<string, unknown>)
      : {};
  const availability =
    country.serviceAvailability &&
    typeof country.serviceAvailability === "object"
      ? (country.serviceAvailability as Record<string, unknown>)
      : {};
  return {
    id: text(data.id, ""),
    businessId: text(data.businessId, ""),
    businessName: text(data.businessName, "Approved business"),
    businessAddress: text(data.businessAddress, ""),
    enabledServices: Array.isArray(data.enabledServices)
      ? data.enabledServices.map((item) => text(item, ""))
      : [],
    country: {
      id: text(country.id, ""),
      name: text(country.name, ""),
      code: text(country.code, ""),
      barrelShippingPrice: numberValue(country.barrelShippingPrice),
      serviceAvailability: {
        barrelShipping: availability.barrelShipping !== false,
      },
    },
  };
}

function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localDateToIso(value: string, hour: number) {
  const date = new Date(`${value}T${String(hour).padStart(2, "0")}:00:00`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("A valid date is required.");
  }
  return date.toISOString();
}

function formatLocalDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function humanStatus(value: unknown) {
  const normalized = text(value, "open").replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

async function withTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The request timed out.")),
          ACTION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
