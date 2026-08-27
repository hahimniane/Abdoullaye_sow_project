const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  STANDARD_FREIGHT_CATEGORIES,
  STANDARD_CATEGORY_IDS,
  MAX_MULTIPLIER,
  MAX_CUSTOM_CATEGORIES,
  normalizeMultiplier,
  freightCategoriesForBusiness,
  freightCategoryMultiplier,
  validateFreightCategorySettings,
} = require("../freight_categories");

describe("the standard list", () => {
  it("is the same everywhere so a customer can compare businesses", () => {
    // The whole reason the platform owns the list: a customer holding a phone
    // must find the same row at every business, or quotes cannot be compared.
    const idsA = freightCategoriesForBusiness({})
        .filter((category) => !category.custom)
        .map((category) => category.id);
    const idsB = freightCategoriesForBusiness({
      freightCategoryRates: {electronics: 3},
      freightCustomCategories: [{id: "carparts", label: "Car parts"}],
    })
        .filter((category) => !category.custom)
        .map((category) => category.id);
    assert.deepEqual(idsA, idsB);
    assert.deepEqual(idsA, STANDARD_CATEGORY_IDS);
  });

  it("leads with general goods, the honest answer for most parcels", () => {
    assert.equal(STANDARD_FREIGHT_CATEGORIES[0].id, "general");
    assert.equal(STANDARD_FREIGHT_CATEGORIES[0].defaultMultiplier, 1);
  });
});

describe("what a business charges", () => {
  it("charges nothing extra for a row the business never touched", () => {
    // The platform used to ship Electronics at 2x, so every business
    // charged double for a number it had never chosen and could not see.
    // A price a business did not set is not a price.
    for (const id of ["electronics", "fragile", "cosmetics", "clothing"]) {
      assert.equal(freightCategoryMultiplier({}, id), 1, id);
    }
  });

  it("uses the business's own rate when it has one", () => {
    // A rate a business chose is still honoured; only the default it never
    // chose is gone.
    const business = {freightCategoryRates: {electronics: 1.5}};
    assert.equal(freightCategoryMultiplier(business, "electronics"), 1.5);
    assert.equal(freightCategoryMultiplier(business, "fragile"), 1);
  });

  it("prices a no-category parcel exactly as before categories existed", () => {
    // An older app sends no category. It must still get a correct quote, not
    // an error and not a surcharge.
    assert.equal(freightCategoryMultiplier({}, ""), 1);
    assert.equal(freightCategoryMultiplier({}, undefined), 1);
    assert.equal(freightCategoryMultiplier({}, "made_up_thing"), 1);
  });

  it("survives a nonsense value in one business's settings", () => {
    // A bad number in settings must not stop a customer getting a quote.
    const business = {freightCategoryRates: {electronics: "abc"}};
    assert.equal(freightCategoryMultiplier(business, "electronics"), 1);
  });

  it("clamps a multiplier that would make a parcel absurd", () => {
    assert.equal(normalizeMultiplier(9999), MAX_MULTIPLIER);
    assert.equal(normalizeMultiplier(0.001), 0.5);
    assert.equal(normalizeMultiplier(-4), 1);
  });
});

describe("a business's own categories", () => {
  it("appear after the standard rows", () => {
    const categories = freightCategoriesForBusiness({
      freightCustomCategories: [
        {id: "carparts", label: "Car parts", multiplier: 1.4},
      ],
    });
    assert.equal(categories.length, STANDARD_CATEGORY_IDS.length + 1);
    assert.equal(categories.at(-1).id, "carparts");
    assert.equal(categories.at(-1).multiplier, 1.4);
    assert.equal(categories.at(-1).custom, true);
  });

  it("cannot shadow a standard row", () => {
    // Otherwise a business could redefine "Electronics" to mean something
    // else, and the shared vocabulary stops being shared.
    const categories = freightCategoriesForBusiness({
      freightCustomCategories: [
        {id: "electronics", label: "My electronics", multiplier: 9},
      ],
    });
    assert.equal(categories.filter((c) => c.id === "electronics").length, 1);
    assert.equal(freightCategoryMultiplier({
      freightCustomCategories: [
        {id: "electronics", label: "My electronics", multiplier: 9},
      ],
      // The standard row wins, and it is neutral: a business cannot smuggle
      // a 9x surcharge in by redefining a row everyone else shares.
    }, "electronics"), 1);
  });

  it("is capped so the customer is not drowned in choices", () => {
    const many = Array.from({length: 20}, (_, index) => ({
      id: `extra${index}`,
      label: `Extra ${index}`,
    }));
    const categories = freightCategoriesForBusiness({
      freightCustomCategories: many,
    });
    assert.equal(
        categories.filter((category) => category.custom).length,
        MAX_CUSTOM_CATEGORIES,
    );
  });

  it("drops entries that cannot be shown to anyone", () => {
    const categories = freightCategoriesForBusiness({
      freightCustomCategories: [
        {id: "", label: "No id"},
        {id: "nolabel", label: ""},
        {id: "ok", label: "Fine"},
      ],
    });
    const custom = categories.filter((category) => category.custom);
    assert.deepEqual(custom.map((category) => category.id), ["ok"]);
  });
});

describe("saving settings", () => {
  it("accepts sensible rates", () => {
    const result = validateFreightCategorySettings({
      rates: {electronics: 2.5, clothing: 1},
      custom: [{id: "carparts", label: "Car parts", multiplier: 1.4}],
    });
    assert.equal(result.ok, true);
    assert.equal(result.custom[0].id, "carparts");
  });

  it("refuses a rate for a category that does not exist", () => {
    assert.equal(
        validateFreightCategorySettings({rates: {nonsense: 2}}).error,
        "unknown_category",
    );
  });

  it("refuses a multiplier outside the band", () => {
    assert.equal(
        validateFreightCategorySettings({rates: {electronics: 50}}).error,
        "multiplier_out_of_range",
    );
    assert.equal(
        validateFreightCategorySettings({rates: {electronics: 0}}).error,
        "multiplier_out_of_range",
    );
  });

  it("refuses duplicates and overlong lists", () => {
    assert.equal(
        validateFreightCategorySettings({
          custom: [
            {id: "a", label: "A"},
            {id: "a", label: "A again"},
          ],
        }).error,
        "duplicate_category",
    );
    assert.equal(
        validateFreightCategorySettings({
          custom: Array.from({length: MAX_CUSTOM_CATEGORIES + 1}, (_, i) => ({
            id: `x${i}`,
            label: `X${i}`,
          })),
        }).error,
        "too_many_categories",
    );
  });
});
