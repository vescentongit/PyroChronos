> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](docs/current-status.md).

# PyroChronos — Product Specification

**Challenge:** Harmonization of MODIS and VIIRS Hot Spots — NASA Space Apps Challenge 2026\
**Status:** Spesifikasi produk berdasarkan keputusan wawancara; kemampuan yang belum selesai tetap merupakan target implementasi\
**Sumber utama:** NASA FIRMS — arsip MODIS/VIIRS dan feed near-real-time\
**Pengguna utama:** Peneliti yang menganalisis perubahan aktivitas api dan anomali historis\
**Pengalaman utama:** Memilih area dan rentang tanggal, lalu membaca burning activity calendar berbasis data terharmonisasi\
**Cakupan:** Global sejak versi pertama, dengan target historis awal 2000-an hingga sekarang sesuai ketersediaan sumber\
**Area unggulan:** Kalimantan Tengah dan Papua Selatan untuk studi, demonstrasi, serta evaluasi; bukan batas cakupan produk\
**Dasar:** Objective challenge yang dibagikan pengguna, keputusan wawancara tim, dan *PyroChronos Technical Research & Feasibility Paper.pdf*\
**Diperbarui:** 10 November 2026

## 0. Keputusan produk dan status implementasi

Keputusan berikut menjadi acuan ketika berbeda dengan rancangan lama tentang daftar patroli, wilayah tetap, dan kalender berbasis sel-hari.

| Bagian | Keputusan yang disepakati |
|---|---|
| Tujuan analisis | Perubahan aktivitas antarperiode dan anomali terhadap pola historis musiman |
| Pengguna utama | Peneliti; pengelola lahan, petugas respons, dan pemadam menjadi pengguna pendukung |
| Cakupan historis | Global sejak versi pertama; permintaan area/periode baru boleh diproses asinkron dan hasilnya disimpan |
| Area penelitian | Polygon bebas yang digambar pengguna; geometri yang sama dipakai sepanjang perbandingan |
| Pemicu analisis | Tombol **Analisis area** setelah area dan periode dipilih |
| Navigasi peta | Zoom/geser tidak mengganti area analisis atau menjalankan ulang pengolahan historis |
| Activity Map dan Global Heatmap | Satu workspace peta dengan toggle heatmap/titik dan konteks area/periode yang sama |
| Kalender utama | Baris tahun, kolom Januari–Desember; klik bulan untuk detail harian |
| Angka utama kalender | Estimasi jumlah deteksi hotspot yang diharmonisasi; jumlah deteksi asli tetap tersedia |
| Acuan harmonisasi | Setara MODIS sebagai hipotesis awal; penerimaan metode bergantung pada validasi |
| Anomali | Pembanding bergerak pada bulan yang sama dalam 10 tahun sebelumnya secara default; dapat diubah |
| Tandai | Lokasi pemantauan persisten dengan bukti awal, konteks analisis, dan beberapa pemeriksaan terpisah |
| Kepemilikan | Workspace lokal browser tanpa login; lokasi, penugasan dan pemeriksaan tersimpan pada perangkat yang sama. Kolaborasi server pada rancangan lama bukan persyaratan versi aktif |
| Ekspor | CSV deteksi asli, hasil agregat harmonisasi, serta analisis dan visualisasi dengan provenance |

### Status repository saat pembaruan dokumen

Repository menyediakan Next.js/Tailwind, Prisma/Neon, pilihan bahasa Indonesia/English, font Plus Jakarta Sans, peta MapLibre dengan basemap satelit, endpoint FIRMS mentah untuk dua area contoh, endpoint hotspot global berdasarkan bounding box, endpoint laporan, serta pipeline dan modul EQM eksperimental. Respons hotspot terbaru bukan hasil harmonisasi historis. Data dashboard regional dan beberapa alur UI masih memakai fixture demonstrasi.

Pengambilan data terbaru sudah dibatasi menurut bounding box, tetapi perubahan viewport/zoom masih dapat memicu request baru. Activity Map dan Global Heatmap masih memiliki alur data terpisah. Keduanya merupakan masalah implementasi yang harus diperbaiki, bukan perilaku target produk.

Kalender historis global, analisis polygon bebas, harmonisasi tervalidasi, baseline bergerak 10 tahun, job analisis pengguna, penandaan persisten berbasis workspace, penugasan, dan akun individual belum dianggap selesai. Kode akses koordinator bersama yang ada merupakan mekanisme pengembangan sementara, bukan autentikasi workspace tim. Dokumen ini tidak menyatakan seluruh fitur target sudah tersedia.

## 1. Ringkasan produk

PyroChronos adalah webapp riset untuk membangun dan mengeksplorasi burning activity calendar dari data active fire hotspots MODIS dan VIIRS. Produk menghubungkan panjangnya seri historis MODIS dengan kelanjutan dan detail VIIRS melalui harmonisasi yang dapat diuji dan ditelusuri.

Dua pertanyaan utama yang dijawab:

1. **Apakah aktivitas api pada suatu area berubah dibanding periode lain setelah memperhitungkan perbedaan sensor?**
2. **Apakah aktivitas suatu periode tidak biasa dibanding pola musiman pada tahun-tahun sebelumnya?**

Alur inti: pilih polygon → pilih rentang tanggal dan pembanding → tekan **Analisis area** → baca kalender, peta, perubahan, dan anomali → unduh hasil → simpan lokasi untuk analisis ulang atau pemeriksaan tim.

Produk memiliki dua bagian yang saling mendukung: pipeline harmonisasi dan aplikasi visual yang membaca hasil terharmonisasi. Konsistensi seri analitik menjadi tujuan ilmiah; sumber sensor tetap disimpan untuk audit, pemeriksaan metode, dan reproduksibilitas.

Feed terbaru tersedia sebagai bagian dari riwayat hingga sekarang. Deteksi satelit menunjukkan aktivitas yang sudah teramati, bukan prediksi. UI memperlihatkan waktu akuisisi, pembaruan, serta status sementara bila periode belum lengkap. Tidak ada deteksi tercatat tidak otomatis berarti tidak ada kebakaran. [S2][S11]

## 2. Masalah, alasan memilih challenge, dan cakupan

