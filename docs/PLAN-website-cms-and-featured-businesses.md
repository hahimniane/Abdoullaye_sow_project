# Plan — Website CMS + Featured Businesses

Implementation spec for another AI/engineer. **No code is written here — this is the design.**
It builds on patterns already in this repo; reuse them, don't reinvent.

## Goals
1. **Editable website content** — admins edit parts of the public marketing site
   (hero copy, taglines, contact details, section headings) from the admin
   console, with no redeploy.
2. **Featured businesses on the site** — show a *curated subset* of registered
   businesses (logo + name + short blurb) on `laawoldigital.com`. **Never expose
   the total number of businesses** — only the hand-picked, approved ones.
3. **Featuring workflow** — a business must provide the required assets (logo,
   display name, short blurb, consent) before it can be featured; an admin
   reviews and approves.

## Key constraint (privacy)
The public must not be able to infer how many businesses exist. Therefore the
public site reads from a **separate, curated `featuredBusinesses` collection**
that contains only approved, marketing-safe records — **not** the private
`businesses` collection (which stays admin-gated as it is today).

---

## Architecture

The marketing site stays **static HTML on Hostinger** (`public_site/`) but
becomes "content-aware": a small client-side script fetches public content from
Firebase and injects it, with a **graceful fallback to the current hardcoded
copy** so the site never breaks if the fetch fails. Admin edits write to
Firebase; the site reflects them on the next page load with uncached Firestore
fetches. No rebuild/redeploy for content.

Reuse what exists:
- Firebase project `car-selling-flutter-app` (public web config already embedded
  in `public_site` is fine for read-only public collections).
- The `platformConfig/general` settings doc and the Settings UI built in
  `admin_web/src/components/admin-console.tsx` (`MoreSettings` component) —
  extend the same pattern.
- The dynamic RBAC system (`EDITABLE_SECTIONS`, `resolvePerms`, the
  `platformConfig/permissions` matrix, and the backend
  `ADMIN_ROLE_CAPABILITIES` / `SECTION_TO_CAPABILITY` in
  `my_flutter_app/functions/index.js`). Add a new **"Website"** section/capability.
- Admin is served from `https://admin.laawoldigital.com/` on Hostinger. The
  older `/admin` path is not the canonical admin URL.

---

## Data model (Firestore)

### `websiteContent/home`  (public read, admin write)
Editable marketing copy. Suggested shape:
```
{
  hero: { eyebrow, headline, subheadline, primaryCtaLabel, primaryCtaHref },
  featured: { enabled: bool, heading, subheading, maxToShow: number },
  sections: { servicesIntro, ... }   // any additional editable blocks
  updatedAt, updatedBy
}
```
Contact details (email/phone/whatsapp/address) already live in
`platformConfig/general.branding` — make that doc public-readable too and have
the site read it, instead of duplicating.

### `featuredBusinesses/{businessId}`  (public read, admin write)
Curated, marketing-safe cards only. **No internal/financial fields, no counts.**
```
{
  businessId, displayName, logoUrl, blurb (<=140 chars),
  services: string[], city, country, websiteUrl?,
  order: number, active: bool,
  approvedBy, approvedAt, updatedAt
}
```

### `businesses/{id}` — add fields to drive the workflow (private, admin-gated)
```
logoUrl / profileImageUrl (already exists),
marketingBlurb,
featureConsent: bool,
featureStatus: "none" | "requested" | "approved" | "declined",
featureNote (admin feedback when assets are missing)
```

### Firebase Storage
- Logos at `businessLogos/{businessId}.<ext>` → public download URL stored in
  `featuredBusinesses.logoUrl`.
- Storage rules: **public read** for `businessLogos/**`; write by the owning
  business or an admin.

---

## Security rules (`my_flutter_app/firestore.rules`)
- `match /websiteContent/{doc}` → `allow read: if true;` `allow write: if`
  admin has the **website** capability (or `isAdmin`).
- `match /featuredBusinesses/{id}` → `allow read: if true;` `allow write:`
  admin-with-website-capability only.
- Make `platformConfig/general` readable publicly **only if** it's safe; if it
  holds anything sensitive, instead mirror just the public branding fields into
  `websiteContent/contact`. (Recommended: a small public `websiteContent/contact`
  doc, keep `platformConfig/general` admin-only.)
- `businesses` stays as-is (admin-gated) — do **not** open it.

---

