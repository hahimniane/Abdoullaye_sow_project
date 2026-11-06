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

## 5. Not built yet

- The app's "My card" screen, and Apple Wallet / Google Wallet copies (the
  Wouri member card in `~/Downloads/wouri-app` is the model).
- A print-shop file with bleed.
- Letting the owner hide a person's own number.
