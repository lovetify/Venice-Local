# Venice Local

![Venice Local logo](assets/Venice%20Local%20Logo.png)

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
- **Things to Do in Venice** with upcoming/past event filtering, featured events, detail views, and event links

### Owner Features
- **Role-based access** (guest/customer/owner)
- **Owner Dashboard** stats (business count, review count, avg rating, active deals)
- **Business management** (add/edit/toggle active)
- **Event management** (publish and maintain the owner's own community events)

### Event Setup (Supabase)

The public events feed and owner event manager use the additive migration at
[`supabase/migrations/20260810_add_events.sql`](supabase/migrations/20260810_add_events.sql).

1. In the Supabase dashboard, confirm the app's base schema is already installed and includes `public.profiles`.
2. Open **Storage** and confirm there is a **public** bucket named exactly `business-media`. The app uses public image URLs from this bucket.
3. Open **SQL Editor**, paste the complete contents of `supabase/migrations/20260810_add_events.sql`, and click **Run**. If an earlier admin-only version was already run, run the updated file again to replace its event and Storage policies.
4. Create or sign in to an account whose `public.profiles.role` is `owner`. Choosing **Business Owner** during app signup creates that profile role.

The migration grants guests read access only to published events. Signed-in owners can create events and read, edit, or delete their own events, including unpublished drafts. They cannot change another owner's event. Event-image uploads are limited to `business-media/events/<signed-in-user-id>/` for owners.

A trusted site administrator is optional. The signup form intentionally does not offer this role. To enable it, copy the user's UUID from **Authentication > Users**, then run this directly in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin'
where id = '<AUTH-USER-UUID>';
```

Administrators can manage all event rows and all objects below `business-media/events/`.

### How Business Owners Add Events

1. Sign in with a **Business Owner** account.
2. Choose **Manage Events** in the main navigation.
3. Complete the event name, category, start time, location, and description. The end time, organizer, price, information link, and image are optional.
4. Leave **Publish this event** checked to show it in **Things to Do**, or clear it to save an owner-only draft, then choose **Save Event**.
5. Use **My Events** on the same page to edit or delete an event. Owners see only their own managed events; a trusted administrator sees all events.

New future-dated, published events appear under **Things to Do** with the default **Upcoming** filter. Use **All dates** or **Past events** when checking an older event.

The migration intentionally inserts **no seed or demo events**, so an empty Things to Do page immediately after setup is expected. The first listing appears after an owner saves a published event. It creates only the event schema, indexes, event-specific RLS policies, role-check helpers, and timestamp trigger; existing businesses, reviews, favorites, profiles, and Storage objects are not changed.

### Unique / Intelligent Features
- **Reports page** with app-wide analytics
- **CSV export** for report output
- **Deal format compatibility parsing** (legacy + structured)
- **Image handling strategy** (upload URLs + signed storage paths)
- **Cloudflare Turnstile** bot check on auth
- **AI chatbot (Tidio Lyro)** trained on curated project knowledge to assist users with navigation

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
| Chatbot | Tidio (Lyro AI Agent) |


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
5. If you are an owner, add/edit your business and manage deals.
6. Open **Manage Events** to publish or update your community events.
7. Open **Things to Do** to browse published upcoming and past events.

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

## Logo Credits

The Venice Local logo was created by Emma Nguyen.

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
