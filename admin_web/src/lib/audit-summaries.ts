/**
 * French for the History sentences the server writes in English.
 *
 * Container, lot-ledger and invoice audit rows carry a `summary` built in
 * `my_flutter_app/functions/index.js` (containerAudit, writeLotLedgerAudit,
 * invoiceAudit) and `business_parking_entry.js`. They mix fixed wording with
 * what staff typed - a customer's name, a VIN, a container label - so the
 * dictionary cannot translate them: an exact match never hits, and the
 * substring pass would rewrite the names. Each shape here translates the fixed
 * wording and carries every typed part across verbatim.
 *
 * The console marks the elements that show these summaries with
 * `data-audit-summary`; only those go through this table. When the server
 * gains a new sentence, add its shape here and a case to the test.
 */

type Lookup = (english: string) => string | undefined;

const MONEY = String.raw`\$[0-9][0-9,]*(?:\.[0-9]{1,2})?`;

const CONTACT_FIELDS: Record<string, string> = {
  "customer's name": "nom du client",
  "customer's phone": "téléphone du client",
  "receiver's name": "nom du destinataire",
  "receiver's phone": "téléphone du destinataire",
  "customer's WhatsApp updates": "mises à jour WhatsApp du client",
  "receiver's WhatsApp updates": "mises à jour WhatsApp du destinataire",
};

// updateContainer reports the record's own field keys.
const CONTAINER_FIELDS: Record<string, string> = {
  label: "nom",
  containerNumber: "numéro de conteneur",
  bookingReference: "référence de réservation",
  destinationCountryId: "pays de destination",
  destinationCountryName: "pays de destination",
  notes: "notes",
};

// shipment_tracking.js CONTAINER_STATUS_LABEL.
const CARRIER_STATUSES: Record<string, string> = {
  "Tracking request received": "Demande de suivi reçue",
  "Loaded on vessel": "Chargé sur le navire",
  "Discharged at terminal": "Déchargé au terminal",
  "Available for pickup": "Disponible pour le retrait",
  "Held at terminal": "Retenu au terminal",
  "Awaiting inland transfer": "En attente de transfert intérieur",
  "On rail": "Sur le rail",
  "Left the terminal": "A quitté le terminal",
  "Picked up": "Retiré",
  Delivered: "Livré",
  "Empty container returned": "Conteneur vide restitué",
};

// Invoice payment methods (invoice_ledger.js keys).
const PAYMENT_METHODS: Record<string, string> = {
  cash: "espèces",
  zelle: "Zelle",
  cashapp: "Cash App",
  venmo: "Venmo",
  check: "chèque",
  card_in_person: "carte en personne",
  other: "autre",
};

function plural(count: string, one: string, many: string) {
  return Number(count) === 1 ? one : many;
}

/** "car 1HG…", "3 barrels", "a line" or a typed description. */
function lineWhat(value: string) {
  let match = /^car (.+)$/.exec(value);
  if (match) return `la voiture ${match[1]}`;
  match = /^(\d+) barrels?$/.exec(value);
  if (match) return `${match[1]} ${plural(match[1], "baril", "barils")}`;
  if (value === "a line") return "une ligne";
  return value;
}

function removal(value: string) {
  const what = lineWhat(value);
  return what === "une ligne" ? "Retrait d’une ligne" : `Retrait de ${what}`;
}

/** "label, notes" / "receiver's phone, customer's name" - every item known,
 * or null so the sentence is left alone rather than half-translated. */
function fieldList(value: string): string | null {
  const parts = value.split(", ");
  const out: string[] = [];
  for (const part of parts) {
    const french = CONTACT_FIELDS[part] ?? CONTAINER_FIELDS[part];
    if (!french) return null;
    if (!out.includes(french)) out.push(french);
  }
  return out.join(", ");
}

function via(value: string, lookup: Lookup) {
  return PAYMENT_METHODS[value] ?? lookup(value) ?? value;
}

type Rule = [RegExp, (match: RegExpExecArray, lookup: Lookup) => string | null];

