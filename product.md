# PyroChronos — Product Specification

**Challenge:** Harmonization of MODIS and VIIRS Hot Spots — NASA Space Apps Challenge 2026  
**Status:** Visi produk dan rancangan MVP yang sedang dipertajam melalui wawancara; belum merupakan hasil eksperimen  
**Sumber utama:** NASA FIRMS — arsip MODIS/VIIRS dan feed near-real-time  
**Pengalaman utama:** Menilai kondisi terbaru terhadap pola historis musiman  
**Pengguna utama:** Analis lingkungan atau koordinator pemantauan yang menyiapkan prioritas verifikasi lapangan/patroli  
**Tindakan utama:** Memilih lokasi untuk diperiksa lebih dahulu berdasarkan bukti aktivitas terbaru dan konteks historis  
**Wilayah sasaran:** Kalimantan dan Papua bagian Indonesia  
**Fokus MVP:** Subset Kalimantan Tengah dan Papua Selatan  
**Dasar:** *PyroChronos Technical Research & Feasibility Paper.pdf*, 8 halaman  
**Tanggal:** 9 November 2026

### Status implementasi awal

Repository kini menyediakan Next.js/Tailwind, dashboard demonstrasi, peta MapLibre, grafik Recharts, pilihan dua wilayah, kandidat 24 jam/7 hari, ekspor, formulir laporan lokal, skema/migrasi Prisma untuk Neon, endpoint laporan, dan modul EQM eksperimental dengan unit test. UI dapat beralih ke penyimpanan Neon menggunakan kode akses koordinator setelah konfigurasi dan migrasi. Endpoint FIRMS menyediakan unduhan mentah saat key tersedia; dashboard belum menggunakan feed tersebut untuk analitik otomatis.

Seluruh angka dashboard masih fixture demo. Harmonisasi dengan arsip nyata, baseline musiman, pemeringkatan tervalidasi, pembaruan terjadwal, akun individual Auth.js, serta jejak koreksi laporan belum selesai. Kode akses bersama adalah mekanisme pengembangan sementara. Bagian spesifikasi di bawah tetap menjadi target implementasi, bukan klaim semua fitur telah berjalan.

## 1. Ringkasan produk

PyroChronos adalah webapp untuk menyelaraskan catatan deteksi MODIS dan VIIRS dari NASA FIRMS, lalu membantu analis menjawab: **apakah aktivitas kebakaran terbaru pada wilayah ini tidak biasa dibandingkan pola historis pada musim yang sebanding?** Riwayat data menjadi pembanding untuk menilai kondisi sekarang, sehingga pengguna dapat menentukan kebutuhan tindak lanjut berdasarkan bukti.

Produk menggabungkan peta, kalender observasi, grafik perbandingan sensor, dan hasil kalibrasi yang dapat ditelusuri. Nilai mentah tetap tersedia. Tidak adanya deteksi tidak otomatis ditampilkan sebagai tidak adanya kebakaran.

Nilai inovasi yang dituju adalah konteks historis lintas sensor untuk membantu menilai aktivitas terbaru. Feed terbaru sendiri bukan prediksi: deteksi satelit menunjukkan aktivitas yang sudah teramati. FIRMS mendistribusikan data global near-real-time sekitar tiga jam setelah observasi, bukan tiga jam sejak api mulai, dan pemantauan tidak berlangsung kontinu. UI harus memperlihatkan usia data aktual. [S11]

Visi jangka panjang adalah analisis riwayat karhutla lintas sensor di Kalimantan dan Papua bagian Indonesia, dengan konteks gambut dan tutupan lahan jika datanya tersedia. MVP membuktikan alur tersebut pada dua subset: Kalimantan Tengah dan Papua Selatan. Seluruh hotspot tidak diasumsikan sebagai kebakaran gambut. Analisis CO dan kelembapan tanah merupakan riset lanjutan, bukan kemampuan verifikasi kebakaran bawah tanah.

## 2. Masalah dan alasan memilih challenge

MODIS dan VIIRS mempunyai karakteristik deteksi yang berbeda. FIRMS menyajikan hotspot MODIS beresolusi nominal 1 km dan VIIRS 375 m; jumlah titik dari keduanya tidak dapat langsung dianggap sebagai ukuran aktivitas yang setara. Resolusi grid produk turunan juga perlu dibedakan dari resolusi pengamatan instrumen. [S2][S3]

Challenge ini dipilih karena:

- **Masalah ilmiahnya konkret:** menggabungkan deret waktu tanpa harmonisasi dapat mencampurkan perubahan lingkungan dengan perubahan kemampuan deteksi.
- **Relevan untuk Indonesia:** Kalimantan dan Papua menjadi fokus analisis karhutla serta keterbatasan observasi akibat awan. NASA pada 22 Oktober 2026 menyoroti aktivitas kebakaran di kedua wilayah; laporan BNPB 24 Oktober 2026 juga mencatat penanganan di Kalimantan Tengah dan Papua Selatan. Ini menjadi konteks pemilihan wilayah, bukan bukti kinerja produk. [S8][S9]
- **Memberikan nilai di luar peta hotspot:** pengguna dapat menilai keterbandingan sensor dan kelengkapan observasi, bukan hanya melihat titik.
- **Dapat didemonstrasikan:** dua subset wilayah dengan pipeline yang sama memungkinkan perbandingan hasil harmonisasi tanpa memproses seluruh arsip global.
- **Menguji keterterapan metode:** hasil per wilayah memperlihatkan apakah kalibrasi tetap berguna ketika distribusi deteksi dan kondisi observasi berubah.
- **Memiliki ruang pengembangan:** metode dan alur provenance dapat diperluas ke wilayah serta sensor tambahan setelah divalidasi.

Judul challenge memiliki halaman resmi [S1]. Isi lengkap halaman tersebut belum berhasil diakses saat penyusunan; persyaratan submission dan penilaian harus dicocokkan kembali sebelum pengumpulan.

### Strategi wilayah

| Tingkat | Cakupan | Peran |
|---|---|---|
| Visi produk | Kalimantan dan Papua bagian Indonesia | Perbandingan riwayat karhutla lintas sensor dan wilayah |
| MVP Kalimantan | Subset Kalimantan Tengah | Studi kasus pertama dan pengujian pipeline |
| MVP Papua | Subset Papua Selatan | Studi kasus kedua dengan evaluasi mandiri dan uji transfer model bila sampel cukup |

“Kalimantan” mengacu pada wilayah Indonesia, dan “Papua” mengacu pada kawasan Papua bagian Indonesia, bukan hanya Provinsi Papua dan bukan Papua Nugini. Kedua subset MVP ditetapkan sebagai polygon tetap sebelum evaluasi. Batas dan luas subset harus terlihat di UI agar hasilnya tidak disalahartikan sebagai cakupan seluruh pulau atau provinsi.

Gunakan batas geografis yang konsisten sepanjang deret waktu, dengan versi batas administrasi tercatat. Perubahan administrasi tidak boleh tampak sebagai perubahan aktivitas kebakaran. Konteks karhutla terkini dapat ditampilkan dengan tanggal pembaruan, tetapi evaluasi historis tetap menggunakan periode uji yang dibekukan.

### Pemilihan wilayah dalam MVP

Pengguna memilih wilayah dari daftar yang sudah disediakan; menggambar polygon sendiri dan mengunggah batas wilayah berada di luar MVP. Daftar awal mencakup area studi di Kalimantan Tengah dan Papua Selatan. Kabupaten dapat digunakan sebagai unit pilihan, tetapi nama dan jumlah area final ditetapkan setelah pemeriksaan ketersediaan data historis dan biaya pengolahan. Jangan menampilkan area sebagai tersedia jika datasetnya belum disiapkan.

