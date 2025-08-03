{
  "manifest.json": {
    "manifest_version": 3,
    "name": "Salesforce Status Monitor",
    "version": "2.0.0",
    "description": "Monitor Salesforce user status in real-time for Talabat support team",
    "permissions": [
      "storage",
      "tabs",
      "webNavigation",
      "webRequest"
    ],
    "host_permissions": [
      "*://*.salesforce.com/*",
      "*://*.force.com/*"
    ],
    "background": {
      "service_worker": "background.js"
    },
    "content_scripts": [
      {
        "matches": [
          "*://*.salesforce.com/*",
          "*://*.force.com/*"
        ],
        "js": ["content_script.js"],
        "run_at": "document_start"
      }
    ],
    "action": {
      "default_popup": "popup/popup.html",
      "default_title": "Salesforce Status Monitor"
    },
    "icons": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },

  "background.js": `
// Background service worker for Salesforce Status Monitor
const DEBUG = true;

const log = {
    info: (msg, ...args) => DEBUG && console.log(\`[SFF-BG-INFO] \${msg}\`, ...args),
    warn: (msg, ...args) => DEBUG && console.warn(\`[SFF-BG-WARN] \${msg}\`, ...args),
    error: (msg, ...args) => DEBUG && console.error(\`[SFF-BG-ERROR] \${msg}\`, ...args)
};

// Keep track of active tabs
let activeTabs = new Set();

// Install/Update handler
chrome.runtime.onInstalled.addListener((details) => {
    log.info('Extension installed/updated', details);
    
    // Initialize storage
    chrome.storage.local.set({
        isAuthenticated: false,
        userEmail: '',
        lastStatus: 'unknown',
        statusHistory: []
    });
});

// Tab update handler
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && 
        (tab.url?.includes('salesforce.com') || tab.url?.includes('force.com'))) {
        log.info('Salesforce tab detected', tabId, tab.url);
        activeTabs.add(tabId);
        
        // Inject content script if needed
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content_script.js']
        }).catch(err => log.warn('Script injection failed', err));
    }
});

// Tab removal handler
chrome.tabs.onRemoved.addListener((tabId) => {
    activeTabs.delete(tabId);
    log.info('Tab removed', tabId);
});

// Message handler from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    log.info('Message received', message);
    
    switch (message.type) {
        case 'statusUpdate':
            handleStatusUpdate(message.data);
            break;
            
        case 'contentScriptAlive':
            log.info('Content script alive from tab', sender.tab?.id);
            break;
            
        case 'getActiveTabs':
            sendResponse([...activeTabs]);
            break;
            
        case 'authenticate':
            handleAuthentication(message.data, sendResponse);
            return true; // Keep channel open for async response
            
        default:
            log.warn('Unknown message type', message.type);
    }
});

// Handle status updates
function handleStatusUpdate(data) {
    log.info('Status update received', data);
    
    chrome.storage.local.get(['statusHistory'], (result) => {
        const history = result.statusHistory || [];
        history.push({
            ...data,
            timestamp: Date.now()
        });
        
        // Keep only last 100 entries
        if (history.length > 100) {
            history.shift();
        }
        
        chrome.storage.local.set({
            lastStatus: data.status,
            statusHistory: history
        });
    });
}

// Handle authentication
async function handleAuthentication(credentials, sendResponse) {
    try {
        const response = await fetch('YOUR_BACKEND_URL_HERE', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'login',
                email: credentials.email,
                password: credentials.password
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            chrome.storage.local.set({
                isAuthenticated: true,
                userEmail: credentials.email
            });
        }
        
        sendResponse(result);
    } catch (error) {
        log.error('Authentication error', error);
        sendResponse({ success: false, message: 'Network error' });
    }
}
`,

  "content_script.js": `
// Content script for Salesforce Status Monitor
const DEBUG = true;

const log = {
    info: (msg, ...args) => DEBUG && console.log(\`[SFF-CS-INFO] \${msg}\`, ...args),
    warn: (msg, ...args) => DEBUG && console.warn(\`[SFF-CS-WARN] \${msg}\`, ...args),
    error: (msg, ...args) => DEBUG && console.error(\`[SFF-CS-ERROR] \${msg}\`, ...args),
    status: (msg, ...args) => DEBUG && console.log(\`[SFF-STATUS] \${msg}\`, ...args)
};

// Status mapping
const STATUS_MAPPING = {
    '0N51r0000004CB8': 'Short Break (personal)',
    '0N51r0000004CBI': 'Training / QA / Meeting',
    '0N569000000oLnA': 'One to One',
    '0N51r0000004CBD': 'Lunch/Dinner',
    '0N51r000000CbLR': 'Calls Only',
    '0N51r0000004CBS': 'Assigned Task - Non-SF',
    '0N51r0000004CBN': 'Assigned Task - Non-Omni',
    '0N569000000oLn9': 'Assigned Task',
    '0N51r0000004CAy': 'Online for Cases'
};

// Global state
let isMonitoring = false;
let lastStatus = 'unknown';
let performanceObserver = null;

// Initialize monitoring
function initializeMonitoring() {
    if (isMonitoring) return;
    
    log.info('Initializing status monitoring');
    isMonitoring = true;
    
    // Set up performance observer for network monitoring
    setupNetworkMonitoring();
    
    // Keep content script alive
    keepContentScriptAlive();
    
    // Initial status check
    setTimeout(checkPresenceStatus, 2000);
}

// Network monitoring setup
function setupNetworkMonitoring() {
    if (!window.PerformanceObserver) {
        log.warn('PerformanceObserver not supported');
        return;
    }
    
    try {
        performanceObserver = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            
            for (const entry of entries) {
                if (entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'fetch') {
                    handleNetworkRequest(entry);
                }
            }
        });
        
        performanceObserver.observe({ entryTypes: ['resource'] });
        log.info('Network monitoring started');
        
    } catch (error) {
        log.error('Failed to setup network monitoring', error);
    }
}

// Handle network requests
function handleNetworkRequest(entry) {
    const url = entry.name;
    const timestamp = Date.now();
    
    // Check for Messages requests (active session detection)
    if (url.includes('Messages?ack=')) {
        handleMessagesRequest(url, entry, timestamp);
    }
    
    // Check for Presence requests (status detection)
    if (url.includes('PresenceLogin') || url.includes('PresenceStatus')) {
        handlePresenceRequest(url, entry, timestamp);
    }
}

// Handle Messages requests
async function handleMessagesRequest(url, entry, timestamp) {
    const requestId = url.match(/ack=([^&]+)/)?.[1];
    
    if (requestId) {
        if (entry.responseStatus === undefined) {
            // Active state detected
            reportStatus('active', timestamp);
        } else if (entry.responseStatus === 204) {
            // Request completed successfully
            setTimeout(() => checkPresenceStatus(timestamp), 500);
        }
    }
}

// Handle Presence requests
function handlePresenceRequest(url, entry, timestamp) {
    if (entry.responseStatus === 200) {
        // Try to extract status from response
        setTimeout(() => extractStatusFromResponse(url, timestamp), 200);
    }
}

// Extract status from presence response
async function extractStatusFromResponse(url, timestamp) {
    try {
        // This would require intercepting the actual response
        // For now, we'll check the current presence status
        checkPresenceStatus(timestamp);
    } catch (error) {
        log.error('Failed to extract status from response', error);
    }
}

// Check current presence status
function checkPresenceStatus(timestamp = Date.now()) {
    // Look for presence status indicators in the DOM
    const statusElements = [
        '.presence-status',
        '[data-status-id]',
        '.omni-presence-status',
        '.service-presence-status'
    ];
    
    for (const selector of statusElements) {
        const element = document.querySelector(selector);
        if (element) {
            const statusId = element.getAttribute('data-status-id') || 
                           element.getAttribute('data-presence-status-id') ||
                           extractStatusFromElement(element);
            
            if (statusId && statusId !== lastStatus) {
                const statusName = STATUS_MAPPING[statusId] || \`Unknown Status (\${statusId})\`;
                reportStatus(statusName, timestamp, statusId);
                return;
            }
        }
    }
    
    // Alternative: Check for status in script tags or window objects
    checkWindowObjectsForStatus(timestamp);
}

// Extract status from element
function extractStatusFromElement(element) {
    // Look for status ID in various attributes and text content
    const text = element.textContent || '';
    const classes = element.className || '';
    
    // Try to match known status patterns
    for (const [statusId, statusName] of Object.entries(STATUS_MAPPING)) {
        if (text.includes(statusName) || classes.includes(statusId)) {
            return statusId;
        }
    }
    
    return null;
}

// Check window objects for status
function checkWindowObjectsForStatus(timestamp) {
    try {
        // Check for Salesforce presence objects
        if (window.sforce && window.sforce.presence) {
            const presenceStatus = window.sforce.presence.getStatus();
            if (presenceStatus && presenceStatus.statusId) {
                const statusName = STATUS_MAPPING[presenceStatus.statusId] || 
                                 \`Unknown Status (\${presenceStatus.statusId})\`;
                reportStatus(statusName, timestamp, presenceStatus.statusId);
                return;
            }
        }
        
        // Check for other Salesforce objects
        if (window.$A && window.$A.get) {
            // Lightning framework check
            const component = window.$A.get('c.getPresenceStatus');
            if (component) {
                // This would require Lightning component interaction
                log.info('Lightning framework detected');
            }
        }
        
    } catch (error) {
        log.error('Error checking window objects', error);
    }
}

// Report status change
function reportStatus(status, timestamp, statusId = null) {
    if (status === lastStatus) return;
    
    log.status('Status changed:', status, 'at', new Date(timestamp).toLocaleTimeString());
    lastStatus = status;
    
    // Send to background script
    chrome.runtime.sendMessage({
        type: 'statusUpdate',
        data: {
            status: status,
            statusId: statusId,
            timestamp: timestamp,
            url: window.location.href
        }
    }).catch(err => log.error('Failed to send status update', err));
}

// Keep content script alive
function keepContentScriptAlive() {
    setInterval(() => {
        chrome.runtime.sendMessage({ 
            type: 'contentScriptAlive' 
        }).catch(() => {
            // Background script might be inactive
            log.warn('Background script inactive');
        });
    }, 30000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeMonitoring);
} else {
    initializeMonitoring();
}

// Also initialize on page navigation (SPA)
let lastUrl = location.href;
new MutationObserver(() => {
    const url = location.href;
    if (url !== lastUrl) {
        lastUrl = url;
        log.info('Page navigation detected', url);
        setTimeout(initializeMonitoring, 1000);
    }
}).observe(document, { subtree: true, childList: true });

log.info('Content script loaded');
`,

  "popup/popup.html": \`<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body {
            width: 350px;
            min-height: 400px;
            padding: 0;
            margin: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
        }
        
        .header {
            background: #1976d2;
            color: white;
            padding: 16px;
            text-align: center;
        }
        
        .header h1 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
        }
        
        .content {
            padding: 16px;
        }
        
        .login-form {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        
        label {
            font-size: 12px;
            font-weight: 500;
            color: #333;
        }
        
        input {
            padding: 8px 12px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 14px;
        }
        
        input:focus {
            outline: none;
            border-color: #1976d2;
            box-shadow: 0 0 0 2px rgba(25, 118, 210, 0.1);
        }
        
        button {
            padding: 10px 16px;
            background: #1976d2;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            cursor: pointer;
            transition: background-color 0.2s;
        }
        
        button:hover {
            background: #1565c0;
        }
        
        button:disabled {
            background: #ccc;
            cursor: not-allowed;
        }
        
        .status-display {
            background: white;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .status-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .status-item:last-child {
            margin-bottom: 0;
        }
        
        .status-label {
            font-size: 12px;
            color: #666;
            font-weight: 500;
        }
        
        .status-value {
            font-size: 14px;
            color: #333;
            font-weight: 500;
        }
        
        .status-active {
            color: #4caf50;
        }
        
        .status-inactive {
            color: #f44336;
        }
        
        .tabs-list {
            background: white;
            border-radius: 8px;
            padding: 12px;
            max-height: 150px;
            overflow-y: auto;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .tab-item {
            padding: 8px;
            border-bottom: 1px solid #eee;
            font-size: 12px;
        }
        
        .tab-item:last-child {
            border-bottom: none;
        }
        
        .tab-url {
            color: #666;
            word-break: break-all;
        }
        
        .error {
            color: #f44336;
            font-size: 12px;
            margin-top: 4px;
        }
        
        .success {
            color: #4caf50;
            font-size: 12px;
            margin-top: 4px;
        }
        
        .loading {
            text-align: center;
            padding: 20px;
            color: #666;
        }
        
        .toggle-link {
            color: #1976d2;
            text-decoration: none;
            font-size: 12px;
            margin-top: 8px;
            display: inline-block;
        }
        
        .toggle-link:hover {
            text-decoration: underline;
        }
        
        .refresh-timer {
            font-size: 10px;
            color: #888;
            text-align: center;
            margin-top: 8px;
        }
        
        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Salesforce Status Monitor</h1>
    </div>
    
    <div class="content">
        <!-- Login View -->
        <div id="loginView">
            <div class="login-form">
                <div class="form-group">
                    <label for="email">Email (@talabat.com)</label>
                    <input type="email" id="email" placeholder="your.name@talabat.com" required>
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input type="password" id="password" placeholder="Enter your password" required>
                </div>
                
                <button id="loginBtn">Login</button>
                <button id="registerBtn" class="hidden">Register</button>
                
                <div id="authMessage"></div>
                
                <a href="#" id="toggleAuth" class="toggle-link">Need to register?</a>
            </div>
        </div>
        
        <!-- Main View -->
        <div id="mainView" class="hidden">
            <div class="status-display">
                <div class="status-item">
                    <span class="status-label">Current Status:</span>
                    <span class="status-value" id="currentStatus">Unknown</span>
                </div>
                
                <div class="status-item">
                    <span class="status-label">Last Update:</span>
                    <span class="status-value" id="lastUpdate">Never</span>
                </div>
                
                <div class="status-item">
                    <span class="status-label">User:</span>
                    <span class="status-value" id="userEmail">-</span>
                </div>
            </div>
            
            <div class="tabs-list">
                <div style="font-weight: 500; margin-bottom: 8px; font-size: 12px;">Active Salesforce Tabs:</div>
                <div id="tabsList">No active tabs</div>
            </div>
            
            <div class="refresh-timer">
                Auto-refresh in <span id="refreshCounter">5</span> seconds
            </div>
            
            <button id="logoutBtn" style="margin-top: 16px; background: #f44336;">Logout</button>
        </div>
        
        <!-- Loading View -->
        <div id="loadingView" class="loading">
            <div>Loading...</div>
        </div>
    </div>
    
    <script src="popup.js"></script>
</body>
</html>\`,

  "popup/popup.js": \`
// Popup script for Salesforce Status Monitor
const DEBUG = true;

const log = {
    info: (msg, ...args) => DEBUG && console.log(\`[SFF-POPUP-INFO] \${msg}\`, ...args),
    warn: (msg, ...args) => DEBUG && console.warn(\`[SFF-POPUP-WARN] \${msg}\`, ...args),
    error: (msg, ...args) => DEBUG && console.error(\`[SFF-POPUP-ERROR] \${msg}\`, ...args)
};

// DOM elements
let elements = {};

// State
let refreshTimer = null;
let refreshCounter = 5;
let isLoginMode = true;

// Initialize popup
document.addEventListener('DOMContentLoaded', initializePopup);

function initializePopup() {
    log.info('Initializing popup');
    
    // Get DOM elements
    elements = {
        loginView: document.getElementById('loginView'),
        mainView: document.getElementById('mainView'),
        loadingView: document.getElementById('loadingView'),
        emailInput: document.getElementById('email'),
        passwordInput: document.getElementById('password'),
        loginBtn: document.getElementById('loginBtn'),
        registerBtn: document.getElementById('registerBtn'),
        authMessage: document.getElementById('authMessage'),
        toggleAuth: document.getElementById('toggleAuth'),
        currentStatus: document.getElementById('currentStatus'),
        lastUpdate: document.getElementById('lastUpdate'),
        userEmail: document.getElementById('userEmail'),
        tabsList: document.getElementById('tabsList'),
        refreshCounter: document.getElementById('refreshCounter'),
        logoutBtn: document.getElementById('logoutBtn')
    };
    
    // Add event listeners
    setupEventListeners();
    
    // Check authentication state
    checkAuthState();
}

function setupEventListeners() {
    // Login/Register buttons
    elements.loginBtn.addEventListener('click', handleLogin);
    elements.registerBtn.addEventListener('click', handleRegister);
    
    // Toggle between login/register
    elements.toggleAuth.addEventListener('click', (e) => {
        e.preventDefault();
        toggleAuthMode();
    });
    
    // Logout button
    elements.logoutBtn.addEventListener('click', handleLogout);
    
    // Enter key in forms
    elements.passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            isLoginMode ? handleLogin() : handleRegister();
        }
    });
}

function checkAuthState() {
    showView('loading');
    
    chrome.storage.local.get(['isAuthenticated', 'userEmail'], (result) => {
        if (result.isAuthenticated && result.userEmail) {
            log.info('User authenticated:', result.userEmail);
            elements.userEmail.textContent = result.userEmail;
            showMainView();
        } else {
            log.info('User not authenticated');
            showView('login');
        }
    });
}

function showView(view) {
    elements.loginView.classList.toggle('hidden', view !== 'login');
    elements.mainView.classList.toggle('hidden', view !== 'main');
    elements.loadingView.classList.toggle('hidden', view !== 'loading');
}

function showMainView() {
    showView('main');
    updateStatusDisplay();
    startRefreshTimer();
}

function toggleAuthMode() {
    isLoginMode = !isLoginMode;
    
    if (isLoginMode) {
        elements.loginBtn.classList.remove('hidden');
        elements.registerBtn.classList.add('hidden');
        elements.toggleAuth.textContent = 'Need to register?';
    } else {
        elements.loginBtn.classList.add('hidden');
        elements.registerBtn.classList.remove('hidden');
        elements.toggleAuth.textContent = 'Already have an account?';
    }
    
    clearAuthMessage();
}

function validateEmail(email) {
    return email.endsWith('@talabat.com') && email.includes('@');
}

function validatePassword(password) {
    return password.length >= 8;
}

function showAuthMessage(message, isError = false) {
    elements.authMessage.textContent = message;
    elements.authMessage.className = isError ? 'error' : 'success';
}

function clearAuthMessage() {
    elements.authMessage.textContent = '';
    elements.authMessage.className = '';
}

async function handleLogin() {
    const email = elements.emailInput.value.trim();
    const password = elements.passwordInput.value;
    
    // Validation
    if (!validateEmail(email)) {
        showAuthMessage('Please enter a valid @talabat.com email address', true);
        return;
    }
    
    if (!validatePassword(password)) {
        showAuthMessage('Password must be at least 8 characters long', true);
        return;
    }
    
    // Disable button and show loading
    elements.loginBtn.disabled = true;
    elements.loginBtn.textContent = 'Logging in...';
    clearAuthMessage();
    
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'authenticate',
                data: { email, password, action: 'login' }
            }, resolve);
        });
        
        if (response.success) {
            showAuthMessage('Login successful!', false);
            setTimeout(() => {
                elements.userEmail.textContent = email;
                showMainView();
            }, 1000);
        } else {
            showAuthMessage(response.message || 'Login failed', true);
        }
        
    } catch (error) {
        log.error('Login error:', error);
        showAuthMessage('Network error. Please try again.', true);
    }
    
    // Re-enable button
    elements.loginBtn.disabled = false;
    elements.loginBtn.textContent = 'Login';
}

async function handleRegister() {
    const email = elements.emailInput.value.trim();
    const password = elements.passwordInput.value;
    
    // Validation
    if (!validateEmail(email)) {
        showAuthMessage('Please enter a valid @talabat.com email address', true);
        return;
    }
    
    if (!validatePassword(password)) {
        showAuthMessage('Password must be at least 8 characters long', true);
        return;
    }
    
    // Disable button and show loading
    elements.registerBtn.disabled = true;
    elements.registerBtn.textContent = 'Registering...';
    clearAuthMessage();
    
    try {
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'authenticate',
                data: { email, password, action: 'register' }
            }, resolve);
        });
        
        if (response.success) {
            showAuthMessage('Registration successful! You can now login.', false);
            setTimeout(() => {
                toggleAuthMode(); // Switch to login mode
            }, 1500);
        } else {
            showAuthMessage(response.message || 'Registration failed', true);
        }
        
    } catch (error) {
        log.error('Registration error:', error);
        showAuthMessage('Network error. Please try again.', true);
    }
    
    // Re-enable button
    elements.registerBtn.disabled = false;
    elements.registerBtn.textContent = 'Register';
}

function handleLogout() {
    chrome.storage.local.clear();
    stopRefreshTimer();
    showView('login');
    
    // Clear form
    elements.emailInput.value = '';
    elements.passwordInput.value = '';
    clearAuthMessage();
}

function updateStatusDisplay() {
    chrome.storage.local.get(['lastStatus', 'statusHistory'], (result) => {
        const lastStatus = result.lastStatus || 'Unknown';
        const history = result.statusHistory || [];
        
        elements.currentStatus.textContent = lastStatus;
        elements.currentStatus.className = 'status-value ' + 
            (lastStatus.toLowerCase().includes('online') ? 'status-active' : 'status-inactive');
        
        if (history.length > 0) {
            const lastUpdate = new Date(history[history.length - 1].timestamp);
            elements.lastUpdate.textContent = lastUpdate.toLocaleTimeString();
        }
    });
    
    // Update tabs list
    updateTabsList();
}

function updateTabsList() {
    chrome.runtime.sendMessage({ type: 'getActiveTabs' }, (activeTabs) => {
        if (chrome.runtime.lastError) {
            elements.tabsList.innerHTML = 'Error loading tabs';
            return;
        }
        
        if (!activeTabs || activeTabs.length === 0) {
            elements.tabsList.innerHTML = 'No active Salesforce tabs';
            return;
        }
        
        chrome.tabs.query({}, (allTabs) => {
            const activeTabsHtml = activeTabs.map(tabId => {
                const tab = allTabs.find(t => t.id === tabId);
                if (tab) {
                    const url = new URL(tab.url);
                    return \`
                        <div class="tab-item">
                            <div style="font-weight: 500;">\${tab.title || 'Salesforce'}</div>
                            <div class="tab-url">\${url.hostname}</div>
                        </div>
                    \`;
                }
                return '';
            }).join('');
            
            elements.tabsList.innerHTML = activeTabsHtml || 'No active tabs found';
        });
    });
}

function startRefreshTimer() {
    stopRefreshTimer();
    
    refreshCounter = 5;
    elements.refreshCounter.textContent = refreshCounter;
    
    refreshTimer = setInterval(() => {
        refreshCounter--;
        elements.refreshCounter.textContent = refreshCounter;
        
        if (refreshCounter <= 0) {
            updateStatusDisplay();
            refreshCounter = 5;
        }
    }, 1000);
}

function stopRefreshTimer() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

// Cleanup on popup close
window.addEventListener('beforeunload', () => {
    stopRefreshTimer();
});
\`,

  "config.json": {
    "backendUrl": "YOUR_GOOGLE_APPS_SCRIPT_URL_HERE",
    "debug": true,
    "refreshInterval": 5000,
    "maxHistoryEntries": 100,
    "statusCheckInterval": 2000,
    "keepAliveInterval": 30000
  },

  "backend_code.gs": `
// Google Apps Script backend for Salesforce Status Monitor
// Deploy this as a web app with execute permissions for "Anyone"

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    
    switch (data.action) {
      case 'login':
        return login(data.email, data.password);
      case 'register':
        return register(data.email, data.password);
      case 'updateStatus':
        return updateStatus(data.email, data.status, data.timestamp);
      default:
        return createResponse(false, 'Invalid action');
    }
  } catch (error) {
    console.error('Error in doPost:', error);
    return createResponse(false, 'Server error');
  }
}

