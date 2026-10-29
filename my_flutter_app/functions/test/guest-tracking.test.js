"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GUEST_TRACKING_COLLECTIONS,
  CONTAINER_STAGE_BY_STATUS,
  CONTAINER_SHIPPING_STAGES,
  publicContainerShipping,
  shippedContainerOf,
  WAITING_STAGE,
  WAITING_STAGE_LABEL,
  guestTrackingCandidates,
  publicGuestTrackingRecord,
} = require("../guest_tracking");
const {lineGroupSummary} = require("../line_pieces");

test(
    "guest tracking searches every customer tracking collection",
    () => {
      assert.deepEqual(
          GUEST_TRACKING_COLLECTIONS.map((item) => item.name),
          [
            "barrelShipments",
            "freightShipments",
            "transportRequests",
            "parkedCars",
            "barrelPools",
            "freightQuoteRequests",
            "containerLines",
          ],
      );
    });

test(
    "guest tracking accepts short codes typed with human formatting",
    () => {
      const candidates = guestTrackingCandidates("  bs k7m4p2  ");
      assert.ok(candidates.includes("BS-K7M4P2"));
      assert.ok(candidates.includes("BSK7M4P2"));
    });

test("guest tracking reconstructs the old printed server code", () => {
  const candidates = guestTrackingCandidates("bsms9ttes1omvytl");
  assert.ok(candidates.includes("BS-MS9TTES1-OMVYTL"));
});

test("guest tracking rejects empty, short, or unbounded references", () => {
  assert.deepEqual(guestTrackingCandidates(""), []);
  assert.deepEqual(guestTrackingCandidates("123"), []);
  assert.deepEqual(guestTrackingCandidates("x".repeat(90)), []);
});

test("public barrel result is a strict PII-free projection", () => {
  const result = publicGuestTrackingRecord({
    id: "private-document-id",
    service: "barrel",
    data: {
      trackingCode: "BS-K7M4P2",
      status: "ready_for_pickup",
      updatedAt: {toMillis: () => 1725000000000},
      receiverName: "Private Receiver",
      senderName: "Private Sender",
      customerEmail: "private@example.com",
      receiverPhone: "+12015550123",
      pickupAddress: "Private address",
      price: 200,
      paymentStatus: "succeeded",
      containerNumber: "MSCU1234567",
      businessName: "Private provider relationship",
    },
  });

  assert.deepEqual(result, {
    trackingCode: "BS-K7M4P2",
    service: "barrel",
    stage: "arrived",
    // docs/PHONE_ACCOUNTS.md §10: the last two digits of each number, for
    // "Sign in as the number ending in ••23" - never the number.
    signIn: [{role: "receiver", lastTwo: "23"}],
    updatedAtMs: 1725000000000,
  });
  assert.doesNotMatch(JSON.stringify(result), /2015550123|5550123/);
  for (const privateField of [
    "id",
    "receiverName",
    "senderName",
    "customerEmail",
    "receiverPhone",
    "pickupAddress",
    "price",
    "paymentStatus",
    "containerNumber",
    "businessName",
  ]) {
    assert.equal(Object.hasOwn(result, privateField), false, privateField);
  }
});

test(
    "transport uses fulfillment status and exposes only a public stage",
    () => {
      const result = publicGuestTrackingRecord({
        id: "transport-1",
        service: "transport",
        data: {
          trackingCode: "TR-Q7M4P2",
          status: "pending",
          fulfillmentStatus: "delivered",
          createdAt: {seconds: 1700000000},
          ownerName: "Private owner",
          vinNumber: "PRIVATEVIN123456",
        },
      });
      assert.equal(result.stage, "delivered");
      assert.equal(result.updatedAtMs, 1700000000000);
      assert.equal(Object.hasOwn(result, "ownerName"), false);
      assert.equal(Object.hasOwn(result, "vinNumber"), false);
    });

test("cancelled records never look like a stalled active journey", () => {
  const result = publicGuestTrackingRecord({
    id: "freight-1",
    service: "freight",
    data: {trackingCode: "FR-Q7M4P2", status: "cancelled"},
  });
  assert.equal(result.stage, "cancelled");
});

