# Orkhan Sprint 3 P2 — benchmark dan audit otomatis

Tanggal: 13 November 2026. Scope pekerjaan: R2-P2-O1 dan O3. Pengguna menyatakan peneliti belum tersedia dan meminta pengujian otomatis diteruskan; O2 tidak dianggap telah dijalankan. O4 tetap menunggu uji pengguna, integrasi dan bukti kesiapan rilis.

## O1 — skenario dan hasil benchmark

Production build lokal, Chrome 157 pada Windows x64. Browser melaporkan 20 logical cores, memory hint 8 GiB dan devicePixelRatio sekitar 1. Viewport 1440×1000 dan 390×844 dijalankan pada mesin yang sama; viewport kecil **bukan perangkat mobile fisik**. Tidak ada network throttling; tile imagery eksternal dan beban mesin tidak dikontrol. Sumber data merupakan fixture sintetis berlabel DEMO, bukan FIRMS atau hasil pengolahan arsip nyata.

Skenario: 20.000 observasi dalam 20 halaman, kalender 312 bulan (2000–2025), polygon 500 vertex, nama AOI panjang, tiga toggle lapisan, drag/zoom kamera dan edit periode. UI mempertahankan canvas dan hasil sebelumnya. Navigasi riset tidak mengirim POST analisis maupun GET hotspot tambahan pada pemeriksaan request terpisah.

| Pengukuran | Desktop sebelum | Desktop sesudah | Viewport mobile sebelum | Viewport mobile sesudah |
|---|---:|---:|---:|---:|
| Median waktu UI memuat halaman titik | 1.109 ms | 572 ms | 954 ms | 527 ms |
| Total 20 halaman | 21.674 ms | 11.203 ms | 20.187 ms | 10.996 ms |
| Median tiga toggle | 383 ms | 325 ms | 360 ms | 306 ms |
| Restore hasil tersimpan | 1.481 ms | 1.377 ms | 1.271 ms | 1.270 ms |

Angka dibulatkan dari JSON lokal. Ini satu urutan pengukuran per viewport, mencakup Playwright, scroll dan IPC; bukan INP, p95 populasi pengguna, SLA atau estimasi waktu job global. Sebelum/sesudah memakai source dan skenario sama kecuali optimasi; faktor mesin/jaringan tetap dapat memengaruhi angka. Frame-gap maksimum sekitar 201 ms/194 ms masih tercatat setelah optimasi. Long-task observer tidak mencatat task pada jendela interaksi terakhir, tetapi itu tidak membuktikan tidak ada hambatan render. Tidak ada klaim sustained 60 FPS.

Perbaikan berdasarkan pengukuran:

1. Bundle immutable aktif dibaca/divalidasi sekali, termasuk pembacaan bersamaan. Cache hanya memegang satu hasil, berganti ketika analisis berubah dan melepas promise gagal. Save pada ID sama menginvalidasi cache.
2. Deduplikasi observasi memakai Set, menggantikan pencarian berulang terhadap semua titik sebelumnya.
3. Memo pada panel mencegah render ulang akibat perubahan kamera/lapisan di parent saat props panel tidak berubah. Bahasa, area dan state panel tetap memicu render yang diperlukan.

Browser mengukur **nol pembacaan IndexedDB tambahan selama paging** setelah restore hasil. Tiga tes cache memeriksa sharing read, eviction dan recovery sesudah gagal. Regresi alur Sprint 2 juga lulus kembali.

Benchmark geometri Node 24.11.0 Windows x64, 20 sampel sesudah warmup: median 3 vertex 0,005 ms, 100 vertex 0,253 ms, dan 500 vertex 2,579 ms (maksimum sampel 6,468 ms). Ini hanya validasi polygon frontend; bukan query arsip, pemeriksaan server atau jaminan kapasitas global. Input 501 vertex ditolak sesuai batas editor.

## O3 — audit teknis terbatas

Verdict integritas implementasi: **pass dalam scope otomatis yang diuji**. Identitas NASA/Plus Jakarta Sans tetap dipertahankan. Observasi, estimasi, data hilang dan label sintetis tidak dicampur. Informasi kalender tetap memiliki angka/status dan tabel sebagai alternatif peta.

| Dimensi | Penilaian 0–4 | Bukti dan keterbatasan |
|---|---:|---|
| Aksesibilitas | 3 | Keyboard/focus-visible dan ID/EN diuji; tes rampa memeriksa kontras. Screen reader manual dan keseluruhan WCAG belum diperiksa |
| Performa | 3 | Benchmark, pengurangan read/dedup dan regresi terukur; frame-gap tersisa dan perangkat lambat belum diuji |
| Responsif | 3 | Nama panjang, viewport 390 dan reflow 720 tidak melebarkan halaman; browser zoom 200% sebenarnya belum diuji |
| Theming | 2 | Dunia visual terjaga; literal warna/ukuran CSS lama masih memerlukan inventaris token bila diprioritaskan |
| Integritas implementasi | 3 | Fixture/replay dan unit eksplisit, cache terbatas, submission analisis tetap eksplisit; acceptance manusia terpisah |
| Total | **14/20** | Penilaian engineering terbatas: Good, bukan sertifikasi aksesibilitas/kesiapan produksi |

