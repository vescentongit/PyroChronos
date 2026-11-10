# PyroChronos — API dan payload riset v2

**Status:** kontrak target implementasi berdasarkan [product.md](../../product.md), 10 November 2026. Schema dan contoh tersedia; endpoint v2 belum dianggap aktif. Mandat Orkhan untuk menetapkan payload tetap berlaku. Validasi metode, review kode, dan integrasi nyata merupakan pekerjaan terpisah.

**Versi payload respons:** research-2. **Namespace target:** /api/v2. **Consumer lama:** [API v1](api-v1.md), Snapshot 1, serta hotspots-1 tetap untuk kompatibilitas dan tidak diubah diam-diam.

Schema runtime: [research-contracts.ts](../../src/lib/research-contracts.ts). JSON Schema: [folder v2](v2/). Contoh seluruh request/resource: [api-v2.examples.json](api-v2.examples.json), seluruhnya sintetis. Jalankan npm run check:contracts dan node --test tests/research-contracts.test.mjs. Regenerasi JSON Schema: node scripts/check-contracts.mjs --write, lalu review diff dan jalankan pemeriksaan lagi.

## 1. Pembagian handoff

| Pemilik | Tanggung jawab |
|---|---|
| Nathan | Observasi asli, polygon/time query, raw per sumber, manifest, count terharmonisasi, referensi bergerak, serta evaluasi/domain metode |
| Bagas | Identitas/workspace, area/revisi, job persisten, validasi producer, publikasi atomik, API, lokasi/penugasan/laporan, ekspor dan otorisasi |
| Orkhan | Consumer schema-valid, kamera/AOI/hasil terpisah, kalender/detail/perbandingan, lokasi/pemeriksaan, ekspor visual, EN/ID dan acceptance |

Ketiganya dapat bekerja dengan fixture sintetis tanpa menunggu endpoint nyata atau polygon final dua wilayah. Fixture tidak menjadi fallback tersembunyi untuk data nyata. Nama entitas/payload di sini adalah target, bukan klaim migrasi Prisma atau route sudah selesai.

## 2. Konvensi dan invariants

- JSON UTF-8, camelCase, ID opaque; jangan menyusun ID dari urutan baris CSV atau posisi pada array.
- Timestamp ISO-8601 ber-offset; produsen mengirim UTC Z. Tanggal penelitian YYYY-MM-DD. start dan end inklusif dalam UTC; backend mengubah end menjadi batas eksklusif awal hari berikutnya untuk kueri. Rentang mulai awal 2000-an mengikuti ketersediaan sumber; permintaan data masa depan ditolak server.
- Polygon WGS84 [longitude, latitude], dengan exterior ring lalu holes. Closure/rentang koordinat diperiksa schema; topologi/self-intersection, holes, luas, normalisasi antimeridian dan hash canonical wajib diperiksa service geometri. Client tidak menentukan areaKm2 atau geometryHash.
- Area baru/revisi mengunci geometri analisis. Revisi tidak menimpa geometri run lama. Camera viewport/zoom bukan identitas AOI atau analisis.
- null berarti tidak tersedia/tidak dapat dinilai. Tidak ada deteksi tercatat, sumber gagal, cakupan tidak diketahui, dan observasi valid tanpa deteksi tidak disamakan.
- Secret, URL FIRMS berkredensial, stack trace, atau link raw privat tidak masuk respons/export/log. Identitas pelaku berasal dari sesi; body request strict menolak workspaceId, recordedBy, assignedBy, dan field hasil yang tidak diperbolehkan.
- Semua referensi resource lintas body/path diverifikasi server. JSON Schema bukan pengganti membership, point-in-polygon, otorisasi, referensi data/model, atau transaksi.

## 3. Workspace, membership, dan akses

Resource penelitian privat memakai prefix **/api/v2/workspaces/:workspaceId**. Setiap operasi memeriksa sesi individual dan membership aktif, termasuk poll job, raw detail, cache serta download. Basemap publik dan eksplorasi NRT legacy tidak otomatis membuka catatan tim.

Policy awal untuk implementasi: owner mengelola membership; member aktif dapat membaca analisis/catatan tim, membuat analisis/lokasi, menugaskan anggota aktif, dan mencatat pemeriksaan. Perubahan assignment oleh assignee, pembuat assignment atau owner; koreksi laporan oleh pencatat asli atau owner. Larangan akses tetap diperiksa di server. Kebijakan ini diuji sebagai bagian task Bagas; shared coordinator token tidak memenuhi kontrak ini.

