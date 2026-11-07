const PAGE_SIZE = require('./publicQuery').PAGE_SIZE;

function encodeBookingCursor(id) {
  return Buffer.from(id, 'utf8').toString('base64url');
}

function decodeBookingCursor(cursor) {
  if (typeof cursor !== 'string' || cursor.length > 2048) throw new Error('The booking page cursor is invalid.');
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    const id = bytes.toString('utf8');
    if (!id || id === '.' || id === '..' || id.includes('/') || bytes.length > 1500 ||
        bytes.toString('base64url') !== cursor || !Buffer.from(id, 'utf8').equals(bytes)) throw new Error();
    return id;
  } catch {
    throw new Error('The booking page cursor is invalid.');
  }
}

function allBookingsPage(query, documentId, cursor) {
  let page = query.orderBy(documentId);
  if (cursor) page = page.startAfter(cursor);
  return page.limit(PAGE_SIZE + 1);
}

function allBookingsPageData(snapshot) {
  const docs = snapshot.docs.slice(0, PAGE_SIZE);
  return {
    docs,
    nextPageCursor: snapshot.docs.length > PAGE_SIZE ? encodeBookingCursor(docs[docs.length - 1].id) : null
  };
}

module.exports = { encodeBookingCursor, decodeBookingCursor, allBookingsPage, allBookingsPageData };
