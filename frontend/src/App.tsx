import { lazy, Suspense, useState } from 'react';
import Header from './components/layout/Header';
import FlightSearch from './components/layout/FlightSearch';
import MainDashboard from './components/dashboard/MainDashboard';
import FlightsPage from './pages/FlightsPage';
import MyFlightPage from './pages/MyFlightPage';
import StatisticsPage from './pages/StatisticsPage';
import WeatherPage from './pages/WeatherPage';
import CongestionPage from './pages/CongestionPage';
import FacilitiesPage from './pages/FacilitiesPage';
import AlertsPage from './pages/AlertsPage';
import YoloProvider from './components/yolo/YoloProvider';
import YoloAlertModal from './components/yolo/YoloAlertModal';
import './App.css';
import './polish.css';

// 소개 화면은 처음 한 번만 보이므로 메인 번들과 나눠 불러옵니다.
const IntroPage = lazy(() => import('./pages/IntroPage'));
const INTRO_KEY = 'icn.introSeen';

function introSeen() {
  try {
    return window.sessionStorage.getItem(INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

function markIntroSeen() {
  try {
    window.sessionStorage.setItem(INTRO_KEY, '1');
  } catch {
    // 저장하지 못하면 새로고침 때 소개 화면이 다시 보일 뿐입니다.
  }
}

export type PageKey = 'home' | 'flights' | 'statistics' | 'weather' | 'congestion' | 'facilities' | 'alerts' | 'myFlight';
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
  const [flightNo, setFlightNo] = useState('');
  const [showIntro, setShowIntro] = useState(() => !introSeen());
  // 소개 화면에서 넘어온 직후에만 메인을 페이드 인합니다.
  const [entering, setEntering] = useState(false);
  const navigate = (next: PageKey) => setPage(next);
  const openFlight = (next: string) => {
    setFlightNo(next);
    setPage('myFlight');
  };
  const startDashboard = () => {
    markIntroSeen();
    setPage('home');
    setEntering(true);
    setShowIntro(false);
  };

  if (showIntro) {
    // 소개 화면을 불러오는 동안 같은 어두운 출국장 색을 먼저 보여 줍니다.
    return <Suspense fallback={<div aria-hidden="true" style={{ minHeight: '100dvh', background: '#06172d' }} />}>
      <IntroPage onStart={startDashboard} />
    </Suspense>;
  }

  return <YoloProvider><YoloAlertModal /><div className={`icn-app ${entering ? 'is-entering' : ''}`} onAnimationEnd={event => {
    if (event.target === event.currentTarget) setEntering(false);
  }}>
    <Header onBrandClick={() => setShowIntro(true)} />
    <nav className="icn-nav" aria-label="대시보드 메뉴">
      {menus.map(item => <button key={item.key} type="button" className={page === item.key ? 'is-active' : ''} aria-current={page === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}>{item.label}</button>)}
      <FlightSearch onSearch={openFlight} />
    </nav>
    {page === 'home' && <MainDashboard navigate={navigate} onOpenFlight={openFlight} />}
    {page === 'flights' && <FlightsPage />}
    {page === 'statistics' && <StatisticsPage />}
    {page === 'weather' && <WeatherPage />}
    {page === 'congestion' && <CongestionPage />}
    {page === 'facilities' && <FacilitiesPage />}
    {page === 'alerts' && <AlertsPage />}
    {page === 'myFlight' && <MyFlightPage flightNo={flightNo} navigate={navigate} />}
  </div></YoloProvider>;
}