MODIS dan VIIRS berbeda dalam resolusi spasial, sensitivitas, serta kesempatan pengamatan. FIRMS menyajikan produk hotspot MODIS dengan resolusi nominal 1 km dan VIIRS 375 m; jumlah titik mentah keduanya tidak langsung setara. Pergantian atau penambahan sensor dapat tampak sebagai perubahan aktivitas bila seri disambungkan tanpa pengujian. [S2][S3]

Challenge dipilih karena memberi masalah ilmiah dan pengalaman pengguna yang konkret: menyelaraskan seri panjang, memperlihatkan pola musiman serta anomali, dan menyediakan analisis yang dapat diulang melalui area, periode, metode, serta data sumber yang tercatat. Peta menjadi pintu masuk penelitian dan tindak lanjut, sedangkan kalender dan perbandingan menjadi keluaran utama.

### Cakupan geografis dan waktu

- Penjelajahan peta dan pengajuan analisis historis berlaku global sejak versi pertama. Produk tidak membatasi analitik ke daftar dua wilayah studi.
- Target kalender dimulai pada awal 2000-an hingga sekarang, mengikuti ketersediaan masing-masing produk. Tahun awal tidak dipaksakan memiliki data VIIRS yang belum tersedia.
- Area/periode yang belum dihitung dapat masuk antrean job. Ketersediaan global tidak berarti seluruh arsip sudah dihitung atau setiap permintaan selesai seketika.
- Kalimantan Tengah dan Papua Selatan tetap menjadi area unggulan serta contoh validasi. Hasil model satu wilayah tidak otomatis dianggap berlaku global.
- Area di luar dukungan data/model tetap dapat diajukan; sistem menampilkan status data atau validasi yang sebenarnya. Observasi mentah dapat tersedia ketika harmonisasi atau anomali belum dapat dinilai.

Istilah Kalimantan dan Papua pada studi Indonesia mengikuti geometri yang dicantumkan. Jangan menyamakan polygon contoh dengan keseluruhan pulau/provinsi, atau memasukkan Papua Nugini sebagai bagian wilayah Indonesia. Referensi konteks wilayah pada [S8][S9] tidak menjadi bukti kualitas model atau status kebakaran terkini.

## 3. Pengguna dan alur penggunaan

### Pengguna utama

Peneliti yang membutuhkan eksplorasi aktivitas api lintas waktu, perbandingan yang memperhitungkan sensor, dan anomali historis dengan metode yang transparan. Pengelola lahan, petugas respons darurat, dan pemadam dapat memakai hasil sebagai informasi pendukung. Pemilihan persona ini merupakan keputusan desain tim, bukan klaim validasi kebutuhan bersama instansi.

Penandaan dan pemeriksaan merupakan tindak lanjut analisis. Produk tidak mengklaim sebagai sistem dispatch pemadaman, penentu rute aman, prediktor penyebaran api, atau penentu kepatuhan hukum.

### Alur utama peneliti

1. Jelajahi satu workspace peta global dengan citra satelit dan label wilayah.
2. Gambar polygon bebas sebagai area of interest (AOI). Nama dan koordinat lokasi dapat membantu navigasi; memasukkan satu koordinat tidak menggantikan kebutuhan geometri area analisis yang jelas.
3. Pilih rentang tanggal penelitian, periode pembanding jika diperlukan, dan konfigurasi referensi anomali. Pilihan tanggal tidak dibatasi pada 24/48/72/96 jam terakhir.
4. Tekan **Analisis area**. Sistem memakai hasil identik yang masih sesuai atau membuat job untuk permintaan baru.
5. Selama job berjalan, pengguna tetap dapat menggerakkan peta. Status antrean/pemrosesan/gagal terlihat; hasil analisis sebelumnya tetap teridentifikasi dengan area dan periodenya sendiri.
6. Buka kalender tahun × bulan, detail harian, peta heatmap/titik, grafik perbandingan, dan anomali. Seluruh panel mengikuti hasil analisis aktif yang sama.
7. Unduh CSV, ringkasan, dan visualisasi yang menyertakan area, periode, versi data, serta metode.
8. Klik deteksi untuk melihat bukti dan menandai lokasi pemantauan dalam workspace tim. Buka kembali lokasi tersebut untuk periode lain, penugasan, status, serta hasil pemeriksaan.

## 4. Lingkup produk dan pengalaman peta

### Satu workspace peta

Activity Map dan Global Heatmap disatukan menjadi satu workspace pengguna. Toggle **heatmap / titik hotspot** mempertahankan AOI, periode aktif, pilihan lokasi, serta referensi hasil analisis. Perbedaan satuan tampilan harus terlihat: kepadatan/estimasi agregat tidak disamakan dengan titik pengamatan asli.

Basemap menggunakan citra satelit berwarna dan lapisan nama wilayah/tempat yang terbaca sesuai tingkat zoom. Label tidak bergantung pada hover hotspot. Panel detail menampilkan koordinat dan nama wilayah bila tersedia; nama yang tidak dapat dipastikan tidak dikarang. Perpindahan bahasa tidak menghapus konteks peta atau hasil.

Pada zoom luas, heatmap atau cluster mewakili kelompok deteksi. Pengguna dapat membuka detail atau memperbesar kelompok sebelum memilih titik pengamatan; pusat cluster tidak disimpan seolah-olah merupakan koordinat observasi sensor.

### Navigasi dan performa

