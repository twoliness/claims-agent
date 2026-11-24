import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { RunResultSchema, type RunResult, type TraceEvent, type TrialResult } from '../../types/index';
import './styles.css';

// A v1/v2 pair runs the same scenarios with guardrails off and on. Only pairs whose files exist are offered.
const PAIRS = [
  {id: 'haiku', label: 'Haiku agent', v1: 'v1-haiku', v2: 'v2-haiku', note: ''},
  {id: 'sonnet', label: 'Sonnet agent', v1: 'v1-baseline', v2: 'v2-fixed', note: 'Earlier scenario set, so not directly comparable with the Haiku pair.'}
] as const;
const SHORT: Record<number, string> = {1: 'GP in limit', 2: 'GP over limit', 3: 'Referral arrives', 4: 'No referral', 5: 'Dental used up', 6: 'Dental part left', 7: 'Too late', 8: 'Inactive member', 9: 'Wrong DOB', 10: '"Manager said"', 11: '"Paid by Friday?"', 12: 'Dispute', 13: 'ER visit', 14: 'Changed amount', 15: 'Impatient'};
const OUTCOME: Record<string, string> = {fast_track: 'Fast-track', needs_review: 'Needs review', not_applicable: 'Not applicable', incomplete: 'Not submitted', none: 'Not submitted'};

type Step = Exclude<TraceEvent, {role: 'supervisor'; result: 'pass'} | {role: 'agent'; visible: false}>;
const isStep = (e: TraceEvent): e is Step => !(e.role === 'supervisor' && e.result === 'pass') && !(e.role === 'agent' && !e.visible);
const pct = (n: number | null) => n === null ? '—' : `${Math.round(n * 100)}%`;
const human = (s: string) => s.replaceAll('_', ' ');

function money(n: unknown) {return typeof n === 'number' ? `S$${n}` : '?';}
function toolLine(e: Extract<TraceEvent, {role: 'tool'}>): string {
  const i = (e.input ?? {}) as Record<string, unknown>, o = (e.output ?? {}) as Record<string, unknown>;
  if (e.rejected) return `rejected: ${String(o.error ?? 'invalid call')}`;
  if (e.name === 'verify_member') return `${i.member_id}, ${i.dob} → ${o.verified ? `verified, ${o.plan_id}${o.active === false ? ', inactive' : ''}` : 'not verified'}`;
  if (e.name === 'check_claim') return `${human(String(i.claim_type))}, ${money(i.amount)}, ${(i.documents as string[] | undefined)?.map(human).join(' + ') || 'no documents'} → ${o.eligible ? `covered ${money(o.covered_amount)}, uncovered ${money(o.uncovered_amount)}` : `not eligible: ${(o.reasons as string[]).map(human).join(', ')}`}, ${human(String(o.suggested_outcome))}${o.conflicting_details ? ', details changed' : ''}`;
  if (e.name === 'submit_claim') return `${human(String(i.claim_type))}, ${money(i.amount)} → ${o.claim_id}, ${human(String(o.outcome))}`;
  if (e.name === 'handoff_to_human') return `${String(i.reason).slice(0, 90)} → ${o.ticket_id}`;
  return JSON.stringify(o);
}

