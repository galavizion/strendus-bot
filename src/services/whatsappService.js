const axios = require('axios');

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

class WhatsAppService {
  /**
   * Enviar mensaje a WhatsApp
   */
  async sendMessage(to, messageData) {
    try {
      const response = await axios.post(
        WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          to: to,
          ...messageData
        },
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`✅ Mensaje enviado a ${to}`);
      return response.data;
    } catch (error) {
      console.error('❌ Error enviando mensaje:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Enviar mensaje de texto simple
   */
  async sendText(to, text) {
    return this.sendMessage(to, {
      type: 'text',
      text: { body: text }
    });
  }

  /**
   * Enviar mensaje con botones
   */
  async sendButtons(to, body, buttons, header = null) {
    const message = {
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.map((btn, idx) => ({
            type: 'reply',
            reply: {
              id: btn.id || `btn_${idx}`,
              title: btn.title.substring(0, 20) // WhatsApp limita a 20 caracteres
            }
          }))
        }
      }
    };

    if (header) {
      message.interactive.header = { type: 'text', text: header };
    }

    return this.sendMessage(to, message);
  }

  /**
   * Enviar lista interactiva
   */
  async sendList(to, body, buttonText, sections, header = null, footer = null) {
    const message = {
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText,
          sections: sections
        }
      }
    };

    if (header) {
      message.interactive.header = { type: 'text', text: header };
    }

    if (footer) {
      message.interactive.footer = { text: footer };
    }

    return this.sendMessage(to, message);
  }

  /**
   * Marcar mensaje como leído
   */
  async markAsRead(messageId) {
    try {
      await axios.post(
        WHATSAPP_API_URL,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId
        },
        {
          headers: {
            'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
            'Content-Type': 'application/json'
          }
        }
      );
    } catch (error) {
      console.error('Error marcando como leído:', error.message);
    }
  }

  /**
   * Construir mensaje de bienvenida para usuario registrado
   */
  buildWelcomeMessage(userName, balance) {
    return {
      body: `Hola ${userName} 👋\n\nBienvenido a Strendus\n\n💰 Saldo disponible: $${balance.toLocaleString('es-MX')} MXN\n\n¿Qué quieres hacer?`,
      buttons: [
        { id: 'btn_odds', title: '📊 Ver momios' },
        { id: 'btn_history', title: '📋 Mis apuestas' },
        { id: 'btn_balance', title: '💰 Mi saldo' }
      ]
    };
  }

  /**
   * Construir mensaje para usuario no registrado
   */
  buildUnregisteredMessage() {
    return {
      body: `Hola 👋\n\nNotamos que no estás registrado con nosotros.\n\n¿Quieres crear tu cuenta?`,
      buttons: [
        { id: 'btn_register', title: '📝 Registrarme' },
        { id: 'btn_already', title: '✅ Ya me registré' }
      ]
    };
  }

  /**
   * Construir lista de deportes
   */
  buildSportsListMessage() {
    return {
      header: 'Apuestas disponibles',
      body: '📊 Selecciona un deporte para ver los momios actuales:',
      buttonText: 'Ver deportes',
      sections: [{
        title: 'Deportes disponibles',
        rows: [
          {
            id: 'sport_nba',
            title: '🏀 NBA',
            description: 'Basquetbol profesional'
          },
          {
            id: 'sport_mlb',
            title: '⚾ MLB',
            description: 'Beisbol profesional'
          },
          {
            id: 'sport_ligamx',
            title: '⚽ Liga MX',
            description: 'Fútbol mexicano'
          }
        ]
      }],
      footer: 'Actualizado hace 2 min'
    };
  }

  /**
   * Construir lista de partidos
   */
  buildGamesListMessage(games, sportEmoji, sportTitle) {
    if (games.length === 0) {
      return null; // Indicar que no hay partidos
    }

    const rows = games.map(game => {
      const date = this.formatGameDate(game.commence_time);
      return {
        id: `game_${game.id}`,
        title: `${game.home_team} vs ${game.away_team}`.substring(0, 24),
        description: date
      };
    });

    return {
      header: `${sportEmoji} ${sportTitle}`,
      body: 'Selecciona un partido para apostar:',
      buttonText: 'Ver partidos',
      sections: [{
        title: `Próximos ${games.length} partidos`,
        rows: rows
      }],
      footer: sportTitle
    };
  }

  /**
   * Construir mensaje de partido con opciones de apuesta
   */
  buildGameBettingMessage(game, sportEmoji) {
    const date = this.formatGameDate(game.commence_time);
    const bookmaker = game.bookmakers?.[0];
    
    if (!bookmaker) {
      return null;
    }

    const outcomes = bookmaker.markets?.[0]?.outcomes || [];
    
    // Determinar si hay empate (fútbol)
    const hasDraw = outcomes.some(o => o.name === 'Draw');
    
    let body = `${sportEmoji} ${game.home_team} vs ${game.away_team}\n`;
    body += `📍 ${this.getStadium(game)}\n`;
    body += `📅 ${date}\n\n`;
    body += `¿A quién quieres apostar?\n\n`;
    body += `──────────\n${game.sport_title}`;

    const buttons = [];
    
    // Equipo local
    const homeOdds = outcomes.find(o => o.name === game.home_team);
    if (homeOdds) {
      buttons.push({
        id: `bet_${game.id}_${game.home_team}_${homeOdds.price}`,
        title: `${game.home_team.substring(0, 12)} ${homeOdds.price}`
      });
    }

    // Empate (si aplica)
    if (hasDraw) {
      const drawOdds = outcomes.find(o => o.name === 'Draw');
      if (drawOdds) {
        buttons.push({
          id: `bet_${game.id}_Draw_${drawOdds.price}`,
          title: `Empate ${drawOdds.price}`
        });
      }
    }

    // Equipo visitante
    const awayOdds = outcomes.find(o => o.name === game.away_team);
    if (awayOdds) {
      buttons.push({
        id: `bet_${game.id}_${game.away_team}_${awayOdds.price}`,
        title: `${game.away_team.substring(0, 12)} ${awayOdds.price}`
      });
    }

    return { body, buttons };
  }

  /**
   * Construir mensaje de confirmación de apuesta
   */
  buildBetConfirmationMessage(betData, currentBalance) {
    const { game, team, odds, amount, potentialWin } = betData;
    
    const body = `📋 Confirma tu apuesta:\n\n` +
                 `${game.home_team} vs ${game.away_team}\n` +
                 `Apuestas a: ${team} (${odds})\n\n` +
                 `Monto: $${amount.toLocaleString('es-MX')}\n` +
                 `Ganancia potencial: $${potentialWin.toLocaleString('es-MX')}\n\n` +
                 `💰 Saldo actual: $${currentBalance.toLocaleString('es-MX')}\n` +
                 `💰 Saldo después: $${(currentBalance - amount).toLocaleString('es-MX')}`;

    return {
      body,
      buttons: [
        { id: `confirm_${Date.now()}`, title: '✅ Confirmar' },
        { id: 'cancel_bet', title: '❌ Cancelar' }
      ]
    };
  }

  /**
   * Formatear fecha
   */
  formatGameDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.floor((date - now) / (1000 * 60 * 60 * 24));

    let dayText = '';
    if (diffDays === 0) dayText = 'Hoy';
    else if (diffDays === 1) dayText = 'Mañana';
    else dayText = date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });

    const time = date.toLocaleTimeString('es-MX', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true,
      timeZone: 'America/Mexico_City'
    });

    return `${dayText}, ${time}`;
  }

  /**
   * Obtener estadio (simulado)
   */
  getStadium(game) {
    // Aquí se podría integrar una API de estadios, por ahora retornamos genérico
    return 'Por definir';
  }
}

module.exports = new WhatsAppService();
