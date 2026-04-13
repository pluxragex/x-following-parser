# X Following Parser
> A Chrome extension for exporting the **Following** list from [x.com](https://x.com) profiles to Google Sheets and/or `.txt`.  
> The project is under active development.

## What's unique?
The extension combines data collection from the X interface with GraphQL response interception for more complete results: `profileUrl`, `followers`, `following`, `bio`.  
There is a slow hover-enrich mode that synthetically hovers over user cards and fills in `N/A` values if they were not captured during regular scrolling.

## What technologies are used?
> [!WARNING]
> Below are the key technologies and infrastructure dependencies of the project.

### Browser extension (`root`)
* **JavaScript (Vanilla)**
* **Chrome Extensions Manifest V3**
* **Content Scripts + Service Worker**
* **Chrome Storage API**
* **Chrome Downloads API**
* **Fetch API**
* **DOM parsing + synthetic pointer events**

### Google Sheets backend (`google-script`)
* **Google Apps Script**
* **SpreadsheetApp**
* **Web App (`doPost`)**

## Why this architecture?
Separation into `popup` + `content script` + `background` isolates the UI, page parsing logic, and export/browser system operations.  
`page-hook.js` runs in the `MAIN` world and helps collect GraphQL data, while `background.js` centralizes Google Apps Script submission and `.txt` download handling, reducing coupling between layers.

## How can I run it locally?

### 1) Clone repository
```bash
git clone <YOUR_REPOSITORY_URL>
cd x-parser
```

### 2) Prepare Google Sheets script (optional, for sheet export)
1. Open `google-script/google-apps-script.gs`.
2. Create a new Google Apps Script project and paste the code.
3. Deploy it as a Web App and get a URL ending with `/exec`.

### 3) Install extension in Chrome
```text
Chrome -> Extensions -> Developer mode -> Load unpacked -> choose project folder
```

### 4) Configure extension popup
Fill in if needed:
- `Google Sheets Web App URL`
- `Sheet Name`
- `Spreadsheet ID` (from `https://docs.google.com/spreadsheets/d/<ID>/edit`)

Also choose where to save results:
- `Send results to Google Sheets`
- `Also save as .txt file`

### 5) Start parsing
1. Open a user profile on `x.com` (in an authenticated session).
2. Click `Start Parsing` in the extension popup.
3. Wait for the export to finish.

## Available functionality

### Parsing and collection
* Automatic opening of the profile `Following` list
* Auto-scroll to the end of the list with progress tracking
* Extraction of `URL Profile`, `Followers`, `Following`, `Bio`
* Noise filtering and string normalization
* Merging data from DOM and GraphQL

### Data enrichment
* Optional `hoverEnrich` pass for filling missing values
* Configurable delays: `hoverBetweenMs` and `hoverWaitMs`
* Backfilling `followers/following/bio` from hover cards
* Support for multilingual counter patterns

### Export and persistence
* Export to Google Sheets via Apps Script webhook
* Export to a local `.txt` file (`url | followers | following | bio`)
* Flexible field selection (URL/Follow/Following/Bio)
* Saving settings and job state via `chrome.storage.local`

### UX and observability
* Live status updates in the popup during execution
* Parsing state synchronization between tab and popup
* Badge/Title activity indication for the extension
* Input validation and detailed export error messages

## Project structure
```text
manifest.json                    # Extension configuration (MV3)
popup.html                       # Popup UI
popup.js                         # Popup logic and settings persistence
content.js                       # Main Following parser + enrich pipeline
page-hook.js                     # GraphQL interception in MAIN world
background.js                    # Sheets/.txt export and job status handling
google-script/google-apps-script.gs  # Google Sheets Web App endpoint
```

## Permissions
* `https://x.com/*` - profile and Following list parsing
* `https://*/*` - sending data to your Google Apps Script Web App URL
* `tabs`, `scripting`, `downloads`, `storage` - extension operation (tabs, injection, file download, settings)

## Notes
> [!NOTE]
> The tool automates collecting data that is already visible in the browser.  
> Use it responsibly and in compliance with X rules and applicable laws.  
> For correct Google Sheets export, prepare the Apps Script Web App and access to the target spreadsheet in advance.
