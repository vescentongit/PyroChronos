# Bagas Sprint 3 - Tahap 1 dan R2-P2-B1

Kelanjutan implementasi: [Tahap 3 - policy kapasitas dan backpressure](bagas-sprint-3-backpressure.md).
Angka dan deskripsi guard di laporan ini adalah snapshot saat benchmark Tahap 2;
perubahan sesudahnya dicatat pada laporan Tahap 3 tersebut.

Tanggal pengukuran: 14 November 2026. Branch `Bagas-SPRINT-3-P2`.
Tahap 1 selesai sebagai penyelarasan dokumen; Tahap 2 memiliki bukti lokal,
tetapi checkbox **selesai dan direview** B1 tetap terbuka untuk review Orkhan.
Tahap 3–8 tidak dikerjakan dalam perubahan ini. Tiket saat mulai hanya merinci
B1–B4, bukan urutan delapan tahap; laporan ini mengikuti penomoran Tahap 1/2
yang diminta pengguna tanpa membuat acceptance baru bagi tahap berikutnya.

## Matriks cakupan dan guard aktual

Keputusan [tanpa login](current-status.md) mengesampingkan acceptance OAuth lama.
Tidak ada data privat server yang dijadikan publik.

| Fungsi | Jalur anonim aktif | Server legacy yang dipertahankan | Guard/batas saat ini |
| --- | --- | --- | --- |
| Identitas/workspace | `local-research-client.ts`, workspace localStorage; nama pemeriksa lokal | Auth.js, membership PostgreSQL, API v2 workspace | Anonim bukan identitas terverifikasi; server memerlukan session/membership aktif dan flag experimental |
| AOI | localStorage; validasi `POST /api/local-research` action `area` | `AnalysisArea`, revision dan hash server | Maksimum 500 vertex, validasi ring/hole/intersection; polygon dikembalikan utuh; tidak ada batas luas km² terukur |
| Pengiriman analisis | Request sinkron `action: analyze`, Python `research_worker.py` | `submitP1Analysis`, `P1AnalysisJob`, worker CLI dan publisher atomik; `AnalysisRun` P0 tetap legacy | Anonim maksimum body 100.000 byte (header dan stream), JSON/origin guard; dataset wajib, baseline maksimum 30 tahun, tanggal tidak di masa depan, quality-policy-1, monitoringLocationId null |
| Kapasitas | Boolean `running` di module route, satu analisis per proses | Lock workspace dan maksimum lima queued/running per workspace P1 | Anonim mengembalikan 503 CAPACITY_LIMIT; bukan limit global atau antrean persisten; server 503 pada job baru saat penuh |
| Waktu/payload | Dua pemanggilan Python: fingerprint lalu produce | Worker lease/heartbeat/retry persisten | Anonim timeout **120 detik per pemanggilan**, stdout maksimum 100.000.000 byte; klien timeout 250 detik. Worker default processor 300 detik, lease 60 detik, heartbeat 15 detik, maksimum tiga attempt; bukan SLA |
| Kuota | Tidak ada kuota per pengguna maupun rate limiter global pada route anonim | Receipt `ResearchRequest`, 30 requestId baru/menit per scope aksi/workspace/user | Deduplikasi bukan kuota deployment. Kuota browser tergantung perangkat/origin dan belum dibenchmark |
| Cache | Hasil IndexedDB; `getBundle` mempertahankan satu bundle aktif/promise | Key analisis/config/data dan receipt idempotensi di PostgreSQL | Pengiriman ulang anonim tetap menjalankan Python dan membuat id baru; hit klien hanya untuk membuka hasil tersimpan. Legacy memakai kembali job sukses sebelum cek kapasitas lima job, tetapi tetap tunduk kuota receipt |
| Hasil/evidence | IndexedDB bundle, riwayat localStorage, ekspor lokal | `AnalysisResult`, artefak privat checksum, pagination/download berotorisasi | Bundle anonim maksimum 100.000 observasi; tidak truncate. Hasil lama dapat dibaca tanpa submission; cache klien gagal tetap bisa dicoba ulang |
| Lokasi/pemeriksaan | Catatan lokal perangkat | Lokasi, assignment, report, koreksi dan audit persisten privat | Tidak ada sinkronisasi atau kolaborasi akun pada UI aktif; membership server tetap diperiksa |
| Ekspor server | Tidak diperlukan UI anonim | Queue ekspor privat | Maksimum 128 artefak/256 MiB input, satu juta observasi unik, 64 MiB per object/output; snapshot 1.000 lokasi/2.000 assignment/2.000 report. Ini guard, bukan bukti benchmark B1 |

