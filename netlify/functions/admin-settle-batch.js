const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_USER_ID = '392d1ab1-46fd-406a-b555-681b068c2374';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method tidak diizinkan.' });
  }

  try {
    requireEnvironment();

    const accessToken = getBearerToken(event.headers || {});
    const user = await authenticateUser(accessToken);
    if (user.id !== ADMIN_USER_ID) {
      return json(403, { error: 'Akses admin tidak diizinkan.' });
    }

    const body = parseBody(event.body);
    if (!isUuid(body.batch_id)) {
      return json(400, { error: 'ID batch tidak valid.' });
    }

    const result = await callSettlement(body.batch_id, user.id);
    return json(200, result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode === 500) {
      console.error('[ADMIN SETTLEMENT] Request failed:', error.message);
    }
    return json(statusCode, {
      error: statusCode === 500 ? 'Batch gagal diselesaikan.' : error.message
    });
  }
};

function requireEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    const error = new Error('Konfigurasi admin server belum lengkap.');
    error.statusCode = 503;
    throw error;
  }
}

function getBearerToken(headers) {
  const authorization = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) {
    const error = new Error('Sesi login diperlukan.');
    error.statusCode = 401;
    throw error;
  }
  return match[1];
}

async function authenticateUser(accessToken) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) {
    const error = new Error('Sesi login tidak valid atau sudah berakhir.');
    error.statusCode = 401;
    throw error;
  }
  return response.json();
}

function parseBody(body) {
  if (typeof body !== 'string' || body.length > 1024) {
    const error = new Error('Request tidak valid.');
    error.statusCode = 400;
    throw error;
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid body');
    }
    if (Object.keys(parsed).some((key) => key !== 'batch_id')) {
      throw new Error('Unexpected input');
    }
    return parsed;
  } catch {
    const error = new Error('Request harus berisi batch_id yang valid.');
    error.statusCode = 400;
    throw error;
  }
}

async function callSettlement(batchId, adminId) {
  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/settle_batch_secure`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_batch_id: batchId,
        p_admin_id: adminId
      })
    }
  );
  const text = await response.text();
  if (!response.ok) {
    console.error('[ADMIN SETTLEMENT] Supabase RPC failed:', response.status, text.slice(0, 1000));
    const error = new Error('Database menolak penyelesaian batch.');
    error.statusCode = response.status === 409 ? 409 : 502;
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error('Response database tidak valid.');
    error.statusCode = 502;
    throw error;
  }
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
