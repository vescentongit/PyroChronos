# Data FIRMS dan kalender global (Nathan, Sprint 1)

Versi katalog: `firms-catalog-2`. Grid: `grid-0.25deg-monthly-1`. Kalender: `calendar-1` (draft, belum kontrak tim).

Keputusan tim (10 Nov 2026): **titik api dan kalender bersifat global**. Pengguna dapat memilih area mana pun; Kalimantan Tengah (`kalteng`) dan Papua Selatan (`papua`) tetap menjadi area unggulan (*featured*) yang di-highlight, bukan batas cakupan.

| Modul | Fungsi |
|---|---|
| [firms_catalog.py](../../pipeline/firms_catalog.py) | Feed, lokasi arsip, area unggulan, bbox `world`/kustom (termasuk antimeridian) |
| [firms_parse.py](../../pipeline/firms_parse.py) | Parser/validator baris FIRMS (batch API maupun streaming arsip) |
| [firms_ingest.py](../../pipeline/firms_ingest.py) | Unduh API area (NRT/terbaru) untuk area apa pun → raw batch + manifest |
| [firms_archive.py](../../pipeline/firms_archive.py) | Unduh arsip tahunan global → grid bulanan 0,25° |
| [firms_calendar.py](../../pipeline/firms_calendar.py) | Kalender bulanan + median historis + anomali untuk area apa pun |

## Feed

| ID | Sensor | Platform | Resolusi nominal | Proses | Arsip tahunan | Peran |
|---|---|---|---|---|---|---|
| `MODIS_SP` | MODIS | Terra/Aqua | 1 km | standard | `modis_{tahun}` (mulai Nov 2000, terverifikasi) | Riwayat panjang kalender |
| `MODIS_NRT` | MODIS | Terra/Aqua | 1 km | NRT | — | Kondisi terbaru |
| `VIIRS_SNPP_SP` | VIIRS | Suomi NPP | 375 m | standard | `viirs-snpp_{tahun}` (2012 ada, terverifikasi) | Referensi harmonisasi |
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
