import cron from "node-cron";
import Parser from "rss-parser";
import { getRssSettings, saveRssSettings } from "../services/RssService";
import { logInfo, logError } from "./logger";
import type { Client, TextChannel } from "discord.js";

interface RssItem {
    title?: string;
    link?: string;
    guid?: string;
    isoDate?: string;
    pubDate?: string;
    content?: string;
    contentSnippet?: string;
}

interface ParsedFeed {
    title?: string;
    items: RssItem[];
}

interface RssMessageData {
    messageId: string;
    content: string;
    lastUpdated: string;
}

interface ExtendedRssFeed {
    url: string;
    lastChecked?: string | null;
    postedItems?: string[];
    messages?: RssMessageData[];
}

interface ExtendedRssSettings {
    channelId?: string;
    feeds: ExtendedRssFeed[];
}

const parser = new Parser<ParsedFeed, RssItem>();

const checkFeeds = async (client: Client) => {
    logInfo("Checking RSS feeds...");
    const settings = (await getRssSettings()) as ExtendedRssSettings;

    if (!settings.channelId) {
        return;
    }

    const channel = (await client.channels.fetch(
        settings.channelId
    )) as TextChannel;
    if (!channel) {
        logError(`RSS channel not found: ${settings.channelId}`);
        return;
    }

    let hasNewItems = false;

    for (const feed of settings.feeds) {
        try {
            const parsedFeed = await parser.parseURL(feed.url);

            // 初期化
            if (!feed.postedItems) feed.postedItems = [];
            if (!feed.messages) feed.messages = [];

            const newItems: RssItem[] = [];

            // 新しいアイテムを収集
            for (const item of parsedFeed.items) {
                const itemId = item.guid || item.link || item.title;
                if (itemId && !feed.postedItems.includes(itemId)) {
                    newItems.push(item);
                    feed.postedItems.push(itemId);
                }
            }

            if (newItems.length > 0) {
                hasNewItems = true;
                await updateFeedMessages(
                    channel,
                    feed,
                    parsedFeed.title || "RSS Feed",
                    newItems
                );
            }

            feed.lastChecked = new Date().toISOString();
        } catch (error) {
            logError(`Error parsing RSS feed ${feed.url}: ${error}`);
        }
    }

    // 新着がある場合は通知メッセージを送信
    if (hasNewItems) {
        const notificationMessage = await channel.send(
            "🔔 **新着記事が追加されました！**"
        );

        // 10秒後に通知メッセージを削除
        setTimeout(async () => {
            try {
                await notificationMessage.delete();
            } catch (error) {
                logError(`Failed to delete notification message: ${error}`);
            }
        }, 10000);
    }

    // RssServiceの型に合わせて変換
    const baseSettings = {
        channelId: settings.channelId || null,
        feeds: settings.feeds.map((feed) => ({
            url: feed.url,
            lastChecked: feed.lastChecked || null,
        })),
    };

    await saveRssSettings(baseSettings);
};

const updateFeedMessages = async (
    channel: TextChannel,
    feed: ExtendedRssFeed,
    feedTitle: string,
    newItems: RssItem[]
) => {
    // 既存のアイテムを取得（最新順）
    const allItems = [...newItems.reverse()]; // 新しいものを上に

    // メッセージ内容を構築
    let currentContent = `📰 **${feedTitle}**\n\n`;
    const messages: string[] = [];

    for (const item of allItems) {
        const title = item.title || "タイトルなし";
        const link = item.link || "";
        const itemText = `🔸 **${title}**\n${link}\n\n`;

        // 2000文字制限チェック
        if ((currentContent + itemText).length > 1900) {
            // 余裕を持って1900文字
            messages.push(currentContent);
            currentContent = `📰 **${feedTitle}** (続き)\n\n${itemText}`;
        } else {
            currentContent += itemText;
        }
    }

    if (currentContent.trim()) {
        messages.push(currentContent);
    }

    // 初期化
    if (!feed.messages) feed.messages = [];

    // メッセージを更新または新規作成
    for (let i = 0; i < messages.length; i++) {
        const messageContent = messages[i];

        if (feed.messages[i]) {
            // 既存メッセージを更新
            try {
                const existingMessage = await channel.messages.fetch(
                    feed.messages[i].messageId
                );
                await existingMessage.edit(messageContent);
                feed.messages[i].content = messageContent;
                feed.messages[i].lastUpdated = new Date().toISOString();
            } catch {
                // メッセージが見つからない場合は新規作成
                const newMessage = await channel.send(messageContent);
                feed.messages[i] = {
                    messageId: newMessage.id,
                    content: messageContent,
                    lastUpdated: new Date().toISOString(),
                };
            }
        } else {
            // 新規メッセージを作成
            const newMessage = await channel.send(messageContent);
            feed.messages[i] = {
                messageId: newMessage.id,
                content: messageContent,
                lastUpdated: new Date().toISOString(),
            };
        }
    }

    // 不要になったメッセージを削除
    for (let i = messages.length; i < feed.messages.length; i++) {
        try {
            const messageToDelete = await channel.messages.fetch(
                feed.messages[i].messageId
            );
            await messageToDelete.delete();
        } catch (error) {
            logError(`Failed to delete excess message: ${error}`);
        }
    }

    // メッセージ配列を調整
    feed.messages = feed.messages.slice(0, messages.length);
};

export const startRssScheduler = (client: Client) => {
    // Check every 5 minutes
    cron.schedule("*/5 * * * *", () => checkFeeds(client));
    logInfo("RSS scheduler started with enhanced update system.");
};

// 手動でフィードをリセットする関数（デバッグ用）
export const resetFeedHistory = async (feedUrl: string) => {
    const settings = (await getRssSettings()) as ExtendedRssSettings;
    const feed = settings.feeds.find((f) => f.url === feedUrl);
    if (feed) {
        feed.postedItems = [];
        feed.messages = [];

        // RssServiceの型に合わせて変換
        const baseSettings = {
            channelId: settings.channelId || null,
            feeds: settings.feeds.map((feed) => ({
                url: feed.url,
                lastChecked: feed.lastChecked || null,
            })),
        };

        await saveRssSettings(baseSettings);
        logInfo(`Reset history for feed: ${feedUrl}`);
    }
};
