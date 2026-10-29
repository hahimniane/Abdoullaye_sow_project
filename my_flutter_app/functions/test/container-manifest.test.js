"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  validateContainer,
  containerRecord,
  containerTransitionRefusal,
  containerIsOpen,
  containerDeleteRefusal,
  validateContainerLine,
  containerLineRecord,
  validateWaitingPackage,
  dimensionOf,
  lineVolumeCubicFeet,
  lineSizeText,
  lineIsWaiting,
  destinationMismatch,
  cleanLineIds,
  containerAssignRefusal,
  containerLinesCountsDelta,
  LINE_STATUS_WAITING,
  WAITING_HOLDER,
  CONTAINER_MESSAGES,
  validateContainerLineContacts,
  containerLineContactsUpdate,
  isInternationalPhone,
  openContainerHoldingVin,
  containerCounts,
  containerCountsDelta,
  LINE_CONTACT_FIELDS,
  LINE_SUBSTANCE_FIELDS,
  LINE_PRICE_FIELDS,
  LINE_PROOF_FIELDS,
  LINE_EDIT_FIELDS,
  CONTACT_FIELD_LABELS,
  LINE_FIELD_LABELS,
  barrelsLabel,
  containerLineWhat,
  containerLineEditable,
  containerLineEditTarget,
  validateContainerLineEdit,
  containerLineEditChanges,
  lineEditIsContactsOnly,
  containerLineEditRefusal,
  containerLineVinHandover,
  containerLineEditCountsDelta,
  containerLineEditLabels,
  containerLineEditAudit,
  containerVinLockId,
  vinLockHolder,
  keepExisting,
  containerStatusIsRepeat,
  linesLagStatus,
  inGroups,
  containerCarrierScac,
  carrierScacRefusal,
  shouldStartCarrierTracking,
  carrierTrackingFailure,
  lineContactsEdited,
  lineCustomer,
  lineCustomerName,
  lineCustomerPhone,
  lineLotCustomerSeen,
} = require("../container_manifest");

const VIN = "1HGCM82633A004352";
const car = (extra = {}) => ({kind: "car", vinNumber: VIN, ...extra});
const refusal = containerTransitionRefusal;

describe("a container's identity", () => {
  it("needs a working name and nothing else to exist", () => {
    assert.deepEqual(validateContainer({label: "Sailing 3 Oct"}), []);
    assert.deepEqual(validateContainer({}), ["container_label_required"]);
    // A number or a booking reference is a name enough.
    assert.deepEqual(validateContainer({containerNumber: "MSKU1234567"}), []);
    assert.deepEqual(validateContainer({bookingReference: "CMA-77120"}), []);
  });

  // The number arrives from the line after the box is half full; when it
  // does, it has to be a real one so it can be tracked later.
  it("accepts an ISO container number and refuses anything else as one", () => {
    assert.deepEqual(
        validateContainer({label: "x", containerNumber: "msku1234567"}), []);
    assert.deepEqual(
        validateContainer({label: "x", containerNumber: "BOOK-99881"}),
        ["container_number_invalid"]);
  });

  it("keeps the booking reference apart from the number", () => {
    const record = containerRecord({
      label: " Box 2 ", containerNumber: "msku1234567",
      bookingReference: "cma-77120", destinationCountryId: "GN",
      destinationCountryName: "Guinea", notes: "tyres on top",
    });
    assert.equal(record.label, "Box 2");
    assert.equal(record.containerNumber, "MSKU1234567");
    assert.equal(record.bookingReference, "CMA-77120");
    assert.equal(record.destinationCountryId, "GN");
  });
});

describe("a container's life", () => {
  const loading = (extra = {}) =>
    ({status: "loading", destinationCountryId: "GN", ...extra});

  it("moves forward only", () => {
    assert.equal(refusal(loading(), "shipped", 3), null);
    assert.equal(refusal({status: "shipped"}, "arrived", 3), null);
    assert.equal(refusal({status: "shipped"}, "loading", 3),
        "container_transition_invalid");
    assert.equal(refusal({status: "arrived"}, "shipped", 3),
        "container_transition_invalid");
    assert.equal(refusal(loading(), "loading", 3),
        "container_transition_invalid");
    assert.equal(refusal(loading(), "sold", 3), "container_status_invalid");
  });

  it("will not ship empty, or to nowhere", () => {
    assert.equal(refusal(loading(), "shipped", 0), "container_empty");
    assert.equal(refusal({status: "loading"}, "shipped", 2),
        "destination_required");
  });

  it("reads a record with no status as still loading", () => {
    assert.equal(containerIsOpen({}), true);
    assert.equal(containerIsOpen({status: "shipped"}), false);
  });

  it("can be deleted only while loading and empty", () => {
    assert.equal(containerDeleteRefusal({status: "loading"}, 0), null);
    assert.equal(containerDeleteRefusal({status: "loading"}, 2),
        "container_has_lines");
    assert.equal(containerDeleteRefusal({status: "shipped"}, 0),
        "container_locked");
  });
});

describe("a line on the list", () => {
  // The name painted on the barrel is the receiver's, not the sender's;
  // whoever opens the box in Conakry matches lines by it. Stock has one too
  // (the business's agent), so it is never tied to the owner kind.
  it("keeps the receiver at destination for any owner", () => {
    const line = containerLineRecord({
      kind: "barrels", quantity: 3, ownerKind: "stock",
      receiverName: "  Mariama Bah ", receiverPhone: "+224 620 00 00 00",
    }, {containerId: "c1"});
    assert.equal(line.receiverName, "Mariama Bah");
    // Stored without the spaces, so the number can be messaged.
    assert.equal(line.receiverPhone, "+224620000000");
    assert.equal(line.customerName, "");
  });

  it("asks each kind for what identifies it", () => {
    assert.deepEqual(validateContainerLine(car({ownerKind: "stock"})), []);
    assert.deepEqual(
        validateContainerLine(car({vinNumber: "ABC", ownerKind: "stock"})),
        ["vin_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "barrels", ownerKind: "customer",
          customerName: "Fatou", receiverName: "Mariama"}),
        ["quantity_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "other", quantity: 2, ownerKind: "stock"}),
        ["description_required"]);
    assert.deepEqual(
        validateContainerLine({kind: "pallet", ownerKind: "stock"}),
        ["line_kind_invalid"]);
  });

  // A stock car has no customer; demanding a name there is how fictional
  // customers get typed into the memory. A customer's line names who
  // collects it; the sender is optional (owner, 2026-10-21).
  it("asks a customer's line for its receiver, never for its sender", () => {
    assert.deepEqual(validateContainerLine(car({ownerKind: "customer"})),
        ["receiver_name_required"]);
    assert.deepEqual(validateContainerLine(car({ownerKind: "customer",
      customerName: "Fatou"})), ["receiver_name_required"]);
    assert.deepEqual(validateContainerLine(car({ownerKind: "customer",
      receiverName: "Mariama"})), [], "no sender is fine");
    assert.deepEqual(validateContainerLine(car({ownerKind: "customer",
      receiverName: "  "})), ["receiver_name_required"]);
    // Stock keeps the receiver optional.
    assert.deepEqual(validateContainerLine(car({ownerKind: "stock"})), []);
    assert.deepEqual(validateContainerLine(car({ownerKind: "somebody"})),
        ["owner_kind_invalid"]);
    assert.equal(CONTAINER_MESSAGES.receiver_name_required,
        "Enter the receiver's name.");
  });

  // An old app sends a sender and no receiver: the refusal is plain English,
  // which is what it shows.
  it("refuses an old app's line with no receiver in words it can show", () => {
    const errors = validateContainerLine({kind: "barrels", quantity: 2,
      ownerKind: "customer", customerName: "Fatou",
      customerPhone: "+16465550100"});
    assert.deepEqual(errors, ["receiver_name_required"]);
    assert.equal(CONTAINER_MESSAGES[errors[0]], "Enter the receiver's name.");
  });

  it("stores the receiver as the sender when they are the same person",
      () => {
        const input = {kind: "barrels", quantity: 1, ownerKind: "customer",
          customerName: "stale", customerPhone: "not a phone",
          receiverName: " Mariama Bah ", receiverPhone: "+224 620 00 00 00",
          senderIsReceiver: true};
        // The hidden sender fields are not checked: the receiver's are.
        assert.deepEqual(validateContainerLine(input), []);
        const line = containerLineRecord(input);
        assert.equal(line.senderIsReceiver, true);
        assert.equal(line.customerName, "Mariama Bah");
        assert.equal(line.customerPhone, "+224620000000");
        assert.equal(line.receiverName, "Mariama Bah");
        assert.equal(line.notifyCustomer, true);
        // Their one switch is the receiver's.
        const quiet = containerLineRecord({...input, notifyReceiver: false});
        assert.equal(quiet.notifyCustomer, false);
        assert.equal(quiet.notifyReceiver, false);
        // Off by default, and never on stock.
        assert.equal(containerLineRecord({...input,
          senderIsReceiver: undefined}).senderIsReceiver, false);
        assert.equal(containerLineRecord({...input,
          ownerKind: "stock"}).senderIsReceiver, false);
        assert.equal(containerLineRecord({...input,
          ownerKind: "stock"}).customerName, "");
      });

  it("takes the receiver as the customer when there is no sender", () => {
    const line = {ownerKind: "customer", customerName: "", customerPhone: "",
      receiverName: "Mariama", receiverPhone: "+224620000000"};
    assert.deepEqual(lineCustomer(line),
        {name: "Mariama", phone: "+224620000000"});
    assert.equal(lineCustomerName(line), "Mariama");
    assert.equal(lineCustomerPhone(line), "+224620000000");
    // A sender, even one given only by phone, is the customer: the name
    // and the phone never come from two different people.
    assert.deepEqual(lineCustomer({...line, customerName: "Fatou"}),
        {name: "Fatou", phone: ""});
    assert.deepEqual(lineCustomer({...line, customerPhone: "+16465550100"}),
        {name: "", phone: "+16465550100"});
    // Stock has no customer, whoever collects it.
    assert.deepEqual(lineCustomer({...line, ownerKind: "stock"}),
        {name: "", phone: ""});
    assert.deepEqual(lineCustomer(null), {name: "", phone: ""});
    // What the lot's customer memory learns.
    assert.deepEqual(lineLotCustomerSeen(line), {customerName: "Mariama",
      customerPhone: "+224620000000", customerEmail: ""});
  });

  it("keeps each kind's fields and drops the others", () => {
    const stockCar = containerLineRecord({
      kind: "car", vinNumber: VIN.toLowerCase(), carMake: "Honda",
      carModel: "Accord", carYear: "2003", quantity: 7,
      description: "ignored", ownerKind: "stock", customerName: "ignored",
    }, {containerId: "c1", containerStatus: "loading", addedByStaffId: "s1"});
    assert.equal(stockCar.vinNumber, VIN);
    assert.equal(stockCar.quantity, 1);
    assert.equal(stockCar.description, "");
    assert.equal(stockCar.customerName, "");
    assert.equal(stockCar.containerStatus, "loading");

    const barrels = containerLineRecord({
      kind: "barrels", quantity: 8, ownerKind: "customer",
      customerName: "Fatou Diallo", customerPhone: "+1 646 555 0100",
    }, {containerId: "c1"});
    assert.equal(barrels.receiverName, "", "no receiver until one is named");
    assert.equal(barrels.receiverPhone, "");
    assert.equal(barrels.quantity, 8);
    assert.equal(barrels.vinNumber, "");
    assert.equal(barrels.customerName, "Fatou Diallo");
  });
});

