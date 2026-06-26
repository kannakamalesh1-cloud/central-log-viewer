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

SSHController.setDecryptFunction(decrypt);

/**
 * Reads ADMIN_EMAILS directly from the .env file on disk every time it is called.
 * This allows changes to .env to take effect without restarting the server.
 */
function readAdminEmailsFromDisk() {
  try {
    const envPath = path.join(__dirname, '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ADMIN_EMAILS=')) {
        const value = trimmed.slice('ADMIN_EMAILS='.length).trim();
        return value
          .split(',')
          .map(e => e.trim().toLowerCase())
          .filter(Boolean);
      }
    }
  } catch (e) {
    console.error('[ADMIN_EMAILS] Failed to read .env from disk:', e.message);
  }
  return [];
}

/**
 * Reads ALLOWED_DOMAINS directly from the .env file on disk every time it is called.
 * Any Microsoft account whose email domain matches will be auto-provisioned as a Viewer.
 */
function readAllowedDomainsFromDisk() {
  try {
    const envPath = path.join(__dirname, '.env');
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('ALLOWED_DOMAINS=')) {
        const value = trimmed.slice('ALLOWED_DOMAINS='.length).trim();
        return value
          .split(',')
          .map(d => d.trim().toLowerCase())
          .filter(Boolean);
      }
    }
  } catch (e) {
    console.error('[ALLOWED_DOMAINS] Failed to read .env from disk:', e.message);
  }
  return [];
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

  jwt.verify(token, JWT_SECRET, async (err, user) => {
    if (err) return res.status(403).json({ error: 'Forbidden' });
    try {
      const dbUser = await get('SELECT id, email, role FROM users WHERE id = ?', [user.id]);
      if (!dbUser) return res.status(401).json({ error: 'User no longer exists' });
      req.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role };
    } catch (e) {
      req.user = user;
    }
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

const { execSync } = require('child_process');
const KEY_DIR = path.join(__dirname, 'data', 'keys');
const PRIVATE_KEY_PATH = path.join(KEY_DIR, 'master_id_ed25519');
const PUBLIC_KEY_PATH = path.join(KEY_DIR, 'master_id_ed25519.pub');

function ensureMasterKeyPair() {
  if (!fs.existsSync(KEY_DIR)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
  }
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.log('> Master SSH Key not found. Generating a secure Ed25519 pair...');
    try {
      execSync(`ssh-keygen -t ed25519 -N "" -f "${PRIVATE_KEY_PATH}"`, { stdio: 'pipe' });
      console.log('> Master Ed25519 SSH Key Pair generated successfully.');
    } catch (e) {
      console.error('> Failed to generate Ed25519 Master Key via ssh-keygen:', e.message);
      try {
        execSync(`ssh-keygen -t rsa -b 4096 -N "" -f "${PRIVATE_KEY_PATH}"`, { stdio: 'pipe' });
        console.log('> Master RSA SSH Key Pair generated successfully.');
      } catch (rsaErr) {
        console.error('> Critical: Failed to generate Master SSH Key pair:', rsaErr.message);
      }
    }
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

app.prepare().then(async () => {
  await initDB();
  console.log('> SQLite database initialized');
  ensureMasterKeyPair();

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

      try {
        const dbUser = await get('SELECT id, email, role FROM users WHERE id = ?', [decoded.id]);
        if (!dbUser) return next(new Error('Authentication error: User no longer exists'));
        socket.user = { id: dbUser.id, email: dbUser.email, role: dbUser.role };
      } catch (e) {
        socket.user = decoded;
      }
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
      let commandStr;

      if (logType === 'k8s-file' && sourceId.includes('|')) {
        // Pod file: sourceId = "namespace/podname|/path/to/file.log" or "namespace/podname|container_name|/path/to/file.log"
        const parts = sourceId.split('|');
        if (parts.length === 3) {
          const [podId, containerName, filePath] = parts;
          const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
          commandStr = `read-pod-file ${podId} ${filePath} --container ${containerName}${searchTermStr}`;
          cleanSourceId = `${podId} ${filePath} ${containerName}`; // for validation
        } else {
          const [podId, filePath] = parts;
          const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
          commandStr = `read-pod-file ${podId} ${filePath}${searchTermStr}`;
          cleanSourceId = `${podId} ${filePath}`; // for validation
        }
      } else if (logType === 'k8s-container' && sourceId.includes('|')) {
        // Pod container: sourceId = "namespace/podname|container_name"
        const [podId, containerName] = sourceId.split('|');
        const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
        commandStr = `read-pod-container ${podId} ${containerName}${searchTermStr}`;
        cleanSourceId = `${podId} ${containerName}`; // for validation
      } else if (logType === 'docker-file' && sourceId.includes('|')) {
        // Container file: sourceId = "container_name|/path/to/file.log"
        const [containerName, filePath] = sourceId.split('|');
        const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
        commandStr = `read-container-file ${containerName} ${filePath}${searchTermStr}`;
        cleanSourceId = `${containerName} ${filePath}`; // for validation
      } else if (sourceId.includes('|')) {
        const parts = sourceId.split('|');
        if (parts[1] && parts[1].startsWith('/')) {
          cleanSourceId = parts[1];
        } else {
          cleanSourceId = parts[0];
        }
      }

      // Strict Input Sanitization - Allow metadata separators but forbid path traversal (..) and shell pipe
      const safeRegex = /^(?!.*\.\.)[a-zA-Z0-9_\.\/: -]+$/;

      if (!safeRegex.test(logType) || !safeRegex.test(cleanSourceId)) {
        const failedParam = !safeRegex.test(logType) ? `logType (${logType})` : `sourceId (${cleanSourceId})`;
        socket.emit('terminal:data', `\x1b[31m[SECURITY ERROR] Invalid characters in ${failedParam}.\x1b[0m\r\n`);
        return;
      }

      if (searchTerm && (/[\;\&\|\`\$\(\)\<\>\\\{\}]/.test(searchTerm) || searchTerm.startsWith('-'))) {
        socket.emit('terminal:data', '\x1b[31m[SECURITY ERROR] Forbidden characters or flag prefix in search.\x1b[0m\r\n');
        return;
      }

      try {
        const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
        if (!serverConfig) {
          socket.emit('terminal:data', '\x1b[31m[ERROR] Server not found.\x1b[0m\r\n');
          return;
        }

        if (socket.user.role !== 'admin') {
          const hasAccess = await get(`
            SELECT 1 FROM servers s
            INNER JOIN server_group_members sgm ON sgm.serverId = s.id
            INNER JOIN user_group_access uga ON uga.groupId = sgm.groupId
            WHERE s.id = ? AND uga.userId = ?
          `, [serverId, socket.user.id]);
          if (!hasAccess) {
            socket.emit('terminal:data', '\x1b[31m[ERROR] Access Denied: You do not have permission to access this server.\x1b[0m\r\n');
            return;
          }
        }

        try {
          await dbRun('INSERT INTO audit_logs (userEmail, serverId, serverName, logType, sourceId) VALUES (?, ?, ?, ?, ?)',
            [socket.user.email, serverId, serverConfig.name, logType, sourceId]);
        } catch (auditErr) {
          console.error('Failed to write audit log', auditErr);
        }

        if (activeSSH) activeSSH.disconnect();
        activeSSH = new SSHController(socket);

        if (!commandStr) {
          const searchTermStr = searchTerm ? ` ${searchTerm}` : '';
          commandStr = `read-logs ${logType} ${cleanSourceId}${searchTermStr}`;
        }
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

    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) return res.json({ authenticated: false });

      // Always fetch the current role from DB so role changes take effect immediately on refresh
      // without requiring the user to log out and back in
      try {
        const dbUser = await get('SELECT id, email, role FROM users WHERE id = ?', [decoded.id]);
        if (!dbUser) return res.json({ authenticated: false }); // User was deleted

        res.json({ authenticated: true, user: { email: dbUser.email, role: dbUser.role } });
      } catch (e) {
        // Fallback to JWT role if DB query fails
        res.json({ authenticated: true, user: { email: decoded.email, role: decoded.role } });
      }
    });
  });

  // Microsoft OAuth2 endpoints
  const MS_AUTH_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/authorize`;
  const MS_TOKEN_URL = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;

  server.get('/api/auth/microsoft', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, { httpOnly: true, secure: true, maxAge: 10 * 60 * 1000, sameSite: 'lax' }); // 10 min TTL

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

      // Read ADMIN_EMAILS and ALLOWED_DOMAINS live from .env (no restart needed after edits)
      const adminEmails = readAdminEmailsFromDisk();
      const allowedDomains = readAllowedDomainsFromDisk();
      const emailLower = email.toLowerCase();
      const emailDomain = emailLower.split('@')[1] || '';

      const isAdminEmail = adminEmails.includes(emailLower);
      const isAllowedDomain = allowedDomains.includes(emailDomain);

      // Check if user already exists in the DB
      let user = await get('SELECT * FROM users WHERE email = ? COLLATE NOCASE', [email]);

      if (isAdminEmail) {
        // Auto-provision or promote to admin if email is in ADMIN_EMAILS
        if (!user) {
          const hash = require('bcrypt').hashSync(require('crypto').randomBytes(32).toString('hex'), 10);
          const result = await dbRun('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', [email, hash, 'admin']);
          user = { id: result.id, email, role: 'admin' };
          console.log(`[MICROSOFT ADMIN AUTO-PROVISIONED] "${email}" added as admin.`);
        } else if (user.role !== 'admin') {
          await dbRun('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id]);
          user = { ...user, role: 'admin' };
          console.log(`[MICROSOFT ADMIN PROMOTED] "${email}" elevated to admin.`);
        }
      } else if (isAllowedDomain) {
        // Auto-provision as Viewer if email domain is in ALLOWED_DOMAINS
        if (!user) {
          const hash = require('bcrypt').hashSync(require('crypto').randomBytes(32).toString('hex'), 10);
          const result = await dbRun('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', [email, hash, 'viewer']);
          user = { id: result.id, email, role: 'viewer' };
          console.log(`[MICROSOFT VIEWER AUTO-PROVISIONED] "${email}" added as viewer (domain: ${emailDomain}).`);
        }
      } else {
        // Domain not allowed — block login and remove from DB if somehow they exist
        if (user && user.role === 'admin') {
          await dbRun('DELETE FROM users WHERE id = ?', [user.id]);
          user = null;
          console.log(`[MICROSOFT LOGIN BLOCKED] "${email}" removed from DB — no longer in ADMIN_EMAILS and domain not allowed.`);
        } else if (user) {
          user = null; // Existing viewer from a now-blocked domain — deny access
        }
      }

      if (user) {
        console.log(`[MICROSOFT LOGIN SUCCESS] User: "${email}" (Role: "${user.role}")`);
        const token = jwt.sign({ id: user.id, role: user.role, email: user.email }, JWT_SECRET, { expiresIn: '12h' });

        res.cookie('token', token, {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 12 * 60 * 60 * 1000
        });

        res.redirect('/');
      } else {
        console.warn(`[MICROSOFT LOGIN BLOCKED] Unauthorized email attempted login: "${email}"`);
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
      res.cookie('token', token, { httpOnly: true, secure: true, sameSite: 'strict', maxAge: 12 * 60 * 60 * 1000 });
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

  // 2. SRE Memory-Safe LRU Diagnostic Cache
  const diagnosticCache = new Map();
  const CACHE_CLEANUP_INTERVAL = 60000; // 1 minute

  // Periodically clean up expired cache entries to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [key, value] of diagnosticCache.entries()) {
      if (now > value.expiresAt) {
        diagnosticCache.delete(key);
      }
    }
  }, CACHE_CLEANUP_INTERVAL);

  // 3. SRE Semantic Log Pruning Helper (Maximizes token density and removes noise)
  function pruneLogs(logText) {
    if (!logText) return '';
    const lines = String(logText).split('\n');
    const prunedLines = lines.filter(line => {
      const trimmed = line.trim();
      if (!trimmed) return false;

      // Filter out high-frequency successful static asset and health check traffic
      if (/\/(healthz|health|ping|status)\b.*200/i.test(trimmed)) return false;
      if (/\.(css|js|png|jpe?g|gif|svg|ico|woff2?|map)\b.*(200|304)/i.test(trimmed)) return false;
      
      return true;
    });
    
    return prunedLines.join('\n');
  }

  // Groq Error Spike Analysis API (Free — Llama 3.3 70B)
  server.post('/api/analyze-error', authenticateToken, async (req, res) => {

    const { logs } = req.body;
    if (!logs) {
      return res.status(400).json({ error: 'Logs are required' });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Groq API key is not configured. Add GROQ_API_KEY to .env' });
    }

    // Prune logs of noise to optimize token usage and generate cache hash
    const cleanedLogs = pruneLogs(logs);

    // Generate unique hash of the cleaned logs
    const crypto = require('crypto');
    const logHash = crypto.createHash('sha256').update(cleanedLogs).digest('hex');

    // Check LRU Cache
    const cachedResponse = diagnosticCache.get(logHash);
    if (cachedResponse && Date.now() < cachedResponse.expiresAt) {
      console.log('[SRE Cache] Serving diagnostic report from memory cache.');
      return res.json(cachedResponse.data);
    }

    // 1. JavaScript Severity Scoring Engine (Weighted Multi-Factor Heuristic)
    function calculateSeverity(logText) {
      const logs = String(logText);
      let score = 0;

      // Tier A: Catastrophic System & Container Events (+50 to +60)
      if (/OOMKilled|Out of memory/i.test(logs)) {
        score += 60;
      }
      if (/Segmentation fault|SIGSEGV|kernel panic|OOM\s*kill/i.test(logs)) {
        score += 60;
      }
      if (/CrashLoopBackOff/i.test(logs)) {
        score += 50;
      }

      // Tier B: Critical Server & Thread Failures (+40)
      if (/WORKER TIMEOUT/i.test(logs)) {
        score += 40;
      }
      if (/SIGKILL.*Perhaps out of memory/i.test(logs)) {
        score += 15; // Unconfirmed/suggestive signal
      }
      if (/Failed to connect|Connection refused/i.test(logs)) {
        score += 15;
      }

      // Tier C: General Application Errors & Exceptions (+5 to +8 per instance)
      // Uses lookaheads to ignore healthy metrics (e.g., "failed=0", "errors=0")
      const errorMatches = (logs.match(/\berror(s)?(?!s?[:=]\s*(0|false)\b)\b/gi) || []).length;
      const failedMatches = (logs.match(/\bfailed(?![:=]\s*(0|false)\b)\b/gi) || []).length;
      const exceptionMatches = (logs.match(/\bexception\b/gi) || []).length;
      score += errorMatches * 5;
      score += failedMatches * 5;
      score += exceptionMatches * 8;

      // Tier D: Bad Requests, Client Errors, and Parser Warnings (+1 to +3)
      if (/request parse error/i.test(logs)) {
        score += 3;
      }
      if (/\b404\b/.test(logs)) {
        score += 2;
      }
      if (/telemetry.*Failed/i.test(logs)) {
        score += 1;
      }

      // Tier E: General warnings (+3 per instance)
      const warningMatches = (logs.match(/\b(UserWarning|DeprecationWarning|Warning|WARN)\b/gi) || []).length;
      score += warningMatches * 3;

      // Tier F: Healthy Signals & Success Discounts (-0.5 per success log)
      // High volume of healthy traffic actively discounts the severity, preventing false positives
      const success200 = (logs.match(/ 200 /g) || []).length;
      const success201 = (logs.match(/ 201 /g) || []).length;
      const successOk = (logs.match(/\b(success|ok|passed)(?![:=]\s*(0|false)\b)\b/gi) || []).length;
      score -= success200 * 0.5;
      score -= success201 * 0.5;
      score -= successOk * 0.5;

      // Prevent Warning Floods from escalating to HIGH/CRITICAL if there are no errors/failures
      const hasCriticalSignals = /OOMKilled|Out of memory|Segmentation fault|SIGSEGV|kernel panic|OOM\s*kill|CrashLoopBackOff/i.test(logs);
      const hasServerFailures = /WORKER TIMEOUT|Failed to connect|Connection refused/i.test(logs);
      const hasErrorsOrExceptions = errorMatches > 0 || failedMatches > 0 || exceptionMatches > 0;

      if (!hasCriticalSignals && !hasServerFailures && !hasErrorsOrExceptions) {
        // Cap the score at 39 (maximum MEDIUM severity) if no actual errors or failures exist
        if (score >= 40) {
          score = 39;
        }
      }

      // Severity Mapping
      if (score >= 80)
        return "CRITICAL";
      if (score >= 40)
        return "HIGH";
      if (score >= 10)
        return "MEDIUM";
      if (score > 0)
        return "LOW";
      
      return "INFO"; // Perfect operational state
    }

    // 2. JavaScript Category Detector
    function detectCategory(logText) {
      const logStr = String(logText);

      if (/firestore/i.test(logStr))
        return "DEPENDENCY";

      if (/postgres|mysql|redis|mongodb/i.test(logStr))
        return "DATABASE";

      if (/docker/i.test(logStr))
        return "DOCKER";

      if (/CrashLoopBackOff|kubectl|pod/i.test(logStr))
        return "KUBERNETES";

      if (/nginx|502|504/i.test(logStr))
        return "WEB";

      if (/ssh|permission denied|auth/i.test(logStr))
        return "SECURITY";

      return "APPLICATION";
    }

    // Heuristic Helper to analyze security states based on log patterns
    // This state machine classifies logs into one of three enterprise SOC security tiers:
    // 1. COMPROMISED: Active attack payloads (RCE/shell) or successful access (200/201) to sensitive paths.
    // 2. SUSPICIOUS: Probes to sensitive paths resulting in 3xx redirects (potential data exposure).
    // 3. PROTECTED: Automated scans to sensitive paths successfully blocked by Nginx/app (401/403/404).
    function evaluateSecurityState(logText) {
      const logs = String(logText);

      // 1. Critical Attack Indicators (RCE, Shell execution, Privilege Escalation)
      // Any presence of these signatures represents an active threat attempt and must never be classified as routine.
      const CRITICAL_ATTACK_REGEX = /\/bin\/sh\b|bash\s+-c\b|curl\s+[^|]*\|\s*sh\b|sudo\s+|chmod\s+(?:[0-7]{3,4}|[+-][rwx]+)\s+|nc\s+-e\b|python\s+-c\b|eval\(\s*|exec\(\s*/i;
      if (CRITICAL_ATTACK_REGEX.test(logs)) {
        return 'COMPROMISED';
      }

      // 2. Expanded Sensitive Path Signatures
      const SENSITIVE_PATH_REGEX = /\.(env|git|config|bak|ini|sql|zip|tar|gz|rar|log)\b|wp-admin|wp-login|phpmyadmin|admin|setup|config|backup|secrets|credential|etc\/passwd|id_rsa|docker-compose|kubeconfig|jenkins|grafana|prometheus/i;

      let hasSensitiveSuccess = false;
      let hasSensitiveRedirect = false;
      
      const lines = logs.split('\n');
      for (const line of lines) {
        const isTarget = SENSITIVE_PATH_REGEX.test(line);
        if (isTarget) {
          // 200/201 indicates the secret was successfully exposed!
          if (/\b(200|201)\b/.test(line)) {
            hasSensitiveSuccess = true;
          }
          // Redirects (301, 302, 307, 308) are highly suspicious as they may route to exposed static directories.
          if (/\b(301|302|307|308)\b/.test(line)) {
            hasSensitiveRedirect = true;
          }
        }
      }

      if (hasSensitiveSuccess) {
        return 'COMPROMISED';
      }
      
      if (hasSensitiveRedirect) {
        return 'SUSPICIOUS';
      }

      // Check if it qualifies as a Protected Blocked Scan
      // Hard signals of system failures, active crashes, or tracebacks must fall back to standard error handling.
      const hasCrashes = /OOMKilled|Out of memory|Segmentation fault|SIGSEGV|kernel panic|OOM\s*kill|CrashLoopBackOff|WORKER TIMEOUT/i.test(logs);
      const errorCount = (logs.match(/\berror(s)?(?!s?[:=]\s*(0|false)\b)\b/gi) || []).length;
      const exceptionCount = (logs.match(/\bexception\b/gi) || []).length;
      const tracebackCount = (logs.match(/\btraceback\b/gi) || []).length;

      if (hasCrashes || errorCount > 3 || exceptionCount > 0 || tracebackCount > 0) {
        return 'STANDARD_ERROR';
      }

      // Count HTTP status codes for blocked scans
      const blocked401 = (logs.match(/\b401\b/g) || []).length;
      const blocked403 = (logs.match(/\b403\b/g) || []).length;
      const blocked404 = (logs.match(/\b404\b/g) || []).length;
      const blocked400 = (logs.match(/\b400\b/g) || []).length;
      const totalBlocked = blocked401 + blocked403 + blocked404 + blocked400;

      const success200 = (logs.match(/\b200\b/g) || []).length;
      const success201 = (logs.match(/\b201\b/g) || []).length;
      const success304 = (logs.match(/\b304\b/g) || []).length;
      const totalSuccess = success200 + success201 + success304;

      const totalRequests = totalBlocked + totalSuccess;
      const hasScannerTargets = SENSITIVE_PATH_REGEX.test(logs);

      if (totalBlocked > 0) {
        if (hasScannerTargets && totalSuccess === 0) return 'PROTECTED';
        if (totalRequests > 0 && (totalBlocked / totalRequests) >= 0.8) return 'PROTECTED';
      }

      return 'STANDARD_ERROR';
    }

    const securityState = evaluateSecurityState(logs);
    let severity, category, incident, confidence;

    if (securityState === 'COMPROMISED') {
      severity = 'CRITICAL';
      category = 'SECURITY';
      incident = true;
      confidence = 95;
    } else if (securityState === 'SUSPICIOUS') {
      severity = 'MEDIUM';
      category = 'SECURITY';
      incident = true;
      confidence = 90;
    } else if (securityState === 'PROTECTED') {
      severity = 'LOW';
      category = 'SECURITY';
      incident = false;
      confidence = 95;
    } else {
      // Standard Heuristic Evaluation
      severity = calculateSeverity(logs);
      category = detectCategory(logs);
      incident = severity === 'HIGH' || severity === 'CRITICAL';
      confidence = severity === 'INFO' ? 98 : severity === 'LOW' ? 95 : severity === 'MEDIUM' ? 90 : 85;
    }
    
    let systemPrompt = '';

    // 3. Dynamic System Prompt Router (Standardized SRE Structures)
    if (securityState === 'PROTECTED') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE) and Security Operations (SecOps) specialist.
Your job is to analyze the provided log snippet and generate a professional, objective "Security Event Report".

The logs indicate that your application or reverse proxy successfully rejected unauthorized requests or automated reconnaissance scanning. The system is working exactly as designed and has protected your assets.

Format your response EXACTLY like this:
## 🛡️ Security Event Report
### Status: Protected
### Severity: LOW
### Category: SECURITY / RECONNAISSANCE
### Active Incidents: No

You MUST write the status EXACTLY as "Protected", severity EXACTLY as "LOW", and active incidents EXACTLY as "No". Do NOT change or override these values under any circumstances, as they are hard-synchronized with the user interface dashboard cards.

---
### Summary
[Provide a clear, objective summary of the blocked access attempts. Explicitly state that all probes were successfully rejected with HTTP 401/403/404 responses, indicating that the system's defenses are active and functioning correctly.]

### Operational Impact
Impact: None.
The application remained fully available and correctly blocked all unauthorized access attempts.
- Evidence of Compromise: NONE
- Authentication Bypass: No evidence in logs
- Data Exposure: No evidence in logs
- Service Degradation: No evidence in logs

### Threat Assessment
Threat Type: Automated reconnaissance / internet scanning
Confidence: HIGH
Evidence: Repeated requests to sensitive resources returning 401/403/404.

### Recommended Hardening
[Provide detailed security hardening suggestions. Recommend industry-standard application-layer rate limiting (like Nginx's "limit_req_zone"), Fail2ban, or Cloudflare WAF configurations.
You MUST provide a configuration modernization example showing a side-by-side or before-and-after comparison.
Use EXACTLY the following format:
# ❌ Deprecated/Weak Config
[Snippet]
# ✅ Hardened/Correct Config
[Snippet]
]

### Investigation Required
The requests originate from external IPs. Do NOT search your application code repository for these paths, as they represent external scanning activity rather than internal code bugs.

Suggested commands to audit the scan origin and volume:
\`\`\`bash
# View Nginx access logs for 401/403 blocks:
grep -E "401|403" /var/log/nginx/*access.log

# Inspect the target of .env probes:
grep ".env" /var/log/nginx/*access.log 2>/dev/null

# Check active connection sockets on the host:
ss -tan | grep -E ":80|:443"
\`\`\`

### Maintenance Priority
LOW. Routine security hardening recommended. No emergency action required.

### Evidence Quality
Evidence Strength: HIGH
Reason:
- Clear logs showing HTTP 401/403/404 rejection codes.
- No evidence of successful authentication or access.
- No tracebacks or internal system errors.

### Confidence
Confidence: 95%
Reason:
- The rejection logs are unambiguous.
- The request pattern matches known automated scanning behaviors.

### Fix Confidence
Fix Confidence: HIGH
Reason:
- Hardening reverse proxies and applying rate limits are well-established, highly effective measures against scanning noise.

### Operator Recommendation
Specify concrete operator actions:
- Verify your Nginx configuration syntax.
- Schedule routine rate-limiting and WAF updates.
- Monitor access logs for elevated volume.`;
    }
    else if (securityState === 'SUSPICIOUS') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE) and Security Operations (SecOps) specialist.
Your job is to analyze the provided log snippet and generate a professional "Suspicious Security Event Report".

The logs indicate that an external client attempted to access highly sensitive paths (like configuration files, admin panels, or credentials), and the server responded with an HTTP 3xx Redirect (301, 302, 307, or 308). In security engineering, redirects of sensitive endpoints are highly suspicious as they may expose secrets if they redirect to an unprotected public directory.

Format your response EXACTLY like this:
## 🛡️ Security Event Report
### Status: Suspicious (Investigate Redirects)
### Severity: MEDIUM
### Category: SECURITY / RECONNAISSANCE
### Active Incidents: Yes

You MUST write the status EXACTLY as "Suspicious (Investigate Redirects)", severity EXACTLY as "MEDIUM", and active incidents EXACTLY as "Yes". Do NOT change or override these values under any circumstances, as they are hard-synchronized with the user interface dashboard cards.

---
### Summary
[Provide a clear, objective summary of the suspicious redirects. Detail which sensitive paths were requested and where they redirect. Note that while the request was not directly answered with a 200, the redirect must be audited to ensure no data exposure occurred.]

### Operational Impact
Impact: Potential Data Exposure.
The system did not return a direct success code, but the redirect behavior represents a potential bypass or exposure risk if the target path is public.
- Evidence of Compromise: UNCONFIRMED (Requires audit)
- Redirect Risk Level: HIGH (Audit redirect target directories)
- Service Degradation: None visible in logs

### Threat Assessment
Threat Type: Suspicious redirection of sensitive paths
Confidence: HIGH
Evidence: HTTP 3xx responses for sensitive resource requests.

### Recommended Hardening
[Provide detailed hardening steps, focusing on:
1. Auditing Nginx redirect rules to ensure they do not expose secrets.
2. Replacing redirects of sensitive paths with a direct "403 Forbidden" or "404 Not Found" response.
3. Implementing Nginx rate-limiting and WAF filters.
Show a before-and-after Nginx configuration block using the # ❌ Deprecated/Weak Config and # ✅ Hardened/Correct Config format.]

### Investigation Required
The requests originate from external IPs seeking sensitive files. Audit your Nginx configuration rules immediately to trace why these paths are redirecting rather than being denied.

Suggested commands to audit your configuration and access logs:
\`\`\`bash
# Search your Nginx configuration files for redirect rules (return 301/302/rewrite):
grep -R -E "301|302|rewrite" /etc/nginx/

# Identify the exact target and volume of the redirect probes:
grep -E "301|302" /var/log/nginx/*access.log | grep -i -E "env|git|admin|config"

# Check active connections:
ss -tan | grep -E ":80|:443"
\`\`\`

### Maintenance Priority
MEDIUM. Prompt investigation of Nginx redirect behavior is recommended.

### Evidence Quality
Evidence Strength: HIGH
Reason:
- Explicit HTTP 3xx redirection codes in response to sensitive resource probes.
- Source IPs are external.

### Confidence
Confidence: 90%
Reason:
- The request paths are clearly targeted at sensitive assets.
- Redirects are confirmed by the logs.

### Fix Confidence
Fix Confidence: HIGH
Reason:
- Changing Nginx rules to return 403 instead of redirecting is simple, safe, and highly effective.

### Operator Recommendation
Specify concrete operator actions:
- Audit Nginx server blocks for loose \`rewrite\` or \`return 301\` rules.
- Change redirects of sensitive paths to a direct \`deny all;\` or \`return 403;\`.
- Reload Nginx and verify via curl.`;
    }
    else if (severity === 'INFO') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE).
Your job is to analyze the provided logs and generate a professional, reassuring "System Health Report".

Format your response EXACTLY like this:
## 🟢 System Health Report
### Status: Operational
### Severity: INFO
### Category: ${category}
### Active Incidents: None

---
### Summary
[Provide a concise 2-3 sentence summary explaining why the system is operating normally and confirming that routine tasks are succeeding.]

### Operational Impact
Impact: None. All services, queues, and background workers are operating normally.

### Why This Is Not An Incident
The following indicators of a critical outage were NOT observed:
- No worker crashes
- No OOM kills
- No restart loops
- No elevated error rates
- No failed health checks
- No service unavailability

### Recommended Maintenance
None. The system is operating within normal parameters.

### Maintenance Priority
None.

### Evidence Quality
Evidence Strength: HIGH
Reason:
- Multiple clean, successful log entries observed.
- No tracebacks, warnings, or errors present in the log snippet.
- Core services executing successfully.

### Confidence
Confidence: ${confidence}%
Reason:
- All services and background workers are executing successfully.
- No warnings, errors, or anomalies are present in the log snippet.

### Fix Confidence
Fix Confidence: HIGH
Reason:
- No maintenance or fixes are required for this healthy state.

### Operator Recommendation
No action required during active operations. All systems are performing normally.`;
    } 
    else if (severity === 'LOW' || severity === 'MEDIUM') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE).
Your job is to analyze the provided logs and generate a professional "Maintenance Recommendation".

Format your response EXACTLY like this:
## 🟡 Maintenance Recommendation
### Status: Operational (Minor Issues Detected)
### Severity: ${severity}
### Category: ${category}
### Active Incidents: None

You MUST write the severity EXACTLY as "${severity}" and active incidents EXACTLY as "None". Do NOT change or override these values under any circumstances, as they are hard-synchronized with the user interface dashboard cards.

---
### Summary
[Provide a brief summary of the warning or deprecation detected in the logs. Note: The logs clearly identify the warning mechanism but do not reveal the exact source file or application code responsible.]

### Operational Impact
Impact: None. This warning does not affect:
- Application availability
- Scheduled tasks or cron jobs
- Core database/queue processing

### Why This Is Not An Incident
The following indicators of a critical outage were NOT observed:
- No worker crashes
- No OOM kills
- No restart loops
- No elevated error rates
- No failed health checks
- No service unavailability

### Suggested Code Modernization
[You MUST provide a code/configuration modernization example showing a side-by-side or before-and-after comparison in the exact language/technology of the log (e.g. JavaScript, Python, SQL, Nginx config, Dockerfile).
Use EXACTLY the following formats:
- For application code warnings:
  # ❌ Old (Deprecated/Unsafe Code)
  [Snippet]
  # ✅ New (Modern/Safe Code)
  [Snippet]
- For database/SQL query warnings:
  # ❌ Old Query
  [Snippet]
  # ✅ Optimized Query
  [Snippet]
- For infrastructure configuration warnings (Nginx, Docker, WAF):
  # ❌ Deprecated/Weak Config
  [Snippet]
  # ✅ Hardened/Correct Config
  [Snippet]

Specific Override Rule:
If (and only if) the logs contain the Python Firestore positional arguments warning, you MUST recommend ONLY the following exact migration example:
# ❌ Old (Deprecated - triggers UserWarning)
query = db.collection("your_collection").where("field_path", "==", "value")

# ✅ New (Warning-free, production-grade)
from google.cloud.firestore import FieldFilter

query = db.collection("your_collection").where(
    filter=FieldFilter("field_path", "==", "value")
)
Do NOT present multiple alternative syntaxes, do NOT suggest query.filter(), and do NOT recommend query.where(field_path, "==", value). Present ONLY this single correct fix. For all other warnings, generate the correct syntax for that specific warning.]

### Investigation Required
The logs indicate that some queries or operations are using deprecated patterns. The exact source file, line number, or application code responsible cannot be determined from logs alone.

Suggested commands to locate the offending code in your repository:
[Provide a list of highly specific, context-appropriate shell commands (using grep, find, npm, pip, etc.) in a \`\`\`bash block to help the operator locate the exact offending code or configuration in their repository based on the error. For example:
- If a Node/npm warning: Suggest 'npm ls' or grep for the package.
- If a Python warning: Suggest grep for the module or function name.
- If Nginx/Docker: Suggest grep or find command for the configuration path.]

### Maintenance Priority
LOW. Can be addressed during routine maintenance. No immediate action required.

### Evidence Quality
Evidence Strength: [Specify HIGH, MEDIUM, or LOW]
Reason:
- [Provide 2-3 bullet points justifying the evidence strength rating based on logs, e.g., "The warning is explicitly present in the logs, identifying the warning mechanism but not the source file."]

### Confidence
Confidence: ${confidence}%
Reason:
- [Evidence 1, e.g., Warning explicitly present in logs]
- [Evidence 2, e.g., All tasks completed successfully without service disruption]

### Fix Confidence
Fix Confidence: MEDIUM-HIGH
Reason:
- Compatible with modern SDK releases. Verify against your project's installed version before deployment.

### Operator Recommendation
No action required during active operations. Schedule this update as part of normal dependency maintenance.`;
    } 
    else if (severity === 'HIGH') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE) and Systems Administrator.
Your job is to analyze the provided log snippet and generate a highly accurate "Root Cause Analysis & Incident Report".

Always follow these SRE analysis guidelines:
1. Objectivity: Do not assume a server is compromised or call activity a "malicious attack" unless there is clear evidence of exploitation (e.g., successful remote code execution payloads or successful auth bypass). Refer to automated probes, scans, or hex packets as "automated reconnaissance, fingerprinting, or scanning activity". Always explicitly state if there is no evidence of successful exploitation in the log snippet.
2. Correct Web Mitigations: Never suggest using "ufw limit" for HTTP/HTTPS web traffic (port 80 or 443), as it causes false positives for multi-asset web loads. Instead, recommend industry-standard application-layer rate limiting (like Nginx's "limit_req_zone"), Fail2ban, or Cloudflare WAF.
3. Production Deployment: If logs show development servers (such as Python's Werkzeug, Node.js raw HTTP, etc.) directly exposed to the internet, always recommend putting a production-grade WSGI/ASGI server (e.g., Gunicorn, uWSGI) behind a reverse proxy (e.g., Nginx, Apache).
4. Protocol Accuracy: Do not recommend changing protocol-level errors (like HTTP 400 Bad Request for bad syntax/versions) to application/authorization errors (like HTTP 403 Forbidden).
5. Avoid Speculative Diagnosis: Do not assume a single fixed cause (such as asserting a package is simply outdated and needs upgrading) when the logs indicate general compatibility, path-resolution conflicts, or dependency tree misalignment. Instead, describe the exact mismatch (the caller file/line and target specifier that failed), outline all plausible scenarios (e.g. version incompatibility, stale build/package cache, or multiple nested package duplicates), and always prioritize verification commands (such as "npm ls <packages>", "pip list", or target dependency checks) as the very first step in the remediation instructions.
6. Evidence Citation: Every major conclusion, claim, or diagnosis must reference the exact log line(s) supporting it under a dedicated "Evidence:" citation (e.g. \`node_modules/@vitejs/plugin-react/dist/index.js:246:33\`). Avoid making diagnoses without attaching the corresponding evidence.
7. Confidence Classification: Every identified root-cause scenario must be assigned a confidence rating using one of the following exact labels:
   - Confirmed: Directly supported by unambiguous log evidence.
   - Highly Likely: Supported by strong indicators/tracebacks but not absolute proof.
   - Possible: A plausible explanation requiring further validation.
   - Speculative: An unproven hypothesis with insufficient log evidence.
8. Root Cause Separation:
   Do not present the immediate failure mechanism as the underlying root cause unless causality is explicitly established by the logs. Always distinguish between: Observed Symptoms, Immediate Failure Mechanism, and Probable Root Causes.
9. Insufficient Evidence Handling:
   If the provided logs do not contain enough information to determine the underlying cause, explicitly state: "The available log evidence is insufficient to establish a confirmed root cause." Then identify the exact additional artifacts required for confirmation.
10. Post-Fix Validation:
    Every remediation path must include validation steps demonstrating whether the issue has been resolved (e.g. npm ls, nginx -t, curl, systemctl status).
11. Diagnostic Priority:
    Recommend actions in the following order: Inspect, Verify, Validate hypotheses, Apply minimal corrective actions, Apply disruptive fixes.
12. Operational Impact Awareness:
    For remediation actions that may affect availability, explicitly note the operational impact.
13. Environment Awareness:
    Infer the execution environment (Docker, Kubernetes, Systemd, Nginx) and tailor recommendations accordingly.
14. Security Severity Classification:
    Classify suspicious activity using the following progression: Automated reconnaissance, Suspicious activity, Attempted exploitation, Successful exploitation, Confirmed compromise. If exploitation cannot be confirmed, explicitly state: "There is no evidence of successful exploitation in the provided logs."
15. Evidence Formatting:
    Every major conclusion must include an Evidence subsection containing the exact supporting log excerpts (Timestamp, Source file/component, Exact log lines).
16. Blocked Attacks Are Not Outages (Severity Evaluation):
    If logs show that the application is successfully rejecting unauthorized requests (e.g., returning 401 Unauthorized, 403 Forbidden, or 400 Bad Request) and there are no signs of service degradation (no worker crashes, no restarts, no timeouts, no latency increase, or health-check failures), you MUST classify this as Severity: LOW or MEDIUM, Category: SECURITY / RECONNAISSANCE, and Active Incidents: No. Do not treat successfully blocked reconnaissance or auth failures as active production incidents.
17. Private Network / Gateway Identification:
    If the immediate source IP of the logs belongs to a private subnet or internal gateway (such as 172.x.x.x Docker bridge, 10.x.x.x Kubernetes pod network, 192.168.x.x, or 127.0.0.1), you MUST explicitly state in your analysis that this IP represents an internal proxy, container bridge, or gateway rather than the external client IP. Explicitly advise the operator against blocking this gateway IP directly at the firewall to avoid self-inflicted service outages.
18. Ban Speculative Performance Impact:
    Do not make speculative statements about performance degradation (e.g., 'this could lead to increased resource utilization' or 'potentially degrade performance') unless there is concrete evidence of system strain (OOMs, CPU spikes, slow responses, worker timeouts) in the provided logs. If no service degradation is visible, explicitly state: 'No service degradation is visible in the provided logs. The application successfully rejected unauthorized requests as expected.'

Format your response EXACTLY like this:
## 🔴 Root Cause Analysis & Incident Report
### Status: Degraded / Failure
### Severity: ${severity}
### Category: ${category}
### Active Incidents: Yes

You MUST write the severity EXACTLY as "${severity}" and active incidents EXACTLY as "Yes". Do NOT change or override these values under any circumstances, as they are hard-synchronized with the user interface dashboard cards.

---
### Summary
[Provide a clear, objective summary of the incident, including observed symptoms and immediate failure mechanism.]

### Operational Impact
[State the exact operational impact on users, services, and queues.]

### Recommended Maintenance
[Provide the detailed corrective action, rate limit configurations, or code fixes. Avoid presenting multiple contradictory fixes; present only the most optimal and validated path.
You MUST provide a code/configuration modernization example showing a side-by-side or before-and-after comparison in the exact language/technology of the log (e.g. JavaScript, Python, SQL, Nginx config, Dockerfile).
Use EXACTLY the following formats:
- For application code bugs/crashes:
  # ❌ Old (Unsafe/Buggy Code)
  [Snippet]
  # ✅ New (Corrected/Safe Code)
  [Snippet]
- For database/SQL query errors:
  # ❌ Old Query
  [Snippet]
  # ✅ Optimized Query
  [Snippet]
- For infrastructure/network issues (Nginx, Docker, WAF):
  # ❌ Deprecated/Weak Config
  [Snippet]
  # ✅ Hardened/Correct Config
  [Snippet]

Specific Security Rule:
If the logs represent automated reconnaissance (e.g., WAF blocks, scanners probing endpoints like /wp-admin, /env, /backup), do NOT suggest application code changes. Instead, focus the mitigation on WAF rules, Nginx rate-limiting (limit_req_zone), or Fail2ban setups.

Specific Override Rule:
If (and only if) the logs contain the Python Firestore positional arguments warning, you MUST recommend ONLY the following exact migration example:
# ❌ Old (Deprecated - triggers UserWarning)
query = db.collection("your_collection").where("field_path", "==", "value")

# ✅ New (Warning-free, production-grade)
from google.cloud.firestore import FieldFilter

query = db.collection("your_collection").where(
    filter=FieldFilter("field_path", "==", "value")
)
Do NOT present multiple alternative syntaxes, do NOT suggest query.filter(), and do NOT recommend query.where(field_path, "==", value). Present ONLY this single correct fix.]

### Investigation Required
The logs indicate a serious warning or failure. The exact source file, line number, or application code responsible cannot be determined from logs alone.

Suggested commands to locate the offending code in your repository:
[Provide a list of highly specific, context-appropriate shell commands (using grep, find, npm, pip, etc.) in a \`\`\`bash block to help the operator locate the exact offending code or configuration in their repository based on the error. For example:
- If a Node/npm warning: Suggest 'npm ls' or grep for the package.
- If a Python warning: Suggest grep for the module or function name.
- If Nginx/Docker: Suggest grep or find command for the configuration path.]

### Maintenance Priority
HIGH. Action recommended to restore optimal operations.

### Evidence Quality
Evidence Strength: [Must be exactly HIGH, MEDIUM, or LOW]
Reason:
- [Provide 2-3 bullet points justifying the evidence strength rating based on logs]

### Confidence
Confidence: ${confidence}%
Reason:
- [Evidence 1]
- [Evidence 2]

### Fix Confidence
Fix Confidence: [Must be exactly HIGH, MEDIUM, or LOW]
Reason:
- [A brief 1-sentence reason justifying the confidence level of the recommended fix.]

### Operator Recommendation
[Specify concrete operator actions: e.g., check process status, apply minimal corrective actions, reload services, or verify via curl.]

---
### Timeline of Events
[List chronological sequence of events if visible in logs]

### Technical Analysis
#### Confidence Levels
- **CONFIRMED**:
  - [List facts directly supported by unambiguous log evidence, e.g., worker timeouts, worker restarts, malformed requests, no successful exploitation]
- **HIGHLY LIKELY**:
  - [List strong inferences supported by tracebacks/indicators, e.g., service degradation, temporary request failures]
- **POSSIBLE**:
  - [List plausible explanations requiring further validation, e.g., OOM conditions (unconfirmed), slow clients keeping sockets open, proxy/HTTP2 misconfigurations]
- **UNSUPPORTED HYPOTHESES**:
  - [List common causes/theories that are NOT supported by the current logs, e.g., Database deadlocks, DNS failures, Network partitions, Storage corruption, Successful exploitation attempts, explicitly stating they lack evidence in the current logs]

#### Detailed Investigation
- **Observed Symptoms**: [Observed symptoms]
- **Immediate Failure Mechanism**: [Immediate failure mechanism, citing traceback details like sock.recv() during HTTP request parse]
- **Probable Root Causes**: [Probable root causes, distinguishing between slow clients, HTTP/2 mismatch, and memory leaks]
- **Evidence**: [Evidence citations in the format \`filename:line\`]

### Validation Steps
[Specify verification commands to validate the fix and prove/disprove the POSSIBLE items listed above, e.g., \`dmesg -T | grep -i oom\`, checking Nginx access logs, or inspecting Gunicorn configurations.]

### Prevention Strategy
[Outline long-term preventative measures to avoid recurrence]`;
    } 
    else if (severity === 'CRITICAL') {
      systemPrompt = `You are an expert Senior Site Reliability Engineer (SRE) and Systems Administrator.
Your job is to analyze the provided logs and generate an urgent "Emergency Incident Report".
The logs indicate a critical failure, crash, or potential security exploit. Your analysis must be highly precise, authoritative, and focused on rapid mitigation.

Always follow these SRE analysis guidelines:
1. Objectivity: Do not assume a server is compromised or call activity a "malicious attack" unless there is clear evidence of exploitation (e.g., successful remote code execution payloads or successful auth bypass). Refer to automated probes, scans, or hex packets as "automated reconnaissance, fingerprinting, or scanning activity". Always explicitly state if there is no evidence of successful exploitation in the log snippet.
2. Correct Web Mitigations: Never suggest using "ufw limit" for HTTP/HTTPS web traffic (port 80 or 443), as it causes false positives for multi-asset web loads. Instead, recommend industry-standard application-layer rate limiting (like Nginx's "limit_req_zone"), Fail2ban, or Cloudflare WAF.
3. Production Deployment: If logs show development servers (such as Python's Werkzeug, Node.js raw HTTP, etc.) directly exposed to the internet, always recommend putting a production-grade WSGI/ASGI server (e.g., Gunicorn, uWSGI) behind a reverse proxy (e.g., Nginx, Apache).
4. Protocol Accuracy: Do not recommend changing protocol-level errors (like HTTP 400 Bad Request for bad syntax/versions) to application/authorization errors (like HTTP 403 Forbidden).
5. Avoid Speculative Diagnosis: Do not assume a single fixed cause (such as asserting a package is simply outdated and needs upgrading) when the logs indicate general compatibility, path-resolution conflicts, or dependency tree misalignment. Instead, describe the exact mismatch (the caller file/line and target specifier that failed), outline all plausible scenarios (e.g. version incompatibility, stale build/package cache, or multiple nested package duplicates), and always prioritize verification commands (such as "npm ls <packages>", "pip list", or target dependency checks) as the very first step in the remediation instructions.
6. Evidence Citation: Every major conclusion, claim, or diagnosis must reference the exact log line(s) supporting it under a dedicated "Evidence:" citation (e.g. \`node_modules/@vitejs/plugin-react/dist/index.js:246:33\`). Avoid making diagnoses without attaching the corresponding evidence.
7. Confidence Classification: Every identified root-cause scenario must be assigned a confidence rating using one of the following exact labels:
   - Confirmed: Directly supported by unambiguous log evidence.
   - Highly Likely: Supported by strong indicators/tracebacks but not absolute proof.
   - Possible: A plausible explanation requiring further validation.
   - Speculative: An unproven hypothesis with insufficient log evidence.
8. Root Cause Separation:
   Do not present the immediate failure mechanism as the underlying root cause unless causality is explicitly established by the logs. Always distinguish between: Observed Symptoms, Immediate Failure Mechanism, and Probable Root Causes.
9. Insufficient Evidence Handling:
   If the provided logs do not contain enough information to determine the underlying cause, explicitly state: "The available log evidence is insufficient to establish a confirmed root cause." Then identify the exact additional artifacts required for confirmation.
10. Post-Fix Validation:
    Every remediation path must include validation steps demonstrating whether the issue has been resolved (e.g. npm ls, nginx -t, curl, systemctl status).
11. Diagnostic Priority:
    Recommend actions in the following order: Inspect, Verify, Validate hypotheses, Apply minimal corrective actions, Apply disruptive fixes.
12. Operational Impact Awareness:
    For remediation actions that may affect availability, explicitly note the operational impact.
13. Environment Awareness:
    Infer the execution environment (Docker, Kubernetes, Systemd, Nginx) and tailor recommendations accordingly.
14. Security Severity Classification:
    Classify suspicious activity using the following progression: Automated reconnaissance, Suspicious activity, Attempted exploitation, Successful exploitation, Confirmed compromise. If exploitation cannot be confirmed, explicitly state: "There is no evidence of successful exploitation in the provided logs."
15. Evidence Formatting:
    Every major conclusion must include an Evidence subsection containing the exact supporting log excerpts (Timestamp, Source file/component, Exact log lines).
16. Blocked Attacks Are Not Outages (Severity Evaluation):
    If logs show that the application is successfully rejecting unauthorized requests (e.g., returning 401 Unauthorized, 403 Forbidden, or 400 Bad Request) and there are no signs of service degradation (no worker crashes, no restarts, no timeouts, no latency increase, or health-check failures), you MUST classify this as Severity: LOW or MEDIUM, Category: SECURITY / RECONNAISSANCE, and Active Incidents: No. Do not treat successfully blocked reconnaissance or auth failures as active production incidents.
17. Private Network / Gateway Identification:
    If the immediate source IP of the logs belongs to a private subnet or internal gateway (such as 172.x.x.x Docker bridge, 10.x.x.x Kubernetes pod network, 192.168.x.x, or 127.0.0.1), you MUST explicitly state in your analysis that this IP represents an internal proxy, container bridge, or gateway rather than the external client IP. Explicitly advise the operator against blocking this gateway IP directly at the firewall to avoid self-inflicted service outages.
18. Ban Speculative Performance Impact:
    Do not make speculative statements about performance degradation (e.g., 'this could lead to increased resource utilization' or 'potentially degrade performance') unless there is concrete evidence of system strain (OOMs, CPU spikes, slow responses, worker timeouts) in the provided logs. If no service degradation is visible, explicitly state: 'No service degradation is visible in the provided logs. The application successfully rejected unauthorized requests as expected.'

Format your response EXACTLY like this:
## 🔥 Emergency Incident Report
### Status: Critical Outage / Active Exploit
### Severity: ${severity}
### Category: ${category}
### Active Incidents: Yes

You MUST write the severity EXACTLY as "${severity}" and active incidents EXACTLY as "Yes". Do NOT change or override these values under any circumstances, as they are hard-synchronized with the user interface dashboard cards.

---
### Summary
[Provide a high-priority, clear summary of the critical outage or exploit, including the immediate failure mechanism.]

### Operational Impact
[State the exact operational impact (e.g., service downtime, data loss, exposed credentials, blocked users).]

### Recommended Maintenance
[Provide the critical recovery steps, hotfixes, or configuration patches. Avoid presenting multiple contradictory fixes; present only the single most optimal recovery path.
You MUST provide a code/configuration modernization example showing a side-by-side or before-and-after comparison in the exact language/technology of the log (e.g. JavaScript, Python, SQL, Nginx config, Dockerfile).
Use EXACTLY the following formats:
- For application code bugs/crashes:
  # ❌ Old (Unsafe/Buggy Code)
  [Snippet]
  # ✅ New (Corrected/Safe Code)
  [Snippet]
- For database/SQL query errors:
  # ❌ Old Query
  [Snippet]
  # ✅ Optimized Query
  [Snippet]
- For infrastructure/network issues (Nginx, Docker, WAF):
  # ❌ Deprecated/Weak Config
  [Snippet]
  # ✅ Hardened/Correct Config
  [Snippet]

Specific Security Rule:
If the logs represent automated reconnaissance (e.g., WAF blocks, scanners probing endpoints like /wp-admin, /env, /backup), do NOT suggest application code changes. Instead, focus the mitigation on WAF rules, Nginx rate-limiting (limit_req_zone), or Fail2ban setups.

Specific Override Rule:
If (and only if) the logs contain the Python Firestore positional arguments warning, you MUST recommend ONLY the following exact migration example:
# ❌ Old (Deprecated - triggers UserWarning)
query = db.collection("your_collection").where("field_path", "==", "value")

# ✅ New (Warning-free, production-grade)
from google.cloud.firestore import FieldFilter

query = db.collection("your_collection").where(
    filter=FieldFilter("field_path", "==", "value")
)
Do NOT present multiple alternative syntaxes, do NOT suggest query.filter(), and do NOT recommend query.where(field_path, "==", value). Present ONLY this single correct fix.]

### Investigation Required
The logs indicate a critical failure, crash, or exploit. The exact source file, line number, or application code responsible cannot be determined from logs alone.

Suggested commands to locate the offending code in your repository:
[Provide a list of highly specific, context-appropriate shell commands (using grep, find, npm, pip, etc.) in a \`\`\`bash block to help the operator locate the exact offending code or configuration in their repository based on the error. For example:
- If a Node/npm warning: Suggest 'npm ls' or grep for the package.
- If a Python warning: Suggest grep for the module or function name.
- If Nginx/Docker: Suggest grep or find command for the configuration path.]

### Maintenance Priority
CRITICAL. Immediate action required.

### Evidence Quality
Evidence Strength: [Must be exactly HIGH, MEDIUM, or LOW]
Reason:
- [Provide 2-3 bullet points justifying the evidence strength rating based on logs]

### Confidence
Confidence: ${confidence}%
Reason:
- [Evidence 1]
- [Evidence 2]

### Fix Confidence
Fix Confidence: [Must be exactly HIGH, MEDIUM, or LOW]
Reason:
- [A brief 1-sentence reason justifying the confidence level of the recovery patch.]

### Operator Recommendation
[List the immediate mitigation commands the engineer must run right now to stop the bleeding.]

---
### Technical Analysis
#### Confidence Levels
- **CONFIRMED**:
  - [List facts directly supported by unambiguous log evidence, e.g., worker timeouts, worker restarts, malformed requests, no successful exploitation]
- **HIGHLY LIKELY**:
  - [List strong inferences supported by tracebacks/indicators, e.g., service degradation, temporary request failures]
- **POSSIBLE**:
  - [List plausible explanations requiring further validation, e.g., OOM conditions (unconfirmed), slow clients keeping sockets open, proxy/HTTP2 misconfigurations]
- **UNSUPPORTED HYPOTHESES**:
  - [List common causes/theories that are NOT supported by the current logs, e.g., Database deadlocks, DNS failures, Network partitions, Storage corruption, Successful exploitation attempts, explicitly stating they lack evidence in the current logs]

#### Detailed Investigation
- **Observed Symptoms**: [Observed symptoms]
- **Immediate Failure Mechanism**: [Immediate failure mechanism, citing traceback details like sock.recv() during HTTP request parse]
- **Probable Root Causes**: [Probable root causes, distinguishing between slow clients, HTTP/2 mismatch, and memory leaks]
- **Evidence**: [Evidence citations in the format \`filename:line\`]

### Validation Steps
[Specify immediate verification commands to validate recovery and prove/disprove the POSSIBLE items listed above, e.g., \`dmesg -T | grep -i oom\`, checking Nginx access logs, or inspecting Gunicorn configurations.]

### Prevention Strategy
[Outline immediate security hardening or infrastructure scaling measures]`;
    }

    try {
      let response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content: systemPrompt
            },
            {
              role: 'user',
              content: `Analyze this log excerpt and produce a full incident diagnostic report:

\`\`\`
${cleanedLogs}
\`\`\``
            }
          ],
          temperature: 0.1,
          max_tokens: 2048,
          top_p: 1,
          stream: false,
        })
      });

      let isFallbackUsed = false;

      if (!response.ok) {
        const errText = await response.text();
        console.warn('Primary model llama-3.3-70b-versatile failed. Status:', response.status, 'Error:', errText);
        
        let isRateLimit = response.status === 429;
        try {
          const errJson = JSON.parse(errText);
          if (errJson?.error?.message?.toLowerCase().includes('rate limit') || errJson?.error?.code === 'rate_limit_exceeded') {
            isRateLimit = true;
          }
        } catch (_) {}

        if (isRateLimit) {
          console.warn('Triggering auto-fallback to high-capacity model llama-3.1-8b-instant...');
          isFallbackUsed = true;
          response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: 'llama-3.1-8b-instant',
              messages: [
                {
                  role: 'system',
                  content: systemPrompt
                },
                {
                  role: 'user',
                  content: `Analyze this log excerpt and produce a full incident diagnostic report:

\`\`\`
${cleanedLogs}
\`\`\``
                }
              ],
              temperature: 0.1,
              max_tokens: 2048,
              top_p: 1,
              stream: false,
            })
          });
        }
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error('Groq API Error (after fallback check):', errText);
        let friendlyError = 'Failed to communicate with Groq API';
        try {
          const errJson = JSON.parse(errText);
          const detail = errJson?.error?.message;
          if (detail) friendlyError = `Groq: ${detail}`;
        } catch (_) { }
        return res.status(response.status).json({ error: friendlyError });
      }

      const data = await response.json();
      const report = data.choices?.[0]?.message?.content;

      if (!report) {
        return res.status(500).json({ error: 'No response generated from Groq.' });
      }

      const responseData = {
        severity,
        category,
        incident,
        confidence,
        report,
        fallbackUsed: isFallbackUsed
      };

      // Store in LRU Cache (5-minute TTL)
      try {
        diagnosticCache.set(logHash, {
          expiresAt: Date.now() + 300000, // 5 minutes
          data: responseData
        });

        // Enforce max cache size of 50 to keep memory footprint extremely small
        if (diagnosticCache.size > 50) {
          const oldestKey = diagnosticCache.keys().next().value;
          if (oldestKey) diagnosticCache.delete(oldestKey);
        }
      } catch (e) {
        console.error('[SRE Cache Error] Failed to write to diagnostic cache:', e);
      }

      res.json(responseData);
    } catch (error) {
      console.error('Error in /api/analyze-error:', error);
      res.status(500).json({ error: 'Internal server error during analysis' });
    }
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

  server.put('/api/users/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { id } = req.params;
    const { role } = req.body;
    if (!role || !['admin', 'viewer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be admin or viewer.' });
    }
    // Prevent demoting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
    try {
      await dbRun('UPDATE users SET role = ? WHERE id = ?', [role, id]);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: 'Failed to update role' });
    }
  });


  // ── SERVER GROUPS API ──────────────────────────────────────────────────────

  // GET all groups with their server members (admin panel)
  server.get('/api/groups', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const groups = await all('SELECT * FROM server_groups ORDER BY name');
      for (const group of groups) {
        group.servers = await all(
          'SELECT s.id, s.name, s.host FROM servers s INNER JOIN server_group_members sgm ON sgm.serverId = s.id WHERE sgm.groupId = ?',
          [group.id]
        );
      }
      res.json(groups);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch groups' });
    }
  });

  // POST create a new group
  server.post('/api/groups', authenticateToken, requireAdmin, async (req, res) => {
    const { name, description, serverIds } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });
    try {
      const result = await dbRun('INSERT INTO server_groups (name, description) VALUES (?, ?)', [name.trim(), description || '']);
      const groupId = result.id;
      if (Array.isArray(serverIds)) {
        for (const sid of serverIds) {
          await dbRun('INSERT OR IGNORE INTO server_group_members (groupId, serverId) VALUES (?, ?)', [groupId, sid]);
        }
      }
      res.json({ success: true, id: groupId });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to create group' });
    }
  });

  // PUT update a group (name, description, server members)
  server.put('/api/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
    const { name, description, serverIds } = req.body;
    const groupId = req.params.id;
    try {
      await dbRun('UPDATE server_groups SET name = ?, description = ? WHERE id = ?', [name.trim(), description || '', groupId]);
      await dbRun('DELETE FROM server_group_members WHERE groupId = ?', [groupId]);
      if (Array.isArray(serverIds)) {
        for (const sid of serverIds) {
          await dbRun('INSERT OR IGNORE INTO server_group_members (groupId, serverId) VALUES (?, ?)', [groupId, sid]);
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to update group' });
    }
  });

  // DELETE a group
  server.delete('/api/groups/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      await dbRun('DELETE FROM server_groups WHERE id = ?', [req.params.id]);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete group' });
    }
  });

  // GET groups assigned to a specific user
  server.get('/api/users/:id/groups', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const groups = await all(
        'SELECT g.id, g.name FROM server_groups g INNER JOIN user_group_access uga ON uga.groupId = g.id WHERE uga.userId = ?',
        [req.params.id]
      );
      res.json(groups);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch user groups' });
    }
  });

  // PUT update groups assigned to a user (replaces all)
  server.put('/api/users/:id/groups', authenticateToken, requireAdmin, async (req, res) => {
    const { groupIds } = req.body;
    const userId = req.params.id;
    try {
      await dbRun('DELETE FROM user_group_access WHERE userId = ?', [userId]);
      if (Array.isArray(groupIds)) {
        for (const gid of groupIds) {
          await dbRun('INSERT OR IGNORE INTO user_group_access (userId, groupId) VALUES (?, ?)', [userId, gid]);
        }
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to update user groups' });
    }
  });

  // GET grouped servers for sidebar (respects user access)
  server.get('/api/groups/with-servers', authenticateToken, async (req, res) => {
    try {
      let groups;
      if (req.user.role === 'admin') {
        groups = await all('SELECT * FROM server_groups ORDER BY name');
        for (const group of groups) {
          group.servers = await all(
            'SELECT s.id, s.name, s.host FROM servers s INNER JOIN server_group_members sgm ON sgm.serverId = s.id WHERE sgm.groupId = ?',
            [group.id]
          );
        }
      } else {
        groups = await all(
          'SELECT g.* FROM server_groups g INNER JOIN user_group_access uga ON uga.groupId = g.id WHERE uga.userId = ? ORDER BY g.name',
          [req.user.id]
        );
        for (const group of groups) {
          group.servers = await all(
            'SELECT s.id, s.name, s.host FROM servers s INNER JOIN server_group_members sgm ON sgm.serverId = s.id WHERE sgm.groupId = ?',
            [group.id]
          );
        }
      }
      res.json(groups);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch grouped servers' });
    }
  });

  // ── END SERVER GROUPS API ─────────────────────────────────────────────────

  server.get('/api/servers', authenticateToken, async (req, res) => {
    try {
      // Admins always see all servers
      if (req.user.role === 'admin') {
        const servers = await all('SELECT id, name, host, port, username, createdAt FROM servers');
        return res.json(servers);
      }
      // Viewers: only servers in groups they have access to
      const servers = await all(`
        SELECT DISTINCT s.id, s.name, s.host, s.port, s.username, s.createdAt
        FROM servers s
        INNER JOIN server_group_members sgm ON sgm.serverId = s.id
        INNER JOIN user_group_access uga ON uga.groupId = sgm.groupId
        WHERE uga.userId = ?
      `, [req.user.id]);
      res.json(servers);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch servers' });
    }
  });

  server.get('/api/servers/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const serverId = req.params.id;
      const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
      if (!serverConfig) return res.status(404).json({ error: 'Server not found' });
      if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);
      res.json(serverConfig);
    } catch (e) {
      res.status(500).json({ error: 'Failed to fetch server details' });
    }
  });


  // Fix #2: Deduplicate concurrent SSH discovery calls for the same server.
  // If fetchSources() is called rapidly (e.g. from docker_event), only ONE SSH
  // connection is opened — all callers await the same promise.
  const pendingDiscovery = new Map();
    const sourceCache = new Map();
    const CACHE_TTL_MS = 600000; // 10 minutes cache (600,000 ms)

  server.get('/api/servers/:id/sources', authenticateToken, async (req, res) => {
    const serverId = req.params.id;
    const type = req.query.type || '';

    // Security check to prevent RCE / shell injection via parameter injection
    if (/[;&|<>`$(){}\\"']|\.\./.test(type)) {
      return res.status(400).json({ error: 'Invalid type parameter' });
    }

    const forceRefresh = req.query.refresh === 'true';
    const cacheKey = `${serverId}:${type}`;

    if (forceRefresh) {
      sourceCache.delete(cacheKey);
    } else {
      const cached = sourceCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return res.json(cached.data);
      }
    }

    // If a discovery is already in-flight for this server, reuse it
    if (pendingDiscovery.has(cacheKey)) {
      try {
        const sources = await pendingDiscovery.get(cacheKey);
        return res.json(sources);
      } catch (e) {
        return res.status(500).json({ error: e.message || 'Failed to discover log sources' });
      }
    }

    try {
      const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
      if (!serverConfig) return res.status(404).json({ error: 'Not found' });

      const ssh = new SSHController(null);
      const promise = ssh.discoverLogSources(serverConfig, type);

      // Register the in-flight promise so parallel requests share it
      pendingDiscovery.set(cacheKey, promise);

      const sources = await promise;
      // Store in cache
      sourceCache.set(cacheKey, { data: sources, timestamp: Date.now() });
      res.json(sources);
    } catch (e) {
      console.error(`[DISCOVERY ERROR] Server ID ${serverId}:`, e.message);
      res.status(500).json({ error: e.message || 'Failed to discover log sources' });
    } finally {
      // Always clean up so the next call can open a fresh connection
      pendingDiscovery.delete(cacheKey);
    }
  });

  // NEW: Discover log files inside a specific K8s pod
  server.get('/api/servers/:id/pod-files', authenticateToken, async (req, res) => {
    const serverId = req.params.id;
    const podIdentifier = req.query.pod; // e.g. "default/celery-worker-abc123"

    if (!podIdentifier) return res.status(400).json({ error: 'Missing pod query parameter' });

    // Security: no path traversal or shell injection
    if (/[;&|<>`$(){}\\"']|\.\./.test(podIdentifier)) {
      return res.status(400).json({ error: 'Invalid pod identifier' });
    }

    try {
      const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
      if (!serverConfig) return res.status(404).json({ error: 'Server not found' });

      const ssh = new SSHController(null);
      const sources = await ssh.discoverLogSources(serverConfig, `pod-files ${podIdentifier}`);

      // Parse the k8s-container:namespace/pod|container|status
      // and k8s-file:namespace/pod|container|/path/to/file|status lines
      const items = sources
        .map(s => {
          if (s.type === 'k8s-container') {
            const [podId, containerName, status] = s.identifier.split('|');
            return { type: 'k8s-container', identifier: `${podId}|${containerName}`, status: status || 'active', containerName };
          } else if (s.type === 'k8s-file') {
            const parts = s.identifier.split('|');
            if (parts.length === 3) {
              const [podId, containerName, filePath] = parts;
              return { type: 'k8s-file', identifier: `${podId}|${containerName}|${filePath}`, status: s.status || 'file', containerName, filePath };
            } else {
              const [podId, filePath] = parts;
              return { type: 'k8s-file', identifier: `${podId}|${filePath}`, status: s.status || 'file', filePath };
            }
          }
          return null;
        })
        .filter(Boolean);

      res.json(items);
    } catch (e) {
      console.error(`[POD FILES ERROR] Server ${serverId} pod ${podIdentifier}:`, e.message);
      res.status(500).json({ error: e.message || 'Failed to list pod files' });
    }
  });

  // NEW: Discover log files inside a specific Docker container
  server.get('/api/servers/:id/container-files', authenticateToken, async (req, res) => {
    const serverId = req.params.id;
    const containerName = req.query.container; // e.g. "my-app-container"

    if (!containerName) return res.status(400).json({ error: 'Missing container query parameter' });

    // Security: no path traversal or shell injection
    if (/[;&|<>`$(){}\\"']|\.\./.test(containerName)) {
      return res.status(400).json({ error: 'Invalid container name' });
    }

    try {
      const serverConfig = await get('SELECT * FROM servers WHERE id = ?', [serverId]);
      if (!serverConfig) return res.status(404).json({ error: 'Server not found' });

      const ssh = new SSHController(null);
      const sources = await ssh.discoverLogSources(serverConfig, `container-files ${containerName}`);

      // Parse the docker-file:container|/path/to/file|status lines
      const files = sources
        .filter(s => s.type === 'docker-file')
        .map(s => {
          const [container, filePath, status] = s.identifier.split('|');
          return { type: 'docker-file', identifier: `${container}|${filePath}`, status: status || 'file', filePath };
        });

      res.json(files);
    } catch (e) {
      console.error(`[CONTAINER FILES ERROR] Server ${serverId} container ${containerName}:`, e.message);
      res.status(500).json({ error: e.message || 'Failed to list container files' });
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

  // Serve the secure log-wrapper.sh file
  server.get('/log-wrapper.sh', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).send('Error: Missing setup token');
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.purpose !== 'setup-node') {
        return res.status(403).send('Error: Invalid token');
      }
    } catch (err) {
      return res.status(403).send('Error: Token expired or invalid');
    }

    const filePath = path.join(__dirname, 'log-wrapper.sh');
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'text/x-sh');
      res.sendFile(filePath);
    } else {
      res.status(404).send('Error: log-wrapper.sh not found');
    }
  });

  // Get a secure setup token (admin only)
  server.get('/api/setup/token', authenticateToken, requireAdmin, (req, res) => {
    const token = jwt.sign({ purpose: 'setup-node' }, JWT_SECRET, { expiresIn: '30m' });
    res.json({ token });
  });

  // Serve dynamic auto-setup bash script
  server.get('/api/setup-node', (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).send('Error: Missing setup token');
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.purpose !== 'setup-node') {
        return res.status(403).send('Error: Invalid token');
      }
    } catch (err) {
      return res.status(403).send('Error: Token expired or invalid');
    }

    if (!fs.existsSync(PUBLIC_KEY_PATH)) {
      return res.status(500).send('Error: Master public key not generated yet');
    }

    const pubKey = fs.readFileSync(PUBLIC_KEY_PATH, 'utf8').trim();

    let appHost = req.headers.host;
    if (process.env.REDIRECT_URI) {
      try {
        const url = new URL(process.env.REDIRECT_URI);
        appHost = url.host;
      } catch (e) {
        // Fallback
      }
    }

    const bashScript = `#!/bin/bash
set -e

echo -e "\\x1b[32m=== PulseLog Node Auto-Setup ===\\x1b[0m"

if [ "$EUID" -ne 0 ]; then
  SUDO="sudo"
else
  SUDO=""
fi

echo "Creating /usr/log/bin/ directory..."
$SUDO mkdir -p /usr/log/bin/

echo "Downloading log-wrapper.sh from app..."
$SUDO curl -fsSL -k "https://${appHost}/log-wrapper.sh?token=${token}" -o /usr/log/bin/log-wrapper.sh
$SUDO chmod +x /usr/log/bin/log-wrapper.sh

echo "Configuring SSH key authorization..."
mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

RESTRICTION='command="/usr/log/bin/log-wrapper.sh",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty'
PUBKEY='${pubKey}'
FULL_LINE="\${RESTRICTION} \${PUBKEY}"

if ! grep -qF "\${PUBKEY}" ~/.ssh/authorized_keys; then
  echo "\${FULL_LINE}" >> ~/.ssh/authorized_keys
  echo "SSH Key Authorized."
else
  echo "SSH Key already authorized."
fi

MY_IP=\$(curl -s ifconfig.me || curl -s icanhazip.com || curl -s checkip.amazonaws.com || echo "")
if [ -z "\${MY_IP}" ]; then
  MY_IP=\$(hostname -I | awk '{print \$1}')
fi

MY_HOSTNAME=\$(hostname)
MY_USER=\$(whoami)
ALL_IPS=\$(hostname -I 2>/dev/null || echo "")

echo "Registering server with PulseLog as '\${MY_HOSTNAME}' (\${MY_IP})..."

curl -s -k -X POST "https://${appHost}/api/servers/register-remote?token=${token}" \\
  -H "Content-Type: application/json" \\
  -d "{\\"name\\":\\"\${MY_HOSTNAME}\\", \\"host\\":\\"\${MY_IP}\\", \\"username\\":\\"\${MY_USER}\\", \\"port\\":22, \\"all_ips\\":\\"\${ALL_IPS}\\"}"

echo -e "\\x1b[32m=== SETUP COMPLETE! Server '\${MY_HOSTNAME}' Registered Successfully! ===\\x1b[0m"
`;

    res.setHeader('Content-Type', 'text/plain');
    res.send(bashScript);
  });

  // Handle remote auto-registration from setup-node
  server.post('/api/servers/register-remote', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).json({ error: 'Unauthorized: Missing setup token' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (decoded.purpose !== 'setup-node') {
        return res.status(403).json({ error: 'Invalid token' });
      }
    } catch (err) {
      return res.status(403).json({ error: 'Token expired or invalid' });
    }

    const { name, host, username, port, all_ips } = req.body;
    if (!name || !host || !username) {
      return res.status(400).json({ error: 'Missing name, host, or username' });
    }

    try {
      if (!fs.existsSync(PRIVATE_KEY_PATH)) {
        return res.status(500).json({ error: 'Master private key not generated' });
      }
      const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
      const cleanKey = SSHController.sanitizeKey(privateKey);
      const encryptedKey = encrypt(cleanKey);

      // Check if this server is already registered in the database.
      // Parse all reported IPs (including hostname -I output).
      const reportedIps = new Set([host.trim()]);
      if (all_ips) {
        all_ips.split(/\s+/).forEach(ip => {
          const trimmed = ip.trim();
          if (trimmed) reportedIps.add(trimmed);
        });
      }

      // Fetch all registered servers
      const allServers = await all('SELECT * FROM servers');
      let matchedServer = null;

      for (const s of allServers) {
        // Skip comparing against Local System placeholder config
        if (s.host === 'localhost' || s.host === '127.0.0.1' || s.host === '::1') continue;

        // 1. Match by IP address
        if (reportedIps.has(s.host)) {
          matchedServer = s;
          break;
        }

        // 2. Match by exact username and name
        if (s.username === username && s.name.toLowerCase() === name.toLowerCase()) {
          matchedServer = s;
          break;
        }
      }

      if (matchedServer) {
        // If server is already registered, update its private key, username, and port (just in case they changed)
        // Keep the original name and host IP/domain to preserve user custom configurations (such as friendly names/IPv4).
        await dbRun('UPDATE servers SET privateKey = ?, username = ?, port = ? WHERE id = ?',
          [encryptedKey, username, port || matchedServer.port || 22, matchedServer.id]);

        console.log(`[AUTO REGISTRATION] Updated existing server '${matchedServer.name}' (ID: ${matchedServer.id})`);
        return res.json({ success: true, id: matchedServer.id, updated: true });
      }

      // Otherwise, register as a new server entry
      const result = await dbRun('INSERT INTO servers (name, host, port, username, privateKey) VALUES (?, ?, ?, ?, ?)',
        [name, host, port || 22, username, encryptedKey]);
      console.log(`[AUTO REGISTRATION] Registered new server '${name}' (ID: ${result.id})`);
      res.json({ success: true, id: result.id });
    } catch (e) {
      console.error('[AUTO REGISTRATION ERROR]', e.message);
      res.status(500).json({ error: 'Auto-registration database insert failed' });
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
