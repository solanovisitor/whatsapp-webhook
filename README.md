## WhatsApp Cloud API webhook (Render-ready)

This is a minimal **Node + Express** webhook app to validate the Meta WhatsApp Cloud API flow before integrating HACS agents.

### Endpoints

- `GET /` — Meta webhook verification handshake (hub.mode / hub.verify_token / hub.challenge)
- `POST /` — Receives webhooks, logs payload to Render logs, and returns 200
- Optional: replies `Echo: ...` for inbound `text` messages

### Environment variables (Render → Service → Environment)

Required for verification:
- `VERIFY_TOKEN` (any random string you choose)

Optional but recommended:
- `WHATSAPP_APP_SECRET` (enables `X-Hub-Signature-256` validation)

Required for echo replies:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_API_VERSION` (default `v22.0`)

Control:
- `WHATSAPP_ECHO_REPLY=0` to disable echo replies (dump-only mode)

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

### Deploy on Render (optional blueprint)

If you prefer Render Blueprints, keep `render.yaml` in the repo and use Render’s “Blueprint” flow.


