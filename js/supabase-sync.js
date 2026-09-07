(function () {
  'use strict';

  if (!window.TAAZA_SUPABASE_CONFIG ||
      window.TAAZA_SUPABASE_CONFIG.url === 'REPLACE_WITH_YOUR_SUPABASE_URL') {
    console.warn('[Taaza] Supabase config not set — sync disabled.');
    return;
  }

  var db;

  // The @supabase/supabase-js CDN <script> tag loads immediately before
  // this file, but a slow/flaky connection (very common on resort/hotel
  // wifi) can make that request fail, or simply not finish before this
  // script runs — window.supabase would then be undefined here even
  // though nothing is actually misconfigured. Giving up permanently in
  // that case (the old behavior) silently disabled sync for the rest of
  // this page view — realtime listeners AND the localStorage outbox that
  // is supposed to retry failed writes never got set up. A guest's QR
  // order would still save to localStorage and show the "Order Placed!"
  // confirmation (that screen only reads local state), but the write to
  // Supabase would never happen and nothing would ever retry it — the
  // order silently never reached reception. Retrying the client init
  // instead means a transient CDN hiccup at page-load time can no longer
  // permanently and invisibly break order delivery for that session.
  var INIT_RETRY_MS     = 2000;
  var INIT_MAX_ATTEMPTS = 150; // ~5 minutes of retrying before giving up
  var _initAttempts     = 0;

  function tryInit() {
    _initAttempts++;
    if (window.supabase && typeof window.supabase.createClient === 'function') {
      try {
        db = window.supabase.createClient(
          window.TAAZA_SUPABASE_CONFIG.url,
          window.TAAZA_SUPABASE_CONFIG.anonKey
        );
      } catch (e) {
        console.warn('[Taaza] Supabase init failed — sync disabled.', e);
        return;
      }
      start();
      return;
    }
    if (_initAttempts >= INIT_MAX_ATTEMPTS) {
      console.warn('[Taaza] supabase-js did not load after retries — sync disabled for this page view.');
      return;
    }
    setTimeout(tryInit, INIT_RETRY_MS);
  }

  function start() {

  var PAGE = (function () {
    var p = window.location.pathname;
    if (p.includes('admin'))       return 'admin';
    if (p.includes('delivery'))    return 'delivery';
    if (p.includes('table-order')) return 'table-order';
    if (p.includes('booking'))     return 'booking';
    if (p.includes('menu'))        return 'menu';
    return 'other';
  }());

  // ----------------------------------------------------------
  // Shared helpers
  // ----------------------------------------------------------
  // Only strips paymentScreenshot from a single record (reservation/order/
  // qr-order). Whole-array sync values (menu items, guests, loyalty, etc.)
  // must pass through untouched — Object.assign({}, array) would otherwise
  // turn the array into a {0: ..., 1: ...} object and corrupt it.
  function stripScreenshot(obj) {
    if (Array.isArray(obj)) return obj;
    var copy = Object.assign({}, obj);
    delete copy.paymentScreenshot;
    return copy;
  }

  function nowIso() { return new Date().toISOString(); }

  // taaza_sync / taaza_meta are keyed by "key"; the others are keyed by "id".
  var KV_TABLES = { taaza_sync: true, taaza_meta: true };

  function pkCol(table) { return KV_TABLES[table] ? 'key' : 'id'; }

  // ----------------------------------------------------------
  // Outbox — retries writes that fail instead of silently dropping
  // them. This is the guest-facing side of the sync gap: a phone on
  // flaky mobile data can show "Order Placed!" successfully (that
  // screen only depends on localStorage) while the actual write to
  // Supabase times out or errors in the background — with no queue,
  // that write was simply lost, console-logged and forgotten, and the
  // order would never reach the admin dashboard no matter how good the
  // owner's own connection was. Persisting failed writes here and
  // retrying them (network permitting, while the tab stays open) closes
  // that gap for the very common "briefly flaky connection" case.
  // ----------------------------------------------------------
  var OUTBOX_KEY = 'taaza_sync_outbox';

  function _readOutbox() {
    try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || '[]'); } catch (e) { return []; }
  }
  function _writeOutbox(items) {
    try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch (e) {}
  }
  function _enqueueOutbox(table, id, data) {
    var items = _readOutbox().filter(function (it) { return !(it.table === table && it.id === id); });
    items.push({ table: table, id: id, data: data, queuedAt: Date.now() });
    _writeOutbox(items);
  }
  function _dequeueOutbox(table, id) {
    _writeOutbox(_readOutbox().filter(function (it) { return !(it.table === table && it.id === id); }));
  }

  var _flushingOutbox = false;
  function flushOutbox() {
    if (_flushingOutbox) return;
    var items = _readOutbox();
    if (!items.length) return;
    _flushingOutbox = true;
    var pending = items.length;
    function done() { pending--; if (pending <= 0) _flushingOutbox = false; }
    items.forEach(function (it) {
      var row = { data: stripScreenshot(it.data), updated_at: nowIso() };
      row[pkCol(it.table)] = it.id;
      db.from(it.table).upsert(row).then(function (res) {
        if (!res.error) _dequeueOutbox(it.table, it.id);
        done();
      }).catch(done);
    });
  }
  window.addEventListener('online', flushOutbox);
  setInterval(flushOutbox, 15000);
  setTimeout(flushOutbox, 3000);

  function safeSet(table, id, data) {
    var row = { data: stripScreenshot(data), updated_at: nowIso() };
    row[pkCol(table)] = id;
    return db.from(table).upsert(row).then(function (res) {
      if (res.error) {
        if (res.error.code === '42501') {
          console.warn('[Taaza] Supabase RLS policy rejected write — check policies in the dashboard.');
        } else {
          console.error('[Taaza] Supabase set error:', table, id, res.error);
        }
        _enqueueOutbox(table, id, data);
      }
    }).catch(function (e) { console.error('[Taaza] Supabase set error:', table, id, e); _enqueueOutbox(table, id, data); });
  }

  function safeDelete(table, id) {
    return db.from(table).delete().eq(pkCol(table), id).then(function (res) {
      if (res.error) console.error('[Taaza] Supabase delete error:', table, id, res.error);
    }).catch(function (e) { console.error('[Taaza] Supabase delete error:', table, id, e); });
  }

  // Deletes every row from an id-keyed table in a single request, instead
  // of one request per row. "Clear All" buttons used to loop safeDelete()
  // per record — with dozens of records that fired dozens of concurrent
  // deletes, and the realtime listener/periodic resync could refetch the
  // table mid-loop (while some rows were deleted and others weren't) and
  // overwrite the just-cleared local list with those still-there rows,
  // making the clear look like it "undid itself" a few seconds later. A
  // single bulk delete removes the race window: by the time anything
  // refetches, the table is already fully empty.
  function safeClearTable(table) {
    return db.from(table).delete().not(pkCol(table), 'is', null).then(function (res) {
      if (res.error) console.error('[Taaza] Supabase clear error:', table, res.error);
    }).catch(function (e) { console.error('[Taaza] Supabase clear error:', table, e); });
  }

  // Generic save shim used by inline page scripts in place of Firestore's
  // chainable .collection(table).doc(id).set(data) — always resolves (never
  // rejects) since safeSet swallows its own errors, matching the old
  // Firestore call sites that relied on that to always proceed past
  // .then()/.catch() chains.
  window._taazaDB = { save: safeSet, remove: safeDelete, clear: safeClearTable };

  // Flush any reservations queued before Supabase finished loading
  if (window._taazaPendingRes && window._taazaPendingRes.length) {
    window._taazaPendingRes.forEach(function (res) { safeSet('taaza_reservations', res.id, res); });
    window._taazaPendingRes = [];
    if (typeof window._taazaPendingResResolve === 'function') {
      window._taazaPendingResResolve();
      window._taazaPendingResResolve = null;
    }
  }

  // ----------------------------------------------------------
  // Patch incrementAdminNotification / clearAdminNotification
  // ----------------------------------------------------------
  function updateNotifications(mutate) {
    db.from('taaza_meta').select('data').eq('key', 'notifications').maybeSingle()
      .then(function (res) {
        var n = (res.data && res.data.data) || { reservations: 0, orders: 0, qrOrders: 0 };
        mutate(n);
        safeSet('taaza_meta', 'notifications', n);
      }).catch(function () {});
  }

  if (typeof incrementAdminNotification === 'function') {
    var _origInc = incrementAdminNotification;
    window.incrementAdminNotification = function (type) {
      _origInc(type);
      updateNotifications(function (n) { n[type] = (n[type] || 0) + 1; });
    };
  }

  if (typeof clearAdminNotification === 'function') {
    var _origClear = clearAdminNotification;
    window.clearAdminNotification = function (type) {
      _origClear(type);
      updateNotifications(function (n) {
        if (type === 'all') { n.reservations = 0; n.orders = 0; n.qrOrders = 0; }
        else if (n[type] !== undefined) { n[type] = 0; }
      });
    };
  }

  // ===========================================================
  // DELIVERY PAGE
  // ===========================================================
  if (PAGE === 'delivery') {
    function applyDeliveryFoods(row) {
      if (!row) return;
      localStorage.setItem('taaza_delivery_foods', JSON.stringify(row.data || []));
      if (typeof loadFoods === 'function') loadFoods();
    }
    db.from('taaza_sync').select('data').eq('key', 'taaza_delivery_foods').maybeSingle()
      .then(function (res) { applyDeliveryFoods(res.data); });
    db.channel('taaza_delivery_foods_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_sync', filter: 'key=eq.taaza_delivery_foods' },
        function (payload) { applyDeliveryFoods(payload.new); })
      .subscribe();
  }

  // ===========================================================
  // MENU PAGE (customer-facing digital menu)
  // ===========================================================
  if (PAGE === 'menu') {
    function applyMenuPrices(row) {
      if (!row) return;
      localStorage.setItem('taaza_menu_items', JSON.stringify(row.data || []));
      if (typeof window.refreshMenuPrices === 'function') window.refreshMenuPrices();
    }
    db.from('taaza_sync').select('data').eq('key', 'taaza_menu_items').maybeSingle()
      .then(function (res) { applyMenuPrices(res.data); });
    db.channel('taaza_menu_items_page_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_sync', filter: 'key=eq.taaza_menu_items' },
        function (payload) { applyMenuPrices(payload.new); })
      .subscribe();
  }

  // ===========================================================
  // TABLE ORDER PAGE
  // ===========================================================
  if (PAGE === 'table-order') {
    // Keep this device's local table-bill cache fresh so placing a new order
    // never merges on top of a stale snapshot (e.g. a bill admin already
    // cleared or paid out) — mirrors the delivery page's menu sync pattern.
    // taaza_tables is one row per table (id = table number), not a shared
    // whole-object blob, so a fresh full-table read here always reflects
    // each table's true current state, including ones just paid out and
    // removed by admin.
    function refreshTableOrdersCache() {
      db.from('taaza_tables').select('id,data').then(function (res) {
        if (res.error) { console.error('[Taaza] taaza_tables fetch error:', res.error); return; }
        var obj = {};
        (res.data || []).forEach(function (row) { obj[row.id] = row.data; });
        localStorage.setItem('taaza_table_orders', JSON.stringify(obj));
      }).catch(function (e) { console.error('[Taaza] taaza_tables fetch error:', e); });
    }
    refreshTableOrdersCache();
    db.channel('taaza_tables_page_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_tables' }, refreshTableOrdersCache)
      .subscribe();

    // Keep menu prices in step with the admin panel, the same way the
    // customer-facing menu page does — so a price the owner edits shows
    // identically on the QR ordering page and the digital menu.
    function applyMenuPrices(row) {
      if (!row) return;
      localStorage.setItem('taaza_menu_items', JSON.stringify(row.data || []));
      if (typeof window.refreshMenuPrices === 'function') window.refreshMenuPrices();
    }
    db.from('taaza_sync').select('data').eq('key', 'taaza_menu_items').maybeSingle()
      .then(function (res) { applyMenuPrices(res.data); });
    db.channel('taaza_menu_items_table_order_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_sync', filter: 'key=eq.taaza_menu_items' },
        function (payload) { applyMenuPrices(payload.new); })
      .subscribe();

    // Real-time status updates for customer's order
    if (typeof startStatusPolling === 'function') {
      var _origStartPolling = startStatusPolling;
      window.startStatusPolling = function (orderId) {
        _origStartPolling(orderId);
        db.channel('taaza_qr_order_' + orderId)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_qr_orders', filter: 'id=eq.' + orderId },
            function (payload) {
              if (!payload.new || !payload.new.data) return;
              var order = payload.new.data;
              var orders = [];
              try { orders = JSON.parse(localStorage.getItem('taaza_qr_orders') || '[]'); } catch (e) {}
              var idx = orders.findIndex(function (o) { return o.id === orderId; });
              if (idx >= 0) orders[idx] = order; else orders.push(order);
              localStorage.setItem('taaza_qr_orders', JSON.stringify(orders));
            })
          .subscribe();
      };
    }
  }

  // ===========================================================
  // BOOKING PAGE
  // ===========================================================
  if (PAGE === 'booking') {
    // Intercept every write to taaza_reservations and push to Supabase
    var _origSetItemBooking = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      _origSetItemBooking.call(this, key, value);
      if (this !== window.localStorage || key !== 'taaza_reservations') return;
      try {
        var items = JSON.parse(value);
        if (!Array.isArray(items)) return;
        items.forEach(function (item) {
          if (item.id) safeSet('taaza_reservations', item.id, item);
        });
      } catch (e) {}
    };
  }

  // ===========================================================
  // ADMIN PAGE — comprehensive bidirectional sync
  // ===========================================================
  if (PAGE === 'admin') {

    // Flag to prevent echo loops when Supabase updates localStorage
    var _syncInProgress = false;

    // key -> timestamp of the most recent local write to that key. Used
    // by applyLocal() to ignore an incoming resync/realtime payload for
    // a key we just wrote locally, in case it's still in flight on the
    // server and would otherwise carry pre-write data back in (see the
    // comment on applyLocal for the failure mode this prevents).
    //
    // Persisted to its own localStorage key (not just kept in memory) so
    // the guard survives a page reload, not only same-tab resyncs. Without
    // that, a reload right after an edit (e.g. hitting refresh to confirm
    // a Menu Items price change saved) started this map empty every time,
    // so the very first fetch from Supabase — which may still be carrying
    // the pre-edit row if that edit's own write hadn't finished landing on
    // the server yet — went straight through and silently reverted the
    // edit back to its old value.
    var LAST_WRITE_TS_KEY = 'taaza_sync_last_write_at';
    var _lastLocalWriteAt = (function () {
      try { return JSON.parse(localStorage.getItem(LAST_WRITE_TS_KEY) || '{}') || {}; }
      catch (e) { return {}; }
    }());

    // Keys stored as full arrays/objects in taaza_sync/{key}
    var ADMIN_SYNC_KEYS = [
      'taaza_menu_items', 'taaza_delivery_foods',
      'taaza_swim_tickets', 'taaza_dinein_settings',
      'taaza_guests', 'taaza_staff', 'taaza_attendance',
      'taaza_loyalty', 'taaza_reviews',
      'taaza_ledger_accounts', 'taaza_ledger_transactions',
      'taaza_stock', 'taaza_expenses', 'taaza_outside_orders'
    ];

    // Keys stored one row per item (id-keyed tables). taaza_daily_sales lives
    // here (not in ADMIN_SYNC_KEYS) because multiple stations — table
    // billing, counter sales, swim tickets, delivery — can all append to it
    // around the same moment; a whole-array overwrite would let one
    // station's write silently clobber another's.
    var COLLECTION_KEYS = ['taaza_reservations', 'taaza_orders', 'taaza_daily_sales'];

    // Render functions for each key
    var KEY_RENDER = {
      'taaza_menu_items':     function () { if (typeof renderMenuItems === 'function') renderMenuItems(); },
      'taaza_delivery_foods': function () { if (typeof renderDeliveryFoods === 'function') renderDeliveryFoods(); },
      'taaza_table_orders':   function () {
        if (typeof renderTablesGrid === 'function') renderTablesGrid();
        // Any table's write (a QR order coming in for a different table, another
        // waiter editing a different table, or the 20s fallback resync) reaches
        // here with no per-table filter, so this used to blow away the item
        // search box — and close its results dropdown — on every keystroke's
        // worth of bad timing while a waiter was mid-search on THIS table.
        // Mirrors the same guard admin.html's own 4s polling loop already
        // uses for this exact reason.
        if (typeof renderTableOrderPanel === 'function') {
          var _tblS = document.getElementById('tblSearch');
          var _tblD = document.getElementById('tblDropdown');
          var _userSearching = (_tblS && document.activeElement === _tblS) ||
                                (_tblD && _tblD.style.display !== 'none');
          if (!_userSearching) renderTableOrderPanel();
        }
      },
      'taaza_swim_tickets':   function () { if (typeof renderSwimTickets === 'function') renderSwimTickets(); },
      'taaza_dinein_settings':function () { if (typeof renderTablesGrid === 'function') renderTablesGrid(); },
      'taaza_daily_sales':    function () {
        if (typeof renderDailySales === 'function') renderDailySales();
        if (typeof updateStats === 'function') updateStats();
        if (typeof renderTablesGrid === 'function') renderTablesGrid();
        if (typeof renderBillingHistory === 'function') renderBillingHistory();
      },
      'taaza_guests':         function () { if (typeof renderGuestList === 'function') renderGuestList(); },
      'taaza_staff':          function () { if (typeof renderStaffList === 'function') renderStaffList(); },
      'taaza_attendance':     function () {
        if (typeof renderAttendanceToday === 'function') renderAttendanceToday();
      },
      'taaza_loyalty':        function () { if (typeof renderLoyaltyTab === 'function') renderLoyaltyTab(); },
      'taaza_reviews':        function () { if (typeof renderReviews === 'function') renderReviews(); },
      'taaza_stock':          function () { if (typeof renderStock === 'function') renderStock(); },
      'taaza_expenses':       function () { if (typeof renderExpenses === 'function') renderExpenses(); },
      'taaza_outside_orders': function () { if (typeof renderOutsideOrders === 'function') renderOutsideOrders(); },
      'taaza_ledger_accounts':     function () { if (typeof renderLedgerAccounts === 'function') renderLedgerAccounts(); },
      'taaza_ledger_transactions': function () {
        if (typeof renderLedgerDetail === 'function' && document.getElementById('ledgerDetailModal') && document.getElementById('ledgerDetailModal').style.display !== 'none') renderLedgerDetail();
        if (typeof renderLedgerAccounts === 'function') renderLedgerAccounts();
      },
      'taaza_orders':         function () { if (typeof renderOrders === 'function') renderOrders(); },
      'taaza_reservations':   function () { if (typeof renderReservations === 'function') renderReservations(); },
      'taaza_qr_orders':      function () { if (typeof renderQrOrders === 'function') renderQrOrders(); }
    };

    // Grab original localStorage.setItem BEFORE patching
    var _origSetItem = Storage.prototype.setItem;

    // Records a local write's timestamp both in memory and in
    // LAST_WRITE_TS_KEY (via the un-patched setItem, so this bookkeeping
    // write itself never gets mistaken for a trackable key) — see the
    // comment on _lastLocalWriteAt for why the persisted copy matters.
    function _markLocalWrite(key) {
      _lastLocalWriteAt[key] = Date.now();
      try { _origSetItem.call(localStorage, LAST_WRITE_TS_KEY, JSON.stringify(_lastLocalWriteAt)); } catch (e) {}
    }

    // Guards against a resync (the 20s interval, focus/visibility/online
    // listeners, or a realtime broadcast) landing while our own very
    // recent write to this same key may still be in flight on the
    // server. Without this, that incoming payload can carry pre-write
    // data and silently undo a just-made change a moment later — e.g. a
    // guest deleted in Guest Management reappearing, because the resync
    // refetched the row before the delete's own write had committed. A
    // few seconds' delay picking up a genuine change from another
    // device is a fine tradeoff for that.
    var RESYNC_GUARD_MS = 8000;

    function applyLocal(key, value) {
      if (Date.now() - (_lastLocalWriteAt[key] || 0) < RESYNC_GUARD_MS) return;
      _syncInProgress = true;
      _origSetItem.call(localStorage, key, value);
      _syncInProgress = false;
      if (KEY_RENDER[key]) KEY_RENDER[key]();
    }

    // Sync admin-only key to taaza_sync/{key}
    function syncAdminKey(key, data) {
      safeSet('taaza_sync', key, data);
    }

    // Sync collection-based key (upsert each item still present, and
    // delete from Supabase any item that was in the previous array but
    // is missing from this one — without this, a local delete (e.g.
    // "Delete" on a Daily Sales bill) only ever removed the row from
    // localStorage; the row survived in Supabase and the next refetch
    // (reload, another device, or the realtime subscription firing)
    // pulled it straight back in, making the delete look like it never
    // took effect. Same pattern already used below for saveQrOrders.
    function syncCollectionKey(key, data, prevRaw) {
      if (!Array.isArray(data)) return;
      data.forEach(function (item) {
        if (item.id) safeSet(key, item.id, item);
      });
      if (!prevRaw) return;
      try {
        var prev = JSON.parse(prevRaw);
        if (!Array.isArray(prev)) return;
        var newIds = {};
        data.forEach(function (item) { if (item.id) newIds[item.id] = true; });
        prev.forEach(function (item) {
          if (item.id && !newIds[item.id]) safeDelete(key, item.id);
        });
      } catch (e) {}
    }

    // Patch localStorage.setItem to auto-sync on admin writes
    Storage.prototype.setItem = function (key, value) {
      var prevRaw = (this === window.localStorage && !_syncInProgress && COLLECTION_KEYS.indexOf(key) !== -1)
        ? this.getItem(key) : null;
      _origSetItem.call(this, key, value);
      if (this !== window.localStorage || _syncInProgress) return;
      try {
        var data = JSON.parse(value);
        if (ADMIN_SYNC_KEYS.indexOf(key) !== -1) {
          _markLocalWrite(key);
          syncAdminKey(key, data);
        } else if (COLLECTION_KEYS.indexOf(key) !== -1) {
          _markLocalWrite(key);
          syncCollectionKey(key, data, prevRaw);
        }
        // taaza_qr_orders is handled separately below (saveQrOrders patch)
        // taaza_table_orders is handled separately via taaza_sync below
      } catch (e) {}
    };

    // Patch saveQrOrders — handles status changes and deletions
    if (typeof saveQrOrders === 'function') {
      var _origSaveQr = saveQrOrders;
      window.saveQrOrders = function (arr) {
        if (_syncInProgress) { _origSaveQr(arr); return; }
        _markLocalWrite('taaza_qr_orders');

        var prev = [];
        try { prev = JSON.parse(localStorage.getItem('taaza_qr_orders') || '[]'); } catch (e) {}
        var prevIdMap = {};
        prev.forEach(function (o) { prevIdMap[o.id] = true; });

        _origSaveQr(arr);

        var newIdMap = {};
        arr.forEach(function (o) { newIdMap[o.id] = true; });

        Object.keys(prevIdMap).forEach(function (id) {
          if (!newIdMap[id]) safeDelete('taaza_qr_orders', id);
        });
        arr.forEach(function (o) { safeSet('taaza_qr_orders', o.id, o); });
      };
    }

    // Patch saveTableOrders — one row per table in taaza_tables (id = table
    // number), NOT a shared whole-object blob. A blob meant every save
    // re-wrote every table at once, so two stations updating different
    // tables (or a fresh page load re-fetching before a very recent write
    // had landed) could silently clobber or resurrect each other's state
    // — exactly the "old bill reappears after refresh" failure mode. Per
    // -row upserts/deletes make each table's state independently and
    // atomically persisted: completing payment for Table 3 can never
    // affect Table 5, and a table that's paid out is actually DELETED
    // from the database, not left in a blob for a stale refetch to revive.
    if (typeof saveTableOrders === 'function') {
      var _origSaveTable = saveTableOrders;
      window.saveTableOrders = function (data) {
        var prev = {};
        try { prev = JSON.parse(localStorage.getItem('taaza_table_orders') || '{}'); } catch (e) {}

        _origSaveTable(data);
        if (_syncInProgress) return;
        _markLocalWrite('taaza_table_orders');

        Object.keys(data).forEach(function (t) {
          if (data[t]) safeSet('taaza_tables', t, data[t]);
        });
        Object.keys(prev).forEach(function (t) {
          if (prev[t] && !data[t]) safeDelete('taaza_tables', t);
        });
      };
    }

    // Highest updated_at seen per table, so a catch-up pull can ask for
    // "only rows changed since" instead of re-downloading the whole
    // table every time. In-memory only — a page reload re-hydrates fully
    // once (via refreshCollection below) and repopulates this.
    var _lastSeen = {};
    function _bumpLastSeen(table, rows) {
      var mx = _lastSeen[table] || '';
      (rows || []).forEach(function (r) { if (r && r.updated_at && r.updated_at > mx) mx = r.updated_at; });
      if (mx) _lastSeen[table] = mx;
    }

    // Refetch an entire id-keyed table and mirror it into localStorage.
    // Used for the one-time hydration on page load and as the last-resort
    // recovery when realtime looks dead — NOT on a timer.
    function refreshCollection(table, opts) {
      opts = opts || {};
      db.from(table).select('data,updated_at').then(function (res) {
        if (res.error) { console.error('[Taaza]', table, 'fetch error:', res.error); return; }
        _bumpLastSeen(table, res.data || []);
        var items = (res.data || []).map(function (row) { return row.data; });
        if (opts.sortByCreatedAtDesc) {
          items.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
        }
        if (opts.preserveScreenshot) {
          var local = [];
          try { local = JSON.parse(localStorage.getItem(table) || '[]'); } catch (e) {}
          var lMap = {};
          local.forEach(function (o) { if (o.id) lMap[o.id] = o; });
          items = items.map(function (o) {
            if (lMap[o.id] && lMap[o.id].paymentScreenshot) {
              o.paymentScreenshot  = lMap[o.id].paymentScreenshot;
              o.screenshotFileName = lMap[o.id].screenshotFileName;
            }
            return o;
          });
        }
        applyLocal(table, JSON.stringify(items));
      }).catch(function (e) { console.error('[Taaza]', table, 'fetch error:', e); });
    }

    // Merge collection items into localStorage[key] by id (upsert +
    // append only — never drops a local row). The building block for
    // every incremental sync, so a single new/changed row costs one
    // small write instead of a full-table download + rewrite.
    function mergeLocalCollection(key, items, opts) {
      opts = opts || {};
      if (!items || !items.length) return;
      var arr;
      try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { arr = []; }
      if (!Array.isArray(arr)) arr = [];
      var idx = {};
      arr.forEach(function (o, i) { if (o && o.id != null) idx[String(o.id)] = i; });
      items.forEach(function (item) {
        if (!item || item.id == null) return;
        var k = String(item.id);
        if (opts.preserveScreenshot && idx[k] != null && arr[idx[k]] && arr[idx[k]].paymentScreenshot) {
          item.paymentScreenshot  = arr[idx[k]].paymentScreenshot;
          item.screenshotFileName = arr[idx[k]].screenshotFileName;
        }
        if (idx[k] != null) arr[idx[k]] = item;
        else { idx[k] = arr.length; arr.push(item); }
      });
      if (opts.sortByCreatedAtDesc) {
        arr.sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
      }
      applyLocal(key, JSON.stringify(arr));
    }

    // Apply ONE realtime row change into localStorage[key] without
    // touching the rest of the table. Falls back to fullRefetch() only
    // when the payload can't be applied safely (e.g. a DELETE with no
    // primary key because replica identity isn't FULL).
    function applyRowChange(key, payload, fullRefetch, opts) {
      try {
        var evt = payload.eventType || payload.event;
        if (evt === 'DELETE') {
          var o = payload.old || {};
          var delId = o.id != null ? o.id : o.key;
          if (delId == null) { fullRefetch(); return; }
          var arr;
          try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { fullRefetch(); return; }
          if (!Array.isArray(arr)) { fullRefetch(); return; }
          applyLocal(key, JSON.stringify(arr.filter(function (x) { return String(x.id) !== String(delId); })));
          return;
        }
        var row = payload.new || {};
        if (!row.data || typeof row.data !== 'object') { fullRefetch(); return; }
        if (row.updated_at) _bumpLastSeen(key, [row]);
        mergeLocalCollection(key, [row.data], opts);
      } catch (e) {
        console.error('[Taaza] applyRowChange', key, e);
        fullRefetch();
      }
    }

    // Catch-up pull of only the rows changed since we last saw them.
    // Used by the realtime-is-probably-dead safety net for the big
    // append-mostly tables, so recovery never re-downloads all history.
    function refreshCollectionSince(table, opts) {
      opts = opts || {};
      var since = _lastSeen[table];
      if (!since) { refreshCollection(table, opts); return; }
      db.from(table).select('data,updated_at').gt('updated_at', since).then(function (res) {
        if (res.error) { console.error('[Taaza]', table, 'incremental fetch error:', res.error); return; }
        var raw = res.data || [];
        if (!raw.length) return;
        _bumpLastSeen(table, raw);
        mergeLocalCollection(table, raw.map(function (r) { return r.data; }), opts);
      }).catch(function (e) { console.error('[Taaza]', table, 'incremental fetch error:', e); });
    }

    // Refetch Dine-In tables (one row per table, id = table number) and
    // mirror into localStorage. Hoisted to outer scope (not just inside
    // setupListeners) so the reconnect-resync below can call it directly.
    function refreshTableOrders() {
      db.from('taaza_tables').select('id,data').then(function (res) {
        if (res.error) { console.error('[Taaza] taaza_tables fetch error:', res.error); return; }
        var obj = {};
        (res.data || []).forEach(function (row) { obj[row.id] = row.data; });
        applyLocal('taaza_table_orders', JSON.stringify(obj));
      }).catch(function (e) { console.error('[Taaza] taaza_tables fetch error:', e); });
    }

    // Realtime channels can die silently — a laptop sleep/wake cycle,
    // wifi switch, or long idle tab can drop the websocket without any
    // visible error, after which new rows (e.g. a QR order placed from a
    // guest's phone) stop arriving even though the admin tab looks normal
    // and its stale polling timer keeps re-rendering the same old data.
    // Re-pulling everything fresh whenever the tab regains focus/visibility
    // or the network comes back online sidesteps that entirely — it does
    // not depend on the realtime channel still being alive.
    var _lastResyncAt = 0;
    function resyncAllIfStale() {
      var now = Date.now();
      if (now - _lastResyncAt < 4000) return;
      _lastResyncAt = now;
      refreshCollection('taaza_orders', { sortByCreatedAtDesc: true, preserveScreenshot: true });
      refreshCollection('taaza_qr_orders');
      refreshCollection('taaza_reservations', { sortByCreatedAtDesc: true, preserveScreenshot: true });
      // Daily sales is the biggest and fastest-growing table and its
      // history never changes — catch up only on rows changed since we
      // last saw them, never the whole log.
      refreshCollectionSince('taaza_daily_sales', { sortByCreatedAtDesc: true });
      refreshTableOrders();
      db.from('taaza_sync').select('key,data').then(function (res) {
        if (res.error) { console.error('[Taaza] taaza_sync resync error:', res.error); return; }
        (res.data || []).forEach(function (row) {
          if (ADMIN_SYNC_KEYS.indexOf(row.key) === -1) return;
          applyLocal(row.key, JSON.stringify(row.data || []));
        });
      }).catch(function (e) { console.error('[Taaza] taaza_sync resync error:', e); });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') resyncAllIfStale();
    });
    window.addEventListener('focus', resyncAllIfStale);
    window.addEventListener('online', resyncAllIfStale);

    // Realtime channel health — every .subscribe() below reports its
    // status through _onChannelStatus. The safety-net interval uses this
    // to skip the catch-up pull entirely while the live channels are up,
    // which is the normal case: a healthy admin tab now makes ~zero
    // background requests instead of re-downloading every table on a
    // timer (the bug that was burning the whole Supabase egress quota).
    var _chanStatus = {};
    var _CORE_CHANNELS = ['taaza_sync', 'taaza_orders', 'taaza_qr_orders',
      'taaza_reservations', 'taaza_daily_sales', 'taaza_tables'];
    function _realtimeHealthy() {
      return _CORE_CHANNELS.every(function (c) { return _chanStatus[c] === 'SUBSCRIBED'; });
    }

    // Belt-and-suspenders for a websocket that dies silently while the
    // tab stays focused (so visibilitychange/focus/online never fire).
    // Only actually pulls when realtime looks down; otherwise it's a
    // cheap no-op. Interval widened from 20s to 5min now that it's
    // gated and the per-change handlers keep local state live row by row.
    setInterval(function () {
      if (_realtimeHealthy()) return;
      resyncAllIfStale();
    }, 300000);

    // If a channel actively reports an error/timeout/close (as opposed to
    // just going quiet), don't just log it — resync immediately instead
    // of waiting for the next interval tick.
    function _onChannelStatus(label) {
      return function (e) {
        _chanStatus[label] = e;
        if (e === 'CHANNEL_ERROR' || e === 'TIMED_OUT' || e === 'CLOSED') {
          console.error('[Taaza]', label, 'channel status:', e);
          resyncAllIfStale();
        }
      };
    }

    // Set up all real-time listeners
    function setupListeners() {

      // -- Admin sync keys (menu, staff, guests, etc.) --
      var SYNC_KEYS = ADMIN_SYNC_KEYS;
      function syncKeyDefault() { return []; }
      db.from('taaza_sync').select('key,data').then(function (res) {
        if (res.error) { console.error('[Taaza] taaza_sync fetch error:', res.error); return; }
        (res.data || []).forEach(function (row) {
          if (SYNC_KEYS.indexOf(row.key) === -1) return;
          applyLocal(row.key, JSON.stringify(row.data || syncKeyDefault(row.key)));
        });
      });
      db.channel('taaza_sync_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_sync' }, function (payload) {
          var row = payload.new;
          if (!row || SYNC_KEYS.indexOf(row.key) === -1) return;
          applyLocal(row.key, JSON.stringify(row.data || syncKeyDefault(row.key)));
        })
        .subscribe(_onChannelStatus('taaza_sync'));

      // -- Delivery orders (from customers) --
      // One full pull to hydrate, then every change is applied row by row
      // from the realtime payload (fallback to a full refetch only if a
      // payload can't be applied). Previously each change re-downloaded
      // the whole table on every open admin tab.
      refreshCollection('taaza_orders', { sortByCreatedAtDesc: true, preserveScreenshot: true });
      db.channel('taaza_orders_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_orders' },
          function (payload) {
            applyRowChange('taaza_orders', payload,
              function () { refreshCollection('taaza_orders', { sortByCreatedAtDesc: true, preserveScreenshot: true }); },
              { sortByCreatedAtDesc: true, preserveScreenshot: true });
          })
        .subscribe(_onChannelStatus('taaza_orders'));

      // -- QR table orders --
      refreshCollection('taaza_qr_orders');
      db.channel('taaza_qr_orders_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_qr_orders' },
          function (payload) {
            applyRowChange('taaza_qr_orders', payload,
              function () { refreshCollection('taaza_qr_orders'); }, {});
          })
        .subscribe(_onChannelStatus('taaza_qr_orders'));

      // -- Reservations --
      refreshCollection('taaza_reservations', { sortByCreatedAtDesc: true, preserveScreenshot: true });
      db.channel('taaza_reservations_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_reservations' },
          function (payload) {
            applyRowChange('taaza_reservations', payload,
              function () { refreshCollection('taaza_reservations', { sortByCreatedAtDesc: true, preserveScreenshot: true }); },
              { sortByCreatedAtDesc: true, preserveScreenshot: true });
          })
        .subscribe(_onChannelStatus('taaza_reservations'));

      // -- Daily sales (per-station billing log; kept in COLLECTION_KEYS,
      //    not ADMIN_SYNC_KEYS — see the comment there) --
      refreshCollection('taaza_daily_sales', { sortByCreatedAtDesc: true });
      db.channel('taaza_daily_sales_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_daily_sales' },
          function (payload) {
            applyRowChange('taaza_daily_sales', payload,
              function () { refreshCollection('taaza_daily_sales', { sortByCreatedAtDesc: true }); },
              { sortByCreatedAtDesc: true });
          })
        .subscribe(_onChannelStatus('taaza_daily_sales'));

      // One-time migration: older builds stored the whole sales log as a
      // single taaza_sync/taaza_daily_sales blob, which let concurrent
      // stations silently overwrite each other's entries on save. Copy any
      // surviving records into the new per-row table so history isn't
      // lost, guarded by a taaza_meta flag so it only runs once ever.
      db.from('taaza_meta').select('data').eq('key', 'daily_sales_migrated').maybeSingle().then(function (res) {
        if (res.data) return;
        db.from('taaza_sync').select('data').eq('key', 'taaza_daily_sales').maybeSingle().then(function (blobRes) {
          /* A since-fixed bug elsewhere could have corrupted this blob
             from an array into an {"0":..,"1":..} object (Object.assign
             on an array does that). Recover the records either way so
             one bad browser's past write can't wedge this migration —
             without this, legacy.forEach would throw, the completion
             flag below would never get set, and every admin page load
             would retry and fail this exact way forever. */
          var legacyRaw = (blobRes.data && blobRes.data.data) || [];
          var legacy = Array.isArray(legacyRaw) ? legacyRaw : Object.values(legacyRaw);
          legacy.forEach(function (s) {
            var id = s.id || s.billNum || s.orderNum || ((s.date || '') + '_' + (s.time || '') + '_' + (s.type || ''));
            safeSet('taaza_daily_sales', id, Object.assign({}, s, { id: id }));
          });
          safeSet('taaza_meta', 'daily_sales_migrated', { done: true, count: legacy.length });
          if (legacy.length) refreshCollection('taaza_daily_sales', { sortByCreatedAtDesc: true });
        }).catch(function (e) { console.error('[Taaza] daily_sales migration failed:', e); });
      });

      // One-time migration: Room Charges used to be computed on the fly
      // from taaza_reservations (advance on createdAt date, balance on
      // balancePaidAt date) instead of living in the shared sales ledger.
      // Synthesize ledger rows for existing reservations so historical
      // room revenue still appears in the unified Daily Sales report,
      // guarded by a taaza_meta flag so this only runs once ever.
      db.from('taaza_meta').select('data').eq('key', 'room_charges_migrated').maybeSingle().then(function (res) {
        if (res.data) return;
        db.from('taaza_reservations').select('data').then(function (resRes) {
          var reservations = (resRes.data || []).map(function (row) { return row.data; });
          var count = 0;
          reservations.forEach(function (r) {
            if (r.deposit > 0 && (r.status === 'Advance Paid' || r.status === 'Fully Paid') && r.createdAt) {
              var aid = r.id + '-advance';
              safeSet('taaza_daily_sales', aid, {
                id: aid, source: 'Room Charges', type: 'reservation', subtype: 'advance',
                billNum: r.id, orderNum: r.id, roomNum: r.roomNumber || null,
                guestName: r.fullName || '', date: r.createdAt.slice(0, 10),
                time: new Date(r.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                items: [], sub: r.deposit, discount: 0, taxAmt: 0, grand: r.deposit,
                paymentMethod: (r.paymentMethod || '').indexOf('Online') !== -1 ? 'Online' : 'Cash',
                paymentStatus: 'Paid', createdAt: r.createdAt
              });
              count++;
            }
            if (r.balancePaid && r.balancePaidAt) {
              var bal = Math.max(0, (r.total || 0) - (r.deposit || 0));
              if (bal > 0) {
                var bid = r.id + '-balance';
                safeSet('taaza_daily_sales', bid, {
                  id: bid, source: 'Room Charges', type: 'reservation', subtype: 'balance',
                  billNum: r.id, orderNum: r.id, roomNum: r.roomNumber || null,
                  guestName: r.fullName || '', date: r.balancePaidAt.slice(0, 10),
                  time: new Date(r.balancePaidAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                  items: [], sub: bal, discount: 0, taxAmt: 0, grand: bal,
                  paymentMethod: 'Cash', paymentStatus: 'Paid', createdAt: r.balancePaidAt
                });
                count++;
              }
            }
          });
          safeSet('taaza_meta', 'room_charges_migrated', { done: true, count: count });
          if (count) refreshCollection('taaza_daily_sales', { sortByCreatedAtDesc: true });
        }).catch(function (e) { console.error('[Taaza] room_charges migration failed:', e); });
      });

      // -- Dine-In tables (one row per table, id = table number; NOT a
      //    shared whole-object blob — see the saveTableOrders comment
      //    above for why that mattered) --
      refreshTableOrders();
      db.channel('taaza_tables_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_tables' },
          function () { refreshTableOrders(); })
        .subscribe(_onChannelStatus('taaza_tables'));

      // One-time migration: table orders used to live as a single shared
      // taaza_meta/table_orders (and taaza_sync/taaza_table_orders) blob,
      // which let one table's write clobber another's, and let a stale
      // refetch on page load resurrect a table that had just been paid
      // out and cleared. Copy any currently-occupied tables into the new
      // per-row taaza_tables collection so nothing active is lost,
      // guarded by a taaza_meta flag so this only runs once ever.
      db.from('taaza_meta').select('data').eq('key', 'tables_migrated').maybeSingle().then(function (res) {
        if (res.data) return;
        db.from('taaza_meta').select('data').eq('key', 'table_orders').maybeSingle().then(function (blobRes) {
          var legacyRaw = (blobRes.data && blobRes.data.data) || {};
          var legacy = (legacyRaw && typeof legacyRaw === 'object' && !Array.isArray(legacyRaw)) ? legacyRaw : {};
          var count = 0;
          Object.keys(legacy).forEach(function (t) {
            if (legacy[t]) { safeSet('taaza_tables', t, legacy[t]); count++; }
          });
          safeSet('taaza_meta', 'tables_migrated', { done: true, count: count });
          if (count) refreshTableOrders();
        }).catch(function (e) { console.error('[Taaza] tables migration failed:', e); });
      });

      // -- Notification badges --
      db.from('taaza_meta').select('data').eq('key', 'notifications').maybeSingle().then(function (res) {
        if (!res.data) return;
        applyLocal('taaza_admin_notifications', JSON.stringify(res.data.data));
        if (typeof renderAdminNotificationBadges === 'function') renderAdminNotificationBadges();
      });
      db.channel('taaza_meta_notifications_changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'taaza_meta', filter: 'key=eq.notifications' },
          function (payload) {
            if (!payload.new) return;
            applyLocal('taaza_admin_notifications', JSON.stringify(payload.new.data));
            if (typeof renderAdminNotificationBadges === 'function') renderAdminNotificationBadges();
          })
        .subscribe(_onChannelStatus('taaza_meta_notifications'));
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupListeners);
    } else {
      setTimeout(setupListeners, 200);
    }
  }

  } // end start()

  tryInit();

}());
