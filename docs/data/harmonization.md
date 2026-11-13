> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../current-status.md).

# Harmonisasi VIIRS ke skala setara MODIS (Nathan, Sprint 2)

**Status:** implementasi R2-P1-N1 sampai N4 selesai dengan tes dan data arsip nyata; menunggu review Bagas dan integrasi worker. Evaluasi bersifat **retrospektif** pada arsip FIRMS 2013–2025 dan **bukan** validasi operasional untuk bulan mendatang. Hasil yang terbit berlabel `research` hanya untuk polygon yang seluruhnya berada di domain tervalidasi; selain itu estimasi `null`.

Konfigurasi dibekukan sebelum hasil evaluasi dilihat: [harmonize_config.py](../../pipeline/harmonize_config.py), hash `a34f51d0a650…` (versi `harmonization-config-1`). Mengubah nilai apa pun mengubah hash dan membatalkan tabel pasangan, evaluasi, serta hasil terbit.

| Modul | Fungsi |
|---|---|
| [harmonize_config.py](../../pipeline/harmonize_config.py) | Konfigurasi beku: satelit, sel 1°, bulan UTC, split, domain, aturan keputusan, kebijakan referensi |
| [harmonize_pairs.py](../../pipeline/harmonize_pairs.py) | Count sel-bulan per sumber dan tabel pasangan (N1) |
| [harmonize_eval.py](../../pipeline/harmonize_eval.py) | Evaluasi kandidat, keputusan, model (N2) |
| [reference_baseline.py](../../pipeline/reference_baseline.py) | Estimasi per polygon, referensi bergerak, skor, pemilihan minimum tahun (N2/N3) |
| [research_adapter.py](../../pipeline/research_adapter.py), [research_export.py](../../pipeline/research_export.py) | Hasil research-2 bulanan, detail harian, ringkasan dua periode, ekspor CSV (N4) |
| [harmonize_polygon_check.py](../../pipeline/harmonize_polygon_check.py) | Diagnostik polygon kecil pada tahun uji |
| [pipeline/models/](../../pipeline/models/) | Model, kebijakan referensi, evaluasi, dan manifest pasangan yang dikomit |

## N1 — Pairing dan konfigurasi beku

- **Acuan:** `MODIS_SP` (Terra + Aqua, nominal 4 lintasan/hari). **Masukan:** `VIIRS_SNPP_SP` (Suomi NPP, 2 lintasan/hari). NOAA-20/21 belum diproses ke store sehingga tidak dipakai.
- **Unit pasangan:** satu sel 1° × satu bulan kalender UTC, memakai kebijakan kualitas `quality-policy-1` (vegetasi/tak diketahui; confidence nominal/tinggi). Hanya bulan yang seluruhnya tercakup kedua arsip dan memakai set satelit beku yang dipakai; 156 bulan (2013-01 sampai 2025-12) memenuhi syarat, tidak ada yang dikeluarkan.
- **Yang tidak terdaftar:** sel yang kosong di kedua sumber tidak dienumerasi, jadi sampel bersyarat pada adanya aktivitas.
- **Split menurut tahun penuh:** latih 2013–2018 (571.940 sel-bulan), validasi 2019–2020 (190.747), uji 2021–2025 (473.017). Model dilatih hanya pada latih, kandidat dipilih hanya pada validasi, uji diskor sekali. Kode menolak split yang tumpang tindih.
- **Titik asli** tetap di store `pcd1` dan itulah yang dikembalikan API; tabel pasangan hanya agregat.
- **Pengaruh jumlah lintasan:** set satelit identik di setiap bulan berpasangan, sehingga jumlah lintasan konstan pada latih/validasi/uji dan pengali yang dipelajari menyerap perbedaan itu. Pengali **tidak** berlaku untuk set satelit lain (mis. menambah NOAA-20) tanpa konfigurasi dan evaluasi baru.
- **Manifest pasangan:** [pairs-a34f51d0a650.manifest.json](../../pipeline/models/pairs-a34f51d0a650.manifest.json) memuat checksum arsip per tahun, aturan overlap, kebijakan kualitas, daftar bulan, dan checksum tabel.

Cara menjalankan ulang (butuh store hasil `firms_archive.py`):

```
python pipeline/harmonize_pairs.py --counts
python pipeline/harmonize_pairs.py --pairs
python pipeline/harmonize_eval.py
python pipeline/reference_baseline.py --minimum-years
python pipeline/harmonize_polygon_check.py --polygons 120
```

## N2 — Evaluasi

Kandidat pada sampel yang sama (MAE dan bias per sel-bulan, satuan deteksi):

| Kandidat | MAE validasi | MAE uji | Bias uji | Aditif | Keputusan |
|---|---|---|---|---|---|
| raw_alignment (VIIRS apa adanya) | 137,43 | 130,64 | +130,11 | ya | pembanding |
| **ratio_global** (satu pengali 0,2458) | **12,26** | **12,53** | +0,96 | ya | **dipilih** |
| ratio_domain (pengali per domain) | 12,79 | 13,31 | +0,65 | ya | tidak dipilih |
| affine_global | 12,31 | 12,58 | +1,16 | tidak | ditolak untuk terbit |
| eqm_global ([harmonize.py](../../pipeline/harmonize.py)) | 21,12 | 21,38 | +18,02 | tidak | ditolak untuk terbit |

