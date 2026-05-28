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
