# 🫀 PulseLog — Cinematic Infrastructure Log Monitoring

![PulseLog Dashboard](./pulselog_dashboard_mockup_1776668267474.png)

**PulseLog** is a high-performance, centralized log monitoring system designed for modern infrastructure. Built with a cinematic, high-tech aesthetic, it provides real-time streaming of system, container, and application logs via secure SSH tunnels.

Unlike traditional logging stacks that require complex agents and storage, PulseLog is **transient and agent-light**. It discovers and streams logs directly from your target servers on-demand, leaving zero footprint.

---

## ✨ Key Features

- **🌐 Universal Discovery**: Automatically detects Docker containers, Kubernetes pods, Nginx, Apache, System logs, Security/Auth logs, and various Databases (MySQL, Postgres, Redis, MongoDB).
- **💓 Pulse Telemetry**: Real-time "Heartbeat" (EKG) waveform indicating the live status and health of the log stream.
- **🛠️ Multi-Cloud & Hybrid**: Manage multiple servers (Production, Staging, Edge) from a single unified interface.
- **🔍 Advanced Search & Watch**: 
  - Live server-side filtering with Regex support.
  - "Watch" keywords to highlight critical events in real-time.
- **🕒 Connection History**: Intelligent history tracking of the last 5 viewed logs with server context for rapid switching.
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
ENCRYPTION_KEY=64_char_hex_key_for_aes_encryption
```

### 4. Target Server Preparation
For each server you want to monitor, PulseLog requires the `log-wrapper.sh` script to be present:
1. Copy `log-wrapper.sh` to the home directory of the SSH user on the target server.
2. Make it executable: `chmod +x ~/log-wrapper.sh`.
3. (Optional but Recommended) Restrict the SSH key in `~/.ssh/authorized_keys`:
   ```ssh
   command="./log-wrapper.sh",no-port-forwarding,no-X11-forwarding ssh-rsa AAA...
   ```

### 5. Start PulseLog
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
1. Select a server from the dropdown.
2. PulseLog will automatically scan the server and categorize available logs.
3. Click a log source (e.g., a Docker container or `/var/log/syslog`) to start the stream.
4. Use the **Watch** input to highlight specific words (e.g., "ERROR" or "500").
5. Toggle **Dim Mode** (◐) or adjust **Font Size** (A+/A-) for optimal viewing.

---

## 🔒 Security Model

PulseLog is designed with a "Zero-Trust" mindset for log viewing:
- **No Log Storage**: Logs are streamed via memory buffers and never written to the PulseLog server's disk.
- **Forced Commands**: By using the `log-wrapper.sh`, you ensure that even if the SSH key is compromised, it can ONLY be used to discover and read logs, not to gain shell access.
- **Encryption**: Sensitive credentials (private keys) are encrypted using authenticated encryption (AES-256-GCM), preventing tampering or unauthorized reading even if the database file is accessed.

---

## 📄 License
MIT License. See [LICENSE](LICENSE) for details.
