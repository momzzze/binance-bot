import { useEffect, useState, type CSSProperties } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { botService, type BotStatus } from '../services/bot';
import { strategyService, type StrategyConfig } from '../services/strategy';

// File-based route definition for /settings
export const Route = createFileRoute('/settings')({
  component: Settings,
});

function Settings() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [strategy, setStrategy] = useState<StrategyConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await botService.getStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  const loadStrategy = async () => {
    try {
      const data = await strategyService.getActive();
      setStrategy(data);
    } catch (err) {
      console.error('Failed to load strategy:', err);
    }
  };

  const handleStrategyUpdate = async (updates: Partial<StrategyConfig>) => {
    if (!strategy) return;

    setLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const updated = await strategyService.update(strategy.strategy_name, {
        sma_short_period: updates.sma_short_period,
        sma_long_period: updates.sma_long_period,
        ema_short_period: updates.ema_short_period,
        ema_long_period: updates.ema_long_period,
        rsi_period: updates.rsi_period,
        rsi_overbought: updates.rsi_overbought,
        rsi_oversold: updates.rsi_oversold,
        stop_loss_percent: updates.stop_loss_percent
          ? parseFloat(updates.stop_loss_percent)
          : undefined,
        take_profit_percent: updates.take_profit_percent
          ? parseFloat(updates.take_profit_percent)
          : undefined,
        trailing_stop_enabled: updates.trailing_stop_enabled,
        trailing_stop_activation_percent:
          updates.trailing_stop_activation_percent
            ? parseFloat(updates.trailing_stop_activation_percent)
            : undefined,
        trailing_stop_distance_percent: updates.trailing_stop_distance_percent
          ? parseFloat(updates.trailing_stop_distance_percent)
          : undefined,
        risk_per_trade_percent: updates.risk_per_trade_percent
          ? parseFloat(updates.risk_per_trade_percent)
          : undefined,
      });
      setStrategy(updated);
      setActionMessage('Strategy updated successfully!');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to update strategy'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (action: 'start' | 'stop') => {
    setLoading(true);
    setError(null);
    setActionMessage(null);
    try {
      const res =
        action === 'start' ? await botService.start() : await botService.stop();
      setActionMessage(res.message);
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
    loadStrategy();
  }, []);

  return (
    <div className="settings">
      <h1>Bot Control</h1>
      {error && <p style={{ color: '#ff7070' }}>{error}</p>}
      {actionMessage && <p style={{ color: '#9be28a' }}>{actionMessage}</p>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '1rem',
          marginBottom: '1.5rem',
        }}
      >
        <StatusCard title="Running" value={status?.running ? 'Yes' : 'No'} />
        <StatusCard
          title="Trading Enabled"
          value={status?.tradingEnabled ? 'Yes' : 'No'}
        />
        <StatusCard
          title="Kill Switch"
          value={status?.killSwitch ? 'On' : 'Off'}
        />
        <StatusCard
          title="Symbols"
          value={status?.symbols?.join(', ') || '—'}
        />
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={() => handleAction('start')}
          disabled={loading || status?.running}
          style={buttonStyle('#9be28a')}
        >
          Start Bot
        </button>
        <button
          onClick={() => handleAction('stop')}
          disabled={loading || !status?.running}
          style={buttonStyle('#ff9b73')}
        >
          Stop Bot
        </button>
        <button
          onClick={loadStatus}
          disabled={loading}
          style={buttonStyle('#7ec8ff')}
        >
          Refresh
        </button>
      </div>

      {strategy && (
        <StrategySettings
          strategy={strategy}
          onUpdate={handleStrategyUpdate}
          loading={loading}
        />
      )}
    </div>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        background: '#151a33',
        border: '1px solid #232a4a',
        borderRadius: '12px',
        padding: '1rem',
      }}
    >
      <p style={{ color: '#9aa3c4', marginBottom: '0.5rem' }}>{title}</p>
      <p style={{ color: '#f3ba2f', fontSize: '1.1rem', fontWeight: 600 }}>
        {value}
      </p>
    </div>
  );
}

