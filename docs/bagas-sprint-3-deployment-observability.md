# Tahap 7–8 — deployment, observabilitas dan handoff staging

R2-P2-B4 bagian 1, 15 November 2026. Persiapan teknis staging saja: tidak
menjalankan deployment cloud, aktivasi scheduler, backfill, promosi produksi,
atau migrasi database pengguna. Handoff lokal Tahap 8 tercatat di bawah;
acceptance O4 bersama Orkhan/Nathan pada provider tetap memerlukan review manusia.

## Tahap 8 — simulasi integrasi lokal, 15 November 2026

Runner `scripts/verify-staging-handoff.mjs` menggunakan server **Next hasil build
melalui HTTP**, konfigurasi sintetis, direktori dataset kosong dan artefak privat
temporer, serta schema acak `handoff_test_*` pada PostgreSQL 16 sementara.
Runner menolak host selain localhost dan database selain `research_worker_test`.
Ia menutup server, membuang schema uji dan direktori miliknya di `finally`;
container harus dihentikan operator setelah seluruh suite selesai.

Urutan yang dapat diulang (Git Bash, Python/env uji disediakan lokal):

```bash
npm run build
node scripts/verify-staging-handoff.mjs docs/benchmarks/bagas-sprint-3-staging-handoff.json
```

Runner membutuhkan `RESEARCH_TEST_DATABASE_URL` untuk database container khusus
tes. Jangan arahkan ke database staging bersama/produksi. Tidak memerlukan
credential provider sebenarnya. Output hanya ringkasan aman; exception dan log
child tidak diteruskan mentah ke terminal. File JSON ditulis setelah cleanup
berhasil dan ditimpa saat rerun; cocokkan dokumentasi dengan hasil terbaru.

Rantai pemeriksaan: `check-runtime` app/migration/worker/export-worker/pipeline →
deploy-migrate tanpa opt-in ditolak → server HTTP hidup tetapi schema belum siap →
deploy-migrate opt-in dua kali → `research-status` → readiness berulang →
request area anonim dan penolakan payload berlebih → hilangkan/pulihkan directory
dataset milik tes. Jumlah `_prisma_migrations` sebelum/sesudah pembacaan status
dan request harus sama. Sentinel credential sintetis diperiksa pada output CLI,
log Next yang ditangkap dan body respons yang diperiksa.

Ini pengukuran perilaku runtime nyata dengan **input sintetis**, bukan benchmark
dataset FIRMS aktif, validasi model, biaya provider, SLA atau ETA. Dataset kosong
menghasilkan daftar ingest/job/ekspor kosong dan provenance dataset `null` di CLI;
readiness teknis tidak mengubahnya menjadi data validated. Bukti kasus status
sukses/gagal dan proyeksi provenance ada di suite operasional; B1 capacity/quota,
B2 crash/restore dan B3 revoke/isolation dibuktikan oleh regresi penuh terpisah,
bukan diklaim seluruhnya dilalui lewat sesi browser HTTP ini.

Hasil run 15 November 2026, 04:21 UTC (11:21 WIB), tersimpan pada
[JSON aktual](benchmarks/bagas-sprint-3-staging-handoff.json):

| Pemeriksaan nyata | Hasil |
| --- | --- |
| Deploy check lima role; migrasi tanpa opt-in | Lima valid; migrasi ditolak dengan MIGRATION_CONFIG_INVALID |
| HTTP health; ready sebelum migrasi | 200 ok; 503 not_ready |
| Migrasi deployment terpisah dua kali | Dua MIGRATION_SUCCEEDED, tujuh baris histori migrasi |
| CLI status dan tiga request ready | Status terbaca; 200 ready, jumlah migrasi tetap tujuh |
| Directory dataset dihilangkan → dipulihkan | Ready 503 → 200; health tetap 200 saat dependency hilang |
| Area anonim tanpa login; payload >100.000 byte | 200 dengan polygon utuh; 413 PAYLOAD_TOO_LARGE tanpa Retry-After |
| Output CLI, log Next sampai proses ditutup, respons yang diperiksa | Tidak mengandung sentinel secret sintetis/DSN uji |

