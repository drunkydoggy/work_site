const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function element(id = '') {
  const classes = new Set();
  const listeners = {};
  return {
    id, value:'', textContent:'', innerHTML:'', dataset:{}, open:false,
    classList:{
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      contains: name => classes.has(name),
      toggle(name, on = !classes.has(name)) {
        if (on) classes.add(name); else classes.delete(name);
        return on;
      }
    },
    addEventListener(name, fn) { (listeners[name] ||= []).push(fn); },
    dispatch(name, event) { for (const fn of listeners[name] || []) fn(event); },
    focus() { this.focused = true; },
    setAttribute() {},
    removeAttribute() {},
    toggleAttribute() {}
  };
}

async function createApp(storage = new Map()) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(m => [m[1], element(m[1])]));
  const filters = ['id', 'title', 'speaker', 'duration', 'to'].map(key => {
    const input = element(); input.dataset.flt = key; return input;
  });
  const timers = new Map(), requests = [];
  let timerId = 0, confirmed = true, confirmCount = 0;
  const context = vm.createContext({
    console,
    document:{
      getElementById: id => {
        assert.ok(elements.has(id), `Unknown element: ${id}`);
        return elements.get(id);
      },
      querySelectorAll(selector) {
        if (selector === '[data-flt]') return filters;
        if (selector === '.page') return ['run', 'setup', 'templates'].map(p => elements.get('page-' + p));
        return [];
      },
      addEventListener() {}
    },
    window:{ addEventListener() {}, scrollTo() {} },
    location:{ hash:'#run' },
    localStorage:{ getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    setInterval() {},
    setTimeout(fn, delay) { timers.set(++timerId, { fn, delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    confirm() { confirmCount++; return confirmed; },
    async fetch(url, options = {}) {
      requests.push({ url, ...options });
      return { ok:true, json:async () => options.method === 'PUT' ? { rev:1 } : { rev:0, state:null } };
    }
  });
  const bridge = `
globalThis.app = {
  get state() { return state; }, get meeting() { return M(); },
  get imports() { return { rows:impRows, en:impRaw.en, fr:impRaw.fr }; },
  get draft() { return { dlg, files }; },
  seedTransient() {
    impRaw.en = [{ inc:true, title:'Old English' }];
    impRaw.fr = [{ inc:true, title:'Ancien français' }];
    mergeImport(); renderImport();
    editing.add(M().agenda[0].id); flt.title = 'Old';
    dlg = { ctx:{ item:M().agenda[0] } }; files = [{ name:'old.docx', size:10 }];
  },
  setParser(parser) { parseDocx = parser; },
  importFile, renderRun
};
`;
  vm.runInContext(script.replace(/\}\)\(\);\s*$/, bridge + '\n})();'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {
    app:context.app, context, storage, elements, filters, requests,
    setConfirmed(value) { confirmed = value; },
    get confirmCount() { return confirmCount; },
    click(id, act) {
      const button = { dataset:{ act }, closest:() => null };
      elements.get(id).dispatch('click', {
        target:{ closest:selector => selector === '[data-act]' ? button : null },
        stopPropagation() {}
      });
    },
    async flushSave() {
      for (const [id, timer] of timers) {
        if (timer.delay === 300) { timers.delete(id); await timer.fn(); }
      }
    }
  };
}

function seedMeeting(harness, status = 'active') {
  const { app } = harness;
  app.meeting.agenda = [
    { id:'old', title:'Old item', title_fr:'Ancien point', status:'done', startedAt:1, duration:5 },
    { id:'last', title:'Adjourned', status, startedAt:2, duration:0 }
  ];
  app.meeting.chair = 'Chair';
  app.meeting.to = 'team@example.test';
  app.meeting.cc = 'copy@example.test';
  app.state.undo = { meeting:app.meeting.id, snap:[{ id:'old', status:'pending' }] };
  app.renderRun();
}

test('End meeting clears session data, opens upload, and persists without changing reusable settings', async () => {
  const h = await createApp();
  seedMeeting(h);
  const { app, elements } = h;
  const before = JSON.parse(JSON.stringify(app.state));
  app.seedTransient();
  h.filters.forEach(input => input.value = 'Old');
  for (const id of ['new-title', 'new-speaker', 'paste', 'e-to', 'e-cc', 'e-subj', 'e-body', 'imp-st-en', 'imp-st-fr']) {
    elements.get(id).value = 'Old'; elements.get(id).textContent = 'Old';
  }
  elements.get('import-panel').classList.add('hidden');
  assert.match(elements.get('run-status').innerHTML, /data-act="end-meeting"/);
  h.click('page-run', 'end-meeting');
  assert.equal(app.meeting.agenda.length, 0);
  assert.equal(app.meeting.endedAt, null);
  assert.equal(app.state.undo, null);
  const expected = before.meetings[0];
  expected.agenda = []; expected.endedAt = null;
  assert.deepEqual(JSON.parse(JSON.stringify(app.meeting)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.templates)), before.templates);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.members)), before.members);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.meetings.slice(1))), before.meetings.slice(1));
  for (const rows of Object.values(app.imports)) assert.equal(rows.length, 0);
  assert.equal(app.draft.dlg, null);
  assert.equal(app.draft.files.length, 0);
  assert.equal(elements.get('imp-out').innerHTML, '');
  for (const lang of ['en', 'fr']) assert.equal(elements.get('imp-st-' + lang).textContent, '');
  for (const id of ['new-title', 'new-speaker', 'paste', 'e-to', 'e-cc', 'e-subj', 'e-body']) assert.equal(elements.get(id).value, '');
  assert.ok(h.filters.every(input => input.value === ''));
  assert.equal(h.context.location.hash, '#setup');
  assert.ok(elements.get('page-setup').classList.contains('active'));
  assert.ok(!elements.get('import-panel').classList.contains('hidden'));
  assert.ok(elements.get('imp-drop').focused);
  assert.doesNotMatch(elements.get('run-agenda').innerHTML, /Old item|Adjourned/);
  await h.flushSave();
  const saved = JSON.parse(h.requests.filter(r => r.method === 'PUT').at(-1).body).state;
  assert.equal(saved.meetings[0].agenda.length, 0);
  assert.equal(saved.undo, null);
  const reloaded = await createApp(h.storage);
  assert.equal(reloaded.app.meeting.agenda.length, 0);
  assert.equal(reloaded.app.meeting.endedAt, null);
  assert.equal(reloaded.app.meeting.to, 'team@example.test');
});

