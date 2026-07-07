import type { CommandDefinition } from "../types";
import { registerCommands } from "../utils/useCommands";
import CcSorryCommand from "./CcSorry";
import { ChatCommand } from "./Chat";
import { ChatContextClearCommand } from "./ChatContextClear";
import { DailyConfigCommand } from "./DailyConfig";
import { DailySummaryCommand } from "./DailySummary";
import { DebianCommand } from "./Debian";
import { FxCommand } from "./Fx";
import { HistorySearchCommand } from "./HistorySearch";
import { IsSenryuCommand } from "./IsSenryu";
import { ByeCommand } from "./Music/bye";
import { JoinCommand } from "./Music/join";
import { ListCommand } from "./Music/list";
import { SkipCommand } from "./Music/skip";
import { VolumeCommand } from "./Music/volume";
import { PingCommand } from "./Ping";
import { ReminderCommand } from "./Reminder";
import { ReminderCancelCommand } from "./Reminder/cancel";
import { ReminderEditCommand } from "./Reminder/edit";
import { ReminderListCommand } from "./Reminder/list";
import { SudachiCommand } from "./Sudachi";
import { TTSCommand } from "./TTS";
import { TTSPitchCommand } from "./TTS/pitch";
import { TTSSkipCommand } from "./TTS/skip";
import { TTSSpeakerCommand } from "./TTS/speaker";
import { TTSSpeakersCommand } from "./TTS/speakers";
import { TTSSpeedCommand } from "./TTS/speed";
import { TTSVolumeCommand } from "./TTS/volume";

// すべての公開するコマンドの一覧
const commandsList: CommandDefinition[] = [
	PingCommand,
	ReminderCommand,
	ReminderListCommand,
	ReminderCancelCommand,
	ReminderEditCommand,
	DebianCommand,
	DailySummaryCommand,
	DailyConfigCommand,
	HistorySearchCommand,
	IsSenryuCommand,
	CcSorryCommand,
	JoinCommand,
	ByeCommand,
	SkipCommand,
	VolumeCommand,
	ListCommand,
	TTSCommand,
	TTSVolumeCommand,
	TTSSpeedCommand,
	TTSPitchCommand,
	TTSSpeakerCommand,
	TTSSpeakersCommand,
	TTSSkipCommand,
	ChatCommand,
	ChatContextClearCommand,
	SudachiCommand,
	FxCommand,
];

// コマンドを登録
registerCommands(commandsList);