Regresi akhir checkout: **293/293 tes Node** ditambah **8/8 frontend** dan
**5/5 hotspots**, **168/168 Python**, seluruhnya tanpa skip; native PostgreSQL
aktif. `npm run typecheck`, `npm run lint`, `npm run check:contracts`,
`ruff check pipeline scripts tests`, `npm run build` dan `git diff --check`
lulus. Lint exit 0 dengan enam warning noNonNullAssertion lama; tidak ada error.
Ruff seluruh pipeline awalnya menemukan 33 temuan lama; import/reexport,
lambda, variabel tak terpakai dan `zip(strict=False)` dirapikan dengan tetap
mempertahankan perilaku dan API modul. Suite penuh dijalankan ulang sesudahnya.
Review independen tidak menemukan masalah penting; cleanup saat gagal dan
pemindaian log sampai stream ditutup turut diperketat. Ini bukan review manusia.
Pemeriksaan akhir PostgreSQL tidak menemukan schema uji tersisa. Server Next,
direktori temporer dan schema runner sudah dibersihkan; container
`pyrochronos-sprint3-handoff` dihentikan dengan `--rm` dan terkonfirmasi tidak
tersisa pada `docker ps -a`.

## Handoff Orkhan — O4 dan review PR

| Respons submission | Tindakan consumer |
| --- | --- |
| 503 `CAPACITY_LIMIT`, `Retry-After: 2` | Tunggu sesuai header; jangan ganti/memotong AOI atau menampilkan ETA. Penolakan admission dapat dicoba ulang dengan requestId yang sama |
| 429 `RATE_LIMITED`, `Retry-After: 60` | Tahan request baru sesuai header; workspaceId anonim baru tidak mereset kuota proses |
| 413 `PAYLOAD_TOO_LARGE`, retryable false, tanpa Retry-After | Jangan otomatis mengirim ulang payload yang sama; jelaskan batas secara eksplisit dan pertahankan polygon/data pengguna |

Envelope error memakai `schemaVersion: research-2`, `code`, `error`, `retryable`
dan `requestId` nullable. `DEPENDENCY_UNAVAILABLE` 503 tidak boleh disamakan dengan
kapasitas dan tidak menjanjikan header retry yang sama. Kegagalan ekspor terminal
tetap mengikuti flag retryable aktual, bukan retry otomatis dari tabel admission.
Detail: [kontrak B1](bagas-sprint-3-backpressure.md).

Gunakan `/api/health` untuk liveness dan `/api/ready` untuk readiness; keduanya
publik, minimal dan no-store. Legacy tetap berotorisasi, web anonim tanpa login.
Request anonim gagal/abort/ditolak tidak menulis bundle sukses lama. Startup
browser merekonsiliasi indeks history dari bundle IndexedDB, mempertahankan backup
state rusak dan laporan; cache memori hanya satu bundle dan dilepas saat panel
ditutup. Tidak ada TTL atau eviksi persisted otomatis; kegagalan quota storage
ditampilkan tanpa menghapus histori. [Pemulihan](bagas-sprint-3-recovery.md) dan
[retensi](bagas-sprint-3-isolation-retention.md) menjelaskan batasnya.

Masih memerlukan tindakan manusia:

- Orkhan mereview PR B1–B4 dan mendemonstrasikan O4 pada Preview/staging yang
  disetujui, termasuk EN/ID, retry tanpa kehilangan konteks AOI/periode/hasil,
  cache/pemulihan browser nyata dan unduhan setelah perubahan membership legacy.
- Review copy frontend `CAPACITY_LIMIT` (saran mengecilkan pilihan) dan
  `PAYLOAD_TOO_LARGE` (pesan retry generik) agar mengikuti kontrak di atas.
  Sesi ini tidak mengubah copy/UI atau mengklaim acceptance browser baru.
- Pemilik lingkungan memasang binding/store/secret aktual melalui kanal privat,
  mengobservasi log provider, menilai tarif/kapasitas arsip nyata dan mengotorisasi
  scheduler/backfill/promosi. Simulasi lokal tidak mengaktifkan rollout cloud.

## Handoff Nathan — N1–N4

Jalankan `npm run research:status` sebagai operator dengan credential privat.
Periksa groups status ingest/job/ekspor (termasuk sukses/gagal bila ada), `dataset`
fingerprint/sources/mode dan `qualityLimitations.N1`–`N4`. CLI berscope global
operator; jangan memasangnya sebagai endpoint workspace publik. Untuk satu job,
gunakan endpoint legacy berotorisasi dan manifest/provenance frozen hasil itu;
latest dataset CLI tidak menggantikan provenance historis.

