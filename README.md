# 🎰 Strendus WhatsApp Bot

Bot inteligente de WhatsApp para consultar momios y realizar apuestas deportivas en tiempo real.

![Status](https://img.shields.io/badge/Status-Demo-yellow)
![Node](https://img.shields.io/badge/Node-18+-green)
![License](https://img.shields.io/badge/License-MIT-blue)

## 📋 Descripción

Sistema completo de webhook para WhatsApp Business API que permite a usuarios registrados:

- 📊 Consultar momios en tiempo real de NBA, MLB y Liga MX
- 💰 Realizar apuestas con confirmación interactiva
- 📋 Ver historial de apuestas (últimas 15)
- 🚫 Cancelar apuestas pendientes (>20 min antes del evento)
- 💵 Consultar saldo disponible
- 🔔 Recibir notificaciones automáticas de resultados

## 🏗️ Arquitectura

```
Usuario WhatsApp → Meta WABA → Webhook (Node.js/Express)
                                    ↓
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
              Odds API      Strendus API      Base de Datos
           (momios reales)  (usuarios/apuestas)  (JSON local)
```

## 🎯 Características

### ✅ Implementadas

- [x] Integración completa con WhatsApp Business API
- [x] Verificación de usuarios por teléfono y cliente ID
- [x] Consulta de momios en tiempo real (actualización cada 2 min)
- [x] 3 deportes: NBA, MLB, Liga MX
- [x] Listas interactivas de WhatsApp para navegación
- [x] Botones de apuesta rápida: $200, $500, $1,000 + personalizado
- [x] Confirmación con timeout de 60 segundos
- [x] Validación de saldo antes de apostar
- [x] Restricción: No apostar si faltan <20 min para el partido
- [x] Historial de 15 apuestas con detalles
- [x] Cancelación de apuestas (si faltan >20 min)
- [x] Procesamiento automático de resultados (cada 5 min)
- [x] Notificaciones de ganador/perdedor
- [x] Bot educativo que guía al usuario
- [x] API fake de Strendus para demo

## 📦 Estructura del Proyecto

```
strendus-whatsapp-bot/
├── src/
│   ├── controllers/
│   │   └── botController.js      # Lógica principal del bot
│   ├── services/
│   │   ├── oddsService.js        # Integración con Odds API
│   │   ├── strendusAPI.js        # API simulada de Strendus
│   │   ├── whatsappService.js    # Envío de mensajes WhatsApp
│   │   └── resultsService.js     # Procesamiento de resultados
│   ├── data/
│   │   └── users.json            # Base de datos simulada (10 usuarios)
│   └── index.js                  # Servidor principal
├── .env.example                  # Variables de entorno de ejemplo
├── .gitignore
├── package.json
└── README.md
```

## 🚀 Inicio Rápido

### 1. Prerequisitos

- Node.js 18 o superior
- Cuenta de WhatsApp Business API (Meta)
- API Key de The Odds API

### 2. Instalación

```bash
# Clonar el repositorio
git clone <tu-repositorio>
cd strendus-whatsapp-bot

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
nano .env
```

### 3. Configurar .env

```env
# WhatsApp Business API
WHATSAPP_TOKEN=tu_token_de_waba
PHONE_NUMBER_ID=tu_phone_number_id
WEBHOOK_VERIFY_TOKEN=token_secreto_unico

# Odds API
ODDS_API_KEY=e6f9e72f5c01e0e3073cd2a3ad4d36f4

# Servidor
PORT=3000
NODE_ENV=development

# URLs
BASE_URL=http://localhost:3000
COMPANY_WEBSITE=https://www.strendus.com
COMPANY_REGISTRATION_URL=https://www.strendus.com/registro
```

### 4. Iniciar el servidor

```bash
# Modo desarrollo (con auto-reload)
npm run dev

# Modo producción
npm start
```

Deberías ver:

```
╔════════════════════════════════════════════╗
║   🎰 STRENDUS WHATSAPP BOT - ACTIVO 🎰   ║
╠════════════════════════════════════════════╣
║  Puerto: 3000                              ║
║  ✅ Momios actualizándose cada 2 min      ║
║  ✅ Resultados procesándose cada 5 min    ║
╚════════════════════════════════════════════╝
```

## 📱 Configuración de WhatsApp Business

### Obtener credenciales de Meta

1. Ve a [Meta Business](https://business.facebook.com)
2. Selecciona tu app de Facebook
3. Ve a **WhatsApp > Configuración de la API**
4. Copia:
   - **Access Token** → `WHATSAPP_TOKEN`
   - **Phone Number ID** → `PHONE_NUMBER_ID`

### Configurar Webhook

1. En Meta Business > WhatsApp > Configuración
2. Sección **Webhook**:
   - **URL del callback**: `https://tu-dominio.com/webhook`
   - **Token de verificación**: El mismo que pusiste en `WEBHOOK_VERIFY_TOKEN`
3. Suscripciones: ✓ `messages`
4. Click en **Verificar y guardar**

## 🧪 Testing Local con ngrok

```bash
# Instalar ngrok
npm install -g ngrok

# Exponer puerto 3000
ngrok http 3000

# Usar la URL HTTPS generada en Meta Business
https://abc123.ngrok.io/webhook
```

## 💬 Flujo de Conversación

### 1. Usuario nuevo
```
Usuario: "Hola"
Bot: Hola 👋
     Notamos que no estás registrado...
     [📝 Registrarme] [✅ Ya me registré]

Usuario presiona: [✅ Ya me registré]
Bot: Por favor, escribe tu número de cliente...

Usuario: "STR001"
Bot: Hola Carlos 👋
     Bienvenido a Strendus
     💰 Saldo disponible: $15,420 MXN
     [📊 Ver momios] [📋 Mis apuestas] [💰 Mi saldo]
```

### 2. Consultar momios
```
Usuario presiona: [📊 Ver momios]
Bot: [Lista interactiva]
     🏀 NBA
     ⚾ MLB
     ⚽ Liga MX

Usuario selecciona: NBA
Bot: [Lista de 3 partidos]
     Lakers vs Warriors - Hoy, 8:00 PM
     Celtics vs Heat - Hoy, 9:30 PM
     ...

Usuario selecciona: Lakers vs Warriors
Bot: 🏀 Lakers vs Warriors
     📍 Por definir
     📅 Hoy, 8:00 PM
     
     ¿A quién quieres apostar?
     [Lakers 1.85] [Warriors 2.10]
```

### 3. Realizar apuesta
```
Usuario presiona: [Lakers 1.85]
Bot: ✅ Seleccionaste: Lakers (1.85)
     Si apuestas $500, ganarías $925
     
     ¿Cuánto quieres apostar?
     [$200] [$500] [$1,000] [Otra cantidad]

Usuario presiona: [$500]
Bot: 📋 Confirma tu apuesta:
     Lakers (1.85) - $500
     Ganancia potencial: $925
     
     💰 Saldo actual: $15,420
     💰 Saldo después: $14,920
     [✅ Confirmar] [❌ Cancelar]

[A los 40 seg]
Bot: ⏱️ Te quedan 20 segundos para confirmar...

Usuario presiona: [✅ Confirmar]
Bot: 🎉 ¡Apuesta registrada!
     Lakers (1.85) - $500
     Ganancia potencial: $925
     💰 Saldo actual: $14,920 MXN
     
     Te notificaremos el resultado...
```

### 4. Notificación de resultado (automática)
```
[Cuando termina el partido - Usuario GANÓ]
Bot: 🎉 ¡GANASTE!
     Lakers vs Warriors
     Resultado final: 118 - 112
     
     Tu apuesta: Lakers (1.85) - $500
     Ganancia: +$925
     
     💰 Nuevo saldo: $15,845 MXN

[Cuando termina el partido - Usuario PERDIÓ]
Bot: 📊 Partido finalizado
     Lakers vs Warriors
     Resultado: 112 - 118
     
     💰 Saldo actual: $14,920 MXN
```

## 🎮 Comandos del Bot

| Comando | Acción |
|---------|--------|
| `hola`, `menu`, `ayuda` | Muestra menú principal |
| `momios`, `deportes` | Lista de deportes disponibles |
| `saldo`, `balance` | Consultar saldo (con confirmación) |
| `historial`, `mis apuestas` | Ver últimas 15 apuestas |
| `cancelar apuesta` | Lista de apuestas pendientes para cancelar |

**El bot también entiende variaciones:** "cuánto tengo", "ver partidos", etc.

## 👥 Usuarios de Prueba

El sistema viene con 10 usuarios pre-cargados:

| Cliente ID | Teléfono | Nombre | Saldo |
|------------|----------|--------|-------|
| STR001 | +5218112345001 | Carlos Martínez | $15,420 |
| STR002 | +5218112345002 | María González | $8,750 |
| STR003 | +5218112345003 | Juan Rodríguez | $3,200 |
| ... | ... | ... | ... |

*Ver archivo completo en `src/data/users.json`*

## 🔧 Endpoints de Administración

### Health Check
```bash
GET /health
```

Respuesta:
```json
{
  "status": "ok",
  "timestamp": "2026-04-28T...",
  "uptime": 3600
}
```

### Estadísticas
```bash
GET /stats
```

Respuesta:
```json
{
  "oddsAPI": {
    "requestsRemaining": "450",
    "requestsUsed": "50"
  },
  "bets": {
    "pending": 5,
    "gamesAvailable": 12
  },
  "users": {
    "total": 10
  }
}
```

### Actualizar momios manualmente
```bash
POST /admin/update-odds
```

### Procesar resultados manualmente
```bash
POST /admin/process-results
```

## 🚢 Deploy a Producción

### Opción 1: Railway (Recomendado)

1. **Crear cuenta en [Railway](https://railway.app)**

2. **Instalar Railway CLI**
```bash
npm install -g @railway/cli
railway login
```

3. **Inicializar proyecto**
```bash
railway init
```

4. **Configurar variables de entorno**
   - Ve al Dashboard de Railway
   - Agrega todas las variables de `.env`

5. **Deploy**
```bash
git push railway main
```

6. **Obtener URL**
   - Railway te dará una URL automática
   - Úsala para configurar el webhook en Meta

### Opción 2: Render

1. Conecta tu repositorio de GitHub
2. Crea un nuevo **Web Service**
3. Configura:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Agrega variables de entorno en el dashboard
5. Deploy automático

### Opción 3: VPS (DigitalOcean, Linode)

```bash
# En el servidor
git clone <tu-repo>
cd strendus-whatsapp-bot
npm install

# Instalar PM2
npm install -g pm2

# Iniciar
pm2 start src/index.js --name strendus-bot

# Auto-start on reboot
pm2 startup
pm2 save

# Ver logs
pm2 logs strendus-bot
```

## 📊 Deportes Disponibles

| Deporte | Liga | ID API | Actualización |
|---------|------|--------|---------------|
| 🏀 NBA | NBA | `basketball_nba` | Cada 2 min |
| ⚾ MLB | MLB | `baseball_mlb` | Cada 2 min |
| ⚽ Liga MX | Liga MX | `soccer_mexico_ligamx` | Cada 2 min |

## 🔐 Seguridad

- ✅ Tokens de autenticación para API fake
- ✅ Validación de webhook con verify token
- ✅ Verificación de usuario antes de operaciones
- ✅ No se expone información sensible en logs
- ✅ .gitignore configurado para proteger .env

## 🐛 Solución de Problemas

### "Webhook verification failed"
- Verifica que `WEBHOOK_VERIFY_TOKEN` coincida con Meta
- Asegúrate que la URL sea HTTPS

### "Message not sent"
- Revisa que `WHATSAPP_TOKEN` no haya expirado
- Verifica `PHONE_NUMBER_ID`
- Checa logs con `pm2 logs`

### No recibo mensajes
- Verifica suscripciones en Meta (✓ messages)
- Webhook debe estar "Activo" en Meta Dashboard
- Revisa logs del servidor

### Odds API error 401
- Verifica tu API key
- Checa límite en https://the-odds-api.com/account/

## 📝 Próximas Mejoras

- [ ] Integrar con base de datos real (PostgreSQL/MongoDB)
- [ ] Dashboard web para administración
- [ ] Múltiples mercados (spreads, totals, props)
- [ ] Apuestas combinadas (parlays)
- [ ] Sistema de notificaciones push
- [ ] Estadísticas avanzadas de usuarios
- [ ] Integración con sistema de pagos

## 🤝 Contribuir

1. Fork el proyecto
2. Crea una rama (`git checkout -b feature/amazing`)
3. Commit cambios (`git commit -m 'Add amazing feature'`)
4. Push (`git push origin feature/amazing`)
5. Abre un Pull Request

## 📄 Licencia

MIT License - ver archivo LICENSE para detalles

## 📞 Soporte

Para soporte técnico o preguntas:
- Email: soporte@strendus.com
- WhatsApp: +52-81-XXXX-XXXX

---

**Desarrollado para demo empresarial** | Uso responsable | +18 años

🎰 **Strendus** - Apuestas deportivas con responsabilidad
