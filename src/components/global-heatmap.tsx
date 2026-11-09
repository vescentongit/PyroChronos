"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { RefreshCw, Download, Globe2 } from "lucide-react";
import type { Language } from "@/lib/regions";
import {
  boundsSchema,
  hotspotSources,
  hotspotSourceLabels,
  hotspotsSchema,
  normalizedBounds,
  type Bounds,
  type Hotspots,
  type HotspotQuery,
} from "@/lib/hotspots";

const initial: HotspotQuery = {
  source: "VIIRS_NOAA20_NRT",
  hours: 24,
  zoom: 2,
  bbox: [70, -35, 160, 35],
};
const presets: Record<string, Bounds> = {
  World: [-180, -85, 180, 85],
  Indonesia: [94, -12, 142, 7],
  Africa: [-20, -36, 55, 38],
  Amazon: [-82, -22, -44, 12],
  Australia: [112, -45, 155, -10],
};
type Controller = { fit: (bounds: Bounds) => void };

function HeatSurface({
  query,
  data,
  language,
  onViewport,
  controller,
}: {
  query: HotspotQuery;
  data: Hotspots | null;
  language: Language;
  onViewport: (bbox: Bounds, zoom: number) => void;
  controller: React.RefObject<Controller | null>;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    mapRef = useRef<maplibregl.Map | null>(null);
  const [fallback, setFallback] = useState(false),
    [ready, setReady] = useState(false);
  const [land, setLand] = useState<FeatureCollection<
    Polygon | MultiPolygon
  > | null>(null);
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const languageRef=useRef(language);languageRef.current=language;
  useEffect(() => {
    const abort = new AbortController();
    fetch("/geo/ne_110m_land.json", { signal: abort.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => {
        if (!abort.signal.aborted) setLand(value);
      })
      .catch(() => {});
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!host.current) return;
    let map: maplibregl.Map | undefined;
    try {
      maplibregl.setWorkerUrl(
        new URL(
          "maplibre-gl/dist/maplibre-gl-worker.mjs",
          import.meta.url,
        ).toString(),
      );
      map = new maplibregl.Map({
        container: host.current,
        center: [115, -3],
        zoom: 2,
        minZoom: 0,
        maxZoom: 14,
        attributionControl: { compact: true },
        style: {
          version: 8,
          sources: {
            land: {
              type: "geojson",
              data: "/geo/ne_110m_land.json",
              attribution:
                '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">Natural Earth</a>',
            },
          },
          layers: [
            {
              id: "ocean",
              type: "background",
              paint: { "background-color": "#0e0e0e" },
            },
            {
              id: "land",
              type: "fill",
              source: "land",
              paint: { "fill-color": "#192338", "fill-opacity": 0.8 },
            },
            {
              id: "coast",
              type: "line",
              source: "land",
              paint: {
                "line-color": "#9cabbd",
                "line-opacity": 0.4,
                "line-width": 0.7,
              },
            },
          ],
        },
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl(), "top-right");
      const report = () => {
        if (!map) return;
        const bounds = map.getBounds();
        const box = normalizedBounds(
          bounds.getWest(),
          bounds.getSouth(),
          bounds.getEast(),
          bounds.getNorth(),
        ).map((value) => +value.toFixed(3)) as Bounds;
        if (boundsSchema.safeParse(box).success)
          onViewport(box, Math.min(16, Math.max(0, Math.floor(map.getZoom()))));
      };
      map.on("moveend", report);
      controller.current = {
        fit: (bounds) => {
          map?.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2] < bounds[0] ? bounds[2] + 360 : bounds[2], bounds[3]],
            ],
            { padding: 25, duration: 0 },
          );
        },
      };
      map.on("load", () => {
        if (!map) return;
        map.addSource("detections", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "density",
          type: "heatmap",
          source: "detections",
          paint: {
            "heatmap-weight": ["get", "count"],
            "heatmap-intensity": 0.8,
            "heatmap-radius": [
              "interpolate",
              ["linear"],
              ["zoom"],
              0,
              9,
              7,
              22,
              14,
              35,
            ],
            "heatmap-opacity": 0.8,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(10,60,145,0)",
              0.25,
              "#0a3c91",
              0.5,
              "#ba1e68",
              0.8,
              "#fc3c23",
              1,
              "#ffffff",
            ],
          },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "detections",
          minzoom: 7,
          paint: {
            "circle-radius": 4,
            "circle-color": "#fc3c23",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.5,
          },
        });
        map.on("click", "points", (event) => {
          const feature = event.features?.[0];
          if (!map || !feature || feature.geometry.type !== "Point") return;
          new maplibregl.Popup()
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setText(
              `${feature.properties.count} ${languageRef.current==="id"?"deteksi FIRMS":"FIRMS detections"} · ${feature.properties.observedAt}`,
            )
            .addTo(map);
        });
        setReady(true);
        report();
      });
      map.on("error", () => setFallback(true));
    } catch {
      setFallback(true);
    }
    return () => {
      controller.current = null;
      mapRef.current = null;
      map?.remove();
    };
  }, [onViewport, controller]);
  useEffect(() => {
    if (ready)
      (
        mapRef.current?.getSource("detections") as
          | maplibregl.GeoJSONSource
          | undefined
      )?.setData({ type: "FeatureCollection", features: data?.features || [] });
  }, [data, ready]);
  useEffect(() => {
    if (!fallback || !canvas.current) return;
    const node = canvas.current;
    function render() {
      const context = node.getContext("2d");
      if (!context) return;
      const width = node.clientWidth,
        height = node.clientHeight,
        dpr = Math.min(devicePixelRatio || 1, 2);
      node.width = width * dpr;
      node.height = height * dpr;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = "#0e0e0e";
      context.fillRect(0, 0, width, height);
      const [west, south, east, north] = query.bbox,
        span = east > west ? east - west : 360 - west + east;
      const project = ([lng, lat]: number[]) => [
        ((lng < west ? lng + 360 - west : lng - west) / span) * width,
        ((north - lat) / (north - south)) * height,
      ];
      context.strokeStyle = "#ffffff12";
      context.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        context.beginPath();
        context.moveTo((width * i) / 6, 0);
        context.lineTo((width * i) / 6, height);
        context.moveTo(0, (height * i) / 6);
        context.lineTo(width, (height * i) / 6);
        context.stroke();
      }
      if (land) {
        context.strokeStyle = "#7897c9";
        context.lineWidth = 0.7;
        for (const feature of land.features) {
          const polygons =
            feature.geometry.type === "Polygon"
              ? [feature.geometry.coordinates]
              : feature.geometry.coordinates;
          for (const polygon of polygons)
            for (const ring of polygon) {
              context.beginPath();
              let previous: number[] | null = null;
              for (const coordinate of ring) {
                const xy = project(coordinate);
                if (!previous || Math.abs(xy[0] - previous[0]) > width * 0.7)
                  context.moveTo(xy[0], xy[1]);
                else context.lineTo(xy[0], xy[1]);
                previous = xy;
              }
              context.stroke();
            }
        }
      }
      const max = Math.max(
        1,
        ...(data?.features.map((point) => point.properties.count) || []),
      );
      for (const point of data?.features || []) {
        const [x, y] = project(point.geometry.coordinates),
          r = 8 + 14 * Math.sqrt(point.properties.count / max);
        const gradient = context.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, "#fc3c23cc");
        gradient.addColorStop(0.5, "#ba1e6870");
        gradient.addColorStop(1, "#fc3c2300");
        context.fillStyle = gradient;
        context.fillRect(x - r, y - r, r * 2, r * 2);
      }
    }
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback, data, land, query.bbox]);
  return (
    <div className="global-surface">
      <div
        ref={host}
        className="global-map"
        inert={fallback}
        aria-hidden={fallback}
        style={{ visibility: fallback ? "hidden" : "visible" }}
      />
      {fallback && (
        <>
          <canvas
            ref={canvas}
            className="global-map"
            role="img"
            aria-label={t(
              "Heatmap koordinat dengan garis pantai. Gunakan pilihan area dan batas koordinat untuk berpindah.",
              "Coordinate heatmap with coastlines. Use area presets and bounds to navigate.",
            )}
          />
          <p className="global-fallback" role="status">
            {t(
              "WebGL tidak tersedia. Tampilan Canvas aktif; pindah area melalui kontrol koordinat.",
              "WebGL unavailable. Canvas view active; navigate using coordinate controls.",
            )}
          </p>
        </>
      )}
      <div className="global-map-tag">
        NASA FIRMS · {data?.source || query.source}
      </div>
      <div className="global-map-legend">
        <span />
        {t(
          "Kepadatan relatif; bukan tingkat bahaya",
          "Relative density; not a danger rating",
        )}
      </div>
    </div>
  );
}

