const crypto = require('crypto');

const CALLBACK_URL = 'https://aluf-hakelim-v2-ready.vercel.app/api/aliexpress/callback';
const APP_KEY = process.env.ALIEXPRESS_APP_KEY || '542860';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).send('Method Not Allowed');
  }

  const state = crypto.randomBytes(24).toString('hex');
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `ae_oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: APP_KEY,
    redirect_uri: CALLBACK_URL,
    state,
    force_auth: 'true'
  });

  return res.redirect(`https://api-sg.aliexpress.com/oauth/authorize?${params.toString()}`);
};
