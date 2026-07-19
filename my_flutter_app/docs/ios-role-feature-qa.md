# iOS Role and Feature Release Matrix

This is the durable end-to-end release checklist for the Laawol iOS app. A
compiled screen is not a pass. A workflow passes only after it is exercised in
the running iOS app, its backend write is verified, and the next role can see
and act on the result.

## Status meanings

- `PASS`: verified in the native iOS app with recorded evidence.
- `FAIL`: exercised and a reproducible defect was found.
- `BLOCKED`: the workflow cannot currently be completed because a required
  account, fixture, permission, or external service is unavailable.
- `MISSING`: the product advertises the workflow but the iOS implementation is
  absent.
- `PENDING`: not yet exercised end to end.

## Required test identities and fixtures

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| DATA-01 | Customer A | Available | Existing E2E customer |
| DATA-02 | Customer B | Available | `e2e.customer.b@laawol.test`, verified in the native iOS shared-pool flow |
| DATA-03 | Approved business owner | Available | Existing E2E business |
| DATA-04 | Second approved business | BLOCKED | Needed for marketplace isolation tests |
| DATA-05 | Full-permission staff | BLOCKED | Must not use the owner identity |
| DATA-06 | Restricted staff | BLOCKED | Needed for permission-denial tests |
| DATA-07 | Super admin | Available | Existing E2E admin |
| DATA-08 | Finance and support admins | BLOCKED | Needed for least-privilege tests |
| DATA-09 | Published car, pool, freight, parking, and order fixtures | PENDING | Use deterministic QA records |
| DATA-10 | Customer C | Available | `e2e.customer.c@laawol.test`, used for auto-approval pool capacity |
| DATA-11 | Customer D | Available | `e2e.customer.d@laawol.test`, used to fill the final auto-approved share |

## Customer authentication and navigation

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| AUTH-01 | Cold launch and splash routing | PENDING | |
| AUTH-02 | Customer sign up | PENDING | |
| AUTH-03 | Customer sign in and sign out | PENDING | |
| AUTH-04 | Forgot password from the customer tab | PASS | Native iPhone simulator and root-navigation regression coverage |
| AUTH-05 | Open business registration from customer auth | PASS | Native iPhone simulator and Maestro |
| AUTH-06 | Submit business registration | PENDING | Must verify Firestore record and admin visibility |
| AUTH-07 | Business sign-in routing from customer tab | PASS | Native iPhone simulator and root-navigation regression coverage |
| AUTH-08 | English and French auth flows | PENDING | |

## Customer profile, wallet, and general navigation

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| CUST-01 | Home tabs and all menu routes | PENDING | Numeric transport-year crash repaired with regression coverage; Activity/My orders now opens natively, remaining routes still require verification |
| CUST-02 | View and update account profile | PENDING | |
| CUST-03 | Customize navigation | PENDING | Route appears legacy/orphaned |
| CUST-04 | Wallet balances and transaction history | PENDING | |
| CUST-05 | Favorites persist after relaunch | PENDING | |
| CUST-06 | Light mode on all customer screens | PENDING | |
| CUST-07 | Dark mode on all customer screens | PENDING | User reported unusable dark mode |
| CUST-08 | English and French on all customer screens | PENDING | |

## Customer support

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| SUP-01 | Open a support request | PASS | Native iPhone simulator opened support from the seeded barrel order and created the case |
| SUP-02 | Send and receive text messages | PENDING | |
| SUP-03 | Upload JPEG image | FAIL | Native iPhone/emulator upload passed: Firestore `messageType=image` and a 70,351-byte `image/jpeg` Storage object were verified. Production remains blocked by missing Storage cross-service IAM role |
| SUP-04 | Upload HEIC image from iPhone | FAIL | Same production IAM blocker |
| SUP-05 | Upload QuickTime video from iPhone | FAIL | Native iPhone/emulator flow passed with a real Photos-picker video: Firestore `messageType=video` and a 7,900-byte `video/mp4` Storage object were verified. Production remains blocked by the Storage IAM role |
| SUP-06 | Upload document | FAIL | Same production IAM blocker |
| SUP-07 | Upload voice attachment | FAIL | Same production IAM blocker |
| SUP-08 | Reject oversized attachments clearly | PASS | Unit/regression coverage for image, video, document, voice limits |
| SUP-09 | Participant can download attachment | PENDING | Must verify after IAM/rules production repair |
| SUP-10 | Stranger cannot read or upload | PASS | Firebase emulator security suite |
| SUP-11 | Business reply and customer receives it | PENDING | |
| SUP-12 | Admin escalation and resolution | PENDING | |

