> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 1 (P0) — Bagas

**Fokus:** Fondasi riset dan pengalaman peta.\
**Reviewer utama:** Orkhan.\
**Status:** fondasi B1–B4 dan worker diimplementasikan; pengujian terisolasi lulus. Review rekan, OAuth/Neon non-produksi, pengujian HTTP dan integrasi data nyata masih terbuka. [Bukti dan cara uji](../../docs/bagas-sprint-1-progress.md).

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P0-B1 — Skema workspace, akun individual, AOI dan revisi

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Rancang Prisma untuk User/Membership, area polygon dan revisi, serta metadata job/result. Definisikan isolasi workspace dan rencana migrasi dari laporan/candidate legacy tanpa menghapus riwayat.

**Kriteria selesai:** Migrasi direview dan diuji pada database uji; route baru memeriksa sesi dan membership server-side. Geometri/hash/luas berasal dari validasi server; token koordinator lama bukan identitas anggota.

**Dependensi integrasi:** Tidak ada task rekan yang menghalangi pekerjaan mandiri; gunakan kontrak v2.

### R2-P0-B2 — Pengajuan analisis dan antrean persisten

- [ ] **Selesai dan direview** — estimasi 7 poin.

**Pekerjaan:** Implementasikan area-create, analysis-create dan job-read v2. Simpan requestId, analysisKey, input/versi, status antre/diproses/selesai/gagal; claim worker dan retry harus tahan restart.

**Kriteria selesai:** Request identik idempotent; payload berbeda untuk requestId sama ditolak. POST selesai cepat dengan 202, tidak menunggu arsip; restart proses tidak menghilangkan job atau mempublikasikan setengah hasil.

**Dependensi integrasi:** R2-P0-B1, R2-P0-N4

### R2-P0-B3 — Pembacaan hasil dan data spasial reusable

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Sediakan hasil, halaman deteksi, serta cache/tile yang identitasnya memakai dataset dan resolusi penyajian. Pisahkan pergeseran kamera dari pemanggilan upstream FIRMS dan perhitungan historis.

**Kriteria selesai:** Area yang sudah tercakup tidak mengunduh ulang batch FIRMS setiap pan/zoom. Pagination terikat analysisId/periodRole; hasil lama tidak dilabeli sebagai area/kueri baru.

**Dependensi integrasi:** R2-P0-B2, R2-P0-N2, R2-P0-N3

### R2-P0-B4 — Hak akses dan error lintas resource

- [ ] **Selesai dan direview** — estimasi 3 poin.

**Pekerjaan:** Tegakkan akses job, area, hasil, serta API workspace dengan identitas individual. Tambahkan error v2 aman dan dokumentasikan policy membership untuk endpoint penandaan yang akan diintegrasikan.

**Kriteria selesai:** Pengguna workspace lain ditolak walaupun mengetahui ID. Tidak ada key/URL berkredensial/stack trace pada respons atau log. Jalur unauthenticated, forbidden, conflict, dan quota diuji.

**Dependensi integrasi:** R2-P0-B1

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

RawBatch dan service ingest aman yang sudah ada tetap dipertahankan. Auth workspace, queue v2, serta lokasi/assignment persisten tidak otomatis selesai karena dua task legacy tersebut sudah dicentang.
