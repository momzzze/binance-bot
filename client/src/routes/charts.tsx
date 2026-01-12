import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { CandleChart } from '../components/CandleChart/CandleChart';
import { candleService, type Candle } from '../services/candles';

export const Route = createFileRoute('/charts')({
  component: ChartsComponent,
});

function ChartsComponent() {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [interval, setInterval] = useState('5m');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCandles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await candleService.getCandles(symbol, interval, 300);
      setCandles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load candles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCandles();
  }, []);

  const handleLoadChart = (e: React.FormEvent) => {
    e.preventDefault();
    loadCandles();
  };

  return (
    <div style={{ padding: '2rem' }}>
      <h1>Market Charts</h1>

      <form
        onSubmit={handleLoadChart}
        style={{
          background: '#151a33',
          border: '1px solid #232a4a',
          borderRadius: '12px',
          padding: '1.5rem',
          marginBottom: '2rem',
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto auto auto 1fr',
            gap: '1rem',
            alignItems: 'end',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                color: '#9aa3c4',
                marginBottom: '0.5rem',
                fontSize: '0.9rem',
              }}
            >
              Symbol
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="BTCUSDT"
              style={{
                background: '#0a0e27',
                border: '1px solid #232a4a',
                borderRadius: '6px',
                padding: '0.75rem',
                color: '#f3ba2f',
                fontSize: '1rem',
              }}
            />
          </div>

          <div>
            <label
              style={{
                display: 'block',
                color: '#9aa3c4',
                marginBottom: '0.5rem',
                fontSize: '0.9rem',
              }}
            >
              Interval
            </label>
            <select
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              style={{
                background: '#0a0e27',
                border: '1px solid #232a4a',
                borderRadius: '6px',
                padding: '0.75rem',
                color: '#f3ba2f',
                fontSize: '1rem',
              }}
            >
              <option value="1m">1 Minute</option>
              <option value="5m">5 Minutes</option>
              <option value="15m">15 Minutes</option>
              <option value="1h">1 Hour</option>
              <option value="4h">4 Hours</option>
              <option value="1d">1 Day</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              background: '#7ec8ff',
              color: '#0a0e27',
              border: 'none',
              borderRadius: '6px',
              padding: '0.75rem 1.25rem',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {loading ? 'Loading...' : 'Load Chart'}
          </button>

          <div style={{ textAlign: 'right' }}>
            {error && <p style={{ color: '#ff7070', margin: 0 }}>{error}</p>}
          </div>
        </div>
      </form>

      {candles.length > 0 && (
        <CandleChart symbol={symbol} candles={candles} interval={interval} />
      )}

      {!loading && candles.length === 0 && !error && (
        <div
          style={{
            textAlign: 'center',
            padding: '2rem',
            color: '#9aa3c4',
          }}
        >
          Load a chart to get started
        </div>
      )}
    </div>
  );
}
