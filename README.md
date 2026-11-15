> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](docs/current-status.md).

# PyroChronos

Next.js + Tailwind dan producer Python. Home dengan globe geografis interaktif dan halaman Simulation untuk peta MapLibre, polygon bebas, kalender historis, perbandingan, bukti asli, ekspor dan laporan lokal. Kalteng/Papua merupakan area contoh, bukan batas kueri. Mendukung Indonesia/English dan Plus Jakarta Sans. Prisma/Neon dipertahankan untuk API server legacy.

## Menjalankan

```sh
npm install
npm run dev
```

Buka http://localhost:3000. `npm run build` memeriksa build produksi.

Untuk analisis historis, sediakan Python dan `FIRMS_MAP_KEY` server-only melalui `.env` atau environment proses. `RESEARCH_DATA_DIR` memilih store lokal sebagai alternatif; `RESEARCH_PYTHON` memilih interpreter lokal. Tanpa konfigurasi producer, halaman tetap terbuka dan analisis menampilkan dependency unavailable. Database dan Google OAuth tidak diperlukan. Lihat [konfigurasi dan batas layanan](docs/vercel-deployment.md).

## Home dan Simulation

- `/`: globe wireframe/dotted. Hover atau tombol Hotspot demo menampilkan titik ilustratif. Drag/tombol panah untuk rotasi, scroll/tombol untuk zoom; rotasi dapat dijeda dan mengikuti reduced motion.
- `/simulation`: dashboard. CTA dan navigasi Simulation dari Home menuju halaman ini.
- `/simulation?region=papua` atau `region=kalteng`: membuka subset studi yang dipilih.

Komponen globe ada di `src/components/ui/wireframe-dotted-globe.tsx` (alias `@/components/ui`), mengikuti struktur komponen UI pada proyek dengan direktori `src`. Komponen memakai D3 geografis (`d3-geo`) dan Canvas native tanpa primitive/provider shadcn tambahan. Tailwind 4 dan TypeScript sudah tersedia.

Geometri Natural Earth disimpan lokal di `public/geo`; sumber/lisensi ada pada README folder tersebut. Regenerasi titik: `node scripts/build-globe-land.mjs`. Halaman tidak mengambil geometri dari GitHub saat digunakan. CSS Simulation terlingkup agar navigasi tidak memengaruhi Home.

Pemeriksaan: `npm run check:frontend` (Node.js 22.18+/24), `npm run typecheck`, `npm run build`, dan `TEST_URL=http://localhost:3000 npm run smoke` dengan server aktif. Typecheck menonaktifkan cache incremental agar tipe route baru tidak tertahan cache TypeScript lama.

[Verifikasi 15 November](docs/verification-2026-11-15.md) mencatat build produksi, tes regresi storage/pembatalan/pergantian hasil/transport dan 18 checkpoint QA browser historis. Kendala port pada build Linux sebelumnya tetap dicatat sebagai bukti historis. FIRMS live dan routing hosted belum terverifikasi.

## Status data dan batas implementasi

Acceptance frontend tanpa backend nyata: `npm run check:browser`, dengan server dan Chrome debugging lokal aktif. Script memakai context incognito dan respons API sintetis; cara menjalankan serta bukti hasil ada di [docs/frontend-acceptance.md](docs/frontend-acceptance.md).

Data ruang kerja default memakai analisis tersimpan dari browser: dashboard, perbandingan sensor dan laporan lapangan membaca hasil historis yang sama. Jalur aktif `/api/local-research` memakai producer Python dan model terbitan pada domain yang didukung. Mode Demo dapat dipilih secara eksplisit dan memakai kandidat, grafik, persentil serta prioritas ilustratif. API `/api/snapshots` lama belum tersedia dan tidak dipanggil oleh jalur analisis tersimpan. Kontrak snapshot lama: `docs/contracts/snapshot-v1.md`. Peta Simulation memakai tile Esri World Imagery; fallback koordinat dan daftar tetap tersedia ketika basemap gagal.

## Penyimpanan browser dan analisis

Konfigurasi dua servis Vercel (`app` publik, `pipeline` internal melalui binding) tersedia pada `vercel.json`. Analisis historis mengambil FIRMS sesuai polygon/periode tanpa arsip global permanen. Browser memuat dan menyimpan per bulan, melanjutkan bagian yang belum selesai, lalu membentuk kalender lengkap dengan provenance setiap snapshot. Jadwal arsip global dinonaktifkan. [Panduan deployment Vercel](docs/vercel-deployment.md) menjelaskan key server-only dan batas layanan; deployment belum dilakukan.

