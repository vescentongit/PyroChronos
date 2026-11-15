---
version: 1
slug: "src-app-page-tsx"
primary_target: "src/app/page.tsx"
related_targets: ["src/components/home-page.tsx","src/app/home.css","src/components/ui/wireframe-dotted-globe.tsx","src/app/simulation/page.tsx"]
---


> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Home / Simulation — surface brief

Scope: `/` introduces PyroChronos through a real interactive geographic globe (Experience/Persuade). `/simulation` is the existing analysis workspace (Operate).

Audience: people exploring the NASA Space Apps project and analysts entering regional activity analysis. Primary action: open Simulation, optionally choosing the Kalimantan Tengah or Papua Selatan study subset.

Pinned direction: `new-design.md` specifies a dotted wireframe globe and NASA palette; `new-design.png` supplies the large-globe topology reference. Plus Jakarta Sans and EN/ID are retained from the existing product. The brief overrides degraded seed d6c91931; no new direction selection is required.

First viewport: unframed narrative on the left, large geographic globe on the right, Simulation CTA below the globe. Mobile stacks narrative, globe, controls, readout, and CTA in that order. A saturated blue information section explains the two-sensor mechanism below the introduction.

| Ingredient | Implementation medium |
|---|---|
| Navigation, headline, information, CTA | Semantic HTML/Next links; Plus Jakarta Sans; CSS |
| Wireframe, coastline, land dots | D3 geographic projection + Canvas, local Natural Earth data, 2,934 precomputed land dots |
| Hotspot reveal and readout | Eight labelled illustrative fixtures, Canvas hit testing, React readout |
| Drag, zoom, keyboard, pause | Pointer events, arrow/+/- keys, native buttons, reduced-motion preference |
| UI icons | Lucide SVG |
| Geographic fallback | Status text and direct Simulation/region links; analysis map has separate SVG fallback |

Memorable interaction: hovering/focusing the globe reveals illustrative fire detections; actual hotspot taps can enter a region. Taps away from markers do not navigate. The far hemisphere is culled.

State and truth: globe markers are illustrative, not current FIRMS observations. Operational analytics remain unavailable until the real snapshot API is delivered. Individual authentication and production report correction remain backend dependencies. CSS for Simulation is scoped so it cannot affect Home after navigation.

Finish: second review disposition `ship`; four initial material findings resolved (mobile region selector, duplicate fallback surface, stale tap selection, visible keyboard focus). No unresolved visual decisions.
