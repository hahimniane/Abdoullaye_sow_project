"use strict";

// A push to a Fleet driver beside the WhatsApp message (docs/FLEET.md
// section 12): the words, and the sender with its account lookup faked.
// Synthetic data only.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const push = require("../fleet_driver_push");

const text = (p, lang = "en") => push.driverPushText(
    {businessName: "Dala Fleet", ...p}, lang);

describe("driverPushText", () => {
  it("says a payment was received and what is left", () => {
    assert.deepEqual(text({kind: "receipt", amountCents: 40000,
      owedCents: 2500, creditCents: 0}), {
      title: "Dala Fleet: payment received",
      body: "We received $400.00. You still owe $25.00.",
    });
    assert.deepEqual(text({kind: "receipt", amountCents: 40000,
      owedCents: 0, creditCents: 0}, "fr"), {
      title: "Dala Fleet : paiement reçu",
      body: "Nous avons reçu 400,00 $. Vous ne devez plus rien.",
    });
    assert.match(text({kind: "receipt", amountCents: 41500, owedCents: 0,
      creditCents: 1500}).body, /you have \$15\.00 credit for next time/);
  });

  it("says a plate fee is due soon, today or late, with what is owed", () => {
    assert.deepEqual(text({kind: "reminder", reminder: "soon",
      dueDayKey: "2026-12-01", owedCents: 40000}), {
      title: "Dala Fleet: plate fee due soon",
      body: "Your plate fee is due on Dec 1, 2026. You owe $400.00.",
    });
    assert.deepEqual(text({kind: "reminder", reminder: "today",
      dueDayKey: "2026-12-01", owedCents: 40000}), {
      title: "Dala Fleet: plate fee due today",
      body: "Your plate fee is due today. You owe $400.00.",
    });
    assert.deepEqual(text({kind: "reminder", reminder: "late",
      dueDayKey: "2026-12-01", owedCents: 42500}, "fr"), {
      title: "Dala Fleet : frais de plaque en retard",
      body: "Votre facture de plaque était due le 1 déc. 2026 et est en " +
        "retard. Vous devez 425,00 $.",
    });
    // An unknown reminder reads as "soon".
    assert.equal(text({kind: "reminder", reminder: "weird",
      dueDayKey: "2026-12-01", owedCents: 100}).title,
    "Dala Fleet: plate fee due soon");
  });

  it("says a reported payment has not shown in the bank", () => {
    assert.deepEqual(text({kind: "not_received", amountCents: 40000}), {
      title: "Dala Fleet: payment not found yet",
      body: "We have not received your $400.00 yet. Please check with " +
        "your bank.",
    });
    assert.equal(text({kind: "not_received", amountCents: 40000}, "fr").title,
        "Dala Fleet : paiement pas encore trouvé");
  });

  it("has nothing to say without an amount or for an unknown kind", () => {
    assert.equal(text({kind: "receipt", amountCents: 0}), null);
    assert.equal(text({kind: "reminder", owedCents: 0}), null);
    assert.equal(text({kind: "not_received"}), null);
    assert.equal(text({kind: "something"}), null);
    assert.equal(push.driverPushText(null, "en"), null);
  });

  it("names Laawol when the business has no name", () => {
    assert.equal(push.driverPushText({kind: "receipt", amountCents: 100},
        "en").title, "Laawol: payment received");
  });
});

describe("createDriverPusher", () => {
  const rig = (over = {}) => {
    const sent = [];
    const asked = [];
    const pusher = push.createDriverPusher({
      findUidByVerifiedPhone: async (phone) => {
        asked.push(phone);
        return phone === "+16465550111" ? "uid-awa" : null;
      },
      readUser: async (uid) => uid === "uid-awa" ?
        {preferredLanguage: "fr"} : null,
      recipientLanguage: (user) => user.preferredLanguage === "fr" ? "fr" :
        "en",
      notify: async (n) => sent.push(n),
      ...over,
    });
    return {pusher, sent, asked};
  };
  const receipt = {kind: "receipt", businessId: "biz", businessName: "Dala",
    amountCents: 40000, owedCents: 0, creditCents: 0};

  it("pushes to the account that holds the number, in its language",
      async () => {
        const {pusher, sent, asked} = rig();
        assert.equal(await pusher({...receipt, phone: "+1 (646) 555-0111"}),
            "pushed");
        assert.deepEqual(asked, ["+16465550111"]);
        assert.deepEqual(sent, [{uid: "uid-awa",
          title: "Dala : paiement reçu",
          body: "Nous avons reçu 400,00 $. Vous ne devez plus rien.",
          data: {type: "fleet_driver", kind: "receipt", businessId: "biz"}}]);
      });

  it("does nothing for a driver with no account, no phone or no profile",
      async () => {
        const {pusher, sent, asked} = rig();
        assert.equal(await pusher({...receipt, phone: "+16465550999"}),
            "no_account");
        assert.equal(await pusher({...receipt, phone: ""}), "no_account");
        assert.equal(await pusher({...receipt, phone: "6465550111"}),
            "no_account");
        assert.deepEqual(asked, ["+16465550999"]);
        const gone = rig({readUser: async () => null});
        assert.equal(await gone.pusher({...receipt, phone: "+16465550111"}),
            "no_account");
        assert.deepEqual([...sent, ...gone.sent], []);
      });

  it("sends nothing when there are no words for it", async () => {
    const {pusher, sent} = rig();
    assert.equal(await pusher({kind: "nope", phone: "+16465550111"}),
        "nothing");
    assert.deepEqual(sent, []);
  });
});
