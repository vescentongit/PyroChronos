"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import type { FeatureCollection, Point } from "geojson";
import type { Language } from "@/lib/regions";
import {
  polygonFromVertices,
  requestIdentity,
  type AreaPolygon,
  type Vertex,
} from "@/lib/research-geometry";
import {
  createResearchAnalysisSchema,
  researchAnalysisResultSchema,
  researchDailyPageSchema,
  researchDetectionsPageSchema,
  type ResearchAnalysisResult,
  type ResearchJob,
} from "@/lib/research-contracts";
import {
  listResearchWorkspaces,
  createResearchWorkspace,
  createResearchArea,
  submitResearch,
  watchResearch,
  researchDays,
  researchDetections,
  lastResearchResult,
  researchHistory,
  openResearchResult,
} from "@/lib/local-research-client";
import { ResearchApiError } from "@/lib/research-client";
import demo from "@/lib/fixtures/research-demo.json";
import { ResearchSummary } from "@/components/research-summary";
import { ResearchMonitoring } from "@/components/research-monitoring";
import { ResearchExports } from "@/components/research-exports";
import type { Detection, LocalLocation } from "@/lib/local-monitoring";

const labels: Record<string, [string, string]> = {
  fixture_points: [
    "Contoh titik sintetis; bukan cakupan lengkap area.",
    "Synthetic point sample; not complete area coverage.",
  ],
  idle: [
    "Pilih polygon dan periode, lalu analisis area.",
    "Choose a polygon and period, then analyze the area.",
  ],
  submitting: ["Mengajukan analisis…", "Submitting analysis…"],
  queued: ["Analisis dalam antrean", "Analysis queued"],
  running: ["Analisis sedang diproses", "Analysis running"],
  succeeded: ["Analisis selesai", "Analysis completed"],
  failed: ["Analisis gagal", "Analysis failed"],
  available: ["Tersedia", "Available"],
  partial: ["Data parsial", "Partial data"],
  no_data: [
    "Data tidak tersedia; bukan nol kebakaran",
    "No data; does not mean zero fires",
  ],
  method_unsupported: [
    "Metode tidak mendukung area/periode ini",
    "Method unsupported for this area/period",
  ],
  DEPENDENCY_UNAVAILABLE: [
    "Layanan riset v2 belum tersedia. Eksplorasi FIRMS terbaru tetap dapat digunakan.",
    "Research v2 service is unavailable. Recent FIRMS exploration remains available.",
  ],
  UNAUTHENTICATED: [
    "Layanan mengembalikan persyaratan akun lama. Muat ulang halaman untuk memakai analisis lokal tanpa login.",
    "The service returned a legacy account requirement. Reload to use local analysis without signing in.",
  ],
  FORBIDDEN: [
    "Permintaan ditolak. Muat ulang halaman lalu coba kembali dari situs ini.",
    "Request denied. Reload the page and retry from this site.",
  ],
  RATE_LIMITED: [
    "Batas permintaan tercapai. Tunggu sebelum mencoba lagi.",
    "Request limit reached. Wait before retrying.",
  ],
  INVALID_RESPONSE: [
    "Respons tidak cocok dengan kontrak atau pilihan analisis. Hasil tidak diterapkan.",
    "Response does not match the contract or analysis selection. Result was not applied.",
  ],
  IDEMPOTENCY_CONFLICT: [
    "Identitas permintaan bertentangan. Ubah pilihan untuk membuat permintaan baru.",
    "Request identity conflict. Change the selection to create a new request.",
  ],
  REVISION_CONFLICT: [
    "Revisi area sudah berubah. Muat ulang area sebelum menganalisis.",
    "Area revision changed. Reload the area before analyzing.",
  ],
  CAPACITY_LIMIT: [
    "Area atau periode melampaui kapasitas layanan. Perkecil pilihan.",
    "Area or period exceeds service capacity. Reduce your selection.",
  ],
  INVALID_REQUEST: [
    "Periksa polygon, tanggal dan kebijakan kualitas sebelum mencoba lagi.",
    "Check the polygon, dates and quality policy before retrying.",
  ],
  NETWORK_ERROR: [
    "Koneksi riset gagal atau melewati batas waktu. Coba lagi dengan pilihan yang sama.",
    "Research connection failed or timed out. Retry with the same selection.",
  ],
  STORAGE_UNAVAILABLE: ["Penyimpanan browser tidak tersedia atau penuh. Hasil belum tersimpan.", "Browser storage is unavailable or full. The result was not saved."],
  cancelled: [
    "Pemantauan dihentikan; job server mungkin masih berjalan. Klik Analisis area untuk melanjutkan.",
    "Monitoring stopped; the server job may still be running. Click Analyze area to resume.",
  ],
};
const geometryLabels: Record<string, [string, string]> = {
  vertex_count: ["Gunakan 3–500 titik.", "Use 3–500 vertices."],
  coordinates: [
    "Bujur harus −180…180 dan lintang −90…90.",
    "Longitude must be −180…180 and latitude −90…90.",
  ],
  duplicate_vertices: [
    "Hapus titik yang berulang; polygon ditutup otomatis.",
    "Remove repeated vertices; the polygon closes automatically.",
  ],
  self_intersection: [
    "Sisi polygon tidak boleh saling bersilangan atau bersentuhan.",
    "Polygon edges must not intersect or touch.",
  ],
  zero_area: [
    "Polygon harus memiliki luas; titik tidak boleh segaris.",
    "Polygon must have area; vertices cannot be collinear.",
  ],
  hemisphere: [
    "Polygon ini mencakup 180° bujur atau lebih. Bagi menjadi area yang lebih kecil.",
    "This polygon spans 180° longitude or more. Split it into smaller areas.",
  ],
};
export type ResearchOverlay = {
  geometry: AreaPolygon | null;
  features: FeatureCollection<Point>["features"];
  label: string;
  onSelect?: (id: string) => void;
};

