import { STREAM_INTERVAL_MS } from './config.js';
import { logger } from './logger.js';

// ── Global streaming rate limiter with adaptive back-off ──────────────
// Starts with a fixed cooldown per chat. If Telegram returns 429 (rate limit),
// switches to back-off mode using the retry_after value, then decays back to
// baseline after consecutive successful edits.
export const BASELINE_STREAM_INTERVAL_MS = STREAM_INTERVAL_MS;
export const BACKOFF_DECAY_EDITS = 5; // Halve interval after this many clean edits
export const MAX_STREAM_INTERVAL_MS = 30_000; // Cap back-off at 30s

export interface ChatStreamState {
  lastEditTime: number;
  interval: number; // Current cooldown (starts at baseline, grows on 429)
  cleanEdits: number; // Consecutive edits without a 429
}

const chatStreamState = new Map<string, ChatStreamState>();

export function getStreamState(chatId: string): ChatStreamState {
  let state = chatStreamState.get(chatId);
  if (!state) {
    state = { lastEditTime: 0, interval: BASELINE_STREAM_INTERVAL_MS, cleanEdits: 0 };
    chatStreamState.set(chatId, state);
  }
  return state;
}

/** Called on a successful Telegram edit/send to decay back toward baseline. */
export function recordStreamSuccess(chatId: string): void {
  const state = getStreamState(chatId);
  state.cleanEdits++;
  if (state.interval > BASELINE_STREAM_INTERVAL_MS && state.cleanEdits >= BACKOFF_DECAY_EDITS) {
    state.interval = Math.max(BASELINE_STREAM_INTERVAL_MS, Math.floor(state.interval / 2));
    state.cleanEdits = 0;
    logger.debug({ chatId, newInterval: state.interval }, 'Stream back-off decayed');
  }
}

/** Called when Telegram returns a 429. Bumps interval using retry_after or doubles. */
export function recordStream429(chatId: string, retryAfterSec?: number): void {
  const state = getStreamState(chatId);
  state.cleanEdits = 0;
  if (retryAfterSec && retryAfterSec > 0) {
    state.interval = Math.min(MAX_STREAM_INTERVAL_MS, retryAfterSec * 1000);
  } else {
    state.interval = Math.min(MAX_STREAM_INTERVAL_MS, state.interval * 2);
  }
  logger.warn({ chatId, newInterval: state.interval, retryAfterSec }, 'Stream hit 429, backing off');
}

/** Extract retry_after from a Telegram API error if it's a 429. */
export function handle429(chatId: string, err: unknown): void {
  if (err && typeof err === 'object' && 'error_code' in err) {
    const tgErr = err as { error_code?: number; parameters?: { retry_after?: number } };
    if (tgErr.error_code === 429) {
      recordStream429(chatId, tgErr.parameters?.retry_after);
      return;
    }
  }
  // Non-429 errors (MESSAGE_NOT_MODIFIED, deleted message, etc.) are ignored.
  // They don't trigger back-off and don't reset the clean edit counter.
}

// Track active streaming agents per chat for 'single-agent-only' strategy.
const activeStreamAgents = new Map<string, number>(); // chatId -> count

export function registerStreamAgent(chatId: string): void {
  activeStreamAgents.set(chatId, (activeStreamAgents.get(chatId) ?? 0) + 1);
}

export function unregisterStreamAgent(chatId: string): void {
  const count = (activeStreamAgents.get(chatId) ?? 1) - 1;
  if (count <= 0) activeStreamAgents.delete(chatId);
  else activeStreamAgents.set(chatId, count);
}

export function getActiveStreamAgentCount(chatId: string): number {
  return activeStreamAgents.get(chatId) ?? 0;
}

/** Reset all state — for testing only. */
export function _resetAll(): void {
  chatStreamState.clear();
  activeStreamAgents.clear();
}
