import { geoDistance } from "d3-geo";
import type { Bounds } from "./hotspots";

export type GlobeLocation = { lng: number; lat: number };
export type GlobeHotspot = GlobeLocation & {
  id: string;
  count: number;
  observedAt: string;
};

export function globePoints(rows: (number | string)[][]): GlobeHotspot[] {
  return rows.map(([lng, lat, count, observedAt]) => ({
    id: `${lng}:${lat}`,
    lng: Number(lng), lat: Number(lat), count: Number(count), observedAt: String(observedAt),
  }));
}

export function globeMapHref(point: GlobeLocation) {
  return `/simulation?${new URLSearchParams({
    lng: point.lng.toFixed(4), lat: point.lat.toFixed(4),
  })}`;
}

export function readGlobeLocation(params: URLSearchParams): GlobeLocation | null {
  const values = ["lng", "lat"].map(key => params.get(key));
  if (values.some(value => value === null || !value.trim()) ||
      params.getAll("lng").length !== 1 || params.getAll("lat").length !== 1) return null;
  const [lng, lat] = values.map(Number);
  return Number.isFinite(lng) && Number.isFinite(lat) &&
    Math.abs(lng) <= 180 && Math.abs(lat) <= 90 ? { lng, lat } : null;
}

export function globeLocationBounds({ lng, lat }: GlobeLocation): Bounds {
  const wrap = (value: number) => ((value + 540) % 360) - 180;
  const center = Math.max(-75, Math.min(75, lat));
  return [wrap(lng - 15), center - 10, wrap(lng + 15), center + 10];
}

export function isFrontFacing(
  point: [number, number],
  center: [number, number],
) {
  return geoDistance(point, center) < Math.PI / 2 - 0.005;
}

export function constrainZoom(zoom: number) {
  return Math.max(0.7, Math.min(1.65, zoom));
}
