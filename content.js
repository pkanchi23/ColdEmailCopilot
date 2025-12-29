// Basic scraping and button injection logic

const scrapeProfile = () => {
    // Selectors for LinkedIn profile elements (these can be brittle and may need updates)
    // Using more generic reliable selectors where possible or multiple fallbacks

    // Name
    const name = document.querySelector('h1')?.innerText?.trim() || "";

    // Headline
    const headline = document.querySelector('.text-body-medium.break-words')?.innerText?.trim() || "";

    // Location
    // LinkedIn shows location near the top, often in a span with specific text pattern
    let location = "";
    try {
        // Try multiple selectors for location (LinkedIn's DOM can vary)
        const locationSelectors = [
            '.text-body-small.inline.t-black--light.break-words',
            '.pv-text-details__left-panel span.text-body-small',
            '.pb2.pv-text-details__left-panel span'
        ];

        for (const selector of locationSelectors) {
            const locationElement = document.querySelector(selector);
            if (locationElement && locationElement.innerText) {
                const text = locationElement.innerText.trim();
                // Location typically doesn't have numbers/special chars like connection count
                if (text && !text.includes('connections') && !text.includes('followers')) {
                    location = text;
                    break;
                }
            }
        }
    } catch (e) {
        console.log('Error extracting location:', e);
    }

    // About
    const aboutSection = document.querySelector('#about')?.parentElement;
    const about = aboutSection?.querySelectorAll('[aria-hidden="true"]')[1]?.innerText?.trim() ||
        document.querySelector('.inline-show-more-text--is-collapsed')?.innerText?.trim() || "";

    // Experience (Getting multiple roles)
    const experienceSection = document.querySelector('#experience')?.parentElement;
    const experiences = [];

    if (experienceSection) {
        // Try to find all experience list items
        const experienceItems = experienceSection.querySelectorAll('ul > li.artdeco-list__item');

        experienceItems.forEach((item, index) => {
            // Limit to first 5 experiences to avoid too much data
            if (index >= 5) return;

            try {
                // Try to extract role and company from each item
                const roleElement = item.querySelector('.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]');
                const companyElement = item.querySelector('.t-14.t-normal span[aria-hidden="true"]');
                const durationElement = item.querySelector('.t-14.t-normal.t-black--light span[aria-hidden="true"]');

                const role = roleElement?.innerText?.trim();
                const company = companyElement?.innerText?.trim();
                const duration = durationElement?.innerText?.trim();

                if (role && company) {
                    const expString = duration ? `${role} at ${company} (${duration})` : `${role} at ${company}`;
                    experiences.push(expString);
                }
            } catch (e) {
                console.log('Error parsing experience item:', e);
            }
        });
    }

    // Fallback to single experience if multiple extraction failed
    if (experiences.length === 0 && experienceSection) {
        const latestRole = experienceSection.querySelector('.display-flex.align-items-center.mr1.t-bold span[aria-hidden="true"]')?.innerText?.trim() || "";
        const latestCompany = experienceSection.querySelector('.t-14.t-normal span[aria-hidden="true"]')?.innerText?.trim() || "";
        if (latestRole && latestCompany) {
            experiences.push(`${latestRole} at ${latestCompany}`);
        }
    }

    const experience = experiences.length > 0 ? experiences.join('\n') : "See profile for details";

    return {
        name,
        headline,
        location,
        about,
        experience
    };
};

// Listen for messages from Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'scrapeAndGenerate') {
        runGeneration();
        sendResponse({ started: true });
    }
});

const runGeneration = async (instructions = '', senderName = null, includeQuestions = false) => {
    const profileData = scrapeProfile();
    console.log('ColdEmailCopilot: Scraped Data:', profileData);
    console.log('ColdEmailCopilot: Sender Name:', senderName);
    console.log('ColdEmailCopilot: Include Questions:', includeQuestions);

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'generateDraft',
            data: {
                profile: profileData,
                instructions: instructions,
                senderName: senderName,
                includeQuestions: includeQuestions
            }
        });

        if (response && response.error) {
            alert('Error: ' + response.error + '\n\nPlease reload the page and try again.');
        }
    } catch (e) {
        console.error(e);
        alert('Failed to generate email. Please reload the page and try again.');
    }
};

// Helper to Scrape Current User's Name (Sender)
const scrapeCurrentUser = () => {
    try {
        // Try the top nav "Me" avatar
        const img = document.querySelector('.global-nav__me-photo');
        if (img && img.alt) {
            return img.alt; // "Pranav Kanchi"
        }

        // Fallback: Try the profile link in nav (sometimes contains name)
        // Or if we are on our own profile? No, we are on someone else's.

        return null;
    } catch (e) {
        return null;
    }
};

// Modal Logic
let modalResolve = null; // Function to call when modal is submitted

const createModal = () => {
    // Check if already exists
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
                <button class="cec-btn cec-btn-primary" id="cec-submit">Generate Draft</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    // Event Listeners
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

    // Cmd+Enter (Mac) or Ctrl+Enter (Windows) to submit
    overlay.querySelector('#cec-context').addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    });

    // Close on click outside
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
};

