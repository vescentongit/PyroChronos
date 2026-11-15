# Keputusan dan status aktif — 14 November 2026

Dokumen ini mengesampingkan persyaratan login, Google OAuth, akun individual dan kolaborasi workspace server pada dokumen/rencana lama. Keputusan pengguna: seluruh fitur web harus dapat diakses dan digunakan tanpa login.

## Penyimpanan dan akses

UI memakai workspace lokal, localStorage dan IndexedDB. Area, hasil, riwayat serta laporan disimpan pada browser perangkat yang digunakan. Menghapus data browser dapat menghapus catatan tersebut. Sinkronisasi perangkat, keanggotaan tim, identitas terverifikasi dan penugasan lintas pengguna belum tersedia; nama pemeriksa lokal tidak boleh diklaim sebagai identitas akun terverifikasi.

API Auth.js/Google, workspace server dan laporan koordinator dipertahankan sebagai legacy. UI aktif tidak membutuhkannya. Data server terdahulu tetap disimpan; menghilangkan login dari UI tidak memberi akses publik ke catatan privat lama. Kontrak v2 server tetap berlaku bagi endpoint legacy tersebut, tetapi bukan prasyarat penggunaan web sekarang.

## Analisis aktif

Browser mengirim polygon dan periode secara eksplisit ke `/api/local-research`. Server memvalidasi geometri dan menjalankan Python terhadap `RESEARCH_DATA_DIR`; hasil divalidasi lalu disimpan di IndexedDB. Request ini menunggu proses selesai, belum menggunakan antrean persisten. Batas: satu analisis per proses server, timeout producer 120 detik per pemanggilan dan maksimum 100.000 observasi per bundle. Ini batas implementasi, bukan SLA global.

Konfigurasi Vercel kini menyediakan `app` publik dan `pipeline` internal melalui binding. Untuk hosting, adapter dataset privat Vercel Blob dan workflow GitHub Actions harian sudah ditambahkan: arsip FIRMS standard MODIS/S-NPP diproses per tahun, terbit sebagai snapshot immutable, lalu tile sesuai kueri dibaca dengan verifikasi checksum. Jalur lokal tetap tersedia. Aktivasi memerlukan proyek/store dan secret; store cloud, backfill global, jadwal aktif dan deployment belum diverifikasi atau diklaim berjalan. Hosted bundle dibatasi 4 MB. [Panduan aktivasi dan batas cakupan](vercel-deployment.md).

Peta density memakai gradasi hijau → kuning → oranye → merah (rendah → tinggi), radius kernel 4–14 px dan opacity 0,6; fallback 3–10 px. Label ID/EN menjelaskan kedua ujung skala dan bahwa density bukan tingkat bahaya. Titik asli serta skala kalender/anomali tetap memiliki arti masing-masing.

Jalur anonim kini memuat model harmonisasi dan kebijakan baseline dari `pipeline/models`. Kalender tahun × bulan membuka detail harian; ringkasan perbandingan menampilkan durasi, estimasi, laju per hari dan persentase total bila dua estimasi lengkap dengan pembanding positif. Tabel anomali menampilkan median, delta, persentil dan tahun referensi aktual. Hasil lama di browser tidak dihitung ulang otomatis.

Harmonisasi retrospektif memakai VIIRS S-NPP ke skala MODIS, model ratio_global. Estimasi ditahan di luar domain tervalidasi, termasuk Kalteng/Papua. Minimum referensi default empat tahun valid dalam sepuluh tahun sebelumnya. Tanpa arsip hasil no_data; tanpa model/dukungan estimasi tetap null. Data mentah tidak menjadi titik harmonisasi sintetis.

## Status sprint dan sisa pekerjaan

Nathan P0 telah tercatat selesai/direview setelah PR #7; P1 memiliki implementasi dan evaluasi, review serta integrasi menyeluruh tetap perlu bukti. Checklist lama yang menyebut OAuth sebagai acceptance digantikan keputusan tanpa login ini. Review manusia tidak dianggap terjadi hanya karena implementasi atau tes tersedia.

Orkhan P1 O1–O4 kini memiliki implementasi lokal: kalender/perbandingan/anomali, bukti asli/lokasi tersimpan, penugasan/pemeriksaan/koreksi dan ekspor CSV/JSON/PNG. Acceptance browser sintetis desktop/mobile serta review finish independen lulus. Review manusia Nathan dan demonstrasi dataset aktif masih terbuka. [Bukti Sprint 2](orkhan-sprint-2-progress.md). Kolaborasi server tidak diwajibkan untuk versi tanpa login ini.

Dokumen progres lama mencatat bukti pada saat dibuat. Angka tes/build historis tidak menjadi bukti verifikasi checkout terbaru. AGENTS.md tetap berlaku: baca panduan Next.js lokal sebelum menulis kode.

Sprint 3 Orkhan O1/O3 otomatis kini memiliki benchmark sintetis sebelum/sesudah, cache satu bundle aktif, dedup linear dan pemeriksaan edge ID/EN. [Laporan Sprint 3](orkhan-sprint-3-progress.md). O2 belum dijalankan karena peneliti belum tersedia menurut pengguna; O4 dan review manusia tetap terbuka. Tidak ada klaim performa mobile fisik, SLA global atau sustained 60 FPS.

