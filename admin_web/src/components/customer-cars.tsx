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
import { CalendarDays, Car, Heart, MapPin, X } from "lucide-react";

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

export function CustomerCars({
  firebaseUser,
  authenticated = true,
  onAuthenticationRequired,
  profile,
  state,
}: CustomerCarsProps) {
  const [search, setSearch] = useState("");
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

  const filteredCars = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return state.rows;
    return state.rows.filter((car) =>
      [
        car.title,
        car.make,
        car.model,
        car.year,
        car.businessName,
        car.location,
        car.locationCity,
        car.locationState,
      ].some((value) => text(value, "").toLowerCase().includes(needle)),
    );
  }, [search, state.rows]);

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

  return (
    <section className="panel">
      <div className="panel-header customer-cars-header">
        <div>
          <Car size={18} />
          <h2>Browse cars</h2>
        </div>
        <span className="status-pill compact">{state.rows.length} listings</span>
      </div>
      <label className="customer-car-search">
        <span>Search car listings</span>
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Make, model, year, business, or location"
          type="search"
          value={search}
        />
      </label>
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
        <div className="empty-state">No cars match your search.</div>
      )}
      <div className="customer-car-grid">
        {filteredCars.map((car) => {
          const imageUrl = carImage(car);
          const favorite = favorites.has(car.id);
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
              </div>
              <div className="customer-car-card-body">
                <div>
                  <h3>{carTitle(car)}</h3>
                  <p>
                    <MapPin size={14} />
                    {carLocation(car)}
                  </p>
                </div>
                <strong>{formatMoney(car.price)}</strong>
                <dl className="customer-car-facts">
                  <div>
                    <dt>Business</dt>
                    <dd>{text(car.businessName, "Approved business")}</dd>
                  </div>
                  <div>
                    <dt>Condition</dt>
                    <dd>{text(car.condition, "Not provided")}</dd>
                  </div>
                  <div>
                    <dt>Rebuilt title</dt>
                    <dd>{rebuiltTitle(car.isRebuiltTitle)}</dd>
                  </div>
                </dl>
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
      {selectedCar && (
        <CarDetail
          action={action}
          authenticated={authenticated}
          car={selectedCar}
          onAction={setAction}
          onAuthenticationRequired={onAuthenticationRequired}
          onClose={() => {
            setSelectedCar(null);
            setAction(null);
          }}
          profile={profile}
        />
      )}
    </section>
  );
}

function CarDetail({
  action,
  authenticated,
  car,
  onAction,
  onAuthenticationRequired,
  onClose,
  profile,
}: {
  action: CarAction | null;
  authenticated: boolean;
  car: FirestoreRow;
  onAction: (action: CarAction | null) => void;
  onAuthenticationRequired?: () => void;
  onClose: () => void;
  profile: UserProfile;
}) {
  return (
    <div className="account-overlay" role="presentation">
      <button
        aria-label="Close car details"
        className="account-backdrop"
        onClick={onClose}
        type="button"
      />
      <aside
        aria-modal="true"
        className="account-drawer customer-car-drawer"
        role="dialog"
      >
        <div className="account-drawer-head">
          <div>
            <h2>{carTitle(car)}</h2>
            <p>{formatMoney(car.price)}</p>
          </div>
          <button
            aria-label="Close car details"
            className="icon-button subtle"
            onClick={onClose}
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        {action ? (
          <CarActionForm
            action={action}
            authenticated={authenticated}
            car={car}
            onCancel={() => onAction(null)}
            onComplete={onClose}
            onAuthenticationRequired={onAuthenticationRequired}
            profile={profile}
          />
        ) : (
          <>
            {carImage(car) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={carTitle(car)}
                className="customer-car-detail-image"
                src={carImage(car)}
              />
            ) : (
              <div className="listing-photo-placeholder customer-car-detail-image">
                <Car size={36} />
              </div>
            )}
            <dl className="row-detail-grid">
              <Detail label="Business" value={text(car.businessName, "Approved business")} />
              <Detail label="Location" value={carLocation(car)} />
              <Detail label="Year" value={text(car.year, "Not provided")} />
              <Detail label="Mileage" value={text(car.mileage, "Not provided")} />
              <Detail label="Condition" value={text(car.condition, "Not provided")} />
              <Detail label="Body type" value={text(car.bodyType, "Not provided")} />
              <Detail label="Fuel" value={text(car.fuelType, "Not provided")} />
              <Detail label="Transmission" value={text(car.transmission, "Not provided")} />
              <Detail label="Rebuilt title" value={rebuiltTitle(car.isRebuiltTitle)} />
            </dl>
            {car.description && <p>{text(car.description)}</p>}
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
          </>
        )}
      </aside>
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
        marketplaceDisclosure: marketplaceDisclosure(),
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

function carImage(car: FirestoreRow) {
  const images = Array.isArray(car.imageUrls) ? car.imageUrls : [];
  return text(car.imageUrl ?? images[0], "");
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
