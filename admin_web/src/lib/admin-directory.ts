/**
 * The admin People and Businesses directories, as pure functions so the merge
 * rules can be tested without React or Firebase.
 *
 * People: a real account (an Auth user or a `users/{uid}` profile) is one
 * person per uid, full stop. Two profiles that share a name, an email or a
 * phone are still two people - "Mamadou Diallo" is a common name, and merging
 * two of them hands one person's bookings and admin actions to the other.
 * Contacts inferred from operational records (a shipment's customer, a
 * purchase's buyer) attach to a real account by uid, or - when they carry no
 * uid - by email, then phone, then name, and only when exactly one account
 * owns that value. Inferred contacts merge with each other by the same keys,
 * but never across two different uids.
 */

import type { FirestoreRow } from "../types/admin.ts";

function str(value: unknown) {
  return String(value ?? "").trim();
}

function count(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Lowercase snake slug. Deterministic: an empty slug stays empty rather than
 * minting a timestamp id that changes on every render. */
export function directorySlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function phoneKey(value: unknown) {
  const raw = str(value);
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : "";
}

/** The contact keys an inferred contact can be matched on, strongest first.
 * Never includes the uid - uid matching is handled separately and strictly. */
export function contactKeys(row: FirestoreRow) {
  const email = str(row.email).toLowerCase();
  const phone = phoneKey(row.phone);
  const name = directorySlug(str(row.fullName));
  return [
    email ? `email:${email}` : "",
    phone ? `phone:${phone}` : "",
    name ? `name:${name}` : "",
  ].filter(Boolean);
}

export function mergeUserDirectoryRow(target: FirestoreRow, source: FirestoreRow) {
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (target[key] === undefined || target[key] === null || target[key] === "") {
      target[key] = value;
    }
  });
  // Only ever upgrade these flags to true - never coerce an unknown
  // (undefined) value down to false, which would wrongly hide real accounts
  // that also appear in operational records.
  if (source.hasAuth === true) target.hasAuth = true;
  if (source.hasProfile === true) target.hasProfile = true;
  target._inferred = target._inferred === true && source.hasProfile !== true;
}

export function userContactsFromRow(row: FirestoreRow): FirestoreRow[] {
  const candidates = [
    [row.customerUid ?? row.userId, row.customerName, row.customerEmail, row.customerPhone],
    [row.buyerUid, row.buyerName, row.buyerEmail, row.buyerPhone],
    [row.ownerUid, row.ownerName, row.ownerEmail, row.ownerPhone],
    [row.receiverUid, row.receiverName, row.receiverEmail, row.receiverPhone],
  ];
  return candidates.flatMap(([rawUid, rawName, rawEmail, rawPhone]) => {
    const uid = str(rawUid);
    const fullName = str(rawName);
    const email = str(rawEmail);
    const phone = str(rawPhone);
    if (!email && !phone && !fullName && !uid) return [];
    return [
      {
        id: uid || email || phone || `name_${directorySlug(fullName) || fullName}`,
        uid,
        fullName,
        email,
        phone,
        role: "missing_profile",
        businessId: row.businessId,
        businessName: row.businessName,
        hasProfile: false,
        _inferred: true,
        _sourceId: row.id,
        _sourceCode: row.trackingCode ?? row.purchaseCode ?? row.id,
      },
    ];
  });
}

function directorySortKey(row: FirestoreRow) {
  return str(row.fullName) || str(row.email) || str(row.id);
}

