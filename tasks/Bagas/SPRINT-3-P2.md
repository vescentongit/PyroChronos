> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../../docs/current-status.md).

# Sprint 3 (P2) - Bagas

**Fokus:** Penguatan, evaluasi tambahan dan kesiapan rilis.\
**Reviewer utama:** Orkhan.\
**Status:** Tahap 1–8 memiliki implementasi/bukti teknis lokal; selesai/direview penuh menunggu review manusia Orkhan, integrasi O4/Nathan dan rollout eksternal terotorisasi. Bukti lokal tidak menggantikan penerimaan tersebut.

[Indeks sprint](../SPRINT-PLAN.md) · [Tracker](../TASKS.md) · [Produk](../../product.md) · [API v2](../../docs/contracts/api-v2.md)

## Kapasitas dan cara kerja

Target kapasitas tentatif **20 poin per anggota per sprint**, dengan total kerja tim dibagi sepertiga per orang. Poin adalah estimasi planning, bukan jam/SLA atau bukti beban sudah identik. Re-estimasi setelah spike dan pindahkan potongan coding bila timpang; semua anggota tetap mengerjakan kode.

Dependensi di bawah merupakan syarat integrasi akhir, bukan larangan mulai coding. Gunakan schema dan fixture v2 berlabel sintetis untuk bekerja mandiri. Jangan menunggu polygon final dua wilayah: AOI produk adalah polygon bebas global.

## Spesifikasi task

### R2-P2-B1 - Benchmark kapasitas dan biaya job

- [ ] **Selesai dan direview** - estimasi 6 poin.

**Pekerjaan:** Ukur area kecil/besar, periode pendek/panjang, cache hit/miss, concurrency dan kuota nyata; revisi batas layanan berdasarkan hasil.

**Kriteria selesai:** Batas dan estimasi biaya/waktu didokumentasikan tanpa mengubah polygon atau mengarang ETA. Backpressure tidak memblokir pembacaan hasil lama.

**Dependensi integrasi:** R2-P1-B1, R2-P1-B4

**Bukti Tahap 1/2 - 14 November 2026:** [matriks cakupan, benchmark dan keputusan
batas lokal](../../docs/bagas-sprint-3-capacity.md), termasuk JSON sampel anonim
dan PostgreSQL native sementara. Beban sintetis, pengukuran waktu/resource nyata;
tarif deployment terpisah dan belum ditentukan. Guard tidak dinaikkan, polygon
tetap utuh; hasil lama terbaca saat kapasitas penuh. Review Orkhan dan validasi
deployment/arsip aktif tetap terbuka, sehingga checkbox selesai/direview belum dicentang.

**Tahap 3 - penerapan policy dan backpressure:**
[kontrak, batas operasional dan bukti uji](../../docs/bagas-sprint-3-backpressure.md).

- [x] Matriks anonim/legacy dan benchmark aktual berlabel sintetis terdokumentasi; komponen tarif eksternal dipisahkan, tanpa ETA buatan.
- [x] Policy `research-capacity-1`: concurrency/kuota submission, bounded JSON request/producer dan batas antrean/ukuran ekspor eksplisit, tanpa memotong polygon.
- [x] Error v2, 413 PAYLOAD_TOO_LARGE dan header Retry-After untuk 429/503 didokumentasikan untuk Orkhan; schema terkait diperbarui.
- [x] Penolakan kapasitas/kuota tidak memblokir analisis maupun status/CSV/manifest ekspor lama; regresi PGlite dan PostgreSQL native lulus.
- [x] Penolakan request anonim tidak mengubah bundle IndexedDB, riwayat localStorage atau penunjuk hasil terakhir; regresi test double lulus.
- [x] Suite Node 268/268 dan Python 163/163 tanpa skip, typecheck, lint, contract checks dan diff check lulus.
- [ ] Review manusia Orkhan atas B1; checkbox gabungan “selesai dan direview” tetap menunggu review ini.

### R2-P2-B2 - Ketahanan antrean dan pemulihan

- [ ] **Selesai dan direview** - estimasi 4 poin.

**Pekerjaan:** Uji restart worker, retry, timeout, pembatalan deployment, duplikasi dan pemulihan metadata/result pada lingkungan uji.

**Kriteria selesai:** Tidak ada run setengah jadi/duplikasi laporan; prosedur pemulihan dapat diulang dan tidak menghapus data pengguna.

**Dependensi integrasi:** R2-P1-B1, R2-P1-B3

**Tahap 4 - B2 bagian 1:** [bukti ketahanan proses](../../docs/bagas-sprint-3-process-resilience.md).

