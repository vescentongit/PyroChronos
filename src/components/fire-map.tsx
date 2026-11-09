"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";

import type { Candidate } from "@/lib/data";

type FireMapProps = {
  points: Candidate[];
  selected: string;
  onSelect: (id: string) => void;
};

export default function FireMap({ points, selected, onSelect }: FireMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!container.current) return;

    let map: maplibregl.Map;

    try {
      maplibregl.setWorkerUrl(
        new URL(
          "maplibre-gl/dist/maplibre-gl-worker.mjs",
          import.meta.url,
        ).toString(),
      );

      map = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {
            'esri-satellite': {
              type: 'raster',
              tiles: [
                'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
              ],
              tileSize: 256,
              attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
            }
          },
          layers: [
            {
              id: 'esri-satellite-layer',
              type: 'raster',
              source: 'esri-satellite',
              minzoom: 0,
              maxzoom: 19
            }
          ]
        },
        center: [points[0].lng, points[0].lat],
        zoom: 7,
        attributionControl: { compact: true },
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");

      points.forEach((point) => {
        const marker = document.createElement("button");
        marker.className = `fire-marker ${point.id === selected ? "selected" : ""} ${point.hours > 24 ? "old" : ""}`;
        marker.setAttribute("aria-label", `Pilih ${point.name}`);
        marker.onclick = () => onSelect(point.id);

        new maplibregl.Marker({ element: marker })
          .setLngLat([point.lng, point.lat])
          .addTo(map);
      });

      map.on("error", () => setError(true));
    } catch {
      setError(true);
    }

    return () => map?.remove();
  }, [points, selected, onSelect]);

  const west = Math.min(...points.map((point) => point.lng)) - 0.15;
  const east = Math.max(...points.map((point) => point.lng)) + 0.15;
  const south = Math.min(...points.map((point) => point.lat)) - 0.15;
  const north = Math.max(...points.map((point) => point.lat)) + 0.15;

  return (
    <div className="map-wrap">
      <div ref={container} className="map" />

      {error && (
        <>
          <div className="offline-map">
            <svg
              viewBox="0 0 600 360"
              aria-label="Posisi relatif kandidat menurut koordinat, tanpa basemap"
            >
              {[80, 150, 220, 290].map((y) => (
                <line
                  key={y}
                  x1="35"
                  x2="565"
                  y1={y}
                  y2={y}
                  stroke="#d6dfcf"
                  strokeDasharray="4 6"
                />
              ))}

              {points.map((point) => {
                const x = 60 + ((point.lng - west) / (east - west)) * 440;
                const y = 290 - ((point.lat - south) / (north - south)) * 210;
                const color = point.hours > 24 ? "#879c84" : "#c87544";

                return (
                  <g
                    key={point.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Pilih ${point.name}`}
                    onClick={() => onSelect(point.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onSelect(point.id);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={point.id === selected ? 18 : 11}
                      fill={point.hours > 24 ? "#879c84" : "#d47c49"}
                      fillOpacity=".18"
                    />
                    <circle cx={x} cy={y} r="5" fill={color} />
                    <text x={x + 12} y={y - 12} fontSize="11" fill="#607459">
                      {point.name}
                    </text>
                  </g>
                );
              })}

              <text x="35" y="335" fontSize="10" fill="#7f8e76">
                Posisi relatif menurut koordinat Â· tanpa informasi medan
              </text>
            </svg>
          </div>
          <div className="map-error">
            Basemap/WebGL tidak tersedia. Tampilan koordinat digunakan.
          </div>
        </>
      )}

      <div className="map-tag">
        <span className="status-dot" /> Kandidat verifikasi · data ilustratif
      </div>
      <div className="map-key">
        <i /> Deteksi 24 jam <i className="muted-dot" /> Perlu dicek kembali
      </div>
    </div>
  );
}
