import { describe, expect, it } from 'vitest';
import { inferTopicFromTitle, topicalWeight } from '../src/topic';

describe('topic', () => {
  it('topicalWeight returns known multipliers and defaults', () => {
    expect(topicalWeight('geopolitics')).toBe(0.4);
    expect(topicalWeight('POLITICS')).toBe(0.2);
    expect(topicalWeight('  economics ')).toBe(0.2);
    expect(topicalWeight('technology')).toBe(0.2);
    expect(topicalWeight('general')).toBe(0.2);
    expect(topicalWeight('unknown')).toBe(0.2);
  });

  it('inferTopicFromTitle classifies headline hints', () => {
    expect(inferTopicFromTitle('NATO discusses Ukraine border')).toBe('geopolitics');
    expect(inferTopicFromTitle('Senate vote on new bill')).toBe('politics');
    expect(inferTopicFromTitle('Fed signals on inflation')).toBe('economics');
    expect(inferTopicFromTitle('Apple unveils new AI chip')).toBe('technology');
    expect(inferTopicFromTitle('Local weather today')).toBe('general');
  });
});
