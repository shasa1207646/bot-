import {
  ChatInputCommandInteraction, EmbedBuilder,
  PermissionFlagsBits, ColorResolvable,
} from 'discord.js';
import pool from '../db/pool';

export async function handleCommand(interaction: ChatInputCommandInteraction) {
  const { commandName } = interaction;

  // ─── /help ───────────────────────────────────────────────────────────────
  if (commandName === 'help') {
    const embed = new EmbedBuilder()
      .setTitle('📖 Команды бота')
      .setColor('#00d4ff' as ColorResolvable)
      .addFields(
        { name: '/help',                          value: 'Показать это сообщение',         inline: false },
        { name: '/ban <user> [reason]',           value: 'Забанить пользователя',          inline: false },
        { name: '/kick <user> [reason]',          value: 'Кикнуть пользователя',           inline: false },
        { name: '/mute <user> <minutes> [reason]',value: 'Замутить пользователя',          inline: false },
        { name: '/violations <user>',             value: 'Показать нарушения пользователя',inline: false },
        { name: '/create-role <name> [color]',    value: 'Создать роль (HEX-цвет)',        inline: false },
        { name: '/action <user> give_role <role>',value: 'Выдать роль пользователю',       inline: false },
        { name: '/action <user> send_message <text>',value: 'Отправить ЛС пользователю',  inline: false },
      )
      .setFooter({ text: 'Petushara Team — Бот администрации' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ─── /ban ─────────────────────────────────────────────────────────────────
  if (commandName === 'ban') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ content: '❌ У вас нет прав для бана.', ephemeral: true });
    }
    const user   = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Без причины';
    try {
      await interaction.guild!.members.ban(user.id, { reason });
      await pool.query(
        `INSERT INTO bans (user_id, username, reason, banned_by) VALUES ($1, $2, $3, $4)`,
        [user.id, user.username, reason, interaction.user.username]
      ).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔨 Пользователь забанен')
        .setColor('#ff4444' as ColorResolvable)
        .addFields(
          { name: 'Пользователь', value: `<@${user.id}>`, inline: true },
          { name: 'Причина',      value: reason,           inline: true },
          { name: 'Модератор',    value: `<@${interaction.user.id}>`, inline: true },
        ).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    } catch {
      return interaction.reply({ content: '❌ Не удалось забанить.', ephemeral: true });
    }
  }

  // ─── /kick ────────────────────────────────────────────────────────────────
  if (commandName === 'kick') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.KickMembers)) {
      return interaction.reply({ content: '❌ У вас нет прав для кика.', ephemeral: true });
    }
    const user   = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'Без причины';
    try {
      const member = await interaction.guild!.members.fetch(user.id);
      await member.kick(reason);
      const embed = new EmbedBuilder()
        .setTitle('👢 Пользователь кикнут')
        .setColor('#ff8800' as ColorResolvable)
        .addFields(
          { name: 'Пользователь', value: `<@${user.id}>`, inline: true },
          { name: 'Причина',      value: reason,           inline: true },
          { name: 'Модератор',    value: `<@${interaction.user.id}>`, inline: true },
        ).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    } catch {
      return interaction.reply({ content: '❌ Не удалось кикнуть.', ephemeral: true });
    }
  }

  // ─── /mute ────────────────────────────────────────────────────────────────
  if (commandName === 'mute') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers)) {
      return interaction.reply({ content: '❌ У вас нет прав для мута.', ephemeral: true });
    }
    const user    = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason  = interaction.options.getString('reason') || 'Без причины';
    try {
      const member = await interaction.guild!.members.fetch(user.id);
      const until  = new Date(Date.now() + Math.min(minutes * 60000, 28 * 24 * 60 * 60 * 1000));
      await member.disableCommunicationUntil(until, reason);
      await pool.query(
        `INSERT INTO mutes (user_id, username, reason, muted_by, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.username, reason, interaction.user.username, until]
      ).catch(() => {});
      const embed = new EmbedBuilder()
        .setTitle('🔇 Пользователь замучен')
        .setColor('#ffcc00' as ColorResolvable)
        .addFields(
          { name: 'Пользователь', value: `<@${user.id}>`,        inline: true },
          { name: 'Длительность', value: `${minutes} мин.`,       inline: true },
          { name: 'Причина',      value: reason,                   inline: true },
          { name: 'Модератор',    value: `<@${interaction.user.id}>`, inline: true },
        ).setTimestamp();
      return interaction.reply({ embeds: [embed] });
    } catch {
      return interaction.reply({ content: '❌ Не удалось замутить.', ephemeral: true });
    }
  }

  // ─── /violations ──────────────────────────────────────────────────────────
  if (commandName === 'violations') {
    const user = interaction.options.getUser('user', true);
    try {
      const result = await pool.query(
        `SELECT * FROM violations WHERE discord_id=$1 ORDER BY logged_at DESC LIMIT 10`,
        [user.id]
      );
      if (result.rows.length === 0) {
        return interaction.reply({ content: `✅ У <@${user.id}> нет зафиксированных нарушений.`, ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setTitle(`📋 Нарушения: @${user.username}`)
        .setColor('#ff8800' as ColorResolvable)
        .setDescription(result.rows.map((v, i) =>
          `**${i + 1}.** ${v.type} — <#${v.channel_id}> — <t:${Math.floor(new Date(v.logged_at).getTime() / 1000)}:R>`
        ).join('\n'))
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Ошибка получения нарушений.', ephemeral: true });
    }
  }

  // ─── /create-role ─────────────────────────────────────────────────────────
  if (commandName === 'create-role') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Нет прав для создания ролей.', ephemeral: true });
    }
    const name  = interaction.options.getString('name', true);
    const color = (interaction.options.getString('color') || '#99aab5') as ColorResolvable;
    try {
      const role = await interaction.guild!.roles.create({ name, color, reason: '/create-role' });
      return interaction.reply({ content: `✅ Роль **${role.name}** создана!`, ephemeral: true });
    } catch {
      return interaction.reply({ content: '❌ Не удалось создать роль.', ephemeral: true });
    }
  }

  // ─── /action ──────────────────────────────────────────────────────────────
  if (commandName === 'action') {
    const user  = interaction.options.getUser('user', true);
    const type  = interaction.options.getString('type', true);
    const value = interaction.options.getString('value', true);
    const guild = interaction.guild!;

    if (type === 'give_role') {
      const role = guild.roles.cache.find(r => r.name.toLowerCase() === value.toLowerCase());
      if (!role) return interaction.reply({ content: `❌ Роль "${value}" не найдена.`, ephemeral: true });
      try {
        const member = await guild.members.fetch(user.id);
        await member.roles.add(role);
        return interaction.reply({ content: `✅ Роль **${role.name}** выдана <@${user.id}>`, ephemeral: true });
      } catch {
        return interaction.reply({ content: '❌ Не удалось выдать роль.', ephemeral: true });
      }
    }

    if (type === 'send_message') {
      try {
        await user.send(value);
        return interaction.reply({ content: `✅ Сообщение отправлено <@${user.id}>`, ephemeral: true });
      } catch {
        return interaction.reply({ content: '❌ Не удалось отправить (ЛС закрыты).', ephemeral: true });
      }
    }
  }

  // ─── /troll ───────────────────────────────────────────────────────────────
  if (commandName === 'troll') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.MoveMembers)) {
      return interaction.reply({ content: '❌ Нет прав для троллинга.', ephemeral: true });
    }
    const user   = interaction.options.getUser('user', true);
    const action = interaction.options.getString('action', true);
    const guild  = interaction.guild!;

    try {
      const member = await guild.members.fetch(user.id);

      if (action === 'shame_role') {
        let shameRole = guild.roles.cache.find(r => r.name === '🐔 Петух');
        if (!shameRole) {
          shameRole = await guild.roles.create({ name: '🐔 Петух', color: '#ff69b4' as ColorResolvable, reason: 'Унизительная роль' });
        }
        await member.roles.add(shameRole);
        return interaction.reply({ content: `🐔 <@${user.id}> получил роль **🐔 Петух**!`, ephemeral: false });
      }

      if (action === 'disconnect_voice') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        await member.voice.disconnect('Выкинут администратором');
        return interaction.reply({ content: `🔇 <@${user.id}> выкинут из войса!` });
      }

      if (action === 'server_mute') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        await member.voice.setMute(true, 'Мут администратором');
        return interaction.reply({ content: `🙊 <@${user.id}> замучен в войсе!` });
      }

      if (action === 'unmute_voice') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        await member.voice.setMute(false, 'Мут снят');
        return interaction.reply({ content: `🎤 <@${user.id}> размучен в войсе!` });
      }

      if (action === 'server_deafen') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        await member.voice.setDeaf(true, 'Deaf администратором');
        return interaction.reply({ content: `🔕 <@${user.id}> оглушён в войсе!` });
      }

      if (action === 'undeafen_voice') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        await member.voice.setDeaf(false, 'Deaf снят');
        return interaction.reply({ content: `🔊 <@${user.id}> слышит снова!` });
      }

      if (action === 'fast_jump' || action === 'slow_jump') {
        if (!member.voice.channel) return interaction.reply({ content: '❌ Пользователь не в голосовом канале.', ephemeral: true });
        const voiceChannels = guild.channels.cache.filter((c: any) => c.type === 2).map(c => c) as any[];
        if (voiceChannels.length < 2) return interaction.reply({ content: '❌ Нет достаточного количества голосовых каналов.', ephemeral: true });
        const jumps  = 5;
        const delay  = action === 'fast_jump' ? 800 : 3000;
        await interaction.reply({ content: `${action === 'fast_jump' ? '⚡' : '🐌'} Начинаю прыжки для <@${user.id}>!` });
        for (let i = 0; i < jumps; i++) {
          const rand = voiceChannels[Math.floor(Math.random() * voiceChannels.length)];
          await member.voice.setChannel(rand).catch(() => {});
          await new Promise(r => setTimeout(r, delay));
        }
        return;
      }
    } catch (e) {
      return interaction.reply({ content: '❌ Ошибка выполнения действия.', ephemeral: true });
    }
  }

  // ─── /give-role ───────────────────────────────────────────────────────────
  if (commandName === 'give-role') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Нет прав для выдачи ролей.', ephemeral: true });
    }
    const user   = interaction.options.getUser('user', true);
    const roleId = interaction.options.getString('role_id', true);
    try {
      const member = await interaction.guild!.members.fetch(user.id);
      const role   = interaction.guild!.roles.cache.get(roleId);
      if (!role) return interaction.reply({ content: '❌ Роль не найдена. Используйте /list-roles для списка.', ephemeral: true });
      await member.roles.add(role);
      return interaction.reply({ content: `✅ Роль **${role.name}** выдана <@${user.id}>` });
    } catch {
      return interaction.reply({ content: '❌ Не удалось выдать роль.', ephemeral: true });
    }
  }

  // ─── /remove-role ─────────────────────────────────────────────────────────
  if (commandName === 'remove-role') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Нет прав для снятия ролей.', ephemeral: true });
    }
    const user   = interaction.options.getUser('user', true);
    const roleId = interaction.options.getString('role_id', true);
    try {
      const member = await interaction.guild!.members.fetch(user.id);
      const role   = interaction.guild!.roles.cache.get(roleId);
      if (!role) return interaction.reply({ content: '❌ Роль не найдена.', ephemeral: true });
      await member.roles.remove(role);
      return interaction.reply({ content: `✅ Роль **${role.name}** снята с <@${user.id}>` });
    } catch {
      return interaction.reply({ content: '❌ Не удалось снять роль.', ephemeral: true });
    }
  }

  // ─── /list-roles ──────────────────────────────────────────────────────────
  if (commandName === 'list-roles') {
    const roles = interaction.guild!.roles.cache
      .filter(r => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map(r => `**${r.name}** — \`${r.id}\` (${r.members.size} чел.)`)
      .slice(0, 25)
      .join('\n');
    const embed = new EmbedBuilder()
      .setTitle('📋 Роли сервера')
      .setColor('#00d4ff' as ColorResolvable)
      .setDescription(roles || 'Ролей нет')
      .setFooter({ text: 'ID роли использовать в /give-role и /remove-role' })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  // ─── /online ──────────────────────────────────────────────────────────────
  if (commandName === 'online') {
    const guild = interaction.guild!;
    await guild.members.fetch();
    const total   = guild.memberCount;
    const online  = guild.members.cache.filter(m => m.presence?.status !== 'offline' && m.presence?.status !== undefined).size;
    const inVoice = guild.channels.cache.filter((c: any) => c.type === 2).reduce((acc: number, c: any) => acc + (c.members?.size || 0), 0);
    const embed = new EmbedBuilder()
      .setTitle(`📊 Онлайн — ${guild.name}`)
      .setColor('#00ff88' as ColorResolvable)
      .addFields(
        { name: '👥 Всего участников', value: String(total),   inline: true },
        { name: '🟢 Онлайн',          value: String(online),  inline: true },
        { name: '🎙️ В голосовых',     value: String(inVoice), inline: true },
      )
      .setThumbnail(guild.iconURL({ size: 128 }))
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /status ──────────────────────────────────────────────────────────────
  if (commandName === 'status') {
    const uptime  = process.uptime();
    const hours   = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const ping    = interaction.client.ws.ping;
    const embed = new EmbedBuilder()
      .setTitle('🔧 Статус бота')
      .setColor('#7c3aed' as ColorResolvable)
      .addFields(
        { name: '🟢 Статус',   value: 'Онлайн',                     inline: true },
        { name: '⏱ Аптайм',   value: `${hours}ч ${minutes}м`,       inline: true },
        { name: '📡 Ping',     value: `${ping}ms`,                   inline: true },
        { name: '🤖 Версия',   value: `Node ${process.version}`,     inline: true },
      )
      .setTimestamp();
    return interaction.reply({ embeds: [embed] });
  }

  // ─── /restart-bot ─────────────────────────────────────────────────────────
  if (commandName === 'restart-bot') {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ Только для администраторов.', ephemeral: true });
    }
    await interaction.reply({ content: '🔄 Перезапускаю бота...' });
    setTimeout(() => process.exit(0), 1500);
    return;
  }
}
