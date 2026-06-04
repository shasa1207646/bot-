import { Router, Request, Response } from 'express';
import axios from 'axios';
import crypto from 'crypto';
import pool from '../db/pool';

const router = Router();

// ─── GET /api/player/auth ─────────────────────────────────────────────────────
// Инициирует OAuth2 для игрока — возвращает URL
router.get('/player/auth', async (_req: Request, res: Response) => {
  const state = crypto.randomBytes(32).toString('hex');
  try {
    await pool.query(
      `INSERT INTO oauth_states (state, telegram_user_id, created_at) VALUES ($1, NULL, NOW())`,
      [state]
    );
    await pool.query(`DELETE FROM oauth_states WHERE created_at < NOW() - INTERVAL '15 minutes'`);
  } catch (err) {
    console.error('[PlayerAuth] Ошибка сохранения state:', err);
    return res.status(500).json({ error: 'Ошибка базы данных' });
  }

  const redirectUri = process.env.DISCORD_PLAYER_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.json({ url: `https://discord.com/oauth2/authorize?${params}` });
});

// ─── GET /api/player/auth/callback ───────────────────────────────────────────
router.get('/player/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) return res.redirect('/?player_error=invalid_request');

  let stateRow: any;
  try {
    const r = await pool.query(
      `SELECT * FROM oauth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [state]
    );
    stateRow = r.rows[0];
  } catch {
    return res.redirect('/?player_error=db_error');
  }
  if (!stateRow) return res.redirect('/?player_error=state_expired');
  await pool.query(`DELETE FROM oauth_states WHERE state=$1`, [state]);

  const redirectUri = process.env.DISCORD_PLAYER_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;

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
    const u = userRes.data;
    const avatarUrl = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : `https://cdn.discordapp.com/embed/avatars/${parseInt(u.discriminator || '0') % 5}.png`;

    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 дней

    await pool.query(
      `INSERT INTO player_sessions (id, discord_id, discord_username, discord_avatar, created_at, expires_at)
       VALUES ($1, $2, $3, $4, NOW(), $5)
       ON CONFLICT (discord_id) DO UPDATE
         SET id=$1, discord_username=$3, discord_avatar=$4, created_at=NOW(), expires_at=$5`,
      [sessionId, u.id, u.username, avatarUrl, expiresAt]
    );
    await pool.query(`DELETE FROM player_sessions WHERE expires_at < NOW()`);

    res.redirect(`/?player_session=${sessionId}`);
  } catch (err: any) {
    console.error('[PlayerAuth] OAuth error:', err?.message);
    res.redirect('/?player_error=oauth_failed');
  }
});

// ─── GET /api/player/verify ───────────────────────────────────────────────────
router.get('/player/verify', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-player-session'] as string;
  if (!sessionId) return res.status(401).json({ authorized: false });

  try {
    const r = await pool.query(
      `SELECT * FROM player_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    const s = r.rows[0];
    if (!s) return res.status(401).json({ authorized: false, error: 'Сессия истекла' });

    res.json({
      authorized: true,
      discord_id: s.discord_id,
      discord_username: s.discord_username,
      discord_avatar: s.discord_avatar,
    });
  } catch (err) {
    console.error('[PlayerAuth] Verify error:', err);
    res.status(500).json({ authorized: false, error: 'Ошибка сервера' });
  }
});

// ─── POST /api/player/logout ──────────────────────────────────────────────────
router.post('/player/logout', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-player-session'] as string;
  if (sessionId) {
    try {
      await pool.query(`DELETE FROM player_sessions WHERE id=$1`, [sessionId]);
    } catch {}
  }
  res.json({ success: true });
});

export default router;