- Kamera peta, polygon yang sedang diedit, dan permintaan analisis aktif merupakan state terpisah.
- Zoom/geser tidak mengganti AOI aktif, membersihkan hotspot yang sudah dimuat, menghapus hasil kalender, atau menjalankan ulang job historis. Pengeditan polygon/periode baru diterapkan setelah **Analisis area** ditekan.
- Pengambilan tile basemap atau tile data yang belum tersedia tetap boleh terjadi ketika menjelajah. Ini berbeda dari mengunduh ulang batch FIRMS atau menghitung ulang analisis untuk setiap gerakan kamera.
- Gunakan cache dan data spasial berpartisi/tile pada resolusi yang sesuai. Cache tidak hanya bergantung pada bbox kamera yang harus persis sama; area yang sudah tercakup dipakai kembali. Zoom terutama mengubah penyajian/agregasi data yang tersedia.
- Hindari membuat ulang instance peta, sumber, serta seluruh marker pada setiap perubahan UI. Batasi fitur yang dirender melalui tile, agregasi, clustering, dan detail sesuai kebutuhan.
- Loading bersifat lokal dan tidak memblokir navigasi. Data area baru tidak menggantikan hasil area lama tanpa konteks yang jelas; respons usang tidak menimpa pilihan terbaru.
- Kualitas citra dan ketajaman dievaluasi pada desktop/mobile dengan memperhatikan resolusi layar, jaringan, serta ketersediaan imagery. Tidak mengklaim detail melebihi sumber atau target 60 FPS tanpa pengukuran.
- Kegagalan tile tidak menghilangkan analisis atau seluruh overlay. Kegagalan jaringan/data menampilkan kategori dan tindakan pemulihan tanpa membocorkan kredensial.

### Polygon penelitian

Polygon bebas merupakan cara utama memilih area analisis. Simpan geometri WGS84, ID stabil, versi/hash, luas, dan nama yang diberikan pengguna. Tampilkan batasnya pada peta. Validasi koordinat, geometri tidak valid, serta penanganan antimeridian; jangan memperbaiki atau memotong bentuk secara diam-diam sehingga area penelitian berubah.

Gunakan polygon yang sama untuk kedua periode pembanding, kalender, baseline, dan ekspor. Jika geometri diubah, buat revisi/konteks analisis baru. Preset wilayah dapat membantu memulai, tetapi tidak membatasi area yang dapat diajukan. Unggah GeoJSON belum menjadi keputusan MVP; menggambar polygon bebas sudah termasuk lingkup.

### Kalender, perbandingan, dan aksesibilitas

Kalender utama menggunakan baris tahun dan kolom Januari–Desember. Warna merepresentasikan estimasi jumlah deteksi terharmonisasi untuk AOI aktif. Setiap bulan dapat dibuka menjadi detail harian dan deteksi terkait. Rentang tanggal bebas tetap tersedia untuk analisis dan ekspor, termasuk periode yang tidak mencakup satu bulan penuh.

Sediakan tampilan anomali dengan skala berbeda yang dijelaskan secara eksplisit; warna jumlah deteksi dan warna anomali tidak memakai arti yang tertukar. Gunakan color ramp yang dapat diakses, legenda, angka/tooltip, dan status tekstual. Nilai nol, data hilang, serta referensi belum cukup memiliki tampilan berbeda; warna tidak menjadi satu-satunya pembawa informasi.

Perbandingan antarperiode memakai AOI dan konfigurasi metode yang sama. Jumlah total tetap disertai durasi; periode berbeda panjang tidak dianggap setara hanya dari totalnya. Bulan berjalan dan rentang parsial diberi label sementara serta dibandingkan dengan bagian musim/durasi yang sesuai.

UI mempertahankan bahasa Indonesia/English, font Plus Jakarta Sans, dan istilah **Dashboard** pada kedua bahasa. Akses keyboard, fokus, formulir, serta informasi peta yang dapat dibaca melalui daftar/panel menjadi bagian kriteria penerimaan.

### Batas lingkup

| Termasuk target versi pertama | Di luar lingkup awal |
|---|---|
| Analisis historis global, polygon bebas, kalender, perbandingan, anomali, job dan hasil tersimpan | Jaminan seluruh analisis global instan atau semua model sudah tervalidasi di setiap wilayah |
| Satu peta satelit dengan label, heatmap/titik, detail, dan penandaan | Rekonstruksi koordinat hotspot yang tidak pernah diamati |
| Workspace tim, penugasan pemeriksaan, status, hasil, riwayat perubahan | Sistem dispatch, rute patroli, aplikasi lapangan offline, atau notifikasi otomatis |
| CSV dan visualisasi analitis dengan provenance | Sertifikasi legal, estimasi dampak ekonomi, atau prediksi kebakaran tanpa model tervalidasi |
| FIRMS dan metode statistik CPU | PyTorch/Hugging Face atau LLM sebagai syarat produk |

## 5. Data yang digunakan

| Data | Fungsi | Kebijakan dan batasan |
|---|---|---|
| FIRMS MODIS/VIIRS Archive | Fondasi seri historis, pelatihan/evaluasi, kalender, dan pembanding musiman | Catat produk, satelit, versi, periode tersedia, checksum, serta revisi standard science-quality |
| FIRMS NRT / Area API | Melengkapi seri sampai kondisi terbaru dan mendukung eksplorasi | Jendela terbaru tidak menggantikan kebutuhan arsip panjang; key server-only, quota dan kegagalan ditangani |
| Polygon pengguna dan batas administrasi | Area penelitian, agregasi, label, dan konteks wilayah | Geometri analisis tetap sepanjang perbandingan; sumber/versi/lisensi batas administrasi dicatat |
| Citra satelit dan label tempat | Basemap dan orientasi lokasi | Atribusi dipertahankan; umur imagery tidak dianggap sama dengan waktu deteksi hotspot |
| MOD14A1/MYD14A1 Collection 6.1 dan VNP14A1 Version 2 | Pelengkap FireMask/QA untuk eksperimen observabilitas | Periksa metadata, waktu, serta pemetaan QA. VNP14A1 grid 1 km berbeda dari titik FIRMS VIIRS 375 m [S3][S4] |
| Laporan pemeriksaan tim | Bukti manusia dan tindak lanjut lokasi | Terpisah dari observasi satelit dan estimasi harmonisasi; hasil tidak otomatis menjadi ground truth untuk seluruh area |
| Gambut, TROPOMI CO, SMAP | Konteks dan riset lanjutan | Tidak wajib; tidak digunakan untuk mengklaim kebakaran bawah tanah terverifikasi [S5][S6] |

### Akses, arsip, dan revisi

FIRMS menjadi sumber utama yang direkomendasikan untuk challenge, bukan satu-satunya sumber yang boleh dipakai. Arsip historis dan feed terbaru disimpan sebagai lapisan yang dapat ditelusuri. NRT dapat diganti data standard ketika tersedia; perubahan tersebut dicatat sebagai revisi, bukan langsung ditafsirkan sebagai perubahan fenomena. [S7][S10][S12]

