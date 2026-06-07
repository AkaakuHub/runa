export type ReminderRepeatFrequency = "daily" | "weekly" | "interval";

export type ReminderRepeatRule =
	| { frequency: "daily"; until?: string }
	| { frequency: "weekly"; until?: string }
	| { frequency: "interval"; intervalMinutes: number; until: string };

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
): Date | undefined {
	if (repeat.frequency === "interval") {
		const until = new Date(repeat.until);
		if (Number.isNaN(until.getTime())) return undefined;
		if (
			!Number.isInteger(repeat.intervalMinutes) ||
			repeat.intervalMinutes <= 0
		) {
			return undefined;
		}

		const nextRemindAt = new Date(
			currentRemindAt.getTime() + repeat.intervalMinutes * 60 * 1000,
		);
		while (nextRemindAt.getTime() <= now.getTime()) {
			nextRemindAt.setUTCMinutes(
				nextRemindAt.getUTCMinutes() + repeat.intervalMinutes,
			);
		}

		return nextRemindAt.getTime() <= until.getTime() ? nextRemindAt : undefined;
	}

	const nextRemindAt = new Date(currentRemindAt.getTime());
	const addDays = repeat.frequency === "daily" ? 1 : 7;

	do {
		nextRemindAt.setUTCDate(nextRemindAt.getUTCDate() + addDays);
	} while (nextRemindAt.getTime() <= now.getTime());

	if (repeat.until) {
		const until = new Date(repeat.until);
		if (Number.isNaN(until.getTime())) return undefined;
		if (nextRemindAt.getTime() > until.getTime()) return undefined;
	}

	return nextRemindAt;
}
