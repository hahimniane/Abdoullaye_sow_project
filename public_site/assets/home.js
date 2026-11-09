/* Homepage hero video: plays muted in the rounded photo slot, only while it
   is on screen. Under reduced motion or data saver it never loads, and the
   poster frame stays. Purely decorative: if this file fails, the poster shows. */
(function () {
  "use strict";
  var video = document.querySelector(".h-photo video");
  if (!video) return;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var saveData = navigator.connection && navigator.connection.saveData;
  if (reduce || saveData) return;

  function play() {
    var attempt = video.play();
    if (attempt && attempt.catch) attempt.catch(function () {});
  }

  video.muted = true;
  video.preload = "auto";
  // Watch the hero area, not the video: the video's frame starts fully
  // clipped by the opening wipe, which would read as "not on screen".
  var area = video.closest(".h-hero-visual") || video;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting && !document.hidden) play();
      else video.pause();
    }).observe(area);
  } else {
    play();
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) video.pause();
    else if (area.getBoundingClientRect().bottom > 0) play();
  });
})();
