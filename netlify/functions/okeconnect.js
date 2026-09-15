const VPS_PROXY_URL = process.env.VPS_PROXY_URL;
const PROXY_SECRET_TOKEN = process.env.PROXY_SECRET_TOKEN;

exports.handler = async (event) => {
  try {
    if (!VPS_PROXY_URL) {
      return json(500, {
        success: false,
        message: 'VPS_PROXY_URL belum diset di Netlify'
      });
    }

    if (!PROXY_SECRET_TOKEN) {
      return json(500, {
        success: false,
        message: 'PROXY_SECRET_TOKEN belum diset di Netlify'
      });
    }

    // Ambil endpoint terakhir:
    // /.netlify/functions/okeconnect/withdraw
    // /.netlify/functions/okeconnect/check-status
    const parts = event.path.split('/').filter(Boolean);
    const action = parts[parts.length - 1];

    // Health check
    if (
      event.httpMethod === 'GET' &&
      action === 'okeconnect'
    ) {
      return json(200, {
        success: true,
        message: 'Netlify OkeConnect bridge aktif'
      });
    }

    if (!['withdraw', 'check-status'].includes(action)) {
      return json(404, {
        success: false,
        message: 'Endpoint tidak ditemukan'
      });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, {
        success: false,
        message: 'Method tidak diizinkan'
      });
    }

    const targetUrl = `${VPS_PROXY_URL.replace(/\/$/, '')}/${action}`;

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-token': PROXY_SECRET_TOKEN
      },
      body: event.body || '{}'
    });

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      data = {
        success: false,
        message: text || 'Response VPS tidak valid'
      };
    }

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify(data)
    };

  } catch (error) {
    console.error('OkeConnect bridge error:', error);

    return json(502, {
      success: false,
      message: 'Gagal menghubungi VPS',
      error: error.message
    });
  }
};

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