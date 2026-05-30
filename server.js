require('dotenv').config();
const express = require('express');
const https = require('https');
const next = require('next');
const { Server } = require('socket.io');
const { initDB, get, all, run: dbRun } = require('./src/lib/db.js');
const { SSHController } = require('./src/lib/ssh-client.js');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookie = require('cookie');
const fs = require('fs');
const path = require('path');
const os = require('os');


const dev = process.env.NODE_ENV !== 'production';
const hostname = process.env.HOST || '0.0.0.0';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

// Security Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Load encryption key from a secure location if possible
const SECURE_KEY_PATH = process.env.SECURE_KEY_PATH || path.join(os.homedir(), '.pulselog_key');
let ENCRYPTION_KEY;

if (fs.existsSync(SECURE_KEY_PATH)) {
  const keyHex = fs.readFileSync(SECURE_KEY_PATH, 'utf8').trim();
  ENCRYPTION_KEY = Buffer.from(keyHex, 'hex');
  console.log(`> Encryption key loaded from secure location: ${SECURE_KEY_PATH}`);
} else if (process.env.ENCRYPTION_KEY) {
  ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
  console.warn('\x1b[33m[SECURITY WARNING] Encryption key loaded from .env file. This is less secure. Please move it to ~/.pulselog_key\x1b[0m');
} else {
  ENCRYPTION_KEY = crypto.randomBytes(32);
  console.log('> Generated new ephemeral encryption key');
}
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return text;
  let iv = crypto.randomBytes(IV_LENGTH);
  let cipher = crypto.createCipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

function decrypt(text) {
  if (!text) return text;
  let textParts = text.split(':');
  let iv = Buffer.from(textParts[0], 'hex');
  let authTag = Buffer.from(textParts[1], 'hex');
  let encryptedText = Buffer.from(textParts[2], 'hex');
  let decipher = crypto.createDecipheriv('aes-256-gcm', ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Middlewares
const authenticateToken = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });

  // Check blacklist
  try {
    const blacklisted = await get('SELECT * FROM jwt_blacklist WHERE token = ?', [token]);
    if (blacklisted) return res.status(401).json({ error: 'Session invalidated' });
  } catch (err) {
    console.error('Blacklist check error', err);
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    req.user = user;
    next();
  });
};

const requireAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: 'Admin access required' });
  }
};


const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

