// Global State variables
let pricesData = null;
let metaData = null;

let relativeChart = null;
let trendChart = null;
let volumeChart = null;
let ihsgTrendChart = null; // simple IHSG MA50 chart
let activeScalingChart = null; // track the chart being dragged/scaled on x-axis

// Timeframe state
let currentTimeframe = 'daily'; // controls trendChart & volumeChart
let relativeTimeframe = 'daily'; // controls relativeChart
let heatmapTimeframe = 'daily'; // controls simple IHSG & stock heatmap

// Sync lock to prevent recursive updates between linked charts
let isSyncing = false;
let isDetailChartAnimating = false;

// Ruler measurement tool state
let rulerState = {
    active: false,
    startPoint: null,
    endPoint: null,
    currentMousePoint: null,
    isMeasuring: false
};

// Crosshair state for synchronized charts
let crosshairState = {
    xVal: null,
    yValTrend: null,
    yValVolume: null,
    activeChartId: null
};

// Pre-cached sorted timestamps for O(log n) snap — filled by updateTrendChart
let _trendTimestamps = [];

// RAF handle to throttle crosshair redraws to 60fps
let _crosshairRafId = null;


// Ticker Names Map for display
const TICKER_NAMES = {
    "BBCA": "PT Bank Central Asia Tbk",
    "BBRI": "PT Bank Rakyat Indonesia Tbk",
    "BMRI": "PT Bank Mandiri Tbk",
    "TLKM": "PT Telkom Indonesia Tbk",
    "BREN": "PT Barito Renewables Energy Tbk",
    "AMMN": "PT Amman Mineral Internasional Tbk",
    "IHSG": "Indeks Harga Saham Gabungan (IHSG)"
};

// Colors for Chart 1
const ASSET_COLORS = {
    "IHSG": "#9CA3AF", // Light Gray (Benchmark)
    "BBCA": "#F59E0B", // Amber
    "BBRI": "#3B82F6", // Blue
    "BMRI": "#F97316", // Orange
    "TLKM": "#EF4444", // Red
    "BREN": "#10B981", // Green
    "AMMN": "#06B6D4"  // Cyan
};

// Document Ready
document.addEventListener('DOMContentLoaded', () => {
    initDashboard();
});

async function initDashboard() {
    try {
        // Fetch JSON files
        const [pricesRes, metaRes] = await Promise.all([
            fetch('data/prices.json?t=' + Date.now()),
            fetch('data/meta.json?t=' + Date.now())
        ]);
        
        if (!pricesRes.ok || !metaRes.ok) {
            throw new Error('Failed to fetch data files');
        }
        
        pricesData = await pricesRes.json();
        metaData = await metaRes.json();
        
        // Pre-calculate rebased return for each stock relative to its first active day (IPO date)
        Object.keys(pricesData).forEach(ticker => {
            const data = pricesData[ticker];
            const firstActiveItem = data.find(item => item.active !== false);
            const firstClose = firstActiveItem ? firstActiveItem.close : null;
            data.forEach(item => {
                if (firstClose !== null && item.active !== false) {
                    item.rebased = firstClose !== 0 ? ((item.close - firstClose) / firstClose) * 100 : 0;
                } else {
                    item.rebased = null;
                }
            });
        });
        
        // Setup metadata & KPI counters
        setupMetadata();
        setupKPIs();
        
        // Render Chart 1 (Relative Performance)
        renderRelativeChart();
        
        // Init Selected Stock detail charts and insights
        const stockSelect = document.getElementById('stock-select');
        
        // Setup global timeframe button selector (controls trend & volume charts only)
        const tfSelector = document.getElementById('timeframe-selector');
        tfSelector.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                tfSelector.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentTimeframe = e.target.dataset.tf;

                const currentStock = document.getElementById('stock-select').value;
                transitionDetailCharts(() => updateSelectedStockView(currentStock));
            });
        });

        // Setup relative performance timeframe button selector (controls relative chart only)
        const relTfSelector = document.getElementById('relative-timeframe-selector');
        relTfSelector.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                relTfSelector.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                relativeTimeframe = e.target.dataset.tf;

                transitionRelativeChart(() => updateRelativeChart());
            });
        });
        
        // Setup heatmap & simple IHSG timeframe button selector (locks them together)
        const heatTfSelector = document.getElementById('heatmap-timeframe-selector');
        if (heatTfSelector) {
            heatTfSelector.querySelectorAll('.tf-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    heatTfSelector.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                    e.target.classList.add('active');
                    heatmapTimeframe = e.target.dataset.tf;
                    updateOverviewSection();
                });
            });
        }
        
        // Setup initial view
        updateAllViews();
        
        // Setup ruler measurement tool button and event handlers
        setupRulerToggle();
        setupRulerEvents();
        
        // Setup crosshair event handlers
        setupCrosshairEvents();
        
        // Add dropdown change listener — transition detail charts on stock switch
        stockSelect.addEventListener('change', (e) => {
            transitionDetailCharts(() => updateSelectedStockView(e.target.value));
        });
        
        // Add double-click listeners on canvases for zoom reset
        const relativeCanvas = document.getElementById('relativePerformanceChart');
        const trendCanvas = document.getElementById('trendChart');
        const volumeCanvas = document.getElementById('volumeChart');
        
        relativeCanvas.addEventListener('dblclick', () => {
            handleChartReset(relativeChart);
        });
        
        trendCanvas.addEventListener('dblclick', () => {
            handleChartReset(trendChart);
            if (volumeChart) {
                syncXAxis(trendChart, volumeChart);
            }
            updateInsightsFromChart();
        });
        
        volumeCanvas.addEventListener('dblclick', () => {
            handleChartReset(trendChart);
            if (volumeChart) {
                syncXAxis(trendChart, volumeChart);
            }
            updateInsightsFromChart();
        });
        
    } catch (error) {
        console.error('Initialization error:', error);
        document.getElementById('analysis-insights-box').innerHTML = `
            <div style="color: var(--bearish-color); padding: 10px; border: 1px solid rgba(255,85,85,0.2); background: rgba(255,85,85,0.05); border-radius: 6px;">
                <strong>Gagal memuat data dashboard.</strong> Silakan jalankan <code>python scripts/fetch_data.py</code> untuk membuat file data JSON terlebih dahulu.
            </div>
        `;
    }
}

// Setup static metadata values
function setupMetadata() {
    document.getElementById('last-update-time').textContent = metaData.last_update;
}

/// Easing function: ease-out cubic (fast start, decelerates to final value)
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

// Count-up animation using requestAnimationFrame with ease-out easing
function animateValue(target, start, end, duration, decimalPlaces, prefix, suffix) {
    if (decimalPlaces === undefined) decimalPlaces = 0;
    if (prefix === undefined) prefix = "";
    if (suffix === undefined) suffix = "";
    
    const obj = (typeof target === 'string') ? document.getElementById(target) : target;
    if (!obj) return;

    const isNegative = end < 0;
    const absoluteEnd   = Math.abs(end);
    const absoluteStart = Math.abs(start);

    let startTimestamp = null;

    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const elapsed  = timestamp - startTimestamp;
        const rawProgress = Math.min(elapsed / duration, 1);
        const easedProgress = easeOutCubic(rawProgress);  // fast-start, slow-end
        const currentVal = absoluteStart + easedProgress * (absoluteEnd - absoluteStart);

        const displayVal = currentVal.toLocaleString('id-ID', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces
        });
        const sign = isNegative ? "-" : (suffix.includes("%") && end > 0 ? "+" : "");
        obj.textContent = prefix + sign + displayVal + suffix;

        if (rawProgress < 1) {
            window.requestAnimationFrame(step);
        }
    };

    window.requestAnimationFrame(step);
}

// Force-restart a CSS animation on an element (works on every call, including refresh)
function triggerCountup(el, delayMs) {
    if (!el) return;
    delayMs = delayMs || 0;
    // Remove class, force reflow so browser resets the animation, then re-add
    el.classList.remove('kpi-countup');
    void el.offsetWidth; // <-- forces browser to flush style recalculation
    el.style.animationDelay = delayMs + 'ms';
    el.classList.add('kpi-countup');
}

/// Setup KPIs with count-up animations — restarts on every page load / refresh
function setupKPIs() {
    const COUNT_DURATION = 3750; // ms  (5× slower than original 750ms)
    const CSS_ANIM_MS    = 600;  // match .kpi-countup animation duration

    // Stagger delays per card (CSS pop-in start offset)
    const STAGGER = [0, 150, 300, 450];

    // Helper: pop-in CSS then start count-up after the CSS anim is visible
    function popAndCount(elId, targetVal, decimals, prefix, suffix, staggerIdx) {
        prefix = prefix || '';
        suffix = suffix || '';
        const el = document.getElementById(elId);
        const cssDelay   = STAGGER[staggerIdx];          // when CSS anim starts
        const countStart = cssDelay + CSS_ANIM_MS;       // count-up starts after anim shows element
        triggerCountup(el, cssDelay);
        setTimeout(function() {
            animateValue(elId, 0, targetVal, COUNT_DURATION, decimals, prefix, suffix);
        }, countStart);
    }

    // KPI 1: IHSG Current Close
    popAndCount('kpi-ihsg-val', metaData.ihsg_current, 2, '', '', 0);

    // KPI 2: Status Pasar — text label, pop-in only (no count-up)
    const statusVal  = document.getElementById('kpi-status-val');
    const statusDesc = document.getElementById('kpi-status-desc');
    if (statusVal) {
        if (metaData.status_pasar === 'Bullish') {
            statusVal.textContent = 'Cenderung Naik';
            statusVal.className = 'kpi-value text-success';
            if (statusDesc) statusDesc.textContent = 'Pasar secara umum sedang menguat';
        } else {
            statusVal.textContent = 'Cenderung Turun';
            statusVal.className = 'kpi-value text-danger';
            if (statusDesc) statusDesc.textContent = 'Pasar secara umum sedang melemah';
        }
        triggerCountup(statusVal, STAGGER[1]);
    }

    // KPI 3: Top Outperformer — inner span gets count-up
    var topOut    = metaData.top_outperformer;
    var topOutEl  = document.getElementById('kpi-outperformer-val');
    if (topOutEl) {
        topOutEl.innerHTML = topOut.ticker + ' <span id="top-out-pct">( 0,0%)</span>';
        triggerCountup(topOutEl, STAGGER[2]);
        setTimeout(function() {
            animateValue('top-out-pct', 0, topOut.return, COUNT_DURATION, 1, '(', '%)');
        }, STAGGER[2] + CSS_ANIM_MS);
    }

    // KPI 4: Top Underperformer — inner span gets count-up
    var topUnder   = metaData.top_underperformer;
    var topUnderEl = document.getElementById('kpi-underperformer-val');
    if (topUnderEl) {
        topUnderEl.innerHTML = topUnder.ticker + ' <span id="top-under-pct">( 0,0%)</span>';
        triggerCountup(topUnderEl, STAGGER[3]);
        setTimeout(function() {
            animateValue('top-under-pct', 0, topUnder.return, COUNT_DURATION, 1, '(', '%)');
        }, STAGGER[3] + CSS_ANIM_MS);
    }
}

// Helper to trigger update for all views
function updateAllViews() {
    updateRelativeChart();
    updateOverviewSection();
    const currentStock = document.getElementById('stock-select').value;
    updateSelectedStockView(currentStock);
}

// Get the length of the resampled series for a ticker
function getResampledLength(ticker) {
    if (!pricesData || !pricesData[ticker]) return 0;
    const resampled = resampleDataset(pricesData[ticker], currentTimeframe);
    return resampled.length;
}

