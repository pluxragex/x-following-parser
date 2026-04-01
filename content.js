const EXT_STATE = {
  running: false,
  expectedFollowingTotal: null,
  settings: {
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
  }
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeForExportLine(value) {
  if (value == null || value === undefined) return "";
  return String(value)
    .replace(/\u00a0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "｜")
    .trim();
}

const graphFollowersByScreenName = new Map();
const graphFollowingByScreenName = new Map();
const graphBioByScreenName = new Map();
const PAGE_HOOK_SOURCE = "x-following-parser-hook";

function parseFollowersCountScalar(raw) {
  if (raw == null) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.round(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function harvestFollowerCounts(obj, outMap, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 80) return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestFollowerCounts(item, outMap, depth + 1);
    return;
  }

  const legacy = obj.legacy;
  const fcLegacy = legacy && parseFollowersCountScalar(legacy.followers_count);
  if (fcLegacy != null && legacy.screen_name) {
    outMap.set(String(legacy.screen_name).toLowerCase(), fcLegacy);
  }

  const fcTop = parseFollowersCountScalar(obj.followers_count);
  if (fcTop != null && obj.screen_name) {
    outMap.set(String(obj.screen_name).toLowerCase(), fcTop);
  }

  const pm = obj.public_metrics;
  const fcPm = pm && parseFollowersCountScalar(pm.followers_count);
  if (fcPm != null) {
    const sn =
      obj.username ||
      obj.screen_name ||
      (legacy && legacy.screen_name) ||
      (obj.core && obj.core.screen_name);
    if (sn) outMap.set(String(sn).toLowerCase(), fcPm);
  }

  const core = obj.core;
  const fcCore = parseFollowersCountScalar(obj.followers_count);
  if (core && core.screen_name && fcCore != null) {
    outMap.set(String(core.screen_name).toLowerCase(), fcCore);
  }

  if (core && core.screen_name && legacy == null) {
    const stats = obj.counts || obj.stats;
    const fcAlt =
      stats && parseFollowersCountScalar(stats.followers_count || stats.followers);
    if (fcAlt != null) {
      outMap.set(String(core.screen_name).toLowerCase(), fcAlt);
    }
  }

  const typename = obj.__typename;
  if (
    typename === "User" &&
    fcTop != null &&
    (core?.screen_name || legacy?.screen_name || obj.screen_name)
  ) {
    const sn = String(
      (core && core.screen_name) ||
        (legacy && legacy.screen_name) ||
        obj.screen_name ||
        ""
    ).toLowerCase();
    if (sn) outMap.set(sn, fcTop);
  }

  for (const k of Object.keys(obj)) {
    harvestFollowerCounts(obj[k], outMap, depth + 1);
  }
}

function harvestFollowingCounts(obj, outMap, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 80) return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestFollowingCounts(item, outMap, depth + 1);
    return;
  }

  const legacy = obj.legacy;
  if (legacy && typeof legacy.screen_name === "string") {
    const sn = String(legacy.screen_name).toLowerCase();
    const n =
      parseFollowersCountScalar(legacy.following_count) ??
      parseFollowersCountScalar(legacy.friends_count);
    if (n != null) outMap.set(sn, n);
  }

  const core = obj.core;
  if (core && typeof core.screen_name === "string") {
    const sn = String(core.screen_name).toLowerCase();
    const stats = obj.counts || obj.stats;
    const n = stats && parseFollowersCountScalar(stats.following_count ?? stats.following);
    if (n != null) outMap.set(sn, n);
  }

  const pm = obj.public_metrics;
  const fc = pm && parseFollowersCountScalar(pm.following_count);
  if (fc != null) {
    const sn =
      obj.username ||
      (legacy && legacy.screen_name) ||
      (core && core.screen_name);
    if (sn) outMap.set(String(sn).toLowerCase(), fc);
  }

  for (const k of Object.keys(obj)) {
    harvestFollowingCounts(obj[k], outMap, depth + 1);
  }
}

function harvestUserBios(obj, outMap, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 80) return;
  if (Array.isArray(obj)) {
    for (const item of obj) harvestUserBios(item, outMap, depth + 1);
    return;
  }

  const legacy = obj.legacy;
  if (legacy && typeof legacy.screen_name === "string") {
    const sn = String(legacy.screen_name).toLowerCase();
    if (typeof legacy.description === "string") {
      const d = legacy.description.trim();
      if (d && !isIdentityNotBio(d, sn)) outMap.set(sn, d);
    }
  }

  const core = obj.core;
  const snCore =
    core && typeof core.screen_name === "string"
      ? String(core.screen_name).toLowerCase()
      : null;
  if (snCore) {
    const pb = obj.profile_bio;
    if (pb && typeof pb.description === "string") {
      const d = pb.description.trim();
      if (d && !isIdentityNotBio(d, snCore)) outMap.set(snCore, d);
    } else if (legacy && typeof legacy.description === "string") {
      const d = legacy.description.trim();
      if (d && !isIdentityNotBio(d, snCore)) outMap.set(snCore, d);
    }
  }

  if (obj.__typename === "User" && typeof obj.description === "string") {
    const sn =
      (legacy && legacy.screen_name) ||
      (core && core.screen_name) ||
      obj.screen_name ||
      obj.username;
    if (typeof sn === "string") {
      const d = obj.description.trim();
      const snk = String(sn).toLowerCase();
      if (d && !isIdentityNotBio(d, snk)) outMap.set(snk, d);
    }
  }

  for (const k of Object.keys(obj)) {
    harvestUserBios(obj[k], outMap, depth + 1);
  }
}

