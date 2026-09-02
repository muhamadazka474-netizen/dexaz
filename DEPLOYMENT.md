# Deploy DEXAZ: Frontend di Vercel, Backend Tetap di PC-mu

DEXAZ dirancang **local-first**: backend (FastAPI) menyimpan data di SQLite
lokal dan konek ke PostgreSQL di PC-mu sendiri. Ini bukan hal yang bisa
dijalankan di Vercel (Vercel = serverless, tidak ada proses yang jalan terus
dan tidak ada storage lokal). Jadi setup-nya:

- **Frontend (Next.js)** → di-deploy ke **Vercel**, bisa diakses dari mana saja.
- **Backend (FastAPI)** → tetap jalan di PC-mu seperti biasa (`run-dexaz.bat`
  atau manual), tapi diekspos ke internet lewat **tunnel** supaya frontend
  di Vercel bisa mengaksesnya.

## 1. Push ke GitHub (tanpa `.env`)

Di folder project ini (di PC-mu, bukan di sini):

```powershell
git init
git add .
git status   # PASTIKAN .env TIDAK muncul di daftar (harus sudah di-ignore)
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/<username>/<repo>.git
git push -u origin main
```

`.gitignore` di repo ini sudah mengecualikan `.env`, `.env.local`,
`node_modules/`, `venv/`, file SQLite (`*.db`), dan folder `logs/`/`data/`.
File yang tetap ikut ke GitHub hanyalah `.env.example` (isinya cuma
placeholder, aman).

⚠️ Kalau kamu **pernah** `git add`/commit `.env` sebelumnya di history lama,
`.gitignore` saja tidak cukup — file itu tetap ada di history. Cek dulu
dengan `git log --all --full-history -- .env`. Kalau kosong, aman.

## 2. Expose backend lokal ke internet (tunnel)

Pilih salah satu:

**Cloudflare Tunnel (gratis, tidak perlu akun untuk quick tunnel)**
```powershell
# download cloudflared, lalu:
cloudflared tunnel --url http://127.0.0.1:8000
```
Ini akan memberi URL publik seperti `https://acak-kata.trycloudflare.com`.

**ngrok (alternatif populer)**
```powershell
ngrok http 8000
```

⚠️ URL dari quick tunnel **berubah setiap kali kamu restart tunnel-nya**,
kecuali kamu daftar domain tetap (Cloudflare named tunnel / ngrok
reserved domain, biasanya berbayar/perlu akun). Kalau URL berubah, kamu
harus update `NEXT_PUBLIC_API_URL` di Vercel juga (langkah 4).

## 3. Update `.env` lokal (backend)

Di `.env` (root project, **file ini TIDAK ikut ke GitHub**), tambahkan
domain Vercel kamu ke `DBX_FRONTEND_ORIGIN` (boleh lebih dari satu,
dipisah koma):

```
DBX_FRONTEND_ORIGIN=http://127.0.0.1:3000,https://nama-app-kamu.vercel.app
```

Lalu restart backend supaya perubahan `.env` terbaca.

## 4. Deploy frontend ke Vercel

1. Buka [vercel.com](https://vercel.com) → **Add New Project** → import
   repo GitHub yang barusan kamu push.
2. Karena `frontend/` ada di subfolder, di step **Configure Project** set
   **Root Directory** = `frontend`.
3. Framework Preset otomatis terdeteksi **Next.js** — biarkan default.
4. Di **Environment Variables**, tambahkan:
   - `NEXT_PUBLIC_API_URL` = URL tunnel dari langkah 2 (contoh:
     `https://acak-kata.trycloudflare.com`)
5. Klik **Deploy**.

Setelah selesai, buka `https://nama-app-kamu.vercel.app` — pastikan PC-mu,
PostgreSQL, backend, dan tunnel semuanya sedang menyala.

## 5. Kalau tunnel mati / PC dimatikan

Karena backend jalan di PC-mu, aplikasi hanya bisa diakses saat:
- PC menyala,
- PostgreSQL menyala,
- backend (`run-dexaz.bat`) menyala,
- tunnel menyala.

Kalau butuh akses 24/7 tanpa bergantung PC menyala, itu artinya backend
perlu dipindah ke hosting cloud (mis. Railway/Render) dan target database
juga perlu Postgres cloud — itu perubahan arsitektur yang lebih besar,
bilang saja kalau nanti mau ke arah situ.

## 0. Sekali per clone: aktifkan pre-commit hook anti-.env

Repo ini punya hook di `.githooks/pre-commit` yang **menolak commit**
kalau ada file `.env` asli (bukan `.env.example`) ke-stage — pengaman
tambahan di atas `.gitignore`, jaga-jaga kalau `.gitignore` suatu saat
kepencet ke-edit. Aktifkan sekali saja per clone:

```powershell
git config core.hooksPath .githooks
```

Ini setting lokal (tidak ikut ke-push), jadi jalankan lagi tiap kali kamu
clone repo ini di komputer/folder baru.

## Checklist keamanan sebelum publish

Jalankan `verify-safe-to-push.ps1` (klik dua kali atau lewat PowerShell)
sebelum tiap `git push` — dia mengecek sebagian besar poin di bawah ini
secara otomatis:

- [ ] `.env` tidak pernah ada di `git status` / `git log`
- [ ] `DBX_ADMIN_PASSWORD` sudah diganti dari default
- [ ] `SECRET_KEY`, `JWT_SECRET`, `ENCRYPTION_KEY` sudah nilai acak yang
      panjang (bukan nilai contoh di `.env.example`)
- [ ] `DBX_FRONTEND_ORIGIN` hanya berisi origin yang kamu percaya (jangan `*`)
- [ ] Kalau backend akan ditunnel ke internet: pertimbangkan set
      `DBX_ENABLE_FS_BROWSER=false` di `.env` — endpoint `/api/fs/*`
      membiarkan siapa pun yang berhasil login menjelajah SELURUH disk
      lokal PC-mu (semua drive/folder yang bisa dibaca user OS-mu). Aman
      selama backend cuma dengar dari `127.0.0.1`, jadi lebih berisiko
      begitu ada tunnel publik ke sana.
- [ ] Brute-force login sudah dibatasi otomatis (default: 5 percobaan
      gagal → akun dikunci 15 menit; atur lewat `DBX_LOGIN_MAX_ATTEMPTS`
      dan `DBX_LOGIN_LOCKOUT_MINUTES` di `.env`)
- [ ] Kalau kamu sempat share/upload folder project ini (mis. ke tool AI,
      cloud drive, dsb) sebelum `.env` di-generate ulang: anggap
      `SECRET_KEY`/`JWT_SECRET`/`ENCRYPTION_KEY`/password DB di dalamnya
      sudah "terlihat pihak lain" dan generate nilai baru sebelum online,
      meski file itu sendiri tidak pernah masuk git
