# Content Moderation — Deployment Guide

ROCm-based content moderation service for the Stone Inscription platform. Runs a [vLLM](https://docs.vllm.ai/) OpenAI-compatible inference server backed by `google/gemma-3-27b-it`, using two AMD GPUs in tensor-parallel mode. Exposes an OpenAI-compatible REST API on port `8081`.

This guide covers **manual deployment** on the target VM. The Ansible automation files are not distributed.

---

## What Gets Deployed

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `content-moderation` | `vllm/vllm-openai-rocm:latest` | `8081` | vLLM inference server (OpenAI-compatible API) |

> Unlike the Classification module, this module runs a **single container**. There is no separate metrics exporter.

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
Content-moderation/
├── compose.yml
├── .env
```

The following directory structure will be created **on the VM** during deployment:

```
~/artifactRegistory/Content-moderation/
├── docker-compose.yml
├── .env
└── deployment/
    └── vllm/
        ├── models/          # Hugging Face model cache (downloaded during deployment)
        └── templates/       # Chat templates (must be populated before starting)
```

---

## Prerequisites

Before deploying, ensure the following are satisfied on the **target VM**.

### 1. ROCm Drivers

The AMD GPU kernel modules must be installed and loaded:

```bash
ls /dev/kfd
ls /dev/dri
```

If either path is missing, install the ROCm driver stack or reboot after installation. Refer to the [ROCm installation guide](https://rocm.docs.amd.com/en/latest/deploy/linux/index.html).

### 2. Docker Engine with Compose v2

```bash
docker --version
docker compose version
```

Must use `docker compose` (v2 plugin), not the legacy `docker-compose` binary.

### 3. Miniconda3

The Hugging Face CLI (`hf`) is installed and managed via Miniconda on the VM. Verify it exists:

```bash
ls ~/miniconda3/bin/hf
ls ~/miniconda3/bin/pip
```

If Miniconda is not installed, follow the [Miniconda installation guide](https://docs.anaconda.com/miniconda/install/) and then install the HF CLI (see Step 3 below).

### 4. User in the `video` Group

```bash
sudo usermod -aG video $USER
newgrp video
```

Verify:

```bash
groups | grep video
```

### 5. Two GPUs Available

This module uses **GPU indices 1 and 2** (`HIP_VISIBLE_DEVICES=1,2`) with tensor parallelism across both (`-tp 2`). At least 3 GPUs must be present on the host (index 0 is reserved for other services). Verify during the GPU check step below.

---

## ⚠️ GPU Node Verification — Do This Before Every Deployment

> **Mandatory pre-flight.** The vLLM server will fail to start if the expected GPUs are not present or healthy. Confirm GPU state before running `docker compose up`.

### List all available GPUs

```bash
rocminfo | grep -E 'Agent|Name|Device Type'
```

This lists all CPU and GPU agents. Confirm that at least **3 GPU agents** are present and that indices 1 and 2 are AMD GPU devices.

### Check GPU indices explicitly

```bash
rocm-smi
```

Confirm output shows `GPU[0]`, `GPU[1]`, and `GPU[2]` (or more). The content-moderation container will bind to indices 1 and 2.

### Verify GPU memory

The Gemma 3 27B model requires significant VRAM. With `--gpu-memory-utilization 0.90`, the container will attempt to use 90% of available VRAM across both GPUs. Check available memory per GPU:

```bash
rocm-smi --showmeminfo vram
```

Each GPU should have at minimum **~24 GB VRAM** for a 27B parameter model with `tp=2`.

### Confirm device files

```bash
ls -la /dev/kfd /dev/dri/
```

---

## Step 1 — Create the Directory Structure on the VM

SSH into the server:

```bash
ssh cdacsabhas@10.180.93.12
```

Create all required directories:

```bash
mkdir -p ~/artifactRegistory/Content-moderation/deployment/vllm/models
mkdir -p ~/artifactRegistory/Content-moderation/deployment/vllm/templates
```

Set ownership on the model cache directory:

```bash
chown cdacsabhas:cdacsabhas ~/artifactRegistory/Content-moderation/deployment/vllm/models
```

> The `models/` directory is mounted as the Hugging Face cache inside the container at `/root/.cache/huggingface`. It must be writable by the user running the container. The `templates/` directory is mounted at `/app/templates/` inside the container.

---

## Step 2 — Configure the Environment File

The `.env` file controls the model, port, and authentication tokens. Review and update it **locally** before transferring:

```env
API_PORT=8081
API_MODEL=google/gemma-3-27b-it
API_GPU_UTIL=0.90
API_KEY=token-abc123
HUGGING_FACE_HUB_TOKEN=<your-huggingface-token>
```

| Variable | Default | Purpose |
|---|---|---|
| `API_PORT` | `8081` | Port the vLLM server listens on, mapped to the same port on the host |
| `API_MODEL` | `google/gemma-3-27b-it` | Hugging Face model ID to serve. Change if deploying a different model |
| `API_GPU_UTIL` | `0.90` | Fraction of GPU VRAM vLLM is allowed to use (0.0–1.0). Lower if OOM errors occur |
| `API_KEY` | `token-abc123` | Bearer token clients must send in the `Authorization` header. **Change this to a secure value before deploying to production** |
| `HUGGING_FACE_HUB_TOKEN` | _(your token)_ | Hugging Face access token required to download gated models like Gemma. See below |

### Obtaining a Hugging Face Token

1. Log in at [huggingface.co](https://huggingface.co)
2. Go to **Settings → Access Tokens → New token**
3. Create a token with **Read** permissions
4. Accept the [Gemma model licence](https://huggingface.co/google/gemma-3-27b-it) on the model page — the download will fail without this, even with a valid token

Replace `HUGGING_FACE_HUB_TOKEN` in `.env` with your token before proceeding.

---

## Step 3 — Install the Hugging Face CLI on the VM

The model is downloaded using the `hf` CLI installed under Miniconda. SSH into the VM and run:

```bash
~/miniconda3/bin/pip install --upgrade "huggingface_hub[cli]" "typer>=0.12.0" --break-system-packages
```

Verify the CLI is available:

```bash
~/miniconda3/bin/hf --version
```

---

## Step 4 — Download the Model from Hugging Face

Still on the VM, download (or sync) the model into the cache directory. Replace `<your-token>` with your actual Hugging Face token:

```bash
HUGGING_FACE_HUB_TOKEN=<your-token> \
~/miniconda3/bin/hf download google/gemma-3-27b-it \
  --cache-dir ~/artifactRegistory/Content-moderation/deployment/vllm/models \
  --token <your-token>
```

> **This download is large** — Gemma 3 27B is approximately 50–60 GB. Ensure sufficient disk space on the VM before starting. The `hf download` command is resumable: if interrupted, re-run the same command and it will pick up from where it left off.

To check available disk space:

```bash
df -h ~/artifactRegistory/Content-moderation/deployment/vllm/models
```

If you are deploying a different model (i.e. you changed `API_MODEL` in `.env`), replace `google/gemma-3-27b-it` in the command above with your model ID.

---

## Step 5 — Populate the Templates Directory

The container mounts `./deployment/vllm/templates/` at `/app/templates/` inside the container. If your deployment uses custom chat templates, place them in this directory on the VM:

```bash
ls ~/artifactRegistory/Content-moderation/deployment/vllm/templates/
```

If no custom templates are needed, the directory can remain empty — vLLM will fall back to the model's built-in template.

---

## Step 6 — Transfer Files to the VM

From your **local machine**, transfer `compose.yml` and `.env` to the VM:

```bash
# Rename compose.yml to docker-compose.yml on the server
scp compose.yml cdacsabhas@10.180.93.12:~/artifactRegistory/Content-moderation/docker-compose.yml

# Transfer the environment file
scp .env cdacsabhas@10.180.93.12:~/artifactRegistory/Content-moderation/.env
```

If you have chat templates locally to transfer:

```bash
scp -r ./templates/ cdacsabhas@10.180.93.12:~/artifactRegistory/Content-moderation/deployment/vllm/templates/
```

### Expected directory state on the VM before starting

```
~/artifactRegistory/Content-moderation/
├── docker-compose.yml
├── .env
└── deployment/
    └── vllm/
        ├── models/
        │   └── <huggingface cache files — downloaded in Step 4>
        └── templates/
            └── <chat template files, if any>
```

---

## Step 7 — Start the Stack

SSH into the VM, navigate to the project directory, and start the container:

```bash
ssh cdacsabhas@10.180.93.12

cd ~/artifactRegistory/Content-moderation

docker compose up -d
```

Docker will pull `vllm/vllm-openai-rocm:latest` if not already cached, then start the container. The vLLM server takes **several minutes to initialise** on first start — it loads the full model into GPU memory before accepting requests.

Monitor startup progress:

```bash
docker compose logs -f content-moderation
```

Look for a line similar to:

```
INFO:     Uvicorn running on http://0.0.0.0:8081 (Press CTRL+C to quit)
```

This confirms the server is ready to accept requests.

Confirm the container is running:

```bash
docker compose ps
```

Expected output:

```
NAME                 IMAGE                          STATUS    PORTS
content-moderation   vllm/vllm-openai-rocm:latest   Up        0.0.0.0:8081->8081/tcp
```

---

## Verifying the Deployment

### Health check — models endpoint

```bash
curl http://localhost:8081/v1/models \
  -H "Authorization: Bearer token-abc123"
```

Replace `token-abc123` with the `API_KEY` value from your `.env`. A successful response lists the loaded model:

```json
{
  "object": "list",
  "data": [
    {
      "id": "google/gemma-3-27b-it",
      "object": "model"
    }
  ]
}
```

### Test inference

```bash
curl http://localhost:8081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token-abc123" \
  -d '{
    "model": "google/gemma-3-27b-it",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }'
