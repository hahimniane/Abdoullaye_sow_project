/* Homepage booking panel: one tab per service. Without this file the first
   tab (Send a package) still works on its own. */
(function () {
  "use strict";
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".a-tab"));
  if (!tabs.length) return;

  function select(tab, focus) {
    tabs.forEach(function (other) {
      var on = other === tab;
      other.setAttribute("aria-selected", on ? "true" : "false");
      other.tabIndex = on ? 0 : -1;
      var pane = document.getElementById(other.getAttribute("aria-controls"));
      if (pane) pane.hidden = !on;
    });
    if (focus) tab.focus();
  }

  tabs.forEach(function (tab, index) {
    tab.addEventListener("click", function () { select(tab, false); });
    tab.addEventListener("keydown", function (event) {
      var next = null;
      if (event.key === "ArrowRight") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowLeft") next = tabs[(index - 1 + tabs.length) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (next) {
        event.preventDefault();
        select(next, true);
      }
    });
  });
})();
