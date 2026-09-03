      // CONTENTS - LIST
  if (method === 'GET' && path === '/api/contents') {
    const result = await db.prepare(`SELECT c.*, u.display_name AS owner FROM contents c LEFT JOIN users u ON c.created_by = u.id ORDER BY c.created_at DESC, c.id DESC`).all();
    return json(result.results || []);
  }

  // CONTENTS - CREATE
  if (method === 'POST' && path === '/api/contents') {
    const payload = await readJson(request);
    const name = String(payload.name || '').trim();
    if (!name) return json({ error: 'name required' }, 400);

    const result = await db.prepare(`INSERT INTO contents (name, full_video_status, short_ex_status, short_top_status, style_ex_status, style_top_status, poster_status, full_video, short_ex, short_top, style_ex, style_top, poster, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      name,
      payload.full_video_status || null,
      payload.short_ex_status || null,
      payload.short_top_status || null,
      payload.style_ex_status || null,
      payload.style_top_status || null,
      payload.poster_status || null,
      payload.full_video || null,
      payload.short_ex || null,
      payload.short_top || null,
      payload.style_ex || null,
      payload.style_top || null,
      payload.poster || null,
      user.id
    ).run();

    const row = await db.prepare('SELECT * FROM contents WHERE id = ?').bind(result.meta.last_row_id).first();
    return json(row, 201);
  }

  const singleContentMatch = path.match(/^\/api\/contents\/(\d+)$/);
  if (singleContentMatch) {
    const id = Number(singleContentMatch[1]);

    if (method === 'GET') {
      const row = await db.prepare(`SELECT c.*, u.display_name AS owner FROM contents c LEFT JOIN users u ON c.created_by = u.id WHERE c.id = ? LIMIT 1`).bind(id).first();
      return row ? json(row) : json({ error: 'content not found', id }, 404);
    }

    if (method === 'PUT') {
      const payload = await readJson(request);
      const existing = await db.prepare('SELECT * FROM contents WHERE id = ? LIMIT 1').bind(id).first();
      if (!existing) return json({ error: 'content not found', id }, 404);
      const name = String(payload.name ?? existing.name ?? '').trim();
      if (!name) return json({ error: 'name required' }, 400);

      await db.prepare(`UPDATE contents SET name=?, full_video_status=?, short_ex_status=?, short_top_status=?, style_ex_status=?, style_top_status=?, poster_status=?, full_video=?, short_ex=?, short_top=?, style_ex=?, style_top=?, poster=?, updated_at=datetime('now') WHERE id=?`).bind(
        name,
        payload.full_video_status ?? existing.full_video_status,
        payload.short_ex_status ?? existing.short_ex_status,
        payload.short_top_status ?? existing.short_top_status,
        payload.style_ex_status ?? existing.style_ex_status,
        payload.style_top_status ?? existing.style_top_status,
        payload.poster_status ?? existing.poster_status,
        payload.full_video ?? existing.full_video,
        payload.short_ex ?? existing.short_ex,
        payload.short_top ?? existing.short_top,
        payload.style_ex ?? existing.style_ex,
        payload.style_top ?? existing.style_top,
        payload.poster ?? existing.poster,
        id
      ).run();

      const updated = await db.prepare('SELECT * FROM contents WHERE id = ?').bind(id).first();
      return json(updated);
    }

    if (method === 'DELETE') {
      const result = await db.prepare('DELETE FROM contents WHERE id = ?').bind(id).run();
      return result.meta.changes > 0 ? json({ ok: true, deleted: true, id }) : json({ error: 'content not found', id }, 404);
    }
  }

