const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple Self-Contained .env File Parser & Auto-Generator
const ENV_PATH = path.join(__dirname, '.env');
if (!fs.existsSync(ENV_PATH)) {
  const randomKey = crypto.randomBytes(12).toString('hex'); // Generate 24-character hex key
  fs.writeFileSync(ENV_PATH, `API_KEY=${randomKey}\n`, 'utf8');
  console.log(`[Security] Generated new secure API Key and wrote it to .env`);
}

// Read .env variables into process.env
const envContent = fs.readFileSync(ENV_PATH, 'utf8');
envContent.split('\n').forEach(line => {
  const parts = line.split('=');
  if (parts.length >= 2) {
    const key = parts[0].trim();
    const val = parts.slice(1).join('=').trim();
    if (key) process.env[key] = val;
  }
});

const API_KEY = process.env.API_KEY || 'default_secret_key_change_me';

// Authentication Middleware for all API calls
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid API key.' });
  }
  const token = authHeader.substring(7);
  if (token !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key.' });
  }
  next();
}

// Database setup: Resilient SQLite or JSON fallback
let db;
const DB_PATH = path.join(__dirname, 'sms_database.sqlite');
const JSON_DB_PATH = path.join(__dirname, 'sms_database.json');
let isSQLite = false;

try {
  const sqlite3 = require('sqlite3').verbose();
  db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
      console.error('Could not connect to SQLite database. Falling back to JSON storage.', err.message);
      initJsonDb();
    } else {
      console.log('Connected to SQLite database.');
      isSQLite = true;
      initSqliteDb();
    }
  });
} catch (e) {
  console.warn('sqlite3 module not available or failed to load. Falling back to JSON storage.');
  initJsonDb();
}

