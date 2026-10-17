"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {PlaidError} = require("../plaid_client");
const {
  collectSyncPages,
  creditDocId,
  creditFromTransaction,
  itemWebhookChange,
  planSyncWrites,
  senderNameOf,
  syncFailurePatch,
  syncSuccessPatch,
} = require("../bank_sync");

const SCOPE = {businessId: "biz_a", accountId: "acc_checking"};
const tx = (over = {}) => ({
  transaction_id: "t1",
  account_id: "acc_checking",
  amount: -40,
  iso_currency_code: "USD",
  date: "2026-10-16",
  authorized_date: "2026-10-16",
  authorized_datetime: "2026-10-16T18:04:00Z",
  datetime: null,
  name: "Zelle payment from FATOU BAH Conf# 8XK2LQ",
  merchant_name: null,
  pending: false,
  pending_transaction_id: null,
  counterparties: [],
  ...over,
});

describe("bank sync: a Plaid row as a credit", () => {
  it("flips Plaid's sign exactly once: money in is positive cents", () => {
    const credit = creditFromTransaction(tx({amount: -40.1}), SCOPE);
    assert.equal(credit.amountCents, 4010);
    assert.equal(creditFromTransaction(tx({amount: 40}), SCOPE), null,
        "money out is never a credit");
    assert.equal(creditFromTransaction(tx({amount: 0}), SCOPE), null);
    assert.equal(creditFromTransaction(tx({amount: -0.1 - 0.2}), SCOPE)
        .amountCents, 30, "float noise rounds to the cent");
  });

  it("keeps pending deposits, with the bank's best time", () => {
    const credit = creditFromTransaction(tx({pending: true}), SCOPE);
    assert.equal(credit.pending, true);
    assert.equal(credit.atMs, Date.parse("2026-10-16T18:04:00Z"));
    assert.equal(credit.timeKnown, true);
    const posted = creditFromTransaction(tx({authorized_datetime: null,
      datetime: "2026-10-16T19:00:00Z"}), SCOPE);
    assert.equal(posted.atMs, Date.parse("2026-10-16T19:00:00Z"));
    assert.equal(posted.authorizedAtMs, null);
    const dated = creditFromTransaction(tx({authorized_datetime: null,
      datetime: null}), SCOPE);
    assert.equal(dated.atMs, null);
    assert.equal(dated.timeKnown, false);
    assert.equal(dated.dateKey, "2026-10-16");
  });

  it("reads only the connected account, in dollars", () => {
    assert.equal(creditFromTransaction(tx({account_id: "acc_savings"}),
        SCOPE), null);
    assert.equal(creditFromTransaction(tx({iso_currency_code: "CAD"}),
        SCOPE), null);
    assert.ok(creditFromTransaction(tx({iso_currency_code: null}), SCOPE));
    assert.equal(creditFromTransaction(tx({transaction_id: "a/b"}), SCOPE),
        null);
  });

  it("stores the sender's name and nothing else from the line", () => {
    const credit = creditFromTransaction(tx(), SCOPE);
    assert.equal(credit.senderName, "FATOU BAH");
    assert.equal(Object.values(credit).some((v) =>
      String(v).includes("8XK2LQ")), false, "no reference numbers stored");
    assert.equal(credit.name, undefined);
    assert.equal(credit.description, undefined);
    assert.equal(senderNameOf(tx({counterparties: [{name: "Fatou Bah",
      type: "individual"}]})), "Fatou Bah");
    assert.equal(senderNameOf(tx({name: "ZELLE FROM MAMADOU DIALLO ON 10/16"})),
        "MAMADOU DIALLO");
    assert.equal(senderNameOf(tx({name: "DEPOSIT", merchant_name: "Cash App"})),
        "Cash App");
    assert.equal(senderNameOf(tx({name: "Zelle Transfer Conf# 12345"})), "");
  });

  it("names its document by business and transaction", () => {
    assert.equal(creditDocId("biz_a", "t1"), "biz_a_t1");
  });
});

describe("bank sync: what one sync writes", () => {
  it("upserts added and modified credits, account-filtered", () => {
    const plan = planSyncWrites({...SCOPE,
      added: [tx({transaction_id: "a"}), tx({transaction_id: "out",
        amount: 12}), tx({transaction_id: "sav", account_id: "acc_savings"})],
      modified: [tx({transaction_id: "m", amount: -55})],
      removed: []});
    assert.deepEqual(plan.upserts.map((c) => c.transactionId), ["a", "m"]);
    assert.equal(plan.upserts[1].amountCents, 5500);
    assert.deepEqual(plan.removals, []);
    assert.equal("consumedBy" in plan.upserts[0], false,
        "a sync never writes consumedBy");
    assert.equal("removed" in plan.upserts[0], false,
        "a sync never un-removes");
  });

  it("marks removed rows, and a removal later in the run wins", () => {
    const plan = planSyncWrites({...SCOPE,
      added: [tx({transaction_id: "gone"}), tx({transaction_id: "kept"})],
      modified: [],
      removed: [{transaction_id: "gone"}, {transaction_id: "old"},
        {transaction_id: "old"}, {transaction_id: "x/y"}]});
    assert.deepEqual(plan.upserts.map((c) => c.transactionId), ["kept"]);
    assert.deepEqual(plan.removals, ["gone", "old"]);
  });

  it("carries a pending deposit that posted over in one transaction", () => {
    const plan = planSyncWrites({...SCOPE,
      added: [tx({transaction_id: "posted", pending_transaction_id: "pend"})],
      modified: [],
      removed: [{transaction_id: "pend"}]});
    assert.deepEqual(plan.upserts, []);
    assert.equal(plan.replacements.length, 1);
    assert.equal(plan.replacements[0].pendingTransactionId, "pend");
    assert.deepEqual(plan.removals, [],
        "the replacement's transaction marks the pending one removed");
  });
});

