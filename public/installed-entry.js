// Older installed shortcuts may still start at the presentation URL.
if (window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true) {
  document.documentElement.hidden = true;
  location.replace(new URL("app/", location.href).href);
}
