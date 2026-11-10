# Orkhan — Sprint 1 P0 riset v2

Tanggal: 10 November 2026. Scope: R2-P0-O1 sampai R2-P0-O4. Implementasi frontend tersedia; penerimaan integrasi nyata dan review Nathan masih terbuka.

## Perubahan yang dapat dicoba

1. Buka `/simulation` → **Peta aktivitas**. Activity Map dan Global Heatmap sekarang memakai satu workspace. Kembali dari Dashboard mempertahankan instance peta dan pilihan.
2. **FIRMS terbaru · mentah**: navigasi dahulu, kemudian klik **Muat area tampilan**. Pan, zoom, perubahan sensor/periode, dan toggle heatmap/titik tidak otomatis mengambil data. Cache yang masih segar dipakai ulang. Overlay lama menampilkan sensor, bbox, periode dan timestamp asalnya selama permintaan berikutnya atau saat gagal.
3. **Riset historis**: klik **Gambar / edit polygon**, tambah titik pada peta, kemudian **Terapkan polygon**. Editor koordinat menyediakan alternatif keyboard: satu `bujur, lintang` per baris, tanpa mengulang titik pertama. Undo dan batal edit tersedia. Polygon yang diterapkan adalah draft; outline putih menandai area hasil yang sudah diterbitkan.
4. Pilih rentang tanggal inklusif UTC sejak 2000, pembanding opsional dan referensi default 10 tahun sebelumnya. Hanya **Analisis area** membuat area/job server. Identitas retry dipertahankan untuk payload yang sama; perubahan pilihan menghentikan pemantauan respons lama.
5. **Lihat contoh sintetis** membuka contoh tetap dari kontrak, bukan komputasi atas polygon/tanggal pilihan. Ringkasan bulanan, detail harian dan titik mentah mempunyai label demo. Ini fondasi consumer, bukan kalender tahun × bulan P1 yang sudah selesai.

Navigasi nama menggunakan preset Dunia, Indonesia, Kalimantan, Papua, Afrika, Amazon dan Australia. Navigasi bebas tersedia melalui batas koordinat. Pencarian geocoding nama arbitrer belum ditambahkan.

## Implementasi

- `src/components/global-heatmap.tsx`: kamera terpisah dari query yang diajukan; lapisan reusable, drawing, outline hasil/draft, cache NRT, fallback dan error tile.
- `src/components/dashboard-workspace.tsx`: satu entry peta; peta lama di Dashboard menjadi tautan ke workspace yang sama.
- `src/lib/map-style.ts`: citra satelit dan raster label Esri; zoom peta sampai 19. Ketersediaan/detail tetap mengikuti sumber. Ramp heatmap berurutan ungu–biru–hijau–kuning dan label angka/status membantu pembacaan tanpa mengandalkan warna.
- `src/lib/research-geometry.ts`: validasi koordinat, vertex unik, luas nonnol, persilangan/sentuhan sisi; polygon melewati antimeridian dibuka pada koordinat tampilan tanpa mengubah payload. Editor menerima satu ring dengan 3–500 vertex. Area yang membentang 180° bujur atau lebih ditolak dengan pesan eksplisit. Server tetap wajib memvalidasi geometri/kapasitas.
- `src/lib/research-client.ts`: validasi schema `research-2`, identitas workspace/area/job/periode, timeout, cancellation, polling dengan backoff dan Retry-After pada rate limit, detail harian dan halaman titik mentah.
- `src/components/research-panel.tsx`: EN/ID, tanggal/perbandingan, draft/revisi lokal, form pengajuan, status job, contoh sintetis serta skeleton/ringkasan hasil.
- `src/lib/fixtures/research-demo.json`: salinan terbatas contoh sintetis kontrak. Tidak digunakan sebagai fallback otomatis untuk analisis nyata.

Status UI mencakup queued, running, failed, partial, no_data dan method_unsupported. Nilai `null` ditampilkan sebagai `—`. Deteksi mentah dan estimasi setara MODIS memiliki kolom berbeda; tidak disebut jumlah kebakaran atau luas terbakar.

## Bukti verifikasi

- `npm run typecheck`: lulus.
- `npm run build`: lulus; tidak menambah endpoint v2 atau migrasi database.
- `npm run check:contracts`: 7 schema v1 dan 22 schema v2 lulus.
- `node --test tests/research-client.test.mjs tests/research-contracts.test.mjs scripts/frontend-checks.mjs scripts/hotspots-checks.mjs`: **31 tes lulus**.
- Chrome lokal, build produksi: **browser acceptance lulus**, desktop 1440px dan mobile 390px. Script: `scripts/research-browser-check.mjs`.
- Browser memeriksa tidak ada request NRT otomatis; permintaan ulang identik memakai cache; pan/zoom tetap mempertahankan hasil; instance canvas tetap sama saat toggle dan navigasi Dashboard; polygon non-persegi via keyboard; penambahan vertex via pointer dan batal; tidak ada write sebelum tombol analisis; retry memakai ID sama; queued/running/succeeded; respons usang tidak mengganti hasil; consumer detail/titik; EN/ID; font; fokus keyboard; tidak ada overflow halaman mobile atau exception runtime.
- Endpoint v2 pada pengujian desktop **di-mock dengan respons sintetis**. Mobile memeriksa kondisi endpoint v2 nyata yang belum tersedia. NRT pada pengujian cache/pan juga sintetis, sehingga bukan bukti akses FIRMS upstream.
- Artefak lokal: `.cache/research-sprint-1/results.json`, `desktop-id.png`, `desktop-en.png`, `mobile-en.png`. Screenshot penuh dapat menempatkan sidebar fixed sesuai posisi scroll saat pengambilan.

Untuk mengulang browser acceptance: jalankan build pada port 3002 dan Chrome lokal dengan remote debugging port 9237, lalu `node scripts/research-browser-check.mjs`. Gunakan profil browser pengujian terpisah. Script memasang mock hanya dalam tab pengujian, tidak mengubah aplikasi/server.

## Yang masih terbuka

| Penerimaan | Pemilik / kebutuhan |
| --- | --- |
| Sesi individual, workspace/membership dan area persisten | Bagas R2-P0-B1/B4. UI hanya memakai workspace dari list yang lolos kontrak; tidak mengarang workspace produksi. |
| Submit job, idempotensi server dan antrean persisten | Bagas R2-P0-B2. Client saja tidak menjamin deduplikasi server. |
| Hasil, daily detail dan pagination titik nyata | Bagas R2-P0-B3 + Nathan R2-P0-N4, dengan polygon/count/manifest dari N1–N3. |
| Versi kebijakan kualitas yang dikenali backend | Isi konfigurasi analisis atau `NEXT_PUBLIC_RESEARCH_QUALITY_POLICY_VERSION` setelah versi disepakati. Ini ID konfigurasi publik, bukan kredensial. Nilai sintetis tidak dipakai otomatis untuk produksi. |
| QA citra satelit dan label di jaringan normal | Request imagery eksternal dibatasi lingkungan pengujian; kegagalan tile dan kelangsungan overlay teruji, ketajaman citra/label live belum dapat dinyatakan lulus. |
| Review rekan | Nathan; belum dilakukan oleh pekerjaan otomatis ini. |

Editor polygon dan query belum disimpan lintas reload browser; persistensi area berasal dari backend v2. Detail harian saat ini menampilkan halaman pertama dan memberi tahu jika ada halaman berikutnya; titik mentah memiliki tombol halaman berikutnya. Kalender lengkap, geocoding arbitrer, bookmark, assignment dan laporan pemeriksaan bukan klaim selesai pada sprint ini.
