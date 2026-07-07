export const SLOW_LOAD_HINT_MS = 8_000;
export const MIN_FEED_REFRESH_MS = 60_000;
export const EDGE_FN_TIMEOUT_DEFAULT_MS = 45_000;
// Poster/ad image generation (OpenAI gpt-image-1) regularly runs past two minutes
// end-to-end; a 120s client abort was firing before the edge function returned,
// surfacing as "We couldn't reach the server." Give the image path real headroom.
export const EDGE_FN_TIMEOUT_AI_MS = 180_000;
export const EDGE_FN_TIMEOUT_FAST_MS = 25_000;
