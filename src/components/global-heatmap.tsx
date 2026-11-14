"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { FeatureCollection, Polygon, MultiPolygon } from "geojson";
import { RefreshCw, Download, Globe2 } from "lucide-react";
import type { Language } from "@/lib/regions";
import ResearchPanel, { type ResearchOverlay } from "./research-panel";
import {
  researchMapGeometry,
  type Vertex,
  type AreaPolygon,
} from "@/lib/research-geometry";
import { satelliteStyle } from "@/lib/map-style";
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
  Kalimantan: [108, -5, 119, 8],
  Papua: [130, -11, 142, 1],
  Africa: [-20, -36, 55, 38],
  Amazon: [-82, -22, -44, 12],
  Australia: [112, -45, 155, -10],
};
const firmsFailureMessages: Record<string, [string, string]> = {
  NOT_CONFIGURED: [
    "API key FIRMS belum terbaca oleh server. Isi FIRMS_MAP_KEY, lalu restart npm run dev.",
    "The server has no FIRMS API key. Set FIRMS_MAP_KEY, then restart npm run dev.",
  ],
  NETWORK_ERROR: [
    "Server tidak dapat terhubung ke FIRMS. Periksa koneksi internet server, VPN, proxy, atau firewall, lalu coba lagi.",
    "The server cannot connect to FIRMS. Check its internet connection, VPN, proxy, or firewall, then retry.",
  ],
  TIMEOUT: [
    "Permintaan FIRMS melewati batas waktu. Coba lagi, perkecil area peta, atau pilih periode lebih pendek.",
    "The FIRMS request timed out. Retry, zoom into a smaller area, or select a shorter period.",
  ],
  UPSTREAM_DENIED: [
    "FIRMS menolak akses data. Periksa validitas dan status MAP_KEY di NASA FIRMS.",
    "FIRMS denied data access. Check your MAP_KEY validity and status at NASA FIRMS.",
  ],
  RATE_LIMITED: [
    "Batas permintaan tercapai. Tunggu satu menit sebelum mencoba lagi.",
    "Request limit reached. Wait one minute before retrying.",
  ],
  INVALID_RESPONSE: [
    "Respons FIRMS tidak dapat dibaca sebagai data hotspot. Coba lagi nanti.",
    "The FIRMS response could not be read as hotspot data. Try again later.",
  ],
  PAYLOAD_TOO_LARGE: [
    "Data FIRMS terlalu besar untuk satu permintaan. Perkecil area peta atau pilih periode lebih pendek.",
    "The FIRMS response is too large for one request. Zoom into a smaller area or select a shorter period.",
  ],
  UPSTREAM_UNAVAILABLE: [
    "Layanan data FIRMS belum tersedia. Tunggu sebentar, lalu coba lagi.",
    "The FIRMS data service is unavailable. Wait a moment, then retry.",
  ],
};
type Controller = { fit: (bounds: Bounds) => void };

