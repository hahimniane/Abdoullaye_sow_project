/**
 * Package labels as data, for the console to draw and print itself on the
 * 4 x 6 in Phomemo PM-241 label printer (`pm241.ts`, `package-label-canvas.ts`).
 *
 * Two halves, both mirrors of the app's `lib/services/package_labels.dart`
 * (read that file's header for the label rules - they are the same here):
 *
 *   - the CONTRACT of the `getPackageLabels` callable: the request, and the
 *     tolerant reading of its answer (`packageLabelSetFromResponse`);
 *   - the LAYOUT (`layoutPackageLabel`): where the QR and every line of text
 *     sit, in millimetres, for a label of any size. The QR of the public
 *     tracking link (error correction H) on top, the code large in
 *     monospace ("CL-K7M4P2 · 1 of 3" when a line is several pieces), what
 *     the piece is (VIN for a car), TO / POUR the receiver and phone,
 *     FROM / DE the sender and phone, where it goes and its size, and a
 *     footer with the business and the container. NEVER the price.
 *
 * A long name is cut with "…"; the code and the phone numbers are printed
 * whole (a smaller font, never fewer digits): whoever holds the package has
 * to be able to call. Pure - no DOM, no Firebase - so `package-labels.test.ts`
 * runs it directly.
 */

// ---------------------------------------------------------------------------
// Sizes.
// ---------------------------------------------------------------------------

export type LabelSize = { widthMm: number; heightMm: number };

/**
 * What a PM-241 prints on a 4 x 6 in label: 800 x 1180 dots (100 x 147.5 mm
 * at 8 dots per millimetre), placed on the label by the printer. The same
 * size the app calls `4x6pm241`.
 */
export const PM241_LABEL_SIZE: LabelSize = { widthMm: 100, heightMm: 147.5 };

/** One request names at most this many lines (the server's limit). */
export const PACKAGE_LABELS_MAX_LINES = 100;

/** The label printer prints one label per piece (a pickup, a torn label). */
export const PACKAGE_LABEL_COPIES_PRINTER = 1;

// ---------------------------------------------------------------------------
// The callable.
// ---------------------------------------------------------------------------

/**
 * The `getPackageLabels` payload: a whole container, one line on it
 * (`lineId`), or - with no `containerId`, for packages still waiting for one -
 * the lines by id (`lineIds`, else the one `lineId`; at most 100). `copies`
 * is one or two labels per piece.
 */
export function packageLabelsRequest(input: {
  businessId: string;
  containerId?: string;
  lineId?: string;
  lineIds?: readonly string[];
  copies?: number;
}): Record<string, unknown> {
  const container = clean(input.containerId, 200);
  const lineId = clean(input.lineId, 200);
  const ids = [...new Set([...(input.lineIds ?? []), lineId].map((id) => clean(id, 200)).filter(Boolean))].slice(0, PACKAGE_LABELS_MAX_LINES);
  return {
    businessId: clean(input.businessId, 200),
    containerId: container,
    copies: (input.copies ?? PACKAGE_LABEL_COPIES_PRINTER) === 1 ? 1 : 2,
    ...(!container && ids.length ? { lineIds: ids } : {}),
    ...(container && lineId ? { lineId } : {}),
  };
}

function clean(value: unknown, max: number): string {
  const text = value === null || value === undefined ? "" : String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
}

function positive(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1 ? Math.round(value) : fallback;
}

/** The host the public tracking page lives on (what the QR opens). */
export const PACKAGE_LINK_HOST = "customer.laawoldigital.com";

/** The link a label's QR holds when the server sent none: `/t/<code>`. */
export function packageTrackingLink(code: string): string {
  return `https://${PACKAGE_LINK_HOST}/t/${code.trim().toUpperCase()}`;
}

/** One printed label, as the server describes it. */
export type PackageLabel = {
  code: string;
  /** The public tracking link the QR holds. */
  link: string;
  what: string;
  vin: string;
  packageNumber: number;
  packageCount: number;
  receiver: string;
  receiverPhone: string;
  sender: string;
  senderPhone: string;
  destination: string;
  size: string;
  /** Destination and size together ("Guinea · 40 × 30 × 20 in"). */
  place: string;
};

