function markdownToHtml(value) {
  const escaped = String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
  return escaped
    .replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+?)\*/g, "<em>$1</em>")
    .replace(/~~([\s\S]+?)~~/g, "<s>$1</s>")
    .replace(/`([^`\n]+?)`/g, "<code>$1</code>")
    .replace(/__([\s\S]+?)__/g, "<u>$1</u>")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br />");
}

export default function MarkdownText({ value }) {
  return <span className="markdown-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}

