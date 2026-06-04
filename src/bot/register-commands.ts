import { REST, Routes, SlashCommandBuilder } from 'discord.js';

export async function registerCommands() {
  const token    = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId  = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.warn('[Commands] Переменные окружения не заданы, команды не зарегистрированы');
    return;
  }

  const commands = [
    new SlashCommandBuilder().setName('help').setDescription('Показать список команд'),

    new SlashCommandBuilder()
      .setName('ban').setDescription('Забанить пользователя')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Причина')),

    new SlashCommandBuilder()
      .setName('kick').setDescription('Кикнуть пользователя')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('reason').setDescription('Причина')),

    new SlashCommandBuilder()
      .setName('mute').setDescription('Замутить пользователя')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addIntegerOption(o => o.setName('minutes').setDescription('Длительность в минутах').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption(o => o.setName('reason').setDescription('Причина')),

    new SlashCommandBuilder()
      .setName('violations').setDescription('Показать нарушения пользователя')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true)),

    new SlashCommandBuilder()
      .setName('create-role').setDescription('Создать роль')
      .addStringOption(o => o.setName('name').setDescription('Название роли').setRequired(true))
      .addStringOption(o => o.setName('color').setDescription('HEX цвет (#ff0000)')),

    new SlashCommandBuilder()
      .setName('action').setDescription('Действие с пользователем')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('type').setDescription('Тип').setRequired(true)
        .addChoices(
          { name: 'Выдать роль', value: 'give_role' },
          { name: 'Отправить ЛС', value: 'send_message' },
        ))
      .addStringOption(o => o.setName('value').setDescription('Роль или текст').setRequired(true)),

    new SlashCommandBuilder()
      .setName('troll').setDescription('Троллинг пользователя (голосовые каналы)')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('action').setDescription('Действие').setRequired(true)
        .addChoices(
          { name: '🐔 Унизительная роль', value: 'shame_role' },
          { name: '⚡ Быстрые прыжки по каналам', value: 'fast_jump' },
          { name: '🐌 Медленные прыжки по каналам', value: 'slow_jump' },
          { name: '🔇 Выкинуть из войса', value: 'disconnect_voice' },
          { name: '🙊 Замутить в войсе', value: 'server_mute' },
          { name: '🔕 Отключить звук (deaf)', value: 'server_deafen' },
          { name: '🎤 Снять войс-мут', value: 'unmute_voice' },
          { name: '🔊 Включить звук', value: 'undeafen_voice' },
        )),

    new SlashCommandBuilder()
      .setName('give-role').setDescription('Выдать роль пользователю')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('role_id').setDescription('ID роли (из /list-roles)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('remove-role').setDescription('Снять роль с пользователя')
      .addUserOption(o => o.setName('user').setDescription('Пользователь').setRequired(true))
      .addStringOption(o => o.setName('role_id').setDescription('ID роли (из /list-roles)').setRequired(true)),

    new SlashCommandBuilder()
      .setName('list-roles').setDescription('Список всех ролей сервера'),

    new SlashCommandBuilder()
      .setName('online').setDescription('Онлайн сервера'),

    new SlashCommandBuilder()
      .setName('status').setDescription('Статус бота и сайта'),

    new SlashCommandBuilder()
      .setName('restart-bot').setDescription('Перезапустить бота (только для администраторов)'),
  ].map(c => c.toJSON());

  const rest = new REST({ version: '10' }).setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`[Commands] Зарегистрировано ${commands.length} команд`);
  } catch (err) {
    console.error('[Commands] Ошибка регистрации:', err);
  }
}
