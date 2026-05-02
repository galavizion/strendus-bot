const whatsappService = require('../services/whatsappService');
const strendusAPI = require('../services/strendusAPI');
const oddsService = require('../services/oddsService');
const aiService = require('../services/aiService');

// Almacenamiento temporal de estados de conversación (en producción usar Redis)
const userStates = new Map();
const pendingConfirmations = new Map();

class BotController {
  /**
   * Manejar mensaje entrante
   */
  async handleMessage(from, message) {
    try {
      const msgType = message.type;

      if (msgType === 'text') {
        await this.handleTextMessage(from, message.text.body);
      } else if (msgType === 'interactive') {
        await this.handleInteractiveMessage(from, message.interactive);
      }
    } catch (error) {
      console.error('Error manejando mensaje:', error);
      await whatsappService.sendText(
        from,
        '❌ Ocurrió un error. Por favor intenta de nuevo o escribe "menu" para ver las opciones.'
      );
    }
  }

  /**
   * Manejar mensajes de texto
   */
  async handleTextMessage(from, text) {
    const lowerText = text.toLowerCase().trim();

    // Estado pendiente (captura de monto, cliente ID, etc.)
    const state = userStates.get(from);
    if (state) return this.handleStateResponse(from, text, state);

    // Comandos cortos explícitos — solo palabras sueltas, no frases
    const word = lowerText.replace(/[¿?!¡.,]/g, '').trim();
    if (['hola', 'menu', 'menú', 'inicio', 'ayuda', 'help', 'opciones'].includes(word))
      return this.showMainMenu(from);
    if (['saldo', 'balance'].includes(word))
      return this.askBalanceConfirmation(from);
    if (['historial', 'apuestas'].includes(word))
      return this.showBetHistory(from);
    if (['momios', 'deportes', 'partidos'].includes(word))
      return this.showSportsList(from);
    if (['cancelar', 'cancel'].includes(word))
      return this.showPendingBetsToCancel(from);

    // Todo lo demás: búsqueda inteligente + AI
    const searchResult = await this.tryGameSearch(from, text, lowerText);
    if (searchResult !== null) return searchResult;

    return this.provideGuidance(from, lowerText);
  }

  /**
   * Manejar respuestas interactivas (botones y listas)
   */
  async handleInteractiveMessage(from, interactive) {
    const responseId = interactive.button_reply?.id || interactive.list_reply?.id;

    console.log(`🔘 Respuesta interactiva: ${responseId}`);

    // Verificar timeouts de confirmación
    const confirmation = pendingConfirmations.get(from);
    if (confirmation && responseId.startsWith('confirm_')) {
      clearTimeout(confirmation.timeout);
      pendingConfirmations.delete(from);
    }

    // Menú principal
    if (responseId === 'btn_odds') return this.showSportsList(from);
    if (responseId === 'btn_history') return this.showBetHistory(from);
    if (responseId === 'btn_balance') return this.askBalanceConfirmation(from);

    // Usuario no registrado
    if (responseId === 'btn_register') return this.sendRegistrationLink(from);
    if (responseId === 'btn_already') return this.askClientId(from);

    // Confirmación de saldo
    if (responseId === 'confirm_balance_yes') return this.showBalance(from);
    if (responseId === 'confirm_balance_no') return this.showMainMenu(from);

    // Selección de deporte
    if (responseId.startsWith('sport_')) return this.showGamesList(from, responseId);

    // Ver otros partidos (desde confirmación)
    if (responseId === 'show_sports') return this.showSportsList(from);

    // Selección de partido
    if (responseId.startsWith('game_')) return this.showGameBetting(from, responseId);

    // Selección de equipo/apuesta
    if (responseId.startsWith('bet_')) return this.selectBetTeam(from, responseId);

    // Montos de apuesta
    if (responseId === 'amount_custom') return this.askCustomAmount(from);
    if (responseId.startsWith('amount_')) return this.selectBetAmount(from, responseId);

    // Confirmación de apuesta
    if (responseId.startsWith('confirm_')) return this.confirmBet(from);
    if (responseId === 'cancel_bet') return this.cancelBetProcess(from);

    // Detalles de apuesta del historial
    if (responseId.startsWith('history_')) return this.showBetDetails(from, responseId);

    // Cancelación de apuesta pendiente
    if (responseId.startsWith('cancelbet_')) return this.cancelPendingBet(from, responseId);
  }

