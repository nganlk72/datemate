import { Link, Outlet } from 'react-router-dom';
import Icon from './Icon';

export default function Layout() {
  return (
    <div className="app-frame">
      <header className="topbar">
        <Link to="/" className="wordmark" aria-label="datemate home">
          <span className="wordmark-icon"><Icon name="route" size={20} /></span>
          <span><b>date</b><i>mate</i></span>
        </Link>
        <div className="topbar-tagline">
          <strong>Plan better, together.</strong>
          <span>Get everyone in one place before the day begins.</span>
        </div>
      </header>
      <div className="app-content"><Outlet /></div>
    </div>
  );
}
