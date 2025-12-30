# ColdEmailCopilot Setup Guide (Whitelist-Based Authentication)

This guide explains how to set up and use ColdEmailCopilot with the new account-based authentication system.

---

## For Administrators

### Overview

The extension now uses a centralized Vercel proxy for Claude/Anthropic API calls. This means:
- ✅ Your corporate Anthropic API key stays secure on the server
- ✅ You control who can use the extension via a whitelist
- ✅ No more sharing API keys with team members
- ✅ Easier to track usage and manage costs

### Setup Steps

#### 1. Deploy the Vercel Proxy

Follow the instructions in **[VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md)** to:
1. Deploy the serverless function to Vercel
2. Set your corporate Anthropic API key as an environment variable
3. Configure the whitelist with authorized email addresses

#### 2. Configure the Extension

After deploying to Vercel, you'll get a URL like:
```
https://your-project-name.vercel.app
```

Edit `config.js` and update the `VERCEL_API_URL`:

```javascript
const CONFIG = {
  VERCEL_API_URL: 'https://your-project-name.vercel.app',
  // ...
};
```

#### 3. Distribute to Your Team

1. **Package the extension:**
   - Update `config.js` with your Vercel URL
   - Zip the entire extension directory
   - Share with your team

2. **Team members install:**
   - Extract the zip file
   - Open Chrome → Extensions → Enable "Developer mode"
   - Click "Load unpacked" → Select the extension folder
   - Done! No API key configuration needed

#### 4. Manage the Whitelist

**Add users:**
1. Edit `api/generate-email.js`
2. Add their Gmail address to the WHITELIST array
3. Deploy: `vercel --prod`
4. Changes take effect in ~30 seconds

**Remove users:**
1. Edit `api/generate-email.js`
2. Remove their email from the WHITELIST array
3. Deploy: `vercel --prod`

---

## For Users

### Getting Started

#### 1. Install the Extension

Your administrator should provide you with the extension files. To install:

1. Extract the extension files to a folder
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the extension folder
6. The ColdEmailCopilot icon should appear in your extensions

#### 2. Configure Your Settings

1. Click the extension icon or right-click → **Options**
2. Fill in your settings:
   - **About Me / Value Proposition**: Describe yourself and what you do (this helps the AI write personalized emails)
   - **Email Tone**: Choose your preferred tone (Casual & Friendly, Professional, etc.)
   - **AI Model**: Select Claude 4.5 Sonnet (recommended)
3. Click **Save Settings**

**Note:** You don't need to enter an API key for Claude models - authentication is handled automatically via your Gmail account.

#### 3. Check Authentication Status

