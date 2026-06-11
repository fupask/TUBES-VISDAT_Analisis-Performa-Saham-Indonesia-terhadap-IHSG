// Global State variables
let pricesData = null;
let metaData = null;

let relativeChart = null;
let trendChart = null;
let volumeChart = null;

// Timeframe state
let currentTimeframe = 'daily';

// Sync lock to prevent recursive updates between linked charts
let isSyncing = false;

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
            fetch('data/prices.json'),
            fetch('data/meta.json')
        ]);
        
        if (!pricesRes.ok || !metaRes.ok) {
            throw new Error('Failed to fetch data files');
        }
        
        pricesData = await pricesRes.json();
        metaData = await metaRes.json();
        
        // Setup metadata & KPI counters
        setupMetadata();
        setupKPIs();
        
        // Render Chart 1 (Relative Performance)
        renderRelativeChart();
        
        // Init Selected Stock detail charts and insights
        const stockSelect = document.getElementById('stock-select');
        
        // Setup global timeframe button selector
        const tfSelector = document.getElementById('timeframe-selector');
        tfSelector.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                tfSelector.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                currentTimeframe = e.target.dataset.tf;
                
                updateAllViews();
            });
        });
        
        // Setup initial view
        updateAllViews();
        
        // Add dropdown change listener
        stockSelect.addEventListener('change', (e) => {
            updateSelectedStockView(e.target.value);
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

// Helper for count up animation using requestAnimationFrame
function animateValue(elementId, start, end, duration, decimalPlaces = 0, prefix = "", suffix = "") {
    const obj = document.getElementById(elementId);
    if (!obj) return;
    
    let startTimestamp = null;
    const isNegative = end < 0;
    const absoluteEnd = Math.abs(end);
    const absoluteStart = Math.abs(start);
    
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const currentVal = progress * (absoluteEnd - absoluteStart) + absoluteStart;
        
        // Apply decimal places and format
        const formattedVal = currentVal.toFixed(decimalPlaces);
        const displayVal = parseFloat(formattedVal).toLocaleString('id-ID', {
            minimumFractionDigits: decimalPlaces,
            maximumFractionDigits: decimalPlaces
        });
        
        // Re-apply negative sign if needed
        const sign = isNegative ? "-" : (suffix === "%" && end > 0 ? "+" : "");
        obj.textContent = prefix + sign + displayVal + suffix;
        
        if (progress < 1) {
            window.requestAnimationFrame(step);
        }
    };
    
    window.requestAnimationFrame(step);
}

// Setup KPIs with animations
function setupKPIs() {
    // KPI 1: IHSG Current Close (Format: IDR format with 2 decimals)
    animateValue('kpi-ihsg-val', 0, metaData.ihsg_current, 1000, 2);
    
    // KPI 2: Status Pasar
    const statusVal = document.getElementById('kpi-status-val');
    const statusDesc = document.getElementById('kpi-status-desc');
    statusVal.textContent = metaData.status_pasar;
    
    if (metaData.status_pasar === 'Bullish') {
        statusVal.className = 'kpi-value text-success';
        statusDesc.textContent = 'IHSG di atas MA50';
    } else {
        statusVal.className = 'kpi-value text-danger';
        statusDesc.textContent = 'IHSG di bawah MA50';
    }
    
    // KPI 3: Top Outperformer
    const topOut = metaData.top_outperformer;
    const topOutVal = document.getElementById('kpi-outperformer-val');
    topOutVal.innerHTML = `${topOut.ticker} <span id="top-out-pct"></span>`;
    animateValue('top-out-pct', 0, topOut.return, 1000, 1, "(", "%)");
    
    // KPI 4: Top Underperformer
    const topUnder = metaData.top_underperformer;
    const topUnderVal = document.getElementById('kpi-underperformer-val');
    topUnderVal.innerHTML = `${topUnder.ticker} <span id="top-under-pct"></span>`;
    animateValue('top-under-pct', 0, topUnder.return, 1000, 1, "(", "%)");
}

// Helper to trigger update for all views
function updateAllViews() {
    updateRelativeChart();
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
        // Take the last trading record of the group to represent the period close
        const lastItem = group[group.length - 1];
        resampled.push({ ...lastItem });
    });
    
    // Recalculate rebased percentage prices relative to the first day of resampled timeframe
    if (resampled.length > 0) {
        const firstClose = resampled[0].close;
        resampled.forEach(item => {
            item.rebased = firstClose !== 0 ? (item.close / firstClose) * 100 : 100;
        });
    }
    
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
function autoScaleY(chart) {
    if (!chart || !chart.scales || !chart.scales.x || !chart.scales.y) return;
    
    const xScale = chart.scales.x;
    const minIndex = Math.max(0, Math.floor(xScale.min));
    const maxIndex = Math.min(chart.data.labels.length - 1, Math.ceil(xScale.max));
    
    let minVal = Infinity;
    let maxVal = -Infinity;
    
    chart.data.datasets.forEach((dataset, index) => {
        // Only scale based on visible datasets
        if (chart.isDatasetVisible(index)) {
            for (let i = minIndex; i <= maxIndex; i++) {
                const val = dataset.data[i];
                if (val !== null && val !== undefined && !isNaN(val)) {
                    if (val < minVal) minVal = val;
                    if (val > maxVal) maxVal = val;
                }
            }
        }
    });
    
    if (minVal !== Infinity && maxVal !== -Infinity) {
        if (chart.canvas.id === 'volumeChart') {
            chart.options.scales.y.min = 0;
            chart.options.scales.y.max = maxVal * 1.1; // 10% buffer
        } else {
            const range = maxVal - minVal;
            const buffer = range * 0.05 || 1.0; // 5% buffer on top/bottom
            chart.options.scales.y.min = minVal - buffer;
            chart.options.scales.y.max = maxVal + buffer;
        }
    }
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
function getDefaultZoom(N) {
    if (currentTimeframe === 'daily') return Math.min(N, 22);
    if (currentTimeframe === 'weekly') return Math.min(N, 12);
    if (currentTimeframe === 'monthly') return Math.min(N, 36);
    if (currentTimeframe === 'yearly') return Math.min(N, 10);
    return N;
}

// Extract the visible data range from resampled stock data
function getVisibleStockData(chart, resampledData) {
    if (!chart || !chart.scales || !chart.scales.x) {
        const N = resampledData.length;
        const defaultZoom = getDefaultZoom(N);
        const minIndex = Math.max(0, N - defaultZoom);
        return resampledData.slice(minIndex, N);
    }
    const minIndex = Math.max(0, Math.floor(chart.scales.x.min));
    const maxIndex = Math.min(resampledData.length - 1, Math.ceil(chart.scales.x.max));
    return resampledData.slice(minIndex, maxIndex + 1);
}

// Update insights box dynamically based on the current chart view range
function updateInsightsFromChart() {
    const ticker = document.getElementById('stock-select').value;
    const stockData = pricesData[ticker];
    if (!stockData) return;
    const resampled = resampleDataset(stockData, currentTimeframe);
    const visibleData = getVisibleStockData(trendChart, resampled);
    generateInsights(ticker, visibleData);
}

// Handle double click reset interaction
function handleChartReset(chart) {
    if (!chart) return;
    const N = chart.data.labels.length;
    const defaultZoom = getDefaultZoom(N);
    
    chart.options.scales.x.min = Math.max(0, N - defaultZoom);
    chart.options.scales.x.max = N - 1;
    
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
                    backgroundColor: '#141A21',
                    borderColor: '#2A3441',
                    borderWidth: 1,
                    titleColor: '#FFFFFF',
                    bodyColor: '#9CA3AF',
                    titleFont: { family: 'Inter', weight: 'bold' },
                    bodyFont: { family: 'Inter' },
                    padding: 12,
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) label += context.parsed.y.toFixed(2) + '%';
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 10 }, maxTicksLimit: 12 }
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                    ticks: {
                        color: '#9CA3AF',
                        font: { family: 'Inter', size: 10 },
                        callback: function(value) { return value.toFixed(0) + '%'; }
                    }
                }
            }
        }
    });
}

