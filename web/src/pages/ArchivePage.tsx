import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchDigests, fetchStats, type DigestsResponse, type StatsResponse } from '../api';
import Colophon from '../components/Colophon';
import Masthead from '../components/Masthead';
import { fmtScore, isMarketDriven, topicLabel } from '../format';

const LIMIT = 30;

function formatChicagoSlot(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(d);
  } catch {
    return iso;
  }
}

export default function ArchivePage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [data, setData] = useState<DigestsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchStats(ctl.signal).then(setStats).catch(() => {
      /* decorative */
    });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchDigests(LIMIT, ctl.signal)
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
        setLoading(false);
      });
    return () => ctl.abort();
  }, []);

  const items = data?.items ?? [];

  return (
    <div className="page">
      <Masthead stats={stats} />
      <p style={{ margin: '1rem 0 0' }} className="byline">
        <Link to="/">&larr; Front page</Link>
      </p>

      <h2 className="frontpage__section-title" style={{ marginTop: '1rem' }}>
        Past editions
      </h2>

      {loading && <div className="notice">Setting type…</div>}
      {error && <div className="error">{error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="notice">No digests posted yet.</div>
      )}

      {items.length > 0 && (
        <div className="archive">
          {items.map((d) => (
            <article key={d.id} className="archive__entry">
              <header className="archive__entry-head">
                <span className="archive__date">{formatChicagoSlot(d.digest_timestamp)}</span>
                <span className="byline">
                  {d.clusters.length} item{d.clusters.length === 1 ? '' : 's'} ·{' '}
                  {d.channel_kind}
                </span>
              </header>
              {d.clusters.length === 0 ? (
                <p className="byline">(quiet run)</p>
              ) : (
                <ul className="archive__list">
                  {d.clusters.map((c) => (
                    <li key={c.id}>
                      <span>
                        {isMarketDriven(c) && '📈 '}
                        <Link to={`/cluster/${c.id}`}>{c.representative_title}</Link>
                      </span>
                      <span className="byline numeric">
                        {topicLabel(c.topic)} · {fmtScore(c.final_score)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}

      <Colophon generatedAt={data ? new Date().toISOString() : null} />
    </div>
  );
}
