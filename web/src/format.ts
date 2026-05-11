import type { ClusterItem, ClusterDigestStatus } from './api';

export function topicLabel(t: string | null | undefined): string {
  if (!t) return 'General';
  return t.slice(0, 1).toUpperCase() + t.slice(1).toLowerCase();
}

export function isMarketDriven(c: { flow_type: string }): boolean {
  return c.flow_type === 'market_driven';
}

export function clusterTitle(c: ClusterItem): string {
  const base = c.top_article?.title ?? c.representative_title;
  return isMarketDriven(c) ? `📈 ${base}` : base;
}

export function pillClass(s: ClusterDigestStatus): string {
  if (s.posted_digest_id != null) return 'pill pill--posted';
  if (s.eligible) return 'pill pill--upcoming';
  return 'pill pill--below';
}

const SCORE_HIGH = 0.88;
const SCORE_MID = 0.6;

export function meterClass(score: number): string {
  if (score >= SCORE_HIGH) return 'meter meter--high';
  if (score >= SCORE_MID) return 'meter meter--mid';
  return 'meter';
}

export function fmtPercent(n: number, digits = 0): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtScore(n: number): string {
  return n.toFixed(2);
}

export function fmtRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diffMs = now.getTime() - t;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function fmtMaskedPercent(p: number | null | undefined): string {
  if (p == null) return '—';
  return `${(p * 100).toFixed(0)}%`;
}

export function todayLong(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function dayOfYear(now: Date = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - start) / 86400000);
}

export function chicagoTime(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}