app.prepare().then(async () => {
  await initDB();
  console.log('> SQLite database initialized');

  const server = express();

  // Enhanced security headers - Relax CSP for Next.js + Socket.IO
  server.use(helmet({
    contentSecurityPolicy: false
  }));
  server.use(express.json());
  server.use(cookieParser());

  const sslOptions = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem'))
  };

  const httpServer = https.createServer(sslOptions, server);
  const io = new Server(httpServer);

  // WebSocket Authentication Middleware
  io.use((socket, next) => {
    if (!socket.request.headers.cookie) return next(new Error('Authentication error: No cookies'));
    const cookies = cookie.parse(socket.request.headers.cookie);
    if (!cookies.token) return next(new Error('Authentication error: No token'));

    jwt.verify(cookies.token, JWT_SECRET, async (err, decoded) => {
      if (err) return next(new Error('Authentication error: Invalid token'));

      // Check blacklist
      try {
        const blacklisted = await get('SELECT * FROM jwt_blacklist WHERE token = ?', [cookies.token]);
        if (blacklisted) return next(new Error('Authentication error: Session invalidated'));
      } catch (e) { }

      socket.user = decoded;
      next();
    });
  });

  io.on('connection', (socket) => {
    let activeSSH = null;

    socket.on('disconnect_stream', () => {
      if (activeSSH) activeSSH.disconnect();
      activeSSH = null;
    });

    socket.on('request_stream', async ({ serverId, logType, sourceId, searchTerm }) => {
      if (!serverId || !logType || !sourceId) {
        socket.emit('terminal:data', '\x1b[31m[ERROR] Invalid stream request.\x1b[0m\r\n');
        return;
      }

      // Strict Input Sanitization - Allow metadata separators in sourceId
      let cleanSourceId = sourceId;
      if (sourceId.includes('|')) {
        const parts = sourceId.split('|');
        // If the second part is an absolute path, use it
        if (parts[1] && parts[1].startsWith('/')) {
          cleanSourceId = parts[1];
        } else {
          cleanSourceId = parts[0];
        }
      }

      // Strict Input Sanitization - Allow metadata separators but forbid path traversal (..)
      const safeRegex = /^(?!.*\.\.)[a-zA-Z0-9_\.\/|: -]+$/;

      if (!safeRegex.test(logType) || !safeRegex.test(cleanSourceId)) {
        const failedParam = !safeRegex.test(logType) ? `logType (${logType})` : `sourceId (${cleanSourceId})`;
        socket.emit('terminal:data', `\x1b[31m[SECURITY ERROR] Invalid characters in ${failedParam}.\x1b[0m\r\n`);
        return;
      }

      if (searchTerm && (/[\;\&\|\`\$\(\)]/.test(searchTerm) || searchTerm.startsWith('-'))) {
        socket.emit('terminal:data', '\x1b[31m[SECURITY ERROR] Forbidden characters or flag prefix in search.\x1b[0m\r\n');
        return;
      }

      try {
        const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!serverConfig) {
          socket.emit('terminal:data', '\x1b[31m[ERROR] Server not found.\x1b[0m\r\n');
          return;
        }

        if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

        try {
          await dbRun('INSERT INTO audit_logs (userEmail, serverId, serverName, logType, sourceId) VALUES (?, ?, ?, ?, ?)',
            [socket.user.email, serverId, serverConfig.name, logType, sourceId]);
        } catch (auditErr) {
          console.error('Failed to write audit log', auditErr);
        }

        if (activeSSH) activeSSH.disconnect();
        activeSSH = new SSHController(socket);

        const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
        const commandStr = `read-logs ${logType} ${cleanSourceId}${searchTermStr}`;
        activeSSH.connectAndStream(serverConfig, commandStr);

      } catch (err) {
        socket.emit('terminal:data', '\x1b[31m[ERROR] Database lookup failed.\x1b[0m\r\n');
      }
    });

    socket.on('disconnect', () => {
      if (activeSSH) activeSSH.disconnect();
    });
  });

  server.get('/api/auth/verify', async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.json({ authenticated: false });

    // Check blacklist
    try {
      const blacklisted = await get('SELECT * FROM jwt_blacklist WHERE token = ?', [token]);
      if (blacklisted) return res.json({ authenticated: false });
    } catch (e) { }

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.json({ authenticated: false });
      res.json({ authenticated: true, user: { email: user.email, role: user.role } });
    });
  });

  // Microsoft OAuth2 endpoints
  const MS_AUTH_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize`;
  const MS_TOKEN_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

  server.get('/api/auth/microsoft', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' }); // 10 min TTL

    const params = new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID || '',
      response_type: 'code',
      redirect_uri: process.env.REDIRECT_URI || '',
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state: state
    });

    res.redirect(`${MS_AUTH_URL}?${params.toString()}`);
  });

  server.get('/api/auth/microsoft/callback', async (req, res) => {
    const { code, state, error, error_description } = req.query;
    const cookieState = req.cookies.oauth_state;

    res.clearCookie('oauth_state');

    if (error) {
      console.error('[MICROSOFT AUTH PORTAL ERROR]', error, error_description);
      return res.redirect(`/?error=ms_auth_failed`);
    }

    if (!code || !state || state !== cookieState) {
      console.error('[MICROSOFT STATE MISMATCH OR NO CODE]');
      return res.redirect(`/?error=security_mismatch`);
    }

    try {
      // Exchange code for access tokens
      const tokenResponse = await fetch(MS_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.MS_CLIENT_ID || '',
          client_secret: process.env.MS_CLIENT_SECRET || '',
          code: String(code),
          redirect_uri: process.env.REDIRECT_URI || '',
          grant_type: 'authorization_code'
        })
      });

      const tokens = await tokenResponse.json();
      if (!tokens.access_token) {
        console.error('[MICROSOFT TOKEN EXCHANGE FAILED]', tokens);
        return res.redirect(`/?error=token_exchange_failed`);
      }

      // Fetch user profile from Microsoft Graph
      const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.access_token}` }
      });

      const profile = await profileResponse.json();
      const email = profile.mail || profile.userPrincipalName;

      if (!email) {
        console.error('[MICROSOFT EMAIL NOT FOUND IN PROFILE]', profile);
        return res.redirect(`/?error=email_not_found`);
      }

      // Verify the user email exists in SQLite database
      const user = await get('SELECT * FROM users WHERE email = ? COLLATE BINARY', [email]);

      if (user) {
        console.log(`[MICROSOFT LOGIN SUCCESS] User: "${email}" (Role: "${user.role}")`);
        const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
        
        res.cookie('token', token, { 
          httpOnly: true, 
          secure: false, // Set to true if running under standard public HTTPS certs
          sameSite: 'strict', 
          maxAge: 12 * 60 * 60 * 1000 
        });

        res.redirect('/');
      } else {
        console.warn(`[MICROSOFT LOGIN BLOCKED] Non-whitelisted corporate email attempted login: "${email}"`);
        res.redirect(`/?error=unauthorized_email&email=${encodeURIComponent(email)}`);
      }
    } catch (err) {
      console.error('[MICROSOFT CALLBACK EXCEPTION]', err);
      res.redirect(`/?error=ms_server_error`);
    }
  });

  server.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Invalid credentials' });

    console.log(`[LOGIN ATTEMPT] User: "${email}"`);
    const user = await get('SELECT * FROM users WHERE email = ? COLLATE BINARY', [email]);

    if (user && bcrypt.compareSync(password, user.passwordHash)) {
      console.log(`[LOGIN SUCCESS] User: "${email}" (Stored: "${user.email}")`);
      const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
      res.cookie('token', token, { httpOnly: true, secure: false, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 });
      res.json({ success: true, email: user.email, role: user.role });
    } else {
      console.log(`[LOGIN FAILED] User: "${email}" - ${user ? 'Incorrect Password' : 'User Not Found'}`);
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });

  server.post('/api/auth/logout', authenticateToken, async (req, res) => {
    const token = req.cookies.token;
    if (token) {
      const decoded = jwt.decode(token);
      const expiresAt = decoded && decoded.exp ? new Date(decoded.exp * 1000).toISOString() : new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      await dbRun('INSERT INTO jwt_blacklist (token, expiresAt) VALUES (?, ?)', [token, expiresAt]);
    }
    res.clearCookie('token');
    res.json({ success: true });
  });

  // Audit Logs API - ADMIN ONLY
  server.get('/api/audit', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const logs = await all('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 1000');
      res.json(logs);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  server.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const users = await all('SELECT id, email, role, createdAt FROM users');
      const activeEmails = new Set();

      if (typeof io !== 'undefined' && io.fetchSockets) {
        const sockets = await io.fetchSockets();
        for (const s of sockets) {
          if (s.user && s.user.email) {
            activeEmails.add(s.user.email.toLowerCase());
          }
        }
      }

      if (req.user && req.user.email) {
        activeEmails.add(req.user.email.toLowerCase());
      }

      const usersWithStatus = users.map(u => ({
        ...u,
        isOnline: activeEmails.has(u.email.toLowerCase())
      }));

      res.json(usersWithStatus);
    } catch (err) {
      console.error('Failed to retrieve active users:', err);
      res.status(500).json({ error: 'Failed to fetch users' });
    }
  });

  server.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const { email, password, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Username/Email is required' });

    try {
      // Auto-generate a secure random fallback password if none is provided (e.g. for SSO whitelisting)
      const passwordToHash = password || crypto.randomBytes(32).toString('hex');
      const hash = bcrypt.hashSync(passwordToHash, 12);
      await dbRun('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', [email, hash, role || 'viewer']);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'User already exists or database error' });
    }
  });

  server.delete('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    // Prevent deleting self
    if (parseInt(id) === req.user.id) return res.status(400).json({ error: 'You cannot delete your own account' });

    await dbRun('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true });
  });



  server.get('/api/servers', authenticateToken, async (req, res) => {
    const servers = await all('SELECT id, name, host, port, username, createdAt FROM servers');
    res.json(servers);
  });

  server.get('/api/servers/:id', authenticateToken, async (req, res) => {
    try {
      const server = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
      if (!server) return res.status(404).json({ error: 'Server not found' });
      if (server.privateKey) server.privateKey = decrypt(server.privateKey);
      res.json(server);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch server details' });
    }
  });

  server.get('/api/servers/:id/sources', authenticateToken, async (req, res) => {
    try {
      const type = req.query.type || '';
      const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
      if (!serverConfig) return res.status(404).json({ error: 'Not found' });

      if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

      const ssh = new SSHController(null);
      const sources = await ssh.discoverLogSources(serverConfig, type);
      res.json(sources);
    } catch (e) {
      console.error(`[DISCOVERY ERROR] Server ID ${req.params.id}:`, e.message);
      res.status(500).json({ error: e.message || 'Failed to discover log sources' });
    }
  });

  server.post('/api/servers', authenticateToken, requireAdmin, async (req, res) => {
    const { name, host, port, username, privateKey } = req.body;
    try {
      const cleanKey = SSHController.sanitizeKey(privateKey);
      const encryptedKey = encrypt(cleanKey);
      const result = await dbRun('INSERT INTO servers (name, host, port, username, privateKey) VALUES (?, ?, ?, ?, ?)',
        [name, host, port, username, encryptedKey]);
      res.json({ id: result.id });
    } catch (e) {
      res.status(500).json({ error: 'Database insert failed' });
    }
  });

  server.delete('/api/servers/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      await dbRun('DELETE FROM servers WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete server' });
    }
  });

  server.put('/api/servers/:id', authenticateToken, requireAdmin, async (req, res) => {

    const { name, host, port, username, privateKey } = req.body;
    try {
      const cleanKey = SSHController.sanitizeKey(privateKey);
      const encryptedKey = encrypt(cleanKey);
      await dbRun('UPDATE servers SET name = ?, host = ?, port = ?, username = ?, privateKey = ? WHERE id = ?',
        [name, host, port, username, encryptedKey, req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Database update failed' });
    }
  });

  server.post('/api/servers/test', authenticateToken, requireAdmin, async (req, res) => {
    const { host, port, username, privateKey } = req.body;
    try {
      const result = await SSHController.testConnection({ host, port, username, privateKey });
      res.json(result);
    } catch (e) {
      res.status(500).json({ success: false, error: 'Internal testing error' });
    }
  });

  // Next.js Catch-all
  server.use((req, res) => handle(req, res));

  httpServer.listen(port, hostname, (err) => {
    if (err) throw err;
    console.log(`> Secure log viewer ready on http://${hostname}:${port}`);
  });

  // Database Backup and Pruning Routine (Every 24 hours)
  const backupDir = path.resolve(__dirname, 'data/backups');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

  const runMaintenance = async () => {
    // 1. Prune Old Audit Logs (older than 90 days)
    try {
      const result = await dbRun("DELETE FROM audit_logs WHERE timestamp < datetime('now', '-90 days')");
      if (result.changes > 0) console.log(`> Maintenance: Pruned ${result.changes} old audit logs.`);
    } catch (e) {
      console.error('> Maintenance Error: Failed to prune audit logs', e);
    }

    // 2. Backup Database
    const dbFile = path.resolve(__dirname, 'data/database.sqlite');
    if (fs.existsSync(dbFile)) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(backupDir, `database-${timestamp}.sqlite`);
      fs.copyFileSync(dbFile, backupFile);
      console.log(`> Maintenance: Database backup created at ${backupFile}`);

      // 3. Prune Old Backups (older than 7 days)
      const files = fs.readdirSync(backupDir);
      const now = Date.now();
      files.forEach(file => {
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 7 * 24 * 60 * 60 * 1000) {
          fs.unlinkSync(filePath);
        }
      });
    }
  };

  // Run once on startup, then every 24 hours
  runMaintenance();
  setInterval(runMaintenance, 24 * 60 * 60 * 1000);

  // --- REAL-TIME DOCKER EVENT WATCHER ---
  const { spawn: spawnChild } = require('child_process');
  let dockerWatcher = null;

  const startDockerWatcher = () => {
    if (dockerWatcher) return;

    console.log('> Initializing real-time Docker event watcher...');
    dockerWatcher = spawnChild('docker', ['events', '--format', '{{json .}}', '--filter', 'type=container']);

    dockerWatcher.stdout.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        try {
          const event = JSON.parse(line);
          // Broadcast to all connected clients
          io.emit('docker_event', {
            action: event.Action,
            id: event.id,
            name: event.Actor?.Attributes?.name,
            time: event.time
          });
        } catch (e) { }
      });
    });

    dockerWatcher.stderr.on('data', (data) => {
      console.error(`[DOCKER WATCHER ERROR] ${data.toString()}`);
    });

    dockerWatcher.on('close', (code) => {
      console.log(`> Docker event watcher exited (code ${code}). Restarting in 5s...`);
      dockerWatcher = null;
      setTimeout(startDockerWatcher, 5000);
    });
  };

  // Check if docker is available before starting
  const { exec: execCheck } = require('child_process');
  execCheck('docker ps', (err) => {
    if (!err) startDockerWatcher();
    else console.warn('> Docker not found or permission denied. Real-time local events disabled.');
  });

}).catch((ex) => {
  console.error(ex.stack);
  process.exit(1);
});
