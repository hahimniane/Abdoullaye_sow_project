/* Homepage behavior: the booking panel's tabs, the motion that home.css
   describes (sections easing in, the WhatsApp chat typing), and the sea clip.
   Without this file the page is complete and still: the first tab works,
   every section and message is visible, the clip shows its poster. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Tabs, with an underline that slides to the chosen one ---- */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".a-tab"));
  var tabList = document.querySelector(".a-tabs");
  var ink = null;
  if (tabList && tabs.length) {
    ink = document.createElement("span");
    ink.className = "a-tab-ink";
    tabList.appendChild(ink);
    tabList.classList.add("has-ink");
  }
  function placeInk(tab) {
    if (!ink || !tab) return;
    var inset = 12;
    ink.style.width = Math.max(0, tab.offsetWidth - inset * 2) + "px";
    ink.style.transform = "translate(" + (tab.offsetLeft + inset) + "px," + (tab.offsetTop + tab.offsetHeight - tabList.clientHeight) + "px)";
  }
  function select(tab, focus) {
    tabs.forEach(function (other) {
      var on = other === tab;
      other.setAttribute("aria-selected", on ? "true" : "false");
      other.tabIndex = on ? 0 : -1;
      var pane = document.getElementById(other.getAttribute("aria-controls"));
      if (pane) pane.hidden = !on;
    });
    placeInk(tab);
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
  function currentTab() {
    return tabs.filter(function (t) { return t.getAttribute("aria-selected") === "true"; })[0] || tabs[0];
  }
  if (tabs.length) {
    placeInk(currentTab());
    window.addEventListener("resize", function () { placeInk(currentTab()); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placeInk(currentTab()); });
  }

  /* ---- The sea clip: plays only while on screen ---- */
  var video = document.querySelector(".a-j2 video");
  if (video) {
    if (reduce) {
      video.removeAttribute("autoplay");
      video.pause();
    } else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        var p;
        if (entries[0].isIntersecting && !document.hidden) {
          p = video.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          video.pause();
        }
      }).observe(video);
    }
  }

  if (reduce || !("IntersectionObserver" in window)) return;

  /* ---- Sections ease in once ---- */
  var root = document.documentElement;
  root.classList.add("a-motion");
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  var seen = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      seen.unobserve(entry.target);
      if (entry.target.querySelector(".a-chat")) playChat();
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
  reveals.forEach(function (el) { seen.observe(el); });
  // Never leave anything hidden: whatever has not shown by now shows.
  window.setTimeout(function () {
    reveals.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.top < window.innerHeight) el.classList.add("is-in");
    });
  }, 1600);

  /* ---- WhatsApp: messages arrive one by one ---- */
  var chat = document.querySelector(".a-chat");
  var messages = chat ? Array.prototype.slice.call(chat.querySelectorAll(".a-msg")) : [];
  var typing = null;
  var played = false;
  if (chat && messages.length) {
    typing = document.createElement("span");
    typing.className = "a-typing";
    typing.innerHTML = "<i></i><i></i><i></i>";
    chat.appendChild(typing);
  }
  function playChat() {
    if (played || !messages.length) return;
    played = true;
    var step = 0;
    function next() {
      if (step >= messages.length) {
        typing.classList.remove("is-on");
        return;
      }
      chat.insertBefore(typing, messages[step]);
      typing.classList.add("is-on");
      window.setTimeout(function () {
        typing.classList.remove("is-on");
        messages[step].classList.add("is-in");
        step += 1;
        window.setTimeout(next, 500);
      }, step === 0 ? 600 : 1100);
    }
    next();
  }
  // If the chat never scrolls into view, its messages still show.
  window.setTimeout(function () {
    if (!played) messages.forEach(function (m) { m.classList.add("is-in"); });
  }, 15000);
})();
