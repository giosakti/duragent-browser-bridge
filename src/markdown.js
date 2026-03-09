// Minimal Markdown to HTML renderer for chat messages.
// Handles: bold, italic, inline code, code blocks, links, lists, paragraphs.

function renderMarkdown(text) {
  // Normalize line endings
  text = text.replace(/\r\n/g, "\n");

  // Split into blocks by blank lines
  const blocks = text.split(/\n{2,}/);
  const html = blocks.map(renderBlock).join("");
  return html;
}

function renderBlock(block) {
  block = block.trim();
  if (!block) return "";

  // Fenced code block (``` ... ```)
  if (block.startsWith("```")) {
    const lines = block.split("\n");
    const code = lines.slice(1, -1).join("\n");
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }

  // Check if all lines are list items
  const lines = block.split("\n");
  const isOrdered = lines.every((l) => /^\d+\.\s/.test(l.trim()));
  const isUnordered = lines.every((l) => /^[-*]\s/.test(l.trim()));

  if (isOrdered) {
    const items = lines
      .map((l) => `<li>${renderInline(l.replace(/^\d+\.\s/, ""))}</li>`)
      .join("");
    return `<ol>${items}</ol>`;
  }

  if (isUnordered) {
    const items = lines
      .map((l) => `<li>${renderInline(l.replace(/^[-*]\s/, ""))}</li>`)
      .join("");
    return `<ul>${items}</ul>`;
  }

  // Regular paragraph (join lines with <br> for single newlines)
  const rendered = lines.map(renderInline).join("<br>");
  return `<p>${rendered}</p>`;
}

function renderInline(text) {
  // Escape HTML first
  text = escapeHtml(text);

  // Code (backticks) — must come before bold/italic to avoid conflicts
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold + italic
  text = text.replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>");

  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Italic
  text = text.replace(/\*(.+?)\*/g, "<em>$1</em>");

  // Links [text](url)
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>'
  );

  return text;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
