require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
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


const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

// Security Configuration
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

// Load encryption key from a secure location if possible
const SECURE_KEY_PATH = process.env.SECURE_KEY_PATH || path.join(process.env.HOME || '/home/kamalesh', '.pulselog_key');
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

  // Basic security headers, Content Security Policy is disabled for dev/Next.js default compatibility
  server.use(helmet({ contentSecurityPolicy: false }));
  server.use(express.json());
  server.use(cookieParser());

  const httpServer = createServer(server);
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
      } catch (e) {}

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

      const safeRegex = /^[a-zA-Z0-9_\.\/|: -]+$/;

      if (!safeRegex.test(logType) || !safeRegex.test(cleanSourceId)) {
        const failedParam = !safeRegex.test(logType) ? `logType (${logType})` : `sourceId (${cleanSourceId})`;
        socket.emit('terminal:data', `\x1b[31m[SECURITY ERROR] Invalid characters in ${failedParam}.\x1b[0m\r\n`);
        return;
      }
      if (searchTerm && /[\;\&\|\`\$\(\)]/.test(searchTerm)) {
        socket.emit('terminal:data', '\x1b[31m[SECURITY ERROR] Shell metacharacters forbidden in search.\x1b[0m\r\n');
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
    } catch (e) {}

    jwt.verify(token, JWT_SECRET, (err, user) => {
      if (err) return res.json({ authenticated: false });
      res.json({ authenticated: true, user: { email: user.email, role: user.role } });
    });
  });

  server.post('/api/auth/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Invalid credentials' });
    
    const normalizedEmail = email.toLowerCase();
    const user = await get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

    if (user && bcrypt.compareSync(password, user.passwordHash)) {
      const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });
      res.cookie('token', token, { httpOnly: true, secure: !dev, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 });
      res.json({ success: true, email: user.email, role: user.role });
    } else {
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

  // User Management APIs - ADMIN ONLY
  server.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const users = await all('SELECT id, email, role, createdAt FROM users');
    res.json(users);
  });

  server.post('/api/users', authenticateToken, requireAdmin, async (req, res) => {
    const { email, password, role } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'User and password required' });
    
    try {
      const normalizedEmail = email.toLowerCase();
      const hash = bcrypt.hashSync(password, 12);
      await dbRun('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', [normalizedEmail, hash, role || 'viewer']);
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

    httpServer.listen(port, (err) => {
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
  }).catch((ex) => {
    console.error(ex.stack);
    process.exit(1);
  });
