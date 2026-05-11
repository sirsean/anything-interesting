import { describe, expect, it } from 'vitest';
import { inferTopicFromTitle, topicalWeight } from '../src/topic';

describe('topic', () => {
  it('topicalWeight returns ~1.0 relative multipliers and defaults', () => {
    expect(topicalWeight('geopolitics')).toBe(1.04);
    expect(topicalWeight('POLITICS')).toBe(1.02);
    expect(topicalWeight('  economics ')).toBe(1.02);
    expect(topicalWeight('technology')).toBe(1.02);
    expect(topicalWeight('general')).toBe(0.98);
    expect(topicalWeight('unknown')).toBe(0.98);
  });

  it('inferTopicFromTitle classifies headline hints', () => {
    expect(inferTopicFromTitle('NATO discusses Ukraine border')).toBe('geopolitics');
    expect(inferTopicFromTitle('Senate vote on new bill')).toBe('politics');
    expect(inferTopicFromTitle('Fed signals on inflation')).toBe('economics');
    expect(inferTopicFromTitle('Apple unveils new AI chip')).toBe('technology');
    expect(inferTopicFromTitle('Local weather today')).toBe('general');
  });
});
