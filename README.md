## WhatsApp Cloud API webhook (Render-ready)

This is a minimal **Node + Express** webhook app intended for Render.

It can run in two modes:
- **Forwarder (recommended for HACS)**: accept Meta WhatsApp webhooks and forward the raw payload (plus `X-Hub-Signature-256`) to your `hacs-api` WhatsApp webhook route.
- **Dump / Echo bot**: log payloads and optionally echo inbound text messages back (useful for initial Meta verification).

### Endpoints

- `GET /` — Meta webhook verification handshake (hub.mode / hub.verify_token / hub.challenge)
- `POST /` — Receives webhooks, logs payload to Render logs, and returns 200
- Also available: `GET /webhooks/whatsapp` and `POST /webhooks/whatsapp` (same handlers)
- Optional: replies `Echo: ...` for inbound `text` messages (echo mode)

### Environment variables (Render → Service → Environment)

Required for verification:
- `VERIFY_TOKEN` (any random string you choose)

Optional but recommended:
- `WHATSAPP_APP_SECRET` (enables `X-Hub-Signature-256` validation)

Required for forwarding to HACS:
- `HACS_WEBHOOK_FORWARD_URL` (your deployed `hacs-api` WhatsApp webhook URL)
  - Example: `https://<your-hacs-api>.onrender.com/webhooks/whatsapp`

Required for echo replies:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION` (default `v22.0`)

Control:
- `WHATSAPP_ECHO_REPLY=0` to disable echo replies
  - When `HACS_WEBHOOK_FORWARD_URL` is set, echo defaults to **disabled** to avoid double replies (echo + HACS agent).

### Deploy on Render (via UI)

1) Create a new GitHub repo and copy these files into it:
   - `app.js`
   - `package.json`
   - `.gitignore`
   - `README.md`

2) In Render:
   - New → Web Service
   - Connect your repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Add env vars above

3) In Meta App Dashboard (WhatsApp Webhooks):
   - Callback URL: `https://<render-service>.onrender.com/`
   - Verify token: same value as `VERIFY_TOKEN`
   - Subscribe to `messages`

If verification succeeds, Render logs will show **`WEBHOOK VERIFIED`**.

### Using with HACS

Set:
- `HACS_WEBHOOK_FORWARD_URL=https://<your-hacs-api>.onrender.com/webhooks/whatsapp`
- `WHATSAPP_ECHO_REPLY=0`

On the `hacs-api` deployment, you should also configure `WHATSAPP_APP_SECRET` so the forwarded payload signature can be verified end-to-end.

### Deploy on Render (optional blueprint)

If you prefer Render Blueprints, keep `render.yaml` in the repo and use Render’s “Blueprint” flow.