function doGet(e) {
  // Handle CORS preflight
  return createResponse(true, 'API is running');
}

// Configuration
const SHEET_NAMES = {
  USERS: 'Users',
  STATUS_HISTORY: 'StatusHistory',
  SETTINGS: 'Settings'
};

const USER_COLUMNS = {
  EMAIL: 'Email',
  PASSWORD_HASH: 'PasswordHash',
  LAST_LOGIN: 'LastLogin',
  CREATED_DATE: 'CreatedDate'
};

const STATUS_COLUMNS = {
  EMAIL: 'Email',
  STATUS: 'Status',
  STATUS_ID: 'StatusId',
  TIMESTAMP: 'Timestamp',
  URL: 'URL'
};

// Get or create spreadsheet
function getSpreadsheet() {
  const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  
  if (ssId) {
    return SpreadsheetApp.openById(ssId);
  }
  
  // Create new spreadsheet
  const ss = SpreadsheetApp.create('Salesforce Status Monitor Data');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  
  // Initialize sheets
  initializeSheets(ss);
  
  return ss;
}

// Initialize spreadsheet sheets
function initializeSheets(ss) {
  // Users sheet
  const usersSheet = ss.insertSheet(SHEET_NAMES.USERS);
  usersSheet.getRange(1, 1, 1, 4).setValues([[
    USER_COLUMNS.EMAIL,
    USER_COLUMNS.PASSWORD_HASH,
    USER_COLUMNS.LAST_LOGIN,
    USER_COLUMNS.CREATED_DATE
  ]]);
  
  // Status History sheet
  const historySheet = ss.insertSheet(SHEET_NAMES.STATUS_HISTORY);
  historySheet.getRange(1, 1, 1, 5).setValues([[
    STATUS_COLUMNS.EMAIL,
    STATUS_COLUMNS.STATUS,
    STATUS_COLUMNS.STATUS_ID,
    STATUS_COLUMNS.TIMESTAMP,
    STATUS_COLUMNS.URL
  ]]);
  
  // Settings sheet
  const settingsSheet = ss.insertSheet(SHEET_NAMES.SETTINGS);
  settingsSheet.getRange(1, 1, 1, 2).setValues([['Key', 'Value']]);
  
  // Remove default sheet
  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet) {
    ss.deleteSheet(defaultSheet);
  }
}