## Cars

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| CAR-01 | Browse and search cars | PENDING | |
| CAR-02 | View car details and title status | PENDING | Rebuilt-title field must be displayed |
| CAR-03 | Favorite and unfavorite a car | PENDING | |
| CAR-04 | Start a car purchase | PASS | Native iPhone flow purchased the seeded 2022 Nissan; the required marketplace-responsibility acknowledgement was exercised |
| CAR-05 | Complete payment in Stripe test mode | PASS | Native PaymentSheet completed $22,950 with Stripe test card; PaymentIntent `pi_3Tuie6EO69oPXmLj0oq072FD` is `succeeded` and `livemode: false` |
| CAR-06 | Receipt, wallet, purchase history, and tracking update | FAIL | Purchase and sold-car records are correct, but no receipt, notification, tracking event, or wallet-history entry was created |
| CAR-07 | Business sees and processes purchase | PENDING | |
| CAR-08 | Customer cancellation/refund path | PENDING | |
| CAR-09 | Business uploads car images | BLOCKED | Storage IAM issue may affect Firestore-dependent car image rules |
| CAR-10 | Business cannot publish without rebuilt-title selection | PENDING | |

## Shared barrel pools

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| POOL-01 | Customer opens a shared pool | PASS | Customer A opened pool `7bcf8pg4aQOEe9I9DhT4` in the native iOS app; owner deposit, participant, membership, tracking code, payout split, and public listing were verified in Firestore |
| POOL-02 | Customer B discovers and joins Customer A's pool | PASS | Customer B found the customer-posted pool in the native iOS app, completed the disclosures and simulated deposit, and reached `Join request sent`; participant and membership records were verified |
| POOL-03 | Reserved shares and capacity update atomically | PASS | The one-share request changed the pool from 1 open share to `takenShares=2`, `openShares=0`, and `status=full`; the full pool was removed from `openBarrels` |
| POOL-04 | Auto-approval path | PASS | Customer C joined `pool-e2e-auto` natively; the deposit succeeded and the participant was immediately `accepted` with no pending decision |
| POOL-05 | Manual approval path | PASS | A missing iOS owner-review UI and a Firestore owner-list permission defect were repaired with regression coverage. Native approve reached `acceptedShares=2`; native reject reopened capacity and queued Customer B's $33.75 original-payment refund |
| POOL-06 | Full pool rejects another join | PASS | Customer D filled the last share natively; counters reached `acceptedShares=2`, `openShares=0`, `status=full`, and the public mirror was removed so no further iOS join can start |
| POOL-07 | Join deadline is enforced | PENDING | |
| POOL-08 | Customer cancels before processing | PASS | Native owner cancellation removed the public mirror and applied the documented owner-deposit forfeiture. A missing one-tap financial-loss warning was repaired; the iOS app now shows the exact $33.75 forfeiture and requires `Cancel and forfeit deposit` |
| POOL-09 | Payment, receipt, wallet, and tracking update | FAIL | Deposit/payment, participant membership, pool counters, tracking code, payout split, and rejection refund records are correct. No customer receipt record is generated; wallet behavior still requires a wallet-funded native run |
| POOL-10 | Business sees and operates the shared pool | MISSING | Business shared-pool operations are not implemented in iOS |
| POOL-11 | Open-pool form validation and repeated-tap protection | PENDING | |
| POOL-12 | Unverified customer gets a recovery path instead of a raw exception | PENDING | The complete localized send/code/resend/change/success and sync-recovery flow passes widget and backend regressions. A clean simulator build was stopped at the 6 GiB disk threshold before launch, so current-source physical-device runtime verification is still required. |

