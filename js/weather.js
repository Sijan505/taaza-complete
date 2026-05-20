/* =============================================================
   Taaza Resort — Live Weather Module
   API: Open-Meteo (free, no key required)
   Location: Bharatpur-5, Narayanpur, Chitwan, Nepal
   ============================================================= */

var W_LAT       = 27.6760;
var W_LON       = 84.4381;
var W_CITY      = 'Bharatpur, Chitwan';
var W_CACHE_KEY = 'taaza_weather_v2';
var W_CACHE_TTL = 30 * 60 * 1000; /* 30-minute cache */

/* WMO weather code lookup */
var WMO = {
    0:  { label: 'Clear Sky',           emoji: '☀️',  type: 'sunny'  },
    1:  { label: 'Mainly Clear',        emoji: '🌤️', type: 'sunny'  },
    2:  { label: 'Partly Cloudy',       emoji: '⛅',  type: 'cloudy' },
    3:  { label: 'Overcast',            emoji: '☁️',  type: 'cloudy' },
    45: { label: 'Foggy',               emoji: '🌫️', type: 'foggy'  },
    48: { label: 'Freezing Fog',        emoji: '🌫️', type: 'foggy'  },
    51: { label: 'Light Drizzle',       emoji: '🌦️', type: 'rainy'  },
    53: { label: 'Drizzle',             emoji: '🌦️', type: 'rainy'  },
    55: { label: 'Heavy Drizzle',       emoji: '🌧️', type: 'rainy'  },
    61: { label: 'Light Rain',          emoji: '🌧️', type: 'rainy'  },
    63: { label: 'Moderate Rain',       emoji: '🌧️', type: 'rainy'  },
    65: { label: 'Heavy Rain',          emoji: '🌧️', type: 'rainy'  },
    71: { label: 'Light Snow',          emoji: '🌨️', type: 'snowy'  },
    73: { label: 'Moderate Snow',       emoji: '❄️',  type: 'snowy'  },
    75: { label: 'Heavy Snow',          emoji: '❄️',  type: 'snowy'  },
    77: { label: 'Snow Grains',         emoji: '🌨️', type: 'snowy'  },
    80: { label: 'Light Showers',       emoji: '🌦️', type: 'rainy'  },
    81: { label: 'Rain Showers',        emoji: '🌧️', type: 'rainy'  },
    82: { label: 'Heavy Showers',       emoji: '⛈️', type: 'stormy' },
    85: { label: 'Snow Showers',        emoji: '🌨️', type: 'snowy'  },
    86: { label: 'Heavy Snow Showers',  emoji: '❄️',  type: 'snowy'  },
    95: { label: 'Thunderstorm',        emoji: '⛈️', type: 'stormy' },
    96: { label: 'Thunderstorm',        emoji: '⛈️', type: 'stormy' },
    99: { label: 'Heavy Thunderstorm',  emoji: '⛈️', type: 'stormy' }
};

function wmo(code) { return WMO[code] || { label: 'Unknown', emoji: '🌡️', type: 'cloudy' }; }

function uvLabel(uv) {
    if (uv <= 2)  return { label: 'Low',       color: '#16a34a' };
    if (uv <= 5)  return { label: 'Moderate',  color: '#ca8a04' };
    if (uv <= 7)  return { label: 'High',      color: '#ea580c' };
    if (uv <= 10) return { label: 'Very High', color: '#dc2626' };
    return               { label: 'Extreme',   color: '#9333ea' };
}

function windDir(deg) {
    var d = ['N','NE','E','SE','S','SW','W','NW'];
    return d[Math.round(deg / 45) % 8];
}

