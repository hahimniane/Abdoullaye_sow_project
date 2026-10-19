"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, Package, RefreshCw, ShieldCheck } from "lucide-react";

import { PhoneRefusalBox } from "@/components/phone-sign-in";
import { confirmImportantAction } from "@/lib/action-confirmation";
import { currentLanguage, formatDateTime } from "@/lib/format";
import {
  GUEST_SHIPPING_FIELDS,
  guestPiecesText,
  guestServiceLabel,
  shipmentStageLabel,
} from "@/lib/guest-tracking";
import {
  appendShipmentPage,
  groupMyShipments,
  phoneRefusalOf,
  phoneRefusalText,
  type BusinessShipmentGroup,
  type MyShipmentItem,
  type MyShipmentsCursor,
  type PhoneRefusalText,
} from "@/lib/phone-accounts";
import { getMyShipments, reportShipmentNotMine } from "@/lib/phone-accounts-client";

/**
 * My packages (docs/PHONE_ACCOUNTS.md §6): every package a business recorded
 * with the signed-in person's verified number, grouped by business, the
 * ones they sent apart from the ones coming to them. Status only - never a
 * price, a list of contents or the other person's details.
 */
export function MyPackages({ onOpenProfile }: { onOpenProfile: () => void }) {
  const [items, setItems] = useState<MyShipmentItem[]>([]);
  const [cursor, setCursor] = useState<MyShipmentsCursor | null>(null);
  const [lastTwo, setLastTwo] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<PhoneRefusalText | null>(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [reportingKey, setReportingKey] = useState("");
  const [actionError, setActionError] = useState<PhoneRefusalText | null>(null);
  const [flash, setFlash] = useState("");
  const [reload, setReload] = useState(0);
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const moreRef = useRef(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setNeedsPhone(false);
    // The callable has its own 30 s limit; this is the last word, so the
    // spinner ends on every path.
    const safety = window.setTimeout(() => {
      if (!active) return;
      active = false;
      setLoading(false);
      setError(phoneRefusalText({ reason: "unknown" }));
    }, 35_000);
    getMyShipments(null)
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
        setLastTwo(page.phoneLastTwo);
      })
      .catch((caught) => {
        if (!active) return;
        const refusal = phoneRefusalOf(caught);
        setItems([]);
        setCursor(null);
        if (refusal.reason === "no_verified_phone") setNeedsPhone(true);
        else setError(phoneRefusalText(refusal));
      })
      .finally(() => {
        window.clearTimeout(safety);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      window.clearTimeout(safety);
    };
  }, [reload]);

  const showMore = useCallback(async () => {
    if (!cursor || moreRef.current) return;
    moreRef.current = true;
    setLoadingMore(true);
    setActionError(null);
    try {
      const page = await getMyShipments(cursor);
      setItems((current) => appendShipmentPage(current, page.items));
      setCursor(page.nextCursor);
    } catch (caught) {
      setActionError(phoneRefusalText(phoneRefusalOf(caught)));
    } finally {
      moreRef.current = false;
      setLoadingMore(false);
    }
  }, [cursor]);

  async function reportNotMine(item: MyShipmentItem) {
    if (reportingKey) return;
    const confirmed = await confirmImportantAction(
      "Tell the business this package isn't yours? It will be removed from your list.",
      "Signaler à l’entreprise que ce colis n’est pas le vôtre ? Il sera retiré de votre liste.",
    );
    if (!confirmed) return;
    setReportingKey(item.key);
    setActionError(null);
    setFlash("");
    try {
      await reportShipmentNotMine(item.key, item.role);
      setItems((current) => current.filter((row) => row.key !== item.key));
      setFlash("Thanks. We removed it from your list and asked the business to check the number.");
    } catch (caught) {
      setActionError(phoneRefusalText(phoneRefusalOf(caught)));
    } finally {
      setReportingKey("");
    }
  }

  const grouped = useMemo(() => groupMyShipments(items), [items]);
  const empty = !loading && !error && !needsPhone && items.length === 0;

  return (
    <div className="stack my-packages">
      <section className="panel">
        <div className="panel-header">
          <div>
            <Package size={18} />
            <h2>My packages</h2>
            {!loading && grouped.mine.length > 0 && (
              <span className="panel-count">{grouped.mine.reduce((sum, group) => sum + group.items.length, 0)}</span>
            )}
          </div>
          <button
            className="secondary-button"
            data-loading={loading}
            disabled={loading}
            onClick={() => setReload((value) => value + 1)}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={loading ? "spin" : ""} size={15} />
            Refresh
          </button>
        </div>
        {lastTwo ? (
          <p className="panel-lede">
            Packages businesses recorded with your number ending in{" "}
            <span data-no-translate>••{lastTwo}</span>.
          </p>
        ) : (
          <p className="panel-lede">Packages businesses recorded with your phone number.</p>
        )}
        {flash && <div className="info-band" role="status">{flash}</div>}
        {actionError && <PhoneRefusalBox refusal={actionError} />}
        {loading && (
          <div className="my-packages-state" role="status">
            <RefreshCw aria-hidden="true" className="spin" size={18} />
            Loading your packages...
          </div>
        )}
        {!loading && needsPhone && (
          <div className="my-packages-state my-packages-needs-phone">
            <ShieldCheck aria-hidden="true" size={20} />
            <div>
              <strong>Add and verify your phone number to see your packages.</strong>
              <p>Businesses record packages with your phone number. Verify it once in your profile.</p>
            </div>
            <button className="primary-button" onClick={onOpenProfile} type="button">
              Open profile
            </button>
          </div>
        )}
        {!loading && error && (
          <div className="my-packages-error">
            <PhoneRefusalBox refusal={error} />
            <button className="secondary-button" onClick={() => setReload((value) => value + 1)} type="button">
              <RefreshCw aria-hidden="true" size={15} />
              Retry
            </button>
          </div>
        )}
        {empty && (
          <div className="my-packages-state">
            <Inbox aria-hidden="true" size={20} />
            <p>No packages yet. When a business records a package with your number, it shows here.</p>
          </div>
        )}
        {!loading && grouped.mine.length > 0 && (
          <PackageGroups
            groups={grouped.mine}
            lang={lang}
            onReport={(item) => void reportNotMine(item)}
            reportingKey={reportingKey}
          />
        )}
        {!loading && !empty && !error && !needsPhone && grouped.mine.length === 0 && (
          <p className="my-packages-none">Nothing you sent yet.</p>
        )}
      </section>

      {!loading && grouped.comingToYou.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <Package size={18} />
              <h2>Coming to you</h2>
              <span className="panel-count">{grouped.comingToYou.reduce((sum, group) => sum + group.items.length, 0)}</span>
            </div>
          </div>
          <p className="panel-lede">Packages someone is sending to your number.</p>
          <PackageGroups
            groups={grouped.comingToYou}
            lang={lang}
            onReport={(item) => void reportNotMine(item)}
            reportingKey={reportingKey}
          />
        </section>
      )}

      {!loading && cursor && (
        <button
          className="secondary-button my-packages-more"
          data-loading={loadingMore}
          disabled={loadingMore}
          onClick={() => void showMore()}
          type="button"
        >
          <RefreshCw aria-hidden="true" className={loadingMore ? "spin" : ""} size={15} />
          {loadingMore ? "Loading more..." : "Show more"}
        </button>
      )}
    </div>
  );
}

