const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const strendusAPI = require('../services/strendusAPI');
const whatsappService = require('../services/whatsappService');

const CONFIG_PATH = path.join(__dirname, '../config/botConfig.json');

function adminAuth(req, res, next) {
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Basic ')) {
    return res.status(401).json({ error: 'No autorizado' });
  }

  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const colonIdx = decoded.indexOf(':');
  const user = decoded.slice(0, colonIdx);
  const pass = decoded.slice(colonIdx + 1);

  if (user !== 'admin' || pass !== adminPassword) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  next();
}

// Serve admin HTML without auth (the page itself handles the login UI)
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// All API endpoints require auth
router.use('/api', adminAuth);

// --- Users ---
router.get('/api/users', (req, res) => {
  res.json(strendusAPI.usersData.users);
});

router.post('/api/users', (req, res) => {
  const { clientId, name, phone, email, balance } = req.body;

  if (!clientId || !name || !phone) {
    return res.status(400).json({ error: 'clientId, name y phone son requeridos' });
  }

  const existing = strendusAPI.usersData.users.find(
    u => u.phone === phone || u.clientId === clientId
  );

  if (existing) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese teléfono o ID de cliente' });
  }

  const newUser = {
    clientId,
    name,
    phone,
    email: email || '',
    balance: parseInt(balance) || 5000,
    registeredAt: new Date().toISOString(),
    bets: []
  };

  strendusAPI.usersData.users.push(newUser);
  strendusAPI.saveUsers();

  res.status(201).json(newUser);
});

router.patch('/api/users/:phone/balance', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const { balance } = req.body;

  const idx = strendusAPI.usersData.users.findIndex(u => u.phone === phone);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  strendusAPI.usersData.users[idx].balance = parseInt(balance) || 0;
  strendusAPI.saveUsers();

  res.json({ success: true, balance: strendusAPI.usersData.users[idx].balance });
});

router.delete('/api/users/:phone', (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const idx = strendusAPI.usersData.users.findIndex(u => u.phone === phone);

  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  strendusAPI.usersData.users.splice(idx, 1);
  strendusAPI.saveUsers();

  res.json({ success: true });
});

// --- Bets ---
router.get('/api/bets', (req, res) => {
  const { user, status } = req.query;
  let allBets = [];

  strendusAPI.usersData.users.forEach(u => {
    if (user && u.phone !== user) return;
    const userBets = (u.bets || []).map(b => ({
      ...b,
      userPhone: u.phone,
      userName: u.name
    }));
    allBets.push(...userBets);
  });

  if (status) allBets = allBets.filter(b => b.status === status);

  allBets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(allBets);
});

// --- Config ---
router.get('/api/config', (req, res) => {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.json({ footers: {}, listButtons: {} });
  }
});

router.put('/api/config', (req, res) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
    whatsappService.loadConfig();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
