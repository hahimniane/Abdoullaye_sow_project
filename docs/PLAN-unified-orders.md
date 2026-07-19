# Plan — Unified "Orders" (everything a customer paid for)

Implementation spec. **No production code here — this is the design.** Reuse
existing patterns; follow the localization guardrail (§5) for every new string.

## Goal

Reframe **"Purchases"** (today: car purchases only) into **Orders** — one
type-tagged history of *everything a customer paid for*: car purchases, barrel
shipments, freight, car transport, parking, and future services. Filterable by
type and status, searchable, each row linking to its receipt/detail (and to
tracking for shipments). New services plug in as a new order type — never a new
history screen.

**Why now:** as the platform grows, "Purchases = cars" fragments. Three paid
services already have **no** customer history, and barrels only appear in the
logistics (Tracking) view, not as a receipt.

## Current state (customer-facing history)

| Paid service | Collection | Customer history today |
| --- | --- | --- |
| Car purchase | `carPurchases` (filter `buyerUid`) | ✅ `my_purchases_screen.dart` (only this) |
| Barrels | `barrelShipments` / `barrelOrders` (`customerUid`) | ⚠️ only in `tracking_screen.dart` (logistics) |
| Car transport | `transportRequests` (`customerUid`) | ⚠️ detail screen only, no list |
| Freight | `freightShipments` | ❌ none |
| Parking | `parkedCars` | ❌ none |

## Key distinction (do not merge these)

- **Order / receipt** = the *financial* record of a paid transaction (amount,
  business, date, status, refund). Every service produces one. This is the new
  Orders screen.
- **Tracking** = the *logistics* view of in-transit shipments
  (`tracking_screen.dart`). Stays as-is.
- They overlap on purpose (Amazon model): a barrel is an Order you can *also*
  track; a car purchase is an Order you don't track. Orders rows that are
  trackable deep-link into Tracking.

---

## The unified Order model (client-side view model)

A normalized value type the UI renders, built from any source collection:

```
CustomerOrder {
  String id;                 // source doc id
  OrderType type;            // car | barrel | freight | transport | parking | ...
  String title;              // "Toyota Camry 2018" / "2 barrels → Guinea"
  String subtitle;           // business name + key detail
  String? businessName;
  int amountCents;           // total paid (or quoted)
  String currency;           // "usd"
  OrderStatus status;        // normalized — see mapping
  DateTime createdAt;
  String sourceCollection;   // 'carPurchases' | 'barrelOrders' | ...
  String detailRoute;        // existing detail screen route + arguments
  bool trackable;            // true → also offer "Track" (barrels/freight/transport)
}
```

### Order types
`car`, `barrel`, `freight`, `transport`, `parking`. Reserve room for
`sharedBarrelShare` and `walletTopUp` (open question below). Each type carries an
icon + label (localized) and a color, mirroring the hub/card styling.

### Status normalization (per-type → one set)
Unify the many per-collection statuses into a small set the UI can filter on:
`pending`, `active`, `inTransit`, `completed`, `cancelled`, `refunded`.

| Source status (examples) | Unified |
| --- | --- |
| carPurchase `reserved` / hold pending | `pending` |
| carPurchase `paid` / `sold` | `completed` |
| barrel/freight `pending` / `pending_payment` | `pending` |
| barrel/freight `in_transit` | `inTransit` |
| barrel/freight/transport `completed` | `completed` |
| any `cancelled` | `cancelled` |
| parking active hold | `active` |
| refund issued | `refunded` |

Keep the mapping in one pure, unit-tested function per type
(`CustomerOrder.fromCarPurchase(...)`, `.fromBarrelOrder(...)`, etc.) so it is
testable without Firestore.

---

## Phase 1 — Client-side aggregation (no migration, ships the gaps now)

