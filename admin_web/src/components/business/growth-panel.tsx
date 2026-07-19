"use client";

import {useMemo, useState} from "react";
import {httpsCallable} from "firebase/functions";
import {BadgeDollarSign, RefreshCw, Sparkles} from "lucide-react";

import {functions} from "@/lib/firebase";
import {formatDate, text} from "@/lib/format";
import type {FirestoreRow} from "@/types/admin";

type GrowthPanelProps = {
  businessId: string;
  previewMode?: boolean;
  business?: FirestoreRow | null;
  insights: FirestoreRow[];
  loading?: boolean;
  error?: string;
};

export function GrowthPanel({
  businessId,
  previewMode = false,
  business,
  insights,
  loading = false,
  error = "",
}: GrowthPanelProps) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const plan = text(business?.plan, "free").toLowerCase();
  const entitlements = business?.entitlements && typeof business.entitlements === "object"
    ? business.entitlements as Record<string, unknown>
    : {};
  const aiAdvisorEnabled = plan === "pro" || entitlements.aiAdvisor === true || entitlements.all === true;
  const latestInsights = useMemo(
    () => [...insights].sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt)).slice(0, 3),
    [insights],
  );

  async function startCheckout() {
    setBusy("checkout");
    setMessage("");
    try {
      const href = window.location.href;
      const result = await httpsCallable(functions, "createBusinessProCheckout")({
        businessId,
        successUrl: href,
        cancelUrl: href,
      });
      const data = result.data as {url?: string};
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      setMessage("Payment session started.");
    } catch (rawError) {
      setMessage(rawError instanceof Error ? rawError.message : "Could not start payment.");
    } finally {
      setBusy("");
    }
  }

  async function generateInsights() {
    setBusy("advisor");
    setMessage("");
    try {
      await httpsCallable(functions, "generateBusinessInsights")({businessId});
      setMessage("Recommendations generated.");
    } catch (rawError) {
      setMessage(rawError instanceof Error ? rawError.message : "Could not generate recommendations.");
    } finally {
      setBusy("");
    }
  }

  const allCards = latestInsights.flatMap((insight) =>
    insightCards(insight).map((card, index) => ({ card, insight, key: `${insight.id}-${index}` })),
  );

  return (
    <section className="lst">
      <header className="lst-head">
        <div className="lst-head-text">
          <h2>Growth</h2>
          <p>Your plan, benefits, and AI recommendations for your business.</p>
        </div>
        <div className="lst-head-actions">{message && <span className="pur-kind">{message}</span>}</div>
      </header>

      {error && <div className="error-box">{error}</div>}

      <div className="grw-plans">
        <article className={`grw-plan ${plan === "free" ? "current" : ""}`}>
          <span className="grw-tier">Free</span>
          <strong>Your included tools</strong>
          <p>Listings, destinations, barrels, purchases, parking, transport, people, and support.</p>
          {plan === "free" && <span className="lst-badge ok" style={{ alignSelf: "flex-start" }}>Current plan</span>}
        </article>
        <article className={`grw-plan pro ${plan === "pro" ? "current" : ""}`}>
          <span className="grw-tier">Pro</span>
          <strong>AI advisor + lower fees</strong>
          <p>Get the AI advisor, deeper analytics, and reduced platform fees as you grow.</p>
          {plan === "pro" ? (
            <span className="lst-badge ok" style={{ alignSelf: "flex-start" }}>Active</span>
          ) : (
            <button className="lst-add" type="button" disabled={busy === "checkout" || !businessId || previewMode} onClick={startCheckout}>
              {busy === "checkout" ? <RefreshCw className="spin" size={16} /> : <BadgeDollarSign size={16} />} Upgrade to Pro
            </button>
          )}
        </article>
      </div>

      <div className="grw-advisor">
        <div className="grw-advisor-head">
          <div className="lst-empty-icon" style={{ margin: 0, width: 46, height: 46 }}><Sparkles size={22} /></div>
          <div>
            <strong>Business AI advisor</strong>
            <p>{aiAdvisorEnabled ? "Generate new recommendations from your latest business data." : "Available on the Pro plan — spots pricing, listing, and response issues and how to fix them."}</p>
          </div>
          <button className="lst-add" type="button" disabled={busy === "advisor" || !businessId || !aiAdvisorEnabled || previewMode} onClick={generateInsights}>
            {busy === "advisor" ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />} Generate recommendations
          </button>
        </div>

        {loading && <div className="lst-empty"><p><RefreshCw className="spin" size={16} /> Loading insights…</p></div>}
        {!loading && allCards.length === 0 && (
          <div className="lst-empty">
            <div className="lst-empty-icon"><Sparkles size={30} /></div>
            <h3>No AI insights yet</h3>
            <p>{aiAdvisorEnabled ? "Generate your first set of recommendations." : "Upgrade to Pro to unlock the advisor."}</p>
          </div>
        )}

        <div className="pur-grid">
          {allCards.map(({ card, insight, key }) => (
            <article className="pur-card" key={key}>
              <div className="pur-head">
                <div className="pur-title">
                  <strong>{text(card.title, "Recommendation")}</strong>
                  <span className="pur-kind">{formatDate(insight.createdAt)}</span>
                </div>
                <span className={`lst-badge ${severityTone(text(card.severity, ""))}`}>{statusLabel(card.severity)}</span>
              </div>
              {Boolean(text(card.finding, "")) && <div className="grw-finding"><b>Finding:</b> {text(card.finding, "")}</div>}
              {Boolean(text(card.recommendation, "")) && <div className="grw-reco"><b>Recommended action:</b> {text(card.recommendation, "")}</div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function severityTone(severity: string) {
  switch (severity.toLowerCase()) {
    case "high": case "critical": return "warn";
    case "medium": return "navy";
    default: return "muted";
  }
}

function insightCards(row: FirestoreRow) {
  if (!Array.isArray(row.cards)) return [];
  return row.cards.filter((item): item is Record<string, unknown> =>
    item !== null && typeof item === "object",
  );
}

function timestampMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "object" && "toDate" in value) {
    const candidate = value as {toDate?: unknown};
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate() as unknown;
      return date instanceof Date ? date.getTime() : 0;
    }
  }
  return Date.parse(String(value || "")) || 0;
}

function statusLabel(value: unknown) {
  const normalized = text(value, "unknown").toLowerCase();
  const labels: Record<string, string> = {
    critical: "Critical",
    high: "High",
    medium: "Medium",
    low: "Low",
    unknown: "Unknown",
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
