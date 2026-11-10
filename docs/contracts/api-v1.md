# PyroChronos API & payload contract v1.0

> **Legacy — kompatibilitas prototype.** Pekerjaan produk baru mengikuti [API riset v2](api-v2.md) dan [rencana migrasi](migration-v1-v2.md). Aturan wilayah tetap, sel-hari dan koordinator di dokumen ini hanya berlaku bagi consumer v1; bukan scope produk terbaru. Payload/endpoint v1 tidak diubah diam-diam.

**Status: acuan implementasi.** Orkhan menetapkan kontrak atas mandat Nathan dan Bagas sebagaimana disampaikan dalam sesi kerja. Ini menggantikan status draft kontrak snapshot. Mandat penetapan payload tidak sama dengan hasil review kode Nathan, persetujuan polygon final, atau validasi ilmiah.

Kontrak mempertahankan shape snapshot yang sudah dikonsumsi frontend. Endpoint dan migrasi yang belum tersedia tetap merupakan pekerjaan backend, bukan kemampuan yang diklaim sudah aktif.

## 1. Sumber kebenaran dan pembagian kerja

| Pemilik | Keluaran yang harus diikuti |
|---|---|
| Nathan | Output analitik per region, manifest metode/batch, ID lokasi stabil, baseline dan penilaian nullable. |
| Bagas | Validasi output Nathan, persistensi run/lokasi/laporan, publikasi atomik, endpoint, otorisasi dan audit. |
| Orkhan | Consumer payload v1, status freshness, field nullable, laporan, ekspor, state gagal dan acceptance frontend. |

Schema runtime snapshot: [snapshot.ts](../../src/lib/snapshot.ts). Schema request/response laporan dan error: [api-contracts.ts](../../src/lib/api-contracts.ts). JSON Schema struktural: [snapshot](snapshot.schema.json), [create](report-create.schema.json), [correction](report-correction.schema.json), [report](report.schema.json), [error](error.schema.json). Contoh: [api-v1.examples.json](api-v1.examples.json).

JSON Schema tidak menggantikan aturan lintas-field, akses pengguna, freshness, referensi lokasi, atau validasi waktu di server. Jalankan `npm run check:contracts`; perubahan schema harus meregenerasi JSON Schema menggunakan `node scripts/check-contracts.mjs --write`.

## 2. Aturan umum

- Transport JSON UTF-8, nama field camelCase. Timestamp RFC3339/ISO-8601 ber-offset; produsen mengirim UTC `Z`. Tidak memakai Unix detik, tanggal lokal tanpa zona, `NaN`, infinity, atau string angka.
- Field required-but-unknown dikirim `null` hanya jika schema nullable. Jangan menghapus field, mengirim string kosong sebagai angka, atau mengubah unknown menjadi nol. String `district` boleh kosong jika administrasinya tidak diketahui.
- ID adalah string opaque: consumer tidak menebak koordinat, sensor, atau posisi baris dari ID.
- Satuan kontrak: koordinat WGS84 derajat, area registry km², percentile 0–100, durasi dihitung dalam milidetik setelah parsing timestamp.
- Domain geografis v1: `kalteng` dan `papua` dengan versi `study-rectangle-v1` dari [registry](../../src/lib/regions.ts). Batas masih provisional; data dengan versi batas berbeda ditolak. Pergantian polygon menaikkan versi dan menyiapkan ulang baseline, run, serta cache.
- Secret FIRMS/database dan atribut pemberi izin tidak dikirim ke browser. Identitas pencatat berasal dari sesi server, bukan body request.

## 3. Pipeline Nathan → Bagas

Nathan menyerahkan satu output per wilayah/run, dengan field Snapshot v1 kecuali `publishedAt` dan `freshUntil`. Bagas mengisi dua field itu sesudah validasi dan commit publikasi. Type handoff: `AnalysisOutputV1` pada schema library.