function formatFollowersFromCount(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "Followers: N/A";
  return `${Math.round(n).toLocaleString("en-US")} Followers`;
}

function formatFollowingCountLine(n) {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "Following: N/A";
  return `${Math.round(n).toLocaleString("en-US")} Following`;
}

function handleFromProfileHref(href) {
  const p = String(href || "").split("?")[0].replace(/\/+$/, "");
  const m = p.match(/\/([A-Za-z0-9_]{1,30})$/);
  return m ? m[1].toLowerCase() : null;
}

function handleFromProfilePageUrl(pageUrl) {
  try {
    return handleFromProfileHref(new URL(pageUrl).pathname || "");
  } catch {
    return null;
  }
}

function isBioPlaceholder(value) {
  const s = String(value || "").trim();
  return !s || /^no bio$/i.test(s);
}

function isIdentityNotBio(text, handle) {
  const t = String(text || "")
    .trim()
    .replace(/\s+/g, " ");
  const h = String(handle || "").toLowerCase();
  if (!t || !h) return false;
  if (/^no bio$/i.test(t)) return true;
  if (t.toLowerCase() === h) return true;
  if (t.toLowerCase() === `@${h}`) return true;
  const parts = t.split(/\s+/).filter(Boolean);
  if (
    parts.length > 0 &&
    parts.every((p) => {
      const pl = p.toLowerCase();
      return pl === h || pl === `@${h}`;
    })
  ) {
    return true;
  }
  return false;
}

function isLikelyUiNoiseBioLine(line) {
  const t = String(line || "").trim();
  if (!t) return true;
  if (/^[\s.…‧·⋅∙]+$/u.test(t)) return true;
  if (t.length <= 2 && /^[.…‧·⋅]+$/u.test(t)) return true;
  const low = t.toLowerCase();
  const noise = new Set([
    "next",
    "previous",
    "prev",
    "следующий",
    "назад",
    "далее",
    "more",
    "less",
    "ещё",
    "ещё.",
    "show more",
    "show less",
    "siguiente",
    "anterior"
  ]);
  if (noise.has(low)) return true;
  return false;
}

function extractBioFromFollowingUserCell(cell, lines, handleKey, followersLine, followingLine) {
  const ud = cell.querySelector('[data-testid="UserDescription"]');
  if (ud) {
    const t = (ud.innerText || "").replace(/\s+/g, " ").trim();
    if (t && !isLikelyUiNoiseBioLine(t) && !(handleKey && isIdentityNotBio(t, handleKey))) {
      return t;
    }
  }

  const candidates = [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line === followersLine) continue;
    if (line === followingLine) continue;
    if (/^@/.test(line)) continue;
    if (/^\d+$/.test(line)) continue;
    if (/^Follow(ing)?$/i.test(line)) continue;
    if (isLikelyUiNoiseBioLine(line)) continue;
    if (handleKey && isIdentityNotBio(line, handleKey)) continue;
    candidates.push(line);
  }
  if (!candidates.length) return "";
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b));
}

function isFollowingNALine(text) {
  const s = String(text || "").trim();
  return !s || /^Following:\s*N\/A\s*$/i.test(s);
}

function applyGraphToRecord(row, handle) {
  if (!row || !handle) return;
  const s = EXT_STATE.settings;
  if (s.parseFollow !== false && isFollowersNALine(row.followers)) {
    const n = graphFollowersByScreenName.get(handle);
    if (typeof n === "number") {
      row.followers = sanitizeForExportLine(formatFollowersFromCount(n));
    }
  }
  if (s.parseFollowing !== false && isFollowingNALine(row.following)) {
    const n = graphFollowingByScreenName.get(handle);
    if (typeof n === "number") {
      row.following = sanitizeForExportLine(formatFollowingCountLine(n));
    }
  }
  if (s.parseBio !== false && isBioPlaceholder(row.bio)) {
    const b = graphBioByScreenName.get(handle);
    if (b && String(b).trim() && !isIdentityNotBio(b, handle)) {
      row.bio = sanitizeForExportLine(b);
    }
  }
}

function needsGraphHover(record) {
  if (!record) return false;
  const s = EXT_STATE.settings;
  return (
    (s.parseFollow !== false && isFollowersNALine(record.followers)) ||
    (s.parseBio !== false && isBioPlaceholder(record.bio)) ||
    (s.parseFollowing !== false && isFollowingNALine(record.following))
  );
}

function backfillFromGraphQL(records) {
  if (!Array.isArray(records)) return records;
  for (const row of records) {
    if (!row) continue;
    const h = handleFromProfilePageUrl(row.url);
    if (!h) continue;
    applyGraphToRecord(row, h);
  }
  return records;
}

window.addEventListener("message", (ev) => {
  if (ev.source !== window) return;
  const d = ev.data;
  if (!d || d.source !== PAGE_HOOK_SOURCE || d.kind !== "graphql_json") return;
  try {
    harvestFollowerCounts(d.payload, graphFollowersByScreenName);
    harvestFollowingCounts(d.payload, graphFollowingByScreenName);
    harvestUserBios(d.payload, graphBioByScreenName);
  } catch (_e) {
    /* ignore */
  }
});

let lastParserStatusAt = 0;
let lastParserStatusText = "";

function sendPopupStatus(text, done = false) {
  const now = Date.now();
  if (!done && text === lastParserStatusText && now - lastParserStatusAt < 450) {
    return;
  }
  lastParserStatusAt = now;
  lastParserStatusText = text;

  chrome.runtime
    .sendMessage({
      type: "PARSER_STATUS",
      text,
      done
    })
    .catch(() => {});
}