  /**
   * Mostrar menú principal
   */
  async showMainMenu(from) {
    const verification = strendusAPI.verifyUser(from);

    if (!verification.exists) {
      const msgData = whatsappService.buildUnregisteredMessage();
      return whatsappService.sendButtons(from, msgData.body, msgData.buttons);
    }

    const { name, balance } = verification.user;
    const msgData = whatsappService.buildWelcomeMessage(name, balance);
    return whatsappService.sendButtons(from, msgData.body, msgData.buttons, null, msgData.footer);
  }

  /**
   * Preguntar confirmación para ver saldo
   */
  async askBalanceConfirmation(from) {
    const body = '¿Quieres consultar tu saldo actual?';
    const buttons = [
      { id: 'confirm_balance_yes', title: '✅ Sí' },
      { id: 'confirm_balance_no', title: '❌ No' }
    ];

    return whatsappService.sendButtons(from, body, buttons, null, whatsappService.getFooter('balanceConfirm'));
  }

  /**
   * Mostrar saldo
   */
  async showBalance(from) {
    const userInfo = strendusAPI.getUserInfo(from);

    if (!userInfo) {
      return whatsappService.sendText(from, '❌ Error obteniendo tu saldo.');
    }

    const message = `💰 *Saldo actual*\n\n` +
                    `Disponible: $${userInfo.balance.toLocaleString('es-MX')} MXN\n\n` +
                    `📊 Estadísticas:\n` +
                    `• Apuestas totales: ${userInfo.totalBets}\n` +
                    `• Apuestas pendientes: ${userInfo.pendingBets}\n` +
                    `• Ganadas: ${userInfo.wonBets}\n` +
                    `• Perdidas: ${userInfo.lostBets}`;

    return whatsappService.sendText(from, message);
  }

  /**
   * Mostrar lista de deportes
   */
  async showSportsList(from) {
    const msgData = whatsappService.buildSportsListMessage();
    
    return whatsappService.sendList(
      from,
      msgData.body,
      msgData.buttonText,
      msgData.sections,
      msgData.header,
      msgData.footer
    );
  }

  /**
   * Mostrar lista de partidos de un deporte
   */
  async showGamesList(from, sportId) {
    const sportMap = {
      'sport_nba': { key: 'basketball_nba', emoji: '🏀', title: 'NBA' },
      'sport_mlb': { key: 'baseball_mlb', emoji: '⚾', title: 'MLB' },
      'sport_ligamx': { key: 'soccer_mexico_ligamx', emoji: '⚽', title: 'Liga MX' }
    };

    const sport = sportMap[sportId];
    if (!sport) return;

    const games = await oddsService.getOrFetchOdds(sport.key, 3);

    if (games.length === 0) {
      return whatsappService.sendText(
        from,
        `⏰ No hay partidos de ${sport.title} disponibles en este momento.\n\nLos próximos partidos inician muy pronto o no hay eventos programados.`
      );
    }

    const msgData = whatsappService.buildGamesListMessage(games, sport.emoji, sport.title);
    
    if (!msgData) {
      return whatsappService.sendText(from, '❌ Error cargando los partidos.');
    }

    return whatsappService.sendList(
      from,
      msgData.body,
      msgData.buttonText,
      msgData.sections,
      msgData.header,
      msgData.footer
    );
  }

