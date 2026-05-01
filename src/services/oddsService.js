const axios = require('axios');
const fs = require('fs');
const path = require('path');

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_BASE_URL = 'https://api.the-odds-api.com/v4';

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
  }

  /**
   * Obtener momios de todos los deportes
   */
  async fetchAllOdds() {
    try {
      console.log('🔄 Actualizando momios desde Odds API...');
      
      const promises = Object.values(SPORTS).map(sport => 
        this.fetchSportOdds(sport)
      );

      const results = await Promise.all(promises);
      const allGames = results.flat();

      this.cache.games = allGames;
      this.cache.lastUpdate = new Date();

      console.log(`✅ Momios actualizados: ${allGames.length} partidos`);
      
      return allGames;
    } catch (error) {
      console.error('❌ Error actualizando momios:', error.message);
      return this.cache.games; // Devolver cache si falla
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
      if (status === 422) {
        console.error(`❌ Odds API QUOTA AGOTADA (422): ${msg}`);
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
    const now = new Date();
    const minTime = new Date(now.getTime() + 30 * 60 * 1000); // +30 minutos

    let games = this.cache.games.filter(game => {
      const gameTime = new Date(game.commence_time);
      return gameTime > minTime;
    });

    if (sportKey) {
      games = games.filter(g => g.sport_key === sportKey);
    }

    // Ordenar por fecha más cercana
    games.sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time));

    return games.slice(0, limit);
  }

  /**
   * Obtener un partido específico por ID
   */
  getGameById(gameId) {
    return this.cache.games.find(g => g.id === gameId);
  }

  /**
   * Verificar si un partido ya empezó o está por empezar (<20 min)
   */
  canBetOnGame(gameId) {
    const game = this.getGameById(gameId);
    if (!game) return { canBet: false, reason: 'Partido no encontrado' };

    const now = new Date();
    const gameTime = new Date(game.commence_time);
    const minutesUntilGame = (gameTime - now) / 1000 / 60;

    if (minutesUntilGame < 20) {
      return { 
        canBet: false, 
        reason: `El partido inicia en ${Math.round(minutesUntilGame)} minutos. No se permiten apuestas.`
      };
    }

    return { canBet: true };
  }

  /**
   * Obtener resultado de un partido
   */
  async getGameResult(gameId) {
    try {
      const game = this.getGameById(gameId);
      if (!game) return null;

      // Consultar resultado desde Odds API (si está disponible)
      const response = await axios.get(`${ODDS_BASE_URL}/sports/${game.sport_key}/scores/`, {
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
