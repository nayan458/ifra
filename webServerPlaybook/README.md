# Web Server — Deployment Guide

The primary application stack for the Stone Inscription platform. This module deploys the full web-facing system: user frontend, admin frontend, Spring Boot backend API, nginx reverse proxy with SSL termination, n8n workflow automation, and a PostgreSQL database backing n8n.

This guide covers **manual deployment** on the target VM. The Ansible automation files are not distributed.

---

## What Gets Deployed

| Container | Image | Exposed Port | Purpose |
|---|---|---|---|
| `stoneinscription-frontend` | _(your image)_ | Internal only | User-facing React frontend |
| `stoneinscription-admin-frontend` | _(your image)_ | Internal only | Admin React frontend |
| `stoneinscription-backend` | _(your image)_ | `8081` (internal) | Spring Boot backend API |
| `stoneinscription-nginx` | _(your image)_ | `80`, `443` | Reverse proxy, SSL termination, routing |
| `n8n-workflow` | `docker.n8n.io/n8nio/n8n` | Internal only | n8n workflow automation |
| `postgress-n8n-workflow` | `postgres:15` | `127.0.0.1:5432` | PostgreSQL database for n8n |

> PostgreSQL is bound to `127.0.0.1:5432` only — it is not accessible from outside the host.

---

## Target VM

| Field | Value |
|---|---|
| Deployment directory | `/home/ssp/webServer` |
| SSH User | `ssp` |
| Password | _Provided separately to authorised personnel only_ |

```bash
ssh ssp@10.180.148.197
```

> Note: This module deploys to `/home/ssp/webServer`, not the `artifactRegistory` path used by the ML modules.

---

## Repository Layout After Cloning

When you pull the code from GitHub, your local working directory for this module will look like this:

```
webServer/
├── docker/
│   └── compose.yml
├── env/
│   ├── frontend.env
│   ├── backend.env
│   ├── admin.env
│   ├── n8n.env
│   └── postgres.env
├── nginx/
│   ├── main.conf
│   ├── server.conf
│   ├── certs/
│   │   ├── inscriptions.cdacb.in.crt     # SSL certificate — obtain separately
│   │   └── inscriptions.cdacb.in.key     # SSL private key — obtain separately
│   └── snippets/
│       ├── csp.conf
│       └── hide_server.conf
└── webServer.deployment.yml
```

The following will be created **on the VM**:

```
/home/ssp/webServer/
├── docker-compose.yml
├── env/
│   ├── frontend.env
│   ├── backend.env
│   ├── admin.env
│   ├── n8n.env
│   └── postgres.env
└── nginx/
    ├── main.conf
    ├── server.conf
    ├── certs/
    │   ├── inscriptions.cdacb.in.crt
    │   └── inscriptions.cdacb.in.key
    └── snippets/
        ├── csp.conf
        └── hide_server.conf
```

---

## Prerequisites

Before deploying, ensure the following are satisfied on the **target VM**.

### 1. Docker Engine with Compose v2

```bash
docker --version
docker compose version
```

Must use `docker compose` (v2 plugin), not the legacy `docker-compose` binary.

### 2. User in the `docker` Group

The deployment user (`ssp`) must be in the `docker` group to run Docker commands without `sudo`:

```bash
sudo usermod -aG docker ssp
newgrp docker
```

Verify:

```bash
groups | grep docker
```

### 3. Docker Hub Access

The application images are hosted on Docker Hub and require authentication. Have your Docker Hub credentials ready (see Step 3).

### 4. SSL Certificate and Key

The nginx container requires a valid SSL certificate for `inscriptions.cdacb.in`. These files are **not included in the GitHub repository** and must be obtained separately from your certificate authority:

- `nginx/certs/inscriptions.cdacb.in.crt` — the full certificate chain
- `nginx/certs/inscriptions.cdacb.in.key` — the private key