## Barrel, freight, transport, and parking

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| SHIP-01 | Request a full barrel shipment | PASS | Native iPhone order `mAAKluzyOM2zv02jb4DO` created shipment `diycSv1l7VrcblxXFcq6` for $225 with succeeded simulated payment and tracking `BS-MRP3UEDO-BM4XNB`. The receipt PDF reached the iOS share sheet. Premature/sticky destination-form validation was repaired with a widget regression test. |
| SHIP-02 | Request freight transport | PENDING | |
| SHIP-03 | Request vehicle transport | PENDING | |
| SHIP-04 | Request parking | PENDING | |
| SHIP-05 | Business accepts, quotes, and updates status | PENDING | |
| SHIP-06 | Customer accepts quote and pays | PENDING | |
| SHIP-07 | Receipt, wallet, order list, and tracking agree | PENDING | Full-barrel receipt and tracking passed. Firestore order/shipment totals, provider, receiver, payout split, and tracking agree; the card-funded order correctly did not spend the $100 test wallet. Native order-list verification and a wallet-funded run remain. |
| SHIP-08 | Customer cancels a pending transport request | MISSING | Rules allow it; iOS UI does not expose it |
| SHIP-09 | Invalid state transitions are rejected | PENDING | |
| SHIP-10 | Repeated payment/status taps are idempotent | PENDING | |

## Sourcing and marketplace

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| SRC-01 | Customer creates a sourcing request | MISSING | Advertised on the website; no iOS workflow exists |
| SRC-02 | Business quotes the sourcing request | MISSING | Depends on SRC-01 |
| SRC-03 | Customer accepts, pays, and tracks | MISSING | Depends on SRC-01 |
| MKT-01 | Browse approved businesses | PENDING | |
| MKT-02 | View business profile | PENDING | |
| MKT-03 | Contact or transact with business | PENDING | |

## Business owner and staff

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| BIZ-01 | Business owner login and home | PASS | Native iPhone simulator reached the business dashboard and role tabs |
| BIZ-02 | Business profile and logo/document upload | BLOCKED | Storage IAM may deny Firestore-dependent rules |
| BIZ-03 | Destination-country management | PENDING | |
| BIZ-04 | Car listing create/edit/publish/archive | PENDING | |
| BIZ-05 | Purchases and order processing | PENDING | |
| BIZ-06 | Shipping, freight, transport, and parking work queues | PENDING | |
| BIZ-07 | Support inbox and attachment exchange | PENDING | |
| BIZ-08 | Add and remove staff | PENDING | |
| BIZ-09 | Full staff sees allowed controls | BLOCKED | Full staff account required |
| BIZ-10 | Restricted staff cannot see or invoke denied controls | PENDING | Flutter now loads `businessPermissions`, hides denied Cars/Purchases/Profile/Support tabs, and skips denied activity listeners; pure permission regressions and emulator rules pass, but a restricted-staff runtime pass is still required |
| BIZ-11 | Stripe Connect onboarding and status | MISSING | Service methods exist but no mobile UI |

## Administration

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| ADM-01 | Super-admin login and dashboard | PENDING | |
| ADM-02 | Approve/reject business registration | PENDING | |
| ADM-03 | User and role management | PENDING | |
| ADM-04 | Business and listing moderation | PENDING | |
| ADM-05 | Support escalation and resolution | PENDING | |
| ADM-06 | Payment/refund/finance workflow | PENDING | |
| ADM-07 | Content and configuration workflow | PENDING | |
| ADM-08 | Restricted admins see only authorized controls | FAIL | UI exposes controls beyond capabilities |
| ADM-09 | Audit history records sensitive actions | PENDING | |

## Web consoles and public website

