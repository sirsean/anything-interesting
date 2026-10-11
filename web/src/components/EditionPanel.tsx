import { Link } from 'react-router-dom';
import type { NewsEdition } from '../api';
import BriefView from './BriefView';
import { topicLabel } from '../format';
export default function EditionPanel({ edition, archive = false }: { edition: NewsEdition; archive?: boolean }) {
  return <section className="edition" aria-label="Daily edition">
    <h2 className="frontpage__section-title">{archive ? 'Edition' : 'Things worth talking about'} · {edition.day}</h2>
    {!edition.items.length && <p className="notice">{edition.status === 'incomplete' ? 'Collection or analysis is incomplete. We cannot call this a quiet news day yet.' : 'A quiet edition: no new stories met our evidence and interest standards today.'}</p>}
    {edition.health.degraded && !!edition.items.length && <p className="byline">This edition has useful stories, but collection or analysis was incomplete.</p>}
    <div className="edition__stories">{edition.items.map(c => <article className="edition__story" key={c.position}>
      <span className="story__topic">{topicLabel(c.brief.topic)}{c.brief.material_update ? ' · A significant update' : ''}</span>
      <h3 className="story__title story__title--brief"><Link to={'/cluster/' + c.id}>{c.brief.headline}</Link></h3>
      <BriefView brief={c.brief} evidence={c.evidence} />
    </article>)}</div>
  </section>;
}
