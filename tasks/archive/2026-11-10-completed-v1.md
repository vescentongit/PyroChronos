# Bukti checklist sebelum rebaseline riset v2

Arsip status tertulis pada 10 November 2026. Checklist ini mencatat pekerjaan pada scope lama; bukan bukti bahwa seluruh scope riset v2 atau deployment sudah selesai. ID lama tidak digunakan ulang untuk task baru.

## Nathan — SPRINT-1-P0.md

**Status:** sedang dikerjakan. Tahap 1 selesai; cakupan diubah menjadi global dengan Kalteng/Papua sebagai area unggulan (keputusan tim 10 Nov 2026). Grid global MODIS dan kalender area bebas tersedia; harmonisasi berikutnya. Detail: [data FIRMS dan kalender global](../../docs/data/firms-sources.md).

- [x] **P0-S1-N1 — Katalog sumber FIRMS.** Tetapkan feed, nama produk/satelit, periode arsip, atribut, format waktu, revisi NRT→standard, dan batas API. **Selesai bila:** manifest sumber dan contoh data kedua wilayah tersedia serta berversi.
- [x] **P0-S1-N2 — Parser dan validator.** Normalisasi koordinat, waktu observasi, confidence, FRP, sensor; tangani skema berubah, baris invalid, duplikat, data terlambat, respons kosong, dan error/rate limit. **Selesai bila:** kasus valid/gagal tercakup tes dan raw row tidak hilang saat parse gagal.

## Bagas — SPRINT-1-P0.md

**Status:** belum dimulai.

- [x] **P0-S1-B1 — Model batch mentah.** Tambahkan Prisma schema/migrasi untuk sumber, versi, waktu fetch, checksum, status, dan referensi isi batch. **Selesai bila:** migrasi non-produksi lulus dan ingest ulang tidak menimpa batch historis.
- [x] **P0-S1-B2 — Service ingest aman.** Baca key FIRMS dari server environment, batasi wilayah yang diizinkan, atur timeout, validasi respons, dan sanitasi log. **Selesai bila:** key tidak pernah dikirim ke browser/log dan kegagalan API menghasilkan status terstruktur.

## Orkhan — SPRINT-1-P0.md

**Status:** sedang dikerjakan. Frontend dan kontrak draft tersedia; acceptance frontend mandiri sudah lulus. Integrasi backend nyata, geometri final, PR dan review Nathan masih terbuka.

- [x] **P0-S1-O2 — Kontrak snapshot frontend.** Definisikan type/payload untuk deteksi, provenance, timestamp, status live/stale/partial/unavailable/replay, dan nilai nullable. **Selesai bila:** payload contoh dan kontrak disetujui ketiga anggota.
- [x] **P0-S2-O2 — Visualisasi konteks dan kualitas.** Tampilkan terbaru vs baseline musiman, sensor, umur data, komponen alasan, dan status kualitas. **Selesai bila:** satuan/periode jelas; copy tidak menyebut aktivitas deteksi sebagai luas terbakar atau konfirmasi api.
- [x] **P0-S3-O2 — Lengkapi EN/ID dan UI states.** Terjemahkan error/loading/empty, peta, metode, laporan, ekspor, waktu; cek keyboard/focus/mobile. **Selesai bila:** kedua bahasa setara dan fallback peta tetap menyisakan informasi analitik.
- [x] `npm run typecheck` dan `npm run build` lulus untuk perubahan aplikasi; tes pipeline Python lulus untuk perubahan analitik.
- [x] UI diuji pada desktop/mobile dan keyboard; EN/ID serta loading/error/empty state tetap konsisten.

