import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, ChevronDown, ChevronRight, Code2, Play, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { z } from 'zod';
import { RunResultSchema, type RunResult, type TraceEvent, type TrialResult } from '../../types/index';
import './styles.css';
import { SelectField } from './SelectField';

// Each pair shares a scenario set. Do not compare the two agents across pairs.
const PAIRS = [
  {id: 'haiku', label: 'Haiku 5.5', v1: 'v1-haiku', v2: 'v2-haiku', note: ''},
  {id: 'sonnet', label: 'Sonnet 5.5', v1: 'v1-baseline', v2: 'v2-fixed', note: 'This pair uses an earlier scenario set and cannot be compared directly with the Haiku pair.'}
] as const;
const OUTCOME: Record<string, string> = {fast_track: 'Fast-track', needs_review: 'Needs review', not_applicable: 'Not applicable', incomplete: 'Not submitted', none: 'Not submitted'};
const pct = (n: number | null) => n === null ? '—' : `${Math.round(n * 100)}%`;
const human = (s: string) => s.replaceAll('_', ' ');
const isVisibleStep = (e: TraceEvent) => !(e.role === 'supervisor' && e.result === 'pass') && !(e.role === 'agent' && !e.visible);
const tokens = (run: RunResult) => Object.values(run.summary.usage).reduce((sum, usage) => sum + usage.input + usage.output + usage.cache_read + usage.cache_creation, 0);
const passes = (run: RunResult, id: number) => run.results.filter(r => r.scenario_id === id && r.pass).length;
const trialsFor = (run: RunResult, id: number) => run.results.filter(r => r.scenario_id === id).length;