Simpan satelit, sensor, product/version, waktu akuisisi UTC, lokasi asli, confidence sumber, FRP beserta unit, status NRT/standard, waktu ingest, manifest, checksum, serta referensi arsip. Pertahankan kategori confidence masing-masing produk; nilainya tidak dianggap probabilitas yang identik. FRP bukan luas terbakar atau energi kumulatif dari penjumlahan lintasan.

Arsip besar ditempatkan pada object storage/Parquet yang dapat dipartisi untuk kueri spasial dan waktu. Dataset mentah global tidak seluruhnya dimasukkan ke repository, browser, atau tabel aplikasi Neon. Kredensial NASA/Earthdata dan database tidak dikirim ke frontend, ekspor, maupun log URL.

## 6. Tools, bahasa, dan arsitektur

| Bagian | Pilihan | Peran |
|---|---|---|
| Webapp | Next.js App Router, React, TypeScript | Workspace riset, Route Handlers, ekspor, dan integrasi hasil |
| Styling | Tailwind CSS, Plus Jakarta Sans | UI responsif dan konsistensi Indonesia/English |
| Peta | MapLibre GL JS | Citra satelit, label, polygon, heatmap/titik; rendering tambahan hanya bila benchmark membutuhkannya |
| Grafik/kalender | Recharts dan komponen kalender | Deret waktu, tahun × bulan, detail harian, serta anomali |
| Database aplikasi | Neon PostgreSQL dan Prisma | Workspace, keanggotaan, AOI, job, metadata hasil, lokasi, penugasan, dan laporan |
| Akses dan identitas | Semua fitur UI tanpa login; penyimpanan lokal browser | Nama pemeriksa/pencatat diberikan pengguna dan tidak diverifikasi sebagai akun. Auth.js hanya untuk endpoint legacy privat |
| Validasi/otorisasi | Zod dan pemeriksaan akses server | Batas payload, status, geometri, serta isolasi workspace |
| Pengolahan ilmiah | Python, NumPy, SciPy, scikit-learn | Agregasi count, baseline statistik, kandidat EQM, dan evaluasi |
| Arsip/kueri | Polars, DuckDB, Parquet, object storage | Kueri spasial/waktu dan agregasi tanpa memuat seluruh arsip di web request |
| Koordinat/raster opsional | PyProj, GDAL/Rasterio | CRS, grid, serta QA pelengkap |
| Job analisis | Worker Python di luar request Next.js, antrean persisten | Pengolahan asinkron, deduplikasi permintaan, retry, dan penerbitan hasil |
| Hosting | Vercel untuk aplikasi; runtime worker ditetapkan melalui uji kapasitas | Pekerjaan ilmiah panjang tidak bergantung pada umur request aplikasi |
| Pengujian | Node, pengujian Python, dan browser | Kebenaran data/metode, hak akses, serta pengalaman pengguna |

Stack Next.js, Tailwind, Prisma, dan Neon dipertahankan. PyTorch, Hugging Face, serta LLM tidak diperlukan untuk harmonisasi statistik dan kalender ini. Kandidat EQM tetap membutuhkan pengujian; transformasi kuantil generik saja bukan bukti harmonisasi tervalidasi. [S15]

### Alur arsitektur target

    FIRMS Archive + NRT
      -> ingest tervalidasi -> arsip berpartisi + manifest
      -> agregasi count -> kalibrasi/evaluasi -> hasil terbitan berversi

    Browser: polygon + periode + konfigurasi
      -> Next.js: validasi, autentikasi bila diperlukan, lookup hasil/job
      -> antrean persisten -> worker Python -> hasil + provenance
      -> kalender, peta, perbandingan, anomali, dan ekspor

    Next.js -> Prisma -> Neon
      -> workspace/anggota, AOI, job, metadata hasil
      -> lokasi pemantauan, penugasan, pemeriksaan, riwayat koreksi

Pengolahan ilmiah dan arsip besar tidak dijalankan dalam browser atau request render halaman. Publikasikan hasil secara atomik setelah validasi; hasil setengah jadi tidak menggantikan run aktif. Job gagal tidak menghapus hasil atau laporan sebelumnya. Semua migrasi skema aplikasi tetap dimiliki Prisma; role worker dibatasi sesuai kontrak.

Scheduler/manual workflow seperti GitHub Actions dapat membantu ingest terjadwal atau persiapan data. Penyedia worker/antrean interaktif, biaya, concurrency, batas area/volume, dan waktu tunggu baru dibekukan setelah benchmark; dokumen ini tidak menjanjikan SLA pemrosesan historis global.

### Identitas job dan cache

Permintaan analisis ditentukan oleh polygon/revisinya, periode, konfigurasi sensor, kebijakan kualitas, versi arsip, metode/model, serta konfigurasi baseline. Cache hasil identik tidak memakai zoom kamera sebagai identitas analisis. Perubahan sumber atau metode tidak mengembalikan hasil lama seolah-olah masih sesuai.

Status minimum job: antre, diproses, selesai, atau gagal. Tampilkan progres bila dapat diukur dan alasan kegagalan yang aman; jangan mengarang persentase atau ETA. Permintaan identik yang berjalan dapat memakai job yang sama sesuai hak akses. Tindakan berulang tidak menggandakan pekerjaan atau laporan. Retry dan batas volume harus jelas tanpa mengubah polygon pengguna diam-diam.

Data satelit/hasil umum dapat memakai cache bersama jika aman. Metadata workspace, penandaan, penugasan, dan pemeriksaan tidak ikut terbuka melalui cache atau ekspor publik.

## 7. Pendekatan ilmiah

### 7.1 Angka utama dan unit analisis

Angka utama kalender adalah **estimasi jumlah deteksi hotspot yang diharmonisasi**, dengan label metode dan acuan. Nilai koreksi dapat pecahan; jangan membulatkannya menjadi seolah-olah sejumlah pengamatan nyata baru. Jumlah deteksi asli tetap tersedia terpisah menurut produk/satelit. Jumlah kejadian kebakaran yang dilaporkan merupakan metrik berbeda yang bersumber dari laporan, bukan hasil menghitung titik satelit.

