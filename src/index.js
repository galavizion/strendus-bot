require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cron = require('node-cron');

// Servicios
const oddsService = require('./services/oddsService');
const resultsService = require('./services/resultsService');
const whatsappService = require('./services/whatsappService');
const botController = require('./controllers/botController');
const adminRouter = require('./admin/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());

// Panel de administración
app.use('/admin', adminRouter);

// ============================================
// WEBHOOK DE WHATSAPP
// ============================================

/**
 * GET /webhook - Verificación del webhook por Meta
 */
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.WEBHOOK_VERIFY_TOKEN;

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ Webhook verificado por Meta');
    res.status(200).send(challenge);
  } else {
    console.error('❌ Verificación de webhook falló');
    res.sendStatus(403);
  }
});

/**
 * POST /webhook - Recepción de mensajes de WhatsApp
 */
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== 'whatsapp_business_account') {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const message = value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from; // Número del usuario
    const messageId = message.id;

    console.log(`\n📱 Nuevo mensaje de: ${from}`);

    // Marcar como leído
    await whatsappService.markAsRead(messageId);

    // Procesar mensaje
    await botController.handleMessage(from, message);

    res.sendStatus(200);
  } catch (error) {
    console.error('❌ Error en webhook:', error);
    res.sendStatus(500);
  }
});

// ============================================
// API FAKE DE STRENDUS (para demostración)
// ============================================

const strendusAPI = require('./services/strendusAPI');

/**
 * POST /api/strendus/verify - Verificar usuario
 */
app.post('/api/strendus/verify', (req, res) => {
  const { phone, token } = req.body;

  // Verificar token de autenticación
  if (token !== process.env.STRENDUS_API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const result = strendusAPI.verifyUser(phone);
  res.json(result);
});

/**
 * GET /api/strendus/balance - Obtener saldo
 */
app.get('/api/strendus/balance', (req, res) => {
  const { phone, token } = req.query;

  if (token !== process.env.STRENDUS_API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const balance = strendusAPI.getBalance(phone);
  res.json({ balance });
});

/**
 * POST /api/strendus/bet - Crear apuesta
 */
app.post('/api/strendus/bet', (req, res) => {
  const { phone, token, betData } = req.body;

  if (token !== process.env.STRENDUS_API_TOKEN) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const result = strendusAPI.createBet(phone, betData);
  res.json(result);
});

// ============================================
// ENDPOINTS DE ADMINISTRACIÓN
// ============================================

/**
 * GET /health - Health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

/**
 * GET /stats - Estadísticas del sistema
 */
app.get('/stats', async (req, res) => {
  const apiUsage = await oddsService.getApiUsage();
  const allPendingBets = strendusAPI.getAllPendingBets();

  res.json({
    oddsAPI: {
      requestsRemaining: apiUsage.remaining,
      requestsUsed: apiUsage.used
    },
    bets: {
      pending: allPendingBets.length,
      lastUpdate: oddsService.cache.lastUpdate,
      gamesAvailable: oddsService.cache.games.length
    },
    users: {
      total: strendusAPI.usersData.users.length
    }
  });
});

/**
 * POST /admin/update-odds - Actualizar momios manualmente
 */
app.post('/admin/update-odds', async (req, res) => {
  try {
    const games = await oddsService.fetchAllOdds();
    res.json({
      success: true,
      gamesUpdated: games.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /admin/process-results - Procesar resultados manualmente
 */
app.post('/admin/process-results', async (req, res) => {
  try {
    await resultsService.processManually();
    res.json({
      success: true,
      message: 'Resultados procesados',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// INICIALIZACIÓN
// ============================================

/**
 * Iniciar servidor y servicios
 */
async function startServer() {
  try {
    // Verificar variables de entorno críticas
    const requiredEnvVars = ['ODDS_API_KEY'];
    const missing = requiredEnvVars.filter(v => !process.env[v]);

    if (missing.length > 0) {
      console.warn(`⚠️  Variables de entorno faltantes: ${missing.join(', ')}`);
    }

    // Actualizar momios inicialmente
    console.log('🔄 Cargando momios iniciales...');
    await oddsService.fetchAllOdds();

    // Configurar actualización automática de momios cada 2 minutos
    cron.schedule('*/2 * * * *', async () => {
      console.log('🔄 Actualizando momios automáticamente...');
      await oddsService.fetchAllOdds();
    });

    // Iniciar servicio de resultados (cada 5 minutos)
    resultsService.start();

    // Iniciar servidor HTTP
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║   🎰 STRENDUS WHATSAPP BOT - ACTIVO 🎰   ║
╠════════════════════════════════════════════╣
║  Puerto: ${PORT.toString().padEnd(35)} ║
║  Ambiente: ${(process.env.NODE_ENV || 'development').padEnd(31)} ║
║  Webhook: /webhook ${' '.repeat(23)} ║
║  Health: /health ${' '.repeat(25)} ║
║  Stats: /stats ${' '.repeat(27)} ║
╠════════════════════════════════════════════╣
║  ✅ Momios actualizándose cada 2 min      ║
║  ✅ Resultados procesándose cada 5 min    ║
║  ✅ WhatsApp webhook configurado          ║
╚════════════════════════════════════════════╝
      `);

      console.log(`\n📱 Configuración de WhatsApp:`);
      console.log(`   Token configurado: ${process.env.WHATSAPP_TOKEN ? '✅' : '❌'}`);
      console.log(`   Phone ID configurado: ${process.env.PHONE_NUMBER_ID ? '✅' : '❌'}`);
      console.log(`   Verify token configurado: ${process.env.WEBHOOK_VERIFY_TOKEN ? '✅' : '❌'}`);

      console.log(`\n🎯 Odds API:`);
      console.log(`   Key configurada: ${process.env.ODDS_API_KEY ? '✅' : '❌'}`);

      console.log(`\n💡 Próximos pasos:`);
      console.log(`   1. Configura el webhook en Meta Business: ${process.env.BASE_URL || 'http://localhost:3000'}/webhook`);
      console.log(`   2. Envía un mensaje de WhatsApp al número configurado`);
      console.log(`   3. Verifica logs en esta consola\n`);
    });

  } catch (error) {
    console.error('❌ Error iniciando el servidor:', error);
    process.exit(1);
  }
}

// Manejar errores no capturados
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled Rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});

// Iniciar
startServer();