  /**
   * Mostrar opciones de apuesta de un partido
   */
  async showGameBetting(from, gameId) {
    const actualGameId = gameId.replace('game_', '');
    const game = oddsService.getGameById(actualGameId);

    if (!game) {
      return whatsappService.sendText(from, '❌ Partido no encontrado.');
    }

    // Verificar si se puede apostar
    const canBet = oddsService.canBetOnGame(actualGameId);
    if (!canBet.canBet) {
      return whatsappService.sendText(from, `❌ ${canBet.reason}`);
    }

    const sportEmoji = oddsService.getSportEmoji(game.sport_key);
    const msgData = whatsappService.buildGameBettingMessage(game, sportEmoji);

    if (!msgData) {
      return whatsappService.sendText(from, '❌ No hay momios disponibles para este partido.');
    }

    return whatsappService.sendButtons(from, msgData.body, msgData.buttons);
  }

  /**
   * Seleccionar equipo para apostar
   */
  async selectBetTeam(from, betId) {
    // Formato: bet_{gameId}_{team}_{odds}
    const parts = betId.replace('bet_', '').split('_');
    const gameId = parts[0];
    const odds = parseFloat(parts[parts.length - 1]);
    const team = parts.slice(1, -1).join('_');

    const game = oddsService.getGameById(gameId);
    if (!game) {
      return whatsappService.sendText(from, '❌ Partido no encontrado.');
    }

    // Guardar selección en estado
    userStates.set(from, {
      type: 'betting',
      gameId,
      game,
      team,
      odds
    });

    // Mostrar montos
    const potentialWins = {
      200: Math.round(200 * odds),
      500: Math.round(500 * odds),
      1000: Math.round(1000 * odds)
    };

    const body = `✅ Seleccionaste: ${team} (${odds})\n\n` +
                 `Si apuestas $500, ganarías $${potentialWins[500].toLocaleString('es-MX')}\n\n` +
                 `¿Cuánto quieres apostar?`;

    const msgData = whatsappService.buildAmountsListMessage(team, odds, potentialWins, body);
    return whatsappService.sendList(from, msgData.body, msgData.buttonText, msgData.sections, null, msgData.footer);
  }

  /**
   * Seleccionar monto de apuesta
   */
  async selectBetAmount(from, amountId) {
    const state = userStates.get(from);
    if (!state || state.type !== 'betting') {
      return whatsappService.sendText(from, '❌ Sesión expirada. Por favor inicia de nuevo.');
    }

    const amount = parseInt(amountId.replace('amount_', ''));
    state.amount = amount;
    state.potentialWin = Math.round(amount * state.odds);

    userStates.set(from, state);

    return this.showBetConfirmation(from);
  }

  /**
   * Pedir monto personalizado
   */
  async askCustomAmount(from) {
    const state = userStates.get(from);
    if (!state || state.type !== 'betting') {
      return whatsappService.sendText(from, '❌ Sesión expirada.');
    }

    state.awaitingCustomAmount = true;
    userStates.set(from, state);

    return whatsappService.sendText(from, '💵 Escribe el monto que quieres apostar (solo números):');
  }

  /**
   * Mostrar confirmación de apuesta
   */
  async showBetConfirmation(from) {
    const state = userStates.get(from);
    const balance = strendusAPI.getBalance(from);

    if (state.amount > balance) {
      userStates.delete(from);
      return whatsappService.sendText(
        from,
        `❌ Saldo insuficiente.\n\nTu saldo actual es $${balance.toLocaleString('es-MX')} MXN`
      );
    }

    const msgData = whatsappService.buildBetConfirmationMessage(state, balance);
    
    // Iniciar timeout de 60 segundos
    const timeout = setTimeout(() => {
      if (userStates.has(from)) {
        userStates.delete(from);
        pendingConfirmations.delete(from);
        whatsappService.sendText(from, '❌ Tiempo agotado. Apuesta cancelada.');
      }
    }, 60000);

    // Aviso a los 40 segundos
    setTimeout(() => {
      if (userStates.has(from)) {
        whatsappService.sendText(from, '⏱️ Te quedan 20 segundos para confirmar o se cancelará la apuesta.');
      }
    }, 40000);

    pendingConfirmations.set(from, { timeout });

    return whatsappService.sendButtons(from, msgData.body, msgData.buttons);
  }

