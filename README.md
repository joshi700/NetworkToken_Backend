# Network Token Testing Tool

A Postman-style tool for Mastercard Gateway network tokenisation. It is laid out like
[Flow_3DS](https://github.com/joshi700/Flow_3DS): a single Settings page, then flows that run one editable API call at a time.

| Flow | Steps |
|------|-------|
| 1. Tokenise → Payment Data → Pay | `POST /token` → `GET /token/{id}` (optional) → `POST /token/{id}/paymentData` → `PUT /order/{o}/transaction/{t}` (PAY with token + DPAN/cryptogram/ECI) |
| 2. Tokenise → Payment Data → Pay outside | Same as flow 1 up to paymentData, then a hand-off panel with the DPAN, expiry, cryptogram and ECI to send to another processor |
| 3. Tokenise only | `POST /token` → `GET /token/{id}` (optional) |

## Structure

```
backend/   Express proxy (deployable to Vercel). POST /api/gateway forwards {method,url,body} to *.gateway.mastercard.com
frontend/  React + Vite + Tailwind (deployable to Vercel)
legacy/    Previous single-page Express version
```

## Run locally

```bash
npm --prefix backend install && npm --prefix backend run dev     # http://localhost:3006
npm --prefix frontend install && npm --prefix frontend run dev   # http://localhost:5173
```

The frontend reads `VITE_BACKEND_URL` (default `http://localhost:3006`).

## Gateway prerequisites

- The merchant's token repository must be enabled for **scheme tokenization**, with a Random or Preserve 6.4 token strategy (for `POST /token`).
- All requests use the **API password** by default. Some merchant profiles (including the MTF test merchant `GJMIDTESTING`) only allow
  Generate Payment Data with SSL client-certificate authentication, and the gateway returns
  *"You must use SSL certificate authentication … to retrieve payment details for a scheme token."*
  To fix it, ask your service provider to allow password access, or turn on certificate auth in Settings
  (paste the PEM cert and key, or set `GATEWAY_CLIENT_CERT` / `GATEWAY_CLIENT_KEY` on the backend).
- The DPAN comes back masked unless `responseControls.sensitiveData` is `UNMASK` (Settings → Network Token Options) and your profile allows it.
- The test card must be eligible for MDES/VTS. On MTF, `5123450000000008` returns `schemeToken.status = TOKENIZATION_UNAVAILABLE`.
