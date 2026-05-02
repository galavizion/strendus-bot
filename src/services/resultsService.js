const cron = require('node-cron');
const oddsService = require('./oddsService');
const strendusAPI = require('./strendusAPI');
const whatsappService = require('./whatsappService');

class ResultsService {
  constructor() {
    this.isProcessing = false;
  }

  /**
   * Iniciar el cron job para procesar resultados
   */
  start() {
    // Ejecutar cada 5 minutos
    cron.schedule('*/5 * * * *', async () => {
      console.log('🔄 Verificando resultados de partidos...');
      await this.processResults();
    });

    console.log('✅ Servicio de resultados iniciado (cada 5 minutos)');
  }

  /**
   * Procesar resultados de todas las apuestas pendientes
   */
  async processResults() {
    if (this.isProcessing) {
      console.log('⏭️ Ya hay un proceso en ejecución, saltando...');
      return;
    }

    this.isProcessing = true;

    try {
      const [pendingBets, pendingParlays] = await Promise.all([
        strendusAPI.getAllPendingBets(),
        strendusAPI.getAllPendingParlays()
      ]);

      if (pendingBets.length === 0 && pendingParlays.length === 0) {
        console.log('📊 No hay apuestas pendientes para procesar');
        this.isProcessing = false;
        return;
      }

      console.log(`📊 Procesando ${pendingBets.length} apuestas y ${pendingParlays.length} parlays pendientes...`);

      for (const bet of pendingBets) {
        await this.processBet(bet);
      }

      for (const parlay of pendingParlays) {
        await this.processParlay(parlay);
      }

      console.log('✅ Procesamiento de resultados completado');
    } catch (error) {
      console.error('❌ Error procesando resultados:', error);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Procesar resultado de una apuesta individual
   */
  async processBet(bet) {
    try {
      const result = await oddsService.getGameResult(bet.gameId, bet.game);

      if (!result || !result.completed) return;

      const won = result.winner === bet.team;

      const updateResult = await strendusAPI.updateBetResult(
        bet.userPhone,
        bet.id,
        won,
        result
      );

      if (!updateResult || !updateResult.success) {
        console.error(`❌ Error actualizando apuesta ${bet.id}`);
        return;
      }

      await this.notifyUser(bet, won, result, updateResult.newBalance);

      console.log(`✅ Apuesta ${bet.id} procesada: ${won ? 'GANADA' : 'PERDIDA'}`);
    } catch (error) {
      console.error(`❌ Error procesando apuesta ${bet.id}:`, error);
    }
  }

  /**
   * Notificar al usuario del resultado
   */
  async notifyUser(bet, won, result, newBalance) {
    try {
      if (won) {
        // Usuario ganó
        const message = `🎉 ¡GANASTE!\n\n` +
                        `${bet.game.home_team} vs ${bet.game.away_team}\n` +
                        `Resultado final: ${result.homeScore} - ${result.awayScore}\n\n` +
                        `Tu apuesta: ${bet.team} (${bet.odds}) - $${bet.amount.toLocaleString('es-MX')}\n` +
                        `Ganancia: +$${bet.potentialWin.toLocaleString('es-MX')}\n\n` +
                        `💰 Nuevo saldo: $${newBalance.toLocaleString('es-MX')} MXN`;

        await whatsappService.sendText(bet.userPhone, message);
      } else {
        const message = `😔 Perdiste esta apuesta\n\n` +
                        `${bet.game.home_team} vs ${bet.game.away_team}\n` +
                        `Resultado final: ${result.homeScore} - ${result.awayScore}\n\n` +
                        `Tu apuesta: ${bet.team} (${bet.odds}) - $${bet.amount.toLocaleString('es-MX')}\n\n` +
                        `💰 Saldo actual: $${newBalance.toLocaleString('es-MX')} MXN`;

        await whatsappService.sendText(bet.userPhone, message);
      }
    } catch (error) {
      console.error('❌ Error enviando notificación:', error);
    }
  }

  async processParlay(parlay) {
    try {
      for (const leg of parlay.legs) {
        if (leg.status !== 'pending') continue;

        const result = await oddsService.getGameResult(leg.gameId, leg.game);
        if (!result || !result.completed) continue;

        const won = result.winner === leg.team;
        const update = await strendusAPI.settleParlayLeg(parlay.id, leg.gameId, won, result);

        if (!update) continue;

        if (update.settled) {
          await this.notifyParlayResult(update.parlay, update.won, update.newBalance);
          console.log(`✅ Parlay ${parlay.id}: ${update.won ? 'GANADO' : 'PERDIDO'}`);
          return;
        }
      }
    } catch (error) {
      console.error(`❌ Error procesando parlay ${parlay.id}:`, error);
    }
  }

  async notifyParlayResult(parlay, won, newBalance) {
    try {
      const phone = parlay.userPhone;

      if (won) {
        const legsText = parlay.legs
          .map((l, i) => `${i + 1}. ${l.game.home_team} vs ${l.game.away_team} → ${l.team === 'Draw' ? 'Empate' : l.team} ✅`)
          .join('\n');

        const message = `🎉 ¡GANASTE EL PARLAY!\n\n${legsText}\n\n` +
          `Cuota combinada: ${parlay.combinedOdds}x\n` +
          `Ganancia: +$${parlay.potentialWin.toLocaleString('es-MX')}\n\n` +
          `💰 Nuevo saldo: $${newBalance.toLocaleString('es-MX')} MXN`;

        await whatsappService.sendText(phone, message);
      } else {
        const lostLeg = parlay.legs.find(l => l.status === 'lost');
        const message = `📊 Parlay finalizado\n\n` +
          `❌ ${lostLeg.game.home_team} vs ${lostLeg.game.away_team}\n` +
          `Resultado: ${lostLeg.result.homeScore} - ${lostLeg.result.awayScore}\n\n` +
          `💰 Saldo actual: $${newBalance.toLocaleString('es-MX')} MXN`;

        await whatsappService.sendText(phone, message);
      }
    } catch (error) {
      console.error('❌ Error notificando parlay:', error);
    }
  }

  /**
   * Procesar resultados manualmente (para testing)
   */
  async processManually() {
    console.log('🔄 Procesamiento manual iniciado...');
    await this.processResults();
  }
}

module.exports = new ResultsService();
