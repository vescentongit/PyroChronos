---
name: PyroChronos
description: A NASA-palette observatory for illustrative fire evidence and regional historical context.
colors:
  signal: "#fc3c23"
  mission: "#0a3c91"
  spectral: "#ba1e68"
  white: "#ffffff"
  space: "#0e0e0e"
  surface: "#151515"
  control: "#171717"
  notice: "#1b1b1b"
  line: "#303030"
  muted: "#bdbdbd"
  quiet: "#aaaaaa"
  baseline: "#7897c9"
  signal-hover: "#ff705d"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "clamp(44px, 5vw, 80px)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "clamp(34px, 4vw, 58px)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.035em"
  workspace-heading:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "29px"
    fontWeight: 500
    letterSpacing: "-1.2px"
  title:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "17px"
    fontWeight: 550
    letterSpacing: "-0.3px"
  body:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "14px"
  introduction:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "16px"
    lineHeight: 1.85
  label:
    fontFamily: "Plus Jakarta Sans, sans-serif"
    fontSize: "11px"
rounded:
  control: "6px"
  navigation: "7px"
  panel: "8px"
  map-panel: "9px"
  dialog: "12px"
  dot: "50%"
spacing:
  compact: "8px"
  small: "12px"
  regular: "16px"
  comfortable: "20px"
  section: "24px"
  wide: "32px"
  desktop-gutter: "42px"
components:
  button-primary:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.space}"
    rounded: "{rounded.control}"
    padding: "17px 24px"
  button-primary-hover:
    backgroundColor: "{colors.signal-hover}"
  button-workspace:
    backgroundColor: "{colors.signal}"
    textColor: "{colors.space}"
    rounded: "{rounded.control}"
    padding: "11px 15px"
  button-outline:
    backgroundColor: "{colors.control}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "11px 15px"
  region-select:
    backgroundColor: "{colors.control}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "9px 12px"
  navigation-active:
    backgroundColor: "{colors.mission}"
    textColor: "{colors.white}"
    rounded: "{rounded.navigation}"
    padding: "13px 14px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.white}"
    rounded: "{rounded.panel}"
  globe-control:
    backgroundColor: "#141414"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "8px"
    height: "36px"
---


> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](docs/current-status.md).

# Design System: PyroChronos

## Overview

**Creative North Star: "Earth, in perspective"**

A near-black observatory with crisp white geography, restrained mission blue, and vivid red evidence. The user-pinned NASA palette and Plus Jakarta Sans establish the identity. Open space, fine dividers, compact controls, and a geographic globe connect exploration to careful analysis.

Home introduces the product through an interactive Earth; Simulation supports the existing analyst workflow with denser, bounded evidence surfaces. These are two expressions of one visual system. This document records the implemented replacement for the former green interface, extracted from source and final desktop/mobile captures in `.cache/new-design-final/`.

**Key Characteristics:**

- Near-black ground, white type, red detections, blue information, magenta historical markers.
- A geographic Canvas globe with dotted land, thin outlines, and restrained graticules.
- Generous introductory composition and compact operational panels.
- Visible demo context, textual status, and persistent keyboard focus.
- Indonesian and English copy within the same responsive patterns.

## Colors

The five user-pinned colors anchor the system; neutral layers and lighter contextual tones support legibility on dark surfaces. Frontmatter contains the normative extracted values.

### Primary

- **Signal red** (`signal`): Simulation entry, inspection actions, recent detection markers, selected tab rules, and the second line of the Home headline. Primary actions use dark text on this fill.
- **Signal hover** (`signal-hover`): a lighter action response without introducing a new action color.

### Secondary

- **Mission blue** (`mission`): the Home explanatory section, active dashboard navigation, and transparent informational washes in the workspace.
- **Baseline blue** (`baseline`): the historical chart comparator and quieter sensor/context accents.

### Tertiary

- **Spectral magenta** (`spectral`): older/recheck map and globe points, always paired with a legend or textual meaning.

### Neutral

- **Space** (`space`): page ground and globe ocean.
- **White** (`white`): primary text, keyboard focus, and selected-marker outlines.
- **Surface**, **Control**, and **Notice**: subtly separated panel, field, and notice backgrounds.
- **Line**: low-key workspace borders and separators.
- **Muted** and **Quiet**: secondary copy and supporting labels.

**The Evidence Rule.** Give color a visible meaning through labels, legends, outlines, or explanatory copy; color alone does not establish priority, quality, or current fire conditions.

## Typography

**Display and Body Font:** Plus Jakarta Sans, with sans-serif fallback. The pinned family is served locally through Next's font loader in upright weights (400, 500, 600, 700). Intermediate requested weights in inherited workspace CSS resolve through those available files. No separate display or monospace family is present.

Rounded geometric forms give the large Home heading a direct, approachable voice. Smaller workspace typography preserves density without changing identity. Coordinates use tabular numerals.

### Hierarchy

