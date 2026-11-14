# NRT, QA coverage dan reproduksibilitas (Nathan, Sprint 3)

Dokumen ini mencatat keputusan dan bukti R2-P2-N1, N3 dan N4. Benchmark transfer (N2) ada di [harmonization.md](harmonization.md).

## N1 — Sensitivitas NRT versus standard

**Hasil: belum dapat diukur. Tidak ada angka perubahan yang diklaim.**

FIRMS mengganti NRT dengan standard setelah standard terbit, sehingga satu tanggal tidak punya kedua versi sekaligus. Ketersediaan API pada 14 November 2026 (`python pipeline/firms_availability.py`):

| Sumber | Rentang |
|---|---|
| VIIRS_SNPP_SP | 2012-01-20 s.d. 2026-07-31 |
| VIIRS_SNPP_NRT | 2026-08-01 s.d. 2026-11-02 |
| MODIS_SP | 2000-11-01 s.d. 2026-08-31 |
| MODIS_NRT | 2026-09-01 s.d. 2026-11-14 |

Yang dikerjakan adalah snapshot beku yang bisa dibandingkan nanti, bukan hasil perbandingan:

- Tiga kotak VIIRS S-NPP NRT, 2026-10-01 s.d. 2026-11-02: Rondônia, miombo dan Kalimantan Tengah (kotak kasar), diunduh dengan `firms_ingest.py`. Satu area `kalteng` lama (8–9 November) ikut terbaca dari raw yang sudah ada.
- `python pipeline/nrt_snapshot.py --freeze` memverifikasi setiap batch terhadap checksum manifest, menerapkan kebijakan kualitas yang sama dengan hitungan riset, membuang duplikat antarbatch, dan menulis hitungan harian dengan identitas batch ke [docs/data/nrt/VIIRS_SNPP_NRT-snapshot.json](nrt/VIIRS_SNPP_NRT-snapshot.json) (id `nrt-snapshot-a9c6c471da9a3c8a`).
- `python pipeline/nrt_snapshot.py --compare` membandingkan hanya hari yang seluruh bulan UTC-nya sudah tercakup arsip standard di store. Saat ini tidak ada hari seperti itu, sehingga setiap area bernilai `not_comparable` dan tidak ada selisih yang dinyatakan ([comparison](nrt/VIIRS_SNPP_NRT-comparison.json)).

Cara memakainya nanti: setelah VIIRS_SNPP_SP untuk Oktober–November 2026 terbit, unduh dengan `firms_archive.py --source VIIRS_SNPP_SP --years 2026 --force`, lalu jalankan `--compare`. Selisih yang keluar menggambarkan revisi batch ini saja, bukan performa NRT pada periode lain, dan belum boleh dipakai untuk mengubah kebijakan anomali bulan berjalan sebelum ada lebih dari satu periode.

Batas: hanya satu satelit, tiga kotak dan satu bulan; kotak adalah bounding box kasar, bukan polygon pengguna.

## N3 — Eksperimen QA coverage

**Keputusan: no-go untuk jadwal ini.**

- FireMask/QA ada di granul MOD14/VNP14 (LAADS), bukan di CSV FIRMS yang dipakai store. Granul itu tidak ada di repo atau di jalur data saat ini, dan mengunduhnya untuk bulan-bulan yang dievaluasi berada di luar waktu yang tersisa.
- Tanpa QA, denominator valid tidak dapat diturunkan. Coverage tetap `null`, bukan nol, dan unit kalender utama tidak diganti.
- Tidak ada CO, SMAP atau ML yang ditambahkan. Pertanyaan yang jelas bila eksperimen dibuka kembali: apakah fraksi piksel valid per sel-bulan menjelaskan galat residual domain yang gagal (terutama Asia Tenggara maritim) lebih baik daripada rasio global; uji pada tahun yang belum terlihat.

## N4 — Paket reproduksibilitas

Satu hasil dapat direproduksi dengan `python pipeline/reproduce_check.py`. Skrip menghitung ulang evaluasi dan benchmark transfer dari tabel pasangan lokal dan membandingkannya dengan artefak yang di-commit. Keluaran terakhir: enam pemeriksaan OK.

| Artefak | Identitas |
|---|---|
| Konfigurasi harmonisasi | hash `a34f51d0a650…` ([harmonize_config.py](../../pipeline/harmonize_config.py)) |
| Tabel pasangan | sha256 `e194422b2197…` ([manifest](../../pipeline/models/pairs-a34f51d0a650.manifest.json)) |
| Evaluasi | `evaluation-275ac4d8b7c6096b` |
| Model | [model-a34f51d0a650.json](../../pipeline/models/model-a34f51d0a650.json) |
| Benchmark transfer | `transfer-34fd878c3e0a0756` |
| Snapshot NRT | `nrt-snapshot-a9c6c471da9a3c8a` |

Urutan dari nol, setelah arsip standard diunduh (`firms_archive.py`):

```
python pipeline/harmonize_pairs.py --counts
python pipeline/harmonize_pairs.py --pairs
python pipeline/harmonize_eval.py
python pipeline/harmonize_transfer.py
python pipeline/reproduce_check.py
```

Setiap klaim presentasi harus menautkan ke run di atas: ratio 0,2458 dan MAE uji 12,5 berasal dari evaluasi; bias holdout 2012 dari benchmark transfer. Angka target paper tidak dipakai. Kelima domain tervalidasi dan domain yang ditolak (termasuk Kalteng/Papua) dicatat pada artefak yang sama.

Batas: pemeriksaan membutuhkan arsip yang sama (checksum pairs mengikat versi arsip); revisi FIRMS pada arsip akan membuat checksum berbeda dan pemeriksaan gagal, itu perilaku yang dimaksud.
