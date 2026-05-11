import { Link } from 'react-router-dom';
import type { StatsResponse } from '../api';
import { chicagoTime, dayOfYear, todayLong } from '../format';

type Props = {
  stats: StatsResponse | null;
};

export default function Masthead({ stats }: Props) {
  const now = new Date();
  const issue = `Vol. I · No. ${String(dayOfYear(now)).padStart(3, '0')}`;
  return (
    <header className="masthead">
      <div className="masthead__top">
        <span>{issue}</span>
        <span>{todayLong(now)}</span>
        <span>{chicagoTime(now)} CT</span>
      </div>
      <h1 className="masthead__title">
        <Link to="/" style={{ color: 'inherit', borderBottom: 'none' }}>
          Anything Interesting
        </Link>
      </h1>
      <p className="masthead__subtitle">
        Worth talking about at the dinner table.
      </p>
      <div className="masthead__strap">
        <div className="masthead__strap-stats">
          <span>
            Stories <span className="strong">{stats?.articles_last_24h ?? '—'}</span>
          </span>
          <span>
            Outlets <span className="strong">{stats?.distinct_sources_last_24h ?? '—'}</span>
          </span>
          <span>
            Above the cut{' '}
            <span className="strong">{stats?.clusters_above_threshold ?? '—'}</span>
          </span>
          <span>
            Market-tied <span className="strong">{stats?.polymarket_matched_count ?? '—'}</span>
          </span>
        </div>
        <Link to="/archive">Archive</Link>
      </div>
    </header>
  );
}
