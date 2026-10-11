import { describe, expect, it } from 'vitest';
import { selectStories, type StoryCandidate } from '../src/editions';
import { type Brief, type Evidence, parseBrief } from '../src/editorial';
import scenarios from './fixtures/editorial-scenarios.json';
const base: Brief = { headline: 'Discovery announced', what_happened: 'A recent measured discovery was announced.', why_interesting: 'It changes how we understand the world.', detail: 'A supplied instrument measurement supports the finding.', question: null, qualification: null, topic: 'science', event_key: 'discovery-announcement', confidence: .9, curiosity: .8, significance: .8, explainability: .9, novelty: .9, new_development: true, material_update: false, evidence_ids: [1] };
const evidence: Evidence[] = [{ id: 1, title: base.headline, url: 'https://www.nasa.gov/example', publisher: 'NASA', kind: 'primary', published_at: new Date().toISOString(), text: 'Supplied evidence. '.repeat(20), trusted: true }];
describe('synthetic editorial regression evaluation (not human usefulness validation)', () => {
  for (const scenario of scenarios as Array<{ name: string; candidates: Array<Partial<Brief>>; expected: number[]; max?: number; recent?: Array<Partial<Brief>> }>) it(scenario.name, () => {
    const candidates: StoryCandidate[] = scenario.candidates.map((input, index) => ({ id: index + 1, version: 1, brief: parseBrief(JSON.stringify({ ...base, ...input }), evidence), evidence }));
    const recent = (scenario.recent ?? []).map(input => ({ ...base, ...input }) as Brief);
    const selected = selectStories(candidates, scenario.max ?? 5, recent);
    const actual = selected.map(c => c.id).sort();
    const precision = actual.length ? actual.filter(id => scenario.expected.includes(id)).length / actual.length : scenario.expected.length ? 0 : 1;
    const missed = scenario.expected.filter(id => !actual.includes(id));
    const duplicates = selected.length - new Set(selected.map(c => c.brief.event_key)).size;
    console.log(JSON.stringify({ scenario: scenario.name, precision, missed, duplicates, topics: new Set(selected.map(c => c.brief.topic)).size, evidence_valid: selected.every(c => c.brief.evidence_ids.every(id => c.evidence.some(e => e.id === id))) }));
    expect(actual).toEqual([...scenario.expected].sort()); expect(duplicates).toBe(0);
  });
});
