# Kafka — Deployment Guide

Message broker infrastructure for the Stone Inscription platform. Deploys a Kafka broker backed by Zookeeper, with AKHQ as a web-based Kafka management UI. The backend and n8n services connect to this Kafka instance for event-driven communication.

This guide covers **manual deployment** on the target VM. The Ansible automation files are not distributed.

---

## What Gets Deployed

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `zookeeper` | `zookeeper:3.9.5` | `2181` | Kafka coordination service |
| `kafka` | `confluentinc/cp-kafka:7.6.11` | `9092`, `29092` | Kafka broker |
| `akhq` | `tchiotludo/akhq:0.25.1` | `8090` | Kafka management UI |

### Kafka listener ports

| Port | Listener | Purpose |
|---|---|---|
| `9092` | `PLAINTEXT` | Internal Docker-to-Docker communication (container name `kafka`) |
| `29092` | `PLAINTEXT_HOST` | External access from services outside Docker (backend, n8n on other VMs) |

---

## Target VM

| Field | Value |
|---|---|
| Deployment directory | `/home/ssp/kafka` |
| Host IP | `10.180.148.197` _(current deployment — update for your VM)_ |
| SSH User | `ssp` |
| Password | _Provided separately to authorised personnel only_ |

```bash
ssh ssp@10.180.148.197
```

---

## Repository Layout After Cloning

When you pull the code from GitHub, your local working directory for this module will look like this:

```
kafka/
├── docker/
│   └── compose.kafka.yml
└── env/
    └── kafka.env
```

The following will be created **on the VM**:

```
/home/ssp/kafka/
├── docker-compose.yml
└── env/
    └── kafka.env
```

---

## Prerequisites

### 1. Docker Engine with Compose v2

```bash
docker --version
docker compose version
```

Must use `docker compose` (v2 plugin), not the legacy `docker-compose` binary.

### 2. User in the `docker` Group

```bash
sudo usermod -aG docker ssp
newgrp docker
```

Verify:

```bash
groups | grep docker
```

### 3. Ports Available on the Host

```bash
ss -tlnp | grep -E '2181|9092|29092|8090'
```

All four ports must be free before starting the stack.

---

## ⚠️ Critical Configuration — Update Before Deploying

Before transferring any files to the VM, you must update `env/kafka.env` with the **actual IP address of the VM where Kafka will run**.

Open `env/kafka.env` locally and locate this line:

```env
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,PLAINTEXT_HOST://10.180.148.197:29092
```

Replace `10.180.148.197` with the actual IP of your Kafka VM:

```env
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,PLAINTEXT_HOST://<your-kafka-vm-ip>:29092
```

**Do not skip this step.** If the host IP is wrong:
- Services on other VMs (backend, n8n) will connect to Kafka but fail to receive messages
- Kafka will advertise an unreachable address to clients, causing silent connection failures that are difficult to diagnose

> **Why two listeners?** The `PLAINTEXT` listener (`kafka:9092`) is used for intra-Docker communication — containers on the same Docker network reach Kafka using the container name. The `PLAINTEXT_HOST` listener (`<ip>:29092`) is used by services **outside** this Docker host, such as the Spring Boot backend on the web server VM, which connects via `kafka:29092` resolved through `/etc/hosts` on that VM. Both listeners must be correctly advertised or one category of clients will fail.

---

## Step 1 — Create the Project Directory on the VM

SSH into the server:

```bash
ssh ssp@10.180.148.197
```

Create the project directory:

```bash
mkdir -p /home/ssp/kafka/env
```

---

## Step 2 — Configure the Environment File

Update `env/kafka.env` **locally** before transferring (see the critical configuration note above):

```env
KAFKA_BROKER_ID=1
KAFKA_ZOOKEEPER_CONNECT=zookeeper:2181
KAFKA_LISTENERS=PLAINTEXT://0.0.0.0:9092,PLAINTEXT_HOST://0.0.0.0:29092
KAFKA_ADVERTISED_LISTENERS=PLAINTEXT://kafka:9092,PLAINTEXT_HOST://<your-kafka-vm-ip>:29092
KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=PLAINTEXT:PLAINTEXT,PLAINTEXT_HOST:PLAINTEXT
KAFKA_INTER_BROKER_LISTENER_NAME=PLAINTEXT
KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1
KAFKA_AUTO_CREATE_TOPICS_ENABLE=true
KAFKA_DELETE_TOPIC_ENABLE=true
```

