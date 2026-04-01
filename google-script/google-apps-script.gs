function doPost(e) {
  try {
    var data = parsePostPayload(e);
    const sheetName = data.sheetName || "Sheet1";
    const rows = Array.isArray(data.rows) ? data.rows : [];

    if (!data.spreadsheetId) {
      return jsonOut({
        ok: false,
        error: "Missing spreadsheetId. Paste Spreadsheet ID into the extension (from URL .../spreadsheets/d/ID/edit)."
      });
    }

    var ss = SpreadsheetApp.openById(String(data.spreadsheetId));

    var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["profileUrl", "followers", "following", "bio"]);
    }

    rows.forEach(function (r) {
      sheet.appendRow([
        r.profileUrl || "",
        r.followers || "",
        r.following || "",
        r.bio || ""
      ]);
    });

    var lastRowPreview = null;
    if (rows.length > 0) {
      var lr = sheet.getLastRow();
      lastRowPreview = sheet.getRange(lr, 1, lr, 4).getValues()[0];
    }

    return jsonOut({
      ok: true,
      inserted: rows.length,
      spreadsheetIdEcho: String(data.spreadsheetId),
      spreadsheetUrl: ss.getUrl(),
      sheetTab: sheet.getName(),
      lastRowNumber: sheet.getLastRow(),
      lastRowPreview: lastRowPreview
    });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

function parsePostPayload(e) {
  if (e.parameter && e.parameter.payload) {
    return JSON.parse(String(e.parameter.payload));
  }
  var raw = (e.postData && e.postData.contents) ? String(e.postData.contents).trim() : "";
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("postData is not JSON (did you forget e.parameter.payload?). First chars: " + raw.slice(0, 80));
  }
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
