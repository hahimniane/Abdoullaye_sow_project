import assert from "node:assert/strict";
import test from "node:test";

import {
  ellipsizePackageText,
  layoutPackageLabel,
  layoutPart,
  PACKAGE_LABEL_FROM_CAPTION,
  PACKAGE_LABEL_TO_CAPTION,
  packageLabelCodeLine,
  packageLabelFooter,
  packageLabelFromRow,
  packageLabelsRequest,
  packageLabelSetFromResponse,
  packageTrackingLink,
  PM241_LABEL_SIZE,
  type PackageLabel,
} from "./package-labels.ts";

function label(over: Partial<PackageLabel> = {}): PackageLabel {
  return {
    code: "CL-K7M4P2",
    link: "https://customer.laawoldigital.com/t/CL-K7M4P2",
    what: "Medium box",
    vin: "",
    packageNumber: 1,
    packageCount: 1,
    receiver: "Fatou Diallo",
    receiverPhone: "+224 620 12 34 56",
    sender: "Mamadou Bah",
    senderPhone: "+1 347 555 0100",
    destination: "Guinea",
    size: "24 × 18 × 18 in",
    place: "Guinea · 24 × 18 × 18 in",
    ...over,
  };
}

// --- the callable ----------------------------------------------------------

test("packageLabelsRequest: a container, one line on it, or waiting lines by id", () => {
  assert.deepEqual(packageLabelsRequest({ businessId: " b1 ", containerId: "c1" }), { businessId: "b1", containerId: "c1", copies: 1 });
  assert.deepEqual(packageLabelsRequest({ businessId: "b1", containerId: "c1", lineId: "l1" }), { businessId: "b1", containerId: "c1", copies: 1, lineId: "l1" });
  assert.deepEqual(packageLabelsRequest({ businessId: "b1", lineIds: ["a", "b", "a", " "] }), { businessId: "b1", containerId: "", copies: 1, lineIds: ["a", "b"] });
  // One waiting line named by lineId alone is a list of one; a container ignores lineIds.
  assert.deepEqual(packageLabelsRequest({ businessId: "b1", lineId: "a" }), { businessId: "b1", containerId: "", copies: 1, lineIds: ["a"] });
  assert.equal("lineIds" in packageLabelsRequest({ businessId: "b1", containerId: "c1", lineIds: ["a"] }), false);
});

test("packageLabelsRequest: copies are one or two, one by default on the printer, at most 100 lines", () => {
  assert.equal(packageLabelsRequest({ businessId: "b", containerId: "c" }).copies, 1);
  assert.equal(packageLabelsRequest({ businessId: "b", containerId: "c", copies: 2 }).copies, 2);
  assert.equal(packageLabelsRequest({ businessId: "b", containerId: "c", copies: 7 }).copies, 2, "anything but 1 is two, as the server reads it");
  const many = Array.from({ length: 150 }, (_, i) => `l${i}`);
  assert.equal((packageLabelsRequest({ businessId: "b", lineIds: many }).lineIds as string[]).length, 100);
});

test("packageLabelSetFromResponse: reads labels, drops rows with no code, fills the gaps", () => {
  const set = packageLabelSetFromResponse({
    labels: [
      { code: "cl-k7m4p2", packageNumber: 2, packageCount: 3, receiver: "Fatou", destination: "Guinea", size: "S" },
      { code: "", receiver: "no code" },
      "junk",
      { code: "CL-X", link: "https://customer.laawoldigital.com/t/CL-X", place: "Mali · M", packageNumber: 9, packageCount: 2 },
    ],
    reference: "NEN-12",
    hasContainer: true,
    businessName: "Nensona",
    businessPhone: "+1 555",
  });
  assert.equal(set.labels.length, 2);
  assert.equal(set.labels[0].code, "CL-K7M4P2");
  assert.equal(set.labels[0].link, packageTrackingLink("CL-K7M4P2"));
  assert.equal(set.labels[0].place, "Guinea · S");
  assert.equal(set.labels[1].packageNumber, 2, "a piece number past the count is the last piece");
  assert.deepEqual([set.reference, set.hasContainer, set.businessName, set.businessPhone], ["NEN-12", true, "Nensona", "+1 555"]);
  assert.deepEqual(packageLabelSetFromResponse(null).labels, []);
  assert.deepEqual(packageLabelSetFromResponse({ labels: "no" }).labels, []);
});

