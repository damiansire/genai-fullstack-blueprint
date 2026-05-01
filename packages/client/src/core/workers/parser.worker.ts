/// <reference lib="webworker" />

/**
 * Web Worker for heavy parsing operations.
 * Offloads Markdown and Code Diff parsing from the main thread to improve INP.
 */

addEventListener('message', ({ data }) => {
  const { type, payload } = data;

  if (type === 'PARSE_MARKDOWN') {
    // Simulate heavy Markdown parsing / syntax highlighting
    const parsedHtml = parseMarkdown(payload);
    postMessage({ type: 'MARKDOWN_PARSED', payload: parsedHtml });
  }

  if (type === 'CALCULATE_DIFF') {
    // Simulate diff calculation (e.g. comparing AI code vs user code)
    const diff = calculateDiff(payload.original, payload.modified);
    postMessage({ type: 'DIFF_CALCULATED', payload: diff });
  }
});

function parseMarkdown(rawText: string): string {
  // Simple stub for markdown parsing logic
  let html = rawText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  return html;
}

function calculateDiff(oldText: string, newText: string): any {
  // Simple stub for text diffing logic
  return {
    added: newText.length > oldText.length,
    charsChanged: Math.abs(newText.length - oldText.length)
  };
}
