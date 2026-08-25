/** Sentiments accepted for `[Feedback]` lines — anything else is rejected, never stored. */
export const FEEDBACK_SENTIMENTS = ['positive', 'negative', 'neutral'];
function escapeValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
/**
 * Format the end-of-turn feedback contract as one trailing line:
 * `[Feedback] sentiment=positive; category="…"; quote="…"; note="…"`.
 *
 * Absent optional fields are omitted; unknown sentiments throw so callers can
 * fail atomically instead of persisting an invalid marker.
 */
export function buildFeedbackLine(feedback) {
    if (!feedback || feedback.sentiment === undefined || feedback.sentiment === null) {
        throw new Error('feedback sentiment is required');
    }
    if (!FEEDBACK_SENTIMENTS.includes(feedback.sentiment)) {
        throw new Error(`unknown feedback sentiment '${String(feedback.sentiment)}'`);
    }
    const parts = [`sentiment=${feedback.sentiment}`];
    if (feedback.category !== undefined)
        parts.push(`category="${escapeValue(feedback.category)}"`);
    if (feedback.quote !== undefined)
        parts.push(`quote="${escapeValue(feedback.quote)}"`);
    if (feedback.note !== undefined)
        parts.push(`note="${escapeValue(feedback.note)}"`);
    return `[Feedback] ${parts.join('; ')}`;
}
//# sourceMappingURL=feedback.js.map