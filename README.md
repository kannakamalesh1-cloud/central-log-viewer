# 🫀 PulseLog — Cinematic Infrastructure Log Monitoring

![PulseLog v2 Dashboard](./public/pulselog-v2-dashboard.png)

**PulseLog** is a high-performance, centralized log monitoring system designed for modern infrastructure. Built with a cinematic, high-tech aesthetic, it provides real-time streaming of system, container, and application logs via secure SSH tunnels.

Unlike traditional logging stacks that require complex agents and storage, PulseLog is **transient and agent-light**. It discovers and streams logs directly from your target servers on-demand, leaving zero footprint.

---

## ✨ Key Features

- **🌐 Universal Discovery**: Automatically detects Docker containers, Kubernetes pods, Nginx, Apache, System logs, Security/Auth logs, and various Databases (MySQL, Postgres, Redis, MongoDB).
- **💓 Pulse Telemetry**: Real-time "Heartbeat" (EKG) waveform indicating the live status and health of the log stream.
- **🖥️ Multi-Log Matrix (Split View)**: Monitor up to 4 independent log streams simultaneously in a dynamic grid (1, 2, or 4 slots) that auto-adjusts its layout.
- **🚀 Monitor Expansion (Pop-out)**: Move any terminal slot to a dedicated browser window for multi-monitor setups or vertical screen viewing.
- **📋 Security Audit Trail**: 
  - Comprehensive logging of user access and log viewing activity.
  - Advanced search with natural language time parsing (e.g., "yesterday at 5pm").
  - CSV export functionality for compliance and security reviews.
- **🛠️ Multi-Cloud & Hybrid**: Manage multiple servers (Production, Staging, Edge) from a single unified interface.
- **🔍 Advanced Search & Watch**: 
  - Live server-side filtering with Regex support.
  - "Watch" keywords to highlight critical events in real-time.
- **Anomaly Detection**: Error spike monitoring that alerts you if more than 3 errors occur in a 10-second window.
- **🛡️ Hardened Security**:
  - **AES-256-GCM** encryption for SSH private keys at rest.
  - **Restricted Execution**: Uses a security wrapper (`log-wrapper.sh`) on target servers to limit SSH access to log viewing only.
  - **JWT Authentication** with session blacklisting.
- **⚡ Pro UI/UX**: Cinematic dark mode, glassmorphic elements, and Xterm-powered terminal rendering.

---

## 🚀 Tech Stack

- **Frontend**: [Next.js](https://nextjs.org/) (App Router), [Tailwind CSS](https://tailwindcss.com/), [Lucide Icons](https://lucide.dev/).
- **Terminal Engine**: [Xterm.js](https://xtermjs.org/) with Fit Addon.
- **Backend**: Node.js, [Socket.io](https://socket.io/) for real-time streaming.
- **Connectivity**: [ssh2](https://github.com/mscdex/ssh2) for secure remote command execution.
- **Database**: [SQLite3](https://www.sqlite.org/) for local server and user management.
- **Process Management**: [PM2](https://pm2.io/).

---

## 🛠️ Installation & Setup

### 1. Prerequisites
- **Node.js**: v20 or later.
- **PM2**: Global installation (`npm install -g pm2`).

### 2. Clone and Install
```bash
git clone https://github.com/your-repo/central-log-viewer.git
cd central-log-viewer
npm install
```

### 3. Environment Configuration
Create a `.env` file in the root directory:
```env
PORT=3000
JWT_SECRET=your_ultra_secure_jwt_secret
# ENCRYPTION_KEY can be here, but for better security, PulseLog looks for ~/.pulselog_key
```

### 4. Security Hardening (Recommended)
To fully secure your instance:
1. **Restrict Permissions**: Run `chmod 600 .env data/database.sqlite` and `chmod 700 data`.
2. **External Encryption Key**: Move your `ENCRYPTION_KEY` from `.env` to a file outside the project root:
   ```bash
   # Extract key from .env and save to secure location
   grep ENCRYPTION_KEY .env | cut -d'=' -f2 > ~/.pulselog_key
   chmod 600 ~/.pulselog_key
   # Now remove ENCRYPTION_KEY from .env
   ```
   PulseLog will automatically detect this file.

### 4. Linux Target Server Preparation
For each Linux server you want to monitor, PulseLog requires the `log-wrapper.sh` script to be present:
1. Copy `log-wrapper.sh` to the home directory of the SSH user on the target server.
2. Make it executable: `chmod +x ~/log-wrapper.sh`.
3. (Optional but Recommended) Restrict the SSH key in `~/.ssh/authorized_keys`:
   ```ssh
   command="./log-wrapper.sh",no-port-forwarding,no-X11-forwarding ssh-rsa AAA...
   ```

### 5. Windows Target Server Preparation
To monitor a Windows machine, you must enable and configure the OpenSSH Server:

1.  **Open PowerShell as Administrator**.
2.  **Install OpenSSH Server**:
    ```powershell
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
    ```
3.  **Open Firewall Port 22**:
    ```powershell
    New-NetFirewallRule -Name sshd -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22
    ```
4.  **Start & Automate SSH Service**:
    ```powershell
    Start-Service sshd
    Set-Service -Name sshd -StartupType 'Automatic'
    ```

### 6. Start PulseLog
```bash
npm run dev
```
The application will be available at `http://localhost:3000`.

---

## 📖 Usage Guide

### Adding a Server
1. Click the **Plus (+)** icon in the sidebar.
2. Enter the server name, host, SSH port, and username.
3. Paste the **SSH Private Key**. (PulseLog will automatically sanitize and encrypt the key before saving).
4. Use **Test Connection** to verify connectivity.

### Monitoring Logs
1. Select a server from the sidebar.
2. PulseLog will automatically scan the server and categorize available logs.
3. Click a **Slot (1-4)** in the header to select where you want the log to appear.
4. Click a log source in the sidebar to start the stream in that slot.
5. Use the **Pop-out** icon (↗️) to move a terminal to another monitor.
6. Use the **Watch** input to highlight specific words (e.g., "ERROR" or "500").
7. Toggle **Dim Mode** (◐) or adjust **Font Size** (A+/A-) for optimal viewing.

### Security Auditing
1. Go to the **Dashboard Overview**.
2. Scroll to the **Security Audit Trail** section.
3. Use the search bar with natural language dates (e.g., "apr 20-22") to find specific access logs.
4. Click **Export CSV** to download logs for compliance reporting.

---

## 🔒 Security Model

PulseLog is designed with a "Zero-Trust" mindset for log viewing:
- **No Log Storage**: Logs are streamed via memory buffers and never written to the PulseLog server's disk.
- **Forced Commands**: By using the `log-wrapper.sh`, you ensure that even if the SSH key is compromised, it can ONLY be used to discover and read logs, not to gain shell access.
- **Encryption**: Sensitive credentials (private keys) are encrypted using authenticated encryption (AES-256-GCM), preventing tampering or unauthorized reading even if the database file is accessed.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.
