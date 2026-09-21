const API_URL = "https://script.google.com/macros/s/AKfycbz9ivBZxvB0AkK8uZ1rx70zXJQpgARqXfmxavyT2iGfmRmVHZ5_9mX9ybzg49FcHb8c/exec";

let userDatabase = [];
let inventory = { lmd: 0, exp: 0, sugar: 0 };
let auditLogs = [];
let currentUser = null;
let pendingUser = null;
let generatedOTP = null;

// EXPANDED OPERATORS DATABASE WITH PROMOTION STATES & MULTI-ITEM REQUIREMENTS
let OPERATORS = [
  { 
    id: "Amiya", 
    name: "Amiya", 
    class: "Caster", 
    rarity: 5, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_002_amiya.png",
    elite: 0,
    level: 50,
    maxLevel: 50,
    requirements: {
      lmd: 50000,
      exp: 200,
      sugar: 5
    }
  },
  { 
    id: "Chen", 
    name: "Ch'en", 
    class: "Guard", 
    rarity: 6, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_010_chen.png",
    elite: 1,
    level: 80,
    maxLevel: 80,
    requirements: {
      lmd: 180000,
      exp: 500,
      sugar: 10
    }
  },
  { 
    id: "Kaltsit", 
    name: "Kal'tsit", 
    class: "Medic", 
    rarity: 6, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_003_kalts.png",
    elite: 1,
    level: 80,
    maxLevel: 80,
    requirements: {
      lmd: 180000,
      exp: 450,
      sugar: 8
    }
  },
  { 
    id: "Exusiai", 
    name: "Exusiai", 
    class: "Sniper", 
    rarity: 6, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_103_angel.png",
    elite: 1,
    level: 80,
    maxLevel: 80,
    requirements: {
      lmd: 180000,
      exp: 400,
      sugar: 5
    }
  },
  { 
    id: "Surtr", 
    name: "Surtr", 
    class: "Guard", 
    rarity: 6, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_350_surtr.png",
    elite: 0,
    level: 50,
    maxLevel: 50,
    requirements: {
      lmd: 30000,
      exp: 150,
      sugar: 3
    }
  },
  { 
    id: "Texas", 
    name: "Texas", 
    class: "Vanguard", 
    rarity: 5, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_102_texas.png",
    elite: 0,
    level: 50,
    maxLevel: 50,
    requirements: {
      lmd: 40000,
      exp: 180,
      sugar: 4
    }
  },
  { 
    id: "Saria", 
    name: "Saria", 
    class: "Defender", 
    rarity: 6, 
    avatar: "https://raw.githubusercontent.com/Aceship/Arknight-Images/main/avatars/char_202_demhar.png",
    elite: 1,
    level: 80,
    maxLevel: 80,
    requirements: {
      lmd: 180000,
      exp: 500,
      sugar: 12
    }
  }
];

document.addEventListener('DOMContentLoaded', () => {
  // Load saved operator states from local storage if available
  const savedOperators = localStorage.getItem('prts_operators');
  if (savedOperators) {
    try {
      OPERATORS = JSON.parse(savedOperators);
    } catch (e) {
      console.error("Failed to parse saved operators", e);
    }
  }

  fetchCloudData();
  populateOperatorDropdown();

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('hidden');
    });
  }
});

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
    populateItemDropdowns();
    renderAuditLogs();

    if (errorElement) errorElement.innerText = "";
  } catch (err) {
    console.error("Cloud Fetch Error:", err);
    if (errorElement) errorElement.innerText = "ERR: Failed to connect to Cloud Database.";
  }
}

async function syncToCloud(actionType, payloadData) {
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        actionType: actionType,
        ...payloadData
      })
    });
  } catch (err) {
    console.error("Cloud Sync Error:", err);
  }
}