function StrategySettings({
  strategy,
  onUpdate,
  loading,
}: {
  strategy: StrategyConfig;
  onUpdate: (updates: Partial<StrategyConfig>) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState(strategy);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(form);
  };

  const handleChange = (field: keyof StrategyConfig, value: any) => {
    setForm({ ...form, [field]: value });
  };

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Strategy Configuration</h2>
      <form onSubmit={handleSubmit}>
        <div
          style={{
            background: '#151a33',
            border: '1px solid #232a4a',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ color: '#f3ba2f', marginBottom: '1rem' }}>Indicators</h3>
          <div style={gridStyle}>
            <InputField
              label="SMA Short Period"
              value={form.sma_short_period}
              onChange={(v) => handleChange('sma_short_period', parseInt(v))}
              type="number"
              helper="Number of candles for short-term moving average (20 = 20 candles). Detects fast trend changes."
            />
            <InputField
              label="SMA Long Period"
              value={form.sma_long_period}
              onChange={(v) => handleChange('sma_long_period', parseInt(v))}
              type="number"
              helper="Number of candles for long-term moving average (50 = 50 candles). Shows overall trend direction."
            />
            <InputField
              label="EMA Short Period"
              value={form.ema_short_period}
              onChange={(v) => handleChange('ema_short_period', parseInt(v))}
              type="number"
              helper="Exponential moving average (fast). Weights recent prices more. Good for detecting momentum."
            />
            <InputField
              label="EMA Long Period"
              value={form.ema_long_period}
              onChange={(v) => handleChange('ema_long_period', parseInt(v))}
              type="number"
              helper="Exponential moving average (slow). Confirms trend strength and validates EMA short crossovers."
            />
            <InputField
              label="RSI Period"
              value={form.rsi_period}
              onChange={(v) => handleChange('rsi_period', parseInt(v))}
              type="number"
              helper="Relative Strength Index period. Default 14 candles. Measures momentum intensity (0-100)."
            />
            <InputField
              label="RSI Overbought"
              value={form.rsi_overbought}
              onChange={(v) => handleChange('rsi_overbought', parseInt(v))}
              type="number"
              helper="RSI above this = overextended/may pullback. Default 70. Avoids buying at local peaks."
            />
            <InputField
              label="RSI Oversold"
              value={form.rsi_oversold}
              onChange={(v) => handleChange('rsi_oversold', parseInt(v))}
              type="number"
              helper="RSI below this = oversold/may bounce. Default 30. Good entry zones for bounces."
            />
          </div>
        </div>

        <div
          style={{
            background: '#151a33',
            border: '1px solid #232a4a',
            borderRadius: '12px',
            padding: '1.5rem',
            marginBottom: '1rem',
          }}
        >
          <h3 style={{ color: '#f3ba2f', marginBottom: '1rem' }}>
            Risk Management
          </h3>
          <div style={gridStyle}>
            <InputField
              label="Stop Loss %"
              value={form.stop_loss_percent}
              onChange={(v) => handleChange('stop_loss_percent', v)}
              type="number"
              step="0.1"
              helper="Max loss allowed per trade. Recommended 3-4%. Prevents catastrophic losses. Currently too tight at 2%."
            />
            <InputField
              label="Take Profit %"
              value={form.take_profit_percent}
              onChange={(v) => handleChange('take_profit_percent', v)}
              type="number"
              step="0.1"
              helper="Target profit per trade. Recommended 4-5%. Lower = more achievable. Current 8% too ambitious."
            />
            <InputField
              label="Risk Per Trade %"
              value={form.risk_per_trade_percent}
              onChange={(v) => handleChange('risk_per_trade_percent', v)}
              type="number"
              step="0.1"
              helper="% of balance to risk per trade. Recommended 2-3%. Protects capital for multiple trades."
            />
            <InputField
              label="Trailing Stop Activation %"
              value={form.trailing_stop_activation_percent}
              onChange={(v) =>
                handleChange('trailing_stop_activation_percent', v)
              }
              type="number"
              step="0.1"
              helper="Profit % needed to activate trailing stop. Recommended 3%. Locks in gains as price rises."
            />
            <InputField
              label="Trailing Stop Distance %"
              value={form.trailing_stop_distance_percent}
              onChange={(v) =>
                handleChange('trailing_stop_distance_percent', v)
              }
              type="number"
              step="0.1"
              helper="Distance to keep below highest price. Recommended 2-3%. Avoids tight stops getting clipped."
            />
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                position: 'relative',
              }}
            >
              <input
                type="checkbox"
                checked={form.trailing_stop_enabled}
                onChange={(e) =>
                  handleChange('trailing_stop_enabled', e.target.checked)
                }
                style={{ width: '20px', height: '20px' }}
              />
              <label style={{ color: '#9aa3c4' }}>Trailing Stop Enabled</label>
              <span
                style={{
                  display: 'inline-block',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  background: '#232a4a',
                  color: '#7ec8ff',
                  textAlign: 'center',
                  lineHeight: '18px',
                  fontSize: '12px',
                  cursor: 'help',
                  fontWeight: 'bold',
                }}
                title="Automatically moves stop loss up as price rises. Locks in profits without capping upside."
              >
                ?
              </span>
            </div>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          style={{
            ...buttonStyle('#9be28a'),
            fontSize: '1rem',
            padding: '0.875rem 2rem',
          }}
        >
          {loading ? 'Saving...' : 'Save Strategy Settings'}
        </button>
      </form>
    </div>
  );
}

function InputField({
  label,
  value,
  onChange,
  type = 'text',
  step,
  helper,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  step?: string;
  helper?: string;
}) {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <label
          style={{
            color: '#9aa3c4',
            fontSize: '0.9rem',
          }}
        >
          {label}
        </label>
        {helper && (
          <span
            style={{
              display: 'inline-block',
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              background: '#232a4a',
              color: '#7ec8ff',
              textAlign: 'center',
              lineHeight: '18px',
              fontSize: '12px',
              cursor: 'help',
              fontWeight: 'bold',
            }}
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            title={helper}
          >
            ?
          </span>
        )}
      </div>
      {showTooltip && helper && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 0,
            background: '#232a4a',
            color: '#9aa3c4',
            padding: '0.75rem',
            borderRadius: '6px',
            fontSize: '0.85rem',
            zIndex: 1000,
            marginBottom: '0.5rem',
            minWidth: '200px',
            border: '1px solid #7ec8ff',
            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          }}
        >
          {helper}
        </div>
      )}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        style={{
          width: '100%',
          background: '#0a0e27',
          border: '1px solid #232a4a',
          borderRadius: '6px',
          padding: '0.75rem',
          color: '#f3ba2f',
          fontSize: '1rem',
        }}
      />
    </div>
  );
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
  gap: '1rem',
};

const buttonStyle = (bg: string): CSSProperties => ({
  background: bg,
  color: '#0a0e27',
  border: 'none',
  borderRadius: '8px',
  padding: '0.75rem 1.25rem',
  cursor: 'pointer',
  fontWeight: 600,
});
