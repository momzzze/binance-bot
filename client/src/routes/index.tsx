import { createFileRoute } from '@tanstack/react-router';

// File-based route definition for /
export const Route = createFileRoute('/')({
  component: Index,
});

function Index() {
  return (
    <div className="home">
      <h1>Welcome to Binance Trading Bot</h1>
      <p>Use the navigation to explore the dashboard</p>
    </div>
  );
}
