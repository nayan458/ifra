# Monitoring — Deployment Guide

Observability stack for the Stone Inscription platform. Deploys Prometheus for metrics collection, Alertmanager for alert routing and email notification, Grafana for dashboards, Node Exporter for host metrics, cAdvisor for container metrics, and Blackbox Exporter for endpoint probing.

This is the **cross-platform monitoring module** — it scrapes metrics from every other module in the system. Deploying this module requires that the other services are already running and reachable at their respective IPs.

This guide covers **manual deployment** on the target VM. The Ansible automation files are not distributed.

---

## What Gets Deployed

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `stoneinscription-prometheus` | `prom/prometheus:latest` | `9090` | Metrics collection and alerting engine |
| `stoneinscription-alertmanager` | `prom/alertmanager:latest` | `9093` | Alert routing and email notification |
| `stoneinscription-node-exporter` | `prom/node-exporter:latest` | `9100` | Host-level system metrics (CPU, memory, disk, network) |
| `stoneinscription-cadvisor` | `gcr.io/cadvisor/cadvisor:latest` | `8082` | Per-container resource metrics |
| `stoneinscription-grafana` | `grafana/grafana:latest` | `3000` | Metrics dashboards and visualisation |
| `blackbox_exporter` | `prom/blackbox-exporter:latest` | `9115` | HTTP/TCP endpoint probing (used for geo service health) |

All containers share a single `monitoring_network` bridge network.

---

## Target VM

| Field | Value |
|---|---|
| Deployment directory | `/home/ssp/monitoring` |
| SSH User | `ssp` |
| Password | _Provided separately to authorised personnel only_ |

```bash
ssh ssp@<monitoring-vm-ip>
```

---

## Repository Layout After Cloning

When you pull the code from GitHub, your local working directory for this module will look like this:

```
monitoring/
├── docker/
│   └── compose.yml
├── AlertManager/
│   └── alert.yml          # Extended alert rules (not used by default — see Alert Rules section)
├── prometheus.yml          # Prometheus scrape configuration
├── alert.yml               # Active alert rules (this is what Prometheus loads)
└── alertManager.yml        # Alertmanager routing and email configuration
```

The following will be created **on the VM**:

```
/home/ssp/monitoring/
├── docker-compose.yml
├── prometheus.yml
├── alert.yml
└── alertManager.yml
```

---

## Prerequisites

### 1. Docker Engine with Compose v2

```bash
docker --version
docker compose version
```

### 2. User in the `docker` Group

```bash
sudo usermod -aG docker ssp
newgrp docker
```

Verify:

```bash
groups | grep docker
```

### 3. Other Platform Services Running

Prometheus scrapes metrics from all other modules. While the monitoring stack itself will start regardless, scrape targets will show as `DOWN` in Prometheus until the respective services are running. Recommended deployment order:

1. MongoDB (external — not covered here)
2. Kafka module
3. Classification Model module
4. Content Moderation module
5. Suggestion Model module
6. Web Server module
7. **Monitoring module (this one)**

---

## Understanding the Configuration Files

Before deploying, it is important to understand what each configuration file does and what you need to update in it.

---

### `prometheus.yml` — Scrape Configuration

This file tells Prometheus **what to scrape, how often, and where**.

```yaml
global:
  scrape_interval: 5s       # Scrape all targets every 5 seconds
```

**Rule and alerting wiring:**

```yaml
rule_files:
  - alert.yml               # Loads alert rules from this file

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093   # Sends fired alerts to Alertmanager
```

**Scrape targets** — Prometheus collects metrics from the following endpoints:

| Job name | Target | Metrics path | What it monitors |
|---|---|---|---|
| `prometheus` | `prometheus:9090` | `/metrics` | Prometheus itself |
| `node` | `node_exporter:9100` | `/metrics` | Host system metrics (CPU, RAM, disk, network) |
| `cadvisor` | `cadvisor:8080` | `/metrics` | Per-container Docker resource usage |
| `geo` | `http://geo:8080/search?q=Delhi&format=json` | `/probe` via blackbox | HTTP probe of the Nominatim geocoding service |
| `suggestion AI model` | `suggestion_model:8080` | `/metrics` | vLLM metrics from Suggestion Model |
| `content moderation AI model` | `content_moderation:8081` | `/metrics` | vLLM metrics from Content Moderation |
| `mongodb` | `mongodb-primary:9216`, `mongodb-secondary:9216`, `mongodb-arbiter:9216` | `/metrics` | MongoDB replica set metrics via MongoDB Exporter |
| `spring-backend` | `stoneinscription-backend:8081` | `/actuator/prometheus` | Spring Boot application metrics |
| `Classification-model` | `classification_model:8001` | `/metrics` | Classification inference service metrics |

