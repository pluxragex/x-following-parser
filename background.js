function notifyParserJob(text, done, tabId) {
  const state = {
    running: !done,
    text: String(text || ""),
    done: Boolean(done),
    updatedAt: Date.now(),
    tabId: tabId ?? null
  };
  chrome.storage.local.set({ parserJobState: state });

  if (!done) {
    chrome.action.setBadgeText({ text: "…" });
    chrome.action.setBadgeBackgroundColor({ color: "#1d9bf0" });
    chrome.action.setTitle({
      title: `X Parser (running): ${state.text.slice(0, 120)}`
    });
  } else {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: "X Following Parser" });
  }

  chrome.runtime
    .sendMessage({
      scope: "x-following-parser-popup",
      text: state.text,
      done: state.done
    })
    .catch(() => {});
}

async function postToGoogleAppsScript(webhookUrl, payload) {
  const jsonBody = JSON.stringify(payload);

  const tryJson = async () => {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: jsonBody,
      redirect: "follow"
    });
    const text = await resp.text().catch(() => "");
    return { resp, text };
  };

  const tryForm = async () => {
    const params = new URLSearchParams();
    params.set("payload", jsonBody);
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
      redirect: "follow"
    });
    const text = await resp.text().catch(() => "");
    return { resp, text };
  };

  let lastError = null;

  for (const attempt of [tryJson, tryForm]) {
    try {
      const { resp, text } = await attempt();

      if (resp.status === 0) {
        lastError = new Error(
          "HTTP status 0 (request blocked or opaque redirect). Check Web App URL and redeploy the script."
        );
        continue;
      }

      if (!resp.ok) {
        lastError = new Error(`Sheet webhook HTTP ${resp.status}: ${(text || "").slice(0, 300)}`);
        continue;
      }

      return { responseText: text };
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("Failed to reach Google Apps Script.");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PARSER_STATUS") {
    notifyParserJob(message.text, message.done, sender.tab?.id);
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "PUSH_TO_SHEET") {
    (async () => {
      try {
        const webhookUrl = String(message.webhookUrl || "").trim();
        const sheetName = String(message.sheetName || "Sheet1").trim();
        const spreadsheetId = String(message.spreadsheetId || "").trim();
        const rows = Array.isArray(message.rows) ? message.rows : [];
        const expectedRowCount =
          typeof message.expectedRowCount === "number" ? message.expectedRowCount : null;

        if (!webhookUrl) {
          throw new Error("Webhook URL is empty.");
        }

        if (!spreadsheetId) {
          throw new Error(
            "Spreadsheet ID is empty. Paste it in extension settings (from the Google Sheet URL: .../d/THIS_ID/edit)."
          );
        }

        if (expectedRowCount !== null && expectedRowCount !== rows.length) {
          throw new Error(
            `Row count mismatch (extension bug or message truncation): got ${rows.length} rows, expected ${expectedRowCount}. Try reloading the extension.`
          );
        }

        const payload = {
          source: "x-following-parser",
          sheetName,
          spreadsheetId,
          rows: rows.map((r) => ({
            profileUrl: r.profileUrl || r.url || "",
            followers: r.followers || "Followers: N/A",
            following: r.following || "Following: N/A",
            bio: r.bio || "No bio"
          }))
        };

        const { responseText } = await postToGoogleAppsScript(webhookUrl, payload);

        let parsed = null;
        try {
          const trimmed = (responseText || "").trim();
          const jsonStart = trimmed.indexOf("{");
          const jsonSlice = jsonStart >= 0 ? trimmed.slice(jsonStart) : trimmed;
          parsed = jsonSlice ? JSON.parse(jsonSlice) : null;
        } catch (parseErr) {
          throw new Error(
            `Apps Script did not return valid JSON. Check Web App deployment and script. First 400 chars: ${(responseText || "").slice(0, 400)}`
          );
        }

        if (!parsed || typeof parsed !== "object") {
          throw new Error("Apps Script returned empty or invalid JSON object.");
        }

        if (parsed.ok === false) {
          throw new Error(parsed.error || "Google Apps Script returned ok:false");
        }

        if (parsed.ok !== true) {
          throw new Error(
            `Unexpected Apps Script response (missing ok:true). Raw: ${(responseText || "").slice(0, 300)}`
          );
        }

        if (typeof parsed.inserted !== "number") {
          throw new Error(
            "Apps Script must return JSON like { ok: true, inserted: N }. Update google-apps-script-sample.gs"
          );
        }

        if (parsed.inserted !== rows.length) {
          throw new Error(
            `Sheet script reported inserted=${parsed.inserted} but extension sent ${rows.length} row(s). ` +
              "Your doPost() is probably not reading the body (use parsePostPayload / e.parameter.payload) or writes to another file. " +
              `Set Spreadsheet ID in extension and use SpreadsheetApp.openById in the script. Raw: ${(responseText || "").slice(0, 200)}`
          );
        }

        sendResponse({
          ok: true,
          sheetResponse: parsed,
          sentRowCount: rows.length,
          raw: (responseText || "").slice(0, 500)
        });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (!message || message.type !== "DOWNLOAD_TXT") return;

  try {
    const txt = message.payload || "";
    const filename = message.filename || `x_following_${Date.now()}.txt`;
    const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(txt)}`;

    chrome.downloads.download(
      {
        url: dataUrl,
        filename,
        saveAs: true
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
  } catch (err) {
    sendResponse({ ok: false, error: err.message });
  }

  return true;
});