// Resample daily prices data based on timeframe
function resampleDataset(data, timeframe) {
    if (timeframe === 'daily') return data;
    
    const groups = {};
    data.forEach(item => {
        let key;
        if (timeframe === 'weekly') {
            key = getMondayDate(item.date);
        } else if (timeframe === 'monthly') {
            key = item.date.substring(0, 7);
        } else if (timeframe === 'yearly') {
            key = item.date.substring(0, 4);
        }
        
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(item);
    });
    
    const resampled = [];
    Object.keys(groups).sort().forEach(key => {
        const group = groups[key];
        const firstItem = group[0];
        const lastItem  = group[group.length - 1];
        
        // Aggregate OHLC and volume properly across the period
        const periodHigh = Math.max(...group.map(g => g.high));
        const periodLow  = Math.min(...group.map(g => g.low));
        const periodVolume = group.reduce((sum, g) => sum + g.volume, 0);
        
        // Determine warna_volume based on period close vs period open
        const warnaVolume = (lastItem.close >= firstItem.open) ? '#12C286' : '#FF5555';
        
        resampled.push({
            ...lastItem,
            open:   firstItem.open,
            high:   periodHigh,
            low:    periodLow,
            close:  lastItem.close,
            volume: periodVolume,
            warna_volume: warnaVolume
        });
    });
    return resampled;
}

// Get the date string for Monday of the given date's week
function getMondayDate(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
}

// Helper to determine min and max values of visible data arrays for vertical scaling
// Handles both plain numbers (index-based axis) and OHLC/line objects ({x, o, h, l, c} or {x, y})
function autoScaleY(chart) {
    if (!chart) return;
    
    // Safely ensure chart.options.scales structures exist to avoid errors
    if (!chart.options) chart.options = {};
    if (!chart.options.scales) chart.options.scales = {};
    if (!chart.options.scales.x) chart.options.scales.x = {};
    if (!chart.options.scales.y) chart.options.scales.y = {};
    
    // Prioritize options (target range for update) over current scales (rendered range of previous frame)
    let xMin = chart.options.scales.x.min !== undefined ? chart.options.scales.x.min : (chart.scales && chart.scales.x ? chart.scales.x.min : undefined);
    let xMax = chart.options.scales.x.max !== undefined ? chart.options.scales.x.max : (chart.scales && chart.scales.x ? chart.scales.x.max : undefined);
    
    const hasRange = xMin !== undefined && xMax !== undefined && xMin !== null && xMax !== null;
    
    // Track min/max values dynamically by Y-axis ID (default is 'y')
    const boundsByAxis = {};
    
    const isTimeScale = chart.options.scales.x && (chart.options.scales.x.type === 'time' || chart.options.scales.x.type === 'timeseries');
    
    if (chart.data && chart.data.datasets) {
        chart.data.datasets.forEach((dataset, dsIndex) => {
            // Safely check dataset visibility without requiring scales to be fully rendered
            let isVisible = true;
            if (chart.isDatasetVisible && typeof chart.isDatasetVisible === 'function' && chart.scales && chart.scales.y) {
                isVisible = chart.isDatasetVisible(dsIndex);
            } else {
                isVisible = dataset.hidden !== true;
            }
            if (!isVisible) return;
            
            const axisID = dataset.yAxisID || 'y';
            if (!boundsByAxis[axisID]) {
                boundsByAxis[axisID] = { min: Infinity, max: -Infinity };
            }
            const bounds = boundsByAxis[axisID];
            
            const dataArray = dataset.data || [];
            dataArray.forEach((item, idx) => {
                if (item === null || item === undefined) return;
                
                let valMin, valMax;
                
                if (isTimeScale) {
                    // For time scales, items are objects like {x, o, h, l, c} or {x, y}
                    const t = item.x;
                    if (hasRange && (t < xMin || t > xMax)) return;
                    
                    if (item.o !== undefined && item.h !== undefined && item.l !== undefined && item.c !== undefined) {
                        valMin = item.l;
                        valMax = item.h;
                    } else if (item.y !== undefined) {
                        valMin = item.y;
                        valMax = item.y;
                    } else {
                        return;
                    }
                } else {
                    // For category scales, items are plain numbers or {y} objects, and checked by index
                    if (hasRange && (idx < xMin || idx > xMax)) return;
                    
                    const val = (typeof item === 'object' && item.y !== undefined) ? item.y : item;
                    if (typeof val !== 'number' || isNaN(val)) return;
                    valMin = val;
                    valMax = val;
                }
                
                if (valMin === null || valMin === undefined || isNaN(valMin)) return;
                if (valMax === null || valMax === undefined || isNaN(valMax)) return;
                
                if (valMin < bounds.min) bounds.min = valMin;
                if (valMax > bounds.max) bounds.max = valMax;
            });
        });
    }
    
    // Apply Y-axis range limits to each axis config
    Object.keys(boundsByAxis).forEach(axisID => {
        const bounds = boundsByAxis[axisID];
        if (bounds.min !== Infinity && bounds.max !== -Infinity) {
            if (!chart.options.scales[axisID]) {
                chart.options.scales[axisID] = {};
            }
            
            if (chart.canvas && chart.canvas.id === 'volumeChart') {
                const maxAbs = Math.max(Math.abs(bounds.min), Math.abs(bounds.max));
                const finalMax = maxAbs || 1.0;
                chart.options.scales[axisID].min = -finalMax * 1.15; // 15% headroom
                chart.options.scales[axisID].max = finalMax * 1.15;
            } else {
                const range = bounds.max - bounds.min;
                const padding = range * 0.05 || 1.0;
                chart.options.scales[axisID].min = bounds.min - padding;
                chart.options.scales[axisID].max = bounds.max + padding;
            }
        }
    });
}

// ── Chart Transition Helpers ─────────────────────────────────────────────────
// Fades out Chart 2 (trendChart) + Chart 3 (volumeChart), rebuilds them,
// then plays a slide-up fade-in entrance on each container.
function transitionDetailCharts(updateFn) {
    const trendCanvas    = document.getElementById('trendChart');
    const volumeCanvas   = document.getElementById('volumeChart');
    const trendWrapper   = trendCanvas  ? trendCanvas.closest('.chart-container')  : null;
    const volumeWrapper  = volumeCanvas ? volumeCanvas.closest('.chart-container') : null;

    // Step 1 — fade out
    [trendWrapper, volumeWrapper].forEach(el => {
        if (el) { el.classList.remove('chart-tf-enter'); el.classList.add('chart-tf-exit'); }
    });

    // Step 2 — after fade-out (≈180ms), rebuild and fade in
    setTimeout(() => {
        updateFn();

        [trendWrapper, volumeWrapper].forEach(el => {
            if (el) {
                el.classList.remove('chart-tf-exit');
                // Force reflow so animation restarts
                void el.offsetWidth;
                el.classList.add('chart-tf-enter');
            }
        });

        // Clean up class after animation completes
        setTimeout(() => {
            [trendWrapper, volumeWrapper].forEach(el => {
                if (el) el.classList.remove('chart-tf-enter');
            });
        }, 380);
    }, 190);
}

// Same transition for the Relative Performance chart (Chart 1).
function transitionRelativeChart(updateFn) {
    const canvas  = document.getElementById('relativePerformanceChart');
    const wrapper = canvas ? canvas.closest('.chart-container') : null;

    if (wrapper) { wrapper.classList.remove('chart-tf-enter'); wrapper.classList.add('chart-tf-exit'); }

    setTimeout(() => {
        updateFn();
        if (wrapper) {
            wrapper.classList.remove('chart-tf-exit');
            void wrapper.offsetWidth;
            wrapper.classList.add('chart-tf-enter');
        }
        setTimeout(() => { if (wrapper) wrapper.classList.remove('chart-tf-enter'); }, 380);
    }, 190);
}

// Sync X-axis zoom/pan between linked charts
function syncXAxis(sourceChart, targetChart) {
    if (!sourceChart || !targetChart || isSyncing) return;
    isSyncing = true;
    
    const sourceMin = sourceChart.scales.x.min;
    const sourceMax = sourceChart.scales.x.max;
    
    targetChart.options.scales.x.min = sourceMin;
    targetChart.options.scales.x.max = sourceMax;
    
    targetChart.update('none');
    isSyncing = false;
}

// Get default zoom size based on the timeframe
function getDefaultZoom(N, timeframe) {
    const tf = timeframe || currentTimeframe;
    if (tf === 'daily') return Math.min(N, 22);
    if (tf === 'weekly') return Math.min(N, 12);
    if (tf === 'monthly') return Math.min(N, 36);
    if (tf === 'yearly') return Math.min(N, 10);
    return N;
}

// Returns the appropriate Chart.js time unit for the current timeframe
function getTimeUnit() {
    if (currentTimeframe === 'daily')   return 'day';
    if (currentTimeframe === 'weekly')  return 'week';
    if (currentTimeframe === 'monthly') return 'month';
    if (currentTimeframe === 'yearly')  return 'year';
    return 'day';
}

// Extract the visible data range from resampled stock data
function getVisibleStockData(chart, resampledData) {
    if (!chart || !chart.scales || !chart.scales.x) {
        const N = resampledData.length;
        let tf = currentTimeframe;
        if (chart === relativeChart) tf = relativeTimeframe;
        if (chart === ihsgTrendChart) tf = heatmapTimeframe;
        return resampledData.slice(Math.max(0, N - getDefaultZoom(N, tf)));
    }
    
    const isTimeScale = chart.options.scales.x.type === 'timeseries' || chart.options.scales.x.type === 'time';
    
    if (isTimeScale) {
        const xMin = chart.scales.x.min;
        const xMax = chart.scales.x.max;
        return resampledData.filter(item => {
            const t = new Date(item.date).getTime();
            return t >= xMin && t <= xMax;
        });
    } else {
        const minIndex = Math.max(0, Math.floor(chart.scales.x.min));
        const maxIndex = Math.min(resampledData.length - 1, Math.ceil(chart.scales.x.max));
        return resampledData.slice(minIndex, maxIndex + 1);
    }
}

// Update insights box dynamically based on the current chart view range
function updateInsightsFromChart() {
    const ticker = document.getElementById('stock-select').value;
    const stockData = pricesData[ticker];
    if (!stockData) return;
    
    // Filter out pre-IPO/inactive days so insights are correct
    const activeStockData = stockData.filter(item => item.active !== false);
    const resampled = resampleDataset(activeStockData, currentTimeframe);
    const visibleData = getVisibleStockData(trendChart, resampled);
    generateInsights(ticker, visibleData, resampled);
}

// Handle double click reset interaction
function handleChartReset(chart) {
    if (!chart) return;
    
    const isTimeScale = chart.options.scales.x.type === 'timeseries' || chart.options.scales.x.type === 'time';
    let tf = currentTimeframe;
    if (chart === relativeChart) tf = relativeTimeframe;
    if (chart === ihsgTrendChart) tf = heatmapTimeframe;
    
    if (isTimeScale) {
        const dataset = chart.data.datasets[0];
        if (dataset && dataset.data && dataset.data.length > 0) {
            const data = dataset.data;
            const N = data.length;
            const defaultZoom = getDefaultZoom(N, tf);
            
            const minIndex = Math.max(0, N - defaultZoom);
            const maxIndex = N - 1;
            
            chart.options.scales.x.min = data[minIndex].x;
            chart.options.scales.x.max = data[maxIndex].x;
        }
    } else {
        const N = chart.data.labels ? chart.data.labels.length : 0;
        const defaultZoom = getDefaultZoom(N, tf);
        chart.options.scales.x.min = Math.max(0, N - defaultZoom);
        chart.options.scales.x.max = N - 1;
    }
    
    autoScaleY(chart);
    chart.update('none');
}

