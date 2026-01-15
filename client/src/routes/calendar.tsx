import { useEffect, useState, type CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { botService, type DailyHistory } from '../services/bot';

// File-based route definition for /calendar
export const Route = createFileRoute('/calendar')({
  component: Calendar,
});

function Calendar() {
  const [historyStats, setHistoryStats] = useState<DailyHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<DailyHistory | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await botService.getStatsHistory(365);
      console.log('====================================');
      console.log(res);
      console.log('====================================');
      setHistoryStats(res.history || []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to load calendar data'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  // Normalize dates and coerce numerics to numbers; prefer USDC aliases if provided
  const normalizedHistory = historyStats.map((h) => ({
    ...h,
    trade_date: h.trade_date, // Already YYYY-MM-DD format from API
    total_trades: Number(h.total_trades),
    winning_trades: Number(h.winning_trades),
    losing_trades: Number(h.losing_trades),
    win_rate: Number(h.win_rate),
    total_pnl_usdt: Number(h.total_pnl_usdt),
    total_commission_usdt: Number(h.total_commission_usdt),
    net_pnl_usdt: Number(h.net_pnl_usdt),
    avg_pnl_percent: Number(h.avg_pnl_percent),
    best_trade_usdt: Number(h.best_trade_usdt),
    worst_trade_usdt: Number(h.worst_trade_usdt),
    total_pnl_usdc: Number((h as any).total_pnl_usdc ?? h.total_pnl_usdt),
    total_commission_usdc: Number(
      (h as any).total_commission_usdc ?? h.total_commission_usdt
    ),
    net_pnl_usdc: Number((h as any).net_pnl_usdc ?? h.net_pnl_usdt),
    best_trade_usdc: Number((h as any).best_trade_usdc ?? h.best_trade_usdt),
    worst_trade_usdc: Number((h as any).worst_trade_usdc ?? h.worst_trade_usdt),
  }));

  const statsMap = new Map(normalizedHistory.map((h) => [h.trade_date, h]));

  const monthDate = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth(),
    1
  );
  const monthName = monthDate.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
  const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
  const lastDay = new Date(
    monthDate.getFullYear(),
    monthDate.getMonth() + 1,
    0
  );
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const goToPreviousMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1)
    );
  };

  const goToNextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1)
    );
  };

  const goToToday = () => {
    setCurrentMonth(new Date());
  };

  // Calculate monthly totals
  const year = currentMonth.getFullYear();
  const month = String(currentMonth.getMonth() + 1).padStart(2, '0');
  const monthDays = Array.from({ length: daysInMonth }).map((_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const monthStats = monthDays
    .map((date) => statsMap.get(date))
    .filter((stat): stat is DailyHistory => !!stat);

  const monthTotals = {
    trades: monthStats.reduce((sum, s) => sum + s.total_trades, 0),
    wins: monthStats.reduce((sum, s) => sum + s.winning_trades, 0),
    losses: monthStats.reduce((sum, s) => sum + s.losing_trades, 0),
    pnl: monthStats.reduce(
      (sum, s) => sum + (s.total_pnl_usdc ?? s.total_pnl_usdt),
      0
    ),
    winRate:
      monthStats.length > 0
        ? (
            (monthStats.reduce((sum, s) => sum + s.winning_trades, 0) /
              monthStats.reduce((sum, s) => sum + s.total_trades, 0)) *
            100
          ).toFixed(2)
        : '0',
  };

  return (
    <div className="calendar-page" style={pageContainer}>
      <h1>Performance Calendar</h1>

      {error && <p style={{ color: '#ff7070' }}>{error}</p>}

      <div style={mainContainer}>
        {/* Left: Big Calendar */}
        <div style={calendarSection}>
          <div style={controlsContainer}>
            <button
              onClick={goToPreviousMonth}
              style={{ ...navButton, marginRight: '0.5rem' }}
            >
              ← Previous
            </button>
            <button onClick={goToToday} style={navButton}>
              Today
            </button>
            <button
              onClick={goToNextMonth}
              style={{ ...navButton, marginLeft: '0.5rem' }}
            >
              Next →
            </button>
            <button
              onClick={load}
              disabled={loading}
              style={{
                ...navButton,
                marginLeft: 'auto',
                background: '#7ec8ff',
                color: '#0a0e27',
              }}
            >
              {loading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          <div style={monthHeader}>
            <h2 style={{ margin: 0, color: '#f3ba2f' }}>{monthName}</h2>
          </div>

          <div style={monthStatsBar}>
            <StatBox label="Trades" value={monthTotals.trades} />
            <StatBox label="Wins" value={monthTotals.wins} color="#9be28a" />
            <StatBox
              label="Losses"
              value={monthTotals.losses}
              color="#ff7070"
            />
            <StatBox
              label="Win Rate"
              value={`${monthTotals.winRate}%`}
              color={
                parseFloat(monthTotals.winRate) >= 50 ? '#9be28a' : '#ff7070'
              }
            />
            <StatBox
              label="Monthly PnL"
              value={`${
                monthTotals.pnl >= 0 ? '+' : ''
              }${monthTotals.pnl.toFixed(2)}`}
              color={monthTotals.pnl >= 0 ? '#9be28a' : '#ff7070'}
            />
          </div>

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
              const isToday =
                new Date().toISOString().split('T')[0] === dateStr;

              let bgColor = '#1a1f3a';
              let borderColor = '#232a4a';
              let textColor = '#9aa3c4';

              const pnlValue = dayData
                ? dayData.total_pnl_usdc ?? dayData.total_pnl_usdt
                : 0;

              if (dayData) {
                if (pnlValue > 0) {
                  bgColor = '#1a3a2a';
                  borderColor = '#2d5a3d';
                  textColor = '#9be28a';
                } else if (pnlValue < 0) {
                  bgColor = '#3a1a2a';
                  borderColor = '#5a2d3d';
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
                      : dayData
                      ? `2px solid ${borderColor}`
                      : '1px solid #232a4a',
                    cursor: dayData ? 'pointer' : 'default',
                  }}
                  onClick={() => {
                    if (dayData) setSelectedDate(dayData);
                  }}
                >
                  <span
                    style={{
                      color: dayData ? textColor : '#9aa3c4',
                      fontSize: '0.6rem',
                      fontWeight: 700,
                    }}
                  >
                    {dayNum}
                  </span>
                  {dayData && (
                    <>
                      <span
                        style={{
                          color: textColor,
                          fontSize: '0.65rem',
                          marginTop: '0.2rem',
                        }}
                      >
                        {pnlValue > 0 ? '+' : ''}
                        {pnlValue.toFixed(0)}
                      </span>
                      <span
                        style={{
                          color: textColor,
                          fontSize: '0.55rem',
                          marginTop: '0.1rem',
                        }}
                      >
                        {dayData.total_trades} trades
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Day Details */}
        {selectedDate && (
          <div style={detailsSection}>
            <h2 style={{ margin: '0 0 1rem 0', color: '#f3ba2f' }}>
              {new Date(selectedDate.trade_date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </h2>

            <div style={detailsGrid}>
              <DetailCard
                label="Total Trades"
                value={selectedDate.total_trades}
              />
              <DetailCard
                label="Winning Trades"
                value={selectedDate.winning_trades}
                color="#9be28a"
              />
              <DetailCard
                label="Losing Trades"
                value={selectedDate.losing_trades}
                color="#ff7070"
              />
              <DetailCard
                label="Win Rate"
                value={`${selectedDate.win_rate}%`}
                color={
                  parseFloat(selectedDate.win_rate as string) >= 50
                    ? '#9be28a'
                    : '#ff7070'
                }
              />

              <DetailCard
                label="Total PnL"
                value={`${
                  (selectedDate.total_pnl_usdc ??
                    selectedDate.total_pnl_usdt) >= 0
                    ? '+'
                    : ''
                }${(
                  selectedDate.total_pnl_usdc ?? selectedDate.total_pnl_usdt
                ).toFixed(2)} USDC`}
                color={
                  (selectedDate.total_pnl_usdc ??
                    selectedDate.total_pnl_usdt) >= 0
                    ? '#9be28a'
                    : '#ff7070'
                }
                fullWidth
              />
              <DetailCard
                label="Commission"
                value={`${(
                  selectedDate.total_commission_usdc ??
                  selectedDate.total_commission_usdt
                ).toFixed(2)} USDC`}
                color="#7ec8ff"
                fullWidth
              />
              <DetailCard
                label="Net PnL"
                value={`${
                  (selectedDate.net_pnl_usdc ?? selectedDate.net_pnl_usdt) >= 0
                    ? '+'
                    : ''
                }${(
                  selectedDate.net_pnl_usdc ?? selectedDate.net_pnl_usdt
                ).toFixed(2)} USDC`}
                color={
                  (selectedDate.net_pnl_usdc ?? selectedDate.net_pnl_usdt) >= 0
                    ? '#9be28a'
                    : '#ff7070'
                }
                fullWidth
              />

              <DetailCard
                label="Best Trade"
                value={`+${(
                  selectedDate.best_trade_usdc ?? selectedDate.best_trade_usdt
                ).toFixed(2)} USDC`}
                color="#9be28a"
                fullWidth
              />
              <DetailCard
                label="Worst Trade"
                value={`${(
                  selectedDate.worst_trade_usdc ?? selectedDate.worst_trade_usdt
                ).toFixed(2)} USDC`}
                color="#ff7070"
                fullWidth
              />
              <DetailCard
                label="Avg PnL %"
                value={`${selectedDate.avg_pnl_percent.toFixed(2)}%`}
                color={
                  selectedDate.avg_pnl_percent >= 0 ? '#9be28a' : '#ff7070'
                }
                fullWidth
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div style={statBoxStyle}>
      <p
        style={{
          color: '#9aa3c4',
          fontSize: '0.7rem',
          margin: '0 0 0.2rem 0',
        }}
      >
        {label}
      </p>
      <p
        style={{
          color: color || '#f3ba2f',
          fontSize: '1rem',
          fontWeight: 700,
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

function DetailCard({
  label,
  value,
  color,
  fullWidth,
}: {
  label: string;
  value: string | number;
  color?: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      style={{ ...detailCardStyle, gridColumn: fullWidth ? '1 / -1' : 'auto' }}
    >
      <p
        style={{
          color: '#9aa3c4',
          fontSize: '0.85rem',
          margin: '0 0 0.4rem 0',
        }}
      >
        {label}
      </p>
      <p
        style={{
          color: color || '#f3ba2f',
          fontSize: '1.2rem',
          fontWeight: 600,
          margin: 0,
        }}
      >
        {value}
      </p>
    </div>
  );
}

const pageContainer: CSSProperties = {
  padding: '1rem 1.25rem 1rem 1.25rem',
  background: '#0a0e27',
  color: '#e6e9f5',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const controlsContainer: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginBottom: '0.75rem',
  alignItems: 'center',
  flexShrink: 0,
};

const navButton: CSSProperties = {
  background: '#232a4a',
  color: '#9aa3c4',
  border: 'none',
  borderRadius: '8px',
  padding: '0.5rem 1rem',
  cursor: 'pointer',
  fontWeight: 600,
  transition: 'all 0.2s',
  fontSize: '0.9rem',
};

const mainContainer: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 320px',
  gap: '1rem',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  marginTop: '0.5rem',
};

const calendarSection: CSSProperties = {
  background: '#151a33',
  border: '1px solid #232a4a',
  borderRadius: '12px',
  padding: '0.45rem',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
};

const monthHeader: CSSProperties = {
  marginBottom: '0.3rem',
  flexShrink: 0,
};

const monthStatsBar: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, 1fr)',
  gap: '0.4rem',
  marginBottom: '0.7rem',
  flexShrink: 0,
};

const statBoxStyle: CSSProperties = {
  background: '#1a1f3a',
  border: '1px solid #232a4a',
  borderRadius: '6px',
  padding: '0.35rem',
  textAlign: 'center',
};

const calendarDaysHeader: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '0.3rem',
  marginBottom: '0.4rem',
  flexShrink: 0,
};

const calendarDayHeaderCell: CSSProperties = {
  textAlign: 'center',
  color: '#9aa3c4',
  fontSize: '0.65rem',
  fontWeight: 600,
  padding: '0.2rem 0',
};

const calendarDaysGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, 1fr)',
  gap: '0.3rem',
  overflowY: 'auto',
  overflowX: 'hidden',
};

const calendarDayCell: CSSProperties = {
  height: '110px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '0.25rem',
  borderRadius: '6px',
  fontSize: '0.7rem',
  position: 'relative',
  transition: 'all 0.2s',
};

const detailsSection: CSSProperties = {
  background: '#151a33',
  border: '1px solid #232a4a',
  borderRadius: '12px',
  padding: '1rem',
  overflowY: 'auto',
  minHeight: 0,
};

const detailsGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '0.75rem',
};

const detailCardStyle: CSSProperties = {
  background: '#1a1f3a',
  border: '1px solid #232a4a',
  borderRadius: '8px',
  padding: '0.6rem',
};
