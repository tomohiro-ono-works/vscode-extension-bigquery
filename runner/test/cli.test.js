'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCliInvocation, runSpawnedCommand } = require('../src/cli');

test('uses a fixed cmd.exe wrapper on Windows without shell interpolation', () => {
  assert.deepEqual(resolveCliInvocation('bq', ['query','--dry_run=true'], 'win32'), {
    file: 'cmd.exe', args: ['/d','/s','/c','bq.cmd','query','--dry_run=true']
  });
  assert.deepEqual(resolveCliInvocation('gcloud', ['config','get-value','project'], 'linux'), {
    file: 'gcloud', args: ['config','get-value','project']
  });
  assert.throws(() => resolveCliInvocation('curl', [], 'linux'), /not allowed/i);
  assert.throws(() => resolveCliInvocation('bq', ['query','&& bad'], 'win32'), /unsafe/i);
});

test('transports special characters solely over stdin to a real child process', async () => {
  const input = "SELECT 'a; $HOME `x`'\nFROM demo;";
  const result = await runSpawnedCommand(process.execPath, [
    '-e', 'process.stdin.setEncoding("utf8");let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>process.stdout.write(s));'
  ], {stdin: input});
  assert.equal(result.stdout, input);
});

test('reports nonzero exit status and bounds subprocess running time', async () => {
  await assert.rejects(runSpawnedCommand(process.execPath, [
    '-e', 'process.stderr.write("failure");process.exit(7)'
  ], {}), /exit code 7.*failure/i);
  await assert.rejects(runSpawnedCommand(process.execPath, [
    '-e', 'setTimeout(()=>{},10000)'
  ], {timeoutMs: 100}), /timed out/i);
});

test('rejects excessive subprocess output', async () => {
  await assert.rejects(runSpawnedCommand(process.execPath, [
    '-e', 'process.stdout.write("x".repeat(10000))'
  ], {maxOutputBytes: 1024}), /output.*limit/i);
});
