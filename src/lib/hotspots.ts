import { z } from "zod";

export const hotspotSources = [
  "VIIRS_NOAA20_NRT",
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA21_NRT",
  "MODIS_NRT",
] as const;
export type HotspotSource = (typeof hotspotSources)[number];
export const hotspotSourceLabels:Record<HotspotSource,string>={VIIRS_NOAA20_NRT:"VIIRS · NOAA-20",VIIRS_SNPP_NRT:"VIIRS · Suomi NPP",VIIRS_NOAA21_NRT:"VIIRS · NOAA-21",MODIS_NRT:"MODIS · Terra / Aqua"};
export type Bounds = [number, number, number, number];
export const boundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(
    ([west, south, east, north]) =>
      south < north && (east > west ? east - west : 360 - west + east) > 0,
  );
export const querySchema = z.object({
  source: z.enum(hotspotSources),
  hours: z.union([z.literal(24), z.literal(48), z.literal(72), z.literal(96)]),
  zoom: z.number().int().min(0).max(16),
  bbox: boundsSchema,
});
export type HotspotQuery = z.infer<typeof querySchema>;
export type Detection = {
  id: string;
  lat: number;
  lng: number;
  observedAt: string;
  satellite: string;
  confidence: string;
  frp: number | null;
};
export const hotspotsSchema = z.object({
  schemaVersion: z.literal("hotspots-1"),
  source: z.enum(hotspotSources),
  hours: querySchema.shape.hours,
  bbox: boundsSchema,
  status: z.enum(["available", "stale"]),
  fetchedAt: z.string().datetime(),
  evaluatedAt: z.string().datetime(),
  freshUntil: z.string().datetime(),
  observedFrom: z.string().datetime(),
  observedTo: z.string().datetime(),
  checksum: z.string(),
  total: z.number().int().nonnegative(),
  gridDegrees: z.number().nonnegative(),
  unit: z.literal("detections"),
  features: z
    .array(
      z.object({
        type: z.literal("Feature"),
        geometry: z.object({
          type: z.literal("Point"),
          coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
        }),
        properties: z.object({
          count: z.number().int().positive(),
          observedAt: z.string().datetime(),
        }),
      }),
    )
    .max(6000),
  sample: z
    .array(
      z.object({
        id: z.string(),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        observedAt: z.string().datetime(),
        satellite: z.string(),
        confidence: z.string(),
        frp: z.number().nullable(),
      }),
    )
    .max(30),
}).superRefine((value,context)=>{
  const reject=(message:string)=>context.addIssue({code:"custom",message});
  if(value.features.reduce((sum,feature)=>sum+feature.properties.count,0)!==value.total||value.sample.length>value.total)reject("Count mismatch");
  const from=Date.parse(value.observedFrom),to=Date.parse(value.observedTo);
  if(to!==Date.parse(value.evaluatedAt)||to-from!==value.hours*3600000||Date.parse(value.fetchedAt)>to||Date.parse(value.freshUntil)<Date.parse(value.fetchedAt))reject("Invalid window");
  if(value.sample.some(point=>!insideBounds(point.lng,point.lat,value.bbox)||Date.parse(point.observedAt)<from||Date.parse(point.observedAt)>to))reject("Sample outside viewport/window");
});
export type Hotspots = z.infer<typeof hotspotsSchema>;

export function normalizedBounds(
  west: number,
  south: number,
  east: number,
  north: number,
): Bounds {
  const wrap = (value: number) => ((((value + 180) % 360) + 360) % 360) - 180;
  return [
    east - west >= 359.9 ? -180 : wrap(west),
    Math.max(-90, south),
    east - west >= 359.9 ? 180 : wrap(east),
    Math.min(90, north),
  ];
}
export function insideBounds(
  lng: number,
  lat: number,
  [west, south, east, north]: Bounds,
) {
  return (
    lat >= south &&
    lat <= north &&
    (west < east ? lng >= west && lng <= east : lng >= west || lng <= east)
  );
}
export function aggregateDetections(
  rows: Detection[],
  query: HotspotQuery,
  evaluatedAt: string,
) {
  const end = Date.parse(evaluatedAt),
    start = end - query.hours * 3600000;
  const visible = rows.filter(
    (point) =>
      insideBounds(point.lng, point.lat, query.bbox) &&
      Date.parse(point.observedAt) >= start &&
      Date.parse(point.observedAt) <= end,
  );
  let grid =
    query.zoom >= 7 && visible.length <= 6000
      ? 0
      : Math.max(0.02, 10 / 2 ** query.zoom);
  const build = (spacing: number) => {
    const bins = new Map<
      string,
      { lng: number; lat: number; count: number; observedAt: string }
    >();
    for (const point of visible) {
      const x = Math.floor((point.lng + 180) / spacing),
        y = Math.floor((point.lat + 90) / spacing);
      const key = spacing ? `${x}:${y}` : point.id;
      const current = bins.get(key);
      if (current) {
        current.count++;
        if (Date.parse(point.observedAt) > Date.parse(current.observedAt))
          current.observedAt = point.observedAt;
      } else
        bins.set(key, {
          lng: spacing ? Math.min(180, (x + 0.5) * spacing - 180) : point.lng,
          lat: spacing ? Math.min(90, (y + 0.5) * spacing - 90) : point.lat,
          count: 1,
          observedAt: point.observedAt,
        });
    }
    return [...bins.values()].map((bin) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [bin.lng, bin.lat] as [number, number],
      },
      properties: { count: bin.count, observedAt: bin.observedAt },
    }));
  };
  let features = build(grid);
  while (features.length > 6000) {
    grid = grid ? grid * 2 : 0.02;
    features = build(grid);
  }
  return {
    total: visible.length,
    gridDegrees: grid,
    features,
    sample: visible
      .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
      .slice(0, 30),
  };
}
