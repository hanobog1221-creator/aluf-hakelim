const { requireWorker } = require('../_lib/cj-worker-auth');
const { syncAllActiveAliExpressProducts } = require('../_lib/aliexpress-catalog-sync');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (!await requireWorker(req, res)) return;

  try {
    const result = await syncAllActiveAliExpressProducts();
    return res.status(200).json({ ok: true, checkedAt: new Date().toISOString(), ...result });
  } catch (error) {
    console.error('AliExpress catalog worker failed:', error.message);
    return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 220) });
  }
};
