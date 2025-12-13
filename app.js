/* Minimal WhatsApp Cloud API webhook for Render (Echo Bot / Dump Bot).
 *
 * Matches Meta docs flow:
 * - GET / verification handshake (hub.mode, hub.verify_token, hub.challenge)
 * - POST / logs webhook payload and returns 200
 *
 * Optional: echo-reply via Cloud API when WHATSAPP_ECHO_REPLY != "0".
 */

/* eslint-disable no-console */
const crypto = require("crypto");
const express = require("express");

// Local dev only. On Render, env vars are injected by the platform.
try {
  require("dotenv").config();
} catch (_) {}

const app = express();
const port = process.env.PORT || 3000;

// Meta docs use VERIFY_TOKEN; HACS naming uses WHATSAPP_VERIFY_TOKEN
const verifyToken = process.env.VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || "";

// Cloud API outbound (optional for pure dump bot)
const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || "";
const phoneNumberId = String(process.env.WHATSAPP_PHONE_NUMBER_ID || "").replace(/\D/g, "");
const apiVersionRaw = (process.env.WHATSAPP_API_VERSION || "v22.0").trim();
const apiVersion = apiVersionRaw.startsWith("v") ? apiVersionRaw : `v${apiVersionRaw}`;

// Optional signature verification (recommended)
const appSecret = process.env.WHATSAPP_APP_SECRET || "";

function digitsOnly(v) {
  return String(v || "").replace(/\D/g, "");
}

function verifySignature(req, rawBody) {
  if (!appSecret) return true; // best-effort mode
  const sig = req.get("X-Hub-Signature-256") || "";
  if (!sig.startsWith("sha256=")) return false;
  const provided = sig.slice("sha256=".length).trim();
  const digest = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(digest));
  } catch (_) {
    return false;
  }
}

async function sendWhatsAppText(to, body) {
  if (!accessToken || !phoneNumberId) {
    throw new Error("Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID");
  }
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to: digitsOnly(to),
    type: "text",
    text: { body: String(body || "") },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp API error: ${JSON.stringify(json)}`);
  return json;
}

function extractInboundTextMessages(payload) {
  const out = [];
  const entry = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const e of entry) {
    const changes = Array.isArray(e?.changes) ? e.changes : [];
    for (const c of changes) {
      const value = c?.value || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];
      for (const m of messages) {
        if (!m || typeof m !== "object") continue;
        if (m.type !== "text") continue;
        const from = m.from;
        const text = m?.text?.body;
        if (from && text) out.push({ from, text });
      }
    }
  }
  return out;
}

// Capture raw body for signature verification
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// GET / (verification handshake)
app.get("/", (req, res) => {
  const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query;

  if (!verifyToken) return res.status(500).send("VERIFY_TOKEN not set");

  if (mode === "subscribe" && token === verifyToken) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(String(challenge || ""));
  }
  return res.status(403).end();
});

// POST / (dump payload + optional echo reply)
app.post("/", async (req, res) => {
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (!verifySignature(req, rawBody)) {
    return res.status(403).json({ ok: false, error: "invalid_signature" });
  }

  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body || {}, null, 2));

  const msgs = extractInboundTextMessages(req.body || {});
  res.status(200).end();

  const echoEnabled = String(process.env.WHATSAPP_ECHO_REPLY || "1").toLowerCase() !== "0";
  if (!echoEnabled) return;

  for (const m of msgs) {
    const reply = `Echo: ${m.text}`;
    sendWhatsAppText(m.from, reply).catch((e) => console.error("[send-error]", e?.message || e));
  }
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});


