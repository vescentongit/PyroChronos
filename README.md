# PyroChronos

Next.js + Tailwind + Prisma + Neon. Dashboard demo berbahasa Indonesia dengan peta MapLibre, grafik Recharts, dua wilayah, kandidat patroli, ekspor CSV, dan laporan lokal.

## Menjalankan

```sh
npm install
npm run dev
```

Buka http://localhost:3000. `npm run build` memeriksa build produksi.

## Status data dan batas implementasi

Seluruh kandidat, grafik, persentil, dan prioritas adalah fixture ilustratif, bukan data NASA aktual atau hasil kalibrasi. Laporan pada UI tersimpan di localStorage perangkat dan diberi label demo. Tidak ada autentikasi produksi, job FIRMS, atau model harmonisasi yang diklaim aktif. Peta membutuhkan jaringan untuk tile CARTO/OpenStreetMap; daftar lokasi tetap tersedia ketika basemap gagal.

## Neon dan API laporan

Salin `.env.example` ke `.env`, isi `DATABASE_URL` pooled Neon dan `COORDINATOR_TOKEN` acak minimal 32 karakter. Jangan memakai prefix NEXT_PUBLIC untuk secret.

```sh
npx prisma migrate dev --name init
npx prisma generate
```

Pada halaman Laporan lapangan, masukkan kode akses koordinator untuk menghubungkan UI ke Neon. Endpoint session menyimpan cookie HttpOnly selama delapan jam. `GET /api/reports` dan `POST /api/reports` menerima cookie tersebut atau `Authorization: Bearer <COORDINATOR_TOKEN>`. POST menerima `requestId` UUID, `candidateId` dari fixture, `observedAt` ISO UTC, `result` sesuai tiga kategori UI, dan `notes`. requestId mencegah duplikasi. Token bersama adalah akses pengembangan, bukan akun koordinator individual. Sebelum penggunaan nyata, tambahkan Auth.js, pemetaan identitas, otorisasi wilayah dan jejak koreksi laporan.

Dengan `FIRMS_MAP_KEY`, `/api/firms?region=kalteng` atau `region=papua` menyediakan CSV NOAA-20 NRT untuk bounding box studi selama dua hari. Endpoint ini tidak mengaktifkan skor atau data dashboard otomatis dan tidak mengklaim cakupan provinsi penuh. Tidak ada key yang dikirim ke browser.

Service ingest privat, konfigurasi sumber/wilayah bersama, adapter raw batch, dan pengujian keamanan tersedia pada [panduan ingest B2](docs/ingest.md). Route FIRMS tetap hanya untuk unduhan: GET publik tidak menulis batch database. Job Python memerlukan environment server, database non-produksi yang sudah dimigrasikan, serta penyimpanan raw privat dan persisten; ingest terjadwal belum diaktifkan.

`pipeline/harmonize.py` adalah kandidat EQM eksperimental dengan zero-preservation dan penanda outside-support. Uji: `python -m unittest discover -s pipeline`. Pipeline ini belum dilatih memakai arsip nyata dan tidak digunakan untuk skor demo. Integrasi otomatis FIRMS, baseline musiman, kalibrasi per wilayah, ranking tervalidasi, revisi laporan, dan autentikasi individual masih merupakan pekerjaan lanjutan.

Migrasi deployment: `npx prisma migrate deploy`. Jangan menjalankan migrasi saat request. Tidak ada koneksi atau migrasi Neon yang dilakukan otomatis oleh scaffold ini.
