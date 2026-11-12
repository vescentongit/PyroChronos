# Data FIRMS dan kalender global (Nathan, Sprint 1)

> **Fondasi producer, belum consumer riset v2.** Draft calendar-1 di bawah masih memakai pusat grid 0,25 derajat dan pembanding semua tahun; itu belum memenuhi polygon tepat, detail harian, atau referensi bergerak 10 tahun. Target baru adalah [API v2](../contracts/api-v2.md), dengan hipotesis skala setara MODIS yang harus divalidasi. Pekerjaan adaptasi: R2-P0-N1 sampai N4 dan R2-P1-N1 sampai N4 pada [sprint Nathan](../../tasks/Nathan/SPRINT-1-P0.md).

Versi katalog: `firms-catalog-2`. Grid: `grid-0.25deg-monthly-1`. Kalender: `calendar-1` (draft, belum kontrak tim).

Keputusan tim (10 Nov 2026): **titik api dan kalender bersifat global**. Pengguna dapat memilih area mana pun; Kalimantan Tengah (`kalteng`) dan Papua Selatan (`papua`) tetap menjadi area unggulan (*featured*) yang di-highlight, bukan batas cakupan.

| Modul | Fungsi |
|---|---|
| [firms_catalog.py](../../pipeline/firms_catalog.py) | Feed, lokasi arsip, area unggulan, bbox `world`/kustom (termasuk antimeridian) |
| [firms_parse.py](../../pipeline/firms_parse.py) | Parser/validator baris FIRMS (batch API maupun streaming arsip) |
| [firms_ingest.py](../../pipeline/firms_ingest.py) | Unduh API area (NRT/terbaru) untuk area apa pun → raw batch + manifest |
| [firms_archive.py](../../pipeline/firms_archive.py) | Unduh arsip tahunan global → store deteksi asli + grid bulanan 0,25° (agregat kasar) |
| [firms_calendar.py](../../pipeline/firms_calendar.py) | Kalender bulanan + median historis + anomali untuk area apa pun |
| [detection_store.py](../../pipeline/detection_store.py) | Store deteksi asli per sumber dan bulan, dibagi ubin 5° (format `pcd1`) |
| [area_query.py](../../pipeline/area_query.py) | Kueri polygon bebas (lubang, antimeridian) dan irisan tanggal inklusif UTC |
| [area_counts.py](../../pipeline/area_counts.py) | Count mentah per sumber, cakupan eksplisit, dan manifest analisis |
| [research_adapter.py](../../pipeline/research_adapter.py) | Adapter producer → payload `research-2` (result, daily page, detections page) |

## Feed

| ID | Sensor | Platform | Resolusi nominal | Proses | Arsip tahunan | Peran |
|---|---|---|---|---|---|---|
| `MODIS_SP` | MODIS | Terra/Aqua | 1 km | standard | `modis_{tahun}` (mulai Nov 2000, terverifikasi) | Riwayat panjang kalender |
| `MODIS_NRT` | MODIS | Terra/Aqua | 1 km | NRT | — | Kondisi terbaru |
| `VIIRS_SNPP_SP` | VIIRS | Suomi NPP | 375 m | standard | `viirs-snpp_{tahun}` (2012 ada, terverifikasi) | Seri overlap untuk evaluasi harmonisasi; target acuan produk setara MODIS |
| `VIIRS_SNPP_NRT` | VIIRS | Suomi NPP | 375 m | NRT | — | Kondisi terbaru |
| `VIIRS_NOAA20_SP` | VIIRS | NOAA-20 | 375 m | standard | `viirs-jpss1_{tahun}` (2023 ada, terverifikasi) | Pembanding tambahan |
| `VIIRS_NOAA20_NRT` | VIIRS | NOAA-20 | 375 m | NRT | — | Kondisi terbaru |
| `VIIRS_NOAA21_NRT` | VIIRS | NOAA-21 | 375 m | NRT | — | Kondisi terbaru |

Feed tidak pernah dijumlahkan menjadi satu seri; kalender dibuat per sumber. Harmonisasi MODIS↔VIIRS adalah langkah berikutnya (P0-S2-N2), sehingga kalender saat ini berlabel `harmonized: false`.

## Area

`--area` menerima `kalteng`, `papua`, `world`, atau `west,south,east,north` (WGS84; `west > east` melintasi antimeridian). Area unggulan memakai `study-rectangle-v1` yang sama dengan [regions.ts](../../src/lib/regions.ts); tes memastikan keduanya tetap sinkron.