test("a label row is as tolerant as the app's: numbers as strings and over-long text", () => {
  const row = packageLabelFromRow({ code: "CL-A", packageCount: "3", packageNumber: 0, receiver: "x".repeat(400), vin: "1HGCM82633A004352EXTRA" });
  assert.equal(row.packageCount, 1, "a count that is not a number is 1");
  assert.equal(row.packageNumber, 1);
  assert.equal(row.receiver.length, 120);
  assert.equal(row.vin.length, 17);
});

// --- the words -------------------------------------------------------------

test("the code line says which piece when a line is several", () => {
  assert.equal(packageLabelCodeLine({ code: "CL-K7M4P2", packageNumber: 1, packageCount: 1 }), "CL-K7M4P2");
  assert.equal(packageLabelCodeLine({ code: "CL-K7M4P2", packageNumber: 2, packageCount: 3 }), "CL-K7M4P2 · 2 of 3");
});

test("the footer is the business and its phone, Laawol Digital when there is none", () => {
  assert.equal(packageLabelFooter("Nensona", "+1 555 0100"), "Nensona · +1 555 0100");
  assert.equal(packageLabelFooter("Nensona", ""), "Nensona");
  assert.equal(packageLabelFooter("  ", ""), "Laawol Digital");
});

test("ellipsizePackageText cuts with an ellipsis and counts letters, not bytes", () => {
  assert.equal(ellipsizePackageText("Fatou", 10), "Fatou");
  assert.equal(ellipsizePackageText("Mamadou Alhassane Bah", 10), "Mamadou A…");
  assert.equal(ellipsizePackageText("Mamadou Bah", 8), "Mamadou…");
  assert.equal(ellipsizePackageText("abc", 1), "…");
  assert.equal(ellipsizePackageText("😀😀😀😀", 3), "😀😀…");
});

// --- the layout ------------------------------------------------------------

test("the layout is the 4 x 6: 100 x 147.5 mm, which is 800 x 1180 dots", () => {
  assert.equal(PM241_LABEL_SIZE.widthMm * 8, 800);
  assert.equal(PM241_LABEL_SIZE.heightMm * 8, 1180);
  const layout = layoutPackageLabel(label());
  assert.deepEqual(layout.size, PM241_LABEL_SIZE);
  assert.equal(layout.margin, 6.35);
  assert.ok(layout.qrSide > 50 && layout.qrSide <= 66.04, `QR ${layout.qrSide} mm`);
  assert.equal(layout.link, "https://customer.laawoldigital.com/t/CL-K7M4P2");
});

test("every part sits inside the label, in order, and the footer sits last on the bottom edge", () => {
  const layout = layoutPackageLabel(label({ vin: "1HGCM82633A004352", packageNumber: 2, packageCount: 3 }), {
    businessName: "Nensona",
    businessPhone: "+1 555 0100",
    reference: "MSKU1234567",
  });
  const { widthMm, heightMm } = layout.size;
  for (const t of layout.texts) {
    assert.ok(t.left >= layout.margin - 1e-9 && t.left + t.width <= widthMm - layout.margin + 1e-9, `${t.part} within the width`);
    assert.ok(t.top >= layout.qrTop + layout.qrSide - 1e-9, `${t.part} below the QR`);
    assert.ok(t.top + t.height <= heightMm - layout.margin + 1e-9, `${t.part} within the height`);
    assert.ok(t.fontMm > 0, `${t.part} is readable`);
  }
  const order = ["code", "what", "vin", "toCaption", "receiver", "receiverPhone", "fromCaption", "sender", "senderPhone", "place"] as const;
  const tops = order.map((part) => layoutPart(layout, part)!.top);
  assert.deepEqual([...tops].sort((a, b) => a - b), tops, "top to bottom in the printed order");
  const footer = layoutPart(layout, "footer")!;
  assert.ok(footer.top > layoutPart(layout, "place")!.top);
  assert.equal(footer.text, "Nensona · +1 555 0100");
  assert.equal(layoutPart(layout, "reference")!.text, "MSKU1234567");
  assert.ok(layout.ruleTop !== null && layout.ruleTop < footer.top);
});

test("the code is large and monospace, with '1 of 3' for a piece of several", () => {
  const layout = layoutPackageLabel(label({ packageNumber: 1, packageCount: 3 }));
  const code = layoutPart(layout, "code")!;
  assert.equal(code.text, "CL-K7M4P2 · 1 of 3");
  assert.equal(code.mono, true);
  assert.ok(code.fontMm >= layoutPart(layout, "receiver")!.fontMm, "the code is the biggest line");
  assert.equal(layoutPart(layoutPackageLabel(label()), "code")!.text, "CL-K7M4P2");
});