- **Display:** the Home two-line statement; its second line is signal red. The frontmatter desktop clamp changes to an intermediate size (49px) below the first Home breakpoint, then a mobile clamp (40px–60px at 9.7vw).
- **Headline:** the blue explanatory section heading, with compact line height and close tracking.
- **Workspace heading:** the operational page title. It becomes smaller at the intermediate breakpoint (25px), then mobile (26px), and larger on very wide screens (34px).
- **Title:** compact section headings for maps, history, candidate lists, and reports.
- **Body:** the workspace base; Home introduction uses the larger `introduction` role with a limited measure (41ch desktop, 39ch mobile). Introductory copy becomes smaller on narrower screens (14px).
- **Label:** controls and supporting copy. Existing metadata spans smaller sizes (8px–12px); do not apply these sizes to new long-form reading content. Inspection inputs use a larger text size (16px).

## Layout

Use the shared identity with density appropriate to the task. Home's Experience/Persuade expression is an unframed introduction next to a large globe, followed by a study-region row, an explanatory blue section, and a quiet footer. The CTA sits beneath the globe and readout. The Home container caps at (1600px), with desktop side padding (4.5vw); the hero uses unequal columns (0.9fr/1.2fr). At the intermediate breakpoint (1000px), columns narrow to (1fr/1.1fr). At mobile (720px), the header navigation moves to its own centered row, hero and information sections stack, copy centers, side padding becomes (6vw), and the CTA fills the available width. Keep the globe, controls, readout, and CTA in stable reading order.

Simulation's Operate expression retains the sidebar, region and mode selection, exports, source/demo status, metrics, map and candidate detail, history chart, candidate table, provenance, and inspection/report flows. Its fixed desktop sidebar is (244px), shrinking to (205px) below (1150px); the top bar is (72px). Content uses the extracted desktop gutter and caps at (1600px). Below (850px), the sidebar becomes a menu-triggered overlay and content uses the full width. Below (620px), the region select spans a full toolbar row, mode and refresh share the next row, metrics form a two-column grid, map detail and chart context stack below their visuals, and the footer stacks. Tables scroll within their container, rather than widening the page. Mobile content padding is (24px 16px 0).

**The Scope Rule.** Shared base CSS owns the font, palette, reset, global focus, and motion preference. Home styles stay namespaced to the landing surface; operational selectors stay inside the Simulation wrapper. Navigating between routes must not restyle the other surface.

The root layout keeps the design-contract template first in the body. Its comment records seed `d6c91931` and the user-pinned brief as the binding direction; the seed does not override that direction. Page composition remains in `new-design.md` and the root contract rather than becoming a universal layout requirement.

## Elevation & Depth

Depth comes primarily from dark tonal layers, thin borders, and blue-tinted context areas. The globe is drawn directly on the page ground. Workspace maps, charts, and tables have bounded containers; do not wrap every Home paragraph in cards. Detection points do not use glow shadows. Selection uses a white ring or a blue-tinted row.

The retained toast and open mobile sidebar use modest shadows (respectively `0 8px 30px #0002` and `10px 0 30px #0002`). These are transient overlays, not the default panel treatment. The sidecar preserves these extension tokens.

## Shapes

Controls use gently rounded corners; panels are slightly broader, and dialogs use the largest established corner. Navigation sits between control and panel radii. Map/history shells retain their distinct map-panel corner. Thin borders and rectangular data grids carry the workspace; circles identify geographic points, small state dots, and the profile mark. Home's globe is the signature circular form, not a decorative card silhouette.

## Components

### Buttons

The Home primary is a clear red destination link with dark text, a directional arrow, and ample horizontal separation. The workspace primary keeps the same color assignment at a denser size. Outline exports and refresh controls use a dark fill and subtle border. Hover lightens the red action or neutral outline surface. Global keyboard focus is a white outline (2px, offset 5px); Simulation controls use white (3px, offset 3px), while the region select uses white (2px, offset 3px) and a blue focused container border. Preserve visible focus in every variant.

### Navigation

Home uses text links with a red active underline; its language buttons expose pressed state. Simulation uses icon/text rows with a solid mission-blue active state and quiet transparent hover. The mobile sidebar is reached through the existing menu button. Keep Home and Simulation destinations available without making globe interaction mandatory.

### Cards / Containers

Operational panels use surface fill, line borders, and compact internal spacing. Map and historical-chart panels pair the visual with a blue-tinted explanation or candidate detail. Metrics are separated by rules, rather than individual floating cards. Demo notices use a slightly lighter neutral strip with clear text; data availability and source status remain visible when values are missing.

### Inputs / Fields

Region and mode choices are native selects on dark fields. The region control includes an icon and preserves a full-width mobile row. Inspection inputs, select, and textarea remain inside the existing dialog with readable labels, explanatory context, and error feedback. Disabled controls retain reduced opacity and the current busy cursor behavior where applicable.

### Chips

Priority badges combine a written category with a subtle red or blue tint. Tiny DEMO/ILLUSTRATIVE labels supplement the nearby explanation; they do not replace it. Candidate time-window tabs use a red selected underline and a small neutral count badge.

### Geographic Globe