test('cancelling End meeting preserves the current meeting and upload previews', async () => {
  const h = await createApp();
  seedMeeting(h); h.app.seedTransient(); h.setConfirmed(false);
  const before = JSON.stringify(h.app.state);
  h.click('page-run', 'end-meeting');
  assert.equal(JSON.stringify(h.app.state), before);
  assert.equal(h.app.imports.rows.length, 1);
  assert.equal(h.context.location.hash, '#run');
});

test('pending items prevent ending; completed and skipped agendas can be cleared', async () => {
  for (const status of ['pending', 'done', 'skipped']) {
    const h = await createApp();
    seedMeeting(h, status);
    h.click('page-run', 'end-meeting');
    assert.equal(h.app.meeting.agenda.length, status === 'pending' ? 2 : 0);
    assert.equal(h.confirmCount, status === 'pending' ? 0 : 1);
  }
});

test('previously ended meetings prepare an empty next session instead of reusing the old agenda', async () => {
  const h = await createApp();
  seedMeeting(h, 'done'); h.app.meeting.endedAt = 100;
  h.click('page-run', 'new-meeting');
  assert.equal(h.app.meeting.agenda.length, 0);
  assert.equal(h.app.meeting.endedAt, null);
  assert.equal(h.context.location.hash, '#setup');
});

test('an agenda still parsing when End meeting is clicked cannot restore old upload previews', async () => {
  for (const fails of [false, true]) {
    const h = await createApp();
    seedMeeting(h);
    let resolve, reject;
    const pending = new Promise((res, rej) => { resolve = res; reject = rej; });
    h.app.setParser(() => pending);
    const importing = h.app.importFile({ name:'old.docx' });
    h.click('page-run', 'end-meeting');
    if (fails) reject(new Error('old parse failure'));
    else resolve([{ inc:true, title:'Old upload' }]);
    await importing;
    assert.equal(h.app.imports.rows.length, 0);
    assert.equal(h.elements.get('imp-st-en').textContent, '');
    assert.equal(h.elements.get('toast').textContent, 'Meeting cleared. Upload agendas for the next meeting.');
  }
});

test('a new agenda can be uploaded and started after ending the previous meeting', async () => {
  const h = await createApp();
  seedMeeting(h); h.click('page-run', 'end-meeting');
  h.app.setParser(async file => [{ inc:true, title:file.name === 'new-en.docx' ? 'New item' : 'Nouveau point', kind:'incamera', duration:5 }]);
  await h.app.importFile({ name:'new-en.docx' });
  await h.app.importFile({ name:'new-fr.docx' }, 'fr');
  h.click('imp-out', 'imp-replace');
  assert.equal(h.app.meeting.agenda.length, 1);
  assert.equal(h.app.meeting.agenda[0].title, 'New item');
  assert.equal(h.app.meeting.agenda[0].title_fr, 'Nouveau point');
  assert.equal(h.app.meeting.agenda[0].status, 'pending');
  assert.equal(h.app.imports.rows.length, 0);
  h.click('page-run', 'next');
  assert.equal(h.app.meeting.agenda[0].status, 'active');
  assert.ok(h.app.meeting.agenda[0].startedAt > 0);
  await h.flushSave();
  const reloaded = await createApp(h.storage);
  assert.equal(reloaded.app.meeting.agenda[0].title, 'New item');
});
