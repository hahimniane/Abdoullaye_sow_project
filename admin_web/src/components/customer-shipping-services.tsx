"use client";

import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import {
  Box,
  CheckCircle2,
  MapPin,
  PackageCheck,
  Plane,
  RefreshCw,
  Scale,
  Ship,
  Truck,
} from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { ServiceRequestForm } from "@/components/service-request-form";
import {
  buildBarrelShipmentPayload,
  buildFreightSettlementPayload,
  buildFreightShipmentPayload,
  buildTransportRequestPayload,
  freightSettlementIsPayable,
  type PickupDetails,
} from "@/lib/customer-shipping";
import { marketplaceDisclosure } from "@/lib/disclosures";
import { functions } from "@/lib/firebase";
import { formatMoney, text } from "@/lib/format";
import { isValidPhone } from "@/lib/phone";
import { startCheckout } from "@/lib/use-checkout";
import type { FirestoreRow, UserProfile } from "@/types/admin";

const CALL_TIMEOUT_MS = 30_000;

type ShippingService = "barrel" | "freight" | "transport";

type DestinationCountry = {
  id: string;
  name: string;
  barrelShippingPrice?: number;
  freightAirPricePerKg?: number;
  freightSeaPricePerKg?: number;
  serviceAvailability?: {
    barrelShipping?: boolean;
    freightAir?: boolean;
    freightSea?: boolean;
    carTransport?: boolean;
  };
};

type DestinationOption = {
  id: string;
  businessId: string;
  businessName: string;
  freightPickupAvailable?: boolean;
  country: DestinationCountry;
};

type AddressSuggestion = {
  description: string;
  placeId: string;
  borough?: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
};

type FreightQuote = {
  fee: number;
  model: string;
  distanceKm?: number;
  currency?: string;
};

type CustomerShippingServicesProps = {
  profile: UserProfile;
  freightShipments?: FirestoreRow[];
  initialService?: ShippingService;
  authenticated?: boolean;
  onAuthenticationRequired?: () => void;
  onTransportCreated?: (result: {
    id: string;
    trackingCode: string;
  }) => void;
};

async function callFunction<TResult>(
  name: string,
  data: Record<string, unknown> = {},
) {
  const callable = httpsCallable<Record<string, unknown>, TResult>(
    functions,
    name,
  );
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const response = await Promise.race([
      callable(data),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The request timed out. Try again.")),
          CALL_TIMEOUT_MS,
        );
      }),
    ]);
    return response.data;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function optionLabel(option: DestinationOption) {
  return `${option.country.name} · ${option.businessName}`;
}

function selectedOption(
  options: DestinationOption[],
  id: string,
) {
  return options.find((option) => option.id === id);
}

function pickupIsComplete(pickup: PickupDetails) {
  return (
    !pickup.requested ||
    Boolean(
      pickup.address.trim() &&
        pickup.borough.trim() &&
        pickup.dateTime,
    )
  );
}

function localDateTimeIso(value: string) {
  return new Date(value).toISOString();
}

