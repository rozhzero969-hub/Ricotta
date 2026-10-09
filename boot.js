/* Runs first, from the page head (a separate file so the page's security
   policy can forbid inline scripts). Marks when the splash appeared and loads
   the stylesheet and fonts without blocking the first paint; app.js waits
   for the "cssready" event before lifting the splash. Fonts: Sora (English),
   Noto Kufi Arabic (Kurdish and Arabic) and Manrope for the ricotta logo. */
window.__splashStart = performance.now();
/* Opened from the Home Screen on a phone or tablet: run as an app, not a web
   page. The page itself never scrolls; only the screen's content scrolls
   inside a frame that always fits the visible area (see style.css). */
(function(){
  var standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if(standalone && window.matchMedia && matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('app-shell');
})();
/* The loading screen wears the theme this phone showed last (style.css and
   the splash colours in index.html read html[data-theme]). */
(function(){
  try{
    var last = JSON.parse(localStorage.getItem('ricottaOrders:lastTheme') || 'null');
    if(typeof last === 'string' && /^[a-z]{3,12}$/.test(last) && last !== 'ricotta') document.documentElement.setAttribute('data-theme', last);
    var mode = JSON.parse(localStorage.getItem('ricottaOrders:darkMode') || 'null');
    if(mode === 'on' || (mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  }catch(e){}
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
  var fonts = sheet('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800&family=Noto+Kufi+Arabic:wght@400;500;600;700;800&family=Manrope:wght@800&display=swap', 'print', function(){ fonts.media = 'all'; });
})();
