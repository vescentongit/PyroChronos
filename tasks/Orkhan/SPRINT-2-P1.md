> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 2 (P1) — Orkhan

**Fokus:** Kalender harmonisasi dan tindak lanjut tim.\
**Reviewer utama:** Nathan.\
**Status 13 November 2026:** implementasi O1–O4 lokal tanpa login dan acceptance sintetis desktop/mobile tersedia. Review finish independen: ship. Review Nathan dan demonstrasi dataset aktif masih terbuka; sprint belum ditutup sebagai selesai/direview manusia. [Bukti Sprint 2](../../docs/orkhan-sprint-2-progress.md).

- [x] O1/O2: kalender, detail harian, dua periode, anomali dan provenance.
- [x] O3: heatmap → titik asli, lokasi persisten dan reuse AOI.
- [x] O4 lokal: penugasan, pemeriksaan/koreksi/audit, CSV/JSON/PNG.
- [x] Build, tes, acceptance sintetis EN/ID/desktop/mobile dan review finish otomatis.
- [ ] Review Nathan dan acceptance dataset aktif; checkbox “Selesai dan direview” tetap menunggu bukti tersebut.

Penugasan memakai nama lokal pengguna; membership server/sinkronisasi pada rincian lama digantikan keputusan tanpa login. Identitas tidak diklaim terverifikasi.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P1-O1 — Burning calendar tahun x bulan

- [ ] **Selesai dan direview** — estimasi 6 poin.

**Pekerjaan:** Hubungkan kalender Januari-Desember per tahun ke hasil v2; klik bulan membuka halaman detail harian dan deteksi yang sesuai. Batasi rendering pada data yang diperlukan.

**Kriteria selesai:** Area/periode dan hasil konsisten pada peta/kalender/detail. Nol, no_data, partial dan insufficient_history berbeda; angka asli per sumber dan estimasi tidak tertukar.

**Dependensi integrasi:** R2-P0-O4, R2-P1-N4

### R2-P1-O2 — Perbandingan, anomali dan metodologi

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Tampilkan dua periode, durasi, perubahan aktivitas, referensi bergerak yang dapat diubah, serta model/validasi/provenance. Pisahkan skala warna count dan anomali.

**Kriteria selesai:** Referensi aktual dan keterbatasan dapat dibaca dalam EN/ID. Periode parsial/tidak sama panjang tidak menyesatkan, dan metode yang belum didukung tidak diberi score palsu.

**Dependensi integrasi:** R2-P1-O1, R2-P1-N3

### R2-P1-O3 — Detail hotspot dan daftar lokasi tim

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Buka bukti dari titik asli, sediakan Tandai lokasi, daftar lokasi workspace dan buka ulang untuk analisis periode lain. Klik kelompok heatmap mengarah ke detail/zoom sebelum memilih anchor.

**Kriteria selesai:** Lokasi yang disimpan dapat dibuka kembali tanpa bergantung pada baris feed aktif. Posisi/nama/analisis asal jelas; keadaan menunggu/gagal simpan tidak disebut sukses.

**Dependensi integrasi:** R2-P0-O4, R2-P1-B2

### R2-P1-O4 — UI pemeriksaan dan ekspor penelitian

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Integrasikan assignee, status pekerjaan, beberapa laporan, koreksi beralasan dan revision conflict. Sediakan unduhan CSV serta PNG kalender/grafik dari hasil yang sama dengan metadata visual.

**Kriteria selesai:** Anggota tim dapat menugaskan dan mencatat hasil; refresh tidak menghapus laporan. Nama pemeriksa/pencatat dan waktu terpisah. PNG/CSV mencantumkan periode, AOI, satuan, model, baseline dan sumber; file demo berlabel.

**Dependensi integrasi:** R2-P1-O3, R2-P1-B3, R2-P1-B4

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

Kontrak v1, i18n, frontend states dan acceptance mandiri sebelumnya tetap menjadi bukti prototype; lihat [catatan Orkhan](../../docs/orkhan-sprint-1-progress.md). Bukti itu tidak menutup kriteria satu workspace peta dan kalender v2.
