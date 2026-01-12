import './Navigation.scss';

interface NavigationProps {
  onMenuClick: () => void;
}

export function Navigation({ onMenuClick }: NavigationProps) {
  return (
    <nav className="navigation">
      <div className="navigation__container">
        <button 
          className="navigation__burger" 
          onClick={onMenuClick}
          aria-label="Toggle menu"
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        
        <div className="navigation__logo">
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <path d="M16 0L32 16L16 32L0 16L16 0Z" fill="#F3BA2F"/>
            <path d="M16 8L24 16L16 24L8 16L16 8Z" fill="#0A0E27"/>
          </svg>
          <span>Binance Bot</span>
        </div>
      </div>
    </nav>
  );
}
