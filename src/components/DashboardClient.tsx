'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { getAvailableTables, processDashboardData } from '@/app/actions/dashboardActions';
import { saveReport, getReportById } from '@/lib/localStorage';
import { RefreshCw, ChevronDown, X } from 'lucide-react';
import { ComposedChart, BarChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function formatCurrency(value: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDateShort(value: string | Date | null | undefined): string {
    if (value == null) return '';
    const d = typeof value === 'string' ? new Date(value) : value;
    if (isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
}

function formatCompact(value: number) {
    if (Math.abs(value) >= 1000) {
        return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
    }
    return Math.round(value).toString();
}

export default function DashboardClient({ initialTables }: { initialTables: string[] }) {
    const [tables, setTables] = useState<string[]>(initialTables);
    const [baseTable, setBaseTable] = useState('');
    const [salesTable, setSalesTable] = useState('');
    const [csvFile, setCsvFile] = useState<File | null>(null);
    const [countryCsvFile, setCountryCsvFile] = useState<File | null>(null);
    const [exchangeRate, setExchangeRate] = useState('0');
    const [multiplyRevenue, setMultiplyRevenue] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [dashboardData, setDashboardData] = useState<any>(null);

    const [activeTab, setActiveTab] = useState<'general' | 'quality' | 'factors' | 'countries' | 'captation'>('general');
    const [perspective, setPerspective] = useState<'ads' | 'segments'>('ads');
    const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
    const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
    const [sortBy, setSortBy] = useState('profit');
    const [detailSortBy, setDetailSortBy] = useState('profit');
    const [countrySortBy, setCountrySortBy] = useState<string>('gasto');
    const [countrySortDir, setCountrySortDir] = useState<'asc' | 'desc'>('desc');
    const [captationView, setCaptationView] = useState<'by_date' | 'by_days'>('by_date');
    const [modalDateRow, setModalDateRow] = useState<{ date: string; ads: any[] } | null>(null);
    const [modalViewBy, setModalViewBy] = useState<'anuncio' | 'segmentacion'>('anuncio');

    const searchParams = useSearchParams();

    useEffect(() => {
        const loadId = searchParams.get('load');
        if (!loadId) return;
        const report = getReportById(loadId);
        if (report?.data) {
            const data = report.data as any;
            setDashboardData(data);
            setActiveTab('general');
            setPerspective('ads');
            setSelectedKeys(new Set(Object.keys(data?.ads ?? {})));
            setLastSelectedKey(null);
        }
    }, [searchParams]);

    const handleProcess = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!baseTable || !salesTable || !csvFile) {
            setError('Por favor completa todos los campos requeridos.');
            return;
        }
        setError('');
        setIsLoading(true);

        try {
            const formData = new FormData();
            formData.append('base_table', baseTable);
            formData.append('sales_table', salesTable);
            formData.append('spend_report', csvFile);
            formData.append('exchange_rate', exchangeRate);
            if (multiplyRevenue) formData.append('multiply_revenue', '1');
            if (countryCsvFile) formData.append('country_report', countryCsvFile);

            const result = await processDashboardData(formData);
            setDashboardData(result);
            saveReport(result);
            setActiveTab('general');
            setPerspective('ads');
            setSelectedKeys(new Set(Object.keys(result.ads)));
            setLastSelectedKey(null);
        } catch (err: any) {
            setError(err.message || 'Error desconocido procesando los datos.');
        } finally {
            setIsLoading(false);
        }
    };

    const segmentationData = useMemo(() => {
        if (!dashboardData?.ads) return null;
        const segments: Record<string, any> = {};
        for (const [adKey, ad] of Object.entries<any>(dashboardData.ads)) {
            if (adKey === 'organica') {
                segments['organica'] = {
                    key: 'organica',
                    name: 'Orgánica',
                    total_revenue: ad.total_revenue,
                    total_leads: 0,
                    total_sales: ad.total_sales,
                    total_spend: 0,
                    roas: 0,
                    profit: ad.total_revenue,
                    ads: [{ key: 'organica', name: 'Orgánica', ...ad.segmentations[0] }]
                };
                continue;
            }
            for (const seg of ad.segmentations) {
                const segKey = seg.name.toLowerCase().trim();
                if (!segments[segKey]) {
                    segments[segKey] = {
                        key: segKey,
                        name: seg.name,
                        total_revenue: 0,
                        total_leads: 0,
                        total_sales: 0,
                        total_spend: 0,
                        ads: []
                    };
                }
                segments[segKey].total_revenue += seg.revenue;
                segments[segKey].total_leads += seg.leads;
                segments[segKey].total_sales += seg.sales;
                segments[segKey].total_spend += (seg.spend_allocated || 0);
                segments[segKey].ads.push({
                    key: adKey,
                    name: ad.ad_name_display,
                    revenue: seg.revenue,
                    leads: seg.leads,
                    sales: seg.sales,
                    spend_allocated: seg.spend_allocated,
                    profit: seg.profit,
                    conversion_rate: seg.conversion_rate,
                    cpl: seg.cpl
                });
            }
        }
        for (const seg of Object.values(segments)) {
            seg.conversion_rate = seg.total_leads > 0 ? (seg.total_sales / seg.total_leads) * 100 : 0;
            seg.roas = seg.total_spend > 0 ? seg.total_revenue / seg.total_spend : 0;
            seg.profit = seg.total_revenue - seg.total_spend;
            seg.cpl = seg.total_leads > 0 ? seg.total_spend / seg.total_leads : 0;
        }
        return segments;
    }, [dashboardData]);

    const mainListItems = useMemo(() => {
        if (!dashboardData?.ads) return [];
        if (perspective === 'ads') {
            return Object.entries(dashboardData.ads).map(([key, ad]: [string, any]) => ({
                key,
                name: ad.ad_name_display,
                total_revenue: ad.total_revenue,
                total_spend: ad.total_spend,
                profit: ad.profit,
                roas: ad.roas
            }));
        }
        if (!segmentationData) return [];
        return Object.values(segmentationData).map((seg: any) => ({
            key: seg.key,
            name: seg.name,
            total_revenue: seg.total_revenue,
            total_spend: seg.total_spend,
            profit: seg.profit,
            roas: seg.roas
        }));
    }, [dashboardData, perspective, segmentationData]);

    const sortedMainList = useMemo(() => {
        const sorted = [...mainListItems];
        const sortMap: Record<string, (a: any, b: any) => number> = {
            profit: (a, b) => b.profit - a.profit,
            revenue: (a, b) => b.total_revenue - a.total_revenue,
            spend: (a, b) => b.total_spend - a.total_spend,
            roas: (a, b) => b.roas - a.roas,
            name: (a, b) => a.name.localeCompare(b.name)
        };
        sorted.sort(sortMap[sortBy] || sortMap.profit);
        return sorted;
    }, [mainListItems, sortBy]);

    const selectedDetails = useMemo(() => {
        if (!dashboardData?.ads || selectedKeys.size === 0) return null;
        let totalLeads = 0, totalSales = 0, totalRevenue = 0, totalSpend = 0;
        const combinedDetails: any[] = [];

        if (perspective === 'ads') {
            for (const key of selectedKeys) {
                const ad = dashboardData.ads[key];
                if (!ad) continue;
                totalLeads += ad.total_leads;
                totalSales += ad.total_sales;
                totalRevenue += ad.total_revenue;
                totalSpend += ad.total_spend;
                combinedDetails.push(...ad.segmentations.map((s: any) => ({ ...s, spend_allocated: s.spend_allocated })));
            }
        } else if (segmentationData) {
            for (const key of selectedKeys) {
                const seg = segmentationData[key];
                if (!seg) continue;
                totalLeads += seg.total_leads;
                totalSales += seg.total_sales;
                totalRevenue += seg.total_revenue;
                totalSpend += seg.total_spend;
                combinedDetails.push(...seg.ads.map((a: any) => ({
                    name: a.name,
                    leads: a.leads,
                    sales: a.sales,
                    revenue: a.revenue,
                    spend_allocated: a.spend_allocated,
                    profit: a.profit,
                    conversion_rate: a.conversion_rate,
                    cpl: a.cpl
                })));
            }
        }

        const grouped = combinedDetails.reduce((acc: Record<string, any>, d) => {
            const n = (d.name || '').toLowerCase().trim();
            if (!acc[n]) acc[n] = { ...d };
            else {
                acc[n].leads += d.leads || 0;
                acc[n].sales += d.sales || 0;
                acc[n].revenue += d.revenue || 0;
                acc[n].spend_allocated = (acc[n].spend_allocated || 0) + (d.spend_allocated || 0);
                acc[n].profit = (acc[n].profit || 0) + (d.profit || 0);
            }
            return acc;
        }, {});
        const details = Object.values(grouped).map((d: any) => ({
            ...d,
            conversion_rate: d.leads > 0 ? (d.sales / d.leads) * 100 : 0
        }));

        const sortMap: Record<string, (a: any, b: any) => number> = {
            profit: (a, b) => (b.profit || 0) - (a.profit || 0),
            revenue: (a, b) => (b.revenue || 0) - (a.revenue || 0),
            leads: (a, b) => (b.leads || 0) - (a.leads || 0),
            name: (a, b) => (a.name || '').localeCompare(b.name || '')
        };
        details.sort(sortMap[detailSortBy] || sortMap.profit);

        return {
            totalLeads,
            totalSales,
            totalRevenue,
            totalSpend,
            details
        };
    }, [dashboardData, segmentationData, perspective, selectedKeys, detailSortBy]);

    const summaryForSelection = useMemo(() => {
        if (selectedKeys.size === 0 && dashboardData?.summary) {
            return {
                total_revenue: dashboardData.summary.totalRevenueAll,
                total_spend: dashboardData.summary.totalSpendAll,
                total_roas: dashboardData.summary.totalRoasAll
            };
        }
        if (!selectedDetails) return null;
        return {
            total_revenue: selectedDetails.totalRevenue,
            total_spend: selectedDetails.totalSpend,
            total_roas: selectedDetails.totalSpend > 0 ? selectedDetails.totalRevenue / selectedDetails.totalSpend : 0
        };
    }, [selectedKeys, selectedDetails, dashboardData]);

    const handleMainRowClick = (key: string, e: React.MouseEvent) => {
        const currentArray = sortedMainList;
        const itemKey = key;

        if (e.shiftKey && lastSelectedKey) {
            const lastIdx = currentArray.findIndex((i) => i.key === lastSelectedKey);
            const currIdx = currentArray.findIndex((i) => i.key === itemKey);
            const [start, end] = [Math.min(lastIdx, currIdx), Math.max(lastIdx, currIdx)];
            const newSet = new Set<string>();
            for (let i = start; i <= end; i++) newSet.add(currentArray[i].key);
            setSelectedKeys(newSet);
        } else if (e.ctrlKey || e.metaKey) {
            const newSet = new Set(selectedKeys);
            if (newSet.has(itemKey)) newSet.delete(itemKey);
            else newSet.add(itemKey);
            setSelectedKeys(newSet);
        } else {
            setSelectedKeys(new Set([itemKey]));
        }
        setLastSelectedKey(itemKey);
    };

    const qualityGroups = useMemo(() => {
        if (!dashboardData?.qualityData?.segments) return { estudios: {}, ingresos: {}, ocupacion: {}, edad_especifica: {} };
        const groups: Record<string, Record<string, { leads: number; sales: number; revenue: number; spend: number; profit: number }>> = {
            estudios: {},
            ingresos: {},
            ocupacion: {},
            edad_especifica: {}
        };
        for (const seg of dashboardData.qualityData.segments) {
            for (const [cat, key] of Object.entries({ estudios: seg.estudios, ingresos: seg.ingresos, ocupacion: seg.ocupacion, edad_especifica: seg.edad_especifica })) {
                const k = String(key || 'No Especificado');
                if (!groups[cat][k]) groups[cat][k] = { leads: 0, sales: 0, revenue: 0, spend: 0, profit: 0 };
                groups[cat][k].leads += seg.total_leads;
                groups[cat][k].sales += seg.total_sales;
                groups[cat][k].revenue += seg.total_revenue;
                groups[cat][k].spend += seg.total_spend;
                groups[cat][k].profit += seg.profit;
            }
        }
        return groups;
    }, [dashboardData?.qualityData]);

    const fieldNames: Record<string, string> = {
        qlead: 'Calidad Lead',
        ingresos: 'Nivel de Ingresos',
        estudios: 'Nivel de Estudios',
        ocupacion: 'Ocupación',
        proposito: 'Propósito',
        edad_especifica: 'Edad Específica'
    };

    if (!dashboardData) {
        return (
            <div className="min-h-screen bg-gray-100 p-6 font-sans text-gray-900">
                <div className="max-w-4xl mx-auto">
                    <header className="text-center mb-6">
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900">Dashboard Interactivo de ROAS</h1>
                        <p className="text-gray-700 mt-2">Analiza el rendimiento de tus campañas de forma visual e interactiva.</p>
                    </header>

                    <div className="bg-white rounded-xl shadow-lg p-6 text-gray-900">
                        <h2 className="text-xl font-semibold mb-4 border-b border-gray-200 pb-2 text-gray-900">Configuración del Análisis</h2>
                        <form onSubmit={handleProcess} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm font-medium text-gray-800 mb-2">1. Tabla Base (Leads)</label>
                                    <select name="base_table" required className="block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 bg-white" value={baseTable} onChange={(e) => setBaseTable(e.target.value)}>
                                        <option value="">-- Selecciona --</option>
                                        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-800 mb-2">2. Tabla de Ventas</label>
                                    <select name="sales_table" required className="block w-full px-3 py-2 border border-gray-300 rounded-md text-gray-900 bg-white" value={salesTable} onChange={(e) => setSalesTable(e.target.value)}>
                                        <option value="">-- Selecciona --</option>
                                        {tables.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-800 mb-2">3. Opciones</label>
                                <label className="flex items-center cursor-pointer">
                                    <input type="checkbox" checked={multiplyRevenue} onChange={(e) => setMultiplyRevenue(e.target.checked)} className="h-4 w-4 text-indigo-600 rounded" />
                                    <span className="ml-2 text-sm font-medium text-gray-800">Multiplicar ingresos x2 (Coproducción)</span>
                                </label>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-800 mb-2">4. Tasa de Cambio (opcional)</label>
                                <input type="number" step="0.01" placeholder="Ej: 1050" className="block w-full px-4 py-2 border border-gray-300 rounded-md text-gray-900 bg-white placeholder:text-gray-600" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-800 mb-2">5. Reporte de Gastos (CSV)</label>
                                <input type="file" accept=".csv" required className="block w-full text-sm text-gray-900 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-800 mb-2">6. Reporte por País (CSV, opcional)</label>
                                <input type="file" accept=".csv" className="block w-full text-sm text-gray-900 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" onChange={(e) => setCountryCsvFile(e.target.files?.[0] || null)} />
                                <p className="text-xs text-gray-600 mt-1">Formato: Day, Amount Spent, Campaign Name, Leads, ..., Country</p>
                            </div>
                            <div className="flex justify-center">
                                <button type="submit" disabled={isLoading} className="bg-indigo-600 text-white font-bold py-3 px-8 rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2">
                                    {isLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : null} Analizar Datos
                                </button>
                            </div>
                            {error && <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">{error}</div>}
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    const qualityData = dashboardData.qualityData;
    const factorAnalysis = qualityData?.factor_analysis;

    return (
        <div className="min-h-screen bg-gray-100 p-6 font-sans text-gray-900">
            <div className="max-w-7xl mx-auto">
                <div className="mb-6 flex justify-between items-center">
                    <div>
                        <h1 className="text-3xl font-bold text-gray-900">Dashboard Interactivo de ROAS</h1>
                        <p className="text-gray-700 mt-1">Proyecto en análisis</p>
                    </div>
                    <button onClick={() => setDashboardData(null)} className="bg-indigo-600 text-white text-sm font-medium py-2 px-4 rounded-md hover:bg-indigo-700">
                        Analizar Otro Proyecto
                    </button>
                </div>

                {/* Tabs */}
                <div className="mb-6 border-b border-gray-200">
                    <nav className="flex space-x-8 -mb-px">
                        <button
                            onClick={() => setActiveTab('general')}
                            className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'general' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
                        >
                            Análisis General
                        </button>
                        {qualityData && (
                            <button
                                onClick={() => setActiveTab('quality')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'quality' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
                            >
                            Análisis por Calidad de Leads
                            </button>
                        )}
                        {factorAnalysis && (
                            <button
                                onClick={() => setActiveTab('factors')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'factors' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
                            >
                                Análisis de Factores
                            </button>
                        )}
                        {dashboardData.countryData && (
                            <button
                                onClick={() => setActiveTab('countries')}
                                className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'countries' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
                            >
                                Vista de Países
                            </button>
                        )}
                        <button
                            onClick={() => setActiveTab('captation')}
                            className={`py-4 px-1 text-sm font-medium border-b-2 ${activeTab === 'captation' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-700 hover:text-gray-900'}`}
                        >
                            Días desde Registro
                        </button>
                    </nav>
                </div>

                {activeTab === 'general' && (
                    <div className="space-y-6">
                        <div className="bg-slate-50 border-l-4 border-slate-500 p-4 rounded-lg text-gray-900">
                            <div className="flex justify-between items-center">
                                <div>
                                    <h3 className="font-semibold text-gray-900">Perspectiva de Análisis</h3>
                                    <p className="text-sm text-gray-700">Cambia cómo analizas tus datos</p>
                                </div>
                                <label className="flex items-center gap-3 cursor-pointer">
                                    <span className="text-sm font-medium text-gray-800">Anuncio → Segmentaciones</span>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={perspective === 'segments'}
                                        onClick={() => { setPerspective(p => p === 'segments' ? 'ads' : 'segments'); setSelectedKeys(new Set()); }}
                                        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${perspective === 'segments' ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                    >
                                        <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${perspective === 'segments' ? 'translate-x-6' : 'translate-x-0.5'}`} />
                                    </button>
                                    <span className="text-sm font-medium text-gray-800">Segmentación → Anuncios</span>
                                </label>
                            </div>
                        </div>

                        {summaryForSelection && (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div className="bg-white p-4 rounded-lg shadow text-center text-gray-900">
                                    <h4 className="text-sm font-medium text-gray-700 uppercase">Ingresos {selectedKeys.size > 0 ? 'Seleccionados' : 'Totales'}</h4>
                                    <p className="text-2xl font-bold text-green-600">{formatCurrency(summaryForSelection.total_revenue)}</p>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow text-center text-gray-900">
                                    <h4 className="text-sm font-medium text-gray-700 uppercase">Gasto {selectedKeys.size > 0 ? 'Seleccionado' : 'Total'}</h4>
                                    <p className="text-2xl font-bold text-red-600">{formatCurrency(summaryForSelection.total_spend)}</p>
                                </div>
                                <div className="bg-white p-4 rounded-lg shadow text-center text-gray-900">
                                    <h4 className="text-sm font-medium text-gray-700 uppercase">ROAS</h4>
                                    <p className="text-2xl font-bold text-indigo-600">{summaryForSelection.total_roas.toFixed(2)}x</p>
                                </div>
                            </div>
                        )}

                        <div className="flex flex-col lg:flex-row gap-6">
                            <aside className="lg:w-1/3 bg-white rounded-lg shadow p-4 text-gray-900">
                                <div className="flex justify-between items-center mb-3">
                                    <h2 className="font-bold text-gray-900">{perspective === 'ads' ? 'Análisis por Anuncio' : 'Análisis por Segmentación'}</h2>
                                    <div className="flex gap-2">
                                        <button type="button" onClick={() => setSelectedKeys(new Set(sortedMainList.map((i) => i.key)))} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-2 rounded font-medium">Todos</button>
                                        <button type="button" onClick={() => setSelectedKeys(new Set())} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 py-1 px-2 rounded font-medium">Ninguno</button>
                                    </div>
                                </div>
                                <div className="mb-2">
                                    <label className="block text-xs font-medium text-gray-800 mb-1">Ordenar por:</label>
                                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="block w-full text-xs border border-gray-300 rounded px-2 py-1 text-gray-900 bg-white">
                                        <option value="profit">Utilidad</option>
                                        <option value="revenue">Ingresos</option>
                                        <option value="spend">Gasto</option>
                                        <option value="roas">ROAS</option>
                                        <option value="name">Nombre</option>
                                    </select>
                                </div>
                                <div className="max-h-[60vh] overflow-auto">
                                    <table className="w-full text-xs text-gray-900">
                                        <thead className="bg-gray-50 sticky top-0">
                                            <tr>
                                                <th className="px-2 py-2 text-left font-semibold text-gray-800">{perspective === 'ads' ? 'Anuncio' : 'Segmentación'}</th>
                                                <th className="px-1 py-2 text-right font-semibold text-gray-800">Ingresos</th>
                                                <th className="px-1 py-2 text-right font-semibold text-gray-800">Gasto</th>
                                                <th className="px-1 py-2 text-right font-semibold text-gray-800">Utilidad</th>
                                                <th className="px-1 py-2 text-right font-semibold text-gray-800">ROAS</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sortedMainList.map((item) => (
                                                <tr
                                                    key={item.key}
                                                    onClick={(e) => handleMainRowClick(item.key, e)}
                                                    className={`cursor-pointer hover:bg-gray-50 ${selectedKeys.has(item.key) ? 'bg-indigo-50' : ''}`}
                                                >
                                                    <td className="px-2 py-2 font-medium text-gray-900 truncate max-w-[120px]" title={item.name}>{item.name}</td>
                                                    <td className="px-1 py-2 text-right text-green-600">${formatCompact(item.total_revenue)}</td>
                                                    <td className="px-1 py-2 text-right text-red-600">${formatCompact(item.total_spend)}</td>
                                                    <td className={`px-1 py-2 text-right font-bold ${item.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>${formatCompact(item.profit)}</td>
                                                    <td className="px-1 py-2 text-right text-indigo-600">{item.roas.toFixed(1)}x</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </aside>

                            <main className="lg:w-2/3 bg-white rounded-lg shadow p-6 text-gray-900">
                                {selectedKeys.size === 0 ? (
                                    <div className="text-center py-12 text-gray-700">
                                        <p className="text-xl font-semibold text-gray-800">Selecciona uno o más {perspective === 'ads' ? 'anuncios' : 'segmentaciones'}</p>
                                        <p className="mt-2 text-gray-600">Los detalles aparecerán aquí.</p>
                                    </div>
                                ) : selectedDetails ? (
                                    <>
                                        <h2 className="text-xl font-bold text-gray-900 mb-4">Resumen de la Selección ({selectedKeys.size} {perspective === 'ads' ? 'anuncios' : 'segmentaciones'})</h2>
                                        <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Leads</h4>
                                                <p className="text-xl font-bold text-blue-600">{selectedDetails.totalLeads.toLocaleString()}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Ventas</h4>
                                                <p className="text-xl font-bold text-purple-600">{selectedDetails.totalSales.toLocaleString()}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Conv%</h4>
                                                <p className="text-xl font-bold text-gray-900">{selectedDetails.totalLeads > 0 ? ((selectedDetails.totalSales / selectedDetails.totalLeads) * 100).toFixed(2) : 0}%</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Ingresos</h4>
                                                <p className="text-xl font-bold text-green-600">{formatCurrency(selectedDetails.totalRevenue)}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Gasto</h4>
                                                <p className="text-xl font-bold text-red-600">{formatCurrency(selectedDetails.totalSpend)}</p>
                                            </div>
                                            <div className="p-4 bg-gray-50 rounded text-center">
                                                <h4 className="text-xs font-medium text-gray-700 uppercase">Utilidad</h4>
                                                <p className={`text-xl font-bold ${selectedDetails.totalRevenue - selectedDetails.totalSpend >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                                                    {formatCurrency(selectedDetails.totalRevenue - selectedDetails.totalSpend)}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-semibold text-gray-900">Análisis Combinado de {perspective === 'ads' ? 'Segmentaciones' : 'Anuncios'}</h3>
                                            <select value={detailSortBy} onChange={(e) => setDetailSortBy(e.target.value)} className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-900 bg-white">
                                                <option value="profit">Beneficio</option>
                                                <option value="revenue">Ingresos</option>
                                                <option value="leads">Leads</option>
                                                <option value="name">Nombre</option>
                                            </select>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm text-gray-900">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left font-semibold text-gray-800">Nombre</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Leads</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Ventas</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">ROAS</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Ingresos</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Gasto</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Utilidad</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Conv%</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">CPL</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedDetails.details.map((d: any, i: number) => {
                                                        const roas = (d.spend_allocated || 0) > 0 ? (d.revenue || 0) / (d.spend_allocated || 0) : 0;
                                                        return (
                                                            <tr key={i} className="border-t border-gray-200">
                                                                <td className="px-4 py-2 font-medium text-gray-900">{d.name}</td>
                                                                <td className="px-4 py-2 text-right">{d.leads?.toLocaleString()}</td>
                                                                <td className="px-4 py-2 text-right">{d.sales?.toLocaleString()}</td>
                                                                <td className={`px-4 py-2 text-right font-bold ${roas >= 2 ? 'text-green-600' : roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{roas.toFixed(2)}x</td>
                                                                <td className="px-4 py-2 text-right text-green-600">{formatCurrency(d.revenue || 0)}</td>
                                                                <td className="px-4 py-2 text-right text-red-600">{formatCurrency(d.spend_allocated || 0)}</td>
                                                                <td className={`px-4 py-2 text-right font-bold ${(d.profit || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(d.profit || 0)}</td>
                                                                <td className="px-4 py-2 text-right text-gray-900">{(d.conversion_rate || 0).toFixed(2)}%</td>
                                                                <td className="px-4 py-2 text-right text-gray-900">{formatCurrency(d.cpl || 0)}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                ) : null}
                            </main>
                        </div>
                    </div>
                )}

                {activeTab === 'quality' && qualityData && (
                    <div className="space-y-6 text-gray-900">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-purple-50 to-pink-50">
                                <h4 className="text-sm font-semibold text-purple-800">Segmentos de Calidad</h4>
                                <p className="text-2xl font-bold text-purple-600">{qualityData.segments?.length || 0}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-green-50 to-blue-50">
                                <h4 className="text-sm font-semibold text-green-800">Ingresos Totales</h4>
                                <p className="text-2xl font-bold text-green-600">{formatCurrency(qualityData.summary?.total_revenue || 0)}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-yellow-50 to-orange-50">
                                <h4 className="text-sm font-semibold text-yellow-800">ROAS Promedio</h4>
                                <p className="text-2xl font-bold text-yellow-600">{(qualityData.summary?.total_roas || 0).toFixed(2)}x</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center bg-gradient-to-r from-indigo-50 to-purple-50">
                                <h4 className="text-sm font-semibold text-indigo-800">Gasto Total</h4>
                                <p className="text-2xl font-bold text-indigo-600">{formatCurrency(qualityData.summary?.total_spend || 0)}</p>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {(['estudios', 'ingresos', 'ocupacion', 'edad_especifica'] as const).map((cat) => {
                                const groups = qualityGroups[cat] || {};
                                const rows = Object.entries(groups).map(([name, data]) => {
                                    const conv = data.leads > 0 ? (data.sales / data.leads) * 100 : 0;
                                    const roas = data.spend > 0 ? data.revenue / data.spend : 0;
                                    return { name, ...data, conv, roas };
                                });
                                const labels: Record<string, string> = { estudios: 'Estudios', ingresos: 'Ingresos', ocupacion: 'Ocupación', edad_especifica: 'Edad' };
                                return (
                                    <div key={cat} className="bg-white rounded-lg shadow p-4 text-gray-900">
                                        <h4 className="font-semibold mb-3 text-indigo-800">Por {labels[cat]}</h4>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50">
                                                    <tr>
                                                        <th className="px-3 py-2 text-left font-semibold text-gray-800">{labels[cat]}</th>
                                                        <th className="px-3 py-2 text-center font-semibold text-gray-800">Leads</th>
                                                        <th className="px-3 py-2 text-center font-semibold text-gray-800">Gasto</th>
                                                        <th className="px-3 py-2 text-center font-semibold text-gray-800">Conv%</th>
                                                        <th className="px-3 py-2 text-center font-semibold text-gray-800">ROAS</th>
                                                        <th className="px-3 py-2 text-center font-semibold text-gray-800">Profit</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {rows.map((r) => (
                                                        <tr key={r.name} className="border-t border-gray-200 hover:bg-gray-50">
                                                            <td className="px-3 py-2 font-medium text-gray-900">{r.name}</td>
                                                            <td className="px-3 py-2 text-center text-blue-600">{r.leads.toLocaleString()}</td>
                                                            <td className="px-3 py-2 text-center text-purple-600">{formatCurrency(r.spend)}</td>
                                                            <td className={`px-3 py-2 text-center ${r.conv >= 5 ? 'text-green-600' : r.conv >= 2 ? 'text-yellow-600' : 'text-red-600'}`}>{r.conv.toFixed(1)}%</td>
                                                            <td className={`px-3 py-2 text-center ${r.roas >= 2 ? 'text-green-600' : r.roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{r.roas.toFixed(1)}x</td>
                                                            <td className={`px-3 py-2 text-center ${r.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(r.profit)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {activeTab === 'factors' && factorAnalysis && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                <div className="text-2xl font-bold text-green-600">{factorAnalysis.stats.high_roas_count}</div>
                                <div className="text-sm text-green-700">Segmentos ROAS ≥ 1.5x</div>
                                <div className="text-xs text-green-600">ROAS Prom: {factorAnalysis.stats.avg_roas_good}x</div>
                            </div>
                            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                                <div className="text-2xl font-bold text-red-600">{factorAnalysis.stats.low_roas_count}</div>
                                <div className="text-sm text-red-700">Segmentos ROAS &lt; 1.5x</div>
                                <div className="text-xs text-red-600">ROAS Prom: {factorAnalysis.stats.avg_roas_bad}x</div>
                            </div>
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                                <div className="text-2xl font-bold text-blue-600">{factorAnalysis.stats.total_segments}</div>
                                <div className="text-sm text-blue-700">Total Segmentos</div>
                            </div>
                            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                                <div className="text-2xl font-bold text-purple-600">
                                    {factorAnalysis.stats.total_segments > 0 ? ((factorAnalysis.stats.high_roas_count / factorAnalysis.stats.total_segments) * 100).toFixed(1) : 0}%
                                </div>
                                <div className="text-sm text-purple-700">% Éxito</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="bg-green-50 p-6 rounded-lg border border-green-200">
                                <h4 className="text-lg font-semibold text-green-800 mb-4">Factores que Generan ROAS Alto (≥1.5x)</h4>
                                {(['qlead', 'ingresos', 'estudios', 'ocupacion', 'proposito', 'edad_especifica'] as const).map((field) => {
                                    const items = factorAnalysis.good_factors?.[field];
                                    if (!items || Object.keys(items).length === 0) return null;
                                    return (
                                        <div key={field} className="mb-4">
                                            <h5 className="font-medium text-green-700 mb-2">{fieldNames[field]}</h5>
                                            <div className="space-y-2">
                                                {Object.entries(items).map(([value, stats]: [string, any]) => (
                                                    <div key={value} className="bg-white p-3 rounded text-sm border border-gray-200">
                                                        <div className="flex justify-between">
                                                            <span className="font-medium text-gray-900">{value}</span>
                                                            <span className="text-green-600 font-semibold">{stats.ratio}%</span>
                                                        </div>
                                                        <div className="text-xs text-gray-700">
                                                            {stats.good_leads} leads exitosos de {stats.total_leads} total
                                                            {stats.avg_roas_good > 0 && ` • ROAS prom: ${stats.avg_roas_good}x`}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {factorAnalysis.good_factors?.combinations && Object.keys(factorAnalysis.good_factors.combinations).length > 0 && (
                                    <div className="mt-4">
                                        <h5 className="font-medium text-green-700 mb-2">Combinaciones Exitosas</h5>
                                        {Object.entries(factorAnalysis.good_factors.combinations).map(([combo, stats]: [string, any]) => (
                                            <div key={combo} className="bg-white p-3 rounded text-sm border border-gray-200 mb-2">
                                                <div className="flex justify-between">
                                                    <span className="font-medium text-gray-900">{combo}</span>
                                                    <span className="text-green-600 font-semibold">{stats.ratio}%</span>
                                                </div>
                                                <div className="text-xs text-gray-700">{stats.good_leads} leads exitosos de {stats.total_leads} total</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="bg-red-50 p-6 rounded-lg border border-red-200">
                                <h4 className="text-lg font-semibold text-red-800 mb-4">Factores que Generan ROAS Bajo (&lt;1.5x)</h4>
                                {(['qlead', 'ingresos', 'estudios', 'ocupacion', 'proposito', 'edad_especifica'] as const).map((field) => {
                                    const items = factorAnalysis.bad_factors?.[field];
                                    if (!items || Object.keys(items).length === 0) return null;
                                    return (
                                        <div key={field} className="mb-4">
                                            <h5 className="font-medium text-red-700 mb-2">{fieldNames[field]}</h5>
                                            <div className="space-y-2">
                                                {Object.entries(items).map(([value, stats]: [string, any]) => (
                                                    <div key={value} className="bg-white p-3 rounded text-sm border">
                                                        <div className="flex justify-between">
                                                            <span className="font-medium">{value}</span>
                                                            <span className="text-red-600 font-semibold">{stats.ratio}%</span>
                                                        </div>
                                                        <div className="text-xs text-gray-600">
                                                            {stats.good_leads} leads exitosos de {stats.total_leads} total
                                                            {stats.avg_roas_bad > 0 && ` • ROAS prom: ${stats.avg_roas_bad}x`}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                                {factorAnalysis.bad_factors?.combinations && Object.keys(factorAnalysis.bad_factors.combinations).length > 0 && (
                                    <div className="mt-4">
                                        <h5 className="font-medium text-red-700 mb-2">Combinaciones Problemáticas</h5>
                                        {Object.entries(factorAnalysis.bad_factors.combinations).map(([combo, stats]: [string, any]) => (
                                            <div key={combo} className="bg-white p-3 rounded text-sm border mb-2">
                                                <div className="flex justify-between">
                                                    <span className="font-medium">{combo}</span>
                                                    <span className="text-red-600 font-semibold">{stats.ratio}%</span>
                                                </div>
                                                <div className="text-xs text-gray-700">{stats.good_leads} leads exitosos de {stats.total_leads} total</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 text-gray-900">
                            <h5 className="font-semibold text-blue-800 mb-4">Recomendaciones de Acción</h5>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <h6 className="font-medium text-blue-700 mb-2">Para Optimizar:</h6>
                                    <ul className="text-sm text-blue-700 space-y-1">
                                        <li>• Enfócate en los factores positivos identificados</li>
                                        <li>• Incrementa gasto en segmentos con factores exitosos</li>
                                        <li>• Crea audiencias basadas en combinaciones exitosas</li>
                                    </ul>
                                </div>
                                <div>
                                    <h6 className="font-medium text-blue-700 mb-2">Para Evitar:</h6>
                                    <ul className="text-sm text-blue-700 space-y-1">
                                        <li>• Reduce inversión en factores problemáticos</li>
                                        <li>• Excluye audiencias con combinaciones negativas</li>
                                        <li>• Ajusta creativos para atraer perfiles exitosos</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'captation' && (
                    <div className="space-y-6 text-gray-900">
                        {(dashboardData.salesByRegistrationDate?.length > 0 || (dashboardData.captationDaysData && dashboardData.captationDaysData.length > 0)) ? (
                        <>
                        {(dashboardData.salesByRegistrationDate?.length > 0 && dashboardData.captationDaysData?.length > 0) && (
                        <div className="flex gap-2 mb-4">
                            <button
                                onClick={() => setCaptationView('by_date')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${captationView === 'by_date' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                            >
                                Por fecha de registro
                            </button>
                            <button
                                onClick={() => setCaptationView('by_days')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${captationView === 'by_days' ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'}`}
                            >
                                Por días hasta compra
                            </button>
                        </div>
                        )}

                        {((captationView === 'by_date' && dashboardData.salesByRegistrationDate?.length > 0) || (dashboardData.salesByRegistrationDate?.length > 0 && !dashboardData.captationDaysData?.length)) && (
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold mb-2 text-indigo-800">Ventas por Fecha de Registro</h3>
                            <p className="text-sm text-gray-700 mb-6">
                                Cuántas personas se registraron cada día y cuántas de ellas compraron. Útil para ver si los que se registraron en ciertas fechas (ej. antes del evento) compraron más que los que se registraron después.
                            </p>
                            <div className="h-[400px] w-full mb-6">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart
                                        data={dashboardData.salesByRegistrationDate.map((r: any) => ({
                                            ...r,
                                            label: formatDateShort(r.date),
                                            conversion: r.leads > 0 ? Math.round((r.sales / r.leads) * 1000) / 10 : 0
                                        }))}
                                        margin={{ top: 20, right: 120, left: 20, bottom: 60 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Registros', angle: -90, position: 'insideLeft' }} />
                                        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} label={{ value: 'Compraron', angle: 90, position: 'insideRight' }} />
                                        <YAxis yAxisId="right2" orientation="right" domain={[0, 100]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} width={45} label={{ value: 'Conv. %', angle: 90, position: 'insideRight', offset: 0 }} />
                                        <YAxis yAxisId="ingresos" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(v) => formatCompact(v)} width={50} />
                                        <Tooltip content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0]?.payload;
                                            const conv = d?.leads > 0 ? ((d?.sales / d?.leads) * 100).toFixed(1) : '0';
                                            return (
                                                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-sm text-gray-900">
                                                    <p className="font-semibold mb-2 text-gray-900">{formatDateShort(d?.date)}</p>
                                                    <p>Registros: <strong>{d?.leads ?? 0}</strong></p>
                                                    <p>Compraron: <strong>{d?.sales ?? 0}</strong></p>
                                                    <p>Conversión: <strong>{conv}%</strong></p>
                                                    <p>Ingresos: <strong>{formatCurrency(d?.revenue ?? 0)}</strong></p>
                                                </div>
                                            );
                                        }} />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="leads" name="Registros" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                                        <Bar yAxisId="right" dataKey="sales" name="Compraron" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                        <Line yAxisId="right2" type="monotone" dataKey="conversion" name="Conversión %" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
                                        <Line yAxisId="ingresos" type="monotone" dataKey="revenue" name="Ingresos" stroke="#eab308" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 5" />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-4 py-3 text-left font-semibold text-gray-800">Fecha de Registro</th>
                                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Registros</th>
                                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Compraron</th>
                                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Conversión</th>
                                            <th className="px-4 py-3 text-right font-semibold text-gray-800">Ingresos</th>
                                            <th className="px-4 py-3 text-center font-semibold text-gray-800 w-12"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {dashboardData.salesByRegistrationDate.map((row: any) => (
                                            <tr key={row.date} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium text-gray-900">{formatDateShort(row.date)}</td>
                                                <td className="px-4 py-3 text-right text-gray-700">{row.leads}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-indigo-600">{row.sales}</td>
                                                <td className="px-4 py-3 text-right">{row.leads > 0 ? ((row.sales / row.leads) * 100).toFixed(1) : 0}%</td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.revenue)}</td>
                                                <td className="px-4 py-3 text-center">
                                                    {row.ads && row.ads.length > 0 ? (
                                                        <button
                                                            onClick={() => { setModalDateRow({ date: row.date, ads: row.ads }); setModalViewBy('anuncio'); }}
                                                            className="p-1.5 rounded text-indigo-600 hover:bg-indigo-50 transition-colors"
                                                            title="Ver anuncios"
                                                        >
                                                            <ChevronDown className="h-4 w-4" />
                                                        </button>
                                                    ) : (
                                                        <span className="text-gray-300">—</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            {modalDateRow && (() => {
                                const grouped = (modalViewBy === 'anuncio'
                                    ? Object.entries(modalDateRow.ads.reduce((acc: Record<string, { leads: number; sales: number; revenue: number }>, ad: any) => {
                                        const k = ad.anuncio || 'Sin anuncio';
                                        if (!acc[k]) acc[k] = { leads: 0, sales: 0, revenue: 0 };
                                        acc[k].leads += ad.leads;
                                        acc[k].sales += ad.sales;
                                        acc[k].revenue += ad.revenue;
                                        return acc;
                                    }, {})).map(([name, data]) => ({ name, ...data }))
                                    : Object.entries(modalDateRow.ads.reduce((acc: Record<string, { leads: number; sales: number; revenue: number }>, ad: any) => {
                                        const k = ad.segmentacion || 'Sin segmentación';
                                        if (!acc[k]) acc[k] = { leads: 0, sales: 0, revenue: 0 };
                                        acc[k].leads += ad.leads;
                                        acc[k].sales += ad.sales;
                                        acc[k].revenue += ad.revenue;
                                        return acc;
                                    }, {})).map(([name, data]) => ({ name, ...data }))
                                ).sort((a: any, b: any) => b.revenue - a.revenue);
                                return (
                                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setModalDateRow(null)}>
                                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
                                        <div className="flex items-center justify-between p-4 border-b">
                                            <h3 className="text-lg font-semibold text-gray-900">Detalle del {formatDateShort(modalDateRow.date)}</h3>
                                            <div className="flex items-center gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <span className="text-sm font-medium text-gray-700">Anuncio</span>
                                                    <button
                                                        type="button"
                                                        role="switch"
                                                        aria-checked={modalViewBy === 'segmentacion'}
                                                        onClick={() => setModalViewBy(v => v === 'anuncio' ? 'segmentacion' : 'anuncio')}
                                                        className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${modalViewBy === 'segmentacion' ? 'bg-indigo-600' : 'bg-gray-200'}`}
                                                    >
                                                        <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${modalViewBy === 'segmentacion' ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                                    </button>
                                                    <span className="text-sm font-medium text-gray-700">Segmentación</span>
                                                </label>
                                                <button onClick={() => setModalDateRow(null)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600">
                                                    <X className="h-5 w-5" />
                                                </button>
                                            </div>
                                        </div>
                                        <div className="overflow-auto max-h-[60vh]">
                                            <table className="w-full text-sm">
                                                <thead className="bg-gray-50 sticky top-0">
                                                    <tr>
                                                        <th className="px-4 py-2 text-left font-semibold text-gray-800">{modalViewBy === 'anuncio' ? 'Anuncio' : 'Segmentación'}</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Registros</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Compraron</th>
                                                        <th className="px-4 py-2 text-right font-semibold text-gray-800">Ingresos</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-200">
                                                    {grouped.map((row: any, i: number) => (
                                                        <tr key={i} className="hover:bg-gray-50">
                                                            <td className="px-4 py-2 font-medium text-gray-900">{row.name}</td>
                                                            <td className="px-4 py-2 text-right text-gray-700">{row.leads}</td>
                                                            <td className="px-4 py-2 text-right font-semibold text-indigo-600">{row.sales}</td>
                                                            <td className="px-4 py-2 text-right text-green-600">{formatCurrency(row.revenue)}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                                );
                            })()}
                        </div>
                        )}

                        {((captationView === 'by_days' && dashboardData.captationDaysData?.length > 0) || (dashboardData.captationDaysData?.length > 0 && !dashboardData.salesByRegistrationDate?.length)) && (
                        <div className="bg-white rounded-lg shadow p-6">
                            <h3 className="text-lg font-semibold mb-2 text-indigo-800">Compras vs Días desde Registro</h3>
                            <p className="text-sm text-gray-700 mb-6">
                                Distribución de ventas según cuántos días pasaron entre el registro del lead y la compra. Útil para decidir si ampliar o reducir la ventana de captación.
                            </p>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={dashboardData.captationDaysData.map((r: any) => ({ ...r, dia: `Día ${r.days}` }))} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="dia" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={80} />
                                        <YAxis tick={{ fontSize: 11 }} label={{ value: 'Compras', angle: -90, position: 'insideLeft' }} />
                                        <Tooltip content={({ active, payload, label }) => {
                                            if (!active || !payload?.length) return null;
                                            const d = payload[0]?.payload;
                                            return (
                                                <div className="bg-white p-3 rounded-lg shadow-lg border border-gray-200 text-sm text-gray-900">
                                                    <p className="font-semibold mb-2 text-gray-900">{label}</p>
                                                    <p>Compras: <strong>{d?.count ?? 0}</strong></p>
                                                    <p>Ingresos: <strong>{formatCurrency(d?.revenue ?? 0)}</strong></p>
                                                </div>
                                            );
                                        }} />
                                        <Legend />
                                        <Bar dataKey="count" name="Compras" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                            {(() => {
                                const data = dashboardData.captationDaysData as { days: number; count: number; revenue: number }[];
                                const totalCount = data.reduce((s, r) => s + r.count, 0);
                                const totalRevenue = data.reduce((s, r) => s + r.revenue, 0);
                                const by7 = data.filter((r) => r.days <= 7).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                const by14 = data.filter((r) => r.days <= 14).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                const by30 = data.filter((r) => r.days <= 30).reduce((s, r) => ({ count: s.count + r.count, revenue: s.revenue + r.revenue }), { count: 0, revenue: 0 });
                                return (
                                    <div className="mt-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-800 uppercase">Primeros 7 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by7.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by7.revenue)}</p>
                                            <p className="text-xs text-gray-700">{totalCount > 0 ? ((by7.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-800 uppercase">Primeros 14 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by14.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by14.revenue)}</p>
                                            <p className="text-xs text-gray-700">{totalCount > 0 ? ((by14.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-100">
                                            <p className="text-xs font-medium text-indigo-800 uppercase">Primeros 30 días</p>
                                            <p className="text-xl font-bold text-indigo-600">{by30.count} compras</p>
                                            <p className="text-sm text-indigo-600">{formatCurrency(by30.revenue)}</p>
                                            <p className="text-xs text-gray-700">{totalCount > 0 ? ((by30.count / totalCount) * 100).toFixed(1) : 0}% del total</p>
                                        </div>
                                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                            <p className="text-xs font-medium text-gray-700 uppercase">Total</p>
                                            <p className="text-xl font-bold text-gray-800">{totalCount} compras</p>
                                            <p className="text-sm text-gray-700">{formatCurrency(totalRevenue)}</p>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                        )}
                        </>
                        ) : (
                        <div className="bg-white rounded-lg shadow p-8 text-center">
                            <h3 className="text-lg font-semibold mb-2 text-indigo-800">Días desde Registro</h3>
                            <p className="text-gray-700 mb-4">
                                No se encontraron datos. Se necesita al menos la columna de fecha de registro en la tabla base:
                            </p>
                            <ul className="text-sm text-gray-600 text-left max-w-md mx-auto space-y-1">
                                <li>• Tabla base: <code className="bg-gray-100 px-1 rounded">FECHA_REGISTRO</code>, <code className="bg-gray-100 px-1 rounded">FECHA</code> o <code className="bg-gray-100 px-1 rounded">FECHA_CAPTACION</code></li>
                                <li>• Para &quot;días hasta compra&quot; también: tabla de ventas con <code className="bg-gray-100 px-1 rounded">FECHA</code>, <code className="bg-gray-100 px-1 rounded">FECHA_VENTA</code> o <code className="bg-gray-100 px-1 rounded">created_at</code></li>
                            </ul>
                            <p className="text-sm text-gray-500 mt-4">
                                <strong>Por fecha de registro:</strong> cuántos se registraron cada día y cuántos compraron. <strong>Por días hasta compra:</strong> cuántos días pasaron entre registro y compra.
                            </p>
                        </div>
                        )}
                    </div>
                )}

                {activeTab === 'countries' && dashboardData.countryData && (() => {
                    const cols = [
                        { key: 'country', label: 'País', align: 'left' as const },
                        { key: 'gasto', label: 'Gasto', align: 'right' as const },
                        { key: 'roas', label: 'ROAS', align: 'right' as const },
                        { key: 'ventas_organicas', label: 'Ventas Orgánicas', align: 'right' as const },
                        { key: 'ventas_trackeadas', label: 'Ventas Trackeadas', align: 'right' as const },
                        { key: 'total_ventas', label: 'Total Ventas', align: 'right' as const },
                    ];
                    const getSortVal = (row: any, k: string) =>
                        k === 'total_ventas' ? (row.ventas_organicas ?? 0) + (row.ventas_trackeadas ?? 0) : row[k];
                    const sorted = [...dashboardData.countryData].sort((a: any, b: any) => {
                        const va = getSortVal(a, countrySortBy);
                        const vb = getSortVal(b, countrySortBy);
                        const cmp = typeof va === 'string'
                            ? (va ?? '').localeCompare(vb ?? '')
                            : (Number(va) ?? 0) - (Number(vb) ?? 0);
                        return countrySortDir === 'asc' ? cmp : -cmp;
                    });
                    const toggleSort = (key: string) => {
                        if (countrySortBy === key) setCountrySortDir(d => d === 'asc' ? 'desc' : 'asc');
                        else { setCountrySortBy(key); setCountrySortDir('desc'); }
                    };
                    const totalGasto = dashboardData.countryData.reduce((s: number, r: any) => s + (r.gasto ?? 0), 0);
                    const totalOrg = dashboardData.countryData.reduce((s: number, r: any) => s + (r.ventas_organicas ?? 0), 0);
                    const totalTrack = dashboardData.countryData.reduce((s: number, r: any) => s + (r.ventas_trackeadas ?? 0), 0);
                    const totalVentas = totalOrg + totalTrack;
                    const roasGeneral = totalGasto > 0 ? totalTrack / totalGasto : 0;
                    return (
                    <div className="space-y-6 text-gray-900">
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                            <div className="bg-white p-4 rounded-lg shadow text-center border-l-4 border-red-500">
                                <h4 className="text-xs font-medium text-gray-600 uppercase">Total Gasto</h4>
                                <p className="text-xl font-bold text-red-600 mt-1">{formatCurrency(totalGasto)}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center border-l-4 border-green-500">
                                <h4 className="text-xs font-medium text-gray-600 uppercase">Ventas Orgánicas</h4>
                                <p className="text-xl font-bold text-green-600 mt-1">{formatCurrency(totalOrg)}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center border-l-4 border-blue-500">
                                <h4 className="text-xs font-medium text-gray-600 uppercase">Ventas Trackeadas</h4>
                                <p className="text-xl font-bold text-blue-600 mt-1">{formatCurrency(totalTrack)}</p>
                            </div>
                            <div className="bg-white p-4 rounded-lg shadow text-center border-l-4 border-gray-700">
                                <h4 className="text-xs font-medium text-gray-600 uppercase">Total Ventas</h4>
                                <p className="text-xl font-bold text-gray-900 mt-1">{formatCurrency(totalVentas)}</p>
                            </div>
                            <div className={`bg-white p-4 rounded-lg shadow text-center border-l-4 ${roasGeneral >= 2 ? 'border-green-500' : roasGeneral >= 1 ? 'border-yellow-500' : 'border-red-500'}`}>
                                <h4 className="text-xs font-medium text-gray-600 uppercase">ROAS General</h4>
                                <p className={`text-xl font-bold mt-1 ${roasGeneral >= 2 ? 'text-green-600' : roasGeneral >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>{roasGeneral.toFixed(2)}x</p>
                            </div>
                        </div>
                        <div className="bg-white rounded-lg shadow overflow-hidden">
                            <h3 className="text-lg font-semibold p-4 border-b bg-indigo-50 text-indigo-900">Vista de Países</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            {cols.map(({ key, label, align }) => (
                                                <th
                                                    key={key}
                                                    className={`px-4 py-3 font-semibold text-gray-800 cursor-pointer select-none hover:bg-gray-100 transition-colors ${align === 'right' ? 'text-right' : 'text-left'}`}
                                                    onClick={() => toggleSort(key)}
                                                >
                                                    <span className="inline-flex items-center gap-1">
                                                        {label}
                                                        {countrySortBy === key && (
                                                            <span className="text-indigo-600">{countrySortDir === 'asc' ? '↑' : '↓'}</span>
                                                        )}
                                                    </span>
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        {sorted.map((row: any) => (
                                            <tr key={row.country} className="hover:bg-gray-50">
                                                <td className="px-4 py-3 font-medium text-gray-900">{row.country}</td>
                                                <td className="px-4 py-3 text-right text-red-600">{formatCurrency(row.gasto)}</td>
                                                <td className={`px-4 py-3 text-right font-bold ${row.roas >= 2 ? 'text-green-600' : row.roas >= 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                    {row.roas.toFixed(2)}x
                                                </td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(row.ventas_organicas)}</td>
                                                <td className="px-4 py-3 text-right text-blue-600">{formatCurrency(row.ventas_trackeadas)}</td>
                                                <td className="px-4 py-3 text-right font-semibold text-gray-900">{formatCurrency((row.ventas_organicas ?? 0) + (row.ventas_trackeadas ?? 0))}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                    );
                })()}
            </div>
        </div>
    );
}
