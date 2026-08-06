# PLAN — Owner backlog, 2026-08-05

Seven items dictated by the owner. These are product decisions, not
suggestions. Work them in the order below unless the owner says otherwise.

## 1. Address entry: real suggestions, split fields, optional apartment

Today the customer address input only accepts a suggested address as one
opaque string, and an apartment/unit number is often lost.

Wanted:
- Suggestions as the customer types (already exists in places via
  `suggestPickupAddresses`) but applied consistently.
- Choosing a suggestion POPULATES SEPARATE FIELDS: street, city, state,
  ZIP/postal code, country.
- **Apartment / unit is its own optional field** and is never dropped.
- The customer must not be forced to accept a suggestion verbatim.

## 2. Business changes must reach customers without a reload

Turning a service off (e.g. pickup) does not show up on the customer side
until the page is reloaded. Customer-facing reads of business/service state
must be live subscriptions, not one-shot fetches, on web and mobile.

## 3. Remove the wallet — the platform no longer holds anyone's money

No wallet balance, no "use wallet balance" option, no wallet top-ups, in any
client or callable, for this version. Money moves through Stripe (or
business-direct methods, see #5), never a platform-held balance.

## 4. Customer-facing tracking, Amazon/eBay style — plus real notification links

- A customer must be able to TRACK an item, most importantly freight, with a
  visible progression of stages and dates.
- Businesses enter the tracking information as it becomes available.
- **Clicking a notification (web especially) currently lands on Home.** It
  must deep-link to the exact record the notification is about.

## 5. AI support for businesses, with guardrails + business-entered parking

- The AI support assistant must be available to BUSINESSES, not only
  customers, and must be able to TAKE ACTIONS on the business's behalf.
- Guardrails: it confirms with the user before any important action.
- Parking: a business can create a parking entry itself. After entering the
  car's details, the business chooses HOW IT GETS PAID:
  - the customer pays the business directly (e.g. Zelle), or
  - the customer is sent a Stripe payment link so the platform bills them.
  To send the link, the business supplies the customer's phone/email.

## 6. Auto-select the only available business

In air freight (and anywhere else this pattern appears): when a chosen
destination country has exactly ONE business serving it, select that
business automatically instead of making the customer pick from a list of
one.

## 7. Remember recipients

Remember who a customer has sent to (cars, packages, barrels — any service).
When they start typing a recipient name on a later shipment, offer the saved
recipient profile to complete the rest (phone, address, country).

## Status

- [ ] 1 address fields
- [ ] 2 live business updates
- [ ] 3 remove wallet
- [ ] 4 tracking + notification deep links
- [ ] 5 business AI actions + business parking entry
- [ ] 6 auto-select single business
- [ ] 7 recipient memory

Every item ships on BOTH web and mobile, and is tester-verified on the real
interface before it is called done (docs/ENGINEERING_GUARDRAILS.md).