function getCurrentHandle() {
  const path = window.location.pathname || "";
  const match = path.match(/^\/([^/]+)/);
  if (!match) return null;
  const handle = match[1];
  if (["home", "explore", "notifications", "messages", "i", "settings"].includes(handle)) {
    return null;
  }
  return handle;
}

function getProfileAnchorFromCell(cell) {
  const anchors = Array.from(cell.querySelectorAll('a[href^="/"]'));
  for (const a of anchors) {
    const href = a.getAttribute("href");
    if (!href) continue;
    if (/^\/[A-Za-z0-9_]{1,30}$/.test(href)) return a;
  }
  return null;
}

function parseCompactCount(text) {
  if (!text) return null;
  const normalized = text.replace(/,/g, " ");
  const match = normalized.match(/(\d+(?:\.\d+)?\s*[KMB]?)/i);
  return match ? match[1].replace(/\s+/g, "") : null;
}

function isFollowersNALine(text) {
  const s = String(text || "").trim();
  return !s || /^Followers:\s*N\/A\s*$/i.test(s);
}

function stripHrefQuery(href) {
  return String(href || "").split("?")[0].split("#")[0];
}

function isProfileFollowersStatsHref(href) {
  return /\/[^/]+\/(?:verified_)?followers$/i.test(stripHrefQuery(href));
}

function isProfileFollowingStatsHref(href) {
  return /\/[^/]+\/following$/i.test(stripHrefQuery(href));
}

function findFollowersAnchorInCell(cell) {
  for (const a of cell.querySelectorAll('a[href^="/"]')) {
    const h = a.getAttribute("href");
    if (!h) continue;
    if (isProfileFollowersStatsHref(h)) return a;
  }
  return null;
}

function findFollowingAnchorInCell(cell) {
  for (const a of cell.querySelectorAll('a[href^="/"]')) {
    const h = a.getAttribute("href");
    if (!h) continue;
    if (isProfileFollowingStatsHref(h)) return a;
  }
  return null;
}

const FOLLOWERS_LINE_RE =
  /([\d][\d.,]*)\s*([KkMmBbГг])?\s*(followers?|seguidores?|abonnés|abonnes|subscribers?)\b/i;
const FOLLOWERS_MIL_RE =
  /([\d][\d.,]*)\s*mil(?:lones)?(?:\s+de)?\s*(seguidores?|followers?)\b/i;

const FOLLOWING_LINE_RE =
  /([\d][\d.,]*)\s*([KkMmBbГг])?\s*(following|siguiendo|abonnements?)\b/i;

function normalizeFollowingLine(rawDisplay) {
  const r = String(rawDisplay || "").replace(/\s+/g, " ").trim();
  if (!r) return "Following: N/A";
  if (/\bfollowing\b/i.test(r)) return r;
  const m = r.match(FOLLOWING_LINE_RE);
  if (m) {
    const num = m[1].replace(/\s+/g, "") + (m[2] ? m[2].toUpperCase() : "");
    return `${num} Following`;
  }
  return `${r} Following`;
}

function normalizeFollowersLine(rawDisplay) {
  const r = String(rawDisplay || "").replace(/\s+/g, " ").trim();
  if (!r) return "Followers: N/A";
  if (/\bfollowers?\b/i.test(r)) return r;
  let m = r.match(FOLLOWERS_LINE_RE);
  if (m) {
    const num = m[1].replace(/\s+/g, "") + (m[2] ? m[2].toUpperCase() : "");
    return `${num} Followers`;
  }
  m = r.match(FOLLOWERS_MIL_RE);
  if (m) return `${m[1].replace(/\s+/g, "")} mil Followers`;
  return `${r} Followers`;
}

function extractFollowersFromCellBlob(cell) {
  const blob = (cell.innerText || cell.textContent || "").replace(/\s+/g, " ");
  let m = blob.match(FOLLOWERS_LINE_RE);
  if (m) return normalizeFollowersLine(m[0]);
  m = blob.match(FOLLOWERS_MIL_RE);
  if (m) return normalizeFollowersLine(m[0]);
  return null;
}

function extractFollowersText(cell, lines) {
  const followersAnchor = findFollowersAnchorInCell(cell);
  if (followersAnchor) {
    let raw = (followersAnchor.textContent || "").replace(/\s+/g, " ").trim();
    if (raw) {
      if (!/\b(followers?|seguidores?|abonnés)\b/i.test(raw)) {
        raw = `${raw} Followers`;
      }
      return normalizeFollowersLine(raw);
    }
  }

  const fromBlob = extractFollowersFromCellBlob(cell);
  if (fromBlob && !isFollowersNALine(fromBlob)) return fromBlob;

  const lineHit =
    lines.find((line) => /\b[Ff]ollowers?\b/i.test(line)) ||
    lines.find((line) => /\b[Ss]eguidores?\b/i.test(line)) ||
    lines.find((line) => /\babonnés\b/i.test(line)) ||
    lines.find((line) => FOLLOWERS_LINE_RE.test(line) || FOLLOWERS_MIL_RE.test(line));

  if (lineHit) return normalizeFollowersLine(lineHit);

  const labeled = cell.querySelector(
    '[aria-label*="follower" i], [aria-label*="seguidor" i], [aria-label*="abonn" i]'
  );
  if (labeled) {
    const al = (labeled.getAttribute("aria-label") || "").trim();
    if (al) return normalizeFollowersLine(al);
  }

  return "Followers: N/A";
}

