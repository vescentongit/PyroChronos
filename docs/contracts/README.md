# Kontrak integrasi PyroChronos

Mulai pekerjaan baru dari **[API dan payload riset v2](api-v2.md)**, mengikuti [product.md](../../product.md). Orkhan menetapkan kontrak atas mandat tim; ini tidak menunggu persetujuan draft baru per anggota.

**Status:** v2 adalah target implementasi dengan schema/contoh yang dapat diuji. Keberadaannya tidak berarti route, migrasi, worker, atau model sudah berjalan. V1 tetap tersedia untuk kompatibilitas prototype; consumer baru tidak dibatasi enum wilayah atau metrik sel-hari v1.

| Artefak | Lokasi |
|---|---|
| Kontrak normatif baru | [api-v2.md](api-v2.md) |
| Rencana perpindahan consumer dan data | [migration-v1-v2.md](migration-v1-v2.md) |
| Schema runtime dan tipe TypeScript | [research-contracts.ts](../../src/lib/research-contracts.ts) |
| JSON Schema v2 | [folder v2](v2/) |
| Contoh request/resource sintetis | [api-v2.examples.json](api-v2.examples.json) |
| Kasus positif/negatif | [research-contracts.test.mjs](../../tests/research-contracts.test.mjs) |
| Kontrak legacy | [api-v1.md](api-v1.md), [snapshot-v1.md](snapshot-v1.md), [contoh v1](api-v1.examples.json) |
| Eksplorasi NRT legacy | [hotspots-1](hotspots.schema.json), [query](hotspots-query.schema.json); bukan seri historis harmonisasi |

- Nathan: producer count, polygon, kalender/detail, referensi bergerak dan manifest. Draft calendar-1 tidak langsung menjadi API v2.
- Bagas: workspace, job persisten, publikasi atomik, lokasi/penugasan/laporan dan akses download/cache.
- Orkhan: consumer v2, analisis eksplisit, peta tunggal, kalender, tindak lanjut tim dan ekspor visual.

Jalankan **npm run check:contracts** untuk schema legacy dan v2, lalu **node --test tests/research-contracts.test.mjs** untuk kasus negatif v2. Setelah perubahan yang disepakati, regenerasi dengan **node scripts/check-contracts.mjs --write**, review diff dan periksa lagi. JSON Schema tidak menggantikan otorisasi, validasi geometri, referensi data atau invariants ilmiah.

Contoh seluruhnya sintetis, tidak boleh disebut hasil NASA atau validasi lapangan. Ringkasannya sesuai [3 sprint per orang](../../tasks/SPRINT-PLAN.md); bukti pekerjaan lama tetap tersimpan terpisah.
