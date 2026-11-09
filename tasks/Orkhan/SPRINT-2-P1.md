# Sprint 2 (P1) — Orkhan

**Fokus:** Peta, grafik, kandidat, laporan, ekspor, dan integrasi antarmuka.  
**Reviewer utama:** Nathan  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

Validasi nilai ilmiah dan operasional.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Mulai setelah Sprint 1 (P0) dan prasyarat task ini selesai. P2 tetap opsional; eksperimen dapat berakhir dengan keputusan no-go yang terdokumentasi.

Rujukan pekerjaan rekan: [Nathan](../Nathan/SPRINT-2-P1.md) — [Bagas](../Bagas/SPRINT-2-P1.md).

## Tahap 1 — Benchmark dan metodologi reproducible

**Tujuan integrasi tim:** ukur manfaat harmonisasi vs baseline sederhana dengan split waktu dan arsip berversi.

- [ ] **P1-S1-O1 — Panel metodologi.** Tampilkan unit, definisi metrik, model/sumber, baseline, batas data, dan alasan score unavailable. **Selesai bila:** provenance mudah ditemukan dalam EN/ID.
- [ ] **P1-S1-O2 — Tampilan raw/baseline/calibrated.** Sajikan pembanding hasil uji dengan satuan, periode, dan jumlah sampel. **Selesai bila:** hasil simulasi/yang belum diuji tidak ditampilkan sebagai peningkatan terverifikasi.

## Tahap 2 — Validasi kandidat dan review koordinator

**Tujuan integrasi tim:** uji aturan clustering/persistensi dan kegunaan ranking dengan bukti independen serta feedback terdokumentasi.

- [ ] **P1-S2-O1 — Fasilitasi review kegunaan.** Jalankan tugas review kandidat, alasan, batasan, dan ekspor; catat temuan dengan persetujuan. **Selesai bila:** temuan ditulis terpisah dari asumsi desain.
- [ ] **P1-S2-O2 — Perbaiki penjelasan kandidat.** Tampilkan alasan, ketidakpastian, dan respons reviewer. **Selesai bila:** reviewer dapat menerangkan mengapa lokasi muncul dan apa yang tidak disimpulkan sistem.

## Tahap 3 — Transfer wilayah dan keputusan status metode

**Tujuan integrasi tim:** uji generalisasi antardaerah dan tetapkan di mana harmonisasi layak dipublikasikan.

- [ ] **P1-S3-O1 — Tampilan transfer lintas wilayah.** Tampilkan hasil per wilayah dan batas generalisasi. **Selesai bila:** hasil buruk di satu wilayah tidak tersembunyi dalam angka gabungan.
- [ ] **P1-S3-O2 — Materi demo berbasis hasil.** Hubungkan klaim presentasi ke run benchmark. **Selesai bila:** klaim kuantitatif memiliki sumber/periode/limitasi dan klaim tanpa bukti diberi label belum diuji.

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

Metode aktif hanya untuk kombinasi wilayah/periode yang lolos evaluasi; lainnya memakai hasil mentah dan status keterbatasan.