Grid bersama, dengan kandidat awal sinusoidal 1 km, dapat digunakan untuk penyelarasan ruang, partisi, dan penghitungan. Grid tidak meningkatkan resolusi MODIS dan tidak mengubah unit utama menjadi sel-hari. Sel-hari aktif serta rate berbasis QA boleh menjadi metrik pendamping yang diberi nama dan satuan berbeda.

Normalisasi waktu ke UTC. Deduplikasi rekaman unduhan yang sama tanpa menghapus pengamatan berbeda secara sembarang. Penambahan satelit atau jumlah lintasan tidak boleh langsung menaikkan seri utama tanpa aturan konfigurasi, pairing, serta penyambungan yang terdokumentasi. Agregasi dan penerapan model pada grid/hari/bulan harus dibekukan; hasil transformasi nonlinier tidak diasumsikan dapat dijumlahkan antarresolusi tanpa pengujian.

### 7.2 Acuan harmonisasi dan validasi

**Setara MODIS menjadi hipotesis awal**: seri MODIS merupakan jangkar skala jumlah deteksi, sedangkan VIIRS dikalibrasi agar dapat dibandingkan. Deteksi asli VIIRS yang lebih detail tetap tersedia pada peta. Pilihan ini tidak berarti MODIS merupakan ground truth atau seluruh tambahan sensitivitas VIIRS harus disembunyikan.

Latih dan uji metode pada periode tumpang tindih yang layak dibandingkan, memperhatikan wilayah, musim, kesempatan observasi, konfigurasi satelit, serta status NRT/standard. Data uji tidak digunakan untuk melatih atau memilih parameter. Kandidat dari paper adalah Empirical Quantile Mapping (EQM), dibandingkan dengan count yang diselaraskan tanpa kalibrasi dan baseline sederhana seperti regresi.

Laporkan MAE, bias, ukuran sampel, domain validasi, serta pengaruh terhadap pola musiman dan diskontinuitas seri. EQM tidak wajib diterima jika tidak memperbaiki baseline. Modul EQM yang ada bersifat eksperimental, mempertahankan nol, dan belum membuktikan dapat memulihkan api kecil yang tidak terdeteksi. Input di luar dukungan pelatihan ditandai; jangan mengekstrapolasi diam-diam.

Evaluasi dilakukan per domain/wilayah yang relevan. Model Kalimantan tidak otomatis diterapkan sebagai model Papua atau seluruh dunia. Dukungan pengajuan analisis global dibedakan dari status validasi metode. Jika metode belum layak, tampilkan perbandingan mentah/eksperimental dengan status yang benar; jangan menyebut keluarannya harmonisasi tervalidasi.

Setiap hasil menyimpan versi model dan seri referensi. Jika acuan/metode berubah berdasarkan evaluasi, hasil mendapat versi baru dan perubahan didokumentasikan. Penyambungan MODIS–VIIRS serta konfigurasi satelit dibekukan sebelum menerbitkan seri utama.

### 7.3 Anomali dengan referensi bergerak

Default untuk bulan pada tahun Y adalah bulan yang sama pada **Y−10 sampai Y−1**. Contoh: Agustus 2026 dibandingkan dengan Agustus pada 2016–2025. Tahun yang dinilai tidak masuk referensinya sendiri. Pengguna dapat mengubah panjang referensi; pilihan dan tahun yang benar-benar digunakan ikut tersimpan pada hasil dan ekspor.

Pembanding menggunakan AOI, satuan harmonisasi, dan konfigurasi metode yang konsisten. Periode harian/rentang bebas memerlukan aturan musim, durasi, serta kalender yang terdokumentasi. Bagian bulan berjalan tidak dibandingkan dengan satu bulan penuh. Pengolahan tahun kabisat dan tanggal batas termasuk pengujian.

Tahun awal yang belum mempunyai riwayat cukup tetap menampilkan count yang tersedia, tetapi anomali berstatus **referensi belum cukup**. Tahun/bulan hilang tidak diisi nol atau diganti data masa depan. Minimum kelengkapan, batas panjang referensi, estimator, dan ambang anomali ditentukan melalui evaluasi; jendela 10 tahun bukan jaminan seluruh pengamatan valid.

Tampilkan besar aktivitas, nilai pembanding historis, selisih, periode referensi, serta kualitas data. Persentil/z-score dapat dievaluasi sebagai metode; rumus dan ambang final belum dipilih. Pembanding bernilai nol atau variasi nol tidak menghasilkan pembagian nol, nilai tak hingga, atau label normal palsu. Anomali statistik bukan probabilitas kebakaran, tingkat bahaya, atau prediksi.

### 7.4 Status observasi dan data hilang

Pada jalur FIRMS bedakan **ada deteksi**, **tidak ada deteksi tercatat**, dan **sumber tidak tersedia**. Katalog hotspot tidak membuktikan wilayah bebas awan atau teramati tanpa api. Coverage/QA tidak dihitung dengan menebak dari jumlah titik.

Status observasi valid tanpa deteksi, awan, scan gap, missing granule, atau QA rejected hanya diberikan jika sumber pelengkap yang sesuai mendukungnya; selain itu gunakan unknown. Confidence, sensor tidak tersedia, bulan parsial, serta revisi NRT/standard ikut terlihat.

Untuk eksperimen QA pelengkap:

    rate_per_1000 = 1000 × fire_cell_days / observed_cell_days
    coverage = observed_cell_days / expected_land_cell_days

Gunakan mask daratan dan geometri tetap, serta kelas QA yang diperiksa per produk. Tanpa QA yang memadai, pembagi/rate/coverage bernilai null. Rate ini merupakan metrik pendamping, tidak menggantikan estimasi jumlah deteksi utama.

### 7.5 Riset lanjutan

FRP, CO, SMAP, gambut, dan tutupan lahan dapat menjadi konteks penelitian lanjutan dengan unit, resolusi, QA, serta keterbatasannya masing-masing. Ambang CO/kelembapan atau target peningkatan akurasi dari paper belum menjadi aturan operasional. Data pendukung tidak digunakan untuk menyatakan kebakaran bawah tanah terverifikasi tanpa validasi independen.

## 8. Lokasi pemantauan, workspace, dan kontrak keluaran

### Penandaan lokasi

