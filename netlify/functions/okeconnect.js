const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VPS_PROXY_URL = process.env.VPS_PROXY_URL;
const PROXY_SECRET_TOKEN = process.env.PROXY_SECRET_TOKEN;

const EWALLET_PRODUCTS = {
  DANA: {
    fee: 1000,
    tiers: [1,2,3,4,5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,200,250,300,400,500,600,700,800,900,1000]
  },
  OVO: {
    fee: 1000,
    tiers: [10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000]
  },
  GOPAY: {
    fee: 1500,
    tiers: [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,200,250,300,400,500,600,700,800,900,1000]
  },
  SHOPEEPAY: {
    fee: 1000,
    tiers: [1,2,3,4,5,6,7,8,9,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,200,250,300,350,400,450,500,550,600,650,700,750,800,850,900,950,1000]
  }
};

const PULSA_TIERS = {
  telkomsel: [2,3,4,5,6,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,105,110,115,120,125,130,135,140,145,150,200],
  indosat: [5,10,12,15,20,25,30,35,40,45,50,55,60,65,70,80,85,90,100,105,115,125,150,175,200,225,250,300,400,500,1000],
  xl: [5,10,15,25,30,40,50,60,70,80,90,100,150,200,300,500,1000],
  axis: [5,10,15,25,30,40,50,60,70,80,90,100,150,200,300,500,1000],
  three: [5,10,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,100,105,125,150,200,500],
  smartfren: [5,10,12,15,20,25,30,35,40,45,50,55,60,65,70,75,80,85,90,95,100,125,150,200,250,300,500]
};

const PULSA_PREFIXES = {
  telkomsel: 'S',
  indosat: 'I',
  xl: 'X',
  axis: 'A',
  three: 'T',
  smartfren: 'SM'
};

const MASA_PRODUCTS = {
  telkomsel: [['MAST5',3098],['MAST10',4473],['MAST15',6473],['MAST30',14468],['MAST90',31850],['MAST180',58095],['MAST300',98175],['MAST330',107175],['MAST360',108270]],
  three: [['MSTH1',14200],['MSTH4N',25150],['MSTH5',29150],['MSTH3',32100],['MSTH7',39200],['MSTH8',41200],['MSTH9',43200],['MSTH10',45200],['MSTH11',49200],['MSTH6',56600]],
  indosat: [['IMSA15',7255],['IMSA1',13725],['IMSA90',32948],['IMSA180',55163],['IMSA360',106175]],
  xl: [['MAXLA',4950]],
  axis: [['MASA30',5000]]
};

const PULSA_PRODUCTS_BY_CODE = new Map();
for (const [operator, tiers] of Object.entries(PULSA_TIERS)) {
  for (const tier of tiers) {
    let code = PULSA_PREFIXES[operator] + tier;
    if (tier === 1000 && ['indosat', 'xl', 'axis'].includes(operator)) {
      code = { indosat: 'I1JT', xl: 'X1JT', axis: 'A1JT' }[operator];
    }
    PULSA_PRODUCTS_BY_CODE.set(code, { amount: tier * 1000, fee: 2000 });
  }
}

const MASA_PRODUCTS_BY_CODE = new Map(
  Object.values(MASA_PRODUCTS).flat().map(([code, amount]) => [code, { amount, fee: 2000 }])
);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