The signature visual uses `d3-geo` orthographic Canvas projection, local Natural Earth land geometry, and (2934) locally precomputed land dots. Land and hotspot points are culled on the back hemisphere. This is geographic rendering; no generated raster asset is required for this implementation.

Hover or focus reveals illustrative points; dragging rotates, the wheel or plus/minus controls zoom, arrows rotate from keyboard focus, and Home resets the view. The explicit hotspot toggle supports touch discovery; pause/play and reset remain visible below the globe. Rotation pauses during hover, focus, dragging, reduced-motion preference, hidden-tab state, and offscreen state as implemented. Reduced-motion users start paused. A polite readout describes the active point. Pointer release hit-tests the current position before selecting a region; a drag must not accidentally navigate. Study-region links offer the keyboard destination alongside the general Simulation CTA. Keep loading and geographic-failure messaging visible when necessary.

### Operational Map and Evidence

Recent detections are red, older/recheck detections magenta, and the selected marker has a white ring. Labels explain the distinction. The map retains attribution and loading/failure handling; its SVG fallback is hidden and inert when the normal map is available, with visible white keyboard focus for fallback points when used. Candidate rows, detail, reports, exports, and history remain part of the inherited workflow.

### Sprint 2 Research Extensions

Research results extend Simulation's inherited Operate expression: flat sections separated by fine rules, compact headings, dark labeled fields, and wrapping action rows. The existing palette and Plus Jakarta Sans remain authoritative. Calendar and evidence tables scroll inside their containers on mobile; inline forms fill the available width, with fields capped at (640px) on desktop.

The year-by-month calendar separates detection count from anomaly through labeled, pressed-state controls. Count uses a sequential light-to-dark blue ramp; anomaly uses a blue-white-red percentile ramp. Cell text switches between dark and white according to relative luminance. Numbers, availability/partial status, missing-value dashes, and scale explanations remain visible; selecting a month opens daily detail. Comparison presents duration and estimates per day alongside totals, with baseline and method context in a disclosure.

**The Original Evidence Rule.** Density-map clicks zoom toward evidence; only original observation points or table detections anchor a monitoring location. Saved locations retain their original evidence and analysis context. Local assignment, inspection, and correction forms stay inline, with separate inspector/recorder names, observation/input times, correction history, and status audit. Names are user supplied; records remain in this browser. Completed inspection is a task state, not evidence that a fire is extinguished.

Exports use explicit outline actions for original-detection CSV, aggregate CSV, JSON with manifest, and calendar PNG. Original CSV rows identify `recordType=observation`; a zero-detection export retains context in a `recordType=metadata` row with empty observation fields. Estimated aggregates remain separate from observations. Keep synthetic/demo scope, export errors, and save feedback textual and visible.

This implementation is recorded from source and desktop/mobile captures in `.cache/sprint2-acceptance/`. The finish review returned **ship** after its three findings were resolved; Nathan's human review remains open.

Sprint 3 normalizes the count ramp from zero to the actual positive maximum, including fractional estimates below one, with a safe denominator when no positive estimate exists. Synthetic edge checks in `.cache/sprint3-acceptance/edge.json` verified keyboard interaction, Indonesian/English states, missing-versus-zero distinction, export metadata, and contained overflow for no-data, unsupported-method, partial, and fractional results, plus reflow at (720px).

## Do's and Don'ts

Relative hotspot density uses the requested green → yellow → orange → red data scale (low → high) consistently in MapLibre, the Canvas fallback, and the legend. The legend also names both endpoints in Indonesian/English and retains “not a danger rating.” This is a data-visualization exception to the brand palette; green does not mean safe. Calendar count and anomaly scales keep their separate meanings.

Keep density kernels compact so they do not obscure the satellite map: MapLibre radii are 4/8/14 screen pixels at zoom 0/7/14 with 0.6 layer opacity; the fallback uses 3–10 pixel kernels. This reduces visual smoothing and does not change sensor resolution, observation coordinates, or the meaning of an original detection.

### Do:

- **Do** use the five pinned NASA colors and the locally served Plus Jakarta Sans family.
- **Do** keep globe controls, a readout, study-region links, and a Simulation CTA available across screen sizes.
- **Do** preserve explicit illustrative/demo labels, source timing, unavailable states, and textual status alongside color.
- **Do** scope operational CSS and verify both routes after changing shared styles.
- **Do** preserve visible select, link, button, Canvas, and fallback-marker keyboard focus.
- **Do** retain the existing workflow and its source/provenance context when extending the interface.

### Don't:

- **Don't** reintroduce the superseded forest-green visual identity or an unrelated font pairing.
- **Don't** present the globe's illustrative points or dashboard fixtures as current fire conditions or validated rankings.
- **Don't** claim the real snapshot analytics API, individual authentication, or production report-correction workflow is complete; those integrations remain pending.
- **Don't** show interactive fallback-map controls over a working map or infer a click from stale hover state.
- **Don't** make animation, hover, or color the only way to understand evidence or reach Simulation.
- **Don't** use rounded cards and glow as the default treatment for the open Home narrative.
