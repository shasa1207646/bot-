import {
  Client, GatewayIntentBits, Partials,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ButtonInteraction, ChatInputCommandInteraction, ColorResolvable,
} from 'discord.js';
import { containsBadWord, getBadWords } from './badwords';
import { handleCommand } from './commands';
import pool from '../db/pool';

export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

discordClient.once('ready', async () => {
  console.log(`[Discord] Бот запущен как ${discordClient.user?.tag}`);
  const guildId = process.env.DISCORD_GUILD_ID;
  if (guildId) {
    try {
      const guild = await discordClient.guilds.fetch(guildId);
      await guild.members.fetch();
      console.log(`[Discord] Кэш участников загружен: ${guild.members.cache.size}`);
    } catch (err) {
      console.error('[Discord] Ошибка загрузки кэша:', err);
    }
  }
});

// ─── Фильтр сообщений + логирование нарушений ────────────────────────────────
discordClient.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (containsBadWord(message.content)) {
    try {
      await message.delete();
      const warn = await message.channel.send(
        `⚠️ <@${message.author.id}>, нецензурная лексика запрещена правилами сервера!`
      );
      setTimeout(() => warn.delete().catch(() => {}), 6000);

      // Логируем нарушение в БД
      const found = getBadWords(message.content);
      await pool.query(
        `INSERT INTO violations (discord_id, username, type, content, channel_id)
         VALUES ($1, $2, 'badword', $3, $4)`,
        [
          message.author.id,
          message.author.username,
          `[СКРЫТО: ${found.length} слов]`,
          message.channelId,
        ]
      ).catch(e => console.error('[DB] Ошибка лога нарушения:', e));

      // Отправить в лог-канал если задан
      const logChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
      if (logChannelId) {
        try {
          const logChannel = await discordClient.channels.fetch(logChannelId) as any;
          const logEmbed = new EmbedBuilder()
            .setTitle('🚫 Нарушение: нецензурная лексика')
            .setColor('#ff4444' as ColorResolvable)
            .addFields(
              { name: 'Пользователь', value: `<@${message.author.id}> (@${message.author.username})`, inline: true },
              { name: 'Канал', value: `<#${message.channelId}>`, inline: true },
              { name: 'Слов найдено', value: String(found.length), inline: true },
            )
            .setTimestamp();
          await logChannel.send({ embeds: [logEmbed] });
        } catch {}
      }
    } catch (e) {
      console.warn('[Discord] Ошибка фильтра:', e);
    }
    return;
  }
});