  /**
   * Confirmar apuesta
   */
  async confirmBet(from) {
    const state = userStates.get(from);
    if (!state || state.type !== 'betting') {
      return whatsappService.sendText(from, '❌ Sesión expirada.');
    }

    // Verificar nuevamente que el partido aún acepta apuestas
    const canBet = oddsService.canBetOnGame(state.gameId);
    if (!canBet.canBet) {
      userStates.delete(from);
      return whatsappService.sendText(from, `❌ ${canBet.reason}`);
    }

    // Crear apuesta
    const result = strendusAPI.createBet(from, {
      gameId: state.gameId,
      game: {
        home_team: state.game.home_team,
        away_team: state.game.away_team,
        commence_time: state.game.commence_time,
        sport_title: state.game.sport_title
      },
      team: state.team,
      odds: state.odds,
      amount: state.amount,
      potentialWin: state.potentialWin
    });

    userStates.delete(from);

    if (!result.success) {
      return whatsappService.sendText(from, `❌ ${result.message}`);
    }

    const message = `🎉 ¡Apuesta registrada!\n\n` +
                    `${state.game.home_team} vs ${state.game.away_team}\n` +
                    `Apuestas a: ${state.team} (${state.odds})\n` +
                    `Monto: $${state.amount.toLocaleString('es-MX')}\n` +
                    `Ganancia potencial: $${state.potentialWin.toLocaleString('es-MX')}\n\n` +
                    `💰 Saldo actual: $${result.newBalance.toLocaleString('es-MX')} MXN\n\n` +
                    `Te notificaremos el resultado cuando termine el partido.`;

    return whatsappService.sendText(from, message);
  }

  /**
   * Cancelar proceso de apuesta
   */
  async cancelBetProcess(from) {
    userStates.delete(from);
    return whatsappService.sendText(from, '❌ Apuesta cancelada.\n\nEscribe "menu" para ver las opciones.');
  }

  /**
   * Mostrar historial de apuestas
   */
  async showBetHistory(from) {
    const bets = strendusAPI.getBetHistory(from, 15);

    if (bets.length === 0) {
      return whatsappService.sendText(from, '📋 No tienes apuestas registradas aún.');
    }

    const rows = bets.map(bet => {
      let status = '';
      if (bet.status === 'won') status = '✅ Ganada';
      else if (bet.status === 'lost') status = '❌ Perdida';
      else if (bet.status === 'pending') status = '⏳ Pendiente';
      else if (bet.status === 'cancelled') status = '🚫 Cancelada';

      return {
        id: `history_${bet.id}`,
        title: `${bet.game.home_team} vs ${bet.game.away_team}`.substring(0, 24),
        description: `$${bet.amount} ${status}`
      };
    });

    return whatsappService.sendList(
      from,
      'Selecciona una apuesta para ver detalles:',
      whatsappService.getListButton('history'),
      [{ title: `Últimas ${bets.length} apuestas`, rows }],
      '📋 Historial de apuestas',
      whatsappService.getFooter('betHistory')
    );
  }

  /**
   * Mostrar detalles de una apuesta
   */
  async showBetDetails(from, historyId) {
    const betId = historyId.replace('history_', '');
    const bet = strendusAPI.getBet(from, betId);

    if (!bet) {
      return whatsappService.sendText(from, '❌ Apuesta no encontrada.');
    }

    let statusText = '';
    if (bet.status === 'won') statusText = '✅ GANADA';
    else if (bet.status === 'lost') statusText = '❌ PERDIDA';
    else if (bet.status === 'pending') statusText = '⏳ PENDIENTE';
    else if (bet.status === 'cancelled') statusText = '🚫 CANCELADA';

    const emoji = oddsService.getSportEmoji(bet.game.sport_key || 'unknown');
    const date = new Date(bet.createdAt).toLocaleString('es-MX', {
      timeZone: 'America/Mexico_City',
      dateStyle: 'short',
      timeStyle: 'short'
    });

    let message = `📊 Detalle de apuesta\n\n` +
                  `${emoji} ${bet.game.home_team} vs ${bet.game.away_team}\n` +
                  `${statusText}\n\n` +
                  `Apostaste a: ${bet.team} (${bet.odds})\n` +
                  `Monto: $${bet.amount.toLocaleString('es-MX')}\n`;

    if (bet.status === 'won') {
      message += `Ganancia: +$${bet.potentialWin.toLocaleString('es-MX')}\n`;
    } else if (bet.status === 'lost') {
      message += `Pérdida: -$${bet.amount.toLocaleString('es-MX')}\n`;
    } else {
      message += `Ganancia potencial: $${bet.potentialWin.toLocaleString('es-MX')}\n`;
    }

    message += `\n📅 ${date}\n`;
    
    if (bet.result) {
      message += `\nResultado: ${bet.result.homeScore || 0} - ${bet.result.awayScore || 0}`;
    }

    message += `\n──────────\n${bet.game.sport_title || 'Deporte'}`;

    return whatsappService.sendText(from, message);
  }

