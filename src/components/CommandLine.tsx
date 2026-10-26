import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import {
  acceptSuggestion,
  appendInput,
  browseHistory,
  cancelInput,
  commandRedo,
  cycleGrip,
  commandUndo,
  eraseSelection,
  getCommandSnapshot,
  getHost,
  gripState,
  removeUserAlias,
  runCommand,
  setAliasEditor,
  setExpanded,
  setInputValue,
  setUserAlias,
  submitInput,
  subscribeCommandUi,
  toggleSetting,
  userAliasEntries,
} from '../commands/runtime';
import { getWorkspace, patchChrome, subscribeWorkspace } from '../view/workspace';

function initialDock(): { open: boolean; height: number } {
  let height = 92;
  let open = true;
  try {
    const storedHeight = Number(localStorage.getItem('fieldline.commandHeight'));
    if (storedHeight >= 48 && storedHeight <= 420) height = storedHeight;
    const collapsed = localStorage.getItem('fieldline.commandCollapsed');
    if (collapsed === '1') open = false;
    else if (collapsed === '0') open = true;
    else if (window.matchMedia('(max-width: 1099px)').matches) open = false;
  } catch {
    open = true;
  }
  return { open, height };
}

function rememberDock(open: boolean, height: number): void {
  try {
    localStorage.setItem('fieldline.commandCollapsed', open ? '0' : '1');
    localStorage.setItem('fieldline.commandHeight', String(height));
  } catch {
    // Storage can be unavailable from file://.
  }
}

