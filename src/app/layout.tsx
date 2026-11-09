import type { Metadata } from "next";
import localFont from "next/font/local";

import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import "./workspace.css";

const plusJakartaSans = localFont({
  src: [
    {
      path: "../../public/fonts/plus-jakarta-400.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/plus-jakarta-500.ttf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/plus-jakarta-600.ttf",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../public/fonts/plus-jakarta-700.ttf",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PyroChronos · Fire intelligence",
  description: "Konteks historis untuk keputusan patroli hari ini.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={plusJakartaSans.variable}>{children}</body>
    </html>
  );
}