1. Nathan menghasilkan `runId` unik dan immutable, geometri/versi tetap, waktu penilaian, sumber, metode, kandidat, dan seri.
2. Manifest run menyimpan daftar raw batch beserta checksum, source catalogue yang diwajibkan, konfigurasi grid (CRS, origin, ukuran, versi), pemilihan satelit referensi/overlap, clustering/lokasi, periode latih/uji dan baseline, aturan missingness, rumus percentile/persistensi/prioritas, serta status evaluasi. Manifest harus dapat ditelusuri melalui run/method version di storage; jangan hanya menyimpan label metode.
3. Bagas memvalidasi field dan referensi wilayah/lokasi, menyimpan manifest, lalu mengalihkan pointer latest-valid secara atomik. Run gagal tidak menjadi latest dan tidak menghapus run valid sebelumnya.
4. Pengulangan `runId` dengan payload yang sama idempotent; isi berbeda ditolak. Kebutuhan memperbaiki hasil menghasilkan run ID baru yang menunjuk run sebelumnya pada manifest.

Pemilihan parameter ilmiah milik Nathan dan harus berversi. Kontrak tidak menjanjikan angka peningkatan model atau menetapkan threshold tanpa evaluasi. Sampai evaluasi tersedia, gunakan `method.name="raw"`, `validation="not-evaluated"`; komponen yang tidak dapat dinilai tetap null dan alasan bilingual menjelaskannya.

## 4. Snapshot yang dibaca frontend

`GET /api/snapshots?region=kalteng` (atau `papua`). Query region wajib dan harus dikenal. Respons sukses **200 berupa objek Snapshot langsung**, tanpa wrapper `data`. Endpoint ini read-only; bukan akses unduh CSV mentah `/api/firms`.

| Field | Keputusan v1 |
|---|---|
| `schemaVersion` | Literal `"1"`. |
| `runId`, `regionId`, `boundaryVersion` | Identitas run, registry, geometri; wajib cocok dengan permintaan. |
| `mode` | `operational`, `replay`, `demo`. Endpoint operasional tidak mengembalikan `demo`. Replay hanya lewat permintaan replay yang eksplisit atau lingkungan pengujian; status selalu replay dan tidak disebut live. |
| `status` | `live`, `partial`, `stale`, `unavailable`, `replay`, dengan aturan di bawah. |
| `evaluatedAt` | Waktu acuan analisis; seluruh observasi kandidat ≤ nilai ini. |
| `ingestedAt` | Waktu ingest terakhir dari batch yang benar-benar masuk run; bukan waktu HTTP GET. |
| `publishedAt` | Waktu commit publikasi oleh Bagas; ≥ ingest dan penilaian. Tetap sama pada unduhan ulang. |
| `freshUntil` | Deadline freshness engineering, bukan janji latensi satelit atau saat api mulai. Tidak digeser pada GET ulang. |
| `sources[]` | Satu entry per sumber dalam catalogue run: id unik, product, version, status, observedAt/ingestedAt nullable, checksum. |
| `method` | Name/version, validation (`validated`, `not-evaluated`, `unsupported`), baselinePeriod nullable, unit literal `detected-cell-days`. |
| `candidates[]` | Lokasi verifikasi stabil, bukan daftar row CSV. ID tidak berubah karena ingest baru atau keluar dari jendela 24 jam. |
| `series[]` | Berurutan dan timestamp unik, tidak melewati evaluatedAt. observed/baseline nullable dan menggunakan unit/metode/geometri/durasi yang sebanding. |
| `coverage` | Wajib null untuk v1 FIRMS point catalogue. QA coverage memerlukan kontrak baru. |

Sumber `available` berarti fetch/parse sumber berhasil, bukan wilayah bebas awan. CSV valid tanpa deteksi tetap available; observedAt boleh null. Checksum batch nyata menggunakan `sha256:<hex>`; gabungan batch memakai checksum manifest batch canonical. Jika tidak ada batch karena sumber gagal, checksum literal `unavailable`, timestamp null, dan status unavailable; jangan mengarang checksum.

### Freshness dan status

Engineering TTL v1 adalah **60 menit dari ingest sumber yang diperlukan**. `freshUntil = max(publishedAt, min(publishedAt + 60 menit, deadline sumber tersedia yang paling awal))`. Jika semua ingest source tidak tersedia, jangan menerbitkan run live. TTL ini dapat diubah lewat kebijakan versi berikutnya; bukan estimasi coverage atau latensi NASA.