Sumber implementasi: `src/app/api/local-research/route.ts`,
`src/lib/local-research-client.ts`, `research-server-geometry.ts`,
`research-analysis-submissions.ts`, `research-store.ts`, `research-http.ts`,
`pipeline/research_worker.py`, `pipeline/research_jobs.py` dan
[operasional worker](research-worker.md)/[ekspor](research-exports.md).

## Metode dan batas klaim

Semua **data beban sintetis**, bukan arsip FIRMS aktif: 6.000 baris MODIS dan
6.000 VIIRS tahun 2019 dibuat melalui ingest arsip yang sebenarnya. Store hasil
ingest 26 file, 66.869 byte. Arsip ZIP dibuat ulang saat run; timestamp arsip dapat
mengubah checksum/fingerprint antar-run walaupun baris deteksi sama.

**Pengukuran nyata** memakai kode produksi di mesin lokal Windows, Node 24.15.0,
Python 3.14, Intel Core Ultra 7 255HX (20 logical CPU), RAM sekitar 31,4 GiB.
Versi tepat, commit dasar, hash model dan semua sampel ada di
[artefak anonim](benchmarks/bagas-sprint-3-capacity.json).
Polygon kecil `[113.9,-2.5]–[114.2,-2.2]` (~1.112 km²) dan besar
`[110,-5]–[120,0]` (~617.433 km²) adalah **dua input eksplisit**, tidak diperkecil
atau disederhanakan. Script membandingkan koordinat hasil dengan input.
Periode pendek 1–30 September 2019 dan panjang 1 Januari–31 Desember 2019,
baseline sepuluh tahun, tanpa comparisonPeriod. Arsip referensi sebelum 2019
tidak tersedia; Kalteng tetap domain tidak tervalidasi dan estimasi null tetap sah.
Ini bukan benchmark kelengkapan sains atau harmonisasi tervalidasi.

Probe producer menggunakan proses Python baru per sampel (n=3 per kombinasi).
`wallMs` mencakup fingerprint dan produce; `elapsedMs` juga mencakup startup,
serialisasi pipe, parsing dan validasi bundle Node. CPU delta diukur di Python;
RSS adalah peak working set proses hingga bundle selesai, termasuk import,
tanpa serialisasi stdout berikutnya. I/O Windows adalah delta transfer proses
termasuk cache OS, **bukan physical disk IOPS**; write 0 byte dalam jendela ini
karena producer membaca, sebelum menulis stdout. Node peak RSS mencakup seluruh
harness; bukan RSS per job dan tidak termasuk subprocess Python.

Route dipanggil langsung melalui Web Request/Response dan menjalankan subprocess
asli. Tidak mencakup HTTP socket, Next server, TLS atau latency jaringan.
Cache klien memakai `getBundle` produksi dengan **IndexedDB test double** yang
melakukan structuredClone; angka ini mencakup validasi/cache, bukan latency disk,
quota atau persistensi browser nyata. OS cache dan background load tidak
dikontrol; tidak ada cold-disk claim, p95, sustained throughput, mobile atau SLA.

