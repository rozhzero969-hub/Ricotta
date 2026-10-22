/* Runs first, from the page head (a separate file so the page's security
   policy can forbid inline scripts). Marks when the splash appeared and loads
   the stylesheet and fonts without blocking the first paint; app.js waits
   for the "cssready" event before lifting the splash. Text is Apple's system
   font (SF Pro and SF Arabic on Apple devices); Noto Kufi Arabic covers Kurdish
   and Arabic elsewhere, and Manrope draws the ricotta logo. */
window.__splashStart = performance.now();
/* Opened from the Home Screen, or inside the iPhone app, on a phone or tablet:
   run as an app, not a web page. The page itself never scrolls; only the
   screen's content scrolls inside a frame that always fits the visible area
   (see style.css). */
(function(){
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true || window.RICOTTA_NATIVE_SHELL === true;
  if(standalone && window.matchMedia && matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('app-shell');
})();
/* Light or dark before the first screen shows: the phone's setting unless Settings chose one. */
(function(){
  try{
    var mode = JSON.parse(localStorage.getItem('ricottaOrders:darkMode') || 'null');
    if(mode === 'on' || (mode !== 'off' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  }catch(e){}
  // On a phone the status bar (behind the time and battery) takes the theme's colour from the very
  // first frame: a Home Screen app may read it only as it opens (app.js syncAppearance keeps it current).
  var meta = document.querySelector('meta[name="theme-color"]');
  if(meta && window.matchMedia && matchMedia('(pointer: coarse)').matches) meta.content = document.documentElement.classList.contains('dark') ? '#000000' : '#F2F2F7';
})();
/* Text follows the iPhone's or iPad's text size (Settings > Display & Brightness > Text Size), like
   Apple's own apps. WebKit gives the chosen size as the -apple-system-body font (17px at the standard
   size); the app's text is sized in rem, so the root size scales all of it. It stays between 85% and
   135% (Apple's largest standard size) so every screen still fits. Computers keep the browser's size.
   Checked again whenever the app comes back to the front. */
(function(){
  if(!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || !(window.CSS && CSS.supports && CSS.supports('font', '-apple-system-body'))) return;
  function follow(){
    var probe = document.createElement('i');
    probe.style.font = '-apple-system-body';
    probe.style.position = 'absolute';
    document.documentElement.appendChild(probe);
    var px = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if(px > 0) document.documentElement.style.fontSize = (Math.min(Math.max(px / 17, .85), 1.35) * 100).toFixed(2) + '%';
  }
  follow();
  document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible') follow(); });
})();
(function(){
  function sheet(href, media, onload){
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    if(media) link.media = media;
    link.onload = onload;
    document.head.appendChild(link);
    return link;
  }
  sheet('style.css', null, function(){ window.__cssReady = true; document.dispatchEvent(new Event('cssready')); });
  sheet('fonts/fonts.css');
})();
