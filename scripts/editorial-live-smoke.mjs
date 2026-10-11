// Real Luna + current RSS evidence in an isolated SQLite database. Never posts to Discord.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
const vars = parse(readFileSync('.dev.vars'));
if (!vars.OPENAI_API_KEY) throw new Error('Set OPENAI_API_KEY in gitignored .dev.vars');
const server = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true } });
try {
  const { sqliteD1 } = await server.ssrLoadModule('/test/sqlite.ts');
  const { fetchFeed } = await server.ssrLoadModule('/src/rss.ts');
  const { NEWS_FEEDS } = await server.ssrLoadModule('/src/sources.ts');
  const { storeIncomingArticle } = await server.ssrLoadModule('/src/ingest.ts');
  const { analyzeStory } = await server.ssrLoadModule('/src/editorial.ts');
  const data = sqliteD1(), env = { DB: data.db, OPENAI_API_KEY: vars.OPENAI_API_KEY, LLM_PROVIDER: 'openai', OPENAI_MODEL: 'gpt-6-luna' };
  const source = NEWS_FEEDS.find(f => f.id === (process.argv[2] ?? 'science-news'));
  if (!source) throw new Error('Unknown feed ID');
  const result = await fetchFeed(source);
  if (!result.items.length) throw new Error('Live feed unavailable');
  await storeIncomingArticle(env, source, result.items[0]);
  await analyzeStory(env, 1);
  const row = await env.DB.prepare('SELECT editorial_json, editorial_evidence_json FROM clusters WHERE id = 1').first();
  const usage = await env.DB.prepare('SELECT provider, model, status, input_tokens, output_tokens FROM llm_usage').all();
  console.log(JSON.stringify({ source: source.label, brief: JSON.parse(row.editorial_json), cited_sources: JSON.parse(row.editorial_evidence_json).map(e => ({ id: e.id, publisher: e.publisher, url: e.url })), usage: usage.results }, null, 2));
  data.sqlite.close();
} finally { await server.close(); }