Setiap pilihan memiliki ID stabil, nama, polygon, versi batas, luas, dan periode data tersedia. Gunakan polygon yang sama untuk deteksi terbaru, baseline historis, serta ekspor. Siapkan agregat historis per wilayah agar interaksi cepat; pemilihan wilayah tidak memicu pengunduhan seluruh arsip. Daftar kandidat lokasi patroli tetap menunjukkan posisi di dalam wilayah pilihan, bukan hanya satu skor untuk seluruh wilayah.

## 3. Tujuan, pengguna, dan manfaat

### Tujuan utama

1. Membandingkan aktivitas terbaru dengan pola historis musiman pada wilayah yang sama.
2. Menyelaraskan MODIS dan VIIRS serta memperlihatkan kebaruan, kelengkapan sumber, dan keterbatasan observasi.
3. Mengukur apakah kalibrasi mengurangi perbedaan antarsensor pada data uji.
4. Menyediakan sumber, versi, metode, dan keterbatasan untuk setiap hasil.

### Pengguna utama

Analis lingkungan atau koordinator pemantauan yang menyiapkan daftar lokasi untuk verifikasi lapangan/patroli. Tim lapangan menerima ringkasan lokasi dan menyampaikan hasil melalui saluran kerja yang biasa digunakan. **Koordinator di kantor memasukkan hasil pemeriksaan ke aplikasi.** Petugas tidak perlu memiliki akun atau mengisi formulir langsung di lapangan pada MVP. Peneliti menjadi pengguna sekunder. Pemilihan ini merupakan sasaran desain, bukan bukti kebutuhan yang sudah divalidasi bersama instansi. MVP mendukung penentuan lokasi pemeriksaan, bukan dispatch pemadaman, penentu pelanggaran, atau sertifikasi kepatuhan.

### Alur penggunaan

1. Pengguna memilih area dari daftar wilayah yang sudah disiapkan di Kalimantan Tengah atau Papua Selatan; halaman utama membuka periode terbaru.
2. Peta menampilkan deteksi terbaru, waktu akuisisi, serta waktu pembaruan aplikasi.
3. Panel perbandingan menunjukkan aktivitas teramati versus distribusi historis pada musim dan durasi yang sebanding, beserta status keterbandingan datanya.
4. Pengguna membuka kalender dan grafik untuk memeriksa riwayat, sensor penyumbang, serta pengaruh harmonisasi.
5. Pengguna menelaah daftar kandidat lokasi verifikasi/patroli, memeriksa alasan pencalonan, posisi, waktu deteksi, konteks historis, dan keterbatasan data, lalu memilih lokasi untuk ditindaklanjuti.
6. Pengguna mengekspor ringkasan CSV/JSON beserta provenance dan timestamp. Angka ilustratif tidak disajikan sebagai hasil nyata.

Manfaat yang diharapkan adalah interpretasi data yang lebih hati-hati dan analisis yang dapat diulang. Besaran penghematan ekonomi, penurunan emisi, atau percepatan penanganan belum dapat diklaim.

### Keluaran untuk verifikasi lapangan

Setiap kandidat lokasi menyertakan koordinat/area pemeriksaan, waktu dan satelit pengamat, ringkasan deteksi terbaru, pembanding historis jika tersedia, alasan masuk daftar, serta status kualitas/kebaruan. Pengguna dapat memeriksa bukti pada peta dan mengekspor ringkasan. Label keluaran adalah “kandidat verifikasi”, bukan kebakaran terkonfirmasi atau rute patroli yang telah dinilai aman.

Prioritas verifikasi menggabungkan **anomali historis, kebaruan, dan persistensi deteksi**, dengan kontribusi tiap komponen dijelaskan kepada pengguna. Aktivitas yang rutin secara historis tetap dapat memerlukan pemeriksaan; data historis yang tidak cukup juga tidak otomatis menghapus deteksi terbaru dari daftar kandidat.

| Komponen | Makna untuk prioritas | Batas interpretasi |
|---|---|---|
| Anomali historis | Seberapa tidak biasa aktivitas teramati dibandingkan musim dan durasi yang sebanding setelah harmonisasi | Bukan tingkat bahaya; baseline yang tidak memadai menghasilkan nilai tidak tersedia |
| Kebaruan | Seberapa baru waktu akuisisi deteksi terakhir pada lokasi | Gunakan waktu pengamatan, bukan waktu unduh; data lama yang baru masuk tidak dianggap deteksi baru |
| Persistensi | Deteksi berulang pada lokasi yang sama dalam beberapa kesempatan pengamatan berbeda | Bukan jumlah baris CSV atau bukti api menyala terus-menerus; beberapa satelit pada waktu berdekatan tidak otomatis menjadi pengulangan independen |

Kualitas dan ketersediaan data menjadi penanda kelayakan penilaian, bukan tambahan skor bahaya. Komponen yang tidak tersedia tidak diisi nol atau disembunyikan melalui pembobotan ulang tanpa penjelasan. Bukti terbaru tetap dapat ditampilkan sebagai kandidat dengan penilaian parsial. Jeda deteksi tidak otomatis berarti api padam karena awan dan celah pengamatan masih mungkin terjadi.

Bobot, ambang, dan aturan kesetaraan lokasi/pengamatan belum dibekukan; semuanya perlu dievaluasi melalui replay sebelum disebut pemeringkatan tervalidasi. Pilihan gabungan ini merupakan keputusan desain, bukan bukti bahwa skor sudah memprediksi kebutuhan patroli di lapangan.

### Jendela daftar patroli

- **Daftar utama:** kandidat dengan deteksi yang waktu akuisisinya berada dalam 24 jam terakhir pada waktu penilaian. Ini jendela bergerak, bukan pergantian tanggal kalender.
- **Konteks pengulangan:** tampilkan pengamatan selama 7 hari terakhir untuk membantu menilai persistensi kandidat.
- **Perlu dicek kembali:** lokasi dengan deteksi terakhir lebih dari 24 jam hingga 7 hari lalu ditampilkan terpisah dengan label “tidak ada deteksi terbaru; kondisi belum terverifikasi”. Label ini tidak berarti pernah diperiksa petugas.
- Deteksi yang lebih lama tetap dapat diakses melalui riwayat. Keluar dari daftar utama tidak berarti api padam atau lokasi aman. Jika sumber gagal diperbarui, tampilkan kegagalan tersebut alih-alih menyatakan tidak ada deteksi terbaru.
- Gunakan waktu akuisisi, bukan waktu unduh. Simpan waktu penilaian serta batas jendela pada snapshot; snapshot yang sudah lama tidak ditampilkan sebagai daftar 24 jam terkini. Untuk replay, waktu penilaian mengikuti waktu simulasi dan diberi label jelas.

Daftar ini membantu koordinator memilih lokasi pemeriksaan. **Pencatatan hasil pemeriksaan termasuk MVP.**

### Pencatatan hasil pemeriksaan

Koordinator yang memiliki akses tulis dapat membuka kandidat, mencatat waktu pemeriksaan yang dilaporkan tim, memilih hasil, dan menambahkan catatan singkat. Simpan identitas koordinator pencatat, waktu laporan disimpan, serta lokasi/kandidat yang diperiksa. Identitas pencatat tidak dianggap sebagai identitas orang yang melakukan pemeriksaan. Waktu pemeriksaan berbeda dari waktu input, sehingga laporan yang terlambat dimasukkan tidak tampak sebagai pemeriksaan baru.

