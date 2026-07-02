// ============================================================
// Stock & Fund Data Route — East Money (东方财富) + simulated fallback
// Primary: East Money HTTP API (free, no API key, works from China)
// Fallback: Server-side random walk generator
// ============================================================
const express = require('express');

// ── East Money HTTP API (no npm packages needed) ──
// A股指数/SH: market=1  (e.g. 1.600519)
// 深证/SZ:    market=0  (e.g. 0.000001)
// 港股:       market=128 (e.g. 128.00700)
// 美股:       market=105 (e.g. 105.AAPL)
// 基金:       use 天天基金 fundgz API

// ── In-memory cache ──
const cache = new Map();
const CACHE_TTL_MS = 60_000; // 60 seconds

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

// ── Symbol mapping: internal ID → East Money secid format ──
function toSecId(id) {
  // A-shares (6-digit codes)
  if (/^\d{6}$/.test(id)) {
    const market = id.startsWith('6') ? 1 : 0; // 6xxxxx → SH(1), others → SZ(0)
    return `${market}.${id}`;
  }
  // HK stocks: 00700.HK → 128.00700
  if (id.endsWith('.HK')) {
    const code = id.replace('.HK', '');
    return `128.${code}`;
  }
  // CSI 300 index
  if (id === '000300') return '1.000300';
  // US stocks / ETFs (AAPL, SPY, QQQ, NVDA, etc.)
  return `105.${id}`;
}

// ── Browser-like headers for East Money API ──
const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://quote.eastmoney.com/',
  'Accept': 'application/json, text/plain, */*',
};

// ── Stock list ──
const STOCKS = [
  // US stocks
  { id: 'AAPL',     name: 'Apple Inc.',                     type: 'stock',    price: 198.50,  prevClose: 195.30 },
  { id: 'GOOGL',    name: 'Alphabet Inc.',                  type: 'stock',    price: 175.20,  prevClose: 173.80 },
  { id: 'MSFT',     name: 'Microsoft Corp.',                type: 'stock',    price: 425.30,  prevClose: 420.10 },
  { id: 'TSLA',     name: 'Tesla Inc.',                     type: 'stock',    price: 245.80,  prevClose: 250.20 },
  { id: 'AMZN',     name: 'Amazon.com Inc.',                type: 'stock',    price: 178.90,  prevClose: 176.50 },
  { id: 'NVDA',     name: 'NVIDIA Corp.',                   type: 'stock',    price: 880.20,  prevClose: 865.10 },
  { id: 'BABA',     name: 'Alibaba Group',                  type: 'stock',    price: 78.40,   prevClose: 79.90 },
  { id: 'TSM',      name: 'Taiwan Semiconductor',           type: 'stock',    price: 145.60,  prevClose: 143.20 },
  // Hong Kong stocks
  { id: '00700.HK', name: '腾讯控股 (Tencent)',              type: 'hk-stock', price: 388.00,  prevClose: 382.00 },
  { id: '9988.HK',  name: '阿里巴巴 (Alibaba)',              type: 'hk-stock', price: 82.50,   prevClose: 84.20 },
  // A-shares
  { id: '600519',   name: '贵州茅台',                        type: 'a-share',  price: 1480.00, prevClose: 1475.00 },
  { id: '000858',   name: '五粮液',                          type: 'a-share',  price: 135.60,  prevClose: 134.20 },
  { id: '300750',   name: '宁德时代',                        type: 'a-share',  price: 210.50,  prevClose: 208.30 },
  { id: '601318',   name: '中国平安',                        type: 'a-share',  price: 42.80,   prevClose: 43.10 },
  { id: '000333',   name: '美的集团',                        type: 'a-share',  price: 68.90,   prevClose: 69.50 },
  // Index
  { id: '000300',   name: '沪深300',                         type: 'index',    price: 3890.50, prevClose: 3870.20 },
  // ETFs
  { id: 'SPY',      name: 'SPDR S&P 500 ETF',               type: 'etf',      price: 518.30,  prevClose: 515.70 },
  { id: 'QQQ',      name: 'Invesco QQQ ETF',                type: 'etf',      price: 442.10,  prevClose: 438.50 },
  { id: '510050',   name: '上证50ETF',                      type: 'a-share',  price: 2.58,    prevClose: 2.56 },
  // Crypto
  { id: 'BTC',      name: 'Bitcoin',                        type: 'crypto',   price: 67580,   prevClose: 66200 },
  { id: 'ETH',      name: 'Ethereum',                       type: 'crypto',   price: 3450,    prevClose: 3520 },
  // Chinese Funds (公募基金)
  { id: 'FUND_110011', name: '易方达中小盘混合',            type: 'fund',     price: 5.23,    prevClose: 5.18 },
  { id: 'FUND_001632', name: '招商丰盛混合',               type: 'fund',     price: 2.15,    prevClose: 2.12 },
];

