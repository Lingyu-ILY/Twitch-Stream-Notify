const { EmbedBuilder } = require('discord.js');
const moment = require('moment');
const humanizeDuration = require("humanize-duration");
const config = require('./config.json');

class LiveEmbed {
  static createForStream(streamData) {
    const isLive = streamData.type === "live";
    const allowBoxArt = config.twitch_use_boxart;
    let msgEmbed = new EmbedBuilder();
    
    msgEmbed.setColor(isLive ? "#9146ff" : "#808080");
    //msgEmbed.setURL(`https://twitch.tv/${(streamData.login || streamData.user_name).toLowerCase()}`);
    
    // Thumbnail
    let thumbUrl = streamData.profile_image_url;
    if (allowBoxArt && streamData.game && streamData.game.box_art_url) {
      thumbUrl = streamData.game.box_art_url;
      thumbUrl = thumbUrl.replace("{width}", "288");
      thumbUrl = thumbUrl.replace("{height}", "384");
    }
    msgEmbed.setThumbnail(thumbUrl);
    
    if (isLive) {
      // Title
      //msgEmbed.setTitle(`:red_circle: **${streamData.user_name} 正在 Twitch 上直播!**`);
      msgEmbed.setDescription(streamData.title);
      //msgEmbed.addFields({ name: "標題", value: streamData.title, inline: false });
      msgEmbed.setAuthor({ name: `${streamData.user_name}正在 Twitch 上直播!`, iconURL: `${streamData.profile_image_url}`, url: `https://twitch.tv/${(streamData.login || streamData.user_name).toLowerCase()}`});
    } else {
      //msgEmbed.setTitle(`:white_circle: ${streamData.user_name} 曾在 Twitch 上直播.`);
      msgEmbed.setDescription(streamData.title);
      //msgEmbed.addFields({ name: "標題", value: streamData.title, inline: true });
      msgEmbed.setAuthor({ name: `${streamData.user_name}曾在 Twitch 上直播.`, iconURL: `${streamData.profile_image_url}`, url: `https://twitch.tv/${(streamData.login || streamData.user_name).toLowerCase()}`});
    }
    
    // Add game
    if (streamData.game) {
      msgEmbed.addFields({ name: "正在遊玩", value: streamData.game.name, inline: false });
    }
    
    if (isLive) {
      // Set main image (stream preview, offline well be change to channel background)
      let imageUrl = streamData.thumbnail_url;
      imageUrl = imageUrl.replace("{width}", "1280");
      imageUrl = imageUrl.replace("{height}", "720");
      let thumbnailBuster = (Date.now() / 1000).toFixed(0);
      imageUrl += `?t=${thumbnailBuster}`;
      msgEmbed.setImage(imageUrl);
    } else {
      let imageUrl = streamData.offline_image_url;
      imageUrl = imageUrl.replace("{width}", "1280");
      imageUrl = imageUrl.replace("{height}", "720");
      let thumbnailBuster = (Date.now() / 1000).toFixed(0);
      imageUrl += `?t=${thumbnailBuster}`;
      msgEmbed.setImage(imageUrl);
    }
    
    if (true) { //remove isLive make stats always show
      //msgEmbed.addFields({ name: "更新", value: isLive ? `:red_circle: 正在追蹤` : ':white_circle: 停止追蹤', inline: false });
      // Add status
      msgEmbed.addFields({ name: "狀態", value: isLive ? `直播有 ${streamData.viewer_count} 名觀眾` : '直播已結束', inline: true });
      
      // Set main image (stream preview) Move to alone
      
      // Add uptime
      let now = moment();
      let startedAt = moment(streamData.started_at);
      msgEmbed.addFields({
        name: "已直播時間",
        value: humanizeDuration(now - startedAt, {
          language: "czh",
          delimiter: ", ",
          largest: 2,
          round: true,
          units: ["y", "mo", "w", "d", "h", "m"],
          languages: {
            czh: {
              y: () => "年",
              mo: () => "月",
              w: () => "周",
              d: () => "天",
              h: () => "小時",
              m: () => "分鐘",
            },
          }
        }),
        inline: true
      });
    }
    
    return msgEmbed;
  }
}

module.exports = LiveEmbed;