describe("who hears about a line", () => {
  const customerLine = (extra = {}) => ({
    kind: "barrels", quantity: 2, ownerKind: "customer",
    customerName: "Fatou Diallo", receiverName: "Mariama", ...extra,
  });

  // Both people are told the box sailed unless staff say otherwise; there is
  // nobody to tell without a number, so the switch is off without one.
  it("tells the sender and the receiver by default, when they have a number",
      () => {
        const line = containerLineRecord(customerLine({
          customerPhone: "+1 (646) 555-0100",
          receiverName: "Mariama", receiverPhone: "+224 620-00-00-00",
        }));
        assert.equal(line.customerPhone, "+16465550100");
        assert.equal(line.notifyCustomer, true);
        assert.equal(line.notifyReceiver, true);

        const noPhones = containerLineRecord(customerLine());
        assert.equal(noPhones.notifyCustomer, false);
        assert.equal(noPhones.notifyReceiver, false);
      });

  it("keeps a person quiet when staff switch them off", () => {
    const line = containerLineRecord(customerLine({
      customerPhone: "+16465550100", notifyCustomer: false,
      receiverPhone: "+224620000000", notifyReceiver: "false",
    }));
    assert.equal(line.notifyCustomer, false);
    assert.equal(line.notifyReceiver, false);
  });

  // Stock has no customer to tell; its receiver (the business's agent) may
  // still be told.
  it("never keeps a customer phone on business stock", () => {
    const line = containerLineRecord({
      kind: "barrels", quantity: 1, ownerKind: "stock",
      customerPhone: "+16465550100", receiverPhone: "+224620000000",
    });
    assert.equal(line.customerPhone, "");
    assert.equal(line.notifyCustomer, false);
    assert.equal(line.notifyReceiver, true);
  });

  it("refuses a phone that is not a phone, and allows none at all", () => {
    assert.deepEqual(
        validateContainerLine(customerLine({customerPhone: "call me"})),
        ["customer_phone_invalid"]);
    assert.deepEqual(
        validateContainerLine(customerLine({receiverPhone: "12"})),
        ["receiver_phone_invalid"]);
    assert.deepEqual(validateContainerLine(customerLine()), []);
    // Older app versions send local numbers; they are kept, not refused.
    assert.deepEqual(
        validateContainerLine(customerLine({customerPhone: "622 11 22 33"})),
        []);
  });

  // Only the full international form can be messaged.
  it("tells an international number from a local one", () => {
    assert.equal(isInternationalPhone("+224 622 11 22 33"), true);
    assert.equal(isInternationalPhone("622112233"), false);
    assert.equal(isInternationalPhone(""), false);
  });

  it("corrects contacts later without losing what was not sent", () => {
    const stored = containerLineRecord(customerLine({
      customerPhone: "622112233", receiverName: "Mariama",
      receiverPhone: "+224620000000",
    }));
    assert.deepEqual(
        validateContainerLineContacts({customerPhone: "+224622112233"},
            stored),
        []);
    const update = containerLineContactsUpdate(
        {customerPhone: "+224 622 11 22 33"}, stored);
    assert.equal(update.customerPhone, "+224622112233");
    assert.equal(update.customerName, "Fatou Diallo");
    assert.equal(update.receiverName, "Mariama");
    assert.equal(update.notifyReceiver, true);
    // The sender may be taken away; the receiver may not.
    assert.deepEqual(
        validateContainerLineContacts({customerName: " "}, stored), []);
    assert.deepEqual(
        validateContainerLineContacts({receiverName: " "}, stored),
        ["receiver_name_required"]);
    assert.deepEqual(
        validateContainerLineContacts({receiverPhone: "nope"}, stored),
        ["receiver_phone_invalid"]);
  });

  // Lines saved before the receiver's name was required.
  it("lets an old line with no receiver keep its contacts until they change",
      () => {
        const old = {kind: "barrels", quantity: 2, ownerKind: "customer",
          customerName: "Fatou", customerPhone: "+16465550100",
          receiverName: "", receiverPhone: ""};
        // Re-sending the same contacts (an old app's sheet saved unchanged).
        assert.deepEqual(validateContainerLineContacts(
            {customerName: "Fatou", customerPhone: "+1 646 555 0100"}, old),
        []);
        assert.equal(lineContactsEdited(old, {...old}), false);
        // Editing who it is from now asks who it is for.
        assert.deepEqual(validateContainerLineContacts(
            {customerPhone: "+16465550199"}, old), ["receiver_name_required"]);
        assert.equal(lineContactsEdited(old, {...old, ownerKind: "stock"}),
            true);
      });

  it("ticks and unticks sender is the receiver on a contacts edit", () => {
    const stored = containerLineRecord(customerLine({
      customerPhone: "+16465550100", receiverPhone: "+224620000000"}));
    const same = containerLineContactsUpdate({senderIsReceiver: true},
        stored);
    assert.equal(same.senderIsReceiver, true);
    assert.equal(same.customerName, "Mariama");
    assert.equal(same.customerPhone, "+224620000000");
    const apart = containerLineContactsUpdate({senderIsReceiver: false,
      customerName: "", customerPhone: ""}, {...stored, ...same});
    assert.equal(apart.senderIsReceiver, false);
    assert.equal(apart.customerName, "");
    assert.equal(apart.customerPhone, "");
    assert.deepEqual(validateContainerLineContacts({senderIsReceiver: false,
      customerName: "", customerPhone: ""}, {...stored, ...same}), []);
  });
});

describe("one open container per car", () => {
  const line = (containerId, containerStatus, kind = "car") =>
    ({kind, containerId, containerStatus, vinNumber: VIN});

  it("names the open container already holding the VIN", () => {
    assert.equal(openContainerHoldingVin([line("c1", "loading")]), "c1");
    assert.equal(openContainerHoldingVin([line("c1", "shipped")]), "c1");
  });

  it("lets a car that has arrived be shipped again later", () => {
    assert.equal(openContainerHoldingVin([line("c1", "arrived")]), "");
  });

  it("ignores the container the line is being moved from", () => {
    assert.equal(openContainerHoldingVin([line("c1", "loading")], "c1"), "");
  });

  it("only cars conflict", () => {
    assert.equal(
        openContainerHoldingVin([line("c1", "loading", "barrels")]), "");
  });
});

