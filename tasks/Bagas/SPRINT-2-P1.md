> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 2 (P1) — Bagas

**Fokus:** Kalender harmonisasi dan tindak lanjut tim.\
**Reviewer utama:** Orkhan.\
**Status:** task riset v2 belum dinyatakan selesai; implementasi lama menjadi fondasi, bukan bukti penerimaan scope baru.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P1-B1 — Worker nyata dan publikasi atomik

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Integrasikan producer Nathan dengan antrean; validasi hasil, simpan manifest/dataVersion dan publikasikan resultId hanya setelah transaksi berhasil. Pisahkan status job sukses dari status validasi metode.

**Kriteria selesai:** Job raw/unsupported dapat selesai tanpa mengklaim harmonisasi. Kegagalan tidak menimpa hasil valid; ingest/revisi/model baru mengubah analysisKey dan cache sesuai versi.

**Dependensi integrasi:** R2-P0-B2, R2-P0-B3, R2-P1-N4

### R2-P1-B2 — Lokasi pemantauan persisten

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Buat create/list/read lokasi dari analysisId dan anchorDetectionId yang dapat diverifikasi. Simpan posisi asli, bukti awal, referensi AOI/revisi, pembuat dan workspace; dukung analisis berikutnya tanpa menimpa anchor.

**Kriteria selesai:** Mark cluster tidak menghasilkan koordinat pengamatan palsu. Lokasi tetap ada setelah refresh/perubahan periode/feed dan isolasi workspace berlaku. Retry tidak menggandakan lokasi.

**Dependensi integrasi:** R2-P0-B4, R2-P1-B1

### R2-P1-B3 — Penugasan, pemeriksaan, revision dan audit

- [ ] **Selesai dan direview** — estimasi 7 poin.

**Pekerjaan:** Implementasikan assignment-create/status, create-report dan correction v2. Verifikasi assignee/inspector anggota workspace; pencatat berasal dari sesi. Satu lokasi dapat mempunyai beberapa pemeriksaan.

**Kriteria selesai:** Transisi status dan konflik revision diuji; laporan immutable history, waktu pemeriksaan/input terpisah, dan retry idempotent. Selesai diperiksa tidak menyatakan api padam; deteksi baru tetap terlihat.

**Dependensi integrasi:** R2-P1-B2

### R2-P1-B4 — Ekspor CSV dan manifest yang terlindungi

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Sediakan export-create/status/download untuk deteksi asli dan agregat terharmonisasi secara terpisah. Terapkan pagination/streaming atau job, metadata periode/AOI/model, CSV escaping dan izin download server-side.

**Kriteria selesai:** Raw CSV tidak berisi titik buatan; count estimasi tidak dipaksa integer. Download tidak membocorkan catatan workspace lain atau URL key; versi yang diunduh sama dengan analisis.

**Dependensi integrasi:** R2-P1-B1, R2-P1-N4

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
