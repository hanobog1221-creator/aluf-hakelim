const ALLOWED_HOSTS = [
  'cjdropshipping.com',
  'aliyuncs.com'
];

function allowedHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  try {
    const source = new URL(String(req.query?.url || ''));
    if (source.protocol !== 'https:' || !allowedHost(source.hostname)) return res.status(400).end();
    const response = await fetch(source, { headers: { Accept: 'image/avif,image/webp,image/*' }, redirect: 'follow' });
    if (!response.ok) return res.status(404).end();
    const type = String(response.headers.get('content-type') || '').toLowerCase();
    if (!type.startsWith('image/')) return res.status(415).end();
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(413).end();
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000');
    return res.status(200).send(bytes);
  } catch {
    return res.status(400).end();
  }
};
