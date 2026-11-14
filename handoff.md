# PyroChronos handoff — 13 November 2026

Mulai dari AGENTS.md, docs/current-status.md, README.md dan product.md. Semua dokumen proyek memiliki pemberitahuan keputusan aktif; isi rencana lama tetap dipertahankan sebagai konteks historis.

## Keputusan pengguna

Seluruh fitur web harus bisa diakses dan digunakan tanpa login. Google OAuth bukan prasyarat. UI memakai workspace lokal, localStorage dan IndexedDB; pemrosesan ilmiah tetap berjalan di server. API akun/workspace server dan data privat lama dipertahankan sebagai legacy, bukan dibuka ke publik. Jangan meminta pengguna login untuk menyelesaikan acceptance UI lokal.

## Kelanjutan sprint

Worker anonim kini memasok model dan baseline ke producer serta estimasi harian. Versi producer lokal research-harmonized-1; worker legacy research-raw-1 tetap mengikuti input lamanya. Komponen research-summary.tsx menampilkan kalender tahun × bulan, perbandingan dua periode dengan durasi/laju, dan anomali beserta tahun referensi/domain. Data lama IndexedDB tidak dihitung ulang otomatis.

Kalteng/Papua tidak didukung model terbitan: estimasi null merupakan hasil yang benar. Model hanya memiliki evaluasi retrospektif pada domain tertentu. Arsip lokal yang kosong menghasilkan no_data.

O1–O4 lokal kini tersedia: kalender/perbandingan/anomali, heatmap zoom → titik asli, lokasi persisten, penugasan/pemeriksaan/koreksi dan ekspor CSV/JSON/PNG. CSV kosong memiliki baris recordType=metadata; bukan observasi sintetis. Build lengkap, typecheck, kontrak dan suite Node terbaru lulus (122 pass, dua skip native). Playwright MCP berhasil pada context terisolasi desktop/mobile dan alur sintetis penuh; review finish independen ship. Rincian: docs/orkhan-sprint-2-progress.md. Ini bukan review manusia Nathan atau validasi dataset aktif.

## Pekerjaan berikutnya

Sprint 3 O1/O3 otomatis kini sudah dikerjakan: benchmark 20.000 titik/312 bulan/500 vertex, cache satu bundle aktif, Set dedup, memo panel serta normalisasi warna pecahan. Bukti dan cara mengulang ada di docs/orkhan-sprint-3-progress.md; artefak lokal .cache/sprint3-acceptance. Build dan 125 tes Node lulus (dua native skip), acceptance edge ID/EN dan regresi Sprint 2 lulus. Pengguna menyatakan peneliti belum tersedia dan memilih pengujian otomatis; O2 tetap terbuka. Siapkan review Nathan, demonstrasi dataset aktif dan O4 integrasi/reproduksibilitas/kesiapan rilis lintas tim. Jangan mengarang sinkronisasi, identitas terverifikasi, cakupan arsip atau validasi domain.

Tidak ada migrasi atau penulisan database remote dalam kelanjutan ini. Jangan mencetak .env atau mengganti/menghapus dataset pengguna. Periksa git status sebelum mengedit; perubahan belum di-commit.
