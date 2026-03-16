import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStreamState,
  recordStreamSuccess,
  recordStream429,
  handle429,
  registerStreamAgent,
  unregisterStreamAgent,
  getActiveStreamAgentCount,
  _resetAll,
  BASELINE_STREAM_INTERVAL_MS,
  BACKOFF_DECAY_EDITS,
  MAX_STREAM_INTERVAL_MS,
} from './stream-limiter.js';

beforeEach(() => {
  _resetAll();
});

describe('getStreamState', () => {
  it('returns baseline state for new chat', () => {
    const state = getStreamState('chat1');
    expect(state.interval).toBe(BASELINE_STREAM_INTERVAL_MS);
    expect(state.cleanEdits).toBe(0);
    expect(state.lastEditTime).toBe(0);
  });

  it('returns same state object on repeated calls', () => {
    const a = getStreamState('chat1');
    const b = getStreamState('chat1');
    expect(a).toBe(b);
  });

  it('returns different state for different chats', () => {
    const a = getStreamState('chat1');
    const b = getStreamState('chat2');
    expect(a).not.toBe(b);
  });
});

describe('recordStreamSuccess', () => {
  it('increments clean edit counter', () => {
    recordStreamSuccess('chat1');
    recordStreamSuccess('chat1');
    expect(getStreamState('chat1').cleanEdits).toBe(2);
  });

  it('does not change interval at baseline', () => {
    for (let i = 0; i < 10; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });

  it('halves interval after BACKOFF_DECAY_EDITS clean edits when above baseline', () => {
    // Put the chat into back-off first
    recordStream429('chat1'); // doubles from 2500 -> 5000
    expect(getStreamState('chat1').interval).toBe(5000);

    // 4 clean edits - no change
    for (let i = 0; i < BACKOFF_DECAY_EDITS - 1; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(5000);

    // 5th clean edit triggers decay
    recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(2500);
    expect(getStreamState('chat1').cleanEdits).toBe(0); // reset after decay
  });

  it('decays interval but never below baseline', () => {
    recordStream429('chat1'); // 2500 -> 5000
    // Decay once -> 2500 (baseline)
    for (let i = 0; i < BACKOFF_DECAY_EDITS; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);

    // More successes should not go below baseline
    for (let i = 0; i < BACKOFF_DECAY_EDITS * 3; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });
});

describe('recordStream429', () => {
  it('doubles interval when no retry_after provided', () => {
    recordStream429('chat1');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS * 2);
  });

  it('uses retry_after when provided', () => {
    recordStream429('chat1', 10);
    expect(getStreamState('chat1').interval).toBe(10_000);
  });

  it('caps interval at MAX_STREAM_INTERVAL_MS', () => {
    recordStream429('chat1', 60); // 60s > 30s max
    expect(getStreamState('chat1').interval).toBe(MAX_STREAM_INTERVAL_MS);
  });

  it('caps doubling at MAX_STREAM_INTERVAL_MS', () => {
    // Keep doubling until we hit the cap
    for (let i = 0; i < 10; i++) recordStream429('chat1');
    expect(getStreamState('chat1').interval).toBe(MAX_STREAM_INTERVAL_MS);
  });

  it('resets clean edit counter', () => {
    recordStreamSuccess('chat1');
    recordStreamSuccess('chat1');
    expect(getStreamState('chat1').cleanEdits).toBe(2);
    recordStream429('chat1');
    expect(getStreamState('chat1').cleanEdits).toBe(0);
  });
});

describe('handle429', () => {
  it('triggers back-off on Telegram 429 error', () => {
    handle429('chat1', { error_code: 429, parameters: { retry_after: 5 } });
    expect(getStreamState('chat1').interval).toBe(5000);
  });

  it('triggers back-off without retry_after', () => {
    handle429('chat1', { error_code: 429 });
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS * 2);
  });

  it('ignores non-429 errors', () => {
    handle429('chat1', { error_code: 400, description: 'MESSAGE_NOT_MODIFIED' });
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });

  it('ignores non-object errors', () => {
    handle429('chat1', 'some string error');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });

  it('ignores null/undefined', () => {
    handle429('chat1', null);
    handle429('chat1', undefined);
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });
});

describe('agent tracking', () => {
  it('starts at 0 agents', () => {
    expect(getActiveStreamAgentCount('chat1')).toBe(0);
  });

  it('increments on register', () => {
    registerStreamAgent('chat1');
    expect(getActiveStreamAgentCount('chat1')).toBe(1);
    registerStreamAgent('chat1');
    expect(getActiveStreamAgentCount('chat1')).toBe(2);
  });

  it('decrements on unregister', () => {
    registerStreamAgent('chat1');
    registerStreamAgent('chat1');
    unregisterStreamAgent('chat1');
    expect(getActiveStreamAgentCount('chat1')).toBe(1);
  });

  it('cleans up map entry when count reaches 0', () => {
    registerStreamAgent('chat1');
    unregisterStreamAgent('chat1');
    expect(getActiveStreamAgentCount('chat1')).toBe(0);
  });

  it('does not go negative', () => {
    unregisterStreamAgent('chat1');
    expect(getActiveStreamAgentCount('chat1')).toBe(0);
  });

  it('tracks chats independently', () => {
    registerStreamAgent('chat1');
    registerStreamAgent('chat2');
    registerStreamAgent('chat2');
    expect(getActiveStreamAgentCount('chat1')).toBe(1);
    expect(getActiveStreamAgentCount('chat2')).toBe(2);
  });
});

describe('adaptive back-off full cycle', () => {
  it('recovers from 429 through multiple decay cycles', () => {
    // Hit a 429 with retry_after=20s
    recordStream429('chat1', 20);
    expect(getStreamState('chat1').interval).toBe(20_000);

    // 5 clean edits -> 10000
    for (let i = 0; i < BACKOFF_DECAY_EDITS; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(10_000);

    // 5 more -> 5000
    for (let i = 0; i < BACKOFF_DECAY_EDITS; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(5000);

    // 5 more -> 2500 (baseline)
    for (let i = 0; i < BACKOFF_DECAY_EDITS; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').interval).toBe(BASELINE_STREAM_INTERVAL_MS);
  });

  it('re-entering back-off during recovery resets progress', () => {
    recordStream429('chat1'); // 5000
    // 3 clean edits (not enough for decay)
    for (let i = 0; i < 3; i++) recordStreamSuccess('chat1');
    expect(getStreamState('chat1').cleanEdits).toBe(3);

    // Another 429 resets clean edits and doubles
    recordStream429('chat1'); // 5000 -> 10000
    expect(getStreamState('chat1').interval).toBe(10_000);
    expect(getStreamState('chat1').cleanEdits).toBe(0);
  });
});
