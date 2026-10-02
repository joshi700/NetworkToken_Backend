const express = require('express');
const cors = require('cors');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3006;

// Allowed origins for CORS
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || /\.vercel\.app$/.test(new URL(origin).hostname)) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy does not allow access from the specified origin.'), false);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.json({ limit: '1mb' }));

// Only forward requests to Mastercard gateway hosts so this can't be used as an open proxy
const ALLOWED_HOST_SUFFIXES = (process.env.ALLOWED_GATEWAY_HOSTS || 'gateway.mastercard.com')
  .split(',')
  .map(h => h.trim().toLowerCase())
  .filter(Boolean);

const isAllowedGatewayUrl = (rawUrl) => {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase();
    return u.protocol === 'https:' &&
      ALLOWED_HOST_SUFFIXES.some(s => host === s || host.endsWith(`.${s}`) || host.endsWith(`-${s}`));
  } catch {
    return false;
  }
};

const authHeader = (merchantId, password) =>
  'Basic ' + Buffer.from(`merchant.${merchantId}:${password}`).toString('base64');

// PEM content, or a path to a PEM file, from env — used when the UI doesn't supply a certificate
const readPem = (value) => {
  if (!value) return undefined;
  if (value.includes('-----BEGIN')) return value.replace(/\\n/g, '\n');
  try { return fs.readFileSync(value, 'utf8'); } catch { return undefined; }
};
const ENV_CERT = readPem(process.env.GATEWAY_CLIENT_CERT);
const ENV_KEY = readPem(process.env.GATEWAY_CLIENT_KEY);
const ENV_PASSPHRASE = process.env.GATEWAY_CLIENT_KEY_PASSPHRASE;

// Returns axios options for the requested auth method
const buildAuth = (config, auth) => {
  if (auth === 'certificate') {
    const cert = config.clientCert || ENV_CERT;
    const key = config.clientKey || ENV_KEY;
    if (!cert || !key) {
      return { error: 'Certificate authentication needs a client certificate and private key (Settings → Certificate Authentication, or GATEWAY_CLIENT_CERT / GATEWAY_CLIENT_KEY on the backend)' };
    }
    try {
      return {
        headers: {},
        httpsAgent: new https.Agent({ cert, key, passphrase: config.clientKeyPassphrase || ENV_PASSPHRASE || undefined })
      };
    } catch (e) {
      return { error: `Invalid certificate or key: ${e.message}` };
    }
  }
  if (!config.password) return { error: 'API Password is required' };
  return { headers: { Authorization: authHeader(config.merchantId, config.password) } };
};

const validateConfig = (config) => {
  if (!config) return 'Missing config';
  if (!config.merchantId) return 'Merchant ID is required';
  return null;
};

/**
 * Generic gateway proxy — the frontend owns method, URL and body (Postman style).
 * Body: { config: { merchantId, password, clientCert?, clientKey?, clientKeyPassphrase? },
 *         auth: 'password' | 'certificate', method, url, body }
 */
app.post('/api/gateway', async (req, res) => {
  const { config, auth = 'password', method = 'GET', url, body } = req.body || {};

  const configError = validateConfig(config);
  if (configError) return res.status(400).json({ success: false, error: configError });

  const httpMethod = String(method).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(httpMethod)) {
    return res.status(400).json({ success: false, error: `Unsupported method ${method}` });
  }
  if (!isAllowedGatewayUrl(url)) {
    return res.status(400).json({
      success: false,
      error: 'URL must be https and point to a Mastercard gateway host',
      allowedHosts: ALLOWED_HOST_SUFFIXES
    });
  }

  const authOptions = buildAuth(config, auth);
  if (authOptions.error) return res.status(400).json({ success: false, error: authOptions.error });

  const started = Date.now();
  try {
    const response = await axios({
      method: httpMethod,
      url,
      data: ['GET', 'DELETE'].includes(httpMethod) ? undefined : (body ?? {}),
      headers: { 'Content-Type': 'application/json', ...authOptions.headers },
      httpsAgent: authOptions.httpsAgent,
      timeout: 30000,
      validateStatus: () => true
    });

    console.log(`[${auth}] ${httpMethod} ${url} -> ${response.status} (${Date.now() - started}ms)`);
    res.json({
      success: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      durationMs: Date.now() - started,
      data: response.data
    });
  } catch (error) {
    console.error(`${httpMethod} ${url} failed:`, error.message);
    res.status(502).json({
      success: false,
      status: 0,
      durationMs: Date.now() - started,
      error: 'Network Error',
      data: { error: { explanation: error.message } }
    });
  }
});

// Validate credentials with a lightweight authenticated call
app.post('/api/test-config', async (req, res) => {
  const { merchantId, password, apiBaseUrl, apiVersion = '100' } = req.body || {};
  const configError = validateConfig({ merchantId }) || (!password && 'API Password is required');
  if (configError) return res.status(400).json({ success: false, error: configError });

  const url = `${String(apiBaseUrl).replace(/\/$/, '')}/api/rest/version/${apiVersion}/merchant/${merchantId}/paymentOptionsInquiry`;
  if (!isAllowedGatewayUrl(url)) {
    return res.status(400).json({ success: false, error: 'Gateway URL must be https and a Mastercard gateway host' });
  }

  try {
    const response = await axios.post(url, {}, {
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(merchantId, password) },
      timeout: 15000,
      validateStatus: () => true
    });
    if (response.status === 401 || response.status === 403) {
      return res.status(401).json({ success: false, error: 'Authentication failed — check Merchant ID / API password', data: response.data });
    }
    res.json({ success: response.status < 400, status: response.status, data: response.data });
  } catch (error) {
    res.status(502).json({ success: false, error: 'Cannot reach gateway', details: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    allowedHosts: ALLOWED_HOST_SUFFIXES,
    serverCertificateConfigured: Boolean(ENV_CERT && ENV_KEY)
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Not Found', details: `Route ${req.method} ${req.path} not found` });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`🚀 Network Token API proxy running at http://localhost:${port}`);
  });
}

module.exports = app;
