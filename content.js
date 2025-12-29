// ==========================
// CONFIGURATION & STATE
// ==========================

const CONFIG = {
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes
    DEBOUNCE_DELAY: 200, // ms - reduced for faster response
    MAX_EXPERIENCES: 5,
    MAX_EDUCATION: 2,
    BUTTON_INJECT_RETRY: 500, // ms - reduced for faster retries
    INITIAL_DELAY: 100 // ms - small delay for DOM to settle
};

// State
const state = {
    profileCache: new Map(),
    buttonInjected: false,
    lastInjectedUrl: null,
    debounceTimer: null,
    intervalId: null,
    observer: null
};

// ==========================
// UTILITIES
// ==========================

const debounce = (func, wait) => {
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(state.debounceTimer);
            func(...args);
        };
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(later, wait);
    };
};

const getCachedProfile = (url) => {
    const cached = state.profileCache.get(url);
    if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_TTL) {
        console.log('ColdEmailCopilot: Using cached profile data');
        return cached.data;
    }
    return null;
};

const setCachedProfile = (url, data) => {
    state.profileCache.set(url, {
        data,
        timestamp: Date.now()
    });
    // Clean old cache entries
    if (state.profileCache.size > 20) {
        const firstKey = state.profileCache.keys().next().value;
        state.profileCache.delete(firstKey);
    }
};

const validateProfileData = (profileData) => {
    const errors = [];
    if (!profileData.name || profileData.name.trim() === '') {
        errors.push('Missing name');
    }
    if (!profileData.headline || profileData.headline.trim() === '') {
        errors.push('Missing headline');
    }
    if (profileData.experience === "See profile for details") {
        errors.push('Failed to extract experience');
    }
    return {
        valid: errors.length === 0,
        errors,
        warnings: []
    };
};

// ==========================
// PROFILE SCRAPING
// ==========================

const scrapeProfile = () => {
    const currentUrl = window.location.href;

    // Check cache first
    const cached = getCachedProfile(currentUrl);
    if (cached) return cached;

    // Name
    const name = document.querySelector(LINKEDIN_SELECTORS.PROFILE.NAME)?.innerText?.trim() || "";

    // Headline
    const headline = document.querySelector(LINKEDIN_SELECTORS.PROFILE.HEADLINE)?.innerText?.trim() || "";

    // Location
    let location = "";
    try {
        for (const selector of LINKEDIN_SELECTORS.PROFILE.LOCATION) {
            const locationElement = document.querySelector(selector);
            if (locationElement && locationElement.innerText) {
                const text = locationElement.innerText.trim();
                if (text && !text.includes('connections') && !text.includes('followers')) {
                    location = text;
                    break;
                }
            }
        }
    } catch (e) {
        console.log('ColdEmailCopilot: Error extracting location:', e);
    }

    // About
    const aboutSection = document.querySelector(LINKEDIN_SELECTORS.PROFILE.ABOUT_SECTION)?.parentElement;
    const about = aboutSection?.querySelectorAll('[aria-hidden="true"]')[1]?.innerText?.trim() ||
        document.querySelector(LINKEDIN_SELECTORS.PROFILE.ABOUT_TEXT_COLLAPSED)?.innerText?.trim() || "";

    // Experience (multiple roles)
    const experienceSection = document.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.SECTION)?.parentElement;
    const experiences = [];

    if (experienceSection) {
        const experienceItems = experienceSection.querySelectorAll(LINKEDIN_SELECTORS.EXPERIENCE.ITEMS);

        experienceItems.forEach((item, index) => {
            if (index >= CONFIG.MAX_EXPERIENCES) return;

            try {
                const roleElement = item.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.ROLE);
                const companyElement = item.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.COMPANY);
                const durationElement = item.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.DURATION);

                const role = roleElement?.innerText?.trim();
                const company = companyElement?.innerText?.trim();
                const duration = durationElement?.innerText?.trim();

                if (role && company) {
                    const expString = duration ? `${role} at ${company} (${duration})` : `${role} at ${company}`;
                    experiences.push(expString);
                }
            } catch (e) {
                console.log('ColdEmailCopilot: Error parsing experience item:', e);
            }
        });
    }

    // Fallback for experience
    if (experiences.length === 0 && experienceSection) {
        const latestRole = experienceSection.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.ROLE)?.innerText?.trim() || "";
        const latestCompany = experienceSection.querySelector(LINKEDIN_SELECTORS.EXPERIENCE.COMPANY)?.innerText?.trim() || "";
        if (latestRole && latestCompany) {
            experiences.push(`${latestRole} at ${latestCompany}`);
        }
    }

    const experience = experiences.length > 0 ? experiences.join('\n') : "See profile for details";

    // Education (top 2 schools)
    const educationSection = document.querySelector(LINKEDIN_SELECTORS.EDUCATION.SECTION)?.parentElement;
    const education = [];

    if (educationSection) {
        const educationItems = educationSection.querySelectorAll(LINKEDIN_SELECTORS.EDUCATION.ITEMS);

        educationItems.forEach((item, index) => {
            if (index >= CONFIG.MAX_EDUCATION) return;

            try {
                const school = item.querySelector(LINKEDIN_SELECTORS.EDUCATION.SCHOOL)?.innerText?.trim();
                const degree = item.querySelector(LINKEDIN_SELECTORS.EDUCATION.DEGREE)?.innerText?.trim();

                if (school) {
                    const eduString = degree ? `${degree} at ${school}` : school;
                    education.push(eduString);
                }
            } catch (e) {
                console.log('ColdEmailCopilot: Error parsing education item:', e);
            }
        });
    }

    const profileData = {
        name,
        headline,
        location,
        about,
        experience,
        education: education.join('\n') || ''
    };

    // Validate
    const validation = validateProfileData(profileData);
    if (!validation.valid) {
        console.warn('ColdEmailCopilot: Profile data validation warnings:', validation.errors);
    }

    // Cache the result
    setCachedProfile(currentUrl, profileData);

    return profileData;
};

