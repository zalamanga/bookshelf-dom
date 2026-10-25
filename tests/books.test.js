import test from 'node:test';
import assert from 'node:assert/strict';
import { addBook, createStorage, matchingBooks, normalizeBook, parseBooks, updateBook, MAX_BOOKS } from '../src/script/books.js';

const example = (extra = {}) => ({ id: 'test-1', title: 'Buku Contoh', author: 'Penulis Contoh', year: 2024, category: 'Sejarah', image: '', isComplete: false, ...extra });
function memory(initial = null) {
  let raw = initial;
  return { getItem: () => raw, setItem: (_, value) => { raw = value; }, value: () => raw };
}

test('legacy numeric IDs/year and Komedia migrate without losing the book', () => {
  const result = parseBooks(JSON.stringify([example({ id: 1700000000000, year: '2023', category: 'Komedia' })]));
  assert.equal(result[0].id, '1700000000000');
  assert.equal(result[0].year, 2023);
  assert.equal(result[0].category, 'Komedi');
});
test('domain validation rejects blank fields, controls, invalid dates, status and category', () => {
  for (const input of [{ title: ' ' }, { author: 'one\nline' }, { year: '2024.5' }, { year: '-1' }, { year: 10000 }, { category: 'Missing' }, { isComplete: 'false' }]) assert.throws(() => normalizeBook(example(input)));
});
test('covers accept only HTTP(S) without user credentials; empty cover is valid', () => {
  for (const image of ['javascript:alert(1)', 'data:image/png;base64,x', 'file:///C:/test.png', 'https://user:secret@example.com/a.png']) assert.throws(() => normalizeBook(example({ image })));
  assert.equal(normalizeBook(example({ image: 'https://example.com/cover.png' })).image, 'https://example.com/cover.png');
  assert.equal(normalizeBook(example()).image, '');
});
test('malformed storage, duplicate IDs, oversized data and invalid records are rejected whole', () => {
  for (const raw of ['broken{', '{}', JSON.stringify([example(), example()]), JSON.stringify([example({ year: 0 })]), ' '.repeat(2_000_001)]) assert.throws(() => parseBooks(raw));
  assert.deepEqual(parseBooks(null), []);
});
test('add/edit/toggle preserve other records and do not mutate original array', () => {
  const initial = [example()];
  const added = addBook(initial, example({ title: 'Kedua' }), () => 'new-id');
  const changed = updateBook(added, { ...added[1], title: 'Edisi baru', isComplete: true });
  assert.equal(initial.length, 1);
  assert.equal(changed[0], initial[0]);
  assert.equal(changed[1].title, 'Edisi baru');
  assert.equal(changed[1].isComplete, true);
  assert.equal(added[1].isComplete, false);
  assert.throws(() => updateBook(initial, example({ id: 'missing' })));
  assert.throws(() => addBook(initial, example(), () => 'test-1'));
});
test('shelf limit rejects another entry', () => {
  assert.throws(() => addBook(Array.from({ length: MAX_BOOKS }, (_, i) => example({ id: String(i) })), example(), () => 'extra'));
});
test('a valid shelf cannot be grown beyond its own reload size limit', () => {
  const books = Array.from({ length: 990 }, (_, index) => example({ id: String(index), image: `https://example.com/${'a'.repeat(1876)}` }));
  assert.equal(parseBooks(JSON.stringify(books)).length, 990);
  assert.throws(() => addBook(books, example({ image: `https://example.com/${'a'.repeat(2000)}` }), () => 'extra'), /Rak terlalu besar/u);
  assert.throws(() => updateBook(books, example({ id: '0', title: 'x'.repeat(200), image: `https://example.com/${'a'.repeat(2000)}` })), /Rak terlalu besar/u);
});
test('toggling a boundary-size shelf rejects the extra byte without changing reading status', () => {
  const books = Array.from({ length: 990 }, (_, index) => example({ id: String(index), image: `https://example.com/${'a'.repeat(1876)}` }));
  books[0] = { ...books[0], title: 'x'.repeat(200), author: 'y'.repeat(135), isComplete: true };
  assert.equal(JSON.stringify(books).length, 2_000_000);
  assert.throws(() => updateBook(books, { ...books[0], isComplete: false }), /Rak terlalu besar/u);
  assert.equal(books[0].isComplete, true);
});
test('search combines title and author, ignores case/outer whitespace, and treats HTML literally', () => {
  const books = [example({ title: '<img src=x>', author: 'Rafik' }), example({ id: '2', title: 'CERITA', author: 'Nina' })];
  assert.equal(matchingBooks(books, ' RAFIK ')[0].id, 'test-1');
  assert.equal(matchingBooks(books, 'cerita')[0].id, '2');
  assert.equal(matchingBooks(books, '<img')[0].id, 'test-1');
  assert.equal(matchingBooks(books, '').length, 2);
});
test('valid storage round-trip retains records and reports success only after write', () => {
  const data = memory();
  const store = createStorage(() => data);
  assert.deepEqual(store.load().books, []);
  assert.equal(store.save([example()]).status, 'saved');
  assert.deepEqual(parseBooks(data.value()), [example()]);
});
test('corrupt storage is not overwritten until an explicit replacement', () => {
  const data = memory('{broken');
  const store = createStorage(() => data);
  assert.equal(store.load().status, 'corrupt');
  assert.equal(store.save([example()]).status, 'corrupt');
  assert.equal(data.value(), '{broken');
  assert.equal(store.save([example()], true).status, 'saved');
  assert.deepEqual(parseBooks(data.value()), [example()]);
});
test('quota/write failure preserves persistent data and supports retry', () => {
  const data = memory('[]');
  let fail = true;
  const store = createStorage(() => ({ getItem: data.getItem, setItem: (...args) => { if (fail) throw new Error('Quota'); data.setItem(...args); } }));
  store.load();
  assert.equal(store.save([example()]).status, 'unavailable');
  assert.equal(data.value(), '[]');
  fail = false;
  assert.equal(store.save([example()]).status, 'saved');
});
test('blocked storage getter returns a visible fallback state', () => {
  const store = createStorage(() => { throw new Error('SecurityError'); });
  assert.deepEqual(store.load().books, []);
  assert.equal(store.save([example()]).status, 'unavailable');
});
test('another tab change never gets silently overwritten, including corrupt-data replacement', () => {
  const data = memory('[]');
  const store = createStorage(() => data);
  store.load();
  data.setItem('BOOKSHELF', JSON.stringify([example({ title: 'Tab lain' })]));
  assert.equal(store.save([example()]).status, 'conflict');
  assert.equal(parseBooks(data.value())[0].title, 'Tab lain');
  assert.equal(store.load().books[0].title, 'Tab lain');
});
