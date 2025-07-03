# GitHub Pull Request Tracker

A Chrome extension that automatically tracks your GitHub pull requests and review requests, storing them as bookmarks for easy access.

## Features

- 🔍 Monitors open pull requests you've created
- 👥 Tracks pull requests where you're requested as a reviewer
- 📂 Organizes them in a "Pull Requests" bookmark folder
- 🔄 Automatically updates every 15 minutes
- ⚡ Manual refresh option
- 🎯 Configure specific repositories to monitor

## Installation

1. **Download or clone this repository**
   ```bash
   git clone git@github.com:jerrodmathis/live-pull-requests.git
   cd github-pr-tracker
   ```

2. **Load extension in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select this directory

## Setup

1. **Get a GitHub Personal Access Token**
   - Go to [GitHub Settings > Developer settings > Personal access tokens](https://github.com/settings/tokens)
   - Generate a new token with these scopes:
     - `repo` (Full control of private repositories)
     - `read:user` (Read user profile data)

2. **Configure the extension**
   - Click the extension icon in Chrome toolbar
   - Enter your GitHub token and test the connection
   - Add repositories you want to monitor (format: `owner/repository`)

## Usage

- The extension automatically updates every 15 minutes
- Click "Update Now" for manual refresh
- Pull requests appear in your bookmarks under "Pull Requests" folder
- Bookmark titles match the PR titles
- Bookmarks are automatically cleaned up when PRs are closed/merged

## File Structure

```
├── manifest.json      # Extension manifest
├── background.js      # Background service worker
├── popup.html         # Extension popup interface
├── popup.css          # Popup styling
├── popup.js           # Popup functionality
├── icon.png           # Extension icon
└── README.md          # This file
```

## Permissions

The extension requires these permissions:
- `bookmarks` - To create and manage PR bookmarks
- `alarms` - For periodic updates
- `storage` - To save configuration
- `https://api.github.com/*` - To access GitHub API

## Development

To modify the extension:
1. Make changes to the files
2. Go to `chrome://extensions/`
3. Click the refresh button on the extension card
4. Test your changes

## Troubleshooting

**Extension not working?**
- Ensure you have valid GitHub token with correct scopes
- Check that repositories are configured correctly
- Look for errors in Chrome DevTools console

**Bookmarks not updating?**
- Verify your GitHub token is still valid
- Check if the repositories exist and you have access
- Try manual update to see any error messages
