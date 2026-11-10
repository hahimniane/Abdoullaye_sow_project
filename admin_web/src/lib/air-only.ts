/**
 * An air-only business on the website console (docs/SHIPPING_SIMPLE_HOME.md
 * W): it ships by air and has never had a sea container. For it the Shipping
 * pages never say "container": the waiting list is "Packages here", a
 * container is a "Shipment", and the register form starts on Air.
 *
 * Mirrors `airOnlyBusiness` in the app
 * (`my_flutter_app/lib/services/shipping_home_facts.dart`). Pure: the two
 * counts are read by `useBusinessHasSeaContainer` (business-data.ts).
 */

/**
 * Whether the business is air-only. `hasSeaContainer` is null while the
 * counts load and when they fail: both read as "not air-only", which is the
 * console as it was (H2: a failed read falls back to Containers).
 */
export function airOnlyBusiness(shipsByAir: boolean, hasSeaContainer: boolean | null): boolean {
  return shipsByAir === true && hasSeaContainer === false;
}

/**
 * Whether the business has a sea container, from two counts: every container
 * of the business, and those marked Air. An old sea container carries no
 * `shipMode`, so it is counted as "all but air". Null until both answered.
 */
export function hasSeaContainerFromCounts(all: number | null, air: number | null): boolean | null {
  if (typeof all !== "number" || typeof air !== "number") return null;
  return all > air;
}

/** The Shipping words that differ for an air-only business. */
export type ShippingCopy = {
  /** Under "Shipping" in the sidebar. */
  sidebarDescription: string;
  /** The step and tab that holds dropped-off packages. */
  waitingStep: string;
  /** The step and tab that holds containers. */
  containersStep: string;
  waitingTitle: string;
  waitingSearch: string;
  waitingLede: string;
  registerSubtitle: string;
  registerHint: string;
  listTitle: string;
  newButton: string;
  listLede: string;
  /** The column that names one container. */
  column: string;
  listEmpty: string;
  listNoMatch: string;
  /** A package no container has taken yet. */
  notLoaded: string;
  todayTitle: string;
  todayButton: string;
  todayEmpty: string;
  todayMore: string;
  /** Beside the date a container left. */
  leftLabel: string;
};

const STANDARD_COPY: ShippingCopy = {
  sidebarDescription: "Requests, waiting list, containers, deliveries",
  waitingStep: "Waiting",
  containersStep: "Containers",
  waitingTitle: "Waiting list",
  waitingSearch: "VIN, customer, phone",
  waitingLede:
    "Packages customers dropped off before a container was chosen. Print the label now; add them to a container that goes to the same country when it is loading.",
  registerSubtitle: "What the customer dropped off. It waits here until a container takes it.",
  registerHint:
    "The customer and the receiver get a WhatsApp message when the package is registered, when the container ships and when it arrives. Adding it to a container sends nothing.",
  listTitle: "Containers",
  newButton: "New container",
  listLede:
    "Your own loading lists: what went into each box, when it sailed, and when it landed. Customers do not see this.",
  column: "Container",
  listEmpty: "No containers yet. Start one when you begin loading a box.",
  listNoMatch: "No containers match this filter.",
  notLoaded: "Waiting for a container",
  todayTitle: "Containers in progress",
  todayButton: "Open containers",
  todayEmpty: "No container is loading or at sea.",
  todayMore: "See every open container",
  leftLabel: "Sailed",
};

const AIR_ONLY_COPY: ShippingCopy = {
  sidebarDescription: "Requests, packages, shipments, deliveries",
  waitingStep: "Packages here",
  containersStep: "Shipments",
  waitingTitle: "Packages here",
  waitingSearch: "Customer, receiver or phone",
  waitingLede:
    "Packages customers dropped off that have not left yet. Print the label now; add them to a shipment going to the same country when it is ready.",
  registerSubtitle: "What the customer dropped off. It stays here until you send it.",
  registerHint:
    "The customer and the receiver get a WhatsApp message when the package is registered, when it leaves and when it arrives. Adding it to a shipment sends nothing.",
  listTitle: "Shipments",
  newButton: "New shipment",
  listLede:
    "Your own shipment lists: what went on each one, when it left, and when it landed. Customers do not see this.",
  column: "Shipment",
  listEmpty: "No shipments yet. Start one when packages are ready to leave.",
  listNoMatch: "No shipments match this filter.",
  notLoaded: "Not sent yet",
  todayTitle: "Shipments in progress",
  todayButton: "See shipments",
  todayEmpty: "No shipment is loading or on the way.",
  todayMore: "See every open shipment",
  leftLabel: "Sent",
};

/** The Shipping words for this business. Two fixed sets: nothing is built per render. */
export function shippingCopy(airOnly: boolean): ShippingCopy {
  return airOnly ? AIR_ONLY_COPY : STANDARD_COPY;
}

/**
 * The Shipping steps as this business reads them: an air-only business sees
 * "Packages here" and "Shipments" where the others see "Waiting" and
 * "Containers". The ids, order and permissions never change.
 */
export function shippingStepsFor<T extends {id: string; label: string}>(
  steps: readonly T[],
  airOnly: boolean,
): T[] {
  if (!airOnly) return [...steps];
  return steps.map((step) => {
    if (step.id === "waiting") return {...step, label: AIR_ONLY_COPY.waitingStep};
    if (step.id === "containers") return {...step, label: AIR_ONLY_COPY.containersStep};
    return step;
  });
}

// Today's tiles and "Needs attention" rows that name a container
// (business-today.ts), as an air-only business reads them.
const AIR_ONLY_TODAY_LABELS: Record<string, string> = {
  "Packages waiting for a container": "Packages not sent yet",
  "Containers loading": "Shipments loading",
  "Containers sailed": "Shipments sent",
};

/** A Today label for this business: the same label unless it names a container. */
export function todayLabelFor(label: string, airOnly: boolean): string {
  return airOnly ? AIR_ONLY_TODAY_LABELS[label] ?? label : label;
}
