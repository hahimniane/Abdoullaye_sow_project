# App new look

The owner approved the phone app's redesign on 2026-11-17 ("Build"), after
every screen was drawn first on the design canvas ("Laawol App Redesign").
This is what was approved and the order it is built in. Features do not
change: every field, button and rule each screen has today stays.

Not approved yet, so NOT built (they were marked as proposals on the canvas):
customer tracking with pickup address / photos / receipt, a customer "My
parked car" screen, a "Record payment" button on Fleet payment rows, and
cutting the shop home down.

## The look (one design with the website and the web consoles)

| Thing | Value |
| --- | --- |
| Typeface | Plus Jakarta Sans, weights 400/500/600/700, nothing under 12 |
| Text | `#222222`; secondary `#5e5e5e`/`#6a6a6a` (never a lighter grey for text) |
| Ground / cards | `#f7f7f7` ground, white cards, 1px `#ebebeb` hairline, radius 16 |
| Brand colour | Logo navy `#032346` only (primary buttons, selected tab, links); tint `#e8edf4` with `#c9d3e0` border |
| Meaning colours | amber = needs attention / not paid, green = paid / money in, red = a problem or a destructive action. Never decoration |
| Buttons | 50 high, radius 14, navy fill + white text (primary) or white + `#dddddd` border (secondary) |
| Fields | white, `#dddddd` border, radius 12 |
| Icons | outline, no tinted squares behind them |
| Never | gradients as decoration, a card inside a card, coloured left borders, emoji, content touching a card's edge (16 inner padding) |

All of it lives in `lib/theme/` (`AppColors`, `AppTypography`, `AppSpacing`,
`AppTheme`). A screen takes its colours, type and radii from the theme; a
hard-coded colour or radius in a screen is a bug.

## Stage 1 - the theme (done)

The palette, typeface, radii, buttons, fields, cards, chips, sheets and the
tab bar moved to the table above, for every screen at once. No layout moved.

## Stage 2 - Home, More, Parked cars

Owner rules (2026-11-15): "The home page should not look very complicated.
It should not show things that are not related to that business."

### H1. Home = the business's main work, then a few places

A business home is, top to bottom:

1. Header: business name, notification bell, language switch.
2. One loud button: the main work's action (`HomePrimaryAction`).
3. Three numbers for the main work, each opening its list.
4. For parking only: "Latest cars", the three most recent parked cars, with
   "See all" opening Parked cars.
5. The few places that work uses every day (`HomeDestinationGroup`).
6. Each OTHER service the business has, as a small block: its name as a
   section label and one or two rows (never its numbers or its feed).
7. Money: Invoices & receipts, Staff balances.
8. One "More" row.

| Main work | Button | Three numbers | Daily places |
| --- | --- | --- | --- |
| Parking | Record a parked car | In the lot, Not paid, Owed | Lot ledger |
| Shipping | Register a package | Requests, Packages here, On the way | Containers, Deliveries (when allowed) |
| Shop | Sell | today's Sales, Revenue, Items sold | (the shop home section as it is today) |
| Car sales | Add a car | Listed, Reserved, Sold this month | Purchases & viewings |
| Car transport | (none) | Open to bid, Your quotes, Won jobs | Transport jobs |

Small block of a service that is not the main work:

| Service | Rows |
| --- | --- |
| Parking | Parked cars ("N in the lot · M not paid"), Record a parked car |
| Shipping | Register a package, Packages here, Containers |
| Shop | Sell, Products |
| Car sales | Cars for sale, Purchases & viewings |
| Car transport | Transport jobs |

A person only ever sees what the existing gates allow them (the same
`_businessDestinations` rows, taken **by key**; never a second copy of a
gate). A parking lot sees no shipping; a shipper sees no parking.

### H2. Which work is the main one

One value per business, `businesses/{id}.mainWork`, one of `parking`,
`shipping`, `shop`, `carSales`, `transport`. Set by the owner (or Laawol) on
Business profile, under Services: "Main work", listing only the services the
business has switched on; hidden when it has one service. Never guessed from
activity.

Pure rule, `lib/services/business_home.dart`:

```dart
enum HomeWork { parking, shipping, shop, carSales, transport }

/// The works this person can do here, in the default order.
List<HomeWork> homeWorks({...the existing gates, passed in as booleans...});

/// The stored choice when it is one of [works]; otherwise the first of
/// [works] in the default order (what the home led with before the setting
/// existed: shop for whoever may sell, then parking, shipping, car sales,
/// transport).
HomeWork? mainHomeWork(List<HomeWork> works, String? stored);
```

Until a business has the value, its home leads with what it led with before.
Keren is Parking, Nensona is Shipping (owner, 2026-11-15).

### H3. Parked cars is its own screen

Everything the home's parking feed has today moves, unchanged, to a "Parked
cars" screen: list/cards switch, search, the kind and payment chips, "Parked
between", the scoreboard, the lot strip, the rows, "Load history", and a
"Record a parked car" button. The home keeps only the three numbers and the
latest three cars. The feed's subscriptions move with it (one owner of the
feeds; the home reads only the small figures it shows).

### H4. More

A "More" screen holds what left the home: Today, Month end, Parking lots,
Business profile, Services & coverage, Offices & pickup points, People,
Reviews, Support inbox, Team cards, Getting paid, Growth, Fleet, the
assistant and "Open business console" - each only when today's gate shows
it. Rows are grouped in white cards.

### H5. Tabs

Business tab bar: Home, Business, Support, Settings. Cars and Purchases
leave the bar (they are reached from Home or More when the business sells
cars). The selected tab is navy; no filled pill.

## Stage 3 - screen by screen

Each remaining screen is brought to its board on the canvas (layout and
grouping only), in the order staff use them: record a parked car, a parked
car, lot ledger, month end, register a package, packages here, requests,
containers, deliveries, invoices, settings, support, team, shop, cars,
transport, Fleet, then the customer side.

## Rules for every stage

- EN + FR for every string (`app_en.arb` and `app_fr.arb`, key for key, then
  `flutter gen-l10n`). Key names never contain "payback" or "coverage".
- Keep pure rules in `lib/services/` with unit tests; widget tests for the
  screen; a regression test for every bug fixed.
- Nothing reaches phones without a store build, submitted only on the
  owner's word, after the changed screens were run on the simulator in
  English and French.
