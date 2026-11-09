export type Language = "id" | "en";
export type RegionId = "kalteng" | "papua";
type Bounds = [west: number, south: number, east: number, north: number];

// Study rectangles already used by the FIRMS endpoint; not administrative borders.
const definitions = [
  {
    id: "kalteng" as const,
    name: {
      id: "Subset Kalimantan Tengah",
      en: "Central Kalimantan study subset",
    },
    bounds: [113, -3.6, 115, -1.5] as Bounds,
  },
  {
    id: "papua" as const,
    name: { id: "Subset Papua Selatan", en: "South Papua study subset" },
    bounds: [139.5, -8.8, 141, -7.5] as Bounds,
  },
];

export const studyRegions = definitions.map((definition) => {
  const [west, south, east, north] = definition.bounds;
  const radians = Math.PI / 180;
  return {
    ...definition,
    boundaryVersion: "study-rectangle-v1",
    approval: "pending" as const,
    source: "PyroChronos FIRMS area configuration (2026-11-09)",
    areaKm2: Math.round(
      6371.0088 ** 2 *
        (east - west) *
        radians *
        (Math.sin(north * radians) - Math.sin(south * radians)),
    ),
    geometry: {
      type: "Polygon" as const,
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  };
});

export type StudyRegion = (typeof studyRegions)[number];
export function getRegion(id: string) {
  return studyRegions.find((region) => region.id === id);
}