test("a container line follows its box, and shows nothing personal", () => {
  const record = (containerStatus) => publicGuestTrackingRecord({
    id: "line1",
    service: "container",
    data: {
      trackingCode: "CL-K7M4P2", containerStatus,
      customerName: "Fatou Diallo", customerPhone: "+16465550100",
      receiverPhone: "+224620000000",
    },
  });
  assert.equal(record("loading").stage, "booked");
  assert.equal(record("shipped").stage, "in_transit");
  assert.equal(record("arrived").stage, "arrived");
  // Its pieces, its parts and what is owed (docs/PACKAGE_REQUESTS.md §2:
  // the page shows the final price, paid and balance) - no people.
  assert.deepEqual(Object.keys(record("shipped")).sort(),
      ["parts", "payment", "pieceCount", "service", "signIn", "stage",
        "trackingCode", "updatedAtMs"]);
  // Only the last two digits of each number (docs/PHONE_ACCOUNTS.md §10).
  assert.deepEqual(record("shipped").signIn, [
    {role: "sender", lastTwo: "00"}, {role: "receiver", lastTwo: "00"}]);
  const text = JSON.stringify(record("shipped"));
  for (const secret of ["Fatou", "+1646", "+224", "line1"]) {
    assert.ok(!text.includes(secret), `leaks ${secret}`);
  }
});

test("a container line shows every part of its group and the group's money",
    () => {
      const line = {trackingCode: "CL-K7M4P2-2", containerStatus: "waiting",
        rootLineId: "root", partIndex: 2, priceCents: 10000,
        pieces: [{kind: "barrel", priceCents: 10000}],
        customerName: "Fatou Diallo"};
      const group = lineGroupSummary([
        {id: "root", line: {rootLineId: "root", trackingCode: "CL-K7M4P2",
          containerStatus: "shipped", containerId: "box1", priceCents: 20000,
          paidCents: 25000, pieces: [{kind: "barrel"}, {kind: "barrel"}]}},
        {id: "part", line},
      ], "root");
      const result = publicGuestTrackingRecord({id: "part",
        service: "container", data: line, group});
      assert.equal(result.stage, "waiting_container");
      assert.equal(result.pieceCount, 1);
      assert.deepEqual(result.parts, [
        {trackingCode: "CL-K7M4P2", stage: "in_transit", pieceCount: 2,
          priceCents: 20000},
        {trackingCode: "CL-K7M4P2-2", stage: "waiting_container",
          pieceCount: 1, priceCents: 10000},
      ]);
      assert.deepEqual(result.payment, {priceCents: 30000,
        pickupFeeCents: 0, paidCents: 25000, balanceCents: 5000});
      assert.ok(!JSON.stringify(result).includes("box1"));
      // A legacy line alone: its own pieces, price and paid.
      const legacy = publicGuestTrackingRecord({id: "old",
        service: "container", data: {trackingCode: "CL-B2C3D4",
          containerStatus: "loading", kind: "barrels", quantity: 3,
          priceCents: 9000, paidCents: 3000}});
      assert.equal(legacy.pieceCount, 3);
      assert.deepEqual(legacy.parts, [{trackingCode: "CL-B2C3D4",
        stage: "booked", pieceCount: 3, priceCents: 9000}]);
      assert.deepEqual(legacy.payment, {priceCents: 9000,
        pickupFeeCents: 0, paidCents: 3000, balanceCents: 6000});
    });

test("a collected package's pickup fee is told apart, once, on the page",
    () => {
      // Barrel $90 on the root with the $20 fee; the box $40 split off.
      const root = {rootLineId: "root", trackingCode: "CL-K7M4P2",
        containerStatus: "loading", containerId: "box1", priceCents: 11000,
        pickupFeeCents: 2000, paidCents: 5000,
        pieces: [{kind: "barrel", priceCents: 9000}]};
      const part = {rootLineId: "root", partIndex: 2,
        trackingCode: "CL-K7M4P2-2", containerStatus: "waiting",
        priceCents: 4000, pickupFeeCents: 0,
        pieces: [{kind: "box", description: "Clothes", priceCents: 4000}]};
      const group = lineGroupSummary([{id: "root", line: root},
        {id: "part", line: part}], "root");
      for (const [id, data] of [["root", root], ["part", part]]) {
        const result = publicGuestTrackingRecord({id, service: "container",
          data, group});
        assert.deepEqual(result.payment, {priceCents: 15000,
          pickupFeeCents: 2000, paidCents: 5000, balanceCents: 10000});
      }
    });

test("a part code is found typed without its dashes", () => {
  assert.ok(guestTrackingCandidates("clk7m4p22").includes("CL-K7M4P2-2"));
  assert.ok(guestTrackingCandidates("CL-K7M4P2-12")
      .includes("CL-K7M4P2-12"));
});

