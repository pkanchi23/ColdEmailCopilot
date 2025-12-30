/**
 * Initialize logger and dark mode
 */
(async () => {
    await Logger.init();

    // Apply dark mode if enabled
    const { darkMode = false } = await chrome.storage.local.get('darkMode');
    if (darkMode) {
        document.body.classList.add('dark-mode');
    }
})();

// ==========================
// UTILITIES
// ==========================

// XSS protection: Escape HTML to prevent injection attacks
const escapeHtml = (unsafe) => {
    if (!unsafe) return '';
    return unsafe
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

// Simple notification system for popup
const showNotification = (message, type = 'info') => {
    const existing = document.querySelector('.popup-notification');
    if (existing) existing.remove();

    const notification = document.createElement('div');
    notification.className = 'popup-notification';

    let bgColor = '#2563eb';
    if (type === 'error') bgColor = '#dc2626';
    if (type === 'success') bgColor = '#16a34a';
    if (type === 'warning') bgColor = '#ea580c';

    notification.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background: ${bgColor};
        color: white;
        padding: 10px 16px;
        border-radius: 6px;
        font-size: 13px;
        z-index: 10000;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: slideDown 0.3s ease-out;
        max-width: 220px;
        text-align: center;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
};

const showPrompt = (message, defaultValue = '') => {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: white;
            padding: 20px;
            border-radius: 8px;
            width: 200px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        `;

        modal.innerHTML = `
            <p style="margin: 0 0 12px 0; font-size: 13px; color: #374151;">${escapeHtml(message)}</p>
            <input type="text" id="promptInput" value="${escapeHtml(defaultValue)}" style="width: 100%; padding: 6px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px; margin-bottom: 12px; box-sizing: border-box;">
            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                <button id="promptCancel" style="padding: 6px 12px; background: #f3f4f6; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">Cancel</button>
                <button id="promptOk" style="padding: 6px 12px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">OK</button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        const input = modal.querySelector('#promptInput');
        input.focus();
        input.select();

        const cleanup = (value) => {
            overlay.remove();
            resolve(value);
        };

        modal.querySelector('#promptOk').addEventListener('click', () => cleanup(input.value));
        modal.querySelector('#promptCancel').addEventListener('click', () => cleanup(null));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') cleanup(input.value);
            if (e.key === 'Escape') cleanup(null);
        });
    });
};

// --- INITIALIZATION ---

// robust initialization (run immediately if loaded at bottom, or wait)
// --- INITIALIZATION ---

// robust initialization (run immediately if loaded at bottom, or wait)
const initPopup = async () => {
    console.log('Popup script initializing...');

    try {
        // Initialize Logger
        if (window.Logger) {
            await Logger.init();
        }

        // Apply dark mode if enabled
        try {
            const { darkMode = false } = await chrome.storage.local.get('darkMode');
            if (darkMode) {
                document.body.classList.add('dark-mode');
            }
        } catch (err) {
            console.error('Failed to load dark mode setting:', err);
        }

        // Options Button
        const optionsBtn = document.getElementById('optionsBtn');
        if (optionsBtn) {
            optionsBtn.addEventListener('click', () => {
                if (chrome.runtime.openOptionsPage) {
                    chrome.runtime.openOptionsPage();
                } else {
                    window.open(chrome.runtime.getURL('options.html'));
                }
            });
            console.log('Options button listener attached');
        } else {
            console.error('Options button not found');
        }

        // --- Tab Logic ---
        const tabs = document.querySelectorAll('.tab');
        if (tabs.length > 0) {
            tabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    // Remove active class from all
                    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

                    // Add active to clicked
                    tab.classList.add('active');
                    const viewId = tab.dataset.view;
                    const viewElement = document.getElementById(viewId);
                    if (viewElement) {
                        viewElement.classList.add('active');
                    } else {
                        console.error(`View element ${viewId} not found`);
                    }

                    if (viewId === 'saved') {
                        loadSavedProfiles();
                    } else if (viewId === 'templates') {
                        loadTemplates();
                    }
                });
            });
            console.log('Tab listeners attached');
        } else {
            console.error('No tabs found');
        }

    } catch (e) {
        console.error('Error during initialization:', e);
        document.body.innerHTML += `<div style="color:red; font-size:10px; padding:10px;">Init Error: ${e.message}</div>`;
    }
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
} else {
    initPopup();
}

