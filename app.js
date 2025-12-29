/* 
  BBQ Checklist App
  - Single page static app
  - Stores data in localStorage
  - Supports Export/Import JSON for team syncing in GitHub
*/

const STORAGE_KEY = "bbq_checklist_v1";

const $ = (sel) => document.querySelector(sel);

function uid() {
  // Not cryptographically secure; good enough for local IDs.
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function currency(amount) {
  const n = Number(amount || 0);
  // Keep it simple: no locale assumptions, user can edit.
  return `$${n.toFixed(2)}`;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function nowISO() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    meta: {
      version: 1,
      updatedAt: nowISO()
    },
    checklist: [
      { id: uid(), name: "Charcoal", category: "food", qty: 1, note: "", done: false, bought: false, who: "", cost: 0, createdAt: nowISO() },
      { id: uid(), name: "Tongs", category: "equipment", qty: 1, note: "", done: false, bought: false, who: "", cost: 0, createdAt: nowISO() },
      { id: uid(), name: "Paper plates", category: "misc", qty: 1, note: "", done: false, bought: false, who: "", cost: 0, createdAt: nowISO() }
    ],
    wishlist: [
      { id: uid(), name: "Portable fan", category: "equipment", qty: 1, note: "If outdoor super hot", bought: false, who: "", cost: 0, createdAt: nowISO() }
    ]
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultState();
    if (!parsed.checklist || !parsed.wishlist) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

function saveState() {
  state.meta.updatedAt = nowISO();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state, null, 2));
}

let state = loadState();

function matchesText(item, q) {
  const t = `${item.name} ${item.category} ${item.note} ${item.who}`.toLowerCase();
  return t.includes(q.toLowerCase());
}

function render() {
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
  saveState();
}

function filteredChecklist() {
  const q = $("#searchChecklist").value.trim();
  const f = $("#filterChecklist").value;

  return state.checklist
    .filter((it) => (q ? matchesText(it, q) : true))
    .filter((it) => {
      if (f === "all") return true;
      if (f === "open") return !it.done && !it.bought;
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

function renderTable({ items, tbody, type }) {
  tbody.innerHTML = "";

  for (const item of items) {
    const tr = document.createElement("tr");

    const checked = type === "checklist" ? !!item.done : !!item.bought;

    tr.appendChild(tdCheckbox(type, item, checked));
    tr.appendChild(tdText(item.name, "strong"));
    tr.appendChild(tdBadge(item.category));
    tr.appendChild(tdQty(type, item));
    tr.appendChild(tdWho(type, item));
    tr.appendChild(tdCost(type, item));
    tr.appendChild(tdNote(type, item));
    tr.appendChild(tdActions(type, item));

    tbody.appendChild(tr);
  }

  if (items.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 8;
    td.className = "muted";
    td.style.padding = "14px 10px";
    td.textContent = "No items here.";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function tdText(text, tag = "span") {
  const td = document.createElement("td");
  const el = document.createElement(tag);
  el.textContent = text || "";
  td.appendChild(el);
  return td;
}

function tdBadge(category) {
  const td = document.createElement("td");
  const span = document.createElement("span");
  span.className = "badge";
  span.textContent = category || "misc";
  td.appendChild(span);
  return td;
}

function tdCheckbox(type, item, checked) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "checkbox";
  input.checked = checked;

  input.addEventListener("change", () => {
    if (type === "checklist") {
      item.done = input.checked;
    } else {
      item.bought = input.checked;
    }
    // If marked bought, you probably don't need it open.
    if (input.checked) item.bought = true;
    render();
  });

  td.appendChild(input);
  return td;
}

function tdQty(type, item) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.value = item.qty ?? 1;
  input.style.width = "70px";
  input.addEventListener("change", () => {
    item.qty = Math.max(1, safeNumber(input.value));
    render();
  });
  td.appendChild(input);
  return td;
}

function tdWho(type, item) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.placeholder = "Name";
  input.value = item.who || "";
  input.addEventListener("input", () => {
    item.who = input.value;
    saveState();
  });
  td.appendChild(input);
  return td;
}

function tdCost(type, item) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "number";
  input.min = "0";
  input.step = "0.01";
  input.className = "money";
  input.placeholder = "0.00";
  input.value = item.cost ?? 0;
  input.addEventListener("change", () => {
    item.cost = Math.max(0, safeNumber(input.value));
    // If there is a cost, we can assume it is bought.
    if (item.cost > 0) item.bought = true;
    render();
  });
  td.appendChild(input);
  return td;
}

function tdNote(type, item) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.placeholder = "Note...";
  input.value = item.note || "";
  input.addEventListener("input", () => {
    item.note = input.value;
    saveState();
  });
  td.appendChild(input);
  return td;
}

