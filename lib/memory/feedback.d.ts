/** Sentiments accepted for `[Feedback]` lines — anything else is rejected, never stored. */
export declare const FEEDBACK_SENTIMENTS: readonly ["positive", "negative", "neutral"];
export type FeedbackSentiment = typeof FEEDBACK_SENTIMENTS[number];
export interface FeedbackInput {
    sentiment: FeedbackSentiment;
    category?: string;
    quote?: string;
    note?: string;
}
/**
 * Format the end-of-turn feedback contract as one trailing line:
 * `[Feedback] sentiment=positive; category="…"; quote="…"; note="…"`.
 *
 * Absent optional fields are omitted; unknown sentiments throw so callers can
 * fail atomically instead of persisting an invalid marker.
 */
export declare function buildFeedbackLine(feedback: FeedbackInput): string;
//# sourceMappingURL=feedback.d.ts.map