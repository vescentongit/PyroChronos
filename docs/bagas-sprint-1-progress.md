# Bagas Sprint 1 P0 — implementasi sementara

Status: belum selesai dan belum direview. API v2 dinonaktifkan secara default; `RESEARCH_V2_EXPERIMENTAL=true` hanya untuk pengujian pada database terisolasi, bukan deployment publik.

Sudah disiapkan: skema/migrasi fondasi, Auth.js dengan Google, validasi geometri server, membership, area, pengajuan job idempotent, polling dan pembacaan hasil/detail. Migrasi diuji memakai PGlite dan cocok dengan skema Prisma. Data dan laporan legacy tidak dimigrasikan atau dihapus.

Worker dan pendaftaran dataset berversi sekarang tersedia: `npm run research:worker -- --register` mendaftarkan fingerprint `RESEARCH_DATA_DIR`; `npm run research:worker` menjalankan antrean, dan `--once` memproses satu job. Data harus tetap identik selama job berjalan. Auth.js memakai Google, dengan `AUTH_SECRET`, `AUTH_GOOGLE_ID` dan `AUTH_GOOGLE_SECRET`. Daftarkan `http://localhost:3000/api/auth/callback/google` sebagai redirect URI untuk pengembangan dan URL HTTPS domain aplikasi dengan path yang sama untuk deployment. Set `NEXT_PUBLIC_RESEARCH_QUALITY_POLICY_VERSION=quality-policy-1` untuk frontend. Raw-density tile tersedia sebagai GeoJSON agregat per run/periode/tile; koordinat sel bukan pengamatan individual.

Pengujian PGlite dan producer Python memeriksa idempotensi/konflik, penolakan workspace lain, penggantian lease, dataset berubah, dan publikasi atomik. Batas awal lima job aktif dan 100.000 observasi per run belum dibenchmark; worker masih membaca observasi ke memori. Masih wajib sebelum B1–B4 ditutup: konfigurasi dan uji OAuth aktual; pengujian HTTP end-to-end dan konkurensi multi-proses; review rekan; integrasi FIRMS nyata; dan verifikasi migrasi pada PostgreSQL/Neon non-produksi. Jangan menggunakan token koordinator legacy sebagai identitas individual.

Migrasi fondasi sudah tercatat sebagai diterapkan pada database Neon yang dikonfigurasi; lingkungan tersebut belum dipastikan sebagai database non-produksi. Login Google telah membuat satu akun menurut hitungan database, tetapi pengujian sesi dan alur workspace di browser masih memerlukan pengguna.

Verifikasi tambahan: arsip global MODIS tahun 2000 diunduh ke `.cache/research-acceptance`, bukan ke dataset aktif. Untuk bbox `[-65,-15,-45,0]` pada November 2000, producer dan bundle worker menghasilkan 4.869 observasi mentah, 30 hari, lima halaman dan status `partial` (VIIRS belum tersedia); estimasi tetap null. Payload lolos schema. Ini bukan uji HTTP atau publikasi worker ke Neon, dan bukan validasi harmonisasi.

Panel kini menyediakan pembuatan workspace untuk akun yang belum memilikinya. Worker diperbaiki agar kegagalan sementara saat mengambil job tidak menghentikan proses; job dengan lease yang gagal akan dapat diulang setelah lease kedaluwarsa. Batasan dan review di atas tetap terbuka.

QA Chrome headless pada build produksi lulus untuk desktop dan mobile, termasuk pembuatan workspace melalui empty state. Respons v2 pada pengujian workspace dan analisis bersifat sintetis; QA tersebut tidak membuktikan login Google, workspace Neon aktual, atau job dengan dataset nyata di server.
