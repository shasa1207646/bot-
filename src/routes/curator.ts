import { Router } from 'express';
import pool from '../db/pool';
import { sendApplicationToDiscord } from '../bot/bot';
import { sendApplicationToTelegram } from '../telegram/sender';

const router = Router();

async function getPlayerSession(sessionId: string) {
  if (!sessionId) return null;
  try {
    const r = await pool.query(
      `SELECT * FROM player_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    return r.rows[0] || null;
  } catch { return null; }
}

router.post('/curator', async (req, res) => {
  const sessionId = req.headers['x-player-session'] as string;
  const player = await getPlayerSession(sessionId);
  if (!player) {
    return res.status(401).json({ error: 'Требуется авторизация через Discord.' });
  }

  const { age, name, activity, games, experience, motivation, rules, type: appType } = req.body;
  const finalType = appType === 'moderator' ? 'moderator' : 'curator';

  const missing: string[] = [];
  if (!age) missing.push('возраст');
  if (!name?.trim()) missing.push('имя');
  if (!activity?.trim()) missing.push('активность');
  if (!experience?.trim()) missing.push('опыт');
  if (!motivation?.trim()) missing.push('мотивация');
  if (rules === undefined || rules === null || rules === '') missing.push('правила');

  if (missing.length > 0) {
    return res.status(400).json({ error: `Заполните обязательные поля: ${missing.join(', ')}.` });
  }
  if (rules === false || rules === 'false') {
    return res.status(400).json({ error: 'Вы должны принять правила сервера.' });
  }

  // Проверка дубликата
  const existing = await pool.query(
    `SELECT id FROM applications WHERE discord_id=$1 AND type=$2 AND status='pending'`,
    [player.discord_id, finalType]
  );
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: `У вас уже есть заявка ${finalType === 'moderator' ? 'модератора' : 'куратора'} на рассмотрении.` });
  }

  const result = await pool.query(
    `INSERT INTO applications (type, discord_id, username, age, name, activity, games, rules, experience, motivation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
    [
      finalType,
      player.discord_id,
      player.discord_username,
      parseInt(age),
      name.trim(),
      activity.trim(),
      games?.trim() || null,
      true,
      experience.trim(),
      motivation.trim(),
    ]
  );

  const appId = result.rows[0].id;
  const appData = {
    id: appId,
    type: finalType,
    discord_id: player.discord_id,
    username: player.discord_username,
    age: parseInt(age),
    name: name.trim(),
    activity: activity.trim(),
    games: games?.trim() || null,
    rules: true,
    experience: experience.trim(),
    motivation: motivation.trim(),
    discord_avatar: player.discord_avatar,
    submitted_at: new Date().toISOString(),
  };

  Promise.allSettled([
    sendApplicationToDiscord(appData),
    sendApplicationToTelegram(appData),
  ]).catch(console.error);

  res.json({ success: true, message: 'Заявка на куратора отправлена!' });
});

export default router;