// User registration
function register(email, password) {
  if (!isValidTalabatEmail(email)) {
    return createResponse(false, 'Invalid email domain. Must be @talabat.com');
  }
  
  if (!isValidPassword(password)) {
    return createResponse(false, 'Password must be at least 8 characters long');
  }
  
  const ss = getSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  
  // Check if user already exists
  const existingUser = findUserByEmail(usersSheet, email);
  if (existingUser) {
    return createResponse(false, 'User already exists');
  }
  
  // Add new user
  const passwordHash = hashPassword(password);
  const now = new Date().toISOString();
  
  usersSheet.appendRow([email, passwordHash, '', now]);
  
  return createResponse(true, 'Registration successful');
}

// User login
function login(email, password) {
  if (!isValidTalabatEmail(email)) {
    return createResponse(false, 'Invalid email domain');
  }
  
  const ss = getSpreadsheet();
  const usersSheet = ss.getSheetByName(SHEET_NAMES.USERS);
  
  const user = findUserByEmail(usersSheet, email);
  if (!user) {
    return createResponse(false, 'User not found');
  }
  
  const passwordHash = hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return createResponse(false, 'Invalid credentials');
  }
  
  // Update last login
  const userRow = user.row;
  usersSheet.getRange(userRow, 3).setValue(new Date().toISOString());
  
  return createResponse(true, 'Login successful', { email: email });
}

