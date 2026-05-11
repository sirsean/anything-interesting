import { afterEach, describe, expect, it, vi } from 'vitest';
import { postDigestWebhook, type DiscordEmbed } from '../src/discord';

describe('discord', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('postDigestWebhook appends wait=true and parses message id from JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string, init: RequestInit) => {
        expect(url).toContain('wait=true');
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string) as { content: string; embeds: unknown[] };
        expect(body.content).toBe('hello');
        expect(body.embeds).toHaveLength(1);
        return Promise.resolve(new Response(JSON.stringify({ id: 'msg-123' }), { status: 200 }));
      }),
    );

    const embed: DiscordEmbed = {
      title: 't',
      url: 'https://x',
      description: 'd',
      color: 1,
      fields: [],
      footer: { text: 'f' },
    };

    const out = await postDigestWebhook('https://hooks.discord.com/api/webhooks/abc/def', 'hello', [embed]);
    expect(out.ok).toBe(true);
    expect(out.messageId).toBe('msg-123');
    expect(out.status).toBe(200);
  });

  it('postDigestWebhook uses ampersand when webhook URL already has query params', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
    );
    await postDigestWebhook('https://hooks.discord.com/x?thread_id=9', '', []);
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('&wait=true');
  });
});