// ==========================
// MESSAGING
// ==========================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeAndGenerate') {
        runGeneration('', null, request.includeQuestions || false, request.useWebGrounding || false)
            .then(() => sendResponse({ started: true }))
            .catch(err => sendResponse({ started: false, error: err.message }));
        return true; // Will respond asynchronously
    } else if (request.action === 'showOAuthNotification') {
        showOAuthToast();
        sendResponse({ shown: true });
    } else if (request.action === 'hideOAuthNotification') {
        hideOAuthToast();
        sendResponse({ hidden: true });
    }
});

const runGeneration = async (instructions = '', senderName = null, includeQuestions = false, useWebGrounding = false) => {
    const profileData = scrapeProfile();
    console.log('ColdEmailCopilot: Scraped Data:', profileData);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'generateDraft',
            data: {
                profile: profileData,
                instructions: instructions,
                senderName: senderName,
                includeQuestions: includeQuestions,
                useWebGrounding: useWebGrounding
            }
        });

        if (response && response.error) {
            showError('API_ERROR', response.error);
        }
    } catch (e) {
        console.error(e);
        showError('GENERATION_FAILED', e.message);
    }
};

// ==========================
// TOAST NOTIFICATION SYSTEM
// ==========================

const showToast = (message, type = 'info', duration = 5000) => {
    // Remove any existing general toasts (not OAuth toasts)
    const existingToasts = document.querySelectorAll('.cec-toast:not(.cec-oauth-toast)');
    existingToasts.forEach(toast => toast.remove());

    const toast = document.createElement('div');
    toast.className = 'cec-toast';

    // Set icon and color based on type
    let icon = '';
    let bgColor = '#2563eb';

    if (type === 'error') {
        icon = '✕';
        bgColor = '#dc2626';
    } else if (type === 'success') {
        icon = '✓';
        bgColor = '#16a34a';
    } else if (type === 'warning') {
        icon = '⚠';
        bgColor = '#ea580c';
    } else {
        icon = 'ℹ';
        bgColor = '#2563eb';
    }

    toast.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        color: white;
        padding: 14px 24px;
        border-radius: 8px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.2), 0 4px 6px -2px rgba(0, 0, 0, 0.1);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 10px;
        font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto;
        font-size: 14px;
        font-weight: 500;
        animation: slideDown 0.3s ease-out;
        max-width: 500px;
    `;

    toast.innerHTML = `
        <span style="font-size: 18px;">${icon}</span>
        <span>${message}</span>
    `;

    document.body.appendChild(toast);

    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translate(-50%, -20px)';
            toast.style.transition = 'all 0.3s ease-out';
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    return toast;
};

const showError = (type, message) => {
    let errorMsg = 'An error occurred. Please try again.';

    if (type === 'SCRAPE_FAILED') {
        errorMsg = 'Could not read profile data. Try refreshing the page.';
    } else if (type === 'API_ERROR') {
        errorMsg = `API error: ${message}. Please check your API key in settings.`;
    } else if (type === 'GENERATION_FAILED') {
        errorMsg = `Failed to generate email: ${message}. Please reload the page and try again.`;
    }

    showToast(errorMsg, 'error', 8000);
};

// ==========================
// OAUTH TOAST NOTIFICATION
// ==========================
let oauthToast = null;
let oauthToastTimeout = null;

const showOAuthToast = () => {
    // Remove existing toast if any
    if (oauthToast) {
        oauthToast.remove();
    }

    // Clear any existing timeout
    if (oauthToastTimeout) {
        clearTimeout(oauthToastTimeout);
    }

    // Create toast
    oauthToast = document.createElement('div');
    oauthToast.className = 'cec-oauth-toast';
    oauthToast.innerHTML = `
        <svg class="spinner" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="31.4 31.4" stroke-linecap="round" style="animation: dash 1.5s ease-in-out infinite;"/>
        </svg>
        <span class="cec-oauth-toast-text">Please sign in to Gmail to continue...</span>
    `;
    document.body.appendChild(oauthToast);

    // Auto-hide after 30 seconds as fallback
    oauthToastTimeout = setTimeout(() => {
        hideOAuthToast();
    }, 30000);
};

const hideOAuthToast = () => {
    if (oauthToast) {
        oauthToast.remove();
        oauthToast = null;
    }
    if (oauthToastTimeout) {
        clearTimeout(oauthToastTimeout);
        oauthToastTimeout = null;
    }
};

// Clean up any stale OAuth toasts on page load
window.addEventListener('load', () => {
    const staleToast = document.querySelector('.cec-oauth-toast');
    if (staleToast) {
        staleToast.remove();
    }
});

// Helper to scrape current user's name
const scrapeCurrentUser = () => {
    try {
        const img = document.querySelector(LINKEDIN_SELECTORS.USER.ME_PHOTO);
        if (img && img.alt) {
            return img.alt;
        }
        return null;
    } catch (e) {
        return null;
    }
};

// ==========================
// MODALS
// ==========================

const createModal = () => {
    // Remove any existing modal to prevent race conditions
    const existingModal = document.querySelector('.cec-modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }

    const overlay = document.createElement('div');
    overlay.className = 'cec-modal-overlay';

    overlay.innerHTML = `
        <div class="cec-modal">
            <div class="cec-modal-header">
                <h3 class="cec-modal-title">Draft Cold Email</h3>
                <button class="cec-close-btn">&times;</button>
            </div>
            <div class="cec-modal-body">
                <label class="cec-label" for="cec-context">Special Instructions / Context (Optional)</label>
                <textarea id="cec-context" class="cec-textarea" placeholder="e.g. Mention we met at the conference, or ask for a 15min call..."></textarea>
                <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px;">
                    <input type="checkbox" id="cec-include-questions" style="width: 16px; height: 16px; margin: 0; cursor: pointer;">
                    <label for="cec-include-questions" style="font-size: 13px; color: #374151; cursor: pointer; margin: 0;">Include 1-3 thoughtful questions</label>
                </div>
            </div>
            <div class="cec-modal-footer">
                <button class="cec-btn cec-btn-secondary" id="cec-cancel">Cancel</button>
                <button class="cec-btn cec-btn-primary" id="cec-submit">
                    <span class="btn-text">Generate Draft</span>
                    <span class="btn-spinner" style="display: none;">
                        <svg class="spinner" width="16" height="16" viewBox="0 0 50 50" style="animation: rotate 1s linear infinite; display: inline-block; vertical-align: middle;">
                            <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5" stroke-dasharray="31.4 31.4" stroke-linecap="round" style="animation: dash 1.5s ease-in-out infinite;"/>
                        </svg>
                        Generating...
                    </span>
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Return promise and handlers
    return { overlay, promise: null };
};