// Update Chart 1 dynamically based on resampled and sliced datasets
function updateRelativeChart() {
    if (!relativeChart || !pricesData) return;
    
    const rawIHSG = pricesData["IHSG"];
    const resampledIHSG = resampleDataset(rawIHSG, currentTimeframe);
    const labels = resampledIHSG.map(item => item.date);
    
    const datasets = Object.keys(pricesData).map(ticker => {
        const resampled = resampleDataset(pricesData[ticker], currentTimeframe);
        const rebasedData = resampled.map(item => item.rebased);
        return {
            label: ticker === 'IHSG' ? 'IHSG (Benchmark)' : ticker,
            data: rebasedData,
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
    relativeChart.data.datasets = datasets;
    
    const N = labels.length;
    const defaultZoom = getDefaultZoom(N);
    
    const minIndex = Math.max(0, N - defaultZoom);
    const maxIndex = N - 1;
    
    relativeChart.options.scales.x.min = minIndex;
    relativeChart.options.scales.x.max = maxIndex;
    
    autoScaleY(relativeChart);
    relativeChart.update('none');
}

// Update Detail View (Chart 2, Chart 3, and Insights)
function updateSelectedStockView(ticker) {
    document.querySelectorAll('.selected-stock-ticker').forEach(el => {
        el.textContent = ticker;
    });
    document.querySelectorAll('.selected-stock-ticker-full').forEach(el => {
        el.textContent = ` - ${TICKER_NAMES[ticker]}`;
    });
    
    const stockData = pricesData[ticker];
    if (!stockData) return;
    
    const resampled = resampleDataset(stockData, currentTimeframe);
    const labels = resampled.map(item => item.date);
    const closePrices = resampled.map(item => item.close);
    const ma20 = resampled.map(item => item.ma20);
    const ma50 = resampled.map(item => item.ma50);
    const volume = resampled.map(item => item.volume);
    const warnaVolume = resampled.map(item => item.warna_volume);
    
    updateTrendChart(labels, closePrices, ma20, ma50, ticker);
    updateVolumeChart(labels, volume, warnaVolume);
    
    const N = labels.length;
    const defaultZoom = getDefaultZoom(N);
    
    const minIndex = Math.max(0, N - defaultZoom);
    const maxIndex = N - 1;
    
    if (trendChart) {
        trendChart.options.scales.x.min = minIndex;
        trendChart.options.scales.x.max = maxIndex;
        autoScaleY(trendChart);
        trendChart.update('none');
    }
    if (volumeChart) {
        volumeChart.options.scales.x.min = minIndex;
        volumeChart.options.scales.x.max = maxIndex;
        autoScaleY(volumeChart);
        volumeChart.update('none');
    }
    
    const visibleData = getVisibleStockData(trendChart, resampled);
    generateInsights(ticker, visibleData);
}

// Chart 2: Trend Chart
function updateTrendChart(labels, closePrices, ma20, ma50, ticker) {
    const ctx = document.getElementById('trendChart').getContext('2d');
    const colorTheme = ASSET_COLORS[ticker] || '#0066FF';
    
    const datasets = [
        {
            label: 'Harga Penutupan',
            data: closePrices,
            borderColor: colorTheme,
            borderWidth: 2.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            fill: false,
            tension: 0.1
        },
        {
            label: 'MA20',
            data: ma20,
            borderColor: '#F59E0B',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            borderDash: [2, 2],
            tension: 0.1
        },
        {
            label: 'MA50',
            data: ma50,
            borderColor: '#A855F7',
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false,
            tension: 0.1
        }
    ];
    
    if (trendChart) {
        trendChart.data.labels = labels;
        trendChart.data.datasets = datasets;
        trendChart.update('none');
    } else {
        trendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
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
                                syncXAxis(chart, volumeChart);
                                autoScaleY(chart);
                                chart.update('none');
                                updateInsightsFromChart();
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
                                syncXAxis(chart, volumeChart);
                                autoScaleY(chart);
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
                        backgroundColor: '#141A21',
                        borderColor: '#2A3441',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': Rp ';
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
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                        ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 10 }, maxTicksLimit: 8 }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                        ticks: {
                            color: '#9CA3AF',
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) { return 'Rp ' + value.toLocaleString('id-ID'); }
                        },
                        afterFit: function(scaleInstance) {
                            scaleInstance.width = 90;
                        }
                    }
                }
            }
        });
    }
}