function PackageGroups({
  groups,
  lang,
  onReport,
  reportingKey,
}: {
  groups: BusinessShipmentGroup[];
  lang: "en" | "fr";
  onReport: (item: MyShipmentItem) => void;
  reportingKey: string;
}) {
  return (
    <div className="my-packages-groups">
      {groups.map((group) => (
        <section className="my-packages-business" key={group.businessId || group.businessName}>
          <h3>
            {group.businessName ? <span data-no-translate>{group.businessName}</span> : "A Laawol business"}
          </h3>
          <div className="my-packages-cards">
            {group.items.map((item) => (
              <PackageCard
                item={item}
                key={item.key}
                lang={lang}
                onReport={() => onReport(item)}
                reporting={reportingKey === item.key}
                reportLocked={reportingKey !== ""}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function PackageCard({
  item,
  lang,
  onReport,
  reporting,
  reportLocked,
}: {
  item: MyShipmentItem;
  lang: "en" | "fr";
  onReport: () => void;
  reporting: boolean;
  reportLocked: boolean;
}) {
  const shipping = item.shipping;
  return (
    <article className="my-package-card">
      <div className="my-package-head">
        <div>
          <span className="customer-service-kicker">{guestServiceLabel(item.service)}</span>
          {item.trackingCode && <code className="ctn-code" data-no-translate>{item.trackingCode}</code>}
        </div>
        <span className="status-pill compact">{shipmentStageLabel(item.service, item.stage)}</span>
      </div>
      <dl className="my-package-facts">
        {item.pieceCount > 0 && (
          <div>
            <dt>Pieces</dt>
            <dd data-no-translate>{guestPiecesText(item.pieceCount, lang)}</dd>
          </div>
        )}
        {item.createdAtMs > 0 && (
          <div>
            <dt>Created</dt>
            <dd>{formatDateTime(item.createdAtMs)}</dd>
          </div>
        )}
        {item.updatedAtMs > item.createdAtMs && (
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(item.updatedAtMs)}</dd>
          </div>
        )}
        {shipping &&
          GUEST_SHIPPING_FIELDS.filter(({ key }) => shipping[key]).map(({ key, label }) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd data-no-translate>{shipping[key]}</dd>
            </div>
          ))}
      </dl>
      {item.parts.length > 1 && (
        <ul className="my-package-parts">
          {item.parts.map((part) => (
            <li key={part.trackingCode}>
              <code className="ctn-code" data-no-translate>{part.trackingCode}</code>
              <span className="status-pill compact">{shipmentStageLabel(item.service, part.stage)}</span>
              <small data-no-translate>{guestPiecesText(part.pieceCount, lang)}</small>
            </li>
          ))}
        </ul>
      )}
      {item.roles.length > 1 && <p className="my-package-note">You are the sender and the receiver.</p>}
      <div className="my-package-actions">
        <button
          className="text-button"
          data-loading={reporting}
          disabled={reportLocked}
          onClick={onReport}
          type="button"
        >
          {reporting ? "Sending..." : "This isn't mine"}
        </button>
      </div>
    </article>
  );
}
