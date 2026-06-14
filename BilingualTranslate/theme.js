// Applies saved appearance prefs to <html> before paint (avoids flash).
// Loaded in <head> of every extension page. Prefs live in localStorage
// (synchronous, shared across extension pages):
//   vimiTheme  = light | dark | system
//   vimiZoom   = "0.95" | "1" | "1.1" | "1.2"  (UI text/size scale)
(function () {
  try {
    var t = localStorage.getItem("vimiTheme") || "system";
    var dark =
      t === "dark" ||
      (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);

    var z = localStorage.getItem("vimiZoom");
    if (z) document.documentElement.style.zoom = z;
  } catch (e) {}
})();
