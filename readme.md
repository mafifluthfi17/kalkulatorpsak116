# Kalkulator Sewa PSAK 116

Aplikasi web sederhana untuk menghitung **lease liability** dan **right-of-use (ROU) asset** sesuai PSAK 116 / IFRS 16, lengkap dengan jurnal akuntansi otomatis dan export ke Excel. Dibuat sebagai HTML/CSS/JS murni (tanpa Node.js/npm/build step) supaya bisa langsung dihosting sebagai situs statis dan diinstal sebagai PWA di Android.

## Struktur Berkas

```
index.html              Halaman utama (wizard + hasil)
css/style.css            Styling
js/calc-engine.js         Engine kalkulasi PV, amortisasi, depresiasi (pure function, teruji)
js/journal-engine.js      Generator jurnal akuntansi rule-based
js/export-excel.js        Export ke .xlsx (single & gabungan portofolio, styled) via ExcelJS
js/storage.js             Penyimpanan lokal (localStorage) untuk mode Multi-Kontrak
js/app.js                 Logic wizard UI, mode single/multi, dan rendering hasil
vendor/exceljs.min.js     Library ExcelJS (di-vendor lokal, supaya PWA tetap jalan offline)
manifest.json             Manifest PWA
service-worker.js         Cache offline-first untuk app shell
icons/icon-192.png, icon-512.png   Ikon PWA
server.ps1                Server statis lokal (hanya untuk development/testing di komputer ini)
generate-icons.ps1         Skrip regenerasi ikon (jika ingin mengganti desain ikon)
```

## Menjalankan di Komputer Sendiri (untuk testing)

Karena tidak ada Node.js di lingkungan pengembangan, disediakan server statis sederhana berbasis PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File server.ps1
```

Lalu buka `http://localhost:8080` di browser. Jika Anda punya Node.js/Python di komputer Anda sendiri, bisa juga pakai `npx serve` atau `python -m http.server` sebagai alternatif — aplikasi ini tidak butuh library server tertentu, hanya perlu **disajikan lewat HTTP(S)** (bukan dibuka langsung sebagai file, karena modul JavaScript tidak berjalan lewat `file://`).

## Deploy ke Internet (supaya bisa diinstal sebagai PWA di HP)

PWA wajib diakses lewat HTTPS. Cara tercepat dan gratis:

1. **Vercel / Netlify** — daftar akun, lalu drag-and-drop folder ini (atau hubungkan ke repo Git). Kedua platform otomatis memberi HTTPS. Tidak perlu konfigurasi build apa pun (tidak ada `build command`, cukup atur "Output/Publish directory" ke root folder ini).
2. Setelah online, buka link-nya di Chrome Android → menu (⋮) → **"Add to Home screen" / "Install app"**.

## Mode Single vs Multi-Kontrak

Saat pertama dibuka, aplikasi menanyakan mode kalkulasi:

- **Satu Kontrak** — hitung cepat, hasil tidak otomatis tersimpan (ada tombol opsional "Simpan ke Portofolio" jika berubah pikiran).
- **Multi-Kontrak (Portofolio)** — setiap kontrak yang dihitung otomatis tersimpan di **localStorage browser** (data tersimpan di perangkat/browser itu saja, tidak ada server/database). Tersedia dashboard dengan ringkasan angka gabungan (total ROU, total liabilitas, total current/non-current, dll) yang dihitung ulang berdasarkan satu tanggal pelaporan portofolio yang bisa diganti-ganti, serta tombol edit/hapus per kontrak dan export gabungan ke satu file Excel (1 sheet ringkasan portofolio + 4 sheet detail per kontrak).

Mode terakhir yang dipakai akan diingat otomatis untuk kunjungan berikutnya (bisa diganti kapan saja lewat tombol "Ganti Mode" di header). **Catatan:** karena datanya tersimpan di localStorage browser, data portofolio tidak akan ikut pindah jika Anda membuka aplikasi dari browser/perangkat lain, dan akan hilang jika cache/data situs browser dibersihkan.

## Batasan MVP (disengaja, sesuai lingkup permintaan)

- Belum mendukung lease modification, remeasurement, atau sale-and-leaseback.
- Asumsi pembayaran selama periode perpanjangan (jika opsi perpanjangan dicentang) sama nilainya dengan periode awal.
- Insentif sewa & biaya langsung awal diasumsikan tunai pada tanggal commencement (dijelaskan sebagai catatan di sheet jurnal Excel).
- Penyimpanan portofolio memakai localStorage browser (bukan database/server) — tidak ada login, tidak ada sinkronisasi lintas perangkat.
- Semua kalkulasi bersifat rule-based/deterministik (bukan AI), sesuai permintaan, agar hasil akurat dan dapat diaudit.

**Disclaimer:** Aplikasi ini adalah alat bantu hitung. Hasil perhitungan tetap perlu direview oleh akuntan/auditor yang kompeten sebelum digunakan dalam laporan keuangan resmi — khususnya terkait penentuan IBR yang memerlukan judgment profesional.