  /**
   * Mostrar apuestas pendientes para cancelar
   */
  async showPendingBetsToCancel(from) {
    const pendingBets = strendusAPI.getPendingBets(from);

    if (pendingBets.length === 0) {
      return whatsappService.sendText(from, '📋 No tienes apuestas pendientes para cancelar.');
    }

    const rows = pendingBets.map(bet => ({
      id: `cancelbet_${bet.id}`,
      title: `${bet.game.home_team} vs ${bet.game.away_team}`.substring(0, 24),
      description: `$${bet.amount} - ${bet.team}`
    }));

    return whatsappService.sendList(
      from,
      'Selecciona una apuesta para cancelar:',
      whatsappService.getListButton('cancel'),
      [{ title: `${pendingBets.length} apuestas pendientes`, rows }],
      '🚫 Cancelar apuesta',
      whatsappService.getFooter('cancelBet')
    );
  }

  /**
   * Cancelar apuesta pendiente
   */
  async cancelPendingBet(from, cancelId) {
    const betId = cancelId.replace('cancelbet_', '');
    const bet = strendusAPI.getBet(from, betId);

    if (!bet) {
      return whatsappService.sendText(from, '❌ Apuesta no encontrada.');
    }

    // Verificar que falten más de 20 minutos
    const game = oddsService.getGameById(bet.gameId);
    if (game) {
      const now = new Date();
      const gameTime = new Date(game.commence_time);
      const minutesUntilGame = (gameTime - now) / 1000 / 60;

      if (minutesUntilGame < 20) {
        return whatsappService.sendText(
          from,
          `❌ No puedes cancelar. El partido inicia en ${Math.round(minutesUntilGame)} minutos.`
        );
      }
    }

    const result = strendusAPI.cancelBet(from, betId);

    if (!result.success) {
      return whatsappService.sendText(from, `❌ ${result.message}`);
    }

    return whatsappService.sendText(
      from,
      `✅ Apuesta cancelada\n\nSe devolvieron $${result.refundedAmount.toLocaleString('es-MX')} a tu cuenta\n\n💰 Saldo actual: $${result.newBalance.toLocaleString('es-MX')} MXN`
    );
  }

  /**
   * Enviar link de registro
   */
  async sendRegistrationLink(from) {
    const registerUrl = process.env.COMPANY_REGISTRATION_URL || 'https://www.strendus.com/registro';
    
    return whatsappService.sendText(
      from,
      `📝 Regístrate en Strendus:\n\n${registerUrl}\n\nUna vez registrado, vuelve a escribir aquí para comenzar a apostar.`
    );
  }

  /**
   * Pedir número de cliente
   */
  async askClientId(from) {
    userStates.set(from, { type: 'awaiting_client_id' });
    
    return whatsappService.sendText(
      from,
      'Por favor, escribe tu número de cliente o correo registrado para verificar tu cuenta.'
    );
  }

  /**
   * Manejar respuesta según estado
   */
  async handleStateResponse(from, text, state) {
    if (state.type === 'awaiting_client_id') {
      return this.verifyClientId(from, text);
    }

    if (state.type === 'betting' && state.awaitingCustomAmount) {
      return this.handleCustomAmount(from, text);
    }

    userStates.delete(from);
    return this.showMainMenu(from);
  }