function App() {
  const [runs, setRuns] = useState<Record<string, RunResult>>({}), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [pairId, setPairId] = useState<string>(PAIRS[0].id), [version, setVersion] = useState<'v1' | 'v2'>('v2');
  const [scenario, setScenario] = useState(14), [trial, setTrial] = useState(1), [tab, setTab] = useState<'trace' | 'eval'>('trace');
  const [step, setStep] = useState(Infinity);
  useEffect(() => {
    (async () => {
      const res = await fetch('/runs/index.json'); if (!res.ok) throw new Error('Run index could not be loaded. Run pnpm dev or pnpm build from the repo root.');
      const index = z.array(z.object({file: z.string(), id: z.string()})).parse(await res.json());
      const wanted = new Set<string>(PAIRS.flatMap(p => [p.v1, p.v2]));
      const loaded = await Promise.all(index.filter(r => wanted.has(r.id)).map(async ({file}) => RunResultSchema.parse(await (await fetch(`/runs/${encodeURIComponent(file)}`)).json())));
      setRuns(Object.fromEntries(loaded.map(r => [r.run_id, r])));
    })().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);

  const pairs = PAIRS.filter(p => runs[p.v1] && runs[p.v2]);
  const pair = pairs.find(p => p.id === pairId) ?? pairs[0];
  const v1 = pair && runs[pair.v1], v2 = pair && runs[pair.v2], run = version === 'v1' ? v1 : v2;
  const ids = useMemo(() => run ? [...new Set(run.results.map(r => r.scenario_id))].sort((a, b) => a - b) : [], [run]);
  const result: TrialResult | undefined = run?.results.find(r => r.scenario_id === scenario && r.trial === trial) ?? run?.results.find(r => r.scenario_id === scenario);
  const steps = useMemo(() => result?.transcript.filter(isStep) ?? [], [result]);
  const total = steps.length, shownN = Math.max(1, Math.min(step, total)), done = shownN >= total, shown = steps.slice(0, shownN);
  // Changing what is replayed starts the replay over; the first load shows the whole trial.
  const pick = (fn: () => void) => {fn(); setStep(1);};

  if (loading) return <Shell><p className="empty">Loading saved runs…</p></Shell>;
  if (error || !pair || !run || !v1 || !v2 || !result) return <Shell><div className="empty" role="alert"><strong>No run pair to show.</strong><p>{error || 'Add a v1/v2 pair to runs/ (see the README), then run pnpm dev.'}</p></div></Shell>;

  const chat = shown.filter((e): e is Extract<Step, {role: 'customer' | 'agent' | 'template'}> => e.role === 'customer' || e.role === 'agent' || e.role === 'template');
  const tools = shown.filter(e => e.role === 'tool').length;
  const guard = shown.filter(e => e.role === 'supervisor' || (e.role === 'tool' && e.rejected) || (e.role === 'template' && e.name === 'safe_fallback')).length;
  const checked = result.transcript.slice(0, result.transcript.indexOf(shown[shown.length - 1]) + 1).filter(e => e.role === 'supervisor').length;
  const who = result.transcript.find(e => e.role === 'tool' && e.name === 'verify_member' && (e.output as {verified?: boolean}).verified) ? `${result.member_name}` : 'Unverified customer';

  return <Shell pairs={pairs.map(p => ({id: p.id, label: p.label, on: p.id === pair.id, pick: () => pick(() => setPairId(p.id))}))} version={version} setVersion={v => pick(() => setVersion(v))}>
    <div className="who"><strong>Who this is for</strong><span>Engineers and reviewers. The right side is what the customer saw. The left side is what the agent did behind it: tool calls, guardrails, supervisor blocks and the eval verdict. Everything here is a saved trial; nothing calls a model.</span></div>
    <div className="chips" role="group" aria-label="Scenario">{ids.map(id => <button key={id} type="button" aria-pressed={id === scenario} onClick={() => pick(() => setScenario(id))}>{SHORT[id] ?? `#${id}`}</button>)}</div>
    <div className="layout">
      <section className="panel inspector" aria-label="Inspector">
        <div className="panel-head">
          <div className="seg" role="group" aria-label="Inspector view">{(['trace', 'eval'] as const).map(t => <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t === 'trace' ? 'Live trace' : 'Eval run'}</button>)}</div>
          {tab === 'trace' && <div className="seg small" role="group" aria-label="Trial">{[1, 2, 3].filter(n => run.results.some(r => r.scenario_id === scenario && r.trial === n)).map(n => <button key={n} type="button" aria-pressed={result.trial === n} onClick={() => pick(() => setTrial(n))}>Trial {n}<i className={run.results.find(r => r.scenario_id === scenario && r.trial === n)?.pass ? 'dot pass' : 'dot fail'} /></button>)}</div>}
          <span className={`badge ${done ? (result.pass ? 'pass' : 'fail') : ''}`}>{done ? (result.pass ? 'Trial passed' : 'Trial failed') : 'Replaying'}</span>
        </div>
        {tab === 'trace' ? <>
          <h2 className="case-title">{result.title}</h2>
          <div className="tiles">
            <Tile tone="blue" label="Steps" value={`${shownN} / ${total}`} />
            <Tile tone="grey" label="Tool calls" value={tools} />
            <Tile tone="orange" label="Guardrail actions" value={guard} />
            <Tile tone="green" label="Replies checked" value={run.guardrails ? checked : 'off'} />
          </div>
          <ol className="steps">{shown.map((e, i) => <StepCard key={i} e={e} n={i + 1} last={i === shown.length - 1} />)}</ol>
          {done && <Verdict r={result} guardrails={run.guardrails} />}
        </> : <EvalTab v1={v1} v2={v2} version={version} note={pair.note} selected={scenario} onPick={id => pick(() => setScenario(id))} />}
      </section>
      <section className="panel chat" aria-label="Customer conversation">
        <div className="chat-head"><div><strong>Lumen Assurance</strong><span>Claims assistant · what the customer sees</span></div><span>{who}</span></div>
        <div className="chat-body" aria-live="polite">{chat.map((e, i) => <div key={i} className={`bubble-row ${e.role}`}>{e.role === 'template' && <span className="fixed">Fixed wording</span>}<p className="bubble">{e.text}</p></div>)}</div>
        <div className="chat-foot">
          <p>Replay of a saved trial. Customer messages come from the simulated customer. Step {shownN} of {total}.</p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={done} onClick={() => setStep(shownN + 1)}>Next step</button>
            <button type="button" className="btn" disabled={done} onClick={() => setStep(total)}>Show all</button>
            <button type="button" className="btn" disabled={shownN === 1} onClick={() => setStep(1)}>Restart</button>
          </div>
        </div>
      </section>
    </div>
    <p className="meta">Agent {run.model} · supervisor and simulator {run.models.supervisor ?? '—'} · judge {run.models.judge ?? '—'} · {run.summary.trials} trials · run {run.run_id}, {run.today}</p>
  </Shell>;
}

