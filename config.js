/**
 * Extension Configuration
 *
 * IMPORTANT: After deploying to Vercel, update VERCEL_API_URL with your deployment URL
 */

const CONFIG = {
  // Your Vercel deployment URL
  // Example: 'https://cold-email-copilot-abc123.vercel.app'
  // After deploying, replace this with your actual Vercel URL
  VERCEL_API_URL: 'https://cold-email-copilot.vercel.app',

  // API endpoint path (don't change this)
  API_ENDPOINT: '/api/generate-email',

  // Get full API URL
  getApiUrl() {
    if (this.VERCEL_API_URL === 'YOUR_VERCEL_URL_HERE') {
      throw new Error(
        'Vercel API URL not configured. Please update config.js with your Vercel deployment URL. ' +
        'See VERCEL_DEPLOYMENT.md for instructions.'
      );
    }
    return `${this.VERCEL_API_URL}${this.API_ENDPOINT}`;
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.CONFIG = CONFIG;
}