Formulir MVP menyediakan hasil “api/asap ditemukan”, “tidak ditemukan tanda api saat pemeriksaan”, atau “belum dapat dipastikan”. Status “sudah diperiksa” menerangkan adanya pemeriksaan, bukan menyatakan kebakaran padam. Koordinator mencatat informasi dari tim tanpa mengubah laporan yang belum pasti menjadi konfirmasi kebakaran.

Laporan tetap tersimpan ketika feed FIRMS diperbarui atau kandidat melewati batas 24 jam. Pisahkan bukti satelit dan laporan manusia pada UI maupun penyimpanan. Deteksi baru setelah waktu pemeriksaan ditandai “ada deteksi setelah pemeriksaan” dan dapat kembali masuk daftar utama sesuai jendela waktunya; jangan menekan deteksi baru hanya karena lokasi pernah diperiksa. Pengaitan lokasi dengan laporan harus memakai identitas stabil dan referensi posisi, bukan urutan baris snapshot.

Batasi MVP pada formulir online ringkas untuk koordinator dan riwayat laporan. Foto, rute patroli, penugasan tim, akun petugas lapangan, serta sinkronisasi offline berada di luar MVP. Pencatatan memerlukan penyimpanan persisten dan akses tulis terautentikasi untuk koordinator. Saluran pelaporan tim yang sudah ada tidak perlu diintegrasikan otomatis. Laporan demo diberi label dan dipisahkan dari laporan lapangan nyata.

## 4. Lingkup produk

| Tahap | Kemampuan | Batasan |
|---|---|---|
| MVP 48 jam | Feed FIRMS terbaru untuk dua subset, pembanding historis musiman, peta, kalender, grafik sensor, kandidat patroli, formulir hasil pemeriksaan dan riwayat laporan, baseline dan kandidat kalibrasi, ekspor | Arsip pembanding disiapkan sebelum acara; laporan berupa form ringkas, bukan sistem manajemen operasi lengkap |
| Pengembangan berikutnya | Perluasan periode/wilayah, API kueri, ketidakpastian, laporan wilayah | Membutuhkan pengujian generalisasi dan anggaran komputasi |
| Riset lanjutan | Konteks CO, kelembapan tanah, angin, dan gambut | Indikasi pendukung, bukan deteksi terverifikasi kebakaran bawah tanah |

MVP membutuhkan autentikasi untuk pencatatan pemeriksaan dan penyimpanan persisten laporan. Notifikasi otomatis, database analitik operasional besar, laporan legal, serta model deep learning tidak diperlukan. Lapisan H3 bersifat opsional jika diperlukan untuk penyajian; grid analisis utama tetap grid sinusoidal bersama.

## 5. Data yang digunakan

| Data | Fungsi | Karakteristik dan akses | Batasan |
|---|---|---|---|
| FIRMS MODIS dan VIIRS — sumber utama | Riwayat deteksi untuk harmonisasi dan baseline musiman; feed NRT untuk kondisi terbaru | Archive Download untuk historis dan API area untuk data terbaru; posisi, waktu, satelit, confidence, FRP, dan versi | Katalog titik tidak menyediakan seluruh observasi non-api; jumlah titik bukan jumlah kejadian kebakaran |
| MOD14A1 Collection 6.1; MYD14A1 sebagai perluasan — pelengkap | FireMask dan kualitas MODIS untuk eksperimen observabilitas | Produk harian grid sinusoidal 1 km melalui Earthdata/LP DAAC | Tidak wajib untuk ingest FIRMS; jangan menganggap QA historis mewakili kondisi awan hari ini |
| VNP14A1 Version 2 — pelengkap | FireMask dan kualitas VIIRS untuk eksperimen observabilitas | Produk harian Level 3 grid sinusoidal **1 km** melalui Earthdata/LP DAAC | Berbeda dari FIRMS VIIRS 375 m; kecocokan ruang, waktu, dan makna produk harus diperiksa |
| Batas administrasi dan polygon studi Kalimantan Tengah/Papua Selatan | Pemilihan wilayah dan agregasi | GeoJSON dari sumber resmi atau terbuka dengan lisensi yang dicatat | Gunakan geometri tetap untuk perbandingan historis; catat sumber dan versi batas |
| Peta gambut | Konteks ekologis pada tahap lanjut | Sumber pemerintah atau penelitian dengan cakupan/lisensi terverifikasi | Bukan pengukuran langsung kedalaman atau kondisi gambut saat kebakaran |
| Sentinel-5P TROPOMI CO | Konteks anomali atmosfer pada tahap riset | Produk Level 2 CO; jika diagregasi ke Level 3, proses gridding dan QA didokumentasikan | Sensitivitas dipengaruhi awan; CO dapat berasal dari sumber lain dan terbawa angin |
| SMAP | Konteks kelembapan pada tahap riset | Kandidat L3 enhanced daily pada grid 9 km; versi dibekukan saat eksperimen | Kelembapan permukaan tidak sama dengan kelembapan gambut dalam; grid bukan jaminan resolusi efektif |

Identitas MOD14A1 dan VNP14A1 dikonfirmasi melalui katalog NASA [S3]. Pedoman VIIRS menjadi acuan pembacaan produk [S4]. Karakteristik CO dan SMAP harus mengikuti dokumentasi produsennya [S5][S6].

### Kebijakan pemilihan periode dan akses

- Pilih subset bulan musim kebakaran dan pembanding non-puncak untuk masing-masing wilayah; gunakan periode tumpang tindih kedua produk. Perbandingan antardaerah memakai jendela waktu yang sama, dengan konteks musim masing-masing, bukan asumsi bahwa puncak kebakaran selalu serentak.
- Paper mengusulkan pelatihan 2013–2018 dan pengujian 2019–2020. Jadikan ini desain evaluasi penuh, bukan syarat memproses semua arsip selama hackathon.
- Jika subset MVP belum cukup untuk kalibrasi yang dapat dipercaya, tampilkan perbandingan observasi dan label eksperimen; jangan menyajikan model sebagai tervalidasi.
- Verifikasi tile yang benar-benar beririsan dengan setiap polygon studi dari metadata. Jangan menyalin tile Riau dalam paper untuk Kalimantan atau Papua.
- Feed terbaru menjadi input utama pengalaman pengguna; arsip menjadi pembanding historis. Benchmark pengembangan tetap dipisahkan dari data yang sedang dinilai. Catat tanggal akuisisi, waktu ingest, dan status NRT/arsip; jangan mencampur hotspot, luas terbakar, serta estimasi emisi sebagai ukuran yang sama.
- Arsip FIRMS mengganti NRT dengan data standard science-quality ketika tersedia. Bekukan snapshot baseline dan catat revisinya; uji perbedaan NRT versus standard sebelum menafsirkan selisih sebagai anomali. [S10]
- Catat product ID, collection/version, granule ID, periode, URL/DOI, waktu unduh, lisensi/atribusi, serta checksum berkas.
- Simpan kredensial Earthdata dan FIRMS di lingkungan pengolahan, bukan di frontend atau ekspor publik.

## 6. Tools dan bahasa pemrograman

