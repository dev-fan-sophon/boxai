const PAGES = [
  ["overview.html", "Overview", "overview"],
  ["agents.html", "Agents", "agents"],
  ["mcp.html", "MCP", "mcp"],
  ["skills.html", "Skills", "skills"],
  ["models.html", "Model Plaza", "models"],
  ["account.html", "Account", "account"],
  ["settings.html", "Settings", "settings"],
];

function currentPage() {
  return location.pathname.split("/").pop() || "overview.html";
}

function injectShell() {
  const page = currentPage();
  const nav = PAGES.map(([href, label, id]) => {
    const current = href === page ? ' aria-current="page"' : "";
    return `<a class="sidebar-item" data-box="gpui_kit::navigation::Sidebar" href="${href}"${current}>${label}</a>`;
  }).join("");
  const content = document.body.innerHTML;
  document.body.innerHTML = `
    <div class="shell" data-box="gpui_kit::navigation::Sidebar">
      <div class="shell-body">
        <aside class="sidebar">
          ${nav}
          <div class="sidebar-footer" data-box="gpui_kit::layout::Toolbar">
            <span class="avatar">F</span>
            <span class="label grow">fan</span>
            <span class="badge accent">pro</span>
          </div>
        </aside>
        <main class="page">${content}</main>
      </div>
      <footer class="status-bar" data-box="gpui_kit::layout::StatusBar">
        <span>https://you-box.com</span>
        <span class="ok">Connected</span>
      </footer>
    </div>`;
}

document.addEventListener("DOMContentLoaded", injectShell);
