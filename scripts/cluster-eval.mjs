#!/usr/bin/env node
/**
 * Clustering eval harness — prepare embeddings once, simulate presets, Kimi-verify winners.
 *
 *   npm run cluster:eval
 *   npm run cluster:eval -- --hours 72 --limit 200 --presets prod,tuned_a,tuned_b,tuned_c
 */
import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { Agent, setGlobalDispatcher } from 'undici';

setGlobalDispatcher(new Agent({ headersTimeout: 600_000, bodyTimeout: 600_000 }));

const BASE = process.env.CLUSTER_EVAL_URL ?? 'https://anything-interesting.sirsean.workers.dev';
const TOKEN = process.env.OPS_TOKEN;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1] ?? fallback;
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'X-Ops-Token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}: ${text}`);
  return JSON.parse(text);
}

function scorePreset(p) {
  const s = p.stats;
  const kimi = p.kimi;
  let score = s.threePlusPct * 2 + s.multiSourcePct - s.singleSourcePct * 0.25;
  if (kimi) {
    score += kimi.coherence.sameStoryRate * 25;
    score += kimi.missedMerges.kimiSameStoryRate * 10;
    score -= (1 - kimi.grayZone.glmAgreementRate) * 5;
  }
  return score;
}

function buildRecommendation(presets) {
  if (presets.length === 0) return 'No preset results.';
  const ranked = [...presets].sort((a, b) => scorePreset(b) - scorePreset(a));
  const best = ranked[0];
  const prod = presets.find((p) => p.preset === 'prod');
  if (!prod) return `Best preset: ${best.preset}`;
  return (
    `Recommend "${best.preset}" over prod: +${(best.stats.multiSourcePct - prod.stats.multiSourcePct).toFixed(1)}pp multi-source, ` +
    `+${(best.stats.threePlusPct - prod.stats.threePlusPct).toFixed(1)}pp ≥3 sources. ` +
    `cosineLow=${best.config.cosineLow}, cosineSame=${best.config.cosineSame}, gray=${best.config.grayZonePolicy}.`
  );
}

function printPreset(p) {
  const s = p.stats;
  console.log(`--- ${p.preset} (low=${p.config.cosineLow}, same=${p.config.cosineSame}, gray=${p.config.grayZonePolicy}) ---`);
  console.log(
    `  clusters=${s.clusterCount}  multi-source=${s.multiSourcePct.toFixed(1)}%  ≥3 sources=${s.threePlusPct.toFixed(1)}%  single-source=${s.singleSourcePct.toFixed(1)}%`,
  );
  console.log(
    `  gray-zone=${s.grayZoneCount} (merged ${s.grayZoneMergeCount})  max cluster size=${s.maxArticlesPerCluster}`,
  );
  if (p.kimi) {
    console.log(
      `  Kimi: coherence ${(p.kimi.coherence.sameStoryRate * 100).toFixed(0)}% | missed-merge ${(p.kimi.missedMerges.kimiSameStoryRate * 100).toFixed(0)}% same-story (${p.kimi.kimiCalls} calls)`,
    );
    for (const sample of p.kimi.coherence.samples.filter((x) => !x.kimiSame).slice(0, 2)) {
      console.log(`    bad cluster #${sample.clusterId}: ${sample.kimiReason}`);
    }
  }
  if (p.topMultiSource?.length > 0) {
    console.log(
      `  Top multi-source: ${p.topMultiSource.map((c) => `${c.articleCount}@${c.sources.length}src`).join(', ')}`,
    );
  }
  console.log('');
}

async function main() {
  if (!TOKEN) {
    console.error('Missing OPS_TOKEN');
    process.exit(1);
  }

  const hours = Number(arg('--hours', '72'));
  const limit = Number(arg('--limit', '200'));
  const kimiBudget = Number(arg('--kimi-budget', '20'));
  const presets = arg('--presets', 'prod,tuned_a,tuned_b,tuned_c').split(',').map((s) => s.trim());
  const outPath = arg('--out', 'cluster-eval-report.json');
  const withGlm = process.argv.includes('--with-glm');
  const skipKimiFirst = !process.argv.includes('--kimi-all');

  console.log(`Prepare eval corpus (${hours}h, ${limit} articles)…`);
  const prepared = await post('/ops/cluster-eval/prepare', { hours, limit });
  console.log(`evalId=${prepared.evalId} embedded=${prepared.articleWindow.embedded}\n`);

  const allPresets = [];

  for (const preset of presets) {
    process.stdout.write(`Simulate ${preset} (fast${withGlm ? '+glm' : ''})… `);
    const r = await post('/ops/cluster-eval/run', {
      evalId: prepared.evalId,
      preset,
      skipGlm: !withGlm,
      skipKimi: true,
    });
    allPresets.push(r);
    console.log('done');
  }

  const ranked = [...allPresets].sort((a, b) => scorePreset(b) - scorePreset(a));
  const kimiTargets = skipKimiFirst
    ? ['prod', ranked[0]?.preset].filter(Boolean)
    : presets;

  for (const preset of [...new Set(kimiTargets)]) {
    process.stdout.write(`Kimi verify ${preset}… `);
    const r = await post('/ops/cluster-eval/run', {
      evalId: prepared.evalId,
      preset,
      skipGlm: !withGlm,
      skipKimi: false,
      kimiBudget,
    });
    const idx = allPresets.findIndex((p) => p.preset === preset);
    if (idx >= 0) allPresets[idx] = r;
    else allPresets.push(r);
    console.log('done');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    evalId: prepared.evalId,
    articleWindow: prepared.articleWindow,
    presets: allPresets,
    recommendation: buildRecommendation(allPresets),
  };

  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log('\n=== Cluster eval summary ===\n');
  for (const p of allPresets) printPreset(p);
  console.log('Recommendation:', report.recommendation);
  console.log(`Full report: ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
