/* 
  BBQ Checklist App (Firestore Realtime Sync)
  - Single page static app (GitHub Pages friendly)
  - Real-time sync across users via Firestore
  - Room concept: /rooms/{roomId}
  - Items stored in subcollections:
      /rooms/{roomId}/checklist/{itemId}
      /rooms/{roomId}/wishlist/{itemId}

  Notes:
  - This file assumes your HTML has the same element IDs as your current version.
  - Requires <script type="module" src="app.js"></script> in index.html
  - Requires Firebase project + Firestore enabled
  - Recommended: enable Firebase Auth (Anonymous) + rules require auth
*/

// ===== Firebase (v9+ modular) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

// ===== 1) Paste your Firebase config here =====
const firebaseConfig = {
  apiKey: "AIzaSyCVE3IJt-6Cc7gtJ0Nshf7XuUOa_OIdPYs",
  authDomain: "bbq-checklist.firebaseapp.com",
  projectId: "bbq-checklist",
  storageBucket: "bbq-checklist.firebasestorage.app",
  messagingSenderId: "300895897312",
  appId: "1:300895897312:web:fbf41a8ff697011e893285"
};

// ===== App init =====
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// ===== Helpers =====
const $ = (sel) => document.querySelector(sel);

function uid() {
  // Not cryptographically secure; good enough for local IDs.
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function nowISO() {
  return new Date().toISOString();
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function currency(amount) {
  const n = Number(amount || 0);
  return `$${n.toFixed(2)}`;
}

function matchesText(item, q) {
  const t = `${item.name} ${item.category} ${item.note} ${item.who}`.toLowerCase();
  return t.includes(q.toLowerCase());
}

// ===== Room handling =====
// Use URL: .../index.html?room=bbq-2025
// Fallback room: bbq-2025
function getRoomId() {
  const u = new URL(location.href);
  const room = (u.searchParams.get("room") || "bbq-2025").trim();
  // Firestore doc id cannot contain '/' etc.
  return room.replace(/[\/#?[\]]/g, "-");
}

const ROOM_ID = getRoomId();
const roomRef = doc(db, "rooms", ROOM_ID);
const checklistCol = collection(db, "rooms", ROOM_ID, "checklist");
const wishlistCol = collection(db, "rooms", ROOM_ID, "wishlist");

// ===== Local view state =====
let state = {
  meta: {
    version: 2,
    roomId: ROOM_ID,
    updatedAt: nowISO()
  },
  checklist: [],
  wishlist: []
};

let unsubChecklist = null;
let unsubWishlist = null;
let unsubRoom = null;

// Prevent event storms when snapshot updates UI
let isRenderingFromRemote = false;

// ===== Default seed =====
function seedItems() {
  // Only seed if both collections are empty
  return {
    checklist: [
      { name: "Charcoal", category: "food", qty: 1, note: "", done: false, bought: false, who: "", cost: 0 },
      { name: "Tongs", category: "equipment", qty: 1, note: "", done: false, bought: false, who: "", cost: 0 },
      { name: "Paper plates", category: "misc", qty: 1, note: "", done: false, bought: false, who: "", cost: 0 }
    ],
    wishlist: [
      { name: "Portable fan", category: "equipment", qty: 1, note: "If outdoor super hot", bought: false, who: "", cost: 0 }
    ]
  };
}

async function ensureRoomExistsAndMaybeSeed() {
  // Create room doc (upsert)
  await setDoc(
    roomRef,
    {
      roomId: ROOM_ID,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    },
    { merge: true }
  );

  // Check emptiness
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
  // Keep schema stable across clients
  const base = {
    id: item.id || uid(),
    name: (item.name || "").trim(),
    category: (item.category || "misc").trim(),
    qty: Math.max(1, safeNumber(item.qty ?? 1)),
    note: item.note || "",
    who: item.who || "",
    cost: Math.max(0, safeNumber(item.cost ?? 0)),
    bought: !!item.bought,
    done: type === "checklist" ? !!item.done : false,
    createdAt: item.createdAt || nowISO(),
    updatedAt: nowISO()
  };

  // Small logic: if cost > 0 => bought true
  if (base.cost > 0) base.bought = true;

  return base;
}

async function touchRoom() {
  await setDoc(roomRef, { updatedAt: serverTimestamp() }, { merge: true });
}

// ===== Realtime listeners =====
function startRealtime() {
  // Order by createdAt for stable view. If old docs miss createdAt, Firestore still sorts them but could be mixed.
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

  // Room meta (participants list)
  unsubRoom = onSnapshot(roomRef, (snap) => {
    const data = snap.data() || {};
    const participants = Array.isArray(data.participants) ? data.participants : [];
    state.meta.participants = participants.map((x) => String(x || "").trim()).filter(Boolean);
    syncParticipantsInput();
    renderSplit();
  });

}

function stopRealtime() {
  if (unsubChecklist) unsubChecklist();
  if (unsubWishlist) unsubWishlist();
  if (unsubRoom) unsubRoom();
  unsubChecklist = null;
  unsubWishlist = null;
  unsubRoom = null;
}

// ===== UI rendering =====
function filteredChecklist() {
  const q = $("#searchChecklist").value.trim();
  const f = $("#filterChecklist").value;

  return state.checklist
    .filter((it) => (q ? matchesText(it, q) : true))
    .filter((it) => {
      if (f === "all") return true;
      //if (f === "open") return !it.done && !it.bought;
      if (f === "open") return !it.done;
      if (f === "done") return !!it.done;
      if (f === "bought") return !!it.bought;
      return true;
    });
}

function filteredWishlist() {
  const q = $("#searchWishlist").value.trim();
  const f = $("#filterWishlist").value;

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
  // Avoid re-entrant changes while rendering from snapshots
  isRenderingFromRemote = true;

  renderTable({
    items: filteredChecklist(),
    tbody: $("#checklistBody"),
    type: "checklist"
  });

  renderTable({
    items: filteredWishlist(),
    tbody: $("#wishlistBody"),
    type: "wishlist"
  });

  renderStats();
  renderSplit();

  // Update meta display if you have a place for it (optional)
  state.meta.updatedAt = nowISO();

  isRenderingFromRemote = false;
}

function renderTable({ items, tbody, type }) {
  tbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");

    const checked = type === "checklist" ? !!item.done : !!item.bought;

    const labels = type === "checklist"
      ? { check: "完成", item: "物品", cat: "分類", qty: "數量", who: "邊個買", cost: "金額", note: "備註", act: "操作" }
      : { check: "已買", item: "物品", cat: "分類", qty: "數量", who: "邊個買", cost: "金額", note: "備註", act: "操作" };

    tr.appendChild(tdCheckbox(type, item, checked, labels.check));
    tr.appendChild(tdText(item.name, "strong", labels.item));
    tr.appendChild(tdBadge(item.category, labels.cat));
    tr.appendChild(tdQty(type, item, labels.qty));
    tr.appendChild(tdWho(type, item, labels.who));
    tr.appendChild(tdCost(type, item, labels.cost));
    tr.appendChild(tdNote(type, item, labels.note));
    tr.appendChild(tdActions(type, item, labels.act));

    tbody.appendChild(tr);
  }

  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
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

function tdBadge(category, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = category || "misc";
  td.appendChild(span);
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
    if (type === "checklist") {
      patch.done = input.checked;
      // If marked done, not necessarily bought; keep as is
    } else {
      patch.bought = input.checked;
    }

    // If checked in any list => bought true is reasonable
    if (input.checked) patch.bought = true;

    await updateItem(type, item.id, patch);
  });

  td.appendChild(input);
  return td;
}

function tdQty(type, item, label = "") {
  const td = document.createElement("td");
  if (label) td.dataset.label = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.value = item.qty ?? 1;
  input.style.width = "70px";

  input.addEventListener("change", async () => {
    if (isRenderingFromRemote) return;
    const qty = Math.max(1, safeNumber(input.value));
    await updateItem(type, item.id, { qty });
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

  // Use debounce-ish pattern: update on blur to reduce writes
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
  if (label) td.dataset.label = label;
  td.style.whiteSpace = "nowrap";

  const btnMove = document.createElement("button");
  btnMove.type = "button";
  btnMove.className = "icon-btn";
  btnMove.title = type === "checklist" ? "移去「想買」" : "移去「清單」";
  btnMove.textContent = type === "checklist" ? "→ 想買" : "→ 清單";
  btnMove.addEventListener("click", async () => {
    if (isRenderingFromRemote) return;
    await moveItem(type, item.id);
  });

  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "icon-btn";
  btnDel.title = "刪除";
  btnDel.textContent = "🗑️";
  btnDel.style.marginLeft = "8px";
  btnDel.addEventListener("click", async () => {
    if (isRenderingFromRemote) return;
    await deleteItem(type, item.id);
  });

  td.appendChild(btnMove);
  td.appendChild(btnDel);
  return td;
}

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


// ===== Split bill (participants + balance) =====
function parseParticipants(text) {
  return String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function unique(arr) {
  return Array.from(new Set(arr));
}

function inferredParticipantsFromItems() {
  const all = [...state.checklist, ...state.wishlist];
  return unique(
    all
      .map((it) => String(it.who || "").trim())
      .filter(Boolean)
  );
}

function getParticipants() {
  const fromRoom = Array.isArray(state.meta.participants) ? state.meta.participants : [];
  if (fromRoom.length > 0) return fromRoom;
  return inferredParticipantsFromItems();
}

function syncParticipantsInput() {
  const el = document.querySelector("#participantsInput");
  if (!el) return;

  // Don't overwrite while user is typing
  if (document.activeElement === el) return;

  const participants = getParticipants();
  el.value = participants.join(", ");
}

async function updateParticipantsToRoom(participants) {
  const cleaned = unique(participants.map((x) => String(x || "").trim()).filter(Boolean));
  await setDoc(roomRef, { participants: cleaned, updatedAt: serverTimestamp() }, { merge: true });
}

function renderSplit() {
  const shareEl = document.querySelector("#perPersonShare");
  const listEl = document.querySelector("#splitResult");
  if (!shareEl || !listEl) return;

  const all = [...state.checklist, ...state.wishlist];
  const total = all.reduce((sum, it) => sum + safeNumber(it.cost), 0);

  const participants = getParticipants();
  const n = participants.length;

  const per = n > 0 ? total / n : 0;
  shareEl.textContent = currency(per);

  if (n === 0) {
    listEl.innerHTML = `<div class="muted">先喺上面輸入參加者，或者喺「邊個買」填返名。</div>`;
    return;
  }

  // Paid per person
  const paid = {};
  for (const name of participants) paid[name] = 0;

  for (const it of all) {
    const who = String(it.who || "").trim();
    const cost = safeNumber(it.cost);
    if (!who || cost <= 0) continue;

    // If name not in list, still count it (avoid losing data)
    if (!(who in paid)) paid[who] = 0;

    paid[who] += cost;
  }

  // Balance: + => should receive, - => should pay
  const rows = Object.keys(paid).sort((a, b) => a.localeCompare(b, "zh-HK"));
  listEl.innerHTML = rows
    .map((name) => {
      const diff = paid[name] - per;
      const abs = Math.abs(diff);

      let action = "剛剛好 ✅";
      let hint = "唔使收 / 唔使俾";
      if (diff > 0.00001) {
        action = `應收返 ${currency(abs)}`;
        hint = "你比多咗，可以收返差額";
      } else if (diff < -0.00001) {
        action = `應俾 ${currency(abs)}`;
        hint = "你比少咗，要補返差額";
      }

      return `
        <div class="settle__row">
          <div>
            <div class="settle__name">${escapeHTML(name)}</div>
            <div class="settle__hint">已俾：${currency(paid[name])}</div>
          </div>
          <div style="text-align:right">
            <div style="font-weight:800">${action}</div>
            <div class="settle__hint">${hint}</div>
          </div>
        </div>
      `;
    })
    .join("");
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
function colForType(type) {
  return type === "checklist" ? checklistCol : wishlistCol;
}

async function addItem(type, item) {
  const col = colForType(type);
  const id = item.id || uid();

  // Use setDoc with known id so UI can reference it
  await setDoc(doc(col, id), normalizeItemForWrite({ ...item, id }, type));
  await touchRoom();
}

async function updateItem(type, id, patch) {
  const col = colForType(type);
  const ref = doc(col, id);

  const normalizedPatch = { ...patch, updatedAt: nowISO() };

  // If cost set > 0 => bought true
  if ("cost" in normalizedPatch) {
    const cost = Math.max(0, safeNumber(normalizedPatch.cost));
    normalizedPatch.cost = cost;
    if (cost > 0) normalizedPatch.bought = true;
  }

  await updateDoc(ref, normalizedPatch);
  await touchRoom();
}

async function deleteItem(type, id) {
  const ok = confirm("刪除呢個項目？");
  if (!ok) return;

  const col = colForType(type);
  await deleteDoc(doc(col, id));
  await touchRoom();
}

async function moveItem(type, id) {
  const fromType = type;
  const toType = type === "checklist" ? "wishlist" : "checklist";

  const fromArr = fromType === "checklist" ? state.checklist : state.wishlist;
  const item = fromArr.find((x) => x.id === id);
  if (!item) return;

  // Copy item with adjustments
  const moved = { ...item };
  if (toType === "wishlist") {
    moved.done = false;
  }

  const batch = writeBatch(db);
  batch.delete(doc(colForType(fromType), id));
  batch.set(doc(colForType(toType), id), normalizeItemForWrite(moved, toType));
  batch.set(roomRef, { updatedAt: serverTimestamp() }, { merge: true });

  await batch.commit();
}

// ===== Export / Import =====
async function exportJSON() {
  const payload = {
    meta: {
      version: 2,
      roomId: ROOM_ID,
      exportedAt: nowISO()
    },
    checklist: state.checklist,
    wishlist: state.wishlist
  };

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
  if (!Array.isArray(parsed.checklist) || !Array.isArray(parsed.wishlist)) {
    throw new Error("JSON must include checklist and wishlist arrays");
  }

  // Replace remote data with imported data
  const batch = writeBatch(db);

  // Delete existing docs
  const [cSnap, wSnap] = await Promise.all([getDocs(checklistCol), getDocs(wishlistCol)]);
  for (const d of cSnap.docs) batch.delete(d.ref);
  for (const d of wSnap.docs) batch.delete(d.ref);

  // Write imported docs
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

// ===== Events wiring =====
function bindUIEvents() {
  // Add new item
  $("#addForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = $("#itemName").value.trim();
    const category = $("#itemCategory").value;
    const list = $("#itemList").value; // "checklist" or "wishlist"
    const qty = Math.max(1, safeNumber($("#itemQty").value));
    const note = $("#itemNote").value.trim();
    const who = $("#itemWho").value.trim();

    if (!name) return;

    const item = {
      id: uid(),
      name,
      category,
      qty,
      note,
      who,
      done: false,
      bought: false,
      who: "",
      cost: 0,
      createdAt: nowISO()
    };

    await addItem(list, item);

    e.target.reset();
    $("#itemQty").value = "1";
    $("#itemList").value = "checklist";
  });

  // Filters/search (pure UI; snapshot will re-render anyway)
  $("#searchChecklist").addEventListener("input", render);
  $("#filterChecklist").addEventListener("change", render);
  $("#searchWishlist").addEventListener("input", render);
  $("#filterWishlist").addEventListener("change", render);


  // Participants (split bill)
  const participantsInput = document.querySelector("#participantsInput");
  if (participantsInput) {
    participantsInput.addEventListener("blur", async () => {
      if (isRenderingFromRemote) return;
      const parts = parseParticipants(participantsInput.value);
      await updateParticipantsToRoom(parts);
      renderSplit();
    });

    // Live preview while typing (no writes)
    participantsInput.addEventListener("input", () => {
      renderSplit();
    });
  }

  // Reset room data
  $("#btnReset").addEventListener("click", async () => {
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

  $("#btnExport").addEventListener("click", exportJSON);

  $("#importFile").addEventListener("change", async (e) => {
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
}

// ===== Auth + boot =====
async function boot() {
  // Show room id somewhere (optional)
  // If your HTML has an element like #roomLabel, you can set it here:
  // const roomLabel = document.querySelector("#roomLabel");
  // if (roomLabel) roomLabel.textContent = ROOM_ID;

  bindUIEvents();

  // Anonymous auth helps you use safer Firestore rules
  await signInAnonymously(auth);

  await ensureRoomExistsAndMaybeSeed();
  stopRealtime();
  startRealtime();
  render();
}

onAuthStateChanged(auth, (user) => {
  if (user) {
    // User is signed in
    // You can log uid if needed:
    // console.log("Signed in as:", user.uid);
  }
});

// Start
boot().catch((err) => {
  console.error(err);
  alert("啟動失敗。請檢查 Firebase 設定同 Firestore/Auth。\n\n" + err.message);
});
