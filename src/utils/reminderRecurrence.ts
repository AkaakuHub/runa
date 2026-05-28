export type ReminderRepeatFrequency = "daily" | "weekly";

export interface ReminderRepeatRule {
	frequency: ReminderRepeatFrequency;
}

export function parseReminderRepeatInput(
	input: string | null | undefined,
): ReminderRepeatRule | undefined {
	if (!input) return undefined;

	switch (input) {
		case "daily":
			return { frequency: "daily" };
		case "weekly":
			return { frequency: "weekly" };
		case "none":
			return undefined;
		default:
			throw new Error(
				"繰り返しは `none`、`daily`、`weekly` から指定してください。",
			);
	}
}

export function formatReminderRepeatRule(
	repeat: ReminderRepeatRule | undefined,
): string {
	if (!repeat) return "単発";

	switch (repeat.frequency) {
		case "daily":
			return "毎日";
		case "weekly":
			return "毎週";
	}
}

export function getNextRepeatedReminderAt(
	currentRemindAt: Date,
	repeat: ReminderRepeatRule,
	now: Date,
): Date {
	const nextRemindAt = new Date(currentRemindAt.getTime());
	const addDays = repeat.frequency === "daily" ? 1 : 7;

	do {
		nextRemindAt.setUTCDate(nextRemindAt.getUTCDate() + addDays);
	} while (nextRemindAt.getTime() <= now.getTime());

	return nextRemindAt;
}
