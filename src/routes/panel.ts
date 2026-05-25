import { Router, Request, Response, NextFunction } from 'express';
import pool from '../db/pool';
import { discordClient } from '../bot/bot';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();

// ────────────────────────────────────────────────────────
// SHARED MIDDLEWARE — Admin vs Moderator
// ────────────────────────────────────────────────────────

async function requireRole(role: 'admin' | 'moderator') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const sessionId = req.headers['x-panel-session'] as string;
    if (!sessionId) return res.status(401).json({ error: 'Требуется авторизация' });

    try {
      const result = await pool.query(
        `SELECT * FROM panel_sessions WHERE id=$1 AND expires_at > NOW()`,
        [sessionId]
      );
      const session = result.rows[0];
      if (!session) return res.status(401).json({ error: 'Сессия истекла' });
      if (role === 'admin' && session.role !== 'admin')
        return res.status(403).json({ error: 'Только для администраторов' });
      if (role === 'moderator' && session.role !== 'moderator' && session.role !== 'admin')
        return res.status(403).json({ error: 'Только для модераторов и администраторов' });
      (req as any).panelSession = session;
      next();
    } catch (err) {
      console.error('[PanelAuth] session error:', err);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  };
}

const requireMod   = async (req: Request, res: Response, next: NextFunction) => (await requireRole('moderator'))(req, res, next);
const requireAdmin = async (req: Request, res: Response, next: NextFunction) => (await requireRole('admin'))(req, res, next);

// ────────────────────────────────────────────────────────
// AUTH — /api/panel/register  (Email + Password + Discord OAuth2)
// ────────────────────────────────────────────────────────