| ID | Workflow | Status | Evidence or defect |
| --- | --- | --- | --- |
| WEB-ADM-01 | Admin preview navigation | PASS | Real browser opened Today, Businesses and all seven business sub-tabs, People & access, Marketplace, Operations, Finance, Support, Website, Tools, and Settings |
| WEB-ADM-02 | Live admin authentication | PASS | Seeded Firebase-emulator super admin reached the live-data admin dashboard |
| WEB-ADM-03 | Finance handles missing or malformed currency | PASS | Repaired the `Unknown` currency crash; Finance remained interactive in English/French and at 390 px, with shared formatter regressions |
| WEB-BIZ-01 | Business preview navigation | PASS | Real browser opened all 11 business sections |
| WEB-BIZ-02 | Stripe payout-state gating | PASS | `none`, `pending`, and `ready` previews showed the expected registration, verification, and payout-ready states |
| WEB-BIZ-03 | Live business-owner authentication | PASS | Seeded Firebase-emulator owner reached the approved business workspace and live operational rows |
| WEB-BIZ-04 | Preview isolation and safe actions | PASS | Real-browser testing found and repaired authenticated Firestore listeners in preview operational tabs and an unauthorized Pro-checkout request; regression coverage now keeps preview reads and paid actions disabled |
| WEB-BIZ-05 | Narrow business-console layout | PASS | Real browser measured `scrollWidth=390` at a 390 px viewport after repairing the content grid shrink boundary; the Stripe-pending and Support views no longer clip horizontally |
| WEB-AUTH-01 | Customer denied console access | PASS | Seeded customer was signed back out with the role-restriction message |
| WEB-PUB-01 | Public pages, navigation, legal links, and language | PASS | All 11 HTML pages returned 200; desktop/mobile navigation and English/French switching passed |
| WEB-PUB-02 | Public responsive layout | PASS | Public pages and both consoles showed no horizontal overflow at 390 px |
| WEB-PUB-03 | Contact form | PASS | Required-field validation, unique bilingual Send message label, complete 249-country catalog plus placeholder, and dependent US city options passed |
| WEB-PUB-04 | Business application | PASS | Connected-project browser submission created the customer account and submitted the business application; both callable requests returned HTTP 200 and the success screen rendered |
| WEB-PUB-05 | App page heading semantics | PASS | App page now exposes its primary heading as `h1` in English and French |

## Device and release coverage

| ID | Requirement | Status | Notes |
| --- | --- | --- | --- |
| DEV-01 | Current iPhone simulator, narrow layout | PASS | iPhone 17 simulator is operational |
| DEV-02 | Physical iPhone camera and photo picker | BLOCKED | Physical device required |
| DEV-03 | Face ID | BLOCKED | Physical-device validation required |
| DEV-04 | APNs notifications and background handling | BLOCKED | Physical-device and production APNs validation required |
| DEV-05 | Offline, slow-network, interrupted upload/payment | PENDING | |
| REL-01 | `flutter analyze` | PASS | Latest support/navigation changes |
| REL-02 | Full Flutter test suite | PASS | 157 tests passed on 2026-07-19, including the complete phone-verification lifecycle and restricted-staff permission regressions |
| REL-03 | Firestore and Storage rules suite | PASS | 46 tests on 2026-07-19 |
| REL-04 | Deploy/preflight suite | PASS | 28 tests on 2026-07-17 |
| REL-05 | Production Storage IAM check | FAIL | Missing `roles/firebaserules.firestoreServiceAgent` binding |
| REL-06 | Clean committed release tree | PENDING | |
| REL-07 | Green CI on exact release commit | PENDING | |
| REL-08 | Production deploy and post-deploy smoke matrix | PENDING | |
| REL-09 | Signed App Store IPA | PASS | Version 1.0.0 build 15 exported on 2026-07-19 with the App Store distribution profile. Deep signature, bundle/version metadata, production APNs entitlement, disabled debugging entitlement, and copied artifact checksum pass. |

## Evidence standard

For every `PASS`, retain:

1. the exact app build/commit,
2. the test identity and fixture IDs,
3. a screenshot or automation report,
4. the backend record or transaction ID,
5. verification from the next responsible role,
6. a regression test for every repaired defect.

## 2026-07-18 execution log

Environment: iOS 26.5, Laawol E2E iPhone 17 Pro simulator, Flutter debug build,
stable Xcode 26.6, Java 21 for Maestro, Firebase project
`demo-laawol-e2e`, and simulated payments unless noted otherwise.

Verified passing in the native iOS app:

- Customer freight balance: seeded $25 balance displayed, marketplace
  responsibility accepted, payment applied, and shipment reached `Settled`.