N1 memerlukan bukti revisi NRT→standard aktual; skala sensitivitas bukan faktor
koreksi. N2 tidak memperluas domain tervalidasi lewat deployment (Kalteng/Papua
tetap unsupported/null). N3 coverage tetap null tanpa denominator, bukan nol.
N4 memerlukan arsip/model/checksum pinned yang sama untuk reproduksi. Nathan dan
Orkhan perlu memeriksa metadata dataset aktif di staging; dataset kosong sintetis
run ini tidak menyelesaikan review ilmiah atau integrasi manusia tersebut.

## Pemeriksaan konfigurasi dan secret

`npm run deploy:check -- ROLE` memvalidasi environment yang disediakan operator;
tidak memuat/mencetak file .env atau nilai secret. Role: app, pipeline, worker,
export-worker, ingest, migration. Output hanya role normal, ok dan nama field
konfigurasi yang gagal. Role tidak dikenal menjadi unknown. Check tidak melakukan
koneksi jaringan dan bukan bukti credential benar-benar berfungsi.

| Role | Konfigurasi minimum |
| --- | --- |
| app anonim lokal | RESEARCH_DATA_DIR, PIPELINE_URL binding, atau FIRMS_MAP_KEY server-only untuk on-demand; database/OAuth tidak diwajibkan |
| app hosted | PIPELINE_URL disuntik runtime Vercel; URL tanpa credentials/query/fragment. Jangan set binding manual di konfigurasi hosting |
| app legacy aktif | RESEARCH_V2_EXPERIMENTAL=true, DATABASE_URL PostgreSQL, AUTH_SECRET minimal 32 karakter, Google provider ID/secret, RESEARCH_ARTIFACT_ROOT absolut privat |
| pipeline | RESEARCH_DATA_DIR lokal, FIRMS_MAP_KEY server-only untuk on-demand, atau fallback FIRMS_BLOB_BASE_URL HTTPS dan BLOB_READ_WRITE_TOKEN; pemeriksaan Blob hostname/token detail dilakukan adapter Python |
| worker / export-worker | DATABASE_URL dan root artefak privat; worker analisis juga membutuhkan RESEARCH_DATA_DIR; RESEARCH_PYTHON/PYTHON sesuai lingkungan |
| ingest | DATABASE_URL, FIRMS_RAW_DIR dan FIRMS_MAP_KEY; arsip standard/scheduled Blob publisher memakai konfigurasi pipeline, bukan MAP_KEY live |
| migration | DATABASE_URL PostgreSQL; eksekusi juga memerlukan opt-in RESEARCH_DEPLOY_MIGRATIONS=true |

Secret/token/password/MAP_KEY/database URL berprefix NEXT_PUBLIC ditolak oleh
check. Root artefak tidak boleh public/.next/static. Tidak ada secret sebenarnya
ditambahkan ke repo; nilai tes sepenuhnya sintetis. Simpan secret di fasilitas
secret lingkungan, terpisah Preview/Production/operator, jangan dalam argumen CLI,
URL frontend, command transcript atau output dukungan. Nama variabel contoh ada
di .env.example. Keputusan tanpa login web aktif tidak berubah.

Check ini wajib dijalankan operator sebelum role diaktifkan. Tidak dimasukkan
ke build global karena binding runtime belum tersedia pada fase build dan web
anonim tidak memerlukan konfigurasi legacy. Readiness memeriksa ulang konfigurasi
pada request; belum ada custom instrumentation startup yang mengaktifkan legacy.

## Liveness, readiness dan status

| Mekanisme | Makna / keamanan |
| --- | --- |
| GET /api/health | Publik, 200 `{status:ok}`; hanya membuktikan handler Node hidup, tanpa query DB/ingest |
| GET /api/ready | Publik, 200 ready atau 503 not_ready, Cache-Control no-store; tidak mengungkap field gagal, path, URL, token atau exception |
| GET /health Python | Internal pipeline, liveness saja; tetap tidak punya rewrite publik |
| GET /ready Python | Internal: mengikuti prioritas local directory → key on-demand → Blob. Directory harus tersedia; mode key hanya kesiapan konfigurasi, tanpa request NASA; Blob membaca pointer/catalog pinned melalui adapter terbatasi. Empty env tetap tidak ready |
| npm run research:status | CLI operator privat: counts ingest/job/ekspor, fingerprint/sources/mode dataset terdaftar dan catatan N1–N4. Global/operator scope, **tidak** dijadikan HTTP workspace API |
| /api/v2/workspaces/.../jobs/:id dan result/days/detections/exports | Status individual lewat kontrak legacy berotorisasi yang sudah ada; membership/scope dan pencabutan B3 tetap berlaku. Result/manifest memuat sumber, versi/metode, status data serta provenance frozen hasil tersebut |