let failedLoginAttempts = 0;
let isLockedOut = false;

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function authenticateUser() {
  const userInput = document.getElementById('loginUser').value.trim().toLowerCase();
  const passInput = document.getElementById('loginPass').value.trim().replace(/^["']|["']$/g, '');
  const errorElement = document.getElementById('loginError');

  if (isLockedOut) {
    errorElement.innerText = "SECURITY ALERT: Terminal locked due to repeated attempts. Try again in 30 seconds.";
    return;
  }

  if (!userInput || !passInput) {
    errorElement.innerText = "REJECTED: Enter both Personnel ID/Email and Passcode.";
    return;
  }

  const hashedInput = await hashPassword(passInput);
  const foundUser = userDatabase.find(
    u => u.username === userInput || u.email?.toLowerCase() === userInput
  );

  console.log("Input Plain:", passInput);
  console.log("Input Hashed:", hashedInput);
  console.log("DB User Found:", foundUser);

  const isValidPassword = foundUser && (foundUser.pass === hashedInput || foundUser.pass === passInput);

  if (!foundUser || !isValidPassword) {
    failedLoginAttempts++;
    if (failedLoginAttempts >= 3) {
      isLockedOut = true;
      errorElement.innerText = "SECURITY ALERT: 3 Failed Attempts. TERMINAL LOCKED OUT FOR 30s.";
      addAuditLog("BRUTE_FORCE_LOCKOUT", `Terminal locked after 3 failed attempts for ID: '${userInput}'`);
      setTimeout(() => {
        isLockedOut = false;
        failedLoginAttempts = 0;
        if (errorElement) errorElement.innerText = "Terminal unlocked. Please retry credentials.";
      }, 30000);
      return;
    }

    errorElement.innerText = `ACCESS DENIED: Invalid Credentials (${3 - failedLoginAttempts} attempts remaining).`;
    addAuditLog("AUTH_FAILED", `Failed login attempt for ID: '${userInput}'`);
    return;
  }

  failedLoginAttempts = 0;
  isLockedOut = false;
  pendingUser = foundUser;
  
  errorElement.innerText = "Credentials verified. Dispatching 2FA Code via email...";

  try {
    generatedOTP = Math.floor(100000 + Math.random() * 900000).toString();

    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        actionType: 'SEND_2FA_CODE',
        username: pendingUser.username,
        code: generatedOTP
      })
    });

    document.getElementById('loginModal').classList.add('hidden');
    document.getElementById('otpModal').classList.remove('hidden');
    errorElement.innerText = "";
  } catch (err) {
    console.error("2FA Error:", err);
    errorElement.innerText = "ERR: Failed to connect to email verification service.";
  }
}

function verify2FACode() {
  const enteredCode = document.getElementById('otpInput').value.trim();
  const otpError = document.getElementById('otpError');

  if (enteredCode !== generatedOTP) {
    otpError.innerText = "INVALID PASSCODE: Verification failed.";
    addAuditLog("2FA_FAILED", `Invalid 2FA code entered for user: '${pendingUser.displayName}'`);
    return;
  }

  currentUser = pendingUser;
  pendingUser = null;
  generatedOTP = null;

  document.getElementById('otpModal').classList.add('hidden');
  document.getElementById('currentUserDisplay').innerText = `${currentUser.displayName} (${currentUser.role})`;
  document.getElementById('dashRoleDisplay').innerText = `${currentUser.displayName} [${currentUser.role}]`;

  addAuditLog("LOGIN", `User '${currentUser.displayName}' authenticated with SHA-256 + 2FA.`);
  applyRBAC();

  document.getElementById('loginUser').value = "";
  document.getElementById('loginPass').value = "";
  document.getElementById('otpInput').value = "";
  otpError.innerText = "";
}

function logout() {
  currentUser = null;
  document.getElementById('loginModal').classList.remove('hidden');
  document.getElementById('currentUserDisplay').innerText = "UNAUTHENTICATED";
  document.getElementById('dashRoleDisplay').innerText = "None";
}

