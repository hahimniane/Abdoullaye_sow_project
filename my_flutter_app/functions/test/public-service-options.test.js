const assert = require("node:assert/strict");
const test = require("node:test");
const {
  publicOpenBarrelOption,
  publicParkingOption,
} = require("../public_service_options");

test(
    "public parking options omit private contact and exact coordinate data",
    () => {
      const option = publicParkingOption({
        businessId: "business-1",
        businessName: "Secure Parking",
        city: "Bronx",
        address: "Bronx, NY",
        availableSpaces: 3,
        dailyRate: 20,
        phone: "+12125550100",
        email: "private@example.com",
        latitude: 40.8,
        longitude: -73.9,
      });

      assert.equal(option.businessId, "business-1");
      assert.equal(option.availableSpaces, 3);
      assert.equal(Object.hasOwn(option, "phone"), false);
      assert.equal(Object.hasOwn(option, "email"), false);
      assert.equal(Object.hasOwn(option, "latitude"), false);
      assert.equal(Object.hasOwn(option, "longitude"), false);
      assert.equal(option.reviewCount, 0);
      assert.equal(option.reviewAverage, 0);
      assert.equal(option.reviewWeightedScore, 0);
    },
);

test("public parking options surface a business's review aggregate", () => {
  const option = publicParkingOption({
    businessId: "business-1",
    businessName: "Secure Parking",
    reviewCount: 42,
    reviewAverage: 4.3,
    reviewWeightedScore: 4.198,
  });

  assert.equal(option.reviewCount, 42);
  assert.equal(option.reviewAverage, 4.3);
  assert.equal(option.reviewWeightedScore, 4.198);
});

test(
    "public shared-barrel options expose only the actionable mirror fields",
    () => {
      const option = publicOpenBarrelOption("pool-1", {
        businessId: "business-1",
        destinationCountryName: "Guinea",
        sharesAvailable: 2,
        totalShares: 4,
        depositPerShare: 25,
        createdByUid: "private-owner",
        publicParticipants: {privateUid: {name: "Private"}},
      });

      assert.equal(option.id, "pool-1");
      assert.equal(option.sharesAvailable, 2);
      assert.equal(Object.hasOwn(option, "createdByUid"), false);
      assert.equal(Object.hasOwn(option, "publicParticipants"), false);
      assert.equal(option.reviewCount, 0);
    },
);
