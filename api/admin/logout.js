const { SESSION_COOKIE, parseCookies, deleteSession, audit, requireSameOrigin } = require('../_lib/admin');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }
  if (!requireSameOrigin(req, res)) return;

  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token) await deleteSession(token);
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
    await audit('logout', 'admin', 'admin', {});
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('admin logout error', error);
    return res.status(200).json({ ok: true });
  }
};
