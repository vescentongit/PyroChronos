import type { Metadata } from "next";
import localFont from "next/font/local";

import "./globals.css";
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

export const metadata: Metadata = {
  title: "PyroChronos · Fire intelligence",
  description: "Konteks historis untuk keputusan patroli hari ini.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body className={plusJakartaSans.variable}>
        <template
          id="pyro-design-contract"
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Begin with Earth, reveal illustrative fire evidence, then enter regional analysis. OWN-WORLD: NASA palette, near-black canvas, white geography, red detections, blue information, Plus Jakarta Sans as requested. STORY: Explore a globe, understand two sensors, open Simulation. FIRST VIEWPORT: Unframed narrative on the left; large dotted globe and CTA below on the right. FORM: user-pinned new-design.md and new-design.png; seed d6c91931, pinned brief overrides assignment. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md -->",
          }}
        />
        {children}
      </body>
    </html>
  );
}
