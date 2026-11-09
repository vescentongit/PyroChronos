"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  Flame,
  LayoutDashboard,
  Map,
  ChartNoAxesCombined,
  ClipboardList,
  ArrowUpRight,
  ArrowRight,
  Download,
  ChevronDown,
  Clock3,
  Satellite,
  Info,
  Menu,
  LocateFixed,
  RefreshCw,
  Globe2,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { studyRegions, type Language, type RegionId } from "@/lib/regions";
import {
  candidateWindow,
  snapshotCsv,
  snapshotStatus,
  type DataMode,
  type SnapshotCandidate,
} from "@/lib/snapshot";
import { useSnapshot } from "./use-snapshot";
import { InspectionReports } from "./inspection-reports";

const FireMap = dynamic(() => import("./fire-map"), { ssr: false });
const GlobalHeatmap = dynamic(() => import("./global-heatmap"), { ssr: false });
const emptyCandidates: SnapshotCandidate[] = [];
type View = "overview" | "map" | "analysis" | "reports" | "global";
type Tab = "latest" | "older" | "history";
const statusNames = {
  live: { id: "Terbaru", en: "Live" },
  stale: { id: "Data lama", en: "Stale" },
  partial: { id: "Data parsial", en: "Partial" },
  unavailable: { id: "Tidak tersedia", en: "Unavailable" },
  replay: { id: "Simulasi / replay", en: "Simulation / replay" },
};