  /**
   * Verificar número de cliente
   */
  async verifyClientId(from, clientId) {
    const result = strendusAPI.verifyByClientId(clientId.trim(), from);

    userStates.delete(from);

    if (!result.success) {
      let message = `❌ Error de verificación\n\n${result.message}\n\n`;
      
      if (result.registeredPhone) {
        message += `Por favor:\n• Ingresa desde el número registrado, o\n• Actualiza tu teléfono en: ${process.env.COMPANY_WEBSITE}/perfil\n\n`;
      }
      
      message += '¿Necesitas ayuda? Contacta a soporte.';
      
      return whatsappService.sendText(from, message);
    }

    // Usuario verificado exitosamente
    const { name, balance } = result.user;
    const msgData = whatsappService.buildWelcomeMessage(name, balance);
    return whatsappService.sendButtons(from, msgData.body, msgData.buttons, null, msgData.footer);
  }

  /**
   * Manejar monto personalizado
   */
  async handleCustomAmount(from, text) {
    const amount = parseInt(text.trim());

    if (isNaN(amount) || amount <= 0) {
      return whatsappService.sendText(
        from,
        '❌ Monto inválido. Escribe solo números (ej: 350)'
      );
    }

    const state = userStates.get(from);
    state.amount = amount;
    state.potentialWin = Math.round(amount * state.odds);
    delete state.awaitingCustomAmount;

    userStates.set(from, state);

    return this.showBetConfirmation(from);
  }

  /**
   * Proveer guía educativa
   */
  async provideGuidance(from, text) {
    if (text.includes('apuest') || text.includes('historial') || text.includes('anterior')) {
      return whatsappService.sendText(
        from,
        `Puedes ver tu historial de apuestas escribiendo 'historial' o 'mis apuestas'.\n\nTambién puedes escribir 'menu' para ver todas las opciones disponibles 📋`
      );
    }

    if (text.includes('saldo') || text.includes('dinero') || text.includes('cuanto')) {
      return whatsappService.sendText(
        from,
        `Puedes consultar tu saldo escribiendo 'saldo' o 'balance'.\n\nTambién puedes escribir 'menu' para ver todas las opciones disponibles 📋`
      );
    }

    if (text.includes('apostar') || text.includes('como') || text.includes('momio')) {
      return whatsappService.sendText(
        from,
        `Para realizar una apuesta:\n1. Escribe 'momios' o 'deportes'\n2. Selecciona un deporte\n3. Elige un partido\n4. Selecciona tu apuesta\n\nTambién puedes escribir 'menu' para ver todas las opciones 📋`
      );
    }

    return this.showMainMenu(from);
  }

  /**
   * Búsqueda inteligente: si el texto menciona un equipo o deporte, muestra
   * los partidos directamente. Si pregunta qué apostar, recomienda opciones.
   * Retorna null si no hay coincidencia (para que provideGuidance tome el control).
   */
  async tryGameSearch(from, text, lowerText) {
    // 1. Keyword matching rápido (sin costo de API)
    const games = await oddsService.searchGames(lowerText);
    if (games.length > 0) return this.showSearchResults(from, games);

    // 2. Recomendación explícita por keywords
    const isReco =
      /\d+\s*(pesos?|mxn)/i.test(text) && lowerText.includes('apostar') ||
      ['en que puedo apostar', 'en que apostar', 'que puedo apostar', 'donde apuesto',
       'que hay para apostar', 'hay algo para apostar', 'recomienda', 'recomiendame']
        .some(p => lowerText.includes(p));

    if (isReco) return this.showRecommendations(from);

    // 3. IA como fallback: entiende lenguaje libre que no matcheó keywords
    const intent = await aiService.parseIntent(text);
    if (!intent || intent.intent === 'none') return null;

    if (intent.intent === 'recommend') return this.showRecommendations(from);

    if (intent.intent === 'search_game') {
      // Si mencionó equipo específico, busca por ese equipo
      if (intent.team) {
        const byTeam = await oddsService.searchGames(intent.team);
        if (byTeam.length > 0) return this.showSearchResults(from, byTeam);
      }
      // Si solo mencionó deporte, muestra los juegos de ese deporte
      if (intent.sport) {
        const bySport = await oddsService.getOrFetchOdds(intent.sport, 5);
        if (bySport.length > 0) return this.showSearchResults(from, bySport);
      }
      // Sin juegos disponibles
      return whatsappService.sendText(
        from,
        '⏰ No encontré partidos disponibles para eso.\n\nEscribe *momios* para ver todos los deportes.'
      );
    }

    return null;
  }