| Endpoint target | Body / response |
|---|---|
| POST /api/v2/workspaces | workspace-create → 201 workspace; owner berasal dari sesi |
| GET /api/v2/workspaces | 200 list workspace yang boleh diakses |
| GET .../members | 200 list membership |
| PUT .../members/:userId | membership-update → 200/201 membership; owner-only |

Membership update memakai expectedRevision null untuk pembuatan, revision positif untuk perubahan, role owner/member dan active. Jangan menonaktifkan owner aktif terakhir. User yang sudah tidak aktif tidak bisa mengakses resource tim; identitas pada audit lama tetap disimpan. List umum berbentuk {items, nextCursor}; limit default 50, maksimum 100, cursor opaque terikat resource/filter/workspace. Tidak ada integrasi undangan email otomatis dalam kontrak ini.

## 4. Area dan pengajuan analisis

Prefix seluruh endpoint tabel berikut: /api/v2/workspaces/:workspaceId.

| Endpoint | Body/schema | Respons |
|---|---|---|
| POST /areas | area-create: requestId, name, geometry | 201 area |
| GET /areas | cursor/limit | 200 list area |
| GET /areas/:areaId | — | 200 area |
| POST /analyses | analysis-create | 202 job; 200 job boleh untuk hasil identik yang sudah selesai |
| GET /jobs/:jobId | — | 200 job |
| GET /analyses/:analysisId | — | 200 result setelah publikasi |

Edit geometri membuat area/revisi baru dengan hash baru; kontrak awal dapat membuat area ID baru untuk revisi tersebut. Analisis lama tetap menunjuk salinan geometri/versinya. Tidak ada daftar enum area kalteng/papua pada v2. Kedua area hanya preset/studi unggulan.

analysis-create berisi requestId UUID, areaId, areaRevision, period, comparisonPeriod nullable, baseline {kind: rolling-same-calendar-period, windowYears: 10}, referenceScale MODIS-equivalent, qualityPolicyVersion, dan monitoringLocationId nullable untuk analisis lanjutan lokasi. Jika windowYears dihilangkan, parser menggunakan 10. Server memvalidasi konfigurasi yang dikenal serta batas layanan sebelum mengantrekan; batas yang belum lolos benchmark tidak dinyatakan sebagai SLA.

Periode pembanding menggunakan polygon dan versi metode yang sama. monitoringLocationId, jika diisi, harus milik workspace yang sama; pengaitan analisis baru tidak memindahkan anchor lokasi. Tidak ada analisis yang dipicu otomatis oleh GET/pan/zoom.

### Idempotensi dan identitas analisis

Semua request tulis memiliki requestId. Scope idempotensi adalah workspace + actor + operasi/resource + requestId. Payload canonical yang sama mengembalikan hasil yang sama; payload berbeda menghasilkan 409 IDEMPOTENCY_CONFLICT. Retry mempertahankan requestId; tindakan baru memakai ID baru.

analysisKey dihitung server dari hash/revisi geometri, periode primer/pembanding, baseline, kebijakan kualitas, konfigurasi satelit, versi arsip, model dan agregasi. Zoom/bbox kamera tidak masuk key. Input identik dapat memakai hasil/job yang sama dalam scope izin yang benar; requestId berbeda tidak harus mengulang komputasi. Revisi sumber/model menghasilkan key baru. Sharing compute tidak membocorkan metadata workspace.

## 5. Job dan publikasi

| Status | Aturan |
|---|---|
| queued | startedAt/completedAt/resultId/error null |
| running | startedAt ada, completedAt/resultId/error null |
| succeeded | completedAt dan resultId ada, error null; hasil sudah tervalidasi payload dan terbit atomik |
| failed | completedAt/error ada, resultId null; tidak mengganti hasil valid sebelumnya |

stage nullable: ingest, aggregate, harmonize, evaluate, publish. progressPercent nullable dan hanya diisi jika dapat diukur. Sukses job berarti pemrosesan selesai, bukan bukti model harmonisasi valid untuk semua domain. Worker mengklaim pekerjaan secara atomik, menyimpan input immutable dan lease/retry yang bertahan restart. Retry tidak memundurkan objek job terminal diam-diam; attempt baru ditelusuri dan job/result baru bila input berubah.

