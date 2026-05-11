import { Link } from 'react-router-dom';
import type { ClusterItem } from '../api';
import { clusterTitle, fmtRelative, isMarketDriven, topicLabel } from '../format';
import Meter from './Meter';
import StatusPill from './StatusPill';

type Variant = 'hero' | 'lede' | 'brief' | 'list';

type Props = {
  cluster: ClusterItem;
  variant: Variant;
  showDek?: boolean;
};

const variantClass: Record<Variant, string> = {
  hero: 'story__title--hero',
  lede: 'story__title--lede',
  brief: 'story__title--brief',
  list: 'story__title--list',
};

function dek(c: ClusterItem): string {
  if (isMarketDriven(c) && c.llm_reasoning?.reason) return c.llm_reasoning.reason;
  if (c.top_article?.title && c.top_article.title !== c.representative_title) {
    return c.representative_title;
  }
  return '';
}

export default function StoryCard({ cluster, variant, showDek = true }: Props) {
  const href = cluster.top_article?.url ?? `/cluster/${cluster.id}`;
  const isExternal = href.startsWith('http');
  const title = clusterTitle(cluster);
  const sources = cluster.sources.join(', ') || (isMarketDriven(cluster) ? 'Polymarket' : '—');
  const description = showDek ? dek(cluster) : '';

  const TitleLink = () =>
    isExternal ? (
      <a href={href} target="_blank" rel="noreferrer">
        {title}
      </a>
    ) : (
      <Link to={href}>{title}</Link>
    );

  return (
    <article className="story">
      <div className="story__kicker">
        <span className="story__topic">{topicLabel(cluster.topic)}</span>
        {isMarketDriven(cluster) ? (
          <span className="kicker">Market-driven</span>
        ) : (
          <span className="kicker">{sources}</span>
        )}
      </div>
      <h2 className={`story__title ${variantClass[variant]}`}>
        <TitleLink />
      </h2>
      {description && <p className="story__dek">{description}</p>}
      {!isMarketDriven(cluster) && variant !== 'list' && (
        <p className="story__sources">{sources}</p>
      )}
      <div className="story__meta">
        <Meter score={cluster.final_score} />
        <StatusPill status={cluster.digest} />
        <span className="byline">
          <Link to={`/cluster/${cluster.id}`}>Detail</Link>
        </span>
        <span className="byline">{fmtRelative(cluster.last_updated)}</span>
      </div>
    </article>
  );
}
