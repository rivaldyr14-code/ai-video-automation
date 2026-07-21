# 🔑 API Keys Setup Guide

## YouTube (Google OAuth)

### Step 1: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a Project" → "New Project"
3. Name it "AI Video Automation"
4. Click "Create"

### Step 2: Enable YouTube API
1. Go to "APIs & Services" → "Library"
2. Search "YouTube Data API v3"
3. Click "Enable"

### Step 3: Create OAuth Credentials
1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select "Web application"
4. Name: "AI Video Automation"
5. Add Authorized redirect URI: `http://localhost:3001/youtube/callback`
6. Click "Create"
7. Copy **Client ID** and **Client Secret**

### Step 4: Setup in App
```bash
npm run auth
# Select YouTube
# Paste Client ID and Secret
# Open URL in browser
# Login & grant permissions
# Copy authorization code
```

---

## TikTok

### Step 1: Register Developer Account
1. Go to [TikTok Developers](https://developers.tiktok.com/)
2. Sign up / Login
3. Click "Manage apps" → "Create app"

### Step 2: Create App
1. App Name: "AI Video Automation"
2. Description: "Automated video upload"
3. Category: "Utility" or "Other"
4. Click "Register"

### Step 3: Get Credentials
1. Go to your app settings
2. Copy **Client Key** and **Client Secret**
3. Add Redirect URI: `http://localhost:3001/tiktok/callback`

### Step 4: Request Permissions
1. Go to "Permissions" tab
2. Request these scopes:
   - `user.info.basic`
   - `video.upload`
   - `video.publish`
3. Wait for approval (may take 1-3 days)

### Step 5: Setup in App
```bash
npm run auth
# Select TikTok
# Paste Client Key and Secret
# Open URL in browser
# Login & grant permissions
# Copy authorization code from redirect URL
```

---

## OpenAI

1. Go to [OpenAI Platform](https://platform.openai.com/)
2. Sign up / Login
3. Go to "API Keys"
4. Click "Create new secret key"
5. Copy the key
6. Add to `.env`: `OPENAI_API_KEY=sk-...`

---

## Pexels (Stock Footage)

1. Go to [Pexels API](https://www.pexels.com/api/)
2. Click "Your API Key"
3. Sign up / Login
4. Copy API Key
5. Add to `.env`: `PEXELS_API_KEY=...`

---

## ElevenLabs (Text-to-Speech)

1. Go to [ElevenLabs](https://elevenlabs.io/)
2. Sign up / Login
3. Go to "Profile" → "API Key"
4. Copy API Key
5. Choose a Voice ID from Voice Library
6. Add to `.env`:
   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...
   ```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy env file
copy .env.example .env

# 3. Setup authentication
npm run auth

# 4. Start automation
npm run auto
```
