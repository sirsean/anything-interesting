const TOPICS: Array<{ value: string | null; label: string }> = [
  { value: null, label: 'All' },
  { value: 'geopolitics', label: 'Geopolitics' },
  { value: 'politics', label: 'Politics' },
  { value: 'economics', label: 'Economics' },
  { value: 'technology', label: 'Technology' },
];

type Props = {
  selected: string | null;
  onSelect: (topic: string | null) => void;
};

export default function TopicNav({ selected, onSelect }: Props) {
  return (
    <nav className="topicnav" aria-label="Topic filter">
      <span className="topicnav__label">Sections</span>
      {TOPICS.map((t) => (
        <button
          key={t.label}
          type="button"
          className="topicnav__chip"
          aria-pressed={selected === t.value}
          onClick={() => onSelect(t.value)}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
