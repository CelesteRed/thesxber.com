import { markdownToHtml } from "./markdown.js";

export default function MarkdownText({ value }) {
  return <span className="markdown-text" dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} />;
}
