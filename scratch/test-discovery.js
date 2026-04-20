const { SSHController } = require('../src/lib/ssh-client.js');
const { initDB, get } = require('../src/lib/db.js');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, 'hex') : Buffer.alloc(32);
const IV_LENGTH = 16;

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

async function test() {
    await initDB();
    const server = await get('SELECT * FROM servers LIMIT 1');
    if (!server) {
        console.log("No servers found in DB");
        return;
    }
    if (server.privateKey) server.privateKey = decrypt(server.privateKey);
    
    const ssh = new SSHController(null);
    try {
        const sources = await ssh.discoverLogSources(server);
        console.log("Sources discovered:", JSON.stringify(sources, null, 2));
    } catch (e) {
        console.error("Discovery failed:", e);
    }
}

test();
