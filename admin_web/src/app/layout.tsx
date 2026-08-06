import type { Metadata } from "next";
import "./globals.css";

import { ActionConfirmationHost } from "@/components/action-confirmation-dialog";

export const metadata: Metadata = {
  title: "Administration Laawol Digital",
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
      <body>
        {children}
        {/* Mounted once for every console so confirmImportantAction always
            has somewhere to ask, on any route. */}
        <ActionConfirmationHost />
      </body>
    </html>
  );
}
