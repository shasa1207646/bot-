import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../db/pool';

const router = Router();

// Роли, дающие доступ к панели модератора
const MOD_ROLE_ID    = process.env.DISCORD_MOD_ROLE_ID || '';
const MOD_ROLE_NAMES = ['модератор', 'администратор', 'admin', 'mod', 'owner', 'staff', 'зам.главы', 'тех-админ', '《модератор》'];

// ─── POST /api/moderator/auth/discord ────────────────────────────────────────
router.post('/moderator/auth/discord', async (_req: Request, res: Response) => {
  const state = crypto.randomBytes(32).toString('hex');
  try {
    await pool.query(
      `INSERT INTO oauth_states (state, telegram_user_id, created_at) VALUES ($1, NULL, NOW())`,
      [state]
    );
    await pool.query(`DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '15 minutes'`);
  } catch (err) {
    return res.status(500).json({ error: 'Ошибка базы данных' });
  }

  const redirectUri = process.env.DISCORD_MOD_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state,
  });
  res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

// ─── GET /api/moderator/auth/callback ────────────────────────────────────────
router.get('/moderator/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) return res.redirect('/?mod_error=invalid_request');

  let stateRow: any;
  try {
    const r = await pool.query(
      `SELECT * FROM oauth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [state]
    );
    stateRow = r.rows[0];
  } catch {
    return res.redirect('/?mod_error=db_error');
  }
  if (!stateRow) return res.redirect('/?mod_error=state_expired');
  await pool.query(`DELETE FROM oauth_states WHERE state=$1`, [state]);

  const redirectUri = process.env.DISCORD_MOD_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID!,
        client_secret: process.env.DISCORD_CLIENT_SECRET!,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const { access_token } = tokenRes.data;

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const discordUser = userRes.data;
    const avatarUrl = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
      : '';

    let isModerator = false;

    try {
      const { discordClient } = await import('../bot/bot');
      if (!discordClient.isReady()) {
        await new Promise<void>(resolve => {
          const t = setTimeout(resolve, 5000);
          discordClient.once('ready', () => { clearTimeout(t); resolve(); });
        });
      }
      if (discordClient.isReady()) {
        const guild  = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        const member = await guild.members.fetch({ user: discordUser.id, force: true });

        // Проверяем по ID (если задан) или по названию
        if (MOD_ROLE_ID) {
          isModerator = member.roles.cache.has(MOD_ROLE_ID);
        }
        if (!isModerator) {
          isModerator = member.roles.cache.some(r =>
            MOD_ROLE_NAMES.some(mr => r.name.toLowerCase().includes(mr))
          );
        }
        console.log(`[ModAuth] ${discordUser.username} — модератор: ${isModerator}`);
      }
    } catch (e) {
      console.warn('[ModAuth] Ошибка проверки ролей:', e);
    }

    const sessionId  = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO web_mod_sessions (id, discord_id, discord_username, discord_avatar, is_moderator, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [sessionId, discordUser.id, discordUser.username, avatarUrl, isModerator, expiresAt]
    );
    await pool.query(`DELETE FROM web_mod_sessions WHERE expires_at < NOW()`);

    res.redirect(`/?mod_session=${sessionId}`);
  } catch (err: any) {
    console.error('[ModAuth] OAuth error:', err?.message);
    res.redirect('/?mod_error=oauth_failed');
  }
});

// ─── GET /api/moderator/verify ───────────────────────────────────────────────
router.get('/moderator/verify', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-mod-session'] as string;
  if (!sessionId) return res.status(401).json({ authorized: false });

  try {
    const result = await pool.query(
      `SELECT * FROM web_mod_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    const session = result.rows[0];
    if (!session) return res.status(401).json({ authorized: false, error: 'Сессия истекла' });
    if (!session.is_moderator) {
      return res.status(403).json({
        authorized: true,
        is_moderator: false,
        discord_username: session.discord_username,
        discord_avatar: session.discord_avatar,
        error: 'Недостаточно прав. Требуется роль модератора.',
      });
    }
    res.json({
      authorized: true,
      is_moderator: true,
      discord_id: session.discord_id,
      discord_username: session.discord_username,
      discord_avatar: session.discord_avatar,
    });
  } catch (err) {
    res.status(500).json({ authorized: false, error: 'Ошибка сервера' });
  }
});

// ─── POST /api/moderator/logout ──────────────────────────────────────────────
router.post('/moderator/logout', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-mod-session'] as string;
  if (sessionId) {
    await pool.query(`DELETE FROM web_mod_sessions WHERE id=$1`, [sessionId]).catch(() => {});
  }
  res.json({ success: true });
});

export default router;