Keputusan aktif: seluruh fitur web dapat digunakan tanpa login dan tanpa konfigurasi Google OAuth. Kalender tahun × bulan, ringkasan dua periode dan tabel anomali membaca hasil analisis yang sama. Jalur analisis lokal memuat model terbitan `pipeline/models`; estimasi tetap null pada domain yang tidak lolos evaluasi. Lihat [status dan sisa sprint](docs/current-status.md).

Hasil riset kini menyediakan lokasi pemantauan dari titik asli, penugasan/pemeriksaan lokal, koreksi berhistori, CSV observasi/agregat, JSON/manifest dan PNG kalender. Klik peta kepadatan memperbesar kamera sebelum memilih titik; tabel bukti juga tersedia. CSV observasi memakai kolom `recordType`; hasil kosong memuat baris `metadata` dengan provenance dan kolom observasi kosong. Nama lokal bukan identitas akun terverifikasi. [Bukti dan batas Sprint 2](docs/orkhan-sprint-2-progress.md).

Penggunaan UI tidak memerlukan login. Workspace lokal, area, pilihan analisis, hasil dan laporan disimpan pada browser perangkat tersebut; data tidak disinkronkan ke perangkat atau pengguna lain. Menghapus data situs/browser dapat menghapusnya. Hasil lama dari akun atau database server tidak otomatis disalin ke browser dan tidak dihapus dari server.

Analisis historis diproses di Python menggunakan `FIRMS_MAP_KEY`, atau `RESEARCH_DATA_DIR` bila dataset lokal dipilih (`RESEARCH_PYTHON` opsional untuk interpreter lokal). Data mentah API hanya berada dalam memori selama request; hasil/bukti asli serta manifest disimpan di IndexedDB. Sumber standard dan NRT tetap terpisah. Bagian gagal/belum dimuat tidak menjadi nol; respons CSV sukses tanpa observasi menghasilkan nol observasi, bukan bukti tidak ada kebakaran. Pilihan ambil ulang memeriksa revisi data, sedangkan cache biasa mempertahankan snapshot lama. Ukuran, waktu dan konkurensi dibatasi; kalender multidekade dapat memerlukan banyak request. Sinkronisasi lintas perangkat belum tersedia.

## API dan integrasi lama

Acuan implementasi lintas Nathan/Bagas/Orkhan: [kontrak payload API v1](docs/contracts/api-v1.md), dengan schema runtime, JSON Schema, contoh kedua wilayah, dan `npm run check:contracts`. Endpoint yang dijelaskan sebagai target di kontrak belum otomatis tersedia pada scaffold saat ini.

Endpoint lama untuk akun, workspace server, dan laporan koordinator tetap berada di repository untuk kompatibilitas; UI lokal tidak menggunakannya. Untuk menjalankan endpoint lama, salin `.env.example` ke `.env`, isi `DATABASE_URL` dan `COORDINATOR_TOKEN` acak minimal 32 karakter. Jangan memakai prefix NEXT_PUBLIC untuk secret.

```sh
npx prisma migrate dev --name init
npx prisma generate
```

Endpoint lama `GET /api/reports` dan `POST /api/reports` menerima cookie koordinator atau `Authorization: Bearer <COORDINATOR_TOKEN>`. Laporan baru di UI disimpan secara lokal, terpisah antara mode demo dan operasional.

Dengan `FIRMS_MAP_KEY`, `/api/firms?region=kalteng` atau `region=papua` menyediakan CSV NOAA-20 NRT untuk bounding box studi selama dua hari. Endpoint ini tidak mengaktifkan skor atau data dashboard otomatis dan tidak mengklaim cakupan provinsi penuh. Tidak ada key yang dikirim ke browser.

Service ingest privat, konfigurasi sumber/wilayah bersama, adapter raw batch, dan pengujian keamanan tersedia pada [panduan ingest B2](docs/ingest.md). Route FIRMS tetap hanya untuk unduhan: GET publik tidak menulis batch database. Job Python memerlukan environment server, database non-produksi yang sudah dimigrasikan, serta penyimpanan raw privat dan persisten; ingest terjadwal belum diaktifkan.

`pipeline/harmonize.py` menyimpan eksperimen EQM lama. Jalur riset aktif memakai model `ratio_global` hasil evaluasi retrospektif arsip nyata dan baseline bergerak; lihat [metode dan domain ditolak](docs/data/harmonization.md). Ini tidak mengubah skor demo atau menjamin validitas global/operasional. Revisi laporan lokal sudah tersedia; autentikasi individual bukan syarat versi aktif. Uji dengan dependensi `pipeline/requirements-dev.txt`: `python -m unittest discover -s pipeline -p 'test_*.py'`.

Migrasi deployment: `npx prisma migrate deploy`. Jangan menjalankan migrasi saat request. Tidak ada koneksi atau migrasi Neon yang dilakukan otomatis oleh scaffold ini.