function fmtTime(isoStr) {
    /* "2024-05-07T05:45" → "5:45 AM" */
    var parts = (isoStr || '').split('T');
    if (parts.length < 2) return isoStr;
    var t = parts[1].split(':');
    var h = parseInt(t[0]), m = t[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return h + ':' + m + ' ' + ampm;
}

function activityTip(code, temp) {
    if (code === 0 || code === 1) {
        return temp >= 25
            ? '🏊 Perfect for swimming &amp; outdoor dining!'
            : '🌿 Beautiful day for nature walks &amp; sightseeing.';
    }
    if (code === 2 || code === 3) return '🚶 Comfortable for outdoor activities. Light layer recommended.';
    if (code >= 45 && code <= 48) return '🌫️ Misty morning — enjoy breakfast with scenic resort views.';
    if (code >= 51 && code <= 67) return '☕ Rainy day — perfect for our indoor spa &amp; restaurant.';
    if (code >= 71 && code <= 77) return '🧣 Cold &amp; wintry — warm up with our signature hot beverages.';
    if (code >= 80 && code <= 82) return '🌈 Showers expected — indoor dining &amp; spa highly recommended.';
    if (code >= 95)               return '⚡ Storm advisory — relax indoors &amp; enjoy our facilities.';
    return '🌿 Enjoy your stay at Taaza Resort!';
}

function dayName(isoDate, i) {
    if (i === 0) return 'Today';
    if (i === 1) return 'Tomorrow';
    var names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return names[new Date(isoDate + 'T00:00:00').getDay()];
}

/* ── Fetch from Open-Meteo with 30-min cache ── */
function fetchWeather(cb) {
    try {
        var raw = localStorage.getItem(W_CACHE_KEY);
        if (raw) {
            var cached = JSON.parse(raw);
            if (Date.now() - cached.ts < W_CACHE_TTL) { cb(null, cached.d); return; }
        }
    } catch(e) {}

    var url = 'https://api.open-meteo.com/v1/forecast'
        + '?latitude=' + W_LAT + '&longitude=' + W_LON
        + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,'
        + 'precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index,is_day'
        + '&daily=weather_code,temperature_2m_max,temperature_2m_min,'
        + 'precipitation_probability_max,sunrise,sunset,uv_index_max'
        + '&timezone=Asia%2FKathmandu&forecast_days=7';

    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.timeout = 8000;
    xhr.onload = function() {
        if (xhr.status === 200) {
            try {
                var d = JSON.parse(xhr.responseText);
                localStorage.setItem(W_CACHE_KEY, JSON.stringify({ ts: Date.now(), d: d }));
                cb(null, d);
            } catch(e) { cb(e, null); }
        } else { cb(new Error('HTTP ' + xhr.status), null); }
    };
    xhr.onerror   = function() { cb(new Error('Network error'), null); };
    xhr.ontimeout = function() { cb(new Error('Timeout'),       null); };
    xhr.send();
}

/* ──────────────────────────────────────────
   FULL SECTION WIDGET  (index.html)
   ────────────────────────────────────────── */
function renderWeatherFull(data) {
    var c = data.current, d = data.daily;
    var info  = wmo(c.weather_code);
    var uv    = uvLabel(c.uv_index || 0);
    var now   = new Date();
    var timeStr = now.toLocaleTimeString('en-NP', { hour:'2-digit', minute:'2-digit' });

    /* forecast cards */
    var forecastHtml = d.time.map(function(date, i) {
        var fi    = wmo(d.weather_code[i]);
        var rain  = d.precipitation_probability_max[i] || 0;
        var hi    = Math.round(d.temperature_2m_max[i]);
        var lo    = Math.round(d.temperature_2m_min[i]);
        return '<div class="wfc-card wfc-' + fi.type + '">' +
            '<div class="wfc-day">' + dayName(date, i) + '</div>' +
            '<div class="wfc-emoji">' + fi.emoji + '</div>' +
            '<div class="wfc-desc">' + fi.label + '</div>' +
            '<div class="wfc-temps"><span class="wfc-hi">' + hi + '°</span><span class="wfc-lo">' + lo + '°</span></div>' +
            '<div class="wfc-rain" title="Rain probability">💧 ' + rain + '%</div>' +
        '</div>';
    }).join('');

    var html =
        '<div class="weather-main-card wbg-' + info.type + '">' +
            '<div class="weather-mc-left">' +
                '<div class="weather-icon-wrap weather-anim-' + info.type + '">' +
                    '<span class="weather-icon-emoji">' + info.emoji + '</span>' +
                '</div>' +
                '<div class="weather-temp-block">' +
                    '<div class="weather-temp-num">' + Math.round(c.temperature_2m) +
                        '<span class="weather-temp-deg">°C</span></div>' +
                    '<div class="weather-desc-label">' + info.label + '</div>' +
                    '<div class="weather-feels">Feels like ' + Math.round(c.apparent_temperature) + '°C</div>' +
                '</div>' +
            '</div>' +

            '<div class="weather-mc-right">' +
                '<div class="weather-location-row">' +
                    '&#x1F4CD; ' + W_CITY + ', Nepal' +
                    '<span class="weather-updated">Live &bull; ' + timeStr + '</span>' +
                '</div>' +

                '<div class="weather-stats-grid">' +
                    '<div class="weather-stat-box"><span class="wsb-icon">💧</span><span class="wsb-val">' + c.relative_humidity_2m + '%</span><span class="wsb-lbl">Humidity</span></div>' +
                    '<div class="weather-stat-box"><span class="wsb-icon">💨</span><span class="wsb-val">' + Math.round(c.wind_speed_10m) + ' km/h ' + windDir(c.wind_direction_10m) + '</span><span class="wsb-lbl">Wind</span></div>' +
                    '<div class="weather-stat-box"><span class="wsb-icon">🌧️</span><span class="wsb-val">' + (c.precipitation || 0).toFixed(1) + ' mm</span><span class="wsb-lbl">Precipitation</span></div>' +
                    '<div class="weather-stat-box"><span class="wsb-icon">☀️</span><span class="wsb-val" style="color:' + uv.color + '">' + (c.uv_index || 0).toFixed(1) + ' <small>(' + uv.label + ')</small></span><span class="wsb-lbl">UV Index</span></div>' +
                    '<div class="weather-stat-box"><span class="wsb-icon">🌅</span><span class="wsb-val">' + fmtTime(d.sunrise[0]) + '</span><span class="wsb-lbl">Sunrise</span></div>' +
                    '<div class="weather-stat-box"><span class="wsb-icon">🌇</span><span class="wsb-val">' + fmtTime(d.sunset[0])  + '</span><span class="wsb-lbl">Sunset</span></div>' +
                '</div>' +

                '<div class="weather-activity-tip">' + activityTip(c.weather_code, c.temperature_2m) + '</div>' +
            '</div>' +
        '</div>' +

        '<div class="weather-forecast-strip">' + forecastHtml + '</div>' +

        '<div class="weather-footer-row">' +
            '<span style="font-size:0.75rem;color:var(--mid)">&#x1F4E1; Live data from Open-Meteo &bull; Auto-refreshes every 30 minutes</span>' +
            '<button onclick="forceRefreshWeather()" class="weather-refresh-btn" title="Refresh weather">&#x21BA; Refresh</button>' +
        '</div>';

    var el = document.getElementById('weatherMain');
    if (el) el.innerHTML = html;
}

/* ──────────────────────────────────────────
   COMPACT WIDGET  (admin dashboard)
   ────────────────────────────────────────── */
function renderWeatherWidget(data) {
    var c    = data.current, d = data.daily;
    var info = wmo(c.weather_code);
    var rain = d.precipitation_probability_max[0] || 0;
    var hi   = Math.round(d.temperature_2m_max[0]);
    var lo   = Math.round(d.temperature_2m_min[0]);
    var html =
        '<div class="weather-widget-wrap weather-anim-' + info.type + '">' +
            '<div class="wwrap-top">' +
                '<span class="wwrap-emoji">' + info.emoji + '</span>' +
                '<div class="wwrap-temps">' +
                    '<div class="wwrap-current">' + Math.round(c.temperature_2m) + '°C</div>' +
                    '<div class="wwrap-desc">' + info.label + '</div>' +
                    '<div class="wwrap-hilo">&#x2191;' + hi + '° &#x2193;' + lo + '°</div>' +
                '</div>' +
            '</div>' +
            '<div class="wwrap-stats">' +
                '<span>💧 ' + c.relative_humidity_2m + '%</span>' +
                '<span>💨 ' + Math.round(c.wind_speed_10m) + ' km/h</span>' +
                '<span>🌧️ ' + rain + '%</span>' +
            '</div>' +
            '<div class="wwrap-location">📍 ' + W_CITY + '</div>' +
            '<div class="wwrap-tip">' + activityTip(c.weather_code, c.temperature_2m) + '</div>' +
        '</div>';
    var el = document.getElementById('adminWeatherWidget');
    if (el) el.innerHTML = html;
}

/* ──────────────────────────────────────────
   BOOKING STAY PREVIEW  (booking.html)
   ────────────────────────────────────────── */
function renderBookingWeather(data, checkIn, checkOut) {
    var d = data.daily;
    var el = document.getElementById('bookingWeatherPreview');
    if (!el) return;

    /* filter daily forecast to stay dates */
    var stayCards = [];
    for (var i = 0; i < d.time.length; i++) {
        if (checkIn && checkOut) {
            if (d.time[i] < checkIn || d.time[i] > checkOut) continue;
        }
        stayCards.push(i);
    }

    if (!stayCards.length) {
        el.innerHTML = '';
        el.style.display = 'none';
        return;
    }

    var c    = data.current;
    var cInfo = wmo(c.weather_code);

    var cardsHtml = stayCards.map(function(i) {
        var fi   = wmo(d.weather_code[i]);
        var rain = d.precipitation_probability_max[i] || 0;
        var hi   = Math.round(d.temperature_2m_max[i]);
        var lo   = Math.round(d.temperature_2m_min[i]);
        var nm   = dayName(d.time[i], i);
        return '<div class="bwp-card">' +
            '<div class="bwp-day">' + nm + '<br><small style="font-size:0.68rem;opacity:0.7">' + d.time[i].slice(5) + '</small></div>' +
            '<div class="bwp-emoji">' + fi.emoji + '</div>' +
            '<div class="bwp-desc">' + fi.label + '</div>' +
            '<div class="bwp-temps"><span style="color:#dc2626">' + hi + '°</span> / <span style="color:#2563eb">' + lo + '°</span></div>' +
            '<div class="bwp-rain">💧 ' + rain + '%</div>' +
        '</div>';
    }).join('');

    el.innerHTML =
        '<div class="bwp-header">' +
            '<span class="bwp-title">🌤 Weather During Your Stay</span>' +
            '<span class="bwp-now">' + cInfo.emoji + ' Now: ' + Math.round(c.temperature_2m) + '°C · ' + cInfo.label + '</span>' +
        '</div>' +
        '<div class="bwp-cards">' + cardsHtml + '</div>' +
        '<div class="bwp-tip">' + activityTip(c.weather_code, c.temperature_2m) + '</div>';
    el.style.display = 'block';
}

/* ──────────────────────────────────────────
   PUBLIC API
   ────────────────────────────────────────── */

/* Index page — full section */
function initWeatherSection() {
    var el = document.getElementById('weatherMain');
    if (!el) return;
    el.innerHTML = '<div class="weather-loading"><div class="weather-skeleton-pulse"></div><p>Fetching live weather for Bharatpur, Chitwan…</p></div>';
    fetchWeather(function(err, data) {
        if (err) {
            el.innerHTML = '<div class="weather-error"><p>⚠️ Weather data temporarily unavailable. Please check back shortly.</p></div>';
            return;
        }
        renderWeatherFull(data);
    });
    /* auto-refresh every 30 min */
    setInterval(function() {
        localStorage.removeItem(W_CACHE_KEY);
        fetchWeather(function(err, data) { if (!err) renderWeatherFull(data); });
    }, W_CACHE_TTL);
}

/* Admin dashboard — compact widget */
function initWeatherWidget() {
    var el = document.getElementById('adminWeatherWidget');
    if (!el) return;
    el.innerHTML = '<p style="color:var(--mid);font-size:0.82rem;padding:8px 0">Loading weather…</p>';
    fetchWeather(function(err, data) {
        if (err) { el.innerHTML = '<p style="color:var(--mid);font-size:0.82rem">Weather unavailable.</p>'; return; }
        renderWeatherWidget(data);
    });
}

/* Booking page — stay forecast */
function initBookingWeather() {
    fetchWeather(function(err, data) {
        if (err) return;
        window._weatherData = data;
        updateBookingWeatherPreview();
    });
}

function updateBookingWeatherPreview() {
    if (!window._weatherData) return;
    var checkIn  = document.getElementById('check-in')  ? document.getElementById('check-in').value  : '';
    var checkOut = document.getElementById('check-out') ? document.getElementById('check-out').value : '';
    renderBookingWeather(window._weatherData, checkIn, checkOut);
}

/* Force refresh button */
function forceRefreshWeather() {
    localStorage.removeItem(W_CACHE_KEY);
    var el = document.getElementById('weatherMain');
    if (el) el.innerHTML = '<div class="weather-loading"><div class="weather-skeleton-pulse"></div><p>Refreshing…</p></div>';
    fetchWeather(function(err, data) {
        if (!err) renderWeatherFull(data);
        else if (el) el.innerHTML = '<div class="weather-error"><p>⚠️ Refresh failed. Check your connection.</p></div>';
    });
}
