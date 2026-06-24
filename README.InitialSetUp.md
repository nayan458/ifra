# Ansible Installation Guide on Windows (Using WSL2 + Ubuntu 24.04)

Linux users can skip wsl set up and can continue from the Python vertual env creation.

## 1. Install WSL

Open **PowerShell as Administrator** and run:

```powershell
wsl --install
```

Restart your machine if prompted.

Verify WSL installation:

```powershell
wsl --version
```

---

## 2. Check Available Linux Distributions

List all available distributions:

```powershell
wsl --list --online
```

or

```powershell
wsl -l -o
```

You should see output similar to:

```text
NAME
Ubuntu
Ubuntu-24.04
Debian
openSUSE-Tumbleweed
...
```

---

## 3. Install Ubuntu 24.04

Install Ubuntu 24.04:

```powershell
wsl --install Ubuntu-24.04
```

If WSL is already installed:

```powershell
wsl --install -d Ubuntu-24.04
```

Wait for the installation to complete.

Create your Linux username and password when prompted.

---

## 4. List Installed Distributions

Show installed distributions:

```powershell
wsl --list --verbose
```

or

```powershell
wsl -l -v
```

Example:

```text
  NAME            STATE           VERSION
* Ubuntu-24.04    Stopped         2
```

---

## 5. Enter Ubuntu

Start Ubuntu:

```powershell
wsl -d Ubuntu-24.04
```

Alternatively:

```powershell
ubuntu2404
```

You should now be inside the Ubuntu shell:

```bash
username@machine:~$
```

---

## 6. Update Package Repositories

```bash
sudo apt update
sudo apt upgrade -y
```

---

## 7. Install Python Virtual Environment Support

Install Python venv package:

```bash
sudo apt install -y python3-venv
```

Verify:

```bash
python3 --version
```

---

## 8. Install sshpass

Ansible often uses `sshpass` for password-based SSH authentication.

```bash
sudo apt install -y sshpass
```

Verify:

```bash
sshpass -V
```

---

## 9. Create a Python Virtual Environment

Create a directory for Ansible projects:

```bash
cd to the repository
```

Create a virtual environment:

<b> On Windows </b>
```bash
python3 -m venv .venv
```

<b> On Linux </b>
```bash
python -m venv .venv
```

Directory structure:

<em><b> Note: </b> The vertual environment needs to be created in any directory higher then the deployment file for example within the root of the Infra repository or inside is of the sub direcory for example webServerPlaybook, mongodbPlaybook etc. But then you need to create within each of them.  

Suggested to create a single .venv as shown below.
</em> 

```text
Infra/
└── .venv/
```

---

## 10. Activate the Virtual Environment

```bash
source .venv/bin/activate
```

Your prompt should change to:

```text
(.venv) username@machine:~/ansible$
```

---

## 11. Install uv

Install `uv`:

```bash
pip install uv
```

Verify:

```bash
uv --version
```

---

## 12. Install Ansible Using uv

Inside the activated virtual environment:

```bash
uv pip install ansible
```

Verify installation:

```bash
ansible --version
```

Example output:

```text
ansible [core 2.x.x]
python version = 3.12.x
```

## Verify Everything

```bash
which ansible
ansible --version
python --version
uv --version
sshpass -V  # only required in windows
```

You now have an isolated Ansible installation running inside a Python virtual environment on Ubuntu 24.04 under WSL2.
