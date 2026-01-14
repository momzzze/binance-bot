import { useEffect, useState, type CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { botService, type Position } from '../services/bot';

// File-based route definition for /positions
export const Route = createFileRoute('/positions')({
  component: Positions,
});

function Positions() {
  const [tab, setTab] = useState<'open' | 'closed'>('open');
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [editingStopLoss, setEditingStopLoss] = useState<string | null>(null);
  const [newStopLoss, setNewStopLoss] = useState<string>('');
  const [sortConfig, setSortConfig] = useState<{
    key: keyof Position | null;
    direction: 'asc' | 'desc';
  }>({ key: null, direction: 'asc' });

  const sortedPositions = () => {
    if (!sortConfig.key) return positions;

    return [...positions].sort((a, b) => {
      const aVal = a[sortConfig.key!];
      const bVal = b[sortConfig.key!];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      let comparison = 0;
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        comparison = aVal.localeCompare(bVal);
      } else if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      }

      return sortConfig.direction === 'asc' ? comparison : -comparison;
    });
  };

  const handleSort = (key: keyof Position) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIndicator = (key: keyof Position) => {
    if (sortConfig.key !== key) return ' ↕';
    return sortConfig.direction === 'asc' ? ' ▲' : ' ▼';
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res =
        tab === 'open'
          ? await botService.getPositions()
          : await botService.getClosedPositions({ limit: 100 });
      setPositions(res.positions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load positions');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async (positionId: string, symbol: string) => {
    if (!confirm(`Close position for ${symbol}?`)) {
      return;
    }

    setClosing(positionId);
    try {
      await botService.closePosition(positionId);
      await load(); // Reload positions
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close position');
    } finally {
      setClosing(null);
    }
  };

  const handleStopLossEdit = (
    positionId: string,
    currentStopLoss: number | null
  ) => {
    setEditingStopLoss(positionId);
    setNewStopLoss(currentStopLoss?.toFixed(4) ?? '');
  };

  const handleStopLossSave = async (positionId: string) => {
    const price = parseFloat(newStopLoss);
    if (isNaN(price) || price <= 0) {
      setError('Invalid stop loss price');
      return;
    }

    try {
      await botService.updateStopLoss(positionId, price);
      setEditingStopLoss(null);
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update stop loss'
      );
    }
  };

  const handleStopLossCancel = () => {
    setEditingStopLoss(null);
    setNewStopLoss('');
  };

  useEffect(() => {
    load();
  }, [tab]);

  return (
    <div className="positions">
      <h1>Positions</h1>
      {error && <p style={{ color: '#ff7070' }}>{error}</p>}

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <button
          onClick={() => setTab('open')}
          style={{
            ...tabButton,
            background: tab === 'open' ? '#f3ba2f' : '#232a4a',
            color: tab === 'open' ? '#0a0e27' : '#9aa3c4',
          }}
        >
          Open Positions
        </button>
        <button
          onClick={() => setTab('closed')}
          style={{
            ...tabButton,
            background: tab === 'closed' ? '#f3ba2f' : '#232a4a',
            color: tab === 'closed' ? '#0a0e27' : '#9aa3c4',
          }}
        >
          Closed Positions
        </button>
        <button
          onClick={load}
          disabled={loading}
          style={{
            background: '#7ec8ff',
            color: '#0a0e27',
            border: 'none',
            borderRadius: '8px',
            padding: '0.6rem 1rem',
            cursor: 'pointer',
            fontWeight: 600,
            marginLeft: 'auto',
          }}
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <p>Loading positions...</p>
      ) : positions.length === 0 ? (
        <p>No {tab} positions.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              background: '#11162c',
              border: '1px solid #232a4a',
            }}
          >
            <thead>
              <tr style={{ textAlign: 'left', color: '#9aa3c4' }}>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('symbol')}
                >
                  Symbol{getSortIndicator('symbol')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('side')}
                >
                  Side{getSortIndicator('side')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('entry_price')}
                >
                  Entry{getSortIndicator('entry_price')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('current_price')}
                >
                  Current{getSortIndicator('current_price')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('stop_loss_price')}
                >
                  Stop Loss{getSortIndicator('stop_loss_price')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('take_profit_price')}
                >
                  Take Profit{getSortIndicator('take_profit_price')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('quantity')}
                >
                  Qty{getSortIndicator('quantity')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('pnl_usdt')}
                >
                  PnL (USDT){getSortIndicator('pnl_usdt')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('pnl_percent')}
                >
                  PnL %{getSortIndicator('pnl_percent')}
                </th>
                <th
                  style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                  onClick={() => handleSort('status')}
                >
                  Status{getSortIndicator('status')}
                </th>
                {tab === 'open' && <th style={th}>Actions</th>}
                {tab === 'closed' && (
                  <th
                    style={{ ...th, cursor: 'pointer', userSelect: 'none' }}
                    onClick={() => handleSort('closed_at')}
                  >
                    Closed At{getSortIndicator('closed_at')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedPositions().map((p) => (
                <tr key={p.id} style={{ borderTop: '1px solid #232a4a' }}>
                  <td style={td}>{p.symbol}</td>
                  <td style={td}>{p.side}</td>
                  <td style={td}>{p.entry_price.toFixed(4)}</td>
                  <td style={td}>{p.current_price.toFixed(4)}</td>
                  <td style={td}>
                    {tab === 'open' && editingStopLoss === p.id ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.3rem',
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="number"
                          step="0.0001"
                          value={newStopLoss}
                          onChange={(e) => setNewStopLoss(e.target.value)}
                          style={{
                            width: '90px',
                            padding: '0.3rem',
                            background: '#232a4a',
                            border: '1px solid #9aa3c4',
                            color: '#e6e9f5',
                            borderRadius: '4px',
                            fontSize: '0.9rem',
                          }}
                        />
                        <button
                          onClick={() => handleStopLossSave(p.id)}
                          style={{
                            background: '#9be28a',
                            color: '#0a0e27',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '0.3rem 0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                          }}
                        >
                          ✓
                        </button>
                        <button
                          onClick={handleStopLossCancel}
                          style={{
                            background: '#ff7070',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '0.3rem 0.5rem',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    ) : p.stop_loss_price ? (
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ color: '#ff7070' }}>
                          {p.stop_loss_price.toFixed(4)}
                        </span>
                        {tab === 'open' && (
                          <button
                            onClick={() =>
                              handleStopLossEdit(
                                p.id,
                                p.stop_loss_price ?? null
                              )
                            }
                            style={{
                              background: 'transparent',
                              color: '#7ec8ff',
                              border: 'none',
                              cursor: 'pointer',
                              fontSize: '0.85rem',
                              padding: '0.2rem 0.4rem',
                            }}
                            title="Edit stop loss"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={td}>
                    {p.take_profit_price ? (
                      <span style={{ color: '#9be28a' }}>
                        {p.take_profit_price.toFixed(4)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={td}>{p.quantity}</td>
                  <td style={td}>
                    <span
                      style={{ color: p.pnl_usdt >= 0 ? '#9be28a' : '#ff7070' }}
                    >
                      {p.pnl_usdt.toFixed(2)}
                    </span>
                  </td>
                  <td style={td}>
                    <span
                      style={{
                        color: p.pnl_percent >= 0 ? '#9be28a' : '#ff7070',
                      }}
                    >
                      {p.pnl_percent.toFixed(2)}%
                    </span>
                  </td>
                  <td style={td}>{p.status}</td>
                  {tab === 'open' && (
                    <td style={td}>
                      <button
                        onClick={() => handleClose(p.id, p.symbol)}
                        disabled={closing === p.id}
                        style={{
                          background: '#ff7070',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '6px',
                          padding: '0.4rem 0.8rem',
                          cursor: closing === p.id ? 'not-allowed' : 'pointer',
                          fontWeight: 600,
                          fontSize: '0.85rem',
                          opacity: closing === p.id ? 0.5 : 1,
                        }}
                      >
                        {closing === p.id ? 'Closing...' : 'Close'}
                      </button>
                    </td>
                  )}
                  {tab === 'closed' && (
                    <td style={td}>
                      {p.closed_at
                        ? new Date(p.closed_at).toLocaleString()
                        : '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const tabButton: CSSProperties = {
  border: 'none',
  borderRadius: '8px',
  padding: '0.6rem 1.25rem',
  cursor: 'pointer',
  fontWeight: 600,
  transition: 'all 0.2s',
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