// RBAC Rules
function applyRBAC() {
  if (!currentUser) return;

  const role = currentUser.role;

  const restockBtn = document.getElementById('nav-restock');
  const upgradeBtn = document.getElementById('nav-upgrades');
  const logsBtn = document.querySelector("button[onclick*='logs']");
  const accessBtn = document.querySelector("button[onclick*='access']");
  const adminPanel = document.getElementById('adminCreatePersonnelCard');

  [restockBtn, upgradeBtn, logsBtn, accessBtn].forEach(btn => {
    if (btn) {
      btn.classList.remove('opacity-40', 'pointer-events-none', 'hidden');
    }
  });

  if (role === 'Admin') {
    if (adminPanel) adminPanel.classList.remove('hidden');
    switchTab('dashboard');

  } else if (role === 'Manager') {
    if (logsBtn) logsBtn.classList.add('opacity-40', 'pointer-events-none');
    if (accessBtn) accessBtn.classList.add('opacity-40', 'pointer-events-none');
    if (adminPanel) adminPanel.classList.add('hidden');
    switchTab('dashboard');

  } else { 
    if (restockBtn) restockBtn.classList.add('opacity-40', 'pointer-events-none');
    if (upgradeBtn) upgradeBtn.classList.add('opacity-40', 'pointer-events-none');
    if (logsBtn) logsBtn.classList.add('opacity-40', 'pointer-events-none');
    if (accessBtn) accessBtn.classList.add('opacity-40', 'pointer-events-none');
    if (adminPanel) adminPanel.classList.add('hidden');
    
    switchTab('warehouse');
  }
}

// Admin provision personnel
async function adminProvisionUser() {
  if (!currentUser || currentUser.role !== 'Admin') {
    alert("ACCESS DENIED: Only Admin personnel can provision accounts.");
    return;
  }

  const username = document.getElementById('adminRegUser').value.trim().toLowerCase();
  const displayName = document.getElementById('adminRegDisplayName').value.trim();
  const email = document.getElementById('adminRegEmail').value.trim();
  const pass = document.getElementById('adminRegPass').value.trim();
  const role = document.getElementById('adminRegRole').value;
  const regMsg = document.getElementById('adminRegMsg');

  if (!username || !displayName || !email || !pass) {
    regMsg.className = "mt-2 text-xs font-mono text-red-400";
    regMsg.innerText = "ERR: All fields are required.";
    return;
  }

  regMsg.className = "mt-2 text-xs font-mono text-cyan-400";
  regMsg.innerText = "Provisioning personnel record...";

  const passHash = await hashPassword(pass);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        actionType: "REGISTER_USER",
        username,
        displayName,
        email,
        passHash,
        role
      })
    });

    const result = await response.json();

    if (result.status === "SUCCESS") {
      userDatabase.push({ username, pass: passHash, displayName, role, email });
      addAuditLog("ADMIN_PROVISION", `Admin '${currentUser.displayName}' created account '${displayName}' as [${role}].`);
      
      regMsg.className = "mt-2 text-xs font-mono text-emerald-400";
      regMsg.innerText = `SUCCESS: Account for ${displayName} [${role}] provisioned.`;

      document.getElementById('adminRegUser').value = "";
      document.getElementById('adminRegDisplayName').value = "";
      document.getElementById('adminRegEmail').value = "";
      document.getElementById('adminRegPass').value = "";
    } else {
      regMsg.className = "mt-2 text-xs font-mono text-red-400";
      regMsg.innerText = "ERR: Account ID already exists or database error.";
    }
  } catch (err) {
    regMsg.className = "mt-2 text-xs font-mono text-red-400";
    regMsg.innerText = "ERR: Connection failed.";
  }
}

// Navigation Tab Switching
function switchTab(tabName) {
  if (currentUser?.role === 'Read-Only' && ['restock', 'upgrades', 'logs'].includes(tabName)) {
    alert("ACCESS DENIED: Read-Only personnel clearance level insufficient.");
    return;
  }

  const views = document.querySelectorAll('.tab-view');
  views.forEach(view => view.classList.add('hidden'));

  const activeView = document.getElementById(`view-${tabName}`);
  if (activeView) activeView.classList.remove('hidden');

  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.querySelector(`button[onclick*='${tabName}']`);
  if (activeBtn) activeBtn.classList.add('active');

  updateAllDisplays();
}