// Chart 1: Performa Relatif
function renderRelativeChart() {
    const ctx = document.getElementById('relativePerformanceChart').getContext('2d');
    
    relativeChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                zoom: {
                    limits: {
                        x: {
                            min: 0,
                            max: 'original',
                            minRange: 10
                        }
                    },
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPan: ({chart}) => {
                            autoScaleY(chart);
                            chart.update('none');
                        }
                    },
                    zoom: {
                        wheel: {
                            enabled: true,
                            speed: 0.1
                        },
                        pinch: {
                            enabled: true
                        },
                        mode: 'x',
                        onZoom: ({chart}) => {
                            autoScaleY(chart);
                            chart.update('none');
                        }
                    }
                },
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11 },
                        boxWidth: 12,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(20, 26, 33, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    borderWidth: 1,
                    titleColor: '#FFFFFF',
                    bodyColor: '#E5E7EB',
                    titleFont: { family: 'Inter', size: 12, weight: '600' },
                    bodyFont: { family: 'Inter', size: 11 },
                    padding: 14,
                    titleSpacing: 8,
                    bodySpacing: 6,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const val = context.parsed.y;
                                const sign = val > 0 ? '+' : '';
                                label += sign + val.toFixed(2) + '%';
                                
                                // Add actual price validation to tooltip
                                const dataIndex = context.dataIndex;
                                const prices = context.dataset.prices;
                                const firstClose = context.dataset.firstClose;
                                if (prices && prices[dataIndex] !== null && prices[dataIndex] !== undefined) {
                                    const actualPrice = prices[dataIndex];
                                    const ticker = context.dataset.label;
                                    const formattedPrice = actualPrice.toLocaleString('id-ID', {
                                        minimumFractionDigits: 0,
                                        maximumFractionDigits: 2
                                    });
                                    if (firstClose !== null && firstClose !== undefined) {
                                        const formattedFirst = firstClose.toLocaleString('id-ID', {
                                            minimumFractionDigits: 0,
                                            maximumFractionDigits: 2
                                        });
                                        if (ticker.includes('IHSG')) {
                                            label += ` (${formattedFirst} → ${formattedPrice})`;
                                        } else {
                                            label += ` (Rp ${formattedFirst} → Rp ${formattedPrice})`;
                                        }
                                    } else {
                                        if (ticker.includes('IHSG')) {
                                            label += ` (${formattedPrice})`;
                                        } else {
                                            label += ` (Rp ${formattedPrice})`;
                                        }
                                    }
                                }
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'timeseries',
                    time: { unit: 'year', tooltipFormat: 'dd MMM yyyy' },
                    adapters: { date: { locale: 'id' } },
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        maxTicksLimit: 12,
                        align: 'inner',
                        padding: 10
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        padding: 10,
                        callback: function(value) { return value.toFixed(0) + '%'; }
                    }
                }
            }
        }
    });

    setupXAxisDrag(relativeChart);
}

// Helper to map relative timeframe to Chart.js time scale unit
function getRelativeTimeUnit(timeframe) {
    if (timeframe === 'daily')   return 'day';
    if (timeframe === 'weekly')  return 'week';
    if (timeframe === 'monthly') return 'month';
    if (timeframe === 'yearly')  return 'year';
    return 'day';
}

// Update Chart 1 dynamically based on resampled and sliced datasets
function updateRelativeChart() {
    if (!relativeChart || !pricesData) return;
    
    const rawIHSG = pricesData["IHSG"];
    const resampledIHSG = resampleDataset(rawIHSG, relativeTimeframe);
    const labels = resampledIHSG.map(item => item.date);
    
    // Set time unit dynamically based on timeframe
    relativeChart.options.scales.x.time.unit = getRelativeTimeUnit(relativeTimeframe);
    
    const datasets = Object.keys(pricesData).map(ticker => {
        const resampled = resampleDataset(pricesData[ticker], relativeTimeframe);
        
        const rawData = pricesData[ticker];
        const firstActiveItem = rawData.find(item => item.active !== false);
        const firstClose = firstActiveItem ? firstActiveItem.close : null;
        
        // Filter out inactive items to avoid plotting flat zero lines before IPO
        const activeResampled = resampled.filter(item => item.active !== false);
        
        const dataPoints = activeResampled.map(item => ({
            x: new Date(item.date).getTime(),
            y: item.rebased
        }));
        
        const pricesList = activeResampled.map(item => item.close);
        
        // Prepend the actual IPO date at 0.0% so the performance line starts exactly at 0.0% at its start day
        if (firstActiveItem && dataPoints.length > 0) {
            const firstActiveTime = new Date(firstActiveItem.date).getTime();
            if (dataPoints[0].x !== firstActiveTime) {
                dataPoints.unshift({
                    x: firstActiveTime,
                    y: 0.0
                });
                pricesList.unshift(firstActiveItem.close);
            }
        }
        
        return {
            label: ticker === 'IHSG' ? 'IHSG (Pasar)' : ticker,
            data: dataPoints,
            prices: pricesList,
            firstClose: firstClose,
            borderColor: ASSET_COLORS[ticker] || '#FFF',
            borderWidth: ticker === 'IHSG' ? 3 : 1.8,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            zIndex: ticker === 'IHSG' ? 10 : 1
        };
    });
    
    datasets.sort((a, b) => (a.label.includes('IHSG') ? 1 : -1));
    
    relativeChart.data.labels = labels;
    
    const N = labels.length;
    const defaultZoom = getDefaultZoom(N, relativeTimeframe);
    
    const minIndex = Math.max(0, N - defaultZoom);
    const maxIndex = N - 1;
    
    // Set time scale limits in milliseconds
    const minTime = new Date(labels[minIndex]).getTime();
    const maxTime = new Date(labels[maxIndex]).getTime();
    
    relativeChart.options.scales.x.min = minTime;
    relativeChart.options.scales.x.max = maxTime;
    
    // Assign datasets to calculate target Y scale ranges
    relativeChart.data.datasets = datasets;
    autoScaleY(relativeChart);
    
    // Set datasets to flat 0% baseline for the initial frame
    const flatDatasets = datasets.map(ds => {
        return {
            ...ds,
            data: ds.data.map(pt => pt === null ? null : { x: pt.x, y: 0.0 })
        };
    });
    relativeChart.data.datasets = flatDatasets;
    
    // Turn off animation temporarily to draw the flat state instantly
    relativeChart.options.animation = false;
    relativeChart.update('none');
    
    // Animate lines rising up to target values smoothly
    setTimeout(() => {
        if (!relativeChart) return;
        
        relativeChart.options.animation = {
            duration: 1200,
            easing: 'easeOutCubic'
        };
        
        relativeChart.data.datasets = datasets;
        relativeChart.update();
        
        // Reset animation duration back to 0 after completion to keep drag scaling crisp
        setTimeout(() => {
            if (relativeChart && relativeChart.options) {
                relativeChart.options.animation = false;
            }
        }, 1250);
    }, 50);
}

function animateDetailChartsTimeframe(targetMin, targetMax, targetTrendChart, targetVolumeChart) {
    isDetailChartAnimating = true;
    
    // Clear crosshair state immediately to prevent visual glitches or redraw loops during animation
    crosshairState.xVal = null;
    crosshairState.yValTrend = null;
    crosshairState.yValVolume = null;
    crosshairState.activeChartId = null;
    
    const duration = 600; // Snapper 600ms rollout
    const startTime = performance.now();
    
    const windowSize = targetMax - targetMin;
    const startMin = targetMax;
    const startMax = targetMax + windowSize;
    
    // Temporarily disable tooltips, hover effects, and events to optimize performance during animation
    let originalTrendEvents = undefined;
    let originalVolumeEvents = undefined;
    
    // Calculate final Y limits by temporarily setting X scales to the target range
    let targetTrendYMin = null;
    let targetTrendYMax = null;
    if (targetTrendChart) {
        // Clear active hover state & tooltip
        try {
            if (targetTrendChart.tooltip) targetTrendChart.tooltip.setActiveElements([], {x: 0, y: 0});
            targetTrendChart.setActiveElements([]);
        } catch (e) {}
        
        originalTrendEvents = targetTrendChart.options.events;
        targetTrendChart.options.events = []; // Disable hover/tooltip processing
        
        targetTrendChart.options.scales.x.min = targetMin;
        targetTrendChart.options.scales.x.max = targetMax;
        autoScaleY(targetTrendChart);
        targetTrendYMin = targetTrendChart.options.scales.y.min;
        targetTrendYMax = targetTrendChart.options.scales.y.max;
        
        // Lock Y scale during animation
        targetTrendChart.options.scales.y.min = targetTrendYMin;
        targetTrendChart.options.scales.y.max = targetTrendYMax;
        
        // Disable zoom/pan during animation to prevent user scroll conflicts
        try {
            if (targetTrendChart.options.plugins.zoom && targetTrendChart.options.plugins.zoom.zoom && targetTrendChart.options.plugins.zoom.zoom.wheel) {
                targetTrendChart.options.plugins.zoom.zoom.wheel.enabled = false;
                targetTrendChart.options.plugins.zoom.pan.enabled = false;
            }
        } catch (e) {
            console.warn("Could not temporarily disable zoom for trend chart:", e);
        }
        
        // Set to start window initially
        targetTrendChart.options.scales.x.min = startMin;
        targetTrendChart.options.scales.x.max = startMax;
        targetTrendChart.update('none');
    }
    
    let targetVolumeYMin = null;
    let targetVolumeYMax = null;
    if (targetVolumeChart) {
        // Clear active hover state & tooltip
        try {
            if (targetVolumeChart.tooltip) targetVolumeChart.tooltip.setActiveElements([], {x: 0, y: 0});
            targetVolumeChart.setActiveElements([]);
        } catch (e) {}
        
        originalVolumeEvents = targetVolumeChart.options.events;
        targetVolumeChart.options.events = []; // Disable hover/tooltip processing
        
        targetVolumeChart.options.scales.x.min = targetMin;
        targetVolumeChart.options.scales.x.max = targetMax;
        autoScaleY(targetVolumeChart);
        targetVolumeYMin = targetVolumeChart.options.scales.y.min;
        targetVolumeYMax = targetVolumeChart.options.scales.y.max;
        
        // Lock Y scale during animation
        targetVolumeChart.options.scales.y.min = targetVolumeYMin;
        targetVolumeChart.options.scales.y.max = targetVolumeYMax;
        
        try {
            if (targetVolumeChart.options.plugins.zoom && targetVolumeChart.options.plugins.zoom.zoom && targetVolumeChart.options.plugins.zoom.zoom.wheel) {
                targetVolumeChart.options.plugins.zoom.zoom.wheel.enabled = false;
                targetVolumeChart.options.plugins.zoom.pan.enabled = false;
            }
        } catch (e) {
            console.warn("Could not temporarily disable zoom for volume chart:", e);
        }
        
        // Set to start window initially
        targetVolumeChart.options.scales.x.min = startMin;
        targetVolumeChart.options.scales.x.max = startMax;
        targetVolumeChart.update('none');
    }

    function step(now) {
        if (targetTrendChart !== trendChart || targetVolumeChart !== volumeChart) {
            return;
        }

        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Use easeOutQuart (1 - (1-t)^4) for snappier and smoother initial response
        const easedProgress = 1 - Math.pow(1 - progress, 4);
        
        const currentMin = startMin - easedProgress * (startMin - targetMin);
        const currentMax = startMax - easedProgress * (startMax - targetMax);
        
        if (trendChart) {
            trendChart.options.scales.x.min = currentMin;
            trendChart.options.scales.x.max = currentMax;
            trendChart.update('none');
        }
        if (volumeChart) {
            volumeChart.options.scales.x.min = currentMin;
            volumeChart.options.scales.x.max = currentMax;
            volumeChart.update('none');
        }
        
        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            isDetailChartAnimating = false;
            
            // Clear crosshair state one final time to prevent residual drawings
            crosshairState.xVal = null;
            crosshairState.yValTrend = null;
            crosshairState.yValVolume = null;
            crosshairState.activeChartId = null;

            // Unlock Y scales and re-enable zoom/pan and default events
            if (trendChart) {
                trendChart.options.scales.y.min = undefined;
                trendChart.options.scales.y.max = undefined;
                trendChart.options.events = originalTrendEvents; // Restore events
                autoScaleY(trendChart);
                try {
                    if (trendChart.options.plugins.zoom && trendChart.options.plugins.zoom.zoom && trendChart.options.plugins.zoom.zoom.wheel) {
                        trendChart.options.plugins.zoom.zoom.wheel.enabled = true;
                        trendChart.options.plugins.zoom.pan.enabled = true;
                    }
                } catch (e) {
                    console.warn("Could not re-enable zoom for trend chart:", e);
                }
                trendChart.update('none');
            }
            if (volumeChart) {
                volumeChart.options.scales.y.min = undefined;
                volumeChart.options.scales.y.max = undefined;
                volumeChart.options.events = originalVolumeEvents; // Restore events
                autoScaleY(volumeChart);
                try {
                    if (volumeChart.options.plugins.zoom && volumeChart.options.plugins.zoom.zoom && volumeChart.options.plugins.zoom.zoom.wheel) {
                        volumeChart.options.plugins.zoom.zoom.wheel.enabled = true;
                        volumeChart.options.plugins.zoom.pan.enabled = true;
                    }
                } catch (e) {
                    console.warn("Could not re-enable zoom for volume chart:", e);
                }
                volumeChart.update('none');
            }
            updateInsightsFromChart();
        }
    }
    
    requestAnimationFrame(step);
}

