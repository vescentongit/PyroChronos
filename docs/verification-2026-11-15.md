# Verifikasi kelanjutan — 15 November 2026

## Bug sweep lanjutan — hasil terbaru

Basis tetap `26365c7`, dengan perubahan working tree dari kelanjutan Windows dan bug fixes berikut. Tidak ada commit, push, deployment atau operasi resource cloud. Kegagalan berikut direproduksi melalui tes regresi sebelum perbaikannya:

- **Storage metadata:** kegagalan membaca/membuat workspace, menyimpan area dan memilih hasil tersimpan sebelumnya meneruskan DOMException biasa. UI dapat melabelinya sebagai input/jaringan bermasalah. Akses metadata kini menghasilkan `STORAGE_UNAVAILABLE`; workspace tersimpan juga divalidasi dengan schema agar metadata rusak tidak membuat analisis diam-diam tidak dapat dijalankan. Metadata yang rusak tidak dihapus otomatis.
- **Pembatalan saat penyimpanan akhir:** membatalkan analisis ketika transaksi IndexedDB hasil gabungan sedang selesai sebelumnya masih dapat menerbitkan hasil itu sebagai pilihan aktif. Signal kini diperiksa kembali setelah transaksi dan sebelum memperbarui history/pilihan. Bukti bagian yang sudah disimpan tetap dipertahankan.
- **Analisis tersembunyi:** memilih hasil dari dashboard sebelumnya tidak membatalkan analisis historis yang masih berjalan di halaman tersembunyi. Event pemilihan sekarang membatalkan request, mengganti generasi pekerjaan dan menghentikan baris loading. Pemulihan hasil yang sudah kedaluwarsa juga diabaikan.
- **Pergantian hasil cepat:** pembacaan hasil A yang lambat sebelumnya dapat menimpa pilihan B yang lebih baru. Hanya pemanggilan pemilihan terbaru yang boleh memperbarui pilihan aktif dan menerbitkan notifikasi.
- **Timeout dan error transport:** budget FIRMS yang sudah habis serta timeout saat menunggu request paralel kini menjadi `TIMEOUT`. Adapter HTTP Next → Python juga memetakan koneksi putus/aliran respons gagal menjadi `NETWORK_ERROR` dan timeout menjadi `TIMEOUT`, sambil mempertahankan kode publik lainnya dan pembatalan.
- **Resource respons HTTP:** respons error urllib ditutup sebelum melempar kode publik, sehingga stream respons gagal tidak tertinggal terbuka. Regresi memastikan stream ditutup; ResourceWarning HTTPError sintetis dari run sebelumnya tidak muncul pada suite Python terbaru.

| Pemeriksaan final | Hasil |
| --- | --- |
| Suite Node `npm test` | 273 kasus: **245 lulus, 28 skip**, nol gagal |
| Python `unittest discover -s pipeline -p 'test_*.py'` | 175 kasus: **158 lulus, 17 skip**, nol gagal |
| Typecheck, kontrak dan frontend checks | Lulus; delapan frontend checks |
| Build default Turbopack | Lulus lengkap setelah perubahan aplikasi final |
| Build Webpack | Lulus lengkap setelah perubahan aplikasi final |
| Lint terarah | Biome pada `research-producer.ts` dan Ruff pada dua berkas Python yang diubah lulus; konfigurasi Biome tetap tidak mencakup seluruh frontend |
| QA browser produksi diperluas | **18 checkpoint, 20 request analisis sintetis, nol exception runtime** |

Skenario browser baru memverifikasi pemilihan hasil dashboard saat request tertahan, pembatalan pada event complete transaksi IndexedDB hasil akhir, serta kuota metadata area sebelum fetch analisis. Tes Node menahan pembacaan hasil lama untuk memverifikasi urutan pilihan, dan menyuntikkan kegagalan storage/transport. Snapshot NASA tetap sintetis; tes yang skip tidak dianggap lulus. Ini merupakan pengujian terhadap jalur yang dicakup, bukan bukti bahwa seluruh kemungkinan bug telah dieliminasi.

`browser/result.json` adalah status run terbaru, dengan build ID dan timestamp. Bukti run lengkap pada build default Turbopack disalin ke `browser-turbopack.json` sebelum mengulang QA pada build Webpack. `failure.json/html/png` sekarang menyimpan reproduksi race analisis tersembunyi sebelum perbaikan; artefak tersebut bersifat historis. Log suite terbaru tetap `node-current.log` dan `python-current.log`. Bukti sesi awal berikut dipertahankan dengan angka dan cakupan aslinya.

## Kelanjutan Windows awal — sebelum bug sweep

Basis saat mulai: `D:\NASA`, branch `dev`, HEAD `26365c7` (`interrupted`), working tree bersih. Bug fixes sesi sebelumnya sudah berada di commit tersebut. Sesi ini mengubah skrip QA dan dokumentasi; tidak ada perubahan kode aplikasi, commit, push, deployment, request NASA live atau operasi cloud. Catatan Linux di bawah tetap disimpan sebagai bukti historis.

