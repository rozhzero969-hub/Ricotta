/* Runs first, from the page head (a separate file so the page's security
   policy can forbid inline scripts). Marks when the splash appeared and loads
   the stylesheet and fonts without blocking the first paint; app.js waits
   for the "cssready" event before lifting the splash. */
window.__splashStart = performance.now();
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
  var fonts = sheet('https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Vazirmatn:wght@500;600;700;800&display=swap', 'print', function(){ fonts.media = 'all'; });
})();
