export function FileMenu({ busy, open, save, saveAs, importPng, exportPng, exportSheet }: {
  busy: boolean; open: () => void; save: () => void; saveAs: () => void; importPng: () => void; exportPng: () => void; exportSheet: () => void;
}) {
  return <details className="file-menu"><summary>File ▾</summary><div>{[
    ['Open project…', open], ['Save', save], ['Save as…', saveAs], ['Import PNG…', importPng], ['Export frame PNG…', exportPng], ['Export sprite sheet…', exportSheet],
  ].map(([label, action]) => <button key={String(label)} disabled={busy} onClick={event => { event.currentTarget.closest('details')!.open = false; (action as () => void)(); }}>{String(label)}</button>)}</div></details>;
}
