const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Parsea la intención del usuario usando GPT.
 * Retorna un objeto con intent, sport y team.
 * Si OPENAI_API_KEY no está configurada o falla, retorna null.
 */
async function parseIntent(message) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Eres un asistente de apuestas deportivas mexicano. Analiza el mensaje y extrae la intención.

Deportes disponibles:
- basketball_nba (NBA, básquetbol, basket)
- baseball_mlb (MLB, béisbol)
- soccer_mexico_ligamx (Liga MX, fútbol mexicano — equipos: Tigres, Chivas, América, Pumas, Cruz Azul, Monterrey, Toluca, León, Atlas, Necaxa, Santos, Puebla, Querétaro, Tijuana)

Responde ÚNICAMENTE con JSON válido, sin markdown ni explicaciones:
{
  "intent": "search_game" | "recommend" | "none",
  "sport": "basketball_nba" | "baseball_mlb" | "soccer_mexico_ligamx" | null,
  "team": "nombre exacto del equipo si se menciona, si no null"
}

Reglas:
- "search_game": el usuario pregunta por un partido, equipo o deporte específico
- "recommend": quiere sugerencias de qué apostar sin mencionar equipo específico
- "none": no tiene relación con apostar en partidos deportivos`
        },
        { role: 'user', content: message }
      ],
      max_tokens: 80,
      temperature: 0
    });

    const raw = response.choices[0].message.content.trim();
    return JSON.parse(raw);
  } catch (e) {
    console.error('aiService error:', e.message);
    return null;
  }
}

module.exports = { parseIntent };
