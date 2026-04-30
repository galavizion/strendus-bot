# 🚀 Guía Rápida - Git y Deploy

## 📦 Subir a GitHub

### 1. Crear repositorio en GitHub

1. Ve a https://github.com/new
2. Nombre del repositorio: `strendus-whatsapp-bot`
3. Descripción: "Bot de WhatsApp para apuestas deportivas - Demo"
4. **NO inicialices con README** (ya tienes uno)
5. Click en "Create repository"

### 2. Subir tu código

Abre la terminal en la carpeta del proyecto:

```bash
# Inicializar git (si no está inicializado)
git init

# Agregar todos los archivos
git add .

# Primer commit
git commit -m "Initial commit - Strendus WhatsApp Bot"

# Conectar con GitHub (reemplaza TU_USUARIO con tu usuario)
git remote add origin https://github.com/TU_USUARIO/strendus-whatsapp-bot.git

# Subir
git push -u origin main
```

**Si te pide autenticación:**
```bash
# Configurar tu usuario (una sola vez)
git config --global user.name "Tu Nombre"
git config --global user.email "tu@email.com"

# Si usa autenticación de 2 factores, necesitas un Personal Access Token
# Ve a: GitHub > Settings > Developer settings > Personal access tokens
# Crea un token con permisos de "repo"
# Úsalo como contraseña cuando te lo pida
```

### 3. Verificar

- Ve a tu repositorio en GitHub
- Deberías ver todos los archivos
- El README.md se mostrará automáticamente

---

## 🚂 Deploy en Railway

### Paso 1: Crear cuenta

1. Ve a https://railway.app
2. Click en "Start a New Project"
3. Login con GitHub

### Paso 2: Conectar repositorio

1. Click en "Deploy from GitHub repo"
2. Selecciona `strendus-whatsapp-bot`
3. Click en "Deploy Now"

### Paso 3: Configurar variables de entorno

1. En tu proyecto de Railway, click en tu servicio
2. Ve a la pestaña "Variables"
3. Click en "Add Variable"
4. Agrega TODAS las variables de `.env.example`:

```
WHATSAPP_TOKEN=tu_token_aqui
PHONE_NUMBER_ID=tu_id_aqui
WEBHOOK_VERIFY_TOKEN=token_secreto_unico
ODDS_API_KEY=e6f9e72f5c01e0e3073cd2a3ad4d36f4
NODE_ENV=production
STRENDUS_API_TOKEN=strendus_secret_token_2026_xyz
COMPANY_NAME=Strendus
COMPANY_WEBSITE=https://www.strendus.com
COMPANY_REGISTRATION_URL=https://www.strendus.com/registro
```

5. Railway auto-genera `BASE_URL` - **NO la agregues manualmente**

### Paso 4: Obtener URL

1. Una vez deployado, click en "Settings"
2. Scroll a "Domains"
3. Click en "Generate Domain"
4. Copia la URL generada (ej: `https://tu-proyecto.up.railway.app`)

### Paso 5: Configurar webhook en Meta

1. Ve a Meta Business > WhatsApp > Configuración
2. Webhook URL: `https://tu-proyecto.up.railway.app/webhook`
3. Verify Token: El mismo que pusiste en `WEBHOOK_VERIFY_TOKEN`
4. Suscripciones: ✓ `messages`
5. Click en "Verificar y guardar"

### Paso 6: Probar

1. Envía "hola" al número de WhatsApp Business
2. El bot debería responder
3. Ver logs en Railway: Dashboard > Deployments > View logs

---

## 🔄 Actualizar el código

Cuando hagas cambios:

```bash
# Agregar cambios
git add .

# Hacer commit
git commit -m "Descripción de los cambios"

# Subir a GitHub
git push

# Railway detectará el cambio y hará re-deploy automáticamente
```

---

## 📊 Monitorear en Railway

### Ver logs en tiempo real
1. Dashboard > Tu proyecto > Deployments
2. Click en el deployment activo
3. Click en "View logs"

### Restart del servicio
1. Dashboard > Tu proyecto
2. Settings > Restart

### Ver métricas
1. Dashboard > Metrics
2. Puedes ver CPU, RAM, Requests

---

## 🐛 Troubleshooting común

### Error: "Application failed to start"
- Verifica que todas las variables de entorno estén configuradas
- Revisa logs para ver el error específico

### Error: "Webhook verification failed"
- Asegúrate que `WEBHOOK_VERIFY_TOKEN` en Railway coincida con Meta
- Verifica que la URL sea exactamente `https://tu-dominio/webhook`

### No recibe mensajes
- Verifica que el webhook esté "Activo" en Meta
- Revisa suscripciones (messages debe estar ✓)
- Checa logs de Railway

---

## 💰 Costos de Railway

- **Plan gratuito**: $5 crédito/mes
- Este proyecto consume aprox. $3-4/mes
- Si se acaba el crédito, el servicio se pausa
- Puedes agregar una tarjeta para uso ilimitado (~$5/mes)

---

## ✅ Checklist Final

Antes de presentar el demo:

- [ ] Código subido a GitHub
- [ ] Deploy exitoso en Railway
- [ ] Variables de entorno configuradas
- [ ] Webhook verificado en Meta
- [ ] Prueba enviada y respondida
- [ ] Logs sin errores
- [ ] URL del proyecto guardada
- [ ] Credenciales de usuarios de prueba anotadas

---

## 🎯 URLs Importantes

Guarda estas URLs:

```
GitHub: https://github.com/TU_USUARIO/strendus-whatsapp-bot
Railway: https://railway.app/project/TU_PROYECTO
WhatsApp Business: https://business.facebook.com/wa/manage/
Meta Webhook: https://developers.facebook.com/apps/TU_APP/whatsapp-business/wa-settings/
```

---

## 📱 Presentar el Demo

### 1. Mostrar la arquitectura
- Explica el flujo: WhatsApp → Webhook → Odds API
- Muestra el código en GitHub

### 2. Demo en vivo
- Envía "hola" desde tu teléfono
- Navega por los menús
- Haz una apuesta
- Muestra el historial

### 3. Mostrar logs
- Railway logs en tiempo real
- Cómo se procesa cada mensaje

### 4. Endpoints admin
- GET /stats para mostrar estadísticas
- POST /admin/update-odds

### 5. Explicar escalabilidad
- Cómo agregar más deportes
- Cómo integrar con su API real
- Cómo escalar a miles de usuarios

---

**¡Listo para presentar! 🚀**
