import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDiscordInteraction, parseTopNewsOptions } from '../src/interactions';
import type { Env } from '../src/env';

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function minimalEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    CONFIG: {} as KVNamespace,
    HEADLINES: {} as Vectorize,
    MARKETS: {} as Vectorize,
    AI: {} as Ai,
    ...overrides,
  };
}

describe('parseTopNewsOptions', () => {
  it('defaults count to 3 and topic to null', () => {
    expect(parseTopNewsOptions(undefined)).toEqual({ count: 3, topic: null });
  });

  it('clamps count to [1,5] and filters topic to allowed set', () => {
    expect(
      parseTopNewsOptions({
        options: [
          { name: 'count', type: 4, value: 99 },
          { name: 'topic', type: 3, value: 'Geopolitics' },
        ],
      }),
    ).toEqual({ count: 5, topic: 'geopolitics' });
  });

  it('ignores disallowed topic strings', () => {
    expect(
      parseTopNewsOptions({
        options: [{ name: 'topic', type: 3, value: 'sports' }],
      }),
    ).toEqual({ count: 3, topic: null });
  });
});

describe('handleDiscordInteraction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 405 for non-POST', async () => {
    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', { method: 'GET' }),
      minimalEnv({ DISCORD_PUBLIC_KEY: '00' }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(405);
  });

  it('returns 500 when public key is not configured', async () => {
    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', { method: 'POST', body: '{}' }),
      minimalEnv(),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(500);
  });

  it('returns 401 when signature headers are missing', async () => {
    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', { method: 'POST', body: '{}' }),
      minimalEnv({ DISCORD_PUBLIC_KEY: 'abcd' }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when signature is invalid', async () => {
    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', {
        method: 'POST',
        body: '{}',
        headers: {
          'X-Signature-Ed25519': '00'.repeat(32),
          'X-Signature-Timestamp': '1',
        },
      }),
      minimalEnv({ DISCORD_PUBLIC_KEY: 'ab'.repeat(32) }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(401);
  });

  it('accepts PING (type 1) with a valid ed25519 signature', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const rawPub = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
    const pubHex = hex(rawPub);

    const body = JSON.stringify({ type: 1 });
    const ts = '1700000000';
    const message = new TextEncoder().encode(ts + body);
    const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);
    const sigHex = hex(sigBuf);

    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', {
        method: 'POST',
        body,
        headers: {
          'X-Signature-Ed25519': sigHex,
          'X-Signature-Timestamp': ts,
        },
      }),
      minimalEnv({ DISCORD_PUBLIC_KEY: pubHex }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('returns 400 for invalid JSON after a valid signature', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const rawPub = (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer;
    const pubHex = hex(rawPub);
    const body = '{not json';
    const ts = '1700000001';
    const message = new TextEncoder().encode(ts + body);
    const sigBuf = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message);

    const res = await handleDiscordInteraction(
      new Request('http://localhost/interactions', {
        method: 'POST',
        body,
        headers: {
          'X-Signature-Ed25519': hex(sigBuf),
          'X-Signature-Timestamp': ts,
        },
      }),
      minimalEnv({ DISCORD_PUBLIC_KEY: pubHex }),
      { waitUntil: vi.fn() } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(400);
  });
});
