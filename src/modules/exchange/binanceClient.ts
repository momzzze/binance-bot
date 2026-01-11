import crypto from 'node:crypto';
import { createLogger } from '../../services/logger.js';
import { redact } from '../../utils/redact.js';
import { sleep } from '../../utils/sleep.js';
import type {
  BinanceServerTime,
  BinanceAccountInfo,
  BinanceNewOrderRequest,
  BinanceOrderResponse,
  BinanceOrderQueryResponse,
  BinanceKline,
  BinanceTicker24h,
} from './types.js';

const logger = createLogger('BinanceClient');

export interface BinanceClientConfig {
  baseURL: string;
  apiKey: string;
  apiSecret: string;
  recvWindow?: number;
}

export class BinanceClient {
  private baseURL: string;
  private apiKey: string;
  private apiSecret: string;
  private recvWindow: number;
  private serverTimeOffset: number = 0;

  constructor(config: BinanceClientConfig) {
    this.baseURL = config.baseURL.replace(/\/$/, '');
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.recvWindow = config.recvWindow ?? 5000;
    logger.info(`Initialized with baseURL=${this.baseURL}, apiKey=${redact(this.apiKey)}`);
  }

  /**
   * Sync server time offset to ensure signatures are valid
   */
  async syncServerTime(): Promise<void> {
    const before = Date.now();
    const data = await this.publicRequest<BinanceServerTime>('/api/v3/time');
    const after = Date.now();
    const localTime = Math.floor((before + after) / 2);
    this.serverTimeOffset = data.serverTime - localTime;
    logger.info(`Server time offset: ${this.serverTimeOffset}ms`);
  }

  /**
   * Get adjusted timestamp accounting for server time offset
   */
  private getTimestamp(): number {
    return Date.now() + this.serverTimeOffset;
  }

  /**
   * Build query string from params object
   */
  private buildQueryString(params: Record<string, unknown>): string {
    return Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
  }

  /**
   * Sign query string with HMAC SHA256
   */
  private sign(queryString: string): string {
    return crypto.createHmac('sha256', this.apiSecret).update(queryString).digest('hex');
  }

  /**
   * Public request (no signature)
   */
  private async publicRequest<T>(
    endpoint: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const qs = this.buildQueryString(params);
    const url = `${this.baseURL}${endpoint}${qs ? '?' + qs : ''}`;
    logger.debug(`GET ${endpoint}`, params);

    const res = await fetch(url, { method: 'GET' });
    const data = await res.json();

    if (!res.ok) {
      logger.error(`Public request failed: ${res.status}`, data);
      throw new Error(`Binance API error: ${JSON.stringify(data)}`);
    }

    return data as T;
  }

  /**
   * Signed request (with API key + signature)
   */
  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const timestamp = this.getTimestamp();
    const allParams = { ...params, recvWindow: this.recvWindow, timestamp };
    const qs = this.buildQueryString(allParams);
    const signature = this.sign(qs);
    const signedQs = `${qs}&signature=${signature}`;
    const url = `${this.baseURL}${endpoint}?${signedQs}`;

    logger.debug(`${method} ${endpoint}`, allParams);

    const res = await fetch(url, {
      method,
      headers: {
        'X-MBX-APIKEY': this.apiKey,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      logger.error(`Signed request failed: ${res.status}`, data);
      throw new Error(`Binance API error: ${JSON.stringify(data)}`);
    }

    return data as T;
  }

  /**
   * Retry wrapper for transient errors
   */
  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        const msg = String(err);
        // Don't retry client errors (4xx) except rate limit
        if (msg.includes('"code":-1003') || msg.includes('"code":-1015')) {
          logger.warn(`Rate limit hit, retrying (${attempt}/${maxRetries})`);
          await sleep(1000 * attempt);
          continue;
        }
        if (msg.includes('"code":') && msg.includes('4')) {
          throw err; // Client error, don't retry
        }
        logger.warn(`Attempt ${attempt}/${maxRetries} failed: ${msg}`);
        if (attempt < maxRetries) await sleep(500 * attempt);
      }
    }
    throw lastError;
  }

  // ========== PUBLIC ENDPOINTS ==========

  async getServerTime(): Promise<BinanceServerTime> {
    return this.publicRequest<BinanceServerTime>('/api/v3/time');
  }

  async get24hTicker(symbol: string): Promise<BinanceTicker24h> {
    return this.publicRequest<BinanceTicker24h>('/api/v3/ticker/24hr', { symbol });
  }

  async getAll24hTickers(): Promise<BinanceTicker24h[]> {
    return this.publicRequest<BinanceTicker24h[]>('/api/v3/ticker/24hr');
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<BinanceKline[]> {
    const raw = await this.publicRequest<Array<Array<string | number>>>('/api/v3/klines', {
      symbol,
      interval,
      limit,
    });
    return raw.map((k) => ({
      openTime: Number(k[0]),
      open: String(k[1]),
      high: String(k[2]),
      low: String(k[3]),
      close: String(k[4]),
      volume: String(k[5]),
      closeTime: Number(k[6]),
      quoteAssetVolume: String(k[7]),
      numberOfTrades: Number(k[8]),
      takerBuyBaseAssetVolume: String(k[9]),
      takerBuyQuoteAssetVolume: String(k[10]),
    }));
  }

  // ========== SIGNED ENDPOINTS ==========

  async getAccountInfo(): Promise<BinanceAccountInfo> {
    return this.withRetry(() => this.signedRequest<BinanceAccountInfo>('GET', '/api/v3/account'));
  }

  async createOrder(req: Omit<BinanceNewOrderRequest, 'timestamp'>): Promise<BinanceOrderResponse> {
    return this.withRetry(() =>
      this.signedRequest<BinanceOrderResponse>(
        'POST',
        '/api/v3/order',
        req as Record<string, unknown>
      )
    );
  }

  async queryOrder(symbol: string, orderId: number): Promise<BinanceOrderQueryResponse> {
    return this.withRetry(() =>
      this.signedRequest<BinanceOrderQueryResponse>('GET', '/api/v3/order', { symbol, orderId })
    );
  }

  async cancelOrder(symbol: string, orderId: number): Promise<BinanceOrderResponse> {
    return this.withRetry(() =>
      this.signedRequest<BinanceOrderResponse>('DELETE', '/api/v3/order', { symbol, orderId })
    );
  }
}
