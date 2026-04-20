const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dbPath)) fs.mkdirSync(dbPath, { recursive: true });

const db = new sqlite3.Database(path.join(dbPath, 'database.sqlite'), (err) => {
  if (err) console.error('Error opening database', err.message);
});

function initDB() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Users Table
      db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE,
        passwordHash TEXT,
        role TEXT DEFAULT 'viewer',
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Blacklisted Tokens Table
      db.run(`CREATE TABLE IF NOT EXISTS jwt_blacklist (
        token TEXT PRIMARY KEY,
        expiresAt DATETIME
      )`);

      // Servers Table
      db.run(`CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        host TEXT,
        port INTEGER DEFAULT 22,
        username TEXT,
        privateKey TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Audit Logs Table
      db.run(`CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userEmail TEXT,
        serverId INTEGER,
        serverName TEXT,
        logType TEXT,
        sourceId TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (err) return reject(err);
        
         // Seed default admin if missing
         db.get('SELECT * FROM users WHERE email = ?', ['root'], (err, row) => {
            if (!row && !err) {
               const hash = bcrypt.hashSync('Aboss@3006', 12);
               db.run('INSERT INTO users (email, passwordHash, role) VALUES (?, ?, ?)', ['root', hash, 'admin']);
            }
            
            // Seed local system server if missing
            db.get('SELECT * FROM servers WHERE host = ?', ['localhost'], (err, row) => {
               if (!row && !err) {
                  db.run('INSERT INTO servers (name, host, username) VALUES (?, ?, ?)', ['Local System', 'localhost', 'local']);
               }
               resolve();
            });
         });
      });
    });
  });
}

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

module.exports = { db, initDB, run, get, all };
