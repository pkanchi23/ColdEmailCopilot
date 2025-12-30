# Vercel Proxy Deployment Guide

This guide explains how to deploy the Anthropic API proxy to Vercel and configure your extension to use it.

## Overview

The Vercel proxy:
- Authenticates users via their Google OAuth token
- Checks if their email is whitelisted
- Proxies requests to Anthropic API using your corporate API key
- Keeps your API key secure (never exposed to clients)

---

## Prerequisites

1. **Vercel Account**: Sign up at [vercel.com](https://vercel.com) (free tier is fine)
2. **Vercel CLI**: Install with `npm install -g vercel`
3. **Anthropic API Key**: Your corporate API key

---

## Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

Login to Vercel:
```bash
vercel login
```

---

## Step 2: Configure Whitelist

Edit `/api/generate-email.js` and update the WHITELIST array with authorized emails:

```javascript
const WHITELIST = [
  'john@company.com',
  'sarah@company.com',
  'mike@company.com',
  // Add more emails here
];
```

**Important**: Emails are case-insensitive. The function will convert to lowercase before checking.

---

## Step 3: Deploy to Vercel

From the project root directory:

```bash
vercel
```

Follow the prompts:
- **Set up and deploy?** Yes
- **Which scope?** Your personal account or team
- **Link to existing project?** No
- **Project name?** cold-email-copilot (or your choice)
- **Directory?** ./ (current directory)
- **Override settings?** No

Vercel will deploy and give you a URL like:
```
https://cold-email-copilot-abc123.vercel.app
```

---

## Step 4: Set Environment Variables

After deploying, set your Anthropic API key:

```bash
vercel env add ANTHROPIC_API_KEY
```

When prompted:
- **Value?** Paste your Anthropic API key (sk-ant-api03-...)
- **Environment?** Select: Production, Preview, Development (all 3)

Verify it's set:
```bash
vercel env ls
```

---

## Step 5: Deploy Again (to apply env vars)

```bash
vercel --prod
```

This production deployment will use your API key.

---

## Step 6: Test the Endpoint

Test with curl (replace with your Vercel URL and a valid Google OAuth token):

```bash
curl -X POST https://YOUR-VERCEL-URL.vercel.app/api/generate-email \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_GOOGLE_OAUTH_TOKEN" \
  -d '{
    "model": "claude-sonnet-4-5-20250929",
    "max_tokens": 100,
    "messages": [
      {
        "role": "user",
        "content": "Say hello"
      }
    ]
  }'
```

Expected responses:
- ✅ **200 OK**: Email is whitelisted, request proxied successfully
- ❌ **401 Unauthorized**: Invalid or missing OAuth token
- ❌ **403 Forbidden**: Email not in whitelist
- ❌ **500 Internal Server Error**: API key not configured

---

## Step 7: Update Extension Configuration

You'll need to update the extension code to use your Vercel URL instead of calling Anthropic directly.

**Your Vercel API endpoint:**
```
https://YOUR-PROJECT-NAME.vercel.app/api/generate-email
```

Save this URL - you'll need it for the next step.

---

## Managing the Whitelist

### Adding Users

1. Edit `api/generate-email.js`
2. Add email to WHITELIST array
3. Deploy: `vercel --prod`
4. Changes take effect in ~30 seconds

### Removing Users

1. Edit `api/generate-email.js`
2. Remove email from WHITELIST array
3. Deploy: `vercel --prod`

### Checking Who Has Access

Open `api/generate-email.js` and view the WHITELIST array.

---

## Viewing Logs

To see who's using the API and debug issues:

```bash
vercel logs
```

Or view in the Vercel dashboard:
1. Go to [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click your project
3. Click "Logs" tab

Enable debug logging by setting environment variable:
```bash
vercel env add DEBUG
# Value: true
# Environment: Production
vercel --prod
```

---

## Security Notes

✅ **API Key Security**: Your corporate API key is stored securely in Vercel environment variables and never exposed to clients

✅ **OAuth Verification**: Every request verifies the Google OAuth token with Google's servers

✅ **CORS Protection**: Only allows requests with proper authorization headers

✅ **Whitelist Enforcement**: Checked on every request, no bypass possible

❌ **Rate Limiting**: Not implemented - consider adding if needed

❌ **Usage Tracking**: Not implemented - logs are available but not structured

---

## Troubleshooting

### "Invalid Google OAuth token"
- The token from Chrome's identity API may be expired
- Extension needs to refresh the token
- Check that the token is being sent correctly

### "Email not authorized"
- Verify the email is in the WHITELIST array
- Check for typos (case doesn't matter)
- Redeploy after adding: `vercel --prod`

### "Server not properly configured"
- ANTHROPIC_API_KEY environment variable not set
- Run: `vercel env add ANTHROPIC_API_KEY`
- Redeploy: `vercel --prod`

### "CORS error" in extension
- Vercel function should handle CORS automatically
- Check browser console for exact error
- Verify vercel.json has CORS headers configured

---

## Cost Estimates

### Vercel Free Tier Limits:
- **100GB bandwidth** per month
- **100K serverless function invocations** per month
- **100GB-hours compute time**

### Typical Usage:
- 10 users × 10 emails/day = 100 requests/day = 3,000/month
- Each request: ~2-3 seconds, ~0.5KB response
- **Estimated cost: $0** (well within free tier)

### If You Exceed Free Tier:
- Vercel Pro: $20/month (unlimited bandwidth, 1M invocations)

---

## Next Steps

After deployment, you need to:
1. Update the extension code to call your Vercel endpoint
2. Remove Anthropic API key storage from the extension
3. Update the options page UI
4. Test with a whitelisted user

These steps are covered in the extension update guide.

---

## Quick Reference

```bash
# Deploy to production
vercel --prod

# View logs
vercel logs

# List environment variables
vercel env ls

# Add environment variable
vercel env add VARIABLE_NAME

# Remove a deployment
vercel remove PROJECT_NAME
```

---

## Support

For issues:
1. Check Vercel logs: `vercel logs`
2. Enable debug mode: Set DEBUG=true environment variable
3. Test with curl to isolate extension vs proxy issues
