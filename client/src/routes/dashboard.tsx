import { useEffect, useState, type CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  botService,
  type BotStatus,
  type Position,
  type DailyStats,
} from '../services/bot';
import { tradesService, type TradeStats } from '../services/trades';

// File-based route definition for /dashboard
export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

function Dashboard() {
  const [bot, setBot] = useState<BotStatus | null>(null);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [summaryTime, setSummaryTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [botRes, summaryRes, dailyRes] = await Promise.all([
        botService.getStatus(),
        tradesService.getSummary(),
        botService.getDailyStats(),
      ]);
      setBot(botRes);
      setStats(summaryRes.overall);
      setDailyStats(dailyRes.today);
      setSummaryTime(summaryRes.timestamp);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="dashboard">
      <h1>Dashboard</h1>
      {error && <p style={{ color: '#ff7070' }}>{error}</p>}
      <button onClick={load} disabled={loading} style={button('#7ec8ff')}>
        Refresh
      </button>

      <section style={section}>
        <h2>Today's Performance</h2>
        <div style={grid(180)}>
          <Card
            label="Total PnL"
            value={
              dailyStats
                ? `${
                    dailyStats.total_pnl_usdt >= 0 ? '+' : ''
                  }${dailyStats.total_pnl_usdt.toFixed(2)} USDT`
                : '—'
            }
            color={
              dailyStats && dailyStats.total_pnl_usdt >= 0
                ? '#9be28a'
                : '#ff7070'
            }
          />
          <Card
            label="Trades"
            value={dailyStats ? String(dailyStats.total_trades) : '—'}
          />
          <Card
            label="Wins / Losses"
            value={
              dailyStats
                ? `${dailyStats.winning_trades} / ${dailyStats.losing_trades}`
                : '—'
            }
          />
          <Card
            label="Win Rate"
            value={dailyStats ? `${dailyStats.win_rate}%` : '—'}
            color={
              dailyStats && parseFloat(dailyStats.win_rate) >= 50
                ? '#9be28a'
                : '#ff7070'
            }
          />
          <Card
            label="Best Trade"
            value={
              dailyStats
                ? `+${dailyStats.best_trade_usdt.toFixed(2)} USDT`
                : '—'
            }
            color="#9be28a"
          />
          <Card
            label="Worst Trade"
            value={
              dailyStats
                ? `${dailyStats.worst_trade_usdt.toFixed(2)} USDT`
                : '—'
            }
            color="#ff7070"
          />
        </div>
      </section>

      <section style={section}>
        <h2>Bot Status</h2>
        <div style={grid(180)}>
          <Card label="Running" value={bot?.running ? 'Yes' : 'No'} />
          <Card
            label="Trading Enabled"
            value={bot?.tradingEnabled ? 'Yes' : 'No'}
          />
          <Card label="Kill Switch" value={bot?.killSwitch ? 'On' : 'Off'} />
          <Card
            label="Loop (ms)"
            value={bot?.loopMs ? String(bot.loopMs) : '—'}
          />
          <Card label="Symbols" value={bot?.symbols?.join(', ') || '—'} />
        </div>
      </section>

      <section style={section}>
        <h2>Trading Stats</h2>
        {summaryTime && (
          <p style={{ color: '#9aa3c4', marginBottom: '0.5rem' }}>
            As of {new Date(summaryTime).toLocaleString()}
          </p>
        )}
        <div style={grid(160)}>
          <Card label="Total Orders" value={stats?.total_orders ?? 0} />
          <Card label="Buys" value={stats?.buy_orders ?? 0} />
          <Card label="Sells" value={stats?.sell_orders ?? 0} />
          <Card label="Filled" value={stats?.filled_count ?? 0} />
          <Card label="Canceled" value={stats?.canceled_count ?? 0} />
          <Card label="Filled Qty" value={stats?.total_qty_filled ?? 0} />
          <Card label="Buy Qty" value={stats?.buy_qty_filled ?? 0} />
          <Card label="Sell Qty" value={stats?.sell_qty_filled ?? 0} />
        </div>
      </section>
    </div>
  );
}

function Card({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div style={card}>
      <p style={{ color: '#9aa3c4', marginBottom: '0.35rem' }}>{label}</p>
      <p
        style={{
          color: color || '#f3ba2f',
          fontSize: '1.1rem',
          fontWeight: 600,
        }}
      >
        {value}
      </p>
    </div>
  );
}

const section: CSSProperties = {
  marginTop: '1.25rem',
};

const card: CSSProperties = {
  background: '#151a33',
  border: '1px solid #232a4a',
  borderRadius: '12px',
  padding: '0.9rem',
};

const grid = (minWidth = 160): CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${minWidth}px, 1fr))`,
  gap: '0.75rem',
});

const button = (bg: string): CSSProperties => ({
  background: bg,
  color: '#0a0e27',
  border: 'none',
  borderRadius: '8px',
  padding: '0.6rem 1rem',
  cursor: 'pointer',
  fontWeight: 600,
  marginBottom: '0.75rem',
});
