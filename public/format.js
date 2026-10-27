// @ts-check
/*
 * format.js — how app.js writes a duration, a time, a date and a size, and escapes text for HTML. Moved out of app.js
 * in v1.9.70-t1, unchanged: declared here at the top level, so app.js (loaded after it) finds them by the same names.
 */
/* exported fmtDuration, escapeHtml, fmtTime, fmtDate, fmtSize */

/** "1:02:03" past an hour, else "2:03". @param {number} secs */
function fmtDuration(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

/** @param {any} s */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}

/** "62:03": minutes and seconds, never hours. @param {number} secs */
function fmtTime(secs) {
  secs = Math.max(0, Math.floor(secs || 0));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m + ":" + String(s).padStart(2, "0");
}

/** @param {string} iso */
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "Unknown date";
  try {
    return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (e) { return d.toISOString().slice(0, 16).replace("T", " "); }
}
/** @param {number} n */
function fmtSize(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}