const rules: Rule[] = [
  // --- Containers (containerAudit) ---
  [/^Shipped with (\d+) lines?$/, (m) => `Expédié avec ${m[1]} ${plural(m[1], "ligne", "lignes")}`],
  [/^Marked arrived$/, () => "Marqué comme arrivé"],
  [/^Carrier reported (.+)$/, (m) =>
    `Le transporteur signale : ${CARRIER_STATUSES[m[1]] ?? m[1]}`],
  [/^Started (.+)$/, (m) => `Début du chargement : ${m[1]}`],
  // Invoice line first: it is the one with an amount in brackets.
  [new RegExp(`^Added (?:(\\d+) × )?(.+) \\((${MONEY})\\) to (.+)$`), (m) =>
    `Ajout de ${m[1] ? `${m[1]} × ` : ""}${m[2]} (${m[3]}) à ${m[4]}`],
  [/^Added (car \S+|\d+ barrels?|\d+ × .+?) \(business stock\)(?:, to (.+))?$/, (m) =>
    `Ajout de ${lineWhat(m[1])} (stock de l’entreprise)${m[2] ? `, destinataire ${m[2]}` : ""}`],
  [/^Added (car \S+|\d+ barrels?|\d+ × .+?) for (.+?)(?:, to (.+))?$/, (m) =>
    `Ajout de ${lineWhat(m[1])} pour ${m[2]}${m[3] ? `, destinataire ${m[3]}` : ""}`],
  [new RegExp(`^Removed (.+) \\((${MONEY})\\) from (.+)$`), (m) =>
    `${removal(m[1])} (${m[2]}) de ${m[3]}`],
  [/^Removed (.+)$/, (m) => removal(m[1])],
  [/^Moved (.+?) to (.+)$/, (m) => `Déplacement de ${lineWhat(m[1])} vers ${m[2]}`],
  // Invoice payment before the container "Received … from …".
  [new RegExp(`^Received (${MONEY}) \\(([^)]+)\\) on (.+?)(?: for (.+?))?( — paid in full)?$`), (m, lookup) =>
    `Reçu ${m[1]} (${via(m[2], lookup)}) sur ${m[3]}` +
      (m[4] ? ` pour ${m[4]}` : "") +
      (m[5] ? " — payé en totalité" : "")],
  [/^Received (.+?) from (.+)$/, (m) => `Réception de ${lineWhat(m[1])} depuis ${m[2]}`],
  [new RegExp(`^Changed (.+) to (${MONEY}) on (.+)$`), (m) =>
    `Modification de ${m[1]} : ${m[2]} sur ${m[3]}`],
  [/^Changed (.+?)(?: for (.+))?$/, (m) => {
    const fields = fieldList(m[1]);
    if (!fields) return null;
    return `Modification : ${fields}${m[2] ? ` pour ${m[2]}` : ""}`;
  }],
  [/^Changed (\S+) — (.+)$/, (m) => `Modification de ${m[1]} — ${m[2]}`],
  [/^Deleted (\S+) — (.*)$/, (m) => `Suppression de ${m[1]} — ${m[2]}`],
  [/^Deleted (.+)$/, (m) => `Suppression de ${m[1]}`],
  [/^Opened (\S+) — (.+) for (.+)$/, (m) => `Ouverture de ${m[1]} — ${m[2]} pour ${m[3]}`],
  [new RegExp(`^Reverted a (${MONEY}) payment on (.+)$`), (m) =>
    `Annulation d’un paiement de ${m[1]} sur ${m[2]}`],

  // --- Lot ledger (writeLotLedgerAudit) ---
  [/^Marked paid — (.+?)(?: \((.+)\))?$/, (m, lookup) =>
    `Marqué comme payé — ${m[1]}${m[2] ? ` (${via(m[2], lookup)})` : ""}`],
  [new RegExp(`^Set back to not paid(?: — (${MONEY}) removed)?(?: — (.+))?$`), (m) =>
    "Remis à non payé" + (m[1] ? ` — ${m[1]} retiré` : "") + (m[2] ? ` — ${m[2]}` : "")],
  [new RegExp(`^Part payment of (${MONEY}) on the website, (${MONEY}) still owed$`), (m) =>
    `Paiement partiel de ${m[1]} sur le site web, ${m[2]} encore dû`],
  [new RegExp(`^Paid (${MONEY}) on the website$`), (m) => `Payé ${m[1]} sur le site web`],
  [new RegExp(`^Final payment of (${MONEY}) - settled$`), (m) =>
    `Paiement final de ${m[1]} - soldé`],
  [new RegExp(`^Part payment of (${MONEY}), (${MONEY}) still owed$`), (m) =>
    `Paiement partiel de ${m[1]}, ${m[2]} encore dû`],
  [/^Marked as not received(?: — (.+))?$/, (m) =>
    `Marqué comme non reçu${m[1] ? ` — ${m[1]}` : ""}`],
  [/^Marked as received$/, () => "Marqué comme reçu"],
  [/^Voided(?: — (.+))?$/, (m) => `Invalidé${m[1] ? ` — ${m[1]}` : ""}`],
  [/^Edited — nothing changed$/, () => "Modifié — rien n’a changé"],
  [/^Edited — (.+)$/, (m) => `Modifié — ${m[1]}`],
  // Field diffs: "<field> <from> → <to> (+2 more)". Only the tail is wording.
  [/^(.+ → .*) \(\+(\d+) more\)$/, (m) => `${m[1]} (+${m[2]} de plus)`],
];

/**
 * The French for one server-written History sentence, or null when it is not
 * a shape this table knows (the caller then leaves it as written).
 */
export function translateAuditSummary(
  value: string,
  lookup: Lookup = () => undefined,
): string | null {
  const summary = value.trim();
  if (!summary) return null;
  for (const [pattern, render] of rules) {
    const match = pattern.exec(summary);
    if (!match) continue;
    const french = render(match, lookup);
    if (french !== null) return french;
  }
  return null;
}
