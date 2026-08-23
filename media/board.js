// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const COLUMNS = [
    { key: 'new', label: 'New', statuses: ['new'] },
    { key: 'open', label: 'Open', statuses: ['open'] },
    { key: 'in-progress', label: 'In progress', statuses: ['in-progress'] },
    { key: 'review', label: 'Review', statuses: ['review'] },
    { key: 'closed', label: 'Closed', statuses: ['closed'] },
    { key: 'deferred', label: 'Deferred', statuses: ['deferred'] },
  ];
  const PRIORITY_RANK = { extreme: 0, critical: 1, high: 2, medium: 3, low: 4 };
  const EFFORT_LABELS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'];

  const board = /** @type {HTMLElement} */ (document.getElementById('board'));
  const filterInput = /** @type {HTMLInputElement} */ (document.getElementById('filter'));
  const mineButton = /** @type {HTMLButtonElement} */ (document.getElementById('mine'));
  const sortSelect = /** @type {HTMLSelectElement} */ (document.getElementById('sort'));
  const directionButton = /** @type {HTMLButtonElement} */ (document.getElementById('direction'));
  const filterDimSelect = /** @type {HTMLSelectElement} */ (document.getElementById('filter-dim'));
  const filterValSelect = /** @type {HTMLSelectElement} */ (document.getElementById('filter-val'));

  let items = [];
  let member;
  let mineOnly = false;
  let descending = true;
  let filterDim = 'none';
  let filterVal = '';

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'board') {
      items = message.items;
      member = message.member;
      updateMineButton();
      rebuildFilterValues();
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
    directionButton.textContent = descending ? 'Desc' : 'Asc';
    render();
  });
  filterDimSelect.addEventListener('change', () => {
    filterDim = filterDimSelect.value;
    filterVal = '';
    rebuildFilterValues();
    render();
  });
  filterValSelect.addEventListener('change', () => {
    filterVal = filterValSelect.value;
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

  function effortLabel(effort) {
    return effort ? (EFFORT_LABELS[effort - 1] ?? String(effort)) : '';
  }

  function distinctFilterValues(dim) {
    const set = new Set();
    for (const item of items) {
      if (dim === 'type') {
        if (item.type) set.add(item.type);
      } else if (dim === 'effort') {
        const label = effortLabel(item.effort);
        if (label) set.add(label);
      } else if (dim === 'assignee') {
        (Array.isArray(item.assignees) ? item.assignees : []).forEach((entry) => {
          const name = typeof entry === 'string' ? entry : entry && entry.member;
          if (name) set.add(name);
        });
      }
    }
    const values = [...set];
    if (dim === 'effort') {
      values.sort((a, b) => EFFORT_LABELS.indexOf(a) - EFFORT_LABELS.indexOf(b));
    } else {
      values.sort();
    }
    return values;
  }

  // Repopulate the value dropdown from the values present on the board, keeping
  // the current selection when it still exists.
  function rebuildFilterValues() {
    if (filterDim === 'none') {
      filterVal = '';
      filterValSelect.disabled = true;
      filterValSelect.replaceChildren();
      return;
    }
    const values = distinctFilterValues(filterDim);
    if (!values.includes(filterVal)) filterVal = '';
    filterValSelect.disabled = false;
    filterValSelect.replaceChildren(
      el('option', { value: '' }, document.createTextNode('(all)')),
      ...values.map((value) => el('option', { value }, document.createTextNode(value))),
    );
    filterValSelect.value = filterVal;
  }

  function matchesDimensionFilter(item) {
    if (filterDim === 'none' || !filterVal) return true;
    if (filterDim === 'type') return item.type === filterVal;
    if (filterDim === 'effort') return effortLabel(item.effort) === filterVal;
    if (filterDim === 'assignee') {
      return (Array.isArray(item.assignees) ? item.assignees : []).some((entry) => {
        const name = typeof entry === 'string' ? entry : entry && entry.member;
        return name === filterVal;
      });
    }
    return true;
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

  /** Where each column body is scrolled to right now, by column key. */
  function captureScroll() {
    const positions = new Map();
    for (const node of board.querySelectorAll('.column[data-column]')) {
      const body = node.querySelector('.column-body');
      if (body) positions.set(node.dataset.column, body.scrollTop);
    }
    return { columns: positions, boardLeft: board.scrollLeft };
  }

  /** Put the reader back where they were. Every render replaces all columns,
   * so without this an edit in the sidebar sends long columns back to the top
   * and the next item has to be searched for again. Positions past the new
   * end are clamped by the browser, so a shrunken column just lands at its
   * bottom instead of jumping. */
  function restoreScroll(scroll) {
    for (const node of board.querySelectorAll('.column[data-column]')) {
      const body = node.querySelector('.column-body');
      const top = scroll.columns.get(node.dataset.column);
      if (body && top) body.scrollTop = top;
    }
    board.scrollLeft = scroll.boardLeft;
  }

  function render() {
    const scroll = captureScroll();
    const needle = filterInput.value.trim().toLowerCase();
    board.className = '';
    const columns = COLUMNS.map((column) => {
      const columnItems = items
        .filter((item) => column.statuses.includes(item.status))
        .filter((item) => matchesFilter(item, needle))
        .filter((item) => !mineOnly || assignedToMe(item))
        .filter(matchesDimensionFilter)
        .sort(compare);
      return renderColumn(column, columnItems);
    });
    board.replaceChildren(...columns);
    restoreScroll(scroll);
  }

  function renderColumn(column, columnItems) {
    const slim = columnItems.length === 0;
    const title = `${column.label} (${columnItems.length})`;
    const node = el('div', { className: slim ? 'column slim' : 'column' });
    // Names the column across renders, so its scroll position can be handed
    // from the old DOM to the new one.
    node.dataset.column = column.key;
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