// ─── Slash-команды и кнопки заявок ───────────────────────────────────────────
discordClient.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction as ChatInputCommandInteraction);
    return;
  }

  if (interaction.isButton()) {
    const btn = interaction as ButtonInteraction;
    const parts = btn.customId.split('_');
    const action = parts[0]; // approve | reject
    const appId = parts[1];

    if (action !== 'approve' && action !== 'reject') return;

    if (!btn.memberPermissions?.has('ManageRoles' as any)) {
      return btn.reply({ content: '❌ У вас нет прав для этого действия.', ephemeral: true });
    }

    await btn.deferReply({ ephemeral: true });

    try {
      const result = await pool.query('SELECT * FROM applications WHERE id = $1', [appId]);
      const app = result.rows[0];
      if (!app) return btn.editReply('❌ Заявка не найдена.');
      if (app.status !== 'pending') return btn.editReply('⚠️ Заявка уже обработана.');

      const guild = btn.guild!;

      if (action === 'approve') {
        let role = guild.roles.cache.find(r => r.name === 'Обзвон');
        if (!role) {
          role = await guild.roles.create({ name: 'Обзвон', color: '#57f287' as ColorResolvable });
        }
        try {
          const member = await guild.members.fetch(app.discord_id);
          await member.roles.add(role);
          const voiceLink = process.env.DISCORD_VOICE_CHANNEL_ID
            ? `\n🎙️ Голосовой канал: https://discord.com/channels/${guild.id}/${process.env.DISCORD_VOICE_CHANNEL_ID}`
            : '';
          await member.send(`✅ Ваша заявка одобрена! Добро пожаловать на сервер 🎮${voiceLink}`);
        } catch {}

        await pool.query(
          `UPDATE applications SET status='approved', decided_by=$1 WHERE id=$2`,
          [btn.user.username, appId]
        );
        await btn.editReply('✅ Заявка принята, роль «Обзвон» выдана.');
      } else {
        try {
          const member = await guild.members.fetch(app.discord_id);
          await member.send('❌ Ваша заявка отклонена. Вы можете подать её повторно позже.');
        } catch {}

        await pool.query(
          `UPDATE applications SET status='rejected', decided_by=$1 WHERE id=$2`,
          [btn.user.username, appId]
        );
        await btn.editReply('❌ Заявка отклонена.');
      }

      // Обновляем embed — убираем кнопки, меняем цвет
      const statusLabel = action === 'approve' ? '✅ Принята' : '❌ Отклонена';
      const originalEmbed = btn.message.embeds[0];
      if (originalEmbed) {
        const updated = EmbedBuilder.from(originalEmbed)
          .setFooter({ text: `${statusLabel} — ${btn.user.username}` })
          .setColor((action === 'approve' ? '#57f287' : '#ff4444') as ColorResolvable);
        await btn.message.edit({ embeds: [updated], components: [] });
      }
    } catch (err) {
      console.error('[Discord] Ошибка кнопки:', err);
      await btn.editReply('❌ Произошла ошибка.');
    }
  }
});

// ─── Отправка заявки в Discord-канал ─────────────────────────────────────────
export async function sendApplicationToDiscord(app: any) {
  const channelId = process.env.DISCORD_CHANNEL_ID;
  if (!channelId) {
    console.warn('[Discord] DISCORD_CHANNEL_ID не задан');
    return;
  }

  try {
    const channel = await discordClient.channels.fetch(channelId) as any;
    if (!channel) return;

    const typeLabel =
      app.type === 'curator'   ? '🎯 Заявка куратора' :
      app.type === 'moderator' ? '🛡️ Заявка модератора' :
                                  '🎮 Заявка на вступление';

    const embed = new EmbedBuilder()
      .setTitle(`${typeLabel} #${app.id}`)
      .setColor('#7c3aed' as ColorResolvable)
      .setThumbnail(app.discord_avatar || null)
      .addFields(
        { name: '👤 Discord',    value: `@${app.username || '—'}`, inline: true },
        { name: '🎂 Возраст',    value: String(app.age || '—'),    inline: true },
        { name: '📛 Имя',        value: app.name || '—',           inline: true },
        { name: '⏱ Активность', value: app.activity || '—',       inline: true },
        { name: '🎮 Игры',       value: app.games || '—',          inline: true },
        { name: '✅ Правила',    value: app.rules ? 'Принимает' : 'Не принимает', inline: true },
      )
      .setTimestamp()
      .setFooter({ text: `ID: ${app.discord_id}` });

    if (app.type === 'curator' || app.type === 'moderator') {
      if (app.experience) embed.addFields({ name: '📋 Опыт', value: app.experience, inline: false });
      if (app.motivation) embed.addFields({ name: '💬 Мотивация', value: app.motivation, inline: false });
    }

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`approve_${app.id}`)
        .setLabel('✅ Принять')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`reject_${app.id}`)
        .setLabel('❌ Отклонить')
        .setStyle(ButtonStyle.Danger),
    );

    await channel.send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error('[Discord] Ошибка отправки заявки:', err);
  }
}

export function startDiscordBot() {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) {
    console.warn('[Discord] DISCORD_BOT_TOKEN не задан, бот не запущен');
    return;
  }
  discordClient.login(token).catch(err => console.error('[Discord] Ошибка входа:', err));
}
