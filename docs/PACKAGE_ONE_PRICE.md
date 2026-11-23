# One price for the whole package

Owner, 2026-11-23 (asked for Nensona Auto Sales and Shipping). Builds on the
pieces editor (docs/WAITING_PACKAGES.md "Pieces",
docs/PACKAGE_PRICE_REQUIRED.md).

## Decisions (owner)

1. A business chooses how it prices a package:
   - `piece` (default for every business, existing and new): today's form.
     A price on each row of pieces, a row of several priced "Each piece" or
     "All N together" (shared inside that row only: owner rule 2026-11-16,
     unchanged).
   - `package`: staff type **one price for the whole package**. No price on
     a piece or a row, no "Each / All together" switch. Adding a piece later
     never asks for that piece's price: the one price field is still the
     only one, kept as it was until staff change it.
2. The setting is per business. On for Nensona only at first. The business
   owner or a Laawol admin changes it.
3. Behind the form the one price is **shared equally among the pieces**
   (odd cents on the first ones), so every piece still stores a
   `priceCents`. Labels, receipts, payments, tracking, splits across
   containers and the business's bill to Laawol read what they read today.
   The bill is NOT changed: under a percent deal each box / other piece is
   billed on its equal share (owner chose this over billing the package
   total).

## Data

- `businesses/{id}.packagePriceSettings.mode`: `"piece"` | `"package"`.
  Missing = `"piece"`. Also `updatedByUid`, `updatedAt`.
- Nothing new on a line. A line never says how it was typed: the business's
  mode decides which form opens it.

## API (server)

`setPackagePriceMode {businessId, mode}` -> `{success, mode}`. Owner of the
business or a Laawol admin (the same check as `setPackageReceiptMode`);
anyone else `permission-denied`; any other value `invalid-argument` with
`details.reason: "invalid_price_mode"`.

Saving a line is unchanged: the form still sends `pieces[]` with a
`priceCents` each (`addWaitingPackage`, `addContainerLine`,
`updateContainerLine`, receiving a request). The server does not know the
mode when it saves a line.

## The one rule (shared by server, console and app)

`packagePiecePrices(totalCents, ids, stored)` in
`functions/package_price_mode.js`, mirrored in
`admin_web/src/lib/package-price-mode.ts` and
`my_flutter_app/lib/services/package_price_mode.dart`. The three run
`functions/test/fixtures/package-price-cases.json` and must give exactly
`expected`.

- `totalCents`: the one price typed, in whole cents; `null` when none is
  typed. The pickup fee is never part of it.
- `ids`: the pieces' ids in the order of the form, `""` for a new piece.
- `stored`: the pieces as saved (`[{id, priceCents}]`) when editing, else
  `null`.
- Result: one price per piece. `distributeCents(totalCents, n)`, except
  when the pieces are exactly the stored ones (same ids, same order, each
  with a price) and the total equals the stored sum: then the stored prices
  are returned untouched. So opening an old package that was priced item by
  item and saving it without touching the price or the pieces changes
  nothing; a piece added, removed or moved, or a new total, shares the total
  again among all the pieces.
- No total (blank, not whole cents, negative): every piece `null`.

## The form in `package` mode

Everywhere the pieces editor is used for a package: Register a package,
editing a waiting package, the line form on a container, receiving a
customer's request (console: `PiecesEditor`; app: `PiecesEditor` in
`pieces_editor.dart`).

- Each row: what it is (Barrel / Box / Other), what is in it, the optional
  size, "How many". **No price field, no "Each piece / All N together"
  switch, no row sum.**
- Rows when a saved package is opened: pieces that follow each other and
  read the same (kind, description, size) are one row with its "How many",
  **whatever their prices** (in `piece` mode the prices also have to be an
  even share; here they are ignored).
- After the rows and "Add another piece": one field, visually the strongest
  thing in the block:
  - label **"Price for everything ($)"** / **"Prix pour le tout ($)"**, with
    the required mark when the package is a customer's;
  - under the label, the count: **"3 pieces, one price"** /
    **"3 pièces, un seul prix"** ("1 piece" / "1 pièce" for one);
  - prefilled, on an edit, with the sum of the stored piece prices (blank
    when no piece has a price).
