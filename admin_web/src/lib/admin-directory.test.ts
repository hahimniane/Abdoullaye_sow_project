import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBusinessDirectory,
  buildUserDirectory,
  userContactsFromRow,
} from "./admin-directory.ts";

const profile = (id: string, fullName: string, extra: Record<string, unknown> = {}) => ({
  id,
  uid: id,
  fullName,
  role: "customer",
  ...extra,
});

// Regression: the People list keyed rows by `name:<slug>` as well as uid, so
// two different accounts called "Mamadou Diallo" collapsed into one row and
// one person's admin actions landed on the other.
test("two real profiles with the same name stay two people", () => {
  const rows = buildUserDirectory(
    [
      profile("uid-a", "Mamadou Diallo", { email: "a@example.com" }),
      profile("uid-b", "Mamadou Diallo", { email: "b@example.com" }),
    ],
    [],
    [],
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.uid).sort(), ["uid-a", "uid-b"]);
});

test("real profiles never merge on a shared email or phone either", () => {
  const rows = buildUserDirectory(
    [
      profile("uid-a", "Awa Ba", { email: "family@example.com", phone: "+12015550100" }),
      profile("uid-b", "Ousmane Ba", { email: "family@example.com", phone: "+12015550100" }),
    ],
    [{ id: "uid-c", uid: "uid-c", email: "family@example.com", hasAuth: true }],
    [],
  );
  assert.equal(rows.length, 3);
});

test("an auth user and its profile are one row, profile fields on top", () => {
  const rows = buildUserDirectory(
    [profile("uid-a", "Fatou Sow", { email: "fatou@example.com" })],
    [{ id: "uid-a", uid: "uid-a", email: "fatou@example.com", fullName: "", hasAuth: true }],
    [],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, "Fatou Sow");
  assert.equal(rows[0].hasAuth, true);
  assert.equal(rows[0].hasProfile, true);
  assert.equal(rows[0]._inferred, false);
});

test("an inferred contact attaches to the one profile that owns its email", () => {
  const rows = buildUserDirectory(
    [profile("uid-a", "Fatou Sow", { email: "fatou@example.com" })],
    [],
    [[{ id: "ship-1", customerName: "F. Sow", customerEmail: "Fatou@Example.com", customerPhone: "+1 201 555 0100" }]],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].uid, "uid-a");
  assert.equal(rows[0].phone, "+1 201 555 0100");
  assert.equal(rows[0]._inferred, false);
});

test("an inferred contact attaches by uid even when its name differs", () => {
  const rows = buildUserDirectory(
    [profile("uid-a", "Fatou Sow")],
    [],
    [[{ id: "ship-1", customerUid: "uid-a", customerName: "Someone else" }]],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, "Fatou Sow");
});

test("a name shared by two profiles identifies neither", () => {
  const rows = buildUserDirectory(
    [profile("uid-a", "Mamadou Diallo"), profile("uid-b", "Mamadou Diallo")],
    [],
    [[{ id: "ship-1", customerName: "Mamadou Diallo", customerPhone: "+221770000000" }]],
  );
  assert.equal(rows.length, 3);
  const a = rows.find((row) => row.uid === "uid-a");
  const b = rows.find((row) => row.uid === "uid-b");
  assert.equal(a?.phone, undefined);
  assert.equal(b?.phone, undefined);
  assert.equal(rows.filter((row) => row._inferred === true).length, 1);
});

test("a unique name still attaches an inferred contact to its profile", () => {
  const rows = buildUserDirectory(
    [profile("uid-a", "Aissatou Bah")],
    [],
    [[{ id: "ship-1", receiverName: "Aissatou Bah", receiverPhone: "+224620000000" }]],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "+224620000000");
});

test("inferred contacts with different uids never merge, even by name", () => {
  const rows = buildUserDirectory(
    [],
    [],
    [[
      { id: "ship-1", customerUid: "gone-1", customerName: "Mamadou Diallo" },
      { id: "ship-2", customerUid: "gone-2", customerName: "Mamadou Diallo" },
    ]],
  );
  assert.equal(rows.length, 2);
});

test("inferred contacts without a uid merge with each other by email", () => {
  const rows = buildUserDirectory(
    [],
    [],
    [[
      { id: "ship-1", customerName: "Binta", customerEmail: "binta@example.com" },
      { id: "buy-1", buyerName: "Binta Camara", buyerEmail: "binta@example.com", buyerPhone: "+1 646 555 0101" },
    ]],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "+1 646 555 0101");
  assert.equal(rows[0]._inferred, true);
});

test("missing profiles sort first, then by name", () => {
  const rows = buildUserDirectory(
    [profile("uid-b", "Zeynab"), profile("uid-a", "Aminata")],
    [],
    [[{ id: "ship-1", customerName: "Moussa", customerEmail: "moussa@example.com" }]],
  );
  assert.deepEqual(rows.map((row) => row.fullName), ["Moussa", "Aminata", "Zeynab"]);
});

test("contacts from one record cover customer, buyer, owner and receiver", () => {
  const contacts = userContactsFromRow({
    id: "row",
    customerName: "A",
    buyerName: "B",
    ownerName: "C",
    receiverName: "D",
  });
  assert.deepEqual(contacts.map((row) => row.fullName), ["A", "B", "C", "D"]);
});

test("inferred business ids are stable across rebuilds", () => {
  const sources = [[{ id: "s1", businessName: "Société Générale d’Envoi" }, { id: "s2", businessName: "日本" }]];
  const first = buildBusinessDirectory([], sources).map((row) => row.id);
  const second = buildBusinessDirectory([], sources).map((row) => row.id);
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
});

test("operational records of a known business do not invent a second one", () => {
  const rows = buildBusinessDirectory(
    [{ id: "atlantic_exports", name: "Atlantic Exports" }],
    [[{ id: "s1", businessName: "Atlantic Exports" }, { id: "s2", businessId: "atlantic_exports", businessName: "Atlantic" }]],
  );
  assert.equal(rows.length, 1);
});

test("the admin console builds its directories once per data change", () => {
  const source = readFileSync("src/components/admin-console.tsx", "utf8");
  assert.match(source, /const userRows = useMemo\(/);
  assert.match(source, /const businessRows = useMemo\(/);
  assert.doesNotMatch(source, /`name:\$\{slugify/);
});