Frontend polling menghormati Retry-After bila ada; interval awal yang disarankan 2 detik dengan backoff hingga 15 detik, berhenti saat terminal. Retry endpoint baca tidak mengirim analysis-create baru. Peta tetap interaktif; hasil lama mempertahankan label area/periode, bukan ditampilkan seolah milik permintaan baru.

## 6. Hasil penelitian dan kalender

result memuat identitas run/job/workspace, mode research/replay/demo, snapshot area lengkap, primary/comparison, baseline, method, sources, dataVersion, qualityPolicyVersion, generatedAt/publishedAt, serta months berurutan. Semua bulan dalam periode primer hadir, termasuk no_data; bukan menghilangkan bulan tanpa data.

| Field | Semantik |
|---|---|
| primary/comparison | period, days inklusif UTC, dan metric; comparison boleh null |
| metric.rawCountsBySource | Count integer per sumber terkonfigurasi; sumber tidak tersedia tetap dicantumkan dengan null |
| metric.rawCount | Jumlah deteksi mentah yang diterima dari sumber tersebut; bukan seri lintas sensor yang otomatis setara |
| metric.harmonizedCount | Estimasi jumlah deteksi pada skala acuan MODIS; non-negatif, boleh pecahan, nullable |
| metric.status | available, partial, no_data, method_unsupported; status menjelaskan kelengkapan/dukungan |
| method | name/version, unit estimated-hotspot-detections, referenceScale MODIS-equivalent, validation dan validationDomain, manifestId |
| sources | Produk/versi, NRT/STANDARD, status, batas waktu observasi dan checksum; bukan ukuran bebas awan |
| mode | research untuk hasil nyata yang memenuhi status validasi; replay untuk evaluasi retrospektif/eksperimen berlabel; demo untuk contoh sintetis |

Manifest producer menyimpan batch/checksum, kualitas/confidence/type, grid/agregasi, pasangan observasi, aturan satelit/overlap, train/test, domain, evaluasi, model dan kebijakan referensi. Count asli tidak dijumlahkan lalu diberi label harmonisasi. Count nol tidak menjamin tidak ada api. Estimasi unsupported null; mode research dengan estimasi menuntut validation validated. Hasil eksperimen dapat berlabel replay/demo dengan batas interpretasi jelas. Titik asli tetap terpisah; estimasi tidak dibuat menjadi sejumlah titik fiktif.

HarmonizedCount merupakan agregat konsisten dari unit model yang dibekukan pada manifest. Total bulan sesuai primary summary. Ketika ada bulan hilang, summary diberi status parsial/no_data sesuai kelengkapan; total sebagian yang diterima tidak diklaim total lengkap. Perbedaan panjang periode menampilkan days dan bila perlu count per hari; persentase perubahan pada pembanding nol bernilai null dengan alasan. Tidak ada target penurunan MAE dari paper yang dianggap sudah tercapai.

### Anomali dan referensi bergerak

baseline berisi kind, windowYears, minimumValidYears dan policyVersion yang disahkan metode. Default 10 tahun adalah Y-10 sampai Y-1 pada bulan yang sama, misalnya Agustus 2026 menggunakan Agustus 2016–2025. Tahun target dan masa depan dilarang. minimumValidYears dipilih melalui evaluasi dan dicatat; contoh memakai 10, bukan pemilihan otomatis tahun berapa pun yang tersedia.

Setiap month memiliki anomaly: status assessed/insufficient_history/insufficient_data/method_unsupported, referenceYears aktual, baselineStatistic mean/median nullable, baselineValue, delta dan scoreKind/score nullable. Estimator dan score belum otomatis dipilih produk; manifest harus membekukannya. delta = harmonizedCount - baselineValue ketika assessed. Skor percentile dibatasi 0–100; z-score memiliki satuan/metode berbeda dan bukan probabilitas api.

Referensi yang tidak cukup menghasilkan nilai anomali null, sementara count yang tersedia tetap terlihat. Bulan parsial memakai isPartialPeriod dan pembanding durasi/musim yang cocok; aturan leap day serta partial-window tercatat. Baseline nol/variasi nol tidak menghasilkan infinity. Schema memeriksa beberapa invariants; server tetap memverifikasi kelengkapan, aturan musim, validasi model dan konsistensi manifest.

## 7. Detail harian, peta dan observasi asli

