// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  const TYPES = ['epic', 'story', 'task', 'bug', 'rework', 'decision', 'idea'];
  const PRIORITIES = ['low', 'medium', 'high', 'critical'];
  const EFFORT_LABELS = ['xxs', 'xs', 's', 'm', 'l', 'xl', 'xxl'];

  const app = /** @type {HTMLElement} */ (document.getElementById('app'));

  /**
   * Unsaved edits per item id: { comment, description, editingDescription }.
   * Kept across item switches and external refreshes; also mirrored into
   * webview state so a hidden/restored view keeps them.
   */
  const drafts = new Map(Object.entries(vscode.getState()?.drafts ?? {}));

  function saveDrafts() {
    vscode.setState({ drafts: Object.fromEntries(drafts) });
  }

  function draftFor(id) {
    if (!drafts.has(id)) {
      drafts.set(id, { comment: '', description: undefined, editingDescription: false });
    }
    return drafts.get(id);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'item') {
      render(
        message.item,
        message.milestones,
        message.members,
        message.items,
        message.statuses,
        message.canDelete,
      );
    } else if (message.type === 'cleared') {
      app.className = 'empty';
      app.replaceChildren(text('Select an item in the Backlog view.'));
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

  function memberName(entry) {
    return typeof entry === 'string' ? entry : entry && entry.member ? entry.member : '';
  }

  function render(item, milestones, members, items, statuses, canDelete) {
    app.className = '';
    const children = [
      el('div', { className: 'item-id' }, text(item.id)),
      renderTitle(item),
      renderStatusControl(item, statuses),
      renderFields(item, milestones),
      renderAssignees(item, members),
      renderDependencies(item, items),
      renderDescription(item),
      renderComments(item),
      renderFooter(item),
    ];
    if (canDelete) {
      children.push(renderDelete(item));
    }
    app.replaceChildren(...children);
  }

  function formatTimestamp(ts) {
    return ts ? ts.slice(0, 16).replace('T', ' ') : '';
  }

  function metaLine(label, who, when) {
    let line = label;
    if (who) line += ` by ${who}`;
    if (when) line += ` on ${formatTimestamp(when)}`;
    return line;
  }

  function renderFooter(item) {
    const footer = el('div', { className: 'detail-footer' });
    if (item.created || item.created_by) {
      footer.append(el('div', {}, text(metaLine('Created', item.created_by, item.created))));
    }
    if ((item.updated_by || item.updated) && item.updated !== item.created) {
      footer.append(el('div', {}, text(metaLine('Updated', item.updated_by, item.updated))));
    }
    return footer;
  }

  function renderDelete(item) {
    const section = el('div', { className: 'section danger-zone' });
    const button = el('button', { className: 'delete-button' }, text('Delete item'));
    button.addEventListener('click', () =>
      post({ type: 'delete', id: item.id, title: item.title }),
    );
    section.append(button);
    return section;
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

  function renderStatusControl(item, statuses) {
    const bar = el('div', { className: 'status-control' });
    for (const status of statuses) {
      const current = status === item.status;
      const button = el(
        'button',
        { className: current ? 'status-segment current' : 'status-segment', disabled: current },
        text(status),
      );
      button.addEventListener('click', () =>
        post({ type: 'setStatus', id: item.id, current: item.status, target: status }),
      );
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
      const remove = el(
        'button',
        { className: 'chip-remove', title: 'Remove parent' },
        text('×'),
      );
      remove.addEventListener('click', () =>
        post({ type: 'edit', id: item.id, field: 'parent', value: 'none' }),
      );
      grid.append(
        fieldLabel('Parent'),
        el('span', { className: 'parent-value' }, text(item.parent), remove),
      );
    }
    return grid;
  }

  function renderAssignees(item, members) {
    const section = el('div', { className: 'section' });
    section.append(el('span', { className: 'section-label' }, text('Assignees')));

    const assigned = (Array.isArray(item.assignees) ? item.assignees : [])
      .map(memberName)
      .filter(Boolean);

    const chips = el('div', { className: 'assignee-chips' });
    for (const member of assigned) {
      const remove = el('button', { className: 'chip-remove', title: `Unassign ${member}` }, text('×'));
      remove.addEventListener('click', () => post({ type: 'unassign', id: item.id, member }));
      chips.append(
        el(
          'span',
          { className: 'assignee-chip' },
          el('span', { className: 'holo-token' }, text(`@${member}`)),
          remove,
        ),
      );
    }

    const addable = (members || []).filter((member) => !assigned.includes(member));
    if (addable.length > 0) {
      const picker = el('select', { className: 'assignee-add' });
      picker.append(el('option', { value: '', selected: true }, text('Add assignee...')));
      for (const member of addable) {
        picker.append(el('option', { value: member }, text(member)));
      }
      picker.addEventListener('change', () => {
        if (picker.value) {
          post({ type: 'assign', id: item.id, member: picker.value });
        }
      });
      chips.append(picker);
    }

    section.append(chips);
    return section;
  }

  function renderDependencies(item, items) {
    const section = el('div', { className: 'section' });
    section.append(el('span', { className: 'section-label' }, text('Dependencies')));

    const catalog = Array.isArray(items) ? items : [];
    const titleById = new Map(catalog.map((entry) => [entry.id, entry.title]));
    const deps = (Array.isArray(item.deps) ? item.deps : []).filter(Boolean);

    const chips = el('div', { className: 'assignee-chips' });
    for (const dep of deps) {
      const label = titleById.has(dep) ? `${dep} ${titleById.get(dep)}` : dep;
      const remove = el(
        'button',
        { className: 'chip-remove', title: `Remove dependency ${dep}` },
        text('×'),
      );
      remove.addEventListener('click', () => post({ type: 'depRemove', id: item.id, dep }));
      chips.append(
        el(
          'span',
          { className: 'assignee-chip' },
          el('span', { className: 'dep-token' }, text(label)),
          remove,
        ),
      );
    }

    if (deps.length === 0) {
      chips.append(el('span', { className: 'placeholder' }, text('None.')));
    }

    const addable = catalog.filter((entry) => entry.id !== item.id && !deps.includes(entry.id));
    if (addable.length > 0) {
      const picker = el('select', { className: 'assignee-add' });
      picker.append(el('option', { value: '', selected: true }, text('Add dependency...')));
      for (const entry of addable) {
        picker.append(el('option', { value: entry.id }, text(`${entry.id} ${entry.title}`)));
      }
      picker.addEventListener('change', () => {
        if (picker.value) {
          post({ type: 'depAdd', id: item.id, dep: picker.value });
        }
      });
      chips.append(picker);
    }

    section.append(chips);
    return section;
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
    const draft = draftFor(item.id);
    const header = el('span', { className: 'section-label' }, text('Description'));
    section.append(header);

    if (!draft.editingDescription) {
      // @ts-ignore provided by markdown.js
      const rendered = window.joyRenderMarkdown(item.description || '');
      if (!item.description) {
        rendered.append(el('p', { className: 'placeholder' }, text('No description.')));
      }
      const actions = el('div', { className: 'section-actions' });
      const editButton = el('button', {}, text('Edit'));
      editButton.addEventListener('click', () => {
        draft.editingDescription = true;
        draft.description = draft.description ?? item.description ?? '';
        saveDrafts();
        section.replaceWith(renderDescription(item));
      });
      actions.append(editButton);
      section.append(rendered, actions);
      return section;
    }

    const textarea = el('textarea', { rows: 10, value: draft.description ?? item.description ?? '' });
    textarea.addEventListener('input', () => {
      draft.description = textarea.value;
      saveDrafts();
    });
    const actions = el('div', { className: 'section-actions' });
    const cancel = el('button', {}, text('Cancel'));
    cancel.addEventListener('click', () => {
      draft.editingDescription = false;
      draft.description = undefined;
      saveDrafts();
      section.replaceWith(renderDescription(item));
    });
    const save = el('button', { className: 'primary' }, text('Save'));
    save.addEventListener('click', () => {
      draft.editingDescription = false;
      draft.description = undefined;
      saveDrafts();
      post({ type: 'edit', id: item.id, field: 'description', value: textarea.value });
    });
    actions.append(cancel, save);
    section.append(textarea, actions);
    return section;
  }

  function renderComments(item) {
    const section = el('div', { className: 'section' });
    const draft = draftFor(item.id);
    const comments = Array.isArray(item.comments) ? item.comments : [];
    section.append(
      el('span', { className: 'section-label' }, text(`Comments (${comments.length})`)),
    );
    for (const comment of comments) {
      const date = comment.date ? comment.date.slice(0, 16).replace('T', ' ') : '';
      const meta = el('div', { className: 'comment-meta' });
      meta.append(
        el('span', { className: 'holo-token' }, text(`@${comment.author.split(' ')[0]}`)),
        text(` · ${date}`),
      );
      // @ts-ignore provided by markdown.js
      const body = window.joyRenderMarkdown(comment.text || '');
      body.classList.add('comment-text');
      section.append(el('div', { className: 'comment' }, meta, body));
    }
    const textarea = el('textarea', {
      rows: 3,
      placeholder: 'Add a comment... (markdown)',
      value: draft.comment || '',
    });
    textarea.addEventListener('input', () => {
      draft.comment = textarea.value;
      saveDrafts();
    });
    const actions = el('div', { className: 'section-actions' });
    const add = el('button', {}, text('Comment'));
    add.addEventListener('click', () => {
      if (textarea.value.trim()) {
        post({ type: 'comment', id: item.id, text: textarea.value });
        draft.comment = '';
        saveDrafts();
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
