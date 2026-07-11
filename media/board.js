// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const COLUMNS = [
    { key: 'new', label: 'New', statuses: ['new'] },
    { key: 'open', label: 'Open', statuses: ['open', 'blocked'] },
    { key: 'in-progress', label: 'In progress', statuses: ['in-progress'] },
    { key: 'review', label: 'Review', statuses: ['review'] },
    { key: 'closed', label: 'Closed', statuses: ['closed'] },
    { key: 'deferred', label: 'Deferred', statuses: ['deferred'] },
  ];
  const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
  const EFFORT_LABELS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'];

  const board = /** @type {HTMLElement} */ (document.getElementById('board'));
  const filterInput = /** @type {HTMLInputElement} */ (document.getElementById('filter'));
  const mineButton = /** @type {HTMLButtonElement} */ (document.getElementById('mine'));
  const sortSelect = /** @type {HTMLSelectElement} */ (document.getElementById('sort'));
  const directionButton = /** @type {HTMLButtonElement} */ (document.getElementById('direction'));

  let items = [];
  let member;
  let mineOnly = false;
  let descending = true;

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'board') {
      items = message.items;
      member = message.member;
      updateMineButton();
      render();
    } else if (message.type === 'loadError') {
      board.className = 'empty load-error';
      board.replaceChildren(document.createTextNode(message.message));
    }
  });

  filterInput.addEventListener('input', render);
  sortSelect.addEventListener('change', render);
  mineButton.addEventListener('click', () => {
    if (!member) return;
    mineOnly = !mineOnly;
    mineButton.classList.toggle('active', mineOnly);
    render();
  });

  // The filter stays visible at all times for discoverability; it is only
  // disabled while we do not yet know who "me" is.
  function updateMineButton() {
    mineButton.disabled = !member;
    mineButton.title = member
      ? 'Show only items assigned to me'
      : 'Authenticate to filter by items assigned to you';
    if (!member && mineOnly) {
      mineOnly = false;
      mineButton.classList.remove('active');
    }
  }

  updateMineButton();
  directionButton.addEventListener('click', () => {
    descending = !descending;
    directionButton.textContent = descending ? 'desc' : 'asc';
    render();
  });

  function assignedToMe(item) {
    if (!member || !Array.isArray(item.assignees)) return false;
    return item.assignees.some((entry) => {
      const name = typeof entry === 'string' ? entry : entry && entry.member;
      return name === member;
    });
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    node.append(...children);
    return node;
  }

  function matchesFilter(item, needle) {
    if (!needle) return true;
    return (
      item.id.toLowerCase().includes(needle) || item.title.toLowerCase().includes(needle)
    );
  }

  function sortValue(item, field) {
    switch (field) {
      case 'priority':
        return PRIORITY_RANK[item.priority] ?? 99;
      case 'effort':
        return item.effort ?? (descending ? -1 : 99);
      case 'created':
      case 'updated':
        return item[field] || '';
      case 'title':
        return item.title.toLowerCase();
      case 'type':
        return item.type;
      default:
        return item.id;
    }
  }

  function compare(a, b) {
    const field = sortSelect.value;
    const va = sortValue(a, field);
    const vb = sortValue(b, field);
    let delta;
    if (typeof va === 'number' && typeof vb === 'number') {
      delta = va - vb;
    } else {
      delta = String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    }
    if (delta === 0) {
      delta = a.id < b.id ? -1 : 1;
    }
    return descending ? -delta : delta;
  }

  function render() {
    const needle = filterInput.value.trim().toLowerCase();
    board.className = '';
    const columns = COLUMNS.map((column) => {
      const columnItems = items
        .filter((item) => column.statuses.includes(item.status))
        .filter((item) => matchesFilter(item, needle))
        .filter((item) => !mineOnly || assignedToMe(item))
        .sort(compare);
      return renderColumn(column, columnItems);
    });
    board.replaceChildren(...columns);
  }

  function renderColumn(column, columnItems) {
    const slim = columnItems.length === 0;
    const title = `${column.label} (${columnItems.length})`;
    const node = el('div', { className: slim ? 'column slim' : 'column' });
    if (slim) {
      node.append(el('div', { className: 'slim-title' }, document.createTextNode(title)));
    } else {
      const body = el('div', { className: 'column-body' });
      for (const item of columnItems) {
        body.append(renderCard(item));
      }
      node.append(
        el('div', { className: 'column-header' }, document.createTextNode(title)),
        body,
      );
    }

    node.addEventListener('dragover', (event) => {
      event.preventDefault();
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', () => node.classList.remove('drop-target'));
    node.addEventListener('drop', (event) => {
      event.preventDefault();
      node.classList.remove('drop-target');
      const id = event.dataTransfer?.getData('text/plain');
      if (!id) return;
      const item = items.find((entry) => entry.id === id);
      if (!item || column.statuses.includes(item.status)) return;
      vscode.postMessage({ type: 'move', id, current: item.status, target: column.key });
    });
    return node;
  }

  function renderCard(item) {
    const meta = el('div', { className: 'card-meta' });
    meta.append(el('span', { className: `tag type-${item.type}` }, document.createTextNode(item.type)));
    meta.append(el('span', {}, document.createTextNode(item.id)));
    meta.append(
      el(
        'span',
        { className: `prio-${item.priority}` },
        document.createTextNode(item.priority),
      ),
    );
    if (item.effort) {
      meta.append(
        el(
          'span',
          { className: `effort effort-${item.effort}` },
          document.createTextNode(EFFORT_LABELS[item.effort - 1] ?? String(item.effort)),
        ),
      );
    }

    const card = el(
      'div',
      { className: 'card', draggable: true, title: 'Drag to move, click to open' },
      el('div', { className: 'card-title' }, document.createTextNode(item.title)),
      meta,
    );
    card.addEventListener('dragstart', (event) => {
      card.classList.add('dragging');
      event.dataTransfer?.setData('text/plain', item.id);
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
    card.addEventListener('click', () => {
      vscode.postMessage({ type: 'open', id: item.id });
    });
    return card;
  }
})();
