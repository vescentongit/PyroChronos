# Bagas Sprint 3 — Tahap 4: ketahanan proses (B2 bagian 1)

Kelanjutan: [Tahap 5 — pemulihan berulang](bagas-sprint-3-recovery.md).
Pernyataan pekerjaan Tahap 5 yang terbuka di bawah adalah snapshot akhir Tahap 4.

Cakupan: `R2-P2-B2`, berdasarkan [task Sprint 3](../tasks/Bagas/SPRINT-3-P2.md),
[status aktif](current-status.md), dan [policy B1](bagas-sprint-3-backpressure.md).
Semua input pengujian sintetis. PostgreSQL 16 native berjalan dalam container
sementara localhost, database `research_worker_test`, schema acak per kasus.
Tidak ada deployment cloud, data produksi atau pengubahan polygon.

## Hasil tinjauan implementasi

- `pipeline/research_jobs.py`: claim `FOR UPDATE ... SKIP LOCKED`, attempt/token
  baru setiap retry/reclaim, heartbeat hanya untuk lease belum kedaluwarsa,
  backoff diperiksa kembali setelah lock. Attempt lama tidak ditulis ulang oleh
  worker yang sudah kehilangan kepemilikan. Retry mempertahankan input immutable.
- `research_p1_worker.py`: heartbeat paralel terhadap processor; timeout, lease
  loss dan cancellation menghentikan processor. Sukses hanya setelah hasil
  publikasi terkonfirmasi. Cancellation dijadwalkan retry bila lease masih sah.
- `research_p1_runtime.py`: subprocess producer/publisher memakai pipe terbatas,
  stderr privat, penghentian child pada cancellation, signal handler dan kontrol
  stdin `stop`. Wrapper Node mengubah terminasi menjadi kontrol stdin tersebut.
- `research-publication*.ts`: latest attempt/token diperiksa saat membaca context
  dan di transaksi publikasi; masa berlaku lease diperiksa lagi pada UPDATE akhir.
  Manifest, result, metadata artefak, status attempt/job dan link lokasi commit
  atomik. Replay pemilik yang sama setelah commit memakai hasil yang sudah ada.
- `research-store.ts`/P1 submission: lock workspace dan receipt idempotensi
  membedakan retry requestId/payload sama dari tindakan baru. Key producer/data
  menentukan pemakaian ulang komputasi, bukan nama lokal atau urutan respons.
- `research-inspection*.ts`, `research-reports.ts`: write transaksi dengan lock
  workspace; laporan, audit dan receipt di-commit bersama. Retry requestId yang
  sama menghasilkan satu efek; payload konflik ditolak. ID baru merupakan aksi
  baru, bukan otomatis dianggap duplikat hanya karena isi tampak mirip.

Tidak ditemukan celah produksi pada skenario yang diuji; perubahan sesi ini
berupa pengujian/helper, cakupan lint dan dokumentasi. Lease, timeout, policy,
kontrak API, dan implementasi produksi tidak diubah.

## Matriks bukti kegagalan proses

| Skenario | Bukti dan assertion |
| --- | --- |
| Hard crash sebelum publikasi | Helper menjalankan producer asli, berhenti di barrier sebelum publisher; parent mematikan proses. Result/manifest/metadata artefak tetap nol. Setelah lease habis, CLI worker asli membuat attempt baru dan satu hasil sukses; eksekusi berikutnya idle |
| Stale owner/expired lease | Publisher CLI dengan claim proses yang sudah mati ditolak setelah expiry, baik sebelum maupun sesudah publikasi attempt pengganti. Token attempt berbeda, history `expired → succeeded`, hanya satu result/manifest |
| Crash dalam transaksi publikasi | Child Node memakai publisher asli; barrier setelah INSERT result (manifest sudah di-INSERT) sebelum commit. Koneksi lain melihat nol result/manifest. Kill child menyebabkan rollback; metadata tetap nol. Replay sah dua kali menghasilkan satu result dan satu manifest |
| Timeout processor | Runtime nyata dengan policy timeout sintetis 0,4 detik dan child Python penunggu nyata; attempt gagal PROCESS_TIMEOUT/retryable, child sudah mati, tanpa metadata hasil. Restart CLI asli setelah backoff produksi berhasil satu kali |
| Kegagalan sementara | Processor fixture melempar WorkerFailure PROCESSOR_FAILED/retryable; attempt tercatat gagal, restart asli sukses, tidak menerbitkan partial result |
| Pembatalan saat berjalan | Kontrol stdin `stop` saat child processor aktif melewati main runtime dan supervisor asli; child dimatikan, attempt WORKER_CANCELLED/retryable, lalu restart sukses |
| Handler terminasi deployment | POSIX memakai `os.kill(SIGTERM)`; Windows memakai `signal.raise_signal(SIGTERM)` agar handler Python dijalankan, bukan TerminateProcess. Handler membatalkan attempt dan restart sukses. Jalur kontrol `stop` yang dipakai wrapper Node diuji terpisah |
| Lease habis saat transaksi | Tes native publisher yang sudah ada menahan verifikasi hingga expiry di dalam transaksi; publisher ditolak dan seluruh metadata di-rollback |
| Heartbeat/retry | Suite Python native yang sudah ada menguji dua koneksi, lost lease, reclaim, heartbeat expiry race, backoff, retry budget dan rollback. Unit runtime memeriksa child cancellation serta heartbeat loop tetap berjalan |
| Duplikasi server | Suite native P1 yang sudah ada mengirim submission bersamaan dan memakai satu job. Enam retry assignment/report dengan requestId sama menghasilkan satu assignment, satu report dan satu audit untuk tiap efek; audit failure me-rollback business write/receipt |

