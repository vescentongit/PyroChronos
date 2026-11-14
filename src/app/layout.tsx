import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
import { FxLayer } from "@/components/fx-layer";
import "./home.css";

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

const unbounded = localFont({
  src: [
    { path: "../../public/fonts/unbounded-800.woff2", weight: "800", style: "normal" },
    { path: "../../public/fonts/unbounded-900.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = localFont({
  src: [
    { path: "../../public/fonts/jetbrains-mono-500.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/jetbrains-mono-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PyroChronos · Fire intelligence",
  description: "Konteks historis untuk keputusan patroli hari ini.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body
        className={`${plusJakartaSans.variable} ${unbounded.variable} ${jetbrainsMono.variable}`}
      >
        <template
          id="pyro-design-contract"
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Begin with Earth, reveal illustrative fire evidence, then enter regional analysis. OWN-WORLD: NASA palette, near-black canvas, white geography, red detections, blue information, Plus Jakarta Sans as requested. STORY: Explore a globe, understand two sensors, open Simulation. FIRST VIEWPORT: Unframed narrative on the left; large dotted globe and CTA below on the right. FORM: user-pinned new-design.md and new-design.png; seed d6c91931, pinned brief overrides assignment. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
        />
        <FxLayer />
        {children}
      </body>
    </html>
  );
}
