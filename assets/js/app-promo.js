/* DVATONE, the desktop-app promo page (11.10 r3c, Viktor point 10). Built by _src/build_app.py.
   - The looping interface preview in the app window: starts when the window is on screen (muted, inline, no sound), pauses
     off screen and in a hidden tab; with prefers-reduced-motion or Save-Data it never starts by itself (the still stays, the
     play button starts it). The still picture under it stays until the first frame plays, so nothing flashes.
   - The two download buttons («macOS» / «Windows») open the request form in a modal dialog with that system chosen. The form
     is the one card of the #request section, moved into the dialog while it is open and back when it closes, so there is a
     single form and what was typed stays. Without <dialog> support or without JS the buttons simply jump to #request.
   - The form itself is a normal [data-form] of the site: site.js validates and delivers it (no endpoint on the preview: the
     polite "could not send" line, never a fake success). */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- the looping preview ---------- */
  var v = $('[data-app-video]'), btn = $('[data-app-play]');
  if (v && btn) {
    var mm = function (q) { return window.matchMedia && matchMedia(q).matches; };
    var calm = mm('(prefers-reduced-motion: reduce)') || (navigator.connection && navigator.connection.saveData);
    var user = null;   // null: automatic; true / false: the visitor's own choice wins
    var seen = false, shown = false;
    var setBtn = function () {
      var on = !v.paused;
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
      var l = btn.getAttribute(on ? 'data-l-pause' : 'data-l-play'); $('.sr', btn).textContent = l; btn.setAttribute('title', l);
    };
    var play = function () {
      if (v.preload !== 'auto') v.preload = 'auto';
      var pr = v.play(); if (pr && pr.catch) pr.catch(function () { setBtn(); });
    };
    v.addEventListener('playing', function () { if (!shown) { shown = true; v.classList.add('is-live'); } setBtn(); });
    v.addEventListener('pause', setBtn);
    btn.hidden = false; setBtn();
    btn.addEventListener('click', function () { if (v.paused) { user = true; play(); } else { user = false; v.pause(); } });
    var want = function () { return user === true || (user === null && !calm); };
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (es) {
        seen = es[es.length - 1].isIntersecting;
        if (seen && want() && !document.hidden) play(); else if (!seen && !v.paused) v.pause();
      }, { threshold: 0.25 }).observe(v);
    } else if (want()) play();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (!v.paused) v.pause(); } else if (seen && want()) play();
    });
  }

  /* ---------- the request form: in a dialog from the download buttons ---------- */
  var dlg = $('#appDlg'), card = $('[data-app-card]'), home = $('[data-app-form-home]'), slot = $('[data-app-dlg-slot]');
  var pickOs = function (k) {
    $$('[data-app-os-in]').forEach(function (r) { r.checked = r.getAttribute('data-app-os-in') === k; });
  };
  var canDlg = !!(dlg && dlg.showModal && card && home && slot);
  var opener = null;
  var close = function () { if (dlg && dlg.open) dlg.close(); };
  if (canDlg) {
    dlg.addEventListener('close', function () {
      home.appendChild(card);   // the one form goes back to its section, with what was typed
      document.documentElement.classList.remove('apx-locked');
      if (opener && opener.focus) { try { opener.focus({ preventScroll: true }); } catch (e) { opener.focus(); } }
    });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });   // a click on the backdrop
    $$('[data-app-close]', dlg).forEach(function (b) { b.addEventListener('click', close); });
  }
  $$('[data-app-os]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var k = a.getAttribute('data-app-os');
      pickOs(k);
      if (!canDlg) return;   // the link to #request does the rest
      e.preventDefault();
      opener = a;
      slot.appendChild(card);
      document.documentElement.classList.add('apx-locked');
      dlg.showModal();
      var f = $('input[name="name"]', card);
      if (f && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) { try { f.focus({ preventScroll: true }); } catch (x) { f.focus(); } }
      else { dlg.scrollTop = 0; var x0 = $('[data-app-close]', dlg); if (x0) x0.focus(); }
    });
  });
  // a link from elsewhere with ?os=mac|win (the home teaser, the menu) chooses the system in the form on the page
  var m = /[?&]os=(mac|win)\b/.exec(location.search); if (m) pickOs(m[1]);
})();
