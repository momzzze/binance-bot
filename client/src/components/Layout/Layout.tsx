import { useState } from 'react';
import { Navigation } from '../Navigation/Navigation';
import { Sidebar } from '../Sidebar/Sidebar';
import './Layout.scss';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="layout">
      <Navigation onMenuClick={toggleSidebar} />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="layout__content">{children}</main>
    </div>
  );
}
