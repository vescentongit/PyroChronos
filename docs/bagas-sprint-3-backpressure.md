# Bagas Sprint 3 — Tahap 3: batas kapasitas dan backpressure

Implementasi `R2-P2-B1`, 14 November 2026. Dasar keputusan adalah
[benchmark Tahap 1/2](bagas-sprint-3-capacity.md) dan JSON sampel anonim/native
di `docs/benchmarks`. Angka pengukuran tersebut tidak diubah atau dinyatakan
sebagai benchmark ulang kode Tahap 3. Tidak ada pengubahan polygon, ETA,
tarif deployment ataupun migrasi schema database.

## Policy yang diterapkan

`src/lib/research-capacity.ts` memusatkan policy `research-capacity-1`.
Benchmark terbesar hanya mencakup 12.000 observasi; belum membenarkan kenaikan
batas observasi, byte, timeout, atau klaim kapasitas deployment global.

| Batas | Nilai / cakupan | Keputusan |
| --- | --- | --- |
| Analisis anonim | 1 aktif per proses/module route | Dipertahankan; slot dilepas di `finally` termasuk setelah kegagalan producer |
| Kuota anonim | 30 analisis yang diterima/rolling 60 detik per proses | Guard baru konservatif, mengikuti angka kuota legacy sebagai kebijakan; bukan throughput yang dibuktikan benchmark anonim |
| Analisis P1 dan P0 legacy | 5 queued/running per workspace | Dipertahankan; P1 menserialisasi submission dengan lock workspace |
| Ekspor legacy | 5 queued/running per workspace, terpisah dari analisis | Guard antrean baru konservatif; angka ini belum dibenchmark sebagai kapasitas ekspor berkelanjutan |
| Kuota tulis legacy | 30 receipt baru/menit per scope operasi/workspace/actor | Dipertahankan di `idempotent`; retry requestId/payload sama tidak mengonsumsi receipt baru |
| Body JSON request | 100.000 byte | Anonim, handler P1 dan catch-all legacy memakai bounded reader yang memeriksa content-length serta byte stream, sebelum JSON.parse |
| Bundle producer | 100.000.000 byte lokal, 4.000.000 byte hosted | Dipertahankan; overflow adalah payload terlalu besar, bukan sinyal antrean sibuk |
| Bundle observasi anonim/P0 | 100.000 observasi | Dipertahankan pada producer dan validator; tidak truncate |
| Input observasi server | 128 artefak, default 64 MiB baca / 256 MiB untuk worker ekspor; 1.000.000 observasi unik | Guard lama dipertahankan; deteksi konflik, checksum dan validasi scope tetap berlaku |
| CSV/manifest ekspor | 64 MiB per object | Guard stream CSV eksplisit sebelum storage, serta pemeriksaan manifest sebelum put; metadata/verified storage tetap memvalidasi |
| Snapshot inspeksi ekspor | 1.000 lokasi / 2.000 assignment / 2.000 report | Dipertahankan, tidak memotong snapshot |
| Worker P1 | processor 300 detik, lease 60 detik, heartbeat 15 detik, max 3 attempt | Tidak diubah oleh B1; kebijakan pemulihan tetap task B2 |

Kuota anonim menghitung admission, termasuk producer yang kemudian gagal;
penolakan busy/quota tidak menambah hitungan. `workspaceId` tidak membentuk bucket
karena dapat dipilih/diganti pengunjung anonim. Action `area` tetap tersedia
ketika kuota analisis penuh dan tetap memvalidasi geometri/body. Ini bukan rate
limiter edge, per-IP, per-user atau koordinasi antar-replica. Restart proses
mengosongkan kuota lokal. Deployment multi-replica memerlukan admission bersama
di ingress/service bila batas global diperlukan; belum menjadi klaim implementasi.

Cache/deduplikasi legacy diperiksa **sebelum** batas antrean. Job sukses/ekspor
ready yang sudah ada dapat dipakai kembali meski antrean penuh. RequestId baru
tetap tunduk kuota receipt. Pembacaan GET tidak memakai admission/receipt quota:
hasil analisis, hari, deteksi, status ekspor, CSV dan manifest tetap melalui
otorisasi serta validasi integritas yang sama.

## Kontrak untuk Orkhan

Error publik anonim kini menggunakan bentuk error v2 yang sama dengan legacy:

```json
{"schemaVersion":"research-2","error":"CAPACITY LIMIT","code":"CAPACITY_LIMIT","retryable":true,"requestId":null}
```

`requestId` anonim diisi UUID dari request analisis yang lolos schema, atau null
bila belum diketahui. Legacy mempertahankan trace nullable yang sudah ada.
Body tidak memuat exception, path, kredensial atau ETA.

