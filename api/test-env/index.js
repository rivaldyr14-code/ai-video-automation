module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  return res.status(200).json({
    hasGemini,
    hasOpenAI,
    geminiPrefix: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 8) : 'none',
  });
};