// Update Detail View (Chart 2, Chart 3, and Insights)
function updateSelectedStockView(ticker) {
    document.querySelectorAll('.selected-stock-ticker').forEach(function(el) {
        el.textContent = ticker;
    });
    document.querySelectorAll('.selected-stock-ticker-full').forEach(function(el) {
        el.textContent = ' - ' + TICKER_NAMES[ticker];
    });

    var stockData = pricesData[ticker];
    if (!stockData) return;

    // Filter inactive/pre-IPO rows
    var activeStockData = stockData.filter(function(item) { return item.active !== false; });
    var resampled = resampleDataset(activeStockData, currentTimeframe);

    // Compute initial x window BEFORE building charts so they render correctly on first frame
    var N = resampled.length;
    var defaultZoom = getDefaultZoom(N, currentTimeframe);
    var minIndex = Math.max(0, N - defaultZoom);
    var maxIndex = N - 1;

    var initialMin = null;
    var initialMax = null;
    var startMin = null;
    var startMax = null;
    if (N > 0) {
        initialMin = new Date(resampled[minIndex].date).getTime();
        initialMax = new Date(resampled[maxIndex].date).getTime();
        var windowSize = initialMax - initialMin;
        startMin = initialMax;
        startMax = initialMax + windowSize;
    }

    updateTrendChart(resampled, ticker, startMin, startMax);
    updateMACDChart(resampled, startMin, startMax);

    // autoScaleY after charts are built
    if (trendChart)  { autoScaleY(trendChart);  trendChart.update('none'); }
    if (volumeChart) { autoScaleY(volumeChart); volumeChart.update('none'); }

    if (N >= 2) {
        animateDetailChartsTimeframe(initialMin, initialMax, trendChart, volumeChart);
    } else {
        var visibleData = getVisibleStockData(trendChart, resampled);
        generateInsights(ticker, visibleData, resampled);
    }
}

// Chart 2: Trend Chart (Candlestick + MA lines)
function updateTrendChart(resampled, ticker, initialMin, initialMax) {
    var ctx = document.getElementById('trendChart').getContext('2d');
    if (trendChart) { trendChart.destroy(); trendChart = null; }

    var timeUnit = getTimeUnit();

    // Force global chartjs-chart-financial colors to match our vibrant KPI colors
    if (Chart.defaults && Chart.defaults.elements && Chart.defaults.elements.candlestick) {
        Chart.defaults.elements.candlestick.color = { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' };
        Chart.defaults.elements.candlestick.borderColor = { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' };
    }

    var candleData = resampled.map(function(item) {
        return { x: new Date(item.date).getTime(), o: item.open, h: item.high, l: item.low, c: item.close };
    });

    // Pre-build sorted timestamps cache for O(log n) snap during mousemove
    _trendTimestamps = candleData.map(function(d) { return d.x; }).sort(function(a, b) { return a - b; });
    
    var ma20Data = resampled.map(function(item) {
        return { x: new Date(item.date).getTime(), y: item.ma20 != null ? item.ma20 : null };
    });
    var ma50Data = resampled.map(function(item) {
        return { x: new Date(item.date).getTime(), y: item.ma50 != null ? item.ma50 : null };
    });

    trendChart = new Chart(ctx, {
        type: 'candlestick',
        data: { datasets: [
            { type: 'candlestick', label: ticker, data: candleData,
              color: { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' },
              borderColor: { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' } },
            { type: 'line', label: 'Rata-rata 20 Hari (MA20)', data: ma20Data, borderColor: '#F59E0B', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [4, 3], tension: 0.1, spanGaps: true },
            { type: 'line', label: 'Rata-rata 50 Hari (MA50)', data: ma50Data, borderColor: '#3B82F6', borderWidth: 1.5, pointRadius: 0, fill: false, borderDash: [6, 4], tension: 0.1, spanGaps: true }
        ]},
        plugins: [trendChartRulerPlugin, crosshairPlugin],
        options: {
            elements: {
                candlestick: {
                    color: { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' },
                    borderColor: { up: '#12C286', down: '#FF5555', unchanged: '#9CA3AF' },
                    borderWidth: 1.5
                }
            },
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false, axis: 'x' },
            plugins: {
                zoom: {
                    pan: { enabled: true, mode: 'x', onPan: function(ref) {
                        var c = ref.chart; syncXAxis(c, volumeChart); autoScaleY(c);
                        if (volumeChart) { autoScaleY(volumeChart); volumeChart.update('none'); }
                        c.update('none'); updateInsightsFromChart();
                    }},
                    zoom: { wheel: { enabled: true, speed: 0.1 }, pinch: { enabled: true }, mode: 'x', onZoom: function(ref) {
                        var c = ref.chart; syncXAxis(c, volumeChart); autoScaleY(c);
                        if (volumeChart) { autoScaleY(volumeChart); volumeChart.update('none'); }
                        c.update('none'); updateInsightsFromChart();
                    }}
                },
                legend: { display: true, labels: { color: '#9CA3AF', font: { family: 'Inter', size: 10 },
                    filter: function(item) { return item.text.includes('MA20') || item.text.includes('MA50'); } } },
                tooltip: {
                    backgroundColor: 'rgba(20, 26, 33, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    borderWidth: 1,
                    padding: 14,
                    titleColor: '#FFFFFF',
                    bodyColor: '#E5E7EB',
                    titleFont: { family: 'Inter', size: 12, weight: '600' },
                    bodyFont: { family: 'Inter', size: 11 },
                    titleSpacing: 8,
                    bodySpacing: 6,
                    callbacks: { label: function(context) {
                        var ds = context.dataset;
                        if (ds.type === 'candlestick') {
                            var d = context.raw;
                            return ['Pembukaan : Rp '+d.o.toLocaleString('id-ID'), 'Tertinggi : Rp '+d.h.toLocaleString('id-ID'),
                                    'Terendah  : Rp '+d.l.toLocaleString('id-ID'), 'Penutupan : Rp '+d.c.toLocaleString('id-ID')];
                        }
                        var lbl = ds.label || ''; if (lbl) lbl += ': ';
                        lbl += 'Rp ';
                        if (context.parsed.y !== null) lbl += context.parsed.y.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                        return lbl;
                    }}
                }
            },
            scales: {
                x: {
                    type: 'timeseries',
                    offset: true,
                    min: initialMin != null ? initialMin : undefined,
                    max: initialMax != null ? initialMax : undefined,
                    time: { unit: timeUnit, tooltipFormat: 'dd MMM yyyy' },
                    adapters: { date: { locale: 'id' } },
                    grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false, offset: false },
                    ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 11, weight: '500' }, maxTicksLimit: 8, align: 'center', padding: 10 }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)', drawTicks: false },
                    ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 11, weight: '500' }, padding: 10,
                        callback: function(value) { return 'Rp ' + value.toLocaleString('id-ID'); } },
                    afterFit: function(scaleInstance) { scaleInstance.width = 95; }
                },
                yRight: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { display: false },
                    afterFit: function(scaleInstance) { scaleInstance.width = 75; }
                }
            }
        }
    });

    setupXAxisDrag(trendChart);
}

// Chart 3: MACD Chart
function updateMACDChart(resampled, initialMin, initialMax) {
    var ctx = document.getElementById('volumeChart').getContext('2d');
    if (volumeChart) { volumeChart.destroy(); volumeChart = null; }
    
    // Calculate MACD values
    const macdData = calculateMACD(resampled);
    
    const dates = resampled.map(item => new Date(item.date).getTime());
    
    const histogramData = resampled.map((item, idx) => ({
        x: dates[idx],
        y: macdData.histogram[idx]
    }));
    
    const macdLineData = resampled.map((item, idx) => ({
        x: dates[idx],
        y: macdData.macdLine[idx]
    }));
    
    const signalLineData = resampled.map((item, idx) => ({
        x: dates[idx],
        y: macdData.signalLine[idx]
    }));
    
    const barColors = macdData.histogram.map(val => val >= 0 ? '#12C286' : '#FF5555');
    
    const datasets = [
        {
            type: 'line',
            label: 'Garis MACD (Momentum)',
            data: macdLineData,
            borderColor: '#FFFFFF',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            order: 1
        },
        {
            type: 'line',
            label: 'Garis Sinyal',
            data: signalLineData,
            borderColor: '#3B82F6',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1,
            order: 2
        },
        {
            type: 'bar',
            label: 'Histogram (Kekuatan Tren)',
            data: histogramData,
            backgroundColor: barColors,
            borderColor: barColors,
            borderWidth: 1,
            barPercentage: 0.85,
            categoryPercentage: 0.95,
            order: 3
        }
    ];
    
    volumeChart = new Chart(ctx, {
        data: { datasets: datasets },
        plugins: [crosshairPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                zoom: {
                    pan: {
                        enabled: true,
                        mode: 'x',
                        onPan: ({chart}) => {
                            syncXAxis(chart, trendChart);
                            autoScaleY(chart);
                            if (trendChart) {
                                autoScaleY(trendChart);
                                trendChart.update('none');
                            }
                            chart.update('none');
                            updateInsightsFromChart();
                        }
                    },
                    zoom: {
                        wheel: { enabled: true, speed: 0.1 },
                        pinch: { enabled: true },
                        mode: 'x',
                        onZoom: ({chart}) => {
                            syncXAxis(chart, trendChart);
                            autoScaleY(chart);
                            if (trendChart) {
                                autoScaleY(trendChart);
                                trendChart.update('none');
                            }
                            chart.update('none');
                            updateInsightsFromChart();
                        }
                    }
                },
                legend: {
                    display: true,
                    labels: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 10 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(20, 26, 33, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    borderWidth: 1,
                    padding: 14,
                    titleColor: '#FFFFFF',
                    bodyColor: '#E5E7EB',
                    titleFont: { family: 'Inter', size: 12, weight: '600' },
                    bodyFont: { family: 'Inter', size: 11 },
                    titleSpacing: 8,
                    bodySpacing: 6,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const val = context.parsed.y;
                                const sign = val >= 0 ? '+' : '';
                                label += sign + val.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'timeseries',
                    min: initialMin != null ? initialMin : undefined,
                    max: initialMax != null ? initialMax : undefined,
                    time: { unit: getTimeUnit(), tooltipFormat: 'dd MMM yyyy' },
                    adapters: { date: { locale: 'id' } },
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        maxTicksLimit: 8,
                        align: 'inner',
                        padding: 10
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 11, weight: '500' },
                        padding: 10,
                        callback: function(value) {
                            if (value > 0) return '+' + value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                            if (value < 0) return value.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                            return '0';
                        }
                    },
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = 95;
                    }
                },
                yRight: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false },
                    ticks: { display: false },
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = 75;
                    }
                }
            }
        }
    });

    setupXAxisDrag(volumeChart);
}

