// Accessibility tree snapshot for the browser bridge.

const IGNORED_ROLES = new Set([
  "none", "generic", "InlineTextBox", "LineBreak",
]);

const INTERACTIVE_ROLES = new Set([
  "button", "checkbox", "combobox", "link", "listbox", "menu",
  "menubar", "menuitem", "menuitemcheckbox", "menuitemradio",
  "option", "radio", "scrollbar", "searchbox", "slider",
  "spinbutton", "switch", "tab", "textbox", "tree", "treeitem",
]);

// Map from ref string ("e0") -> backendDOMNodeId (for M2 click resolution)
let refMap = new Map();

async function takeSnapshot(tabId, mode = "interactive") {
  const { nodes: axNodes } = await cdpSend(tabId, "Accessibility.getFullAXTree");

  refMap = new Map();
  const result = [];
  let refCounter = 0;

  for (const node of axNodes) {
    const role = node.role?.value || "";
    const name = node.name?.value || "";
    const focused = (node.properties || []).some(
      (p) => p.name === "focused" && p.value?.value === true
    );

    // Skip ignored roles
    if (IGNORED_ROLES.has(role)) continue;

    // Apply mode filter
    if (mode === "interactive" && !INTERACTIVE_ROLES.has(role)) continue;
    if (mode === "text" && !name) continue;
    // "full" mode: include everything not in IGNORED_ROLES

    const ref = `e${refCounter++}`;
    refMap.set(ref, node.backendDOMNodeId);

    const entry = { ref, role };
    if (name) entry.name = name;
    if (node.value?.value) entry.value = node.value.value;
    if (focused) entry.focused = true;

    result.push(entry);
  }

  // Find focused ref
  const focusedEntry = result.find((n) => n.focused);

  return {
    nodes: result,
    focusedRef: focusedEntry?.ref || null,
  };
}