Kegagalan editor koordinat berhasil direproduksi pada build produksi: sebelas checkpoint selesai sebelum `getByLabel('Longitude, latitude', { exact: true })` timeout. HTML menunjukkan `<details>` terbuka dan textarea terisi. Pemeriksaan terisolasi terhadap markup yang sama menghasilkan nol kecocokan label exact, tetapi satu textbox dengan nama aksesibilitas `Longitude, latitude`. Teks koordinat di dalam textarea ikut terbaca oleh pencocokan teks label Playwright. Selector QA kini memakai `getByRole('textbox', { name: 'Longitude, latitude', exact: true })`; perilaku dan markup aplikasi tidak perlu diubah.

`result.json` kini ditulis dengan status `running` saat mulai, lalu `passed` atau `failed`, timestamp mulai/selesai, build ID, checkpoint, jumlah request dan exception runtime. Run gagal tidak lagi meninggalkan hasil sukses lama sebagai hasil terbaru. Dua pemeriksaan negatif mengonfirmasi bahwa browser executable yang tidak tersedia dan import Playwright yang tidak tersedia menghasilkan `status: failed`, `passed: false` dan pesan error. Sesudahnya suite lengkap dijalankan lagi dengan konfigurasi normal.

| Pemeriksaan sesi Windows | Hasil dan batas bukti |
| --- | --- |
| `npm run build -- --webpack` | Lulus lengkap, termasuk Prisma generate; tidak menjalankan migrasi |
| `npm run build` | Build default Turbopack lulus lengkap pada Windows; keterbatasan Linux sebelumnya tetap merupakan catatan lingkungan lama |
| `npm run typecheck` | Lulus |
| `npm run check:contracts` | Lulus: tujuh schema v1, 22 schema research v2 dan protected export manifest |
| `npm run check:frontend` | Delapan kasus lulus |
| `npm test` dengan `RESEARCH_PYTHON` virtualenv | 263 kasus: 235 lulus, 28 skip, nol gagal; skip tidak menjadi bukti acceptance native PostgreSQL |
| Python `unittest discover -s pipeline -p 'test_*.py'` | 172 kasus: 155 lulus, 17 skip, nol gagal; ada ResourceWarning dari HTTPError sintetis pada tes transport |
| QA produksi Chromium 159 / Playwright 1.65.1 | 15 checkpoint lulus, 18 request analisis sintetis, nol exception runtime; build default Turbopack dipakai oleh server QA |
| Pelaporan kegagalan QA | Kegagalan launch browser dan import dependency mengganti hasil sebelumnya menjadi gagal |

Node `v24.11.0`, Python `3.14.0`. Pemeriksaan browser mencakup seluruh skenario sebelumnya, dashboard/perbandingan sensor dari hasil tersimpan, penugasan/pemeriksaan/koreksi/status terminal setelah reload, follow-up polygon, Kalteng dengan jumlah asli dan estimasi null, tanggal tanpa cakupan dengan rentang availability sumber, serta error jaringan yang mempertahankan hasil lengkap sebelumnya. Viewport desktop 1440 × 1000 dan mobile 390 × 844; label Indonesia dan pemeriksaan overflow lulus. Screenshot mobile juga diperiksa secara visual.

Artefak lokal/ignored: `.cache/verification-2026-11-15/browser/result.json` adalah status run terbaru; `failure.json/html/png` menyimpan reproduksi selector sebelum perbaikan, sehingga keberadaannya tidak membatalkan run terbaru yang lulus. Log tes ada di `node-current.log` dan `python-current.log` pada direktori verifikasi; bukti negatif pelaporan ada di `report-failure-check.json` dan `report-import-failure-check.json`. Semua ini perlu disalin terpisah bila berpindah checkout.

### Mengulang pada PowerShell

Dependensi pengujian dan browser dipasang di direktori temp, tanpa mengubah dependency aplikasi atau lockfile:

```powershell
python -m venv "$env:TEMP\pyro-verify-venv"
& "$env:TEMP\pyro-verify-venv\Scripts\python.exe" -m pip install -r pipeline/requirements-dev.txt
npm.cmd install --prefix "$env:TEMP\pyro-browser" --no-save playwright@1.65.1
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:TEMP\pyro-browser-binaries"
node "$env:TEMP\pyro-browser\node_modules\playwright\cli.js" install chromium
$env:PLAYWRIGHT_MODULE = 'file:///' + ($env:TEMP -replace '\\','/') + '/pyro-browser/node_modules/playwright/index.mjs'
$env:RESEARCH_PYTHON = "$env:TEMP\pyro-verify-venv\Scripts\python.exe"
npm.cmd run build
node scripts/research-on-demand-browser-check.mjs
```

FIRMS live, basemap eksternal, routing/secret hosting, performa mobile fisik, screen reader dan review peneliti tetap belum diverifikasi oleh QA sintetis ini. Tidak ada perluasan domain model; estimasi Kalteng/Papua tetap nullable. Catatan transport NASA dan akses cloud berikut berasal dari sesi Linux sebelumnya, bukan pemeriksaan ulang koneksi atau akun Windows.

## Catatan sesi Linux sebelumnya — historis

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
