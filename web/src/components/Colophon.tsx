import { Link } from 'react-router-dom';

type Props = {
  generatedAt?: string | null;
};

export default function Colophon({ generatedAt }: Props) {
  return (
    <footer className="colophon">
      <span>Compiled hourly. Quiet days are honest days.</span>
      <span>
        <Link to="/archive">Archive</Link>
      </span>
      <span>
        {generatedAt
          ? `Set: ${new Date(generatedAt).toLocaleString(undefined, {
              hour: '2-digit',
              minute: '2-digit',
              month: 'short',
              day: 'numeric',
            })}`
          : ''}
      </span>
    </footer>
  );
}
