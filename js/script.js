/* =============================================================
   Taaza Resort — Main Script
   Shared across all pages
   ============================================================= */

/* ===== DOTS MENU (⋮) ===== */
function toggleDotsMenu() {
    var dd = document.getElementById('dotsDropdown');
    if (dd) dd.classList.toggle('open');
}

/* ===== MOBILE NAVIGATION ===== */
function toggleMobileMenu() {
    var nl = document.getElementById('navLinks');
    if (nl) nl.classList.toggle('mobile-open');
}

/* Close dropdowns when clicking outside */
document.addEventListener('click', function(e) {
    var navMenu = document.querySelector('.nav-dots-menu');
    if (navMenu && !navMenu.contains(e.target)) {
        var dd = document.getElementById('dotsDropdown');
        if (dd) dd.classList.remove('open');
    }

    // Close mobile nav when clicking outside
    var nav = document.querySelector('.navbar');
    if (nav && !nav.contains(e.target)) {
        var nl = document.getElementById('navLinks');
        if (nl) nl.classList.remove('mobile-open');
    }
});

/* =============================================================
   SHARED CART (localStorage)
   ============================================================= */
var CART_KEY = 'taaza_cart';

function getCart() {
    try {
        return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    } catch(e) { return []; }
}

function addMenuItemToCart(name, price, emoji) {
    var cartItems = getCart();
    var id = 'menu-' + name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    var existing = cartItems.find(function(c) { return c.id === id; });
    if (existing) {
        existing.qty++;
    } else {
        cartItems.push({ id: id, name: name, price: price, emoji: emoji, qty: 1, source: 'menu', deliveryTime: '35' });
    }
    localStorage.setItem(CART_KEY, JSON.stringify(cartItems));
    
    // If on delivery page, sync the local 'cart' variable and UI
    if (window.location.pathname.includes('delivery.html') && typeof window.cart !== 'undefined') {
        window.cart = cartItems;
        if (typeof window.updateCartUI === 'function') {
            window.updateCartUI();
        }
    }
    
    updateCartNavBadge();
    showNavCartToast(emoji + ' ' + name + ' added to bill!');
    
    // If not on delivery page, redirect to show the bill
    if (!window.location.pathname.includes('delivery.html')) {
        setTimeout(function() {
            window.location.href = 'delivery.html?openCart=true';
        }, 800);
    }
}

function updateCartNavBadge() {
    var total = getCart().reduce(function(s, c) { return s + c.qty; }, 0);
    
    // Navbar button sync
    var btn   = document.getElementById('cartNavBtn');
    var count = document.getElementById('cartNavCount');
    if (btn)   btn.style.display  = total > 0 ? 'flex' : 'none';
    if (count) count.textContent  = total;

    // Global FAB sync (Floating Bill Button)
    syncGlobalCartFAB(total);
}

function syncGlobalCartFAB(total) {
    var fab = document.getElementById('globalCartFab') || document.getElementById('cartFab');
    
    if (total > 0) {
        if (!fab) {
            fab = document.createElement('button');
            fab.id = 'globalCartFab';
            fab.className = 'cart-fab';
            fab.title = 'View Your Bill';
            fab.innerHTML = '&#x1F6D2;<span class="cart-badge" id="globalCartBadge">' + total + '</span>';
            fab.onclick = function() {
                if (window.location.pathname.includes('delivery.html')) {
                    if (typeof openCartModal === 'function') openCartModal();
                } else {
                    window.location.href = 'delivery.html?openCart=true';
                }
            };
            document.body.appendChild(fab);
        } else {
            var badge = fab.querySelector('.cart-badge') || document.getElementById('cartBadge') || document.getElementById('globalCartBadge');
            if (badge) badge.textContent = total;
            fab.style.display = 'flex';
        }
    } else {
        if (fab) fab.style.display = 'none';
    }
}