exports.handler = async (event) => {
  try {
    const action = event.queryStringParameters?.action ||
      String(event.path || '').split('/').filter(Boolean).pop();

    if (event.httpMethod === 'GET' && action === 'okeconnect') {
      return json(200, { success: true, message: 'OkeConnect bridge aktif' });
    }

    if (!['withdraw', 'check-status'].includes(action)) {
      return json(404, { success: false, message: 'Endpoint tidak ditemukan' });
    }

    if (event.httpMethod !== 'POST') {
      return json(405, { success: false, message: 'Method tidak diizinkan' });
    }

    requireEnvironment();

    const accessToken = getBearerToken(event.headers || {});
    const user = await authenticateUser(accessToken);
    const requestBody = parseRequestBody(event.body);
    const withdrawalId = requestBody.withdraw_id;

    if (Object.keys(requestBody).some((key) => key !== 'withdraw_id')) {
      throw new HttpError(400, 'Request hanya boleh berisi withdraw_id.');
    }
    if (!isUuid(withdrawalId)) {
      throw new HttpError(400, 'withdraw_id tidak valid.');
    }

    const withdrawal = await getWithdrawal(withdrawalId, user.id);
    validateWithdrawal(withdrawal, action);

    if (action === 'withdraw') {
      const claimed = await claimWithdrawal(withdrawal, user.id);
      if (!claimed) {
        throw new HttpError(409, 'Permintaan ini sudah dikirim atau sedang diproses.');
      }

      let providerResult;
      try {
        providerResult = await callVps('withdraw', buildWithdrawPayload(claimed));
      } catch (error) {
        await finalizeWithdrawal(claimed.id, 'needs_review', null, error.message);
        return json(202, {
          status: 'processing',
          message: 'Status transaksi belum dapat dipastikan. Jangan ajukan ulang; transaksi sedang diperiksa.',
          withdraw_id: claimed.id
        });
      }

      const outcome = normalizeOutcome(providerResult);
      await finalizeWithdrawal(
        claimed.id,
        outcome,
        providerResult.ref_id || null,
        JSON.stringify(providerResult)
      );

      return json(outcome === 'failed' ? 200 : 202, {
        status: outcome === 'needs_review' ? 'processing' : outcome,
        ref_id: providerResult.ref_id || null,
        message: providerResult.message || statusMessage(outcome),
        withdraw_id: claimed.id
      });
    }

    let providerResult;
    try {
      providerResult = await callVps('check-status', buildStatusPayload(withdrawal));
    } catch (error) {
      return json(502, {
        status: 'processing',
        message: 'Status transaksi belum dapat diperiksa. Coba kembali beberapa saat lagi.'
      });
    }

    const outcome = normalizeOutcome(providerResult);
    await finalizeWithdrawal(
      withdrawal.id,
      outcome,
      providerResult.ref_id || null,
      JSON.stringify(providerResult)
    );

    return json(200, {
      status: outcome === 'needs_review' ? 'processing' : outcome,
      ref_id: providerResult.ref_id || null,
      message: providerResult.message || statusMessage(outcome),
      withdraw_id: withdrawal.id
    });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    if (statusCode === 500) {
      console.error('[OKE BRIDGE] Request failed:', error.message);
    }
    return json(statusCode, {
      success: false,
      message: statusCode === 500 ? 'Terjadi kesalahan pada layanan withdraw.' : error.message
    });
  }
};

function requireEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'VPS_PROXY_URL',
    'PROXY_SECRET_TOKEN'
  ];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new HttpError(503, 'Konfigurasi proxy server belum lengkap.');
  }

  const vpsUrl = new URL(VPS_PROXY_URL);
  if (vpsUrl.protocol !== 'https:') {
    throw new HttpError(503, 'VPS_PROXY_URL harus menggunakan HTTPS.');
  }
}

function getBearerToken(headers) {
  const authorization = headers.authorization || headers.Authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) throw new HttpError(401, 'Sesi login diperlukan.');
  return match[1];
}

async function authenticateUser(accessToken) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) throw new HttpError(401, 'Sesi login tidak valid atau sudah berakhir.');
  const user = await response.json();
  if (!isUuid(user.id)) throw new HttpError(401, 'Identitas akun tidak valid.');
  return user;
}

function parseRequestBody(body) {
  if (typeof body !== 'string' || body.length > 2048) {
    throw new HttpError(400, 'Request tidak valid.');
  }
  try {
    const parsed = JSON.parse(body);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Invalid body');
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'Format JSON tidak valid.');
  }
}

async function getWithdrawal(withdrawalId, userId) {
  const query = new URLSearchParams({
    select: 'id,worker_id,type,amount,fee,method,account_number,account_name,wallet_type,product_code,customer_number,user_phone,status,okeconnect_ref_id,proxy_submitted_at,refunded_at',
    id: `eq.${withdrawalId}`,
    worker_id: `eq.${userId}`
  });
  const rows = await serviceRequest(`/rest/v1/withdraw_requests?${query}`, 'GET');
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new HttpError(404, 'Permintaan withdraw tidak ditemukan.');
  }
  return rows[0];
}