function extractFollowingText(cell, lines, followersLine) {
  const followingAnchor = findFollowingAnchorInCell(cell);
  if (followingAnchor) {
    let raw = (followingAnchor.textContent || "").replace(/\s+/g, " ").trim();
    if (raw) {
      if (!/\bfollowing\b/i.test(raw)) {
        raw = `${raw} Following`;
      }
      return normalizeFollowingLine(raw);
    }
  }

  const blob = (cell.innerText || cell.textContent || "").replace(/\s+/g, " ");
  let m = blob.match(FOLLOWING_LINE_RE);
  if (m) return normalizeFollowingLine(m[0]);

  const lineHit = lines.find(
    (line) =>
      line !== followersLine && /\bFollowing\b/i.test(line) && /\d/.test(line)
  );
  if (lineHit) return normalizeFollowingLine(lineHit);

  return "Following: N/A";
}

function getFollowingTimelineRoot(container) {
  if (!container) return null;

  const byLabel =
    container.querySelector('[aria-label="Timeline: Following"]') ||
    container.querySelector('[aria-label*="Timeline: Following"]');
  if (byLabel) return byLabel;

  const sections = container.querySelectorAll('section[role="region"]');
  for (const sec of sections) {
    const h1 = sec.querySelector("h1");
    if (h1 && /^\s*following\s*$/i.test((h1.textContent || "").trim())) {
      const timeline = sec.querySelector('[aria-label*="Timeline"]');
      if (timeline) return timeline;
      return sec;
    }
  }

  return null;
}

function findFollowingListScroller(container) {
  if (!container) return null;

  const timelineRoot = getFollowingTimelineRoot(container);

  if (timelineRoot) {
    let node = timelineRoot;
    while (node && node !== container) {
      const st = window.getComputedStyle(node);
      const oy = st.overflowY;
      if (
        (oy === "auto" || oy === "scroll" || oy === "overlay") &&
        node.scrollHeight > node.clientHeight + 2
      ) {
        return node;
      }
      node = node.parentElement;
    }

    const innerScroll = timelineRoot.querySelector('[data-testid="scroll-container"]');
    if (innerScroll && innerScroll.scrollHeight > innerScroll.clientHeight + 2) {
      return innerScroll;
    }
  }

  const primary = container.querySelector('[data-testid="primaryColumn"]');
  if (primary && primary.scrollHeight > primary.clientHeight + 2) {
    return primary;
  }

  return container;
}

function dispatchScrollForLazyLoad(el) {
  if (!el) return;
  el.dispatchEvent(new Event("scroll", { bubbles: true }));
}

function extractUserRecordsFromDialog(dialogEl) {
  const records = new Map();
  const s = EXT_STATE.settings;
  const wantFollow = s.parseFollow !== false;
  const wantFollowing = s.parseFollowing !== false;
  const wantBio = s.parseBio !== false;

  const timelineRoot = getFollowingTimelineRoot(dialogEl);
  const searchRoot = timelineRoot || dialogEl;
  const cells = searchRoot.querySelectorAll('[data-testid="UserCell"]');

  cells.forEach((cell) => {
    const profileAnchor = getProfileAnchorFromCell(cell);
    if (!profileAnchor) return;

    const href = profileAnchor.getAttribute("href");
    const url = `https://x.com${href}`;

    const fullText = cell.innerText || "";
    const lines = fullText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const handleKey = handleFromProfileHref(href);

    let followersLine = wantFollow ? extractFollowersText(cell, lines) : "";
    if (wantFollow && isFollowersNALine(followersLine) && handleKey) {
      const fromGraph = graphFollowersByScreenName.get(handleKey);
      if (typeof fromGraph === "number") {
        followersLine = formatFollowersFromCount(fromGraph);
      }
    }

    let followingLine = wantFollowing
      ? extractFollowingText(cell, lines, followersLine)
      : "";
    if (wantFollowing && isFollowingNALine(followingLine) && handleKey) {
      const fromGraph = graphFollowingByScreenName.get(handleKey);
      if (typeof fromGraph === "number") {
        followingLine = formatFollowingCountLine(fromGraph);
      }
    }

    let bio = wantBio
      ? extractBioFromFollowingUserCell(
          cell,
          lines,
          handleKey,
          followersLine,
          followingLine
        )
      : "";
    if (wantBio) {
      if (!bio) bio = "No bio";
      if (handleKey && isIdentityNotBio(bio, handleKey)) {
        bio = "No bio";
      }
      if (handleKey && isBioPlaceholder(bio)) {
        const gBio = graphBioByScreenName.get(handleKey);
        if (gBio && !isIdentityNotBio(gBio, handleKey)) bio = gBio;
      }
    }

    if (!records.has(url)) {
      records.set(url, {
        url,
        followers: wantFollow ? sanitizeForExportLine(followersLine) : "",
        following: wantFollowing ? sanitizeForExportLine(followingLine) : "",
        bio: wantBio ? sanitizeForExportLine(bio) : ""
      });
    }
  });

  return records;
}

function getFollowingCountFromPage() {
  if (EXT_STATE.expectedFollowingTotal) {
    return EXT_STATE.expectedFollowingTotal;
  }

  const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
  const scope = primaryColumn || document.documentElement;

  const links = Array.from(scope.querySelectorAll('a[href$="/following"]'));
  const currentHandle = getCurrentHandle();

  for (const link of links) {
    const href = link.getAttribute("href") || "";
    if (currentHandle && !href.startsWith(`/${currentHandle}/following`)) continue;
    const txt = link.innerText || "";
    const parsed = parseCompactCount(txt);
    if (parsed) return parsed;
  }
  return "unknown";
}

