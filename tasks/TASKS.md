> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../docs/current-status.md).

# PyroChronos — Task Tracker Riset v2

Acuan keputusan: [product.md](../product.md), 10 November 2026. Rincian per orang, task, dependensi, dan checklist PR: [3 sprint](SPRINT-PLAN.md). Kontrak target: [API v2](../docs/contracts/api-v2.md).

## Status yang sudah tersedia

- [x] Fondasi Next.js/TypeScript/Tailwind/Prisma/Neon, EN/ID dan Plus Jakarta Sans tersedia.
- [x] Peta satelit, endpoint hotspot NRT berbasis bbox, CSV regional, serta laporan prototype tersedia; ini belum kalender historis terharmonisasi.
- [x] Katalog/parser, raw batch, ingest, grid global bulanan dan draft calendar-1 tersedia; polygon tepat, detail harian dan baseline bergerak v2 masih perlu integrasi.
- [x] Kontrak target v2, schema runtime/JSON, contoh sintetis dan pemeriksaan kontrak tersedia. Endpoint v2 belum dianggap diimplementasikan oleh keberadaan dokumen/schema.
- [x] Checklist v1 yang sebelumnya selesai dipertahankan dalam [arsip](archive/2026-11-10-completed-v1.md), bukan dicentang ulang sebagai pekerjaan v2.
- [ ] Seluruh fitur target v2 masih harus memenuhi acceptance dan integrasi; shared coordinator token, fixture dan prototype tidak memenuhi akun individual/workspace produksi.

## P0 — Fondasi riset dan perbaikan peta

### Nathan

- [ ] **R2-P0-N1** — Arsip global yang mempertahankan tanggal dan posisi asli (5 poin). [Spesifikasi](Nathan/SPRINT-1-P0.md).
- [ ] **R2-P0-N2** — Kueri polygon bebas dan irisan waktu (8 poin). [Spesifikasi](Nathan/SPRINT-1-P0.md).
- [ ] **R2-P0-N3** — Count per sumber dan manifest analisis (4 poin). [Spesifikasi](Nathan/SPRINT-1-P0.md).
- [ ] **R2-P0-N4** — Adapter producer ke research-2 (3 poin). [Spesifikasi](Nathan/SPRINT-1-P0.md).

### Bagas

- [ ] **R2-P0-B1** — Skema workspace, akun individual, AOI dan revisi (5 poin). [Spesifikasi](Bagas/SPRINT-1-P0.md).
- [ ] **R2-P0-B2** — Pengajuan analisis dan antrean persisten (7 poin). [Spesifikasi](Bagas/SPRINT-1-P0.md).
- [ ] **R2-P0-B3** — Pembacaan hasil dan data spasial reusable (5 poin). [Spesifikasi](Bagas/SPRINT-1-P0.md).
- [ ] **R2-P0-B4** — Hak akses dan error lintas resource (3 poin). [Spesifikasi](Bagas/SPRINT-1-P0.md).

### Orkhan

Implementasi frontend P0 tersedia; 31 tes, typecheck, build dan browser acceptance mandiri lulus. Checklist akhir tetap terbuka untuk integrasi data/backend nyata, imagery live dan review. [Bukti dan batas pengujian](../docs/orkhan-sprint-1-v2-progress.md).

- [ ] **R2-P0-O1** — Satu peta dan navigasi tanpa reload analisis (7 poin). [Spesifikasi](Orkhan/SPRINT-1-P0.md).
- [ ] **R2-P0-O2** — Editor polygon penelitian (5 poin). [Spesifikasi](Orkhan/SPRINT-1-P0.md).
- [ ] **R2-P0-O3** — Rentang tanggal dan Analisis area (4 poin). [Spesifikasi](Orkhan/SPRINT-1-P0.md).
- [ ] **R2-P0-O4** — Consumer v2 dan UI state yang jujur (4 poin). [Spesifikasi](Orkhan/SPRINT-1-P0.md).


## P1 — Fitur inti versi pertama

Pembaruan 13 November 2026: jalur analisis anonim memuat model harmonisasi beserta baseline; kalender tahun × bulan dan ringkasan perbandingan/anomali tersedia. Penggunaan web tidak memerlukan OAuth atau membership. Pekerjaan kolaborasi server pada checklist lama bukan prasyarat versi lokal. O1/O2 menunggu acceptance browser/review; O3/O4 masih perlu dilanjutkan. Lihat [status aktif](../docs/current-status.md).

### Nathan

- [ ] **R2-P1-N1** — Pairing dan acuan setara MODIS (6 poin). [Spesifikasi](Nathan/SPRINT-2-P1.md).
- [ ] **R2-P1-N2** — Evaluasi count mentah, baseline, dan EQM (6 poin). [Spesifikasi](Nathan/SPRINT-2-P1.md).
- [ ] **R2-P1-N3** — Referensi bergerak 10 tahun dan periode parsial (5 poin). [Spesifikasi](Nathan/SPRINT-2-P1.md).
- [ ] **R2-P1-N4** — Kalender, detail dan perbandingan konsisten (3 poin). [Spesifikasi](Nathan/SPRINT-2-P1.md).

### Bagas

