> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# Implementation of new-design.md

## Routes and interaction

- `/`: NASA-palette Home with dotted geographic globe. Hover/focus or Hotspot demo reveals illustrative detections. Drag/arrows rotate, scroll or +/- zoom, reset returns to Indonesia, pause/reduced motion controls automatic rotation.
- `/simulation`: existing dashboard, recolored consistently and isolated by `.simulation-root` CSS.
- Region links include `?region=kalteng` or `?region=papua`; EN/ID persists between both pages.

Plus Jakarta Sans remains local; OFL license is included in `public/fonts`. The globe uses `d3-geo`, the geographic part of D3. No extra shadcn primitives are required by this Canvas component. Natural Earth polygons and derived dots are local, with provenance in `public/geo/README.md`.

## Checks and review

- Production build passed; both Home and Simulation are generated.
- Typecheck passed. Nonincremental checks avoid a stale TypeScript 7 cache after adding a route.
- Eight frontend checks and six HTTP smoke checks passed.
- Mechanical detector ran once and reported no findings.
- Isolated local Chrome desktop (1440×1000) and mobile (390×844) checks verified canvas loading, hotspot toggle, reduced motion, no horizontal overflow, Papua navigation, EN/ID persistence, demo report save/correction, missing operational snapshot isolation, and CSS isolation after navigating back Home. No runtime exceptions were observed.
- Real touch input confirmed tapping outside pinned hotspots does not navigate. Keyboard input confirmed the focus treatment.
- With the Esri tile host deliberately blocked, the underlying MapLibre surface was hidden/inert and only the fallback SVG remained. Desktop/mobile captures confirmed white keyboard focus and no overflow.

| Original review finding | Final score |
|---|---|
| Mobile region selector unreadable | Resolved |
| Duplicate MapLibre and fallback positions | Resolved |
| Stale hotspot selected on touch | Resolved |
| Region and SVG keyboard focus | Resolved |

Final reviewer disposition: **ship**. Design system: [DESIGN.md](../DESIGN.md). Surface strategy: [home-surface-brief.md](home-surface-brief.md).

Local verification captures: [Home desktop](../.cache/new-design-final/home-desktop.png), [Home mobile](../.cache/new-design-final/home-mobile.png), [Simulation desktop fallback](../.cache/new-design-final/simulation-fallback-desktop.png), [Simulation mobile fallback](../.cache/new-design-final/simulation-fallback-mobile.png). These are development artifacts under ignored `.cache`.

## Remaining product dependencies

This redesign does not deliver FIRMS ingestion, validated harmonization, `/api/snapshots`, individual coordinator identity, or production report correction. Globe and default Simulation data remain explicitly illustrative. Operational mode keeps its unavailable/stale behavior and never substitutes the demo.
