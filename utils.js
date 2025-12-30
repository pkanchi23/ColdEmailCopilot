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

// ==========================
// LOADING STATE UTILITIES
// ==========================

/**
 * Create and show a loading spinner
 * @param {HTMLElement} container - Container element
 * @param {string} message - Loading message
 * @returns {Function} Cleanup function to remove loader
 */
function showLoading(container, message = 'Loading...') {
  const loader = createSafeElement('div', { className: 'loader-container' });

  const spinner = createSafeElement('div', { className: 'spinner' });
  const messageEl = createSafeElement('p', { text: message, className: 'loader-message' });

  loader.appendChild(spinner);
  loader.appendChild(messageEl);
  container.appendChild(loader);

  // Return cleanup function
  return () => {
    if (loader.parentNode) {
      loader.remove();
    }
  };
}

/**
 * Set button loading state
 * @param {HTMLButtonElement} button - Button element
 * @param {boolean} loading - Loading state
 * @param {string} loadingText - Text to show while loading
 */
function setButtonLoading(button, loading, loadingText = 'Loading...') {
  if (loading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.classList.add('loading');
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.classList.remove('loading');
    button.textContent = button.dataset.originalText || button.textContent;
    delete button.dataset.originalText;
  }
}

// ==========================
// TOKEN COUNTING
// ==========================

/**
 * Estimate token count for text (rough approximation)
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  if (!text) return 0;
  // Rough approximation: 1 token ≈ 4 characters for English
  // More accurate would use tiktoken library, but this is sufficient
  return Math.ceil(text.length / 4);
}

/**
 * Truncate profile data to fit within token limit
 * @param {Object} profileData - LinkedIn profile data
 * @param {number} maxTokens - Maximum tokens allowed
 * @returns {Object} Truncated profile data
 */
function truncateToTokenLimit(profileData, maxTokens = 3000) {
  let data = { ...profileData };
  let estimated = estimateTokens(JSON.stringify(data));

  if (estimated <= maxTokens) {
    return data;
  }

  Logger.warn(`Profile data exceeds ${maxTokens} tokens (${estimated}). Truncating...`);

  // Truncate in priority order (keep most important, truncate least important)
  const truncationSteps = [
    () => {
      // 1. Limit skills to top 20
      if (data.skills && data.skills.length > 20) {
        data.skills = data.skills.slice(0, 20);
      }
    },
    () => {
      // 2. Truncate recommendations
      if (data.recommendations && data.recommendations.length > 500) {
        data.recommendations = data.recommendations.slice(0, 500) + '...';
      }
    },
    () => {
      // 3. Limit experience to 1500 chars
      if (data.experience && data.experience.length > 1500) {
        data.experience = data.experience.slice(0, 1500) + '...';
      }
    },
    () => {
      // 4. Limit education to 800 chars
      if (data.education && data.education.length > 800) {
        data.education = data.education.slice(0, 800) + '...';
      }
    },
    () => {
      // 5. Remove recent activity
      delete data.recentActivity;
    },
    () => {
      // 6. Remove publications
      delete data.publications;
    },
    () => {
      // 7. Remove patents
      delete data.patents;
    },
    () => {
      // 8. Limit about to 300 chars
      if (data.about && data.about.length > 300) {
        data.about = data.about.slice(0, 300) + '...';
      }
    }
  ];

  for (const step of truncationSteps) {
    step();
    estimated = estimateTokens(JSON.stringify(data));
    if (estimated <= maxTokens) {
      Logger.log(`Truncated to ${estimated} tokens`);
      return data;
    }
  }

  Logger.warn(`Could not truncate below ${maxTokens} tokens. Final: ${estimated}`);
  return data;
}

// ==========================
// EMAIL VALIDATION
// ==========================

/**
 * Validate email address format
 * @param {string} email - Email address to validate
 * @returns {boolean} True if valid
 */
function validateEmail(email) {
  if (!email) return false;
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
  return emailRegex.test(email);
}