Aturan pemilihan (beku): metode terbit adalah kandidat **aditif** dengan MAE validasi terendah. Kandidat tak aditif dievaluasi dan dilaporkan, tetapi tidak dapat diterapkan pada polygon terpotong atau dialokasikan ke hari. Pada data ini EQM juga paling buruk secara numerik.

Aturan domain tervalidasi (beku, `decision-rule-1`), pada tahun uji: minimal 500 sel-bulan; MAE turun ≥ 20% dibanding raw_alignment; |bias relatif| jumlah domain-bulan ≤ 15%; transfer (model pooled tanpa domain itu, dilatih pada latih) memenuhi kedua ambang; ≤ 10% hitungan VIIRS uji melebihi maksimum latih.

| Domain | Sel-bulan uji | MAE | MAE raw | Bias relatif | Bias transfer | Status |
|---|---|---|---|---|---|---|
| africa_north_of_equator | 64.131 | 15,84 | 215,5 | +5,5% | +0,4% | **tervalidasi** |
| africa_south_of_equator | 45.898 | 36,48 | 403,1 | −3,6% | −8,0% | **tervalidasi** |
| australia | 24.159 | 13,00 | 160,4 | +10,0% | +10,5% | **tervalidasi** |
| boreal_eurasia | 42.595 | 8,12 | 73,2 | +1,5% | +2,7% | **tervalidasi** |
| south_america | 77.625 | 10,48 | 111,4 | −7,0% | −7,1% | **tervalidasi** |
| north_america | 70.778 | 9,92 | 83,4 | +12,9% | +15,2% | ditolak: transfer |
| europe_mediterranean | 32.542 | 3,23 | 17,9 | −17,2% | −17,3% | ditolak: bias, transfer |
| **maritime_southeast_asia** (Indonesia, Kalteng, Papua) | 20.843 | 4,11 | 33,3 | **+25,3%** | +26,8% | **ditolak: bias, transfer** |
| south_and_mainland_southeast_asia | 43.085 | 14,27 | 120,8 | +25,1% | +27,3% | ditolak: bias, transfer |
| other | 51.361 | 4,96 | 28,2 | +2,9% | — | tidak pernah divalidasi |

Temuan yang tidak disembunyikan:

- **Kalimantan Tengah dan Papua berada di domain yang ditolak.** Satu pengali global melebihi-estimasi (+25%) di Asia Tenggara maritim; pengali per domain di sana 0,160 melawan 0,246 global, tetapi pemilihan sudah dibekukan pada ratio_global dan data uji sudah terlihat, jadi domain ini **tidak** dibuka setelah fakta. Memperbaikinya membutuhkan konfigurasi baru (mis. seleksi per domain) yang dievaluasi pada data yang belum dilihat, misalnya tahun 2026 yang lengkap.
- Kesalahan tidak seragam: per kelompok hitungan VIIRS, MAE 0,71 (1–2), 1,58 (3–9), 3,87 (10–49) tetapi 41,12 (≥ 50); saat VIIRS = 0, MODIS rata-rata masih 2,24 deteksi (bias −2,24). Per musim kalender (tanpa penyesuaian belahan bumi) MAE uji: DJF 10,68, MAM 10,94, JJA 16,24, SON 11,77.
- Dukungan distribusi: hampir seluruh hitungan VIIRS uji berada di dalam rentang latih; hanya 2 sel-bulan di boreal_eurasia dan 2 di south_america yang melampaui maksimum latih (≤ 0,01%), domain lain 0. Pengali linear tetap menghasilkan nilai untuk sel seperti itu; tidak ada pemotongan diam-diam.
- Bias relatif sel-bulan dan bias domain-bulan bernilai sama untuk pengali karena total domain adalah jumlah sel.
- Evaluasi membandingkan estimasi VIIRS dengan hitungan MODIS, bukan dengan kejadian api di lapangan.

**Diagnostik polygon kecil** (bukan bagian aturan penerimaan, tidak dipakai menyetel apa pun; [polygon-check](../../pipeline/harmonize_polygon_check.py), 120 kotak 0,5° acak seed `20261112` di domain tervalidasi × 5 tahun uji): dari 185 polygon-tahun dengan ≥ 30 deteksi MODIS, bias relatif −0,5%, median rasio 1,00, tetapi hanya **61%** yang berada dalam ±25% dari MODIS asli (per domain 50–77%). Maka estimasi untuk area kecil bersifat perkiraan; kalimat itu ikut di `method.validationDomain`.

## N3 — Referensi bergerak 10 tahun

Kebijakan `reference-policy-1`, dibekukan:

