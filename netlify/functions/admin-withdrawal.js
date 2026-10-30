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
    const user = await authenticateUser(getBearerToken(event.headers || {}));
    if (user.id !== ADMIN_USER_ID) {
      return json(403, { error: 'Akses admin tidak diizinkan.' });
    }

    const body = parseBody(event.body);
    if (!isUuid(body.withdraw_id) ||
        !['approved', 'rejected'].includes(body.decision) ||
        (body.notes !== undefined && typeof body.notes !== 'string') ||
        (body.notes || '').length > 1000) {
      return json(400, { error: 'Data keputusan withdraw tidak valid.' });
    }

    const result = await decideWithdrawal(body, user.id);
    return json(200, result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode === 500) {
      console.error('[ADMIN WITHDRAWAL] Request failed:', error.message);
    }
    return json(statusCode, {
      error: statusCode === 500 ? 'Keputusan withdraw gagal diproses.' : error.message
    });
  }
};

function requireEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];
  if (required.some((name) => !process.env[name])) {
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
  if (typeof body !== 'string' || body.length > 2048) {
    const error = new Error('Request tidak valid.');
    error.statusCode = 400;
    throw error;
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
        Object.keys(parsed).some((key) => !['withdraw_id', 'decision', 'notes'].includes(key))) {
      throw new Error('Invalid body');
    }
    return parsed;
  } catch {
    const error = new Error('Format request withdraw tidak valid.');
    error.statusCode = 400;
    throw error;
  }
}

async function decideWithdrawal(body, adminId) {
  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/decide_worker_withdrawal`,
    {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        p_withdraw_id: body.withdraw_id,
        p_admin_id: adminId,
        p_decision: body.decision,
        p_notes: body.notes || null
      })
    }
  );
  const text = await response.text();
  if (!response.ok) {
    console.error('[ADMIN WITHDRAWAL] Supabase RPC failed:', response.status, text.slice(0, 1000));
    const error = new Error('Database menolak keputusan withdraw.');
    error.statusCode = 502;
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