function tdActions(type, item) {
  const td = document.createElement("td");
  td.style.whiteSpace = "nowrap";

  const btnMove = document.createElement("button");
  btnMove.type = "button";
  btnMove.className = "icon-btn";
  btnMove.title = type === "checklist" ? "Move to wishlist" : "Move to checklist";
  btnMove.textContent = type === "checklist" ? "→ Wish" : "→ List";
  btnMove.addEventListener("click", () => {
    moveItem(type, item.id);
  });

  const btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "icon-btn";
  btnDel.title = "Delete";
  btnDel.textContent = "🗑️";
  btnDel.style.marginLeft = "8px";
  btnDel.addEventListener("click", () => {
    deleteItem(type, item.id);
  });

  td.appendChild(btnMove);
  td.appendChild(btnDel);
  return td;
}

function moveItem(type, id) {
  if (type === "checklist") {
    const idx = state.checklist.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const [it] = state.checklist.splice(idx, 1);
    // When moving to wishlist, done flag is irrelevant.
    it.done = false;
    state.wishlist.unshift(it);
  } else {
    const idx = state.wishlist.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const [it] = state.wishlist.splice(idx, 1);
    state.checklist.unshift(it);
  }
  render();
}

function deleteItem(type, id) {
  const ok = confirm("Delete this item?");
  if (!ok) return;

  if (type === "checklist") {
    state.checklist = state.checklist.filter((x) => x.id !== id);
  } else {
    state.wishlist = state.wishlist.filter((x) => x.id !== id);
  }
  render();
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
    <span class="badge">Total: ${state.checklist.length}</span>
    <span class="badge">Done: ${checklistDone}</span>
    <span class="badge">Bought: ${checklistBought}</span>
    <span class="badge">Open: ${Math.max(0, checklistOpen)}</span>
  `;

  const wishBought = state.wishlist.filter((it) => !!it.bought).length;
  const wishOpen = state.wishlist.length - wishBought;

  $("#wishlistStats").innerHTML = `
    <span class="badge">Total: ${state.wishlist.length}</span>
    <span class="badge">Bought: ${wishBought}</span>
    <span class="badge">Open: ${Math.max(0, wishOpen)}</span>
  `;
}

/* ===== Events ===== */

$("#addForm").addEventListener("submit", (e) => {
  e.preventDefault();

  const name = $("#itemName").value.trim();
  const category = $("#itemCategory").value;
  const list = $("#itemList").value;
  const qty = Math.max(1, safeNumber($("#itemQty").value));
  const note = $("#itemNote").value.trim();

  if (!name) return;

  const item = {
    id: uid(),
    name,
    category,
    qty,
    note,
    done: false,
    bought: false,
    who: "",
    cost: 0,
    createdAt: nowISO()
  };

  if (list === "wishlist") {
    state.wishlist.unshift(item);
  } else {
    state.checklist.unshift(item);
  }

  e.target.reset();
  $("#itemQty").value = "1";
  $("#itemList").value = "checklist";

  render();
});

$("#searchChecklist").addEventListener("input", render);
$("#filterChecklist").addEventListener("change", render);
$("#searchWishlist").addEventListener("input", render);
$("#filterWishlist").addEventListener("change", render);

$("#btnReset").addEventListener("click", () => {
  const ok = confirm("Reset everything? This clears your browser storage.");
  if (!ok) return;
  state = defaultState();
  saveState();
  render();
});

$("#btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `bbq-checklist-export-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});

$("#importFile").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON");
    if (!Array.isArray(parsed.checklist) || !Array.isArray(parsed.wishlist)) {
      throw new Error("JSON must include checklist and wishlist arrays");
    }

    state = parsed;
    saveState();
    render();
    alert("Imported successfully ✅");
  } catch (err) {
    alert(`Import failed: ${err.message}`);
  } finally {
    e.target.value = "";
  }
});

render();