> **Note on the `geo` job:** This target uses the Blackbox Exporter as a proxy. Prometheus sends the geo URL to `blackbox_exporter:9115`, which performs the actual HTTP probe and reports success/failure back to Prometheus. The `relabel_configs` block rewrites the target address to the blackbox exporter before scraping.

> **Note on the AMD GPU exporter:** The `amd-gpu` job targeting `rocm_exporter:9101` is present in the config but **commented out**. The ROCm device metrics exporter is deployed as part of the Classification Model module (on port 9835 externally, 9101 internally). To enable GPU metrics scraping, uncomment that block and ensure `rocm_exporter` resolves correctly.

**What to update for your deployment:**

If any service is running on a different IP or port than the platform defaults, update the corresponding `targets:` entry in `prometheus.yml`. All hostnames resolve via `extra_hosts` in the compose file — do not use raw IPs in `prometheus.yml`; use the hostnames defined in the `extra_hosts` section of `compose.yml` and the `/etc/hosts` entries added in the deployment steps.

---

### `alert.yml` — Active Alert Rules

> There are **two** alert rule files in the repository. Only `./alert.yml` (at the root, not inside `AlertManager/`) is active — it is the file copied to the VM and referenced by `prometheus.yml`.

**`./alert.yml` (active — deployed to VM):**

```yaml
groups:
  - name: service-alerts
    rules:
      - alert: ServiceDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Service is down"
          description: "Instance {{ $labels.instance }} is down"
```

This is a single broad rule: if **any** scraped target reports `up == 0` for 1 minute continuously, a `ServiceDown` alert fires. It covers every job in `prometheus.yml` with one rule.

**`./AlertManager/alert.yml` (extended version — not deployed by default):**

This file contains five more granular rules with shorter evaluation intervals (30s):

| Alert | Expression | Fires when |
|---|---|---|
| `ServiceDown` | `up == 0` for 30s | Any target down for 30 seconds |
| `ServiceRecovered` | `up == 1 and increase(up[5m]) > 0` for 10s | A target that was down has recovered |
| `PrometheusDown` | `up{job="prometheus"} == 0` for 30s | Prometheus itself is unreachable |
| `AlertManagerDown` | `up{job="alertmanager"} == 0` for 30s | Alertmanager is unreachable |
| `NodeExporterDown` | `up{job="node"} == 0` for 30s | Node Exporter is unreachable |

To use the extended ruleset instead of the simple one, replace `./alert.yml` with the contents of `./AlertManager/alert.yml` before deploying, or copy it over on the VM after deployment and reload Prometheus:

```bash
# On the VM, after deployment
cp AlertManager/alert.yml /home/ssp/monitoring/alert.yml   # if you transferred AlertManager/ too
docker exec stoneinscription-prometheus kill -HUP 1        # reload Prometheus config without restart
```

---

### `alertManager.yml` — Alert Routing and Email Notification

This file configures **how Alertmanager handles fired alerts** — specifically, where to send them.

**Global SMTP settings:**

```yaml
global:
  resolve_timeout: 5m
  smtp_smarthost: "smtp.gmail.com:587"
  smtp_auth_username: "<your-gmail-address>"
  smtp_auth_password: "<your-gmail-app-password>"
  smtp_require_tls: true
  smtp_from: "<your-gmail-address>"
```

**Routing:**

```yaml
route:
  receiver: "default"
  repeat_interval: 24h      # Do not re-send the same alert more often than once per 24 hours
```

All alerts go to the `default` receiver. There is no sub-routing by severity or job — every fired alert goes to every email recipient.

**Receivers — current email recipients:**

The `default` receiver sends HTML-formatted alert emails to multiple addresses. The current config sends to two addresses. You must update these before deploying:

```yaml
receivers:
  - name: "default"
    email_configs:
      - to: "<recipient-1@example.com>"
        from: "<your-gmail-address>"
        headers:
          Subject: "Alert: {{ .GroupLabels.alertname }}"
        html: |
          ... (HTML template) ...
      - to: "<recipient-2@example.com>"
        ...
```

The HTML email body includes: number of firing alerts, number of resolved alerts, and for each alert: name, severity, summary, and description.

