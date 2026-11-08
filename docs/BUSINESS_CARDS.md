# Business cards

A card for every business on Laawol and for each person on its team: a page
that opens when the card's QR is scanned, and a sheet of ten to print. Asked
for by the owner on 2026-11-05 and designed with him the next day (the white
card, then the full-color card from the Keren Auto Sales kit).

## 1. Decisions

1. **Who gets a card.** Every business, and each person on its team (the
   owner and current staff). Free; no service has to be switched on.
2. **What a scan opens.** A page in the browser, no app and no sign-in:
   the card, Save contact, a call and a WhatsApp button for each number, and
   the ways to do business with the shop (send a package and see prices,
   track a package, the website).
3. **Both numbers.** The person's own number ("Direct") and the business's
   ("Office"). The business's own card has its number only.
4. **No role or title** is ever printed.
5. **Nothing is copied onto a card.** The QR carries a code and nothing
   else; every scan reads the person and the business as they are now. A
   changed number is right on every card already printed.
6. **A person who left** (no longer staff of that business, or a blocked
   account) shows the business alone on the same code. Their printed cards
   keep working for the business and say nothing about them.
7. **Names get their capitals.** A name typed all in capitals or all in
   small letters is printed with a capital per word; a name with its own mix
   of cases is left alone (`cardName`).
8. **Two styles**, the owner's choice: `classic` (plain white, the default)
   and `signature` (the business's two colors, up to six services on the
   back, an optional stock picture). Colors come from fixed lists, each
   checked for contrast, so no card can be unreadable.
9. **Who sees which cards in the console.** The owner, an admin and staff
   who may see People get every card. Other staff get the business's card
   and their own, because a card carries a colleague's own number. Only the
   owner (or an admin) changes the look.
10. **Print.** US business card, 3.5 x 2 in, ten to a US Letter sheet (two
    across, five down), side 1 on the first page and side 2 on the second,
    cut marks in the margins. Text stays 1/8 in inside every edge.

## 2. The code and the link

- A card is `businessCards/{code}`: `{businessId, uid}`; `uid` is `""` for
  the business's own card. The code is eight characters of the tracking
  alphabet (no 0/O, 1/I/L, no vowels): 378 billion codes, so a code cannot be
  guessed under the scan rate limit (60 a minute per address).
- `businessCardOwners/{businessId}_{uid|business}` holds the one code of a
  person, written in the same transaction as the card, so two calls at once
  can never give one person two codes.
- Both collections are server-only (`firestore.rules`).
- The printed link is `https://laawoldigital.com/c/<code>`. **It must never
  change: printed cards are forever.** `public_site/.htaccess` sends it to
  `customer.laawoldigital.com/c/<code>`, and `admin_web/public/.htaccess`
  to `/?service=business-card&c=<code>`. The app does not claim `/c/`: a
  customer's camera opens the browser.

## 3. Server

One callable, `businessCards`, routes on `data.action` (one Cloud Run
service, one instance). Rules in `business_cards.js`, Firestore in
`business_cards_handlers.js`.

| action | who | what |
| --- | --- | --- |
| `get` | anyone, no sign-in | `{found, card}` for a code: an allowlist (`publicCard`), never a document. Only an approved business. |
| `list` | the team | The business's cards, minting any missing code. |
| `saveSettings` | owner, admin | `businesses/{id}.card`: style, color, accent, photo, tagline, services. |

A card never carries an email, a role, a permission or a uid.

## 4. Web

- `lib/business-card.ts`: everything with no drawing in it (codes, phones,
  the words on a card in English and French, the vCard, the QR path). It
  mirrors the server's lists; `business-card.test.ts` fails when they drift.
- `components/business-card-face.tsx`: one side of a card. Every size is a
  share of the card's own width (`cqw`, `.bcard` in `globals.css`), so the
  page, the console and the print sheet draw the same card.
- `components/business-card-page.tsx`: the page a scan opens (a branch of
  `/`, service `business-card`).
- `components/business/business-cards-panel.tsx`: the console tab "Business
  cards" (group Business, no permission), the owner's look form and the
  print sheet. While the sheet is open, printing the page prints only the
  sheet (`body.bcard-printing`).
- The words printed on a card are the business's own data and are set in
  the page's language by the face component; they never go through
  `french-dom.ts`. The pages' own words do.
- Stock pictures live in `admin_web/public/card-art/`.
- **Embed mode** (`&embed=1`, `cardEmbedFromSearch`): the page draws only the
  card face and "Turn the card over" on a transparent background, in the
  language of `&lang=fr|en`, and tells the app on the `LaawolCard` WebView
  channel (`ready` once painted, `error` when the card is missing or
  unreadable). The normal page is unchanged. The app's My card screen shows
  `https://customer.laawoldigital.com/?service=business-card&c=<code>&embed=1&lang=<en|fr>`
  in a WebView (`embedded_business_card.dart`), so the phone shows the same
  card people are handed. No `ready` in 15 s, a page error, or no WebView on
  the platform keeps the app's own `BusinessCardFace`. The app must be
  built against a website that already has embed mode.

