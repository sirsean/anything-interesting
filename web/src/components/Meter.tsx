import { fmtScore, meterClass } from '../format';

type Props = {
  score: number;
  label?: string;
};

export default function Meter({ score, label }: Props) {
  const pct = Math.max(0, Math.min(1, score));
  return (
    <div className={meterClass(score)} title={label ?? `Interestingness ${fmtScore(score)}`}>
      <span className="meter__bar" aria-hidden="true">
        <span className="meter__fill" style={{ width: `${(pct * 100).toFixed(1)}%` }} />
      </span>
      <span className="meter__num">{fmtScore(score)}</span>
    </div>
  );
}
