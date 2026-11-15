// Typed surface of d3-geo 3.x used by the canvas globe.
declare module "d3-geo" {
  import type { GeoJsonObject } from "geojson";
  export interface GeoProjection {
    (point: [number, number]): [number, number] | null;
    scale(): number;
    scale(value: number): this;
    translate(point: [number, number]): this;
    rotate(angles: [number, number, number?]): this;
    clipAngle(angle: number): this;
    invert(point: [number, number]): [number, number] | null;
  }
  export function geoOrthographic(): GeoProjection;
  export function geoPath(
    projection: GeoProjection,
    context: CanvasRenderingContext2D,
  ): (object: GeoJsonObject | { type: "Sphere" }) => void;
  export function geoGraticule10(): GeoJsonObject;
  export function geoDistance(a: [number, number], b: [number, number]): number;
  export function geoContains(
    object: GeoJsonObject,
    point: [number, number],
  ): boolean;
}
