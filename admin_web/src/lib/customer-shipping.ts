export type MarketplaceDisclosurePayload = {
  accepted: true;
  version: string;
  locale: string;
};

export type PickupDetails = {
  requested: boolean;
  address: string;
  borough: string;
  dateTime?: string;
};

export type BarrelShipmentFields = {
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  destinationCountryId: string;
  businessId: string;
  quantity: number;
  pickup: PickupDetails;
  useWalletBalance: boolean;
};

export type FreightShipmentFields = {
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  destinationCountryId: string;
  businessId: string;
  mode: "air" | "sea";
  weightKg: number;
  pickup: PickupDetails;
  useWalletBalance: boolean;
};

export type TransportRequestFields = {
  businessId: string;
  destinationCountryId: string;
  destinationCountryName: string;
  ownerName: string;
  carMake: string;
  carModel: string;
  carYear: string;
  customerPhone: string;
  vinNumber: string;
  pickupAddress: string;
  notes: string;
  preferredDate?: string;
};

function trimmed(value: string) {
  return value.trim();
}

function pickupPayload(pickup: PickupDetails) {
  return {
    pickupRequested: pickup.requested,
    ...(pickup.requested && {
      pickupAddress: trimmed(pickup.address),
      pickupBorough: trimmed(pickup.borough),
      ...(pickup.dateTime && { pickupDateTime: pickup.dateTime }),
    }),
  };
}

export function buildBarrelShipmentPayload(
  fields: BarrelShipmentFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    senderName: trimmed(fields.senderName),
    receiverName: trimmed(fields.receiverName),
    receiverPhone: trimmed(fields.receiverPhone),
    destinationCountryId: trimmed(fields.destinationCountryId),
    businessId: trimmed(fields.businessId),
    quantity: fields.quantity,
    ...pickupPayload(fields.pickup),
    useWalletBalance: fields.useWalletBalance,
    marketplaceDisclosure: disclosure,
  };
}

export function buildFreightShipmentPayload(
  fields: FreightShipmentFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    senderName: trimmed(fields.senderName),
    receiverName: trimmed(fields.receiverName),
    receiverPhone: trimmed(fields.receiverPhone),
    destinationCountryId: trimmed(fields.destinationCountryId),
    businessId: trimmed(fields.businessId),
    mode: fields.mode,
    weightKg: fields.weightKg,
    ...pickupPayload(fields.pickup),
    useWalletBalance: fields.useWalletBalance,
    marketplaceDisclosure: disclosure,
  };
}

export function buildFreightSettlementPayload(
  shipmentId: string,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    shipmentId: trimmed(shipmentId),
    marketplaceDisclosure: disclosure,
  };
}

export function buildTransportRequestPayload(fields: TransportRequestFields) {
  return {
    businessId: trimmed(fields.businessId),
    destinationCountryId: trimmed(fields.destinationCountryId),
    destinationCountryName: trimmed(fields.destinationCountryName),
    ownerName: trimmed(fields.ownerName),
    carMake: trimmed(fields.carMake),
    carModel: trimmed(fields.carModel),
    carYear: trimmed(fields.carYear),
    customerPhone: trimmed(fields.customerPhone),
    vinNumber: trimmed(fields.vinNumber),
    pickupAddress: trimmed(fields.pickupAddress),
    notes: trimmed(fields.notes),
    ...(fields.preferredDate && { preferredDate: fields.preferredDate }),
  };
}

export function freightSettlementIsPayable(
  shipment: Record<string, unknown>,
) {
  const status = String(shipment.priceSettlementStatus || "").toLowerCase();
  const due = Number(
    shipment.balanceDueCents ??
      (Number(shipment.balanceDue || 0) * 100),
  );
  return (
    Number.isFinite(due) &&
    due > 0 &&
    ["balance_due", "balance_payment_pending"].includes(status)
  );
}
