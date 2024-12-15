const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, REST, Routes, Collection, EmbedBuilder } = require('discord.js');
const config = require('./config.json');
require('dotenv').config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMembers,
    ]
});

global.discordJsClient = client;

const TwitchMonitor = require("./twitch-monitor");
const DiscordChannelSync = require("./discord-channel-sync");
const LiveEmbed = require('./live-embed');
const MiniDb = require('./minidb');
const debounce = new Map();


const commands = [
    {
        name: 'setup',
        description: '設定你的機器人',
        options: [
            {
                type: 3, // STRING
                name: 'twitch_channels',
                description: 'Comma-separated list of Twitch channels',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'discord_announce_channel',
                description: 'Discord channel for announcements',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'twitch_client_id',
                description: 'Twitch client ID',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'twitch_oauth_token',
                description: 'Twitch OAuth token',
                required: true,
            },
            {
                type: 4, // INTEGER
                name: 'twitch_check_interval_ms',
                description: 'Twitch 檢查間隔(毫秒)',
                required: true,
            },
            {
                type: 5, // BOOLEAN
                name: 'twitch_use_boxart',
                description: 'Whether to use Twitch box art',
                required: true,
            }
        ],
    },
    {
        name: 'help',
        description: 'Get information about available commands',
    },
    {
        name: 'gettokens',
        description: 'Get instructions on how to obtain your Twitch tokens',
    },

    {
        name: 'addchannel',
        description: 'Add a new channel ID to the announcement list',
        options: [
            {
                type: 3, // STRING
                name: 'channel_id',
                description: 'The ID of the Discord channel to add',
                required: true,
            }
        ],
    },
    {
        name: 'listchannel',
        description: 'List all announcement channel IDs',
    },
    {
        name: 'deletechannel',
        description: 'Remove a channel ID from the announcement list',
        options: [
            {
                type: 3, // STRING
                name: 'channel_id',
                description: 'The ID of the Discord channel to remove',
                required: true,
            }
        ],
    },
    {
        name: 'setservermention',
        description: 'Set server-specific mention for a Twitch channel',
        options: [
            {
                type: 3, // STRING
                name: 'twitch_channel',
                description: 'The Twitch channel name',
                required: true,
            },
            {
                type: 3, // STRING
                name: 'role_name',
                description: 'The role name to mention (or "none" for no mention)',
                required: true,
            }
        ],
    },
];
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN || config.discord_bot_token);

