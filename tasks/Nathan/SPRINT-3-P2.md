> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 3 (P2) — Nathan

**Fokus:** Penguatan, evaluasi tambahan dan kesiapan rilis.\
**Reviewer utama:** Bagas.\
**Status:** task riset v2 belum dinyatakan selesai; implementasi lama menjadi fondasi, bukan bukti penerimaan scope baru.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P2-N1 — Sensitivitas NRT versus standard

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Bandingkan revisi arsip dan penilaian periode berjalan pada contoh nyata dengan identitas batch yang dapat dilacak.

**Kriteria selesai:** Laporan mengukur perubahan count/anomali dan batas interpretasi; hasil final tidak diklaim sebagai performa NRT masa lalu.

**Dependensi integrasi:** R2-P1-N4

**Status:** implementasi selesai sebagai snapshot beku dan pembanding; **revisi belum terukur** (ditambah sensitivitas skala asumsi terhadap penilaian periode berjalan) karena FIRMS tidak menyimpan NRT dan standard untuk tanggal yang sama. Lihat [catatan](../../docs/data/sprint-3-nrt-qa-reproducibility.md). Menunggu review Bagas.

### R2-P2-N2 — Benchmark transfer lintas domain

- [ ] **Selesai dan direview** — estimasi 6 poin.

**Pekerjaan:** Bekukan model dan uji pada wilayah/musim lain, termasuk contoh di luar dua area unggulan. Pisahkan transfer dari pelatihan ulang.

**Kriteria selesai:** Domain gagal tetap terlihat dan status dukungan dapat diperbarui tanpa mengarang generalisasi global.

**Dependensi integrasi:** R2-P1-N2

**Status:** implementasi selesai, menunggu review Bagas. Benchmark `pipeline/harmonize_transfer.py`, hasil `pipeline/models/transfer-a34f51d0a650.json`, uraian di [harmonization.md](../../docs/data/harmonization.md). Model tidak diubah; domain gagal tetap terlihat.

### R2-P2-N3 — Eksperimen QA coverage terpisah

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Jika data pelengkap diperlukan, periksa FireMask/QA spesifik produk dan turunkan denominator valid tanpa mengganti unit kalender utama.

**Kriteria selesai:** Coverage unknown tetap null bila QA tidak memadai. Ada keputusan go/no-go; CO/SMAP/ML tidak ditambahkan tanpa pertanyaan dan data uji yang jelas.

**Dependensi integrasi:** R2-P1-N4

**Status:** keputusan no-go terdokumentasi (FireMask/QA tidak ada di jalur data); coverage tetap null. Menunggu review Bagas.

### R2-P2-N4 — Paket reproduksibilitas ilmiah

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Bekukan manifest, checksum, konfigurasi, split, notebook/script evaluasi dan keterbatasan metode untuk materi penelitian.

**Kriteria selesai:** Anggota lain dapat mereproduksi satu hasil; klaim presentasi ditautkan ke run, bukan angka target paper.

**Dependensi integrasi:** R2-P2-N1, R2-P2-N2

**Status:** `pipeline/reproduce_check.py` mereproduksi evaluasi dan benchmark transfer, enam pemeriksaan OK. Menunggu review Bagas.

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
