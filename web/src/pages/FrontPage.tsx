import EditionPanel from '../components/EditionPanel';
import { fetchEdition, fetchNewsHealth, type NewsEdition, type NewsHealth } from '../api';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  fetchStats,
  fetchTopNews,
  type ClusterItem,
  type StatsResponse,
  type TopNewsResponse,
} from '../api';
import Colophon from '../components/Colophon';
import Masthead from '../components/Masthead';
import StoryCard from '../components/StoryCard';
import TopicNav from '../components/TopicNav';

const DEFAULT_COUNT = 24;
const DEFAULT_WINDOW_HOURS = 24;

export default function FrontPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const topic = searchParams.get('topic');

  const [edition, setEdition] = useState<NewsEdition | null>(null);
  const [health, setHealth] = useState<NewsHealth | null>(null);
  const [editionError, setEditionError] = useState(false);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [data, setData] = useState<TopNewsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctl = new AbortController();
    fetchEdition(ctl.signal).then(d => setEdition(d.edition)).catch(() => { if (!ctl.signal.aborted) setEditionError(true); });
    fetchNewsHealth(ctl.signal).then(setHealth).catch(() => {});
    fetchStats(ctl.signal).then(setStats).catch(() => {
      /* stats are decorative */
    });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchTopNews(
      { count: DEFAULT_COUNT, topic, window: DEFAULT_WINDOW_HOURS },
      ctl.signal,
    )
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
  }, [topic]);

  const handleTopic = (next: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (next) params.set('topic', next);
    else params.delete('topic');
    setSearchParams(params, { replace: true });
  };

  const items = data?.items ?? [];
  const lede = items[0];
  const aboveFold = items.slice(1, 5);
  const belowFold = items.slice(5);
  const eligibleAboveFold: ClusterItem[] = aboveFold;

  return (
    <div className="page">
      <Masthead stats={stats} />
      {!topic && edition && <EditionPanel edition={edition} />}
      {!topic && editionError && <p className="error">The saved edition could not be loaded.</p>}
      {!topic && !edition && !editionError && <p className="notice">The daily edition is prepared each afternoon. Browse the latest reporting below.</p>}
      {health?.degraded && <p className="notice">Some collection or analysis is incomplete. {health.fresh_feeds} feeds are current; {health.pending_stories} stories await analysis.</p>}
      <h2 className="frontpage__section-title">Browse the news</h2>
      <TopicNav selected={topic} onSelect={handleTopic} />

      {loading && <div className="notice">Setting type…</div>}
      {error && <div className="error">Wire failed: {error}</div>}

      {!loading && !error && items.length === 0 && (
        <div className="notice">No analyzed stories in the last {data?.meta.window_hours ?? 24}h.</div>
      )}

      {lede && (
        <section className="lede" aria-label="Lede story">
          <div className="lede__body">
            <StoryCard cluster={lede} variant="hero" />
          </div>
        </section>
      )}

      {eligibleAboveFold.length > 0 && (
        <section className="frontpage__section">
          <h2 className="frontpage__section-title">More to explore</h2>
          <div className="frontpage__above">
            {eligibleAboveFold.map((c) => (
              <div className="briefcard" key={c.id}>
                <StoryCard cluster={c} variant="brief" />
              </div>
            ))}
          </div>
        </section>
      )}

      {belowFold.length > 0 && (
        <section className="frontpage__section">
          <h2 className="frontpage__section-title">Around the world &amp; beyond</h2>
          <div className="frontpage__below">
            {belowFold.map((c) => (
              <div className="briefcard" key={c.id}>
                <StoryCard cluster={c} variant="brief" showDek={false} />
              </div>
            ))}
          </div>
        </section>
      )}

      {health && <details className="coverage-details"><summary>Collection status</summary><p>{health.fresh_feeds} current feeds · {health.stale_feeds} stale · {health.failed_feeds} failed · {health.unchecked_feeds} unchecked</p><ul>{health.feeds.map(f => <li key={f.label}>{f.label}: {f.state}</li>)}</ul></details>}
      <Colophon generatedAt={data?.meta.generated_at} />
    </div>
  );
}
