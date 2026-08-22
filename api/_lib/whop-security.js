const crypto = require('crypto');

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function whopConfig(env = process.env) {
  const apiKey = clean(env.WHOP_API_KEY, 1000);
  const webhookSecret = clean(env.WHOP_WEBHOOK_SECRET, 1000);
  const companyId = clean(env.WHOP_COMPANY_ID, 100);
  if (!apiKey || !/^biz_[A-Za-z0-9]+$/.test(companyId)) throw new Error('whop_not_configured');
  return {
    apiKey,
    webhookSecret,
    companyId,
    baseUrl: 'https://api.whop.com/api/v1',
    currency: 'ILS'
  };
}

function signatureCandidates(value) {
  return clean(value, 4000)
    .split(/\s+/)
    .map((entry) => entry.split(',', 2))
    .filter(([version, signature]) => version === 'v1' && signature)
    .map(([, signature]) => signature);
}

function verifyWhopSignature(rawBody, headers, secret, nowMs = Date.now()) {
  const webhookId = clean(headers?.['webhook-id'], 300);
  const timestampText = clean(headers?.['webhook-timestamp'], 30);
  const signatures = signatureCandidates(headers?.['webhook-signature']);
  const timestamp = Number(timestampText);
  if (!webhookId || !Number.isInteger(timestamp) || !signatures.length || !secret) return false;
  if (Math.abs(nowMs - timestamp * 1000) > 5 * 60 * 1000) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const signed = `${webhookId}.${timestampText}.${body}`;
  const expected = crypto.createHmac('sha256', String(secret)).update(signed, 'utf8').digest();
  return signatures.some((candidate) => {
    let supplied;
    try { supplied = Buffer.from(candidate, 'base64'); } catch { return false; }
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  });
}

function whopOrderId(event) {
  const orderId = clean(event?.data?.metadata?.order_id, 80).toUpperCase();
  return /^AH-[A-Z0-9-]{5,60}$/.test(orderId) ? orderId : null;
}

module.exports = { whopConfig, verifyWhopSignature, whopOrderId };
