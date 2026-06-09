import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  safeRedirectPath,
  assertSafePretalxUrl,
  getPretalxAllowedHosts,
} from '../src/security.js';

describe('safeRedirectPath', () => {
  it('allows relative paths', () => {
    assert.equal(safeRedirectPath('/staff'), '/staff');
    assert.equal(safeRedirectPath('/staff/reports'), '/staff/reports');
  });

  it('blocks open redirects', () => {
    assert.equal(safeRedirectPath('//evil.com'), '/staff');
    assert.equal(safeRedirectPath('https://evil.com'), '/staff');
    assert.equal(safeRedirectPath('/\\evil.com'), '/staff');
    assert.equal(safeRedirectPath(undefined), '/staff');
  });
});

describe('assertSafePretalxUrl', () => {
  it('allows configured hosts', () => {
    assert.doesNotThrow(() => assertSafePretalxUrl('https://speakers.southeastlinuxfest.org'));
  });

  it('blocks private hosts', () => {
    assert.throws(() => assertSafePretalxUrl('http://127.0.0.1'), /private or local/);
    assert.throws(() => assertSafePretalxUrl('http://169.254.169.254'), /private or local/);
  });

  it('blocks unknown public hosts', () => {
    assert.throws(() => assertSafePretalxUrl('https://evil.example.org'), /must be one of/);
  });

  it('parses allowed hosts from env', () => {
    const prev = process.env.PRETALX_ALLOWED_HOSTS;
    process.env.PRETALX_ALLOWED_HOSTS = 'pretalx.example.com, speakers.self.org';
    assert.deepEqual(getPretalxAllowedHosts(), ['pretalx.example.com', 'speakers.self.org']);
    process.env.PRETALX_ALLOWED_HOSTS = prev;
  });
});
