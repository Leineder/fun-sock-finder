import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fun Sock Finder",
  description: "The newest fun socks at Target, all in one place.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
