"use client";

import { ref, uploadBytes } from "firebase/storage";

import { auth, storage } from "@/lib/firebase";
import { MAX_PHOTOS, PACKAGE_PHOTO_ROOT, packagePhotoParts, packagePhotoPath, photoPathUnder } from "@/lib/package-proof";
import { compressRequestPhoto } from "@/lib/request-photo";
import { STAFF_HANDOVER_PROOF_ROOT } from "@/lib/staff-balances";

/**
 * Staff photos on a package (docs/AIR_PACKAGES.md §2 "Storage"): drop-off
 * photos and the delivered-without-code photo. They go to the signed-in
 * staff member's own folder, `packagePhotos/{businessId}/{uid}/{fileId}.jpg`;
 * the server checks the same rule (package_proof.photoPathAllowed) when the
 * path is attached to a line. The path shape itself lives in the pure
 * `package-proof.ts` (unit-tested without Firebase) and is re-exported here.
 */
export { PACKAGE_PHOTO_ROOT, packagePhotoParts, packagePhotoPath };
export const MAX_PACKAGE_PHOTOS = MAX_PHOTOS;

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
  return uploadStaffPhotoUnder(PACKAGE_PHOTO_ROOT, businessId, file);
}

/**
 * A photo of a hand-over slip or screenshot (docs/STAFF_BALANCES.md §2),
 * compressed and uploaded the same way under
 * `staffHandoverProofs/{businessId}/{uid}/{fileId}.jpg`; returns the path
 * for `record_handover`'s `proofPath`. Same errors as uploadPackagePhoto.
 */
export async function uploadStaffHandoverProof(businessId: string, file: File): Promise<string> {
  return uploadStaffPhotoUnder(STAFF_HANDOVER_PROOF_ROOT, businessId, file);
}

async function uploadStaffPhotoUnder(root: string, businessId: string, file: File): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("no-session");
  const blob = await compressRequestPhoto(file);
  const path = photoPathUnder(root, businessId, uid, randomFileId());
  if (!path) throw new Error("no-session");
  await uploadBytes(ref(storage, path), blob, { contentType: "image/jpeg" });
  return path;
}
