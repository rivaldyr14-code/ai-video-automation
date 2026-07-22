const NICHES = {
  technology: { topics: ['AI Revolution', 'Quantum Computing', '5G Technology', 'Cybersecurity Secrets', 'Virtual Reality', 'Machine Learning', 'Blockchain Explained', 'Robot Takeover'], tags: ['tech', 'ai', 'coding'], hashtags: ['#tech', '#ai', '#coding', '#innovation', '#future'] },
  science: { topics: ['Black Holes', 'Gene Editing', 'Dark Matter', 'Quantum Physics', 'Climate Change', 'Brain Discovery', 'DNA Secrets', 'Ocean Deep'], tags: ['science', 'research', 'discovery'], hashtags: ['#science', '#research', '#discovery', '#nature', '#physics'] },
  finance: { topics: ['Stock Market', 'Crypto Update', 'Investing Basics', 'Money Secrets', 'Economic Shift', 'Real Estate', 'Inflation Impact', 'Wealth Building'], tags: ['finance', 'money', 'investing'], hashtags: ['#finance', '#money', '#investing', '#crypto', '#wealth'] },
  mystery: { topics: ['Unsolved Cases', 'Conspiracy Theories', 'Strange Phenomena', 'Missing Persons', 'Ancient Mysteries', 'Paranormal Activity', 'Cold Cases', 'Unexplained Events'], tags: ['mystery', 'unsolved', 'mystery'], hashtags: ['#mystery', '#unsolved', '#conspiracy', '#strange', '#unexplained'] },
  indonesia: { topics: ['Indonesia News', 'Jakarta Update', 'Indonesian Culture', 'Indonesian Economy', 'Indonesian Politics', 'Indonesian Tourism', 'Indonesian Tech', 'Indonesian Society'], tags: ['indonesia', 'news', 'viral'], hashtags: ['#indonesia', '#news', '#viral', '#trending', '#update'] },
  nature: { topics: ['Wildlife Conservation', 'Endangered Species', 'Ocean Life', 'Climate Impact', 'Rainforest Discovery', 'Animal Behavior', 'Natural Disasters', 'Ecosystem'], tags: ['nature', 'wildlife', 'environment'], hashtags: ['#nature', '#wildlife', '#environment', '#conservation', '#earth'] },
  space: { topics: ['Mars Mission', 'Black Holes', 'Exoplanets', 'Space Technology', 'Asteroid Alert', 'Moon Discovery', 'Solar System', 'Universe'], tags: ['space', 'nasa', 'cosmos'], hashtags: ['#space', '#nasa', '#cosmos', '#universe', '#astronomy'] },
  history: { topics: ['Ancient Civilizations', 'World Wars', 'Historical Figures', 'Archaeological Finds', 'Lost Cities', 'Ancient Technology', 'Historical Events', 'Cultural Heritage'], tags: ['history', 'ancient', 'past'], hashtags: ['#history', '#ancient', '#past', '#heritage', '#civilization'] },
  psychology: { topics: ['Human Behavior', 'Mental Health', 'Cognitive Biases', 'Emotional Intelligence', 'Habits Science', 'Decision Making', 'Social Psychology', 'Brain Facts'], tags: ['psychology', 'mind', 'brain'], hashtags: ['#psychology', '#mind', '#brain', '#behavior', '#mentalhealth'] },
  food: { topics: ['Food Science', 'Nutrition Facts', 'Cooking Secrets', 'Food History', 'Superfoods', 'Diet Trends', 'Food Technology', 'Global Cuisine'], tags: ['food', 'cooking', 'nutrition'], hashtags: ['#food', '#cooking', '#nutrition', '#recipe', '#foodie'] },
  geography: { topics: ['Country Facts', 'Geographical Wonders', 'Capital Cities', 'Population Data', 'Natural Landmarks', 'Climate Zones', 'Cultural Geography', 'World Maps'], tags: ['geography', 'world', 'travel'], hashtags: ['#geography', '#world', '#travel', '#countries', '#maps'] },
  general: { topics: ['Trending Now', 'Viral Stories', 'Breaking News', 'Daily Facts', 'Interesting Facts', 'Life Hacks', 'Tech Tips', 'Mind Blowing'], tags: ['general', 'trending', 'viral'], hashtags: ['#trending', '#viral', '#facts', '#news', '#interesting'] },
};

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  try {
    const result = Object.keys(NICHES).reduce((acc, key) => {
      acc[key] = { topics: NICHES[key].topics, tags: NICHES[key].tags, hashtags: NICHES[key].hashtags };
      return acc;
    }, {});
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
};
