const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return json(405, { error: 'Method tidak diizinkan.' });
  }

  const missing = [];
  if (!SUPABASE_URL) missing.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    console.error('[PUBLIC STATS] Missing runtime environment variables:', missing);
    return json(503, { error: 'Statistik belum tersedia.' });
  }

  let response;
  try {
    response = await fetch(
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/homepage_public_stats`,
      {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: '{}'
      }
    );
  } catch (error) {
    console.error('[PUBLIC STATS] Supabase request failed:', error.message);
    return json(502, { error: 'Statistik belum tersedia.' });
  }

  if (!response.ok) {
    console.error('[PUBLIC STATS] Supabase RPC failed:', response.status);
    return json(502, { error: 'Statistik belum tersedia.' });
  }

  try {
    const stats = await response.json();
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      throw new Error('Invalid public statistics response.');
    }
    return json(200, stats);
  } catch (error) {
    console.error('[PUBLIC STATS] Invalid Supabase response:', error.message);
    return json(502, { error: 'Statistik belum tersedia.' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=120',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}
