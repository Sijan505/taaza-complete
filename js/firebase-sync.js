(function () {
  'use strict';

  if (!window.TAAZA_FIREBASE_CONFIG ||
      window.TAAZA_FIREBASE_CONFIG.apiKey === 'REPLACE_WITH_YOUR_API_KEY') {
    console.warn('[Taaza] Firebase config not set — sync disabled.');
    return;
  }

  var db;
  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(window.TAAZA_FIREBASE_CONFIG);
    }
    db = firebase.firestore();
    window._taazaDB = db;
  } catch (e) {
    console.warn('[Taaza] Firebase init failed — sync disabled.', e);
    return;
  }

  // Flush any reservations queued before Firebase finished loading
  if (window._taazaPendingRes && window._taazaPendingRes.length) {
    window._taazaPendingRes.forEach(function (res) {
      db.collection('taaza_reservations').doc(res.id).set(res)
        .catch(function (e) { console.error('[Taaza] Pending res flush error:', e); });
    });
    window._taazaPendingRes = [];
    if (typeof window._taazaPendingResResolve === 'function') {
      window._taazaPendingResResolve();
      window._taazaPendingResResolve = null;
    }
  }

  var PAGE = (function () {
    var p = window.location.pathname;
    if (p.includes('admin'))       return 'admin';
    if (p.includes('delivery'))    return 'delivery';
    if (p.includes('table-order')) return 'table-order';
    if (p.includes('booking'))     return 'booking';
    return 'other';
  }());

  // ----------------------------------------------------------
  // Shared helpers
  // ----------------------------------------------------------
  function stripScreenshot(obj) {
    var copy = Object.assign({}, obj);
    delete copy.paymentScreenshot;
    return copy;
  }

  function safeSet(col, id, data) {
    db.collection(col).doc(id).set(stripScreenshot(data))
      .catch(function (e) {
        if (e && e.code === 'permission-denied') {
          console.warn('[Taaza] Firebase rules expired — go to Firebase Console → Firestore → Rules and republish.');
        } else {
          console.error('[Taaza] Firestore set error:', col, id, e);
        }
      });
  }

  function safeDelete(col, id) {
    db.collection(col).doc(id).delete()
      .catch(function (e) {
        if (e && e.code === 'permission-denied') {
          console.warn('[Taaza] Firebase rules expired — go to Firebase Console → Firestore → Rules and republish.');
        } else {
          console.error('[Taaza] Firestore delete error:', col, id, e);
        }
      });
  }

  // ----------------------------------------------------------
  // Patch incrementAdminNotification / clearAdminNotification
  // ----------------------------------------------------------
  if (typeof incrementAdminNotification === 'function') {
    var _origInc = incrementAdminNotification;
    window.incrementAdminNotification = function (type) {
      _origInc(type);
      db.collection('taaza_meta').doc('notifications').get().then(function (doc) {
        var n = doc.exists ? doc.data() : { reservations: 0, orders: 0, qrOrders: 0 };
        n[type] = (n[type] || 0) + 1;
        db.collection('taaza_meta').doc('notifications').set(n);
      }).catch(function () {});
    };
  }

  if (typeof clearAdminNotification === 'function') {
    var _origClear = clearAdminNotification;
    window.clearAdminNotification = function (type) {
      _origClear(type);
      db.collection('taaza_meta').doc('notifications').get().then(function (doc) {
        var n = doc.exists ? doc.data() : { reservations: 0, orders: 0, qrOrders: 0 };
        if (type === 'all') { n.reservations = 0; n.orders = 0; n.qrOrders = 0; }
        else if (n[type] !== undefined) { n[type] = 0; }
        db.collection('taaza_meta').doc('notifications').set(n);
      }).catch(function () {});
    };
  }

  // ===========================================================
  // DELIVERY PAGE
  // ===========================================================
  if (PAGE === 'delivery') {
    // Listen for menu changes pushed by admin
    db.collection('taaza_sync').doc('taaza_delivery_foods').onSnapshot(function (doc) {
      if (!doc.exists) return;
      localStorage.setItem('taaza_delivery_foods', JSON.stringify(doc.data().data || []));
      if (typeof loadFoods === 'function') loadFoods();
    });
  }

  // ===========================================================
  // TABLE ORDER PAGE
  // ===========================================================
  if (PAGE === 'table-order') {
    // Real-time status updates for customer's order
    if (typeof startStatusPolling === 'function') {
      var _origStartPolling = startStatusPolling;
      window.startStatusPolling = function (orderId) {
        _origStartPolling(orderId);
        db.collection('taaza_qr_orders').doc(orderId).onSnapshot(function (doc) {
          if (!doc.exists) return;
          var order = doc.data();
          var orders = [];
          try { orders = JSON.parse(localStorage.getItem('taaza_qr_orders') || '[]'); } catch (e) {}
          var idx = orders.findIndex(function (o) { return o.id === orderId; });
          if (idx >= 0) orders[idx] = order; else orders.push(order);
          localStorage.setItem('taaza_qr_orders', JSON.stringify(orders));
        });
      };
    }
  }

  // ===========================================================
  // BOOKING PAGE
  // ===========================================================
  if (PAGE === 'booking') {
    // Intercept every write to taaza_reservations and push to Firestore
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

    // Flag to prevent echo loops when Firestore updates localStorage
    var _syncInProgress = false;

    // Keys stored as full arrays/objects in taaza_sync/{key}
    var ADMIN_SYNC_KEYS = [
      'taaza_menu_items', 'taaza_delivery_foods',
      'taaza_swim_tickets', 'taaza_daily_sales',
      'taaza_guests', 'taaza_staff', 'taaza_attendance',
      'taaza_loyalty', 'taaza_reviews'
    ];

    // Keys stored in Firestore collections (individual docs per item)
    var COLLECTION_KEYS = ['taaza_reservations', 'taaza_orders'];

    // Render functions for each key
    var KEY_RENDER = {
      'taaza_menu_items':     function () { if (typeof renderMenuItems === 'function') renderMenuItems(); },
      'taaza_delivery_foods': function () { if (typeof renderDeliveryFoods === 'function') renderDeliveryFoods(); },
      'taaza_table_orders':   function () {
        if (typeof renderTableOrderPanel === 'function') renderTableOrderPanel();
        if (typeof renderTablesGrid === 'function') renderTablesGrid();
      },
      'taaza_swim_tickets':   function () { if (typeof renderSwimTickets === 'function') renderSwimTickets(); },
      'taaza_daily_sales':    function () {
        if (typeof renderDailySales === 'function') renderDailySales();
        if (typeof updateStats === 'function') updateStats();
      },
      'taaza_guests':         function () { if (typeof renderGuestList === 'function') renderGuestList(); },
      'taaza_staff':          function () { if (typeof renderStaffList === 'function') renderStaffList(); },
      'taaza_attendance':     function () {
        if (typeof renderAttendanceToday === 'function') renderAttendanceToday();
      },
      'taaza_loyalty':        function () { if (typeof renderLoyaltyTab === 'function') renderLoyaltyTab(); },
      'taaza_reviews':        function () { if (typeof renderReviews === 'function') renderReviews(); },
      'taaza_orders':         function () { if (typeof renderOrders === 'function') renderOrders(); },
      'taaza_reservations':   function () { if (typeof renderReservations === 'function') renderReservations(); },
      'taaza_qr_orders':      function () { if (typeof renderQrOrders === 'function') renderQrOrders(); }
    };

    // Grab original localStorage.setItem BEFORE patching
    var _origSetItem = Storage.prototype.setItem;

    // Sync admin-only key to taaza_sync/{key}
    function syncAdminKey(key, data) {
      db.collection('taaza_sync').doc(key).set({ data: data })
        .catch(function (e) { console.error('[Taaza] Sync error for', key, e); });
    }

    // Sync collection-based key (upsert each item)
    function syncCollectionKey(key, data) {
      if (!Array.isArray(data)) return;
      data.forEach(function (item) {
        if (item.id) safeSet(key, item.id, item);
      });
    }

    // Patch localStorage.setItem to auto-sync on admin writes
    Storage.prototype.setItem = function (key, value) {
      _origSetItem.call(this, key, value);
      if (this !== window.localStorage || _syncInProgress) return;
      try {
        var data = JSON.parse(value);
        if (ADMIN_SYNC_KEYS.indexOf(key) !== -1) {
          syncAdminKey(key, data);
        } else if (COLLECTION_KEYS.indexOf(key) !== -1) {
          syncCollectionKey(key, data);
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

    // Patch saveTableOrders — sync to taaza_sync/taaza_table_orders
    if (typeof saveTableOrders === 'function') {
      var _origSaveTable = saveTableOrders;
      window.saveTableOrders = function (data) {
        _origSaveTable(data);
        if (!_syncInProgress) {
          db.collection('taaza_sync').doc('taaza_table_orders').set({ data: data })
            .catch(function (e) { console.error('[Taaza] Table orders sync error:', e); });
        }
      };
    }

    // Set up all real-time listeners
    function setupListeners() {

      // -- Admin sync keys (menu, staff, guests, etc.) --
      ADMIN_SYNC_KEYS.forEach(function (key) {
        db.collection('taaza_sync').doc(key).onSnapshot(function (doc) {
          if (!doc.exists) return;
          _syncInProgress = true;
          _origSetItem.call(localStorage, key, JSON.stringify(doc.data().data || []));
          _syncInProgress = false;
          if (KEY_RENDER[key]) KEY_RENDER[key]();
        }, function (e) { console.error('[Taaza] Listener error for', key, e); });
      });

      // -- Table bills (from both customer table orders and admin edits) --
      db.collection('taaza_sync').doc('taaza_table_orders').onSnapshot(function (doc) {
        if (!doc.exists) return;
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_table_orders',
          JSON.stringify(doc.data().data || {}));
        _syncInProgress = false;
        KEY_RENDER['taaza_table_orders']();
      }, function (e) { console.error('[Taaza] Table orders listener:', e); });

      // -- Delivery orders (from customers) --
      db.collection('taaza_orders').onSnapshot(function (snapshot) {
        var orders = [];
        snapshot.forEach(function (doc) { orders.push(doc.data()); });
        orders.sort(function (a, b) {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
        // Preserve screenshots stored only locally
        var local = [];
        try { local = JSON.parse(localStorage.getItem('taaza_orders') || '[]'); } catch (e) {}
        var lMap = {};
        local.forEach(function (o) { if (o.id) lMap[o.id] = o; });
        orders = orders.map(function (o) {
          if (lMap[o.id] && lMap[o.id].paymentScreenshot) {
            o.paymentScreenshot  = lMap[o.id].paymentScreenshot;
            o.screenshotFileName = lMap[o.id].screenshotFileName;
          }
          return o;
        });
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_orders', JSON.stringify(orders));
        _syncInProgress = false;
        KEY_RENDER['taaza_orders']();
      }, function (e) { console.error('[Taaza] Orders listener:', e); });

      // -- QR table orders --
      db.collection('taaza_qr_orders').onSnapshot(function (snapshot) {
        var orders = [];
        snapshot.forEach(function (doc) { orders.push(doc.data()); });
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_qr_orders', JSON.stringify(orders));
        _syncInProgress = false;
        KEY_RENDER['taaza_qr_orders']();
      }, function (e) { console.error('[Taaza] QR orders listener:', e); });

      // -- Reservations --
      db.collection('taaza_reservations').onSnapshot(function (snapshot) {
        var reservations = [];
        snapshot.forEach(function (doc) { reservations.push(doc.data()); });
        reservations.sort(function (a, b) {
          return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
        });
        var local = [];
        try { local = JSON.parse(localStorage.getItem('taaza_reservations') || '[]'); } catch (e) {}
        var lMap = {};
        local.forEach(function (r) { if (r.id) lMap[r.id] = r; });
        reservations = reservations.map(function (r) {
          if (lMap[r.id] && lMap[r.id].paymentScreenshot) {
            r.paymentScreenshot  = lMap[r.id].paymentScreenshot;
            r.screenshotFileName = lMap[r.id].screenshotFileName;
          }
          return r;
        });
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_reservations', JSON.stringify(reservations));
        _syncInProgress = false;
        KEY_RENDER['taaza_reservations']();
      }, function (e) { console.error('[Taaza] Reservations listener:', e); });

      // -- Customer table orders (from table-order.html) --
      db.collection('taaza_meta').doc('table_orders').onSnapshot(function (doc) {
        if (!doc.exists) return;
        var tb = doc.data().data || {};
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_table_orders', JSON.stringify(tb));
        _syncInProgress = false;
        KEY_RENDER['taaza_table_orders']();
        // Also push to taaza_sync so other admin devices get it
        db.collection('taaza_sync').doc('taaza_table_orders').set({ data: tb })
          .catch(function () {});
      }, function (e) { console.error('[Taaza] Meta table orders listener:', e); });

      // -- Notification badges --
      db.collection('taaza_meta').doc('notifications').onSnapshot(function (doc) {
        if (!doc.exists) return;
        _syncInProgress = true;
        _origSetItem.call(localStorage, 'taaza_admin_notifications',
          JSON.stringify(doc.data()));
        _syncInProgress = false;
        if (typeof renderAdminNotificationBadges === 'function') {
          renderAdminNotificationBadges();
        }
      }, function (e) { console.error('[Taaza] Notifications listener:', e); });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupListeners);
    } else {
      setTimeout(setupListeners, 200);
    }
  }

}());