const RANGES = {
  '1D': { days: 1, interval: '5m',  points: 78,  klt: 5   },  // 5-min K-line
  '1W': { days: 5, interval: '30m', points: 65,  klt: 30  },  // 30-min K-line
  '1M': { days: 22, interval: '1d', points: 22,  klt: 101 },  // daily
  '3M': { days: 66, interval: '1d', points: 66,  klt: 101 },  // daily
  '1Y': { days: 252, interval: '1d', points: 252, klt: 101 }, // daily
};

// ============================================================
// East Money API — real data fetch
// ============================================================

/**
 * Determine if the stock id is a fund (starts with FUND_).
 */
function isFund(id) {
  return id.startsWith('FUND_');
}

/**
 * Strip FUND_ prefix to get the raw fund code.
 */
function fundCode(id) {
  return id.replace('FUND_', '');
}

/**
 * Fetch daily K-line (OHLCV) from East Money.
 * Returns null on failure.
 */
async function fetchEMChart(id, rangeKey) {
  const cfg = RANGES[rangeKey] || RANGES['1M'];
  const secid = toSecId(id);
  const klt = cfg.klt;
  const lmt = cfg.points;

  const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get` +
    `?secid=${secid}` +
    `&fields1=f1,f2,f3,f4,f5,f6` +
    `&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61` +
    `&klt=${klt}&fqt=1` +
    `&end=20500101&lmt=${lmt}`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.data || !json.data.klines || json.data.klines.length === 0) {
      return null;
    }

    // Each kline: "date,open,close,high,low,volume,amount,amplitude,changePct,changeAmt,turnover"
    const quotes = json.data.klines.map(line => {
      const parts = line.split(',');
      return {
        date: parts[0],       // f51: "2024-01-15" or "09:35"
        open: parseFloat(parts[1]),
        close: parseFloat(parts[2]),
        high: parseFloat(parts[3]),
        low: parseFloat(parts[4]),
        volume: parseFloat(parts[5]) || 0,
        amount: parseFloat(parts[6]) || 0,
      };
    }).filter(q => !isNaN(q.open) && !isNaN(q.close));

    if (quotes.length === 0) return null;

    // For minute-level K-lines (1D, 1W), East Money returns "09:35" format dates
    // For daily K-lines (1M, 3M, 1Y), it returns "2024-01-15" format
    return {
      prices: quotes.map(q => Math.round(q.close * 100) / 100),
      volumes: quotes.map(q => Math.round(q.volume)),
      labels: quotes.map(q => {
        if (rangeKey === '1D') {
          // Intraday: time part only (e.g. "09:35")
          return q.date.includes('-') ? q.date.split(' ')[1] || q.date : q.date;
        }
        // Daily: MM/DD format for consistency with frontend
        if (q.date.includes('-')) {
          const parts = q.date.split('-');
          return `${parts[1]}/${parts[2]}`;
        }
        return q.date;
      }),
      ohlc: quotes.map(q => ({
        open: Math.round(q.open * 100) / 100,
        high: Math.round(q.high * 100) / 100,
        low: Math.round(q.low * 100) / 100,
        close: Math.round(q.close * 100) / 100,
      })),
    };
  } catch (err) {
    console.warn(`[Stocks] East Money fetch failed for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Price factor: East Money quote API returns prices multiplied by a factor.
 * A-shares/indices: 100 (分/元)
 * US/HK/others: 1000 (thousandths)
 */
function priceFactor(type) {
  if (type === 'a-share' || type === 'index') return 100;
  return 1000;
}

/**
 * Fetch real-time quote from East Money.
 * Returns { price, change, changePct } or null.
 */
async function fetchEMQuote(id, type) {
  const secid = toSecId(id);
  const factor = priceFactor(type);
  const url = `https://push2.eastmoney.com/api/qt/stock/get` +
    `?secid=${secid}` +
    `&fields=f43,f168,f169,f170,f57,f58`;

  try {
    const resp = await fetch(url, { headers: EM_HEADERS });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!json || !json.data || json.data.f43 == null) return null;

    const rawPrice = json.data.f43;
    const rawChange = json.data.f168 || 0;
    const price = rawPrice / factor;
    const change = rawChange / factor;
    const prevClose = price - change;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    return {
      price,
      change,
      changePct,
    };
  } catch (err) {
    console.warn(`[Stocks] East Money quote failed for ${id}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch real-time fund NAV from 天天基金.
 * Returns { price, change, changePct } or null.
 */
async function fetchFundNAV(id) {
  const code = fundCode(id);
  const url = `https://fundgz.1234567.com.cn/js/${code}.js`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': EM_HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/',
      },
    });
    if (!resp.ok) return null;
    const text = await resp.text();

    // Response: jsonpgz({...});
    const match = text.match(/\{.*\}/);
    if (!match) return null;
    const data = JSON.parse(match[0]);

    // gsz = estimated NAV (估算净值), dwjz = last confirmed NAV
    if (data.gsz != null) {
      return {
        price: parseFloat(data.gsz),
        change: data.gszzl != null ? parseFloat(data.gszzl) : 0,
        changePct: data.gszzl != null ? parseFloat(data.gszzl) : 0,
      };
    }
    return null;
  } catch (err) {
    console.warn(`[Stocks] Fund NAV fetch failed for ${code}: ${err.message}`);
    return null;
  }
}

