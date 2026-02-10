# Venice Local

![Venice Local logo](assets/Copy%20of%20Venice%20Local.png)

Venice Local is our **2025-2026 FBLA Coding & Programming** project. It helps people discover and support small businesses in Downtown Venice, Florida.

---

## Project Overview

### Problem We Solved
Small local businesses are easy to miss online, and people do not always have one simple place to browse real local options, check reviews, and find active deals.

### Our Solution
Venice Local combines local business discovery, ratings/reviews, favorites, owner tools, and report analytics in one user-friendly app powered by Supabase.

---

## Feature Highlights

### Core Features
- **Business Directory** with category, address, hours, descriptions, photos, ratings, and deals
- **Search + Filter + Sort** (highest rating, most reviewed, alphabetical)
- **Reviews & Ratings** (1-5 stars, comment, optional photo)
- **Favorites** save/remove system
- **Deals** with active/inactive status

### Owner Features
- **Role-based access** (guest/customer/owner)
- **Owner Dashboard** stats (business count, review count, avg rating, active deals)
- **Business management** (add/edit/toggle active)

### Unique / Intelligent Features
- **Reports page** with app-wide analytics
- **CSV export** for report output
- **Deal format compatibility parsing** (legacy + structured)
- **Image handling strategy** (upload URLs + signed storage paths)
- **Cloudflare Turnstile** bot check on auth

---

## Rubric Alignment Snapshot

| Rubric Area | How Venice Local Addresses It |
|---|---|
| Program functionality | Full flow: auth, browse, review, favorite, owner management |
| Data handling | Supabase-backed businesses, profiles, reviews, favorites, deals, photos |
| Report output / analysis | Reports page + category table + top lists + CSV export |
| Validation / error handling | Required fields, role checks, duplicate-submit guards, RLS-aware feedback |
| UX / navigation | Clear nav, role-specific views, modal details, empty states |
| Code quality | Modular helpers in `modules/` + comments |
| Accessibility | Labeled controls, readable structure, alt/fallback images |

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (ES Modules) |
| Backend/Data | Supabase (Auth, Postgres, Storage, REST) |
| Security Check | Cloudflare Turnstile |
| Maps | Google Maps Embed |
| Local Server | Python `http.server` |

---

### Language Selection Process

We selected **HTML, CSS, and JavaScript (ES Modules)** as our primary implementation languages after evaluating platform fit, maintainability, and deployment constraints for a browser-based product.

- **HTML** was chosen as the semantic document layer because it provides accessible, standards-based structure for forms, navigation, and content hierarchy.
- **CSS** was chosen for presentation and responsive layout so we could separate styling concerns from application logic and maintain a consistent UI system.
- **JavaScript (ES Modules)** was chosen for client-side application logic because it supports modular architecture (`modules/`), event-driven UI updates, and direct integration with REST-style backend services (Supabase APIs).
- We intentionally used a **frontend-first architecture** (no custom server runtime) to reduce hosting complexity, improve portability across devices, and simplify local execution for judging and demonstration.
- **Backend (Supabase/PostgreSQL)** was chosen as a managed **Backend-as-a-Service (BaaS)** to provide authentication, relational data storage, and file storage through REST-style APIs, reducing custom server infrastructure while improving scalability, security, and deployment reliability.
- This stack aligns with current industry practice for lightweight web applications: **standards-compliant markup**, **componentized styling**, and **modular scripting** with external managed backend services.

---

## How to Open and Run

### Prerequisites
- Python 3.x installed
- Modern browser (Chrome, Edge, Safari, or Firefox)
- Internet connection (needed for Supabase, Turnstile, and Maps)

### Method #1 (Recommended)
1. Open this GitHub repo:
```text
https://github.com/koreenahickey-cmd/Venice-Local.git
```
2. Click the green **Code** button, then either **Download ZIP** or copy the HTTPS URL.
3. Open the folder in your IDE.
4. Paste the following into the terminal based on your operating system to start a local server:

- **macOS / Linux (Terminal):**
```bash
python3 -m http.server 4173
```

- **Windows PowerShell:**
```bash
py -m http.server 4173
```

- **Windows CMD (Command Prompt):**
```bash
python -m http.server 4173
```

5. Keep that terminal open.
6. Open this in your browser:
```text
http://localhost:4173/
```
7. The app should load to the auth screen.

### Method #2 (package script)
1. Open terminal in project root.
2. Run:
```bash
npm run start --prefix "json files"
```
3. Open:
```text
http://localhost:4173/
```

### Quick Troubleshooting
- If port `4173` is busy, stop other local servers and rerun.
- If page opens but data is empty, check internet and refresh once.
- If sign in says bot check incomplete, finish the Turnstile box and retry.

---

## Default Accounts
- **Business owner**: `businessowner@gmail.com` / `FBLA2025`
- **Reviewer**: `reviewer@gmail.com` / `FBLA2025`

---

## How to Use
1. Sign in, create an account, or continue as guest.
2. Browse All Businesses, then search/filter/sort.
3. Open Details to view photos, map, deals, and reviews.
4. Save favorites and write reviews (non-guest accounts).
5. If owner, add/edit your business and manage deals.
6. Open Reports to view analytics and export CSV.

---

## Reports and Data Analysis
The Reports section includes:
- Total businesses
- Active businesses
- Total reviews
- Average rating
- Active deal count
- Category breakdown table
- Top 5 highest rated businesses
- Top 5 most reviewed businesses
- CSV export for report output

---

## Accessibility Notes
- Labeled form controls and readable heading structure
- Keyboard-friendly interactions for main workflows
- Alt text and fallback images for avatars/business photos
- Visible feedback states for errors and success messaging

---

## Validation and Reliability
- Required fields enforced for business creation and reviews
- Review constraints (single photo source, valid rating range)
- Role checks prevent guest-only restricted actions
- Supabase policy-aware error feedback for blocked operations
- Duplicate-submit guards on review and business forms

---

## Project Structure (Key Files)
```text
Venice-Local/
- index.html
- styles.css
- renderer.js
- supabaseClient.js
- modules/
  - deals.js
  - reports.js
  - uiUtils.js
- assets/
  - vendor/supabase.js
  - images and branding assets
- service-worker.js
- json files/
  - manifest.json
  - package.json
  - package-lock.json
```

---

## Documentation of Resources
- Supabase: authentication, database, and storage backend
- Cloudflare Turnstile: bot/human verification on auth forms
- Google Maps Embed: location visualization in business detail view
- TripAdvisor + Yelp: source references for business details
- DaFont (Font Diner / Copasetic): typography resource attribution

---

## Image Credits

Business images displayed in this application are the property of their
respective businesses and were sourced from publicly available images on Google
for educational and demonstration purposes only.

Sources include:
• Google Search (public business listings)
• Google Maps (public business listings)

No ownership is claimed over these images.

---

## Developers
- Koreena Hickey
- Emma Nguyen

---

## License
This project is submitted for FBLA Coding & Programming. See `LICENSE` for repository license details.

---

## Contact
For questions: **emmanguyen0915@gmail.com**
