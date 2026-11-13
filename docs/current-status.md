# Keputusan dan status aktif — 13 November 2026

Dokumen ini mengesampingkan persyaratan login, Google OAuth, akun individual dan kolaborasi workspace server pada dokumen/rencana lama. Keputusan pengguna: seluruh fitur web harus dapat diakses dan digunakan tanpa login.

## Penyimpanan dan akses

UI memakai workspace lokal, localStorage dan IndexedDB. Area, hasil, riwayat serta laporan disimpan pada browser perangkat yang digunakan. Menghapus data browser dapat menghapus catatan tersebut. Sinkronisasi perangkat, keanggotaan tim, identitas terverifikasi dan penugasan lintas pengguna belum tersedia; nama pemeriksa lokal tidak boleh diklaim sebagai identitas akun terverifikasi.

API Auth.js/Google, workspace server dan laporan koordinator dipertahankan sebagai legacy. UI aktif tidak membutuhkannya. Data server terdahulu tetap disimpan; menghilangkan login dari UI tidak memberi akses publik ke catatan privat lama. Kontrak v2 server tetap berlaku bagi endpoint legacy tersebut, tetapi bukan prasyarat penggunaan web sekarang.

## Analisis aktif

Browser mengirim polygon dan periode secara eksplisit ke `/api/local-research`. Server memvalidasi geometri dan menjalankan Python terhadap `RESEARCH_DATA_DIR`; hasil divalidasi lalu disimpan di IndexedDB. Request ini menunggu proses selesai, belum menggunakan antrean persisten. Batas: satu analisis per proses server, timeout producer 120 detik per pemanggilan dan maksimum 100.000 observasi per bundle. Ini batas implementasi, bukan SLA global.

Jalur anonim kini memuat model harmonisasi dan kebijakan baseline dari `pipeline/models`. Kalender tahun × bulan membuka detail harian; ringkasan perbandingan menampilkan durasi, estimasi, laju per hari dan persentase total bila dua estimasi lengkap dengan pembanding positif. Tabel anomali menampilkan median, delta, persentil dan tahun referensi aktual. Hasil lama di browser tidak dihitung ulang otomatis.

Harmonisasi retrospektif memakai VIIRS S-NPP ke skala MODIS, model ratio_global. Estimasi ditahan di luar domain tervalidasi, termasuk Kalteng/Papua. Minimum referensi default empat tahun valid dalam sepuluh tahun sebelumnya. Tanpa arsip hasil no_data; tanpa model/dukungan estimasi tetap null. Data mentah tidak menjadi titik harmonisasi sintetis.

## Status sprint dan sisa pekerjaan

Nathan P0 telah tercatat selesai/direview setelah PR #7; P1 memiliki implementasi dan evaluasi, review serta integrasi menyeluruh tetap perlu bukti. Checklist lama yang menyebut OAuth sebagai acceptance digantikan keputusan tanpa login ini. Review manusia tidak dianggap terjadi hanya karena implementasi atau tes tersedia.

Orkhan P1 O1–O4 kini memiliki implementasi lokal: kalender/perbandingan/anomali, bukti asli/lokasi tersimpan, penugasan/pemeriksaan/koreksi dan ekspor CSV/JSON/PNG. Acceptance browser sintetis desktop/mobile serta review finish independen lulus. Review manusia Nathan dan demonstrasi dataset aktif masih terbuka. [Bukti Sprint 2](orkhan-sprint-2-progress.md). Kolaborasi server tidak diwajibkan untuk versi tanpa login ini.

Dokumen progres lama mencatat bukti pada saat dibuat. Angka tes/build historis tidak menjadi bukti verifikasi checkout terbaru. AGENTS.md tetap berlaku: baca panduan Next.js lokal sebelum menulis kode.

## Verifikasi kelanjutan ini

- Typecheck dan `npm run build` lengkap (termasuk Prisma generate): lulus.
- Contract checks: tujuh schema v1 dan 22 schema v2 lulus.
- Python harmonisasi: 27 kasus, 26 lulus dan satu skip kondisional; mencakup handoff model worker anonim, anomali, dua periode dan kesesuaian jumlah harian.
- Suite Node terbaru: 124 kasus, 122 lulus dan dua skip integrasi native yang tidak dikonfigurasi. Enam tes baru memeriksa monitoring lokal, ekspor dan kontras.
- Playwright MCP kini berhasil: alur sintetis desktop/mobile, heatmap ke bukti asli, persistensi, koreksi, unduhan dan EN/ID lulus tanpa exception runtime. Pemeriksaan tambahan ekspor seluruh halaman dan kegagalan penyimpanan lulus. Database remote dan arsip aktif tidak diuji oleh pekerjaan ini.
