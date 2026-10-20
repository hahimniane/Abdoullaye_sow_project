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
  carrierScac: "compagnie maritime",
};

// container_manifest.js LINE_FIELD_LABELS: what an edited line names.
const LINE_FIELDS: Record<string, string> = {
  kind: "type",
  VIN: "VIN",
  make: "marque",
  model: "modèle",
  year: "année",
  quantity: "quantité",
  description: "description",
  owner: "propriétaire",
  size: "taille",
  destination: "destination",
  price: "prix",
  "pay on arrival": "paiement à l’arrivée",
  // A line with pieces (line_pieces.js): what they are, and their prices.
  pieces: "colis",
  "piece prices": "prix des colis",
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

/**
 * One counted part of a piece summary (line_pieces.js `pieceSummaryText`):
 * "2 barrels", "1 box", "3 items", "1 car"; null for anything else (a typed
 * name, "2 × TV"), which is carried across as written.
 */
function piecePart(value: string): string | null {
  const match = /^(\d+) (barrels?|box(?:es)?|items?|cars?)$/.exec(value);
  if (!match) return null;
  const n = match[1];
  if (match[2].startsWith("barrel")) return `${n} ${plural(n, "baril", "barils")}`;
  if (match[2].startsWith("box")) return `${n} ${plural(n, "carton", "cartons")}`;
  if (match[2].startsWith("item")) return `${n} ${plural(n, "article", "articles")}`;
  return `${n} ${plural(n, "voiture", "voitures")}`;
}

/** "car 1HG…", "3 barrels", "2 barrels, 1 box, TV", "a line" or a typed description. */
function lineWhat(value: string) {
  let match = /^car (.+)$/.exec(value);
  if (match) return `la voiture ${match[1]}`;
  match = /^(\d+) barrels?$/.exec(value);
  if (match) return `${match[1]} ${plural(match[1], "baril", "barils")}`;
  if (value === "a line") return "une ligne";
  // A piece summary: each counted part in French, each typed name as it is.
  const parts = value.split(", ");
  if (parts.some((part) => piecePart(part) !== null)) {
    return parts.map((part) => piecePart(part) ?? part).join(", ");
  }
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
    const french = CONTACT_FIELDS[part] ?? CONTAINER_FIELDS[part] ?? LINE_FIELDS[part];
    if (!french) return null;
    if (!out.includes(french)) out.push(french);
  }
  return out.join(", ");
}

function via(value: string, lookup: Lookup) {
  return PAYMENT_METHODS[value] ?? lookup(value) ?? value;
}

type Rule = [RegExp, (match: RegExpExecArray, lookup: Lookup) => string | null];

// Store transfers (docs/INVENTORY.md "Store transfers (v5)", History): the
// write-off reasons the server names.
const WRITE_OFF_REASONS_FR: Record<string, string> = {
  "Lost in transit": "Perdu en route",
  Damaged: "Endommagé",
  Stolen: "Volé",
  Other: "Autre",
};

const TRANSFER_CODE = String.raw`TR-[A-Z0-9]+`;

/** French reads 0 and 1 as singular. */
function frPlural(count: string, one: string, many: string) {
  return Number(count) <= 1 ? one : many;
}

/** "14 items" -> "14 articles"; "1 item" -> "1 article". */
function itemsFr(count: string) {
  return `${count} ${frPlural(count, "article", "articles")}`;
}

