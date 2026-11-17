/* DOM-only presentation state. Simulation data and actions remain in C++. */
(() => {
  // Avida retains state across absent modes and empty selections. Empirical handles the DOM.
  const stateSelector = 'details[id], #org_genome_list, .org-stats-inspector, '
    + '.freezer-inspector, .configuration-inspector, .configuration-content, '
    + '#organism_genome_list, #organism_memory, #organism_stacks, #organism_stack_panel';
  const capture = root => {
    const saved = emp.CaptureDOMState(root, 14, stateSelector, '#organism_memory');
    return (saved?.states || []).map(state => ({...state,
      expanded: state.id === 'organism_stack_panel'
        ? document.getElementById(state.id).dataset.expanded : undefined
    }));
  };
  const restore = (root, states) => {
    if (!root) return;
    // Stack expansion changes scroll limits, so apply it before restoring scroll positions.
    for (const state of states) {
      if (state.expanded === undefined) continue;
      const node = document.getElementById(state.id);
      if (node && root.contains(node)) node.dataset.expanded = state.expanded;
    }
    emp.RestoreDOMState(root, {states});
  };
  const focusState = root => emp.CaptureDOMState(root, 1, ':scope', ':scope')?.focus;
  const restoreFocus = focus => emp.RestoreDOMState(document.documentElement, {states: [], focus});
  const patchHTML = (root, html) => {
    if (!root) return;
    const states = capture(root), focus = focusState(root);
    emp.PatchHTML(root, html, 0, ':scope', ':scope');
    restore(root, states);
    restoreFocus(focus);
  };
  let inspector = [], page = [], focused = null, inspectorFocus = null;
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
  // The document stays mounted when Empirical rebuilds the population widgets (including
  // the first Play). Fullscreening a canvas/card instead would exit as soon as it is replaced.
  let populationFullscreen = false, populationBrowserFullscreen = false;
  let populationScroll = [0, 0], populationFrame = null, populationResizeFrame = 0;
  const fitPopulation = () => {
    const frame = document.getElementById('canvas_frame');
    const canvas = document.getElementById('population_canvas');
    if (!frame || !canvas) return;
    if (populationFullscreen) {
      const width = Number(canvas.dataset.gridWidth), height = Number(canvas.dataset.gridHeight);
      const scale = Math.min((frame.clientWidth - 4) / width, (frame.clientHeight - 4) / height);
      frame.style.setProperty('--fullscreen-population-width', `${Math.max(1, width * scale)}px`);
      frame.style.setProperty('--fullscreen-population-height', `${Math.max(1, height * scale)}px`);
    }
    window.AvidaInterface?.redrawPopulation?.();
  };
  const schedulePopulationFit = () => {
    if (populationResizeFrame) return;
    populationResizeFrame = requestAnimationFrame(() => {
      populationResizeFrame = 0;
      fitPopulation();
    });
  };
  const populationSizeObserver = new ResizeObserver(schedulePopulationFit);
  const updateFullscreenButton = () => {
    const button = document.getElementById('population_fullscreen_button');
    if (!button) return;
    const label = populationFullscreen ? 'Exit full screen' : 'Enter full screen';
    button.setAttribute('aria-label', label); button.title = label;
    button.setAttribute('aria-pressed', String(populationFullscreen));
  };
  const setPopulationFullscreen = active => {
    if (active === populationFullscreen) return;
    if (active) populationScroll = [window.scrollX, window.scrollY];
    populationFullscreen = active;
    document.documentElement.classList.toggle('population-fullscreen', active);
    updateFullscreenButton();
    schedulePopulationFit();
    if (!active) {
      document.getElementById('population_fullscreen_button')?.focus({preventScroll: true});
      window.scrollTo(...populationScroll);
    }
  };
  const exitPopulationFullscreen = () => {
    setPopulationFullscreen(false);
    if (populationBrowserFullscreen && document.fullscreenElement === document.documentElement) {
      document.exitFullscreen().catch(() => {});
    }
    populationBrowserFullscreen = false;
  };
  const mountPopulationFullscreen = () => {
    const frame = document.getElementById('canvas_frame');
    if (frame !== populationFrame) {
      populationSizeObserver.disconnect(); populationFrame = frame;
      if (frame) populationSizeObserver.observe(frame);
    }
    if (!frame && populationFullscreen) exitPopulationFullscreen();
    updateFullscreenButton();
    if (populationFullscreen) schedulePopulationFit();
  };
  document.addEventListener('click', event => {
    if (!event.target.closest?.('#population_fullscreen_button')) return;
    if (populationFullscreen) { exitPopulationFullscreen(); return; }
    setPopulationFullscreen(true);
    const root = document.documentElement;
    if (document.fullscreenEnabled && root.requestFullscreen) {
      populationBrowserFullscreen = true;
      root.requestFullscreen().catch(() => {
        // Browsers/embeds that block native fullscreen still get a viewport-filling view.
        populationBrowserFullscreen = false;
      });
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (populationBrowserFullscreen && !document.fullscreenElement) {
      populationBrowserFullscreen = false;
      setPopulationFullscreen(false);
    }
    schedulePopulationFit();
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !populationFullscreen) return;
    event.preventDefault(); exitPopulationFullscreen();
  });
  window.addEventListener('resize', schedulePopulationFit);
  let legendHeight = 0, legendWidth = 0, legendKey = '', legendSmallerSince = null;
  let legendUpdate = 0, legendRunning = false;
  const stabilizeLegend = (update = legendUpdate, running = legendRunning) => {
    const reset = update < legendUpdate;
    legendUpdate = update; legendRunning = running;
    const body = document.getElementById('population_legend_body');
    const content = document.getElementById('population_color_legend');
    if (!body || !content || !document.getElementById('legend_disclosure')?.open) return;
    const {height, width} = content.getBoundingClientRect();
    const key = document.getElementById('population_color_mode')?.value + ':'
      + document.getElementById('population_color_task')?.value;
    // Measure the natural inner content, independently of the outer reserved space.
    // Width/color changes and restarts establish a fresh baseline.
    if (!running || reset || key !== legendKey || Math.abs(width - legendWidth) > 1
        || height >= legendHeight) {
      legendHeight = height; legendSmallerSince = null;
    } else {
      if (legendSmallerSince === null) legendSmallerSince = update;
      if (update - legendSmallerSince >= 1000) {
        legendHeight = height; legendSmallerSince = null;
      }
    }
    legendWidth = width; legendKey = key;
    body.style.minHeight = running ? `${legendHeight}px` : '';
  };
  window.addEventListener('resize', () => stabilizeLegend());
  const configurationHelp = () => {
    const root = document.getElementById('configuration_inspector');
    if (!root) return;
    const descriptions = {
      scheduled_events: 'Schedule pauses and resource changes at run start, run end, or selected updates. Add an event, choose when it runs, and select its action. Add a resource pool in Environment before scheduling resource changes.\n\nBefore the run starts, new events default to a pause at update 10,000. After the run starts, new events default to pausing 1,000 updates from now. Existing events can be edited while the run is paused. A warning marks elapsed schedules: past actions are not replayed, but future interval repetitions still run. Elapsed events remain in saved configurations for future runs.',
      resource_pools: 'Resource pools are shared supplies that can limit the rewards organisms receive for performing tasks. Give each pool a name, choose its starting amount, and set its inflow and outflow. All organisms draw from the same pool.\n\nEach update first removes the outflow fraction, then adds the inflow amount. Assign a pool to a reaction to make its reward depend on how much resource it consumes. An empty pool gives no reward. Events can set or adjust a pool during a run; Population shows current amounts and Graphs shows their history.\n\nEdit the environment while paused, including after startup. Existing pools retain their current quantities, even when renamed; new pools use their initial amounts. Inflow and outflow changes take effect at the next update. Use an event to change the current amount directly.',
      reactions: 'Reactions connect a computational task to a change in an organism’s traits, such as increasing its merit. Choose the task, the affected trait, the operation, and the reward value. The trigger limit controls how many executions are rewarded per gestation; zero means unlimited.\n\nA reaction without a resource pool applies its full reward. With a pool, it requests the selected fraction of the available resource: Multiply uses the reward value raised to the units consumed, while Add uses the reward value times the units consumed. An empty pool provides no reward. This lets organisms compete for resources by performing tasks. Add byproduct creates an output resource and a conversion ratio: units produced per unit of input consumed. Multiple byproducts are allowed.\n\nChanges made while paused affect subsequent task executions. Existing earned rewards and task counts remain unchanged; trigger limits still use the current gestation’s task counts.',
      name: 'The resource name used to connect a reaction or event to this resource pool.',
      initial: 'The starting quantity for a new pool or a new run. Editing this value after startup does not reset an existing pool’s current amount; use a resource event to change that amount.',
      inflow: 'The quantity added to this resource pool per update.',
      outflow: 'The fraction removed from this resource pool per update, from 0 to 1.',
      task: 'The computational task that triggers this reaction when an organism performs it.',
      trait: 'The organism trait modified by this reaction.',
      operation: 'How the reward modifies the selected trait: for example, adding to or multiplying its value.',
      value: 'The reward value applied when this reaction triggers.',
      max_triggers: 'The maximum rewarded executions per gestation. Zero means no limit.',
      resource: 'The shared resource pool consumed by this reaction. Without a pool the reward is not resource limited.',
      byproduct_ratio: 'Units added to the byproduct pool per unit of input resource actually consumed. A reaction must have an input resource. Zero consumption or an exhausted trigger limit produces no byproducts. Multiple outputs are allowed; repeated output pools receive the sum of their contributions.',
      substitution_prob: 'Set the probability of substituting each genome instruction during reproduction, from 0 to 1 inclusive. Zero disables substitutions. The new probability applies to subsequent reproduction after the event fires.',
      fraction: 'The requested fraction of the pool consumed when the reaction triggers, from 0 to 1.',
      resource_fraction: 'The requested fraction of the pool consumed when the reaction triggers, from 0 to 1.',
      timing: 'At start runs once when the experiment starts, before its first update.\n\nAt update runs once at the specified update.\n\nAt intervals repeats from Start, every specified number of updates, through the final update you set. Through = 0 means continue until the run ends.\n\nAt end runs once when the experiment finishes; it does not run each time you pause. Update events run after resource inflow and outflow.',
      start: 'For At update, this is the update at which the action runs once. For At intervals, this is the first scheduled update. Later executions occur at Start + Every, Start + 2 × Every, and so on. Use At start for an action that should happen during experiment startup.',
      interval: 'The number of updates between repeated executions, starting from Start. For example, Start = 100 and Every = 50 schedules updates 100, 150, 200, and so on, up to Through. The interval must be at least 1.',
      stop: 'The last update at which a repeated event may run, inclusive. The action runs there only if it falls on the interval schedule. Set Through to 0 to keep repeating until the experiment ends.',
      command: 'The Avida command executed when the event fires. Imported configurations can contain commands beyond the actions offered here; those commands are preserved.',
      action: 'Pause stops evolution at the scheduled point so you can inspect the population and resume when ready.\n\nSet resource replaces a pool’s current amount with the specified nonnegative quantity. Adjust resource adds the specified number of units; a negative change removes units, stopping at zero. Add a pool in Environment to make these actions available.\n\nSet substitution prob changes the per-instruction mutation probability for subsequent reproduction; use a value from 0 to 1, including zero.\n\nImported configurations may also contain other Avida commands. These remain listed so their behavior is preserved.',
      event_resource: 'Choose the existing resource pool this event will change. Set resource replaces its amount; Adjust resource adds or removes units. Define pools in Environment before scheduling changes. Update events run after the normal inflow and outflow.',
      amount: 'For Set resource, enter the new nonnegative total in the pool. For Adjust resource, enter the number of units to add; use a negative value to remove units. Removal stops at zero. For example, setting 100 replaces the total with 100, while adjusting by 100 adds 100 to the existing total.',
      preset: 'A preset replaces the environment resources and reactions with the selected template. Selecting a preset only previews it: the environment will not be altered until you click Load environment.\n\nLoading replaces reactions and resource pools. Events for removed pools are also removed; other settings and events are kept. You can edit the result below. After startup, pause first: matching pools retain their current amounts and new pools use their initial amounts.'
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
      if (control.id.includes('byproduct_') && control.id.endsWith('_ratio')) key = 'byproduct_ratio';
      if (control.id.includes('byproduct_') && control.id.endsWith('_resource')) key = 'byproduct_ratio';
      if (control.id.startsWith('event_resource_')) key = 'event_resource';
      let text = description?.textContent.trim() || descriptions[key]
        || (control.id.includes('preset') ? descriptions.preset : control.title)
        || `Set ${label.textContent.trim().toLowerCase()} for the current experiment.`;
      if (control.id === 'environment_preset') text += '\n\n' + (document.getElementById('environment_preset_description')?.textContent.trim() || '');
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
    stabilizeLegend,
    patchOrganism(html) {
      patchHTML(document.getElementById('organism_mode_content'), html);
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
        else page.push({id, scroll: [0, 0], open: expanded});
      }
    },
    patchLegend(html, update, running) {
      // Retain the summary node so a redraw between pointerdown and click cannot
      // swallow the user's toggle during Play or fast-forward.
      patchHTML(document.getElementById('population_color_legend'), html);
      stabilizeLegend(update, running);
    },
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
      mountPopulationFullscreen();
      stabilizeLegend();
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
  document.addEventListener('change', event => {
    if (event.target.id !== 'population_color_mode' && event.target.id !== 'population_color_task') return;
    const legend = document.getElementById('legend_disclosure');
    if (legend) legend.open = true;
  }, true);
  document.addEventListener('toggle', event => {
    if (event.target.id === 'legend_more') {
      // Explicit expansion/collapse should resize immediately, even during a run.
      legendHeight = 0; legendSmallerSince = null;
      stabilizeLegend();
    }
    if (event.target.open && (event.target.id === 'legend_disclosure' || event.target.id === 'population_statistics_disclosure' || event.target.id === 'organism_statistics_disclosure'
        || event.target.dataset.lazy === 'true')) window.AvidaInterface.refresh?.();
  }, true);
  document.addEventListener('keydown', event => {
    const target = event.target;
    if (target?.id === 'population_canvas') {
      const width = Number(target.dataset.gridWidth), height = Number(target.dataset.gridHeight);
      const current = Math.max(0, Number(target.dataset.activeCell || 0));
      let next = current;
      if (target.dataset.cellShape === 'circle') {
        next = window.avidaPopulationGeometry.moveCircle(target, current, event.key);
        if (next === null) return;
      }
      else if (target.dataset.cellShape === 'hex') {
        next = window.avidaPopulationGeometry.move(current, width, height, event.key, event.shiftKey);
        if (next === null) return;
      }
      else if (event.key === 'ArrowLeft') next = Math.max(0, current - 1);
      else if (event.key === 'ArrowRight') next = Math.min(width * height - 1, current + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, current - width);
      else if (event.key === 'ArrowDown') next = Math.min(width * height - 1, current + width);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = width * height - 1;
      else return;
      event.preventDefault(); window.AvidaInterface.select?.(next);
    }
    const populationTypes = target?.closest('#population_type_picker');
    if (populationTypes && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
      const choices = [...populationTypes.querySelectorAll('button:not(:disabled)')];
      let index = choices.indexOf(target);
      if (index < 0 || !choices.length) return;
      index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : choices.length - 1)) % choices.length;
      event.preventDefault(); choices[index].focus(); choices[index].click();
      return;
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
