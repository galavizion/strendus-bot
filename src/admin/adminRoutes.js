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

// Serve admin HTML without auth
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Users ---
router.get('/api/users', adminAuth, async (req, res) => {
  try {
    const users = await strendusAPI.getAllUsers();
    res.json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/api/users', adminAuth, async (req, res) => {
  const { clientId, name, phone, email, balance } = req.body || {};

  if (!clientId) return res.status(400).json({ error: 'El ID de cliente es requerido' });
  if (!name)     return res.status(400).json({ error: 'El nombre es requerido' });
  if (!phone)    return res.status(400).json({ error: 'El teléfono es requerido' });

  try {
    const newUser = await strendusAPI.addUser({ clientId, name, phone, email, balance });
    console.log(`✅ Admin: usuario ${name} (${clientId}) agregado`);
    res.status(201).json(newUser);
  } catch (e) {
    if (e.message.includes('unique') || e.message.includes('duplicate')) {
      return res.status(409).json({ error: 'Ya existe un usuario con ese teléfono o ID de cliente' });
    }
    res.status(500).json({ error: e.message });
  }
});

router.patch('/api/users/:phone/balance', adminAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  const { balance } = req.body || {};

  try {
    const newBalance = await strendusAPI.setBalance(phone, parseInt(balance) || 0);
    if (newBalance === null) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true, balance: newBalance });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/api/users/:phone', adminAuth, async (req, res) => {
  const phone = decodeURIComponent(req.params.phone);
  try {
    const ok = await strendusAPI.deleteUser(phone);
    if (!ok) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Games (Odds cache) ---
router.get('/api/games', adminAuth, (req, res) => {
  res.json({
    games: oddsService.cache.games,
    lastUpdate: oddsService.cache.lastUpdate,
    total: oddsService.cache.games.length
  });
});

// --- Events ---
router.get('/api/events', adminAuth, async (req, res) => {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.json({ events: [], total: 0, oddsCacheCount: 0, error: 'ODDS_API_KEY no está configurada en Railway.' });
  }
  try {
    const [events, oddsGames] = await Promise.all([
      oddsService.fetchAllEvents(),
      Promise.resolve(oddsService.cache.games)
    ]);

    const eventsById = {};
    events.forEach(e => { eventsById[e.id] = e; });
    const oddsIds = new Set(oddsGames.map(g => g.id));

    const result = oddsGames.map(g => ({ ...(eventsById[g.id] || {}), ...g }));
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

router.patch('/api/games/:gameId/odds', adminAuth, (req, res) => {
  const { homeOdds, awayOdds, drawOdds, game } = req.body || {};
  if (!game || !homeOdds || !awayOdds) {
    return res.status(400).json({ error: 'homeOdds, awayOdds y game son requeridos' });
  }
  oddsService.setGameOdds(game, homeOdds, awayOdds, drawOdds || null);
  res.json({ success: true });
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
router.get('/api/bets', adminAuth, async (req, res) => {
  try {
    const { user, status } = req.query;
    const bets = await strendusAPI.getAllBets({
      phone: user || null,
      status: status || null
    });
    res.json(bets);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
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
