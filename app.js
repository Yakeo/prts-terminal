const API_URL = "https://script.google.com/macros/s/AKfycbz9ivBZxvB0AkK8uZ1rx70zXJQpgARqXfmxavyT2iGfmRmVHZ5_9mX9ybzg49FcHb8c/exec";

let userDatabase = [];
let inventory = {}; // Structure: { card_exp_1: { name: "Drill Plan", stock: 400 }, ... }
let auditLogs = [];
let currentUser = null;
let pendingUser = null;
let generatedOTP = null;

// EXP Values for Card Tiers
const EXP_VALUES = {
  card_exp_1: 20,
  card_exp_2: 100,
  card_exp_3: 400,
  card_exp_4: 2000
};

// Low Stock Alert Thresholds
const LOW_STOCK_THRESHOLDS = {
  lmd: 50000,
  card_exp_1: 100,
  card_exp_2: 50,
  card_exp_3: 20,
  card_exp_4: 10,
  sugar: 10
};

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
    promotions: {
      1: { // Elite 0 -> Elite 1
        lmd: 37042, 
        exp: 26100, 
        chip_caster_1: 3, 
        sugar_sub: 1, 
        polyhedron: 1 
      },
      2: { // Elite 1 -> Elite 2
        lmd: 360000, 
        exp: 240000, 
        chip_caster_2: 4, 
        oriron_piece: 4, 
        ketone_sub: 4 
      }
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
    promotions: {
      1: {
        lmd: 57000, 
        exp: 32000, 
        chip_guard_1: 5, 
        polyhedron: 5, 
        sugar_sub: 3 
      },
      2: {
        lmd: 513124, 
        exp: 361400, 
        chip_guard_2: 4, 
        polyhedron: 4, 
        ester: 6 
      }
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
    promotions: {
      1: {
        lmd: 57000, 
        exp: 32000, 
        chip_guard_1: 5, 
        ketone_sub: 8, 
        oriron_piece: 5 
      },
      2: {
        lmd: 513124, 
        exp: 361400, 
        chip_guard_2: 4, 
        polyhedron: 4, 
        ester: 6 
      }
    }
  }
];
document.addEventListener('DOMContentLoaded', () => {
  const savedOperators = localStorage.getItem('prts_operators');
  if (savedOperators) {
    try {
      OPERATORS = JSON.parse(savedOperators);
    } catch (e) {
      console.error("Failed to parse saved operators", e);
    }
  }

  // RESTORE SAVED USER SESSION ON REFRESH
  const savedSession = localStorage.getItem('prts_session_user');
  if (savedSession) {
    try {
      currentUser = JSON.parse(savedSession);
      
      // Auto-hide login modals
      const loginModal = document.getElementById('loginModal');
      if (loginModal) loginModal.classList.add('hidden');

      // Update UI displays
      const userDisplay = document.getElementById('currentUserDisplay');
      const roleDisplay = document.getElementById('dashRoleDisplay');
      if (userDisplay) userDisplay.innerText = `${currentUser.displayName} (${currentUser.role})`;
      if (roleDisplay) roleDisplay.innerText = `${currentUser.displayName} [${currentUser.role}]`;

      applyRBAC();
    } catch (e) {
      console.error("Failed to restore session", e);
      localStorage.removeItem('prts_session_user');
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

// HELPER FUNCTIONS FOR INVENTORY
function getItemName(key) {
  if (inventory[key] && inventory[key].name) {
    return inventory[key].name;
  }
  return key.replace(/_/g, ' ').toUpperCase();
}

function getItemStock(key) {
  if (inventory[key] !== undefined) {
    return typeof inventory[key] === 'object' ? (inventory[key].stock || 0) : Number(inventory[key]);
  }
  return 0;
}

// FETCH DATA FROM GOOGLE SHEETS
async function fetchCloudData() {
  const errorElement = document.getElementById('loginError');
  if (errorElement) errorElement.innerText = "Connecting to PRTS Cloud DB...";

  try {
    const response = await fetch(API_URL);
    const data = await response.json();

    userDatabase = data.users || [];
    inventory = data.inventory || {};
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

// SYNC TO CLOUD
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

// AUTHENTICATION LOGIC
async function authenticateUser() {
  const userInput = document.getElementById('loginUser').value.trim().toLowerCase();
  const passInput = document.getElementById('loginPass').value.trim().replace(/^["']|["']$/g, '');
  const errorElement = document.getElementById('loginError');

  if (isLockedOut) {
    if (errorElement) errorElement.innerText = "SECURITY ALERT: Terminal locked due to repeated attempts. Try again in 30 seconds.";
    return;
  }

  if (!userInput || !passInput) {
    if (errorElement) errorElement.innerText = "REJECTED: Enter both Personnel ID/Email and Passcode.";
    return;
  }

  const hashedInput = await hashPassword(passInput);
  const foundUser = userDatabase.find(
    u => u.username === userInput || u.email?.toLowerCase() === userInput
  );

  const isValidPassword = foundUser && (foundUser.pass === hashedInput || foundUser.pass === passInput);

  if (!foundUser || !isValidPassword) {
    failedLoginAttempts++;
    if (failedLoginAttempts >= 3) {
      isLockedOut = true;
      if (errorElement) errorElement.innerText = "SECURITY ALERT: 3 Failed Attempts. TERMINAL LOCKED OUT FOR 30s.";
      addAuditLog("BRUTE_FORCE_LOCKOUT", `Terminal locked after 3 failed attempts for ID: '${userInput}'`);
      setTimeout(() => {
        isLockedOut = false;
        failedLoginAttempts = 0;
        if (errorElement) errorElement.innerText = "Terminal unlocked. Please retry credentials.";
      }, 30000);
      return;
    }

    if (errorElement) errorElement.innerText = `ACCESS DENIED: Invalid Credentials (${3 - failedLoginAttempts} attempts remaining).`;
    addAuditLog("AUTH_FAILED", `Failed login attempt for ID: '${userInput}'`);
    return;
  }

  failedLoginAttempts = 0;
  isLockedOut = false;
  pendingUser = foundUser;

  if (errorElement) errorElement.innerText = "Credentials verified. Dispatching 2FA Code via email...";

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
    if (errorElement) errorElement.innerText = "";
  } catch (err) {
    console.error("2FA Error:", err);
    if (errorElement) errorElement.innerText = "ERR: Failed to connect to email verification service.";
  }
}

function verify2FACode() {
  const enteredCode = document.getElementById('otpInput').value.trim();
  const otpError = document.getElementById('otpError');

  if (enteredCode !== generatedOTP) {
    if (otpError) otpError.innerText = "INVALID PASSCODE: Verification failed.";
    addAuditLog("2FA_FAILED", `Invalid 2FA code entered for user: '${pendingUser.displayName}'`);
    return;
  }

  currentUser = pendingUser;
  pendingUser = null;
  generatedOTP = null;

  // SAVE SESSION TO LOCAL STORAGE
  localStorage.setItem('prts_session_user', JSON.stringify(currentUser));

  document.getElementById('otpModal').classList.add('hidden');
  document.getElementById('loginModal').classList.add('hidden');
  document.getElementById('currentUserDisplay').innerText = `${currentUser.displayName} (${currentUser.role})`;
  document.getElementById('dashRoleDisplay').innerText = `${currentUser.displayName} [${currentUser.role}]`;

  addAuditLog("LOGIN", `User '${currentUser.displayName}' authenticated with SHA-256 + 2FA.`);
  applyRBAC();

  document.getElementById('loginUser').value = "";
  document.getElementById('loginPass').value = "";
  document.getElementById('otpInput').value = "";
  if (otpError) otpError.innerText = "";
}

function logout() {
  currentUser = null;
  localStorage.removeItem('prts_session_user'); // CLEAR SAVED SESSION
  
  const loginModal = document.getElementById('loginModal');
  if (loginModal) loginModal.classList.remove('hidden');
  
  document.getElementById('currentUserDisplay').innerText = "UNAUTHENTICATED";
  document.getElementById('dashRoleDisplay').innerText = "None";
}

// RBAC PERMISSIONS
function applyRBAC() {
  if (!currentUser) return;

  const role = currentUser.role;
  const restockBtn = document.getElementById('nav-restock');
  const upgradeBtn = document.getElementById('nav-upgrades');
  const logsBtn = document.querySelector("button[onclick*='logs']");
  const accessBtn = document.querySelector("button[onclick*='access']");
  const adminPanel = document.getElementById('adminCreatePersonnelCard');

  [restockBtn, upgradeBtn, logsBtn, accessBtn].forEach(btn => {
    if (btn) btn.classList.remove('opacity-40', 'pointer-events-none', 'hidden');
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

// TAB NAVIGATION
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

// DROPDOWNS & UI RENDERING
function populateItemDropdowns() {
  const itemKeys = Object.keys(inventory);
  const restockSelect = document.getElementById('restockItem');
  const itemSelect = document.getElementById('itemSelect');

  const optionsHTML = itemKeys.map(key => {
    return `<option value="${key}">${getItemName(key)}</option>`;
  }).join('');

  if (restockSelect) restockSelect.innerHTML = optionsHTML;
  if (itemSelect) itemSelect.innerHTML = optionsHTML;
}

function updateAllDisplays() {
  const ledgerContainer = document.querySelector('#view-upgrades ul');
  if (ledgerContainer) {
    ledgerContainer.innerHTML = Object.entries(inventory).map(([key, item]) => `
      <li class="flex justify-between border-b border-slate-800 pb-2">
        <span class="text-slate-300">${getItemName(key)}</span>
        <span id="stock-${key}" class="font-bold text-cyan-400">${getItemStock(key).toLocaleString()}</span>
      </li>
    `).join('');
  }

  const warehouseTbody = document.querySelector('#view-warehouse tbody');
  if (warehouseTbody) {
    warehouseTbody.innerHTML = Object.entries(inventory).map(([key, item]) => {
      const stockVal = getItemStock(key);
      const isLow = stockVal < (LOW_STOCK_THRESHOLDS[key] || 10);
      return `
        <tr>
          <td class="py-3 font-bold text-white">${getItemName(key)}</td>
          <td class="py-3 text-slate-400">${key.startsWith('card_exp') ? 'EXP Card' : 'Material'}</td>
          <td id="wh-${key}" class="py-3 text-cyan-400 font-mono">${stockVal.toLocaleString()}</td>
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

// OPERATOR PROFILES & PROMOTION
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

// OPERATOR PROFILES & DETAILED EXP BREAKDOWN
function loadSelectedOperatorProfile() {
  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const opId = select.value;
  const op = OPERATORS.find(o => o.id === opId);
  if (!op) return;

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

  const stageCurrent = document.getElementById('stageCurrent');
  const stageTarget = document.getElementById('stageTarget');
  if (stageCurrent) stageCurrent.innerText = `Elite ${op.elite}`;
  if (stageTarget) stageTarget.innerText = op.elite >= 2 ? `MAX` : `Elite ${op.elite + 1}`;

  const grid = document.getElementById('requiredMaterialsGrid');
  if (!grid) return;

  grid.innerHTML = '';
  let hasEnoughMaterials = true;

  // Dynamically resolve target promotion requirements
  const nextStage = op.elite + 1;
  const targetReqs = op.promotions ? op.promotions[nextStage] : op.requirements;

  if (targetReqs) {
    Object.entries(targetReqs).forEach(([matKey, reqQty]) => {
      let currentStock = 0;
      let isSufficient = false;
      let expBreakdownText = "";

      const safeReqQty = Number(reqQty) || 0;
      const cleanKey = matKey.toLowerCase().trim();

      if (cleanKey === 'exp') {
        const expCheck = calculateOptimalExpCards(safeReqQty);

        if (expCheck.success && expCheck.cardsToDeduct) {
          let calculatedExp = 0;
          const breakdownParts = [];

          Object.entries(expCheck.cardsToDeduct).forEach(([cardKey, count]) => {
            const cardValue = EXP_VALUES[cardKey] || 0;
            calculatedExp += count * cardValue;
            breakdownParts.push(`${count}x ${getItemName(cardKey)}`);
          });

          currentStock = calculatedExp;
          isSufficient = true;
          expBreakdownText = breakdownParts.join(', ');
        } else {
          currentStock = expCheck.totalAvailableExp || 0;
          isSufficient = false;
        }
      } else {
        currentStock = Number(getItemStock(cleanKey)) || 0;
        isSufficient = currentStock >= safeReqQty;
      }

      if (!isSufficient) hasEnoughMaterials = false;

      const card = document.createElement('div');
      card.className = `p-3 border text-center font-mono ${
        isSufficient ? 'bg-slate-950 border-slate-800' : 'bg-red-950/20 border-red-500/50'
      }`;

      card.innerHTML = `
        <div class="text-[10px] text-slate-400 uppercase truncate mb-1">${getItemName(cleanKey)}</div>
        <div class="text-base font-bold ${isSufficient ? 'text-cyan-400' : 'text-red-400'}">
          ${currentStock.toLocaleString()} / <span class="text-slate-300">${safeReqQty.toLocaleString()}</span>
        </div>
        ${
          expBreakdownText 
            ? `<div class="text-[9px] mt-1 text-cyan-300/80 truncate" title="${expBreakdownText}">Using: ${expBreakdownText}</div>`
            : `<div class="text-[9px] mt-1 ${isSufficient ? 'text-emerald-400' : 'text-red-400'}">
                ${isSufficient ? '✓ SUFFICIENT' : '✕ INSUFFICIENT'}
               </div>`
        }
      `;
      grid.appendChild(card);
    });
  }

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

// PROMOTION CONFIRMATION MODAL WITH MULTI-STAGE REQS SUPPORT
function openPromotionModal() {
  const select = document.getElementById('operatorSelect');
  if (!select) return;

  const op = OPERATORS.find(o => o.id === select.value);
  if (!op) return;

  const nextStage = op.elite + 1;
  const targetReqs = op.promotions ? op.promotions[nextStage] : op.requirements;

  const titleElem = document.getElementById('modalPromoteTitle') || document.getElementById('modalOpName');
  if (titleElem) titleElem.innerText = `Promote ${op.name} to Elite ${nextStage}`;

  const listContainer = document.getElementById('modalMaterialsList');
  if (listContainer && targetReqs) {
    listContainer.innerHTML = '';

    Object.entries(targetReqs).forEach(([matKey, reqQty]) => {
      const cleanKey = matKey.toLowerCase().trim();

      if (cleanKey === 'exp') {
        const expCheck = calculateOptimalExpCards(reqQty);
        if (expCheck.success && expCheck.cardsToDeduct) {
          Object.entries(expCheck.cardsToDeduct).forEach(([cardKey, count]) => {
            const row = document.createElement('div');
            row.className = "flex justify-between items-center text-xs py-1 border-b border-slate-800/50";
            row.innerHTML = `
              <span class="text-slate-300">${getItemName(cardKey)}:</span>
              <span class="text-amber-400 font-bold">-${count} cards</span>
            `;
            listContainer.appendChild(row);
          });
        }
      } else {
        const row = document.createElement('div');
        row.className = "flex justify-between items-center text-xs py-1 border-b border-slate-800/50";
        row.innerHTML = `
          <span class="text-slate-300 uppercase">${getItemName(cleanKey)}:</span>
          <span class="text-red-400 font-bold">-${reqQty.toLocaleString()}</span>
        `;
        listContainer.appendChild(row);
      }
    });
  }

  const modal = document.getElementById('promotionModal') || document.getElementById('upgradeModal');
  if (modal) modal.classList.remove('hidden');
}

function closePromotionModal() {
  const modal = document.getElementById('promotionModal') || document.getElementById('upgradeModal');
  if (modal) modal.classList.add('hidden');
}

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
      const currentVal = getItemStock(key);
      const newVal = Math.max(0, currentVal - reqQty);
      if (typeof inventory[key] === 'object') {
        inventory[key].stock = newVal;
      } else {
        inventory[key] = newVal;
      }
      syncToCloud("UPDATE_INVENTORY", { itemKey: key, newQty: newVal });
    }
  });

  // 2. Deduct calculated EXP cards
  Object.entries(expCheck.cardsToDeduct).forEach(([cardKey, qtyUsed]) => {
    if (inventory[cardKey]) {
      const currentVal = getItemStock(cardKey);
      const newVal = Math.max(0, currentVal - qtyUsed);
      if (typeof inventory[cardKey] === 'object') {
        inventory[cardKey].stock = newVal;
      } else {
        inventory[cardKey] = newVal;
      }
      syncToCloud("UPDATE_INVENTORY", { itemKey: cardKey, newQty: newVal });
    }
  });

  // 3. Advance Operator Stats
  op.elite += 1;
  op.level = 1;
  op.maxLevel = op.elite === 2 ? 90 : 80;

  closePromotionModal();

  localStorage.setItem('prts_operators', JSON.stringify(OPERATORS));
  addAuditLog("PROMOTION", `Promoted ${op.name} to Elite ${op.elite}. Deducted EXP cards: ${JSON.stringify(expCheck.cardsToDeduct)}`);

  updateAllDisplays();
  populateOperatorDropdown();
}

function openUpgradeConfirmModal() { openPromotionModal(); }
function closeUpgradeConfirmModal() { closePromotionModal(); }
function executeConfirmedUpgrade() { executePromotion(); }

// RESTOCK LOGIC
function processRestock() {
  if (currentUser && currentUser.role === "Read-Only") return;

  const itemKey = document.getElementById('restockItem').value;
  const qtyInput = document.getElementById('restockQty');
  const qty = parseInt(qtyInput.value, 10);
  const restockMsg = document.getElementById('restockMsg');

  if (isNaN(qty) || qty <= 0) {
    if (restockMsg) {
      restockMsg.className = "text-xs font-mono text-red-400";
      restockMsg.innerText = "ERR: Enter a valid positive number.";
    }
    return;
  }

  const currentStock = getItemStock(itemKey);
  const newStock = currentStock + qty;

  if (typeof inventory[itemKey] === 'object') {
    inventory[itemKey].stock = newStock;
  } else {
    inventory[itemKey] = newStock;
  }

  updateAllDisplays();

  if (restockMsg) {
    restockMsg.className = "text-xs font-mono text-emerald-400";
    restockMsg.innerText = `ADDED: +${qty} ${getItemName(itemKey)} to Warehouse.`;
  }

  addAuditLog("RESTOCK", `Added +${qty.toLocaleString()} ${getItemName(itemKey)}.`);
  qtyInput.value = "";

  syncToCloud("UPDATE_INVENTORY", { itemKey: itemKey, newQty: newStock });
}

function checkStockAlerts() {
  const alertBanner = document.getElementById('alertBanner');
  const alertDetails = document.getElementById('alertDetails');
  if (!alertBanner || !alertDetails) return;

  const lowItems = [];
  Object.keys(inventory).forEach(key => {
    const qty = getItemStock(key);
    const threshold = LOW_STOCK_THRESHOLDS[key] || 10;
    if (qty < threshold) {
      lowItems.push(`${getItemName(key)} (${qty.toLocaleString()})`);
    }
  });

  if (lowItems.length > 0) {
    alertBanner.classList.remove('hidden');
    alertDetails.innerText = `Critically low supply detected: ${lowItems.join(', ')}. Restock required.`;
  } else {
    alertBanner.classList.add('hidden');
  }
}

// SECURITY AUDIT LOGS
function addAuditLog(action, details) {
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const userName = currentUser ? currentUser.displayName : "SYSTEM";
  const logEntry = { timestamp, user: userName, action, details };

  auditLogs.unshift(logEntry);
  renderAuditLogs();

  syncToCloud("ADD_LOG", { user: userName, action: action, details: details });
}

function renderAuditLogs() { filterAuditLogs(); }

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
// Populate Restock Dropdown and sync initial preview
function populateRestockDropdown() {
  const select = document.getElementById('restockItemSelect');
  if (!select || !inventory) return;

  select.innerHTML = '';
  Object.keys(inventory).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.innerText = `${getItemName(key)} (${key})`;
    select.appendChild(opt);
  });

  updateRestockItemPreview();
}

// Live update of selected item stats
function updateRestockItemPreview() {
  const select = document.getElementById('restockItemSelect');
  if (!select) return;

  const itemKey = select.value;
  const currentStock = getItemStock(itemKey);

  const nameElem = document.getElementById('previewItemName');
  const catElem = document.getElementById('previewItemCategory');
  const stockElem = document.getElementById('previewItemCurrentStock');

  if (nameElem) nameElem.innerText = getItemName(itemKey);
  if (catElem) catElem.innerText = itemKey.includes('chip') ? 'CHIP MATERIAL' : itemKey.includes('exp') ? 'EXP RECORD' : 'DEVELOPMENT MATERIAL';
  if (stockElem) stockElem.innerText = currentStock.toLocaleString();

  updateRestockProjection();
}

// Quick amount preset buttons
function setRestockAmount(amt) {
  const input = document.getElementById('restockAmount');
  if (input) {
    input.value = amt;
    updateRestockProjection();
  }
}

// Calculate projected new total
function updateRestockProjection() {
  const select = document.getElementById('restockItemSelect');
  const input = document.getElementById('restockAmount');
  const display = document.getElementById('projectedStockDisplay');

  if (!select || !input || !display) return;

  const currentStock = getItemStock(select.value);
  const addAmount = Number(input.value) || 0;
  const newTotal = currentStock + addAmount;

  display.innerText = `${currentStock.toLocaleString()} → ${newTotal.toLocaleString()}`;
}
