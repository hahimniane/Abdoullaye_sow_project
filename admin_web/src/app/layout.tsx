import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Administration Laawol Digital",
  description: "Console d’administration des opérations Laawol Digital",
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
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