/**
 * Fetch fund historical NAV (daily) from 天天基金.
 * Returns chart format { prices, volumes, labels, ohlc } or null.
 */
async function fetchFundChart(id, rangeKey) {
  const code = fundCode(id);
  // 天天基金历史净值 API: returns JSON wrapped in jQuery(...)
  const url = `https://api.fund.eastmoney.com/f10/lsjz?callback=jQuery&fundCode=${code}&pageIndex=1&pageSize=200&startDate=&endDate=`;

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': EM_HEADERS['User-Agent'],
        'Referer': 'https://fund.eastmoney.com/',
      },
    });
    if (!resp.ok) return null;
    const text = await resp.text();

    // Extract JSON from JSONP wrapper: jQuery({...});
    const match = text.match(/jQuery\((.*)\)/);
    if (!match) return null;
    const json = JSON.parse(match[1]);
    const list = json?.Data?.LSJZList;
    if (!list || list.length === 0) return null;

    // LSJZList is in descending order (newest first).
    // Chart expects ascending (oldest first). Reverse to get ascending.
    const cfg = RANGES[rangeKey] || RANGES['1M'];
    const points = cfg.points;
    // Take the newest `points` entries, then reverse to ascending
    const rows = list.slice(0, points).reverse();

    const prices = [];
    const labels = [];
    const ohlc = [];
    const volumes = [];

    for (const row of rows) {
      const nav = parseFloat(row.DWJZ);
      if (isNaN(nav)) continue;

      prices.push(Math.round(nav * 100) / 100);
      ohlc.push({
        open: Math.round(nav * 100) / 100,
        high: Math.round(nav * 100) / 100,
        low: Math.round(nav * 100) / 100,
        close: Math.round(nav * 100) / 100,
      });
      volumes.push(0); // NAV changes don't have volume

      // Format date as MM/DD
      if (row.FSRQ) {
        const parts = row.FSRQ.split('-');
        labels.push(`${parts[1]}/${parts[2]}`);
      } else {
        labels.push('');
      }
    }

    if (prices.length === 0) return null;

    return { prices, volumes, labels, ohlc };
  } catch (err) {
    console.warn(`[Stocks] Fund history fetch failed for ${code}: ${err.message}`);
    return null;
  }
}

// ============================================================
// Simulated data — fallback when API unavailable
// ============================================================

