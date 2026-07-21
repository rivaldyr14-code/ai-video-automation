const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { google } = require('googleapis');
const axios = require('axios');
const xml2js = require('xml2js');

// ============ CONFIG ============
const FFMPEG_BIN = 'C:\\Users\\Rival\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-8.1.2-full_build\\bin';
process.env.PATH = FFMPEG_BIN + ';' + (process.env.PATH || '');

require('dotenv').config({ path: path.join(__dirname, '.env.local') });
require('dotenv').config({ path: path.join(__dirname, '.env') });

const DATA_DIR = path.join(__dirname, 'data');
const OUTPUT_DIR = path.join(__dirname, 'output');
const TEMP_DIR = path.join(__dirname, 'temp');
const TOKENS_DIR = path.join(__dirname, 'tokens');
[DATA_DIR, OUTPUT_DIR, TEMP_DIR, TOKENS_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const FONT_PATH = path.join(TEMP_DIR, 'Montserrat-Bold.ttf');
if (!fs.existsSync(FONT_PATH)) {
  const src = path.join(__dirname, 'assets', 'Montserrat-Bold.ttf');
  if (fs.existsSync(src)) fs.copyFileSync(src, FONT_PATH);
}
const FONT_ESC = FONT_PATH.replace(/\\/g, '/').replace(/:/g, '\\:');

const TOTAL_VIDEOS = 50;
const DELAY_BETWEEN_RENDERS = 5000; // 5 seconds between renders
const DELAY_BETWEEN_UPLOADS = 10000; // 10 seconds between uploads

// ============ HELPERS ============
function loadJSON(f) { try { const p = path.join(DATA_DIR, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf-8')) : []; } catch(e) { return []; } }
function saveJSON(f, d) { fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(d, null, 2)); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ============ TRENDING FETCH ============
const RSS_FEEDS = [
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'technology', label: 'Tech' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'science', label: 'Science' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRFp0Y1RjU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'finance', label: 'Finance' },
  { url: 'https://news.google.com/rss/topics/CAAqJggKIiBDQkFTRWdvSUwyMHZNRGRqTVhZU0FtVnVHZ0pWVXlnQVAB?hl=en-US&gl=US&ceid=US:en', niche: 'mystery', label: 'Mystery' },
  { url: 'https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', niche: 'general', label: 'Trending' },
];

async function fetchRSS(url, timeout = 8000) {
  try {
    const res = await axios.get(url, { timeout, headers: { 'User-Agent': 'Mozilla/5.0' } });
    const parser = new xml2js.Parser({ explicitArray: false, trim: true });
    const result = await parser.parseStringPromise(res.data);
    const items = result?.rss?.channel?.item || [];
    return Array.isArray(items) ? items : [items];
  } catch (e) { return []; }
}

async function fetchTrending() {
  console.log('Fetching trending topics...');
  const allResults = await Promise.all(RSS_FEEDS.map(async feed => {
    const items = await fetchRSS(feed.url);
    return items.map(item => ({
      title: item.title || item.link || 'Breaking news',
      link: item.link || '',
      niche: feed.niche,
      label: feed.label,
      source: feed.label,
      pubDate: item.pubDate || '',
    }));
  }));
  const allTopics = allResults.flat();
  const seen = new Set();
  const unique = allTopics.filter(t => {
    const key = t.title.toLowerCase().substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`Found ${unique.length} unique trending topics`);
  return unique;
}

// ============ CONTENT GENERATION ============
function getVisualKeyword(niche, text) {
  const t = (text || '').toLowerCase();
  if (t.includes('mars') || t.includes('space') || t.includes('rocket') || t.includes('nasa') || t.includes('planet') || t.includes('star') || t.includes('galaxy')) return 'space';
  if (t.includes('ai') || t.includes('robot') || t.includes('tech') || t.includes('computer') || t.includes('chip') || t.includes('software')) return 'tech';
  if (t.includes('money') || t.includes('market') || t.includes('stock') || t.includes('finance') || t.includes('economy')) return 'finance';
  if (t.includes('nature') || t.includes('animal') || t.includes('ocean') || t.includes('forest') || t.includes('climate') || t.includes('earth')) return 'nature';
  if (t.includes('history') || t.includes('ancient') || t.includes('war') || t.includes('king') || t.includes('empire')) return 'history';
  if (t.includes('brain') || t.includes('mind') || t.includes('psychology') || t.includes('mental') || t.includes('behavior')) return 'psychology';
  if (t.includes('food') || t.includes('cooking') || t.includes('recipe') || t.includes('cuisine') || t.includes('eat')) return 'food';
  if (t.includes('country') || t.includes('city') || t.includes('map') || t.includes('world') || t.includes('travel')) return 'geography';
  const nicheMap = { technology: 'tech', science: 'space', finance: 'finance', mystery: 'mystery', indonesia: 'news', nature: 'nature', space: 'space', history: 'history', psychology: 'psychology', food: 'food', geography: 'geography' };
  return nicheMap[niche] || 'news';
}

function getHashtags(niche) {
  const h = { technology:['#tech','#ai','#innovation','#future','#coding'], science:['#science','#research','#discovery','#space','#biology'], finance:['#finance','#money','#stocks','#crypto','#economy'], mystery:['#mystery','#unsolved','#enigma','#questions','#secrets'], indonesia:['#indonesia','#viral','#trending','#news','#fyp'], nature:['#nature','#environment','#climate','#wildlife','#earth'], space:['#space','#nasa','#universe','#astronomy','#cosmos'], history:['#history','#ancient','#heritage','#civilization','#past'], psychology:['#psychology','#mindset','#behavior','#brain','#science'], food:['#food','#cooking','#recipe','#cuisine','#foodie'], geography:['#geography','#countries','#travel','#exploration','#world'] };
  return (h[niche]||h.science).slice(0,5);
}

function generateContentFromTopic(topic) {
  const rawTitle = topic.title;
  const niche = topic.niche || 'general';

  const emojis = {
    technology: ['🤖', '💻', '⚡', '🔮', '🚀', '💡', '🌐'],
    science: ['🔬', '🧪', '🔭', '🧬', '💫', '🌍'],
    finance: ['💰', '📈', '💎', '🏦', '💵', '📊'],
    mystery: ['👁️', '🔍', '❓', '🌀', '🔮'],
    indonesia: ['🇮🇩', '🔥', '⚡', '🌏', '🎯', '💪'],
    nature: ['🌿', '🐘', '🌊', '🦁', '🌺', '🦅'],
    space: ['🚀', '🌌', '⭐', '🪐', '🔭', '☄️'],
    history: ['🏛️', '⚔️', '📜', '🗿', '👑', '🏰'],
    psychology: ['🧠', '💭', '🧪', '🎯', '💡', '🧩'],
    food: ['🍕', '🌮', '🍜', '🍣', '🧁', '🥘'],
    geography: ['🗺️', '🏔️', '🏝️', '🌋', '🌆', '🗼'],
    general: ['🔥', '⚡', '🌍', '💡', '🎯', '👀'],
  };
  const nicheEmoji = emojis[niche] || emojis.general;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const e = () => pick(nicheEmoji);

  const clean = rawTitle.replace(/[-–—:|]/g, ' ').replace(/\s+/g, ' ').trim();
  const core = clean
    .replace(/^(breaking|just in|viral|alert|update|news|report|says|reveals|confirms|announces)\s*/gi, '')
    .replace(/\s*[-–—]\s*(reuters|yahoo|cnn|bbc|fox|nbc|abc|cbs|associated press|al jazeera|techcrunch|verge|cnbc|bloomberg|wsj|nyt|washington post|forbes|guardian| ESPN|AP News|Phys\.org|Live Science|Space\.com|Eurogamer|GSMArena|MLB\.com|Sports Illustrated)$/gi, '')
    .trim();
  const coreClean = core.replace(/[?!.,;:'"]/g, '').trim();

  // 10 different story patterns
  const patterns = [
    // Pattern 1: Breaking news style
    [
      `${e()} Breaking news right now. ${coreClean}. This is happening and the details are coming in fast.`,
      `${e()} Here is what we know. Reports confirm this is real. Multiple sources are covering the same story, and the facts are clear.`,
      `${e()} The significance cannot be overstated. This connects to larger trends that have been building for months. Industry experts are paying close attention.`,
      `${e()} People are reacting in real time. Social media is buzzing. The conversation is just getting started and opinions are split.`,
      `${e()} What makes this different from typical news is the scale. This affects more people than you might think at first glance.`,
      `${e()} Stay tuned. This story is developing fast and the next update could change everything. We will keep you informed.`,
    ],
    // Pattern 2: Investigation style
    [
      `${e()} Something just happened that nobody expected. ${coreClean}. And the full story is more interesting than the headline.`,
      `${e()} We dug into this and found layers of complexity. What looks simple on the surface involves years of preparation and dozens of key players.`,
      `${e()} The timeline matters here. This did not happen overnight. There were warning signs, preparation phases, and critical decision points along the way.`,
      `${e()} Experts in the field are weighing in. Some see opportunity, others see risk. The consensus is forming but not yet settled.`,
      `${e()} The ripple effects extend beyond the immediate story. Related industries, communities, and markets are all feeling the impact right now.`,
      `${e()} This is worth following closely. The outcome will set precedents for similar situations in the future. Keep your eyes open.`,
    ],
    // Pattern 3: Explainer style
    [
      `${e()} Let me explain why this matters. ${coreClean}. Most people will scroll past this but they should not.`,
      `${e()} First, the context. This builds on events from recent weeks. The pattern has been visible to those paying attention.`,
      `${e()} Second, the mechanics. How this works involves systems most people never think about but that affect daily life.`,
      `${e()} Third, the implications. This changes the equation for millions of people. The effects will be felt across multiple sectors.`,
      `${e()} Finally, what to watch. The next few weeks will determine whether this is a turning point or just another headline.`,
      `${e()} The bottom line is clear. This deserves your attention. Understanding it puts you ahead of the curve.`,
    ],
    // Pattern 4: Storytelling style
    [
      `${e()} Imagine waking up to this news. ${coreClean}. That is exactly what happened today and the reactions are pouring in.`,
      `${e()} The backstory here is fascinating. What started as a small initiative has grown into something nobody predicted.`,
      `${e()} The turning point came when key stakeholders made their move. That decision changed everything and set today's events in motion.`,
      `${e()} Now the consequences are unfolding in real time. Observers are tracking every development and the picture is becoming clearer.`,
      `${e()} This story has implications for everyone. Whether you follow the news closely or casually, this one matters.`,
      `${e()} The next chapter begins now. What happens next will determine the long-term impact. Stay informed.`,
    ],
    // Pattern 5: Analysis style
    [
      `${e()} This development deserves a closer look. ${coreClean}. The surface-level reaction misses the deeper significance.`,
      `${e()} Data shows this has been trending upward for weeks. The metrics confirm what observers have been noting. This is not a fluke.`,
      `${e()} Historical parallels help explain the magnitude. Similar events in the past led to lasting changes. This could follow the same trajectory.`,
      `${e()} Stakeholder responses have been mixed but telling. The range of reactions reveals the complexity of the situation.`,
      `${e()} Looking at the broader picture, this fits into a pattern of accelerating change. The pace is picking up and the stakes are rising.`,
      `${e()} Analysis suggests this is just the beginning. The full impact will take months to materialize. Pay attention to this space.`,
    ],
    // Pattern 6: Discovery style
    [
      `${e()} Something remarkable just came to light. ${coreClean}. And it changes how we think about this subject.`,
      `${e()} The discovery process itself is noteworthy. It took persistence, creativity, and a willingness to challenge assumptions.`,
      `${e()} What emerged from this process is compelling. The evidence points in one direction and the conclusions are hard to dismiss.`,
      `${e()} The reaction from the community has been swift. Others are replicating the findings and confirming what was initially controversial.`,
      `${e()} This opens new doors. Previous limitations no longer apply. The possibilities just expanded significantly.`,
      `${e()} Watch this space. The implications of this discovery will unfold over time. We are just scratching the surface.`,
    ],
    // Pattern 7: Debate style
    [
      `${e()} This is sparking debate everywhere. ${coreClean}. People are divided and the discussion is heated.`,
      `${e()} On one side, supporters point to clear evidence. The case is strong and the momentum is building. They see this as overdue.`,
      `${e()} On the other side, skeptics raise valid concerns. The counterarguments deserve consideration. Both perspectives have merit.`,
      `${e()} The middle ground is where truth usually lives. Most experts agree on the core facts but disagree on interpretation and implications.`,
      `${e()} What is not debatable is the impact. Regardless of where you stand, this affects the landscape. The status quo is shifting.`,
      `${e()} The resolution will come with time. For now, engage with the debate. Understanding both sides makes you smarter about this issue.`,
    ],
    // Pattern 8: Future-looking style
    [
      `${e()} The future just got closer. ${coreClean}. What was theoretical is now practical and the implications are enormous.`,
      `${e()} This represents a milestone. The technology, the timing, the execution all aligned in ways that accelerate the timeline.`,
      `${e()} Prediction models are being updated. The old projections underestimated the speed of change. New estimates are more aggressive.`,
      `${e()} Early adopters are already positioning. They see what is coming and are preparing. The competitive advantage goes to those who move first.`,
      `${e()} The transformation will happen in stages. The immediate effects are visible. The medium-term consequences are predictable. The long-term impact is transformative.`,
      `${e()} Prepare accordingly. Whether this affects your work, your investments, or your daily life, awareness is the first step.`,
    ],
    // Pattern 9: Human interest style
    [
      `${e()} Behind every headline are real people. ${coreClean}. Their stories make this more than just news.`,
      `${e()} The individuals involved have been working toward this moment for years. Their dedication and persistence led to today.`,
      `${e()} The human element is what makes this relatable. Beyond the statistics and analysis, there are personal journeys and professional milestones.`,
      `${e()} Communities are responding. The social impact extends beyond the immediate participants. This resonates on a personal level for many.`,
      `${e()} The lessons here apply universally. Perseverance, adaptability, and vision are themes that connect this story to everyday life.`,
      `${e()} Remember the people behind this when you share the story. Their achievement deserves recognition. This is what progress looks like.`,
    ],
    // Pattern 10: Urgency style
    [
      `${e()} You need to know about this right now. ${coreClean}. The window for action is closing fast.`,
      `${e()} Time is a factor here. The situation is evolving quickly and early movers have the advantage. Delay has consequences.`,
      `${e()} The facts support urgency. The data is clear. The trend is confirmed. Ignoring this is no longer an option.`,
      `${e()} Those already acting are seeing results. The proof of concept is established. Now it is about scale and speed.`,
      `${e()} The cost of inaction is real. Whether it is financial, strategic, or personal, not engaging has implications.`,
      `${e()} Act now or risk falling behind. This is not hype. It is reality. The future favors the prepared.`,
    ],
  ];

  const pattern = patterns[Math.floor(Math.random() * patterns.length)];
  const scenes = pattern.map((narration, i) => ({
    narration,
    visual: getVisualKeyword(niche, i === 0 ? rawTitle : coreClean),
  }));

  const compellingTitles = {
    technology: [`Tech Breaking: ${core}`, `Just Dropped: ${core}`, `Tech Alert: ${core}`],
    science: [`Science Alert: ${core}`, `Just Discovered: ${core}`, `Mind Blowing: ${core}`],
    finance: [`Money Alert: ${core}`, `Finance Breaking: ${core}`, `Wall Street: ${core}`],
    mystery: [`Unsolved: ${core}`, `Mystery Alert: ${core}`, `What Happened: ${core}`],
    indonesia: [`Indonesia Update: ${core}`, `Breaking: ${core}`, `Indonesia News: ${core}`],
    nature: [`Nature Alert: ${core}`, `Wild Discovery: ${core}`, `Nature Files: ${core}`],
    space: [`Space Breaking: ${core}`, `Cosmos Alert: ${core}`, `Space Discovery: ${core}`],
    history: [`History Files: ${core}`, `Past Revealed: ${core}`, `History Alert: ${core}`],
    psychology: [`Mind Files: ${core}`, `Brain Alert: ${core}`, `Psych Insight: ${core}`],
    food: [`Food Files: ${core}`, `Kitchen Alert: ${core}`, `Food Discovery: ${core}`],
    geography: [`World Files: ${core}`, `Geo Alert: ${core}`, `Place Discovery: ${core}`],
    general: [`Breaking: ${core}`, `Just In: ${core}`, `Viral Alert: ${core}`],
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

// ============ VIDEO RENDERING ============
async function createVideoWithFFmpeg(content, outputPath) {
  try {
    const scenes = content.scenes;
    if (!scenes || scenes.length === 0) return false;

    // Generate TTS for each scene
    const ttsFiles = [];
    for (let i = 0; i < scenes.length; i++) {
      const ttsPath = path.join(TEMP_DIR, `scene_${i}.mp3`);
      try {
        const text = scenes[i].narration.replace(/[^\w\s.,!?'-]/g, ' ').replace(/\s+/g, ' ').trim();
        execSync(`python -m edge_tts --voice "en-US-GuyNeural" --rate "+15%" --text "${text.replace(/"/g, '\\"')}" --write-media "${ttsPath}"`, { timeout: 30000 });
        ttsFiles.push(ttsPath);
      } catch (e) {
        console.log(`  TTS failed for scene ${i}: ${e.message}`);
        // Create silent audio as fallback
        try {
          execSync(`ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t 5 "${ttsPath}"`, { timeout: 10000 });
          ttsFiles.push(ttsPath);
        } catch (e2) {
          console.log(`  Silent audio fallback failed: ${e2.message}`);
          return false;
        }
      }
    }

    // Get durations
    const durations = ttsFiles.map(f => {
      try {
        const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${f}"`, { timeout: 10000 });
        return parseFloat(out.toString().trim()) || 5;
      } catch { return 5; }
    });

    // Generate scene clips
    const sceneFiles = [];
    for (let i = 0; i < scenes.length; i++) {
      const scenePath = path.join(TEMP_DIR, `clip_${i}.mp4`);
      const dur = durations[i] + 0.5;
      const visual = scenes[i].visual || 'news';

      // Search for stock footage
      let stockUrl = null;
      try {
        const searchUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(visual)}&per_page=1&size=medium`;
        const pexelsKey = process.env.PEXELS_API_KEY;
        if (pexelsKey) {
          const res = await axios.get(searchUrl, { headers: { Authorization: pexelsKey }, timeout: 10000 });
          const videos = res.data?.videos || [];
          if (videos.length > 0 && videos[0].video_files) {
            const file = videos[0].video_files.find(f => f.width >= 720) || videos[0].video_files[0];
            stockUrl = file?.link;
          }
        }
      } catch (e) { /* continue without stock */ }

      if (stockUrl) {
        // Download stock and composite
        try {
          const stockPath = path.join(TEMP_DIR, `stock_${i}.mp4`);
          execSync(`curl -L -o "${stockPath}" "${stockUrl}"`, { timeout: 30000 });

          // Create gradient overlay
          const gradPath = path.join(TEMP_DIR, `grad_${i}.mp4`);
          execSync(`ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:s=1080x1920:d=${dur}" -vf "drawbox=x=0:y=0:w=1080:h=960:color=black@0.4:t=fill,drawbox=x=0:y=960:w=1080:h=960:color=0x16213e@0.6:t=fill,scale=1080:1920" -c:v libx264 -t ${dur} "${gradPath}"`, { timeout: 30000 });

          // Composite stock + gradient + audio
          execSync(`ffmpeg -y -i "${stockPath}" -i "${gradPath}" -i "${ttsFiles[i]}" -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[1:v]scale=1080:1920[grad];[bg][grad]blend=all_mode=overlay[vid]" -map "[vid]" -map 2:a -c:v libx264 -c:a aac -shortest "${scenePath}"`, { timeout: 60000 });
          sceneFiles.push(scenePath);
        } catch (e) {
          console.log(`  Stock composite failed for scene ${i}: ${e.message}`);
          stockUrl = null;
        }
      }

      if (!stockUrl) {
        // Fallback: gradient clip with audio
        try {
          execSync(`ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:s=1080x1920:d=${dur}" -i "${ttsFiles[i]}" -vf "drawbox=x=0:y=0:w=1080:h=960:color=black@0.4:t=fill,drawbox=x=0:y=960:w=1080:h=960:color=0x16213e@0.6:t=fill,scale=1080:1920" -c:v libx264 -c:a aac -shortest "${scenePath}"`, { timeout: 60000 });
          sceneFiles.push(scenePath);
        } catch (e) {
          console.log(`  Fallback scene failed: ${e.message}`);
          return false;
        }
      }
    }

    // Generate subtitles (ASS format)
    const assPath = path.join(TEMP_DIR, 'subs.ass');
    let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Default,Montserrat,58,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,2,5,30,30,50,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
`;
    let time = 0;
    for (let i = 0; i < scenes.length; i++) {
      const start = formatASSTime(time);
      time += durations[i];
      const end = formatASSTime(time);
      const text = scenes[i].narration.replace(/[^\w\s.,!?'-]/g, ' ').replace(/\s+/g, ' ').trim();
      assContent += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
    }
    fs.writeFileSync(assPath, assContent);

    // Concatenate all scenes
    const concatPath = path.join(TEMP_DIR, 'concat.txt');
    const concatContent = sceneFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(concatPath, concatContent);

    // Final render with subtitles
    execSync(`ffmpeg -y -f concat -safe 0 -i "${concatPath}" -vf "ass='${assPath.replace(/\\/g, '/').replace(/:/g, '\\:')}'" -c:v libx264 -c:a copy "${outputPath}"`, { timeout: 120000 });

    // Cleanup temp files
    ttsFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
    sceneFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });

    return fs.existsSync(outputPath);
  } catch (e) {
    console.error('Video creation error:', e.message);
    return false;
  }
}

function formatASSTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// ============ THUMBNAIL ============
function createThumbnail(content, outputPath) {
  try {
    const title = content.title.replace(/'/g, '').replace(/:/g, '-').substring(0, 80);
    execSync(`ffmpeg -y -f lavfi -i "color=c=0x1a1a2e:s=1280x720:d=1" -vf "drawbox=x=0:y=0:w=1280:h=720:color=0x16213e:t=fill,drawtext=fontfile='${FONT_ESC}':text='${title.replace(/'/g, "'\\''" )}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" -frames:v 1 "${outputPath}"`, { timeout: 15000 });
    return fs.existsSync(outputPath);
  } catch (e) {
    console.log('  Thumbnail failed:', e.message);
    return false;
  }
}

// ============ YOUTUBE UPLOAD ============
async function uploadToYouTube(video) {
  const cid = process.env.GOOGLE_CLIENT_ID, cs = process.env.GOOGLE_CLIENT_SECRET, rt = process.env.YOUTUBE_REFRESH_TOKEN;
  if (!cid || !cs || !rt) throw new Error('YouTube credentials not configured');
  const oauth = new google.auth.OAuth2(cid, cs, 'https://ai-video-automation-phi.vercel.app/tiktok/callback');
  oauth.setCredentials({ refresh_token: rt });
  const yt = google.youtube({ version: 'v3', auth: oauth });
  const r = await yt.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: { title: video.title, description: video.description, tags: video.tags.slice(0, 30), categoryId: video.categoryId || '28', defaultLanguage: 'en' },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false }
    },
    media: { body: fs.createReadStream(video.file) }
  });
  const vid = r.data.id;
  try {
    if (video.thumbnail && fs.existsSync(video.thumbnail)) {
      await yt.thumbnails.set({ videoId: vid, media: { mimeType: 'image/jpeg', body: fs.createReadStream(video.thumbnail) } });
    }
  } catch (e) { console.log('  Thumbnail upload skipped:', e.message); }
  return { videoId: vid, url: `https://www.youtube.com/watch?v=${vid}` };
}

// ============ MAIN BATCH PROCESS ============
async function main() {
  console.log('='.repeat(60));
  console.log(`  AI VIDEO AUTOMATION - BATCH GENERATOR`);
  console.log(`  Target: ${TOTAL_VIDEOS} videos → YouTube`);
  console.log('='.repeat(60));

  // Check credentials
  const hasYT = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN;
  const hasPexels = process.env.PEXELS_API_KEY;
  console.log(`\nCredentials:`);
  console.log(`  YouTube OAuth: ${hasYT ? 'OK' : 'NOT configured'}`);
  console.log(`  Pexels API: ${hasPexels ? 'OK' : 'NOT configured (using gradients only)'}`);

  if (!hasYT) {
    console.log('\n  YouTube credentials not found. Will render videos only (no upload).');
    console.log('  Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN to .env');
  }

  // Fetch trending topics
  const topics = await fetchTrending();
  if (topics.length === 0) {
    console.log('No trending topics found. Using fallback topics.');
    // Add fallback topics
    for (let i = 0; i < TOTAL_VIDEOS; i++) {
      const niches = ['technology', 'science', 'finance', 'mystery', 'space', 'nature', 'history', 'psychology', 'food', 'geography'];
      topics.push({
        title: `Breaking development ${i + 1} that everyone needs to know about`,
        niche: niches[i % niches.length],
        source: 'Fallback',
        link: '',
      });
    }
  }

  // Select topics (randomize and ensure variety)
  const selectedTopics = [];
  const nicheCount = {};
  while (selectedTopics.length < TOTAL_VIDEOS) {
    const idx = selectedTopics.length % topics.length;
    const topic = topics[idx];
    const niche = topic.niche || 'general';
    nicheCount[niche] = (nicheCount[niche] || 0) + 1;
    // Ensure max 8 per niche for variety
    if (nicheCount[niche] <= 8) {
      selectedTopics.push(topic);
    } else {
      // Swap with a different niche topic
      const altIdx = topics.findIndex(t => t.niche !== niche);
      if (altIdx !== -1) {
        selectedTopics.push(topics[altIdx]);
        topics.splice(altIdx, 1);
      } else {
        selectedTopics.push(topic);
      }
    }
    if (selectedTopics.length >= topics.length && selectedTopics.length < TOTAL_VIDEOS) break;
  }

  console.log(`\nSelected ${selectedTopics.length} topics for generation`);
  console.log(`Niche distribution:`, nicheCount);

  const videos = loadJSON('videos.json');
  const results = { success: 0, failed: 0, uploaded: 0 };

  for (let i = 0; i < selectedTopics.length; i++) {
    const topic = selectedTopics[i];
    console.log(`\n${'='.repeat(50)}`);
    console.log(`[${i + 1}/${selectedTopics.length}] ${topic.niche.toUpperCase()}: ${topic.title.substring(0, 60)}...`);
    console.log(`${'='.repeat(50)}`);

    const id = Date.now().toString() + '_' + i;
    const content = generateContentFromTopic(topic);
    content.niche = topic.niche;

    const vf = path.join(OUTPUT_DIR, `${id}.mp4`);
    const tf = path.join(OUTPUT_DIR, `${id}_thumb.jpg`);

    console.log(`  Title: ${content.title}`);
    console.log(`  Rendering...`);

    const renderOk = await createVideoWithFFmpeg(content, vf);
    createThumbnail(content, tf);

    if (renderOk) {
      console.log(`  [OK] Render SUCCESS`);
      results.success++;

      const video = {
        id,
        title: content.title,
        description: content.description,
        niche: topic.niche,
        platform: 'youtube',
        status: 'ready',
        duration: 60,
        scenes: content.scenes,
        tags: content.tags,
        hashtags: content.hashtags,
        categoryId: content.categoryId,
        file: vf,
        thumbnail: tf,
        created_at: new Date().toISOString(),
        views: 0,
        likes: 0,
        youtube_url: null,
        source: topic.source,
        isTrending: true,
      };

      // Auto-upload to YouTube
      if (hasYT) {
        console.log(`  Uploading to YouTube...`);
        try {
          const uploadResult = await uploadToYouTube(video);
          video.youtube_url = uploadResult.url;
          video.youtube_id = uploadResult.videoId;
          video.status = 'uploaded';
          video.uploaded_at = new Date().toISOString();
          console.log(`  [OK] Upload SUCCESS: ${uploadResult.url}`);
          results.uploaded++;
        } catch (e) {
          console.log(`  [FAIL] Upload FAILED: ${e.message}`);
          video.status = 'upload_failed';
          video.upload_error = e.message;
        }
      }

      videos.push(video);
    } else {
      console.log(`  [FAIL] Render FAILED`);
      results.failed++;
    }

    saveJSON('videos.json', videos);

    // Delay between renders
    if (i < selectedTopics.length - 1) {
      console.log(`  Waiting ${DELAY_BETWEEN_RENDERS / 1000}s before next...`);
      await sleep(DELAY_BETWEEN_RENDERS);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('  BATCH COMPLETE');
  console.log('='.repeat(60));
  console.log(`  Total: ${selectedTopics.length}`);
  console.log(`  Rendered: ${results.success}`);
  console.log(`  Failed: ${results.failed}`);
  console.log(`  Uploaded to YouTube: ${results.uploaded}`);
  console.log('='.repeat(60));
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