| Bagian | Pilihan | Alasan |
|---|---|---|
| Pengolahan dan eksperimen | Python, NumPy, SciPy, scikit-learn | CPU cukup untuk baseline statistik, kandidat EQM, dan evaluasi; tidak membutuhkan layanan model |
| Numerik dan kalibrasi | NumPy, SciPy, scikit-learn | Statistik, EQM, baseline regresi, dan evaluasi |
| Tabel dan agregasi | Polars, DuckDB, Parquet | Pemrosesan kolumnar dan kueri lokal tanpa server database wajib |
| Raster dan koordinat | GDAL/Rasterio, PyProj | Membaca raster, memeriksa CRS, dan penyelarasan grid |
| Webapp | Next.js App Router, React, TypeScript | UI dan backend aplikasi dalam satu proyek; Server Components untuk akses data dan Client Components untuk interaksi peta/grafik |
| Styling | Tailwind CSS | Styling responsif yang konsisten; tidak menambahkan framework UI kedua sebagai syarat MVP |
| Peta | MapLibre GL JS, deck.gl | Basemap dan lapisan spasial interaktif |
| Grafik | Recharts | Perbandingan deret waktu dan indikator cakupan |
| Database aplikasi | Neon PostgreSQL | Menyimpan wilayah, hasil analitik terbitan, kandidat, pengguna, dan laporan persisten |
| ORM dan migrasi aplikasi | Prisma | Akses database bertipe pada server Next.js dan satu sumber migrasi skema |
| Backend aplikasi | Next.js Route Handlers, Zod | Endpoint analitik dan laporan dengan validasi serta otorisasi; tidak memerlukan FastAPI terpisah |
| Autentikasi | Auth.js dengan akun koordinator yang diizinkan | Memakai penyedia identitas, tanpa membangun penyimpanan password sendiri; penyedia OAuth ditetapkan berdasarkan akun tim sebelum implementasi |
| Arsip pengolahan | Parquet; JSON/CSV untuk ekspor dan fallback | Berkas mentah historis tidak seluruhnya dimasukkan ke database aplikasi atau repository; arsip besar disimpan di object storage |
| Hosting aplikasi | Vercel | Menjalankan Next.js dengan server runtime; bukan static export karena aplikasi memiliki autentikasi dan endpoint tulis |
| Pembaruan data MVP | Job Python pada GitHub Actions terjadwal/manual, secret FIRMS, psycopg untuk Neon | Ingest dan komputasi berada di luar request web; jadwal bersifat best-effort dan UI menampilkan waktu berhasil terakhir |
| Verifikasi | pytest; pemeriksaan browser | Menguji invariant ilmiah dan alur demo yang penting |
| Kolaborasi | Git dan lockfile dependensi | Menjaga versi kode, konfigurasi, dan reproduksibilitas |

Versi dependensi dipilih yang saling kompatibel saat implementasi lalu dikunci. Target sub-second processing jutaan rekaman atau 60 FPS tidak dianggap terbukti sebelum benchmark. Pengolahan granule dilakukan di luar browser; frontend hanya memuat agregat wilayah/periode yang diperlukan.

### Arsitektur implementasi

```text
FIRMS Archive + NRT
    -> job Python: ingest, validasi, agregasi, kalibrasi, skor, evaluasi
    -> Neon: hasil per wilayah/periode + metadata run yang berhasil

Browser -> Next.js -> Prisma -> Neon
             |                    |
             |                    +-- laporan pemeriksaan dan riwayat koreksi
             +-- Auth.js: sesi koordinator dan pemeriksaan akses

Arsip besar -> Parquet/object storage
Fallback demo -> snapshot JSON berlabel timestamp/replay
```

- Next.js menangani pemilihan wilayah, pembacaan hasil, formulir laporan, ekspor, dan sesi pengguna. Peta/grafik interaktif menjadi Client Components; Prisma, secret FIRMS, dan kredensial database hanya berada di server. [S13]
- Python menangani pengolahan ilmiah dan refresh data. Training, pembacaan arsip besar, serta kalkulasi baseline tidak dijalankan saat pengguna membuka dashboard. Tidak diperlukan server Python yang selalu aktif.
- Seluruh migrasi dimiliki Prisma. Job Python memakai SQL/psycopg untuk menulis tabel analitik yang sama sesuai kontrak skema; tidak membuat atau mengubah tabel sendiri. Role job dibatasi pada data pipeline, terpisah dari hak akses laporan pengguna.
- Gunakan koneksi Neon pooled untuk request aplikasi yang singkat dan berulang, sesuai panduan integrasi Prisma/Neon. Konfigurasi CLI migrasi mengikuti versi Prisma yang dikunci; jalankan migrasi sebagai tahap deployment, bukan pada setiap request. [S14]
- Publikasikan hasil job dengan ID run dan status selesai. Validasi hasil sebelum mengganti referensi run aktif dalam transaksi, sehingga dashboard tidak membaca setengah batch. Jangan menimpa laporan saat hasil analitik diganti.
- Next.js membaca hasil terbitan di Neon sebagai sumber utama; JSON menjadi format respons/ekspor dan fallback, bukan mekanisme deployment ulang tiap jam. Jika job gagal, pertahankan hasil terakhir dengan status kebaruan yang jujur.

### Pembagian data dan endpoint minimum

| Kelompok data | Isi | Pemilik penulisan |
|---|---|---|
| Region | ID, nama, batas GeoJSON, versi dan luas | Proses persiapan wilayah |
| AnalysisRun dan ActivitySummary | Waktu ingest, satelit, versi metode, metrik, baseline, skor, kualitas | Job Python |
| Candidate dan bukti deteksi | ID lokasi stabil, posisi, deteksi terakhir, alasan prioritas, referensi run | Job Python; identitas tidak diganti hanya karena snapshot baru |
| InspectionReport dan revision | Kandidat/posisi, hasil, waktu pemeriksaan, pencatat, catatan, koreksi | Next.js setelah validasi hak koordinator |
| User dan data sesi | Identitas, akses koordinator, sesi sesuai konfigurasi autentikasi | Layanan autentikasi dan administrasi akses |

Endpoint baca: `GET /api/regions`, `GET /api/regions/:id/activity`, `GET /api/regions/:id/candidates`, dan `GET /api/candidates/:id/reports`. Endpoint tulis: `POST /api/candidates/:id/reports` serta `PATCH /api/reports/:id` untuk koreksi berjejak. Endpoint laporan memerlukan sesi koordinator dan pemeriksaan hak akses pada server. Pembacaan dari Server Components dapat langsung memakai fungsi server/Prisma tanpa HTTP ke endpoint sendiri. [S13]

Untuk wilayah tetap MVP, lakukan penempatan titik ke wilayah/grid di pipeline dan simpan hasilnya. PostGIS belum wajib; tambahkan hanya jika kueri geometri dinamis menjadi kebutuhan nyata. Data besar tidak dikirim seluruhnya ke browser; gunakan filter wilayah, periode, dan pagination kandidat.

### Apakah membutuhkan PyTorch atau Hugging Face?

**Tidak untuk MVP ini.** Harmonisasi statistik, baseline musiman, persentil anomali, kebaruan, dan pengulangan deteksi dapat dihitung dengan Python serta pustaka numerik pada CPU. Kandidat EQM memetakan distribusi sumber ke distribusi referensi; `QuantileTransformer` saja tidak otomatis menjadi algoritma harmonisasi dua sensor yang tervalidasi. Tetap perlu penanganan nol, dukungan distribusi, dan evaluasi temporal terpisah. [S15]

PyTorch/Hugging Face baru dievaluasi jika ada tugas model terlatih yang jelas, seperti klasifikasi citra atau prediksi yang memiliki data label, baseline, dan metrik uji. Itu bukan kebutuhan yang sudah disepakati. LLM tidak diperlukan untuk menghasilkan skor prioritas atau mengubah hotspot menjadi klaim kebakaran terkonfirmasi. Alasan prioritas dapat ditulis dari template berdasarkan nilai dan kualitas data.

### Urutan implementasi stack

