# Verifikasi globe FIRMS - 15 November 2026

## Status terbaru: snapshot statis sesuai permintaan pengguna

Implementasi live di bawah digantikan. Home sekarang mengimpor `src/data/globe-hotspots.json` langsung ke aplikasi. Tidak ada request `/api/hotspots`, interval refresh, kebutuhan API key atau unduhan NASA saat Home dibuka. Snapshot tidak berubah mengikuti tanggal perangkat.

Data nyata berhasil diambil sekali dari layer publik NASA FIRMS yang dipublikasikan [Esri Living Atlas](https://www.arcgis.com/home/item.html?id=dece90af1a0242dcbf0ca36d30276aa3), pemilik `esri_livefeeds2`, atribusi NASA. Unduhan CSV langsung NASA tetap gagal koneksi; sumber alternatif ini berhasil HTTP 200.

- Periode tetap: `2026-11-08T00:00:00Z` sampai sebelum `2026-11-15T00:00:00Z` (8–14 November UTC).
- Filter satelit aktual provider: `satellite = 'N20'` (NOAA-20). Nama field/nilai diverifikasi dari metadata dan statistik respons, bukan diasumsikan dari deskripsi lama.
- Respons agregasi global: 5.986 bin 1°, 372.148 deteksi. Tidak ada `error` atau `exceededTransferLimit`; jumlah bin di bawah batas 16.000 record.
- Data dibundel ulang sebagai 2.379 bin 2°, jumlah tetap tepat 372.148; ukuran JSON 92.634 byte. Posisi menunjukkan pusat area, bukan koordinat setiap observasi asli.
- Observasi pertama `2026-11-08T00:09:00Z`; terakhir `2026-11-14T23:39:00Z`.
- JSON memuat URL sumber/provider, filter, periode, serta SHA-256 respons asal. Artefak unduhan dan konversi lokal berada di `.cache/globe-snapshot/`; tidak otomatis ikut checkout.

Label periode, status snapshot tetap dan atribusi terlihat di Home. Titik muncul sejak awal, dengan ukuran mengikuti globe di mobile. Animasi zoom, drag, keyboard dan reduced motion dipertahankan. Klik membuka peta NRT terkini, yang tetap memerlukan koneksi server ke FIRMS; tanggal snapshot Home tidak diklaim sebagai tanggal data peta tujuan. Snapshot Home ini tidak menjadi input analisis atau validasi model.

Verifikasi perubahan snapshot:

- Build produksi Turbopack dan typecheck lulus.
- `node --test scripts/frontend-checks.mjs scripts/hotspots-checks.mjs tests/firms-service.test.mjs`: 23 lulus, termasuk periode tujuh hari, cakupan empat belahan dunia, jumlah deteksi persis, serta dukungan parser/proxy peta yang sudah ada.
- `scripts/globe-browser-check.mjs` menggunakan snapshot nyata yang dibundel; seluruh HTTPS eksternal diblokir dan API peta tujuan dibuat gagal secara sintetis. Empat pemeriksaan lulus tanpa error runtime: titik terlihat tanpa API, zoom dan koordinat tujuan, desktop/tablet/mobile serta touch/keyboard, dan data tetap sama setelah simulasi tiga hari. Screenshot dan hasil final berada di `.cache/globe-snapshot-browser/`.
- Tidak ada deployment atau uji mobile fisik. Koneksi live pada peta tujuan tidak dibuktikan oleh tes snapshot.

Pemeriksaan tambahan pada server lama port 3000 menemukan HTML sudah berisi jumlah/tanggal snapshot, tetapi globe tetap pada “Preparing the globe…” dalam konteks browser baru. Tidak ada exception runtime atau respons HTTP gagal yang tertangkap pada pemeriksaan singkat tersebut; penyebab server lama belum disimpulkan. Server itu tidak dihentikan. Build produksi baru pada port 3150 lolos browser QA dan dapat dipakai sebagai preview lokal; port 3000 perlu restart/diagnosis proses tersendiri bila masih tertahan.

## Catatan implementasi live sebelumnya - digantikan

Home mengganti fixture wilayah dengan `/api/hotspots` untuk seluruh dunia (`-180,-90,180,90`), sumber `VIIRS_NOAA20_NRT`, 24 jam. Semua bin respons digambar, bukan hanya preview 30 observasi. Jumlah deteksi dipertahankan; posisi bin merupakan agregasi area. Key tetap dibaca server. Proxy, batas unduh, cache sepuluh menit dan klasifikasi kegagalan upstream yang sudah ada tetap digunakan.

API area NASA mendukung batas seluruh dunia atau `world`, dengan rentang hari satu sampai lima. Proxy meminta dua hari kalender kemudian memfilter jendela bergulir 24 jam. [Dokumentasi NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/). Tidak ada backfill atau arsip global permanen baru.

Klik titik atau permukaan globe memutar/zoom ke lokasi selama 650 ms sebelum navigasi ke `/simulation?lng=…&lat=…`. Peta mulai di lokasi itu. Keyboard Enter/Space membuka pusat globe; reduced motion langsung berpindah. Drag dan klik di luar bola tidak membuka peta. Halaman tetap menyediakan tautan peta biasa.

Pemeriksaan lokal pada perubahan ini:

- `npm run build`: produksi Turbopack lulus.
- `npm run typecheck`: lulus.
- `node --test scripts/frontend-checks.mjs scripts/hotspots-checks.mjs tests/firms-service.test.mjs`: 23 lulus. Meliputi cakupan/source/window global, jumlah bin, link koordinat negatif/antimeridian/polar, penolakan parameter rusak serta cache, concurrency dan error transport proxy.
- `npm run check:contracts`: lulus.
- Browser produksi: `scripts/globe-browser-check.mjs`; enam pemeriksaan lulus tanpa error runtime, selesai `2026-11-15T00:39:03.207Z`. Respons NASA sintetis dan basemap eksternal diblokir. Artefak lokal `.cache/globe-browser/` berisi hasil terstruktur dan screenshot desktop 1440, tablet 768, mobile 320 serta zoom. Pengujian meliputi titik/count global dengan preview kosong, toggle, hover, drag, klik, koordinat peta tujuan, kondisi kosong/gagal/stale, retry, touch dan keyboard reduced motion. Hasil final browser dicatat pada JSON dengan waktu mulai/selesai; kegagalan otomasi awal bukan bukti acceptance final.
- Regresi produksi `scripts/research-on-demand-browser-check.mjs`: 20 pemeriksaan lulus, 20 request analisis sintetis, tanpa exception runtime. Cakupan termasuk hasil tersimpan, kuota storage, cancel/resume, laporan lapangan, area follow-up, raw count domain tanpa estimasi, tanggal tanpa cakupan dan navigasi mobile tanpa akun.

Penyelesaian navigasi memiliki timer yang dibersihkan saat unmount, terpisah dari loop rotasi yang dapat berhenti saat frame Canvas ditahan browser. Penyelesaian frame dan timer memanggil tujuan paling banyak sekali. Browser QA juga menguji pembaruan otomatis setelah sepuluh menit dan navigasi saat frame animasi dihentikan.

Jalankan setelah build, dengan `PLAYWRIGHT_MODULE` menunjuk instalasi Playwright dan `PLAYWRIGHT_BROWSERS_PATH` menunjuk browser lokal. Script memakai port 3150 (atau `GLOBE_QA_PORT`) dan menghentikan server yang dibuatnya. Tidak menggunakan data browser pengguna atau key NASA untuk respons sintetis.

Satu permintaan live terbatas melalui proxy produksi lokal dicoba dari sandbox, lalu dicoba kembali dengan eskalasi. Keduanya menghasilkan HTTP 503, `NETWORK_ERROR`, tanpa respons data NASA berhasil. Hasil aman tersimpan pada `.cache/globe-browser/live-result.json`. Ini tidak membuktikan key salah atau NASA sedang bermasalah; pengujian sintetis tidak membuktikan konektivitas live. Waktu window dan retrieval terlihat di UI; kegagalan pertama tidak menampilkan titik demo, sedangkan kegagalan pembaruan mempertahankan snapshot terakhir dengan label stale.

Belum ada deployment, verifikasi hosting, pemeriksaan perangkat mobile fisik atau screen reader. Acceptance ilmiah dan batas model pada `current-status.md` tetap berlaku.