Helper proses hanya mengizinkan database localhost khusus uji dan schema tes.
Barrier menentukan kapan proses dimatikan, bukan sleep arbitrer untuk menebak
fase producer/publisher. Tes expiry menunggu deadline lease database secara
bounded. Probe memakai lease dua detik/heartbeat 0,1 detik; restart tetap memakai
default backoff produksi **lima detik**, sehingga tes menunggu waktunya sebelum
mengklaim ulang. Policy probe bukan rekomendasi batas deployment baru.
Tunggu keluar runtime dibatasi sepuluh detik dengan fallback kill agar regresi
cancellation tidak menggantung suite. Stale-owner check juga menegaskan error
internal LEASE_LOST, bukan hanya exit code CLI generik.

Crash meninggalkan job `running` sampai lease berakhir: itu state antrean yang
dapat direclaim, bukan result parsial yang dibuka ke pengguna. Hanya publikasi
atomik berstatus sukses yang dapat dibaca sebagai hasil.

## Perbedaan jalur anonim aktif

`/api/local-research` tetap sinkron tanpa antrean persisten/lease/receipt server.
Tes dengan producer Python lokal yang menerima signal abort memastikan respons
error tidak berisi result parsial dan admission dilepas sehingga request berikutnya
dapat berjalan. Request identik dengan requestId yang sama dijalankan lagi dan
menghasilkan ID hasil baru; jangan mengklaim exactly-once atau resume otomatis.

Tes klien menyuntikkan AbortError/TimeoutError dan memastikan IndexedDB test
double, riwayat localStorage, penunjuk hasil terakhir serta bundle lama tidak
berubah. Ini bukan bukti persistensi browser fisik atau pemulihan proses browser.
Operasi laporan lokal memakai operation ID: replay ID/payload sama menyimpan
satu laporan, payload konflik ditolak tanpa mengubah laporan awal. Tidak ada
klaim deduplikasi lintas tab/perangkat atau identitas akun terverifikasi.

## Verifikasi dan batas cakupan

Enam skenario subprocess native baru lulus pada run terarah; pengujian lokal
analisis/storage/laporan juga lulus. Perintah reproduksi (set PYTHON,
RESEARCH_PYTHON, RESEARCH_TEST_DATABASE_URL dan ADAPTER_OUT seperti
[runbook benchmark](bagas-sprint-3-capacity.md)):

```bash
node --test tests/research-p1-e2e-native.test.mjs tests/research-publication-native.test.mjs tests/research-inspections-native.test.mjs tests/local-research-api.test.mjs tests/local-research-cache.test.mjs tests/local-monitoring.test.mjs
python -m unittest discover -s pipeline
npm test
npm run typecheck
npm run lint
npm run check:contracts
git diff --check
```

Verifikasi akhir: **276/276 tes Node** dan **163/163 tes Python**, tanpa skip,
dengan PostgreSQL native aktif. Sesudah penguatan cleanup helper, tiga tes
timeout/stop/signal dijalankan kembali dan lulus. Typecheck, lint, contract checks,
ruff helper Python dan `git diff --check` lulus. Lint exit 0 dengan enam warning
`noNonNullAssertion` lama di research-export.ts. Review independen meminta deadline
exit, assertion LEASE_LOST spesifik dan fallback cleanup child; ketiganya diterapkan.

Pengujian memakai runtime dan database nyata, tetapi processor failure/wait adalah
injeksi sintetis: timeout/stop/signal menggunakan subprocess Python yang tidur,
bukan ingest FIRMS aktif. PID child diperiksa sudah tidak hidup setelah runtime
keluar. Forwarding sinyal pada wrapper Node ditinjau, bukan diuji end-to-end dengan
sinyal OS dalam sesi ini. Penghentian POSIX eksternal dan rollout provider cloud belum
diuji pada mesin Windows ini; tidak ada klaim uji deployment aktual. Timeout 120
detik route tidak ditunggu secara wall clock; timeout supervisor diuji native dan
TimeoutError klien diuji dengan test double. Build tidak diulang karena tidak ada
perubahan kode aplikasi/schema/produksi.

**Tahap 5 tetap terbuka:** inventaris/rekonsiliasi object yatim, pemulihan metadata
dan artefak, retensi serta prosedur pemulihan yang dapat diulang tanpa menghapus
data pengguna. File privat yang sempat ditulis publisher sebelum kill tidak
diklaim telah direkonsiliasi; metadata tidak terbit. Cleanup direktori/schema
fixture pada akhir tes bukan prosedur pemulihan pengguna. B2 belum selesai penuh
dan belum direview manusia Orkhan.
