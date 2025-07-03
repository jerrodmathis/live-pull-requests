document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    setupEventListeners();
    updateStatus();
});

async function loadSettings() {
    const result = await chrome.storage.sync.get(['githubToken', 'repositories']);
    
    if (result.githubToken) {
        document.getElementById('githubToken').value = result.githubToken;
    }
    
    if (result.repositories) {
        displayRepositories(result.repositories);
    }
}

function setupEventListeners() {
    document.getElementById('testToken').addEventListener('click', testGitHubToken);
    
    document.getElementById('githubToken').addEventListener('blur', saveGitHubToken);
    
    document.getElementById('addRepo').addEventListener('click', addRepository);
    document.getElementById('repoInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            addRepository();
        }
    });
    
    document.getElementById('updateNow').addEventListener('click', triggerUpdate);
}

async function testGitHubToken() {
    const token = document.getElementById('githubToken').value.trim();
    const statusEl = document.getElementById('tokenStatus');
    
    if (!token) {
        showStatus(statusEl, 'Please enter a token', 'error');
        return;
    }
    
    showStatus(statusEl, 'Testing...', 'loading');
    
    try {
        const response = await chrome.runtime.sendMessage({
            action: 'testConnection',
            token: token
        });
        
        if (response.success) {
            showStatus(statusEl, `✓ Connected as ${response.user.login}`, 'success');
            await saveGitHubToken();
        } else {
            showStatus(statusEl, `✗ ${response.error}`, 'error');
        }
    } catch (error) {
        showStatus(statusEl, `✗ ${error.message}`, 'error');
    }
}

async function saveGitHubToken() {
    const token = document.getElementById('githubToken').value.trim();
    
    if (token) {
        await chrome.storage.sync.set({ githubToken: token });
    }
}

async function addRepository() {
    const repoInput = document.getElementById('repoInput');
    const repoName = repoInput.value.trim();
    
    if (!repoName) {
        return;
    }
    
    if (!repoName.match(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/)) {
        alert('Repository must be in format: owner/repository');
        return;
    }
    
    const result = await chrome.storage.sync.get(['repositories']);
    const repositories = result.repositories || [];
    
    if (repositories.includes(repoName)) {
        alert('Repository already added');
        return;
    }
    
    repositories.push(repoName);
    await chrome.storage.sync.set({ repositories });
    
    repoInput.value = '';
    displayRepositories(repositories);
}

async function removeRepository(repoName) {
    const result = await chrome.storage.sync.get(['repositories']);
    const repositories = result.repositories || [];
    
    const updatedRepos = repositories.filter(repo => repo !== repoName);
    await chrome.storage.sync.set({ repositories: updatedRepos });
    
    displayRepositories(updatedRepos);
}

function displayRepositories(repositories) {
    const listEl = document.getElementById('repoList');
    
    if (!repositories || repositories.length === 0) {
        listEl.innerHTML = '<div class="help">No repositories configured</div>';
        return;
    }
    
    listEl.innerHTML = repositories.map(repo => `
        <div class="repo-item">
            <span class="repo-name">${repo}</span>
            <button class="repo-remove" onclick="removeRepository('${repo}')">Remove</button>
        </div>
    `).join('');
}

window.removeRepository = removeRepository;

async function triggerUpdate() {
    const statusEl = document.getElementById('updateStatus');
    const button = document.getElementById('updateNow');
    
    button.disabled = true;
    button.textContent = 'Updating...';
    showStatus(statusEl, 'Updating pull requests...', 'loading');
    
    try {
        const response = await chrome.runtime.sendMessage({ action: 'updateNow' });
        
        if (response.success) {
            showStatus(statusEl, '✓ Update completed', 'success');
        } else {
            showStatus(statusEl, `✗ ${response.error}`, 'error');
        }
    } catch (error) {
        showStatus(statusEl, `✗ ${error.message}`, 'error');
    } finally {
        button.disabled = false;
        button.textContent = 'Update Now';
        
        setTimeout(() => {
            statusEl.textContent = '';
            statusEl.className = 'status';
        }, 3000);
    }
}

function showStatus(element, message, type = '') {
    element.textContent = message;
    element.className = `status ${type}`;
}

async function updateStatus() {
    const result = await chrome.storage.sync.get(['lastUpdate']);
    const lastUpdateEl = document.getElementById('lastUpdate');
    
    if (result.lastUpdate) {
        const date = new Date(result.lastUpdate);
        lastUpdateEl.textContent = date.toLocaleString();
    } else {
        lastUpdateEl.textContent = 'Never';
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateComplete') {
        chrome.storage.sync.set({ lastUpdate: Date.now() });
        updateStatus();
    }
}); 