test("captions are in both languages and only appear with someone to name", () => {
  const both = layoutPackageLabel(label());
  assert.equal(layoutPart(both, "toCaption")!.text, PACKAGE_LABEL_TO_CAPTION);
  assert.equal(layoutPart(both, "fromCaption")!.text, PACKAGE_LABEL_FROM_CAPTION);
  assert.equal(PACKAGE_LABEL_TO_CAPTION, "TO / POUR");
  assert.equal(PACKAGE_LABEL_FROM_CAPTION, "FROM / DE");
  const noSender = layoutPackageLabel(label({ sender: "", senderPhone: "" }));
  assert.equal(layoutPart(noSender, "fromCaption"), undefined, "a sender who is the receiver is printed once");
  assert.equal(layoutPart(noSender, "sender"), undefined);
  assert.ok(layoutPart(noSender, "toCaption"));
});

test("a car shows its VIN whole; a box has no VIN line", () => {
  const car = layoutPackageLabel(label({ what: "2015 Toyota Camry", vin: "4T1BF1FK5FU123456" }));
  assert.equal(layoutPart(car, "vin")!.text, "VIN 4T1BF1FK5FU123456");
  assert.equal(layoutPart(layoutPackageLabel(label()), "vin"), undefined);
});

test("long names are cut with an ellipsis; the code and both phones are never cut", () => {
  const layout = layoutPackageLabel(
    label({
      receiver: "Mamadou Alhassane Oumar Abdoulaye Ibrahima Diallo Bah Sow",
      sender: "Sociéte Générale des Transports Maritimes de l'Afrique de l'Ouest",
      what: "Very large wooden crate with household goods and a refrigerator",
      receiverPhone: "+224 620 12 34 56 78 90",
      senderPhone: "+1 (347) 555-0100 ext. 12345",
    }),
  );
  for (const part of ["receiver", "sender", "what"] as const) {
    const t = layoutPart(layout, part)!;
    assert.ok(t.text.endsWith("…"), `${part} is cut`);
    assert.equal(t.whole, false);
  }
  assert.equal(layoutPart(layout, "receiverPhone")!.text, "+224 620 12 34 56 78 90");
  assert.equal(layoutPart(layout, "senderPhone")!.text, "+1 (347) 555-0100 ext. 12345");
  assert.equal(layoutPart(layout, "code")!.text, "CL-K7M4P2");
  for (const part of ["code", "receiverPhone", "senderPhone", "vin", "reference"] as const) {
    const t = layoutPart(layout, part);
    if (t) assert.equal(t.whole, true, `${part} is printed whole`);
  }
});

test("a long code or phone shrinks its font to fit rather than losing digits", () => {
  const long = label({ code: "CL-ABCDEFGHIJKLMNOP", receiverPhone: "+1 234 567 890 123 456 789 012 345" });
  const layout = layoutPackageLabel(long);
  const code = layoutPart(layout, "code")!;
  const fitted = layout.size.widthMm - 2 * layout.margin;
  assert.equal(code.text, "CL-ABCDEFGHIJKLMNOP");
  assert.ok(code.text.length * code.fontMm * 0.6 <= fitted + 1e-6, "the code fits its line at the shrunk size");
  const normal = layoutPart(layoutPackageLabel(label()), "code")!;
  assert.ok(code.fontMm < normal.fontMm);
});

test("the label carries no price, whatever the server's row held", () => {
  const row = packageLabelFromRow({ code: "CL-A", price: "$120.00", amountDue: 120, total: "$120", receiver: "Fatou", place: "Guinea · S" });
  const layout = layoutPackageLabel(row, { businessName: "Nensona", reference: "NEN-12" });
  const everything = layout.texts.map((t) => t.text).join("\n");
  assert.doesNotMatch(everything, /\$|120|price|total|due/i);
  assert.equal(Object.keys(row).some((key) => /price|amount|total|due|balance/i.test(key)), false);
});

test("a label with only a code still lays out: QR, code and footer", () => {
  const layout = layoutPackageLabel(label({ what: "", receiver: "", receiverPhone: "", sender: "", senderPhone: "", destination: "", size: "", place: "" }));
  assert.deepEqual(layout.texts.map((t) => t.part).sort(), ["code", "footer"]);
  assert.ok(layout.qrSide > 0);
});