1. Siapkan Next.js, TypeScript, Tailwind, Prisma, koneksi Neon, serta migrasi awal. Gunakan environment pengembangan terpisah dari data produksi.
2. Bangun satu alur vertikal: region contoh, kandidat berlabel fixture, login koordinator, simpan laporan, muat ulang, dan lihat riwayat. Fixture tidak disajikan sebagai data live.
3. Ganti fixture analitik dengan hasil pipeline FIRMS nyata; pertahankan kontrak data dan laporan yang sama.
4. Tambahkan baseline/kalibrasi yang dievaluasi, alasan prioritas, refresh terjadwal, status stale, dan ekspor.
5. Uji migrasi, akses koordinator, idempotensi laporan, kegagalan job, pergantian run atomik, serta alur UI. Deploy setelah konfigurasi secret dan koneksi diverifikasi.

## 7. Pendekatan ilmiah dan alur data

```text
FIRMS Archive MODIS/VIIRS + FIRMS NRT
  -> validasi skema, waktu, satelit, confidence, versi, dan status unduhan
  -> grid analisis bersama dan dua subset Kalimantan Tengah/Papua Selatan
  -> agregasi deteksi per satelit dan cell-day
  -> baseline dan kandidat kalibrasi
  -> evaluasi historis terpisah dan pembandingan kondisi terbaru
  -> Parquet + snapshot JSON/CSV + manifest
  -> peta, status anomali/keterbandingan, kalender, grafik, dan ekspor

FireMask/QA pelengkap -> metrik observabilitas hanya jika ruang/waktunya cocok
```

### 7.1 Harmonisasi ruang dan waktu

Petakan koordinat titik FIRMS ke grid sinusoidal bersama 1 km untuk agregasi; grid ini adalah unit analisis, bukan peningkatan resolusi pengukuran MODIS. Pertahankan titik asli untuk peta dan audit. Untuk raster pelengkap, periksa transform, extent, dan ukuran piksel sebelum menyelaraskan array; gunakan nearest-neighbor untuk kelas kategoris jika reproyeksi diperlukan.

Normalisasi waktu ke UTC dan pertahankan identitas sensor/satelit. Agregasikan indikator ada-tidaknya deteksi pada setiap sel-hari per satelit, tanpa menganggap sel tanpa titik sebagai observasi valid. Hapus duplikasi rekaman unduhan; jangan menganggap pengamatan berbeda sebagai rekaman duplikat. Penambahan satelit tidak boleh langsung menambah nilai indeks aktivitas: jangan menjumlahkan semua feed sebagai satu seri. Pemilihan seri referensi serta aturan penyambungan pada periode tumpang tindih perlu dibekukan sebelum implementasi model.

Untuk FRP, tentukan unit dan makna statistik terlebih dahulu. FRP dalam MW bukan energi kumulatif atau luas terbakar; penjumlahan lintas lintasan berulang tidak otomatis menjadi total energi kebakaran. MVP memprioritaskan frekuensi deteksi; harmonisasi FRP menjadi eksperimen terpisah.

### 7.2 Status observasi

Pada jalur FIRMS, tampilkan deteksi yang diterima, tidak ada deteksi tercatat, atau sumber tidak tersedia. “Tidak ada deteksi tercatat” bukan status bebas awan atau bukti tidak ada api. Status berikut hanya dapat ditetapkan jika data observabilitas pelengkap yang sesuai tersedia:

| Status | Makna |
|---|---|
| `fire_detected` | Ada deteksi yang lolos kebijakan kualitas |
| `observed_no_detection` | Ada observasi daratan yang memenuhi kualitas tanpa deteksi yang diterima |
| `insufficient_observation` | Tidak cukup observasi yang diterima untuk menyimpulkan |

Simpan alasan seperti `cloud`, `missing_granule`, `scan_gap`, `qa_rejected`, atau `unknown`. Suatu bulan dapat memiliki deteksi sekaligus cakupan rendah; keduanya harus tetap ditampilkan.

Decode QA secara spesifik per produk. Daftar kelas dalam paper adalah hipotesis implementasi yang perlu diperiksa terhadap panduan resmi, bukan pemetaan universal. Deteksi confidence rendah ditandai dan dipisahkan dalam analisis sensitivitas; jangan diubah diam-diam menjadi non-api. Nilai confidence MODIS dan kategori VIIRS tidak diperlakukan sebagai probabilitas yang identik.

### 7.3 Frekuensi deteksi dan cakupan

Metrik inti FIRMS adalah jumlah sel-hari dengan deteksi per satelit dan wilayah dalam jendela analisis. Namai metrik ini “aktivitas deteksi teramati”; jangan menyebutnya luas terbakar atau jumlah kejadian. Hasil harmonisasi tetap memiliki label metode dan seri referensi. Perbandingan wajib memakai geometri, durasi, serta konfigurasi satelit yang konsisten atau kalibrasi yang telah diuji.

Rumus berikut hanya berlaku pada jalur dengan QA pelengkap yang memadai. Tanpa QA, `observed_cell_days`, `coverage`, dan rate berbasis observasi adalah `null`, bukan estimasi yang dibangun dari titik FIRMS:

Untuk sensor dan wilayah yang sama:

```text
observed_cell_days = jumlah cell-day daratan yang lolos kebijakan kualitas
fire_cell_days = jumlah observed cell-day dengan deteksi yang diterima
rate_per_1000 = 1000 × fire_cell_days / observed_cell_days
coverage = observed_cell_days / expected_land_cell_days
```

`expected_land_cell_days` ditentukan dari mask daratan tetap, wilayah, dan hari dalam periode. Jika pembagi nol, hasil adalah `null`, bukan nol. Frekuensi berada pada rentang 0–1000 dan tidak merepresentasikan probabilitas kebakaran sebenarnya atau luas terbakar.

Untuk perbandingan sensor, hitung pula metrik pada irisan cell-day yang sama-sama valid. Laporkan berapa banyak data tersisih agar pemilihan sampel bebas awan tidak menyembunyikan bias.

### 7.4 Kalibrasi dan evaluasi

Baseline utama adalah metrik aktivitas deteksi yang sudah disejajarkan tanpa kalibrasi. Baseline tambahan adalah regresi linear sederhana. Kandidat utama dari paper adalah Empirical Quantile Mapping (EQM), dilatih hanya pada data pelatihan dan dibandingkan pada periode uji terpisah. Kalibrasi count berbasis FIRMS dan rate berbasis QA adalah eksperimen berbeda; jangan menukar keduanya dalam satu seri.

Pertahankan nol pada varian awal EQM, tetapi jelaskan bahwa kebijakan ini tidak merekonstruksi kebakaran kecil yang tidak terdeteksi MODIS. Pisahkan distribusi nol dan positif; tandai input di luar dukungan pelatihan. Jangan mengekstrapolasi tanpa validasi.

Laporkan MAE, bias rata-rata, ukuran sampel, dan cakupan pasangan observasi. VIIRS merupakan referensi pembandingan, bukan ground truth kebakaran. Jika EQM tidak mengungguli baseline, tampilkan hasil kegagalannya dan gunakan baseline sebagai keluaran utama.

Latih dan evaluasi kandidat kalibrasi secara terpisah untuk setiap wilayah. Jangan menjadikan model Kalimantan sebagai model Papua secara otomatis. Jika sampel memadai, lakukan eksperimen tambahan: bekukan model Kalimantan lalu uji pada Papua tanpa pelatihan ulang, dan laporkan sebagai uji transfer yang terpisah. Kegagalan transfer merupakan hasil penelitian yang harus tetap terlihat.

Perbandingan antardaerah menampilkan metrik aktivitas, luas wilayah, jumlah sampel, serta coverage jika tersedia. Jangan membuat peringkat tingkat keparahan hanya dari jumlah hotspot mentah. Jika tutupan lahan/gambut tersedia, gunakan sebagai konteks atau stratifikasi; jika tidak tersedia, jangan mengarang klasifikasi ekologis.

