/**
 * Telegram-бот для администрации PETUSHARA TEAM
 * Управление Discord-сервером через Telegram
 *
 * Переменные окружения:
 *   TELEGRAM_BOT_TOKEN      — токен бота из @BotFather
 *   TELEGRAM_ADMIN_IDS      — ID администраторов через запятую (напр. 123456789,987654321)
 *   DISCORD_GUILD_ID        — ID Discord-сервера
 *   SITE_URL                — URL сайта для проверки статуса (необязательно)
 */

import axios from 'axios';
import { discordClient } from './bot/bot';
import { ColorResolvable } from 'discord.js';

// ─── Типы ────────────────────────────────────────────────────────────────────

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

interface TgMessage {
  message_id: number;
  from: { id: number; username?: string; first_name: string };
  chat: { id: number; type: string };
  text?: string;
  reply_to_message?: TgMessage;
}

interface TgCallbackQuery {
  id: string;
  from: { id: number; username?: string; first_name: string };
  message: TgMessage;
  data: string;
}

// ─── Конфиг ──────────────────────────────────────────────────────────────────

const TG_TOKEN     = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_IDS    = (process.env.TELEGRAM_ADMIN_IDS || '').split(',').map(s => parseInt(s.trim())).filter(Boolean);
const GUILD_ID     = process.env.DISCORD_GUILD_ID || '';
const SITE_URL     = process.env.SITE_URL || '';

const API = `https://api.telegram.org/bot${TG_TOKEN}`;

// Состояние ожидания ввода (userId → { action, data })
const awaitingInput = new Map<number, { action: string; data?: any }>();

// Интервал прыжков по каналам (userId → NodeJS.Timeout)
const jumpIntervals = new Map<string, NodeJS.Timeout>();

// ─── Утилиты ─────────────────────────────────────────────────────────────────

async function tgRequest(method: string, body: any) {
  try {
    const r = await axios.post(`${API}/${method}`, body, { timeout: 10000 });
    return r.data;
  } catch (e: any) {
    console.error(`[TG] ${method} error:`, e?.response?.data || e?.message);
    return null;
  }
}

async function sendMessage(chatId: number, text: string, extra: any = {}) {
  return tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra });
}

