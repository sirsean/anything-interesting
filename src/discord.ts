export type DiscordEmbed = {
  title: string;
  url: string;
  description: string;
  color: number;
  fields: { name: string; value: string; inline?: boolean }[];
  footer: { text: string };
};

export async function postDigestWebhook(
  webhookUrl: string,
  content: string,
  embeds: DiscordEmbed[],
): Promise<{ ok: boolean; messageId?: string; status: number; body: string }> {
  const join = webhookUrl.includes('?') ? '&' : '?';
  const res = await fetch(`${webhookUrl}${join}wait=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      embeds: embeds.slice(0, 10),
    }),
  });
  const body = await res.text();
  let messageId: string | undefined;
  try {
    const j = JSON.parse(body) as { id?: string };
    if (j?.id) messageId = j.id;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, messageId, status: res.status, body: body.slice(0, 500) };
}