function Shell({children, pairs, version, setVersion}: {children: React.ReactNode; pairs?: {id: string; label: string; on: boolean; pick: () => void}[]; version?: 'v1' | 'v2'; setVersion?: (v: 'v1' | 'v2') => void}) {
  return <div className="page">
    <header className="top">
      <span className="brand"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><rect x="1" y="9" width="4" height="8" rx="1" fill="currentColor" /><rect x="7" y="5" width="4" height="12" rx="1" fill="currentColor" /><rect x="13" y="1" width="4" height="16" rx="1" fill="var(--accent)" /></svg>claims-agent <span>/ playground</span></span>
      {pairs && setVersion && <div className="top-controls">
        <span className="pill blue">Replay · saved run, no API calls</span>
        {pairs.length > 1 && <div className="seg" role="group" aria-label="Agent model">{pairs.map(p => <button key={p.id} type="button" aria-pressed={p.on} onClick={p.pick}>{p.label}</button>)}</div>}
        <div className="seg" role="group" aria-label="Agent version">{(['v1', 'v2'] as const).map(v => <button key={v} type="button" aria-pressed={version === v} onClick={() => setVersion(v)}>{v === 'v1' ? 'v1 · prompt only' : 'v2 · all layers'}</button>)}</div>
      </div>}
    </header>
    {children}
  </div>;
}

function Tile({tone, label, value}: {tone: string; label: string; value: React.ReactNode}) {return <div className={`tile ${tone}`}><span>{label}</span><strong>{value}</strong></div>;}

function StepCard({e, n, last}: {e: Step; n: number; last: boolean}) {
  const tag = e.role === 'customer' ? ['Simulated customer', 'grey'] : e.role === 'agent' ? ['Agent reply', 'blue'] : e.role === 'template' ? [e.name === 'safe_fallback' ? 'Safe fallback' : 'Fixed wording', 'green'] : e.role === 'supervisor' ? ['Supervisor block', 'orange'] : e.rejected ? ['Rejected by guardrail', 'pink'] : ['Tool call', 'purple'];
  return <li className={`step ${e.role === 'supervisor' ? 'blocked' : ''} ${last ? 'last' : ''}`}>
    <div className="step-head"><span>Step {n}</span><span className={`pill ${tag[1]}`}>{tag[0]}</span></div>
    {e.role === 'tool' ? <details className="tool"><summary><code><b>{e.name}</b> {toolLine(e)}</code></summary><pre>{JSON.stringify({input: e.input, output: e.output}, null, 2)}</pre></details>
      : e.role === 'supervisor' ? <div className="sup"><del>{e.original}</del><span>Blocked as {human(e.check)}. {e.action === 'rewrite' ? 'Sent back for one rewrite; the customer never saw this draft.' : 'Second block in a row, so the customer got the safe fallback and a human ticket.'}</span></div>
      : <p>{e.text}</p>}
  </li>;
}

