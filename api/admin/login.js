const { verifyCredentials, createSession, setSessionCookie, audit } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const username = String(body.username || '').trim();
    const password = String(body.password || '');

    if (!username || !password || username.length > 80 || password.length > 200) {
      return res.status(400).json({ ok: false, error: 'invalid_login' });
    }

    const valid = await verifyCredentials(username, password);
    if (!valid) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return res.status(401).json({ ok: false, error: 'invalid_login' });
    }

    const session = await createSession();
    setSessionCookie(res, session.token);
    await audit('login', 'admin', username, {});
    return res.status(200).json({ ok: true, expiresAt: session.expiresAt });
  } catch (error) {
    console.error('admin login error', error);
    return res.status(500).json({ ok: false, error: 'login_failed' });
  }
};