```

### Live logs

```bash
docker compose logs -f content-moderation
docker compose logs --tail=100 content-moderation
```

---

## vLLM Server Configuration Reference

The vLLM server is started with these flags, sourced from `.env`:

| Flag | Value | Purpose |
|---|---|---|
| `--model` | `google/gemma-3-27b-it` | Model to load from the Hugging Face cache |
| `--port` | `8081` | Port the API server listens on |
| `--gpu-memory-utilization` | `0.90` | Maximum fraction of GPU VRAM to use for the KV cache |
| `--api-key` | `token-abc123` | Bearer token required on all API requests |
| `-tp 2` | — | Tensor parallelism across 2 GPUs |
| `--enable-auto-tool-choice` | — | Enables automatic tool/function call routing |
| `--tool-call-parser` | `pythonic` | Parser style for tool call output |

## GPU and Container Security Configuration Reference

| Setting | Value | Reason |
|---|---|---|
| `HIP_VISIBLE_DEVICES` | `1,2` | Restricts container to GPU indices 1 and 2 |
| `devices` | `/dev/kfd`, `/dev/dri` | AMD GPU kernel driver access |
| `group_add` | `video` | Required for DRI device file access |
| `security_opt` | `seccomp:unconfined` | ROCm runtime syscall requirements |
| `cap_add` | `SYS_PTRACE` | ROCm profiling and debug support |
| `ipc` | `host` | Shared memory for large tensor operations |
| `shm_size` | `10g` | Shared memory for inter-process GPU communication |

---

## Stopping the Stack

```bash
cd ~/artifactRegistory/Content-moderation

