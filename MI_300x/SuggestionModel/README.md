# Suggestion Model — Deployment Guide

ROCm-based suggestion/completion service for the Stone Inscription platform. Runs a [vLLM](https://docs.vllm.ai/) OpenAI-compatible inference server backed by `openai/gpt-oss-20b`, using two AMD GPUs in tensor-parallel mode. Exposes an OpenAI-compatible REST API on port `8080`.

This guide covers **manual deployment** on the target VM. The Ansible automation files are not distributed.

---

## What Gets Deployed

| Container | Image | Host Port | Purpose |
|---|---|---|---|
| `suggestion-model` | `vllm/vllm-openai-rocm:latest` | `8080` | vLLM inference server (OpenAI-compatible API) |

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

## GPU Allocation Across the Platform

> **Important — read before deploying.**

This module uses **GPU indices 0 and 1** (`HIP_VISIBLE_DEVICES=0,1`). If other modules are running on the same VM, confirm there is no GPU index conflict before starting this stack:

| Module | GPU Indices Used |
|---|---|
| Classification Model | `0` |
| Content Moderation | `1`, `2` |
| **Suggestion Model** | **`0`, `1`** |

The Suggestion Model overlaps with both Classification (index 0) and Content Moderation (index 1). **Do not run Suggestion Model and either of those services simultaneously on the same VM unless you have adjusted `HIP_VISIBLE_DEVICES` to use non-conflicting GPU indices.** Coordinate with the platform team before changing GPU assignments.

---

## Repository Layout After Cloning

When you pull the code from GitHub, your local working directory for this module will look like this:

```
SuggestionModel/
├── compose.yml
├── .env
```

The following directory structure will be created **on the VM** during deployment:

```
~/artifactRegistory/SuggestionModel/
├── docker-compose.yml
├── .env
└── deployment/
    └── vllm/
        ├── models/          # Model cache — must contain model files before starting
        └── templates/       # Chat templates (optional)
```

---

## Prerequisites

Before deploying, ensure the following are satisfied on the **target VM**.

### 1. ROCm Drivers

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

### 3. User in the `video` Group

```bash
sudo usermod -aG video $USER
newgrp video
```

Verify:

```bash
groups | grep video
```

### 4. Two GPUs at Indices 0 and 1

This module binds to GPU indices 0 and 1. Verify they are available and idle before proceeding (see GPU verification step below).

---

## ⚠️ GPU Node Verification — Do This Before Every Deployment

> **Mandatory pre-flight.** The vLLM server will fail to start if the expected GPUs are not present, unhealthy, or already occupied by another service.

### List all available GPUs

```bash
rocminfo | grep -E 'Agent|Name|Device Type'
```

Confirm at least **2 GPU agents** are present.

### Check GPU status and memory

```bash
rocm-smi
```

Confirm `GPU[0]` and `GPU[1]` are shown. Check that neither GPU is already being used by another process:

```bash
rocm-smi --showmeminfo vram
```

Both GPUs should show most of their VRAM as free. If either shows high usage, another service is occupying that GPU — resolve the conflict before proceeding (see GPU allocation table above).

### Check VRAM requirements

With `--gpu-memory-utilization 0.9` and tensor parallelism across 2 GPUs (`-tp 2`), the container will use 90% of VRAM on both GPUs. For a 20B parameter model, each GPU should have at minimum **~20 GB VRAM**.

```bash
rocm-smi --showmeminfo vram
```

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
mkdir -p ~/artifactRegistory/SuggestionModel/deployment/vllm/models
mkdir -p ~/artifactRegistory/SuggestionModel/deployment/vllm/templates
```

> The `models/` directory is mounted as the Hugging Face cache inside the container at `/root/.cache/huggingface`. It must exist and contain the model files **before** the container starts — vLLM does not download models at runtime by default.

---

## Step 2 — Obtain and Place the Model

The model used by this service is `openai/gpt-oss-20b`. Unlike gated Hugging Face models, this does **not** require a Hugging Face token. However, the model files must be present in the cache directory before the container starts.

### Option A — Download via Hugging Face CLI

If the model is publicly available on Hugging Face:

```bash
# Install the HF CLI if not already present
~/miniconda3/bin/pip install --upgrade "huggingface_hub[cli]" --break-system-packages

# Download the model into the cache directory
~/miniconda3/bin/hf download openai/gpt-oss-20b \
  --cache-dir ~/artifactRegistory/SuggestionModel/deployment/vllm/models
```

> The download may be large (20B parameter models are typically 40–50 GB). Ensure sufficient disk space before starting:
>
> ```bash
> df -h ~/artifactRegistory/SuggestionModel/deployment/vllm/models
> ```
>
> The `hf download` command is resumable — if interrupted, re-run the same command to continue.

### Option B — Copy from Another Location

If the model is already downloaded elsewhere on the VM or on another machine:

```bash
# From another path on the same VM
cp -r /path/to/cached/model ~/artifactRegistory/SuggestionModel/deployment/vllm/models/

# From a remote machine via rsync
rsync -avz --progress user@remote:/path/to/model/ \
  cdacsabhas@10.180.93.12:~/artifactRegistory/SuggestionModel/deployment/vllm/models/
```

### Verify model files are present

```bash
ls ~/artifactRegistory/SuggestionModel/deployment/vllm/models/
```

The directory should contain model weight files (`.safetensors` or `.bin`) and configuration files (`config.json`, `tokenizer.json`, etc.). An empty directory will cause the container to fail at startup.

---

## Step 3 — Configure the Environment File

Review and update `.env` **locally** before transferring:

```env
OPENAI_API_PORT=8080
OPENAI_API_MODEL=openai/gpt-oss-20b
OPENAI_API_GPU_UTIL=0.9
OPENAI_API_KEY=token-abc123
```

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_PORT` | `8080` | Port the vLLM server listens on, mapped to the same port on the host |
| `OPENAI_API_MODEL` | `openai/gpt-oss-20b` | Model ID to serve. Must match the directory name inside the model cache |
| `OPENAI_API_GPU_UTIL` | `0.9` | Fraction of GPU VRAM vLLM is allowed to use (0.0–1.0). Lower if OOM errors occur |
| `OPENAI_API_KEY` | `token-abc123` | Bearer token clients must send in the `Authorization` header. **Change this to a secure value before deploying to production** |

> **Note:** There is no `HUGGING_FACE_HUB_TOKEN` in this module's `.env`. The model does not require HF authentication. Do not add one unless you change to a gated model.

---

## Step 4 — Populate the Templates Directory (Optional)

The container mounts `./deployment/vllm/templates/` at `/app/templates/` inside the container. If your deployment uses custom chat templates, place them in this directory on the VM:

```bash
ls ~/artifactRegistory/SuggestionModel/deployment/vllm/templates/
```

If no custom templates are needed, the directory can remain empty — vLLM will fall back to the model's built-in template.

To transfer templates from your local machine:

```bash
scp -r ./templates/ cdacsabhas@10.180.93.12:~/artifactRegistory/SuggestionModel/deployment/vllm/templates/
```

---

## Step 5 — Transfer Files to the VM

From your **local machine**, transfer `compose.yml` and `.env` to the VM:

```bash
# Rename compose.yml to docker-compose.yml on the server
scp compose.yml cdacsabhas@10.180.93.12:~/artifactRegistory/SuggestionModel/docker-compose.yml

# Transfer the environment file
scp .env cdacsabhas@10.180.93.12:~/artifactRegistory/SuggestionModel/.env
```

### Expected directory state on the VM before starting

```
~/artifactRegistory/SuggestionModel/
├── docker-compose.yml
├── .env
└── deployment/
    └── vllm/
        ├── models/
        │   └── <model weight and config files>
        └── templates/
            └── <chat template files, if any>
```

Do not proceed to Step 6 until this structure is confirmed and `models/` is populated.

---

## Step 6 — Start the Stack

SSH into the VM, navigate to the project directory, and start the container:

```bash
ssh cdacsabhas@10.180.93.12

cd ~/artifactRegistory/SuggestionModel

docker compose up -d
```

Docker will pull `vllm/vllm-openai-rocm:latest` if not already cached, then start the container. The vLLM server takes **several minutes to initialise** — it loads the full model into GPU memory before accepting requests.

Monitor startup progress:

```bash
docker compose logs -f suggestion-model
```

Look for a line similar to:

```
INFO:     Uvicorn running on http://0.0.0.0:8080 (Press CTRL+C to quit)
```

This confirms the server is ready to accept requests.

Confirm the container is running:

```bash
docker compose ps
```

Expected output:

```
NAME               IMAGE                          STATUS    PORTS
suggestion-model   vllm/vllm-openai-rocm:latest   Up        0.0.0.0:8080->8080/tcp
```

---

## Verifying the Deployment

### Health check — models endpoint

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer token-abc123"
```

Replace `token-abc123` with the `OPENAI_API_KEY` value from your `.env`. A successful response lists the loaded model:

```json
{
  "object": "list",
  "data": [
    {
      "id": "openai/gpt-oss-20b",
      "object": "model"
    }
  ]
}
```

### Test inference

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer token-abc123" \
  -d '{
    "model": "openai/gpt-oss-20b",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 50
  }'
```

### Live logs

```bash
docker compose logs -f suggestion-model
docker compose logs --tail=100 suggestion-model
```

---

## vLLM Server Configuration Reference

The vLLM server is started with these flags, sourced from `.env`:

| Flag | Value | Purpose |
|---|---|---|
| `--model` | `openai/gpt-oss-20b` | Model to load from the Hugging Face cache |
| `--port` | `8080` | Port the API server listens on |
| `--gpu-memory-utilization` | `0.9` | Maximum fraction of GPU VRAM for the KV cache |
| `--api-key` | `token-abc123` | Bearer token required on all API requests |
| `-tp 2` | — | Tensor parallelism across 2 GPUs |
| `--enable-auto-tool-choice` | — | Enables automatic tool/function call routing |
| `--tool-call-parser` | `openai` | OpenAI-style parser for tool call output |

> **`--tool-call-parser openai`** — this module uses the `openai` parser, not `pythonic` (which is used by Content Moderation). The two are not interchangeable. Do not swap them between modules.

## GPU and Container Security Configuration Reference

| Setting | Value | Reason |
|---|---|---|
| `HIP_VISIBLE_DEVICES` | `0,1` | Restricts container to GPU indices 0 and 1 |
| `devices` | `/dev/kfd`, `/dev/dri` | AMD GPU kernel driver access |
| `group_add` | `video` | Required for DRI device file access |
| `security_opt` | `seccomp:unconfined` | ROCm runtime syscall requirements |
| `cap_add` | `SYS_PTRACE` | ROCm profiling and debug support |
| `ipc` | `host` | Shared memory for large tensor operations |
| `shm_size` | `10g` | Shared memory for inter-process GPU communication |

---

## Stopping the Stack

```bash
cd ~/artifactRegistory/SuggestionModel

# Stop container, preserve volumes
docker compose down

# Stop container and remove volumes
docker compose down -v

# Stop container, remove volumes, remove orphaned containers
docker compose down -v --remove-orphans
```

> The model files in `deployment/vllm/models/` are a bind mount to a host directory, **not** a Docker named volume. Running `docker compose down -v` will **not** delete them. Model files persist on disk until manually removed.

---

## Troubleshooting

### Container starts but API returns 401 Unauthorized

The `OPENAI_API_KEY` in your request does not match the value in `.env`. Ensure you are sending:

```bash
-H "Authorization: Bearer <your-OPENAI_API_KEY-value>"
```

### Container exits during model loading (OOM)

The model does not fit in the available VRAM across both GPUs. Options:

- Lower `OPENAI_API_GPU_UTIL` in `.env` (e.g. `0.75`) and redeploy
- Verify both GPUs are visible (`rocm-smi`) and that `HIP_VISIBLE_DEVICES=0,1` matches actual GPU indices on your host
- Check that no other process is consuming GPU memory on indices 0 or 1:

```bash
rocm-smi --showmeminfo vram
```

### vLLM server fails with model not found

The model ID in `OPENAI_API_MODEL` must match the directory structure inside the model cache. Check what is actually present:

```bash
ls ~/artifactRegistory/SuggestionModel/deployment/vllm/models/
```

The cache directory typically contains a `models--<org>--<model-name>` subdirectory structure when downloaded via the HF CLI. vLLM resolves the model by ID, so ensure the ID in `.env` matches exactly what was downloaded.

### GPU index conflict with another service

If another module is already using GPU 0 or GPU 1, the container will fail to allocate memory. Check which processes are using which GPUs:

```bash
rocm-smi
```

Review the GPU allocation table at the top of this document and coordinate with the platform team to reassign `HIP_VISIBLE_DEVICES` if necessary.

### vLLM server starts but hangs on model loading

Monitor GPU utilisation while the server is initialising:

```bash
watch -n 2 rocm-smi
```

If GPU utilisation stays at 0% for more than 5 minutes, the model is failing to map into GPU memory. Check for errors:

```bash
docker compose logs suggestion-model | grep -iE 'error|nccl|hip|killed|oom'
```

### Port 8080 already in use

```bash
ss -tlnp | grep 8080
```

Stop the conflicting process or change `OPENAI_API_PORT` in `.env` and redeploy.

### `/dev/kfd: no such file or directory`

```bash
sudo modprobe amdgpu
ls /dev/kfd
```

If `modprobe` fails, the ROCm driver stack needs to be installed or the system needs a full reboot after install.

### Permission denied on `/dev/dri` or `/dev/kfd`

```bash
groups | grep video
```

If `video` is absent:

```bash
sudo usermod -aG video cdacsabhas
newgrp video
```