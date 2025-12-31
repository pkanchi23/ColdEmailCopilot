# ColdEmailCopilot 📧

AI-powered cold email generation from LinkedIn profiles. Craft personalized outreach emails with ChatGPT and Claude in seconds.

## ✨ Features

- **🤖 AI-Powered**: Choose between GPT-4 or Claude for email generation
- **🎯 Highly Personalized**: Analyzes LinkedIn profiles for unique talking points
- **⚡ One-Click Generation**: Click a button on any LinkedIn profile
- **💾 Smart Caching**: Saves profiles and templates for faster generation
- **🎨 Customizable**: Set your tone, style, and custom instructions
- **📊 Usage Tracking**: Monitor your AI spending and email count

## 🚀 Installation

### From Chrome Web Store (Recommended)
1. Visit the [Chrome Web Store page](#) (link coming soon)
2. Click "Add to Chrome"
3. Follow the setup wizard

### Manual Installation (Development)
1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the extension folder

## 📖 How to Use

### Initial Setup

1. **Sign In with Google**
   - Click the extension icon
   - Click "Sign In with Google"
   - Authorize the extension

2. **Configure Settings** (Optional)
   - Click the extension icon → "Options"
   - Choose your AI model (GPT-4 or Claude)
   - Set your preferred tone
   - Add your "About Me" context for better personalization

### Generating Emails

1. **Navigate to any LinkedIn profile**
2. **Click the "Generate Cold Email" button** (appears automatically)
3. **Wait 5-10 seconds** for AI generation
4. **Review the email** in the popup
5. **Copy to Gmail** or edit manually

### Advanced Features

- **Custom Templates**: Save email templates for different scenarios
- **Profile Cache**: Save frequently contacted profiles
- **Resume Upload**: Auto-generate your "About Me" from your resume
- **Finance Mode**: Special formatting for finance/recruiting outreach

## 🔑 API Keys (Optional)

By default, the extension uses a shared backend. For unlimited usage, you can use your own API keys:

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys) or [Anthropic](https://console.anthropic.com/)
2. Go to Options → "Settings"
3. Enter your API key
4. Select "Use My Key" in the model dropdown

**Note:** Using your own key bypasses spending limits.

## 📊 Pricing & Limits

| Plan | Email Limit | Monthly Cost |
|---|---|---|
| **Free** | ~200 emails | $0 |
| **Paid** | ~1,000 emails | Contact for pricing |
| **Developer** | ~2,000 emails | Contact for pricing |

Limits are based on AI token usage, not strict email counts.

## 🔒 Privacy & Security

- **Your data is private**: LinkedIn data is only used for email generation
- **No tracking**: We don't track your browsing activity
- **Encrypted**: All data is encrypted in transit and at rest
- **Google OAuth**: Secure authentication, no passwords stored

Read our full [Privacy Policy](PRIVACY.md).

## 🛠️ Troubleshooting

### "Not Authorized" Error
- Make sure you're signed in with Google
- Contact admin to be added to the whitelist

### Email Not Generating
- Check your internet connection
- Make sure you're on a LinkedIn profile page
- Try refreshing the page

### "Spend Limit Reached"
- You've hit your tier's monthly limit
- Upgrade your plan or wait until next month
- Alternatively, use your own API key

## 🤝 Support

- **Issues**: Email pranavkanchi23@gmail.com
- **Website**: https://cold-email-copilot.vercel.app
- **Feature Requests**: Contact via email

## 📄 License

Proprietary - All Rights Reserved

## 🙏 Acknowledgments

Built with:
- OpenAI GPT-4
- Anthropic Claude
- Vercel & Neon Postgres
- Chrome Extensions API

---

Made with ❤️ by Pranav Kanchi
