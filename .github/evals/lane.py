#!/usr/bin/env python3
"""Run a list of journeys one tenant at a time; verify in a small pool; print a summary table.

Testers are serialized per tenant so before/after tenant evidence belongs to one journey.
Verifiers touch no tenant, so they run in parallel. Exit code 0 only if every bundle passed the gate.
"""
import argparse, json, os, subprocess, sys, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--env', required=True)
    ap.add_argument('--cases', required=True, help='comma-separated case ids, optionally case:variant')
    ap.add_argument('--out', required=True, help='directory that receives one run bundle per case')
    ap.add_argument('--context-dir', default=None, help='optional operator context files named <case>.md')
    ap.add_argument('--verify-parallel', type=int, default=3)
    ap.add_argument('--summary', default=os.environ.get('GITHUB_STEP_SUMMARY'))
    a = ap.parse_args()
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    slots, threads, results = threading.Semaphore(a.verify_parallel), [], {}

    def verify(case, run):
        with slots:
            with open(out / f'{run.name}.verify.log', 'w') as log:
                subprocess.run([sys.executable, str(HERE / 'journey.py'), '--case', case, '--env', a.env, '--run', str(run), '--stage', 'verifier'], stdout=log, stderr=subprocess.STDOUT)
            summary = run / 'summary.json'
            results[run.name] = json.loads(summary.read_text()) if summary.exists() else {'gate_exit_code': None}

    for spec in [s.strip() for s in a.cases.split(',') if s.strip()]:
        case, _, variant = spec.partition(':')
        run = out / (f'{case}__{a.env}' + (f'__{variant}' if variant else ''))
        cmd = [sys.executable, str(HERE / 'journey.py'), '--case', case, '--env', a.env, '--run', str(run), '--stage', 'tester']
        if variant:
            cmd += ['--variant', variant]
        if a.context_dir and (Path(a.context_dir) / f'{case}.md').exists():
            cmd += ['--context-file', str(Path(a.context_dir) / f'{case}.md')]
        print(a.env, 'tester', run.name, flush=True)
        with open(out / f'{run.name}.log', 'w') as log:
            subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT)
        t = threading.Thread(target=verify, args=(case, run))
        t.start()
        threads.append(t)
    for t in threads:
        t.join()

    # Criterion ids and counts only: verifier explanations quote tenant data and stay on the runner.
    lines = ['| Journey | Gate | Criteria | Not passing |', '|---|---|---|---|']
    failed = 0
    for name, r in sorted(results.items()):
        verdict = out / name / 'verdict.yaml'
        crit, bad = '', ''
        if verdict.exists():
            import yaml
            v = yaml.safe_load(verdict.read_text())
            counts = {}
            for c in v['criteria']:
                counts[c['status']] = counts.get(c['status'], 0) + 1
            crit = ', '.join(f'{k} {n}' for k, n in sorted(counts.items()))
            bad = ', '.join(f"{c['id']} ({c['status']})" for c in v['criteria'] if c['status'] != 'pass')
        ok = r.get('gate_exit_code') == 0
        failed += 0 if ok else 1
        lines.append(f"| {name} | {'PASS' if ok else 'FAIL'} | {crit} | {bad} |")
    table = '\n'.join(lines)
    print(table)
    if a.summary:
        with open(a.summary, 'a') as f:
            f.write(f'## Live journeys on {a.env}\n\n{table}\n')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