Setelah integrasi on-demand dari dev, readiness Node/Python dengan key saja
memeriksa konfigurasi, bukan validitas credential, kuota atau availability NASA.
Probe tidak mengirim request ke NASA. Pada hosted app, binding privat tetap
diwajibkan; web anonim tetap tanpa login. Legacy tetap memerlukan pemeriksaan DB.

Ready lokal berbasis store memeriksa directory, bukan kelengkapan semua arsip, checksum setiap
tile, kemampuan disk menulis atau validitas model global. Legacy aktif juga
menguji SELECT 1, keberadaan tabel P1AnalysisJob/ResearchExport dan root artefak
canonical yang tersedia; tidak menjalankan schema repair. Ini pemeriksaan inti,
bukan deteksi semua kemungkinan drift migrasi. Deadline respons Node lima detik;
fetch internal memakai AbortSignal. Query driver yang sudah dimulai tidak selalu
dapat dibatalkan oleh deadline respons. Python Blob probe punya budget adapter;
jangan memanggil readiness berfrekuensi tinggi tanpa kontrol ingress.

Status operator hanya SELECT dan proyeksi allowlist, tanpa raw error, payloadRef,
objectKey, request input, lease token atau identitas pengguna. Kegagalan CLI
menghasilkan OPERATIONAL_STATUS_UNAVAILABLE. Report melewati scanner secret
publikasi sebelum dicetak; tetap simpan report di akses operator, bukan public.
Snapshot latest registered dataset bukan provenance semua job lama; gunakan
manifest hasil individual untuk rekonstruksi versi. RawBatch bersifat global dan
tidak mempunyai workspaceId, sehingga tidak aman dipublikasikan sebagai daftar
batch untuk setiap anggota workspace. Tidak ada status job persisten anonim:
request aktif tetap sinkron dan browser menyimpan bundle sukses lokal.

### Catatan kualitas Nathan

- N1: revisi NRT → standard belum diukur; snapshot dan skala sensitivitas adalah
  bukti/asumsi yang dibedakan, bukan correction factor atau validasi semua wilayah.
- N2: transfer bersifat domain-specific. Kalteng/Papua tetap unsupported; estimasi
  di luar dukungan tetap null. Pemindahan deployment tidak memperluas domain.
- N3: QA coverage no-go pada jadwal ini; denominator tidak tersedia dan coverage
  tetap null, bukan nol atau bukti tidak ada api.
- N4: reproduksi membutuhkan arsip/model/checksum yang sama. Versi berubah harus
  tampak sebagai perbedaan, bukan ditutupi untuk membuat check lolos.

Rujukan: [Nathan N1/N3/N4](data/sprint-3-nrt-qa-reproducibility.md) dan
[harmonisasi/transfer N2](data/harmonization.md). Status ready tidak berarti empat
review tersebut selesai di staging atau setiap hasil scientifically validated.

## Migrasi sebagai langkah deployment terpisah

1. Pastikan target staging terotorisasi, backup database dan root artefak tersedia,
   serta akses role migrasi terpisah dari HTTP runtime. Catat release/migration
   checksums tanpa menyalin DSN/secret ke log.
2. Pasok environment privat, jalankan `npm run deploy:check -- migration`.
3. Jalankan opt-in secara eksplisit:

```bash
RESEARCH_DEPLOY_MIGRATIONS=true npm run deploy:migrate
```

Wrapper memanggil Prisma CLI lokal `migrate deploy`, menahan stdout/stderr driver
dan hanya mencetak MIGRATION_SUCCEEDED/FAILED atau CONFIG_INVALID. Tidak otomatis
menjalankan reset, dev migration, generate schema, baseline atau resolve migration.
Build tetap `prisma generate && next build` tanpa migrasi. Tidak ada import/run
migrasi dari HTTP, readiness, status, worker atau job analisis. Tes memeriksa graph
source HTTP/runtime dan native migrate dua kali pada schema terisolasi.

