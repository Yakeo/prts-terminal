// REPLACE THIS URL WITH YOUR GOOGLE APPS SCRIPT WEB APP URL
const API_URL = "https://script.google.com/macros/s/AKfycbz9ivBZxvB0AkK8uZ1rx70zXJQpgARqXfmxavyT2iGfmRmVHZ5_9mX9ybzg49FcHb8c/exec";

// Global Memory State (Synced with Database)
let userDatabase = [];
let inventory = { lmd: 0, exp: 0, sugar: 0 };
let auditLogs = [];
let currentUser = null;

// Initialize & Fetch Live Data from Google Sheets API
document.addEventListener('DOMContentLoaded', () => {
  fetchCloudData();

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('hidden');
    });
  }
});

// GET Request to Cloud DB
async function fetchCloudData() {
  const errorElement = document.getElementById('loginError');
  if (errorElement) errorElement.innerText = "Connecting to PRTS Cloud DB...";

  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    userDatabase = data.users || [];
    inventory = data.inventory || { lmd: 0, exp: 0, sugar: 0 };
    auditLogs = data.logs || [];

    updateAllDisplays();
    renderAuditLogs();

    if (errorElement) errorElement.innerText = "";
  } catch (err) {
    console.error("Cloud Fetch Error:", err);
    if (errorElement) errorElement.innerText = "ERR: Failed to connect to Cloud Database.";
  }
}

// POST Sync Engine (Inventory & Logs)
async function syncToCloud(actionType, logEntry = null) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Avoid CORS preflight flags
      body: JSON.stringify({
        actionType: actionType,
        inventory: inventory,
        log: logEntry
      })
    });
  } catch (err) {
    console.error("Cloud Sync Error:", err);
  }
}

// User Authentication Engine
function authenticateUser() {
  const userInput = document.getElementById('loginUser').value.trim().toLowerCase();
  const passInput = document.getElementById('loginPass').value.trim();
  const errorElement = document.getElementById('loginError');

  if (!userInput || !passInput) {
    errorElement.innerText = "REJECTED: Enter both Personnel ID and Passcode.";
    return;
  }

  const foundUser = userDatabase.find(u => u.username === userInput && u.pass === passInput);

  if (!foundUser) {
    errorElement.innerText = "ACCESS DENIED: Invalid Personnel ID or Passcode.";
    addAuditLog("AUTH_FAILED", `Failed login attempt for ID: '${userInput}'`);
    return;
  }

  currentUser = foundUser;
  errorElement.innerText = "";
  document.getElementById('loginModal').classList.add('hidden');
  
  document.getElementById('currentUserDisplay').innerText = `${currentUser.displayName} (${currentUser.role})`;
  document.getElementById('dashRoleDisplay').innerText = `${currentUser.displayName} [${currentUser.role}]`;

  addAuditLog("LOGIN", `User '${currentUser.displayName}' authenticated as ${currentUser.role}.`);
  applyRBAC();
  
  document.getElementById('loginUser').value = "";
  document.getElementById('loginPass').value = "";
}

function logout() {
  currentUser = null;
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('currentUserDisplay').innerText = "UNAUTHENTICATED";
  document.getElementById('dashRoleDisplay').innerText = "None";
}

// RBAC Rules
function applyRBAC() {
  const restockBtn = document.getElementById('nav-restock');
  const upgradeBtn = document.getElementById('nav-upgrades');

  if (!currentUser) return;

  if (currentUser.role === "Read-Only") {
    restockBtn.classList.add('opacity-50', 'pointer-events-none');
    upgradeBtn.classList.add('opacity-50', 'pointer-events-none');
    switchTab('warehouse');
  } else {
    restockBtn.classList.remove('opacity-50', 'pointer-events-none');
    upgradeBtn.classList.remove('opacity-50', 'pointer-events-none');
    switchTab('dashboard');
  }
}

// Navigation Tab Switching
function switchTab(tabName) {
  const views = document.querySelectorAll('.tab-view');
  views.forEach(view => view.classList.add('hidden'));

  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  updateAllDisplays();
}

