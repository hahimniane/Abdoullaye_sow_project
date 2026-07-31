"use client";

import { FileText } from "lucide-react";

// Shared image/file rendering for a support message bubble - used by the
// customer, business, and admin support UIs so an attachment looks and
// behaves the same everywhere it appears.
export function AttachmentPreview({
  fileUrl,
  fileName,
  isImage,
}: {
  fileUrl: string;
  fileName: string;
  isImage: boolean;
}) {
  if (!fileUrl) return null;
  if (isImage) {
    return (
      <a href={fileUrl} rel="noreferrer" target="_blank">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt={fileName} className="bubble-image" src={fileUrl} />
      </a>
    );
  }
  return (
    <a className="bubble-file" href={fileUrl} rel="noreferrer" target="_blank">
      <FileText size={14} /> {fileName}
    </a>
  );
}
