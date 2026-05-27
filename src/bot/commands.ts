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
}