## Riwayat global: arsip tahunan

- URL: `https://firms.modaps.eosdis.nasa.gov/data/country/zips/{prefix}_{tahun}_all_countries.zip`, tanpa MAP_KEY. Isinya CSV per negara. Detektsi di luar wilayah negara mana pun (laut lepas) tidak termasuk.
- Ukuran (Content-Length terverifikasi): MODIS 2019 ≈ 80 MB, VIIRS S-NPP 2019 ≈ 373 MB per tahun.
- `firms_archive.py` mengunduh, mencatat SHA-256, membaca streaming, lalu menghapus zip (kecuali `--keep-zip`). Checksum tetap ada di manifest sehingga batch dapat ditelusuri.
- Kolom arsip memuat `type`: 0 vegetasi, 1 gunung api, 2 sumber panas statis (industri/flare), 3 lepas pantai. Kalender default hanya memakai `vegetation` (dan `unknown` untuk feed tanpa kolom type).
- Uji nyata MODIS 2019: 4.578.188 deteksi, 0 ditolak, 577.263 baris grid, ±4 menit termasuk unduhan.

### Grid `grid-0.25deg-monthly-1`

`data/processed/grid/{SOURCE}/{tahun}.csv.gz` (di-gitignore) dengan kolom `month, cell_x, cell_y, fire_type, confidence, detections, frp_sum_mw, frp_missing`. Sel = `floor((lon+180)/0.25)`, `floor((lat+90)/0.25)`. Grid ini adalah unit agregasi, bukan resolusi pengukuran. `manifest.jsonl` mencatat URL, SHA-256, ukuran, waktu proses, rentang observasi pertama/terakhir, jumlah baris diterima/ditolak beserta alasan.

## Kalender `calendar-1` (draft)

```bash
python pipeline/firms_calendar.py --source MODIS_SP --area kalteng
python pipeline/firms_calendar.py --source MODIS_SP --area 94,-12,142,7 --include-low
```

- Sel masuk area bila **pusat sel** berada di dalam bbox; area kecil atau tepi bbox dapat meleset hingga 0,25°.
- `status` per bulan: `observed`, `partial` (arsip tidak mencakup seluruh bulan), `no_data` (di luar cakupan arsip → `detections: null`). Bulan tercakup tanpa deteksi bernilai `0`; artinya tidak ada deteksi, bukan bukti tidak ada api.
- Confidence low (MODIS <30, VIIRS `l`) dikecualikan default; `--include-low` untuk menyertakan.
- `climatology[bulan].median` dihitung hanya dari bulan berstatus `observed`. `anomaly(result, "YYYY-MM")` membandingkan satu bulan dengan median bulan yang sama pada tahun lain, beserta persentil; tanpa riwayat → `insufficient_history`.
- Output: `data/processed/calendar/{SOURCE}_{area}.json`. Bentuk ini belum menjadi kontrak frontend; perlu disepakati dengan Orkhan dan Bagas sebelum dipakai UI.

## Store deteksi asli (R2-P0-N1)

`python pipeline/firms_archive.py --source MODIS_SP --years 2000-2025` kini menulis **deteksi asli**, bukan hanya grid:

- Lokasi: `data/processed/detections/{SOURCE}/{YYYY}/{YYYY-MM}.pcd` (di-gitignore). Satu berkas per sumber dan bulan, berisi ubin 5° yang dikompresi terpisah sehingga kueri bbox hanya membaca ubin yang dibutuhkan.
- Rekaman (19 byte): lintang/bujur 1e-5°, menit akuisisi UTC sejak 2000-01-01, FRP (NaN = tidak ada), satelit, tipe api, siang/malam, dan kode confidence mentah (MODIS persen 0-100; VIIRS 101=l, 102=n, 103=h). Sekitar 10 byte/rekaman setelah kompresi.
- Duplikat (sumber, posisi, menit, satelit yang sama) dibuang saat penyimpanan dan dihitung di manifest. Baris invalid ditolak dengan alasan dan dihitung.
- Manifest: `data/processed/detections/{SOURCE}/manifest.jsonl`, satu baris per tahun dengan SHA-256 arsip, rentang observasi pertama/terakhir, jumlah per bulan, SHA-256 tiap berkas bulan, satelit yang terlihat tiap bulan, serta peringatan. Periode yang tidak ada di manifest berarti **tidak ada arsip**, bukan nol deteksi.
- Pemrosesan ulang melewati tahun yang sudah ada kecuali `--force`.
- **Grid 0,25° bulanan** (`data/processed/grid/`) diturunkan dari rekaman yang sama dan diberi label `coarse-aggregate`: pendekatan di tepi polygon dan untuk area kecil, tidak dipakai untuk hitungan akhir.

