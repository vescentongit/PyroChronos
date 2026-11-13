> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 3 (P2) — Orkhan

**Fokus:** Penguatan, evaluasi tambahan dan kesiapan rilis.\
**Reviewer utama:** Nathan.\
**Status:** task riset v2 belum dinyatakan selesai; implementasi lama menjadi fondasi, bukan bukti penerimaan scope baru.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P2-O1 — Benchmark interaksi peta dan kalender

- [ ] **Selesai dan direview** — estimasi 6 poin.

**Pekerjaan:** Ukur pan/zoom, toggle, polygon besar, perubahan periode, data padat dan mobile pada perangkat/jaringan yang dicatat.

**Kriteria selesai:** Temuan diperbaiki berdasarkan bukti; tidak mengklaim sub-second/60 FPS tanpa hasil aktual atau menyembunyikan loading dengan menghapus data.

**Dependensi integrasi:** R2-P1-O1, R2-P1-O2

### R2-P2-O2 — Uji tugas bersama peneliti

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Uji pilih AOI, analisis historis, baca anomali, tandai lokasi, penugasan dan ekspor dengan pengguna sasaran bila tersedia.

**Kriteria selesai:** Temuan dipisahkan dari asumsi desain, kesulitan tugas diprioritaskan, dan tidak menganggap wawancara tim sebagai validasi instansi.

**Dependensi integrasi:** R2-P1-O4

### R2-P2-O3 — Audit aksesibilitas dan edge case

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Tinjau ramp warna count/anomali, keyboard, fokus, zoom teks, EN/ID, nama wilayah panjang, no-data serta hasil parsial pada desktop/mobile.

**Kriteria selesai:** Informasi tidak hanya bergantung pada warna/peta; tabel atau panel menyediakan alternatif dan ekspor tetap terbaca.

**Dependensi integrasi:** R2-P1-O1, R2-P1-O2, R2-P1-O4

### R2-P2-O4 — Acceptance riset dan demo terukur

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Rekam satu alur lintas anggota dari polygon ke kalender, perbandingan, lokasi tim, beberapa pemeriksaan dan ekspor; siapkan materi bersama tim.

**Kriteria selesai:** Setiap klaim menunjuk hasil/test nyata atau label demo. Blocker dicatat tanpa menyamarkan data tidak tersedia sebagai nol/normal.

**Dependensi integrasi:** R2-P2-O1, R2-P2-O2, R2-P2-B4, R2-P2-N4

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