const openModal = async () => {
    const { overlay } = createModal();
    const textarea = document.getElementById('cec-context');
    textarea.value = '';
    textarea.focus();

    overlay.classList.add('open');

    // Create promise with scoped resolve
    return new Promise((resolve) => {
        const close = () => {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 200);
            resolve(null);
        };

        const submit = () => {
            const text = document.getElementById('cec-context').value;
            const includeQuestions = document.getElementById('cec-include-questions').checked;
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 200);
            resolve({ instructions: text, includeQuestions: includeQuestions });
        };

        overlay.querySelector('.cec-close-btn').addEventListener('click', close);
        overlay.querySelector('#cec-cancel').addEventListener('click', close);
        overlay.querySelector('#cec-submit').addEventListener('click', submit);

        // Keyboard shortcuts
        overlay.querySelector('#cec-context').addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    });
};

const setLoadingState = (isLoading) => {
    const submitBtn = document.querySelector('#cec-submit');
    if (!submitBtn) return;

    const textSpan = submitBtn.querySelector('.btn-text');
    const spinnerSpan = submitBtn.querySelector('.btn-spinner');

    if (isLoading) {
        textSpan.style.display = 'none';
        spinnerSpan.style.display = 'inline-block';
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.7';
    } else {
        textSpan.style.display = 'inline-block';
        spinnerSpan.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
    }
};

