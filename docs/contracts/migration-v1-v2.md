> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](../current-status.md).

# Migrasi kontrak v1 ke riset v2

**Status:** rencana integrasi, bukan migrasi database yang sudah dijalankan. Acuan baru: [API v2](api-v2.md), [produk](../../product.md), dan [sprint](../../tasks/SPRINT-PLAN.md).

## Pemetaan

| Legacy / draft | Target v2 | Perlakuan |
|---|---|---|
| Snapshot schemaVersion 1 dan AnalysisOutputV1 | Result research-2 + job | Tetap valid bagi consumer lama; jangan mengganti shape di endpoint lama |
| Enum region kalteng/papua | Area polygon global, ID/revisi/hash | Keduanya menjadi preset; area baru tidak memerlukan enum aplikasi baru |
| detected-cell-days | estimated-hotspot-detections | Perlu hitung/model yang sesuai; tidak boleh rename satuan atau konversi ad hoc |
| calendar-1 grid 0,25 derajat bulanan | Observasi polygon tepat + kalender/detail v2 | Query tepi/area kecil dan detail harian memerlukan arsip observasi atau partisi yang mempertahankan informasi |
| Median bulan pada semua tahun draft | Referensi bergerak Y-10 sampai Y-1 | Hitung ulang tanpa target/masa depan, simpan minimum kelengkapan dan versi kebijakan |
| Latest snapshot TTL | Hasil analisis immutable + versi data/model | Umur hasil historis bukan freshness feed NRT; navigasi tidak memicu job ulang |
| Candidate fixture + laporan koordinator | MonitoringLocation + assignment + report privat | Mapping ID/bukti eksplisit; laporan fixture diisolasi sebagai demo |
| Shared coordinator token | Sesi individual dan Membership | Token dev bukan owner/member atau identitas pemeriksa |
| GET /api/hotspots, hotspots-1 | Eksplorasi NRT legacy / tile v2 untuk hasil penelitian | Tidak diubah diam-diam menjadi analitik terharmonisasi; pan tidak mengunduh batch identik |

## Urutan aman

1. Pertahankan v1 dan semua tes yang ada. Gunakan fixture research-2 untuk consumer/worker baru tanpa mengklaim data live.
2. Tambahkan schema Prisma dan API di namespace v2 dengan migrasi yang direview pada database uji. Kueri/migrasi berjalan sebagai tahap terpisah; perubahan dokumen tidak memberi bukti migrasi produksi.
3. Publikasikan hasil raw/draft hanya dengan unit dan status dukungan yang benar. Estimasi mode research baru boleh diterbitkan ketika metode/domain lolos evaluasi.
4. Integrasikan satu alur AOI polygon → job → result → kalender → lokasi/assignment/report → ekspor. Jalankan kasus gagal, no_data, konflik, antimeridian dan akses lintas workspace.
5. Alihkan UI secara eksplisit ke v2 setelah acceptance; pertahankan arsip bukti v1. Tidak ada fallback tersembunyi ke fixture pada kegagalan v2.

Sebelum memindahkan laporan legacy, inventarisasi sumber nyata/demo, pemilik yang dapat dibuktikan, ID kandidat, geometri dan waktu. Jangan mengarang owner, pemeriksa, workspace atau anchor observasi agar row lama cocok. Simpan mapping dan audit; data yang belum dapat dipetakan tetap legacy/read-only, bukan dihapus.

V1 baru dipensiunkan setelah consumer dan data selesai dipetakan serta rollback teruji. Jangan menghapus laporan atau menjalankan migrasi produksi sebagai bagian dari penyelarasan kontrak ini.
