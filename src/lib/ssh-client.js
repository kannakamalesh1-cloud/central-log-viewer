const { Client } = require('ssh2');
const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');

class SSHController {
  constructor(socket) {
    this.socket = socket;
    this.conn = null;
    this.stream = null;
    this.localProcess = null;
  }

  static isLocal(host) {
    if (!host) return false;
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    
    // Check all network interfaces
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name].filter(i => !i.internal)) {
        if (iface.address === host) return true;
      }
    }
    return false;
  }


  static sanitizeKey(key) {
    if (!key) return key;

    // 1. Clean up overall whitespace and hidden unicode chars
    let clean = key.trim()
      .replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, ' ')
      .replace(/\r/g, '');

    // 2. Locate the indices of the actual key block
    const headerPattern = /BEGIN [A-Z ]+ PRIVATE KEY/;
    const footerPattern = /END [A-Z ]+ PRIVATE KEY/;

    const lines = clean.split('\n');
    let headerIdx = -1;
    let footerIdx = -1;

    for (let i = 0; i < lines.length; i++) {
       if (headerPattern.test(lines[i])) headerIdx = i;
       if (footerPattern.test(lines[i])) footerIdx = i;
    }

    if (headerIdx === -1 || footerIdx === -1) return key;

    let headerMatch = lines[headerIdx].match(headerPattern);
    let footerMatch = lines[footerIdx].match(footerPattern);
    let headerText = headerMatch ? headerMatch[0] : "BEGIN OPENSSH PRIVATE KEY";
    let footerText = footerMatch ? footerMatch[0] : "END OPENSSH PRIVATE KEY";

    const finalHeader = `-----${headerText}-----`;
    const finalFooter = `-----${footerText}-----`;

    // Extract all content between headers, join into one string, then remove ALL whitespace
    const bodyText = lines.slice(headerIdx + 1, footerIdx)
      .join('')
      .replace(/\s+/g, '');

    // --- DEEP SANITIZATION (Heal corrupted bytes) ---
    let finalBody = bodyText;
    try {
        const buf = Buffer.from(bodyText, 'base64');
        // Check if it's an unencrypted OpenSSH key v1
        if (buf.slice(0, 15).toString() === 'openssh-key-v1\0') {
            let pos = 15;
            const readLen = () => { if (pos + 4 > buf.length) return 0; const l = buf.readUInt32BE(pos); pos += 4; return l; };
            
            const cipherLen = readLen(); pos += cipherLen;
            const kdfLen = readLen(); pos += kdfLen;
            const kdfOptsLen = readLen(); pos += kdfOptsLen;
            pos += 4; // num_keys
            
            const pubLen = readLen(); pos += pubLen;
            const privBlockLen = readLen();
            
            // Checkints are the first 8 bytes of the private block
            if (privBlockLen >= 8 && pos + 8 <= buf.length) {
                const check1 = buf.slice(pos, pos + 4);
                const check2 = buf.slice(pos + 4, pos + 8);
                if (!check1.equals(check2)) {
                    // HEAL: Force check2 to match check1
                    check1.copy(buf, pos + 4);
                    finalBody = buf.toString('base64');
                }
            }
        }
    } catch(e) { /* ignore healing errors, return what we have */ }

    // Re-format into 70-character lines for maximum compatibility
    const bodyLines = finalBody.match(/.{1,70}/g) || [];

    return [finalHeader, ...bodyLines, finalFooter].join('\n');
  }

  // Uses Auto Detection by calling 'discover-sources'
  async discoverLogSources(serverConfig, type = '') {
    const cmd = type ? `discover-sources ${type}` : 'discover-sources';
    const privateKey = SSHController.sanitizeKey(serverConfig.privateKey);

    if (SSHController.isLocal(serverConfig.host)) {
       return new Promise((resolve, reject) => {
          const wrapperPath = path.resolve(__dirname, '../../log-wrapper.sh');
          exec(wrapperPath, {
             env: { ...process.env, SSH_ORIGINAL_COMMAND: cmd }
          }, (err, stdout, stderr) => {
             if (err && !stdout) return reject(err);
             const list = stdout.split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => {
                    const [type, ...rest] = s.split(':');
                    const [identifier, status] = rest.join(':').split('|');
                    return { type, identifier, status: status || null };
                });
             resolve(list);
          });
       });
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      conn.on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          let output = '';
          stream.on('data', (data) => output += data.toString());
          stream.on('close', () => {
             conn.end();
             const list = output.split('\n')
                .map(s => s.trim())
                .filter(Boolean)
                .map(s => {
                    const [type, ...rest] = s.split(':');
                    const [identifier, status] = rest.join(':').split('|');
                    return { type, identifier, status: status || null };
                });
             resolve(list);
          });
        });
      }).on('error', (err) => reject(err));
      
      conn.connect({
        host: serverConfig.host,
        port: serverConfig.port,
        username: serverConfig.username,
        privateKey: privateKey
      });
    });
  }

  // Actually streams the logs
  connectAndStream(serverConfig, commandStr) {
    const privateKey = SSHController.sanitizeKey(serverConfig.privateKey);

    if (SSHController.isLocal(serverConfig.host)) {
       if (this.socket) this.socket.emit('terminal:data', '\\r\\n\\x1b[32m[SYSTEM] Securing local stream...\\x1b[0m\\r\\n');
       const wrapperPath = path.resolve(__dirname, '../../log-wrapper.sh');
       
       this.localProcess = spawn(wrapperPath, [], {
          env: { ...process.env, SSH_ORIGINAL_COMMAND: commandStr }
       });

       this.localProcess.stdout.on('data', (data) => {
           let formatted = data.toString().replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\r\\n');
           if (this.socket) this.socket.emit('terminal:data', formatted);
       });

       this.localProcess.stderr.on('data', (data) => {
           let formatted = data.toString().replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\r\\n');
           if (this.socket) this.socket.emit('terminal:data', `\\x1b[31m${formatted}\\x1b[0m`);
       });

       this.localProcess.on('close', () => {
           if (this.socket) this.socket.emit('terminal:data', '\\r\\n\\x1b[33m[SYSTEM] Stream Closed.\\x1b[0m\\r\\n');
           this.disconnect();
       });
       
       this.localProcess.on('error', (err) => {
          if (this.socket) this.socket.emit('terminal:data', `\\r\\n\\x1b[31m[SYSTEM ERROR] Local execution failed: ${err.message}\\x1b[0m\\r\\n`);
       });
       return;
    }

    this.conn = new Client();
    
    this.conn.on('ready', () => {
       if (this.socket) this.socket.emit('terminal:data', '\\r\\n\\x1b[32m[SYSTEM] Securely connected via SSH...\\x1b[0m\\r\\n');
       
       this.conn.exec(commandStr, (err, stream) => {
          if (err) {
            if (this.socket) this.socket.emit('terminal:data', `\\r\\n\\x1b[31m[SYSTEM ERROR] Exec failed: ${err.message}\\x1b[0m\\r\\n`);
            this.disconnect();
            return;
          }
          this.stream = stream;

          stream.on('data', (data) => {
             let formatted = data.toString().replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\r\\n');
             if (this.socket) this.socket.emit('terminal:data', formatted);
          });

          stream.stderr.on('data', (data) => {
             let formatted = data.toString().replace(/\\r\\n/g, '\\n').replace(/\\n/g, '\\r\\n');
             if (this.socket) this.socket.emit('terminal:data', `\\x1b[31m${formatted}\\x1b[0m`);
          });

          stream.on('close', () => {
             if (this.socket) this.socket.emit('terminal:data', '\\r\\n\\x1b[33m[SYSTEM] Stream Closed.\\x1b[0m\\r\\n');
             this.disconnect();
          });
       });
    });

    this.conn.on('error', (err) => {
      if (this.socket) this.socket.emit('terminal:data', `\\r\\n\\x1b[31m[SYSTEM ERROR] SSH connection error: ${err.message}\\x1b[0m\\r\\n`);
    });

    try {
      this.conn.connect({
        host: serverConfig.host,
        port: serverConfig.port,
        username: serverConfig.username,
        privateKey: privateKey
      });
    } catch (e) {
      if (this.socket) this.socket.emit('terminal:data', `\\r\\n\\x1b[31m[SYSTEM ERROR] Invalid target server config.\\x1b[0m\\r\\n`);
    }
  }

  writePayload(data) {
     if (this.stream) this.stream.write(data);
     if (this.localProcess && this.localProcess.stdin) this.localProcess.stdin.write(data);
  }

  disconnect() {
    if (this.localProcess) {
      this.localProcess.kill('SIGKILL');
      this.localProcess = null;
    }
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
    if (this.conn) {
      this.conn.end();
      this.conn = null;
    }
  }

  static async testConnection(serverConfig) {
    const privateKey = SSHController.sanitizeKey(serverConfig.privateKey);
    
    if (SSHController.isLocal(serverConfig.host)) {
      return { success: true, message: 'Local connection is inherently available.' };
    }

    return new Promise((resolve) => {
      const conn = new Client();
      conn.on('ready', () => {
        conn.end();
        resolve({ success: true });
      }).on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
      
      try {
        conn.connect({
          host: serverConfig.host,
          port: parseInt(serverConfig.port) || 22,
          username: serverConfig.username,
          privateKey: privateKey,
          readyTimeout: 10000 // 10s timeout for testing
        });
      } catch (e) {
        resolve({ success: false, error: e.message });
      }
    });
  }
}

module.exports = { SSHController };
