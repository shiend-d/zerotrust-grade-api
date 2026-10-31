# Zero Trust Grade API

A local API for academic grade and transcript management based on a Zero Trust model. Every user request is evaluated by the API Gateway, then the downstream services verify the gateway secret and JWT again before processing it.

## System overview

- **API Gateway (PEP)** receives requests, validates tokens and devices, enforces access policies, and writes decisions to the audit log.
- **Policy Engine** in `policy.js` checks roles, class or transcript ownership, finalization status, and access hours.
- **Grade Service** handles grade retrieval, grade changes, and class finalization.
- **Transcript Service** handles transcript retrieval and synchronization.
- **SQLite** stores accounts, classes, grades, refresh tokens, transcripts, and audit logs in `kampus.db`.

Application requests are sent through the Gateway on port `3000`. The Grade Service and Transcript Service run on ports `3001` and `3002`; both reject direct access without a valid gateway secret and JWT.

## Requirements

- Node.js 24 or newer (uses built-in `node:sqlite` and `fetch`)
- npm
- `curl` and `jq` for the demo
- Nix is only required when using the provided development shell

## Run locally

```bash
npm install
npm start
```

All three servers will start together. Check the Gateway with:

```bash
curl -i http://localhost:3000/health
```

The database is created and seeded automatically. Press `Ctrl+C` to stop all servers.

### Run with Nix

The development shell provides Node.js 24, `curl`, and `jq` without changing the system NixOS configuration:

```bash
nix develop
npm install
npm start
```

## Demo

Run the demo from an interactive terminal:

```bash
npm run demo
```

The demo covers authentication and device verification, missing and invalid tokens, Gateway checks, grade policies, finalization and transcript synchronization, ownership restrictions, and audit logs. Each step prints the copyable `curl` command, endpoint, actual HTTP status, and response body. The command contains the complete token used by the request; response tokens are truncated only for readability. The audit output contains up to the 100 most recent entries. Press Enter to run the next step. The results are also saved to `demo-run.md` in the project folder.

To run every step without pausing:

```bash
npm run demo -- --auto
```

`demo.sh` requires the normal servers to be stopped first. It always starts all three services with `DEMO_MODE=1` and a temporary database, then removes the database and stops the services after the demo. The `X-Simulated-Hour` header is accepted only in this temporary demo mode; normal requests always use the server's real clock.

## Seed accounts and data

| Username | Password | Role | Student ID | Device ID |
| --- | --- | --- | --- | --- |
| `admin` | `admin123` | admin | — | `dev-admin-01` |
| `dosen1` | `dosen123` | lecturer | — | `dev-dosen-01` |
| `dosen2` | `dosen123` | lecturer | — | `dev-dosen-02` |
| `mhs1` | `mhs123` | student | `237006001` | `dev-mhs-01` |
| `mhs2` | `mhs123` | student | `237006002` | `dev-mhs-02` |
| `mhs3` | `mhs123` | student | `237006003` | `dev-mhs-03` |

Passwords in newly seeded databases are stored with a random salt using `scrypt`. Older SHA-256 seed hashes remain readable for compatibility. The initial data includes `KP70065004` Information Security, taught by dosen1, and `KP70065009` Network Security, taught by dosen2. An existing database is not reset when the servers restart.

All three student accounts are enrolled in both initial classes.

To start again with the initial data, stop the servers and delete the database plus any SQLite companion files:

```bash
rm -f kampus.db kampus.db-wal kampus.db-shm
npm start
```

## API

The following application endpoints are accessed through the API Gateway. Endpoints other than login require an access token and, for user requests, the `X-Device-ID` header.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Gateway health check |
| `POST /auth/login` | Sign in with a username, password, and `X-Device-ID` |
| `POST /auth/refresh` | Issue a new access token from a refresh token |
| `POST /auth/logout` | Revoke a refresh token |
| `POST /auth/service` | Issue a token for an internal service |
| `GET /nilai` | View grades according to role and ownership |
| `PUT /nilai/:id` | Update a grade by its lecturer before finalization |
| `POST /kelas/:id/finalisasi` | Finalize a class and trigger transcript synchronization |
| `GET /transkrip/:nim` | Students view their own transcript; admins may view transcripts |
| `POST /transkrip/sinkron` | Internal synchronization endpoint using a service token |
| `GET /audit-logs` | View audit logs; admin only |

Access tokens are valid for 10 minutes, refresh tokens for one day, and service tokens for 5 minutes. Grade updates and finalization are allowed from 07:00 until before 21:00. The demo uses the `X-Simulated-Hour` header to demonstrate the time policy without waiting for a specific time.

## Configuration

Configuration is read from environment variables when the processes start.

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_PORT` | `3000` | API Gateway port |
| `NILAI_PORT` | `3001` | Grade Service port |
| `TRANSKRIP_PORT` | `3002` | Transcript Service port |
| `DATABASE_PATH` | `kampus.db` in the project folder | SQLite database location |
| `JWT_SECRET` | demo value in `config.js` | Token signing key |
| `GATEWAY_SECRET` | demo value in `config.js` | Internal secret between the Gateway and services |
| `SERVICE_CLIENT_ID` | `service-nilai` | Internal service identity |
| `SERVICE_CLIENT_SECRET` | demo value in `config.js` | Credential for requesting a service token |
| `ACCESS_START_HOUR` | `7` | Start of the access window, 24-hour format |
| `ACCESS_END_HOUR` | `21` | End of the access window, exclusive |
| `DEMO_MODE` | `false` | Enables `X-Simulated-Hour` for the isolated demo process only |

> The default secrets and seed accounts are for local demonstration only. Set your own secrets before using this project in another environment.

## Main files

| File | Purpose |
| --- | --- |
| `gateway.js` | API Gateway, authentication, request forwarding, and audit logging |
| `policy.js` | Access policy evaluation |
| `service-nilai.js` | Grade and class finalization endpoints |
| `service-transkrip.js` | Transcript and internal synchronization endpoints |
| `db.js` | SQLite schema, seed data, password hashing, and audit logging |
| `start-all.js` | Starts and manages all three services |
| `demo.sh` | Runs the demo scenarios using `curl` |
| `flake.nix` | Nix development shell for Node.js and demo utilities |
