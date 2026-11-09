# Kontrak snapshot frontend v1 - acuan implementasi

**Status:** ditetapkan Orkhan atas mandat tim. Kontrak normatif lengkap ada di [api-v1.md](api-v1.md). Endpoint analitik belum tersedia; dokumen ini tidak membuktikan ingest atau kalibrasi nyata.

## Endpoint yang diharapkan

`GET /api/snapshots?region=kalteng` atau `region=papua`, respons JSON. Schema runtime adalah [`snapshot.ts`](../../src/lib/snapshot.ts); contoh sintetis ada di [`snapshot-v1.example.json`](snapshot-v1.example.json). Nathan menghasilkan output analitik; Bagas menyimpan dan mempublikasikannya secara atomik. Jangan membangun endpoint yang mengembalikan fixture sebagai hasil operasional.

| Bagian | Makna dan aturan |
|---|---|
| `schemaVersion` | Literal `"1"`; versi lain ditolak. |
| `regionId`, `boundaryVersion` | Harus cocok dengan pilihan dan registry wilayah. Kandidat di luar polygon ditolak. |
| `runId` | ID run analitik yang dapat dilacak ke batch input. |
| `mode` | `operational`, `demo`, `replay`. Mode operasional UI menolak payload `demo`; payload `replay` selalu berlabel replay. |
| `status` | `live`, `stale`, `partial`, `unavailable`, `replay`; live mensyaratkan sumber tersedia. |
| Timestamp | ISO-8601 ber-offset/UTC. `evaluatedAt`: waktu penilaian; `ingestedAt`: ingest; `publishedAt`: publikasi; `freshUntil`: batas freshness sesuai kebijakan backend. |
| `sources` | Produk, versi, checksum raw batch, status, waktu observasi terakhir dan ingest. Timestamp boleh null ketika tidak diketahui. |
| `method` | Nama, versi, periode baseline, unit `detected-cell-days`, status evaluasi. Metode selain `raw` pada mode operational mensyaratkan `validated`. |
| `candidates` | ID lokasi stabil, koordinat, sensor, waktu observasi, alasan EN/ID. `anomaly`, `repeats`, `priority` nullable. ID jangan memakai urutan baris snapshot. |
| `series` | Titik berurutan, waktu UTC sampai penilaian, nilai `observed`/`baseline` nullable. Frontend tidak mengisi nilai kosong dengan nol. |
| `coverage` | Wajib null pada kontrak v1 berbasis titik FIRMS. QA raster memerlukan kontrak denominator/provenance tambahan. |

## Registry geometri

[`regions.ts`](../../src/lib/regions.ts) adalah satu sumber konfigurasi peta, pemilih, permintaan FIRMS, validasi snapshot, dan ekspor JSON. Geometri sementara menggunakan kotak studi internal yang sebelumnya ada di endpoint FIRMS:

- `kalteng`: `[113, -3.6, 115, -1.5]`.
- `papua`: `[139.5, -8.8, 141, -7.5]`.

Ini bukan batas administrasi resmi dan belum mendapat persetujuan final tim. Luas dihitung dari rumus bola bumi untuk persegi lintang/bujur dengan radius 6371.0088 km, dibulatkan ke km². Ketika geometri berubah, naikkan `boundaryVersion`, siapkan ulang snapshot/baseline, dan jangan menggunakan cache lama.

## Kegagalan dan cache

Frontend memvalidasi respons sebelum menampilkannya. Respons 404/5xx, JSON invalid, timeout 15 detik, mode demo salah tempat, region/versi salah, atau run unavailable dianggap kegagalan. Snapshot terakhir yang valid dipertahankan per wilayah/versi di memori dan localStorage; operasional yang gagal refresh berlabel stale. Pergantian wilayah membatalkan request lama. Data demo tidak pernah menjadi fallback operasional.

Kandidat ≤24 jam dan >24 jam sampai 7 hari dihitung terhadap `evaluatedAt` snapshot, bukan waktu download. Label UI menyebut waktu penilaian dan memperlihatkan stale/replay agar daftar lama tidak disebut kondisi 24 jam saat ini. Histori >7 hari adalah kandidat lama yang ada dalam payload; endpoint riwayat lengkap masih perlu dibahas.

## Laporan dan pekerjaan backend yang masih dibutuhkan

Frontend menggunakan endpoint session dan laporan yang sudah ada. Hasil pemeriksaan dikirim dengan enum Indonesia yang diterima endpoint; tampilan EN diterjemahkan. Waktu lokal pada form dikonversi ke ISO UTC. ID request dipertahankan saat retry dalam form yang sama, dan ID laporan dari server digunakan setelah simpan sukses.

Mode demo menyimpan laporan dan koreksi dengan nilai sebelumnya pada localStorage. Mode operasional tidak memakai laporan demo. Tombol koreksi operasional dinonaktifkan sampai backend mendukung riwayat koreksi. API saat ini hanya menerima candidate ID fixture dan menggunakan kode koordinator bersama; belum mendukung kandidat operasional baru/identitas individual.

Bagas perlu menambahkan referensi lokasi/region yang persisten pada laporan, autentikasi individual, API koreksi dengan audit, dan endpoint snapshot. Ketika laporan tidak ada pada snapshot terbaru, backend tetap harus mengembalikan region/nama/posisi stabil. Bukti baru setelah waktu pemeriksaan tidak boleh disembunyikan.

## Penetapan kontrak

Penetapan payload oleh Orkhan sudah diotorisasi tim. Tidak perlu menunggu persetujuan draft per anggota untuk mulai implementasi. Polygon final, validasi ilmiah, serta review kode tetap pekerjaan tersendiri. Aturan TTL, error, idempotensi dan target API laporan mengikuti [kontrak normatif v1](api-v1.md).