- Referensi = rentang bulan-hari yang sama pada tahun Y−10 sampai Y−1 (panjang jendela dapat diubah). Tahun target dan sesudahnya tidak pernah masuk.
- Seri referensi = estimasi harmonisasi VIIRS. Tahun tanpa jendela yang seluruhnya tercakup VIIRS, atau tanpa polygon yang didukung, **hilang** (tidak diisi nol dan tidak diganti hitungan MODIS asli). Karena VIIRS S-NPP baru lengkap sejak 2013, bulan target sebelum 2017 punya sedikit tahun referensi.
- Statistik: median. Skor: persentil target di antara nilai referensi (ikatan dihitung setengah), 0–100.
- Periode parsial/berjalan dibandingkan dengan rentang hari yang sama pada tahun referensi. Selisih jumlah hari akibat 29 Februari dikoreksi dengan skala hari target / hari referensi.
- Baseline nol atau referensi tanpa variasi: nilai dasar dan selisih tetap ada, **skor `null`** (tidak ada rasio/infinity, tidak ada label normal).
- `insufficient_history` bila tahun referensi valid < minimum; nilai, selisih, skor `null` dan `referenceYears` menunjukkan tahun yang ada.
- **Minimum tahun valid = 4**, dipilih dengan aturan beku: k terkecil yang MAE backtest prakiraan mediannya ≤ 110% MAE k = 10, pada seri MODIS asli per domain-bulan 2000–2025 dan target tahun validasi saja. MAE relatif k = 3..10: 0,274; 0,256; 0,256; 0,245; 0,243; 0,241; 0,243; 0,239. Konsekuensi: referensi 4 tahun lebih berisik daripada 10; berkas [baseline-a34f51d0a650.json](../../pipeline/models/baseline-a34f51d0a650.json) menyimpan angka lengkapnya.

## N4 — Kalender, detail, perbandingan

- **Bulanan:** semua bulan pada periode primer hadir, termasuk `no_data` (count `null`). `status`: `available` bila estimasi ada; `partial` bila sumber hilang/sebagian atau jendela VIIRS belum tercakup; `method_unsupported` bila polygon di luar domain tervalidasi; `no_data` bila tidak ada sumber.
- **Aturan agregasi:** estimasi = pengali × deteksi VIIRS yang diterima di dalam polygon (aditif). Total hari = total bulan = total periode; total kalender cocok dengan ringkasan. Nilai harian dibulatkan 6 desimal hanya untuk tampilan dan merupakan alokasi aditif, bukan validasi harian terpisah.
- **Dukungan polygon:** polygon didukung hanya bila setiap titik sampel (verteks + grid ≤ 4000 titik) berada di domain tervalidasi; polygon yang menyentuh domain tak tervalidasi atau `other` mendapat `null` dan `method.validation = unsupported`.
- **Dua periode:** ringkasan pembanding memakai polygon dan metode yang sama. Manifest membawa durasi, laju per hari, dan persen perubahan yang `null` dengan alasan bila pembanding nol atau tidak lengkap.
- **Ekspor** ([research_export.py](../../pipeline/research_export.py), `research_adapter.py --export`): `raw-hotspots.csv` (titik asli dalam polygon), `harmonized-aggregates.csv` (baris periode dan bulan dengan raw per sumber, estimasi, baseline, metode, versi); sel teks berawalan `= + - @` dinetralkan.
- **Contoh nyata** yang lolos kontrak: [Rondônia/Amazon 2024](examples/amazon-rondonia-2024/result.json) (tervalidasi; estimasi 1.283,3 melawan MODIS asli 1.253 pada kotak 1° × 1°) dan [Kalimantan Tengah 2023](examples/kalteng-2023/result.json) (estimasi ditahan). Dites oleh `tests/research-real-examples.test.mjs`.

## Handoff ke worker Bagas

`research_worker.produce` belum memakai model (diubah hanya oleh pemiliknya, setelah review). Perubahannya kecil:

```python
from research_adapter import load_default_harmonization
model, baseline = load_default_harmonization(data["baseline"]["windowYears"])
built = build_result(..., model=model, baseline=baseline)
days.append(daily_page(counts, run["id"], month, role, harmonized=(built["harmonized"] if role == "primary" else built["comparisonHarmonized"]).get(month)))
```

Tanpa perubahan itu worker tetap menerbitkan hitungan mentah dengan estimasi `null`, sama seperti sebelum Sprint 2.

## Batas yang diketahui

- Evaluasi retrospektif; 2026 belum dipakai. Kinerja pada bulan mendatang tidak dijamin.
- Model hanya untuk S-NPP dengan Terra/Aqua; NOAA-20/21 memerlukan konfigurasi baru.
- Sampel pasangan bersyarat pada aktivitas; polygon dengan nol deteksi memberi estimasi 0 di domain tervalidasi dan bukan bukti tidak ada api.
- Domain dibuat dari kotak kasar (aturan pertama yang cocok) dan polygon besar lintas domain ditahan seluruhnya.
- Hanya VIIRS 375 m S-NPP → skala MODIS; bukan model luas area terbakar atau jumlah kejadian.
