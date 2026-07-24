"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
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
  Store,
  Truck,
} from "lucide-react";

import { CustomerPhoneField } from "@/components/customer-phone-field";
import { DisclosureCheckbox } from "@/components/disclosure-checkbox";
import { ServiceRequestForm } from "@/components/service-request-form";
import { SearchableSelect } from "@/components/searchable-select";
import {
  barrelDestinationCountries,
  barrelOrderTotals,
  barrelPickupPricingFromData,
  barrelProvidersForCountry,
  barrelShipmentEstimate,
  buildBarrelOrderPayload,
  buildBarrelShipmentPayload,
  buildFreightSettlementPayload,
  buildFreightShipmentPayload,
  buildTransportRequestPayload,
  freightProvidersForMode,
  freightShippingEstimate,
  freightSettlementIsPayable,
  localDateTimeInputValue,
  DEFAULT_BARREL_PICKUP_PRICING,
  NYC_PICKUP_BOROUGHS,
  nycBoroughFromAddress,
  pickupDetailsAreComplete,
  shippingOptionIsEligible,
  shippingCountryDisplayName,
  shippingProviderRate,
  type BarrelPickupPricing,
  type BarrelPickupQuote,
  type PickupDetails,
} from "@/lib/customer-shipping";
import { marketplaceDisclosure } from "@/lib/disclosures";
import { db, functions } from "@/lib/firebase";
import { formatMoney, text } from "@/lib/format";
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

