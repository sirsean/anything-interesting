import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { fetchCluster, fetchStats, type ClusterDetailResponse, type StatsResponse } from '../api';
import Colophon from '../components/Colophon';
import Masthead from '../components/Masthead';
import Meter from '../components/Meter';
import PolymarketCard from '../components/PolymarketCard';
import ScoreGrid from '../components/ScoreGrid';
import StatusPill from '../components/StatusPill';
import { clusterTitle, fmtRelative, isMarketDriven, topicLabel } from '../format';

export default function ClusterPage() {
  const { id } = useParams();
  const numericId = Number.parseInt(id ?? '', 10);
  const [data, setData] = useState<ClusterDetailResponse | null>(null);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctl = new AbortController();
    fetchStats(ctl.signal).then(setStats).catch(() => {
      /* decorative */
    });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (!Number.isFinite(numericId) || numericId <= 0) {
      setError('Invalid cluster id');
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetchCluster(numericId, ctl.signal)
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
  }, [numericId]);

  return (
    <div className="page">
      <Masthead stats={stats} />
      <p style={{ margin: '1rem 0 0' }} className="byline">
        <Link to="/">&larr; Front page</Link>
      </p>
      {loading && <div className="notice">Setting type…</div>}
      {error && <div className="error">{error}</div>}
      {!loading && !error && data && <ClusterBody data={data} />}
      <Colophon generatedAt={data?.cluster.last_updated} />
    </div>
  );
}

function ClusterBody({ data }: { data: ClusterDetailResponse }) {
  const c = data.cluster;
  const title = clusterTitle(c);
  const topArticleUrl = c.top_article?.url;
  return (
    <div className="detail">
      <article>
        <div className="story__kicker" style={{ marginTop: '1.25rem' }}>
          <span className="story__topic">{topicLabel(c.topic)}</span>
          {isMarketDriven(c) && <span className="kicker">Market-driven</span>}
        </div>
        <h1 className="detail__title">
          {topArticleUrl ? (
            <a href={topArticleUrl} target="_blank" rel="noreferrer" style={{ borderBottom: 'none' }}>
              {title}
            </a>
          ) : (
            title
          )}
        </h1>
        <p className="detail__lede">{c.representative_title}</p>

        <div className="story__meta" style={{ marginBottom: '1rem' }}>
          <Meter score={c.final_score} />
          <StatusPill status={c.digest} />
          <span className="byline">First seen {fmtRelative(c.first_seen)}</span>
          <span className="byline">Updated {fmtRelative(c.last_updated)}</span>
        </div>

        <section className="detail__section">
          <h2 className="detail__section-title">Score breakdown</h2>
          <ScoreGrid scores={c.scores} finalScore={c.final_score} />
        </section>

        {c.llm_reasoning && (
          <section className="detail__section">
            <h2 className="detail__section-title">LLM judgment</h2>
            <p className="reasoning">{c.llm_reasoning.reason}</p>
            {c.llm_reasoning.score != null && (
              <p className="byline">Score {c.llm_reasoning.score.toFixed(2)}</p>
            )}
            {c.llm_reasoning.at && (
              <p className="byline">Logged {fmtRelative(c.llm_reasoning.at)}</p>
            )}
          </section>
        )}

        <section className="detail__section">
          <h2 className="detail__section-title">
            Articles in this cluster ({data.articles.length})
          </h2>
          <ul className="articlelist">
            {data.articles.map((a) => (
              <li key={a.id}>
                <span className="articlelist__title">
                  <a href={a.url} target="_blank" rel="noreferrer">
                    {a.title}
                  </a>
                </span>
                <span className="articlelist__meta">
                  {a.source} &middot; {fmtRelative(a.fetched_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </article>

      <aside className="aside">
        <div className="card">
          <h3 className="card__title">At a glance</h3>
          <p className="byline">
            Distinct outlets <span className="numeric">{c.sources.length}</span>
          </p>
          <p className="byline">
            Weighted coverage 12h{' '}
            <span className="numeric">{c.weighted_sources_12h.toFixed(2)}</span>
          </p>
          <p className="byline">
            Coverage all-time <span className="numeric">{c.source_weight_sum.toFixed(2)}</span>
          </p>
          <p className="byline" style={{ marginTop: '0.5rem' }}>
            {c.sources.length > 0 ? c.sources.join(' · ') : '—'}
          </p>
        </div>
        {c.polymarket && <PolymarketCard poly={c.polymarket} />}
      </aside>
    </div>
  );
}
