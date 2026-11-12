# Sprint 2 (P1) — Nathan

**Fokus:** Kalender harmonisasi dan tindak lanjut tim.\
**Reviewer utama:** Bagas.\
**Status:** implementasi R2-P1-N1 sampai N4 selesai dengan tes dan data arsip nyata; menunggu review Bagas dan integrasi worker sebelum dicentang. Estimasi tervalidasi hanya untuk lima domain; Asia Tenggara maritim (Kalteng/Papua) ditolak oleh evaluasi. Bukti: [catatan harmonisasi](../../docs/data/harmonization.md).

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P1-N1 — Pairing dan acuan setara MODIS

- [ ] **Selesai dan direview** — estimasi 6 poin.

*Implementasi selesai, menunggu review Bagas:* konfigurasi beku `harmonization-config-1` (satelit, sel 1°, bulan UTC, split latih 2013–2018 / validasi 2019–2020 / uji 2021–2025), 156 bulan berpasangan, manifest pasangan dengan checksum arsip, aturan overlap dan pengaruh lintasan, tes kebocoran split. Titik asli tidak diubah. Lihat [harmonization.md](../../docs/data/harmonization.md).

**Pekerjaan:** Bekukan konfigurasi satelit, resolusi/agregasi, pasangan ruang/waktu, dan split latih/uji. Gunakan setara MODIS sebagai hipotesis awal, bukan ground truth atau pengali resolusi tetap.

**Kriteria selesai:** Manifest menjelaskan pairing, domain, revisi arsip, aturan overlap dan pengaruh jumlah lintasan; data uji tidak dipakai melatih/tuning. Titik asli tetap terpelihara.

**Dependensi integrasi:** R2-P0-N3, R2-P0-N4

### R2-P1-N2 — Evaluasi count mentah, baseline, dan EQM

- [ ] **Selesai dan direview** — estimasi 6 poin.

*Implementasi selesai, menunggu review Bagas:* raw_alignment, regresi (rasio global/domain, affine) dan EQM dievaluasi pada sampel yang sama dengan MAE, bias, dukungan, musim, kelompok hitungan dan domain. Terpilih rasio global (MAE uji 12,53 melawan 130,64 untuk VIIRS apa adanya). Estimasi hanya terbit di lima domain tervalidasi; **Asia Tenggara maritim (Kalteng/Papua), Asia Selatan/daratan, Eropa dan Amerika Utara ditolak dan estimasinya `null`**. Keputusan tercatat di `pipeline/models/evaluation-*.json`.

**Pekerjaan:** Bandingkan count yang disejajarkan tanpa koreksi, regresi sederhana, dan EQM pada sampel yang sama. Laporkan MAE, bias, dukungan distribusi, musim serta domain wilayah.

**Kriteria selesai:** Keputusan menerima/menolak metode tercatat; estimasi research hanya terbit untuk domain yang tervalidasi. Nol/outside-support dan kegagalan transfer tidak disembunyikan; tidak membuat titik sintetis.

**Dependensi integrasi:** R2-P1-N1

### R2-P1-N3 — Referensi bergerak 10 tahun dan periode parsial

- [ ] **Selesai dan direview** — estimasi 5 poin.

*Implementasi selesai, menunggu review Bagas:* referensi median Y−10..Y−1 pada rentang bulan-hari yang sama, minimum tahun valid 4 (dipilih lewat backtest MODIS 2000–2025 dengan aturan beku), tahun target/mendatang tidak masuk, tahun tanpa data hilang (bukan nol), 29 Februari diskalakan, baseline nol/datar tanpa skor, `insufficient_history` eksplisit. Teruji di `test_harmonization.py`.

**Pekerjaan:** Implementasikan bulan yang sama pada Y-10 sampai Y-1, panjang dapat diubah. Bekukan versi minimum kelengkapan, statistik pembanding, dan definisi score; tangani rentang harian, musim, kabisat dan periode berjalan.

