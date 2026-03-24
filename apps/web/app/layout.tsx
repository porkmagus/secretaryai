import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Secretary Desk",
  description: "Phase 1 Desk UI for the Secretary-first assistant.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
