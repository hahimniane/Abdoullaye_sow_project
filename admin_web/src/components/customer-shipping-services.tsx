"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  Box,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  MapPin,
  PackageCheck,
  Plane,
  RefreshCw,
  Scale,
  ShieldCheck,
  Ship,
  Store,
  Truck,
  XCircle,
} from "lucide-react";

import {
  StructuredAddressFields,
  type AddressSuggestion,
} from "@/components/address-autocomplete";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { ServiceRequestForm } from "@/components/service-request-form";
import { SearchableSelect } from "@/components/searchable-select";
import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  canonicalMake,
  canonicalModel,
  getMakes,
  getModels,
  getYears,
} from "@/lib/car-catalog";
import {
  EMPTY_STRUCTURED_ADDRESS,
  composeAddressLine,
  type StructuredAddress,
} from "@/lib/address-fields";
import {
  applyStructuredAddress,
  barrelDestinationCountries,
  barrelOrderTotals,
  barrelProvidersForCountry,
  barrelShipmentEstimate,
  buildBarrelOrderPayload,
  buildBarrelShipmentPayload,
  buildFreightSettlementPayload,
  buildFreightShipmentPayload,
  freightProvidersForMode,
  freightShippingEstimate,
  freightSettlementIsPayable,
  localDateTimeInputValue,
  nycBoroughFromAddress,
  pickupDetailsAreComplete,
  pickupStructuredAddress,
  shippingOptionIsEligible,
  shippingCountryDisplayName,
  shippingProviderRate,
  type BarrelPickupQuote,
  type BarrelPickupQuoteResult,
  type PickupDetails,
} from "@/lib/customer-shipping";
import { marketplaceDisclosure } from "@/lib/disclosures";
import { db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import { currentWebLanguage } from "@/lib/language";
import { isValidPhone } from "@/lib/phone";
import {
  receiverPhoneIsDifferentCountry,
  validateReceiverPhone,
} from "@/lib/receiver-phone-rules";
import { startCheckout } from "@/lib/use-checkout";
import type { FirestoreRow, UserProfile } from "@/types/admin";

const CALL_TIMEOUT_MS = 30_000;

type ShippingService = "barrel" | "freight" | "transport";

type DeliveryEstimateService = "barrelShipping" | "freightAir" | "freightSea";

type DestinationCountry = {
  id: string;
  code?: string;
  name: string;
  isActive?: boolean;
  barrelShippingPrice?: number;
  freightAirPricePerKg?: number;
  freightSeaPricePerKg?: number;
  // Each service has its own real-world transit time, so the country
  // carries an independent estimate per service instead of one shared pair.
  barrelShippingDeliveryEstimateMinDays?: number;
  barrelShippingDeliveryEstimateMaxDays?: number;
  freightAirDeliveryEstimateMinDays?: number;
  freightAirDeliveryEstimateMaxDays?: number;
  freightSeaDeliveryEstimateMinDays?: number;
  freightSeaDeliveryEstimateMaxDays?: number;
  freightAirDepartureDays?: string[];
  freightSeaDepartureDays?: string[];
  destinationNote?: string;
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
  businessAddress?: string;
  enabledServices?: readonly string[];
  businessStatus?: string;
  freightPickupAvailable?: boolean;
  freightPickupModel?: "borough" | "distance";
  country: DestinationCountry;
};

type OfficeLocationOption = {
  id: string;
  label: string;
  address: string;
};

type DestinationLogisticsCountry = {
  barrelShippingDeliveryEstimateMinDays?: unknown;
  barrelShippingDeliveryEstimateMaxDays?: unknown;
  freightAirDeliveryEstimateMinDays?: unknown;
  freightAirDeliveryEstimateMaxDays?: unknown;
  freightSeaDeliveryEstimateMinDays?: unknown;
  freightSeaDeliveryEstimateMaxDays?: unknown;
  freightAirDepartureDays?: unknown;
  freightSeaDepartureDays?: unknown;
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

const departureDayLabels: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function deliveryWindow(
  country: DestinationLogisticsCountry,
  service: DeliveryEstimateService,
) {
  const minimum = Number(country[`${service}DeliveryEstimateMinDays`]);
  const maximum = Number(country[`${service}DeliveryEstimateMaxDays`]);
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum <= 0 ||
    maximum < minimum
  ) {
    return null;
  }
  return { minimum, maximum };
}

function departureDays(
  country: DestinationLogisticsCountry,
  mode: "air" | "sea",
) {
  const value =
    mode === "air"
      ? country.freightAirDepartureDays
      : country.freightSeaDepartureDays;
  if (!Array.isArray(value)) return [];
  return value.filter(
    (day): day is string =>
      typeof day === "string" && Boolean(departureDayLabels[day]),
  );
}

function DeliveryWindow({
  country,
  service,
}: {
  country: DestinationLogisticsCountry;
  service: DeliveryEstimateService;
}) {
  const window = deliveryWindow(country, service);
  if (!window) return null;
  const label =
    service === "freightAir"
      ? "Typical delivery (air)"
      : service === "freightSea"
        ? "Typical delivery (sea)"
        : "Typical delivery";
  return (
    <span className="customer-provider-logistics">
      <Clock3 aria-hidden="true" size={14} />
      <span>
        <small>{label}</small>
        <strong>
          {window.minimum === window.maximum
            ? window.minimum
            : `${window.minimum}–${window.maximum}`}{" "}
          <span>days</span>
        </strong>
      </span>
    </span>
  );
}

function FreightDepartureSchedule({
  country,
  mode,
}: {
  country: DestinationLogisticsCountry;
  mode: "air" | "sea";
}) {
  const days = departureDays(country, mode);
  if (days.length === 0) return null;
  return (
    <span className="customer-provider-logistics">
      <CalendarClock aria-hidden="true" size={14} />
      <span>
        <small>Regular departure days</small>
        <strong>
          {days.map((day, index) => (
            <span key={day}>
              {index > 0 && ", "}
              <span>{departureDayLabels[day]}</span>
            </span>
          ))}
        </strong>
      </span>
    </span>
  );
}

function destinationCountries(options: readonly DestinationOption[]) {
  const countries = new Map<string, DestinationCountry>();
  for (const option of options) {
    if (!countries.has(option.country.id)) {
      countries.set(option.country.id, option.country);
    }
  }
  return [...countries.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function selectedOption(
  options: DestinationOption[],
  id: string,
) {
  return options.find((option) => option.id === id);
}

function localDateTimeIso(value: string) {
  return new Date(value).toISOString();
}

// A business can register more than one physical office/drop-off location,
// so "bring to office" needs to show/let the customer choose among that
// specific business's own locations instead of one shared address.
function useOfficeLocations(businessId: string) {
  const [locations, setLocations] = useState<OfficeLocationOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!businessId) {
      setLocations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      query(
        collection(db, "businesses", businessId, "officeLocations"),
        where("isActive", "==", true),
      ),
      (snapshot) => {
        const rows = snapshot.docs
          .map((item) => {
            const data = item.data();
            return {
              id: item.id,
              label: text(data.label, "Office"),
              address: text(data.address, ""),
              sortOrder: Number(data.sortOrder || 0),
            };
          })
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder || a.label.localeCompare(b.label),
          );
        setLocations(rows);
        setLoading(false);
      },
      () => {
        setLocations([]);
        setLoading(false);
      },
    );
  }, [businessId]);

  return { locations, loading };
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

  // These catalogs come from callables, which answer once - so a business
  // switching a service or pickup off stayed visible until the customer
  // reloaded the page (docs/PLAN-2026-08-backlog.md #2). The server bumps
  // publicCatalog/services on every such change; re-ask whenever it does.
  // The document carries no business data, only a revision counter.
  useEffect(() => {
    let first = true;
    return onSnapshot(
      doc(db, "publicCatalog", "services"),
      () => {
        // The listener fires immediately with the current value; the initial
        // load above already covers that, so only later bumps matter.
        if (first) {
          first = false;
          return;
        }
        setOptionsReloadKey((current) => current + 1);
      },
      () => {
        // A customer who cannot read the signal simply keeps the behaviour
        // they have today rather than seeing an error for a freshness hint.
      },
    );
  }, []);

  const barrelOptions = useMemo(
    () =>
      destinationOptions.filter((option) =>
        shippingOptionIsEligible(option, "barrel"),
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
          note="Compare carrier quotes"
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
            <BarrelOrderForm
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
  const [receiverPhoneIsWhatsappOnly, setReceiverPhoneIsWhatsappOnly] =
    useState(false);
  const [receiverPhoneTouched, setReceiverPhoneTouched] = useState(false);
  const [destinationCountryId, setDestinationCountryId] = useState("");
  const [destinationOptionId, setDestinationOptionId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [pickup, setPickup] = useState<PickupDetails>({
    requested: true,
    address: "",
    borough: "",
  });
  const [pickupQuote, setPickupQuote] = useState<BarrelPickupQuote | null>(
    null,
  );
  const [pickupQuoteLoading, setPickupQuoteLoading] = useState(false);
  const [pickupQuoteError, setPickupQuoteError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const destination = selectedOption(options, destinationOptionId);
  const countries = useMemo(
    () => barrelDestinationCountries(options),
    [options],
  );
  const providers = useMemo(
    () => barrelProvidersForCountry(options, destinationCountryId),
    [destinationCountryId, options],
  );
  // Only one business serves this country: choosing from a list of one is
  // busywork, and freight already behaves this way (item 6).
  useEffect(() => {
    if (!destinationOptionId && providers.length === 1) {
      setDestinationOptionId(providers[0].id);
    }
  }, [destinationOptionId, providers]);
  const selectedCountry = countries.find(
    (country) => country.id === destinationCountryId,
  );
  const language = currentWebLanguage();
  const countryName = (
    country: Pick<DestinationCountry, "code" | "name">,
  ) =>
    shippingCountryDisplayName(country, language);
  const phoneValidation = validateReceiverPhone({
    allowDifferentCountry: receiverPhoneIsWhatsappOnly,
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const showWhatsappOption = receiverPhoneIsDifferentCountry({
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const phoneError =
    receiverPhoneTouched && !phoneValidation.valid
      ? phoneValidation.reason === "required"
        ? "Enter the receiver phone number."
        : phoneValidation.reason === "destination-mismatch"
          ? "Receiver phone must match the destination country. Use the WhatsApp option below for a number from another country."
          : phoneValidation.reason === "whatsapp-country-code"
            ? "Include the country calling code for a WhatsApp number."
            : "Enter a valid international phone number."
      : "";
  const pricing = destination
    ? barrelShipmentEstimate({
        country: destination.country,
        pickupBorough: pickup.borough,
        pickupPricing: null,
        pickupQuote: pickupQuote?.fee,
        pickupRequested: pickup.requested,
        quantity,
      })
    : null;
  const pickupFee = pricing?.pickupFee ?? null;
  const estimatedTotal = pricing?.total ?? null;
  const officeLocations = useOfficeLocations(destination?.businessId ?? "");
  const [officeLocationId, setOfficeLocationId] = useState("");
  useEffect(() => {
    if (officeLocations.locations.length === 0) {
      setOfficeLocationId("");
    } else if (
      !officeLocations.locations.some((location) => location.id === officeLocationId)
    ) {
      setOfficeLocationId(officeLocations.locations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeLocations.locations]);
  const officeAddress =
    officeLocations.locations.find((location) => location.id === officeLocationId)
      ?.address ??
    destination?.businessAddress ??
    "the business office";

  // The business's plan prices pickup on the server; re-quote whenever the
  // provider changes so one business's fee never shows against another.
  useEffect(() => {
    setPickupQuote(null);
    setPickupQuoteError("");
  }, [destinationOptionId]);

  async function quotePickup(addressOverride?: string) {
    const pickupAddress = (addressOverride ?? pickup.address).trim();
    if (!pickupAddress || !destination) return;
    setPickupQuoteLoading(true);
    setPickupQuoteError("");
    setPickupQuote(null);
    try {
      const quote = await callFunction<BarrelPickupQuoteResult>(
        "quoteBarrelPickup",
        {
          businessId: destination.businessId,
          pickupAddress,
        },
      );
      if (quote.available) {
        setPickup((current) => ({
          ...current,
          address: quote.normalizedAddress,
          borough: quote.borough,
        }));
        setPickupQuote(quote);
      } else {
        setPickupQuoteError(
          "This business does not offer home pickup yet. Choose office drop-off or another provider.",
        );
      }
    } catch {
      setPickupQuoteError(
        "Pickup is not available for this address. Check the address or choose office drop-off.",
      );
    } finally {
      setPickupQuoteLoading(false);
    }
  }

  const valid =
    Boolean(
      senderName.trim() &&
        receiverName.trim() &&
        destination &&
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= 20,
    ) &&
    phoneValidation.valid &&
    pickupDetailsAreComplete(pickup) &&
    (!pickup.requested ||
      (!pickupQuoteLoading && !pickupQuoteError && pickupFee !== null)) &&
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
            officeLocationId,
          },
          marketplaceDisclosure(accepted),
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
        setReceiverPhoneIsWhatsappOnly(false);
        setReceiverPhoneTouched(false);
        setDestinationCountryId("");
        setDestinationOptionId("");
        setPickup({ requested: true, address: "", borough: "" });
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
            value={
              destination
                ? `${countryName(destination.country)} · ${destination.businessName}`
                : ""
            }
          />
          {pricing && (
            <>
              <ReviewDetail
                label="Price per barrel"
                value={formatMoney(pricing.rate)}
              />
              <ReviewDetail
                label="Estimated shipping"
                value={formatMoney(pricing.subtotal)}
              />
              {pickup.requested && pickupFee !== null && (
                <ReviewDetail
                  label="Pickup fee"
                  value={formatMoney(pickupFee)}
                />
              )}
              {estimatedTotal !== null && (
                <ReviewDetail
                  label="Estimated total"
                  value={formatMoney(estimatedTotal)}
                />
              )}
            </>
          )}
          <ReviewDetail label="Barrels" value={String(quantity)} />
          <ReviewDetail
            label="Pickup"
            value={pickup.requested ? pickup.address : "Drop off"}
          />
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
      <div className="customer-barrel-journey">
        <section className="customer-barrel-stage active">
          <header className="customer-barrel-stage-header">
            <span aria-hidden="true">1</span>
            <div>
              <small>Destination country</small>
              <h3>Where are you sending the barrel?</h3>
            </div>
          </header>
          <SearchableSelect
            className="customer-barrel-country"
            emptyMessage="No destination countries match your search."
            label="Destination country"
            listLabel="Destination country options"
            onChange={(value) => {
              setDestinationCountryId(value);
              setDestinationOptionId("");
              setReceiverPhoneIsWhatsappOnly(false);
              setReceiverPhoneTouched(false);
            }}
            options={countries.map((country) => ({
              label: countryName(country),
              keywords: `${country.code || ""} ${country.name}`,
              value: country.id,
            }))}
            placeholder="Search or choose a country"
            value={destinationCountryId}
          />
        </section>

        {selectedCountry && (
          <section className="customer-barrel-stage active">
            <header className="customer-barrel-stage-header">
              <span aria-hidden="true">2</span>
              <div>
                <small>Shipping business</small>
                <h3>
                  Approved businesses shipping to{" "}
                  <strong>{countryName(selectedCountry)}</strong>
                </h3>
              </div>
              <button
                className="customer-barrel-change"
                onClick={() => {
                  setDestinationCountryId("");
                  setDestinationOptionId("");
                  setReceiverPhoneIsWhatsappOnly(false);
                }}
                type="button"
              >
                Change country
              </button>
            </header>
            <fieldset className="customer-barrel-providers">
              <legend className="sr-only">Choose a shipping business</legend>
              <p aria-live="polite" className="sr-only">
                {providers.length} approved businesses available
              </p>
              {providers.map((option) => {
                const rate = shippingProviderRate(option.country, "barrel");
                return (
                  <label
                    className={`customer-barrel-provider${destinationOptionId === option.id ? " selected" : ""}`}
                    key={option.id}
                  >
                    <input
                      checked={destinationOptionId === option.id}
                      name="barrel-provider"
                      onChange={() => setDestinationOptionId(option.id)}
                      type="radio"
                      value={option.id}
                    />
                    <span className="customer-option-icon">
                      <Store aria-hidden="true" size={19} />
                    </span>
                    <span className="customer-barrel-provider-name">
                      <strong>{option.businessName}</strong>
                      <small>Approved business</small>
                      <DeliveryWindow country={option.country} service="barrelShipping" />
                    </span>
                    <span className="customer-barrel-provider-price">
                      <strong>{rate ? formatMoney(rate) : "Rate unavailable"}</strong>
                      <small>per barrel</small>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          </section>
        )}

        {destination && (
          <section className="customer-barrel-stage customer-barrel-details active">
            <header className="customer-barrel-stage-header">
              <span aria-hidden="true">3</span>
              <div>
                <small>Shipment details</small>
                <h3>Tell us who is sending and receiving.</h3>
              </div>
            </header>
            <div className="customer-barrel-selected-provider">
              <span className="customer-option-icon">
                <Store aria-hidden="true" size={19} />
              </span>
              <span>
                <strong>{destination.businessName}</strong>
                <small>{countryName(destination.country)}</small>
              </span>
              <span>
                <strong>
                  {pricing ? formatMoney(pricing.rate) : "Rate unavailable"}
                </strong>
                <small>per barrel</small>
              </span>
              <button
                className="customer-barrel-change"
                onClick={() => setDestinationOptionId("")}
                type="button"
              >
                Change
              </button>
            </div>
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
                error={phoneError}
                id="barrel-receiver-phone"
                initialCountryCode={selectedCountry?.code || "US"}
                label="Receiver phone"
                onBlur={() => setReceiverPhoneTouched(true)}
                onChange={(value) => {
                  setReceiverPhone(value);
                  if (receiverPhoneTouched) setReceiverPhoneTouched(true);
                  if (
                    !receiverPhoneIsDifferentCountry({
                      destinationCountryCode: selectedCountry?.code,
                      value,
                    })
                  ) {
                    setReceiverPhoneIsWhatsappOnly(false);
                  }
                }}
                required
                value={receiverPhone}
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
              {showWhatsappOption && (
                <label className="customer-choice-row customer-form-span">
                  <input
                    checked={receiverPhoneIsWhatsappOnly}
                    onChange={(event) => {
                      setReceiverPhoneIsWhatsappOnly(event.target.checked);
                      setReceiverPhoneTouched(true);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <strong>
                      This receiver uses a WhatsApp number from another country
                    </strong>
                    <small>
                      The number must include its international calling code.
                    </small>
                  </span>
                </label>
              )}
              <PickupFields
                officeAddress={officeAddress}
                officeLocations={officeLocations.locations}
                officeLocationsLoading={officeLocations.loading}
                selectedOfficeLocationId={officeLocationId}
                onOfficeLocationChange={setOfficeLocationId}
                onAddressBlur={() => void quotePickup()}
                onAddressSelected={(suggestion) =>
                  void quotePickup(
                    suggestion.formattedAddress || suggestion.description,
                  )
                }
                onPickupChanged={() => {
                  setPickupQuote(null);
                  setPickupQuoteError("");
                }}
                pickup={pickup}
                setPickup={setPickup}
                suggestionsEnabled={authenticated}
              />
              {pickup.requested && (
                <PickupAvailability
                  error={pickupQuoteError}
                  onRetry={() => void quotePickup()}
                  quote={pickupQuote}
                  quoting={pickupQuoteLoading}
                />
              )}
              {pricing && (
                <ShippingPriceSummary
                  details={[
                    {
                      label: "Price per barrel",
                      value: formatMoney(pricing.rate),
                    },
                    {
                      label: "Barrels",
                      value: String(pricing.quantity),
                    },
                    ...(pickup.requested && pickupFee !== null
                      ? [{
                          label: "Pickup fee",
                          value: formatMoney(pickupFee),
                        }]
                      : pickup.requested
                        ? [{ label: "Pickup fee", value: "Pending" }]
                        : []),
                  ]}
                  note={
                    pickup.requested
                      ? estimatedTotal === null
                        ? "Enter a valid pickup address to see the complete total."
                        : "Pickup pricing is confirmed from the pickup address."
                      : (
                          <>
                            <span>Bring the barrel to</span> {officeAddress}.
                          </>
                        )
                  }
                  provider={destination.businessName}
                  total={formatMoney(estimatedTotal ?? pricing.subtotal)}
                  totalLabel={
                    pickup.requested && estimatedTotal === null
                      ? "Shipping subtotal"
                      : pickup.requested
                        ? "Estimated total"
                        : "Estimated shipping"
                  }
                />
              )}
              <div className="customer-form-span">
                <DisclosureCheckbox
                  accepted={accepted}
                  onChange={setAccepted}
                />
              </div>
            </div>
          </section>
        )}
      </div>
    </ServiceRequestForm>
  );
}

type BarrelOrderLine = {
  id: string;
  option: DestinationOption;
  receiverName: string;
  receiverPhone: string;
  receiverPhoneIsWhatsappOnly: boolean;
  quantity: number;
  pickup: PickupDetails;
  pickupQuote: BarrelPickupQuote | null;
  officeLocationId: string;
};

function BarrelOrderForm({
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
  const [lines, setLines] = useState<BarrelOrderLine[]>([]);
  const [editorOpen, setEditorOpen] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [destinationCountryId, setDestinationCountryId] = useState("");
  const [destinationOptionId, setDestinationOptionId] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverPhoneIsWhatsappOnly, setReceiverPhoneIsWhatsappOnly] =
    useState(false);
  const [receiverPhoneTouched, setReceiverPhoneTouched] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [sharedPickup, setSharedPickup] = useState<PickupDetails>({
    requested: true,
    address: "",
    borough: "",
  });
  const [sharedPickupQuote, setSharedPickupQuote] =
    useState<BarrelPickupQuote | null>(null);
  const [differentPickups, setDifferentPickups] = useState(false);
  const [quotingPickupId, setQuotingPickupId] = useState("");
  const [pickupQuoteError, setPickupQuoteError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const countries = useMemo(
    () => barrelDestinationCountries(options),
    [options],
  );
  const providers = useMemo(
    () => barrelProvidersForCountry(options, destinationCountryId),
    [destinationCountryId, options],
  );
  // Only one business serves this country: choosing from a list of one is
  // busywork, and freight already behaves this way (item 6).
  useEffect(() => {
    if (!destinationOptionId && providers.length === 1) {
      setDestinationOptionId(providers[0].id);
    }
  }, [destinationOptionId, providers]);
  const selectedCountry = countries.find(
    (country) => country.id === destinationCountryId,
  );
  const destination = selectedOption(options, destinationOptionId);
  const language = currentWebLanguage();
  const countryName = (
    country: Pick<DestinationCountry, "code" | "name">,
  ) => shippingCountryDisplayName(country, language);
  const phoneValidation = validateReceiverPhone({
    allowDifferentCountry: receiverPhoneIsWhatsappOnly,
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const showWhatsappOption = receiverPhoneIsDifferentCountry({
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const phoneError =
    receiverPhoneTouched && !phoneValidation.valid
      ? phoneValidation.reason === "required"
        ? "Enter the receiver phone number."
        : phoneValidation.reason === "destination-mismatch"
          ? "Receiver phone must match the destination country. Use the WhatsApp option below for a number from another country."
          : phoneValidation.reason === "whatsapp-country-code"
            ? "Include the country calling code for a WhatsApp number."
            : "Enter a valid international phone number."
      : "";
  const editorOfficeLocations = useOfficeLocations(destination?.businessId ?? "");
  const [editorOfficeLocationId, setEditorOfficeLocationId] = useState("");
  useEffect(() => {
    if (editorOfficeLocations.locations.length === 0) {
      setEditorOfficeLocationId("");
    } else if (
      !editorOfficeLocations.locations.some(
        (location) => location.id === editorOfficeLocationId,
      )
    ) {
      setEditorOfficeLocationId(editorOfficeLocations.locations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOfficeLocations.locations]);
  const editorOfficeAddress =
    editorOfficeLocations.locations.find(
      (location) => location.id === editorOfficeLocationId,
    )?.address ??
    destination?.businessAddress ??
    "the business office";
  // The shared-pickup summary (used when lines don't set their own pickup)
  // reflects the first destination's business, since that is the common
  // single-business-order case.
  const sharedOfficeLocations = useOfficeLocations(
    lines[0]?.option.businessId ?? "",
  );
  const [sharedOfficeLocationId, setSharedOfficeLocationId] = useState("");
  useEffect(() => {
    if (sharedOfficeLocations.locations.length === 0) {
      setSharedOfficeLocationId("");
    } else if (
      !sharedOfficeLocations.locations.some(
        (location) => location.id === sharedOfficeLocationId,
      )
    ) {
      setSharedOfficeLocationId(sharedOfficeLocations.locations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedOfficeLocations.locations]);
  const sharedOfficeAddress =
    sharedOfficeLocations.locations.find(
      (location) => location.id === sharedOfficeLocationId,
    )?.address ??
    lines[0]?.option.businessAddress ??
    "the business office";
  const totalBarrels = lines.reduce(
    (total, line) => total + line.quantity,
    0,
  );
  const canUseDifferentPickups = lines.length > 1 && totalBarrels > 1;
  const usesDifferentPickups = canUseDifferentPickups && differentPickups;
  const totals = barrelOrderTotals({
    lines: lines.map((line) => ({
      unitShippingFee:
        shippingProviderRate(line.option.country, "barrel") ?? 0,
      quantity: line.quantity,
      pickupFee: line.pickup.requested
        ? line.pickupQuote?.fee ?? 0
        : 0,
    })),
    sharedPickupFee: sharedPickup.requested
      ? sharedPickupQuote?.fee ?? 0
      : 0,
    useDifferentPickupDetails: usesDifferentPickups,
  });
  const pickupReady = usesDifferentPickups
    ? lines.every(
        (line) =>
          pickupDetailsAreComplete(line.pickup) &&
          (!line.pickup.requested || line.pickupQuote !== null),
      )
    : pickupDetailsAreComplete(sharedPickup) &&
      (!sharedPickup.requested || sharedPickupQuote !== null);
  const draftValid =
    Boolean(
      destination &&
        receiverName.trim() &&
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= 20,
    ) && phoneValidation.valid;
  const readyForReview = Boolean(
    senderName.trim() && lines.length > 0 && pickupReady,
  );
  const valid = readyForReview && accepted;

  function resetEditor() {
    setEditingIndex(null);
    setDestinationCountryId("");
    setDestinationOptionId("");
    setReceiverName("");
    setReceiverPhone("");
    setReceiverPhoneIsWhatsappOnly(false);
    setReceiverPhoneTouched(false);
    setQuantity(1);
  }

  function saveLine() {
    if (!draftValid || !destination) {
      setReceiverPhoneTouched(true);
      return;
    }
    const previous =
      editingIndex === null ? null : lines[editingIndex];
    const line: BarrelOrderLine = {
      id:
        previous?.id ??
        `barrel-line-${Date.now()}-${lines.length}`,
      option: destination,
      receiverName: receiverName.trim(),
      receiverPhone: receiverPhone.trim(),
      receiverPhoneIsWhatsappOnly,
      quantity,
      pickup: previous?.pickup ?? { ...sharedPickup },
      pickupQuote: previous?.pickupQuote ?? sharedPickupQuote,
      officeLocationId: previous?.officeLocationId ?? editorOfficeLocationId,
    };
    setLines((current) =>
      editingIndex === null
        ? [...current, line]
        : current.map((item, index) =>
            index === editingIndex ? line : item,
          ),
    );
    resetEditor();
    setEditorOpen(false);
  }

  function editLine(index: number) {
    const line = lines[index];
    setEditingIndex(index);
    setDestinationCountryId(line.option.country.id);
    setDestinationOptionId(line.option.id);
    setReceiverName(line.receiverName);
    setReceiverPhone(line.receiverPhone);
    setReceiverPhoneIsWhatsappOnly(
      line.receiverPhoneIsWhatsappOnly,
    );
    setReceiverPhoneTouched(false);
    setQuantity(line.quantity);
    setEditorOfficeLocationId(line.officeLocationId);
    setEditorOpen(true);
  }

  async function requestPickupQuote(
    pickup: PickupDetails,
    id: string,
    businessId: string,
    addressOverride?: string,
  ) {
    const pickupAddress = (addressOverride ?? pickup.address).trim();
    if (!pickupAddress || !businessId || quotingPickupId) return null;
    setQuotingPickupId(id);
    setPickupQuoteError("");
    try {
      const quote = await callFunction<BarrelPickupQuoteResult>(
        "quoteBarrelPickup",
        {
          businessId,
          pickupAddress,
        },
      );
      if (!quote.available) {
        setPickupQuoteError(
          "This business does not offer home pickup yet. Choose office drop-off or another provider.",
        );
        return null;
      }
      return quote;
    } catch {
      setPickupQuoteError(
        "We couldn’t check pickup availability. Check the address and try again.",
      );
      return null;
    } finally {
      setQuotingPickupId("");
    }
  }

  async function quoteSharedPickup(addressOverride?: string) {
    // A shared pickup is priced per line business on the server; the first
    // line's business gives the representative quote shown here.
    const sharedBusinessId =
      lines[0]?.option.businessId ?? destination?.businessId ?? "";
    const quote = await requestPickupQuote(
      sharedPickup,
      "shared",
      sharedBusinessId,
      addressOverride,
    );
    if (!quote) return;
    setSharedPickup({
      ...sharedPickup,
      address: quote.normalizedAddress,
      borough: quote.borough,
    });
    setSharedPickupQuote(quote);
  }

  async function quoteLinePickup(lineId: string, addressOverride?: string) {
    const line = lines.find((item) => item.id === lineId);
    if (!line) return;
    const quote = await requestPickupQuote(
      line.pickup,
      lineId,
      line.option.businessId,
      addressOverride,
    );
    if (!quote) return;
    setLines((current) =>
      current.map((item) =>
        item.id === lineId
          ? {
              ...item,
              pickup: {
                ...item.pickup,
                address: quote.normalizedAddress,
                borough: quote.borough,
              },
              pickupQuote: quote,
            }
          : item,
      ),
    );
  }

  async function submit() {
    if (!valid || submitting) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await startCheckout(
        "barrelOrder",
        buildBarrelOrderPayload(
          {
            senderName,
            lines: lines.map((line) => ({
              destinationCountryId: line.option.country.id,
              businessId: line.option.businessId,
              receiverName: line.receiverName,
              receiverPhone: line.receiverPhone,
              quantity: line.quantity,
              // Office location always travels per line (it depends on that
              // line's own business), even when pickup itself is shared.
              officeLocationId: usesDifferentPickups
                ? line.officeLocationId
                : sharedOfficeLocationId,
              ...(usesDifferentPickups && {
                pickup: {
                  ...line.pickup,
                  ...(line.pickup.dateTime && {
                    dateTime: localDateTimeIso(line.pickup.dateTime),
                  }),
                },
              }),
            })),
            ...(!usesDifferentPickups && {
              sharedPickup: {
                ...sharedPickup,
                ...(sharedPickup.dateTime && {
                  dateTime: localDateTimeIso(sharedPickup.dateTime),
                }),
              },
            }),
            useDifferentPickupDetails: usesDifferentPickups,
          },
          marketplaceDisclosure(accepted),
        ),
      );
    } catch {
      setError(
        "The barrel order could not be started. Check the details and try again.",
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
      canReview={readyForReview}
      canSubmit={valid}
      error={error}
      intro="Add each destination, business, receiver, and barrel quantity to one order."
      onCancel={() => {
        setLines([]);
        resetEditor();
        setEditorOpen(true);
        setSharedPickup({ requested: true, address: "", borough: "" });
        setSharedPickupQuote(null);
        setDifferentPickups(false);
        setAccepted(false);
      }}
      onSubmit={submit}
      review={
        <ReviewGrid>
          <ReviewDetail label="Sender" value={senderName} />
          <ReviewDetail
            label="Order"
            value={`${totals.totalBarrels} ${
              totals.totalBarrels === 1 ? "barrel" : "barrels"
            } · ${totals.lineCount} ${
              totals.lineCount === 1
                ? "destination shipment"
                : "destination shipments"
            }`}
          />
          {lines.map((line, index) => (
            <ReviewDetail
              key={line.id}
              label={`Destination ${index + 1}`}
              value={`${countryName(line.option.country)} · ${
                line.option.businessName
              } · ${line.quantity} ${
                line.quantity === 1 ? "barrel" : "barrels"
              } · ${line.receiverName}`}
            />
          ))}
          <ReviewDetail
            label="Shipping subtotal"
            value={formatMoney(totals.shippingFee)}
          />
          <ReviewDetail
            label="Pickup total"
            value={formatMoney(totals.pickupFee)}
          />
          <ReviewDetail
            label="Estimated total"
            value={formatMoney(totals.total)}
          />
          <DisclosureCheckbox accepted={accepted} onChange={setAccepted} />
        </ReviewGrid>
      }
      submitLabel={
        authenticated
          ? "Continue to secure payment"
          : "Sign in to save & continue"
      }
      submitting={submitting}
      title="Send barrels"
    >
      <div className="customer-barrel-journey">
        <section className="customer-barrel-stage active">
          <header className="customer-barrel-stage-header">
            <span aria-hidden="true">1</span>
            <div>
              <small>Sender</small>
              <h3>Who is sending this barrel order?</h3>
            </div>
          </header>
          <label>
            Sender name
            <input
              autoComplete="name"
              onChange={(event) => setSenderName(event.target.value)}
              required
              value={senderName}
            />
          </label>
        </section>

        {lines.length > 0 && (
          <section className="customer-barrel-stage active">
            <header className="customer-barrel-stage-header">
              <span aria-hidden="true">2</span>
              <div>
                <small>Destinations</small>
                <h3>
                  {totals.totalBarrels}{" "}
                  {totals.totalBarrels === 1 ? "barrel" : "barrels"} ·{" "}
                  {totals.lineCount}{" "}
                  {totals.lineCount === 1
                    ? "destination shipment"
                    : "destination shipments"}
                </h3>
              </div>
            </header>
            <div className="customer-barrel-order-lines">
              {lines.map((line, index) => {
                const rate =
                  shippingProviderRate(line.option.country, "barrel") ?? 0;
                return (
                  <article className="customer-barrel-order-line" key={line.id}>
                    <div>
                      <small>Destination {index + 1}</small>
                      <strong>{countryName(line.option.country)}</strong>
                      <span>{line.option.businessName}</span>
                    </div>
                    <div>
                      <small>Receiver</small>
                      <strong>{line.receiverName}</strong>
                      <span>{line.receiverPhone}</span>
                    </div>
                    <div>
                      <small>Shipping</small>
                      <strong>{formatMoney(rate * line.quantity)}</strong>
                      <span>
                        {line.quantity} × {formatMoney(rate)}
                      </span>
                    </div>
                    <div className="customer-barrel-line-actions">
                      <button
                        className="secondary-button"
                        onClick={() => editLine(index)}
                        type="button"
                      >
                        Edit
                      </button>
                      <button
                        className="customer-barrel-remove"
                        onClick={() => {
                          setLines((current) =>
                            current.filter(
                              (_, lineIndex) => lineIndex !== index,
                            ),
                          );
                          if (lines.length <= 2) setDifferentPickups(false);
                        }}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
            {lines.length < 10 && !editorOpen && (
              <button
                className="secondary-button customer-barrel-add-line"
                onClick={() => {
                  resetEditor();
                  setEditorOpen(true);
                }}
                type="button"
              >
                Add another destination
              </button>
            )}
          </section>
        )}

        {editorOpen && (
          <section className="customer-barrel-stage active">
            <header className="customer-barrel-stage-header">
              <span aria-hidden="true">{lines.length > 0 ? "＋" : "2"}</span>
              <div>
                <small>
                  {editingIndex === null
                    ? "Add a destination"
                    : "Edit destination"}
                </small>
                <h3>Choose the country, business, receiver, and quantity.</h3>
              </div>
              {lines.length > 0 && (
                <button
                  className="customer-barrel-change"
                  onClick={() => {
                    resetEditor();
                    setEditorOpen(false);
                  }}
                  type="button"
                >
                  Close
                </button>
              )}
            </header>
            <SearchableSelect
              className="customer-barrel-country"
              emptyMessage="No destination countries match your search."
              label="Destination country"
              listLabel="Destination country options"
              onChange={(value) => {
                setDestinationCountryId(value);
                setDestinationOptionId("");
                setReceiverPhoneIsWhatsappOnly(false);
                setReceiverPhoneTouched(false);
              }}
              options={countries.map((country) => ({
                label: countryName(country),
                keywords: `${country.code || ""} ${country.name}`,
                value: country.id,
              }))}
              placeholder="Search or choose a country"
              value={destinationCountryId}
            />
            {selectedCountry && (
              <fieldset className="customer-barrel-providers">
                <legend>Choose a shipping business</legend>
                {providers.map((option) => {
                  const rate = shippingProviderRate(option.country, "barrel");
                  return (
                    <label
                      className={`customer-barrel-provider${destinationOptionId === option.id ? " selected" : ""}`}
                      key={option.id}
                    >
                      <input
                        checked={destinationOptionId === option.id}
                        name="barrel-provider"
                        onChange={() => setDestinationOptionId(option.id)}
                        type="radio"
                        value={option.id}
                      />
                      <span className="customer-option-icon">
                        <Store aria-hidden="true" size={19} />
                      </span>
                      <span className="customer-barrel-provider-name">
                        <strong>{option.businessName}</strong>
                        <small>Approved business</small>
                        <DeliveryWindow country={option.country} service="barrelShipping" />
                      </span>
                      <span className="customer-barrel-provider-price">
                        <strong>
                          {rate ? formatMoney(rate) : "Rate unavailable"}
                        </strong>
                        <small>per barrel</small>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            )}
            {destination && (
              <div className="customer-form-grid customer-shipping-form-grid">
                <label>
                  Receiver name
                  <input
                    onChange={(event) => setReceiverName(event.target.value)}
                    required
                    value={receiverName}
                  />
                </label>
                <CustomerPhoneField
                  error={phoneError}
                  id="barrel-order-receiver-phone"
                  initialCountryCode={selectedCountry?.code || "US"}
                  label="Receiver phone"
                  onBlur={() => setReceiverPhoneTouched(true)}
                  onChange={(value) => {
                    setReceiverPhone(value);
                    if (
                      !receiverPhoneIsDifferentCountry({
                        destinationCountryCode: selectedCountry?.code,
                        value,
                      })
                    ) {
                      setReceiverPhoneIsWhatsappOnly(false);
                    }
                  }}
                  required
                  value={receiverPhone}
                />
                <label>
                  Barrels for this destination
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
                <div className="customer-line-subtotal">
                  <small>Shipping subtotal</small>
                  <strong>
                    {formatMoney(
                      (shippingProviderRate(destination.country, "barrel") ??
                        0) * quantity,
                    )}
                  </strong>
                </div>
                {showWhatsappOption && (
                  <label className="customer-choice-row customer-form-span">
                    <input
                      checked={receiverPhoneIsWhatsappOnly}
                      onChange={(event) => {
                        setReceiverPhoneIsWhatsappOnly(event.target.checked);
                        setReceiverPhoneTouched(true);
                      }}
                      type="checkbox"
                    />
                    <span>
                      <strong>
                        This receiver uses a WhatsApp number from another country
                      </strong>
                      <small>
                        The number must include its international calling code.
                      </small>
                    </span>
                  </label>
                )}
                <button
                  className="primary-button customer-form-span"
                  disabled={!draftValid}
                  onClick={saveLine}
                  type="button"
                >
                  {editingIndex === null
                    ? "Add to order"
                    : "Save destination"}
                </button>
              </div>
            )}
          </section>
        )}

        {lines.length > 0 && (
          <section className="customer-barrel-stage active">
            <header className="customer-barrel-stage-header">
              <span aria-hidden="true">3</span>
              <div>
                <small>Pickup</small>
                <h3>How should these destination shipments be collected?</h3>
              </div>
            </header>
            {canUseDifferentPickups && (
              <fieldset className="customer-segmented customer-form-span">
                <legend>Pickup details</legend>
                <button
                  aria-pressed={!usesDifferentPickups}
                  className={!usesDifferentPickups ? "active" : ""}
                  onClick={() => setDifferentPickups(false)}
                  type="button"
                >
                  Same pickup
                </button>
                <button
                  aria-pressed={usesDifferentPickups}
                  className={usesDifferentPickups ? "active" : ""}
                  onClick={() => {
                    setDifferentPickups(true);
                    setLines((current) =>
                      current.map((line) => ({
                        ...line,
                        pickup: { ...sharedPickup },
                        pickupQuote: sharedPickupQuote,
                      })),
                    );
                  }}
                  type="button"
                >
                  Different pickups
                </button>
              </fieldset>
            )}
            {!usesDifferentPickups ? (
              <div className="customer-form-grid customer-shipping-form-grid">
                <PickupFields
                  idSuffix="shared-order"
                  officeAddress={sharedOfficeAddress}
                  officeLocations={sharedOfficeLocations.locations}
                  officeLocationsLoading={sharedOfficeLocations.loading}
                  selectedOfficeLocationId={sharedOfficeLocationId}
                  onOfficeLocationChange={setSharedOfficeLocationId}
                  onAddressBlur={() => void quoteSharedPickup()}
                  onAddressSelected={(suggestion) =>
                    void quoteSharedPickup(
                      suggestion.formattedAddress || suggestion.description,
                    )
                  }
                  onPickupChanged={() => {
                    setSharedPickupQuote(null);
                    setPickupQuoteError("");
                  }}
                  pickup={sharedPickup}
                  setPickup={setSharedPickup}
                  suggestionsEnabled
                />
                {sharedPickup.requested && (
                  <PickupAvailability
                    error={pickupQuoteError}
                    onRetry={() => void quoteSharedPickup()}
                    quote={sharedPickupQuote}
                    quoting={quotingPickupId === "shared"}
                  />
                )}
              </div>
            ) : (
              <div className="customer-line-pickups">
                {lines.map((line, index) => (
                  <BarrelOrderLinePickup
                    countryLabel={countryName(line.option.country)}
                    index={index}
                    key={line.id}
                    line={line}
                    onAddressSelected={(suggestion) =>
                      void quoteLinePickup(
                        line.id,
                        suggestion.formattedAddress || suggestion.description,
                      )
                    }
                    onOfficeLocationChange={(officeLocationId) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? { ...item, officeLocationId }
                            : item,
                        ),
                      )
                    }
                    onPickupBlur={() => void quoteLinePickup(line.id)}
                    onPickupChanged={() => {
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id
                            ? { ...item, pickupQuote: null }
                            : item,
                        ),
                      );
                      setPickupQuoteError("");
                    }}
                    pickupQuoteError={
                      quotingPickupId === line.id ? "" : pickupQuoteError
                    }
                    quoting={quotingPickupId === line.id}
                    onRetryPickupQuote={() => void quoteLinePickup(line.id)}
                    setPickup={(pickup) =>
                      setLines((current) =>
                        current.map((item) =>
                          item.id === line.id ? { ...item, pickup } : item,
                        ),
                      )
                    }
                  />
                ))}
              </div>
            )}
            <ShippingPriceSummary
              details={[
                {
                  label: "Total barrels",
                  value: String(totals.totalBarrels),
                },
                {
                  label: "Destination shipments",
                  value: String(totals.lineCount),
                },
                {
                  label: "Shipping subtotal",
                  value: formatMoney(totals.shippingFee),
                },
                {
                  label: "Pickup total",
                  value: pickupReady
                    ? formatMoney(totals.pickupFee)
                    : "Pending",
                },
              ]}
              note={
                pickupReady
                  ? usesDifferentPickups
                    ? "Each pickup fee is shown for its destination shipment."
                    : "The shared pickup fee is charged once per destination shipment."
                  : "Enter a pickup address to see the complete total."
              }
              provider="Barrel order"
              total={pickupReady ? formatMoney(totals.total) : "—"}
              totalLabel={pickupReady ? "Estimated total" : "Total pending"}
            />
          </section>
        )}
      </div>
    </ServiceRequestForm>
  );
}

function BarrelOrderLinePickup({
  countryLabel,
  index,
  line,
  onAddressSelected,
  onOfficeLocationChange,
  onPickupBlur,
  onPickupChanged,
  onRetryPickupQuote,
  pickupQuoteError,
  quoting,
  setPickup,
}: {
  countryLabel: string;
  index: number;
  line: BarrelOrderLine;
  onAddressSelected: (suggestion: AddressSuggestion) => void;
  onOfficeLocationChange: (officeLocationId: string) => void;
  onPickupBlur: () => void;
  onPickupChanged: () => void;
  onRetryPickupQuote: () => void;
  pickupQuoteError: string;
  quoting: boolean;
  setPickup: (pickup: PickupDetails) => void;
}) {
  // Each destination line can be a different business, so its office
  // locations must be looked up independently rather than sharing one hook
  // call across the whole order.
  const officeLocations = useOfficeLocations(line.option.businessId);
  const officeAddress =
    officeLocations.locations.find(
      (location) => location.id === line.officeLocationId,
    )?.address ??
    line.option.businessAddress ??
    "the business office";

  return (
    <article className="customer-line-pickup">
      <header>
        <span>Destination {index + 1}</span>
        <strong>
          {countryLabel} · {line.option.businessName}
        </strong>
      </header>
      <div className="customer-form-grid customer-shipping-form-grid">
        <PickupFields
          idSuffix={line.id}
          officeAddress={officeAddress}
          officeLocations={officeLocations.locations}
          officeLocationsLoading={officeLocations.loading}
          selectedOfficeLocationId={line.officeLocationId}
          onOfficeLocationChange={onOfficeLocationChange}
          onAddressBlur={onPickupBlur}
          onAddressSelected={onAddressSelected}
          onPickupChanged={onPickupChanged}
          pickup={line.pickup}
          setPickup={setPickup}
          suggestionsEnabled
        />
        {line.pickup.requested && (
          <PickupAvailability
            error={pickupQuoteError}
            onRetry={onRetryPickupQuote}
            quote={line.pickupQuote}
            quoting={quoting}
          />
        )}
      </div>
    </article>
  );
}

function PickupAvailability({
  error,
  onRetry,
  quote,
  quoting,
}: {
  error: string;
  onRetry: () => void;
  quote: BarrelPickupQuote | null;
  quoting: boolean;
}) {
  if (quoting) {
    return (
      <div
        aria-live="polite"
        className="customer-pickup-availability customer-form-span"
      >
        <span className="loading-spinner" />
        <span>Checking pickup availability...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div
        className="customer-pickup-availability error customer-form-span"
        role="alert"
      >
        <span>{error}</span>
        <button className="secondary-button" onClick={onRetry} type="button">
          Retry
        </button>
      </div>
    );
  }
  if (quote) {
    return (
      <div
        aria-live="polite"
        className="customer-pickup-availability success customer-form-span"
      >
        <CheckCircle2 aria-hidden="true" size={20} />
        <span>
          <strong>Pickup available</strong>
          <small>
            Service area: {quote.serviceArea} · Pickup fee:{" "}
            {formatMoney(quote.fee)}
          </small>
        </span>
      </div>
    );
  }
  return (
    <div className="customer-pickup-availability customer-form-span">
      <span>Enter a complete pickup address to check availability and price.</span>
      <button className="secondary-button" onClick={onRetry} type="button">
        Check pickup price
      </button>
    </div>
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
    () => freightProvidersForMode(options, mode),
    [mode, options],
  );
  const [senderName, setSenderName] = useState(text(profile.fullName, ""));
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverPhoneIsWhatsappOnly, setReceiverPhoneIsWhatsappOnly] =
    useState(false);
  const [receiverPhoneTouched, setReceiverPhoneTouched] = useState(false);
  const [destinationCountryId, setDestinationCountryId] = useState("");
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
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const countries = useMemo(
    () => destinationCountries(availableOptions),
    [availableOptions],
  );
  const providerOptions = useMemo(
    () =>
      availableOptions.filter(
        (option) => option.country.id === destinationCountryId,
      ),
    [availableOptions, destinationCountryId],
  );
  const destination = selectedOption(providerOptions, destinationOptionId);
  const selectedCountry = countries.find(
    (country) => country.id === destinationCountryId,
  );
  const language = currentWebLanguage();
  const phoneValidation = validateReceiverPhone({
    allowDifferentCountry: receiverPhoneIsWhatsappOnly,
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const showWhatsappOption = receiverPhoneIsDifferentCountry({
    destinationCountryCode: selectedCountry?.code,
    value: receiverPhone,
  });
  const phoneError =
    receiverPhoneTouched && !phoneValidation.valid
      ? phoneValidation.reason === "required"
        ? "Enter the receiver phone number."
        : phoneValidation.reason === "destination-mismatch"
          ? "Receiver phone must match the destination country. Use the WhatsApp option below for a number from another country."
          : phoneValidation.reason === "whatsapp-country-code"
            ? "Include the country calling code for a WhatsApp number."
            : "Enter a valid international phone number."
      : "";
  const pricing = destination
    ? freightShippingEstimate({
        country: destination.country,
        mode,
        pickupQuote: quote?.fee,
        pickupRequested: pickup.requested,
        weightKg,
      })
    : null;
  const officeLocations = useOfficeLocations(destination?.businessId ?? "");
  const [officeLocationId, setOfficeLocationId] = useState("");
  useEffect(() => {
    if (officeLocations.locations.length === 0) {
      setOfficeLocationId("");
    } else if (
      !officeLocations.locations.some((location) => location.id === officeLocationId)
    ) {
      setOfficeLocationId(officeLocations.locations[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [officeLocations.locations]);
  const officeAddress =
    officeLocations.locations.find((location) => location.id === officeLocationId)
      ?.address ??
    destination?.businessAddress ??
    "the business office";

  useEffect(() => {
    if (
      destinationCountryId &&
      !countries.some((country) => country.id === destinationCountryId)
    ) {
      setDestinationOptionId("");
      setDestinationCountryId("");
      setQuote(null);
      setSelectionNotice(
        "That destination is not available for this freight mode. Choose another destination.",
      );
      return;
    }
    if (
      destinationOptionId &&
      !providerOptions.some((option) => option.id === destinationOptionId)
    ) {
      setDestinationOptionId("");
      setQuote(null);
      setSelectionNotice(
        "That business is not available for this freight mode. Choose another business.",
      );
      return;
    }
    // Only one business serves this destination: choosing from a list of
    // one is busywork, so make the choice for them.
    if (!destinationOptionId && providerOptions.length === 1) {
      setDestinationOptionId(providerOptions[0].id);
    }
  }, [
    countries,
    destinationCountryId,
    destinationOptionId,
    providerOptions,
  ]);

  const pickupAllowed = destination?.freightPickupAvailable !== false;
  const quoteReady =
    !pickup.requested ||
    (pickupAllowed &&
      pickupDetailsAreComplete(pickup) &&
      (!authenticated || quote !== null));
  const valid =
    Boolean(
      senderName.trim() &&
        receiverName.trim() &&
        destination &&
        Number.isFinite(weightKg) &&
        weightKg > 0,
    ) &&
    phoneValidation.valid &&
    quoteReady &&
    accepted;

  async function requestQuote() {
    if (quoting || !destination || !pickup.address.trim()) {
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
      pickupDetailsAreComplete(pickup) &&
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
            officeLocationId,
          },
          marketplaceDisclosure(accepted),
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
      <fieldset className="customer-segmented">
        <legend>Shipping method</legend>
        <button
          aria-pressed={mode === "air"}
          className={mode === "air" ? "active" : ""}
          onClick={() => {
            setMode("air");
            setQuote(null);
            setSelectionNotice("");
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
            setSelectionNotice("");
          }}
          type="button"
        >
          <Ship size={17} /> Sea freight
        </button>
      </fieldset>
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
            setDestinationCountryId("");
            setDestinationOptionId("");
            setReceiverPhoneIsWhatsappOnly(false);
            setReceiverPhoneTouched(false);
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
              {pricing && (
                <>
                  <ReviewDetail
                    label="Rate per kg"
                    value={formatMoney(pricing.rate)}
                  />
                  <ReviewDetail
                    label="Estimated freight"
                    value={formatMoney(pricing.subtotal)}
                  />
                  {pricing.total !== null && (
                    <ReviewDetail
                      label="Estimated total"
                      value={formatMoney(pricing.total)}
                    />
                  )}
                </>
              )}
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
              <div className="customer-inline-note">
                The weight you enter is an estimate. If the business confirms
                a different weight after pickup, Laawol will try to
                automatically charge the card you use today for any
                additional amount due. If that charge doesn&rsquo;t go
                through, you&rsquo;ll need to open the app to complete
                payment before your shipment can continue. If your shipment
                weighs less, you&rsquo;ll be refunded automatically.
              </div>
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
            {selectionNotice && (
              <div
                aria-live="polite"
                className="customer-inline-note customer-form-span"
              >
                {selectionNotice}
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
            <SearchableSelect
              className="customer-form-span"
              emptyMessage="No destination countries match your search."
              label="Destination country"
              listLabel="Destination country options"
              onChange={(value) => {
                setDestinationCountryId(value);
                setDestinationOptionId("");
                setReceiverPhoneIsWhatsappOnly(false);
                setReceiverPhoneTouched(false);
                setQuote(null);
                setSelectionNotice("");
              }}
              options={countries.map((country) => ({
                label: shippingCountryDisplayName(country, language),
                keywords: `${country.code || ""} ${country.name}`,
                value: country.id,
              }))}
              placeholder="Search or choose a country"
              value={destinationCountryId}
            />
            {destinationCountryId && (
              <DestinationPicker
                label="Choose a shipping business"
                onChange={(value) => {
                  setDestinationOptionId(value);
                  setQuote(null);
                  setSelectionNotice("");
                }}
                mode={mode}
                options={providerOptions}
                service="freight"
                value={destinationOptionId}
              />
            )}
            <label>
              Receiver name
              <input
                onChange={(event) => setReceiverName(event.target.value)}
                required
                value={receiverName}
              />
            </label>
            <CustomerPhoneField
              error={phoneError}
              id="freight-receiver-phone"
              initialCountryCode={selectedCountry?.code || "US"}
              label="Receiver phone"
              onBlur={() => setReceiverPhoneTouched(true)}
              onChange={(value) => {
                setReceiverPhone(value);
                if (
                  !receiverPhoneIsDifferentCountry({
                    destinationCountryCode: selectedCountry?.code,
                    value,
                  })
                ) {
                  setReceiverPhoneIsWhatsappOnly(false);
                }
              }}
              required
              value={receiverPhone}
            />
            {showWhatsappOption && (
              <label className="customer-choice-row customer-form-span">
                <input
                  checked={receiverPhoneIsWhatsappOnly}
                  onChange={(event) => {
                    setReceiverPhoneIsWhatsappOnly(event.target.checked);
                    setReceiverPhoneTouched(true);
                  }}
                  type="checkbox"
                />
                <span>
                  <strong>
                    This receiver uses a WhatsApp number from another country
                  </strong>
                  <small>
                    The number must include its international calling code.
                  </small>
                </span>
              </label>
            )}
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
              idSuffix="freight"
              officeAddress={officeAddress}
              officeLocations={officeLocations.locations}
              officeLocationsLoading={officeLocations.loading}
              selectedOfficeLocationId={officeLocationId}
              onOfficeLocationChange={setOfficeLocationId}
              onAddressSelected={(suggestion) => {
                setPickupLocation(suggestion);
                setQuote(null);
              }}
              onPickupChanged={() => setQuote(null)}
              pickup={pickup}
              setPickup={setPickup}
              suggestionsEnabled
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
                    disabled={quoting || !pickup.address.trim()}
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
            {destination && pricing && (
              <ShippingPriceSummary
                details={[
                  {
                    label: mode === "air" ? "Air freight rate" : "Sea freight rate",
                    value: `${formatMoney(pricing.rate)} / kg`,
                  },
                  {
                    label: "Estimated weight",
                    value: `${pricing.weightKg} kg`,
                  },
                  {
                    label: "Shipping subtotal",
                    value: formatMoney(pricing.subtotal),
                  },
                  ...(pricing.pickupFee !== null && pricing.pickupFee > 0
                    ? [
                        {
                          label: "Pickup quote",
                          value: formatMoney(pricing.pickupFee),
                        },
                      ]
                    : []),
                ]}
                note={
                  pricing.pickupPending
                    ? "Pickup quote pending. Sign in to calculate the full estimate."
                    : "Final weight is verified by the selected business before settlement."
                }
                provider={destination.businessName}
                total={formatMoney(pricing.total ?? pricing.subtotal)}
                totalLabel={
                  pricing.total === null ? "Shipping subtotal" : "Estimated total"
                }
              />
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
          marketplaceDisclosure(acceptedId === shipment.id),
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

type CustomerTransportRequest = FirestoreRow & {
  trackingCode?: string;
  status?: string;
  quoteStatus?: string;
  pickupArea?: string;
  pickupAddress?: string;
  destinationCountryName?: string;
  carMake?: string;
  carModel?: string;
  carYear?: string;
  requestedTransportMethod?: string;
  selectedQuoteId?: string;
  selectedBusinessName?: string;
  selectedAmountCents?: number;
};

type TransportQuote = FirestoreRow & {
  requestId?: string;
  businessId?: string;
  businessName?: string;
  amountCents?: number;
  currency?: string;
  estimatedPickupDate?: unknown;
  estimatedDeliveryDate?: unknown;
  transportMethod?: string;
  terms?: string;
  expiresAt?: unknown;
  status?: string;
};

function useCustomerTransportRequests(customerUid: string, enabled: boolean) {
  const [rows, setRows] = useState<CustomerTransportRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !customerUid) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    return onSnapshot(
      query(
        collection(db, "transportRequests"),
        where("customerUid", "==", customerUid),
      ),
      (snapshot) => {
        setRows(
          snapshot.docs
            .map(
              (item): CustomerTransportRequest => ({
                id: item.id,
                ...item.data(),
              }),
            )
            .sort(
              (left, right) =>
                transportTimestamp(right.updatedAt ?? right.createdAt) -
                transportTimestamp(left.updatedAt ?? left.createdAt),
            ),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setRows([]);
        setLoading(false);
        setError("We couldn’t load your transport requests. Try again.");
      },
    );
  }, [customerUid, enabled]);

  return { rows, loading, error };
}

function useTransportQuotes(requestId: string, enabled: boolean) {
  const [rows, setRows] = useState<TransportQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled || !requestId) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    return onSnapshot(
      query(
        collection(db, "transportQuotes"),
        where("requestId", "==", requestId),
      ),
      (snapshot) => {
        setRows(
          snapshot.docs
            .map(
              (item): TransportQuote => ({
                id: item.id,
                ...item.data(),
              }),
            )
            .sort(
              (left, right) =>
                Number(left.amountCents ?? Number.MAX_SAFE_INTEGER) -
                Number(right.amountCents ?? Number.MAX_SAFE_INTEGER),
            ),
        );
        setLoading(false);
        setError("");
      },
      () => {
        setLoading(false);
        setError("Some quotes could not be loaded. Try again.");
      },
    );
  }, [enabled, requestId]);

  return { rows, loading, error };
}

function transportTimestamp(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  const parsed = new Date(String(value ?? "")).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
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
  const [ownerName, setOwnerName] = useState(text(profile.fullName, ""));
  const [customerPhone, setCustomerPhone] = useState(text(profile.phone, ""));
  const [pickupArea, setPickupArea] = useState("");
  // Car transport takes an optional exact address. It is split into the same
  // named fields as every other customer address so the apartment/unit is
  // captured instead of being lost in one opaque suggestion string.
  const [pickupAddressParts, setPickupAddressParts] = useState<StructuredAddress>(
    EMPTY_STRUCTURED_ADDRESS,
  );
  const pickupAddress = composeAddressLine(pickupAddressParts);
  const [destinationCountryId, setDestinationCountryId] = useState("");
  const [carMake, setCarMake] = useState("");
  const [carModel, setCarModel] = useState("");
  const [carYear, setCarYear] = useState("");
  const [vinNumber, setVinNumber] = useState("");
  const [vehicleOperable, setVehicleOperable] = useState(true);
  const [transportMethod, setTransportMethod] =
    useState<"open" | "enclosed">("open");
  const [preferredDate, setPreferredDate] = useState("");
  const [flexibleDates, setFlexibleDates] = useState(true);
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"details" | "review">("details");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{
    id: string;
    trackingCode: string;
    eligibleBusinessCount?: number;
  } | null>(null);
  const [activeRequestId, setActiveRequestId] = useState("");
  const currentYear = new Date().getFullYear();
  const year = Number(carYear);
  const countries = useMemo(() => destinationCountries(options), [options]);
  const destinationCountry = countries.find(
    (country) => country.id === destinationCountryId,
  );
  const language = currentWebLanguage();
  const customerUid = authenticated ? text(profile.id, "") : "";
  const requests = useCustomerTransportRequests(customerUid, authenticated);
  const activeRequest =
    requests.rows.find((request) => request.id === activeRequestId) ??
    requests.rows[0] ??
    null;
  const quotes = useTransportQuotes(
    activeRequest?.id ?? "",
    authenticated && Boolean(activeRequest),
  );
  const availableBusinessCount = useMemo(
    () => new Set(options.map((option) => option.businessId)).size,
    [options],
  );
  const valid =
    pickupArea.trim().length >= 2 &&
    Boolean(destinationCountry) &&
    ownerName.trim().length > 0 &&
    carMake.trim().length > 0 &&
    carModel.trim().length > 0 &&
    Number.isInteger(year) &&
    year >= 1900 &&
    year <= currentYear + 1 &&
    isValidPhone(customerPhone);

  useEffect(() => {
    if (created?.id) {
      setActiveRequestId(created.id);
    } else if (!activeRequestId && requests.rows[0]) {
      setActiveRequestId(requests.rows[0].id);
    }
  }, [activeRequestId, created?.id, requests.rows]);

  function clearForm() {
    setPickupArea("");
    setPickupAddressParts(EMPTY_STRUCTURED_ADDRESS);
    setDestinationCountryId("");
    setCarMake("");
    setCarModel("");
    setCarYear("");
    setVinNumber("");
    setVehicleOperable(true);
    setTransportMethod("open");
    setPreferredDate("");
    setFlexibleDates(true);
    setNotes("");
    setStep("details");
    setError("");
  }

  async function submit() {
    if (!valid || submitting) return;
    if (!authenticated) {
      onAuthenticationRequired?.();
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const result = await callFunction<{
        id: string;
        trackingCode: string;
        eligibleBusinessCount?: number;
      }>("createTransportRequest", {
        ownerName: ownerName.trim(),
        customerPhone: customerPhone.trim(),
        pickupArea: pickupArea.trim(),
        pickupAddress: pickupAddress.trim(),
        destinationCountryId: destinationCountry?.id ?? "",
        destinationCountryName: destinationCountry?.name ?? "",
        carMake: carMake.trim(),
        carModel: carModel.trim(),
        carYear: carYear.trim(),
        vinNumber: vinNumber.trim().toUpperCase(),
        vehicleOperable,
        requestedTransportMethod: transportMethod,
        preferredDate: preferredDate
          ? new Date(`${preferredDate}T12:00:00`).toISOString()
          : "",
        flexibleDates,
        notes: notes.trim(),
      });
      setCreated(result);
      setActiveRequestId(result.id);
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

  return (
    <div className="customer-transport-marketplace">
      {created && (
        <section className="customer-transport-success" role="status">
          <CheckCircle2 aria-hidden="true" size={34} />
          <div>
            <span className="customer-service-kicker">Request received</span>
            <h3>Your request is open for quotes</h3>
            <p>
              Eligible approved businesses serving this route can now review the
              vehicle and send you a quote.
            </p>
            <strong>Tracking code: {created.trackingCode}</strong>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              setCreated(null);
              clearForm();
            }}
            type="button"
          >
            Start another request
          </button>
        </section>
      )}

      {!created && (
        <section className="customer-transport-layout">
          <section className="panel customer-transport-request">
            <header className="customer-transport-request-head">
              <span className="customer-service-kicker">Car transport quotes</span>
              <h2>Tell us about the route and vehicle</h2>
              <p>
                Complete one request. Eligible approved businesses will send
                prices and timing for you to compare.
              </p>
            </header>
            <ol className="customer-form-steps" aria-label="Request progress">
              <li className={step === "details" ? "active" : "complete"}>
                {step === "review" ? <CheckCircle2 size={14} /> : "1"} Details
              </li>
              <li className={step === "review" ? "active" : ""}>2 Review</li>
            </ol>
            {error && <div className="error-box" role="alert">{error}</div>}

            {step === "details" ? (
              <div className="customer-transport-sections">
                <section className="customer-transport-section">
                  <header>
                    <span>1</span>
                    <div>
                      <h3>Route</h3>
                      <p>Where is the vehicle now, and which country is it going to?</p>
                    </div>
                  </header>
                  <div className="customer-form-grid customer-shipping-form-grid">
                    <label>
                      Pickup area
                      <input
                        onChange={(event) => setPickupArea(event.target.value)}
                        placeholder="City, state or province, postal code"
                        required
                        value={pickupArea}
                      />
                      <small>Businesses see this general area when preparing quotes.</small>
                    </label>
                    <SearchableSelect
                      emptyMessage="No destination countries match your search."
                      label="Destination country"
                      listLabel="Destination country options"
                      onChange={setDestinationCountryId}
                      options={countries.map((country) => ({
                        label: shippingCountryDisplayName(country, language),
                        keywords: `${country.code || ""} ${country.name}`,
                        value: country.id,
                      }))}
                      placeholder="Search or choose a country"
                      value={destinationCountryId}
                    />
                    <StructuredAddressFields
                      idPrefix="customer-transport-pickup"
                      onChange={setPickupAddressParts}
                      required={false}
                      streetLabel="Exact pickup street address (optional)"
                      suggestionsEnabled
                      value={pickupAddressParts}
                    />
                  </div>
                  {pickupArea.trim().length >= 2 &&
                    destinationCountry && (
                      <div className="customer-transport-match-note" role="status">
                        <ShieldCheck aria-hidden="true" size={20} />
                        <span>
                          <strong>Ready for carrier matching</strong>
                          <small>
                            Your request will be shared only with eligible
                            approved businesses serving this route.
                          </small>
                        </span>
                      </div>
                    )}
                </section>

                <section className="customer-transport-section">
                  <header>
                    <span>2</span>
                    <div>
                      <h3>Vehicle</h3>
                      <p>These details help businesses prepare an accurate quote.</p>
                    </div>
                  </header>
                  <div className="customer-form-grid customer-shipping-form-grid">
                    <label>
                      Car make
                      {/* Cascading catalog pickers, never free text: typed
                          makes re-introduce "toyta"/"Toyota " as separate
                          values and break search, matching and quoting. */}
                      <select
                        onChange={(event) => {
                          // Model and year belong to the previous make.
                          setCarMake(event.target.value);
                          setCarModel("");
                          setCarYear("");
                        }}
                        required
                        value={canonicalMake(carMake) || carMake}
                      >
                        <option value="">Select a make</option>
                        {getMakes().map((make) => (
                          <option key={make} value={make}>
                            {make}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Car model
                      <select
                        disabled={!carMake}
                        onChange={(event) => {
                          setCarModel(event.target.value);
                          setCarYear("");
                        }}
                        required
                        value={canonicalModel(carMake, carModel) || carModel}
                      >
                        <option value="">Select a model</option>
                        {getModels(carMake).map((model) => (
                          <option key={model} value={model}>
                            {model}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Car year
                      <select
                        disabled={!carModel}
                        onChange={(event) => setCarYear(event.target.value)}
                        required
                        value={carYear}
                      >
                        <option value="">Select a year</option>
                        {getYears(carMake, carModel).map((year) => (
                          <option key={year} value={year}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      VIN number (optional)
                      <input
                        maxLength={17}
                        onChange={(event) =>
                          setVinNumber(event.target.value.toUpperCase())
                        }
                        value={vinNumber}
                      />
                    </label>
                    <fieldset className="customer-segmented customer-form-span">
                      <legend>Can the vehicle be driven?</legend>
                      <button
                        aria-pressed={vehicleOperable}
                        className={vehicleOperable ? "active" : ""}
                        onClick={() => setVehicleOperable(true)}
                        type="button"
                      >
                        Yes, it runs
                      </button>
                      <button
                        aria-pressed={!vehicleOperable}
                        className={!vehicleOperable ? "active" : ""}
                        onClick={() => setVehicleOperable(false)}
                        type="button"
                      >
                        No, it needs assistance
                      </button>
                    </fieldset>
                  </div>
                </section>

                <section className="customer-transport-section">
                  <header>
                    <span>3</span>
                    <div>
                      <h3>Preferences and contact</h3>
                      <p>Tell businesses when and how you would like to move it.</p>
                    </div>
                  </header>
                  <div className="customer-form-grid customer-shipping-form-grid">
                    <fieldset className="customer-segmented customer-form-span">
                      <legend>Transport method</legend>
                      <button
                        aria-pressed={transportMethod === "open"}
                        className={transportMethod === "open" ? "active" : ""}
                        onClick={() => setTransportMethod("open")}
                        type="button"
                      >
                        Open transport
                      </button>
                      <button
                        aria-pressed={transportMethod === "enclosed"}
                        className={transportMethod === "enclosed" ? "active" : ""}
                        onClick={() => setTransportMethod("enclosed")}
                        type="button"
                      >
                        Enclosed transport
                      </button>
                    </fieldset>
                    <label>
                      Preferred pickup date (optional)
                      <input
                        min={new Date().toISOString().slice(0, 10)}
                        onChange={(event) => setPreferredDate(event.target.value)}
                        type="date"
                        value={preferredDate}
                      />
                    </label>
                    <label className="customer-choice-row customer-transport-flexible">
                      <input
                        checked={flexibleDates}
                        onChange={(event) => setFlexibleDates(event.target.checked)}
                        type="checkbox"
                      />
                      <span>
                        <strong>My dates are flexible</strong>
                        <small>Businesses may suggest a nearby pickup date.</small>
                      </span>
                    </label>
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
                    <label className="customer-form-span">
                      Notes for carriers (optional)
                      <textarea
                        maxLength={1000}
                        onChange={(event) => setNotes(event.target.value)}
                        placeholder="Share access details, vehicle condition, or timing needs"
                        rows={4}
                        value={notes}
                      />
                    </label>
                  </div>
                </section>
              </div>
            ) : (
              <div className="customer-transport-review">
                <div className="customer-transport-review-intro">
                  <ShieldCheck aria-hidden="true" size={23} />
                  <div>
                    <h3>Review your quote request</h3>
                    <p>No payment is due when you send this request.</p>
                  </div>
                </div>
                <ReviewGrid>
                  <ReviewDetail label="Pickup area" value={pickupArea} />
                  <ReviewDetail
                    label="Exact pickup address"
                    value={pickupAddress || "Not provided"}
                  />
                  <ReviewDetail
                    label="Destination country"
                    value={shippingCountryDisplayName(destinationCountry!, language)}
                  />
                  <ReviewDetail
                    label="Vehicle"
                    value={`${carYear} ${carMake} ${carModel}`}
                  />
                  <ReviewDetail
                    label="Vehicle condition"
                    value={vehicleOperable ? "Runs and drives" : "Needs assistance"}
                  />
                  <ReviewDetail
                    label="Transport method"
                    value={
                      transportMethod === "enclosed"
                        ? "Enclosed transport"
                        : "Open transport"
                    }
                  />
                  <ReviewDetail
                    label="Preferred pickup"
                    value={
                      preferredDate
                        ? flexibleDates
                          ? `${preferredDate} · Flexible`
                          : preferredDate
                        : "Flexible"
                    }
                  />
                  <ReviewDetail label="Vehicle owner" value={ownerName} />
                  <ReviewDetail label="Contact phone" value={customerPhone} />
                </ReviewGrid>
                <div className="customer-transport-review-note">
                  <span>{availableBusinessCount}</span>
                  <p>
                    approved {availableBusinessCount === 1 ? "business is" : "businesses are"} currently
                    available for car transport. Route eligibility is confirmed
                    securely when you submit.
                  </p>
                </div>
              </div>
            )}

            <footer className="customer-transport-actions">
              <button
                className="secondary-button"
                disabled={submitting}
                onClick={() =>
                  step === "review" ? setStep("details") : clearForm()
                }
                type="button"
              >
                {step === "review" ? "Back" : "Clear"}
              </button>
              {step === "details" ? (
                <button
                  className="primary-button"
                  disabled={!valid}
                  onClick={() => setStep("review")}
                  type="button"
                >
                  Review request
                </button>
              ) : (
                <button
                  aria-busy={submitting}
                  className="primary-button"
                  data-loading={submitting}
                  disabled={submitting}
                  onClick={() => void submit()}
                  type="button"
                >
                  {submitting
                    ? "Sending request..."
                    : authenticated
                      ? "Request quotes"
                      : "Sign in to send request"}
                </button>
              )}
            </footer>
          </section>

          <aside className="customer-transport-summary">
            <span className="customer-service-kicker">How it works</span>
            <ol>
              <li><ShieldCheck size={18} /><span><strong>One secure request</strong><small>Your contact details stay private until a quote is selected.</small></span></li>
              <li><CircleDollarSign size={18} /><span><strong>Compare real quotes</strong><small>Review total price, timing, method, and terms together.</small></span></li>
              <li><Truck size={18} /><span><strong>Choose your carrier</strong><small>You decide which approved business should handle the vehicle.</small></span></li>
            </ol>
            <div>
              <strong>No payment today</strong>
              <span>Sending a request only starts the quote process.</span>
            </div>
          </aside>
        </section>
      )}

      {authenticated && (
        <CustomerTransportQuotes
          activeRequest={activeRequest}
          activeRequestId={activeRequestId}
          error={requests.error}
          loading={requests.loading}
          onRequestChange={setActiveRequestId}
          quotes={quotes}
          requests={requests.rows}
        />
      )}
    </div>
  );
}

function CustomerTransportQuotes({
  activeRequest,
  activeRequestId,
  error,
  loading,
  onRequestChange,
  quotes,
  requests,
}: {
  activeRequest: CustomerTransportRequest | null;
  activeRequestId: string;
  error: string;
  loading: boolean;
  onRequestChange: (requestId: string) => void;
  quotes: { rows: TransportQuote[]; loading: boolean; error: string };
  requests: CustomerTransportRequest[];
}) {
  const [busyAction, setBusyAction] = useState("");
  const [actionError, setActionError] = useState("");
  const activeQuotes = quotes.rows.filter((quote) => quote.status !== "withdrawn");
  const selectedQuote =
    quotes.rows.find((quote) => quote.id === activeRequest?.selectedQuoteId) ??
    quotes.rows.find((quote) => quote.status === "selected");

  async function selectQuote(quote: TransportQuote) {
    if (!activeRequest || busyAction) return;
    const confirmed = await confirmImportantAction(
      "Choose this carrier and quoted total?",
      "Choisir ce transporteur et ce montant ?",
    );
    if (!confirmed) return;
    setBusyAction(`select:${quote.id}`);
    setActionError("");
    try {
      await callFunction("selectTransportQuote", {
        requestId: activeRequest.id,
        quoteId: quote.id,
      });
    } catch {
      setActionError("The carrier could not be selected. Try again.");
    } finally {
      setBusyAction("");
    }
  }

  async function cancelRequest() {
    if (!activeRequest || busyAction) return;
    const confirmed = await confirmImportantAction(
      "Cancel this quote request? Businesses will no longer be able to submit or revise quotes.",
      "Annuler cette demande de devis ? Les entreprises ne pourront plus envoyer ni réviser de devis.",
    );
    if (!confirmed) return;
    setBusyAction("cancel");
    setActionError("");
    try {
      await callFunction("cancelTransportQuoteRequest", {
        requestId: activeRequest.id,
      });
    } catch {
      setActionError("The quote request could not be cancelled. Try again.");
    } finally {
      setBusyAction("");
    }
  }

  if (loading) {
    return (
      <section className="customer-transport-quotes">
        <div className="customer-transport-quote-skeleton" aria-live="polite">
          <span className="loading-spinner" /> Loading your quote requests...
        </div>
      </section>
    );
  }
  if (error) {
    return <div className="error-box" role="alert">{error}</div>;
  }
  if (!activeRequest || requests.length === 0) return null;

  const requestCancelled =
    activeRequest.quoteStatus === "cancelled" ||
    activeRequest.status === "cancelled";
  const requestSelected =
    activeRequest.quoteStatus === "selected" || Boolean(selectedQuote);

  return (
    <section className="customer-transport-quotes">
      <header className="customer-transport-quotes-head">
        <div>
          <span className="customer-service-kicker">Your quote requests</span>
          <h2>{requestSelected ? "Carrier selected" : "Compare carrier quotes"}</h2>
          <p>
            {requestSelected
              ? "Your selected quote and next transport step are shown below."
              : "Compare the complete offer before choosing a business."}
          </p>
        </div>
        <label>
          Quote request
          <select
            aria-label="Choose quote request"
            onChange={(event) => onRequestChange(event.target.value)}
            value={activeRequestId || activeRequest.id}
          >
            {requests.map((request) => (
              <option key={request.id} value={request.id}>
                {text(request.trackingCode, request.id)} ·{" "}
                {text(request.carYear)} {text(request.carMake)}{" "}
                {text(request.carModel)}
              </option>
            ))}
          </select>
        </label>
      </header>

      <div className="customer-transport-request-summary">
        <MapPin aria-hidden="true" size={19} />
        <div>
          <small>Route</small>
          <strong>
            {text(activeRequest.pickupArea, "Pickup area not provided")} →{" "}
            {text(activeRequest.destinationCountryName, "Destination not provided")}
          </strong>
        </div>
        <span className={`lst-badge ${requestCancelled ? "muted" : requestSelected ? "ok" : "warn"}`}>
          {requestCancelled
            ? "Cancelled"
            : requestSelected
              ? "Carrier selected"
              : `${activeQuotes.length} ${activeQuotes.length === 1 ? "quote" : "quotes"} received`}
        </span>
      </div>

      {(actionError || quotes.error) && (
        <div className="customer-inline-note error" role="alert">
          <span>{actionError || quotes.error}</span>
        </div>
      )}

      {quotes.loading ? (
        <div className="customer-transport-quote-grid" aria-live="polite">
          {[0, 1].map((item) => (
            <div className="customer-transport-quote-skeleton" key={item}>
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : activeQuotes.length === 0 ? (
        <div className="customer-transport-awaiting">
          <Clock3 aria-hidden="true" size={27} />
          <div>
            <h3>{requestCancelled ? "This request is closed" : "Carriers are reviewing your request"}</h3>
            <p>
              {requestCancelled
                ? "No new quotes can be submitted."
                : "We’ll show every quote here and notify you when one arrives."}
            </p>
          </div>
        </div>
      ) : (
        <div className="customer-transport-quote-grid">
          {activeQuotes.map((quote) => {
            const selected =
              quote.id === activeRequest.selectedQuoteId ||
              quote.status === "selected";
            const expired =
              transportTimestamp(quote.expiresAt) > 0 &&
              transportTimestamp(quote.expiresAt) < Date.now();
            return (
              <article
                className={`customer-transport-quote-card${selected ? " selected" : ""}${expired ? " expired" : ""}`}
                key={quote.id}
              >
                <header>
                  <span className="customer-transport-business-mark">
                    <Truck aria-hidden="true" size={19} />
                  </span>
                  <div>
                    <strong>{text(quote.businessName, "Approved carrier")}</strong>
                    <small><ShieldCheck aria-hidden="true" size={13} /> Approved business</small>
                  </div>
                  {selected && <span className="lst-badge ok">Selected</span>}
                </header>
                <div className="customer-transport-quote-price">
                  <small>Total quote</small>
                  <strong>
                    {formatMoney(
                      Number(quote.amountCents ?? 0) / 100,
                      text(quote.currency, "USD"),
                    )}
                  </strong>
                  <span>No payment due until the next confirmed step.</span>
                </div>
                <dl>
                  <div>
                    <dt><CalendarClock size={15} /> Pickup</dt>
                    <dd>{quote.estimatedPickupDate ? formatDate(quote.estimatedPickupDate) : "Not provided"}</dd>
                  </div>
                  <div>
                    <dt><Clock3 size={15} /> Estimated delivery</dt>
                    <dd>{quote.estimatedDeliveryDate ? formatDate(quote.estimatedDeliveryDate) : "Not provided"}</dd>
                  </div>
                  <div>
                    <dt><Truck size={15} /> Transport method</dt>
                    <dd>{text(quote.transportMethod ?? activeRequest.requestedTransportMethod, "Open transport") === "enclosed" ? "Enclosed transport" : "Open transport"}</dd>
                  </div>
                  <div>
                    <dt><Clock3 size={15} /> Quote expiry</dt>
                    <dd>{quote.expiresAt ? formatDate(quote.expiresAt) : "No expiry provided"}</dd>
                  </div>
                </dl>
                <div className="customer-transport-quote-terms">
                  <small>Terms and inclusions</small>
                  <p>{text(quote.terms, "No additional terms provided.")}</p>
                </div>
                {expired && <div className="customer-inline-note">This quote has expired.</div>}
                <button
                  aria-busy={busyAction === `select:${quote.id}`}
                  className={selected ? "secondary-button" : "primary-button"}
                  disabled={
                    Boolean(busyAction) ||
                    expired ||
                    requestCancelled ||
                    (requestSelected && !selected)
                  }
                  onClick={() => void selectQuote(quote)}
                  type="button"
                >
                  {busyAction === `select:${quote.id}`
                    ? "Selecting carrier..."
                    : selected
                      ? "Carrier selected"
                      : requestSelected
                        ? "Not selected"
                        : "Choose this carrier"}
                </button>
              </article>
            );
          })}
        </div>
      )}

      {!requestCancelled && !requestSelected && (
        <footer className="customer-transport-quotes-foot">
          <button
            aria-busy={busyAction === "cancel"}
            className="danger-button"
            disabled={Boolean(busyAction)}
            onClick={() => void cancelRequest()}
            type="button"
          >
            <XCircle aria-hidden="true" size={16} />
            {busyAction === "cancel" ? "Cancelling request..." : "Cancel quote request"}
          </button>
        </footer>
      )}
    </section>
  );
}

function DestinationPicker({
  label,
  mode = "air",
  onChange,
  options,
  service,
  value,
}: {
  label: string;
  mode?: "air" | "sea";
  onChange: (value: string) => void;
  options: DestinationOption[];
  service: ShippingService;
  value: string;
}) {
  return (
    <fieldset className="customer-destination-picker customer-form-span">
      <legend>{label}</legend>
      <p>
        Choose an approved provider. Each rate comes directly from that
        business.
      </p>
      {options.length === 0 && (
        <div aria-live="polite" className="customer-inline-note">
          No approved businesses currently have a rate for this freight mode.
        </div>
      )}
      <div
        aria-label={label}
        className="customer-destination-grid"
        role="radiogroup"
      >
        {options.map((option) => {
          const selected = value === option.id;
          const rate =
            service === "transport"
              ? null
              : shippingProviderRate(
                  option.country,
                  service,
                  mode,
                );
          const airRate = shippingProviderRate(
            option.country,
            "freight",
            "air",
          );
          const seaRate = shippingProviderRate(
            option.country,
            "freight",
            "sea",
          );
          const ServiceIcon =
            service === "barrel"
              ? Box
              : service === "freight"
                ? mode === "air"
                  ? Plane
                  : Ship
                : Truck;

          return (
            <button
              aria-checked={selected}
              className={`customer-destination-card${selected ? " selected" : ""}`}
              key={option.id}
              onClick={() => onChange(option.id)}
              role="radio"
              type="button"
            >
              <span className="customer-destination-card-head">
                <span className="customer-option-icon">
                  <ServiceIcon aria-hidden="true" size={20} />
                </span>
                <span>
                  <strong>{option.businessName}</strong>
                  <small>
                    <MapPin aria-hidden="true" size={13} />
                    {option.country.name}
                  </small>
                </span>
                <CheckCircle2
                  aria-hidden="true"
                  className="customer-destination-check"
                  size={20}
                />
              </span>
              {service === "transport" ? (
                <span className="customer-destination-price">
                  <small>Business quote</small>
                  <strong>Price provided after review</strong>
                </span>
              ) : (
                <span className="customer-destination-price">
                  <small>
                    {service === "barrel"
                      ? "Price per barrel"
                      : mode === "air"
                        ? "Air freight rate"
                        : "Sea freight rate"}
                  </small>
                  <strong>
                    {rate
                      ? `${formatMoney(rate)}${service === "freight" ? " / kg" : ""}`
                      : "Rate unavailable"}
                  </strong>
                </span>
              )}
              {service === "freight" && (
                <span className="customer-destination-rate-list">
                  {airRate && (
                    <span>
                      <small>Air freight</small>
                      <strong>{formatMoney(airRate)} / kg</strong>
                    </span>
                  )}
                  {seaRate && (
                    <span>
                      <small>Sea freight</small>
                      <strong>{formatMoney(seaRate)} / kg</strong>
                    </span>
                  )}
                </span>
              )}
              {service !== "transport" && (
                <span className="customer-destination-logistics">
                  {service === "barrel" && (
                    <DeliveryWindow
                      country={option.country}
                      service="barrelShipping"
                    />
                  )}
                  {service === "freight" && (
                    <>
                      {airRate && (
                        <DeliveryWindow
                          country={option.country}
                          service="freightAir"
                        />
                      )}
                      {seaRate && (
                        <DeliveryWindow
                          country={option.country}
                          service="freightSea"
                        />
                      )}
                    </>
                  )}
                  {service === "freight" && (
                    <FreightDepartureSchedule
                      country={option.country}
                      mode={mode}
                    />
                  )}
                </span>
              )}
              <span className="customer-approved-label">
                <CheckCircle2 aria-hidden="true" size={14} />
                Approved business
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ShippingPriceSummary({
  details,
  note,
  provider,
  total,
  totalLabel,
}: {
  details: Array<{ label: string; value: string }>;
  note: ReactNode;
  provider: string;
  total: string;
  totalLabel: string;
}) {
  return (
    <section
      aria-live="polite"
      className="customer-shipping-price-summary customer-form-span"
    >
      <header>
        <span className="customer-shipping-price-icon">
          <Scale aria-hidden="true" size={21} />
        </span>
        <span>
          <small>Selected provider</small>
          <strong>{provider}</strong>
        </span>
        <span className="customer-shipping-price-total">
          <small>{totalLabel}</small>
          <strong>{total}</strong>
        </span>
      </header>
      <dl>
        {details.map((detail) => (
          <div key={detail.label}>
            <dt>{detail.label}</dt>
            <dd>{detail.value}</dd>
          </div>
        ))}
      </dl>
      <p>{note}</p>
    </section>
  );
}

function PickupFields({
  disabled = false,
  idSuffix = "default",
  officeAddress = "the business office",
  officeLocations = [],
  officeLocationsLoading = false,
  selectedOfficeLocationId = "",
  onOfficeLocationChange,
  onAddressBlur,
  onAddressSelected,
  onPickupChanged,
  pickup,
  setPickup,
  suggestionsEnabled = true,
}: {
  disabled?: boolean;
  idSuffix?: string;
  officeAddress?: string;
  officeLocations?: OfficeLocationOption[];
  officeLocationsLoading?: boolean;
  selectedOfficeLocationId?: string;
  onOfficeLocationChange?: (locationId: string) => void;
  onAddressBlur?: () => void;
  onAddressSelected?: (suggestion: AddressSuggestion) => void;
  onPickupChanged?: () => void;
  pickup: PickupDetails;
  setPickup: (pickup: PickupDetails) => void;
  suggestionsEnabled?: boolean;
}) {
  return (
    <>
      <fieldset className="customer-segmented customer-form-span">
        <legend>Pickup option</legend>
        <button
          aria-pressed={pickup.requested}
          className={pickup.requested ? "active" : ""}
          disabled={disabled}
          onClick={() => {
            setPickup({ ...pickup, requested: true });
            onPickupChanged?.();
          }}
          type="button"
        >
          <Truck aria-hidden="true" size={17} /> Pick up
        </button>
        <button
          aria-pressed={!pickup.requested}
          className={!pickup.requested ? "active" : ""}
          onClick={() => {
            setPickup({ ...pickup, requested: false });
            onPickupChanged?.();
          }}
          type="button"
        >
          <Store aria-hidden="true" size={17} /> Bring to office
        </button>
        {!pickup.requested && officeLocations.length > 1 ? (
          <fieldset className="customer-office-locations customer-form-span">
            <legend>
              {officeLocations.length} locations available — choose one
            </legend>
            {officeLocations.map((location) => (
              <label
                className={`customer-office-location-choice${
                  selectedOfficeLocationId === location.id ? " selected" : ""
                }`}
                key={location.id}
              >
                <input
                  checked={selectedOfficeLocationId === location.id}
                  name={`office-location-${idSuffix}`}
                  onChange={() => onOfficeLocationChange?.(location.id)}
                  type="radio"
                  value={location.id}
                />
                <span className="customer-option-icon">
                  <Store aria-hidden="true" size={18} />
                </span>
                <span className="customer-office-location-text">
                  <strong>{location.label}</strong>
                  <small>{location.address}</small>
                </span>
              </label>
            ))}
          </fieldset>
        ) : (
          !pickup.requested &&
          !officeLocationsLoading && (
            <small className="customer-pickup-office">
              {officeAddress === "the business office" ? (
                <span>Drop off at the business office</span>
              ) : (
                <>
                  <span>Drop off at</span> {officeAddress}
                </>
              )}
            </small>
          )
        )}
      </fieldset>
      {pickup.requested && (
        <>
          <StructuredAddressFields
            disabled={disabled}
            idPrefix={`customer-pickup-address-${idSuffix}`}
            onBlur={onAddressBlur}
            onChange={(parts, suggestion) => {
              const applied = applyStructuredAddress(pickup, parts);
              setPickup({
                ...applied,
                // The server-derived borough beats the text sniff when the
                // customer picked a suggestion; typing falls back to the sniff.
                borough:
                  suggestion?.borough ||
                  nycBoroughFromAddress(applied.address) ||
                  "",
              });
              onPickupChanged?.();
              if (suggestion) onAddressSelected?.(suggestion);
            }}
            streetLabel="Pickup street address"
            suggestionsEnabled={suggestionsEnabled}
            value={pickupStructuredAddress(pickup)}
          />
          {pickup.borough ? (
            <div className="customer-detected-borough">
              <small>Service area</small>
              <strong>{pickup.borough}</strong>
              <span>Confirmed from the pickup address.</span>
            </div>
          ) : null}
          <label>
            Pickup date and time
            <input
              aria-invalid={Boolean(
                pickup.dateTime &&
                  new Date(pickup.dateTime).getTime() <= Date.now(),
              )}
              max={localDateTimeInputValue(
                new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
              )}
              min={localDateTimeInputValue(new Date())}
              onChange={(event) =>
                setPickup({ ...pickup, dateTime: event.target.value })
              }
              required
              type="datetime-local"
              value={pickup.dateTime || ""}
            />
            {pickup.dateTime &&
              new Date(pickup.dateTime).getTime() <= Date.now() && (
                <small className="customer-field-error">
                  Pickup time must be in the future.
                </small>
              )}
          </label>
        </>
      )}
    </>
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
