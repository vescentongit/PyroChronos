"use client";

import { useEffect, useState } from "react";
import type { Language } from "@/lib/regions";
import { getBundle, lastResearchResult, openResearchResult, researchHistory } from "@/lib/local-research-client";
import { listLocations, type LocalLocation } from "@/lib/local-monitoring";
import type { LocalBundle } from "@/lib/research-stages";
import { ResearchSummary } from "./research-summary";
import { ResearchExports } from "./research-exports";
import { ResearchMonitoring } from "./research-monitoring";

export function ConnectedWorkspace({ language, view, onAnalyze, onReuse }: {
  language: Language;
  view: "overview" | "analysis" | "reports";
  onAnalyze: () => void;
  onReuse: (location: LocalLocation) => void;
}) {
  const t = (id: string, en: string) => language === "id" ? id : en;
  const [bundle, setBundle] = useState<LocalBundle | null>(null);
  const [history, setHistory] = useState<ReturnType<typeof researchHistory>>([]);
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [month, setMonth] = useState("");
  useEffect(() => {
    const update = () => setRefresh(value => value + 1);
    for (const event of ["pyro-research-updated", "pyro-monitoring-updated", "storage", "focus"]) window.addEventListener(event, update);
    return () => { for (const event of ["pyro-research-updated", "pyro-monitoring-updated", "storage", "focus"]) window.removeEventListener(event, update); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    Promise.all([
      lastResearchResult().then(result => result ? getBundle(result.id) : null),
      listLocations(),
    ]).then(([next, saved]) => {
      if (!active) return;
      setHistory(researchHistory()); setBundle(next); setLocations(saved);
      setMonth(current => next?.result.months.some(item => item.month === current) ? current : "");
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh, view]);
  const result = bundle?.result ?? null;
  const points = bundle?.detections.filter(page => page.periodRole === "primary").flatMap(page => page.observations) ?? [];
  const assignments = locations.flatMap(location => location.assignments);
  const reports = assignments.flatMap(assignment => assignment.reports);
  const daily = bundle?.days.find(page => page.periodRole === "primary" && page.month === month);
  const status = (value: string) => ({ available: t("Tersedia", "Available"), partial: t("Data parsial", "Partial data"), no_data: t("Tidak ada cakupan data", "No data coverage"), method_unsupported: t("Estimasi tidak didukung", "Estimate unsupported") }[value] ?? value);
  const number = (value: number | null) => value === null ? "-" : value.toLocaleString(language === "id" ? "id-ID" : "en-GB", { maximumFractionDigits: 2 });
  return <section className="research-output" aria-label={t("Ruang kerja analisis tersimpan", "Saved analysis workspace")}>
    <div className="heading">
      <div><h1>{view === "reports" ? t("Laporan lapangan", "Field reports") : view === "analysis" ? t("Perbandingan sensor", "Sensor comparison") : "Dashboard"}</h1>
        <p>{t("Hasil backend historis dan catatan lapangan pada browser ini.", "Historical backend results and field records in this browser.")}</p></div>
      <button type="button" className="primary" onClick={onAnalyze}>{t("Analisis area", "Analyze an area")}</button>
    </div>
    {loading && <p role="status">{t("Memuat hasil tersimpan…", "Loading saved results…")}</p>}
    {error && <p role="alert">{t("Hasil tidak dapat dibaca. Periksa penyimpanan browser lalu coba lagi.", "Could not read saved results. Check browser storage and retry.")} <button className="outline" onClick={() => setRefresh(value => value + 1)}>{t("Coba lagi", "Retry")}</button></p>}
    {history.length > 0 && <div className="research-fields"><label>{t("Hasil analisis", "Analysis result")}<select value={result?.id ?? ""} disabled={loading} onChange={async event => {
      setError(false);
      try { await openResearchResult(event.target.value); } catch { setError(true); }
    }}>{history.map(item => <option key={item.id} value={item.id}>{item.name} · {item.start} → {item.end}</option>)}</select></label></div>}
    {!loading && !result && !error && <p role="status">{t("Belum ada hasil analisis. Gambar polygon dan jalankan analisis historis; hasilnya akan muncul di sini.", "No analysis results yet. Draw a polygon and run historical analysis; its results will appear here.")}</p>}
    {view !== "reports" && <>
      <div className="metrics">
        <article><span>{t("Deteksi asli", "Original detections")}</span><strong>{number(result?.primary.metric.rawCount ?? null)}</strong><p>{result ? status(result.primary.metric.status) : "-"}</p></article>
        <article><span>{t("Estimasi setara MODIS", "MODIS-equivalent estimate")}</span><strong>{number(result?.primary.metric.harmonizedCount ?? null)}</strong><p>{t("Hanya pada domain model yang mendukung", "Only within supported model domains")}</p></article>
        <article><span>{t("Lokasi tersimpan", "Saved locations")}</span><strong>{number(locations.length)}</strong><p>{t("Semua area tersimpan di browser ini", "All areas saved in this browser")}</p></article>
        <article><span>{t("Pemeriksaan lapangan", "Field inspections")}</span><strong>{number(reports.length)}</strong><p>{assignments.filter(item => ["assigned", "in_progress"].includes(item.status)).length} {t("penugasan terbuka", "open assignments")}</p></article>
      </div>
      {result && <div className="research-results">
        <h2>{result.area.name} · {result.mode.toUpperCase()}</h2>
        <p>{result.primary.period.start} → {result.primary.period.end} UTC · {result.primary.days} {t("hari", "days")}</p>
        <p>{t("Hasil snapshot historis, bukan kondisi api saat ini. Nilai kosong bukan nol.", "Historical snapshot, not current fire conditions. Missing values are not zero.")}</p>
        <div className="table-scroll"><table><caption>{t("Deteksi asli per sumber untuk seluruh periode utama", "Original detections by source for the full primary period")}</caption><thead><tr><th>{t("Sumber", "Source")}</th><th>{t("Deteksi asli", "Original detections")}</th><th>Status</th></tr></thead><tbody>{result.sources.map(source => <tr key={source.id}><td>{source.id}</td><td>{number(result.primary.metric.rawCountsBySource[source.id] ?? null)}</td><td>{source.status === "unavailable" ? t("Tidak tersedia", "Unavailable") : status(source.status)}</td></tr>)}</tbody></table></div>
        <ResearchSummary key={result.id} result={result} english={language === "en"} selectedMonth={month} onMonth={setMonth}>
        {daily && <div className="table-scroll"><table><caption>{t("Detail harian", "Daily detail")} · {month} UTC</caption><thead><tr><th>{t("Tanggal", "Date")}</th><th>{t("Deteksi asli", "Original detections")}</th><th>{t("Estimasi", "Estimate")}</th><th>Status</th></tr></thead><tbody>{daily.days.map(day => <tr key={day.date}><td>{day.date}</td><td>{number(day.metric.rawCount)}</td><td>{number(day.metric.harmonizedCount)}</td><td>{status(day.metric.status)}</td></tr>)}</tbody></table></div>}
        </ResearchSummary>
        <ResearchExports key={`exports-${result.id}`} result={result} english={language === "en"} />
      </div>}
    </>}
    {view === "reports" && <ResearchMonitoring result={result} observations={points} activeDetection={null} english={language === "en"} onReuse={onReuse} />}
  </section>;
}