Temuan terverifikasi:

- **P2, diperbaiki:** paging membaca/memvalidasi seluruh bundle berulang serta dedup mencari seluruh array. Dampak: waktu halaman meningkat pada data padat. Perbaikan dan angka ada pada O1.
- **P2, diperbaiki:** legend count tidak sesuai denominator pada estimasi pecahan maksimum <1. Sekarang rampa memakai maksimum positif aktual; fallback 1 hanya untuk semua nol/missing. Fixture maksimum 0,25 diuji mencapai endpoint warna paling gelap dalam ID dan EN.
- Tidak ada blocking issue baru pada checks yang dijalankan. Ini tidak berarti seluruh aplikasi telah lolos audit manual.

Satu pass detector terhadap komponen riset dan CSS melaporkan advisory literal warna/type ramp pada CSS yang sudah ada. Advisory ini tidak dipromosikan menjadi pelanggaran kontras/runtime tanpa verifikasi per token; output awal terpotong sehingga inventaris lengkapnya tidak diklaim. Tidak ada perubahan palette/token otomatis sebagai efek samping audit.

Delapan kombinasi otomatis: no_data, method_unsupported, partial dengan pembanding nol, serta estimasi pecahan × ID/EN. Pemeriksaan mencakup nol vs missing, keyboard Enter/Tab/fokus, metadata CSV tanpa titik, observasi CSV untuk nilai pecahan, tanpa Infinity/NaN, nama panjang dan tanpa overflow halaman. Reflow 720px merupakan ekuivalen lebar CSS setengah desktop, bukan uji tombol zoom browser. Screenshot tabel sempit dapat memotong konten yang memang bisa digeser; bukan bukti seluruh tabel terlihat sekaligus.

## Bukti dan cara mengulang

- `node scripts/benchmark-research-geometry.mjs` menghasilkan `.cache/sprint3-acceptance/geometry.json`.
- Dengan production server localhost:3005 dan direktori output tersedia, jalankan `scripts/research-sprint3-browser-check.mjs` serta `scripts/research-sprint3-edge-check.mjs` melalui Playwright MCP `browser_run_code_unsafe` menggunakan argumen filename. Context browser selalu terisolasi dan ditutup setelah run; dataset/database pengguna tidak ditulis.
- Output MCP disimpan oleh orkestrasi sesi ini ke `.cache/sprint3-acceptance/{before,after,edge,summary}.json`. Screenshot ada di folder sama; bukan artefak yang di-commit. Sampel frame pertama baseline negatif akibat pengambilan timestamp awal diabaikan dalam interpretasi; runner diperbaiki untuk tidak menghitung frame pertama pada hasil sesudah.
- Build lengkap/typecheck, contract checks dan lint terkonfigurasi lulus. Suite Node: **127 kasus, 125 lulus, dua native skip**. Lint mengikuti cakupan 14 file pada konfigurasi, bukan seluruh frontend.
- Acceptance sintetis Sprint 2 (heatmap → bukti, lokasi, penugasan, koreksi, persistensi, empat ekspor, ID/EN, mobile) lulus kembali. Tidak ada exception runtime pada runner benchmark, edge maupun regresi tersebut.
- Finish review independen: perbaikan cache/memo/dedup dan fractional scale diterima dalam scope O1/O3 otomatis. Ini bukan review Nathan.

## Sisa sprint dan rekomendasi

1. O2 menunggu peneliti yang tersedia; jangan mengganti hasil sesi pengguna dengan asumsi atau respons otomatis.
2. O4 menunggu bukti integrasi, reproduksibilitas dan deployment dari jalur Bagas/Nathan serta review manusia. Resolusi konflik PR #10 dikirim sebagai commit 433feee; tindakan itu sendiri bukan bukti PR sudah dimerge atau deployment siap.
3. Uji perangkat mobile fisik, actual browser zoom dan screen reader tetap terbuka. Perubahan kapasitas/batas layanan memerlukan benchmark server/arsip tersendiri.

Jika dibutuhkan tahap lanjutan: `$impeccable optimize` untuk benchmark perangkat lambat, `$impeccable harden` untuk temuan uji pengguna/assistive technology, lalu `$impeccable polish` setelah temuan material benar-benar tersedia. Tidak diperlukan perubahan visual tambahan untuk hasil otomatis saat ini.