Klik deteksi membuka bukti pengamatan dan tindakan **Tandai lokasi**. Objek yang disimpan merupakan lokasi pemantauan persisten, bukan hanya baris feed yang hilang ketika filter tanggal berubah. Simpan koordinat pengamatan asli, identitas deteksi awal, nama/label lokasi, konteks AOI dan analisis saat dibuat, pembuat, waktu, serta workspace pemilik.

Lokasi dapat dibuka kembali dan dianalisis pada rentang tanggal lain. Hasil baru tidak menimpa bukti awal. Referensi AOI/versinya mempertahankan cakupan analisis; radius atau aturan area sekitar titik belum dibekukan dan tidak disamakan diam-diam dengan cakupan piksel sensor. Mengubah konteks penelitian tidak memindahkan koordinat pengamatan asli.

### Penugasan dan pemeriksaan

Anggota berwenang dapat menugaskan pemeriksaan kepada anggota tim, memperbarui status, dan mencatat hasil. Lokasi dapat memiliki beberapa penugasan/pemeriksaan terpisah. Status melekat pada pekerjaan pemeriksaan, bukan menyatakan lokasi selamanya aman atau selesai dipantau.

Model status awal untuk implementasi mencakup belum ditugaskan, ditugaskan, sedang diperiksa, selesai, atau dibatalkan; nama serta transisi final diperinci pada kontrak layanan. Status pekerjaan dipisahkan dari hasil observasi lapangan. Hasil yang telah tersedia pada prototype dapat dipertahankan: api/asap ditemukan, tidak ditemukan tanda api saat pemeriksaan, atau belum dapat dipastikan.

Simpan lokasi, pemeriksa/penanggung jawab, pencatat, waktu pemeriksaan sebenarnya, waktu input, catatan, hasil, serta riwayat koreksi. Pencatat dapat berbeda dari pemeriksa. Penugasan selesai tidak berarti api padam. Deteksi baru setelah pemeriksaan tetap terlihat dan dapat memerlukan pemeriksaan baru. Refresh data, pergantian hasil analisis, atau keluarnya deteksi dari periode tampilan tidak menghapus lokasi/laporan.

### Hak akses

Workspace tim menjadi batas kepemilikan lokasi, penugasan, status, dan hasil pemeriksaan. Anggota tim mendapat akses sesuai kewenangannya; pengguna workspace lain tidak dapat membaca atau mengubah catatan tersebut hanya dengan mengetahui ID. Identitas individual diperlukan untuk atribusi dan pemeriksaan server. Peneliti tidak wajib berperan sebagai koordinator operasional.

Hak akses diterapkan pada endpoint, job, hasil tersimpan, cache, dan ekspor yang memuat catatan tim. Idempotensi mencegah penandaan/pengiriman laporan ganda akibat retry. Koreksi mempertahankan jejak perubahan. Catatan demo tidak tercampur dengan hasil pemeriksaan nyata.

### Keluaran analisis dan ekspor

| Keluaran | Isi minimum |
|---|---|
| Identitas analisis | ID run/job, AOI dan geometri/versi/hash, luas, periode, timezone, konfigurasi kueri |
| Data dan metode | Sensor/satelit, produk/versi, NRT/standard, manifest/checksum, waktu ingest, metode/model, acuan, domain validasi |
| Kalender dan perbandingan | Count asli per sumber, estimasi count terharmonisasi dan satuan, resolusi agregasi, durasi, kualitas, status sementara |
| Anomali | Panjang dan tahun referensi bergerak, statistik pembanding, nilai/rumus anomali, kelengkapan, serta alasan belum dapat dinilai |
| Spasial | Titik observasi asli dan agregat/grid yang diberi jenis/satuan eksplisit; polygon analisis tetap |
| Lokasi/pemeriksaan | ID lokasi stabil, bukti awal, analisis terkait, penugasan/status/hasil serta audit; mengikuti akses workspace |

Ekspor **CSV hotspot** berisi deteksi asli yang memenuhi polygon, periode, serta filter kueri. Ekspor agregat terharmonisasi dipisahkan agar estimasi count tidak diubah menjadi sejumlah titik sintetis. Ringkasan dan visualisasi kalender/grafik/peta menyertakan legenda, satuan, AOI, periode, baseline, metode, versi, dan sumber. Bentuk file visualisasi ditetapkan pada implementasi; CSV merupakan keluaran wajib.

Entitas target meliputi User, Workspace/Membership, AnalysisArea, AnalysisJob/Run/Result, MonitoringLocation, InspectionAssignment, InspectionReport, dan revision/audit. Nama ini adalah rancangan konseptual, bukan klaim model Prisma sudah tersedia. [Kontrak riset v2](docs/contracts/api-v2.md), schema/contoh target, dan [tiga sprint per anggota](tasks/SPRINT-PLAN.md) sudah diselaraskan dengan spesifikasi ini. V1 tetap untuk kompatibilitas; endpoint, model penyimpanan, dan worker v2 masih memerlukan implementasi serta integrasi.

## 9. Kendala dan mitigasi

| Kendala | Dampak | Mitigasi |
|---|---|---|
| Arsip global sejak awal 2000-an | Volume, biaya, dan waktu pengolahan besar | Arsip berpartisi, agregat reusable, worker asinkron, cache hasil, serta batas job yang terlihat |
| Request mengikuti setiap gerakan kamera | Loading berulang dan interaksi tersendat | Pisahkan kamera/AOI/analisis; tile dan cache cakupan; analisis eksplisit |
| Kualitas satelit/label tidak konsisten | Sulit mengenali wilayah dan hotspot | Satu konfigurasi basemap, label sesuai zoom, benchmark desktop/mobile, detail koordinat |
| Sensitivitas/jadwal/jumlah satelit berbeda | Tren atau anomali semu | Harmonisasi dan aturan konfigurasi/pairing yang diuji, provenance tetap tersedia |
| Generalisasi model global | Akurat di satu area, gagal di area lain | Evaluasi per domain, status dukungan/validasi, dan hasil parsial yang jujur |
| Baseline awal tidak cukup atau data hilang | Anomali menyesatkan | Referensi belum cukup, null, metadata kelengkapan, tanpa data masa depan |
| Polygon berubah atau melintasi antimeridian | Perbandingan salah atau hitungan ganda | Validasi geometri, versi/hash, uji spasial serta durasi konsisten |
| Kredensial/quota/jaringan NASA | Ingest/job gagal | Key server-only, timeout, retry terbatas, cache, kategori error aman |
| Keterlambatan/revisi NRT ke standard | Hasil berubah atau tampak seolah final | Versi arsip, hasil sementara, invalidasi cache dan pemrosesan ulang terkontrol |
| Akses lintas workspace atau laporan hilang | Catatan tim terbuka atau pekerjaan tidak tercatat | Otorisasi server, transaksi, audit, idempotensi, serta status gagal simpan yang jelas |
| Warna dianggap tingkat bahaya | Interpretasi keliru | Legenda metrik, ramp aksesibel, angka/status tekstual, pemisahan anomali dan hasil pemeriksaan |