| Variable | Value | Purpose |
|---|---|---|
| `KAFKA_BROKER_ID` | `1` | Unique ID for this broker. Keep as `1` for a single-broker setup |
| `KAFKA_ZOOKEEPER_CONNECT` | `zookeeper:2181` | Zookeeper address. Resolves via Docker's internal DNS — do not change |
| `KAFKA_LISTENERS` | `PLAINTEXT://0.0.0.0:9092, PLAINTEXT_HOST://0.0.0.0:29092` | Bind addresses — listens on all interfaces for both listeners. Do not change |
| `KAFKA_ADVERTISED_LISTENERS` | `PLAINTEXT://kafka:9092, PLAINTEXT_HOST://<vm-ip>:29092` | **Addresses that Kafka advertises to clients. Must reflect actual reachable addresses.** Update the host IP here |
| `KAFKA_LISTENER_SECURITY_PROTOCOL_MAP` | `PLAINTEXT:PLAINTEXT, PLAINTEXT_HOST:PLAINTEXT` | Maps listener names to security protocols. Both are plain TCP (no TLS) |
| `KAFKA_INTER_BROKER_LISTENER_NAME` | `PLAINTEXT` | Listener used for broker-to-broker communication |
| `KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR` | `1` | Replication factor for the internal `__consumer_offsets` topic. Must be `1` for a single-broker setup |
| `KAFKA_AUTO_CREATE_TOPICS_ENABLE` | `true` | Allows topics to be created automatically when first produced to |
| `KAFKA_DELETE_TOPIC_ENABLE` | `true` | Allows topics to be deleted via admin APIs |

---

## Step 3 — Transfer Files to the VM

From your **local machine**:

```bash
# Rename compose.kafka.yml to docker-compose.yml on the server
scp docker/compose.kafka.yml ssp@10.180.148.197:/home/ssp/kafka/docker-compose.yml

# Transfer the env directory
scp -r env/ ssp@10.180.148.197:/home/ssp/kafka/env/
```

Verify the structure on the VM:

```bash
ssh ssp@10.180.148.197 find /home/ssp/kafka -type f
```

Expected output:

```
/home/ssp/kafka/docker-compose.yml
/home/ssp/kafka/env/kafka.env
```

---

## Step 4 — Pull Images and Start the Stack

SSH into the VM:

```bash
ssh ssp@10.180.148.197

cd /home/ssp/kafka
```

Pull the latest images first:

```bash
docker compose pull
```

Start the stack:

```bash
docker compose up -d --force-recreate --remove-orphans
```

Confirm all containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME        IMAGE                            STATUS    PORTS
zookeeper   zookeeper:3.9.5                  Up        0.0.0.0:2181->2181/tcp
kafka       confluentinc/cp-kafka:7.6.11     Up        0.0.0.0:9092->9092/tcp, 0.0.0.0:29092->29092/tcp
akhq        tchiotludo/akhq:0.25.1           Up        0.0.0.0:8090->8080/tcp
```

> **Startup order:** `kafka` depends on `zookeeper` and `akhq` depends on `kafka`. Docker Compose will start them in the correct order. However, `depends_on` only waits for the container to start, not for the service inside it to be ready. Give Kafka 20–30 seconds to fully initialise before expecting client connections.

---

## Verifying the Deployment

### Check Zookeeper is responding

```bash
echo ruok | nc localhost 2181
```

Expected output: `imok`

### Check Kafka broker is up

```bash
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

On a fresh deployment with no topics yet, this returns an empty list (or just the internal `__consumer_offsets` topic). No output is fine — the important thing is the command does not error.

### Check AKHQ is accessible

```bash
curl -I http://localhost:8090
```

Expected: `HTTP/1.1 200 OK`

Open `http://<kafka-vm-ip>:8090` in a browser to access the AKHQ Kafka management UI. It connects to Kafka internally at `kafka:9092`.

### Test external connectivity from another VM

From the web server VM (or any other VM that needs to reach Kafka), verify connectivity on port 29092:

```bash
nc -zv 10.180.148.197 29092
```

Expected: `Connection to 10.180.148.197 29092 port [tcp/*] succeeded!`

If this fails, check firewall rules on the Kafka VM — port 29092 must be open for inbound connections.

### Live logs

```bash
docker compose logs -f kafka
docker compose logs -f zookeeper
docker compose logs -f akhq
```

---

## Data Volumes

All three volumes are local Docker volumes (not external). They are created automatically by Docker Compose on first run and persist across container restarts:

