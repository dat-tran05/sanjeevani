import type { Metadata } from "next";
import { Suspense } from "react";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { TopBar } from "@/components/shell/TopBar";
import { FacilityDrawer } from "@/components/drawer/FacilityDrawer";
import "./globals.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz"],
});
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Sanjeevani — Find help. Save lives.",
  description:
    "A reasoning layer over 10,053 Indian healthcare facilities — ranked, cited, verified by three independent AI judges.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body data-mode="dark" data-palette="warm" data-display="fraunces" data-topo="on">
        <Suspense fallback={null}>
          <TopBar />
        </Suspense>
        {children}
        <Suspense fallback={null}>
          <FacilityDrawer />
        </Suspense>
      </body>
    </html>
  );
}
