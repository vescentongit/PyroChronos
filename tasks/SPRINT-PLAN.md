# PyroChronos — Rencana 3 Sprint Riset v2

Acuan: [product.md](../product.md), diperbarui 10 November 2026. Kontrak integrasi baru: [API v2](../docs/contracts/api-v2.md). Kontrak v1 tetap untuk kompatibilitas prototype.

| Anggota | Sprint 1 — P0 | Sprint 2 — P1 | Sprint 3 — P2 |
|---|---|---|---|
| Nathan | [Data global/polygon](Nathan/SPRINT-1-P0.md) | [Harmonisasi/baseline/kalender](Nathan/SPRINT-2-P1.md) | [Sensitivitas dan reproduksibilitas](Nathan/SPRINT-3-P2.md) |
| Bagas | [Workspace/AOI/job/API](Bagas/SPRINT-1-P0.md) | [Publikasi/lokasi/pemeriksaan/ekspor](Bagas/SPRINT-2-P1.md) | [Kapasitas/ketahanan/deployment](Bagas/SPRINT-3-P2.md) |
| Orkhan | [Satu peta/polygon/analisis eksplisit](Orkhan/SPRINT-1-P0.md) | [Kalender/perbandingan/lokasi tim](Orkhan/SPRINT-2-P1.md) | [Benchmark/audit/pengujian peneliti](Orkhan/SPRINT-3-P2.md) |

## Arti prioritas dan gerbang integrasi

- **P0 — fondasi:** navigasi dan AOI terpisah dari job, arsip/provenance dan kueri polygon tepat, kontrak v2, akun/workspace serta pengajuan analisis. Integrasi raw/demo berlabel diperbolehkan; kalender terharmonisasi belum diklaim selesai.
- **P1 — nilai inti versi pertama:** estimasi count setara MODIS yang lolos evaluasi domain, kalender bulanan/detail harian, tanggal bebas, anomali bergerak 10 tahun, penandaan, penugasan, laporan dan ekspor. P1 bukan fitur opsional setelah versi pertama.
- **P2 — penguatan:** benchmark, reproduksibilitas, review pengguna, tambahan validasi, ketahanan dan kesiapan rilis sesuai kebutuhan. Eksperimen QA/konteks dapat berakhir no-go. Core P0/P1 tidak boleh dipindah ke P2 atau dipotong menjadi dua wilayah tanpa keputusan scope baru.

Selesainya Sprint 1 tidak berarti seluruh MVP selesai. Target historis global berlaku sejak versi pertama; job area baru boleh asinkron dan status model unsupported tetap jujur. Dua wilayah Indonesia menjadi contoh evaluasi, bukan allowlist pengguna.

Durasi sprint ditetapkan saat planning. Angka 48 jam dari rencana lama bukan komitmen untuk scope ini. Target 20 poin per orang per sprint adalah estimasi awal dengan **sepertiga total beban per anggota**, termasuk coding, review, dokumentasi, integrasi dan presentasi; re-estimasi dan bagi ulang bila perlu. Kemampuan bisnis/desain/presentasi Orkhan tidak mengurangi porsi coding atau membuatnya menanggung seluruh pekerjaan pendukung.

## Jalur kerja dan handoff

1. Nathan menyiapkan observasi, partisi, count per sumber, manifest dan producer v2. Draft calendar-1 tidak langsung menjadi payload UI v2.
2. Bagas menyimpan input versi, membuat job persisten, memvalidasi handoff dan menerbitkan hasil atomik; izin workspace berlaku di seluruh resource.
3. Orkhan membangun consumer dengan fixture berlabel dan menggantinya dengan hasil nyata ketika siap. Pan/zoom tidak mengirim analysis-create dan tidak menghapus hasil.
4. Kontrak v2 dapat digunakan sekarang; tidak perlu menunggu penetapan ulang mandat payload. Dependensi kode yang nyata tetap ditulis pada task masing-masing.

## Review dan pembuktian

- [ ] Nathan direview Bagas, Bagas direview Orkhan, Orkhan direview Nathan; review silang tambahan sesuai perubahan.
- [ ] Contract checks, tes bidang terkait dan integrasi dijalankan sebelum task ditutup; benchmark bukan klaim asumsi.
- [ ] Demo/replay dan hasil raw tidak disamarkan sebagai harmonisasi tervalidasi atau pemeriksaan lapangan nyata.
- [ ] Akhir sprint: catat keluaran, blocker, keputusan eksperimen, PR/issue dan [tracker](TASKS.md).

Status selesai v1 yang terdahulu disimpan pada [arsip](archive/2026-11-10-completed-v1.md). ID baru memakai prefix R2 agar kriteria lama dan baru tidak tercampur. Checklist baru tetap terbuka sampai bukti v2 tersedia.