export default function DashboardWorkspace() {
  const [language, setLanguage] = useState<Language>("id");
  const [regionId, setRegionId] = useState<RegionId>("kalteng");
  const [mode, setMode] = useState<DataMode>("demo");
  const [view, setView] = useState<View>("global");
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<Tab>("latest");
  const [menu, setMenu] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [reportRequest, setReportRequest] = useState(0);
  const [now, setNow] = useState(Date.now());
  const t = (id: string, en: string) => (language === "id" ? id : en);
  const locale = language === "id" ? "id-ID" : "en-GB";
  const date = (value: string | null | undefined) =>
    value
      ? `${new Date(value).toLocaleString(locale, { timeZone: "UTC" })} UTC`
      : t("Tidak tersedia", "Unavailable");
  const region = studyRegions.find((item) => item.id === regionId)!;
  const { snapshot, loading, failed } = useSnapshot(region, mode, refresh);
  const status = snapshot
    ? snapshotStatus(snapshot, now, failed || loading)
    : "unavailable";
  const statusLabel = loading
    ? t("Memuat data…", "Loading data…")
    : statusNames[status][language];
  const points =
    snapshot && snapshot.status !== "unavailable"
      ? snapshot.candidates
      : emptyCandidates;
  const active = points.find((point) => point.id === selected) || points[0];
  const assessedAt = snapshot?.evaluatedAt || new Date(now).toISOString();
  const list = points.filter(
    (point) => candidateWindow(point.observedAt, assessedAt) === tab,
  );
  const choose = useCallback((id: string) => setSelected(id), []);
  const report = () => setReportRequest((value) => value + 1);
  const unavailable = !snapshot || snapshot.status === "unavailable";
  const hasData = !unavailable && !loading;
  const priority = (value: string | null) =>
    value === "high"
      ? t("Tinggi", "High")
      : value === "medium"
        ? t("Sedang", "Medium")
        : t("Belum dinilai", "Not assessed");
  const navigation = [
    { id: "overview" as const, name: "Dashboard", icon: LayoutDashboard },
    {
      id: "map" as const,
      name: t("Peta aktivitas", "Activity map"),
      icon: Map,
    },
    {
      id: "analysis" as const,
      name: t("Analisis historis", "Historical analysis"),
      icon: ChartNoAxesCombined,
    },
    {
      id: "reports" as const,
      name: t("Laporan lapangan", "Field reports"),
      icon: ClipboardList,
    },
    {
      id: "global" as const,
      name: t("Heatmap global", "Global heatmap"),
      icon: Globe2,
    },
  ];

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const requestedRegion = query.get("region");
    if (studyRegions.some((item) => item.id === requestedRegion)) {
      setRegionId(requestedRegion as RegionId);
      setView("overview");
    }
    if (query.get("mode") === "operational") setMode("operational");
    try {
      const saved = localStorage.getItem("pyro-language");
      if (saved === "id" || saved === "en") setLanguage(saved);
    } catch {
      /* The language switch works without persistence. */
    }
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  function changeLanguage(value: Language) {
    setLanguage(value);
    try {
      localStorage.setItem("pyro-language", value);
    } catch {
      /* Optional preference storage. */
    }
  }
  function changeRegion(value: RegionId) {
    setRegionId(value);
    setSelected("");
  }
  function download(format: "csv" | "json") {
    if (!snapshot) return;
    const contents =
      format === "csv"
        ? snapshotCsv(snapshot, status, language)
        : JSON.stringify(
            {
              ...snapshot,
              status,
              exportedAt: new Date().toISOString(),
              region,
            },
            null,
            2,
          );
    const url = URL.createObjectURL(
      new Blob([contents], {
        type: format === "csv" ? "text/csv;charset=utf-8" : "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pyrochronos-${snapshot.mode}-${region.id}-${snapshot.runId.replace(/[^a-zA-Z0-9_-]/g, "_")}.${format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const chartData =
    snapshot?.series.map((point) => ({
      ...point,
      day: new Date(point.at).toLocaleDateString(locale, {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
    })) || [];

  return (
    <div className="shell">
      <a className="skip-link" href="#workspace-content">
        {t("Lewati ke konten", "Skip to content")}
      </a>
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a className="brand" href="/">
          <span className="brand-icon">
            <Flame size={22} />
          </span>{" "}
          PyroChronos<span className="brand-period">.</span>
        </a>
        <div className="workspace">
          {t("RUANG KERJA", "WORKSPACE")}
          <span>
            {t("Observatorium api Indonesia", "Indonesia Fire Observatory")}
          </span>
        </div>
        <nav aria-label={t("Navigasi utama", "Main navigation")}>
          {navigation.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "nav-item active" : "nav-item"}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.id);
                setMenu(false);
              }}
            >
              <item.icon size={18} />
              {item.name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="mission">
            <Satellite size={20} />
            <strong>
              {t("Dari orbit, untuk bumi.", "From orbit, for Earth.")}
            </strong>
            <p>
              {t(
                "Data lintas sensor untuk keputusan yang lebih terarah.",
                "Cross-sensor evidence for informed decisions.",
              )}
            </p>
            <a
              href="https://firms.modaps.eosdis.nasa.gov/"
              target="_blank"
              rel="noreferrer"
            >
              NASA FIRMS <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="profile">
            <span>KO</span>
            <div>
              {t("Koordinator observasi", "Observation coordinator")}
              <small>
                {view === "global"
                  ? "NASA FIRMS"
                  : mode === "demo"
                    ? t("Ruang kerja demo", "Demo workspace")
                    : t("Pemantauan", "Monitoring")}
              </small>
            </div>
          </div>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <button
            className="mobile-toggle"
            aria-label={t("Buka/tutup navigasi", "Toggle navigation")}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            {t("Ruang kerja", "Workspace")} <span>/</span>{" "}
            {navigation.find((item) => item.id === view)?.name}
          </div>
          <div className="top-actions">
            <label className="language-switch">
              <span>{t("Bahasa", "Language")}</span>
              <select
                aria-label={t("Bahasa", "Language")}
                value={language}
                onChange={(event) =>
                  changeLanguage(event.target.value as Language)
                }
              >
                <option value="en">English</option>
                <option value="id">Indonesia</option>
              </select>
            </label>
            <span className="demo-label">
              {view === "global"
                ? "FIRMS NRT"
                : mode === "demo"
                  ? "DEMO"
                  : t("OPERASIONAL", "OPERATIONAL")}
            </span>
          </div>
        </header>
        <div className="content" id="workspace-content" tabIndex={-1}>
          {view === "global" ? (
            <GlobalHeatmap language={language} />
          ) : (
            <>
              <div className="heading">
                <div>
                  <h1>
                    {view === "overview"
                      ? t(
                          "Pantau hari ini. Pahami konteksnya.",
                          "Monitor today. Understand the context.",
                        )
                      : navigation.find((item) => item.id === view)?.name}
                  </h1>
                  <p>
                    {t(
                      "Aktivitas deteksi teramati, dengan perspektif historis lintas sensor.",
                      "Observed detection activity with cross-sensor historical context.",
                    )}
                  </p>
                </div>
                <div className="export-actions">
                  <button
                    className="outline"
                    disabled={!snapshot || loading}
                    onClick={() => download("csv")}
                  >
                    <Download size={16} />
                    CSV
                  </button>
                  <button
                    className="outline"
                    disabled={!snapshot || loading}
                    onClick={() => download("json")}
                  >
                    JSON
                  </button>
                </div>
              </div>
              <div className="toolbar">
                <div className="region-select">
                  <Map size={16} />
                  <select
                    aria-label={t("Wilayah studi", "Study region")}
                    value={region.id}
                    onChange={(event) =>
                      changeRegion(event.target.value as RegionId)
                    }
                  >
                    {studyRegions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name[language]}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} />
                </div>
                <label className="mode-select">
                  {t("Mode", "Mode")}
                  <select
                    value={mode}
                    onChange={(event) => {
                      setMode(event.target.value as DataMode);
                      setSelected("");
                    }}
                  >
                    <option value="demo">Demo</option>
                    <option value="operational">
                      {t("Operasional", "Operational")}
                    </option>
                  </select>
                </label>
                <button
                  className="outline"
                  disabled={loading || mode === "demo"}
                  onClick={() => setRefresh((value) => value + 1)}
                >
                  <RefreshCw size={14} />
                  {t("Perbarui", "Refresh")}
                </button>
              </div>
              <div className="demo-banner" role="status">
                <Info size={16} />
                <span>
                  <strong>
                    {mode === "demo"
                      ? t("Data ilustratif.", "Illustrative data.")
                      : statusLabel}
                  </strong>{" "}
                  {mode === "demo"
                    ? t(
                        "Bukan kondisi kebakaran saat ini. Semua skor dan seri historis adalah simulasi.",
                        "Not current fire conditions. All scores and historical series are simulated.",
                      )
                    : failed
                      ? t(
                          "Pembaruan gagal. Snapshot valid terakhir, jika tersedia, tetap ditampilkan sebagai data lama.",
                          "Refresh failed. The last valid snapshot, if available, is shown as stale.",
                        )
                      : t(
                          "Usia data dan kelengkapan sumber perlu diperiksa sebelum memilih lokasi.",
                          "Check data age and source completeness before choosing a location.",
                        )}
                </span>
                <a href="#method" onClick={() => setView("analysis")}>
                  {t("Metode", "Method")}
                  <ArrowRight size={14} />
                </a>
              </div>
              <details className="region-metadata">
                <summary>
                  {region.name[language]} ·{" "}
                  {region.areaKm2.toLocaleString(locale)} km² ·{" "}
                  {t("Batas studi sementara", "Provisional study boundary")}
                </summary>
                <p>
                  {t(
                    "Kotak studi internal, bukan batas administrasi. Geometri final menunggu persetujuan tim.",
                    "Internal study rectangle, not an administrative boundary. Final geometry awaits team approval.",
                  )}
                </p>
                <p>
                  {region.source} · {region.boundaryVersion} ·{" "}
                  {region.bounds.join(", ")}
                </p>
                <p>
                  {t(
                    "Luas pendekatan bola bumi; bukan luas administratif resmi.",
                    "Spherical area approximation; not an official administrative area.",
                  )}
                </p>
              </details>
              <div className="snapshot-status" aria-live="polite">
                <strong>{statusLabel}</strong>
                <span>
                  <Clock3 size={14} />
                  {t("Penilaian", "Assessment")}: {date(snapshot?.evaluatedAt)}
                </span>
                <span>
                  {t("Diunduh", "Ingested")}: {date(snapshot?.ingestedAt)}
                </span>
                <span>
                  {t("Dipublikasi", "Published")}: {date(snapshot?.publishedAt)}
                </span>
              </div>
              {loading && (
                <p role="status">
                  {t(
                    "Memuat snapshot wilayah terpilih…",
                    "Loading the selected region's snapshot…",
                  )}
                </p>
              )}
              {!loading && unavailable && (
                <section className="empty unavailable-state" role="status">
                  <Satellite size={32} />
                  <h2>
                    {t(
                      "Analitik wilayah belum tersedia",
                      "Regional analytics unavailable",
                    )}
                  </h2>
                  <p>
                    {t(
                      "Tidak ada snapshot valid untuk wilayah ini. Informasi yang hilang tidak berarti tidak ada api.",
                      "There is no valid snapshot for this region. Missing information does not mean no fire.",
                    )}
                  </p>
                </section>
              )}

              {view !== "reports" && (
                <>
                  <section className="metrics">
                    <article>
                      <span>
                        {t(
                          "Kandidat ≤24 jam saat penilaian",
                          "Candidates ≤24h at assessment",
                        )}
                        <LocateFixed size={17} />
                      </span>
                      <strong>
                        {hasData
                          ? points.filter(
                              (point) =>
                                candidateWindow(
                                  point.observedAt,
                                  assessedAt,
                                ) === "latest",
                            ).length
                          : "—"}
                        <small>{t("lokasi", "locations")}</small>
                      </strong>
                      <p>
                        {t(
                          "Jendela mengacu waktu penilaian snapshot",
                          "Window uses the snapshot assessment time",
                        )}
                      </p>
                    </article>
                    <article>
                      <span>
                        {t("Prioritas tinggi", "High priority")}
                        <Flame size={17} />
                      </span>
                      <strong className="orange">
                        {hasData
                          ? points.filter(
                              (point) =>
                                point.priority === "high" &&
                                candidateWindow(
                                  point.observedAt,
                                  assessedAt,
                                ) === "latest",
                            ).length
                          : "—"}
                      </strong>
                      <p>
                        {t(
                          "Anomali, kebaruan, dan persistensi",
                          "Anomaly, recency and persistence",
                        )}
                      </p>
                    </article>
                    <article>
                      <span>
                        {t("Konteks pengulangan", "Persistence context")}
                        <Satellite size={17} />
                      </span>
                      <strong>
                        7<small>{t("hari", "days")}</small>
                      </strong>
                      <p>
                        {t(
                          "Bukan bukti api menyala terus-menerus",
                          "Does not prove continuous burning",
                        )}
                      </p>
                    </article>
                    <article>
                      <span>
                        {t("Cakupan observasi", "Observation coverage")}
                        <Info size={17} />
                      </span>
                      <strong className="no-data">
                        {t("Belum diketahui", "Unknown")}
                      </strong>
                      <p>
                        {t(
                          "Titik FIRMS tidak memuat QA awan",
                          "FIRMS points do not include cloud QA",
                        )}
                      </p>
                    </article>
                  </section>
                  {(view === "overview" || view === "map") && (
                    <section className="map-section">
                      <div className="section-heading">
                        <div>
                          <h2>{t("Peta aktivitas", "Activity map")}</h2>
                          <p>
                            {t(
                              "Pilih penanda atau baris lokasi untuk menelaah bukti.",
                              "Select a marker or location row to review the evidence.",
                            )}
                          </p>
                        </div>
                        <span className="sensor-label">MODIS + VIIRS</span>
                      </div>
                      <div className="map-layout">
                        <FireMap
                          region={region}
                          language={language}
                          points={points}
                          selected={active?.id || ""}
                          assessedAt={assessedAt}
                          label={
                            mode === "demo"
                              ? t("Data ilustratif", "Illustrative data")
                              : statusLabel
                          }
                          onSelect={choose}
                        />
                        <aside className="location-detail">
                          {active ? (
                            <>
                              <div className="detail-top">
                                <span
                                  className={`badge ${active.priority === "high" ? "high" : ""}`}
                                >
                                  {priority(active.priority)}
                                </span>
                                <span className="sample">{statusLabel}</span>
                              </div>
                              <h3>{active.name}</h3>
                              <p>{active.district}</p>
                              <div className="coords">
                                {active.lat.toFixed(4)}°,{" "}
                                {active.lng.toFixed(4)}°
                              </div>
                              <dl>
                                <div>
                                  <dt>
                                    {t("Deteksi terakhir", "Last detection")}
                                  </dt>
                                  <dd>{date(active.observedAt)}</dd>
                                </div>
                                <div>
                                  <dt>
                                    {t(
                                      "Pengulangan 7 hari",
                                      "Repeated observations, 7 days",
                                    )}
                                  </dt>
                                  <dd>{active.repeats ?? "—"}</dd>
                                </div>
                                <div>
                                  <dt>
                                    {t(
                                      "Persentil historis",
                                      "Historical percentile",
                                    )}
                                  </dt>
                                  <dd>
                                    {active.anomaly === null
                                      ? "—"
                                      : `P${active.anomaly}`}
                                  </dd>
                                </div>
                                <div>
                                  <dt>{t("Sensor", "Sensor")}</dt>
                                  <dd>{active.sensor}</dd>
                                </div>
                              </dl>
                              <div className="reason">
                                <Info size={15} />
                                <p>{active.reason[language]}</p>
                              </div>
                              <button className="primary" onClick={report}>
                                <ClipboardList size={16} />
                                {t("Catat pemeriksaan", "Record inspection")}
                              </button>
                              <small className="detail-foot">
                                {t(
                                  "Kandidat verifikasi; bukan konfirmasi kebakaran.",
                                  "Verification candidate; not a fire confirmation.",
                                )}
                              </small>
                            </>
                          ) : (
                            <div className="empty">
                              <h3>
                                {t(
                                  "Belum ada kandidat",
                                  "No candidates available",
                                )}
                              </h3>
                              <p>
                                {t(
                                  "Kondisi api belum dapat disimpulkan.",
                                  "Fire conditions cannot be inferred.",
                                )}
                              </p>
                            </div>
                          )}
                        </aside>
                      </div>
                    </section>
                  )}
                  {(view === "overview" || view === "analysis") && (
                    <section className="analysis-grid" id="method">
                      <article className="trend">
                        <div className="section-heading">
                          <div>
                            <h2>
                              {t(
                                "Aktivitas dalam perspektif",
                                "Activity in context",
                              )}
                            </h2>
                            <p>
                              {t(
                                "Aktivitas deteksi teramati · sel-hari terdeteksi · UTC",
                                "Observed detection activity · detected cell-days · UTC",
                              )}
                            </p>
                          </div>
                          <span className="chart-legend">
                            <i />
                            {t("Teramati", "Observed")}
                            <i />
                            {t("Baseline", "Baseline")}
                          </span>
                        </div>
                        <div className="chart">
                          {chartData.length && !unavailable ? (
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart
                                data={chartData}
                                margin={{ left: -15, right: 10, top: 15 }}
                              >
                                <CartesianGrid
                                  strokeDasharray="3 5"
                                  vertical={false}
                                  stroke="#303030"
                                />
                                <XAxis
                                  dataKey="day"
                                  tick={{ fontSize: 11, fill: "#bdbdbd" }}
                                  tickLine={false}
                                  axisLine={false}
                                  interval={3}
                                />
                                <YAxis
                                  tick={{ fontSize: 11, fill: "#bdbdbd" }}
                                  tickLine={false}
                                  axisLine={false}
                                />
                                <Tooltip />
                                <Area
                                  type="monotone"
                                  dataKey="baseline"
                                  name={t("Baseline", "Baseline")}
                                  stroke="#7897c9"
                                  fill="#0a3c9133"
                                  strokeDasharray="5 4"
                                  connectNulls={false}
                                />
                                <Area
                                  type="monotone"
                                  dataKey="observed"
                                  name={t("Teramati", "Observed")}
                                  stroke="#fc3c23"
                                  fill="#fc3c2320"
                                  connectNulls={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          ) : (
                            <div className="empty">
                              {t(
                                "Seri historis belum tersedia. Nilai kosong tidak digambar sebagai nol.",
                                "Historical series unavailable. Missing values are not drawn as zero.",
                              )}
                            </div>
                          )}
                        </div>
                      </article>
                      <article className="context-panel">
                        <span className="context-icon">
                          <ChartNoAxesCombined size={22} />
                        </span>
                        <h2>
                          {t(
                            "Lebih banyak titik, belum tentu lebih banyak api.",
                            "More hotspots do not always mean more fire.",
                          )}
                        </h2>
                        <p>
                          {t(
                            "Sensor memiliki resolusi dan jadwal berbeda. Perbandingan harus memakai geometri, durasi, dan konfigurasi yang sebanding.",
                            "Sensors differ in resolution and observation schedule. Comparisons need consistent geometry, duration and sensor configuration.",
                          )}
                        </p>
                        <div className="method-status">
                          {snapshot?.method.name || "—"} ·{" "}
                          {snapshot?.method.version || "—"}
                        </div>
                        <p>
                          {t("Baseline", "Baseline")}:{" "}
                          {snapshot?.method.baselinePeriod ||
                            t("Tidak tersedia", "Unavailable")}
                        </p>
                        <p>
                          {snapshot?.method.validation === "validated"
                            ? t(
                                "Metode telah dievaluasi untuk konfigurasi ini.",
                                "Method evaluated for this configuration.",
                              )
                            : t(
                                "Kalibrasi belum tervalidasi untuk konfigurasi ini.",
                                "Calibration is not validated for this configuration.",
                              )}
                        </p>
                        <a
                          href="https://firms.modaps.eosdis.nasa.gov/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("Sumber data", "Data source")}
                          <ArrowUpRight size={15} />
                        </a>
                      </article>
                    </section>
                  )}
                  {(view === "overview" || view === "map") && (
                    <section className="candidate-section">
                      <div className="section-heading">
                        <div>
                          <h2>
                            {t("Lokasi untuk ditelaah", "Locations to review")}
                          </h2>
                          <p>
                            {t(
                              "Tanpa deteksi terbaru bukan berarti padam atau sudah diperiksa.",
                              "No recent detection does not mean extinguished or inspected.",
                            )}
                          </p>
                        </div>
                        <span className="sample">
                          {mode === "demo"
                            ? t("ILUSTRATIF", "ILLUSTRATIVE")
                            : statusLabel}
                        </span>
                      </div>
                      <div
                        className="tabs"
                        role="group"
                        aria-label={t("Jendela kandidat", "Candidate window")}
                      >
                        {(["latest", "older", "history"] as const).map(
                          (value) => (
                            <button
                              key={value}
                              aria-pressed={tab === value}
                              className={tab === value ? "chosen" : ""}
                              onClick={() => setTab(value)}
                            >
                              {value === "latest"
                                ? t(
                                    "≤24 jam saat penilaian",
                                    "≤24h at assessment",
                                  )
                                : value === "older"
                                  ? t(
                                      "Cek kembali (24j–7h)",
                                      "Recheck (24h–7d)",
                                    )
                                  : t("Riwayat >7 hari", "History >7 days")}
                              <span>
                                {unavailable
                                  ? "—"
                                  : points.filter(
                                      (point) =>
                                        candidateWindow(
                                          point.observedAt,
                                          assessedAt,
                                        ) === value,
                                    ).length}
                              </span>
                            </button>
                          ),
                        )}
                      </div>
                      <div className="table-scroll">
                        <table>
                          <caption className="visually-hidden">
                            {t(
                              "Kandidat wilayah terpilih",
                              "Selected region candidates",
                            )}
                          </caption>
                          <thead>
                            <tr>
                              <th scope="col">{t("Lokasi", "Location")}</th>
                              <th scope="col">{t("Prioritas", "Priority")}</th>
                              <th scope="col">
                                {t("Waktu observasi", "Observed at")}
                              </th>
                              <th scope="col">
                                {t("Pengulangan", "Repeated observations")}
                              </th>
                              <th scope="col">
                                {t("Pemeriksaan", "Inspection")}
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((point) => (
                              <tr
                                key={point.id}
                                className={
                                  active?.id === point.id ? "selected-row" : ""
                                }
                              >
                                <td>
                                  <button
                                    className="location-link"
                                    onClick={() => choose(point.id)}
                                  >
                                    {point.name}
                                    <small>{point.district}</small>
                                  </button>
                                </td>
                                <td>
                                  <span
                                    className={`badge ${point.priority === "high" ? "high" : ""}`}
                                  >
                                    {priority(point.priority)}
                                  </span>
                                </td>
                                <td>{date(point.observedAt)}</td>
                                <td>{point.repeats ?? "—"}</td>
                                <td>
                                  <button
                                    className="row-action"
                                    aria-label={`${t("Catat pemeriksaan", "Record inspection")} ${point.name}`}
                                    onClick={() => {
                                      choose(point.id);
                                      report();
                                    }}
                                  >
                                    <ArrowUpRight size={18} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!list.length && (
                          <p className="table-note" role="status">
                            {unavailable
                              ? t("Data belum tersedia.", "Data unavailable.")
                              : t(
                                  "Tidak ada kandidat pada jendela ini; kondisi api belum terverifikasi.",
                                  "No candidates in this window; fire conditions remain unverified.",
                                )}
                          </p>
                        )}
                      </div>
                    </section>
                  )}
                </>
              )}
              <InspectionReports
                language={language}
                mode={mode}
                region={region}
                candidates={points}
                active={active}
                showHistory={view === "reports"}
                request={reportRequest}
                onRequest={report}
              />
              {snapshot && (
                <section className="source-status">
                  <h2>
                    {t("Sumber dan keterlacakan", "Sources and provenance")}
                  </h2>
                  <p>
                    {t("Run", "Run")}: {snapshot.runId} ·{" "}
                    {snapshot.boundaryVersion}
                  </p>
                  {snapshot.sources.map((source) => (
                    <details key={source.id}>
                      <summary>
                        {source.product} · {source.version} ·{" "}
                        {source.status === "available"
                          ? t("Tersedia", "Available")
                          : source.status === "partial"
                            ? t("Parsial", "Partial")
                            : t("Tidak tersedia", "Unavailable")}
                      </summary>
                      <p>
                        {t("Observasi terakhir", "Last observation")}:{" "}
                        {date(source.observedAt)}
                      </p>
                      <p>
                        {t("Diunduh", "Ingested")}: {date(source.ingestedAt)}
                      </p>
                      <p>Checksum: {source.checksum}</p>
                    </details>
                  ))}
                </section>
              )}
            </>
          )}
          <footer>
            <span>
              <Flame size={14} /> PyroChronos ·{" "}
              {t("Observatorium api Indonesia", "Indonesia Fire Observatory")}
            </span>
            <span>
              NASA Space Apps Challenge 2026 · {t("Prototipe", "Prototype")}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
