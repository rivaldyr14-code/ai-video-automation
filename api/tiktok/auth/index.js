const crypto = require('crypto');

function generatePKCE() {
  const verifier = crypto.randomBytes(32).toString('hex');
  const challenge = crypto.createHash('sha256').update(verifier).digest('hex');
  return { verifier, challenge };
}

module.exports = (req, res) => {
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  if (!clientKey) return res.status(500).json({ error: 'TIKTOK_CLIENT_KEY not set' });

  const { verifier, challenge } = generatePKCE();
  const state = crypto.randomBytes(16).toString('hex');

  res.setHeader('Set-Cookie', [
    `tiktok_pkce_verifier=${verifier}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
    `tiktok_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
  ].join(', '));

  const redirectUri = 'https://ai-video-automation-phi.vercel.app/tiktok/callback';
  const authUrl = `https://www.tiktok.com/v2/auth/authorize/?client_key=${clientKey}&response_type=code&scope=user.info.basic,video.publish&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${challenge}&code_challenge_method=S256`;

  res.writeHead(302, { Location: authUrl });
  res.end();
};
