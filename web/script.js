/* T2G CRM landing — lightweight interactions (no dependencies) */
(function () {
  'use strict';

  // Scroll-reveal sections
  var sections = document.querySelectorAll('.section');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  } else {
    sections.forEach(function (s) { s.classList.add('in'); });
  }

  // Shrink header shadow on scroll
  var header = document.querySelector('.site-header');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 8) header.style.boxShadow = '0 6px 24px rgba(16,40,28,.07)';
    else header.style.boxShadow = 'none';
  }, { passive: true });

  // FAQ accordion — keep only one open at a time (better UX)
  var faqs = document.querySelectorAll('.faq-item');
  faqs.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (item.open) {
        faqs.forEach(function (other) { if (other !== item) other.open = false; });
      }
    });
  });
})();
