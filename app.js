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
// Optional forward to HACS API (recommended).
//
// NOTE: we do NOT default this to any URL to avoid accidentally forwarding PHI to the wrong place.
// Set HACS_WEBHOOK_FORWARD_URL in Render env to enable forwarding, e.g.
//   https://<your-hacs-api>.onrender.com/webhooks/whatsapp
const forwardUrl = (process.env.HACS_WEBHOOK_FORWARD_URL || "").trim();

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

async function forwardToHacsWebhook(rawBody, signatureHeader) {
  const url = String(forwardUrl || "").trim();
  if (!url) return { ok: false, error: "forward_url_missing" };
  try {
    const headers = {
      "Content-Type": "application/json",
    };
    if (signatureHeader) headers["X-Hub-Signature-256"] = String(signatureHeader);
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: rawBody, // preserve bytes so signature remains valid end-to-end
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      throw new Error(`forward_failed status=${res.status} body=${text.slice(0, 500)}`);
    }
    return { ok: true, status: res.status, body: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
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
function handleVerify(req, res) {
  const { "hub.mode": mode, "hub.challenge": challenge, "hub.verify_token": token } = req.query;

  if (!verifyToken) return res.status(500).send("VERIFY_TOKEN not set");

  if (mode === "subscribe" && token === verifyToken) {
    console.log("WEBHOOK VERIFIED");
    return res.status(200).send(String(challenge || ""));
  }
  return res.status(403).end();
}

// Support both "/" and "/webhooks/whatsapp" so you can point Meta to either path.
app.get("/", handleVerify);
app.get("/webhooks/whatsapp", handleVerify);

async function handleWebhook(req, res) {
  const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const timestamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\n\nWebhook POST received ${timestamp} path=${req.path}\n`);
  if (!verifySignature(req, rawBody)) {
    console.log("invalid_signature");
    return res.status(403).json({ ok: false, error: "invalid_signature" });
  }

  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body || {}, null, 2));

  const msgs = extractInboundTextMessages(req.body || {});
  res.status(200).end();

  // Option B: forward webhook payload to hacs-api.
  //
  // We forward the raw bytes + signature header so HACS can re-verify end-to-end.
  // This is safe even for non-message callbacks; HACS will ignore what it doesn't need.
  if (forwardUrl) {
    const sigHeader = req.get("X-Hub-Signature-256") || "";
    forwardToHacsWebhook(rawBody, sigHeader).then((out) => {
      if (out?.ok) console.log(`[forward] ok url=${forwardUrl} status=${out.status}`);
      else console.log(`[forward] failed url=${forwardUrl} error=${out?.error}`);
    });
  }

  // Default behavior:
  // - if forwarding is enabled -> do NOT echo (avoid double replies: echo + HACS agent)
  // - otherwise -> echo is enabled unless WHATSAPP_ECHO_REPLY=0
  const echoEnv = process.env.WHATSAPP_ECHO_REPLY;
  const echoEnabled =
    echoEnv != null
      ? String(echoEnv).toLowerCase() !== "0"
      : forwardUrl
        ? false
        : true;
  if (!echoEnabled) return;

  for (const m of msgs) {
    const reply = `Echo: ${m.text}`;
    sendWhatsAppText(m.from, reply).catch((e) => console.error("[send-error]", e?.message || e));
  }
}

// Support both "/" and "/webhooks/whatsapp" so you can point Meta to either path.
app.post("/", handleWebhook);
app.post("/webhooks/whatsapp", handleWebhook);

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});