| Volume | Mounted at | Purpose |
|---|---|---|
| `zookeeper_data` | `/data` | Zookeeper data snapshots |
| `zookeeper_logs` | `/datalog` | Zookeeper transaction logs |
| `kafka_data` | `/var/lib/kafka/data` | Kafka topic data and partition logs |

> Unlike the web server module, these volumes do not have external names and are managed by Compose. Running `docker compose down -v` **will** delete all Kafka message data and Zookeeper state. Use `docker compose down` (without `-v`) for routine restarts.

---

## Redeployment (Updating Images)

```bash
cd /home/ssp/kafka

docker compose pull
docker compose up -d --force-recreate --remove-orphans
```

---

## Stopping the Stack

```bash
cd /home/ssp/kafka

# Stop containers, preserve volumes and data
docker compose down

# Stop containers and delete all Kafka/Zookeeper data — use with caution
docker compose down -v
```

### Full clean state reset

If Kafka is in a broken state and you need to start completely fresh (clears all topics and consumer group offsets):

```bash
docker compose down -v
docker compose up -d
```

> This is a destructive operation. All messages not yet consumed and all committed offsets will be lost.

---

## Connecting Other Services to Kafka

The backend service on the web server VM connects to Kafka using the hostname `kafka` resolved via `/etc/hosts`:

```
10.180.148.197  kafka
```

This entry must exist in `/etc/hosts` on the web server VM (it is added as part of the Web Server module deployment). The backend's `KAFKA_BOOTSTRAP_SERVERS` is set to `kafka:29092` — this routes through `/etc/hosts` to `10.180.148.197:29092`, which is the `PLAINTEXT_HOST` external listener.

If you change the Kafka VM's IP, you must update:
1. `KAFKA_ADVERTISED_LISTENERS` in `env/kafka.env` on the Kafka VM, then redeploy
2. The `/etc/hosts` entry on the web server VM

---

## Troubleshooting

### Kafka container exits immediately after Zookeeper starts

```bash
docker compose logs kafka
```

Common causes:

**Zookeeper not yet ready:** Kafka starts before Zookeeper is fully initialised. Wait 10 seconds and retry:

```bash
docker compose restart kafka
```

**Dirty Zookeeper state from a previous run:** If Zookeeper has leftover broker registration data, Kafka may fail to register. Do a clean restart:

```bash
docker compose down -v
docker compose up -d
```

### Clients connect but cannot produce or consume messages

This almost always means `KAFKA_ADVERTISED_LISTENERS` is wrong. Kafka tells clients to reconnect to the address in `ADVERTISED_LISTENERS` after the initial connection. If that address is unreachable, the client connects successfully but then cannot proceed.

Verify the advertised address:

```bash
docker exec kafka kafka-configs --bootstrap-server localhost:9092 \
  --describe --entity-type brokers --entity-name 1
```

Look for `advertised.listeners` in the output. It must show the correct external IP for `PLAINTEXT_HOST`.

If the IP is wrong, update `env/kafka.env`, re-transfer it to the VM, and redeploy:

```bash
docker compose up -d --force-recreate
```

### `echo ruok | nc localhost 2181` returns nothing

Zookeeper is not running or not listening. Check:

```bash
docker compose ps zookeeper
docker compose logs zookeeper
```

### AKHQ shows "Connection refused" to Kafka

AKHQ connects to `kafka:9092` on the Docker internal network. If Kafka is not yet ready, AKHQ will show a connection error in the UI. Wait 30 seconds after Kafka starts and refresh the browser.

If the error persists:

```bash
docker exec akhq ping kafka
```

If `ping` fails, the containers are not on the same network. This should not happen with the provided compose file, but if you have modified the file, verify no `networks:` block was inadvertently added to individual services without defining a shared network.

### Port 29092 not reachable from other VMs

Check the firewall on the Kafka VM:

```bash
# Ubuntu/Debian with ufw
sudo ufw status
sudo ufw allow 29092/tcp

# Or check iptables directly
sudo iptables -L INPUT -n | grep 29092
```

Also confirm the port is actually bound:

```bash
ss -tlnp | grep 29092
```

### Topics not appearing in AKHQ

If `KAFKA_AUTO_CREATE_TOPICS_ENABLE=true` and you have produced messages but topics are not showing in AKHQ, try refreshing — AKHQ polls Kafka periodically. You can also list topics directly:

```bash
docker exec kafka kafka-topics --bootstrap-server localhost:9092 --list
```

To manually create a topic:

```bash
docker exec kafka kafka-topics --bootstrap-server localhost:9092 \
  --create --topic <topic-name> --partitions 1 --replication-factor 1
```