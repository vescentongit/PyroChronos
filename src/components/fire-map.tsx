"use client";

import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";

import type { Language, StudyRegion } from "@/lib/regions";
import { candidateWindow, type SnapshotCandidate } from "@/lib/snapshot";

type FireMapProps = {
  points: SnapshotCandidate[];
  region: StudyRegion;
  language: Language;
  assessedAt: string;
  label: string;
  selected: string;
  onSelect: (id: string) => void;
};

export default function FireMap({
  points,
  selected,
  onSelect,
  region,
  language,
  assessedAt,
  label,
}: FireMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!container.current) return;
    setError(false);

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
            "esri-satellite": {
              type: "raster",
              tiles: [
                "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
              ],
              tileSize: 256,
              attribution:
                "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
            },
          },
          layers: [
            {
              id: "esri-satellite-layer",
              type: "raster",
              source: "esri-satellite",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        bounds: [
          [region.bounds[0], region.bounds[1]],
          [region.bounds[2], region.bounds[3]],
        ],
        fitBoundsOptions: { padding: 35 },
        attributionControl: { compact: true },
      });

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("study-boundary", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: region.geometry },
        });
        map.addLayer({
          id: "study-boundary",
          type: "line",
          source: "study-boundary",
          paint: {
            "line-color": "#ffffff",
            "line-width": 2,
            "line-dasharray": [3, 2],
          },
        });
      });

      map.on("error", () => setError(true));
    } catch {
      setError(true);
    }

    return () => {
      mapRef.current = null;
      map?.remove();
    };
  }, [region]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = points.map((point) => {
      const element = document.createElement("button");
      element.type = "button";
      element.dataset.candidateId = point.id;
      element.className = `fire-marker ${candidateWindow(point.observedAt, assessedAt) === "latest" ? "" : "old"}`;
      element.setAttribute(
        "aria-label",
        `${language === "id" ? "Pilih" : "Select"} ${point.name}`,
      );
      element.onclick = () => onSelect(point.id);
      return new maplibregl.Marker({ element })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
    });
    return () => markers.forEach((marker) => marker.remove());
  }, [points, region, language, assessedAt, onSelect]);

  useEffect(() => {
    container.current
      ?.querySelectorAll<HTMLButtonElement>("[data-candidate-id]")
      .forEach((element) => {
        const active = element.dataset.candidateId === selected;
        element.classList.toggle("selected", active);
        element.setAttribute("aria-pressed", String(active));
      });
  }, [selected, points, region, language, assessedAt]);

  const [west, south, east, north] = region.bounds;

  return (
    <div className="map-wrap">
      <div
        ref={container}
        className="map"
        inert={error}
        aria-hidden={error}
        style={{ visibility: error ? "hidden" : "visible" }}
      />

      {error && (
        <>
          <div className="offline-map">
            <svg
              viewBox="0 0 600 360"
              aria-label={
                language === "id"
                  ? "Koordinat relatif, tanpa informasi medan"
                  : "Relative coordinates, no terrain information"
              }
            >
              <rect
                x="60"
                y="80"
                width="440"
                height="210"
                fill="none"
                stroke="#7897c9"
                strokeDasharray="4 6"
              />
              {[80, 150, 220, 290].map((y) => (
                <line
                  key={y}
                  x1="35"
                  x2="565"
                  y1={y}
                  y2={y}
                  stroke="#ffffff22"
                  strokeDasharray="4 6"
                />
              ))}

              {points.map((point) => {
                const x = 60 + ((point.lng - west) / (east - west)) * 440;
                const y = 290 - ((point.lat - south) / (north - south)) * 210;
                const color =
                  candidateWindow(point.observedAt, assessedAt) === "latest"
                    ? "#fc3c23"
                    : "#ba1e68";

                return (
                  <g
                    key={point.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`${language === "id" ? "Pilih" : "Select"} ${point.name}`}
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
                      fill={
                        candidateWindow(point.observedAt, assessedAt) ===
                        "latest"
                          ? "#fc3c23"
                          : "#ba1e68"
                      }
                      fillOpacity=".18"
                    />
                    <circle cx={x} cy={y} r="5" fill={color} />
                    <text x={x + 12} y={y - 12} fontSize="11" fill="#ffffff">
                      {point.name}
                    </text>
                  </g>
                );
              })}

              <text x="35" y="335" fontSize="10" fill="#bdbdbd">
                {language === "id"
                  ? "Koordinat relatif — tanpa informasi medan"
                  : "Relative coordinates — no terrain information"}
              </text>
            </svg>
          </div>
          <div className="map-error">
            {language === "id"
              ? "Basemap/WebGL tidak tersedia. Tampilan koordinat digunakan."
              : "Basemap/WebGL unavailable. Showing relative coordinates."}
          </div>
        </>
      )}

      <div className="map-tag">
        <span className="status-dot" /> {label}
      </div>
      <div className="map-key">
        <i /> ≤24 {language === "id" ? "jam" : "hours"}{" "}
        <i className="muted-dot" />{" "}
        {language === "id" ? "Riwayat / cek kembali" : "History / recheck"}
      </div>
    </div>
  );
}
