import type { ClusterScores } from '../api';
import { fmtScore } from '../format';

type Props = {
  scores: ClusterScores;
  finalScore: number;
};

export default function ScoreGrid({ scores, finalScore }: Props) {
  const cells: Array<{ label: string; value: number }> = [
    { label: 'Coverage', value: scores.coverage },
    { label: 'Novelty', value: scores.novelty },
    { label: 'Surprise', value: scores.surprise },
    { label: 'LLM', value: scores.llm },
    { label: 'Final', value: finalScore },
  ];
  return (
    <div className="scoregrid">
      {cells.map((c) => (
        <div className="scoregrid__cell" key={c.label}>
          <span className="scoregrid__num">{fmtScore(c.value)}</span>
          <span className="scoregrid__name">{c.label}</span>
        </div>
      ))}
    </div>
  );
}