/** Tolerant: a missing link is the one the code would have; a missing place is built from destination and size. */
export function packageLabelFromRow(row: Record<string, unknown>): PackageLabel {
  const code = clean(row.code, 40).toUpperCase();
  const link = clean(row.link, 300);
  const destination = clean(row.destination, 120);
  const size = clean(row.size, 80);
  const place = clean(row.place, 200);
  const count = positive(row.packageCount, 1);
  const number = positive(row.packageNumber, 1);
  return {
    code,
    link: link || packageTrackingLink(code),
    what: clean(row.what, 120),
    vin: clean(row.vin, 17),
    packageNumber: number > count ? count : number,
    packageCount: count,
    receiver: clean(row.receiver, 120),
    receiverPhone: clean(row.receiverPhone, 40),
    sender: clean(row.sender, 120),
    senderPhone: clean(row.senderPhone, 40),
    destination,
    size,
    place: place || [destination, size].filter(Boolean).join(" · "),
  };
}

/** What `getPackageLabels` answers: every label in print order, and what the footer says. */
export type PackageLabelSet = {
  labels: PackageLabel[];
  /** The container's number (or name); empty for waiting packages. */
  reference: string;
  hasContainer: boolean;
  businessName: string;
  businessPhone: string;
};

/** Reads the callable's answer. A label without a code is left out. */
export function packageLabelSetFromResponse(data: unknown): PackageLabelSet {
  const map = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const raw = Array.isArray(map.labels) ? map.labels : [];
  const labels: PackageLabel[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const label = packageLabelFromRow(row as Record<string, unknown>);
    if (label.code) labels.push(label);
  }
  return {
    labels,
    reference: clean(map.reference, 120),
    hasContainer: map.hasContainer === true,
    businessName: clean(map.businessName, 160),
    businessPhone: clean(map.businessPhone, 40),
  };
}

// ---------------------------------------------------------------------------
// The layout.
// ---------------------------------------------------------------------------

/** The parts of a label, top to bottom. */
export type PackageLabelPart =
  | "code"
  | "what"
  | "vin"
  | "toCaption"
  | "receiver"
  | "receiverPhone"
  | "fromCaption"
  | "sender"
  | "senderPhone"
  | "place"
  | "footer"
  | "reference";

export type PackageLabelAlign = "left" | "center" | "right";

/** The two captions are printed in both languages at once: the readers may read either. */
export const PACKAGE_LABEL_TO_CAPTION = "TO / POUR";
export const PACKAGE_LABEL_FROM_CAPTION = "FROM / DE";

/** The footer's name when the business has none on file. */
export const PACKAGE_LABEL_DEFAULT_BUSINESS = "Laawol Digital";

/** The parts that are never cut: shrunk to fit instead. */
export const PACKAGE_LABEL_WHOLE_PARTS: ReadonlySet<PackageLabelPart> = new Set<PackageLabelPart>([
  "code",
  "vin",
  "receiverPhone",
  "senderPhone",
  "reference",
]);

/** One line of text on the label: its box (mm from the top-left) and its font size (mm, the em size). */
export type PackageLabelText = {
  part: PackageLabelPart;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontMm: number;
  bold: boolean;
  mono: boolean;
  align: PackageLabelAlign;
  /** Printed whole, never cut. */
  whole: boolean;
};

/** Where everything sits on one label. */
export type PackageLabelLayout = {
  size: LabelSize;
  margin: number;
  /** The QR's square, quiet zone included (mm). */
  qrLeft: number;
  qrTop: number;
  qrSide: number;
  link: string;
  texts: PackageLabelText[];
  /** The thin line above the footer; null when there is none. */
  ruleTop: number | null;
};

/** The footer rule's thickness and the white modules kept around the QR. */
export const PACKAGE_LABEL_RULE_MM = 0.25;
export const PACKAGE_LABEL_QUIET_MODULES = 2;

