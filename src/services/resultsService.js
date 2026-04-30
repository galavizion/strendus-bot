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
      const pendingBets = strendusAPI.getAllPendingBets();

      if (pendingBets.length === 0) {
        console.log('📊 No hay apuestas pendientes para procesar');
        this.isProcessing = false;
        return;
      }

      console.log(`📊 Procesando ${pendingBets.length} apuestas pendientes...`);

      for (const bet of pendingBets) {
        await this.processBet(bet);
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
      // Obtener resultado del partido
      const result = await oddsService.getGameResult(bet.gameId);

      if (!result || !result.completed) {
        // Partido aún no termina
        return;
      }

      // Determinar si ganó o perdió
      const won = result.winner === bet.team;

      // Actualizar apuesta en el sistema
      const updateResult = strendusAPI.updateBetResult(
        bet.userPhone,
        bet.id,
        won,
        result
      );

      if (!updateResult.success) {
        console.error(`❌ Error actualizando apuesta ${bet.id}`);
        return;
      }

      // Enviar notificación al usuario
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
        // Usuario perdió - mensaje neutral
        const message = `📊 Partido finalizado\n\n` +
                        `${bet.game.home_team} vs ${bet.game.away_team}\n` +
                        `Resultado: ${result.homeScore} - ${result.awayScore}\n\n` +
                        `💰 Saldo actual: $${newBalance.toLocaleString('es-MX')} MXN`;

        await whatsappService.sendText(bet.userPhone, message);
      }
    } catch (error) {
      console.error('❌ Error enviando notificación:', error);
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
