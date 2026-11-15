import type { ResearchAnalysisResult } from "@/lib/research-contracts";
import { useState, type ReactNode } from "react";
import { calendarColors } from "@/lib/calendar-colors";

export function ResearchSummary({ result, english, onMonth, selectedMonth, overview = false, children }: {
  result: ResearchAnalysisResult;
  english: boolean;
  onMonth: (month: string) => void;
  selectedMonth?: string;
  overview?: boolean;
  children?: ReactNode;
}) {
  const t = (id: string, en: string) => english ? en : id;
  const locale = english ? "en" : "id";
  const [layer, setLayer] = useState<"raw" | "count" | "anomaly">(result.months.some(month => month.metric.harmonizedCount !== null) ? "count" : "raw");
  const values = result.months.map(month => layer === "raw" ? month.metric.rawCount : layer === "count" ? month.metric.harmonizedCount : month.anomaly.scoreKind === "percentile" ? month.anomaly.score : null).filter((value): value is number => value !== null);
  const scaleMaximum = Math.max(0, ...values);
  const maximum = scaleMaximum || 1;
  const number = (value: number | null) => value === null ? "-" : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const status = (value: string) => ({
    assessed: t("Dapat dinilai", "Assessed"),
    insufficient_history: t("Referensi belum cukup", "Insufficient history"),
    insufficient_data: t("Data belum cukup", "Insufficient data"),
    method_unsupported: t("Metode belum mendukung", "Method unsupported"),
    no_data: t("Tidak ada cakupan sumber", "No source coverage"),
    partial: t("Data parsial", "Partial data"),
    available: t("Tersedia", "Available"),
  }[value] ?? value);
  const years = [...new Set(result.months.map(month => month.month.slice(0, 4)))];
  const comparison = result.comparison;
  const raw = result.primary.metric.rawCount;
  const primaryValue = result.primary.metric.harmonizedCount;
  const comparisonValue = comparison?.metric.harmonizedCount ?? null;
  const complete = result.primary.metric.status === "available" && comparison?.metric.status === "available";
  const change = complete && primaryValue !== null && comparisonValue !== null && comparisonValue > 0
    ? 100 * (primaryValue - comparisonValue) / comparisonValue : null;
  return <div className="research-summary">
    {overview && <div className="research-reading">
      <h3>{raw === null ? t("Belum ada cakupan untuk periode ini", "No coverage for this period") : raw === 0 ? t("Tidak ada deteksi pada cakupan yang tersedia", "No detections in available coverage") : t(`${number(raw)} deteksi satelit tercatat`, `${number(raw)} satellite detections recorded`)}</h3>
      {raw !== null && <p>{t("Deteksi dapat tumpang tindih antar sensor; angka ini bukan jumlah kejadian kebakaran.", "Detections can overlap between sensors; this is not a count of separate fires.")}</p>}
      <dl className="research-source-counts">
        {Object.entries(result.primary.metric.rawCountsBySource).map(([source, count]) => <div key={source}><dt>{source.replace("_SP", "").replaceAll("_", " ")}</dt><dd>{number(count)} <small>{count === null ? t("tanpa cakupan", "no coverage") : t("deteksi asli", "original detections")}</small></dd></div>)}
        <div><dt>{t("Estimasi setara MODIS", "MODIS-equivalent estimate")}</dt><dd>{number(primaryValue)} <small>{primaryValue === null ? t("belum tersedia", "unavailable") : t("deteksi estimasi", "estimated detections")}</small></dd></div>
      </dl>
      {raw === null ? <p role="status">{t("Sumber historis tidak memiliki cakupan untuk tanggal pilihan. Buka Cakupan sumber untuk memeriksa tanggal tersedia, atau ambil ulang bagian tersimpan untuk memperbarui hasil.", "The historical sources have no coverage for the selected dates. Open Source coverage to check available dates, or fetch saved parts again to refresh this result.")}</p> : primaryValue === null ? <p className="research-caveat">{result.method.validation === "unsupported" ? t("Gunakan deteksi asli. Estimasi antar sensor belum didukung untuk area/periode ini.", "Use original detections. Cross-sensor estimates are unsupported for this area/period.") : t("Cakupan belum lengkap untuk estimasi. Jumlah asli hanya mencakup data yang tersedia.", "Coverage is incomplete for an estimate. Original counts include available data only.")}</p> : null}
    </div>}
    <div className="research-calendar-heading"><div>
      <h3>{t("Kapan aktivitas terdeteksi?", "When was activity detected?")}</h3>
      <p>{t("Pilih bulan untuk melihat jumlah deteksi setiap hari.", "Select a month to see daily detection counts.")}</p>
    </div>
    <div className="research-actions research-layer-switch" role="group" aria-label={t("Tampilan kalender", "Calendar display")}>
      <button className="outline" type="button" aria-pressed={layer === "raw"} onClick={() => setLayer("raw")}>{t("Deteksi asli", "Original detections")}</button>
      <button className="outline" type="button" aria-pressed={layer === "count"} onClick={() => setLayer("count")}>{t("Estimasi harmonisasi", "Harmonized estimate")}</button>
      <button className="outline" type="button" aria-pressed={layer === "anomaly"} onClick={() => setLayer("anomaly")}>{t("Anomali", "Anomaly")}</button>
    </div>
    </div>
    <p className="research-layer-help">{layer === "raw" ? t("Jumlah deteksi asli per bulan, sebelum penyetaraan antar sensor.", "Original detection counts per month, before cross-sensor harmonization.") : layer === "count" ? t("Estimasi deteksi pada skala MODIS, hanya untuk area dan periode yang didukung.", "Estimated detections on the MODIS scale, for supported areas and periods only.") : t("Persentil terhadap pola musiman historis; bukan probabilitas kebakaran.", "Percentile against historical seasonal patterns; not fire probability.")}</p>
    <div className="research-calendar-legend" aria-label={t("Cara membaca warna", "How to read the colors")}>
      {values.length && (layer === "anomaly" || scaleMaximum > 0) ? <>
      <span>{layer === "anomaly" ? t("Lebih rendah", "Lower") : t("Lebih sedikit", "Fewer")}</span>
      {[0, 0.5, 1].map(fraction => <span className="research-legend-stop" key={fraction}><i style={calendarColors(layer === "anomaly" ? "anomaly" : "count", fraction)} />{layer === "anomaly" ? fraction * 100 : number(maximum * fraction)}</span>)}
      <span>{layer === "anomaly" ? t("Lebih tinggi", "Higher") : t("Lebih banyak", "More")}</span>
      </> : <span>{values.length ? t("Semua bulan tercakup bernilai nol.", "All covered months have zero detections.") : t("Belum ada nilai tersedia pada tampilan ini.", "No values available for this view.")}</span>}
      <span className="research-missing-key">{t("- Tidak tersedia · 0 Nol deteksi", "- Unavailable · 0 Zero detections")}</span>
    </div>
    <div className="table-scroll research-calendar-scroll" tabIndex={0} role="region" aria-label={t("Kalender aktivitas bulanan", "Monthly activity calendar")}>
      <table className="research-calendar-table">
        <caption className="sr-only">{t("Baris menunjukkan tahun, kolom menunjukkan bulan. Pilih bulan untuk detail harian.", "Rows show years; columns show months. Select a month for daily detail.")}</caption>
        <thead><tr><th>{t("Tahun", "Year")}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{new Date(Date.UTC(2000, i)).toLocaleString(locale, { month: "short", timeZone: "UTC" })}</th>)}</tr></thead>
        <tbody>{years.map(year => <tr key={year}><th scope="row">{year}</th>{Array.from({ length: 12 }, (_, i) => {
          const key = `${year}-${String(i + 1).padStart(2, "0")}`;
          const month = result.months.find(item => item.month === key);
          const value = month ? layer === "raw" ? month.metric.rawCount : layer === "count" ? month.metric.harmonizedCount : month.anomaly.scoreKind === "percentile" ? month.anomaly.score : null : null;
          const state = month ? layer === "anomaly" ? month.anomaly.status === "assessed" && month.anomaly.scoreKind !== "percentile" ? t("Persentil tidak tersedia", "Percentile unavailable") : status(month.anomaly.status) : layer === "raw" && value !== null && month.metric.status === "method_unsupported" ? status("available") : status(month.metric.status) : "";
          const fraction = value === null ? null : layer === "anomaly" ? value / 100 : value / maximum;
          return <td key={key}>{month ? <button type="button" className="outline calendar-cell" aria-pressed={selectedMonth === key} style={calendarColors(layer === "anomaly" ? "anomaly" : "count", fraction)} onClick={() => onMonth(key)} aria-label={`${key}: ${number(value)}, ${state}${month.isPartialPeriod ? `, ${t("periode parsial", "partial period")}` : ""}`}>
            <span>{number(value)}</span>
            {(value === null || month.metric.status === "partial" || month.isPartialPeriod) && <small>{value === null ? state : t("Parsial", "Partial")}</small>}
          </button> : <span className="research-outside-month" aria-label={t("Di luar periode", "Outside period")}>·</span>}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {children}
    {comparison && <details className="research-disclosure research-comparison">
      <summary>{t("Bandingkan kedua periode", "Compare both periods")}<span>{change === null ? t("Perbandingan estimasi belum tersedia", "Estimate comparison unavailable") : `${change > 0 ? "+" : ""}${number(change)}%`}</span></summary>
      <div className="table-scroll"><table>
        <caption>{t("Polygon dan metode yang sama digunakan untuk kedua periode.", "Both periods use the same polygon and method.")}</caption>
        <thead><tr><th>{t("Periode UTC", "UTC period")}</th><th>{t("Hari", "Days")}</th><th>{t("Mentah per sumber", "Raw per source")}</th><th>{t("Estimasi", "Estimate")}</th><th>{t("Estimasi/hari", "Estimate/day")}</th><th>Status</th></tr></thead>
        <tbody>{[result.primary, comparison].map((entry, index) => <tr key={index}>
          <td>{entry.period.start} → {entry.period.end}</td><td>{entry.days}</td><td>{Object.entries(entry.metric.rawCountsBySource).map(([source, count]) => `${source}: ${number(count)}`).join(" · ")}</td><td>{number(entry.metric.harmonizedCount)}</td>
          <td>{number(entry.metric.harmonizedCount === null ? null : entry.metric.harmonizedCount / entry.days)}</td><td>{status(entry.metric.status)}</td>
        </tr>)}</tbody>
      </table></div>
      <p>{t("Perubahan total", "Total change")}: {number(change)}{change !== null ? "%" : ` · ${t("Memerlukan dua estimasi lengkap dan pembanding lebih dari nol.", "Requires two complete estimates and a comparison greater than zero.")}`}</p>
      {result.primary.days !== comparison.days && <p>{t("Durasi berbeda: bandingkan juga estimasi per hari; persentase total belum menyesuaikan durasi.", "Durations differ: also compare estimates per day; total percentage does not adjust for duration.")}</p>}
    </details>}
    <details className="research-disclosure"><summary>{t("Cara menghitung anomali dan estimasi", "How anomalies and estimates are calculated")}</summary>
      <p>{t("Referensi: periode kalender yang sama pada tahun-tahun sebelumnya. Statistik baseline ditampilkan per bulan. Persentil bukan probabilitas kebakaran.", "Reference: the same calendar period in preceding years. Baseline statistic is shown per month. Percentiles are not fire probabilities.")} {result.baseline.windowYears} {t("tahun; minimum", "years; minimum")} {result.baseline.minimumValidYears} {t("tahun valid.", "valid years.")}</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Bulan", "Month")}</th><th>Status</th><th>Baseline</th><th>Delta</th><th>{t("Persentil", "Percentile")}</th><th>{t("Tahun referensi", "Reference years")}</th></tr></thead>
        <tbody>{result.months.map(month => <tr key={month.month}><td>{month.month}</td><td>{status(month.anomaly.status)}</td><td>{number(month.anomaly.baselineValue)} · {month.anomaly.baselineStatistic ?? "-"}</td><td>{number(month.anomaly.delta)}</td><td>{month.anomaly.scoreKind === "percentile" ? number(month.anomaly.score) : "-"}</td><td>{month.anomaly.referenceYears.join(", ") || "-"}</td></tr>)}</tbody>
      </table></div>
      <p>{result.method.validationDomain}</p>
    </details>
  </div>;
}
