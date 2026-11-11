# Server deployment

Node 24 LTS is recommended (`node:sqlite`, minimum Node 22.16). No accounts or
cloud API keys are required. A stable writable SQLite database is required for
reconnect and undo history. Back up the SQLite database with a consistent backup
operation (or stop the service first); do not copy a live DB without its WAL.

```sh
docker compose up --build -d
docker compose exec server node -e "fetch('http://localhost:3001/health').then(async r=>{if(!r.ok)process.exit(1);console.log(await r.json())})"
```

Set `ALLOWED_ORIGINS` to a comma-separated list of exact browser/Desktop origins.
Defaults permit the local dev shell and Tauri origins. `PORT` defaults to 3001;
`DATABASE_PATH` defaults to `data/rooms.sqlite`. Docker Compose persists this in
its named volume. Use a single server process per SQLite database; horizontal
Socket.IO scaling is not implemented. Room events are serialized synchronously,
mutations and command receipts commit together in one SQLite transaction.

Put the public endpoint behind an HTTPS reverse proxy that supports WebSockets
and long polling. Forward `/socket.io/` and `/health`; set request/body limits and
external connection/admission limits appropriate to your deployment. The service
also rate-limits admissions, connections, clock probes and commands internally.
It uses actual peer addresses and does not trust arbitrary forwarded IP headers.
Password checks use salted scrypt; random capability/session tokens are stored
as SHA-256 hashes server-side. Public snapshots contain no credentials. Treat
the database, its directory and backups as private server data.

Build the Windows frontend with `VITE_SERVER_URL=https://your-host` and add that
specific HTTPS/WSS origin to Tauri's `app.security.csp.connect-src`. Development
CSP permits only local services by default. Do not weaken it to `*`. Clients must
use the same mechanics version as the server; bump the version whenever editing
mechanics values. Mismatched active-room mechanics versions are rejected rather
than silently converting ongoing battles. Restarting preserves active rooms and
idempotency receipts; offline clients receive a complete snapshot on resume.

Room codes are invitations, not passwords. Use an optional room password when
sharing a public deployment. Reconnect tokens belong in Windows Credential
Manager and must never be included in room links or Vite build variables. Browser
sessions hold tokens only in memory and support network reconnect within the same
page, not reload recovery. Installations do not share a Windows credential entry.

Current limits: at most six actual members, two primary assignments per P1 zone;
disconnected members retain their seat/session. Membership removal/host transfer
and automatic room expiry have not been specified by the PRD and are not invented
here. Plan operational database retention before a long-lived public deployment.

Behind the managed cloud TLS proxy, mount its CA only during dependency install:

```sh
docker build --secret id=proxy_ca,src=/etc/ssl/certs/ca-certificates.crt -t kaling-timer .
```

TLS verification remains enabled; the session CA is not copied into image layers.
