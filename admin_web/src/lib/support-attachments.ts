import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

import { storage } from "@/lib/firebase";
import { ensureBrowserDisplayableImage } from "@/lib/heic-convert";

export type SupportAttachmentPayload = {
  caseId: string;
  fileUrl: string;
  filePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  messageType: string;
};

export function inferSupportMessageType(mimeType: string) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "voice";
  return "file";
}

// Uploads a file to the case's own storage path and returns the payload
// shape uploadSupportAttachmentMetadata expects. Shared by every support UI
// (customer, business, admin) so the upload contract - path shape, field
// names, message-type inference - never drifts between them; see
// support_cases/{caseId}/{uploaderUid}/** in storage.rules. Callers invoke
// the callable themselves (each UI wraps it differently - confirmation +
// busy-label tracking on the business/admin console, a plain timeout guard
// for the customer console).
export async function uploadSupportAttachmentFile({
  caseId,
  uploaderUid,
  file: rawFile,
}: {
  caseId: string;
  uploaderUid: string;
  file: File;
}): Promise<SupportAttachmentPayload> {
  const file = await ensureBrowserDisplayableImage(rawFile);
  const safeName = file.name
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-");
  const path = `support_cases/${caseId}/${uploaderUid}/${Date.now()}-${safeName}`;
  const mimeType = file.type || "application/octet-stream";
  const target = storageRef(storage, path);
  await uploadBytes(target, file, { contentType: mimeType });
  const fileUrl = await getDownloadURL(target);
  return {
    caseId,
    fileUrl,
    filePath: path,
    fileName: file.name,
    mimeType,
    fileSize: file.size,
    messageType: inferSupportMessageType(mimeType),
  };
}
