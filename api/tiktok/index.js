const https = require('https');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) return resolve(req.body);
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function exchangeCode(code, clientKey, clientSecret, redirectUri, codeVerifier) {
  return new Promise((resolve, reject) => {
    let urlEncoded = `client_key=${clientKey}&client_secret=${clientSecret}&code=${code}&grant_type=authorization_code&redirect_uri=${encodeURIComponent(redirectUri)}`;
    if (codeVerifier) urlEncoded += `&code_verifier=${codeVerifier}`;

    const req = https.request({
      hostname: 'open.tiktokapis.com',
      path: '/v2/oauth/token/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(urlEncoded),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve({ raw: data }); }
      });
    });

    req.on('error', reject);
    req.write(urlEncoded);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const code = req.query.code || body.code;
    const codeVerifier = req.query.code_verifier || body.code_verifier;

    if (!code) return res.status(400).json({ error: 'Missing code parameter' });

    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    const redirectUri = 'https://ai-video-automation-phi.vercel.app/tiktok/callback';

    const result = await exchangeCode(code, clientKey, clientSecret, redirectUri, codeVerifier);

    if (result.data && result.data.access_token) {
      return res.status(200).json({
        success: true,
        access_token: result.data.access_token,
        refresh_token: result.data.refresh_token,
        open_id: result.data.open_id,
        expires_in: result.data.expires_in,
        scope: result.data.scope,
      });
    }

    return res.status(400).json({ success: false, error: result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