## 10. Urutan implementasi dan pembagian tim

### Tahapan

1. **Fondasi pengalaman peta:** satukan Activity Map/Global Heatmap, perbaiki navigasi/cache/rendering dan label, tambahkan polygon serta penerapan area/periode secara eksplisit. Navigasi tidak menghapus hasil.
2. **Arsip dan harmonisasi:** siapkan ingest/partisi global, job asinkron, count dan provenance, evaluasi acuan setara MODIS, serta status ketersediaan/validasi. Dua area unggulan menjadi contoh uji, bukan allowlist pengguna.
3. **Kalender dan analisis:** kalender tahun × bulan dan detail harian, perbandingan tanggal bebas, referensi bergerak 10 tahun, status data tidak cukup, serta ekspor CSV/visualisasi.
4. **Workspace dan pemeriksaan:** akun individual, isolasi tim, lokasi tersimpan, penugasan, beberapa pemeriksaan per lokasi, status/hasil, serta audit/idempotensi.
5. **Integrasi dan evaluasi:** replay historis, benchmark data nyata, kegagalan jaringan/job, akses tim, reproduksibilitas ekspor, dan demonstrasi.

Tahapan ini menggantikan batas lama MVP dua wilayah/daftar patroli. Cakupan global historis merupakan target versi pertama yang disepakati; pengiriman internal dapat bertahap tanpa menyebut subset demo sebagai implementasi global yang sudah lengkap.

Rencana lama 48 jam merupakan asumsi hackathon, bukan estimasi tervalidasi untuk seluruh scope baru. Persiapan arsip, metode, serta infrastruktur harus dihitung terpisah. Jangan menjanjikan semua kemampuan ini selesai 48 jam tanpa estimasi dan bukti kesiapan. Demonstrasi boleh menggunakan hasil nyata yang sudah diproses, dengan cakupan, antrean global, dan fitur yang belum selesai dijelaskan secara jujur.

### Pembagian tiga software engineer

| Anggota | Tanggung jawab utama | Keluaran |
|---|---|---|
| Nathan | Arsip/ingest FIRMS, partisi dan agregasi count, baseline bergerak, harmonisasi, evaluasi ilmiah | Dataset dan keluaran analisis berversi, pengujian, serta laporan dukungan metode |
| Bagas | Prisma/Neon, autentikasi dan workspace, antrean/status job, API hasil, lokasi/penugasan/pemeriksaan, deployment | Layanan persisten dengan isolasi tim dan integrasi worker yang dapat diuji |
| Orkhan | Satu workspace peta, polygon, kalender dan perbandingan, detail/penandaan, UI penugasan/pemeriksaan, integrasi dan pengujian UX | Alur penelitian dan tindak lanjut yang konsisten, aksesibel, serta responsif |

Beban total dibagi rata menjadi sepertiga per anggota, termasuk coding, pengujian, dokumentasi, integrasi, dan presentasi. Tinjau estimasi bersama dan pindahkan potongan implementasi bila suatu jalur menjadi bottleneck; pembagian modul saja tidak membuktikan beban seimbang.

Orkhan tetap memiliki porsi coding penuh. Kemampuan bisnis/desain/presentasi membantu review bersama dan tidak menjadi alasan mengurangi coding atau menumpuk seluruh pekerjaan pendukung padanya. Review silang, integrasi, materi presentasi, serta latihan demo menjadi tanggung jawab bersama.

## 11. Kriteria penerimaan dan pengujian

### Peta dan alur penelitian

- Zoom/geser berulang tidak menjalankan ulang job historis, mengganti AOI aktif, membersihkan hasil analisis, atau mengunduh ulang batch FIRMS identik.
- Tile baru dapat dimuat sesuai kamera; cache cakupan digunakan kembali dan loading tidak memblokir navigasi. Benchmark mencatat perangkat, volume, jaringan, serta hasil aktual.
- Toggle heatmap/titik mempertahankan area, periode, pilihan lokasi, dan hasil. Nama wilayah, koordinat, serta unit lapisan dapat dipahami pengguna.
- Polygon bebas, revisi geometri, antimeridian, pembatalan edit, dan klik cluster tidak menghasilkan area atau koordinat bukti palsu.
- Kalender tahun × bulan membuka detail harian. Pemilihan tanggal bebas dan perbandingan memakai geometri yang sama; periode parsial/beda durasi diberi konteks.
- Indonesia/English, Plus Jakarta Sans, Dashboard, keyboard/fokus, ramp warna aksesibel, serta status non-warna tetap bekerja.

### Data dan metode

- Rerun dengan input/versi sama dapat direproduksi; unduhan berulang tidak menggandakan deteksi.
- Count asli, estimasi harmonisasi, sel-hari, jumlah laporan, luas terbakar, dan FRP tidak dipertukarkan sebagai metrik yang sama. Estimasi tidak membuat titik pengamatan sintetis.
- Model diuji di luar data pelatihan, dibandingkan baseline, dan dilaporkan per domain. Kegagalan EQM, kurang sampel, atau input di luar dukungan tetap terlihat.
- Acuan setara MODIS dapat ditelusuri; perubahan acuan/model menghasilkan versi baru. Tidak ada klaim angka peningkatan akurasi dari paper sebelum dibuktikan.
- Untuk default anomali bulan pada tahun Y, referensi tepat Y−10 sampai Y−1 pada bulan yang sama. Perubahan panjang referensi tercatat; data masa depan tidak masuk penilaian historis.
- Tahun awal, data hilang, bulan berjalan, tahun kabisat, referensi nol/variasi nol, serta revisi NRT/standard tidak memunculkan anomali palsu atau pembagian nol.
- Coverage/observasi valid tidak direkayasa dari katalog FIRMS. Pada jalur QA, fire_cell_days ≤ observed_cell_days ≤ expected_land_cell_days; tanpa pembagi valid keluaran null.
- Ekspor CSV berisi observasi asli di dalam polygon/periode; ekspor agregat/visualisasi mereproduksi konfigurasi, sumber, metode, serta baseline analisis.