export function CustomerShippingServices({
  profile,
  freightShipments = [],
  initialService = "barrel",
  authenticated = true,
  onAuthenticationRequired,
  onTransportCreated,
}: CustomerShippingServicesProps) {
  const [service, setService] = useState<ShippingService>(initialService);
  const [destinationOptions, setDestinationOptions] = useState<
    DestinationOption[]
  >([]);
  const [transportOptions, setTransportOptions] = useState<DestinationOption[]>(
    [],
  );
  const [loadingDestinationOptions, setLoadingDestinationOptions] =
    useState(true);
  const [loadingTransportOptions, setLoadingTransportOptions] = useState(true);
  const [destinationOptionsError, setDestinationOptionsError] = useState("");
  const [transportOptionsError, setTransportOptionsError] = useState("");
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);

  useEffect(() => {
    let active = true;

    async function loadDestinationOptions() {
      setLoadingDestinationOptions(true);
      setDestinationOptionsError("");
      try {
        const shipping = await callFunction<{ options?: DestinationOption[] }>(
          "listActiveBarrelDestinationOptions",
        );
        if (!active) return;
        setDestinationOptions(
          Array.isArray(shipping.options) ? shipping.options : [],
        );
      } catch {
        if (active) {
          setDestinationOptionsError(
            "We couldn't securely load barrel and freight destinations. Refresh and try again. Local previews must be registered with Firebase App Check.",
          );
        }
      } finally {
        if (active) setLoadingDestinationOptions(false);
      }
    }

    async function loadTransportOptions() {
      setLoadingTransportOptions(true);
      setTransportOptionsError("");
      try {
        const transport = await callFunction<{
          options?: DestinationOption[];
        }>("listTransportBusinessOptions");
        if (!active) return;
        setTransportOptions(
          Array.isArray(transport.options) ? transport.options : [],
        );
      } catch {
        if (active) {
          setTransportOptionsError(
            "We couldn't securely load car transport providers. Refresh and try again. Local previews must be registered with Firebase App Check.",
          );
        }
      } finally {
        if (active) setLoadingTransportOptions(false);
      }
    }

    void loadDestinationOptions();
    void loadTransportOptions();
    return () => {
      active = false;
    };
  }, [optionsReloadKey]);

  const barrelOptions = useMemo(
    () =>
      destinationOptions.filter(
        (option) =>
          Number(option.country.barrelShippingPrice || 0) > 0 &&
          option.country.serviceAvailability?.barrelShipping !== false,
      ),
    [destinationOptions],
  );
  const loadingOptions =
    service === "transport"
      ? loadingTransportOptions
      : loadingDestinationOptions;
  const optionsError =
    service === "transport" ? transportOptionsError : destinationOptionsError;

  return (
    <section className="customer-shipping">
      <header className="customer-shipping-hero">
        <div>
          <span className="customer-service-kicker">Shipping services</span>
          <h2>Move what matters, with a business you choose</h2>
          <p>
            Compare approved providers, review every detail, and pay securely
            when payment is required.
          </p>
        </div>
        <PackageCheck aria-hidden="true" size={42} />
      </header>

      <div className="customer-service-switcher" role="tablist">
        <ServiceTab
          active={service === "barrel"}
          icon={<Box size={20} />}
          label="Barrel shipping"
          note="Send one or more barrels"
          onClick={() => setService("barrel")}
        />
        <ServiceTab
          active={service === "freight"}
          icon={<Plane size={20} />}
          label="Freight"
          note="Air or sea by weight"
          onClick={() => setService("freight")}
        />
        <ServiceTab
          active={service === "transport"}
          icon={<Truck size={20} />}
          label="Car transport"
          note="Request a business quote"
          onClick={() => setService("transport")}
        />
      </div>

      {loadingOptions ? (
        <div className="customer-service-loading">
          <span className="loading-spinner" />
          Loading shipping options...
        </div>
      ) : optionsError ? (
        <ServiceUnavailable
          actionLabel="Retry"
          message={optionsError}
          onAction={() => setOptionsReloadKey((current) => current + 1)}
          title={
            service === "transport"
              ? "Car transport providers could not be loaded"
              : "Shipping destinations could not be loaded"
          }
        />
      ) : (
        <>
          {service === "barrel" && (
            <BarrelShipmentForm
              authenticated={authenticated}
              onAuthenticationRequired={onAuthenticationRequired}
              options={barrelOptions}
              profile={profile}
            />
          )}
          {service === "freight" && (
            <FreightShipmentForm
              authenticated={authenticated}
              freightShipments={freightShipments}
              onAuthenticationRequired={onAuthenticationRequired}
              options={destinationOptions}
              profile={profile}
            />
          )}
          {service === "transport" && (
            <TransportRequestForm
              authenticated={authenticated}
              onAuthenticationRequired={onAuthenticationRequired}
              onCreated={onTransportCreated}
              options={transportOptions}
              profile={profile}
            />
          )}
        </>
      )}
    </section>
  );
}

function ServiceTab({
  active,
  icon,
  label,
  note,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  note: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-selected={active}
      className={active ? "active" : ""}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <span className="customer-service-tab-icon">{icon}</span>
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
    </button>
  );
}