function parsePlainFollowingTarget(targetStr) {
  if (!targetStr || targetStr === "unknown") return null;
  const s = String(targetStr).trim();
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

async function waitForFollowingLinkReady(followingLink, timeoutMs = 2500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const txt = followingLink.innerText || "";
    if (parseCompactCount(txt)) {
      return parseCompactCount(txt);
    }
    await sleep(200);
  }
  return parseCompactCount(followingLink.innerText || "");
}

function isFollowingFullPageOpen(handle) {
  const path = window.location.pathname || "";
  if (!new RegExp(`^/${handle}/following/?$`, "i").test(path)) {
    return false;
  }
  const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
  const timeline = document.querySelector(
    '[aria-label="Timeline: Following"], [aria-label*="Timeline: Following"]'
  );
  return Boolean(primaryColumn && timeline);
}

async function openFollowingList() {
  const currentHandle = getCurrentHandle();
  if (!currentHandle) {
    throw new Error("Cannot detect profile handle from URL. Open a profile page on x.com first.");
  }

  let followingLink =
    document.querySelector(`a[href='/${currentHandle}/following']`) ||
    document.querySelector(`a[href='/${currentHandle}/following/verified_followers']`) ||
    document.querySelector('a[href$="/following"]');

  if (!followingLink) {
    throw new Error("Following link not found on page.");
  }

  if (isFollowingFullPageOpen(currentHandle)) {
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    EXT_STATE.expectedFollowingTotal =
      parseCompactCount(followingLink.innerText || "") || getFollowingCountFromPage();
    return { container: primaryColumn, mode: "page" };
  }

  const readyTotal = await waitForFollowingLinkReady(followingLink);
  EXT_STATE.expectedFollowingTotal = readyTotal;

  followingLink.click();

  const timeoutMs = 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) {
      return { container: dialog, mode: "dialog" };
    }

    const followingHeading = document.querySelector(
      'section[role="region"] h1, h1'
    );
    const headingText = (followingHeading?.textContent || "").trim().toLowerCase();
    const followingTimeline = document.querySelector('div[aria-label*="Timeline: Following"]');
    const onFollowingPath = /\/following\/?$/i.test(window.location.pathname);
    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');

    if ((headingText === "following" || followingTimeline || onFollowingPath) && primaryColumn) {
      return { container: primaryColumn, mode: "page" };
    }
    await sleep(200);
  }

  throw new Error("Following list container did not open in time.");
}

async function autoScrollUntilEnd(dialogEl, onProgress) {
  const knownUsers = new Map();
  const targetCount = getFollowingCountFromPage();
  const targetNum = parsePlainFollowingTarget(String(targetCount));

  let lastCount = 0;
  let idleRounds = 0;
  const maxIdleRounds = targetNum !== null ? 55 : 22;

  let settled = false;
  const observer = new MutationObserver(() => {
    settled = false;
  });
  observer.observe(dialogEl, { subtree: true, childList: true, characterData: true });

  let iter = 0;
  const maxIterations = 500;

  try {
    while (iter < maxIterations) {
      iter += 1;

      const next = extractUserRecordsFromDialog(dialogEl);
      next.forEach((value, key) => knownUsers.set(key, value));

      onProgress(knownUsers.size, targetCount);

      if (targetNum !== null && knownUsers.size >= targetNum) {
        break;
      }

      const scroller = findFollowingListScroller(dialogEl);
      const beforeHeight = scroller.scrollHeight;
      const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

      const step = Math.max(320, Math.floor(scroller.clientHeight * 0.5));
      const maxInnerSteps = 48;
      if (maxTop > 0 && Number.isFinite(maxTop)) {
        let t = scroller.scrollTop;
        let innerSteps = 0;
        while (t < maxTop - 4 && innerSteps < maxInnerSteps) {
          innerSteps += 1;
          t = Math.min(maxTop, t + step);
          scroller.scrollTop = t;
          dispatchScrollForLazyLoad(scroller);
          await sleep(120);
        }
      }
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "auto" });
      dispatchScrollForLazyLoad(scroller);

      const primary = dialogEl.querySelector('[data-testid="primaryColumn"]');
      if (primary && primary !== scroller) {
        primary.scrollTo({ top: primary.scrollHeight, behavior: "auto" });
        dispatchScrollForLazyLoad(primary);
      }
      window.scrollTo(0, document.body.scrollHeight);
      const docEl = document.documentElement;
      docEl.scrollTop = docEl.scrollHeight;
      window.scrollBy(0, Math.min(900, Math.floor(window.innerHeight * 0.85)));

      settled = true;
      await sleep(950);

      const after = extractUserRecordsFromDialog(dialogEl);
      after.forEach((value, key) => knownUsers.set(key, value));
      const currentCount = knownUsers.size;

      const grew = currentCount > lastCount;
      const heightChanged = scroller.scrollHeight > beforeHeight;
      const noNewMutations = settled;

      if (targetNum !== null && currentCount < targetNum) {
        idleRounds = 0;
      } else if (!grew && !heightChanged && noNewMutations) {
        idleRounds += 1;
        if (idleRounds >= maxIdleRounds) {
          break;
        }
      } else {
        idleRounds = 0;
      }

      lastCount = currentCount;
    }
  } finally {
    observer.disconnect();
  }

  return backfillFromGraphQL(Array.from(knownUsers.values()));
}