// Global error handler
window.onerror = function (msg, url, line, col, error) {
    document.body.innerHTML += `<div style="color:red; font-size:10px; padding:10px;">
      Runtime Error: ${msg} <br> ${url}:${line}
   </div>`;
    return false;
};

// --- Saved Profiles Logic ---
let currentListFilter = 'all';
let currentSearchQuery = '';

const loadSavedProfiles = async () => {
    const { savedProfiles = [], profileLists = [] } = await chrome.storage.local.get(['savedProfiles', 'profileLists']);
    const container = document.getElementById('savedList');
    const emptyState = document.getElementById('emptyState');

    container.innerHTML = '';

    // Build list filter dropdown
    let filterHTML = `
        <div style="margin-bottom: 12px; padding-top: 4px;">
            <select id="listFilter" style="width: 100%; padding: 10px 8px; border-radius: 6px; border: 1px solid #d1d5db; font-size: 13px; line-height: 1.4; box-sizing: border-box;">
                <option value="all">All Lists</option>
                ${profileLists.map(list => `<option value="${escapeHtml(list)}" ${currentListFilter === list ? 'selected' : ''}>${escapeHtml(list)}</option>`).join('')}
            </select>
        </div>
    `;
    container.innerHTML = filterHTML;

    // Add filter listener
    document.getElementById('listFilter').addEventListener('change', (e) => {
        currentListFilter = e.target.value;
        loadSavedProfiles();
    });

    // Filter by list
    let filteredProfiles = savedProfiles;
    if (currentListFilter !== 'all') {
        filteredProfiles = savedProfiles.filter(p => p.list === currentListFilter);
    }

    // Filter by search query
    if (currentSearchQuery) {
        const query = currentSearchQuery.toLowerCase();
        filteredProfiles = filteredProfiles.filter(p => {
            const name = (p.name || '').toLowerCase();
            const headline = (p.headline || '').toLowerCase();
            const location = (p.location || '').toLowerCase();
            const experience = (p.experience || '').toLowerCase();

            return name.includes(query) ||
                headline.includes(query) ||
                location.includes(query) ||
                experience.includes(query);
        });
    }

    if (filteredProfiles.length === 0) {
        emptyState.style.display = 'block';
        if (currentSearchQuery) {
            emptyState.textContent = `No profiles match "${currentSearchQuery}"`;
        } else {
            if (currentListFilter === 'all') {
                emptyState.innerHTML = 'No profiles saved yet.<br>Click "Save" on a LinkedIn profile.';
            } else {
                emptyState.textContent = `No profiles in "${currentListFilter}" list.`;
            }
        }
        return;
    }

    emptyState.style.display = 'none';

    // Reverse to show newest first
    filteredProfiles.slice().reverse().forEach((profile) => {
        const div = document.createElement('div');
        div.className = 'saved-item';

        // Check profile staleness
        const stalenessInfo = checkProfileStaleness(profile);
        const stalenessClass = stalenessInfo.stale ? `stale-${stalenessInfo.severity}` : '';
        if (stalenessClass) {
            div.classList.add(stalenessClass);
        }

        // Build staleness badge HTML
        let stalenessBadgeHTML = '';
        if (stalenessInfo.stale || stalenessInfo.severity === 'info') {
            const badgeIcons = {
                'error': '⚠️',
                'warning': '⏰',
                'info': '📅'
            };
            const badgeColors = {
                'error': '#ef4444',
                'warning': '#f59e0b',
                'info': '#6b7280'
            };
            const icon = badgeIcons[stalenessInfo.severity] || '📅';
            const color = badgeColors[stalenessInfo.severity] || '#6b7280';
            stalenessBadgeHTML = `<div class="staleness-badge" style="font-size: 10px; color: ${color}; margin-bottom: 4px;" title="${escapeHtml(stalenessInfo.message)}">${icon} ${escapeHtml(stalenessInfo.message)}</div>`;
        }

        div.innerHTML = `
            <div class="saved-name">${escapeHtml(profile.name)}</div>
            <div class="saved-headline">${escapeHtml(profile.headline)}</div>
            ${stalenessBadgeHTML}
            <div style="font-size: 10px; color: #9ca3af; margin-bottom: 6px;">${escapeHtml(profile.list || 'Everyone')}</div>
            <div class="saved-actions">
                <button class="visit-btn">Visit</button>
                <button class="saved-delete">Remove</button>
            </div>
        `;

        div.querySelector('.visit-btn').addEventListener('click', () => {
            chrome.tabs.create({ url: profile.url });
        });

        div.querySelector('.saved-delete').addEventListener('click', async () => {
            const { savedProfiles } = await chrome.storage.local.get('savedProfiles');
            const newProfiles = savedProfiles.filter(p => p.url !== profile.url);
            await chrome.storage.local.set({ savedProfiles: newProfiles });
            loadSavedProfiles();
        });

        container.appendChild(div);
    });
};

