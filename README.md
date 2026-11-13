# PyroChronos

Next.js + Tailwind + Prisma + Neon. Home dengan globe geografis interaktif dan halaman Simulation untuk dashboard, peta MapLibre, grafik historis, dua wilayah, kandidat verifikasi, ekspor CSV/JSON, serta laporan. Mendukung Indonesia/English dan Plus Jakarta Sans.

## Menjalankan

```sh
npm install
npm run dev
```

Buka http://localhost:3000. `npm run build` memeriksa build produksi.

## Home dan Simulation

- `/`: globe wireframe/dotted. Hover atau tombol Hotspot demo menampilkan titik ilustratif. Drag/tombol panah untuk rotasi, scroll/tombol untuk zoom; rotasi dapat dijeda dan mengikuti reduced motion.
- `/simulation`: dashboard. CTA dan navigasi Simulation dari Home menuju halaman ini.
- `/simulation?region=papua` atau `region=kalteng`: membuka subset studi yang dipilih.

Komponen globe ada di `src/components/ui/wireframe-dotted-globe.tsx` (alias `@/components/ui`), mengikuti struktur komponen UI pada proyek dengan direktori `src`. Komponen memakai D3 geografis (`d3-geo`) dan Canvas native tanpa primitive/provider shadcn tambahan. Tailwind 4 dan TypeScript sudah tersedia.

Geometri Natural Earth disimpan lokal di `public/geo`; sumber/lisensi ada pada README folder tersebut. Regenerasi titik: `node scripts/build-globe-land.mjs`. Halaman tidak mengambil geometri dari GitHub saat digunakan. CSS Simulation terlingkup agar navigasi tidak memengaruhi Home.

Pemeriksaan: `npm run check:frontend` (Node.js 22.18+/24), `npm run typecheck`, `npm run build`, dan `TEST_URL=http://localhost:3000 npm run smoke` dengan server aktif. Typecheck menonaktifkan cache incremental agar tipe route baru tidak tertahan cache TypeScript lama.

## Status data dan batas implementasi

Acceptance frontend tanpa backend nyata: `npm run check:browser`, dengan server dan Chrome debugging lokal aktif. Script memakai context incognito dan respons API sintetis; cara menjalankan serta bukti hasil ada di [docs/frontend-acceptance.md](docs/frontend-acceptance.md).

Mode Demo memakai kandidat, grafik, persentil, dan prioritas ilustratif. Mode Operasional mengharapkan snapshot lewat `/api/snapshots`; endpoint belum tersedia, dan UI menampilkan unavailable tanpa memakai fixture sebagai pengganti. Kontrak: `docs/contracts/snapshot-v1.md`. Tidak ada autentikasi produksi, job FIRMS, atau model harmonisasi yang diklaim aktif. Peta Simulation memakai tile Esri World Imagery; fallback koordinat dan daftar tetap tersedia ketika basemap gagal.

## Penyimpanan browser dan analisis

Penggunaan UI tidak memerlukan login. Workspace lokal, area, pilihan analisis, hasil dan laporan disimpan pada browser perangkat tersebut; data tidak disinkronkan ke perangkat atau pengguna lain. Menghapus data situs/browser dapat menghapusnya. Hasil lama dari akun atau database server tidak otomatis disalin ke browser dan tidak dihapus dari server.

Analisis historis masih diproses pada server menggunakan dataset pada `RESEARCH_DATA_DIR` dan Python (`RESEARCH_PYTHON` opsional). Area dan periode dikirim ke server untuk pemrosesan; hasil dikembalikan dan disimpan di IndexedDB browser. Dataset kosong menghasilkan `no_data`, bukan nol kebakaran. API pemrosesan membatasi ukuran permintaan, waktu, dan satu analisis bersamaan per proses; batas ini bukan kuota global untuk deployment multi-instance. Fitur tim dan sinkronisasi lintas perangkat belum tersedia dalam mode lokal.

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

`pipeline/harmonize.py` adalah kandidat EQM eksperimental dengan zero-preservation dan penanda outside-support. Uji: `python -m unittest discover -s pipeline`. Pipeline ini belum dilatih memakai arsip nyata dan tidak digunakan untuk skor demo. Integrasi otomatis FIRMS, baseline musiman, kalibrasi per wilayah, ranking tervalidasi, revisi laporan, dan autentikasi individual masih merupakan pekerjaan lanjutan.

Migrasi deployment: `npx prisma migrate deploy`. Jangan menjalankan migrasi saat request. Tidak ada koneksi atau migrasi Neon yang dilakukan otomatis oleh scaffold ini.
