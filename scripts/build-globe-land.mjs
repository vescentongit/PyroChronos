import { readFileSync, writeFileSync } from "node:fs";
import { geoContains } from "d3-geo";

const land = JSON.parse(
  readFileSync(new URL("../public/geo/ne_110m_land.json", import.meta.url)),
);
const points = [];
const spacing = 2;
for (let lat = -80; lat <= 84; lat += spacing) {
  const step = spacing / Math.max(0.25, Math.cos((lat * Math.PI) / 180));
  for (let lng = -180; lng < 180; lng += step) {
    if (geoContains(land, [lng, lat])) points.push([+lng.toFixed(3), lat]);
  }
}
writeFileSync(
  new URL("../public/geo/land-dots.json", import.meta.url),
  JSON.stringify({
    source: "Natural Earth 1:110m land",
    spacingDegrees: spacing,
    points,
  }) + "\n",
);
console.log(
  `Generated ${points.length} land dots from the vendored Natural Earth geometry.`,
);