- French customer service hub and French send-barrel destination form.
- Forgot-password root navigation.
- Business-registration root navigation.
- Business-owner login and root navigation.
- Car transport quote request.
- Car viewing reservation.
- Parking reservation.
- Paid vehicle hold.
- Full vehicle purchase with responsibility acknowledgment.
- Full barrel shipment payment/request.
- Wallet return-to-card request.
- Shared barrel manual approval, rejection/refund, owner
  cancellation/forfeiture, and two-customer auto-approval through a full pool.
- Support image selection through the native iOS photo picker. The repaired
  flow showed the image review sheet, Cancel/Replace/Upload controls, cancelled
  once with no upload, selected again, and uploaded only after confirmation.
  Firestore then contained an image message with a 1,063,759-byte JPEG and a
  Storage download URL under the seeded support case.
- Support video selection after adding a real 208 KB simulator-recorded `.mov`
  to Photos. The native review showed video metadata and
  Cancel/Replace/Upload, uploaded only after confirmation, and Firestore
  contained a 213,275-byte video message with a Storage download URL.
- Connected-project customer signup with marketplace legal acceptance after
  registering a temporary simulator App Check debug token.
- Real Stripe test-mode car purchase with simulation disabled. The native TEST
  PaymentSheet accepted Stripe card `4242`, charged $22,950, and returned the
  app to the purchased state. Firestore purchase
  `iUdu2xbPCxnf1NZENI5J` is completed/succeeded, and Stripe PaymentIntent
  `pi_3Tuie6EO69oPXmLj0oq072FD` is succeeded with `livemode: false`. The
  temporary App Check debug token was deleted after verification.

QA infrastructure defects repaired during this run:

- The freight seed named `FR-E2E-BALANCE` was incorrectly awaiting business
  weight confirmation instead of containing the promised payable $25 balance.
  It now seeds a linked freight settlement, with a focused regression test.
- Freight, car viewing, parking, and paid-hold Maestro flows now complete the
  required marketplace-responsibility acknowledgment.
- Customer B login now dismisses the email keyboard before focusing Password.
- Shared-barrel selection now anchors to the customer-posted pool's unique
  `1/2` capacity instead of relying on a list index.
- Support attachments now use a select, validate, review, then upload flow.
  Images show a local preview; video and document selections show file metadata
  without buffering large files. Cancel preserves the composer caption,
  Replace returns to the same picker, Upload is explicit, and failed uploads
  retain the selection for retry. English and French narrow-phone widget
  regressions pass.
- The support-video Maestro failure was traced to missing simulator test data:
  the native picker showed `No Videos`, so no file was selected. Seed a short
  video with `simctl addmedia` before rerunning that flow.

Verification after the attachment fix:

- `flutter analyze`: pass.
- `flutter test`: 135 tests pass.
- Focused support/policy suite: 10 tests pass.

Still required after the emulator customer suite:

- Verify the attachment review Retry state in the native simulator; Cancel,
  Replace, Upload, English layout, and the French narrow layout are covered by
  passing native/widget checks.
- Connected-project customer smoke checks.
- Native admin/staff workflows and least-privilege roles that remain blocked in
  the tables above.

Website, admin, and business browser verification completed after the native
suite:

- Admin preview: all top-level sections and business workspace sub-tabs
  rendered. A real Finance-page crash caused by `Intl.NumberFormat` receiving
  `Unknown` was reproduced and repaired at the optional-value and shared money
  formatting boundaries.
- Admin Finance was rechecked in English and French at desktop and 390 px.
  Missing currencies now use the typed USD fallback; explicitly malformed
  currency values remain visible without crashing. Dynamic Finance summaries
  are fully translated.
- Business preview: profile, people, listings, purchases, barrels/shared
  barrels, freight, transport, destinations, parking, support, and growth all
  rendered, along with Stripe not-started, pending-verification, and
  payout-ready states.
- Business preview actions were exercised beyond navigation: listing,
  destination, transport, and parking forms exposed localized inline
  validation and cancel behavior; support routing and request gating worked;
  preview-only Firestore permission leakage and the live Pro-checkout call were
  repaired.
- The business console was measured at 390 px rather than accepted by visual
  inspection. A 426 px document overflow was reproduced and repaired at the
  shared content-grid shrink boundary; the recheck measured 390 px exactly.