// POPULATE OPERATOR SELECT DROPDOWN
function populateOperatorDropdown() {
  const select = document.getElementById('operatorSelect');
  if (!select) return;

  select.innerHTML = '';
  OPERATORS.forEach(op => {
    const opt = document.createElement('option');
    opt.value = op.id;
    opt.textContent = `${op.name} (${'★'.repeat(op.rarity)} | Elite ${op.elite})`;
    select.appendChild(opt);
  });

  loadSelectedOperatorProfile();
}

// UPDATE OPERATOR DISPLAY CARD & MATERIAL REQUIREMENTS
function loadSelectedOperatorProfile() {
  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const opId = select.value;
  const op = OPERATORS.find(o => o.id === opId);
  if (!op) return;

  // Update Profile Card
  const imgElem = document.getElementById('opPreviewImg');
  const nameElem = document.getElementById('opPreviewName');
  const classElem = document.getElementById('opPreviewClass') || document.getElementById('opPreviewInfo');
  const eliteElem = document.getElementById('opEliteDisplay');
  const levelElem = document.getElementById('opLevelDisplay');
  const maxLevelElem = document.getElementById('opMaxLevelDisplay');

  if (imgElem) imgElem.src = op.avatar;
  if (nameElem) nameElem.innerText = op.name;
  if (classElem) classElem.innerText = `${'★'.repeat(op.rarity)} | ${op.class}`;
  if (eliteElem) eliteElem.innerText = `Elite ${op.elite}`;
  if (levelElem) levelElem.innerText = `Lv. ${op.level}`;
  if (maxLevelElem) maxLevelElem.innerText = op.maxLevel;

  // Update Stage Indicators
  const stageCurrent = document.getElementById('stageCurrent');
  const stageTarget = document.getElementById('stageTarget');
  if (stageCurrent) stageCurrent.innerText = `Elite ${op.elite}`;
  if (stageTarget) stageTarget.innerText = op.elite >= 2 ? `MAX` : `Elite ${op.elite + 1}`;

  // Render Material Requirements Grid
  const grid = document.getElementById('requiredMaterialsGrid');
  if (!grid) return;

  grid.innerHTML = '';
  let hasEnoughMaterials = true;

  Object.entries(op.requirements).forEach(([matKey, reqQty]) => {
    const currentStock = inventory[matKey] || 0;
    const isSufficient = currentStock >= reqQty;
    if (!isSufficient) hasEnoughMaterials = false;

    const card = document.createElement('div');
    card.className = `p-3 border text-center font-mono ${
      isSufficient ? 'bg-slate-950 border-slate-800' : 'bg-red-950/20 border-red-500/50'
    }`;

    card.innerHTML = `
      <div class="text-[10px] text-slate-400 uppercase truncate mb-1">${matKey.toUpperCase()}</div>
      <div class="text-base font-bold ${isSufficient ? 'text-cyan-400' : 'text-red-400'}">
        ${currentStock.toLocaleString()} / <span class="text-slate-300">${reqQty.toLocaleString()}</span>
      </div>
      <div class="text-[9px] mt-1 ${isSufficient ? 'text-emerald-400' : 'text-red-400'}">
        ${isSufficient ? '✓ SUFFICIENT' : '✕ INSUFFICIENT'}
      </div>
    `;
    grid.appendChild(card);
  });

  // Enable/Disable Action Button
  const btn = document.getElementById('btnInitiatePromotion') || document.getElementById('btnOpenUpgradeModal');
  if (btn) {
    if (op.elite >= 2) {
      btn.disabled = true;
      btn.innerText = "MAX ELITE PHASE REACHED";
      btn.className = "w-full py-4 bg-slate-800 text-slate-500 font-bold text-sm tracking-widest uppercase cursor-not-allowed";
    } else if (!hasEnoughMaterials) {
      btn.disabled = true;
      btn.innerText = "INSUFFICIENT RESOURCES IN DEPOT";
      btn.className = "w-full py-4 bg-slate-800 text-red-400 border border-red-500/30 font-bold text-sm tracking-widest uppercase cursor-not-allowed";
    } else {
      btn.disabled = false;
      btn.innerText = "⚡ Promote Operator";
      btn.className = "prts-btn w-full py-4 bg-cyan-400 hover:bg-cyan-300 text-slate-950 font-black text-sm tracking-widest uppercase transition-all shadow-[0_0_15px_rgba(0,240,255,0.3)]";
    }
  }
}