PostgreSQL native berarti engine PostgreSQL 16.14 nyata dalam container Docker
sementara lokal `postgres:16-alpine`, bukan instalasi Windows permanen atau
PGlite. [Artefak native](benchmarks/bagas-sprint-3-native.json) mengukur service
submit, worker CLI dan publisher produksi dengan migrasi shipped dalam schema
acak database `research_worker_test`. Dataset sintetis sama; models directory
kosong secara eksplisit untuk bundle raw. Waktu worker mencakup startup/claim,
producer, publication dan shutdown; CPU/RSS/I/O engine database tidak diukur.

## Hasil

Tabel ringkasan sampel aktual berada di bagian berikut dan JSON tetap menjadi
sumber angka presisi. Waktu producer memakai median tiga sampel; route dan
native miss/worker masing-masing satu sampel, hit native tiga sampel.

| AOI / periode | Observasi | Producer median ms (rentang) | Peak RSS maks MiB | Read transfer byte | Route ms (n=1) |
| --- | ---: | ---: | ---: | ---: | ---: |
| small / short | 50 | 105.34 (105.16–405.61) | 26.49 | 245731 | 923.54 |
| small / long | 150 | 153.75 (152.15–160.63) | 26.96 | 435501 | 1007.74 |
| large / short | 1000 | 183.16 (182.93–189.97) | 27.68 | 245731 | 1019.42 |
| large / long | 12000 | 4563.00 (4490.32–4705.53) | 44.80 | 1668040 | 5943.77 |

Median CPU producer berurutan sesuai tabel: 0,09375 / 0,15625 / 0,171875 /
4,421875 detik. Ukuran JSON bundle berurutan: 23.072 / 145.337 / 165.721 /
1.960.700 byte; transfer write probe nol sebelum serialisasi stdout.

Node peak RSS seluruh run: 208.83 MiB. Pengiriman ulang identik: 5800.73 ms, id hasil baru. Cache klien test double: miss 73.05 ms; median hit delapan pembaca concurrent 0.0318 ms (tiga sampel, nol read tambahan).

Burst anonim 2/4/8: tepat satu status 200 dan masing-masing 1/3/7 status 503; pembacaan hasil lama lulus. Wall seluruh burst: 5347.40 / 2950.99 / 2846.78 ms, bukan waktu penolakan masing-masing request.

| Native AOI / periode | Submit miss ms | Worker ms | Submit hit median ms |
| --- | ---: | ---: | ---: |
| small / short | 54.70 | 1162.54 | 14.18 |
| small / long | 18.08 | 1189.30 | 12.25 |
| large / short | 17.32 | 1183.18 | 13.31 |
| large / long | 17.12 | 3247.51 | 13.94 |

Saat antrean penuh, read hasil lama 3.13 ms dan submit cache sukses 13.64 ms.


Antrean native penuh diuji lewat enam submission paralel independen: lima diterima,
satu CAPACITY_LIMIT. Pembacaan hasil lama dan cache hasil sukses lulus saat penuh.
Scope terpisah menerima 30 receipt dalam satu menit, request ke-31 RATE_LIMITED.
Metrik storage snapshot: **1.531.904 byte relasi PostgreSQL** (termasuk indeks,
tabel migrasi kosong, receipt dan queued jobs) serta **2.263.442 byte artefak**
untuk empat hasil sukses. Ini alokasi total skenario, bukan biaya storage per job
atau byte fisik yang ditulis. Native CPU/RSS dan physical disk I/O tetap belum
diukur; resource producer anonim tidak dijumlahkan sebagai resource database.

## Keputusan batas dan biaya

Policy operasional B1 lokal: **pertahankan** guard satu analisis per proses,
120 detik/pemanggilan dan 100.000 observasi; pertahankan lima job aktif/workspace
dan 30 receipt/menit pada legacy. Sampel maksimum 12.000 observasi belum menguji
ambang 100.000, payload 100 MB, timeout, AOI global, banyak replica, atau sustained
arrival rate; tidak ada dasar menaikkan guard atau memasarkannya sebagai kapasitas
terjamin. Model/browser quota/retry/restart masuk evaluasi terpisah. Saat sibuk,
tawarkan membuka hasil lama; jangan menerapkan guard submission pada endpoint
read dan jangan memangkas polygon/periode. Tidak mengubah kode/policy aplikasi.

