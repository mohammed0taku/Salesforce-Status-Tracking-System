
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