**To add more recipients**, copy an `email_configs` block and change the `to:` field.

**What to update before deploying:**

| Field | What to set |
|---|---|
| `smtp_auth_username` | Your Gmail address used as the sending account |
| `smtp_auth_password` | A Gmail [App Password](https://support.google.com/accounts/answer/185833) — not your account password. 2FA must be enabled on the Gmail account |
| `smtp_from` | Same as `smtp_auth_username` |
| All `to:` fields | Email addresses of alert recipients |
| `repeat_interval` | How often to re-send an unresolved alert. Default `24h` — lower to `1h` for more aggressive alerting |

---

## Step 1 — Create the Project Directory on the VM

SSH into the server:

```bash
ssh ssp@<monitoring-vm-ip>
```

Create the project directory:

```bash
mkdir -p /home/ssp/monitoring
```

---

## Step 2 — Add `/etc/hosts` Entries on the VM

Prometheus resolves all scrape target hostnames through `/etc/hosts` on the **host VM**. These must be added before starting the stack (they are passed into the Prometheus container via `extra_hosts` in `compose.yml`).

```bash
sudo tee -a /etc/hosts <<'EOF'
10.180.93.12   suggestion_model
10.180.93.12   classification_model
10.180.93.12   content_moderation
10.180.93.12   rocm_exporter
10.182.0.210   geo
10.180.22.114  mongodb-primary
10.180.22.115  mongodb-secondary
10.180.22.116  mongodb-arbiter
10.180.148.197 stoneinscription-backend
EOF
```

Verify:

```bash
grep -E 'suggestion|classification|content|rocm|geo|mongodb|stoneinscription-backend' /etc/hosts
```

**If you are deploying to a different environment**, replace each IP with the actual IP of the corresponding service in your infrastructure. These must match the IPs where each module's metrics endpoint is actually running.

---

## Step 3 — Update Configuration Files

Before transferring, update the following files locally:

### `alertManager.yml`

Replace the SMTP credentials and recipient email addresses (see the `alertManager.yml` section above). Do not deploy with the default credentials.

### `prometheus.yml`

If any services are running on non-default IPs, update the corresponding `extra_hosts` entries in `compose.yml` and ensure the hostnames in `prometheus.yml` match. The hostnames in `prometheus.yml` must match what is defined in `extra_hosts`.

### `alert.yml`

If you prefer the more granular extended rules, replace the contents with `AlertManager/alert.yml`. Otherwise leave as-is.

---

## Step 4 — Transfer Files to the VM

From your **local machine**:

```bash
# Rename compose.yml on the server
scp docker/compose.yml ssp@<monitoring-vm-ip>:/home/ssp/monitoring/docker-compose.yml

# Transfer all config files
scp prometheus.yml   ssp@<monitoring-vm-ip>:/home/ssp/monitoring/prometheus.yml
scp alert.yml        ssp@<monitoring-vm-ip>:/home/ssp/monitoring/alert.yml
scp alertManager.yml ssp@<monitoring-vm-ip>:/home/ssp/monitoring/alertManager.yml
```

Verify:

```bash
ssh ssp@<monitoring-vm-ip> find /home/ssp/monitoring -type f
```

Expected output:

```
/home/ssp/monitoring/docker-compose.yml
/home/ssp/monitoring/prometheus.yml
/home/ssp/monitoring/alert.yml
/home/ssp/monitoring/alertManager.yml
```

---

## Step 5 — Tear Down Any Existing Stack

> **Important:** Unlike most other modules, the Ansible playbook for this module performs a **full teardown with volume removal** before redeployment (`state: absent`, `remove_volumes: true`). Replicate this behaviour on redeployment to ensure a clean state:

```bash
cd /home/ssp/monitoring

docker compose down -v --remove-orphans
```

This removes all containers, the `monitoring_network`, and the `grafana_data` and `prometheus_data` volumes. Skip this step on **first-time deployment** where nothing exists yet.

> **Grafana data warning:** `docker compose down -v` deletes the `grafana_data` volume, which contains any dashboards, data sources, and users you have configured in Grafana. Before redeploying, export your dashboards from the Grafana UI (Dashboard → Share → Export) if you want to preserve them.

---

## Step 6 — Start the Stack

```bash
cd /home/ssp/monitoring

docker compose up -d --remove-orphans
```

Confirm all containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                              IMAGE                                STATUS    PORTS
stoneinscription-prometheus       prom/prometheus:latest               Up        0.0.0.0:9090->9090/tcp
stoneinscription-alertmanager     prom/alertmanager:latest             Up        0.0.0.0:9093->9093/tcp
stoneinscription-node-exporter    prom/node-exporter:latest            Up        0.0.0.0:9100->9100/tcp
stoneinscription-cadvisor         gcr.io/cadvisor/cadvisor:latest      Up        0.0.0.0:8082->8080/tcp
stoneinscription-grafana          grafana/grafana:latest               Up        0.0.0.0:3000->3000/tcp
blackbox_exporter                 prom/blackbox-exporter:latest        Up        0.0.0.0:9115->9115/tcp
```

---

## Verifying the Deployment

### Prometheus UI

Open `http://<monitoring-vm-ip>:9090` in a browser.

Navigate to **Status → Targets** to see all scrape targets and their current state (`UP` or `DOWN`). On a fresh deployment with all platform services running, all targets should show `UP`.

Check alerts are loaded:

```bash
curl -s http://localhost:9090/api/v1/rules | python3 -m json.tool | grep '"name"'
```

### Alertmanager UI

Open `http://<monitoring-vm-ip>:9093` in a browser. It shows currently active alerts and the routing configuration.

Verify Alertmanager config loaded without errors:

```bash
curl -s http://localhost:9093/api/v2/status | python3 -m json.tool | grep '"configChecksum"'
```

### Grafana UI

Open `http://<monitoring-vm-ip>:3000` in a browser.

Default login:
- Username: `admin`
- Password: `admin`

> **Change the default password immediately after first login.** Grafana will prompt you to do so. Leaving `admin`/`admin` in production is a security risk.

Add Prometheus as a data source:
1. Go to **Connections → Data sources → Add data source**
2. Select **Prometheus**
3. Set URL to `http://stoneinscription-prometheus:9090`
4. Click **Save & test**

### Node Exporter metrics

```bash
curl -s http://localhost:9100/metrics | grep node_cpu
```

### cAdvisor metrics

```bash
curl -s http://localhost:8082/metrics | grep container_cpu
```

### Blackbox Exporter

```bash
curl "http://localhost:9115/probe?target=http://google.com&module=http_2xx"
```

### Live logs

```bash
docker compose logs -f stoneinscription-prometheus
docker compose logs -f stoneinscription-alertmanager
docker compose logs -f stoneinscription-grafana
```

---

## cAdvisor Host Mounts — Why They Are Needed

The cAdvisor container mounts several host paths as read-only:

| Host path | Container path | Purpose |
|---|---|---|
| `/` | `/rootfs:ro` | Reads filesystem metrics (disk usage per container) |
| `/var/run` | `/var/run:ro` | Accesses the Docker socket to discover running containers |
| `/sys` | `/sys:ro` | Reads kernel and hardware metrics (cgroup data) |
| `/var/lib/docker/` | `/var/lib/docker:ro` | Reads Docker layer and container metadata |

These mounts are **required** for cAdvisor to enumerate containers and collect their resource usage. The `:ro` (read-only) flag ensures cAdvisor cannot modify host data — it can only read it. Do not remove these mounts or cAdvisor will report no container metrics.

---

## Redeployment

When configuration files change (e.g. adding a new scrape target or updating alert recipients):

```bash
cd /home/ssp/monitoring

# Transfer updated config files from local machine first
# Then on the VM:

docker compose down -v --remove-orphans    # full teardown as per Ansible behaviour
docker compose up -d --remove-orphans
```

**For config-only changes that do not require a full teardown:**

Prometheus and Alertmanager both support live config reload without container restart:

```bash
# Reload Prometheus config (picks up changes to prometheus.yml and alert.yml)
docker exec stoneinscription-prometheus kill -HUP 1

# Reload Alertmanager config (picks up changes to alertManager.yml)
docker exec stoneinscription-alertmanager kill -HUP 1
```

Verify the reload succeeded by checking logs:

```bash
docker compose logs stoneinscription-prometheus | grep -i 'reload\|error'
docker compose logs stoneinscription-alertmanager | grep -i 'reload\|error'
```

---

## Stopping the Stack

```bash
cd /home/ssp/monitoring

# Stop containers, preserve Grafana dashboards and Prometheus data
docker compose down

# Stop containers and delete all data (matches Ansible redeployment behaviour)
docker compose down -v --remove-orphans
```

---

## Platform-Wide Scrape Target Reference

This table maps every scrape target in `prometheus.yml` to its source module and the network path Prometheus uses to reach it:

| Job | Source module | Host resolution | Port | Metrics path |
|---|---|---|---|---|
| `prometheus` | This module | Docker DNS (`prometheus`) | `9090` | `/metrics` |
| `node` | This module | Docker DNS (`node_exporter`) | `9100` | `/metrics` |
| `cadvisor` | This module | Docker DNS (`cadvisor`) | `8080` | `/metrics` |
| `geo` | External (Nominatim VM) | `/etc/hosts` → `10.182.0.210` | `8080` | `/probe` via blackbox |
| `suggestion AI model` | Suggestion Model module | `extra_hosts` → `10.180.93.12` | `8080` | `/metrics` |
| `content moderation AI model` | Content Moderation module | `extra_hosts` → `10.180.93.12` | `8081` | `/metrics` |
| `mongodb` | External (MongoDB replica set) | `extra_hosts` → `10.180.22.114/.115/.116` | `9216` | `/metrics` |
| `spring-backend` | Web Server module (backend) | `extra_hosts` → `10.180.148.197` | `8081` | `/actuator/prometheus` |
| `Classification-model` | Classification Model module | `extra_hosts` → `10.180.93.12` | `8001` | `/metrics` |
| `amd-gpu` _(disabled)_ | Classification Model module | `extra_hosts` → `10.180.93.12` | `9101` | `/metrics` |

---

## Troubleshooting

### All targets show `DOWN` in Prometheus

Check that `/etc/hosts` entries are present on the monitoring VM:

```bash
grep -E 'suggestion|classification|mongodb|stoneinscription-backend|geo' /etc/hosts
```

If missing, re-run the `tee` command from Step 2. After adding entries, restart the Prometheus container to pick them up (they are injected at container start via `extra_hosts`):

```bash
docker compose restart stoneinscription-prometheus
```

### Specific target shows `DOWN`

Click the target in the Prometheus UI (`Status → Targets`) to see the error. Common patterns:

- `connection refused` — the service is not running on that port
- `dial tcp: no such host` — the hostname is not in `/etc/hosts` or `extra_hosts`
- `context deadline exceeded` — the service is running but not responding within the scrape timeout

### Alertmanager not receiving alerts from Prometheus

Verify Prometheus can reach Alertmanager:

```bash
curl -s http://localhost:9090/api/v1/alertmanagers
```

The response should list `alertmanager:9093` as a discovered Alertmanager. If it is empty, Prometheus cannot reach Alertmanager — both containers must be on `monitoring_network`.

### Alert emails not being sent

```bash
docker compose logs stoneinscription-alertmanager | grep -iE 'error|smtp|mail|auth'
```

Common causes:

- **App Password not set**: Gmail requires an App Password (not account password) when 2FA is enabled. Generate one at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
- **2FA not enabled**: Gmail App Passwords require 2FA to be active on the sending account
- **`smtp_auth_username` mismatch**: Must exactly match the Gmail address in `smtp_from`

Test SMTP connectivity from the VM:

```bash
nc -zv smtp.gmail.com 587
```

### Grafana shows no data after adding Prometheus data source

Confirm the data source URL is `http://stoneinscription-prometheus:9090` (container name, not `localhost`). Grafana runs inside the Docker network and must use the container name to reach Prometheus.

### Prometheus config reload fails

```bash
docker compose logs stoneinscription-prometheus | grep -iE 'error|bad config|failed'
```

Validate the config file before reloading:

```bash
docker exec stoneinscription-prometheus promtool check config /etc/prometheus/prometheus.yml
```

Validate alert rules:

```bash
docker exec stoneinscription-prometheus promtool check rules /etc/prometheus/alert.yml
```

Fix any reported errors before sending `kill -HUP 1`.

### cAdvisor shows no container metrics

Confirm the host mounts are working:

```bash
docker exec stoneinscription-cadvisor ls /var/run/docker.sock
```

If the socket is missing, cAdvisor cannot discover containers. This may indicate a Docker socket path difference on your host (some distros use `/run/docker.sock`). Update the compose volume mount if needed:

```yaml
volumes:
  - /run/docker.sock:/var/run/docker.sock:ro   # if your host uses /run/
```

### Port 3000 already in use

The web server module's frontend also runs on port 3000 inside Docker. However, since the monitoring stack is on a separate VM, this should not conflict. If it does:

```bash
ss -tlnp | grep 3000
```

Stop the conflicting process or change Grafana's host port in `compose.yml` (e.g. `"3001:3000"`).