import pg from 'pg';

const client = new pg.Client({
  connectionString: 'postgres://postgres:postgres@localhost:5432/binance_bot',
});

await client.connect();

const result = await client.query(`
  SELECT 
    id, 
    symbol, 
    entry_price::numeric, 
    current_price::numeric, 
    stop_loss_price::numeric,
    take_profit_price::numeric,
    status,
    ((current_price - entry_price) / entry_price * 100)::numeric(10,2) as pnl_pct
  FROM positions 
  WHERE status = 'OPEN' 
  ORDER BY created_at DESC
`);

console.log(JSON.stringify(result.rows, null, 2));

await client.end();