| Endpoint | Respons |
|---|---|
| GET .../analyses/:id/days?month=YYYY-MM&periodRole=primary | daily-page; cursor/limit untuk halaman lanjutan |
| GET .../analyses/:id/detections?periodRole=primary | detections-page, cursor; maksimum 1000 observasi/halaman |
| GET .../analyses/:id/tiles/:layer/:z/:x/:y | Tile overlay terikat hasil immutable; layer raw-density atau estimated-grid |

periodRole primary/comparison selalu eksplisit; comparison ditolak jika analisis tidak memiliki periode pembanding. Detail harian hanya memuat irisan bulan dengan periode terkait. Missing day/bulan ditampilkan eksplisit pada kalender, bukan diasumsikan nol karena tidak ada row.

Observasi membawa id, sourceId, observedAt, coordinates asli, confidence sumber, frpMw nullable. Nama wilayah dapat ditambahkan lewat lookup/metadata di luar bukti sensor, dengan sumber dan ketidakpastian; koordinat tidak direkayasa dari centroid cluster. Query detail/CSV diterapkan pada polygon sebenarnya, bukan bbox saja atau pusat grid kasar.

Tile hanya proyeksi hasil analisis. layer raw-density menyajikan deteksi asli, estimated-grid menyajikan estimasi agregat dengan satuan yang jelas; renderer wajib menjaga perbedaan itu. Content type/encoding tile ditetapkan provider dan dicatat pada implementasi; jumlah cluster tidak dipakai sebagai satu pengamatan. Cache terikat analysis/data/model version dan tile index, tanpa memanggil FIRMS lagi pada setiap gerakan kamera. Backend wajib memeriksa hak baca meskipun tile ter-cache. Gambar basemap baru tidak memulai job historis.

## 8. Lokasi pemantauan dan pemeriksaan

| Endpoint | Request → respons |
|---|---|
| POST .../locations | location-create → 201 location |
| GET .../locations | 200 list location |
| GET .../locations/:id | 200 location |
| POST .../locations/:id/assignments | assignment-create → 201 assignment |
| GET .../locations/:id/assignments | 200 list assignment |
| PATCH .../assignments/:id | assignment-update → 200 assignment |
| POST .../assignments/:id/reports | report-create → 201 report |
| GET .../locations/:id/reports | 200 list report, termasuk pemeriksaan terdahulu |
| PATCH .../reports/:id | report-correction → 200 report |

location-create hanya menerima requestId, analysisId, anchorDetectionId dan name. Backend memverifikasi observasi asli dalam analisis lalu menyalin anchor, area/revisi, workspace dan createdBy. Body tidak memasukkan coordinates/createdBy. ID lokasi stabil ketika feed/periode berubah. initialAnalysisId dan bukti awal tidak ditimpa analisis berikutnya. Radius area sekitar anchor belum dibekukan; gunakan referensi AOI yang eksplisit tanpa menganggapnya footprint sensor.

Assignment menggunakan assigneeUserId anggota aktif. Status assigned → in_progress/completed/cancelled; in_progress → completed/cancelled. completed/cancelled terminal; pemeriksaan ulang membuat assignment baru. Label belum ditugaskan diturunkan dari tidak adanya pekerjaan aktif, bukan status lokasi aman. Penyelesaian memerlukan laporan pemeriksaan; outcome inconclusive boleh menyelesaikan tugas tanpa mengonfirmasi kondisi api. Simpan laporan dan ubah status sebagai tindakan eksplisit, bukan menganggap simpan otomatis berarti selesai.

Status patch dan koreksi memakai expectedRevision; increment revision setelah commit. Stale revision menghasilkan 409 REVISION_CONFLICT. Retry requestId sama mengembalikan efek sebelumnya. Event perubahan status dicatat server dengan actor/time/from/to. Field tersebut bukan payload yang dapat dipalsukan client.

Outcome laporan memakai nilai stabil: fire_or_smoke_found, no_sign_at_inspection, inconclusive; UI menerjemahkan EN/ID. inspectorUserId berbeda dari recordedBy yang berasal dari sesi; observedAt adalah waktu pemeriksaan, bukan waktu input. Server menolak waktu pemeriksaan masa depan. Perubahan yang dibenarkan menyimpan keadaan lama dalam corrections beserta revision, actor, waktu dan reason, bukan menghapus histori. Rincian assignment/workspace/anchor diturunkan server, bukan dari body create-report.

Satu lokasi dapat mempunyai beberapa assignment dan laporan. Status selesai diperiksa bukan api padam. Deteksi baru setelah pemeriksaan tetap terlihat. Jumlah laporan/pemeriksaan tidak otomatis menjadi jumlah kejadian kebakaran unik; metrik kejadian memerlukan identitas kejadian dan aturan deduplikasi tersendiri.

