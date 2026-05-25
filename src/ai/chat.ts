export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const SYSTEM_PROMPT = `Ты дружелюбный AI-помощник игрового Discord-сервера Petushara Team.
Отвечай ТОЛЬКО на русском языке, кратко и по делу (максимум 3 предложения).
Ты помогаешь с:
- правилами сервера (запрет мата, флуда, рекламы, дискриминации, оскорблений)
- процессом подачи заявок на вступление, роль куратора
- командами бота (/ban, /kick, /help, /action, /create-role)
- вопросами об играх (CS2, Minecraft, Valorant и др.)
Если вопрос не по теме — вежливо переведи разговор на тему сервера.
Будь дружелюбным, используй игровой сленг где уместно.`;

export async function getAIResponse(messages: Message[]): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return '🤖 AI-помощник временно недоступен.';
  }

  // Ограничиваем историю последними 10 сообщениями
  const trimmed = messages.slice(-10);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: trimmed,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[AI] API error:', response.status, err);
      return '❌ Ошибка AI. Попробуйте позже.';
    }

    const data = await response.json() as any;
    const text = data.content?.[0]?.text?.trim();
    return text || 'Нет ответа';
  } catch (err: any) {
    console.error('[AI] Ошибка:', err?.message);
    return '❌ Ошибка соединения с AI.';
  }
}
