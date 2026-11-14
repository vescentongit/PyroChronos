# Keputusan dan status aktif — 15 November 2026

Dokumen ini mengesampingkan persyaratan login, Google OAuth, akun individual, kolaborasi workspace server dan arsip global permanen sebagai prasyarat pada dokumen/rencana lama. Versi aktif memakai analisis historis on-demand dan penyimpanan pengguna lokal tanpa login.

## Penyimpanan dan akses

UI memakai workspace lokal, localStorage dan IndexedDB. Area, hasil, riwayat serta laporan disimpan pada browser perangkat yang digunakan. Menghapus data browser dapat menghapus catatan tersebut. Sinkronisasi perangkat, keanggotaan tim, identitas terverifikasi dan penugasan lintas pengguna belum tersedia; nama pemeriksa lokal tidak boleh diklaim sebagai identitas akun terverifikasi.

API Auth.js/Google, workspace server dan laporan koordinator dipertahankan sebagai legacy. UI aktif tidak membutuhkannya. Data server terdahulu tetap disimpan; menghilangkan login dari UI tidak memberi akses publik ke catatan privat lama. Kontrak v2 server tetap berlaku bagi endpoint legacy tersebut, tetapi bukan prasyarat penggunaan web sekarang.

## Analisis aktif

Browser mengirim polygon dan periode secara eksplisit ke `/api/local-research`. Server memvalidasi origin, schema dan geometri, lalu Python menyiapkan snapshot FIRMS Area API untuk area/periode tersebut dan memprosesnya dalam satu pemanggilan. Fingerprint mengikat checksum respons yang benar-benar diproses, termasuk referensi dan respons sukses tanpa observasi. Tidak diperlukan arsip global permanen. `RESEARCH_DATA_DIR` tetap memilih dataset lokal; adapter Blob lama dipertahankan sebagai opsi ketika dataset lokal dan key on-demand tidak dikonfigurasi.

Browser memuat bulan primer dan pembanding secara berurutan, menyimpan setiap bagian yang berhasil di IndexedDB, lalu menggabungkannya menjadi kalender/hasil lengkap dengan manifest per bagian. Jika gagal atau dihentikan, bagian berikutnya tetap belum dimuat; Analisis area melanjutkan bagian yang belum tersimpan, termasuk sesudah reload. Pilihan ambil ulang mengunduh ulang semua bagian untuk memeriksa revisi NASA. Hasil lengkap sebelumnya tetap terpisah sampai seluruh pilihan baru selesai. Cache bukan janji data NASA selalu terbaru; umur data mengikuti timestamp snapshot.

Hanya MODIS_SP dan VIIRS_SNPP_SP dipakai untuk riset historis; NRT tidak disambung secara diam-diam. Ketersediaan sumber diambil dari NASA sebelum kueri; bbox antimeridian dipecah, titik difilter polygon tepat dan overlap dideduplikasi. Cakupan mengikuti interval request sukses, bukan tanggal titik pertama/terakhir. Jendela sukses dengan nol observasi, sumber tidak tersedia, request gagal dan bagian belum dimuat dibedakan. Riwayat baseline hanya diambil untuk bulan primer pada domain model yang mendukung, sesuai jendela tahun yang dipilih. Seluruh referensi yang tersedia dalam kebijakan tersebut diminta; kegagalan request tidak dianggap tahun kosong.

Batas per bagian: request input 100 KB, response hosted 4 MB, panggilan producer 120 detik dan budget fetch 95 detik (maksimum enam request FIRMS paralel, 512 request, 24 MB respons mentah, 150.000 observasi snapshot termasuk referensi). Satu hasil gabungan dibatasi 32 MB bagian dan 100.000 observasi primer/pembanding; melampaui batas gagal eksplisit tanpa membuang bukti. Browser dapat mencapai kuota penyimpanan lebih dahulu. Tidak ada SLA kalender multidekade atau batas konkurensi global lintas instance. Hasil dan laporan tetap lokal di perangkat.