- French browser coverage includes the business overview, Growth, Stripe
  pending/ready states, sidebar filtering, and support routing. The
  changes-requested notice was rewritten as natural French.
- Firebase-emulator role routing: super admin and business owner reached their
  correct live-data consoles; customer access was rejected.
- Public website: all 11 pages returned HTTP 200, English/French switching and
  mobile navigation passed, and no settled-layout horizontal overflow was
  present at 390 px.
- The public contact form now uses the complete shared country catalog instead
  of a partial hardcoded list, keeps dependent US city options, and uses the
  distinct bilingual `Send message` label.
- A connected-project public business application completed end to end.
  `createCustomerUser`, password sign-in, and `submitBusinessApplication`
  returned HTTP 200 before the success screen appeared.
- Final admin web gates: 73 tests pass, TypeScript passes, and the optimized
  static production build passes. Public CMS/privacy verifier passes across all
  11 HTML files.

## 2026-07-19 release artifact and dashboard mutation log

Release artifact:

- Incremented the App Store build number from 12 to 13 while retaining
  marketing version 1.0.0.
- `flutter analyze` passed and all 135 Flutter tests passed before archiving.
- Xcode 26.6 produced and exported a signed App Store IPA at
  `my_flutter_app/build/ios/ipa/Laawol.ipa`.
- Export validation confirmed bundle `com.laawoldigital.app`, version
  `1.0.0 (13)`, display name `Laawol`, Apple Distribution identity
  `Hassimiou Niane (GRKB7BXVZK)`, and a valid embedded application identifier.
- Disk free space stayed above 9.8 GiB during the build. The disposable Xcode
  DerivedData was removed afterward, restoring 11 GiB free while preserving
  the IPA and `.xcarchive`.

Admin mutation pass, completed so far:

- Account profile save: PASS. The browser changed the admin name and photo
  URL; `users/e2e-platform-admin` and an `admin_profile_updated` audit record
  confirmed the write.
- Missing-role authorization: PASS after repair. A real admin document without
  `adminRole` now shows only Today with `Access not configured` /
  `Accès non configuré`; it no longer receives Super-admin controls.
- Explicit seeded Super admin: PASS after repair. The E2E fixture now stores
  `adminRole: superAdmin`, and the full admin navigation returns after reseed.
- Create platform manager: PASS after repair. Auth, `users/{uid}`, and
  `platform_manager_created` audit data all matched the submitted Operations
  manager.
- Change platform-manager role: PASS after repair. The browser changed the
  manager from Operations to Finance and displayed `Admin role updated`.
- Remove platform-admin access without deletion: PASS after repair. Cancelling
  the confirmation left `e2e-customer-d` as a Support admin. Confirming moved
  the same profile into Customer accounts, preserved its Firebase Auth account,
  removed `adminRole`, `platformAdmin`, and business-membership fields, and
  wrote `user_role_updated` audit record `MY4rc8UITPZADpD2m3yo` from `admin` to
  `customer`. The signed-in administrator had no demotion action.
- People & access responsive/localized action row: PASS after repair. At
  390 px the access-role selector, amber remove-access action, and red delete
  action stack without horizontal overflow. `Admin access role` and
  `Remove admin access` render as `Rôle d’accès admin` and
  `Retirer l’accès admin`.
- Disposable business creation and suspension: PASS. The browser created
  `businesses/qa_mutation_logistics`, then changed its status from Pending to
  Suspended; the emulator confirmed the persisted `suspended` status.
- Trusted manager provisioning lifecycle: PASS. An Auth+Firestore regression
  proves newly provisioned managers are verified and usable, while a Super
  admin can repair an unverified legacy target without granting that target
  permission to act.

Defects repaired during this mutation pass:

- The E2E admin seed omitted its explicit admin role while the web UI treated a
  missing role as Super admin. Functions correctly failed closed, producing a
  misleading privileged UI whose mutations were rejected. The seed and web
  role resolver now use explicit, fail-closed access, including the separate
  platform-admin table fallback.
- Platform managers were created with `emailVerified: false`, making every
  admin callable unusable, and target role changes incorrectly authorized the
  target as if it were the caller. Trusted Super-admin provisioning now creates
  a verified manager; target profile loading is separate from caller
  authorization.
