// ============================================================
// Quant Trading Route — Real Data (Tencent + Sina + Binance)
// Phase 3: Sina/Tencent free APIs for A-shares/HK stocks,
//          Binance for crypto, East Money fallback for US stocks
// ============================================================
const express = require('express');
const path = require('path');

// ── In-memory cache ──
const cache = new Map();
const CACHE_TTL_MS = 60_000;

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// ── Browser-like headers ──
const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

// ── Trading symbols (crypto + A-shares + HK + US) ──
const SYMBOLS = {
  // ── Crypto (via Binance) ──
  'BTC/USDT': { name: 'Bitcoin',        basePrice: 67580,  type: 'crypto',  emId: 'BTC' },
  'ETH/USDT': { name: 'Ethereum',       basePrice: 3450,   type: 'crypto',  emId: 'ETH' },
  'SOL/USDT': { name: 'Solana',         basePrice: 148,    type: 'crypto',  emId: 'SOL' },
  'BNB/USDT': { name: 'BNB',            basePrice: 595,    type: 'crypto',  emId: 'BNB' },
  'DOGE/USDT':{ name: 'Dogecoin',       basePrice: 0.12,   type: 'crypto',  emId: 'DOGE' },
  'XRP/USDT': { name: 'Ripple',         basePrice: 0.55,   type: 'crypto',  emId: 'XRP' },
  'ADA/USDT': { name: 'Cardano',        basePrice: 0.48,   type: 'crypto',  emId: 'ADA' },

  // ── A-shares 蓝筹 (via Tencent/Sina) ──
  '600519':   { name: '贵州茅台',        basePrice: 1480.00, type: 'a-share' },
  '000858':   { name: '五粮液',          basePrice: 135.60,  type: 'a-share' },
  '300750':   { name: '宁德时代',        basePrice: 210.50,  type: 'a-share' },
  '601318':   { name: '中国平安',        basePrice: 42.80,   type: 'a-share' },
  '000333':   { name: '美的集团',        basePrice: 68.90,   type: 'a-share' },
  '002415':   { name: '海康威视',        basePrice: 32.50,   type: 'a-share' },
  '600036':   { name: '招商银行',        basePrice: 34.50,   type: 'a-share' },
  '601166':   { name: '兴业银行',        basePrice: 17.80,   type: 'a-share' },

  // ── HK stocks (via Tencent/Sina) ──
  '00700.HK': { name: '腾讯控股',        basePrice: 388.00,  type: 'hk-stock' },
  '09988.HK': { name: '阿里巴巴',        basePrice: 82.50,   type: 'hk-stock' },
  '00941.HK': { name: '中国移动',        basePrice: 68.50,   type: 'hk-stock' },
  '03690.HK': { name: '美团-W',          basePrice: 118.00,  type: 'hk-stock' },

  // ── US stocks (via East Money) ──
  'AAPL':     { name: 'Apple',           basePrice: 198.50,  type: 'us-stock', emId: 'AAPL' },
  'MSFT':     { name: 'Microsoft',       basePrice: 425.30,  type: 'us-stock', emId: 'MSFT' },
  'TSLA':     { name: 'Tesla',           basePrice: 245.80,  type: 'us-stock', emId: 'TSLA' },
  'NVDA':     { name: 'NVIDIA',          basePrice: 880.20,  type: 'us-stock', emId: 'NVDA' },

  // ── Index ──
  '000300':   { name: '沪深300',          basePrice: 3890.50, type: 'index' },
};

// ── Timeframe configuration ──
const TF_CONFIG = {
  '5m':  { points: 78,  label: '5分钟' },
  '15m': { points: 80,  label: '15分钟' },
  '30m': { points: 80,  label: '30分钟' },
  '1h':  { points: 80,  label: '1小时' },
  '4h':  { points: 320, label: '4小时' },
  '1d':  { points: 120, label: '1天' },
};

// ════════════════════════════════════════════════════════════
// 1. 腾讯财经 — K线数据（A股/港股）
// ════════════════════════════════════════════════════════════

/**
 * Convert internal symbol ID to Tencent finance code.
 * 600519 → sh600519, 000001 → sz000001, 00700.HK → hk00700
 */
