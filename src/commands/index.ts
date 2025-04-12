import type { CommandDefinition } from "../types";
import { registerCommands } from "../utils/useCommands";
import { DebianCommand } from "./Debian";
import { ByeCommand } from "./Music/bye";
import { JoinCommand } from "./Music/join";
import { ListCommand } from "./Music/list";
import { SkipCommand } from "./Music/skip";
import { VolumeCommand } from "./Music/volume";
import { PingCommand } from "./Ping";

// すべての公開するコマンドの一覧
const commandsList: CommandDefinition[] = [
	PingCommand,
	DebianCommand,
	JoinCommand,
	ByeCommand,
	SkipCommand,
	VolumeCommand,
	ListCommand,
];

// コマンドを登録
registerCommands(commandsList);
