# Kontrak integrasi PyroChronos

Mulai dari **[API & payload v1](api-v1.md)**. Kontrak sudah ditetapkan Orkhan atas mandat tim; bukan draft yang masih menunggu penetapan masing-masing anggota.

- Nathan: ikuti bagian pipeline, snapshot, semantik kandidat/seri, dan manifest run. Tipe handoff: `AnalysisOutputV1`.
- Bagas: ikuti endpoint snapshot/laporan, error, otorisasi, idempotensi, revision dan audit. Jangan memakai implementasi token/fixture lama sebagai definisi kontrak produksi.
- Orkhan: gunakan schema yang sama untuk consumer dan acceptance. Penutupan kontrak tidak menutup pekerjaan integrasi data nyata.

## Artefak

| Keperluan | File |
|---|---|
| Kontrak normatif | [api-v1.md](api-v1.md) |
| Catatan consumer snapshot | [snapshot-v1.md](snapshot-v1.md) |
| Contoh snapshot, laporan, koreksi, error | [api-v1.examples.json](api-v1.examples.json) |
| Schema runtime snapshot | [snapshot.ts](../../src/lib/snapshot.ts) |
| Schema runtime laporan/error | [api-contracts.ts](../../src/lib/api-contracts.ts) |
| JSON Schema lintas bahasa | [snapshot](snapshot.schema.json), [create](report-create.schema.json), [correction](report-correction.schema.json), [report](report.schema.json), [error](error.schema.json) |

`npm run check:contracts` memeriksa konsistensi schema dan contoh. Untuk perubahan schema yang disepakati, regenerasi dengan `node scripts/check-contracts.mjs --write`, lalu review diff JSON Schema dan jalankan pemeriksaan lagi. Aturan lintas-field dan semantik tetap wajib divalidasi backend; JSON Schema saja tidak cukup.

Semua contoh bertanda sintetis dan tidak boleh dipublikasikan sebagai output FIRMS operasional. Polygon final, arsip, parameter ilmiah dan review implementasi bukan hal yang disetujui otomatis lewat kontrak payload.
