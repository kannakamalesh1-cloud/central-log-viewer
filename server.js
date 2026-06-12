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

        if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

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

    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
              content: `You are an expert Senior Site Reliability Engineer and Systems Administrator.
Your job is to analyze server/application log snippets and produce a detailed, objective, and highly accurate incident report.

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
Do not present the immediate failure mechanism as the underlying root cause unless causality is explicitly established by the logs.

Always distinguish between:
- Observed Symptoms
- Immediate Failure Mechanism
- Probable Root Causes

If the underlying cause cannot be confirmed from the available evidence, clearly state this and classify the proposed causes using the Confidence Classification framework.

9. Insufficient Evidence Handling:
If the provided logs do not contain enough information to determine the underlying cause, explicitly state:

"The available log evidence is insufficient to establish a confirmed root cause."

Then identify the exact additional artifacts required for confirmation (for example: package manifests, dependency trees, service configurations, full stack traces, container metadata, Kubernetes describe output, reverse proxy configuration, or application startup logs).

10. Post-Fix Validation:
Every remediation path must include validation steps demonstrating whether the issue has been resolved.

Examples:
- npm ls <package>
- npm run dev
- nginx -t
- curl -I <url>
- systemctl status <service>
- kubectl rollout status deployment/<name>

Do not conclude a report without describing how success should be verified.

11. Diagnostic Priority:
Recommend actions in the following order whenever possible:

1. Inspect
2. Verify
3. Validate hypotheses
4. Apply minimal corrective actions
5. Apply disruptive fixes

Avoid recommending destructive operations (such as deleting node_modules, purging caches, deleting pods, or restarting production services) as the initial remediation step unless the logs directly justify them.

12. Operational Impact Awareness:
For remediation actions that may affect availability, explicitly note the operational impact.

Examples:
- Service restarts may cause temporary downtime.
- Pod recreation may interrupt active requests.
- Cache purges may increase startup latency.
- Container rebuilds may extend deployment time.

Recommend maintenance windows where appropriate.

13. Environment Awareness:
Infer the execution environment from the logs and tailor recommendations accordingly.

Examples:
- Docker → docker inspect, docker compose logs, image verification, rebuild guidance.
- Kubernetes → kubectl describe, events inspection, rollout status, pod logs.
- Systemd/Linux → systemctl status, journalctl, service dependency checks.
- Reverse proxies → nginx -t, apachectl configtest.

Avoid environment-specific recommendations that conflict with the detected deployment model.

14. Security Severity Classification:
Classify suspicious activity using the following progression:

- Automated reconnaissance
- Suspicious activity
- Attempted exploitation
- Successful exploitation
- Confirmed compromise

Do not skip severity levels without direct supporting evidence.

If exploitation cannot be confirmed, explicitly state:

"There is no evidence of successful exploitation in the provided logs."

15. Evidence Formatting:
Every major conclusion must include an Evidence subsection containing the exact supporting log excerpts.

Preferred format:
Evidence:
- Timestamp (if available)
- Source file/component
- Exact log line(s)

Do not make diagnoses without corresponding evidence.

Always structure your response with these exact sections using Markdown:

## 🔍 Root Cause Analysis
### Observed Symptoms
### Immediate Failure Mechanism
### Probable Root Causes
### Confidence Classification
### Evidence

## 📋 What Happened (Timeline)

## 🛠️ How to Fix It

## ✅ Validation Steps

## 🛡️ How to Prevent It

Avoid generic disclaimers and filler text. However, explicitly state when the available evidence is insufficient to establish a confirmed root cause.`
            },
            {
              role: 'user',
              content: `Analyze this log excerpt and produce a full incident diagnostic report:

\`\`\`
${logs}
\`\`\``
            }
          ],
          temperature: 0.1,
          max_tokens: 2048,
          top_p: 1,
          stream: false,
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error('Groq API Error:', errText);
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

      res.json({ report });
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
  const CACHE_TTL_MS = 30000; // 30 seconds cache

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

      if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

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
      if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

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
      if (serverConfig.privateKey) serverConfig.privateKey = decrypt(serverConfig.privateKey);

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
