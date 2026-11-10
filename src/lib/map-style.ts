import type { StyleSpecification } from "maplibre-gl";

export function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      "esri-labels": {
        type: "raster",
        tileSize: 256,
        maxzoom: 19,
        tiles: [
          "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        ],
        attribution: "Labels &copy; Esri",
      },
      "esri-satellite": {
        type: "raster",
        tiles: [
          "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      },
    },
    layers: [
      {
        id: "ocean",
        type: "background",
        paint: { "background-color": "#0e0e0e" },
      },
      {
        id: "esri-satellite-layer",
        type: "raster",
        source: "esri-satellite",
        paint: { "raster-opacity": 1, "raster-saturation": 0 },
      },
      {
        id: "esri-labels-layer",
        type: "raster",
        source: "esri-labels",
        paint: { "raster-opacity": 1 },
      },
    ],
  };
}
