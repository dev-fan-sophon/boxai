// Product policy around upstream pages. Sessions remain the local history;
// Usage is exclusively the authoritative BoxAI account response.
if (window.bootPrefs?.boxaiOnly) {
document.body.classList.add("boxai-product");
// The header and routing stages share this SVG definition.
$("#bird").outerHTML = '<image id="bird" href="icons/magpie.svg" width="44" height="44"/>';
magpie.plugin("boxai-account", (ctx) => {
  ctx.slots.add("page", {
    key: "account", title: "Account",
    open: () => boxai.loadAccount(), relang: () => boxai.loadAccount(),
  });
});
const accountNav = el("button");
accountNav.dataset.view = "account";
accountNav.append(el("span", "", t("Account")));
accountNav.onclick = () => show("account");
$("#nav").append(accountNav);
$("#nav [data-view='providers']")?.remove();
$("#nav [data-view='masking']")?.remove();
// Session-history consent is independent of the disabled masking settings.
const sessionReadsList = $("#sessionReadsList");
$("#setPage-general").append(sessionReadsList.previousElementSibling, sessionReadsList);
Object.assign(magpie.page("usage"), {
  open: () => boxai.loadUsage(), refresh: () => boxai.loadUsage(),
  reload: () => boxai.loadUsage(), relang: () => boxai.loadUsage(),
  mount() {}, costs() {}, leave() {}, tab: () => "usage",
});
// These upstream functions are also invoked by focus/poll callbacks.
loadUsage = () => boxai.loadUsage();
refreshUsage = () => boxai.authenticated && view === "usage" ? boxai.loadUsage() : Promise.resolve();
renderRedact = () => {};
}