- `live`: semua sumber catalogue yang diwajibkan ada dan available, run selesai, belum melewati deadline. Catalogue harus mencakup kelompok MODIS dan VIIRS yang disepakati pada manifest; satu feed saja tidak menyatakan harmonisasi lengkap.
- `partial`: run masih dapat ditampilkan tetapi sumber/periode tidak lengkap; sumber hilang tetap dicantumkan. Tidak tersedianya skor semata tidak berarti seluruh feed partial: `reason` dan nilai null dapat menjelaskan bukti kurang.
- `stale`: lewat deadline atau refresh sumber gagal setelah ada run valid. Respons 200 boleh menyajikan run valid terakhir dengan status stale; observation/ingest/publication times tidak diubah.
- `unavailable`: tidak ada run layak disajikan. Untuk endpoint latest, gunakan error 503 `SNAPSHOT_NOT_READY`, bukan objek sukses dengan kandidat kosong untuk menyembunyikan kegagalan.
- `replay`: waktu penilaian mengikuti waktu simulasi/arsip, bukan jam sekarang. Demo dan replay tidak otomatis menjadi live.

Frontend juga menghitung stale dari freshUntil dan kegagalan request. Partial yang menua menjadi stale, sedangkan rincian sumber partial tetap terlihat. Respons 200 diberi `Cache-Control: no-store`; cache aplikasi sendiri menyimpan run valid per wilayah/versi. Query tidak menjalankan ulang seluruh arsip.

### Kandidat dan seri

Kandidat wajib membawa `id`, `name`, `district`, `lat`, `lng`, `observedAt`, `sensor`, `repeats`, `anomaly`, `priority`, `reason:{id,en}`. `sensor` adalah label satelit/instrumen pengamatan terakhir; raw source IDs tetap pada manifest. Titik representatif harus berada dalam polygon studi.

- `repeats`: jumlah kesempatan pengamatan independen pada lokasi dalam 7 hari, nullable jika tidak dapat dinilai. Unduhan ulang dan satelit berdekatan waktunya tidak otomatis menambah nilai.
- `anomaly`: percentile historis 0–100 untuk periode dan musim sebanding; bukan z-score atau probabilitas bahaya.
- `priority`: `high`, `medium`, atau null. Versi aturan dan kontribusi anomali/kebaruan/persistensi dicatat pada manifest. Jangan menetapkan high dengan aturan ad hoc yang tidak dapat ditelusuri.
- `reason.id/en`: penjelasan untuk kedua bahasa, termasuk komponen hilang. Kualitas kurang tidak dibobot ulang diam-diam menjadi score lengkap.
- Latest: umur observasi `0 ≤ age ≤ 24 jam`; recheck: `24 jam < age ≤ 7 hari`; history: `age > 7 hari`. Umur memakai evaluatedAt minus observedAt. Data terlambat diunduh tidak mendapat umur baru.
- Setiap titik series mewakili bucket yang berakhir pada `at`. Aturan durasi bucket serta penyesuaian periode parsial dicatat pada manifest; baseline memakai durasi yang sama. Nilai di luar observasi cukup tetap null.

Metrik sel-hari terdeteksi adalah agregat grid bersama dan seri referensi yang tercatat; jangan menjumlahkan satelit mentah lalu menyebutnya sebanding. Full history di luar kandidat pada snapshot memerlukan API histori versi berikutnya, bukan janji dari payload latest ini.

## 5. Laporan pemeriksaan

Endpoint write memakai sesi koordinator individual dan otorisasi wilayah server-side. GET privat. Mekanisme shared token yang sekarang ada hanya adapter pengembangan; tidak memenuhi autentikasi produksi kontrak ini.

| Endpoint | Request | Respons |
|---|---|---|
| `GET /api/reports?region=papua&limit=100` | region wajib pada consumer baru; legacy tanpa region hanya mengembalikan wilayah yang boleh diakses user. limit 1–100, default 100. cursor opaque opsional. | 200 array Report v1 langsung; `X-Next-Cursor` jika ada halaman selanjutnya. Order createdAt DESC, id DESC. |
| `POST /api/reports` | CreateReport: requestId UUID, candidateId stabil, regionId, observedAt, result, notes. | 201 Report v1; retry identik 200 dengan report yang sama. |
| `PATCH /api/reports/{id}` | CorrectReport: requestId UUID, expectedRevision ≥1, reason 1–500 karakter, observedAt, result, notes. | 200 Report v1 dengan revision baru dan audit lengkap. |