Place them in the `nginx/certs/` directory locally before transferring files to the VM. Do not commit these files to version control.

---

## Step 1 — Create the Project Directory on the VM

SSH into the server:

```bash
ssh ssp@10.180.148.197
```

Create the project directory:

```bash
mkdir -p /home/ssp/webServer
```

---

## Step 2 — Add `/etc/hosts` Entries on the VM

The backend container resolves MongoDB, Kafka, MinIO, and the ML service hostnames via `/etc/hosts` entries on the **host VM**. These must be added before starting the stack.

```bash
sudo tee -a /etc/hosts <<'EOF'
10.180.22.114  mongodb-primary
10.180.22.115  mongodb-secondary
10.180.22.116  mongodb-arbiter
10.182.0.210   geo
10.180.93.12   classification_model
10.180.93.12   suggestion_model
10.180.93.12   content-moderation
10.180.22.116  minio
EOF
```

Verify the entries were added:

```bash
grep -E 'mongodb|geo|classification|suggestion|content-moderation|minio' /etc/hosts
```

Expected output:

```
10.180.22.114  mongodb-primary
10.180.22.115  mongodb-secondary
10.180.22.116  mongodb-arbiter
10.182.0.210   geo
10.180.93.12   classification_model
10.180.93.12   suggestion_model
10.180.93.12   content-moderation
10.180.22.116  minio
```

> **Why this is needed:** The `backend` container inherits these host entries via `extra_hosts` in `compose.yml`, which passes them into the container's `/etc/hosts`. The nginx container also needs `classification_model` resolved to reach the Classification Model service on the GPU VM. Without these entries, the backend will fail to connect to MongoDB at startup and the `/detect/` proxy will not resolve.

---

## Step 3 — Docker Hub Login on the VM

The application images are private. Log in to Docker Hub on the VM before pulling:

```bash
docker login
```

Enter your Docker Hub username and password when prompted. Credentials are cached in `~/.docker/config.json` for subsequent pulls.

---

## Step 4 — Create the External Docker Volumes

The compose file references **three external Docker volumes** that must exist before the stack starts. These are not created automatically — if they are missing, `docker compose up` will fail with a volume-not-found error.

```bash
docker volume create ansible_pgdata_n8n
docker volume create ansible_n8n
docker volume create ansible_workflow_n8n
```

Verify they exist:

```bash
docker volume ls | grep ansible_
```

Expected output:

```
local     ansible_n8n
local     ansible_pgdata_n8n
local     ansible_workflow_n8n
```

> **Important:** The volume names must match exactly — including the `ansible_` prefix. These names are hardcoded in the compose file under the `volumes:` block. Do not rename them.

| Volume | Mount point in container | Purpose |
|---|---|---|
| `ansible_pgdata_n8n` | `/var/lib/postgresql/data` | PostgreSQL data for n8n |
| `ansible_n8n` | `/home/node/.n8n` | n8n configuration and credentials |
| `ansible_workflow_n8n` | `/home/node/workflows` | n8n workflow definitions |

> **Data persistence note:** Unlike bind mounts, these named volumes persist across `docker compose down` and `docker compose down -v` is destructive — it will delete the volume data. Use `docker compose down` (without `-v`) for routine restarts.

---

## Step 5 — Configure the Environment Files

Review and update all `.env` files **locally** before transferring. Several contain credentials that must be replaced for your deployment.

---

### `env/frontend.env`

```env
VITE_BACKEND_API_URL=https://inscriptions.cdacb.in/api/
VITE_BACKEND_BASE_URL=https://inscriptions.cdacb.in/
VITE_BACKEND_AI_URL=https://inscriptions.cdacb.in/detect/
VITE_REDIRECT_URL=https://inscriptions.cdacb.in/api/oauth2/authorization/google
VITE_N8N_WEBHOOK_URL=https://inscriptions.cdacb.in/n8n/webhook/e805f283-b2c4-42c9-8207-c9b84095723b
```

