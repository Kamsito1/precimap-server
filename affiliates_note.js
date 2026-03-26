
// ─── AFFILIATE INJECTION (into server.js) ─────────────────────────────────────
// Add this near top of server.js after other requires:
// const { applyOurTag, detectStore } = require('./affiliates');
//
// Then in the deals POST, before saving url to DB:
// if (url && isAmazonUrl(url)) url = applyOurTag(url);
// This silently replaces any user-submitted Amazon tag with ours.