Komponen **waktu/resource** di JSON terpisah dari **tarif deployment eksternal**:
compute wall/CPU, peak RSS, transfer proses, payload, artefak dan relasi terukur.
Tarif CPU/vCPU-second, GB-second RAM, storage GB-month, database compute/I/O,
egress dan minimum billing deployment **tidak diisi** karena belum ada pilihan
provider/region/plan yang disetujui. Tidak mengambil harga Internet atau menganggap
biaya eksternal nol. Setelah deployment dipilih, kalkulasi invoice memakai unit
billing provider dan telemetry deployment tersebut; CPU lokal tidak otomatis
sama dengan vCPU billed dan snapshot storage tidak sama dengan write IO.
Tidak ada ETA pekerjaan pengguna, konversi poin ke jam, ataupun perkiraan rupiah.

## Reproduksi dan verifikasi

```powershell
# Interpreter yang memiliki dependensi pipeline/psycopg; boleh override.
$env:RESEARCH_PYTHON = (Resolve-Path .cache/ingest-venv/Scripts/python.exe).Path
$env:PYTHON = $env:RESEARCH_PYTHON
node scripts/benchmark-research-capacity.mjs

# PostgreSQL sementara dengan credential sintetis; tidak ada volume produksi.
docker run --rm -d --name pyrochronos-sprint3-benchmark -e POSTGRES_USER=research_test -e POSTGRES_PASSWORD=synthetic-local-test-only -e POSTGRES_DB=research_worker_test -p 127.0.0.1:52204:5432 postgres:16-alpine
$env:RESEARCH_TEST_DATABASE_URL = 'postgresql://research_test:synthetic-local-test-only@127.0.0.1:52204/research_worker_test'
node scripts/benchmark-research-native.mjs
$env:ADAPTER_OUT = (Join-Path (Get-Location) '.cache/sprint3-bagas/adapter-output')
npm.cmd test
.cache/ingest-venv/Scripts/python.exe -m unittest discover -s pipeline
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run check:contracts
.cache/ingest-venv/Scripts/ruff.exe check scripts/benchmark-research-capacity.py
git diff --check
docker stop pyrochronos-sprint3-benchmark
```

Native harness menolak database selain localhost `research_worker_test`, membuat
schema acak melalui helper tes bermigrasi dan menghapus schema/file temporer di
`finally`. Bukan migrasi saat request atau deployment produksi. Docker perlu
siap menerima koneksi sebelum command native. Bila Docker tidak tersedia, jalankan
anonim saja dan laporkan native belum dijalankan; jangan menggantinya dengan
PGlite sambil menyebutnya native. Artefak JSON ditimpa pada rerun; dokumentasi tabel
harus disesuaikan jika hasil rerun hendak disimpan.
Jika cleanup database gagal, harness native berhenti sebelum penghapusan direktori
temporer; periksa schema `publication_test_*` dan direktori `pyro-native-capacity-*`
yang dimiliki run tersebut sebelum menjalankan ulang. Pada pengukuran ini cleanup
berhasil dan container sementara telah dihentikan/dihapus.

Verifikasi perubahan ini: Node **253/253**, Python **154/154** tanpa skip dengan
PostgreSQL uji dan ADAPTER_OUT; typecheck, lint terkonfigurasi, contract checks,
lint kedua script baru dan ruff probe Python lulus. Lint repository memiliki enam
warning `noNonNullAssertion` yang sudah ada di `research-export.ts`; exit 0.
Tidak ada perubahan kode aplikasi, schema atau kontrak; build tidak diperlukan.
Review manusia Orkhan dan pengukuran deployment/arsip aktif tetap terbuka.
Review akhir independen oleh agen tidak menemukan masalah penting; review ini
tidak menggantikan review manusia Orkhan.
