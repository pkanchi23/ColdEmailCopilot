# Chrome Web Store Publication Guide 🚀

Congratulations on building **ColdEmailCopilot**! Follow these steps to publish your extension to the Chrome Web Store.

## 📦 Step 1: Prepare Your Package

I have already created the ZIP file for you:
`ColdEmailCopilot-v1.0.0.zip`

This package includes all necessary files (`manifest.json`, `background.js`, icons, etc.) and excludes development files (API code, env vars, git files).

---

## 📝 Step 2: Prepare Your Listing Assets

Before starting the upload, make sure you have:

1. **Screenshots** (Required):
   - Take at least **1 screenshot** (Recommended: 3-5).
   - Size: **1280x800** or **640x400** pixels.
   - *Tip: Show the extension open on a LinkedIn profile.*

2. **Description**:
   - **Short Description**: `AI-powered cold email generation from LinkedIn. Personalized outreach with GPT-4 and Claude.`
   - **Detailed Description**: Copy the text from `README.md`.

3. **Privacy Policy URL**:
   - You need to host `PRIVACY.md` publicly.
   - **Easiest method**: Create a public GitHub Gist or Repo with just `PRIVACY.md` and use that raw URL.
   - *Example*: `https://raw.githubusercontent.com/yourname/ColdEmailCopilot/main/PRIVACY.md`

---

## 🚀 Step 3: Upload to Chrome Web Store

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Sign in with your Google Account.
3. Click the **+ New Item** button.
4. Upload `ColdEmailCopilot-v1.0.0.zip`.

---

### **Testing Instructions (Copy & Paste)**
When asked for "Test instructions" or "Test account credentials", paste the following:

> **Authentication:**
> This extension uses Google OAuth. Please sign in with **any valid Google account**. User accounts are automatically provisioned on the Free Tier, so no specific test credentials or passwords are required.
>
> **How to Test Core Functionality:**
> 1. Sign in to the extension with your Google account.
> 2. Navigate to any public LinkedIn profile (e.g., https://www.linkedin.com/in/satyanadella).
> 3. You will see a "Cold Email Copilot" entrypoint (or open the extension popup).
> 4. Click the "Generate" button.
> 5. The extension will read the profile data and generate a personalized cold email using AI.

### **Store Listing Tab**
- **Description**: Paste your detailed description.
- **Graphic Assets**: Upload your icons and screenshots.
  - *Note: You only need the 128x128 icon here, store takes care of the rest.*
- **Category**: Select **Productivity** -> **Workflow & Planning**.
- **Language**: English.

### **Privacy Tab**
- **Privacy Policy**: Paste your public URL (from Step 2).
- **Permissions**:
  - You will be asked to justify permissions.
  - `activeTab`: "To read the LinkedIn profile content when the user clicks the extension."
  - `storage`: "To save user preferences and cached templates."
  - `identity`: "For Google Sign-In authentication."
  - `scripting`: "To insert the email generation button into the LinkedIn page."

### **Host Permissions Justification**
You may be asked to justify specific host patterns:

- `*://*.linkedin.com/*`:
  > "Required to read the candidate's profile information (name, experience, about section) to generate personalized cold emails."

- `*://*.vercel.app/*`:
  > "Required to communicate with the extension's backend API for processing email generation requests."

- `*://api.openai.com/*` and `*://api.anthropic.com/*`:
  > "Required to allow users to use their own personal API keys to connect directly to AI providers, bypassing the extension's default backend."

### **Common policy questions**

1.  **"Do you use remote code?"** -> **NO**.
    *   *Reason*: Your extension fetches *data* (JSON) from an API, but all executable JavaScript is bundled locally in the package. You do not use `eval()` or remote scripts.

2.  **"Does your extension contain a single purpose?"** -> **YES**.
    *   *Purpose*: "To help users write cold emails on LinkedIn using AI."

3.  **"Test Account Credentials?"**
    *   Since you use Google OAuth, you cannot give them a password.
    *   **Write this**: *"This extension uses Google OAuth. Please sign in with any valid Google account to test the functionality. No specific test credentials are required."*
    *   *Important*: Ensure your Google Cloud Console OAuth Consent Screen is set to **"Production"** (not "Testing"), otherwise their reviewers won't be able to sign in!

---

## 🔐 Step 5: Submit for Review

1. Click **Submit for Review** in the top right.
2. Google usually takes **1-3 business days** to review.
3. Once approved, you will receive an email and your extension will be live!

---

## ⚠️ Important Notes

- **OAuth Verification**: Since you use `identity` and sensitive scopes (`gmail.compose`), Google *might* ask for a video verification or restrict the number of users until verified. This is normal.
- **Updates**: To update the extension later, increment the `version` in `manifest.json` (e.g. `1.0.1`), create a new ZIP, and upload it to the dashboard.