// Initialize SQLite tables
function initSqliteDb() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS sms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        device_name TEXT,
        sender TEXT,
        message TEXT,
        timestamp INTEGER,
        sim_slot INTEGER,
        battery INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        device_name TEXT,
        battery INTEGER,
        status TEXT,
        last_seen INTEGER
      )
    `);
  });
}

// In-memory/JSON fallback DB adapter
let jsonDb = { sms: [], devices: {} };

function initJsonDb() {
  isSQLite = false;
  if (fs.existsSync(JSON_DB_PATH)) {
    try {
      const data = fs.readFileSync(JSON_DB_PATH, 'utf8');
      jsonDb = JSON.parse(data);
      if (!jsonDb.sms) jsonDb.sms = [];
      if (!jsonDb.devices) jsonDb.devices = {};
      console.log('Loaded JSON database successfully with', jsonDb.sms.length, 'records.');
    } catch (err) {
      console.error('Failed to parse JSON DB file, starting fresh:', err.message);
    }
  } else {
    saveJsonDb();
  }
}

function saveJsonDb() {
  try {
    fs.writeFileSync(JSON_DB_PATH, JSON.stringify(jsonDb, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save JSON DB file:', err.message);
  }
}

// SSE (Server-Sent Events) clients list
let sseClients = [];

// Helper to broadcast events to all connected clients
function broadcastEvent(type, data) {
  const payload = JSON.stringify({ type, data });
  console.log(`Broadcasting event: ${type} to ${sseClients.length} clients.`);
  sseClients.forEach(client => {
    client.res.write(`data: ${payload}\n\n`);
  });
}

// API: Server-Sent Events for real-time dashboard updates (Secured via query parameter)
app.get('/api/events', (req, res) => {
  const apiKey = req.query.api_key;
  if (apiKey !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    return res.end('Unauthorized: Invalid API Key');
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  res.write('\n'); // keep-alive initial message
  
  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);
  console.log(`[SSE] Client connected. Total: ${sseClients.length}`);
  
  req.on('close', () => {
    sseClients = sseClients.filter(client => client.id !== clientId);
    console.log(`[SSE] Client disconnected. Total: ${sseClients.length}`);
  });
});

// API: Ingest incoming SMS from Android App (Secured)
app.post('/api/sms', authMiddleware, (req, res) => {
  const { device_id, device_name, sender, message, timestamp, sim_slot, battery } = req.body;
  
  if (!device_id || !sender || !message) {
    return res.status(400).json({ error: 'Missing required parameters: device_id, sender, message' });
  }

  const smsRecord = {
    device_id,
    device_name: device_name || 'Generic Android Phone',
    sender,
    message,
    timestamp: timestamp ? parseInt(timestamp) : Date.now(),
    sim_slot: sim_slot ? parseInt(sim_slot) : 1,
    battery: battery ? parseInt(battery) : 100
  };

  const deviceRecord = {
    device_id,
    device_name: device_name || 'Generic Android Phone',
    battery: battery ? parseInt(battery) : 100,
    status: 'Active',
    last_seen: Date.now()
  };

  console.log(`Received SMS from ${smsRecord.device_name}: [${sender}] -> ${message.substring(0, 30)}...`);

  if (isSQLite) {
    // Save to SQLite
    const insertSmsQuery = `
      INSERT INTO sms (device_id, device_name, sender, message, timestamp, sim_slot, battery)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    db.run(insertSmsQuery, [
      smsRecord.device_id,
      smsRecord.device_name,
      smsRecord.sender,
      smsRecord.message,
      smsRecord.timestamp,
      smsRecord.sim_slot,
      smsRecord.battery
    ], function(err) {
      if (err) {
        console.error('Failed to insert SMS in SQLite:', err.message);
        return res.status(500).json({ error: 'Database write error' });
      }
      
      const savedSms = { id: this.lastID, ...smsRecord, created_at: new Date().toISOString() };
      
      // Upsert Device
      const upsertDeviceQuery = `
        INSERT INTO devices (device_id, device_name, battery, status, last_seen)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          device_name=excluded.device_name,
          battery=excluded.battery,
          status='Active',
          last_seen=excluded.last_seen
      `;
      db.run(upsertDeviceQuery, [
        deviceRecord.device_id,
        deviceRecord.device_name,
        deviceRecord.battery,
        deviceRecord.status,
        deviceRecord.last_seen
      ], (err) => {
        if (err) console.error('Failed to upsert device in SQLite:', err.message);
        
        // Broadcast updates
        broadcastEvent('new_sms', savedSms);
        broadcastEvent('device_update', deviceRecord);
        res.json({ success: true, id: savedSms.id });
      });
    });
  } else {
    // Save to JSON
    const newId = jsonDb.sms.length + 1;
    const savedSms = { id: newId, ...smsRecord, created_at: new Date().toISOString() };
    jsonDb.sms.push(savedSms);
    jsonDb.devices[device_id] = deviceRecord;
    saveJsonDb();

    // Broadcast updates
    broadcastEvent('new_sms', savedSms);
    broadcastEvent('device_update', deviceRecord);
    res.json({ success: true, id: savedSms.id });
  }
});