function App() {
  const [runs, setRuns] = useState<Record<string, RunResult>>({}), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [pairId, setPairId] = useState<string>('haiku'), [version, setVersion] = useState<'v1' | 'v2'>('v2');
  const [scenario, setScenario] = useState(14), [trial, setTrial] = useState(1), [tab, setTab] = useState<'conversation' | 'evaluation'>('conversation');
  const [step, setStep] = useState<number | null>(null);
  const [mobilePanel, setMobilePanel] = useState<'conversation' | 'activity'>('conversation');
  useEffect(() => {
    (async () => {
      const res = await fetch('/runs/index.json');
      if (!res.ok) throw new Error('Run index could not be loaded. Run pnpm dev or pnpm build from the repo root.');
      const index = z.array(z.object({file: z.string(), id: z.string()})).parse(await res.json());
      const wanted = new Set<string>(PAIRS.flatMap(p => [p.v1, p.v2]));
      const loaded = await Promise.all(index.filter(r => wanted.has(r.id)).map(async ({file}) => {
        const response = await fetch(`/runs/${encodeURIComponent(file)}`);
        if (!response.ok) throw new Error(`Unable to load ${file}.`);
        return RunResultSchema.parse(await response.json());
      }));
      setRuns(Object.fromEntries(loaded.map(r => [r.run_id, r])));
    })().catch(e => setError(e.message)).finally(() => setLoading(false));
  }, []);
  const pairs = PAIRS.filter(p => runs[p.v1] && runs[p.v2]);
  const pair = pairs.find(p => p.id === pairId) ?? pairs[0];
  const v1 = pair && runs[pair.v1], v2 = pair && runs[pair.v2], run = version === 'v1' ? v1 : v2;
  const ids = useMemo(() => run ? [...new Set(run.results.map(r => r.scenario_id))].sort((a, b) => a - b) : [], [run]);
  const selectedId = ids.includes(scenario) ? scenario : ids[0];
  const result = run?.results.find(r => r.scenario_id === selectedId && r.trial === trial) ?? run?.results.find(r => r.scenario_id === selectedId);
  const steps = useMemo(() => result?.transcript.filter(isVisibleStep) ?? [], [result]);
  const shownN = step === null ? steps.length : Math.min(step, steps.length), done = shownN >= steps.length;
  const shown = steps.slice(0, shownN);
  const select = (update: () => void) => {update(); setStep(null);};
  const selectScenario = (id: number) => select(() => {setScenario(id); setTrial(1);});

  if (loading) return <Shell><div className="empty">Loading saved evaluations…</div></Shell>;
  if (error || !run || !pair || !v1 || !v2 || !result) return <Shell><div className="empty" role="alert"><h1>No saved run pair</h1><p>{error || 'Add a v1/v2 pair to runs/, then run pnpm dev.'}</p></div></Shell>;
  const formatMoney = (value: number) => new Intl.NumberFormat('en-SG', {style: 'currency', currency: run.insurer.currency, maximumFractionDigits: 2}).format(value);
  const chat = shown.filter((e): e is Extract<TraceEvent, {role: 'customer' | 'agent' | 'template'}> => e.role === 'customer' || e.role === 'agent' || e.role === 'template');
  const activity = shown.filter((e): e is Extract<TraceEvent, {role: 'tool' | 'supervisor'}> => e.role === 'tool' || e.role === 'supervisor');
  const verified = shown.some(e => e.role === 'tool' && e.name === 'verify_member' && (e.output as {verified?: boolean}).verified);
  const currentTrials = run.results.filter(r => r.scenario_id === selectedId);

  return <Shell>
    <section className="intro"><div><h1>Claims Agent Demo</h1><p>Explore the conversation, inspect the decisions, compare the results.</p></div><div className="top-controls">
      <SelectField label="Agent model" value={pair.id} options={pairs.map(p => ({value: p.id, label: p.label}))} onChange={value => select(() => setPairId(value))} className="model-trigger" />
      <div className="version-switch" role="group" aria-label="Agent version">{(['v1', 'v2'] as const).map(v => <button key={v} aria-pressed={version === v} onClick={() => select(() => setVersion(v))}>{v === 'v1' ? 'Prompt only' : 'Guardrails on'}</button>)}</div>
    </div></section>
    <nav className="view-tabs" aria-label="Viewer sections">{(['conversation', 'evaluation'] as const).map(value => <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => setTab(value)}>{value === 'conversation' ? 'Conversations' : 'Evaluation'}{value === 'evaluation' && <span>{pct(run.summary.pass_3)} pass³</span>}</button>)}<span className="run-meta">{run.summary.scenarios} scenarios · {run.summary.trials} trials · {tokens(run).toLocaleString()} tokens · saved runs, no API calls</span></nav>
    {tab === 'conversation' ? <>
      <div className="case-toolbar"><div className="scenario-select"><span>Scenario</span><SelectField label="Scenario" value={String(selectedId)} options={ids.map(id => ({value: String(id), label: `${String(id).padStart(2, '0')} · ${run.results.find(r => r.scenario_id === id)!.title}`}))} onChange={value => selectScenario(Number(value))} className="scenario-trigger" wide /></div><SelectField label="Trial" value={String(result.trial)} options={currentTrials.map(r => ({value: String(r.trial), label: `Trial ${r.trial} · ${r.pass ? 'Passed' : 'Failed'}`}))} onChange={value => select(() => setTrial(Number(value)))} className="trial-trigger" /></div>
      <div className="mobile-panel-switch" role="group" aria-label="Visible panel"><button aria-pressed={mobilePanel === 'conversation'} onClick={() => setMobilePanel('conversation')}>Conversation</button><button aria-pressed={mobilePanel === 'activity'} onClick={() => setMobilePanel('activity')}>Activity & verdict</button></div>
      <div className="workspace" data-panel={mobilePanel}>
        <section className="conversation-panel" aria-label="Customer conversation"><div className="panel-heading"><div><h2>{result.title}</h2><p>{verified ? result.member_name : 'Unverified customer'}<span>·</span>{run.insurer.claim_labels[result.claim_type] ?? human(result.claim_type)}<span>·</span>{formatMoney(result.amount)}</p></div>{done && <Status pass={result.pass} />}</div>
          <div className="messages" key={`${run.run_id}-${result.scenario_id}-${result.trial}`} aria-live="polite">{chat.length ? chat.map((event, i) => <div className={`message ${event.role}`} key={i}><div className="message-author">{event.role === 'customer' ? 'Customer' : run.insurer.name}{event.role === 'template' && <span><ShieldCheck size={11} />Fixed wording</span>}</div><p>{event.text}</p></div>) : <p className="quiet">No customer-visible messages at this step.</p>}{done && <div className="conversation-end"><span />End of conversation<span /></div>}</div>
          <div className="replay-bar"><span>{step === null ? 'Recorded conversation' : `Step ${shownN} of ${steps.length}`}</span><div>{step === null ? <button className="text-button" onClick={() => setStep(1)}><Play size={12} />Replay steps</button> : <><button className="icon-button" aria-label="Restart replay" disabled={shownN <= 1} onClick={() => setStep(1)}><RotateCcw size={13} /></button><button className="text-button" onClick={() => setStep(null)}>Show all</button><button className="next-button" disabled={done} onClick={() => setStep(shownN + 1)}>Next<ArrowRight size={13} /></button></>}</div></div>
        </section>
        <aside className="activity-panel" aria-label="Agent activity"><div className="activity-heading"><h2>Behind the conversation</h2><p>Tool calls and safety checks</p></div>
          <div className="activity-scroll">{done && <Verdict result={result} />}
          <div className="activity-list" aria-live="polite">{activity.length ? activity.map((event, i) => <Activity key={i} event={event} formatMoney={formatMoney} />) : <p className="quiet">Tool calls will appear as the conversation progresses.</p>}</div></div>
          <div className="safety-note"><ShieldCheck size={14} /><p>{run.guardrails ? 'Replies checked before delivery. Payment decisions stay with a human adjuster.' : 'Prompt only. Submission checks, the supervisor and fixed wording are off.'}</p></div>
        </aside>
      </div>
    </> : <Evaluation v1={v1} v2={v2} version={version} note={pair.note} onPick={id => {selectScenario(id); setTab('conversation');}} />}
    <footer><span>Fictional members. Recorded evaluations.</span><details className="run-info"><summary>{run.run_id}<ChevronDown size={12} /></summary><div><p>Agent: {run.model}</p><p>Supervisor: {run.models.supervisor ?? '—'}</p><p>Simulator: {run.models.simulator ?? '—'}</p><p>Judge: {run.models.judge ?? '—'}</p><p>Evaluation date: {run.today}</p></div></details></footer>
  </Shell>;
}
function Shell({children}: {children: React.ReactNode}) {return <main className="page">{children}</main>;}
function Status({pass}: {pass: boolean}) {return <span className={`status ${pass ? 'pass' : 'fail'}`}>{pass ? <Check size={12} /> : <X size={12} />}{pass ? 'Passed' : 'Failed'}</span>;}
function Outcome({value}: {value: string | null}) {return <span className={`outcome ${value ?? 'none'}`}><i />{OUTCOME[value ?? 'none'] ?? human(value!)}</span>;}
function Verdict({result: r}: {result: TrialResult}) {return <div className="verdict"><div className="outcomes"><div><span>Expected</span><Outcome value={r.expected.outcome ?? null} />{r.expected.handoff && <small>+ human handoff</small>}</div><ArrowRight size={13} /><div><span>Actual</span><Outcome value={r.actual_outcome} />{r.handoff && <small>+ human handoff</small>}</div></div><div className="check-row"><span>State check</span><Status pass={r.state_check.pass} /><span>Policy check</span><Status pass={r.policy_check.pass} /></div>{!r.pass && <div className="failure"><strong>{r.error ? 'Run error' : 'Why this failed'}</strong><p>{r.error ?? [...r.state_check.reasons, ...(r.policy_check.pass ? [] : [r.policy_check.reason])].join(' ')}</p>{r.policy_check.violated_rules.length > 0 && <small>Policy rules: {r.policy_check.violated_rules.join(', ')}</small>}</div>}<details className="judge-note"><summary>Judge’s note<ChevronDown size={12} /></summary><p>{r.policy_check.reason}</p></details></div>;}
function toolSummary(event: Extract<TraceEvent, {role: 'tool'}>, formatMoney: (n: number) => string) {
  const input = (event.input ?? {}) as Record<string, unknown>, output = (event.output ?? {}) as Record<string, unknown>;
  const amount = (n: unknown) => typeof n === 'number' ? formatMoney(n) : '—';
  if (event.rejected) return String(output.error ?? 'Invalid tool call');
  if (event.name === 'verify_member') return output.verified ? `${input.member_id} verified${output.active === false ? ' · inactive membership' : ''}` : 'Identity could not be verified';
  if (event.name === 'check_claim') return output.eligible ? `${amount(output.covered_amount)} potentially covered · ${amount(output.uncovered_amount)} over limit${Array.isArray(output.missing_documents) && output.missing_documents.length ? ` · missing ${output.missing_documents.map(String).map(human).join(', ')}` : ''}` : (Array.isArray(output.reasons) ? output.reasons.map(String).map(human).join(', ') : 'Not eligible');
  if (event.name === 'submit_claim') return `${output.claim_id} · ${OUTCOME[String(output.outcome)] ?? human(String(output.outcome))}`;
  if (event.name === 'handoff_to_human') return `${output.ticket_id} · ${input.reason}`;
  return 'Completed';
}
function Activity({event, formatMoney}: {event: Extract<TraceEvent, {role: 'tool' | 'supervisor'}>; formatMoney: (n: number) => string}) {
  if (event.role === 'supervisor') return <div className="supervisor-block"><span className="activity-node"><ShieldCheck size={13} /></span><div><h3>Supervisor blocked a reply</h3><p>{human(event.check)} · {event.action === 'rewrite' ? 'Sent for rewrite' : 'Handed off to a human'}</p><details><summary>View blocked draft<ChevronDown size={12} /></summary><del>{event.original}</del></details></div></div>;
  return <div className={`activity ${event.rejected ? 'rejected' : ''}`}><span className="activity-node"><Code2 size={13} /></span><details><summary><div><h3>{human(event.name)}{event.rejected && <span>Rejected</span>}</h3><p>{toolSummary(event, formatMoney)}</p></div><ChevronDown size={13} /></summary><pre>{JSON.stringify({input: event.input, output: event.output}, null, 2)}</pre></details></div>;
}
function Evaluation({v1, v2, version, note, onPick}: {v1: RunResult; v2: RunResult; version: 'v1' | 'v2'; note: string; onPick: (id: number) => void}) {
  const ids = [...new Set(v2.results.map(r => r.scenario_id))].sort((a, b) => a - b), run = version === 'v1' ? v1 : v2;
  const improvements = ids.filter(id => passes(v2, id) / trialsFor(v2, id) > passes(v1, id) / trialsFor(v1, id)).length;
  const regressions = ids.filter(id => passes(v2, id) / trialsFor(v2, id) < passes(v1, id) / trialsFor(v1, id)).length;
  return <section className="evaluation"><div className="evaluation-title"><div><h2>What changed with guardrails?</h2><p>{improvements} scenario{improvements === 1 ? '' : 's'} improved · {regressions} regressed</p></div><span><ShieldCheck size={14} />{run.summary.supervisor_blocks} supervisor blocks · {run.summary.tool_rejections} tool rejections</span></div>{note && <p className="pair-note">{note}</p>}<div className="metrics"><Metric label="Reliable across 3 trials" value={pct(run.summary.pass_3)} note={`pass³ · ${version === 'v2' ? `baseline ${pct(v1.summary.pass_3)}` : 'baseline run'}`} /><Metric label="Individual trials passed" value={pct(run.summary.pass_1)} note="pass¹ · state and policy checks" /><Metric label="Complete & correctly triaged" value={pct(run.summary.complete_and_triaged)} note="Of submitted claims" /></div><div className="table-wrap"><table><thead><tr><th>Scenario</th><th>Prompt only</th><th>Guardrails on</th><th>Change</th><th><span className="sr-only">Inspect</span></th></tr></thead><tbody>{ids.map(id => {
    const a = passes(v1, id), b = passes(v2, id), n1 = trialsFor(v1, id), n2 = trialsFor(v2, id), change = b / n2 - a / n1;
    return <tr key={id}><th scope="row"><button onClick={() => onPick(id)}><span className="scenario-number">{String(id).padStart(2, '0')}</span>{v2.results.find(r => r.scenario_id === id)!.title}</button></th><td><span className={a === n1 ? 'all-passed' : 'some-failed'}>{a}<span> / {n1}</span></span></td><td><span className={b === n2 ? 'all-passed' : 'some-failed'}>{b}<span> / {n2}</span></span></td><td><span className={`change ${change > 0 ? 'better' : change < 0 ? 'worse' : ''}`}>{change > 0 ? 'Improved' : change < 0 ? 'Regressed' : '—'}</span></td><td><button className="icon-button" aria-label={`Inspect scenario ${id}`} onClick={() => onPick(id)}><ChevronRight size={14} /></button></td></tr>;
  })}</tbody></table></div><details className="methodology"><summary>How these scores work<ChevronDown size={13} /></summary><p><strong>pass¹</strong> is the share of trials passing both deterministic state checks and the independent policy judge. <strong>pass³</strong> is the share of scenarios passing all three trials; it is unavailable for one-trial or incomplete runs. <strong>Complete & triaged</strong> measures submitted claims with required documents and correct routing. Simulated customers and model judges can make mistakes; these results describe this suite, not a production guarantee.</p></details></section>;
}
function Metric({label, value, note}: {label: string; value: string; note: string}) {return <div className="metric"><span>{label}</span><strong>{value}</strong><p>{note}</p></div>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
