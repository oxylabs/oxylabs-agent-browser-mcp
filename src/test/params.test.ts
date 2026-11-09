// Parameter validation table: accepted sets with normalisation, every rejection rule, env-default merging and
// HB_DEFAULT_PARAMS parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeParams, paramsFromQueryString, toQueryString, validateParams } from '../hb/params.js';

test('accepts a full public parameter set with normalisation', () => {
  const p = validateParams({
    session_name: 'job-42',
    keep_alive: true,
    proxy: 'resi',
    cc: 'us',
    state: 'Texas',
    city: 'Los Angeles',
    proxy_resi_ses_id: 'acmeus01',
    proxy_resi_ses_time: 30,
    device: 'desktop',
    browser: 'oxybrowser',
    fp_tag: 'oxyfp_mac_optimized',
    profile_name: 'acme-us-01',
    profile_save: true,
    record: true,
    record_name: 'job_42',
    page_handler: false,
  });
  assert.equal(p.cc, 'US');
  assert.equal(p.state, 'texas');
  assert.equal(p.city, 'los_angeles');
  assert.equal(
    toQueryString(p),
    'browser=oxybrowser&cc=US&city=los_angeles&device=desktop&fp_tag=oxyfp_mac_optimized&keep_alive=true&page_handler=false&profile_name=acme-us-01&profile_save=true&proxy=resi&proxy_resi_ses_id=acmeus01&proxy_resi_ses_time=30&record=true&record_name=job_42&session_name=job-42&state=texas',
  );
});

const rejects: Array<[string, Record<string, unknown>, RegExp]> = [
  ['session_name format', { session_name: 'a_b' }, /session_name must be 3-36/],
  ['keep_alive without name', { keep_alive: true }, /keep_alive requires session_name/],
  ['proxy=dc with geo', { proxy: 'dc', cc: 'US', proxy_resi_ses_id: 'abc' }, /proxy=dc does not support \[cc proxy_resi_ses_id\]/],
  ['bad proxy', { proxy: 'ddc' }, /proxy/],
  ['bad cc', { cc: 'USA' }, /invalid cc/],
  ['city alone', { city: 'berlin' }, /city requires cc or state/],
  ['sticky id format', { proxy_resi_ses_id: '_abc' }, /proxy_resi_ses_id must be/],
  ['sticky time range', { proxy_resi_ses_time: 0 }, /proxy_resi_ses_time must be between 1 and 1440/],
  ['tablet', { device: 'tablet' }, /device/],
  ['unknown engine', { browser: 'cachro' }, /browser/],
  ['unknown browser profile tag', { fp_tag: 'v1' }, /fp_tag/],
  ['mac_optimized without oxybrowser', { fp_tag: 'oxyfp_mac_optimized' }, /oxyfp_mac_optimized requires browser=oxybrowser/],
  ['browser profile tag on mobile', { device: 'mobile', fp_tag: 'oxyfp_mac' }, /desktop profile family/],
  ['profile format', { profile_name: 'ab' }, /profile_name must contain/],
  ['profile save without profile', { profile_save: true }, /profile_save requires profile_name/],
  ['record_name without record', { record_name: 'x' }, /record_name requires record=true/],
  ['record_name format', { record: true, record_name: 'a b' }, /record_name must contain/],
  ['internal param', { fp_id: '1' }, /fp_id is not a public parameter/],
  ['unknown param', { foo: 'bar' }, /unknown parameter foo/],
  ['wrong type', { record: 'yes' }, /record/],
];

test('accepts every public browser engine and browser profile tag', () => {
  for (const tag of ['oxyfp_win', 'oxyfp_mac', 'oxyfp_v1_win']) {
    assert.deepEqual(validateParams({ fp_tag: tag }), { fp_tag: tag });
    assert.deepEqual(validateParams({ fp_tag: tag, browser: 'oxybrowser' }), { fp_tag: tag, browser: 'oxybrowser' });
  }
  assert.deepEqual(validateParams({ browser: 'oxybrowser' }), { browser: 'oxybrowser' });
  assert.equal(toQueryString(validateParams({ cc: 'US', browser: 'oxybrowser', fp_tag: 'oxyfp_mac_optimized' })), 'browser=oxybrowser&cc=US&fp_tag=oxyfp_mac_optimized');
  // The engine rule applies after env defaults are merged, in both directions.
  const engine = validateParams({ browser: 'oxybrowser' });
  assert.deepEqual(mergeParams(engine, { fp_tag: 'oxyfp_mac_optimized' }), { browser: 'oxybrowser', fp_tag: 'oxyfp_mac_optimized' });
  assert.throws(() => mergeParams(engine, { fp_tag: 'oxyfp_mac_optimized' }, true), /requires browser=oxybrowser/);
  assert.deepEqual(paramsFromQueryString('browser=oxybrowser&fp_tag=oxyfp_mac_optimized'), { browser: 'oxybrowser', fp_tag: 'oxyfp_mac_optimized' });
});

