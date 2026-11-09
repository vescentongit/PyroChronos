# Sprint 2 (P1) — Nathan

**Fokus:** Pipeline FIRMS, agregasi, baseline, harmonisasi, dan evaluasi analitik.  
**Reviewer utama:** Bagas  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

Validasi nilai ilmiah dan operasional.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Mulai setelah Sprint 1 (P0) dan prasyarat task ini selesai. P2 tetap opsional; eksperimen dapat berakhir dengan keputusan no-go yang terdokumentasi.

Rujukan pekerjaan rekan: [Bagas](../Bagas/SPRINT-2-P1.md) — [Orkhan](../Orkhan/SPRINT-2-P1.md).

## Tahap 1 — Benchmark dan metodologi reproducible

**Tujuan integrasi tim:** ukur manfaat harmonisasi vs baseline sederhana dengan split waktu dan arsip berversi.

- [ ] **P1-S1-N1 — Benchmark held-out per wilayah.** Tetapkan periode train/test, baseline, definisi metrik, dan missingness. **Selesai bila:** laporan berisi n, coverage limit, MAE/bias, baseline comparison, dan hasil terpisah tiap wilayah.
- [ ] **P1-S1-N2 — Analisis revisi NRT→standard.** Ukur perubahan record dan dampaknya pada aktivitas/anomali/prioritas. **Selesai bila:** dampak dijelaskan; arsip final tidak dianggap tersedia pada waktu NRT.

## Tahap 2 — Validasi kandidat dan review koordinator

**Tujuan integrasi tim:** uji aturan clustering/persistensi dan kegunaan ranking dengan bukti independen serta feedback terdokumentasi.

- [ ] **P1-S2-N1 — Validasi clustering/persistensi.** Bandingkan terhadap deteksi independen atau laporan terdokumentasi; analisis false merge/split dan independensi waktu/sensor. **Selesai bila:** ukuran sampel, keterbatasan, dan kesalahan dilaporkan.
- [ ] **P1-S2-N2 — Sensitivitas ranking.** Bandingkan ambang/aturan anomali-kebaruan-persistensi tanpa tuning pada test set. **Selesai bila:** perubahan ranking tercatat pada split bebas kebocoran.

## Tahap 3 — Transfer wilayah dan keputusan status metode

**Tujuan integrasi tim:** uji generalisasi antardaerah dan tetapkan di mana harmonisasi layak dipublikasikan.

- [ ] **P1-S3-N1 — Uji transfer dua arah.** Latih satu wilayah, uji wilayah lain dan balik arah; cegah test leakage pada preprocessing/kalibrasi. **Selesai bila:** metrik, n, domain shift, dan limitasi terpisah per arah.
- [ ] **P1-S3-N2 — Rekomendasi status metode.** Tetapkan `validated`, `partial`, atau `not evaluated` berdasarkan kriteria awal. **Selesai bila:** tiap keputusan terhubung ke bukti dan perubahan threshold memicu run baru.

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