- The People & access console offered no non-destructive way to remove platform
  administrator access, leaving permanent deletion as the apparent option.
  It now exposes a self-protected, confirmed demotion action that preserves the
  account. The underlying `updateUserRole` callable now uses the standard
  verified-admin caller loader instead of bypassing administrator email
  verification.
- The French People & access view contained a mixed-language description and
  untranslated Name/You labels. The exact description and labels now render in
  French, with convergence regressions.

Dashboard mutation coverage remains in progress. Financial assertions,
terminal workflow transitions, deletions, and bulk tools are intentionally
scheduled after reversible admin and business changes.

Business-verification mutation pass:

- Verification checklist state: PASS after repair. Selecting
  `Not applicable` and entering the review note no longer resets before save.
  The emulator persisted the checklist state and note.
- Request changes: PASS. The browser moved the disposable application from
  Pending to `changes_requested`, and the backend wrote
  `business_verification_reviewed` and `business_application_reviewed` audit
  actions.
- Root cause: the verification-draft hydration effect depended on an object
  rebuilt during render. Its scalar dependencies now change only when the
  persisted business/review state changes, with a focused regression.

## 2026-07-19 unverified-phone release blocker

Build 13 is superseded and must not be submitted:

- A TestFlight customer with no verified Firebase Auth phone attempted to post
  a shared barrel. The app rendered the complete
  `[firebase_functions/failed-precondition]` exception and plugin stack trace.
- The earlier native QA used seeded customers whose Firestore profiles already
  had `phoneVerified: true`, so the ordinary unverified-customer branch was not
  exercised. Those seed records also lacked matching Firebase Auth phone
  providers, which hid a second stale-verification defect.

Repairs implemented:

- Shared-barrel create and join now stop before opening the form or payment
  disclosure and show a localized `Verify your phone to continue` dialog.
- A dedicated English/French verification screen sends a Firebase SMS code,
  accepts a six-digit OTP, supports resend cooldown/change-number states, links
  or updates the Auth phone credential, and syncs only that verified Auth phone
  to the customer profile.
- Client verification requires the Auth phone and profile phone to match.
  Backend verification independently enforces the same match; a Firestore flag
  alone cannot authorize shared-barrel actions.
- Editing the profile phone clears verification until the new number is
  verified. Rejected unverified attempts no longer write marketplace
  disclosure evidence.
- All raw exception rendering was removed from the shared-barrel screen,
  including list loading, form loading, balance payment, and cancel/leave
  failures. Technical details remain in debug logs only.
- iOS now contains the Firebase phone-auth callback URL scheme and background
  remote-notification mode required for silent-push/reCAPTCHA fallback.
- E2E seed users now have Auth phone providers that match their profiles.
- The E2E seed now also includes
  `e2e.customer.unverified@laawol.test`, whose profile has a phone number but
  whose Firebase Auth account intentionally has no phone provider. This branch
  is no longer absent from the reusable customer matrix.

Verification completed so far:

- Functions lint: PASS.
- Shared-barrel callable lifecycle: 22/22 PASS, including unverified,
  Auth/profile mismatch, verified-phone sync, profile-phone invalidation, and
  no-disclosure-side-effect cases.
- Flutter analysis: PASS.
- Latest full Flutter suite: 146/146 PASS.
- Full Functions suite: PASS, including 120 unit/payment/security tests plus
  isolated platform-admin, services, shared-barrel, support, and
  Firestore/Storage rules suites.
- Restricted Flutter staff access now fails closed when permissions are absent.
  The auth provider loads `businessPermissions`; tab visibility and activity
  listeners use the same explicit permission names as the web console and
  backend rules. Runtime UI verification remains pending.
- English and French recovery dialogs render without overflow at 390×844.
- A clean physical-iPhone debug compile completed. Launch verification was not
  claimed because the connected device was in active personal use; the pending
  launcher was stopped without forcing Laawol into the foreground.