### Analisis kondisi terbaru

- Gunakan distribusi historis pada musim dan durasi sebanding untuk menilai apakah aktivitas terbaru menyimpang. Jangan membandingkan sebagian bulan berjalan dengan satu bulan historis penuh.
- Pisahkan anomali statistik aktivitas dari anomali termal yang menjadi dasar deteksi satelit. Skor anomali bukan probabilitas kebakaran, tingkat bahaya, atau prediksi penyebaran.
- Jika baseline tidak mencukupi, konfigurasi sensor berubah tanpa kalibrasi tervalidasi, atau ingest gagal, tampilkan “belum dapat dinilai”; jangan memaksakan label normal.
- Untuk periode berjalan, tampilkan hasil sebagai sementara. Daftar utama memakai 24 jam terakhir dengan konteks persistensi 7 hari. Minimum sampel, ambang anomali, dan aturan prioritas verifikasi akan ditetapkan melalui wawancara lanjutan, lalu diuji melalui replay historis tanpa memakai data masa depan.
- Pemrosesan yang berhasil belum membuktikan seluruh observasi satelit telah tersedia. Catat keberhasilan ingest, ketersediaan sumber, dan observabilitas sebagai informasi berbeda.
- Usulan awal refresh adalah setiap jam, tunduk pada kuota layanan. Baca ulang jendela terbaru untuk menangkap data terlambat, simpan versi snapshot, dan tandai hasil lama saat job gagal. Interval ini adalah pilihan produk, bukan jaminan latensi NASA.

### 7.5 Riset CO dan SMAP

Uji apakah anomali CO dan kondisi kelembapan menambah informasi untuk periode dengan observasi termal terbatas. Sertakan QA retrieval, kondisi awan, musim, transportasi angin, dan sumber CO lain. Agregasi mengikuti resolusi efektif data pendukung; jangan memberikan kepastian tingkat piksel 1 km dari produk yang jauh lebih kasar.

Ambang CO 3,5 sigma, kelembapan 0,18, dan coverage 30% pada paper belum menjadi ambang operasional tervalidasi. Gunakan sebagai kandidat eksperimen dengan analisis sensitivitas. Keluaran yang diizinkan adalah “indikasi pendukung yang memerlukan pemeriksaan”, bukan “kebakaran bawah tanah terverifikasi”. [S5][S6]

## 8. Kontrak keluaran dan antarmuka

Setiap ringkasan menyertakan:

- `region_id` dan, untuk hasil per sel, `cell_id`; `period_start`, `period_end`, dan zona waktu UTC.
- Referensi polygon studi, versi batas, dan luas wilayah analisis agar kedua subset dapat dibedakan dari cakupan provinsi penuh.
- `sensor`, `product_id`, `product_version`, dan `processing_version`.
- Metrik deteksi mentah dan harmonisasi beserta satuan, konfigurasi satelit, dan model; metrik observabilitas/rate berbasis QA nullable jika data pelengkap tidak tersedia.
- Jendela pembanding historis, status penilaian, skor anomali nullable, serta alasan hasil belum dapat dinilai.
- Prioritas verifikasi beserta komponen anomali, kebaruan, persistensi, alasan pemeringkatan, versi aturan, dan status penilaian lengkap/parsial. Komponen yang belum dapat dihitung tetap nullable.
- Waktu observasi terbaru, waktu ingest berhasil, waktu penerbitan snapshot, status NRT/standard, dan status sumber per satelit. Waktu hotspot terakhir tidak dipakai sendirian sebagai ukuran kesehatan feed.
- `observation_status`, alasan data tidak memadai, dan flag kualitas.
- Referensi manifest sumber, waktu pemrosesan, serta metrik evaluasi jika tersedia.

MVP menerbitkan hasil analitik ber-version di Neon untuk dibaca melalui Next.js. Ekspor/fallback menyediakan `manifest.json`, `latest.json`, `calendar.json`, `comparison.json`, dan data spasial per wilayah. Pertahankan hasil terakhir yang valid jika pembaruan gagal dan tampilkan status lama/gagal. Snapshot demo historis diberi label replay, tidak disamarkan sebagai data live.

Backend laporan menyediakan kemampuan membaca riwayat dan menyimpan hasil pemeriksaan oleh pengguna berwenang. Kontrak laporan minimum berisi ID laporan, referensi kandidat dan posisi, waktu pemeriksaan, hasil, catatan, identitas pencatat, serta waktu penyimpanan. Pengiriman ulang permintaan yang sama tidak membuat laporan ganda. Koreksi mempertahankan jejak perubahan. Data pribadi pencatat tidak dipublikasikan melalui snapshot analitik.

UI selalu menampilkan label sensor, periode, satuan, dan kualitas data. Sel tanpa observasi diberi pola/warna berbeda dari nilai nol; makna status tidak hanya bergantung pada warna. Grafik mentah dan harmonisasi dapat dibandingkan tanpa menyembunyikan salah satunya.

## 9. Kendala dan mitigasi

| Kendala | Dampak | Mitigasi |
|---|---|---|
| Kredensial, unduhan, dan throttling | Pipeline tidak selesai saat hackathon | Siapkan subset nyata dan checksum sebelum acara; cache unduhan |
| HDF, subdataset, dan QA berbeda | Salah membaca mask atau kualitas | Inspeksi metadata dan contoh granule tiap produk sebelum batch |
| Awan dan granule hilang | Ketiadaan data disalahartikan | Gunakan null, alasan kehilangan, dan indikator cakupan |
| Sensitivitas dan waktu lintasan berbeda | Kalibrasi mencampur fenomena berbeda | Gunakan pasangan observasi, stratifikasi bila data cukup, dan baseline |
| Sampel sedikit atau distribusi bergeser | EQM tidak stabil | Batasi klaim ke domain uji dan pertahankan baseline |
| Distribusi observasi berbeda antara Kalimantan dan Papua | Model akurat di satu wilayah tetapi gagal di wilayah lain | Evaluasi per wilayah; pisahkan kalibrasi lokal dari eksperimen transfer |
| Cakupan dua wilayah besar | Unduhan dan komputasi melampaui waktu MVP | Bekukan dua polygon kecil dan subset periode sebelum acara; perluas cakupan setelah demo |
| Komputasi dan transfer data | Demo lambat | Precompute agregat dan muat data sesuai wilayah/periode |
| CO/SMAP ambigu dan kasar | Kepastian palsu tentang gambut | Letakkan sebagai riset kontekstual dengan validasi lapangan |
| Data batas dan gambut | Salah atribusi spasial | Dokumentasikan sumber, tahun, lisensi, dan keterbatasan |
| Backend atau jaringan gagal | Analitik atau pencatatan terganggu | Snapshot mempertahankan analitik; tampilkan kegagalan simpan laporan secara jelas dan jangan mengklaim laporan sudah tersimpan |
| Keterlambatan NRT dan perubahan konfigurasi satelit | Anomali semu atau kesan kondisi normal | Label hasil sementara, status sumber per satelit, dan evaluasi keterbandingan sebelum menerbitkan skor |

## 10. Rencana MVP 48 jam

Persiapan sebelum acara: akses data, dua subset nyata, polygon studi Kalimantan Tengah dan Papua Selatan, metadata, dan dependensi harus sudah diuji. Jadwal berikut merupakan alokasi kerja yang diusulkan, bukan ketentuan resmi penyelenggara.