- [ ] **R2-P1-B1** — Worker nyata dan publikasi atomik (5 poin). [Spesifikasi](Bagas/SPRINT-2-P1.md).
- [ ] **R2-P1-B2** — Lokasi pemantauan persisten (4 poin). [Spesifikasi](Bagas/SPRINT-2-P1.md).
- [ ] **R2-P1-B3** — Penugasan, pemeriksaan, revision dan audit (7 poin). [Spesifikasi](Bagas/SPRINT-2-P1.md).
- [ ] **R2-P1-B4** — Ekspor CSV dan manifest yang terlindungi (4 poin). [Spesifikasi](Bagas/SPRINT-2-P1.md).

### Orkhan

- [ ] **R2-P1-O1** — Burning calendar tahun x bulan (6 poin). [Spesifikasi](Orkhan/SPRINT-2-P1.md).
- [ ] **R2-P1-O2** — Perbandingan, anomali dan metodologi (5 poin). [Spesifikasi](Orkhan/SPRINT-2-P1.md).
- [ ] **R2-P1-O3** — Detail hotspot dan daftar lokasi tim (4 poin). [Spesifikasi](Orkhan/SPRINT-2-P1.md).
- [ ] **R2-P1-O4** — UI pemeriksaan dan ekspor penelitian (5 poin). [Spesifikasi](Orkhan/SPRINT-2-P1.md).


## P2 — Penguatan dan evaluasi tambahan

### Nathan

- [ ] **R2-P2-N1** — Sensitivitas NRT versus standard (5 poin). [Spesifikasi](Nathan/SPRINT-3-P2.md).
- [ ] **R2-P2-N2** — Benchmark transfer lintas domain (6 poin). [Spesifikasi](Nathan/SPRINT-3-P2.md).
- [ ] **R2-P2-N3** — Eksperimen QA coverage terpisah (5 poin). [Spesifikasi](Nathan/SPRINT-3-P2.md).
- [ ] **R2-P2-N4** — Paket reproduksibilitas ilmiah (4 poin). [Spesifikasi](Nathan/SPRINT-3-P2.md).

### Bagas

- [ ] **R2-P2-B1** — Benchmark kapasitas dan biaya job (6 poin). [Spesifikasi](Bagas/SPRINT-3-P2.md).
- [ ] **R2-P2-B2** — Ketahanan antrean dan pemulihan (4 poin). [Spesifikasi](Bagas/SPRINT-3-P2.md).
- [ ] **R2-P2-B3** — Review isolasi dan retensi workspace (5 poin). [Spesifikasi](Bagas/SPRINT-3-P2.md).
- [ ] **R2-P2-B4** — Deployment dan observabilitas (5 poin). [Spesifikasi](Bagas/SPRINT-3-P2.md).

### Orkhan

- [ ] **R2-P2-O1** — Benchmark interaksi peta dan kalender (6 poin). [Spesifikasi](Orkhan/SPRINT-3-P2.md).
- [ ] **R2-P2-O2** — Uji tugas bersama peneliti (5 poin). [Spesifikasi](Orkhan/SPRINT-3-P2.md).
- [ ] **R2-P2-O3** — Audit aksesibilitas dan edge case (5 poin). [Spesifikasi](Orkhan/SPRINT-3-P2.md).
- [ ] **R2-P2-O4** — Acceptance riset dan demo terukur (4 poin). [Spesifikasi](Orkhan/SPRINT-3-P2.md).

## Acceptance lintas tim

- [ ] Navigasi/toggle peta tidak menjalankan ulang analisis, menghapus hasil, atau mengunduh ulang batch FIRMS identik; label wilayah dan koordinat terbaca.
- [ ] Polygon bebas, periode primer/pembanding dan Analisis area menghasilkan job/handoff nyata yang dapat dibuka ulang sesuai izin workspace.
- [ ] Kalender tahun x bulan, detail harian dan rentang tanggal bebas tersedia untuk pengajuan area global; periode belum siap memiliki status yang jujur.
- [ ] Count estimasi setara MODIS merupakan hipotesis yang diuji, bukan ground truth. Raw per sumber dan metadata validasi dapat diaudit; unit sel-hari tidak diberi nama count hotspot.
- [ ] Referensi default memakai bulan yang sama pada sepuluh tahun sebelumnya, tanpa target/tahun masa depan; no_data dan insufficient_history tidak menjadi nol/normal.
- [ ] Lokasi persisten, beberapa penugasan/pemeriksaan, hasil, revision/audit dan deteksi setelah pemeriksaan tidak hilang saat data/analisis berubah.
- [ ] Data privat tidak bocor antarworkspace melalui endpoint, ID, job, cache atau unduhan; request retry tidak menggandakan pekerjaan/laporan.
- [ ] CSV observasi asli, agregat terharmonisasi dan PNG visualisasi mengacu pada versi, geometri, periode, metode dan baseline yang sama; tidak ada titik buatan.
- [ ] EN/ID, Plus Jakarta Sans, Dashboard, keyboard/mobile, ramp aksesibel serta state antre/gagal/parsial/unsupported diuji.
- [ ] Klaim global, live, validated dan sukses simpan sesuai bukti. Tidak ada janji 48 jam, 60 FPS atau akurasi paper tanpa pengukuran.

P0 dan P1 sama-sama bagian target versi pertama. Jangan menutup scope global hanya karena demo dua wilayah berjalan. Tandai task selesai setelah PR/bukti dicantumkan dan integrasi direview; status rencana ini bukan bukti deployment atau migrasi database sudah dijalankan.