function KeywordLabel({ label }: { label: string }) {
  const parts: { text: string; strong: boolean }[] = [];
  for (const ch of label) {
    const strong = (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
    const last = parts[parts.length - 1];
    if (last && last.strong === strong) last.text += ch;
    else parts.push({ text: ch, strong });
  }
  return (
    <>
      {parts.map((part, index) =>
        part.strong ? <strong key={index}>{part.text}</strong> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}

export function CommandLine({ collapsed = false, heightPx, onHeight }: { collapsed?: boolean; heightPx?: number; onHeight?: (height: number) => void }) {
  const snapshot = useSyncExternalStore(subscribeCommandUi, getCommandSnapshot, getCommandSnapshot);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const dock = useRef(initialDock());
  const [open, setOpen] = useState(dock.current.open);
  const [height, setHeight] = useState(dock.current.height);

  useEffect(() => {
    setExpanded(open);
  }, [open]);

  useEffect(() => {
    const node = historyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [snapshot.lines, open]);

  useEffect(() => {
    if (dock.current.open) patchChrome({ textWindow: true });
    return subscribeWorkspace(() => {
      const open = getWorkspace().textWindow;
      setOpen(open);
      rememberDock(open, dock.current.height);
    });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const commandInput = inputRef.current;
      const inField = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'));
      const inCommand = target === commandInput;
      if (inField && !inCommand && !event.key.startsWith('F')) return;

      if (event.key === 'F1') {
        event.preventDefault();
        runCommand('HELP');
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        patchChrome({ textWindow: !getWorkspace().textWindow });
        return;
      }
      if (event.key === 'F3') {
        event.preventDefault();
        toggleSetting('osnap');
        return;
      }
      if (event.key === 'F8') {
        event.preventDefault();
        toggleSetting('ortho');
        return;
      }
      if (event.key === 'F10') {
        event.preventDefault();
        toggleSetting('polar');
        return;
      }
      if (event.key === 'F11') {
        event.preventDefault();
        toggleSetting('otrack');
        return;
      }
      if (event.key === 'F12') {
        event.preventDefault();
        toggleSetting('dyn');
        return;
      }
      if (inField && !inCommand) return;

      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        commandUndo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey))) {
        event.preventDefault();
        commandRedo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 's' && event.shiftKey) {
        event.preventDefault();
        runCommand('SAVEAS');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 's') {
        event.preventDefault();
        runCommand('QSAVE');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'n') {
        event.preventDefault();
        runCommand('NEW');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'o') {
        event.preventDefault();
        runCommand('OPEN');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === '0' || event.code === 'Digit0')) {
        event.preventDefault();
        runCommand(getWorkspace().cleanScreen ? 'CLEANSCREENOFF' : 'CLEANSCREENON');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && (event.key === '9' || event.code === 'Digit9')) {
        event.preventDefault();
        patchChrome({ commandLine: !getWorkspace().commandLine });
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'a' && !inCommand) {
        event.preventDefault();
        runCommand('AI_SELALL');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'x') {
        event.preventDefault();
        runCommand('CUTCLIP');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key === '1') {
        event.preventDefault();
        runCommand('PROPERTIES');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && ['2', '3', '4', '5'].includes(event.key)) {
        event.preventDefault();
        const views = ['plan', '3d', 'split', 'profile', 'section'] as const;
        getHost()?.setView(views[Number(event.key) - 1]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c' && event.shiftKey) {
        event.preventDefault();
        runCommand('COPYBASE');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'c') {
        const selected = window.getSelection()?.toString();
        if (selected) return;
        event.preventDefault();
        runCommand('COPYCLIP');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'v' && event.shiftKey) {
        if (inCommand) return;
        event.preventDefault();
        runCommand('PASTEBLOCK');
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key === 'v') {
        if (inCommand) return;
        event.preventDefault();
        runCommand('PASTECLIP');
        return;
      }
      if (event.key === 'Delete' && !event.ctrlKey && !event.metaKey) {
        if (getCommandSnapshot().input) return;
        event.preventDefault();
        eraseSelection();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelInput();
        return;
      }
      if (getWorkspace().locomotion !== 'none') {
        const move = event.key.toLowerCase();
        if (
          move === 'arrowup' || move === 'arrowdown' || move === 'arrowleft' || move === 'arrowright'
          || move === 'w' || move === 'a' || move === 's' || move === 'd'
          || move === 'q' || move === 'e'
          || event.key === 'PageUp' || event.key === 'PageDown'
        ) {
          event.preventDefault();
          return;
        }
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        browseHistory(event.key === 'ArrowUp' ? 'up' : 'down');
        commandInput?.focus();
        return;
      }
      if (event.key === 'Tab') {
        if (getCommandSnapshot().suggestions.length === 0) return;
        event.preventDefault();
        acceptSuggestion();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        submitInput();
        commandInput?.focus();
        return;
      }
      if (event.key === ' ') {
        if (gripState() && !getCommandSnapshot().input) {
          event.preventDefault();
          cycleGrip();
          return;
        }
        if (!getCommandSnapshot().spaceCommits) {
          if (!inCommand) {
            event.preventDefault();
            commandInput?.focus();
            appendInput(' ');
          }
          return;
        }
        event.preventDefault();
        submitInput();
        commandInput?.focus();
        return;
      }
      if (inCommand || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.length !== 1) return;
      event.preventDefault();
      commandInput?.focus();
      appendInput(event.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [height]);

  const onResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startH = heightPx ?? height;
    const move = (ev: PointerEvent) => {
      const next = Math.min(420, Math.max(22, startH + (startY - ev.clientY)));
      if (onHeight) onHeight(next);
      else setHeight(next);
      setOpen(true);
      rememberDock(true, next);
      patchChrome({ textWindow: true });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const toggleOpen = () => {
    patchChrome({ textWindow: !getWorkspace().textWindow });
  };

  return (
    <section className={`command-dock${open ? ' open' : ''}${collapsed ? ' collapsed' : ''}`} aria-label="Command line" style={heightPx ? { height: '100%' } : undefined}>
      <button type="button" className="command-resize" aria-label="Resize command history" onPointerDown={onResize} />
      {open && (heightPx ?? height) > 28 && (
        <div className="command-history" ref={historyRef} style={heightPx ? undefined : { height }}>
          {snapshot.lines.map((line, index) => (
            <div key={`${index}-${line.text}`} className={`command-line kind-${line.kind}`}>
              {line.text}
            </div>
          ))}
        </div>
      )}
      {snapshot.suggestions.length > 0 && (
        <ul className="command-suggest" role="listbox" aria-label="Command suggestions">
          {snapshot.suggestions.map((item, index) => (
            <li key={item.command}>
              <button
                type="button"
                role="option"
                aria-selected={index === snapshot.suggestionIndex}
                className={index === snapshot.suggestionIndex ? 'active' : ''}
                onMouseDown={(event) => {
                  event.preventDefault();
                  runCommand(item.command);
                }}
              >
                <span>{item.label}</span>
                <em>{item.description}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="command-prompt-row">
        <button type="button" className="command-collapse" aria-label={open ? 'Collapse command history' : 'Expand command history'} onClick={toggleOpen}>
          {open ? '▾' : '▸'}
        </button>
        <label className="command-entry">
          <span className="command-prompt">
            {snapshot.promptHead}
            {snapshot.keywords.length > 0 && (
              <>
                {' ['}
                {snapshot.keywords.map((keyword, index) => (
                  <span key={keyword}>
                    {index > 0 ? '/' : ''}
                    <button
                      type="button"
                      className="command-keyword"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        submitInput(keyword);
                      }}
                    >
                      <KeywordLabel label={keyword} />
                    </button>
                  </span>
                ))}
                {']'}
              </>
            )}
            {snapshot.def && (
              <>
                {' <'}
                <button
                  type="button"
                  className="command-keyword"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    submitInput('');
                  }}
                >
                  {snapshot.def}
                </button>
                {'>'}
              </>
            )}
            {snapshot.promptHead.endsWith('.') || snapshot.promptHead.endsWith(':') ? '' : ':'}
          </span>
          <input
            ref={inputRef}
            aria-label="Command line"
            value={snapshot.input}
            spellCheck={false}
            autoCapitalize="off"
            onChange={(event) => setInputValue(event.target.value)}
          />
        </label>
        <div className="command-modes" role="group" aria-label="Drafting modes">
          <ModeButton name="osnap" label="OSNAP" title="Object snap (F3)" on={snapshot.osnap} />
          <ModeButton name="ortho" label="ORTHO" title="Ortho (F8)" on={snapshot.ortho} />
          <ModeButton name="polar" label="POLAR" title="Polar tracking (F10)" on={snapshot.polar} />
          <ModeButton name="otrack" label="OTRACK" title="Object snap tracking (F11)" on={snapshot.otrack} />
          <ModeButton name="dyn" label="DYN" title="Dynamic input (F12)" on={snapshot.dyn} />
          <ModeButton name="gridSnap" label="SNAP" title="Grid snap" on={snapshot.gridSnap} />
        </div>
      </div>
      {snapshot.aliasEditor && <AliasEditor />}
    </section>
  );
}

function ModeButton({ name, label, title, on }: { name: 'ortho' | 'polar' | 'otrack' | 'dyn' | 'osnap' | 'gridSnap'; label: string; title: string; on: boolean }) {
  return (
    <button type="button" className={on ? 'on' : ''} title={title} aria-pressed={on} onClick={() => toggleSetting(name)}>
      {label}
    </button>
  );
}

function AliasEditor() {
  const entries = userAliasEntries();
  const [alias, setAlias] = useState('');
  const [command, setCommand] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-back" role="presentation" onMouseDown={() => setAliasEditor(false)}>
      <div className="modal alias-editor" role="dialog" aria-labelledby="alias-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2 id="alias-title">Command aliases</h2>
            <p>User aliases override design command names and the classic CAD alias file. Stored in this browser.</p>
          </div>
        </header>
        <div className="modal-body">
          <form
            className="alias-form"
            onSubmit={(event) => {
              event.preventDefault();
              const message = setUserAlias(alias, command);
              setError(message);
              if (!message) {
                setAlias('');
                setCommand('');
              }
            }}
          >
            <input aria-label="Alias" placeholder="Alias" value={alias} onChange={(event) => setAlias(event.target.value)} />
            <input aria-label="Command" placeholder="Command" value={command} onChange={(event) => setCommand(event.target.value)} />
            <button type="submit" className="primary">
              Add
            </button>
          </form>
          {error && <p className="error">{error}</p>}
          {entries.length === 0 ? (
            <p className="hint">No user aliases yet. The classic CAD alias list is already active.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Alias</th>
                  <th>Command</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.alias}>
                    <td>{entry.alias}</td>
                    <td>{entry.command}</td>
                    <td>
                      <button type="button" onClick={() => removeUserAlias(entry.alias)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer>
          <button type="button" className="primary" onClick={() => setAliasEditor(false)}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}
