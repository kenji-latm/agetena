import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
const build = workflow.split('\n  build:\n')[1].split('\n  deploy:\n')[0];
const deploy = workflow.split('\n  deploy:\n')[1].split('\n  audit:\n')[0];
const uploadedName = build.match(/uses: actions\/upload-pages-artifact@v3\s+with:\s+name: (.+)/)?.[1];
const outputName = build.match(/\n    outputs:\s+(?:#[^\n]*\n\s*)?pages_artifact_name: (.+)/)?.[1];
const selectedName = deploy.match(/uses: actions\/deploy-pages@v4\s+with:\s+artifact_name: (.+)/)?.[1];

// Model deploy-pages' exact-name selection against artifacts retained across attempts.
function upload(attempt) {
  assert.equal(uploadedName, 'github-pages-${{ github.run_attempt }}');
  assert.equal(outputName, uploadedName);
  return { name: uploadedName.replace('${{ github.run_attempt }}', String(attempt)), attempt };
}
function select(artifacts, producingBuild) {
  assert.match(deploy, /\n    needs: build\n/);
  assert.equal(selectedName, '${{ needs.build.outputs.pages_artifact_name }}');
  const matches = artifacts.filter(artifact => artifact.name === producingBuild.name);
  assert.equal(matches.length, 1);
  return matches[0];
}

test('Pages full rerun selects the new build despite retained legacy and prior-attempt artifacts', () => {
  const first = upload(1), second = upload(2);
  const artifacts = [{ name: 'github-pages' }, { name: 'github-pages' }, first, second];
  assert.notEqual(first.name, second.name);
  assert.equal(select(artifacts, second), second);
});

test('Pages deploy-only rerun retains the successful build artifact instead of using the new run attempt', () => {
  const first = upload(1), second = upload(2);
  const artifacts = [first, second];
  for (const deployAttempt of [3, 4]) {
    assert.ok(!artifacts.some(artifact => artifact.name === `github-pages-${deployAttempt}`));
    assert.equal(select(artifacts, second), second);
  }
});