test("a package waiting for a container has a public stage of its own", () => {
  const result = publicGuestTrackingRecord({
    id: "line2",
    service: "container",
    data: {
      trackingCode: "CL-W4X5Y6", containerStatus: "waiting", containerId: "",
      customerName: "Fatou Diallo", customerPhone: "+16465550100",
      destinationCountryName: "Guinea", priceCents: 15000,
    },
  });
  // Not "booked": nothing is on a box yet. Still nothing personal.
  assert.equal(result.stage, WAITING_STAGE);
  assert.equal(result.stage, "waiting_container");
  assert.equal(WAITING_STAGE_LABEL, "Received, waiting for a container");
  assert.deepEqual(Object.keys(result).sort(),
      ["parts", "payment", "pieceCount", "service", "signIn", "stage",
        "trackingCode", "updatedAtMs"]);
  assert.deepEqual(result.signIn, [{role: "sender", lastTwo: "00"}]);
  assert.ok(!JSON.stringify(result).includes("Fatou"));
  assert.ok(!JSON.stringify(result).includes("5550100"));
  assert.equal(CONTAINER_STAGE_BY_STATUS.waiting, WAITING_STAGE);
});

// The WhatsApp "departed" message sends people to this page for the ship's
// details instead of carrying them; the page shows them only once the box
// has sailed, and nothing of the container beyond them.
test("a sailed container line shows its shipping details, nothing more",
    () => {
      const box = {
        businessId: "biz", carrierScac: "maeu",
        containerNumber: "MSKU1234565", bookingReference: "bk-998877",
        label: "Private working name", notes: "Private notes",
        destinationCountryName: "Guinea", priceCents: 999,
        documentToken: "secret-token", ownerName: "Private Owner",
      };
      const line = (containerStatus) => ({
        trackingCode: "CL-K7M4P2", containerStatus, containerId: "box1",
        businessId: "biz", customerName: "Fatou Diallo",
        customerPhone: "+16465550100", receiverPhone: "+224620000000",
        priceCents: 15000,
      });
      const record = (status, container = box) => publicGuestTrackingRecord({
        id: "line1", service: "container", data: line(status), container,
      });
      for (const status of ["shipped", "arrived"]) {
        const result = record(status);
        assert.deepEqual(result.shipping, {
          shippingLine: "Maersk", containerNumber: "MSKU1234565",
          bookingNumber: "BK-998877",
        }, status);
        assert.deepEqual(Object.keys(result).sort(),
            ["parts", "payment", "pieceCount", "service", "shipping",
              "signIn", "stage", "trackingCode", "updatedAtMs"]);
        // The line's own price is the page's to show; the box's is not.
        assert.equal(result.payment.priceCents, 15000);
        const text = JSON.stringify(result);
        for (const secret of ["Private", "secret-token", "Fatou",
          "+1646", "+224", "999", "Guinea", "biz", "box1"]) {
          assert.ok(!text.includes(secret), `${status} leaks ${secret}`);
        }
      }
      // Before it sails: nothing, even with the box at hand.
      for (const status of ["waiting", "loading"]) {
        assert.equal(record(status).shipping, undefined, status);
      }
    });

test("shipping details name only what is known", () => {
  assert.deepEqual(publicContainerShipping("in_transit",
      {containerNumber: "MSKU1234565"}), {containerNumber: "MSKU1234565"});
  assert.deepEqual(publicContainerShipping("in_transit",
      {bookingReference: "BK1"}), {bookingNumber: "BK1"});
  // A carrier the catalog does not know is named by its code.
  assert.deepEqual(publicContainerShipping("arrived",
      {carrierScac: "XYZQ"}), {shippingLine: "XYZQ"});
  assert.equal(publicContainerShipping("in_transit", {}), null);
  assert.equal(publicContainerShipping("in_transit", null), null);
  assert.equal(publicContainerShipping("booked",
      {containerNumber: "MSKU1234565"}), null);
  assert.deepEqual(CONTAINER_SHIPPING_STAGES, ["in_transit", "arrived"]);
  // Other services never carry it.
  assert.equal(publicGuestTrackingRecord({id: "b", service: "barrel",
    data: {status: "in_transit"}, container: {containerNumber: "X"}})
      .shipping, undefined);
});

