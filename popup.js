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

    // Filter profiles
    let filteredProfiles = savedProfiles;
    if (currentListFilter !== 'all') {
        filteredProfiles = savedProfiles.filter(p => p.list === currentListFilter);
    }

    if (filteredProfiles.length === 0) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = currentListFilter === 'all'
            ? 'No profiles saved yet.<br>Click "Save" on a LinkedIn profile.'
            : `No profiles in "${currentListFilter}" list.`;
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
