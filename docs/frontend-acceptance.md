> **Keputusan aktif 13 November 2026:** seluruh fitur web tanpa login; Google OAuth bukan persyaratan. Penyimpanan pengguna lokal di browser. Ketentuan akun/kolaborasi server dan status implementasi di bawah merupakan konteks rencana/riwayat sebelumnya; untuk keputusan dan status terbaru ikuti [status aktif](current-status.md).

# Acceptance frontend Orkhan — tanpa backend nyata

Status: **12 kelompok pemeriksaan browser lulus**, tanpa exception runtime. Implementasi frontend tidak membutuhkan perubahan tambahan dari temuan ini. Pengujian dilakukan pada production build lokal di Chrome, desktop 1440×1000 dan mobile 390×844, dengan zona waktu Asia/Jakarta.

## Bukti yang dapat diulang

Script: [`scripts/browser-acceptance.mjs`](../scripts/browser-acceptance.mjs). Jalankan server lokal dan Chrome dengan remote debugging port 9237 menggunakan profil pengujian tersendiri, lalu:

```sh
npm run check:browser
```

`TEST_URL` mengubah alamat aplikasi (default `http://localhost:3002`); `BROWSER_DEBUG_URL` mengubah alamat debugging Chrome (default `http://localhost:9237`). Keduanya wajib localhost/127.0.0.1. Chrome dapat dimulai dengan `--headless=new --remote-debugging-port=9237 --user-data-dir=<direktori-profil-uji>` pada terminal terpisah. Lingkungan sandbox tertentu juga memerlukan konfigurasi renderer Chrome yang sesuai.

Script membuat context incognito baru, membuangnya pada akhir run, dan menyimpan unduhan/hasil di `.cache/acceptance-<timestamp>`. Session, laporan API dan snapshot dicegat dengan respons sintetis hanya di context uji. Endpoint atau database asli tidak ditulis. Fixture tidak ditambahkan ke endpoint aplikasi dan tidak dipublikasikan sebagai data operasional.

| Kelompok | Bukti lulus |
|---|---|
| Snapshot dan nilai tidak diketahui | Payload sintetis valid tampil; persentil/pengulangan/baseline null tidak menjadi nol. |
| Cache dan kegagalan | Respons 503 lalu transport `InternetDisconnected` mempertahankan snapshot wilayah, termasuk setelah reload, dengan label stale. |
| Race wilayah | Request Kalteng ditahan; pengguna pindah ke Papua; hasil Kalteng yang terlambat tidak mengganti tampilan Papua. |
| Status dan isolasi mode | Partial/replay tampil sesuai payload; payload demo pada mode operasional ditolak. |
| Batas jendela | Kandidat tepat 24 jam, lebih 1 ms, tepat 7 hari, dan lebih 1 ms masuk kelompok browser yang benar tanpa duplikasi. |
| Navigasi keyboard | Skip link, navigasi halaman dan pemilihan kandidat aktif melalui Enter. |
| Ekspor | Tombol CSV/JSON benar-benar mengunduh berkas yang dibaca kembali; run, wilayah dan provenance cocok. |
| Keyboard dialog | Sembilan perpindahan Tab tetap di dalam dialog; Escape menutup; fokus kembali ke tombol pembuka. |
| Persistensi | Laporan demo bertahan setelah reload; EN tetap tersimpan; laporan Papua tidak muncul di Kalteng. |
| Storage gagal | Exception localStorage tidak menghasilkan sukses palsu, formulir tetap terbuka, laporan lama tidak hilang. |
| Simpan API dan retry | Respons sintetis pertama 503, retry 201; request ID sama dan hanya satu laporan tampil. |
| Mobile | Tidak ada overflow horizontal dan pemilih wilayah tampil penuh. |

Pengujian sebelumnya juga memverifikasi koreksi demo beserta nilai sebelumnya, EN/ID, worker peta, input sentuh globe, reduced motion, serta fallback peta dengan tile host diblokir. Bukti dan review desain ada di [catatan desain](new-design-implementation.md). Delapan pemeriksaan domain mencakup batas 24 jam/7 hari, polygon, null, timestamp, provenance, dan keamanan ekspor CSV.

## Sisa sprint

Pekerjaan mandiri acceptance frontend di atas selesai. Penutupan sprint penuh masih memerlukan polygon final, implementasi kontrak v1 yang sudah ditetapkan, snapshot/analitik nyata dari Nathan, endpoint dan laporan operasional dari Bagas, pengujian integrasi nyata, serta PR/review Nathan. Pengujian dengan respons sintetis tidak membuktikan ingest FIRMS, keamanan autentikasi produksi, atau audit koreksi backend.

Hasil machine-readable terakhir: [frontend-acceptance-results.json](frontend-acceptance-results.json).
