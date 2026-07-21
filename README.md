# AI Video Automation

Fully automated AI-powered video content creation and upload system for YouTube & TikTok.

## Features

- **AI Content Generation** - Auto-generate video scripts using Gemini/OpenAI
- **Video Rendering** - Create videos with FFmpeg (stock footage + narration)
- **Auto Upload** - Upload to YouTube & TikTok automatically
- **Smart Scheduler** - Optimal posting times based on audience analytics
- **Web Dashboard** - Control everything from your browser
- **Multi-Account** - Manage multiple YouTube/TikTok accounts
- **SEO Optimization** - Auto-optimize titles, descriptions, and tags
- **Analytics Tracking** - Monitor performance across platforms

## Tech Stack

- **Frontend**: HTML, Tailwind CSS
- **Backend**: Node.js, Express
- **Video Processing**: FFmpeg
- **AI**: Google Gemini, OpenAI
- **Stock Footage**: Pexels API
- **TTS**: ElevenLabs API
- **Deployment**: Vercel (dashboard) + Local (video rendering)

## Quick Start

### Local Development

```bash
# Clone repository
git clone https://github.com/yourusername/ai-video-automation.git
cd ai-video-automation

# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your API keys
nano .env

# Start server
npm run local
```

Open http://localhost:3001 in your browser.

### Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

## Environment Variables

| Variable | Description | Get From |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key | https://platform.openai.com/api-keys |
| `GEMINI_API_KEY` | Google Gemini API key | https://aistudio.google.com/apikey |
| `PEXELS_API_KEY` | Pexels stock footage API | https://www.pexels.com/api/ |
| `ELEVENLABS_API_KEY` | ElevenLabs TTS API | https://elevenlabs.io |
| `GOOGLE_CLIENT_ID` | YouTube OAuth client ID | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | YouTube OAuth client secret | Google Cloud Console |
| `YOUTUBE_REFRESH_TOKEN` | YouTube OAuth refresh token | OAuth flow |
| `TIKTOK_ACCESS_TOKEN` | TikTok API access token | TikTok Developer Portal |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/data` | Get all videos and stats |
| POST | `/api/data` | Generate new video content |
| GET | `/api/video/:id` | Download video file |

## Project Structure

```
ai-video-automation/
├── api/                    # Vercel serverless functions
│   ├── data/index.js       # Main API endpoint
│   ├── generate/index.js   # Content generation
│   └── tiktok/index.js     # TikTok OAuth callback
├── public/                 # Static files (dashboard)
│   └── index.html          # Dashboard UI
├── src/                    # TypeScript source (advanced features)
│   ├── ai/                 # AI content generation
│   ├── video/              # Video processing
│   ├── platforms/          # YouTube & TikTok uploaders
│   ├── scheduler/          # Smart scheduling
│   └── dashboard/          # Web dashboard
├── server.js               # Local Express server
├── package.json            # Dependencies
└── vercel.json             # Vercel config
```

## How It Works

1. **Content Generation** - AI generates video script with scenes and narration
2. **Asset Fetching** - Stock footage from Pexels, TTS from ElevenLabs
3. **Video Rendering** - FFmpeg combines footage + narration + effects
4. **Upload** - Auto-upload to YouTube & TikTok via API
5. **Analytics** - Track views, likes, and performance

## Dashboard Preview

![Dashboard](https://via.placeholder.com/800x400?text=AI+Video+Automation+Dashboard)

## Limitations

- Free tier API limits apply (Pexels: 200 req/hr, ElevenLabs: 10K chars/month)
- Video rendering requires FFmpeg installed locally
- YouTube API: 6 uploads/day limit
- TikTok: Sandbox mode limits

## License

MIT

## Author

Rivaldy - [GitHub](https://github.com/yourusername)
