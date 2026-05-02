const OpenAI = require('openai');

let _client = null;
function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

/**
 * Parsea la intención del usuario usando GPT.
 * Retorna { intent, sport, team, response }.
 * Si OPENAI_API_KEY no está configurada o falla, retorna null.
 */
async function parseIntent(message, userName = null) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un agente de apuestas deportivas mexicano, amigable y natural. Te llamas Ranking.
${userName ? `El usuario se llama ${userName}.` : ''}

Deportes disponibles:
- basketball_nba (NBA, básquetbol, basket)
- baseball_mlb (MLB, béisbol)
- soccer_mexico_ligamx (Liga MX, fútbol mexicano — equipos: Tigres, Chivas, América, Pumas, Cruz Azul, Monterrey, Toluca, León, Atlas, Necaxa, Santos, Puebla, Querétaro, Tijuana)

Analiza el mensaje y responde ÚNICAMENTE con JSON válido, sin markdown:
{
  "intent": "search_game" | "recommend" | "chat",
  "sport": "basketball_nba" | "baseball_mlb" | "soccer_mexico_ligamx" | null,
  "team": "nombre del equipo si se menciona, si no null",
  "response": "respuesta natural en español solo si intent es chat, si no null"
}

Reglas:
- "search_game": el usuario pregunta por un partido, equipo o deporte específico
- "recommend": quiere sugerencias de qué apostar sin equipo específico
- "chat": mensaje social o conversacional (gracias, hola, qué tal, etc.) — genera una respuesta corta, natural y amigable en español mexicano. No menciones comandos ni menú.`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 150,
      temperature: 0.4
    });

    const raw = response.choices[0].message.content.trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error('aiService error:', e.message);
    return null;
  }
}

/**
 * Extrae nombres de equipos mencionados en un mensaje de parlay.
 * Retorna array de strings (puede estar vacío).
 */
async function parseParlayTeams(message) {
  if (!process.env.OPENAI_API_KEY) return [];
  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Extrae los nombres de equipos deportivos del mensaje. Responde ÚNICAMENTE con JSON válido, sin markdown:
{"teams": ["Nombre1", "Nombre2"]}
Si no hay equipos, responde: {"teams": []}`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 100,
      temperature: 0.1
    });
    const raw = response.choices[0].message.content.trim();
    return JSON.parse(raw).teams || [];
  } catch (e) {
    return [];
  }
}

/**
 * Usa GPT para elegir 3-4 piernas que alcancen el multiplicador objetivo.
 * games: array de juegos con bookmakers. amount y targetWin en MXN.
 * Retorna array de { gameId, team, odds } o null si falla.
 */
async function buildParlayCombo(games, amount, targetWin) {
  if (!process.env.OPENAI_API_KEY) return null;

  const targetMultiplier = targetWin / amount;

  const gamesText = games.map(g => {
    const market = g.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
    if (!market) return null;
    const outcomes = market.outcomes
      .map(o => `${o.name === 'Draw' ? 'Empate' : o.name}: ${o.price}`)
      .join(', ');
    return `ID:${g.id} | ${g.sport_title} | ${g.home_team} vs ${g.away_team} | ${outcomes}`;
  }).filter(Boolean).join('\n');

  if (!gamesText) return null;

  try {
    const response = await getClient().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres experto en apuestas deportivas. Elige entre 3 y 4 partidos para armar un parlay cuya cuota combinada sea lo más cercana a ${targetMultiplier.toFixed(1)}x.
Reglas:
- Máximo 4 piernas, mínimo 3
- Prefiere cuotas entre 1.2 y 3.5 (no demasiado arriesgadas)
- Usa exactamente el nombre del equipo o "Empate" tal como aparece en la lista
- Responde ÚNICAMENTE con JSON válido, sin markdown:
{"legs": [{"gameId": "...", "team": "NombreExacto", "odds": 1.8}]}`
        },
        {
          role: 'user',
          content: `Partidos disponibles:\n${gamesText}\n\nObjetivo: multiplicador ~${targetMultiplier.toFixed(1)}x (apostar $${amount} para ganar $${targetWin})`
        }
      ],
      max_tokens: 300,
      temperature: 0.3
    });
    const raw = response.choices[0].message.content.trim();
    return JSON.parse(raw).legs || null;
  } catch (e) {
    console.error('buildParlayCombo error:', e.message);
    return null;
  }
}

module.exports = { parseIntent, parseParlayTeams, buildParlayCombo };
