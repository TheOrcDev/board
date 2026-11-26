import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { ABOUT, NAME } from "@/lib/board";
import "./globals.css";

export const metadata: Metadata = { title: `${NAME} grid`, description: ABOUT };

export const viewport: Viewport = { colorScheme: "dark", themeColor: "#07080a" };

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
