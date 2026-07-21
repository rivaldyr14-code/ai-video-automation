module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const settings = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***set***' : 'not set',
        PEXELS_API_KEY: process.env.PEXELS_API_KEY ? '***set***' : 'not set',
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ? '***set***' : 'not set',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? '***set***' : 'not set',
        YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN ? '***set***' : 'not set',
        TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN ? '***set***' : 'not set',
      };
      
      return res.status(200).json(settings);
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    return res.status(200).json({ 
      success: true, 
      message: 'Settings are managed through Vercel Dashboard → Settings → Environment Variables' 
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
