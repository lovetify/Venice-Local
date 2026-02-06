# Venice Local

![Venice Local logo](assets/Copy%20of%20Venice%20Local.png)

Welcome to Venice Local! This is our 2025-2026 FBLA Coding & Programming Project. Venice Local is a desktop application designed to help users discover and support small, local businesses in Venice, Florida.

Local business owners can add their businesses to the app, and community members can browse listings, leave reviews, and save their favorite places. If a business is offering a special deal or promotion, it will be displayed on the business's listing. The app uses a backend created with Supabase to securely store business listings, reviews, and user data so information is saved and updated in real time. The goal of this project is to strengthen the local community by making it easier for people to find and support nearby businesses. All business entries represent real small local businesses in Downtown Venice, FL, and details (hours, descriptions, addresses, photos, etc.) were gathered from TripAdvisor and Yelp.

---

## Key Features
- Search and filter businesses by name and category, with sorting by rating, review count, or name.
- Detailed profiles with hours, description, address, category, special deals, and live average ratings.
- Reviews: leave 1-5 star ratings with comments and optional photos; see community feedback in real time.
- Favorites: save and manage a personal list of favorite businesses for quick access.
- Deals: highlight active specials and show deal counts for business owners.
- Roles: guest browsing, customer reviews/favorites, and business owner tools to add or edit listings.

---

## Get the Project
- GitHub: https://github.com/koreenahickey-cmd/Venice-Local.git (Code -> Download ZIP) or `git clone (https://github.com/koreenahickey-cmd/Venice-Local.git)`

## Open and Run (browser)
1) Download or clone the repo, then open Terminal or PowerShell in the project folder.  
2) Launch a static server: `python3 -m http.server 4173` (or `py -m http.server 4173` on Windows).  
3) Open `http://localhost:4173/` in your browser. That’s it—no build step or install required.

---

## Project Structure (key files)
```
Venice-Local/
- assets/                 # images and static assets
- dist/                   # packaged builds (created by npm run dist)
- index.html              # main app HTML
- main.js                 # Electron main process
- renderer.js             # renderer process logic
- preload.js              # context bridge configuration
- supabaseClient.js       # Supabase client setup
- styles.css              # global styles
- service-worker.js       # PWA/offline support
- manifest.json           # app metadata
- package.json            # scripts and dependencies
- package-lock.json       # lockfile
```

---

## Directions to Use
To use Venice Local, launch the application and browse through local businesses listed in Venice, FL. Users can explore businesses by category, view details, leave reviews, and bookmark their favorite businesses for easy access later. Business owners can also submit their own businesses to be featured in the app.

---

## Developers
Koreena Hickey  
Emma Nguyen  

---

## Default Accounts
- Business owner - email: `businessowner@gmail.com`, password: `FBLA2025`  
- Reviewer - email: `reviewer@gmail.com`, password: `FBLA2025`

---

## Software & Languages Used
Visual Studio Code  
GitHub  
Adobe Photoshop  
Supabase  
JavaScript  
HTML  
CSS  

---

## Credits
App logo created by Emma Nguyen.  
Typography: Copasetic font by Font Diner (sourced from DaFont).

---

## Contact
For any questions please email emmanguyen0915@gmail.com!