function toTencentCode(symbolId) {
  if (/^\d{6}$/.test(symbolId)) {
    return (symbolId.startsWith('6') ? 'sh' : 'sz') + symbolId;
  }
  if (symbolId.endsWith('.HK')) {
    return 'hk' + symbolId.replace('.HK', '');
  }
  return null;
}

/**
 * Fetch K-line from Tencent Finance API.
 * Daily: web.ifzq.gtimg.cn/appstock/app/fqkline/get
 * Minute: ifzq.gtimg.cn/appstock/app/kline/mkline
 */
async function fetchTencentKline(symbolId, tfKey) {
  const tencentCode = toTencentCode(symbolId);
  if (!tencentCode) return null;

  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];
  const points = cfg.points;

  const TENCENT_MINUTE = { '5m': 'm5', '15m': 'm15', '30m': 'm30', '1h': 'm60', '4h': 'm60' };

  try {
    let url;
    if (tfKey === '1d') {
      // Daily K-line (前复权)
      url = `http://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentCode},day,,,${Math.min(points, 640)},qfq`;
    } else {
      // Minute K-line
      const minInterval = TENCENT_MINUTE[tfKey] || 'm60';
      url = `http://ifzq.gtimg.cn/appstock/app/kline/mkline?param=${tencentCode},${minInterval},,${Math.min(points, 640)}`;
    }

    const resp = await fetch(url, {
      headers: { 'Referer': 'http://finance.qq.com/' },
      signal: AbortSignal.timeout(6000),
    });
    if (!resp.ok) return null;

    const text = await resp.text();

    // Extract JSON from JSONP (wrapped in _var=... or just {...})
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const json = JSON.parse(jsonMatch[0]);

    if (!json.data || !json.data[tencentCode]) return null;
    const stockData = json.data[tencentCode];

    // Get K-line array
    let klines;
    if (tfKey === '1d') {
      // Daily data lives under qfqday key
      klines = stockData.qfqday || stockData.day;
    } else {
      // Minute data — find the m-key
      const minuteKey = Object.keys(stockData).find(k => k.startsWith('m'));
      klines = minuteKey ? stockData[minuteKey] : null;
    }

    if (!klines || !Array.isArray(klines) || klines.length === 0) return null;

    // Tencent K-line format: [date, open, close, high, low, volume]
    // Daily: ["2025-05-20", open, close, high, low, volume]
    // Minute: ["202505201030", open, close, high, low, volume]
    const raw = klines.map(k => {
      const date = String(k[0]);
      const open = parseFloat(k[1]);
      const close = parseFloat(k[2]);
      const high = parseFloat(k[3]);
      const low = parseFloat(k[4]);
      const volume = parseFloat(k[5]) || 0;
      return { date, open, close, high, low, volume };
    }).filter(q => !isNaN(q.open) && !isNaN(q.close));

    if (raw.length === 0) return null;

    // Reverse to ascending order (Tencent returns newest first)
    raw.reverse();

    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] Tencent K-line failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch real-time quote from Tencent Finance.
 * Returns { price, change, changePct } or null.
 */
