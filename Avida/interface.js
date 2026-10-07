/* DOM-only presentation state. Simulation data and actions remain in C++. */
(() => {
  const capture = root => {
    if (!root) return [];
    return [root, ...root.querySelectorAll('details[id], #org_genome_list, '
      + '.org-stats-inspector, .freezer-inspector, .configuration-inspector, .configuration-content, '
      + '#organism_genome_list, #organism_memory, #organism_stacks, #organism_stack_panel')]
      .map(element => ({
      id: element.id, top: element.scrollTop, left: element.scrollLeft,
      open: element.tagName === 'DETAILS' ? element.open : undefined,
      expanded: element.id === 'organism_stack_panel' ? element.dataset.expanded : undefined,
      height: element.id === 'organism_memory' ? element.style.height : undefined
    }));
  };
  const restore = (root, state) => {
    if (!root) return;
    for (const item of state) {
      const element = document.getElementById(item.id);
      if (!element || !root.contains(element)) continue;
      if (item.open !== undefined) element.open = item.open;
      if (item.expanded !== undefined) element.dataset.expanded = item.expanded;
      if (item.height) element.style.height = item.height;
      element.scrollTop = item.top; element.scrollLeft = item.left;
    }
  };
  const focusState = root => {
    const active = document.activeElement;
    return root?.contains(active) ? {
      id: active.id || active.closest('[id]')?.id,
      summary: active.tagName === 'SUMMARY'
    } : null;
  };
  const restoreFocus = state => {
    let target = state?.id && document.getElementById(state.id);
    if (target && state.summary) target = target.querySelector(':scope > summary');
    if (target && !target.disabled && target.getClientRects().length) target.focus({preventScroll:true});
  };
  // Keep existing nodes (including scroll, focus, resized memory, and disclosures) when only
  // execution values changed. IDs keep growing genomes and filtered task rows aligned.
  const patch = (current, next) => {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
      current.replaceWith(next.cloneNode(true)); return;
    }
    if (current.nodeType === Node.TEXT_NODE) {
      if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return;
    for (const attr of [...current.attributes]) {
      if ((current.tagName === 'DETAILS' && attr.name === 'open')
          || (current.id === 'organism_stack_panel' && attr.name === 'data-expanded')
          || (current.id === 'organism_memory' && attr.name === 'style')) continue;
      if (!next.hasAttribute(attr.name)) current.removeAttribute(attr.name);
    }
    for (const attr of next.attributes) {
      if (current.id === 'organism_stack_panel' && attr.name === 'data-expanded') continue;
      if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
    }
    const oldChildren = [...current.childNodes];
    const keyed = new Map(oldChildren.filter(n => n.nodeType === 1 && n.id).map(n => [n.id,n]));
    let index = 0;
    for (const child of [...next.childNodes]) {
      let existing = current.childNodes[index];
      if (child.nodeType === 1 && child.id) {
        const match = keyed.get(child.id);
        if (match && match !== existing) { current.insertBefore(match, existing || null); existing = match; }
        else if (!match && existing?.id !== child.id) {
          current.insertBefore(child.cloneNode(true), existing || null); ++index; continue;
        }
      }
      if (!existing) current.append(child.cloneNode(true));
      else patch(existing, child);
      ++index;
    }
    while (current.childNodes.length > index) current.lastChild.remove();
    if (current.tagName === 'SELECT' && current.value !== next.value) current.value = next.value;
  };
  let inspector = [], legend = [], page = [], focused = null, inspectorFocus = null;
  let freezerSearch = '', freezerSort = 'newest', previewedConfiguration = null;
  document.addEventListener('click', event => {
    const expand = event.target.closest?.('[data-stack-expand]');
    const collapse = event.target.closest?.('[data-stack-collapse]');
    if (!expand && !collapse) return;
    const panel = document.getElementById('organism_stack_panel');
    if (!panel) return;
    panel.dataset.expanded = expand ? 'true' : 'false';
    const nextFocus = expand ? panel.querySelector('[data-stack-collapse]')
      : panel.querySelector('[data-stack-expand]') || panel;
    nextFocus?.focus({preventScroll:true});
  });
  const filterFreezer = () => {
    const search = document.getElementById('freezer_search');
    const sort = document.getElementById('freezer_sort');
    if (!search || !sort) return;
    freezerSearch = search.value; freezerSort = sort.value;
    for (const list of document.querySelectorAll('.freezer-list')) {
      const rows = [...list.querySelectorAll('.freezer-item')];
      const name = row => row.querySelector('.freezer-item-name')?.textContent.trim() || '';
      rows.sort((a,b) => freezerSort === 'name' ? name(a).localeCompare(name(b))
        : Number(b.id.split('_').pop()) - Number(a.id.split('_').pop()));
      rows.forEach(row => {
        row.hidden = !name(row).toLocaleLowerCase().includes(freezerSearch.toLocaleLowerCase());
        list.append(row);
      });
    }
  };
  const updateGenomeScrollHint = () => {
    const list = document.getElementById('org_genome_list');
    const hint = document.querySelector('#org_genome .genome-scroll-hint');
    if (hint && list) hint.hidden = list.scrollWidth <= list.clientWidth + 1;
  };
  window.addEventListener('resize', updateGenomeScrollHint);
  let observedHeader = null, headerSize = '';
  const fitHeader = () => {
    const header = document.getElementById('primary_header');
    const identity = document.getElementById('product_identity');
    const nav = document.getElementById('mode_buttons');
    if (!header || !identity || !nav) return;
    const size = [header.clientWidth, nav.getBoundingClientRect().width,
      getComputedStyle(document.documentElement).fontSize].join(':');
    if (size === headerSize) return;
    headerSize = size;
    identity.hidden = window.matchMedia('(max-width: 760px)').matches;
    if (identity.hidden) return;
    const title = identity.querySelector('.product-title');
    const version = identity.querySelector('.product-version');
    // Keep the preferred size until wrapping to two lines no longer suffices.
    const fits = scale => {
      identity.style.setProperty('--identity-scale', scale);
      return title.scrollHeight <= 2 * parseFloat(getComputedStyle(title).lineHeight) + 1
        && title.scrollWidth <= title.clientWidth + 1
        && version.scrollWidth <= version.clientWidth + 1;
    };
    if (fits(1)) return;
    let low = 2 / 3, high = 1;
    if (!fits(low)) { identity.hidden = true; return; }
    for (let i = 0; i < 8; ++i) {
      const middle = (low + high) / 2;
      if (fits(middle)) low = middle;
      else high = middle;
    }
    identity.style.setProperty('--identity-scale', low);
  };
  let headerFrame = 0;
  const headerObserver = new ResizeObserver(() => {
    if (!headerFrame) headerFrame = requestAnimationFrame(() => {
      headerFrame = 0; fitHeader();
    });
  });
  const observeHeader = () => {
    const header = document.getElementById('primary_header');
    if (header !== observedHeader) {
      headerObserver.disconnect();
      observedHeader = header; headerSize = '';
      if (header) {
        headerObserver.observe(header);
        headerObserver.observe(document.getElementById('mode_buttons'));
      }
    }
    fitHeader();
  };
  document.fonts.ready.then(() => { headerSize = ''; fitHeader(); });
  let freezerRatio = null, freezerDivider = null;
  const freezerSizeObserver = new ResizeObserver(() => freezerDivider?.updateValue());
  const resizeFreezer = () => {
    const divider = document.getElementById('freezer_divider');
    if (divider === freezerDivider) return;
    freezerSizeObserver.disconnect();
    freezerDivider = divider;
    if (!divider) return;
    const workspace = divider.parentElement;
    const grid = document.getElementById('population_card');
    const limits = () => ({min: 260, max: Math.max(260, workspace.clientWidth - 340)});
    divider.updateValue = () => {
      const width = workspace.clientWidth, range = limits();
      divider.setAttribute('aria-valuemin', Math.round(100 * range.min / width));
      divider.setAttribute('aria-valuemax', Math.round(100 * range.max / width));
      const percent = Math.round(100 * grid.getBoundingClientRect().width / width);
      divider.setAttribute('aria-valuenow', percent);
      divider.setAttribute('aria-valuetext', `Population ${percent}% of the workspace`);
    };
    const setWidth = width => {
      const range = limits();
      freezerRatio = Math.min(range.max, Math.max(range.min, width)) / workspace.clientWidth;
      workspace.style.setProperty('--freezer-grid-width', `${100 * freezerRatio}%`);
      divider.updateValue();
    };
    if (freezerRatio !== null) workspace.style.setProperty('--freezer-grid-width', `${100 * freezerRatio}%`);
    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault(); divider.focus(); divider.setPointerCapture(event.pointerId);
      document.body.classList.add('resizing-freezer');
    });
    divider.addEventListener('pointermove', event => {
      if (!divider.hasPointerCapture(event.pointerId)) return;
      setWidth(workspace.getBoundingClientRect().right - event.clientX - 10);
    });
    const endResize = () => document.body.classList.remove('resizing-freezer');
    divider.addEventListener('lostpointercapture', endResize);
    divider.addEventListener('pointerup', event => {
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      endResize();
    });
    divider.addEventListener('keydown', event => {
      const step = workspace.clientWidth * (event.shiftKey ? .1 : .02);
      const current = grid.getBoundingClientRect().width;
      const next = {ArrowLeft: current + step, ArrowRight: current - step,
        Home: limits().min, End: limits().max}[event.key];
      if (next === undefined) return;
      event.preventDefault(); setWidth(next);
    });
    divider.addEventListener('dblclick', () => {
      freezerRatio = null; workspace.style.removeProperty('--freezer-grid-width'); divider.updateValue();
    });
    freezerSizeObserver.observe(workspace);
    freezerSizeObserver.observe(grid);
    divider.updateValue();
  };
  const configurationHelp = () => {
    const root = document.getElementById('configuration_inspector');
    if (!root) return;
    const descriptions = {
      scheduled_events: 'Schedule pauses and resource changes at run start, run end, or selected updates. Add an event, choose when it runs, and select its action. Add a resource pool in Environment before scheduling resource changes.\n\nBefore the run starts, new events default to a pause at update 10,000. After the run starts, new events default to pausing 1,000 updates from now. Existing events can be edited while the run is paused.',
      resource_pools: 'Resource pools are shared supplies that can limit the rewards organisms receive for performing tasks. Give each pool a name, choose its starting amount, and set its inflow and outflow. All organisms draw from the same pool.\n\nEach update first removes the outflow fraction, then adds the inflow amount. Assign a pool to a reaction to make its reward depend on how much resource it consumes. An empty pool gives no reward. Events can set or adjust a pool during a run; Population shows current amounts and Graphs shows their history.',
      reactions: 'Reactions connect a computational task to a change in an organism’s traits, such as increasing its merit. Choose the task, the affected trait, the operation, and the reward value. The trigger limit controls how many executions are rewarded per gestation; zero means unlimited.\n\nA reaction without a resource pool applies its full reward. With a pool, it requests the selected fraction of the available resource: Multiply uses the reward value raised to the units consumed, while Add uses the reward value times the units consumed. An empty pool provides no reward. This lets organisms compete for resources by performing tasks.',
      name: 'The resource name used to connect a reaction or event to this resource pool.',
      initial: 'The starting quantity in this resource pool.',
      inflow: 'The quantity added to this resource pool per update.',
      outflow: 'The fraction removed from this resource pool per update, from 0 to 1.',
      task: 'The computational task that triggers this reaction when an organism performs it.',
      trait: 'The organism trait modified by this reaction.',
      operation: 'How the reward modifies the selected trait: for example, adding to or multiplying its value.',
      value: 'The reward value applied when this reaction triggers.',
      max_triggers: 'The maximum rewarded executions per gestation. Zero means no limit.',
      resource: 'The shared resource pool consumed by this reaction. Without a pool the reward is not resource limited.',
      fraction: 'The requested fraction of the pool consumed when the reaction triggers, from 0 to 1.',
      resource_fraction: 'The requested fraction of the pool consumed when the reaction triggers, from 0 to 1.',
      timing: 'At start runs once when the experiment starts, before its first update.\n\nAt update runs once at the specified update.\n\nAt intervals repeats from Start, every specified number of updates, through the final update you set. Through = 0 means continue until the run ends.\n\nAt end runs once when the experiment finishes; it does not run each time you pause. Update events run after resource inflow and outflow.',
      start: 'For At update, this is the update at which the action runs once. For At intervals, this is the first scheduled update. Later executions occur at Start + Every, Start + 2 × Every, and so on. Use At start for an action that should happen during experiment startup.',
      interval: 'The number of updates between repeated executions, starting from Start. For example, Start = 100 and Every = 50 schedules updates 100, 150, 200, and so on, up to Through. The interval must be at least 1.',
      stop: 'The last update at which a repeated event may run, inclusive. The action runs there only if it falls on the interval schedule. Set Through to 0 to keep repeating until the experiment ends.',
      command: 'The Avida command executed when the event fires. Imported configurations can contain commands beyond the actions offered here; those commands are preserved.',
      action: 'Pause stops evolution at the scheduled point so you can inspect the population and resume when ready.\n\nSet resource replaces a pool’s current amount with the specified nonnegative quantity. Adjust resource adds the specified number of units; a negative change removes units, stopping at zero. Add a pool in Environment to make these actions available.\n\nImported configurations may also contain other Avida commands. These remain listed so their behavior is preserved.',
      event_resource: 'Choose the existing resource pool this event will change. Set resource replaces its amount; Adjust resource adds or removes units. Define pools in Environment before scheduling changes. Update events run after the normal inflow and outflow.',
      amount: 'For Set resource, enter the new nonnegative total in the pool. For Adjust resource, enter the number of units to add; use a negative value to remove units. Removal stops at zero. For example, setting 100 replaces the total with 100, while adjusting by 100 adds 100 to the existing total.',
      preset: 'A preset replaces the environment resources and reactions with the selected template. Selecting a preset only previews it: the environment will not be altered until you click Load environment.'
    };
    const copyParagraphs = (container, text) => {
      for (const part of text.split('\n\n')) {
        const paragraph = document.createElement('p'); paragraph.textContent = part; container.append(paragraph);
      }
    };
    for (const label of root.querySelectorAll('label[for], [data-configuration-help]')) {
      if (label.parentElement.classList.contains('configuration-field-heading')) continue;
      const section = label.dataset.configurationHelp;
      const control = section ? label : document.getElementById(label.htmlFor);
      if (!control) continue;
      const field = section ? null : label.closest('.configuration-setting, .structured-configuration-field') || label.parentElement;
      const description = field?.querySelector('.configuration-description');
      let key = section || control.id.replace(/^(resource|reaction|event)_/, '').replace(/_\d+$/, '');
      if (control.id.startsWith('event_resource_')) key = 'event_resource';
      const text = description?.textContent.trim() || descriptions[key]
        || (control.id.includes('preset') ? descriptions.preset : control.title)
        || `Set ${label.textContent.trim().toLowerCase()} for the current experiment.`;
      const title = label.textContent.trim().replace(/\*$/, '').trim();
      if (description) description.hidden = true;
      const help = document.createElement('div');
      help.id = control.id + '_help'; help.className = 'configuration-help-copy';
      help.hidden = true; copyParagraphs(help, text);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'configuration-info'; button.textContent = 'i';
      button.setAttribute('aria-label', 'About ' + title);
      button.setAttribute('aria-controls', help.id); button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const opening = button.getAttribute('aria-expanded') !== 'true';
        for (const other of root.querySelectorAll('.configuration-info')) other.setAttribute('aria-expanded', 'false');
        for (const other of root.querySelectorAll('.configuration-help-copy')) other.hidden = true;
        button.setAttribute('aria-expanded', String(opening)); help.hidden = !opening;
        const panel = document.getElementById('configuration_help_panel');
        panel.replaceChildren();
        const heading = document.createElement('h3'); heading.textContent = opening ? title : 'Configuration guide';
        panel.append(heading);
        copyParagraphs(panel, opening ? text : 'Select the circled i beside an option to view its explanation.');
      });
      const heading = document.createElement('div');
      heading.className = 'configuration-field-heading';
      label.before(heading);
      heading.append(label, button);
      if (section) heading.after(help);
      else field.append(help);
    }
  };
  window.AvidaInterface = {
    patchOrganism(html) {
      const root = document.getElementById('organism_mode_content');
      if (!root) return;
      const focused = focusState(root);
      const template = document.createElement('template');
      template.innerHTML = html;
      const next = root.cloneNode(false);
      next.append(template.content);
      patch(root, next);
      if (document.activeElement === document.body) restoreFocus(focused);
    },
    preserveInspector() {
      const root = document.getElementById('org_stats_inspector');
      // An empty selection temporarily removes the sections. Retain their disclosure choices
      // so selecting another organism reopens the inspector without expanding every subsection.
      const saved = new Map(inspector.map(item => [item.id, item]));
      for (const item of capture(root)) saved.set(item.id, item);
      inspector = [...saved.values()]; inspectorFocus = focusState(root);
    },
    restoreInspector() {
      restore(document.getElementById('org_stats_inspector'), inspector);
      restoreFocus(inspectorFocus);
      updateGenomeScrollHint();
    },
    filterFreezer,
    setPopulationPanels(open) {
      const states = [['legend_disclosure', open], ['population_statistics_disclosure', open]];
      if (!open) states.push(['organism_statistics_disclosure', true]);
      for (const [id, expanded] of states) {
        const element = document.getElementById(id);
        if (element) element.open = expanded;
        const saved = page.find(item => item.id === id);
        if (saved) saved.open = expanded;
        else page.push({id, top:0, left:0, open: expanded});
      }
    },
    preserveLegend() { legend = capture(document.getElementById('population_color_legend')); },
    restoreLegend() { restore(document.getElementById('population_color_legend'), legend); },
    refresh: null,
    preservePage() {
      const saved = new Map(page.map(item => [item.id, item]));
      for (const item of capture(document.getElementById('avida_app'))) saved.set(item.id, item);
      page = [...saved.values()];
      focused = focusState(document.getElementById('avida_app'));
    },
    restorePage() {
      restore(document.getElementById('avida_app'), page);
      restoreFocus(focused);
      const search = document.getElementById('freezer_search');
      const sort = document.getElementById('freezer_sort');
      if (search) search.value = freezerSearch;
      if (sort) sort.value = freezerSort;
      filterFreezer();
      configurationHelp();
      updateGenomeScrollHint();
      observeHeader();
      resizeFreezer();
      const preview = document.getElementById('configuration_preview');
      if (preview && preview.dataset.configurationId !== previewedConfiguration) {
        previewedConfiguration = preview.dataset.configurationId;
        preview.focus({preventScroll: true}); preview.scrollIntoView({block: 'nearest'});
      } else if (!preview && previewedConfiguration !== null) {
        document.getElementById('view_frozen_configuration_' + previewedConfiguration)?.focus({preventScroll: true});
        previewedConfiguration = null;
      }
    },
    select: null
  };
  document.addEventListener('toggle', event => {
    if (event.target.open && (event.target.id === 'legend_disclosure' || event.target.id === 'population_statistics_disclosure' || event.target.id === 'organism_statistics_disclosure'
        || event.target.dataset.lazy === 'true')) window.AvidaInterface.refresh?.();
  }, true);
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target?.id === 'population_canvas') {
      const width = Number(target.dataset.gridWidth), height = Number(target.dataset.gridHeight);
      const current = Math.max(0, Number(target.dataset.activeCell || 0));
      let next = current;
      if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
      else if (event.key === 'ArrowRight') next = Math.min(width * height - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - width);
      else if (event.key === 'ArrowDown') next = Math.min(width * height - 1, current + width);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = width * height - 1;
      else return;
      event.preventDefault(); window.AvidaInterface.select?.(next);
    }
    const tabs = target?.closest('#mode_buttons, #configuration_tabs');
    if (!tabs || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
    const buttons = [...tabs.querySelectorAll('button')];
    let index = buttons.indexOf(target);
    if (index < 0) return;
    index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    event.preventDefault(); buttons[index].focus(); buttons[index].click();
  });
})();
