const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const axios = require('axios');
const xml2js = require('xml2js');

const FFMPEG_BIN = 'C:\\Users\\Rival\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin';
process.env.PATH = FFMPEG_BIN + ';' + (process.env.PATH || '');

require('dotenv').config({ path: '.env.local' });
require('dotenv').config();

const app = express();
const PORT = 3001;
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TOKENS_DIR = path.join(__dirname, 'tokens');
const TEMP_DIR = path.join(__dirname, 'temp');
[DATA_DIR, OUTPUT_DIR, TOKENS_DIR, TEMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const FONT_PATH = path.join(TEMP_DIR, 'Montserrat-Bold.ttf');
if (!fs.existsSync(FONT_PATH)) {
  const src = path.join(__dirname, 'assets', 'Montserrat-Bold.ttf');
  if (fs.existsSync(src)) fs.copyFileSync(src, FONT_PATH);
}
const FONT_ESC = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:');

function loadJSON(f) { try { const p = path.join(DATA_DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : []; } catch(e) { console.error('loadJSON error:', f, e.message); return []; } }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }
function esc(s) { return (s || '').replace(/\\/g, '').replace(/'/g, '').replace(/:/g, '-').replace(/%/g, 'pct').replace(/[[\]]/g, ''); }

const QUOTA_FILE = path.join(DATA_DIR, 'quota.json');
function loadQuota() {
  try {
    const q = JSON.parse(fs.readFileSync(QUOTA_FILE, 'utf-8'));
    const now = new Date();
    const lastReset = new Date(q.lastReset || 0);
    const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);
    if (hoursSinceReset >= 24) { return { uploads: 0, lastReset: now.toISOString(), maxPerDay: 8 }; }
    return q;
  } catch { return { uploads: 0, lastReset: new Date().toISOString(), maxPerDay: 8 }; }
}
function saveQuota(q) { fs.writeFileSync(QUOTA_FILE, JSON.stringify(q, null, 2)); }
function canUpload() { const q = loadQuota(); return q.uploads < q.maxPerDay; }
function incrementQuota() { const q = loadQuota(); q.uploads++; saveQuota(q); return q; }
function getQuotaStatus() { const q = loadQuota(); return { used: q.uploads, max: q.maxPerDay, remaining: Math.max(0, q.maxPerDay - q.uploads), lastReset: q.lastReset }; }

// ============ TRENDING TOPICS ============
const RSS_FEEDS = [
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGx6TVdZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'technology', label: 'Tech' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp1ZEdvU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'science', label: 'Science' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'finance', label: 'Finance' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'mystery', label: 'Mystery' },
  { url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', niche: 'general', label: 'Trending' },
  { url: 'https://www.cnnindonesia.com/nasional/rss', niche: 'indonesia', label: 'Indonesia' },
  { url: 'https://trends.google.com/trends/trendingsearches/daily/rss?hl=en-US&gl=US', niche: 'general', label: 'Google Trends' },
];

let trendingCache = [];
let trendingCacheTime = 0;

async function fetchRSS(url, timeout = 8000) {
  try {
    const res = await axios.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const parser = new xml2js.Parser({ explicitArray: false, trim: true });
    const result = await parser.parseStringPromise(res.data);
    const items = result?.rss?.channel?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) { return []; }
}

async function fetchYouTubeTrending() {
  try {
    const cid = process.env.GOOGLE_CLIENT_ID, cs = process.env.GOOGLE_CLIENT_SECRET, rt = process.env.YOUTUBE_REFRESH_TOKEN;
    if (!cid || !cs || !rt) return [];
    const oauth = new google.auth.OAuth2(cid, cs, 'https://ai-video-automation-phi.vercel.app/tiktok/callback');
    oauth.setCredentials({ refresh_token: rt });
    const yt = google.youtube({ version: 'v3', auth: oauth });
    const res = await yt.videos.list({ part: ['snippet'], chart: 'mostPopular', regionCode: 'US', maxResults: 30 });
    return (res.data.items || []).map(v => ({
      title: v.snippet.title,
      link: `https://www.youtube.com/watch?v=${v.id}`,
      niche: mapYTCategoryToNiche(v.snippet.categoryId),
      label: 'YouTube Trending',
      source: 'YouTube',
      pubDate: v.snippet.publishedAt,
    }));
  } catch (e) { console.log('  YouTube trending error:', e.message); return []; }
}

function mapYTCategoryToNiche(catId) {
  const map = { '28': 'science', '26': 'finance', '22': 'people', '24': 'entertainment', '25': 'news', '10': 'music', '17': 'sports', '2': 'autos', '20': 'gaming', '27': 'education' };
  return map[catId] || 'general';
}

async function fetchRedditTrending() {
  try {
    const res = await axios.get('https://www.reddit.com/r/popular.json?limit=25', { timeout: 8000, headers: { 'User-Agent': 'VideoAutomation/1.0' } });
    return (res.data?.data?.children || []).map(c => {
      const d = c.data;
      const title = d.title || '';
      const sub = (d.subreddit || '').toLowerCase();
      let niche = 'general';
      if (['technology', 'programming', 'science', 'gadgets', 'ai'].some(s => sub.includes(s))) niche = 'technology';
      else if (['science', 'space', 'biology', 'physics'].some(s => sub.includes(s))) niche = 'science';
      else if (['finance', 'wallstreetbets', 'investing', 'crypto', 'stocks'].some(s => sub.includes(s))) niche = 'finance';
      else if (['nature', 'animals', 'wildlife', 'ocean'].some(s => sub.includes(s))) niche = 'nature';
      else if (['history', 'archaeology'].some(s => sub.includes(s))) niche = 'history';
      else if (['food', 'cooking', 'recipes'].some(s => sub.includes(s))) niche = 'food';
      return { title, link: `https://reddit.com${d.permalink}`, niche, label: 'Reddit', source: 'Reddit', pubDate: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : '' };
    });
  } catch (e) { return []; }
}

async function fetchHackerNews() {
  try {
    const topRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8000 });
    const ids = (topRes.data || []).slice(0, 20);
    const stories = await Promise.all(ids.map(id =>
      axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 }).then(r => r.data).catch(() => null)
    ));
    return stories.filter(s => s && s.title).map(s => ({
      title: s.title,
      link: s.url || `https://news.ycombinator.com/item?id=${s.id}`,
      niche: 'technology',
      label: 'Hacker News',
      source: 'Hacker News',
      pubDate: s.time ? new Date(s.time * 1000).toISOString() : '',
    }));
  } catch (e) { return []; }
}

