import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreFlashcards, flashcardDeck } from '../flashcards.js';

const questions = [{id:'1-1'}, {id:'1-2'}, {id:'2-1'}];

test('restoring progress drops obsolete IDs and invalid ratings', () => {
  assert.deepEqual(restoreFlashcards({marks:{'1-1':'known','1-2':'review','2-1':'invalid',removed:'known'},currentId:'1-2'}, questions), {
    marks:{'1-1':'known','1-2':'review'}, currentId:'1-2'
  });
  assert.deepEqual(restoreFlashcards(null, questions), {marks:{},currentId:'1-1'});
  assert.equal(restoreFlashcards({currentId:'removed'}, questions).currentId, '1-1');
});

test('review deck contains only explicitly marked cards and updates after learning one', () => {
  const marks = {'1-1':'known','1-2':'review'};
  assert.deepEqual(flashcardDeck(questions,marks,'review'), [questions[1]]);
  marks['1-2']='known';
  assert.deepEqual(flashcardDeck(questions,marks,'review'), []);
  assert.deepEqual(flashcardDeck(questions,marks,'all'), questions);
  assert.notEqual(flashcardDeck(questions,marks,'all'), questions);
});