## Kueri polygon (R2-P0-N2)

`area_query.Polygon` menerima GeoJSON Polygon WGS84 dengan cincin luar dan lubang. Validasi: cincin tertutup, ≥3 titik berbeda, luas positif, tidak berpotongan sendiri, lubang di dalam cincin luar dan tidak saling bersinggungan/bersarang, batas jumlah titik, serta batas luas opsional. Aturan geometri:

- Sisi dianggap garis lurus pada bidang bujur/lintang (bukan geodesik). Sisi lebih dari 180° bujur dibaca melewati antimeridian (konvensi RFC 7946); polygon seperti itu dipecah menjadi dua bbox untuk prefilter.
- Prefilter bbox memilih ubin, lalu setiap titik diuji terhadap polygon sebenarnya (ray casting). Titik di sisi cincin luar dianggap di dalam, di sisi lubang dianggap di luar. Hasil berbeda dari bbox saja bila polygon bukan persegi.
- Tanggal inklusif UTC: `[awal 00:00, akhir+1 hari 00:00)`.
- Luas dihitung bola (R = 6371,0088 km) untuk batas validasi dan manifest; `areaKm2` resmi tetap dihitung layanan geometri.

## Count per sumber dan manifest (R2-P0-N3)

`area_counts.py` menghitung deteksi per sumber, hari, dan bulan:

- **Definisi:** jumlah deteksi asli yang lolos kebijakan kualitas `quality-policy-1` di dalam polygon dan periode; bukan sel-hari, jumlah kejadian, atau luas terbakar.
- **Kebijakan:** tipe `vegetation` (dan `unknown` untuk feed tanpa kolom tipe), confidence nominal/high. Yang dikecualikan (confidence rendah, gunung api, sumber statis, lepas pantai) dihitung dan dilaporkan di `excluded`.
- **Cakupan:** status bulan dari rentang observasi arsip: `observed` (arsip mencakup seluruh bulan; count 0 berarti nol deteksi, bukan tidak ada api), `partial` (hanya sebagian bulan), `no_data` (tanpa arsip → count `null`, tidak pernah 0).
- **Satelit:** satelit yang terlihat tiap bulan dicatat (`satellite-config-1`). Penambahan satelit atau sumber tidak dianggap seri setara tanpa kalibrasi tervalidasi; sumber tidak dijumlahkan menjadi nilai terharmonisasi.
- **Manifest** (`analysis-manifest-1`, id turunan hash isi sehingga dapat direproduksi): kebijakan kualitas, definisi count, aturan dedup dan overlap, hash geometri, luas, periode, serta per sumber: checksum arsip tiap tahun, bulan tanpa data/parsial, satelit per bulan, eksklusi, dan `rawCount`.

## Adapter producer ke research-2 (R2-P0-N4)

Integritas: partisi bulanan yang tercatat pada manifest tetapi hilang sekarang menyebabkan `MISSING_PARTITION`, bukan count nol. Manifest dan `dataVersion` juga mencakup arsip periode pembanding. Pengujian ini memakai arsip sintetis; validasi data nyata dan integrasi worker tetap terbuka.

```bash
python pipeline/research_adapter.py --area kalteng --start 2019-08-01 --end 2019-10-31 --comparison-start 2018-08-01 --comparison-end 2018-10-31
python pipeline/research_adapter.py --polygon area.json --start 2015-06-01 --end 2015-11-30
```

Keluaran di `data/processed/research/{hash geometri}/`: `result.json`, `manifest.json`, `daily-{bulan}.json`, `detections-page-1.json`. Semua lolos schema `research-2` (diperiksa oleh `tests/research-adapter.test.mjs` dengan data sintetis berlabel).

