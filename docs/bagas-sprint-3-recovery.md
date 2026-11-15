# Tahap 5 — rekonsiliasi dan pemulihan berulang B2

Policy: mempertahankan histori dan objek privat. `scripts/research-reconcile.mjs`
memakai metadata P1AnalysisArtifact dan ResearchExportArtifact sebagai referensi,
memverifikasi checksum/ukuran dengan storage produksi, dan menginventaris file
tanpa referensi sebagai `unreferenced-retained`. File sementara maupun orphan
tidak dihapus, tidak dipublikasikan, dan tidak menjadi metadata hasil secara otomatis.
Inventaris ketika worker aktif bersifat snapshot sementara; tidak aman sebagai
dasar penghapusan. Tidak ada SQL INSERT/UPDATE/DELETE pada rekonsiliasi.

Pemulihan file hilang hanya dilakukan jika backup eksplisit tersedia dan lolos
checksum serta ukuran metadata. Storage menggunakan hard link tanpa replace:
objek lama yang ada tidak ditimpa, termasuk saat race. Objek rusak dilaporkan
`damaged-retained`, bukan diperbaiki dengan overwrite. Jika seluruh root hilang,
mode backup dapat membuat kembali direktori di parent yang sudah ada tanpa
symlink. Root harus absolut, privat dan bukan public/.next/static. Symlink ditolak.
Mode ini ditujukan pada storage filesystem, bukan rekonsiliasi Vercel Blob.

## Prosedur operator

1. Simpan snapshot backup database dan direktori artefak privat melalui prosedur
   backup lingkungan. Jangan menjalankan reset/migrate reset, DELETE histori,
   menonaktifkan trigger, atau mengubah status job/attempt secara manual.
2. Hentikan admission baru dan hentikan worker secara normal bila membutuhkan
   inventaris stabil. Tunggu lease proses yang crash habis; jangan mencuri lease
   yang masih sah. Data hasil lama tetap dapat dibaca.
3. Set DATABASE_URL ke database/schema yang benar dan RESEARCH_ARTIFACT_ROOT
   ke root privat. Jalankan audit lokal berikut; laporan mengandung logical key
   privat dan harus disimpan operator di luar direktori web.

```bash
node scripts/research-reconcile.mjs
```

4. Exit 0 berarti tidak ada referensi rusak/hilang; orphan tetap dapat tercatat.
   Exit 2 berarti missing/damaged/restore-unavailable; exit 1 berarti kegagalan
   audit/konfigurasi. Tanpa backup, direktori root yang hilang menghasilkan exit 1.
   Jangan mengklaim hasil pulih hanya karena job berstatus succeeded.
5. Untuk file referensi yang hilang, pasang backup terverifikasi pada root privat
   terpisah dengan logical key yang sama dan jalankan kembali:

```bash
RESEARCH_RECOVERY_BACKUP_ROOT=/private/verified-backup node scripts/research-reconcile.mjs
```

6. Ulangi audit tanpa variabel backup. File restored harus menjadi verified.
   Periksa endpoint analisis/hari/deteksi dan ekspor CSV/manifest dengan akun
   berotorisasi. Jangan mengubah isi backup untuk memaksakan checksum cocok.
   Kerusakan file yang sudah ada memerlukan investigasi/restore lingkungan secara
   terkontrol; tool ini sengaja tidak menimpa objek tersebut.
7. Metadata yang tidak pernah commit tidak direkonstruksi dari orphan. Jalankan
   worker analisis/ekspor untuk claim queued atau reclaim expired dengan lease
   baru, memakai input frozen dan sumber yang sesuai. Ulangi `--once` sampai idle;
   attempt/retry budget/backoff tetap berlaku. Publikasi ulang atomik memakai
   lease sah dan tidak menggandakan AnalysisResult atau InspectionReport.

```bash
npm run research:worker -- --once
npm run research:export-worker -- --once
```

