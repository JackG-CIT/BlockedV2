import json, pathlib, sys
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(r"C:\Users\jackk\BlockedV2\static\js")
cases = json.loads(pathlib.Path(sys.argv[1]).read_text())
JS = """async (c) => {
  const table = document.createElement('table'); document.body.appendChild(table);
  const g = Blocked.startGame(table, c.level, {});
  const D = {U:[0,-1], D:[0,1], L:[-1,0], R:[1,0]};
  const wait = async () => { while (g.busy) await new Promise(r => setTimeout(r, 5)); };
  await wait();
  const out = {mismatch: null, hint: []};
  for (let i = 0; i < c.moves.length; i++) {
    if (c.checks.some(k => k.at === i)) {
      const st = g.getState();
      const r = analyse(c.level, st);
      out.hint.push({at: i, moves: r.moves, solvable: r.solvable, truncated: r.truncated});
    }
    g.move(...D[c.moves[i]]);
    await wait();
    const st = g.getState();
    const boxes = st.boxes.map(b => b.join(',')).sort().join(' ');
    const want = c.states[i][1].map(b => b.join(',')).sort().join(' ');
    if (st.player.join(',') !== c.states[i][0].join(',') || boxes !== want) {
      out.mismatch = {step: i, got: st.player.join(',') + ' | ' + boxes, want: c.states[i][0].join(',') + ' | ' + want};
      break;
    }
  }
  out.won = g.won;
  g.destroy(); table.remove();
  return out;
}"""
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge")
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.set_content("<html><body></body></html>")
    pg.add_script_tag(content=(ROOT / "engine.js").read_text(encoding="utf-8"))
    pg.add_script_tag(content=(ROOT / "solver.js").read_text(encoding="utf-8"))
    bad = 0
    for c in cases:
        r = pg.evaluate(JS, c)
        want = {k['at']: k['moves'] for k in c['checks']}
        hint_ok = all(h['moves'] == want[h['at']] for h in r['hint'])
        ok = r['mismatch'] is None and r['won'] and hint_ok
        bad += not ok
        print(('OK  ' if ok else 'BAD ') + c['name'], f"{len(c['moves'])} moves, won={r['won']}",
              '' if r['mismatch'] is None else r['mismatch'],
              '' if hint_ok else f"hints {r['hint']} want {want}")
    print('page errors:', errs or 'none', '| failures:', bad)
    b.close()