describe("bank sync: paging", () => {
  const page = (n, more) => ({added: [{transaction_id: `p${n}`}],
    modified: [], removed: [], next_cursor: `c${n}`, has_more: more});

  it("pages from the saved cursor until has_more is false", async () => {
    const seen = [];
    const result = await collectSyncPages({cursor: "c0", fetchPage:
      async (cursor) => {
        seen.push(cursor);
        return page(seen.length, seen.length < 3);
      }});
    assert.deepEqual(seen, ["c0", "c1", "c2"]);
    assert.equal(result.nextCursor, "c3");
    assert.equal(result.complete, true);
    assert.equal(result.added.length, 3);
  });

  it("starts from the beginning without a cursor", async () => {
    let first;
    await collectSyncPages({cursor: "", fetchPage: async (cursor) => {
      first = cursor;
      return page(1, false);
    }});
    assert.equal(first, null);
  });

  it("restarts from the saved cursor on a mutation during pagination",
      async () => {
        const seen = [];
        let failed = false;
        const result = await collectSyncPages({cursor: "c0",
          fetchPage: async (cursor) => {
            seen.push(cursor);
            if (cursor === "c1" && !failed) {
              failed = true;
              throw new PlaidError(
                  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "x");
            }
            return cursor === "c0" ? page(1, true) : page(2, false);
          }});
        assert.deepEqual(seen, ["c0", "c1", "c0", "c1"]);
        assert.equal(result.restarts, 1);
        assert.equal(result.added.length, 2,
            "the abandoned run's rows are thrown away");
        assert.equal(result.nextCursor, "c2");
      });

  it("gives up after repeated mutations and on any other error",
      async () => {
        await assert.rejects(collectSyncPages({cursor: "c0", maxRestarts: 2,
          fetchPage: async () => {
            throw new PlaidError(
                "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", "x");
          }}), (e) => e.code ===
          "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION");
        let calls = 0;
        await assert.rejects(collectSyncPages({cursor: "c0",
          fetchPage: async () => {
            calls += 1;
            throw new PlaidError("ITEM_LOGIN_REQUIRED", "x");
          }}), (e) => e.code === "ITEM_LOGIN_REQUIRED");
        assert.equal(calls, 1);
      });

  it("stops after the page cap and keeps the cursor it reached",
      async () => {
        let n = 0;
        const result = await collectSyncPages({cursor: "c0", maxPages: 4,
          fetchPage: async () => page(++n, true)});
        assert.equal(n, 4);
        assert.equal(result.complete, false);
        assert.equal(result.nextCursor, "c4");
      });
});

describe("bank sync: link status", () => {
  it("turns ITEM webhooks into statuses", () => {
    assert.deepEqual(itemWebhookChange("LOGIN_REPAIRED"),
        {status: "active", lastErrorCode: null});
    assert.deepEqual(itemWebhookChange("ERROR",
        {error_code: "ITEM_LOGIN_REQUIRED"}),
    {status: "needs_reauth", lastErrorCode: "ITEM_LOGIN_REQUIRED"});
    assert.deepEqual(itemWebhookChange("PENDING_EXPIRATION"),
        {status: "needs_reauth", lastErrorCode: "PENDING_EXPIRATION"});
    assert.deepEqual(itemWebhookChange("ERROR",
        {error_code: "INSTITUTION_DOWN", error_type: "INSTITUTION_ERROR"}),
    {status: null, lastErrorCode: "INSTITUTION_DOWN"});
    assert.equal(itemWebhookChange("WEBHOOK_UPDATE_ACKNOWLEDGED"), null);
  });

  it("a working sync clears an error but not an expiry warning", () => {
    assert.deepEqual(syncSuccessPatch({status: "active"}, "c9"),
        {cursor: "c9", lastErrorCode: null});
    assert.deepEqual(syncSuccessPatch({status: "needs_reauth",
      lastErrorCode: "ITEM_LOGIN_REQUIRED"}, "c9"),
    {cursor: "c9", lastErrorCode: null, status: "active"});
    assert.deepEqual(syncSuccessPatch({status: "needs_reauth",
      lastErrorCode: "PENDING_EXPIRATION"}, "c9"), {cursor: "c9"});
  });

  it("a failed sync records the code, and the login when it expired", () => {
    assert.deepEqual(syncFailurePatch(new PlaidError("ITEM_LOGIN_REQUIRED",
        "x", "ITEM_ERROR")).patch,
    {lastErrorCode: "ITEM_LOGIN_REQUIRED", status: "needs_reauth"});
    assert.deepEqual(syncFailurePatch(new Error("socket")).patch,
        {lastErrorCode: "NETWORK"});
  });
});
