const crypto = require('crypto');
const { requireAdmin } = require('../_lib/admin');

const CALLBACK_URL = 'https://aluf-hakelim-v2-ready.vercel.app/api/aliexpress/callback';
const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';

function signedState() {
  const secret = process.env.ALIEXPRESS_APP_SECRET;
  if (!secret) throw new Error('aliexpress_app_secret_missing');
  const nonce = crypto.randomBytes(24).toString('hex');
  const signature = crypto.createHmac('sha256', secret).update(nonce, 'utf8').digest('hex');
  return `${nonce}.${signature}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }
  if (!await requireAdmin(req, res)) return;

  try {
    const state = signedState();
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `ae_oauth_state=${encodeURIComponent(state)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: APP_KEY,
      redirect_uri: CALLBACK_URL,
      state,
      force_auth: 'true'
    });
    return res.redirect(`https://api-sg.aliexpress.com/oauth/authorize?${params.toString()}`);
  } catch (error) {
    console.error('AliExpress OAuth start failed', String(error.message || error));
    return res.status(500).send('AliExpress connection is not configured.');
  }
};