- **New `CustomerOrder` model** + per-source factories (pure, tested).
- **New `OrdersScreen`** (rename "Purchases" → "Orders" / "My orders"):
  - Reuse the **tracking redesign** patterns: search box, a **type** filter row
    (All · Cars · Barrels · Freight · Transport · Parking — only show types the
    user actually has), and a status segment. Default sensible (e.g. All, newest
    first).
  - Merge streams: `carPurchases(buyerUid)`, `barrelOrders(customerUid)` (or
    grouped `barrelShipments`), `freightShipments(customerUid)`,
    `transportRequests(customerUid)`, `parkedCars(customerUid)`. Combine into
    one `List<CustomerOrder>` sorted by `createdAt` desc.
  - Each row → its existing detail screen via `detailRoute`; trackable rows also
    offer a "Track" affordance into `tracking_screen`.
  - Empty + no-results states; pull-to-refresh.
- **Routing:** `/my-purchases` stays (back-compat) and points at `OrdersScreen`;
  add `/orders` alias. Update the Activity tab + balance card "My orders" link.
- **Localization:** every new string in `app_en.arb` **and** `app_fr.arb`, run
  `flutter gen-l10n` (guardrail §5).
- **Verify on device** (Definition of Done) — not just `flutter analyze`.

Caveat: merging 5 live Firestore streams client-side is fine at per-customer
volume. If a customer can have hundreds of orders, add per-source `limit` +
"load more". Don't prematurely paginate.

## Phase 2 — Server `orders` ledger (as the platform scales)

A single `orders` collection written by the payment/fulfilment functions at the
moment money moves, holding the normalized fields above plus payment + payout
data. Becomes the one source of truth for:

- Receipts and order history (the client stops fan-out reading 5 collections).
- Refunds and cancellations.
- **Business payouts** and platform-fee accounting (ties directly into
  `PLAN-barrel-multi-and-direct-payouts.md` — the Connect transfers).
- Customer spend analytics and **1099/tax** reporting.

`barrelOrders` already prefigures this. Backfill historical docs; keep the
client view model so the UI doesn't change when the source flips.

## Files (Phase 1)
- `lib/models/customer_order.dart` (new) + `customer_order.test`-style coverage.
- `lib/screens/orders_screen.dart` (new; replaces/rename `my_purchases_screen`).
- `lib/screens/customer_home_screen.dart` route builder + Activity tab link.
- `lib/l10n/app_en.arb` + `app_fr.arb` (+ `flutter gen-l10n`).

## Source reality (verified — affects Phase 1 scope)

- `carPurchases` (`buyerUid`), `barrelShipments` (`customerUid`),
  `freightShipments` (`customerUid`), `transportRequests` (`customerUid`) — all
  customer-attributable ✅ → included in Phase 1.
- `parkedCars` has **no `customerUid`** (staff-created for walk-ins) → **cannot**
  appear in a customer's Orders until it gains a customer link. Excluded from
  Phase 1; add `customerUid` on the parking create path to include it later.
- **Car purchases carry interactive flows** (viewings, holds, extensions) that a
  generic order row can't host. Keep `my_purchases_screen` as the car-purchase
  manager; Orders shows car purchases as read-only rows that **link to** it.
  Detail links by type: barrel → `/barrel-shipment-details`, transport →
  `/transport-request-details`, car → car-purchase manager, freight → (no detail
  screen yet; row is informational until one exists).

## Open questions (decide before Phase 1)
1. **Do wallet top-ups count as Orders?** Recommendation: **no** — they're money
   movements; keep them in Wallet. Orders = paying a business for goods/services.
2. **Shared-barrel shares** — treat as a `barrel` order, or its own type?
   Recommendation: a `barrel` order with a "shared" badge.
3. **Label:** "Orders" vs "My orders" vs keep "Purchases" wording. Recommendation:
   "Orders" (clear, scales).

## Relationship to other plans
- Tracking redesign (shipped): logistics view; Orders links into it.
- `PLAN-barrel-multi-and-direct-payouts.md`: the Phase 2 ledger is where payout +
  fee accounting lives.
