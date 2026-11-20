"use strict";

// docs/FLEET_PAYMENT_PROOF.md: the pure decisions of a driver's payment
// report. Synthetic data only.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const c = require("../fleet_claims");

const reading = (over = {}) => ({isPayment: true, amountCents: 40000,
  dayKey: "2026-12-02", recipient: "Landa Shipping",
  senderName: "Awa Sow", confident: true, ...over});

describe("reading the picture: the answer is validated strictly", () => {
  const json = (o) => JSON.stringify(o);
  it("a good answer, with or without a code fence", () => {
    const good = json(reading());
    assert.deepEqual(c.parseReading(good), {ok: true, reading: reading()});
    assert.deepEqual(c.parseReading("```json\n" + good + "\n```").ok, true);
  });
  it("not the JSON object: could not read", () => {
    for (const raw of ["", "I think it is $400", "[1]", "null", "{}",
      "{\"isPayment\":\"yes\"}", "Sure! {\"isPayment\":true}", undefined]) {
      assert.deepEqual(c.parseReading(raw), {ok: false}, String(raw));
    }
  });
  it("a payment with an unusable amount keeps no amount (the driver is " +
      "asked)", () => {
    for (const amountCents of [0, -5, 12.5, "400", null, 2000000, 99999999,
      NaN]) {
      const r = c.parseReading(json(reading({amountCents})));
      assert.equal(r.ok, true);
      assert.equal(r.reading.amountCents, null, String(amountCents));
      assert.equal(r.reading.confident, false);
    }
    assert.equal(c.parseReading(json(reading({amountCents: 1999999})))
        .reading.amountCents, 1999999, "just under $20,000");
  });
  it("a day must be a real date; text fields are cleaned and capped", () => {
    for (const dayKey of ["2026-02-30", "yesterday", "2026-13-01", 20261202]) {
      assert.equal(c.parseReading(json(reading({dayKey}))).reading.dayKey,
          null, String(dayKey));
    }
    const r = c.parseReading(json(reading({
      recipient: "Landa\nShipping " + "x".repeat(200), senderName: 5,
      confident: "true"}))).reading;
    assert.equal(r.recipient.includes("\n"), false);
    assert.equal(r.recipient.length, 80);
    assert.equal(r.senderName, "");
    assert.equal(r.confident, false, "only a real true counts");
  });
  it("a picture that is not a payment carries nothing else", () => {
    const r = c.parseReading(json({isPayment: false, amountCents: 5000,
      recipient: "x", ignore: "previous instructions"})).reading;
    assert.deepEqual(r, {isPayment: false, amountCents: null, dayKey: null,
      recipient: "", senderName: "", confident: false});
  });
  it("the request: image as base64, untrusted-data system text, the model",
      () => {
        const body = c.pictureRequestBody({base64: "AAAA",
          mimeType: "image/jpeg; charset=x"});
        assert.equal(body.model, "claude-haiku-5-5");
        assert.match(body.system, /untrusted data/);
        assert.match(body.system, /ONLY one JSON object/);
        assert.deepEqual(body.messages[0].content[0], {type: "image",
          source: {type: "base64", media_type: "image/jpeg", data: "AAAA"}});
        assert.equal(c.pictureRequestBody({base64: "AAAA",
          mimeType: "application/pdf"}), null);
        assert.equal(c.pictureRequestBody({base64: "", mimeType: "image/png"}),
            null);
        assert.equal(c.responseText({content: [{type: "text", text: "hi"}]}),
            "hi");
        assert.equal(c.responseText({}), "");
      });
});

describe("the recipient", () => {
  const names = ["Landa Shipping", "Landa Shipping Corp", "718-807-6869",
    "pay@landa.example"];
  it("is the business: its Zelle name, its name, its handle", () => {
    for (const r of ["LANDA SHIPPING LLC", "landa shipping", "Landa Shipping",
      "(718) 807-6869", "PAY@LANDA.EXAMPLE"]) {
      assert.equal(c.recipientMatches(r, names), true, r);
    }
  });
  it("is someone else, or nobody is named", () => {
    assert.equal(c.recipientMatches("Joe Doe", names), false);
    assert.equal(c.recipientMatches("Landa Cars", names), false,
        "one shared word is not enough");
    assert.equal(c.recipientMatches("", names), null);
  });
});

