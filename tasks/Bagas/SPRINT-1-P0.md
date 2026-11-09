# Sprint 1 (P0) — Bagas

**Fokus:** API, skema database, autentikasi, penyimpanan, job, dan deployment.  
**Reviewer utama:** Orkhan  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

MVP jujur dan dapat digunakan.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Rujukan pekerjaan rekan: [Nathan](../Nathan/SPRINT-1-P0.md) — [Orkhan](../Orkhan/SPRINT-1-P0.md).

## Tahap 1 — Feed, wilayah, ingest, dan kontrak data

**Tujuan integrasi tim:** menyiapkan ingest FIRMS MODIS/VIIRS yang dapat ditelusuri untuk dua polygon MVP serta kontrak data yang dipakai ketiga jalur.

- [ ] **P0-S1-B1 — Model batch mentah.** Tambahkan Prisma schema/migrasi untuk sumber, versi, waktu fetch, checksum, status, dan referensi isi batch. **Selesai bila:** migrasi non-produksi lulus dan ingest ulang tidak menimpa batch historis.
- [ ] **P0-S1-B2 — Service ingest aman.** Baca key FIRMS dari server environment, batasi wilayah yang diizinkan, atur timeout, validasi respons, dan sanitasi log. **Selesai bila:** key tidak pernah dikirim ke browser/log dan kegagalan API menghasilkan status terstruktur.

## Tahap 2 — Baseline, harmonisasi, snapshot, dan analitik dashboard

**Tujuan integrasi tim:** menghasilkan snapshot dari FIRMS nyata dan membandingkan periode terbaru dengan konteks historis sebanding.

- [ ] **P0-S2-B1 — Penyimpanan run/snapshot.** Simpan run ID, konfigurasi, referensi baseline, manifest, dan status. **Selesai bila:** API memberi snapshot terakhir yang sukses dan run lama tetap dapat ditelusuri.
- [ ] **P0-S2-B2 — Scheduler ingest dan publikasi atomik.** Tambahkan jadwal, retry/backoff, rate-limit handling, idempotensi, last-success/failure. **Selesai bila:** run gagal tidak mengganti snapshot valid dan status parsial/stale dapat dibaca UI.

## Tahap 3 — Laporan koordinator, keamanan, dan rilis demo

**Tujuan integrasi tim:** tuntaskan alur kandidat→pemeriksaan→riwayat dan pastikan operasi aman saat feed/backend/peta gagal.

- [ ] **P0-S3-B1 — Autentikasi dan izin koordinator.** Ganti shared token dengan identitas individual (Auth.js atau pilihan yang disepakati), izin tulis server-side, dan sesi aman. **Selesai bila:** akses tanpa izin ditolak pada API, bukan hanya UI.
- [ ] **P0-S3-B2 — Persistensi dan audit laporan.** Simpan candidate ID, waktu pemeriksaan, waktu input, pencatat, hasil/catatan, idempotency, serta koreksi. **Selesai bila:** laporan tahan refresh/ingest, retry tidak menggandakan, dan deteksi pascapemeriksaan tetap tampil.
- [ ] **P0-S3-B3 — Staging dan health check.** Konfigurasi secret, migrasi staging, health endpoint, fallback snapshot. **Selesai bila:** staging dapat deploy dan gagal layanan tidak dipresentasikan sebagai sukses.

## Checklist sebelum membuat PR

- [ ] PR menautkan ID task sprint, menyebut satu tujuan, dan mencantumkan acceptance criteria yang dipenuhi.
- [ ] Perubahan fokus pada scope task; tidak ada fixture/angka demo yang tersaji sebagai hasil operasional.
- [ ] Untuk data: sumber, versi, waktu observasi/ingest/publish, satuan, konfigurasi, dan provenance dapat ditelusuri.
- [ ] Nilai yang tidak diketahui/tidak cukup bukti menjadi `null` atau status eksplisit; tidak diubah menjadi nol atau “tidak ada api”.
- [ ] Jalur gagal relevan (kosong, parsial, stale, duplikat, timeout, akses ditolak) ditangani dan diuji.
- [ ] Tes unit/integrasi/UI terkait diperbarui dan dijalankan; hasil aktual dicantumkan pada PR.
- [ ] `npm run typecheck` dan `npm run build` lulus untuk perubahan aplikasi; tes pipeline Python lulus untuk perubahan analitik.
- [ ] Migrasi Prisma konsisten bila ada perubahan schema; jangan menerapkan migrasi produksi langsung dari PR.
- [ ] Endpoint memeriksa izin di server dan tidak membocorkan token, rahasia, atau stack trace.
- [ ] UI diuji pada desktop/mobile dan keyboard; EN/ID serta loading/error/empty state tetap konsisten.
- [ ] Satu anggota lain melakukan review; risiko, batasan, dan cara verifikasi terdokumentasi.

## Syarat sprint selesai

- [ ] Seluruh task pribadi selesai atau memiliki keputusan no-go yang diperbolehkan spesifikasi task.
- [ ] Keluaran sudah terintegrasi dengan pekerjaan dua anggota lain dan direview.
- [ ] Bukti verifikasi serta blocker dicatat di PR dan status diperbarui pada task tracker.

P0 selesai ketika acceptance checklist pada [TASKS.md](../TASKS.md#acceptance-checklist) terpenuhi dan seluruh jalur terintegrasi.