const openModal = async () => {
    createModal(); // Ensure it exists
    const overlay = document.querySelector('.cec-modal-overlay');
    const textarea = document.getElementById('cec-context');
    textarea.value = ''; // Clear previous
    textarea.focus();

    overlay.classList.add('open');

    return new Promise((resolve) => {
        modalResolve = resolve;
    });
};

// --- SAVE MODAL ---
let saveModalResolve = null;

const createSaveModal = async () => {
    // Remove if exists
    const existing = document.querySelector('.cec-save-modal-overlay');
    if (existing) existing.remove();

    // Load existing lists (empty array by default, no "Everyone")
    const { profileLists = [] } = await chrome.storage.local.get('profileLists');

    const overlay = document.createElement('div');
    overlay.className = 'cec-modal-overlay cec-save-modal-overlay';

    // Build dropdown options
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

    // Show/hide new list input based on dropdown
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
            // Creating new list
            listName = newListInput.value.trim();
            if (!listName) {
                newListInput.style.borderColor = '#ef4444';
                return;
            }
            // Save new list
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

// Also reuse this function for the button click
const createButton = () => {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.className = 'cold-email-copilot-container';

    // 1. Cold Email Button
    const emailBtn = document.createElement('button');
    emailBtn.innerText = 'Cold Email';
    emailBtn.className = 'artdeco-button artdeco-button--2 artdeco-button--primary ember-view cold-email-copilot-btn';
    emailBtn.style.marginLeft = '8px';
    emailBtn.style.backgroundColor = '#2563eb';

    emailBtn.addEventListener('click', async () => {
        const originalText = emailBtn.innerText;

        // Open Native Modal
        const result = await openModal();
        if (result === null) return; // Cancelled

        emailBtn.innerText = 'Generating...';
        emailBtn.disabled = true;
        emailBtn.style.opacity = '0.7';

        // Scrape Sender Name dynamically
        const senderName = scrapeCurrentUser();

        await runGeneration(result.instructions, senderName, result.includeQuestions);

        emailBtn.innerText = originalText;
        emailBtn.disabled = false;
        emailBtn.style.opacity = '1';
    });

    // 2. Save Button
    const saveBtn = document.createElement('button');
    saveBtn.innerText = 'Save';
    saveBtn.className = 'artdeco-button artdeco-button--2 artdeco-button--secondary ember-view cold-email-copilot-save-btn';
    saveBtn.style.marginLeft = '8px';
    saveBtn.style.border = '1px solid #2563eb';
    saveBtn.style.color = '#2563eb';

    saveBtn.addEventListener('click', async () => {
        const selectedList = await openSaveModal();
        if (selectedList === null) return; // Cancelled

        const originalText = saveBtn.innerText;
        saveBtn.innerText = 'Saving...';

        const profileData = scrapeProfile();
        profileData.url = window.location.href;
        profileData.savedAt = new Date().toISOString();
        profileData.list = selectedList; // Add list info

        try {
            const { savedProfiles = [] } = await chrome.storage.local.get('savedProfiles');

            // Check duplicates
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
            console.error('Error saving profile:', e);
            saveBtn.innerText = 'Error';
        }
    });

    container.appendChild(emailBtn);
    container.appendChild(saveBtn);

    return container;
};

// Track current URL to detect profile changes
let lastInjectedUrl = null;

const injectButton = () => {
    const currentUrl = window.location.href;

    // If URL changed, remove old buttons to reset state
    if (lastInjectedUrl && lastInjectedUrl !== currentUrl) {
        const existingContainer = document.querySelector('.cold-email-copilot-container');
        if (existingContainer) {
            existingContainer.remove();
        }
    }
    lastInjectedUrl = currentUrl;

    // 1. Try to find the specific action bar container
    const selectors = [
        '.pvs-profile-actions',
        '.ph5 .display-flex',
        '.pv-top-card-v2-ctas',
        '.pv-top-card__ctas'
    ];

    let actionPanel = null;

    // Strategy A: Try known class names
    for (const selector of selectors) {
        const found = document.querySelector(selector);
        if (found) {
            actionPanel = found;
            break;
        }
    }

    // Strategy B: Find the "Message" button and get its parent
    if (!actionPanel) {
        const buttons = Array.from(document.querySelectorAll('button'));
        const messageBtn = buttons.find(b => b.innerText.trim() === 'Message');
        if (messageBtn) {
            actionPanel = messageBtn.parentElement;
        }
    }

    if (actionPanel && !document.querySelector('.cold-email-copilot-container')) {
        const btnContainer = createButton();
        actionPanel.appendChild(btnContainer);
        console.log('ColdEmailCopilot: Buttons injected successfully into', actionPanel);
    }
};

// Run immediately
injectButton();

// Also run on mutations because LinkedIn is a SPA
const observer = new MutationObserver((mutations) => {
    injectButton();
});

observer.observe(document.body, {
    childList: true,
    subtree: true
});

// One final fallback check
setInterval(injectButton, 3000);
