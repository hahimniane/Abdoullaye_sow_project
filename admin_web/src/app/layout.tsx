import type { Metadata } from "next";
import "./globals.css";

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
      <body>{children}</body>
    </html>
  );
}