export function buildUserDirectory(
  profiles: FirestoreRow[],
  authUsers: FirestoreRow[],
  contactSources: FirestoreRow[][],
): FirestoreRow[] {
  const ordered: FirestoreRow[] = [];
  const byUid = new Map<string, FirestoreRow>();

  // 1. Real accounts: one row per uid. Auth first, then the profile on top.
  const addReal = (row: FirestoreRow, preferred: boolean) => {
    const uid = str(row.uid ?? row.id);
    const existing = uid ? byUid.get(uid) : undefined;
    if (existing) {
      if (preferred) {
        Object.assign(existing, row);
        existing.hasProfile = true;
        existing._inferred = false;
      } else {
        mergeUserDirectoryRow(existing, row);
      }
      return;
    }
    const next = { ...row };
    ordered.push(next);
    if (uid) byUid.set(uid, next);
  };
  authUsers.forEach((user) => addReal(user, false));
  profiles.forEach((profile) =>
    addReal(
      { ...profile, uid: profile.uid ?? profile.id, hasProfile: true, _inferred: false },
      true,
    ),
  );

  // 2. Which real account owns each contact key - or null when two do, in
  //    which case the key identifies nobody.
  const realByKey = new Map<string, FirestoreRow | null>();
  for (const row of ordered) {
    for (const key of contactKeys(row)) {
      const previous = realByKey.get(key);
      if (previous === undefined) realByKey.set(key, row);
      else if (previous !== row) realByKey.set(key, null);
    }
  }

  // 3. Inferred contacts from operational records.
  const inferredByKey = new Map<string, FirestoreRow>();
  const indexInferred = (row: FirestoreRow) => {
    const uid = str(row.uid);
    if (uid) inferredByKey.set(`uid:${uid}`, row);
    for (const key of contactKeys(row)) {
      if (!inferredByKey.has(key)) inferredByKey.set(key, row);
    }
  };

  for (const contact of contactSources.flatMap((rows) => rows.flatMap(userContactsFromRow))) {
    const uid = str(contact.uid);
    if (uid) {
      const real = byUid.get(uid);
      if (real) {
        mergeUserDirectoryRow(real, contact);
        continue;
      }
    } else {
      const real = contactKeys(contact)
        .map((key) => realByKey.get(key))
        .find((row): row is FirestoreRow => Boolean(row));
      if (real) {
        mergeUserDirectoryRow(real, contact);
        continue;
      }
    }

    const keys = [uid ? `uid:${uid}` : "", ...contactKeys(contact)].filter(Boolean);
    const existing = keys
      .map((key) => inferredByKey.get(key))
      .find((row) => {
        if (!row) return false;
        const rowUid = str(row.uid);
        // Two different uids are two different people.
        return !(uid && rowUid && rowUid !== uid);
      });
    if (existing) {
      mergeUserDirectoryRow(existing, contact);
      indexInferred(existing);
      continue;
    }
    const next = { ...contact };
    ordered.push(next);
    indexInferred(next);
  }

  return ordered.sort((a, b) => {
    const aMissing = a.hasProfile === false || a._inferred === true ? 1 : 0;
    const bMissing = b.hasProfile === false || b._inferred === true ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    return directorySortKey(a).localeCompare(directorySortKey(b));
  });
}

function businessKey(id: unknown, name: unknown) {
  return str(id ?? name).toLowerCase();
}

export function buildBusinessDirectory(
  businesses: FirestoreRow[],
  sources: FirestoreRow[][],
): FirestoreRow[] {
  const known = new Map<string, FirestoreRow>();
  for (const business of businesses) {
    known.set(businessKey(business.id, business.name), business);
    const nameKey = businessKey(null, business.name);
    if (nameKey) known.set(nameKey, business);
  }

  const inferred = new Map<string, FirestoreRow>();
  for (const rows of sources) {
    for (const row of rows) {
      const name = str(row.businessName);
      if (!name) continue;
      const id = str(row.businessId) || directorySlug(name) || name;
      const idKey = businessKey(id, name);
      const nameKey = businessKey(null, name);
      if (known.has(idKey) || known.has(nameKey) || inferred.has(idKey) || inferred.has(nameKey)) {
        const existing = inferred.get(idKey) ?? inferred.get(nameKey);
        if (existing) existing._sourceCount = count(existing._sourceCount) + 1;
        continue;
      }
      const business: FirestoreRow = {
        id,
        name,
        status: "missing_profile",
        businessStatus: row.businessStatus,
        phone: row.businessPhone ?? row.contactPhone,
        email: row.businessEmail ?? row.contactEmail,
        serviceNote: "Inferred from operational records",
        _inferred: true,
        _sourceCount: 1,
      };
      inferred.set(idKey, business);
      inferred.set(nameKey, business);
    }
  }

  return [...businesses, ...Array.from(new Set(inferred.values()))].sort((a, b) => {
    const aMissing = a._inferred === true ? 1 : 0;
    const bMissing = b._inferred === true ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    return (str(a.name) || str(a.id)).localeCompare(str(b.name) || str(b.id));
  });
}
