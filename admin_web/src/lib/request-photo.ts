"use client";

import { signInAnonymously } from "firebase/auth";
import { ref, uploadBytes } from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import { completeGuestSignIn } from "@/lib/guest-session";
import { ensureBrowserDisplayableImage } from "@/lib/heic-convert";
import {
  COMPRESSION_QUALITIES,
  REQUEST_LIMITS,
  compressedSize,
  photoUploadPath,
} from "@/lib/package-requests";

/**
 * The session a request is sent with: the signed-in customer, or an
 * anonymous one started here (docs/PACKAGE_REQUESTS.md §8.1, §8.4). A guest
 * has no account and needs none; the anonymous uid only owns their uploads.
 */
export async function ensureRequestSession(): Promise<string> {
  await completeGuestSignIn({
    isAnonymous: Boolean(auth.currentUser),
    signInAnonymously: () => signInAnonymously(auth),
    isAnonymousAfter: () => Boolean(auth.currentUser),
  });
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("no-session");
  return uid;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("image-unreadable"));
      image.src = url;
    });
    return image;
  } finally {
    // The decoded image keeps its pixels; the object URL is not needed after.
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/**
 * A photo as it is uploaded: a JPEG, its longest side at most 1600 px, at
 * the best quality that fits ~1.5 MB. HEIC from iPhones is converted first.
 * Throws "image-too-large" when nothing fits (the rule refuses 2 MB).
 */
export async function compressRequestPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    throw new Error("not-an-image");
  }
  const displayable = await ensureBrowserDisplayableImage(file);
  const image = await loadImage(displayable);
  const size = compressedSize(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("image-unreadable");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size.width, size.height);
  context.drawImage(image, 0, 0, size.width, size.height);
  for (const quality of COMPRESSION_QUALITIES) {
    const blob = await canvasBlob(canvas, quality);
    if (blob && blob.size <= REQUEST_LIMITS.photoTargetBytes) return blob;
  }
  throw new Error("image-too-large");
}

function randomFileId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compresses and uploads one photo to the caller's own folder; returns its path. */
export async function uploadRequestPhoto(businessId: string, file: File): Promise<string> {
  const blob = await compressRequestPhoto(file);
  const uid = await ensureRequestSession();
  const path = photoUploadPath(businessId, uid, randomFileId());
  await uploadBytes(ref(storage, path), blob, { contentType: "image/jpeg" });
  return path;
}
