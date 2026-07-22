const https = require('https');
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

async function fetchGoogleNews() {
  try {
    const xml = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en');
    const items = [];
    const matches = xml.matchAll(/<item>[\s\S]*?<title>(.*?)<\/title>[\s\S]*?<link>(.*?)<\/link>[\s\S]*?<\/item>/g);
    for (const m of matches) {
      items.push({ title: m[1].replace(/<!\[CDATA\[|\]\]>/g, ''), link: m[2], source: 'Google News', niche: 'general' });
    }
    return items.slice(0, 30);
  } catch { return []; }
}

async function fetchHackerNews() {
  try {
    const ids = JSON.parse(await fetch('https://hacker-news.firebaseio.com/v0/topstories.json'));
    const items = [];
    for (const id of ids.slice(0, 10)) {
      const story = JSON.parse(await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`));
      if (story && story.title) items.push({ title: story.title, link: story.url || `https://news.ycombinator.com/item?id=${id}`, source: 'Hacker News', niche: 'technology' });
    }
    return items;
  } catch { return []; }
}

function assignNiche(title) {
  const t = title.toLowerCase();
  if (/ai|tech|robot|computer|software|cyber|quantum|code|hack/.test(t)) return 'technology';
  if (/research|study|scientist|physics|biology|gene|dark matter/.test(t)) return 'science';
  if (/stock|market|crypto|money|invest|economy|finance|bank/.test(t)) return 'finance';
  if (/mystery|unsolved|strange|paranormal|conspiracy|disappear/.test(t)) return 'mystery';
  if (/indonesia|jakarta|indonesian|bali/.test(t)) return 'indonesia';
  if (/nature|wildlife|animal|ocean|forest|species|climate/.test(t)) return 'nature';
  if (/space|nasa|mars|star|planet|asteroid|moon|galaxy|universe/.test(t)) return 'space';
  if (/ancient|history|war|civilization|archaeolog|empire|king/.test(t)) return 'history';
  if (/brain|psychology|mental|behavior|habit|emotion|cognitive/.test(t)) return 'psychology';
  if (/food|cook|recipe|nutrition|diet|restaurant|chef/.test(t)) return 'food';
  if (/country|geography|capital|city|travel|world|continent/.test(t)) return 'geography';
  return 'general';
}

let trendingCache = [];
let trendingCacheTime = 0;

async function fetchTrending() {
  if (trendingCache.length > 0 && (Date.now() - trendingCacheTime) < 600000) return trendingCache;
  const [google, hacker] = await Promise.all([fetchGoogleNews(), fetchHackerNews()]);
  const all = [...google, ...hacker];
  trendingCache = all.map(t => ({ ...t, niche: assignNiche(t.title) }));
  trendingCacheTime = Date.now();
  return trendingCache;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const topics = await fetchTrending();
    res.json({ topics: topics.slice(0, 50), total: topics.length, cached: (Date.now() - trendingCacheTime) < 600000 });
  } catch (e) { res.status(500).json({ error: e.message }); }
};
