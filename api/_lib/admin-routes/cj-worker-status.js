const { requireWorker } = require('./_lib/cj-worker-auth');
const { sandboxMode, autoPayEnabled, getBalanceUsd } = require('./_lib/cj-fulfillment');
const { serverConfig, serverHeaders } = require('./_lib/supabase-server');

async function salesEnabled() {
  const { supabaseUrl } = serverConfig();
  const response = await fetch(`${supabaseUrl}/rest/v1/site_settings?id=eq.primary&select=sales_enabled&limit=1`, { headers: serverHeaders() });
  if (!response.ok) throw new Error(`settings_read_${response.status}`);
  return (await response.json())[0]?.sales_enabled === true;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!await requireWorker(req, res)) return;
    const [balanceUsd, sales] = await Promise.all([getBalanceUsd(), salesEnabled()]);
    return res.status(200).json({
      ok: true,
      cj: { sandbox: sandboxMode(), autoPay: autoPayEnabled(), balanceUsd },
      store: { salesEnabled: sales },
      safeForLiveCharge: !sandboxMode() && autoPayEnabled() && sales && balanceUsd > 0
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: String(error.message || error).slice(0, 220) });
  }
};
