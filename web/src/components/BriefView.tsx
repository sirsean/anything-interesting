import type { NewsBrief, NewsEvidence } from '../api';
export default function BriefView({ brief: b, evidence = [], compact = false }: { brief: NewsBrief; evidence?: NewsEvidence[]; compact?: boolean }) {
  return <div className="news-brief">
    <p className="detail__lede">{b.what_happened}</p>
    <p>{b.why_interesting}</p>
    {!compact && <p>{b.detail}</p>}
    {b.qualification && <p className="news-brief__context">{b.qualification}</p>}
    {!compact && b.question && <p className="news-brief__question"><strong>Talk about it:</strong> {b.question}</p>}
    {!!evidence.length && <p className="byline">Read more: {evidence.map((e, i) => <span key={e.id}>{i > 0 && ' · '}<a href={e.url} target="_blank" rel="noreferrer">{e.publisher}</a></span>)}</p>}
  </div>;
}
