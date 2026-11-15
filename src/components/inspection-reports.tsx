"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Check, ClipboardList, X } from "lucide-react";
import type { Language, StudyRegion } from "@/lib/regions";
import type { DataMode, SnapshotCandidate } from "@/lib/snapshot";

const outcomes = [
  "Api/asap ditemukan",
  "Tidak ditemukan tanda api saat pemeriksaan",
  "Belum dapat dipastikan",
] as const;
const englishOutcomes = [
  "Fire/smoke found",
  "No signs of fire during inspection",
  "Inconclusive",
];
const reportSchema = z.object({
  id: z.string(),
  candidateId: z.string(),
  name: z.string().optional(),
  regionId: z.string().optional(),
  observedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  createdAt: z.string().datetime({ offset: true }),
  result: z.enum(outcomes),
  notes: z.string().max(2000),
  corrections: z
    .array(
      z.object({
        observedAt: z.string(),
        result: z.enum(outcomes),
        notes: z.string(),
        correctedAt: z.string(),
      }),
    )
    .optional(),
});
type Report = z.infer<typeof reportSchema>;

export function InspectionReports({
  language,
  mode,
  region,
  candidates,
  active,
  showHistory,
  request,
  onRequest,
}: {
  language: Language;
  mode: DataMode;
  region: StudyRegion;
  candidates: SnapshotCandidate[];
  active?: SnapshotCandidate;
  showHistory: boolean;
  request: number;
  onRequest: () => void;
}) {
  const currentLanguage = useRef(language);
  currentLanguage.current = language;
  const t = (id: string, en: string) =>
    currentLanguage.current === "id" ? id : en;
  const date = (value: string) =>
    `${new Date(value).toLocaleString(language === "id" ? "id-ID" : "en-GB", { timeZone: "UTC" })} UTC`;
  const [state, setState] = useState<{ mode: DataMode; reports: Report[] }>({
    mode: "demo",
    reports: [],
  });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Report | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastRequest = useRef(request);
  const draftId = useRef<string | null>(null);
  const contextRef = useRef("");
  contextRef.current = `${mode}:${region.id}`;
  const reports =
    state.mode === mode
      ? state.reports.filter(
          (report) =>
            report.regionId === region.id ||
            (!report.regionId &&
              (report.candidateId.startsWith(
                region.id === "kalteng" ? "kt-" : "pp-",
              ) ||
                candidates.some((item) => item.id === report.candidateId))),
        )
      : [];

  useEffect(() => {
    setOpen(false);
    setEditing(null);
    setNotice("");
      try {
        setState({
          mode,
          reports: z
            .array(reportSchema)
            .parse(JSON.parse(localStorage.getItem(mode === "demo" ? "pyro-reports" : "pyro-reports-operational") || "[]")),
        });
      } catch {
        setState({ mode, reports: [] });
        setNotice(
          t(
            "Laporan lokal tidak dapat dibaca. Data lama tidak ditimpa.",
            "Local reports could not be read. Existing data has not been overwritten.",
          ),
        );
      }
    // Changing language should not close an inspection form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    setOpen(false);
    setEditing(null);
    setNotice("");
  }, [region.id]);
  useEffect(() => {
    if (request !== lastRequest.current) {
      lastRequest.current = request;
      if (active) {
        draftId.current = crypto.randomUUID();
        setEditing(null);
        setOpen(true);
      }
    }
  }, [request, active]);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open) node.close();
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    const data = new FormData(event.currentTarget);
    const observed = new Date(String(data.get("time")));
    if (
      !Number.isFinite(observed.getTime()) ||
      observed.getTime() > Date.now()
    ) {
      setNotice(
        t(
          "Waktu pemeriksaan tidak valid atau di masa depan.",
          "Inspection time is invalid or in the future.",
        ),
      );
      return;
    }
    if (!active && !editing) return;
    const context = contextRef.current;
    const observedAt = observed.toISOString();
    const createdAt = new Date().toISOString();
    const parsed = reportSchema.safeParse({
      id: editing?.id || draftId.current || crypto.randomUUID(),
      candidateId: editing?.candidateId || active!.id,
      name: editing?.name || active?.name,
      regionId: region.id,
      observedAt,
      createdAt: editing?.createdAt || createdAt,
      result: data.get("result"),
      notes: String(data.get("notes")),
      corrections: editing
        ? [
            ...(editing.corrections || []),
            {
              observedAt: editing.observedAt,
              result: editing.result,
              notes: editing.notes,
              correctedAt: createdAt,
            },
          ]
        : [],
    });
    if (!parsed.success) {
      setNotice(t("Isian laporan tidak valid.", "Report fields are invalid."));
      return;
    }
    const report = parsed.data;
    setBusy(true);
    try {
      {
        // Read/validate again before writing to preserve other regions and prior reports.
        const stored = z
          .array(reportSchema)
          .parse(JSON.parse(localStorage.getItem(mode === "demo" ? "pyro-reports" : "pyro-reports-operational") || "[]"));
        if (editing && !stored.some((item) => item.id === editing.id))
          throw new Error("Report changed in another tab");
        const next = editing
          ? stored.map((item) => (item.id === report.id ? report : item))
          : [report, ...stored];
        localStorage.setItem(mode === "demo" ? "pyro-reports" : "pyro-reports-operational", JSON.stringify(next));
        setState({ mode, reports: next });
      }
      if (contextRef.current === context) {
        setOpen(false);
        setEditing(null);
        setNotice(t("Laporan tersimpan.", "Report saved."));
      }
    } catch {
      if (contextRef.current === context)
        setNotice(
          t(
            "Laporan belum tersimpan. Periksa penyimpanan browser, lalu coba kembali.",
            "Report was not saved. Check browser storage and retry.",
          ),
        );
    } finally {
      setBusy(false);
    }
  }

  const localTime = (value: string) => {
    const time = new Date(value);
    return new Date(time.getTime() - time.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  return (
    <>
      {showHistory && (
        <section className="reports">
          <div className="section-heading">
            <div>
              <h2>{t("Riwayat pemeriksaan", "Inspection history")}</h2>
              <p>
                {mode === "demo"
                  ? t(
                      "Laporan demo tersimpan di browser ini.",
                      "Demo reports are stored in this browser.",
                    )
                  : t(
                      "Laporan disimpan hanya di browser ini.",
                      "Reports are stored only in this browser.",
                    )}
              </p>
            </div>
            <button
              className="primary"
              disabled={!active || busy}
              onClick={onRequest}
            >
              <ClipboardList size={16} />
              {t("Catat pemeriksaan", "Record inspection")}
            </button>
          </div>
          {!reports.length && (
            <div className="empty">
              <ClipboardList size={32} />
              <h3>
                {t(
                  "Belum ada laporan wilayah ini",
                  "No reports for this region",
                )}
              </h3>
              <p>
                {t(
                  "Pilih kandidat untuk mencatat pemeriksaan; lokasi tanpa kandidat tidak dapat dilaporkan melalui formulir ini.",
                  "Select a candidate to record an inspection. This form needs a candidate reference.",
                )}
              </p>
            </div>
          )}
          {reports.map((report) => {
            const point = candidates.find(
              (item) => item.id === report.candidateId,
            );
            return (
              <article className="report-row" key={report.id}>
                <span className="report-icon">
                  <Check size={20} />
                </span>
                <div>
                  <h3>{report.name || point?.name || report.candidateId}</h3>
                  <p>
                    {language === "id"
                      ? report.result
                      : englishOutcomes[outcomes.indexOf(report.result)]}
                  </p>
                  <small>
                    {t("Diperiksa", "Inspected")}: {date(report.observedAt)} ·{" "}
                    {t("Dicatat", "Entered")}: {date(report.createdAt)}
                  </small>
                  <p>{report.notes}</p>
                  {point &&
                    Date.parse(point.observedAt) >
                      Date.parse(report.observedAt) && (
                      <p className="badge high">
                        {t(
                          "Ada deteksi setelah pemeriksaan",
                          "Detection after inspection",
                        )}
                      </p>
                    )}
                  {!!report.corrections?.length && (
                    <details>
                      <summary>
                        {t("Riwayat koreksi", "Correction history")} (
                        {report.corrections.length})
                      </summary>
                      {report.corrections.map((item, index) => (
                        <p key={index}>
                          {date(item.correctedAt)} —{" "}
                          {t("Nilai sebelumnya", "Previous values")}:{" "}
                          {date(item.observedAt)} ·{" "}
                          {language === "id"
                            ? item.result
                            : englishOutcomes[
                                outcomes.indexOf(item.result)
                              ]}{" "}
                          · {item.notes}
                        </p>
                      ))}
                    </details>
                  )}
                  <button
                    className="outline"
                    disabled={busy}
                    onClick={() => {
                      setEditing(report);
                      setOpen(true);
                    }}
                  >
                    {t("Koreksi", "Correct")}
                  </button>
                </div>
                <span className="badge">
                  {mode === "demo"
                    ? t("Laporan demo", "Demo report")
                    : t("Tersimpan di browser", "Saved in browser")}
                </span>
              </article>
            );
          })}
        </section>
      )}
      {notice && !open && (
        <div className="toast" role="status">
          {notice}
          <button
            aria-label={t("Tutup pemberitahuan", "Dismiss notification")}
            onClick={() => setNotice("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="modal inspection-dialog"
        aria-labelledby="inspection-title"
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setOpen(false);
        }}
      >
        <button
          className="close"
          disabled={busy}
          aria-label={t("Tutup formulir", "Close form")}
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <h2 id="inspection-title">
          {editing
            ? t("Koreksi laporan", "Correct report")
            : t("Catat pemeriksaan", "Record inspection")}
        </h2>
        <p>{editing?.name || active?.name}</p>
        <div className="form-note">
          {mode === "demo"
            ? t(
                "Mode demo: hanya disimpan di browser. Jangan masukkan data pribadi.",
                "Demo: stored only in this browser. Do not enter personal information.",
              )
            : t(
                "Tersimpan hanya di browser ini. Pemeriksaan tidak memastikan api sudah padam.",
                "Stored only in this browser. An inspection does not confirm the fire is extinguished.",
              )}
        </div>
        {notice && <p role="alert">{notice}</p>}
        <form key={editing?.id || `new-${request}`} onSubmit={save}>
          <label>
            {t(
              "Waktu pemeriksaan (zona waktu perangkat)",
              "Inspection time (device timezone)",
            )}
            <input
              name="time"
              type="datetime-local"
              required
              max={open ? localTime(new Date().toISOString()) : undefined}
              defaultValue={editing ? localTime(editing.observedAt) : undefined}
            />
          </label>
          <label>
            {t("Hasil pemeriksaan", "Inspection result")}
            <select name="result" required defaultValue={editing?.result || ""}>
              <option value="" disabled>
                {t("Pilih hasil pemeriksaan", "Select inspection result")}
              </option>
              {outcomes.map((value, index) => (
                <option value={value} key={value}>
                  {language === "id" ? value : englishOutcomes[index]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Catatan tim", "Team notes")}
            <textarea
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={editing?.notes}
            />
          </label>
          <p className="small">
            {t(
              "Sudah diperiksa tidak berarti lokasi selamanya aman. Waktu input bukan waktu pemeriksaan.",
              "An inspection does not mean the location stays safe. Entry time differs from inspection time.",
            )}
          </p>
          <button
            className="primary"
            disabled={busy}
          >
            {busy
              ? t("Menyimpan…", "Saving…")
              : t("Simpan laporan", "Save report")}
          </button>
        </form>
      </dialog>
    </>
  );
}
