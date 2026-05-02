const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_BASE_URL = 'https://api.the-odds-api.com/v4';
const MANUAL_ODDS_PATH = path.join(__dirname, '../data/manualOdds.json');

// Deportes a consultar
const SPORTS = {
  NBA: 'basketball_nba',
  MLB: 'baseball_mlb',
  LIGA_MX: 'soccer_mexico_ligamx'
};

const ODDS_TTL = 4 * 60 * 60 * 1000; // 4 hours per sport

class OddsService {
  constructor() {
    this.cache = {
      games: [],
      lastUpdate: null
    };
    this.oddsCache = {}; // per-sport: { sportKey: { lastUpdate: Date } }
    this.manualOdds = this.loadManualOdds();
  }

  loadManualOdds() {
    try { return JSON.parse(fs.readFileSync(MANUAL_ODDS_PATH, 'utf8')); }
    catch { return {}; }
  }

  saveManualOdds() {
    try { fs.writeFileSync(MANUAL_ODDS_PATH, JSON.stringify(this.manualOdds, null, 2)); }
    catch (e) { console.error('Error guardando momios manuales:', e.message); }
  }

  setGameOdds(gameData, homeOdds, awayOdds, drawOdds) {
    const { id, home_team, away_team, sport_key, sport_title, commence_time } = gameData;
    const outcomes = [
      { name: home_team, price: parseFloat(homeOdds) },
      { name: away_team, price: parseFloat(awayOdds) }
    ];
    if (drawOdds) outcomes.push({ name: 'Draw', price: parseFloat(drawOdds) });
    const bookmakers = [{ key: 'manual', title: 'Manual', markets: [{ key: 'h2h', outcomes }] }];

    this.manualOdds[id] = {
      homeOdds: parseFloat(homeOdds),
      awayOdds: parseFloat(awayOdds),
      drawOdds: drawOdds ? parseFloat(drawOdds) : null
    };
    this.saveManualOdds();

    const idx = this.cache.games.findIndex(g => g.id === id);
    if (idx >= 0) {
      this.cache.games[idx] = { ...this.cache.games[idx], bookmakers };
    } else {
      this.cache.games.push({ id, home_team, away_team, sport_key, sport_title, commence_time, bookmakers });
      if (!this.cache.lastUpdate) this.cache.lastUpdate = new Date();
    }
  }

  withManualOdds(game) {
    // 1. Manual odds tienen prioridad
    const manual = this.manualOdds[game.id];
    if (manual) {
      const outcomes = [
        { name: game.home_team, price: manual.homeOdds },
        { name: game.away_team, price: manual.awayOdds }
      ];
      if (manual.drawOdds) outcomes.push({ name: 'Draw', price: manual.drawOdds });
      return { ...game, bookmakers: [{ key: 'manual', title: 'Manual', markets: [{ key: 'h2h', outcomes }] }] };
    }

    // 2. API tiene momios
    if (game.bookmakers?.length > 0) return game;

    // 3. Default: local 1.2 / visitante 2.6 / empate 3.2 (solo fútbol)
    const isSoccer = game.sport_key?.startsWith('soccer_');
    const outcomes = [
      { name: game.home_team, price: 1.2 },
      { name: game.away_team, price: 2.6 }
    ];
    if (isSoccer) outcomes.push({ name: 'Draw', price: 3.2 });
    return { ...game, bookmakers: [{ key: 'default', title: 'Default', markets: [{ key: 'h2h', outcomes }] }] };
  }

  /**
   * Obtener momios de todos los deportes
   */
  async fetchAllOdds() {
    try {
      console.log('🔄 Actualizando momios desde Odds API...');

      const promises = Object.values(SPORTS).map(sport => this.fetchSportOdds(sport));
      const results = await Promise.all(promises);
      const allGames = results.flat();

      const now = new Date();
      this.cache.games = allGames;
      this.cache.lastUpdate = now;

      // Sync per-sport TTL so getOrFetchOdds uses this data for the next 4 hours
      Object.values(SPORTS).forEach(sportKey => {
        this.oddsCache[sportKey] = { lastUpdate: now };
      });

      console.log(`✅ Momios actualizados: ${allGames.length} partidos`);
      return allGames;
    } catch (error) {
      console.error('❌ Error actualizando momios:', error.message);
      return this.cache.games;
    }
  }