function validateWithdrawal(row, action) {
  const type = String(row.type || '').toLowerCase();
  const amount = Number(row.amount);
  const fee = Number(row.fee || 0);
  const destination = String(row.customer_number || row.account_number || '');

  if (!Number.isSafeInteger(amount) || amount <= 0 ||
      !Number.isSafeInteger(fee) || fee < 0) {
    throw new HttpError(422, 'Nominal transaksi tidak valid.');
  }
  if (!/^\d{10,15}$/.test(destination)) {
    throw new HttpError(422, 'Nomor tujuan tidak valid.');
  }

  if (type === 'ewallet' || (type === 'referral' && row.wallet_type)) {
    const wallet = EWALLET_PRODUCTS[String(row.wallet_type || '').toUpperCase()];
    if (!wallet || !wallet.tiers.includes(amount / 1000) || fee !== wallet.fee) {
      throw new HttpError(422, 'Nominal atau jenis e-wallet tidak diizinkan.');
    }
  } else if (type === 'pulsa') {
    const product = PULSA_PRODUCTS_BY_CODE.get(String(row.product_code || '').toUpperCase());
    if (!product || product.amount !== amount || product.fee !== fee) {
      throw new HttpError(422, 'Kode atau nominal pulsa tidak diizinkan.');
    }
  } else if (type === 'masaaktif') {
    const product = MASA_PRODUCTS_BY_CODE.get(String(row.product_code || '').toUpperCase());
    if (!product || product.amount !== amount || product.fee !== fee) {
      throw new HttpError(422, 'Kode atau nominal masa aktif tidak diizinkan.');
    }
  } else {
    throw new HttpError(403, 'Jenis withdraw ini tidak memakai proxy otomatis.');
  }

  if (action === 'withdraw') {
    if (!['pending', 'processing'].includes(String(row.status).toLowerCase())) {
      throw new HttpError(409, 'Status transaksi tidak dapat dikirim ke provider.');
    }
    if (row.proxy_submitted_at || row.refunded_at) {
      throw new HttpError(409, 'Transaksi ini sudah pernah dikirim ke provider.');
    }
  } else if (!['submitting', 'processing', 'needs_review'].includes(String(row.status).toLowerCase())) {
    throw new HttpError(409, 'Transaksi belum dapat diperiksa ke provider.');
  }
}

async function claimWithdrawal(row, userId) {
  const query = new URLSearchParams({
    select: 'id,worker_id,type,amount,fee,method,account_number,account_name,wallet_type,product_code,customer_number,user_phone,status,okeconnect_ref_id,proxy_submitted_at,refunded_at',
    id: `eq.${row.id}`,
    worker_id: `eq.${userId}`,
    status: `eq.${row.status}`,
    proxy_submitted_at: 'is.null',
    refunded_at: 'is.null'
  });
  const rows = await serviceRequest(`/rest/v1/withdraw_requests?${query}`, 'PATCH', {
    status: 'submitting',
    proxy_submitted_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });
  return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
}

function buildWithdrawPayload(row) {
  const type = String(row.type || '').toLowerCase();
  const withdrawalId = row.id;
  if (type === 'pulsa' || type === 'masaaktif') {
    return {
      product_code: row.product_code,
      customer_number: row.customer_number || row.account_number,
      withdraw_id: withdrawalId
    };
  }
  return {
    ref: `SHOOPY_${row.id.replace(/-/g, '')}_${Number(row.amount)}`,
    amount: Number(row.amount),
    ewallet: String(row.wallet_type).toLowerCase(),
    phone: row.customer_number || row.account_number,
    withdraw_id: withdrawalId
  };
}

function buildStatusPayload(row) {
  return {
    ref: `SHOOPY_${row.id.replace(/-/g, '')}_${Number(row.amount)}`,
    ref_id: row.okeconnect_ref_id,
    product_code: row.product_code,
    customer_number: row.customer_number || row.account_number,
    withdraw_id: row.id
  };
}

async function callVps(action, body) {
  const targetUrl = `${VPS_PROXY_URL.replace(/\/$/, '')}/${action}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'x-proxy-token': PROXY_SECRET_TOKEN
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  if (text.length > 10000) throw new Error('Response provider terlalu besar.');

  let result;
  try {
    result = JSON.parse(text);
  } catch {
    throw new Error('VPS memberikan response yang tidak valid.');
  }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Format response provider tidak valid.');
  }
  return result;
}

function normalizeOutcome(result) {
  const status = String(result.status || '').toLowerCase();
  if (['failed', 'gagal'].includes(status)) return 'failed';
  if (['success', 'berhasil', 'completed', 'complete', 'paid'].includes(status)) {
    return 'success';
  }
  if (result.ref_id || ['processing', 'pending', 'queued', 'diproses'].includes(status)) {
    return 'processing';
  }
  return 'needs_review';
}

async function finalizeWithdrawal(withdrawalId, outcome, refId, responseBody) {
  await serviceRequest('/rest/v1/rpc/finalize_worker_withdrawal', 'POST', {
    p_withdraw_id: withdrawalId,
    p_outcome: outcome,
    p_ref_id: refId,
    p_response: String(responseBody || '').slice(0, 5000)
  });
}

async function serviceRequest(path, method, body) {
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}${path}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    console.error('[OKE BRIDGE] Supabase server request failed:', response.status);
    throw new HttpError(502, 'Database tidak dapat memproses transaksi.');
  }
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'Response database tidak valid.');
  }
}

function isUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function statusMessage(status) {
  if (status === 'failed') return 'Transaksi gagal dan saldo dikembalikan.';
  if (status === 'success') return 'Transaksi berhasil.';
  return 'Transaksi sedang diproses.';
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