- When the number of pieces differs from what is saved (edit only), a note
  under the field, in the warning tone:
  - more: **"You added 1 piece. Still $300.00 for all 4? Change it here if
    not."** / **"Vous avez ajouté 1 pièce. Toujours 300,00 $ pour les 4 ?
    Sinon, modifiez-le ici."** (plural: "2 pieces" / "2 pièces")
  - fewer: **"You removed 1 piece. Still $300.00 for the 2 left? Change it
    here if not."** / **"Vous avez retiré 1 pièce. Toujours 300,00 $ pour
    les 2 restantes ? Sinon, modifiez-le ici."**
  - no note while the price field is blank, and none once another price
    than the saved one is typed (the question is "still the same price?").
  The existing "print the labels again" note stays as it is.
- No separate "Total" line beside the rows: the price field is the total.
  With a pickup fee the total line (price plus fee) stays.
- The pickup fee (a collected request) keeps its own field. The total line
  is the price plus the fee, as today.
- Problems, shown at the price field (same wording as today's messages):
  - a customer's package with the field blank or $0: `package_price_required`;
  - unreadable or negative: `piece_price_invalid`;
  - not a customer's package (the business's own stock): blank is allowed,
    the pieces are saved with no price.
- What is sent: `pieces[]` as today, each with
  `priceCents = packagePiecePrices(total, ids, stored)[i]`.
- Receiving a customer's request with an estimate: the field is prefilled
  with the estimate's total (the sum of the pieces' estimates, without the
  pickup fee) when every piece has one, else blank. The customer's own
  estimate page still shows a price per item.

## The setting

Console: Shipping -> Requests -> Request settings (owner only), a radio
pair beside "Package receipts":

- **"Package price"** / **"Prix d'un colis"**
- "A price for each item" / "Un prix par article"
- "One price for the whole package" / "Un seul prix pour tout le colis"
- hint: "With one price, staff type a single amount for everything the
  customer drops off. It is shared equally among the pieces." / "Avec un
  seul prix, le personnel saisit un seul montant pour tout ce que le client
  dépose. Il est réparti également entre les pièces."

App: the same card in Package request settings.

## What does not change

`piece` mode, anywhere. The server's line validation
(`piecePriceRequiredErrors`: every piece has a price, the pieces come to
more than $0). `setContainerLinePrice` (already shares a changed total
equally). The bill to Laawol (`platform_billing.js`).

Known and accepted: a package split across containers shows each part at
its equal share; adding a piece to one part shares that part's price among
that part's pieces only; a phone still on an older app build shows the
per-row form for a `package` business (the totals stay right).

## As built (2026-11-23)

- Console: `lib/package-price-mode.ts` (mode, rule, the setting's words),
  the one-price helpers in `lib/piece-drafts.ts` (`PiecePricing`,
  `packagePricingOf`, `onePriceFromLine`, `storedPiecePrices`,
  `onePriceChangeNote`...), `PiecesEditor` props `priceMode`, `onePrice`,
  `onOnePriceChange`, `storedPriceCents`. The mode is read once in
  `ContainersPanel` (`packagePriceModeOf(business)`) and passed down; a form
  draft carries `priceMode`, `onePrice` and, on an edit, `storedPieces`.
- App: `lib/services/package_price_mode.dart`, `PiecesEditorController`
  (`priceMode`, `isEdit`, `packagePriceCents`), the mode read with the proof
  settings (`PackageProofSettings.packagePriceMode`), the card
  `PackagePriceModeCard`. In `package` mode the app hides "From the price
  list" and ignores weight snapshots at Received (both write a row price).
- One piece left after a removal reads "for the piece left" / "pour la pièce
  restante" (console), "pour celle qui reste" (app).
- Checked in a browser on the emulators (register, edit with a piece added
  and removed, an old item-priced package left alone, money received, a
  container line, the Received dialog's prefill, French, 371 px). Not
  checked there: pressing Received on a request, a line of several pieces on
  a container, the app on a simulator.
