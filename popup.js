const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const sheetWebhookUrlEl = document.getElementById("sheetWebhookUrl");
const sheetNameEl = document.getElementById("sheetName");
const saveToSheetEl = document.getElementById("saveToSheet");
const saveToTxtEl = document.getElementById("saveToTxt");
const spreadsheetIdEl = document.getElementById("spreadsheetId");
const hoverEnrichEl = document.getElementById("hoverEnrich");
const hoverBetweenMsEl = document.getElementById("hoverBetweenMs");
const hoverWaitMsEl = document.getElementById("hoverWaitMs");
const parseUrlProfileEl = document.getElementById("parseUrlProfile");
const parseFollowEl = document.getElementById("parseFollow");
const parseFollowingEl = document.getElementById("parseFollowing");
const parseBioEl = document.getElementById("parseBio");
let activeTabId = null;
let isRunning = false;

const DEFAULT_SETTINGS = {
  sheetWebhookUrl: "",
  sheetName: "Sheet1",
  spreadsheetId: "",
  saveToSheet: true,
  saveToTxt: true,
  hoverEnrich: true,
  hoverBetweenMs: 2200,
  hoverWaitMs: 1300,
  parseUrlProfile: true,
  parseFollow: true,
  parseFollowing: true,
  parseBio: true
};

function setStatus(message) {
  statusEl.textContent = message;
}

function setRunningState(running) {
  isRunning = running;
  startBtn.disabled = running;
}

function ensureXTab(tab) {
  if (!tab || !tab.url || !/^https:\/\/x\.com\//i.test(tab.url)) {
    throw new Error("Open x.com in active tab first.");
  }
}

async function sendMessageToTab(tabId, payload) {
  return chrome.tabs.sendMessage(tabId, payload);
}

function collectSettingsFromForm() {
  return {
    sheetWebhookUrl: sheetWebhookUrlEl.value.trim(),
    sheetName: sheetNameEl.value.trim() || "Sheet1",
    spreadsheetId: spreadsheetIdEl.value.trim(),
    saveToSheet: Boolean(saveToSheetEl.checked),
    saveToTxt: Boolean(saveToTxtEl.checked),
    hoverEnrich: Boolean(hoverEnrichEl.checked),
    hoverBetweenMs: Math.max(600, parseInt(String(hoverBetweenMsEl.value || "2200"), 10) || 2200),
    hoverWaitMs: Math.max(350, parseInt(String(hoverWaitMsEl.value || "1300"), 10) || 1300),
    parseUrlProfile: Boolean(parseUrlProfileEl.checked),
    parseFollow: Boolean(parseFollowEl.checked),
    parseFollowing: Boolean(parseFollowingEl.checked),
    parseBio: Boolean(parseBioEl.checked)
  };
}

async function loadSettings() {
  const stored = await chrome.storage.local.get("xParserSettings");
  const settings = {
    ...DEFAULT_SETTINGS,
    ...(stored.xParserSettings || {})
  };
  sheetWebhookUrlEl.value = settings.sheetWebhookUrl;
  sheetNameEl.value = settings.sheetName;
  spreadsheetIdEl.value = settings.spreadsheetId || "";
  saveToSheetEl.checked = settings.saveToSheet;
  saveToTxtEl.checked = settings.saveToTxt;
  hoverEnrichEl.checked = settings.hoverEnrich !== false;
  hoverBetweenMsEl.value = String(Math.max(600, Number(settings.hoverBetweenMs) || DEFAULT_SETTINGS.hoverBetweenMs));
  hoverWaitMsEl.value = String(Math.max(350, Number(settings.hoverWaitMs) || DEFAULT_SETTINGS.hoverWaitMs));
  parseUrlProfileEl.checked = settings.parseUrlProfile !== false;
  parseFollowEl.checked = settings.parseFollow !== false;
  parseFollowingEl.checked = settings.parseFollowing !== false;
  parseBioEl.checked = settings.parseBio !== false;
}

async function saveSettings() {
  const settings = collectSettingsFromForm();
  await chrome.storage.local.set({ xParserSettings: settings });
  setStatus("Settings saved");
}

startBtn.addEventListener("click", async () => {
  if (isRunning) return;

  try {
    setRunningState(true);
    setStatus("Checking active tab...");

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    ensureXTab(tab);
    activeTabId = tab.id;

    setStatus("Starting parser...");
    const settings = collectSettingsFromForm();

    if (settings.saveToSheet) {
      if (!settings.sheetWebhookUrl) {
        throw new Error("Fill in Google Sheets Web App URL or disable 'Send results to Google Sheets'.");
      }
      if (!settings.spreadsheetId) {
        throw new Error("Fill in Spreadsheet ID (from the sheet URL) or disable Google Sheets export.");
      }
    }

    const startResp = await sendMessageToTab(activeTabId, { type: "START_PARSING", settings });
    if (!startResp || !startResp.ok) {
      throw new Error(startResp?.error || "Failed to start parsing.");
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    setRunningState(false);
  }
});

saveSettingsBtn.addEventListener("click", async () => {
  try {
    await saveSettings();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.scope !== "x-following-parser-popup") return;

  if (typeof message.text === "string") {
    setStatus(message.text);
  }

  if (message.done) {
    setRunningState(false);
  }
});

async function loadJobStateForPopup() {
  const { parserJobState } = await chrome.storage.local.get("parserJobState");
  if (parserJobState && parserJobState.running) {
    setRunningState(true);
    setStatus(parserJobState.text || "Running…");
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.parserJobState) return;
  const job = changes.parserJobState.newValue;
  if (!job) return;
  setStatus(job.text || "");
  setRunningState(Boolean(job.running));
});

loadSettings()
  .then(() => loadJobStateForPopup())
  .catch((err) => {
    setStatus(`Error: ${err.message}`);
  });
