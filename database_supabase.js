// PreciMap — Supabase Adapter
// Switch from SQLite to Supabase when ready
// Instructions:
// 1. Create project at supabase.com (free tier)
// 2. Run supabase_migration.sql in SQL Editor
// 3. Set SUPABASE_URL and SUPABASE_ANON_KEY in .env
// 4. Change server.js to require('./database_supabase') instead of './database'

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY  // Use service key (not anon) for server-side
);

// Drop-in replacement for better-sqlite3 db object
// Wraps Supabase calls to match the existing SQLite API

class SupabaseAdapter {
  prepare(sql) {
    // Parse the SQL to determine operation
    const sqlUp = sql.trim().toUpperCase();
    
    return {
      // For SELECT queries
      all: async (...params) => {
        const { table, conditions, orderBy, limit } = parseSql(sql, params);
        let query = supabase.from(table).select('*');
        if (conditions) query = query.match(conditions);
        if (orderBy) query = query.order(orderBy.col, { ascending: orderBy.asc });
        if (limit) query = query.limit(limit);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
      },
      
      get: async (...params) => {
        const results = await this.prepare(sql).all(...params);
        return results[0] || null;
      },
      
      run: async (...params) => {
        // INSERT / UPDATE / DELETE
        if (sqlUp.startsWith('INSERT')) {
          const { table, values } = parseInsert(sql, params);
          const { data, error } = await supabase.from(table).insert(values).select();
          if (error) throw error;
          return { lastInsertRowid: data?.[0]?.id };
        }
        if (sqlUp.startsWith('UPDATE')) {
          const { table, set, where } = parseUpdate(sql, params);
          const { error } = await supabase.from(table).update(set).match(where);
          if (error) throw error;
          return { changes: 1 };
        }
        if (sqlUp.startsWith('DELETE')) {
          const { table, where } = parseDelete(sql, params);
          const { error } = await supabase.from(table).delete().match(where);
          if (error) throw error;
          return { changes: 1 };
        }
      }
    };
  }
}

// NOTE: Full SQL parsing is complex.
// For production migration, use the Supabase JS client directly
// or keep using the server with direct Supabase REST API calls.

// RECOMMENDED APPROACH FOR PRECIMAP:
// Keep SQLite for development, deploy server to Railway/Render
// with a postgres DATABASE_URL and use pg module instead of better-sqlite3

module.exports = { db: new SupabaseAdapter() };