// Chart 3: Volume Chart
function updateVolumeChart(labels, volume, warnaVolume) {
    const ctx = document.getElementById('volumeChart').getContext('2d');
    
    const datasets = [
        {
            label: 'Volume Perdagangan',
            data: volume,
            backgroundColor: warnaVolume,
            borderColor: warnaVolume,
            borderWidth: 1,
            barPercentage: 0.85,
            categoryPercentage: 0.95
        }
    ];
    
    if (volumeChart) {
        volumeChart.data.labels = labels;
        volumeChart.data.datasets = datasets;
        volumeChart.update('none');
    } else {
        volumeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: datasets
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
                                syncXAxis(chart, trendChart);
                                autoScaleY(trendChart);
                                chart.update('none');
                                updateInsightsFromChart();
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
                                syncXAxis(chart, trendChart);
                                autoScaleY(trendChart);
                                chart.update('none');
                                updateInsightsFromChart();
                            }
                        }
                    },
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: '#141A21',
                        borderColor: '#2A3441',
                        borderWidth: 1,
                        padding: 12,
                        callbacks: {
                            label: function(context) {
                                let label = context.dataset.label || '';
                                if (label) label += ': ';
                                if (context.parsed.y !== null) {
                                    label += context.parsed.y.toLocaleString('id-ID') + ' lembar';
                                }
                                return label;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                        ticks: { color: '#9CA3AF', font: { family: 'Inter', size: 10 }, maxTicksLimit: 8 }
                    },
                    y: {
                        min: 0,
                        grid: { color: 'rgba(255, 255, 255, 0.05)', drawTicks: false },
                        ticks: {
                            color: '#9CA3AF',
                            font: { family: 'Inter', size: 10 },
                            callback: function(value) {
                                if (value >= 1e9) return (value / 1e9).toFixed(1) + ' B';
                                if (value >= 1e6) return (value / 1e6).toFixed(1) + ' M';
                                if (value >= 1e3) return (value / 1e3).toFixed(1) + ' K';
                                return value;
                            }
                        },
                        afterFit: function(scaleInstance) {
                            scaleInstance.width = 90;
                        }
                    }
                }
            }
        });
    }
}