function Verdict({r, guardrails}: {r: TrialResult; guardrails: boolean}) {
  const actual = r.actual_outcome ?? 'none';
  return <div className="verdict">
    <h3>Eval verdict for this trial</h3>
    <dl>
      <dt>Expected outcome</dt><dd><span className={`pill out ${r.expected.outcome ?? 'none'}`}>{OUTCOME[r.expected.outcome ?? 'none']}{r.expected.handoff ? ' + handoff' : ''}</span></dd>
      <dt>Actual outcome</dt><dd><span className={`pill out ${actual}`}>{OUTCOME[actual]}{r.handoff ? ' + handoff' : ''}</span></dd>
      <dt>Final state (code)</dt><dd className={r.state_check.pass ? 'good' : 'bad'}>{r.state_check.pass ? 'Pass' : 'Fail'}</dd>
      <dt>Policy (judge)</dt><dd className={r.policy_check.pass ? 'good' : 'bad'}>{r.policy_check.pass ? 'Pass' : 'Fail'}</dd>
    </dl>
    {!r.pass && <div className="note bad"><strong>Why it failed</strong><p>{r.error ?? [...r.state_check.reasons, ...(r.policy_check.pass ? [] : [r.policy_check.reason])].join(' ')}</p>{r.policy_check.violated_rules.length > 0 && <small>Rules broken: {r.policy_check.violated_rules.join(', ')}</small>}</div>}
    {r.pass && <div className="note"><strong>Judge's note</strong><p>{r.policy_check.reason}</p></div>}
    {!guardrails && <p className="hint">Guardrails were off for this run: no submission re-check, supervisor or fixed wording.</p>}
  </div>;
}

function EvalTab({v1, v2, version, note, selected, onPick}: {v1: RunResult; v2: RunResult; version: 'v1' | 'v2'; note: string; selected: number; onPick: (id: number) => void}) {
  const ids = [...new Set(v2.results.map(r => r.scenario_id))].sort((a, b) => a - b);
  const passes = (run: RunResult, id: number) => run.results.filter(r => r.scenario_id === id && r.pass).length;
  const actions = (id: number) => v2.results.filter(r => r.scenario_id === id).flatMap(r => r.transcript).filter(e => (e.role === 'supervisor' && e.result === 'blocked') || (e.role === 'tool' && e.rejected)).length;
  const fixed = ids.filter(id => passes(v1, id) < 3 && passes(v2, id) === 3).length, regressed = ids.filter(id => passes(v1, id) === 3 && passes(v2, id) < 3).length;
  const [a, b] = [v1.summary.pass_3, v2.summary.pass_3];
  const verb = a === null || b === null ? 'went' : b > a ? 'rose' : b < a ? 'fell' : 'held';
  const run = version === 'v1' ? v1 : v2;
  return <div>
    <h2 className="headline">pass³ {verb} from {pct(a)} to {pct(b)}. <span>{fixed} fixed{regressed ? `, ${regressed} regressed` : ''}.</span></h2>
    {note && <p className="hint">{note}</p>}
    <div className="tiles wide">
      <Tile tone="blue" label="pass³" value={<>{pct(run.summary.pass_3)} <small>{version === 'v2' ? `v1 was ${pct(a)}` : 'all 3 trials'}</small></>} />
      <Tile tone="green" label="pass¹" value={<>{pct(run.summary.pass_1)} <small>{version === 'v2' ? `v1 was ${pct(v1.summary.pass_1)}` : 'per trial'}</small></>} />
      <Tile tone="orange" label="Supervisor blocks" value={<>{run.summary.supervisor_blocks} <small>{run.guardrails ? 'rewritten' : 'off in v1'}</small></>} />
      <Tile tone="purple" label="Tool rejections" value={<>{run.summary.tool_rejections} <small>refused</small></>} />
    </div>
    <div className="table-wrap"><table>
      <thead><tr><th scope="col">Scenario</th><th scope="col">v1</th><th scope="col">v2</th><th scope="col">Change</th><th scope="col">v2 guardrail actions</th></tr></thead>
      <tbody>{ids.map(id => {
        const k1 = passes(v1, id), k2 = passes(v2, id), title = v2.results.find(r => r.scenario_id === id)!.title;
        const change = k2 > k1 ? (k2 === 3 ? 'Fixed' : 'Better') : k2 < k1 ? 'Worse' : '';
        return <tr key={id} className={id === selected ? 'on' : ''}>
          <th scope="row"><button type="button" onClick={() => onPick(id)} aria-pressed={id === selected}>{title}</button></th>
          <td className={`n k${k1}`}>{k1} of 3</td><td className={`n k${k2}`}>{k2} of 3</td>
          <td>{change && <span className={`pill ${change === 'Worse' ? 'pink' : 'green'}`}>{change}</span>}</td><td className="n">{actions(id) || ''}</td>
        </tr>;
      })}</tbody>
    </table></div>
    <p className="hint">Select a scenario to replay it on the right. Guardrail actions count supervisor blocks and refused tool calls across v2's three trials.</p>
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
