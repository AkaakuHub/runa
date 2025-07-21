import type { ChatInputCommandInteraction } from 'discord.js';
import { addRssFeed } from '../../services/RssService';

export const add = {
  execute: async (interaction: ChatInputCommandInteraction) => {
    const url = interaction.options.getString('url', true); // trueで必須として扱う

    try {
      await addRssFeed(url);
      await interaction.reply(`✅ RSSフィードを追加しました: ${url}`);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: '❌ RSSフィードの追加に失敗しました。URLを確認してください。',
        ephemeral: true,
      });
    }
  },
};
