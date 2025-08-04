const GITHUB_API_BASE = 'https://api.github.com';
const BOOKMARK_FOLDER_NAME = 'Pull Requests';
const TAB_GROUP_NAME = 'Pull Requests';
const UPDATE_INTERVAL = 15; // minutes
let isUpdating = false;

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
  if (isUpdating) {
    console.log('Update is already in progress. Skipping.');
    return;
  }
  isUpdating = true;

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
  } finally {
    isUpdating = false;
  }
}

async function getStoredTabGroupId() {
  const result = await chrome.storage.local.get(['tabGroupId']);
  return result.tabGroupId;
}

async function storeTabGroupId(groupId) {
  await chrome.storage.local.set({ tabGroupId: groupId });
}

async function clearStoredTabGroupId() {
  await chrome.storage.local.remove(['tabGroupId']);
}

async function findOrCreateTabGroup() {
  const storedGroupId = await getStoredTabGroupId();
  
  if (storedGroupId) {
    try {
      // Try to get the group by stored ID
      const group = await chrome.tabGroups.get(storedGroupId);
      return group;
    } catch (error) {
      // Group doesn't exist anymore, clear the stored ID
      console.log('Stored tab group no longer exists, will create new one');
      await clearStoredTabGroupId();
    }
  }
  
  return null;
}

async function updateTabGroup(pullRequests) {
  let group = await findOrCreateTabGroup();
  const tabsInGroup = group ? await chrome.tabs.query({ groupId: group.id }) : [];

  const existingPRTabs = new Map(
    tabsInGroup.map(tab => [tab.url, tab.id])
  );

  const currentPRUrls = new Set(pullRequests.map(pr => pr.html_url));

  const tabsToRemove = tabsInGroup
    .filter(tab => !currentPRUrls.has(tab.url))
    .map(tab => tab.id);

  if (tabsToRemove.length > 0) {
    await chrome.tabs.remove(tabsToRemove);
  }

  const urlsToCreate = pullRequests
    .filter(pr => !existingPRTabs.has(pr.html_url))
    .map(pr => pr.html_url);

  if (urlsToCreate.length === 0) {
    return;
  }

  // If a group already exists, create all tabs and group them.
  if (group) {
    const newTabs = await Promise.all(
      urlsToCreate.map(url => chrome.tabs.create({ url, active: false }))
    );
    await chrome.tabs.group({
      groupId: group.id,
      tabIds: newTabs.map(tab => tab.id),
    });
  } else {
    // If no group exists, create the first tab to get a tabId for group creation.
    const [firstUrl, ...remainingUrls] = urlsToCreate;
    const firstTab = await chrome.tabs.create({ url: firstUrl, active: false });

    const groupId = await chrome.tabs.group({ tabIds: [firstTab.id] });
    await chrome.tabGroups.update(groupId, { title: TAB_GROUP_NAME, collapsed: true });
    
    // Store the new group ID for future use
    await storeTabGroupId(groupId);

    // Create the rest of the tabs and add them to the new group.
    if (remainingUrls.length > 0) {
      const remainingTabs = await Promise.all(
        remainingUrls.map(url => chrome.tabs.create({ url, active: false }))
      );
      await chrome.tabs.group({
        groupId,
        tabIds: remainingTabs.map(tab => tab.id),
      });
    }
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