// Generate Insights Automatically
function generateInsights(ticker, stockData, fullResampled) {
    if (stockData.length === 0) return;
    
    const latest = stockData[stockData.length - 1];
    const prev = stockData[stockData.length - 2] || latest;
    const first = stockData[0];
    
    const close = latest.close;
    const ma20 = latest.ma20;
    const ma50 = latest.ma50;
    
    // Calculate returns
    const stockReturn = ((close - first.close) / first.close * 100).toFixed(1);
    
    // Calculate IHSG return in same period
    const rawIHSG = pricesData["IHSG"];
    const resampledIHSG = resampleDataset(rawIHSG, currentTimeframe);
    // Find matching date in IHSG
    const matchingFirstIHSG = resampledIHSG.find(item => item.date === first.date) || resampledIHSG[0];
    const matchingLatestIHSG = resampledIHSG.find(item => item.date === latest.date) || resampledIHSG[resampledIHSG.length - 1];
    const ihsgReturn = ((matchingLatestIHSG.close - matchingFirstIHSG.close) / matchingFirstIHSG.close * 100).toFixed(1);
    
    // Update Timeframe Note beside the badges
    const noteEl = document.getElementById('insights-timeframe-note');
    if (noteEl) {
        let tfText = "";
        if (currentTimeframe === 'daily') tfText = "HARIAN";
        else if (currentTimeframe === 'weekly') tfText = "MINGGUAN";
        else if (currentTimeframe === 'monthly') tfText = "BULANAN";
        else if (currentTimeframe === 'yearly') tfText = "TAHUNAN";
        noteEl.textContent = tfText;
    }

    // 1. Determine Trend Badge & Text
    let trendBadge = "Tren Netral";
    let trendBadgeClass = "badge-neutral";
    let trendInsightText = "";
    
    if (close > ma50) {
        trendBadge = "Tren Naik";
        trendBadgeClass = "badge-bullish";
        trendInsightText = `sedang dalam <span class="text-success">tren naik</span>. Harga saat ini berada di atas harga rata-rata jangka menengahnya, menandakan dominasi minat beli di pasar.`;
    } else {
        trendBadge = "Tren Turun";
        trendBadgeClass = "badge-bearish";
        trendInsightText = `sedang dalam <span class="text-danger">tren turun</span>. Harga saat ini berada di bawah harga rata-rata jangka menengahnya, menandakan adanya tekanan jual.`;
    }
    
    // Add short-term MA20 reference
    let shortTermTrend = "";
    if (close > ma20) {
        shortTermTrend = `Secara jangka pendek, harga saham juga cenderung merangkak naik, mengonfirmasi pergerakan yang positif dalam beberapa hari/minggu terakhir.`;
    } else {
        shortTermTrend = `Secara jangka pendek, harga saham menunjukkan pelemahan, mengindikasikan adanya koreksi turun baru-baru ini.`;
    }
    
    // Update Trend Badge
    const trBadgeEl = document.getElementById('stock-trend-badge');
    if (trBadgeEl) {
        trBadgeEl.textContent = trendBadge;
        trBadgeEl.className = `badge ${trendBadgeClass}`;
    }
    
    // 2. Determine MACD Momentum Badge & Text
    const macdData = calculateMACD(fullResampled || stockData);
    const latestDate = latest.date;
    const fullDataset = fullResampled || stockData;
    const latestIdx = fullDataset.findIndex(item => item.date === latestDate);
    
    const latestMacd = latestIdx !== -1 ? macdData.macdLine[latestIdx] : macdData.macdLine[macdData.macdLine.length - 1];
    const latestSignal = latestIdx !== -1 ? macdData.signalLine[latestIdx] : macdData.signalLine[macdData.signalLine.length - 1];
    const latestHist = latestIdx !== -1 ? macdData.histogram[latestIdx] : macdData.histogram[macdData.histogram.length - 1];
    
    const prevIdx = latestIdx > 0 ? latestIdx - 1 : latestIdx;
    const prevHist = latestIdx !== -1 ? macdData.histogram[prevIdx] : (macdData.histogram[macdData.histogram.length - 2] || latestHist);
    
    let momentumBadge = "Dorongan Netral";
    let momentumBadgeClass = "badge-neutral";
    let momentumInsightText = "";
    
    if (latestMacd > latestSignal) {
        momentumBadge = "Dorongan Naik";
        momentumBadgeClass = "badge-bullish";
        momentumInsightText = `Kekuatan pergerakan harga saat ini <span class="text-success">menguat (dorongan naik)</span>. `;
    } else {
        momentumBadge = "Dorongan Turun";
        momentumBadgeClass = "badge-bearish";
        momentumInsightText = `Kekuatan pergerakan harga saat ini <span class="text-danger">melemah (dorongan turun)</span>. `;
    }
    
    // Add Histogram description
    if (latestHist > 0) {
        if (latestHist > prevHist) {
            momentumInsightText += `Dorongan beli terlihat semakin kuat dan solid.`;
        } else {
            momentumInsightText += `Meskipun masih dalam tren naik, kecepatan kenaikannya mulai melambat.`;
        }
    } else {
        if (latestHist < prevHist) {
            momentumInsightText += `Tekanan jual terlihat semakin membesar dari waktu ke waktu.`;
        } else {
            momentumInsightText += `Tekanan jual mulai mereda, membuka peluang bagi harga untuk mulai stabil atau berbalik naik.`;
        }
    }
    
    const momBadgeEl = document.getElementById('stock-volume-badge');
    if (momBadgeEl) {
        momBadgeEl.textContent = momentumBadge;
        momBadgeEl.className = `badge ${momentumBadgeClass}`;
    }
    
    // 3. Performance vs IHSG Text
    let relativePerformanceText = "";
    const isOutperformer = parseFloat(stockReturn) > parseFloat(ihsgReturn);
    const formattedStockReturn = (parseFloat(stockReturn) >= 0 ? '+' : '') + stockReturn;
    const formattedIhsgReturn = (parseFloat(ihsgReturn) >= 0 ? '+' : '') + ihsgReturn;
    
    if (isOutperformer) {
        relativePerformanceText = `Saham <strong>${ticker}</strong> tampil <span class="text-success">lebih unggul</span> dibandingkan dengan rata-rata pasar (IHSG). Selama periode ini, saham ${ticker} membukukan imbal hasil <strong>${formattedStockReturn}%</strong> sedangkan pasar (IHSG) hanya mencatat <strong>${formattedIhsgReturn}%</strong>.`;
    } else {
        relativePerformanceText = `Saham <strong>${ticker}</strong> tampil <span class="text-danger">tertinggal</span> dibandingkan dengan rata-rata pasar (IHSG). Selama periode ini, saham ${ticker} mencatat imbal hasil <strong>${formattedStockReturn}%</strong> sementara pasar (IHSG) mencatat <strong>${formattedIhsgReturn}%</strong>.`;
    }
    
    // 4. Determine Confirmation Text
    let confirmationText = "";
    const isPriceBullish = close > ma50;
    const isMacdBullish = latestMacd > latestSignal;
    
    if (isPriceBullish && isMacdBullish) {
        confirmationText = `Kenaikan harga saham didukung penuh oleh dorongan pasar yang kuat. Ini adalah tanda positif bahwa tren kenaikan kemungkinan besar masih akan berlanjut.`;
    } else if (isPriceBullish && !isMacdBullish) {
        confirmationText = `Meskipun harga secara umum masih dalam tren naik, dorongan naiknya mulai kehilangan tenaga. Harap berhati-hati terhadap potensi penurunan harga sementara (koreksi).`;
    } else if (!isPriceBullish && !isMacdBullish) {
        confirmationText = `Penurunan harga saham dipicu oleh tekanan jual yang masih kuat di pasar. Penurunan harga kemungkinan masih akan berlanjut.`;
    } else {
        confirmationText = `Meskipun harga masih cenderung turun, mulai terlihat dorongan beli yang mencoba menahan kejatuhan harga. Ini bisa menjadi sinyal awal pemulihan harga.`;
    }
    
    // Assemble final bullet points
    let htmlContent = `
        <p>Analisis pergerakan saham <strong>${TICKER_NAMES[ticker]} (${ticker})</strong> dalam periode yang dipilih menunjukkan kondisi berikut:</p>
        <ul>
            <li><strong>Kinerja:</strong> ${relativePerformanceText}</li>
            <li><strong>Arah Tren:</strong> Saham ${ticker} saat ini ${trendInsightText} ${shortTermTrend}</li>
            <li><strong>Kekuatan Naik/Turun (Momentum):</strong> ${momentumInsightText}</li>
            <li><strong>Kesimpulan:</strong> ${confirmationText}</li>
        </ul>
        <p style="margin-top: 16px; font-size: 0.9rem; color: var(--text-secondary); font-style: italic;">
            *Catatan: Analisis ini otomatis dihasilkan dari data historis terbaru dan bukan merupakan saran investasi resmi.
        </p>
    `;
    
    document.getElementById('analysis-insights-box').innerHTML = htmlContent;
}

