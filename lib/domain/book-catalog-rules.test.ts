import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCatalogCompleteness,
  generateCallNumber,
  validateBookFormInput,
  validateCoverUrl,
  validateIsbnFormat,
  type BookFormValues,
} from './book-catalog-rules';

test('validateCoverUrl accepts empty, https, http, and safe local paths', () => {
  assert.equal(validateCoverUrl('').valid, true);
  assert.equal(validateCoverUrl('https://covers.openlibrary.org/b/id/12345-L.jpg').valid, true);
  assert.equal(validateCoverUrl('http://example.org/book-cover.png?size=large').valid, true);
  assert.equal(validateCoverUrl('/images/cover-sains-sd.jpg').valid, true);
});

test('validateCoverUrl rejects unsafe schemes, traversal, and malformed URLs', () => {
  assert.equal(validateCoverUrl('javascript:alert(1)').valid, false);
  assert.equal(validateCoverUrl('data:text/html,<script>alert(1)</script>').valid, false);
  assert.equal(validateCoverUrl('/images/../secret.txt').valid, false);
  assert.equal(validateCoverUrl('not a url').valid, false);
  assert.equal(validateCoverUrl(`https://example.com/${'a'.repeat(1000)}.jpg`).valid, false);
});

test('validateIsbnFormat validates ISBN-10, ISBN-13, and empty optional input', () => {
  assert.equal(validateIsbnFormat('').valid, true);
  assert.equal(validateIsbnFormat('978-602-424-694-5').valid, true);
  assert.equal(validateIsbnFormat('979-123-456-789-0').valid, true);
  assert.equal(validateIsbnFormat('0-306-40615-2').valid, true);
  assert.equal(validateIsbnFormat('0-8044-2957-X').valid, true);
  assert.equal(validateIsbnFormat('12345').valid, false);
  assert.equal(validateIsbnFormat('977-602-424-694-5').valid, false);
});

test('generateCallNumber builds standard library call numbers from DDC, author, and title', () => {
  assert.equal(
    generateCallNumber({
      ddcCode: '899.221',
      authors: 'Watiek Ideo, Nindia Maya',
      title: 'Petualangan Kancil di Hutan Nusantara',
    }),
    '899.221 IDE p'
  );
  assert.equal(
    generateCallNumber({
      ddcCode: '523.2',
      authors: 'Kak Bimo',
      title: 'Si Kancil dan Tata Surya',
    }),
    '523.2 BIM k'
  );
});

test('validateBookFormInput enforces required fields and numeric boundaries', () => {
  const emptyRes = validateBookFormInput({
    title: '',
    authors: '',
    copiesCount: '0',
    publishYear: '1850',
    coverUrl: 'ftp://bad.host/img.jpg',
    isbn: '123',
  });
  assert.equal(emptyRes.valid, false);
  assert.ok(emptyRes.errors.title);
  assert.ok(emptyRes.errors.authors);
  assert.ok(emptyRes.errors.copiesCount);
  assert.ok(emptyRes.errors.publishYear);
  assert.ok(emptyRes.errors.coverUrl);
  assert.ok(emptyRes.errors.isbn);

  const validRes = validateBookFormInput({
    title: 'Ensiklopedia Sains Anak',
    authors: 'Dr. Raka Pratama',
    coverUrl: 'https://example.com/ensiklopedia.jpg',
    isbn: '978-602-888-111-2',
    publishYear: '2025',
    pages: '144',
    price: '85000',
    weightGrams: '320',
    copiesCount: '3',
  });
  assert.equal(validRes.valid, true);
  assert.deepEqual(validRes.errors, {});
});

test('computeCatalogCompleteness calculates real filled metadata ratio', () => {
  const base: BookFormValues = {
    title: 'Buku A',
    subtitle: '',
    seriesName: '',
    volume: '',
    coverUrl: '/images/cover-sains-sd.jpg',
    authors: 'Penulis A',
    illustrator: '',
    editor: '',
    translator: '',
    publisher: 'Erlangga',
    publishCity: 'Jakarta',
    publishYear: '2025',
    edition: 'Cetakan 1',
    language: 'Indonesia',
    isbn: '978-602-111-222-3',
    ddcCode: '500',
    callNumber: '500 PEN b',
    categoryId: '1',
    subcategory: 'Sains',
    subjects: 'IPA, Alam',
    targetGrade: 'Kelas 4 SD',
    ageRange: '9–10 Tahun',
    pages: '96',
    dimensions: '17 × 24 cm',
    bindingType: 'Softcover (Art Carton)',
    paperType: 'Art Paper (Glossy)',
    weightGrams: '210',
    illustrationNotes: 'Full Color',
    description: 'Sinopsis lengkap buku.',
    tableOfContents: 'Bab 1',
    acquisitionSource: 'Pembelian Dana BOS',
    acquisitionDate: '2026-11-18',
    price: '65000',
    shelfId: '1',
    copiesCount: '2',
    condition: 'Baik',
    inventoryCode: '',
    copyNotes: '',
    isReferenceOnly: false,
    readInPlaceOnly: false,
    isFeatured: false,
  };
  const comp = computeCatalogCompleteness(base);
  assert.equal(comp.filled, comp.total);
  assert.equal(comp.percent, 100);
});