`observedAt` adalah waktu pemeriksaan lapangan dan tidak boleh di masa depan menurut jam server. `createdAt` adalah waktu input awal, tidak berubah ketika dikoreksi. `updatedAt` adalah waktu perubahan terakhir. notes wajib string, boleh kosong, maksimal 2000 karakter. Enum result wire tetap: `Api/asap ditemukan`, `Tidak ditemukan tanda api saat pemeriksaan`, `Belum dapat dipastikan`; frontend menerjemahkan label EN.

Report v1 wajib memiliki id, requestId awal, candidateId, regionId, name, lat/lng lokasi stabil, observedAt, result, notes, createdAt, updatedAt, recorder `{id,displayName:null|string}`, revision mulai 1 dan corrections mulai `[]`. Lokasi/nama/region harus tersimpan walaupun kandidat tidak lagi muncul pada snapshot. Akun recorder adalah pencatat, bukan petugas pemeriksa.

Setiap correction menyimpan **nilai sebelumnya** (observedAt/result/notes), revision sebelumnya, correctedAt, correctedBy dari sesi, reason, serta requestId perubahan. Respons utama menyimpan nilai terkini; recorder awal tidak diganti dengan pelaku koreksi. Tidak ada hard-delete audit pada MVP.

### Idempotensi dan konflik

Scope idempotency adalah operasi + akun + requestId. Payload sama → resource/hasil yang sama tanpa audit baru. UUID sama dengan payload berbeda → 409 `IDEMPOTENCY_CONFLICT`. Koreksi expectedRevision berbeda dari revision terkini → 409 `REVISION_CONFLICT`; jangan menimpa perubahan rekan. Pemeriksaan idempotency dilakukan sebelum konflik revision agar retry correction yang sudah sukses tidak gagal palsu. Pemeriksaan dan insert/update/audit berlangsung satu transaksi.

Server menolak candidateId tidak dikenal, region yang tidak cocok, atribut identitas yang dipasok client, waktu tidak valid/future, request tanpa sesi/izin, dan Origin lintas situs untuk sesi cookie. Deteksi setelah pemeriksaan tetap menjadi bukti baru dan dapat masuk latest lagi; hasil “tidak ditemukan saat pemeriksaan” tidak menghapus kandidat satelit.

## 6. Error contract

Semua kegagalan API mengembalikan JSON `{error:string,code:string,retryable:boolean,requestId:string|null}`; error adalah pesan aman, requestId adalah correlation ID bila ada. Jangan mengembalikan HTML error, stack, kredensial, atau raw response upstream. UI memetakan code/HTTP ke bahasa; jangan bergantung pada teks error.

| HTTP | code | Retry |
|---|---|---|
| 400 | INVALID_REQUEST | false |
| 401 | UNAUTHENTICATED | false; autentikasi dahulu |
| 403 | FORBIDDEN | false |
| 404 | NOT_FOUND | false |
| 409 | IDEMPOTENCY_CONFLICT / REVISION_CONFLICT | false; perlu tindakan pengguna |
| 429 | RATE_LIMITED | true, sertakan Retry-After |
| 503 | SNAPSHOT_NOT_READY / DEPENDENCY_UNAVAILABLE | true, Retry-After bila diketahui |
| 500 | INTERNAL_ERROR | true hanya bila aman/idempotent |

## 7. Kompatibilitas dan definition of done

**Perluasan scope peta global:** Snapshot v1 ini tetap kontrak analitik wilayah siap pakai (`kalteng`, `papua`), bukan pembatas cakupan peta. Heatmap global memakai kontrak terpisah `hotspots-1` (bagian 8). Jangan mengubah regionId menjadi negara bebas atau mengirim snapshot wilayah lain untuk memenuhi peta global.

Snapshot sukses tetap kompatibel dengan frontend saat ini. Report v1 adalah **target backend baru**; response legacy sekarang belum menyediakan identitas/lokasi/audit lengkap. Frontend menerima field tambahan dan mengirim regionId pada create; koreksi operasional tetap disabled sampai endpoint tersedia. Kontrak tidak mengklaim backend sudah sesuai.

