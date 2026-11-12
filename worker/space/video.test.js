import test from 'node:test';
import assert from 'node:assert/strict';
import { videoSource } from '../../web/space/panels/video.js';
test('only approved YouTube and Vimeo IDs become embed URLs', () => {
  assert.equal(videoSource('https://www.youtube.com/watch?v=ABCDEFGHIJK&t=42').player, 'https://www.youtube-nocookie.com/embed/ABCDEFGHIJK?rel=0');
  assert.equal(videoSource('https://youtu.be/ABCDEFGHIJK').type, 'embed');
  assert.equal(videoSource('https://youtube.com/live/ABCDEFGHIJK').type, 'embed');
  assert.equal(videoSource('https://vimeo.com/12345').player, 'https://player.vimeo.com/video/12345');
  assert.equal(videoSource('https://www.youtube.com/@publisher').type, 'external');
  assert.equal(videoSource('https://youtube.com.attacker.test/watch?v=ABCDEFGHIJK').type, 'external');
  assert.equal(videoSource('https://youtube.com/watch?v=wrong').type, 'external');
});
test('direct video files and external publisher pages retain safe links; active URLs are rejected', () => {
  assert.equal(videoSource('https://publisher.test/market.webm?token=abc').type, 'video');
  assert.equal(videoSource('https://publisher.test/live').type, 'external');
  assert.equal(videoSource('http://publisher.test/live').type, 'external');
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/movie.mp4', 'https://user:pass@publisher.test/movie.mp4', '', '//publisher.test/video']) assert.equal(videoSource(url), null);
});
