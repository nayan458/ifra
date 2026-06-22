# Classification Model — Deployment Guide

ROCm-based classification inference service for the Stone Inscription platform. This guide walks through **manual deployment** on a target VM using Docker Compose. The Ansible automation files are not distributed — this document replaces them with step-by-step instructions.

---

## What Gets Deployed

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `classification_model` | _(your own image — see below)_ | `8001` | Classification inference REST API |
| `rocm_exporter` | `rocm/device-metrics-exporter:nic-v1.0.0` | `9835` | AMD GPU metrics (Prometheus-compatible) |

Both containers run on a shared bridge network called `monitoring-network`.

---

## Target VM

| Field | Value |
|---|---|
| Host | `10.180.93.12` |
| SSH User | `cdacsabhas` |
| Password | _Provided separately to authorised personnel only_ |

```bash
ssh cdacsabhas@10.180.93.12
```

---

## Repository Layout After Cloning

When you pull the code from GitHub, your local working directory for this module will look like this:

```
Classification-Model/
├── compose.yml
├── .env
```

> **Note:** `output.txt`, `deployment.yml`, and `README.md` are present in the source tree but are not needed on the VM. Only `compose.yml` and `.env` are transferred.

---

## Prerequisites

Before running anything, ensure the following are satisfied on the **target VM**.

### 1. ROCm Drivers

The AMD GPU kernel modules must be installed and loaded. Verify:

```bash
ls /dev/kfd
ls /dev/dri
```

