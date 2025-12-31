/**
 * Initialize logger
 */
(async () => {
  await Logger.init();
})();

/**
 * Apply or remove dark mode class
 * @param {boolean} enabled - Whether dark mode is enabled
 */
function applyDarkMode(enabled) {
  if (enabled) {
    document.body.classList.add('dark-mode');
  } else {
    document.body.classList.remove('dark-mode');
  }
}

/**
 * Saves options to chrome.storage
 */
const saveOptions = () => {
  const userContext = document.getElementById('userContext').value;
  const modelSelect = document.getElementById('model').value;
  const customModel = document.getElementById('customModel').value;
  const model = modelSelect === 'custom' ? customModel : modelSelect;
  const tone = document.getElementById('tone').value;
  const exampleEmail = document.getElementById('exampleEmail').value;
  const generalInstructions = document.getElementById('generalInstructions').value;
  const financeRecruitingMode = document.getElementById('financeRecruitingMode').checked;
  const debugMode = document.getElementById('debugMode').checked;
  const webGrounding = document.getElementById('webGrounding').checked;
  const darkMode = document.getElementById('darkMode').checked;
  const webhookUrl = document.getElementById('webhookUrl').value;

  // No local API key needed for Claude (handled by Vercel proxy)

  // Validate webhook URL if provided
  if (webhookUrl && !isValidUrl(webhookUrl)) {
    showStatus('Invalid webhook URL format.', 'error');
    return;
  }

  chrome.storage.local.set(
    {
      userContext: userContext,
      model: model,
      tone: tone,
      exampleEmail: exampleEmail,
      generalInstructions: generalInstructions,
      financeRecruitingMode: financeRecruitingMode,
      debugMode: debugMode,
      webGrounding: webGrounding,
      darkMode: darkMode,
      webhookUrl: webhookUrl
    },
    async () => {
      // Reinitialize logger with new debug mode
      Logger.init();
      // Apply dark mode
      applyDarkMode(darkMode);

      // --- Cloud Sync ---
      // Only sync if already logged in, don't trigger OAuth from here
      try {
        const { gmailToken } = await chrome.storage.local.get('gmailToken');

        // If no token, save locally only (silently)
        if (!gmailToken) {
          showStatus('Settings saved.', 'success');
          return;
        }

        if (gmailToken) {
          const updateUrl = `${CONFIG.VERCEL_API_URL}/api/update-settings`;

          const response = await fetch(updateUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${gmailToken}`
            },
            body: JSON.stringify({
              userContext,
              exampleEmail,
              generalInstructions,
              tone,
              model
            })
          });

          if (!response.ok) {
            const errData = await response.json();
            console.error('Cloud sync failed:', errData);
            showStatus('Saved locally, but cloud sync failed: ' + (errData.message || 'Unknown error'), 'error');
          } else {
            showStatus('Settings saved and synced to cloud!', 'success');
          }
        } else {
          showStatus('Settings saved locally. Sign in to sync.', 'success');
        }
      } catch (e) {
        console.error('Cloud sync error:', e);
        showStatus('Saved locally. Cloud sync offline.', 'warning');
      }
    }
  );
};

/**
 * Validate URL format
 */
function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

/**
 * Check and display authentication status
 */
const checkAuthStatus = async () => {
  try {
    // Check if user has a cached Gmail token
    const { gmailToken, gmailTokenExpiry } = await chrome.storage.local.get(['gmailToken', 'gmailTokenExpiry']);

    if (gmailToken && gmailTokenExpiry && Date.now() < gmailTokenExpiry) {
      // Try to get user info from Google
      try {
        const response = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${gmailToken}`);
        if (response.ok) {
          const data = await response.json();
          if (data.email) {
            document.getElementById('userEmail').textContent = data.email;
            document.getElementById('userEmail').style.color = '#059669';
            document.getElementById('whitelistStatus').textContent = 'Will be checked on first generation';
            document.getElementById('whitelistStatus').style.color = '#6b7280';
            document.getElementById('authMessage').textContent = 'You are signed in. Access will be verified when you generate an email.';
            return;
          }
        }
      } catch (e) {
      }
    }

    // Not signed in or token expired
    document.getElementById('userEmail').textContent = 'Not signed in';
    document.getElementById('userEmail').style.color = '#6b7280';
    document.getElementById('whitelistStatus').textContent = 'Sign in required';
    document.getElementById('whitelistStatus').style.color = '#6b7280';
    document.getElementById('authMessage').textContent = "You'll be prompted to sign in with Google when you generate your first email.";
  } catch (error) {
    console.error('Error checking auth status:', error);
  }
};

/**
 * Restores select box and checkbox state using the preferences stored in chrome.storage
 */
const restoreOptions = () => {
  chrome.storage.local.get(
    {
      userContext: '',
      model: 'claude-sonnet-4-20250514',
      tone: 'Casual & Friendly',
      exampleEmail: '',
      generalInstructions: '',
      financeRecruitingMode: false,
      debugMode: false,
      webGrounding: false,
      darkMode: false,
      webhookUrl: ''
    },
    (items) => {
      document.getElementById('userContext').value = items.userContext;
      document.getElementById('tone').value = items.tone;
      document.getElementById('exampleEmail').value = items.exampleEmail;
      document.getElementById('generalInstructions').value = items.generalInstructions || '';
      document.getElementById('financeRecruitingMode').checked = items.financeRecruitingMode;
      document.getElementById('debugMode').checked = items.debugMode;
      document.getElementById('webGrounding').checked = items.webGrounding;
      document.getElementById('darkMode').checked = items.darkMode;
      document.getElementById('webhookUrl').value = items.webhookUrl || '';

      // Apply dark mode on load
      applyDarkMode(items.darkMode);

      // Check if saved model is in the dropdown
      const modelSelect = document.getElementById('model');
      const options = Array.from(modelSelect.options).map(o => o.value);

      if (options.includes(items.model)) {
        modelSelect.value = items.model;
      } else {
        // It's a custom model
        modelSelect.value = 'custom';
        document.getElementById('customModel').value = items.model;
        document.getElementById('customModel').style.display = 'block';
      }

      // Check authentication status
      checkAuthStatus();
      // loadUsageStats(); // Removed - using cloud stats instead (fetchCloudStats)

      // Show welcome message for first-time users
      chrome.storage.local.get(['hasSeenWelcome'], (result) => {
        if (!result.hasSeenWelcome && !items.userContext) {
          document.getElementById('welcomeMessage').style.display = 'block';
          chrome.storage.local.set({ hasSeenWelcome: true });
        }
      });
    }
  );
};

// Removed loadUsageStats() function - replaced by cloud stats (fetchCloudStats)
// function loadUsageStats() {
//   chrome.storage.local.get(['stats_requestCount', 'stats_inputTokens', 'stats_outputTokens'], (result) => {
//     const requests = result.stats_requestCount || 0;
//     const inputTokens = result.stats_inputTokens || 0;
//     const outputTokens = result.stats_outputTokens || 0;
//     const totalTokens = inputTokens + outputTokens;
//
//     document.getElementById('statsRequests').textContent = requests;
//     document.getElementById('statsTotalTokens').textContent = totalTokens;
//     document.getElementById('statsInputTokens').textContent = inputTokens;
//     document.getElementById('statsOutputTokens').textContent = outputTokens;
//   });
// }


const showStatus = (msg, type) => {
  const status = document.getElementById('status');
  status.textContent = msg;
  status.className = type;
  setTimeout(() => {
    status.textContent = '';
    status.className = '';
  }, 3000);
}

// Toggle custom model input visibility
const setupModelSelect = () => {
  const modelSelect = document.getElementById('model');
  const customInput = document.getElementById('customModel');

  modelSelect.addEventListener('change', () => {
    if (modelSelect.value === 'custom') {
      customInput.style.display = 'block';
      customInput.focus();
    } else {
      customInput.style.display = 'none';
    }
  });
};

const setupHelperModal = () => {
  const modal = document.getElementById('setupModal');
  const btn = document.getElementById('openSetupHelper');
  const span = document.getElementsByClassName('close')[0];
  const copyBtn = document.getElementById('copyPrompt');
  const promptText = document.getElementById('systemPrompt');

  btn.onclick = function (e) {
    e.preventDefault();
    modal.style.display = 'block';
  }

  span.onclick = function () {
    modal.style.display = 'none';
  }

  window.onclick = function (event) {
    if (event.target == modal) {
      modal.style.display = 'none';
    }
  }

  copyBtn.onclick = function () {
    promptText.select();
    promptText.setSelectionRange(0, 99999); // For mobile devices
    navigator.clipboard.writeText(promptText.value).then(() => {
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      copyBtn.style.backgroundColor = '#059669';
      setTimeout(() => {
        copyBtn.textContent = originalText;
        copyBtn.style.backgroundColor = '#10b981';
      }, 2000);
    });
  }
}

/**
 * Export settings handler
 */
const handleExportSettings = async () => {
  try {
    const settings = await exportSettings();
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coldemailcopilot-settings-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showStatus('Settings exported successfully!', 'success');
  } catch (error) {
    showStatus('Failed to export settings: ' + error.message, 'error');
    Logger.error('Export failed:', error);
  }
};

/**
 * Import settings handler
 */
const handleImportSettings = () => {
  document.getElementById('importFile').click();
};

/**
 * Process imported file
 */
const processImportFile = async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const settings = JSON.parse(text);
    await importSettings(settings);
    showStatus('Settings imported successfully! Reloading...', 'success');
    setTimeout(() => {
      location.reload();
    }, 1500);
  } catch (error) {
    showStatus('Failed to import settings: ' + error.message, 'error');
    Logger.error('Import failed:', error);
  }
};