- [x] Hard crash sebelum publikasi dan kill di tengah transaksi: metadata hasil parsial tidak terbit; restart/replay menghasilkan satu hasil.
- [x] Expired/stale lease ditolak sebelum dan sesudah attempt pengganti sukses; hanya lease sah dapat memublikasikan.
- [x] Timeout, transient failure, kontrol stop dan handler terminasi runtime diuji dengan PostgreSQL native terisolasi; retry menghormati backoff.
- [x] Pengajuan/laporan duplikat server serta operation ID laporan lokal dibedakan dari pengiriman ulang analisis anonim; abort/timeout klien tidak menimpa hasil lama.
- [x] Verifikasi Tahap 4: 276/276 Node dan 163/163 Python tanpa skip dengan PostgreSQL native; typecheck, lint, contracts, ruff helper dan diff check lulus.
- [x] Tahap 5: [pemulihan berulang](../../docs/bagas-sprint-3-recovery.md), audit orphan privat tanpa delete, restore objek referensi hilang dari backup terverifikasi tanpa overwrite, serta repair indeks browser tanpa mengubah bundle/laporan.
- [x] Rekonsiliasi analisis/ekspor native dan pemulihan browser berulang diuji; metadata/count histori tetap, orphan dipertahankan, worker memakai reclaim/retry yang sudah diuji Tahap 4.
- [x] Verifikasi Tahap 5: 280/280 tes Node tanpa skip dengan PostgreSQL native; typecheck, lint, contracts, build dan diff check lulus. Runbook langkah berulang dan batas restore didokumentasikan.
- [ ] Review manusia Orkhan; B2 belum dinyatakan selesai/direview penuh.

### R2-P2-B3 - Review isolasi dan retensi workspace

- [ ] **Selesai dan direview** - estimasi 5 poin.

**Pekerjaan:** Periksa otorisasi seluruh resource/download/cache, membership berubah, audit dan retensi arsip berdasarkan kebutuhan nyata.

**Kriteria selesai:** Akses lintas workspace ditolak pada setiap jalur; perubahan akses tidak meninggalkan link privat yang tetap terbuka.

**Dependensi integrasi:** R2-P1-B2, R2-P1-B3, R2-P1-B4

**Tahap 6 - [audit isolasi dan retensi](../../docs/bagas-sprint-3-isolation-retention.md):**

- [x] Inventaris route v2, scope workspace resource/cursor/cache, manifest/tile/download dan capability publikasi privat diaudit; web anonim tetap tanpa login.
- [x] Recheck membership pada batas respons seluruh keluarga handler dan catch-all workspace; stream CSV memeriksa tiap chunk tanpa prefetch aplikasi.
- [x] Matriks lintas workspace, revoke dan downgrade hak owner diuji di PGlite/PostgreSQL native; download lama tidak menjadi tautan publik yang melewati otorisasi.
- [x] Policy research-retention-1: histori/artefak/orphan tetap privat tanpa TTL/delete otomatis; trigger tidak diubah. Rotasi browser hanya cache memori satu bundle, tanpa eviksi data persisted.
- [x] Prosedur kapasitas, backup, cleanup memori dan batas pencabutan stream terdokumentasi; tidak ada purge arsip atau penghapusan origin otomatis.
- [x] Verifikasi Tahap 6: 286/286 Node dan 163/163 Python tanpa skip, PostgreSQL native aktif; typecheck, lint, contracts, build dan diff check lulus.
- [ ] Review manusia Orkhan; checkbox gabungan selesai/direview tetap terbuka sampai review.

### R2-P2-B4 - Deployment dan observabilitas

- [ ] **Selesai dan direview** - estimasi 5 poin.

**Pekerjaan:** Siapkan konfigurasi secret, migrasi sebagai tahap deployment, health check, status ingest/job, dan runbook kegagalan untuk staging lalu rilis terotorisasi.

**Kriteria selesai:** Penerapan diuji tanpa secret pada log; status sukses/gagal dan sumber data dapat diperiksa. Tidak menjalankan migrasi pada request.

**Dependensi integrasi:** R2-P2-B1, R2-P2-B2

**Tahap 7 - B4 bagian 1:** [runbook deployment dan observabilitas](../../docs/bagas-sprint-3-deployment-observability.md).