// OPEN PROMOTION POPUP MODAL
function openPromotionModal() {
  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const op = OPERATORS.find(o => o.id === select.value);
  if (!op) return;

  const titleElem = document.getElementById('modalPromoteTitle') || document.getElementById('modalOpName');
  if (titleElem) titleElem.innerText = `Promote ${op.name} to Elite ${op.elite + 1}`;

  const listContainer = document.getElementById('modalMaterialsList');
  if (listContainer) {
    listContainer.innerHTML = '';
    Object.entries(op.requirements).forEach(([matKey, reqQty]) => {
      const row = document.createElement('div');
      row.className = "flex justify-between items-center";
      row.innerHTML = `
        <span class="text-slate-300 uppercase">${matKey}:</span>
        <span class="text-red-400 font-bold">-${reqQty.toLocaleString()}</span>
      `;
      listContainer.appendChild(row);
    });
  }

  const authUserElem = document.getElementById('modalAuthUser');
  if (authUserElem) authUserElem.innerText = currentUser ? currentUser.username : 'Doctor';

  const modal = document.getElementById('promotionModal') || document.getElementById('upgradeModal');
  if (modal) modal.classList.remove('hidden');
}

// CLOSE PROMOTION MODAL
function closePromotionModal() {
  const modal = document.getElementById('promotionModal') || document.getElementById('upgradeModal');
  if (modal) modal.classList.add('hidden');
}

// EXECUTE PROMOTION & SAVE STATE
function executePromotion() {
  if (currentUser && currentUser.role === "Read-Only") return;

  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const op = OPERATORS.find(o => o.id === select.value);
  if (!op) return;

  // 1. Deduct Materials from Inventory
  Object.entries(op.requirements).forEach(([matKey, reqQty]) => {
    if (inventory[matKey] !== undefined) {
      inventory[matKey] -= reqQty;
      // Sync each deducted item back to Google Sheets
      syncToCloud("UPDATE_INVENTORY", {
        itemKey: matKey,
        newQty: inventory[matKey]
      });
    }
  });

  // 2. Advance Operator Stats
  op.elite += 1;
  op.level = 1; // Resets level on promotion
  op.maxLevel = op.elite === 2 ? 90 : 80;

  // Scale requirement values for Elite 2
  if (op.elite === 1) {
    op.requirements = {
      lmd: 180000,
      exp: 600,
      sugar: 15
    };
  }

  closePromotionModal();

  // 3. Persist Operator Progress Locally
  localStorage.setItem('prts_operators', JSON.stringify(OPERATORS));

  // 4. Log Action
  addAuditLog("PROMOTION", `Promoted Operator ${op.name} to Elite ${op.elite}.`);

  // 5. Refresh UI Displays
  updateAllDisplays();
  populateOperatorDropdown();

  const statusMsg = document.getElementById('statusMessage');
  if (statusMsg) {
    statusMsg.className = "mt-4 text-xs font-mono text-emerald-400 font-bold";
    statusMsg.innerText = `SUCCESS: ${op.name} promoted to Elite ${op.elite}!`;
  }
}

// Legacy Modal compatibility aliases
function openUpgradeConfirmModal() { openPromotionModal(); }
function closeUpgradeConfirmModal() { closePromotionModal(); }
function executeConfirmedUpgrade() { executePromotion(); }

