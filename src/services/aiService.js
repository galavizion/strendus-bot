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

module.exports = { parseIntent };