// --- Cloud Stats ---
async function fetchCloudStats() {
  const { gmailToken } = await chrome.storage.local.get('gmailToken');
  if (!gmailToken) {
    const badge = document.getElementById('planBadge');
    if (badge) badge.textContent = 'OFFLINE';
    return;
  }

  const refreshBtn = document.getElementById('refreshStats');
  if (refreshBtn) refreshBtn.textContent = 'Refreshing...';

  try {
    const response = await fetch(config.VERCEL_API_URL + '/api/get-usage', {
      headers: {
        'Authorization': `Bearer ${gmailToken}`
      }
    });

    if (!response.ok) throw new Error('Failed to fetch');

    const data = await response.json();

    // Update Plan Badge
    const badge = document.getElementById('planBadge');
    if (badge) {
      badge.textContent = data.plan.toUpperCase();
      badge.style.background = '#e0e7ff';
      badge.style.color = '#4338ca';
    }

    // Update Total Emails
    const total = (data.usage.openai.emails || 0) + (data.usage.anthropic.emails || 0);
    const countDisplay = document.getElementById('totalEmails');
    if (countDisplay) {
      countDisplay.innerText = total;
    }

  } catch (e) {
    console.error('Stats fetch error:', e);
    const countDisplay = document.getElementById('totalEmails');
    if (countDisplay) countDisplay.innerText = '-';
  } finally {
    if (refreshBtn) refreshBtn.textContent = 'Refresh Count';
  }
}


