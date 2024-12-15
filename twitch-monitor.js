const config = require('./config.json');
const TwitchApi = require('./twitch-api');
const MiniDb = require('./minidb');
const moment = require('moment');

class TwitchMonitor {
    static __init() {
        this._userDb = new MiniDb("twitch-users-v2");
        this._gameDb = new MiniDb("twitch-games");

        this._lastUserRefresh = this._userDb.get("last-update") || null;
        this._pendingUserRefresh = false;
        this._userData = this._userDb.get("user-list") || { };

        this._pendingGameRefresh = false;
        this._gameData = this._gameDb.get("game-list") || { };
        this._watchingGameIds = [];

        this.channelNames = [];
        this.activeStreams = [];
        this.streamData = {};

        this.channelLiveCallbacks = [];
        this.channelOfflineCallbacks = [];
        this.MIN_POLL_INTERVAL_MS = 30000;
    }

    static start() {
        // Check if configuration is set up correctly
        if (config.twitch_channels === "blank" || !config.twitch_channels.trim()) {
            console.warn('[Discord]', 'Configuration problem /!\\ Twitch channels not set up yet');
            return;
        }

        const announceChannel = typeof config.discord_announce_channel === 'string' ? config.discord_announce_channel : '';
        if (announceChannel === "blank") {
            console.warn('[Discord]', 'Configuration problem /!\\ Announce channel not set up yet');
        }

        if (Object.keys(config.discord_mentions).length === 1 && config.discord_mentions.blank === "blank") {
            console.warn('[Discord]', 'Configuration problem /!\\ Discord mentions not set up yet');
        }

        if (typeof config.default_mention !== 'string' || config.default_mention === "blank" || !config.default_mention.trim()) {
            console.warn('[Discord]', 'Configuration problem /!\\ Discord Default Mention not set up yet');
        }

        if (typeof config.discord_bot_token !== 'string' || config.discord_bot_token === "blank" || !config.discord_bot_token.trim()) {
            console.warn('[Discord]', 'Configuration problem /!\\ Discord bot token not set up yet');
        }

        if (typeof config.twitch_client_id !== 'string' || config.twitch_client_id === "blank" || !config.twitch_client_id.trim()) {
            console.warn('[Twitch]', 'Configuration problem /!\\ Twitch client ID not set up yet');
        }

        if (typeof config.twitch_oauth_token !== 'string' || config.twitch_oauth_token === "blank" || !config.twitch_oauth_token.trim()) {
            console.warn('[Twitch]', 'Configuration problem /!\\ Twitch OAuth token not set up yet');
        }

        // Load channel names from config
        this.channelNames = config.twitch_channels.split(',').map(channelName => channelName.trim().toLowerCase()).filter(Boolean);
        if (!this.channelNames.length) {
            console.warn('[Twitch監控]', '沒有已設定的頻道');
            return;
        }

        // Configure polling interval
        let checkIntervalMs = parseInt(config.twitch_check_interval_ms);
        if (isNaN(checkIntervalMs) || checkIntervalMs < this.MIN_POLL_INTERVAL_MS) {
            // Enforce minimum poll interval to help avoid rate limits
            checkIntervalMs = this.MIN_POLL_INTERVAL_MS;
        }
        
        this.pollingInterval = setInterval(() => {
            this.refresh("定期刷新");
        }, checkIntervalMs + 1000);

        // Immediate refresh after startup
        setTimeout(() => {
            this.refresh("啟動後初始刷新");
        }, 1000);

        // Ready!
        console.log('[Twitch監控]', `配置頻道的串流狀態輪詢:`, this.channelNames.join(', '),
          `(${checkIntervalMs}ms interval)`);
    }