Field wajib/enum/satuan/semantik yang berubah memerlukan versi baru dan migrasi consumer. Field opsional additive diperbolehkan tanpa mengganti versi. Data demo tidak dipromosikan dengan mengubah label mode saja; seluruh output operasional harus diturunkan dari batch nyata dan manifest.

- [x] Orkhan menetapkan payload v1 atas mandat tim.
- [x] Contoh kedua wilayah dan tujuh JSON Schema (termasuk `hotspots` dan `hotspots-query`) tersedia serta dapat diperiksa otomatis.
- [ ] Nathan menghasilkan output dan manifest yang sesuai pada data nyata.
- [ ] Bagas menerapkan storage, endpoint dan aturan transaksi/otorisasi sesuai kontrak.
- [ ] Integrasi lintas anggota, migrasi, serta review kode aktual dilakukan.
- [ ] Polygon final dan kebijakan ilmiah divalidasi sesuai proses produk.

## 8. Heatmap global (`hotspots-1`)

`GET /api/hotspots?bbox=west,south,east,north&source=<sumber>&hours=<24|48|72|96>&zoom=<0-16>`

Endpoint mengambil FIRMS NRT sesuai bounding box viewport dan menyimpan cache per sumber/jendela/area di server (key `FIRMS_MAP_KEY` tidak pernah dikirim ke browser). Viewport yang melintasi antimeridian dibagi menjadi dua unduhan, lalu deteksi dideduplikasi. Viewport seluruh dunia tetap didukung. Schema runtime: [hotspots.ts](../../src/lib/hotspots.ts). JSON Schema: [hotspots](hotspots.schema.json), [hotspots-query](hotspots-query.schema.json).

| Field | Makna |
|---|---|
| `source` | Satu feed FIRMS: `VIIRS_NOAA20_NRT`, `VIIRS_SNPP_NRT`, `VIIRS_NOAA21_NRT`, `MODIS_NRT`. Sensor tidak dijumlahkan; heatmap global bukan hasil harmonisasi. |
| `bbox` | `[west, south, east, north]` WGS84. `west > east` berarti viewport melintasi antimeridian. |
| `hours` | Jendela bergerak yang berakhir pada `evaluatedAt`; `observedTo - observedFrom = hours`. |
| `status` | `available`, atau `stale` bila unduhan gagal dan server memakai batch terakhir (maks. 4 jam). Frontend juga menganggap data lama setelah `freshUntil`. |
| `fetchedAt`, `checksum` | Waktu unduh dan SHA-256 CSV mentah untuk provenance. |
| `total` | Jumlah deteksi di viewport dan jendela, tidak terpotong oleh agregasi. |
| `gridDegrees` | `0` = titik asli; `>0` = deteksi diagregasi ke sel grid berukuran tersebut agar fitur ≤ 6000. |
| `features` | GeoJSON Point dengan `count` dan `observedAt` terbaru per sel. Jumlah `count` = `total`. |
| `sample` | Maks. 30 deteksi terbaru di viewport, dengan satelit, confidence sumber, dan FRP (MW, nullable). |

Kegagalan mengikuti bagian 6: 400 `INVALID_REQUEST` untuk bbox/sumber/periode tidak valid, 429 `RATE_LIMITED`, 503 `DEPENDENCY_UNAVAILABLE` (termasuk key belum dikonfigurasi). Kepadatan heatmap adalah kepadatan deteksi relatif, bukan jumlah kebakaran, luas terbakar, atau tingkat bahaya; tidak ada deteksi bukan berarti tidak ada api.

Respons kegagalan hotspot juga menyertakan `reason` opsional: `NOT_CONFIGURED`, `NETWORK_ERROR`, `TIMEOUT`, `UPSTREAM_DENIED`, `RATE_LIMITED`, `INVALID_RESPONSE`, `PAYLOAD_TOO_LARGE`, atau `UPSTREAM_UNAVAILABLE`. Frontend menampilkan petunjuk pemulihan EN/ID dari kategori tersebut. Log server hanya mencatat kategori aman, tanpa URL upstream, API key, atau pesan exception mentah.
