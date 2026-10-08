"use client";

import { useState } from "react";

import {
  devicePlatform,
  storeLinksFor,
  type StoreLink,
} from "@/lib/app-store-links";

/** The store marks used by the public site's badges (public_site/app.html). */
function StoreGlyph({ store }: { store: StoreLink["store"] }) {
  if (store === "app-store") {
    return (
      <svg aria-hidden="true" fill="currentColor" height="18" viewBox="0 0 24 24" width="18">
        <path d="M16.4 12.7c0-2 1.6-3 1.7-3a3.7 3.7 0 0 0-2.9-1.6c-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2 2.4 2 1 0 1.3-.6 2.5-.6s1.5.6 2.5.6 1.7-.9 2.3-1.9c.7-1 1-2 1-2.1 0 0-2-.8-2.1-2.9zM14.6 6.2c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.7-.4 2.3-1.1z" />
      </svg>
    );
  }
  return (
    <svg aria-hidden="true" height="17" viewBox="0 0 24 24" width="17">
      <path fill="#34d399" d="M3.6 2.3 13 11.7l2.6-2.6L5.2 3a2 2 0 0 0-1.6-.7z" />
      <path fill="#60a5fa" d="M3 2.8C2.8 3.1 2.7 3.5 2.7 4v16c0 .5.1.9.3 1.2L12.4 12 3 2.8z" />
      <path fill="#fbbf24" d="M16.7 9.5 13.7 12l3 2.5 3.2-1.8c.9-.5.9-1.9 0-2.4l-3.2-1.8z" />
      <path fill="#f87171" d="M3.6 21.7c.4.1.9 0 1.6-.4l10.4-6L13 12.3l-9.4 9.4z" />
    </svg>
  );
}

/**
 * Offers the app under a public tracking result. Rendered only on the
 * client (the tracking view is a client-only dynamic import), so the device
 * is known on first paint and the buttons never swap.
 */
export function GetAppBanner() {
  const [links] = useState(() =>
    storeLinksFor(
      typeof navigator === "undefined"
        ? "desktop"
        : devicePlatform({
            userAgent: navigator.userAgent,
            maxTouchPoints: navigator.maxTouchPoints,
          }),
    ),
  );
  return (
    <aside aria-labelledby="get-app-banner-title" className="guest-tracking-upsell get-app-banner">
      <div>
        <strong id="get-app-banner-title">Follow every shipment in the Laawol app</strong>
        <p>Get a notification at each step and keep all your orders in one place.</p>
      </div>
      <div className="guest-tracking-upsell-actions">
        {links.map((link) => (
          <a
            className="primary-button"
            data-store={link.store}
            href={link.href}
            key={link.store}
            rel="noopener noreferrer"
            target="_blank"
          >
            <StoreGlyph store={link.store} />
            {link.label}
          </a>
        ))}
      </div>
    </aside>
  );
}