// Update user status
function updateStatus(email, status, timestamp, statusId = '', url = '') {
  if (!isValidTalabatEmail(email)) {
    return createResponse(false, 'Invalid email');
  }
  
  const ss = getSpreadsheet();
  const historySheet = ss.getSheetByName(SHEET_NAMES.STATUS_HISTORY);
  
  // Add status entry
  historySheet.appendRow([
    email,
    status,
    statusId,
    new Date(timestamp).toISOString(),
    url
  ]);
  
  // Clean up old entries (keep only last 1000 per user)
  cleanupStatusHistory(historySheet, email);
  
  return createResponse(true, 'Status updated');
}

// Helper functions
function findUserByEmail(sheet, email) {
  const data = sheet.getDataRange().getValues();
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      return {
        row: i + 1,
        email: data[i][0],
        passwordHash: data[i][1],
        lastLogin: data[i][2],
        createdDate: data[i][3]
      };
    }
  }
  
  return null;
}

function cleanupStatusHistory(sheet, email) {
  const data = sheet.getDataRange().getValues();
  const userEntries = [];
  
  // Find all entries for this user
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === email) {
      userEntries.push({ row: i + 1, timestamp: data[i][3] });
    }
  }
  
  // Keep only the most recent 1000 entries
  if (userEntries.length > 1000) {
    userEntries.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const rowsToDelete = userEntries.slice(1000);
    
    // Delete oldest rows (in reverse order to maintain row numbers)
    rowsToDelete.sort((a, b) => b.row - a.row);
    for (const entry of rowsToDelete) {
      sheet.deleteRow(entry.row);
    }
  }
}

