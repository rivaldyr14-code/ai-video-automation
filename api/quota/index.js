const fs = require('fs');
const path = require('path');

function getQuotaStatus() {
  const quotaFile = path.join(process.cwd(), 'data', 'quota.json');
  const today = new Date().toISOString().slice(0, 10);
  let quota = { date: today, count: 0, limit: 8 };
  try {
    if (fs.existsSync(quotaFile)) {
      const data = JSON.parse(fs.readFileSync(quotaFile, 'utf-8'));
      if (data.date === today) quota = data;
      else { quota = { date: today, count: 0, limit: 8 }; }
    }
  } catch {}
  return { used: quota.count, max: quota.limit, remaining: Math.max(0, quota.limit - quota.count), resetIn: 24 };
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try { res.json(getQuotaStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
};
