// Mount upstream pages only after the BoxAI session has been verified.
if (window.bootPrefs?.boxaiOnly) boxai.start();
else {
  document.body.classList.remove("boxai-locked");
  $("#loginGate").hidden = true;
  magpie.start();
  navHides();
  const views = ["providers", "plugins", "settings", ...magpie.pages()];
  let first = params.get("view");
  if (!first) { try { first = localStorage.getItem("magpie.lastView") || ""; } catch {} }
  if (mode === "window" && views.includes(first)) show(first).then(() => view === "plugins" && params.has("q") && window.pluginQuery?.(params.get("q")));
  else if (mode === "window" && !gatewayMode && !sideNav()) slide($("#nav"), "nav");
  if (gatewayMode) setGatewayMode(true);
  load();
}