client.once('ready', async () => {
    console.log(`[Discord] 應用準備完成; 登入為 ${client.user.tag}.`);

    // Register slash commands
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands,
        });

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }


    await syncServerList(true);

    StreamActivity.init(client);

    TwitchMonitor.start();
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'setup') {
        try {
            const twitchChannels = options.getString('twitch_channels');
            const discordAnnounceChannels = options.getString('discord_announce_channel').split(',');
            const twitchClientId = options.getString('twitch_client_id');
            const twitchOauthToken = options.getString('twitch_oauth_token');
            const twitchCheckIntervalMs = options.getInteger('twitch_check_interval_ms');
            const twitchUseBoxart = options.getBoolean('twitch_use_boxart');

            const newConfig = {
                ...config,
                twitch_channels: twitchChannels,
                discord_announce_channel: discordAnnounceChannels,
                twitch_client_id: twitchClientId,
                twitch_oauth_token: twitchOauthToken,
                twitch_check_interval_ms: twitchCheckIntervalMs,
                twitch_use_boxart: twitchUseBoxart,
            };

            fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(newConfig, null, 2));

            // Reload config
            Object.assign(config, newConfig);

            // Trigger refresh
            TwitchMonitor.start(); // Restart TwitchMonitor with new config
            await syncServerList(true); // Refresh Discord channels list

            await interaction.reply('Configuration updated and refreshed successfully!');
        } catch (error) {
            console.error('Error updating configuration:', error.message);
            await interaction.reply(`Failed to update configuration. ${error.message}`);
        }
    }else if (commandName === 'addchannel') {
        try {
            const channelId = options.getString('channel_id');
            
            if (!channelId) {
                throw new Error('Channel ID is required.');
            }

            if (config.discord_announce_channel.includes(channelId)) {
                await interaction.reply('Channel ID is already in the announcement list.');
                return;
            }

            config.discord_announce_channel.push(channelId);

            fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));

            // Reload config
            Object.assign(config, { discord_announce_channel: config.discord_announce_channel });

            // Trigger refresh
            await syncServerList(true); // Refresh Discord channels list

            await interaction.reply('Channel ID added and configuration refreshed successfully!');
        } catch (error) {
            console.error('Error adding channel:', error.message);
            await interaction.reply(`Failed to add channel. ${error.message}`);
        }
    
    } else if (commandName === 'listchannel') {
        try {
            const guilds = client.guilds.cache;
            let description = '';

            for (const [guildId, guild] of guilds) {
                const channels = guild.channels.cache.filter(channel => config.discord_announce_channel.includes(channel.id));
                if (channels.size > 0) {
                    description += `**Server:** ${guild.name}\n`;
                    channels.forEach(channel => {
                        description += `- **Channel(s):** ${channel.name} (ID: ${channel.id})\n`;
                    });
                    description += '\n';
                }
            }

            if (description === '') {
                description = 'No announcement channels set.';
            }

            const listEmbed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('Announcement Channels')
                .setDescription(description);

            await interaction.reply({ embeds: [listEmbed], ephemeral: true });
        } catch (error) {
            console.error('Error listing channels:', error.message);
            await interaction.reply(`Failed to list channels. ${error.message}`);
        }
    
    } else if (commandName === 'deletechannel') {
        try {
            const channelId = options.getString('channel_id');
            
            if (!channelId) {
                throw new Error('Channel ID is required.');
            }

            const index = config.discord_announce_channel.indexOf(channelId);
            if (index === -1) {
                await interaction.reply('Channel ID is not in the announcement list.');
                return;
            }

            config.discord_announce_channel.splice(index, 1);

            fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));

            // Reload config
            Object.assign(config, { discord_announce_channel: config.discord_announce_channel });

            // Trigger refresh
            await syncServerList(true); // Refresh Discord channels list

            await interaction.reply('Channel ID removed and configuration refreshed successfully!');
        } catch (error) {
            console.error('Error removing channel:', error.message);
            await interaction.reply(`Failed to remove channel. ${error.message}`);
        }
    
    } else if (commandName === 'help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('幫助 - 設定指令')
            .addFields(
                { name: '**/setup**', value: '設定應用.' },
                { name: '**twitch_channels**', value: 'Comma-separated list of Twitch channels to monitor. You can add as little or as many as you want. Syntax: `channel1,channel2`' },
                { name: '**discord_announce_channel**', value: 'The name of the Discord channel where announcements will be made (e.g., `announcements`).' },
                { name: '**discord_mentions**', value: 'JSON string for Discord mentions, used for notifying users when a stream goes live.' },
                { name: '**twitch_client_id**', value: 'Your Twitch client ID for OAuth2 authentication.' },
                { name: '**twitch_oauth_token**', value: 'Your Twitch OAuth token for authentication.' },
                { name: '**twitch_check_interval_ms**', value: 'Interval in milliseconds to check Twitch status.' },
                { name: '**twitch_use_boxart**', value: 'Whether to use Twitch box art in the announcement messages.' }
            );

        await interaction.reply({ embeds: [helpEmbed] });
    
    } else if (commandName === 'gettokens') {
        const tokensEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Obtaining Twitch Tokens')
            .setDescription('To get your Twitch tokens, follow these instructions: [Twitch OAuth Documentation](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth)');

        await interaction.reply({ embeds: [tokensEmbed] });
    }
    else if (commandName === 'setservermention') {
        try {
            const twitchChannel = options.getString('twitch_channel');
            const roleName = options.getString('role_name');

            if (!config.discord_mentions[twitchChannel]) {
                config.discord_mentions[twitchChannel] = {
                    default: '',
                    server_specific: {}
                };
            }

            config.discord_mentions[twitchChannel].server_specific = {
                ...config.discord_mentions[twitchChannel].server_specific,
                [interaction.guild.id]: roleName
            };

            fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));

            await interaction.reply(`Server-specific mention for ${twitchChannel} updated to ${roleName}.`);
        } catch (error) {
            console.error('Error updating server-specific mention:', error.message);
            await interaction.reply(`Failed to update server-specific mention. ${error.message}`);
        }
    }
});
// --- Startup ---------------------------------------------------------------------------------------------------------
console.log('Twitch Notify 應用已啟動.');