    static stop() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('[Twitch監控]', 'Polling stopped.');
        }
    }

    static refresh(reason) {
        const now = moment();
        console.log('[Twitch]', ' ▪ ▪ ▪ ▪ ▪ ', `正在刷新 (${reason ? reason : "沒有原因"})`, ' ▪ ▪ ▪ ▪ ▪ ');

        // Refresh all users periodically
        if (this._lastUserRefresh === null || now.diff(moment(this._lastUserRefresh), '分鐘') >= 10) {
            this._pendingUserRefresh = true;
            TwitchApi.fetchUsers(this.channelNames)
              .then((users) => {
                  this.handleUserList(users);
              })
              .catch((err) => {
                  console.warn('[Twitch監控]', '使用者刷新錯誤:', err);
              })
              .then(() => {
                  if (this._pendingUserRefresh) {
                      this._pendingUserRefresh = false;
                      this.refresh('Got Twitch users, need to get streams');
                  }
              })
        }

        // Refresh all games if needed
        if (this._pendingGameRefresh) {
            TwitchApi.fetchGames(this._watchingGameIds)
              .then((games) => {
                  this.handleGameList(games);
              })
              .catch((err) => {
                  console.warn('[Twitch監控]', '遊戲刷新錯誤:', err);
              })
              .then(() => {
                  if (this._pendingGameRefresh) {
                      this._pendingGameRefresh = false;
                  }
              });
        }

        // Refresh all streams
        if (!this._pendingUserRefresh && !this._pendingGameRefresh) {
            TwitchApi.fetchStreams(this.channelNames)
              .then((channels) => {
                  this.handleStreamList(channels);
              })
              .catch((err) => {
                  console.warn('[Twitch監控]', '直播刷新錯誤:', err);
              });
        }
    }

    static handleUserList(users) {
        let namesSeen = [];

        users.forEach((user) => {
            let prevUserData = this._userData[user.id] || { };
            this._userData[user.id] = Object.assign({}, prevUserData, user);

            namesSeen.push(user.display_name);
        });

        if (namesSeen.length) {
            console.debug('[Twitch監控]', '更新了用戶資訊:', namesSeen.join(', '));
        }

        this._lastUserRefresh = moment();

        this._userDb.put("last-update", this._lastUserRefresh);
        this._userDb.put("user-list", this._userData);
    }

    static handleGameList(games) {
        let gotGameNames = [];

        games.forEach((game) => {
            const gameId = game.id;

            let prevGameData = this._gameData[gameId] || { };
            this._gameData[gameId] = Object.assign({}, prevGameData, game);

            gotGameNames.push(`${game.id} → ${game.name}`);
        });

        if (gotGameNames.length) {
            console.debug('[Twitch監控]', '更新了遊戲資訊:', gotGameNames.join(', '));
        }

        this._lastGameRefresh = moment();

        this._gameDb.put("last-update", this._lastGameRefresh);
        this._gameDb.put("game-list", this._gameData);
    }

    static handleStreamList(streams) {
        // Index channel data & build list of stream IDs now online
        let nextOnlineList = [];
        let nextGameIdList = [];

        streams.forEach((stream) => {
            const channelName = stream.user_name.toLowerCase();

            if (stream.type === "live") {
                nextOnlineList.push(channelName);
            }

            let userDataBase = this._userData[stream.user_id] || { };
            let prevStreamData = this.streamData[channelName] || { };

            this.streamData[channelName] = Object.assign({}, userDataBase, prevStreamData, stream);
            this.streamData[channelName].game = (stream.game_id && this._gameData[stream.game_id]) || null;
            this.streamData[channelName].user = userDataBase;

            if (stream.game_id) {
                nextGameIdList.push(stream.game_id);
            }
        });

        // Find channels that are now online, but were not before
        let notifyFailed = false;
        let anyChanges = false;

        for (let i = 0; i < nextOnlineList.length; i++) {
            let _chanName = nextOnlineList[i];

            if (this.activeStreams.indexOf(_chanName) === -1) {
                // Stream was not in the list before
                console.log('[Twitch監控]', '直播頻道已上線:', _chanName);
                anyChanges = true;
            }

            if (!this.handleChannelLiveUpdate(this.streamData[_chanName], true)) {
                notifyFailed = true;
            }
        }

        // Find channels that are now offline, but were online before
        for (let i = 0; i < this.activeStreams.length; i++) {
            let _chanName = this.activeStreams[i];

            if (nextOnlineList.indexOf(_chanName) === -1) {
                // Stream was in the list before, but no longer
                console.log('[Twitch監控]', '直播頻道已下線:', _chanName);
                this.streamData[_chanName].type = "detected_offline";
                this.handleChannelOffline(this.streamData[_chanName]);
                anyChanges = true;
            }
        }

        if (!notifyFailed) {
            // Notify OK, update list
            this.activeStreams = nextOnlineList;
        } else {
            console.log('[Twitch監控]', '無法傳送通知至頻道, 將在下次更新時重試.');
        }

        if (!this._watchingGameIds.hasEqualValues(nextGameIdList)) {
            // We need to refresh game info
            this._watchingGameIds = nextGameIdList;
            this._pendingGameRefresh = true;
            this.refresh("Need to request game data");
        }
    }

    static handleChannelLiveUpdate(streamData, isOnline) {
        for (let i = 0; i < this.channelLiveCallbacks.length; i++) {
            let _callback = this.channelLiveCallbacks[i];

            if (_callback) {
                if (_callback(streamData, isOnline) === false) {
                    return false;
                }
            }
        }

        return true;
    }

    static handleChannelOffline(streamData) {
        this.handleChannelLiveUpdate(streamData, false);

        for (let i = 0; i < this.channelOfflineCallbacks.length; i++) {
            let _callback = this.channelOfflineCallbacks[i];

            if (_callback) {
                if (_callback(streamData) === false) {
                    return false;
                }
            }
        }

        return true;
    }

    static onChannelLiveUpdate(callback) {
        this.channelLiveCallbacks.push(callback);
    }

    static onChannelOffline(callback) {
        this.channelOfflineCallbacks.push(callback);
    }
}

TwitchMonitor.__init();

module.exports = TwitchMonitor;