**Kriteria selesai:** Target/tahun masa depan tidak masuk acuan. Data awal/missing tidak diisi nol; insufficient_history ditampilkan. Baseline nol/variasi nol tidak menghasilkan infinity atau label normal palsu.

**Dependensi integrasi:** R2-P1-N2

### R2-P1-N4 — Kalender, detail dan perbandingan konsisten

- [ ] **Selesai dan direview** — estimasi 3 poin.

*Implementasi selesai, menunggu review Bagas:* `research_adapter.py` menghasilkan research-2 bulanan (semua bulan termasuk `no_data`), detail harian aditif, raw per sumber, ringkasan dua periode dengan laju per hari dan persen perubahan `null` bila pembanding nol, ekspor CSV (`research_export.py`), serta dua contoh nyata lolos kontrak di `docs/data/examples/`. Integrasi ke `research_worker.py` Bagas belum dipasang (lihat handoff di dokumen).

**Pekerjaan:** Hasilkan research-2 bulanan, detail harian, raw per sumber, ringkasan dua periode serta data ekspor untuk polygon yang sama. Tetapkan aturan agregasi sehingga count antarlevel tetap dapat dijelaskan.

**Kriteria selesai:** Semua bulan pada rentang hadir termasuk no_data; total kalender cocok dengan ringkasan. Durasi berbeda diberi konteks, metadata metode/sumber/baseline lengkap, dan contoh nyata lolos kontrak.

**Dependensi integrasi:** R2-P1-N3

## Checklist sebelum membuat PR

- [ ] ID task, tujuan, acceptance criteria, dan dependensi integrasi ditautkan pada PR.
- [ ] Klaim selesai menyertakan bukti aktual; fixture, replay, raw, experimental dan validated dibedakan.
- [ ] Schema/contoh/kontrak yang berubah diperbarui bersama; jalankan npm run check:contracts dan tes relevan.
- [ ] Untuk TypeScript jalankan npm run typecheck; build bila mengubah aplikasi. Untuk pipeline jalankan pengujian Python terkait.
- [ ] Kegagalan relevan, missing/null, periode parsial, idempotensi, respons usang dan hak akses diuji sesuai perubahan.
- [ ] Tidak ada secret, URL berkredensial, data privat workspace, atau klaim tidak ada api akibat missing data.
- [ ] Perubahan Prisma menyertakan rencana migrasi dan uji database terisolasi; migrasi produksi bukan bagian otomatis PR.
- [ ] UI yang berubah diperiksa EN/ID, keyboard/fokus, mobile, warna/status, serta konteks AOI/periode yang tidak hilang.
- [ ] Satu rekan melakukan review; PR mencatat risiko, keterbatasan dan cara memverifikasi.
- [ ] Status task/trackernya diperbarui setelah bukti dan integrasi selesai; checklist lama tidak menjadi bukti PR baru.

## Syarat sprint pribadi selesai

- [ ] Task wajib sprint ini memenuhi acceptance; keputusan no-go hanya berlaku pada eksperimen opsional, bukan pengganti fitur inti.
- [ ] Handoff schema-valid diintegrasikan dengan rekan dan hasil verifikasi ditautkan.
- [ ] Blocker, status data/model dan hasil review tercatat pada PR/issue serta tracker.

## Bukti pekerjaan sebelum rebaseline

Status checklist v1 yang sudah dicentang disimpan pada [arsip keputusan/status lama](../archive/2026-11-10-completed-v1.md). ID v1 tidak diubah maknanya menjadi task baru.

Katalog/parser, ingest, agregat global dan draft calendar-1 yang sudah ada tetap digunakan sebagai fondasi. Grid bulanan 0,25 derajat dan pembanding semua tahun belum memenuhi polygon/detail harian/referensi bergerak v2; lihat [catatan data](../../docs/data/firms-sources.md).
