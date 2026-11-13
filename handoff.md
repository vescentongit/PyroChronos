# PyroChronos handoff — 13 November 2026

Mulai dari AGENTS.md, docs/current-status.md, README.md dan product.md. Semua dokumen proyek memiliki pemberitahuan keputusan aktif; isi rencana lama tetap dipertahankan sebagai konteks historis.

## Keputusan pengguna

Seluruh fitur web harus bisa diakses dan digunakan tanpa login. Google OAuth bukan prasyarat. UI memakai workspace lokal, localStorage dan IndexedDB; pemrosesan ilmiah tetap berjalan di server. API akun/workspace server dan data privat lama dipertahankan sebagai legacy, bukan dibuka ke publik. Jangan meminta pengguna login untuk menyelesaikan acceptance UI lokal.

## Kelanjutan sprint

Worker anonim kini memasok model dan baseline ke producer serta estimasi harian. Versi producer lokal research-harmonized-1; worker legacy research-raw-1 tetap mengikuti input lamanya. Komponen research-summary.tsx menampilkan kalender tahun × bulan, perbandingan dua periode dengan durasi/laju, dan anomali beserta tahun referensi/domain. Data lama IndexedDB tidak dihitung ulang otomatis.

Kalteng/Papua tidak didukung model terbitan: estimasi null merupakan hasil yang benar. Model hanya memiliki evaluasi retrospektif pada domain tertentu. Arsip lokal yang kosong menghasilkan no_data.

Build lengkap, typecheck, contract checks, tes harmonisasi dan tes API anonim terkait lulus. Rincian ada di docs/current-status.md. Playwright MCP gagal memulai Chrome; QA visual perubahan baru belum selesai.

## Pekerjaan berikutnya

Lanjutkan acceptance kalender/perbandingan pada desktop/mobile, detail dan penandaan lokasi lokal, pemeriksaan/koreksi lokal serta ekspor CSV/PNG. Data dan metadata semua keluaran harus menunjuk hasil/area/periode/metode yang sama. Review manusia dan checklist sprint penuh tetap terbuka. Persyaratan kolaborasi workspace server lama perlu dipetakan ke alur lokal; jangan mengarang sinkronisasi atau identitas terverifikasi.

Tidak ada migrasi atau penulisan database remote dalam kelanjutan ini. Jangan mencetak .env atau mengganti/menghapus dataset pengguna. Periksa git status sebelum mengedit; perubahan belum di-commit.
