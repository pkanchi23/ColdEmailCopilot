# Cold Email Copilot - User Guide

This guide will help you set up Cold Email Copilot from scratch. No coding knowledge is required!

## 1. Download the Extension
1.  Click the likely green **"Code"** button on the GitHub page.
2.  Select **"Download ZIP"**.
3.  Once downloaded, unzip the file (double-click `ColdEmailCopilot-main.zip`).
4.  Remember where this folder is (e.g., in your `Downloads` or `Desktop` folder).

## 2. Install the Extension in Chrome
1.  Open Google Chrome or any chromium based browser.
2.  In the address bar, type `chrome://extensions` and press Enter.
3.  In the top right corner, **enable "Developer mode"** (toggle the switch to ON).
4.  Click the button that says **"Load unpacked"**.
5.  Navigate to and select the **folder** you just unzipped (select the folder itself, not the files inside).
6.  The extension should now appear in your list with the name "Cold Email Copilot".

## 3. Configure Your "About Me" (Context)
This step is crucial so the AI knows who *you* are.

1.  Click the extension icon (puzzle piece) in Chrome and select **Cold Email Copilot**.
2.  In the popup, click the **Settings** (gear icon) button on the top right.
    *   *Alternatively, find the extension in `chrome://extensions` and click "Details" -> "Extension options".*
3.  Scroll to the **"Your Sender Context"** section.
4.  **Paste your details here:**
    *   Add your Resume or LinkedIn summary. Click on the "Looking to set this up? Click here!" hyperlink for instructions on how to best set this up.
    *   *Tip:* The more detail you provide, the better the AI can connect your background to the recipient.
5.  Click **"Save Settings"**.

## 4. Add Your API Keys
You need an "API Key" to let the AI "brain" (OpenAI or Anthropic) work. Click save settings

1.  In the same **Settings** page, scroll to the bottom.
2.  **Get an API Key:**
    *   **Option A (Recommended):** Use **Claude (Anthropic)**. Go to [console.anthropic.com](https://console.anthropic.com), create an account, adds credits ($5 is plenty), and create a new API Key.
    *   **Option B:** Use **OpenAI (GPT)**. Go to [platform.openai.com](https://platform.openai.com), create an account, add credits, and create a new API Key.
3.  Copy the key string (it starts with `sk-...`).
4.  Paste it into the corresponding box in the extension settings.
5.  Click **"Save Settings"**.
    *   *Note: Select your preferred model (e.g., "Claude 4.5 Sonnet") in the Model dropdown.*

## 5. Connect Your Gmail (One-Time Setup)
1.  Go to a LinkedIn profile of someone you want to email.
2.  Click the **"Draft Email"** button that appears on the right side of the page.
3.  **Google Sign-In Warning:**
    *   A popup will appear asking you to sign in with Google.
    *   Since this is a private app you installed yourself, Google will show a warning: *"Google hasn't verified this app"*.
    *   Click **"Advanced"**.
    *   Click **"Go to Cold Email Copilot (unsafe)"** (don't worry, it's safe—it's running locally on your own machine!).
    *   Allow the permissions (to manage drafts).
4.  Once authorized, your draft email will automatically pop up in a new Gmail tab!

**You are now ready to generate emails!** 🚀
