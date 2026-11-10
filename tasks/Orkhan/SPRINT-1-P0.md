# Sprint 1 (P0) — Orkhan

**Fokus:** Fondasi riset dan pengalaman peta.\
**Reviewer utama:** Nathan.\
**Status:** implementasi frontend O1–O4 tersedia dan lolos pengujian mandiri (10 November 2026). Integrasi backend/data nyata, QA imagery live dan review Nathan masih terbuka. [Bukti v2](../../docs/orkhan-sprint-1-v2-progress.md).

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P0-O1 — Satu peta dan navigasi tanpa reload analisis

- [ ] **Selesai dan direview** — estimasi 7 poin.
- [x] Satu workspace, toggle heatmap/titik, kamera terpisah, cache dan hasil tetap saat navigasi; diuji di browser dengan NRT sintetis.
- [x] Layer satelit dan label wilayah terpasang; kegagalan tile tidak menghapus overlay.
- [ ] Verifikasi ketajaman citra/label live pada jaringan normal dan review Nathan.

**Pekerjaan:** Satukan Activity Map dan Global Heatmap menjadi satu workspace dengan toggle heatmap/titik. Pisahkan kamera, AOI draft, dan hasil aktif; gunakan instance map stabil dan cache/lapisan yang dapat digunakan ulang.

**Kriteria selesai:** Pan/zoom tidak menghapus overlay atau memulai job/FIRMS batch ulang. Toggle mempertahankan AOI/periode/lokasi. Citra satelit tajam sesuai sumber, label wilayah terlihat tanpa hover, dan kegagalan tile tidak menghapus hasil.

**Dependensi integrasi:** Tidak ada task rekan yang menghalangi pekerjaan mandiri; gunakan kontrak v2.

### R2-P0-O2 — Editor polygon penelitian

- [ ] **Selesai dan direview** — estimasi 5 poin.
- [x] Draw, edit koordinat, undo, batal, validasi polygon, revisi draft dan outline area hasil.
- [x] Polygon non-persegi, antimeridian, penolakan geometri invalid serta interaksi keyboard/pointer diuji. Preset nama dan navigasi koordinat tersedia.
- [ ] Review Nathan; persistensi/revisi server diverifikasi saat endpoint area v2 tersedia.

**Pekerjaan:** Tambahkan gambar/edit polygon bebas, outline AOI aktif, batal edit, serta navigasi bantuan nama/koordinat. Simpan draft terpisah dari area yang sudah dianalisis; tampilkan validasi geometri.

**Kriteria selesai:** Polygon non-persegi dapat dipilih dan diterapkan. Pergeseran kamera tidak memindahkan AOI. Geometri invalid tidak dikirim diam-diam atau dipotong tanpa pemberitahuan; perubahan menciptakan revisi.

**Dependensi integrasi:** Tidak ada task rekan yang menghalangi pekerjaan mandiri; gunakan kontrak v2.

### R2-P0-O3 — Rentang tanggal dan Analisis area

- [ ] **Selesai dan direview** — estimasi 4 poin.
- [x] Tanggal bebas, pembanding, default referensi 10 tahun dan pengajuan eksplisit melalui Analisis area.
- [x] Retry mempertahankan requestId; queued/running, cancellation dan respons usang diuji dengan backend sintetis.
- [ ] Integrasi B2 memakai sesi/workspace nyata, kebijakan kualitas yang disepakati, serta review Nathan.

**Pekerjaan:** Sediakan periode bebas, pembanding opsional, serta referensi default 10 tahun. Hanya tombol Analisis area mengajukan permintaan; tampilkan status job lokal tanpa mengunci peta.

**Kriteria selesai:** Klik berulang/retry memakai requestId yang tepat, respons lama tidak menimpa pilihan baru, dan hasil lama tetap diberi label area/periode aslinya. Tanggal tidak terbatas 24/48/72/96 jam.

**Dependensi integrasi:** R2-P0-O2, R2-P0-B2

### R2-P0-O4 — Consumer v2 dan UI state yang jujur

- [ ] **Selesai dan direview** — estimasi 4 poin.
- [x] Consumer research-2 memvalidasi schema/konteks; contoh sintetis, ringkasan kalender/detail, pemisahan v1 dan label raw/estimasi tersedia.
- [x] EN/ID, status job/data, missing data, desktop/mobile, fokus keyboard, font dan Dashboard diperiksa; 31 tes serta browser acceptance lulus.
- [ ] Integrasi B3/N4 dengan hasil nyata dan review Nathan.

**Pekerjaan:** Validasi respons research-2, buat adapter consumer, serta skeleton kalender/detail yang dapat dikerjakan dengan fixture sintetis. Pertahankan jalur v1 terpisah selama migrasi.

**Kriteria selesai:** Queue/running/failed/partial/no_data/unsupported tampil dalam EN/ID. Fixture/replay tidak disebut analisis nyata; label satuan raw versus estimasi jelas. Keyboard, Plus Jakarta Sans, Dashboard dan mobile tetap bekerja.

**Dependensi integrasi:** R2-P0-O3, R2-P0-B3, R2-P0-N4

## Checklist sebelum membuat PR

- [ ] ID task, tujuan, acceptance criteria, dan dependensi integrasi ditautkan pada PR.
- [x] Klaim selesai menyertakan bukti aktual; fixture, replay, raw, experimental dan validated dibedakan.
- [x] Schema/contoh/kontrak yang berubah diperbarui bersama; jalankan npm run check:contracts dan tes relevan.
- [x] Untuk TypeScript jalankan npm run typecheck; build bila mengubah aplikasi. Untuk pipeline jalankan pengujian Python terkait.
- [ ] Kegagalan relevan, missing/null, periode parsial, idempotensi, respons usang dan hak akses diuji sesuai perubahan.
- [ ] Tidak ada secret, URL berkredensial, data privat workspace, atau klaim tidak ada api akibat missing data.
- [ ] Perubahan Prisma menyertakan rencana migrasi dan uji database terisolasi; migrasi produksi bukan bagian otomatis PR.
- [x] UI yang berubah diperiksa EN/ID, keyboard/fokus, mobile, warna/status, serta konteks AOI/periode yang tidak hilang.
- [ ] Satu rekan melakukan review; PR mencatat risiko, keterbatasan dan cara memverifikasi.
- [ ] Status task/trackernya diperbarui setelah bukti dan integrasi selesai; checklist lama tidak menjadi bukti PR baru.

## Syarat sprint pribadi selesai

- [ ] Task wajib sprint ini memenuhi acceptance; keputusan no-go hanya berlaku pada eksperimen opsional, bukan pengganti fitur inti.
- [ ] Handoff schema-valid diintegrasikan dengan rekan dan hasil verifikasi ditautkan.
- [ ] Blocker, status data/model dan hasil review tercatat pada PR/issue serta tracker.

## Bukti pekerjaan sebelum rebaseline

Status checklist v1 yang sudah dicentang disimpan pada [arsip keputusan/status lama](../archive/2026-11-10-completed-v1.md). ID v1 tidak diubah maknanya menjadi task baru.

Kontrak v1, i18n, frontend states dan acceptance mandiri sebelumnya tetap menjadi bukti prototype; lihat [catatan Orkhan](../../docs/orkhan-sprint-1-progress.md). Bukti itu tidak menutup kriteria satu workspace peta dan kalender v2.