async function fetchTencentQuote(symbolId) {
  const tencentCode = toTencentCode(symbolId);
  if (!tencentCode) return null;

  try {
    const resp = await fetch(`http://qt.gtimg.cn/q=${tencentCode}`, {
      headers: { 'Referer': 'http://finance.qq.com/' },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    const text = await resp.text();

    // Format: v_sh600519="fields~separated~by~tilde~...";
    const match = text.match(/"([\s\S]*?)"/);
    if (!match) return null;

    const fields = match[1].split('~');
    // Fields: 0=market, 1=name, 2=code, 3=current, 4=prevClose, 5=open, 6=volume,
    //         7=buy_vol, 8=sell_vol, 30=update_time, 32=change%
    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[4]);

    if (isNaN(price) || isNaN(prevClose)) return null;

    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, change, changePct };
  } catch (err) {
    console.warn(`[Quant] Tencent quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 2. 新浪财经 — 实时行情（A股/港股备用）
// ════════════════════════════════════════════════════════════

/**
 * Convert internal symbol ID to Sina finance code.
 * 600519 → sh600519, 000001 → sz000001, 00700.HK → hk00700, AAPL → gb_aapl
 */
function toSinaCode(symbolId, type) {
  if (/^\d{6}$/.test(symbolId)) {
    return (symbolId.startsWith('6') ? 'sh' : 'sz') + symbolId;
  }
  if (symbolId.endsWith('.HK')) {
    return 'hk' + symbolId.replace('.HK', '');
  }
  if (type === 'us-stock') {
    return 'gb_' + symbolId.toLowerCase();
  }
  return null;
}

/**
 * Fetch real-time quote from Sina Finance.
 * Returns { price, prevClose, change, changePct } or null.
 */
async function fetchSinaQuote(symbolId, type) {
  const sinaCode = toSinaCode(symbolId, type);
  if (!sinaCode) return null;

  try {
    const resp = await fetch(`http://hq.sinajs.cn/list=${sinaCode}`, {
      headers: {
        'Referer': 'http://finance.sina.com.cn/',
        'Accept': '*/*',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;

    // Sina returns GBK encoded text. For price data, we can still extract numbers.
    const buffer = await resp.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buffer);

    // Format: var hq_str_sh600519="name,open,prevClose,current,high,low,...";
    const match = text.match(/"([\s\S]*?)"/);
    if (!match) return null;

    const fields = match[1].split(',');
    // Fields: 0=name, 1=open, 2=prevClose, 3=current price, 4=high, 5=low,
    //         6=buy, 7=sell, 8=volume, 9=amount

    const price = parseFloat(fields[3]);
    const prevClose = parseFloat(fields[2]);

    if (isNaN(price) || isNaN(prevClose)) return null;

    const change = price - prevClose;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, prevClose, change, changePct };
  } catch (err) {
    console.warn(`[Quant] Sina quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}



// ════════════════════════════════════════════════════════════
// 3. 东方财富 — K线数据（美股/基金备用）
// ════════════════════════════════════════════════════════════

const EM_MARKET = {
  'a-share':  (id) => id.startsWith('6') ? `1.${id}` : `0.${id}`,
  'hk-stock': (id) => `128.${id.replace('.HK', '')}`,
  'us-stock': (id) => `105.${id}`,
  'index':    (id) => id === '000300' ? '1.000300' : `1.${id}`,
};

function toEMSecId(symbolId, type) {
  const mapper = EM_MARKET[type];
  return mapper ? mapper(symbolId) : `105.${symbolId}`;
}

async function fetchEMKline(symbolId, type, tfKey) {
  const secid = toEMSecId(symbolId, type || 'us-stock');
  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];

  // Map internal timeframe to East Money klt
  const KLT_MAP = {
    '5m':  5,
    '15m': 15,
    '30m': 30,
    '1h':  60,
    '4h':  60,
    '1d':  101,
  };
  const klt = KLT_MAP[tfKey] || 60;
  const lmt = cfg.points;

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=${klt}&fqt=1` +
    `&end=20500101&lmt=${lmt}`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.data?.klines?.length) return null;

    // East Money price factor:
    // A-shares/index: ×100 (fen)
    // US/crypto/HK: ×1000 (thousandths)
    const priceDiv = (type === 'a-share' || type === 'index') ? 100 :
                     (type === 'us-stock' || type === 'crypto' || type === 'hk-stock') ? 1000 : 1;

    const raw = json.data.klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],
        open: parseFloat(parts[1]) / priceDiv,
        close: parseFloat(parts[2]) / priceDiv,
        high: parseFloat(parts[3]) / priceDiv,
        low: parseFloat(parts[4]) / priceDiv,
        volume: parseFloat(parts[5]) || 0,
      };
    }).filter(q => !isNaN(q.open) && !isNaN(q.close) && q.open > 0);

    if (raw.length === 0) return null;
    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] East Money K-line failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