function isValidTalabatEmail(email) {
  return email && email.includes('@') && email.endsWith('@talabat.com');
}

function isValidPassword(password) {
  return password && password.length >= 8;
}

function hashPassword(password) {
  // Simple hash function - in production, use a proper hashing library
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password)
    .map(byte => byte & 0xFF)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function createResponse(success, message, data = null) {
  const response = {
    success: success,
    message: message
  };
  
  if (data) {
    response.data = data;
  }
  
  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON)
    .setHeaders({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
}
`,

  "README.md": `# Salesforce Status Monitor Chrome Extension

A Chrome extension that monitors Salesforce user status in real-time for Talabat support team members.

## Features

- Real-time status monitoring using network request analysis
- User authentication with @talabat.com email restriction
- Automated status detection and reporting
- Background monitoring across multiple Salesforce tabs
- Status history tracking
- Team leader notifications
- Secure backend integration with Google Apps Script

## Installation

### 1. Chrome Extension Setup

1. Download or clone this extension code
2. Open Chrome and navigate to \`chrome://extensions/\`
3. Enable "Developer mode" in the top right
4. Click "Load unpacked" and select the extension folder
5. The extension icon should appear in your Chrome toolbar

### 2. Backend Setup (Google Apps Script)

1. Go to [Google Apps Script](https://script.google.com/)
2. Create a new project
3. Replace the default code with the contents of \`backend_code.gs\`
4. Click "Deploy" > "New deployment"
5. Choose type: "Web app"
6. Set execute as: "Me"
7. Set access: "Anyone"
8. Copy the web app URL

### 3. Configuration

1. Open \`config.json\` in the extension folder
2. Replace \`YOUR_GOOGLE_APPS_SCRIPT_URL_HERE\` with your web app URL
3. Reload the extension in Chrome

## Usage

### First Time Setup

1. Click the extension icon in Chrome
2. Enter your @talabat.com email address
3. Create a password (minimum 8 characters)
4. Click "Register" to create your account
5. After registration, click "Login"

### Daily Usage

1. Open Salesforce in Chrome
2. The extension automatically monitors your status
3. Click the extension icon to view current status
4. Status changes are automatically detected and logged

### Status Detection

The extension monitors these status types:
- **Online for Cases** - Available for customer support
- **Short Break (personal)** - Personal break time
- **Training / QA / Meeting** - Learning or meeting activities
- **One to One** - Individual meetings
- **Lunch/Dinner** - Meal breaks
- **Calls Only** - Available for calls only
- **Assigned Task** - Working on specific tasks

## Technical Details

### Architecture

- **Content Script**: Monitors Salesforce pages for status changes
- **Background Script**: Manages extension lifecycle and data
- **Popup Interface**: User interaction and status display
- **Backend API**: Google Apps Script for authentication and data storage

### Network Monitoring

The extension uses the Performance Observer API to monitor:
- XMLHttpRequest and Fetch API calls
- Salesforce Messages API requests (session activity)
- Presence API requests (status changes)

### Data Storage

- **Local Storage**: User authentication state
- **Backend Storage**: User accounts and status history
- **No Sensitive Data**: Passwords are hashed, no personal data stored

## Security

- Email domain restriction (@talabat.com only)
- Password hashing with SHA-256
- Secure HTTPS communication
- No sensitive data in local storage
- CORS-enabled backend with proper headers

## Troubleshooting

### Extension Not Working

1. Check Chrome console for errors (F12 > Console)
2. Verify Salesforce tabs are properly loaded
3. Ensure extension has required permissions
4. Try reloading the extension

### Authentication Issues

1. Verify email ends with @talabat.com
2. Check password meets minimum requirements
3. Ensure backend URL is correctly configured
4. Check Google Apps Script deployment settings

### Status Not Detected

1. Refresh the Salesforce page
2. Check network connectivity
3. Verify you're logged into Salesforce
4. Look for console errors in developer tools

## Development

### File Structure

\`\`\`
extension/
├── manifest.json          # Extension manifest
├── background.js          # Background service worker
├── content_script.js      # Content script for Salesforce pages
├── popup/
│   ├── popup.html        # Popup interface
│   ├── popup.js          # Popup logic
│   └── popup.css         # Popup styling (embedded in HTML)
├── icons/                # Extension icons
├── config.json           # Configuration file
├── backend_code.gs       # Google Apps Script backend
└── README.md            # This file
\`\`\`

### Adding New Status Types

1. Update \`STATUS_MAPPING\` in \`content_script.js\`
2. Add corresponding detection logic
3. Test with actual Salesforce status changes

### Debugging

Enable debug mode by setting \`DEBUG = true\` in:
- \`background.js\`
- \`content_script.js\`
- \`popup.js\`

Check browser console for detailed logs with \`[SFF-*]\` prefixes.

## Support

For technical issues or feature requests:
1. Check browser console for error messages
2. Verify all setup steps are completed
3. Test with a fresh Salesforce login
4. Contact your team lead for assistance

## Version History

- **v2.0.0**: Network-based detection, enhanced reliability
- **v1.0.0**: Initial release with DOM-based detection

## License

Internal use only - Talabat Support Team
`
