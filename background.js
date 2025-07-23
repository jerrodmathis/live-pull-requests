const GITHUB_API_BASE = 'https://api.github.com';
const BOOKMARK_FOLDER_NAME = 'Pull Requests';
const TAB_GROUP_NAME = 'Pull Requests';
const UPDATE_INTERVAL = 15; // minutes

chrome.runtime.onInstalled.addListener(async () => {
  console.log('GitHub PR Tracker installed');
  
  chrome.alarms.create('updatePRs', { periodInMinutes: UPDATE_INTERVAL });
  
  await updatePullRequests();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'updatePRs') {
    await updatePullRequests();
  }
});

async function getGitHubToken() {
  const result = await chrome.storage.sync.get(['githubToken']);
  return result.githubToken;
}

async function getConfiguredRepos() {
  const result = await chrome.storage.sync.get(['repositories']);
  return result.repositories || [];
}

async function getCurrentUser(token) {
  const response = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  if (!response.ok) {
    throw new Error('Failed to get current user');
  }
  
  return response.json();
}

async function getRepositoryPullRequests(token, owner, repo, username) {
  const response = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}/pulls?state=open`, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json'
    }
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid GitHub token');
    } else if (response.status === 403) {
      throw new Error('Rate limit exceeded or insufficient permissions');
    } else if (response.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or no access`);
    }
    throw new Error(`Failed to get pull requests for ${owner}/${repo}: ${response.status}`);
  }
  
  const pullRequests = await response.json();
  
  return pullRequests.filter(pr => {
    const isAuthor = pr.user.login === username;
    const isRequestedReviewer = pr.requested_reviewers.some(reviewer => reviewer.login === username);
    
    return isAuthor || isRequestedReviewer;
  });
}

async function getOrCreateBookmarkFolder() {
  const bookmarks = await chrome.bookmarks.search({ title: BOOKMARK_FOLDER_NAME });
  
  const existingFolder = bookmarks.find(bookmark => 
    bookmark.title === BOOKMARK_FOLDER_NAME && !bookmark.url
  );
  
  if (existingFolder) {
    return existingFolder;
  }
  
  const folder = await chrome.bookmarks.create({
    parentId: "1", // Bookmarks Bar
    title: BOOKMARK_FOLDER_NAME,
    index: 0
  });
  
  return folder;
}

async function updateBookmarks(pullRequests) {
  const folder = await getOrCreateBookmarkFolder();
  
  const existingBookmarks = await chrome.bookmarks.getChildren(folder.id);
  
  const existingPRs = new Map();
  existingBookmarks.forEach(bookmark => {
    if (bookmark.url) {
      existingPRs.set(bookmark.url, bookmark.id);
    }
  });
  
  const currentPRs = new Map();
  pullRequests.forEach(pr => {
    currentPRs.set(pr.html_url, pr);
  });
  
  for (const [url, bookmarkId] of existingPRs) {
    if (!currentPRs.has(url)) {
      await chrome.bookmarks.remove(bookmarkId);
    }
  }
  
  for (const [url, pr] of currentPRs) {
    if (!existingPRs.has(url)) {
      await chrome.bookmarks.create({
        parentId: folder.id,
        title: pr.title,
        url: pr.html_url
      });
    }
  }
}

async function updatePullRequests() {
  try {
    const token = await getGitHubToken();
    if (!token) {
      console.log('No GitHub token configured');
      return;
    }
    
    const repositories = await getConfiguredRepos();
    if (repositories.length === 0) {
      console.log('No repositories configured');
      return;
    }
    
    const user = await getCurrentUser(token);
    const allPullRequests = [];
    
    for (const repo of repositories) {
      try {
        const [owner, repoName] = repo.split('/');
        const prs = await getRepositoryPullRequests(token, owner, repoName, user.login);
        allPullRequests.push(...prs);
      } catch (error) {
        console.error(`Error fetching PRs for ${repo}:`, error);
      }
    }
    
    await updateBookmarks(allPullRequests);
    await updateTabGroup(allPullRequests);
    
    await chrome.storage.sync.set({ lastUpdate: Date.now() });
    
    console.log(`Updated ${allPullRequests.length} pull requests`);
    
  } catch (error) {
    console.error('Error updating pull requests:', error);
  }
}

async function findTabGroupByName(title) {
  const groups = await chrome.tabGroups.query({ title });
  if (groups.length > 0) {
    return groups[0];
  }
  return null;
}

async function updateTabGroup(pullRequests) {
  const group = await findTabGroupByName(TAB_GROUP_NAME);
  const tabsInGroup = group ? await chrome.tabs.query({ groupId: group.id }) : [];

  const existingPRTabs = new Map();
  tabsInGroup.forEach(tab => {
    if (tab.url) {
      existingPRTabs.set(tab.url, tab.id);
    }
  });

  const currentPRs = new Map();
  pullRequests.forEach(pr => {
    currentPRs.set(pr.html_url, pr);
  });

  const tabsToRemove = [];
  for (const [url, tabId] of existingPRTabs) {
    if (!currentPRs.has(url)) {
      tabsToRemove.push(tabId);
    }
  }
  if (tabsToRemove.length > 0) {
    await chrome.tabs.remove(tabsToRemove);
  }

  const urlsToCreate = [];
  for (const [url, pr] of currentPRs) {
    if (!existingPRTabs.has(url)) {
      urlsToCreate.push(url);
    }
  }

  if (urlsToCreate.length === 0) {
    return;
  }

  const newTabs = await Promise.all(
    urlsToCreate.map(url => chrome.tabs.create({ url, active: false }))
  );

  const newTabIds = newTabs.map(tab => tab.id);

  if (group) {
    await chrome.tabs.group({ groupId: group.id, tabIds: newTabIds });
  } else {
    const groupId = await chrome.tabs.group({ tabIds: newTabIds });
    await chrome.tabGroups.update(groupId, { title: TAB_GROUP_NAME, collapsed: true });
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateNow') {
    updatePullRequests().then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
  
  if (request.action === 'testConnection') {
    const token = request.token;
    getCurrentUser(token).then(user => {
      sendResponse({ success: true, user });
    }).catch(error => {
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }
}); 