async function editMessage(chatId: number, messageId: number, text: string, extra: any = {}) {
  return tgRequest('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
}

async function answerCallback(callbackId: string, text?: string) {
  return tgRequest('answerCallbackQuery', { callback_query_id: callbackId, text, show_alert: false });
}

function isAdmin(userId: number) {
  if (ADMIN_IDS.length === 0) return true; // Если не настроено — разрешить всем
  return ADMIN_IDS.includes(userId);
}

function kb(buttons: Array<Array<{ text: string; callback_data?: string; url?: string }>>) {
  return { inline_keyboard: buttons };
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Главное меню ─────────────────────────────────────────────────────────────

function mainMenuKb() {
  return kb([
    [{ text: '🔨 Бан',       callback_data: 'menu:ban' },   { text: '👢 Кик',        callback_data: 'menu:kick' }],
    [{ text: '🔇 Мут',       callback_data: 'menu:mute' },  { text: '🎭 Троллинг',   callback_data: 'menu:troll' }],
    [{ text: '🎙️ Войс',     callback_data: 'menu:voice' }, { text: '🏷️ Роли',       callback_data: 'menu:roles' }],
    [{ text: '👁️ Мониторинг', callback_data: 'menu:monitor' }, { text: '📊 Онлайн',  callback_data: 'cmd:online' }],
    [{ text: '🔧 Статус',    callback_data: 'cmd:status' }, { text: '🔄 Рестарт бота', callback_data: 'cmd:restart' }],
  ]);
}

async function sendMainMenu(chatId: number) {
  return sendMessage(chatId, '🛡️ <b>PETUSHARA TEAM — Панель администрации</b>\n\nВыберите действие:', { reply_markup: mainMenuKb() });
}

// ─── Discord: получение участника ────────────────────────────────────────────

async function getGuild() {
  if (!discordClient.isReady()) throw new Error('Discord-бот не подключён');
  return discordClient.guilds.fetch(GUILD_ID);
}

async function getMember(discordId: string) {
  const guild = await getGuild();
  return guild.members.fetch(discordId).catch(() => null);
}

// ─── Обработчики команд ───────────────────────────────────────────────────────

// /start и /menu
async function handleStart(chatId: number, userId: number) {
  if (!isAdmin(userId)) {
    return sendMessage(chatId, '❌ У вас нет доступа к этому боту.');
  }
  return sendMainMenu(chatId);
}

// Статус бота и сайта
async function handleStatus(chatId: number) {
  const botOnline = discordClient.isReady();
  const uptime    = process.uptime();
  const h = Math.floor(uptime / 3600), m = Math.floor((uptime % 3600) / 60);
  const ping = botOnline ? discordClient.ws.ping : -1;

  let guildInfo = '';
  if (botOnline) {
    try {
      const guild = await getGuild();
      await guild.members.fetch();
      const online = guild.members.cache.filter(mb => mb.presence?.status !== 'offline' && mb.presence?.status !== undefined).size;
      guildInfo = `\n\n🏰 <b>Сервер:</b> ${escHtml(guild.name)}\n👥 Участников: ${guild.memberCount}\n🟢 Онлайн: ${online}`;
    } catch {}
  }

  let siteStatus = '';
  if (SITE_URL) {
    try {
      const r = await axios.get(SITE_URL, { timeout: 5000 });
      siteStatus = `\n\n🌐 <b>Сайт:</b> ${r.status === 200 ? '✅ Онлайн' : `⚠️ Код ${r.status}`}`;
    } catch {
      siteStatus = '\n\n🌐 <b>Сайт:</b> ❌ Недоступен';
    }
  }

  const text = `🔧 <b>Статус системы</b>\n\n🤖 <b>Discord-бот:</b> ${botOnline ? '✅ Онлайн' : '❌ Оффлайн'}\n⏱ Аптайм: ${h}ч ${m}м\n📡 Пинг: ${ping}ms${guildInfo}${siteStatus}`;
  return sendMessage(chatId, text, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
}

// Онлайн сервера
async function handleOnline(chatId: number) {
  try {
    const guild = await getGuild();
    await guild.members.fetch();
    const total  = guild.memberCount;
    const online = guild.members.cache.filter(m => m.presence?.status !== 'offline' && m.presence?.status !== undefined).size;
    const inVoice = guild.channels.cache
      .filter((c: any) => c.type === 2)
      .reduce((acc: number, c: any) => acc + (c.members?.size || 0), 0);

    const bots  = guild.members.cache.filter(m => m.user.bot).size;
    const humans = total - bots;

    const text = `📊 <b>Онлайн — ${escHtml(guild.name)}</b>\n\n👥 Всего участников: <b>${total}</b>\n👤 Людей: <b>${humans}</b>\n🤖 Ботов: <b>${bots}</b>\n🟢 Онлайн: <b>${online}</b>\n🎙️ В голосовых: <b>${inVoice}</b>`;
    return sendMessage(chatId, text, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
  } catch (e: any) {
    return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// Мониторинг чата — последние сообщения
async function handleMonitorChat(chatId: number) {
  try {
    const guild = await getGuild();
    const channelId = process.env.DISCORD_MAIN_CHAT_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID;
    if (!channelId) return sendMessage(chatId, '❌ Не задан DISCORD_MAIN_CHAT_CHANNEL_ID в .env');

    const channel = await discordClient.channels.fetch(channelId) as any;
    if (!channel?.messages) return sendMessage(chatId, '❌ Канал не найден');

    const messages = await channel.messages.fetch({ limit: 10 });
    const lines = [...messages.values()].reverse().map((msg: any) =>
      `<b>${escHtml(msg.author.username)}</b>: ${escHtml(msg.content || '[вложение]')}`
    ).join('\n');

    const text = `💬 <b>Последние сообщения — #${escHtml(channel.name)}</b>\n\n${lines || 'Нет сообщений'}`;
    return sendMessage(chatId, text, {
      reply_markup: kb([
        [{ text: '🔄 Обновить', callback_data: 'cmd:monitor_chat' }],
        [{ text: '🎙️ Войс каналы', callback_data: 'cmd:monitor_voice' }],
        [{ text: '◀️ Меню', callback_data: 'menu:main' }],
      ])
    });
  } catch (e: any) {
    return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// Мониторинг голосовых каналов
async function handleMonitorVoice(chatId: number) {
  try {
    const guild = await getGuild();
    await guild.channels.fetch();
    const voiceChannels = guild.channels.cache.filter((c: any) => c.type === 2);

    const lines: string[] = [];
    voiceChannels.forEach((c: any) => {
      const members = c.members?.map((m: any) => escHtml(m.user.username)).join(', ') || '';
      lines.push(`🎙️ <b>#${escHtml(c.name)}</b> (${c.members?.size || 0})${members ? ': ' + members : ''}`);
    });

    const text = `🎙️ <b>Голосовые каналы</b>\n\n${lines.join('\n') || 'Голосовых каналов нет'}`;
    return sendMessage(chatId, text, {
      reply_markup: kb([
        [{ text: '🔄 Обновить', callback_data: 'cmd:monitor_voice' }],
        [{ text: '💬 Текстовый чат', callback_data: 'cmd:monitor_chat' }],
        [{ text: '◀️ Меню', callback_data: 'menu:main' }],
      ])
    });
  } catch (e: any) {
    return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// Список ролей
async function handleListRoles(chatId: number) {
  try {
    const guild = await getGuild();
    await guild.roles.fetch();
    const roles = guild.roles.cache
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => `• <b>${escHtml(r.name)}</b> <code>${r.id}</code> (${r.members.size} чел.)`)
      .slice(0, 30)
      .join('\n');

    return sendMessage(chatId, `🏷️ <b>Роли сервера:</b>\n\n${roles || 'Ролей нет'}`, {
      reply_markup: kb([
        [{ text: '➕ Выдать роль',    callback_data: 'menu:give_role' }],
        [{ text: '➖ Снять роль',     callback_data: 'menu:remove_role' }],
        [{ text: '◀️ Меню',          callback_data: 'menu:main' }],
      ])
    });
  } catch (e: any) {
    return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ─── Обработка ввода (multi-step) ────────────────────────────────────────────

async function handleInputStep(chatId: number, userId: number, text: string) {
  const state = awaitingInput.get(userId);
  if (!state) return;

  const { action, data } = state;

  // БАН
  if (action === 'ban_id') {
    awaitingInput.set(userId, { action: 'ban_reason', data: { id: text.trim() } });
    return sendMessage(chatId, '📝 Введите причину бана (или напишите <code>-</code> без причины):', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
  }
  if (action === 'ban_reason') {
    const reason = text.trim() === '-' ? 'Без причины' : text.trim();
    awaitingInput.delete(userId);
    try {
      const guild  = await getGuild();
      const member = await getMember(data.id);
      const tag    = member ? escHtml(member.user.username) : data.id;
      await guild.bans.create(data.id, { reason, deleteMessageSeconds: 86400 });
      return sendMessage(chatId, `🔨 <b>${tag}</b> забанен.\n📝 Причина: ${escHtml(reason)}`, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка бана: ${e.message}`, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
    }
  }

  // КИК
  if (action === 'kick_id') {
    awaitingInput.set(userId, { action: 'kick_reason', data: { id: text.trim() } });
    return sendMessage(chatId, '📝 Причина кика (или <code>-</code>):', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
  }
  if (action === 'kick_reason') {
    const reason = text.trim() === '-' ? 'Без причины' : text.trim();
    awaitingInput.delete(userId);
    try {
      const member = await getMember(data.id);
      if (!member) return sendMessage(chatId, '❌ Участник не найден на сервере.');
      const tag = escHtml(member.user.username);
      await member.kick(reason);
      return sendMessage(chatId, `👢 <b>${tag}</b> кикнут.\n📝 Причина: ${escHtml(reason)}`, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка кика: ${e.message}`);
    }
  }

  // МУТ
  if (action === 'mute_id') {
    awaitingInput.set(userId, { action: 'mute_minutes', data: { id: text.trim() } });
    return sendMessage(chatId, '⏱ Длительность мута в минутах (напр. 60):', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
  }
  if (action === 'mute_minutes') {
    const minutes = parseInt(text.trim());
    if (isNaN(minutes) || minutes < 1) return sendMessage(chatId, '❌ Введите корректное число минут.');
    awaitingInput.set(userId, { action: 'mute_reason', data: { ...data, minutes } });
    return sendMessage(chatId, '📝 Причина мута (или <code>-</code>):');
  }
  if (action === 'mute_reason') {
    const reason = text.trim() === '-' ? 'Мут через Telegram-панель' : text.trim();
    awaitingInput.delete(userId);
    try {
      const member = await getMember(data.id);
      if (!member) return sendMessage(chatId, '❌ Участник не найден.');
      const until = new Date(Date.now() + Math.min(data.minutes * 60000, 28 * 24 * 60 * 60 * 1000));
      await member.disableCommunicationUntil(until, reason);
      return sendMessage(chatId, `🔇 <b>${escHtml(member.user.username)}</b> замучен на <b>${data.minutes} мин.</b>\n📝 Причина: ${escHtml(reason)}`, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка мута: ${e.message}`);
    }
  }

  // ВОЙС — ввод Discord ID
  if (action === 'voice_id') {
    const voiceAction = data.voiceAction;
    awaitingInput.delete(userId);
    try {
      const member = await getMember(text.trim());
      if (!member) return sendMessage(chatId, '❌ Участник не найден.');
      const tag = escHtml(member.user.username);

      if (voiceAction === 'disconnect') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        await member.voice.disconnect('Отключён через Telegram-панель');
        return sendMessage(chatId, `🔇 <b>${tag}</b> выкинут из войса.`, { reply_markup: kb([[{ text: '◀️ Войс', callback_data: 'menu:voice' }]]) });
      }
      if (voiceAction === 'mute') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        await member.voice.setMute(true, 'Мут через Telegram');
        return sendMessage(chatId, `🙊 <b>${tag}</b> замучен в войсе.`, { reply_markup: kb([[{ text: '◀️ Войс', callback_data: 'menu:voice' }]]) });
      }
      if (voiceAction === 'unmute') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        await member.voice.setMute(false, 'Мут снят');
        return sendMessage(chatId, `🎤 <b>${tag}</b> размучен в войсе.`, { reply_markup: kb([[{ text: '◀️ Войс', callback_data: 'menu:voice' }]]) });
      }
      if (voiceAction === 'deafen') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        await member.voice.setDeaf(true, 'Deaf через Telegram');
        return sendMessage(chatId, `🔕 <b>${tag}</b> оглушён в войсе.`, { reply_markup: kb([[{ text: '◀️ Войс', callback_data: 'menu:voice' }]]) });
      }
      if (voiceAction === 'undeafen') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        await member.voice.setDeaf(false, 'Deaf снят');
        return sendMessage(chatId, `🔊 <b>${tag}</b> слышит снова.`, { reply_markup: kb([[{ text: '◀️ Войс', callback_data: 'menu:voice' }]]) });
      }
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
    }
  }

  // ТРОЛЛИНГ
  if (action === 'troll_id') {
    const trollAction = data.trollAction;
    awaitingInput.delete(userId);
    try {
      const guild  = await getGuild();
      const member = await getMember(text.trim());
      if (!member) return sendMessage(chatId, '❌ Участник не найден.');
      const tag = escHtml(member.user.username);

      if (trollAction === 'shame_role') {
        let shameRole = guild.roles.cache.find(r => r.name === '🐔 Петух');
        if (!shameRole) {
          shameRole = await guild.roles.create({ name: '🐔 Петух', color: '#ff69b4' as ColorResolvable });
        }
        await member.roles.add(shameRole);
        return sendMessage(chatId, `🐔 <b>${tag}</b> получил роль 🐔 Петух!`, { reply_markup: kb([[{ text: '◀️ Троллинг', callback_data: 'menu:troll' }]]) });
      }

      if (trollAction === 'fast_jump' || trollAction === 'slow_jump') {
        if (!member.voice.channel) return sendMessage(chatId, '❌ Пользователь не в голосовом канале.');
        const voiceChannels = guild.channels.cache.filter((c: any) => c.type === 2).map(c => c) as any[];
        if (voiceChannels.length < 2) return sendMessage(chatId, '❌ Недостаточно голосовых каналов.');

        // Останавливаем предыдущий прыжок для этого пользователя
        const existingJump = jumpIntervals.get(text.trim());
        if (existingJump) {
          clearInterval(existingJump);
          jumpIntervals.delete(text.trim());
        }

        const delay = trollAction === 'fast_jump' ? 900 : 4000;
        const jumps  = trollAction === 'fast_jump' ? 8 : 5;
        let count = 0;

        const interval = setInterval(async () => {
          if (count >= jumps) {
            clearInterval(interval);
            jumpIntervals.delete(text.trim());
            return;
          }
          try {
            const rand = voiceChannels[Math.floor(Math.random() * voiceChannels.length)];
            const freshMember = await getMember(text.trim());
            if (freshMember?.voice.channel) await freshMember.voice.setChannel(rand);
          } catch {}
          count++;
        }, delay);

        jumpIntervals.set(text.trim(), interval);
        const emoji = trollAction === 'fast_jump' ? '⚡' : '🐌';
        return sendMessage(chatId, `${emoji} <b>${tag}</b> — начались прыжки по каналам!`, { reply_markup: kb([
          [{ text: '⏹ Остановить прыжки', callback_data: `troll:stop_jump:${text.trim()}` }],
          [{ text: '◀️ Троллинг', callback_data: 'menu:troll' }],
        ]) });
      }
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
    }
  }

  // ВЫДАЧА РОЛИ
  if (action === 'give_role_id') {
    awaitingInput.set(userId, { action: 'give_role_role', data: { userId: text.trim() } });
    return sendMessage(chatId, '🏷️ Введите <b>ID роли</b> (из /listroles или кнопки "Список ролей"):', { reply_markup: kb([[{ text: '📋 Список ролей', callback_data: 'cmd:list_roles' }, { text: '❌ Отмена', callback_data: 'menu:main' }]]) });
  }
  if (action === 'give_role_role') {
    awaitingInput.delete(userId);
    try {
      const guild  = await getGuild();
      const member = await getMember(data.userId);
      if (!member) return sendMessage(chatId, '❌ Участник не найден.');
      const role = guild.roles.cache.get(text.trim());
      if (!role) return sendMessage(chatId, '❌ Роль не найдена. Проверьте ID.');
      await member.roles.add(role);
      return sendMessage(chatId, `✅ Роль <b>${escHtml(role.name)}</b> выдана <b>${escHtml(member.user.username)}</b>`, { reply_markup: kb([[{ text: '◀️ Роли', callback_data: 'menu:roles' }]]) });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
    }
  }

  // СНЯТИЕ РОЛИ
  if (action === 'remove_role_id') {
    awaitingInput.set(userId, { action: 'remove_role_role', data: { userId: text.trim() } });
    return sendMessage(chatId, '🏷️ Введите <b>ID роли</b> для снятия:', { reply_markup: kb([[{ text: '📋 Список ролей', callback_data: 'cmd:list_roles' }, { text: '❌ Отмена', callback_data: 'menu:main' }]]) });
  }
  if (action === 'remove_role_role') {
    awaitingInput.delete(userId);
    try {
      const guild  = await getGuild();
      const member = await getMember(data.userId);
      if (!member) return sendMessage(chatId, '❌ Участник не найден.');
      const role = guild.roles.cache.get(text.trim());
      if (!role) return sendMessage(chatId, '❌ Роль не найдена.');
      await member.roles.remove(role);
      return sendMessage(chatId, `✅ Роль <b>${escHtml(role.name)}</b> снята с <b>${escHtml(member.user.username)}</b>`, { reply_markup: kb([[{ text: '◀️ Роли', callback_data: 'menu:roles' }]]) });
    } catch (e: any) {
      return sendMessage(chatId, `❌ Ошибка: ${e.message}`);
    }
  }
}

// ─── Обработка callback_query ────────────────────────────────────────────────

async function handleCallback(cq: TgCallbackQuery) {
  const chatId  = cq.message.chat.id;
  const userId  = cq.from.id;
  const msgId   = cq.message.message_id;
  const [group, action, extra] = cq.data.split(':');

  await answerCallback(cq.id);
  if (!isAdmin(userId)) return;

  // МЕНЮ
  if (group === 'menu') {
    if (action === 'main') {
      return editMessage(chatId, msgId, '🛡️ <b>PETUSHARA TEAM — Панель администрации</b>\n\nВыберите действие:', { reply_markup: mainMenuKb() });
    }
    if (action === 'ban') {
      awaitingInput.set(userId, { action: 'ban_id' });
      return editMessage(chatId, msgId, '🔨 <b>Бан</b>\n\nВведите Discord ID пользователя:', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
    }
    if (action === 'kick') {
      awaitingInput.set(userId, { action: 'kick_id' });
      return editMessage(chatId, msgId, '👢 <b>Кик</b>\n\nВведите Discord ID пользователя:', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
    }
    if (action === 'mute') {
      awaitingInput.set(userId, { action: 'mute_id' });
      return editMessage(chatId, msgId, '🔇 <b>Мут</b>\n\nВведите Discord ID пользователя:', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
    }

    if (action === 'voice') {
      return editMessage(chatId, msgId, '🎙️ <b>Управление голосовыми каналами</b>\n\nВыберите действие:', {
        reply_markup: kb([
          [{ text: '🔇 Выкинуть из войса',    callback_data: 'voice:disconnect' }, { text: '🙊 Замутить',  callback_data: 'voice:mute' }],
          [{ text: '🎤 Снять мут',            callback_data: 'voice:unmute' },    { text: '🔕 Оглушить', callback_data: 'voice:deafen' }],
          [{ text: '🔊 Снять оглушение',      callback_data: 'voice:undeafen' }],
          [{ text: '◀️ Меню',                callback_data: 'menu:main' }],
        ])
      });
    }

    if (action === 'troll') {
      return editMessage(chatId, msgId, '🎭 <b>Троллинг</b>\n\nВыберите действие:', {
        reply_markup: kb([
          [{ text: '🐔 Унизительная роль',     callback_data: 'troll:shame_role' }],
          [{ text: '⚡ Быстрые прыжки',        callback_data: 'troll:fast_jump' },  { text: '🐌 Медленные прыжки', callback_data: 'troll:slow_jump' }],
          [{ text: '🔇 Выкинуть из войса',    callback_data: 'voice:disconnect' }, { text: '🙊 Замутить в войсе', callback_data: 'voice:mute' }],
          [{ text: '🔕 Оглушить в войсе',     callback_data: 'voice:deafen' }],
          [{ text: '◀️ Меню',                 callback_data: 'menu:main' }],
        ])
      });
    }

    if (action === 'roles') {
      return editMessage(chatId, msgId, '🏷️ <b>Управление ролями</b>', {
        reply_markup: kb([
          [{ text: '📋 Список ролей',  callback_data: 'cmd:list_roles' }],
          [{ text: '➕ Выдать роль',   callback_data: 'menu:give_role' }],
          [{ text: '➖ Снять роль',    callback_data: 'menu:remove_role' }],
          [{ text: '◀️ Меню',         callback_data: 'menu:main' }],
        ])
      });
    }

    if (action === 'give_role') {
      awaitingInput.set(userId, { action: 'give_role_id' });
      return editMessage(chatId, msgId, '➕ <b>Выдать роль</b>\n\nВведите Discord ID пользователя:', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
    }
    if (action === 'remove_role') {
      awaitingInput.set(userId, { action: 'remove_role_id' });
      return editMessage(chatId, msgId, '➖ <b>Снять роль</b>\n\nВведите Discord ID пользователя:', { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:main' }]]) });
    }

    if (action === 'monitor') {
      return editMessage(chatId, msgId, '👁️ <b>Мониторинг</b>\n\nВыберите:', {
        reply_markup: kb([
          [{ text: '💬 Текстовый чат',   callback_data: 'cmd:monitor_chat' }],
          [{ text: '🎙️ Голосовые каналы', callback_data: 'cmd:monitor_voice' }],
          [{ text: '◀️ Меню',            callback_data: 'menu:main' }],
        ])
      });
    }
  }

  // ВОЙС (кнопки)
  if (group === 'voice') {
    awaitingInput.set(userId, { action: 'voice_id', data: { voiceAction: action } });
    const labels: Record<string, string> = {
      disconnect: '🔇 Выкинуть из войса',
      mute:       '🙊 Замутить в войсе',
      unmute:     '🎤 Снять мут',
      deafen:     '🔕 Оглушить',
      undeafen:   '🔊 Снять оглушение',
    };
    return editMessage(chatId, msgId, `${labels[action] || 'Войс'}\n\nВведите Discord ID пользователя:`, { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:voice' }]]) });
  }

  // ТРОЛЛИНГ (кнопки)
  if (group === 'troll') {
    if (action === 'stop_jump') {
      const interval = jumpIntervals.get(extra);
      if (interval) { clearInterval(interval); jumpIntervals.delete(extra); }
      return sendMessage(chatId, `⏹ Прыжки для <code>${extra}</code> остановлены.`, { reply_markup: kb([[{ text: '◀️ Меню', callback_data: 'menu:main' }]]) });
    }
    awaitingInput.set(userId, { action: 'troll_id', data: { trollAction: action } });
    const labels: Record<string, string> = {
      shame_role: '🐔 Унизительная роль',
      fast_jump:  '⚡ Быстрые прыжки',
      slow_jump:  '🐌 Медленные прыжки',
    };
    return editMessage(chatId, msgId, `${labels[action] || 'Троллинг'}\n\nВведите Discord ID пользователя:`, { reply_markup: kb([[{ text: '❌ Отмена', callback_data: 'menu:troll' }]]) });
  }

  // КОМАНДЫ
  if (group === 'cmd') {
    if (action === 'online')       return handleOnline(chatId);
    if (action === 'status')       return handleStatus(chatId);
    if (action === 'monitor_chat') return handleMonitorChat(chatId);
    if (action === 'monitor_voice')return handleMonitorVoice(chatId);
    if (action === 'list_roles')   return handleListRoles(chatId);
    if (action === 'restart') {
      await sendMessage(chatId, '🔄 Перезапускаю Discord-бота...');
      setTimeout(() => process.exit(0), 1500);
      return;
    }
  }
}

// ─── Обработка входящих сообщений ────────────────────────────────────────────

async function handleMessage(msg: TgMessage) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text   = msg.text || '';

  if (!isAdmin(userId)) {
    return sendMessage(chatId, '❌ У вас нет доступа к этому боту.');
  }

  // Если ждём ввода — передаём в обработчик шагов
  if (awaitingInput.has(userId) && !text.startsWith('/')) {
    return handleInputStep(chatId, userId, text);
  }

  // Команды
  if (text === '/start' || text === '/menu' || text.startsWith('/start ') || text.startsWith('/menu ')) {
    return handleStart(chatId, userId);
  }
  if (text === '/status') return handleStatus(chatId);
  if (text === '/online') return handleOnline(chatId);
  if (text === '/voice')  return handleMonitorVoice(chatId);
  if (text === '/chat')   return handleMonitorChat(chatId);
  if (text === '/roles' || text === '/listroles') return handleListRoles(chatId);
  if (text === '/restart') {
    await sendMessage(chatId, '🔄 Перезапускаю Discord-бота...');
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  if (text === '/cancel') {
    awaitingInput.delete(userId);
    return sendMainMenu(chatId);
  }

  // Неизвестный ввод — показываем меню
  return sendMainMenu(chatId);
}

// ─── Polling ──────────────────────────────────────────────────────────────────

let lastUpdateId = 0;

async function poll() {
  try {
    const res = await tgRequest('getUpdates', {
      offset: lastUpdateId + 1,
      timeout: 25,
      allowed_updates: ['message', 'callback_query'],
    });
    if (!res?.ok || !res.result?.length) return;

    for (const update of res.result as TgUpdate[]) {
      lastUpdateId = update.update_id;
      try {
        if (update.message)        await handleMessage(update.message);
        if (update.callback_query) await handleCallback(update.callback_query);
      } catch (e) {
        console.error('[TG] Update error:', e);
      }
    }
  } catch (e: any) {
    console.error('[TG] Poll error:', e?.message);
  }
}

// ─── Запуск ───────────────────────────────────────────────────────────────────

export function startTelegramBot() {
  if (!TG_TOKEN) {
    console.warn('[TG] TELEGRAM_BOT_TOKEN не задан — Telegram-бот не запущен');
    return;
  }
  if (ADMIN_IDS.length === 0) {
    console.warn('[TG] TELEGRAM_ADMIN_IDS не задан — доступ открыт для всех (небезопасно!)');
  }

  // Удаляем вебхук (если был задан) — иначе polling вернёт 409
  tgRequest('deleteWebhook', { drop_pending_updates: false })
    .then(() => tgRequest('getUpdates', { offset: -1 }))
    .then(r => {
      if (r?.result?.length) lastUpdateId = r.result[r.result.length - 1].update_id;
      setInterval(poll, 1000);
      console.log('[TG] Telegram-бот запущен ✅');
    })
    .catch(e => console.error('[TG] Ошибка запуска:', e));
}
