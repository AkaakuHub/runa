
import fs from 'node:fs/promises';
import path from 'node:path';
import { logError, logInfo } from '../utils/logger';

const dataDir = path.join(process.cwd(), 'data');
const rssSettingsFile = path.join(dataDir, 'rssSettings.json');

export interface RssSettings {
  feeds: { url: string; lastChecked: string | null }[];
  channelId: string | null;
}

// Ensure data directory and settings file exist
const initialize = async (): Promise<void> => {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.access(rssSettingsFile);
  } catch {
    await fs.writeFile(rssSettingsFile, JSON.stringify({ feeds: [], channelId: null }, null, 2));
    logInfo('Created rssSettings.json');
  }
};

export const getRssSettings = async (): Promise<RssSettings> => {
  await initialize();
  try {
    const data = await fs.readFile(rssSettingsFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    logError(`Error reading rssSettings.json: ${error}`);
    return { feeds: [], channelId: null };
  }
};

export const saveRssSettings = async (settings: RssSettings): Promise<void> => {
  await initialize();
  try {
    await fs.writeFile(rssSettingsFile, JSON.stringify(settings, null, 2));
  } catch (error) {
    logError(`Error writing to rssSettings.json: ${error}`);
  }
};

export const addRssFeed = async (url: string): Promise<void> => {
  const settings = await getRssSettings();
  if (!settings.feeds.some(feed => feed.url === url)) {
    settings.feeds.push({ url, lastChecked: null });
    await saveRssSettings(settings);
    logInfo(`Added RSS feed: ${url}`);
  }
};

export const setRssChannel = async (channelId: string): Promise<void> => {
  const settings = await getRssSettings();
  settings.channelId = channelId;
  await saveRssSettings(settings);
  logInfo(`Set RSS channel to: ${channelId}`);
};