- [x] Deploy check per role, penolakan public secret, konfigurasi legacy terpisah dari web anonim; output hanya field/kode aman.
- [x] Migrasi hanya aksi deployment opt-in; tes native membuktikan migrate deploy berulang dan readiness tanpa migrasi dalam request.
- [x] Health/readiness Node/Python dan kegagalan dependency diuji; status ingest/job/ekspor operator serta referensi kualitas Nathan N1–N4 tersedia tanpa membuka data workspace ke publik.
- [x] Celah exception/argumen CLI Python dan logger Auth.js diperketat; regresi memakai sentinel sintetis tanpa secret asli.
- [x] Verifikasi Tahap 7: 293/293 Node dan 168/168 Python tanpa skip dengan PostgreSQL native; typecheck, lint, contracts, ruff, build dan diff check lulus.
- [x] Tahap 8: kontrak dan daftar review handoff O4/N1–N4 dikonsolidasikan di current-status dan runbook; bukti lokal dibedakan dari rollout cloud/review manusia.
- [x] Simulasi Next hasil build lewat HTTP + PostgreSQL sementara: check-runtime lima role, opt-in migrasi terpisah dua kali, research-status, health/ready sebelum/sesudah migrasi dan dependency storage gagal/pulih. Tujuh histori migrasi tetap; sentinel sintetis tidak bocor pada output yang diperiksa. [JSON aktual](../../docs/benchmarks/bagas-sprint-3-staging-handoff.json).
- [x] Regresi akhir Tahap 8: 293/293 Node + 13/13 frontend/hotspots, 168/168 Python tanpa skip dengan native; typecheck, lint (enam warning lama, exit 0), contracts, Ruff pipeline/scripts/tests, build dan diff check lulus.
- [x] Server/schema/direktori tes dibersihkan, database tidak menyisakan schema uji; container PostgreSQL sementara terkonfirmasi terhapus setelah stop --rm.
- [ ] Handoff O4 diterima dan verifikasi Preview/staging nyata bersama Orkhan/Nathan; review manusia B4 dan otorisasi rollout cloud belum dilakukan.

## Checklist sebelum membuat PR

- [ ] ID task, tujuan, acceptance criteria, dan dependensi integrasi ditautkan pada PR.
- [x] Klaim selesai menyertakan bukti aktual; fixture, replay, raw, experimental dan validated dibedakan.
- [x] Schema/contoh/kontrak yang berubah diperbarui bersama; jalankan npm run check:contracts dan tes relevan.
- [x] Untuk TypeScript jalankan npm run typecheck; build bila mengubah aplikasi. Untuk pipeline jalankan pengujian Python terkait.
- [x] Kegagalan relevan, missing/null, periode parsial, idempotensi, respons usang dan hak akses diuji sesuai perubahan.
- [x] Tidak ada secret, URL berkredensial, data privat workspace, atau klaim tidak ada api akibat missing data.
- [x] Perubahan Prisma menyertakan rencana migrasi dan uji database terisolasi; migrasi produksi bukan bagian otomatis PR. Tahap 8 tidak menambah migrasi/schema.
- [ ] UI yang berubah diperiksa EN/ID, keyboard/fokus, mobile, warna/status, serta konteks AOI/periode yang tidak hilang.
- [ ] Satu rekan melakukan review; PR mencatat risiko, keterbatasan dan cara memverifikasi.
- [ ] Status task/trackernya diperbarui setelah bukti dan integrasi selesai; checklist lama tidak menjadi bukti PR baru.

Audit Tahap 8: checklist teknis B1–B3 di atas tetap ditopang suite regresi, bukan
dianggap review manusia. Tidak ada perubahan UI pada Tahap 8; acceptance browser
O4 dan copy error EN/ID tetap perlu Orkhan. Draf PR `Bagas-SPRINT-3-P2` → `dev`
disediakan dalam handoff akhir; PR/link, review, integrasi manusia dan status
selesai/direview tidak dibuat atau dicentang otomatis.

| Task | Bukti teknis lokal | Sisa penerimaan |
| --- | --- | --- |
| B1 | Benchmark/policy/error; hasil lama tetap terbaca saat penolakan | Review Orkhan; tarif/arsip/provider nyata tidak dikarang |
| B2 | Crash/lease/retry, publikasi atomik, recovery berulang tanpa delete/duplikasi | Review Orkhan; penerapan prosedur di lingkungan terotorisasi |
| B3 | Scope/cursor/download, revoke instan, retensi non-destruktif | Review Orkhan dan demonstrasi consumer aktual |
| B4 | Konfigurasi/redaction, migrasi terpisah, health/status dan simulasi HTTP | Review manusia O4/N1–N4, cloud/binding/secret aktual dan izin rollout |

## Syarat sprint pribadi selesai

- [ ] Task wajib sprint ini memenuhi acceptance; keputusan no-go hanya berlaku pada eksperimen opsional, bukan pengganti fitur inti.
- [ ] Handoff schema-valid diintegrasikan dengan rekan dan hasil verifikasi ditautkan.
- [ ] Blocker, status data/model dan hasil review tercatat pada PR/issue serta tracker.

## Bukti pekerjaan sebelum rebaseline

Status checklist v1 yang sudah dicentang disimpan pada [arsip keputusan/status lama](../archive/2026-11-10-completed-v1.md). ID v1 tidak diubah maknanya menjadi task baru.

RawBatch dan service ingest aman yang sudah ada tetap dipertahankan. Auth workspace, queue v2, serta lokasi/assignment persisten tidak otomatis selesai karena dua task legacy tersebut sudah dicentang.