// API: Batch Ingest / Sync Historical SMS (Secured)
app.post('/api/sms/sync', authMiddleware, (req, res) => {
  const { device_id, device_name, messages } = req.body;
  if (!device_id || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Missing device_id or messages array' });
  }

  const device_name_clean = device_name || 'Generic Android Phone';
  console.log(`Syncing ${messages.length} historical SMS from ${device_name_clean}...`);

  if (isSQLite) {
    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      const stmt = db.prepare(`
        INSERT INTO sms (device_id, device_name, sender, message, timestamp, sim_slot, battery)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      messages.forEach(msg => {
        stmt.run([
          device_id,
          device_name_clean,
          msg.sender,
          msg.message,
          msg.timestamp ? parseInt(msg.timestamp) : Date.now(),
          msg.sim_slot ? parseInt(msg.sim_slot) : 1,
          msg.battery ? parseInt(msg.battery) : 100
        ]);
      });
      
      stmt.finalize();
      
      // Update device info
      const latestBattery = messages.length > 0 ? messages[messages.length - 1].battery : 100;
      db.run(`
        INSERT INTO devices (device_id, device_name, battery, status, last_seen)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(device_id) DO UPDATE SET
          device_name=excluded.device_name,
          battery=excluded.battery,
          status='Active',
          last_seen=excluded.last_seen
      `, [device_id, device_name_clean, latestBattery, 'Active', Date.now()], (err) => {
        if (err) {
          db.run("ROLLBACK");
          console.error('Failed transaction for SMS sync:', err.message);
          return res.status(500).json({ error: 'Sync transaction failed' });
        }
        db.run("COMMIT");
        broadcastEvent('bulk_sync', { device_id });
        res.json({ success: true, count: messages.length });
      });
    });
  } else {
    // JSON DB Sync
    messages.forEach(msg => {
      const newId = jsonDb.sms.length + 1;
      jsonDb.sms.push({
        id: newId,
        device_id,
        device_name: device_name_clean,
        sender: msg.sender,
        message: msg.message,
        timestamp: msg.timestamp ? parseInt(msg.timestamp) : Date.now(),
        sim_slot: msg.sim_slot ? parseInt(msg.sim_slot) : 1,
        battery: msg.battery ? parseInt(msg.battery) : 100,
        created_at: new Date().toISOString()
      });
    });
    
    const latestBattery = messages.length > 0 ? messages[messages.length - 1].battery : 100;
    jsonDb.devices[device_id] = {
      device_id,
      device_name: device_name_clean,
      battery: latestBattery ? parseInt(latestBattery) : 100,
      status: 'Active',
      last_seen: Date.now()
    };
    saveJsonDb();
    
    broadcastEvent('bulk_sync', { device_id });
    res.json({ success: true, count: messages.length });
  }
});

// API: Retrieve SMS list with search and filters (Secured)
app.get('/api/sms', authMiddleware, (req, res) => {
  const search = req.query.search || '';
  const device = req.query.device || '';
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;

  if (isSQLite) {
    let query = `SELECT * FROM sms WHERE 1=1`;
    const params = [];

    if (search) {
      query += ` AND (sender LIKE ? OR message LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    if (device) {
      query += ` AND device_id = ?`;
      params.push(device);
    }

    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to query SMS from SQLite:', err.message);
        return res.status(500).json({ error: 'Query error' });
      }
      res.json(rows);
    });
  } else {
    // Filter JSON Db
    let results = [...jsonDb.sms];

    if (device) {
      results = results.filter(sms => sms.device_id === device);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      results = results.filter(sms => 
        sms.sender.toLowerCase().includes(searchLower) || 
        sms.message.toLowerCase().includes(searchLower)
      );
    }

    // Sort descending by timestamp
    results.sort((a, b) => b.timestamp - a.timestamp);
    const paginated = results.slice(offset, offset + limit);
    res.json(paginated);
  }
});