// Generate Insights Automatically
function generateInsights(ticker, stockData) {
    if (stockData.length === 0) return;
    
    const latest = stockData[stockData.length - 1];
    const prev = stockData[stockData.length - 2] || latest;
    const first = stockData[0];
    
    const close = latest.close;
    const ma20 = latest.ma20;
    const ma50 = latest.ma50;
    const latestVolume = latest.volume;
    
    // Calculate returns
    const stockReturn = ((close - first.close) / first.close * 100).toFixed(1);
    
    // Calculate IHSG return in same period
    const rawIHSG = pricesData["IHSG"];
    const resampledIHSG = resampleDataset(rawIHSG, currentTimeframe);
    // Find matching date in IHSG
    const matchingFirstIHSG = resampledIHSG.find(item => item.date === first.date) || resampledIHSG[0];
    const matchingLatestIHSG = resampledIHSG.find(item => item.date === latest.date) || resampledIHSG[resampledIHSG.length - 1];
    const ihsgReturn = ((matchingLatestIHSG.close - matchingFirstIHSG.close) / matchingFirstIHSG.close * 100).toFixed(1);
    
    // 1. Determine Trend Badge & Text
    let trendBadge = "Neutral";
    let trendBadgeClass = "badge-neutral";
    let trendInsightText = "";
    
    if (close > ma50) {
        trendBadge = "Bullish";
        trendBadgeClass = "badge-bullish";
        trendInsightText = `<span class="text-success">bullish</span>. Harga penutupan terbaru (Rp ${close.toLocaleString('id-ID')}) berada di atas MA50 (Rp ${ma50.toLocaleString('id-ID')}), yang menunjukkan pergerakan tren jangka menengah yang kuat.`;
    } else {
        trendBadge = "Bearish";
        trendBadgeClass = "badge-bearish";
        trendInsightText = `<span class="text-danger">bearish</span>. Harga penutupan terbaru (Rp ${close.toLocaleString('id-ID')}) berada di bawah MA50 (Rp ${ma50.toLocaleString('id-ID')}), yang mengindikasikan tekanan jual jangka menengah.`;
    }
    
    // Add short-term MA20 reference
    let shortTermTrend = "";
    if (close > ma20) {
        shortTermTrend = `Di jangka pendek, harga juga diperdagangkan di atas MA20 (Rp ${ma20.toLocaleString('id-ID')}), mengonfirmasi kekuatan momentum beli saat ini.`;
    } else {
        shortTermTrend = `Di jangka pendek, harga tertekan di bawah MA20 (Rp ${ma20.toLocaleString('id-ID')}), menunjukkan adanya pelemahan tren jangka pendek.`;
    }
    
    // Update Trend Badge
    const trBadgeEl = document.getElementById('stock-trend-badge');
    if (trBadgeEl) {
        trBadgeEl.textContent = trendBadge;
        trBadgeEl.className = `badge ${trendBadgeClass}`;
    }
    
    // 2. Determine Volume Badge & Text
    const nPeriods = Math.min(stockData.length, 20);
    let totalVolume = 0;
    for (let i = stockData.length - nPeriods; i < stockData.length; i++) {
        totalVolume += stockData[i].volume;
    }
    const avgVolume20 = totalVolume / nPeriods;
    
    let volumeBadge = "Volume Normal";
    let volumeBadgeClass = "badge-neutral";
    let volumeInsightText = "";
    
    // Calculate percentage difference of latest volume vs 20-period average volume
    const pctDiff = avgVolume20 !== 0 ? ((latestVolume - avgVolume20) / avgVolume20 * 100) : 0;
    
    if (pctDiff > 20) {
        volumeBadge = "Volume Tinggi";
        volumeBadgeClass = "badge-bullish";
        volumeInsightText = `Volume perdagangan terbaru sebesar <strong>${latestVolume.toLocaleString('id-ID')} lembar</strong> meningkat signifikan (<strong>+${pctDiff.toFixed(1)}%</strong>) dibanding rata-rata 20 periode terakhir (<strong>${Math.round(avgVolume20).toLocaleString('id-ID')} lembar</strong>), menunjukkan peningkatan aktivitas pasar.`;
    } else if (pctDiff < -20) {
        volumeBadge = "Volume Rendah";
        volumeBadgeClass = "badge-bearish";
        volumeInsightText = `Volume perdagangan terbaru sebesar <strong>${latestVolume.toLocaleString('id-ID')} lembar</strong> menurun signifikan (<strong>${pctDiff.toFixed(1)}%</strong>) dibanding rata-rata 20 periode terakhir (<strong>${Math.round(avgVolume20).toLocaleString('id-ID')} lembar</strong>), menunjukkan penurunan aktivitas pasar (transaksi cenderung sepi).`;
    } else {
        volumeBadge = "Volume Normal";
        volumeBadgeClass = "badge-neutral";
        volumeInsightText = `Volume perdagangan terbaru sebesar <strong>${latestVolume.toLocaleString('id-ID')} lembar</strong> bergerak stabil (<strong>${pctDiff >= 0 ? '+' : ''}${pctDiff.toFixed(1)}%</strong>) dekat rata-rata 20 periode terakhir (<strong>${Math.round(avgVolume20).toLocaleString('id-ID')} lembar</strong>), mencerminkan aktivitas pasar yang wajar.`;
    }
    
    const momBadgeEl = document.getElementById('stock-volume-badge');
    if (momBadgeEl) {
        momBadgeEl.textContent = volumeBadge;
        momBadgeEl.className = `badge ${volumeBadgeClass}`;
    }
    
    // 3. Performance vs IHSG Text
    let relativePerformanceText = "";
    const isOutperformer = parseFloat(stockReturn) > parseFloat(ihsgReturn);
    
    if (isOutperformer) {
        relativePerformanceText = `Saham <strong>${ticker}</strong> berhasil <span class="text-success">mengungguli</span> indeks IHSG (Outperformer) selama rentang waktu visualisasi ini, dengan total imbal hasil sebesar <strong>${stockReturn}%</strong> dibandingkan IHSG yang sebesar <strong>${ihsgReturn}%</strong>.`;
    } else {
        relativePerformanceText = `Saham <strong>${ticker}</strong> bergerak <span class="text-danger">tertinggal</span> dibandingkan indeks IHSG (Underperformer) selama rentang waktu visualisasi ini, dengan imbal hasil total sebesar <strong>${stockReturn}%</strong> dibandingkan IHSG yang sebesar <strong>${ihsgReturn}%</strong>.`;
    }
    
    // 4. Determine Confirmation Text
    let confirmationText = "";
    const isPriceUp = latest.close > prev.close;
    const isPriceDown = latest.close < prev.close;
    
    if (isPriceUp && pctDiff > 20) {
        confirmationText = `Kenaikan harga yang didukung oleh volume transaksi tinggi mengindikasikan akumulasi beli yang solid dari pelaku pasar, memberikan konfirmasi bahwa tren kenaikan harga ini memiliki fondasi yang kuat.`;
    } else if (isPriceUp && pctDiff < -20) {
        confirmationText = `Kenaikan harga terjadi di tengah volume transaksi yang rendah, mengindikasikan lemahnya minat beli dari pasar. Kenaikan harga ini rentan mengalami koreksi karena kurang didukung aktivitas transaksi yang kuat.`;
    } else if (isPriceDown && pctDiff > 20) {
        confirmationText = `Penurunan harga yang disertai lonjakan volume transaksi mengindikasikan tekanan jual yang tinggi (distribusi aktif), memberikan konfirmasi bahwa tren penurunan harga saat ini cukup kuat.`;
    } else if (isPriceDown && pctDiff < -20) {
        confirmationText = `Penurunan harga terjadi dengan volume transaksi yang rendah, menunjukkan tekanan jual yang relatif terbatas dan mengindikasikan potensi konsolidasi atau koreksi teknikal sementara.`;
    } else {
        confirmationText = `Pergerakan harga terkini didukung oleh volume transaksi yang normal, menunjukkan keseimbangan aktivitas antara pembeli dan penjual tanpa adanya dominasi transaksi yang mencolok.`;
    }
    
    // Assemble final bullet points
    let htmlContent = `
        <p>Berdasarkan analisis data penutupan historis dan aktivitas transaksi untuk saham <strong>${TICKER_NAMES[ticker]} (${ticker})</strong> dalam rentang waktu yang ditampilkan, berikut rangkuman analisis tren dan volumenya:</p>
        <ul>
            <li><strong>Performa:</strong> ${relativePerformanceText}</li>
            <li><strong>Tren:</strong> Saham ${ticker} saat ini menunjukkan tren ${trendInsightText} ${shortTermTrend}</li>
            <li><strong>Volume:</strong> ${volumeInsightText}</li>
            <li><strong>Konfirmasi:</strong> ${confirmationText}</li>
        </ul>
        <p style="margin-top: 16px; font-size: 0.9rem; color: var(--text-secondary); font-style: italic;">
            *Catatan: Analisis ini diperbarui secara otomatis berdasarkan data transaksi penutupan terakhir dan tidak ditujukan sebagai rekomendasi finansial mutlak.
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