## Featuring workflow
1. **Business provides assets.** Two entry points (do at least the admin one
   first; the app one can come later):
   - *Admin-on-behalf:* admin uploads the logo + writes blurb in the console.
   - *Business self-serve (later):* business owner uploads logo + blurb + ticks
     consent in the mobile app (`my_flutter_app`), setting
     `featureStatus="requested"`.
2. **Admin review queue.** A "Featuring requests" list (status == requested)
   in the admin. Admin validates required assets are present.
3. **Validation gate.** Cannot approve unless: `logoUrl`, `displayName`,
   `blurb`, ≥1 `service`, and `featureConsent == true`. If missing, set a
   `featureNote` and leave status `requested`.
4. **Approve → publish.** Writes/updates `featuredBusinesses/{id}` (active=true,
   order), sets `businesses/{id}.featureStatus="approved"`.
5. **Manage.** Reorder, toggle `active`, edit blurb/logo, or remove (unpublish
   deletes the public doc and sets status back to "none").
6. **Auto-unpublish** (trigger): if a business is suspended/deleted, remove it
   from `featuredBusinesses`.

---

## Admin console UI (`admin_web/src/components/admin-console.tsx`)
Add a new top-level nav section **"Website"** (new `Tab`, nav group "System" or
its own), gated by the new **website** capability in the RBAC matrix. Two panels:

1. **Content** — forms bound to `websiteContent/home` (+ contact): hero
   eyebrow/headline/subheadline/CTA, featured section heading + toggle + max,
   editable section copy. Same save pattern as `MoreSettings` (per-panel Save →
   `setDoc(..., {merge:true})`). A "View site" link.
2. **Featured businesses** —
   - Requests queue (status == requested) with the missing-asset checklist.
   - "Add featured business": pick a registered business (from the existing
     `businesses` data the admin already loads), prefill name/logo, set blurb +
     order, validate, publish.
   - Approved list: reorder (drag or up/down), toggle active, edit, remove.
   - Reuse the existing card/table styling, the inline-confirm pattern used for
     role delete, and image upload helpers already used by `AdminAccountPanel`
     (Firebase Storage `uploadBytes` + `getDownloadURL`).

### Settings vs Website
- **Settings** keeps internal platform/app defaults: platform name, tagline,
  admin/app support defaults, barrel pricing, destination defaults, notification
  defaults, integrations, and role/permission management.
- **Website** owns public marketing content: homepage copy, public contact
  details shown on the static site, featured-business curation, review, publish,
  reorder, active toggle, and removal.
- Do not make `platformConfig/general` public just to power the website. Public
  contact fields belong in `websiteContent/contact`.

### RBAC change
Add `{ tab: "website", key: "website", cap: "website", label: "Website" }` to
`EDITABLE_SECTIONS` (client) and mirror in the backend:
`SECTION_TO_CAPABILITY.website = "website"`, add `"website"` to the relevant
default roles + super admin, and to the `AdminCapability` union. Gate the new
Website tab + its mutations by `perms.can("website")`.

---

## Marketing site (`public_site/`)
- Add `assets/content.js` (loaded after `script.js`) that:
  - Reads `websiteContent/home`, `websiteContent/contact`, and
    `featuredBusinesses` (where `active==true`, `orderBy(order)`,
    `limit(maxToShow)`), using the Firebase Web SDK or Firestore REST with the
    public read rules.
  - Injects hero copy / contact details into elements marked with
    `data-cms="hero.headline"` etc. (add these hooks to the HTML).
  - Renders a **"Trusted partners" / "Featured businesses"** grid (logo + name +
    blurb + services chips). Cap the count (`maxToShow`, e.g. 6–8) and shuffle or
    order — so the number on screen never implies a total.
  - **Freshness:** use uncached Firestore fetches so admin edits are visible on
    the next page load/refresh without Hostinger redeploy.
  - **Fallback:** if any fetch fails or returns empty, keep the existing static
    copy and hide the featured grid. Contact updates should still apply even if
    the homepage content doc is missing, and featured-business failures should
    not block other CMS fields.
- Load `assets/content.js` on all public pages that show shared footer/contact
  details, not only `index.html`.
- Add the featured section markup to `index.html` (and optionally a dedicated
  `partners.html`), styled with the existing design system + animation classes.
- Bump the `?v=N` cache-buster on changed assets.

---