async function fetchEMQuote(symbolId, type) {
  const secid = toEMSecId(symbolId, type || 'us-stock');
  // East Money quote factor:
  // A-shares/index: ×100; US/crypto/HK: ×1000
  const priceDiv = (type === 'a-share' || type === 'index') ? 100 : 1000;

  const url = `https://push2.eastmoney.com/api/qt/stock/get` +
    `?secid=${secid}&fields=f43,f168,f169,f170,f57,f58`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json?.data || json.data.f43 == null) return null;

    const rawPrice = json.data.f43;
    const rawChange = json.data.f168 || 0;
    const price = rawPrice / priceDiv;
    const change = rawChange / priceDiv;
    const prevClose = price - change;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return { price, change, changePct };
  } catch (err) {
    console.warn(`[Quant] East Money quote failed for ${symbolId}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 4. Binance — 加密货币数据
// ════════════════════════════════════════════════════════════

const BINANCE_INTERVAL = { '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1h', '4h': '4h', '1d': '1d' };

async function fetchBinanceKline(symbol, tfKey) {
  const interval = BINANCE_INTERVAL[tfKey];
  if (!interval) return null;

  const binanceSymbol = symbol.replace('/', '').toUpperCase();
  const lmt = TF_CONFIG[tfKey]?.points || 80;
  const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${lmt}`;

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!Array.isArray(json) || json.length === 0) return null;

    const raw = json.map(k => ({
      date: new Date(k[0]).toISOString(),
      open: parseFloat(k[1]),
      close: parseFloat(k[4]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      volume: parseFloat(k[5]),
    })).filter(q => !isNaN(q.open) && !isNaN(q.close) && q.open > 0);

    if (raw.length === 0) return null;
    return formatOHLCV(raw, tfKey);
  } catch (err) {
    console.warn(`[Quant] Binance K-line failed for ${binanceSymbol}: ${err.message}`);
    return null;
  }
}