| Waktu | Pekerjaan | Keluaran dan gerbang keputusan |
|---|---|---|
| 0–4 jam | Verifikasi arsip dan API NRT FIRMS untuk kedua wilayah; cek skema, timestamp, satelit, dan batas | Ingest nyata serta status sumber; fallback berlabel jika akses gagal |
| 4–12 jam | Bentuk agregat deteksi, manifest, dan job pembaruan | Snapshot terbaru, deduplikasi, serta baseline historis siap evaluasi |
| 12–24 jam | Hitung baseline dan uji EQM per wilayah bila sampel mencukupi | Metrik data uji serta keputusan menerima/menolak kalibrasi untuk setiap wilayah |
| 24–36 jam | Integrasikan kondisi terbaru versus baseline, peta, kalender, formulir laporan, autentikasi pencatat, dan ekspor | Alur pilih kandidat hingga simpan hasil; tampilan pendukung dijaga sederhana |
| 36–44 jam | Replay historis; uji data terlambat, sumber gagal, persistensi laporan, hak akses, dan fallback | Skor tidak dipaksakan; laporan tidak hilang saat snapshot diperbarui; kegagalan simpan terlihat |
| 44–48 jam | Perbaiki narasi, atribusi, dan rekam demonstrasi | Submission sesuai ketentuan resmi yang sudah diperiksa |

### Kapasitas dan pembagian tim

Tim terdiri dari tiga software engineer dengan beban kerja yang dibagi rata. Pengusul produk juga memahami bisnis, desain, dan presentasi, tetapi tetap memegang tanggung jawab coding yang utuh. Keahlian tambahan tersebut menjadi kontribusi dalam review bersama, bukan alasan mengurangi porsi coding atau menumpuk pekerjaan nonteknis pada satu orang.

| Anggota | Tanggung jawab utama | Keluaran |
|---|---|---|
| Nathan | Pipeline FIRMS, agregasi, baseline, harmonisasi, dan pengujian analitik | Dataset, snapshot analitik, serta evaluasi metode yang dapat direproduksi |
| Bagas | Backend laporan, autentikasi, penyimpanan, job pembaruan, deployment, dan pengujian layanan | Layanan serta pembaruan data berjalan; laporan tersimpan dengan benar |
| Orkhan | Frontend lengkap: pemilihan wilayah, peta, grafik/perbandingan historis, daftar kandidat, formulir laporan, integrasi API, dan pengujian UI | Aplikasi pengguna yang terhubung ke snapshot analitik dan backend laporan |

Target alokasi waktu kerja adalah sepertiga per anggota, termasuk coding dan pekerjaan pendukung; pembagian modul tidak otomatis menjamin beban sama. Tinjau estimasi bersama dan pindahkan tugas pendukung atau potongan implementasi jika salah satu jalur menjadi bottleneck. Tetapkan kontrak snapshot dan laporan lebih awal agar ketiga anggota dapat bekerja paralel.

Integrasi, review kode, pengujian end-to-end, penyusunan materi presentasi, dan latihan demo menjadi tanggung jawab bersama dengan alokasi waktu yang seimbang. Pengusul produk dapat memberi arahan bisnis/desain dan membawakan presentasi tanpa otomatis menanggung seluruh persiapannya. Review silang mencakup ketiga anggota, termasuk kode frontend, pipeline ilmiah, dan backend.

Scope dijaga pada satu alur utama: pilih wilayah, nilai aktivitas terbaru dengan konteks historis, pilih kandidat patroli, dan catat hasil melalui koordinator. Formulir laporan tetap ringkas; pengembangan CO/SMAP, unggah foto, routing, notifikasi, dan aplikasi petugas tidak masuk pengerjaan MVP. Jika waktu tertekan, kurangi jumlah area/periode demo dan pemolesan visual sebelum mengorbankan validasi harmonisasi atau kejujuran status data.

Jadwal 48 jam merupakan asumsi perencanaan hackathon. Waktu persiapan tim sebelum acara belum diketahui; kelayakan menyiapkan arsip dan eksperimen kalibrasi bergantung pada waktu tersebut.

FIRMS saja merupakan jalur utama MVP. Coverage tetap tidak diketahui tanpa QA pelengkap; analisis menyatakan batasannya sebagai analisis deteksi teramati. Jika feed terbaru tidak dapat diakses, gunakan replay historis berlabel untuk demonstrasi dan laporkan integrasi live belum terpenuhi.

Jika pengolahan salah satu wilayah terhambat, pertahankan pilihan kedua wilayah tetapi tampilkan status data belum tersedia pada wilayah tersebut. Jangan mengisi data wilayah yang gagal dengan keluaran wilayah lain atau mengklaim perbandingan dua wilayah telah lengkap.

## 11. Pengujian dan kriteria keberhasilan

### Kebenaran data

- Pembagi nol menghasilkan `null`; tidak ada konversi otomatis missing menjadi nol.
- `fire_cell_days <= observed_cell_days <= expected_land_cell_days` pada jalur QA yang memenuhi definisi; metrik tersebut tidak direkayasa dari katalog FIRMS.
- Unduhan berulang tidak menggandakan hitungan; rerun dengan input sama memberikan hasil sama.
- Kelas QA contoh, waktu UTC, CRS, serta batas wilayah diperiksa terhadap metadata produk.
- Kasus awan penuh, granule hilang, confidence rendah, dan observasi valid tanpa deteksi memiliki keluaran yang berbeda.

### Kebenaran metode

- Data uji tidak digunakan untuk melatih atau memilih parameter kalibrasi.
- MAE dan bias dibandingkan terhadap baseline pada sampel yang sama.
- Tidak ada kewajiban mencapai penurunan MAE 42%; angka tersebut adalah target paper yang belum dibuktikan.
- Kegagalan model dan keterbatasan sampel terlihat oleh pengguna.
- Metrik dipisahkan per wilayah; hasil gabungan tidak boleh menyembunyikan penurunan kualitas di salah satu wilayah.
- Polygon historis tetap konsisten, dan model transfer tidak dilatih ulang memakai data uji Papua.
- Replay penilaian terbaru hanya memakai baseline dan data yang tersedia pada waktu penilaian. Replay memakai arsip final saja diberi label evaluasi retrospektif dan tidak membuktikan performa NRT historis.
- Data terlambat, periode parsial, baseline nol, sensor tidak tersedia, dan perubahan NRT ke standard tidak menghasilkan skor anomali palsu atau pembagian nol.
- Unduhan ulang tidak menaikkan persistensi; waktu unduh tidak memperbarui usia deteksi; pengamatan satelit yang berdekatan tidak otomatis dianggap pengulangan independen.
- Kandidat tanpa baseline tetap menampilkan bukti terbaru dengan penilaian parsial; prioritas tidak disajikan sebagai probabilitas kebakaran atau kebutuhan patroli yang sudah terverifikasi.
- Deteksi pada batas 24 jam/7 hari masuk kelompok yang konsisten tanpa duplikasi; melewati batas tidak menghasilkan status padam. Data lama yang terlambat diunduh tidak menjadi kandidat baru hanya karena waktu unduhnya baru.

### Pengalaman pengguna

