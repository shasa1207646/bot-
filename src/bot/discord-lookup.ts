import { Client, GuildMember } from 'discord.js';

function matchesUsername(member: GuildMember, cleanName: string): boolean {
  return (
    member.user.username.toLowerCase() === cleanName ||
    member.displayName.toLowerCase() === cleanName ||
    (member.user.globalName != null && member.user.globalName.toLowerCase() === cleanName)
  );
}

function formatMember(member: GuildMember) {
  return {
    found: true,
    discord_id: member.user.id,
    username: member.user.username,
    displayName: member.displayName,
    avatar: member.user.displayAvatarURL({ size: 128 }),
    roles: member.roles.cache
      .filter(r => r.name !== '@everyone')
      .map(r => ({ name: r.name, color: r.hexColor })),
    joinedAt: member.joinedAt?.toISOString(),
  };
}

export async function lookupDiscordUser(client: Client, username: string) {
  try {
    const guildId = process.env.DISCORD_GUILD_ID!;
    const guild   = await client.guilds.fetch(guildId);
    const cleanName = username.replace(/^@/, '').toLowerCase().trim();

    try {
      const results = await guild.members.search({ query: cleanName, limit: 10 });
      const found = results.find(m => matchesUsername(m, cleanName));
      if (found) return formatMember(found);
    } catch {}

    try { await guild.members.fetch(); } catch {}
    const member = guild.members.cache.find(m => matchesUsername(m, cleanName));
    if (!member) return { found: false };
    return formatMember(member);
  } catch (err) {
    console.error('[Discord Lookup]', err);
    return { found: false, error: 'Ошибка поиска' };
  }
}
