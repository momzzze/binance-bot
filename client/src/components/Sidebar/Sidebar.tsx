import { Link } from '@tanstack/react-router';
import './Sidebar.scss';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const navItems = [
    { path: '/', label: 'Home', icon: '🏠' },
    { path: '/dashboard', label: 'Dashboard', icon: '📊' },
    { path: '/positions', label: 'Positions', icon: '💼' },
    { path: '/trades', label: 'Trades', icon: '📈' },
    { path: '/calendar', label: 'Calendar', icon: '📅' },
    { path: '/charts', label: 'Charts', icon: '📉' },
    { path: '/settings', label: 'Settings', icon: '⚙️' },
  ];

  return (
    <>
      <div
        className={`sidebar__overlay ${
          isOpen ? 'sidebar__overlay--active' : ''
        }`}
        onClick={onClose}
      />
      <aside className={`sidebar ${isOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar__header">
          <h2>Menu</h2>
          <button className="sidebar__close" onClick={onClose}>
            ✕
          </button>
        </div>
        <nav className="sidebar__nav">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className="sidebar__link"
              activeProps={{ className: 'sidebar__link--active' }}
              onClick={onClose}
            >
              <span className="sidebar__icon">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