for (const [name, input, re] of rejects) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateParams(input), re);
  });
}

test('merges env defaults and applies combination rules after the merge', () => {
  const defaults = validateParams({ cc: 'US' });
  assert.throws(() => mergeParams(defaults, { proxy: 'dc' }), /proxy=dc does not support \[cc\]/);
  const replaced = mergeParams(defaults, { proxy: 'dc' }, true);
  assert.deepEqual(replaced, { proxy: 'dc' });
  const merged = mergeParams(defaults, { device: 'mobile' });
  assert.deepEqual(merged, { cc: 'US', device: 'mobile' });
});

test('parses HB_DEFAULT_PARAMS query strings with coercion', () => {
  const p = paramsFromQueryString('?cc=de&record=1&proxy_resi_ses_time=15&page_handler=false');
  assert.deepEqual(p, { cc: 'DE', record: true, proxy_resi_ses_time: 15, page_handler: false });
  assert.throws(() => paramsFromQueryString('keep_alive=true'), /keep_alive requires session_name/);
});

test('deprecated o_profile names are folded into profile params', () => {
  const p = validateParams({ o_profile: 'acme-us-01', o_profile_save: true });
  assert.equal(p.profile_name, 'acme-us-01');
  assert.equal(p.profile_save, true);
  assert.equal(toQueryString(p), 'profile_name=acme-us-01&profile_save=true');
  const both = validateParams({ profile_name: 'new', o_profile: 'old' });
  assert.equal(both.profile_name, 'new');
  assert.throws(() => validateParams({ o_profile_save: true }), /profile_save requires profile_name/);
  assert.deepEqual(paramsFromQueryString('o_profile=acme-us-01&o_profile_save=true'), { profile_name: 'acme-us-01', profile_save: true });
});

test('deprecated p_src is folded into browser', () => {
  assert.deepEqual(validateParams({ p_src: 'oxybrowser' }), { browser: 'oxybrowser' });
  assert.deepEqual(paramsFromQueryString('p_src=oxybrowser&fp_tag=oxyfp_mac_optimized'), { browser: 'oxybrowser', fp_tag: 'oxyfp_mac_optimized' });
  assert.equal(validateParams({ browser: 'oxybrowser', p_src: 'cachro' }).browser, 'oxybrowser');
});

test('deprecated p_cc, p_state and p_city are folded into cc, state and city', () => {
  assert.deepEqual(validateParams({ p_cc: 'us', p_state: 'Texas', p_city: 'Dallas' }), { cc: 'US', state: 'texas', city: 'dallas' });
  assert.deepEqual(paramsFromQueryString('p_cc=de'), { cc: 'DE' });
  assert.deepEqual(mergeParams(validateParams({ cc: 'US' }), { p_cc: 'DE' }), { cc: 'DE' });
  assert.equal(validateParams({ cc: 'DE', p_cc: 'US' }).cc, 'DE');
});

test('deprecated p_device is folded into device', () => {
  assert.deepEqual(validateParams({ p_device: 'mobile' }), { device: 'mobile' });
  assert.equal(validateParams({ device: 'desktop', p_device: 'mobile' }).device, 'desktop');
  assert.throws(() => validateParams({ p_device: 'tablet' }), /device/);
});

test('deprecated p_fp_tag is folded into fp_tag and p_fp_id stays internal', () => {
  assert.deepEqual(validateParams({ p_fp_tag: 'oxyfp_mac' }), { fp_tag: 'oxyfp_mac' });
  assert.equal(validateParams({ fp_tag: 'oxyfp_win', p_fp_tag: 'oxyfp_mac' }).fp_tag, 'oxyfp_win');
  assert.throws(() => validateParams({ p_fp_id: '1' }), /fp_id is not a public parameter/);
});
