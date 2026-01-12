import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { tradesService, type Trade, type TradeStats } from '../services/trades';

// File-based route definition for /trades
export const Route = createFileRoute('/trades')({
  component: Trades,
});

type Params = { symbol: string; side: string; limit: number; offset: number };
function Trades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [params, setParams] = useState<Params>({
    symbol: '',
    side: '',
    limit: 25,
    offset: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [total, setTotal] = useState(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tradesRes, statsRes] = await Promise.all([
        tradesService.getTrades({
          symbol: params.symbol || undefined,
          side: params.side || undefined,
          limit: params.limit,
          offset: params.offset,
        }),
        tradesService.getStats(params.symbol || undefined),
      ]);
      setTrades(tradesRes.trades);
      setTotal(tradesRes.total);
      setStats(statsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trades');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [params.symbol, params.side, params.limit, params.offset]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / params.limit)),
    [total, params.limit]
  );
  const currentPage = useMemo(
    () => Math.floor(params.offset / params.limit) + 1,
    [params.offset, params.limit]
  );

  return (
    <div className="trades">
      <h1>Trades</h1>
      {error && <p style={{ color: '#ff7070' }}>{error}</p>}

      <FilterBar params={params} setParams={setParams} loading={loading} />

      {stats && <StatsCards stats={stats} />}

      {loading ? (
        <p>Loading trades...</p>
      ) : trades.length === 0 ? (
        <p>No trades found.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={table}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#9aa3c4' }}>
                <th style={th}>Time</th>
                <th style={th}>Symbol</th>
                <th style={th}>Side</th>
                <th style={th}>Type</th>
                <th style={th}>Qty</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.id} style={{ borderTop: '1px solid #232a4a' }}>
                  <td style={td}>{new Date(t.created_at).toLocaleString()}</td>
                  <td style={td}>{t.symbol}</td>
                  <td style={td}>{t.side}</td>
                  <td style={td}>{t.type}</td>
                  <td style={td}>{t.qty}</td>
                  <td style={td}>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        disabled={loading}
        onPrev={() =>
          setParams((p) => ({ ...p, offset: Math.max(0, p.offset - p.limit) }))
        }
        onNext={() => setParams((p) => ({ ...p, offset: p.offset + p.limit }))}
      />
    </div>
  );
}

function FilterBar({
  params,
  setParams,
  loading,
}: {
  params: { symbol: string; side: string; limit: number; offset: number };
  setParams: React.Dispatch<
    React.SetStateAction<{
      symbol: string;
      side: string;
      limit: number;
      offset: number;
    }>
  >;
  loading: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.75rem',
        marginBottom: '1rem',
        flexWrap: 'wrap',
      }}
    >
      <input
        placeholder="Symbol (e.g. BTCUSDT)"
        value={params.symbol}
        onChange={(e) =>
          setParams((p) => ({
            ...p,
            symbol: e.target.value.toUpperCase(),
            offset: 0,
          }))
        }
        style={input}
      />
      <select
        value={params.side}
        onChange={(e) =>
          setParams((p) => ({ ...p, side: e.target.value, offset: 0 }))
        }
        style={input}
      >
        <option value="">All sides</option>
        <option value="BUY">BUY</option>
        <option value="SELL">SELL</option>
      </select>
      <select
        value={params.limit}
        onChange={(e) =>
          setParams((p) => ({ ...p, limit: Number(e.target.value), offset: 0 }))
        }
        style={input}
      >
        {[10, 25, 50, 100].map((n) => (
          <option key={n} value={n}>
            {n} per page
          </option>
        ))}
      </select>
      <button
        onClick={() => setParams((p) => ({ ...p, offset: 0 }))}
        disabled={loading}
        style={button('#7ec8ff')}
      >
        Refresh
      </button>
    </div>
  );
}

function StatsCards({ stats }: { stats: TradeStats }) {
  const items: { label: string; value: string }[] = [
    { label: 'Total Orders', value: String(stats.total_orders ?? 0) },
    { label: 'Buys', value: String(stats.buy_orders ?? 0) },
    { label: 'Sells', value: String(stats.sell_orders ?? 0) },
    { label: 'Filled', value: String(stats.filled_count ?? 0) },
    { label: 'Canceled', value: String(stats.canceled_count ?? 0) },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: '0.75rem',
        marginBottom: '1rem',
      }}
    >
      {items.map((item) => (
        <div key={item.label} style={card}>
          <p style={{ color: '#9aa3c4', marginBottom: '0.35rem' }}>
            {item.label}
          </p>
          <p style={{ color: '#f3ba2f', fontSize: '1.1rem', fontWeight: 600 }}>
            {item.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onPrev,
  onNext,
  disabled,
}: {
  currentPage: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        marginTop: '1rem',
      }}
    >
      <button
        onClick={onPrev}
        disabled={disabled || currentPage <= 1}
        style={button('#7ec8ff')}
      >
        Prev
      </button>
      <span style={{ color: '#9aa3c4' }}>
        Page {currentPage} / {totalPages}
      </span>
      <button
        onClick={onNext}
        disabled={disabled || currentPage >= totalPages}
        style={button('#7ec8ff')}
      >
        Next
      </button>
    </div>
  );
}

const card: CSSProperties = {
  background: '#151a33',
  border: '1px solid #232a4a',
  borderRadius: '12px',
  padding: '0.85rem',
};

const table: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  background: '#11162c',
  border: '1px solid #232a4a',
};

const th: CSSProperties = {
  padding: '0.75rem',
  fontWeight: 600,
  fontSize: '0.9rem',
};

const td: CSSProperties = {
  padding: '0.75rem',
  color: '#e6e9f5',
  fontSize: '0.95rem',
};

const input: CSSProperties = {
  padding: '0.6rem 0.75rem',
  borderRadius: '8px',
  border: '1px solid #232a4a',
  background: '#0f1429',
  color: '#e6e9f5',
  minWidth: '160px',
};

const button = (bg: string): CSSProperties => ({
  background: bg,
  color: '#0a0e27',
  border: 'none',
  borderRadius: '8px',
  padding: '0.6rem 1rem',
  cursor: 'pointer',
  fontWeight: 600,
});
