(function xFollowingParserHook() {
  const SOURCE = "x-following-parser-hook";

  function postPayload(json) {
    try {
      window.postMessage({ source: SOURCE, kind: "graphql_json", payload: json }, "*");
    } catch (_e) {
      /* ignore */
    }
  }

  function maybeCapture(url, responseClone) {
    if (!url || typeof url !== "string") return;
    const u = url.toLowerCase();
    const isGraphql =
      u.includes("graphql") ||
      u.includes("/i/api/graphql") ||
      u.includes("api.x.com/graphql");
    const isLikelyUserJson =
      u.includes("/i/api/graphql/") ||
      (u.includes("/i/api/") &&
        (u.includes("user") ||
          u.includes("following") ||
          u.includes("followers") ||
          u.includes("timeline")));
    if (!isGraphql && !isLikelyUserJson) return;
    responseClone
      .json()
      .then(postPayload)
      .catch(() => {});
  }

  const origFetch = window.fetch;
  window.fetch = function fetchHook(...args) {
    return origFetch.apply(this, args).then((res) => {
      try {
        const req = args[0];
        const url = typeof req === "string" ? req : req && req.url;
        maybeCapture(String(url || ""), res.clone());
      } catch (_e) {
        /* ignore */
      }
      return res;
    });
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function openHook(method, url, ...rest) {
    this.__xParserUrl = String(url || "");
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function sendHook(body) {
    this.addEventListener("load", function onLoad() {
      try {
        const url = String(this.__xParserUrl || "");
        const ct = (this.getResponseHeader("content-type") || "").toLowerCase();
        if (!ct.includes("json")) return;
        const txt = this.responseText;
        if (!txt || txt[0] !== "{") return;
        const json = JSON.parse(txt);
        postPayload(json);
      } catch (_e) {
        /* ignore */
      }
    });
    return origSend.call(this, body);
  };
})();
