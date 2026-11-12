import test from 'node:test';
import assert from 'node:assert/strict';
import { NEWS_TOPIC_GROUPS, newsTopic, matchesNewsTopic } from '../../web/space/panels/news-topics.js';

test('all twenty-six observed topic labels stay grouped with unique filter identifiers', () => {
  assert.equal(NEWS_TOPIC_GROUPS.length, 5);
  const all = NEWS_TOPIC_GROUPS.flatMap(g => g.topics);
  assert.equal(all.length, 26); assert.equal(new Set(all.map(t => t.id)).size, 26);
  assert.equal(newsTopic('housing').label, 'Housing market');
  assert.equal(newsTopic('missing'), null);
});
test('topic filters use loaded headline text and tags without treating a source name as editorial access', () => {
  assert.equal(matchesNewsTopic({ title: 'Homebuilders rise as mortgage rates fall' }, 'housing'), true);
  assert.equal(matchesNewsTopic({ summary: 'Fed interest rates may change after inflation data.' }, 'us-economy'), true);
  assert.equal(matchesNewsTopic({ tags: ['Artificial intelligence'] }, 'ai'), true);
  assert.equal(matchesNewsTopic({ title: 'Options premium reaches a new high', source: 'Yahoo Finance' }, 'premium-news'), false);
  assert.equal(matchesNewsTopic({ title: 'Stocks rise', source: 'Yahoo Finance' }, 'morning-brief'), false);
  assert.equal(matchesNewsTopic({ title: 'Morning Brief: stocks rise' }, 'morning-brief'), true);
  assert.equal(matchesNewsTopic({ title: 'A new regulation applies' }, 'ai'), false, 'AI cannot match inside another word');
});
test('empty or unrelated loaded data stays empty for a specific topic, and default keeps every item', () => {
  const items = [{ title: 'Chipmaker raises guidance' }, { title: 'Housing market slows' }];
  assert.deepEqual(items.filter(item => matchesNewsTopic(item, 'housing')), [items[1]]);
  assert.deepEqual(items.filter(item => matchesNewsTopic(item, 'good-buy')), []);
  assert.deepEqual(items.filter(item => matchesNewsTopic(item, '')), items);
  assert.equal(matchesNewsTopic(null, 'housing'), false);
  assert.equal(matchesNewsTopic(items[0], 'unknown-topic'), false);
});
