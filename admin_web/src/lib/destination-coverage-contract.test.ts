import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  MAX_DELIVERY_AREAS,
  deliveryAreaDraftsFrom,
  deliveryAreasPayload,
  deliveryChoiceIsComplete,
  deliveryFeeFor,
  deliverySettingsError,
  freightDeliveryPolicy,
} from "./freight-delivery.ts";
import { translateValue } from "./french-dom.ts";

const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const consoleSource = readFileSync(
  new URL("../components/business-console.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const customerSource = readFileSync(
  new URL("../components/customer-shipping-services.tsx", import.meta.url),
  "utf8",
);

describe("business destination service coverage", () => {
  it("persists the complete v2 service map and derives country activity", () => {
    assert.match(operationsSource, /destinationCoverageVersion:\s*2/);
    assert.match(operationsSource, /serviceAvailability:\s*availability/);
    assert.match(
      operationsSource,
      /isActive:\s*Object\.values\(availability\)\.some\(Boolean\)/,
    );
    assert.match(
      operationsSource,
      /carTransportAvailable:\s*availability\.carTransport/,
    );
  });

  it("offers independent barrel, air, sea, and quote-based car controls", () => {
    for (const service of [
      "barrelShipping",
      "freightAir",
      "freightSea",
      "carTransport",
    ]) {
      assert.match(operationsSource, new RegExp(`draft\\.${service}`));
    }
    assert.match(operationsSource, /Car transport quotes/);
    assert.match(
      operationsSource,
      /You set the route price when responding\./,
    );
    assert.doesNotMatch(
      operationsSource,
      /Car transport price/,
    );
  });

  it("captures freight schedules and shows delivery logistics to customers", () => {
    assert.match(operationsSource, /freightAirDepartureDays/);
    assert.match(operationsSource, /freightSeaDepartureDays/);
    assert.match(operationsSource, /Air freight departure days/);
    assert.match(customerSource, /Typical delivery/);
    assert.match(customerSource, /Regular departure days/);
  });

  it("adds destination delivery to the customer's total and its own line", () => {
    // A fee shown in the breakdown but missing from the total is the bug
    // customers notice at the card statement rather than at booking.
    assert.match(customerSource, /\+ \(pricing\.pickupFee \?\? 0\) \+ deliveryFee/);
    assert.match(customerSource, /label: "Delivery to the receiver"/);
    assert.match(customerSource, /label="Delivery to the receiver"/);
    // The choice is guarded by the shared rule, not a second opinion about
    // what counts as a complete address.
    assert.match(
      customerSource,
      /deliveryChoiceIsComplete\(\{\s*wantsDelivery: deliveryChosen,\s*receiverAddress,\s*areas: deliveryPolicy\.areas,\s*areaId: deliveryAreaId,/,
    );
    // A destination address is free text: Conakry and Dakar are addressed by
    // neighbourhood and landmark, and the US-shaped fields cannot hold that.
    assert.match(customerSource, /Receiver&rsquo;s address\s*\n\s*<textarea/);
    assert.doesNotMatch(
      customerSource,
      /<StructuredAddressFields[\s\S]{0,200}receiverAddress/,
    );
  });

  it("quotes the weight adjustment against every fee that rides through", () => {
    // The dialog is what the owner agrees to before money moves. A preview
    // that drops a flat fee quotes a refund of a service still being given.
    assert.match(
      operationsSource,
      /const finalTotal =\s*\n?\s*shippingFee \+ pickup \+ coverage \+ destinationDelivery;/,
    );
    // A set-price parcel is not repriced by the scale: the scale only says
    // whether it outgrew the weight the price covers, and the excess is
    // charged at the route's rate - the same arithmetic settlement runs.
    assert.match(
      operationsSource,
      /flatPrice \+ Math\.max\(0, verifiedWeightKg - includedKg\) \* rate/,
    );
    // Coverage is read off the row, not assumed zero: it is zero on anything
    // booked under the published-payback model and non-zero on older rows.
    assert.match(operationsSource, /row\.coverageFeeCents \?\? 0/);
    assert.match(operationsSource, /row\.destinationDeliveryFeeCents \?\? 0/);
  });

  it("keeps the delivery offer and its fee on the country, not the business", () => {
    // Crossing Dakar and crossing Conakry are different jobs at different
    // costs, and a business may do one and not the other - so the offer is
    // written onto the destination document beside that route's rates.
    assert.match(
      operationsSource,
      /"destinationCountries", country\.id\)/,
    );
    assert.match(
      operationsSource,
      /freightDestinationDeliveryAvailable: deliveryAvailable/,
    );
    assert.match(
      operationsSource,
      /freightDestinationDeliveryAreas: deliveryAreas/,
    );
    // A named list is what a booking is priced against, so the single price
    // is stored only while the list is empty - never both at once.
    assert.match(
      operationsSource,
      /freightDestinationDeliveryFee:\s*\n?\s*deliveryAvailable && deliveryAreas\.length === 0/,
    );
    // Configuring a country reads back what that country holds, so two
    // routes of one business keep two different answers.
    assert.match(
      operationsSource,
      /destinationDelivery: row\.freightDestinationDeliveryAvailable === true/,
    );
    assert.match(
      operationsSource,
      /destinationDeliveryFee: numberString\(row\.freightDestinationDeliveryFee\)/,
    );
    // Only a route that carries freight can publish a freight delivery.
    assert.match(operationsSource, /const draftCarriesFreight =/);
    assert.match(operationsSource, /\{draftCarriesFreight && \(/);
    assert.match(
      operationsSource,
      /const carriesFreight = availability\.freightAir \|\| availability\.freightSea/,
    );
    // The bands are the server's, so the console refuses what it would.
    assert.match(operationsSource, /deliverySettingsError\(\{/);
    // And the business-wide freight settings no longer ask at all.
    const businessSettings = readFileSync(
      new URL(
        "../components/business/profile-support-people.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    assert.doesNotMatch(businessSettings, /destinationDelivery/);
  });

  it("prices two destinations of one business independently", () => {
    // The same business, two routes, two answers - and one route that does
    // not deliver at all while the others do.
    const senegal = freightDeliveryPolicy({
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryFee: 10,
    });
    const guinea = freightDeliveryPolicy({
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryAreas: [
        {id: "cosa", name: "Cosa", fee: 20},
        {id: "koloma", name: "Koloma", fee: 10},
      ],
    });
    const mali = freightDeliveryPolicy({
      freightDestinationDeliveryAvailable: false,
      freightDestinationDeliveryFee: 0,
    });
    // One price for the whole country is still a legitimate answer.
    assert.equal(senegal.fee, 10);
    assert.equal(senegal.feeCents, 1000);
    assert.deepEqual(senegal.areas, []);
    assert.equal(mali.offered, false);
    assert.equal(mali.feeCents, 0);
    // Opted in and priced nowhere is an unfinished setting, not free.
    assert.equal(
      freightDeliveryPolicy({
        freightDestinationDeliveryAvailable: true,
        freightDestinationDeliveryFee: 0,
      }).offered,
      false,
    );

    // Two places on one destination, priced one by one.
    assert.equal(guinea.offered, true);
    assert.deepEqual(
      guinea.areas.map((area) => [area.id, area.fee, area.feeCents]),
      [
        ["cosa", 20, 2000],
        ["koloma", 10, 1000],
      ],
    );
    assert.equal(deliveryFeeFor(guinea, "cosa"), 20);
    assert.equal(deliveryFeeFor(guinea, "koloma"), 10);
    // A country priced by place quotes nothing until one is picked, so a
    // parcel can never be charged an area fee it was not shown.
    assert.equal(guinea.fee, 0);
    assert.equal(deliveryFeeFor(guinea, ""), 0);
    assert.equal(deliveryFeeFor(guinea, "ratoma"), 0);
  });

  it("holds the booking until the customer says which place", () => {
    const areas = freightDeliveryPolicy({
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryAreas: [{id: "cosa", name: "Cosa", fee: 20}],
    }).areas;
    const address = "Cosa, near the mosque";
    assert.equal(
      deliveryChoiceIsComplete({
        wantsDelivery: true,
        receiverAddress: address,
        areas,
        areaId: "",
      }),
      false,
    );
    assert.equal(
      deliveryChoiceIsComplete({
        wantsDelivery: true,
        receiverAddress: address,
        areas,
        areaId: "cosa",
      }),
      true,
    );
    // A destination that names no places asks for none.
    assert.equal(
      deliveryChoiceIsComplete({
        wantsDelivery: true,
        receiverAddress: address,
      }),
      true,
    );
    // Collection asks for nothing at all.
    assert.equal(
      deliveryChoiceIsComplete({wantsDelivery: false, receiverAddress: ""}),
      true,
    );
    // The picked place rides with the address, so the server prices the
    // booking on what the customer was shown.
    assert.match(
      customerSource,
      /\.\.\.\(deliveryPolicy\.areas\.length > 0 && \{deliveryAreaId\}\)/,
    );
    assert.match(customerSource, /Where is it being delivered to\?/);
    assert.equal(
      translateValue("Where is it being delivered to?", "fr"),
      "Où est-il livré ?",
    );
  });

  it("round-trips a list of places through the destination editor", () => {
    const stored = [
      {id: "cosa", name: "Cosa", fee: 20},
      {id: "koloma", name: "Koloma", fee: 10.5},
    ];
    const drafts = deliveryAreaDraftsFrom(stored);
    assert.deepEqual(drafts, [
      {id: "cosa", name: "Cosa", fee: "20"},
      {id: "koloma", name: "Koloma", fee: "10.5"},
    ]);
    assert.deepEqual(deliveryAreasPayload(drafts), stored);
    // A place typed fresh gets its id from its name, so the business never
    // sees one and renaming does not orphan what it priced.
    assert.deepEqual(
      deliveryAreasPayload([{id: "", name: " Petit Simbaya ", fee: "15.004"}]),
      [{id: "petit-simbaya", name: "Petit Simbaya", fee: 15}],
    );
  });

  it("refuses a place list the callable would refuse", () => {
    const ok = {available: true, fee: 0};
    assert.equal(
      deliverySettingsError({...ok, areas: [{id: "", name: "", fee: "20"}]}),
      "Every place you deliver to needs a name.",
    );
    assert.equal(
      deliverySettingsError({
        ...ok,
        areas: [
          {id: "", name: "Cosa", fee: "20"},
          {id: "", name: "cosa", fee: "10"},
        ],
      }),
      "Two places on the list share the same name.",
    );
    assert.equal(
      deliverySettingsError({
        ...ok,
        areas: Array.from({length: MAX_DELIVERY_AREAS + 1}, (_, index) => ({
          id: "",
          name: `Place ${index}`,
          fee: "10",
        })),
      }),
      "You can list up to 40 places.",
    );
    assert.equal(
      deliverySettingsError({...ok, areas: [{id: "", name: "Cosa", fee: "900"}]}),
      "A delivery fee must be between $0 and $500.",
    );
    // A place with a name and no price is an unfinished row, not free.
    assert.equal(
      deliverySettingsError({...ok, areas: [{id: "", name: "Cosa", fee: ""}]}),
      "A delivery fee must be between $0 and $500.",
    );
    // Opted in, nothing listed, no single price either.
    assert.equal(
      deliverySettingsError({available: true, areas: [], fee: 0}),
      "Add somewhere you deliver to, or turn delivery off.",
    );
    assert.equal(
      deliverySettingsError({available: true, areas: [], fee: 900}),
      "A delivery fee must be between $0 and $500.",
    );
    // Both complete answers save.
    assert.equal(
      deliverySettingsError({...ok, areas: [{id: "", name: "Cosa", fee: "20"}]}),
      "",
    );
    assert.equal(deliverySettingsError({available: true, fee: 15}), "");
    // Turning it off never refuses whatever was left in the fields.
    assert.equal(deliverySettingsError({available: false, fee: 0}), "");

    for (const [english, french] of [
      [
        "Add somewhere you deliver to, or turn delivery off.",
        "Ajoutez un endroit où vous livrez, ou désactivez la livraison.",
      ],
      [
        "Every place you deliver to needs a name.",
        "Chaque endroit où vous livrez a besoin d’un nom.",
      ],
      [
        "Two places on the list share the same name.",
        "Deux endroits de la liste portent le même nom.",
      ],
      ["You can list up to 40 places.", "Vous pouvez lister jusqu’à 40 endroits."],
      [
        "A delivery fee must be between $0 and $500.",
        "Des frais de livraison doivent être compris entre 0 $ et 500 $.",
      ],
      [
        "Choose where the parcel is being delivered to.",
        "Choisissez où le colis est livré.",
      ],
    ]) {
      assert.equal(translateValue(english, "fr"), french);
    }
  });

  it("lets car-transport-only businesses open destination configuration", () => {
    assert.match(
      consoleSource,
      /services\.has\("carTransport"\)/,
    );
  });

  it("uses a responsive operational list and full-height country drawer", () => {
    assert.match(styles, /\.destination-coverage-list/);
    assert.match(styles, /\.destination-drawer/);
    assert.match(styles, /@media \(max-width: 700px\)/);
    assert.match(styles, /padding-bottom: max\(16px, env\(safe-area-inset-bottom\)\)/);
  });

  it("localizes the new workflow and quote language in French", () => {
    assert.equal(
      translateValue("Service coverage by country", "fr"),
      "Couverture des services par pays",
    );
    assert.equal(
      translateValue("Car transport quotes", "fr"),
      "Devis de transport de véhicules",
    );
    assert.equal(
      translateValue("Save configuration", "fr"),
      "Enregistrer la configuration",
    );
    assert.equal(
      translateValue("Regular departure days", "fr"),
      "Jours de départ habituels",
    );
  });
});
