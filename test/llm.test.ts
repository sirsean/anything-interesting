import { describe, expect, it } from 'vitest';
import { isGlmModel, isKimiModel, textFromChatContentOnly, textFromChatOut } from '../src/llm';

describe('llm', () => {
  describe('isKimiModel', () => {
    it('recognizes Workers AI Kimi slugs', () => {
      expect(isKimiModel('@cf/moonshotai/kimi-k2.6')).toBe(true);
      expect(isKimiModel('@cf/moonshotai/kimi-k2.5')).toBe(true);
    });

    it('rejects non-Kimi models', () => {
      expect(isKimiModel('@cf/zai-org/glm-4.7-flash')).toBe(false);
    });
  });

  describe('isGlmModel', () => {
    it('recognizes GLM slugs', () => {
      expect(isGlmModel('@cf/zai-org/glm-4.7-flash')).toBe(true);
    });

    it('rejects non-GLM models', () => {
      expect(isGlmModel('@cf/moonshotai/kimi-k2.6')).toBe(false);
    });
  });

  describe('textFromChatOut', () => {
    it('reads first choice message content', () => {
      expect(
        textFromChatOut({
          choices: [{ message: { content: '  hello  ' } }],
        }),
      ).toBe('  hello  ');
    });

    it('falls back to reasoning when content is empty (Kimi K2.6 thinking mode)', () => {
      expect(
        textFromChatOut({
          choices: [
            {
              message: {
                content: '',
                reasoning: '{"score":0.82,"reason":"Major ruling"}',
              },
            },
          ],
        }),
      ).toBe('{"score":0.82,"reason":"Major ruling"}');
    });

    it('falls back to reasoning_content for Kimi K2.5-shaped responses', () => {
      expect(
        textFromChatOut({
          choices: [
            {
              message: {
                content: null,
                reasoning_content: '{"keep":true}',
              },
            },
          ],
        }),
      ).toBe('{"keep":true}');
    });

    it('prefers content over reasoning when both are present', () => {
      expect(
        textFromChatOut({
          choices: [
            {
              message: {
                content: '{"score":0.9}',
                reasoning: '{"score":0.1}',
              },
            },
          ],
        }),
      ).toBe('{"score":0.9}');
    });

    it('returns empty string on unexpected shapes', () => {
      expect(textFromChatOut(null)).toBe('');
      expect(textFromChatOut({})).toBe('');
      expect(textFromChatOut({ choices: [] })).toBe('');
      expect(textFromChatOut({ choices: [{ message: {} }] })).toBe('');
    });
  });

  describe('textFromChatContentOnly', () => {
    it('returns content and ignores reasoning fields', () => {
      expect(
        textFromChatContentOnly({
          choices: [
            {
              message: {
                content: '  Wire summary here.  ',
                reasoning: 'Analyze the Request: ...',
              },
            },
          ],
        }),
      ).toBe('Wire summary here.');
    });

    it('returns empty when content is null even if reasoning is present', () => {
      expect(
        textFromChatContentOnly({
          choices: [{ message: { content: null, reasoning: 'chain of thought' } }],
        }),
      ).toBe('');
    });
  });
});
