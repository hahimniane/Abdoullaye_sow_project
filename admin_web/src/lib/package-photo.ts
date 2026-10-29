"use client";

import { ref, uploadBytes } from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import { compressRequestPhoto } from "@/lib/request-photo";

/**
 * Staff photos on a package (docs/AIR_PACKAGES.md §2 "Storage"): drop-off
 * photos and the delivered-without-code photo. They go to the signed-in
 * staff member's own folder, `packagePhotos/{businessId}/{uid}/{fileId}.jpg`;
 * the server checks the same rule (package_proof.photoPathAllowed) when the
 * path is attached to a line.
 */
export const PACKAGE_PHOTO_ROOT = "packagePhotos";
export const MAX_PACKAGE_PHOTOS = 5;

const FILE_ID = /^[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/;

export function packagePhotoPath(businessId: string, uid: string, fileId: string): string {
  if (!businessId || !uid || !FILE_ID.test(fileId)) return "";
  return `${PACKAGE_PHOTO_ROOT}/${businessId}/${uid}/${fileId}`;
}

/** The parts of a package photo path, or null for anything else. */
export function packagePhotoParts(path: string): { businessId: string; folder: string; fileId: string } | null {
  const parts = String(path || "").split("/");
  if (parts.length !== 4 || parts[0] !== PACKAGE_PHOTO_ROOT) return null;
  const [, businessId, folder, fileId] = parts;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(businessId) || !/^[A-Za-z0-9_-]{2,128}$/.test(folder)) return null;
  if (!FILE_ID.test(fileId)) return null;
  return { businessId, folder, fileId };
}

function randomFileId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("") + ".jpg";
}

/**
 * Compresses (JPEG, ≤1600 px, ~1.5 MB) and uploads one photo to the signed-in
 * staff member's folder; returns the Storage path to put on the line.
 * Throws "no-session", "not-an-image", "image-unreadable" or "image-too-large".
 */
export async function uploadPackagePhoto(businessId: string, file: File): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("no-session");
  const blob = await compressRequestPhoto(file);
  const path = packagePhotoPath(businessId, uid, randomFileId());
  if (!path) throw new Error("no-session");
  await uploadBytes(ref(storage, path), blob, { contentType: "image/jpeg" });
  return path;
}