function generateOHLCV(basePrice, rangeKey) {
  const config = RANGES[rangeKey] || RANGES['1M'];
  const points = config.points;

  let price = basePrice * (1 + (Math.random() - 0.5) * 0.04);
  const prices = [];
  const volumes = [];
  const labels = [];
  const ohlc = [];

  const vol = Math.max(basePrice * 0.015, 0.01);
  const now = Date.now();
  const isIntraday = rangeKey === '1D';

  for (let i = points - 1; i >= 0; i--) {
    const drift = (basePrice - price) * 0.008;
    const shock = (Math.random() - 0.5) * vol;
    price = Math.max(basePrice * 0.1, price + drift + shock);

    const open = price;
    const close = price + (Math.random() - 0.5) * vol * 0.3;
    const high = Math.max(open, close) + Math.random() * vol * 0.5;
    const low = Math.min(open, close) - Math.random() * vol * 0.5;
    const roundedClose = Math.round(close * 100) / 100;

    prices.push(roundedClose);
    ohlc.push({
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: roundedClose,
    });

    const baseVol = basePrice * 100000;
    const volFactor = 0.5 + Math.abs(shock / vol);
    volumes.push(Math.round(baseVol * volFactor * (0.5 + Math.random())));

    const d = new Date(now - i * (isIntraday ? 300000 : 86400000));
    if (isIntraday) {
      labels.push(d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }));
    } else {
      labels.push(d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' }));
    }
  }

  return { prices, volumes, labels, ohlc };
}

// ============================================================
// Router
// ============================================================