const rules: Rule[] = [
  // --- A sale switched between paid and credit (inventory_sale, v6) ---
  [new RegExp(`^Switched to credit: (?:(${MONEY}) paid at the sale \\((\\w+)\\), )?(${MONEY}) owed(?: by (.+))?$`), (m, lookup) =>
    "Passée à crédit : " + (m[1] ? `${m[1]} payés à la vente (${via(m[2], lookup)}), ` : "") +
    `${m[3]} dus` + (m[4] ? ` par ${m[4]}` : "")],
  [new RegExp(`^Switched to paid: (${MONEY}) paid at the sale \\((\\w+)\\)$`), (m, lookup) =>
    `Passée en payée : ${m[1]} payés à la vente (${via(m[2], lookup)})`],

  // --- Store transfers (entityType inventory_transfer) ---
  [new RegExp(`^Sent (\\d+) items? from (.+?) to (.+) \\((${TRANSFER_CODE})\\)$`), (m) =>
    `Envoi de ${itemsFr(m[1])} de ${m[2]} vers ${m[3]} (${m[4]})`],
  [new RegExp(`^Cancelled (${TRANSFER_CODE}): (\\d+) items? back in (.+)$`), (m) =>
    `Annulation de ${m[1]} : ${itemsFr(m[2])} de retour à ${m[3]}`],
  [new RegExp(`^Discarded the draft (${TRANSFER_CODE})$`), (m) => `Brouillon ${m[1]} supprimé`],
  [new RegExp(`^(.+) received all (\\d+) items? of (${TRANSFER_CODE})$`), (m) =>
    Number(m[2]) === 1 ? `${m[1]} a reçu l’article de ${m[3]}` : `${m[1]} a reçu les ${m[2]} articles de ${m[3]}`],
  [new RegExp(`^(.+) received (\\d+) of (\\d+) items? of (${TRANSFER_CODE}): (\\d+) missing$`), (m) =>
    `${m[1]} a reçu ${itemsFr(m[2])} sur ${m[3]} de ${m[4]} : ${m[5]} ${frPlural(m[5], "manquant", "manquants")}`],
  [new RegExp(`^Returned (\\d+) of (.+) to (.+) \\((${TRANSFER_CODE})\\)$`), (m) =>
    `Retour de ${m[1]} × ${m[2]} à ${m[3]} (${m[4]})`],
  [new RegExp(`^Wrote off (\\d+) of (.+) from (${TRANSFER_CODE}): (Lost in transit|Damaged|Stolen|Other)$`), (m) =>
    `Perte de ${m[1]} × ${m[2]} sur ${m[3]} : ${WRITE_OFF_REASONS_FR[m[4]]}`],

  // --- Containers (containerAudit) ---
  [/^Shipped with (\d+) lines?$/, (m) => `Expédié avec ${m[1]} ${plural(m[1], "ligne", "lignes")}`],
  [/^Marked arrived$/, () => "Marqué comme arrivé"],
  [/^Marked ready for pickup$/, () => "Marqué prêt à récupérer"],
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
  // A line with pieces: "Added 2 barrels, 1 box for Fatou, to Mariama".
  [/^Added ((?:\d+ (?:barrels?|box(?:es)?|items?)|\d+ × [^,]+)(?:, [^,]+)*?) for (.+?)(?:, to (.+))?$/, (m) =>
    `Ajout de ${lineWhat(m[1])} pour ${m[2]}${m[3] ? `, destinataire ${m[3]}` : ""}`],
  // assignContainerLines, per package: "Added 2 barrels, 1 box to MSKU1234567".
  [/^Added ((?:car \S+|\d+ (?:barrels?|box(?:es)?|items?)|\d+ × [^,]+)(?:, [^,]+)*?) to (.+)$/, (m) =>
    `Ajout de ${lineWhat(m[1])} à ${m[2]}`],
  // A split across containers (assignContainerLines with pieceCounts).
  [/^Split (\S+): (\d+) of (\d+) pieces to (.+), (\d+) stay waiting as (\S+)$/, (m) =>
    `Partage de ${m[1]} : ${m[2]} colis sur ${m[3]} vers ${m[4]}, ${m[5]} ` +
      `${Number(m[5]) === 1 ? "reste" : "restent"} en attente sous ${m[6]}`],
  [/^Split from (\S+): (\d+) pieces? waiting for a container$/, (m) =>
    `Partagé depuis ${m[1]} : ${m[2]} colis en attente d’un conteneur`],
  [new RegExp(`^Removed (.+) \\((${MONEY})\\) from (.+)$`), (m) =>
    `${removal(m[1])} (${m[2]}) de ${m[3]}`],
  [/^Removed (.+)$/, (m) => removal(m[1])],
  // updateContainerLine: "Edited 5 barrels (was 3 barrels): quantity for
  // Fatou", or with pieces "Edited 2 barrels, 1 box (was 3 barrels): pieces
  // for Fatou". The fields must all be known, or the sentence is left whole.
  [/^Edited (.+?)(?: \(was (.+?)\))?: (.+?)(?: for (.+)|( \(business stock\)))?$/, (m) => {
    const fields = fieldList(m[3]);
    if (!fields) return null;
    return `Modification de ${lineWhat(m[1])}` +
      (m[2] ? ` (auparavant ${lineWhat(m[2])})` : "") +
      ` : ${fields}` +
      (m[4] ? ` pour ${m[4]}` : m[5] ? " (stock de l’entreprise)" : "");
  }],
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