async function fetchBinancePrice(symbol) {
  const binanceSymbol = symbol.replace('/', '').toUpperCase();
  try {
    const resp = await fetch(
      `https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!resp.ok) return null;
    const json = await resp.json();
    const price = parseFloat(json.price);
    if (isNaN(price)) return null;
    return { price, change: 0, changePct: 0 };
  } catch (err) {
    console.warn(`[Quant] Binance price failed for ${binanceSymbol}: ${err.message}`);
    return null;
  }
}

// ════════════════════════════════════════════════════════════
// 5. Data Source Router
// ════════════════════════════════════════════════════════════

/**
 * Choose data source based on symbol type and fetch K-line.
 */
async function fetchKline(symbolId, type, tfKey) {
  switch (type) {
    case 'crypto':
      // Crypto → Binance only
      return await fetchBinanceKline(symbolId, tfKey);

    case 'a-share':
    case 'hk-stock':
    case 'index':
      // A-shares/HK → Tencent → East Money → fallback
      let data = await fetchTencentKline(symbolId, tfKey);
      if (data) return data;
      data = await fetchEMKline(symbolId, type, tfKey);
      if (data) return data;
      return null;

    case 'us-stock':
      // US stocks → East Money → fallback
      return await fetchEMKline(symbolId, type, tfKey);

    default:
      return null;
  }
}

/**
 * Choose data source based on symbol type and fetch real-time price.
 */
async function fetchQuote(symbolId, type) {
  switch (type) {
    case 'crypto':
      return await fetchBinancePrice(symbolId);

    case 'a-share':
    case 'hk-stock':
    case 'index':
      // Try Tencent first, then Sina, then East Money
      let quote = await fetchTencentQuote(symbolId);
      if (quote) return quote;
      quote = await fetchSinaQuote(symbolId, type);
      if (quote) return quote;
      quote = await fetchEMQuote(symbolId, type);
      if (quote) return quote;
      return null;

    case 'us-stock':
      return await fetchEMQuote(symbolId, type);

    default:
      return null;
  }
}

// ════════════════════════════════════════════════════════════
// 6. Format OHLCV (shared)
// ════════════════════════════════════════════════════════════

function formatOHLCV(quotes, tfKey) {
  const prices = quotes.map(q => Math.round(q.close * 100) / 100);
  const volumes = quotes.map(q => Math.round(q.volume));
  const labels = quotes.map(q => {
    // Tencent daily: "2025-05-20" → "05/20"
    // Tencent minute: "202505201030" → "10:30"
    // Binance ISO: "2025-05-20T10:30:00.000Z" → "10:30"
    // East Money daily: "2024-01-15"
    // East Money minute: "09:35"

    const d = q.date;
    if (!d) return '';

    // Binance ISO format
    if (d.includes('T')) {
      if (tfKey === '1d') {
        const parts = d.split('T')[0].split('-');
        return `${parts[1]}/${parts[2]}`;
      }
      return d.split('T')[1]?.substring(0, 5) || d;
    }

    // Standard date format YYYY-MM-DD
    if (d.includes('-') && d.length >= 10) {
      if (tfKey === '1d' || tfKey === 'week') {
        const parts = d.split('-');
        return `${parts[1]}/${parts[2]}`;
      }
      // If it also has time: "2024-01-15 09:35"
      if (d.includes(' ')) {
        return d.split(' ')[1].substring(0, 5);
      }
      return d;
    }

    // Tencent minute: "202505201030" → "10:30"
    if (/^\d{12}$/.test(d)) {
      return `${d.substring(8,10)}:${d.substring(10,12)}`;
    }

    // Short time format: "09:35"
    if (d.includes(':')) return d;

    return d;
  });
  const ohlc = quotes.map(q => ({
    open: Math.round(q.open * 100) / 100,
    high: Math.round(q.high * 100) / 100,
    low: Math.round(q.low * 100) / 100,
    close: Math.round(q.close * 100) / 100,
  }));

  const currentPrice = prices[prices.length - 1];

  return { prices, volumes, labels, ohlc, currentPrice };
}

// ════════════════════════════════════════════════════════════
// 7. Simulated Data Generator (fallback)
// ════════════════════════════════════════════════════════════

function generateOHLCV(basePrice, tfKey) {
  const cfg = TF_CONFIG[tfKey] || TF_CONFIG['1h'];
  const points = cfg.points;
  let price = basePrice * (1 + (Math.random() - 0.5) * 0.06);
  const prices = [];
  const volumes = [];
  const labels = [];
  const ohlc = [];

  const vol = Math.max(basePrice * 0.015, 0.01);
  const now = Date.now();
  const intervalMs = tfKey === '5m' ? 300000 : tfKey === '15m' ? 900000 : tfKey === '30m' ? 1800000 : tfKey === '1h' ? 3600000 : tfKey === '4h' ? 14400000 : 86400000;

  for (let i = points - 1; i >= 0; i--) {
    const drift = (basePrice - price) * 0.005;
    const shock = (Math.random() - 0.5) * vol;
    price = Math.max(basePrice * 0.1, price + drift + shock);

    const open = price;
    const close = price + (Math.random() - 0.5) * vol * 0.3;
    const high = Math.max(open, close) + Math.random() * vol * 0.4;
    const low = Math.min(open, close) - Math.random() * vol * 0.4;

    const flooredOpen = Math.round(open * 100) / 100;
    const flooredClose = Math.round(close * 100) / 100;

    prices.push(flooredClose);
    ohlc.push({
      open: flooredOpen,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: flooredClose,
    });
    volumes.push(Math.round(basePrice * 5000 + Math.random() * basePrice * 10000));

    const ts = new Date(now - i * intervalMs);
    if (tfKey === '1d') {
      labels.push((ts.getMonth() + 1) + '/' + ts.getDate());
    } else {
      labels.push(ts.getHours().toString().padStart(2, '0') + ':' + ts.getMinutes().toString().padStart(2, '0'));
    }
  }

  return { prices, volumes, labels, ohlc, currentPrice: price };
}

// ════════════════════════════════════════════════════════════
// 8. Strategy Engine
// ════════════════════════════════════════════════════════════

function computeMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result.push(Math.round((sum / period) * 100) / 100);
  }
  return result;
}

function computeRSI(ohlc, period) {
  period = period || 14;
  const closes = ohlc.map(o => o.close);
  const result = [];
  const gains = [];
  const losses = [];

  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  for (let i = 0; i < closes.length; i++) {
    if (i < period) { result.push(null); continue; }
    const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    result.push(avgLoss === 0 ? 100 : Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10);
  }
  return result;
}

function computeEMA(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let ema = null;

  for (let i = 0; i < data.length; i++) {
    if (data[i] == null) { result.push(null); continue; }
    if (ema === null) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - period + 1); j <= i; j++) {
        if (data[j] != null) { sum += data[j]; count++; }
      }
      ema = sum / count;
    } else {
      ema = (data[i] - ema) * multiplier + ema;
    }
    result.push(Math.round(ema * 100) / 100);
  }
  return result;
}

function generateSignals(prices, ohlc, strategyId, params) {
  params = params || {};
  const signals = [];

  if (strategyId === 'ma_cross') {
    const fastPeriod = params.fast_ma || 7;
    const slowPeriod = params.slow_ma || 25;
    const maFast = computeMA(prices, fastPeriod);
    const maSlow = computeMA(prices, slowPeriod);

    for (let i = 1; i < prices.length; i++) {
      if (maFast[i] == null || maSlow[i] == null || maFast[i - 1] == null || maSlow[i - 1] == null) continue;
      if (maFast[i - 1] <= maSlow[i - 1] && maFast[i] > maSlow[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.75, reason: `MA${fastPeriod} 上穿 MA${slowPeriod}` });
      }
      if (maFast[i - 1] >= maSlow[i - 1] && maFast[i] < maSlow[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.75, reason: `MA${fastPeriod} 下穿 MA${slowPeriod}` });
      }
    }
    return { signals, indicators: { maFast, maSlow } };
  }

  if (strategyId === 'rsi') {
    const period = params.rsi_period || 14;
    const oversold = params.oversold || 30;
    const overbought = params.overbought || 70;
    const rsi = computeRSI(ohlc, period);

    for (let i = 1; i < rsi.length; i++) {
      if (rsi[i] == null || rsi[i - 1] == null) continue;
      if (rsi[i - 1] >= oversold && rsi[i] < oversold) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.65, reason: `RSI 超卖 (${rsi[i]})` });
      }
      if (rsi[i - 1] <= overbought && rsi[i] > overbought) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.65, reason: `RSI 超买 (${rsi[i]})` });
      }
    }
    return { signals, indicators: { rsi } };
  }

  if (strategyId === 'macd') {
    const fastPeriod = params.macd_fast || 12;
    const slowPeriod = params.macd_slow || 26;
    const signalPeriod = params.macd_signal || 9;
    const emaFast = computeEMA(prices, fastPeriod);
    const emaSlow = computeEMA(prices, slowPeriod);
    const macdLine = [];
    for (let i = 0; i < prices.length; i++) {
      macdLine.push(emaFast[i] != null && emaSlow[i] != null
        ? Math.round((emaFast[i] - emaSlow[i]) * 100) / 100
        : null);
    }
    const signalLine = computeEMA(macdLine.map(v => v != null ? v : 0), signalPeriod);
    for (let i = 0; i < macdLine.length; i++) {
      if (macdLine[i] == null) signalLine[i] = null;
    }

    for (let i = 1; i < macdLine.length; i++) {
      if (macdLine[i] == null || signalLine[i] == null || macdLine[i - 1] == null || signalLine[i - 1] == null) continue;
      if (macdLine[i - 1] <= signalLine[i - 1] && macdLine[i] > signalLine[i]) {
        signals.push({ index: i, type: 'buy', price: prices[i], confidence: 0.70, reason: 'MACD 金叉' });
      }
      if (macdLine[i - 1] >= signalLine[i - 1] && macdLine[i] < signalLine[i]) {
        signals.push({ index: i, type: 'sell', price: prices[i], confidence: 0.70, reason: 'MACD 死叉' });
      }
    }
    return { signals, indicators: { macd: macdLine, signal: signalLine } };
  }

  return { signals: [], indicators: {} };
}

// ════════════════════════════════════════════════════════════
// 9. Backtest Engine
// ════════════════════════════════════════════════════════════

function runBacktest(prices, ohlc, strategyId, params) {
  const { signals } = generateSignals(prices, ohlc, strategyId, params);
  let wins = 0, losses = 0;
  let totalReturn = 0;
  let maxDrawdown = 0;
  let peak = 1;
  let inPosition = false;
  let entryPrice = 0;
  const trades = [];

  for (const sig of signals) {
    if (sig.type === 'buy' && !inPosition) {
      inPosition = true;
      entryPrice = sig.price;
    } else if (sig.type === 'sell' && inPosition) {
      inPosition = false;
      const pnl = ((sig.price - entryPrice) / entryPrice) * 100;
      totalReturn += pnl;
      if (pnl > 0) wins++; else losses++;
      trades.push({ time: sig.index, type: 'sell', entry: entryPrice, exit: sig.price, pnl: Math.round(pnl * 100) / 100 });
      const equity = 1 + totalReturn / 100;
      if (equity > peak) peak = equity;
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }

  if (inPosition) {
    const lastPrice = prices[prices.length - 1];
    const pnl = ((lastPrice - entryPrice) / entryPrice) * 100;
    totalReturn += pnl;
    if (pnl > 0) wins++; else losses++;
    trades.push({ time: prices.length - 1, type: 'close', entry: entryPrice, exit: lastPrice, pnl: Math.round(pnl * 100) / 100 });
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 1000) / 10 : 0;
  const sharpe = totalTrades > 0 && totalReturn !== 0
    ? Math.round((totalReturn / totalTrades) * 100) / 100
    : 0;

  return {
    total_trades: totalTrades,
    win_rate: winRate,
    total_return: Math.round(totalReturn * 100) / 100,
    max_drawdown: Math.round(maxDrawdown * 100) / 100,
    sharpe_ratio: sharpe,
    trades,
  };
}

// ════════════════════════════════════════════════════════════
// 10. Router
// ════════════════════════════════════════════════════════════

function createRouter() {
  const router = express.Router();

  // ── GET /quant/market-data — cached OHLCV ──
  router.get('/quant/market-data', async (req, res) => {
    try {
      const symbol = req.query.symbol || 'BTC/USDT';
      const timeframe = req.query.timeframe || req.query.tf || '1h';

      const sym = SYMBOLS[symbol];
      if (!sym) {
        return res.status(400).json({ success: false, error: `Unknown symbol: ${symbol}` });
      }

      if (!TF_CONFIG[timeframe]) {
        return res.status(400).json({ success: false, error: `Invalid timeframe: ${timeframe}. Use 5m, 15m, 30m, 1h, 4h, 1d` });
      }

      const cacheKey = `market:${symbol}:${timeframe}`;
      let data = cacheGet(cacheKey);
      let dataSource;

      if (!data) {
        // Try real data source based on symbol type
        data = await fetchKline(symbol, sym.type, timeframe);
        if (data) {
          dataSource = (sym.type === 'crypto') ? 'binance' :
                       (sym.type === 'a-share' || sym.type === 'hk-stock' || sym.type === 'index') ? 'tencent' :
                       'eastmoney';
          cacheSet(cacheKey, data);
        }
      } else {
        dataSource = 'cached';
      }

      // Fallback to simulated
      if (!data) {
        data = generateOHLCV(sym.basePrice, timeframe);
        dataSource = 'simulated';
        cacheSet(cacheKey, data);
      }

      // Try to fetch live price
      let livePrice = null;
      try {
        const quote = await fetchQuote(symbol, sym.type);
        if (quote && quote.price != null && quote.price > 0) {
          livePrice = quote;
        }
      } catch (e) { /* best-effort quote fetch */ }

      // Compute basic stats
      const isUp = data.prices.length >= 2 && data.prices[data.prices.length - 1] >= data.prices[0];
      const change = data.prices.length >= 2
        ? Math.round((data.prices[data.prices.length - 1] - data.prices[0]) * 100) / 100
        : 0;
      const changePct = data.prices.length >= 2 && data.prices[0] > 0
        ? Math.round((change / data.prices[0]) * 10000) / 100
        : 0;

      res.json({
        success: true,
        symbol,
        timeframe,
        data: {
          prices: data.prices,
          volumes: data.volumes,
          labels: data.labels,
          ohlc: data.ohlc,
          currentPrice: livePrice?.price || data.currentPrice,
        },
        stats: {
          open: data.ohlc[0]?.open || 0,
          close: livePrice?.price || data.currentPrice,
          high: Math.max(...data.prices),
          low: Math.min(...data.prices),
          change,
          changePct,
          isUp,
        },
        dataSource,
        livePrice: livePrice ? {
          price: livePrice.price,
          change: livePrice.change,
          changePct: livePrice.changePct,
        } : null,
      });
    } catch (err) {
      console.error('[Quant] market-data error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /quant/strategy — generate trading signals ──
  router.post('/quant/strategy', (req, res) => {
    try {
      const { symbol, timeframe, strategy, params, market_data } = req.body;

      if (!market_data || !market_data.ohlc || market_data.ohlc.length === 0) {
        return res.status(400).json({ success: false, error: 'market_data.ohlc is required' });
      }

      const prices = market_data.prices || market_data.ohlc.map(o => o.close);
      const ohlc = market_data.ohlc;
      const strategyId = strategy || 'ma_cross';

      const result = generateSignals(prices, ohlc, strategyId, params || {});

      res.json({
        success: true,
        symbol,
        timeframe,
        strategy: strategyId,
        signals: result.signals,
        indicators: result.indicators,
        metrics: {
          total_signals: result.signals.length,
          buy_signals: result.signals.filter(s => s.type === 'buy').length,
          sell_signals: result.signals.filter(s => s.type === 'sell').length,
          avg_confidence: result.signals.length > 0
            ? Math.round((result.signals.reduce((a, s) => a + s.confidence, 0) / result.signals.length) * 100) / 100
            : 0,
        },
      });
    } catch (err) {
      console.error('[Quant] strategy error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── POST /quant/backtest — run historical backtest ──
  router.post('/quant/backtest', (req, res) => {
    try {
      const { symbol, timeframe, strategy, params, market_data } = req.body;

      if (!market_data || !market_data.ohlc || market_data.ohlc.length === 0) {
        return res.status(400).json({ success: false, error: 'market_data.ohlc is required' });
      }

      const prices = market_data.prices || market_data.ohlc.map(o => o.close);
      const ohlc = market_data.ohlc;
      const strategyId = strategy || 'ma_cross';

      const result = runBacktest(prices, ohlc, strategyId, params || {});

      res.json({
        success: true,
        symbol,
        timeframe,
        strategy: strategyId,
        ...result,
      });
    } catch (err) {
      console.error('[Quant] backtest error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /quant/price — live price for a symbol ──
  router.get('/quant/price', async (req, res) => {
    try {
      const symbol = req.query.symbol || 'BTC/USDT';
      const sym = SYMBOLS[symbol];
      if (!sym) {
        return res.status(400).json({ success: false, error: `Unknown symbol: ${symbol}` });
      }

      const quote = await fetchQuote(symbol, sym.type);
      if (!quote || !quote.price) {
        return res.json({ success: false, error: 'Unable to fetch live price' });
      }

      res.json({
        success: true,
        symbol,
        price: quote.price,
        change: quote.change || 0,
        changePct: quote.changePct || 0,
        isUp: (quote.change || 0) >= 0,
        updatedAt: Date.now(),
      });
    } catch (err) {
      console.error('[Quant] price error:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ── GET /quant/symbols — list available trading symbols ──
  router.get('/quant/symbols', (req, res) => {
    const list = Object.entries(SYMBOLS).map(([id, info]) => ({
      id,
      name: info.name,
      basePrice: info.basePrice,
      type: info.type,
    }));
    res.json({ success: true, symbols: list });
  });

  return router;
}

// ════════════════════════════════════════════════════════════
// 11. Page routes
// ════════════════════════════════════════════════════════════

function setupPageRoutes(app) {
  app.get('/quant', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'quant.html'));
  });
  app.get('/browser', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'browser.html'));
  });
  app.get('/media', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'media.html'));
  });
}

module.exports = { createRouter, setupPageRoutes };
