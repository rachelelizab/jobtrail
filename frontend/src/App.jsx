import React, { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';
import Lookup from './components/Lookup.jsx';
import Tracker from './components/Tracker.jsx';
import Pipeline from './components/Pipeline.jsx';
import DatabaseView from './components/DatabaseView.jsx';
import AppDrawer from './components/AppDrawer.jsx';
import NewAppDrawer from './components/NewAppDrawer.jsx';

const TABS = [['tracker', 'Tracker'], ['pipeline', 'Pipeline'], ['database', 'Database']];

export default function App() {
  const [tab, setTab] = useState(() => localStorage.getItem('jobtrail.tab') || 'tracker');
  const [drawer, setDrawer] = useState(null);          // {type:'new'} | {type:'app', id, focusCall}
  const [version, setVersion] = useState(0);           // bump to make every view reload
  const [toast, setToast] = useState('');
  const [status, setStatus] = useState({ state: 'checking', text: 'Connecting to the database…' });

  const refresh = useCallback(() => setVersion(v => v + 1), []);
  const notify = useCallback(msg => {
    setToast(msg);
    clearTimeout(notify.t);
    notify.t = setTimeout(() => setToast(''), 2600);
  }, []);

  useEffect(() => { localStorage.setItem('jobtrail.tab', tab); }, [tab]);

  useEffect(() => {
    api.health()
      .then(h => setStatus({ state: 'ok', text: `Connected · ${h.engine} ${h.version}` }))
      .catch(e => setStatus({ state: 'error', text: e.message }));
  }, [version]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') setDrawer(null);
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault();
        document.getElementById('who')?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const openApp = (id, focusCall = false) => setDrawer({ type: 'app', id, focusCall });

  return (
    <div className="wrap">
      <header className="mast">
        <div className="brand"><h1>Job<span>Trail</span></h1><small>Application ledger</small></div>
        <div className="save" data-s={status.state === 'ok' ? 'saved' : status.state === 'error' ? 'error' : 'saving'} role="status">
          <i></i><span>{status.state === 'error' ? 'Database offline' : status.text}</span>
        </div>
      </header>
      {status.state === 'error' && <div className="err-banner">{status.text}</div>}

      <Lookup version={version} onOpen={openApp} />

      <div className="bar">
        <div className="tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} className="tab" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>
        <button className="btn primary" onClick={() => setDrawer({ type: 'new' })}>+ Log an application</button>
      </div>

      <section className="panel" role="tabpanel">
        {tab === 'tracker' && <Tracker version={version} onOpen={openApp} onAdd={() => setDrawer({ type: 'new' })} />}
        {tab === 'pipeline' && <Pipeline version={version} onOpen={openApp} />}
        {tab === 'database' && <DatabaseView version={version} />}
      </section>

      {drawer?.type === 'new' && (
        <NewAppDrawer
          onClose={() => setDrawer(null)}
          onSaved={(id, label) => { setDrawer(null); refresh(); notify(`Logged ${label}`); }}
        />
      )}
      {drawer?.type === 'app' && (
        <AppDrawer
          key={drawer.id}
          id={drawer.id}
          focusCall={drawer.focusCall}
          version={version}
          onClose={() => setDrawer(null)}
          onChanged={msg => { refresh(); if (msg) notify(msg); }}
          onDeleted={() => { setDrawer(null); refresh(); notify('Application deleted'); }}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
