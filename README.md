# 🌌 Rendler Industries: The Family OS

[![Perl](https://img.shields.io/badge/Perl-v5.30+-39457E?logo=perl&logoColor=white)](https://www.perl.org/)
[![Mojolicious](https://img.shields.io/badge/Framework-Mojolicious-df3b30?logo=mojolicious&logoColor=white)](https://mojolicious.org/)
[![MariaDB](https://img.shields.io/badge/Database-MariaDB-003545?logo=mariadb&logoColor=white)](https://mariadb.org/)
[![Deploy](https://img.shields.io/badge/Server-Hypnotoad-brightgreen?logo=apache&logoColor=white)](#)

A hyper-integrated, full-stack home laboratory and family management ecosystem. Built with **Modern Perl** and the **Mojolicious** real-time framework, this platform centralizes household automation, organization, and entertainment into a secure, glassmorphic dashboard.

---

## 🛠 Tech Stack & Infrastructure

### **The Core Engine**
*   **Framework:** [Mojolicious](https://mojolicious.org/) - Utilizing Non-blocking I/O, WebSockets, and a modular Controller-Model-Plugin architecture.
*   **Web Server:** `Hypnotoad` - Enabling zero-downtime hot-reloads and multi-process worker management.
*   **Database:** **MariaDB 10.x** - Relational storage with strict foreign keys and polymorphic ledger tables.
*   **Native Orchestration:** Background maintenance loops handling temporal state tracking, idempotency, and proactive system-wide synchronization.
*   **Security:** 
    *   Tiered RBAC (Guest → User → Family → Admin).
    *   Manual admin approval workflow for new registrations.
    *   Native Android admin access bridges Cloudflare Access challenges through a browser handoff and `/admin/auth/callback` deep-link return.

### **📡 The Multi-Channel Notification Hub**
The system features a redundant, priority-weighted alert engine for real-time and scheduled notifications:
1.  **Discord (Primary):** Persistent Gateway WebSocket (owned by one Hypnotoad worker with automatic failover) for inbound DM command processing, plus outbound REST DMs for notifications and alerts.
2.  **FCM (Firebase Cloud Messaging):** Native Android push notifications delivered to the Rendler Industries companion app. Tap actions navigate directly to the originating module. Tokens are registered per-device and pruned automatically on stale 404 responses.
3.  **Gotify:** Self-hosted push notifications for system-level alerts and infrastructure monitoring.
4.  **Gmail/SMTP:** Redundant email delivery for complex data (like Calendar invitations, impending event reminders, or receipt exports).
5.  **Pushover:** Mobile-first emergency alerts for critical infrastructure events.

### **🧠 AI & OCR Infrastructure**
*   **Gemini 2.0 Engine:** Integrated LLM for context-aware household automation and conversational support.
*   **Vision & OCR Pipeline:** Custom high-fidelity processing using ImageMagick and Tesseract for document digitization.
*   **Intelligent Caching:** SHA-256 fingerprinting for Translation and TTS (Text-to-Speech) results to ensure rapid, cost-effective API utilization.

---

## 👑 Administrative & Orchestration

### 🧑‍🔧 Ansible Automator (`/admin/automator`)
*   **Infrastructure Orchestration:** Native integration with **Ansible** for home lab automation and server maintenance.
*   **Secret Manager:** Secure **AES-GCM** storage for deployment secrets, with per-playbook aliases exposed as private files, environment variables, SSH keys, or Ansible Vault passwords.
*   **Real-time Console:** Live execution monitoring via WebSockets, featuring process-group abort support and persistent log history.
*   **Success Chaining:** Complex workflow orchestration allowing playbooks to trigger sequential tasks upon successful completion.
*   **Scheduled Maintenance:** Rule-based scheduling (Daily/Hourly) with automated multi-channel reporting for headless execution.

### 👥 User & Role Control (`/admin/users`)
*   **Approval Workflow:** Registrations are sequestered in a `pending` state. Admins receive alerts and can approve accounts with a single click, triggering an **automated welcome email**.
*   **Role Management:** Real-time toggling of `Admin` and `Family` flags.
*   **Profile Audit:** Manage user Discord IDs, email addresses, and perform secure password resets.

### 🧭 Dynamic Menu Management (`/admin/menu`)
*   **Hierarchical Structure:** Database-driven menu supporting parent/child nesting and separators.
*   **Live Reordering:** Drag-and-drop interface for managing link priority (`sort_order`).
*   **Visibility Logic:** Links are dynamically filtered based on the current user's permission level.

### 📢 Family Broadcast System (`/broadcast`)
*   **High-Priority Dispatch:** Family members can send critical announcements to all administrators.
*   **Multi-Channel Integration:** Automated distribution via **Discord, Email, Pushover, and Gotify**.
*   **Audit Logging:** Comprehensive tracking of all dispatch attempts for accountability.

### ⚙️ Global Settings (`/admin/settings`)
*   **System Variables:** Centralized management of application constants, such as **Timer Reset Hours** and **Quiet Hour** configurations.

### 🛠 Maintenance Manager (`/admin/maintenance`)
*   **Background Task Control:** Real-time dashboard for monitoring and manually triggering scheduled system maintenance tasks (Weather sync, Reminder checks, Emoji processing).
*   **Interval Tuning:** Adjust execution frequency for internal system hooks without restarting the application.

### 🗿 Emoji AI Dictionary (`/admin/emojis`)
*   **Admin Sandbox:** Interactive interface for managing the AI-learned emoji dictionary (`ai_emoji_dictionary`).
*   **Queue Monitoring:** Tracks the depth of emoji processing across whitelisted modules.
*   **AI Training:** Sandbox for testing and seeding new emoji mappings to ensure semantic accuracy.

### 🧠 Family Pulse AI (`/ai`)
*   **Gemini 2.0 Integration:** Powered by Google's Gemini 2.0 Flash model for lightning-fast analysis and household reasoning.
*   **Dashboard Awareness:** Generates real-time context snapshots across all modules (Medication, Calendar, Shopping, Swear Jar) to provide holistic household advice.
*   **Multimodal Vision:** Direct integration with the File Vault and Receipt pipeline for image-based analysis and automated data entry.
*   **Persistent Memory:** Maintains long-term conversational history to ensure continuity in complex planning tasks.

<p align="center">
  <img src="public/images/screenshots/global_settings.png" height="130" />
</p>

---

## 📅 Productivity Suite

### 🧹 Room Cleaning Tracker (`/room`)
*   **Evidence-Based Completion:** Children/Teens upload daily photos to verify room cleanliness.
*   **Admin Review Pipeline:** Dashboard for parents to approve, provide feedback, and manage blackouts.
*   **Discord Alerts:** Real-time feedback and status notifications dispatched to linked Discord accounts.
*   **Configurable Constraints:** Manage blackout dates and per-user monitoring settings.

### 🗓 Advanced Family Calendar (`/calendar`)
*   **Interactive Views:** Switch seamlessly between **Month, Week, Day, and List** modes via FullCalendar.
*   **Event Intelligence:** 
    *   **Cloning:** One-click duplication of existing events for fast scheduling.
    *   **Attendee Tagging:** Tag specific family members to personalize their views and notify them.
    *   **Automated Broadcasting:** System-wide email alerts to all family members when new events are added.
    *   **Proactive Reminders:** Multi-channel alerting (Discord, Email, Gotify, Pushover) triggered before event start times for specific attendees.
    *   **Color Coding:** Categorize events (Doctor, School, Social) with dynamic hex-code styling.

<p align="center">
  <img src="public/images/screenshots/calendar_main.png" height="130" />
  <img src="public/images/screenshots/calendar_event_details.png" height="130" />
</p>

<p align="center">
  <img src="public/images/screenshots/calendar_edit_event.png" height="130" />
  <img src="public/images/screenshots/calendar_manage.png" height="130" />
</p>

### 🧹 Bounty Board & Chores (`/chores`)
*   **Point-Based Economy:** Gamified household management where completing chores earns transferable reward points.
*   **Atomic Claiming:** Conflict-free claiming system ensures only one family member can claim a "bounty" at a time.
*   **Admin Quick-Add:** Dynamic templates based on historical chore data for rapid board updates.
*   **Historical Audit:** Detailed tracking of completed tasks, including completion timestamps and assigned contributors.

<p align="center">
  *Screenshots coming soon...*
</p>

### 🍲 Collaborative Meal Planner (`/meals`)
*   **4-Day Rolling Window:** Dynamic schedule management with automated plan generation.
*   **Democratic Voting:** Family members can suggest meals and vote on favorites to reach a consensus.
*   **Meal Vault:** Centralized autocomplete database of historical family favorites for effortless entry.
*   **Admin Lock-in:** Finalize daily choices and set "Blackout" reasons for special events or eating out.

<p align="center">
  *Screenshots coming soon...*
</p>

### 💊 Medication Tracker (`/medication`)
*   **Integrated Reminders:** Automated follow-up alert scheduling (1-12h) directly from the dose reset modal.
*   **Real-time Interface:** Built-in interval calculation (e.g., "Taken 4h 20m ago").
*   **Modern Selection UI:** Interactive pill-button selectors for delay and recipients to eliminate dropdown friction.
*   **Smart Registry:** Shared medication database with default dosages for lightning-fast entry.

<p align="center">
  <img src="public/images/screenshots/medication_tracker.png" height="130" />
</p>

### 🔔 Smart Reminders (`/reminders`)
*   **Real-time Synchronization:** Background polling with 60s live countdowns.
*   **Recurring Engine:** Rule-based scheduling with **Midnight Rollover Protection** to ensure notifications never skip date boundaries.
*   **Multi-User Mapping:** Link multiple recipients to a single alert via Discord and Gotify.
*   **Self-Cleaning:** Automated deletion of "One-off" reminders after successful delivery.

<p align="center">
  <img src="public/images/screenshots/reminders.png" height="130" />
  <img src="public/images/screenshots/reminders_edit.png" height="130" />
</p>

### 🛒 Collaborative Shopping & Todo (`/shopping`, `/todo`)
*   **Live Sync:** Status toggles for real-time synchronization across the household.
*   **User Scoping:** Todo lists are private and segregated, while Shopping lists are shared family-wide.

<p align="center">
  <img src="public/images/screenshots/shopping_list.png" height="130" />
  <img src="public/images/screenshots/todo_list.png" height="130" />
</p>

### 📓 Collaborative Whiteboard & Sticky Notes (`/notes`)
*   **Infinite Canvas:** Create boards of sticky notes that can be panned, zoomed, searched, and organized visually.
*   **Shared Editing:** Prevents family members from overwriting each other while still showing who is working on what.
*   **Board Levels:** Split large boards into separate layers for planning, projects, lists, or private sections.
*   **Fast Navigation:** Use the minimap and jump search to move quickly across large boards.
*   **Rich Notes:** Supports checklists, images, file attachments, links between notes, tables, callouts, date tags, and embedded notes.
*   **Access Control:** Boards can be shared, private, or protected with a password.

<p align="center">
  <img src="public/images/screenshots/sticky_notes_canvas.png" height="130" />
  <img src="public/images/screenshots/sticky_notes_boards.png" height="130" />
  <img src="public/images/screenshots/sticky_notes_settings.png" height="130" />
  <img src="public/images/screenshots/sticky_notes_jump.png" height="130" />
  <img src="public/images/screenshots/sticky_notes_guide.png" height="130" />
</p>

---

## 💰 Financial & Behavioral Management

### 🏆 Gamification & Child Rewards (`/points`)
*   **Child-Centric Ledger:** Dedicated point tracking for children to manage earned rewards from chores and behavioral milestones.
*   **Transaction Audit:** Full historical visibility for both parents and children into all deposits and expenditures.
*   **Global Leaderboard:** Comparative balance tracking to encourage healthy household participation.

<p align="center">
  *Screenshots coming soon...*
</p>

### 🧾 Receipt Archiving & OCR Pipeline (`/receipts`)
*   **Receipt Capture:** Upload receipt photos to keep household spending records in one searchable place.
*   **Automatic Details:** The app helps read store names, dates, totals, and item details where possible.
*   **Review & Correction:** Edit scanned details at any time so the ledger stays accurate.

<p align="center">
  <img src="public/images/screenshots/receipt_ledger.png" height="130" />
  <img src="public/images/screenshots/receipt_detail.png" height="130" />
</p>

### ⛽ Fuel Usage Logger (`/fuel`)
*   **Quick Fuel Stop Logging:** Upload a photo of the odometer and a photo of the pump or receipt; the app works out which photo is which.
*   **Automatic Data Entry:** Reads the odometer, litres, price per litre, total cost, date, and station name where possible.
*   **Review Before Saving:** If a photo is blurry or something looks uncertain, the log opens for quick correction instead of saving bad information.
*   **Multiple Vehicles:** Track fuel use separately for each car in the household.
*   **Running Costs:** See weekly, monthly, and yearly fuel spend, monthly litres, average fuel price, L/100km, and cost per kilometre once enough fill-ups have been recorded.
*   **Photo History:** Keeps the original uploaded photos with each fuel log so entries can be checked later.

### 🤬 The Swear Jar Ledger (`/swear`)
*   **Family Accountability:** Tracks swear jar fines, payments, and spending in one shared ledger.
*   **Live Balances:** Shows who owes what after payments and jar expenses are recorded.
*   **Leaderboard View:** Keeps totals visible so everyone understands their current standing.
*   **Easy Updates:** Add fines, payments, and purchases as they happen.

<p align="center">
  *Screenshots coming soon...*
</p>

### 📁 Secure File Vault (`/admin/files`)
*   **Private File Storage:** Upload and organize important household files in a secure vault.
*   **Permission Control:** Choose whether files are admin-only or shared with specific users.
*   **Download Tracking:** See when files have been accessed or downloaded.

<p align="center">
  <img src="public/images/screenshots/file_manager.png" height="130" />
</p>

---

## 🎮 Entertainment & Social

### 🃏 UNO Multiplayer (`/uno/lobby`)
*   **Full State Machine:** Digital implementation of standard UNO rules (Skips, Reverses, Wild Draw 4).
*   **Real-time Interaction:** Automated turn tracking, hand synchronization, and "UNO!" shouting.
*   **Deck Logic:** Automatic reshuffling of the discard pile when the draw pile is exhausted.

### ♟️ Digital Chess (`/chess/lobby`)
*   **Saved Games:** Continue games across sessions without losing the board state.
*   **Advanced Features:** Move history, live turn updates, and draw negotiations.

### 🔴 Connect 4 (`/connect4/lobby`)
*   **Classic Gameplay:** Drop chips into the board and race to connect four.
*   **Automatic Win Detection:** The game detects horizontal, vertical, and diagonal wins.

### 🧊 Rubik's Cube Algorithm Library (`/rubiks`)
*   **Interactive Cube Diagram:** Visualize cube states from move sequences in real time.
*   **Family Algorithm Library:** Shared collection of algorithms (OLL, PLL, F2L, etc.) with per-entry ownership; anyone can add, only the creator can edit or delete.
*   **Diagram Export:** Download the current cube diagram for study or sharing.

### 🎭 Imposter & 🦘 Citizenship Test (`/imposter`, `/quiz`)
*   **Imposter:** Party game with customizable word-lists and player reveal mechanics.
*   **Citizenship Quiz:** Dual-mode study suite (Practice vs. 20-question Exam) with randomized question banks.

### 🎧 Audiobooks (`/audiobooks`)
*   **Automatic Library Discovery:** Add audiobook folders and the app makes them available in the library.
*   **Flexible Playback:** Supports books split by chapter as well as single-file audiobooks with chapters.
*   **Offline Download Support:** Download entire books, including cover art, for offline listening in the Android app.
*   **Cover Art:** Displays embedded or extracted artwork where available.
*   **Full-Screen Audible-Style Player:** Chapter drawer, seek bar, 30-second rewind/forward, 5-speed playback (0.75× – 2×), and a countdown sleep timer (15/30/45/60 min or end of chapter).
*   **Per-User Progress:** Each listener resumes exactly where they left off, even across devices.
*   **Offline-Friendly Progress:** Listening progress is saved during offline sessions and synced again when connection returns.
*   **Lock-Screen Controls:** Play, pause, and seek from supported phone controls.
*   **Screen Wake Lock:** Keeps the display awake while listening.
*   **Smooth Chapter Changes:** Prepares the next chapter near the end of the current one.
*   **Admin Metadata Editor:** Edit title, author, narrator, and description from the admin screen.

### 🏝 Specialized & Utility

### 🌦 Weather Dashboard (`/weather`)
*   **Multi-Location Tracking:** Real-time meteorological data for multiple global locations.
*   **Advanced Detail Engine:** 
    *   **Interpolated Forecasting:** Scrapes source data and interpolates it into granular 2-hour blocks with temperature trend graphing.
    *   **Deep Metrics:** High-fidelity tracking of UV Index, Humidity, Moon Phases, Wind Chill, and Visibility.
*   **Threshold Styling:** Dynamic color-coded alerts based on temperature and wind intensity for rapid visual auditing.

<p align="center">
  <img src="public/images/screenshots/weather_dashboard.png" height="130" />
  <img src="public/images/screenshots/weather_details.png" height="130" />
</p>

### ⏱ Household Timers (`/timers`)
*   **Limit Enforcement:** Weekday vs. Weekend daily minute limits per device category.
*   **Quiet Hours:** Automatic start-blocking during configured quiet periods (e.g., 9PM - 7AM).
*   **Bonus Time:** Administrative interface for granting extra time to specific user sessions.

<p align="center">
  <img src="public/images/screenshots/timer_management.png" height="130" />
</p>

### 🎂 Birthday Tracker (`/birthdays`)
*   **Upcoming Birthday Order:** Always shows the next birthdays first, even when the list crosses into a new year.

### 🔗 Go Links & 📋 Clipboard (`/go`, `/clipboard`)
*   **Go Links:** Internal URL shortener with visit analytics.
*   **Clipboard:** Cross-device pastebin with instant notifications for user `rendler`.

<p align="center">
  <img src="public/images/screenshots/go_links.png" height="130" />
  <img src="public/images/screenshots/clipboard.png" height="130" />
</p>

---

*Engineered for the modern digital home.*
