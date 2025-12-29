document.getElementById('optionsBtn').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('options.html'));
    }
});

const setStatus = (msg) => {
    document.getElementById('status').innerText = msg;
};

// --- Tab Logic ---
const tabs = document.querySelectorAll('.tab');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

        // Add active to clicked
        tab.classList.add('active');
        document.getElementById(tab.dataset.view).classList.add('active');

        if (tab.dataset.view === 'saved') {
            loadSavedProfiles();
        }
    });
});

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
                ${profileLists.map(list => `<option value="${list}" ${currentListFilter === list ? 'selected' : ''}>${list}</option>`).join('')}
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
            emptyState.innerHTML = `No profiles match "${currentSearchQuery}"`;
        } else {
            emptyState.innerHTML = currentListFilter === 'all'
                ? 'No profiles saved yet.<br>Click "Save" on a LinkedIn profile.'
                : `No profiles in "${currentListFilter}" list.`;
        }
        return;
    }

    emptyState.style.display = 'none';

    // Reverse to show newest first
    filteredProfiles.slice().reverse().forEach((profile) => {
        const div = document.createElement('div');
        div.className = 'saved-item';
        div.innerHTML = `
            <div class="saved-name">${profile.name}</div>
            <div class="saved-headline">${profile.headline}</div>
            <div style="font-size: 10px; color: #9ca3af; margin-bottom: 6px;">${profile.list || 'Everyone'}</div>
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
document.addEventListener('DOMContentLoaded', () => {
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

        if (!importData.profiles || !Array.isArray(importData.profiles)) {
            alert('Invalid import file format');
            return;
        }

        const { savedProfiles = [], profileLists = [] } = await chrome.storage.local.get(['savedProfiles', 'profileLists']);

        // Merge profiles (avoid duplicates by URL)
        const existingUrls = new Set(savedProfiles.map(p => p.url));
        const newProfiles = importData.profiles.filter(p => !existingUrls.has(p.url));

        // Merge lists
        const mergedLists = [...new Set([...profileLists, ...(importData.lists || [])])];

        await chrome.storage.local.set({
            savedProfiles: [...savedProfiles, ...newProfiles],
            profileLists: mergedLists
        });

        alert(`Imported ${newProfiles.length} new profiles`);
        loadSavedProfiles();
    } catch (error) {
        alert('Error importing file: ' + error.message);
    }

    // Reset file input
    e.target.value = '';
});


document.getElementById('generateBtn').addEventListener('click', async () => {
    setStatus('Analyzing profile...');

    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
        setStatus('Error: No active tab found.');
        return;
    }

    if (!tab.url.includes('linkedin.com')) {
        setStatus('Please navigate to a LinkedIn user profile first.');
        return;
    }

    try {
        // Send message to content script to scrape
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeAndGenerate' });

        if (response && response.started) {
            setStatus('Drafting email in background...');
            setTimeout(() => window.close(), 1500);
        } else {
            setStatus('Error: Could not trigger generation. Try refreshing the page.');
        }
    } catch (e) {
        console.error(e);
        setStatus('Error: Check if extension is enabled and reload page.');
    }
});