// Populate Item Options into Restock dropdowns
function populateItemDropdowns() {
  const itemKeys = Object.keys(inventory);
  const restockSelect = document.getElementById('restockItem');
  const itemSelect = document.getElementById('itemSelect');

  const optionsHTML = itemKeys.map(key => 
    `<option value="${key}">${key.toUpperCase()}</option>`
  ).join('');

  if (restockSelect) restockSelect.innerHTML = optionsHTML;
  if (itemSelect) itemSelect.innerHTML = optionsHTML;
}

// Dynamic Render Stock UI for N items
function updateAllDisplays() {
  const ledgerContainer = document.querySelector('#view-upgrades ul');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = Object.entries(inventory).map(([key, qty]) => `
      <li class="flex justify-between border-b border-slate-800 pb-2">
        <span class="uppercase">${key}</span>
        <span id="stock-${key}" class="font-bold text-cyan-400">${(qty || 0).toLocaleString()}</span>
      </li>
    `).join('');
  }

  const warehouseTbody = document.querySelector('#view-warehouse tbody');
  if (warehouseTbody) {
    warehouseTbody.innerHTML = Object.entries(inventory).map(([key, qty]) => {
      const isLow = (qty || 0) < (LOW_STOCK_THRESHOLDS[key] || 10);
      return `
        <tr>
          <td class="py-3 font-bold text-white uppercase">${key}</td>
          <td class="py-3 text-slate-400">Resource</td>
          <td id="wh-${key}" class="py-3 text-cyan-400 font-mono">${(qty || 0).toLocaleString()}</td>
          <td class="py-3 ${isLow ? 'text-amber-400' : 'text-emerald-400'} text-xs">${isLow ? 'LOW STOCK' : 'SUFFICIENT'}</td>
        </tr>
      `;
    }).join('');
  }

  checkStockAlerts();
  loadSelectedOperatorProfile();
}

// Security Audit Logger
function addAuditLog(action, details) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const userName = currentUser ? currentUser.displayName : "SYSTEM";
  const logEntry = { timestamp, user: userName, action, details };

  auditLogs.unshift(logEntry);
  renderAuditLogs();

  syncToCloud("ADD_LOG", {
    user: userName,
    action: action,
    details: details
  });
}

function renderAuditLogs() {
  filterAuditLogs();
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

  inventory[itemKey] = (inventory[itemKey] || 0) + qty;
  updateAllDisplays();

  restockMsg.className = "text-xs font-mono text-emerald-400";
  restockMsg.innerText = `ADDED: +${qty} ${itemKey.toUpperCase()} to Warehouse.`;

  addAuditLog("RESTOCK", `Added +${qty.toLocaleString()} ${itemKey.toUpperCase()} from Operation Rewards.`);
  qtyInput.value = "";

  syncToCloud("UPDATE_INVENTORY", {
    itemKey: itemKey,
    newQty: inventory[itemKey]
  });
}

// Low Stock Thresholds
const LOW_STOCK_THRESHOLDS = {
  lmd: 50000,
  exp: 100,
  sugar: 10
};

// Dynamic Stock Check
function checkStockAlerts() {
  const alertBanner = document.getElementById('alertBanner');
  const alertDetails = document.getElementById('alertDetails');
  if (!alertBanner || !alertDetails) return;

  const lowItems = [];
  Object.entries(inventory).forEach(([key, qty]) => {
    const threshold = LOW_STOCK_THRESHOLDS[key] || 10;
    if (qty < threshold) {
      lowItems.push(`${key.toUpperCase()} (${qty.toLocaleString()})`);
    }
  });

  if (lowItems.length > 0) {
    alertBanner.classList.remove('hidden');
    alertDetails.innerText = `Critically low supply detected: ${lowItems.join(', ')}. Restock required.`;
  } else {
    alertBanner.classList.add('hidden');
  }
}

