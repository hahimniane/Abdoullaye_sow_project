"use client";

import { useState } from "react";
import { Tag } from "lucide-react";

import { devicePlatform, storeLinksFor } from "@/lib/app-store-links";
import { ITEM_TAG_NOTICE } from "@/lib/customer-service-intent";

/**
 * Where a phone camera lands when it scans a shop's inventory tag
 * (`https://customer.laawoldigital.com/i/<CODE>`). The tag belongs to the
 * shop's staff, who scan it in the Laawol app (the link opens the app when it
 * is installed), so a customer who scans one sees only this notice: nothing
 * about the product, the price or the shop, and no sign-in. It reads nothing
 * from the database and never looks at the code in the address.
 */
export function ItemTagPage() {
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
    <div className="customer-entry-shell">
      <header className="customer-entry-header">
        <a className="customer-entry-brand" href="https://laawoldigital.com">
          <span className="brand-badge">Laawol Digital</span>
        </a>
      </header>
      <main className="customer-entry-main">
        <section aria-labelledby="item-tag-title" className="panel item-tag-notice">
          <Tag aria-hidden="true" size={28} />
          <h1 id="item-tag-title">Shop staff tag</h1>
          <p>{ITEM_TAG_NOTICE}</p>
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
                {link.label}
              </a>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
