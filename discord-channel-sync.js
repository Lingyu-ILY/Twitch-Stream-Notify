const { Client, PermissionsBitField } = require('discord.js');

/**
 * Helper class for syncing Discord target channels.
 */
class DiscordChannelSync {
    static async getChannelList(client, channelIds, verbose) {
        let nextTargetChannels = [];

        try {
            if (!client.isReady()) {
                throw new Error('Client is not ready');
            }

            const guilds = await client.guilds.fetch();

            for (const [guildId, guild] of guilds) {
                const fullGuild = await client.guilds.fetch(guildId);
                const channels = await fullGuild.channels.fetch();

                if (verbose) {
                    console.log('[Discord]', `正在獲取公會的頻道: ${fullGuild.name}`);
                    console.log('[Discord]', `可用頻道: ${channels.map(c => c.id).join(', ')}`);
                }

                for (const channelId of channelIds) {
                    const targetChannel = channels.get(channelId);

                    if (targetChannel) {
                        if (targetChannel.type !== 0) {
                            if (verbose) {
                                console.warn('[Discord]', 'Configuration problem /!\\', `Channel ID ${channelId} in Guild ${fullGuild.name} is not a text channel.`);
                            }
                        } else {
                            const permissions = targetChannel.permissionsFor(fullGuild.members.me);

                            if (verbose) {
                                console.log('[Discord]', ' --> ', `伺服器成員 ${fullGuild.name}, 目標頻道是 #${targetChannel.name}`);
                                console.log('[Discord]', '權限:', permissions.toArray());
                            }

                            if (!permissions.has(PermissionsBitField.Flags.SendMessages)) {
                                if (verbose) {
                                    console.warn('[Discord]', '權限問題 /!\\', `我沒有頻道上的 SEND_MESSAGES 權限 #${targetChannel.name} 於 ${fullGuild.name}: 公告發送將會失敗.`);
                                }
                            } else {
                                nextTargetChannels.push(targetChannel);
                            }
                        }
                    }
                }
            }

            if (verbose) {
                console.log('[Discord]', `發現 ${nextTargetChannels.length} 個公告頻道.`);
            }
        } catch (error) {
            console.error('[Discord]', '取得頻道時發生錯誤:', error);
        }

        return nextTargetChannels;
    }
}

module.exports = DiscordChannelSync;