// Setup premium custom cursor animations and hover state management
function initCustomCursor() {
    const cursor = document.querySelector('.custom-cursor');
    if (!cursor) return;

    let mouseX = -100;
    let mouseY = -100;
    let cursorX = -100;
    let cursorY = -100;
    let currentScale = 1.0;
    let targetScale = 1.0;
    let cursorVisible = false;

    // Track mouse coordinates
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX;
        mouseY = e.clientY;
        if (!cursorVisible) {
            cursor.style.opacity = 1;
            cursorVisible = true;
        }
        
        // Dynamically toggle ruler crosshair class on custom cursor
        if (rulerState && rulerState.active && e.target && (e.target.id === 'trendChart' || e.target.closest('#trendChart'))) {
            cursor.classList.add('ruler-mode');
        } else {
            cursor.classList.remove('ruler-mode');
        }

        // Detect if hovering over any active chart's bottom X-axis region
        let isScalingXArea = false;
        const activeChartsList = [relativeChart, trendChart, volumeChart, ihsgTrendChart];
        for (let i = 0; i < activeChartsList.length; i++) {
            const c = activeChartsList[i];
            if (c && c.canvas && c.canvas === e.target && c.chartArea) {
                const rect = c.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                if (y > c.chartArea.bottom && x >= c.chartArea.left && x <= c.chartArea.right) {
                    isScalingXArea = true;
                    break;
                }
            }
        }

        if (isScalingXArea) {
            cursor.classList.add('scaling-x-mode');
        } else {
            cursor.classList.remove('scaling-x-mode');
        }
    });

    // Handle mouse leaving and entering browser window
    document.addEventListener('mouseleave', () => {
        cursor.style.opacity = 0;
    });
    
    document.addEventListener('mouseenter', () => {
        if (cursorVisible) {
            cursor.style.opacity = 1;
        }
    });

    // Smooth position and scale interpolation (lerping)
    function animateCursor() {
        const easing = 0.15;
        cursorX += (mouseX - cursorX) * easing;
        cursorY += (mouseY - cursorY) * easing;
        currentScale += (targetScale - currentScale) * 0.2;

        // Offset translation to center the 16px wide circle on cursor hotspot
        cursor.style.transform = `translate3d(${cursorX - 8}px, ${cursorY - 8}px, 0) scale(${currentScale})`;
        
        requestAnimationFrame(animateCursor);
    }
    
    // Start animation loop
    requestAnimationFrame(animateCursor);

    // Hover state detection for interactive elements (using event delegation)
    document.addEventListener('mouseover', (e) => {
        const target = e.target;
        if (!target) return;
        
        const isInteractive = 
            target.tagName === 'A' ||
            target.tagName === 'BUTTON' ||
            target.tagName === 'SELECT' ||
            target.classList.contains('tf-btn') ||
            target.classList.contains('styled-select') ||
            target.closest('a') ||
            target.closest('button') ||
            target.closest('.styled-select') ||
            target.closest('.tf-btn');

        if (isInteractive) {
            targetScale = 1.8;
            cursor.classList.add('hovered');
        }
    });

    document.addEventListener('mouseout', (e) => {
        const target = e.target;
        if (!target) return;
        
        const isInteractive = 
            target.tagName === 'A' ||
            target.tagName === 'BUTTON' ||
            target.tagName === 'SELECT' ||
            target.classList.contains('tf-btn') ||
            target.classList.contains('styled-select') ||
            target.closest('a') ||
            target.closest('button') ||
            target.closest('.styled-select') ||
            target.closest('.tf-btn');

        if (isInteractive) {
            targetScale = 1.0;
            cursor.classList.remove('hovered');
        }
    });
}

// Initialize the custom cursor
if (matchMedia('(pointer: fine)').matches) {
    initCustomCursor();
}

// Ruler measurement tool helper functions & plugin definitions