| Variable | Purpose |
|---|---|
| `VITE_BACKEND_API_URL` | Base URL for all backend API calls from the frontend |
| `VITE_BACKEND_BASE_URL` | Root URL of the platform |
| `VITE_BACKEND_AI_URL` | URL for the inscription detection (classification) service |
| `VITE_REDIRECT_URL` | Google OAuth2 redirect URI for user login |
| `VITE_N8N_WEBHOOK_URL` | n8n webhook endpoint called from the frontend |

If deploying to a different domain, replace all occurrences of `inscriptions.cdacb.in` with your domain.

---

### `env/admin.env`

```env
VITE_BACKEND_API_URL=https://inscriptions.cdacb.in/api/
VITE_BACKEND_BASE_URL=https://inscriptions.cdacb.in/
VITE_BACKEND_AI_URL=https://inscriptions.cdacb.in/detect/
VITE_REDIRECT_URL=https://inscriptions.cdacb.in/api/oauth2/admin/authorization/google
```

Same pattern as `frontend.env` but with admin-specific OAuth redirect (`/oauth2/admin/`). If deploying to a different domain, update all URLs.

---

### `env/backend.env`

This file contains the most sensitive credentials. **Do not deploy with default values.**

```env
GOOGLE_CLIENT_ID=<your-google-oauth-client-id>
GOOGLE_CLIENT_SECRET=<your-google-oauth-client-secret>

SPRING_DATA_MONGODB_URI=mongodb://root:<password>@mongodb-primary:27017,mongodb-secondary:27017/StoneInscription?replicaSet=rs0&authSource=admin&retryWrites=true&serverSelectionTimeoutMS=5000&connectTimeoutMS=10000
MONGO_URI=mongodb://root:<password>@mongodb-primary:27017,mongodb-secondary:27017/StoneInscription?replicaSet=rs0&authSource=admin&retryWrites=true&serverSelectionTimeoutMS=5000&connectTimeoutMS=10000

REDIRECT_URL=https://<your-domain>/api/login/oauth2/code

CONTENT_MODERATION_WEBHOOK_URL=https://<your-domain>/n8n/webhook/content-moderation
CONTENT_MODERATION_SAFE_THRESHOLD=0.6
CONTENT_MODERATION_CONNECT_TIMEOUT_MS=10000
CONTENT_MODERATION_READ_TIMEOUT_MS=100000
CONTENT_MODERATION_INSECURE_SSL=true

APP_CORS_URL=https://<your-domain>
APP_BACKEND_URL=https://<your-domain>/api/
APP_FRONTEND_OAUTH_CALLBACK_URL=https://<your-domain>/oauth/callback
APP_FRONTEND_ADMIN_APPROVAL_RESULT_URL=https://<your-domain>/admin/approval-result
APP_FRONTEND_OAUTH_ADMIN_CALLBACK_URL=https://<your-domain>/admin/oauth/callback
APP_COOKIE_DOMAIN=<your-domain>

ADMIN_APPROVAL_INTERNAL_EMAIL=<admin-email>
spring.mail.host=smtp.gmail.com
spring.mail.port=587
spring.mail.username=<gmail-address>
spring.mail.password=<gmail-app-password>
spring.mail.properties.mail.smtp.auth=true
spring.mail.properties.mail.smtp.starttls.enable=true

KAFKA_BOOTSTRAP_SERVERS=kafka:29092
MINIO_ENDPOINT=minio:9000
MINIO_BUCKET=inscription-analyser
MINIO_ACCESS_KEY=<your-minio-access-key>
MINIO_SECRET_KEY=<your-minio-secret-key>
```

Key variables to update before deployment:

