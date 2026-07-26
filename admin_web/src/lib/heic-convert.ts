const HEIC_MIME_TYPES = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

function looksLikeHeic(file: File): boolean {
  if (HEIC_MIME_TYPES.has(file.type.toLowerCase())) return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

// Chrome, Firefox, and Edge cannot decode HEIC/HEIF in <img> tags (only
// Safari's own image codecs can), so a HEIC file uploaded as-is renders as a
// broken image everywhere except Safari - including on public, customer-facing
// pages like business logos and car listings. Convert to JPEG at selection
// time so nothing HEIC ever reaches Storage.
export async function ensureBrowserDisplayableImage(file: File): Promise<File> {
  if (!looksLikeHeic(file)) return file;
  const heic2any = (await import("heic2any")).default;
  const result = await heic2any({blob: file, toType: "image/jpeg", quality: 0.92});
  const blob = Array.isArray(result) ? result[0] : result;
  const newName = file.name.replace(/\.(heic|heif)$/i, ".jpg") || "image.jpg";
  return new File([blob], newName, {type: "image/jpeg"});
}
