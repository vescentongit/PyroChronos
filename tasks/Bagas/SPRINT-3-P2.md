> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 3 (P2) — Bagas

**Fokus:** Penguatan, evaluasi tambahan dan kesiapan rilis.\
**Reviewer utama:** Orkhan.\
**Status:** task riset v2 belum dinyatakan selesai; implementasi lama menjadi fondasi, bukan bukti penerimaan scope baru.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P2-B1 — Benchmark kapasitas dan biaya job

- [ ] **Selesai dan direview** — estimasi 6 poin.

**Pekerjaan:** Ukur area kecil/besar, periode pendek/panjang, cache hit/miss, concurrency dan kuota nyata; revisi batas layanan berdasarkan hasil.

**Kriteria selesai:** Batas dan estimasi biaya/waktu didokumentasikan tanpa mengubah polygon atau mengarang ETA. Backpressure tidak memblokir pembacaan hasil lama.

**Dependensi integrasi:** R2-P1-B1, R2-P1-B4

### R2-P2-B2 — Ketahanan antrean dan pemulihan

- [ ] **Selesai dan direview** — estimasi 4 poin.

**Pekerjaan:** Uji restart worker, retry, timeout, pembatalan deployment, duplikasi dan pemulihan metadata/result pada lingkungan uji.

**Kriteria selesai:** Tidak ada run setengah jadi/duplikasi laporan; prosedur pemulihan dapat diulang dan tidak menghapus data pengguna.

**Dependensi integrasi:** R2-P1-B1, R2-P1-B3

### R2-P2-B3 — Review isolasi dan retensi workspace

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Periksa otorisasi seluruh resource/download/cache, membership berubah, audit dan retensi arsip berdasarkan kebutuhan nyata.

**Kriteria selesai:** Akses lintas workspace ditolak pada setiap jalur; perubahan akses tidak meninggalkan link privat yang tetap terbuka.

**Dependensi integrasi:** R2-P1-B2, R2-P1-B3, R2-P1-B4

### R2-P2-B4 — Deployment dan observabilitas

- [ ] **Selesai dan direview** — estimasi 5 poin.

**Pekerjaan:** Siapkan konfigurasi secret, migrasi sebagai tahap deployment, health check, status ingest/job, dan runbook kegagalan untuk staging lalu rilis terotorisasi.

**Kriteria selesai:** Penerapan diuji tanpa secret pada log; status sukses/gagal dan sumber data dapat diperiksa. Tidak menjalankan migrasi pada request.

**Dependensi integrasi:** R2-P2-B1, R2-P2-B2

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