// Search functionality
document.addEventListener('DOMContentLoaded', async () => {
    const searchInput = document.getElementById('searchProfiles');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchQuery = e.target.value;
            loadSavedProfiles();
        });
    }

});

// Export functionality
document.getElementById('exportBtn')?.addEventListener('click', async () => {
    const { savedProfiles = [], profileLists = [] } = await chrome.storage.local.get(['savedProfiles', 'profileLists']);

    const exportData = {
        version: 1,
        exportDate: new Date().toISOString(),
        profiles: savedProfiles,
        lists: profileLists
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coldemail-profiles-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

// Import functionality
document.getElementById('importBtn')?.addEventListener('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const importData = JSON.parse(text);

        // Validate import data structure
        if (!importData || typeof importData !== 'object') {
            showNotification('Invalid import file format', 'error');
            return;
        }

        if (!importData.profiles || !Array.isArray(importData.profiles)) {
            showNotification('Invalid import file: missing profiles array', 'error');
            return;
        }

        // Validate each profile has required fields
        const validProfiles = importData.profiles.filter(p => {
            return p && typeof p === 'object' &&
                typeof p.url === 'string' &&
                typeof p.name === 'string' &&
                p.url.includes('linkedin.com');
        });

        if (validProfiles.length === 0) {
            showNotification('No valid profiles found in import file', 'error');
            return;
        }

        if (validProfiles.length < importData.profiles.length) {
            showNotification(`Warning: ${importData.profiles.length - validProfiles.length} invalid profiles skipped`, 'warning');
        }

        const { savedProfiles = [], profileLists = [] } = await chrome.storage.local.get(['savedProfiles', 'profileLists']);

        // Merge profiles (avoid duplicates by URL)
        const existingUrls = new Set(savedProfiles.map(p => p.url));
        const newProfiles = validProfiles.filter(p => !existingUrls.has(p.url));

        // Validate and merge lists
        const importedLists = Array.isArray(importData.lists) ?
            importData.lists.filter(l => typeof l === 'string' && l.trim().length > 0) : [];
        const mergedLists = [...new Set([...profileLists, ...importedLists])];

        await chrome.storage.local.set({
            savedProfiles: [...savedProfiles, ...newProfiles],
            profileLists: mergedLists
        });

        showNotification(`Imported ${newProfiles.length} new profiles`, 'success');
        loadSavedProfiles();
    } catch (error) {
        Logger.error('Import error:', error);
        showNotification('Error importing file: ' + error.message, 'error');
    }

    // Reset file input
    e.target.value = '';
});

// --- Template Library ---
const loadTemplates = async () => {
    const { emailTemplates = [] } = await chrome.storage.local.get('emailTemplates');
    const container = document.getElementById('templateList');
    const emptyState = document.getElementById('templatesEmptyState');

    container.innerHTML = '';

    if (emailTemplates.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Show most recent first
    emailTemplates.slice().reverse().forEach((template, index) => {
        const div = document.createElement('div');
        div.className = 'saved-item';
        div.innerHTML = `
            <div class="saved-name">${escapeHtml(template.name)}</div>
            <div class="saved-headline" style="font-size: 11px; margin-bottom: 4px;">
                Subject: ${escapeHtml(template.subject)}
            </div>
            <div style="font-size: 10px; color: #9ca3af; margin-bottom: 6px;">
                ${escapeHtml(template.category || 'General')} • Saved ${new Date(template.createdAt).toLocaleDateString()}
            </div>
            <div class="saved-actions">
                <button class="use-template-btn" style="background: #2563eb; color: white;">Use Template</button>
                <button class="view-template-btn" style="background: #6b7280; color: white;">View</button>
                <button class="delete-template-btn" style="background: #fee2e2; color: #991b1b;">Delete</button>
            </div>
        `;

        div.querySelector('.use-template-btn').addEventListener('click', async () => {
            await chrome.storage.local.set({ activeTemplate: template });
            showNotification(`Template "${template.name}" will be used for next generation`, 'success');
        });

        div.querySelector('.view-template-btn').addEventListener('click', () => {
            const viewOverlay = document.createElement('div');
            viewOverlay.style.cssText = `
                position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                background: rgba(0,0,0,0.5); display: flex; align-items: center;
                justify-content: center; z-index: 10000; padding: 20px;
            `;
            viewOverlay.innerHTML = `
                <div style="background: white; padding: 20px; border-radius: 8px; max-width: 400px; max-height: 80vh; overflow-y: auto;">
                    <h3 style="margin: 0 0 10px 0; font-size: 14px;">Template Preview</h3>
                    <p style="margin: 0 0 8px 0; font-size: 12px;"><strong>Subject:</strong> ${escapeHtml(template.subject)}</p>
                    <p style="margin: 0 0 8px 0; font-size: 12px;"><strong>Body:</strong></p>
                    <pre style="white-space: pre-wrap; font-size: 11px; background: #f3f4f6; padding: 10px; border-radius: 4px; margin: 0;">${escapeHtml(template.body)}</pre>
                    <button id="closeView" style="margin-top: 12px; padding: 6px 12px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; width: 100%;">Close</button>
                </div>
            `;
            document.body.appendChild(viewOverlay);
            viewOverlay.querySelector('#closeView').addEventListener('click', () => viewOverlay.remove());
            viewOverlay.addEventListener('click', (e) => { if (e.target === viewOverlay) viewOverlay.remove(); });
        });

        div.querySelector('.delete-template-btn').addEventListener('click', async () => {
            const { emailTemplates } = await chrome.storage.local.get('emailTemplates');
            emailTemplates.splice(emailTemplates.length - 1 - index, 1);
            await chrome.storage.local.set({ emailTemplates });
            loadTemplates();
        });

        container.appendChild(div);
    });
};

// Save last generated email as template
document.getElementById('saveTemplateBtn')?.addEventListener('click', async () => {
    const { lastGeneratedEmail } = await chrome.storage.local.get('lastGeneratedEmail');

    if (!lastGeneratedEmail) {
        showNotification('No email has been generated yet. Generate an email first!', 'warning');
        return;
    }

    const name = await showPrompt('Enter a name for this template:', 'My Template');
    if (!name) return;

    const category = await showPrompt('Category (optional):', 'General') || 'General';

    const template = {
        id: Date.now(),
        name,
        category,
        subject: lastGeneratedEmail.subject,
        body: lastGeneratedEmail.body,
        createdAt: new Date().toISOString()
    };

    const { emailTemplates = [] } = await chrome.storage.local.get('emailTemplates');
    emailTemplates.push(template);
    await chrome.storage.local.set({ emailTemplates });

    showNotification('Template saved successfully!', 'success');
    loadTemplates();
});
