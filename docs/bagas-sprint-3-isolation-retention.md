# Tahap 6 — isolasi, pencabutan akses dan retensi B3

Audit 15 November 2026, branch Bagas-SPRINT-3-P2. Berlaku bagi API v2 server
legacy dan penyimpanan browser anonim yang **terpisah**. Tidak menambahkan login
pada web aktif. Data uji sintetis; PostgreSQL native memakai container sementara
localhost `research_worker_test` dan schema acak, bukan database produksi.

## Matriks hasil audit

| Jalur | Batas otorisasi dan scope |
| --- | --- |
| Workspace/member/area, P0 job/result/day/detection/tile pada catch-all v2 | Auth.js session + flag experimental, Membership aktif; SQL workspace-scoped. Perubahan membership memerlukan owner saat transaksi. Scope workspace diperiksa lagi sebelum respons dikembalikan |
| P1 submit/job/result/day/detection/tile | research-analyses-runtime → research-analyses-http; auth/flag, member aktif dan ID hasil/job pada workspace yang sama. Recheck membership di batas respons; detail membaca artefak checksum-valid. Backend publication input tidak dikembalikan sebagai resource publik |
| Lokasi/evidence/link | monitoring-locations-runtime/http/service; member aktif, hasil dan evidence milik workspace, anchor immutable, link FK composite. Recheck sebelum respons |
| Assignment/report/correction/audit | research-inspections-runtime/http dan inspection store; lock workspace, current actor/member/role, resource scoped sebelum receipt replay. Koreksi oleh owner atau pencatat asli; status oleh assignee/assigner/owner. Recheck sebelum respons |
| Ekspor create/status/CSV/manifest | research-exports-runtime/http/service; member aktif, source/metadata/artefak scoped dan checksum diverifikasi; recheck sebelum respons serta sebelum **setiap chunk CSV** |
| Cache/receipt/tile/pagination | Key komputasi dan receipt scoped workspace/actor/operasi; tile cache P0 diakses hanya sesudah job scope lolos. Cursor mengikat workspace/resource/role; cursor bukan capability atau otorisasi. Mengubah posisi cursor tidak menggantikan pemeriksaan membership |
| Publikasi worker/CLI, file privat dan rekonsiliasi | Internal operator/service, bukan endpoint pengguna. Claim latest attempt/token/lease serta workspace composite FK membatasi publikasi. File tidak disajikan melalui public/.next/static dan logical objectKey bukan URL unduhan publik |

Inventaris `src/app/api/v2/**` mencakup catch-all dan seluruh route eksplisit:
empat keluarga runtime analysis, monitoring location, inspection, export memakai
session/flag dan handler privat. Seluruh respons JSON/unduhan menggunakan
`Cache-Control: private, no-store`; kegagalan otorisasi tidak membocorkan path,
lease token atau URL database. Tidak ditemukan route objek privat publik atau
presigned download URL pada cakupan ini. Pipeline/Blob untuk dataset umum tidak
menjadi endpoint unduhan hasil workspace; aktivasi hosting tetap B4.

## Celah yang diperbaiki

Sebelumnya stream CSV hanya memeriksa membership sebelum objek stream dibuat.
Iterator kini memeriksa member lagi per chunk. HTTP ReadableStream memakai
highWaterMark=0 sehingga tidak memprefetch chunk sebelum consumer meminta data.
Tes gagal-lalu-lulus membuktikan bahwa respons CSV yang sudah dibuat tetapi belum
dibaca ditolak setelah membership dicabut.

Semua keluarga handler v2 kini mempunyai `authorizeResponse` yang memeriksa
membership database lagi setelah pekerjaan selesai, sebelum response diserahkan.
Jika gagal, body dibatalkan dan respons privat 403 dikembalikan. Catch-all juga
memeriksa lagi workspace-scoped response. Tidak ada cache membership lintas
request. GET `/workspaces` tetap snapshot daftar yang difilter Membership aktif
dalam query; bukan tautan akses yang dapat melewati otorisasi request berikutnya.

**Makna pencabutan:** `active=false`/membership hilang menolak seluruh resource
workspace untuk request baru, receipt sukses lama, cursor lama dan downloadPath
lama. Stream yang belum mengirim chunk berikutnya memeriksa ulang dan terhenti
bila revocation teramati. Setelah header dikirim, kegagalan stream meng-abort body,
bukan menyisipkan JSON/403 di tengah CSV. Byte yang sudah dikirim ke transport
atau disimpan pengguna tidak dapat ditarik kembali; ini bukan DRM.

**Makna downgrade:** owner → member mencabut hak khusus owner, bukan menghapus
hak baca member yang tetap sah. Owner yang bukan pencatat laporan tidak lagi
dapat mengoreksi laporan orang lain. Pencatat asli tetap dapat mengoreksi laporan
sendiri bila masih aktif. Transaksi tulis memakai workspace lock sehingga
perubahan membership melalui API yang sama terserialisasi dengan pemeriksaan
akses. Operasi yang sudah commit ketika masih sah tidak dibatalkan retroaktif.
Worker internal dapat menyelesaikan input frozen setelah requester dicabut;
hasil tetap privat pada workspace, bukan diberikan kembali kepada requester.

## Policy retensi research-retention-1

