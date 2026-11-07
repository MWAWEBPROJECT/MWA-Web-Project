async function commitInChunks(db, writes, size = 400) {
  for (let i = 0; i < writes.length; i += size) {
    const batch = db.batch();
    for (const write of writes.slice(i, i + size)) write(batch);
    await batch.commit();
  }
}

module.exports = { commitInChunks };