In the Options page, you'll see an **Authentication Status** section showing:
- Your Gmail account (populated after first use)
- Access status (whether you're whitelisted)

#### 4. Using the Extension

1. **Navigate to a LinkedIn profile**
2. **Click the "Cold Email" button** that appears on the profile
3. **Sign in with Google** (first time only):
   - You'll be prompted to authorize Gmail access
   - This lets the extension create email drafts
   - Also used for whitelist authentication
4. **Wait for generation** (5-10 seconds)
5. **Review and send** the email in Gmail

---

## Authentication Flow

### How It Works

```
1. You click "Generate Email"
   ↓
2. Extension gets your Gmail OAuth token
   ↓
3. Sends request to Vercel proxy with your token
   ↓
4. Vercel verifies your Google account
   ↓
5. Checks if your email is whitelisted
   ↓
6. If authorized: Forwards request to Anthropic
   ↓
7. Returns generated email to extension
```

### What Gmail Access Is Used For

The extension requests `gmail.compose` permission to:
- ✅ Create draft emails (so you can review before sending)
- ✅ Authenticate your identity for whitelist checking

**We do NOT:**
- ❌ Read your existing emails
- ❌ Send emails without your review
- ❌ Access any other Gmail data

---

## Troubleshooting

### "Your email is not authorized"

**Problem:** Your Gmail account is not on the whitelist.

**Solution:**
1. Contact your administrator
2. Provide them with your Gmail address
3. They'll add you to the whitelist and redeploy
4. Try again after ~30 seconds

---

### "Authentication failed. Please sign in to Gmail again"

**Problem:** Your Gmail OAuth token has expired.

**Solution:**
1. Go to extension Options
2. You'll be prompted to re-authenticate when you next generate an email
3. Alternatively, clear the extension storage:
   - Go to `chrome://extensions/`
   - Find ColdEmailCopilot
   - Click "Details" → "Clear storage data"
   - Try generating an email again

---

### "Server error: Server is not properly configured"

**Problem:** The Vercel proxy doesn't have the Anthropic API key configured.

**Solution:** Contact your administrator - they need to set the `ANTHROPIC_API_KEY` environment variable in Vercel.

---

### "Failed to generate email: Network error"

**Problem:** Cannot reach the Vercel proxy.

**Solutions:**
1. **Check your internet connection**
2. **Verify the Vercel URL** in `config.js` is correct
3. **Check Vercel status**: The proxy might be down
4. **Contact your administrator** if the problem persists

---

### Email generation is slow

**Causes:**
- Large LinkedIn profiles (lots of experience/skills)
- Anthropic API response time
- Vercel cold start (first request after inactivity)

**Normal:** 5-10 seconds
**Slow:** 15-20 seconds (acceptable for first request)
**Too slow:** 30+ seconds (check network/Vercel logs)

---

## FAQs

### Do I need my own API key?

**For Claude models:** No! Authentication is handled via the Vercel proxy using your Gmail account.

**For GPT models (OpenAI):** Yes, you'll need to provide your own OpenAI API key in the extension options.

### Why do I need to sign in with Google?

Two reasons:
1. To authenticate your identity and check the whitelist
2. To create Gmail drafts with the generated email

### Is my data secure?

Yes:
- Your Gmail OAuth token is only used to verify your identity
- LinkedIn profile data is sent to Anthropic to generate the email
- No personal data is stored on the Vercel proxy
- The corporate API key is never exposed to clients

### Can I use this on multiple computers?

Yes! Install the extension on each computer. You'll need to:
1. Install the extension files
2. Configure your "About Me" settings on each computer
3. Sign in with Google (first time on each computer)

### How many emails can I generate?

There are no hard limits per user. However:
- The proxy has rate limiting (10 requests/minute)
- Usage is tracked in Vercel logs
- Your administrator may implement usage quotas in the future

### Can I use this offline?

No, the extension requires:
- Internet connection
- Access to LinkedIn
- Access to the Vercel proxy
- Access to Anthropic API (via proxy)

---

## Advanced Configuration

### Using GPT Models

If you prefer OpenAI's GPT models:

1. Get an OpenAI API key from [platform.openai.com](https://platform.openai.com/)
2. Go to extension Options
3. Enter your API key in "OpenAI API Key"
4. Select a GPT model from the dropdown
5. Save settings

Note: GPT models bypass the Vercel proxy and use your personal API key.

### Custom AI Models

If you have access to custom models:

1. Go to extension Options
2. Select "Custom" from the AI Model dropdown
3. Enter your model name (e.g., `claude-opus-4-5`)
4. Ensure the model is supported by the Vercel proxy
5. Save settings

---

## Support

### For Users

If you encounter issues:
1. Check this troubleshooting guide
2. Try clearing extension storage and re-authenticating
3. Contact your administrator

### For Administrators

If you encounter issues:
1. Check Vercel function logs: `vercel logs`
2. Enable debug mode: Set `DEBUG=true` in Vercel environment variables
3. Test the endpoint directly with curl (see VERCEL_DEPLOYMENT.md)
4. Check the whitelist in `api/generate-email.js`

---

## Privacy & Data Usage

### What Data Is Collected?

**Sent to Vercel Proxy:**
- Your Gmail OAuth token (for authentication)
- LinkedIn profile data (for email generation)
- AI model request (for Anthropic API)

**Stored by Vercel:**
- Function logs (includes timestamps, success/failure)
- Optional: Usage logs (if enabled by administrator)

**Stored Locally:**
- Your extension settings (About Me, tone, etc.)
- Cached Gmail OAuth token (expires after ~1 hour)
- Cached generated emails (for template library)

### What Data Is NOT Collected

- ❌ Your Gmail messages
- ❌ LinkedIn browsing history
- ❌ Personal information beyond what you provide
- ❌ API keys (stored locally, not sent to Vercel)

---

## Updates & Changelog

### Version with Whitelist Authentication

**New:**
- Account-based authentication via Gmail
- Centralized Anthropic API proxy
- Whitelist management
- Authentication status in Options

**Removed:**
- Anthropic API key field (no longer needed)
- Direct API calls to Anthropic

**Changed:**
- OpenAI API key now optional (only for GPT models)
- Authentication flow uses Gmail OAuth

---

## Getting Help

- **Technical issues:** Contact your administrator
- **Whitelist access:** Contact your administrator
- **Extension bugs:** Check GitHub issues or create a new one
- **Feature requests:** Contact your administrator or create a GitHub issue

---

**Enjoy using ColdEmailCopilot!** 🚀
