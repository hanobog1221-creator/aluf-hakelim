module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serverKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serverKey) {
    return res.status(503).json({
      ok: false,
      checks: { catalog: false, storeSettings: false, privilegedBackend: false }
    });
  }

  const headers = { apikey: serverKey, Authorization: `Bearer ${serverKey}` };
  try {
    const [catalog, settings, privileged] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/products?select=id&limit=1`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/site_settings?select=id,sales_enabled&limit=1`, { headers }),
      // No credential or row content is ever returned. This verifies that the backend key
      // can access a table intentionally unavailable to public roles.
      fetch(`${supabaseUrl}/rest/v1/admin_credentials?select=username&limit=1`, { headers })
    ]);

    const checks = {
      catalog: catalog.ok,
      storeSettings: settings.ok,
      privilegedBackend: privileged.ok
    };
    return res.status(checks.catalog && checks.storeSettings ? 200 : 503).json({
      ok: checks.catalog && checks.storeSettings && checks.privilegedBackend,
      checks
    });
  } catch (error) {
    console.error('health probe failed', error);
    return res.status(503).json({
      ok: false,
      checks: { catalog: false, storeSettings: false, privilegedBackend: false }
    });
  }
};
