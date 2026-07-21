let videos = [];

function addVideo(video) {
  videos.push(video);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const today = new Date().toISOString().split('T')[0];

    const stats = {
      totalVideos: videos.length,
      uploadedVideos: videos.filter(v => v.status === 'uploaded').length,
      scheduledVideos: videos.filter(v => v.status === 'scheduled').length,
      failedVideos: videos.filter(v => v.status === 'failed').length,
      totalViews: videos.reduce((sum, v) => sum + (v.views || 0), 0),
      totalLikes: videos.reduce((sum, v) => sum + (v.likes || 0), 0),
      recentVideos: videos.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 10),
      activeAccounts: 0,
      todayUploads: videos.filter(v => v.uploaded_at && v.uploaded_at.startsWith(today)).length,
    };

    return res.status(200).json(stats);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
