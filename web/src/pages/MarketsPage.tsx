import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMarkets, type MarketListItem, type MarketsResponse } from '../api';
import Colophon from '../components/Colophon';
import Masthead from '../components/Masthead';
import { fmtMaskedPercent, fmtRelative } from '../format';

const DEFAULT_LIMIT = 80;

function priceDelta(now: number | null, prev: number | null): number | null {
  if (now == null || prev == null) return null;
  return (now - prev) * 100;
}

function MarketRow({ m }: { m: MarketListItem }) {
  const delta =
    m.one_day_price_change != null
      ? m.one_day_price_change * 100
      : priceDelta(m.yes_price, m.price_24h_ago);

  return (
    <>
      <h3 className="story__title story__title--brief">
        <Link to={`/markets/${encodeURIComponent(m.slug)}`}>{m.title}</Link>
      </h3>
      <div className="byline">
        <span className="numeric">{fmtMaskedPercent(m.yes_price)}</span>
        {delta != null && (
          <span
            className={delta >= 0 ? 'card__delta--up numeric' : 'card__delta--down numeric'}
            style={{ marginLeft: '0.5rem' }}
          >
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}% 24h
          </span>
        )}
        {m.category && <span style={{ marginLeft: '0.75rem' }}>{m.category}</span>}
        {m.linked_clusters > 0 && (
          <span style={{ marginLeft: '0.75rem' }}>
            {m.linked_clusters} linked stor{m.linked_clusters === 1 ? 'y' : 'ies'}
          </span>
        )}
        {m.last_snapshot_at && (
          <span style={{ marginLeft: '0.75rem' }}>snap {fmtRelative(m.last_snapshot_at)}</span>
        )}
      </div>
    </>
  );
}

export default function MarketsPage() {
  const [data, setData] = useState<MarketsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchMarkets(DEFAULT_LIMIT, ctl.signal)
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

  return (
    <div className="page">
      <Masthead stats={null} />
      <header className="frontpage__section">
        <h2 className="frontpage__section-title">Prediction markets</h2>
        <p className="byline">
          Active Polymarket contracts we track for price moves and news matching.
          {data?.meta.lookback_hours != null && ` Watchlist window: ${data.meta.lookback_hours}h.`}
        </p>
      </header>

      {loading && <div className="notice">Loading markets…</div>}
      {error && <div className="error">Markets feed failed: {error}</div>}

      {!loading && !error && (data?.items.length ?? 0) === 0 && (
        <div className="notice">No tracked markets in the current watchlist window.</div>
      )}

      <section className="frontpage__section">
        <div className="frontpage__below">
          {data?.items.map((m) => (
            <div className="briefcard" key={m.slug}>
              <MarketRow m={m} />
            </div>
          ))}
        </div>
      </section>

      <Colophon />
    </div>
  );
}
