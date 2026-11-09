# Sprint 2 (P1) — Bagas

**Fokus:** API, skema database, autentikasi, penyimpanan, job, dan deployment.  
**Reviewer utama:** Orkhan  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

Validasi nilai ilmiah dan operasional.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Mulai setelah Sprint 1 (P0) dan prasyarat task ini selesai. P2 tetap opsional; eksperimen dapat berakhir dengan keputusan no-go yang terdokumentasi.

Rujukan pekerjaan rekan: [Nathan](../Nathan/SPRINT-2-P1.md) — [Orkhan](../Orkhan/SPRINT-2-P1.md).

## Tahap 1 — Benchmark dan metodologi reproducible

**Tujuan integrasi tim:** ukur manfaat harmonisasi vs baseline sederhana dengan split waktu dan arsip berversi.

- [ ] **P1-S1-B1 — Runner evaluasi reproducible.** Jalankan metode dari dataset/config berversi dan simpan artifact tanpa secret. **Selesai bila:** run dapat diulang dari manifest sama dan tidak menimpa run sebelumnya.
- [ ] **P1-S1-B2 — Provenance evaluasi.** Hubungkan output dengan batch, versi sumber, polygon, baseline, metode, dan build/commit. **Selesai bila:** API menyajikan manifest tiap hasil benchmark.

## Tahap 2 — Validasi kandidat dan review koordinator

**Tujuan integrasi tim:** uji aturan clustering/persistensi dan kegunaan ranking dengan bukti independen serta feedback terdokumentasi.

- [ ] **P1-S2-B1 — Impor referensi validasi yang aman.** Buat skema untuk sumber/waktu/izin dan data laporan yang dianonimkan bila perlu. **Selesai bila:** referensi tidak mengubah laporan produksi dan asalnya dapat diaudit.
- [ ] **P1-S2-B2 — API feedback review.** Simpan review koordinator beserta snapshot/ranking versi dan alasan. **Selesai bila:** feedback dapat diekspor untuk riset, tidak otomatis dianggap ground truth.

## Tahap 3 — Transfer wilayah dan keputusan status metode

**Tujuan integrasi tim:** uji generalisasi antardaerah dan tetapkan di mana harmonisasi layak dipublikasikan.

- [ ] **P1-S3-B1 — Metadata status evaluasi.** Simpan status/metode/wilayah/tanggal sebagai versi yang dibaca API. **Selesai bila:** snapshot menunjukkan status yang cocok dan versi lama tetap tersedia.
- [ ] **P1-S3-B2 — Guard split/manifest.** Tambahkan pemeriksaan otomatis untuk overlap periode test dan manifest tak cocok. **Selesai bila:** konfigurasi bocor gagal dengan pesan yang dapat ditindaklanjuti.

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

Metode aktif hanya untuk kombinasi wilayah/periode yang lolos evaluasi; lainnya memakai hasil mentah dan status keterbatasan.
