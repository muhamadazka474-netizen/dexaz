# DEXAZ (Database Explorer Azka)

Local-first database management & SQL analytics platform — a modern,
dark, "local database IDE" for PostgreSQL running on your own PC.
See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design writeup.

**Status: Phase 1** — connection manager, dynamic database
introspection, database explorer, table data/structure/relations/
indexes viewer, dashboard, authentication, audit log, and a query
execution API (its SQL Editor UI arrives in Phase 3).

## Requirements

- **Python** 3.11+ (tested on 3.12)
- **Node.js** 20+
- **PostgreSQL** running locally on your PC (native install or Docker
  — DEXAZ just needs a host/port/user/password to reach it)

## Windows setup

1. Install [PostgreSQL for Windows](https://www.postgresql.org/download/windows/)
   if you don't already have it, and note the port (default `5432`)
   and the `postgres` user's password.
2. Install [Python 3.12](https://www.python.org/downloads/windows/) and
   [Node.js LTS](https://nodejs.org/) — check "Add to PATH" during
   Python install.
3. Open PowerShell in the `dbxplorer` folder and follow **Native
   development** below.

## Environment variables

Copy `.env.example` to `.env` at the project root and fill in real
values — a working `.env` is already included in this delivery with
your PostgreSQL connection pre-filled (`DBX_BOOTSTRAP_*` variables),
so you can skip straight to running it. Never commit `.env` to Git —
it's already in `.gitignore`.

Key variables:

| Variable                | Meaning                                                    |
|--------------------------|-------------------------------------------------------------|
| `SECRET_KEY` / `JWT_SECRET` | Random strings signing sessions — already generated for you |
| `ENCRYPTION_KEY`             | Fernet key encrypting stored DB passwords — already generated |
| `DBX_ADMIN_USERNAME/PASSWORD`| Local login seeded on first run (`admin` / `admin123`)    |
| `DBX_BOOTSTRAP_*`              | Optional: auto-creates one connection on first run         |

## Native development (recommended on Windows)

**Cara cepat (otomatis):** klik dua kali `run-dexaz.bat` di folder ini.
Script ini berjalan **tanpa memunculkan jendela PowerShell/terminal
sama sekali** — begitu diklik, sebuah halaman loading beranimasi akan
terbuka di browser sementara di background script tersebut: mematikan
proses yang memakai port 3000/8000 (jika ada), lalu setup + menjalankan
backend dan frontend dari awal secara tersembunyi. Halaman loading akan
otomatis pindah ke `http://127.0.0.1:3000/login` begitu frontend siap
(percobaan pertama lebih lama karena `npm install`).

Log proses backend/frontend ada di folder `logs/` (dibuat otomatis) jika
perlu troubleshooting. Untuk menghentikan DEXAZ, klik dua kali
`stop-dexaz.bat`.

**Boleh diklik ulang kapan saja:** menutup tab/jendela browser TIDAK
mematikan DEXAZ (backend & frontend memang didesain tetap jalan di
background). Kalau ingin membukanya lagi, klik dua kali `run-dexaz.bat`
seperti biasa — script otomatis mematikan total proses lama (dicatat lewat
`logs/dexaz-pids.json`) sebelum menyalakan yang baru, jadi tidak akan
bentrok/rebutan port. Kalau tetap muncul error "can't connect" atau
loading tanpa akhir, cek `logs/run-dexaz.log`, `logs/backend-error.log`,
dan `logs/frontend-error.log`.

**Manual, langkah demi langkah:**

**Backend:**

```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

**Frontend** (in a second terminal):

```powershell
cd frontend
npm install
npm run dev
```

Open **http://127.0.0.1:3000**, log in with `admin` / `admin123`
(change this in `.env` before real use), and your PostgreSQL
connection should already be listed under **Connections** — click
**Test** to confirm, then head to **Explorer**.

## Docker development

```bash
docker compose up -d
```

If your PostgreSQL runs natively on Windows (not in Docker), set the
connection host to `host.docker.internal` instead of `localhost` in
the Connections page, since `localhost` inside a container refers to
the container itself, not your PC. See the comment in
`docker-compose.yml`.

## Database connection

DEXAZ talks to PostgreSQL over the network (`psycopg2`), so any
reachable Postgres works — native Windows install, Docker container,
WSL, etc. Add/edit connections from the **Connections** page; nothing
about your database's tables or schema is hard-coded anywhere in the
app — it's all discovered through introspection each time you open
**Explorer** (or click the refresh icon to re-discover after schema
changes).

## Dokumen (PDF / PowerPoint viewer)

The **Dokumen** menu lets you upload `.pdf`, `.ppt`, and `.pptx` files
and view them right inside DEXAZ — zoom in/out, page/slide navigation,
and a fullscreen "present" mode (great for showing a deck without
opening PowerPoint). Everything is local-first:

- Uploaded files are stored on disk under `backend/data/documents/`
  (only metadata — filename, type, size — lives in the internal DB).
- PDFs render with `react-pdf` (pdf.js) and PowerPoint files render
  with `pptx-preview` — both run entirely in the browser, so no
  LibreOffice or other converter needs to be installed, and nothing
  is uploaded anywhere outside your own PC.
- Max upload size is 200 MB by default (`DBX_DOCUMENT_MAX_FILE_MB`
  in `.env`).

## SQL Editor / Library / Export

Not yet in the UI — these are Phase 3, 5, and 6 respectively. The
query execution backend (`POST /api/query/execute`) already works and
enforces confirmation for destructive statements, so the API is ready
whenever the editor UI is built on top of it.

## Security

- Your database password is encrypted (Fernet) before being stored in
  DEXAZ's internal SQLite DB, and is never sent back to the
  frontend.
- Backend binds to `127.0.0.1` by default — not reachable from your
  network unless you explicitly change `DBX_HOST`.
- Change `DBX_ADMIN_PASSWORD` in `.env` before relying on this for
  anything beyond local testing.

## Troubleshooting

- **"Could not connect to 127.0.0.1:5432"** — check PostgreSQL is
  running (`services.msc` on Windows) and the port/credentials in the
  Connections page are correct.
- **CORS errors in the browser console** — make sure
  `DBX_FRONTEND_ORIGIN` in `.env` matches the URL you're opening the
  frontend from.
- **"ENCRYPTION_KEY is not set"** — generate one with
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
  and put it in `.env`.

## Production build

```bash
cd frontend && npm run build && npm start
# backend, without --reload:
cd backend && uvicorn main:app --host 127.0.0.1 --port 8000
```
