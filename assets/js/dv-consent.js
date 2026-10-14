
(function () {
  var w = window, d = document, cfg = w.DV_ANALYTICS || {};
  if (!cfg.gtm && !cfg.ga) return;
  w.dataLayer = w.dataLayer || [];
  w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
  w.gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  var loaded = false;
  function load() {
    if (loaded) return;
    loaded = true;
    w.gtag('consent', 'update', { analytics_storage: 'granted' });
    var s = d.createElement('script');
    s.async = true;
    if (cfg.gtm) {
      w.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
      s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(cfg.gtm);
    } else {
      w.gtag('js', new Date());
      w.gtag('config', cfg.ga);
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.ga);
    }
    d.head.appendChild(s);
  }
  function get() { try { return localStorage.getItem('dvConsent'); } catch (e) { return null; } }
  function put(v) { try { localStorage.setItem('dvConsent', v); } catch (e) { } }
  var en = (d.documentElement.lang || '').toLowerCase().indexOf('en') === 0;
  var T = en
    ? { text: 'We use Google Analytics cookies to see which pages are useful. They are set only if you agree.', more: 'Privacy policy', yes: 'Accept', no: 'Decline' }
    : { text: 'Ми використовуємо файли cookie Google Analytics, щоб бачити, які сторінки корисні. Вони з’являються лише з вашої згоди.', more: 'Політика конфіденційності', yes: 'Погоджуюсь', no: 'Відмовитися' };
  var CSS = '#dvConsent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9000;max-width:560px;margin:0 auto;background:#191511;color:#faf7f2;' +
    'padding:16px 18px;display:grid;gap:12px;font:400 14px/1.5 Manrope,system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.35)}' +
    '#dvConsent p{margin:0}#dvConsent a{color:#e2c7a6}#dvConsent .dvc-b{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}' +
    '#dvConsent button{font:600 13px/1 Manrope,system-ui,sans-serif;letter-spacing:.04em;padding:12px 16px;min-height:44px;border:1px solid rgba(250,247,242,.45);' +
    'background:transparent;color:#faf7f2;cursor:pointer}#dvConsent button[data-v=granted]{background:#faf7f2;color:#191511;border-color:#faf7f2}' +
    '#dvConsent button:focus-visible,#dvConsent a:focus-visible{outline:2px solid #e2c7a6;outline-offset:2px}';
  function banner() {
    if (d.getElementById('dvConsent')) return;
    if (!d.getElementById('dvConsentCss')) {
      var st = d.createElement('style');
      st.id = 'dvConsentCss';
      st.textContent = CSS;
      d.head.appendChild(st);
    }
    var b = d.createElement('div');
    b.id = 'dvConsent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Cookies');
    b.innerHTML = '<p>' + T.text + ' <a href="privacy.html">' + T.more + '</a></p><div class="dvc-b"><button type="button" data-v="denied">' + T.no +
      '</button><button type="button" data-v="granted">' + T.yes + '</button></div>';
    d.body.appendChild(b);
    b.addEventListener('click', function (e) {
      var v = e.target && e.target.getAttribute && e.target.getAttribute('data-v');
      if (!v) return;
      put(v);
      b.parentNode.removeChild(b);
      if (v === 'granted') load();
    });
  }
  function start() {
    var v = get();
    if (v === 'granted') load();
    else if (v !== 'denied') banner();
  }
  if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', start); else start();
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('[data-cookie-settings]');
    if (a) { e.preventDefault(); banner(); }
  });
})();
