import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="page page--narrow">
      <h1>Page not found</h1>
      <p>
        <Link to="/">Return to the front page.</Link>
      </p>
    </main>
  );
}