## 9. Ekspor dan visualisasi

| Endpoint | Request → respons |
|---|---|
| POST .../exports | export-create → 202 export; 200 jika artefak identik sudah siap |
| GET .../exports/:id | 200 export |
| GET .../exports/:id/download | File CSV setelah pemeriksaan akses ulang |

Ekspor menyebut analysisId, periodRole, kind raw-hotspots-csv/harmonized-aggregates-csv, requestId. Resource export berstatus queued/running/ready/failed; hanya ready mempunyai downloadPath aplikasi /api/v2/..., hanya failed mempunyai error. Ekspor besar memakai pekerjaan terpisah/streaming, bukan menahan request analisis. analysisId menunjuk versi hasil yang diunduh, tidak diam-diam memakai latest yang berbeda.

Raw CSV menyimpan observasi asli dalam polygon/periode. CSV agregat menyimpan count estimasi beserta raw per sumber, bucket/status, AOI/revisi, unit/model, baseline dan dataVersion. Jangan mengulang titik centroid untuk membuat jumlah row sama dengan count estimasi. Lindungi CSV terhadap formula injection dan lakukan escaping yang benar.

Target awal ekspor visual adalah PNG kalender/grafik yang dibuat frontend dari result yang sama. Tidak memerlukan endpoint render baru pada v2 ini. Gambar menyertakan nama/revisi AOI, periode, legenda, unit, model/acuan, baseline, versi serta sumber; detail geometri dan manifest dapat diunduh bersama ringkasan JSON hasil. Fixture/replay diberi label. Format tambahan dapat dipilih kemudian tanpa mengubah semantik count.

## 10. Error, cache dan batas layanan

Error menggunakan schema error v2: schemaVersion, error aman, code, retryable, requestId trace nullable. requestId trace respons tidak menjadi pengganti idempotency key body. Tidak ada raw exception atau kredensial di dalam error.

| HTTP | Code |
|---|---|
| 400 | INVALID_REQUEST: geometri/parameter/referensi salah |
| 401 | UNAUTHENTICATED |
| 403 atau 404 sesuai kebijakan anti-enumerasi | FORBIDDEN / NOT_FOUND |
| 409 | IDEMPOTENCY_CONFLICT, REVISION_CONFLICT, RESULT_NOT_READY |
| 429 | RATE_LIMITED, dengan Retry-After bila diketahui |
| 503 | DEPENDENCY_UNAVAILABLE atau CAPACITY_LIMIT, dengan penjelasan pemulihan |
| 500 | INTERNAL_ERROR tanpa detail internal |

API privat menggunakan Cache-Control private/no-store pada metadata dan catatan tim. Cache compute/spasial internal tetap boleh immutable menurut versi dan scope akses; bukan public cache response workspace. Timestamp tidak diperbarui hanya karena GET diulang. Hasil arsip immutable tidak dinyatakan stale hanya karena sudah berumur satu jam; revisi data/model atau kegagalan update terbaru ditampilkan terpisah. TTL snapshot latest v1 tidak diterapkan otomatis pada hasil historis v2.

Batas byte, vertex, area, panjang referensi, biaya/concurrency dan kuota ditetapkan setelah benchmark lalu dipublikasikan sebagai policy layanan berversi. Jangan memotong area/periode diam-diam. Ketersediaan endpoint global tidak berarti semua model/domain atau data historis telah tersedia; status unsupported/no_data tetap sah.

## 11. Migrasi dan verifikasi

Ikuti [migrasi v1 ke v2](migration-v1-v2.md). Consumer baru memakai v2; route legacy tidak mengembalikan v2 di balik schemaVersion lama. Snapshot cell-day tidak boleh diberi label ulang sebagai estimasi jumlah hotspot. Draft calendar-1 yang menggunakan grid kasar dan pembanding semua tahun memerlukan perhitungan/adapter baru, bukan sekadar mengganti nama field.

JSON Schema bersifat struktural. Aturan rolling-window, state job, referensi resource, totals, akses dan geometri harus ditegakkan service serta diuji dengan kasus negatif. Contract checker memeriksa contoh sintetis dan drift JSON Schema; tidak membuktikan implementasi endpoint, kualitas harmonisasi, atau deployment. Checklist pekerjaan ada di [sprint](../../tasks/SPRINT-PLAN.md).