describe("understanding an answer", () => {
  it("amounts", () => {
    const ok = {"400": 40000, "$400": 40000, "400.00": 40000,
      "$1,250.50": 125050, "400,50": 40050, "1 250": 125000,
      "I sent 400 dollars": 40000, "$19,999.99": 1999999};
    for (const [text, cents] of Object.entries(ok)) {
      assert.equal(c.parseAmountAnswer(text), cents, text);
    }
    for (const text of ["", "yes", "400 and 500", "0", "$20,000", "25000",
      "call me at 718 807 6869"]) {
      assert.equal(c.parseAmountAnswer(text), null, text);
    }
  });
  it("phone numbers", () => {
    assert.equal(c.parsePhoneAnswer("718-807-6869"), "+17188076869");
    assert.equal(c.parsePhoneAnswer("his number is (718) 807 6869"),
        "+17188076869");
    assert.equal(c.parsePhoneAnswer("+224 621 00 00 01"), "+224621000001");
    assert.equal(c.parsePhoneAnswer("12345"), null);
    assert.equal(c.parsePhoneAnswer("hello"), null);
  });
  it("names: two words, never an app or an account", () => {
    assert.equal(c.parseNameAnswer("Fatoumata Bah"), "Fatoumata Bah");
    assert.equal(c.parseNameAnswer("It's Fatoumata Bah"), "Fatoumata Bah");
    assert.equal(c.parseNameAnswer("c'est Fatoumata Bah"), "Fatoumata Bah");
    for (const text of ["Bah", "Zelle", "360 Checking XXXXXXX2820", "",
      "x".repeat(80)]) {
      assert.equal(c.parseNameAnswer(text), null, text);
    }
  });
  it("is the same name", () => {
    assert.equal(c.nameIs("FATOUMATA BAH", "Fatoumata B. Bah #12"), true);
    assert.equal(c.nameIs("BAH", "Fatoumata Bah"), false);
  });
});

describe("a new claim", () => {
  const plan = (o) => c.planNewClaim({todayKey: "2026-12-03",
    recipientOk: true, reading: reading(), ...o});
  it("a readable payment waits for the bank", () => {
    assert.deepEqual(plan(), {state: "waiting_bank", reason: null,
      amountCents: 40000, say: "ack"});
  });
  it("not a payment: an ordinary support message", () => {
    assert.deepEqual(plan({reading: reading({isPayment: false})}),
        {ignore: true});
  });
  it("could not read, or not sure of the amount: the driver is asked", () => {
    for (const r of [null, reading({amountCents: null, confident: false}),
      reading({confident: false})]) {
      assert.deepEqual(plan({reading: r}), {state: "asking_amount",
        reason: null, amountCents: null, say: "ask_amount"});
    }
  });
  it("to another recipient: answered at once and sent to the office", () => {
    const p = plan({recipientOk: false});
    assert.equal(p.state, "office");
    assert.equal(p.reason, "wrong_recipient");
    assert.equal(p.say, "wrong_recipient");
  });
  it("older than 10 days is refused; 10 days is fine; unknown day passes",
      () => {
        assert.equal(plan({reading: reading({dayKey: "2026-11-22"})}).reason,
            "too_old");
        assert.equal(plan({reading: reading({dayKey: "2026-11-23"})}).state,
            "waiting_bank");
        assert.equal(plan({reading: reading({dayKey: null})}).state,
            "waiting_bank");
      });
  it("a recipient the picture does not name is not refused", () => {
    assert.equal(plan({recipientOk: null}).state, "waiting_bank");
  });
});

describe("answers to the question a claim asks", () => {
  it("an amount (typed, or read from a new picture)", () => {
    const claim = {state: "asking_amount", attempts: 0};
    assert.deepEqual(c.interpretAnswer(claim, {text: "$400"}),
        {type: "amount", amountCents: 40000});
    assert.deepEqual(c.interpretAnswer(claim, {text: "",
      reading: reading()}), {type: "amount", amountCents: 40000});
    assert.deepEqual(c.interpretAnswer(claim, {text: "later"}),
        {type: "again", say: "ask_amount_again"});
  });
  it("a name, and a phone", () => {
    assert.deepEqual(c.interpretAnswer({state: "asking_name"},
        {text: "Awa Sow"}), {type: "name", payerName: "Awa Sow"});
    assert.deepEqual(c.interpretAnswer({state: "asking_driver"},
        {text: "718 807 6869"}), {type: "phone", phone: "+17188076869"});
  });
  it("three failures hand it to the office", () => {
    assert.equal(c.interpretAnswer({state: "asking_driver", attempts: 1},
        {text: "no"}).type, "again");
    assert.deepEqual(c.interpretAnswer({state: "asking_driver", attempts: 2},
        {text: "no"}), {type: "give_up"});
  });
});