| HTTP / code | retryable | Retry-After | Tindakan frontend |
| --- | --- | --- | --- |
| 503 CAPACITY_LIMIT | true untuk penolakan admission | `2` detik | Backoff minimum, jangan retry otomatis berulang tanpa kontrol pengguna |
| 429 RATE_LIMITED | true | `60` detik | Tunggu minimum ini sebelum mencoba submission baru |
| 413 PAYLOAD_TOO_LARGE | false | Tidak ada | Request/bundle melampaui guard byte; request identik tidak akan pulih dengan menunggu |
| 400 INVALID_REQUEST | false | Tidak ada | Validasi gagal; perbaiki input secara eksplisit |
| 503 DEPENDENCY_UNAVAILABLE | true | Tidak ditambahkan oleh perubahan ini | Ketergantungan gagal; pertahankan konteks hasil lama |

`Retry-After` adalah jarak minimum retry berdasarkan policy, **bukan ETA selesai**
atau janji slot tersedia pada waktu tersebut. JSON Schema error, job dan ekspor
ditambah enum PAYLOAD_TOO_LARGE; tidak ada perubahan bentuk field schema.
Adapter Python internal tetap memakai error singkat `{code}`; output JSON hosted
terlalu besar mengembalikan 413, lalu route publik membungkus error v2.

Kegagalan ekspor terminal (`status: failed`) selalu mengirim `error.retryable=false`.
Worker tetap dapat melakukan retry internal untuk dependency failure sebelum
terminal; overflow stream/object tidak dijadwalkan retry sebagai storage transient.
Guard snapshot/observasi yang sudah memakai CAPACITY_LIMIT mempertahankan kode itu;
header retry pada penolakan HTTP tidak menjamin input sebesar itu akan dapat
diproses. Frontend tidak boleh memotong polygon/periode/hasil untuk mengejar guard.

Klien anonim mempertahankan `ResearchApiError.code` dan meneruskan Retry-After
numerik sebagai `retryAfter`. `submitResearch` baru menulis bundle/history/pointer
setelah respons sukses dan valid. Respons 429/503/413 tidak menghapus data lama,
tidak mengganti ID hasil terakhir, dan tidak mengosongkan cache hasil aktif.
Tidak ada retry POST otomatis atau kalkulasi ETA baru.

Handoff copy UI untuk Orkhan: `src/components/research-panel.tsx` masih memakai
pesan CAPACITY_LIMIT lama yang menyarankan mengecilkan pilihan, dan PAYLOAD_TOO_LARGE
masih masuk pesan retry generik. Sinkronkan pemetaan copy dengan tabel di atas:
bedakan admission sibuk dari batas byte permanen, pertahankan akses hasil lama,
dan minta perubahan input hanya melalui tindakan eksplisit pengguna. Perubahan
copy UI tersebut tidak termasuk perubahan backend/klien penyimpanan Tahap 3 ini.

## Bukti otomatis dan reproduksi

Semua fixture/data uji sintetis. Tes mencakup:

- Admission anonim concurrent, quota tidak dapat direset dengan workspaceId,
  slot dilepas setelah failure, dan kuota pulih setelah rolling window.
- Respons error schema v2 dan Retry-After untuk 429/503; 413 tanpa header retry.
- Body melampaui guard melalui header maupun stream; hosted output overflow.
- Penolakan submission anonim tidak menulis IndexedDB/localStorage; hasil lama
  tetap terbaca setelah cache memori dieviksikan (IndexedDB test double).
- Antrean ekspor PGlite lima slot dan 30 receipt: penolakan baru tidak mengganggu
  analisis lama, status/CSV/manifest; cache ready tetap diterima saat antrean penuh.
- PostgreSQL native sementara: submit → worker → publikasi aktual, enam submission
  paralel (lima diterima), quota 30 receipt, dan pembacaan hasil/hari/deteksi serta
  ekspor lama sesudah penolakan kapasitas maupun kuota.
- Stream overflow menutup sumber, storage file nyata membersihkan object parsial,
  dan kode kapasitas dipertahankan meskipun storage menyamarkan exception.
- Ekspor terminal capacity failure tidak mengiklankan automatic retry.

Gunakan konfigurasi database uji localhost `research_worker_test` dan Python
seperti runbook [Tahap 2](bagas-sprint-3-capacity.md). Semua native test membuat
schema acak terisolasi, tidak memakai data produksi.

```bash
node --test tests/research-capacity.test.mjs tests/local-research-backpressure.test.mjs tests/local-research-cache.test.mjs tests/research-exports-api.test.mjs tests/research-exports.test.mjs tests/research-p1-e2e-native.test.mjs
npm run typecheck
npm run lint
npm run check:contracts
git diff --check
```

Full Node/Python suites dan build Next juga dijalankan untuk integrasi. Tidak ada
review manusia Orkhan yang diasumsikan dari hasil tes; checklist verifikasi teknis
dapat dicentang, tetapi checklist gabungan “selesai dan direview” tetap menunggu review.

Verifikasi suite akhir: **268/268 Node**, **163/163 Python**, tanpa skip,
PostgreSQL 16 lokal sementara aktif; typecheck, lint, contract checks, ruff adapter
Python dan `git diff --check` lulus. Lint mengembalikan exit 0 dengan enam warning
`noNonNullAssertion` lama di `src/lib/research-export.ts`; tidak ada error lint baru.
Build produksi Next.js beserta Prisma generate lulus. Review kode independen
tidak menemukan masalah Critical/Important; catatan copy UI menjadi handoff Orkhan.