async function fetchTikTokTrending() {
  try {
    const res = await axios.get('https://www.tiktok.com/api/challenge/item_list?challengeID=1&count=30', {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    return (res.data?.itemList || []).map(item => ({
      title: item.desc || item.title || '',
      link: `https://www.tiktok.com/@${item.author?.uniqueId}/video/${item.id}`,
      niche: 'general',
      label: 'TikTok Trending',
      source: 'TikTok',
      pubDate: item.createTime ? new Date(item.createTime * 1000).toISOString() : '',
    }));
  } catch (e) { return []; }
}

const BLOCKED = ['trump', 'biden', 'election', 'democrat', 'republican', 'congress', 'senate', 'impeach', 'ukraine', 'russia', 'war', 'hamas', 'israel', 'gaza', 'genocide', 'abort', 'gun', 'shoot', 'kill', 'murder', 'terror', 'bomb', 'sexual', 'rape', 'abuse', 'corrupt', 'scandal', 'porn', 'nude', 'sex ', 'gay ', 'lesbian', 'transgender', 'racist', 'hate ', 'drug ', 'cocaine', 'heroin', 'death ', 'suicide', 'attack ', 'weapon', 'arrest', 'court ', 'trial ', 'verdict', 'guilty', 'indict', 'felony', 'misdemeanor', 'politik', 'partai', 'pemilu', 'korupsi'];

function isAllowed(title) {
  const t = title.toLowerCase();
  if (t.length < 10) return false;
  if (BLOCKED.some(b => t.includes(b))) return false;
  return true;
}

async function fetchTrending() {
  const now = Date.now();
  if (trendingCache.length > 0 && (now - trendingCacheTime) < 600000) return trendingCache;

  console.log('\nFetching trending topics from all sources...');
  const allTopics = [];

  const results = await Promise.allSettled([
    ...RSS_FEEDS.map(feed => fetchRSS(feed.url).then(items => {
      for (const item of items.slice(0, 8)) {
        const title = item.title || '';
        const link = item.link || '';
        const pubDate = item.pubDate || '';
        if (isAllowed(title)) allTopics.push({ title, link, pubDate, niche: feed.niche, label: feed.label, source: feed.label });
      }
      console.log(`  ${feed.label}: ${items.length} items`);
    })),
    fetchYouTubeTrending().then(items => {
      for (const item of items) { if (isAllowed(item.title)) allTopics.push(item); }
      console.log(`  YouTube: ${items.length} items`);
    }),
    fetchRedditTrending().then(items => {
      for (const item of items) { if (isAllowed(item.title)) allTopics.push(item); }
      console.log(`  Reddit: ${items.length} items`);
    }),
    fetchHackerNews().then(items => {
      for (const item of items) { if (isAllowed(item.title)) allTopics.push(item); }
      console.log(`  Hacker News: ${items.length} items`);
    }),
    fetchTikTokTrending().then(items => {
      for (const item of items) { if (isAllowed(item.title)) allTopics.push(item); }
      console.log(`  TikTok: ${items.length} items`);
    }),
  ]);

  const seen = new Set();
  trendingCache = allTopics.filter(t => {
    const key = t.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  trendingCacheTime = now;
  console.log(`Total unique trending: ${trendingCache.length}`);
  return trendingCache;
}

function generateHook(title, niche) {
  const clean = (title || '').replace(/[-–—:|]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = clean.replace(/^(breaking|just in|viral|alert|update|news|report|says|reveals|confirms|announces)\s*/gi, '').trim();
  const shortTitle = core.substring(0, 60);
  const hooks = {
    technology: [
      `Here is what ${shortTitle} means for the future.`,
      `${shortTitle}. Here is why every tech expert is paying attention.`,
      `Most people will scroll past this. ${shortTitle}. But you should not.`,
      `${shortTitle}. The implications go far deeper than the headline suggests.`,
      `If you work in tech, ${shortTitle} changes your roadmap.`,
    ],
    science: [
      `Researchers just confirmed something remarkable. ${shortTitle}.`,
      `${shortTitle}. The data behind this is worth understanding.`,
      `A new study just changed how we think about ${shortTitle}.`,
      `${shortTitle}. Scientists have been working toward this for years.`,
      `Here is the science behind ${shortTitle} and why it matters.`,
    ],
    finance: [
      `Here is what ${shortTitle} means for your money.`,
      `${shortTitle}. Financial analysts are updating their projections.`,
      `If you follow markets, ${shortTitle} is a signal you cannot ignore.`,
      `${shortTitle}. The economic ripple effects are already visible.`,
      `Warren Buffett once said something that explains ${shortTitle}.`,
    ],
    mystery: [
      `New evidence just surfaced about ${shortTitle}.`,
      `${shortTitle}. Researchers have spent years trying to understand this.`,
      `Here is what investigators found about ${shortTitle}.`,
      `${shortTitle}. The details are more complex than anyone expected.`,
      `After years of silence, ${shortTitle} finally has answers.`,
    ],
    nature: [
      `Here is what ${shortTitle} means for the natural world.`,
      `${shortTitle}. Marine biologists and ecologists are taking notice.`,
      `Researchers studying ${shortTitle} just published their findings.`,
      `${shortTitle}. The environmental implications are significant.`,
      `Here is why ${shortTitle} matters for biodiversity.`,
    ],
    space: [
      `Astronomers just made a breakthrough. ${shortTitle}.`,
      `${shortTitle}. NASA is updating their research priorities because of this.`,
      `Here is what ${shortTitle} means for space exploration.`,
      `${shortTitle}. The data from this observation is extraordinary.`,
      `This changes how we understand ${shortTitle}.`,
    ],
    history: [
      `Archaeologists just uncovered something about ${shortTitle}.`,
      `${shortTitle}. Historians are rewriting what we thought we knew.`,
      `New evidence about ${shortTitle} has been discovered.`,
      `${shortTitle}. The historical significance is enormous.`,
      `Here is the real story behind ${shortTitle}.`,
    ],
    psychology: [
      `New research on ${shortTitle} just changed what we know.`,
      `${shortTitle}. Psychologists are revisiting their assumptions.`,
      `Here is what ${shortTitle} reveals about human behavior.`,
      `${shortTitle}. The study behind this involved thousands of participants.`,
      `Cognitive scientists just confirmed something about ${shortTitle}.`,
    ],
    food: [
      `Here is what ${shortTitle} means for the food industry.`,
      `${shortTitle}. Nutritionists and food scientists are weighing in.`,
      `New research about ${shortTitle} has the culinary world talking.`,
      `${shortTitle}. The health implications are worth understanding.`,
      `Here is the science behind ${shortTitle}.`,
    ],
    geography: [
      `Here is what makes ${shortTitle} geographically significant.`,
      `${shortTitle}. Geographers and researchers are studying the implications.`,
      `${shortTitle}. The environmental impact is bigger than you think.`,
      `Here is why ${shortTitle} matters on a global scale.`,
      `${shortTitle}. This changes how we map our world.`,
    ],
    general: [
      `Here is what ${shortTitle} means and why it matters.`,
      `${shortTitle}. The implications are worth understanding.`,
      `This story about ${shortTitle} is developing fast.`,
      `${shortTitle}. Here is the full context you need.`,
      `Here is the most important thing about ${shortTitle}.`,
    ],
  };
  const pool = hooks[niche] || hooks.general;
  return pool[Math.floor(Math.random() * pool.length)];
}

function generateContentFromTopic(topic) {
  const rawTitle = topic.title;
  const niche = topic.niche || 'general';

  const emojis = {
    technology: ['💻', '⚡', '🌐', '📡', '🔧', '💡'],
    science: ['🔬', '🧪', '🔭', '🧬', '📊', '🌍'],
    finance: ['💰', '📈', '📊', '🏦', '📉', '💼'],
    mystery: ['🔍', '🔎', '📋', '❓', '🗝️'],
    indonesia: ['🇮🇩', '📊', '🌏', '📰', '🏙️', '🏗️'],
    nature: ['🌿', '🐘', '🌊', '🦁', '🌍', '🦅'],
    space: ['🚀', '🌌', '⭐', '🪐', '🔭', '📡'],
    history: ['📜', '🏛️', '⚔️', '🗿', '👑', '🏰'],
    psychology: ['🧠', '💭', '📊', '🎯', '💡', '🧩'],
    food: ['🍳', '📊', '🥬', '🧂', '🍽️', '🔬'],
    geography: ['🗺️', '🏔️', '🏝️', '🌋', '🌆', '📡'],
    general: ['📰', '📊', '🌍', '💡', '🎯', '📋'],
  };
  const nicheEmoji = emojis[niche] || emojis.general;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const e = () => pick(nicheEmoji);

  const clean = rawTitle.replace(/[-–—:|]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = clean
    .replace(/^(breaking|just in|viral|alert|update|news|report|says|reveals|confirms|announces)\s*/gi, '')
    .replace(/\s*[-–—]\s*(reuters|yahoo|cnn|bbc|fox|nbc|abc|cbs|associated press|al jazeera|techcrunch|verge|cnbc|bloomberg|wsj|nyt|washington post|forbes|guardian|ESPN|AP News|Phys\.org|Live Science|Space\.com|Eurogamer|GSMArena|MLB\.com|Sports Illustrated)$/gi, '')
    .trim();
  const coreClean = core.replace(/[?!.,;:'"]/g, '').trim();

  const patterns = [
    // Pattern 1: Data-driven analysis
    [
      `${e()} ${coreClean}. Here is what the data actually shows.`,
      `${e()} According to multiple sources, this has been building for months. The numbers tell a clear story that goes beyond the headline.`,
      `${e()} Industry analysts project this trend will accelerate over the next two years. The infrastructure being built right now supports that timeline.`,
      `${e()} What makes this significant is the convergence. Multiple independent factors aligned simultaneously, creating an outcome that experts did not predict.`,
      `${e()} The stakeholders involved are already adjusting their strategies. Those who recognize the pattern early will be better positioned than those who react later.`,
      `${e()} This is worth understanding in depth. The surface-level reaction misses several important details that change the full picture.`,
    ],
    // Pattern 2: Context-first explainer
    [
      `${e()} To understand why ${coreClean} matters, you need to know what happened before.`,
      `${e()} The context here is everything. This builds on a series of developments that most people did not connect until now.`,
      `${e()} The mechanism behind this is straightforward once you see it. Complex systems often have simple drivers that are easy to overlook.`,
      `${e()} Impact assessment shows effects across multiple sectors. The direct consequences are visible, but the indirect effects may be larger.`,
      `${e()} Comparisons to similar events in the past provide useful perspective. The parallels are instructive, though the differences matter too.`,
      `${e()} The takeaway is clear. Whether this affects you directly or indirectly, understanding it puts you in a better position.`,
    ],
    // Pattern 3: Timeline narrative
    [
      `${e()} Six months ago, nobody was talking about ${coreClean}. Today, it is reshaping entire industries.`,
      `${e()} The first signal appeared quietly. Researchers noticed an anomaly in the data that did not match existing models. At first, most dismissed it.`,
      `${e()} Then the evidence started accumulating. Three independent teams confirmed the findings within the same week. That is when attention shifted.`,
      `${e()} The turning point came when major stakeholders publicly acknowledged what had been happening behind closed doors. The market reacted immediately.`,
      `${e()} Now we are in the acceleration phase. What took months to develop is now moving in weeks. The pace is increasing and the implications are compounding.`,
      `${e()} The next chapter will determine whether this becomes a lasting transformation or a temporary disruption. Both outcomes are plausible.`,
    ],
    // Pattern 4: Expert perspective
    [
      `${e()} Leading researchers in this field have a perspective on ${coreClean} that most coverage misses.`,
      `${e()} Their analysis reveals layers of complexity. What appears simple from the outside involves years of research and dozens of contributing factors.`,
      `${e()} The technical details matter here. Without understanding the underlying mechanisms, it is easy to draw incorrect conclusions from the surface data.`,
      `${e()} Expert consensus is forming around a specific interpretation. There is still debate on the implications, but the core findings are widely accepted.`,
      `${e()} What distinguishes this from similar developments is the combination of scale and speed. The magnitude is unusual, and the timeline is compressed.`,
      `${e()} Following the expert analysis over the coming weeks will provide clarity. This is an evolving situation with new information emerging regularly.`,
    ],
    // Pattern 5: Impact analysis
    [
      `${e()} The real story behind ${coreClean} is about what happens next.`,
      `${e()} Direct effects are already measurable. But the second and third-order consequences are where the most significant changes will occur.`,
      `${e()} Economic modeling suggests the impact will be distributed unevenly. Some sectors will benefit immediately, others will need time to adapt.`,
      `${e()} The adaptation timeline varies by industry. Early movers are already positioning. The competitive landscape is shifting in real time.`,
      `${e()} Historical precedent suggests a pattern. Initial disruption, followed by adaptation, then a new equilibrium. The timeline is always shorter than people expect.`,
      `${e()} The practical takeaway is straightforward. Understanding this change gives you options that will not exist once the new equilibrium is established.`,
    ],
    // Pattern 6: Deep dive
    [
      `${e()} Let us go deeper into ${coreClean}. The headline captures attention, but the details tell the real story.`,
      `${e()} The first layer is the immediate event. Something happened that changed the calculation for everyone involved.`,
      `${e()} The second layer is the mechanism. Why this happened now, and what forces converged to make it possible.`,
      `${e()} The third layer is the implication. What this means for the broader landscape and how it connects to larger trends.`,
      `${e()} The fourth layer is the timeline. When the full effects will be felt and what to watch for as the situation develops.`,
      `${e()} Most coverage stops at the first layer. The real understanding comes from engaging with all four.`,
    ],
  ];

  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  const scenes = pattern.map((narration, i) => ({
    narration,
    visual: getVisualKeyword(niche, i === 0 ? rawTitle : coreClean),
  }));

  const compellingTitles = {
    technology: [`Understanding: ${core}`, `What ${core} Means`, `The ${core} Explained`],
    science: [`The Science Behind: ${core}`, `${core} Explained`, `Research Update: ${core}`],
    finance: [`Market Impact: ${core}`, `What ${core} Means for Markets`, `Financial Analysis: ${core}`],
    mystery: [`Investigating: ${core}`, `${core} Deep Dive`, `The Story Behind: ${core}`],
    indonesia: [`Indonesia: ${core}`, `What ${core} Means`, `Analysis: ${core}`],
    nature: [`Nature Report: ${core}`, `What ${core} Reveals`, `${core} Explained`],
    space: [`Space Discovery: ${core}`, `What ${core} Means`, `Cosmos Update: ${core}`],
    history: [`History Deep Dive: ${core}`, `The Story of: ${core}`, `${core} Explained`],
    psychology: [`Mind Science: ${core}`, `What ${core} Reveals`, `Psychology of: ${core}`],
    food: [`Food Science: ${core}`, `What ${core} Means`, `${core} Explained`],
    geography: [`World Report: ${core}`, `What ${core} Means`, `${core} Explained`],
    general: [`Understanding: ${core}`, `What ${core} Means`, `${core} Explained`],
  };
  const titlePool = compellingTitles[niche] || compellingTitles.general;
  const videoTitle = titlePool[Math.floor(Math.random() * titlePool.length)].substring(0, 100);

  return {
    title: videoTitle,
    description: `${rawTitle}\n\n${scenes.map(s => s.narration).join(' ')}\n\n#trending #viral #facts #${niche}`,
    tags: [niche, 'trending', 'viral', 'news', 'facts', '2026', ...rawTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3).slice(0, 5)],
    hashtags: getHashtags(niche),
    scenes,
    srt: '',
    categoryId: niche === 'finance' ? '26' : '28',
    isTrending: true,
    source: topic.source || 'Google News',
    sourceLink: topic.link || '',
  };
}

function generateVideoTitle(newsTitle, niche) {
  const prefixes = {
    technology: ['Tech Breaking:', 'Just Dropped:', 'Tech Alert:'],
    science: ['Science Alert:', 'Mind Blowing:', 'Just Discovered:'],
    finance: ['Money Alert:', 'Finance Breaking:', 'Wall Street News:'],
    mystery: ['Unsolved:', 'Mystery Alert:', 'What Just Happened:'],
    indonesia: ['Indonesia Update:', 'Breaking Indonesia:', 'Indonesia News:'],
    general: ['Breaking:', 'Just In:', 'Viral Alert:'],
  };
  const prefix = (prefixes[niche] || prefixes.general)[0];
  return `${prefix} ${newsTitle}`.substring(0, 100);
}

function getVisualKeyword(niche, context) {
  const visuals = {
    technology: ['technology', 'computer', 'coding', 'robot', 'data', 'server', 'digital', 'artificial intelligence', 'circuit', 'laptop'],
    science: ['space', 'laboratory', 'experiment', 'universe', 'nature', 'brain', 'physics', 'chemistry', 'dna', 'telescope'],
    finance: ['money', 'business', 'stock market', 'investment', 'finance', 'office', 'success', 'cryptocurrency', 'gold', 'chart'],
    mystery: ['mystery', 'dark', 'night', 'fog', 'ancient', 'forest', 'abandoned', 'smoke', 'mysterious', 'eerie'],
    indonesia: ['indonesia', 'jakarta', 'city', 'people', 'culture', 'street', 'market', 'night', 'tropical', 'urban'],
    nature: ['nature', 'forest', 'ocean', 'animal', 'wildlife', 'jungle', 'mountain', 'waterfall', 'flower', 'tree'],
    space: ['space', 'universe', 'planet', 'galaxy', 'stars', 'astronomy', 'nebula', 'cosmos', 'rocket', 'telescope'],
    history: ['history', 'ancient', 'castle', 'ruins', 'monument', 'museum', 'temple', 'statue', 'artifact', 'civilization'],
    psychology: ['brain', 'psychology', 'mind', 'think', 'study', 'research', 'mental', 'experiment', 'thought', 'memory'],
    food: ['food', 'cooking', 'restaurant', 'chef', 'kitchen', 'ingredients', 'spices', 'meal', 'dish', 'bakery'],
    geography: ['city', 'landscape', 'mountain', 'ocean', 'island', 'river', 'desert', 'country', 'village', 'aerial'],
    general: ['city', 'people', 'news', 'world', 'globe', 'crowd', 'modern', 'skyline', 'technology', 'nature'],
  };
  const pool = visuals[niche] || visuals.general;
  const contextWords = context.toLowerCase().split(/\s+/);
  for (const word of contextWords) {
    if (pool.includes(word)) return word;
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

function getHashtags(niche) {
  const tags = {
    technology: ['#tech', '#technology', '#AI', '#innovation', '#coding', '#future', '#trending'],
    science: ['#science', '#space', '#physics', '#discovery', '#nature', '#universe', '#mindblown'],
    finance: ['#finance', '#money', '#investing', '#wealth', '#crypto', '#business', '#trending'],
    mystery: ['#mystery', '#unsolved', '#conspiracy', '#paranormal', '#scary', '#truth', '#viral'],
    indonesia: ['#indonesia', '#indonesian', '#jakarta', '#viral', '#trending', '#news', '#fyp'],
    nature: ['#nature', '#animals', '#wildlife', '#ocean', '#forest', '#biology', '#facts'],
    space: ['#space', '#astronomy', '#universe', '#cosmos', '#science', '#stars', '#planets'],
    history: ['#history', '#ancient', '#civilization', '#archaeology', '#culture', '#facts'],
    psychology: ['#psychology', '#brain', '#mind', '#behavior', '#science', '#facts'],
    food: ['#food', '#cooking', '#cuisine', '#kitchen', '#chef', '#culture', '#facts'],
    geography: ['#geography', '#countries', '#culture', '#travel', '#world', '#places', '#facts'],
    general: ['#trending', '#viral', '#news', '#facts', '#fyp', '#foryou', '#didyouknow'],
  };
  return tags[niche] || tags.general;
}

const NICHES = {
  technology: {
    gradientTop: '0x6366f1', gradientBot: '0x0a0a2e',
    topics: ['AI Revolution', 'Quantum Computing', '5G Technology', 'Cybersecurity Secrets', 'Virtual Reality', 'Machine Learning', 'Blockchain Explained', 'Robot Takeover'],
    searchQueries: ['technology', 'computer', 'coding', 'robot', 'artificial intelligence', 'server', 'digital', 'circuit'],
    topicContent: {
      'AI Revolution': {
        title: 'AI Is Taking Over And Most People Have No Idea',
        scenes: [
          { narration: 'Artificial intelligence just passed the bar exam, scored in the top ten percent on the medical licensing exam, and wrote a New York Times bestseller. All in the same year.', visual: 'artificial intelligence' },
          { narration: 'Here is what most people miss. AI is not just chatbots. It is diagnosing cancer more accurately than doctors, predicting protein structures that took scientists fifty years to figure out, and generating code that senior engineers cannot tell apart from human written code.', visual: 'computer' },
          { narration: 'The craziest part is that this is the worst AI will ever be right now. Every six months, these models double in capability. By next year, AI will be able to do things we literally cannot imagine today.', visual: 'data' },
          { narration: 'But here is the real question nobody is asking. If AI can do everything a junior developer can do, what happens to the millions of people studying computer science right now? The job market is about to shift in ways nobody is prepared for.', visual: 'coding' },
          { narration: 'The people who understand this shift are already positioning themselves. They are learning to work with AI, not against it. And that single decision will separate the winners from everyone else in the next five years.', visual: 'robot' },
          { narration: 'Follow for more insights on how technology is reshaping our world. The future is closer than you think.', visual: 'digital' },
        ],
      },
      'Quantum Computing': {
        title: 'Quantum Computers Just Broke Reality And Nobody Noticed',
        scenes: [
          { narration: 'Google just built a quantum computer that solved a problem in four minutes that would take the world fastest supercomputer ten septillion years. That is longer than the age of the universe.', visual: 'technology' },
          { narration: 'Traditional computers use bits, which are either zero or one. Quantum computers use qubits, which can be zero, one, and both at the same time. This is called superposition, and it changes everything.', visual: 'computer' },
          { narration: 'Here is why this matters. Every encryption that protects your bank account, your messages, your medical records, it all relies on math that quantum computers can solve in seconds. We are talking about breaking the foundation of internet security.', visual: 'coding' },
          { narration: 'But quantum computing is not just about breaking things. It can simulate molecules for drug discovery, optimize traffic for entire cities, and solve climate models that classical computers cannot even begin to process.', visual: 'data' },
          { narration: 'The race is on between Google, IBM, and China to build the first fault tolerant quantum computer. Whoever wins this race will control the next era of technology. And most people have no idea it is happening.', visual: 'server' },
          { narration: 'The quantum revolution is not coming. It is already here. Subscribe to stay ahead of the curve.', visual: 'digital' },
        ],
      },
      '5G Technology': {
        title: '5G Is Not Just Faster Internet And Here Is Proof',
        scenes: [
          { narration: 'Everyone thinks 5G is just faster downloads. That is like saying a nuclear reactor is just a fancy way to boil water. The reality is so much bigger.', visual: 'technology' },
          { narration: '5G networks can connect one million devices per square kilometer. Your current 4G network handles about one hundred thousand. That ten times increase means entire cities can go fully smart, with every traffic light, every sensor, every vehicle connected in real time.', visual: 'server' },
          { narration: 'Here is the part that blows my mind. 5G latency is one millisecond. That is fast enough for a surgeon in New York to perform robotic surgery on a patient in Tokyo, in real time, with zero lag. Remote medicine just became real.', visual: 'computer' },
          { narration: 'Self driving cars need to communicate with each other in milliseconds to avoid accidents. 5G makes that possible. Without it, autonomous vehicles are just expensive paperweights.', visual: 'robot' },
          { narration: 'The countries that roll out 5G fastest will dominate the next decade of economic growth. China has already built over two million 5G base stations. The race is not even close.', visual: 'data' },
          { narration: '5G is not an upgrade. It is a completely new foundation for civilization. Like and follow for more tech breakdowns.', visual: 'digital' },
        ],
      },
      'Cybersecurity Secrets': {
        title: 'Your Password Protects Nothing And Here Is Why',
        scenes: [
          { narration: 'The average company experiences a cyber attack every one hundred and nineteen seconds. That is twenty six attacks per day. And most of them succeed because of one thing. Human error.', visual: 'coding' },
          { narration: 'Ninety five percent of cybersecurity breaches are caused by human mistakes. Clicking one phishing link can give hackers access to an entire corporate network. One mistake. That is all it takes.', visual: 'computer' },
          { narration: 'Here is what terrifies security experts. Ransomware attacks have increased by three hundred percent in the last three years. Hospitals, schools, entire city governments are being held hostage. And they are paying.', visual: 'server' },
          { narration: 'The password you use right now has probably been leaked in a data breach. There are over fifteen billion stolen credentials circulating on the dark web right now. Your email, your passwords, they are already out there.', visual: 'digital' },
          { narration: 'But here is the good news. Two factor authentication alone stops ninety nine percent of automated attacks. A fifteen second action that most people are too lazy to set up.', visual: 'data' },
          { narration: 'Cybercrime will cost the world ten point five trillion dollars by twenty twenty five. Protect yourself. Use a password manager, enable two factor authentication, and stop clicking suspicious links. Follow for more security tips.', visual: 'robot' },
        ],
      },
      'Virtual Reality': {
        title: 'Virtual Reality Will Replace Your Entire Life In Five Years',
        scenes: [
          { narration: 'Mark Zuckerberg renamed his entire company to bet on the future of virtual reality. Apple released a three thousand five hundred dollar headset. Every tech giant on earth is racing toward the same goal. A fully virtual world.', visual: 'technology' },
          { narration: 'Current VR headsets have a resolution of about fifty pixels per degree. The human eye can resolve about sixty. We are already at ninety percent of biological vision quality. Within two years, you will not be able to tell the difference between VR and reality.', visual: 'data' },
          { narration: 'Virtual reality classrooms are already being tested. Medical students are performing surgeries in VR before touching a real patient. The training advantage is enormous. Mistakes cost nothing. Repetition is infinite.', visual: 'computer' },
          { narration: 'Here is where it gets crazy. The VR market is projected to hit eighty seven billion dollars by twenty thirty. Real estate tours, job interviews, therapy sessions, everything is moving to virtual.', visual: 'server' },
          { narration: 'The question is not whether VR will change your life. It is whether you will be an early adopter or the last person still using a flat screen. The transition is happening right now.', visual: 'robot' },
          { narration: 'The future is immersive. Subscribe to stay ahead of the curve.', visual: 'digital' },
        ],
      },
      'Machine Learning': {
        title: 'Machine Learning Is Learning Faster Than Humans Ever Could',
        scenes: [
          { narration: 'AlphaFold predicted the structure of every known protein on earth. Two hundred million proteins. Scientists spent fifty years mapping one hundred and seventy thousand. AI did the rest in months.', visual: 'artificial intelligence' },
          { narration: 'Machine learning does not just follow instructions. It learns patterns from data that no human could ever identify. It finds correlations across millions of variables simultaneously. It is not smarter than us. It sees things we physically cannot.', visual: 'data' },
          { narration: 'Self driving cars use machine learning to process two point five gigabytes of data per hour. Cameras, lidar, radar, all feeding into models that make split second decisions that save lives.', visual: 'robot' },
          { narration: 'The real power is in prediction. Machine learning models can predict stock movements, disease outbreaks, equipment failures, and customer behavior with accuracy that surpasses human experts in every field tested.', visual: 'computer' },
          { narration: 'But here is the catch nobody talks about. These models are only as good as the data they learn from. Biased data creates biased AI. And we are deploying it everywhere before we fully understand the consequences.', visual: 'server' },
          { narration: 'Machine learning is the most powerful tool humanity has ever created. Whether it becomes our greatest asset or our biggest risk depends entirely on how we choose to use it. Follow for more tech insights.', visual: 'digital' },
        ],
      },
      'Blockchain Explained': {
        title: 'Blockchain Is Not About Crypto And Most People Are Wrong',
        scenes: [
          { narration: 'Everyone thinks blockchain is about Bitcoin. That is like saying the internet is about email. Blockchain is a technology that can fundamentally change how trust works in the digital world.', visual: 'technology' },
          { narration: 'Here is the simplest explanation. Blockchain is a database that nobody owns, nobody can hack, and nobody can erase. Every transaction is permanently recorded and verified by thousands of computers simultaneously.', visual: 'server' },
          { narration: 'Supply chain tracking is already transforming shipping. Walmart traces every food product back to its source using blockchain. When there is a contamination recall, they can identify the exact farm in seconds instead of weeks.', visual: 'data' },
          { narration: 'Smart contracts on blockchain execute automatically when conditions are met. No lawyers. No banks. No delays. Real estate deals, insurance claims, royalty payments, all happening instantly and transparently.', visual: 'coding' },
          { narration: 'Major corporations like Amazon, Microsoft, and JPMorgan are building enterprise blockchain solutions. This is not speculative. This is infrastructure being built right now.', visual: 'computer' },
          { narration: 'Understanding blockchain is not optional anymore. It is becoming as fundamental as understanding the internet was in nineteen ninety five. Subscribe to learn more.', visual: 'digital' },
        ],
      },
      'Robot Takeover': {
        title: 'Robots Will Do Half Of All Jobs Within Ten Years',
        scenes: [
          { narration: 'Foxconn replaced sixty thousand factory workers with robots in a single factory. Amazon has over seven hundred and fifty thousand robots in its warehouses. This is just the beginning.', visual: 'robot' },
          { narration: 'The World Economic Forum predicts robots will displace eighty five million jobs by twenty twenty five. But they will also create ninety seven million new ones. The question is whether you will have the skills for those new jobs.', visual: 'data' },
          { narration: 'Boston Dynamics robots can now open doors, climb stairs, do backflips, and carry heavy loads across any terrain. The physical capabilities gap between humans and robots is closing faster than anyone predicted.', visual: 'technology' },
          { narration: 'Surgical robots are already performing operations with precision that no human surgeon can match. The da Vinci system has completed over ten million procedures. Error rates are a fraction of human surgery.', visual: 'computer' },
          { narration: 'But here is what keeps economists up at night. White collar jobs are not safe either. AI can write legal documents, diagnose diseases, trade stocks, and generate software code. The robot takeover is not coming for blue collar workers. It is coming for everyone.', visual: 'server' },
          { narration: 'The people who thrive will be the ones who learn to work alongside machines. The future belongs to humans and robots together. Follow for more insights on the future of work.', visual: 'digital' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'This technology is about to change everything you know about the world. And most people are completely unprepared for what is coming.', visual: 'technology' },
      { narration: 'The current pace of innovation is exponential. Every year, computing power doubles while costs halve. This trend has been happening for sixty years and there is no sign of it stopping.', visual: 'computer' },
      { narration: 'What makes this different from previous tech revolutions is the speed. The internet took fifteen years to reach a billion users. ChatGPT did it in two months. The adoption curve is getting steeper.', visual: 'coding' },
      { narration: 'The data backs this up. Global tech investment hit three hundred billion dollars last year. Companies are not just experimenting anymore, they are going all in.', visual: 'data' },
      { narration: 'Here is what nobody tells you. The real opportunity is not in the technology itself, but in understanding how it changes human behavior. That is where the money is.', visual: 'robot' },
      { narration: 'The future belongs to those who understand it. Follow for more insights that keep you ahead of the curve.', visual: 'digital' },
    ],
    tags: ['technology', 'tech', 'AI', 'future', 'innovation', 'coding', 'programming'],
    hashtags: ['#tech', '#technology', '#AI', '#innovation', '#coding', '#future'],
  },
  science: {
    gradientTop: '0x10b981', gradientBot: '0x0a1a2e',
    topics: ['Black Holes', 'DNA Secrets', 'Ocean Mysteries', 'Quantum Physics', 'Time Travel', 'Alien Life', 'Brain Science', 'Parallel Universe'],
    searchQueries: ['space', 'laboratory', 'ocean', 'universe', 'physics', 'experiment', 'brain', 'nature'],
    topicContent: {
      'Black Holes': {
        title: 'Black Holes Are Not What You Think They Are',
        scenes: [
          { narration: 'A black hole so massive it has the weight of forty billion suns was just discovered at the edge of the observable universe. Light itself cannot escape its pull. Not even at three hundred thousand kilometers per second.', visual: 'space' },
          { narration: 'Here is what breaks your brain. Inside a black hole, space and time swap roles. Moving forward in time becomes moving toward the center. There is literally no way to avoid it, just like you cannot avoid moving forward in time right now.', visual: 'universe' },
          { narration: 'The event horizon is the point of no return. Once you cross it, every possible path through space leads inward. It is not that you cannot escape. It is that escape does not exist as a concept anymore.', visual: 'data' },
          { narration: 'But here is the mind blowing part. Stephen Hawking proved that black holes are not completely black. They emit radiation and slowly evaporate over trillions of years. Even the universe most extreme objects eventually die.', visual: 'experiment' },
          { narration: 'Scientists at the Event Horizon Telescope actually photographed a black hole in two thousand nineteen. We are literally looking at the edge of infinity. Let that sink in.', visual: 'laboratory' },
          { narration: 'The universe is stranger than we can imagine. Subscribe to explore more mysteries with us.', visual: 'nature' },
        ],
      },
      'DNA Secrets': {
        title: 'Your DNA Contains Code That Scientists Cannot Explain',
        scenes: [
          { narration: 'Ninety eight percent of your DNA was considered junk by scientists for decades. They believed it served no purpose. Turns out they were completely wrong about all of it.', visual: 'laboratory' },
          { narration: 'Wait, let me explain that properly. Ninety eight percent of your DNA was called junk by scientists for decades. Turns out, it is not junk at all. It is regulatory code that controls which genes turn on and off.', visual: 'experiment' },
          { narration: 'Your body has thirty seven trillion cells, and every single one contains the same DNA. But a brain cell works completely differently from a skin cell. The difference is in gene expression, which is controlled by that so called junk DNA.', visual: 'brain' },
          { narration: 'Here is where it gets wild. CRISPR technology lets us edit DNA like editing a document. We can now fix genetic diseases, create drought resistant crops, and even bring back extinct species. We are literally rewriting the code of life.', visual: 'data' },
          { narration: 'The Human Genome Project took thirteen years and three billion dollars to map all our DNA. Today, you can sequence your entire genome in twenty four hours for under two hundred dollars. That is a fifteen million times improvement.', visual: 'laboratory' },
          { narration: 'Biology is the new technology. The scientists who understand genetics will shape the next century. Follow for more mind blowing discoveries.', visual: 'nature' },
        ],
      },
      'Ocean Mysteries': {
        title: 'We Know More About Mars Than Our Own Ocean Floor',
        scenes: [
          { narration: 'More than eighty percent of the ocean floor has never been mapped by humans. We have better maps of Mars and the Moon than we do of our own planet underwater. Let that sink in for a second.', visual: 'ocean' },
          { narration: 'At the bottom of the ocean, in complete darkness, at pressures that would crush a submarine like a soda can, life thrives. Hydrothermal vents spew superheated water at four hundred degrees Celsius, and entire ecosystems exist around them.', visual: 'nature' },
          { narration: 'Scientists recently discovered a new species of jellyfish that glows in ultraviolet light at depths of three thousand meters. Every expedition to the deep ocean finds dozens of species we have never seen before.', visual: 'experiment' },
          { narration: 'The deep ocean contains more biomass than all the rainforests combined. Microbes in the seafloor hold secrets to new antibiotics, cancer treatments, and even clean energy sources we have not imagined yet.', visual: 'data' },
          { narration: 'The ocean absorbs thirty percent of the carbon dioxide we produce and generates over fifty percent of the oxygen we breathe. It is the real lung of this planet, and we are polluting it faster than we understand.', visual: 'ocean' },
          { narration: 'The next great frontier of discovery is not space. It is right below our feet. Subscribe to explore the unknown.', visual: 'nature' },
        ],
      },
      'Quantum Physics': {
        title: 'Quantum Physics Proves Reality Is Not What You Think',
        scenes: [
          { narration: 'At the quantum level, particles exist in multiple states simultaneously until they are observed. The act of looking at something literally changes what it is. This has been proven in laboratories thousands of times.', visual: 'experiment' },
          { narration: 'The double slit experiment is the most beautiful proof in all of science. When you do not watch, particles behave like waves. The moment you measure them, they become particles. Reality changes based on whether you are paying attention.', visual: 'laboratory' },
          { narration: 'Quantum entanglement means two particles can be connected across any distance. Einstein called it spooky action at a distance. When you measure one, the other instantly changes. Not after light speed. Instantly.', visual: 'data' },
          { narration: 'Here is what breaks every intuition you have. A particle can be in two places at once. It can spin both clockwise and counterclockwise simultaneously. This is not theory. This is measured reality at the smallest scale.', visual: 'universe' },
          { narration: 'Quantum mechanics is the most tested theory in the history of science. Every prediction it has ever made has been confirmed to twelve decimal places. And yet nobody fully understands why it works.', visual: 'space' },
          { narration: 'Reality is far stranger than it appears. Subscribe to explore the deepest questions in physics.', visual: 'nature' },
        ],
      },
      'Time Travel': {
        title: 'Time Travel Is Already Happening And You Do Not Realize It',
        scenes: [
          { narration: 'Einstein proved that time is not constant. It flows at different speeds depending on how fast you are moving and how strong the gravity is around you. Time travel to the future is not science fiction. It is established physics.', visual: 'universe' },
          { narration: 'GPS satellites experience time differently than clocks on Earth. Without correcting for Einstein theory of relativity, your GPS would be off by ten kilometers every single day. Time dilation is real and we correct for it daily.', visual: 'data' },
          { narration: 'Astronaut Scott Kelly spent one year on the International Space Station. When he returned, he was zero point zero zero five seconds younger than his twin brother who stayed on Earth. He literally traveled into the future.', visual: 'experiment' },
          { narration: 'Here is the mind bending part. The faster you travel, the slower time passes for you. If you could fly at ninety nine percent the speed of light, one year for you would be seven years on Earth. You would arrive in Earth future.', visual: 'space' },
          { narration: 'Traveling to the past is where physics gets really complicated. Wormholes, closed timelike curves, and paradoxes make it theoretically possible but practically impossible. Or so we think right now.', visual: 'laboratory' },
          { narration: 'The universe is a time machine. We are all traveling forward at one second per second. The question is whether we can learn to control the speed. Follow for more mind bending science.', visual: 'nature' },
        ],
      },
      'Alien Life': {
        title: 'We Are Almost Certainly Not Alone In The Universe',
        scenes: [
          { narration: 'There are an estimated two hundred billion trillion stars in the observable universe. If even one in a million has a planet with life, that is two hundred billion civilizations. The math alone says we cannot be alone.', visual: 'space' },
          { narration: 'NASA discovered over five thousand exoplanets in the last decade. Many of them are in the habitable zone where liquid water could exist. The ingredients for life are everywhere we look.', visual: 'universe' },
          { narration: 'In twenty twenty three, the James Webb Space Telescope detected dimethyl sulfide in the atmosphere of an exoplanet. On Earth, this molecule is only produced by living organisms. If confirmed, this could be the first evidence of alien life.', visual: 'experiment' },
          { narration: 'The Drake Equation estimates the number of communicating civilizations in our galaxy. Even with conservative estimates, there should be at least ten thousand active civilizations in the Milky Way alone.', visual: 'data' },
          { narration: 'But here is the terrifying possibility. The Fermi Paradox asks if all these civilizations exist, where is everybody? Either intelligent life is extremely rare, or there is a great filter that destroys civilizations before they can communicate.', visual: 'laboratory' },
          { narration: 'The search for alien life is the most important scientific quest in human history. The answer changes everything we know about ourselves. Subscribe to follow the search.', visual: 'nature' },
        ],
      },
      'Brain Science': {
        title: 'Your Brain Is Hacking Itself And You Have No Idea',
        scenes: [
          { narration: 'Your brain processes eleven million bits of information every second. But your conscious mind can only handle about fifty. Your brain is filtering out ninety nine point nine nine percent of reality and showing you a curated version.', visual: 'brain' },
          { narration: 'Neuroscientists discovered that your brain makes decisions seven seconds before you become aware of them. Your conscious mind is not making choices. It is creating stories about choices your brain already made.', visual: 'experiment' },
          { narration: 'The human brain has eighty six billion neurons connected by one hundred trillion synapses. It is the most complex object in the known universe. And it weighs only three pounds.', visual: 'laboratory' },
          { narration: 'Here is what is wild. Your brain rewires itself based on your experiences. London taxi drivers have physically larger hippocampi from navigating complex streets. Practice literally changes your brain structure.', visual: 'data' },
          { narration: 'Sleep is when your brain cleans itself. During deep sleep, cerebrospinal fluid flushes out toxic waste products. Cut your sleep short and that waste accumulates. Chronic sleep deprivation is literally poisoning your brain.', visual: 'nature' },
          { narration: 'Understanding your brain is the key to unlocking human potential. Subscribe to explore the most complex machine in existence.', visual: 'space' },
        ],
      },
      'Parallel Universe': {
        title: 'Parallel Universes Are Not SciFi They Are Mathematics',
        scenes: [
          { narration: 'The many worlds interpretation of quantum mechanics suggests that every quantum event creates a branch in reality. Every possible outcome happens. Just in a different universe. There are potentially infinite versions of you right now.', visual: 'universe' },
          { narration: 'String theory requires ten or eleven dimensions to work mathematically. We can only perceive four. The rest could be entire universes existing right next to ours, separated by dimensions we cannot access.', visual: 'space' },
          { narration: 'The cosmic microwave background radiation, the leftover glow from the Big Bang, has cold spots that some physicists believe are bruises from collisions with other universes. Evidence of other worlds written in the oldest light in existence.', visual: 'data' },
          { narration: 'Here is the mind bending part. If parallel universes exist, then every possible version of history is happening simultaneously. Every choice you did not make is being made somewhere else. Every road not taken is traveled.', visual: 'experiment' },
          { narration: 'This is not fringe science. The many worlds interpretation is one of the most widely accepted interpretations of quantum mechanics among physicists. The math supports it. The evidence does not contradict it.', visual: 'laboratory' },
          { narration: 'Reality may be far larger than we ever imagined. Subscribe to explore the biggest questions in science.', visual: 'nature' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Scientists just made a discovery that completely changes how we understand the natural world. And it happened completely under the radar.', visual: 'space' },
      { narration: 'The universe is 13.8 billion years old. In that time, matter organized itself into stars, galaxies, planets, and eventually into conscious beings that can study the universe itself. That is not just incredible. It is statistically almost impossible.', visual: 'universe' },
      { narration: 'Here is what most people get wrong about science. It is not about being certain. It is about being less wrong over time. Every great discovery started with someone admitting they did not know something.', visual: 'laboratory' },
      { narration: 'The evidence for this particular discovery comes from multiple independent research teams across three continents. When scientists who disagree on everything reach the same conclusion, you know something big is happening.', visual: 'experiment' },
      { narration: 'This changes the textbooks. It changes the way we teach this subject. And it opens doors to applications that were pure science fiction just five years ago.', visual: 'brain' },
      { narration: 'Science is the greatest adventure humanity has ever undertaken. Follow along for more discoveries.', visual: 'nature' },
    ],
    tags: ['science', 'space', 'physics', 'biology', 'discovery', 'nature', 'universe'],
    hashtags: ['#science', '#space', '#physics', '#discovery', '#nature', '#universe'],
  },
  finance: {
    gradientTop: '0xf59e0b', gradientBot: '0x1a0a00',
    topics: ['Money Secrets', 'Investing Basics', 'Crypto Explained', 'Passive Income', 'Stock Market', 'Real Estate', 'Side Hustles', 'Retirement Planning'],
    searchQueries: ['money', 'business', 'stock market', 'cryptocurrency', 'investment', 'finance', 'office', 'success'],
    topicContent: {
      'Money Secrets': {
        title: 'Rich People Do Not Want You To Know These Money Rules',
        scenes: [
          { narration: 'The wealthiest one percent do not work for money. They make money work for them. This single difference in mindset is why ninety nine percent of people stay broke their entire lives.', visual: 'money' },
          { narration: 'Rule number one. The rich buy assets. Assets are things that put money in your pocket every month. Stocks, real estate, businesses. The poor and middle class buy liabilities. Cars, gadgets, clothes that lose value the moment you buy them.', visual: 'business' },
          { narration: 'Here is a number that will shock you. If you invested just three hundred dollars per month starting at age twenty five, with a ten percent average return, you would have over one million dollars by age fifty five. That is the power of compound interest.', visual: 'data' },
          { narration: 'But here is what schools never teach you. The biggest expense in your life is not your house or your car. It is taxes. The rich use legal tax strategies that save them millions. And those strategies are available to anyone who learns them.', visual: 'stock market' },
          { narration: 'Warren Buffett reads five hundred pages a day. Bill Gates reads fifty books a year. The richest people in the world are the most educated, not in school, but in financial literacy. Knowledge is literally money.', visual: 'investment' },
          { narration: 'The difference between wealth and poverty is information. You just got some. Save this video and share it with someone who needs to hear it.', visual: 'success' },
        ],
      },
      'Crypto Explained': {
        title: 'Cryptocurrency Is Rewriting The Rules Of Money',
        scenes: [
          { narration: 'In two thousand ten, one Bitcoin was worth less than one penny. Today it trades at over sixty thousand dollars. That is a six billion percent return. No other asset in human history has done anything close to that.', visual: 'money' },
          { narration: 'Here is the simplest way to understand crypto. It is money that no government controls. No central bank can print more of it and inflate its value away. Bitcoin has a hard cap of twenty one million coins. That is it. Forever.', visual: 'cryptocurrency' },
          { narration: 'But Bitcoin is just the beginning. Ethereum created programmable money. Smart contracts automatically execute when conditions are met. No lawyers, no banks, no middlemen. Just code.', visual: 'coding' },
          { narration: 'The total crypto market is worth over two trillion dollars. Major institutions like BlackRock, Fidelity, and Goldman Sachs now have crypto divisions. This is not a fad. This is institutional adoption.', visual: 'business' },
          { narration: 'Here is what most people get wrong. They think crypto is about getting rich quick. The real revolution is financial inclusion. Two billion people worldwide do not have bank accounts. Crypto gives them access to the global economy.', visual: 'investment' },
          { narration: 'Whether you invest or not, understanding this technology is no longer optional. It is essential. Follow for more financial insights.', visual: 'success' },
        ],
      },
      'Investing Basics': {
        title: 'The First Thousand Dollars Is The Hardest Heres Why',
        scenes: [
          { narration: 'The biggest myth in investing is that you need a lot of money to start. You can open a brokerage account with zero dollars and buy fractional shares of companies for as little as one dollar. There is no excuse anymore.', visual: 'money' },
          { narration: 'Here is the strategy that every billionaire uses. Index funds. Warren Buffett bet one million dollars that an S and P five hundred index fund would beat professional hedge funds over ten years. He won. Easily.', visual: 'stock market' },
          { narration: 'Dollar cost averaging is the most powerful tool for regular people. Invest a fixed amount every single month regardless of market conditions. When prices are low, you buy more. When prices are high, you buy less. Over time, your average price is always favorable.', visual: 'data' },
          { narration: 'The stock market has returned an average of ten percent per year for the last century. That means your money doubles every seven years. One thousand dollars today becomes sixty four thousand dollars in forty two years without adding a single cent.', visual: 'investment' },
          { narration: 'The biggest mistake beginners make is waiting for the perfect moment. There is no perfect moment. The best time to start investing was twenty years ago. The second best time is right now.', visual: 'success' },
          { narration: 'Your future self will thank you for starting today. Share this with someone who needs to hear it.', visual: 'business' },
        ],
      },
      'Passive Income': {
        title: 'Five Streams Of Passive Income That Actually Work',
        scenes: [
          { narration: 'The average millionaire has seven streams of income. Not because they work seven jobs. Because they build systems that generate money while they sleep. That is the definition of passive income.', visual: 'money' },
          { narration: 'Dividend stocks pay you just for owning them. Companies like Coca Cola have paid increasing dividends for over sixty years. Buy once, get paid every quarter, forever. It is the closest thing to free money that exists legally.', visual: 'stock market' },
          { narration: 'Rental real estate generates monthly cash flow while the property appreciates in value. A single rental property can generate five hundred to two thousand dollars per month in passive income after the mortgage is paid.', visual: 'business' },
          { narration: 'Digital products are the ultimate passive income. Write an ebook once, create an online course once, design a template once, and sell it an unlimited number of times with zero marginal cost. The internet made this possible.', visual: 'data' },
          { narration: 'Here is the honest truth. Passive income is not truly passive at the start. You invest time and sometimes money upfront. But once the system is built, it runs itself. That is the difference between trading time for money and building wealth.', visual: 'investment' },
          { narration: 'Building passive income streams is how you break free from the rat race. Start with one stream. Master it. Then build the next. Follow for more financial strategies.', visual: 'success' },
        ],
      },
      'Stock Market': {
        title: 'The Stock Market Is Rigged And That Is Good News',
        scenes: [
          { narration: 'People say the stock market is rigged for the rich. They are right. And that is actually great news for you. Because the rules that the rich use are completely legal and available to everyone.', visual: 'money' },
          { narration: 'Here is the biggest secret. The stock market is the only place where institutions are legally required to report exactly what they own every quarter. You can see exactly what the wealthiest investors are buying and selling.', visual: 'stock market' },
          { narration: 'Warren Buffett portfolio is public knowledge. When he buys, you can buy the same stocks. When he sells, you can sell too. There is no information advantage in modern investing. Only a discipline advantage.', visual: 'data' },
          { narration: 'Market crashes are not disasters for smart investors. They are sales. When the market dropped thirty four percent in March twenty twenty, it recovered fully within five months. Every single crash in history has been followed by a recovery and new highs.', visual: 'investment' },
          { narration: 'The stock market has survived two world wars, a great depression, pandemics, financial crises, and countless recessions. It has always recovered. Patience beats panic. Every. Single. Time.', visual: 'business' },
          { narration: 'Understanding the stock market is understanding the engine of wealth creation. Start learning. Start investing. Your future depends on it. Follow for more market insights.', visual: 'success' },
        ],
      },
      'Real Estate': {
        title: 'Real Estate Makes More Millionaires Than Any Other Investment',
        scenes: [
          { narration: 'According to Forbes, real estate accounts for more millionaire fortunes than any other industry. The reason is simple. Real estate gives you five ways to make money simultaneously. Appreciation, cash flow, loan paydown, tax benefits, and leverage.', visual: 'money' },
          { narration: 'Leverage is the superpower of real estate. With twenty thousand dollars, you can control a two hundred thousand dollar property through a mortgage. That means a ten percent increase in property value gives you a fifty percent return on your actual investment.', visual: 'investment' },
          { narration: 'House hacking is the strategy that builds the most wealth for beginners. Buy a duplex, live in one unit, rent out the other. Your tenant pays your mortgage while you build equity. You live for free while building wealth.', visual: 'business' },
          { narration: 'Real estate generates passive income. After your mortgage and expenses, a rental property can put five hundred to two thousand dollars in your pocket every month. Ten properties means five to twenty thousand dollars per month in passive income.', visual: 'data' },
          { narration: 'The tax advantages are enormous. Depreciation lets you write off the value of your property even while it appreciates. You can defer capital gains through 1031 exchanges. Real estate investors pay the lowest effective tax rate of any wealth class.', visual: 'stock market' },
          { narration: 'Real estate is the most proven path to building lasting wealth. Start researching your local market today. Follow for more real estate strategies.', visual: 'success' },
        ],
      },
      'Side Hustles': {
        title: 'Your Side Hustle Should Replace Your Salary In Twelve Months',
        scenes: [
          { narration: 'The average millionaire did not get rich from their day job. They got rich from what they did outside of work. A side hustle is not extra pocket money. It is the seed of a business that can change your entire financial life.', visual: 'money' },
          { narration: 'Freelancing is the fastest path. You already have a skill that someone will pay for. Writing, design, coding, marketing, accounting. Find clients on platforms like Upwork and Fiverr. You can start earning within a week.', visual: 'business' },
          { narration: 'Here is the math that changes lives. If your side hustle generates just one thousand dollars per month and you invest it all at a ten percent annual return, you will have over one point five million dollars in thirty years. One thousand dollars per month.', visual: 'data' },
          { narration: 'Content creation is the ultimate scalable side hustle. Start a YouTube channel, a podcast, a newsletter. The content you create today can generate revenue for years. The barrier to entry has never been lower.', visual: 'investment' },
          { narration: 'The biggest mistake people make is waiting until they feel ready. You will never feel ready. Start messy. Start small. Start today. You can improve as you go. But you cannot improve on something that does not exist.', visual: 'success' },
          { narration: 'Your nine to five pays the bills. Your side hustle builds wealth. Start one today. Follow for more strategies.', visual: 'stock market' },
        ],
      },
      'Retirement Planning': {
        title: 'If You Are Under Forty And Not Doing This You Are Behind',
        scenes: [
          { narration: 'Here is a number that should scare you. The average American has less than one hundred thousand dollars saved for retirement. At a conservative spending rate, that lasts about three years. Most people will live twenty to thirty years after retirement.', visual: 'money' },
          { narration: 'A 401k match is literally free money. If your employer matches five percent and you earn sixty thousand dollars, that is three thousand dollars per year your company gives you for free. Not taking the match is like leaving cash on the table every single day.', visual: 'investment' },
          { narration: 'A Roth IRA lets you invest after tax dollars and never pay taxes on the gains. Ever. If you invest six thousand dollars per year starting at age twenty five, at a ten percent return, you will have over three million dollars by age sixty five. All tax free.', visual: 'data' },
          { narration: 'The rule of seventy two tells you how fast your money doubles. Divide seventy two by your return rate. At ten percent, your money doubles every seven point two years. At twenty five, you have time for your money to double over seven times before retirement.', visual: 'stock market' },
          { narration: 'Every year you wait costs you exponentially more. Starting at twenty five instead of thirty five means you end up with roughly twice as much money at retirement. Time is the most powerful force in retirement planning. Not money.', visual: 'business' },
          { narration: 'Your retirement is your responsibility. Not your employer. Not the government. Yours. Start today. Follow for more financial planning tips.', visual: 'success' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Ninety percent of millionaires built their wealth through investing, not inheritance. Yet most people keep their money in a savings account earning less than inflation. This is financial suicide.', visual: 'money' },
      { narration: 'Here is a simple rule the wealthy live by. Pay yourself first. Before you pay rent, before you pay bills, before you buy groceries, put at least twenty percent of your income into investments. This one habit separates the rich from everyone else.', visual: 'business' },
      { narration: 'Compound interest is the eighth wonder of the world. A one hundred dollar investment growing at ten percent annually becomes seventeen thousand four hundred forty nine dollars in fifty years. Start early. Time is your biggest asset.', visual: 'stock market' },
      { narration: 'The stock market has returned an average of ten percent per year over the past century. It has crashed multiple times, recovered every single time, and gone on to reach new highs. Patience beats panic every time.', visual: 'data' },
      { narration: 'Financial literacy is not taught in schools. The system wants you to work, spend, and repeat. Breaking that cycle starts with education. You are taking that step right now.', visual: 'investment' },
      { narration: 'Your financial future starts with one decision. Save this video, share it, and start building wealth today.', visual: 'success' },
    ],
    tags: ['finance', 'money', 'investing', 'wealth', 'crypto', 'stocks', 'business'],
    hashtags: ['#finance', '#money', '#investing', '#wealth', '#crypto', '#business'],
  },
  mystery: {
    gradientTop: '0xef4444', gradientBot: '0x1a0000',
    topics: ['Bermuda Triangle', 'Conspiracy Theories', 'Lost Civilizations', 'Unsolved Mysteries', 'Ancient Aliens', 'Government Secrets', 'Paranormal', 'Strange Phenomena'],
    searchQueries: ['mystery', 'dark', 'fog', 'ancient', 'night', 'forest', 'abandoned', 'smoke'],
    topicContent: {
      'Bermuda Triangle': {
        title: 'The Bermuda Triangle Has Claimed Over 300 Lives And Nobody Knows Why',
        scenes: [
          { narration: 'Between nineteen forty five and twenty twenty three, over three hundred people have disappeared in the Bermuda Triangle without a trace. No wreckage. No bodies. No explanation. Just gone.', visual: 'mystery' },
          { narration: 'Flight nineteen is the most famous case. Five Navy bombers took off from Fort Lauderdale in nineteen forty five. Their last radio transmission was: we cannot find west. Everything looks wrong. Even the ocean does not look as it should. All five planes vanished.', visual: 'dark' },
          { narration: 'Here is what makes the Bermuda Triangle different from other dangerous areas. Ships have been found completely intact but with every single person on board missing. The USS Cyclops, a five hundred forty two foot Navy cargo ship, disappeared in nineteen twenty three with three hundred nine people aboard. No distress signal. No wreckage ever found.', visual: 'fog' },
          { narration: 'Scientists have proposed theories. Methane gas eruptions from the ocean floor can create bubbles that reduce water density so fast that a ship sinks in seconds. Underwater compass anomalies caused by magnetic variations could disorient pilots completely.', visual: 'experiment' },
          { narration: 'But here is the detail that haunts researchers. Some disappearances happen in clear weather, with experienced pilots, on routes they have flown dozens of times before. The ocean is not finished keeping its secrets.', visual: 'night' },
          { narration: 'What do you think is really happening in the Bermuda Triangle? Drop your theory in the comments. Follow for more unsolved mysteries.', visual: 'forest' },
        ],
      },
      'Lost Civilizations': {
        title: 'An Entire Civilization Vanished Overnight And Nobody Can Explain It',
        scenes: [
          { narration: 'The Indus Valley Civilization had over five million people, advanced urban planning, indoor plumbing, and standardized weights and measures. Then, around nineteen hundred BCE, they simply disappeared. The cities were abandoned overnight.', visual: 'ancient' },
          { narration: 'Gobekli Tepe in Turkey is a temple complex built twelve thousand years ago. That is six thousand years before the pyramids. Hunter gatherers with no metal tools, no writing, no pottery built a massive stone monument that still puzzles archaeologists today.', visual: 'dark' },
          { narration: 'Here is the mystery that keeps scientists up at night. The Maya civilization built cities housing over one hundred thousand people, developed the concept of zero, and created a calendar more accurate than the one we use today. Then they walked away from their cities and vanished into the jungle.', visual: 'forest' },
          { narration: 'Recent discoveries using LIDAR technology revealed over sixty thousand previously unknown structures hidden beneath the jungle canopy. We have barely scratched the surface of what these civilizations actually built.', visual: 'data' },
          { narration: 'The pattern is clear. Advanced civilizations can and do collapse. The question is not whether it can happen to us. The question is whether we are paying attention to the warning signs.', visual: 'mystery' },
          { narration: 'History is full of gaps that challenge everything we think we know. Follow for more unsolved mysteries of the ancient world.', visual: 'ancient' },
        ],
      },
      'Conspiracy Theories': {
        title: 'These Conspiracy Theories Turned Out To Be True',
        scenes: [
          { narration: 'In nineteen seventy six, the CIA admitted to conducting illegal drug experiments on American citizens without their knowledge. MK Ultra was labeled a conspiracy theory for twenty years before declassified documents proved it was real all along.', visual: 'dark' },
          { narration: 'Project Prism revealed that the NSA was collecting phone records of millions of Americans. Edward Snowden leaked the documents in twenty thirteen. For years before that, anyone who claimed the government was spying on citizens was called paranoid.', visual: 'mystery' },
          { narration: 'The Gulf of Tonkin incident that escalated the Vietnam War was later admitted by the government to have been misrepresented. Declassified documents show the second attack never happened. But the war started anyway.', visual: 'night' },
          { narration: 'Here is what matters. Not all conspiracy theories are true. But dismissing every single one as crazy is equally dangerous. The government has a documented history of lying to the public. Healthy skepticism is not paranoia. It is patriotism.', visual: 'fog' },
          { narration: 'The lesson is not to believe everything. The lesson is to verify everything. Question sources. Check documents. Think critically. That is how you find the truth in a world full of noise.', visual: 'forest' },
          { narration: 'Stay curious. Stay skeptical. Follow for more documented truths.', visual: 'ancient' },
        ],
      },
      'Unsolved Mysteries': {
        title: 'The World Biggest Mysteries Have No Explanations',
        scenes: [
          { narration: 'In nineteen oh eight, the Tunguska event flattened two thousand square kilometers of Siberian forest. The explosion was a thousand times more powerful than the Hiroshima bomb. No crater was ever found. No definitive explanation exists.', visual: 'mystery' },
          { narration: 'The Voynich manuscript is a book written in an unknown language that nobody has been able to decode in over six hundred years. It contains illustrations of plants that do not exist and astronomical diagrams that match no known constellation.', visual: 'dark' },
          { narration: 'The Wow signal was a strong radio signal detected in nineteen seventy seven from the direction of the constellation Sagittarius. It lasted seventy two seconds and had all the characteristics of an extraterrestrial signal. It has never been detected again.', visual: 'night' },
          { narration: 'The Dyatlov Pass incident involved nine experienced hikers who died in the Ural Mountains under bizarre circumstances. Their tent was cut open from the inside. Some were found barefoot in the snow. Others had unexplained injuries. The case remains unsolved.', visual: 'forest' },
          { narration: 'The ocean is full of mysteries we have not solved. The Bloop was an ultra low frequency underwater sound detected in nineteen ninety seven. It was loud enough to be heard across the entire Pacific Ocean. NOAA determined it was ice related. Some researchers disagree.', visual: 'fog' },
          { narration: 'The world is full of unanswered questions. Never stop asking why. Follow for more unsolved mysteries.', visual: 'ancient' },
        ],
      },
      'Ancient Aliens': {
        title: 'Ancient Structures That Should Not Exist',
        scenes: [
          { narration: 'The pyramids of Giza are aligned to the cardinal directions with an accuracy of three sixtieths of a degree. They are level to within two point one centimeters across two hundred and thirty meters. Modern engineers say this precision would be difficult even with today technology.', visual: 'ancient' },
          { narration: 'The Baalbek stones in Lebanon weigh up to twelve hundred tons. That is heavier than any crane in the ancient world could lift. How did a civilization with no iron tools, no wheels, and no pulleys move stones that modern engineering struggles with?', visual: 'mystery' },
          { narration: 'Puma Punku in Bolivia has stone blocks cut with such precision that they fit together without mortar. The angles are perfectly ninety degrees. The H blocks are identical to each other within microns. No known ancient culture had the technology to achieve this.', visual: 'dark' },
          { narration: 'Here is the uncomfortable question. Either ancient humans had technology and knowledge that we have completely lost. Or they had help from a source we cannot explain. Those are the only two options that fit the evidence.', visual: 'night' },
          { narration: 'Mainstream archaeology refuses to consider alternatives. But the stones do not care about academic politics. The precision is real. The weight is real. The mystery is real. And we deserve real answers.', visual: 'forest' },
          { narration: 'The ancient world holds secrets we have barely begun to uncover. Follow for more mind bending discoveries.', visual: 'fog' },
        ],
      },
      'Government Secrets': {
        title: 'The Government Has Declassified Things Worse Than You Think',
        scenes: [
          { narration: 'Operation Northwoods was a proposed false flag operation by the United States Department of Defense in nineteen sixty two. The plan was to commit terrorist attacks on American soil and blame it on Cuba to justify invasion. President Kennedy rejected it. The documents are declassified.', visual: 'dark' },
          { narration: 'Operation Mockingbird was a CIA program to influence media. Journalists at major news organizations were recruited to spread propaganda. The program ran for decades. This is not a theory. This is declassified CIA history.', visual: 'mystery' },
          { narration: 'The Department of Energy has acknowledged that Cold War era nuclear tests intentionally exposed hundreds of thousands of American citizens to radioactive fallout. They called them nuclear tourists. The government called them test subjects.', visual: 'night' },
          { narration: 'Here is the real issue. These are the programs that were declassified. The ones that remain classified are by definition unknown to us. We know the government has a history of lying. The question is what are they lying about right now.', visual: 'fog' },
          { narration: 'Being informed is not being paranoid. It is being responsible. Question authority. Demand transparency. The truth does not fear investigation.', visual: 'forest' },
          { narration: 'Knowledge is power. Stay informed. Follow for more documented government history.', visual: 'ancient' },
        ],
      },
      'Paranormal': {
        title: 'Scientific Studies Have Proven Some Paranormal Claims',
        scenes: [
          { narration: 'The US government spent over twenty million dollars on Project Stargate, a psychic espionage program. Remote viewers identified the location of a missing Soviet nuclear powered satellite. The program ran for twenty years before being declassified.', visual: 'mystery' },
          { narration: 'In two thousand eleven, the Journal of the Society for Psychical Research published a study showing that people can sense being stared at at rates significantly above chance. The effect is small but statistically significant across hundreds of experiments.', visual: 'experiment' },
          { narration: 'Sleep paralysis affects eight percent of the population. During these episodes, people experience vivid hallucinations of dark presences, pressure on their chest, and a sense of terror. The experience is identical across cultures and centuries. What is really happening?', visual: 'dark' },
          { narration: 'The placebos effect is the most documented paranormal phenomenon in medicine. Sugar pills can heal real diseases if the patient believes they are receiving real medication. The mind has measurable, proven effects on physical reality. That alone should terrify you.', visual: 'brain' },
          { narration: 'Science does not have all the answers. And dismissing everything we cannot explain as fiction is not science. It is dogma. True scientists follow the evidence, even when it leads to uncomfortable places.', visual: 'night' },
          { narration: 'The unknown is not something to fear. It is something to explore. Follow for more mysteries at the edge of science.', visual: 'forest' },
        ],
      },
      'Strange Phenomena': {
        title: 'Events That Science Cannot Explain No Matter How Hard It Tries',
        scenes: [
          { narration: 'The Hessdalen lights are mysterious luminous phenomena that appear above the Hessdalen valley in Norway. They have been observed regularly since nineteen eighty one. Scientists set up monitoring stations. The lights still defy explanation.', visual: 'mystery' },
          { narration: 'Stonehenge took an estimated twenty million hours of labor to build. It is aligned with the winter solstice sunrise with perfect precision. Some of the stones were transported from Wales, two hundred and forty kilometers away. No one knows exactly how or why.', visual: 'ancient' },
          { narration: 'The Danakil Depression in Ethiopia is one of the hottest places on earth with pools of acid and molten sulfur. Yet extremophile bacteria thrive there. Life exists in conditions that should be impossible. This discovery changed our understanding of where life can exist.', visual: 'nature' },
          { narration: 'Ball lightning is a phenomenon where luminous spheres appear during thunderstorms. Reports date back centuries. Scientists have captured it on video. No one can explain what it is, how it forms, or why it behaves the way it does.', visual: 'fog' },
          { narration: 'The universe operates on principles we have barely begun to understand. Dark matter. Dark energy. Quantum entanglement. We are surrounded by mysteries that challenge the very foundations of physics.', visual: 'space' },
          { narration: 'Never stop wondering. The greatest discoveries are still ahead of us. Follow for more mind bending phenomena.', visual: 'forest' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Every culture on Earth has legends of beings that came from the sky, taught humanity, and promised to return. Coincidence, or is there a pattern we have been ignoring for thousands of years?', visual: 'mystery' },
      { narration: 'Governments classify documents for legitimate national security reasons. But some files remain classified for over seventy years. If there is nothing to hide, why keep secrets for longer than a human lifetime?', visual: 'dark' },
      { narration: 'In nineteen seventy seven, a mysterious radio signal was detected from the direction of the constellation Sagittarius. It lasted the full seventy two seconds that a signal from deep space would take. It has never been detected again. Astronomers call it the Wow signal.', visual: 'night' },
      { narration: 'Ancient structures around the world are built with stone blocks so precisely cut that we cannot replicate the technique today with modern tools. How did primitive civilizations achieve precision that challenges our best technology?', visual: 'ancient' },
      { narration: 'The deeper you look into these mysteries, the more questions emerge. What we think we know is a tiny fraction of what there is to understand.', visual: 'fog' },
      { narration: 'The truth is out there. Subscribe to explore the mysteries that keep scientists awake at night.', visual: 'forest' },
    ],
    tags: ['mystery', 'unsolved', 'conspiracy', 'paranormal', 'strange', 'scary', 'truth'],
    hashtags: ['#mystery', '#unsolved', '#conspiracy', '#paranormal', '#scary', '#truth'],
  },
  nature: {
    gradientTop: '0x10b981', gradientBot: '0x022c22',
    topics: ['Deep Ocean', 'Animal Intelligence', 'Rainforest Secrets', 'Evolution Marvels', 'Extreme Survivors', 'Migration Mysteries', 'Symbiotic Wonders', 'Predator vs Prey'],
    searchQueries: ['nature', 'ocean', 'forest', 'animals', 'wildlife', 'underwater', 'jungle', 'mountain'],
    topicContent: {
      'Deep Ocean': {
        title: 'The Deep Ocean Hides Things We Cannot Even Imagine',
        scenes: [
          { narration: 'We have explored less than five percent of the ocean floor. That means ninety five percent of our own planet is still a mystery. The deep ocean is more alien to us than the surface of Mars.', visual: 'ocean' },
          { narration: 'At the bottom of the Mariana Trench, the pressure is over one thousand times atmospheric pressure at sea level. Yet life thrives there. Anglerfish carry their own lanterns. Shrimp see in infrared. Bacteria eat rocks.', visual: 'underwater' },
          { narration: 'The giant squid was only filmed alive for the first time in two thousand and four. A creature that can grow up to thirteen meters long, and we had never seen one alive. That tells you how little we know about the deep.', visual: 'nature' },
          { narration: 'Hydrothermal vents on the ocean floor support entire ecosystems that have never seen sunlight. They run on chemical energy instead of photosynthesis. This discovery changed our understanding of where life can exist in the universe.', visual: 'underwater' },
          { narration: 'The deep ocean generates half the oxygen we breathe. Phytoplankton in the ocean produce more oxygen than all the forests on land combined. The ocean is literally keeping us alive.', visual: 'ocean' },
          { narration: 'There is more wealth in the minerals on the ocean floor than in all the gold ever mined on land. The race to mine the deep sea is already beginning.', visual: 'nature' },
        ],
      },
      'Animal Intelligence': {
        title: 'Animals Are Smarter Than Science Ever Expected',
        scenes: [
          { narration: 'Octopuses can solve mazes, use tools, and escape from sealed jars. They have nine brains, one central and one in each arm. Each arm can taste, touch, and make decisions independently.', visual: 'nature' },
          { narration: 'Dolphins have names for each other. They use unique whistles to identify specific individuals. When separated, they call out the name of the friend they are looking for. This is not instinct. This is language.', visual: 'underwater' },
          { narration: 'Crows can remember human faces for years and will hold grudges. In one experiment, crows that had been trapped by a specific researcher in a mask would scold that researcher even five years later, in a completely different location.', visual: 'forest' },
          { narration: 'Elephants mourn their dead. They visit the bones of deceased family members, touching them gently with their trunks. They have been observed standing silently over dead companions for hours.', visual: 'wildlife' },
          { narration: 'Honeybees communicate through dance. The waggle dance tells other bees the direction, distance, and quality of a food source. It is one of the most sophisticated non-human communication systems ever discovered.', visual: 'nature' },
          { narration: 'The animal kingdom is full of intelligence we are only beginning to understand. Every species has evolved solutions to problems that would baffle most engineers.', visual: 'jungle' },
        ],
      },
      'Rainforest Secrets': {
        title: 'Rainforests Are Living Libraries And We Are Burning Them',
        scenes: [
          { narration: 'Rainforests cover only six percent of the earth surface but contain over half of all species on the planet. A single hectare of rainforest can contain over four hundred species of trees. That is more than in all of North America.', visual: 'forest' },
          { narration: 'The Amazon rainforest produces twenty percent of the world oxygen. It generates its own weather system, creating rivers of air that carry moisture across continents. Without it, global agriculture would collapse.', visual: 'jungle' },
          { narration: 'Indigenous peoples have developed over three thousand uses for rainforest plants. Aspirin, quinine, and hundreds of modern medicines originated from rainforest species. We have barely scratched the surface of what these forests contain.', visual: 'nature' },
          { narration: 'A single rainforest tree can support over five thousand different species of insects, birds, mammals, and plants. It is an entire ecosystem in one organism. When we cut one tree, we lose thousands of species we never even discovered.', visual: 'forest' },
          { narration: 'Some rainforest plants have evolved defenses so elaborate that scientists are still trying to understand them. Ant plants provide housing for ants in exchange for protection. It is nature at its most creative.', visual: 'jungle' },
          { narration: 'Every acre of rainforest lost is a library burned. The solutions to diseases, materials science, and agriculture might be in the species we are destroying before we ever meet them.', visual: 'nature' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Nature has had four billion years to solve engineering problems. Every living thing you see is the result of billions of experiments in survival. We have a lot to learn.', visual: 'nature' },
      { narration: 'The natural world operates on principles that human technology is only beginning to understand. Spider silk is stronger than steel by weight. Gecko feet defy gravity. Tardigrades survive in space.', visual: 'wildlife' },
      { narration: 'Every species on earth is connected in ways we are only beginning to map. Remove one bee, one coral, one fungus, and entire ecosystems can collapse. The web of life is more fragile than it appears.', visual: 'forest' },
      { narration: 'The most incredible discoveries in nature are not in distant jungles or deep oceans. They are in your backyard. A single square meter of soil contains more organisms than there are people on earth.', visual: 'nature' },
      { narration: 'Understanding nature is not just about conservation. It is about survival. The answers to our biggest challenges, energy, food, medicine, are in the natural world.', visual: 'jungle' },
      { narration: 'The more we learn about nature, the more we realize how much we do not know. Stay curious.', visual: 'wildlife' },
    ],
    tags: ['nature', 'animals', 'wildlife', 'ocean', 'forest', 'biology', 'ecology'],
    hashtags: ['#nature', '#animals', '#wildlife', '#ocean', '#forest', '#biology'],
  },
  space: {
    gradientTop: '0x8b5cf6', gradientBot: '0x0c0a2e',
    topics: ['Black Holes', 'Mars Colonization', 'Alien Life', 'Dark Matter', 'Solar System', 'Exoplanets', 'Big Bang', 'Asteroid Mining'],
    searchQueries: ['space', 'universe', 'planet', 'galaxy', 'stars', 'astronomy', 'nebula', 'cosmos'],
    topicContent: {
      'Black Holes': {
        title: 'Black Holes Are Not What You Think They Are',
        scenes: [
          { narration: 'A black hole is not a hole at all. It is an enormous amount of matter crushed into the smallest possible space. A teaspoon of black hole material would weigh six billion tons on earth.', visual: 'space' },
          { narration: 'At the center of our galaxy, twenty six thousand light years away, sits Sagittarius A. A supermassive black hole four million times the mass of our sun. It is pulling our entire galaxy toward it at two hundred kilometers per second.', visual: 'cosmos' },
          { narration: 'When you fall into a black hole, time itself changes. Due to gravitational time dilation, an observer watching you fall would see you slow down and eventually freeze at the event horizon, fading to red. You, however, would pass through in seconds.', visual: 'universe' },
          { narration: 'Stephen Hawking discovered that black holes are not completely black. They emit faint radiation and slowly evaporate over trillions of years. This means that even black holes die eventually.', visual: 'stars' },
          { narration: 'The information paradox is one of the deepest problems in physics. When something falls into a black hole, where does the information go? If it is destroyed, it violates the fundamental laws of quantum mechanics. If it is preserved, we do not know how.', visual: 'space' },
          { narration: 'Black holes are the most extreme environments in the universe. They push our understanding of physics to its absolute limits.', visual: 'cosmos' },
        ],
      },
      'Mars Colonization': {
        title: 'Living On Mars Is Harder Than Anyone Admits',
        scenes: [
          { narration: 'Mars has no magnetic field. That means the surface is bombarded with cosmic radiation that would kill an unshielded human in weeks. Any Mars colony needs radiation shielding that does not yet exist at scale.', visual: 'planet' },
          { narration: 'The Martian atmosphere is ninety five percent carbon dioxide with almost no oxygen. The average temperature is minus sixty degrees celsius. At night it can drop to minus one hundred and twenty. Every structure must be heated and pressurized.', visual: 'space' },
          { narration: 'Mars gravity is only thirty eight percent of earth. Astronauts on the International Space Station lose bone density in microgravity. Living in low gravity for years could cause permanent skeletal and cardiovascular damage.', visual: 'cosmos' },
          { narration: 'A round trip communication signal to Mars takes between four and twenty four minutes depending on the relative positions of the planets. Real time conversation is impossible. Colonists will have to make decisions completely autonomously.', visual: 'universe' },
          { narration: 'Growing food on Mars is essential. Martian soil contains perchlorates, toxic chemicals that would need to be removed before any agriculture is possible. Water exists as ice, but must be melted and purified.', visual: 'planet' },
          { narration: 'Despite the challenges, humanity is making progress. SpaceX, NASA, and other agencies are working on the technologies needed. Mars colonization will happen. The question is when.', visual: 'space' },
        ],
      },
      'Alien Life': {
        title: 'The Evidence For Alien Life Is Stronger Than You Think',
        scenes: [
          { narration: 'There are four hundred billion stars in our galaxy alone. If even one in a million has a planet with conditions suitable for life, that is four hundred thousand worlds. The mathematics alone make alien life almost certain.', visual: 'stars' },
          { narration: 'We have discovered over five thousand exoplanets. Some in the habitable zone, where liquid water could exist. Kepler 442b is twelve hundred light years away and receives seventy percent of the light earth gets. It could have oceans.', visual: 'space' },
          { narration: 'In twenty twenty, scientists discovered phosphine in the atmosphere of Venus. On earth, phosphine is only produced by life or industrial processes. Venus has no industry. The implication is tantalizing.', visual: 'planet' },
          { narration: 'Organic molecules have been found on Mars, in meteorites from asteroids, and in the clouds of Jupiter. The building blocks of life are everywhere we look. Life did not stay on earth. It spread.', visual: 'cosmos' },
          { narration: 'The Drake Equation estimates that there should be at least ten thousand active civilizations in the Milky Way alone. Even with conservative estimates, we are not alone. The universe is too vast and too old.', visual: 'universe' },
          { narration: 'We may have already detected alien technology. Some scientists argue that certain unexplained astronomical signals could be artifacts of advanced civilizations. We just do not know enough to tell the difference yet.', visual: 'stars' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'The observable universe is ninety three billion light years across. It contains two trillion galaxies, each with hundreds of billions of stars. The scale is beyond human comprehension.', visual: 'space' },
      { narration: 'Light from the most distant objects we can see has been traveling for over thirteen billion years. We are literally looking back in time. The universe is a time machine.', visual: 'cosmos' },
      { narration: 'Every atom in your body was once inside a star. The carbon in your muscles, the iron in your blood, the calcium in your bones, all forged in the hearts of dying stars billions of years ago.', visual: 'stars' },
      { narration: 'Space is not empty. It is filled with dark matter and dark energy that together make up ninety five percent of the universe. Everything we can see, every star, every planet, is just five percent.', visual: 'universe' },
      { narration: 'The universe began as a point smaller than an atom and expanded to its current size in thirteen point eight billion years. It is still expanding, and the expansion is accelerating.', visual: 'space' },
      { narration: 'We are a way for the cosmos to know itself. Keep looking up.', visual: 'cosmos' },
    ],
    tags: ['space', 'astronomy', 'universe', 'planets', 'cosmos', 'science', 'stars'],
    hashtags: ['#space', '#astronomy', '#universe', '#cosmos', '#science', '#stars'],
  },
  history: {
    gradientTop: '0xd97706', gradientBot: '0x1a0800',
    topics: ['Ancient Egypt', 'Roman Empire', 'World War', 'Industrial Revolution', 'Silk Road', 'Viking Age', 'Renaissance', 'Moon Landing'],
    searchQueries: ['history', 'ancient', 'castle', 'ruins', 'monument', 'museum', 'war', 'civilization'],
    topicContent: {
      'Ancient Egypt': {
        title: 'Ancient Egypt Was Far More Advanced Than We Realize',
        scenes: [
          { narration: 'The Great Pyramid of Giza was built four thousand five hundred years ago with such precision that modern engineers cannot replicate it. The base is level to within two centimeters across two hundred and thirty meters. That is better than most modern buildings.', visual: 'ancient' },
          { narration: 'Egyptians developed a three hundred and sixty five day calendar over four thousand years ago. They understood the movement of stars, predicted the flooding of the Nile, and used astronomy to align their temples with celestial events.', visual: 'monument' },
          { narration: 'The Ebers Papyrus, written in fifteen fifty BC, contains over seven hundred remedies and prescriptions for diseases. It describes surgical procedures, dentistry, and even psychological treatments. Medicine in ancient Egypt was more advanced than medieval Europe.', visual: 'history' },
          { narration: 'Egyptians invented the ramp, the lever, and the pulley. They used these simple machines to move stones weighing up to eighty tons. Their construction techniques were so effective that we still use modified versions today.', visual: 'ruins' },
          { narration: 'The Rosetta Stone, discovered in seventeen ninety nine, unlocked the ability to read hieroglyphics. It revealed that ancient Egypt had a written history spanning over three thousand years. We had been sitting on a library without knowing how to read it.', visual: 'ancient' },
          { narration: 'Ancient Egypt was not just pyramids and pharaohs. It was one of the most sophisticated civilizations in human history, and we are still discovering its secrets.', visual: 'monument' },
        ],
      },
      'Silk Road': {
        title: 'The Silk Road Connected The World And Changed Everything',
        scenes: [
          { narration: 'The Silk Road was not one road. It was a network of trade routes spanning over sixty four hundred kilometers, connecting China to Rome. For two thousand years, it was the internet of the ancient world.', visual: 'ancient' },
          { narration: 'More than just silk traveled these routes. Paper, gunpowder, the compass, printing technology, all moved westward along the Silk Road. These Chinese inventions reshaped European civilization and eventually the entire world.', visual: 'history' },
          { narration: 'The Silk Road also carried diseases. The Black Death, which killed one third of Europe population in the fourteenth century, traveled along trade routes from Asia to Europe. Globalization has always had a dark side.', visual: 'ruins' },
          { narration: 'Merchant communities along the Silk Road were remarkably diverse. Buddhist monks, Muslim traders, Christian missionaries, and Jewish merchants all lived and worked together in oasis cities like Samarkand and Bukhara.', visual: 'monument' },
          { narration: 'The Silk Road was the first example of global trade. It proved that connecting cultures creates wealth, innovation, and cultural exchange on a scale that isolated civilizations could never achieve.', visual: 'ancient' },
          { narration: 'Today, new trade routes are being built to reconnect the world. The lessons of the Silk Road are more relevant than ever.', visual: 'history' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'History is not just about the past. It is a pattern book for the present. Every major event in human history has parallels we can learn from if we pay attention.', visual: 'history' },
      { narration: 'The most important inventions in human history were often accidents. Penicillin, the microwave oven, vulcanized rubber, Post it Notes. Discovery rewards those who pay attention to the unexpected.', visual: 'ancient' },
      { narration: 'Civilizations rise and fall in predictable cycles. They grow when they are open to new ideas and trade. They collapse when they become rigid, unequal, or overextend. Every empire believes it is the exception. None are.', visual: 'monument' },
      { narration: 'The average person today has access to more information than the wealthiest king in history. We carry devices in our pockets that contain the accumulated knowledge of humanity. The question is whether we use that advantage.', visual: 'ruins' },
      { narration: 'Understanding history gives us perspective. The challenges we face today are not new. Humans have survived plagues, wars, famines, and collapses before. We will survive this too.', visual: 'history' },
      { narration: 'Those who do not learn from history are doomed to repeat it. But those who do learn from it gain an almost unfair advantage.', visual: 'ancient' },
    ],
    tags: ['history', 'ancient', 'civilization', 'archaeology', 'empires', 'culture'],
    hashtags: ['#history', '#ancient', '#civilization', '#archaeology', '#culture'],
  },
  psychology: {
    gradientTop: '0x06b6d4', gradientBot: '0x082f38',
    topics: ['Brain Tricks', 'Memory Secrets', 'Habits Science', 'Emotional Intelligence', 'Cognitive Biases', 'Sleep Science', 'Stress Response', 'Social Psychology'],
    searchQueries: ['brain', 'psychology', 'mind', 'think', 'study', 'research', 'mental', 'experiment'],
    topicContent: {
      'Brain Tricks': {
        title: 'Your Brain Lies To You Every Single Day',
        scenes: [
          { narration: 'Your brain fills in gaps in your vision so seamlessly that you do not notice your blind spot exists. Right now, there is a hole in your visual field where your optic nerve connects to your retina. Your brain paints over it with guesswork.', visual: 'brain' },
          { narration: 'The change blindness effect means you can miss enormous changes happening right in front of you if your attention is directed elsewhere. In experiments, people fail to notice when someone they are talking to is swapped for a completely different person.', visual: 'experiment' },
          { narration: 'Your brain uses about twenty percent of your body total energy despite being only two percent of your weight. It is the most energy hungry organ you have. That is why you feel mentally exhausted after intense thinking.', visual: 'research' },
          { narration: 'The anchoring effect means the first number you hear in any negotiation disproportionately influences your decision. If a house is listed at one million, you will evaluate it differently than if it was listed at five hundred thousand. Same house. Different anchor.', visual: 'data' },
          { narration: 'Your brain cannot tell the difference between a vividly imagined experience and a real one. Athletes who mentally rehearse their performance show measurable muscle improvements without physically training. Visualization is not just motivation. It is neurological training.', visual: 'mind' },
          { narration: 'Understanding how your brain deceives you is the first step to thinking more clearly. The brain is an incredible organ. But it was designed for survival, not accuracy.', visual: 'brain' },
        ],
      },
      'Memory Secrets': {
        title: 'Your Memory Is Not What You Think It Is',
        scenes: [
          { narration: 'Every time you recall a memory, you are not playing it back like a video. You are reconstructing it from fragments, filling in gaps with your current emotions and beliefs. The memory changes every time you access it.', visual: 'brain' },
          { narration: 'The method of loci, also known as the memory palace technique, has been used by memory champions for over two thousand years. They mentally place items in familiar locations and walk through them to recall thousands of items in perfect order.', visual: 'study' },
          { narration: 'Sleep is when your brain decides what to keep and what to discard. During deep sleep, your hippocampus replays the day events and transfers important memories to long term storage. Pulling an all nighter literally erases the day learning.', visual: 'mental' },
          { narration: 'Emotional memories are stored more vividly because the amygdala tags them as important. That is why you remember where you were during dramatic events but forget what you had for lunch last Tuesday. Your brain prioritizes survival relevant information.', visual: 'brain' },
          { narration: 'Spacing out your study sessions is far more effective than cramming. Your brain needs time between sessions to consolidate memories. Studying for one hour on three different days produces better retention than studying for three hours in one day.', visual: 'research' },
          { narration: 'Your memory is not a recording. It is a storytelling machine. Understanding this changes how you learn, how you teach, and how you make decisions.', visual: 'experiment' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'The human brain makes about thirty five thousand decisions every day. Most of them happen below conscious awareness. You are not making as many choices as you think.', visual: 'brain' },
      { narration: 'Cognitive biases are systematic errors in thinking that affect every human being. They evolved as mental shortcuts to help us make fast decisions. In the modern world, they often lead us astray.', visual: 'mind' },
      { narration: 'Social proof is one of the most powerful psychological forces. When you see a long line outside a restaurant, you assume the food must be good. Your brain uses the behavior of others as a shortcut for making decisions.', visual: 'experiment' },
      { narration: 'Dopamine is not the pleasure chemical. It is the anticipation chemical. It spikes when you expect a reward, not when you receive one. That is why checking your phone is so addictive. The anticipation of a notification is more rewarding than the notification itself.', visual: 'brain' },
      { narration: 'Your environment shapes your behavior far more than your willpower does. People who want to eat healthier keep junk food out of the house entirely. They do not rely on self control. They design their environment for success.', visual: 'study' },
      { narration: 'Understanding psychology is understanding yourself. The better you know your own mind, the better decisions you make.', visual: 'mental' },
    ],
    tags: ['psychology', 'brain', 'mind', 'behavior', 'science', 'memory', 'cognition'],
    hashtags: ['#psychology', '#brain', '#mind', '#behavior', '#science', '#memory'],
  },
  food: {
    gradientTop: '0xf43f5e', gradientBot: '0x1c0a10',
    topics: ['World Cuisines', 'Superfoods', 'Food History', 'Cooking Science', 'Street Food', 'Fermentation', 'Spice Trade', 'Coffee Culture'],
    searchQueries: ['food', 'cooking', 'restaurant', 'chef', 'kitchen', 'ingredients', 'spices', 'meal'],
    topicContent: {
      'World Cuisines': {
        title: 'Every Cuisine On Earth Tells A Story About Survival',
        scenes: [
          { narration: 'Sushi was originally a preservation method. Fish was packed in fermented rice to keep it edible for months. The rice was thrown away. It was not until the eighteen hundreds that someone in Tokyo decided to eat the rice too. Modern sushi was born from waste reduction.', visual: 'food' },
          { narration: 'Italian cuisine as we know it did not exist before the tomato arrived from the Americas in the sixteenth century. For centuries, Italian food was just bread, olive oil, and herbs. The tomato changed everything.', visual: 'kitchen' },
          { narration: 'Kimchi, the Korean fermented vegetable dish, has been made for over two thousand years. Before refrigeration, fermentation was one of the only ways to preserve vegetables through harsh winters. Kimchi is survival in a jar.', visual: 'ingredients' },
          { narration: 'Indian curry powder is not one spice blend. Every family has their own recipe with different proportions of turmeric, cumin, coriander, and dozens of other spices. The blend tells you where the cook is from, what they can afford, and what they grew up eating.', visual: 'spices' },
          { narration: 'Mexican cuisine was declared an Intangible Cultural Heritage by UNESCO. It represents over nine thousand years of agricultural knowledge, from the domestication of corn to the invention of nixtamalization, a process that makes nutrients bioavailable.', visual: 'chef' },
          { narration: 'Every dish you eat is a lesson in history, geography, and human ingenuity. Food is not just fuel. It is culture, encoded in flavor.', visual: 'food' },
        ],
      },
      'Fermentation': {
        title: 'Fermentation Is The Oldest Technology On Earth',
        scenes: [
          { narration: 'Fermentation predates written history. Humans have been making beer for at least thirteen thousand years. Before bread, before cheese, before wine, there was fermentation. It may be the invention that made civilization possible.', visual: 'food' },
          { narration: 'Your gut contains thirty nine trillion bacteria. More than the total number of human cells in your body. The food you eat determines which bacteria thrive, and those bacteria influence your mood, your immune system, and even your weight.', visual: 'kitchen' },
          { narration: 'Kefir, miso, sauerkraut, yogurt, sourdough, all are fermented. Each one uses different microorganisms to transform simple ingredients into complex flavors and preserved foods. Fermentation is chemistry in a jar.', visual: 'ingredients' },
          { narration: 'Fermented foods contain probiotics, live bacteria that benefit your digestive system. Studies show that regular consumption of fermented foods can reduce inflammation, improve mental health, and boost immunity.', visual: 'chef' },
          { narration: 'The fermentation process creates vitamins, breaks down anti nutrients, and produces beneficial compounds that are not present in the original food. It literally transforms food into something more nutritious.', visual: 'spices' },
          { narration: 'Fermentation teaches us that sometimes the best results come from letting nature do the work. Patience, not technology, is the secret ingredient.', visual: 'food' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Food is the universal language. Every culture on earth shares three meals a day, yet the ways we prepare and eat them are endlessly diverse. Food connects us all.', visual: 'food' },
      { narration: 'The average person eats about seventy thousand meals in a lifetime. Each one is a chance to nourish your body, explore new flavors, and connect with the people around you.', visual: 'kitchen' },
      { narration: 'The best ingredients are usually the simplest. A ripe tomato, fresh basil, good olive oil, a pinch of salt. Mastering simplicity is harder than mastering complexity.', visual: 'ingredients' },
      { narration: 'Cooking is the original technology. It predates agriculture, writing, and metalworking. Fire and food transformed us from animals that eat to humans who dine.', visual: 'chef' },
      { narration: 'Every food tradition represents centuries of experimentation. Grandmothers were the original food scientists, perfecting recipes through trial and error across generations.', visual: 'spices' },
      { narration: 'The best meal is the one shared with people you care about. Everything else is just ingredients.', visual: 'food' },
    ],
    tags: ['food', 'cooking', 'cuisine', 'kitchen', 'chef', 'ingredients', 'culture'],
    hashtags: ['#food', '#cooking', '#cuisine', '#kitchen', '#chef', '#culture'],
  },
  geography: {
    gradientTop: '0x22c55e', gradientBot: '0x052e16',
    topics: ['Extreme Places', 'Island Nations', 'Border Stories', 'Ancient Cities', 'Climate Zones', 'Mountain Peoples', 'River Civilizations', 'Isolated Communities'],
    searchQueries: ['city', 'landscape', 'mountain', 'ocean', 'island', 'river', 'desert', 'country'],
    topicContent: {
      'Extreme Places': {
        title: 'People Live In Places That Should Be Impossible',
        scenes: [
          { narration: 'The city of La Rinconada in Peru sits at five thousand one hundred meters above sea level. It is the highest permanent settlement on earth. The air contains fifty percent less oxygen than at sea level. Residents live there because of a gold mine.', visual: 'mountain' },
          { narration: 'Oymyakon, Russia, is the coldest permanently inhabited place on earth. Temperatures have dropped to minus sixty seven point seven degrees celsius. Schools close only when it drops below minus fifty two. Children play outside in temperatures that would kill an unprotected person in minutes.', visual: 'landscape' },
          { narration: 'Dallol, Ethiopia, is the hottest inhabited place on earth with average temperatures of thirty four point four degrees celsius year round. The landscape is so alien that NASA studies it to understand what other planets might look like.', visual: 'desert' },
          { narration: 'The Maldives is the flattest country on earth, with an average elevation of just one point five meters above sea level. Rising sea levels could make it the first nation to be completely submerged by the ocean.', visual: 'island' },
          { narration: 'Bolivia Road, the North Yungas Road, was called the world most dangerous road. Every year, hundreds of vehicles fell off the edge. It has since been replaced by a safer alternative, but the old road still exists as a reminder of extreme engineering.', visual: 'mountain' },
          { narration: 'Humans are remarkably adaptable. We live in deserts, in arctic conditions, at extreme altitudes, and on tiny islands. Where there is will, there is a way.', visual: 'landscape' },
        ],
      },
      'Island Nations': {
        title: 'Island Nations Face Challenges Most People Never Consider',
        scenes: [
          { narration: 'Tuvalu, a Pacific island nation of eleven thousand people, is one of the smallest countries on earth. It consists of nine coral islands with a combined land area of just twenty six square kilometers. The entire country is smaller than most airports.', visual: 'island' },
          { narration: 'Iceland has no army, navy, or air force. It relies on its geographic isolation and NATO membership for defense. With a population smaller than most cities, it has one of the lowest crime rates in the world.', visual: 'landscape' },
          { narration: 'Singapore is a city state that transformed from a sleepy fishing village to one of the wealthiest nations on earth in just sixty years. It has no natural resources, no military depth, and limited land. It succeeded through strategy alone.', visual: 'city' },
          { narration: 'Madagascar split from India about eighty eight million years ago. Its long isolation allowed unique species to evolve. Over ninety percent of its wildlife is found nowhere else on earth. It is a living laboratory of evolution.', visual: 'mountain' },
          { narration: 'Bahrain is an island nation that has run out of fresh groundwater. It now relies entirely on desalination plants that convert seawater to drinking water. This technology is energy intensive but increasingly necessary as freshwater becomes scarce worldwide.', visual: 'ocean' },
          { narration: 'Island nations prove that constraints breed creativity. When you have limited resources, you must innovate or perish.', visual: 'island' },
        ],
      },
    },
    defaultScenes: [
      { narration: 'Earth is four point five billion years old. In that time, continents have collided, oceans have opened and closed, and ice ages have come and gone. The landscape beneath your feet is in constant motion.', visual: 'landscape' },
      { narration: 'The Amazon River carries more water than the next seven largest rivers combined. It discharges so much fresh water into the Atlantic that the ocean is less salty for two hundred miles offshore.', visual: 'river' },
      { narration: 'Mount Everest grows about four millimeters every year due to tectonic forces. In a hundred thousand years, it will be nearly four hundred meters taller. The earth is still building itself.', visual: 'mountain' },
      { narration: 'Seventy one percent of the earth surface is covered by water. Yet we have better maps of Mars than we do of the ocean floor. We know more about space than we know about our own planet.', visual: 'ocean' },
      { narration: 'The earth tilts on its axis at twenty three point five degrees. This single fact creates seasons, drives weather patterns, and determines where humans can comfortably live. A few degrees more or less would make the planet uninhabitable.', visual: 'landscape' },
      { narration: 'Our planet is extraordinary. The more you learn about geography, the more you appreciate the remarkable world we live on.', visual: 'mountain' },
    ],
    tags: ['geography', 'countries', 'culture', 'travel', 'world', 'places', 'landscape'],
    hashtags: ['#geography', '#countries', '#culture', '#travel', '#world', '#places'],
  },
};

function generateSEOContent(niche, topic, duration) {
  const nd = NICHES[niche] || NICHES.technology;
  const title = topic || nd.topics[Math.floor(Math.random() * nd.topics.length)];
  const topicData = nd.topicContent && nd.topicContent[title];

  let scenes;
  let videoTitle;
  if (topicData) {
    videoTitle = topicData.title;
    const wordCount = topicData.scenes.reduce((sum, s) => sum + s.narration.split(' ').length, 0);
    const secPerWord = 0.35;
    const totalAudioEst = wordCount * secPerWord;
    const perScene = Math.ceil(totalAudioEst / topicData.scenes.length);
    scenes = topicData.scenes.map((s, i) => ({ ...s, duration: perScene, start: i * perScene }));
  } else {
    videoTitle = title + ' Explained In 60 Seconds';
    const src = nd.defaultScenes || [];
    scenes = src.map((s, i) => ({ ...s, duration: 12, start: i * 12 }));
  }

  const totalDur = scenes.reduce((sum, s) => sum + s.duration, 0);

  const srt = scenes.map((s, i) => {
    const ss = s.start, se = ss + s.duration;
    return `${i+1}\n00:${String(Math.floor(ss/60)).padStart(2,'0')}:${String(ss%60).padStart(2,'0')},000 --> 00:${String(Math.floor(se/60)).padStart(2,'0')}:${String(se%60).padStart(2,'0')},000\n${s.narration}\n`;
  }).join('\n');

  return {
    title: videoTitle.substring(0, 100),
    description: `${videoTitle}\n\n${scenes.map(s => s.narration).join(' ')}\n\n# ${nd.hashtags.join(' ')}\n\nTags: ${nd.tags.join(', ')}`.substring(0, 5000),
    tags: [...nd.tags, title.toLowerCase().replace(/\s+/g, ''), 'shorts', 'viral', 'facts'],
    hashtags: nd.hashtags, scenes, srt,
    categoryId: niche === 'finance' ? '26' : '28',
  };
}

async function fetchPexelsVideo(query) {
  try {
    const res = await axios.get(`https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3`, {
      headers: { Authorization: process.env.PEXELS_API_KEY || 'XFgm8TkzMEBDdMmYPCy1SE2Nk0Hq1kdyWQHlKmZZJUjOeKWIK1Yo6vzE' }
    });
    if (!res.data.videos || !res.data.videos.length) return null;
    const v = res.data.videos[Math.floor(Math.random() * res.data.videos.length)];
    const f = v.video_files.filter(x => x.width >= 720).sort((a, b) => a.width - b.width);
    return f[0] ? f[0].link : null;
  } catch (e) { console.log('  Pexels error:', e.message); return null; }
}

async function downloadFile(url, out) {
  const res = await axios.get(url, { responseType: 'stream', timeout: 30000 });
  const w = fs.createWriteStream(out);
  res.data.pipe(w);
  return new Promise((r, j) => { w.on('finish', r); w.on('error', j); });
}

function generateTTS(text, audioPath, vttPath) {
  const safe = text.replace(/"/g, '').replace(/'/g, '').replace(/\\/g, '');
  try {
    execSync(`python -m edge_tts --text "${safe}" --voice "en-US-GuyNeural" --rate "+15%" --write-media "${audioPath}" --write-subtitles "${vttPath}"`, { timeout: 15000, stdio: 'pipe' });
    return fs.existsSync(audioPath);
  } catch (e) { console.log('  TTS error'); return false; }
}

function parseVTT(vttPath) {
  if (!fs.existsSync(vttPath)) return [];
  const content = fs.readFileSync(vttPath, 'utf-8').replace(/\r\n/g, '\n');
  const cues = [];

  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    let timeLine = null;
    const textLines = [];
    for (const line of lines) {
      if (line.includes('-->') ) { timeLine = line; continue; }
      if (line.trim() === 'WEBVTT' || line.trim() === '') continue;
      if (/^\d+$/.test(line.trim())) continue;
      if (/^\d{2}:\d{2}:\d{2}[,.:]\d{3}/.test(line.trim())) continue;
      if (line.trim().startsWith('-->') ) continue;
      textLines.push(line.trim());
    }
    if (!timeLine || textLines.length === 0) continue;
    const parts = timeLine.split('-->');
    if (parts.length < 2) continue;
    const parseTime = (t) => {
      const p = t.trim().replace(',', '.').split(':');
      return parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
    };
    const start = parseTime(parts[0]);
    const end = parseTime(parts[1]);
    const text = textLines.join(' ').replace(/\s+/g, ' ').trim();
    if (text && !text.match(/^\d+$/) && !text.match(/^\d{2}:\d{2}/)) {
      cues.push({ start, end, text });
    }
  }
  return cues;
}

function createGradientClip(dur, nd, out, sceneIdx = 0) {
  const gT = nd.gradientTop || '0x6366f1', gB = nd.gradientBot || '0x0a0a2e';
  const patterns = [
    `gradients=c0=${gT}:c1=${gB}:s=1080x1920:d=${dur}:speed=0.015`,
    `gradients=c0=${gB}:c1=${gT}:s=1080x1920:d=${dur}:speed=0.02`,
    `gradients=c0=${gT}:c1=${gB}:s=1080x1920:d=${dur}:speed=0.01:c0x=0:c0y=ih/2:c1x=iw:c1y=ih/2`,
  ];
  const pattern = patterns[sceneIdx % patterns.length];
  const filters = [
    'scale=1080:1920', 'setsar=1',
    'eq=brightness=0.02:saturation=1.15:contrast=1.05',
    `noise=alls=8:allf=t+u`,
    `drawtext=text='•':fontsize=4:fontcolor=white@0.15:x='mod(t*90+${sceneIdx*300},w)':y='mod(t*60+${sceneIdx*200},h)'`,
    `drawtext=text='•':fontsize=3:fontcolor=white@0.1:x='mod(t*120+${sceneIdx*500},w)':y='mod(t*80+${sceneIdx*400},h)'`,
    `drawtext=text='•':fontsize=5:fontcolor=white@0.12:x='mod(t*70+${sceneIdx*100},w)':y='mod(t*100+${sceneIdx*600},h)'`,
  ];
  const vf = filters.join(',');
  try { execSync(`ffmpeg -y -f lavfi -i "${pattern}" -vf "${vf}" -c:v libx264 -preset fast -pix_fmt yuv420p -r 30 -an "${out}"`, { timeout: 20000, stdio: 'pipe' }); } catch {}
}

async function createVideoWithFFmpeg(content, outputPath) {
  const nd = NICHES[content.niche] || NICHES.technology;
  const sd = path.join(TEMP_DIR, `sc_${Date.now()}`);
  fs.mkdirSync(sd, { recursive: true });

  console.log('  [1/4] Generating voice & calculating durations...');
  const af = [];
  const sceneDurs = [];
  const allCues = [];
  let audioOffset = 0;
  for (let i = 0; i < content.scenes.length; i++) {
    const s = content.scenes[i], ap = path.join(sd, `tts_${i}.mp3`), vp = path.join(sd, `tts_${i}.vtt`);
    if (generateTTS(s.narration, ap, vp)) {
      af.push(ap);
      const cues = parseVTT(vp);
      cues.forEach(c => { allCues.push({ start: c.start + audioOffset, end: c.end + audioOffset, text: c.text }); });
      const vttContent = fs.existsSync(vp) ? fs.readFileSync(vp, 'utf-8') : '';
      const lines = vttContent.replace(/\r\n/g, '\n').split('\n');
      let lastEnd = 0;
      for (const line of lines) {
        if (line.includes('-->')) {
          const parts = line.split('-->');
          if (parts.length >= 2) {
            const p = parts[1].trim().replace(',', '.').split(':');
            const t = parseFloat(p[0]) * 3600 + parseFloat(p[1]) * 60 + parseFloat(p[2]);
            if (t > lastEnd) lastEnd = t;
          }
        }
      }
      const dur = lastEnd > 0 ? lastEnd + 0.5 : Math.min(Math.ceil(s.narration.length / 12), 15);
      sceneDurs.push(dur);
      audioOffset += dur;
      console.log(`    TTS ${i+1}: OK (${dur.toFixed(1)}s, ${cues.length} cues)`);
    } else {
      const sp = path.join(sd, `sil_${i}.mp3`);
      try {
        execSync(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${s.duration||8} -acodec libmp3lame -b:a 128k "${sp}"`, { timeout: 10000, stdio: 'pipe' });
        af.push(sp);
      } catch (e) {
        console.log(`    TTS ${i+1}: silence gen failed`);
      }
      sceneDurs.push(s.duration || 8);
      audioOffset += sceneDurs[i];
      console.log(`    TTS ${i+1}: silence (${sceneDurs[i]}s)`);
    }
  }

  console.log('  [2/4] Downloading stock footage...');
  const sv = [];
  for (let i = 0; i < content.scenes.length; i++) {
    const s = content.scenes[i], dur = sceneDurs[i];
    const q = s.visual || nd.searchQueries[i % nd.searchQueries.length];
    console.log(`    Scene ${i+1}: "${q}" (${dur.toFixed(1)}s)...`);
    const url = await fetchPexelsVideo(q);
    const raw = path.join(sd, `raw_${i}.mp4`), trim = path.join(sd, `trim_${i}.mp4`);
    if (url) {
      try {
        await downloadFile(url, raw);
        const zoomDir = i % 2 === 0 ? "zoompan=z='min(zoom+0.0015,1.08)':d='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'" : "zoompan=z='if(eq(on,1),1.08,max(zoom-0.0015,1.0))':d='1':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'";
        const vf = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,${zoomDir},fade=in:st=0:d=0.4,fade=out:st=${Math.max(0.3,dur-0.4)}:d=0.4,eq=brightness=0.03:saturation=1.1`;
        execSync(`ffmpeg -y -i "${raw}" -t ${dur} -vf "${vf}" -c:v libx264 -preset fast -pix_fmt yuv420p -r 30 -an "${trim}"`, { timeout: 30000, stdio: 'pipe' });
        sv.push(trim); console.log(`    Scene ${i+1}: OK`);
      } catch { createGradientClip(dur, nd, trim, i); sv.push(trim); console.log(`    Scene ${i+1}: gradient`); }
    } else { createGradientClip(dur, nd, trim, i); sv.push(trim); console.log(`    Scene ${i+1}: gradient`); }
  }

  console.log(`    Total scenes: ${sceneDurs.length}, total duration: ${sceneDurs.reduce((a,b)=>a+b,0).toFixed(1)}s`);

  console.log('  [3/4] Concatenating...');
  const cl = path.join(sd, 'concat.txt');
  fs.writeFileSync(cl, sv.map(v => `file '${v.replace(/\\/g, '/')}'`).join('\n'));
  const cv = path.join(sd, 'concat_v.mp4');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${cl}" -c:v libx264 -preset fast -pix_fmt yuv420p -r 30 "${cv}"`, { timeout: 120000, stdio: 'pipe' });

  const al = path.join(sd, 'audio.txt');
  fs.writeFileSync(al, af.map(a => `file '${a.replace(/\\/g, '/')}'`).join('\n'));
  const ca = path.join(sd, 'concat_a.mp3');
  execSync(`ffmpeg -y -f concat -safe 0 -i "${al}" -c:a libmp3lame -q:a 2 -ar 24000 -ac 1 "${ca}"`, { timeout: 30000, stdio: 'pipe' });

  console.log('  [3.5] Generating background music...');
  const totalDur = sceneDurs.reduce((a,b)=>a+b,0);
  const bgMusic = path.join(sd, 'bgmusic.mp3');
  const nicheFreqs = {
    technology: [220, 330, 440], science: [196, 294, 392], finance: [262, 330, 392],
    mystery: [185, 277, 370], indonesia: [220, 277, 330], nature: [196, 262, 330],
    space: [165, 247, 330], history: [220, 277, 349], psychology: [196, 247, 330],
    food: [220, 277, 330], geography: [196, 294, 392], general: [220, 330, 440],
  };
  const freqs = nicheFreqs[content.niche] || nicheFreqs.general;
  try {
    const bgCmd = `ffmpeg -y -f lavfi -i "sine=frequency=${freqs[0]}:duration=${totalDur}:sample_rate=24000" -f lavfi -i "sine=frequency=${freqs[1]}:duration=${totalDur}:sample_rate=24000" -f lavfi -i "sine=frequency=${freqs[2]}:duration=${totalDur}:sample_rate=24000" -filter_complex "[0:a]volume=0.03[a1];[1:a]volume=0.02[a2];[2:a]volume=0.015[a3];[a1][a2][a3]amix=inputs=3:duration=longest,lowpass=f=800,highpass=f=100,afade=t=in:st=0:d=2,afade=t=out:st=${Math.max(0,totalDur-2)}:d=2[out]" -map "[out]" -c:a libmp3lame -q:a 4 "${bgMusic}"`;
    execSync(bgCmd, { timeout: 30000, stdio: 'pipe' });
    console.log(`    BGM: OK (${totalDur.toFixed(1)}s)`);
  } catch(e) { console.log('    BGM: skipped'); }

  console.log('  [4/4] Composing with voice-synced subtitles...');
  const assPath = path.join(sd, 'subs.ass');

  const nicheColors = {
    technology: '00B4D8',   // cyan
    science: '7B68EE',      // purple
    finance: 'FFD700',      // gold
    mystery: 'FF6B6B',      // red
    indonesia: 'FF4444',     // bright red
    nature: '4CAF50',        // green
    space: '9C27B0',         // purple
    history: 'FF8C00',       // dark orange
    psychology: 'E91E63',    // pink
    food: 'FF5722',          // deep orange
    geography: '00BCD4',     // teal
    general: 'FFFFFF',       // white
  };
  const accentColor = nicheColors[content.niche] || 'FFFFFF';
  const accentHex = `&H00${accentColor.split('').reverse().join('')}`;

  const assLines = [
    '[Script Info]',
    'Title: AI Video',
    'ScriptType: v4.00+',
    'PlayResX: 1080',
    'PlayResY: 1920',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Montserrat,56,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,4,2,5,50,50,25,1',
    'Style: Hook,Montserrat,72,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,2,0,1,5,3,5,60,60,20,1',
    'Style: Emphasis,Montserrat,60,&H00' + accentColor.split('').reverse().join('') + ',&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,5,3,5,60,60,20,1',
    'Style: Counter,Montserrat,52,&H00AAAAAA,&H000000FF,&H00000000,&H96000000,0,0,0,0,100,100,0,0,1,3,1,5,50,50,30,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const fmtTime = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(2);
    return `${h}:${String(m).padStart(2,'0')}:${sec.padStart(5,'0')}`;
  };

  allCues.forEach((cue, idx) => {
    let text = cue.text
      .replace(/\\/g, '\\\\')
      .replace(/\{/g, '\\{')
      .replace(/\}/g, '\\}')
      .replace(/\n/g, '\\N');
    const duration = cue.end - cue.start;
    const isHook = idx === 0;

    if (isHook) {
      const styled = `{\\fad(300,200)\\an5\\pos(540,1600)\\fs72\\b1\\c&HFFFFFF&\\3c&H000000&\\4c&H960000&\\bord5\\shad3}${text}`;
      assLines.push(`Dialogue: 0,${fmtTime(cue.start)},${fmtTime(cue.end)},Hook,,0,0,0,,${styled}`);
      return;
    }

    if (duration < 2.5) {
      const styled = `{\\fad(150,100)\\an5\\pos(540,1600)\\fs52\\b1\\c&HFFFFFF&\\3c&H000000&\\bord4\\shad2}${text}`;
      assLines.push(`Dialogue: 0,${fmtTime(cue.start)},${fmtTime(cue.end)},Default,,0,0,0,,${styled}`);
      return;
    }

    const words = text.split(' ');
    const wordsPerSec = words.length / duration;

    if (words.length <= 6) {
      const wordsPerChunk = words.length;
      const chunkDuration = duration / 1;
      const displayText = words.join(' ');
      const emphasisIdx = idx % 4;
      const styleName = emphasisIdx === 0 ? 'Emphasis' : 'Default';
      const styleColor = emphasisIdx === 0 ? `c&H${accentColor.split('').reverse().join('')}&` : 'c&HFFFFFF&';
      const styled = `{\\fad(200,150)\\an5\\pos(540,1600)\\fs56\\b1\\${styleColor}\\3c&H000000&\\bord4\\shad2}${displayText}`;
      assLines.push(`Dialogue: 0,${fmtTime(cue.start)},${fmtTime(cue.end)},${styleName},,0,0,0,,${styled}`);
    } else {
      const chunkSize = Math.max(3, Math.min(6, Math.ceil(wordsPerSec * 2)));
      const chunks = [];
      for (let w = 0; w < words.length; w += chunkSize) {
        chunks.push(words.slice(w, w + chunkSize));
      }
      const chunkDur = duration / chunks.length;

      chunks.forEach((chunkWords, ci) => {
        const chunkStart = cue.start + ci * chunkDur;
        const chunkEnd = Math.min(chunkStart + chunkDur + 0.1, cue.end);
        const displayText = chunkWords.join(' ');
        const emphasisIdx = (idx + ci) % 4;
        const styleName = emphasisIdx === 0 ? 'Emphasis' : 'Default';
        const styleColor = emphasisIdx === 0 ? `c&H${accentColor.split('').reverse().join('')}&` : 'c&HFFFFFF&';
        const yOff = ci % 2 === 0 ? 1600 : 1650;
        const fade = `{\\fad(180,120)`;
        const styled = `${fade}\\an5\\pos(540,${yOff})\\fs56\\b1\\${styleColor}\\3c&H000000&\\bord4\\shad2}${displayText}`;
        assLines.push(`Dialogue: 0,${fmtTime(chunkStart)},${fmtTime(chunkEnd)},${styleName},,0,0,0,,${styled}`);
      });
    }
  });

  fs.writeFileSync(assPath, assLines.join('\n'));
  const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
  const fontDir = path.join(__dirname, 'assets').replace(/\\/g, '/').replace(/:/g, '\\:');
  const hasBGM = fs.existsSync(bgMusic);
  try {
    if (hasBGM) {
      execSync(`ffmpeg -y -i "${cv}" -i "${ca}" -i "${bgMusic}" -filter_complex "[0:v]ass='${assEsc}':fontsdir='${fontDir}'[v];[1:a]volume=1.0[voice];[2:a]volume=0.4[bg];[voice][bg]amix=inputs=2:duration=shortest[aout]" -map "[v]" -map "[aout]" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`, { timeout: 300000, stdio: 'pipe' });
    } else {
      execSync(`ffmpeg -y -i "${cv}" -i "${ca}" -filter_complex "[0:v]ass='${assEsc}':fontsdir='${fontDir}'[out]" -map "[out]" -map "1:a" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`, { timeout: 300000, stdio: 'pipe' });
    }
  } catch (e) {
    console.log('  ASS burn failed, trying without subs...');
    try {
      if (hasBGM) {
        execSync(`ffmpeg -y -i "${cv}" -i "${ca}" -i "${bgMusic}" -filter_complex "[1:a]volume=1.0[voice];[2:a]volume=0.4[bg];[voice][bg]amix=inputs=2:duration=shortest[aout]" -map 0:v -map "[aout]" -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`, { timeout: 300000, stdio: 'pipe' });
      } else {
        execSync(`ffmpeg -y -i "${cv}" -i "${ca}" -map 0:v -map 1:a -c:v libx264 -preset fast -crf 23 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -movflags +faststart "${outputPath}"`, { timeout: 300000, stdio: 'pipe' });
      }
    } catch (e2) {
      console.log('  Final compose also failed:', e2.message.substring(0, 100));
    }
  }

  fs.rmSync(sd, { recursive: true, force: true });
  return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
}

function createThumbnail(content, outputPath) {
  const nd = NICHES[content.niche] || NICHES.technology;
  const t = (content.title||'').substring(0,40).replace(/'/g,'').replace(/:/g,'-');
  const gT = nd.gradientTop||'0x6366f1', gB = nd.gradientBot||'0x0a0a2e';
  try {
    execSync(`ffmpeg -y -f lavfi -i "gradients=c0=${gT}:c1=${gB}:s=1080x1920:d=0.04:speed=0" -filter_complex "[0:v]drawtext=text='${esc(t)}':fontsize=48:fontcolor=white:borderw=4:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2:fontfile='${FONT_ESC}'[out]" -map "[out]" -frames:v 1 "${outputPath}"`, { timeout: 15000, stdio: 'pipe' });
    return fs.existsSync(outputPath);
  } catch { return false; }
}

async function uploadToYouTube(video) {
  const cid = process.env.GOOGLE_CLIENT_ID, cs = process.env.GOOGLE_CLIENT_SECRET, rt = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!cid || !cs || !rt) throw new Error('YouTube credentials not configured');
  const oauth = new google.auth.OAuth2(cid, cs, 'https://ai-video-automation-phi.vercel.app/tiktok/callback');
  oauth.setCredentials({ refresh_token: rt });
  const yt = google.youtube({ version: 'v3', auth: oauth });
  const r = await yt.videos.insert({ part: ['snippet','status'], requestBody: { snippet: { title: video.title, description: video.description, tags: video.tags.slice(0,30), categoryId: video.categoryId||'28', defaultLanguage: 'en' }, status: { privacyStatus: 'public', selfDeclaredMadeForKids: false } }, media: { body: fs.createReadStream(video.file) } });
  const vid = r.data.id;
  try {
    if (video.thumbnail && fs.existsSync(video.thumbnail)) await yt.thumbnails.set({ videoId: vid, media: { mimeType: 'image/jpeg', body: fs.createReadStream(video.thumbnail) } });
  } catch (e) { console.log('  Thumbnail upload skipped:', e.message); }
  return { videoId: vid, url: `https://www.youtube.com/watch?v=${vid}`, status: 'uploaded' };
}

async function uploadToTikTok(video) {
  let at = process.env.TIKTOK_ACCESS_TOKEN;
  if (!at) {
    const tokenFile = path.join(TOKENS_DIR, 'tiktok.json');
    if (fs.existsSync(tokenFile)) {
      const t = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
      if (t.access_token) at = t.access_token;
    }
  }
  if (!at) throw new Error('TikTok access token not configured. Visit: http://localhost:3001/tiktok/auth');
  const buf = fs.readFileSync(video.file), sz = buf.length;
  const init = await axios.post('https://open.tiktokapis.com/v2/post/publish/inbox/video/init/', { post_info: { title: video.title.substring(0,150), privacy_level: 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: 'FILE_UPLOAD', video_size: sz } }, { headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' } });
  const { upload_url, publish_id } = init.data.data;
  await axios.put(upload_url, buf, { headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${sz-1}/${sz}` } });
  let st = 'PROCESSING', att = 0;
  while (st === 'PROCESSING' && att < 30) { await new Promise(r => setTimeout(r, 2000)); const sr = await axios.get('https://open.tiktokapis.com/v2/post/publish/status/fetch/', { params: { publish_id }, headers: { Authorization: `Bearer ${at}` } }); st = sr.data.data.status; att++; }
  return { videoId: publish_id, url: `https://www.tiktok.com/@user/video/${publish_id}`, status: st === 'SUCCESS' ? 'uploaded' : st };
}

app.get('/tiktok/auth', (req, res) => {
  const ck = process.env.TIKTOK_CLIENT_KEY;
  if (!ck) return res.status(400).send('TIKTOK_CLIENT_KEY not configured in .env');
  const crypto = require('crypto');
  // TikTok Desktop apps require HEX-encoded code challenge, not base64url
  const codeVerifier = crypto.randomBytes(32).toString('hex');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
  const state = crypto.randomBytes(16).toString('hex');
  const sessionFile = path.join(TOKENS_DIR, 'tiktok_session.json');
  fs.writeFileSync(sessionFile, JSON.stringify({ codeVerifier, state, codeChallenge }));
  const redirectUri = 'https://ai-video-automation-phi.vercel.app/tiktok/callback.html';
  const scopes = ['user.info.basic', 'video.publish'].join(',');
  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${ck}&response_type=code&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;
  console.log('TikTok auth redirect:', url);
  console.log('Redirect URI:', redirectUri);
  console.log('Code verifier:', codeVerifier);
  console.log('Code challenge (HEX):', codeChallenge);
  res.redirect(url);
});

app.get('/tiktok/callback', async (req, res) => {
  try {
    const { code, error, error_description, state } = req.query;
    console.log('TikTok callback received:', { code: code ? 'yes' : 'no', error, error_description, state });
    if (error) return res.status(400).send(`Auth error: ${error} - ${error_description || ''}`);
    if (!code) return res.status(400).send('No authorization code received from TikTok');
    const ck = process.env.TIKTOK_CLIENT_KEY;
    const cs = process.env.TIKTOK_CLIENT_SECRET;
    if (!ck || !cs) return res.status(400).send('TikTok credentials not configured');
    const sessionFile = path.join(TOKENS_DIR, 'tiktok_session.json');
    let codeVerifier = '';
    if (fs.existsSync(sessionFile)) {
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      codeVerifier = session.codeVerifier || '';
      console.log('Loaded code verifier:', codeVerifier.substring(0, 20) + '...');
    }
    const redirectUri = `http://localhost:${PORT}/tiktok/callback`;
    console.log('Exchanging code for token with redirect_uri:', redirectUri);
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', null, {
      params: { client_key: ck, client_secret: cs, code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: codeVerifier },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = tokenRes.data;
    console.log('Token response:', JSON.stringify(data).substring(0, 200));
    if (data.error) return res.status(400).send(`Token error: ${data.error_description || data.error}`);
    const tokenData = { access_token: data.access_token, refresh_token: data.refresh_token, open_id: data.open_id, expires_in: data.expires_in, scope: data.scope, obtained_at: new Date().toISOString() };
    fs.writeFileSync(path.join(TOKENS_DIR, 'tiktok.json'), JSON.stringify(tokenData, null, 2));
    process.env.TIKTOK_ACCESS_TOKEN = data.access_token;
    res.send(`<html><body style="font-family:sans-serif;background:#1a1a2e;color:white;text-align:center;padding:50px;">
      <h1 style="color:#22c55e;">TikTok Connected!</h1>
      <p>Access token saved. You can close this tab.</p>
      <p style="color:#888;">Open ID: ${data.open_id}</p>
      <p style="color:#888;">Scope: ${data.scope}</p>
      <script>setTimeout(()=>window.close(),3000);</script>
    </body></html>`);
    console.log('TikTok auth successful, token saved');
  } catch (e) {
    console.error('TikTok callback error:', e.message);
    if (e.response && e.response.data) console.error('Response:', JSON.stringify(e.response.data));
    res.status(500).send(`Error: ${e.message}`);
  }
});

app.get('/tiktok/exchange', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('No code provided');
    const ck = process.env.TIKTOK_CLIENT_KEY;
    const cs = process.env.TIKTOK_CLIENT_SECRET;
    if (!ck || !cs) return res.status(400).send('TikTok credentials not configured');
    const sessionFile = path.join(TOKENS_DIR, 'tiktok_session.json');
    let codeVerifier = '';
    if (fs.existsSync(sessionFile)) {
      const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      codeVerifier = session.codeVerifier || '';
    }
    const redirectUri = 'https://ai-video-automation-phi.vercel.app/tiktok/callback.html';
    console.log('Exchanging code via Vercel callback redirect_uri:', redirectUri);
    console.log('Code verifier:', codeVerifier);
    const tokenRes = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', null, {
      params: { client_key: ck, client_secret: cs, code, grant_type: 'authorization_code', redirect_uri: redirectUri, code_verifier: codeVerifier },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const data = tokenRes.data;
    console.log('Token response:', JSON.stringify(data).substring(0, 200));
    if (data.error) return res.status(400).send(`Token error: ${data.error_description || data.error}`);
    const tokenData = { access_token: data.access_token, refresh_token: data.refresh_token, open_id: data.open_id, expires_in: data.expires_in, scope: data.scope, obtained_at: new Date().toISOString() };
    fs.writeFileSync(path.join(TOKENS_DIR, 'tiktok.json'), JSON.stringify(tokenData, null, 2));
    process.env.TIKTOK_ACCESS_TOKEN = data.access_token;
    res.send(`<!DOCTYPE html><html><head><title>TikTok Connected</title><style>
body{font-family:-apple-system,sans-serif;background:#0f0f23;color:white;text-align:center;padding:50px;}
h1{color:#22c55e;} a{color:#69c9d0;}
</style></head><body>
<h1>TikTok Connected!</h1>
<p>Token berhasil disimpan.</p>
<p>Open ID: ${data.open_id}</p>
<script>setTimeout(()=>window.location.href='/',2000);</script>
</body></html>`);
    console.log('TikTok auth successful via exchange');
  } catch (e) {
    console.error('TikTok exchange error:', e.message);
    if (e.response && e.response.data) console.error('Response:', JSON.stringify(e.response.data));
    res.status(500).send(`Error: ${e.message}`);
  }
});

app.get('/tiktok/status', (req, res) => {
  const tokenFile = path.join(TOKENS_DIR, 'tiktok.json');
  if (fs.existsSync(tokenFile)) {
    const t = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
    res.json({ connected: true, open_id: t.open_id, obtained_at: t.obtained_at });
  } else {
    res.json({ connected: false });
  }
});

app.get('/tiktok/manual', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>TikTok Manual Token</title><style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,sans-serif;background:#0f0f23;color:#e0e0e0;padding:30px;max-width:700px;margin:0 auto;line-height:1.6;}
h1{color:#69c9d0;font-size:22px;margin-bottom:16px;}
.step{background:#1a1a3e;padding:20px;border-radius:12px;margin:16px 0;border:1px solid #2a2a5e;}
.step h3{color:#69c9d0;margin-bottom:8px;}
code{background:#0a0a2e;padding:6px 10px;border-radius:6px;display:block;margin:8px 0;font-size:13px;color:#f0c040;word-break:break-all;border:1px solid #333;}
.btn{display:inline-block;padding:14px 28px;background:#69c9d0;color:#0f0f23;text-decoration:none;border-radius:8px;font-weight:bold;margin:8px 4px;font-size:15px;border:none;cursor:pointer;}
.btn:hover{background:#4db8c4;}
.btn-red{background:#ff4757;color:white;}
.warn{color:#f59e0b;font-weight:bold;}
.note{color:#888;font-size:13px;margin-top:8px;}
input[type=text]{width:100%;padding:12px;border-radius:8px;border:1px solid #333;background:#0a0a2e;color:white;font-size:14px;margin:6px 0;}
.form-row{margin:12px 0;}
.form-row label{display:block;color:#888;font-size:13px;margin-bottom:4px;}
.checklist{margin:10px 0;}
.checklist label{display:block;padding:6px 0;color:#ccc;cursor:pointer;}
.checklist input[type=checkbox]{margin-right:8px;}
</style></head><body>
<h1>Cara Dapatkan TikTok Access Token</h1>

<div class="step"><h3>Cara Paling Cepat: Ceklist di bawah ini</h3>
<p>Di halaman TikTok Developer Portal yang kamu buka sekarang:</p>
<div class="checklist">
<label><input type="checkbox" id="c1"> 1. Di pojok kanan atas, cari tombol <strong>"Authorize"</strong> atau <strong>"Try it"</strong></label>
<label><input type="checkbox" id="c2"> 2. Klik tombol itu → popup muncul</label>
<label><input type="checkbox" id="c3"> 3. Pilih scope: <code>video.publish</code></label>
<label><input type="checkbox" id="c4"> 4. Klik <strong>"Authorize"</strong> → login TikTok</label>
<label><input type="checkbox" id="c5"> 5. Setelah login, kamu lihat token panjang di halaman</label>
<label><input type="checkbox" id="c6"> 6. Copy token itu, paste di bawah ini</label>
</div>
<p class="warn">Token biasanya berformat: v2.access_xxxxx atau act.xxxxx</p>
</div>

<div class="step"><h3>Paste Access Token</h3>
<form action="/tiktok/manual-token" method="POST">
<div class="form-row">
<label>Access Token:</label>
<input type="text" name="access_token" placeholder="v2.access_xxxxx atau act.xxxxx" required>
</div>
<div class="form-row">
<label>Open ID (opsional):</label>
<input type="text" name="open_id" placeholder="open_id dari TikTok">
</div>
<button type="submit" class="btn btn-red">Simpan Token & Connect</button>
</form></div>

<div style="text-align:center;margin-top:20px;">
<a href="/" class="btn">Back to Dashboard</a>
</div>
</body></html>`);
});

app.post('/tiktok/manual-token', express.urlencoded({ extended: true }), (req, res) => {
  const { access_token, open_id } = req.body;
  if (!access_token) return res.status(400).send('access_token required');
  const tokenData = {
    access_token,
    open_id: open_id || 'manual_entry',
    obtained_at: new Date().toISOString(),
    manual: true,
  };
  fs.writeFileSync(path.join(TOKENS_DIR, 'tiktok.json'), JSON.stringify(tokenData, null, 2));
  process.env.TIKTOK_ACCESS_TOKEN = access_token;
  res.send(`<!DOCTYPE html><html><head><title>TikTok Token Saved</title><style>
body{font-family:sans-serif;background:#1a1a2e;color:white;text-align:center;padding:50px;}
h1{color:#22c55e;} a{color:#69c9d0;}
</style></head><body>
<h1>Token Saved!</h1>
<p>TikTok access token has been saved successfully.</p>
<p>You can close this tab or <a href="/">return to dashboard</a>.</p>
<script>setTimeout(()=>window.close(),2000);</script>
</body></html>`);
});

// ============ ROUTES ============

app.get('/api/data', (req, res) => {
  try {
    const v = loadJSON('videos.json');
    res.json({ videos: v, stats: { totalVideos: v.length, uploadedVideos: v.filter(x=>x.status==='uploaded').length, scheduledVideos: v.filter(x=>x.status==='scheduled').length, failedVideos: v.filter(x=>x.status==='failed').length, totalViews: v.reduce((s,x)=>s+(x.views||0),0), totalLikes: v.reduce((s,x)=>s+(x.likes||0),0), recentVideos: [...v].sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,10) }, settings: { OPENAI_API_KEY: process.env.OPENAI_API_KEY?'set':'not set', PEXELS_API_KEY: process.env.PEXELS_API_KEY?'set':'not set', GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID?'set':'not set', YOUTUBE_REFRESH_TOKEN: process.env.YOUTUBE_REFRESH_TOKEN?'set':'not set', TIKTOK_ACCESS_TOKEN: process.env.TIKTOK_ACCESS_TOKEN?'set':'not set' }, niches: Object.keys(NICHES).reduce((acc, key) => { acc[key] = { topics: NICHES[key].topics }; return acc; }, {}) });
  } catch (e) { console.error('GET /api/data error:', e.message); res.status(500).json({ error: 'Internal server error' }); }
});

app.post('/api/data', async (req, res) => {
  try {
    const { niche='technology', platform='youtube', topic, duration=60, autoUpload=false } = req.body;
    const videos = loadJSON('videos.json');
    const id = Date.now().toString();
    const content = generateSEOContent(niche, topic, duration);
    content.niche = niche;
    const vf = path.join(OUTPUT_DIR, `${id}.mp4`), tf = path.join(OUTPUT_DIR, `${id}_thumb.jpg`), cf = path.join(OUTPUT_DIR, `${id}.srt`);
    console.log(`\nRendering: ${content.title}`);
    const ok = await createVideoWithFFmpeg(content, vf);
    createThumbnail(content, tf);
    fs.writeFileSync(cf, content.srt);
    console.log(`Result: ${ok ? 'SUCCESS' : 'FAILED'}`);
    const video = { id, title: content.title, description: content.description, niche, platform, status: ok?'ready':'content_only', duration, scenes: content.scenes, tags: content.tags, hashtags: content.hashtags, categoryId: content.categoryId, file: ok?vf:null, thumbnail: ok?tf:null, caption: ok?cf:null, created_at: new Date().toISOString(), views: 0, likes: 0, youtube_url: null, tiktok_url: null };
    if (autoUpload && ok) {
      try {
        if (platform==='youtube'||platform==='both') { const r = await uploadToYouTube(video); video.youtube_url=r.url; video.youtube_id=r.videoId; video.status='uploaded'; }
        if (platform==='tiktok'||platform==='both') { const r = await uploadToTikTok(video); video.tiktok_url=r.url; video.tiktok_id=r.videoId; video.status='uploaded'; }
      } catch (e) { console.error('Upload error:', e.message); video.upload_error = e.message; }
    }
    videos.push(video); saveJSON('videos.json', videos);
    res.json({ success: true, video, message: ok?'Video rendered!':'Content generated' });
  } catch (e) { console.error('POST /api/data error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/render/:id', async (req, res) => {
  try {
    const videos = loadJSON('videos.json');
    const video = videos.find(v => v.id === req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    const vf = path.join(OUTPUT_DIR, `${video.id}.mp4`), tf = path.join(OUTPUT_DIR, `${video.id}_thumb.jpg`), cf = path.join(OUTPUT_DIR, `${video.id}.srt`);
    const content = { title: video.title, niche: video.niche, scenes: video.scenes, srt: (video.scenes||[]).map((s,i)=>{const st=i*10;return `${i+1}\n00:${String(Math.floor(st/60)).padStart(2,'0')}:${String(st%60).padStart(2,'0')},000 --> 00:${String(Math.floor((st+s.duration)/60)).padStart(2,'0')}:${String((st+s.duration)%60).padStart(2,'0')},000\n${s.narration}\n`;}).join('\n') };
    console.log(`\nRe-rendering: ${video.title}`);
    const ok = await createVideoWithFFmpeg(content, vf);
    createThumbnail(content, tf); fs.writeFileSync(cf, content.srt);
    if (ok) { video.status='ready'; video.file=vf; video.thumbnail=tf; video.caption=cf; const idx=videos.findIndex(v=>v.id===video.id); videos[idx]=video; saveJSON('videos.json',videos); res.json({success:true,video,message:'Rendered!'}); }
    else res.status(500).json({error:'FFmpeg failed'});
  } catch (e) { console.error('POST /api/render error:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/video/:id', (req, res) => { try { const v=loadJSON('videos.json').find(x=>x.id===req.params.id); if(!v)return res.status(404).json({error:'Not found'}); if(v.file&&fs.existsSync(v.file))res.sendFile(v.file); else res.status(404).json({error:'File not found'}); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/video/:id/thumbnail', (req, res) => { try { const v=loadJSON('videos.json').find(x=>x.id===req.params.id); if(!v||!v.thumbnail||!fs.existsSync(v.thumbnail))return res.status(404).json({error:'Not found'}); res.sendFile(v.thumbnail); } catch(e) { res.status(500).json({error:e.message}); } });
app.get('/api/video/:id/caption', (req, res) => { try { const v=loadJSON('videos.json').find(x=>x.id===req.params.id); if(!v||!v.caption||!fs.existsSync(v.caption))return res.status(404).json({error:'Not found'}); res.sendFile(v.caption); } catch(e) { res.status(500).json({error:e.message}); } });

app.post('/api/upload/:id', async (req, res) => {
  try {
    const { platform='youtube' } = req.body;
    const videos = loadJSON('videos.json');
    const video = videos.find(v => v.id === req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    if (!video.file || !fs.existsSync(video.file)) return res.status(400).json({ error: 'Render video first' });
    if (!canUpload()) {
      const qs = getQuotaStatus();
      return res.status(429).json({ error: `Upload limit reached (${qs.used}/${qs.max} today). Resets in ~${24 - Math.floor((Date.now() - new Date(qs.lastReset).getTime()) / 3600000)}h`, quotaExceeded: true, quota: qs });
    }
    try {
      if (platform==='youtube'||platform==='both') { const r=await uploadToYouTube(video); video.youtube_url=r.url; video.youtube_id=r.videoId; }
      if (platform==='tiktok'||platform==='both') { const r=await uploadToTikTok(video); video.tiktok_url=r.url; video.tiktok_id=r.videoId; }
      video.status='uploaded'; video.uploaded_at=new Date().toISOString();
      incrementQuota();
      const idx=videos.findIndex(v=>v.id===video.id); videos[idx]=video; saveJSON('videos.json',videos);
      res.json({success:true,video, quota: getQuotaStatus()});
    } catch(uploadErr) {
      console.error('Upload error:', uploadErr.message);
      video.upload_error = uploadErr.message;
      const idx=videos.findIndex(v=>v.id===video.id); videos[idx]=video; saveJSON('videos.json',videos);
      const isQuota = uploadErr.message.includes('exceeded') || uploadErr.message.includes('quota');
      res.status(isQuota ? 429 : 500).json({error: uploadErr.message, quotaExceeded: isQuota, quota: getQuotaStatus()});
    }
  } catch(e) { console.error('POST /api/upload error:', e.message); res.status(500).json({error:e.message}); }
});

app.get('/api/quota', (req, res) => {
  try {
    res.json(getQuotaStatus());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/niches', (req, res) => {
  try {
    const result = Object.keys(NICHES).reduce((acc, key) => {
      acc[key] = { topics: NICHES[key].topics, tags: NICHES[key].tags, hashtags: NICHES[key].hashtags };
      return acc;
    }, {});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/trending', async (req, res) => {
  try {
    const topics = await fetchTrending();
    res.json({ topics: topics.slice(0, 50), total: topics.length, cached: (Date.now() - trendingCacheTime) < 600000 });
  } catch (e) { console.error('GET /api/trending error:', e.message); res.status(500).json({ error: e.message }); }
});

function generateSEOTitle(rawTitle, niche) {
  const clean = rawTitle.replace(/[^\w\s]/g, '').trim();
  const words = clean.split(/\s+/).filter(w => w.length > 2);
  const mainWords = words.slice(0, 6).join(' ');
  const prefixes = {
    technology: ['Tech Alert:', 'Breaking Tech:', 'Just Dropped:', 'Tech Update:', 'AI Update:'],
    science: ['Science Alert:', 'Discovery:', 'Research Update:', 'Science Files:', 'Mind Blowing:'],
    finance: ['Finance Alert:', 'Market Watch:', 'Money Alert:', 'Wall Street:', 'Economy Update:'],
    mystery: ['Mystery Alert:', 'Unsolved:', 'What Happened:', 'Mystery Files:', 'Unexplained:'],
    indonesia: ['Indonesia Update:', 'Breaking:', 'Indonesia News:', 'Viral:', 'Trending:'],
    nature: ['Nature Alert:', 'Wild Discovery:', 'Nature Files:', 'Environment:', 'Earth Alert:'],
    space: ['Space Alert:', 'Cosmos Update:', 'Space Discovery:', 'NASA Alert:', 'Universe:'],
    history: ['History Files:', 'Past Revealed:', 'History Alert:', 'Ancient:', 'Heritage:'],
    psychology: ['Mind Files:', 'Brain Alert:', 'Psych Insight:', 'Behavior:', 'Mental:'],
    food: ['Food Files:', 'Kitchen Alert:', 'Food Discovery:', 'Recipe:', 'Cuisine:'],
    geography: ['World Files:', 'Geo Alert:', 'Place Discovery:', 'Travel:', 'Countries:'],
    general: ['Breaking:', 'Just In:', 'Viral Alert:', 'Trending Now:', 'Update:'],
  };
  const pool = prefixes[niche] || prefixes.general;
  const prefix = pool[Math.floor(Math.random() * pool.length)];
  return `${prefix} ${mainWords}`.substring(0, 100);
}

function generateSEODescription(rawTitle, scenes, niche) {
  const hashtags = getHashtags(niche);
  const hashStr = hashtags.join(' ');
  const sceneSummary = scenes.slice(0, 3).map(s => s.narration.replace(/[^\w\s.,!?'-]/g, ' ').replace(/\s+/g, ' ').trim()).join(' ');
  return `${rawTitle}\n\n${sceneSummary}\n\n${hashStr}\n\n#viral #trending #shorts #facts #${niche}`;
}

function generateSEOTags(rawTitle, niche) {
  const baseTags = ['shorts', 'viral', 'trending', 'facts', 'news', '2026', niche];
  const words = rawTitle.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 3);
  const uniqueWords = [...new Set(words)].slice(0, 10);
  return [...baseTags, ...uniqueWords];
}

app.post('/api/trending-generate', async (req, res) => {
  try {
    const { topicTitle, niche, platform='youtube', duration=60 } = req.body;
    const topics = await fetchTrending();
    let topic = topics.find(t => t.title === topicTitle);
    if (!topic) {
      topic = { title: topicTitle || 'Breaking news everyone needs to see', niche: niche || 'general', source: 'Custom', link: '' };
    }
    if (niche) topic.niche = niche;

    const videos = loadJSON('videos.json');
    const id = Date.now().toString();
    const content = generateContentFromTopic(topic);
    content.niche = topic.niche;
    content.title = generateSEOTitle(topic.title, topic.niche);
    content.description = generateSEODescription(topic.title, content.scenes, topic.niche);
    content.tags = generateSEOTags(topic.title, topic.niche);
    const vf = path.join(OUTPUT_DIR, `${id}.mp4`), tf = path.join(OUTPUT_DIR, `${id}_thumb.jpg`), cf = path.join(OUTPUT_DIR, `${id}.srt`);
    console.log(`\nTrending render: ${content.title}`);
    const ok = await createVideoWithFFmpeg(content, vf);
    createThumbnail(content, tf);
    fs.writeFileSync(cf, content.srt);
    console.log(`Result: ${ok ? 'SUCCESS' : 'FAILED'}`);
    const video = { id, title: content.title, description: content.description, niche: topic.niche, platform, status: ok?'ready':'content_only', duration, scenes: content.scenes, tags: content.tags, hashtags: content.hashtags, categoryId: content.categoryId, file: ok?vf:null, thumbnail: ok?tf:null, caption: ok?cf:null, created_at: new Date().toISOString(), views: 0, likes: 0, youtube_url: null, tiktok_url: null, source: topic.source, isTrending: true };
    videos.push(video); saveJSON('videos.json', videos);
    res.json({ success: true, video, message: ok?'Trending video rendered!':'Content generated' });
  } catch (e) { console.error('POST /api/trending-generate error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/batch-generate', async (req, res) => {
  try {
    const { count=5, niche, platform='youtube', duration=60 } = req.body;
    const topics = await fetchTrending();
    let filtered = niche ? topics.filter(t => t.niche === niche) : topics;
    if (filtered.length === 0) filtered = topics;
    const selected = filtered.slice(0, Math.min(count, 20));

    const videos = loadJSON('videos.json');
    const results = [];

    for (let i = 0; i < selected.length; i++) {
      const topic = selected[i];
      const id = Date.now().toString() + '_' + i;
      const content = generateContentFromTopic(topic);
      content.niche = topic.niche;
      content.title = generateSEOTitle(topic.title, topic.niche);
      content.description = generateSEODescription(topic.title, content.scenes, topic.niche);
      content.tags = generateSEOTags(topic.title, topic.niche);
      const vf = path.join(OUTPUT_DIR, `${id}.mp4`), tf = path.join(OUTPUT_DIR, `${id}_thumb.jpg`);
      console.log(`\nBatch [${i+1}/${selected.length}]: ${content.title}`);
      const ok = await createVideoWithFFmpeg(content, vf);
      createThumbnail(content, tf);
      console.log(`Result: ${ok ? 'SUCCESS' : 'FAILED'}`);
      const video = { id, title: content.title, description: content.description, niche: topic.niche, platform, status: ok?'ready':'content_only', duration, scenes: content.scenes, tags: content.tags, hashtags: content.hashtags, categoryId: content.categoryId, file: ok?vf:null, thumbnail: ok?tf:null, created_at: new Date().toISOString(), views: 0, likes: 0, youtube_url: null, tiktok_url: null, source: topic.source, isTrending: true };
      videos.push(video);
      results.push({ id, title: content.title, status: ok?'ready':'failed', niche: topic.niche });
    }
    saveJSON('videos.json', videos);
    res.json({ success: true, results, total: results.length });
  } catch (e) { console.error('POST /api/batch-generate error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/batch-upload', async (req, res) => {
  try {
    const { ids, platform='youtube' } = req.body;
    const videos = loadJSON('videos.json');
    const results = [];
    let quotaExceeded = false;
    for (const id of ids) {
      const video = videos.find(v => v.id === id);
      if (!video || !video.file || !fs.existsSync(video.file)) { results.push({ id, status: 'skipped', reason: 'no file' }); continue; }
      if (quotaExceeded || !canUpload()) {
        quotaExceeded = true;
        results.push({ id, status: 'skipped', reason: 'quota exceeded' }); continue;
      }
      try {
        if (platform === 'youtube' || platform === 'both') {
          const r = await uploadToYouTube(video);
          video.youtube_url = r.url; video.youtube_id = r.videoId;
        }
        video.status = 'uploaded'; video.uploaded_at = new Date().toISOString();
        incrementQuota();
        const idx = videos.findIndex(v => v.id === id); videos[idx] = video;
        results.push({ id, status: 'uploaded', url: video.youtube_url });
        console.log(`Uploaded: ${video.title}`);
      } catch (e) {
        const isQuota = e.message.includes('exceeded') || e.message.includes('quota');
        if (isQuota) quotaExceeded = true;
        results.push({ id, status: 'failed', error: e.message, quotaExceeded: isQuota });
        console.log(`Upload failed: ${video.title} - ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    saveJSON('videos.json', videos);
    res.json({ success: true, results, quotaExceeded, quota: getQuotaStatus() });
  } catch (e) { console.error('POST /api/batch-upload error:', e.message); res.status(500).json({ error: e.message }); }
});

process.on('uncaughtException', (e) => { console.error('UNCAUGHT:', e.message); });
process.on('unhandledRejection', (e) => { console.error('UNHANDLED:', e); });

const server = app.listen(PORT, () => { console.log(`\nAI Video Automation - http://localhost:${PORT}\nOutput: ${OUTPUT_DIR}\n`); });
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use!`);
    console.error('Kill the other process first:');
    console.error(`  netstat -ano | findstr :${PORT}`);
    console.error(`  taskkill /F /PID <PID>`);
    process.exit(1);
  } else {
    console.error('Server error:', e.message);
    process.exit(1);
  }
});