Konfigurasi Vercel mempertahankan `app` publik dan `pipeline` internal melalui binding. `FIRMS_MAP_KEY` diperlukan pada Python untuk analisis historis dan pada Next.js untuk proxy hotspot terbaru. `PIPELINE_URL` dihasilkan Vercel. Jadwal penerbit arsip global dihapus; workflow arsip lama hanya manual dan tetap gated. Tidak ada deployment atau operasi resource cloud dilakukan oleh migrasi ini. [Panduan deployment dan verifikasi](vercel-deployment.md).

Peta density memakai gradasi hijau → kuning → oranye → merah (rendah → tinggi), radius kernel 4–14 px dan opacity 0,6; fallback 3–10 px. Label ID/EN menjelaskan kedua ujung skala dan bahwa density bukan tingkat bahaya. Titik asli serta skala kalender/anomali tetap memiliki arti masing-masing.

Jalur anonim kini memuat model harmonisasi dan kebijakan baseline dari `pipeline/models`. Kalender tahun × bulan membuka detail harian; ringkasan perbandingan menampilkan durasi, estimasi, laju per hari dan persentase total bila dua estimasi lengkap dengan pembanding positif. Tabel anomali menampilkan median, delta, persentil dan tahun referensi aktual. Hasil lama di browser tidak dihitung ulang otomatis.

Harmonisasi retrospektif memakai VIIRS S-NPP ke skala MODIS, model ratio_global. Estimasi ditahan di luar domain tervalidasi, termasuk Kalteng/Papua. Minimum referensi default empat tahun valid dalam sepuluh tahun sebelumnya. Sumber tanpa cakupan menghasilkan no_data; request gagal menghasilkan error, bukan no_data atau nol. Tanpa model/dukungan estimasi tetap null. Data mentah tidak menjadi titik harmonisasi sintetis.

## Status sprint dan sisa pekerjaan

Nathan P0 telah tercatat selesai/direview setelah PR #7; P1 memiliki implementasi dan evaluasi, review serta integrasi menyeluruh tetap perlu bukti. Checklist lama yang menyebut OAuth sebagai acceptance digantikan keputusan tanpa login ini. Review manusia tidak dianggap terjadi hanya karena implementasi atau tes tersedia.

Orkhan P1 O1–O4 kini memiliki implementasi lokal: kalender/perbandingan/anomali, bukti asli/lokasi tersimpan, penugasan/pemeriksaan/koreksi dan ekspor CSV/JSON/PNG. Acceptance browser sintetis desktop/mobile serta review finish independen lulus. Review manusia Nathan dan demonstrasi dataset aktif masih terbuka. [Bukti Sprint 2](orkhan-sprint-2-progress.md). Kolaborasi server tidak diwajibkan untuk versi tanpa login ini.

Dokumen progres lama mencatat bukti pada saat dibuat. Angka tes/build historis tidak menjadi bukti verifikasi checkout terbaru. AGENTS.md tetap berlaku: baca panduan Next.js lokal sebelum menulis kode.

Sprint 3 Orkhan O1/O3 otomatis kini memiliki benchmark sintetis sebelum/sesudah, cache satu bundle aktif, dedup linear dan pemeriksaan edge ID/EN. [Laporan Sprint 3](orkhan-sprint-3-progress.md). O2 belum dijalankan karena peneliti belum tersedia menurut pengguna; O4 dan review manusia tetap terbuka. Tidak ada klaim performa mobile fisik, SLA global atau sustained 60 FPS.

## Bukti historis — checkout Orkhan, 13 November 2026

Daftar berikut adalah bukti sesi lama, bukan verifikasi commit on-demand `4b8a2a5` atau checkout setelahnya.