export default function ResearchPanel({
  language,
  vertices,
  setVertices,
  drawing,
  setDrawing,
  onDraft,
  onOverlay,
  resultsHost,
  setupHost,
  toolsHost,
}: {
  language: Language;
  vertices: Vertex[];
  setVertices: Dispatch<SetStateAction<Vertex[]>>;
  drawing: boolean;
  setDrawing: (value: boolean) => void;
  onDraft: (geometry: AreaPolygon | null) => void;
  onOverlay: (overlay: ResearchOverlay) => void;
  resultsHost: HTMLDivElement | null;
  setupHost: HTMLDivElement | null;
  toolsHost: HTMLDivElement | null;
}) {
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const label = (key: string) =>
    labels[key]?.[language === "id" ? 0 : 1] ??
    t(
      "Layanan gagal memproses permintaan. Coba lagi.",
      "The service could not process the request. Retry.",
    );
  const [polygon, setPolygon] = useState<AreaPolygon | null>(null);
  const [geometryError, setGeometryError] = useState("");
  const [name, setName] = useState("");
  const [start, setStart] = useState("2026-08-01");
  const [end, setEnd] = useState("2026-08-31");
  const [compare, setCompare] = useState(false);
  const [compareStart, setCompareStart] = useState("2025-08-01");
  const [compareEnd, setCompareEnd] = useState("2025-08-31");
  const [years, setYears] = useState(10);
  const [policy, setPolicy] = useState(
    process.env.NEXT_PUBLIC_RESEARCH_QUALITY_POLICY_VERSION ?? "quality-policy-1",
  );
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
    [],
  );
  const [workspace, setWorkspace] = useState("");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [workspaceCreateError, setWorkspaceCreateError] = useState("");
  const workspaceRequest = useRef<ReturnType<typeof requestIdentity> | null>(null);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [job, setJob] = useState<ResearchJob | null>(null);
  const [result, setResult] = useState<ResearchAnalysisResult | null>(null);
  const [days, setDays] = useState<ReturnType<
    typeof researchDailyPageSchema.parse
  > | null>(null);
  const [detailStatus, setDetailStatus] = useState("");
  const [mapStatus, setMapStatus] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [points, setPoints] = useState<ResearchOverlay["features"]>([]);
  const [observations, setObservations] = useState<Detection[]>([]);
  const [activeDetection, setActiveDetection] = useState<{ id: string } | null>(null);
  const selectDetection = (id: string) => setActiveDetection({ id });
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [history, setHistory] = useState<ReturnType<typeof researchHistory>>([]);
  const request = useRef<ReturnType<typeof requestIdentity> | null>(null);
  const areaRequest = useRef<ReturnType<typeof requestIdentity> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const detailAbort = useRef<AbortController | null>(null);
  const pointAbort = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const busy = ["submitting", "queued", "running"].includes(status);
  const dirty = JSON.stringify(vertices) !== JSON.stringify(polygon?.coordinates[0].slice(0, -1) ?? []);
  const selectionKey = JSON.stringify({
    vertices,
    drawing,
    workspace,
    polygon,
    name,
    start,
    end,
    compare,
    compareStart,
    compareEnd,
    years,
    policy,
  });
  const selectionRef = useRef(selectionKey);
  selectionRef.current = selectionKey;
  const resultKey = useRef("");
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pyro-research-draft-v1") || "null");
      if (stored && typeof stored === "object") {
        if (typeof stored.name === "string") setName(stored.name);
        if (typeof stored.start === "string") setStart(stored.start);
        if (typeof stored.end === "string") setEnd(stored.end);
        if (typeof stored.compare === "boolean") setCompare(stored.compare);
        if (typeof stored.compareStart === "string") setCompareStart(stored.compareStart);
        if (typeof stored.compareEnd === "string") setCompareEnd(stored.compareEnd);
        if (Number.isInteger(stored.years) && stored.years > 0 && stored.years <= 30) setYears(stored.years);
        if (typeof stored.policy === "string") setPolicy(stored.policy);
        if (Array.isArray(stored.vertices) && stored.vertices.length) {
          const restored = polygonFromVertices(stored.vertices);
          setVertices(stored.vertices); setPolygon(restored); onDraft(restored);
        }
      }
      setDraftLoaded(true);
    } catch { setError("STORAGE_UNAVAILABLE"); }
  }, []);
  useEffect(() => {
    if (!draftLoaded) return;
    try { localStorage.setItem("pyro-research-draft-v1", JSON.stringify({ name, start, end, compare, compareStart, compareEnd, years, policy, vertices: polygon?.coordinates[0].slice(0, -1) ?? [] })); }
    catch { setError("STORAGE_UNAVAILABLE"); }
  }, [draftLoaded, name, start, end, compare, compareStart, compareEnd, years, policy, polygon]);
  useEffect(() => {
    let active = true;
    try { setHistory(researchHistory()); } catch { setError("STORAGE_UNAVAILABLE"); }
    lastResearchResult().then(saved => {
      if (active && saved) { publishResult(saved, "saved-local-result"); setStatus("succeeded"); }
    }).catch(() => { if (active) setError("STORAGE_UNAVAILABLE"); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setWorkspaceLoaded(false);
    setWorkspaceError("");
    listResearchWorkspaces(controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setWorkspaces(page.items);
        setWorkspaceLoaded(true);
        setWorkspace((current) =>
          page.items.some((item) => item.id === current)
            ? current
            : (page.items[0]?.id ?? ""),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setWorkspaceError(
            reason instanceof ResearchApiError ? reason.code : "NETWORK_ERROR",
          );
      });
    return () => controller.abort();
  }, []);
  async function addWorkspace() {
    const name = newWorkspaceName.trim();
    if (!name || workspaceCreating) return;
    setWorkspaceCreating(true);
    setWorkspaceCreateError("");
    workspaceRequest.current = requestIdentity(workspaceRequest.current, name);
    try {
      const created = await createResearchWorkspace({ requestId: workspaceRequest.current.id, name }, new AbortController().signal);
      setWorkspaces(current => [...current, created]);
      setWorkspace(created.id);
      setNewWorkspaceName("");
      workspaceRequest.current = null;
    } catch (reason) {
      setWorkspaceCreateError(reason instanceof ResearchApiError ? reason.code : "NETWORK_ERROR");
    } finally {
      setWorkspaceCreating(false);
    }
  }
  useEffect(
    () => () => {
      abort.current?.abort();
      detailAbort.current?.abort();
      pointAbort.current?.abort();
    },
    [],
  );
  useEffect(() => {
    abort.current?.abort();
    generation.current++;
    setStatus("idle");
    setJob(null);
    setError("");
  }, [selectionKey]);

  useEffect(() => { setGeometryError(""); }, [vertices]);
  function undoVertex() {
    setVertices(current => current.slice(0, -1));
  }
  function clearSketch() {
    setVertices([]);
    setDrawing(true);
  }
  function applyPolygon() {
    try {
      const next = polygonFromVertices(vertices);
      setPolygon(next);
      onDraft(next);
      setDrawing(false);
      setGeometryError("");
      setupHost?.scrollIntoView({ block: "start", behavior: "instant" });
    } catch (reason) {
      setGeometryError(
        reason instanceof Error ? reason.message : "coordinates",
      );
    }
  }
  function cancelEdit() {
    setVertices(polygon?.coordinates[0].slice(0, -1) ?? []);
    setDrawing(false);
    setGeometryError("");
  }
  function publishResult(next: ResearchAnalysisResult, key: string) {
    detailAbort.current?.abort();
    pointAbort.current?.abort();
    resultKey.current = key;
    setResult(next);
    setDays(null);
    setDetailStatus("");
    setCursor(null);
    setPoints([]);
    setObservations([]);
    setActiveDetection(null);
    setLoadingPoints(false);
    setMapStatus("idle");
    onOverlay({
      geometry: next.area.geometry,
      features: [],
      label: `${next.mode.toUpperCase()} · ${next.area.name} · ${next.primary.period.start} → ${next.primary.period.end} UTC`,
      onSelect: selectDetection,
    });
  }
  async function analyze() {
    if (busy || !polygon || !workspace || drawing || dirty) return;
    const key = selectionKey;
    const run = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const current = () =>
      !controller.signal.aborted &&
      generation.current === run &&
      selectionRef.current === key;
    try {
      // Validate all dates/config before creating any server resource.
      const template = createResearchAnalysisSchema.parse({
        requestId: crypto.randomUUID(),
        areaId: "pending",
        areaRevision: 1,
        period: { start, end },
        comparisonPeriod: compare
          ? { start: compareStart, end: compareEnd }
          : null,
        baseline: { kind: "rolling-same-calendar-period", windowYears: years },
        referenceScale: "MODIS-equivalent",
        qualityPolicyVersion: policy,
        monitoringLocationId: null,
      });
      if (!name.trim()) throw new ResearchApiError("INVALID_REQUEST");
      setError("");
      setStatus("submitting");
      areaRequest.current = requestIdentity(
        areaRequest.current,
        JSON.stringify({ workspace, name, polygon }),
      );
      const area = await createResearchArea(
        workspace,
        { requestId: areaRequest.current.id, name, geometry: polygon },
        controller.signal,
      );
      if (!current()) return;
      request.current = requestIdentity(request.current, key);
      const body = {
        ...template,
        requestId: request.current.id,
        areaId: area.id,
        areaRevision: area.revision,
      };
      const initial = await submitResearch(workspace, body, controller.signal);
      if (!current()) return;
      const next = await watchResearch(
        workspace,
        initial,
        body,
        controller.signal,
        (value) => {
          if (current()) {
            setJob(value);
            setStatus(value.status === "succeeded" ? "running" : value.status);
          }
        },
      );
      if (current()) {
        publishResult(next, key);
        setHistory(researchHistory());
        setStatus("succeeded");
      }
    } catch (reason) {
      if (!current()) return;
      setStatus("failed");
      setError(
        reason instanceof ResearchApiError
          ? reason.code
          : reason instanceof TypeError ||
              (reason instanceof DOMException && reason.name === "TimeoutError")
            ? "NETWORK_ERROR"
            : "INVALID_REQUEST",
      );
    }
  }
  function preview() {
    abort.current?.abort();
    generation.current++;
    const next = researchAnalysisResultSchema.parse(demo.result);
    publishResult(next, "synthetic-fixture");
    setStatus("idle");
    setJob(null);
    setError("");
  }
  async function loadDays(month: string) {
    if (!result) return;
    detailAbort.current?.abort();
    const controller = new AbortController();
    detailAbort.current = controller;
    setDays(null);
    setDetailStatus("loading");
    try {
      const page =
        resultKey.current === "synthetic-fixture"
          ? researchDailyPageSchema.parse(demo["daily-page"])
          : await researchDays(
              result.workspaceId,
              result.id,
              month,
              controller.signal,
            );
      if (
        page.analysisId !== result.id ||
        page.month !== month ||
        page.periodRole !== "primary"
      )
        throw new ResearchApiError("INVALID_RESPONSE");
      if (!controller.signal.aborted) {
        setDays(page);
        setDetailStatus("");
        onOverlay({ geometry: result.area.geometry, features: points.filter(point => String(point.properties?.observedAt).startsWith(month)), label: `${result.mode.toUpperCase()} · ${result.area.name} · ${month} UTC`, onSelect: selectDetection });
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setDetailStatus(
          reason instanceof ResearchApiError ? reason.code : "NETWORK_ERROR",
        );
    }
  }
  async function loadPoints() {
    if (!result || loadingPoints) return;
    pointAbort.current?.abort();
    const controller = new AbortController();
    pointAbort.current = controller;
    setLoadingPoints(true);
    try {
      const page =
        resultKey.current === "synthetic-fixture"
          ? researchDetectionsPageSchema.parse(demo["detections-page"])
          : await researchDetections(
              result.workspaceId,
              result.id,
              controller.signal,
              cursor ?? undefined,
            );
      if (page.analysisId !== result.id || page.periodRole !== "primary")
        throw new ResearchApiError("INVALID_RESPONSE");
      if (controller.signal.aborted) return;
      setObservations(current => [...current, ...page.observations.filter(point => !current.some(item => item.id === point.id))]);
      const seen = new Set(points.map((point) => point.id));
      const next = [
        ...points,
        ...page.observations
          .filter((point) => !seen.has(point.id))
          .map((point) => ({
            type: "Feature" as const,
            id: point.id,
            geometry: {
              type: "Point" as const,
              coordinates: point.coordinates,
            },
            properties: {
              count: 1,
              observationId: point.id,
              observedAt: point.observedAt,
              source: point.sourceId,
            },
          })),
      ];
      setPoints(next);
      const fixture = resultKey.current === "synthetic-fixture";
      setCursor(fixture ? null : page.nextCursor);
      setMapStatus(
        fixture ? "fixture_points" : page.nextCursor ? "partial" : "available",
      );
      onOverlay({
        geometry: result.area.geometry,
        features: days ? next.filter(point => String(point.properties?.observedAt).startsWith(days.month)) : next,
        label: `${result.mode.toUpperCase()} · ${result.area.name} · ${days ? days.month : `${result.primary.period.start} → ${result.primary.period.end}`} UTC`,
        onSelect: selectDetection,
      });
    } catch (reason) {
      if (!controller.signal.aborted)
        setMapStatus(
          reason instanceof ResearchApiError ? reason.code : "NETWORK_ERROR",
        );
    } finally {
      if (!controller.signal.aborted) setLoadingPoints(false);
    }
  }
  function reuseLocation(location: LocalLocation) {
    const area = location.initialAnalysis.area;
    setVertices(area.geometry.coordinates[0].slice(0, -1) as Vertex[]);
    setPolygon(area.geometry);
    onDraft(area.geometry);
    setName(area.name);
    setDrawing(false);
    setupHost?.scrollIntoView({ block: "start", behavior: "instant" });
  }
  return (
    <div className="research-panel">
      {drawing &&
        toolsHost &&
        createPortal(
          <>
            <button className="outline" disabled={vertices.length < 3} onClick={applyPolygon}>
              {t("Gunakan area ini", "Use this area")}
            </button>
            <button className="outline" disabled={!vertices.length} onClick={undoVertex}>
              {t("Hapus titik terakhir", "Undo vertex")}
            </button>
            <button className="outline" disabled={!vertices.length} onClick={clearSketch}>
              {t("Hapus semua titik", "Clear all vertices")}
            </button>
            <button className="outline" onClick={cancelEdit}>
              {t("Batal edit", "Cancel edit")}
            </button>
            <span role="status">{vertices.length} {t("titik; minimal 3, lalu gunakan area", "vertices; at least 3, then use area")}</span>
            {geometryError && <p className="global-error" role="alert">{geometryLabels[geometryError]?.[language === "id" ? 0 : 1] ?? geometryLabels.coordinates[language === "id" ? 0 : 1]}</p>}
          </>,
          toolsHost,
        )}
      <h2>{t("1. Gambar area penelitian", "1. Draw your research area")}</h2>
      <p className="global-note">
        {t("Klik Gambar / edit area, tandai minimal 3 titik di peta, lalu pilih Gunakan area ini.", "Choose Draw / edit area, mark at least 3 points on the map, then choose Use this area.")} ·{" "}
        {t(
          "Navigasi peta tidak mengubah area atau menjalankan analisis.",
          "Map navigation does not change the area or run an analysis.",
        )}
      </p>
      <div className="global-toolbar">
        <button
          className="outline"
          aria-pressed={drawing}
          onClick={() => {
            setDrawing(!drawing);
            if (!drawing)
              document
                .querySelector(".global-surface")
                ?.scrollIntoView({ block: "center", behavior: "instant" });
            setGeometryError("");
          }}
        >
          {drawing
            ? t("Jeda menggambar", "Pause drawing")
            : t("Gambar / edit area", "Draw / edit area")}
        </button>
        <button
          className="outline"
          disabled={vertices.length === 0}
          onClick={undoVertex}
        >
          {t("Hapus titik terakhir", "Undo vertex")}
        </button>
        <button className="outline" disabled={!vertices.length} onClick={clearSketch}>
          {t("Hapus semua titik", "Clear all vertices")}
        </button>
        <button className="outline" disabled={vertices.length < 3} onClick={applyPolygon}>
          {t("Gunakan area ini", "Use this area")}
        </button>
        <button className="outline" disabled={!dirty && !drawing} onClick={cancelEdit}>
          {t("Batal edit", "Cancel edit")}
        </button>
        <span>
          {vertices.length} {t("titik", "vertices")} ·{" "}
          {dirty || drawing ? t("Perubahan belum digunakan", "Changes not applied") : polygon ? t("Area siap dianalisis", "Area ready to analyze") : t("Belum ada area", "No area yet")}
        </span>
      </div>
      {drawing && (
        <p role="status">
          {t(
            "Klik minimal 3 titik di peta untuk membatasi area, lalu pilih Gunakan area ini. Untuk keyboard, gunakan editor koordinat.",
            "Click at least 3 points on the map to outline an area, then choose Use this area. For keyboard input, use the coordinate editor.",
          )}
        </p>
      )}
      {geometryError && (
        <p className="global-error" role="alert">
          {geometryLabels[geometryError]?.[language === "id" ? 0 : 1] ??
            geometryLabels.coordinates[language === "id" ? 0 : 1]}
        </p>
      )}
      <details className="region-metadata">
        <summary>
          {t("Editor koordinat polygon", "Polygon coordinate editor")}
        </summary>
        <p>
          {t(
            "Satu pasangan bujur, lintang per baris; tanpa mengulang titik awal. Mengedit koordinat tidak langsung menjalankan analisis.",
            "One longitude, latitude pair per line; do not repeat the first vertex. Coordinate edits do not run an analysis.",
          )}
        </p>
        <CoordinateEditor
          vertices={vertices}
          onChange={setVertices}
          language={language}
        />
      </details>
      {setupHost && createPortal(<div className="research-setup">
      <h2>{t("2. Pilih periode analisis", "2. Choose the analysis period")}</h2>
      <p>{polygon && !dirty && !drawing ? t("Area sudah dipilih. Beri nama dan tentukan rentang tanggal.", "Area selected. Give it a name and choose a date range.") : t("Selesaikan area pada peta di atas terlebih dahulu. Klik Gunakan area ini untuk melanjutkan.", "Finish your area on the map above first. Click Use this area to continue.")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void analyze();
        }}
      >
        <div className="research-fields">
          <label>
            {t("Nama area", "Area name")}
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label hidden={workspaces.length <= 1}>
            Workspace
            <select
              value={workspace}
              onChange={(event) => setWorkspace(event.target.value)}
            >
              <option value="">
                {t("Pilih workspace", "Select workspace")}
              </option>
              {workspaces.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Mulai (UTC)", "Start (UTC)")}
            <input
              type="date"
              min="2000-01-01"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          <label>
            {t("Selesai (UTC, inklusif)", "End (UTC, inclusive)")}
            <input
              type="date"
              min={start || "2000-01-01"}
              required
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          </label>
        </div>
        <label className="research-checkbox">
          <input
            type="checkbox"
            checked={compare}
            onChange={(event) => setCompare(event.target.checked)}
          />
          {t("Bandingkan periode lain", "Compare another period")}
        </label>
        {compare && (
          <div className="research-fields">
            <label>
              {t("Awal pembanding", "Comparison start")}
              <input
                type="date"
                min="2000-01-01"
                required
                value={compareStart}
                onChange={(event) => setCompareStart(event.target.value)}
              />
            </label>
            <label>
              {t("Akhir pembanding", "Comparison end")}
              <input
                type="date"
                min={compareStart || "2000-01-01"}
                required
                value={compareEnd}
                onChange={(event) => setCompareEnd(event.target.value)}
              />
            </label>
          </div>
        )}
        <details className="region-metadata">
          <summary>
            {t(
              "Referensi dan konfigurasi analisis",
              "Reference and analysis configuration",
            )}
          </summary>
          <div className="research-fields">
            <label>
              {t("Tahun referensi sebelumnya", "Previous reference years")}
              <input
                type="number"
                min={1}
                step={1}
                value={years}
                onChange={(event) => setYears(Number(event.target.value))}
              />
            </label>
            <label>
              {t(
                "Versi kebijakan kualitas dari backend",
                "Quality policy version from backend",
              )}
              <input
                value={policy}
                onChange={(event) => setPolicy(event.target.value)}
              />
            </label>
          </div>
          <p>
            {t(
              "Default: 10 tahun sebelumnya pada periode kalender yang sama. Estimasi setara MODIS hanya ditampilkan jika metode mendukungnya.",
              "Default: 10 previous years for the same calendar period. MODIS-equivalent estimates are shown only when supported.",
            )}
          </p>
        </details>
        {workspaceError && (
          <p className="global-error" role="status">
            {label(workspaceError)}
          </p>
        )}
        {!workspaceError && workspaceLoaded && workspaces.length === 0 && (
          <div>
            <p role="status">{t("Buat workspace untuk menyimpan area dan analisis tim.", "Create a workspace to save your team's areas and analyses.")}</p>
            <div className="research-fields">
              <label>{t("Nama workspace", "Workspace name")}
                <input maxLength={200} value={newWorkspaceName} onChange={event => setNewWorkspaceName(event.target.value)} />
              </label>
            </div>
            <button type="button" className="outline" disabled={workspaceCreating || !newWorkspaceName.trim()} onClick={() => void addWorkspace()}>
              {workspaceCreating ? t("Membuat…", "Creating…") : t("Buat workspace", "Create workspace")}
            </button>
            {workspaceCreateError && <p className="global-error" role="alert">{label(workspaceCreateError)}</p>}
          </div>
        )}
        <p className="global-note">{t("Area dan hasil disimpan di browser ini. Pemrosesan analisis menggunakan data pada server.", "Areas and results are stored in this browser. Analysis uses data on the server.")}</p>
        {history.length > 0 && <label>{t("Buka hasil tersimpan", "Open saved result")}
          <select value="" onChange={event => {
            const id = event.target.value;
            if (!id) return;
            abort.current?.abort();
            const current = ++generation.current;
            void openResearchResult(id).then(saved => { if (current === generation.current) { publishResult(saved, "saved-local-result"); setJob(null); setError(""); setStatus("succeeded"); } }).catch(() => { if (current === generation.current) setError("STORAGE_UNAVAILABLE"); });
          }}>
            <option value="">{t("Pilih hasil", "Select a result")}</option>
            {history.map(item => <option key={item.id} value={item.id}>{item.name} · {item.start} → {item.end}</option>)}
          </select>
        </label>}
        {!policy && (
          <p className="global-note">
            {t(
              "Versi kebijakan kualitas harus disediakan backend sebelum analisis nyata dapat diajukan.",
              "The backend must supply a quality policy version before a real analysis can be submitted.",
            )}
          </p>
        )}
        <h2>{t("3. Jalankan analisis", "3. Run the analysis")}</h2>
        <p id="research-submit-hint">{drawing || dirty || !polygon
          ? t("Gunakan area ini terlebih dahulu agar analisis memakai batas terbaru.", "Use this area first so the analysis uses the latest boundary.")
          : t("Analisis memakai arsip historis di server. Area tanpa cakupan data akan ditandai, bukan dianggap nol kebakaran.", "Analysis uses the server's historical archive. Areas without data coverage are flagged, not treated as zero fires.")}</p>
        <div className="global-toolbar">
          <button
            className="primary"
            aria-describedby="research-submit-hint"
            disabled={
              busy ||
              !polygon ||
              !workspace ||
              !policy ||
              drawing ||
              dirty
            }
          >
            {t("Analisis area", "Analyze area")}
          </button>
          {busy && (
            <button
              type="button"
              className="outline"
              onClick={() => {
                abort.current?.abort();
                generation.current++;
                setStatus("cancelled");
              }}
            >
              {t("Hentikan pemantauan", "Stop monitoring")}
            </button>
          )}
          <button type="button" className="outline" onClick={preview}>
            {t("Lihat contoh sintetis", "Preview synthetic example")}
          </button>
        </div>
      </form>
      <p role="status" aria-live="polite">
        {label(status)}
        {job?.progressPercent != null ? ` · ${job.progressPercent}%` : ""}
      </p>
      {error && (
        <p className="global-error" role="alert">
          {label(error)}
        </p>
      )}
      {busy && !result && (
        <div
          className="research-skeleton"
          aria-label={t(
            "Menunggu kalender analisis",
            "Waiting for analysis calendar",
          )}
        />
      )}
      </div>, setupHost)}
      {result &&
        resultsHost &&
        createPortal(
          <section
            className="research-results"
            aria-label={t("Hasil analisis", "Analysis result")}
          >
            <h2>
              {t("Kalender aktivitas", "Activity calendar")} ·{" "}
              {result.mode.toUpperCase()}
            </h2>
            {result.mode !== "research" && (
              <p className="global-error">
                {t(
                  "Contoh sintetis / replay — bukan hasil analisis nyata untuk pilihan saat ini.",
                  "Synthetic example / replay — not a real analysis of the current selection.",
                )}
              </p>
            )}
            <p>
              {result.area.name} · {result.primary.period.start} →{" "}
              {result.primary.period.end} UTC ·{" "}
              {t("Revisi area", "Area revision")} {result.area.revision}
            </p>
            {resultKey.current !== selectionKey &&
              result.mode === "research" && (
                <p role="status">
                  {t(
                    "Hasil pilihan sebelumnya tetap ditampilkan. Analisis area untuk menerapkan pilihan baru.",
                    "Previous selection results remain visible. Analyze the area to apply the new selection.",
                  )}
                </p>
              )}
            <p>
              {t(
                "Garis putih: area hasil sebelumnya. Garis biru putus-putus: area yang dipilih. Selama edit, hanya sketsa terbaru ditampilkan.",
                "White outline: previous result area. Dashed blue outline: selected area. Only the current sketch is shown while editing.",
              )}
            </p>
            <ResearchSummary result={result} english={language === "en"} onMonth={month => void loadDays(month)} />
            <ResearchExports key={result.id} result={result} english={language === "en"} demoPoints={resultKey.current === "synthetic-fixture" ? researchDetectionsPageSchema.parse(demo["detections-page"]).observations : undefined} />
            <div className="table-scroll">
              <table>
                <caption>
                  {t(
                    "Ringkasan bulanan; jumlah deteksi, bukan jumlah kebakaran",
                    "Monthly summary; detection counts, not fire counts",
                  )}
                </caption>
                <thead>
                  <tr>
                    <th>{t("Bulan", "Month")}</th>
                    <th>{t("Deteksi mentah", "Raw detections")}</th>
                    <th>
                      {t("Estimasi setara MODIS", "MODIS-equivalent estimate")}
                    </th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.months.map((month) => (
                    <tr key={month.month}>
                      <td>
                        <button
                          className="outline"
                          onClick={() => void loadDays(month.month)}
                        >
                          {month.month}
                        </button>
                      </td>
                      <td>{month.metric.rawCount ?? "—"}</td>
                      <td>{month.metric.harmonizedCount ?? "—"}</td>
                      <td>
                        {label(month.metric.status)}
                        {month.isPartialPeriod
                          ? ` · ${t("bulan tidak penuh", "partial month")}`
                          : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {t("Metode", "Method")}: {result.method.name}{" "}
              {result.method.version} · {result.method.validation} ·{" "}
              {result.dataVersion}
            </p>
            <button
              className="outline"
              disabled={
                loadingPoints ||
                ((mapStatus === "available" ||
                  mapStatus === "fixture_points") &&
                  !cursor)
              }
              onClick={() => void loadPoints()}
            >
              {loadingPoints
                ? t("Memuat titik…", "Loading points…")
                : cursor
                  ? t(
                      "Muat halaman titik berikutnya",
                      "Load next page of points",
                    )
                  : t("Muat titik mentah hasil", "Load result raw points")}
            </button>
            <p role="status">
              {points.length} {t("titik dimuat", "points loaded")} ·{" "}
              {mapStatus === "idle"
                ? t(
                    "Titik belum dimuat; peta bukan indikasi nol deteksi.",
                    "Points not loaded; the map does not indicate zero detections.",
                  )
                : mapStatus
                  ? label(mapStatus)
                  : ""}
            </p>
            {detailStatus && (
              <p role="status">
                {detailStatus === "loading"
                  ? t("Memuat detail harian…", "Loading daily detail…")
                  : label(detailStatus)}
              </p>
            )}
            {days && (
              <details open>
                <summary>
                  {t("Detail harian", "Daily detail")} · {days.month}
                </summary>
                <ul>
                  {days.days.map((day) => (
                    <li key={day.date}>
                      {day.date} · {t("mentah", "raw")}:{" "}
                      {day.metric.rawCount ?? "—"} · {t("estimasi", "estimate")}
                      : {day.metric.harmonizedCount ?? "—"} ·{" "}
                      {label(day.metric.status)}
                    </li>
                  ))}
                </ul>
                {days.nextCursor && (
                  <p>
                    {t(
                      "Halaman pertama saja; detail lanjutan belum dimuat.",
                      "First page only; further daily detail has not been loaded.",
                    )}
                  </p>
                )}
              </details>
            )}
          </section>,
          resultsHost,
        )}
      {resultsHost && createPortal(<ResearchMonitoring result={result} observations={days ? observations.filter(point => point.observedAt.startsWith(days.month)) : observations} activeDetection={activeDetection} english={language === "en"} onReuse={reuseLocation} />, resultsHost)}
    </div>
  );
}

function CoordinateEditor({
  vertices,
  onChange,
  language,
}: {
  vertices: Vertex[];
  onChange: (value: Vertex[]) => void;
  language: Language;
}) {
  const [text, setText] = useState("");
  const [invalid, setInvalid] = useState(false);
  useEffect(
    () => { setText(vertices.map((point) => point.join(", ")).join("\n")); setInvalid(false); },
    [vertices],
  );
  return (
    <div className="research-coordinate-editor">
      <label>
        {language === "id" ? "Bujur, lintang" : "Longitude, latitude"}
        <textarea
          rows={5}
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
        />
      </label>
      <button
        className="outline"
        onClick={() => {
          if (!text.trim()) { onChange([]); setInvalid(false); return; }
          const rows = text
            .trim()
            .split(/\n/)
            .map((row) => row.split(",").map((value) => value.trim()));
          if (
            rows.length > 500 || rows.some(
              (row) =>
                row.length !== 2 ||
                row.some((value) => !value || !Number.isFinite(Number(value))) ||
                Math.abs(Number(row[0])) > 180 || Math.abs(Number(row[1])) > 90,
            )
          ) {
            setInvalid(true);
            return;
          }
          onChange(rows.map((row) => [Number(row[0]), Number(row[1])]));
          setInvalid(false);
        }}
      >
        {language === "id"
          ? "Gunakan koordinat sebagai draft"
          : "Use coordinates as draft"}
      </button>
      {invalid && (
        <p role="alert">
          {language === "id"
            ? "Maksimal 500 titik. Tiap baris: bujur (-180 hingga 180), lintang (-90 hingga 90)."
            : "Up to 500 points. Each line: longitude (-180 to 180), latitude (-90 to 90)."}
        </p>
      )}
    </div>
  );
}