- `mode: research`, tetapi **tidak ada estimasi**: `harmonizedCount` selalu `null`, `method.validation` = `unsupported`, anomali `method_unsupported` (atau `insufficient_data` bila tanpa data). Hanya `rawCountsBySource` yang terisi; `rawCount` adalah jumlah sumber yang punya data.
- Status metrik: `no_data` (semua sumber tanpa arsip, count `null`), `partial` (ada sumber/bulan kosong atau sebagian), `method_unsupported` (data lengkap tetapi belum ada model).
- Detail observasi: urut waktu lalu sumber, maksimum 1000 per halaman, cursor buram terikat pada query (analisis, peran, periode, sumber).
- ID area/workspace/job/analisis berupa placeholder lokal; layanan persistensi menggantinya. `generatedAt` = `publishedAt` hingga ada publikasi.
- Handoff untuk Bagas: validasi payload, simpan hasil dan manifest, dan publikasi atomik. Untuk Orkhan: kalender tetap menampilkan bulan `no_data`/`partial` secara eksplisit.

## Harmonisasi (Sprint 2)

Pairing, evaluasi, referensi bergerak, dan estimasi skala MODIS dijelaskan di [harmonization.md](harmonization.md). Adapter di atas memakainya bila model tersedia; tanpa model atau di luar domain tervalidasi, estimasi tetap `null`.

## Pemrosesan arsip: batas dan kecepatan

Unduhan arsip dibatasi jaringan (±0,5 MB/s pada uji ini): MODIS ≈ 65-80 MB per tahun, VIIRS S-NPP ≈ 370 MB per tahun, dan pembacaan ±4 menit per tahun MODIS. Tahun yang belum diproses **tidak tersedia** di hasil; adapter menandainya `no_data`. Ruang disk: store ≈ 10 byte/deteksi.

## Data terbaru: API area

```bash
python pipeline/firms_ingest.py --area papua --source VIIRS_NOAA20_NRT --start 2026-11-05 --end 2026-11-09
python pipeline/firms_ingest.py --area world --source VIIRS_SNPP_NRT --start 2026-11-09 --end 2026-11-09
```

- Butuh `FIRMS_MAP_KEY` di `.env`. Request dipecah per 5 hari (batas maksimum resmi *verifikasi*). 429/5xx dicoba ulang dengan backoff 5/10/20 detik; 4xx lain langsung gagal. Kuota resmi per key *verifikasi*.
- Raw batch: `data/raw/firms/{SOURCE}/{area}/{start}_{N}d_{sha12}.csv`, tidak pernah ditimpa; satu baris manifest per request dengan key disamarkan (`<MAP_KEY>`). Respons teks non-CSV (key salah) gagal sebagai skema tidak cocok.
- Uji nyata 10 Nov 2026: `papua` VIIRS NOAA-20 5–9 Nov = 944 deteksi; `kalteng` VIIRS S-NPP 8–9 Nov = kosong (`empty`).

## Normalisasi atribut

| Field | Normalisasi |
|---|---|
| `latitude`, `longitude` | Ditolak bila di luar ±90/±180 |
| `acq_date`, `acq_time` | `observed_at` ISO UTC; `acq_time` tanpa nol depan (`15`) dibaca `00:15` |
| `satellite` | `T/Terra`, `A/Aqua`, `N` S-NPP, `1/N20` NOAA-20, `2/N21` NOAA-21; kode lain dipertahankan + peringatan |
| `confidence` | `confidence_raw` disimpan; `confidence_class` low (<30) / nominal (30–79) / high (≥80) untuk MODIS, `l/n/h` untuk VIIRS. Bukan probabilitas setara antarsensor |
| `frp` | MW; kosong → `null`; negatif/non-angka ditolak |
| `type` | Arsip saja; nilai di luar 0–3 ditolak |
| `version` | Disimpan apa adanya (arsip MODIS 2000 tercatat `6.2`) |

Kolom wajib hilang → batch gagal (bukan nol deteksi). Kolom tambahan → peringatan di manifest.

## NRT vs standard

FIRMS mengganti NRT dengan data standard setelah tersedia (jeda pasti *verifikasi*). Riwayat kalender memakai arsip standard; data terbaru memakai NRT. Selisih keduanya diuji di P1 sebelum dipakai untuk menilai anomali bulan berjalan.

## Catatan lingkungan

Python di sebagian mesin Windows gagal memverifikasi sertifikat TLS FIRMS. Kedua downloader otomatis beralih ke `curl` sistem **dengan verifikasi tetap aktif**; verifikasi TLS tidak pernah dimatikan.

Tes: `python -m unittest discover -s pipeline`.
