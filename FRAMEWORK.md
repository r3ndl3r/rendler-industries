# /FRAMEWORK.md

# RENDLER INDUSTRIES: Developer Guide

Welcome to the Rendler Industries development framework. This guide is designed to get you up to speed immediately so you can start building new modules and features. Our stack is built on **Modern Perl (Mojolicious)**, **MariaDB**, and **Vanilla JavaScript**.

---

## 🏛 1. Core Architecture: The 100% SPA Pattern

All modules in this dashboard are designed as **Single Page Applications (SPA)**. To ensure a fast, "app-like" feel, we follow a specific loading pattern:

1.  **Skeleton First**: The server renders a static HTML template (the "Skeleton") with no data loops. It shows a loading pulse while the client prepares.
2.  **API Handshake**: The JavaScript client makes a single fetch to `/module/api/state`.
3.  **Hydration**: The JS then renders the UI dynamically from that JSON state.

**Tip:** Use a global `STATE` object in your JS to store the data. When a user adds or deletes an item, update this object and re-render the UI locally for instant feedback.

---

## 🚀 2. Quick Start: The "New Module" Recipe

To create a new application (e.g., "Tasks"), follow these steps:

1.  **Database**: Define your table in `assets/schema.sql` and run it in MariaDB.
2.  **Routing**: Register your routes in `lib/MyApp.pm`. Use the `/api/` prefix for data-only endpoints.
3.  **Controller**: Create `lib/MyApp/Controller/Tasks.pm`. Implement an `index` action for the page and an `api_state` action for the data.
4.  **Frontend**: 
    - Create `templates/tasks.html.ep` (The static skeleton).
    - Create `public/js/tasks.js` (The logic to fetch state and render).
    - Create `public/css/tasks.css` (Module-specific styles).

---

## 🎨 3. UI Component Cheat Sheet (Glassmorphism)

To keep the dashboard consistent, use these standard CSS classes defined in `default.css`:

### Containers & Panels
*   `.app-container`: **Mandatory.** The root wrapper for every module. Enforces consistent vertical alignment and padding.
*   `.glass-panel`: The standard frosted container with a subtle border.
*   `.header-bar`: Standard flex container for the top of a page (H1 + `.manage-actions`). Controls global page spacing.

### Buttons & Icons
*   **Header Actions**: Place buttons inside `.manage-actions` to ensure they scale correctly on mobile.
*   **Action Buttons**: `.btn-primary` (Blue), `.btn-secondary` (Slate), `.btn-danger` (Red).
*   **Icon Buttons**: `.btn-icon-edit` (Sky Blue), `.btn-icon-delete` (Rose Red), `.btn-icon-ai` (Indigo).

### Visibility & State
*   **Standard**: Use `.classList.add('show')` or `.add('hidden')` exclusively. 
*   **Prohibited**: Direct manipulation of `.style.display` is strictly forbidden.

---

## 🏗 4. Architecture Patterns

Choose the reference pattern that matches your data complexity. Copy structure from existing apps for these.

### Pattern A: The Ledger (Table-based)
*   **Best For**: Detailed logs and records (e.g., Receipts, User Mgmt).
*   **Implementation**: Wrap `<table>` in `.table-responsive`. Use `.data-table`.
*   **Mobile**: Use `transparent` table backgrounds to treat rows as distinct cards.

### Pattern B: The Dashboard (Card-based)
*   **Best For**: Status tracking and quick actions (e.g., Timers, Todo, Meals).
*   **Implementation**: Use `.glass-panel` tiles within an `.app-container`.

---

## 🛠 5. The Developer Toolbox (Global Functions)

Don't reinvent the wheel. Use these pre-built "Power Tools" for rapid development:

### Frontend (JavaScript - `public/js/default.js`)
*   **AJAX**: `apiPost(url, data)` handles JSON POSTs with built-in CSRF and error handling.
*   **Modals**: `showConfirmModal({ title, message, onConfirm })` is the primary tool for terminal actions.
*   **UI**: `showToast('Saved!', 'success')` for notifications.

### Backend (Perl - `Icons.pm` Helpers)
*   **Icons**: `<%= icon('edit') %>` for use in templates. Draws from the same JSON source as JS.
*   **Authorization**: `$c->is_admin`, `$c->is_family`, `$c->is_logged_in`.
*   **Centralized Registry**: Update `assets/emoji.json` to change icons application-wide.

---

## ⚙️ 6. Background Tasks (Maintenance)

If your app needs a background poller (e.g., checking for expiring timers every minute):
1.  Add a public method to `lib/MyApp/Controller/System.pm` (e.g., `run_tasks_maintenance`).
2.  Invoke it inside the `run_maintenance` helper in `lib/MyApp.pm`.
3.  The system will automatically execute it every 60 seconds with singleton protection (Global Lock).

---

## 💡 7. Pro-Tips & Common Pitfalls

*   **Visibility Toggling**: Never use `el.style.display = 'block'`. The global `.hidden` class uses `!important`, meaning inline styles will fail to override it. Always use `.classList.remove('hidden')`.
*   **Header Spacing**: The space between the header and your content is managed by `default.css`. Do not add `margin-top` to your first content element; it will be stripped to maintain a uniform gap.
*   **Checkbox Logic**: Browser `FormData` ignores unchecked boxes. In your JS, always explicitly set the value (`0` or `1`) before sending to the API.
*   **Atomic UI**: Always use `finally` blocks in async handlers to restore button states to prevent buttons from getting "stuck" in a loading state.

---

## 📂 8. File Map & Naming Schemes

| Component | Path | Convention |
| :--- | :--- | :--- |
| **Controller** | `lib/MyApp/Controller/` | CamelCase (e.g., `ShoppingList.pm`) |
| **Model/DB** | `lib/DB/` | Matches Controller (e.g., `ShoppingList.pm`) |
| **Templates** | `templates/` | lowercase (e.g., `shopping_list.html.ep`) |
| **JS/CSS** | `public/js/` & `public/css/` | lowercase (e.g., `shopping_list.js`) |

---

## ⚙️ 9. Environment
*   **Restart Server**: Run `./restart` in the root.
*   **View Logs**: `tail -f ignore/mojo.log`.
*   **DB Access**: `mariadb -h localhost -u "$DB_USER" -p"$DB_PASS" www`
