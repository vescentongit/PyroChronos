"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ResearchAnalysisResult } from "@/lib/research-contracts";
import { listLocations, newLocation, saveLocation, type Detection, type LocalLocation, type MonitoringAction } from "@/lib/local-monitoring";

export function ResearchMonitoring({ result, observations, activeDetection, english, onReuse }: {
  result: ResearchAnalysisResult | null; observations: Detection[]; english: boolean;
  activeDetection: { id: string } | null;
  onReuse: (location: LocalLocation) => void;
}) {
  const t = (id: string, en: string) => english ? en : id;
  const [locations, setLocations] = useState<LocalLocation[]>([]);
  const [selected, setSelected] = useState<Detection | null>(null);
  const [locationId, setLocationId] = useState("");
  const [assignmentId, setAssignmentId] = useState("");
  const [correctionId, setCorrectionId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const retry = useRef({ payload: "", id: "" });
  const form = useRef<HTMLFormElement>(null);
  const location = locations.find(item => item.id === locationId);
  const assignment = location?.assignments.find(item => item.id === assignmentId);
  const correcting = assignment?.reports.find(item => item.id === correctionId);
  const localTime = (value: string) => {
    const moment = new Date(value);
    return new Date(moment.getTime() - moment.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  };
  const outcome = (value: string) => ({ fire_or_smoke_found: t("Api/asap ditemukan", "Fire/smoke found"), no_sign_at_inspection: t("Tidak ditemukan tanda api saat pemeriksaan", "No sign at inspection"), inconclusive: t("Belum dapat dipastikan", "Inconclusive") }[value] ?? value);
  const status = (value: string) => ({ assigned: t("Ditugaskan", "Assigned"), in_progress: t("Sedang diperiksa", "In progress"), completed: t("Selesai diperiksa", "Completed"), cancelled: t("Dibatalkan", "Cancelled") }[value] ?? value);
  async function reload() { setLocations(await listLocations()); }
  useEffect(() => { void reload().catch(() => setError("STORAGE_UNAVAILABLE")); const update = () => void reload().catch(() => setError("STORAGE_UNAVAILABLE")); window.addEventListener("focus", update); return () => window.removeEventListener("focus", update); }, []);
  useEffect(() => { setSelected(null); setPage(0); }, [result?.id]);
  useEffect(() => {
    if (!activeDetection) return;
    const point = observations.find(item => item.id === activeDetection.id);
    if (point) { setSelected(point); document.querySelector(".research-monitoring")?.scrollIntoView({ block: "start" }); }
  }, [activeDetection]);
  useEffect(() => { setPage(0); }, [observations.length]);
  useEffect(() => { if (correctionId) { form.current?.scrollIntoView({ block: "center" }); form.current?.querySelector("input")?.focus(); } }, [correctionId]);
  async function commit(action: MonitoringAction) {
    if (!location || busy) return;
    const payload = JSON.stringify({ location: location.id, action });
    if (retry.current.payload !== payload) retry.current = { payload, id: crypto.randomUUID() };
    setBusy(true); setError(""); setNotice("");
    try {
      await saveLocation(location, { requestId: retry.current.id, action });
      await reload(); setNotice(t("Tersimpan di browser ini.", "Saved in this browser."));
      retry.current = { payload: "", id: "" };
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "STORAGE_UNAVAILABLE");
      if (reason instanceof Error && reason.message === "REVISION_CONFLICT") await reload();
    } finally { setBusy(false); }
    return false;
  }
  async function mark(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!result || !selected || busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError(""); setNotice("");
    try {
      // Only observations loaded from the current result can become anchors.
      if (!observations.some(item => item.id === selected.id)) throw new Error("INVALID_REQUEST");
      const saved = await saveLocation(newLocation(result, selected, String(data.get("name")), String(data.get("creator"))));
      await reload(); setLocationId(saved.id); setAssignmentId(""); setSelected(null);
      setNotice(t("Lokasi disimpan dengan bukti awalnya.", "Location saved with its original evidence."));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "STORAGE_UNAVAILABLE"); }
    finally { setBusy(false); }
  }
  async function report(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!assignment) return;
    const submittedCorrection = correctionId;
    const node = event.currentTarget;
    const data = new FormData(node);
    try {
      const input = { inspector: String(data.get("inspector")), recorder: String(data.get("recorder")), observedAt: new Date(String(data.get("observedAt"))).toISOString(), outcome: String(data.get("outcome")) as "inconclusive", notes: String(data.get("notes")) };
      const ok = await commit(correctionId ? { kind: "correct", assignmentId, reportId: correctionId, report: input, reason: String(data.get("reason")) } : { kind: "report", assignmentId, report: input });
      if (ok) { node.reset(); setCorrectionId(current => current === submittedCorrection ? "" : current); }
    } catch { setError("INVALID_REQUEST"); }
  }
  const message = ({
    REVISION_CONFLICT: t("Catatan diubah pada tab lain. Data terbaru dimuat; periksa lalu kirim ulang.", "Another tab changed this record. Latest data loaded; review and submit again."),
    FUTURE_INSPECTION: t("Waktu pemeriksaan tidak boleh di masa depan.", "Inspection time cannot be in the future."),
    REPORT_REQUIRED: t("Catat hasil pemeriksaan sebelum menyelesaikan tugas.", "Record an inspection before completing the task."),
    INVALID_TRANSITION: t("Status tugas sudah berubah. Buat penugasan baru untuk pemeriksaan ulang.", "Task status changed. Create a new assignment for another inspection."),
  }[error] ?? t("Catatan tidak tersimpan. Periksa isian dan penyimpanan browser, lalu coba lagi.", "Record not saved. Check the fields and browser storage, then retry."));
  return <section className="research-monitoring" aria-label={t("Lokasi pemantauan", "Monitoring locations")}>
    <h2>{t("Lokasi pemantauan", "Monitoring locations")}</h2>
    <p>{t("Catatan disimpan di browser ini. Nama diberikan pengguna; tidak diverifikasi sebagai akun. Selesai diperiksa tidak berarti api padam.", "Records stay in this browser. Names are user supplied, not verified accounts. Completed inspection does not mean a fire is extinguished.")}</p>
    {result && <>
      <h3>{t("Bukti deteksi asli", "Original detection evidence")} · {result.mode.toUpperCase()}</h3>
      <p>{observations.length ? t("Klik peta kepadatan untuk memperbesar, lalu pilih Titik hotspot atau deteksi pada tabel untuk menandai lokasi asli. Deteksi baru tetap terlihat setelah pemeriksaan.", "Click the density map to zoom, then select Hotspot points or a table detection to mark an original location. New detections remain visible after inspections.") : t("Muat titik mentah hasil untuk memilih bukti. Cluster bukan lokasi pengamatan.", "Load result raw points to select evidence. A cluster is not an observed location.")}</p>
      <div className="table-scroll"><table><thead><tr><th>{t("Waktu UTC", "UTC time")}</th><th>{t("Sumber", "Source")}</th><th>{t("Bujur, lintang", "Longitude, latitude")}</th><th>{t("Bukti", "Evidence")}</th></tr></thead>
        <tbody>{observations.slice(page * 20, (page + 1) * 20).map(point => <tr key={point.id}><td>{point.observedAt}</td><td>{point.sourceId}</td><td>{point.coordinates.join(", ")}</td><td><button className="outline" type="button" onClick={() => { setSelected(point); setError(""); }}>{t("Lihat deteksi", "View detection")}</button></td></tr>)}</tbody>
      </table></div>
      {observations.length > 20 && <div className="research-actions"><button className="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>{t("Sebelumnya", "Previous")}</button><span>{page + 1} / {Math.ceil(observations.length / 20)}</span><button className="outline" disabled={(page + 1) * 20 >= observations.length} onClick={() => setPage(page + 1)}>{t("Berikutnya", "Next")}</button></div>}
      {selected && <form className="research-local-form" onSubmit={mark}>
        <h3>{t("Tandai lokasi", "Mark location")}</h3>
        <p>{selected.id} · {selected.observedAt} UTC · {selected.sourceId} · {selected.coordinates.join(", ")}</p>
        <p>Confidence: {selected.confidence} · FRP: {selected.frpMw ?? "—"} MW</p>
        <label>{t("Nama lokasi", "Location name")}<input name="name" required maxLength={200} /></label>
        <label>{t("Ditandai oleh (nama lokal)", "Marked by (local name)")}<input name="creator" required maxLength={200} /></label>
        <button className="primary" disabled={busy}>{t("Simpan lokasi", "Save location")}</button>
        <button className="outline" type="button" onClick={() => setSelected(null)}>{t("Batal", "Cancel")}</button>
      </form>}
    </>}
    <label>{t("Lokasi tersimpan", "Saved locations")}<select value={locationId} onChange={event => { setLocationId(event.target.value); setAssignmentId(""); setCorrectionId(""); setNotice(""); }}><option value="">{t("Pilih lokasi", "Choose location")}</option>{locations.map(item => <option key={item.id} value={item.id}>{item.initialAnalysis.mode.toUpperCase()} · {item.name}</option>)}</select></label>
    {!locations.length && <p>{t("Belum ada lokasi tersimpan.", "No saved locations yet.")}</p>}
    {location && <>
      <h3>{location.name} · {location.initialAnalysis.mode.toUpperCase()}</h3>
      <p>{location.anchor.coordinates.join(", ")} · {location.anchor.observedAt} UTC · {location.anchor.sourceId} · {location.creator}</p>
      <p>{t("Analisis awal", "Initial analysis")}: {location.initialAnalysis.primary.period.start} → {location.initialAnalysis.primary.period.end} · {location.initialAnalysis.area.name} · {location.initialAnalysis.id}</p>
      <button className="outline" type="button" onClick={() => onReuse(location)}>{t("Gunakan area untuk analisis berikutnya", "Use area for follow-up analysis")}</button>
      <form className="research-local-form" onSubmit={async event => { event.preventDefault(); const node = event.currentTarget; const data = new FormData(node); if (await commit({ kind: "assign", assignee: String(data.get("assignee")), recorder: String(data.get("recorder")) })) node.reset(); }}>
        <h3>{t("Penugasan pemeriksaan lokal", "Local inspection assignment")}</h3>
        <label>{t("Penanggung jawab", "Assignee")}<input name="assignee" required maxLength={200} /></label>
        <label>{t("Pencatat penugasan", "Assignment recorder")}<input name="recorder" required maxLength={200} /></label>
        <button className="primary" disabled={busy}>{t("Buat penugasan", "Create assignment")}</button>
      </form>
      <label>{t("Pilih penugasan", "Choose assignment")}<select value={assignmentId} onChange={event => { setAssignmentId(event.target.value); setCorrectionId(""); }}><option value="">{t("Pilih penugasan", "Choose assignment")}</option>{location.assignments.map(item => <option key={item.id} value={item.id}>{item.assignee} · {status(item.status)} · {item.createdAt}</option>)}</select></label>
      {assignment && <>
        <p>{status(assignment.status)} · {assignment.recorder} · {assignment.createdAt} UTC</p>
        {!["completed", "cancelled"].includes(assignment.status) && <form className="research-local-form" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); await commit({ kind: "status", assignmentId, status: String(data.get("status")) as "completed", actor: String(data.get("actor")) }); }}>
          <label>{t("Status pekerjaan", "Task status")}<select name="status">{assignment.status === "assigned" && <option value="in_progress">{status("in_progress")}</option>}<option value="completed">{status("completed")}</option><option value="cancelled">{status("cancelled")}</option></select></label>
          <label>{t("Diubah oleh", "Changed by")}<input name="actor" required maxLength={200} /></label><button className="outline" disabled={busy}>{t("Perbarui status", "Update status")}</button>
        </form>}
        {(!["completed", "cancelled"].includes(assignment.status) || correctionId) && <form className="research-local-form" ref={form} onSubmit={report} key={`${assignmentId}:${correctionId}`}>
          <h3>{correctionId ? t("Koreksi laporan", "Correct report") : t("Catat pemeriksaan", "Record inspection")}</h3>
          <label>{t("Pemeriksa", "Inspector")}<input name="inspector" required maxLength={200} defaultValue={assignment.reports.find(r => r.id === correctionId)?.inspector ?? assignment.assignee} /></label>
          <label>{t("Pencatat", "Recorder")}<input name="recorder" required maxLength={200} /></label>
          <label>{t("Waktu pemeriksaan (waktu lokal)", "Inspection time (local time)")}<input name="observedAt" type="datetime-local" required defaultValue={correcting ? localTime(correcting.observedAt) : ""} /></label>
          <label>{t("Hasil pemeriksaan", "Inspection outcome")}<select name="outcome" defaultValue={correcting?.outcome ?? "inconclusive"}>{["inconclusive", "fire_or_smoke_found", "no_sign_at_inspection"].map(value => <option key={value} value={value}>{outcome(value)}</option>)}</select></label>
          <label>{t("Catatan", "Notes")}<textarea name="notes" maxLength={2000} defaultValue={correcting?.notes ?? ""} /></label>
          {correctionId && <label>{t("Alasan koreksi", "Correction reason")}<input name="reason" required maxLength={200} /></label>}
          <button className="primary" disabled={busy}>{t("Simpan pemeriksaan", "Save inspection")}</button>
          {correctionId && <button type="button" className="outline" onClick={() => setCorrectionId("")}>{t("Batal koreksi", "Cancel correction")}</button>}
        </form>}
        <ul>{assignment.reports.map(item => <li key={item.id}>
          <p>{outcome(item.outcome)} · {item.observedAt} UTC · {t("Pemeriksa", "Inspector")}: {item.inspector} · {t("Pencatat", "Recorder")}: {item.recorder} · {t("Input", "Recorded")}: {item.createdAt} UTC · r{item.revision}</p><p>{item.notes}</p>
          <button type="button" className="outline" disabled={busy} onClick={() => setCorrectionId(item.id)}>{t("Koreksi laporan", "Correct report")}</button>
          <details><summary>{t("Riwayat koreksi", "Correction history")} ({item.corrections.length})</summary>{item.corrections.map(old => <p key={old.revision}>r{old.revision} · {old.correctedAt} · {old.reason} · {old.correctedBy} · {old.previous.inspector} / {old.previous.recorder} · {old.previous.observedAt} · {outcome(old.previous.outcome)} · {old.previous.notes}</p>)}</details>
        </li>)}</ul>
        <details><summary>{t("Riwayat status", "Status history")}</summary>{assignment.history.map((entry, index) => <p key={index}>{status(entry.from)} → {status(entry.to)} · {entry.actor} · {entry.at} UTC</p>)}</details>
      </>}
    </>}
    {error && <p role="alert">{message}</p>}
    <p role="status" aria-live="polite">{busy ? t("Menyimpan…", "Saving…") : notice}</p>
  </section>;
}