// --- Discord ---------------------------------------------------------------------------------------------------------
console.log('連線至Discord中...');

let targetChannels = [];

let syncServerList = async (logMembership) => {
    try {
        console.log('[Discord] 同步伺服器清單...');
        const channelIds = config.discord_announce_channel;
        targetChannels = await DiscordChannelSync.getChannelList(client, channelIds, logMembership);
        console.log(`[Discord] 已同步 ${targetChannels.length} 頻道`);
        targetChannels.forEach(channel => console.log(`頻道 ID: ${channel.id}, 名稱: ${channel.name}`));
    } catch (error) {
        console.error('[Discord] 同步伺服器清單錯誤:', error);
    }
};



client.once('ready', async () => {
    console.log(`[Discord] 應用準備完成; 登入為 ${client.user.tag}.`);

    try {
        console.log('開始更新應用 (/) 指令.');

        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands,
        });

        console.log('應用 (/) 指令更新完成.');
    } catch (error) {
        console.error('註冊指令錯誤:', error);
    }

    // Init list of connected servers, and determine which channels we are announcing to
    await syncServerList(true);

    // Keep our activity in the user list in sync
    StreamActivity.init(client);

    // Begin Twitch API polling
    TwitchMonitor.start();
});

client.on('guildCreate', guild => {
    console.log(`[Discord]`, `加入新伺服器: ${guild.name}`);

    syncServerList(false);
});

client.on('guildDelete', guild => {
    console.log(`[Discord]`, `移除於伺服器: ${guild.name}`);

    syncServerList(false);
});

console.log('[Discord]', '登入中...');
client.login(process.env.DISCORD_BOT_TOKEN || config.discord_bot_token);

// Activity updater
class StreamActivity {
    static onlineChannels = {};
    static discordClient = null;

    static setChannelOnline(stream) {
        this.onlineChannels[stream.user_name] = stream;
        console.log('[直播動態]', `頻道上線: ${stream.user_name}`);
        this.updateActivity();
    }

    static setChannelOffline(stream) {
        delete this.onlineChannels[stream.user_name];
        console.log('[直播動態]', `頻道離線: ${stream.user_name}`);
        this.updateActivity();
    }

    static clearAllChannels() {
        this.onlineChannels = {};
        console.log('[直播動態]', '清除所有頻道');
        this.updateActivity();
    }

    static getMostRecentStreamInfo() {
        let lastChannel = null;
        for (let channelName in this.onlineChannels) {
            if (typeof channelName !== "undefined" && channelName) {
                lastChannel = this.onlineChannels[channelName];
            }
        }
        return lastChannel;
    }
    static updateActivity() {
        let streamInfo = this.getMostRecentStreamInfo();
        if (streamInfo) {
            this.discordClient.user.setActivity({
                name: streamInfo.user_name,
                type: 1, // 1 is 'STREAMING'
                url: `https://twitch.tv/${streamInfo.user_name.toLowerCase()}`
            });
            console.log('[直播動態]', `更新目前動態: 直播中 ${streamInfo.user_name}.`);
        } else {
            console.log('[直播動態]', '清除目前動態.');
            this.discordClient.user.setActivity(null);
        }
    }

    static init(discordClient) {
        this.discordClient = discordClient;
        this.onlineChannels = {};

        this.updateActivity();

        setInterval(() => this.updateActivity(), 5 * 60 * 1000);
    }
}
// ---------------------------------------------------------------------------------------------------------------------
// Live events

let liveMessageDb = new MiniDb('live-messages');
let messageHistory = liveMessageDb.get("history") || {};