  /**
   * Obtener momios de un deporte específico
   */
  async fetchSportOdds(sportKey) {
    try {
      const response = await axios.get(`${ODDS_BASE_URL}/sports/${sportKey}/odds/`, {
        params: {
          apiKey: ODDS_API_KEY,
          regions: 'us,uk,eu',
          markets: 'h2h',
          oddsFormat: 'decimal'
        },
        timeout: 10000
      });

      const remaining = response.headers['x-requests-remaining'];
      if (remaining !== undefined) {
        console.log(`📊 Odds API — requests restantes: ${remaining}`);
      }

      return response.data.map(game => ({
        ...game,
        sport_key: sportKey,
        sport_title: this.getSportTitle(sportKey)
      }));
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      const isQuota = status === 422 || (status === 401 && msg?.toLowerCase().includes('quota'));

      if (isQuota) {
        console.error(`❌ Odds API CUOTA AGOTADA (${status}) — usando eventos sin momios como fallback`);
        return this.fetchSportEvents(sportKey);
      } else if (status === 401) {
        console.error(`❌ Odds API KEY INVÁLIDA (401): ${msg}`);
      } else {
        console.error(`❌ Error obteniendo ${sportKey} (${status || 'sin conexión'}): ${msg}`);
      }
      return [];
    }
  }

  /**
   * Obtener eventos de un deporte (endpoint gratuito — sin costo de cuota)
   */
  async fetchSportEvents(sportKey) {
    try {
      const response = await axios.get(`${ODDS_BASE_URL}/sports/${sportKey}/events/`, {
        params: { apiKey: ODDS_API_KEY },
        timeout: 10000
      });
      return response.data.map(event => ({
        ...event,
        sport_key: sportKey,
        sport_title: this.getSportTitle(sportKey)
      }));
    } catch (error) {
      const status = error.response?.status;
      const msg = error.response?.data?.message || error.message;
      console.error(`❌ Error obteniendo eventos ${sportKey} (${status || 'sin conexión'}): ${msg}`);
      return [];
    }
  }

  /**
   * Obtener eventos de todos los deportes (gratis, sin quota)
   */
  async fetchAllEvents() {
    const promises = Object.values(SPORTS).map(sport => this.fetchSportEvents(sport));
    const results = await Promise.all(promises);
    return results.flat();
  }

  /**
   * Obtener momios on-demand con caché por deporte (TTL 4 horas)
   * Llama a la API solo cuando el caché expiró o nunca se cargó
   */
  async getOrFetchOdds(sportKey, limit = 3) {
    const now = new Date();
    const cached = this.oddsCache[sportKey];

    if (cached && cached.lastUpdate && (now - cached.lastUpdate) < ODDS_TTL) {
      return this.getAvailableGames(sportKey, limit);
    }

    console.log(`🔄 Obteniendo momios on-demand: ${sportKey}`);
    const games = await this.fetchSportOdds(sportKey);

    this.cache.games = this.cache.games
      .filter(g => g.sport_key !== sportKey)
      .concat(games);
    this.cache.lastUpdate = now;
    this.oddsCache[sportKey] = { lastUpdate: now };

    return this.getAvailableGames(sportKey, limit);
  }

  /**
   * Obtener partidos disponibles para apostar (>30 min)
   */
  getAvailableGames(sportKey = null, limit = 3) {
    const minTimeMs = Date.now() + 30 * 60 * 1000; // +30 min in ms, unambiguous

    let games = this.cache.games.filter(game => {
      const t = new Date(game.commence_time).getTime();
      return !isNaN(t) && t > minTimeMs;
    });

    if (sportKey) {
      games = games.filter(g => g.sport_key === sportKey);
    }

    // Ordenar por fecha más cercana
    games.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    return games.slice(0, limit).map(g => this.withManualOdds(g));
  }

  /**
   * Obtener un partido específico por ID
   */
  getGameById(gameId) {
    const game = this.cache.games.find(g => g.id === gameId);
    return game ? this.withManualOdds(game) : null;
  }

  /**
   * Verificar si un partido ya empezó o está por empezar (<20 min)
   */
  canBetOnGame(gameId) {
    const game = this.getGameById(gameId);
    if (!game) return { canBet: false, reason: 'Partido no encontrado' };

    const minutesUntilGame = (new Date(game.commence_time).getTime() - Date.now()) / 60000;

    if (minutesUntilGame < 20) {
      return {
        canBet: false,
        reason: minutesUntilGame <= 0
          ? 'Este partido ya inició. No se permiten apuestas.'
          : `El partido inicia en ${Math.round(minutesUntilGame)} minutos. No se permiten apuestas.`
      };
    }

    return { canBet: true };
  }

  sportKeyFromTitle(sportTitle) {
    const map = { 'NBA': 'basketball_nba', 'MLB': 'baseball_mlb', 'Liga MX': 'soccer_mexico_ligamx' };
    return map[sportTitle] || null;
  }

