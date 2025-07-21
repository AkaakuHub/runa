import cron from 'node-cron';
import Parser from 'rss-parser';
import { getRssSettings, saveRssSettings } from '../services/RssService';
import { logInfo, logError } from './logger';
import type { Client, TextChannel } from 'discord.js';

const parser = new Parser();

const checkFeeds = async (client: Client) => {
  logInfo('Checking RSS feeds...');
  const settings = await getRssSettings();

  if (!settings.channelId) {
    return;
  }

  const channel = await client.channels.fetch(settings.channelId) as TextChannel;
  if (!channel) {
    logError(`RSS channel not found: ${settings.channelId}`);
    return;
  }

  for (const feed of settings.feeds) {
    try {
      const parsedFeed = await parser.parseURL(feed.url);
      const lastChecked = feed.lastChecked ? new Date(feed.lastChecked) : new Date(0);

      for (const item of parsedFeed.items.reverse()) {
        const itemDate = item.isoDate ? new Date(item.isoDate) : new Date(0);
        if (itemDate > lastChecked) {
          const message = `${item.title}\n${item.link}`;
          await channel.send(message);
        }
      }

      feed.lastChecked = new Date().toISOString();
    } catch (error) {
      logError(`Error parsing RSS feed ${feed.url}: ${error}`);
    }
  }

  await saveRssSettings(settings);
};

export const startRssScheduler = (client: Client) => {
  // Check every 5 minutes
  cron.schedule('*/5 * * * *', () => checkFeeds(client));
  logInfo('RSS scheduler started.');
};