/**
 * Sanitize name for email address (remove diacritics, special chars)
 * @param {string} name - Name to sanitize
 * @returns {string} Sanitized name
 */
function sanitizeForEmail(name) {
  if (!name) return '';

  return name
    .normalize('NFD') // Decompose combined characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (é → e)
    .replace(/[^a-z\s-]/gi, '') // Keep only letters, spaces, hyphens
    .trim()
    .toLowerCase();
}

/**
 * Validate domain exists (basic check)
 * @param {string} domain - Domain to check
 * @returns {boolean} True if domain looks valid
 */
function isValidDomain(domain) {
  if (!domain) return false;

  // Basic validation
  const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/i;

  return domainRegex.test(domain);
}

/**
 * Check if email prediction looks valid
 * @param {string} email - Predicted email
 * @param {string} name - Person's name (for validation)
 * @returns {Object} { valid: boolean, reason: string }
 */
function validateEmailPrediction(email, name) {
  if (!email) {
    return { valid: false, reason: 'Email is empty' };
  }

  if (!validateEmail(email)) {
    return { valid: false, reason: 'Invalid email format' };
  }

  const [localPart, domain] = email.split('@');

  // Check if local part is suspiciously short or generic
  if (localPart.length < 2) {
    return { valid: false, reason: 'Email local part too short' };
  }

  // Check if domain is valid
  if (!isValidDomain(domain)) {
    return { valid: false, reason: 'Invalid email domain' };
  }

  // Check if local part contains any part of the person's name
  if (name) {
    const sanitizedName = sanitizeForEmail(name);
    const nameParts = sanitizedName.split(/\s+/);
    const hasNamePart = nameParts.some(part =>
      part.length > 2 && localPart.includes(part)
    );

    if (!hasNamePart) {
      return { valid: false, reason: 'Email does not appear to match the person\'s name' };
    }
  }

  return { valid: true, reason: '' };
}

// ==========================
// PROFILE STALENESS
// ==========================

/**
 * Check if a saved profile is stale
 * @param {Object} profile - Saved profile with savedAt timestamp
 * @returns {Object} { stale: boolean, monthsOld: number, message: string }
 */
function checkProfileStaleness(profile) {
  if (!profile.savedAt) {
    return {
      stale: true,
      monthsOld: 0,
      message: 'Unknown save date',
      severity: 'warning'
    };
  }

  const monthsOld = (Date.now() - profile.savedAt) / (1000 * 60 * 60 * 24 * 30);

  if (monthsOld > 12) {
    return {
      stale: true,
      monthsOld: Math.floor(monthsOld),
      message: `Profile is ${Math.floor(monthsOld)} months old. Likely outdated.`,
      severity: 'error',
      action: 'Refresh strongly recommended'
    };
  } else if (monthsOld > 6) {
    return {
      stale: true,
      monthsOld: Math.floor(monthsOld),
      message: `Profile is ${Math.floor(monthsOld)} months old. May be outdated.`,
      severity: 'warning',
      action: 'Consider refreshing'
    };
  } else if (monthsOld > 3) {
    return {
      stale: false,
      monthsOld: Math.floor(monthsOld),
      message: `Profile is ${Math.floor(monthsOld)} months old.`,
      severity: 'info',
      action: null
    };
  }

  return {
    stale: false,
    monthsOld: Math.floor(monthsOld),
    message: 'Profile is recent',
    severity: 'success',
    action: null
  };
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
  window.showLoading = showLoading;
  window.setButtonLoading = setButtonLoading;
  window.estimateTokens = estimateTokens;
  window.truncateToTokenLimit = truncateToTokenLimit;
  window.validateEmail = validateEmail;
  window.sanitizeForEmail = sanitizeForEmail;
  window.isValidDomain = isValidDomain;
  window.validateEmailPrediction = validateEmailPrediction;
  window.checkProfileStaleness = checkProfileStaleness;
}