function showNavCartToast(msg) {
    var t = document.getElementById('cartToast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(function() { t.classList.remove('show'); }, 2500);
}

document.addEventListener('DOMContentLoaded', function() {
    updateCartNavBadge();
    initBookingDates();
    initScrollAnimations();

    var bookingForm = document.querySelector('.booking-form');
    if (bookingForm && typeof handleBookingSearch === 'function') {
        bookingForm.addEventListener('submit', handleBookingSearch);
    }
});

/* =============================================================
   BOOKING PAGE — date logic
   ============================================================= */
var selectedPackage = null;

function selectPackage(name, price) {
    selectedPackage = { name: name, price: price };
    var form = document.querySelector('.booking-form');
    if (form) {
        form.scrollIntoView({ behavior: 'smooth' });
    }
    showNavCartToast('🎁 ' + name + ' package selected!');
}

function initBookingDates() {
    var checkIn  = document.getElementById('check-in');
    var checkOut = document.getElementById('check-out');
    if (checkIn) {
        var today = new Date().toISOString().split('T')[0];
        checkIn.min = today;
        checkIn.addEventListener('change', function() {
            if (checkOut) checkOut.min = this.value;
        });
    }
}

/* ===== BOOKING FORM ===== */
var pendingBooking = null;

function updateGuestOptions() {
    var roomSel = document.getElementById('room-type');
    var guestSel = document.getElementById('guests');
    if (!roomSel || !guestSel) return;
    var rt = roomSel.value;
    var maxGuests = 99;
    var all = [
        { value: '1', label: '1 Guest' },
        { value: '2', label: '2 Guests' },
        { value: '3', label: '3 Guests' },
        { value: '4', label: '4 Guests' },
        { value: '5+', label: '5 or more Guests' }
    ];
    var current = guestSel.value;
    guestSel.innerHTML = '<option value="">Select guests</option>';
    all.forEach(function(o) {
        var num = o.value === '5+' ? 5 : parseInt(o.value);
        if (num <= maxGuests) {
            var opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            if (o.value === current) opt.selected = true;
            guestSel.appendChild(opt);
        }
    });
}

function updateRoomsByGuests() {
    var guestVal = (document.getElementById('guests') || {}).value;
    var roomSel  = document.getElementById('room-type');
    if (!roomSel) return;
    var num = guestVal === '5+' ? 5 : (parseInt(guestVal, 10) || 0);
    var currentVal = roomSel.value;
    roomSel.innerHTML = '<option value="">Select room type</option>';
    var stdRate = num > 0 ? Math.ceil(num / 2) * 1500 : 1500;
    var options = [
        { v: 'Standard Room', t: 'Standard Room — Rs. ' + stdRate.toLocaleString() + '/night' },
        { v: 'Banquet Hall',  t: 'Banquet Hall — Wedding / Mehendi (Rs. 5,000/day)' }
    ];
    options.forEach(function(o) {
        var opt = document.createElement('option');
        opt.value = o.v;
        opt.textContent = o.t;
        if (o.v === currentVal) opt.selected = true;
        roomSel.appendChild(opt);
    });
    if (!options.some(function(o) { return o.v === currentVal; })) roomSel.value = '';
    /* Show pricing note */
    var note = document.getElementById('bformPriceNote');
    var noteText = document.getElementById('bformPriceNoteText');
    if (note && noteText && num > 0) {
        noteText.textContent = num <= 2
            ? 'Standard Room rate: Rs. 1,500/night for up to 2 guests.'
            : 'Rate adjusted for ' + num + ' guests: Rs. ' + stdRate.toLocaleString() + '/night (Rs. 1,500 per 2 guests).';
        note.style.display = 'block';
    } else if (note) {
        note.style.display = 'none';
    }
    updateLivePrice();
}

function updateLivePrice() {
    var checkIn  = (document.getElementById('check-in')  || {}).value;
    var checkOut = (document.getElementById('check-out') || {}).value;
    var guestVal = (document.getElementById('guests')    || {}).value;
    var roomType = (document.getElementById('room-type') || {}).value;
    var preview  = document.getElementById('livePricePreview');
    if (!preview) return;
    if (!checkIn || !checkOut || !guestVal || !roomType) { preview.style.display = 'none'; return; }
    var nights = calculateNights(checkIn, checkOut);
    if (nights <= 0) { preview.style.display = 'none'; return; }
    var guestNum = guestVal === '5+' ? 5 : (parseInt(guestVal, 10) || 1);
    var roomRate = roomType === 'Banquet Hall' ? 5000 : Math.ceil(guestNum / 2) * 1500;
    var unit     = roomType === 'Banquet Hall' ? 'day' : 'night';
    var total    = nights * roomRate;
    var deposit  = Math.round(total * 0.35);
    document.getElementById('bppNights').textContent  = nights + ' ' + (nights === 1 ? unit : unit + 's');
    document.getElementById('bppRate').textContent    = 'Rs. ' + roomRate.toLocaleString() + '/' + unit;
    document.getElementById('bppTotal').textContent   = 'Rs. ' + total.toLocaleString();
    document.getElementById('bppDeposit').textContent = deposit.toLocaleString();
    preview.style.display = 'block';
}

function handleBookingSearch(event) {
    event.preventDefault();
    var checkIn  = document.getElementById('check-in')    ? document.getElementById('check-in').value    : '';
    var checkOut = document.getElementById('check-out')   ? document.getElementById('check-out').value   : '';
    var guests   = document.getElementById('guests')      ? document.getElementById('guests').value      : '';
    var roomType = document.getElementById('room-type')   ? document.getElementById('room-type').value   : '';
    var fullName = document.getElementById('full-name')   ? document.getElementById('full-name').value   : '';
    var phone    = document.getElementById('phone')       ? document.getElementById('phone').value       : '';
    var email    = document.getElementById('guest-email') ? document.getElementById('guest-email').value.trim() : '';

    if (!checkIn || !checkOut || !guests || !roomType || !fullName || !phone) {
        alert('Please complete all booking fields, including your contact information.');
        return;
    }

    var nights = calculateNights(checkIn, checkOut);
    if (nights <= 0) {
        alert('Check-out must be after check-in.');
        return;
    }

    var guestNum = guests === '5+' ? 5 : (parseInt(guests, 10) || 1);
    var roomRate = roomType === 'Banquet Hall' ? 5000 : Math.ceil(guestNum / 2) * 1500;

    var subtotal = nights * roomRate;
    var packagePrice = selectedPackage ? selectedPackage.price : 0;
    var packageTotal = packagePrice;

    var baseTotal = subtotal + packageTotal;
    _pendingBaseTotal = baseTotal;

    /* Apply loyalty redemption */
    var loyaltyDisc = _redeemPoints || 0;
    var total    = Math.max(0, baseTotal - loyaltyDisc);
    var deposit  = Math.round(total * 0.35);

    pendingBooking = {
        fullName: fullName,
        phone: phone,
        email: email,
        checkIn: checkIn,
        checkOut: checkOut,
        guests: guests,
        roomType: roomType,
        nights: nights,
        roomRate: roomRate,
        package: selectedPackage,
        subtotal: subtotal,
        loyaltyDisc:  loyaltyDisc,
        total: total,
        deposit: deposit,
        contactPhone: '+977 9742864405',
        contactEmail: 'tamanganish421@gmail.com'
    };

    showBookingResult(pendingBooking);
}

function calculateNights(startDate, endDate) {
    var start = new Date(startDate);
    var end   = new Date(endDate);
    var diff  = end - start;
    return diff > 0 ? Math.round(diff / (1000 * 60 * 60 * 24)) : 0;
}

function showBookingResult(booking) {
    var result = document.getElementById('bookingResult');
    var summary = document.getElementById('bookingSummary');
    if (!result || !summary) return;

    var html = '<div class="booking-summary-row"><span>Guest Name:</span><strong>' + esc(booking.fullName) + '</strong></div>' +
               '<div class="booking-summary-row"><span>Contact:</span><strong>' + esc(booking.phone) + '</strong></div>' +
               '<div class="booking-summary-row"><span>Room Type:</span><strong>' + esc(booking.roomType) + '</strong></div>' +
               '<div class="booking-summary-row"><span>Guests:</span><strong>' + esc(booking.guests) + '</strong></div>' +
               '<div class="booking-summary-row"><span>Stay:</span><strong>' + booking.nights + ' night(s)</strong></div>' +
               '<div class="booking-summary-row"><span>Check-in:</span><strong>' + esc(booking.checkIn) + '</strong></div>' +
               '<div class="booking-summary-row"><span>Check-out:</span><strong>' + esc(booking.checkOut) + '</strong></div>';

    if (booking.package) {
        html += '<div class="booking-summary-row" style="color:var(--gold)"><span>Selected Package:</span><strong>' + esc(booking.package.name) + '</strong></div>';
    }

    var rateUnit = booking.roomType === 'Banquet Hall' ? '/day' : '/night';
    html += '<div class="booking-summary-row"><span>Room Rate:</span><strong>Rs. ' + (booking.roomRate || 0).toLocaleString() + rateUnit + '</strong></div>';
    html += '<div class="booking-summary-row"><span>Room Subtotal:</span><strong>Rs. ' + booking.subtotal.toLocaleString() + '</strong></div>';
    
    if (booking.package) {
        html += '<div class="booking-summary-row"><span>Package Cost:</span><strong>Rs. ' + booking.package.price + '</strong></div>';
    }

    if (booking.loyaltyDisc) html += '<div class="booking-summary-row" style="color:#166534"><span>⭐ Loyalty Discount:</span><strong>− Rs. ' + booking.loyaltyDisc + '</strong></div>';
    html += '<div class="booking-summary-row total"><span>Total Amount:</span><strong>Rs. ' + booking.total + '</strong></div>';

    summary.innerHTML = html;

    result.style.display = 'block';
    var waBtn = document.getElementById('bookingWhatsappBtn');
    if (waBtn) waBtn.style.display = 'none';
    // Hide notification status box until booking is saved
    var notifBox = document.getElementById('bookingNotifStatus');
    if (notifBox) notifBox.style.display = 'none';

    closeBookingPaymentModal();
    closeAdvBookingModal();
    window.scrollTo({ top: result.offsetTop - 20, behavior: 'smooth' });
}

function openAdvanceBooking() {
    if (!pendingBooking) return;

    var recap = document.getElementById('advBmRecap');
    if (recap) {
        recap.innerHTML =
            '<div class="adv-bm-recap-row"><span>Guest</span><strong>' + esc(pendingBooking.fullName) + '</strong></div>' +
            '<div class="adv-bm-recap-row"><span>Phone</span><strong>' + esc(pendingBooking.phone) + '</strong></div>' +
            '<div class="adv-bm-recap-row"><span>Room</span><strong>' + esc(pendingBooking.roomType) + '</strong></div>' +
            '<div class="adv-bm-recap-row"><span>Check-in</span><strong>' + esc(pendingBooking.checkIn) + '</strong></div>' +
            '<div class="adv-bm-recap-row"><span>Check-out</span><strong>' + esc(pendingBooking.checkOut) + '</strong></div>' +
            '<div class="adv-bm-recap-row"><span>Nights &middot; Guests</span><strong>' + pendingBooking.nights + ' night(s) &middot; ' + esc(pendingBooking.guests) + '</strong></div>' +
            (pendingBooking.loyaltyDisc ? '<div class="adv-bm-recap-row" style="color:#166534"><span>&#x2B50; Loyalty Discount</span><strong>&minus; Rs. ' + pendingBooking.loyaltyDisc + '</strong></div>' : '') +
            '<div class="adv-bm-recap-row adv-bm-recap-total"><span>Total Amount</span><strong>Rs. ' + pendingBooking.total + '</strong></div>';
    }

    var depEl = document.getElementById('advBmDepositAmt');
    if (depEl) depEl.textContent = 'Rs. ' + pendingBooking.deposit;

    switchAdvTab('esewa');
    var fi = document.getElementById('advBmFileInput');
    if (fi) fi.value = '';
    var fc = document.getElementById('advBmFileChosen');
    if (fc) { fc.style.display = 'none'; fc.textContent = ''; }

    var modal = document.getElementById('advBookingModal');
    if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}

function closeAdvBookingModal() {
    var m = document.getElementById('advBookingModal');
    if (m) m.style.display = 'none';
    document.body.style.overflow = '';
}

function switchAdvTab(tab) {
    var eq = document.getElementById('advQrEsewa');
    var fq = document.getElementById('advQrFonepay');
    var eb = document.getElementById('advTabEsewaBtn');
    var fb = document.getElementById('advTabFonepayBtn');
    if (eq) eq.style.display = tab === 'esewa'   ? 'block' : 'none';
    if (fq) fq.style.display = tab === 'fonepay' ? 'block' : 'none';
    if (eb) eb.classList.toggle('active', tab === 'esewa');
    if (fb) fb.classList.toggle('active', tab === 'fonepay');
}

function onAdvFileChosen(input) {
    var el = document.getElementById('advBmFileChosen');
    if (!el) return;
    if (input.files && input.files[0]) {
        el.textContent = '✅ ' + input.files[0].name;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function submitAdvModalBooking() {
    if (!pendingBooking) return;
    var fileInput = document.getElementById('advBmFileInput');
    if (!fileInput || !fileInput.files || !fileInput.files[0]) {
        alert('Please upload your payment screenshot to confirm the advance booking.');
        return;
    }
    var file = fileInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
        alert('Screenshot too large (max 5 MB). Please compress and re-upload.');
        return;
    }
    var bookingId = 'RES-' + Date.now().toString().slice(-6);
    pendingBooking.id = bookingId;
    var btn = document.getElementById('advBmConfirmBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    var reader = new FileReader();
    reader.onload = function(e) {
        pendingBooking.paymentMethod      = 'Advance (Online Transfer)';
        pendingBooking.paymentScreenshot  = e.target.result;
        pendingBooking.screenshotFileName = file.name;
        saveReservation(pendingBooking, 'Advance Paid', bookingId);
        if (btn) { btn.disabled = false; btn.textContent = '✅ Confirm Advance Booking'; }
        pendingBooking = null;
        closeAdvBookingModal();
        document.getElementById('bookingResult').style.display = 'none';
        var doRedirect = function() { window.location.href = 'index.html'; };
        if (window._taazaFirestoreResSave) {
            window._taazaFirestoreResSave.then(doRedirect).catch(doRedirect);
        } else {
            setTimeout(doRedirect, 1000);
        }
    };
    reader.readAsDataURL(file);
}

function saveReservation(booking, status, presetId) {
    try {
        var reservations = JSON.parse(localStorage.getItem('taaza_reservations') || '[]');
        var newRes = Object.assign({}, booking, {
            id: presetId || booking.id || ('RES-' + Date.now().toString().slice(-6)),
            status: status,
            createdAt: new Date().toISOString()
        });
        reservations.push(newRes);
        localStorage.setItem('taaza_reservations', JSON.stringify(reservations));
        incrementAdminNotification('reservations');
        var fsRes = Object.assign({}, newRes);
        delete fsRes.paymentScreenshot;
        if (window._taazaDB) {
            window._taazaFirestoreResSave = window._taazaDB.collection('taaza_reservations').doc(fsRes.id).set(fsRes)
                .catch(function(e) { console.error('[Taaza] Reservation sync failed:', e); });
        } else {
            window._taazaPendingRes = window._taazaPendingRes || [];
            window._taazaPendingRes.push(fsRes);
            window._taazaFirestoreResSave = new Promise(function(resolve) {
                window._taazaPendingResResolve = resolve;
            });
        }
        autoSaveGuestFromBooking(newRes);
        sendBookingNotifications(newRes);
        /* Loyalty: redeem if used */
        if (_redeemPoints > 0 && newRes.phone) {
            var llist = _getLoyalty();
            var lidx  = llist.findIndex(function(g){ return g.phone === newRes.phone; });
            if (lidx !== -1 && llist[lidx].points >= _redeemPoints) {
                llist[lidx].points        -= _redeemPoints;
                llist[lidx].totalRedeemed  = (llist[lidx].totalRedeemed || 0) + _redeemPoints;
                llist[lidx].history = llist[lidx].history || [];
                llist[lidx].history.unshift({ ts: new Date().toISOString(), type: 'redeem', amount: _redeemPoints, note: 'Redeemed at booking ' + newRes.id });
                localStorage.setItem(LOYALTY_KEY_PUB, JSON.stringify(llist));
            }
            _redeemPoints = 0;
        }
        /* Loyalty: earn points on total paid */
        earnPointsAfterBooking(newRes, newRes.total);
        _pendingBaseTotal = 0;
    } catch(e) { console.error('Failed to save reservation:', e); }
}

function autoSaveGuestFromBooking(reservation) {
    try {
        var phone = reservation.phone || '';
        var name  = reservation.fullName || reservation.guestName || '';
        if (!phone && !name) return;

        var guests = JSON.parse(localStorage.getItem('taaza_guests') || '[]');
        var existing = phone ? guests.find(function(g){ return g.phone === phone; }) : null;

        if (existing) {
            if (reservation.id && (existing.bookingIds || []).indexOf(reservation.id) === -1) {
                existing.bookingIds = existing.bookingIds || [];
                existing.bookingIds.push(reservation.id);
            }
            if (!existing.name && name) existing.name = name;
        } else {
            guests.push({
                id:          'GST-' + Date.now().toString().slice(-7),
                name:        name,
                phone:       phone,
                email:       reservation.email   || '',
                address:     reservation.address || '',
                nationality: 'Nepali',
                dateOfBirth: '',
                idType:      '',
                idNumber:    '',
                photo:       null,
                notes:       '',
                guestType:   'online',
                createdAt:   new Date().toISOString(),
                bookingIds:  reservation.id ? [reservation.id] : []
            });
        }

        localStorage.setItem('taaza_guests', JSON.stringify(guests));
    } catch(e) { console.error('Failed to auto-save guest profile:', e); }
}

function getAdminNotifications() {
    try {
        return JSON.parse(localStorage.getItem('taaza_admin_notifications') || '{"reservations":0,"orders":0}');
    } catch(e) {
        return { reservations: 0, orders: 0 };
    }
}

function saveAdminNotifications(data) {
    localStorage.setItem('taaza_admin_notifications', JSON.stringify({
        reservations: Number(data.reservations) || 0,
        orders:       Number(data.orders) || 0,
        qrOrders:     Number(data.qrOrders) || 0
    }));
}

function incrementAdminNotification(type) {
    if (type !== 'reservations' && type !== 'orders' && type !== 'qrOrders') return;
    var notifications = getAdminNotifications();
    notifications[type] = (notifications[type] || 0) + 1;
    saveAdminNotifications(notifications);
}

function clearAdminNotification(type) {
    var notifications = getAdminNotifications();
    if (type === 'reservations' || type === 'orders' || type === 'qrOrders') {
        notifications[type] = 0;
    } else if (type === 'all') {
        notifications.reservations = 0;
        notifications.orders       = 0;
        notifications.qrOrders     = 0;
    }
    saveAdminNotifications(notifications);
    if (typeof renderAdminNotificationBadges === 'function') renderAdminNotificationBadges();
}

function renderAdminNotificationBadges() {
    var notifications = getAdminNotifications();
    var resBadge   = document.getElementById('adminNotifReservations');
    var orderBadge = document.getElementById('adminNotifOrders');
    var qrBadge    = document.getElementById('adminNotifQrOrders');
    if (resBadge) {
        resBadge.textContent = notifications.reservations || 0;
        resBadge.style.display = notifications.reservations > 0 ? 'inline-flex' : 'none';
    }
    if (orderBadge) {
        orderBadge.textContent = notifications.orders || 0;
        orderBadge.style.display = notifications.orders > 0 ? 'inline-flex' : 'none';
    }
    if (qrBadge) {
        qrBadge.textContent = notifications.qrOrders || 0;
        qrBadge.style.display = notifications.qrOrders > 0 ? 'inline-flex' : 'none';
    }
}

function esc(str) {
    if (!str) return "";
    return String(str).replace(/&/g, "&amp;")
                      .replace(/</g, "&lt;")
                      .replace(/>/g, "&gt;")
                      .replace(/"/g, "&quot;")
                      .replace(/'/g, "&#039;");
}

function openBookingPaymentModal() {
    if (!pendingBooking) {
        alert('Please check availability first to proceed with payment.');
        return;
    }
    document.getElementById('bookingPaymentTotal').textContent   = 'Rs. ' + pendingBooking.total;
    document.getElementById('bookingPaymentDeposit').textContent = 'Rs. ' + pendingBooking.deposit;
    document.getElementById('bookingPaymentWrap').style.display   = 'flex';
}

function closeBookingPaymentModal() {
    var modal = document.getElementById('bookingPaymentWrap');
    if (modal) modal.style.display = 'none';
}

function selectBookingPaymentMethod(method) {
    if (!pendingBooking) return;

    if (method === 'online') {
        document.getElementById('bookingPaymentMethodsSection').style.display = 'none';
        document.getElementById('bookingFonePaySection').style.display = 'block';
        document.getElementById('bookingQRAmount').textContent = 'Rs. ' + pendingBooking.total;
        var appSelect = document.getElementById('bookingPaymentApp');
        if (appSelect) appSelect.value = 'eSewa';
        switchQRTab('esewa');
    } else {
        processBookingPayment('card');
    }
}

function switchQRTab(tab) {
    var esewaBlock   = document.getElementById('esewaQRBlock');
    if (!esewaBlock) return;
    if (tab === 'esewa') {
        esewaBlock.style.display   = 'block';
    } else {
        esewaBlock.style.display   = 'none';
    }
}

function backToBookingPaymentMethods() {
    document.getElementById('bookingPaymentMethodsSection').style.display = 'block';
    document.getElementById('bookingFonePaySection').style.display = 'none';
    var sc = document.getElementById('bookingPaymentScreenshot');
    if (sc) sc.value = '';
    var app = document.getElementById('bookingPaymentApp');
    if (app) app.value = 'eSewa';
}

function submitBookingPayment() {
    if (!pendingBooking) return;

    var appSelect = document.getElementById('bookingPaymentApp');
    var payApp = appSelect ? (appSelect.value || 'eSewa') : 'eSewa';

    var screenshotInput = document.getElementById('bookingPaymentScreenshot');
    if (!screenshotInput.files || !screenshotInput.files[0]) {
        alert('Please upload a payment screenshot to confirm your booking.');
        return;
    }

    var file = screenshotInput.files[0];

    if (file.size > 5 * 1024 * 1024) {
        alert('Screenshot is too large (max 5 MB). Please upload a smaller image.');
        return;
    }

    var confirmBtn = document.querySelector('#bookingPaymentModal .btn-primary, #bookingPaymentModal button[onclick*="submitBookingPayment"]');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Saving…'; }

    var reader = new FileReader();

    reader.onload = function(e) {
        pendingBooking.paymentMethod = payApp;
        pendingBooking.paymentScreenshot = e.target.result;
        pendingBooking.screenshotFileName = file.name;

        saveReservation(pendingBooking, 'Paid (' + payApp + ')');

        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✅ Confirm Payment & Complete Booking'; }
        alert('Your payment of Rs. ' + pendingBooking.total + ' via ' + payApp + ' has been received.\n\nYour room is now reserved. Our team will contact you shortly with the reservation receipt.');
        closeBookingPaymentModal();
        document.getElementById('bookingResult').style.display = 'none';
        pendingBooking = null;
    };

    reader.readAsDataURL(file);
}

function processBookingPayment(method) {
    if (!pendingBooking) return;
    
    var methodLabel = method === 'online' ? 'eSewa / Khalti' : 'Card';
    
    // Save to reservations for Admin Panel
    saveReservation(pendingBooking, 'Paid (' + methodLabel + ')');
    
    var message = 'Your payment of Rs. ' + pendingBooking.total + ' via ' + methodLabel + ' has been processed successfully.\n\nYour room is now reserved. Our team will contact you with the reservation details and receipt.';
    alert(message);
    closeBookingPaymentModal();
    document.getElementById('bookingResult').style.display = 'none';
    pendingBooking = null;
}

/* ===== CONTACT FORM ===== */
function handleContactForm(event) {
    event.preventDefault();
    var name    = document.getElementById('name')    ? document.getElementById('name').value.trim()    : '';
    var email   = document.getElementById('email')   ? document.getElementById('email').value.trim()   : '';
    var subject = document.getElementById('subject') ? document.getElementById('subject').value.trim() : '';
    var message = document.getElementById('message') ? document.getElementById('message').value.trim() : '';
    if (name && email && subject && message) {
        var btn = event.target.querySelector('[type="submit"]');
        if (btn) { btn.disabled = true; btn.textContent = 'Opening WhatsApp…'; }
        var whatsappNumber = '9779742864405';
        var whatsappMessage = 'Hello Taaza Resort, my name is ' + name + '.\n\nSubject: ' + subject + '\n\nMessage: ' + message + '\n\nEmail: ' + email;
        window.open('https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(whatsappMessage), '_blank');
        event.target.reset();
        if (btn) { btn.disabled = false; btn.textContent = 'Send Message'; }
    } else {
        alert('Please complete all required fields before sending your message.');
    }
}

/* ===== NEWSLETTER ===== */
function handleNewsletter(event) {
    event.preventDefault();
    var emailInput = event.target.querySelector('input[type="email"]');
    if (emailInput && emailInput.value) {
        var email = emailInput.value;
        var subject = encodeURIComponent('Newsletter Subscription - Taaza Resort');
        var body = encodeURIComponent('New newsletter subscription request from: ' + email);
        window.open('mailto:tamanganish421@gmail.com?subject=' + subject + '&body=' + body, '_blank');
        event.target.reset();
    }
}

/* =============================================================
   SCROLL ANIMATIONS
   ============================================================= */
function initScrollAnimations() {
    if (!window.IntersectionObserver) return;
    var observer = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.room-card, .about-card, .service-item, .department, .package, .food-card, .contact-card, .testimonial').forEach(function(el) {
        el.style.opacity    = '0';
        el.style.transform  = 'translateY(24px)';
        el.style.transition = 'opacity 0.55s ease, transform 0.55s ease';
        observer.observe(el);
    });
}

/* =============================================================
   SMOOTH SCROLL
   ============================================================= */
document.querySelectorAll('a[href^="#"]').forEach(function(anchor) {
    anchor.addEventListener('click', function(e) {
        var target = document.querySelector(this.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});

/* =============================================================
   VALIDATION HELPERS
   ============================================================= */
function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function validatePhone(phone) {
    return /^[0-9]{10,}$/.test(phone.replace(/\D/g, ''));
}

/* Add real-time validation feedback */
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('input[type="email"]').forEach(function(input) {
        input.addEventListener('blur', function() {
            this.style.borderColor = (this.value && !validateEmail(this.value)) ? '#dc2626' : '';
        });
    });
    document.querySelectorAll('input[type="tel"]').forEach(function(input) {
        input.addEventListener('blur', function() {
            this.style.borderColor = (this.value && !validatePhone(this.value)) ? '#dc2626' : '';
        });
    });
});

/* =============================================================
   UTILITY: currency format
   ============================================================= */
function formatRs(amount) {
    return 'Rs. ' + Number(amount).toLocaleString('en-NP');
}

/* =============================================================
   3D HERO EFFECT
   ============================================================= */
function initHero3D() {
    var hero = document.getElementById('hero');
    var bg = document.getElementById('heroBg');
    var content = document.getElementById('heroContent');
    
    if (!hero || !bg || !content) return;

    hero.addEventListener('mousemove', function(e) {
        var rect = hero.getBoundingClientRect();
        var width = rect.width;
        var height = rect.height;
        var xVal = e.clientX;
        var yVal = e.clientY;
        
        // Calculate rotation (for content)
        var yRotation = ((xVal - width / 2) / width) * 20; 
        var xRotation = ((yVal - height / 2) / height) * -20; 
        
        // Calculate parallax (for background)
        var xMove = ((xVal - width / 2) / width) * -30; 
        var yMove = ((yVal - height / 2) / height) * -30; 

        content.style.transform = 'rotateX(' + xRotation + 'deg) rotateY(' + yRotation + 'deg) translateZ(50px)';
        bg.style.transform = 'translateX(' + xMove + 'px) translateY(' + yMove + 'px) scale(1.1)';
    });

    hero.addEventListener('mouseleave', function() {
        content.style.transform = 'rotateX(0) rotateY(0) translateZ(0)';
        bg.style.transform = 'translateX(0) translateY(0) scale(1)';
    });
}

document.addEventListener('DOMContentLoaded', initHero3D);

/* =============================================================
   EMAIL & WHATSAPP NOTIFICATION SYSTEM
   ============================================================= */
var NOTIF_SETTINGS_KEY = 'taaza_notif_settings';
var NOTIF_LOG_KEY      = 'taaza_notif_log';

/* Store the last saved booking for WhatsApp button */
var _lastSavedBooking = null;

function getNotifSettings() {
    try { return JSON.parse(localStorage.getItem(NOTIF_SETTINGS_KEY) || '{}'); }
    catch(e) { return {}; }
}

function _logNotif(entry) {
    try {
        var log = JSON.parse(localStorage.getItem(NOTIF_LOG_KEY) || '[]');
        log.unshift(Object.assign({ id: 'NOTIF-' + Date.now().toString().slice(-8), sentAt: new Date().toISOString() }, entry));
        if (log.length > 300) log = log.slice(0, 300);
        localStorage.setItem(NOTIF_LOG_KEY, JSON.stringify(log));
    } catch(e) {}
}

/* Main dispatcher — called after every saveReservation() */
function sendBookingNotifications(booking) {
    _lastSavedBooking = booking;
    var settings = getNotifSettings();

    /* — Email — */
    var emailSent = false;
    if (settings.emailPublicKey && settings.emailServiceId && settings.emailTemplateId) {
        if (booking.email) {
            _sendEmailJS(booking, settings);
            emailSent = true;
        } else {
            _logNotif({ type:'email', bookingId:booking.id, guestName:booking.fullName,
                guestContact:'no email provided', status:'skipped', error:'Guest did not provide email' });
        }
    }

    /* — Update booking confirmation UI — */
    _updateBookingNotifUI(booking, emailSent, settings);
}

function _sendEmailJS(booking, settings) {
    function _doSend() {
        try {
            emailjs.init({ publicKey: settings.emailPublicKey });
            var d1 = booking.checkIn  ? new Date(booking.checkIn  + 'T00:00:00').toLocaleDateString('en-NP', {weekday:'short',day:'2-digit',month:'long',year:'numeric'}) : booking.checkIn;
            var d2 = booking.checkOut ? new Date(booking.checkOut + 'T00:00:00').toLocaleDateString('en-NP', {weekday:'short',day:'2-digit',month:'long',year:'numeric'}) : booking.checkOut;
            var params = {
                to_email:       booking.email,
                to_name:        booking.fullName          || 'Valued Guest',
                booking_id:     booking.id                || '—',
                room_type:      booking.roomType          || '—',
                check_in:       d1                        || '—',
                check_out:      d2                        || '—',
                nights:         booking.nights            || 1,
                guests_count:   booking.guests            || '—',
                total_amount:   'Rs. ' + (booking.total  || 0),
                deposit_amount: 'Rs. ' + (booking.deposit|| 0),
                booking_status: booking.status            || 'Confirmed',
                package_name:   booking.package ? booking.package.name : 'No Package',
                resort_name:    settings.resortName    || 'Taaza Resort',
                resort_phone:   settings.resortPhone   || '+977 9742864405',
                resort_email:   settings.resortEmail   || 'tamanganish421@gmail.com',
                resort_address: 'Bharatpur-5, Narayanpur, Chitwan, Nepal'
            };
            emailjs.send(settings.emailServiceId, settings.emailTemplateId, params)
                .then(function() {
                    _logNotif({ type:'email', bookingId:booking.id, guestName:booking.fullName,
                        guestContact:booking.email, status:'sent', error:'' });
                    _setNotifLine('bookingNotifEmailLine',
                        '<span style="color:#166534">&#x2705; Confirmation email sent to <strong>' + booking.email + '</strong></span>');
                }, function(err) {
                    _logNotif({ type:'email', bookingId:booking.id, guestName:booking.fullName,
                        guestContact:booking.email, status:'failed', error:JSON.stringify(err) });
                    _setNotifLine('bookingNotifEmailLine',
                        '<span style="color:#991b1b">&#x26A0;&#xFE0F; Email failed — please contact us directly.</span>');
                });
        } catch(ex) {
            _logNotif({ type:'email', bookingId:booking.id, guestName:booking.fullName,
                guestContact:booking.email, status:'failed', error:ex.message });
        }
    }

    if (typeof emailjs !== 'undefined') {
        _doSend();
    } else {
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        s.onload = _doSend;
        document.head.appendChild(s);
    }
}

function _updateBookingNotifUI(booking, emailAttempted, settings) {
    var box = document.getElementById('bookingNotifStatus');
    if (!box) return;

    var emailLine = '';
    if (emailAttempted && booking.email) {
        emailLine = '&#x1F4E7; Sending confirmation email to <strong>' + booking.email + '</strong>…';
        _setNotifLine('bookingNotifEmailLine', emailLine);
    } else if (!booking.email) {
        emailLine = '&#x2139;&#xFE0F; No email provided — add an email address next time to receive confirmation.';
        _setNotifLine('bookingNotifEmailLine', emailLine);
    } else {
        emailLine = '&#x2139;&#xFE0F; Email notifications not configured. Set up in Admin &rarr; Settings.';
        _setNotifLine('bookingNotifEmailLine', emailLine);
    }

    _setNotifLine('bookingNotifWhatsappLine', '');

    box.style.display = 'block';
}

function _setNotifLine(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
}

function _buildWhatsAppUrl(booking, settings) {
    var raw = (booking.phone || '').replace(/\D/g, '');
    if (raw.startsWith('0')) raw = raw.slice(1);
    if (!raw.startsWith('977')) raw = '977' + raw;
    var msg =
        'Hello ' + (booking.fullName || 'Guest') + '! 🏨\n\n' +
        'Your booking at Taaza Resort is confirmed!\n\n' +
        '📋 Booking ID: ' + (booking.id || '—') + '\n' +
        '🏠 Room: '       + (booking.roomType || '—') + '\n' +
        '📅 Check-in: '   + (booking.checkIn  || '—') + '\n' +
        '📅 Check-out: '  + (booking.checkOut || '—') + '\n' +
        '🌙 Nights: '     + (booking.nights   || 1) + '\n' +
        '👥 Guests: '     + (booking.guests   || '—') + '\n' +
        '💰 Total: Rs. '  + (booking.total    || 0) + '\n' +
        '✅ Status: Advance Paid\n' +
        (booking.package ? '🎁 Package: ' + booking.package.name + '\n' : '') +
        '\nFor queries:\n' +
        '📞 ' + (settings.resortPhone || '+977 9742864405') + '\n' +
        '📧 ' + (settings.resortEmail || 'tamanganish421@gmail.com') + '\n\n' +
        'Thank you for choosing Taaza Resort! 🙏';
    return 'https://wa.me/' + raw + '?text=' + encodeURIComponent(msg);
}

function _openWhatsApp(booking, settings) {
    var url = _buildWhatsAppUrl(booking, settings);
    window.open(url, '_blank');
    _logNotif({ type:'whatsapp', bookingId:booking.id, guestName:booking.fullName,
        guestContact:booking.phone, status:'sent', error:'' });
    _setNotifLine('bookingNotifWhatsappLine',
        '<span style="color:#166534">&#x2705; WhatsApp confirmation opened successfully.</span>');
}

/* Admin re-send helpers (called from admin panel) */
function adminResendWhatsApp(bookingId) {
    var reservations = JSON.parse(localStorage.getItem('taaza_reservations') || '[]');
    var booking = reservations.find(function(r){ return r.id === bookingId; });
    if (!booking || !booking.phone) { alert('No phone number on record for this booking.'); return; }
    _openWhatsApp(booking, getNotifSettings());
}

function adminResendEmail(bookingId) {
    var reservations = JSON.parse(localStorage.getItem('taaza_reservations') || '[]');
    var booking = reservations.find(function(r){ return r.id === bookingId; });
    if (!booking) { alert('Booking not found.'); return; }
    if (!booking.email) { alert('No email address on record. Edit the guest profile to add one.'); return; }
    var settings = getNotifSettings();
    if (!settings.emailPublicKey || !settings.emailServiceId || !settings.emailTemplateId) {
        alert('Email not configured. Go to Admin → Settings to set up EmailJS.'); return; }
    _sendEmailJS(booking, settings);
    alert('Email resent to ' + booking.email + '. Check the Notification Log for status.');
}

/* =============================================================
   LOYALTY & REWARDS (booking-page side)
   ============================================================= */
var LOYALTY_KEY_PUB  = 'taaza_loyalty';
var _redeemPoints    = 0;
var _pendingBaseTotal = 0;

function _getLoyalty() {
    try { return JSON.parse(localStorage.getItem(LOYALTY_KEY_PUB) || '[]'); } catch(e) { return []; }
}

function lookupLoyaltyByPhone() {
    var phoneEl = document.getElementById('phone');
    if (!phoneEl) return;
    var phone = phoneEl.value.trim();
    var widget = document.getElementById('bookingLoyaltyWidget');
    if (!widget) return;
    if (!phone || phone.length < 7) { widget.style.display = 'none'; return; }
    var list = _getLoyalty();
    var g    = list.find(function(x){ return x.phone === phone; });
    if (!g || !g.points) { widget.style.display = 'none'; return; }
    var tier = g.points >= 3000 ? 'Gold' : g.points >= 1000 ? 'Silver' : 'Bronze';
    var disc = g.points >= 3000 ? '10%' : g.points >= 1000 ? '5%' : '0%';
    widget.style.display = 'flex';
    widget.innerHTML =
        '<div class="blw-icon">⭐</div>' +
        '<div class="blw-body">' +
            '<div class="blw-title">You have ' + g.points.toLocaleString() + ' loyalty points! (' + tier + ' Member)</div>' +
            '<div class="blw-detail">Tier discount: ' + disc + ' &bull; Redeem 100 pts = Rs. 100 off (min 100 pts)</div>' +
            '<div class="blw-redeem">' +
                '<input id="redeemPtsInput" type="number" min="100" max="' + g.points + '" step="100" class="blw-pts-input" placeholder="e.g. 200">' +
                '<button type="button" class="blw-apply-btn" onclick="applyLoyaltyRedemption()">Redeem</button>' +
                '<span id="redeemAppliedMsg" class="blw-applied"></span>' +
            '</div>' +
        '</div>';
}

function applyLoyaltyRedemption() {
    var pts = parseInt((document.getElementById('redeemPtsInput') || {}).value, 10);
    var msg = document.getElementById('redeemAppliedMsg');
    if (!pts || pts < 100) { if (msg) msg.textContent = 'Minimum 100 points.'; return; }
    if (pts % 100 !== 0)   { if (msg) msg.textContent = 'Must be multiple of 100.'; return; }
    var phone = (document.getElementById('phone') || {}).value || '';
    var list  = _getLoyalty();
    var g     = list.find(function(x){ return x.phone === phone; });
    if (!g || pts > g.points) { if (msg) msg.textContent = 'Not enough points.'; return; }
    _redeemPoints = pts;
    if (msg) msg.textContent = '✅ Rs. ' + pts + ' will be deducted from total!';
}

function earnPointsAfterBooking(booking, amount) {
    if (!booking || !booking.phone) return;
    var pts  = Math.floor((amount || 0) / 100);
    if (pts < 1) return;
    var list = _getLoyalty();
    var idx  = list.findIndex(function(g){ return g.phone === booking.phone; });
    if (idx === -1) {
        list.push({ phone: booking.phone, guestName: booking.fullName || '', points: 0, totalEarned: 0, totalRedeemed: 0, history: [] });
        idx = list.length - 1;
    } else if (booking.fullName) { list[idx].guestName = booking.fullName; }
    list[idx].points      += pts;
    list[idx].totalEarned += pts;
    list[idx].history = list[idx].history || [];
    list[idx].history.unshift({ ts: new Date().toISOString(), type: 'earn', amount: pts, note: 'Booking ' + (booking.id || ''), bookingId: booking.id || '' });
    localStorage.setItem(LOYALTY_KEY_PUB, JSON.stringify(list));
}

/* =============================================================
   REVIEW SUBMISSION (from booking confirmation)
   ============================================================= */
var REVIEWS_KEY_PUB = 'taaza_reviews';

function submitGuestReview(event) {
    event.preventDefault();
    var name    = (document.getElementById('revName')    || {}).value || '';
    var phone   = (document.getElementById('revPhone')   || {}).value || '';
    var room    = (document.getElementById('revRoom')    || {}).value || '';
    var comment = (document.getElementById('revComment') || {}).value || '';
    var rating  = 0;
    document.querySelectorAll('input[name="guestRating"]').forEach(function(r){ if (r.checked) rating = parseInt(r.value, 10); });

    if (!name.trim() || !rating || !comment.trim()) { alert('Please fill name, star rating and comment.'); return; }

    var reviews = [];
    try { reviews = JSON.parse(localStorage.getItem(REVIEWS_KEY_PUB) || '[]'); } catch(e) {}
    reviews.push({ id:'rev_'+Date.now(), ts:new Date().toISOString(), name:name.trim(), phone:phone.trim(), roomType:room, rating:rating, comment:comment.trim(), status:'pending', reply:'' });
    localStorage.setItem(REVIEWS_KEY_PUB, JSON.stringify(reviews));

    var form = document.getElementById('guestReviewForm');
    var ok   = document.getElementById('revSubmittedOk');
    if (form) form.style.display = 'none';
    if (ok)   ok.style.display   = 'block';
}

console.log('%cTaaza Resort', 'font-size:18px;font-weight:bold;color:#334155');
console.log('%cBharatpur-5, Narayanpur, Chitwan', 'color:#94a3b8');
