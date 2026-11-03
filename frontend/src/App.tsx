import { useState } from 'react';
import Header from './components/layout/Header';
import MainDashboard from './components/dashboard/MainDashboard';
import FlightsPage from './pages/FlightsPage';
import StatisticsPage from './pages/StatisticsPage';
import WeatherPage from './pages/WeatherPage';
import CongestionPage from './pages/CongestionPage';
import FacilitiesPage from './pages/FacilitiesPage';
import AlertsPage from './pages/AlertsPage';
import './App.css';

export type PageKey = 'home' | 'flights' | 'statistics' | 'weather' | 'congestion' | 'facilities' | 'alerts';
const menus: { key: PageKey; label: string }[] = [
  { key: 'home', label: '메인' },
  { key: 'flights', label: '운행현황' },
  { key: 'statistics', label: '운항통계' },
  { key: 'weather', label: '날씨' },
  { key: 'congestion', label: '출국장 혼잡도' },
  { key: 'facilities', label: '편의시설' },
  { key: 'alerts', label: '스마트 알림' },
];

export default function App() {
  const [page, setPage] = useState<PageKey>('home');
  const navigate = (next: PageKey) => setPage(next);
  return <div className="icn-app">
    <Header />
    <nav className="icn-nav" aria-label="대시보드 메뉴">
      {menus.map(item => <button key={item.key} type="button" className={page === item.key ? 'is-active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}
    </nav>
    {page === 'home' && <MainDashboard navigate={navigate} />}
    {page === 'flights' && <FlightsPage />}
    {page === 'statistics' && <StatisticsPage />}
    {page === 'weather' && <WeatherPage />}
    {page === 'congestion' && <CongestionPage />}
    {page === 'facilities' && <FacilitiesPage />}
    {page === 'alerts' && <AlertsPage />}
  </div>;
}
