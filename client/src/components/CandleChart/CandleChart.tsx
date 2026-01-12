import { useEffect, useRef } from 'react';
import { createChart } from 'lightweight-charts';
import type { Candle } from '../../services/candles';

interface CandleChartProps {
  symbol: string;
  candles: Candle[];
  interval: string;
}

export function CandleChart({ symbol, candles, interval }: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: {
        background: { color: '#0a0e27' },
        textColor: '#9aa3c4',
      },
      grid: {
        vertLines: { color: '#232a4a' },
        horzLines: { color: '#232a4a' },
      },
      timeScale: {
        borderColor: '#232a4a',
        timeVisible: true,
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: '#232a4a',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
        autoScale: true,
      },
      crosshair: {
        mode: 1,
      },
    });

    const candlestickSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
      borderVisible: true,
    });

    const candleData = candles
      .map((c) => ({
        time: Math.floor(parseInt(c.open_time) / 1000),
        open: parseFloat(c.open),
        high: parseFloat(c.high),
        low: parseFloat(c.low),
        close: parseFloat(c.close),
      }))
      .sort((a, b) => a.time - b.time);

    candlestickSeries.setData(candleData);

    // Fit content to ensure proper scaling
    chart.timeScale().fitContent();
    candlestickSeries.applyOptions({
      priceFormat: {
        type: 'price',
        precision: 2,
        minMove: 0.01,
      },
    });

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [candles]);

  return (
    <div style={{ width: '100%' }}>
      <div
        style={{
          marginBottom: '1rem',
          padding: '1rem',
          background: '#151a33',
          border: '1px solid #232a4a',
          borderRadius: '12px',
        }}
      >
        <h3 style={{ color: '#f3ba2f', marginTop: 0 }}>
          {symbol} - {interval.toUpperCase()}
        </h3>
        <p style={{ color: '#9aa3c4', fontSize: '0.9rem', marginBottom: 0 }}>
          {candles.length} candles loaded
        </p>
      </div>
      <div
        ref={chartContainerRef}
        style={{
          background: '#0a0e27',
          border: '1px solid #232a4a',
          borderRadius: '12px',
          overflow: 'hidden',
        }}
      />
    </div>
  );
}
