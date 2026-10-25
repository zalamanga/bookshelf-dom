export const STORAGE_KEY = 'BOOKSHELF';
export const CATEGORIES = ['Politik', 'Petualangan', 'Komedi', 'Anak-anak', 'Horor', 'Misteri', 'Romantis', 'Thriller', 'Sejarah', 'Lainnya'];
export const MAX_BOOKS = 1000;

function text(value, name, maximum) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${name} tidak valid.`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${name} wajib diisi, maksimal ${maximum} karakter.`);
  return result;
}

export function normalizeBook(value, id = value?.id) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Data buku tidak valid.');
  const bookId = String(id ?? '');
  if (!/^[a-zA-Z0-9-]{1,80}$/u.test(bookId)) throw new Error('ID buku tidak valid.');
  const category = value.category === 'Komedia' ? 'Komedi' : value.category;
  if (!CATEGORIES.includes(category)) throw new Error('Pilih kategori buku yang tersedia.');
  const rawYear = String(value.year ?? '');
  if (!/^\d{1,4}$/u.test(rawYear) || Number(rawYear) < 1) throw new Error('Tahun terbit harus angka bulat antara 1 dan 9999.');
  if (typeof value.isComplete !== 'boolean') throw new Error('Status bacaan tidak valid.');
  const image = typeof value.image === 'string' ? value.image.trim() : '';
  if (image) {
    let url;
    try { url = new URL(image); } catch { throw new Error('URL sampul harus berupa alamat HTTP atau HTTPS.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || image.length > 2048) throw new Error('URL sampul harus berupa alamat HTTP atau HTTPS tanpa kredensial.');
  }
  return { id: bookId, title: text(value.title, 'Judul', 200), author: text(value.author, 'Penulis', 160), year: Number(rawYear), category, image, isComplete: value.isComplete };
}

export function parseBooks(raw) {
  if (raw === null) return [];
  if (typeof raw !== 'string' || raw.length > 2_000_000) throw new Error('Data penyimpanan terlalu besar.');
  const values = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > MAX_BOOKS) throw new Error('Format rak buku tidak valid.');
  const result = values.map(book => normalizeBook(book));
  if (new Set(result.map(book => book.id)).size !== result.length) throw new Error('ID buku tersimpan berulang.');
  return result;
}

export function matchingBooks(books, query) {
  const needle = String(query).trim().toLocaleLowerCase('id');
  return books.filter(book => `${book.title}\n${book.author}`.toLocaleLowerCase('id').includes(needle));
}

function checkCapacity(books) {
  if (JSON.stringify(books).length > 2_000_000) throw new Error('Rak terlalu besar. Perpendek URL sampul atau unduh salinan sebelum mengurangi isi rak.');
  return books;
}

export function updateBook(books, replacement) {
  const book = normalizeBook(replacement);
  const index = books.findIndex(item => item.id === book.id);
  if (index === -1) throw new Error('Buku tidak ditemukan. Muat ulang rak lalu coba lagi.');
  return checkCapacity(books.map((item, i) => i === index ? book : item));
}

export function addBook(books, value, generateId = () => crypto.randomUUID()) {
  if (books.length >= MAX_BOOKS) throw new Error(`Rak dibatasi ${MAX_BOOKS} buku. Unduh salinan sebelum menghapus buku lama.`);
  const book = normalizeBook(value, generateId());
  if (books.some(item => item.id === book.id)) throw new Error('ID baru sudah terpakai. Coba tambahkan kembali.');
  return checkCapacity([...books, book]);
}

export function createStorage(getStorage) {
  let expected = null;
  let blocked = false;
  let originalRaw = null;
  return {
    load() {
      try {
        expected = getStorage().getItem(STORAGE_KEY);
        originalRaw = expected;
        try {
          const books = parseBooks(expected);
          blocked = false;
          return { books, status: 'saved', raw: expected };
        } catch {
          blocked = true;
          return { books: [], status: 'corrupt', raw: expected };
        }
      } catch {
        return { books: [], status: 'unavailable', raw: null };
      }
    },
    save(books, replaceCorrupt = false) {
      const serialized = JSON.stringify(books.map(book => normalizeBook(book)));
      if (blocked && !replaceCorrupt) return { status: 'corrupt', raw: originalRaw };
      try {
        const storage = getStorage();
        if (storage.getItem(STORAGE_KEY) !== expected) return { status: 'conflict', raw: originalRaw };
        storage.setItem(STORAGE_KEY, serialized);
        expected = serialized;
        blocked = false;
        return { status: 'saved', raw: serialized };
      } catch {
        return { status: 'unavailable', raw: originalRaw };
      }
    },
  };
}