| Penyimpanan | Batas/kebijakan aktif |
| --- | --- |
| Histori server (result, manifest, attempt, report/revision, audit, receipt, evidence/link) | TTL null: dipertahankan sampai ada kebijakan baru yang eksplisit dan kompatibel dengan trigger. Tidak ada DELETE otomatis, reset attempt, atau penghapusan receipt untuk melewati idempotensi |
| Artefak privat analisis/ekspor | TTL null; tidak overwrite objek valid. Backup/restore checksum-valid pada Tahap 5. Kehilangan membership tidak menghapus evidence workspace |
| Orphan dan file sementara privat | Retain-private-for-review; inventaris bukan persetujuan GC. Tidak otomatis dipublikasikan, dipindah ke public atau dihapus berdasarkan usia |
| Browser IndexedDB/localStorage | TTL null dan tanpa automatic persisted eviction. Bundle, laporan, lokasi, history serta backup recovery dipertahankan pada origin/perangkat tersebut |
| Cache bundle browser | Maksimum satu bundle aktif, dieviksikan saat pindah hasil; `releaseLocalResearchCache` membuang referensi memori saja, dipanggil ketika panel unmount. Baca berikutnya mengambil ulang IndexedDB |
| Kapasitas origin browser | `localResearchStorageCapacity` membaca usage/quota yang diberikan Storage API; bila tidak tersedia nilainya null. Ini penggunaan seluruh origin, bukan hitungan byte bundle atau janji kapasitas perangkat |

Kebijakan ini sengaja tidak mengarang TTL 30/90 hari atau ukuran disk browser.
Kebutuhan saat ini adalah evidence/reproduksibilitas dan histori audit immutable;
benchmark B1 belum memberi dasar untuk menghapus arsip. Limit body/job/ekspor
dan backpressure B1 tetap berlaku; itu bukan batas retensi. Disk server tetap
perlu dipantau dan ditambah/diarsipkan ke storage privat terverifikasi oleh
operator B4. Saat penuh, tahan admission baru; jangan menghapus hasil lama agar
job baru lolos. TTL server finite memerlukan keputusan pemilik data, rancangan
arsip dan migrasi/trigger yang disetujui, bukan cron DELETE tersembunyi.

## Prosedur kapasitas/retensi aman

1. Browser: tutup panel atau pindah hasil untuk melepaskan cache memori. Ini tidak
   menghapus IndexedDB/localStorage dan tidak memutus bukti laporan tersimpan.
2. Bila quota/storage write gagal, pertahankan hasil lama, hentikan submission
   berulang, periksa kapasitas origin/perangkat dan simpan ekspor/backup dahulu.
   Pemulihan indeks Tahap 5 dapat diulang tanpa membuat laporan baru.
3. Tidak ada rotasi/purge bundle lokal otomatis berdasarkan umur/jumlah. Hapus
   data origin melalui pengaturan browser hanya sebagai keputusan eksplisit
   pemilik perangkat setelah backup; tindakan tersebut dapat menghilangkan semua
   catatan lokal dan tidak dapat dipulihkan dari workspace server.
4. Server: audit `research-reconcile.mjs` sekarang menyertakan policy retensi
   dalam laporan operator. Ikuti [runbook Tahap 5](bagas-sprint-3-recovery.md):
   retain orphan, restore file hilang dari backup cocok, tidak reset metadata.
5. Pencabutan akses dilakukan melalui membership; jangan membagikan objectKey,
   root filesystem, credential storage atau salinan artefak publik. Download harus
   tetap melalui endpoint aplikasi yang memeriksa membership saat ini.

## Pengujian dan batas klaim

Matriks PGlite dan PostgreSQL native memakai pengguna yang merupakan anggota dua
workspace untuk membuktikan bahwa membership workspace B tidak memberi akses
ID resource workspace A. Mencakup result/job/day/detection/tile, lokasi,
assignment/report list, ekspor status/manifest/download serta cross-workspace
assignment/report/correction/export writes. Cursor salah scope ditolak.
Downgrade menghilangkan koreksi owner atas laporan orang lain; revoke menolak
seluruh read matrix dan iterator unduhan yang sudah dibuat.

Tes batas respons mensimulasikan akses yang hilang sesudah callback selesai.
Tes HTTP CSV memegang respons sebelum dibaca, revoke membership, lalu memastikan
body gagal. Tes retensi memverifikasi eviksi hanya memori, bundle persisted utuh,
tanpa TTL/destructive GC; suite native existing juga membuktikan trigger menolak
delete/mutasi histori, serta rekonsiliasi mempertahankan orphan/artefak lama.

Semua data sintetis. Tidak ada uji deployment cloud, cache CDN aktual, revocation
byte yang sudah diterima client, atau sinkronisasi retensi lintas tab/perangkat.
Jalur anonim tetap tanpa login dan bukan batas identitas/membership lintas orang
yang berbagi browser. Review manusia Orkhan tetap diperlukan sebelum B3 ditutup.

Verifikasi akhir sesi: **286/286 tes Node**, **163/163 tes Python**, tanpa skip
dengan PostgreSQL native aktif; typecheck, lint, contract checks, build produksi
dan `git diff --check` lulus. Lint exit 0 dengan enam warning noNonNullAssertion
lama di research-export.ts. Review kode independen tidak menemukan masalah penting
setelah celah prefetch ditutup. Tidak ada migrasi, penghapusan histori, atau commit.
