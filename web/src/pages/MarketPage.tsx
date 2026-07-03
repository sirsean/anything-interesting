import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchMarket, type MarketDetailResponse } from '../api';
import Colophon from '../components/Colophon';
import Masthead from '../components/Masthead';
import { fmtMaskedPercent, fmtRelative, fmtScore } from '../format';

export default function MarketPage() {
  const { slug: slugParam } = useParams<{ slug: string }>();
  const slug = slugParam ? decodeURIComponent(slugParam) : '';

  const [data, setData] = useState<MarketDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchMarket(slug, ctl.signal)
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
  }, [slug]);

  const m = data?.market;
  const delta =
    m?.one_day_price_change != null
      ? m.one_day_price_change * 100
      : m?.yes_price != null && m?.price_24h_ago != null
        ? (m.yes_price - m.price_24h_ago) * 100
        : null;

  return (
    <div className="page">
      <Masthead stats={null} />
      <p className="byline">
        <Link to="/markets">← Markets</Link>
      </p>

      {loading && <div className="notice">Loading market…</div>}
      {error && <div className="error">{error}</div>}

      {m && (
        <>
          <header className="frontpage__section">
            <h2 className="frontpage__section-title">{m.display_title}</h2>
            {m.outcome_label && (
              <p className="byline">Outcome tracked: {m.outcome_label}</p>
            )}
            <p className="byline">
              {m.category && <span>{m.category} · </span>}
              <a href={m.url} target="_blank" rel="noreferrer">
                View on Polymarket
              </a>
            </p>
          </header>

          <aside className="card">
            <div>
              <span className="card__price numeric">{fmtMaskedPercent(m.yes_price)}</span>
              {delta != null && (
                <span
                  className={
                    delta >= 0 ? 'card__delta--up byline numeric' : 'card__delta--down byline numeric'
                  }
                  style={{ marginLeft: '0.6rem' }}
                >
                  {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}% 24h
                </span>
              )}
            </div>
            <p className="byline" style={{ marginTop: '0.75rem' }}>
              24h volume{' '}
              <span className="numeric">
                {m.volume_24h != null ? m.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—'}
              </span>
              {m.last_snapshot_at && <> · last snap {fmtRelative(m.last_snapshot_at)}</>}
              {m.end_date && <> · resolves {m.end_date.slice(0, 10)}</>}
            </p>
            {m.description && <p style={{ marginTop: '1rem' }}>{m.description}</p>}
          </aside>

          {(data.snapshots?.length ?? 0) > 0 && (
            <section className="frontpage__section" style={{ marginTop: '2rem' }}>
              <h3 className="frontpage__section-title">Recent snapshots</h3>
              <ul className="byline" style={{ listStyle: 'none', padding: 0 }}>
                {data.snapshots.slice(0, 12).map((s) => (
                  <li key={s.taken_at} style={{ marginBottom: '0.35rem' }}>
                    <span className="numeric">{fmtMaskedPercent(s.price)}</span>
                    <span style={{ marginLeft: '0.5rem' }}>{fmtRelative(s.taken_at)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {(data.linked_clusters?.length ?? 0) > 0 && (
            <section className="frontpage__section" style={{ marginTop: '2rem' }}>
              <h3 className="frontpage__section-title">Linked stories</h3>
              <div className="frontpage__below">
                {data.linked_clusters.map((c) => (
                  <div key={c.id} className="briefcard">
                    <h4 className="story__title story__title--brief">
                      <Link to={`/cluster/${c.id}`}>{c.representative_title}</Link>
                    </h4>
                    <p className="byline">
                      Score <span className="numeric">{fmtScore(c.final_score)}</span>
                      <span style={{ marginLeft: '0.75rem' }}>{fmtRelative(c.last_updated)}</span>
                      {c.flow_type === 'market_driven' && (
                        <span className="pill pill--upcoming" style={{ marginLeft: '0.75rem' }}>
                          market-driven
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <Colophon />
    </div>
  );
}