// Save Modal
const createSaveModal = async () => {
    const existing = document.querySelector('.cec-save-modal-overlay');
    if (existing) existing.remove();

    const { profileLists = [] } = await chrome.storage.local.get('profileLists');

    const overlay = document.createElement('div');
    overlay.className = 'cec-modal-overlay cec-save-modal-overlay';

    const hasLists = profileLists.length > 0;
    let listOptionsHTML = profileLists.map(list => `<option value="${list}">${list}</option>`).join('');

    overlay.innerHTML = `
        <div class="cec-modal cec-save-modal">
            <div class="cec-modal-header">
                <h3 class="cec-modal-title">Save to List</h3>
                <button class="cec-close-btn">&times;</button>
            </div>
            <div class="cec-modal-body">
                ${hasLists ? `
                    <label class="cec-label">Select a list</label>
                    <select id="cec-list-select" style="width: 100%; padding: 8px 10px; border-radius: 8px; border: 1px solid #d1d5db; font-size: 14px; margin-bottom: 12px; line-height: 1.5; height: auto; min-height: 40px; box-sizing: border-box; appearance: menulist; -webkit-appearance: menulist; -moz-appearance: menulist;">
                        ${listOptionsHTML}
                        <option value="__new__">+ Create New List</option>
                    </select>
                ` : `
                    <p style="color: #6b7280; font-size: 14px; margin-bottom: 12px;">No lists yet. Create your first one:</p>
                `}
                <input type="text" id="cec-new-list-name" class="cec-new-list-input" placeholder="Enter new list name..." style="${hasLists ? 'display: none;' : 'display: block;'}">
            </div>
            <div class="cec-modal-footer">
                <button class="cec-btn cec-btn-secondary" id="cec-save-cancel">Cancel</button>
                <button class="cec-btn cec-btn-primary" id="cec-save-confirm">Save</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const newListInput = overlay.querySelector('#cec-new-list-name');
    const listSelect = overlay.querySelector('#cec-list-select');

    if (listSelect) {
        listSelect.addEventListener('change', () => {
            if (listSelect.value === '__new__') {
                newListInput.style.display = 'block';
                newListInput.focus();
            } else {
                newListInput.style.display = 'none';
            }
        });
    }

    return overlay;
};

const openSaveModal = async () => {
    const overlay = await createSaveModal();
    const newListInput = overlay.querySelector('#cec-new-list-name');
    const listSelect = overlay.querySelector('#cec-list-select');

    overlay.classList.add('open');

    // Create promise with scoped resolve
    return new Promise((resolve) => {
        const close = () => {
            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 200);
            resolve(null);
        };

        const confirm = async () => {
            let listName;

            if (listSelect && listSelect.value !== '__new__') {
                listName = listSelect.value;
            } else {
                listName = newListInput.value.trim();
                if (!listName) {
                    newListInput.style.borderColor = '#ef4444';
                    return;
                }
                const { profileLists = [] } = await chrome.storage.local.get('profileLists');
                if (!profileLists.includes(listName)) {
                    profileLists.push(listName);
                    await chrome.storage.local.set({ profileLists });
                }
            }

            overlay.classList.remove('open');
            setTimeout(() => overlay.remove(), 200);
            resolve(listName);
        };

        overlay.querySelector('.cec-close-btn').addEventListener('click', close);
        overlay.querySelector('#cec-save-cancel').addEventListener('click', close);
        overlay.querySelector('#cec-save-confirm').addEventListener('click', confirm);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    });
};

// ==========================
// BUTTON INJECTION
// ==========================

const createButton = () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.className = 'cold-email-copilot-container';

    // Cold Email Button
    const emailBtn = document.createElement('button');
    emailBtn.innerText = 'Cold Email';
    emailBtn.className = 'artdeco-button artdeco-button--2 artdeco-button--primary ember-view cold-email-copilot-btn';
    emailBtn.style.marginLeft = '8px';
    emailBtn.style.backgroundColor = '#2563eb';

    emailBtn.addEventListener('click', async () => {
        const originalText = emailBtn.innerText;
        let generationTimeout = null;

        const resetButton = () => {
            emailBtn.innerText = originalText;
            emailBtn.disabled = false;
            emailBtn.style.opacity = '1';
            setLoadingState(false);
            if (generationTimeout) {
                clearTimeout(generationTimeout);
                generationTimeout = null;
            }
        };

        try {
            const result = await openModal();
            if (result === null) return;

            setLoadingState(true);
            // Add spinner to button
            emailBtn.innerHTML = `
                <svg class="cec-btn-spinner" viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" stroke-width="5"/>
                </svg>
                Generating...
            `;
            emailBtn.disabled = true;
            emailBtn.style.opacity = '0.7';

            // Auto-recovery after 60 seconds
            generationTimeout = setTimeout(() => {
                console.log('ColdEmailCopilot: Generation timeout, resetting button');
                resetButton();
                showToast('Generation timed out. Please try again.', 'error');
            }, 60000);

            const senderName = scrapeCurrentUser();

            await runGeneration(result.instructions, senderName, result.includeQuestions);

            resetButton();
        } catch (err) {
            console.error('ColdEmailCopilot: Button click error:', err);
            resetButton();
            showToast('An error occurred. Please try again.', 'error');
        }
    });

    // Save Button
    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save';
    saveBtn.className = 'artdeco-button artdeco-button--2 artdeco-button--secondary ember-view cold-email-copilot-save-btn';
    saveBtn.style.marginLeft = '8px';
    saveBtn.style.border = '1px solid #2563eb';
    saveBtn.style.color = '#2563eb';

    saveBtn.addEventListener('click', async () => {
        const selectedList = await openSaveModal();
        if (selectedList === null) return;

        const originalText = saveBtn.innerText;
        saveBtn.innerText = 'Saving...';

        const profileData = scrapeProfile();
        profileData.url = window.location.href;
        profileData.savedAt = new Date().toISOString();
        profileData.list = selectedList;

        try {
            const { savedProfiles = [] } = await chrome.storage.local.get('savedProfiles');

            if (!savedProfiles.some(p => p.url === profileData.url)) {
                savedProfiles.push(profileData);
                await chrome.storage.local.set({ savedProfiles });
                saveBtn.innerText = 'Saved!';
                saveBtn.disabled = true;
            } else {
                saveBtn.innerText = 'Already Saved';
                setTimeout(() => saveBtn.innerText = 'Save', 2000);
            }
        } catch (e) {
            console.error('ColdEmailCopilot: Error saving profile:', e);
            saveBtn.innerText = 'Error';
        }
    });

    container.appendChild(emailBtn);
    container.appendChild(saveBtn);

    return container;
};

const injectButton = () => {
    const currentUrl = window.location.href;

    // If URL changed, remove old buttons and reset state
    if (state.lastInjectedUrl && state.lastInjectedUrl !== currentUrl) {
        const existingContainer = document.querySelector('.cold-email-copilot-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        state.buttonInjected = false;
        console.log('ColdEmailCopilot: URL changed, resetting button injection state');
    }
    state.lastInjectedUrl = currentUrl;

    // Don't inject if already injected for this URL
    if (state.buttonInjected) return;

    // Try to find action bar
    let actionPanel = null;

    for (const selector of LINKEDIN_SELECTORS.BUTTONS.ACTION_BAR) {
        const found = document.querySelector(selector);
        if (found) {
            actionPanel = found;
            break;
        }
    }

    // Fallback: find Message button's parent
    if (!actionPanel) {
        const buttons = Array.from(document.querySelectorAll(LINKEDIN_SELECTORS.BUTTONS.MESSAGE));
        const messageBtn = buttons.find(b => b.innerText.trim() === 'Message');
        if (messageBtn) {
            actionPanel = messageBtn.parentElement;
        }
    }

    if (actionPanel && !document.querySelector('.cold-email-copilot-container')) {
        const btnContainer = createButton();
        actionPanel.appendChild(btnContainer);
        console.log('ColdEmailCopilot: Buttons injected successfully');
        state.buttonInjected = true;
    }
};

// ==========================
// KEYBOARD SHORTCUTS
// ==========================

document.addEventListener('keydown', (e) => {
    // Alt+G = Generate email
    if (e.altKey && e.key === 'g') {
        e.preventDefault();
        openModal();
    }
    // Alt+S = Save profile
    if (e.altKey && e.key === 's') {
        e.preventDefault();
        openSaveModal();
    }
});

// ==========================
// INITIALIZATION
// ==========================

// Detect URL changes for SPA navigation
let lastUrl = window.location.href;
const detectUrlChange = () => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
        console.log('ColdEmailCopilot: URL change detected', lastUrl, '->', currentUrl);
        lastUrl = currentUrl;

        // Reset state for new page
        state.buttonInjected = false;

        // Clear cache for old URL to force fresh scraping
        state.profileCache.clear();

        // Trigger button injection after short delay to let page settle
        setTimeout(() => {
            injectButton();
        }, CONFIG.INITIAL_DELAY);
    }
};

// Watch for URL changes using multiple methods for reliability
// Method 1: Listen to popstate (back/forward navigation)
window.addEventListener('popstate', detectUrlChange);

// Method 2: Override pushState and replaceState (SPA navigation)
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
    originalPushState.apply(this, args);
    detectUrlChange();
};

history.replaceState = function(...args) {
    originalReplaceState.apply(this, args);
    detectUrlChange();
};

// Method 3: Poll for URL changes as fallback
setInterval(detectUrlChange, 1000);

// Wait for DOM to be ready before first injection attempt
const initializeButtonInjection = () => {
    // Initial injection with small delay for DOM to settle
    setTimeout(() => {
        injectButton();
    }, CONFIG.INITIAL_DELAY);

    // Debounced observer for DOM changes - keep running to handle SPA navigation
    const debouncedInject = debounce(injectButton, CONFIG.DEBOUNCE_DELAY);

    const observer = new MutationObserver((mutations) => {
        // Always check for injection opportunities (don't stop after first injection)
        debouncedInject();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Store observer in state
    state.observer = observer;

    // Continuous interval to catch any missed injection opportunities
    state.intervalId = setInterval(() => {
        injectButton();
    }, CONFIG.BUTTON_INJECT_RETRY);
};

// Start initialization based on document ready state
if (document.readyState === 'loading') {
    // DOM not ready yet, wait for DOMContentLoaded
    document.addEventListener('DOMContentLoaded', initializeButtonInjection);
} else {
    // DOM already loaded, initialize immediately
    initializeButtonInjection();
}