// Glyph advance as a share of the font size: a fixed-width face is about 0.6;
// the sans estimate sits a little above Helvetica Bold's average so a line
// judged to fit does. The renderer still shrinks anything wider.
const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.64;
const LINE_HEIGHT = 1.18;

/** The width `text` takes at `fontMm`, estimated (mm). */
export function estimatePackageTextWidth(text: string, fontMm: number, mono = false): number {
  return Array.from(text).length * fontMm * (mono ? MONO_ADVANCE : SANS_ADVANCE);
}

/** `text` cut to `maxChars` characters with "…" when longer. */
export function ellipsizePackageText(text: string, maxChars: number): string {
  const runes = Array.from(text);
  if (runes.length <= maxChars) return text;
  if (maxChars <= 1) return "…";
  return `${runes.slice(0, maxChars - 1).join("").trimEnd()}…`;
}

/** The code line: the code, and which piece of the line this is - "CL-K7M4P2 · 1 of 3". */
export function packageLabelCodeLine(label: Pick<PackageLabel, "code" | "packageNumber" | "packageCount">): string {
  return label.packageCount > 1 ? `${label.code} · ${label.packageNumber} of ${label.packageCount}` : label.code;
}

/** The footer's left half: the business and its phone. */
export function packageLabelFooter(businessName: string, businessPhone: string): string {
  const name = businessName.trim() || PACKAGE_LABEL_DEFAULT_BUSINESS;
  const phone = businessPhone.trim();
  return phone ? `${name} · ${phone}` : name;
}

type Line = { part: PackageLabelPart; text: string; scale: number; mono: boolean; bold: boolean; gapBefore: boolean };

function line(part: PackageLabelPart, text: string, scale: number, extra: Partial<Pick<Line, "mono" | "bold" | "gapBefore">> = {}): Line {
  return { part, text, scale, mono: extra.mono ?? false, bold: extra.bold ?? true, gapBefore: extra.gapBefore ?? false };
}

/**
 * Lays out one label on `size`. The QR goes on top, as large as the label
 * allows while the text keeps a readable size; the text block follows, every
 * line sized from one unit so the parts keep their proportions; the footer
 * sits on the bottom edge.
 */