- Typecheck dan `npm run build` lengkap (termasuk Prisma generate): lulus.
- Contract checks: tujuh schema v1 dan 22 schema v2 lulus.
- Python harmonisasi: 27 kasus, 26 lulus dan satu skip kondisional; mencakup handoff model worker anonim, anomali, dua periode dan kesesuaian jumlah harian.
- Suite Node terbaru pada checkout Orkhan: 127 kasus, 125 lulus dan dua skip integrasi native yang tidak dikonfigurasi. Tes mencakup monitoring lokal, ekspor, kontras dan cache bundle.
- Playwright MCP kini berhasil: alur sintetis desktop/mobile, heatmap ke bukti asli, persistensi, koreksi, unduhan dan EN/ID lulus tanpa exception runtime. Pemeriksaan tambahan ekspor seluruh halaman dan kegagalan penyimpanan lulus. Database remote dan arsip aktif tidak diuji oleh pekerjaan ini.

## Bukti commit on-demand — 14 November 2026

Handoff commit `4b8a2a5` mencatat typecheck/kontrak lulus; Node 259 kasus (231 lulus, 28 skip), Python 171 kasus (154 lulus, 17 skip). Ini catatan handoff, bukan pengujian ulang 15 November. Production build Linux belum terverifikasi: Turbopack gagal membuat port lokal, termasuk setelah eskalasi. Build Windows sebelumnya bukan bukti build commit ini. Integrasi baru memakai respons NASA sintetis, bukan layanan live atau routing hosted.

## Verifikasi terbaru dan gerbang versi aktif — 15 November 2026

[Bukti, cara mengulang dan batas pengujian](verification-2026-11-15.md). Bug sweep lanjutan memperbaiki klasifikasi error metadata storage, pembatalan saat commit hasil akhir, analisis tersembunyi ketika memilih hasil dashboard, race pergantian hasil cepat, timeout FIRMS/transport HTTP dan penutupan stream respons gagal. Tes regresi mereproduksi kegagalan sebelum perbaikan. Selector QA editor koordinat dan pelaporan status setiap run tetap diperbaiki dari kelanjutan awal. Hasil lengkap sebelumnya tetap dipertahankan ketika storage atau request gagal. Acceptance manusia dan hosted tetap terbuka.

- [x] Dokumen aktif disinkronkan; rencana worker/database server tetap scope legacy.
- [x] Build default Turbopack dan Webpack lengkap lulus pada perubahan aplikasi final; typecheck, kontrak dan delapan frontend checks lulus. Node: 245 lulus/28 skip; Python: 158 lulus/17 skip.
- [x] Browser QA sintetis lengkap pada server produksi: 18 checkpoint, 20 request analisis, nol exception runtime. Mencakup cancel/reload/resume/refresh/storage/ekspor, workspace hasil tersimpan, laporan dan follow-up polygon, Kalteng dengan estimasi null, tanggal tanpa cakupan, error jaringan, pergantian hasil saat request berjalan, cancel saat commit akhir, kuota metadata area serta viewport ID/EN. Artefak lokal di `.cache/verification-2026-11-15/browser/`.
- [x] Bukti schema resmi `vercel.json` berasal dari sesi Linux sebelumnya; konfigurasi tidak diubah pada bug sweep ini. Verifikasi remote tetap terbuka.
- [ ] FIRMS live: request availability pada sesi Linux sebelumnya gagal pada koneksi HTTPS. Koneksi NASA belum diuji ulang pada kelanjutan Windows; belum ada respons live yang diproses. Key tidak disalahkan tanpa bukti.
- [ ] Periksa project hosting yang sudah ada, secret, binding/routing privat, kapasitas/kuota dan acceptance Preview. Akses akun/link Vercel belum tersedia pada sesi Linux; jangan membuat resource pengganti secara otomatis.
- [ ] Review manusia Nathan/Bagas, demonstrasi dataset nyata, uji peneliti serta mobile fisik/screen reader. Domain ditolak tidak dibuka hanya karena data tersedia.
