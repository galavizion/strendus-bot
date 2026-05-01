const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const strendusAPI = require('../services/strendusAPI');
const whatsappService = require('../services/whatsappService');
const oddsService = require('../services/oddsService');

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

// --- Users ---
router.get('/api/users', adminAuth, (req, res) => {
  res.json(strendusAPI.usersData.users);
});

router.post('/api/users', adminAuth, (req, res) => {
  const { clientId, name, phone, email, balance } = req.body || {};

  if (!clientId) return res.status(400).json({ error: 'El ID de cliente es requerido' });
  if (!name)     return res.status(400).json({ error: 'El nombre es requerido' });
  if (!phone)    return res.status(400).json({ error: 'El teléfono es requerido' });

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

  console.log(`✅ Admin: usuario ${name} (${clientId}) agregado`);
  res.status(201).json(newUser);
});

router.patch('/api/users/:phone/balance', adminAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const { balance } = req.body || {};

  const idx = strendusAPI.usersData.users.findIndex(u => u.phone === phone);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  strendusAPI.usersData.users[idx].balance = parseInt(balance) || 0;
  strendusAPI.saveUsers();

  res.json({ success: true, balance: strendusAPI.usersData.users[idx].balance });
});

router.delete('/api/users/:phone', adminAuth, (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const idx = strendusAPI.usersData.users.findIndex(u => u.phone === phone);

  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });

  strendusAPI.usersData.users.splice(idx, 1);
  strendusAPI.saveUsers();

  res.json({ success: true });
});

// --- Games (Odds cache) ---
router.get('/api/games', adminAuth, (req, res) => {
  res.json({
    games: oddsService.cache.games,
    lastUpdate: oddsService.cache.lastUpdate,
    total: oddsService.cache.games.length
  });
});

// --- Events (endpoint gratuito — sin costo de cuota) ---
router.get('/api/events', adminAuth, async (req, res) => {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.json({ events: [], total: 0, oddsCacheCount: 0, error: 'ODDS_API_KEY no está configurada en Railway.' });
  }
  try {
    // Fetch events (free, no quota) and odds cache in parallel
    const [events, oddsGames] = await Promise.all([
      oddsService.fetchAllEvents(),
      Promise.resolve(oddsService.cache.games)
    ]);

    // Build lookups
    const eventsById = {};
    events.forEach(e => { eventsById[e.id] = e; });
    const oddsIds = new Set(oddsGames.map(g => g.id));

    // Primary: cached odds games (have bookmakers). Augment with fresh event data if available.
    const result = oddsGames.map(g => ({ ...(eventsById[g.id] || {}), ...g }));

    // Secondary: events that have no cached odds yet (no bookmakers)
    events.forEach(e => { if (!oddsIds.has(e.id)) result.push(e); });

    result.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    res.json({
      events: result,
      total: result.length,
      oddsLastUpdate: oddsService.cache.lastUpdate,
      oddsCacheCount: oddsGames.length
    });
  } catch (e) {
    res.json({ events: [], total: 0, oddsCacheCount: 0, error: e.message });
  }
});

router.post('/api/refresh-odds', adminAuth, async (req, res) => {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ success: false, error: 'ODDS_API_KEY no está configurada en las variables de Railway.' });
  }

  try {
    const games = await oddsService.fetchAllOdds();
    if (games.length === 0) {
      return res.json({
        success: false,
        error: 'Se obtuvieron 0 partidos. La cuota puede estar agotada (error 422) o no hay eventos con momios activos. Revisa los logs de Railway para más detalles.'
      });
    }
    res.json({ success: true, gamesUpdated: games.length });
  } catch (e) {
    res.status(200).json({ success: false, error: e.message });
  }
});

// --- Bets ---
router.get('/api/bets', adminAuth, (req, res) => {
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
router.get('/api/config', adminAuth, (req, res) => {
  try {
    const data = fs.readFileSync(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.json({ footers: {}, listButtons: {} });
  }
});

router.put('/api/config', adminAuth, (req, res) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(req.body, null, 2));
    whatsappService.loadConfig();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
