// A sample Today for the console's local preview (`?preview=1&console=business`
// on localhost), so the page can be checked in a browser without a signed-in
// owner or a server. Never read outside preview mode. The figures are made
// up but hang together the way the server's do (the money splits add up to
// the total; the owed total is the sum of its parts), and only the services
// the preview business runs get a section.

import { currentVolumeMonth, shiftVolumeMonth } from "./volume.ts";
import type { BusinessToday, TodayMoneyMonth } from "./business-today.ts";

const SHIPPING = ["barrelShipping", "freight", "carTransport", "carParking"];

function money(byService: Record<string, number>, byMethod: Record<string, number>, payments: number): TodayMoneyMonth {
  const total = Object.values(byService).reduce((sum, cents) => sum + cents, 0);
  return { totalCents: total, payments, byService, byMethod };
}

export function previewBusinessToday(services: ReadonlySet<string>, now: Date = new Date()): BusinessToday {
  const month = currentVolumeMonth(now);
  const shipping = SHIPPING.some((id) => services.has(id));
  const parking = services.has("carParking");
  const shop = services.has("inventory");
  const carSales = services.has("carSales");
  const current = money(
    { packages: 1842000, invoices: 265000, lot: parking ? 120000 : 0, parking: parking ? 98000 : 0, shop: shop ? 54250 : 0, online: 312500 },
    { cash: 1325000, zelle: 918000, cashapp: 0, venmo: 0, check: 65000, card_in_person: 71250, online: 312500, other: 0 },
    148,
  );
  // The methods must add up to the services: put the gap on "other".
  const methodSum = Object.values(current.byMethod).reduce((sum, cents) => sum + cents, 0);
  current.byMethod.other += Math.max(0, current.totalCents - methodSum);
  const previous = money(
    { packages: 1610000, invoices: 180000, lot: 0, parking: 0, shop: 0, online: 290000 },
    { cash: 1200000, zelle: 690000, cashapp: 0, venmo: 0, check: 0, card_in_person: 0, online: 290000, other: 0 },
    121,
  );
  const owed = {
    packagesCents: shipping ? 734500 : null,
    invoicesCents: 182000,
    parkingCents: parking ? 46000 : null,
    shopCreditCents: shop ? 12500 : null,
  };
  const owedTotal = Object.values(owed).reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
  return {
    month,
    previousMonth: shiftVolumeMonth(month, -1),
    timeZone: "America/New_York",
    viewer: { finance: true, containers: shipping, invoices: true, parking, inventory: shop, listings: carSales, support: true },
    activity: shipping
      ? {
          current: { pieces: 214, packages: 118, barrels: 92, carsReceived: 4, carsShipped: 6, containersShipped: 3, piecesShipped: 176 },
          previous: { pieces: 188, packages: 101, barrels: 84, carsReceived: 3, carsShipped: 4, containersShipped: 2, piecesShipped: 140 },
          change: { pieces: 13.8, packages: 16.8, barrels: 9.5, carsReceived: 33.3, carsShipped: 50, containersShipped: 50, piecesShipped: 25.7 },
        }
      : null,
    containers: shipping
      ? {
          loading: 2,
          atSea: 1,
          more: false,
          list: [
            { id: "preview-c1", name: "MSKU4820193", status: "loading", destination: "Guinea", destinationCountryId: "guinea",
              pieces: 64, barrels: 40, cars: 2, packages: 22, lines: 31, sailedAtMs: null },
            { id: "preview-c2", name: "Dakar · November", status: "loading", destination: "Senegal", destinationCountryId: "senegal",
              pieces: 18, barrels: 12, cars: 0, packages: 6, lines: 9, sailedAtMs: null },
            { id: "preview-c3", name: "CMAU7716402", status: "shipped", destination: "Guinea", destinationCountryId: "guinea",
              pieces: 71, barrels: 38, cars: 3, packages: 30, lines: 36, sailedAtMs: now.getTime() - 9 * 86400000 },
          ],
        }
      : null,
    queues: {
      packageRequests: shipping ? 5 : null,
      waitingPackages: shipping ? 23 : null,
      containersLoading: shipping ? 2 : null,
      barrelOrders: services.has("barrelShipping") ? 3 : null,
      freightOrders: services.has("freight") ? 1 : null,
      carPurchases: carSales ? 2 : null,
      transportRequests: services.has("carTransport") ? 0 : null,
      supportRequests: 1,
      openInvoices: 4,
    },
    owed: { ...owed, totalCents: owedTotal },
    money: { current, previous, change: Math.round(((current.totalCents - previous.totalCents) / previous.totalCents) * 1000) / 10 },
    shop: shop ? { current: 86, previous: 74, change: 16.2 } : null,
    parking: parking ? { inLot: 37, reserved: 4, spacesTotal: 60 } : null,
    listings: carSales ? { active: 12 } : null,
    unavailable: [],
  };
}
