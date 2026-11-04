'use strict';

/**
 * Yerel (ücretsiz) modeller (src/main/pricing.ts): yerel motorların modelleri
 * $0 fiyatlanır; tanınmayan uzak modeller eskisi gibi Sonnet'ten.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const P = loadTs('src/main/pricing.ts');
const TOKENS = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

test('yerel motorun modeli ücretsiz; uç-nokta önekli ad da tanınır', () => {
  P.setFreeModels(['emrettc-genel', 'Qwen3-Coder:30B', undefined, '']);
  assert.equal(P.estimateCostUsd('emrettc-genel', TOKENS), 0);
  assert.equal(P.estimateCostUsd('ollama-general/emrettc-genel', TOKENS), 0);
  assert.equal(P.estimateCostUsd('qwen3-coder:30b', TOKENS), 0, 'büyük/küçük harf duyarsız');
  assert.equal(P.isFreeModel('emrettc-genel[1m]'), true, 'Claude Code varyant eki atılır');
  assert.equal(P.isFreeModel(''), false);
  P.setFreeModels([]);
});

test('uzak ve tanınmayan modeller eskisi gibi ücretli', () => {
  P.setFreeModels(['emrettc-genel']);
  assert.ok(P.estimateCostUsd('claude-opus-4-8', TOKENS) > 0);
  assert.ok(P.estimateCostUsd('gpt-6.1-sol', TOKENS) > 0, 'tanınmayan uzak model Sonnet fiyatından');
  assert.ok(P.estimateCostUsd('emrettc-genel-x', TOKENS) > 0, 'yalnız tam ad eşleşir');
  P.setFreeModels([]);
  assert.ok(P.estimateCostUsd('emrettc-genel', TOKENS) > 0, 'liste boşalınca yine ücretli');
});
