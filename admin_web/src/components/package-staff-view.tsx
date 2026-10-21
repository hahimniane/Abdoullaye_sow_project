"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { ExternalLink, MessageCircle, Package, Phone, RefreshCw, Tag } from "lucide-react";

import { ContainerLabelsDialog } from "@/components/business/container-labels-dialog";
import { PackageDeliverySection } from "@/components/business/package-delivery";
import { resolveAdminRoleKey, type AdminPermissionsConfig } from "@/lib/admin-access";
import { CONTAINER_STATUS_LABELS, CONTAINER_STATUS_TONES, LINE_STAGE_LABELS, LINE_STAGE_TONES } from "@/lib/container-manifest";
import { deliveryAccess, deliveryBalanceCents } from "@/lib/container-delivery";
import { destinationCountryName, destinationCountryOptionForRow } from "@/lib/destination-countries";
import { db } from "@/lib/firebase";
import { currentLanguage, formatDate, formatDateTime } from "@/lib/format";
import { moneyText } from "@/lib/invoice-ledger";
import {
  PACKAGE_PAYMENT_LABELS,
  PACKAGE_PAYMENT_TONES,
  buildLineGroups,
  destinationPlace,
  groupForLine,
  groupPayment,
  partHintText,
} from "@/lib/waiting-packages";
import { groupRootId, linePickupFeeCents, partIndexOf } from "@/lib/line-pieces";
import {
  adminHasOperationsAccess,
  packageStaffScope,
  packageStaffViewModel,
  type PackagePerson,
  type PackageStaffViewModel,
} from "@/lib/package-staff";
import type { UserProfile } from "@/types/admin";

type Row = Record<string, unknown>;

/** A spinner that waits on a listener which never answers is a frozen page. */
const LOAD_TIMEOUT_MS = 15_000;

const KIND_LABELS: Record<PackageStaffViewModel["kind"], string> = {
  car: "Car",
  barrels: "Barrels",
  other: "Other goods",
};

type LineState = {
  key: string;
  status: "found" | "not_found" | "failed";
  line: Row | null;
};

/**
 * The staff view of a package on the tracking page: the mobile app's package
 * screen for the web. Rendered above the public tracking result, and only
 * for owners and staff (with Containers) of the business holding the line,
 * or platform admins with operations access. Everyone else - and staff
 * holding another business's label - sees nothing here: the line query is
 * scoped to their own business, and the rules refuse anything wider.
 *
 * Staff with Deliveries (and not Containers) get it too, to hand a package
 * over: no prices, payments or balances, no labels and no console link.
 * `embedded` is the business console's Deliveries tab, where there is no
 * public result below.
 */
