import { addBook, createStorage, matchingBooks, updateBook } from './books.js';

const $ = id => document.getElementById(id);
const storage = createStorage(() => window.localStorage);
let { books, ...saveState } = storage.load();
let editingId = null;
let query = '';
let confirmAction = null;
let confirmFocus = null;

function announce(message) { $('status').textContent = message; }
function setSaveState(state) {
  saveState = state;
  const messages = {
    corrupt: 'Data tersimpan tidak dapat dibaca. Data asli tetap utuh. Perubahan rak baru hanya sementara sampai kamu memilih Ganti data rusak. Unduh data asli lebih dulu jika masih dibutuhkan.',
    unavailable: 'Rak saat ini hanya tersedia selama halaman terbuka karena penyimpanan browser gagal. Unduh salinan atau coba simpan lagi sebelum menutup halaman.',
    conflict: 'Data browser berubah di tab lain. Perubahan pada halaman ini belum disimpan agar data tab lain tetap utuh. Unduh rak saat ini sebelum memuat data tersimpan.',
  };
  $('storage-warning').hidden = state.status === 'saved';
  $('storage-message').textContent = messages[state.status] || '';
  $('retry-save').hidden = state.status !== 'unavailable';
  $('download-raw').hidden = state.status !== 'corrupt' || typeof state.raw !== 'string';
  $('replace-storage').hidden = state.status !== 'corrupt';
  $('reload-storage').hidden = state.status !== 'conflict';
}
function save(message) {
  setSaveState(storage.save(books));
  announce(saveState.status === 'saved' ? message : 'Perubahan rak berlaku sementara. Periksa pemberitahuan penyimpanan sebelum menutup halaman.');
}
function actionButton(label, handler, dangerous = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (dangerous) button.className = 'danger';
  button.addEventListener('click', handler);
  return button;
}
function confirm(title, description, label, action, focus) {
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = description;
  $('confirm-action').textContent = label;
  $('confirm-dialog').returnValue = '';
  confirmAction = action;
  confirmFocus = focus || document.activeElement;
  $('confirm-dialog').showModal();
}
$('confirm-dialog').addEventListener('close', () => {
  const action = confirmAction;
  const focus = confirmFocus;
  confirmAction = null;
  if ($('confirm-dialog').returnValue === 'confirm') action?.();
  if (focus?.isConnected) focus.focus(); else $('shelves').focus();
});
function bookCard(book) {
  const card = document.createElement('article');
  card.className = 'book';
  card.dataset.bookId = book.id;
  const cover = document.createElement('div');
  cover.className = 'cover';
  cover.textContent = 'Tanpa sampul';
  if (book.image) {
    const image = document.createElement('img');
    image.alt = `Sampul ${book.title}`;
    image.loading = 'lazy';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { cover.textContent = 'Sampul tidak tersedia'; }, { once: true });
    image.src = book.image;
    cover.replaceChildren(image);
  }
  const detail = document.createElement('div');
  const title = document.createElement('h4');
  title.textContent = book.title;
  const author = document.createElement('p');
  author.textContent = book.author;
  const metadata = document.createElement('p');
  metadata.textContent = `${book.year} · ${book.category}`;
  detail.append(title, author, metadata);
  const actions = document.createElement('div');
  actions.className = 'actions';
  const toggle = actionButton(book.isComplete ? 'Baca kembali' : 'Tandai selesai', () => {
    try {
      books = updateBook(books, { ...book, isComplete: !book.isComplete });
      save(`Status “${book.title}” diperbarui.`);
      render();
      document.querySelector(`[data-book-id="${book.id}"] button`)?.focus();
    } catch (error) {
      announce(error.message);
    }
  });
  const edit = actionButton('Edit', () => editBook(book));
  edit.setAttribute('aria-label', `Edit ${book.title}`);
  const remove = actionButton('Hapus', () => confirm('Hapus buku?', `“${book.title}” akan dikeluarkan dari rak ini.`, 'Hapus buku', () => {
    books = books.filter(item => item.id !== book.id);
    if (editingId === book.id) resetForm();
    save(`“${book.title}” dihapus dari rak.`);
    render();
  }, remove), true);
  remove.setAttribute('aria-label', `Hapus ${book.title}`);
  actions.append(toggle, edit, remove);
  card.append(cover, detail, actions);
  return card;
}
function render() {
  const matching = matchingBooks(books, query);
  for (const [completed, listId, countId] of [[false, 'unread-books', 'unread-count'], [true, 'read-books', 'read-count']]) {
    const items = matching.filter(book => book.isComplete === completed);
    $(countId).textContent = String(items.length);
    $(listId).replaceChildren(...items.map(bookCard));
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = query ? 'Tidak ada buku yang cocok di rak ini.' : completed ? 'Buku yang sudah selesai akan tampil di sini.' : 'Rak ini masih kosong. Tambahkan buku pertamamu lewat formulir.';
      $(listId).append(empty);
    }
  }
  $('count-summary').textContent = `${books.length} buku di rak`;
  $('search-summary').textContent = query ? `${matching.length} hasil untuk “${query}”.` : '';
  $('clear-search').hidden = !query;
}
function resetForm() {
  editingId = null;
  $('book-form').reset();
  $('form-title').textContent = 'Tambahkan buku';
  $('save-book').textContent = 'Tambahkan ke rak';
  $('cancel-edit').hidden = true;
  $('form-error').hidden = true;
}
function editBook(book) {
  editingId = book.id;
  for (const key of ['title', 'author', 'year', 'category', 'image']) $(key).value = book[key];
  $('is-complete').checked = book.isComplete;
  $('form-title').textContent = 'Edit buku';
  $('save-book').textContent = 'Simpan perubahan';
  $('cancel-edit').hidden = false;
  $('form-error').hidden = true;
  $('title').focus();
}
$('book-form').addEventListener('submit', event => {
  event.preventDefault();
  const value = Object.fromEntries(new FormData(event.currentTarget));
  value.isComplete = $('is-complete').checked;
  try {
    const wasEditing = editingId !== null;
    books = wasEditing ? updateBook(books, { ...value, id: editingId }) : addBook(books, value);
    resetForm();
    save(wasEditing ? 'Perubahan buku disimpan.' : 'Buku ditambahkan ke rak.');
    render();
    $('title').focus();
  } catch (error) {
    $('form-error').textContent = error.message;
    $('form-error').hidden = false;
  }
});
$('cancel-edit').addEventListener('click', () => { resetForm(); announce('Edit dibatalkan.'); $('title').focus(); });
$('search-form').addEventListener('submit', event => { event.preventDefault(); query = $('query').value.trim(); render(); announce(query ? $('search-summary').textContent : 'Semua buku ditampilkan.'); });
$('clear-search').addEventListener('click', () => { query = ''; $('query').value = ''; render(); announce('Semua buku ditampilkan.'); $('query').focus(); });
function download(content, filename) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const id of ['export-books', 'download-current']) $(id).addEventListener('click', () => { download(JSON.stringify(books, null, 2), 'buka-buku-rak.json'); announce('Salinan rak diunduh sebagai JSON.'); });
$('download-raw').addEventListener('click', () => download(saveState.raw, 'buka-buku-data-asli.json'));
$('retry-save').addEventListener('click', () => save('Penyimpanan dicoba kembali.'));
$('replace-storage').addEventListener('click', () => confirm('Ganti data browser yang rusak?', 'Data asli akan diganti oleh rak yang sedang tampil. Unduh data asli terlebih dulu jika masih dibutuhkan.', 'Ganti data', () => { setSaveState(storage.save(books, true)); announce(saveState.status === 'saved' ? 'Rak sekarang tersimpan di browser.' : 'Penyimpanan belum berhasil. Data asli belum diganti.'); }));
$('reload-storage').addEventListener('click', () => confirm('Muat data tersimpan?', 'Perubahan sementara di halaman ini akan diganti dengan data browser. Unduh rak saat ini terlebih dulu jika masih dibutuhkan.', 'Muat data', () => { const loaded = storage.load(); books = loaded.books; setSaveState(loaded); resetForm(); render(); announce('Data browser dimuat kembali.'); }));
window.addEventListener('storage', event => {
  try {
    if (event.storageArea === window.localStorage && (event.key === 'BOOKSHELF' || event.key === null)) setSaveState({ status: 'conflict', raw: saveState.raw });
  } catch { /* A blocked storage getter already has a visible fallback. */ }
});
render();
setSaveState(saveState);
announce(saveState.status === 'saved' ? 'Rak siap. Perubahan disimpan di browser ini.' : 'Rak siap dengan pemberitahuan penyimpanan.');
