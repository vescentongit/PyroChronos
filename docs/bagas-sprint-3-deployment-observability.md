# Tahap 7 — konfigurasi, migrasi terpisah dan observabilitas

R2-P2-B4 bagian 1, 15 November 2026. Persiapan teknis staging saja: tidak
menjalankan deployment cloud, aktivasi scheduler, backfill, promosi produksi,
atau migrasi database pengguna. Handoff O4 bersama Orkhan/Nathan tetap Tahap 8.

## Pemeriksaan konfigurasi dan secret

`npm run deploy:check -- ROLE` memvalidasi environment yang disediakan operator;
tidak memuat/mencetak file .env atau nilai secret. Role: app, pipeline, worker,
export-worker, ingest, migration. Output hanya role normal, ok dan nama field
konfigurasi yang gagal. Role tidak dikenal menjadi unknown. Check tidak melakukan
koneksi jaringan dan bukan bukti credential benar-benar berfungsi.

| Role | Konfigurasi minimum |
| --- | --- |
| app anonim lokal | RESEARCH_DATA_DIR atau PIPELINE_URL binding; database/OAuth tidak diwajibkan |
| app hosted | PIPELINE_URL disuntik runtime Vercel; URL tanpa credentials/query/fragment. Jangan set binding manual di konfigurasi hosting |
| app legacy aktif | RESEARCH_V2_EXPERIMENTAL=true, DATABASE_URL PostgreSQL, AUTH_SECRET minimal 32 karakter, Google provider ID/secret, RESEARCH_ARTIFACT_ROOT absolut privat |
| pipeline | RESEARCH_DATA_DIR lokal, atau FIRMS_BLOB_BASE_URL HTTPS dan BLOB_READ_WRITE_TOKEN; pemeriksaan Blob hostname/token detail dilakukan adapter Python |
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
| GET /ready Python | Internal: local directory harus dikonfigurasi dan tersedia; hosted Blob mencoba membaca pointer/catalog pinned melalui adapter terbatasi. Empty env tidak dianggap directory siap |
| npm run research:status | CLI operator privat: counts ingest/job/ekspor, fingerprint/sources/mode dataset terdaftar dan catatan N1–N4. Global/operator scope, **tidak** dijadikan HTTP workspace API |
| /api/v2/workspaces/.../jobs/:id dan result/days/detections/exports | Status individual lewat kontrak legacy berotorisasi yang sudah ada; membership/scope dan pencabutan B3 tetap berlaku. Result/manifest memuat sumber, versi/metode, status data serta provenance frozen hasil tersebut |

Ready lokal memeriksa directory, bukan kelengkapan semua arsip, checksum setiap
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

Tahap 8 tetap terbuka: Preview/staging nyata, konfigurasi provider dan secret
aktual melalui kanal aman, uji integrasi Orkhan/Nathan O4, review manusia dan
checklist akhir B4. Tidak ada klaim deployment atau cron cloud sudah berjalan.

Bukti sesi: **293/293 tes Node** dan **168/168 tes Python** tanpa skip dengan
PostgreSQL native sementara; typecheck, lint, check:contracts, ruff file Python
terkait, build produksi dan git diff --check lulus. Lint exit 0 dengan enam warning
lama noNonNullAssertion di research-export.ts. Review independen menemukan dua
kasus tepi (manifest exception dan empty dataset); keduanya diperbaiki melalui
regresi gagal-lalu-lulus. Migrasi nyata hanya dijalankan pada schema uji acak
deployment_test_* di database localhost research_worker_test. Tidak ada commit.
