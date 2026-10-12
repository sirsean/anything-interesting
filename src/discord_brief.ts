import type { Brief } from './editorial';

const MAX_WORDS = 60;
const MAX_CHARS = 500;
const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
function paragraph(text: string): string { return text.replace(/\s+/g, ' ').trim(); }
function sentences(text: string): string[] { return [...sentenceSegmenter.segment(paragraph(text))].map(s => s.segment.trim()).filter(Boolean); }
function words(text: string): string[] { return text.split(/\s+/).filter(Boolean); }

/** Saved older editions have no separate short summary; reuse only their main event and significance. */
export function discordParagraph(brief: Brief): string {
  let text = paragraph(brief.discord_summary ?? '');
  if (!text) {
    const event = sentences(brief.what_happened)[0] ?? '';
    const significance = sentences(brief.why_interesting);
    const remaining = MAX_WORDS - words(event).length;
    const why = significance.find(s => words(s).length <= remaining) ?? '';
    text = paragraph(event + ' ' + why);
  }
  if (words(text).length > MAX_WORDS || text.length > MAX_CHARS) {
    let complete = '';
    for (const sentence of sentences(text)) {
      const next = paragraph(complete + ' ' + sentence);
      if (words(next).length > MAX_WORDS || next.length > MAX_CHARS) break;
      complete = next;
    }
    if (complete) return complete;
  }
  const parts = words(text), selected = parts.slice(0, MAX_WORDS);
  while (selected.join(' ').length > MAX_CHARS - 1) selected.pop();
  return selected.join(' ') + (selected.length < parts.length ? '…' : '');
}