function BarrelShipmentForm({
  authenticated,
  onAuthenticationRequired,
  options,
  profile,
}: {
  authenticated: boolean;
  onAuthenticationRequired?: () => void;
  options: DestinationOption[];
  profile: UserProfile;
}) {
  const [senderName, setSenderName] = useState(text(profile.fullName, ""));
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [destinationOptionId, setDestinationOptionId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [pickup, setPickup] = useState<PickupDetails>({
    requested: false,
    address: "",
    borough: "",
  });
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const destination = selectedOption(options, destinationOptionId);
  const valid =
    Boolean(
      senderName.trim() &&
        receiverName.trim() &&
        destination &&
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= 20,
    ) &&
    isValidPhone(receiverPhone) &&
    pickupIsComplete(pickup) &&
    accepted;

  async function submit() {
    if (!valid || submitting || !destination) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await startCheckout(
        "barrelShipment",
        buildBarrelShipmentPayload(
          {
            senderName,
            receiverName,
            receiverPhone,
            destinationCountryId: destination.country.id,
            businessId: destination.businessId,
            quantity,
            pickup: {
              ...pickup,
              ...(pickup.dateTime && {
                dateTime: localDateTimeIso(pickup.dateTime),
              }),
            },
            useWalletBalance,
          },
          marketplaceDisclosure(),
        ),
      );
    } catch {
      setError(
        "The barrel shipment could not be started. Check the details and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (options.length === 0) {
    return (
      <ServiceUnavailable
        message="No approved barrel destinations are available right now."
        title="Barrel shipping is temporarily unavailable"
      />
    );
  }

  return (
    <ServiceRequestForm
      canReview={valid}
      error={error}
      intro="Choose an approved business and destination. Your total is calculated securely by Laawol."
      onCancel={() => {
        setReceiverName("");
        setReceiverPhone("");
        setDestinationOptionId("");
        setAccepted(false);
      }}
      onSubmit={submit}
      review={
        <ReviewGrid>
          <ReviewDetail label="Sender" value={senderName} />
          <ReviewDetail label="Receiver" value={receiverName} />
          <ReviewDetail label="Receiver phone" value={receiverPhone} />
          <ReviewDetail
            label="Destination"
            value={destination ? optionLabel(destination) : ""}
          />
          <ReviewDetail label="Barrels" value={String(quantity)} />
          <ReviewDetail
            label="Pickup"
            value={pickup.requested ? pickup.address : "Drop off"}
          />
          {authenticated && (
            <ReviewDetail
              label="Wallet"
              value={useWalletBalance ? "Use available balance" : "Do not use"}
            />
          )}
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </ReviewGrid>
      }
      submitLabel={
        authenticated
          ? "Continue to secure payment"
          : "Sign in to save & continue"
      }
      submitting={submitting}
      title="Send a barrel"
    >
      <div className="customer-form-grid customer-shipping-form-grid">
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
        <DestinationSelect
          label="Destination and business"
          onChange={setDestinationOptionId}
          options={options}
          value={destinationOptionId}
        />
        <label>
          Number of barrels
          <input
            max={20}
            min={1}
            onChange={(event) =>
              setQuantity(Number(event.target.value || 1))
            }
            required
            type="number"
            value={quantity}
          />
        </label>
        <PickupFields
          pickup={pickup}
          setPickup={setPickup}
          suggestionsEnabled={authenticated}
        />
        {authenticated && (
          <label className="customer-choice-row customer-form-span">
            <input
              checked={useWalletBalance}
              onChange={(event) => setUseWalletBalance(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Use my available wallet balance</strong>
              <small>Any remaining amount continues to secure payment.</small>
            </span>
          </label>
        )}
        <div className="customer-form-span">
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </div>
      </div>
    </ServiceRequestForm>
  );
}

function FreightShipmentForm({
  authenticated,
  freightShipments,
  onAuthenticationRequired,
  options,
  profile,
}: {
  authenticated: boolean;
  freightShipments: FirestoreRow[];
  onAuthenticationRequired?: () => void;
  options: DestinationOption[];
  profile: UserProfile;
}) {
  const [mode, setMode] = useState<"air" | "sea">("air");
  const availableOptions = useMemo(
    () =>
      options.filter((option) => {
        const rate =
          mode === "air"
            ? option.country.freightAirPricePerKg
            : option.country.freightSeaPricePerKg;
        const availability =
          mode === "air"
            ? option.country.serviceAvailability?.freightAir
            : option.country.serviceAvailability?.freightSea;
        return Number(rate || 0) > 0 && availability !== false;
      }),
    [mode, options],
  );
  const [senderName, setSenderName] = useState(text(profile.fullName, ""));
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [destinationOptionId, setDestinationOptionId] = useState("");
  const [weightKg, setWeightKg] = useState(1);
  const [pickup, setPickup] = useState<PickupDetails>({
    requested: false,
    address: "",
    borough: "",
  });
  const [pickupLocation, setPickupLocation] =
    useState<AddressSuggestion | null>(null);
  const [quote, setQuote] = useState<FreightQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const destination = selectedOption(availableOptions, destinationOptionId);

  useEffect(() => {
    if (
      destinationOptionId &&
      !availableOptions.some((option) => option.id === destinationOptionId)
    ) {
      setDestinationOptionId("");
      setQuote(null);
    }
  }, [availableOptions, destinationOptionId]);

  const pickupAllowed = destination?.freightPickupAvailable !== false;
  const quoteReady =
    !pickup.requested ||
    (pickupAllowed &&
      pickupIsComplete(pickup) &&
      (!authenticated || quote !== null));
  const valid =
    Boolean(
      senderName.trim() &&
        receiverName.trim() &&
        destination &&
        Number.isFinite(weightKg) &&
        weightKg > 0,
    ) &&
    isValidPhone(receiverPhone) &&
    quoteReady &&
    accepted;

  async function requestQuote() {
    if (
      quoting ||
      !destination ||
      !pickup.address.trim() ||
      !pickup.borough.trim()
    ) {
      return;
    }
    setQuoting(true);
    setQuote(null);
    setError("");
    try {
      const result = await callFunction<FreightQuote>("quoteFreightPickup", {
        businessId: destination.businessId,
        pickupAddress: pickup.address.trim(),
        pickupBorough: pickup.borough.trim(),
        ...(pickupLocation?.latitude !== undefined && {
          pickupLatitude: pickupLocation.latitude,
        }),
        ...(pickupLocation?.longitude !== undefined && {
          pickupLongitude: pickupLocation.longitude,
        }),
      });
      setQuote(result);
    } catch {
      setError(
        "The pickup quote could not be calculated. Check the address and try again.",
      );
    } finally {
      setQuoting(false);
    }
  }

  async function submit() {
    if (submitting || !destination) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    if (
      pickup.requested &&
      pickupAllowed &&
      pickupIsComplete(pickup) &&
      !quote
    ) {
      await requestQuote();
      return;
    }
    if (!valid) return;
    setSubmitting(true);
    setError("");
    try {
      await startCheckout(
        "freightShipment",
        buildFreightShipmentPayload(
          {
            senderName,
            receiverName,
            receiverPhone,
            destinationCountryId: destination.country.id,
            businessId: destination.businessId,
            mode,
            weightKg,
            pickup: {
              ...pickup,
              ...(pickup.dateTime && {
                dateTime: localDateTimeIso(pickup.dateTime),
              }),
            },
            useWalletBalance,
          },
          marketplaceDisclosure(),
        ),
      );
    } catch {
      setError(
        "The freight shipment could not be started. Check the details and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="customer-shipping-stack">
      {availableOptions.length === 0 ? (
        <ServiceUnavailable
          message="No approved businesses currently have a rate for this freight mode."
          title="This freight mode is temporarily unavailable"
        />
      ) : (
        <ServiceRequestForm
          canReview={valid}
          error={error}
          intro="Choose air or sea freight. The approved business verifies the final weight before settlement."
          onCancel={() => {
            setReceiverName("");
            setReceiverPhone("");
            setDestinationOptionId("");
            setAccepted(false);
          }}
          onSubmit={submit}
          review={
            <ReviewGrid>
              <ReviewDetail label="Sender" value={senderName} />
              <ReviewDetail label="Receiver" value={receiverName} />
              <ReviewDetail label="Receiver phone" value={receiverPhone} />
              <ReviewDetail
                label="Service"
                value={mode === "air" ? "Air freight" : "Sea freight"}
              />
              <ReviewDetail
                label="Destination"
                value={destination ? optionLabel(destination) : ""}
              />
              <ReviewDetail
                label="Estimated weight"
                value={`${weightKg} kg`}
              />
              <ReviewDetail
                label="Pickup"
                value={pickup.requested ? pickup.address : "Drop off"}
              />
              {quote && (
                <ReviewDetail
                  label="Pickup quote"
                  value={formatMoney(quote.fee, quote.currency || "USD")}
                />
              )}
              <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
            </ReviewGrid>
          }
          submitLabel={
            !authenticated
              ? "Sign in to save & continue"
              : pickup.requested && !quote
                ? "Calculate pickup & continue"
                : "Continue to secure payment"
          }
          submitting={submitting}
          title="Send freight"
        >
          <div className="customer-form-grid customer-shipping-form-grid">
            <fieldset className="customer-segmented customer-form-span">
              <legend>Shipping method</legend>
              <button
                aria-pressed={mode === "air"}
                className={mode === "air" ? "active" : ""}
                onClick={() => {
                  setMode("air");
                  setQuote(null);
                }}
                type="button"
              >
                <Plane size={17} /> Air freight
              </button>
              <button
                aria-pressed={mode === "sea"}
                className={mode === "sea" ? "active" : ""}
                onClick={() => {
                  setMode("sea");
                  setQuote(null);
                }}
                type="button"
              >
                <Ship size={17} /> Sea freight
              </button>
            </fieldset>
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
            <DestinationSelect
              label="Destination and business"
              onChange={(value) => {
                setDestinationOptionId(value);
                setQuote(null);
              }}
              options={availableOptions}
              value={destinationOptionId}
            />
            <label>
              Estimated weight (kg)
              <input
                min="0.1"
                onChange={(event) =>
                  setWeightKg(Number(event.target.value || 0))
                }
                required
                step="0.1"
                type="number"
                value={weightKg}
              />
            </label>
            <PickupFields
              disabled={Boolean(destination && !pickupAllowed)}
              onAddressSelected={(suggestion) => {
                setPickupLocation(suggestion);
                setQuote(null);
              }}
              onPickupChanged={() => setQuote(null)}
              pickup={pickup}
              setPickup={setPickup}
              suggestionsEnabled={authenticated}
            />
            {pickup.requested && pickupAllowed && (
              <div className="customer-quote-row customer-form-span">
                <div>
                  <strong>Live pickup quote</strong>
                  <small>
                    The fee comes directly from the selected business&apos;s
                    pickup rules.
                  </small>
                </div>
                {quote ? (
                  <span className="customer-quote-value">
                    {formatMoney(quote.fee, quote.currency || "USD")}
                    {quote.distanceKm
                      ? ` · ${quote.distanceKm.toFixed(1)} km`
                      : ""}
                  </span>
                ) : (
                  <button
                    className="secondary-button"
                    data-loading={quoting}
                    disabled={
                      quoting ||
                      !pickup.address.trim() ||
                      !pickup.borough.trim()
                    }
                    onClick={() => void requestQuote()}
                    type="button"
                  >
                    {quoting ? "Calculating..." : "Get pickup quote"}
                  </button>
                )}
              </div>
            )}
            {pickup.requested && destination && !pickupAllowed && (
              <div className="customer-inline-note customer-form-span">
                Pickup is not available from this business. Choose drop off or
                another provider.
              </div>
            )}
            {authenticated && (
              <label className="customer-choice-row customer-form-span">
                <input
                  checked={useWalletBalance}
                  onChange={(event) =>
                    setUseWalletBalance(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Use my available wallet balance</strong>
                  <small>Any remaining amount continues to secure payment.</small>
                </span>
              </label>
            )}
            <div className="customer-form-span">
              <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
            </div>
          </div>
        </ServiceRequestForm>
      )}
      {authenticated && <FreightSettlements shipments={freightShipments} />}
    </div>
  );
}

function FreightSettlements({ shipments }: { shipments: FirestoreRow[] }) {
  const payable = shipments.filter(freightSettlementIsPayable);
  const [acceptedId, setAcceptedId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  if (payable.length === 0) return null;

  async function pay(shipment: FirestoreRow) {
    if (busyId || acceptedId !== shipment.id) return;
    setBusyId(shipment.id);
    setError("");
    try {
      await startCheckout(
        "freightSettlement",
        buildFreightSettlementPayload(
          shipment.id,
          marketplaceDisclosure(),
        ),
      );
    } catch {
      setError("The freight balance payment could not be started. Try again.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="customer-settlement-panel">
      <div className="panel-header">
        <div>
          <Scale size={19} />
          <div>
            <h3>Verified-weight balances</h3>
            <p>Complete a balance after the business confirms final weight.</p>
          </div>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="customer-settlement-list">
        {payable.map((shipment) => (
          <article key={shipment.id}>
            <div>
              <strong>
                {text(shipment.trackingCode, `Freight ${shipment.id}`)}
              </strong>
              <small>
                {text(shipment.destinationCountryName, "Freight destination")}
              </small>
            </div>
            <span>
              {formatMoney(
                Number(shipment.balanceDueCents || 0) / 100 ||
                  shipment.balanceDue,
              )}
            </span>
            <DisclosureCheckbox
              accepted={acceptedId === shipment.id}
              onChange={(accepted) => setAcceptedId(accepted ? shipment.id : "")}
            />
            <button
              className="primary-button"
              data-loading={busyId === shipment.id}
              disabled={Boolean(busyId) || acceptedId !== shipment.id}
              onClick={() => void pay(shipment)}
              type="button"
            >
              {busyId === shipment.id ? "Opening payment..." : "Pay balance"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function TransportRequestForm({
  authenticated,
  onAuthenticationRequired,
  onCreated,
  options,
  profile,
}: {
  authenticated: boolean;
  onAuthenticationRequired?: () => void;
  onCreated?: (result: { id: string; trackingCode: string }) => void;
  options: DestinationOption[];
  profile: UserProfile;
}) {
  const [destinationOptionId, setDestinationOptionId] = useState("");
  const [ownerName, setOwnerName] = useState(text(profile.fullName, ""));
  const [customerPhone, setCustomerPhone] = useState(text(profile.phone, ""));
  const [carMake, setCarMake] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [vinNumber, setVinNumber] = useState("");
  const [pickupAddress, setPickupAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    id: string;
    trackingCode: string;
  } | null>(null);
  const destination = selectedOption(options, destinationOptionId);
  const currentYear = new Date().getFullYear();
  const year = Number(carYear);
  const valid =
    Boolean(
      destination &&
        ownerName.trim() &&
        carMake.trim() &&
        carModel.trim() &&
        carYear.trim(),
    ) &&
    Number.isInteger(year) &&
    year >= 1900 &&
    year <= currentYear + 1 &&
    isValidPhone(customerPhone);

  async function submit() {
    if (!valid || submitting || !destination) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await callFunction<{ id: string; trackingCode: string }>(
        "createTransportRequest",
        buildTransportRequestPayload({
          businessId: destination.businessId,
          destinationCountryId: destination.country.id,
          destinationCountryName: destination.country.name,
          ownerName,
          carMake,
          carModel,
          carYear,
          customerPhone,
          vinNumber,
          pickupAddress,
          notes,
          ...(preferredDate && {
            preferredDate: new Date(
              `${preferredDate}T12:00:00`,
            ).toISOString(),
          }),
        }),
      );
      setCreated(result);
      onCreated?.(result);
    } catch {
      setError(
        "The transport request could not be submitted. Check the details and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (options.length === 0) {
    return (
      <ServiceUnavailable
        message="No approved car transport businesses are available right now."
        title="Car transport is temporarily unavailable"
      />
    );
  }

  if (created) {
    return (
      <section className="customer-transport-success" role="status">
        <CheckCircle2 size={34} />
        <div>
          <span className="customer-service-kicker">Request received</span>
          <h3>Your car transport quote is underway</h3>
          <p>
            The selected business will review the vehicle and destination before
            setting a price.
          </p>
          <strong>Tracking code: {created.trackingCode}</strong>
        </div>
        <button
          className="secondary-button"
          onClick={() => {
            setCreated(null);
            setDestinationOptionId("");
            setCarMake("");
            setCarModel("");
            setCarYear("");
            setVinNumber("");
            setPickupAddress("");
            setNotes("");
            setPreferredDate("");
          }}
          type="button"
        >
          Start another request
        </button>
      </section>
    );
  }

  return (
    <ServiceRequestForm
      canReview={valid}
      error={error}
      intro="Send the vehicle details to an approved business. They will review your request and provide the price."
      onCancel={() => {
        setDestinationOptionId("");
        setCarMake("");
        setCarModel("");
        setCarYear("");
      }}
      onSubmit={submit}
      review={
        <ReviewGrid>
          <ReviewDetail
            label="Destination"
            value={destination ? optionLabel(destination) : ""}
          />
          <ReviewDetail label="Owner" value={ownerName} />
          <ReviewDetail
            label="Vehicle"
            value={`${carYear} ${carMake} ${carModel}`}
          />
          <ReviewDetail label="Phone" value={customerPhone} />
          <ReviewDetail
            label="Preferred date"
            value={preferredDate || "Flexible"}
          />
          <ReviewDetail
            label="Pickup address"
            value={pickupAddress || "Not provided"}
          />
        </ReviewGrid>
      }
      submitLabel={
        authenticated
          ? "Request business quote"
          : "Sign in to save & continue"
      }
      submitting={submitting}
      title="Request car transport"
    >
      <div className="customer-form-grid customer-shipping-form-grid">
        <DestinationSelect
          label="Destination and business"
          onChange={setDestinationOptionId}
          options={options}
          value={destinationOptionId}
        />
        <label>
          Vehicle owner
          <input
            autoComplete="name"
            onChange={(event) => setOwnerName(event.target.value)}
            required
            value={ownerName}
          />
        </label>
        <CustomerPhoneField
          label="Contact phone"
          onChange={setCustomerPhone}
          required
          value={customerPhone}
        />
        <label>
          Car make
          <input
            onChange={(event) => setCarMake(event.target.value)}
            placeholder="For example, Toyota"
            required
            value={carMake}
          />
        </label>
        <label>
          Car model
          <input
            onChange={(event) => setCarModel(event.target.value)}
            placeholder="For example, RAV4"
            required
            value={carModel}
          />
        </label>
        <label>
          Car year
          <input
            max={currentYear + 1}
            min={1900}
            onChange={(event) => setCarYear(event.target.value)}
            required
            type="number"
            value={carYear}
          />
        </label>
        <label>
          VIN number (optional)
          <input
            maxLength={17}
            onChange={(event) => setVinNumber(event.target.value.toUpperCase())}
            value={vinNumber}
          />
        </label>
        <label>
          Preferred transport date (optional)
          <input
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => setPreferredDate(event.target.value)}
            type="date"
            value={preferredDate}
          />
        </label>
        <label className="customer-form-span">
          Pickup address (optional)
          <input
            onChange={(event) => setPickupAddress(event.target.value)}
            placeholder="Street, city, state, ZIP code"
            value={pickupAddress}
          />
        </label>
        <label className="customer-form-span">
          Notes for the business (optional)
          <textarea
            maxLength={1000}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Share vehicle condition or pickup details"
            rows={4}
            value={notes}
          />
        </label>
      </div>
    </ServiceRequestForm>
  );
}

function DestinationSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: DestinationOption[];
  value: string;
}) {
  return (
    <label>
      {label}
      <select
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      >
        <option value="">Choose a destination and business</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function PickupFields({
  disabled = false,
  onAddressSelected,
  onPickupChanged,
  pickup,
  setPickup,
  suggestionsEnabled = true,
}: {
  disabled?: boolean;
  onAddressSelected?: (suggestion: AddressSuggestion) => void;
  onPickupChanged?: () => void;
  pickup: PickupDetails;
  setPickup: (pickup: PickupDetails) => void;
  suggestionsEnabled?: boolean;
}) {
  return (
    <>
      <label className="customer-choice-row customer-form-span">
        <input
          checked={pickup.requested}
          disabled={disabled}
          onChange={(event) => {
            setPickup({ ...pickup, requested: event.target.checked });
            onPickupChanged?.();
          }}
          type="checkbox"
        />
        <span>
          <strong>Request pickup</strong>
          <small>Choose an address and appointment time.</small>
        </span>
      </label>
      {pickup.requested && (
        <>
          <AddressAutocomplete
            suggestionsEnabled={suggestionsEnabled}
            onChange={(address) => {
              setPickup({ ...pickup, address, borough: "" });
              onPickupChanged?.();
            }}
            onSelect={(suggestion) => {
              setPickup({
                ...pickup,
                address:
                  suggestion.formattedAddress || suggestion.description,
                borough: suggestion.borough || "",
              });
              onAddressSelected?.(suggestion);
            }}
            value={pickup.address}
          />
          <label>
            Pickup borough
            <input
              onChange={(event) => {
                setPickup({ ...pickup, borough: event.target.value });
                onPickupChanged?.();
              }}
              placeholder="Selected from the address"
              required
              value={pickup.borough}
            />
          </label>
          <label>
            Pickup date and time
            <input
              min={new Date().toISOString().slice(0, 16)}
              onChange={(event) =>
                setPickup({ ...pickup, dateTime: event.target.value })
              }
              required
              type="datetime-local"
              value={pickup.dateTime || ""}
            />
          </label>
        </>
      )}
    </>
  );
}

function AddressAutocomplete({
  onChange,
  onSelect,
  suggestionsEnabled,
  value,
}: {
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  suggestionsEnabled: boolean;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState("");

  useEffect(() => {
    const query = value.trim();
    if (
      !suggestionsEnabled ||
      query.length < 3 ||
      query === selectedAddress
    ) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    let active = true;
    const debounce = setTimeout(() => {
      setLoading(true);
      void callFunction<AddressSuggestion[]>("suggestPickupAddresses", {
        input: query,
      })
        .then((result) => {
          if (active) setSuggestions(Array.isArray(result) ? result : []);
        })
        .catch(() => {
          if (active) setSuggestions([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(debounce);
    };
  }, [selectedAddress, suggestionsEnabled, value]);

  return (
    <div className="customer-address-field customer-form-span">
      <label htmlFor="customer-pickup-address">Pickup address</label>
      <div className="customer-address-control">
        <MapPin aria-hidden="true" size={17} />
        <input
          autoComplete="street-address"
          id="customer-pickup-address"
          onChange={(event) => {
            setSelectedAddress("");
            onChange(event.target.value);
          }}
          placeholder={
            suggestionsEnabled
              ? "Start typing a New York pickup address"
              : "Enter a New York pickup address"
          }
          required
          value={value}
        />
        {loading && <span className="loading-spinner" />}
      </div>
      {suggestions.length > 0 && (
        <div className="customer-address-suggestions" role="listbox">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.placeId}
              onClick={() => {
                const resolved =
                  suggestion.formattedAddress || suggestion.description;
                setSelectedAddress(resolved);
                setSuggestions([]);
                onSelect(suggestion);
              }}
              role="option"
              type="button"
            >
              <MapPin size={15} />
              <span>
                <strong>{suggestion.description}</strong>
                {suggestion.borough && <small>{suggestion.borough}</small>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewGrid({ children }: { children: React.ReactNode }) {
  return <dl className="customer-review-grid">{children}</dl>;
}

function ReviewDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ServiceUnavailable({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <section className="customer-service-unavailable">
      <Truck aria-hidden="true" size={28} />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
      {actionLabel && onAction && (
        <button className="secondary-button" onClick={onAction} type="button">
          <RefreshCw aria-hidden="true" size={16} />
          {actionLabel}
        </button>
      )}
    </section>
  );
}