function findAvatarHoverTarget(cell) {
  const profileAnchor = getProfileAnchorFromCell(cell);
  const href = profileAnchor?.getAttribute("href") || "";
  const h = handleFromProfileHref(href);
  if (h) {
    const exact = cell.querySelector(`[data-testid="UserAvatar-Container-${h}"]`);
    if (exact) return exact;
  }
  const pathSeg = String(href).replace(/^\//, "").split("/")[0];
  if (pathSeg && /^[A-Za-z0-9_]+$/.test(pathSeg)) {
    const byPath = cell.querySelector(
      `[data-testid="UserAvatar-Container-${pathSeg}"], [data-testid="UserAvatar-Container-${pathSeg.toLowerCase()}"]`
    );
    if (byPath) return byPath;
  }
  const wrap = cell.querySelector('[data-testid^="UserAvatar-Container"]');
  if (wrap) return wrap;
  const img = cell.querySelector(
    'a[href^="/"] img[src*="profile_images"], a[href^="/"] img[src*="twimg"]'
  );
  if (img) {
    const a = img.closest("a");
    if (a) return a;
  }
  return profileAnchor || null;
}

function pathOnlyFromHref(href) {
  try {
    return new URL(href, "https://x.com").pathname.replace(/\/+$/, "") || "";
  } catch {
    return String(href || "").split("?")[0].split("#")[0].replace(/\/+$/, "") || "";
  }
}

function getVisibleHoverCardRoot() {
  const parents = Array.from(document.querySelectorAll('[data-testid="hoverCardParent"]'));
  const cards = Array.from(document.querySelectorAll('[data-testid="HoverCard"]'));
  const pickVisible = (els) => {
    const vis = els.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    });
    return vis.length ? vis[vis.length - 1] : els[els.length - 1] || null;
  };
  const p = pickVisible(parents);
  if (p) return p;
  const c = pickVisible(cards);
  return c || document.documentElement;
}

