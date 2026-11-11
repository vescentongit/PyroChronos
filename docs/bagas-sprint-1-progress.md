# Bagas Sprint 1 P0 — implementasi sementara

Status: belum selesai dan belum direview. API v2 dinonaktifkan secara default; `RESEARCH_V2_EXPERIMENTAL=true` hanya untuk pengujian pada database terisolasi, bukan deployment publik.

Sudah disiapkan: skema/migrasi fondasi, Auth.js dengan Google, validasi geometri server, membership, area, pengajuan job idempotent, polling dan pembacaan hasil/detail. Migrasi diuji memakai PGlite dan cocok dengan skema Prisma. Data dan laporan legacy tidak dimigrasikan atau dihapus.

Worker dan pendaftaran dataset berversi sekarang tersedia: `npm run research:worker -- --register` mendaftarkan fingerprint `RESEARCH_DATA_DIR`; `npm run research:worker` menjalankan antrean, dan `--once` memproses satu job. Data harus tetap identik selama job berjalan. Auth.js memakai Google, dengan `AUTH_SECRET`, `AUTH_GOOGLE_ID` dan `AUTH_GOOGLE_SECRET`. Daftarkan `http://localhost:3000/api/auth/callback/google` sebagai redirect URI untuk pengembangan dan URL HTTPS domain aplikasi dengan path yang sama untuk deployment. Set `NEXT_PUBLIC_RESEARCH_QUALITY_POLICY_VERSION=quality-policy-1` untuk frontend. Raw-density tile tersedia sebagai GeoJSON agregat per run/periode/tile; koordinat sel bukan pengamatan individual.

Pengujian PGlite dan producer Python memeriksa idempotensi/konflik, penolakan workspace lain, penggantian lease, dataset berubah, dan publikasi atomik. Batas awal lima job aktif dan 100.000 observasi per run belum dibenchmark; worker masih membaca observasi ke memori. Masih wajib sebelum B1–B4 ditutup: konfigurasi dan uji OAuth aktual; pengujian HTTP end-to-end dan konkurensi multi-proses; review rekan; integrasi FIRMS nyata; dan verifikasi migrasi pada PostgreSQL/Neon non-produksi. Jangan menggunakan token koordinator legacy sebagai identitas individual.

Belum ada migrasi pada database eksternal. `AnalysisRun`, `AnalysisArtifact` dan resource terkait merupakan fondasi pengembangan; belum ada hasil nyata yang dipublikasikan melalui API ini.