  async showRecommendations(from) {
    const [nba, mlb, liga] = await Promise.all([
      oddsService.getOrFetchOdds('basketball_nba', 2),
      oddsService.getOrFetchOdds('baseball_mlb', 2),
      oddsService.getOrFetchOdds('soccer_mexico_ligamx', 2)
    ]);
    const all = [...nba, ...mlb, ...liga].filter(g => g.bookmakers?.length > 0);

    if (all.length === 0) {
      return whatsappService.sendText(
        from,
        '⏰ No hay partidos con momios disponibles en este momento.\n\nEscribe *momios* para ver todas las opciones.'
      );
    }
    return this.showSearchResults(from, all);
  }

  /**
   * Muestra los resultados de búsqueda. Un resultado → confirmación. Varios → lista.
   */
  async showSearchResults(from, games) {
    if (games.length === 1) {
      return this.showGameConfirmation(from, games[0]);
    }

    const rows = games.slice(0, 10).map(game => {
      const emoji = oddsService.getSportEmoji(game.sport_key);
      const date = whatsappService.formatGameDate(game.commence_time);
      const noOdds = game.bookmakers?.length > 0 ? '' : ' ⚠️';
      return {
        id: `game_${game.id}`,
        title: `${emoji} ${game.home_team} vs ${game.away_team}`.substring(0, 24),
        description: date + noOdds
      };
    });

    return whatsappService.sendList(
      from,
      `Encontré ${games.length} partido${games.length > 1 ? 's' : ''} disponible${games.length > 1 ? 's' : ''}:\n\n¿En cuál quieres apostar?`,
      whatsappService.getListButton('games'),
      [{ title: 'Partidos', rows }]
    );
  }

  /**
   * Muestra el partido encontrado con selección de equipo directa + opción de buscar otro.
   * Usa lista para poder incluir siempre "Ver otros" sin importar cuántos equipos haya.
   */
  async showGameConfirmation(from, game) {
    const emoji = oddsService.getSportEmoji(game.sport_key);
    const date = oddsService.formatGameDate(game.commence_time);
    const market = game.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');

    const body =
      `${emoji} *${game.sport_title}*\n` +
      `*${game.home_team}* vs *${game.away_team}*\n` +
      `📅 ${date}\n\n` +
      (market ? '¿A quién le apuestas?' : '⚠️ Sin momios disponibles aún.\n¿Quieres ver otros partidos?');

    if (!market) {
      return whatsappService.sendButtons(from, body, [
        { id: 'show_sports', title: '🔍 Ver otros partidos' }
      ]);
    }

    const betRows = market.outcomes.map(o => ({
      id: `bet_${game.id}_${o.name}_${o.price}`,
      title: o.name === 'Draw' ? `Empate` : o.name.substring(0, 24),
      description: `Momio: ${parseFloat(o.price).toFixed(2)}`
    }));

    return whatsappService.sendList(
      from,
      body,
      whatsappService.getListButton('games'),
      [
        { title: 'Selecciona tu apuesta', rows: betRows },
        { title: 'Otras opciones', rows: [{ id: 'show_sports', title: '🔍 Ver otros partidos', description: 'Buscar otro partido' }] }
      ]
    );
  }

  // === HELPERS PARA TRIGGERS ===

  isMenuTrigger(text) {
    return ['hola', 'menu', 'menú', 'ayuda', 'opciones', 'inicio', 'help'].includes(text);
  }
}

module.exports = new BotController();
