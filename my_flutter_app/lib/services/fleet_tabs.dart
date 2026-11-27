// The tabs of the Fleet page, in order (docs/FLEET.md sections 15 and 17).
// Mirrors the website's Fleet page (admin_web/src/lib/fleet-home.ts): Needs
// you opens first; settings sit behind the gear, not in a tab. The business
// home opens Fleet straight on one of these.

/// A tab of the Fleet page.
enum FleetTab { needs, drivers, plates, payments, paperwork }