function pickHovercardStatAnchor(handle, kind) {
  const h = handle.toLowerCase();
  const root = getVisibleHoverCardRoot();
  const anchors = Array.from(root.querySelectorAll('a[href^="/"]'));
  const match = (path) => {
    const p = path.toLowerCase();
    if (kind === "following") return p === `/${h}/following`;
    if (kind === "followers") {
      return p === `/${h}/followers` || p === `/${h}/verified_followers`;
    }
    return false;
  };
  const hits = anchors.filter((a) => match(pathOnlyFromHref(a.getAttribute("href") || "")));
  const vis = hits.filter((a) => {
    const r = a.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  const list = vis.length ? vis : hits;
  return list.length ? list[list.length - 1] : null;
}

function applyHoverCardDomToRecord(record, handle) {
  if (!record || !handle) return;
  const s = EXT_STATE.settings;

  if (s.parseFollowing !== false && isFollowingNALine(record.following)) {
    const a = pickHovercardStatAnchor(handle, "following");
    if (a) {
      let raw = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (raw) {
        if (!/\bfollowing\b/i.test(raw)) raw = `${raw} Following`;
        record.following = sanitizeForExportLine(normalizeFollowingLine(raw));
      }
    }
  }
  if (s.parseFollow !== false && isFollowersNALine(record.followers)) {
    const a = pickHovercardStatAnchor(handle, "followers");
    if (a) {
      let raw = (a.textContent || "").replace(/\s+/g, " ").trim();
      if (raw) {
        if (!/\b(followers?|seguidores?|abonnés)\b/i.test(raw)) {
          raw = `${raw} Followers`;
        }
        record.followers = sanitizeForExportLine(normalizeFollowersLine(raw));
      }
    }
  }
  if (s.parseBio !== false && isBioPlaceholder(record.bio)) {
    const anchor = pickHovercardStatAnchor(handle, "following");
    if (anchor) {
      const candidates = [];
      let node = anchor.parentElement;
      for (let depth = 0; depth < 16 && node; depth++) {
        const blocks = node.querySelectorAll("[dir=auto]");
        for (const block of blocks) {
          const t = (block.innerText || "").replace(/\s+/g, " ").trim();
          if (t.length < 2) continue;
          if (isIdentityNotBio(t, handle)) continue;
          if (isLikelyUiNoiseBioLine(t)) continue;
          if (/^Followed by\b/i.test(t)) continue;
          if (/^Click to Follow\b/i.test(t)) continue;
          if (/^\d[\d.,]*\s*(Following|Followers)\b/i.test(t)) continue;
          if (t.includes("Follow @")) continue;
          candidates.push(t);
        }
        node = node.parentElement;
      }
      const seen = new Set();
      const uniq = candidates.filter((t) => {
        const k = t.slice(0, 200);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (uniq.length) {
        const best = uniq.reduce((a, b) => (a.length >= b.length ? a : b));
        record.bio = sanitizeForExportLine(best);
      }
    }
  }
}

function syntheticPointerHover(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = Math.floor(r.left + r.width / 2);
  const y = Math.floor(r.top + r.height / 2);
  const common = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: x,
    clientY: y,
    screenX: x + window.screenX,
    screenY: y + window.screenY,
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true
  };
  el.dispatchEvent(new PointerEvent("pointermove", common));
  el.dispatchEvent(new PointerEvent("pointerover", common));
  el.dispatchEvent(new PointerEvent("pointerenter", { ...common, bubbles: false }));
  el.dispatchEvent(new MouseEvent("mouseover", common));
  el.dispatchEvent(new MouseEvent("mouseenter", { ...common, bubbles: false }));
  try {
    el.focus({ preventScroll: true });
  } catch (_e) {
    /* ignore */
  }
  const hit = document.elementFromPoint(x, y);
  if (hit && hit !== el && el.contains(hit)) {
    hit.dispatchEvent(new PointerEvent("pointerover", common));
    hit.dispatchEvent(new MouseEvent("mouseover", common));
  }
}

function syntheticPointerLeave(el) {
  if (!el) return;
  const common = {
    bubbles: true,
    cancelable: true,
    view: window,
    clientX: 0,
    clientY: 0
  };
  el.dispatchEvent(new MouseEvent("mouseout", common));
  el.dispatchEvent(new MouseEvent("mouseleave", { ...common, bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointerout", common));
  el.dispatchEvent(new PointerEvent("pointerleave", { ...common, bubbles: false }));
}

async function hoverEnrichFollowingList(container, records, onProgress) {
  const timelineRoot = getFollowingTimelineRoot(container) || container;
  const scroller = findFollowingListScroller(container);
  const recordsByUrl = new Map(records.map((r) => [r.url, r]));
  const need = new Set(records.filter((r) => needsGraphHover(r)).map((r) => r.url));
  if (need.size === 0) return records;

  const s = EXT_STATE.settings;
  const hoverBetween = Math.max(600, Number(s.hoverBetweenMs) || 2200);
  const hoverWait = Math.max(350, Number(s.hoverWaitMs) || 1300);

  function scrollViewportToTop() {
    scroller.scrollTop = 0;
    if (container && container !== scroller) {
      container.scrollTop = 0;
      dispatchScrollForLazyLoad(container);
    }
    const primary = container.querySelector('[data-testid="primaryColumn"]');
    if (primary && primary !== scroller) {
      primary.scrollTop = 0;
      dispatchScrollForLazyLoad(primary);
    }
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    dispatchScrollForLazyLoad(scroller);
  }

  scrollViewportToTop();
  await sleep(700);

  let stuck = 0;
  let lastNeed = need.size;
  let didSecondSweep = false;

  for (let guard = 0; guard < 3000 && need.size > 0; guard++) {
    const cells = timelineRoot.querySelectorAll('[data-testid="UserCell"]');
    let touched = false;

    for (const cell of cells) {
      const profileAnchor = getProfileAnchorFromCell(cell);
      if (!profileAnchor) continue;
      const href = profileAnchor.getAttribute("href");
      const url = `https://x.com${href}`;
      if (!need.has(url)) continue;

      const record = recordsByUrl.get(url);
      if (!record || !needsGraphHover(record)) {
        need.delete(url);
        continue;
      }

      cell.scrollIntoView({ block: "center", behavior: "instant" });
      await sleep(140);
      const target = findAvatarHoverTarget(cell);
      syntheticPointerHover(target);
      await sleep(hoverWait);

      const handle = handleFromProfileHref(href);
      if (handle) {
        const t0 = Date.now();
        while (Date.now() - t0 < 6500) {
          applyGraphToRecord(record, handle);
          applyHoverCardDomToRecord(record, handle);
          if (!needsGraphHover(record)) break;
          await sleep(110);
        }
      }

      syntheticPointerLeave(target);
      await sleep(80);

      if (!needsGraphHover(record)) {
        need.delete(url);
      }
      touched = true;
      onProgress(records.length - need.size, records.length, need.size);
      await sleep(hoverBetween + Math.floor(Math.random() * 900));
    }

    const prevTop = scroller.scrollTop;
    scroller.scrollTop = Math.min(
      scroller.scrollHeight - scroller.clientHeight,
      scroller.scrollTop + Math.floor(scroller.clientHeight * 0.52)
    );
    dispatchScrollForLazyLoad(scroller);
    await sleep(380);

    if (!touched) {
      stuck += 1;
    } else {
      stuck = 0;
    }

    if (need.size === lastNeed && stuck >= 4) {
      if (!didSecondSweep) {
        didSecondSweep = true;
        stuck = 0;
        scrollViewportToTop();
        await sleep(700);
        continue;
      }
      break;
    }
    lastNeed = need.size;
  }

  backfillFromGraphQL(records);
  return records;
}

function formatAsTxt(records, settings) {
  const s = settings || EXT_STATE.settings;
  const showUrl = s.parseUrlProfile !== false;
  const showFollow = s.parseFollow !== false;
  const showFollowing = s.parseFollowing !== false;
  const showBio = s.parseBio !== false;
  return records
    .map((r) => {
      const u = showUrl ? sanitizeForExportLine(r.url) : "";
      const f = showFollow ? sanitizeForExportLine(r.followers) : "";
      const g = showFollowing ? sanitizeForExportLine(r.following) : "";
      const b = showBio ? sanitizeForExportLine(r.bio) : "";
      return `${u} | ${f} | ${g} | ${b}`;
    })
    .join("\n");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "START_PARSING") return;

  if (EXT_STATE.running) {
    sendResponse({ ok: false, error: "Parser is already running." });
    return true;
  }

  EXT_STATE.running = true;
  graphFollowersByScreenName.clear();
  graphFollowingByScreenName.clear();
  graphBioByScreenName.clear();
  EXT_STATE.settings = {
    sheetWebhookUrl: String(message?.settings?.sheetWebhookUrl || "").trim(),
    sheetName: String(message?.settings?.sheetName || "Sheet1").trim() || "Sheet1",
    spreadsheetId: String(message?.settings?.spreadsheetId || "").trim(),
    saveToSheet: message?.settings?.saveToSheet !== false,
    saveToTxt: message?.settings?.saveToTxt !== false,
    hoverEnrich: message?.settings?.hoverEnrich !== false,
    hoverBetweenMs: Math.max(600, Number(message?.settings?.hoverBetweenMs) || 2200),
    hoverWaitMs: Math.max(350, Number(message?.settings?.hoverWaitMs) || 1300),
    parseUrlProfile: message?.settings?.parseUrlProfile !== false,
    parseFollow: message?.settings?.parseFollow !== false,
    parseFollowing: message?.settings?.parseFollowing !== false,
    parseBio: message?.settings?.parseBio !== false
  };
  sendResponse({ ok: true });

  (async () => {
    try {
      sendPopupStatus("Opening following list...");
      const openResult = await openFollowingList();
      const listContainer = openResult.container;

      sendPopupStatus("Loading all following users...");
      let records = await autoScrollUntilEnd(listContainer, (loaded, total) => {
        const text = total && total !== "unknown"
          ? `Loaded ${loaded} / ${total} users`
          : `Loaded ${loaded} users`;
        sendPopupStatus(text);
      });

      if (!records.length) {
        throw new Error("No following users were parsed. Try opening your profile and rerun.");
      }

      if (EXT_STATE.settings.hoverEnrich) {
        sendPopupStatus(
          `Hover pass: filling N/A (slow, ~${Math.round(
            (EXT_STATE.settings.hoverBetweenMs + EXT_STATE.settings.hoverWaitMs) / 1000
          )}s per account)…`
        );
        records = await hoverEnrichFollowingList(
          listContainer,
          records,
          (filled, total, remaining) => {
            sendPopupStatus(
              `Hover enrich: ${filled} / ${total} ok · ${remaining} still need data`
            );
          }
        );
      }

      const finalRecords = backfillFromGraphQL(records);
      sendPopupStatus(
        `Ready ${finalRecords.length} users (list + GraphQL${EXT_STATE.settings.hoverEnrich ? " + hover" : ""}).`
      );
      const txt = formatAsTxt(finalRecords, EXT_STATE.settings);
      sendPopupStatus(`Parsed ${finalRecords.length} users. Exporting...`);

      if (EXT_STATE.settings.saveToSheet) {
        if (!EXT_STATE.settings.sheetWebhookUrl) {
          throw new Error("Google Sheets Web App URL is empty. Set it in extension settings.");
        }
        if (!String(EXT_STATE.settings.spreadsheetId || "").trim()) {
          throw new Error(
            "Spreadsheet ID is required. Copy it from your Google Sheet URL (.../d/PASTE_HERE/edit) into extension settings."
          );
        }

        const sh = EXT_STATE.settings;
        const sheetRows = finalRecords.map((r) => ({
          profileUrl:
            sh.parseUrlProfile !== false ? sanitizeForExportLine(r.url) : "",
          followers:
            sh.parseFollow !== false ? sanitizeForExportLine(r.followers) : "",
          following:
            sh.parseFollowing !== false
              ? sanitizeForExportLine(r.following)
              : "",
          bio: sh.parseBio !== false ? sanitizeForExportLine(r.bio) : ""
        }));

        sendPopupStatus(`Sending ${sheetRows.length} rows to Google Sheets...`);
        const sheetResp = await chrome.runtime.sendMessage({
          type: "PUSH_TO_SHEET",
          webhookUrl: EXT_STATE.settings.sheetWebhookUrl,
          sheetName: EXT_STATE.settings.sheetName,
          spreadsheetId: String(EXT_STATE.settings.spreadsheetId || "").trim(),
          expectedRowCount: sheetRows.length,
          rows: sheetRows
        });
        if (!sheetResp?.ok) {
          throw new Error(sheetResp?.error || "Failed to send rows to Google Sheets.");
        }
        if (typeof sheetResp.sentRowCount === "number" && sheetResp.sentRowCount !== sheetRows.length) {
          throw new Error(
            `Background received ${sheetResp.sentRowCount} rows but parser produced ${sheetRows.length}. Reload the extension.`
          );
        }
        const sr = sheetResp?.sheetResponse || {};
        const inserted = sr.inserted;
        const sheetUrl = sr.spreadsheetUrl;
        const tabName = sr.sheetTab;
        const lastRowNum = sr.lastRowNumber;
        const idEcho = sr.spreadsheetIdEcho;
        const preview = sr.lastRowPreview;
        if (typeof inserted === "number") {
          let line = `Google Sheets: inserted ${inserted} row(s).`;
          if (tabName) line += ` Tab: "${tabName}"`;
          if (typeof lastRowNum === "number") line += ` (last row #${lastRowNum})`;
          if (idEcho) line += ` File ID: ${idEcho}`;
          if (sheetUrl) line += `\nOpen: ${sheetUrl}`;
          if (preview) line += `\nLast row: ${JSON.stringify(preview)}`;
          sendPopupStatus(line);
        }
      }

      if (EXT_STATE.settings.saveToTxt) {
        await chrome.runtime.sendMessage({
          type: "DOWNLOAD_TXT",
          payload: txt,
          filename: `x_following_${Date.now()}.txt`
        });
      }

      const exportTargets = [
        EXT_STATE.settings.saveToSheet ? "Google Sheets" : null,
        EXT_STATE.settings.saveToTxt ? ".txt" : null
      ].filter(Boolean);
      let doneLine = `Done. Exported ${finalRecords.length} users to ${exportTargets.join(" + ") || "nowhere"}`;
      if (EXT_STATE.settings.saveToSheet) {
        doneLine +=
          "\n\nIf the sheet looks empty: open the link above, click the tab name shown (e.g. Sheet1), scroll down, turn off View → filters. Tab name in the extension must match the sheet tab exactly.";
      }
      sendPopupStatus(doneLine, true);
    } catch (err) {
      sendPopupStatus(`Error: ${err.message}`, true);
    } finally {
      EXT_STATE.running = false;
      EXT_STATE.expectedFollowingTotal = null;
      EXT_STATE.settings = {
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
    }
  })();

  return true;
});
