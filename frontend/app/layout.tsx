import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mason Home — SKU Intelligence",
  description: "Product profitability and merchandise intelligence workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