export default function GlobalHeatmap({ language }: { language: Language }) {
  const [query, setQuery] = useState<HotspotQuery>(initial),
    [refresh, setRefresh] = useState(0),
    [now, setNow] = useState(Date.now()),
    [boundsError, setBoundsError] = useState(false);
  const [state, setState] = useState<{
    key: string;
    data: Hotspots | null;
    loading: boolean;
    failed: boolean;
    error: string;
  }>({ key: "", data: null, loading: true, failed: false, error: "" });
  const cache = useRef(new Map<string, Hotspots>()),
    controller = useRef<Controller | null>(null);
  const key = JSON.stringify(query);
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const date = (value?: string) =>
    value
      ? `${new Date(value).toLocaleString(language === "id" ? "id-ID" : "en-GB", { timeZone: "UTC" })} UTC`
      : "—";
  const data = state.key === key ? state.data : null,
    loading = state.key !== key || state.loading;
  const stale =
    !!data &&
    (state.failed ||
      data.status === "stale" ||
      now > Date.parse(data.freshUntil));
  const onViewport = useCallback(
    (bbox: Bounds, zoom: number) =>
      setQuery((previous) =>
        JSON.stringify(previous.bbox) === JSON.stringify(bbox) &&
        previous.zoom === zoom
          ? previous
          : { ...previous, bbox, zoom },
      ),
    [],
  );
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    let cancelled = false;
    const old = cache.current.get(key) || null;
    setState({ key, data: old, loading: true, failed: false, error: "" });
    const debounce = setTimeout(() => {
      const timeout = setTimeout(() => abort.abort(), 35000);
      const params = new URLSearchParams({
        bbox: query.bbox.join(","),
        source: query.source,
        hours: String(query.hours),
        zoom: String(query.zoom),
      });
      fetch(`/api/hotspots?${params}`, {
        signal: abort.signal,
        cache: "no-store",
      })
        .then(async (response) => {
          if (!response.ok)
            throw new Error(
              response.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE",
            );
          const parsed = hotspotsSchema.parse(await response.json());
          if (
            parsed.source !== query.source ||
            parsed.hours !== query.hours ||
            parsed.bbox.some((value, index) => value !== query.bbox[index])
          )
            throw new Error("MISMATCH");
          if (cancelled) return;
          cache.current.delete(key);
          cache.current.set(key, parsed);
          if (cache.current.size > 8)
            cache.current.delete(cache.current.keys().next().value!);
          setState({
            key,
            data: parsed,
            loading: false,
            failed: false,
            error: "",
          });
        })
        .catch((error) => {
          if (!cancelled)
            setState({
              key,
              data: old,
              loading: false,
              failed: true,
              error:
                error.message === "RATE_LIMITED"
                  ? "RATE_LIMITED"
                  : "UNAVAILABLE",
            });
        })
        .finally(() => clearTimeout(timeout));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      abort.abort();
    };
  }, [key, query, refresh]);
  function area(bbox: Bounds) {
    setBoundsError(false);
    if (controller.current) controller.current.fit(bbox);
    else onViewport(bbox, query.zoom);
  }
  function exportData() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              ...data,
              status: stale ? "stale" : data.status,
              exportedAt: new Date().toISOString(),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `firms-${query.source}-${query.hours}h.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="global-heatmap" aria-labelledby="global-heading">
      <div className="heading">
        <div>
          <h1 id="global-heading">
            {t("Heatmap hotspot global", "Global hotspot heatmap")}
          </h1>
          <p>
            {t(
              "Deteksi FIRMS nyata. Jelajahi dunia; pilih satu sensor dan periode.",
              "Real FIRMS detections. Explore the world; choose one sensor and period.",
            )}
          </p>
        </div>
        <button
          className="outline"
          disabled={!data || loading}
          onClick={exportData}
        >
          <Download size={16} />
          JSON
        </button>
      </div>
      <div className="global-toolbar">
        <label>
          {t("Sensor / satelit", "Sensor / satellite")}
          <select
            value={query.source}
            onChange={(event) =>
              setQuery((previous) => ({
                ...previous,
                source: event.target.value as HotspotQuery["source"],
              }))
            }
          >
            {hotspotSources.map((source) => (
              <option key={source} value={source}>{hotspotSourceLabels[source]}</option>
            ))}
          </select>
        </label>
        <label>
          {t("Periode bergerak", "Rolling window")}
          <select
            value={query.hours}
            onChange={(event) =>
              setQuery((previous) => ({
                ...previous,
                hours: Number(event.target.value) as HotspotQuery["hours"],
              }))
            }
          >
            {[24, 48, 72, 96].map((hours) => (
              <option key={hours} value={hours}>
                {hours} {t("jam", "hours")}
              </option>
            ))}
          </select>
        </label>
        <button
          className="outline"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          <RefreshCw size={15} />
          {t("Perbarui", "Refresh")}
        </button>
      </div>
      <div
        className="global-presets"
        role="group"
        aria-label={t("Pindah area", "Navigate to area")}
      >
        {Object.entries(presets).map(([name, bbox]) => (
          <button className="outline" key={name} onClick={() => area(bbox)}>
            <Globe2 size={13} />
            {name === "World" ? t("Dunia", "World") : name}
          </button>
        ))}
      </div>
      <div className="global-data-status" role="status">
        <strong>
          {loading
            ? t("Memuat FIRMS…", "Loading FIRMS…")
            : !data
              ? t("Data tidak tersedia", "Data unavailable")
              : stale
                ? t(
                    "Data lama — periksa waktu",
                    "Stale data — check timestamps",
                  )
                : t("Data FIRMS tersedia", "FIRMS data available")}
        </strong>
        <span>
          {data && !loading
            ? `${data.total.toLocaleString(language === "id" ? "id-ID" : "en-GB")} ${t("deteksi dalam viewport", "detections in viewport")}`
            : "—"}
        </span>
        <span>
          {t("Diunduh", "Fetched")}: {date(data?.fetchedAt)}
        </span>
      </div>
      {state.failed && state.key === key && (
        <p className="global-error" role="alert">
          {state.error === "RATE_LIMITED"
            ? t(
                "Batas permintaan tercapai. Tunggu satu menit.",
                "Request limit reached. Wait one minute.",
              )
            : t(
                "FIRMS belum dapat dimuat. Data lama hanya dipertahankan untuk area, sensor dan periode yang sama; coba kembali atau pendekkan periode.",
                "FIRMS could not load. Old data is retained only for the same area, sensor and window; retry or shorten the period.",
              )}
        </p>
      )}
      <HeatSurface
        query={query}
        data={data}
        language={language}
        onViewport={onViewport}
        controller={controller}
      />
      <details className="region-metadata">
        <summary>
          {t(
            "Batas viewport / navigasi koordinat",
            "Viewport bounds / coordinate navigation",
          )}
        </summary>
        <form
          key={query.bbox.join(",")}
          className="global-bounds"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = boundsSchema.safeParse(
              ["west", "south", "east", "north"].map((field) =>
                Number(form.get(field)),
              ),
            );
            if (!parsed.success) {
              setBoundsError(true);
              return;
            }
            area(parsed.data);
          }}
        >
          {["west", "south", "east", "north"].map((field, index) => (
            <label key={field}>
              {language === "id"
                ? ["Barat", "Selatan", "Timur", "Utara"][index]
                : field}
              <input
                type="number"
                name={field}
                required
                step="any"
                min={index % 2 ? -90 : -180}
                max={index % 2 ? 90 : 180}
                defaultValue={query.bbox[index]}
              />
            </label>
          ))}
          <button className="outline">
            {t("Tampilkan area", "Show area")}
          </button>
        </form>
        {boundsError && (
          <p role="alert">
            {t(
              "Batas tidak valid; selatan harus lebih kecil dari utara. Barat > timur berarti melintasi antimeridian.",
              "Invalid bounds; south must be below north. West > east crosses the antimeridian.",
            )}
          </p>
        )}
      </details>
      <p className="global-note">
        {t(
          "Warna menunjukkan kepadatan relatif pada sensor, zoom, dan periode pilihan; bukan jumlah kebakaran, luas terbakar, atau hasil harmonisasi. Tidak ada deteksi bukan berarti tidak ada api.",
          "Color indicates relative detection density for the selected sensor, zoom and window; not fire count, burned area or harmonized output. No detections does not mean no fire.",
        )}
      </p>
      {data && (
        <details className="source-status">
          <summary>{t("Waktu dan provenance", "Time and provenance")}</summary>
          <p>
            {data.source} · {data.hours}h · {t("Dinilai", "Assessed")}:{" "}
            {date(data.evaluatedAt)}
          </p>
          <p>
            {date(data.observedFrom)} → {date(data.observedTo)}
          </p>
          <p>
            {t("Agregasi grid", "Grid aggregation")}:{" "}
            {data.gridDegrees || t("titik asli", "original points")}{" "}
            {data.gridDegrees ? "°" : ""} · {data.checksum}
          </p>
        </details>
      )}
      <h2 className="global-list-heading">
        {t(
          "Deteksi terbaru dalam viewport (maks. 30)",
          "Latest detections in viewport (max. 30)",
        )}
      </h2>
      <div className="table-scroll">
        <table>
          <caption className="visually-hidden">NASA FIRMS</caption>
          <thead>
            <tr>
              <th>{t("Koordinat", "Coordinates")}</th>
              <th>{t("Observasi UTC", "Observed UTC")}</th>
              <th>{t("Satelit", "Satellite")}</th>
              <th>FRP (MW)</th>
              <th>{t("Confidence sumber", "Source confidence")}</th>
            </tr>
          </thead>
          <tbody>
            {data?.sample.map((point) => (
              <tr key={point.id}>
                <td>
                  {point.lat.toFixed(4)}, {point.lng.toFixed(4)}
                </td>
                <td>{date(point.observedAt)}</td>
                <td>{point.satellite}</td>
                <td>{point.frp ?? "—"}</td>
                <td>{point.confidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && data?.total === 0 && (
        <p role="status">
          {t(
            "Tidak ada deteksi yang dikembalikan sumber untuk area dan periode ini. Kondisi api belum terverifikasi.",
            "The source returned no detections in this area and window. Fire conditions remain unverified.",
          )}
        </p>
      )}
    </section>
  );
}
