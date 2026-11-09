import type { Metadata } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./simulation.css";

export const metadata: Metadata = { title: "Simulation · PyroChronos" };

export default function SimulationLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="simulation-root">{children}</div>;
}
