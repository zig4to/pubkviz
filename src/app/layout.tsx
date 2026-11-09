import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";
import ThemeScript from "@/components/theme/ThemeScript";
import SsoPrepaintScript from "@/components/auth/SsoPrepaintScript";
import ServiceWorkerRegister from "@/components/pwa/ServiceWorkerRegister";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Garaža pub kviz",
  description: "Pub kviz: vprašanja na projektorju, odgovori s telefona.",
  other: { google: "notranslate" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="sl"
      // Brez samodejnega prevoda (Chrome/Google Translate je npr. ime ekipe
      // „Jesenčki“ prevedel v „autumn“; prevajal bi tudi vprašanja in odgovore).
      translate="no"
      data-theme="dark"
      data-sso="idle"
      suppressHydrationWarning
      className={`${rubik.variable} h-full overflow-x-hidden antialiased`}
    >
      <head>
        <ThemeScript />
        <SsoPrepaintScript />
      </head>
      <body className="flex min-h-full w-full max-w-full flex-col overflow-x-hidden bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
