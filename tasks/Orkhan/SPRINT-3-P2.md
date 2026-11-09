# Sprint 3 (P2) — Orkhan

**Fokus:** Peta, grafik, kandidat, laporan, ekspor, dan integrasi antarmuka.  
**Reviewer utama:** Nathan  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

Riset opsional dan perluasan.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Mulai setelah Sprint 2 (P1) dan prasyarat task ini selesai. P2 tetap opsional; eksperimen dapat berakhir dengan keputusan no-go yang terdokumentasi.

Rujukan pekerjaan rekan: [Nathan](../Nathan/SPRINT-3-P2.md) — [Bagas](../Bagas/SPRINT-3-P2.md).

## Tahap 1 — Raster FireMask/QA (jika memang diperlukan)

**Tujuan integrasi tim:** nilai apakah QA raster memberi denominator cakupan observasi yang tidak disediakan katalog hotspot FIRMS.

- [ ] **P2-S1-O1 — Prototipe coverage UI.** Tampilkan valid/unknown tanpa menyamakan “tidak teramati” dengan “tidak ada api”. **Selesai bila:** denominator tidak valid menghasilkan unavailable, bukan persentase palsu.
- [ ] **P2-S1-O2 — Pisahkan lapisan bukti.** Buat tampilan opsional yang membedakan titik FIRMS dan coverage raster. **Selesai bila:** pengguna memahami produk/periode kedua lapisan berbeda.

## Tahap 2 — Konteks lingkungan dan gerbang ML

**Tujuan integrasi tim:** pilih eksperimen kontekstual yang layak; jangan memasukkan PyTorch/Hugging Face tanpa task, label, baseline, dan manfaat terukur.

- [ ] **P2-S2-O1 — Panel konteks lingkungan.** Bedakan indikasi kontekstual dari deteksi/harmonisasi. **Selesai bila:** sumber, waktu, resolusi, dan batas interpretasi terlihat dalam EN/ID.
- [ ] **P2-S2-O2 — Prototipe pembanding riset ML.** Tampilkan baseline vs eksperimen di lingkungan riset saja. **Selesai bila:** metrik dan n terlihat, output tidak masuk ranking produksi tanpa gate.

## Tahap 3 — Wilayah/periode baru dan riset workflow lanjutan

**Tujuan integrasi tim:** perluas cakupan hanya setelah dua wilayah stabil; validasi kebutuhan sebelum membuat fitur lapangan opsional.

- [ ] **P2-S3-O1 — Perluas pemilih wilayah.** Tambahkan hanya area yang lolos readiness dengan ID/boundary version stabil. **Selesai bila:** data wilayah tidak tercampur dan baseline/coverage terlihat.
- [ ] **P2-S3-O2 — Prototipe satu alur lanjutan.** Pilih kebutuhan paling kuat dari riset Bagas dan buat UI prototype. **Selesai bila:** diuji dengan pengguna sasaran dan hasil dicatat sebelum masuk backlog implementasi.

## Checklist sebelum membuat PR

- [ ] PR menautkan ID task sprint, menyebut satu tujuan, dan mencantumkan acceptance criteria yang dipenuhi.
- [ ] Perubahan fokus pada scope task; tidak ada fixture/angka demo yang tersaji sebagai hasil operasional.
- [ ] Untuk data: sumber, versi, waktu observasi/ingest/publish, satuan, konfigurasi, dan provenance dapat ditelusuri.
- [ ] Nilai yang tidak diketahui/tidak cukup bukti menjadi `null` atau status eksplisit; tidak diubah menjadi nol atau “tidak ada api”.
- [ ] Jalur gagal relevan (kosong, parsial, stale, duplikat, timeout, akses ditolak) ditangani dan diuji.
- [ ] Tes unit/integrasi/UI terkait diperbarui dan dijalankan; hasil aktual dicantumkan pada PR.
- [ ] `npm run typecheck` dan `npm run build` lulus untuk perubahan aplikasi; tes pipeline Python lulus untuk perubahan analitik.
- [ ] Migrasi Prisma konsisten bila ada perubahan schema; jangan menerapkan migrasi produksi langsung dari PR.
- [ ] Endpoint memeriksa izin di server dan tidak membocorkan token, rahasia, atau stack trace.
- [ ] UI diuji pada desktop/mobile dan keyboard; EN/ID serta loading/error/empty state tetap konsisten.
- [ ] Satu anggota lain melakukan review; risiko, batasan, dan cara verifikasi terdokumentasi.

## Syarat sprint selesai

- [ ] Seluruh task pribadi selesai atau memiliki keputusan no-go yang diperbolehkan spesifikasi task.
- [ ] Keluaran sudah terintegrasi dengan pekerjaan dua anggota lain dan direview.
- [ ] Bukti verifikasi serta blocker dicatat di PR dan status diperbarui pada task tracker.

Setiap perluasan memiliki keputusan go/no-go, bukti kualitas/kebutuhan, dan estimasi biaya. Pekerjaan opsional tidak menunda P0.