// API: Payment Verification API (Secured)
app.post('/api/verify-payment', authMiddleware, (req, res) => {
  const { sender_number, trx_id, amount } = req.body;

  if (!trx_id) {
    return res.status(400).json({ error: 'Missing required parameter: trx_id' });
  }
  if (!sender_number) {
    return res.status(400).json({ error: 'Missing required parameter: sender_number' });
  }
  if (amount === undefined || amount === null) {
    return res.status(400).json({ error: 'Missing required parameter: amount' });
  }

  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount)) {
    return res.status(400).json({ error: 'Invalid parameter: amount must be a number' });
  }

  const cleanTrx = trx_id.trim();

  // Helper matching functions
  function matchSenderNumber(messageText, expectedNumber) {
    if (!expectedNumber) return false;
    const cleanExpected = expectedNumber.replace(/\D/g, '');
    if (cleanExpected.length < 10) return false;
    const last10Digits = cleanExpected.slice(-10);
    const last11Digits = cleanExpected.slice(-11);

    if (messageText.includes(last11Digits) || messageText.includes(last10Digits)) {
      return true;
    }

    const cleanMessageText = messageText.replace(/[-+]/g, '');
    const digitSequences = cleanMessageText.match(/\d+/g) || [];
    for (const seq of digitSequences) {
      if (seq.endsWith(last10Digits)) {
        if (seq.length === 10 || seq.endsWith(last11Digits) || seq.includes('880' + last10Digits) || seq.includes('88' + last11Digits)) {
          return true;
        }
      }
    }
    return false;
  }

  function matchAmount(messageText, expectedAmountVal) {
    const target = parseFloat(expectedAmountVal);
    if (isNaN(target)) return false;

    const textLower = messageText.toLowerCase();

    const mainAmtRegexes = [
      /(?:received|cash\s*in|payment|added)\s+(?:cash\s*in\s+|payment\s+)?(?:tk|tk\.|taka)?\s*([\d,]+(?:\.\d+)?)/i,
      /(?:tk|tk\.|taka)\s*([\d,]+(?:\.\d+)?)\s*(?:received|cash\s*in|payment|added)/i,
      /(?:tk|tk\.|taka)\s*([\d,]+(?:\.\d+)?)/i
    ];

    for (const rx of mainAmtRegexes) {
      const m = textLower.match(rx);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && Math.abs(val - target) < 0.01) {
          return true;
        }
      }
    }

    const allNumbers = messageText.match(/\b\d+(?:\.\d+)?\b/g) || [];
    for (const numStr of allNumbers) {
      const val = parseFloat(numStr.replace(/,/g, ''));
      if (!isNaN(val) && Math.abs(val - target) < 0.01) {
        if (numStr.length < 9) {
          return true;
        }
      }
    }

    return false;
  }

  function verifyRows(rows) {
    if (rows.length === 0) {
      return res.status(200).json({
        status: 'failed',
        message: 'Transaction ID not found.'
      });
    }

    // Try to find a row that matches both amount and sender number
    const matchedRow = rows.find(row => 
      matchSenderNumber(row.message, sender_number) && 
      matchAmount(row.message, parsedAmount)
    );

    if (matchedRow) {
      return res.status(200).json({
        status: 'success',
        message: 'Payment verified successfully!',
        data: {
          trx_id: cleanTrx,
          amount: parsedAmount,
          sender: sender_number,
          timestamp: matchedRow.timestamp
        }
      });
    } else {
      return res.status(200).json({
        status: 'failed',
        message: 'Transaction ID found, but amount or sender number does not match.'
      });
    }
  }

  if (isSQLite) {
    const query = `SELECT * FROM sms WHERE LOWER(message) LIKE ?`;
    const param = `%${cleanTrx.toLowerCase()}%`;
    db.all(query, [param], (err, rows) => {
      if (err) {
        console.error('Failed to query SQLite for verification:', err.message);
        return res.status(500).json({ error: 'Database query error' });
      }
      verifyRows(rows);
    });
  } else {
    const lowercaseTrx = cleanTrx.toLowerCase();
    const rows = jsonDb.sms.filter(sms => sms.message.toLowerCase().includes(lowercaseTrx));
    verifyRows(rows);
  }
});

// API: Retrieve registered devices (Secured)
app.get('/api/devices', authMiddleware, (req, res) => {
  if (isSQLite) {
    db.all(`SELECT * FROM devices ORDER BY last_seen DESC`, [], (err, rows) => {
      if (err) {
        console.error('Failed to query devices from SQLite:', err.message);
        return res.status(500).json({ error: 'Query error' });
      }
      // Update statuses dynamically in-memory based on inactivity (e.g. idle after 5 mins)
      const now = Date.now();
      const updatedRows = rows.map(row => {
        if (now - row.last_seen > 5 * 60 * 1000) {
          row.status = 'Idle';
        }
        return row;
      });
      res.json(updatedRows);
    });
  } else {
    const devicesList = Object.values(jsonDb.devices);
    const now = Date.now();
    const updatedDevices = devicesList.map(dev => {
      const updated = { ...dev };
      if (now - dev.last_seen > 5 * 60 * 1000) {
        updated.status = 'Idle';
      }
      return updated;
    });
    // Sort by last_seen desc
    updatedDevices.sort((a, b) => b.last_seen - a.last_seen);
    res.json(updatedDevices);
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`🔑 SECURITY: Server API Key is active!`);
  console.log(`👉 Your API Key is: ${API_KEY}`);
  console.log(`💡 Note: Keep this key confidential. Input this key in your`);
  console.log(`   Android App Token field & Web passcode prompt.`);
  console.log(`===================================================`);
  console.log(`SMS Gateway Web Server running on port ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`SQLite DB: ${isSQLite ? 'Enabled' : 'Disabled (using resilient JSON DB)'}`);
  console.log(`===================================================`);
});