If either path is missing, the ROCm driver stack is not installed or the host needs a reboot after installation. Refer to the [official ROCm installation guide](https://rocm.docs.amd.com/en/latest/deploy/linux/index.html) for your distro.

### 2. Docker Engine with Compose v2

```bash
docker --version
docker compose version
```

The stack uses `docker compose` (v2 plugin), **not** the legacy `docker-compose` binary. If only the legacy binary is present, install the Compose v2 plugin:

```bash
sudo apt-get install docker-compose-plugin   # Debian/Ubuntu
```

### 3. User in the `video` Group

The containers pass through `/dev/dri` which requires the `video` group:

```bash
sudo usermod -aG video $USER
newgrp video
```

Verify:

```bash
groups | grep video
```

If the group does not appear, log out and back in before proceeding.

---

## ⚠️ GPU Node Verification — Do This Before Every Deployment

> **This step is mandatory.** Before running `docker compose up`, confirm the GPU is visible and healthy on the host. Skipping this step means the container will start but the inference service will fail at runtime with cryptic errors.

### Check GPU visibility via ROCm

```bash
rocminfo
```

Look for output listing your GPU device. A healthy output will show:
- `Agent` blocks with `Device Type: GPU`
- A `Name:` field identifying your GPU (e.g., `gfx942` for MI300x)

### Confirm the GFX version

```bash
rocminfo | grep gfx
```

Note the value returned (e.g., `gfx942`). This maps to the `HSA_OVERRIDE_GFX_VERSION` in the `.env` file. If your GPU reports a different version than `9.4.2`, **update the `.env` file before deploying**:

| GFX String from `rocminfo` | `HSA_OVERRIDE_GFX_VERSION` value |
|---|---|
| `gfx942` | `9.4.2` ← default (AMD MI300x) |
| `gfx90a` | `9.0.10` (AMD MI250x) |
| `gfx908` | `9.0.8` (AMD MI100) |

### Quick device sanity check

```bash
ls -la /dev/kfd /dev/dri/
```

If `/dev/kfd` is absent, the `amdgpu` kernel module is not loaded:

```bash
sudo modprobe amdgpu
```

Then re-verify with `rocminfo`.

---

## Step 1 — Create the Project Directory on the VM

SSH into the server:

```bash
ssh cdacsabhas@10.180.93.12
```

Create the deployment directory:

```bash
mkdir -p ~/artifactRegistory/Classification-Model/models
```

The `models/` subdirectory **must exist** before starting the stack — Docker mounts it into the container at `/app/models`. Without it, compose will error on startup.

> **Note:** The parent directory is spelled `artifactRegistory` (not `artifactRepository`). Use this exact spelling — it matches the path expected by the rest of the platform.

---

## Step 2 — Configure Your Docker Image

The `compose.yml` ships with a placeholder image reference. You must replace it with your own built and pushed image before deployment.

Open `compose.yml` locally and update the `image:` field under `classification_model`:

```yaml
services:
  classification_model:
    image: <your-registry>/<your-image>:<your-tag>
```

**Example** (if using Docker Hub):

```yaml
    image: myorg/stoneinscription-classification:latest
```

**Example** (if using a private registry):

```yaml
    image: registry.example.com/stoneinscription/classification:v1.0.0
```

Make sure the image is pushed to your registry before proceeding:

```bash
docker push <your-registry>/<your-image>:<your-tag>
```

If the registry requires authentication, log in on the VM before running compose:

```bash
docker login <your-registry>
```

---

## Step 3 — Update the Environment File

The `.env` file controls GPU runtime behaviour. Review it before transferring:

```env
HSA_OVERRIDE_GFX_VERSION=9.4.2
ROCM_PATH=/opt/rocm
HIP_VISIBLE_DEVICES=0
CUDA_VISIBLE_DEVICES=0
HSA_ENABLE_SDMA=0
```

| Variable | Default | Purpose |
|---|---|---|
| `HSA_OVERRIDE_GFX_VERSION` | `9.4.2` | Forces ROCm to treat the GPU as this GFX version. Must match your actual GPU (see GPU verification step above) |
| `ROCM_PATH` | `/opt/rocm` | Path where ROCm is installed on the host. Change only if ROCm was installed to a non-standard path |
| `HIP_VISIBLE_DEVICES` | `0` | Restricts HIP runtime to GPU index 0. Increment if using a different GPU slot |
| `CUDA_VISIBLE_DEVICES` | `0` | Restricts CUDA compatibility layer to GPU index 0 |
| `HSA_ENABLE_SDMA` | `0` | Disables System DMA. Improves stability on MI300x — do not enable unless you know your hardware requires it |

> **Do not remove this file or rename it.** The compose file references `.env` via `env_file:`. If the file is missing, the container will start without GPU environment variables and the ROCm runtime will fail silently.

---

## Step 4 — Transfer Files to the VM

From your **local machine**, copy both files into the project directory on the VM. Note that `compose.yml` is renamed to `docker-compose.yml` on the server:

```bash
# Transfer the compose file (renaming it in the process)
scp compose.yml cdacsabhas@10.180.93.12:~/artifactRegistory/Classification-Model/docker-compose.yml

# Transfer the environment file
scp .env cdacsabhas@10.180.93.12:~/artifactRegistory/Classification-Model/.env
```

### Transferring model weights (if applicable)

If your model weights are stored locally:

```bash
# Single file
scp /path/to/model.bin cdacsabhas@10.180.93.12:~/artifactRegistory/Classification-Model/models/

# Entire directory
scp -r ./models/ cdacsabhas@10.180.93.12:~/artifactRegistory/Classification-Model/models/
```

If the weights are too large for `scp`, consider using `rsync` instead:

```bash
rsync -avz --progress ./models/ cdacsabhas@10.180.93.12:~/artifactRegistory/Classification-Model/models/
```

### Expected directory state on the VM before starting

```
~/artifactRegistory/Classification-Model/
├── docker-compose.yml
├── .env
└── models/
    └── <your model files here>
```

---

## Step 5 — Create the Docker Network

Both containers communicate over a shared bridge network. Create it once on the VM:

```bash
docker network create monitoring-network
```

If the network already exists from a previous deployment, you will see:

```
Error response from daemon: network with name monitoring-network already exists
```

This is safe to ignore. Do not delete and recreate the network if other services are already using it.

---

## Step 6 — Tear Down Any Existing Stack

If a previous version of this stack is running, bring it down cleanly before deploying:

```bash
cd ~/artifactRegistory/Classification-Model

docker compose down --remove-orphans -v
```

This stops all containers, removes orphaned containers from previous runs, and removes any volumes created by the stack.

> Skip this step only on a **first-time deployment** where no previous containers exist.

---

## Step 7 — Start the Stack

```bash
cd ~/artifactRegistory/Classification-Model

docker compose up -d
```

Docker will pull any images not already cached, then start both containers in detached mode. On first run, pulling the images may take several minutes depending on your connection.

Confirm both containers are running:

```bash
docker compose ps
```

Expected output:

```
NAME                    IMAGE                                         STATUS          PORTS
classification_model    <your-image>                                  Up (healthy)    0.0.0.0:8001->8001/tcp
rocm_exporter           rocm/device-metrics-exporter:nic-v1.0.0      Up              0.0.0.0:9835->9101/tcp
```

---

## Verifying the Deployment

### Health check status

Docker polls `http://localhost:8001/` every 30 seconds (10 s timeout, 3 retries, 40 s grace on startup). Check the status:

```bash
docker inspect --format='{{.State.Health.Status}}' classification_model
```

Expected: `healthy`

During startup, the status will show `starting` for up to 40 seconds. If it shows `unhealthy` after that window, check the logs immediately (see Troubleshooting below).

### Classification API

```bash
curl -f http://localhost:8001/
```

### GPU metrics (Prometheus)

```bash
curl http://localhost:9835/metrics
```

You should see Prometheus-format output with `rocm_` prefixed metric lines.

### Live logs

```bash
docker compose logs -f classification_model
docker compose logs -f rocm_exporter
```

---

## GPU and Container Security Configuration Reference

The `classification_model` container runs with elevated privileges required by ROCm. These are intentional — do not remove them:

| Setting | Value | Reason |
|---|---|---|
| `devices` | `/dev/kfd`, `/dev/dri` | AMD GPU kernel driver access |
| `group_add` | `video` | Required for DRI device file access |
| `security_opt` | `seccomp:unconfined` | ROCm runtime syscall requirements |
| `cap_add` | `SYS_PTRACE` | ROCm profiling and debug support |
| `ipc` | `host` | Shared memory with host for large tensor operations |
| `shm_size` | `16gb` | Inference buffer allocation for large models |
| `ulimit memlock` | `-1` (unlimited) | GPU memory pinning |
| `ulimit stack` | `64 MB` | Extended stack for native ROCm libraries |

---

## Restart Behaviour

Both containers are configured with `restart: unless-stopped`. They will automatically restart after:
- Docker daemon restart
- Host reboot

They will **not** restart if explicitly stopped with `docker compose down`.

---

## Stopping the Stack

```bash
cd ~/artifactRegistory/Classification-Model

# Stop containers, keep volumes and network intact
docker compose down

# Stop containers and remove volumes
docker compose down -v

# Stop containers, remove volumes, and remove orphaned containers
docker compose down -v --remove-orphans
```

---

## Troubleshooting

### Container exits immediately after starting

```bash
docker compose logs classification_model
```

Common causes:
- Model files missing from `models/` — the container expects weights at `/app/models`
- Incorrect `.env` values, especially `HSA_OVERRIDE_GFX_VERSION` not matching your GPU
- `/dev/kfd` not accessible inside the container despite being present on the host (usually a `video` group issue)

### `monitoring-network` not found

```bash
docker network create monitoring-network
docker compose up -d
```

### `/dev/kfd: no such file or directory`

The ROCm kernel module is not loaded:

```bash
ls /dev/kfd                 # If missing:
sudo modprobe amdgpu        # Load the module
```

If `modprobe` fails, the ROCm driver stack needs to be installed or the system needs a full reboot after install.

### `HSA_OVERRIDE_GFX_VERSION` mismatch errors in logs

The default value `9.4.2` targets the AMD MI300x (`gfx942`). If you are on a different GPU:

```bash
rocminfo | grep gfx
```

Update `.env` with the correct version, re-transfer the file, and restart the stack.

### Port already in use

```bash
ss -tlnp | grep -E '8001|9835'
```

Stop or reconfigure the conflicting process, then retry `docker compose up -d`.

### Permission denied on `/dev/dri` or `/dev/kfd`

```bash
groups | grep video
```

If `video` is not listed, add the user and start a new session:

```bash
sudo usermod -aG video cdacsabhas
newgrp video
```

### Image pull failing from registry

If using a private registry, ensure you are authenticated on the VM:

```bash
docker login <your-registry>
```

Then retry:

```bash
docker compose pull
docker compose up -d
```