const trendChartRulerPlugin = {
    id: 'rulerPlugin',
    afterDatasetsDraw(chart, args, options) {
        if (!rulerState.active || !rulerState.startPoint) return;
        
        const ctx = chart.ctx;
        const start = rulerState.startPoint;
        const end = rulerState.endPoint || rulerState.currentMousePoint;
        if (!end) return;
        
        // Convert data coordinates to pixel coordinates
        const x1 = chart.scales.x.getPixelForValue(start.xVal);
        const y1 = chart.scales.y.getPixelForValue(start.yVal);
        const x2 = chart.scales.x.getPixelForValue(end.xVal);
        const y2 = chart.scales.y.getPixelForValue(end.yVal);
        
        // Draw shaded area
        ctx.save();
        ctx.fillStyle = 'rgba(0, 102, 255, 0.12)';
        ctx.strokeStyle = '#0066FF';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        
        // Draw bounding box
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        
        // Draw dotted borders
        ctx.beginPath();
        // vertical line at start
        ctx.moveTo(x1, chart.chartArea.top);
        ctx.lineTo(x1, chart.chartArea.bottom);
        // vertical line at end
        ctx.moveTo(x2, chart.chartArea.top);
        ctx.lineTo(x2, chart.chartArea.bottom);
        // horizontal line at start
        ctx.moveTo(chart.chartArea.left, y1);
        ctx.lineTo(chart.chartArea.right, y1);
        // horizontal line at end
        ctx.moveTo(chart.chartArea.left, y2);
        ctx.lineTo(chart.chartArea.right, y2);
        ctx.stroke();
        
        // Draw arrows inside the box
        ctx.setLineDash([]);
        ctx.strokeStyle = 'rgba(0, 102, 255, 0.5)';
        ctx.lineWidth = 1.5;
        
        // Draw main lines for arrows
        ctx.beginPath();
        // vertical center arrow
        const centerX = (x1 + x2) / 2;
        ctx.moveTo(centerX, y1);
        ctx.lineTo(centerX, y2);
        // horizontal center arrow
        const centerY = (y1 + y2) / 2;
        ctx.moveTo(x1, centerY);
        ctx.lineTo(x2, centerY);
        ctx.stroke();
        
        // Draw arrowheads
        drawArrowhead(ctx, centerX, y2, y2 > y1 ? 'down' : 'up');
        drawArrowhead(ctx, x2, centerY, x2 > x1 ? 'right' : 'left');
        
        // Draw label box at the center of the box
        const startIdx = getClosestDataPointIndex(chart, start.xVal);
        const endIdx = getClosestDataPointIndex(chart, end.xVal);
        const startItem = chart.data.datasets[0].data[startIdx];
        const endItem = chart.data.datasets[0].data[endIdx];
        
        if (startItem && endItem) {
            // Price info
            const startPrice = start.yVal;
            const endPrice = end.yVal;
            const priceDiff = endPrice - startPrice;
            const pricePct = (priceDiff / startPrice) * 100;
            
            const sign = priceDiff >= 0 ? '+' : '';
            const priceDiffText = `${sign}${priceDiff.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
            const pricePctText = `${sign}${pricePct.toFixed(2)}%`;
            
            // Bars & Days info
            const bars = Math.abs(endIdx - startIdx) + 1;
            const msDiff = Math.abs(new Date(endItem.x) - new Date(startItem.x));
            const days = Math.round(msDiff / (1000 * 60 * 60 * 24));
            
            // Volume sum info
            const minIdx = Math.min(startIdx, endIdx);
            const maxIdx = Math.max(startIdx, endIdx);
            let volSum = 0;
            for (let i = minIdx; i <= maxIdx; i++) {
                const item = chart.data.datasets[0].data[i];
                if (item && item.volume) {
                    volSum += item.volume;
                }
            }
            
            let volText = '';
            if (volSum >= 1e9) volText = (volSum / 1e9).toFixed(2) + ' B';
            else if (volSum >= 1e6) volText = (volSum / 1e6).toFixed(2) + ' M';
            else if (volSum >= 1e3) volText = (volSum / 1e3).toFixed(2) + ' K';
            else volText = volSum.toLocaleString('id-ID');
            
            const textLines = [
                `${priceDiffText} (${pricePctText})`,
                `${bars} bars, ${days}d`,
                `Vol: ${volText}`
            ];
            
            // Draw tooltip box
            const boxWidth = 140;
            const boxHeight = 62;
            const boxX = centerX - boxWidth / 2;
            const boxY = Math.min(y1, y2) - boxHeight - 10; // place above the box
            
            // Keep box inside chartArea
            let finalBoxY = boxY;
            if (finalBoxY < chart.chartArea.top) {
                finalBoxY = Math.max(y1, y2) + 10; // place below the box if it goes above the top
            }
            
            // Draw box background
            ctx.fillStyle = '#0066FF';
            ctx.strokeStyle = '#3385FF';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(boxX, finalBoxY, boxWidth, boxHeight, 6);
            } else {
                ctx.rect(boxX, finalBoxY, boxWidth, boxHeight);
            }
            ctx.fill();
            ctx.stroke();
            
            // Draw text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 11px Inter';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            ctx.fillText(textLines[0], centerX, finalBoxY + 15);
            ctx.font = '500 10px Inter';
            ctx.fillText(textLines[1], centerX, finalBoxY + 32);
            ctx.fillText(textLines[2], centerX, finalBoxY + 48);
        }
        
        ctx.restore();
    }
};

function drawArrowhead(ctx, x, y, direction) {
    ctx.save();
    ctx.fillStyle = '#0066FF';
    ctx.beginPath();
    ctx.moveTo(x, y);
    const size = 5;
    if (direction === 'up') {
        ctx.lineTo(x - size, y + size);
        ctx.lineTo(x + size, y + size);
    } else if (direction === 'down') {
        ctx.lineTo(x - size, y - size);
        ctx.lineTo(x + size, y - size);
    } else if (direction === 'left') {
        ctx.lineTo(x + size, y - size);
        ctx.lineTo(x + size, y + size);
    } else if (direction === 'right') {
        ctx.lineTo(x - size, y - size);
        ctx.lineTo(x - size, y + size);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function getClosestDataPointIndex(chart, xVal) {
    const data = chart.data.datasets[0].data;
    if (!data || data.length === 0) return -1;
    
    let closestIndex = 0;
    let minDiff = Infinity;
    
    for (let i = 0; i < data.length; i++) {
        const diff = Math.abs(data[i].x - xVal);
        if (diff < minDiff) {
            minDiff = diff;
            closestIndex = i;
        }
    }
    return closestIndex;
}

function setupRulerToggle() {
    const rulerBtn = document.getElementById('ruler-tool-btn');
    if (!rulerBtn) return;
    
    rulerBtn.addEventListener('click', () => {
        rulerState.active = !rulerState.active;
        const canvas = document.getElementById('trendChart');
        
        if (rulerState.active) {
            rulerBtn.classList.add('active');
            if (canvas) canvas.classList.add('ruler-cursor');
            
            // Disable chart zoom & pan
            if (trendChart && trendChart.options.plugins.zoom) {
                trendChart.options.plugins.zoom.zoom.wheel.enabled = false;
                trendChart.options.plugins.zoom.zoom.pinch.enabled = false;
                trendChart.options.plugins.zoom.pan.enabled = false;
                trendChart.update('none');
            }
            if (volumeChart && volumeChart.options.plugins.zoom) {
                volumeChart.options.plugins.zoom.zoom.wheel.enabled = false;
                volumeChart.options.plugins.zoom.zoom.pinch.enabled = false;
                volumeChart.options.plugins.zoom.pan.enabled = false;
                volumeChart.update('none');
            }
        } else {
            rulerBtn.classList.remove('active');
            if (canvas) canvas.classList.remove('ruler-cursor');
            clearRuler();
            
            // Enable chart zoom & pan
            if (trendChart && trendChart.options.plugins.zoom) {
                trendChart.options.plugins.zoom.zoom.wheel.enabled = true;
                trendChart.options.plugins.zoom.zoom.pinch.enabled = true;
                trendChart.options.plugins.zoom.pan.enabled = true;
                trendChart.update('none');
            }
            if (volumeChart && volumeChart.options.plugins.zoom) {
                volumeChart.options.plugins.zoom.zoom.wheel.enabled = true;
                volumeChart.options.plugins.zoom.zoom.pinch.enabled = true;
                volumeChart.options.plugins.zoom.pan.enabled = true;
                volumeChart.update('none');
            }
        }
    });
}

function setupRulerEvents() {
    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    
    canvas.addEventListener('mousedown', (e) => {
        if (!rulerState.active) return;
        
        e.preventDefault();
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const xVal = trendChart.scales.x.getValueForPixel(x);
        const yVal = trendChart.scales.y.getValueForPixel(y);
        
        rulerState.startPoint = { xVal, yVal };
        rulerState.endPoint = null;
        rulerState.currentMousePoint = { xVal, yVal };
        rulerState.isMeasuring = true;
        
        trendChart.update('none');
    });
    
    canvas.addEventListener('mousemove', (e) => {
        if (!rulerState.active) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const xVal = trendChart.scales.x.getValueForPixel(x);
        const yVal = trendChart.scales.y.getValueForPixel(y);
        
        if (rulerState.isMeasuring) {
            rulerState.currentMousePoint = { xVal, yVal };
            trendChart.update('none');
        } else if (rulerState.startPoint && !rulerState.endPoint) {
            rulerState.currentMousePoint = { xVal, yVal };
            trendChart.update('none');
        }
    });
    
    canvas.addEventListener('mouseup', (e) => {
        if (!rulerState.active || !rulerState.isMeasuring) return;
        
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const xVal = trendChart.scales.x.getValueForPixel(x);
        const yVal = trendChart.scales.y.getValueForPixel(y);
        
        rulerState.endPoint = { xVal, yVal };
        rulerState.isMeasuring = false;
        
        trendChart.update('none');
    });
    
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && rulerState.active) {
            clearRuler();
        }
    });
}

function clearRuler() {
    rulerState.startPoint = null;
    rulerState.endPoint = null;
    rulerState.currentMousePoint = null;
    rulerState.isMeasuring = false;
    if (trendChart) {
        trendChart.update('none');
    }
}

// MACD Technical Indicator Calculations
function calculateEMA(values, period) {
    const ema = [];
    if (values.length === 0) return ema;
    
    const k = 2 / (period + 1);
    let currentEma = values[0];
    ema.push(currentEma);
    
    for (let i = 1; i < values.length; i++) {
        currentEma = (values[i] * k) + (currentEma * (1 - k));
        ema.push(currentEma);
    }
    return ema;
}

function calculateMACD(resampled) {
    const closes = resampled.map(item => item.close);
    const ema12 = calculateEMA(closes, 12);
    const ema26 = calculateEMA(closes, 26);
    
    const macdLine = [];
    for (let i = 0; i < closes.length; i++) {
        macdLine.push(ema12[i] - ema26[i]);
    }
    
    const signalLine = calculateEMA(macdLine, 9);
    
    const histogram = [];
    for (let i = 0; i < closes.length; i++) {
        histogram.push(macdLine[i] - signalLine[i]);
    }
    
    return {
        macdLine,
        signalLine,
        histogram
    };
}

// Format date for crosshair label box based on current timeframe
function formatDateForCrosshair(timestamp, timeframe) {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return "";
    
    if (timeframe === 'monthly') {
        return d.toLocaleDateString('id-ID', { month: 'short', year: 'numeric' });
    } else if (timeframe === 'yearly') {
        return d.toLocaleDateString('id-ID', { year: 'numeric' });
    } else {
        return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
    }
}

// Synced crosshair lines & axis labels plugin
const crosshairPlugin = {
    id: 'crosshairPlugin',
    afterDatasetsDraw(chart, args, options) {
        if (crosshairState.xVal === null) return;
        
        const ctx = chart.ctx;
        const xScale = chart.scales.x;
        const yScale = chart.scales.y;
        
        const xPixel = xScale.getPixelForValue(crosshairState.xVal);
        
        ctx.save();
        
        // 1. Draw synchronized vertical dotted line if inside chartArea
        if (xPixel >= chart.chartArea.left && xPixel <= chart.chartArea.right) {
            ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(xPixel, chart.chartArea.top);
            ctx.lineTo(xPixel, chart.chartArea.bottom);
            ctx.stroke();
            
            // Only draw X-axis label box if this is the active chart
            if (crosshairState.activeChartId === chart.canvas.id) {
                const text = formatDateForCrosshair(crosshairState.xVal, currentTimeframe);
                ctx.font = '10px Inter';
                const textWidth = ctx.measureText(text).width;
                const boxWidth = textWidth + 12;
                const boxHeight = 18;
                const boxX = xPixel - boxWidth / 2;
                const boxY = chart.chartArea.bottom + 2;
                
                // Keep box inside chart boundaries
                let finalBoxX = boxX;
                if (finalBoxX < chart.chartArea.left) {
                    finalBoxX = chart.chartArea.left;
                } else if (finalBoxX + boxWidth > chart.chartArea.right) {
                    finalBoxX = chart.chartArea.right - boxWidth;
                }
                
                ctx.fillStyle = '#2A3441';
                ctx.beginPath();
                if (ctx.roundRect) {
                    ctx.roundRect(finalBoxX, boxY, boxWidth, boxHeight, 3);
                } else {
                    ctx.rect(finalBoxX, boxY, boxWidth, boxHeight);
                }
                ctx.fill();
                
                ctx.fillStyle = '#FFFFFF';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, finalBoxX + boxWidth / 2, boxY + boxHeight / 2);
            }
        }
        
        // 2. Draw horizontal dotted line and Y-axis label box if this is the active chart
        if (crosshairState.activeChartId === chart.canvas.id) {
            const yVal = chart.canvas.id === 'trendChart' ? crosshairState.yValTrend : crosshairState.yValVolume;
            if (yVal !== null && yVal !== undefined) {
                const yPixel = yScale.getPixelForValue(yVal);
                
                if (yPixel >= chart.chartArea.top && yPixel <= chart.chartArea.bottom) {
                    ctx.strokeStyle = 'rgba(156, 163, 175, 0.4)';
                    ctx.lineWidth = 1;
                    ctx.setLineDash([3, 3]);
                    ctx.beginPath();
                    ctx.moveTo(chart.chartArea.left, yPixel);
                    ctx.lineTo(chart.chartArea.right, yPixel);
                    ctx.stroke();
                    
                    // Format Y value text
                    let formattedY = "";
                    if (chart.canvas.id === 'trendChart') {
                        formattedY = 'Rp ' + yVal.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
                    } else if (chart.canvas.id === 'volumeChart') {
                        const sign = yVal >= 0 ? '+' : '';
                        formattedY = sign + yVal.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    }
                    
                    ctx.font = '10px Inter';
                    const textWidth = ctx.measureText(formattedY).width;
                    const boxWidth = textWidth + 12;
                    const boxHeight = 18;
                    const boxX = chart.chartArea.left - boxWidth;
                    const boxY = yPixel - boxHeight / 2;
                    
                    // Constrain box vertically within chartArea
                    let finalBoxY = boxY;
                    if (finalBoxY < chart.chartArea.top) {
                        finalBoxY = chart.chartArea.top;
                    } else if (finalBoxY + boxHeight > chart.chartArea.bottom) {
                        finalBoxY = chart.chartArea.bottom - boxHeight;
                    }
                    
                    ctx.fillStyle = '#2A3441';
                    ctx.beginPath();
                    if (ctx.roundRect) {
                        ctx.roundRect(boxX, finalBoxY, boxWidth, boxHeight, 3);
                    } else {
                        ctx.rect(boxX, finalBoxY, boxWidth, boxHeight);
                    }
                    ctx.fill();
                    
                    ctx.fillStyle = '#FFFFFF';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(formattedY, boxX + boxWidth / 2, finalBoxY + boxHeight / 2);
                }
            }
        }
        
        ctx.restore();
    }
};

// Setup mousemove and mouseleave events to synchronize crosshairs
function setupCrosshairEvents() {
    const trendCanvas = document.getElementById('trendChart');
    const volumeCanvas = document.getElementById('volumeChart');
    
    if (!trendCanvas || !volumeCanvas) return;
    
    // Binary search: find index of nearest timestamp in sorted array
    function bsSnapTimestamp(ts) {
        var arr = _trendTimestamps;
        if (!arr || arr.length === 0) return ts;
        var lo = 0, hi = arr.length - 1;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (arr[mid] < ts) lo = mid + 1; else hi = mid;
        }
        // lo is first index >= ts; check lo-1 as well
        if (lo > 0 && Math.abs(arr[lo - 1] - ts) <= Math.abs(arr[lo] - ts)) lo--;
        return arr[lo];
    }

    const handleMouseMove = (e, chartId, chart, otherChart) => {
        // Skip crosshair updates during detail chart transition animation to avoid lag/conflicts
        if (isDetailChartAnimating) {
            return;
        }
        // Skip crosshair drawing during active ruler measurement
        if (rulerState && rulerState.active && rulerState.isMeasuring) {
            handleMouseLeave();
            return;
        }

        const rect = e.target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Ensure mouse is inside chart Area
        if (x < chart.chartArea.left || x > chart.chartArea.right ||
            y < chart.chartArea.top  || y > chart.chartArea.bottom) {
            handleMouseLeave();
            return;
        }

        // Get raw values then snap X to nearest candle (binary search, O(log n))
        const rawXVal = chart.scales.x.getValueForPixel(x);
        const yVal    = chart.scales.y.getValueForPixel(y);
        const snappedXVal = bsSnapTimestamp(rawXVal);

        // Only schedule a redraw if something actually changed
        const changed = (crosshairState.xVal !== snappedXVal ||
                         crosshairState.activeChartId !== chartId);

        crosshairState.xVal          = snappedXVal;
        crosshairState.activeChartId = chartId;
        if (chartId === 'trendChart') {
            crosshairState.yValTrend  = yVal;
            crosshairState.yValVolume = null;
        } else {
            crosshairState.yValVolume = yVal;
            crosshairState.yValTrend  = null;
        }

        if (!changed) return;   // cursor still on same bar — skip repaint

        // Throttle redraws to one per animation frame (≈16ms @ 60fps)
        if (_crosshairRafId) cancelAnimationFrame(_crosshairRafId);
        _crosshairRafId = requestAnimationFrame(function() {
            _crosshairRafId = null;
            chart.update('none');
            if (otherChart) otherChart.update('none');
        });
    };
    
    const handleMouseLeave = () => {
        if (crosshairState.xVal === null) return;
        
        crosshairState.xVal = null;
        crosshairState.yValTrend = null;
        crosshairState.yValVolume = null;
        crosshairState.activeChartId = null;
        
        if (trendChart) trendChart.update('none');
        if (volumeChart) volumeChart.update('none');
    };
    
    trendCanvas.addEventListener('mousemove', (e) => {
        if (trendChart && volumeChart) {
            handleMouseMove(e, 'trendChart', trendChart, volumeChart);
        }
    });
    
    volumeCanvas.addEventListener('mousemove', (e) => {
        if (volumeChart && trendChart) {
            handleMouseMove(e, 'volumeChart', volumeChart, trendChart);
        }
    });
    
    trendCanvas.addEventListener('mouseleave', handleMouseLeave);
    volumeCanvas.addEventListener('mouseleave', handleMouseLeave);
}

// Get heatmap block background color based on percentage change (TradingView style)
function getHeatmapColor(val) {
    if (val === null || val === undefined || Math.abs(val) < 0.01) {
        return 'rgba(42, 52, 65, 0.4)'; // neutral translucent grey
    }
    const maxVal = 5.0; // color scales up to 5% change
    const pct = Math.min(Math.abs(val) / maxVal, 1.0);
    const opacity = 0.15 + pct * 0.70; // opacity between 0.15 and 0.85
    
    if (val > 0) {
        return `rgba(38, 166, 154, ${opacity})`; // #26A69A green
    } else {
        return `rgba(239, 83, 80, ${opacity})`; // #EF5350 red
    }
}

// Controller function to update overview section (Locks timeframe for both)
function updateOverviewSection() {
    updateIHSGTrendChart();
    updateStockHeatmap();
}

// Simple IHSG line chart vs MA50
function updateIHSGTrendChart() {
    const rawIHSG = pricesData["IHSG"];
    if (!rawIHSG) return;
    
    const resampled = resampleDataset(rawIHSG, heatmapTimeframe);
    
    const N = resampled.length;
    const defaultZoom = getDefaultZoom(N, heatmapTimeframe);
    const minIndex = Math.max(0, N - defaultZoom);
    const sliced = resampled.slice(minIndex);
    
    const dates = sliced.map(item => new Date(item.date).getTime());
    const closeData = sliced.map(item => item.close);
    const ma50Data = sliced.map(item => item.ma50 != null ? item.ma50 : null);
    
    const ctx = document.getElementById('ihsgTrendChart').getContext('2d');
    
    if (ihsgTrendChart) {
        ihsgTrendChart.destroy();
        ihsgTrendChart = null;
    }
    
    ihsgTrendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [
                {
                    label: 'IHSG',
                    data: closeData,
                    borderColor: '#FFFFFF',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    tension: 0.1
                },
                {
                    label: 'MA50',
                    data: ma50Data,
                    borderColor: '#3B82F6',
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false,
                    borderDash: [6, 4],
                    tension: 0.1,
                    spanGaps: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 10 }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(20, 26, 33, 0.95)',
                    borderColor: 'rgba(255, 255, 255, 0.08)',
                    borderWidth: 1,
                    padding: 12,
                    titleColor: '#FFFFFF',
                    bodyColor: '#E5E7EB',
                    titleFont: { family: 'Inter', size: 11, weight: '600' },
                    bodyFont: { family: 'Inter', size: 10 },
                    titleSpacing: 6,
                    bodySpacing: 5,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    type: 'timeseries',
                    time: { unit: getTimeUnit(), tooltipFormat: 'dd MMM yyyy' },
                    adapters: { date: { locale: 'id' } },
                    grid: { color: 'rgba(255, 255, 255, 0.02)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 10, weight: '500' },
                        maxTicksLimit: 4,
                        align: 'inner',
                        padding: 6
                    }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.02)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 10, weight: '500' },
                        padding: 6,
                        callback: function(value) { return value.toLocaleString('id-ID'); }
                    }
                }
            }
        }
    });

    setupXAxisDrag(ihsgTrendChart);
}

// Render stock heatmap grid — columns sorted ascending by |returnPct| (smallest left -> largest right)
function updateStockHeatmap() {
    const container = document.getElementById('stock-heatmap');
    if (!container) return;
    container.innerHTML = '';

    const tickers = ["BBCA", "BBRI", "BMRI", "TLKM", "BREN", "AMMN"];

    // Step 1: Collect return percentages
    const returns = {};
    tickers.forEach(function(ticker) {
        const rawData = pricesData[ticker];
        if (!rawData) { returns[ticker] = 0; return; }
        const activeData = rawData.filter(function(item) { return item.active !== false; });
        const resampled  = resampleDataset(activeData, heatmapTimeframe);
        let returnPct = 0;
        if (resampled.length > 0) {
            const latestItem = resampled[resampled.length - 1];
            const prevItem   = resampled[resampled.length - 2] || latestItem;
            if (prevItem.close !== 0) {
                returnPct = ((latestItem.close - prevItem.close) / prevItem.close) * 100;
            }
        }
        returns[ticker] = returnPct;
    });

    // Step 2: Define the 4 column groups
    // 'solo' = one stock spanning both rows; 'pair' = two stocks stacked
    const MIN_WEIGHT = 0.12;
    const groups = [
        { id: 'BBCA',      type: 'solo', stocks: ['BBCA'],        weight: Math.max(MIN_WEIGHT, Math.abs(returns['BBCA'])) },
        { id: 'BBRI_BMRI', type: 'pair', stocks: ['BBRI', 'BMRI'], weight: Math.max(MIN_WEIGHT, Math.max(Math.abs(returns['BBRI']), Math.abs(returns['BMRI']))) },
        { id: 'TLKM',      type: 'solo', stocks: ['TLKM'],        weight: Math.max(MIN_WEIGHT, Math.abs(returns['TLKM'])) },
        { id: 'BREN_AMMN', type: 'pair', stocks: ['BREN', 'AMMN'], weight: Math.max(MIN_WEIGHT, Math.max(Math.abs(returns['BREN']), Math.abs(returns['AMMN']))) }
    ];

    // Step 3: Sort ascending by weight (smallest left, largest right)
    groups.sort(function(a, b) { return a.weight - b.weight; });

    // Step 4: Build grid-template-columns proportional to each column weight
    const totalWeight = groups.reduce(function(sum, g) { return sum + g.weight; }, 0);
    const colFr = groups.map(function(g) { return ((g.weight / totalWeight) * 100).toFixed(2) + 'fr'; }).join(' ');
    container.style.gridTemplateColumns = colFr;

    // Step 5: Build grid-template-rows — clamp pair row split to [25%, 75%]
    // Prevents a small-move stock (AMMN +0.3%) from becoming an invisible sliver
    // next to a large-move partner (BREN +27%).
    const MIN_ROW_PCT = 25;
    const MAX_ROW_PCT = 75;
    let topFrSum = 0, botFrSum = 0, pairCount = 0;
    groups.forEach(function(g) {
        if (g.type === 'pair') {
            const wTop = Math.max(MIN_WEIGHT, Math.abs(returns[g.stocks[0]]));
            const wBot = Math.max(MIN_WEIGHT, Math.abs(returns[g.stocks[1]]));
            const rawTop     = (wTop / (wTop + wBot)) * 100;
            const clampedTop = Math.min(MAX_ROW_PCT, Math.max(MIN_ROW_PCT, rawTop));
            topFrSum += clampedTop;
            botFrSum += (100 - clampedTop);
            pairCount++;
        }
    });
    const avgTopFr = pairCount > 0 ? topFrSum / pairCount : 50;
    const avgBotFr = pairCount > 0 ? botFrSum / pairCount : 50;
    container.style.gridTemplateRows = avgTopFr.toFixed(2) + 'fr ' + avgBotFr.toFixed(2) + 'fr';

    // Step 6: Assign grid areas from sorted column positions
    const gridAreas = {};
    groups.forEach(function(g, colIdx) {
        const col = colIdx + 1;
        if (g.type === 'solo') {
            gridAreas[g.stocks[0]] = '1 / ' + col + ' / 3 / ' + (col + 1);
        } else {
            gridAreas[g.stocks[0]] = '1 / ' + col + ' / 2 / ' + (col + 1);
            gridAreas[g.stocks[1]] = '2 / ' + col + ' / 3 / ' + (col + 1);
        }
    });

    // Step 7: Render blocks
    tickers.forEach(function(ticker, index) {
        const returnPct = returns[ticker];
        const color     = getHeatmapColor(returnPct);
        const sign      = returnPct >= 0 ? '+' : '';
        const pctText   = sign + returnPct.toFixed(2) + '%';
        const absVal    = Math.abs(returnPct);
        const fontScale = Math.min(1.4, 0.9 + (absVal / 5) * 0.5);
        const pctScale  = Math.min(1.25, 0.8 + (absVal / 5) * 0.45);

        const block = document.createElement('div');
        block.className = 'heatmap-block heatmap-block-anim';
        block.style.gridArea = gridAreas[ticker];
        block.style.backgroundColor = color;
        
        // Stagger the CSS pop-in animation delay
        block.style.animationDelay = (index * 60) + 'ms';

        const tickerDiv = document.createElement('div');
        tickerDiv.className = 'heatmap-ticker';
        tickerDiv.style.fontSize = fontScale.toFixed(2) + 'rem';
        tickerDiv.textContent = ticker;

        const pctDiv = document.createElement('div');
        pctDiv.className = 'heatmap-pct';
        pctDiv.style.fontSize = pctScale.toFixed(2) + 'rem';
        pctDiv.textContent = '0,00%'; // Initial text before count-up starts

        block.appendChild(tickerDiv);
        block.appendChild(pctDiv);
        block.title = ticker + ': ' + pctText;

        block.addEventListener('click', function() {
            const stockSelect = document.getElementById('stock-select');
            if (stockSelect) {
                stockSelect.value = ticker;
                updateSelectedStockView(ticker);
                const analyticsSection = document.querySelector('.analytics-section');
                if (analyticsSection) {
                    analyticsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }
        });

        container.appendChild(block);
        
        // Start count-up animation stagger aligned with CSS pop-in delay
        setTimeout(function() {
            animateValue(pctDiv, 0, returnPct, 1500, 2, '', '%');
        }, index * 60);
    });
}

// Global timeline scaling drag handlers for premium user interaction (TradingView Style)
window.addEventListener('mousemove', (e) => {
    if (!activeScalingChart) return;
    
    const chart = activeScalingChart;
    const dx = e.clientX - chart._scaleStartX;
    const width = chart.width || 300;
    
    // Drag left = zoom out (show more history), drag right = zoom in (show less history)
    const factor = Math.exp(-dx / width * 1.5);
    let newRange = chart._scaleStartRange * factor;

    const datasets = chart.data.datasets;
    if (datasets && datasets[0] && datasets[0].data && datasets[0].data.length > 0) {
        const data = datasets[0].data;
        const totalN = data.length;
        const isTimeScale = chart.options.scales.x.type === 'timeseries' || chart.options.scales.x.type === 'time';
        
        if (isTimeScale) {
            const latestTime = (data[data.length - 1] && data[data.length - 1].x) || (chart.data.labels && chart.data.labels[chart.data.labels.length - 1]);
            const firstTime = (data[0] && data[0].x) || (chart.data.labels && chart.data.labels[0]);
            if (latestTime && firstTime) {
                const totalDuration = latestTime - firstTime;
                const avgPointDuration = totalDuration / totalN;
                
                const minRange = avgPointDuration * 5; // minimum 5 bars
                const maxRange = totalDuration;
                newRange = Math.max(minRange, Math.min(maxRange, newRange));
                
                chart.options.scales.x.max = latestTime;
                chart.options.scales.x.min = latestTime - newRange;
            }
        } else {
            const minRange = 5;
            const maxRange = totalN - 1;
            newRange = Math.max(minRange, Math.min(maxRange, newRange));
            
            const latestIdx = totalN - 1;
            chart.options.scales.x.max = latestIdx;
            chart.options.scales.x.min = Math.max(0, latestIdx - Math.round(newRange));
        }
        
        autoScaleY(chart);
        chart.update('none');

        // Synchronize scale shifts across linked detail charts (Trend & MACD/Volume)
        if (chart === trendChart && volumeChart) {
            syncXAxis(trendChart, volumeChart);
            autoScaleY(volumeChart);
            volumeChart.update('none');
            updateInsightsFromChart();
        } else if (chart === volumeChart && trendChart) {
            syncXAxis(volumeChart, trendChart);
            autoScaleY(trendChart);
            trendChart.update('none');
            updateInsightsFromChart();
        }
    }
});

window.addEventListener('mouseup', () => {
    if (activeScalingChart) {
        const chart = activeScalingChart;
        activeScalingChart = null;
        if (chart.options.plugins.zoom && chart._panWasEnabled !== undefined) {
            chart.options.plugins.zoom.pan.enabled = chart._panWasEnabled;
        }
    }
});

// Attach mouse listeners to chart's X-axis area to capture scaling drags
function setupXAxisDrag(chart) {
    if (!chart || !chart.canvas) return;
    const canvas = chart.canvas;

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Detect if click occurred inside bottom timeline labels/ticks region
        if (chart.chartArea && y > chart.chartArea.bottom && x >= chart.chartArea.left && x <= chart.chartArea.right) {
            activeScalingChart = chart;
            chart._scaleStartX = e.clientX;
            
            const xScale = chart.scales.x;
            chart._scaleStartRange = xScale.max - xScale.min;
            
            // Temporarily disable the panning plugin to prevent default drag-pan behavior
            if (chart.options.plugins.zoom) {
                chart._panWasEnabled = chart.options.plugins.zoom.pan.enabled;
                chart.options.plugins.zoom.pan.enabled = false;
            }
            e.preventDefault();
        }
    });
}
