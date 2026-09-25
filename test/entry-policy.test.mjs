import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldOpenTelegram, telegramLaunchUrl, browserAppUrl} from '../src/entry-policy.js';

const visit = {hostname:'buycfk.com',pathname:'/',search:'',hash:'',initData:''};
test('only external visits to the marketing domain launch Telegram', () => {
  assert.equal(shouldOpenTelegram(visit), true);
  assert.equal(shouldOpenTelegram({...visit,hostname:'www.buycfk.com'}), true);
  for (const change of [
    {hostname:'buy-cfk.vercel.app'}, {hostname:'localhost'}, {hostname:'buycfk.com.attacker.test'},
    {pathname:'/payment/return'}, {pathname:'/api/config'}, {initData:'telegram-context'},
    {hash:'#tgWebAppData=user%3Dexample'}, {search:'?tgWebAppData=example'},
    {search:'?code=callback&state=callback'}, {search:'?privy_oauth_code=callback'}
  ]) assert.equal(shouldOpenTelegram({...visit,...change}), false, JSON.stringify(change));
});

test('Telegram handoff preserves valid start tokens and cannot redirect to an arbitrary bot or host', () => {
  const token = 's_' + 'a'.repeat(32);
  assert.equal(telegramLaunchUrl('?startapp='+token), 'https://t.me/Cashflowkeybot?startapp='+token+'&mode=fullscreen');
  assert.equal(telegramLaunchUrl('?ref=creator_1'), 'https://t.me/Cashflowkeybot?startapp=creator_1&mode=fullscreen');
  for (const search of ['?startapp='+ 'a'.repeat(513), '?startapp=https://evil.test', '?startapp=x%26domain%3Devil']) {
    assert.equal(telegramLaunchUrl(search), 'https://t.me/Cashflowkeybot?startapp=buycfk&mode=fullscreen');
  }
  assert.equal(browserAppUrl('?utm_source=youtube&ref=creator_1'), 'https://buy-cfk.vercel.app/?utm_source=youtube&ref=creator_1');
});