| Variable | What to set |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | From the Google Cloud Console OAuth2 credentials for your project |
| `SPRING_DATA_MONGODB_URI` / `MONGO_URI` | Update the password to match your MongoDB replica set's root password |
| `REDIRECT_URL` | Must match the authorised redirect URI registered in Google Cloud Console |
| `APP_CORS_URL` and all `APP_*` URLs | Replace `inscriptions.cdacb.in` with your domain |
| `APP_COOKIE_DOMAIN` | Your domain without protocol (e.g. `inscriptions.cdacb.in`) |
| `ADMIN_APPROVAL_INTERNAL_EMAIL` | Email address that receives admin approval notifications |
| `spring.mail.username` / `spring.mail.password` | A Gmail address and its [App Password](https://support.google.com/accounts/answer/185833) (not the account password) |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` | Credentials for your MinIO instance |
| `CONTENT_MODERATION_INSECURE_SSL` | Set to `false` in production if the content moderation service has a valid certificate |

> **MongoDB URI note:** Both `SPRING_DATA_MONGODB_URI` and `MONGO_URI` must point to the same replica set. Both variables are present for compatibility — keep them in sync.

---

### `env/postgres.env`

```env
POSTGRES_PASSWORD=mysecretpassword
POSTGRES_USER=postgres
POSTGRES_DB=n8n_db
```

| Variable | Purpose |
|---|---|
| `POSTGRES_PASSWORD` | Password for the PostgreSQL `postgres` user. **Change from the default before deploying.** |
| `POSTGRES_USER` | Database superuser (keep as `postgres` unless you update `n8n.env` to match) |
| `POSTGRES_DB` | Database name for n8n (must match `DB_POSTGRESDB_DATABASE` in `n8n.env`) |

---

### `env/n8n.env`

```env
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgress-n8n-workflow
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n_db
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=mysecretpassword

N8N_PATH=/n8n/
N8N_HOST=inscriptions.cdacb.in
N8N_PORT=5678
N8N_PROTOCOL=https
N8N_EDITOR_BASE_URL=https://inscriptions.cdacb.in/n8n/
WEBHOOK_URL=https://inscriptions.cdacb.in/n8n/
N8N_PROXY_HOPS=1
N8N_DIAGNOSTICS_ENABLED=false
N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
N8N_RUNNERS_ENABLED=true
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
N8N_GIT_NODE_DISABLE_BARE_REPOS=true
```

| Variable | What to update |
|---|---|
| `DB_POSTGRESDB_PASSWORD` | Must match `POSTGRES_PASSWORD` in `postgres.env` |
| `N8N_HOST` | Replace with your domain |
| `N8N_EDITOR_BASE_URL` | Replace `inscriptions.cdacb.in` with your domain |
| `WEBHOOK_URL` | Replace `inscriptions.cdacb.in` with your domain |

> `DB_POSTGRESDB_HOST` is set to `postgress-n8n-workflow`, which is the container name of the postgres service. Do not change this — it resolves via Docker's internal DNS.

---

## Step 6 — Prepare the nginx Configuration

The nginx container mounts four paths from the host:

| Host path (relative to project dir) | Container path | Purpose |
|---|---|---|
| `nginx/main.conf` | `/etc/nginx/nginx.conf` | Global nginx configuration, module loading, gzip, rate limits, CSP map |
| `nginx/server.conf` | `/etc/nginx/conf.d/default.conf` | Virtual host: HTTP→HTTPS redirect, SSL, all location blocks |
| `nginx/certs/` | `/etc/nginx/certs/` | SSL certificate and private key |
| `nginx/snippets/` | `/etc/nginx/snippets/` | CSP policy map (`csp.conf`), server header suppression (`hide_server.conf`) |

> **CSP dependency:** `main.conf` includes `snippets/csp.conf` globally, which defines the `$csp_full` variable used in `server.conf`. If `snippets/csp.conf` is missing or the include fails, nginx will not start. Both files must be transferred together.

### SSL certificates

Place your certificate files locally before the transfer step:

```
nginx/certs/inscriptions.cdacb.in.crt    ← full chain certificate
nginx/certs/inscriptions.cdacb.in.key    ← private key
```

The certificate must match the domain in `server.conf`'s `server_name` directive. If you are deploying to a different domain, update:

- Both filenames in `nginx/certs/`
- `ssl_certificate` and `ssl_certificate_key` paths in `server.conf`
- All `server_name` and `proxy_pass` directives referencing `inscriptions.cdacb.in`

---

## Step 7 — Transfer All Files to the VM

From your **local machine**, transfer the compose file, all env files, and the entire nginx directory:

```bash
# Rename compose.yml to docker-compose.yml on the server
scp docker/compose.yml ssp@10.180.148.197:/home/ssp/webServer/docker-compose.yml

# Transfer the entire env directory
scp -r env/ ssp@10.180.148.197:/home/ssp/webServer/env/

# Transfer the entire nginx directory (includes certs, snippets, configs)
scp -r nginx/ ssp@10.180.148.197:/home/ssp/webServer/nginx/
```

Alternatively, if you prefer `rsync` (safer for large transfers, preserves permissions):

```bash
rsync -avz docker/compose.yml ssp@10.180.148.197:/home/ssp/webServer/docker-compose.yml
rsync -avz env/ ssp@10.180.148.197:/home/ssp/webServer/env/
rsync -avz nginx/ ssp@10.180.148.197:/home/ssp/webServer/nginx/
```

### Verify the directory structure on the VM

```bash
ssh ssp@10.180.148.197 find /home/ssp/webServer -type f
```

Expected output:

```
/home/ssp/webServer/docker-compose.yml
/home/ssp/webServer/env/frontend.env
/home/ssp/webServer/env/backend.env
/home/ssp/webServer/env/admin.env
/home/ssp/webServer/env/n8n.env
/home/ssp/webServer/env/postgres.env
/home/ssp/webServer/nginx/main.conf
/home/ssp/webServer/nginx/server.conf
/home/ssp/webServer/nginx/certs/inscriptions.cdacb.in.crt
/home/ssp/webServer/nginx/certs/inscriptions.cdacb.in.key
/home/ssp/webServer/nginx/snippets/csp.conf
/home/ssp/webServer/nginx/snippets/hide_server.conf
```

Do not proceed until all files are present.

---

## Step 8 — Pull the Latest Images

SSH into the VM and pull all images before starting the stack:

```bash
ssh ssp@10.180.148.197

cd /home/ssp/webServer

docker compose pull
```

This pulls the latest version of every image declared in `compose.yml`. Pulling before starting ensures you have the newest images and separates the download step from the startup step — useful for debugging if a pull fails.

---

## Step 9 — Start the Stack

```bash
cd /home/ssp/webServer

docker compose up -d --force-recreate --remove-orphans
```

`--force-recreate` ensures all containers are recreated from the freshly pulled images, even if the compose configuration has not changed. `--remove-orphans` cleans up any containers from previous runs that are no longer defined in the compose file.

Confirm all containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                            IMAGE                              STATUS    PORTS
stoneinscription-frontend       <your-frontend-image>              Up        
stoneinscription-admin-frontend <your-admin-image>                 Up        
stoneinscription-backend        <your-backend-image>               Up        0.0.0.0:8081->8081/tcp
stoneinscription-nginx          <your-nginx-image>                 Up        0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
n8n-workflow                    docker.n8n.io/n8nio/n8n            Up        
postgress-n8n-workflow          postgres:15                        Up        127.0.0.1:5432->5432/tcp
```

---

## Verifying the Deployment

### HTTPS frontend

```bash
curl -I https://inscriptions.cdacb.in/
```

Expected: `HTTP/2 200`

### Backend API health

```bash
curl -I https://inscriptions.cdacb.in/api/
```

### Admin frontend

```bash
curl -I https://inscriptions.cdacb.in/admin/
```

### n8n editor

```bash
curl -I https://inscriptions.cdacb.in/n8n/
```

Expected: `HTTP/2 200` with the n8n UI login page.

### nginx config syntax check (on the VM)

Before starting or after any nginx config change, validate the config from inside the container:

```bash
docker exec stoneinscription-nginx nginx -t
```

Expected:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### Container logs

```bash
# All containers
docker compose logs -f

# Individual containers
docker compose logs -f stoneinscription-backend
docker compose logs -f stoneinscription-nginx
docker compose logs -f n8n-workflow
docker compose logs -f postgress-n8n-workflow
```

---

## Network Architecture

The stack uses three Docker bridge networks with deliberate service placement:

| Network | Purpose | Connected Services |
|---|---|---|
| `frontend-network` | Frontend ↔ Backend communication | nginx, frontend, backend, admin |
| `backend-network` | Backend internal communication | nginx, frontend, backend, admin |
| `n8n-network` | n8n ↔ PostgreSQL isolation | nginx, n8n, postgres |

nginx sits on all three networks — it is the only entry point from outside and routes traffic to the appropriate service internally. The `n8n-network` is kept separate so n8n and its database are not directly reachable from the frontend or backend containers.

---

## nginx Routing Reference

| Path | Proxied to | Notes |
|---|---|---|
| `/` | `frontend:3000` | User frontend; static assets cached 1 year |
| `/admin/` | `admin:3000` | Admin frontend; `/admin/` prefix stripped before proxying |
| `/api/` | `backend:8080` | Spring Boot API; cookies and CSRF headers forwarded |
| `/detect/` | `classification_model:8001` | GPU classification service on `10.180.93.12`; 300s timeout |
| `/n8n/` | `n8n:5678` | n8n editor and webhook UI; WebSocket upgraded |
| `/n8n/rest/push` | `n8n:5678/rest/push` | n8n real-time push; WebSocket upgraded separately |
| `/metrics` | `backend:8080/metrics` | Prometheus metrics endpoint |
| `/api/swagger-ui`, `/api/v3/api-docs`, `/api/actuator` | `backend:8080` | **LAN-restricted**: only accessible from `127.0.0.1`, `::1`, `10.180.0.0/22` |

HTTP on port 80 redirects unconditionally to HTTPS on port 443.

---

## Redeployment (Updating Images)

When new images are pushed to Docker Hub and you need to redeploy:

```bash
cd /home/ssp/webServer

# Pull the latest images
docker compose pull

# Recreate all containers from new images
docker compose up -d --force-recreate --remove-orphans
```

This matches what the Ansible playbook does (`pull: always`, `recreate: always`).

---

## Stopping the Stack

```bash
cd /home/ssp/webServer

# Stop containers, preserve named volumes and networks
docker compose down

# Stop containers and remove named volumes — WARNING: deletes n8n data and PostgreSQL data
docker compose down -v

# Stop and remove orphaned containers only
docker compose down --remove-orphans
```

> **Do not use `docker compose down -v` unless you intend to wipe all n8n workflow data and PostgreSQL data.** The three `ansible_` volumes contain n8n credentials, workflow definitions, and the PostgreSQL database. These are not recoverable from Docker alone once deleted.

---

## Updating nginx Configuration

If you modify `nginx/main.conf`, `nginx/server.conf`, `server.conf`, `nginx/snippets/csp.conf`, or the SSL certificates:

1. Transfer the updated file(s) to the VM:

```bash
scp nginx/server.conf ssp@10.180.148.197:/home/ssp/webServer/nginx/server.conf
```

2. Test the configuration:

```bash
docker exec stoneinscription-nginx nginx -t
```

3. If the test passes, reload nginx without downtime:

```bash
docker exec stoneinscription-nginx nginx -s reload
```

If the test fails, fix the configuration before reloading. A failed reload will leave the existing configuration running.

---

## Troubleshooting

### nginx fails to start — certificate not found

```bash
docker compose logs stoneinscription-nginx | grep -i 'certificate\|ssl\|cannot\|error'
```

Confirm the certificate files exist on the VM at the correct paths:

```bash
ls -la /home/ssp/webServer/nginx/certs/
```

Both `.crt` and `.key` files must be present. The filenames must match exactly what is in `server.conf`'s `ssl_certificate` and `ssl_certificate_key` directives.

### nginx fails to start — `$csp_full` undefined

```bash
docker compose logs stoneinscription-nginx
```

If you see errors about undefined variable `$csp_full`, the `snippets/csp.conf` file was not transferred or is in the wrong path. Verify:

```bash
ls /home/ssp/webServer/nginx/snippets/
```

Both `csp.conf` and `hide_server.conf` must be present.

### Backend fails to connect to MongoDB at startup

```bash
docker compose logs stoneinscription-backend | grep -iE 'mongo|connection|timeout'
```

Check that the `/etc/hosts` entries exist on the VM:

```bash
grep mongodb /etc/hosts
```

If missing, re-run the `tee` command from Step 2. After adding entries, restart the backend container:

```bash
docker compose restart stoneinscription-backend
```

### n8n fails to start — database connection refused

```bash
docker compose logs n8n-workflow | grep -iE 'error|postgres|connection'
```

Ensure the postgres container is healthy first:

```bash
docker compose ps postgress-n8n-workflow
```

If postgres is not running:

```bash
docker compose logs postgress-n8n-workflow
```

Common cause: `DB_POSTGRESDB_PASSWORD` in `n8n.env` does not match `POSTGRES_PASSWORD` in `postgres.env`.

### External volumes not found on compose up

```bash
docker compose up -d
# Error: volume "ansible_pgdata_n8n" declared as external, but could not be found
```

Create the missing volumes:

```bash
docker volume create ansible_pgdata_n8n
docker volume create ansible_n8n
docker volume create ansible_workflow_n8n
```

Then retry `docker compose up -d`.

### Port 80 or 443 already in use

```bash
ss -tlnp | grep -E ':80|:443'
```

Another process (likely a pre-existing nginx or Apache) is holding the port. Stop it:

```bash
sudo systemctl stop nginx        # if host nginx is running
sudo systemctl disable nginx     # prevent it from restarting on boot
```

Then retry `docker compose up -d`.

### 502 Bad Gateway on `/api/` routes

The backend container is not running or is still starting up:

```bash
docker compose ps stoneinscription-backend
docker compose logs stoneinscription-backend | tail -50
```

Spring Boot typically takes 30–60 seconds to start. Wait for the application context initialisation log line before retrying.

### 502 Bad Gateway on `/detect/` routes

The Classification Model service on the GPU VM (`10.180.93.12:8001`) is not reachable from the web server. Verify:

```bash
curl -f http://10.180.93.12:8001/
```

If this fails, the classification model service is down. Refer to the Classification Model deployment guide to bring it back up.

### Google OAuth login fails

Confirm that the `REDIRECT_URL` in `backend.env` exactly matches the **Authorised redirect URI** registered in your Google Cloud Console OAuth2 client. A mismatch will result in a `redirect_uri_mismatch` error from Google.

### n8n webhooks return 404

n8n resolves its own webhook URLs using `WEBHOOK_URL` in `n8n.env`. If this does not match your domain, incoming webhook calls will fail. Verify:

```bash
grep WEBHOOK_URL /home/ssp/webServer/env/n8n.env
```

It should be `https://<your-domain>/n8n/`.

### Image pull fails — unauthorized

```bash
docker login
```

Re-authenticate and retry:

```bash
docker compose pull
```

### Permission denied running docker commands

The `ssp` user is not in the `docker` group or the group membership was not picked up in the current session:

```bash
sudo usermod -aG docker ssp
newgrp docker
```

Then retry the docker command.