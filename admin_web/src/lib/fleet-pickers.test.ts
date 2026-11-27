import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  composeChargeLabel,
  composeVehicleType,
  knownValues,
  matchKnown,
  MONTH_DAYS,
  optionsWith,
  splitChargeLabel,
  splitVehicleType,
  stateCode,
  WEEKDAYS,
  type CarCatalogLookup,
} from "./fleet-pickers.ts";

const catalog: CarCatalogLookup = {
  makes: () => ["Land Rover", "Toyota", "Honda"],
  models: (make) => (make === "Toyota" ? ["Camry", "RAV4", "Prius"] : make === "Land Rover" ? ["Defender"] : ["Accord"]),
  years: (make, model) => (make === "Toyota" && model === "Camry" ? ["2020", "2021", "2022"] : ["2021"]),
};

describe("Fleet pickers", () => {
  it("lists the values a business already uses, folding case and spaces", () => {
    const rows = [{ company: "Landa LLC" }, { company: "landa  llc" }, { company: "" }, { company: "Dala Cars" }, {}];
    assert.deepEqual(knownValues(rows, "company"), ["Dala Cars", "Landa LLC"]);
    assert.deepEqual(optionsWith(["Dala Cars"], "New Co"), ["New Co", "Dala Cars"]);
    assert.deepEqual(optionsWith(["Dala Cars"], "dala cars"), ["Dala Cars"]);
    assert.equal(matchKnown(["Dala Cars"], " dala  cars "), "Dala Cars");
    assert.equal(matchKnown(["Dala Cars"], "Kara Inc"), "Kara Inc");
  });

  it("offers days 1 to 28 and the seven weekdays", () => {
    assert.equal(MONTH_DAYS.length, 28);
    assert.equal(MONTH_DAYS[27], 28);
    assert.deepEqual(WEEKDAYS.map((w) => w.day), [1, 2, 3, 4, 5, 6, 7]);
  });

  it("splits and composes a charge label", () => {
    assert.deepEqual(splitChargeLabel("Ticket · T712000C · Oct 3"), { reason: "Ticket", details: "T712000C · Oct 3" });
    assert.deepEqual(splitChargeLabel("toll"), { reason: "Toll", details: "" });
    assert.deepEqual(splitChargeLabel("Broken mirror"), { reason: "", details: "Broken mirror" });
    assert.equal(composeChargeLabel("Ticket", " T712000C · Oct 3 "), "Ticket · T712000C · Oct 3");
    assert.equal(composeChargeLabel("Toll", ""), "Toll");
    assert.equal(composeChargeLabel("", "Broken mirror"), "Broken mirror");
  });

  it("turns any way of writing a US state into its code", () => {
    assert.equal(stateCode("ny"), "NY");
    assert.equal(stateCode("New York"), "NY");
    assert.equal(stateCode(" NJ "), "NJ");
    assert.equal(stateCode("Ontario"), "Ontario");
    assert.equal(stateCode(""), "");
  });

  it("reads a saved car line back into make, model and year", () => {
    assert.deepEqual(splitVehicleType("Toyota Camry 2021", catalog), { make: "Toyota", model: "Camry", year: "2021" });
    assert.deepEqual(splitVehicleType("2021 toyota camry", catalog), { make: "Toyota", model: "Camry", year: "2021" });
    assert.deepEqual(splitVehicleType("Toyota rav4", catalog), { make: "Toyota", model: "RAV4", year: "" });
    assert.deepEqual(splitVehicleType("Land Rover Defender 2021", catalog), { make: "Land Rover", model: "Defender", year: "2021" });
    assert.deepEqual(splitVehicleType("", catalog), { make: "", model: "", year: "" });
    assert.equal(splitVehicleType("Tesla Model 3", catalog), null);
    assert.equal(splitVehicleType("Toyota Hilux", catalog), null);
    assert.equal(splitVehicleType("Toyota Camry 1999", catalog), null);
    assert.equal(composeVehicleType({ make: "Toyota", model: "Camry", year: "2021" }), "Toyota Camry 2021");
    assert.equal(composeVehicleType({ make: "Toyota", model: "", year: "" }), "Toyota");
  });
});