/**
 * Handle resume upload and auto-generate profile
 */
async function handleResumeUpload() {
  const fileInput = document.getElementById('resumeFile');
  const statusDiv = document.getElementById('resumeStatus');
  const uploadBtn = document.getElementById('uploadResume');

  const file = fileInput.files[0];
  if (!file) {
    statusDiv.textContent = '⚠️ Please select a resume file first';
    statusDiv.style.color = '#dc2626';
    return;
  }

  // Check file type
  const validTypes = ['.txt', '.pdf'];
  const fileExt = '.' + file.name.split('.').pop().toLowerCase();
  if (!validTypes.includes(fileExt)) {
    statusDiv.textContent = '⚠️ Only .txt and .pdf files are supported';
    statusDiv.style.color = '#dc2626';
    return;
  }

  // Get auth token
  const { gmailToken } = await chrome.storage.local.get('gmailToken');
  if (!gmailToken) {
    statusDiv.textContent = '⚠️ Please sign in first';
    statusDiv.style.color = '#dc2626';
    return;
  }

  // Update UI
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Processing...';
  statusDiv.textContent = 'Uploading and generating profile...';
  statusDiv.style.color = '#2563eb';

  try {
    // Create FormData
    const formData = new FormData();
    formData.append('resume', file);

    const response = await fetch(CONFIG.VERCEL_API_URL + '/api/process-resume', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${gmailToken}`
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    // Populate textarea with generated profile
    document.getElementById('userContext').value = data.generated_profile;

    statusDiv.textContent = `✅ Profile generated! (${data.resume_length} chars processed)`;
    statusDiv.style.color = '#059669';

    // Auto-save to storage
    chrome.storage.local.set({ userContext: data.generated_profile });

  } catch (error) {
    console.error('Resume upload error:', error);
    statusDiv.textContent = `❌ Error: ${error.message}`;
    statusDiv.style.color = '#dc2626';
  } finally {
    uploadBtn.disabled = false;
    uploadBtn.textContent = '📄 Auto-Generate from Resume';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  restoreOptions();
  setupModelSelect();
  setupHelperModal();

  // Export/Import handlers
  document.getElementById('exportSettings').addEventListener('click', handleExportSettings);
  document.getElementById('importSettings').addEventListener('click', handleImportSettings);
  document.getElementById('importFile').addEventListener('change', processImportFile);

  // Resume upload handler
  document.getElementById('uploadResume').addEventListener('click', handleResumeUpload);

  // Cloud Dashboard listeners
  document.getElementById('refreshStats')?.addEventListener('click', fetchCloudStats);

  // Initial fetch if signed in
  chrome.storage.local.get('gmailToken', ({ gmailToken }) => {
    if (gmailToken) fetchCloudStats();
  });
});
document.getElementById('save').addEventListener('click', saveOptions);