export function PackageStaffView({
  code,
  firebaseUser,
  profile,
  embedded = false,
}: {
  code: string;
  firebaseUser: User | null | undefined;
  profile: UserProfile;
  embedded?: boolean;
}) {
  const role = String(profile.role ?? "");
  const superAdmin = resolveAdminRoleKey(profile.adminRole, false) === "superAdmin";
  // An admin's reach comes from their role's Operations access, stored in
  // platformConfig/permissions over the built-in roles. Read once; a failed
  // read falls back to the built-in roles.
  const needsAdminConfig = role === "admin" && !superAdmin;
  const [adminConfig, setAdminConfig] = useState<AdminPermissionsConfig | null>(null);
  useEffect(() => {
    if (!needsAdminConfig) return undefined;
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setAdminConfig((current) => current ?? {});
    }, LOAD_TIMEOUT_MS);
    getDoc(doc(db, "platformConfig", "permissions"))
      .then((snap) => {
        if (active) setAdminConfig(snap.exists() ? (snap.data() as AdminPermissionsConfig) : {});
      })
      .catch(() => {
        if (active) setAdminConfig({});
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [needsAdminConfig]);
  const adminOperations =
    role === "admin" && (superAdmin || (adminConfig !== null && adminHasOperationsAccess(profile.adminRole, adminConfig)));

  const scope = useMemo(
    () =>
      packageStaffScope({
        profile,
        signedIn: Boolean(firebaseUser),
        isAnonymous: firebaseUser?.isAnonymous === true,
        adminOperations,
      }),
    [profile, firebaseUser, adminOperations],
  );
  const scopeBusinessId = scope.kind === "business" ? scope.businessId : "";
  // Who may mark delivered, undo, and see money (container_delivery.js).
  const access = useMemo(() => deliveryAccess(profile), [profile]);
  const active = scope.kind !== "none" && Boolean(code);
  const key = `${scope.kind}|${scopeBusinessId}|${code}`;

  // The line, live: equality on businessId and trackingCode only, the query
  // the app's container_packages.dart makes - no composite index, and the
  // businessId filter is what lets the rules allow it. A platform admin may
  // read every business's lines, so theirs is by code alone.
  const [lineState, setLineState] = useState<LineState | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    let answered = false;
    const timer = window.setTimeout(() => {
      if (!answered) setLineState({ key, status: "failed", line: null });
    }, LOAD_TIMEOUT_MS);
    const constraints: QueryConstraint[] = scopeBusinessId
      ? [where("businessId", "==", scopeBusinessId), where("trackingCode", "==", code)]
      : [where("trackingCode", "==", code)];
    const unsubscribe = onSnapshot(
      query(collection(db, "containerLines"), ...constraints, limit(1)),
      (snap) => {
        answered = true;
        window.clearTimeout(timer);
        const found = snap.docs[0];
        setLineState({
          key,
          status: found ? "found" : "not_found",
          line: found ? { id: found.id, ...found.data() } : null,
        });
      },
      () => {
        answered = true;
        window.clearTimeout(timer);
        setLineState({ key, status: "failed", line: null });
      },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [active, code, key, scopeBusinessId]);

  const current = lineState && lineState.key === key ? lineState : null;
  const line = current?.status === "found" ? current.line : null;
  const containerId = line ? String(line.containerId ?? "") : "";
  // Its container, live: number, state, destination, sailing dates.
  const [containerState, setContainerState] = useState<{ key: string; row: Row | null } | null>(null);
  useEffect(() => {
    if (!containerId) return undefined;
    let answered = false;
    const timer = window.setTimeout(() => {
      if (!answered) setContainerState({ key: containerId, row: null });
    }, LOAD_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      doc(db, "containers", containerId),
      (snap) => {
        answered = true;
        window.clearTimeout(timer);
        setContainerState({ key: containerId, row: snap.exists() ? { id: snap.id, ...snap.data() } : null });
      },
      () => {
        answered = true;
        window.clearTimeout(timer);
        setContainerState({ key: containerId, row: null });
      },
    );
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [containerId]);
  const containerLoaded = Boolean(containerId) && containerState?.key === containerId;
  const container = containerLoaded ? containerState?.row ?? null : null;
  // A part of a package split across containers: its money is the whole
  // group's (payments live on the root), so the other parts are read too -
  // equality on businessId and rootLineId, no composite index. A line never
  // split is a group of one and reads nothing more.
  const groupBusinessId = line ? String(line.businessId ?? "") : "";
  const groupRoot = line ? groupRootId(line, String(line.id ?? "")) : "";
  const split = Boolean(line) && (partIndexOf(line) > 1 || Number(line?.lastPartIndex ?? 0) > 1);
  const groupKey = split && groupBusinessId && groupRoot ? `${groupBusinessId}|${groupRoot}` : "";
  const [groupState, setGroupState] = useState<{ key: string; rows: Row[] } | null>(null);
  useEffect(() => {
    if (!groupKey) return undefined;
    const unsubscribe = onSnapshot(
      query(collection(db, "containerLines"), where("businessId", "==", groupBusinessId), where("rootLineId", "==", groupRoot)),
      (snap) => setGroupState({ key: groupKey, rows: snap.docs.map((d) => ({ id: d.id, ...d.data() })) }),
      // Unreadable: the part's own figures stay (the group is a refinement).
      () => setGroupState({ key: groupKey, rows: [] }),
    );
    return unsubscribe;
  }, [groupKey, groupBusinessId, groupRoot]);
  const viewLang = currentLanguage() === "fr" ? "fr" : "en";
  const group = useMemo(() => {
    if (!line || !groupKey || groupState?.key !== groupKey || groupState.rows.length === 0) return null;
    return groupForLine(buildLineGroups(groupState.rows), line);
  }, [line, groupKey, groupState]);
  const view = useMemo(() => {
    if (!line) return null;
    const model = packageStaffViewModel(line, container, viewLang);
    return group ? { ...model, payment: groupPayment(group) } : model;
  }, [line, container, viewLang, group]);
  const partHint = group && line ? partHintText(group, line, viewLang) : "";
  // A collected request's pickup fee, inside the price: its own row.
  const pickupFee = group ? group.pickupFeeCents : line ? linePickupFeeCents(line) : 0;
  // What the package still owes, for the delivery warning (its whole group's).
  const balanceCents = line ? deliveryBalanceCents(group ?? groupForLine(null, line)) : 0;
  const [labelsOpen, setLabelsOpen] = useState(false);

  // Waiting on an admin's role, or nobody this view is for.
  if (!active) return null;
  // Not this business's package, or not reachable: the public result below
  // is the whole answer. Staff are told why, so a missing view is not a
  // mystery; customers never get this far.
  if (current?.status === "not_found") {
    return (
      <div className="info-band pkg-staff-note" role="status">
        {embedded
          ? "This code is not on any of your packages. Check it and try again."
          : scope.kind === "admin"
            ? "No container line has this code. The public tracking result is below."
            : "This code is not on any of your containers. The public tracking result is below."}
      </div>
    );
  }
  if (current?.status === "failed") {
    return (
      <div className="error-box pkg-staff-note" role="alert">
        This package could not be loaded. Check your connection and try again.
      </div>
    );
  }
  if (!view || !line) {
    return (
      <section className="panel pkg-staff" aria-busy="true">
        <p className="pkg-staff-loading" role="status">
          <RefreshCw aria-hidden="true" className="spin" size={16} /> Loading the package…
        </p>
      </section>
    );
  }

  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const box = view.container;
  const destinationOption = box ? destinationCountryOptionForRow({ id: box.destinationId, name: box.destinationName }) : null;
  const destination = box && destinationOption
    ? destinationOption.id ? destinationCountryName(destinationOption.id, lang) : box.destinationName
    : "";
  const containerRow = container && box ? container : null;

  return (
    <section aria-labelledby="pkg-staff-title" className="panel pkg-staff">
      <div className="panel-header">
        <div>
          <Package aria-hidden="true" size={18} />
          <h2 id="pkg-staff-title">Package</h2>
        </div>
        <span className="panel-action"><span className="lst-badge muted">Staff view</span></span>
      </div>

      <div className="pkg-staff-code">
        <div>
          <code data-no-translate>{view.code}</code>
          <strong data-no-translate>{view.title}</strong>
        </div>
        {box && <span className={`lst-badge ${CONTAINER_STATUS_TONES[box.status]}`}>{CONTAINER_STATUS_LABELS[box.status]}</span>}
        {view.waiting && <span className={`lst-badge ${LINE_STAGE_TONES.waiting}`}>{LINE_STAGE_LABELS.waiting}</span>}
      </div>
      {!embedded && <p className="panel-lede pkg-staff-lede">Only your team sees this. The customer&apos;s public tracking result is below.</p>}

      <section className="pkg-staff-section">
        <h3>What it is</h3>
        <div className="pur-info">
          <div><span>Kind</span><b>{KIND_LABELS[view.kind]}</b></div>
          {view.quantity > 0 && <div><span>Quantity</span><b data-no-translate>{view.quantity}</b></div>}
          {view.vin && <div><span>VIN</span><b data-no-translate>{view.vin}</b></div>}
          {view.description && <div><span>Description</span><b data-no-translate>{view.description}</b></div>}
        </div>
      </section>

      <div className="pkg-staff-people">
        <section className="pkg-staff-section">
          <h3>Owner</h3>
          {view.stock ? <p className="pkg-staff-muted">Business stock</p> : <PackagePersonCard person={view.owner} />}
        </section>
        <section className="pkg-staff-section">
          <h3>Receiver</h3>
          {view.receiver ? <PackagePersonCard person={view.receiver} /> : <p className="pkg-staff-muted">No receiver recorded.</p>}
        </section>
      </div>

      {/* Money only for people who may see it: never a deliveries-only person. */}
      {(view.size || (access.canSeeMoney && view.payment.status !== "no_price")) && (
        <section className="pkg-staff-section">
          <h3>{access.canSeeMoney ? "Size and price" : "Package size"}</h3>
          <div className="pur-info">
            {view.size && <div><span>Package size</span><b data-no-translate>{view.size.dimensionsText}</b><small data-no-translate>{view.size.volumeText}</small></div>}
            {access.canSeeMoney && view.payment.priceCents !== null && (
              <>
                {pickupFee > 0 && <div><span>Pickup fee</span><b data-no-translate>{moneyText(pickupFee, lang)}</b></div>}
                <div><span>Price</span><b data-no-translate>{moneyText(view.payment.priceCents, lang)}</b></div>
                <div><span>Paid</span><b data-no-translate>{moneyText(view.payment.paidCents, lang)}</b></div>
                <div><span>Still owed</span><b data-no-translate>{moneyText(view.payment.balanceCents, lang)}</b></div>
              </>
            )}
            {access.canSeeMoney && (
              <div><span>Payment</span><b><span className={`lst-badge ${PACKAGE_PAYMENT_TONES[view.payment.status]}`}>{PACKAGE_PAYMENT_LABELS[view.payment.status]}</span></b>{partHint && <small data-no-translate>{partHint}</small>}</div>
            )}
          </div>
        </section>
      )}

      <section className="pkg-staff-section">
        <h3>Container</h3>
        {view.waiting ? (
          <div className="pur-info">
            <div><span>Container</span><b>Waiting for a container</b></div>
            <div><span>Destination</span><b>{destinationPlace(view.destinationId, view.destinationName, lang) || "No destination yet"}</b></div>
          </div>
        ) : box ? (
          <div className="pur-info">
            <div>
              <span>Container</span>
              <b data-no-translate>{box.title}</b>
              {box.subtitle && <small data-no-translate>{box.subtitle}</small>}
            </div>
            <div><span>Destination</span><b>{destination || "No destination yet"}</b></div>
            {box.sailedAt && <div><span>Sailed</span><b>{formatDate(box.sailedAt)}</b></div>}
            {box.arrivedAt && <div><span>Ready for pickup</span><b>{formatDate(box.arrivedAt)}</b></div>}
          </div>
        ) : (
          <p className="pkg-staff-muted">{containerLoaded || !containerId ? "Container not found." : "Loading the container…"}</p>
        )}
      </section>

      <PackageDeliverySection
        access={access}
        balanceCents={balanceCents}
        businessId={view.businessId}
        container={containerRow}
        line={line}
      />

      <section className="pkg-staff-section">
        <h3>WhatsApp updates</h3>
        <ul className="pkg-staff-updates">
          <li>{view.whatsApp.summary}</li>
          {view.whatsApp.warnings.map((warning) => (
            <li className="pkg-staff-warn" key={warning}>{warning}</li>
          ))}
          {view.lastUpdate ? (
            <>
              <li>
                <span>{view.lastUpdate.sentence}</span>
                {view.lastUpdate.at && <> · <time data-no-translate dateTime={view.lastUpdate.at.toISOString()}>{formatDateTime(view.lastUpdate.at)}</time></>}
              </li>
              {view.lastUpdate.results.map((result) => (
                <li className={`pkg-staff-result ${result.tone}`} key={`${result.role}-${result.text}`}>{result.text}</li>
              ))}
            </>
          ) : (
            <li className="pkg-staff-muted">No update has been sent yet. The first goes out when the container sails.</li>
          )}
        </ul>
      </section>

      {/* Labels and the containers screen are the Containers permission's
          (the label callable requires it): a deliveries-only person has
          neither. */}
      {access.canUndo && (
        <div className="pkg-staff-actions">
          <button
            className="primary-button"
            disabled={!containerRow && !view.waiting}
            onClick={() => setLabelsOpen(true)}
            type="button"
          >
            <Tag aria-hidden="true" size={16} /> Reprint labels
          </button>
          {/* The business console is the owners' and staff's; a platform
              admin works from the admin console instead. Already in it,
              there is nothing to open. */}
          {scope.kind === "business" && !embedded && (
            <a className="secondary-button" href={view.consoleLink} rel="noopener" target="_blank">
              <ExternalLink aria-hidden="true" size={16} /> Open in business console
            </a>
          )}
        </div>
      )}

      {labelsOpen && (containerRow || view.waiting) && (
        <ContainerLabelsDialog
          businessId={view.businessId}
          container={containerRow}
          line={line}
          onClose={() => setLabelsOpen(false)}
        />
      )}
    </section>
  );
}

/** A person on the line, with Call and WhatsApp (the app's `_Person`). */
function PackagePersonCard({ person }: { person: PackagePerson | null }) {
  if (!person) return <p className="pkg-staff-muted">No name</p>;
  return (
    <div className="pkg-staff-person">
      <strong>{person.name ? <span data-no-translate>{person.name}</span> : "No name"}</strong>
      <small>{person.phone ? <span data-no-translate>{person.phone}</span> : "No phone"}</small>
      {person.needsCountryCode && (
        <small className="pkg-staff-warn">Add the country code so WhatsApp updates can reach this number.</small>
      )}
      {person.reportedNotMine && (
        <small className="pkg-staff-warn">The person says this number isn&apos;t theirs - check it</small>
      )}
      {person.phone && (
        <div className="pkg-staff-contact">
          {person.callHref ? (
            <a className="secondary-button" href={person.callHref}><Phone aria-hidden="true" size={15} /> Call</a>
          ) : (
            <button className="secondary-button" disabled type="button"><Phone aria-hidden="true" size={15} /> Call</button>
          )}
          {person.whatsAppHref ? (
            <a className="secondary-button" href={person.whatsAppHref} rel="noopener noreferrer" target="_blank">
              <MessageCircle aria-hidden="true" size={15} /> WhatsApp
            </a>
          ) : (
            <button className="secondary-button" disabled type="button"><MessageCircle aria-hidden="true" size={15} /> WhatsApp</button>
          )}
        </div>
      )}
    </div>
  );
}
