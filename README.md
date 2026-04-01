# X Following Parser

Browser extension (Chrome / Chromium, Manifest V3) that exports the **Following** list from [x.com](https://x.com) profiles: profile URLs, follower counts, following counts, and bios.

## What it does

1. Open any user profile on X while logged in.
2. Click **Start Parsing** in the extension popup.
3. The extension opens the Following list, scrolls through it, optionally runs a slow “hover” pass to fill missing data from the UI and captured GraphQL responses.
4. Results go to **Google Sheets** (via a Web App URL you deploy) and/or a downloaded **`.txt`** file (`url | followers | following | bio`).

## Install (developer mode)

1. Clone or download this folder.
2. In Chrome: **Extensions** → **Developer mode** → **Load unpacked** → select the extension directory (the one containing `manifest.json`).

## Configuration

In the popup:

- **Google Sheets Web App URL** — URL of a Google Apps Script web app that accepts POSTed rows (see `google-script/google-apps-script.gs`).
- **Sheet Name** — tab name in the spreadsheet (must match exactly).
- **Spreadsheet ID** — from the sheet URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.
- **Fields to parse** (collapsible at the bottom) — toggles for **URL Profile**, **Follow**, **Following**, and **Bio**. Unchecked fields stay empty in export and are skipped during enrichment to save time.

Other options control the optional hover pass and delays (higher delays reduce the chance of rate limits).

## Google Sheets backend

Deploy the script in `google-script/google-apps-script.gs` as a Web App (execute as you, accessible to anyone with the link, or as required for your setup). Point the extension at the deployed `/exec` URL.

## Permissions

- **x.com** — content scripts and parsing.
- **Broad `https://*/*`** — used to POST export data to your Google Web App URL.

## Disclaimer

This tool automates reading information you can already see in the browser. Use it responsibly and in line with X’s terms and applicable laws. The authors are not responsible for misuse or account restrictions.

## License

Use and modify at your own risk; no warranty is implied.
