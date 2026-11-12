import type { Metadata } from "next";
import { ACTIVE_FIREBASE_CONFIG } from "@/lib/project-config";
import "./globals.css";

import { ActionConfirmationHost } from "@/components/action-confirmation-dialog";
import { LANGUAGE_BOOT_SCRIPT } from "@/lib/language";

export const metadata: Metadata = {
  // Deliberately no `title` here. The App Router writes a metadata <title>
  // during hydration, and that write lands after any effect a console can run
  // - so a static title here silently wins and every subdomain ends up with
  // the same tab name. Each console sets its own via useConsoleDocumentTitle
  // (lib/document-title.ts); the static fallback lives in the <title> tag in
  // this file's <head>, which React leaves alone.
  description: "Laawol Digital operations console",
  other: {
    google: "notranslate",
  },
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the boot script below sets `lang` (and, for a
    // French page, data-lang-pending) on this element before React hydrates.
    <html className="notranslate" lang="en" translate="no" suppressHydrationWarning>
      <head>
        {/* Before first paint: pick the language and, when it is French, keep
            the page hidden until french-dom-runtime has translated it. */}
        <script dangerouslySetInnerHTML={{ __html: LANGUAGE_BOOT_SCRIPT }} />
        {/* Pre-hydration fallback only. Written as a plain tag rather than
            metadata.title so React does not re-assert it over the runtime
            title each console sets for itself. */}
        <title>Laawol Digital</title>
        {/* Open the connections the first server call needs while the page's
            code is still downloading: reCAPTCHA (App Check) and the
            functions host. Saves a few round trips on "Send a package". */}
        <link rel="preconnect" href="https://www.google.com" />
        <link rel="preconnect" href="https://www.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href={`https://us-central1-${ACTIVE_FIREBASE_CONFIG.projectId}.cloudfunctions.net`} crossOrigin="" />
        <link rel="dns-prefetch" href="https://firestore.googleapis.com" />
      </head>
      <body>
        {children}
        {/* Mounted once for every console so confirmImportantAction always
            has somewhere to ask, on any route. */}
        <ActionConfirmationHost />
      </body>
    </html>
  );
}
