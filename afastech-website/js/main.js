// AFASTECH site — shared behaviour: mobile nav, current-page marking, footer year.
(function () {
  "use strict";

  // Mobile nav toggle
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.querySelector(".main-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // Mark current page in nav using body[data-page]
  var page = document.body.getAttribute("data-page");
  if (page) {
    document.querySelectorAll(".main-nav a[data-nav]").forEach(function (link) {
      if (link.getAttribute("data-nav") === page) {
        link.setAttribute("aria-current", "page");
      }
    });
  }

  // Footer year
  document.querySelectorAll("[data-year]").forEach(function (el) {
    el.textContent = new Date().getFullYear();
  });

  // Homepage feature carousel
  var carousel = document.querySelector("[data-home-carousel]");
  if (carousel) {
    var slides = Array.prototype.slice.call(carousel.querySelectorAll("[data-home-slide]"));
    var pagination = Array.prototype.slice.call(carousel.querySelectorAll("[data-carousel-go]"));
    var stage = carousel.querySelector(".home-carousel-stage");
    var currentLabel = carousel.querySelector("[data-carousel-current]");
    var pauseButton = carousel.querySelector("[data-carousel-pause]");
    var currentIndex = 0;
    var timer = null;
    var userPaused = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var pointerInside = false;
    var focusInside = false;
    var rotationDelay = 7000;

    function updatePausedState() {
      carousel.classList.toggle("is-paused", userPaused || pointerInside || focusInside);
      if (pauseButton) {
        pauseButton.textContent = userPaused ? "Play" : "Pause";
        pauseButton.setAttribute(
          "aria-label",
          userPaused ? "Start automatic slide rotation" : "Pause automatic slide rotation"
        );
      }
    }

    function stopRotation() {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function scheduleRotation() {
      stopRotation();
      if (userPaused || pointerInside || focusInside || document.hidden || slides.length < 2) return;
      timer = window.setTimeout(function () {
        showSlide((currentIndex + 1) % slides.length);
        scheduleRotation();
      }, rotationDelay);
    }

    function showSlide(index) {
      if (!Number.isInteger(index) || index < 0 || index >= slides.length) return;
      currentIndex = index;
      slides.forEach(function (slide, slideIndex) {
        var isActive = slideIndex === currentIndex;
        slide.hidden = false;
        slide.inert = !isActive;
        slide.classList.toggle("is-active", isActive);
        slide.setAttribute("aria-hidden", isActive ? "false" : "true");
      });
      pagination.forEach(function (button, buttonIndex) {
        button.setAttribute("aria-pressed", buttonIndex === currentIndex ? "true" : "false");
      });
      if (currentLabel) currentLabel.textContent = String(currentIndex + 1).padStart(2, "0");
    }

    function sizeStage() {
      if (!stage) return;
      var tallestSlide = 0;
      stage.style.minHeight = "0px";
      slides.forEach(function (slide) {
        var position = slide.style.position;
        var visibility = slide.style.visibility;
        slide.style.position = "relative";
        slide.style.visibility = "hidden";
        tallestSlide = Math.max(tallestSlide, slide.getBoundingClientRect().height);
        slide.style.position = position;
        slide.style.visibility = visibility;
      });
      stage.style.minHeight = Math.ceil(tallestSlide) + "px";
    }

    showSlide(currentIndex);
    carousel.classList.add("is-enhanced");
    updatePausedState();
    sizeStage();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(sizeStage);

    var resizeScheduled = false;
    window.addEventListener("resize", function () {
      if (resizeScheduled) return;
      resizeScheduled = true;
      window.requestAnimationFrame(function () {
        sizeStage();
        resizeScheduled = false;
      });
    });

    pagination.forEach(function (button) {
      button.addEventListener("click", function () {
        showSlide(Number(button.getAttribute("data-carousel-go")));
        scheduleRotation();
      });
    });

    var previousButton = carousel.querySelector("[data-carousel-previous]");
    var nextButton = carousel.querySelector("[data-carousel-next]");
    if (previousButton) {
      previousButton.addEventListener("click", function () {
        showSlide((currentIndex - 1 + slides.length) % slides.length);
        scheduleRotation();
      });
    }
    if (nextButton) {
      nextButton.addEventListener("click", function () {
        showSlide((currentIndex + 1) % slides.length);
        scheduleRotation();
      });
    }

    if (pauseButton) {
      pauseButton.addEventListener("click", function () {
        userPaused = !userPaused;
        updatePausedState();
        scheduleRotation();
      });
    }

    carousel.addEventListener("mouseenter", function () {
      pointerInside = true;
      updatePausedState();
      stopRotation();
    });
    carousel.addEventListener("mouseleave", function () {
      pointerInside = false;
      updatePausedState();
      scheduleRotation();
    });
    carousel.addEventListener("focusin", function () {
      focusInside = true;
      updatePausedState();
      stopRotation();
    });
    carousel.addEventListener("focusout", function (event) {
      if (carousel.contains(event.relatedTarget)) return;
      focusInside = false;
      updatePausedState();
      scheduleRotation();
    });
    document.addEventListener("visibilitychange", scheduleRotation);

    scheduleRotation();
  }
})();
