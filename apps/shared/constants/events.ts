export const RECURRENCE_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const POLL_RESULTS_VISIBILITIES = ["always", "after_vote", "after_close"] as const;
export type PollResultsVisibility = (typeof POLL_RESULTS_VISIBILITIES)[number];