8. Jika terminal failed, sumber hilang, retry budget habis, atau konfigurasi sumber
   berbeda, hentikan dan investigasi. Jangan reset attempt/hapus receipt. Request
   baru harus tindakan eksplisit dengan requestId baru dan versi input diperiksa;
   jangan mengklaim request baru sebagai retry identik. Pulihkan database yang
   benar dari backup bila histori committed hilang: tool ini tidak menciptakan
   catatan historis yang tidak dapat dibuktikan.
9. Jalankan audit lagi sesudah worker idle; pertahankan orphan secara privat
   untuk review retensi B3. Tidak ada garbage collection otomatis. Aktifkan kembali
   admission setelah pemeriksaan sumber, status dan akses hasil lama selesai.

## Browser anonim

Saat panel dibuka, recoverLocalResearch berjalan sebelum daftar riwayat dimuat.
Cursor IndexedDB membaca bundle schema-valid satu per satu, membangun ulang
summary history dan pointer terakhir yang hilang/dangling. Bundle, laporan,
lokasi dan operasi inspeksi tidak ditulis ulang. History lama yang valid tetap
digabungkan, termasuk entri yang bundle-nya belum ditemukan. History rusak
disalin verbatim ke `pyro-research-history-v1-recovery-backup` sebelum indeks
diperbaiki. Backup yang berbeda tidak ditimpa: recovery berhenti dengan error.
Pointer lama disimpan terpisah; pointer sah dipertahankan. Bundle rusak tetap ada
dan dihitung invalidRetained, tidak dihapus/dianggap hasil valid.

Operator browser: buka kembali panel, periksa riwayat dan hasil terakhir.
Jika STORAGE_UNAVAILABLE, jangan clear browser data. Simpan/export backup lokal
melalui fasilitas browser terlebih dahulu, periksa ruang penyimpanan dan retry.
Penyimpanan perangkat yang benar-benar terhapus tidak dapat direkonstruksi dari
server karena jalur anonim tidak memiliki sinkronisasi server. Jangan mengirim
ulang analisis secara otomatis untuk mengganti histori hilang.

Pemulihan indeks dapat diulang setelah localStorage gagal di tengah write:
IndexedDB tetap sumber bundle, setiap indeks dibangun kembali tanpa menambah
laporan. Ini bukan transaksi lintas IndexedDB/localStorage atau jaminan lintas-tab;
hindari edit dari tab lain saat melakukan pemulihan.

## Bukti dan batas verifikasi

Tes native menghapus satu file fixture setelah backup untuk mensimulasikan
kehilangan, memulihkannya, lalu mengulang rekonsiliasi. Result/manifest/attempt/
report/audit counts tetap; orphan tetap privat dan utuh. Tes ekspor memulihkan
CSV dan membaca kembali ready status/manifest; worker berikutnya idle. Tes
browser memakai IndexedDB/localStorage double untuk damaged history, invalid
bundle, missing/dangling pointer dan operasi berulang. Ini bukan pengujian media
disk/browser fisik atau restore backup produksi/cloud.

Ketahanan crash/restart/lease, rollback publikasi serta duplikasi laporan tetap
ditangani suite Tahap 4. Tidak ada trigger histori yang dihapus/diubah. Checklist
teknis B2 dapat dicentang setelah verifikasi; review manusia Orkhan tetap terbuka.

Verifikasi sesi: **280/280 tes Node tanpa skip**, termasuk PostgreSQL native
analisis/ekspor dan ketahanan proses Tahap 4. Tes repair browser terputus dan
whole-root restore dijalankan ulang setelah penguatan terakhir dan lulus.
Typecheck, lint, contract checks, build produksi dan diff check lulus. Lint exit 0
dengan enam warning lama di research-export.ts. Review kode independen tidak
menemukan masalah penting setelah perbaikan startup, backup pointer dan root restore.
Tidak ada migrasi database atau commit otomatis.