# Stop container, preserve volumes
docker compose down

# Stop container and remove volumes
docker compose down -v

# Stop container, remove volumes, remove orphaned containers
docker compose down -v --remove-orphans
```

> The downloaded model in `deployment/vllm/models/` is **not** a Docker volume — it is a bind mount to a host directory. Running `docker compose down -v` will **not** delete it. The model files persist on disk until manually removed.

---

## Troubleshooting

### Container starts but API returns 401 Unauthorized

The `API_KEY` in your request does not match the `API_KEY` in `.env`. Ensure you are sending:

```bash
-H "Authorization: Bearer <your-API_KEY-value>"
```

### Container exits during model loading (OOM)

The model does not fit in the available VRAM. Options:

- Lower `API_GPU_UTIL` in `.env` (e.g. `0.80`) and redeploy
- Verify both GPUs are visible (`rocm-smi`) and that `HIP_VISIBLE_DEVICES=1,2` matches actual GPU indices
- Confirm no other process is consuming GPU memory on indices 1 or 2:

```bash
rocm-smi --showmeminfo vram
```

### Model download fails with `401` or `403`

The Hugging Face token is missing or the model licence has not been accepted:

1. Verify the token is valid at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)
2. Visit the model page and accept the licence: [google/gemma-3-27b-it](https://huggingface.co/google/gemma-3-27b-it)
3. Re-run the `hf download` command from Step 4

### `hf` command not found

```bash
ls ~/miniconda3/bin/hf
```

If missing, reinstall:

```bash
~/miniconda3/bin/pip install --upgrade "huggingface_hub[cli]" "typer>=0.12.0" --break-system-packages
```

### vLLM server starts but hangs on model loading

Check GPU utilisation while the server is starting:

```bash
watch -n 2 rocm-smi
```

If GPU utilisation stays at 0% for more than 5 minutes, the model is likely failing to map into GPU memory. Check logs for NCCL or HIP errors:

```bash
docker compose logs content-moderation | grep -iE 'error|nccl|hip|killed'
```

### Port 8081 already in use

```bash
ss -tlnp | grep 8081
```

Stop the conflicting process or change `API_PORT` in `.env` before deploying.

### Permission denied on `/dev/dri` or `/dev/kfd`

```bash
groups | grep video
```

If `video` is absent:

```bash
sudo usermod -aG video cdacsabhas
newgrp video
```