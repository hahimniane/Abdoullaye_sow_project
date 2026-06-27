import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Laawol Digital Admin",
  description: "Admin console for Laawol Digital operations",
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
