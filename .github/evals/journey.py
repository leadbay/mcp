#!/usr/bin/env python3
"""Operator runner for one live journey. Infrastructure only: no case-specific logic.

Establishes the connection, records independent before/after tenant state and
billing, records every MCP and backend byte outside the model containers, runs
the tester and verifier sandboxes from compose.yaml, seals run.yaml and runs
the same contracts gate CI uses. Exit code 0 means the bundle passed the gate.
"""
import argparse, datetime, hashlib, json, os, re, shutil, socket, socketserver, subprocess, sys, threading, time, urllib.error, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ENVIRONMENTS = {
    'prod-us': ('https://api-us.leadbay.app', 'us'),
    'prod-fr': ('https://api-fr.leadbay.app', 'fr'),
    'staging-us': ('https://api-us-staging.leadbay.app', 'us'),
    'staging-fr': ('https://staging.api.leadbay.app', 'fr'),
}
RELAY = '''import socket,sys,threading
s=socket.create_connection(("host.docker.internal",PORT))
def receive():
 while True:
  b=s.recv(65536)
  if not b:break
  sys.stdout.buffer.write(b);sys.stdout.buffer.flush()
t=threading.Thread(target=receive,daemon=True);t.start()
for b in sys.stdin.buffer:s.sendall(b)
s.shutdown(socket.SHUT_WR);t.join()'''


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def api(base, path, token=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(base + '/1.6' + path, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw, status = res.read(), res.status
    except urllib.error.HTTPError as e:
        raw, status = e.read(), e.code
    try:
        value = json.loads(raw)
    except Exception:
        value = raw.decode(errors='replace')[:2000]
    return {'at': now(), 'path': path, 'status': status, 'body': value}


def snapshot(base, token):
    me = api(base, '/users/me', token)
    org = me['body'].get('organization', {}) if isinstance(me['body'], dict) else {}
    facts = {'/users/me': me}
    for path in ['/lenses', '/monitor?count=20&page=0']:
        facts[path] = api(base, path, token)
    billing = api(base, f"/organizations/{org.get('id')}/quota_status", token) if org.get('id') else None
    return facts, billing, org


class Recorder:
    """Records every JSON-RPC line between the product and the candidate MCP, plus its stderr."""

    def __init__(self, observed, env):
        self.observed, self.env, self.serial, self.lock = observed, env, 0, threading.Lock()
        self.children = []
        rec = self

        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                with rec.lock:
                    rec.serial += 1
                    session = rec.serial
                stderr = open(rec.observed / f'mcp-{session}.stderr', 'wb')
                p = subprocess.Popen(['node', '--import', str(HERE / 'record-https.mjs'), str(ROOT / 'packages/mcp/dist/bin.js')],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=stderr, env=rec.env, cwd=ROOT)
                rec.children.append(p)

                def record(direction, line):
                    try:
                        value = json.loads(line)
                    except Exception:
                        value = line.decode(errors='replace')
                    with rec.lock:
                        with open(rec.observed / 'mcp.ndjson', 'a') as f:
                            f.write(json.dumps({'at': now(), 'session': session, 'direction': direction, 'message': value}) + '\n')

                def pump():
                    try:
                        for line in p.stdout:
                            record('server', line)
                            self.wfile.write(line)
                            self.wfile.flush()
                    except (BrokenPipeError, ConnectionError, OSError):
                        pass
                threading.Thread(target=pump, daemon=True).start()
                try:
                    for line in self.rfile:
                        record('client', line)
                        p.stdin.write(line)
                        p.stdin.flush()
                except (BrokenPipeError, ConnectionError, OSError):
                    pass
                finally:
                    try:
                        p.stdin.close()
                    except Exception:
                        pass
                    try:
                        p.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        p.terminate()
                    stderr.close()

        class Server(socketserver.ThreadingTCPServer):
            allow_reuse_address = True
            daemon_threads = True
        self.server = Server(('0.0.0.0', 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        for p in self.children:
            if p.poll() is None:
                p.terminate()


def compose(args, run, extra_env, stdout, stderr, timeout):
    env = {**os.environ, **extra_env}
    cmd = ['docker', 'compose', '-f', str(HERE / 'compose.yaml')]
    if extra_env.get('EVAL_CLAUDE_CREDENTIALS'):
        cmd += ['-f', str(HERE / 'compose.oauth.yaml')]
    cmd += ['run', '--rm', '-T', *args]
    with open(stdout, 'w') as out, open(stderr, 'w') as err:
        p = subprocess.Popen(cmd, env=env, stdout=out, stderr=err, cwd=HERE, start_new_session=True)
        try:
            return p.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            subprocess.run(['docker', 'compose', '-f', str(HERE / 'compose.yaml'), 'down', '--remove-orphans'], cwd=HERE, env=env, capture_output=True)
            p.kill()
            return 124


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--case', required=True)
    ap.add_argument('--env', required=True, choices=ENVIRONMENTS)
    ap.add_argument('--run', required=True)
    ap.add_argument('--variant', default=None)
    ap.add_argument('--language', default=None)
    ap.add_argument('--model', default=os.environ.get('EVAL_SUBJECT_MODEL', 'claude-sonnet-5'))
    ap.add_argument('--executor-model', default=os.environ.get('EVAL_EXECUTOR_MODEL', 'claude-sonnet-5'))
    ap.add_argument('--verifier-model', default=os.environ.get('EVAL_VERIFIER_MODEL', 'claude-sonnet-5'))
    ap.add_argument('--context-file', default=None, help='Operator-supplied user material or prior context, appended to target.md')
    ap.add_argument('--tester-timeout', type=int, default=3600)
    ap.add_argument('--verifier-timeout', type=int, default=3600)
    ap.add_argument('--stage', choices=['all', 'tester', 'verifier', 'gate'], default='all', help='verifier or gate re-open an existing run directory')
    a = ap.parse_args()
    run = Path(a.run).resolve()
    if a.stage == 'verifier':
        sys.exit(verify(a, run))
    if a.stage == 'gate':
        sys.exit(gate(a, run, json.loads((run / 'run.yaml').read_text())))

    base, region = ENVIRONMENTS[a.env]
    case_src = ROOT / 'evals/cases' / a.case
    for d in ['case', 'connection', 'execution', 'observed/subject', 'verifier']:
        (run / d).mkdir(parents=True, exist_ok=True)
    os.chmod(run / 'observed/subject', 0o777)
    os.chmod(run / 'verifier', 0o777)
    for name in ['scenario.yaml', 'request.md', 'acceptance.yaml']:
        shutil.copyfile(case_src / name, run / 'case' / name)
    artifacts = {n: sha256(run / 'case' / n) for n in ['scenario.yaml', 'request.md', 'acceptance.yaml']}
    scenario = json.loads(subprocess.run([sys.executable, '-c', 'import sys,yaml,json;print(json.dumps(yaml.safe_load(open(sys.argv[1]))))', str(run / 'case/scenario.yaml')], capture_output=True, text=True, check=True).stdout)
    language = a.language or scenario['languages'][0]

    token = os.environ.get('LEADBAY_TOKEN')
    if not token:
        login = api(base, '/auth/login', body={'email': os.environ['LEADBAY_EMAIL'], 'password': os.environ['LEADBAY_PASSWORD']})
        token = login['body'].get('token') if isinstance(login['body'], dict) else None
        if not token:
            print('login failed', login['status'], file=sys.stderr)
            sys.exit(2)

    before, billing_before, org = snapshot(base, token)
    (run / 'observed/state-before.json').write_text(json.dumps(before, indent=2))
    version = json.loads((ROOT / 'packages/mcp/package.json').read_text())['version']
    sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    mcp_revision = f'{version}@{sha}'
    tenant = f"{a.env}:{org.get('id')}"

    mcp_env = {**os.environ, 'LEADBAY_TOKEN': token, 'LEADBAY_REGION': region, 'LEADBAY_BASE_URL': base,
               'LEADBAY_TELEMETRY_ENABLED': 'false', 'LEADBAY_MCP_WRITE': '1', 'LEADBAY_LOG_LEVEL': 'info',
               'LIVE_BACKEND_LOG': str(run / 'observed/backend.ndjson')}
    mcp_env.pop('LEADBAY_MOCK', None)
    recorder = Recorder(run / 'observed', mcp_env)

    (run / 'connection/mcp.json').write_text(json.dumps({'mcpServers': {'leadbay': {'command': 'python3', 'args': ['-c', RELAY.replace('PORT', str(recorder.port))]}}}, indent=2))
    variant_line = f'Selected variant: {a.variant}.' if a.variant else 'No variant selected: run the base case.'
    target = f'''Surface: claude-code. Subject model: {a.model}. Environment: {a.env}. Tenant region independently verified by the operator: {region}. Language: {language}. Candidate MCP revision: {mcp_revision}.
{variant_line}

Product session launch (exact flags):
  claude --setting-sources "" --disable-slash-commands --no-chrome --strict-mcp-config --mcp-config /connection/mcp.json --dangerously-skip-permissions --tools "" --model {a.model} --output-format stream-json --verbose --print "<user message>"
The first user message is the content of /test/request.md, verbatim. Redirect the stdout of every product turn to a new file /subject/turn-<n>.jsonl (n starting at 1) so the operator keeps the original product conversation; keep stderr in /subject/turn-<n>.stderr. Do not truncate, edit or summarize those files. Read the init line of turn-1 and confirm the leadbay server status is "connected" before treating any product answer as evidence; if it is not connected, report an incomplete run.
To continue the same product conversation with the next user reply, reuse the session_id from the previous turn's stream: add --resume <session_id> to the same flags and pass the reply as the message.
MCP tools remain available; the product's built-in file and shell tools are disabled by --tools "". Do not use --bare; this sandbox carries the standard credential. Never pass these operator instructions to the product.
The operator authenticated the dedicated test tenant, captured its state before the run and records every MCP request, response and backend call outside this container. The product must discover any account facts it needs through its MCP tools.
'''
    if a.context_file:
        target += '\n## Operator-supplied user material and prior context\n' + Path(a.context_file).read_text() + '\n'
    (run / 'connection/target.md').write_text(target)

    started = now()
    tester_env = {'EVAL_CASE': str(run / 'case'), 'EVAL_RUN': str(run), 'EVAL_CONNECTION': str(run / 'connection'),
                  'EVAL_EXECUTOR_MODEL': a.executor_model, 'EVAL_VERIFIER_MODEL': a.verifier_model}
    if os.environ.get('EVAL_CLAUDE_CREDENTIALS'):
        tester_env['EVAL_CLAUDE_CREDENTIALS'] = os.environ['EVAL_CLAUDE_CREDENTIALS']
    executor_exit = compose(['tester'], run, tester_env, run / 'execution/tester.jsonl', run / 'execution/tester.stderr', a.tester_timeout)
    time.sleep(3)
    recorder.stop()
    after, billing_after, _ = snapshot(base, token)
    # What a run delivered is proven by the saved lead jobs, not by the product's
    # message. Read every job whose id appears in the recorded MCP traffic.
    mcp_log = run / 'observed/mcp.ndjson'
    uuid = r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
    job_ids = set(re.findall(r'job_id[^0-9a-f]{1,12}(' + uuid + ')', mcp_log.read_text())) if mcp_log.exists() else set()
    for job_id in sorted(job_ids):
        after[f'/mcp/jobs/{job_id}'] = api(base, f'/mcp/jobs/{job_id}?limit=100', token)
    (run / 'observed/state-after.json').write_text(json.dumps(after, indent=2))
    (run / 'observed/billing.json').write_text(json.dumps({'before': billing_before, 'after': billing_after, 'tester_started': started, 'tester_finished': now()}, indent=2))

    sources = []
    for p in sorted((run / 'observed/subject').glob('*.jsonl')):
        if p.stat().st_size:
            sources.append({'file': f'observed/subject/{p.name}', 'kind': 'conversation', 'sha256': sha256(p)})
    for name, kind in [('mcp.ndjson', 'tool-results'), ('backend.ndjson', 'backend-recording'), ('state-before.json', 'state-before'), ('state-after.json', 'state-after'), ('billing.json', 'billing')]:
        p = run / 'observed' / name
        if p.exists() and p.stat().st_size:
            sources.append({'file': f'observed/{name}', 'kind': kind, 'sha256': sha256(p)})
    run_doc = {'version': 1, 'case_id': a.case, 'artifacts': artifacts,
               'subject': {'surface': 'claude-code', 'model': a.model, 'mcp_revision': mcp_revision, 'tenant': tenant, 'region': region, 'language': language},
               'executor_exit_code': executor_exit, 'verifier_exit_code': 1, 'sources': sources, 'variant': a.variant}
    (run / 'run.yaml').write_text(json.dumps(run_doc, indent=2))  # JSON is valid YAML

    if a.stage == 'tester':
        print(json.dumps({'case': a.case, 'env': a.env, 'executor_exit_code': executor_exit, 'sources': [x['file'] for x in sources]}))
        sys.exit(0)
    sys.exit(verify(a, run))


def verify(a, run):
    run_doc = json.loads((run / 'run.yaml').read_text())
    tester_env = {'EVAL_CASE': str(run / 'case'), 'EVAL_RUN': str(run), 'EVAL_CONNECTION': str(run / 'connection'),
                  'EVAL_EXECUTOR_MODEL': a.executor_model, 'EVAL_VERIFIER_MODEL': a.verifier_model}
    if os.environ.get('EVAL_CLAUDE_CREDENTIALS'):
        tester_env['EVAL_CLAUDE_CREDENTIALS'] = os.environ['EVAL_CLAUDE_CREDENTIALS']
    verifier_exit = compose(['verifier'], run, tester_env, run / 'verifier.jsonl', run / 'verifier.stderr', a.verifier_timeout)
    verdict = run / 'verifier/verdict.yaml'
    if verdict.exists():
        shutil.copyfile(verdict, run / 'verdict.yaml')
    run_doc['verifier_exit_code'] = verifier_exit
    (run / 'run.yaml').write_text(json.dumps(run_doc, indent=2))
    return gate(a, run, run_doc)


def gate(a, run, run_doc):
    gate_exit = compose(['contracts'], run, {'EVAL_RUN': str(run), 'EVAL_BUNDLE': '/bundle'}, run / 'gate.log', run / 'gate.stderr', 600)
    gate_tail = ((run / 'gate.log').read_text() + (run / 'gate.stderr').read_text())[-1500:]
    summary = {'case': run_doc['case_id'], 'env': a.env, 'variant': run_doc['variant'], 'executor_exit_code': run_doc['executor_exit_code'],
               'verifier_exit_code': run_doc['verifier_exit_code'], 'gate_exit_code': gate_exit, 'sources': [x['file'] for x in run_doc['sources']], 'finished': now()}
    (run / 'summary.json').write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary))
    print(gate_tail)
    return 0 if gate_exit == 0 else 1


if __name__ == '__main__':
    main()
