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

## Neon dan API laporan

Acuan implementasi lintas Nathan/Bagas/Orkhan: [kontrak payload API v1](docs/contracts/api-v1.md), dengan schema runtime, JSON Schema, contoh kedua wilayah, dan `npm run check:contracts`. Endpoint yang dijelaskan sebagai target di kontrak belum otomatis tersedia pada scaffold saat ini.

Salin `.env.example` ke `.env`, isi `DATABASE_URL` pooled Neon dan `COORDINATOR_TOKEN` acak minimal 32 karakter. Jangan memakai prefix NEXT_PUBLIC untuk secret.

```sh
npx prisma migrate dev --name init
npx prisma generate
```

Pada mode Operasional, halaman Laporan lapangan menyediakan kode akses koordinator pengembangan untuk menghubungkan UI ke Neon. Endpoint session menyimpan cookie HttpOnly selama delapan jam. `GET /api/reports` dan `POST /api/reports` menerima cookie tersebut atau `Authorization: Bearer <COORDINATOR_TOKEN>`. POST menerima `requestId` UUID, `candidateId` dari fixture, `observedAt` ISO UTC, `result` sesuai tiga kategori UI, dan `notes`. requestId mencegah duplikasi. Token bersama adalah akses pengembangan, bukan akun koordinator individual. Sebelum penggunaan nyata, tambahkan Auth.js, pemetaan identitas, otorisasi wilayah dan jejak koreksi laporan.

Dengan `FIRMS_MAP_KEY`, `/api/firms?region=kalteng` atau `region=papua` menyediakan CSV NOAA-20 NRT untuk bounding box studi selama dua hari. Endpoint ini tidak mengaktifkan skor atau data dashboard otomatis dan tidak mengklaim cakupan provinsi penuh. Tidak ada key yang dikirim ke browser.

Service ingest privat, konfigurasi sumber/wilayah bersama, adapter raw batch, dan pengujian keamanan tersedia pada [panduan ingest B2](docs/ingest.md). Route FIRMS tetap hanya untuk unduhan: GET publik tidak menulis batch database. Job Python memerlukan environment server, database non-produksi yang sudah dimigrasikan, serta penyimpanan raw privat dan persisten; ingest terjadwal belum diaktifkan.

`pipeline/harmonize.py` adalah kandidat EQM eksperimental dengan zero-preservation dan penanda outside-support. Uji: `python -m unittest discover -s pipeline`. Pipeline ini belum dilatih memakai arsip nyata dan tidak digunakan untuk skor demo. Integrasi otomatis FIRMS, baseline musiman, kalibrasi per wilayah, ranking tervalidasi, revisi laporan, dan autentikasi individual masih merupakan pekerjaan lanjutan.

Migrasi deployment: `npx prisma migrate deploy`. Jangan menjalankan migrasi saat request. Tidak ada koneksi atau migrasi Neon yang dilakukan otomatis oleh scaffold ini.
