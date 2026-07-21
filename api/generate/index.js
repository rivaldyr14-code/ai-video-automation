let videos = [];
let idCounter = 0;

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

const NICHES = {
  technology: {
    topics: ['AI Revolution', 'Quantum Computing', 'Future of Internet', 'Cybersecurity Secrets', 'Blockchain Explained'],
    scenes: [
      { scene: 'Hook', narration: 'Did you know this technology will change everything?' },
      { scene: 'Problem', narration: 'Most people don\'t understand how fast technology is moving.' },
      { scene: 'Solution', narration: 'Here\'s what\'s actually happening behind the scenes.' },
      { scene: 'Deep Dive', narration: 'The data shows us something incredible.' },
      { scene: 'Mind Blown', narration: 'And here\'s the part that will blow your mind.' },
      { scene: 'Call to Action', narration: 'Follow for more tech insights!' },
    ],
    tags: ['technology', 'tech', 'AI', 'future', 'innovation'],
  },
  science: {
    topics: ['Black Holes Explained', 'DNA Secrets', 'Ocean Mysteries', 'Space Exploration', 'Quantum Physics'],
    scenes: [
      { scene: 'Hook', narration: 'Scientists just discovered something incredible.' },
      { scene: 'Mystery', narration: 'For decades, we had no idea this existed.' },
      { scene: 'Discovery', narration: 'But now, the truth is finally revealed.' },
      { scene: 'Evidence', narration: 'The evidence is overwhelming.' },
      { scene: 'Implications', narration: 'This changes everything we know about science.' },
      { scene: 'Outro', narration: 'Like and follow for more science facts!' },
    ],
    tags: ['science', 'space', 'physics', 'biology', 'discovery'],
  },
  finance: {
    topics: ['Money Secrets', 'Investing Basics', 'Crypto Explained', 'Passive Income', 'Stock Market Tips'],
    scenes: [
      { scene: 'Hook', narration: 'Want to know how the wealthy think?' },
      { scene: 'Secret', narration: 'Most people never learn this about money.' },
      { scene: 'Strategy', narration: 'Here\'s the strategy that actually works.' },
      { scene: 'Example', narration: 'Let me show you a real example.' },
      { scene: 'Action', narration: 'Start doing this today.' },
      { scene: 'CTA', narration: 'Save this for later and follow!' },
    ],
    tags: ['finance', 'money', 'investing', 'wealth', 'crypto'],
  },
  mystery: {
    topics: ['Unsolved Mysteries', 'Conspiracy Theories', 'Strange Phenomena', 'Lost Civilizations', 'Paranormal Events'],
    scenes: [
      { scene: 'Hook', narration: 'This mystery has never been solved.' },
      { scene: 'Background', narration: 'Here\'s what happened.' },
      { scene: 'Clues', narration: 'The clues point to something strange.' },
      { scene: 'Twist', narration: 'But then things got weird.' },
      { scene: 'Unsolved', narration: 'To this day, nobody knows the truth.' },
      { scene: 'CTA', narration: 'What do you think? Comment below!' },
    ],
    tags: ['mystery', 'unsolved', 'conspiracy', 'paranormal', 'strange'],
  },
};

function generateContent(niche, topic, duration) {
  const nicheData = NICHES[niche] || NICHES.technology;
  const title = topic || nicheData.topics[Math.floor(Math.random() * nicheData.topics.length)];
  const sceneCount = Math.min(6, Math.ceil(duration / 10));

  const scenes = nicheData.scenes.slice(0, sceneCount).map((s, i) => ({
    ...s,
    duration: Math.floor(duration / sceneCount),
  }));

  return {
    title: title,
    description: `Amazing ${niche} content about ${title}. ${nicheData.scenes[0].narration}`,
    scenes: scenes,
    tags: [...nicheData.tags, title.toLowerCase().replace(/\s+/g, '')],
    provider: 'template',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await parseBody(req);
    const { niche = 'technology', platform = 'youtube', topic, duration = 60 } = body;

    idCounter++;
    const jobId = 'job-' + idCounter + '-' + Date.now();

    const content = generateContent(niche, topic, duration);

    const video = {
      id: jobId,
      title: content.title,
      description: content.description,
      niche,
      platform,
      status: 'content_ready',
      duration,
      scenes: content.scenes,
      tags: content.tags,
      provider: 'template',
      created_at: new Date().toISOString(),
      views: 0,
      likes: 0,
    };

    videos.push(video);

    return res.status(200).json({
      success: true,
      jobId: jobId,
      message: 'Content generated successfully',
      video: video,
      content: content,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
