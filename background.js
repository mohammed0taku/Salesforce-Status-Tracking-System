`
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
`