export function layoutPackageLabel(
  label: PackageLabel,
  options: { size?: LabelSize; businessName?: string; businessPhone?: string; reference?: string } = {},
): PackageLabelLayout {
  const size = options.size ?? PM241_LABEL_SIZE;
  const w = size.widthMm;
  const h = size.heightMm;
  const big = w >= 90;
  const margin = big ? 6.35 : Math.min(3, Math.max(1.2, Math.min(w, h) * 0.04));
  const innerW = w - 2 * margin;
  const innerH = h - 2 * margin;
  const gap = Math.max(0.5, innerH * 0.012);

  const code = packageLabelCodeLine(label);
  const hasTo = label.receiver !== "" || label.receiverPhone !== "";
  const hasFrom = label.sender !== "" || label.senderPhone !== "";
  const lines: Line[] = [line("code", code, 2.0, { mono: true })];
  if (label.what) lines.push(line("what", label.what, 1.1));
  if (label.vin) lines.push(line("vin", `VIN ${label.vin}`, 0.8, { mono: true, bold: false }));
  if (hasTo) lines.push(line("toCaption", PACKAGE_LABEL_TO_CAPTION, 0.55, { gapBefore: true }));
  if (label.receiver) lines.push(line("receiver", label.receiver, 1.3));
  if (label.receiverPhone) lines.push(line("receiverPhone", label.receiverPhone, 1.0));
  if (hasFrom) lines.push(line("fromCaption", PACKAGE_LABEL_FROM_CAPTION, 0.55, { gapBefore: true }));
  if (label.sender) lines.push(line("sender", label.sender, 1.0));
  if (label.senderPhone) lines.push(line("senderPhone", label.senderPhone, 0.95));
  if (label.place) lines.push(line("place", label.place, 0.85, { bold: false, gapBefore: true }));
  const footerScale = 0.6;

  // Height in "units" (one unit = the font size of a 1.0 line) and in mm.
  const units = lines.reduce((sum, l) => sum + l.scale * LINE_HEIGHT, 0) + footerScale * LINE_HEIGHT;
  const gaps = gap * (lines.filter((l) => l.gapBefore).length + 2) + PACKAGE_LABEL_RULE_MM;
  const uMax = big ? 4.6 : 4.2;
  const uMin = big ? 2.2 : 1.5;

  // The QR: 2.6 in on a 4 x 6, else 45 % of the height. It gives way to keep
  // the text readable, but not below a floor, and never past 60 % of what is
  // left after the gaps.
  const qrFloor = Math.min(innerW, big ? 50 : 30);
  let qr = big ? Math.min(innerW, 66.04) : Math.min(innerW, innerH * 0.45);
  const roomForText = innerH - uMin * units - gaps;
  if (qr > roomForText) qr = Math.max(Math.min(qrFloor, qr), roomForText);
  qr = Math.min(qr, (innerH - gaps) * 0.6);
  if (qr < 0) qr = 0;
  let u = (innerH - qr - gaps) / units;
  if (u > uMax) u = uMax;
  if (u < 0) u = 0;

  const texts: PackageLabelText[] = [];
  let y = margin + qr + gap;
  for (const l of lines) {
    if (l.gapBefore) y += gap;
    const nominal = l.scale * u;
    const whole = PACKAGE_LABEL_WHOLE_PARTS.has(l.part);
    const advance = l.mono ? MONO_ADVANCE : SANS_ADVANCE;
    let font = nominal;
    let text = l.text;
    if (whole) {
      const fit = innerW / (Math.max(1, Array.from(text).length) * advance);
      if (font > fit) font = fit;
    } else if (font > 0) {
      text = ellipsizePackageText(text, Math.floor(innerW / (font * advance)));
    }
    const height = nominal * LINE_HEIGHT;
    texts.push({ part: l.part, text, left: margin, top: y, width: innerW, height, fontMm: font, bold: l.bold, mono: l.mono, align: "center", whole });
    y += height;
  }

  // The footer on the bottom edge: the business on the left, the container
  // on the right, whole.
  const footFont = footerScale * u;
  const footH = footFont * LINE_HEIGHT;
  const footTop = margin + innerH - footH;
  const ref = (options.reference ?? "").trim();
  let refW = 0;
  if (ref) {
    refW = Math.min(estimatePackageTextWidth(ref, footFont), innerW * 0.45);
    let refFont = footFont;
    const fit = refW / (Math.max(1, Array.from(ref).length) * SANS_ADVANCE);
    if (refFont > fit) refFont = fit;
    texts.push({
      part: "reference",
      text: ref,
      left: margin + innerW - refW,
      top: footTop,
      width: refW,
      height: footH,
      fontMm: refFont,
      bold: true,
      mono: false,
      align: "right",
      whole: true,
    });
  }
  const footW = innerW - (ref ? refW + 1.5 : 0);
  const footer = packageLabelFooter(options.businessName ?? "", options.businessPhone ?? "");
  texts.push({
    part: "footer",
    text: footFont > 0 ? ellipsizePackageText(footer, Math.floor(footW / (footFont * SANS_ADVANCE))) : footer,
    left: margin,
    top: footTop,
    width: footW,
    height: footH,
    fontMm: footFont,
    bold: true,
    mono: false,
    align: "left",
    whole: false,
  });

  return {
    size,
    margin,
    qrLeft: (w - qr) / 2,
    qrTop: margin,
    qrSide: qr,
    link: label.link,
    texts,
    ruleTop: footTop - gap / 2 - PACKAGE_LABEL_RULE_MM,
  };
}

/** The layout's text for one part, if the label has it. */
export function layoutPart(layout: PackageLabelLayout, part: PackageLabelPart): PackageLabelText | undefined {
  return layout.texts.find((t) => t.part === part);
}
