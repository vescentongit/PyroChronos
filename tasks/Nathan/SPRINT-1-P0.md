# Sprint 1 (P0) — Nathan

**Fokus:** Pipeline FIRMS, agregasi, baseline, harmonisasi, dan evaluasi analitik.  
**Reviewer utama:** Bagas  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

MVP jujur dan dapat digunakan.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.


**Acuan payload yang ditetapkan Orkhan atas mandat tim:** [API v1](../../docs/contracts/api-v1.md). Schema dan contoh siap dipakai; tidak perlu menunggu penetapan draft. Polygon final serta hasil validasi ilmiah tetap terpisah.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Rujukan pekerjaan rekan: [Bagas](../Bagas/SPRINT-1-P0.md) — [Orkhan](../Orkhan/SPRINT-1-P0.md).

## Tahap 1 — Feed, wilayah, ingest, dan kontrak data

**Tujuan integrasi tim:** menyiapkan ingest FIRMS MODIS/VIIRS yang dapat ditelusuri untuk dua polygon MVP serta kontrak data yang dipakai ketiga jalur.

- [ ] **P0-S1-N1 — Katalog sumber FIRMS.** Tetapkan feed, nama produk/satelit, periode arsip, atribut, format waktu, revisi NRT→standard, dan batas API. **Selesai bila:** manifest sumber dan contoh data kedua wilayah tersedia serta berversi.
- [ ] **P0-S1-N2 — Parser dan validator.** Normalisasi koordinat, waktu observasi, confidence, FRP, sensor; tangani skema berubah, baris invalid, duplikat, data terlambat, respons kosong, dan error/rate limit. **Selesai bila:** kasus valid/gagal tercakup tes dan raw row tidak hilang saat parse gagal.

## Tahap 2 — Baseline, harmonisasi, snapshot, dan analitik dashboard

**Tujuan integrasi tim:** menghasilkan snapshot dari FIRMS nyata dan membandingkan periode terbaru dengan konteks historis sebanding.

- [ ] **P0-S2-N1 — Unit analisis dan agregasi.** Tentukan grid/unit spasial stabil, clustering kandidat, metrik aktivitas, dan aturan referensi/overlap sensor. **Selesai bila:** konfigurasi berversi, ingest ulang idempotent, dan hitungan hotspot mentah tidak disamakan antar sensor.
- [ ] **P0-S2-N2 — Baseline musiman dan evaluasi kalibrasi.** Buat baseline per wilayah; pisahkan latih/uji menurut waktu; bandingkan raw, baseline sederhana, EQM. **Selesai bila:** manifest mencatat periode, n, missingness, MAE/bias, dan calibrated output hanya terbit bila didukung held-out evaluation.
- [ ] **P0-S2-N3 — Anomali, kebaruan, persistensi.** Hitung perbandingan waktu sebanding, alasan prioritas, dan status bukti kurang. **Selesai bila:** waktu observasi menentukan kebaruan; nilai tak cukup data nullable; tiadanya deteksi tidak berarti api padam.

## Tahap 3 — Laporan koordinator, keamanan, dan rilis demo

**Tujuan integrasi tim:** tuntaskan alur kandidat→pemeriksaan→riwayat dan pastikan operasi aman saat feed/backend/peta gagal.

- [ ] **P0-S3-N1 — Aturan jendela 24 jam/7 hari.** Tetapkan batas waktu, waktu penilaian, persistensi independen, dan kategori recheck. **Selesai bila:** tes batas tidak menggandakan kategori dan waktu unduh terlambat tidak dianggap observasi baru.
- [ ] **P0-S3-N2 — Dataset replay acceptance.** Siapkan kasus live, stale, parsial, sensor hilang, revisi arsip, baseline tidak cukup. **Selesai bila:** hasil expected dapat direproduksi dan status kegagalan tetap eksplisit.

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

P0 selesai ketika acceptance checklist pada [TASKS.md](../TASKS.md#acceptance-checklist) terpenuhi dan seluruh jalur terintegrasi.
