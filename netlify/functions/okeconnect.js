
const VPS_PROXY_URL = process.env.VPS_PROXY_URL;
const PROXY_SECRET_TOKEN = process.env.PROXY_SECRET_TOKEN;

exports.handler = async (event) => {
  try {
    // =========================
    // CHECK ENV
    // =========================
    if (!VPS_PROXY_URL) {
      return json(500, {
        success: false,
        stage: 'netlify_env',
        message: 'VPS_PROXY_URL belum diset di Netlify'
      });
    }

    if (!PROXY_SECRET_TOKEN) {
      return json(500, {
        success: false,
        stage: 'netlify_env',
        message: 'PROXY_SECRET_TOKEN belum diset di Netlify'
      });
    }

    // =========================
    // GET PATH / ACTION
    // =========================
    const parts = event.path
      .split('/')
      .filter(Boolean);

    const action = parts[parts.length - 1];

    // =========================
    // HEALTH CHECK
    // =========================
    if (
      event.httpMethod === 'GET' &&
      action === 'okeconnect'
    ) {
      return json(200, {
        success: true,
        message: 'Netlify OkeConnect bridge aktif',
        vps_url_configured: true,
        token_configured: true
      });
    }

    // =========================
    // ALLOWED ENDPOINT
    // =========================
    if (!['withdraw', 'check-status'].includes(action)) {
      return json(404, {
        success: false,
        stage: 'routing',
        message: 'Endpoint tidak ditemukan',
        action
      });
    }

    // =========================
    // METHOD CHECK
    // =========================
    if (event.httpMethod !== 'POST') {
      return json(405, {
        success: false,
        stage: 'method',
        message: 'Method tidak diizinkan'
      });
    }

    // =========================
    // TARGET VPS
    // =========================
    const targetUrl =
      `${VPS_PROXY_URL.replace(/\/$/, '')}/${action}`;

    console.log('[OKE BRIDGE] Action:', action);
    console.log('[OKE BRIDGE] Target:', targetUrl);

    // =========================
    // REQUEST KE VPS
    // =========================
    let response;

    try {
      response = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-proxy-token': PROXY_SECRET_TOKEN
        },
        body: event.body || '{}'
      });
    } catch (fetchError) {
      console.error(
        '[OKE BRIDGE] FETCH VPS ERROR:',
        fetchError
      );

      return json(502, {
        success: false,
        stage: 'netlify_to_vps',
        message: 'Netlify gagal menghubungi VPS',
        error: fetchError?.message || String(fetchError),
        target: targetUrl
      });
    }

    // =========================
    // READ VPS RESPONSE
    // =========================
    const text = await response.text();

    console.log(
      '[OKE BRIDGE] VPS STATUS:',
      response.status
    );

    console.log(
      '[OKE BRIDGE] VPS RESPONSE:',
      text
    );

    let data;

    try {
      data = JSON.parse(text);
    } catch (parseError) {
      return json(502, {
        success: false,
        stage: 'vps_response',
        message: 'Response dari VPS bukan JSON',
        http_status: response.status,
        raw_response: text
      });
    }

    // =========================
    // VPS ERROR
    // =========================
    if (!response.ok) {
      return json(response.status, {
        success: false,
        stage: 'vps',
        message:
          data?.message ||
          `VPS mengembalikan HTTP ${response.status}`,
        http_status: response.status,
        vps_response: data
      });
    }

    // =========================
    // SUCCESS
    // =========================
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error(
      '[OKE BRIDGE] GENERAL ERROR:',
      error
    );

    return json(500, {
      success: false,
      stage: 'netlify_function',
      message: 'Internal error pada Netlify Function',
      error: error?.message || String(error)
    });
  }
};


// =========================
// JSON HELPER
// =========================
function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(data)
  };
}
