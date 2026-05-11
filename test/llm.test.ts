import { describe, expect, it } from 'vitest';
import { textFromChatOut } from '../src/llm';

describe('llm', () => {
  it('textFromChatOut reads first choice message content', () => {
    expect(
      textFromChatOut({
        choices: [{ message: { content: '  hello  ' } }],
      }),
    ).toBe('  hello  ');
  });

  it('textFromChatOut returns empty string on unexpected shapes', () => {
    expect(textFromChatOut(null)).toBe('');
    expect(textFromChatOut({})).toBe('');
    expect(textFromChatOut({ choices: [] })).toBe('');
    expect(textFromChatOut({ choices: [{ message: {} }] })).toBe('');
  });
});
