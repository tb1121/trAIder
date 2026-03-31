import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "trAIder",
  description: "AI trading coach with Supabase-backed profiles and conversations."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
