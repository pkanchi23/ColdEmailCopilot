// ==========================
// LOGGER UTILITY
// ==========================

/**
 * Centralized logging utility that only logs in debug mode
 */
const Logger = {
  _debugMode: false,

  async init() {
    const { debugMode = false } = await chrome.storage.local.get('debugMode');
    this._debugMode = debugMode;
  },

  log(...args) {
    if (this._debugMode) {
      console.log('[ColdEmailCopilot]', ...args);
    }
  },

  error(...args) {
    // Always log errors
    console.error('[ColdEmailCopilot Error]', ...args);
  },

  warn(...args) {
    if (this._debugMode) {
      console.warn('[ColdEmailCopilot Warning]', ...args);
    }
  },

  info(...args) {
    if (this._debugMode) {
      console.info('[ColdEmailCopilot Info]', ...args);
    }
  }
};

// ==========================
// FETCH WITH TIMEOUT
// ==========================

/**
 * Fetch wrapper with timeout support
 * @param {string} url - URL to fetch
 * @param {Object} options - Fetch options
 * @param {number} timeout - Timeout in milliseconds (default 30000)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, options = {}, timeout = 30000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout - please try again');
    }
    throw error;
  }
}

// ==========================
// RATE LIMITER
// ==========================

/**
 * Simple rate limiter for API calls
 */
class RateLimiter {
  constructor(maxCalls = 10, timeWindow = 60000) {
    this.maxCalls = maxCalls;
    this.timeWindow = timeWindow;
    this.calls = [];
  }

  async checkLimit() {
    const now = Date.now();
    // Remove calls outside time window
    this.calls = this.calls.filter(time => now - time < this.timeWindow);

    if (this.calls.length >= this.maxCalls) {
      const oldestCall = this.calls[0];
      const waitTime = this.timeWindow - (now - oldestCall);
      throw new Error(`Rate limit exceeded. Please wait ${Math.ceil(waitTime / 1000)} seconds.`);
    }

    this.calls.push(now);
  }

  reset() {
    this.calls = [];
  }
}

// ==========================
// DOM UTILITIES (XSS Safe)
// ==========================

/**
 * Safely create element with text content (prevents XSS)
 * @param {string} tag - HTML tag name
 * @param {Object} options - Element options
 * @returns {HTMLElement}
 */
function createSafeElement(tag, options = {}) {
  const element = document.createElement(tag);

  if (options.text) {
    element.textContent = options.text;
  }

  if (options.className) {
    element.className = options.className;
  }

  if (options.style) {
    Object.assign(element.style, options.style);
  }

  if (options.attributes) {
    Object.entries(options.attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
  }

  if (options.children) {
    options.children.forEach(child => element.appendChild(child));
  }

  return element;
}

/**
 * Escape HTML to prevent XSS
 * @param {string} str - String to escape
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ==========================
// ERROR HANDLER
// ==========================

/**
 * Format error messages for user display
 * @param {Error} error - Error object
 * @returns {string} User-friendly error message
 */
function formatErrorMessage(error) {
  const message = error.message || 'Unknown error occurred';

  if (message.includes('API key') || message.includes('Incorrect API key')) {
    return 'Invalid API key. Please check your settings.';
  } else if (message.includes('rate limit') || message.includes('429')) {
    return 'Rate limit exceeded. Please wait a few minutes and try again.';
  } else if (message.includes('timeout') || message.includes('ETIMEDOUT')) {
    return 'Request timed out. Please check your internet connection and try again.';
  } else if (message.includes('network') || message.includes('Failed to fetch')) {
    return 'Network error. Please check your internet connection.';
  } else if (message.includes('quota')) {
    return 'API quota exceeded. Please check your API account.';
  } else if (message.includes('model')) {
    return 'Model not available. Please check your model selection.';
  }

  return message;
}

// ==========================
// OFFLINE DETECTION
// ==========================

/**
 * Check if browser is online
 * @returns {boolean}
 */
function isOnline() {
  return navigator.onLine;
}

/**
 * Check online status and throw error if offline
 * @throws {Error} If offline
 */
function requireOnline() {
  if (!isOnline()) {
    throw new Error('No internet connection. Please check your network.');
  }
}

// ==========================
// STORAGE HELPERS
// ==========================

/**
 * Export all settings to JSON
 * @returns {Promise<Object>}
 */
async function exportSettings() {
  const settings = await chrome.storage.local.get(null);
  // Remove sensitive data
  const exportData = { ...settings };
  delete exportData.savedProfiles; // Don't export profiles
  return exportData;
}

/**
 * Import settings from JSON
 * @param {Object} settings - Settings object
 * @returns {Promise<void>}
 */
async function importSettings(settings) {
  // Validate settings object
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid settings format');
  }

  // Don't override certain keys
  const { savedProfiles, emailPatternCache } = await chrome.storage.local.get(['savedProfiles', 'emailPatternCache']);

  await chrome.storage.local.set({
    ...settings,
    savedProfiles: savedProfiles || [],
    emailPatternCache: emailPatternCache || {}
  });
}

// Make available globally if needed
if (typeof window !== 'undefined') {
  window.Logger = Logger;
  window.fetchWithTimeout = fetchWithTimeout;
  window.RateLimiter = RateLimiter;
  window.createSafeElement = createSafeElement;
  window.escapeHtml = escapeHtml;
  window.formatErrorMessage = formatErrorMessage;
  window.isOnline = isOnline;
  window.requireOnline = requireOnline;
  window.exportSettings = exportSettings;
  window.importSettings = importSettings;
}
