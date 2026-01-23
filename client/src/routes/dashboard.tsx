import { useEffect, useState, type CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  botService,
  type BotStatus,
  type Position,
  type DailyStats,
  type AccountInfo,
  type Balance,
  type PositionNotionalResponse,
  DailyHistory,
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
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [positionsNotional, setPositionsNotional] =
    useState<PositionNotionalResponse | null>(null);
  const [summaryTime, setSummaryTime] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [botRes, summaryRes, dailyRes, accountRes, notionalRes] =
        await Promise.all([
          botService.getStatus(),
          tradesService.getSummary(),
          botService.getDailyStats(),
          botService.getAccount(),
          botService.getPositionsNotional(),
        ]);
      setBot(botRes);
      setStats(summaryRes.overall);
      setDailyStats(dailyRes.today);
      setAccount(accountRes);
      setPositionsNotional(notionalRes);
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
        <h2>Open Positions</h2>
        {positionsNotional ? (
          <div style={grid(180)}>
            <Card
              label="Total Exposure"
              value={`${positionsNotional.totalNotional.toFixed(2)} USDC`}
              color="#7ec8ff"
            />
            {positionsNotional.positions.length > 0 ? (
              positionsNotional.positions.map((pos) => (
                <Card
                  key={pos.symbol}
                  label={pos.symbol}
                  value={`${pos.notional.toFixed(2)} USDC`}
                  color="#a8e6cf"
                />
              ))
            ) : (
              <Card label="Positions" value="None open" />
            )}
          </div>
        ) : (
          <p style={{ color: '#9aa3c4' }}>Loading...</p>
        )}
      </section>

      <section style={section}>
        <h2>Account Assets</h2>
        {account && (
          <div style={{ marginBottom: '0.75rem', color: '#9aa3c4' }}>
            <span>Trading: {account.canTrade ? '✓' : '✗'} | </span>
            <span>Withdraw: {account.canWithdraw ? '✓' : '✗'} | </span>
            <span>Deposit: {account.canDeposit ? '✓' : '✗'}</span>
          </div>
        )}
        {account && account.balances.length > 0 ? (
          <div style={grid(220)}>
            {account.balances.slice(0, 20).map((balance) => (
              <AssetCard key={balance.asset} balance={balance} />
            ))}
          </div>
        ) : (
          <p style={{ color: '#9aa3c4' }}>No assets found or loading...</p>
        )}
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

function AssetCard({ balance }: { balance: Balance }) {
  const decimals = ['BTC', 'ETH'].includes(balance.asset) ? 6 : 2;
  const hasLocked = balance.locked > 0;
  const hasPnl = balance.unrealizedPnl !== 0;

  return (
    <div
      style={{
        ...card,
        border: balance.isTrading ? '1px solid #f3ba2f' : '1px solid #232a4a',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.35rem',
        }}
      >
        <p style={{ color: '#9aa3c4', fontWeight: 500 }}>{balance.asset}</p>
        {balance.isTrading && (
          <span
            style={{
              fontSize: '0.65rem',
              padding: '0.15rem 0.4rem',
              background: '#f3ba2f',
              color: '#0a0e27',
              borderRadius: '4px',
              fontWeight: 600,
            }}
          >
            TRADING
          </span>
        )}
      </div>
      <p
        style={{
          color: '#7ec8ff',
          fontSize: '1.1rem',
          fontWeight: 600,
          marginBottom: hasPnl || hasLocked ? '0.25rem' : 0,
        }}
      >
        {balance.total.toFixed(decimals)}
      </p>
      {hasLocked && (
        <p
          style={{
            fontSize: '0.75rem',
            color: '#9aa3c4',
            marginBottom: '0.15rem',
          }}
        >
          Locked: {balance.locked.toFixed(decimals)}
        </p>
      )}
      {hasPnl && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            marginTop: '0.15rem',
          }}
        >
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.15rem 0.35rem',
              background: balance.unrealizedPnl >= 0 ? '#9be28a' : '#ff7070',
              color: '#0a0e27',
              borderRadius: '4px',
              fontWeight: 700,
            }}
          >
            {balance.unrealizedPnl >= 0 ? '▲' : '▼'}{' '}
            {balance.unrealizedPnl >= 0 ? '+' : ''}
            {balance.unrealizedPnl.toFixed(2)}
          </span>
          <span style={{ fontSize: '0.7rem', color: '#9aa3c4' }}>
            USDT
            {balance.activePositions > 1 && ` (${balance.activePositions}x)`}
          </span>
        </div>
      )}
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