test("the container is read only once sailed, and only the same business's",
    async () => {
      const reads = [];
      const db = (container) => ({
        collection: (name) => ({doc: (id) => ({get: async () => {
          reads.push(`${name}/${id}`);
          return {exists: Boolean(container), data: () => container};
        }})}),
      });
      const line = (extra) => ({containerId: "box1", businessId: "biz",
        containerStatus: "shipped", ...extra});
      assert.equal(await shippedContainerOf(db({businessId: "biz"}),
          line({containerStatus: "loading"})), null);
      assert.equal(await shippedContainerOf(db({businessId: "biz"}),
          line({containerId: ""})), null);
      assert.deepEqual(reads, []);
      assert.equal(await shippedContainerOf(db({businessId: "other"}),
          line()), null);
      assert.deepEqual(await shippedContainerOf(db({businessId: "biz",
        containerNumber: "MSKU1234565"}), line()),
      {businessId: "biz", containerNumber: "MSKU1234565"});
      assert.deepEqual(reads, ["containers/box1", "containers/box1"]);
    });

test("a flight shows its airline and waybill instead of the ocean fields",
    () => {
      const flight = {shipMode: "air", airline: "Air France",
        airWaybill: "176-12345678", carrierScac: "maeu",
        containerNumber: "MSKU1234565", bookingReference: "bk-1"};
      assert.deepEqual(publicContainerShipping("in_transit", flight),
          {mode: "air", airline: "Air France", airWaybill: "176-12345678"});
      assert.deepEqual(publicContainerShipping("arrived",
          {shipMode: "air", airWaybill: "176-12345678"}),
      {mode: "air", airWaybill: "176-12345678"});
      // Even a flight with nothing else known says it flies.
      assert.deepEqual(publicContainerShipping("in_transit",
          {shipMode: "air"}), {mode: "air"});
      // Not before it leaves.
      assert.equal(publicContainerShipping("booked", flight), null);
      // A box's shape is what it always was: no mode key.
      assert.deepEqual(publicContainerShipping("in_transit",
          {shipMode: "sea", containerNumber: "MSKU1234565"}),
      {containerNumber: "MSKU1234565"});
      const record = publicGuestTrackingRecord({id: "l", service: "container",
        data: {trackingCode: "CL-K7M4P2", containerStatus: "shipped",
          containerId: "f1", businessId: "biz"}, container: flight});
      assert.deepEqual(record.shipping,
          {mode: "air", airline: "Air France", airWaybill: "176-12345678"});
      assert.ok(!JSON.stringify(record).includes("MSKU"));
    });

test("photos go only to the line's own sender or receiver", () => {
  const {lineBelongsToPhone} = require("../guest_tracking");
  const line = {customerPhone: "646 555 0100", receiverPhone: "+224620000000"};
  assert.equal(lineBelongsToPhone(line, "+16465550100"), true);
  assert.equal(lineBelongsToPhone(line, "+224620000000"), true);
  assert.equal(lineBelongsToPhone(line, "+16465550101"), false);
  assert.equal(lineBelongsToPhone(line, ""), false);
  assert.equal(lineBelongsToPhone(line, "6465550100"), false);
  assert.equal(lineBelongsToPhone(null, "+16465550100"), false);
  // A number staff changed leaves the old account at once.
  assert.equal(lineBelongsToPhone({customerPhone: "+16465550199",
    customerPhoneE164: "+16465550100"}, "+16465550100"), false);
});

test("the photo list names each photo by kind, our paths only, once", () => {
  const {linePhotoEntries} = require("../guest_tracking");
  const p = (f) => `packagePhotos/biz/staffUid1/${f}.jpg`;
  assert.deepEqual(linePhotoEntries({
    photoPaths: [p("dropoff01"), "not/a/photo.jpg", p("dropoff01")],
    customerPhotos: [{path: "packagePhotos/biz/wa/abcdef1234567890.jpg"},
      {path: ""}, null],
    deliveredPhotoPath: p("delivered1"),
  }), [
    {path: p("dropoff01"), kind: "dropoff"},
    {path: "packagePhotos/biz/wa/abcdef1234567890.jpg", kind: "customer"},
    {path: p("delivered1"), kind: "delivered"},
  ]);
  assert.deepEqual(linePhotoEntries({}), []);
  assert.deepEqual(linePhotoEntries(null), []);
  // The public record itself never carries them: the callable adds the
  // links after checking who is asking.
  const record = publicGuestTrackingRecord({id: "l", service: "container",
    data: {trackingCode: "CL-K7M4P2", containerStatus: "waiting",
      photoPaths: [p("dropoff01")]}});
  assert.equal(record.photos, undefined);
  assert.ok(!JSON.stringify(record).includes("packagePhotos"));
});
