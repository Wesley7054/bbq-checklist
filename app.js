/* 
  BBQ Checklist App (Firestore Realtime Sync) - v3
  Added:
  - Two UI rhythms (Elder / Teen)
  - Teen quick add parser
  - Elder minimal columns + big entry buttons
  - Copy transfers button

  Based on your v1/v2 code structure. fileciteturn0file0 fileciteturn0file1 fileciteturn0file2
*/

// ===== Firebase (v9+ modular) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// ===== 1) Paste your Firebase config here =====
const firebaseConfig = {
  apiKey: "AIzaSyCVE3IJt-6Cc7gtJ0Nshf7XuUOa_OIdPYs",
  authDomain: "bbq-checklist.firebaseapp.com",
  projectId: "bbq-checklist",
  storageBucket: "bbq-checklist.firebasestorage.app",
  messagingSenderId: "300895897312",
  appId: "1:300895897312:web:fbf41a8ff697011e893285"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ===== Helpers =====
const $ = (sel) => document.querySelector(sel);

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}
function nowISO() { return new Date().toISOString(); }
function safeNumber(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function currency(amount) { const n = Number(amount || 0); return `$${n.toFixed(2)}`; }

function matchesText(item, q) {
  const t = `${item.name} ${item.category} ${item.note} ${item.who} ${item.want}`.toLowerCase();
  return t.includes(q.toLowerCase());
}

// ===== Room handling =====
function getRoomId() {
  const u = new URL(location.href);
  const room = (u.searchParams.get("room") || "bbq-2025").trim();
  return room.replace(/[\/\/#?[\]]/g, "-");
}
const ROOM_ID = getRoomId();
const roomRef = doc(db, "rooms", ROOM_ID);
const checklistCol = collection(db, "rooms", ROOM_ID, "checklist");
const wishlistCol = collection(db, "rooms", ROOM_ID, "wishlist");

// ===== UI mode (Elder / Teen) =====
const MODE_KEY = "bbq_ui_mode"; // 'elder' | 'teen'
const ADV_PASS = "11234";
const ADV_UNLOCK_KEY = "bbq_adv_unlocked"; // "1" means unlocked on this device

function getMode() {
  const m = String(localStorage.getItem(MODE_KEY) || "elder").toLowerCase();
  return m === "elder" ? "elder" : "teen";
}
function setMode(mode) {
  const target = mode === "elder" ? "elder" : "teen";
  // Entering Advance mode requires a simple password gate
  if (target === "teen") {
    const unlocked = localStorage.getItem(ADV_UNLOCK_KEY) === "1";
    if (!unlocked) {
      const pw = prompt("入 Advance mode 請輸入密碼");
      if (pw !== ADV_PASS) {
        alert("密碼錯誤");
        // keep EZ
        localStorage.setItem(MODE_KEY, "elder");
        document.body.classList.add("mode-elder");
        syncModeButtons();
        render();
        return;
      }
      localStorage.setItem(ADV_UNLOCK_KEY, "1");
    }
  }
  localStorage.setItem(MODE_KEY, target);
  document.body.classList.toggle("mode-elder", target === "elder");
  syncModeButtons();
  render();
}

function syncModeButtons() {
  const elderBtn = $("#btnModeElder");
  const teenBtn = $("#btnModeTeen");
  if (!elderBtn || !teenBtn) return;
  const m = getMode();
  elderBtn.classList.toggle("is-active", m === "elder");
  teenBtn.classList.toggle("is-active", m === "teen");
}

function initModeUI() {
  // If first time, default to EZ mode
  if (localStorage.getItem(MODE_KEY) === null) {
    localStorage.setItem(MODE_KEY, "elder");
  }
  document.body.classList.toggle("mode-elder", getMode() === "elder");
  syncModeButtons();

  $("#btnModeElder")?.addEventListener("click", () => setMode("elder"));
  $("#btnModeTeen")?.addEventListener("click", () => setMode("teen"));

  // Elder entry buttons
  $("#btnEnterList")?.addEventListener("click", () => {
    $("#listsSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("#btnNewRoom")?.addEventListener("click", () => {
    const id = prompt("新房間名（只用英文/數字/短橫線）", `bbq-${new Date().getFullYear()}`);
    if (!id) return;
    const cleaned = String(id).trim().replace(/[\/\/#?[\]]/g, "-");
    const u = new URL(location.href);
    u.searchParams.set("room", cleaned);
    location.href = u.toString();
  });

  // Elder: set participants (include people who buy nothing)
  $("#btnSetParticipants")?.addEventListener("click", async () => {
    const current = getParticipants().join(", ");
    const text = prompt("輸入參加者名（逗號分隔）\n例：阿明, 炒麵, AAA", current);
    if (text === null) return;
    const parts = parseParticipants(text);
    await updateParticipantsToRoom(parts);
    renderSplit();
    // jump to settle so elder sees result
    $("#settleSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });


  // Show room id pill
  const pill = $("#roomPill");
  if (pill) pill.textContent = ROOM_ID;
}

// ===== Local view state =====
let state = {
  meta: { version: 4, roomId: ROOM_ID, updatedAt: nowISO() },
  checklist: [],
  wishlist: []
};

let unsubChecklist = null;
let unsubWishlist = null;
let unsubRoom = null;
let isRenderingFromRemote = false;

// ===== Default seed =====
function seedItems() {
  return {
    checklist: [
      { name: "Charcoal", category: "food", qty: 1, note: "", want: "", done: false, bought: false, who: "", cost: 0 },
      { name: "Tongs", category: "equipment", qty: 1, note: "", want: "", done: false, bought: false, who: "", cost: 0 },
      { name: "Paper plates", category: "misc", qty: 1, note: "", want: "", done: false, bought: false, who: "", cost: 0 }
    ],
    wishlist: [
      { name: "Portable fan", category: "equipment", qty: 1, note: "If outdoor super hot", want: "", bought: false, who: "", cost: 0 }
    ]
  };
}

async function ensureRoomExistsAndMaybeSeed() {
  await setDoc(roomRef, { roomId: ROOM_ID, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });

  const [cSnap, wSnap] = await Promise.all([getDocs(checklistCol), getDocs(wishlistCol)]);
  if (!cSnap.empty || !wSnap.empty) return;

  const seed = seedItems();
  const batch = writeBatch(db);

  for (const it of seed.checklist) {
    const id = uid();
    batch.set(doc(checklistCol, id), normalizeItemForWrite({ id, ...it }, "checklist"));
  }
  for (const it of seed.wishlist) {
    const id = uid();
    batch.set(doc(wishlistCol, id), normalizeItemForWrite({ id, ...it }, "wishlist"));
  }
  batch.set(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

function normalizeItemForWrite(item, type) {
  const base = {
    id: item.id || uid(),
    name: (item.name || "").trim(),
    category: (item.category || "misc").trim(),
    qty: Math.max(1, safeNumber(item.qty ?? 1)),
    note: item.note || "",
    want: item.want || "",
    who: item.who || "",
    cost: Math.max(0, safeNumber(item.cost ?? 0)),
    bought: !!item.bought,
    done: type === "checklist" ? !!item.done : false,
    createdAt: item.createdAt || nowISO(),
    updatedAt: nowISO()
  };
  if (base.cost > 0) base.bought = true;
  return base;
}

async function touchRoom() {
  await setDoc(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
}

// ===== Realtime listeners =====
function startRealtime() {
  const qChecklist = query(checklistCol, orderBy("createdAt", "desc"));
  const qWishlist = query(wishlistCol, orderBy("createdAt", "desc"));

  unsubChecklist = onSnapshot(qChecklist, (snap) => {
    state.checklist = snap.docs.map((d) => d.data());
    render();
  });

  unsubWishlist = onSnapshot(qWishlist, (snap) => {
    state.wishlist = snap.docs.map((d) => d.data());
    render();
  });

  unsubRoom = onSnapshot(roomRef, (snap) => {
    const data = snap.data() || {};
    const participants = Array.isArray(data.participants) ? data.participants : [];
    state.meta.participants = participants.map((x) => String(x || "").trim()).filter(Boolean);
    syncParticipantsInput();
    renderSplit();
  });
}

function stopRealtime() {
  unsubChecklist?.(); unsubWishlist?.(); unsubRoom?.();
  unsubChecklist = null; unsubWishlist = null; unsubRoom = null;
}

// ===== UI rendering =====
function filteredChecklist() {
  const q = $("#searchChecklist")?.value?.trim() || "";
  const f = $("#filterChecklist")?.value || "all";
  return state.checklist
    .filter((it) => (q ? matchesText(it, q) : true))
    .filter((it) => {
      if (f === "all") return true;
      if (f === "open") return !it.done;
      if (f === "done") return !!it.done;
      if (f === "bought") return !!it.bought;
      return true;
    });
}
function filteredWishlist() {
  const q = $("#searchWishlist")?.value?.trim() || "";
  const f = $("#filterWishlist")?.value || "all";
  return state.wishlist
    .filter((it) => (q ? matchesText(it, q) : true))
    .filter((it) => {
      if (f === "all") return true;
      if (f === "open") return !it.bought;
      if (f === "bought") return !!it.bought;
      return true;
    });
}

function render() {
  if (!$("#checklistBody") || !$("#wishlistBody")) return;
  isRenderingFromRemote = true;

  renderTable({ items: filteredChecklist(), tbody: $("#checklistBody"), type: "checklist" });
  renderTable({ items: filteredWishlist(), tbody: $("#wishlistBody"), type: "wishlist" });

  if (getMode() === "teen") renderStats();
  renderSplit();

  state.meta.updatedAt = nowISO();
  isRenderingFromRemote = false;
}

function renderTable({ items, tbody, type }) {
  tbody.innerHTML = "";
  const mode = getMode();

  for (const item of items) {
    const tr = document.createElement("tr");
    const checked = type === "checklist" ? !!item.done : !!item.bought;

    const labels = type === "checklist"
      ? { check: "完成", item: "物品", cat: "分類", qty: "數量", want: "想買/認領", who: "邊個買", cost: "金額", note: "備註", act: "操作" }
      : { check: "已買", item: "物品", cat: "分類", qty: "數量", want: "想買/認領", who: "邊個買", cost: "金額", note: "備註", act: "操作" };

    tr.appendChild(tdCheckbox(type, item, checked, labels.check));
    tr.appendChild(mode === "teen" ? tdNameInput(type, item, labels.item) : tdText(item.name, "strong", labels.item));

    if (mode === "teen") tr.appendChild(tdCategorySelect(type, item, labels.cat));
    tr.appendChild(tdQty(type, item, labels.qty));
    if (mode === "teen") tr.appendChild(tdWant(type, item, labels.want));
    tr.appendChild(tdWho(type, item, labels.who));
    if (mode === "teen") tr.appendChild(tdCost(type, item, labels.cost));
    if (mode === "teen") tr.appendChild(tdNote(type, item, labels.note));
    tr.appendChild(tdActions(type, item, labels.act));

    tbody.appendChild(tr);
  }

  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = getMode() === "teen" ? 9 : 5;
    td.className = "muted";
    td.style.padding = "14px 10px";
    td.textContent = "呢度暫時冇嘢。";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function tdText(text, tag = "span", label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const el = document.createElement(tag);
  el.textContent = text || "";
  td.appendChild(el);
  return td;
}

function tdNameInput(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;

  const input = document.createElement("input");
  input.value = item.name || "";
  input.placeholder = "物品";
  input.addEventListener("blur", async () => {
    if (isRenderingFromRemote) return;
    const name = input.value.trim();
    if (!name) {
      // prevent empty name
      input.value = item.name || "";
      return;
    }
    if (name !== (item.name || "")) {
      await updateItem(type, item.id, { name });
    }
  });

  td.appendChild(input);
  return td;
}

function tdBadge(category, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = category || "misc";
  td.appendChild(span);
  return td;
}

function tdCategorySelect(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;

  const select = document.createElement("select");
  const options = ["equipment", "food", "drink", "misc"];

  for (const v of options) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    if ((item.category || "misc") === v) opt.selected = true;
    select.appendChild(opt);
  }

  select.addEventListener("change", async () => {
    if (isRenderingFromRemote) return;
    await updateItem(type, item.id, { category: select.value });
  });

  td.appendChild(select);
  return td;
}

function tdCheckbox(type, item, checked, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "checkbox";
  input.checked = checked;

  input.addEventListener("change", async () => {
    if (isRenderingFromRemote) return;
    const patch = {};
    if (type === "checklist") patch.done = input.checked;
    else patch.bought = input.checked;
    if (input.checked) patch.bought = true;
    await updateItem(type, item.id, patch);
  });

  td.appendChild(input);
  return td;
}

function tdQty(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;

  const wrap = document.createElement("div");
  wrap.className = "qty";

  const btnMinus = document.createElement("button");
  btnMinus.type = "button";
  btnMinus.className = "qty__btn";
  btnMinus.textContent = "−";
  btnMinus.setAttribute("aria-label", "減少數量");

  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.value = item.qty ?? 1;
  input.className = "qty__input";

  const btnPlus = document.createElement("button");
  btnPlus.type = "button";
  btnPlus.className = "qty__btn";
  btnPlus.textContent = "+";
  btnPlus.setAttribute("aria-label", "增加數量");

  const commit = async (val) => {
    if (isRenderingFromRemote) return;
    const qty = Math.max(1, safeNumber(val));
    input.value = String(qty);
    await updateItem(type, item.id, { qty });
  };

  btnMinus.addEventListener("click", () => commit(safeNumber(input.value) - 1));
  btnPlus.addEventListener("click", () => commit(safeNumber(input.value) + 1));
  input.addEventListener("change", () => commit(input.value));

  wrap.appendChild(btnMinus);
  wrap.appendChild(input);
  wrap.appendChild(btnPlus);
  td.appendChild(wrap);
  return td;
}

function tdWant(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.placeholder = "想買/認領";
  input.value = item.want || "";
  input.addEventListener("blur", async () => {
    if (isRenderingFromRemote) return;
    await updateItem(type, item.id, { want: input.value });
  });
  td.appendChild(input);
  return td;
}

function tdWho(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.placeholder = "邊個買";
  input.value = item.who || "";
  input.addEventListener("blur", async () => {
    if (isRenderingFromRemote) return;
    await updateItem(type, item.id, { who: input.value });
  });
  td.appendChild(input);
  return td;
}

function tdCost(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.className = "money";
  input.placeholder = "0.00";
  input.value = item.cost ?? 0;

  input.addEventListener("change", async () => {
    if (isRenderingFromRemote) return;
    const cost = Math.max(0, safeNumber(input.value));
    const patch = { cost };
    if (cost > 0) patch.bought = true;
    await updateItem(type, item.id, patch);
  });

  td.appendChild(input);
  return td;
}

function tdNote(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.placeholder = "備註...";
  input.value = item.note || "";
  input.addEventListener("blur", async () => {
    if (isRenderingFromRemote) return;
    await updateItem(type, item.id, { note: input.value });
  });
  td.appendChild(input);
  return td;
}

function tdActions(type, item, label = "") {
  const td = document.createElement("td");
  td.className = "actions-cell";
  if (label) td.dataset.label = label;
  td.style.whiteSpace = "nowrap";

  const btnMove = document.createElement("button");
  btnMove.type = "button";
  btnMove.className = "icon-btn";
  btnMove.title = type === "checklist" ? "移去「想買」" : "移去「清單」";
  btnMove.textContent = (getMode() === "elder")
    ? (type === "checklist" ? "移去「想買」" : "移去「清單」")
    : (type === "checklist" ? "→ 想買" : "→ 清單");
  btnMove.addEventListener("click", async () => {
    if (isRenderingFromRemote) return;
    await moveItem(type, item.id);
  });

  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "icon-btn";
  btnDel.title = "刪除";
  btnDel.textContent = (getMode() === "elder") ? "刪除" : "🗑️";
  btnDel.style.marginLeft = "8px";
  btnDel.addEventListener("click", async () => {
    if (isRenderingFromRemote) return;
    await deleteItem(type, item.id);
  });

  td.appendChild(btnMove);
  if (getMode() !== "elder") td.appendChild(btnDel);
  return td;
}

// ===== Stats (teen only) =====
function renderStats() {
  const all = [...state.checklist, ...state.wishlist];
  const total = all.reduce((sum, it) => sum + safeNumber(it.cost), 0);
  const bought = all.filter((it) => !!it.bought).length;
  const open = all.filter((it) => !it.bought && !(it.done === true)).length;

  $("#totalSpent").textContent = currency(total);
  $("#boughtCount").textContent = String(bought);
  $("#openCount").textContent = String(open);

  const checklistDone = state.checklist.filter((it) => !!it.done).length;
  const checklistBought = state.checklist.filter((it) => !!it.bought).length;
  const checklistOpen = state.checklist.length - checklistDone - checklistBought;

  $("#checklistStats").innerHTML = `
    <span class="badge">總數: ${state.checklist.length}</span>
    <span class="badge">已完成: ${checklistDone}</span>
    <span class="badge">已買: ${checklistBought}</span>
    <span class="badge">未處理: ${Math.max(0, checklistOpen)}</span>
  `;

  const wishBought = state.wishlist.filter((it) => !!it.bought).length;
  const wishOpen = state.wishlist.length - wishBought;

  $("#wishlistStats").innerHTML = `
    <span class="badge">總數: ${state.wishlist.length}</span>
    <span class="badge">已買: ${wishBought}</span>
    <span class="badge">未處理: ${Math.max(0, wishOpen)}</span>
  `;
}

// ===== Split bill + transfers =====
function parseParticipants(text) {
  return String(text || "").split(",").map((s) => s.trim()).filter(Boolean);
}
function unique(arr) { return Array.from(new Set(arr)); }

function inferredParticipantsFromItems() {
  const all = [...state.checklist, ...state.wishlist];
  return unique(all.map((it) => String(it.who || "").trim()).filter(Boolean));
}

function getParticipants() {
  const fromRoom = Array.isArray(state.meta.participants) ? state.meta.participants : [];
  const inferred = inferredParticipantsFromItems();
  // Union = room-defined participants (including people who buy nothing) + inferred payers
  return unique([...fromRoom, ...inferred].map((x) => String(x || "").trim()).filter(Boolean));
}

function syncParticipantsInput() {
  const el = $("#participantsInput");
  if (!el) return;
  if (document.activeElement === el) return;
  el.value = getParticipants().join(", ");
}

async function updateParticipantsToRoom(participants) {
  const cleaned = unique(participants.map((x) => String(x || "").trim()).filter(Boolean));
  await setDoc(roomRef, { participants: cleaned, updatedAt: serverTimestamp() }, { merge: true });
}

function computeTransfers(balances) {
  const eps = 0.01;
  const creditors = [];
  const debtors = [];
  for (const [name, diff] of Object.entries(balances)) {
    const d = Number(diff || 0);
    if (d > eps) creditors.push({ name, amt: d });
    else if (d < -eps) debtors.push({ name, amt: -d });
  }
  creditors.sort((a, b) => b.amt - a.amt);
  debtors.sort((a, b) => b.amt - a.amt);

  const transfers = [];
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = debtors[i];
    const recv = creditors[j];
    const x = Math.min(pay.amt, recv.amt);
    if (x > eps) transfers.push({ from: pay.name, to: recv.name, amount: x });
    pay.amt -= x;
    recv.amt -= x;
    if (pay.amt <= eps) i++;
    if (recv.amt <= eps) j++;
  }
  return transfers;
}

function renderSplit() {
  const transferEl = $("#transferResult");
  if (!transferEl) return;

  const all = [...state.checklist, ...state.wishlist];
  const total = all.reduce((sum, it) => sum + safeNumber(it.cost), 0);

  const participants = getParticipants();
  const n = participants.length;
  const per = n > 0 ? total / n : 0;

  // teen-only UI
  const shareEl = $("#perPersonShare");
  const listEl = $("#splitResult");
  if (shareEl) shareEl.textContent = currency(per);

  if (n === 0) {
    if (listEl) listEl.innerHTML = `<div class="muted">先喺上面輸入參加者，或者喺「邊個買」填返名。</div>`;
    transferEl.innerHTML = `<div class="muted">未有參加者，暫時唔計到轉數。</div>`;
    return;
  }

  const paid = {};
  for (const name of participants) paid[name] = 0;

  for (const it of all) {
    const who = String(it.who || "").trim();
    const cost = safeNumber(it.cost);
    if (!who || cost <= 0) continue;
    if (!(who in paid)) paid[who] = 0;
    paid[who] += cost;
  }

  const rows = Object.keys(paid).sort((a, b) => a.localeCompare(b, "zh-HK"));
  const balances = {};
  for (const name of rows) balances[name] = paid[name] - per;

  if (listEl) {
    listEl.innerHTML = rows.map((name) => {
      const diff = balances[name];
      const abs = Math.abs(diff);
      let action = "剛剛好 ✅";
      let hint = "唔使收 / 唔使俾";
      if (diff > 0.00001) { action = `應收返 ${currency(abs)}`; hint = "你比多咗，可以收返差額"; }
      else if (diff < -0.00001) { action = `應俾 ${currency(abs)}`; hint = "你比少咗，要補返差額"; }
      return `
        <div class="settle__row">
          <div>
            <div class="settle__name">${escapeHTML(name)}</div>
            <div class="settle__hint">已俾：${currency(paid[name])}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:900">${action}</div>
            <div class="settle__hint">${hint}</div>
          </div>
        </div>
      `;
    }).join("");
  }

  const transfers = computeTransfers(balances);
  if (transfers.length === 0) {
    transferEl.innerHTML = `<div class="muted">全部人都已經差唔多平衡 ✅</div>`;
    return;
  }

  transferEl.innerHTML = transfers.map((t) => {
    return `
      <div class="settle__row">
        <div>
          <div class="settle__name">${escapeHTML(t.from)} → ${escapeHTML(t.to)}</div>
          <div class="settle__hint">建議轉數</div>
        </div>
        <div style="text-align:right">
          <div style="font-weight:900">${currency(t.amount)}</div>
          <div class="settle__hint">（可自行合併/調整）</div>
        </div>
      </div>
    `;
  }).join("");

  // cache transfers text for copy
  state.meta.lastTransfersText = transfers.map((t) => `${t.from} -> ${t.to}: ${currency(t.amount)}`).join("\n");
}

function escapeHTML(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ===== Firestore operations =====
function colForType(type) { return type === "checklist" ? checklistCol : wishlistCol; }

async function addItem(type, item) {
  const col = colForType(type);
  const id = item.id || uid();
  await setDoc(doc(col, id), normalizeItemForWrite({ ...item, id }, type));
  await touchRoom();
}

async function updateItem(type, id, patch) {
  const ref = doc(colForType(type), id);
  const normalizedPatch = { ...patch, updatedAt: nowISO() };

  if ("cost" in normalizedPatch) {
    const cost = Math.max(0, safeNumber(normalizedPatch.cost));
    normalizedPatch.cost = cost;
    if (cost > 0) normalizedPatch.bought = true;
  }
  if ("qty" in normalizedPatch) normalizedPatch.qty = Math.max(1, safeNumber(normalizedPatch.qty));

  await updateDoc(ref, normalizedPatch);
  await touchRoom();
}

async function deleteItem(type, id) {
  const ok = confirm("刪除呢個項目？");
  if (!ok) return;
  await deleteDoc(doc(colForType(type), id));
  await touchRoom();
}

async function moveItem(type, id) {
  const fromType = type;
  const toType = type === "checklist" ? "wishlist" : "checklist";

  const fromArr = fromType === "checklist" ? state.checklist : state.wishlist;
  const item = fromArr.find((x) => x.id === id);
  if (!item) return;

  const moved = { ...item };
  if (toType === "wishlist") moved.done = false;

  const batch = writeBatch(db);
  batch.delete(doc(colForType(fromType), id));
  batch.set(doc(colForType(toType), id), normalizeItemForWrite(moved, toType));
  batch.set(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

// ===== Export / Import (teen) =====
async function exportJSON() {
  const payload = { meta: { version: 4, roomId: ROOM_ID, exportedAt: nowISO() }, checklist: state.checklist, wishlist: state.wishlist };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bbq-room-${ROOM_ID}-export-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

async function importJSONFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);

  if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
  if (!Array.isArray(parsed.checklist) || !Array.isArray(parsed.wishlist)) throw new Error("JSON must include checklist and wishlist arrays");

  const batch = writeBatch(db);
  const [cSnap, wSnap] = await Promise.all([getDocs(checklistCol), getDocs(wishlistCol)]);
  for (const d of cSnap.docs) batch.delete(d.ref);
  for (const d of wSnap.docs) batch.delete(d.ref);

  for (const raw of parsed.checklist) {
    const id = raw.id || uid();
    batch.set(doc(checklistCol, id), normalizeItemForWrite({ ...raw, id }, "checklist"));
  }
  for (const raw of parsed.wishlist) {
    const id = raw.id || uid();
    batch.set(doc(wishlistCol, id), normalizeItemForWrite({ ...raw, id }, "wishlist"));
  }
  batch.set(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
}

// ===== Accessibility font controls (teen) =====
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function getBaseFont() {
  const saved = Number(localStorage.getItem("bbq_baseFontPx"));
  if (Number.isFinite(saved) && saved >= 14 && saved <= 22) return saved;
  return 16;
}
function applyBaseFont(px) {
  const v = clamp(px, 14, 22);
  document.documentElement.style.setProperty("--baseFont", `${v}px`);
  localStorage.setItem("bbq_baseFontPx", String(v));
}
function bindFontControls() {
  const down = $("#btnFontDown");
  const up = $("#btnFontUp");
  if (!down || !up) return;
  down.addEventListener("click", () => applyBaseFont(getBaseFont() - 1));
  up.addEventListener("click", () => applyBaseFont(getBaseFont() + 1));
  applyBaseFont(getBaseFont());
}

// ===== Teen quick add parser =====
function parseQuickAdd(text) {
  // Examples:
  // "雞翼 x20" / "雞翼*20" / "汽水 6" / "炭 2"
  const raw = String(text || "").trim();
  if (!raw) return null;

  // normalize separators
  const t = raw.replaceAll("×", "x").replaceAll("＊", "*").replaceAll("Ｘ", "x");

  // pattern 1: name x qty
  let m = t.match(/^(.+?)\s*[x\*]\s*(\d{1,4})\s*$/i);
  if (m) return { name: m[1].trim(), qty: Math.max(1, safeNumber(m[2])) };

  // pattern 2: name qty
  m = t.match(/^(.+?)\s+(\d{1,4})\s*$/);
  if (m) return { name: m[1].trim(), qty: Math.max(1, safeNumber(m[2])) };

  return { name: raw, qty: 1 };
}

// ===== Events wiring =====
function bindUIEvents() {
  initModeUI();
  bindFontControls();

  // Add new item (shared)
  $("#addForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = $("#itemName")?.value?.trim() || "";
    const category = $("#itemCategory")?.value || "misc";
    const list = $("#itemList")?.value || "checklist";
    const qty = Math.max(1, safeNumber($("#itemQty")?.value));
    const want = $("#itemWant")?.value?.trim() || "";
    const who = $("#itemWho")?.value?.trim() || "";
    const note = $("#itemNote")?.value?.trim() || "";

    if (!name) return;

    const item = {
      id: uid(),
      name,
      category,
      qty,
      note,
      want,
      who,
      done: false,
      bought: false,
      cost: 0,
      createdAt: nowISO()
    };

    await addItem(list, item);
    e.target.reset();
    if ($("#itemQty")) $("#itemQty").value = "1";
    if ($("#itemList")) $("#itemList").value = "checklist";
  });

  // Teen quick add
  $("#quickAddForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const parsed = parseQuickAdd($("#quickAddText")?.value);
    if (!parsed?.name) return;

    const list = $("#quickAddList")?.value || "checklist";
    await addItem(list, {
      id: uid(),
      name: parsed.name,
      category: "misc",
      qty: parsed.qty,
      note: "",
      want: "",
      who: "",
      done: false,
      bought: false,
      cost: 0,
      createdAt: nowISO()
    });

    $("#quickAddText").value = "";
    $("#quickAddText").focus();
  });

  // Filters/search (teen)
  $("#searchChecklist")?.addEventListener("input", render);
  $("#filterChecklist")?.addEventListener("change", render);
  $("#searchWishlist")?.addEventListener("input", render);
  $("#filterWishlist")?.addEventListener("change", render);

  // Participants (teen)
  const participantsInput = $("#participantsInput");
  if (participantsInput) {
    participantsInput.addEventListener("blur", async () => {
      if (isRenderingFromRemote) return;
      const parts = parseParticipants(participantsInput.value);
      await updateParticipantsToRoom(parts);
      renderSplit();
    });
    participantsInput.addEventListener("input", renderSplit);
  }

  // Reset room (teen)
  const bindReset = (id) => {
    $(id)?.addEventListener("click", async () => {
      const ok = confirm(`確定要清空房間 "${ROOM_ID}" 嘅所有資料？（會影響所有人同步）`);
      if (!ok) return;

      const batch = writeBatch(db);
      const [cSnap, wSnap] = await Promise.all([getDocs(checklistCol), getDocs(wishlistCol)]);
      for (const d of cSnap.docs) batch.delete(d.ref);
      for (const d of wSnap.docs) batch.delete(d.ref);

      const seed = seedItems();
      for (const it of seed.checklist) {
        const id = uid();
        batch.set(doc(checklistCol, id), normalizeItemForWrite({ id, ...it }, "checklist"));
      }
      for (const it of seed.wishlist) {
        const id = uid();
        batch.set(doc(wishlistCol, id), normalizeItemForWrite({ id, ...it }, "wishlist"));
      }
      batch.set(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
      await batch.commit();
    });
  };
  bindReset("#btnReset");
  bindReset("#btnReset2");

  // Export/import (teen)
  const bindExport = (id) => $(id)?.addEventListener("click", exportJSON);
  bindExport("#btnExport");
  bindExport("#btnExport2");

  const bindImport = (id) => {
    $(id)?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importJSONFile(file);
        alert("匯入成功 ✅");
      } catch (err) {
        alert(`匯入失敗：${err.message}`);
      } finally {
        e.target.value = "";
      }
    });
  };
  bindImport("#importFile");
  bindImport("#importFile2");

  // Copy transfers (teen)
  $("#btnCopyTransfers")?.addEventListener("click", async () => {
    const text = state.meta.lastTransfersText || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const toast = $("#copyToast");
      if (toast) {
        toast.textContent = "已 copy ✅";
        setTimeout(() => { toast.textContent = ""; }, 1200);
      }
    } catch {
      alert("Copy 失敗：可能瀏覽器唔支援 clipboard。");
    }
  });
}

// ===== Auth + boot =====
async function boot() {
  bindUIEvents();
  await signInAnonymously(auth);
  await ensureRoomExistsAndMaybeSeed();
  stopRealtime();
  startRealtime();
  render();
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    // signed in
  }
});

boot().catch((err) => {
  console.error(err);
  alert("啟動失敗。請檢查 Firebase 設定同 Firestore/Auth。\n\n" + err.message);
});
