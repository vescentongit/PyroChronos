# Orkhan — hasil implementasi Sprint 1 (P0)

Frontend tersedia; sprint belum selesai karena persetujuan kontrak/geometri, integrasi data nyata, review Nathan, dan acceptance browser masih diperlukan.

## Hasil per task

| Task | Implementasi | Sisa acceptance |
|---|---|---|
| P0-S1-O1 | Registry wilayah bersama: polygon/luas/versi/sumber, pemilih, batas peta, ekspor JSON, konfigurasi endpoint FIRMS. | Polygon masih kotak studi internal; tim perlu menyetujui geometri final dan periode data. |
| P0-S1-O2 | Type/schema runtime, validasi region/versi/mode/waktu/provenance, contoh payload dan handoff. | Kontrak perlu disetujui Nathan, Bagas, Orkhan. |
| P0-S2-O1 | Konsumsi endpoint snapshot, demo/operasional terpisah, cache per region/versi, CSV/JSON dengan provenance. | `/api/snapshots` masih 404; menunggu pipeline dan endpoint nyata. |
| P0-S2-O2 | Grafik nullable, konteks baseline, komponen/alasan kandidat, source freshness, waktu/periode/satuan. | Uji integrasi snapshot nyata ketika backend tersedia. |
| P0-S3-O1 | Form tiga hasil, waktu pemeriksaan/input terpisah, GET/POST API existing, koreksi demo berhistori, deteksi pascapemeriksaan. | Backend masih membatasi candidate ID fixture; belum ada region laporan stabil, identitas individual, endpoint audit koreksi. Koreksi operasional disabled dengan penjelasan. |
| P0-S3-O2 | Copy EN/ID, UTC eksplisit, bahasa dokumen, native dialog, keyboard/focus, CSS mobile, fallback koordinat. | Verifikasi langsung pada browser desktop/mobile belum dijalankan. |
| P0-S3-O3 | Pemeriksaan kontrak dan HTTP/SSR sudah dijalankan. | Replay UI/e2e, review silang dan PR/issue masih terbuka. |

## Verifikasi yang dijalankan

- `npm run check:frontend`: 7 pemeriksaan lulus: kedua wilayah, geometri, null, region/versi salah, demo leakage, data future/duplikat, freshness, batas 24 jam/7 hari, serta CSV aman.
- `npm run typecheck` dan `npm run build`: lulus.
- `TEST_URL=http://localhost:3002 npm run smoke`: 5 pemeriksaan production server lokal lulus: halaman, privasi laporan, otorisasi tulis, validasi wilayah, penolakan sesi invalid.
- SSR memuat label demo/subset; endpoint snapshot 404 (belum diimplementasikan), aset worker MapLibre hashed 200.
- Detektor mekanis UI tidak melaporkan temuan pada komponen berubah.

Script `check:frontend` memerlukan Node.js 22.18+ atau 24 (native TypeScript stripping). Hasil HTTP/SSR belum membuktikan perilaku interaksi browser. Tidak ada ingest nyata, publikasi layanan eksternal, atau migrasi database dalam perubahan ini.

## Handoff

Kontrak: [snapshot v1](contracts/snapshot-v1.md). Schema: [snapshot.ts](../src/lib/snapshot.ts). Polygon: [regions.ts](../src/lib/regions.ts).

Nathan menyiapkan analitik, aturan agregasi/reference, lokasi stabil, baseline, dan hasil evaluasi. Bagas menyediakan endpoint snapshot, publikasi atomik, identitas individual, serta audit koreksi laporan. Unduhan mentah `/api/firms` tetap bukan output harmonisasi.

## Acceptance browser — belum dijalankan

- [ ] Desktop/mobile: peta, tabel, status dan tombol terbaca tanpa overflow horizontal.
- [ ] EN/ID konsisten dan bertahan setelah refresh; `<html lang>` cocok.
- [ ] Ganti wilayah selama request berjalan: data lama tidak bocor ke wilayah berikutnya.
- [ ] Operasional tanpa endpoint: unavailable, tanpa kandidat/angka demo.
- [ ] Payload valid live/stale/partial/replay: timestamp/status benar; null tidak tampil sebagai nol.
- [ ] Gagal refresh: snapshot valid terakhir dipertahankan dengan status stale, per wilayah/versi.
- [ ] Tab ≤24 jam, >24 jam–7 hari, >7 hari sesuai waktu penilaian; tidak ada klaim padam/aman.
- [ ] Gagal tiles/WebGL: fallback koordinat dan daftar tetap dapat digunakan.
- [ ] Keyboard: skip link, navigasi, pemilih, kandidat, dialog, Escape, fokus kembali setelah dialog ditutup.
- [ ] Simpan demo→refresh→ganti wilayah/mode: laporan tidak bercampur; waktu pemeriksaan/input tetap berbeda.
- [ ] Koreksi demo menunjukkan nilai sebelumnya; storage gagal tidak menampilkan sukses palsu.
- [ ] Sesi/API laporan gagal memberi error; retry form mempertahankan request ID.
- [ ] Backend nyata: laporan bertahan setelah kandidat keluar jendela; deteksi setelah pemeriksaan terlihat; audit koreksi diverifikasi setelah endpoint tersedia.
- [ ] CSV/JSON memuat timestamp, sumber, mode, region, versi; null dan koma/kutip/formula diekspor benar.
- [ ] Nathan melakukan review sebelum sprint dinyatakan selesai.
