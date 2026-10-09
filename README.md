# Network Token Testing Tool

A Postman-style tool for Mastercard Gateway network tokenisation. It is laid out like
[Flow_3DS](https://github.com/joshi700/Flow_3DS): a single Settings page, then flows that run one editable API call at a time.

| Flow | Model | Steps |
|------|-------|-------|
| 1. Tokenise → Payment Data → Pay | Fully managed | `POST /token` → `GET /token/{id}` (optional) → `POST /token/{id}/paymentData` → `PUT …/transaction` (PAY with the token, plus DPAN/cryptogram/ECI when available) |
| 2. Tokenise → Payment Data → Pay outside | Standalone tokenisation | Same as flow 1 up to paymentData, then a hand-off panel for an external PSP |
| 3. Tokenise only | Token provisioning | `POST /token` → `GET /token/{id}` (optional) |
| 4. Pay with external network token | Pass-through | `PUT …/transaction` with `sourceOfFunds.type=SCHEME_TOKEN` and a network token + cryptogram from outside the gateway |

The **Unified Tokenisation** page (`/learn`) explains the models (fully managed, token processing service, standalone,
external token processing service, pass-through), how to transact with an external PSP using network tokens, and the SSL
certificate requirement.

## Structure

```
backend/   Express proxy (deployable to Vercel). POST /api/gateway forwards {method,url,body} to *.gateway.mastercard.com
frontend/  React + Vite + Tailwind (deployable to Vercel)
legacy/    Previous single-page Express version
```

## Run locally

```bash
npm --prefix backend install && npm --prefix backend run dev     # http://localhost:3006
npm --prefix frontend install && npm --prefix frontend run dev   # http://localhost:5174
```

The frontend reads `VITE_BACKEND_URL` (default `http://localhost:3006`).

## Gateway prerequisites

- The merchant's token repository must be enabled for **scheme tokenization**, with a Random or Preserve 6.4 token strategy (for `POST /token`).
- **Generate Payment Data (standalone tokenisation) needs SSL client-certificate authentication.** With the API password the gateway returns
  *"You must use SSL certificate authentication … to retrieve payment details for a scheme token."* It also needs:
  standalone tokenisation enabled by your PSP, an `ACTIVE` network token, and the **certificate-auth host name** from your PSP
  (different from the password host). Add the certificate and host in Settings → SSL Certificate, or set
  `GATEWAY_CLIENT_CERT` / `GATEWAY_CLIENT_KEY` on the backend.
  The certificate must be X.509 from a Mastercard-approved CA (for example DigiCert), with `clientAuth` key usage and the merchant
  name in the subject, and your PSP must register it in Merchant Manager.
- Without a certificate, use **Load sample response** on the Generate Payment Data step to demo Flows 1 and 2. The sample is
  clearly labelled and is never sent to the gateway.
- All other calls use the API password.
- The DPAN comes back masked unless `responseControls.sensitiveData` is `UNMASK` (Settings → Network Token Options) and your profile allows it.
- Standalone test cards (MTF, expiry 01/39): Mastercard `5111111111111118`, `2223000000000007`; Visa `4012000033330026`. On `GJMIDTESTING` they still return `TOKENIZATION_UNAVAILABLE`, which means the profile isn't enabled for network tokenisation.
- Pass-through MDES test token: `5204247750001497`.