## 5. Wallet passes

A team member can add their own card to Apple Wallet or Google Wallet. The
signing is ported from the Wouri member card (`wouri-app/functions/src/
services/appleWallet.ts`, `googleWallet.ts`). Code: `business_card_wallet.js`
(pure), the `mine` and `wallet` actions in `business_cards_handlers.js`, and
the `view=card-pass` branch of `parkingDocument` in `index.js`.

**What is on a pass** (built from `publicCard()`, so only what the public
page shows; never an email, role, permission or uid):

- Apple (generic pass): the business's name (organization and logo text), the
  person's name (the business's name on the business's own card), "Direct"
  and "Office" numbers in US format, the card's color with white text, the
  business logo (a fetchable https image on a storage or Laawol host) or the
  bundled Laawol mark (`functions/assets/laawol-mark.png`). Back: address,
  website, services, the card link. A QR (`PKBarcodeFormatQR`) of
  `https://laawoldigital.com/c/<code>`. Serial `laawol-card-<code>`, team
  `GRKB7BXVZK`. French labels in `fr.lproj`.
- Google (generic pass): the same, inside a signed "Save to Google Wallet"
  JWT that carries the class (`<issuer>.laawol_card`) and the object
  (`<issuer>.laawol_card_<code>`), so no call to Google's API is made. Google
  limits the link to about 1800 characters, so a long card drops its extras
  in order (services, website, address, Office line, own logo, finally
  shortens names); the QR always opens the full page.

**Static.** No `webServiceURL`, no push: a number changed later is not
pushed to a pass already saved. The QR opens the live page, which is always
right. (The Wouri registration/push endpoints were left out on purpose.)

**Actions** of `businessCards` (signed in; owner or current staff of their
own business; `businessId` is optional and can only name their own; refused
with `details.reason` `not_team_member` otherwise):

| action | answer |
| --- | --- |
| `mine` | `{version, code, url, card, wallet: {apple, google}}`: `card` is the same object a scan returns; the code is minted by the same race-safe mint as `list`. |
| `wallet` + `platform: "google"` | `{version, platform, url}`: the Save link. |
| `wallet` + `platform: "apple"` | `{version, platform, url, expiresInSeconds: 600}`: a ten-minute link to `parkingDocument?view=card-pass&t=<token>`; open it in the browser and iOS offers Add to Wallet. |

`wallet` refuses with `wallet_not_ready` while that wallet's secrets are unset
and `business_not_approved` before the business is approved. The link's token
is `base64url({c: code, e: expiry}).hmac`; the HMAC key is derived from
`APPLE_PASS_KEY_PEM`, so there is no extra secret. A bad, tampered or
expired token, or a card that no longer shows, is the usual 404.

**Secrets** (Secret Manager; each may hold `unset` until the real value
exists, which reads as "not set up" and hides the wallet buttons):
`APPLE_PASS_CERT_PEM`, `APPLE_PASS_KEY_PEM`, `APPLE_PASS_TYPE_ID`,
`APPLE_WWDR_PEM` (bound to `businessCards` and `parkingDocument`),
`GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SA_KEY` (service account key JSON;
`businessCards` only). All six must exist in the project before either
function deploys, even as `unset`.

## 6. Share as a picture

Share sends the card itself, not only its link: one JPEG of both sides of
the real card (1150 x 1340 CSS px at 1.5x, about 400 KB) on a soft
background, with the link as the message under it, so WhatsApp shows the
card.

- **Drawing.** `components/business-card-snapshot.tsx` mounts both
  `BusinessCardFace` sides off screen at print size only while a picture is
  made, and draws them with `modern-screenshot` (`lib/card-image.ts` holds
  the sizes, the file name `<name>-card.jpg` and the message). It always
  settles within 15 s.
- **The logo.** Storage does not let a page draw its images, so the picture
  reads the logo from `parkingDocument?view=card-logo&c=<CODE>` (straight at
  the function; the `/d` redirect has no CORS header). It answers only for
  a card the public page would show, only the business's own logo through
  the same host allowlist and size cap as the wallet passes, with
  `Access-Control-Allow-Origin: *`. A logo that cannot be read is left blank.
- **Web.** "Share card" on the console's card list and on the public card
  page: the phone's share sheet where the browser can share files, else a
  downloaded picture. A browser that wants a fresh tap after the picture is
  made gets "Picture ready: tap to share".
- **App.** My card's Share runs `cardEmbedImageScript` in the embedded card
  page, which answers on the `LaawolCard` channel with `image:<base64>` or
  `image-error`; the app shares the file with the link as its text. When the
  real card is not on screen (loading, or the app's own fallback card), the
  page cannot draw it, or 20 s pass, Share sends the link alone.

## 7. Not built yet

- A print-shop file with bleed.
- Letting the owner hide a person's own number.
