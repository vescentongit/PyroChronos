# Sprint 1 (P0) — Orkhan

**Fokus:** Peta, grafik, kandidat, laporan, ekspor, dan integrasi antarmuka.  
**Reviewer utama:** Nathan  
**Status:** belum dimulai.

[Indeks sprint](../SPRINT-PLAN.md) — [Task tracker](../TASKS.md) — [Spesifikasi produk](../../product.md)

## Tujuan

MVP jujur dan dapat digunakan.

Setiap tahap dikerjakan berurutan sesuai dependensinya. ID task dari rencana sebelumnya dipertahankan; `S1`, `S2`, dan `S3` di dalam ID kini menunjukkan tahap dalam prioritas ini.

## Koordinasi dan dependensi

Sepakati estimasi dan kontrak data/API bersama sebelum implementasi. Target beban kerja setiap anggota adalah sepertiga kapasitas tim, termasuk coding, review, integrasi, dan persiapan demo. Pindahkan potongan task coding jika estimasi timpang.

Rujukan pekerjaan rekan: [Nathan](../Nathan/SPRINT-1-P0.md) — [Bagas](../Bagas/SPRINT-1-P0.md).

## Tahap 1 — Feed, wilayah, ingest, dan kontrak data

**Tujuan integrasi tim:** menyiapkan ingest FIRMS MODIS/VIIRS yang dapat ditelusuri untuk dua polygon MVP serta kontrak data yang dipakai ketiga jalur.

- [ ] **P0-S1-O1 — Konfigurasi polygon dan pemilih wilayah.** Simpan ID stabil, nama, geometri, luas, sumber, dan versi batas untuk subset Kalimantan Tengah/Papua Selatan. **Selesai bila:** peta, pemilih, ekspor, dan data menggunakan daftar ID yang sama; cakupan wilayah dilabeli jelas.
- [ ] **P0-S1-O2 — Kontrak snapshot frontend.** Definisikan type/payload untuk deteksi, provenance, timestamp, status live/stale/partial/unavailable/replay, dan nilai nullable. **Selesai bila:** payload contoh dan kontrak disetujui ketiga anggota.

## Tahap 2 — Baseline, harmonisasi, snapshot, dan analitik dashboard

**Tujuan integrasi tim:** menghasilkan snapshot dari FIRMS nyata dan membandingkan periode terbaru dengan konteks historis sebanding.

- [ ] **P0-S2-O1 — Ganti fixture operasional.** Hubungkan peta, kandidat, grafik, dan ekspor ke snapshot API; pertahankan mode demo/replay terpisah. **Selesai bila:** mode operasional tidak membaca angka hard-coded dan ekspor membawa timestamp/provenance.
- [ ] **P0-S2-O2 — Visualisasi konteks dan kualitas.** Tampilkan terbaru vs baseline musiman, sensor, umur data, komponen alasan, dan status kualitas. **Selesai bila:** satuan/periode jelas; copy tidak menyebut aktivitas deteksi sebagai luas terbakar atau konfirmasi api.

## Tahap 3 — Laporan koordinator, keamanan, dan rilis demo

**Tujuan integrasi tim:** tuntaskan alur kandidat→pemeriksaan→riwayat dan pastikan operasi aman saat feed/backend/peta gagal.

- [ ] **P0-S3-O1 — UI formulir dan riwayat.** Hubungkan hasil “api/asap ditemukan”, “tidak ditemukan saat pemeriksaan”, “belum pasti”, serta koreksi. **Selesai bila:** waktu pemeriksaan/input terpisah dan status laporan tidak menyatakan api padam.
- [ ] **P0-S3-O2 — Lengkapi EN/ID dan UI states.** Terjemahkan error/loading/empty, peta, metode, laporan, ekspor, waktu; cek keyboard/focus/mobile. **Selesai bila:** kedua bahasa setara dan fallback peta tetap menyisakan informasi analitik.
- [ ] **P0-S3-O3 — Integrasi UI acceptance.** Jalankan replay untuk dua wilayah, laporan setelah refresh, export, status gagal, keyboard, dan viewport mobile. **Selesai bila:** temuan dan blocker tercatat serta ditautkan ke PR/issue.

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
