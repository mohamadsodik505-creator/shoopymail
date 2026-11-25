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
    console.error('[HUMANITY HIGHLIGHTS] Missing runtime environment variables:', missing);
    return json(503, { error: 'Dokumentasi belum tersedia.' });
  }

  let response;
  try {
    response = await fetch(
      `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/humanity_public_highlights`,
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
    console.error('[HUMANITY HIGHLIGHTS] Supabase request failed:', error.message);
    return json(502, { error: 'Dokumentasi belum tersedia.' });
  }

  if (!response.ok) {
    console.error('[HUMANITY HIGHLIGHTS] Supabase RPC failed:', response.status);
    return json(502, { error: 'Dokumentasi belum tersedia.' });
  }

  try {
    const posts = await response.json();
    if (!Array.isArray(posts) || posts.length > 2) {
      throw new Error('Invalid public humanity highlights response.');
    }
    const highlights = posts.map((post) => {
      if (!post || typeof post.title !== 'string' || typeof post.image_path !== 'string') {
        throw new Error('Invalid public humanity highlight.');
      }
      return {
        title: post.title,
        caption: typeof post.caption === 'string' ? post.caption : '',
        instagram_url: getSafeInstagramUrl(post.instagram_url),
        created_at: post.created_at,
        image_url: getPublicImageUrl(post.image_path)
      };
    });
    return json(200, highlights);
  } catch (error) {
    console.error('[HUMANITY HIGHLIGHTS] Invalid Supabase response:', error.message);
    return json(502, { error: 'Dokumentasi belum tersedia.' });
  }
};

function getPublicImageUrl(imagePath) {
  const segments = imagePath.split('/');
  if (!imagePath.trim() || imagePath.includes('\\')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Invalid humanity image path.');
  }
  const encodedPath = segments.map((segment) => encodeURIComponent(segment)).join('/');
  return `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/humanity-posts/${encodedPath}`;
}

function getSafeInstagramUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value);
    const allowedHosts = ['instagram.com', 'www.instagram.com', 'm.instagram.com'];
    if (url.protocol === 'https:' && allowedHosts.includes(url.hostname.toLowerCase())
      && !url.port && !url.username && !url.password
      && /^\/(p|reel|tv|stories)\//i.test(url.pathname)) {
      return url.href;
    }
  } catch (error) {
    return '';
  }
  return '';
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60, s-maxage=120, stale-while-revalidate=300',
      'X-Content-Type-Options': 'nosniff'
    },
    body: JSON.stringify(body)
  };
}
