"""Exercise the real Pi TUI with a local fake provider; no credentials required."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parent.parent
work = tempfile.mkdtemp(prefix='pi-side-smoke-')
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 110, 0, 0))
env = dict(os.environ, TERM='xterm-256color', PI_CODING_AGENT_DIR=work + '/agent',
           PI_SIDE_TEST_LOG=work + '/requests.jsonl', PI_SKIP_VERSION_CHECK='1')
cli = ROOT / 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js'
proc = subprocess.Popen(['node', str(cli), '--no-session', '--no-extensions', '--no-skills', '--no-prompt-templates',
                         '-e', str(ROOT / 'extensions/side.ts'), '-e', str(ROOT / 'test/fake-provider.ts'),
                         '--provider', 'side-test', '--model', 'fake'],
                        cwd=work, env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
os.close(slave)
output = bytearray()


def read_for(seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if select.select([master], [], [], min(0.1, max(0, deadline - time.monotonic())))[0]:
            try:
                chunk = os.read(master, 65536)
            except OSError:
                break
            output.extend(chunk)
            if b'\x1b[6n' in chunk:
                os.write(master, b'\x1b[1;1R')


def expect(text, timeout=15, since=0):
    deadline = time.monotonic() + timeout
    while text.encode() not in output[since:]:
        if time.monotonic() > deadline or proc.poll() is not None:
            raise AssertionError(f'Missing terminal text: {text}; exit={proc.poll()}')
        read_for(0.1)


def send(text):
    os.write(master, text.encode())
    read_for(0.2)


try:
    read_for(3)
    send('/side Explain this approach\r')
    expect('SIDE_REPLY_1')
    requests = [json.loads(line) for line in Path(work + '/requests.jsonl').read_text().splitlines()]
    assert not requests[0].get('tools'), 'Side request unexpectedly has tools'
    assert 'Explain this approach' in json.dumps(requests[0])
    send('What about alternatives?\r')
    expect('SIDE_REPLY_2')
    requests = [json.loads(line) for line in Path(work + '/requests.jsonl').read_text().splitlines()]
    assert 'SIDE_REPLY_1' in json.dumps(requests[1]), 'Follow-up lost side history'
    send('\x1b')
    read_for(0.5)
    before = len(output)
    send('/side\r')
    expect('SIDE_REPLY_2', since=before)
    before = len(output)
    send('\x13')
    expect('Side answer added to the main editor', since=before)
    requests = Path(work + '/requests.jsonl').read_text().splitlines()
    assert len(requests) == 2, 'Sharing triggered an unexpected model turn'
    print('PASS: real Pi TUI opens, answers, follows up, reopens, and shares without running the main agent')
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    os.close(master)
    artifacts = ROOT / 'output'
    artifacts.mkdir(exist_ok=True)
    (artifacts / 'terminal-smoke.log').write_bytes(output)
    shutil.rmtree(work)
