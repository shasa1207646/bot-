import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/pool';
import { discordClient } from '../bot/bot';
import { ColorResolvable } from 'discord.js';

const router = Router();

async function requireModerator(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.headers['x-mod-session'] as string;
  if (!sessionId) return res.status(401).json({ error: 'Требуется авторизация' });

  try {
    const result = await pool.query(
      `SELECT * FROM web_mod_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    const session = result.rows[0];
    if (!session) return res.status(401).json({ error: 'Сессия истекла. Авторизуйтесь снова.' });
    if (!session.is_moderator) return res.status(403).json({ error: 'Недостаточно прав.' });
    (req as any).modSession = session;
    next();
  } catch (err) {
    console.error('[ModPanel] Ошибка сессии:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

// ─── GET /api/moderator/applications ─────────────────────────────────────────
router.get('/moderator/applications', requireModerator, async (req: Request, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 15);
  const offset = (page - 1) * limit;
  const status = req.query.status as string || 'all';
  const type   = req.query.type as string || 'all';

  try {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (status !== 'all') { conditions.push(`status = $${idx++}`); params.push(status); }
    if (type !== 'all')   { conditions.push(`type = $${idx++}`);   params.push(type); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await pool.query(`SELECT COUNT(*) FROM applications ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const dataRes = await pool.query(
      `SELECT * FROM applications ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    res.json({ applications: dataRes.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[ModPanel] Ошибка получения заявок:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── POST /api/moderator/applications/:id/decide ──────────────────────────────
// Единый эндпоинт: action = 'approve' | 'reject'
router.post('/moderator/applications/:id/decide', requireModerator, async (req: Request, res: Response) => {
  const appId = parseInt(req.params.id);
  const session = (req as any).modSession;
  const { action, reason } = req.body;

  if (isNaN(appId)) return res.status(400).json({ error: 'Неверный ID заявки' });
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'action должен быть approve или reject' });

  try {
    const result = await pool.query('SELECT * FROM applications WHERE id=$1', [appId]);
    const app = result.rows[0];
    if (!app) return res.status(404).json({ error: 'Заявка не найдена' });
    if (app.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

    if (discordClient.isReady() && app.discord_id) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        if (action === 'approve') {
          let role = guild.roles.cache.find(r => r.name === 'Обзвон');
          if (!role) {
            role = await guild.roles.create({ name: 'Обзвон', color: '#57f287' as ColorResolvable });
          }
          const member = await guild.members.fetch(app.discord_id);
          await member.roles.add(role);
          const voiceLink = process.env.DISCORD_VOICE_CHANNEL_ID
            ? `\n🎙️ Голосовой канал: https://discord.com/channels/${guild.id}/${process.env.DISCORD_VOICE_CHANNEL_ID}`
            : '';
          await member.send(`✅ Ваша заявка одобрена! Добро пожаловать 🎮${voiceLink}`);
        } else {
          const member = await guild.members.fetch(app.discord_id).catch(() => null);
          if (member) {
            const reasonText = reason ? `\nПричина: ${reason}` : '';
            await member.send(`❌ Ваша заявка отклонена.${reasonText}\nВы можете подать её повторно позже.`);
          }
        }
      } catch (e) {
        console.warn('[ModPanel] Ошибка Discord при решении:', e);
      }
    }

    await pool.query(
      `UPDATE applications SET status=$1, decided_by=$2 WHERE id=$3`,
      [action === 'approve' ? 'approved' : 'rejected', session.discord_username, appId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('[ModPanel] Ошибка решения:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ─── Сохраняем остальные роуты (mutes, bans, channels, chat-messages, etc.) ──

router.get('/moderator/mutes', requireModerator, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;
  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM mutes`);
    const total = parseInt(countRes.rows[0].count);
    const dataRes = await pool.query(`SELECT * FROM mutes ORDER BY muted_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ mutes: dataRes.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/moderator/bans', requireModerator, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;
  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM bans`);
    const total = parseInt(countRes.rows[0].count);
    const dataRes = await pool.query(`SELECT * FROM bans ORDER BY banned_at DESC LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ bans: dataRes.rows, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/moderator/mute', requireModerator, async (req: Request, res: Response) => {
  const session = (req as any).modSession;
  const { user_id, username, reason, duration_minutes } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Укажите user_id' });
  try {
    const durationMs = duration_minutes ? parseInt(duration_minutes) * 60000 : null;
    const expiresAt = durationMs ? new Date(Date.now() + durationMs) : null;
    await pool.query(
      `INSERT INTO mutes (user_id, username, reason, muted_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [user_id, username || user_id, reason || null, session.discord_username, expiresAt]
    );
    if (discordClient.isReady() && durationMs) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        const member = await guild.members.fetch(user_id).catch(() => null);
        if (member) {
          const until = new Date(Date.now() + Math.min(durationMs, 28 * 24 * 60 * 60 * 1000));
          await member.disableCommunicationUntil(until, reason || 'Мут через панель');
        }
      } catch (e) { console.warn('[ModPanel] Ошибка мута Discord:', e); }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/moderator/ban', requireModerator, async (req: Request, res: Response) => {
  const session = (req as any).modSession;
  const { user_id, username, reason } = req.body;
  if (!user_id) return res.status(400).json({ error: 'Укажите user_id' });
  try {
    await pool.query(
      `INSERT INTO bans (user_id, username, reason, banned_by) VALUES ($1, $2, $3, $4)`,
      [user_id, username || user_id, reason || null, session.discord_username]
    );
    if (discordClient.isReady()) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        await guild.bans.create(user_id, { reason: reason || 'Бан через панель', deleteMessageSeconds: 86400 });
      } catch (e) { console.warn('[ModPanel] Ошибка бана Discord:', e); }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/moderator/mute/:id', requireModerator, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });
  try {
    const result = await pool.query('DELETE FROM mutes WHERE id=$1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Мут не найден' });
    const mute = result.rows[0];
    if (discordClient.isReady() && mute.user_id) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        const member = await guild.members.fetch(mute.user_id).catch(() => null);
        if (member?.communicationDisabledUntil) {
          await member.disableCommunicationUntil(null, 'Мут снят через панель');
        }
      } catch {}
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.delete('/moderator/ban/:id', requireModerator, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Неверный ID' });
  try {
    const result = await pool.query('DELETE FROM bans WHERE id=$1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Бан не найден' });
    const ban = result.rows[0];
    if (discordClient.isReady() && ban.user_id) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        await guild.bans.remove(ban.user_id, 'Бан снят через панель').catch(() => null);
      } catch {}
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/moderator/channels', requireModerator, async (_req: Request, res: Response) => {
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не готов' });
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    await guild.channels.fetch();
    const channels = guild.channels.cache
      .filter((c: any) => c.type === 0)
      .map((c: any) => ({ id: c.id, name: c.name }))
      .sort((a: any, b: any) => a.name.localeCompare(b.name));
    res.json({ channels });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения каналов' });
  }
});

router.get('/moderator/chat-messages', requireModerator, async (req: Request, res: Response) => {
  const channelId = (req.query.channel_id as string) || process.env.DISCORD_MAIN_CHAT_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
  const limit = Math.min(50, parseInt(req.query.limit as string) || 30);
  if (!channelId) return res.status(400).json({ error: 'Не задан ID канала' });
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не готов' });
    const channel = await discordClient.channels.fetch(channelId) as any;
    if (!channel?.messages) return res.status(404).json({ error: 'Канал не найден' });
    const messages = await channel.messages.fetch({ limit });
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const result = [...messages.values()].map((msg: any) => {
      const member = guild.members.cache.get(msg.author.id);
      return {
        id: msg.id,
        content: msg.content || (msg.attachments.size > 0 ? '[Вложение]' : '[Пустое]'),
        author_id: msg.author.id,
        author_name: msg.author.username,
        author_avatar: msg.author.displayAvatarURL({ size: 64 }),
        author_nickname: member?.nickname || null,
        created_at: msg.createdAt.toISOString(),
        roles: member?.roles.cache.filter((r: any) => r.name !== '@everyone').map((r: any) => r.name) || [],
      };
    });
    res.json({ messages: result, channel_id: channelId, channel_name: channel.name });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения сообщений' });
  }
});

export default router;
