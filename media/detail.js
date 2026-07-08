// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const TYPES = ['epic', 'story', 'task', 'bug', 'rework', 'decision', 'idea'];
  const PRIORITIES = ['low', 'medium', 'high', 'critical'];
  const EFFORT_LABELS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'];

  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'item') {
      render(message.item, message.milestones, message.verbs);
    } else if (message.type === 'loadError') {
      app.className = 'load-error';
      app.replaceChildren(text(message.message));
    }
  });

  function text(value) {
    return document.createTextNode(value);
  }

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    node.append(...children);
    return node;
  }

  function render(item, milestones, verbs) {
    app.className = '';
    const children = [];

    children.push(el('div', { className: 'item-id' }, text(item.id)));
    children.push(renderTitle(item));
    children.push(renderVerbs(item, verbs));
    children.push(renderFields(item, milestones));
    children.push(renderDescription(item));
    children.push(renderComments(item));

    app.replaceChildren(...children);
  }

  function renderTitle(item) {
    const row = el('div', { className: 'title-row' });
    const heading = el('h2', { title: 'Click to edit the title' }, text(item.title));
    heading.addEventListener('click', () => {
      const input = el('input', { value: item.title });
      const commit = () => {
        const value = input.value.trim();
        if (value && value !== item.title) {
          post({ type: 'edit', id: item.id, field: 'title', value });
        } else {
          row.replaceChildren(heading);
        }
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') row.replaceChildren(heading);
      });
      input.addEventListener('blur', commit);
      row.replaceChildren(input);
      input.focus();
      input.select();
    });
    row.append(heading);
    return row;
  }

  function renderVerbs(item, verbs) {
    const bar = el('div', { className: 'verbs' });
    bar.append(el('span', { className: 'status-badge' }, text(item.status)));
    for (const verb of verbs) {
      const button = el('button', { className: verb === 'close' ? 'primary' : '' }, text(verb));
      button.addEventListener('click', () => post({ type: 'verb', id: item.id, verb }));
      bar.append(button);
    }
    return bar;
  }

  function renderFields(item, milestones) {
    const grid = el('div', { className: 'field-grid' });

    grid.append(
      fieldLabel('Type'),
      select(TYPES, item.type, (value) => edit(item, 'type', value)),
      fieldLabel('Priority'),
      select(PRIORITIES, item.priority, (value) => edit(item, 'priority', value)),
      fieldLabel('Effort'),
      select(
        ['none', ...EFFORT_LABELS],
        item.effort ? (EFFORT_LABELS[item.effort - 1] ?? 'none') : 'none',
        (value) => edit(item, 'effort', value),
      ),
    );

    const milestoneOptions = ['none', ...milestones.map((m) => m.id)];
    const milestoneLabels = new Map(milestones.map((m) => [m.id, `${m.id} ${m.title}`]));
    grid.append(
      fieldLabel('Milestone'),
      select(
        milestoneOptions,
        item.milestone || 'none',
        (value) => edit(item, 'milestone', value),
        (value) => milestoneLabels.get(value) || value,
      ),
    );

    if (item.parent) {
      grid.append(fieldLabel('Parent'), el('span', {}, text(item.parent)));
    }
    if (Array.isArray(item.assignees) && item.assignees.length > 0) {
      grid.append(fieldLabel('Assignees'), el('span', {}, text(item.assignees.join(', '))));
    }
    return grid;
  }

  function fieldLabel(name) {
    return el('label', {}, text(name));
  }

  function select(options, current, onChange, labelFor) {
    const node = el('select');
    for (const option of options) {
      node.append(
        el(
          'option',
          { value: option, selected: option === current },
          text(labelFor ? labelFor(option) : option),
        ),
      );
    }
    node.addEventListener('change', () => onChange(node.value));
    return node;
  }

  function renderDescription(item) {
    const section = el('div', { className: 'section' });
    section.append(el('span', { className: 'section-label' }, text('Description')));
    const textarea = el('textarea', { rows: 8, value: item.description || '' });
    const actions = el('div', { className: 'section-actions' });
    const save = el('button', { className: 'primary' }, text('Save description'));
    save.addEventListener('click', () => {
      post({ type: 'edit', id: item.id, field: 'description', value: textarea.value });
    });
    actions.append(save);
    section.append(textarea, actions);
    return section;
  }

  function renderComments(item) {
    const section = el('div', { className: 'section' });
    const comments = Array.isArray(item.comments) ? item.comments : [];
    section.append(
      el('span', { className: 'section-label' }, text(`Comments (${comments.length})`)),
    );
    for (const comment of comments) {
      const date = comment.date ? comment.date.slice(0, 16).replace('T', ' ') : '';
      section.append(
        el(
          'div',
          { className: 'comment' },
          el('div', { className: 'comment-meta' }, text(`${comment.author} · ${date}`)),
          el('div', { className: 'comment-text' }, text(comment.text)),
        ),
      );
    }
    const textarea = el('textarea', { rows: 3, placeholder: 'Add a comment...' });
    const actions = el('div', { className: 'section-actions' });
    const add = el('button', {}, text('Comment'));
    add.addEventListener('click', () => {
      if (textarea.value.trim()) {
        post({ type: 'comment', id: item.id, text: textarea.value });
        textarea.value = '';
      }
    });
    actions.append(add);
    section.append(textarea, actions);
    return section;
  }

  function edit(item, field, value) {
    post({ type: 'edit', id: item.id, field, value });
  }

  function post(message) {
    vscode.postMessage(message);
  }
})();
