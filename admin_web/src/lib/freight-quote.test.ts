// Asking a business what it charges for something it has not priced.
//
// The server is the authority - it re-validates the request and the quote,
// and it is what actually closes the losing quotes when a customer chooses.
// These tests exist because the client has to SAY the same thing: a customer
// shown a price with no payback beside it, or a business whose refusal reads
// as a code, has been let down by the interface rather than by the rules.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  FREIGHT_QUOTE_ERRORS,
  freightQuoteDocumentId,
  freightQuoteErrorMessage,
  freightQuotePaybackParts,
  validateFreightQuote,
  validateFreightQuoteRequest,
} from "./freight-quote.ts";

const customerSource = readFileSync(
  new URL("../components/customer-shipping-services.tsx", import.meta.url),
  "utf8",
);
const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);

test("the request carries exactly what a business needs to price it", () => {
  const result = validateFreightQuoteRequest({
    destinationCountryId: "gn",
    mode: "sea",
    description: "  Two car tyres, wrapped  ",
    weightKg: "18.4567",
    itemCategoryId: "general",
    itemLabel: "Something else",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok && result.request, {
    destinationCountryId: "gn",
    mode: "sea",
    description: "Two car tyres, wrapped",
    weightKg: 18.457,
    itemCategoryId: "general",
    itemLabel: "Something else",
  });
});

test("a weight is optional, because not knowing it is why they are here", () => {
  const blank = validateFreightQuoteRequest({description: "A sack of rice"});
  assert.equal(blank.ok && blank.request.weightKg, 0);
  // Air unless the customer said sea: the callable normalises the same way.
  assert.equal(blank.ok && blank.request.mode, "air");
  const nonsense = validateFreightQuoteRequest({
    description: "A sack of rice",
    weightKg: "heavy",
  });
  assert.equal(nonsense.ok && nonsense.request.weightKg, 0);
});

test("a request without a description is refused in the server's words", () => {
  const empty = validateFreightQuoteRequest({description: "   "});
  assert.equal(empty.ok, false);
  assert.equal(
    freightQuoteErrorMessage(!empty.ok && empty.error),
    "Describe what is being sent",
  );
  const long = validateFreightQuoteRequest({description: "x".repeat(2001)});
  assert.equal(
    freightQuoteErrorMessage(!long.ok && long.error),
    "Keep the description under 2000 characters",
  );
  // Anything the server invents later still reads as a sentence.
  assert.equal(
    freightQuoteErrorMessage("something_new"),
    "That request could not be read",
  );
});

test("a quote states a price and its own promise", () => {
  const quote = validateFreightQuote({
    amountCents: 24500,
    paybackAmountCents: 40000,
    terms: " Sails on the 14th ",
  });
  assert.deepEqual(quote.ok && quote.quote, {
    amountCents: 24500,
    paybackAmountCents: 40000,
    coversLoss: true,
    terms: "Sails on the 14th",
  });
  // Zero is an answer, not a blank: this business will not stand behind this
  // particular parcel, and the customer is told so before choosing.
  const bare = validateFreightQuote({amountCents: 1000});
  assert.equal(bare.ok && bare.quote.paybackAmountCents, 0);
  assert.equal(bare.ok && bare.quote.coversLoss, false);

  assert.equal(
    freightQuoteErrorMessage(
      !validateFreightQuote({amountCents: 0}).ok &&
        (validateFreightQuote({amountCents: 0}) as {error: string}).error,
    ),
    FREIGHT_QUOTE_ERRORS.amount_invalid,
  );
  const huge = validateFreightQuote({amountCents: 100000001});
  assert.equal(!huge.ok && huge.error, "amount_out_of_range");
  const negative = validateFreightQuote({
    amountCents: 1000,
    paybackAmountCents: -1,
  });
  assert.equal(!negative.ok && negative.error, "payback_invalid");
  const wordy = validateFreightQuote({
    amountCents: 1000,
    terms: "x".repeat(1001),
  });
  assert.equal(!wordy.ok && wordy.error, "terms_too_long");
});

test("one business, one price - a second answer revises the first", () => {
  assert.equal(freightQuoteDocumentId("req1", "biz1"), "req1__biz1");
});

test("a quote's payback reaches the customer's comparison", () => {
  // Price alone cannot be compared. A cheaper business that pays nothing
  // back is not cheaper in the way that decides this, so both numbers are on
  // the same card and the business standing behind nothing says so there.
  assert.deepEqual(freightQuotePaybackParts(40000), {
    paysBack: true,
    amount: 400,
  });
  assert.deepEqual(freightQuotePaybackParts(0), {paysBack: false, amount: 0});
  assert.deepEqual(freightQuotePaybackParts(undefined), {
    paysBack: false,
    amount: 0,
  });

  assert.match(customerSource, /freightQuotePaybackParts\(quote\.paybackAmountCents\)/);
  assert.match(customerSource, /<span>Pays back<\/span>/);
  assert.match(customerSource, /Pays nothing back if it is lost/);
  // The price is on the card too, from the quote rather than from any rate.
  assert.match(customerSource, /Price to send it/);
  assert.match(
    customerSource,
    /Number\(quote\.amountCents \?\? 0\) \/ 100/,
  );
});

test("choosing one price closes the rest, and the screen says so", () => {
  // Selection is the server's to make - it marks the request and closes the
  // losing quotes. What this screen owes the customer is that the closed
  // ones stop offering a button that cannot be pressed.
  assert.match(customerSource, /callFunction\("selectFreightQuote", \{/);
  assert.match(customerSource, /requestId: request\.id,\s*\n\s*quoteId: quote\.id,/);
  assert.match(customerSource, /disabled=\{Boolean\(busyId\) \|\| \(chosen && !selected\)\}/);
  assert.match(customerSource, /"Not chosen"/);
  assert.match(customerSource, /"Chosen"/);
});

test("the business feed answers with a price and a payback", () => {
  // The request arrives with the parcel described, and the answer is two
  // numbers: what this business charges, and what it owes if it loses it.
  assert.match(operationsSource, /freightQuoteRequests/);
  assert.match(
    operationsSource,
    /where\("eligibleBusinessIds", "array-contains", scopedBusinessId\)/,
  );
  assert.match(
    operationsSource,
    /text\(row\.quoteStatus, "collecting"\) === "collecting"/,
  );
  assert.match(operationsSource, /"submitFreightQuote"/);
  assert.match(operationsSource, /What you charge \(USD\)/);
  assert.match(operationsSource, /What you pay back if it is lost \(USD\)/);
  // A business that already answered sees its own number and may change it.
  assert.match(operationsSource, /\? "Change your price"/);
});

test("everything the two screens say has French", () => {
  for (const english of [
    "Ask for a price",
    "No business on this route has priced this parcel.",
    "Weight (kg), if you know it",
    "Waiting for prices",
    "Price to send it",
    "Pays back",
    "if it is lost",
    "Pays nothing back if it is lost",
    "Accept this price",
    "Not chosen",
    "Price requests",
    "No one is waiting on a price",
    "Waiting on you",
    "What you charge (USD)",
    "What you pay back if it is lost (USD)",
    "Send your price",
    "Change your price",
    "Your price was sent to the customer.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `${english} has no French`);
  }
  // Including every refusal the callable can answer with.
  for (const message of Object.values(FREIGHT_QUOTE_ERRORS)) {
    assert.notEqual(
      translateValue(message, "fr"),
      message,
      `${message} has no French`,
    );
  }
});