function PnLCalendar({ history }: { history: DailyHistory[] }) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [hoveredData, setHoveredData] = useState<DailyHistory | null>(null);

  // Group by month
  const months = new Map<string, DailyHistory[]>();
  const statsMap = new Map(history.map((h) => [h.trade_date, h]));

  // Get current and past months
  const today = new Date();
  for (let i = 2; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
      2,
      '0'
    )}`;
    months.set(key, []);
  }

  // Fill in dates
  history.forEach((h) => {
    const [year, month] = h.trade_date.split('-');
    const key = `${year}-${month}`;
    if (months.has(key)) {
      months.get(key)!.push(h);
    }
  });

  return (
    <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
      {Array.from(months.entries()).map(([monthKey, days]) => {
        const [year, month] = monthKey.split('-');
        const monthDate = new Date(parseInt(year), parseInt(month) - 1);
        const monthName = monthDate.toLocaleDateString('en-US', {
          month: 'long',
          year: 'numeric',
        });
        const firstDay = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth(),
          1
        );
        const lastDay = new Date(
          monthDate.getFullYear(),
          monthDate.getMonth() + 1,
          0
        );
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        return (
          <div key={monthKey} style={calendarMonth}>
            <h3
              style={{
                margin: '0 0 1rem 0',
                color: '#9aa3c4',
                fontSize: '1rem',
              }}
            >
              {monthName}
            </h3>
            <div style={calendarDaysHeader}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                <div key={day} style={calendarDayHeaderCell}>
                  {day}
                </div>
              ))}
            </div>
            <div style={calendarDaysGrid}>
              {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                <div key={`empty-${i}`} />
              ))}
              {Array.from({ length: daysInMonth }).map((_, i) => {
                const dayNum = i + 1;
                const dateStr = `${year}-${month}-${String(dayNum).padStart(
                  2,
                  '0'
                )}`;
                const dayData = statsMap.get(dateStr);
                const isToday = today.toISOString().split('T')[0] === dateStr;

                let bgColor = '#1a1f3a';
                let textColor = '#9aa3c4';

                if (dayData) {
                  if (dayData.total_pnl_usdt > 0) {
                    bgColor = '#1a3a2a';
                    textColor = '#9be28a';
                  } else if (dayData.total_pnl_usdt < 0) {
                    bgColor = '#3a1a2a';
                    textColor = '#ff7070';
                  }
                }

                return (
                  <div
                    key={dayNum}
                    style={{
                      ...calendarDayCell,
                      backgroundColor: isToday ? '#2a3f5f' : bgColor,
                      border: isToday
                        ? '2px solid #7ec8ff'
                        : '1px solid #232a4a',
                      cursor: dayData ? 'pointer' : 'default',
                    }}
                    onMouseEnter={() => {
                      if (dayData) {
                        setHoveredDate(dateStr);
                        setHoveredData(dayData);
                      }
                    }}
                    onMouseLeave={() => {
                      setHoveredDate(null);
                      setHoveredData(null);
                    }}
                  >
                    <span
                      style={{
                        color: textColor,
                        fontSize: '0.9rem',
                        fontWeight: 600,
                      }}
                    >
                      {dayNum}
                    </span>
                    {dayData && (
                      <span
                        style={{
                          color: textColor,
                          fontSize: '0.7rem',
                          marginTop: '0.2rem',
                        }}
                      >
                        {dayData.total_pnl_usdt > 0 ? '+' : ''}
                        {dayData.total_pnl_usdt.toFixed(0)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {hoveredData && (
        <div style={calendarTooltip}>
          <p
            style={{
              margin: '0 0 0.5rem 0',
              color: '#f3ba2f',
              fontWeight: 600,
            }}
          >
            {hoveredDate}
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: '#e6e9f5',
              fontSize: '0.85rem',
            }}
          >
            Trades: <strong>{hoveredData.total_trades}</strong>
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: '#e6e9f5',
              fontSize: '0.85rem',
            }}
          >
            Wins:{' '}
            <strong style={{ color: '#9be28a' }}>
              {hoveredData.winning_trades}
            </strong>{' '}
            / Losses:{' '}
            <strong style={{ color: '#ff7070' }}>
              {hoveredData.losing_trades}
            </strong>
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: '#e6e9f5',
              fontSize: '0.85rem',
            }}
          >
            Win Rate: <strong>{hoveredData.win_rate}%</strong>
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: hoveredData.total_pnl_usdt >= 0 ? '#9be28a' : '#ff7070',
              fontSize: '0.85rem',
              fontWeight: 600,
            }}
          >
            PnL: {hoveredData.total_pnl_usdt >= 0 ? '+' : ''}
            {hoveredData.total_pnl_usdt.toFixed(2)} USDT
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: '#9aa3c4',
              fontSize: '0.75rem',
            }}
          >
            Best: +{hoveredData.best_trade_usdt.toFixed(2)} USDT
          </p>
          <p
            style={{
              margin: '0.25rem 0',
              color: '#9aa3c4',
              fontSize: '0.75rem',
            }}
          >
            Worst: {hoveredData.worst_trade_usdt.toFixed(2)} USDT
          </p>
        </div>
      )}
    </div>
  );
}

const calendarMonth: CSSProperties = {
  padding: '1rem',
  background: '#151a33',
  border: '1px solid #232a4a',
  borderRadius: '12px',
  minWidth: '250px',
};

const calendarDaysHeader: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '0.3rem',
  marginBottom: '0.5rem',
};

const calendarDayHeaderCell: CSSProperties = {
  textAlign: 'center',
  color: '#9aa3c4',
  fontSize: '0.75rem',
  fontWeight: 600,
  padding: '0.5rem 0',
};

const calendarDaysGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '0.3rem',
};

const calendarDayCell: CSSProperties = {
  aspectRatio: '1',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.4rem',
  borderRadius: '8px',
  fontSize: '0.8rem',
  position: 'relative',
};

const calendarTooltip: CSSProperties = {
  position: 'fixed',
  bottom: '20px',
  right: '20px',
  background: '#232a4a',
  border: '1px solid #9aa3c4',
  borderRadius: '12px',
  padding: '1rem',
  minWidth: '280px',
  zIndex: 1000,
  boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
};
