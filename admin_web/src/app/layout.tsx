import type { Metadata } from "next";
import "./globals.css";

import { ActionConfirmationHost } from "@/components/action-confirmation-dialog";

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
    <html className="notranslate" lang="en" translate="no">
      <head>
        {/* Pre-hydration fallback only. Written as a plain tag rather than
            metadata.title so React does not re-assert it over the runtime
            title each console sets for itself. */}
        <title>Laawol Digital</title>
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
