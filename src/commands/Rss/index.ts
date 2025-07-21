import type { ChatInputCommandInteraction } from "discord.js";
import type { CommandDefinition } from "../../types";

// RSS設定の状態を表示する関数
async function showRssStatus(
    interaction: ChatInputCommandInteraction
): Promise<void> {
    try {
        const { getRssSettings } = await import("../../services/RssService");
        const settings = await getRssSettings();

        let statusMessage = "📋 **RSS設定状況**\n\n";

        // チャンネル設定の表示
        if (settings.channelId) {
            const guild = interaction.guild;
            const channel = guild?.channels.cache.get(settings.channelId);
            const channelName = channel?.name || `ID: ${settings.channelId}`;
            statusMessage += `📺 **投稿チャンネル:** ${channelName}\n\n`;
        } else {
            statusMessage += "� **投稿チャンネル:** 未設定\n\n";
        }

        // フィード一覧の表示
        if (settings.feeds.length > 0) {
            statusMessage += `📰 **登録済みフィード (${settings.feeds.length}件):**\n`;
            settings.feeds.forEach((feed, index) => {
                const lastChecked = feed.lastChecked
                    ? new Date(feed.lastChecked).toLocaleString("ja-JP")
                    : "未チェック";
                statusMessage += `${index + 1}. ${
                    feed.url
                }\n   最終チェック: ${lastChecked}\n`;
            });
        } else {
            statusMessage += "📰 **登録済みフィード:** なし\n";
        }

        await interaction.reply({
            content: statusMessage,
            ephemeral: true,
        });
    } catch (error) {
        console.error("RSS status error:", error);
        await interaction.reply({
            content: "❌ 設定の確認中にエラーが発生しました。",
            ephemeral: true,
        });
    }
}

export const RssCommand: CommandDefinition = {
    name: "rss",
    description: "RSS feed commands",
    options: [
        {
            name: "add",
            description: "RSSフィードを追加",
            type: "STRING",
            required: false,
        },
        {
            name: "set-channel",
            description: "更新を送信するチャンネルID",
            type: "STRING",
            required: false,
        },
        {
            name: "status",
            description: "現在の設定を表示",
            type: "STRING",
            required: false,
        },
    ],
    execute: async (
        interaction: ChatInputCommandInteraction
    ): Promise<void> => {
        const addUrl = interaction.options.getString("add");
        const setChannelId = interaction.options.getString("set-channel");
        const showStatus = interaction.options.getString("status");

        // 複数のオプションが指定された場合のエラー
        const optionsCount = [addUrl, setChannelId, showStatus].filter(
            Boolean
        ).length;
        if (optionsCount > 1) {
            await interaction.reply({
                content: "❌ 一度に実行できるアクションは1つだけです。",
                ephemeral: true,
            });
            return;
        }

        if (optionsCount === 0) {
            await interaction.reply({
                content: `📋 **RSS機能の使い方**

**RSSフィードを追加:**
\`/rss add:フィードのURL\`
例: \`/rss add:https://example.com/feed.xml\`

**投稿チャンネルを設定:**
\`/rss set-channel:チャンネルID\`
例: \`/rss set-channel:123456789012345678\`

**設定状況を確認:**
\`/rss status:1\``,
                ephemeral: true,
            });
            return;
        }

        if (addUrl) {
            // URLの簡易バリデーション
            try {
                new URL(addUrl);
            } catch {
                await interaction.reply({
                    content: "❌ 有効なURLを指定してください。",
                    ephemeral: true,
                });
                return;
            }

            // 直接RSSサービスを呼び出し
            try {
                const { addRssFeed } = await import(
                    "../../services/RssService"
                );
                await addRssFeed(addUrl);
                await interaction.reply(
                    `✅ RSSフィードを追加しました: ${addUrl}`
                );
            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content:
                        "❌ RSSフィードの追加に失敗しました。URLを確認してください。",
                    ephemeral: true,
                });
            }
        } else if (setChannelId) {
            // チャンネルIDの簡易バリデーション（数字のみ、17-19桁）
            if (!/^\d{17,19}$/.test(setChannelId)) {
                await interaction.reply({
                    content:
                        "❌ 有効なチャンネルIDを指定してください（17-19桁の数字）。",
                    ephemeral: true,
                });
                return;
            }

            // 直接RSSサービスを呼び出し
            try {
                const { setRssChannel } = await import(
                    "../../services/RssService"
                );
                await setRssChannel(setChannelId);

                // チャンネル名を取得して表示
                const guild = interaction.guild;
                const channel = guild?.channels.cache.get(setChannelId);
                const channelName = channel?.name || `ID: ${setChannelId}`;

                await interaction.reply(
                    `✅ RSSフィードの投稿チャンネルを設定しました: ${channelName}`
                );
            } catch (error) {
                console.error(error);
                await interaction.reply({
                    content: "❌ チャンネルの設定に失敗しました。",
                    ephemeral: true,
                });
            }
        } else if (showStatus) {
            await showRssStatus(interaction);
        }
    },
};