// Render stock UI
function updateAllDisplays() {
  if (document.getElementById('stock-lmd')) document.getElementById('stock-lmd').innerText = (inventory.lmd || 0).toLocaleString();
  if (document.getElementById('stock-exp')) document.getElementById('stock-exp').innerText = (inventory.exp || 0).toLocaleString();
  if (document.getElementById('stock-sugar')) document.getElementById('stock-sugar').innerText = (inventory.sugar || 0).toLocaleString();

  if (document.getElementById('wh-lmd')) document.getElementById('wh-lmd').innerText = (inventory.lmd || 0).toLocaleString();
  if (document.getElementById('wh-exp')) document.getElementById('wh-exp').innerText = (inventory.exp || 0).toLocaleString();
  if (document.getElementById('wh-sugar')) document.getElementById('wh-sugar').innerText = (inventory.sugar || 0).toLocaleString();
}

// Security Audit Logger
function addAuditLog(action, details) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const userName = currentUser ? currentUser.displayName : "SYSTEM";
  const logEntry = { timestamp, user: userName, action, details };

  auditLogs.unshift(logEntry);
  renderAuditLogs();

  // Push log entry to Google Sheets
  syncToCloud("ADD_LOG", logEntry);
}

function renderAuditLogs() {
  const logTable = document.getElementById('auditLogTable');
  if (!logTable) return;

  logTable.innerHTML = auditLogs.map(log => `
    <tr>
      <td class="py-2 text-slate-500">${log.timestamp}</td>
      <td class="py-2 text-cyan-400 font-bold">${log.user}</td>
      <td class="py-2 ${log.action === 'DEDUCT' || log.action === 'AUTH_FAILED' ? 'text-amber-400' : 'text-emerald-400'}">${log.action}</td>
      <td class="py-2 text-slate-300">${log.details}</td>
    </tr>
  `).join('');
}

// Process Inventory Consumption (Stock Out)
function processUpgrade() {
  if (currentUser && currentUser.role === "Read-Only") return;

  const operator = document.getElementById('operatorSelect').value;
  const itemKey = document.getElementById('itemSelect').value;
  const qtyInput = document.getElementById('deductQty');
  const qty = parseInt(qtyInput.value, 10);
  const statusMsg = document.getElementById('statusMessage');

  if (isNaN(qty) || qty <= 0) {
    statusMsg.className = "mt-4 text-xs font-mono text-red-400";
    statusMsg.innerText = "ERR: Invalid transaction quantity.";
    return;
  }

  if (inventory[itemKey] < qty) {
    statusMsg.className = "mt-4 text-xs font-mono text-red-500 font-bold";
    statusMsg.innerText = `REJECTED: Insufficient ${itemKey.toUpperCase()} available.`;
    addAuditLog("REJECTED", `Attempted to deduct ${qty} ${itemKey.toUpperCase()} for ${operator} (Insufficient Stock).`);
    return;
  }

  inventory[itemKey] -= qty;
  updateAllDisplays();

  statusMsg.className = "mt-4 text-xs font-mono text-emerald-400";
  statusMsg.innerText = `SUCCESS: Deducted ${qty} ${itemKey.toUpperCase()} for ${operator}.`;
  
  const logEntry = { 
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19), 
    user: currentUser.displayName, 
    action: "DEDUCT", 
    details: `Deducted ${qty.toLocaleString()} ${itemKey.toUpperCase()} for Operator ${operator}.` 
  };

  auditLogs.unshift(logEntry);
  renderAuditLogs();
  qtyInput.value = "";

  // Sync back to Google Sheets Database
  syncToCloud("UPDATE_INVENTORY", logEntry);
}

