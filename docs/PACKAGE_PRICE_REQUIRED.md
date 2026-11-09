# Package price required

Decided by the owner on 11/9/2026: every business must enter a price on every
package. Laawol's bill to a business can be a share of its package prices
(Bills: "% of the package price, with a minimum"), so a package saved without
a price bills nothing.

## The rule

A **customer's** package (`ownerKind: "customer"`, any kind but `car`) can't
be saved, edited or received unless:

1. **Every piece has a price typed in.** $0 is allowed on a piece, so a bundle
   can be priced on one piece.
2. **The pieces add up to more than $0.** The pickup fee is not a package
   price and doesn't count.

The business's own stock (`ownerKind: "stock"`) and cars are not affected.
Packages already saved without a price stay as they are. They have to be
priced the next time someone edits what they are (a contacts-only edit still
works).

## Error codes

| Where | Code | English message |
|---|---|---|
| Add / edit a package, waiting package (`container_manifest.js`) | `piece_price_required` | Enter a price for every piece. |
| same | `package_price_required` | Enter the package's price: more than $0. |
| Receive a customer request (`request_receive.js`) | `price_required` | Enter a price for every piece. |
| same | `package_price_required` | Enter the package's price: more than $0. |

Old-style lines (no `pieces`, `kind: barrels/other`) with no `priceCents`
return `package_price_required`. A price typed wrong keeps its own error
(`piece_price_invalid` / `price_invalid`), with no extra "required" error on
top.

## The pure rule

`piecePriceRequiredErrors(pieces)` in `functions/line_pieces.js`, mirrored in
`admin_web/src/lib/line-pieces.ts` and `my_flutter_app/lib/services/line_pieces.dart`.
The shared cases in `functions/test/fixtures/line-pieces-cases.json` pin all
three. It returns `[]`, `["piece_price_required"]` or
`["package_price_required"]`. An empty list returns `[]`, since that's
`pieceErrors`' job.

## Clients

The web console and the app check this before sending, so staff see the
problem on the form:
- the price field on each piece is marked required;
- each code has a message in English and French;
- the old "price every piece, or none of them" wording is gone.