// Filter Engine
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
        log.action === 'DEDUCT' || log.action === 'AUTH_FAILED' || log.action === 'PROMOTION' ? 'text-amber-400' : 
        log.action === 'REJECTED' ? 'text-red-400' : 'text-emerald-400'
      }">${log.action}</td>
      <td class="py-2 text-slate-300">${log.details}</td>
    </tr>
  `).join('');
}

function toggleRegisterModal(show) {
  const regModal = document.getElementById('registerModal');
  const loginModal = document.getElementById('loginModal');
  if (show) {
    loginModal.classList.add('hidden');
    regModal.classList.remove('hidden');
  } else {
    regModal.classList.add('hidden');
    loginModal.classList.remove('hidden');
  }
}

async function registerUser() {
  const username = document.getElementById('regUser').value.trim().toLowerCase();
  const displayName = document.getElementById('regDisplayName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPass').value.trim();
  const role = document.getElementById('regRole').value;
  const regError = document.getElementById('regError');

  if (!username || !displayName || !email || !pass) {
    regError.innerText = "REJECTED: Fill out all personnel fields.";
    return;
  }

  if (!email.includes('@')) {
    regError.innerText = "REJECTED: Invalid email address format.";
    return;
  }

  regError.innerText = "Encrypting key & creating account...";
  const passHash = await hashPassword(pass);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        actionType: "REGISTER_USER",
        username,
        displayName,
        email,
        passHash,
        role
      })
    });

    const result = await response.json();

    if (result.status === "SUCCESS") {
      userDatabase.push({ username, pass: passHash, displayName, role, email });
      addAuditLog("USER_REGISTRATION", `New user profile '${displayName}' registered as ${role}.`);
      alert("Registration Successful! You can now authenticate with your credentials.");
      
      document.getElementById('regUser').value = "";
      document.getElementById('regDisplayName').value = "";
      document.getElementById('regEmail').value = "";
      document.getElementById('regPass').value = "";
      regError.innerText = "";
      
      toggleRegisterModal(false);
    } else if (result.status === "ERR_USER_EXISTS") {
      regError.innerText = "REJECTED: Personnel ID already registered.";
    } else {
      regError.innerText = "ERR: Registration failed. Try again.";
    }
  } catch (err) {
    regError.innerText = "ERR: Failed to connect to core database.";
  }
}
// Dynamic Inventory State from Google Sheets
let inventory = {}; 

// EXP Values for Card Tiers
const EXP_VALUES = {
  card_exp_1: 20,   // Drill Plan
  card_exp_2: 100,  // Frontline Plan
  card_exp_3: 400,  // Tactical Plan
  card_exp_4: 2000  // Strategic Plan
};

// HELPER: Safely get display name directly from Google Sheet data
function getItemName(key) {
  if (inventory[key] && inventory[key].name) {
    return inventory[key].name;
  }
  return key.replace(/_/g, ' ').toUpperCase();
}

// HELPER: Safely get current stock quantity
function getItemStock(key) {
  return inventory[key] ? inventory[key].stock : 0;
}

// POPULATE DROPDOWNS USING SHEET DISPLAY NAMES
function populateItemDropdowns() {
  const itemKeys = Object.keys(inventory);
  const restockSelect = document.getElementById('restockItem');
  const itemSelect = document.getElementById('itemSelect');

  const optionsHTML = itemKeys.map(key => {
    const displayName = getItemName(key);
    return `<option value="${key}">${displayName}</option>`;
  }).join('');

  if (restockSelect) restockSelect.innerHTML = optionsHTML;
  if (itemSelect) itemSelect.innerHTML = optionsHTML;
}

// RENDER TABLES (WAREHOUSE & OPERATOR UPGRADES) USING SHEET NAMES
function updateAllDisplays() {
  // Upgrades View Ledger
  const ledgerContainer = document.querySelector('#view-upgrades ul');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = Object.entries(inventory).map(([key, item]) => `
      <li class="flex justify-between border-b border-slate-800 pb-2">
        <span class="text-slate-300">${item.name}</span>
        <span id="stock-${key}" class="font-bold text-cyan-400">${item.stock.toLocaleString()}</span>
      </li>
    `).join('');
  }

  // Warehouse View Table
  const warehouseTbody = document.querySelector('#view-warehouse tbody');
  if (warehouseTbody) {
    warehouseTbody.innerHTML = Object.entries(inventory).map(([key, item]) => {
      const isLow = item.stock < (LOW_STOCK_THRESHOLDS[key] || 10);
      return `
        <tr>
          <td class="py-3 font-bold text-white">${item.name}</td>
          <td class="py-3 text-slate-400">${key.startsWith('card_exp') ? 'EXP Card' : 'Material'}</td>
          <td id="wh-${key}" class="py-3 text-cyan-400 font-mono">${item.stock.toLocaleString()}</td>
          <td class="py-3 ${isLow ? 'text-amber-400' : 'text-emerald-400'} text-xs">${isLow ? 'LOW STOCK' : 'SUFFICIENT'}</td>
        </tr>
      `;
    }).join('');
  }

  checkStockAlerts();
  loadSelectedOperatorProfile();
}

// GREEDY EXP CARD DEDUCTION ENGINE
function calculateOptimalExpCards(requiredExp) {
  const expCardTiers = [
    { key: "card_exp_4", value: EXP_VALUES.card_exp_4 },
    { key: "card_exp_3", value: EXP_VALUES.card_exp_3 },
    { key: "card_exp_2", value: EXP_VALUES.card_exp_2 },
    { key: "card_exp_1", value: EXP_VALUES.card_exp_1 }
  ];

  let remainingExp = requiredExp;
  const cardsToDeduct = {};
  let totalAvailableExp = 0;

  expCardTiers.forEach(tier => {
    totalAvailableExp += getItemStock(tier.key) * tier.value;
  });

  if (totalAvailableExp < requiredExp) {
    return { success: false, totalAvailableExp };
  }

  for (const tier of expCardTiers) {
    if (remainingExp <= 0) break;

    const availableCards = getItemStock(tier.key);
    if (availableCards > 0) {
      const cardsNeeded = Math.ceil(remainingExp / tier.value);
      const cardsUsed = Math.min(cardsNeeded, availableCards);

      cardsToDeduct[tier.key] = cardsUsed;
      remainingExp -= cardsUsed * tier.value;
    }
  }

  return { success: remainingExp <= 0, cardsToDeduct };
}

// EXECUTE PROMOTION & SYNC TO SHEETS
function executePromotion() {
  if (currentUser && currentUser.role === "Read-Only") return;

  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const op = OPERATORS.find(o => o.id === select.value);
  if (!op) return;

  const expCheck = calculateOptimalExpCards(op.requirements.exp);
  if (!expCheck.success) {
    alert(`INSUFFICIENT EXP: Need ${op.requirements.exp} EXP, but only ${expCheck.totalAvailableExp} EXP available across all cards.`);
    return;
  }

  // 1. Deduct standard materials
  Object.entries(op.requirements).forEach(([matKey, reqQty]) => {
    const key = matKey.toLowerCase();
    if (key !== 'exp' && inventory[key]) {
      inventory[key].stock -= reqQty;
      syncToCloud("UPDATE_INVENTORY", {
        itemKey: key,
        newQty: inventory[key].stock
      });
    }
  });

  // 2. Deduct calculated EXP cards
  Object.entries(expCheck.cardsToDeduct).forEach(([cardKey, qtyUsed]) => {
    if (inventory[cardKey]) {
      inventory[cardKey].stock -= qtyUsed;
      syncToCloud("UPDATE_INVENTORY", {
        itemKey: cardKey,
        newQty: inventory[cardKey].stock
      });
    }
  });

  // 3. Update Operator Stage
  op.elite += 1;
  op.level = 1;
  op.maxLevel = op.elite === 2 ? 90 : 80;

  closePromotionModal();

  localStorage.setItem('prts_operators', JSON.stringify(OPERATORS));
  addAuditLog("PROMOTION", `Promoted ${op.name} to Elite ${op.elite}. Deducted EXP Cards: ${JSON.stringify(expCheck.cardsToDeduct)}`);

  updateAllDisplays();
  populateOperatorDropdown();
}
