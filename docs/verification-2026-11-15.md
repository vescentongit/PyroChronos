# Verifikasi kelanjutan — 15 November 2026

Basis: branch `dev`, commit `4b8a2a5`, ditambah perubahan working tree untuk sinkronisasi dokumentasi dan perbaikan storage/cancel/layout. Tidak ada commit, push, deployment, migrasi database atau perubahan resource cloud pada pekerjaan ini.

## Perubahan dan hasil

- Dokumen aktif membedakan analisis FIRMS on-demand tanpa login dari API akun/antrean/database server legacy. Bukti historis tetap diberi tanggal; tracker Nathan P0 mengikuti status review PR #7 yang sudah tercatat.
- Kegagalan sinkron `indexedDB.open`, penulisan IndexedDB dan metadata hasil sekarang menjadi `STORAGE_UNAVAILABLE`, bukan error input. Dua regresi gagal sebelum perbaikan; tes terkait lulus sesudahnya. Hasil lengkap sebelumnya tetap tersedia bila penulisan gagal.
- Membatalkan pemuatan mengubah baris bulan yang sedang dimuat menjadi gagal/dihentikan; baris berikutnya tetap belum dimuat dan bagian sukses tetap tersimpan.
- Pemilih hasil tersimpan memakai layout field yang sudah ada. QA menemukan overflow mobile setelah riwayat hasil terbentuk; perbaikannya lulus pada viewport 390 × 844.

| Pemeriksaan | Hasil dan batas bukti |
| --- | --- |
| `npm run typecheck` | Lulus setelah build terakhir |
| `npm run check:contracts` | Lulus: v1, research-2 dan protected export manifest |
| `npm run check:frontend` | Delapan kasus lulus |
| `RESEARCH_PYTHON=/tmp/pyro-verify-venv/bin/python npm test` | 260 kasus: 232 lulus, 28 skip, nol gagal; skip tidak membuktikan acceptance native PostgreSQL |
| Python `unittest discover -s pipeline -p 'test_*.py'` | 171 kasus: 154 lulus, 17 skip, sebelum perubahan frontend; tidak ada kode Python yang diubah |
| `npm run build -- --webpack` | Build produksi lengkap lulus setelah perbaikan; server produksi dipakai pada browser QA |
| `npm run build` (Turbopack) | Tetap gagal saat CSS worker membuat port: `Operation not permitted`. Terjadi sebelum dan setelah perubahan izin lingkungan; bukan bukti kesalahan CSS |
| Browser Chromium 159, Linux, Playwright | Delapan skenario lulus, 15 request analisis, nol exception runtime; desktop 1440 × 1000 dan viewport mobile 390 × 844 pada mesin yang sama |
| Tautan Markdown lokal | 48 berkas diperiksa termasuk laporan ini; nol target hilang |
| Konfigurasi Vercel | `vercel.json` lulus schema resmi yang diambil 15 November; nama service, rewrite publik dan binding tidak berubah |
| Lint frontend | Konfigurasi Biome repository tidak mencakup berkas frontend/tes yang diubah; percobaan lint terarah memproses nol berkas dan tidak diklaim lulus |

## Browser QA yang dapat diulang

`scripts/research-on-demand-browser-check.mjs` menjalankan server produksi Next, service HTTP Python dengan respons NASA sintetis, serta Chromium dengan IndexedDB/localStorage asli. Script hanya menghentikan proses yang dibuatnya. Build aplikasi dahulu dan sediakan interpreter dengan `pipeline/requirements-dev.txt`.

Playwright adalah alat acceptance opsional, bukan dependency aplikasi. Pada sesi ini paket dan browser dipasang sementara di `/tmp`, tanpa mengubah package lock:

```sh
npm install --prefix /tmp/pyro-browser --no-save playwright
PLAYWRIGHT_BROWSERS_PATH=/tmp/pyro-browser-binaries node /tmp/pyro-browser/node_modules/playwright/cli.js install chromium
npm run build -- --webpack
PLAYWRIGHT_BROWSERS_PATH=/tmp/pyro-browser-binaries PLAYWRIGHT_MODULE=/tmp/pyro-browser/node_modules/playwright/index.mjs RESEARCH_PYTHON=/tmp/pyro-verify-venv/bin/python node scripts/research-on-demand-browser-check.mjs
```

Sesuaikan `RESEARCH_PYTHON` dengan virtualenv yang benar. Port default 3109 dapat diganti melalui `PYRO_BROWSER_PORT`. Artefak hasil pada `.cache/verification-2026-11-15/browser/result.json`, unduhan dan screenshot di folder sama bersifat lokal/ignored; tidak tersedia otomatis pada checkout baru.

Skenario: gagal bulan kedua tanpa menerbitkan hasil parsial; reload/resume hanya bulan tersisa; perbandingan dan provenance gabungan; isi CSV asli/agregat serta signature PNG; refresh seluruh bagian; cancel dan resume setelah reload; kuota IndexedDB; kuota metadata localStorage; ID/EN dan overflow viewport mobile. Respons availability/deteksi seluruhnya sintetis. Basemap eksternal diblokir dan hotspot terbaru tidak diuji live. Ini bukan bukti kepadatan sudah dimuat di atas satellite tiles, performa perangkat mobile fisik, atau acceptance peneliti.

## FIRMS live dan cloud yang belum selesai

Uji live dibatasi pada tiga rencana area kecil/satu hari: Amazon yang didukung, tanggal sebelum availability dan Kalteng yang tidak didukung. Eksekusi berhenti pada request availability pertama karena koneksi NASA gagal; tidak ada respons sukses, sehingga dua kasus berikutnya tidak dijalankan. Diagnostik tanpa key menunjukkan DNS host NASA terurai, tetapi HTTPS gagal pada transport (`OSError`, errno 101 setelah timeout). HTTPS ke Vercel berhasil pada pemeriksaan pembanding. Ini keterbatasan koneksi dari lingkungan ini, bukan bukti key salah atau layanan NASA sedang mati. Tidak ada respons sintetis yang digunakan untuk menggantikan verifikasi live.

Belum ada CLI/auth Vercel, `VERCEL_TOKEN`, link `.vercel/project.json` atau koneksi Vercel terkonfirmasi pada sesi Linux ini. Project dan Blob store dari handoff Windows tidak dianggap hilang dan tidak dibuat ulang. Schema valid tidak membuktikan secret remote, routing privat hosted, kapasitas, kuota, biaya atau deployment berhasil. Lanjutkan pemeriksaan pada project yang sudah ada setelah akses akun tersedia; tidak perlu mengaktifkan arsip global atau migrasi legacy.

Acuan resmi yang diperiksa: [FIRMS Area API](https://firms.modaps.eosdis.nasa.gov/api/area/), [availability](https://firms.modaps.eosdis.nasa.gov/api/data_availability/), [Vercel service configuration](https://vercel.com/docs/services/config-reference), [bindings](https://vercel.com/docs/services/bindings), [schema Vercel](https://openapi.vercel.sh/vercel.json) dan [Services pricing/limits](https://vercel.com/docs/services/pricing). Ketersediaan Services pada suatu plan bukan bukti bahwa penggunaan project tertentu tetap dalam kuota gratis.

Review manusia Nathan/Bagas, demonstrasi hasil live, uji peneliti dan perluasan domain ilmiah tetap terbuka. Kalteng/Papua tetap memiliki estimasi `null` sesuai evaluasi; eksperimen QA berkeputusan no-go, dan revisi NRT→standard belum terukur.
