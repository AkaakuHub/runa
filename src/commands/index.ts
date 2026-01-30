import type { CommandDefinition } from "../types";
import { registerCommands } from "../utils/useCommands";
import { DebianCommand } from "./Debian";
import { ByeCommand } from "./Music/bye";
import { JoinCommand } from "./Music/join";
import { ListCommand } from "./Music/list";
import { RegisterCommand } from "./Music/register";
import { SkipCommand } from "./Music/skip";
import { VolumeCommand } from "./Music/volume";
import { PingCommand } from "./Ping";
import { DailySummaryCommand } from "./DailySummary";
import { DailyConfigCommand } from "./DailyConfig";
import { HistorySearchCommand } from "./HistorySearch";
import CcSorryCommand from "./CcSorry";
import { TTSCommand } from "./TTS";
import { TTSVolumeCommand } from "./TTS/volume";
import { TTSSpeedCommand } from "./TTS/speed";
import { TTSPitchCommand } from "./TTS/pitch";
import { TTSSpeakerCommand } from "./TTS/speaker";
import { TTSSpeakersCommand } from "./TTS/speakers";
import { ChatCommand } from "./Chat";
import { SudachiCommand } from "./Sudachi";
import { FxCommand } from "./Fx";

// すべての公開するコマンドの一覧
const commandsList: CommandDefinition[] = [
	PingCommand,
	DebianCommand,
	DailySummaryCommand,
	DailyConfigCommand,
	HistorySearchCommand,
	CcSorryCommand,
	JoinCommand,
	ByeCommand,
	SkipCommand,
	VolumeCommand,
	ListCommand,
	RegisterCommand,
	TTSCommand,
	TTSVolumeCommand,
	TTSSpeedCommand,
	TTSPitchCommand,
	TTSSpeakerCommand,
	TTSSpeakersCommand,
	ChatCommand,
	SudachiCommand,
	FxCommand,
];

// コマンドを登録
registerCommands(commandsList);
