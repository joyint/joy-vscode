// @ts-check
// Minimal safe markdown renderer shared by the detail and board webviews.
// All input is HTML-escaped first; only tags produced here reach the DOM.
(function () {
  function escapeHtml(text) {
    return text
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function inline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    out = out.replace(/(^|[\s(])(@[\w.:@-]+)/g, '$1<span class="holo-token">$2</span>');
    return out;
  }

  /**
   * @param {string} text markdown source
   * @returns {HTMLElement} rendered container
   */
  function renderMarkdown(text) {
    const root = document.createElement('div');
    root.className = 'md';
    const lines = (text || '').split(/\r?\n/);
    const html = [];
    let listTag = null;
    let inCode = false;

    const closeList = () => {
      if (listTag) {
        html.push(`</${listTag}>`);
        listTag = null;
      }
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        closeList();
        html.push(inCode ? '</code></pre>' : '<pre><code>');
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        html.push(`${escapeHtml(line)}\n`);
        continue;
      }
      const heading = /^(#{1,4})\s+(.*)$/.exec(line);
      if (heading) {
        closeList();
        const level = heading[1].length + 2; // h3..h6 to stay below view headings
        html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }
      const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line);
      if (task) {
        if (listTag !== 'ul') {
          closeList();
          html.push('<ul>');
          listTag = 'ul';
        }
        const checked = task[1] !== ' ' ? ' checked' : '';
        html.push(
          `<li class="task"><input type="checkbox" disabled${checked}> ${inline(task[2])}</li>`,
        );
        continue;
      }
      const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
      if (bullet) {
        if (listTag !== 'ul') {
          closeList();
          html.push('<ul>');
          listTag = 'ul';
        }
        html.push(`<li>${inline(bullet[1])}</li>`);
        continue;
      }
      const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ordered) {
        if (listTag !== 'ol') {
          closeList();
          html.push('<ol>');
          listTag = 'ol';
        }
        html.push(`<li>${inline(ordered[1])}</li>`);
        continue;
      }
      const quote = /^>\s?(.*)$/.exec(line);
      if (quote) {
        closeList();
        html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
        continue;
      }
      closeList();
      if (line.trim().length > 0) {
        html.push(`<p>${inline(line)}</p>`);
      }
    }
    if (inCode) html.push('</code></pre>');
    closeList();
    root.innerHTML = html.join('');
    return root;
  }

  // @ts-ignore shared global for the webview scripts
  window.joyRenderMarkdown = renderMarkdown;
})();
