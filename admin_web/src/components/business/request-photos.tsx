"use client";

import { useEffect, useState } from "react";
import { getDownloadURL, ref } from "firebase/storage";
import { RefreshCw } from "lucide-react";

import { storage } from "@/lib/firebase";

/** The customer's photos of a piece, as thumbnails that open full size. */
export function RequestPhotos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = paths.join("|");
  useEffect(() => {
    let active = true;
    for (const path of key ? key.split("|") : []) {
      getDownloadURL(ref(storage, path))
        .then((url) => {
          if (active) setUrls((current) => ({ ...current, [path]: url }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [key]);
  if (paths.length === 0) return null;
  return (
    <span className="pkq-photos">
      {paths.map((path) =>
        urls[path] ? (
          <a href={urls[path]} key={path} rel="noopener noreferrer" target="_blank">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt="Photo from the customer" src={urls[path]} />
          </a>
        ) : (
          <span className="pkq-photo-wait" key={path}><RefreshCw className="spin" size={12} aria-hidden="true" /></span>
        ),
      )}
    </span>
  );
}
