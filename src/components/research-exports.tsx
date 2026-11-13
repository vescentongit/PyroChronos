"use client";
import { useState } from "react";
import type { ResearchAnalysisResult } from "@/lib/research-contracts";
import { getBundle } from "@/lib/local-research-client";
import { rawResearchCsv, aggregateResearchCsv, calendarPng, downloadResearch } from "@/lib/research-export";
import type { Detection } from "@/lib/local-monitoring";

export function ResearchExports({ result, english, demoPoints }: { result: ResearchAnalysisResult; english: boolean; demoPoints?: Detection[] }) {
  const t = (id: string, en: string) => english ? en : id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [role, setRole] = useState<"primary" | "comparison">("primary");
  async function download(kind: "raw" | "aggregate" | "json" | "png") {
    setBusy(true); setError(false);
    try {
      const name = `pyrochronos-${result.mode}-${result.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      let blob: Blob;
      if (kind === "png") blob = await calendarPng(result, english);
      else if (kind === "aggregate") blob = new Blob([aggregateResearchCsv(result)], { type: "text/csv;charset=utf-8" });
      else {
        const bundle = demoPoints ? null : await getBundle(result.id);
        if (kind === "json") blob = new Blob([JSON.stringify({ result, manifest: bundle?.manifest ?? { synthetic: true, sampleOnly: true } }, null, 2)], { type: "application/json" });
        else {
          if (demoPoints && role !== "primary") throw new Error("UNAVAILABLE");
          const points = demoPoints ?? bundle!.detections.filter(page => page.periodRole === role).flatMap(page => page.observations);
          blob = new Blob([rawResearchCsv(result, points, role)], { type: "text/csv;charset=utf-8" });
        }
      }
      downloadResearch(blob, `${name}-${kind}${kind === "raw" ? `-${role}${demoPoints ? "-sample" : ""}` : ""}.${kind === "png" ? "png" : kind === "json" ? "json" : "csv"}`);
    } catch { setError(true); }
    finally { setBusy(false); }
  }
  return <section aria-label={t("Ekspor penelitian", "Research exports")}>
    <h3>{t("Ekspor penelitian", "Research exports")}</h3>
    <p>{t("CSV deteksi asli dan agregat estimasi dipisahkan. JSON menyertakan geometri, sumber dan manifest. PNG mengikuti kalender hasil ini.", "Original-detection and estimated-aggregate CSVs are separate. JSON includes geometry, sources and manifest. PNG follows this result calendar.")}</p>
    <p>{t("CSV deteksi memakai recordType=observation. Jika tidak ada deteksi, satu baris metadata menyimpan konteks analisis dengan kolom observasi kosong.", "Detection CSV uses recordType=observation. With no detections, one metadata row retains analysis context with empty observation fields.")}</p>
    {demoPoints && <p>{t("Ekspor contoh sintetis: CSV titik hanya sampel fixture, bukan seluruh area.", "Synthetic example export: point CSV contains only the fixture sample, not the full area.")}</p>}
    <label>{t("Periode CSV deteksi", "Detection CSV period")}<select value={role} onChange={event => setRole(event.target.value as typeof role)}><option value="primary">{t("Utama", "Primary")}</option>{result.comparison && !demoPoints && <option value="comparison">{t("Pembanding", "Comparison")}</option>}</select></label>
    <div className="research-actions">{(["raw", "aggregate", "json", "png"] as const).map(kind => <button type="button" className="outline" key={kind} disabled={busy} onClick={() => void download(kind)}>{({ raw: t("CSV deteksi asli", "Original detections CSV"), aggregate: t("CSV agregat", "Aggregate CSV"), json: "JSON + manifest", png: t("PNG kalender", "Calendar PNG") })[kind]}</button>)}</div>
    {busy && <p role="status">{t("Menyiapkan unduhan…", "Preparing download…")}</p>}
    {error && <p role="alert">{t("Ekspor gagal. Hasil tersimpan tetap tersedia; coba kembali.", "Export failed. Saved results remain available; retry.")}</p>}
  </section>;
}