// Step 1: Register with email/password — returns a pending_id
router.post('/panel/register', async (req: Request, res: Response) => {
  const { email, password, panel_role } = req.body;
  if (!email || !password || !panel_role) return res.status(400).json({ error: 'Не заполнены поля' });
  if (!['moderator', 'admin'].includes(panel_role)) return res.status(400).json({ error: 'Неверная роль' });
  if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });

  try {
    const existing = await pool.query('SELECT id FROM panel_users WHERE email=$1', [email]);
    if (existing.rows.length) return res.status(409).json({ error: 'Email уже зарегистрирован' });

    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(password, 12);
    const pendingId = crypto.randomBytes(32).toString('hex');

    await pool.query(
      `INSERT INTO panel_pending (id, email, password_hash, panel_role, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE SET password_hash=$3, panel_role=$4, id=$1, created_at=NOW()`,
      [pendingId, email, hash, panel_role]
    );

    // Build Discord OAuth URL for linking step
    const state = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO oauth_states (state, telegram_user_id, created_at) VALUES ($1, NULL, NOW())`,
      [state]
    );

    const redirectUri = process.env.DISCORD_PANEL_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds.members.read',
      state,
    });

    // Store pending_id in state mapping
    await pool.query(
      `UPDATE oauth_states SET telegram_user_id=$1 WHERE state=$2`,
      [pendingId, state]
    );

    res.json({ discord_url: `https://discord.com/oauth2/authorize?${params}`, pending_id: pendingId });
  } catch (err) {
    console.error('[PanelAuth] register error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Step 2: Discord OAuth callback for panel
router.get('/panel/auth/callback', async (req: Request, res: Response) => {
  const { code, state } = req.query as { code: string; state: string };
  if (!code || !state) return res.redirect('/panel/mod?panel_error=invalid_request');

  try {
    const stateRow = await pool.query(
      `SELECT * FROM oauth_states WHERE state=$1 AND created_at > NOW() - INTERVAL '15 minutes'`,
      [state]
    );
    if (!stateRow.rows[0]) return res.redirect('/panel/mod?panel_error=state_expired');

    const pendingId = stateRow.rows[0].telegram_user_id as string;
    await pool.query(`DELETE FROM oauth_states WHERE state=$1`, [state]);

    const pending = await pool.query(`SELECT * FROM panel_pending WHERE id=$1`, [pendingId]);
    // detect role from pending to redirect to correct page
    const pendingRoleForRedirect = pending.rows[0]?.panel_role || 'moderator';
    const redirectPage = pendingRoleForRedirect === 'admin' ? '/panel/admin' : '/panel/mod';
    if (!pending.rows[0]) return res.redirect('/panel/mod?panel_error=pending_not_found');
    const pendingUser = pending.rows[0];

    const redirectUri = process.env.DISCORD_PANEL_REDIRECT_URI || process.env.DISCORD_REDIRECT_URI!;
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

    // Check Discord role for self-validation
    let hasRole = false;
    const ADMIN_ROLE_NAMES = ['администратор', 'admin', 'owner', 'главный', 'глава', 'тех-админ'];
    const MOD_ROLE_NAMES = ['модератор', 'mod', 'staff', 'зам.главы', '《модератор》'];

    try {
      if (discordClient.isReady()) {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        const member = await guild.members.fetch({ user: discordUser.id, force: true });
        const names = member.roles.cache.map(r => r.name.toLowerCase());
        if (pendingUser.panel_role === 'admin') {
          hasRole = names.some(n => ADMIN_ROLE_NAMES.some(r => n.includes(r)));
        } else {
          hasRole = names.some(n => [...ADMIN_ROLE_NAMES, ...MOD_ROLE_NAMES].some(r => n.includes(r)));
        }
      }
    } catch {}

    if (!hasRole) return res.redirect(`${redirectPage}?panel_error=no_role`);

    // Create user if not exists
    await pool.query(
      `INSERT INTO panel_users (email, password_hash, discord_id, discord_username, discord_avatar, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (email) DO UPDATE SET discord_id=$3, discord_username=$4, discord_avatar=$5, role=$6`,
      [pendingUser.email, pendingUser.password_hash, discordUser.id, discordUser.username, avatarUrl, pendingUser.panel_role]
    );
    await pool.query(`DELETE FROM panel_pending WHERE id=$1`, [pendingId]);

    res.redirect(`${redirectPage}?panel_registered=1`);
  } catch (err: any) {
    console.error('[PanelAuth] callback error:', err?.message);
    res.redirect('/panel/mod?panel_error=oauth_failed');
  }
});

// Login — email + password
router.post('/panel/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Не заполнены поля' });

  try {
    const result = await pool.query(`SELECT * FROM panel_users WHERE email=$1`, [email]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Неверный email или пароль' });

    const bcrypt = require('bcrypt');
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Неверный email или пароль' });

    const sessionId = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO panel_sessions (id, user_id, role, discord_username, discord_avatar, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [sessionId, user.id, user.role, user.discord_username, user.discord_avatar, expiresAt]
    );
    await pool.query(`DELETE FROM panel_sessions WHERE expires_at < NOW()`);

    res.json({
      session_id: sessionId,
      role: user.role,
      discord_username: user.discord_username,
      discord_avatar: user.discord_avatar,
    });
  } catch (err) {
    console.error('[PanelAuth] login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Verify session
router.get('/panel/verify', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-panel-session'] as string;
  if (!sessionId) return res.status(401).json({ authorized: false });
  try {
    const result = await pool.query(
      `SELECT * FROM panel_sessions WHERE id=$1 AND expires_at > NOW()`,
      [sessionId]
    );
    const session = result.rows[0];
    if (!session) return res.status(401).json({ authorized: false });
    res.json({
      authorized: true,
      role: session.role,
      discord_username: session.discord_username,
      discord_avatar: session.discord_avatar,
    });
  } catch {
    res.status(500).json({ authorized: false });
  }
});

// Logout
router.post('/panel/logout', async (req: Request, res: Response) => {
  const sessionId = req.headers['x-panel-session'] as string;
  if (sessionId) await pool.query(`DELETE FROM panel_sessions WHERE id=$1`, [sessionId]).catch(() => {});
  res.json({ success: true });
});

// ────────────────────────────────────────────────────────
// COMPLAINTS — жалобы на игроков (submit — public, read — mod+)
// ────────────────────────────────────────────────────────

router.post('/complaints', async (req: Request, res: Response) => {
  const { reporter_discord, accused_discord, reason, description } = req.body;
  if (!accused_discord || !reason) return res.status(400).json({ error: 'Укажите Discord и причину' });
  try {
    await pool.query(
      `INSERT INTO complaints (reporter_discord, accused_discord, reason, description) VALUES ($1,$2,$3,$4)`,
      [reporter_discord || 'anonymous', accused_discord, reason, description || '']
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.get('/panel/complaints', requireMod, async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
  const offset = (page - 1) * limit;
  const status = req.query.status as string || 'all';

  try {
    const where = status !== 'all' ? `WHERE status=$1` : '';
    const params = status !== 'all' ? [status] : [];
    const count = await pool.query(`SELECT COUNT(*) FROM complaints ${where}`, params);
    const data  = await pool.query(
      `SELECT * FROM complaints ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ complaints: data.rows, total: parseInt(count.rows[0].count), pages: Math.ceil(parseInt(count.rows[0].count) / limit) });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/panel/complaints/:id/resolve', requireMod, async (req: Request, res: Response) => {
  const { action, note } = req.body;
  const session = (req as any).panelSession;
  try {
    await pool.query(
      `UPDATE complaints SET status=$1, resolved_by=$2, resolved_note=$3, resolved_at=NOW() WHERE id=$4`,
      [action, session.discord_username, note || '', req.params.id]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ────────────────────────────────────────────────────────
// BOT VIOLATIONS — модератор смотрит автоматические нарушения
// ────────────────────────────────────────────────────────

router.get('/panel/violations', requireMod, async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 25);
  const offset = (page - 1) * limit;
  const discord_id = req.query.discord_id as string;

  try {
    const where = discord_id ? `WHERE discord_id=$1` : '';
    const params = discord_id ? [discord_id] : [];
    const count = await pool.query(`SELECT COUNT(*) FROM violations ${where}`, params);
    const data  = await pool.query(
      `SELECT * FROM violations ${where} ORDER BY logged_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ violations: data.rows, total: parseInt(count.rows[0].count), pages: Math.ceil(parseInt(count.rows[0].count) / limit) });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ────────────────────────────────────────────────────────
// ADMIN — Applications (same as mod but admin-scoped)
// ────────────────────────────────────────────────────────

router.get('/panel/applications', requireMod, async (req: Request, res: Response) => {
  const page   = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit  = Math.min(50, parseInt(req.query.limit as string) || 15);
  const offset = (page - 1) * limit;
  const status = req.query.status as string || 'all';
  const type   = req.query.type as string || 'all';

  try {
    const conds: string[] = [];
    const params: any[] = [];
    if (status !== 'all') { conds.push(`status=$${params.length + 1}`); params.push(status); }
    if (type !== 'all')   { conds.push(`type=$${params.length + 1}`);   params.push(type); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const count = await pool.query(`SELECT COUNT(*) FROM applications ${where}`, params);
    const data  = await pool.query(
      `SELECT * FROM applications ${where} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json({ applications: data.rows, total: parseInt(count.rows[0].count), pages: Math.ceil(parseInt(count.rows[0].count) / limit) });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

router.post('/panel/applications/:id/decide', requireMod, async (req: Request, res: Response) => {
  const appId = parseInt(req.params.id);
  const { action, reason } = req.body;
  const session = (req as any).panelSession;
  if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'Неверное действие' });
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
          if (!role) role = await guild.roles.create({ name: 'Обзвон', color: '#57f287' as any });
          const member = await guild.members.fetch(app.discord_id);
          await member.roles.add(role);
          await member.send('✅ Ваша заявка одобрена! Добро пожаловать 🎮');
        } else {
          const member = await guild.members.fetch(app.discord_id).catch(() => null);
          if (member) await member.send(`❌ Ваша заявка отклонена.${reason ? ` Причина: ${reason}` : ''}`);
        }
      } catch {}
    }
    await pool.query(
      `UPDATE applications SET status=$1, decided_by=$2 WHERE id=$3`,
      [action === 'approve' ? 'approved' : 'rejected', session.discord_username, appId]
    );
    res.json({ success: true });
  } catch {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ────────────────────────────────────────────────────────
// ADMIN — Server & Bot Status
// ────────────────────────────────────────────────────────

router.get('/panel/status', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const botReady = discordClient.isReady();
    let guildInfo: any = null;

    if (botReady) {
      try {
        const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
        await guild.members.fetch();
        guildInfo = {
          name: guild.name,
          member_count: guild.memberCount,
          online_count: guild.members.cache.filter(m => m.presence?.status !== 'offline' && m.presence?.status !== undefined).size,
          channel_count: guild.channels.cache.size,
          role_count: guild.roles.cache.size,
          created_at: guild.createdAt,
          icon: guild.iconURL({ size: 128 }),
        };
      } catch {}
    }

    // DB stats
    const appCount = await pool.query('SELECT COUNT(*) FROM applications WHERE status=$1', ['pending']);
    const violCount = await pool.query('SELECT COUNT(*) FROM violations WHERE logged_at > NOW() - INTERVAL \'24 hours\'');
    const complCount = await pool.query('SELECT COUNT(*) FROM complaints WHERE status=$1', ['pending']);

    res.json({
      bot: {
        status: botReady ? 'online' : 'offline',
        uptime_seconds: process.uptime(),
        username: botReady ? discordClient.user?.username : null,
        ping: botReady ? discordClient.ws.ping : null,
      },
      server: guildInfo,
      stats: {
        pending_applications: parseInt(appCount.rows[0].count),
        violations_24h: parseInt(violCount.rows[0].count),
        pending_complaints: parseInt(complCount.rows[0].count),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// ────────────────────────────────────────────────────────
// ADMIN — Discord Roles management
// ────────────────────────────────────────────────────────

// List all server roles
router.get('/panel/discord-roles', requireAdmin, async (_req: Request, res: Response) => {
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    await guild.roles.fetch();
    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        mentionable: r.mentionable,
        hoist: r.hoist,
        members: r.members.size,
      }))
      .sort((a, b) => b.position - a.position);
    res.json({ roles });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения ролей' });
  }
});

// Assign role to user
router.post('/panel/discord-roles/assign', requireAdmin, async (req: Request, res: Response) => {
  const { discord_id, role_id } = req.body;
  if (!discord_id || !role_id) return res.status(400).json({ error: 'Укажите discord_id и role_id' });
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild  = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const member = await guild.members.fetch(discord_id).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Участник не найден' });
    const role = guild.roles.cache.get(role_id);
    if (!role) return res.status(404).json({ error: 'Роль не найдена' });
    await member.roles.add(role_id);
    res.json({ success: true, message: `Роль ${role.name} выдана @${member.user.username}` });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка Discord' });
  }
});

// Remove role from user
router.post('/panel/discord-roles/remove', requireAdmin, async (req: Request, res: Response) => {
  const { discord_id, role_id } = req.body;
  if (!discord_id || !role_id) return res.status(400).json({ error: 'Укажите discord_id и role_id' });
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild  = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const member = await guild.members.fetch(discord_id).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Участник не найден' });
    const role = guild.roles.cache.get(role_id);
    if (!role) return res.status(404).json({ error: 'Роль не найдена' });
    await member.roles.remove(role_id);
    res.json({ success: true, message: `Роль ${role.name} снята с @${member.user.username}` });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка Discord' });
  }
});

// Create role
router.post('/panel/discord-roles/create', requireAdmin, async (req: Request, res: Response) => {
  const { name, color, hoist, mentionable } = req.body;
  if (!name) return res.status(400).json({ error: 'Укажите название роли' });
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const role  = await guild.roles.create({ name, color: (color || '#99aab5') as any, hoist: !!hoist, mentionable: !!mentionable });
    res.json({ success: true, role: { id: role.id, name: role.name, color: role.hexColor } });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка создания роли' });
  }
});

// Delete role
router.delete('/panel/discord-roles/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    await guild.roles.delete(req.params.id, 'Удалено через панель администратора');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Ошибка удаления роли' });
  }
});

// Get member info with roles
router.get('/panel/discord-member', requireAdmin, async (req: Request, res: Response) => {
  const discord_id = req.query.discord_id as string;
  if (!discord_id) return res.status(400).json({ error: 'Укажите discord_id' });
  try {
    if (!discordClient.isReady()) return res.status(503).json({ error: 'Бот не подключён' });
    const guild  = await discordClient.guilds.fetch(process.env.DISCORD_GUILD_ID!);
    const member = await guild.members.fetch(discord_id).catch(() => null);
    if (!member) return res.status(404).json({ error: 'Участник не найден' });
    res.json({
      id: member.id,
      username: member.user.username,
      nickname: member.nickname,
      avatar: member.user.displayAvatarURL({ size: 128 }),
      joined_at: member.joinedAt,
      roles: member.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
        .sort((a: any, b: any) => b.position - a.position),
    });
  } catch {
    res.status(500).json({ error: 'Ошибка Discord' });
  }
});

export default router;