- Pengguna dapat memilih periode, memahami kualitas data, membandingkan sensor, dan mengekspor ringkasan.
- Pengguna dapat beralih antara Kalimantan Tengah dan Papua Selatan tanpa tercampurnya data, metrik, atau provenance; kondisi salah satu wilayah tanpa data ditampilkan eksplisit.
- Filter pada snapshot lokal ditargetkan selesai di bawah satu detik pada perangkat demo; ukur dan catat hasil aktual.
- Semua grafik dan ekspor menyertakan satuan, sumber, dan waktu data.
- Analitik berbasis snapshot tetap dapat dibuka saat backend gagal; fungsi laporan memperlihatkan kegagalan dan tidak menampilkan sukses simpan palsu. Kegagalan basemap tidak menghilangkan data analisis.
- Pengguna dapat melihat waktu observasi dan pembaruan secara terpisah, memahami hasil sementara, dan membedakan live, stale, serta replay.
- Pengguna dapat menelusuri alasan suatu lokasi menjadi kandidat verifikasi dan mengekspor lokasi beserta bukti waktunya; label anomali tidak ditampilkan sebagai tingkat bahaya atau kebakaran terkonfirmasi.
- Laporan tetap ada setelah refresh, ingest baru, dan kandidat keluar dari jendela utama; deteksi setelah pemeriksaan tetap terlihat sebagai bukti baru.
- Hak tulis diperiksa di server; pengiriman ulang tidak menggandakan laporan, dan laporan demo tidak disajikan sebagai verifikasi lapangan nyata.
- Koordinator dapat memasukkan hasil pemeriksaan yang diterima dari tim; waktu pemeriksaan tetap terpisah dari waktu input dan akun pencatat tidak dianggap sebagai pemeriksa lapangan.
- Pemilihan wilayah memakai daftar tetap; data terbaru, baseline, laporan lokasi, dan ekspor mengacu pada ID serta geometri yang konsisten, tanpa tercampur ketika pilihan berubah.

Keberhasilan MVP adalah demonstrasi harmonisasi yang transparan dan dapat diuji. Akurasi kebakaran dunia nyata memerlukan referensi independen dan pekerjaan validasi tambahan.

## 12. Koreksi penting terhadap paper

| Pernyataan/arah dalam paper | Keputusan produk |
|---|---|
| VNP14A1 disebut 750 m | Gunakan identitas resmi produk harian grid 1 km; bedakan dari instrumen dan FIRMS 375 m [S3][S4] |
| H3 menghilangkan seluruh distorsi dan memiliki luas seragam | Tidak digunakan sebagai jaminan geometris; analisis memakai grid bersama |
| Nol bebas awan disebut verified zero | Gunakan “observasi valid tanpa deteksi”; api yang tidak terdeteksi tetap mungkin |
| CO + SMAP memverifikasi smoldering bawah awan | Turunkan menjadi hipotesis riset dan indikasi kontekstual [S5][S6] |
| 26 tahun seamless, MAE turun 42%, deteksi <24 jam | Target yang belum dibuktikan, bukan fitur selesai |
| Klaim jutaan rekaman sub-second dan jutaan titik 60 FPS | Benchmark diperlukan pada perangkat dan volume nyata |
| Kerugian terhindarkan serta probabilitas 0,74 | Tidak digunakan sebagai bukti dampak tanpa data dan metode yang dapat diperiksa |
| Audit-grade EUDR/NDPE otomatis | Hanya laporan analitis dengan provenance; tidak menjanjikan kepatuhan legal |
| FIRMS/SiPongi dianggap selalu menyatakan nol api ketika berawan | Hindari generalisasi perilaku platform; fokus pada risiko interpretasi katalog deteksi |
| Beralih ke LUMEN jika ingest gagal | Gunakan fallback data nyata dalam challenge yang sama |
| Studi kasus utama Riau | Ubah fokus produk menjadi Kalimantan dan Papua; gunakan dua subset MVP dan validasi ulang tile serta domain kalibrasi |
| Granule raster sebagai fondasi wajib dan fokus riwayat | FIRMS menjadi sumber utama; pengalaman utama adalah kondisi terbaru dibandingkan baseline historis, dengan raster QA sebagai pelengkap |

Referensi bibliografi dalam paper, terutama yang detail tahun/judulnya tidak konsisten, harus diverifikasi sebelum digunakan dalam publikasi. Cerita Bengkalis 2028 adalah ilustrasi hipotetis, bukan kejadian atau hasil validasi.

## 13. Sumber dan tindak lanjut

Paper lokal menjadi sumber gagasan, bukan bukti bahwa seluruh klaimnya telah tervalidasi. Sumber resmi berikut mendasari pemeriksaan teknis awal:

- **[S1]** [NASA Space Apps — Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/) — halaman challenge; isi lengkap perlu diperiksa kembali.
- **[S2]** [NASA FIRMS — Fire Alert Notes](https://firms.modaps.eosdis.nasa.gov/alerts/notes.php) — karakteristik deteksi dan confidence.
- **[S3]** [NASA CMR — LP DAAC Collection Directory](https://cmr.earthdata.nasa.gov/search/site/collections/directory/LPCLOUD/gov.nasa.eosdis) — identitas MOD14A1.061 dan VNP14A1.002.
- **[S4]** [NASA — VIIRS Active Fire User Guide](https://www.earthdata.nasa.gov/s3fs-public/imported/VIIRS_activefire_User_Guide.pdf) — dokumentasi produk; acuan pemeriksaan QA/SDS sebelum implementasi.
- **[S5]** [TROPOMI — Carbon Monoxide](https://www.tropomi.eu/data-products/carbon-monoxide) — produk CO serta pengaruh awan terhadap sensitivitas.
- **[S6]** [NASA JPL — SMAP Handbook](https://smap.jpl.nasa.gov/files/smap2/SMAP_handbook_web.pdf) — dasar pengukuran kelembapan permukaan.
- **[S7]** [NASA FIRMS — Data API Tutorial](https://firms2.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html) — akses API dan contoh atribut deteksi.
- **[S8]** [NASA Earth Observatory — Fires Char New Guinea](https://science.nasa.gov/earth/earth-observatory/fires-char-new-guinea/) — 22 Oktober 2026; konteks aktivitas kebakaran di Papua dan Kalimantan. Informasi Papua Nugini dalam artikel tidak dihitung sebagai wilayah studi Indonesia.
- **[S9]** [BNPB — Prioritas Penanganan Karhutla](https://ppid.bnpb.go.id/berita/bnpb-prioritaskan-penanganan-karhutla-di-kalimantan-tengah-sumatera-selatan-dan-kalimantan-barat-SdY0) — 24 Oktober 2026; konteks penanganan Kalimantan Tengah dan catatan Papua Selatan; data situasional bersifat sementara.
- **[S10]** [NASA FIRMS — Archive Download](https://firms2.modaps.eosdis.nasa.gov/download/) — arsip dan penggantian NRT dengan standard science-quality.
- **[S11]** [NASA FIRMS — Data Overview](https://firms2.modaps.eosdis.nasa.gov/content/posters/FIRMS-postcard-print.pdf) — latensi global dihitung dari observasi satelit; layanan real-time tertentu berlaku di AS/Kanada.
- **[S12]** [NASA FIRMS — Area API](https://firms.modaps.eosdis.nasa.gov/api/area) — akses area, kredensial, serta batas transaksi.
- **[S13]** [Next.js — Backend for Frontend](https://nextjs.org/docs/app/guides/backend-for-frontend) — backend aplikasi dalam Next.js dan batas server/client.
- **[S14]** [Neon — Prisma Integration](https://neon.com/docs/guides/prisma) — konfigurasi Prisma dengan Neon dan koneksi database.
- **[S15]** [scikit-learn — QuantileTransformer](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.QuantileTransformer.html) — transformasi kuantil; bukan pengganti validasi harmonisasi antarsensor.

Sebelum implementasi ilmiah penuh: tetapkan aturan prioritas kandidat verifikasi, ukuran lokasi, layanan penyimpanan/autentikasi koordinator, seri referensi, aturan penyambungan, dan definisi anomali; bekukan versi arsip serta polygon studi, verifikasi ingest NRT, dan simpan manifest. Jika QA pelengkap digunakan, verifikasi tile serta pemetaan kelas produknya. Sebelum submission: periksa persyaratan challenge, lengkapi atribusi, dan ganti setiap target performa dengan hasil pengukuran aktual atau label “belum diuji”.
