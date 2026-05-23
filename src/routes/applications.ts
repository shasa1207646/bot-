import { Router } from 'express';
import pool from '../db/pool';
import { discordClient, sendApplicationToDiscord } from '../bot/bot';
import { sendApplicationToTelegram } from '../telegram/sender';

const router = Router();

// Middleware: получить игрока из сессии
async function getPlayerSession(sessionId: string) {
  if (!sessionId) return null;
  try {
    const r = await pool.query(
      `SELECT * FROM player_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    return r.rows[0] || null;
  } catch {
    return null;
  }
}

// Rate limiting (in-memory, per discord_id)
const rateMap = new Map<string, number[]>();
function rateLimit(key: string, max = 3, windowMs = 300000): boolean {
  const now = Date.now();
  const hits = (rateMap.get(key) || []).filter(t => now - t < windowMs);
  hits.push(now);
  rateMap.set(key, hits);
  return hits.length <= max;
}

// ─── POST /api/applications ───────────────────────────────────────────────────
router.post('/applications', async (req, res) => {
  const sessionId = req.headers['x-player-session'] as string;
  const player = await getPlayerSession(sessionId);
  if (!player) {
    return res.status(401).json({ error: 'Требуется авторизация через Discord.' });
  }

  if (!rateLimit(player.discord_id)) {
    return res.status(429).json({ error: 'Слишком много заявок. Подождите немного.' });
  }

  const { age, name, activity, games, rules } = req.body;

  if (!age || !name?.trim() || !activity?.trim() || rules === undefined) {
    return res.status(400).json({ error: 'Заполните все обязательные поля.' });
  }
  if (rules === false || rules === 'false') {
    return res.status(400).json({ error: 'Вы должны принять правила сервера.' });
  }

  // Проверка: нет ли уже активной/ожидающей заявки
  const existing = await pool.query(
    `SELECT id FROM applications WHERE discord_id=$1 AND type='member' AND status='pending'`,
    [player.discord_id]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'У вас уже есть заявка на рассмотрении.' });
  }

  const result = await pool.query(
    `INSERT INTO applications (type, discord_id, username, age, name, activity, games, rules)
     VALUES ('member', $1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      player.discord_id,
      player.discord_username,
      parseInt(age),
      name.trim(),
      activity.trim(),
      games?.trim() || null,
      true,
    ]
  );

  const appId = result.rows[0].id;

  const appData = {
    id: appId,
    type: 'member',
    discord_id: player.discord_id,
    username: player.discord_username,
    age: parseInt(age),
    name: name.trim(),
    activity: activity.trim(),
    games: games?.trim() || null,
    rules: true,
    discord_avatar: player.discord_avatar,
    submitted_at: new Date().toISOString(),
  };

  // Отправить в Discord и Telegram (не блокируем ответ)
  Promise.allSettled([
    sendApplicationToDiscord(appData),
    sendApplicationToTelegram(appData),
  ]).catch(console.error);

  res.json({ success: true, message: 'Заявка успешно отправлена!' });
});

export default router;