  /**
   * Obtener resultado de un partido.
   * fallbackGame: objeto game guardado en el bet (usado cuando el partido ya salió del caché)
   */
  async getGameResult(gameId, fallbackGame = null) {
    try {
      const game = this.getGameById(gameId) || fallbackGame;
      const sportKey = game?.sport_key || this.sportKeyFromTitle(game?.sport_title);
      if (!game || !sportKey) return null;

      // Consultar resultado desde Odds API (si está disponible)
      const response = await axios.get(`${ODDS_BASE_URL}/sports/${sportKey}/scores/`, {
        params: {
          apiKey: ODDS_API_KEY,
          daysFrom: 1
        },
        timeout: 10000
      });

      const result = response.data.find(g => g.id === gameId);
      
      if (result && result.completed) {
        return {
          completed: true,
          homeScore: result.scores?.find(s => s.name === game.home_team)?.score,
          awayScore: result.scores?.find(s => s.name === game.away_team)?.score,
          winner: this.determineWinner(result, game)
        };
      }

      return { completed: false };
    } catch (error) {
      console.error('Error obteniendo resultado:', error.message);
      return { completed: false };
    }
  }

  /**
   * Determinar ganador del partido
   */
  determineWinner(result, game) {
    const homeScore = result.scores?.find(s => s.name === game.home_team)?.score || 0;
    const awayScore = result.scores?.find(s => s.name === game.away_team)?.score || 0;

    if (homeScore > awayScore) return game.home_team;
    if (awayScore > homeScore) return game.away_team;
    return 'Draw';
  }

  /**
   * Obtener título legible del deporte
   */
  getSportTitle(sportKey) {
    const titles = {
      'basketball_nba': 'NBA',
      'baseball_mlb': 'MLB',
      'soccer_mexico_ligamx': 'Liga MX'
    };
    return titles[sportKey] || sportKey;
  }

  /**
   * Formatear fecha para México
   */
  formatGameDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  }

  /**
   * Obtener emoji del deporte
   */
  getSportEmoji(sportKey) {
    const emojis = {
      'basketball_nba': '🏀',
      'baseball_mlb': '⚾',
      'soccer_mexico_ligamx': '⚽'
    };
    return emojis[sportKey] || '🎯';
  }

  normalizeStr(str) {
    return String(str).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  sportAliases() {
    return [
      { keys: ['nba', 'basket', 'basquetbol', 'basquet'], sport: 'basketball_nba' },
      { keys: ['mlb', 'beisbol', 'bisbol', 'baseball'], sport: 'baseball_mlb' },
      { keys: ['ligamx', 'ligamx', 'liguilla', 'tigres', 'chivas', 'america', 'pumas', 'cruzazul', 'monterrey', 'toluca', 'leon', 'atlas', 'necaxa', 'santos', 'puebla', 'queretaro', 'tijuana'], sport: 'soccer_mexico_ligamx' },
      { keys: ['soccer', 'futbol', 'futsal', 'liga'], sport: 'soccer_mexico_ligamx' }
    ];
  }

  /**
   * Detects if query mentions a known sport keyword. Returns sport key or null.
   */
  detectSportIntent(query) {
    const q = this.normalizeStr(query);
    for (const { keys, sport } of this.sportAliases()) {
      if (keys.some(k => q.includes(k))) return sport;
    }
    return null;
  }

  /**
   * Búsqueda de partidos por nombre de equipo o deporte.
   * Async: fetches on-demand when cache empty or expired.
   * Retorna [] si no hay coincidencias.
   */
  async searchGames(query) {
    const q = this.normalizeStr(query);
    const minTimeMs = Date.now() + 30 * 60 * 1000;

    // Sport keyword → fetch on-demand (respects TTL)
    for (const { keys, sport } of this.sportAliases()) {
      if (keys.some(k => q.includes(k))) {
        return this.getOrFetchOdds(sport, 5);
      }
    }

    // Team name search — if cache empty, try fetching all sports first
    if (this.cache.games.length === 0) {
      await this.fetchAllOdds();
    }

    const words = q.split(' ').filter(w => w.length >= 4);
    if (words.length === 0) return [];

    const matches = this.cache.games.filter(game => {
      const t = new Date(game.commence_time).getTime();
      if (isNaN(t) || t <= minTimeMs) return false;
      const home = this.normalizeStr(game.home_team);
      const away = this.normalizeStr(game.away_team);
      return words.some(w => home.includes(w) || away.includes(w));
    });

    matches.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));
    return matches.slice(0, 5).map(g => this.withManualOdds(g));
  }

  /**
   * Obtener estadísticas de uso de la API
   */
  async getApiUsage() {
    try {
      const response = await axios.get(`${ODDS_BASE_URL}/sports/`, {
        params: { apiKey: ODDS_API_KEY }
      });

      return {
        remaining: response.headers['x-requests-remaining'] || 'N/A',
        used: response.headers['x-requests-used'] || 'N/A'
      };
    } catch (error) {
      return { remaining: 'N/A', used: 'N/A' };
    }
  }
}

module.exports = new OddsService();