TwitchMonitor.onChannelLiveUpdate(async (streamData) => {
    const isLive = streamData.type === "live";
    const streamerName = streamData.user_name.toLowerCase();
    
    // Add debounce check -- plz work i beg u :))))))))))) (the double ping bug is annoying)
    const now = Date.now();
    const lastNotification = debounce.get(streamerName);
    if (lastNotification && (now - lastNotification) < 60000) { // 1 minute debounce
        console.log(`[Discord] 防震動通知 ${streamerName}`);
        return false;
    }
    debounce.set(streamerName, now);
    // Refresh channel list
    await syncServerList(false);

    // Update activity
    if (isLive) {
        StreamActivity.setChannelOnline(streamData);
    } else {
        StreamActivity.setChannelOffline(streamData);
    }

    // Generate message
    const msgFormatted = isLive 
        ? `${streamData.user_name} 正在 Twitch 上直播!`
        : `${streamData.user_name} 在 Twitch 上直播.`;
    const msgEmbed = LiveEmbed.createForStream(streamData);

    // Broadcast to all target channels
    let anySent = false;

for (const discordChannel of targetChannels) {
    const liveMsgDiscrim = `${discordChannel.guild.id}_${discordChannel.name}_${streamData.user_name.toLowerCase()}`;

    if (discordChannel) {
        try {
            // Either send a new message, or update an old one
            let existingMsgData = messageHistory[liveMsgDiscrim];
            let existingMsgId = existingMsgData && !existingMsgData.offline ? existingMsgData.id : null; // Only use the message if it's still live

            let defaultmentions = config.default_mention;
            let mentionMode = null;
            if (isLive) {  // Only include mention if the stream is live
                const streamerName = streamData.user_name.toLowerCase();
            
                if (config.discord_mentions && config.discord_mentions[streamerName]) {
                    const serverSpecificMentions = config.discord_mentions[streamerName].server_specific;
                    if (serverSpecificMentions && serverSpecificMentions[discordChannel.guild.id]) {
                        mentionMode = serverSpecificMentions[discordChannel.guild.id];
                    } else {
                        mentionMode = config.discord_mentions[streamerName].default;
                    }
                }
            
                if (mentionMode) {
                    mentionMode = mentionMode.toLowerCase();
            
                    if (mentionMode === "none") {
                        mentionMode = ""; 
                    } else if (mentionMode === "everyone" || mentionMode === "here") {
                        mentionMode = `@${mentionMode}`;
                    } else {
                        let roleData = discordChannel.guild.roles.cache.find(role => 
                            role.name.toLowerCase() === mentionMode
                        );
            
                        if (roleData) {
                            mentionMode = `<@&${roleData.id}>`;
                        } else {
                            console.log('[Discord]', 
                                `無法提及: ${mentionMode}, (不存在於伺服器 ${discordChannel.guild.name})`
                            );
                            mentionMode = ""; 
                        }
                    }
                }

                if (defaultmentions) {
                    defaultmentions = defaultmentions.toLowerCase();

                    if (defaultmentions === "none") {
                        defaultmentions = ""; 
                    } else if (defaultmentions === "everyone" || defaultmentions === "here") {
                        defaultmentions = `@${defaultmentions}`;
                    } else {
                        let roleData = discordChannel.guild.roles.cache.find(role => 
                            role.name.toLowerCase() === defaultmentions
                        );

                        if (roleData) {
                            defaultmentions = `<@&${roleData.id}>`;
                        } else {
                            console.log('[Discord]', 
                                `無法提及: ${defaultmentions}, (不存在於伺服器 ${discordChannel.guild.name})`
                            );
                            defaultmentions = ""; 
                        }
                    }
                }
            }

            let msgToSend = mentionMode ? `${msgFormatted} ${mentionMode}` : `${msgFormatted} ${defaultmentions}`;

            if (existingMsgId) {
                // Update existing message
                try {
                    const existingMsg = await discordChannel.messages.fetch(existingMsgId);
                    await existingMsg.edit({
                        content: msgToSend,
                        embeds: [msgEmbed]
                    });

                    // Update the message history
                    messageHistory[liveMsgDiscrim] = {
                        id: existingMsg.id,
                        offline: false,
                        timestamp: Date.now(),
                        lastUpdate: Date.now()
                    };
                    liveMessageDb.put('history', messageHistory);
                    
                    anySent = true;
                } catch (e) {
                    if (e.message === "Unknown Message") {
                        // Message was deleted, remove from history
                        delete messageHistory[liveMsgDiscrim];
                        liveMessageDb.put('history', messageHistory);
                        existingMsgId = null; // Allow sending a new message
                    } else {
                        console.warn('[Discord] 編輯訊息時出錯:', e);
                        continue;
                    }
                }
            }

            // Send new message if needed and stream is live
            if (!existingMsgId && isLive) {
                // Check for recent messages to prevent duplicates
                const recentThreshold = Date.now() - (60 * 1000); // 1 minute
                
                if (messageHistory[liveMsgDiscrim] && 
                    messageHistory[liveMsgDiscrim].timestamp > recentThreshold) {
                    console.log('[Discord]', 
                        `跳過 ${streamData.user_name} 的重複公告 (too soon)`
                    );
                    continue;
                }

                // Check for rate limiting
                const guildMsgCount = Object.keys(messageHistory).filter(key => 
                    key.startsWith(discordChannel.guild.id) && 
                    messageHistory[key].timestamp > recentThreshold
                ).length;

                if (guildMsgCount >= 5) { // Max 5 messages per minute per guild
                    console.log('[Discord]', 
                        `達到 ${discordChannel.guild.name} 訊息速率限制, 跳過公告`
                    );
                    continue;
                }

                try {
                    const message = await discordChannel.send({
                        content: msgToSend,
                        embeds: [msgEmbed]
                    });
                    console.log('[Discord]', 
                        `發送公告至 #${discordChannel.name} 位於 ${discordChannel.guild.name}`
                    );

                    // Store message info
                    messageHistory[liveMsgDiscrim] = {
                        id: message.id,
                        offline: false,
                        timestamp: Date.now(),
                        lastUpdate: Date.now()
                    };
                    liveMessageDb.put('history', messageHistory);
                    
                    anySent = true;
                } catch (err) {
                    console.log('[Discord]', 
                        `無法發送公告至 #${discordChannel.name} 位於 ${discordChannel.guild.name}: ${err.message}`
                    );
                    
                    // If we got a permissions error, we should remove this channel from our list
                    if (err.code === 50013) { // Missing Permissions
                        const index = targetChannels.indexOf(discordChannel);
                        if (index > -1) {
                            targetChannels.splice(index, 1);
                            console.log('[Discord]', 
                                `移除頻道 #${discordChannel.name} 由於缺少權限`
                            );
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[Discord]', '訊息處理發生問題:', e);
        }
    }
}

    // Clean up old messages periodically
    const cleanupThreshold = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    for (const [key, value] of Object.entries(messageHistory)) {
        if (value.timestamp < cleanupThreshold) {
            delete messageHistory[key];
        }
    }
    liveMessageDb.put('history', messageHistory);

    return anySent;
});

TwitchMonitor.onChannelOffline(async (streamData) => {
    console.log('[TwitchMonitor]', `頻道離線: ${streamData.user_name}`);

    // Refresh channel list
    await syncServerList(false);

    // Update activity
    StreamActivity.clearAllChannels();
    StreamActivity.setChannelOffline(streamData);

    // Reset message state 
    for (const discordChannel of targetChannels) {
        const liveMsgDiscrim = `${discordChannel.guild.id}_${discordChannel.name}_${streamData.user_name.toLowerCase()}`;
        if (messageHistory[liveMsgDiscrim]) {
            // Update the message to indicate the stream is offline
            try {
                const existingMsg = await discordChannel.messages.fetch(messageHistory[liveMsgDiscrim].id);
                await existingMsg.edit({
                    content: `${streamData.user_name} was live on Twitch.`,
                    embeds: [LiveEmbed.createForStream(streamData)] // Update the embed for offline state
                });
                messageHistory[liveMsgDiscrim].offline = true;
                liveMessageDb.put('history', messageHistory);
            } catch (e) {
                console.warn('[Discord]', `更新離線訊息發生錯誤 #${discordChannel.name} 於 ${discordChannel.guild.name}:`, e);
            }
        }
    }
});

// --- Common functions ------------------------------------------------------------------------------------------------
String.prototype.replaceAll = function(search, replacement) {
    return this.split(search).join(replacement);
};

String.prototype.spacifyCamels = function () {
    return this.replace(/([a-z](?=[A-Z]))/g, '$1 ');
};

Array.prototype.joinEnglishList = function () {
    return [this.slice(0, -1).join(', '), this.slice(-1)[0]].join(this.length < 2 ? '' : ' and ');
};

String.prototype.lowercaseFirstChar = function () {
    return this.charAt(0).toUpperCase() + this.slice(1);
};

Array.prototype.hasEqualValues = function (b) {
    if (this.length !== b.length) {
        return false;
    }

    this.sort();
    b.sort();

    for (let i = 0; i < this.length; i++) {
        if (this[i] !== b[i]) {
            return false;
        }
    }

    return true;
};
