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
