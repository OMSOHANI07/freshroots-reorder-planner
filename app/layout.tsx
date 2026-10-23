import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Freshroots Reorder Planner",
  description: "Turns weekly SAP sales and stock into a reorder plan Raghav approves, then into purchase orders in ERPNext.",
};

export const viewport: Viewport = { themeColor: "#fbfbfd", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-dvh bg-paper text-ink">
        <Providers>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-14 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
            Skip to content
          </a>
          <Nav />
          <main id="main">{children}</main>
          <footer className="border-t border-hairline px-4 py-10 text-center text-xs text-muted sm:px-6">
            Freshroots Reorder Planner · The rules engine recommends. Raghav decides. Purchase orders go to ERPNext.
          </footer>
        </Providers>
      </body>
    </html>
  );
}
