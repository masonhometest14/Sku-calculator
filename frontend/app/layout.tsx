import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mason Home — SKU Profitability",
  description: "Product profitability, channel comparisons, and merchandise intelligence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