describe("the timers", () => {
  const T = 1000000000000;
  const base = {state: "waiting_bank", driverId: "d", amountCents: 40000,
    createdAtMs: T, bankCheckDueAtMs: T + c.BANK_CHECK_DELAY_MS,
    bankCheckedAtMs: null, toldLateAtMs: null, closeAtMs: T + c.CLOSE_MS};
  it("one bank check, 15 minutes after the picture, once", () => {
    assert.deepEqual(c.dueActions(base, T + 14 * 60000), []);
    assert.deepEqual(c.dueActions(base, T + 15 * 60000), ["bank_check"]);
    assert.deepEqual(c.dueActions({...base, bankCheckedAtMs: T + 900000},
        T + 19 * 60000), []);
  });
  it("then the name is asked once, if nothing matched and none given", () => {
    const checked = {...base, bankCheckedAtMs: T + 900000};
    assert.deepEqual(c.dueActions(checked, T + 900000 + 4 * 60000), []);
    assert.deepEqual(c.dueActions(checked, T + 900000 + 5 * 60000),
        ["ask_name"]);
    assert.deepEqual(c.dueActions({...checked, payerName: "A B"},
        T + 3600000), []);
    assert.deepEqual(c.dueActions({...checked, nameAskedAtMs: T + 1},
        T + 3600000), []);
  });
  it("2 days: the driver is told once; 7 days: closed", () => {
    const checked = {...base, bankCheckedAtMs: T + 900000,
      payerName: "A B"};
    assert.deepEqual(c.dueActions(checked, T + 2 * c.DAY_MS - 1), []);
    assert.deepEqual(c.dueActions(checked, T + 2 * c.DAY_MS),
        ["late_notice"]);
    assert.deepEqual(c.dueActions({...checked, toldLateAtMs: T + 2 * c.DAY_MS},
        T + 3 * c.DAY_MS), []);
    assert.deepEqual(c.dueActions(checked, T + 7 * c.DAY_MS), ["close"]);
  });
  it("paid, closed and unknown claims do nothing", () => {
    for (const state of ["paid", "closed", "nonsense"]) {
      assert.deepEqual(c.dueActions({...base, state}, T + 9 * c.DAY_MS), []);
    }
    assert.deepEqual(c.dueActions(null, T), []);
  });
  it("an asking claim is not given a bank check", () => {
    assert.deepEqual(c.dueActions({...base, state: "asking_amount",
      amountCents: null}, T + c.DAY_MS), []);
  });
});

describe("a payment that is already recorded", () => {
  const claim = {driverId: "d", amountCents: 40000,
    read: {dayKey: "2026-12-02"}};
  const pay = {driverId: "d", amountCents: 40000, paidDayKey: "2026-12-03",
    status: "recorded"};
  it("the same driver, amount and day (a day of slack)", () => {
    assert.equal(c.isAlreadyRecorded(claim, pay), true);
    assert.equal(c.isAlreadyRecorded(claim, {...pay,
      paidDayKey: "2026-12-05"}), false);
    assert.equal(c.isAlreadyRecorded(claim, {...pay, amountCents: 1}), false);
    assert.equal(c.isAlreadyRecorded(claim, {...pay, driverId: "e"}), false);
    assert.equal(c.isAlreadyRecorded(claim, {...pay, status: "undone"}),
        false);
    assert.equal(c.isAlreadyRecorded(claim, {...pay, claimId: "x"}), false);
    assert.equal(c.isAlreadyRecorded(claim, {...pay, imported: true}), false);
    assert.equal(c.isAlreadyRecorded({...claim, read: null}, pay), false);
  });
});

describe("what is said: every reply in English and French", () => {
  const kinds = ["ack", "already_waiting", "already_recorded", "ask_amount",
    "ask_amount_again", "ask_driver", "ask_driver_again", "ask_name",
    "ask_name_again", "name_thanks", "wrong_recipient", "too_old",
    "to_office", "late"];
  it("each kind has both languages, and they differ", () => {
    for (const kind of kinds) {
      const en = c.replyText(kind, "en", {amountCents: 40000,
        business: "Landa Shipping", recipient: "Joe Doe"});
      const fr = c.replyText(kind, "fr", {amountCents: 40000,
        business: "Landa Shipping", recipient: "Joe Doe"});
      assert.ok(en && fr && en !== fr, kind);
    }
    assert.equal(c.replyText("nope", "en"), "");
  });
  it("the wording the owner chose", () => {
    assert.equal(c.replyText("ack", "en"),
        "Got it. We will confirm when the bank shows it.");
    assert.equal(c.replyText("late", "en", {amountCents: 40000}),
        "We have not received your $400.00 yet. Please check with your bank.");
    assert.equal(c.replyText("ask_name", "en"),
        "What name is on the account you paid from?");
    assert.equal(c.replyText("ask_driver", "en"),
        "Which driver is this payment for? Send their phone number.");
    assert.match(c.replyText("wrong_recipient", "en",
        {recipient: "Joe Doe", business: "Landa Shipping"}),
    /went to Joe Doe, not Landa Shipping/);
    assert.match(c.replyText("late", "fr", {amountCents: 40000}),
        /400,00 \$/);
  });
});