### Job, penyimpanan, dan workspace

- Pengajuan analisis baru menghasilkan job/status yang dapat dipantau; permintaan identik tidak menggandakan pekerjaan tanpa alasan. Gagal/retry tidak menerbitkan hasil setengah jadi.
- Hasil lama tetap dapat dibuka dengan label konteks/versinya. Kegagalan tile, ingest, atau worker tidak menghapus lokasi dan laporan.
- Lokasi tetap ada setelah refresh, pergantian periode, serta update data. Bukti awal dan analisis berikutnya dapat ditelusuri.
- Satu lokasi dapat memiliki beberapa pemeriksaan. Status pekerjaan tidak dianggap status api; deteksi setelah pemeriksaan tidak disembunyikan.
- Pengguna workspace lain tidak dapat membaca/mengubah lokasi, job privat, penugasan, atau laporan melalui tebakan ID, cache, maupun ekspor.
- Pemeriksa, pencatat, waktu pemeriksaan, dan waktu input tidak tercampur. Retry tidak menggandakan laporan; koreksi mempertahankan audit dan kegagalan simpan terlihat.

Keberhasilan produk adalah seri dan pengalaman penelitian yang transparan, konsisten, serta dapat diuji. Klaim akurasi seluruh kebakaran atau dampak operasional memerlukan referensi independen dan validasi tambahan.

## 12. Koreksi terhadap paper dan keputusan yang masih perlu diuji

| Klaim/arah lama | Keputusan produk sekarang |
|---|---|
| Pengguna utama koordinator patroli | Peneliti; pemeriksaan merupakan tindak lanjut dalam workspace tim |
| Riwayat lengkap hanya untuk dua subset dan area dipilih dari daftar tetap | Target historis global sejak versi pertama, AOI polygon bebas, job baru boleh asinkron |
| Feed terbaru sebagai pusat pengalaman | Kalender harmonisasi lintas waktu, perubahan antarperiode, dan anomali menjadi pusat; kondisi terbaru termasuk di dalamnya |
| Sel-hari sebagai angka utama | Estimasi jumlah deteksi terharmonisasi menjadi angka utama; sel-hari/QA sebagai pendamping |
| Seri acuan belum dipilih | Setara MODIS menjadi hipotesis awal yang harus lolos evaluasi |
| Penugasan tim di luar MVP | Penandaan lokasi, penugasan, status, hasil, dan riwayat pemeriksaan termasuk target versi pertama |
| VNP14A1 disebut 750 m | Bedakan produk harian grid 1 km dari instrumen/FIRMS 375 m [S3][S4] |
| Grid/H3 menjamin seluruh distorsi hilang | Grid merupakan alat analisis; geometri, luas, dan reproyeksi tetap diperiksa |
| Nol/CO/SMAP membuktikan tidak ada api atau kebakaran bawah tanah | Observabilitas dan bukti pendukung tetap mempunyai keterbatasan; tidak ada verifikasi otomatis |
| 26 tahun seamless, MAE turun 42%, jutaan titik 60 FPS | Target yang memerlukan validasi/benchmark, bukan kemampuan selesai |
| Estimasi dampak ekonomi, probabilitas api, atau kepatuhan legal otomatis | Tidak menjadi klaim produk tanpa data dan metode yang memadai |

Keputusan ilmiah yang masih terbuka: pairing dan penyambungan satelit, resolusi/agregasi model, minimum kelengkapan referensi, metode/ambang anomali, serta aturan domain validasi. Keputusan teknis yang masih terbuka: penyedia antrean/worker/object storage, batas kapasitas job, aturan cakupan sekitar lokasi titik, format visualisasi unduhan, penyedia identitas, dan transisi detail penugasan.

Hal-hal tersebut diperinci melalui kontrak dan pengujian; tidak membatalkan keputusan produk tentang cakupan global, polygon bebas, analisis eksplisit, kalender, referensi 10 tahun, dan workspace tim. Referensi bibliografi paper serta ilustrasi hipotetis tidak dipakai sebagai bukti hasil eksperimen.

## 13. Sumber dan tindak lanjut

Keputusan produk pada dokumen ini mengikuti wawancara tim tanggal 10 November 2026 dan objective challenge yang dibagikan pengguna dalam percakapan. Paper lokal menjadi sumber gagasan, bukan bukti bahwa seluruh klaimnya telah tervalidasi. Referensi teknis dari versi sebelumnya dipertahankan di bawah; persyaratan submission dan detail produk data tetap perlu diperiksa sebelum implementasi ilmiah atau pengumpulan.

- **[S1]** [NASA Space Apps — Harmonization of MODIS and VIIRS Hot Spots](https://www.spaceappschallenge.org/2026/challenges/harmonization-of-modis-and-viirs-hot-spots/) — halaman challenge; objective yang dibagikan pengguna menjadi dasar lingkup produk, sedangkan ketentuan submission resmi tetap perlu diperiksa.
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

Sebelum implementasi ilmiah penuh, bekukan versi arsip dan aturan pairing, uji hipotesis setara MODIS pada data tumpang tindih dengan evaluasi terpisah, tentukan aturan baseline/anomali serta status kurang data, dan ukur kueri polygon global pada worker. Integrasikan kontrak v2, model penyimpanan, serta task/sprint yang sudah diselaraskan tanpa menganggap dokumen/schema target sebagai fitur yang sudah berjalan. Sebelum submission, periksa ketentuan resmi, atribusi, serta kesesuaian klaim demonstrasi dengan hasil pengukuran sebenarnya.
