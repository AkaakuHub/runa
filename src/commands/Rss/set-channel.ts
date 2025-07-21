import type { ChatInputCommandInteraction } from 'discord.js';
import { setRssChannel } from '../../services/RssService';

export const setChannel = {
  execute: async (interaction: ChatInputCommandInteraction) => {
    const channel = interaction.options.getChannel('channel', true); // trueで必須として扱う

    try {
      await setRssChannel(channel.id);
      await interaction.reply(`✅ RSSフィードの投稿チャンネルを設定しました: ${channel.name}`);
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: '❌ チャンネルの設定に失敗しました。',
        ephemeral: true,
      });
    }
  },
};