4. Setelah sukses, jalankan deploy check untuk role yang akan dinyalakan,
   readiness dan status operator; baru lanjutkan handoff staging Tahap 8.
5. Jika migrasi gagal, jangan retry buta/reset/drop histori. Tahan rollout,
   periksa state migrasi/backup dengan operator berwenang dan log yang dilindungi.
   Re-run migrate deploy bersifat idempoten bila migrasi sebelumnya selesai;
   migrasi setengah gagal membutuhkan investigasi, bukan SQL repair otomatis.

## Runbook kegagalan staging

1. Health gagal: periksa proses/routing. Jangan memulai ingest/migrasi pada probe.
2. Health hidup tetapi ready 503: operator menjalankan deploy check pada role,
   memeriksa binding, ketersediaan dataset/catalog, database schema dan storage
   privat melalui kanal aman. Tidak ada detail dependency pada respons publik.
3. Ingest FAILED/REJECTED atau missing source: gunakan status operator dan batch
   metadata privat. VALID/EMPTY tidak berarti coverage QA lengkap. Jangan
   mengganti missing dengan nol, menggabungkan NRT-standard diam-diam, atau
   mengulangi ingest dengan requestId baru tanpa memahami idempotensi.
4. Job/ekspor gagal atau lease menggantung: ikuti [ketahanan proses](bagas-sprint-3-process-resilience.md)
   dan [pemulihan](bagas-sprint-3-recovery.md). Jangan hapus attempt/result/report.
   Pertahankan hasil lama dan guard B1, tanpa ETA buatan.
5. Dugaan kebocoran log: hentikan distribusi log, batasi akses, rotasi credential
   terdampak melalui pengelola secret; jangan mengirim raw log/DSN ke issue.
   Auth.js error/warn kini memakai fixed allowlist; debug mati. Python CLI error
   argumen, manifest, archive/ingest/sync tidak mencetak exception mentah/path.
   Worker/producer/publisher memakai bounded error dan pipe stderr privat.
6. Kumpulkan status aman, ID release/manifest yang boleh dibagikan dan bukti
   kualitas aktual untuk Orkhan/Nathan. Hanya Tahap 8 yang memfinalisasi O4,
   observasi log/provider nyata dan izin rollout/promosi.

Redaction yang diuji adalah pada entrypoint/aplikasi repo, bukan janji bahwa log
platform, CLI vendor yang dijalankan langsung, debug pihak ketiga, atau error
infrastruktur di luar wrapper otomatis aman. Jangan aktifkan debug/trace SDK atau
mencetak environment pada CI. Artifact diagnostik/snapshot browser dan benchmark
adalah alat developer privat, bukan log operasional yang boleh dipublikasikan.

## Verifikasi

Tes sintetis mencakup field config invalid tanpa nilai secret, unknown/public
secret, liveness/readiness dependency gagal, empty dataset, exception manifest,
parser CLI, status counts/provenance projection, serta tidak ada migrasi request.
Native PostgreSQL membuktikan database belum bermigrasi tidak ready, migrate
deploy dua kali sukses, lalu ready dan pembacaan status tidak mengubah histori
migrasi. Tidak ada database produksi yang dimigrasikan.

Di luar simulasi lokal Tahap 8 tetap terbuka: Preview/staging nyata, konfigurasi provider dan secret
aktual melalui kanal aman, uji integrasi Orkhan/Nathan O4, review manusia dan
checklist akhir B4. Tidak ada klaim deployment atau cron cloud sudah berjalan.

Bukti historis sesi Tahap 7: **293/293 tes Node** dan **168/168 tes Python** tanpa skip dengan
PostgreSQL native sementara; typecheck, lint, check:contracts, ruff file Python
terkait, build produksi dan git diff --check lulus. Lint exit 0 dengan enam warning
lama noNonNullAssertion di research-export.ts. Review independen menemukan dua
kasus tepi (manifest exception dan empty dataset); keduanya diperbaiki melalui
regresi gagal-lalu-lulus. Migrasi nyata hanya dijalankan pada schema uji acak
deployment_test_* di database localhost research_worker_test. Tidak ada commit otomatis dalam sesi verifikasi.