describe("what a container carries", () => {
  it("counts barrels by quantity and the rest by line", () => {
    assert.deepEqual(containerCounts([
      {kind: "car"}, {kind: "car"},
      {kind: "barrels", quantity: 8}, {kind: "barrels", quantity: 12},
      {kind: "other", quantity: 2},
    ]), {lineCount: 5, carCount: 2, barrelCount: 20, otherCount: 2});
    assert.deepEqual(containerCounts([]),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
  });
});

describe("keeping the tallies without re-reading every line", () => {
  it("adds and takes away one line's share", () => {
    assert.deepEqual(containerCountsDelta({kind: "barrels", quantity: 3}, 1),
        {lineCount: 1, barrelCount: 3});
    assert.deepEqual(containerCountsDelta({kind: "car"}, -1),
        {lineCount: -1, carCount: -1});
    assert.deepEqual(containerCountsDelta({kind: "other", quantity: 2}, 1),
        {lineCount: 1, otherCount: 2});
  });

  it("lands where a full recount would after adds, moves and removes", () => {
    const lines = [{kind: "car"}, {kind: "barrels", quantity: 8},
      {kind: "other", quantity: 2}, {kind: "barrels", quantity: 1}];
    const tally = {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0};
    const apply = (line, sign) => {
      for (const [key, value] of Object.entries(
          containerCountsDelta(line, sign))) {
        tally[key] += value;
      }
    };
    lines.forEach((line) => apply(line, 1));
    apply(lines[3], -1);
    assert.deepEqual(tally, containerCounts(lines.slice(0, 3)));
  });
});

describe("editing a line after it was added", () => {
  const barrels = (extra = {}) => containerLineRecord({
    kind: "barrels", quantity: 3, ownerKind: "customer",
    customerName: "Fatou", customerPhone: "+16465550100",
    receiverName: "Mariama", receiverPhone: "+224620000000", ...extra,
  }, {containerId: "c1"});
  const carRow = (extra = {}) => containerLineRecord({
    kind: "car", vinNumber: VIN, carMake: "Honda", carModel: "Accord",
    carYear: "2003", ownerKind: "customer", customerName: "Fatou",
    ...extra,
  }, {containerId: "c1"});
  const edit = (current, input) => {
    const next = containerLineEditTarget(current, input, false);
    return {next, changes: containerLineEditChanges(current, next)};
  };

  it("finds only the fields that really changed", () => {
    const current = barrels();
    assert.deepEqual(edit(current, {quantity: 5}).changes, ["quantity"]);
    // The same line sent back whole changes nothing.
    assert.deepEqual(edit(current, {...current}).changes, []);
    // Formatting a person typed is not a change.
    assert.deepEqual(
        edit(current, {customerPhone: "+1 (646) 555-0100"}).changes, []);
    // A legacy line with no WhatsApp switches reads as switched on.
    const legacy = {...current};
    delete legacy.notifyCustomer;
    delete legacy.notifyReceiver;
    assert.deepEqual(
        containerLineEditChanges(legacy, containerLineEditTarget(
            legacy, {notifyCustomer: true, notifyReceiver: true}, true)),
        []);
  });

  it("keeps the car fields only on a car, and empties them on a new kind",
      () => {
        const {next, changes} = edit(carRow(), {kind: "barrels", quantity: 4});
        assert.equal(next.vinNumber, "");
        assert.equal(next.carMake, "");
        assert.equal(next.quantity, 4);
        assert.deepEqual(changes, ["kind", "vinNumber", "carMake",
          "carModel", "carYear", "quantity"]);
      });

  it("takes only the contacts in contacts-only mode", () => {
    const current = barrels();
    const next = containerLineEditTarget(current,
        {quantity: 9, kind: "car", receiverPhone: "+224 621 00 00 00"}, true);
    assert.equal(next.quantity, 3);
    assert.equal(next.kind, "barrels");
    assert.equal(next.receiverPhone, "+224621000000");
    assert.deepEqual(containerLineEditChanges(current, next),
        ["receiverPhone"]);
    // The sender is optional; the receiver is not.
    assert.deepEqual(validateContainerLineEdit(current, {customerName: ""},
        true), []);
    assert.deepEqual(validateContainerLineEdit(current, {receiverName: ""},
        true), ["receiver_name_required"]);
    // Contacts-only mode never judges the kind's own fields.
    assert.deepEqual(validateContainerLineEdit(current, {quantity: 0}, true),
        []);
  });

  it("checks a whole-line edit the way an add is checked", () => {
    assert.deepEqual(validateContainerLineEdit(barrels(), {quantity: 0},
        false), ["quantity_required"]);
    assert.deepEqual(validateContainerLineEdit(carRow(), {vinNumber: "1"},
        false), ["vin_required"]);
    assert.deepEqual(validateContainerLineEdit(barrels(),
        {ownerKind: "stock"}, false), []);
  });

  // carRow() is a line saved before the receiver's name was required.
  it("lets an old line with no receiver take an edit that leaves its people",
      () => {
        const old = carRow();
        assert.equal(old.receiverName, "");
        for (const input of [{carMake: "Toyota"}, {priceCents: 50000},
          {destinationCountryId: "GN", destinationCountryName: "Guinea"},
          {...old}]) {
          assert.deepEqual(validateContainerLineEdit(old, input, false), [],
              JSON.stringify(input));
        }
        const oldBarrels = barrels({receiverName: "", receiverPhone: ""});
        assert.deepEqual(validateContainerLineEdit(oldBarrels,
            {pieces: null, quantity: 5}, false), []);
        // Its people edited: now it names its receiver.
        assert.deepEqual(validateContainerLineEdit(old,
            {customerPhone: "+16465550100"}, false),
        ["receiver_name_required"]);
        assert.deepEqual(validateContainerLineEdit(old,
            {customerPhone: "+16465550100"}, true),
        ["receiver_name_required"]);
        assert.deepEqual(validateContainerLineEdit(old,
            {customerPhone: "+16465550100", receiverName: "Awa"}, false), []);
        // A stock line turned into a customer's has to name one.
        const stock = carRow({ownerKind: "stock", customerName: ""});
        assert.deepEqual(validateContainerLineEdit(stock,
            {ownerKind: "customer"}, false), ["receiver_name_required"]);
      });

  it("records sender is the receiver as a contacts change", () => {
    const current = barrels();
    const {next, changes} = edit(current, {senderIsReceiver: true});
    assert.equal(next.senderIsReceiver, true);
    assert.equal(next.customerName, "Mariama");
    assert.deepEqual(changes, ["customerName", "customerPhone",
      "senderIsReceiver"]);
    assert.equal(lineEditIsContactsOnly(changes), true);
    assert.equal(containerLineEditAudit(current, next, changes).summary,
        "Changed customer's name, customer's phone, sender is the " +
        "receiver for Mariama");
  });

  it("lets contacts change in every state, the rest only while loading",
      () => {
        for (const status of ["loading", "shipped", "arrived"]) {
          assert.equal(containerLineEditRefusal({status},
              ["receiverPhone", "notifyReceiver"]), null, status);
        }
        assert.equal(containerLineEditRefusal({status: "loading"},
            ["quantity", "customerName"]), null);
        for (const status of ["shipped", "arrived"]) {
          for (const field of ["kind", "vinNumber", "carMake", "quantity",
            "description", "ownerKind"]) {
            assert.equal(containerLineEditRefusal({status}, [field]),
                "container_locked", `${field} on ${status}`);
          }
        }
        assert.equal(lineEditIsContactsOnly(["customerName"]), true);
        assert.equal(lineEditIsContactsOnly(["customerName", "quantity"]),
            false);
        assert.deepEqual([...LINE_CONTACT_FIELDS, ...LINE_SUBSTANCE_FIELDS,
          ...LINE_PRICE_FIELDS, ...LINE_PROOF_FIELDS].sort(),
        [...LINE_EDIT_FIELDS].sort());
      });

  it("hands the VIN lock over only when the car changes", () => {
    const current = carRow();
    const other = "2T1BURHE0JC123456";
    assert.deepEqual(containerLineVinHandover(current,
        edit(current, {vinNumber: other.toLowerCase()}).next),
    {releaseVin: VIN, takeVin: other});
    assert.deepEqual(containerLineVinHandover(current,
        edit(current, {carMake: "Toyota"}).next),
    {releaseVin: "", takeVin: ""});
    assert.deepEqual(containerLineVinHandover(current,
        edit(current, {kind: "barrels", quantity: 2}).next),
    {releaseVin: VIN, takeVin: ""});
    const was = barrels();
    assert.deepEqual(containerLineVinHandover(was,
        edit(was, {kind: "car", vinNumber: other}).next),
    {releaseVin: "", takeVin: other});
    assert.deepEqual(containerLineVinHandover(was,
        edit(was, {quantity: 7}).next), {releaseVin: "", takeVin: ""});
  });

  it("moves the tallies by the difference, and leaves the line count", () => {
    const current = barrels();
    assert.deepEqual(containerLineEditCountsDelta(current,
        edit(current, {quantity: 5}).next), {barrelCount: 2});
    assert.deepEqual(containerLineEditCountsDelta(current,
        edit(current, {kind: "car", vinNumber: VIN}).next),
    {barrelCount: -3, carCount: 1});
    assert.deepEqual(containerLineEditCountsDelta(current,
        edit(current, {receiverName: "Awa"}).next), {});
    // Applied to the stored tallies, an edit lands on a full recount.
    const lines = [current, carRow(), barrels({quantity: 1})];
    const tally = containerCounts(lines);
    const after = edit(lines[0], {kind: "other", quantity: 2,
      description: "tires"}).next;
    for (const [key, value] of Object.entries(
        containerLineEditCountsDelta(lines[0], after))) {
      tally[key] += value;
    }
    assert.deepEqual(tally, containerCounts([after, lines[1], lines[2]]));
  });

  it("writes the history in words, keeping the contacts sentence", () => {
    const current = barrels();
    let {next, changes} = edit(current, {quantity: 5});
    assert.deepEqual(containerLineEditAudit(current, next, changes), {
      action: "line_edited",
      summary: "Edited 5 barrels (was 3 barrels): quantity for Fatou",
    });
    ({next, changes} = edit(current, {receiverPhone: "+224621000000",
      customerName: "Fatou Ba"}));
    assert.deepEqual(containerLineEditAudit(current, next, changes), {
      action: "line_contacts_edited",
      summary: "Changed customer's name, receiver's phone for Fatou Ba",
    });
    const car = carRow();
    ({next, changes} = edit(car, {carMake: "Toyota", carModel: "Camry"}));
    assert.equal(containerLineEditAudit(car, next, changes).summary,
        `Edited car ${VIN}: make, model for Fatou`);
    ({next, changes} = edit(car, {kind: "barrels", quantity: 1,
      ownerKind: "stock"}));
    assert.equal(containerLineEditAudit(car, next, changes).summary,
        `Edited 1 barrel (was car ${VIN}): kind, owner (business stock)`);
    ({next, changes} = edit(current, {kind: "other", quantity: 2,
      description: "tires"}));
    assert.equal(containerLineEditAudit(current, next, changes).summary,
        "Edited 2 × tires (was 3 barrels): kind for Fatou");
  });

  it("names lines and fields the way the history always has", () => {
    assert.equal(barrelsLabel(1), "1 barrel");
    assert.equal(barrelsLabel(3), "3 barrels");
    assert.equal(containerLineWhat({kind: "car", vinNumber: "abc123"}),
        "car ABC123");
    assert.equal(containerLineWhat({kind: "other", quantity: 2,
      description: "tires"}), "2 × tires");
    assert.equal(CONTACT_FIELD_LABELS.receiverPhone, "receiver's phone");
    assert.deepEqual(containerLineEditLabels(["kind", "vinNumber",
      "quantity", "receiverName"]), ["kind", "receiver's name"]);
    assert.deepEqual(containerLineEditLabels(["ownerKind", "customerName",
      "customerPhone"]), ["owner"]);
    for (const key of LINE_EDIT_FIELDS) {
      assert.ok(LINE_FIELD_LABELS[key], `${key} has a history label`);
    }
    assert.deepEqual(Object.keys(containerLineEditable({})).sort(),
        [...LINE_EDIT_FIELDS].sort());
  });
});

describe("the VIN lock", () => {
  const lock = {businessId: "biz_a", vinNumber: VIN, containerId: "c1",
    lineId: "l1"};
  const held = (extra = {}) => car({businessId: "biz_a", containerId: "c1",
    containerStatus: "loading", ...extra});

  it("is one document per business and VIN, however the VIN was typed", () => {
    assert.equal(containerVinLockId("biz_a", VIN), `biz_a_${VIN}`);
    assert.equal(containerVinLockId("biz_a", ` ${VIN.toLowerCase()} `),
        `biz_a_${VIN}`);
    assert.notEqual(containerVinLockId("biz_a", VIN),
        containerVinLockId("biz_b", VIN));
    assert.equal(containerVinLockId("biz/a", "AB/C123"), "biza_ABC123");
    assert.equal(containerVinLockId("", VIN), "");
    assert.equal(containerVinLockId("biz_a", ""), "");
  });

  it("holds while its line is on a box that has not arrived", () => {
    assert.equal(vinLockHolder(lock, held()), "c1");
    assert.equal(vinLockHolder(lock, held({containerStatus: "shipped"})),
        "c1");
    // A moved line names its new container, whatever the lock says.
    assert.equal(vinLockHolder(lock, held({containerId: "c2"})), "c2");
  });

  // A release that never happened must not block the car for good.
  it("is free once its line is gone, arrived, or no longer that car", () => {
    assert.equal(vinLockHolder(null, held()), "");
    assert.equal(vinLockHolder(lock, null), "");
    assert.equal(vinLockHolder(lock, held({containerStatus: "arrived"})), "");
    assert.equal(vinLockHolder(lock, held({vinNumber: "OTHERVIN123"})), "");
    assert.equal(vinLockHolder(lock, held({kind: "barrels"})), "");
    assert.equal(vinLockHolder(lock, held({businessId: "biz_b"})), "");
  });
});

describe("first write wins", () => {
  it("keeps a stored code or token and only fills an empty one", () => {
    assert.deepEqual(keepExisting("CL-AAAAAA", "CL-BBBBBB"),
        {value: "CL-AAAAAA", write: false});
    assert.deepEqual(keepExisting("", "CL-BBBBBB"),
        {value: "CL-BBBBBB", write: true});
    assert.deepEqual(keepExisting(undefined, "tok"),
        {value: "tok", write: true});
    assert.deepEqual(keepExisting("  ", "tok"), {value: "tok", write: true});
  });
});

describe("finishing a status change that only half landed", () => {
  it("treats asking again for the same shipped or arrived as a repair", () => {
    assert.equal(containerStatusIsRepeat({status: "shipped"}, "shipped"),
        true);
    assert.equal(containerStatusIsRepeat({status: "arrived"}, "arrived"),
        true);
    assert.equal(containerStatusIsRepeat({status: "loading"}, "loading"),
        false);
    assert.equal(containerStatusIsRepeat({}, "loading"), false);
    assert.equal(containerStatusIsRepeat({status: "loading"}, "shipped"),
        false);
    assert.equal(containerStatusIsRepeat({status: "arrived"}, "shipped"),
        false);
  });

  it("sees lines that have not caught up, or have no code", () => {
    const done = {containerStatus: "shipped", trackingCode: "CL-AAAAAA"};
    assert.equal(linesLagStatus([done, done], "shipped"), false);
    assert.equal(linesLagStatus([done,
      {containerStatus: "loading", trackingCode: "CL-B"}], "shipped"), true);
    assert.equal(linesLagStatus([{containerStatus: "shipped"}], "shipped"),
        true);
    assert.equal(linesLagStatus([], "shipped"), false);
  });
});

describe("working in groups", () => {
  it("splits a list into groups of at most the size, in order", () => {
    assert.deepEqual(inGroups([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(inGroups([], 10), []);
    assert.deepEqual(inGroups([1, 2], 0), [[1], [2]]);
    assert.deepEqual(inGroups(null, 3), []);
  });
});

// The wiring, pinned by reading the source: the callables need Firestore to
// run, and what matters is that each one is gated on the containers section,
// that every change is audited as a container, and that the /d page can find
// a loading list by its own token.
describe("a package waiting for a container", () => {
  const waiting = (extra = {}) => ({kind: "barrels", quantity: 3,
    ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", destinationCountryId: "gn",
    destinationCountryName: "Guinea", ...extra});
  const stored = (extra = {}) => ({businessId: "biz", ...containerLineRecord(
      waiting(extra), {containerId: "", containerStatus: LINE_STATUS_WAITING}),
  ...extra});

  it("needs a customer and a destination, on top of what a line needs", () => {
    assert.deepEqual(validateWaitingPackage(waiting()), []);
    assert.deepEqual(validateWaitingPackage(waiting({
      destinationCountryId: " "})), ["package_destination_required"]);
    // Stock is not "dropped off": there is a customer or nothing to wait for.
    assert.deepEqual(validateWaitingPackage(waiting({ownerKind: "stock"})),
        ["owner_kind_invalid"]);
    assert.deepEqual(validateWaitingPackage({}), [
      "line_kind_invalid", "owner_kind_invalid",
      "package_destination_required"]);
    assert.deepEqual(validateWaitingPackage(waiting({kind: "car",
      vinNumber: "AB"})), ["vin_required"]);
    assert.deepEqual(validateWaitingPackage(waiting({kind: "other",
      description: "", quantity: 0})),
    ["description_required", "quantity_required"]);
  });

  it("is stored with no container, its destination, and nothing paid", () => {
    const line = containerLineRecord(waiting({priceCents: 12500,
      payOnArrival: true, paidCents: 99999}),
    {containerId: "", containerStatus: LINE_STATUS_WAITING,
      addedByStaffId: "u1"});
    assert.equal(line.containerId, "");
    assert.equal(line.containerStatus, "waiting");
    assert.equal(line.destinationCountryId, "gn");
    assert.equal(line.destinationCountryName, "Guinea");
    assert.equal(line.priceCents, 12500);
    assert.equal(line.payOnArrival, true);
    // What was paid is the server's: a request can never set it.
    assert.equal(line.paidCents, 0);
    assert.equal(line.lengthIn, null);
    assert.equal(lineIsWaiting(line), true);
    assert.equal(lineIsWaiting({...line, containerId: "c1"}), false);
    assert.equal(lineIsWaiting({...line, containerStatus: "loading"}), false);
  });

  describe("size", () => {
    it("is length by width by height in inches, all three or none", () => {
      assert.deepEqual(validateContainerLine(waiting({lengthIn: 30,
        widthIn: 20, heightIn: 12.5})), []);
      assert.deepEqual(validateContainerLine(waiting()), []);
      for (const bad of [{lengthIn: 30}, {lengthIn: 30, widthIn: 20,
        heightIn: 0}, {lengthIn: 30, widthIn: 20, heightIn: -4},
      {lengthIn: 30, widthIn: 20, heightIn: "wide"},
      {lengthIn: 30, widthIn: 20, heightIn: 601}]) {
        assert.deepEqual(validateContainerLine(waiting(bad)),
            ["size_invalid"], JSON.stringify(bad));
      }
    });

    it("works out cubic feet and reads as one line", () => {
      const line = {lengthIn: 48, widthIn: 24, heightIn: 36};
      assert.equal(lineVolumeCubicFeet(line), 24);
      assert.equal(lineVolumeCubicFeet({lengthIn: 30, widthIn: 20,
        heightIn: 12.5}), 4.34);
      assert.equal(lineSizeText(line), "48 × 24 × 36 in");
      assert.equal(lineVolumeCubicFeet({lengthIn: 30}), null);
      assert.equal(lineSizeText({lengthIn: 30}), "");
      assert.equal(dimensionOf("12.345"), 12.35);
      assert.equal(dimensionOf(""), null);
      assert.equal(dimensionOf(null), null);
    });
  });

  describe("price", () => {
    it("is whole cents above zero, or none yet", () => {
      assert.deepEqual(validateContainerLine(waiting({priceCents: 15000})),
          []);
      assert.deepEqual(validateContainerLine(waiting({priceCents: null})),
          []);
      for (const bad of [0, -5, 12.5, "abc", 100000001]) {
        assert.deepEqual(validateContainerLine(waiting({priceCents: bad})),
            ["price_invalid"], String(bad));
      }
    });

    it("never believes a request about what was paid", () => {
      assert.deepEqual(validateContainerLine(waiting({priceCents: 15000,
        paidCents: 99999})), []);
      assert.deepEqual(validateWaitingPackage(waiting({priceCents: 15000,
        paidCents: 99999})), []);
    });

    it("never drops below what was paid on an edit", () => {
      const row = stored({priceCents: 15000, paidCents: 5000});
      assert.deepEqual(validateContainerLineEdit(row,
          {priceCents: 6000}, false), []);
      assert.deepEqual(validateContainerLineEdit(row,
          {priceCents: 4999}, false), ["price_below_paid"]);
      assert.deepEqual(validateContainerLineEdit(row,
          {priceCents: null}, false), ["price_below_paid"]);
      // A request cannot lower the bar by claiming it paid less.
      assert.deepEqual(validateContainerLineEdit(row,
          {priceCents: 4000, paidCents: 0}, false), ["price_below_paid"]);
    });
  });

  describe("destination", () => {
    const box = (id) => ({status: "loading", destinationCountryId: id});

    it("must match the container's, or the package stays out", () => {
      assert.equal(destinationMismatch({destinationCountryId: "gn"},
          box("gn")), null);
      assert.equal(destinationMismatch({destinationCountryId: "sn"},
          box("gn")), "destination_mismatch");
      // A container that has not decided yet cannot take a package that has.
      assert.equal(destinationMismatch({destinationCountryId: "gn"},
          {status: "loading"}), "container_destination_required");
      // Lines loaded before destinations existed ride anywhere.
      assert.equal(destinationMismatch({}, box("gn")), null);
      assert.equal(destinationMismatch({}, {}), null);
    });

    it("refuses all of a batch for the one that does not fit", () => {
      const entries = [
        {id: "a", line: stored()},
        {id: "b", line: stored({destinationCountryId: "sn"})},
        {id: "c", line: stored({destinationCountryId: "sn"})},
        {id: "d", line: stored()},
      ];
      assert.deepEqual(containerAssignRefusal(box("gn"), entries, "biz"),
          {code: "destination_mismatch", lineIds: ["b", "c"]});
      assert.equal(containerAssignRefusal(box("gn"),
          [entries[0], entries[3]], "biz"), null);
      assert.deepEqual(containerAssignRefusal({status: "loading"},
          [entries[0]], "biz"),
      {code: "container_destination_required", lineIds: ["a"]});
    });
  });

  describe("adding to a container", () => {
    const box = {status: "loading", destinationCountryId: "gn"};

    it("needs an open box and lines that are waiting and the business's",
        () => {
          assert.deepEqual(containerAssignRefusal({status: "shipped",
            destinationCountryId: "gn"}, [{id: "a", line: stored()}], "biz"),
          {code: "container_locked", lineIds: []});
          assert.deepEqual(containerAssignRefusal(box,
              [{id: "a", line: stored()}, {id: "gone", line: null}], "biz"),
          {code: "line_not_found", lineIds: ["gone"]});
          assert.deepEqual(containerAssignRefusal(box,
              [{id: "other", line: stored({businessId: "elsewhere"})}], "biz"),
          {code: "line_not_found", lineIds: ["other"]});
          const loaded = {...stored(), containerId: "c1",
            containerStatus: "loading"};
          assert.deepEqual(containerAssignRefusal(box,
              [{id: "a", line: stored()}, {id: "x", line: loaded}], "biz"),
          {code: "line_not_waiting", lineIds: ["x"]});
          assert.equal(containerAssignRefusal(box,
              [{id: "a", line: stored()}], "biz"), null);
        });

    it("takes one to a hundred distinct ids", () => {
      assert.deepEqual(cleanLineIds(["a", "b", "a"]),
          {ids: ["a", "b"], errors: []});
      for (const bad of [[], undefined, "a", [""], [1], [" "],
        Array.from({length: 101}, (_, i) => `l${i}`)]) {
        assert.deepEqual(cleanLineIds(bad),
            {ids: [], errors: ["line_ids_invalid"]}, JSON.stringify(bad));
      }
      assert.equal(cleanLineIds(Array.from({length: 100},
          (_, i) => `l${i}`)).ids.length, 100);
    });

    it("moves the tallies once, for the whole batch", () => {
      assert.deepEqual(containerLinesCountsDelta([
        {kind: "barrels", quantity: 3}, {kind: "car"},
        {kind: "barrels", quantity: 2}, {kind: "other", quantity: 4}], 1),
      {lineCount: 4, carCount: 1, barrelCount: 5, otherCount: 4});
      assert.deepEqual(containerLinesCountsDelta([
        {kind: "barrels", quantity: 3}], -1),
      {lineCount: -1, barrelCount: -3});
      assert.deepEqual(containerLinesCountsDelta([]), {});
    });
  });

  it("holds its car's VIN like a loaded line does", () => {
    const car = {kind: "car", vinNumber: VIN, containerId: "",
      containerStatus: "waiting"};
    assert.equal(openContainerHoldingVin([car]), WAITING_HOLDER);
    assert.equal(openContainerHoldingVin([car], "c1"), WAITING_HOLDER);
    // A lock whose line is waiting is not stale.
    assert.equal(vinLockHolder(
        {businessId: "biz", vinNumber: VIN},
        {...car, businessId: "biz"}), WAITING_HOLDER);
    // A loaded one still names its container, and an arrived one is free.
    assert.equal(openContainerHoldingVin([{...car, containerId: "c9",
      containerStatus: "loading"}]), "c9");
    assert.equal(openContainerHoldingVin([{...car, containerId: "c9",
      containerStatus: "arrived"}]), "");
  });

  describe("editing", () => {
    const edit = (current, input) => {
      const next = containerLineEditTarget(current, input, false);
      return {next, changes: containerLineEditChanges(current, next)};
    };

    it("changes what it is while it waits, and its price always", () => {
      const row = stored();
      const {next, changes} = edit(row, {quantity: 5, lengthIn: 30,
        widthIn: 20, heightIn: 10, destinationCountryId: "sn",
        destinationCountryName: "Senegal", priceCents: 9000});
      assert.deepEqual(changes, ["quantity", "destinationCountryId",
        "destinationCountryName", "lengthIn", "widthIn", "heightIn",
        "priceCents"]);
      // No container: as open as a loading one.
      assert.equal(containerLineEditRefusal(null, changes), null);
      assert.equal(containerLineEditAudit(row, next, changes).summary,
          "Edited 5 barrels (was 3 barrels): quantity, destination, size, " +
          "price for Fatou Diallo");
      // On a shipped box only contacts and the price may change.
      for (const key of ["priceCents", "payOnArrival", "receiverPhone"]) {
        assert.equal(containerLineEditRefusal({status: "shipped"}, [key]),
            null, key);
      }
      for (const key of ["quantity", "lengthIn", "destinationCountryId"]) {
        assert.equal(containerLineEditRefusal({status: "arrived"}, [key]),
            "container_locked", key);
      }
    });

    it("never changes what was paid", () => {
      const row = stored({paidCents: 5000, priceCents: 9000});
      const {next, changes} = edit(row, {paidCents: 0, priceCents: 9000});
      assert.equal(Object.hasOwn(next, "paidCents"), false);
      assert.deepEqual(changes, []);
    });
  });

  it("explains every refusal it can make", () => {
    for (const code of ["package_destination_required", "destination_mismatch",
      "container_destination_required", "size_invalid", "line_not_waiting",
      "line_is_waiting", "line_not_in_container", "line_ids_invalid",
      "line_has_payments", "price_invalid", "price_below_paid",
      "price_required", "amount_required", "amount_too_large",
      "payment_method_invalid", "payment_exceeds_balance",
      "payment_not_found", "payment_already_reverted",
      "vin_already_waiting"]) {
      assert.ok(CONTAINER_MESSAGES[code], code);
    }
  });
});

describe("the container callables and their gates", () => {
  const {readFileSync} = require("node:fs");
  const path = require("node:path");
  const source = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const rules = readFileSync(
      path.join(__dirname, "..", "..", "firestore.rules"), "utf8");
  const callable = (name) => {
    const start = source.indexOf(`exports.${name} = onCall(`);
    assert.ok(start > -1, `${name} not found`);
    const next = source.indexOf("\nexports.", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };
  // A shared helper the callables delegate their writes to (the scan to
  // load actions run the same ones).
  const helper = (name) => {
    const start = source.search(
        new RegExp(`\\n(async )?function ${name}\\(`));
    assert.ok(start > -1, `${name} not found`);
    const rest = source.slice(start + 1);
    const next = rest.search(/\n(async function|function|exports\.)/);
    return rest.slice(0, next === -1 ? undefined : next);
  };

  it("exposes every callable the clients call, gated on containers", () => {
    for (const name of ["createContainer", "updateContainer",
      "deleteContainer", "addContainerLine", "removeContainerLine",
      "moveContainerLine", "setContainerStatus", "updateContainerLine",
      "updateContainerLineContacts", "getContainerDocumentUrl",
      "addWaitingPackage", "assignContainerLines", "unassignContainerLine",
      "setContainerLinePrice", "recordContainerLinePayment",
      "revertContainerLinePayment", "getPackageLabels"]) {
      const body = callable(name);
      // The gate is either inline or the shared loader, which carries it.
      assert.match(body, /CONTAINER_SECTION|loadContainerFor\(/,
          `${name} must be gated on the containers section`);
    }
    assert.match(source, /const CONTAINER_SECTION = "containers";/);
    const loader = source.slice(
        source.indexOf("async function loadContainerFor("),
        source.indexOf("async function refreshContainerCounts("));
    assert.match(loader,
        /requireBusinessPermission\(uid, businessId, CONTAINER_SECTION\)/);
  });

  it("refuses a car already on an open container, naming it", () => {
    const body = callable("addContainerLine");
    assert.match(body, /openContainerHoldingVin\(/);
    assert.match(body, /conflictContainerId: conflict/);
    // Adding never exempts the container being added to: the same car twice
    // on one list is a mistake too. Only a move passes an exemption.
    assert.doesNotMatch(body, /openContainerHoldingVin\([\s\S]*?, ref\.id\)/);
  });

  // Regression: two quick adds of the same VIN both passed the query and
  // both wrote a line.
  it("checks and writes a car inside one transaction on its VIN lock", () => {
    const body = callable("addContainerLine");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body,
        /containerVinLockRef\(db, businessId, record\.vinNumber\)/);
    assert.match(body, /lockDoc = await tx\.get\(lockRef\)/);
    assert.match(body, /vinLockHolder\(lock,/);
    // The legacy query is part of the transaction too.
    assert.match(body, /await tx\.get\(db\.collection\("containerLines"\)/);
    assert.match(body, /tx\.create\(lockRef, lockBody\)/);
    assert.match(body, /tx\.set\(lineRef, \{/);
    // Losing the create race re-runs and refuses with the winner.
    assert.match(body, /error\.code !== 6/);
    // The checks come before the writes, as a transaction requires.
    assert.ok(body.indexOf("vinLockHolder(") < body.indexOf("tx.set(lineRef"));
    const lockRef = source.slice(
        source.indexOf("function containerVinLockRef("),
        source.indexOf("async function releaseContainerVinLocks("));
    assert.match(lockRef, /collection\("containerVinLocks"\)/);
  });

  it("lets go of a car's lock when its line is removed, moves it on a move",
      () => {
        const remove = callable("removeContainerLine");
        assert.match(remove, /db\.runTransaction\(/);
        assert.match(remove, /tx\.delete\(lockRef\)/);
        const move = callable("moveContainerLine");
        assert.match(move, /db\.runTransaction\(/);
        assert.match(move,
            /txWriteMove\(tx, \{lineRef, row, fromRef: from\.ref/);
        assert.match(helper("txWriteMove"),
            /tx\.update\(lockRef, \{containerId: toRef\.id/);
        const release = source.slice(
            source.indexOf("async function releaseContainerVinLocks("),
            source.indexOf("const CONTAINER_LINE_CODE_PREFIX"));
        assert.match(release, /=== group\[i\]\.id/);
      });

  // Regression: every add, move and remove re-read every line on the box.
  it("keeps the tallies with increments on add, remove and move", () => {
    assert.match(callable("addContainerLine"),
        /containerCountsIncrement\(record, 1\)/);
    assert.match(callable("removeContainerLine"),
        /containerCountsIncrement\(row, -1\)/);
    assert.match(callable("moveContainerLine"), /txWriteMove\(tx, /);
    const move = helper("txWriteMove");
    assert.match(move,
        /tx\.set\(fromRef, \{\s*\.\.\.containerCountsIncrement\(row, -1\)/);
    assert.match(move,
        /tx\.set\(toRef, \{\s*\.\.\.containerCountsIncrement\(row, 1\)/);
    for (const name of ["addContainerLine", "removeContainerLine",
      "moveContainerLine"]) {
      assert.doesNotMatch(callable(name), /refreshContainerCounts\(/,
          `${name} must not recount every line`);
    }
    // A status change still recounts in full, as a repair - but only after
    // the box is closed, so the absolute write cannot drop an increment.
    const status = callable("setContainerStatus");
    assert.ok(status.indexOf("refreshContainerCounts(db, ref)") >
      status.indexOf("applyContainerStatus(db, ref, next"));
    const poll = source.slice(
        source.indexOf("async function pollOneTrackedContainer("));
    assert.ok(poll.indexOf("refreshContainerCounts(db, ref)") >
      poll.indexOf("applyContainerStatus(db, ref, next"));
    // Deleting counts inside its transaction and never writes the tallies.
    const remove = callable("deleteContainer");
    assert.match(remove, /db\.runTransaction\(/);
    assert.doesNotMatch(remove, /refreshContainerCounts\(/);
    const increment = source.slice(
        source.indexOf("function containerCountsIncrement("),
        source.indexOf("function containerVinLockRef("));
    assert.match(increment, /FirestoreFieldValue\.increment\(value\)/);
  });

  // One implementation edits a line, whole or contacts only.
  it("edits a line through one transaction, contacts or whole", () => {
    const full = callable("updateContainerLine");
    const contacts = callable("updateContainerLineContacts");
    assert.match(full, /editContainerLine\(admin\.firestore\(\), \{/);
    assert.match(full, /contactsOnly: false/);
    assert.match(contacts, /editContainerLine\(admin\.firestore\(\), \{/);
    assert.match(contacts, /contactsOnly: true/);
    for (const whole of [full, contacts]) {
      const body = whole.slice(0, whole.indexOf("\n);\n"));
      assert.match(body,
          /requireBusinessPermission\(uid, businessId, CONTAINER_SECTION\)/);
      assert.doesNotMatch(body, /\.set\(|\.update\(/,
          "the callables write only through editContainerLine");
    }
    const edit = source.slice(
        source.indexOf("async function editContainerLine("),
        source.indexOf("exports.updateContainerLine = onCall("));
    assert.match(edit, /db\.runTransaction\(/);
    // Re-read inside the transaction, refused by the shared rule.
    assert.match(edit, /const lineDoc = await tx\.get\(lineRef\)/);
    assert.match(edit, /containerLineEditRefusal\(/);
    assert.match(edit, /reason: refusal/);
    // The VIN handover: same checks as an add, the line itself excluded.
    assert.match(edit, /containerLineVinHandover\(row, next\)/);
    assert.match(edit, /vinLockHolder\(lock,/);
    assert.match(edit, /heldBy !== lineId/);
    assert.match(edit, /\.filter\(\(d\) => d\.id !== lineId\)/);
    assert.match(edit, /conflictContainerId: conflict/);
    assert.match(edit, /tx\.create\(takeRef, lockBody\)/);
    assert.match(edit, /tx\.delete\(releaseRef\)/);
    assert.match(edit, /error\.code !== 6/);
    assert.ok(
        edit.indexOf("vinLockHolder(") < edit.indexOf("tx.update(lineRef"));
    // Tallies by increment, never a recount; the code is never rewritten.
    assert.match(edit, /containerLineEditCountsDelta\(row, next\)/);
    assert.match(edit, /FirestoreFieldValue\.increment\(value\)/);
    assert.doesNotMatch(edit, /refreshContainerCounts\(/);
    assert.doesNotMatch(edit, /trackingCode/);
    assert.match(edit, /containerLineEditAudit\(row, next, changes\)/);
  });

  // Regression: two first opens of the loading list could each mint a
  // token, and the second silently broke the first's link.
  it("mints the document token in a transaction, only if empty", () => {
    const body = callable("getContainerDocumentUrl");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /keepExisting\(fresh\.data\(\)\?\.documentToken/);
    assert.doesNotMatch(body, /batch\.set\(d\.ref, \{trackingCode/);
  });

  it("audits every change as a container", () => {
    assert.match(source, /entityType: "container", entityId: containerId/);
    for (const action of ["created", "edited", "deleted", "line_added",
      "line_removed", "line_moved"]) {
      assert.match(source, new RegExp(`"${action}", uid`),
          `audit action ${action}`);
    }
  });

  it("serves the loading list from its own token, not the payment one", () => {
    assert.match(source,
        /collection\("containers"\)\s*\.where\("documentToken", "==", token\)/);
    assert.match(source, /renderContainerDocument\(/);
  });

  it("adds a waiting car under the same VIN lock as a loaded one", () => {
    const body = callable("addWaitingPackage");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /takeVinLock\(tx, db, \{/);
    assert.match(body, /containerId: "", lineId: lineRef\.id/);
    assert.match(body, /tx\.create\(lockRef, lockBody\)/);
    assert.match(body, /error\.code !== 6/);
    assert.match(body,
        /containerId: "",\s*containerStatus: LINE_STATUS_WAITING/);
    const helper = source.slice(source.indexOf("async function takeVinLock("),
        source.indexOf("async function releaseContainerVinLocks("));
    assert.match(helper, /vinLockHolder\(lock,/);
    assert.match(helper, /openContainerHoldingVin\(/);
    assert.match(helper, /conflictContainerId: conflict/);
  });

  // Registering a package tells its people once (package_received, through
  // the shared queue); putting it on a box or taking it off tells nobody,
  // and none of these writes a moment on a container's timeline.
  it("tells customers only at registration, never when assigning", () => {
    const silent = new RegExp("recordContainerEvent|trackingEvents|" +
      "containerUpdates|whatsapp|customerUpdate|queuePackageReceived", "i");
    for (const name of ["assignContainerLines", "unassignContainerLine"]) {
      assert.doesNotMatch(callable(name), silent, name);
    }
    for (const name of ["addWaitingPackage", "addContainerLine"]) {
      const body = callable(name);
      assert.match(body, /await queuePackageReceived\(db, \{lineRef/, name);
      assert.doesNotMatch(body,
          /recordContainerEvent|trackingEvents|customerUpdate/, name);
    }
  });

  it("assigns all or none in one transaction that re-reads everything", () => {
    const body = callable("assignContainerLines");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /tx\.getAll\(\.\.\.lineRefs\)/);
    assert.match(body,
        /containerAssignRefusal\(boxData, entries, businessId\)/);
    // The checks come before any write, and the tallies move once.
    assert.ok(body.indexOf("containerAssignRefusal(") <
      body.indexOf("txWriteAssignment("));
    assert.ok(body.indexOf("txAssignmentReads(") <
      body.indexOf("txWriteAssignment("));
    const writes = helper("txWriteAssignment");
    assert.equal((writes.match(/tx\.set\(ref,/g) || []).length, 1);
    assert.match(writes, /containerLinesCountsDelta\(/);
    assert.match(writes, /tx\.update\(lock\.ref, \{containerId: ref\.id/);
    assert.doesNotMatch(body, /refreshContainerCounts\(/);
  });

  it("sends a package back to waiting with its lock and tallies", () => {
    const body = callable("unassignContainerLine");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /txWriteUnassign\(tx, /);
    const writes = helper("txWriteUnassign");
    assert.match(writes, /containerStatus: LINE_STATUS_WAITING/);
    // Scanning's marks leave with the package.
    assert.match(writes, /\.\.\.clearedLoadFields\(\)/);
    assert.match(writes, /containerCountsIncrement\(row, -1\)/);
    assert.match(writes, /tx\.update\(lockRef, \{containerId: ""/);
    assert.doesNotMatch(body + writes, /tx\.delete\(lockRef\)/);
  });

  it("records and reverts payments inside a transaction on the line", () => {
    const record = callable("recordContainerLinePayment");
    assert.match(record, /db\.runTransaction\(/);
    assert.match(record, /validateContainerLinePayment\(data/);
    // Who held the money is the chosen person; who typed it in is the uid.
    assert.match(record, /containerLinePaymentRecord\(data, uid\)/);
    assert.doesNotMatch(record, /receivedByStaffId: uid/);
    assert.ok(record.indexOf("validateContainerLinePayment(") <
      record.indexOf("tx.set(payRef"));
    const revert = callable("revertContainerLinePayment");
    assert.match(revert, /db\.runTransaction\(/);
    assert.match(revert, /reverted: true,\s*revertedByStaffId: uid/);
    assert.doesNotMatch(revert, /tx\.delete\(/);
    assert.match(callable("setContainerLinePrice"), /db\.runTransaction\(/);
  });

  it("takes money at drop-off in the transaction that creates the package",
      () => {
        const body = callable("addWaitingPackage");
        // Judged by the payment's own rules before anything is written.
        assert.match(body, /validateContainerLinePayment\(payment, \{/);
        assert.ok(body.indexOf("validateContainerLinePayment(") <
          body.indexOf("db.runTransaction("));
        assert.ok(body.indexOf("receivedByInvalid()") <
          body.indexOf("db.runTransaction("));
        const tx = body.slice(body.indexOf("db.runTransaction("),
            body.indexOf("await addLine();"));
        assert.match(tx, /tx\.set\(lineRef, \{[\s\S]*?paidCents,/);
        assert.match(tx, /tx\.set\(payRef, \{[\s\S]*?\.\.\.paymentRecord/);
        assert.match(body, /containerLinePaymentRecord\(payment, uid\)/);
        assert.match(body, /paymentId: payRef \? payRef\.id : ""/);
        // Both ways of taking money refuse a stranger as the receiver.
        for (const name of ["addWaitingPackage",
          "recordContainerLinePayment"]) {
          assert.match(callable(name), /businessPersonProfile\(/, name);
          assert.match(callable(name), /containerPaymentSummary\(/, name);
        }
      });

  it("prints the phone's labels from the same loaders as the page", () => {
    const body = callable("getPackageLabels");
    assert.match(body, /loadContainerFor\(db, uid, businessId, containerId\)/);
    assert.match(body, /containerLabelLines\(db, loaded\.ref, data\)/);
    assert.match(body, /looseLabelLines\(db, uid, businessId, data\)/);
    assert.match(body, /packageLabelsResponse\(model\)/);
    const url = callable("getContainerDocumentUrl");
    assert.match(url, /containerLabelLines\(db, ref, \{lineId\}\)/);
    const loose = source.slice(
        source.indexOf("async function containerLineLabelsUrl("),
        source.indexOf("async function containerLineLabelsPage("));
    assert.match(loose, /looseLabelLines\(db, uid, businessId, data\)/);
    // One copy of the loading, not two: neither callable loads lines itself.
    for (const own of [body, url, loose]) {
      assert.doesNotMatch(own,
          /assignMissingLineCodes\(|collection\("containerLines"\)/);
    }
  });

  it("serves a waiting package's labels from its own line token", () => {
    assert.match(source, new RegExp(
        "collection\\(\"containerLines\"\\)\\s*" +
        "\\.where\\(\"documentToken\", \"in\", group\\)"));
    const handler = source.slice(source.indexOf("exports.parkingDocument ="));
    assert.match(handler, /containerLineLabelsPage\(db, req, token\)/);
    assert.match(callable("getContainerDocumentUrl"),
        /containerLineLabelsUrl\(db, uid, businessId, data\)/);
  });

  it("keeps both collections read-only to clients", () => {
    const payments = rules.slice(
        rules.indexOf("match /containerLinePayments/"));
    assert.match(payments.slice(0, 220), /allow read: if lotLedgerRead\(/);
    assert.match(payments.slice(0, 220), /allow write: if false;/);
    for (const name of ["containers", "containerLines"]) {
      const block = rules.slice(rules.indexOf(`match /${name}/`));
      assert.ok(block.length > 0, `${name} rule missing`);
      assert.match(block.slice(0, 220), /allow write: if false;/);
    }
    const locks = rules.slice(rules.indexOf("match /containerVinLocks/"));
    assert.match(locks.slice(0, 120), /allow read, write: if false;/);
  });
});

// Real container TCKU6418832: a leasing prefix, so the carrier feed could
// not guess the line, the box was stamped "carrier_unknown", and nothing
// could ever start tracking it again.
describe("the shipping line and when tracking is tried again", () => {
  const box = (extra = {}) => ({
    containerNumber: "TCKU6418832", status: "loading", ...extra});

  it("takes a catalog line, or none, and refuses anything else", () => {
    assert.equal(containerCarrierScac(" mscu "), "MSCU");
    assert.equal(containerCarrierScac(null), "");
    assert.equal(carrierScacRefusal("MSCU"), null);
    assert.equal(carrierScacRefusal("mscu"), null);
    assert.equal(carrierScacRefusal(""), null);
    assert.equal(carrierScacRefusal(undefined), null);
    assert.equal(carrierScacRefusal("XXXX"), "carrier_invalid");
    assert.equal(carrierScacRefusal("TCKU"), "carrier_invalid");
    assert.deepEqual(
        validateContainer({label: "x", carrierScac: "MAEU"}), []);
    assert.deepEqual(validateContainer({label: "x", carrierScac: ""}), []);
    assert.deepEqual(validateContainer({label: "x"}), []);
    assert.deepEqual(validateContainer({label: "x", carrierScac: "NOPE"}),
        ["carrier_invalid"]);
    assert.ok(CONTAINER_MESSAGES.carrier_invalid);
  });

  it("tries a new number", () => {
    assert.equal(shouldStartCarrierTracking(box()), true);
    // A number that failed before, then changed.
    assert.equal(shouldStartCarrierTracking(box({
      carrierTrackingFailedFor: "MSKU1234565",
      carrierTrackingError: "carrier_unknown",
    })), true);
  });

  it("does not try the same number with the same line twice", () => {
    // Failures written before the line was recorded read as "guessed".
    assert.equal(shouldStartCarrierTracking(box({
      carrierTrackingFailedFor: "TCKU6418832",
      carrierTrackingError: "carrier_unknown",
    })), false);
    assert.equal(shouldStartCarrierTracking(box({
      carrierScac: "MSCU",
      carrierTrackingFailedFor: "TCKU6418832",
      carrierTrackingFailedScac: "mscu",
    })), false);
    // What a failure writes is itself a skip: the trigger cannot loop on
    // its own write, whether the line was chosen or guessed.
    for (const chosen of ["", "MSCU"]) {
      const after = box({carrierScac: chosen});
      const failed = {...after,
        ...carrierTrackingFailure(after, "carrier_unknown")};
      assert.equal(shouldStartCarrierTracking(failed), false);
    }
  });

  it("tries again once a line is chosen or changed after a failure", () => {
    assert.equal(shouldStartCarrierTracking(box({
      carrierScac: "MSCU",
      carrierTrackingFailedFor: "TCKU6418832",
      carrierTrackingError: "carrier_unknown",
    })), true);
    assert.equal(shouldStartCarrierTracking(box({
      carrierScac: "CMDU",
      carrierTrackingFailedFor: "TCKU6418832",
      carrierTrackingFailedScac: "MSCU",
    })), true);
    // Clearing the line goes back to guessing: a new try too.
    assert.equal(shouldStartCarrierTracking(box({
      carrierScac: "",
      carrierTrackingFailedFor: "TCKU6418832",
      carrierTrackingFailedScac: "MSCU",
    })), true);
  });

  it("leaves a followed, arrived or unnumbered box alone", () => {
    assert.equal(shouldStartCarrierTracking(box({
      trackingProvider: "carrier_api",
      trackedContainerNumber: "TCKU6418832",
      carrierScac: "CMDU",
    })), false);
    assert.equal(shouldStartCarrierTracking(box({status: "arrived"})), false);
    assert.equal(shouldStartCarrierTracking(box({status: "shipped"})), true);
    for (const containerNumber of ["", "TCKU641883", "tcku6418832",
      "BOOKING-77"]) {
      assert.equal(shouldStartCarrierTracking(box({containerNumber})), false);
    }
    assert.equal(shouldStartCarrierTracking(null), false);
  });

  it("records the number, the line tried and why", () => {
    assert.deepEqual(
        carrierTrackingFailure(box({carrierScac: "mscu"}), "Not found"),
        {carrierTrackingFailedFor: "TCKU6418832",
          carrierTrackingFailedScac: "MSCU",
          carrierTrackingError: "Not found"});
    assert.equal(carrierTrackingFailure(box(), "").carrierTrackingError,
        "tracking_request_failed");
    assert.equal(
        carrierTrackingFailure(box(), "x".repeat(400))
            .carrierTrackingError.length, 300);
  });

  const {readFileSync} = require("node:fs");
  const path = require("node:path");
  const source = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const section = (start) => {
    const at = source.indexOf(start);
    assert.ok(at > -1, `${start} not found`);
    const next = source.indexOf("\nexports.", at + 1);
    return source.slice(at, next === -1 ? undefined : next);
  };

  it("the trigger decides with the rule and records failures with it", () => {
    const body = section("exports.startContainerCarrierTracking =");
    assert.match(body, /if \(!shouldStartCarrierTracking\(after\)\) return;/);
    assert.doesNotMatch(body,
        /if \(after\.carrierTrackingFailedFor === number\) return;/);
    assert.equal(
        (body.match(/carrierTrackingFailure\(after,/g) || []).length, 2);
    assert.doesNotMatch(body, /carrierTrackingFailedFor: number/);
  });

  it("create stores the chosen line; update checks a change and audits it",
      () => {
        const create = section("exports.createContainer =");
        assert.match(create, /validateContainer\(data\)/);
        assert.match(create,
            /carrierScac: containerCarrierScac\(data\.carrierScac\)/);
        const update = section("exports.updateContainer =");
        assert.match(update, new RegExp(
            "if \\(carrierChanged && carrierScacRefusal\\(carrierAfter\\)\\)" +
            " \\{\\s*errors\\.push\\(\"carrier_invalid\"\\);"));
        assert.match(update,
            /\.\.\.\(carrierChanged \? \{carrierScac: carrierAfter\} : \{\}\)/);
        assert.match(update,
            /\.\.\.\(carrierChanged \? \["carrierScac"\] : \[\]\)/);
        // Not part of the declared list: still choosable after sailing.
        const structural = update.slice(update.indexOf("const structural"),
            update.indexOf("const changed"));
        assert.doesNotMatch(structural, /carrierScac/);
      });
});

// Proof on the package (docs/AIR_PACKAGES.md §2, §4.2): the four fields a
// line stores through package_proof.validateProofFields, edited and
// audited like the price.
describe("package proof fields", () => {
  const {
    containerLineEditRefusal,
    containerLineEditTarget,
    containerLineEditChanges,
    containerLineEditAudit,
    containerLineEditLabels,
    validateContainerLineEdit,
  } = require("../container_manifest");
  const PHOTO = "packagePhotos/biz/staff1/abcd1234efgh.jpg";
  const proof = {
    photoPaths: [PHOTO],
    contents: [{label: "Phones", quantity: 2, serial: "IMEI 1"},
      {label: "Tablet"}],
    weightLb: "4.26",
    declaredValueCents: 125000,
  };
  const dropped = (extra = {}) => ({kind: "barrels", quantity: 3,
    ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", destinationCountryId: "gn",
    destinationCountryName: "Guinea", ...extra});

  it("accepts and stores photos, contents, weight and declared value",
      () => {
        assert.deepEqual(validateContainerLine(dropped(proof)), []);
        assert.deepEqual(validateWaitingPackage(dropped(proof)), []);
        const line = containerLineRecord(dropped(proof));
        assert.deepEqual(line.photoPaths, [PHOTO]);
        assert.deepEqual(line.contents, [
          {label: "Phones", quantity: 2, serial: "IMEI 1"},
          {label: "Tablet", quantity: 1, serial: ""}]);
        assert.equal(line.weightLb, 4.3);
        assert.equal(line.declaredValueCents, 125000);
        // Nothing given: the empties, on every line.
        const bare = containerLineRecord(dropped());
        assert.deepEqual(bare.photoPaths, []);
        assert.deepEqual(bare.contents, []);
        assert.equal(bare.weightLb, null);
        assert.equal(bare.declaredValueCents, null);
      });

  it("refuses each field with its own code", () => {
    assert.deepEqual(validateContainerLine(dropped({photoPaths:
      ["packageRequestPhotos/biz/staff1/abcd1234efgh.jpg"]})),
    ["photo_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({photoPaths: "x"})),
        ["photo_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({contents:
      [{label: "x".repeat(61)}]})), ["contents_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({contents:
      [{label: "Phones", quantity: 100}]})), ["contents_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({weightLb: 0})),
        ["weight_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({weightLb: "heavy"})),
        ["weight_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({declaredValueCents:
      -1})), ["declared_value_invalid"]);
    assert.deepEqual(validateContainerLine(dropped({declaredValueCents:
      12.5})), ["declared_value_invalid"]);
    // The first problem is named; the rest of the line is still checked.
    assert.deepEqual(validateContainerLine(dropped({quantity: 0,
      weightLb: 0})), ["quantity_required", "weight_invalid"]);
  });

  it("edits all four, in every state, and names them in History", () => {
    const current = {businessId: "biz", ...containerLineRecord(
        dropped(proof), {containerId: "box1", containerStatus: "shipped"})};
    const asked = {...dropped(proof), photoPaths: [],
      contents: [{label: "Phones", quantity: 3}], weightLb: 5,
      declaredValueCents: 0};
    assert.deepEqual(validateContainerLineEdit(current, asked, false), []);
    const next = containerLineEditTarget(current, asked, false);
    const changes = containerLineEditChanges(current, next);
    assert.deepEqual(changes, [...LINE_PROOF_FIELDS]);
    for (const status of ["loading", "shipped", "arrived"]) {
      assert.equal(containerLineEditRefusal({status}, changes), null,
          status);
    }
    assert.deepEqual(containerLineEditLabels(changes),
        ["photos", "contents", "weight", "declared value"]);
    assert.deepEqual(containerLineEditAudit(current, next, changes), {
      action: "line_edited",
      summary: "Edited 3 barrels: photos, contents, weight, declared " +
        "value for Fatou Diallo",
    });
    // An edit that leaves them out keeps them; the same values change
    // nothing.
    const kept = containerLineEditTarget(current, dropped(), false);
    assert.deepEqual(containerLineEditChanges(current, kept), []);
    assert.deepEqual(containerLineEditChanges(current,
        containerLineEditTarget(current, dropped(proof), false)), []);
    // A bad value on an edit is refused as on a new line.
    assert.deepEqual(validateContainerLineEdit(current,
        {...dropped(), weightLb: 9999}, false), ["weight_invalid"]);
    // A contacts-only edit never touches them.
    const contacts = containerLineEditTarget(current,
        {receiverName: "Aissatou Bah", photoPaths: []}, true);
    assert.deepEqual(contacts.photoPaths, [PHOTO]);
  });

  it("names the loading warning", () => {
    assert.match(CONTAINER_MESSAGES.sender_problem, /reported a problem/);
  });
});
