// site.js — shared by every page of Rouen's site: the feature cards' ⓘ, the Copy buttons beside fixed commands, and
// the version on the contents page (the languages: i18n.js; the install command's builder: install.js).

// The feature cards' ⓘ buttons: each opens its card's how-to, and closes it again.
document.addEventListener("click", function (e) {
  var btn = e.target.closest && e.target.closest(".card h3 .info");
  if (!btn) return;
  var how = document.getElementById(btn.getAttribute("aria-controls"));
  if (!how) return;
  var open = btn.getAttribute("aria-expanded") !== "true";
  btn.setAttribute("aria-expanded", open ? "true" : "false");
  how.hidden = !open;
  var card = btn.closest(".card");
  if (card) card.classList.toggle("open", open);   // the card's whole description with its how-to
});

// The fixed code boxes (Unraid): Copy puts the box's text on the clipboard.
(function () {
  Array.prototype.forEach.call(document.querySelectorAll(".copy-static"), function (btn) {
    btn.addEventListener("click", function () {
      var text = document.getElementById(btn.getAttribute("data-copy")).textContent;
      function done() {
        btn.textContent = "Copied ✓";
        btn.classList.add("done");
        setTimeout(function () { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
      }
      function fallbackCopy() {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); done(); } catch (e) { /* no clipboard available — user can select the text manually */ }
        document.body.removeChild(ta);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallbackCopy);
      else fallbackCopy();
    });
  });
})();

// The contents page's version: the release marked Latest, else the one this site was built with (its own text).
(function () {
  var badge = document.getElementById("ver-badge");
  if (!badge) return;
  fetch("https://api.github.com/repos/meltface-80/Rouen/releases/latest")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var m = data && String(data.tag_name || "").match(/^v?(\d+\.\d+\.\d+(?:-beta\d+)?)$/);
      if (!m) return;
      badge.textContent = "v" + m[1];
      Array.prototype.forEach.call(document.querySelectorAll(".ver"), function (el) { el.textContent = "v" + m[1]; });
    })
    .catch(function () { /* GitHub unreachable or rate-limited: the version the page was built with stays */ });
})();
