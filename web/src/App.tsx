import { Route, Routes } from 'react-router-dom';
import FrontPage from './pages/FrontPage';
import ClusterPage from './pages/ClusterPage';
import ArchivePage from './pages/ArchivePage';
import MarketsPage from './pages/MarketsPage';
import MarketPage from './pages/MarketPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<FrontPage />} />
      <Route path="/cluster/:id" element={<ClusterPage />} />
      <Route path="/archive" element={<ArchivePage />} />
      <Route path="/markets" element={<MarketsPage />} />
      <Route path="/markets/:slug" element={<MarketPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
