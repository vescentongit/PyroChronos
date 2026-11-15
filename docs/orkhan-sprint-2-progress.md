# Orkhan Sprint 2 P1 — implementasi lokal tanpa login

Tanggal: 13 November 2026. Acuan: [produk](../product.md), [desain](../DESIGN.md), dan [keputusan aktif](current-status.md). O1–O4 memiliki implementasi dan acceptance sintetis; review manusia Nathan belum dilakukan.

## Perilaku yang tersedia

- **O1/O2:** kalender tahun × bulan dengan angka/status dan rampa jumlah/persentil terpisah. Klik bulan membuka detail harian dan membatasi overlay/tabel bukti ke bulan itu. Dua periode menampilkan durasi, raw per sumber, estimasi dan laju per hari. Persentase total membutuhkan dua estimasi lengkap dengan pembanding positif. Baseline aktual, delta, persentil nullable, tahun referensi dan domain metode tetap terlihat.
- **O3:** klik peta kepadatan riset memperbesar kamera; mode titik membuka bukti asli. Tabel menyediakan alternatif. Lokasi menyimpan anchor, snapshot analisis/AOI, nama pencatat lokal dan waktu. Penandaan anchor yang sama pada analisis sama tidak menggandakan lokasi. Catatan bertahan setelah refresh/pergantian hasil. Analisis lanjutan menyalin AOI ke form; pengguna memilih tanggal dan menekan Analisis area secara eksplisit.
- **O4:** penugasan lokal, status pekerjaan, beberapa pemeriksaan, dan koreksi beralasan disimpan di IndexedDB. Pemeriksa, pencatat asli, pelaku koreksi, waktu pemeriksaan/input terpisah. Koreksi menyimpan nilai sebelumnya/revisi. Penyelesaian tugas memerlukan laporan; pemeriksaan ulang membuat penugasan baru. Retry idempotent dan revision conflict mencegah penimpaan data lama.
- **Ekspor:** CSV memakai seluruh halaman tersimpan, bukan hanya titik di peta. `recordType=observation` menandai observasi; hasil tanpa titik mempunyai satu baris `metadata` berisi provenance dengan kolom observasi kosong. Agregat, JSON geometri/manifest dan PNG kalender terpisah, dengan periode/unit/model/sumber/versi. Preview sintetis diberi label dan CSV titiknya hanya sampel fixture.

## Bukti verifikasi

- Build lengkap/typecheck lulus. Suite Node: **124 kasus, 122 lulus, dua integrasi PostgreSQL native skip** karena tidak dikonfigurasi. Contract checks tujuh schema v1 dan 22 v2 lulus. Lint terkonfigurasi lulus dengan cakupan file terbatas.
- Enam tes domain baru memeriksa bukti immutable, idempotensi/konflik, transisi terminal, waktu masa depan, koreksi/audit, CSV aman/metadata kosong. Tes kontras memeriksa 1.001 posisi pada masing-masing rampa, semuanya ≥4,5:1.
- Playwright MCP, production build, context terisolasi Asia/Jakarta: heatmap zoom → titik asli, kalender/detail, penandaan, penugasan, laporan/koreksi, status terminal setelah reload, reuse AOI, empat unduhan, EN/ID, desktop 1440×1000 dan mobile 390×844. Tidak ada exception runtime atau overflow halaman mobile.
- Pemeriksaan tambahan browser dengan bundle sintetis dua halaman membuktikan ekspor menyertakan halaman kedua yang belum dimuat ke peta. Simulasi kegagalan IndexedDB.put menampilkan error, mempertahankan form, dan tidak menampilkan sukses/lokasi palsu.
- Review finish independen: **ship**; temuan kontras, metadata CSV kosong dan interaksi heatmap terselesaikan. Ini bukan review manusia Nathan.

Script: [research-sprint2-browser-check.mjs](../scripts/research-sprint2-browser-check.mjs). Jalankan melalui Playwright MCP `browser_run_code_unsafe` dengan `filename` tersebut, server production localhost:3005 dan direktori `.cache/sprint2-acceptance` yang tersedia. Screenshot, unduhan dan results.json lokal ada di direktori itu; artefak diabaikan git. Acceptance sintetis tidak membuktikan pengolahan arsip aktif pada deployment.

## Batas penerimaan

Catatan hanya ada pada browser/perangkat ini; nama tidak diverifikasi sebagai akun, sinkronisasi tim belum tersedia. API privat lama tidak dibuka ke publik. Menghapus data situs dapat menghapus catatan.

Model/domain dan kelengkapan arsip mengikuti pipeline; Kalteng/Papua tetap unsupported. Belum ada benchmark skala global atau deployment baru. Review Nathan dan demonstrasi dengan dataset aktif tetap diperlukan sebelum sprint dinyatakan selesai/direview manusia.
