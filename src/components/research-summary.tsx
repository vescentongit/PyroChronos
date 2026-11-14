import type { ResearchAnalysisResult } from "@/lib/research-contracts";
import { useState } from "react";
import { calendarColors } from "@/lib/calendar-colors";

export function ResearchSummary({ result, english, onMonth }: {
  result: ResearchAnalysisResult;
  english: boolean;
  onMonth: (month: string) => void;
}) {
  const t = (id: string, en: string) => english ? en : id;
  const locale = english ? "en" : "id";
  const [layer, setLayer] = useState<"count" | "anomaly">("count");
  const maximum = Math.max(0, ...result.months.map(month => month.metric.harmonizedCount ?? 0)) || 1;
  const number = (value: number | null) => value === null ? "—" : value.toLocaleString(locale, { maximumFractionDigits: 2 });
  const status = (value: string) => ({
    assessed: t("Dapat dinilai", "Assessed"),
    insufficient_history: t("Referensi belum cukup", "Insufficient history"),
    insufficient_data: t("Data belum cukup", "Insufficient data"),
    method_unsupported: t("Metode belum mendukung", "Method unsupported"),
    no_data: t("Data tidak tersedia", "No data"),
    partial: t("Data parsial", "Partial data"),
    available: t("Tersedia", "Available"),
  }[value] ?? value);
  const years = [...new Set(result.months.map(month => month.month.slice(0, 4)))];
  const comparison = result.comparison;
  const primaryValue = result.primary.metric.harmonizedCount;
  const comparisonValue = comparison?.metric.harmonizedCount ?? null;
  const complete = result.primary.metric.status === "available" && comparison?.metric.status === "available";
  const change = complete && primaryValue !== null && comparisonValue !== null && comparisonValue > 0
    ? 100 * (primaryValue - comparisonValue) / comparisonValue : null;
  return <>
    <p>{t("Estimasi jumlah deteksi setara MODIS; bukan jumlah kejadian kebakaran. Tanda — berarti nilai tidak tersedia.", "Estimated MODIS-equivalent detection counts, not fire events. A dash means unavailable.")}</p>
    <div className="research-actions" aria-label={t("Tampilan kalender", "Calendar display")}>
      <button className="outline" type="button" aria-pressed={layer === "count"} onClick={() => setLayer("count")}>{t("Jumlah deteksi", "Detection count")}</button>
      <button className="outline" type="button" aria-pressed={layer === "anomaly"} onClick={() => setLayer("anomaly")}>{t("Anomali", "Anomaly")}</button>
    </div>
    <p>{layer === "count" ? t("Skala jumlah: biru muda → biru tua mengikuti 0 → estimasi maksimum hasil ini. Angka dan status tetap ditampilkan.", "Count scale: light → dark blue follows 0 → the maximum estimate in this result. Numbers and status remain visible.") : t("Skala anomali: biru → putih → merah untuk persentil 0 → 50 → 100. Referensi belum cukup dan nilai hilang ditampilkan sebagai —.", "Anomaly scale: blue → white → red for percentiles 0 → 50 → 100. Insufficient history and missing values show a dash.")}</p>
    <div className="table-scroll">
      <table>
        <caption>{layer === "count" ? t("Kalender tahun × bulan · estimasi setara MODIS. Pilih bulan untuk detail harian.", "Year × month calendar · MODIS-equivalent estimates. Select a month for daily detail.") : t("Kalender anomali · persentil historis. Pilih bulan untuk detail harian.", "Anomaly calendar · historical percentile. Select a month for daily detail.")}</caption>
        <thead><tr><th>{t("Tahun", "Year")}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{new Date(Date.UTC(2000, i)).toLocaleString(locale, { month: "short", timeZone: "UTC" })}</th>)}</tr></thead>
        <tbody>{years.map(year => <tr key={year}><th scope="row">{year}</th>{Array.from({ length: 12 }, (_, i) => {
          const key = `${year}-${String(i + 1).padStart(2, "0")}`;
          const month = result.months.find(item => item.month === key);
          const value = month ? layer === "count" ? month.metric.harmonizedCount : month.anomaly.scoreKind === "percentile" ? month.anomaly.score : null : null;
          const state = month ? layer === "anomaly" && month.anomaly.status === "assessed" && month.anomaly.scoreKind !== "percentile" ? t("Persentil tidak tersedia", "Percentile unavailable") : status(layer === "count" ? month.metric.status : month.anomaly.status) : "";
          const fraction = value === null ? null : layer === "count" ? value / maximum : value / 100;
          return <td key={key}>{month ? <button type="button" className="outline calendar-cell" style={calendarColors(layer, fraction)} onClick={() => onMonth(key)} aria-label={`${key}: ${number(value)}, ${state}`}>
            {number(value)}
            <small>{state}{month.isPartialPeriod ? ` · ${t("parsial", "partial")}` : ""}</small>
          </button> : <span aria-label={t("Di luar periode", "Outside period")}>—</span>}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
    {comparison && <>
      <h3>{t("Perbandingan periode", "Period comparison")}</h3>
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
    </>}
    <details><summary>{t("Anomali dan metode", "Anomalies and method")}</summary>
      <p>{t("Referensi: periode kalender yang sama pada tahun-tahun sebelumnya. Statistik baseline ditampilkan per bulan. Persentil bukan probabilitas kebakaran.", "Reference: the same calendar period in preceding years. Baseline statistic is shown per month. Percentiles are not fire probabilities.")} {result.baseline.windowYears} {t("tahun; minimum", "years; minimum")} {result.baseline.minimumValidYears} {t("tahun valid.", "valid years.")}</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Bulan", "Month")}</th><th>Status</th><th>Baseline</th><th>Delta</th><th>{t("Persentil", "Percentile")}</th><th>{t("Tahun referensi", "Reference years")}</th></tr></thead>
        <tbody>{result.months.map(month => <tr key={month.month}><td>{month.month}</td><td>{status(month.anomaly.status)}</td><td>{number(month.anomaly.baselineValue)} · {month.anomaly.baselineStatistic ?? "—"}</td><td>{number(month.anomaly.delta)}</td><td>{month.anomaly.scoreKind === "percentile" ? number(month.anomaly.score) : "—"}</td><td>{month.anomaly.referenceYears.join(", ") || "—"}</td></tr>)}</tbody>
      </table></div>
      <p>{result.method.validationDomain}</p>
    </details>
  </>;
}
