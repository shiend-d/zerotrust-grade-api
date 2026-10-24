# Zero Trust Sistem Nilai

API Sistem Nilai dan Transkrip untuk tugas praktikum Zero Trust Security. Gateway bertindak sebagai PEP, Policy Engine memeriksa identitas dan konteks, dan kedua service memverifikasi kembali gateway secret serta JWT.

## Persyaratan

- Node.js 24 (menggunakan `node:sqlite` dan `fetch` bawaan)
- npm
- `curl` dan `jq` untuk menjalankan demo

## Menjalankan

```bash
npm install
npm start
```

Gateway tersedia di `http://localhost:3000`, Service Nilai di port `3001`, dan Service Transkrip di port `3002`. Gateway menyediakan `GET /health`. Database bersama `kampus.db` dibuat dan diisi seed saat proses mulai. Untuk menghentikan seluruh server, tekan Ctrl+C.

## Menjalankan lewat Nix

Flake menyediakan dev shell dengan Node.js 24, `curl`, dan `jq`. Dari folder proyek:

```bash
nix develop
npm install
npm start
```

Perintah `nix develop` masuk ke lingkungan proyek tanpa mengubah konfigurasi NixOS sistem. Dependency npm cukup dipasang sekali. Jalankan demo dari terminal interaktif:

```bash
npm run demo
```

Demo menampilkan nomor langkah, endpoint, status HTTP aktual, dan body JSON yang diformat. Tekan Enter untuk menjalankan request berikutnya; token ditampilkan sesuai response API. Laporan Markdown dibuat di `demo-run.md` di folder proyek dan diperbarui setiap kali demo dijalankan. Untuk memilih lokasi laporan sendiri, gunakan `env DEMO_LOG=nama-file.md npm run demo`. Untuk menjalankan semua langkah tanpa jeda:

```bash
npm run demo -- --auto
```

`demo.sh` menyalakan server dengan database sementara bila gateway belum hidup, lalu menghentikan server setelah demo. Bila gateway sudah berjalan, skrip menggunakan server dan database tersebut tanpa menghentikannya. Untuk video, sebaiknya gunakan database demo baru agar Kelas 1 belum terfinalisasi. `flake.lock` mengunci revisi nixpkgs supaya lingkungan Nix dapat direproduksi.

## Akun seed

| Username | Password | Role | NIM | Device ID |
|---|---|---|---|---|
| `admin` | `admin123` | admin | — | `dev-admin-01` |
| `dosen1` | `dosen123` | dosen | — | `dev-dosen-01` |
| `dosen2` | `dosen123` | dosen | — | `dev-dosen-02` |
| `mhs1` | `mhs123` | mahasiswa | `237006001` | `dev-mhs-01` |
| `mhs2` | `mhs123` | mahasiswa | `237006002` | `dev-mhs-02` |
| `mhs3` | `mhs123` | mahasiswa | `237006003` | `dev-mhs-03` |

Password seed disimpan sebagai SHA-256 hash. Data kelas awal: `KP70065004` Keamanan Informasi (dosen1) dan `KP70065009` Keamanan Jaringan (dosen2). Database tidak otomatis direset saat restart; hapus `kampus.db` sebelum menjalankan aplikasi bila ingin mengulang demo dari seed awal.

## Endpoint

Semua endpoint aplikasi diakses melalui gateway.

| Method dan path | Fungsi |
|---|---|
| `POST /auth/login` | Login dengan `{ "username", "password" }` dan header `X-Device-ID` |
| `POST /auth/refresh` | Perbarui access token dengan `{ "refresh_token" }` dan device terdaftar |
| `POST /auth/logout` | Cabut refresh token dengan `{ "refresh_token" }` |
| `POST /auth/service` | Terbitkan token service dengan `{ "client_id", "client_secret" }` |
| `GET /nilai` | Lihat nilai sesuai role dan kepemilikan |
| `PUT /nilai/:id` | Ubah nilai dengan `{ "nilai_angka", "nilai_huruf" }` |
| `POST /kelas/:id/finalisasi` | Finalisasi kelas dan sinkronkan transkrip |
| `GET /transkrip/:nim` | Lihat transkrip sesuai role dan kepemilikan |
| `POST /transkrip/sinkron` | Endpoint internal yang hanya menerima token service |
| `GET /audit-logs` | Lihat log keputusan; khusus admin terautentikasi |

Access token berlaku 10 menit, refresh token tersimpan selama 1 hari, dan token service berlaku 5 menit. Request user non-auth menyertakan `Authorization: Bearer <token>` dan `X-Device-ID`. Service menolak request tanpa `X-Gateway-Secret` valid dan JWT valid.

## Jam akses

Perubahan dan finalisasi nilai diizinkan mulai pukul 07.00 hingga sebelum 21.00. Rentang dapat diatur melalui `ACCESS_START_HOUR` dan `ACCESS_END_HOUR`. Header opsional `X-Simulated-Hour` dipakai skrip demo untuk mensimulasikan jam; fasilitas ini ditujukan untuk demonstrasi lokal.

Konfigurasi dapat diubah lewat environment variable: `GATEWAY_PORT`, `NILAI_PORT`, `TRANSKRIP_PORT`, `JWT_SECRET`, `GATEWAY_SECRET`, `SERVICE_CLIENT_ID`, `SERVICE_CLIENT_SECRET`, `ACCESS_START_HOUR`, `ACCESS_END_HOUR`, dan `DATABASE_PATH`. Default secret hanya untuk demo lokal; ganti sebelum penggunaan di luar lingkungan demo.

## Alur demo video

Skrip interaktif `demo.sh` menunjukkan penolakan login dari device tak terdaftar, refresh dan logout, verifikasi service, pembatasan nilai dan transkrip, kebijakan jam akses, finalisasi, sinkronisasi dengan token service, dan audit log. Implementasi gateway dan aturan akses ada di `gateway.js` serta `policy.js`; pemeriksaan ulang dan operasi data ada di `service-nilai.js` dan `service-transkrip.js`.
