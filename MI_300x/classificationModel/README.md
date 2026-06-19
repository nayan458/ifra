# Classification Model Deployment Guide

This guide provides instructions for manually deploying the Classification Model service.

## Prerequisites

Before you begin, ensure you have the following installed and configured:

- **Docker**: Version 20.10 or higher
- **Docker Compose**: Version 1.29 or higher
- **Access**: SSH access to the AMD GPU server with appropriate credentials
- **Disk Space**: Sufficient space for the model and Docker images

## Directory Structure

The Classification Model will be deployed at:
```
/home/<username>/artifactRegistory/Classification-Model/
```

## Manual Deployment Steps

### Step 1: Connect to the AMD GPU Server

```bash
ssh <username>@<amd_gpu_server_ip>
```

### Step 2: Create Project Directory

Create the project directory if it doesn't exist:

```bash
mkdir -p /home/<username>/artifactRegistory/Classification-Model
cd /home/<username>/artifactRegistory/Classification-Model
```

Replace `<username>` with your actual username.

### Step 3: Copy Configuration Files

Copy the required configuration files to your project directory:

#### Copy the Docker Compose file:
```bash
cp compose.yml /home/<username>/artifactRegistory/Classification-Model/docker-compose.yml
```

#### Copy the Environment file:
```bash
cp .env /home/<username>/artifactRegistory/Classification-Model/.env
```

**Note**: Ensure the `.env` file contains all necessary environment variables for your deployment. Update values as needed for your environment.

### Step 4: Stop and Remove Existing Containers (If Any)

If you have any existing Classification Model containers running, stop and remove them:

```bash
cd /home/<username>/artifactRegistory/Classification-Model

# Stop and remove existing containers
docker-compose down --remove-orphans

# To also remove volumes (use with caution - this deletes data)
docker-compose down --remove-orphans -v
```

### Step 5: Start the Classification Model

Deploy the Classification Model using Docker Compose:

```bash
cd /home/<username>/artifactRegistory/Classification-Model

# Pull latest images and start the service
docker-compose up -d
```

The `-d` flag runs the containers in detached mode (background).

## Verification

### Check Running Containers

Verify that the Classification Model containers are running:

```bash
docker-compose ps
```

You should see the Classification Model service listed as "running".

### View Logs

To view the deployment logs:

```bash
# View all logs
docker-compose logs

# View logs for a specific service (follow in real-time)
docker-compose logs -f <service_name>

# View last 100 lines of logs
docker-compose logs --tail=100
```

### Test Service Health

Once deployed, verify the service is responding (adjust the endpoint based on your service):

```bash
curl http://localhost:<port>/health
```

## Common Operations

### Stop the Service

```bash
docker-compose stop
```

### Restart the Service

```bash
docker-compose restart
```

### Remove the Service

```bash
docker-compose down
```

### Remove Service and Volumes

```bash
docker-compose down -v
```

### View Service Details

```bash
# Inspect running container
docker ps | grep classification

# Get container details
docker inspect <container_id>
```

## Environment Configuration

The `.env` file should include the following variables (adjust as needed for your setup):

```env
# Add your environment variables here
# Example:
# MODEL_PORT=8000
# GPU_DEVICE=0
# LOG_LEVEL=INFO
```

Review the `.env` file and update all values according to your deployment requirements.

## Troubleshooting

### Containers Not Starting

1. Check logs for errors:
   ```bash
   docker-compose logs
   ```

2. Verify `.env` file exists and has correct values:
   ```bash
   cat /home/<username>/artifactRegistory/Classification-Model/.env
   ```

3. Ensure Docker daemon is running:
   ```bash
   docker ps
   ```

### GPU Issues (if applicable)

If the model requires GPU access:

1. Verify GPU is available:
   ```bash
   docker run --rm --gpus all nvidia/cuda:11.0-runtime nvidia-smi
   ```

2. Check docker-compose.yml has correct GPU configuration

### Port Conflicts

If you encounter port binding errors:

1. Check which service is using the port:
   ```bash
   sudo lsof -i :<port_number>
   ```

2. Either stop the conflicting service or modify the port in `docker-compose.yml`

### Permission Issues

If you encounter permission errors:

1. Ensure your user has Docker permissions:
   ```bash
   sudo usermod -aG docker $USER
   newgrp docker
   ```

2. Verify directory permissions:
   ```bash
   ls -la /home/<username>/artifactRegistory/
   ```

## Maintenance

### Backing Up Data

Before making changes, backup important data:

```bash
docker-compose exec <service_name> tar -czf backup.tar.gz /data
docker cp <container_id>:/backup.tar.gz ./backup.tar.gz
```

### Updating the Service

To update to a new version:

1. Pull new images:
   ```bash
   docker-compose pull
   ```

2. Stop and restart:
   ```bash
   docker-compose down
   docker-compose up -d
   ```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [AMD GPU Server Documentation](link_to_your_docs)

## Support

For issues or questions, contact your system administrator or refer to the main project documentation.