// Process Inventory Restock (Stock In)
function processRestock() {
  if (currentUser && currentUser.role === "Read-Only") return;

  const itemKey = document.getElementById('restockItem').value;
  const qtyInput = document.getElementById('restockQty');
  const qty = parseInt(qtyInput.value, 10);
  const restockMsg = document.getElementById('restockMsg');

  if (isNaN(qty) || qty <= 0) {
    restockMsg.className = "text-xs font-mono text-red-400";
    restockMsg.innerText = "ERR: Enter a valid positive number.";
    return;
  }

  inventory[itemKey] += qty;
  updateAllDisplays();

  restockMsg.className = "text-xs font-mono text-emerald-400";
  restockMsg.innerText = `ADDED: +${qty} ${itemKey.toUpperCase()} to Warehouse.`;

  const logEntry = { 
    timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19), 
    user: currentUser.displayName, 
    action: "RESTOCK", 
    details: `Added +${qty.toLocaleString()} ${itemKey.toUpperCase()} from Operation Rewards.` 
  };

  auditLogs.unshift(logEntry);
  renderAuditLogs();
  qtyInput.value = "";

  // Sync back to Google Sheets Database
  syncToCloud("UPDATE_INVENTORY", logEntry);
}

// Threshold definitions for low-stock alerts
const LOW_STOCK_THRESHOLDS = {
  lmd: 50000,
  exp: 100,
  sugar: 10
};

// Check for low stock and update the dashboard warning banner
function checkStockAlerts() {
  const alertBanner = document.getElementById('alertBanner');
  const alertDetails = document.getElementById('alertDetails');
  if (!alertBanner || !alertDetails) return;

  const lowItems = [];
  if (inventory.lmd < LOW_STOCK_THRESHOLDS.lmd) lowItems.push(`LMD (${inventory.lmd.toLocaleString()})`);
  if (inventory.exp < LOW_STOCK_THRESHOLDS.exp) lowItems.push(`Battle Records (${inventory.exp})`);
  if (inventory.sugar < LOW_STOCK_THRESHOLDS.sugar) lowItems.push(`Sugar Packs (${inventory.sugar})`);

  if (lowItems.length > 0) {
    alertBanner.classList.remove('hidden');
    alertDetails.innerText = `Critically low supply detected: ${lowItems.join(', ')}. Restock required.`;
  } else {
    alertBanner.classList.add('hidden');
  }
}

// Modify existing updateAllDisplays to trigger stock checks
const originalUpdateAllDisplays = updateAllDisplays;
updateAllDisplays = function() {
  if (typeof originalUpdateAllDisplays === 'function') {
    originalUpdateAllDisplays();
  }
  checkStockAlerts();
};

// Security Audit Log Filter Engine
function filterAuditLogs() {
  const searchTerm = (document.getElementById('logSearchInput')?.value || '').toLowerCase();
  const selectedAction = document.getElementById('logActionFilter')?.value || 'ALL';

  const filtered = auditLogs.filter(log => {
    const matchesSearch = log.user.toLowerCase().includes(searchTerm) || 
                          log.details.toLowerCase().includes(searchTerm) ||
                          log.action.toLowerCase().includes(searchTerm);
                          
    const matchesAction = selectedAction === 'ALL' || log.action === selectedAction;

    return matchesSearch && matchesAction;
  });

  renderLogTable(filtered);
}

function clearLogFilters() {
  if (document.getElementById('logSearchInput')) document.getElementById('logSearchInput').value = '';
  if (document.getElementById('logActionFilter')) document.getElementById('logActionFilter').value = 'ALL';
  renderLogTable(auditLogs);
}

// Render log helper
function renderLogTable(logsToRender) {
  const logTable = document.getElementById('auditLogTable');
  if (!logTable) return;

  if (logsToRender.length === 0) {
    logTable.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-600 italic">No matching security logs found.</td></tr>`;
    return;
  }

  logTable.innerHTML = logsToRender.map(log => `
    <tr>
      <td class="py-2 text-slate-500">${log.timestamp}</td>
      <td class="py-2 text-cyan-400 font-bold">${log.user}</td>
      <td class="py-2 ${
        log.action === 'DEDUCT' || log.action === 'AUTH_FAILED' ? 'text-amber-400' : 
        log.action === 'REJECTED' ? 'text-red-400' : 'text-emerald-400'
      }">${log.action}</td>
      <td class="py-2 text-slate-300">${log.details}</td>
    </tr>
  `).join('');
}

// Ensure log filtering ties into your main log rendering function
renderAuditLogs = function() {
  filterAuditLogs();
};