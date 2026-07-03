import type { ClusterPolymarket } from '../api';
import { fmtMaskedPercent } from '../format';

type Props = {
  poly: ClusterPolymarket;
};

export default function PolymarketCard({ poly }: Props) {
  const url = poly.url;
  const headline =
    poly.event_title && poly.event_slug && poly.event_slug !== poly.slug
      ? poly.event_title
      : (poly.title ?? poly.slug);
  const outcome = poly.outcome_label;
  const now = poly.price_now;
  const prev = poly.price_24h_ago;
  const delta = now != null && prev != null ? (now - prev) * 100 : null;

  return (
    <aside className="card">
      <h3 className="card__title">Polymarket</h3>
      <p className="card__big">
        <a href={url} target="_blank" rel="noreferrer">
          {headline}
        </a>
      </p>
      {outcome && <p className="byline">Outcome: {outcome}</p>}
      <div>
        <span className="card__price numeric">{fmtMaskedPercent(now)}</span>
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
      <p className="byline">
        Match similarity {(poly.match_score * 100).toFixed(0)}%
      </p>
    </aside>
  );
}