## Backend (`my_flutter_app/functions/index.js`)
Callable functions (admin, website capability), consistent with existing
`requireAdminCapability` + `getUserProfile` + `setAdminAuditLog` patterns:
- `publishFeaturedBusiness({ businessId, displayName, blurb, services, logoUrl, order, city, country })`
  — validates required assets, writes `featuredBusinesses/{id}`, updates the
  business's `featureStatus`.
- `unpublishFeaturedBusiness({ businessId })`.
- `requestFeaturing({ ... })` (business owner) — optional, for the app flow.
- (Trigger) on `businesses` update/delete → unpublish if suspended/deleted.
Then `firebase deploy --only functions` +
`firebase deploy --only firestore:rules,firestore:indexes`
(see `deploy/HOSTINGER_DEPLOY.md` for the Eventarc-retry note).

---

## Phasing
1. Data model + rules + Storage rules (`featuredBusinesses`, `websiteContent`, logos).
2. Admin "Website" section: content editor + featured curation + validation + RBAC capability.
3. Marketing site `content.js` + featured grid + CMS hooks + fallback.
4. Backend functions + deploy.
5. (Later) Business self-serve featuring request in the mobile app.

## Decisions for the implementer to confirm
- Asset entry point first: **admin-on-behalf** (recommended) vs app self-serve.
- Cap of featured shown on the homepage (recommend 6–8).
- Logo spec (square, transparent PNG, min ~256px) and where it's validated.
- Whether featuring requires `businessStatus == "approved"` (recommend: yes).
- Which admin roles get the **website** capability by default (recommend:
  super admin + a new/existing content role).

## Durable implementation notes
- Website/public forms, including contact and partner/business application
  forms, and featured-business admin forms must use selectable country/city
  controls, not free-text location inputs. Preserve current legacy values in
  selects so older records remain editable without creating spelling drift.
- Featured-business logo uploads use Firebase Storage path
  `businessLogos/{businessId}/...`. Keep the admin Website UI, Storage rules,
  Firestore rules, and `publishFeaturedBusiness` callable authorization aligned
  around the **website** capability; deploy Storage rules from
  `my_flutter_app/firebase.json`.
- Business dashboard listing visibility depends on `cars/{id}.businessId`.
  Keep business-owner car queries uncapped but scoped by `businessId`; do not
  add name-based read exceptions. If legacy posted cars are missing
  `businessId`, deploy and run the super-admin callable
  `backfillBusinessCarListings` with `dryRun` first, then assign only the
  verified unassigned car IDs. If a legacy migration assigned posted cars to
  the wrong/default business, reassign only explicit verified `carIds` with
  `reassignExplicitCarIds: true`; never bulk-reassign by business name. If
  callable deploy is blocked, use the Admin SDK fallback
  `cd my_flutter_app/functions && npm run backfill:cars -- ...` with dry-run
  output reviewed before `--commit`.
- Legacy/default migrations must never overwrite an existing non-empty
  `cars/{id}.businessId`; only fill records where `businessId` is missing or
  blank.
- Car listing images must upload to `cars/{businessId}/{carId}/...`, not the
  legacy `cars/{carId}/...` path. Storage rules keep legacy images publicly
  readable but deny legacy writes; new writes are image-only, size-limited, and
  authorized by the listing business scope.
- Public featured-business rendering must hard-cap homepage cards at 8 or fewer
  even if CMS `maxToShow` is higher; never render totals or query the private
  `businesses` collection from `public_site`.
- Public featured-business reads must avoid private `businesses` and avoid
  console errors if a composite index is not deployed yet. It is acceptable to
  query active curated `featuredBusinesses`, sort by `order` client-side, and
  render only the hard-capped homepage subset.
- Before uploading `public_site/`, run `node public_site/verify-cms.mjs`. It
  guards the static CMS hooks, featured-business privacy invariant, homepage
  cap, and selectable country/city controls.

## Repo pointers
- Admin console + RBAC + Settings patterns: `admin_web/src/components/admin-console.tsx`
- Admin styles: `admin_web/src/app/globals.css`
- Marketing site: `public_site/` (`index.html`, `assets/styles.css`, `assets/script.js`)
- Functions + capability model: `my_flutter_app/functions/index.js`
- Rules: `my_flutter_app/firestore.rules`
- Deploy: `deploy/HOSTINGER_DEPLOY.md`
- Mobile app (for self-serve flow): `my_flutter_app/lib/`
