import type { ResearchAnalysisResult } from "@/lib/research-contracts";
import { useState, type CSSProperties } from "react";
import { CountUp } from "@/components/count-up";
import { calendarColors } from "@/lib/calendar-colors";

type Layer = "count" | "anomaly" | "raw";

export function ResearchSummary({ result, english, onMonth }: {
  result: ResearchAnalysisResult;
  english: boolean;
  onMonth: (month: string) => void;
}) {
  const t = (id: string, en: string) => english ? en : id;
  const locale = english ? "en" : "id";
  const sourceIds = result.sources.map(source => source.id);
  const hasEstimate = result.months.some(month => month.metric.harmonizedCount !== null);
  const [chosen, setLayer] = useState<Layer>("count");
  const [source, setSource] = useState(sourceIds[0] ?? "");
  const [focus, setFocus] = useState<string | null>(null);
  const layer: Layer = chosen === "count" && !hasEstimate ? "raw" : chosen;
  const activeSource = sourceIds.includes(source) ? source : sourceIds[0] ?? "";
  const sourceName = (id: string) => id.replace("_SP", "").replace("_", " ");
  const cellValue = (month: ResearchAnalysisResult["months"][number]) =>
    layer === "count" ? month.metric.harmonizedCount
      : layer === "raw" ? month.metric.rawCountsBySource[activeSource] ?? null
        : month.anomaly.scoreKind === "percentile" ? month.anomaly.score : null;
  const maximum = Math.max(0, ...result.months.map(month => layer === "anomaly" ? 0 : cellValue(month) ?? 0)) || 1;
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
  const assessed = result.months.filter(month => month.anomaly.status === "assessed");
  const peak = assessed.reduce<typeof assessed[number] | null>((best, month) =>
    month.anomaly.scoreKind === "percentile" && month.anomaly.score !== null && (!best || month.anomaly.score > (best.anomaly.score ?? -1)) ? month : best, null);
  const monthName = (key: string) => new Date(Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1)).toLocaleString(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  const focused = focus ? result.months.find(month => month.month === focus) ?? null : null;
  const stops = Array.from({ length: 11 }, (_, index) => calendarColors(layer === "anomaly" ? "anomaly" : "count", index / 10).background).join(", ");
  const layerNote = layer === "count"
    ? t("Skala jumlah: biru muda → biru tua mengikuti 0 → estimasi maksimum hasil ini. Angka dan status tetap ditampilkan.", "Count scale: light → dark blue follows 0 → the maximum estimate in this result. Numbers and status remain visible.")
    : layer === "raw"
      ? t("Skala deteksi mentah satu sensor: biru muda → biru tua mengikuti 0 → nilai maksimum sensor ini. Sensor berbeda tidak dijumlahkan.", "Raw detections of one sensor: light → dark blue follows 0 → this sensor's maximum. Different sensors are never added together.")
      : t("Skala anomali: biru → putih → merah untuk persentil 0 → 50 → 100. Referensi belum cukup dan nilai hilang ditampilkan sebagai —.", "Anomaly scale: blue → white → red for percentiles 0 → 50 → 100. Insufficient history and missing values show a dash.");
  return <>
    <p>{t("Estimasi jumlah deteksi setara MODIS; bukan jumlah kejadian kebakaran. Tanda — berarti nilai tidak tersedia.", "Estimated MODIS-equivalent detection counts, not fire events. A dash means unavailable.")}</p>
    <div className="fire-kpis">
      <div className="fire-kpi fire-kpi-lead">
        <span>{hasEstimate ? t("Estimasi setara MODIS", "MODIS-equivalent estimate") : t("Estimasi ditahan", "Estimate withheld")}</span>
        <strong><CountUp value={primaryValue} locale={locale} /></strong>
        <small>{result.primary.period.start} → {result.primary.period.end} UTC · {result.primary.days} {t("hari", "days")}</small>
      </div>
      <div className="fire-kpi">
        <span>{t("Deteksi mentah per sensor", "Raw detections per sensor")}</span>
        <ul>{Object.entries(result.primary.metric.rawCountsBySource).map(([id, count]) => <li key={id}><b>{sourceName(id)}</b><CountUp value={count} locale={locale} /></li>)}</ul>
      </div>
      <div className="fire-kpi">
        <span>{t("Bulan dapat dinilai", "Months assessed")}</span>
        <strong><CountUp value={assessed.length} locale={locale} /><i> / {result.months.length}</i></strong>
        <small>{result.baseline.windowYears} {t("tahun referensi; minimum", "reference years; minimum")} {result.baseline.minimumValidYears}</small>
      </div>
      <div className="fire-kpi">
        <span>{t("Persentil tertinggi", "Highest percentile")}</span>
        <strong>{peak ? <CountUp value={peak.anomaly.score} locale={locale} maximumFractionDigits={1} /> : "—"}</strong>
        <small>{peak ? monthName(peak.month) : t("Belum ada bulan yang dapat dinilai", "No month could be assessed")}</small>
      </div>
    </div>
    {!hasEstimate && <p className="fire-withheld" role="note">
      {t("Estimasi setara MODIS ditahan untuk area ini; kalender menampilkan deteksi mentah satu sensor. ", "The MODIS-equivalent estimate is withheld for this area; the calendar shows raw detections of one sensor. ")}
      <small>{result.method.validationDomain}</small>
    </p>}
    <div className="research-actions" aria-label={t("Tampilan kalender", "Calendar display")}>
      {hasEstimate && <button className="outline" type="button" aria-pressed={layer === "count"} onClick={() => setLayer("count")}>{t("Jumlah deteksi", "Detection count")}</button>}
      <button className="outline" type="button" aria-pressed={layer === "raw"} onClick={() => setLayer("raw")}>{t("Deteksi mentah", "Raw detections")}</button>
      <button className="outline" type="button" aria-pressed={layer === "anomaly"} onClick={() => setLayer("anomaly")}>{t("Anomali", "Anomaly")}</button>
      {layer === "raw" && sourceIds.length > 1 && <span className="fire-source-picker" role="group" aria-label={t("Sensor", "Sensor")}>
        {sourceIds.map(id => <button key={id} type="button" className="outline" aria-pressed={activeSource === id} onClick={() => setSource(id)}>{sourceName(id)}</button>)}
      </span>}
    </div>
    <p>{layerNote}</p>
    <div className="fire-calendar-wrap" onPointerLeave={() => setFocus(null)}>
      <div className="fire-legend" aria-hidden="true">
        <span>0</span>
        <i style={{ background: `linear-gradient(90deg, ${stops})` }} />
        <span>{layer === "anomaly" ? "100" : number(maximum)}</span>
        <i className="fire-legend-unknown" /><span>{t("Tidak tersedia / belum dinilai", "Unavailable / not assessed")}</span>
      </div>
      <div className="table-scroll fire-calendar">
        <table>
          <caption>{layer === "anomaly" ? t("Kalender anomali · persentil historis. Pilih bulan untuk detail harian.", "Anomaly calendar · historical percentile. Select a month for daily detail.") : t("Kalender tahun × bulan · estimasi setara MODIS. Pilih bulan untuk detail harian.", "Year × month calendar · MODIS-equivalent estimates. Select a month for daily detail.")}</caption>
          <thead><tr><th>{t("Tahun", "Year")}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{new Date(Date.UTC(2000, i)).toLocaleString(locale, { month: "short", timeZone: "UTC" })}</th>)}</tr></thead>
          <tbody>{years.map((year, yearIndex) => <tr key={year}><th scope="row">{year}</th>{Array.from({ length: 12 }, (_, i) => {
            const key = `${year}-${String(i + 1).padStart(2, "0")}`;
            const month = result.months.find(item => item.month === key);
            const value = month ? cellValue(month) : null;
            const state = month ? layer === "anomaly" && month.anomaly.status === "assessed" && month.anomaly.scoreKind !== "percentile" ? t("Persentil tidak tersedia", "Percentile unavailable") : status(layer === "anomaly" ? month.anomaly.status : month.metric.status) : "";
            const fraction = value === null ? null : layer === "anomaly" ? value / 100 : value / maximum;
            const style = { ...calendarColors(layer === "anomaly" ? "anomaly" : "count", fraction), "--i": yearIndex + i } as CSSProperties;
            const extreme = layer === "anomaly" && value !== null ? value >= 90 ? "high" : value <= 10 ? "low" : undefined : undefined;
            return <td key={key}>{month ? <button type="button" className={fraction === null ? "outline calendar-cell is-unknown" : "outline calendar-cell"} data-extreme={extreme} data-focus={focus === key ? "true" : undefined} style={style} onClick={() => onMonth(key)} onPointerEnter={() => setFocus(key)} onFocus={() => setFocus(key)} aria-label={`${key}: ${number(value)}, ${state}`}>
              <span className="calendar-value">{number(value)}</span>
              <small>{state}{month.isPartialPeriod ? ` · ${t("parsial", "partial")}` : ""}</small>
            </button> : <span aria-label={t("Di luar periode", "Outside period")}>—</span>}</td>;
          })}</tr>)}</tbody>
        </table>
      </div>
      <div className="fire-focus" aria-live="polite" data-active={focused ? "true" : "false"}>
        {focused ? <>
          <div className="fire-focus-ring" style={{ "--p": focused.anomaly.scoreKind === "percentile" && focused.anomaly.score !== null ? focused.anomaly.score / 100 : 0 } as CSSProperties}>
            <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" /><circle className="fire-focus-arc" cx="40" cy="40" r="34" pathLength="100" /></svg>
            <b>{focused.anomaly.scoreKind === "percentile" ? number(focused.anomaly.score) : "—"}</b>
          </div>
          <div>
            <strong>{monthName(focused.month)}{focused.isPartialPeriod ? ` · ${t("parsial", "partial")}` : ""}</strong>
            <dl>
              <div><dt>{t("Estimasi", "Estimate")}</dt><dd>{number(focused.metric.harmonizedCount)}</dd></div>
              <div><dt>{t("Mentah", "Raw")}</dt><dd>{Object.entries(focused.metric.rawCountsBySource).map(([id, count]) => `${sourceName(id)} ${number(count)}`).join(" · ")}</dd></div>
              <div><dt>{t("Median referensi", "Reference median")}</dt><dd>{number(focused.anomaly.baselineValue)}</dd></div>
              <div><dt>Delta</dt><dd>{number(focused.anomaly.delta)}</dd></div>
              <div><dt>{t("Tahun referensi", "Reference years")}</dt><dd>{focused.anomaly.referenceYears.join(", ") || "—"}</dd></div>
              <div><dt>Status</dt><dd>{status(focused.anomaly.status)}</dd></div>
            </dl>
          </div>
        </> : <p>{t("Arahkan kursor atau fokus ke satu bulan untuk membaca median referensi, delta, persentil, dan tahun referensinya.", "Hover or focus a month to read its reference median, delta, percentile and reference years.")}</p>}
      </div>
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