type DestinationCountry = {
  id: string;
  code?: string;
  name: string;
  isActive?: boolean;
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
  enabledServices?: readonly string[];
  businessStatus?: string;
  freightPickupAvailable?: boolean;
  freightPickupModel?: "borough" | "distance";
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
  const [pickupPricing, setPickupPricing] =
    useState<BarrelPickupPricing | null>(null);
  const [pickupPricingLoading, setPickupPricingLoading] = useState(true);
  const [pickupPricingError, setPickupPricingError] = useState("");
  const [pickupPricingReloadKey, setPickupPricingReloadKey] = useState(0);
  const [useWalletBalance, setUseWalletBalance] = useState(false);
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
        pickupPricing,
        pickupRequested: pickup.requested,
        quantity,
      })
    : null;
  const pickupFee = pricing?.pickupFee ?? null;
  const estimatedTotal = pricing?.total ?? null;
  const officeAddress =
    pickupPricing?.officeAddress ??
    DEFAULT_BARREL_PICKUP_PRICING.officeAddress;

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setPickupPricingLoading(true);
    setPickupPricingError("");
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Pickup pricing request timed out.")),
        15_000,
      );
    });
    void Promise.race([
      getDoc(doc(db, "shipmentPricing", "barrelPickup")),
      timeout,
    ])
      .then((snapshot) => {
        if (active) {
          setPickupPricing(barrelPickupPricingFromData(snapshot.data()));
        }
      })
      .catch(() => {
        if (active) {
          setPickupPricing(null);
          setPickupPricingError(
            "Pickup pricing could not be loaded. Try again or choose office drop-off.",
          );
        }
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
        if (active) setPickupPricingLoading(false);
      });
    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [pickupPricingReloadKey]);

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
      (!pickupPricingLoading && !pickupPricingError && pickupFee !== null)) &&
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
                lockDetectedBorough
                officeAddress={officeAddress}
                pickup={pickup}
                setPickup={setPickup}
                suggestionsEnabled={authenticated}
              />
              {pickup.requested && pickupPricingLoading && (
                <div
                  aria-live="polite"
                  className="customer-inline-note customer-form-span"
                >
                  <span className="loading-spinner" />
                  Loading pickup pricing...
                </div>
              )}
              {pickup.requested && pickupPricingError && (
                <div
                  className="customer-inline-note customer-form-span error"
                  role="alert"
                >
                  <span>{pickupPricingError}</span>
                  <button
                    className="secondary-button"
                    disabled={pickupPricingLoading}
                    onClick={() =>
                      setPickupPricingReloadKey((current) => current + 1)
                    }
                    type="button"
                  >
                    Retry pickup pricing
                  </button>
                </div>
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
                        ? "Enter a valid New York City pickup address to see the complete total."
                        : "Pickup pricing is based on the selected New York City borough."
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
                    <small>
                      Any remaining amount continues to secure payment.
                    </small>
                  </span>
                </label>
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
  const [pickupPricing, setPickupPricing] =
    useState<BarrelPickupPricing | null>(null);
  const [pickupPricingLoading, setPickupPricingLoading] = useState(true);
  const [pickupPricingError, setPickupPricingError] = useState("");
  const [pickupPricingReloadKey, setPickupPricingReloadKey] = useState(0);
  const [quotingPickupId, setQuotingPickupId] = useState("");
  const [pickupQuoteError, setPickupQuoteError] = useState("");
  const [useWalletBalance, setUseWalletBalance] = useState(false);
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
  const officeAddress =
    pickupPricing?.officeAddress ??
    DEFAULT_BARREL_PICKUP_PRICING.officeAddress;
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

  useEffect(() => {
    let active = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setPickupPricingLoading(true);
    setPickupPricingError("");
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Pickup pricing request timed out.")),
        15_000,
      );
    });
    void Promise.race([
      getDoc(doc(db, "shipmentPricing", "barrelPickup")),
      timeout,
    ])
      .then((snapshot) => {
        if (active) {
          setPickupPricing(barrelPickupPricingFromData(snapshot.data()));
        }
      })
      .catch(() => {
        if (active) {
          setPickupPricing(null);
          setPickupPricingError(
            "Pickup pricing could not be loaded. Try again or choose office drop-off.",
          );
        }
      })
      .finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
        if (active) setPickupPricingLoading(false);
      });
    return () => {
      active = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [pickupPricingReloadKey]);

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
    setEditorOpen(true);
  }

  async function requestPickupQuote(
    pickup: PickupDetails,
    id: string,
    addressOverride?: string,
  ) {
    const pickupAddress = (addressOverride ?? pickup.address).trim();
    if (!pickupAddress || quotingPickupId) return null;
    setQuotingPickupId(id);
    setPickupQuoteError("");
    try {
      return await callFunction<BarrelPickupQuote>("quoteBarrelPickup", {
        pickupAddress,
      });
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
    const quote = await requestPickupQuote(
      sharedPickup,
      "shared",
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
            useWalletBalance,
          },
          marketplaceDisclosure(),
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
                  lockDetectedBorough
                  officeAddress={officeAddress}
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
                  <article className="customer-line-pickup" key={line.id}>
                    <header>
                      <span>Destination {index + 1}</span>
                      <strong>
                        {countryName(line.option.country)} ·{" "}
                        {line.option.businessName}
                      </strong>
                    </header>
                    <div className="customer-form-grid customer-shipping-form-grid">
                      <PickupFields
                        idSuffix={line.id}
                        lockDetectedBorough
                        officeAddress={officeAddress}
                        onAddressBlur={() => void quoteLinePickup(line.id)}
                        onAddressSelected={(suggestion) =>
                          void quoteLinePickup(
                            line.id,
                            suggestion.formattedAddress ||
                              suggestion.description,
                          )
                        }
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
                        pickup={line.pickup}
                        setPickup={(pickup) =>
                          setLines((current) =>
                            current.map((item) =>
                              item.id === line.id
                                ? { ...item, pickup }
                                : item,
                            ),
                          )
                        }
                        suggestionsEnabled
                      />
                      {line.pickup.requested && (
                        <PickupAvailability
                          error={
                            quotingPickupId === line.id
                              ? ""
                              : pickupQuoteError
                          }
                          onRetry={() => void quoteLinePickup(line.id)}
                          quote={line.pickupQuote}
                          quoting={quotingPickupId === line.id}
                        />
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            {pickupPricingLoading && (
              <div className="customer-inline-note" aria-live="polite">
                <span className="loading-spinner" />
                Loading pickup pricing...
              </div>
            )}
            {pickupPricingError && (
              <div className="customer-inline-note error" role="alert">
                <span>{pickupPricingError}</span>
                <button
                  className="secondary-button"
                  disabled={pickupPricingLoading}
                  onClick={() =>
                    setPickupPricingReloadKey((current) => current + 1)
                  }
                  type="button"
                >
                  Retry pickup pricing
                </button>
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
            {authenticated && (
              <label className="customer-choice-row">
                <input
                  checked={useWalletBalance}
                  onChange={(event) =>
                    setUseWalletBalance(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>
                  <strong>Use wallet balance</strong>
                  <small>Available balance will be applied first.</small>
                </span>
              </label>
            )}
          </section>
        )}
      </div>
    </ServiceRequestForm>
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
  const [useWalletBalance, setUseWalletBalance] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
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

  useEffect(() => {
    if (
      destinationOptionId &&
      !availableOptions.some((option) => option.id === destinationOptionId)
    ) {
      setDestinationOptionId("");
      setDestinationCountryId("");
      setQuote(null);
    }
  }, [availableOptions, destinationOptionId]);

  const pickupAllowed = destination?.freightPickupAvailable !== false;
  const pickupUsesBoroughPricing =
    destination?.freightPickupModel === "borough";
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
    if (
      quoting ||
      !destination ||
      !pickup.address.trim() ||
      (pickupUsesBoroughPricing && !pickup.borough.trim())
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
                }}
                mode={mode}
                options={providerOptions}
                service="freight"
                value={destinationOptionId}
              />
            )}
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
              lockDetectedBorough={!pickupUsesBoroughPricing}
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
                    disabled={
                      quoting ||
                      !pickup.address.trim() ||
                      (pickupUsesBoroughPricing && !pickup.borough.trim())
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
  const [destinationCountryId, setDestinationCountryId] = useState("");
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
  const countries = useMemo(() => destinationCountries(options), [options]);
  const providerOptions = useMemo(
    () =>
      options.filter(
        (option) => option.country.id === destinationCountryId,
      ),
    [destinationCountryId, options],
  );
  const destination = selectedOption(providerOptions, destinationOptionId);
  const language = currentWebLanguage();
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
            setDestinationCountryId("");
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
        setDestinationCountryId("");
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
        <SearchableSelect
          className="customer-form-span"
          emptyMessage="No destination countries match your search."
          label="Destination country"
          listLabel="Destination country options"
          onChange={(value) => {
            setDestinationCountryId(value);
            setDestinationOptionId("");
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
            onChange={setDestinationOptionId}
            options={providerOptions}
            service="transport"
            value={destinationOptionId}
          />
        )}
        {destination && (
          <div className="customer-provider-banner customer-form-span">
            <Store size={19} />
            <div>
              <strong>{destination.businessName}</strong>
              <span>
                Price provided after review. No payment is due when you submit
                this request.
              </span>
            </div>
          </div>
        )}
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
  lockDetectedBorough = false,
  officeAddress = "the business office",
  onAddressBlur,
  onAddressSelected,
  onPickupChanged,
  pickup,
  setPickup,
  suggestionsEnabled = true,
}: {
  disabled?: boolean;
  idSuffix?: string;
  lockDetectedBorough?: boolean;
  officeAddress?: string;
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
        {!pickup.requested && (
          <small className="customer-pickup-office">
            {officeAddress === "the business office" ? (
              <span>Drop off at the business office</span>
            ) : (
              <>
                <span>Drop off at</span> {officeAddress}
              </>
            )}
          </small>
        )}
      </fieldset>
      {pickup.requested && (
        <>
          <AddressAutocomplete
            id={`customer-pickup-address-${idSuffix}`}
            onBlur={onAddressBlur}
            suggestionsEnabled={suggestionsEnabled}
            onChange={(address) => {
              setPickup({
                ...pickup,
                address,
                borough: nycBoroughFromAddress(address) || "",
              });
              onPickupChanged?.();
            }}
            onSelect={(suggestion) => {
              const address =
                suggestion.formattedAddress || suggestion.description;
              setPickup({
                ...pickup,
                address,
                borough:
                  suggestion.borough ||
                  nycBoroughFromAddress(address) ||
                  "",
              });
              onPickupChanged?.();
              onAddressSelected?.(suggestion);
            }}
            value={pickup.address}
          />
          {lockDetectedBorough && pickup.borough ? (
            <div className="customer-detected-borough">
              <small>Service area</small>
              <strong>{pickup.borough}</strong>
              <span>Confirmed from the pickup address.</span>
            </div>
          ) : !lockDetectedBorough ? (
            <label>
              Pickup borough
              <select
                onChange={(event) => {
                  setPickup({ ...pickup, borough: event.target.value });
                  onPickupChanged?.();
                }}
                required
                value={pickup.borough}
              >
                <option value="">Select borough</option>
                {NYC_PICKUP_BOROUGHS.map((borough) => (
                  <option key={borough} value={borough}>
                    {borough}
                  </option>
                ))}
              </select>
            </label>
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

function AddressAutocomplete({
  id,
  onBlur,
  onChange,
  onSelect,
  suggestionsEnabled,
  value,
}: {
  id: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onSelect: (suggestion: AddressSuggestion) => void;
  suggestionsEnabled: boolean;
  value: string;
}) {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestionError, setSuggestionError] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedAddress, setSelectedAddress] = useState("");
  const [touched, setTouched] = useState(false);
  const addressInvalid = touched && value.trim().length === 0;
  const query = value.trim();
  const listboxId = `${id}-suggestions`;

  function selectSuggestion(suggestion: AddressSuggestion) {
    const resolved =
      suggestion.formattedAddress || suggestion.description;
    setSelectedAddress(resolved);
    setSuggestions([]);
    setActiveIndex(-1);
    onSelect(suggestion);
  }

  useEffect(() => {
    if (
      !suggestionsEnabled ||
      query.length < 3 ||
      query === selectedAddress
    ) {
      setSuggestions([]);
      setLoading(false);
      setSuggestionError(false);
      setSearchedQuery("");
      setActiveIndex(-1);
      return;
    }
    let active = true;
    const debounce = setTimeout(() => {
      setLoading(true);
      setSuggestionError(false);
      void callFunction<AddressSuggestion[]>("suggestPickupAddresses", {
        input: query,
      })
        .then((result) => {
          if (!active) return;
          setSuggestions(Array.isArray(result) ? result : []);
          setSearchedQuery(query);
          setActiveIndex(-1);
        })
        .catch(() => {
          if (!active) return;
          setSuggestions([]);
          setSearchedQuery(query);
          setSuggestionError(true);
          setActiveIndex(-1);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(debounce);
    };
  }, [query, selectedAddress, suggestionsEnabled]);

  return (
    <div className="customer-address-field customer-form-span">
      <label htmlFor={id}>Pickup address</label>
      <div className="customer-address-control">
        <MapPin aria-hidden="true" size={17} />
        <input
          aria-activedescendant={
            activeIndex >= 0
              ? `${listboxId}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-busy={loading}
          aria-controls={suggestionsEnabled ? listboxId : undefined}
          aria-describedby={
            addressInvalid ? `${id}-error` : undefined
          }
          aria-expanded={suggestions.length > 0}
          aria-invalid={addressInvalid}
          autoComplete="off"
          id={id}
          onBlur={() => {
            setTouched(true);
            onBlur?.();
          }}
          onChange={(event) => {
            setSelectedAddress("");
            setSuggestionError(false);
            setSearchedQuery("");
            setActiveIndex(-1);
            onChange(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && suggestions.length > 0) {
              event.preventDefault();
              setActiveIndex((current) =>
                Math.min(current + 1, suggestions.length - 1),
              );
            } else if (
              event.key === "ArrowUp" &&
              suggestions.length > 0
            ) {
              event.preventDefault();
              setActiveIndex((current) =>
                current <= 0 ? suggestions.length - 1 : current - 1,
              );
            } else if (
              event.key === "Enter" &&
              activeIndex >= 0 &&
              suggestions[activeIndex]
            ) {
              event.preventDefault();
              selectSuggestion(suggestions[activeIndex]);
            } else if (event.key === "Escape") {
              setSuggestions([]);
              setActiveIndex(-1);
            }
          }}
          placeholder={
            suggestionsEnabled
              ? "Start typing a pickup address"
              : "Enter a pickup address"
          }
          required
          role="combobox"
          value={value}
        />
        {loading && <span className="loading-spinner" />}
      </div>
      {addressInvalid && (
        <small
          className="customer-field-error"
          id={`${id}-error`}
        >
          Enter a complete pickup address.
        </small>
      )}
      {suggestions.length > 0 && (
        <div
          aria-label="Address suggestions"
          className="customer-address-suggestions"
          id={listboxId}
          role="listbox"
        >
          {suggestions.map((suggestion, index) => (
            <button
              aria-selected={activeIndex === index}
              className={activeIndex === index ? "active" : ""}
              id={`${listboxId}-option-${index}`}
              key={suggestion.placeId}
              onClick={() => selectSuggestion(suggestion)}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
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
      {loading && (
        <small className="customer-address-status" role="status">
          Searching addresses...
        </small>
      )}
      {!loading &&
        !suggestionError &&
        query.length >= 3 &&
        searchedQuery === query &&
        suggestions.length === 0 && (
          <small className="customer-address-status" role="status">
            No matching addresses. Keep typing or enter the complete address.
          </small>
        )}
      {suggestionError && (
        <small className="customer-address-status error" role="status">
          {
            "Address suggestions are unavailable. Enter the complete address to continue."
          }
        </small>
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