function HeatSurface({
  query,
  data,
  language,
  onViewport,
  controller,
  layer,
  vertices,
  drawing,
  draft,
  research,
  onAddVertex,
  toolsHostRef,
}: {
  query: HotspotQuery;
  data: Hotspots | null;
  language: Language;
  onViewport: (bbox: Bounds, zoom: number) => void;
  controller: React.RefObject<Controller | null>;
  layer: "heatmap" | "points";
  vertices: Vertex[];
  drawing: boolean;
  draft: AreaPolygon | null;
  research: ResearchOverlay | null;
  onAddVertex: (vertex: Vertex) => void;
  toolsHostRef: (host: HTMLDivElement | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    mapRef = useRef<maplibregl.Map | null>(null);
  const [fallback, setFallback] = useState(false),
    [ready, setReady] = useState(false);
  const [satelliteError, setSatelliteError] = useState(false);
  const [land, setLand] = useState<FeatureCollection<
    Polygon | MultiPolygon
  > | null>(null);
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const languageRef = useRef(language);
  languageRef.current = language;
  const editRef = useRef({ drawing, onAddVertex });
  editRef.current = { drawing, onAddVertex };
  const researchRef = useRef(research);
  researchRef.current = research;
  const sketch = researchMapGeometry(vertices, draft, research?.geometry ?? null, drawing);
  const features = sketch.editing ? [] : research ? research.features : (data?.features ?? []);
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
    const resize = new ResizeObserver(() => {
      if (host.current?.clientWidth && host.current.clientHeight) map?.resize();
    });
    resize.observe(host.current);
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
        maxZoom: 19,
        attributionControl: { compact: true },
        style: satelliteStyle(),
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
              4,
              7,
              8,
              14,
              14,
            ],
            "heatmap-opacity": 0.6,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(34,197,94,0)",
              0.25,
              "#22c55e",
              0.5,
              "#facc15",
              0.8,
              "#f97316",
              1,
              "#ef4444",
            ],
          },
        });
        map.addLayer({
          id: "points",
          type: "circle",
          source: "detections",

          paint: {
            "circle-radius": 4,
            "circle-color": "#fc3c23",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 0.5,
          },
        });
        map.addSource("area-outlines", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "area-active",
          type: "line",
          source: "area-outlines",
          filter: ["==", ["get", "kind"], "active"],
          paint: { "line-color": "#ffffff", "line-width": 3 },
        });
        map.addLayer({
          id: "area-draft",
          type: "line",
          source: "area-outlines",
          filter: ["==", ["get", "kind"], "draft"],
          paint: {
            "line-color": "#61c9ff",
            "line-width": 3,
            "line-dasharray": [3, 2],
          },
        });
        map.addSource("area-edit", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "edit-line",
          type: "line",
          source: "area-edit",
          filter: ["==", ["geometry-type"], "LineString"],
          paint: { "line-color": "#61c9ff", "line-width": 2 },
        });
        map.addLayer({
          id: "edit-vertices",
          type: "circle",
          source: "area-edit",
          filter: ["==", ["geometry-type"], "Point"],
          paint: {
            "circle-radius": 5,
            "circle-color": "#61c9ff",
            "circle-stroke-color": "#111111",
            "circle-stroke-width": 2,
          },
        });
        if (map.getLayer("esri-labels-layer"))
          map.moveLayer("esri-labels-layer");
        map.on("click", (event) => {
          if (editRef.current.drawing && event.originalEvent.detail < 2 && !map?.queryRenderedFeatures(event.point, { layers: ["edit-vertices"] }).length)
            editRef.current.onAddVertex([
              +event.lngLat.wrap().lng.toFixed(6),
              +event.lngLat.lat.toFixed(6),
            ]);
          else if (!editRef.current.drawing && researchRef.current?.features.length && map?.getLayoutProperty("density", "visibility") !== "none")
            map?.easeTo({ center: event.lngLat, zoom: Math.min(map.getZoom() + 2, 19) });
        });
        map.on("click", "points", (event) => {
          if (editRef.current.drawing) return;
          const feature = event.features?.[0];
          if (!map || !feature || feature.geometry.type !== "Point") return;
          const id = feature.properties.observationId;
          if (typeof id === "string" && researchRef.current?.features.some(point => point.properties?.observationId === id)) researchRef.current.onSelect?.(id);
          new maplibregl.Popup()
            .setLngLat(feature.geometry.coordinates as [number, number])
            .setText(
              `${feature.properties.count} ${languageRef.current === "id" ? "deteksi mentah" : "raw detections"} · ${feature.properties.observedAt}`,
            )
            .addTo(map);
        });
        setReady(true);
        report();
      });
      // A failed imagery tile must not replace the entire satellite map with a monochrome fallback.
      map.on("error", () => setSatelliteError(true));
      map.on("movestart", () => setSatelliteError(false));
      map.on("webglcontextlost", () => setFallback(true));
    } catch {
      setFallback(true);
    }
    return () => {
      resize.disconnect();
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
      )?.setData({ type: "FeatureCollection", features });
  }, [data, research, ready, sketch.editing]);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    map.setLayoutProperty(
      "density",
      "visibility",
      layer === "heatmap" ? "visible" : "none",
    );
    map.setLayoutProperty(
      "points",
      "visibility",
      layer === "points" ? "visible" : "none",
    );
    (map.getSource("area-outlines") as maplibregl.GeoJSONSource).setData(sketch.outlines);
    (map.getSource("area-edit") as maplibregl.GeoJSONSource).setData(sketch.edits);
    map.getCanvas().style.cursor = drawing ? "crosshair" : "";
    if (drawing) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
  }, [ready, layer, draft, vertices, drawing, research]);
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
        ...features.map((point) => Number(point.properties?.count ?? 1)),
      );
      for (const point of features) {
        const [x, y] = project(point.geometry.coordinates),
          r = 3 + 7 * Math.sqrt(Number(point.properties?.count ?? 1) / max);
        if (layer === "points") {
          context.fillStyle = "#ffbc5c";
          context.beginPath();
          context.arc(x, y, 4, 0, Math.PI * 2);
          context.fill();
          continue;
        }
        const gradient = context.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, "#ef4444cc");
        gradient.addColorStop(0.2, "#f97316b0");
        gradient.addColorStop(0.5, "#facc1570");
        gradient.addColorStop(0.75, "#22c55e50");
        gradient.addColorStop(1, "#22c55e00");
        context.fillStyle = gradient;
        context.fillRect(x - r, y - r, r * 2, r * 2);
      }
      for (const feature of [...sketch.outlines.features, ...sketch.edits.features]) {
        context.strokeStyle = feature.properties?.kind === "active" ? "#ffffff" : "#61c9ff";
        context.fillStyle = "#61c9ff";
        context.lineWidth = 2;
        if (feature.geometry.type === "Point") {
          const [x, y] = project(feature.geometry.coordinates);
          context.beginPath(); context.arc(x, y, 5, 0, Math.PI * 2); context.fill();
          continue;
        }
        const rings = feature.geometry.type === "Polygon" ? feature.geometry.coordinates
          : feature.geometry.type === "LineString" ? [feature.geometry.coordinates] : [];
        for (const ring of rings) {
          context.beginPath();
          ring.forEach((coordinate, index) => {
            const [x, y] = project(coordinate);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
          });
          context.stroke();
        }
      }
    }
    render();
    const observer = new ResizeObserver(render);
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback, data, research, draft, vertices, drawing, layer, land, query.bbox]);
  return (
    <div className="global-surface">
      <div ref={toolsHostRef} className="global-drawing-tools" />
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
              "WebGL tidak tersedia. Tampilan Canvas aktif; gunakan editor koordinat untuk menggambar area.",
              "WebGL unavailable. Canvas view active; use the coordinate editor to draw your area.",
            )}
          </p>
        </>
      )}
      {satelliteError && !fallback && (
        <p className="global-fallback" role="status">
          {t(
            "Sebagian citra satelit gagal dimuat. Periksa jaringan, lalu geser atau zoom untuk memuat tile kembali.",
            "Some satellite imagery failed to load. Check your connection, then pan or zoom to reload tiles.",
          )}
        </p>
      )}
      <div className="global-map-tag">
        {sketch.editing
          ? t("Sketsa area — perubahan belum digunakan", "Area sketch — changes not applied")
          : research
          ? research.label
          : `NASA FIRMS · ${data?.source || query.source} · ${data?.hours ?? query.hours}h`}
      </div>
      <div className="global-map-legend">
        {layer !== "points" && !sketch.editing && (!research || features.length > 0) && <span aria-hidden="true" />}
        {sketch.editing
          ? t("Titik biru: sketsa terbaru. Gunakan area ini untuk melanjutkan.", "Blue points: current sketch. Use this area to continue.")
          : research && features.length === 0
            ? t("Batas area; titik hasil belum dimuat.", "Area boundaries; result points not loaded.")
            : layer === "points"
          ? t(
              "Deteksi mentah; agregat ditunjukkan dengan jumlah",
              "Raw detections; aggregates show counts",
            )
          : t(
              "Kepadatan relatif: hijau rendah, merah tinggi; bukan tingkat bahaya",
              "Relative density: green low, red high; not a danger rating",
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
  }>({ key: "", data: null, loading: false, failed: false, error: "" });
  const [resultsHost, setResultsHost] = useState<HTMLDivElement | null>(null);
  const [setupHost, setSetupHost] = useState<HTMLDivElement | null>(null);
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"nrt" | "research">("nrt");
  const [layer, setLayer] = useState<"heatmap" | "points">("heatmap");
  const [vertices, setVertices] = useState<Vertex[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [draftPolygon, setDraftPolygon] = useState<AreaPolygon | null>(null);
  const [researchOverlay, setResearchOverlay] = useState<ResearchOverlay>({
    geometry: null,
    features: [],
    label: "Research · —",
  });
  const addVertex = useCallback(
    (vertex: Vertex) =>
      setVertices((previous) =>
        JSON.stringify(previous.at(-1)) === JSON.stringify(vertex)
          ? previous
          : [...previous, vertex],
      ),
    [],
  );
  const previousData = useRef<Hotspots | null>(null);
  previousData.current = state.data;
  const cache = useRef(new Map<string, Hotspots>()),
    controller = useRef<Controller | null>(null);
  const key = JSON.stringify(query);
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const date = (value?: string) =>
    value
      ? `${new Date(value).toLocaleString(language === "id" ? "id-ID" : "en-GB", { timeZone: "UTC" })} UTC`
      : "—";
  const data = state.data,
    loading = state.loading;
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
    if (mode !== "nrt") return;
    const abort = new AbortController();
    let cancelled = false;
    const cached = cache.current.get(key);
    if (cached && Date.now() < Date.parse(cached.freshUntil)) {
      setState({ key, data: cached, loading: false, failed: false, error: "" });
      return;
    }
    const old = cached || previousData.current;
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
          if (!response.ok) {
            const failure = await response.json().catch(() => null);
            throw new Error(
              typeof failure?.reason === "string" &&
                Object.hasOwn(firmsFailureMessages, failure.reason)
                ? failure.reason
                : response.status === 429
                  ? "RATE_LIMITED"
                  : "UPSTREAM_UNAVAILABLE",
            );
          }
          const result = hotspotsSchema.safeParse(await response.json());
          if (!result.success) throw new Error("INVALID_RESPONSE");
          const parsed = result.data;
          if (
            parsed.source !== query.source ||
            parsed.hours !== query.hours ||
            parsed.bbox.some((value, index) => value !== query.bbox[index])
          )
            throw new Error("INVALID_RESPONSE");
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
                error.name === "AbortError"
                  ? "TIMEOUT"
                  : error instanceof TypeError
                    ? "NETWORK_ERROR"
                    : Object.hasOwn(firmsFailureMessages, error.message)
                      ? error.message
                      : "UPSTREAM_UNAVAILABLE",
            });
        })
        .finally(() => clearTimeout(timeout));
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      abort.abort();
    };
  }, [key, query, refresh, mode]);
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
    link.download = `firms-${data.source}-${data.hours}h.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="global-heatmap" aria-labelledby="global-heading">
      <div className="heading">
        <div>
          <h1 id="global-heading">
            {t("Peta aktivitas global", "Global activity map")}
          </h1>
          <p>
            {t(
              mode === "nrt" ? "Geser atau zoom peta untuk melihat hotspot. Data menyesuaikan otomatis; pilih wilayah di bawah untuk mulai." : "Analisis aktivitas pada area dan periode pilihan. Ikuti tiga langkah di bawah; tidak perlu login.",
              mode === "nrt" ? "Pan or zoom to explore hotspots. Data updates automatically; choose a region below to get started." : "Analyze activity in your chosen area and period. Follow the three steps below; no sign-in needed.",
            )}
          </p>
        </div>

      </div>
      <div
        className="global-toolbar"
        role="group"
        aria-label={t("Mode data", "Data mode")}
      >
        <button
          className="outline"
          aria-pressed={mode === "nrt"}
          onClick={() => {
            setMode("nrt");
            setDrawing(false);
          }}
        >
          {t("Hotspot terbaru", "Recent hotspots")}
        </button>
        <button
          className="outline"
          aria-pressed={mode === "research"}
          onClick={() => setMode("research")}
        >
          {t("Analisis historis", "Historical analysis")}
        </button>
      </div>
      <div hidden={mode !== "research"}>
        <ResearchPanel
          language={language}
          vertices={vertices}
          setVertices={setVertices}
          drawing={drawing}
          setDrawing={setDrawing}
          onDraft={setDraftPolygon}
          onOverlay={setResearchOverlay}
          setupHost={setupHost}
          resultsHost={resultsHost}
          toolsHost={toolsHost}
        />
      </div>
      <div hidden={mode !== "nrt"}>
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
                <option key={source} value={source}>
                  {hotspotSourceLabels[source]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Deteksi dalam", "Detections from")}
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
            hidden={!state.failed && !stale}
            disabled={loading}
            onClick={() => {
              cache.current.delete(key);
              setRefresh((value) => value + 1);
            }}
          >
            <RefreshCw size={15} />
            {t("Coba muat ulang", "Retry loading")}
          </button>
        </div>
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
      <div
        className="global-toolbar"
        role="group"
        aria-label={t("Lapisan peta", "Map layers")}
        hidden={mode === "research" && researchOverlay.features.length === 0}
      >
        <button
          className="outline"
          aria-pressed={layer === "heatmap"}
          onClick={() => setLayer("heatmap")}
        >
          {t("Kepadatan hotspot", "Hotspot density")}
        </button>
        <button
          className="outline"
          aria-pressed={layer === "points"}
          onClick={() => setLayer("points")}
        >
          {t("Titik hotspot", "Hotspot points")}
        </button>
      </div>
      <HeatSurface
        query={query}
        data={data}
        language={language}
        onViewport={onViewport}
        controller={controller}
        layer={layer}
        vertices={mode === "research" ? vertices : []}
        drawing={drawing && mode === "research"}
        draft={mode === "research" ? draftPolygon : null}
        research={mode === "research" ? researchOverlay : null}
        onAddVertex={addVertex}
        toolsHostRef={setToolsHost}
      />
      <div hidden={mode !== "nrt"}>
        <div className="global-data-status" role="status">
          <strong>
            {loading
              ? t("Memperbarui hotspot otomatis…", "Updating hotspots automatically…")
              : !data
                ? state.failed
                  ? t("Data belum tersedia — coba muat ulang", "Data unavailable — retry loading")
                  : t("Menunggu data FIRMS", "Waiting for FIRMS data")
                : stale
                  ? t(
                      "Data lama — periksa waktu",
                      "Stale data — check timestamps",
                    )
                  : t("Data FIRMS tersedia", "FIRMS data available")}
          </strong>
          <span>
            {data && !loading
              ? `${data.total.toLocaleString(language === "id" ? "id-ID" : "en-GB")} ${t("deteksi dalam area yang dimuat", "detections in loaded area")}`
              : "—"}
          </span>
          <span>
            {t("Diunduh", "Fetched")}: {date(data?.fetchedAt)}
          </span>
        </div>
        {state.failed && state.key === key && (
          <p className="global-error" role="alert">
            {t(
              ...(firmsFailureMessages[state.error] ??
                firmsFailureMessages.UPSTREAM_UNAVAILABLE),
            )}
          </p>
        )}
        {data && (data.source !== query.source || data.hours !== query.hours || data.bbox.some((value, index) => value !== query.bbox[index])) && (
          <p className="global-note">
            {t("Masih menampilkan data area sebelumnya sampai data baru tersedia", "Showing the previous area until new data is available")}:{" "}
            {data.source} · {data.hours}h · {data.bbox.join(", ")} ·{" "}
            {date(data.observedFrom)} → {date(data.observedTo)}
          </p>
        )}
      </div>
      <div hidden={mode !== "nrt"}>
        <button
          className="outline"
          disabled={!data || loading || mode !== "nrt"}
          onClick={exportData}
        >
          <Download size={16} />
          {t("Unduh data JSON", "Download JSON")}
        </button>
      </div>
      <div ref={setSetupHost} hidden={mode !== "research"} />
      <div className="research-output" ref={setResultsHost} hidden={mode !== "research"} />
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
      <div hidden={mode !== "nrt"}>
        <p className="global-note">
          {t(
            "Warna menunjukkan kepadatan relatif pada sensor, zoom, dan periode pilihan; bukan jumlah kebakaran, luas terbakar, atau hasil harmonisasi. Tidak ada deteksi bukan berarti tidak ada api.",
            "Color indicates relative detection density for the selected sensor, zoom and window; not fire count, burned area or harmonized output. No detections does not mean no fire.",
          )}
        </p>
        {data && (
          <details className="source-status">
            <summary>
              {t("Waktu dan provenance", "Time and provenance")}
            </summary>
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
      </div>
    </section>
  );
}
