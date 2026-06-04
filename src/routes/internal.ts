import { Router } from 'express';
import pool from '../db/pool';
import { discordClient } from '../bot/bot';
import { getAIResponse, Message } from '../ai/chat';
import { ColorResolvable } from 'discord.js';

const router = Router();

function checkSecret(req: any, res: any): boolean {
  if (req.headers['x-internal-secret'] !== process.env.INTERNAL_SECRET) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// POST /api/internal/decision — внешнее решение по заявке
router.post('/internal/decision', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { application_id, action, moderator_username } = req.body;
  if (!application_id || !action) return res.status(400).json({ error: 'Неверные параметры' });

  try {
    const result = await pool.query('SELECT * FROM applications WHERE id=$1', [application_id]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Заявка не найдена' });
    if (app.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

    if (discordClient.isReady() && app.discord_id) {
      const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
      if (action === 'approve') {
        let role = guild.roles.cache.find(r => r.name === 'Обзвон');
        if (!role) role = await guild.roles.create({ name: 'Обзвон', color: '#57f287' as ColorResolvable });
        try {
          const member = await guild.members.fetch(app.discord_id);
          await member.roles.add(role);
          const voiceLink = process.env.DISCORD_VOICE_CHANNEL_ID
            ? `\n🎙️ Голосовой канал: https://discord.com/channels/${guild.id}/${process.env.DISCORD_VOICE_CHANNEL_ID}`
            : '';
          await member.send(`✅ Ваша заявка одобрена! Добро пожаловать на сервер 🎮${voiceLink}`);
        } catch {}
      } else {
        try {
          const member = await guild.members.fetch(app.discord_id);
          await member.send('❌ Ваша заявка отклонена. Вы можете подать её повторно позже.');
        } catch {}
      }
    }

    await pool.query(
      `UPDATE applications SET status=$1, decided_by=$2 WHERE id=$3`,
      [action === 'approve' ? 'approved' : 'rejected', moderator_username || 'system', application_id]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Internal] Ошибка:', err);
    res.status(500).json({ error: 'Внутренняя ошибка' });
  }
});

// POST /api/internal/bot/session — сохранение Discord-сессии из Telegram-бота
router.post('/internal/bot/session', async (req, res) => {
  if (!checkSecret(req, res)) return;

  const { telegram_user_id, discord_username, discord_user_id, is_moderator } = req.body;
  if (!telegram_user_id || !discord_user_id || !discord_username) {
    return res.status(400).json({ error: 'Обязательные поля: telegram_user_id, discord_user_id, discord_username' });
  }

  try {
    const crypto = await import('crypto');
    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней

    await pool.query(
      `INSERT INTO web_mod_sessions (id, discord_id, discord_username, discord_avatar, is_moderator, telegram_user_id, created_at, expires_at)
       VALUES ($1, $2, $3, '', $4, $5, NOW(), $6)
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, discord_user_id, discord_username, is_moderator ?? false, String(telegram_user_id), expiresAt]
    );

    // Удаляем устаревшие сессии для этого Telegram-пользователя
    await pool.query(
      `DELETE FROM web_mod_sessions WHERE telegram_user_id=$1 AND id<>$2`,
      [String(telegram_user_id), sessionId]
    );

    console.log(`[Internal] Сессия создана для Telegram-пользователя ${telegram_user_id} (Discord: ${discord_username})`);
    res.json({ success: true, session_id: sessionId });
  } catch (err: any) {
    console.error('[Internal] Ошибка создания сессии:', err);
    res.status(500).json({ error: 'Внутренняя ошибка' });
  }
});

// GET /api/internal/pending-applications
router.get('/internal/pending-applications', async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT * FROM applications WHERE status='pending' ORDER BY created_at ASC`
    );
    res.json({ applications: result.rows, count: result.rows.length });
  } catch (err: any) {
    res.status(500).json({ error: 'Внутренняя ошибка' });
  }
});

// POST /api/ai/chat — AI чат (Anthropic)
router.post('/ai/chat', async (req, res) => {
  const { messages } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'Нужен массив messages' });
  const reply = await getAIResponse(messages as Message[]);
  res.json({ reply });
});

// GET /api/healthz
router.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    discord: discordClient.isReady() ? 'online' : 'offline',
    timestamp: new Date().toISOString(),
  });
});

export default router;