- Signed App Store build 14 exported successfully. The embedded app metadata,
  deep code signature, and copied artifact hash were verified after the
  restricted-staff repair. The handoff copy is
  `/Users/hashimniane/Downloads/Laawol-1.0.0-14.ipa`; SHA-256 is
  `cbb9414b1ca49ab19f3d54d746e19793eb81dc956a47c221d58999ee773caace`.
- The disposable build archive was removed after the handoff copy was
  re-verified, leaving about 8.2 GiB free. The test hard stop remains 6 GiB.
- Signed App Store build 15 exported successfully after the complete
  phone-verification work. The embedded app is `Laawol` version `1.0.0` build
  `15`, bundle `com.laawoldigital.app`, signed by Apple Distribution team
  `GRKB7BXVZK` with production APNs and `get-task-allow=false`. The handoff copy
  is `/Users/hashimniane/Downloads/Laawol-1.0.0-15.ipa`; SHA-256 is
  `7534604b4bcf01cbc356eb32d1aca343ea0c35a25b4994c4e7353e1a19cfb5b7`.
- The build-15 archive and module-cache intermediates were removed after the
  Downloads copy hash was re-verified, restoring about 12 GiB free. The test
  hard stop remains 6 GiB.
- A clean local-emulator simulator launch was attempted with the dedicated
  unverified customer fixture. The build was aborted before installation when
  free disk reached the 6 GiB safety threshold. Partial build data, simulator
  data, and emulator processes were cleaned up; free space recovered to 12 GiB.
  This attempt is not counted as runtime verification.

## 2026-07-19 complete phone-verification flow

Implemented:

- Account Profile now distinguishes verified, saved-but-unverified, and edited
  phone drafts. Editing a verified number immediately removes the green state
  and presents a full-width `Save and verify` action instead of sending the
  customer to a distant Save button that closes the screen.
- The verification screen now has explicit sending, code-sent, resend,
  change-number, wrong/expired-code, timeout, synchronization-recovery, and
  verified-success states. The code field autofocuses, stays adjacent to the
  Verify action on narrow phones, and all copy is localized in English and
  French.
- SMS requests remain locked until Firebase calls back or a 90-second safety
  timeout resolves the loading state. Initial send and resend use separate
  progress states, preventing duplicate requests and stuck resend controls.
- Abandoned or replaced attempts cannot complete automatic verification through
  the provider callback. An Auth phone that was linked before a profile-sync
  network failure can use `Finish verification` without sending another SMS.
- Participant leave now uses the same phone-verification preflight and
  structured recovery as shared-barrel create/join.
- Unverified signup/profile phone values no longer reserve
  `phoneSignInAliases`. Only a phone proven by Firebase Auth may claim the alias,
  and an old alias is deleted only when it belongs to the current user.
- Customer profile saves now enforce the same international `+country code`
  format used by verification. Profile saving and verification preparation are
  mutually locked, and verification errors/spinners use accessible semantic
  colors.

Verification:

- `flutter analyze`: PASS.
- Full Flutter suite: 157/157 PASS.
- Focused phone-verification suite: 20/20 PASS, including duplicate-send,
  failed-resend recovery, sync-only recovery, success, and narrow French.
- Functions lint: PASS.
- Functions unit/security suite: 121/121 PASS.
- Shared-barrel callable lifecycle: 22/22 PASS.
- Full Functions/emulator suite: PASS, including 46/46 Firestore/Storage rules.
- A clean current-source simulator build was attempted with the E2E emulators
  and dedicated unverified fixture. The automatic disk guard stopped Xcode at
  the 6 GiB threshold before installation. Aborted build data and emulators were
  removed; this is not counted as real-running-app verification.
- The current `/Users/hashimniane/Downloads/Laawol-1.0.0-15.ipa` checksum is
  `7534604b4bcf01cbc356eb32d1aca343ea0c35a25b4994c4e7353e1a19cfb5b7`.
  This artifact contains the complete phone-verification client flow; deploy
  the matching Firebase Functions before distributing it to testers.

Still required before release submission:

- Run the completed debug app on an available physical iPhone, exercise the
  local Auth-emulator OTP, return to shared barrels, and verify that no payment
  or disclosure is attempted before verification.
- Confirm Firebase Phone Authentication is enabled for the production project
  and validate the production SMS/APNs or reCAPTCHA path on a physical iPhone.
