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
