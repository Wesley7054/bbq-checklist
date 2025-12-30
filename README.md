# Checklist Web App 

A lightweight, real-time checklist web app designed for **both seniors and power users**.

Built with **plain HTML / CSS / JavaScript + Firebase**, optimized for **mobile-first usage**, and deployable on **GitHub Pages**.

---

## Key Features

### Two Usage Modes (Progressive Disclosure)

#### EZ Mode (Default)
Designed for seniors and non-technical users.

- Simple, clean UI
- Each item displayed **in a single row**
- Large buttons, minimal text
- Actions available:
  - Mark done / bought
  - Adjust quantity (+ / -)
  - Assign buyer
  - Move item between *Checklist* and *Wishlist*
-  **No delete function** (safe mode)

#### Advance Mode
Designed for power users.

- Full feature set
- Add / delete items
- Wishlist management
- Settlement & cost split
- Filters and advanced interactions

> The app defaults to **EZ Mode** on first load and remembers the user’s choice using `localStorage`.

---

## Mobile UX (V3.6 Behavior)

- EZ Mode on mobile uses a **true table layout**
- Each item stays **on a single horizontal row**
- Horizontal scrolling is enabled if the screen is too narrow
- No stacked cards, no hidden values
- Controls automatically scale using CSS `clamp()`

---

## Multi-User Collaboration

- Share the same list using a URL parameter:
