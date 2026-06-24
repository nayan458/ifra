# Ansible Deployment Guide

This guide assumes that the initial setup described in `README.InitialSetUp.md` has already been completed and that Ansible is installed and working inside the Python virtual environment.

## 1. Get into the deployment directory first
```bash
cd MI_300x/ContentModulationModel
```

## 2. Create the Inventory File

Create an `inventory.ini` file into this directory.

```bash
touch inventory.ini
```

Copy the folowing code into the inventory.ini
```ini
[amd_gpu_server]
vm1 ansible_host=10.180.93.12

[amd_gpu_server:vars]
ansible_connection=ssh
```

You may add additional variables such as:

```ini
[amd_gpu_server:vars]
ansible_connection=ssh
ansible_user=<username>
```

---

## 3. Create the Vault Secrets File

Create a directory for encrypted secrets:

```bash
mkdir -p vault
```

Create the secrets file:

```bash
touch vault/secrets.yml
```

Example structure replace with real values provided:

```yaml
amd_gpu_server_user: "value"
amd_gpu_server_password: "value"
```

---

## 4. Encrypt the Secrets File

Encrypt the vault file using Ansible Vault:

```bash
ansible-vault encrypt vault/secrets.yml
```

You will be prompted to enter a vault password.

To view the contents later:

```bash
ansible-vault view vault/secrets.yml
```

To edit the encrypted file:

```bash
ansible-vault edit vault/secrets.yml
```

---

## 5. Accept SSH Fingerprints

Before running the deployment, SSH into each target VM once to accept its host key fingerprint.

```bash
ssh cdacsabhas@10.180.93.12
```

When prompted:

```text
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type:

```text
yes
```

Repeat for all target servers.

---

## 6. Verify Connectivity

Run an Ansible ping test:

```bash
ansible amd_gpu_server -i inventory.ini -m ping
```

Expected output:

```text
vm1 | SUCCESS => ...
```

---

## 7. Run the Deployment

Execute the deployment playbook:

```bash
ansible-playbook -i inventory.ini deployment.yml --ask-vault-password
```

You will be prompted for the Ansible Vault password created during the encryption step.

---

## 8. Common Vault Commands

Encrypt an existing file:

```bash
ansible-vault encrypt vault/secrets.yml
```

Decrypt a file:

```bash
ansible-vault decrypt vault/secrets.yml
```

Change the vault password:

```bash
ansible-vault rekey vault/secrets.yml
```

View encrypted contents:

```bash
ansible-vault view vault/secrets.yml
```

Edit encrypted contents:

```bash
ansible-vault edit vault/secrets.yml
```

---

## Directory Structure

```text
Infra/MI_300x/classificationModel/
├── inventory.ini
├── deployment.yml
├── vault/
│   └── secrets.yml
├── README.AnsibleDeployment.md
└── ...
```