function createRouter() {
  const router = express.Router();

  // GET /api/stocks — list all available stocks
  router.get('/stocks', (req, res) => {
    res.json({
      success: true,
      stocks: STOCKS,
    });
  });

  // GET /api/stocks/hot — 热门股票（必须放在 :id 前）
  router.get('/stocks/hot', async (req, res) => {
    try {
      const url = 'https://push2.eastmoney.com/api/qt/clist/get' +
        '?np=1&pn=1&pz=15&po=1' +
        '&fs=m:0+t:6,m:1+t:2,m:0+t:7,m:0+t:8' +
        '&fields=f12,f14,f2,f3,f4,f5,f6,f7,f8,f15,f16,f17,f18' +
        '&fid=f6';

      const resp = await fetch(url, { headers: EM_HEADERS });
      if (!resp.ok) {
        return res.json({ success: false, error: 'East Money API error' });
      }
      const json = await resp.json();
      const raw = json?.data?.diff || [];

      const leaders = raw
        .filter(s => s.f14 && !s.f14.includes('退') && (s.f2 || 0) > 0)
        .slice(0, 10)
        .map(s => ({
          code: s.f12,
          name: s.f14,
          price: Math.round((s.f2 || 0) / 100 * 100) / 100,
          changePct: Math.round((s.f3 || 0) / 100 * 100) / 100,
          change: Math.round((s.f4 || 0) / 100 * 100) / 100,
          volume: s.f5 || 0,
          amount: s.f6 || 0,
          high: Math.round((s.f15 || 0) / 100 * 100) / 100,
          low: Math.round((s.f16 || 0) / 100 * 100) / 100,
          amplitude: Math.round((s.f7 || 0) / 100 * 100) / 100,
          turnover: Math.round((s.f8 || 0) / 100 * 100) / 100,
        }));

      res.json({ success: true, leaders });
    } catch (err) {
      console.warn(`[Stocks] Hot stocks fetch failed: ${err.message}`);
      res.json({ success: false, error: err.message });
    }
  });

  // GET /api/stocks/:id — get stock detail + chart data for given range
  // Query: range=1D|1W|1M|3M|1Y (default: 1M)
  router.get('/stocks/:id', async (req, res) => {
    const stock = STOCKS.find(s => s.id === req.params.id);
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    const range = (req.query.range || '1M').toUpperCase();
    if (!RANGES[range]) {
      return res.status(400).json({ success: false, error: `Invalid range: ${range}. Use 1D, 1W, 1M, 3M, or 1Y` });
    }

    // Try cache first
    const cacheKey = `${stock.id}:${range}`;
    let data = cacheGet(cacheKey);
    let dataSource;

    if (!data) {
      if (isFund(stock.id)) {
        // Funds: real NAV history from 天天基金, simulated fallback
        data = await fetchFundChart(stock.id, range);
        if (data) {
          cacheSet(cacheKey, data);
          dataSource = 'eastmoney';
        } else {
          data = generateOHLCV(stock.price, range);
          dataSource = 'simulated';
        }
      } else {
        // Try East Money
        data = await fetchEMChart(stock.id, range);
        if (data) {
          cacheSet(cacheKey, data);
          dataSource = 'eastmoney';
        } else {
          // Last resort: simulated
          data = generateOHLCV(stock.price, range);
          dataSource = 'simulated';
        }
      }
    } else {
      dataSource = 'eastmoney';
    }

    // Fetch current price
    let currentPrice = stock.price;
    let currentPrevClose = stock.prevClose;

    if (isFund(stock.id)) {
      const nav = await fetchFundNAV(stock.id);
      if (nav && nav.price != null) {
        currentPrice = Math.round(nav.price * 100) / 100;
        currentPrevClose = currentPrice - (nav.change || 0);
        currentPrevClose = Math.round(currentPrevClose * 100) / 100;
      }
    } else {
      const quote = await fetchEMQuote(stock.id, stock.type);
      if (quote && quote.price != null) {
        currentPrice = Math.round(quote.price * 100) / 100;
        currentPrevClose = currentPrice - (quote.change || 0);
        currentPrevClose = Math.round(currentPrevClose * 100) / 100;
      }
    }

    // Calculate stats from data
    const firstPrice = data.prices[0];
    const lastPrice = data.prices[data.prices.length - 1];
    const change = lastPrice - firstPrice;
    const changePct = (change / firstPrice) * 100;

    res.json({
      success: true,
      stock: {
        id: stock.id,
        name: stock.name,
        type: stock.type,
        price: currentPrice,
        prevClose: currentPrevClose,
      },
      range,
      data: {
        prices: data.prices,
        volumes: data.volumes,
        labels: data.labels,
        ohlc: data.ohlc,
      },
      stats: {
        open: firstPrice,
        close: lastPrice,
        high: Math.max(...data.prices),
        low: Math.min(...data.prices),
        change,
        changePct,
        isUp: change >= 0,
        volume: data.volumes.reduce((a, b) => a + b, 0),
        points: data.prices.length,
      },
      dataSource,
    });
  });

  // GET /api/stocks/:id/price — get current price only (for ticker updates)
  router.get('/stocks/:id/price', async (req, res) => {
    const stock = STOCKS.find(s => s.id === req.params.id);
    if (!stock) {
      return res.status(404).json({ success: false, error: 'Stock not found' });
    }

    let newPrice = stock.price;
    let changeAmount = 0;
    let changePercent = 0;

    if (isFund(stock.id)) {
      const nav = await fetchFundNAV(stock.id);
      if (nav && nav.price != null) {
        newPrice = Math.round(nav.price * 100) / 100;
        changeAmount = Math.round((nav.change || 0) * 100) / 100;
        changePercent = Math.round((nav.changePct || 0) * 100) / 100;
      } else {
        // Simulate small movement
        const volatility = stock.price * 0.002;
        changeAmount = Math.round(((Math.random() - 0.5) * volatility) * 100) / 100;
        newPrice = Math.round((stock.price + changeAmount) * 100) / 100;
        changePercent = Math.round((changeAmount / stock.price) * 10000) / 100;
      }
    } else {
      const quote = await fetchEMQuote(stock.id, stock.type);
      if (quote && quote.price != null) {
        newPrice = Math.round(quote.price * 100) / 100;
        changeAmount = Math.round((quote.change || 0) * 100) / 100;
        changePercent = Math.round((quote.changePct || 0) * 100) / 100;
      } else {
        // Simulate small movement
        const volatility = stock.price * 0.002;
        changeAmount = Math.round(((Math.random() - 0.5) * volatility) * 100) / 100;
        newPrice = Math.round((stock.price + changeAmount) * 100) / 100;
        changePercent = Math.round((changeAmount / stock.price) * 10000) / 100;
      }
    }

    res.json({
      success: true,
      price: newPrice,
      change: changeAmount,
      changePct: changePercent,
      isUp: changeAmount >= 0,
      updatedAt: Date.now(),
    });
  });

  return router;
}

module.exports = { createRouter };
