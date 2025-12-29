// ==========================
// CONFIGURATION & STATE
// ==========================

const CONFIG = {
    CACHE_TTL: 5 * 60 * 1000, // 5 minutes
    DEBOUNCE_DELAY: 500, // ms
    MAX_EXPERIENCES: 5,
    MAX_EDUCATION: 2,
    BUTTON_INJECT_RETRY: 3000 // ms
};

// State
const state = {
    profileCache: new Map(),
    buttonInjected: false,
    lastInjectedUrl: null,
    debounceTimer: null,
    intervalId: null
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
        runGeneration('', null, request.includeQuestions || false, request.useWebGrounding || false);
        sendResponse({ started: true });
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

const showError = (type, message) => {
    let errorMsg = 'An error occurred. Please try again.';

    if (type === 'SCRAPE_FAILED') {
        errorMsg = 'Could not read profile data. Try refreshing the page.';
    } else if (type === 'API_ERROR') {
        errorMsg = `API error: ${message}\n\nPlease check your API key in settings.`;
    } else if (type === 'GENERATION_FAILED') {
        errorMsg = `Failed to generate email: ${message}\n\nPlease reload the page and try again.`;
    }

    alert(errorMsg);
};

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

let modalResolve = null;
let saveModalResolve = null;

const createModal = () => {
    if (document.querySelector('.cec-modal-overlay')) return;

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

    const close = () => {
        overlay.classList.remove('open');
        if (modalResolve) modalResolve(null);
        modalResolve = null;
    };

    const submit = () => {
        const text = document.getElementById('cec-context').value;
        const includeQuestions = document.getElementById('cec-include-questions').checked;
        overlay.classList.remove('open');
        if (modalResolve) modalResolve({ instructions: text, includeQuestions: includeQuestions });
        modalResolve = null;
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
};

const openModal = async () => {
    createModal();
    const overlay = document.querySelector('.cec-modal-overlay');
    const textarea = document.getElementById('cec-context');
    textarea.value = '';
    textarea.focus();

    overlay.classList.add('open');

    return new Promise((resolve) => {
        modalResolve = resolve;
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

    const close = () => {
        overlay.classList.remove('open');
        setTimeout(() => overlay.remove(), 200);
        if (saveModalResolve) saveModalResolve(null);
        saveModalResolve = null;
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
        if (saveModalResolve) saveModalResolve(listName);
        saveModalResolve = null;
    };

    overlay.querySelector('.cec-close-btn').addEventListener('click', close);
    overlay.querySelector('#cec-save-cancel').addEventListener('click', close);
    overlay.querySelector('#cec-save-confirm').addEventListener('click', confirm);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });

    return overlay;
};

const openSaveModal = async () => {
    const overlay = await createSaveModal();
    overlay.classList.add('open');

    return new Promise((resolve) => {
        saveModalResolve = resolve;
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

        const result = await openModal();
        if (result === null) return;

        setLoadingState(true);
        emailBtn.innerText = 'Generating...';
        emailBtn.disabled = true;
        emailBtn.style.opacity = '0.7';

        const senderName = scrapeCurrentUser();

        await runGeneration(result.instructions, senderName, result.includeQuestions);

        emailBtn.innerText = originalText;
        emailBtn.disabled = false;
        emailBtn.style.opacity = '1';
        setLoadingState(false);
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

    // If URL changed, remove old buttons
    if (state.lastInjectedUrl && state.lastInjectedUrl !== currentUrl) {
        const existingContainer = document.querySelector('.cold-email-copilot-container');
        if (existingContainer) {
            existingContainer.remove();
        }
        state.buttonInjected = false;
    }
    state.lastInjectedUrl = currentUrl;

    // Don't inject if already injected
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

        // Stop the interval once injected
        if (state.intervalId) {
            clearInterval(state.intervalId);
            state.intervalId = null;
        }
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

// Run immediately
injectButton();

// Debounced observer
const debouncedInject = debounce(injectButton, CONFIG.DEBOUNCE_DELAY);

const observer = new MutationObserver((mutations) => {
    // Only react if we haven't injected yet
    if (!state.buttonInjected) {
        debouncedInject();
    }
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// Fallback interval (will stop after first successful injection)
state.intervalId = setInterval(() => {
    if (!state.buttonInjected) {
        injectButton();
    } else {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }
}, CONFIG.BUTTON_INJECT_RETRY);