## Verifikasi kelanjutan ini

Bagas Sprint 3 Tahap 6: [audit isolasi dan retensi](bagas-sprint-3-isolation-retention.md)
menambahkan recheck membership sebelum respons dan setiap chunk unduhan CSV,
tanpa prefetch stream aplikasi. Cross-workspace, revoke dan downgrade hak owner
diuji; member aktif tetap memiliki hak baca sesuai kontrak. Retensi server dan
browser tanpa TTL/delete data otomatis; browser hanya melepas cache memori saat
panel ditutup. Orphan tetap privat, tidak ada trigger histori yang diubah atau
login baru pada web anonim. Review manusia Orkhan atas B3 masih terbuka.
Verifikasi Tahap 6: 286 tes Node dan 163 tes Python tanpa skip dengan PostgreSQL
native aktif; typecheck/lint/contracts/build dan diff check lulus.

Bagas Sprint 3 Tahap 5: [rekonsiliasi dan pemulihan berulang](bagas-sprint-3-recovery.md)
menambahkan audit objek privat tanpa delete/metadata write, restore file hilang
dari backup checksum-valid tanpa overwrite, serta pemulihan indeks browser sebelum
riwayat dimuat. Orphan tetap privat untuk review retensi; metadata yang tidak
commit dipulihkan lewat retry/lease worker, bukan ditebak dari file. Restore database
yang benar-benar hilang tetap memerlukan backup terverifikasi. Review manusia
Orkhan atas B2 tetap terbuka.
Verifikasi Tahap 5: 280 tes Node tanpa skip termasuk native; typecheck, lint,
contracts, build dan diff check lulus. Pemulihan tidak menghapus histori; orphan
dipertahankan untuk review retensi.

Bagas Sprint 3 Tahap 4 (B2 bagian 1): [ketahanan proses](bagas-sprint-3-process-resilience.md)
memiliki bukti subprocess crash/restart, rollback publikasi yang dimatikan,
stale lease fencing, timeout/retry dan kontrol terminasi runtime pada PostgreSQL
native uji. Duplikasi server dan operation ID laporan lokal dibedakan dari request
anonim sinkron; abort/timeout tidak menimpa hasil lama. Tidak ada perubahan policy
atau kode produksi. Tahap 5 pemulihan artefak/metadata dan review Orkhan tetap terbuka.
Verifikasi sesi Tahap 4: 276 tes Node dan 163 tes Python tanpa skip dengan
PostgreSQL native aktif; typecheck/lint/contracts/ruff helper dan diff check lulus.

Bagas Sprint 3 Tahap 3: [policy kapasitas dan backpressure](bagas-sprint-3-backpressure.md)
diterapkan. Satu analisis anonim/proses dan lima analisis aktif/workspace
dipertahankan; kuota anonim 30 admission/menit/proses dan guard lima ekspor
aktif/workspace ditambahkan sebagai kebijakan konservatif. Error v2 dan
Retry-After eksplisit, body dibatasi, hasil/ekspor lama tetap terbaca saat penuh,
dan request anonim yang ditolak tidak menimpa penyimpanan lama. Regresi terbaru:
268 tes Node dan 163 tes Python tanpa skip dengan PostgreSQL native uji;
typecheck/lint/contracts lulus. Review manusia Orkhan masih terbuka.

Bagas Sprint 3 Tahap 1/2 (14 November 2026): matriks anonim vs legacy dan
benchmark sintetis terukur tersedia pada [laporan kapasitas](bagas-sprint-3-capacity.md).
Pengukuran memakai producer/route aktual serta PostgreSQL 16 lokal sementara,
bukan data FIRMS aktif atau tarif deployment. Backpressure dan akses hasil lama
lulus; guard tetap dipertahankan, tanpa klaim ETA/SLA. Regresi terbaru perubahan
ini: 253 tes Node dan 154 tes Python tanpa skip, typecheck/lint/contracts lulus.
B1 belum ditandai selesai/direview; review Orkhan tetap terbuka.

Catatan verifikasi checkout Orkhan sebelumnya (bukan hasil run Bagas di atas):

- Typecheck dan `npm run build` lengkap (termasuk Prisma generate): lulus.
- Contract checks: tujuh schema v1 dan 22 schema v2 lulus.
- Python harmonisasi: 27 kasus, 26 lulus dan satu skip kondisional; mencakup handoff model worker anonim, anomali, dua periode dan kesesuaian jumlah harian.
- Suite Node terbaru pada checkout Orkhan: 127 kasus, 125 lulus dan dua skip integrasi native yang tidak dikonfigurasi. Tes mencakup monitoring lokal, ekspor, kontras dan cache bundle.
- Playwright MCP kini berhasil: alur sintetis desktop/mobile, heatmap ke bukti asli, persistensi, koreksi, unduhan dan EN/ID lulus tanpa exception runtime. Pemeriksaan tambahan ekspor seluruh halaman dan kegagalan penyimpanan lulus. Database remote dan arsip aktif tidak diuji oleh pekerjaan ini.
