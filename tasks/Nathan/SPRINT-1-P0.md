> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 1 (P0) — Nathan

**Fokus:** Fondasi riset dan pengalaman peta.\
**Reviewer utama:** Bagas.\
**Status:** R2-P0-N1 sampai N4 selesai dan direview (PR #7 dimerge ke dev). Integrasi dengan Bagas dan Orkhan serta checklist sprint di bawah masih terbuka.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P0-N1 — Arsip global yang mempertahankan tanggal dan posisi asli

- [x] **Selesai dan direview** — estimasi 5 poin.

*Implementasi selesai, menunggu review Bagas:* store deteksi asli `pcd1` per sumber/bulan (`detection_store.py`, `firms_archive.py`), manifest dengan checksum dan cakupan per tahun, grid lama diberi label `coarse-aggregate`. Pemrosesan arsip nyata berjalan bertahap; tahun yang belum diproses tercatat `no_data`. Lihat [catatan data](../../docs/data/firms-sources.md).

**Pekerjaan:** Audit firms_archive.py dan manifest yang sudah ada. Simpan partisi deteksi asli menurut waktu/sumber untuk kueri polygon dan detail harian; jangan hanya mengandalkan grid bulanan 0,25 derajat.

**Kriteria selesai:** Periode arsip tersedia/hilang dicatat; observasi harian dan titik asli dapat ditelusuri dari checksum. Grid lama diberi label agregat kasar, tidak diklaim tepat pada tepi polygon.

**Dependensi integrasi:** Tidak ada task rekan yang menghalangi pekerjaan mandiri; gunakan kontrak v2.

### R2-P0-N2 — Kueri polygon bebas dan irisan waktu

- [x] **Selesai dan direview** — estimasi 8 poin.

*Implementasi selesai, menunggu review Bagas:* `area_query.py` (polygon dengan lubang, antimeridian, validasi, batas luas/titik, tanggal inklusif UTC); 11 tes termasuk hasil berbeda dari bbox.

**Pekerjaan:** Bangun prefilter bbox diikuti pengujian geometri terhadap polygon WGS84, termasuk lubang, antimeridian, batas area, dan tanggal inklusif UTC. Jangan memakai pusat grid kasar sebagai pengganti deteksi asli.

**Kriteria selesai:** Fixture polygon non-persegi, lubang, antimeridian, dan area kecil menghasilkan observasi yang benar; hasil berbeda dari bbox saja ketika memang seharusnya berbeda.

**Dependensi integrasi:** R2-P0-N1

### R2-P0-N3 — Count per sumber dan manifest analisis

- [x] **Selesai dan direview** — estimasi 4 poin.

*Implementasi selesai, menunggu review Bagas:* `area_counts.py` (count per sumber/hari/bulan, kebijakan `quality-policy-1`, cakupan observed/partial/no_data, manifest reproducible).

**Pekerjaan:** Definisikan rawCount dan rawCountsBySource, deduplikasi rekaman, kebijakan confidence/type, status missing/partial, serta versi konfigurasi satelit. Count bukan sel-hari atau jumlah kejadian kebakaran.

**Kriteria selesai:** Jumlah count per sumber cocok dengan rawCount; missing tidak menjadi nol; bertambahnya satelit tidak dianggap seri setara tanpa kalibrasi. Manifest menyimpan aturan dan versi arsip.

**Dependensi integrasi:** R2-P0-N1

### R2-P0-N4 — Adapter producer ke research-2

- [x] **Selesai dan direview** — estimasi 3 poin.

*Implementasi selesai, menunggu review Bagas:* `research_adapter.py` menghasilkan result/daily/detections `research-2` tanpa estimasi (harmonizedCount null, validation unsupported); `tests/research-adapter.test.mjs` memvalidasi dengan schema zod.

**Pekerjaan:** Petakan keluaran mentah dan draft calendar-1 ke kontrak v2 dengan status belum terharmonisasi bila model belum diuji. Pertahankan modul lama sebagai sumber, bukan kontrak UI baru.

**Kriteria selesai:** Worker dapat menghasilkan contoh mentah yang lolos schema dan mempunyai provenance; estimasi belum valid tidak diberi mode research tervalidasi. Handoff dapat dipakai Bagas dan Orkhan.

**Dependensi integrasi:** R2-P0-N2, R2-P0-N3

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
