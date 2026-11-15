import { geoDistance } from "d3-geo";

export function isFrontFacing(
  point: [number, number],
  center: [number, number],
) {
  return geoDistance(point, center) < Math.PI / 2 - 0.005;
}

export function constrainZoom(zoom: number) {
  return Math.max(0.7, Math.min(1.65, zoom));
}
